//! #174: the daemon control plane — a line-JSON protocol over a Unix
//! stream socket, spoken by the App (enable flows, session mapping
//! lifecycle, settings status) and by root operators.
//!
//! Authorization: every connection's peer uid must be root (0) or the
//! console user (the owner of /dev/console — the logged-in operator the
//! App runs as) for MUTATING ops; `status` is open to any local process.
//! The App never stores or handles an admin password; approval of the
//! LaunchDaemon is a one-time system dialog (spec #174).
//!
//! The op set is deliberately small and non-arbitrary: the daemon never
//! executes project scripts, shell commands, or anything beyond the
//! bounded mapping/config/status verbs below.

use crate::engine::{Engine, MappingHolder, MAPPING_ANSWER_TTL};
use hickory_proto::op::{Message, MessageType, OpCode, Query};
use hickory_proto::rr::{Name, RData, RecordType};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::Ipv4Addr;
use std::os::unix::fs::MetadataExt;
use std::os::unix::io::AsRawFd;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Ops that change daemon state — require the root or console-user peer.
const MUTATING_OPS: [&str; 6] = [
    "mapping.set",
    "mapping.refresh",
    "mapping.clear",
    "config.set",
    "verify",
    "stop",
];

/// The peer's effective uid (SO_PEERCRED equivalent on macOS:
/// getpeereuid). `None` when the credential is unavailable — treat as
/// untrusted.
pub fn peer_uid(stream: &UnixStream) -> Option<u32> {
    let mut uid: libc::uid_t = 0;
    let mut gid: libc::gid_t = 0;
    let result = unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) };
    if result == 0 {
        Some(uid)
    } else {
        None
    }
}

/// The logged-in console user's uid (the App runs as that user). Root
/// LaunchDaemons have used /dev/console ownership for exactly this since
/// before TCC; it follows the fast-user-switching console.
pub fn console_uid() -> Option<u32> {
    std::fs::metadata("/dev/console")
        .ok()
        .map(|meta| meta.uid())
}

/// One decoded request and its computed response line. Pure and testable:
/// the socket loop and the tests both call this.
pub fn handle_line(
    engine: &Engine,
    listeners: &crate::server::Listeners,
    state_path: &Path,
    restart: &AtomicBool,
    line: &str,
    peer: Option<u32>,
    shutdown: &AtomicBool,
) -> Option<String> {
    let Ok(request) = serde_json::from_str::<Value>(line) else {
        return Some(error_response(
            0,
            "invalidRequest",
            "request is not valid JSON",
        ));
    };
    let id = request.get("id").and_then(Value::as_u64).unwrap_or(0);
    let Some(op) = request.get("op").and_then(Value::as_str) else {
        return Some(error_response(id, "invalidRequest", "missing op"));
    };
    if MUTATING_OPS.contains(&op) && !authorized(peer) {
        return Some(error_response(
            id,
            "forbidden",
            "peer is not the console user or root",
        ));
    }
    match op {
        "status" => Some(status_response(engine, listeners, id)),
        "mapping.set" => mapping_set(engine, id, &request),
        "mapping.refresh" => mapping_refresh(engine, id, &request),
        "mapping.clear" => mapping_clear(engine, id, &request),
        "config.set" => config_set(engine, state_path, restart, id, &request),
        "verify" => Some(verify(engine, id, &request)),
        "stop" => {
            shutdown.store(true, Ordering::SeqCst);
            Some(ok_response(id, json!({ "stopping": true })))
        }
        other => Some(error_response(
            id,
            "invalidRequest",
            &format!("unknown op {other}"),
        )),
    }
}

fn authorized(peer: Option<u32>) -> bool {
    match peer {
        Some(0) => true,
        Some(uid) => console_uid() == Some(uid),
        None => false,
    }
}

fn ok_response(id: u64, data: Value) -> String {
    json!({ "id": id, "ok": true, "data": data }).to_string()
}

