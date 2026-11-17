use super::*;
use std::io::{Read, Write};

fn endpoint(body: &'static str) -> (SocketAddr, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let thread = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut bytes = [0; 4096];
        stream.read(&mut bytes).unwrap();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
    });
    (address, thread)
}

#[tokio::test]
async fn local_monitor_keeps_declared_cross_port_requests_on_their_own_listener() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let (monitor, monitor_thread) = endpoint("monitor-page");
    let (performer, performer_thread) = endpoint("0{\"sid\":\"performer-socket\"}");
    let directory = tempfile::tempdir().unwrap();
    let mut source = ClientProxy::start_local(
        directory.path(),
        monitor,
        "local-monitor",
        &[monitor, performer],
    )
    .unwrap();
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(format!("http://{}", source.address)).unwrap())
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    let alias = format!("http://{}:{}", source.hostname, performer.port());
    let response = client
        .get(format!("{alias}/socket.io/?EIO=4&transport=polling"))
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.text().await.unwrap(),
        "0{\"sid\":\"performer-socket\"}"
    );
    let page = client
        .get(format!(
            "http://{}:{}/",
            source.hostname, source.origin_port
        ))
        .send()
        .await
        .unwrap();
    assert!(page.headers()[hyper::header::CONTENT_SECURITY_POLICY]
        .to_str()
        .unwrap()
        .contains(&alias));
    assert_eq!(page.text().await.unwrap(), "monitor-page");
    assert_eq!(
        client
            .get(format!("http://{}:1/", source.hostname))
            .send()
            .await
            .unwrap()
            .status(),
        hyper::StatusCode::FORBIDDEN
    );
    assert_eq!(
        client
            .get(format!("http://another.localhost:{}/", source.origin_port))
            .send()
            .await
            .unwrap()
            .status(),
        hyper::StatusCode::FORBIDDEN
    );
    source.shutdown().unwrap();
    monitor_thread.join().unwrap();
    performer_thread.join().unwrap();
}

#[tokio::test]
async fn native_monitor_proxy_loads_the_actual_classic_client_and_joins_its_cross_port_socket() {
    use crate::project::creation::{CreationAccess, NewProjectOptions, Protection};
    use crate::project::session::{SessionManager, StartRequest};
    use crate::types::{AudioMode, SessionStatus};
    use tauri::Manager;
    let _ = rustls::crypto::ring::default_provider().install_default();
    let directory = tempfile::tempdir().unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let workspace = access
        .create_classic(
            &NewProjectOptions {
                parent: directory.path().to_string_lossy().into_owned(),
                folder_name: "classic-media-compatibility".into(),
                name: "Native monitor compatibility".into(),
                author: String::new(),
                description: String::new(),
                locale: "en".into(),
                git_name: None,
                git_email: None,
            },
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/shared-libraries"),
            &protection,
        )
        .unwrap();
    access
        .commit(&workspace.project.identity, &protection)
        .unwrap();
    let app = tauri::test::mock_builder()
        .manage(crate::commands::preferences::PreferencesCache::for_test(
            Default::default(),
        ))
        .manage(SessionManager::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    crate::events::events_builder::<tauri::test::MockRuntime>().mount_events(&app);
    let lan = crate::project::session::list_lan_addresses()
        .unwrap()
        .into_iter()
        .next()
        .unwrap();
    let manager = app.state::<SessionManager>();
    manager
        .start(
            app.handle().clone(),
            directory.path().join("runtime"),
            StartRequest::new(workspace.project.root.clone(), AudioMode::None, lan, None).private(),
        )
        .unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    let snapshot = loop {
        let snapshot = manager.snapshot();
        assert_ne!(snapshot.status, SessionStatus::Error, "{snapshot:?}");
        if snapshot.status == SessionStatus::Ready {
            break snapshot;
        }
        assert!(std::time::Instant::now() < deadline, "{snapshot:?}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    let server = snapshot.health.unwrap().score_server.unwrap();
    let monitor = SocketAddr::from((Ipv4Addr::LOCALHOST, server.monitor_port.unwrap()));
    let performer = SocketAddr::from((Ipv4Addr::LOCALHOST, server.performer_port.unwrap()));
    let mut source = ClientProxy::start_local(
        directory.path(),
        monitor,
        "actual-classic-monitor",
        &[performer, monitor],
    )
    .unwrap();
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(format!("http://{}", source.address)).unwrap())
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    let origin = format!("http://{}:{}", source.hostname, source.origin_port);
    assert!(client
        .get(&origin)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .text()
        .await
        .unwrap()
        .contains("<html"));
    let alias = format!("http://{}:{}", source.hostname, performer.port());
    let script = client
        .get(format!("{alias}/__pnds/shared/socket.io.js"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    assert!(script.text().await.unwrap().contains("Socket.IO"));
    let open = client
        .get(format!("{alias}/socket.io/?EIO=4&transport=polling"))
        .header("Origin", &origin)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    assert_eq!(open.headers()["access-control-allow-origin"], "*");
    let packet = open.text().await.unwrap();
    assert!(packet.starts_with('0'), "{packet}");
    let handshake: serde_json::Value = serde_json::from_str(&packet[1..]).unwrap();
    let sid = handshake["sid"].as_str().unwrap();
    let transport = format!("{alias}/socket.io/?EIO=4&transport=polling&sid={sid}");
    assert_eq!(
        client
            .post(&transport)
            .header("Content-Type", "text/plain")
            .body("40")
            .send()
            .await
            .unwrap()
            .status(),
        hyper::StatusCode::OK
    );
    assert!(client
        .get(&transport)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap()
        .starts_with("40{"));
    source.shutdown().unwrap();
    manager.stop(app.handle()).unwrap();
}
