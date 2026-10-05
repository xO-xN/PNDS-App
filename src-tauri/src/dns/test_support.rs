//! Real daemon control/query logic on a temporary socket. The fixture
//! can lose a reply after applying a request, or refuse a request before
//! applying it, reproducing the mapping's uncertain-success cases.

use hickory_proto::op::{Message, MessageType, OpCode, Query, ResponseCode};
use hickory_proto::rr::{Name, RecordType};
use pnds_dnsd_lib::engine::{Engine, Transport};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

pub(crate) enum Reply {
    Normal,
    Drop,
    Respond(Value),
}

pub(crate) struct ControlFixture {
    _dir: tempfile::TempDir,
    pub(crate) socket: PathBuf,
    pub(crate) engine: Arc<Engine>,
    pub(crate) requests: Arc<Mutex<Vec<Value>>>,
    shutdown: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl ControlFixture {
    pub(crate) fn new(mut reply: impl FnMut(&Value) -> Reply + Send + 'static) -> Self {
        // A short path stays below Darwin's Unix socket pathname limit.
        let dir = tempfile::tempdir_in("/tmp").unwrap();
        let socket = dir.path().join("control.sock");
        let engine = Arc::new(Engine::new(
            vec![],
            vec![],
            Box::new(std::time::Instant::now),
        ));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let shutdown = Arc::new(AtomicBool::new(false));
        let listener = UnixListener::bind(&socket).unwrap();
        listener.set_nonblocking(true).unwrap();
        let server_engine = Arc::clone(&engine);
        let server_requests = Arc::clone(&requests);
        let server_shutdown = Arc::clone(&shutdown);
        let state_path = dir.path().join("state.json");
        let worker = std::thread::spawn(move || {
            let listeners = pnds_dnsd_lib::server::Listeners::new();
            let restart = AtomicBool::new(false);
            while !server_shutdown.load(Ordering::SeqCst) {
                let (mut stream, _) = match listener.accept() {
                    Ok(connection) => connection,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(e) => panic!("fixture accept: {e}"),
                };
                // Darwin can inherit the listener's nonblocking flag.
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut line = String::new();
                BufReader::new(&mut stream).read_line(&mut line).unwrap();
                let request: Value = serde_json::from_str(&line).unwrap();
                server_requests.lock().unwrap().push(request.clone());
                let plan = reply(&request);
                let response = match plan {
                    Reply::Respond(response) => Some(response.to_string()),
                    Reply::Normal | Reply::Drop => {
                        let response = pnds_dnsd_lib::control::handle_line(
                            &server_engine,
                            &listeners,
                            &state_path,
                            &restart,
                            &line,
                            Some(0), // Fixture's authenticated peer, no process elevation.
                            &server_shutdown,
                        )
                        .unwrap();
                        match plan {
                            Reply::Drop => None,
                            _ => Some(response),
                        }
                    }
                };
                if let Some(response) = response {
                    let _ = writeln!(stream, "{response}");
                }
            }
        });
        Self {
            _dir: dir,
            socket,
            engine,
            requests,
            shutdown,
            worker: Some(worker),
        }
    }

    pub(crate) fn operations(&self) -> Vec<String> {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .map(|request| request["op"].as_str().unwrap().to_string())
            .collect()
    }

    pub(crate) fn response_code(&self, domain: &str) -> ResponseCode {
        let mut query = Message::new(17, MessageType::Query, OpCode::Query);
        query.add_query(Query::query(
            Name::from_utf8(domain).unwrap(),
            RecordType::A,
        ));
        Message::from_vec(
            &self
                .engine
                .handle_query(&query.to_vec().unwrap(), Transport::Udp),
        )
        .unwrap()
        .response_code
    }
}

impl Drop for ControlFixture {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            let result = worker.join();
            if !std::thread::panicking() {
                result.unwrap();
            }
        }
    }
}