fn error_response(id: u64, code: &str, message: &str) -> String {
    json!({ "id": id, "ok": false, "code": code, "message": message }).to_string()
}

#[allow(clippy::too_many_arguments)]
fn status_response(engine: &Engine, listeners: &crate::server::Listeners, id: u64) -> String {
    let listeners_snapshot = json!({
        "udp": listeners.udp.load(Ordering::SeqCst),
        "tcp": listeners.tcp.load(Ordering::SeqCst),
    });
    let bind_error = listeners
        .bind_error
        .lock()
        .map(|guard| guard.clone())
        .ok()
        .flatten();
    let mapping = engine.mapping_snapshot();
    let mapping_json = mapping.map(|(domain, ip, run_id, generation, lease)| {
        json!({
            "domain": domain,
            "ip": ip.to_string(),
            "runId": run_id,
            "generation": generation,
            "leaseSecondsRemaining": lease,
        })
    });
    ok_response(
        id,
        json!({
            "listeners": listeners_snapshot,
            "bindError": bind_error,
            "upstreams": engine.upstreams().iter().map(|a| a.to_string()).collect::<Vec<_>>(),
            "knownDomains": engine.known_domains(),
            "mapping": mapping_json,
            "stats": engine.stats.snapshot(),
        }),
    )
}

fn holder_from(request: &Value) -> Result<MappingHolder, String> {
    let run_id = request
        .get("runId")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or("missing runId")?;
    let generation = request
        .get("generation")
        .and_then(Value::as_u64)
        .ok_or("missing generation")?;
    Ok(MappingHolder {
        run_id: run_id.to_string(),
        generation,
    })
}

fn mapping_set(engine: &Engine, id: u64, request: &Value) -> Option<String> {
    let domain = request
        .get("domain")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let ip = request
        .get("ip")
        .and_then(Value::as_str)
        .and_then(|s| s.parse::<Ipv4Addr>().ok());
    let Some(ip) = ip else {
        return Some(error_response(id, "invalidIp", "missing or invalid ip"));
    };
    let Ok(holder) = holder_from(request) else {
        return Some(error_response(
            id,
            "invalidRequest",
            "missing runId/generation",
        ));
    };
    let lease = request
        .get("leaseSeconds")
        .and_then(Value::as_u64)
        .map(Duration::from_secs)
        .unwrap_or(crate::engine::MAX_LEASE);
    match engine.mapping_set(domain, ip, holder, lease) {
        Ok(()) => Some(ok_response(id, json!({ "installed": true }))),
        Err(e) => Some(error_response(id, e.code(), &format!("{e:?}"))),
    }
}

fn mapping_refresh(engine: &Engine, id: u64, request: &Value) -> Option<String> {
    let Ok(holder) = holder_from(request) else {
        return Some(error_response(
            id,
            "invalidRequest",
            "missing runId/generation",
        ));
    };
    let lease = request
        .get("leaseSeconds")
        .and_then(Value::as_u64)
        .map(Duration::from_secs)
        .unwrap_or(crate::engine::MAX_LEASE);
    match engine.mapping_refresh(&holder, lease) {
        Ok(()) => Some(ok_response(id, json!({ "refreshed": true }))),
        Err(crate::engine::NotHolder) => Some(error_response(
            id,
            "notHolder",
            "mapping belongs to another run/generation",
        )),
    }
}

fn mapping_clear(engine: &Engine, id: u64, request: &Value) -> Option<String> {
    let Ok(holder) = holder_from(request) else {
        return Some(error_response(
            id,
            "invalidRequest",
            "missing runId/generation",
        ));
    };
    match engine.mapping_clear(&holder) {
        Ok(cleared) => Some(ok_response(id, json!({ "cleared": cleared }))),
        Err(crate::engine::NotHolder) => Some(error_response(
            id,
            "notHolder",
            "mapping belongs to another run/generation",
        )),
    }
}

