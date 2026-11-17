//! App-owned LAN participation entry. The score server remains private to
//! the selected run; every request carries the Client's confirmed context.

use std::convert::Infallible;
use std::net::{Ipv4Addr, SocketAddr, TcpListener};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::client::legacy::Client;
use hyper_util::rt::{TokioExecutor, TokioIo};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::lan_discovery::LanNodeRole;
use crate::project::readme::ParticipationReadmes;

mod browser;
#[cfg(test)]
mod browser_tests;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostInfo {
    pub protocol_version: u32,
    pub host_id: String,
    pub node_name: String,
    pub role: LanNodeRole,
    pub performance: Option<HostPerformance>,
}

impl HostInfo {
    fn for_browser(&self) -> Self {
        let mut visible = self.clone();
        if visible.role != LanNodeRole::Host {
            visible.performance = None;
        }
        visible
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostPerformance {
    pub project_id: String,
    pub performance_id: String,
    pub project_name: String,
    pub performer_url: String,
    pub supports_performer_url: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub browser_participation: Option<u32>,
}

pub(crate) struct HostRun<'a> {
    pub project_root: &'a Path,
    pub project_name: &'a str,
    pub performer_port: u16,
    pub supports_performer_url: bool,
    pub browser_participation: Option<u32>,
}

struct EntryState {
    info: HostInfo,
    upstream: Option<SocketAddr>,
    error: Option<String>,
    browser_grant: Option<String>,
    readmes: ParticipationReadmes,
    readme_cover: Option<(&'static str, Bytes)>,
}

struct Server {
    shutdown: tokio::sync::watch::Sender<bool>,
    done: std::sync::mpsc::Receiver<()>,
    thread: std::thread::JoinHandle<()>,
}

/// The bound listener stays owned after Stop, so an online Host can report
/// an explicitly ended performance. A fresh private runtime per run means
/// Stop also destroys upgraded tunnels before another project can be routed.
pub(crate) struct HostEntry {
    listener: TcpListener,
    port_changed: bool,
    state: Arc<Mutex<EntryState>>,
    server: Mutex<Option<Server>>,
}

#[derive(Debug)]
pub(crate) enum HostEntryProbeError {
    Transient(String),
    Fatal(String),
}

impl HostEntryProbeError {
    fn transport(stage: &str, error: ureq::Error) -> Self {
        let message = format!("participation.errors.hostEntryRuntime: {stage} failed: {error}");
        match error {
            ureq::Error::Timeout(_) | ureq::Error::Io(_) | ureq::Error::ConnectionFailed => {
                Self::Transient(message)
            }
            _ => Self::Fatal(message),
        }
    }
}

fn read_probe_response(
    response: Result<Response<ureq::Body>, ureq::Error>,
    endpoint: &str,
    limit: u64,
) -> Result<Vec<u8>, HostEntryProbeError> {
    let response = response
        .map_err(|error| HostEntryProbeError::transport(&format!("{endpoint} request"), error))?;
    let status = response.status();
    if status != StatusCode::OK {
        let message =
            format!("participation.errors.hostEntryRuntime: {endpoint} returned HTTP {status}");
        return Err(
            if status.is_server_error()
                || matches!(
                    status,
                    StatusCode::REQUEST_TIMEOUT | StatusCode::TOO_MANY_REQUESTS
                )
            {
                HostEntryProbeError::Transient(message)
            } else {
                HostEntryProbeError::Fatal(message)
            },
        );
    }
    response
        .into_body()
        .with_config()
        .limit(limit)
        .read_to_vec()
        .map_err(|error| HostEntryProbeError::transport(&format!("{endpoint} response"), error))
}

impl HostEntry {
    pub(crate) fn bind(
        app_data: &Path,
        node_name: &str,
        bind_ip: Ipv4Addr,
    ) -> Result<Self, String> {
        let node_name = validate_node_name(node_name)?;
        let identity_path = app_data.join("participation-host.json");
        let host_id = if identity_path.exists() {
            let bytes = std::fs::read(&identity_path)
                .map_err(|error| format!("participation.errors.hostIdentityRead: {error}"))?;
            let id: String = serde_json::from_slice(&bytes)
                .map_err(|error| format!("participation.errors.hostIdentityInvalid: {error}"))?;
            if id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err("participation.errors.hostIdentityInvalid".into());
            }
            id
        } else {
            let id = random_id()?;
            std::fs::create_dir_all(app_data)
                .map_err(|error| format!("participation.errors.hostIdentitySave: {error}"))?;
            // A second App instance must never silently replace an identity.
            let mut file = tempfile::NamedTempFile::new_in(app_data)
                .map_err(|error| format!("participation.errors.hostIdentitySave: {error}"))?;
            use std::io::Write as _;
            file.write_all(serde_json::to_string(&id).unwrap().as_bytes())
                .and_then(|()| file.as_file().sync_all())
                .map_err(|error| format!("participation.errors.hostIdentitySave: {error}"))?;
            file.persist_noclobber(&identity_path)
                .map_err(|error| format!("participation.errors.hostIdentitySave: {error}"))?;
            std::fs::File::open(app_data)
                .and_then(|directory| directory.sync_all())
                .map_err(|error| format!("participation.errors.hostIdentitySave: {error}"))?;
            id
        };
        let port_path = app_data.join("participation-host-port.json");
        let preferred = match std::fs::read(&port_path) {
            Ok(bytes) => serde_json::from_slice::<u16>(&bytes)
                .ok()
                .filter(|port| *port > 0)
                .ok_or("participation.errors.hostEntryBind: invalid saved entry port")?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
            Err(error) => return Err(format!("participation.errors.hostEntryBind: {error}")),
        };
        let listener = crate::project::ports::bind_available_listener(bind_ip, preferred)
            .map_err(|error| format!("participation.errors.hostEntryBind: {error}"))?;
        let mut saved_port = tempfile::NamedTempFile::new_in(app_data)
            .map_err(|error| format!("participation.errors.hostEntryBind: {error}"))?;
        use std::io::Write as _;
        saved_port
            .write_all(
                listener
                    .local_addr()
                    .map_err(|error| error.to_string())?
                    .port()
                    .to_string()
                    .as_bytes(),
            )
            .and_then(|()| saved_port.as_file().sync_all())
            .map_err(|error| format!("participation.errors.hostEntryBind: {error}"))?;
        saved_port
            .persist(&port_path)
            .map_err(|error| format!("participation.errors.hostEntryBind: {error}"))?;
        std::fs::File::open(app_data)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("participation.errors.hostEntryBind: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("participation.errors.hostEntryRuntime: {error}"))?;
        let port_changed = preferred != 0
            && listener
                .local_addr()
                .map_err(|error| error.to_string())?
                .port()
                != preferred;
        let entry = Self {
            listener,
            port_changed,
            state: Arc::new(Mutex::new(EntryState {
                info: HostInfo {
                    protocol_version: 1,
                    host_id,
                    node_name: node_name.into(),
                    role: LanNodeRole::Host,
                    performance: None,
                },
                upstream: None,
                error: None,
                browser_grant: None,
                readmes: ParticipationReadmes::default(),
                readme_cover: None,
            })),
            server: Mutex::new(None),
        };
        *entry
            .server
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(entry.spawn_server()?);
        Ok(entry)
    }

