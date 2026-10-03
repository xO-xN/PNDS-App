//! #140: the trusted-HTTPS entry gateway — a TLS reverse proxy owned by
//! the session lifecycle. The phone → gateway → local performer-server
//! path is the only new route (#137); the gateway is transport
//! forwarding, never an interpreter of the project's Socket.IO
//! protocol, so it preserves method, path, query, headers and payload
//! bytes verbatim (hop-by-hop headers excepted, per HTTP semantics)
//! and tunnels WebSocket upgrades bidirectionally after the 101.
//!
//! Stack: hyper 1 over tokio, rustls with the ring provider — mature
//! implementations, pure Rust (no system runtime dependency, macOS 13.5
//! baseline, both architectures). The certificate/key material comes
//! from the #139 protected storage and is revalidated before the
//! gateway is ever constructed.
//!
//! Bounded resources: one semaphore caps concurrent connections (extra
//! connections receive a plain 503 and close); hyper streams request
//! and response bodies (no whole-body buffering anywhere), and the
//! upgrade bridge relays through `copy_bidirectional`'s fixed buffers.

use std::convert::Infallible;
use std::io::{Read as _, Write as _};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Empty, Full};
use hyper::body::Incoming;
use hyper::header::{HeaderMap, HeaderName, CONNECTION};
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode, Uri};
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::client::legacy::Client;
use hyper_util::rt::{TokioExecutor, TokioIo};
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener as TokioListener;
use tokio_rustls::TlsAcceptor;

use crate::https;

/// Concurrent-connection cap for one gateway (phones open a page +
/// Socket.IO per performer; 64 covers a band with headroom while keeping
/// buffers bounded — `MAX_CONNECTIONS` extra sockets each hold only a
/// TLS session and a 503).
pub const MAX_CONNECTIONS: usize = 64;

/// How long the runtime waits for in-flight connections to observe the
/// shutdown signal before it is torn down regardless.
const RUNTIME_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);

/// Watchdog for the gateway thread join in `GatewayHandle::shutdown` —
/// pathological cases leak the thread instead of hanging Stop.
const JOIN_WATCHDOG: Duration = Duration::from_secs(5);

/// The plain response written when the connection cap is reached.
const OVERLOAD_RESPONSE: &[u8] =
    b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

/// Callback invoked once when the accept loop fails fatally at runtime
/// (the listener dies, e.g. the interface vanished). The session wires
/// this to the entry-state error path; the gateway itself owns no
/// session knowledge.
pub type FailureSink = Arc<dyn Fn(String) + Send + Sync>;

/// Everything one gateway needs, resolved and validated by the session
/// before `start_gateway` — cert/key problems and port conflicts
/// therefore surface synchronously at start, never mid-performance.
pub struct GatewayConfig {
    /// Selected LAN interface + configured HTTPS port (the phone's DNS
    /// resolves the entry domain here).
    pub bind_addr: SocketAddr,
    /// The project's local performer server (§1: the project owns it).
    pub upstream: SocketAddr,
    /// Certificate chain (leaf first) from the #139 protected storage.
    pub chain: Vec<CertificateDer<'static>>,
    /// The matching private key.
    pub key: PrivateKeyDer<'static>,
    /// Concurrent-connection cap (tests shrink it to exercise refusal).
    pub max_connections: usize,
}

/// A running gateway: the shutdown signal plus the thread that owns the
/// tokio runtime. Dropping without `shutdown` abandons the thread (the
/// session's teardown always calls `shutdown` — bounded, idempotent).
pub struct GatewayHandle {
    shutdown_tx: tokio::sync::watch::Sender<bool>,
    thread: Option<std::thread::JoinHandle<()>>,
    local_addr: SocketAddr,
}

impl GatewayHandle {
    /// The address the gateway actually bound (port 0 asks the OS for
    /// an ephemeral one — tests use this).
    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    /// Closes the listener, then every active connection, then joins
    /// the runtime thread — bounded by the shutdown timeout and a
    /// join watchdog so Stop can never hang on a wedged gateway.
    pub fn shutdown(mut self) {
        let _ = self.shutdown_tx.send(true);
        if let Some(thread) = self.thread.take() {
            let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();
            std::thread::spawn(move || {
                let _ = thread.join();
                let _ = done_tx.send(());
            });
            if done_rx.recv_timeout(JOIN_WATCHDOG).is_err() {
                log::warn!(
                    "HTTPS gateway thread did not stop within the watchdog window; abandoning it"
                );
            }
        }
        let local_addr = self.local_addr;
        log::info!("HTTPS gateway stopped ({local_addr})");
    }
}

