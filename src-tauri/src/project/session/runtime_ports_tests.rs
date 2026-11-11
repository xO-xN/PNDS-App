use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use tauri::Manager;

fn observed_fixture_bind(address: std::net::SocketAddr) -> std::io::Result<TcpListener> {
    let result = TcpListener::bind(address);
    if let Err(error) = &result {
        let diagnostics = crate::test_support::tcp_endpoint_snapshot(address);
        eprintln!(
            "fixture single bind failed at {address}: {error}; kind={:?}, raw_os_error={:?}; {diagnostics}",
            error.kind(),
            error.raw_os_error()
        );
    }
    result
}

#[tokio::test]
async fn adapted_public_start_avoids_foreign_preferred_ports_and_releases_actual_services() {
    let app = tauri::test::mock_app().handle().clone();
    crate::events::events_builder().mount_events(&app);
    app.manage(crate::commands::preferences::PreferencesCache::for_test(
        Default::default(),
    ));
    let root = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let lease =
        crate::test_support::FixturePorts::<2>::reserve("runtime-foreign-occupants").unwrap();
    let preferred = lease.values();
    let source = r#"const http=require('node:http');for(const port of JSON.parse(process.argv[1]))http.createServer((request,response)=>response.end(JSON.stringify({status:'ready',pid:process.pid}))).listen(port,'127.0.0.1');"#;
    let mut command = Command::new(node_binary_path().unwrap());
    command.args(["-e", source, &serde_json::to_string(&preferred).unwrap()]);
    let mut foreign = crate::test_support::OwnedNodeFixture::spawn(lease, command).unwrap();
    let before = foreign.ready().await.unwrap();
    let foreign_pid = before.performer["pid"].as_u64().unwrap();
    assert_ne!(foreign_pid, u64::from(std::process::id()));
    std::fs::write(
        root.path().join("server.cjs"),
        include_str!("runtime-ports-fixture.cjs"),
    )
    .unwrap();
    let original = serde_json::to_string(&serde_json::json!({
        "schemaVersion": 1, "id": "runtime-fixture", "name": "Runtime fixture", "version": "1.0.0",
        "scoreServer": { "entry":"server.cjs", "workingDirectory":".", "performerPort":preferred[0], "monitorPort":preferred[1], "runtimePorts":1, "supportsPerformerUrl": true },
        "audio":{"defaultMode":"none", "supportedModes":["none"]}
    })).unwrap();
    std::fs::write(root.path().join("manifest.json"), &original).unwrap();
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    let result = manager.start(
        app.clone(),
        data.path().to_owned(),
        StartRequest::new(
            root.path().to_string_lossy().into_owned(),
            AudioMode::None,
            "192.0.2.1".into(),
            None,
        ),
    );
    assert!(
        result.is_ok(),
        "adapted start must avoid occupied ports: {result:?}"
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    let snapshot = loop {
        let snapshot = manager.snapshot();
        if snapshot.status == SessionStatus::Ready {
            break snapshot;
        }
        assert!(
            snapshot.status != SessionStatus::Error && Instant::now() < deadline,
            "{snapshot:?}"
        );
        std::thread::sleep(Duration::from_millis(20));
    };
    let server = snapshot.health.unwrap().score_server.unwrap();
    let ports = [server.performer_port.unwrap(), server.monitor_port.unwrap()];
    assert_ne!(ports[0], preferred[0]);
    assert_ne!(ports[1], preferred[1]);
    assert_ne!(ports[0], ports[1]);
    for port in ports {
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .write_all(
                b"GET /asset/model?part=2 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
            )
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.contains("/asset/model?part=2"), "{response}");
    }
    assert_eq!(
        std::fs::read_to_string(root.path().join("manifest.json")).unwrap(),
        original
    );
    manager.stop(&app).unwrap();
    for port in ports {
        assert!(
            observed_fixture_bind(([0, 0, 0, 0], port).into()).is_ok(),
            "actual service port {port} leaked"
        );
    }
    let after = foreign.ready().await.unwrap();
    assert_eq!(after.performer["pid"].as_u64(), Some(foreign_pid));
    assert_eq!(after.monitor["pid"].as_u64(), Some(foreign_pid));
    assert!(manager.active_child_pids().is_empty());
    let cleanup = foreign.finish().await.unwrap();
    assert!(cleanup.process_reaped && cleanup.ports_released);
}

pub(super) fn setup_adapted_fixture(root: &Path) -> crate::test_support::FixturePorts<2> {
    let mut lease = reserve_adapted_fixture(root);
    lease.release_for_start();
    lease
}