    pub(crate) fn local_addr(&self) -> SocketAddr {
        self.listener
            .local_addr()
            .expect("owned bound participation listener")
    }

    pub(crate) fn port_changed(&self) -> bool {
        self.port_changed
    }

    pub(crate) fn url(&self) -> String {
        format!("http://{}/", self.local_addr())
    }

    pub(crate) fn info(&self) -> HostInfo {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .info
            .clone()
    }

    pub(crate) fn failure(&self) -> Option<String> {
        let reported = self
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .error
            .clone();
        if reported.is_some() {
            return reported;
        }
        let server = self
            .server
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if server
            .as_ref()
            .is_none_or(|server| server.thread.is_finished())
        {
            Some("participation.errors.hostEntryRuntime".into())
        } else {
            None
        }
    }

    /// Verify the public Client metadata and actual context-gated forwarding,
    /// independently of the score child's direct health. Never follows redirects
    /// or changes ports.
    pub(crate) fn probe(
        &self,
    ) -> Result<crate::project::session::HealthPayload, HostEntryProbeError> {
        if let Some(error) = self.failure() {
            return Err(HostEntryProbeError::Fatal(error));
        }
        let info = self.info();
        let performance = info.performance.as_ref().ok_or_else(|| {
            HostEntryProbeError::Fatal(
                "participation.errors.hostEntryRuntime: no current forwarding context".into(),
            )
        })?;
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .proxy(None)
            .max_redirects(0)
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_millis(800)))
            .build()
            .into();
        let bytes = read_probe_response(
            agent
                .get(format!("{}__pnds/participation", self.url()))
                .header("X-PNDS-Native-Client", "1")
                .call(),
            "metadata",
            64 * 1024,
        )?;
        let metadata =
            crate::participation_client::parse_host_metadata(&bytes).map_err(|error| {
                HostEntryProbeError::Fatal(format!(
                    "participation.errors.hostEntryRuntime: metadata validation failed: {error}"
                ))
            })?;
        if metadata.protocol_version != info.protocol_version
            || metadata.host_id != info.host_id
            || !metadata.performance.as_ref().is_some_and(|actual| {
                actual.project_id == performance.project_id
                    && actual.performance_id == performance.performance_id
                    && actual.project_name == performance.project_name
                    && actual.performer_url == performance.performer_url
                    && actual.supports_performer_url == performance.supports_performer_url
            })
        {
            return Err(HostEntryProbeError::Fatal(
                "participation.errors.hostEntryRuntime: metadata does not match this Host performance".into(),
            ));
        }
        let bytes = read_probe_response(
            agent
                .get(format!("{}__pnds/health", self.url()))
                .header("X-PNDS-Host-Id", &info.host_id)
                .header("X-PNDS-Project-Id", &performance.project_id)
                .header("X-PNDS-Performance-Id", &performance.performance_id)
                .call(),
            "forwarded health",
            256 * 1024,
        )?;
        serde_json::from_slice(&bytes).map_err(|error| {
            HostEntryProbeError::Fatal(format!(
                "participation.errors.hostEntryRuntime: forwarded health validation failed: {error}"
            ))
        })
    }