/// Binds the listener (synchronously, in the caller's thread — port
/// conflicts belong to the start failure path) and spawns the gateway
/// runtime thread. TLS-config construction happens here for the same
/// reason: a bad key fails the start, not the performance.
pub fn start_gateway(
    config: GatewayConfig,
    on_failure: FailureSink,
) -> Result<GatewayHandle, String> {
    let listener = std::net::TcpListener::bind(config.bind_addr).map_err(|e| {
        format!(
            "Cannot listen on {} for the HTTPS entry: {e}",
            config.bind_addr
        )
    })?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Cannot prepare the HTTPS entry listener: {e}"))?;
    let local_addr = listener
        .local_addr()
        .map_err(|e| format!("Cannot resolve the HTTPS entry address: {e}"))?;

    let tls = server_config(config.chain, config.key)?;
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let thread = std::thread::Builder::new()
        .name("pnds-https-gateway".to_string())
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    on_failure(format!("HTTPS gateway runtime failed to start: {e}"));
                    return;
                }
            };
            runtime.block_on(run_gateway(
                listener,
                tls,
                config.upstream,
                config.max_connections,
                shutdown_rx,
                on_failure,
            ));
            runtime.shutdown_timeout(RUNTIME_SHUTDOWN_TIMEOUT);
        })
        .map_err(|e| format!("Failed to spawn the HTTPS gateway thread: {e}"))?;

    log::info!(
        "HTTPS gateway listening on {local_addr} → {}",
        config.upstream
    );
    Ok(GatewayHandle {
        shutdown_tx,
        thread: Some(thread),
        local_addr,
    })
}

/// rustls server config for the stored chain/key: ring provider (the
/// same crypto the #139 validation pipeline uses), TLS 1.2+1.3, ALPN
/// http/1.1 only (hyper serves HTTP/1.1; Safari falls back from h2).
fn server_config(
    chain: Vec<CertificateDer<'static>>,
    key: PrivateKeyDer<'static>,
) -> Result<rustls::ServerConfig, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let mut config = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("Unsupported TLS protocol versions: {e}"))?
        .with_no_client_auth()
        .with_single_cert(chain, key)
        .map_err(|e| format!("The stored HTTPS certificate/key pair is unusable: {e}"))?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(config)
}

/// The accept loop: TLS handshake → connection-cap permit → one hyper
/// HTTP/1.1 connection with upgrades enabled. Every connection task
/// also selects on the shutdown signal, so `GatewayHandle::shutdown`
/// closes live connections (phones reconnect through the next
/// performance's entry — §15's stable-origin promise).
async fn run_gateway(
    listener: std::net::TcpListener,
    tls: rustls::ServerConfig,
    upstream: SocketAddr,
    max_connections: usize,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
    on_failure: FailureSink,
) {
    let listener = match TokioListener::from_std(listener) {
        Ok(l) => l,
        Err(e) => {
            on_failure(format!("HTTPS entry listener failed: {e}"));
            return;
        }
    };
    let acceptor = TlsAcceptor::from(Arc::new(tls));
    let client: Client<HttpConnector, Incoming> =
        Client::builder(TokioExecutor::new()).build_http();
    let capacity = Arc::new(tokio::sync::Semaphore::new(max_connections));

    loop {
        let (tcp, _peer) = tokio::select! {
            _ = shutdown.changed() => break,
            accepted = listener.accept() => match accepted {
                Ok(pair) => pair,
                Err(e) => {
                    on_failure(format!("HTTPS entry stopped accepting connections: {e}"));
                    break;
                }
            },
        };
        let acceptor = acceptor.clone();
        let client = client.clone();
        let capacity = Arc::clone(&capacity);
        let mut shutdown_rx = shutdown.clone();
        tokio::spawn(async move {
            let tls_stream = match acceptor.accept(tcp).await {
                Ok(stream) => stream,
                Err(_) => return, // handshake failure: nothing to answer
            };
            let permit = match capacity.clone().try_acquire_owned() {
                Ok(permit) => permit,
                Err(_) => {
                    let mut tls_stream = tls_stream;
                    let _ = tls_stream.write_all(OVERLOAD_RESPONSE).await;
                    let _ = tls_stream.shutdown().await;
                    return;
                }
            };
            // The permit lives for the whole connection. hyper's serve
            // future resolves once a 101 handshake completes (the IO
            // moves to the upgrade machinery), so the proxy hands the
            // permit to the bridge task through this slot — an upgraded
            // connection keeps it until the tunnel actually closes.
            let permit_cell = Arc::new(std::sync::Mutex::new(Some(permit)));
            let service = service_fn(move |req| {
                proxy(req, client.clone(), upstream, Arc::clone(&permit_cell))
            });
            let conn = hyper::server::conn::http1::Builder::new()
                .serve_connection(TokioIo::new(tls_stream), service)
                .with_upgrades();
            tokio::select! {
                _ = shutdown_rx.changed() => {}
                _ = conn => {}
            }
            // Dropping `conn` (just above) drops the service's slot; a
            // permit the bridge already took lives on in the bridge.
        });
    }
}

type ProxyBody = BoxBody<hyper::body::Bytes, hyper::Error>;

fn empty_body() -> ProxyBody {
    Empty::<hyper::body::Bytes>::new()
        .map_err(|never| match never {})
        .boxed()
}

fn full_body(text: String) -> ProxyBody {
    Full::new(hyper::body::Bytes::from(text))
        .map_err(|never| match never {})
        .boxed()
}