fn config_set(
    engine: &Engine,
    state_path: &Path,
    restart: &AtomicBool,
    id: u64,
    request: &Value,
) -> Option<String> {
    let Some(upstreams) = request.get("upstreams").and_then(Value::as_array) else {
        return Some(error_response(id, "configInvalid", "missing upstreams"));
    };
    let mut parsed = Vec::with_capacity(upstreams.len());
    for value in upstreams {
        let Some(text) = value.as_str() else {
            return Some(error_response(
                id,
                "configInvalid",
                "upstream entries must be strings",
            ));
        };
        match crate::server::parse_upstream(text) {
            Some(addr) => parsed.push(addr),
            None => {
                return Some(error_response(
                    id,
                    "configInvalid",
                    &format!("invalid upstream \"{text}\""),
                ))
            }
        }
    }
    if parsed.is_empty() {
        return Some(error_response(
            id,
            "configInvalid",
            "at least one upstream is required",
        ));
    }
    // Loop guard (spec #174: 不转发到自己): an upstream equal to the
    // fixed listen address would query this very daemon.
    let listen_ip: Option<String> = request
        .get("listenIp")
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(listen) = &listen_ip {
        for upstream in &parsed {
            if upstream.ip().to_string() == *listen {
                return Some(error_response(
                    id,
                    "configInvalid",
                    "an upstream must not be the listen address itself",
                ));
            }
        }
    }
    engine.set_upstreams(parsed);
    // The fixed listen address takes effect on the next bind: persist it
    // and self-restart (launchd KeepAlive relaunches immediately). The
    // App's enable flow tolerates the short control-plane gap.
    //
    // The persisted record is built from the ENGINE's live state (the
    // upstreams were just applied; known domains are engine-owned) —
    // never from a disk load-modify-save, which raced the housekeeping
    // loop and could overwrite fresher knowledge with a stale file.
    if listen_ip.is_some() {
        let mut persisted = crate::state::from_engine(engine);
        persisted.listen_ip = listen_ip;
        if let Err(e) = crate::state::save(state_path, &persisted) {
            return Some(error_response(
                id,
                "configInvalid",
                &format!("state save failed: {e}"),
            ));
        }
        restart.store(true, Ordering::SeqCst);
    }
    Some(ok_response(id, json!({ "applied": true })))
}

/// Proves the mapping end to end INSIDE the daemon: builds a real A query
/// for the domain, runs it through the same `handle_query` pipeline a
/// phone's query takes, and reports the resolved address (or null).
fn verify(engine: &Engine, id: u64, request: &Value) -> String {
    let Some(domain) = request.get("domain").and_then(Value::as_str) else {
        return error_response(id, "invalidRequest", "missing domain");
    };
    let Ok(name) = Name::from_utf8(domain) else {
        return error_response(id, "invalidDomain", "domain is not parseable");
    };
    let mut query = Message::new(0x1234, MessageType::Query, OpCode::Query);
    query.add_query(Query::query(name, RecordType::A));
    let Ok(wire) = query.to_vec() else {
        return error_response(id, "invalidRequest", "query synthesis failed");
    };
    let response = engine.handle_query(&wire, crate::engine::Transport::Udp);
    let resolved = Message::from_vec(&response).ok().and_then(|answer| {
        answer.answers.iter().find_map(|record| match &record.data {
            RData::A(a) => Some(a.0.to_string()),
            _ => None,
        })
    });
    ok_response(
        id,
        json!({ "domain": domain, "resolved": resolved, "ttl": MAPPING_ANSWER_TTL }),
    )
}