    /// Revoke forwarding and close active HTTP/WS connections. Retain the
    /// bound listener and fault; only an explicit stop/restart recreates service.
    pub(crate) fn suspend(&self, message: &str) -> Result<(), String> {
        let mut server = self
            .server
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            state.upstream = None;
            state.error = Some(message.into());
        }
        Self::stop_server(&mut server)
    }

    pub(crate) fn set_node_name(&self, node_name: &str) -> Result<(), String> {
        let name = validate_node_name(node_name)?;
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .info
            .node_name = name.into();
        Ok(())
    }

    pub(crate) fn set_idle_role(&self, role: LanNodeRole) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.info.performance.is_none() {
            state.info.role = role;
        }
    }

    #[cfg(test)]
    pub(crate) fn begin(&self, run: HostRun<'_>) -> Result<(), String> {
        self.begin_for_role(run, LanNodeRole::Host)
    }

    pub(crate) fn begin_for_role(&self, run: HostRun<'_>, role: LanNodeRole) -> Result<(), String> {
        let root = std::fs::canonicalize(run.project_root)
            .map_err(|error| format!("participation.errors.hostProjectIdentity: {error}"))?;
        use std::os::unix::fs::MetadataExt as _;
        let physical_root = std::fs::metadata(&root)
            .map_err(|error| format!("participation.errors.hostProjectIdentity: {error}"))?;
        let readmes = ParticipationReadmes::capture(&root);
        let readme_cover = crate::project::cover::capture_participation_cover(&root)
            .map(|(mime, bytes)| (mime, Bytes::from(bytes)));
        let mut server = self
            .server
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        self.clear_run();
        Self::stop_server(&mut server)?;
        {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            let mut digest = Sha256::new();
            digest.update(state.info.host_id.as_bytes());
            digest.update([0]);
            digest.update(root.as_os_str().as_encoded_bytes());
            digest.update(physical_root.dev().to_le_bytes());
            digest.update(physical_root.ino().to_le_bytes());
            state.error = None;
            state.info.role = role;
            state.info.performance = Some(HostPerformance {
                project_id: format!("{:x}", digest.finalize()),
                performance_id: random_id()?,
                project_name: run.project_name.into(),
                performer_url: self.url(),
                supports_performer_url: run.supports_performer_url,
                browser_participation: run.browser_participation,
            });
            state.readmes = readmes;
            state.readme_cover = readme_cover;
            state.upstream = Some(SocketAddr::from((Ipv4Addr::LOCALHOST, run.performer_port)));
        }
        match self.spawn_server() {
            Ok(running) => {
                *server = Some(running);
                Ok(())
            }
            Err(error) => {
                self.clear_run();
                self.state
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner())
                    .error = Some(error.clone());
                Err(error)
            }
        }
    }

    pub(crate) fn stop(&self) -> Result<(), String> {
        let mut server = self
            .server
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        self.clear_run();
        Self::stop_server(&mut server)?;
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .error = None;
        *server = Some(self.spawn_server()?);
        Ok(())
    }

    fn clear_run(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.info.performance = None;
        state.upstream = None;
        state.browser_grant = None;
        state.readmes = ParticipationReadmes::default();
        state.readme_cover = None;
    }

    fn stop_server(server: &mut Option<Server>) -> Result<(), String> {
        if let Some(running) = server.take() {
            let _ = running.shutdown.send(true);
            if running.done.recv_timeout(Duration::from_secs(4)).is_err() {
                *server = Some(running);
                return Err("participation.errors.hostCleanup".into());
            }
            running
                .thread
                .join()
                .map_err(|_| "participation.errors.hostEntryRuntime")?;
        }
        Ok(())
    }

    fn spawn_server(&self) -> Result<Server, String> {
        let listener = self
            .listener
            .try_clone()
            .map_err(|error| format!("participation.errors.hostEntryRuntime: {error}"))?;
        let state = Arc::clone(&self.state);
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|error| format!("participation.errors.hostEntryRuntime: {error}"))?;
        let (shutdown, mut stopped) = tokio::sync::watch::channel(false);
        let (done_tx, done) = std::sync::mpsc::channel();
        let thread = std::thread::Builder::new()
            .name("pnds-participation-host".into())
            .spawn(move || {
                runtime.block_on(async move {
                    let listener = match tokio::net::TcpListener::from_std(listener) {
                        Ok(listener) => listener,
                        Err(error) => {
                            let mut state =
                                state.lock().unwrap_or_else(|poison| poison.into_inner());
                            state.upstream = None;
                            state.error =
                                Some(format!("participation.errors.hostEntryRuntime: {error}"));
                            return;
                        }
                    };
                    let client = Client::builder(TokioExecutor::new()).build_http();
                    let capacity =
                        Arc::new(tokio::sync::Semaphore::new(crate::gateway::MAX_CONNECTIONS));
                    // The Host probes the real public address. Keep a bounded reserve
                    // for same-host traffic so LAN clients cannot crowd out the probe.
                    let local_capacity = Arc::new(tokio::sync::Semaphore::new(2));
                    loop {
                        let connection = tokio::select! {
                            biased;
                            _ = stopped.changed() => break,
                            accepted = listener.accept() => accepted,
                        };
                        let (stream, peer) = match connection {
                            Ok(connection) => connection,
                            Err(error) => {
                                let mut state =
                                    state.lock().unwrap_or_else(|poison| poison.into_inner());
                                state.upstream = None;
                                state.error =
                                    Some(format!("participation.errors.hostEntryRuntime: {error}"));
                                break;
                            }
                        };
                        let permit = capacity.clone().try_acquire_owned().ok().or_else(|| {
                            if stream.local_addr().ok()?.ip() != peer.ip() {
                                return None;
                            }
                            local_capacity.clone().try_acquire_owned().ok()
                        });
                        let Some(permit) = permit else {
                            continue;
                        };
                        let slot = Arc::new(Mutex::new(Some(permit)));
                        let state = Arc::clone(&state);
                        let client = client.clone();
                        tokio::spawn(async move {
                            let service = service_fn(move |mut request: Request<Incoming>| {
                                let decision = {
                                    let mut state =
                                        state.lock().unwrap_or_else(|error| error.into_inner());
                                    route(&mut state, &mut request)
                                };
                                let client = client.clone();
                                let slot = Arc::clone(&slot);
                                async move {
                                    match decision {
                                        Route::Reply(response) => Ok::<_, Infallible>(response),
                                        Route::Forward(upstream) => {
                                            crate::gateway::proxy(request, client, upstream, slot)
                                                .await
                                        }
                                    }
                                }
                            });
                            let _ = hyper::server::conn::http1::Builder::new()
                                .serve_connection(TokioIo::new(stream), service)
                                .with_upgrades()
                                .await;
                        });
                    }
                });
                runtime.shutdown_timeout(Duration::from_secs(2));
                let _ = done_tx.send(());
            })
            .map_err(|error| format!("participation.errors.hostEntryRuntime: {error}"))?;
        Ok(Server {
            shutdown,
            done,
            thread,
        })
    }
}