fn error_body(status: StatusCode, message: &str) -> Response<ProxyBody> {
    let body = full_body(format!("{{\"error\":\"{message}\"}}"));
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(body)
        .expect("static error response builds")
}

/// Whether the request asks to switch protocols (Socket.IO's WebSocket
/// upgrade path) — recognized from the `Connection: Upgrade` token.
fn wants_upgrade(headers: &HeaderMap) -> bool {
    headers
        .get(CONNECTION)
        .and_then(|v| v.to_str().ok())
        .map(|v| {
            v.split(',')
                .any(|token| token.trim().eq_ignore_ascii_case("upgrade"))
        })
        .unwrap_or(false)
}

/// Hop-by-hop headers (RFC 9110 §7.6.1) never travel through a proxy.
/// For upgrade exchanges `Connection`/`Upgrade` ARE the handshake and
/// must pass; everything else in the list is stripped both directions.
fn is_hop_by_hop(name: &HeaderName, keep_upgrade: bool) -> bool {
    const HOP_BY_HOP: &[&str] = &[
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ];
    let name = name.as_str();
    if keep_upgrade && (name == "connection" || name == "upgrade") {
        return false;
    }
    HOP_BY_HOP.contains(&name)
}

/// The proxy core: rebuild the request against the upstream origin
/// (method, path+query, headers minus hop-by-hop, streamed body), then
/// relay the response the same way. A 101 becomes a byte-for-byte
/// bridge between the two upgraded connections — the WebSocket
/// protocol itself is never parsed — and inherits the connection's
/// capacity permit for the tunnel's lifetime.
async fn proxy(
    req: Request<Incoming>,
    client: Client<HttpConnector, Incoming>,
    upstream: SocketAddr,
    permit_slot: Arc<std::sync::Mutex<Option<tokio::sync::OwnedSemaphorePermit>>>,
) -> Result<Response<ProxyBody>, Infallible> {
    let (parts, body) = req.into_parts();
    let upgrade = wants_upgrade(&parts.headers);
    let path_query = parts
        .uri
        .path_and_query()
        .map(|pq| pq.as_str().to_string())
        .unwrap_or_else(|| "/".to_string());
    let upstream_uri: Uri = match format!("http://{upstream}{path_query}").parse() {
        Ok(uri) => uri,
        Err(e) => {
            return Ok(error_body(
                StatusCode::BAD_GATEWAY,
                &format!("entry cannot build the upstream request: {e}"),
            ))
        }
    };

    let mut builder = Request::builder()
        .method(parts.method.clone())
        .uri(upstream_uri);
    for (name, value) in parts.headers.iter() {
        if is_hop_by_hop(name, upgrade) {
            continue;
        }
        builder = builder.header(name, value);
    }
    let forwarded = match builder.body(body) {
        Ok(request) => request,
        Err(e) => {
            return Ok(error_body(
                StatusCode::BAD_GATEWAY,
                &format!("entry cannot forward the request: {e}"),
            ))
        }
    };

    let response = match client.request(forwarded).await {
        Ok(response) => response,
        Err(e) => {
            return Ok(error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                &format!("the project server is unreachable through the entry: {e}"),
            ))
        }
    };

    if response.status() == StatusCode::SWITCHING_PROTOCOLS {
        // All of the 101's headers are handshake facts (Upgrade,
        // Connection, Sec-WebSocket-*) — relay them wholesale, then
        // bridge the upgraded byte streams in both directions.
        let mut relay = Response::builder().status(response.status());
        for (name, value) in response.headers().iter() {
            relay = relay.header(name, value);
        }
        let on_upstream = hyper::upgrade::on(response);
        let on_downstream = hyper::upgrade::on(Request::from_parts(
            parts,
            Empty::<hyper::body::Bytes>::new(),
        ));
        // Hand the capacity permit to the bridge — the tunnel IS the
        // connection now.
        let permit = permit_slot.lock().unwrap().take();
        tokio::spawn(async move {
            let _permit = permit;
            if let Ok((downstream, upstream)) = tokio::try_join!(on_downstream, on_upstream) {
                let mut downstream = TokioIo::new(downstream);
                let mut upstream = TokioIo::new(upstream);
                let _ = tokio::io::copy_bidirectional(&mut downstream, &mut upstream).await;
            }
        });
        return Ok(relay.body(empty_body()).expect("101 response builds"));
    }

    let (resp_parts, resp_body) = response.into_parts();
    let mut relay = Response::builder().status(resp_parts.status);
    for (name, value) in resp_parts.headers.iter() {
        if is_hop_by_hop(name, false) {
            continue;
        }
        relay = relay.header(name, value);
    }
    Ok(relay
        .body(resp_body.boxed())
        .expect("relayed response builds"))
}

// ============================================================================
// Entry probe
// ============================================================================

