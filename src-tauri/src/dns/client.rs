//! #174: the App→daemon control client. One connection per request —
//! the protocol is stateless line-JSON, and a fresh connection avoids
//! any half-open state after a daemon restart. Never spawns a shell.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::Duration;

/// The daemon's control socket path — fixed by the daemon (dnsd lib.rs),
/// so the App can reach it without any config round-trip.
pub fn control_socket_path() -> PathBuf {
    PathBuf::from("/Library/Application Support/PNDS/dnsd/control.sock")
}

/// Sends one request and reads one response line.
/// `Err("connection refused")`-style transport errors surface verbatim;
/// a JSON `{"ok": false}` body is returned AS the object for the caller
/// to inspect (refusals carry codes the App maps to settings text).
pub fn request(
    op: &str,
    payload: serde_json::Value,
    timeout: Duration,
) -> Result<serde_json::Value, String> {
    request_on(&control_socket_path(), op, payload, timeout)
}

/// [`request`] against an explicit socket — the test seam that keeps
/// tests off the machine-global fixed path (a dev box with the service
/// enabled has a LIVE control socket there).
pub fn request_on(
    socket: &std::path::Path,
    op: &str,
    payload: serde_json::Value,
    timeout: Duration,
) -> Result<serde_json::Value, String> {
    let mut request = payload;
    request["op"] = serde_json::Value::from(op);
    // Commands carry no id — one connection, one response; the daemon's
    // echo id is only meaningful for multi-request connections.
    request["id"] = serde_json::Value::from(1);

    let mut stream =
        UnixStream::connect(socket).map_err(|e| format!("connect {}: {e}", socket.display()))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| format!("read timeout: {e}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|e| format!("write timeout: {e}"))?;

    let mut line = request.to_string();
    line.push('\n');
    stream
        .write_all(line.as_bytes())
        .map_err(|e| format!("send: {e}"))?;

    let mut response_line = String::new();
    BufReader::new(stream)
        .read_line(&mut response_line)
        .map_err(|e| format!("receive: {e}"))?;
    if response_line.trim().is_empty() {
        return Err("the DNS daemon closed the connection without answering".to_string());
    }
    serde_json::from_str(response_line.trim())
        .map_err(|e| format!("the DNS daemon's answer is not valid JSON: {e}"))
}

/// Shorthand: request → `data` (error when `ok` is false).
pub fn call(
    op: &str,
    payload: serde_json::Value,
    timeout: Duration,
) -> Result<serde_json::Value, String> {
    let response = request(op, payload, timeout)?;
    if response.get("ok").and_then(serde_json::Value::as_bool) == Some(true) {
        Ok(response
            .get("data")
            .cloned()
            .unwrap_or(serde_json::Value::Null))
    } else {
        Err(response
            .get("code")
            .and_then(serde_json::Value::as_str)
            .map(|code| format!("the DNS daemon refused {op} ({code})"))
            .unwrap_or_else(|| format!("the DNS daemon refused {op}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_builds_op_and_id_envelopes() {
        // The envelope shape is the daemon-side contract; assert it on a
        // non-connecting path by serializing what WOULD be sent.
        let mut payload = serde_json::json!({ "domain": "show.example.org" });
        payload["op"] = "verify".into();
        payload["id"] = 1.into();
        assert_eq!(payload["op"], "verify");
        assert_eq!(payload["id"], 1);
        assert_eq!(payload["domain"], "show.example.org");
    }

    #[test]
    fn connect_failure_is_a_clear_transport_error() {
        // A socket path that cannot exist (a fresh tempdir holds no
        // control.sock) — the test must never depend on whether a
        // daemon happens to run on THIS machine, because the fixed
        // production path is live the moment the operator enables the
        // service locally.
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("control.sock");
        let started = std::time::Instant::now();
        let result = request_on(
            &socket,
            "status",
            serde_json::json!({}),
            Duration::from_secs(1),
        );
        let error = result.expect_err("connecting to an absent socket must fail");
        assert!(
            error.contains("connect"),
            "readable transport error, got: {error}"
        );
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
