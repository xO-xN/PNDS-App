//! Generated-artifact tests at the real Node/HTTP/OSC and supervised-child boundaries.
use super::*;
use crate::project::children::{ChildRegistry, ShutdownOutcome, SupervisedChild};
use rosc::{OscMessage, OscPacket, OscType};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

struct ScoreProcess(SupervisedChild);
impl Drop for ScoreProcess {
    fn drop(&mut self) {
        self.0.shutdown(Duration::from_secs(3));
    }
}

pub(super) struct OscServer {
    pub(super) port: u16,
    pub(super) messages: Arc<Mutex<Vec<OscMessage>>>,
    running: Arc<std::sync::atomic::AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl OscServer {
    pub(super) fn new() -> Self {
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = socket.local_addr().unwrap().port();
        socket
            .set_read_timeout(Some(Duration::from_millis(50)))
            .unwrap();
        let messages = Arc::new(Mutex::new(Vec::new()));
        let recorded = messages.clone();
        let running = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let active = running.clone();
        let thread = std::thread::spawn(move || {
            let mut bytes = [0u8; 65536];
            while active.load(Ordering::SeqCst) {
                let Ok((size, peer)) = socket.recv_from(&mut bytes) else {
                    continue;
                };
                let (_, OscPacket::Message(message)) =
                    rosc::decoder::decode_udp(&bytes[..size]).unwrap()
                else {
                    panic!("expected OSC message")
                };
                let reply = match message.addr.as_str() {
                    "/status" => Some(OscMessage {
                        addr: "/status.reply".into(),
                        args: vec![],
                    }),
                    "/d_load" => Some(OscMessage {
                        addr: "/done".into(),
                        args: vec![OscType::String("/d_load".into())],
                    }),
                    "/s_get" => Some(OscMessage {
                        addr: "/n_set".into(),
                        args: vec![
                            message.args[0].clone(),
                            message.args[1].clone(),
                            OscType::Float(0.0),
                        ],
                    }),
                    "/d_recv" => Some(OscMessage {
                        addr: "/done".into(),
                        args: vec![OscType::String("/d_recv".into())],
                    }),
                    "/sync" => Some(OscMessage {
                        addr: "/synced".into(),
                        args: message.args.clone(),
                    }),
                    _ => None,
                };
                recorded.lock().unwrap().push(message);
                if let Some(reply) = reply {
                    socket
                        .send_to(
                            &rosc::encoder::encode(&OscPacket::Message(reply)).unwrap(),
                            peer,
                        )
                        .unwrap();
                }
            }
        });
        Self {
            port,
            messages,
            running,
            thread: Some(thread),
        }
    }
}
impl Drop for OscServer {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        self.thread.take().unwrap().join().unwrap();
    }
}

#[test]
fn blank_server_rejects_audio_creation_failure_even_before_the_sync_waiter() {
    let temp = tempfile::tempdir().unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let opened = access
        .create_blank(
            &NewProjectOptions {
                parent: temp.path().to_string_lossy().into_owned(),
                folder_name: "early-fail".into(),
                name: "Score".into(),
                author: String::new(),
                description: String::new(),
                locale: "en".into(),
            },
            &protection,
        )
        .unwrap();
    access
        .commit(&opened.project.identity, &protection)
        .unwrap();
    let root = PathBuf::from(&opened.project.root);
    let one = TcpListener::bind("127.0.0.1:0").unwrap();
    let two = TcpListener::bind("127.0.0.1:0").unwrap();
    let CreationContent::Text { text, version } = access
        .read(&opened.project.identity, "manifest.json", &protection)
        .unwrap()
    else {
        panic!("manifest text")
    };
    let mut manifest: serde_json::Value = serde_json::from_str(&text).unwrap();
    manifest["scoreServer"]["performerPort"] = one.local_addr().unwrap().port().into();
    manifest["scoreServer"]["monitorPort"] = two.local_addr().unwrap().port().into();
    access
        .save(
            &opened.project.identity,
            "manifest.json",
            &manifest.to_string(),
            &version,
            &protection,
        )
        .unwrap();
    drop((one, two));
    let preload = temp.path().join("transport.mjs");
    fs::write(&preload, include_str!("blank_fail_transport.mjs")).unwrap();
    let registry = ChildRegistry::new(temp.path().join("registry"));
    let mut command = Command::new(crate::project::session::node_binary_path().unwrap());
    command
        .arg("--import")
        .arg(preload)
        .arg(root.join("server.js"))
        .args(["--audio-mode", "internal"])
        .env_clear()
        .env("PNDS_OSC_TARGET", "127.0.0.1:31337")
        .env("PNDS_AUDIO_OUTPUT_BUS", "12")
        .env("PNDS_AUDIO_OUTPUT_CHANNELS", "2")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child =
        ScoreProcess(SupervisedChild::spawn(&registry, "blank-early-fail", &mut command).unwrap());
    let deadline = Instant::now() + Duration::from_secs(2);
    let status = loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            break status;
        }
        assert!(
            Instant::now() < deadline,
            "failed audio must not reach ready"
        );
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(status.code(), Some(1));
    let mut error = String::new();
    child
        .0
        .child()
        .stderr
        .as_mut()
        .unwrap()
        .read_to_string(&mut error)
        .unwrap();
    assert!(error.contains("group rejected"), "{error}");
}