fn reserve_adapted_fixture(root: &Path) -> crate::test_support::FixturePorts<2> {
    let lease = crate::test_support::FixturePorts::<2>::reserve("runtime-ports-report").unwrap();
    let ports = lease.values();
    std::fs::write(
        root.join("server.cjs"),
        include_str!("runtime-ports-fixture.cjs"),
    )
    .unwrap();
    std::fs::write(root.join("manifest.json"), serde_json::to_vec(&serde_json::json!({
        "schemaVersion":1,"id":"runtime-fixture","name":"Runtime fixture","version":"1.0.0",
        "scoreServer":{"entry":"server.cjs","workingDirectory":".","performerPort":ports[0],"monitorPort":ports[1],"runtimePorts":1,"supportsPerformerUrl":true},
        "audio":{"defaultMode":"none","supportedModes":["none"]}
    })).unwrap()).unwrap();
    lease
}
fn fixture_app() -> AppHandle<tauri::test::MockRuntime> {
    let app = tauri::test::mock_app().handle().clone();
    crate::events::events_builder().mount_events(&app);
    app.manage(crate::commands::preferences::PreferencesCache::for_test(
        Default::default(),
    ));
    app
}
fn start_fixture(
    manager: &SessionManager,
    app: &AppHandle<tauri::test::MockRuntime>,
    root: &Path,
    data: &Path,
) -> Result<(), String> {
    manager.start(
        app.clone(),
        data.to_owned(),
        StartRequest::new(
            root.to_string_lossy().into_owned(),
            AudioMode::None,
            "192.0.2.1".into(),
            None,
        ),
    )
}
pub(super) fn wait_finished(manager: &SessionManager) -> SessionSnapshot {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let snapshot = manager.snapshot();
        if snapshot.status == SessionStatus::Error || snapshot.status == SessionStatus::Ready {
            return snapshot;
        }
        assert!(Instant::now() < deadline, "{snapshot:?}");
        std::thread::sleep(Duration::from_millis(20));
    }
}
pub(super) struct SessionCleanup<'a>(
    pub(super) &'a SessionManager,
    pub(super) AppHandle<tauri::test::MockRuntime>,
);
impl Drop for SessionCleanup<'_> {
    fn drop(&mut self) {
        let _ = self.0.stop(&self.1);
    }
}