impl Drop for HostEntry {
    fn drop(&mut self) {
        let server = self
            .server
            .get_mut()
            .unwrap_or_else(|error| error.into_inner());
        if let Err(error) = Self::stop_server(server) {
            log::error!("{error}");
        }
    }
}

enum Route {
    Reply(Response<crate::gateway::ProxyBody>),
    Forward(SocketAddr),
}

fn reply(status: StatusCode, value: serde_json::Value) -> Route {
    let body = Full::new(Bytes::from(value.to_string()))
        .map_err(|never| match never {})
        .boxed();
    Route::Reply(
        Response::builder()
            .status(status)
            .header("content-type", "application/json")
            .header("cache-control", "no-store")
            .body(body)
            .expect("static participation response"),
    )
}

fn route(state: &mut EntryState, request: &mut Request<Incoming>) -> Route {
    if state.error.is_some() {
        return reply(
            StatusCode::SERVICE_UNAVAILABLE,
            serde_json::json!({"error":"entryUnavailable"}),
        );
    }
    if request.uri().path() == "/__pnds/participation" {
        return if request.method() == Method::GET {
            let native = request
                .headers()
                .get("x-pnds-native-client")
                .is_some_and(|value| value == "1");
            let info = if native {
                state.info.clone()
            } else {
                state.info.for_browser()
            };
            reply(StatusCode::OK, serde_json::to_value(info).unwrap())
        } else {
            reply(
                StatusCode::METHOD_NOT_ALLOWED,
                serde_json::json!({"error":"readOnly"}),
            )
        };
    }
    if request.uri().path() == "/" && !request.headers().contains_key("x-pnds-host-id") {
        return browser::landing(&state.info.for_browser(), request.headers());
    }
    if let Some(decision) = browser::route(state, request) {
        return decision;
    }
    let Some(run) = &state.info.performance else {
        return reply(
            StatusCode::GONE,
            serde_json::json!({"error":"performanceEnded"}),
        );
    };
    for (header, expected) in [
        ("x-pnds-host-id", &state.info.host_id),
        ("x-pnds-project-id", &run.project_id),
        ("x-pnds-performance-id", &run.performance_id),
    ] {
        if request
            .headers()
            .get(header)
            .and_then(|value| value.to_str().ok())
            != Some(expected.as_str())
        {
            return reply(
                StatusCode::CONFLICT,
                serde_json::json!({"error":"participationChanged"}),
            );
        }
    }
    if request.uri().path() == "/__pnds/participation/readme" {
        if request.method() != Method::GET {
            return reply(
                StatusCode::METHOD_NOT_ALLOWED,
                serde_json::json!({"error":"readOnly"}),
            );
        }
        let locale = request
            .headers()
            .get("accept-language")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        return state.readmes.for_locale(locale).map_or_else(
            || {
                reply(
                    StatusCode::NOT_FOUND,
                    serde_json::json!({"error":"readmeMissing"}),
                )
            },
            |markdown| browser::asset("text/markdown; charset=utf-8", markdown.as_bytes()),
        );
    }
    if request.uri().path() == "/__pnds/participation/readme-cover" {
        if request.method() != Method::GET {
            return reply(
                StatusCode::METHOD_NOT_ALLOWED,
                serde_json::json!({"error":"readOnly"}),
            );
        }
        return state.readme_cover.as_ref().map_or_else(
            || {
                reply(
                    StatusCode::NOT_FOUND,
                    serde_json::json!({"error":"coverMissing"}),
                )
            },
            |(mime, bytes)| browser::asset_bytes(mime, bytes.clone()),
        );
    }
    if request.uri().path() == "/__pnds/context.js" && run.browser_participation == Some(1) {
        return browser::context(&state.info, "/");
    }
    match state.upstream {
        Some(upstream) => Route::Forward(upstream),
        None => reply(
            StatusCode::GONE,
            serde_json::json!({"error":"performanceEnded"}),
        ),
    }
}