#[test]
fn blank_server_failure_releases_started_http_and_audio_resources() {
    let temp = tempfile::tempdir().unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let opened = access
        .create_blank(
            &NewProjectOptions {
                parent: temp.path().to_string_lossy().into_owned(),
                folder_name: "failed-score".into(),
                name: "Score".into(),
                author: String::new(),
                description: String::new(),
                locale: "en".into(),
            },
            &protection,
        )
        .unwrap();
    access
        .commit(&opened.project.identity, &protection)
        .unwrap();
    let root = PathBuf::from(&opened.project.root);
    let reserve = TcpListener::bind("127.0.0.1:0").unwrap();
    let performer = reserve.local_addr().unwrap().port();
    let occupied_monitor = TcpListener::bind("0.0.0.0:0").unwrap();
    let monitor = occupied_monitor.local_addr().unwrap().port();
    let CreationContent::Text { text, version } = access
        .read(&opened.project.identity, "manifest.json", &protection)
        .unwrap()
    else {
        panic!("manifest text")
    };
    let mut manifest: serde_json::Value = serde_json::from_str(&text).unwrap();
    manifest["scoreServer"]["performerPort"] = performer.into();
    manifest["scoreServer"]["monitorPort"] = monitor.into();
    access
        .save(
            &opened.project.identity,
            "manifest.json",
            &manifest.to_string(),
            &version,
            &protection,
        )
        .unwrap();
    drop(reserve);
    let osc = OscServer::new();
    let registry = ChildRegistry::new(temp.path().join("registry"));
    let mut command = Command::new(crate::project::session::node_binary_path().unwrap());
    command
        .arg(root.join("server.js"))
        .args(["--audio-mode", "internal"])
        .env_clear()
        .env("PNDS_OSC_TARGET", format!("127.0.0.1:{}", osc.port))
        .env("PNDS_AUDIO_OUTPUT_BUS", "12")
        .env("PNDS_AUDIO_OUTPUT_CHANNELS", "2")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child =
        ScoreProcess(SupervisedChild::spawn(&registry, "blank-failure", &mut command).unwrap());
    let deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            break status;
        }
        assert!(
            Instant::now() < deadline,
            "failed server must exit without a forced kill"
        );
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(status.code(), Some(1));
    assert!(TcpListener::bind(("127.0.0.1", performer)).is_ok());
    let messages = osc.messages.lock().unwrap();
    assert!(messages.iter().any(|message| message.addr == "/g_new"));
    assert!(messages
        .iter()
        .any(|message| message.addr == "/n_free" && message.args == vec![OscType::Int(1000)]));
    assert!(!messages.iter().any(|message| message.addr == "/quit"));
}