/// Serves the control plane until `shutdown` flips. Each connection gets
/// one thread; requests are newline-delimited JSON, responses likewise.
pub fn serve(
    engine: Arc<Engine>,
    listeners: Arc<crate::server::Listeners>,
    socket_path: &Path,
    state_path: PathBuf,
    restart: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
) -> std::io::Result<std::thread::JoinHandle<()>> {
    // A stale socket file (crashed previous run) must not wedge the bind.
    let _ = std::fs::remove_file(socket_path);
    if let Some(parent) = socket_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let listener = std::os::unix::net::UnixListener::bind(socket_path)?;
    // Any local process may CONNECT (socket perms are the default); the
    // per-op uid check above is the authorization, not the filesystem.
    std::fs::set_permissions(
        socket_path,
        std::os::unix::fs::PermissionsExt::from_mode(0o666),
    )?;
    listener.set_nonblocking(true)?;
    let socket_path = socket_path.to_path_buf();
    Ok(std::thread::Builder::new()
        .name("pnds-dnsd-control".to_string())
        .spawn(move || {
            while !shutdown.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let engine = Arc::clone(&engine);
                        let connection_listeners = Arc::clone(&listeners);
                        let connection_state_path = state_path.clone();
                        let connection_restart = Arc::clone(&restart);
                        let shutdown = Arc::clone(&shutdown);
                        std::thread::spawn(move || {
                            serve_connection(
                                engine,
                                connection_listeners,
                                connection_state_path,
                                connection_restart,
                                stream,
                                shutdown,
                            );
                        });
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    Err(e) => {
                        log::warn!("control accept failed: {e}");
                        std::thread::sleep(Duration::from_millis(100));
                    }
                }
            }
            // Leave no stale socket behind for the next run.
            let _ = std::fs::remove_file(&socket_path);
        })
        .expect("control thread spawns"))
}