/// The App's own TLS/HTTP probe of the gateway (#140: readiness is
/// published only after it succeeds). Connects to the BOUND ADDRESS
/// (the LAN interface — the domain does not have to resolve on the
/// Host) while validating the certificate for `server_name` against
/// the given roots, then requires an HTTP 200 from the project health
/// route THROUGH the tunnel. This proves TLS + proxying + upstream in
/// one round trip; it never claims anything about phones (§15: device
/// trust is the final device acceptance's fact).
pub fn probe_tls_http(
    addr: SocketAddr,
    server_name: &str,
    roots: &rustls::RootCertStore,
    timeout: Duration,
) -> Result<(), String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("Unsupported TLS protocol versions: {e}"))?
        .with_root_certificates(roots.clone())
        .with_no_client_auth();
    let server_name_parsed = rustls::pki_types::ServerName::try_from(server_name.to_string())
        .map_err(|_| format!("\"{server_name}\" is not a valid TLS server name"))?;

    let stream = std::net::TcpStream::connect_timeout(&addr, timeout)
        .map_err(|e| format!("Entry probe cannot connect to {addr}: {e}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| format!("Entry probe cannot set its read timeout: {e}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|e| format!("Entry probe cannot set its write timeout: {e}"))?;
    let mut tls = rustls::StreamOwned::new(
        rustls::ClientConnection::new(Arc::new(config), server_name_parsed)
            .map_err(|e| format!("Entry probe TLS setup failed: {e}"))?,
        stream,
    );
    // Connection: close makes the proxied response the last thing on
    // the wire, so reading to EOF is the body terminator.
    let request = format!(
        "GET {} HTTP/1.1\r\nHost: {server_name}\r\nConnection: close\r\n\r\n",
        https::HEALTH_PATH
    );
    tls.write_all(request.as_bytes())
        .map_err(|e| format!("Entry probe write failed: {e}"))?;
    let mut response = String::new();
    tls.read_to_string(&mut response)
        .map_err(|e| format!("Entry probe read failed: {e}"))?;
    let status_line = response.lines().next().unwrap_or_default();
    if status_line.contains(" 200 ") {
        Ok(())
    } else {
        Err(format!(
            "The HTTPS entry answered but not with a healthy response: {status_line}"
        ))
    }
}