#[test]
fn public_start_requires_readable_and_durably_settled_previous_child_ownership() {
    use std::os::unix::fs::PermissionsExt;
    for failure in ["corrupt", "unreadable", "cannot-persist-cleanup"] {
        let root = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let _ports = setup_adapted_fixture(root.path());
        let registry = data.path().join("session-children.json");
        match failure {
            "corrupt" => std::fs::write(&registry, b"{interrupted ownership record").unwrap(),
            "unreadable" => std::fs::create_dir(&registry).unwrap(),
            _ => {
                std::fs::write(&registry, br#"[{"pid":4000000,"marker":"old-fixture"}]"#).unwrap();
                // The existing runtime lock remains usable, but removing the
                // settled ownership record cannot be durably published.
                std::fs::write(data.path().join("runtime.lock"), b"").unwrap();
                std::fs::set_permissions(data.path(), std::fs::Permissions::from_mode(0o500))
                    .unwrap();
            }
        }
        let app = fixture_app();
        let manager = SessionManager::default();
        let _cleanup = SessionCleanup(&manager, app.clone());
        let result = start_fixture(&manager, &app, root.path(), data.path());
        std::fs::set_permissions(data.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(
            result
                .as_ref()
                .is_err_and(|error| error.starts_with("participation.errors.runtimeCleanup")),
            "{failure}: {result:?}"
        );
        assert_eq!(manager.snapshot().status, SessionStatus::Error);
        assert!(
            manager.has_active_session(),
            "unconfirmed cleanup must retain runtime ownership"
        );
        assert!(manager.active_child_pids().is_empty());
        assert!(
            !root.path().join("observed-ports.json").exists(),
            "{failure}: a new score server must not spawn"
        );
        assert!(
            registry.exists(),
            "{failure}: preserve unresolved ownership evidence"
        );
        if registry.is_dir() {
            std::fs::rename(&registry, data.path().join("invalid-registry-kept")).unwrap();
        }
        // Repairing the record and explicitly retrying can open one fresh run.
        std::fs::write(&registry, b"[]").unwrap();
        start_fixture(&manager, &app, root.path(), data.path()).unwrap();
        assert_eq!(wait_finished(&manager).status, SessionStatus::Ready);
        manager.stop(&app).unwrap();
        assert!(!manager.has_active_session());
    }
}

#[test]
fn adapted_replacement_refuses_to_bypass_the_previous_run_after_registry_corruption() {
    let root = tempfile::tempdir().unwrap();
    let replacement = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let _ports = setup_adapted_fixture(root.path());
    std::fs::copy(
        root.path().join("manifest.json"),
        replacement.path().join("manifest.json"),
    )
    .unwrap();
    std::fs::copy(
        root.path().join("server.cjs"),
        replacement.path().join("server.cjs"),
    )
    .unwrap();
    let app = fixture_app();
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    start_fixture(&manager, &app, root.path(), data.path()).unwrap();
    let ready = wait_finished(&manager);
    assert_eq!(ready.status, SessionStatus::Ready);
    let pid = *manager.active_child_pids().iter().next().unwrap();
    // This test retains a cleanup right to its real child independently of the
    // deliberately damaged registry and the manager's retired Child handle.
    struct RetiredFixture(u32, String);
    impl Drop for RetiredFixture {
        fn drop(&mut self) {
            if children::process_command_line(self.0)
                .is_some_and(|command| command.contains(&self.1))
            {
                unsafe {
                    libc::kill(self.0 as i32, libc::SIGKILL);
                    libc::waitpid(self.0 as i32, std::ptr::null_mut(), 0);
                }
            }
        }
    }
    let _retired = RetiredFixture(
        pid,
        root.path()
            .join("server.cjs")
            .to_string_lossy()
            .into_owned(),
    );
    let damaged = b"{interrupted previous child ownership";
    std::fs::write(data.path().join("session-children.json"), damaged).unwrap();
    let result = start_fixture(&manager, &app, replacement.path(), data.path());
    assert!(
        result.is_err(),
        "a dynamic-port replacement must not bypass old ownership"
    );
    assert_eq!(manager.snapshot().status, SessionStatus::Error);
    assert!(!replacement.path().join("observed-ports.json").exists());
    assert_eq!(
        std::fs::read(data.path().join("session-children.json")).unwrap(),
        damaged
    );
    assert_eq!(
        unsafe { libc::kill(pid as i32, 0) },
        -1,
        "the manager must retain its known Child handle until cleanup is confirmed"
    );
    let port = ready.applied_ports.unwrap().performer_port;
    assert!(observed_fixture_bind(([0, 0, 0, 0], port).into()).is_ok());
    manager.stop(&app).unwrap();
    assert!(
        manager.has_active_session(),
        "unknown registry ownership remains blocked even after known handles are reaped"
    );
    std::fs::write(data.path().join("session-children.json"), b"[]").unwrap();
    start_fixture(&manager, &app, replacement.path(), data.path()).unwrap();
    assert_eq!(wait_finished(&manager).status, SessionStatus::Ready);
}

#[test]
fn public_start_keeps_a_still_managed_child_and_refuses_new_allocation() {
    let root = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let _ports = setup_adapted_fixture(root.path());
    let registry = ChildRegistry::new(data.path().to_owned());
    let mut command = Command::new(node_binary_path().unwrap());
    command.args(["-e", "setInterval(()=>{},1000)"]);
    let mut previous = SupervisedChild::spawn(&registry, "setInterval", &mut command).unwrap();
    let app = fixture_app();
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    let result = start_fixture(&manager, &app, root.path(), data.path());
    let still_alive = previous.try_wait().unwrap().is_none();
    let retained: serde_json::Value =
        serde_json::from_slice(&std::fs::read(data.path().join("session-children.json")).unwrap())
            .unwrap();
    assert_eq!(
        previous.shutdown(Duration::from_secs(2)),
        ShutdownOutcome::Confirmed
    );
    assert!(
        result.is_err(),
        "a protected managed survivor must block admission"
    );
    assert!(still_alive);
    assert_eq!(retained[0]["pid"], previous.id());
    assert!(!root.path().join("observed-ports.json").exists());
    start_fixture(&manager, &app, root.path(), data.path()).unwrap();
    assert_eq!(wait_finished(&manager).status, SessionStatus::Ready);
}

#[test]
fn public_start_rejects_invalid_reports_or_foreign_health_and_retry_has_no_leaked_ports() {
    for behavior in [
        "wrong-report-run",
        "wrong-role",
        "report-error",
        "wrong-project",
        "wrong-mode",
        "wrong-health-run",
    ] {
        let root = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let _ports = setup_adapted_fixture(root.path());
        std::fs::write(
            root.path().join("behavior.json"),
            serde_json::to_string(behavior).unwrap(),
        )
        .unwrap();
        let app = fixture_app();
        let manager = SessionManager::default();
        let _cleanup = SessionCleanup(&manager, app.clone());
        let _ = start_fixture(&manager, &app, root.path(), data.path());
        let snapshot = wait_finished(&manager);
        assert_eq!(
            snapshot.status,
            SessionStatus::Error,
            "{behavior}: {snapshot:?}"
        );
        assert!(
            snapshot
                .error
                .unwrap()
                .starts_with("participation.errors.runtimePorts"),
            "{behavior}"
        );
        let ports: Vec<u16> = serde_json::from_slice(
            &std::fs::read(root.path().join("observed-ports.json")).unwrap(),
        )
        .unwrap();
        assert!(manager.active_child_pids().is_empty(), "{behavior}");
        for port in ports {
            assert!(
                observed_fixture_bind(([0, 0, 0, 0], port).into()).is_ok(),
                "{behavior}: port {port}"
            );
        }
        std::fs::write(root.path().join("behavior.json"), "\"normal\"").unwrap();
        start_fixture(&manager, &app, root.path(), data.path()).unwrap();
        assert_eq!(
            wait_finished(&manager).status,
            SessionStatus::Ready,
            "{behavior}"
        );
        manager.stop(&app).unwrap();
    }
}

#[test]
fn cancelling_public_start_before_report_releases_inherited_listeners_and_ignores_late_ready() {
    let root = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let _ports = setup_adapted_fixture(root.path());
    std::fs::write(root.path().join("behavior.json"), "\"hold-report\"").unwrap();
    let app = fixture_app();
    let manager = Arc::new(SessionManager::default());
    let _cleanup = SessionCleanup(&manager, app.clone());
    let entry = manager.prepare_host_entry(data.path(), "Stage", std::net::Ipv4Addr::LOCALHOST);
    let public_url = entry.url.unwrap();
    let worker_manager = manager.clone();
    let worker_app = app.clone();
    let path = root.path().to_owned();
    let app_data = data.path().to_owned();
    let worker =
        std::thread::spawn(move || start_fixture(&worker_manager, &worker_app, &path, &app_data));
    let deadline = Instant::now() + Duration::from_secs(5);
    while !root.path().join("observed-ports.json").exists() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(
        manager.public_entry_snapshot().status,
        PublicEntryStatus::Preparing
    );
    let waiting: serde_json::Value = serde_json::from_str(
        &ureq::get(format!("{public_url}__pnds/participation"))
            .call()
            .unwrap()
            .into_body()
            .read_to_string()
            .unwrap(),
    )
    .unwrap();
    assert!(waiting["performance"].is_null());
    assert!(
        !root.path().join("health-requested").exists(),
        "health cannot precede binding report"
    );
    let ports: Vec<u16> =
        serde_json::from_slice(&std::fs::read(root.path().join("observed-ports.json")).unwrap())
            .unwrap();
    manager.stop(&app).unwrap();
    worker.join().unwrap().unwrap();
    assert_eq!(manager.snapshot().status, SessionStatus::Idle);
    assert_eq!(
        manager.public_entry_snapshot().status,
        PublicEntryStatus::Waiting
    );
    assert_eq!(
        manager.public_entry_snapshot().url.as_deref(),
        Some(public_url.as_str())
    );
    assert!(manager.active_child_pids().is_empty());
    for port in ports {
        assert!(observed_fixture_bind(([0, 0, 0, 0], port).into()).is_ok());
    }
    std::fs::write(root.path().join("behavior.json"), "\"normal\"").unwrap();
    start_fixture(&manager, &app, root.path(), data.path()).unwrap();
    assert_eq!(wait_finished(&manager).status, SessionStatus::Ready);
}

#[test]
fn public_start_publishes_actual_host_entry_for_assets_polling_websocket_and_revokes_old_context() {
    let root = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let mut lease = reserve_adapted_fixture(root.path());
    let foreign = lease.take_listeners();
    let modules = Path::new(env!("CARGO_MANIFEST_DIR")).join("../node_modules");
    std::fs::write(
        root.path().join("io-module.json"),
        serde_json::to_vec(&modules.join("socket.io").to_string_lossy()).unwrap(),
    )
    .unwrap();
    let app = tauri::test::mock_app().handle().clone();
    crate::events::events_builder().mount_events(&app);
    let preferences = crate::types::AppPreferences {
        node_name: Some("Runtime Host".into()),
        ..Default::default()
    };
    app.manage(crate::commands::preferences::PreferencesCache::for_test(
        preferences,
    ));
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    let lan = list_lan_addresses()
        .unwrap()
        .into_iter()
        .next()
        .expect("local Host workflow needs a usable LAN interface");
    let start = || {
        manager.start(
            app.clone(),
            data.path().to_owned(),
            StartRequest::new(
                root.path().to_string_lossy().into_owned(),
                AudioMode::None,
                lan.clone(),
                None,
            ),
        )
    };
    start().unwrap();
    let snapshot = wait_finished(&manager);
    assert_eq!(snapshot.status, SessionStatus::Ready, "{snapshot:?}");
    let entry = snapshot.client_entry_url.unwrap();
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(3)))
        .build()
        .into();
    let metadata: crate::participation_client::ClientHostInfo = serde_json::from_str(
        &agent
            .get(format!("{entry}__pnds/participation"))
            .call()
            .unwrap()
            .into_body()
            .read_to_string()
            .unwrap(),
    )
    .unwrap();
    let performance = metadata.performance.unwrap();
    let request = |path: &str| {
        agent
            .get(format!("{entry}{path}"))
            .header("X-PNDS-Host-Id", &metadata.host_id)
            .header("X-PNDS-Project-Id", &performance.project_id)
            .header("X-PNDS-Performance-Id", &performance.performance_id)
            .call()
    };
    for path in ["score.js?version=3", "worker/model/data.json?part=2"] {
        assert_eq!(
            request(path).unwrap().into_body().read_to_string().unwrap(),
            format!("/{path}")
        );
    }
    let client = modules.join("socket.io-client");
    let options = serde_json::json!({"url":entry,"module":client,"headers":{"X-PNDS-Host-Id":metadata.host_id,"X-PNDS-Project-Id":performance.project_id,"X-PNDS-Performance-Id":performance.performance_id}});
    let script = r#"const options=JSON.parse(process.argv[1]);const {io}=require(options.module);const timeout=setTimeout(()=>{console.error('transport deadline');process.exit(1)},7000);(async()=>{for(const transport of ['polling','websocket'])await new Promise((resolve,reject)=>{const socket=io(options.url,{transports:[transport],extraHeaders:options.headers,reconnection:false});socket.on('connect',()=>socket.emit('echo',transport));socket.on('echo',value=>{if(value!==transport)reject(new Error('wrong echo'));socket.close();resolve()});socket.on('connect_error',reject)});clearTimeout(timeout);console.log('polling and websocket echo passed')})().catch(error=>{console.error(error);process.exit(1)});"#;
    let output = Command::new(node_binary_path().unwrap())
        .args(["-e", script, &options.to_string()])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("polling and websocket echo passed"));
    manager.stop(&app).unwrap();
    assert!(request("score.js").is_err(), "ended run cannot forward");
    start().unwrap();
    assert_eq!(wait_finished(&manager).status, SessionStatus::Ready);
    assert!(
        request("socket.io/?EIO=4&transport=polling").is_err(),
        "old confirmation cannot enter new performance on reused entry"
    );
    for listener in foreign {
        assert!(listener.local_addr().is_ok());
    }
}

