//! #174: the wire listeners — UDP and TCP on port 53 (production) or any
//! port in tests, plus the lease reaper.
//!
//! Resource bounds (spec #174「有界资源」): thread-per-packet with a
//! global concurrency cap — queries beyond the cap are dropped on the
//! floor, so a noisy or hostile LAN cannot exhaust the daemon. DNS on a
//! performance LAN is tens of queries per second; the cap exists for the
//! pathological case only.

use crate::engine::{Engine, Transport};
use std::net::{SocketAddr, TcpListener, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Max in-flight query threads across both transports.
const MAX_IN_FLIGHT: usize = 128;

/// Listener liveness, surfaced through the control plane's `status`.
#[derive(Debug, Default)]
pub struct Listeners {
    pub udp: AtomicBool,
    pub tcp: AtomicBool,
    /// Why the port-53 bind failed, when it did — the daemon stays up
    /// (control plane answers) and reports this instead of looping
    /// under launchd's KeepAlive. `None` = bound and serving.
    pub bind_error: Mutex<Option<String>>,
}

impl Listeners {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn snapshot(&self) -> (bool, bool) {
        (
            self.udp.load(Ordering::SeqCst),
            self.tcp.load(Ordering::SeqCst),
        )
    }
}

/// Parses `ip[:port]` (port defaults to 53). Rejects hostnames — the
/// upstream must be a plain address (resolving a hostname at daemon
/// runtime would create the very DNS loop this daemon exists to avoid).
pub fn parse_upstream(text: &str) -> Option<SocketAddr> {
    let text = text.trim();
    if let Ok(addr) = text.parse::<SocketAddr>() {
        return Some(addr);
    }
    let ip = text.parse::<std::net::IpAddr>().ok()?;
    Some(SocketAddr::new(ip, 53))
}

/// Serves UDP queries on `listener` until `stop` flips.
pub fn serve_udp(
    engine: Arc<Engine>,
    listener: UdpSocket,
    stop: Arc<AtomicBool>,
    listeners: Arc<Listeners>,
) -> std::thread::JoinHandle<()> {
    listener
        .set_read_timeout(Some(Duration::from_millis(200)))
        .ok();
    listeners.udp.store(true, Ordering::SeqCst);
    let in_flight = Arc::new(AtomicUsize::new(0));
    std::thread::Builder::new()
        .name("pnds-dnsd-udp".to_string())
        .spawn(move || {
            let mut buffer = [0u8; 65535];
            loop {
                if stop.load(Ordering::SeqCst) {
                    return;
                }
                let Ok((size, from)) = listener.recv_from(&mut buffer) else {
                    continue;
                };
                if in_flight.load(Ordering::SeqCst) >= MAX_IN_FLIGHT {
                    continue; // bounded resources: drop rather than die
                }
                let engine = Arc::clone(&engine);
                let in_flight = Arc::clone(&in_flight);
                // The reply goes out on the socket's own clone: the
                // listening socket stays with this loop, the worker gets
                // an owned send-only handle.
                let Ok(reply_socket) = listener.try_clone() else {
                    continue;
                };
                in_flight.fetch_add(1, Ordering::SeqCst);
                std::thread::spawn(move || {
                    let response = engine.handle_query(&buffer[..size], Transport::Udp);
                    let _ = reply_socket.send_to(&response, from);
                    in_flight.fetch_sub(1, Ordering::SeqCst);
                });
            }
        })
        .expect("udp loop spawns")
}

/// Serves TCP queries (RFC 1035 §4.2.2 length-prefixed framing) until
/// `stop` flips. Used for TC retry fallback by phone resolvers.
pub fn serve_tcp(
    engine: Arc<Engine>,
    listener: TcpListener,
    stop: Arc<AtomicBool>,
    listeners: Arc<Listeners>,
) -> std::thread::JoinHandle<()> {
    listener
        .set_nonblocking(true)
        .expect("tcp listener nonblocking");
    listeners.tcp.store(true, Ordering::SeqCst);
    let in_flight = Arc::new(AtomicUsize::new(0));
    std::thread::Builder::new()
        .name("pnds-dnsd-tcp".to_string())
        .spawn(move || loop {
            if stop.load(Ordering::SeqCst) {
                return;
            }
            match listener.accept() {
                Ok((stream, _)) => {
                    if in_flight.load(Ordering::SeqCst) >= MAX_IN_FLIGHT {
                        continue;
                    }
                    let engine = Arc::clone(&engine);
                    let in_flight = Arc::clone(&in_flight);
                    in_flight.fetch_add(1, Ordering::SeqCst);
                    std::thread::spawn(move || {
                        serve_tcp_connection(&engine, stream);
                        in_flight.fetch_sub(1, Ordering::SeqCst);
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(_) => {
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        })
        .expect("tcp loop spawns")
}

fn serve_tcp_connection(engine: &Engine, mut stream: std::net::TcpStream) {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(5))).ok();
    let mut length = [0u8; 2];
    use std::io::Read;
    if stream.read_exact(&mut length).is_err() {
        return;
    }
    let size = u16::from_be_bytes(length) as usize;
    if size == 0 {
        return;
    }
    let mut query = vec![0u8; size];
    if stream.read_exact(&mut query).is_err() {
        return;
    }
    let response = engine.handle_query(&query, Transport::Tcp);
    if response.len() > u16::MAX as usize {
        return; // impossible in practice; the codec caps at 64 KiB
    }
    let mut framed = (response.len() as u16).to_be_bytes().to_vec();
    framed.extend_from_slice(&response);
    use std::io::Write;
    let _ = stream.write_all(&framed);
}

/// Expires mappings whose holder stopped refreshing. Runs every second —
/// the reaper is a safety net for a crashed App; the healthy path
/// refreshes or clears long before the lease is up.
pub fn spawn_lease_reaper(
    engine: Arc<Engine>,
    stop: Arc<AtomicBool>,
) -> std::thread::JoinHandle<()> {
    std::thread::Builder::new()
        .name("pnds-dnsd-lease-reaper".to_string())
        .spawn(move || loop {
            if stop.load(Ordering::SeqCst) {
                return;
            }
            engine.expire_leases();
            std::thread::sleep(Duration::from_secs(1));
        })
        .expect("lease reaper spawns")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::MappingHolder;
    use std::sync::atomic::AtomicU64;
    use std::time::Duration;

    fn engine(upstreams: Vec<SocketAddr>) -> Arc<Engine> {
        Arc::new(Engine::new(
            upstreams,
            Vec::new(),
            Box::new(std::time::Instant::now),
        ))
    }

    fn query_wire(name: &str, record_type: hickory_proto::rr::RecordType, id: u16) -> Vec<u8> {
        use hickory_proto::op::{Message, MessageType, OpCode, Query};
        use hickory_proto::rr::Name;
        let mut message = Message::new(id, MessageType::Query, OpCode::Query);
        message.add_query(Query::query(Name::from_utf8(name).unwrap(), record_type));
        message.to_vec().unwrap()
    }

    #[test]
    fn parse_upstream_takes_addresses_and_default_ports() {
        assert_eq!(
            parse_upstream("223.5.5.5"),
            Some(SocketAddr::from(([223, 5, 5, 5], 53)))
        );
        assert_eq!(
            parse_upstream("223.5.5.5:5353"),
            Some(SocketAddr::from(([223, 5, 5, 5], 5353)))
        );
        assert_eq!(
            parse_upstream("[2001:db8::1]:53"),
            Some(SocketAddr::from(([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1], 53)))
        );
        // Hostnames are refused — a runtime DNS lookup would recurse.
        assert_eq!(parse_upstream("dns.example.org"), None);
        assert_eq!(parse_upstream(""), None);
    }

    #[test]
    fn udp_loop_answers_real_queries_end_to_end() {
        let engine = engine(vec![]);
        engine
            .mapping_set(
                "show.example.org",
                "192.168.11.31".parse().unwrap(),
                MappingHolder {
                    run_id: "run".to_string(),
                    generation: 1,
                },
                Duration::from_secs(60),
            )
            .unwrap();
        let listener = UdpSocket::bind(("127.0.0.1", 0)).unwrap();
        let addr = listener.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let handle = serve_udp(
            Arc::clone(&engine),
            listener,
            Arc::clone(&stop),
            Listeners::new(),
        );
        let client = UdpSocket::bind(("127.0.0.1", 0)).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        client
            .send_to(
                &query_wire("show.example.org", hickory_proto::rr::RecordType::A, 7),
                addr,
            )
            .unwrap();
        let mut buffer = [0u8; 1024];
        let (size, _) = client.recv_from(&mut buffer).unwrap();
        let answer = hickory_proto::op::Message::from_vec(&buffer[..size]).unwrap();
        assert_eq!(
            answer.response_code,
            hickory_proto::op::ResponseCode::NoError
        );
        assert_eq!(answer.answers.len(), 1);
        stop.store(true, Ordering::SeqCst);
        handle.join().unwrap();
    }

    #[test]
    fn tcp_loop_answers_the_full_length_prefixed_response() {
        let engine = engine(vec![]);
        engine
            .mapping_set(
                "show.example.org",
                "192.168.11.31".parse().unwrap(),
                MappingHolder {
                    run_id: "run".to_string(),
                    generation: 1,
                },
                Duration::from_secs(60),
            )
            .unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let addr = listener.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let handle = serve_tcp(
            Arc::clone(&engine),
            listener,
            Arc::clone(&stop),
            Listeners::new(),
        );
        let mut client = std::net::TcpStream::connect(addr).expect("tcp connect");
        client
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let query = query_wire("show.example.org", hickory_proto::rr::RecordType::A, 9);
        use std::io::{Read, Write};
        let mut framed = (query.len() as u16).to_be_bytes().to_vec();
        framed.extend_from_slice(&query);
        client.write_all(&framed).unwrap();
        let mut length = [0u8; 2];
        client.read_exact(&mut length).unwrap();
        let mut response = vec![0u8; u16::from_be_bytes(length) as usize];
        client.read_exact(&mut response).unwrap();
        let answer = hickory_proto::op::Message::from_vec(&response).unwrap();
        assert_eq!(answer.answers.len(), 1);
        stop.store(true, Ordering::SeqCst);
        handle.join().unwrap();
    }

    #[test]
    fn lease_reaper_expires_abandoned_mappings() {
        let engine = engine(vec![]);
        // An advancing clock: mapping_set observes T0, the reaper check
        // T0 + 60s — the 5s lease is long past, so the sweep fires.
        let start = std::time::Instant::now();
        let ticks = Arc::new(AtomicU64::new(0));
        let tick_count = Arc::clone(&ticks);
        let clocked = Arc::new(Engine::new(
            vec![],
            vec![],
            Box::new(move || {
                start + Duration::from_secs(60 * tick_count.fetch_add(1, Ordering::Relaxed))
            }),
        ));
        clocked
            .mapping_set(
                "show.example.org",
                "192.168.11.31".parse().unwrap(),
                MappingHolder {
                    run_id: "run".to_string(),
                    generation: 1,
                },
                crate::engine::MIN_LEASE,
            )
            .unwrap();
        assert!(clocked.expire_leases());
        // The production reaper just loops expire_leases; the loop itself
        // is a trivial sleep cycle covered by the stop flag below.
        let stop = Arc::new(AtomicBool::new(true)); // already stopped
        let handle = spawn_lease_reaper(engine, stop);
        handle.join().unwrap();
    }
}
