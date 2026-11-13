//! Generated-artifact tests at the real Node/HTTP/OSC and supervised-child boundaries.
use super::*;
use crate::project::children::{ChildRegistry, ShutdownOutcome, SupervisedChild};
use rosc::{OscMessage, OscPacket, OscType};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn shared_environment() -> String {
    let references = [
        ("express", "5.3.0"),
        ("socket.io", "4.8.4"),
        ("osc-min", "2.1.2"),
    ]
    .map(
        |(id, version)| crate::project::manifest::SharedLibraryReference {
            id: id.into(),
            version: version.into(),
        },
    );
    serde_json::to_string(
        &crate::project::shared_libraries::resolve_at(
            &super::tests::shared_libraries(),
            &references,
        )
        .unwrap(),
    )
    .unwrap()
}

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
                git_name: None,
                git_email: None,
            },
            &super::tests::shared_libraries(),
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
        .env("PNDS_SHARED_LIBRARIES", shared_environment())
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
                git_name: None,
                git_email: None,
            },
            &super::tests::shared_libraries(),
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
        .env("PNDS_SHARED_LIBRARIES", shared_environment())
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
        git_name: None,
        git_email: None,
    };
    let opened = access
        .create_blank(&options, &super::tests::shared_libraries(), &protection)
        .unwrap();
    access
        .commit(&opened.project.identity, &protection)
        .unwrap();
    let root = PathBuf::from(&opened.project.root);
    let CreationContent::Text { text, version } = access
        .read(&opened.project.identity, "server.js", &protection)
        .unwrap()
    else {
        panic!("Blank score server")
    };
    let data = temp.path().join("assistant-data");
    let task = access
        .begin_assistant_task(
            &opened.project.identity,
            AssistantMode::Edit,
            None,
            &data,
            &protection,
        )
        .unwrap();
    let updated = text.replace(
        "  '.gif': 'image/gif',",
        "  '.gif': 'image/gif',\n  '.wav': 'audio/wav',",
    );
    access
        .write_assistant_file(
            &opened.project.identity,
            &task.id,
            &AssistantWrite {
                path: "server.js".into(),
                version: Some(version),
                text: Some(updated),
                edits: None,
            },
            &data,
            &protection,
        )
        .unwrap();
    let test_audio = b"RIFF fixture for testing the private-safe static byte route";
    fs::write(root.join("public/take.wav"), test_audio).unwrap();
    let CreationContent::Text { text, version } = access
        .read(
            &opened.project.identity,
            "public/performer.html",
            &protection,
        )
        .unwrap()
    else {
        panic!("Blank performer")
    };
    let html = text.replace(
        "</body>",
        "<audio controls preload=\"auto\" src=\"/take.wav\"></audio></body>",
    );
    access
        .write_assistant_file(
            &opened.project.identity,
            &task.id,
            &AssistantWrite {
                path: "public/performer.html".into(),
                version: Some(version),
                text: Some(html),
                edits: None,
            },
            &data,
            &protection,
        )
        .unwrap();
    // Keep the numerical lease across every mode/restart, including the gaps
    // before Node binds. Generation retains its normal 6868/6869 declarations.
    let mut ports =
        crate::test_support::FixturePorts::<2>::reserve("blank-artifact-runtime").unwrap();
    let [performer, monitor] = ports.values();
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
    ports.release_for_start();
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
                .env("PNDS_SHARED_LIBRARIES", shared_environment())
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
            if mode == "none" {
                let entry = ureq::get(format!("http://127.0.0.1:{performer}/"))
                    .call()
                    .unwrap()
                    .into_body()
                    .read_to_string()
                    .unwrap();
                assert!(entry.contains(r#"preload="auto" src="/take.wav""#));
                let url = format!("http://127.0.0.1:{performer}/take.wav");
                let reply = ureq::get(&url).call().unwrap();
                assert_eq!(reply.headers()["content-type"], "audio/wav");
                assert_eq!(reply.into_body().read_to_vec().unwrap(), test_audio);
            }
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
            if mode == "none" {
                verify_blank_preview_snapshot(&root, monitor);
                let page = root.join("public/monitor.html");
                let original = fs::read_to_string(&page).unwrap();
                fs::write(&page, format!("{original}\n<!-- saved after startup -->")).unwrap();
                let body = ureq::get(format!("http://127.0.0.1:{monitor}/?_r=4"))
                    .call()
                    .unwrap()
                    .body_mut()
                    .read_to_string()
                    .unwrap();
                assert!(
                    body.contains("saved after startup"),
                    "refresh must read saved bytes"
                );
                fs::write(&page, original).unwrap();
                fs::write(root.join("public/score.js"), "let size = 3;").unwrap();
                let mut response = ureq::get(format!("http://127.0.0.1:{monitor}/score.js"))
                    .call()
                    .unwrap();
                assert!(response
                    .headers()
                    .get("content-type")
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .contains("javascript"));
                assert_eq!(
                    response.body_mut().read_to_string().unwrap(),
                    "let size = 3;"
                );
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

fn verify_blank_preview_snapshot(root: &Path, monitor: u16) {
    let base = format!("http://127.0.0.1:{monitor}");
    let get = |path: &str| {
        let mut response = ureq::get(format!("{base}{path}")).call().unwrap();
        assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");
        response.body_mut().read_to_string().unwrap()
    };
    for (path, mime) in [
        ("/monitor.js", "javascript"),
        ("/performer.js", "javascript"),
        ("/style.css", "text/css"),
        ("/pnds-preview.mjs", "javascript"),
    ] {
        let response = ureq::get(format!("{base}{path}")).call().unwrap();
        assert!(response
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap()
            .contains(mime));
    }
    let page = get("/?pndsHostOrigin=http%3A%2F%2Fhost");
    let context = page
        .split("window.PNDS_PREVIEW_CONTEXT=")
        .nth(1)
        .expect("preview bootstrap")
        .split("</script>")
        .next()
        .unwrap();
    let context: serde_json::Value = serde_json::from_str(context).unwrap();
    assert_eq!(context["hostOrigin"], "http://host");
    let source = fs::read_to_string(root.join("public/monitor.js")).unwrap();
    let contract = fs::read(root.join("pnds.preview.json")).unwrap();
    let digest = |bytes: &[u8]| preview_digest(std::str::from_utf8(bytes).unwrap());
    assert_eq!(
        context["sources"]["public/monitor.js"],
        digest(source.as_bytes())
    );
    assert_eq!(context["contractDigest"], digest(&contract));
    let pinned = page
        .split("src=\"")
        .filter_map(|suffix| suffix.split('"').next())
        .find(|path| path.starts_with("/monitor.js?pndsSnapshot="))
        .unwrap();
    let changed = format!("{source}\n// saved during page load\n");
    fs::write(root.join("public/monitor.js"), &changed).unwrap();
    assert_eq!(
        get(pinned),
        source,
        "pinned response must contain exactly the declared source bytes"
    );
    assert_eq!(get("/monitor.js"), changed);
    let refresh = get("/?pndsHostOrigin=http%3A%2F%2Fhost&_r=8");
    assert!(refresh.contains(&digest(changed.as_bytes())));
    assert!(!refresh.contains(&digest(source.as_bytes())));
    assert!(ureq::get(format!("{base}/monitor.js?pndsSnapshot=unknown"))
        .call()
        .is_err());
    assert!(get("/monitor.html?pndsHostOrigin=http%3A%2F%2Fhost")
        .contains("window.PNDS_PREVIEW_CONTEXT="));
    assert!(!get("/performer.html?pndsHostOrigin=http%3A%2F%2Fhost")
        .contains("window.PNDS_PREVIEW_CONTEXT="));
    let escaped = get("/?pndsHostOrigin=http%3A%2F%2Fhost%2F%3C%2Fscript%3E");
    assert!(!escaped.contains("http://host/</script>"));
    assert!(escaped.contains("\\u003c/script>"));
    let page_path = root.join("public/monitor.html");
    let original = fs::read_to_string(&page_path).unwrap();
    fs::write(
        &page_path,
        original.replace(
            "<script src=\"./monitor.js\">",
            "<script\n defer src = '/monitor.js' data-score=\"monitor\">",
        ),
    )
    .unwrap();
    let reformatted = get("/?pndsHostOrigin=http%3A%2F%2Fhost");
    assert!(reformatted.contains("window.PNDS_PREVIEW_CONTEXT="));
    assert!(reformatted.contains("defer src = '/monitor.js?pndsSnapshot="));
    assert!(reformatted.contains("data-score=\"monitor\""));
    fs::write(&page_path, original.replace("/monitor.js", "/missing.js")).unwrap();
    assert!(matches!(
        ureq::get(format!("{base}/?pndsHostOrigin=http%3A%2F%2Fhost")).call(),
        Err(ureq::Error::StatusCode(500))
    ));
    fs::write(&page_path, original).unwrap();
    fs::write(root.join("public/monitor.js"), &source).unwrap();
    // Specialized monitor HTML/snapshot reads must use the same public boundary.
    let hidden = root.join(".pnds-creation");
    std::os::unix::fs::DirBuilderExt::mode(&mut fs::DirBuilder::new(), 0o700)
        .recursive(true)
        .create(&hidden)
        .unwrap();
    let private = hidden.join("route-secret.js");
    fs::write(&private, "PRIVATE MONITOR SOURCE BYTES").unwrap();
    let external = root.parent().unwrap().join("external-monitor-source.js");
    fs::write(&external, "EXTERNAL MONITOR SOURCE BYTES").unwrap();
    for (relative, requests) in [
        (
            "public/monitor.html",
            vec!["/", "/monitor.html", "/?pndsHostOrigin=http%3A%2F%2Fhost"],
        ),
        (
            "public/monitor.js",
            vec!["/monitor.js", "/?pndsHostOrigin=http%3A%2F%2Fhost"],
        ),
        (
            "pnds.preview.json",
            vec!["/?pndsHostOrigin=http%3A%2F%2Fhost"],
        ),
    ] {
        let target = root.join(relative);
        let original = fs::read(&target).unwrap();
        for alias in [&private, &external] {
            fs::remove_file(&target).unwrap();
            std::os::unix::fs::symlink(alias, &target).unwrap();
            for request in &requests {
                let url = format!("{base}{request}");
                assert!(
                    matches!(ureq::get(&url).call(), Err(ureq::Error::StatusCode(404))),
                    "unsafe {relative} GET {request}"
                );
                assert!(
                    matches!(ureq::head(&url).call(), Err(ureq::Error::StatusCode(404))),
                    "unsafe {relative} HEAD {request}"
                );
            }
            assert_eq!(
                get(pinned),
                source,
                "previous valid pinned bytes remain bound to their actual load"
            );
            fs::remove_file(&target).unwrap();
            fs::write(&target, &original).unwrap();
        }
    }
}

#[test]
fn blank_socket_io_connects_both_page_roles_reconnects_and_closes_active_websockets() {
    let temp = tempfile::tempdir().unwrap();
    let mut access = CreationAccess::default();
    let created = access
        .create_blank(
            &NewProjectOptions {
                parent: temp.path().display().to_string(),
                folder_name: "realtime".into(),
                name: "Realtime".into(),
                author: String::new(),
                description: String::new(),
                locale: "en".into(),
                git_name: None,
                git_email: None,
            },
            &super::tests::shared_libraries(),
            &Protection::default(),
        )
        .unwrap();
    let identity = access
        .open(Path::new(&created.project.root), &Protection::default())
        .unwrap()
        .project
        .identity;
    for path in [
        "modules/pnds-players/client.js",
        "modules/pnds-monitor-state/monitor-client.js",
    ] {
        let CreationContent::Text { text, version, .. } = access
            .read(&identity, path, &Protection::default())
            .unwrap()
        else {
            panic!("editable module client")
        };
        access
            .save(
                &identity,
                path,
                &format!("{text}\n// Saved author client edit remains public.\n"),
                &version,
                &Protection::default(),
            )
            .unwrap();
    }
    let fixture = temp.path().join("realtime.mjs");
    fs::write(&fixture, include_str!("blank_realtime.mjs")).unwrap();
    let client = crate::project::shared_libraries::resolve_at(
        &super::tests::shared_libraries(),
        &[crate::project::manifest::SharedLibraryReference {
            id: "socket.io-client".into(),
            version: "4.8.4".into(),
        }],
    )
    .unwrap()
    .remove("socket.io-client")
    .unwrap();
    let output = Command::new(crate::project::session::node_binary_path().unwrap())
        .arg(fixture)
        .arg(created.project.root)
        .arg(client.path)
        .env_clear()
        .env("PNDS_SHARED_LIBRARIES", shared_environment())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn blank_audio_ack_timeout_fails_without_publishing_ready_or_leaking_resources() {
    let temp = tempfile::tempdir().unwrap();
    let created = CreationAccess::default()
        .create_blank(
            &NewProjectOptions {
                parent: temp.path().display().to_string(),
                folder_name: "ack-timeout".into(),
                name: "Score".into(),
                author: String::new(),
                description: String::new(),
                locale: "en".into(),
                git_name: None,
                git_email: None,
            },
            &super::tests::shared_libraries(),
            &Protection::default(),
        )
        .unwrap();
    let silent_target = UdpSocket::bind("127.0.0.1:0").unwrap();
    let mut command = Command::new(crate::project::session::node_binary_path().unwrap());
    command
        .arg(Path::new(&created.project.root).join("server.js"))
        .args(["--audio-mode", "internal"])
        .env_clear()
        .env("PNDS_SHARED_LIBRARIES", shared_environment())
        .env(
            "PNDS_OSC_TARGET",
            silent_target.local_addr().unwrap().to_string(),
        )
        .env("PNDS_AUDIO_OUTPUT_BUS", "12")
        .env("PNDS_AUDIO_OUTPUT_CHANNELS", "2")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let registry = ChildRegistry::new(temp.path().join("registry"));
    let mut child =
        ScoreProcess(SupervisedChild::spawn(&registry, "blank-ack-timeout", &mut command).unwrap());
    let deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            break status;
        }
        assert!(
            Instant::now() < deadline,
            "unacknowledged OSC must time out"
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
    assert!(
        error.contains("scsynth did not acknowledge /d_recv"),
        "{error}"
    );
    let mut output = String::new();
    child
        .0
        .child()
        .stdout
        .as_mut()
        .unwrap()
        .read_to_string(&mut output)
        .unwrap();
    assert!(!output.contains("ready"), "{output}");
}

#[test]
fn blank_monitor_views_are_lazy_and_converge_after_public_configuration() {
    let temp = tempfile::tempdir().unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let created = access
        .create_blank(
            &NewProjectOptions {
                parent: temp.path().display().to_string(),
                folder_name: "monitor-views".into(),
                name: "Monitor views".into(),
                author: String::new(),
                description: String::new(),
                locale: "en".into(),
                git_name: None,
                git_email: None,
            },
            &super::tests::shared_libraries(),
            &protection,
        )
        .unwrap();
    access
        .commit(&created.project.identity, &protection)
        .unwrap();
    let catalog = access
        .module_catalog(&created.project.identity, &protection)
        .unwrap();
    let included = catalog
        .modules
        .iter()
        .find(|module| module.id == "monitor-state")
        .unwrap();
    assert!(matches!(included.state, super::modules::ModuleState::Added));
    assert!(!access
        .read_handoff(&created.project.identity, &protection)
        .unwrap()
        .text
        .contains("Wire PNDS module monitor-state"));
    let CreationContent::Text { text, version } = access
        .read(
            &created.project.identity,
            "public/monitor-view.json",
            &protection,
        )
        .unwrap()
    else {
        panic!("monitor view declarations must be editable text")
    };
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&text).unwrap(),
        serde_json::json!({})
    );
    access.save(
        &created.project.identity,
        "public/monitor-view.json",
        r#"{"displayMode":{"default":"score","values":["score","details"]},"detailLevel":{"default":1,"min":0,"max":5}}"#,
        &version,
        &protection,
    ).unwrap();
    let CreationContent::Text { text, version } = access
        .read(&created.project.identity, "public/monitor.js", &protection)
        .unwrap()
    else {
        panic!("monitor entry must be editable text")
    };
    access.save(
        &created.project.identity,
        "public/monitor.js",
        &format!("{text}\nwindow.PNDSMonitorView.onViewState(state => {{ document.body.dataset.displayMode = state?.displayMode ?? 'waiting' }})\n"),
        &version,
        &protection,
    ).unwrap();
    let fixture = temp.path().join("monitor-views.mjs");
    fs::write(&fixture, include_str!("blank_monitor_views.mjs")).unwrap();
    let client = crate::project::shared_libraries::resolve_at(
        &super::tests::shared_libraries(),
        &[crate::project::manifest::SharedLibraryReference {
            id: "socket.io-client".into(),
            version: "4.8.4".into(),
        }],
    )
    .unwrap()
    .remove("socket.io-client")
    .unwrap();
    let mut ports = crate::test_support::FixturePorts::<2>::reserve("blank-monitor-views").unwrap();
    let [performer_port, monitor_port] = ports.values();
    ports.release_for_start();
    let output = Command::new(crate::project::session::node_binary_path().unwrap())
        .arg(fixture)
        .arg(created.project.root)
        .arg(client.path)
        .arg(performer_port.to_string())
        .arg(monitor_port.to_string())
        .env_clear()
        .env("PNDS_SHARED_LIBRARIES", shared_environment())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