#[test]
fn blank_artifact_starts_restarts_and_releases_resources_in_all_three_audio_modes() {
    let temp = tempfile::tempdir().unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let options = NewProjectOptions {
        parent: temp.path().to_string_lossy().into_owned(),
        folder_name: "silent-score".into(),
        name: "A <silent> score".into(),
        author: String::new(),
        description: String::new(),
        locale: "en".into(),
    };
    let opened = access.create_blank(&options, &protection).unwrap();
    access
        .commit(&opened.project.identity, &protection)
        .unwrap();
    let root = PathBuf::from(&opened.project.root);
    // Reserve independent test ports; generation keeps the platform's normal 6868/6869 declarations.
    let one = TcpListener::bind("127.0.0.1:0").unwrap();
    let two = TcpListener::bind("127.0.0.1:0").unwrap();
    let performer = one.local_addr().unwrap().port();
    let monitor = two.local_addr().unwrap().port();
    let CreationContent::Text { text, version } = access
        .read(&opened.project.identity, "manifest.json", &protection)
        .unwrap()
    else {
        panic!("manifest text")
    };
    let mut manifest: serde_json::Value = serde_json::from_str(&text).unwrap();
    manifest["scoreServer"]["performerPort"] = performer.into();
    manifest["scoreServer"]["monitorPort"] = monitor.into();
    access
        .save(
            &opened.project.identity,
            "manifest.json",
            &manifest.to_string(),
            &version,
            &protection,
        )
        .unwrap();
    drop((one, two));
    let node = crate::project::session::node_binary_path().expect("fetched fixed Node runtime");
    let registry = ChildRegistry::new(temp.path().join("registry"));
    for mode in ["internal", "external", "none"] {
        let osc = OscServer::new();
        for _restart in 0..2 {
            let mut command = Command::new(&node);
            command
                .arg(root.join("server.js"))
                .args(["--audio-mode", mode])
                .current_dir(&root)
                .env_clear()
                .env("PNDS_HOST_IP", "127.0.0.1")
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            if mode != "none" {
                command.env("PNDS_OSC_TARGET", format!("127.0.0.1:{}", osc.port));
            }
            if mode == "internal" {
                command
                    .env("PNDS_AUDIO_OUTPUT_BUS", "12")
                    .env("PNDS_AUDIO_OUTPUT_CHANNELS", "2");
            }
            let mut child = ScoreProcess(
                SupervisedChild::spawn(&registry, format!("blank-{mode}"), &mut command).unwrap(),
            );
            let deadline = Instant::now() + Duration::from_secs(5);
            let url = format!("http://127.0.0.1:{performer}/__pnds/health");
            let health: serde_json::Value = loop {
                if let Ok(mut response) = ureq::get(&url).call() {
                    let value: serde_json::Value =
                        serde_json::from_str(&response.body_mut().read_to_string().unwrap())
                            .unwrap();
                    if value["status"] == "ready" {
                        break value;
                    }
                }
                if let Some(status) = child.0.try_wait().unwrap() {
                    let mut output = String::new();
                    child
                        .0
                        .child()
                        .stderr
                        .as_mut()
                        .unwrap()
                        .read_to_string(&mut output)
                        .unwrap();
                    panic!("blank server exited: {status}; {output}");
                }
                assert!(Instant::now() < deadline, "{mode} never ready");
                std::thread::sleep(Duration::from_millis(20));
            };
            assert_eq!(health["projectId"], manifest["id"]);
            assert_eq!(health["audioMode"], mode);
            assert_eq!(
                health["audio"]["status"],
                if mode == "none" { "disabled" } else { "ready" }
            );
            assert_eq!(health["scoreServer"]["performerPort"], performer);
            assert_eq!(health["scoreServer"]["monitorPort"], monitor);
            for port in [performer, monitor] {
                let page = ureq::get(format!(
                    "http://127.0.0.1:{port}/?_r=3&theme=pond&lang=zh-CN"
                ))
                .call()
                .unwrap()
                .body_mut()
                .read_to_string()
                .unwrap();
                assert!(page.contains("A &lt;silent&gt; score"));
                assert!(!page.contains("<silent>"));
            }
            let mut malformed = TcpStream::connect(("127.0.0.1", performer)).unwrap();
            malformed
                .set_read_timeout(Some(Duration::from_secs(1)))
                .unwrap();
            malformed
                .write_all(b"GET //% HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                .unwrap();
            let mut response = String::new();
            malformed.read_to_string(&mut response).unwrap();
            assert!(response.starts_with("HTTP/1.1 400"), "{response}");
            let healthy: serde_json::Value = serde_json::from_str(
                &ureq::get(&url)
                    .call()
                    .unwrap()
                    .body_mut()
                    .read_to_string()
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(
                healthy["status"], "ready",
                "malformed input does not stop the score"
            );
            assert_eq!(
                child.0.shutdown(Duration::from_secs(3)),
                ShutdownOutcome::Confirmed
            );
            assert_eq!(
                child.0.try_wait().unwrap().unwrap().code(),
                Some(0),
                "graceful shutdown, not a forced kill"
            );
            assert!(TcpListener::bind(("127.0.0.1", performer)).is_ok());
            assert!(TcpListener::bind(("127.0.0.1", monitor)).is_ok());
        }
        let messages = osc.messages.lock().unwrap();
        if mode == "internal" {
            let groups = messages
                .iter()
                .filter(|message| message.addr == "/g_new")
                .count();
            assert_eq!(groups, 2);
            let synths: Vec<_> = messages
                .iter()
                .filter(|message| message.addr == "/s_new")
                .collect();
            assert_eq!(synths.len(), 4);
            for (i, synth) in synths.iter().enumerate() {
                assert_eq!(
                    synth.args,
                    vec![
                        OscType::String("pndsBlank".into()),
                        OscType::Int(1001 + (i % 2) as i32),
                        OscType::Int(1),
                        OscType::Int(1000),
                        OscType::String("out".into()),
                        OscType::Int(12 + (i % 2) as i32)
                    ]
                );
            }
            assert_eq!(
                messages
                    .iter()
                    .filter(|message| message.addr == "/n_free")
                    .count(),
                2
            );
            assert!(messages.iter().all(|message| [
                "/d_recv", "/g_new", "/s_new", "/sync", "/n_free"
            ]
            .contains(&message.addr.as_str())));
        } else {
            assert!(messages.is_empty(), "preview modes send no music messages");
        }
    }
}
