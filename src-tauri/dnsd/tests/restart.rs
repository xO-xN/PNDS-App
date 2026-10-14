use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, UdpSocket};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

struct Daemon {
    child: Child,
    socket: PathBuf,
    _dir: tempfile::TempDir,
}

impl Daemon {
    fn start(listen_ip: &str) -> Self {
        let dir = tempfile::tempdir_in("/tmp").unwrap();
        let socket = dir.path().join("control.sock");
        let state = dir.path().join("state.json");
        std::fs::write(
            &state,
            json!({ "listen_ip": listen_ip, "upstreams": [], "known_domains": [] }).to_string(),
        )
        .unwrap();
        let tcp = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = tcp.local_addr().unwrap().port();
        let udp = UdpSocket::bind(("127.0.0.1", port)).unwrap();
        drop((tcp, udp));
        let child = Command::new(env!("CARGO_BIN_EXE_pnds-dnsd"))
            .args(["--state", state.to_str().unwrap()])
            .args(["--control", socket.to_str().unwrap()])
            .args(["--port", &port.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        Self {
            child,
            socket,
            _dir: dir,
        }
    }

    fn request(&self, request: Value) -> std::io::Result<Value> {
        let mut stream = UnixStream::connect(&self.socket)?;
        stream.set_read_timeout(Some(Duration::from_secs(1)))?;
        stream.set_write_timeout(Some(Duration::from_secs(1)))?;
        writeln!(stream, "{request}")?;
        let mut line = String::new();
        BufReader::new(stream).read_line(&mut line)?;
        Ok(serde_json::from_str(&line).unwrap())
    }

    fn ready(&mut self) -> Value {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            assert!(self.child.try_wait().unwrap().is_none());
            if let Ok(response) = self.request(json!({ "id": 1, "op": "status" })) {
                assert_eq!(response["ok"], true);
                return response["data"].clone();
            }
            assert!(Instant::now() < deadline, "daemon control plane not ready");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn apply_listen_address_and_expect_restart(&mut self) {
        let response = self
            .request(json!({
                "id": 2,
                "op": "config.set",
                "upstreams": ["127.0.0.2:5353"],
                "listenIp": "127.0.0.1"
            }))
            .unwrap();
        assert_eq!(response["ok"], true, "{response}");
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                assert!(status.success(), "daemon restart exited with {status}");
                return;
            }
            assert!(
                Instant::now() < deadline,
                "daemon accepted config.set but never exited for launchd to restart it"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn config_restart_stops_running_dns_workers_before_joining() {
    let mut daemon = Daemon::start("127.0.0.1");
    let status = daemon.ready();
    assert_eq!(status["listeners"], json!({ "udp": true, "tcp": true }));
    daemon.apply_listen_address_and_expect_restart();
}

#[test]
fn config_restart_also_exits_after_a_stale_address_bind_failure() {
    let mut daemon = Daemon::start("192.0.2.123");
    let status = daemon.ready();
    assert_eq!(status["listeners"], json!({ "udp": false, "tcp": false }));
    assert!(status["bindError"].is_string());
    daemon.apply_listen_address_and_expect_restart();
}