#[test]
fn legacy_public_start_keeps_fixed_ports_and_rejects_wrong_project_health() {
    let root = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let mut lease = reserve_adapted_fixture(root.path());
    let preferred = lease.values();
    let path = root.path().join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    manifest["scoreServer"]
        .as_object_mut()
        .unwrap()
        .remove("runtimePorts");
    let original = manifest.to_string();
    std::fs::write(&path, &original).unwrap();
    let app = fixture_app();
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    let foreign = lease.take_listeners();
    let error = start_fixture(&manager, &app, root.path(), data.path()).unwrap_err();
    assert!(error.contains(&format!("Port {} is already in use", preferred[0])));
    assert!(
        !root.path().join("observed-ports.json").exists(),
        "supportsPerformerUrl alone cannot enable dynamic ports"
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    crate::project::children::with_managed_child_pids(|_| drop(foreign));
    std::fs::write(root.path().join("behavior.json"), "\"wrong-project\"").unwrap();
    start_fixture(&manager, &app, root.path(), data.path()).unwrap();
    let failed = wait_finished(&manager);
    assert_eq!(
        failed.status,
        SessionStatus::Error,
        "wrong service health must never be ready: {failed:?}"
    );
    assert!(manager.active_child_pids().is_empty());
    std::fs::write(root.path().join("behavior.json"), "\"normal\"").unwrap();
    start_fixture(&manager, &app, root.path(), data.path()).unwrap();
    let ready = wait_finished(&manager);
    assert_eq!(ready.status, SessionStatus::Ready);
    let actual = ready.applied_ports.unwrap();
    assert_eq!([actual.performer_port, actual.monitor_port], preferred);
    assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
}

#[test]
fn public_entry_rejects_foreign_forwarded_health_at_startup_and_while_running() {
    for startup in [true, false] {
        let root = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let _lease = setup_adapted_fixture(root.path());
        if startup {
            std::fs::write(
                root.path().join("behavior.json"),
                "\"entry-health-mismatch\"",
            )
            .unwrap();
        }
        let app = fixture_app();
        let manager = SessionManager::default();
        let _cleanup = SessionCleanup(&manager, app.clone());
        let entry =
            manager.prepare_host_entry(data.path(), "Entry Host", std::net::Ipv4Addr::LOCALHOST);
        start_fixture(&manager, &app, root.path(), data.path()).unwrap();
        assert_eq!(wait_finished(&manager).status, SessionStatus::Ready);
        if !startup {
            assert!(manager.snapshot().client_entry_error.is_none());
            std::fs::write(root.path().join("mismatch-entry"), "yes").unwrap();
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        let failed = loop {
            let snapshot = manager.snapshot();
            if snapshot.client_entry_error.is_some() {
                break snapshot;
            }
            assert!(
                Instant::now() < deadline,
                "foreign forwarded health was accepted (startup={startup}): {snapshot:?}"
            );
            std::thread::sleep(Duration::from_millis(20));
        };
        assert_eq!(failed.status, SessionStatus::Ready);
        assert!(!manager.active_child_pids().is_empty());
        assert_eq!(failed.client_entry_url, entry.url);
        let detail = if startup {
            "forwarded health did not match this ready project"
        } else {
            "forwarded health no longer matches this performance"
        };
        assert!(failed.client_entry_error.unwrap().contains(detail));
        assert_eq!(
            manager.public_entry_snapshot().status,
            PublicEntryStatus::Error
        );
    }
}

#[test]
fn delayed_public_entry_failure_cannot_fault_a_stopped_or_replacement_performance() {
    for restart in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let _lease = setup_adapted_fixture(root.path());
        let app = fixture_app();
        let manager = SessionManager::default();
        let _cleanup = SessionCleanup(&manager, app.clone());
        let url = manager
            .prepare_host_entry(data.path(), "Entry Host", std::net::Ipv4Addr::LOCALHOST)
            .url
            .unwrap();
        start_fixture(&manager, &app, root.path(), data.path()).unwrap();
        assert_eq!(wait_finished(&manager).status, SessionStatus::Ready);
        let (generation, entry) = {
            let inner = manager.lock();
            (inner.generation, inner.participation_host.clone().unwrap())
        };
        std::fs::write(root.path().join("fail-entry"), "yes").unwrap();
        // Hold an actual failed HTTP observation before applying it. Stop can
        // cancel in-flight forwarding, so delaying only the network request
        // would not deterministically exercise a late result's ownership gate.
        let failure = entry.probe().expect_err("forwarding must really fail");
        manager.stop(&app).unwrap();
        if restart {
            std::fs::remove_file(root.path().join("fail-entry")).unwrap();
            start_fixture(&manager, &app, root.path(), data.path()).unwrap();
            assert_eq!(wait_finished(&manager).status, SessionStatus::Ready);
        }
        let before = manager.snapshot();
        let pids = manager.active_child_pids();
        let public = manager.public_entry_snapshot();
        let metadata = || -> serde_json::Value {
            serde_json::from_str(
                &ureq::get(format!("{url}__pnds/participation"))
                    .call()
                    .unwrap()
                    .into_body()
                    .read_to_string()
                    .unwrap(),
            )
            .unwrap()
        };
        let before_metadata = metadata();
        assert_eq!(
            public.status,
            if restart {
                PublicEntryStatus::Ready
            } else {
                PublicEntryStatus::Waiting
            }
        );
        assert!(Arc::ptr_eq(
            manager.lock().participation_host.as_ref().unwrap(),
            &entry
        ));
        assert!(!SessionManager::apply_public_entry_failure(
            &app,
            &manager.inner,
            generation,
            SessionStatus::Ready,
            &entry,
            failure,
        ));
        assert_eq!(manager.snapshot().status, before.status);
        assert!(manager.snapshot().client_entry_error.is_none());
        assert_eq!(manager.active_child_pids(), pids);
        assert_eq!(manager.public_entry_snapshot().status, public.status);
        assert_eq!(
            manager.public_entry_snapshot().url.as_deref(),
            Some(url.as_str())
        );
        assert_eq!(metadata(), before_metadata);
        if restart {
            assert_ne!(before.runtime_generation, generation.to_string());
            assert!(!pids.is_empty());
            assert_eq!(entry.probe().unwrap(), before.health.unwrap());
        }
    }
}

#[test]
fn host_entry_failure_is_separate_from_local_ready_and_requires_explicit_restart() {
    let root = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let _lease = setup_adapted_fixture(root.path());
    let app = tauri::test::mock_app().handle().clone();
    crate::events::events_builder().mount_events(&app);
    app.manage(crate::commands::preferences::PreferencesCache::for_test(
        crate::types::AppPreferences {
            node_name: Some("Entry Host".into()),
            ..Default::default()
        },
    ));
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    let lan = list_lan_addresses()
        .unwrap()
        .into_iter()
        .next()
        .expect("usable LAN interface");
    let start = || {
        manager.start(
            app.clone(),
            data.path().to_owned(),
            StartRequest::new(
                root.path().to_string_lossy().into_owned(),
                AudioMode::None,
                lan.clone(),
                None,
            ),
        )
    };
    std::fs::write(root.path().join("behavior.json"), "\"entry-unavailable\"").unwrap();
    start().unwrap();
    let first = wait_finished(&manager);
    assert_eq!(
        first.status,
        SessionStatus::Ready,
        "entry failure cannot stop a healthy local performance"
    );
    assert!(
        first.client_entry_error.is_some(),
        "an unverified entry cannot be advertised as ready"
    );
    assert!(!manager.active_child_pids().is_empty());
    let entry = first.client_entry_url.unwrap();
    manager.stop(&app).unwrap();
    std::fs::write(root.path().join("behavior.json"), "\"normal\"").unwrap();
    start().unwrap();
    let ready = wait_finished(&manager);
    assert_eq!(ready.status, SessionStatus::Ready);
    assert!(ready.client_entry_error.is_none());
    assert_eq!(ready.client_entry_url.as_deref(), Some(entry.as_str()));
    let owned = manager.active_child_pids();
    std::fs::write(root.path().join("fail-entry"), "yes").unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let failed = loop {
        let snapshot = manager.snapshot();
        if snapshot.client_entry_error.is_some() {
            break snapshot;
        }
        assert!(
            Instant::now() < deadline,
            "runtime entry fault never reported"
        );
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(failed.status, SessionStatus::Ready);
    assert_eq!(manager.active_child_pids(), owned);
    assert_eq!(failed.client_entry_url, ready.client_entry_url);
    let inspected =
        manager.prepare_host_entry(data.path(), "Next node", "192.0.2.99".parse().unwrap());
    assert_eq!(inspected.status, PublicEntryStatus::Error);
    assert_eq!(inspected.url, ready.client_entry_url);
    assert_eq!(manager.public_entry_snapshot().url, ready.client_entry_url);

    std::fs::remove_file(root.path().join("fail-entry")).unwrap();
    std::thread::sleep(Duration::from_millis(1200));
    assert!(
        manager.snapshot().client_entry_error.is_some(),
        "a failed entry cannot hot-recover or migrate"
    );
    manager.stop(&app).unwrap();
    start().unwrap();
    assert!(wait_finished(&manager).client_entry_error.is_none());
}

#[test]
fn unknown_runtime_port_declarations_fail_before_any_fixed_port_fallback() {
    let root = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let mut lease = reserve_adapted_fixture(root.path());
    let foreign = lease.take_listeners();
    let path = root.path().join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    let app = fixture_app();
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    for unsupported in [
        serde_json::Value::Null,
        serde_json::json!(2),
        serde_json::json!("1"),
        serde_json::json!(true),
        serde_json::json!({"version":1}),
    ] {
        manifest["scoreServer"]["runtimePorts"] = unsupported;
        let original = manifest.to_string();
        std::fs::write(&path, &original).unwrap();
        let error = start_fixture(&manager, &app, root.path(), data.path()).unwrap_err();
        assert!(
            error.starts_with("participation.errors.runtimePortsVersion"),
            "{error}"
        );
        assert!(manager.active_child_pids().is_empty());
        assert!(!root.path().join("observed-ports.json").exists());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    }
    assert!(foreign.iter().all(|listener| listener.local_addr().is_ok()));
}

#[test]
fn adapted_public_start_avoids_a_preferred_number_owned_only_on_ipv6_loopback() {
    let root = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let mut lease = reserve_adapted_fixture(root.path());
    let preferred = lease.values();
    let foreign =
        observed_fixture_bind((std::net::Ipv6Addr::LOCALHOST, preferred[0]).into()).unwrap();
    lease.release_for_start();
    let app = fixture_app();
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    start_fixture(&manager, &app, root.path(), data.path()).unwrap();
    let snapshot = wait_finished(&manager);
    assert_eq!(snapshot.status, SessionStatus::Ready, "{snapshot:?}");
    assert_ne!(snapshot.applied_ports.unwrap().performer_port, preferred[0]);
    assert_eq!(foreign.local_addr().unwrap().port(), preferred[0]);
}

#[test]
fn public_entry_stays_bound_through_stop_creation_and_client_activity() {
    let root = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let _ports = setup_adapted_fixture(root.path());
    let app = fixture_app();
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    let entry = manager.prepare_host_entry(data.path(), "Stage", std::net::Ipv4Addr::LOCALHOST);
    let url = entry.url.unwrap();
    let metadata = || -> serde_json::Value {
        serde_json::from_str(
            &ureq::get(format!("{url}__pnds/participation"))
                .call()
                .unwrap()
                .into_body()
                .read_to_string()
                .unwrap(),
        )
        .unwrap()
    };
    let identity = metadata()["hostId"].clone();
    assert!(metadata()["performance"].is_null());
    start_fixture(&manager, &app, root.path(), data.path()).unwrap();
    assert_eq!(wait_finished(&manager).status, SessionStatus::Ready);
    assert_eq!(
        manager.public_entry_snapshot().status,
        PublicEntryStatus::Ready
    );
    assert!(!metadata()["performance"].is_null());
    manager.stop(&app).unwrap();
    assert!(metadata()["performance"].is_null());
    assert_eq!(
        manager.public_entry_snapshot().url.as_deref(),
        Some(url.as_str())
    );
    manager
        .start(
            app.clone(),
            data.path().to_owned(),
            StartRequest::new(
                root.path().to_string_lossy().into_owned(),
                AudioMode::None,
                "192.0.2.1".into(),
                None,
            )
            .private(),
        )
        .unwrap();
    assert_eq!(wait_finished(&manager).status, SessionStatus::Ready);
    assert!(
        metadata()["performance"].is_null(),
        "Creation tests must stay private"
    );
    assert_eq!(
        manager.public_entry_snapshot().status,
        PublicEntryStatus::Waiting
    );
    let private = manager.snapshot();
    let performer_port = private.applied_ports.as_ref().unwrap().performer_port;
    let performer_url = format!("http://192.0.2.1:{performer_port}/");
    assert_eq!(
        manager
            .creation_performer_qr_url(&performer_url, &private.runtime_generation)
            .unwrap(),
        performer_url
    );
    assert!(manager
        .creation_performer_qr_url(&url, &private.runtime_generation)
        .is_err());
    assert!(private.performer_qr.is_none());
    manager.stop(&app).unwrap();
    assert!(manager
        .creation_performer_qr_url(&performer_url, &private.runtime_generation)
        .is_err());
    let client = crate::participation_client::ClientCoordinator::default();
    let inspected = tauri::async_runtime::block_on(client.inspect_guarded(
        url.clone(),
        identity.as_str().map(str::to_owned),
        || manager.has_active_session(),
    ))
    .unwrap();
    assert_eq!(
        inspected.phase,
        crate::participation_client::ClientPhase::Confirm
    );
    app.manage(client);
    assert!(
        !manager.has_active_session(),
        "An idle listener must not claim Host activity"
    );
    assert_eq!(metadata()["hostId"], identity);
    assert_eq!(
        manager.public_entry_snapshot().url.as_deref(),
        Some(url.as_str())
    );
}

#[test]
fn public_bind_failure_does_not_reject_a_healthy_local_project_start() {
    let root = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let _ports = setup_adapted_fixture(root.path());
    let saved = data.path().join("participation-host-port.json");
    std::fs::write(&saved, "invalid saved port").unwrap();
    let app = tauri::test::mock_app().handle().clone();
    crate::events::events_builder().mount_events(&app);
    app.manage(crate::commands::preferences::PreferencesCache::for_test(
        crate::types::AppPreferences {
            node_name: Some("Stage".into()),
            ..Default::default()
        },
    ));
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    start_fixture(&manager, &app, root.path(), data.path()).unwrap();
    assert_eq!(wait_finished(&manager).status, SessionStatus::Ready);
    assert!(!manager.active_child_pids().is_empty());
    let entry = manager.public_entry_snapshot();
    assert_eq!(entry.status, PublicEntryStatus::Error);
    assert!(
        entry.url.is_none(),
        "No address can be published before actual binding"
    );
    assert!(entry.error.unwrap().contains("hostEntryBind"));
    assert_eq!(
        std::fs::read_to_string(saved).unwrap(),
        "invalid saved port"
    );
}