/// The production probe's root store — the same Mozilla anchors the
/// #139 validation pipeline trusts. Tests pass their own test-CA store
/// instead (the test CA is trusted ONLY by the test client; system
/// trust is never touched).
pub fn public_root_store() -> &'static rustls::RootCertStore {
    static ROOTS: std::sync::OnceLock<rustls::RootCertStore> = std::sync::OnceLock::new();
    ROOTS.get_or_init(|| {
        rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use hyper::header::{HOST, UPGRADE};
    use hyper::service::service_fn as test_service_fn;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    const TEST_DOMAIN: &str = "test.local";
    const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /// A local test CA + leaf for `TEST_DOMAIN` (rcgen; the CA enters
    /// ONLY the test client's root store — never the system trust).
    fn test_material() -> (
        Vec<CertificateDer<'static>>,
        PrivateKeyDer<'static>,
        rustls::RootCertStore,
    ) {
        let ca_key = rcgen::KeyPair::generate().expect("ca key");
        let mut ca_params = rcgen::CertificateParams::new(Vec::<String>::new()).expect("ca params");
        ca_params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        ca_params
            .distinguished_name
            .push(rcgen::DnType::CommonName, "PNDS Gateway Test CA");
        let ca = ca_params.self_signed(&ca_key).expect("ca cert");

        let leaf_key = rcgen::KeyPair::generate().expect("leaf key");
        let mut leaf_params =
            rcgen::CertificateParams::new(vec![TEST_DOMAIN.to_string()]).expect("leaf params");
        leaf_params
            .distinguished_name
            .push(rcgen::DnType::CommonName, TEST_DOMAIN);
        let leaf = leaf_params
            .signed_by(&leaf_key, &ca, &ca_key)
            .expect("leaf cert");

        let mut roots = rustls::RootCertStore::empty();
        roots.add(ca.der().clone()).expect("test root installs");
        (
            vec![leaf.der().clone()],
            PrivateKeyDer::Pkcs8(leaf_key.serialize_der().into()),
            roots,
        )
    }

    /// The stand-in performer server: echoes the received method, URI,
    /// body and probe headers as JSON; upgrades become a raw byte echo.
    /// A real TCP server exercised through the real gateway — the
    /// fixture the lifecycle tests rely on.
    fn spawn_upstream() -> SocketAddr {
        let (addr_tx, addr_rx) = std::sync::mpsc::channel::<SocketAddr>();
        std::thread::Builder::new()
            .name("test-upstream".to_string())
            .spawn(move || {
                let runtime = tokio::runtime::Builder::new_multi_thread()
                    .worker_threads(1)
                    .enable_all()
                    .build()
                    .expect("upstream runtime");
                runtime.block_on(async move {
                    let listener = TokioListener::bind(("127.0.0.1", 0))
                        .await
                        .expect("upstream binds");
                    addr_tx
                        .send(listener.local_addr().expect("upstream addr"))
                        .expect("addr channel open");
                    loop {
                        let (stream, _) = match listener.accept().await {
                            Ok(pair) => pair,
                            Err(_) => break,
                        };
                        tokio::spawn(async move {
                            let service = test_service_fn(upstream_handle);
                            let _ = hyper::server::conn::http1::Builder::new()
                                .serve_connection(TokioIo::new(stream), service)
                                .with_upgrades()
                                .await;
                        });
                    }
                });
            })
            .expect("upstream thread spawns");
        addr_rx.recv().expect("upstream reports its address")
    }

    /// One upstream response: the request's facts as JSON, or a 101 +
    /// byte-echo tunnel for upgrade requests.
    async fn upstream_handle(req: Request<Incoming>) -> Result<Response<ProxyBody>, Infallible> {
        if wants_upgrade(req.headers()) {
            let on_upgraded = hyper::upgrade::on(req);
            tokio::spawn(async move {
                if let Ok(upgraded) = on_upgraded.await {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut upgraded = TokioIo::new(upgraded);
                    let mut buf = [0u8; 1024];
                    loop {
                        match upgraded.read(&mut buf).await {
                            Ok(0) | Err(_) => break,
                            Ok(n) => {
                                if upgraded.write_all(&buf[..n]).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                }
            });
            return Ok(Response::builder()
                .status(StatusCode::SWITCHING_PROTOCOLS)
                .header(CONNECTION, "Upgrade")
                .header(UPGRADE, "websocket")
                .body(empty_body())
                .expect("101 builds"));
        }
        let (parts, body) = req.into_parts();
        let bytes = body.collect().await.ok().map(|c| c.to_bytes());
        let payload = serde_json::json!({
            "method": parts.method.as_str(),
            "uri": parts.uri.to_string(),
            "body": bytes
                .map(|b| String::from_utf8_lossy(&b).to_string())
                .unwrap_or_default(),
            "probe": parts
                .headers
                .get("x-probe")
                .and_then(|v| v.to_str().ok())
                .unwrap_or(""),
            "host": parts
                .headers
                .get(HOST)
                .and_then(|v| v.to_str().ok())
                .unwrap_or(""),
        });
        Ok(Response::new(full_body(payload.to_string())))
    }

    fn start_test_gateway(
        chain: Vec<CertificateDer<'static>>,
        key: PrivateKeyDer<'static>,
        upstream: SocketAddr,
        max_connections: usize,
    ) -> GatewayHandle {
        start_gateway(
            GatewayConfig {
                bind_addr: "127.0.0.1:0".parse().unwrap(),
                upstream,
                chain,
                key,
                max_connections,
            },
            Arc::new(|_message| {}),
        )
        .expect("test gateway starts")
    }

    /// One gateway + its matching client roots — the test CA is
    /// generated once and trusted only by the returned store.
    fn test_gateway(
        upstream: SocketAddr,
        max_connections: usize,
    ) -> (GatewayHandle, rustls::RootCertStore) {
        let (chain, key, roots) = test_material();
        (
            start_test_gateway(chain, key, upstream, max_connections),
            roots,
        )
    }

    /// A connected, timeout-configured synchronous TLS client trusting
    /// only `roots` — the shared first half of every hand-rolled test
    /// client (round trips, WebSocket holders, upgrade flows).
    fn tls_client(
        addr: SocketAddr,
        server_name: &str,
        roots: &rustls::RootCertStore,
    ) -> rustls::StreamOwned<rustls::ClientConnection, TcpStream> {
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let config = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_root_certificates(roots.clone())
            .with_no_client_auth();
        let name = rustls::pki_types::ServerName::try_from(server_name.to_string()).unwrap();
        let stream = TcpStream::connect(addr).expect("gateway reachable");
        stream.set_read_timeout(Some(PROBE_TIMEOUT)).unwrap();
        rustls::StreamOwned::new(
            rustls::ClientConnection::new(Arc::new(config), name).unwrap(),
            stream,
        )
    }

    /// Reads one HTTP response's headers (through the terminating blank
    /// line) byte by byte — the 101 handshake read every WebSocket test
    /// performs before the tunnel turns opaque.
    fn read_headers<IO: std::io::Read>(io: &mut IO) -> String {
        let mut header_buf = Vec::new();
        let mut byte = [0u8; 1];
        while !header_buf.ends_with(b"\r\n\r\n") {
            io.read_exact(&mut byte).expect("response header byte");
            header_buf.push(byte[0]);
        }
        String::from_utf8_lossy(&header_buf).into_owned()
    }

    /// A synchronous TLS client speaking to the gateway: writes the
    /// raw request, reads everything to EOF (Connection: close).
    fn tls_round_trip(
        addr: SocketAddr,
        server_name: &str,
        roots: &rustls::RootCertStore,
        request: &str,
    ) -> String {
        let mut tls = tls_client(addr, server_name, roots);
        tls.write_all(request.as_bytes()).expect("request sent");
        let mut response = String::new();
        tls.read_to_string(&mut response).expect("response read");
        response
    }

    fn get_request(path_query: &str, headers: &[(&str, &str)]) -> String {
        let mut request = format!("GET {path_query} HTTP/1.1\r\nHost: {TEST_DOMAIN}\r\n");
        for (name, value) in headers {
            request.push_str(&format!("{name}: {value}\r\n"));
        }
        request.push_str("Connection: close\r\n\r\n");
        request
    }

    fn json_of(response: &str) -> serde_json::Value {
        let body = response
            .split_once("\r\n\r\n")
            .map(|(_, body)| body)
            .unwrap_or_default();
        serde_json::from_str(body).expect("upstream JSON body")
    }

    // ------------------------------------------------------------------
    // Forwarding fidelity
    // ------------------------------------------------------------------

    #[test]
    fn proxies_method_path_query_headers_and_body() {
        let upstream = spawn_upstream();
        let (gateway, roots) = test_gateway(upstream, MAX_CONNECTIONS);

        let request = format!(
            "POST /socket.io/?EIO=4&transport=polling HTTP/1.1\r\nHost: {TEST_DOMAIN}\r\nx-probe: band-secret\r\nConnection: close\r\nContent-Length: 9\r\n\r\n402canary"
        );
        let response = tls_round_trip(gateway.local_addr(), TEST_DOMAIN, &roots, &request);
        assert!(
            response.starts_with("HTTP/1.1 200"),
            "expected 200, got: {}",
            response.lines().next().unwrap_or_default()
        );
        let facts = json_of(&response);
        assert_eq!(facts["method"], "POST");
        // Path AND query survive the tunnel untouched.
        assert_eq!(facts["uri"], "/socket.io/?EIO=4&transport=polling");
        assert_eq!(facts["body"], "402canary");
        assert_eq!(facts["probe"], "band-secret");
        // The phone's Host travels verbatim (transparent forwarding —
        // the project never guesses origins from ports, §15).
        assert_eq!(facts["host"], TEST_DOMAIN);

        gateway.shutdown();
    }

    #[test]
    fn tunnels_websocket_upgrade_and_echoes_bytes() {
        let upstream = spawn_upstream();
        let (gateway, roots) = test_gateway(upstream, MAX_CONNECTIONS);
        let addr = gateway.local_addr();
        let mut tls = tls_client(addr, TEST_DOMAIN, &roots);

        let handshake = format!(
            "GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: {TEST_DOMAIN}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
        );
        tls.write_all(handshake.as_bytes()).expect("handshake sent");

        // Read the 101 + headers.
        let headers = read_headers(&mut tls);
        assert!(headers.starts_with("HTTP/1.1 101"), "got: {headers}");
        assert!(headers.to_lowercase().contains("upgrade: websocket"));

        // After the 101 the tunnel is opaque bytes — echo proves both
        // directions survive the gateway unmodified.
        tls.write_all(b"hello-band").expect("payload sent");
        let mut echoed = [0u8; 10];
        tls.read_exact(&mut echoed).expect("payload echoed");
        assert_eq!(&echoed, b"hello-band");

        gateway.shutdown();
    }

    #[test]
    fn over_capacity_connections_get_503() {
        let upstream = spawn_upstream();
        // Capacity one: an open WebSocket holds the only permit.
        let (gateway, roots) = test_gateway(upstream, 1);
        let addr = gateway.local_addr();

        let holder_roots = roots.clone();
        let (ws_ready_tx, ws_ready_rx) = std::sync::mpsc::channel::<()>();
        let open_ws = std::thread::spawn(move || {
            let mut tls = tls_client(addr, TEST_DOMAIN, &holder_roots);
            let handshake = format!(
                "GET /socket.io/ HTTP/1.1\r\nHost: {TEST_DOMAIN}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
            );
            tls.write_all(handshake.as_bytes()).expect("handshake sent");
            let headers = read_headers(&mut tls);
            assert!(headers.starts_with("HTTP/1.1 101"), "got: {headers}");
            // The permit is held now — tell the probing side.
            ws_ready_tx.send(()).expect("ws-ready channel open");
            // Hold the upgraded connection open for the probe window.
            std::thread::sleep(Duration::from_millis(1500));
        });

        // Wait until the WS holder actually owns the only permit.
        ws_ready_rx
            .recv_timeout(PROBE_TIMEOUT)
            .expect("the websocket holder reaches its 101");

        let response = tls_round_trip(
            gateway.local_addr(),
            TEST_DOMAIN,
            &roots,
            &get_request("/__pnds/health", &[]),
        );
        assert!(
            response.starts_with("HTTP/1.1 503"),
            "the capped connection must get 503, got: {}",
            response.lines().next().unwrap_or_default()
        );
        open_ws.join().expect("ws holder finishes");
        gateway.shutdown();
    }

    #[test]
    fn upstream_down_answers_503_not_silence() {
        // Nothing listens on the upstream port.
        let dead_upstream = {
            let probe = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let addr = probe.local_addr().unwrap();
            drop(probe);
            addr
        };
        let (gateway, roots) = test_gateway(dead_upstream, MAX_CONNECTIONS);
        let response = tls_round_trip(
            gateway.local_addr(),
            TEST_DOMAIN,
            &roots,
            &get_request("/__pnds/health", &[]),
        );
        assert!(response.starts_with("HTTP/1.1 503"));
        gateway.shutdown();
    }

    /// #141: an occupied port is a definite, synchronous start failure —
    /// the error names the address, nothing is left running, and the port
    /// is bindable again the moment the occupier leaves (the Retry flow's
    /// precondition).
    #[test]
    fn port_conflict_is_a_definite_start_failure_and_rebinds_once_free() {
        let upstream = spawn_upstream();
        let (chain, key, _roots) = test_material();
        let bind_addr: SocketAddr = "127.0.0.1:0".parse().unwrap();
        // Probe a free port, then hold it as the foreign occupier.
        let probe = std::net::TcpListener::bind(bind_addr).unwrap();
        let occupied = probe.local_addr().unwrap();

        let err = start_gateway(
            GatewayConfig {
                bind_addr: occupied,
                upstream,
                chain: chain.clone(),
                key: key.clone_key(),
                max_connections: MAX_CONNECTIONS,
            },
            Arc::new(|_| {}),
        )
        .map(|handle| handle.shutdown())
        .expect_err("the occupied port must fail the start");
        assert!(
            err.to_lowercase().contains("listen"),
            "the error should name the listen failure: {err}"
        );

        // The occupier leaves; the very same address binds now.
        drop(probe);
        let gateway = start_gateway(
            GatewayConfig {
                bind_addr: occupied,
                upstream,
                chain,
                key,
                max_connections: MAX_CONNECTIONS,
            },
            Arc::new(|_| {}),
        )
        .expect("the freed port binds again");
        assert_eq!(gateway.local_addr().port(), occupied.port());
        gateway.shutdown();
    }

    /// #141: the Socket.IO client shape — one polling round trip, then a
    /// SEPARATE connection forcing the WebSocket upgrade — survives the
    /// gateway end to end (the messages and their naming are the
    /// upstream's; the gateway changes nothing).
    #[test]
    fn socketio_polling_then_forced_websocket_flow_survives() {
        let upstream = spawn_upstream();
        let (gateway, roots) = test_gateway(upstream, MAX_CONNECTIONS);
        let addr = gateway.local_addr();

        // Handshake poll: the engine.io polling request.
        let poll = tls_round_trip(
            addr,
            TEST_DOMAIN,
            &roots,
            &get_request("/socket.io/?EIO=4&transport=polling", &[]),
        );
        assert!(poll.starts_with("HTTP/1.1 200"), "got: {poll}");
        let facts = json_of(&poll);
        assert_eq!(facts["uri"], "/socket.io/?EIO=4&transport=polling");

        // The upgrade: a fresh TLS connection forcing the websocket
        // transport (exactly what the engine.io client does).
        let mut tls = tls_client(addr, TEST_DOMAIN, &roots);
        let upgrade = format!(
            "GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: {TEST_DOMAIN}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
        );
        tls.write_all(upgrade.as_bytes()).expect("upgrade sent");
        let headers = read_headers(&mut tls);
        assert!(headers.starts_with("HTTP/1.1 101"), "got: {headers}");
        let frame = b"42[\"band\",\"ready\"]";
        tls.write_all(frame).expect("control frame sent");
        let mut echoed = vec![0u8; frame.len()];
        tls.read_exact(&mut echoed).expect("control frame echoed");
        assert_eq!(&echoed, frame);

        gateway.shutdown();
    }

    /// #141: Stop closes ACTIVE tunnels, not just the listener — an open
    /// WebSocket through the entry observes the shutdown as an EOF within
    /// a bounded window (phones see a clean disconnect, never a wedged
    /// socket into the next performance's entry).
    #[test]
    fn shutdown_closes_active_websocket_tunnels() {
        let upstream = spawn_upstream();
        let (gateway, roots) = test_gateway(upstream, MAX_CONNECTIONS);
        let addr = gateway.local_addr();

        let mut tls = tls_client(addr, TEST_DOMAIN, &roots);
        let handshake = format!(
            "GET /socket.io/ HTTP/1.1\r\nHost: {TEST_DOMAIN}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
        );
        tls.write_all(handshake.as_bytes()).expect("handshake sent");
        let headers = read_headers(&mut tls);
        assert!(headers.starts_with("HTTP/1.1 101"), "got: {headers}");
        // The tunnel is up and echoing.
        tls.write_all(b"still-here").expect("payload sent");
        let mut echoed = [0u8; 10];
        tls.read_exact(&mut echoed).expect("payload echoed");
        assert_eq!(&echoed, b"still-here");

        gateway.shutdown();
        // The next read observes the closure — EOF (0 bytes) or a TLS/TCP
        // error, but never silence past the window.
        let mut saw_closure = false;
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut buf = [0u8; 8];
        while std::time::Instant::now() < deadline {
            match tls.read(&mut buf) {
                Ok(0) | Err(_) => {
                    saw_closure = true;
                    break;
                }
                Ok(_n) => continue,
            }
        }
        assert!(
            saw_closure,
            "an active tunnel must be closed by shutdown, not left hanging"
        );
    }

    #[test]
    fn shutdown_releases_the_listener_and_connections() {
        let upstream = spawn_upstream();
        let (gateway, _roots) = test_gateway(upstream, MAX_CONNECTIONS);
        let addr = gateway.local_addr();
        gateway.shutdown();

        let mut refused = false;
        for _ in 0..20 {
            match TcpStream::connect_timeout(&addr, Duration::from_millis(200)) {
                Ok(_) => std::thread::sleep(Duration::from_millis(100)),
                Err(_) => {
                    refused = true;
                    break;
                }
            }
        }
        assert!(refused, "the entry port must be released after shutdown");
    }

    /// The accept loop's fatal-error path (listener death) is not
    /// reachable through the public API from outside the process, so
    /// this pins the property the session actually depends on day to
    /// day: a healthy gateway reports NOTHING through the failure sink
    /// (no spurious entry faults). The consumer side of the sink —
    /// `mark_entry_failure`'s generation-guarded, session-preserving
    /// update — is pinned in the session tests.
    #[test]
    fn idle_gateway_reports_no_spurious_failures() {
        let upstream = spawn_upstream();
        let failures = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let sink = {
            let failures = Arc::clone(&failures);
            Arc::new(move |message: String| failures.lock().unwrap().push(message)) as FailureSink
        };
        let (chain, key, _roots) = test_material();
        let gateway = start_gateway(
            GatewayConfig {
                bind_addr: "127.0.0.1:0".parse().unwrap(),
                upstream,
                chain,
                key,
                max_connections: MAX_CONNECTIONS,
            },
            sink,
        )
        .expect("gateway starts");
        std::thread::sleep(Duration::from_millis(200));
        assert!(
            failures.lock().unwrap().is_empty(),
            "an idle gateway must not report failures"
        );
        gateway.shutdown();
    }

    // ------------------------------------------------------------------
    // Probe
    // ------------------------------------------------------------------

    #[test]
    fn probe_succeeds_through_a_healthy_gateway() {
        let upstream = spawn_upstream();
        let (gateway, roots) = test_gateway(upstream, MAX_CONNECTIONS);
        probe_tls_http(gateway.local_addr(), TEST_DOMAIN, &roots, PROBE_TIMEOUT)
            .expect("the healthy entry probes clean");
        gateway.shutdown();
    }

    #[test]
    fn probe_rejects_a_name_the_certificate_does_not_cover() {
        let upstream = spawn_upstream();
        let (gateway, roots) = test_gateway(upstream, MAX_CONNECTIONS);
        let err = probe_tls_http(gateway.local_addr(), "other.local", &roots, PROBE_TIMEOUT)
            .expect_err("a mismatched name must fail the probe");
        assert!(
            err.to_lowercase().contains("certificate") || err.to_lowercase().contains("tls"),
            "the error should name the TLS problem: {err}"
        );
        gateway.shutdown();
    }

    #[test]
    fn probe_rejects_an_untrusted_certificate() {
        let upstream = spawn_upstream();
        let (gateway, _roots) = test_gateway(upstream, MAX_CONNECTIONS);
        // A root store with nothing in it — the test CA is trusted
        // only by the client that installed it, and this one didn't.
        let empty_roots = rustls::RootCertStore::empty();
        assert!(probe_tls_http(
            gateway.local_addr(),
            TEST_DOMAIN,
            &empty_roots,
            PROBE_TIMEOUT
        )
        .is_err());
        gateway.shutdown();
    }

    #[test]
    fn probe_rejects_a_dead_upstream() {
        let dead_upstream = {
            let probe = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let addr = probe.local_addr().unwrap();
            drop(probe);
            addr
        };
        let (gateway, roots) = test_gateway(dead_upstream, MAX_CONNECTIONS);
        assert!(
            probe_tls_http(gateway.local_addr(), TEST_DOMAIN, &roots, PROBE_TIMEOUT).is_err(),
            "a 503 from the entry must not read as healthy"
        );
        gateway.shutdown();
    }

    // ------------------------------------------------------------------
    // Header rules
    // ------------------------------------------------------------------

    #[test]
    fn hop_by_hop_headers_are_stripped_but_upgrade_pair_survives() {
        let strip = |name: &str, keep: bool| {
            is_hop_by_hop(&HeaderName::from_bytes(name.as_bytes()).unwrap(), keep)
        };
        for name in [
            "keep-alive",
            "proxy-authenticate",
            "proxy-authorization",
            "te",
            "trailer",
            "transfer-encoding",
        ] {
            assert!(strip(name, false), "{name} is hop-by-hop");
            assert!(
                strip(name, true),
                "{name} stays hop-by-hop for upgrades too"
            );
        }
        // The upgrade handshake pair survives — that is the tunnel.
        assert!(!strip("connection", true));
        assert!(!strip("upgrade", true));
        assert!(strip("connection", false));
        assert!(strip("upgrade", false));
        assert!(!strip("host", false));
        assert!(!strip("content-type", false));
        assert!(!strip("sec-websocket-key", true));
    }
}