fn validate_node_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() || name.len() > 160 || name.chars().any(char::is_control) {
        return Err("participation.errors.invalidNodeName".into());
    }
    Ok(name)
}

fn random_id() -> Result<String, String> {
    let mut bytes = [0; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| "participation.errors.hostRandom")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{Ipv4Addr, TcpListener, TcpStream};

    fn get(entry: &HostEntry, path: &str, context: Option<&HostInfo>) -> String {
        let mut stream = TcpStream::connect(entry.local_addr()).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut headers = String::new();
        if let Some(info) = context {
            let run = info.performance.as_ref().unwrap();
            headers = format!(
                "X-PNDS-Host-Id: {}\r\nX-PNDS-Project-Id: {}\r\nX-PNDS-Performance-Id: {}\r\n",
                info.host_id, run.project_id, run.performance_id
            );
        }
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: test\r\n{headers}Connection: close\r\n\r\n"
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    fn probe_fixture(
        status: u16,
        metadata: impl FnOnce(&HostInfo) -> Vec<u8>,
    ) -> (HostEntry, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let info = HostInfo {
            protocol_version: 1,
            host_id: "host-a".into(),
            node_name: "Stage".into(),
            role: LanNodeRole::Host,
            performance: Some(HostPerformance {
                project_id: "project-a".into(),
                performance_id: "run-a".into(),
                project_name: "Score".into(),
                performer_url: url,
                supports_performer_url: true,
                browser_participation: None,
            }),
        };
        let metadata = metadata(&info);
        let requests = Arc::new(Mutex::new(Vec::new()));
        let observed = requests.clone();
        let serving = listener.try_clone().unwrap();
        let (shutdown, stopped) = tokio::sync::watch::channel(false);
        let (done_tx, done) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || {
            while !*stopped.borrow() {
                let (mut stream, _) = match serving.accept() {
                    Ok(connection) => connection,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(error) => panic!("probe fixture accept: {error}"),
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") && request.len() < 8192 {
                    let mut byte = [0];
                    if stream.read_exact(&mut byte).is_err() {
                        break;
                    }
                    request.push(byte[0]);
                }
                let request = String::from_utf8(request).unwrap();
                let target = request.split_whitespace().nth(1).unwrap();
                let path = reqwest::Url::parse(target)
                    .map(|url| url.path().to_string())
                    .unwrap_or_else(|_| target.to_string());
                let (status, body) = if path == "/__pnds/participation" {
                    (status, metadata.as_slice())
                } else {
                    assert_eq!(path, "/__pnds/health");
                    (200, b"{\"status\":\"ready\"}".as_slice())
                };
                observed.lock().unwrap().push(request);
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(body);
            }
            let _ = done_tx.send(());
        });
        (
            HostEntry {
                listener,
                port_changed: false,
                state: Arc::new(Mutex::new(EntryState {
                    info,
                    upstream: None,
                    error: None,
                    browser_grant: None,
                    readmes: ParticipationReadmes::default(),
                    readme_cover: None,
                })),
                server: Mutex::new(Some(Server {
                    shutdown,
                    done,
                    thread,
                })),
            },
            requests,
        )
    }

    #[test]
    fn entry_probe_checks_public_participation_before_confirmed_health() {
        for renamed in [false, true] {
            let (entry, requests) = probe_fixture(200, |info| {
                let mut info = info.clone();
                if renamed {
                    info.node_name = "Renamed stage".into();
                }
                serde_json::to_vec(&info).unwrap()
            });
            assert_eq!(entry.probe().unwrap().status, "ready");
            let requests = requests.lock().unwrap();
            assert_eq!(requests.len(), 2);
            assert!(requests[0].starts_with("GET /__pnds/participation "));
            assert!(requests[1].starts_with("GET /__pnds/health "));
            let health = requests[1].to_ascii_lowercase();
            assert!(health.contains("x-pnds-host-id: host-a\r\n"));
            assert!(health.contains("x-pnds-project-id: project-a\r\n"));
            assert!(health.contains("x-pnds-performance-id: run-a\r\n"));
        }
    }

    #[test]
    fn entry_probe_rejects_unusable_metadata_even_when_health_is_ready() {
        for (status, body, transient) in [
            (404, b"not found".to_vec(), false),
            (408, Vec::new(), true),
            (429, Vec::new(), true),
            (503, br#"{"error":"entryUnavailable"}"#.to_vec(), true),
            (200, b"<html>score page</html>".to_vec(), false),
            (200, vec![b' '; 65537], false),
        ] {
            let (entry, requests) = probe_fixture(status, |_| body);
            let error = entry.probe().expect_err("unusable metadata was accepted");
            let message = match error {
                HostEntryProbeError::Transient(message) if transient => message,
                HostEntryProbeError::Fatal(message) if !transient => message,
                error => panic!("HTTP {status} misclassified: {error:?}"),
            };
            assert!(message.starts_with("participation.errors.hostEntryRuntime: metadata "));
            let requests = requests.lock().unwrap();
            assert_eq!(requests.len(), 1);
            assert!(requests[0].starts_with("GET /__pnds/participation "));
        }
    }

    #[test]
    fn entry_probe_rejects_metadata_from_another_protocol_or_performance() {
        for (field, value) in [
            ("protocolVersion", serde_json::json!(2)),
            ("hostId", serde_json::json!("another-host")),
            ("nodeName", serde_json::json!("")),
            ("performance", serde_json::Value::Null),
            ("projectId", serde_json::json!("another-project")),
            ("performanceId", serde_json::json!("another-run")),
            ("performerUrl", serde_json::json!("http://127.0.0.1:9/")),
            ("supportsPerformerUrl", serde_json::json!(false)),
        ] {
            let (entry, requests) = probe_fixture(200, |info| {
                let mut metadata = serde_json::to_value(info).unwrap();
                if metadata.get(field).is_some() {
                    metadata[field] = value;
                } else {
                    metadata["performance"][field] = value;
                }
                serde_json::to_vec(&metadata).unwrap()
            });
            assert!(
                matches!(entry.probe(), Err(HostEntryProbeError::Fatal(_))),
                "changed participation field {field} did not fail immediately"
            );
            let requests = requests.lock().unwrap();
            assert_eq!(requests.len(), 1);
            assert!(requests[0].starts_with("GET /__pnds/participation "));
        }
    }

    #[test]
    fn host_bind_refuses_oversized_utf8_name_with_a_localizable_code_without_creating_identity() {
        let data = tempfile::tempdir().unwrap();
        let error = match HostEntry::bind(data.path(), &"很".repeat(60), Ipv4Addr::LOCALHOST) {
            Ok(_) => panic!("oversized name was accepted"),
            Err(error) => error,
        };
        assert_eq!(error, "participation.errors.invalidNodeName");
        assert!(!data.path().join("participation-host.json").exists());
        let host = HostEntry::bind(data.path(), "Stage", Ipv4Addr::LOCALHOST).unwrap();
        assert_eq!(host.info().node_name, "Stage");
    }

    #[test]
    fn entry_probe_still_checks_forwarding_when_client_connections_fill_the_public_pool() {
        use std::io::{BufRead, BufReader};

        let data = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let upstream = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let entry = HostEntry::bind(data.path(), "Stage", Ipv4Addr::LOCALHOST).unwrap();
        entry
            .begin(HostRun {
                project_root: project.path(),
                project_name: "Work",
                performer_port: upstream.local_addr().unwrap().port(),
                supports_performer_url: true,
                browser_participation: None,
            })
            .unwrap();
        let held_connections: Vec<_> = (0..crate::gateway::MAX_CONNECTIONS)
            .map(|_| {
                let mut stream = TcpStream::connect(entry.local_addr()).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                stream
                    .write_all(
                        b"GET /__pnds/participation HTTP/1.1\r\nHost: test\r\nConnection: keep-alive\r\n\r\n",
                    )
                    .unwrap();
                let mut connection = BufReader::new(stream);
                let mut status = String::new();
                connection.read_line(&mut status).unwrap();
                assert!(status.starts_with("HTTP/1.1 200"), "{status}");
                connection
            })
            .collect();

        upstream.set_nonblocking(true).unwrap();
        let responder = std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + Duration::from_secs(3);
            let stream = loop {
                match upstream.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            std::time::Instant::now() < deadline,
                            "probe never reached health"
                        );
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("health accept failed: {error}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = BufReader::new(stream);
            let mut line = String::new();
            request.read_line(&mut line).unwrap();
            assert!(line.starts_with("GET /__pnds/health "), "{line}");
            request.get_mut().write_all(
                b"HTTP/1.1 200 OK\r\nContent-Length: 18\r\nConnection: close\r\n\r\n{\"status\":\"ready\"}",
            ).unwrap();
        });
        let health = entry.probe();
        drop(held_connections);
        assert_eq!(health.unwrap().status, "ready");
        responder.join().unwrap();
    }

    #[test]
    fn confirmed_context_is_required_before_any_project_request_and_survives_host_stop() {
        let data = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let upstream = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = upstream.local_addr().unwrap().port();
        let responder = std::thread::spawn(move || {
            let (mut stream, _) = upstream.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut buffer = [0; 4096];
            let size = stream.read(&mut buffer).unwrap();
            assert!(String::from_utf8_lossy(&buffer[..size]).starts_with("GET /score?join=1 "));
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nscore",
                )
                .unwrap();
        });
        let entry = HostEntry::bind(data.path(), "Stage A", Ipv4Addr::LOCALHOST).unwrap();
        entry
            .begin(HostRun {
                project_root: project.path(),
                project_name: "Work",
                performer_port: port,
                supports_performer_url: true,
                browser_participation: None,
            })
            .unwrap();
        let original = entry.info();
        assert!(get(&entry, "/score", None).starts_with("HTTP/1.1 409"));
        assert!(get(&entry, "/score?join=1", Some(&original)).ends_with("score"));
        responder.join().unwrap();
        entry.stop().unwrap();
        assert!(
            get(&entry, "/socket.io/?transport=polling", Some(&original))
                .starts_with("HTTP/1.1 410")
        );
        let stopped = get(&entry, "/__pnds/participation", None);
        assert!(stopped.contains("\"performance\":null"));
        assert!(!stopped.contains(project.path().to_str().unwrap()));
        entry
            .begin(HostRun {
                project_root: project.path(),
                project_name: "Work",
                performer_port: port,
                supports_performer_url: true,
                browser_participation: None,
            })
            .unwrap();
        assert_ne!(
            original.performance.as_ref().unwrap().performance_id,
            entry.info().performance.as_ref().unwrap().performance_id
        );
        assert!(
            get(&entry, "/socket.io/?transport=websocket", Some(&original))
                .starts_with("HTTP/1.1 409")
        );
    }

    #[test]
    fn stop_closes_upgraded_transport_and_project_copies_need_new_confirmation() {
        let data = tempfile::tempdir().unwrap();
        let first = tempfile::tempdir().unwrap();
        let copy = tempfile::tempdir().unwrap();
        let upstream = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = upstream.local_addr().unwrap().port();
        let responder = std::thread::spawn(move || {
            let (mut stream, _) = upstream.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            assert!(String::from_utf8_lossy(&request)
                .starts_with("GET /socket.io/?transport=websocket "));
            stream.write_all(b"HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n").unwrap();
            let mut message = [0; 4];
            stream.read_exact(&mut message).unwrap();
            assert_eq!(&message, b"ping");
            stream.write_all(b"pong").unwrap();
            let mut end = [0];
            assert_eq!(stream.read(&mut end).unwrap(), 0);
        });
        let entry = HostEntry::bind(data.path(), "Stage A", Ipv4Addr::LOCALHOST).unwrap();
        entry
            .begin(HostRun {
                project_root: first.path(),
                project_name: "Same name",
                performer_port: port,
                supports_performer_url: true,
                browser_participation: None,
            })
            .unwrap();
        let before = entry.info();
        let run = before.performance.as_ref().unwrap();
        let mut socket = TcpStream::connect(entry.local_addr()).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        write!(socket, "GET /socket.io/?transport=websocket HTTP/1.1\r\nHost: test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nX-PNDS-Host-Id: {}\r\nX-PNDS-Project-Id: {}\r\nX-PNDS-Performance-Id: {}\r\n\r\n", before.host_id, run.project_id, run.performance_id).unwrap();
        let mut response = Vec::new();
        while !response.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            socket.read_exact(&mut byte).unwrap();
            response.push(byte[0]);
        }
        assert!(response.starts_with(b"HTTP/1.1 101"));
        socket.write_all(b"ping").unwrap();
        let mut pong = [0; 4];
        socket.read_exact(&mut pong).unwrap();
        assert_eq!(&pong, b"pong");
        entry.stop().unwrap();
        assert_eq!(socket.read(&mut [0]).unwrap(), 0);
        responder.join().unwrap();
        entry
            .begin(HostRun {
                project_root: copy.path(),
                project_name: "Same name",
                performer_port: port,
                supports_performer_url: true,
                browser_participation: None,
            })
            .unwrap();
        assert_ne!(run.project_id, entry.info().performance.unwrap().project_id);
        assert!(get(&entry, "/?join=1", Some(&before)).starts_with("HTTP/1.1 409"));
        let host_id = before.host_id;
        let unchanged_address = entry.url();
        entry.set_node_name("New stage name").unwrap();
        assert_eq!(entry.url(), unchanged_address);
        assert_eq!(entry.info().node_name, "New stage name");
        assert_eq!(entry.info().host_id, host_id);
        drop(entry);
        let renamed = HostEntry::bind(data.path(), "Renamed", Ipv4Addr::LOCALHOST).unwrap();
        assert_eq!(renamed.info().host_id, host_id);
        assert_eq!(renamed.info().node_name, "Renamed");
        assert!(renamed.info().performance.is_none());
    }

    #[test]
    fn recording_management_is_never_forwarded_for_a_confirmed_client() {
        let data = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let entry = HostEntry::bind(data.path(), "Stage", Ipv4Addr::LOCALHOST).unwrap();
        entry
            .begin(HostRun {
                project_root: project.path(),
                project_name: "Work",
                performer_port: 0,
                supports_performer_url: true,
                browser_participation: None,
            })
            .unwrap();
        let context = entry.info();
        assert!(
            get(&entry, "/__pnds/recording?operation=begin", Some(&context))
                .starts_with("HTTP/1.1 403")
        );
        assert!(get(&entry, "/__pnds/recording/events", Some(&context)).starts_with("HTTP/1.1 403"));
    }
    #[test]
    fn host_entry_reuses_last_actual_port_and_avoids_new_occupants() {
        use crate::project::children::with_managed_child_pids;

        let data = tempfile::tempdir().unwrap();
        let entry = HostEntry::bind(data.path(), "Stage", Ipv4Addr::LOCALHOST).unwrap();
        let address = entry.local_addr();
        let identity = entry.info().host_id;
        drop(entry);
        // Await any managed fork's exec before the original single rebind:
        // a pre-exec child may still hold the closed parent's CLOEXEC fd.
        // HostEntry::bind only queries lsof and starts threads; it does not
        // re-enter the managed-child registry lock.
        let reused =
            with_managed_child_pids(|_| HostEntry::bind(data.path(), "Stage", Ipv4Addr::LOCALHOST))
                .unwrap();
        assert_eq!(
            reused.local_addr(),
            address,
            "Host entry did not reuse its released address: {}",
            crate::test_support::tcp_endpoint_snapshot(address)
        );
        drop(reused);
        let foreign = with_managed_child_pids(|_| TcpListener::bind(address)).unwrap_or_else(|error| {
            let diagnostics = crate::test_support::tcp_endpoint_snapshot(address);
            panic!(
                "foreign fixture could not bind released Host entry {address}: {error}; kind={:?}, raw_os_error={:?}; {diagnostics}",
                error.kind(),
                error.raw_os_error()
            );
        });
        let avoided = HostEntry::bind(data.path(), "Stage", Ipv4Addr::LOCALHOST).unwrap();
        assert_ne!(avoided.local_addr(), address);
        assert_eq!(avoided.info().host_id, identity);
        assert_eq!(foreign.local_addr().unwrap(), address);
        let actual = avoided.local_addr();
        drop(avoided);
        let rebound = with_managed_child_pids(|_| TcpListener::bind(actual));
        let failure = rebound.as_ref().err();
        let diagnostics = failure.map(|_| crate::test_support::tcp_endpoint_snapshot(actual));
        assert!(
            rebound.is_ok(),
            "released Host entry {actual} could not be rebound: error={failure:?}, kind={:?}, raw_os_error={:?}; {diagnostics:?}",
            failure.map(std::io::Error::kind),
            failure.and_then(std::io::Error::raw_os_error)
        );
    }
}