fn serve_connection(
    engine: Arc<Engine>,
    listeners: Arc<crate::server::Listeners>,
    state_path: PathBuf,
    restart: Arc<AtomicBool>,
    stream: UnixStream,
    shutdown: Arc<AtomicBool>,
) {
    stream.set_read_timeout(Some(Duration::from_secs(30))).ok();
    let peer = peer_uid(&stream);
    let mut reader = BufReader::new(stream.try_clone().expect("control stream clone"));
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => return, // peer closed
            Ok(_) => {}
            Err(_) => return,
        }
        if line.trim().is_empty() {
            continue;
        }
        let Some(response) = handle_line(
            &engine,
            &listeners,
            &state_path,
            &restart,
            line.trim(),
            peer,
            &shutdown,
        ) else {
            continue;
        };
        let mut stream = reader.get_ref().try_clone().expect("control stream clone");
        if writeln!(stream, "{response}").is_err() {
            return;
        }
        if shutdown.load(Ordering::SeqCst) {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::MIN_LEASE;
    use std::sync::atomic::AtomicBool;

    fn engine() -> Engine {
        Engine::new(vec![], Vec::new(), Box::new(std::time::Instant::now))
    }

    /// Shared liveness pair for tests — status-shape assertions that do
    /// not target the listeners field use this default.
    fn default_listeners() -> Arc<crate::server::Listeners> {
        crate::server::Listeners::new()
    }

    fn send(engine: &Engine, request: Value, peer: Option<u32>, shutdown: &AtomicBool) -> Value {
        let response = handle_line(
            engine,
            &default_listeners(),
            Path::new("/tmp/pnds-dnsd-test-state.json"),
            &AtomicBool::new(false),
            &request.to_string(),
            peer,
            shutdown,
        )
        .unwrap();
        serde_json::from_str(&response).unwrap()
    }

    fn console_peer() -> Option<u32> {
        console_uid()
    }

    #[test]
    fn status_is_open_and_reports_facts() {
        let engine = engine();
        let response = send(
            &engine,
            json!({ "id": 1, "op": "status" }),
            None,
            &AtomicBool::new(false),
        );
        assert!(response["ok"].as_bool().unwrap());
        assert_eq!(response["id"], 1);
        assert_eq!(response["data"]["upstreams"].as_array().unwrap().len(), 0);
        assert!(response["data"]["mapping"].is_null());
        assert!(response["data"]["knownDomains"]
            .as_array()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn mutating_ops_require_the_console_user_or_root() {
        let engine = engine();
        let shutdown = AtomicBool::new(false);
        let request = json!({
            "id": 2,
            "op": "mapping.set",
            "domain": "show.example.org",
            "ip": "192.168.11.31",
            "runId": "run",
            "generation": 1
        });
        // An unprivileged stranger is refused.
        let refused = send(&engine, request.clone(), Some(9999), &shutdown);
        assert_eq!(refused["ok"], false);
        assert_eq!(refused["code"], "forbidden");
        // The console user passes (uid 0 is covered by the same branch —
        // testing as root inside the test process is not possible).
        let allowed = send(&engine, request, console_peer(), &shutdown);
        assert_eq!(allowed["ok"], true);
    }

    #[test]
    fn mapping_lifecycle_flows_through_the_protocol() {
        let engine = engine();
        let shutdown = AtomicBool::new(false);
        let peer = console_peer();
        let set = send(
            &engine,
            json!({
                "id": 3, "op": "mapping.set",
                "domain": "show.example.org",
                "ip": "192.168.11.31",
                "runId": "run-a", "generation": 1,
                "leaseSeconds": MIN_LEASE.as_secs()
            }),
            peer,
            &shutdown,
        );
        assert_eq!(set["ok"], true);
        // verify: the daemon answers its own A query through the pipeline.
        let verify = send(
            &engine,
            json!({ "id": 4, "op": "verify", "domain": "show.example.org" }),
            peer,
            &shutdown,
        );
        assert_eq!(verify["data"]["resolved"], "192.168.11.31");
        // status carries the mapping.
        let status = send(&engine, json!({ "id": 5, "op": "status" }), None, &shutdown);
        assert_eq!(status["data"]["mapping"]["domain"], "show.example.org.");
        assert_eq!(status["data"]["mapping"]["ip"], "192.168.11.31");
        assert_eq!(status["data"]["mapping"]["generation"], 1);
        // A stale generation of the same run cannot refresh or clear.
        let stale = send(
            &engine,
            json!({
                "id": 6, "op": "mapping.refresh",
                "runId": "run-a", "generation": 0, "leaseSeconds": 60
            }),
            peer,
            &shutdown,
        );
        assert_eq!(stale["code"], "notHolder");
        let stale_clear = send(
            &engine,
            json!({ "id": 7, "op": "mapping.clear", "runId": "run-a", "generation": 0 }),
            peer,
            &shutdown,
        );
        assert_eq!(stale_clear["code"], "notHolder");
        // The holder clears; the domain stays known and unmapped → null.
        let clear = send(
            &engine,
            json!({ "id": 8, "op": "mapping.clear", "runId": "run-a", "generation": 1 }),
            peer,
            &shutdown,
        );
        assert_eq!(clear["data"]["cleared"], true);
        let status = send(&engine, json!({ "id": 9, "op": "status" }), None, &shutdown);
        assert!(status["data"]["mapping"].is_null());
        assert_eq!(status["data"]["knownDomains"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn config_set_validates_upstreams() {
        let engine = engine();
        let shutdown = AtomicBool::new(false);
        let peer = console_peer();
        let bad = send(
            &engine,
            json!({ "id": 10, "op": "config.set", "upstreams": ["not-an-address"] }),
            peer,
            &shutdown,
        );
        assert_eq!(bad["code"], "configInvalid");
        let empty = send(
            &engine,
            json!({ "id": 11, "op": "config.set", "upstreams": [] }),
            peer,
            &shutdown,
        );
        assert_eq!(empty["code"], "configInvalid");
        let good = send(
            &engine,
            json!({ "id": 12, "op": "config.set", "upstreams": ["223.5.5.5:53", "119.29.29.29"] }),
            peer,
            &shutdown,
        );
        assert_eq!(good["ok"], true);
        assert_eq!(engine.upstreams().len(), 2);
        assert_eq!(engine.upstreams()[1].port(), 53);
    }

    #[test]
    fn verify_without_mapping_reports_null_not_an_upstream_answer() {
        let engine = engine();
        let shutdown = AtomicBool::new(false);
        // The domain is known (was mapped once) but unmapped now: verify
        // must report null — never the domain's public address.
        send(
            &engine,
            json!({
                "id": 13, "op": "mapping.set",
                "domain": "show.example.org", "ip": "192.168.11.31",
                "runId": "run-a", "generation": 1, "leaseSeconds": 60
            }),
            console_peer(),
            &shutdown,
        );
        send(
            &engine,
            json!({ "id": 14, "op": "mapping.clear", "runId": "run-a", "generation": 1 }),
            console_peer(),
            &shutdown,
        );
        let verify = send(
            &engine,
            json!({ "id": 15, "op": "verify", "domain": "show.example.org" }),
            console_peer(),
            &shutdown,
        );
        assert!(verify["data"]["resolved"].is_null());
    }

    #[test]
    fn stop_op_flips_the_shutdown_flag() {
        let engine = engine();
        let shutdown = AtomicBool::new(false);
        let response = send(
            &engine,
            json!({ "id": 16, "op": "stop" }),
            console_peer(),
            &shutdown,
        );
        assert_eq!(response["ok"], true);
        assert!(shutdown.load(Ordering::SeqCst));
    }

    #[test]
    fn malformed_requests_get_invalidrequest() {
        let engine = engine();
        let shutdown = AtomicBool::new(false);
        let junk = send(&engine, json!({ "id": 17 }), None, &shutdown);
        assert_eq!(junk["code"], "invalidRequest");
        let unknown = send(&engine, json!({ "id": 18, "op": "npm" }), None, &shutdown);
        assert_eq!(unknown["code"], "invalidRequest");
        let bad_json = handle_line(
            &engine,
            &default_listeners(),
            Path::new("/tmp/pnds-dnsd-test-state.json"),
            &AtomicBool::new(false),
            "not json",
            None,
            &shutdown,
        )
        .unwrap();
        let parsed: Value = serde_json::from_str(&bad_json).unwrap();
        assert_eq!(parsed["code"], "invalidRequest");
    }

    #[test]
    fn full_socket_round_trip_end_to_end() {
        let engine = Arc::new(engine());
        let dir = std::env::temp_dir().join(format!("pnds-dnsd-test-{}", std::process::id()));
        let socket_path = dir.join("control.sock");
        let scratch_state = dir.join("state.json");
        let shutdown = Arc::new(AtomicBool::new(false));
        let handle = serve(
            Arc::clone(&engine),
            crate::server::Listeners::new(),
            &socket_path,
            scratch_state,
            Arc::new(AtomicBool::new(false)),
            Arc::clone(&shutdown),
        )
        .unwrap();
        // Connect and run a mapping.set through the real socket. The
        // accept loop polls non-blocking, so a connection may beat the
        // first accept tick — retry the round trip until the daemon
        // answers (EOF = accepted-but-early close under scheduling).
        let request = json!({
            "op": "mapping.set",
            "domain": "show.example.org", "ip": "192.168.11.31",
            "runId": "run-socket", "generation": 2, "leaseSeconds": 60
        })
        .to_string();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let response: Value = loop {
            let Ok(mut stream) = UnixStream::connect(&socket_path) else {
                std::thread::sleep(Duration::from_millis(20));
                continue;
            };
            writeln!(stream, "{request}").unwrap();
            let mut response_line = String::new();
            if BufReader::new(&mut stream)
                .read_line(&mut response_line)
                .is_err()
                || response_line.trim().is_empty()
            {
                assert!(
                    std::time::Instant::now() < deadline,
                    "daemon never answered the control round trip"
                );
                std::thread::sleep(Duration::from_millis(50));
                continue;
            }
            break serde_json::from_str(response_line.trim()).unwrap();
        };
        assert_eq!(response["ok"], true);
        // The socket server cleans up its file on shutdown.
        shutdown.store(true, Ordering::SeqCst);
        handle.join().unwrap();
        std::thread::sleep(Duration::from_millis(150));
        assert!(!socket_path.exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
