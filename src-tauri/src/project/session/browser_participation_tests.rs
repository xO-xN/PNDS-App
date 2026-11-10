//! Highest-level owned Host start, real Node and ordinary-browser boundaries.
#[path = "asbs_participation_tests.rs"]
mod asbs;
#[path = "classic_participation_tests.rs"]
mod classic_participation_tests;
#[path = "maintained_scores_participation_tests.rs"]
mod maintained_scores;
#[path = "browser_metadata_fault_tests.rs"]
mod metadata_fault_tests;
#[path = "saved_entry_tests.rs"]
mod saved_entry_tests;

#[path = "utility_participation_tests.rs"]
mod utility_participation_tests;

use super::runtime_ports_tests::{wait_finished, SessionCleanup};
use super::*;
use crate::project::creation::{CreationAccess, NewProjectOptions, Protection};
use std::io::Read;
use tauri::Manager;

fn create_blank(parent: &Path) -> PathBuf {
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let workspace = access
        .create_blank(
            &NewProjectOptions {
                parent: parent.to_string_lossy().into_owned(),
                folder_name: "blank".into(),
                name: "Browser Blank".into(),
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
    PathBuf::from(workspace.project.root)
}

fn lan() -> String {
    list_lan_addresses()
        .unwrap()
        .into_iter()
        .next()
        .expect("owned Host test requires LAN interface")
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .proxy(None)
        .max_redirects(0)
        .timeout_global(Some(Duration::from_secs(4)))
        .build()
        .into()
}

#[tokio::test]
async fn newly_created_blank_runs_through_public_host_entry_with_browser_confirmation() {
    let projects = tempfile::tempdir().unwrap();
    let root = create_blank(projects.path());
    let data = tempfile::tempdir().unwrap();
    let app = tauri::test::mock_app().handle().clone();
    crate::events::events_builder().mount_events(&app);
    app.manage(crate::commands::preferences::PreferencesCache::for_test(
        crate::types::AppPreferences {
            node_name: Some("Blank Host".into()),
            ..Default::default()
        },
    ));
    app.manage(SessionManager::default());
    let manager = app.state::<SessionManager>();
    let _cleanup = SessionCleanup(&manager, app.clone());
    manager
        .start(
            app.clone(),
            data.path().to_owned(),
            StartRequest::new(
                root.to_string_lossy().into_owned(),
                AudioMode::None,
                lan(),
                None,
            ),
        )
        .unwrap();
    let snapshot = wait_finished(&manager);
    assert_eq!(snapshot.status, SessionStatus::Ready, "{snapshot:?}");
    let entry = snapshot.client_entry_url.unwrap();
    let page = agent()
        .get(&entry)
        .call()
        .unwrap()
        .into_body()
        .read_to_string()
        .unwrap();
    assert!(page.contains("data-state=\"ready\""), "{page}");
    let action = page
        .split("action=\"")
        .nth(1)
        .unwrap()
        .split('"')
        .next()
        .unwrap();
    let response = agent()
        .post(format!("{}{action}", entry.trim_end_matches('/')))
        .send_empty()
        .unwrap();
    assert_eq!(response.status(), hyper::StatusCode::SEE_OTHER);
    let path = response
        .headers()
        .get("location")
        .unwrap()
        .to_str()
        .unwrap();
    let url = format!("{}{path}", entry.trim_end_matches('/'));
    let page = agent()
        .get(&url)
        .call()
        .unwrap()
        .into_body()
        .read_to_string()
        .unwrap();
    assert!(page.contains("./performer.js"));
    for resource in [
        "performer.js",
        "style.css",
        "socket.io/socket.io.js",
        "__pnds/context.js",
    ] {
        let mut response = agent()
            .get(format!("{url}{resource}"))
            .call()
            .unwrap()
            .into_body()
            .into_reader();
        let mut bytes = Vec::new();
        response.read_to_end(&mut bytes).unwrap();
        assert!(!bytes.is_empty(), "{resource}");
    }
    assert!(manager.snapshot().channel_plan.is_none());

    // The Host and Client must use independent App state: the same-App role
    // gate remains active while a different App inspects this public address.
    use crate::participation_client::{ClientCoordinator, ClientHostInfo, ClientPhase};
    let metadata: ClientHostInfo = serde_json::from_str(
        &agent()
            .get(format!("{entry}__pnds/participation"))
            .call()
            .unwrap()
            .into_body()
            .read_to_string()
            .unwrap(),
    )
    .unwrap();
    let client_app = tauri::test::mock_app().handle().clone();
    client_app.manage(SessionManager::default());
    client_app.manage(ClientCoordinator::default());
    let client = client_app.state::<ClientCoordinator>();
    struct ClientCleanup<'a>(&'a ClientCoordinator);
    impl Drop for ClientCleanup<'_> {
        fn drop(&mut self) {
            self.0.leave();
        }
    }
    let _client_cleanup = ClientCleanup(&client);
    assert!(app.state::<SessionManager>().has_active_session());
    let inspected = client
        .inspect_guarded(entry.clone(), None, || {
            client_app.state::<SessionManager>().has_active_session()
        })
        .await
        .unwrap();
    assert_eq!(inspected.phase, ClientPhase::Confirm);
    assert_eq!(inspected.host.as_ref(), Some(&metadata));
    let client_data = tempfile::tempdir().unwrap();
    let joined = client.join(client_data.path()).await.unwrap();
    assert_eq!(joined.phase, ClientPhase::Open, "{joined:?}");
    assert_eq!(joined.host.as_ref(), Some(&metadata));
    let native = client.view_target().unwrap();
    assert_eq!(joined.page_url.as_deref(), Some(native.page_url.as_str()));
    assert_ne!(native.page_url, url);
    let private_origin = reqwest::Url::parse(&native.page_url).unwrap();
    assert_ne!(
        private_origin.origin(),
        reqwest::Url::parse(&entry).unwrap().origin()
    );
    let native_browser = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(format!("http://{}", native.proxy_address)).unwrap())
        .build()
        .unwrap();
    let page = native_browser
        .get(&native.page_url)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(page.contains("./performer.js"));
    let context = native_browser
        .get(private_origin.join("__pnds/context.js").unwrap())
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .text()
        .await
        .unwrap();
    let performance = metadata.performance.as_ref().unwrap();
    for (field, expected) in [
        ("hostId", metadata.host_id.as_str()),
        ("projectId", performance.project_id.as_str()),
        ("performanceId", performance.performance_id.as_str()),
        ("basePath", "/"),
    ] {
        let value = serde_json::to_string(expected).unwrap();
        assert!(
            context.contains(&format!("\"{field}\":{value}")),
            "{context}"
        );
    }
    let local_host = client_app.state::<SessionManager>();
    assert!(!local_host.has_active_session());
    assert_eq!(local_host.snapshot().status, SessionStatus::Idle);
    assert!(local_host.snapshot().channel_plan.is_none());
    assert!(local_host.active_child_pids().is_empty());
    assert!(app.state::<SessionManager>().has_active_session());
    assert_eq!(client.leave().phase, ClientPhase::Idle);
    assert!(client.view_target().is_none());
}

struct BrowserProcess(crate::project::children::SupervisedChild);
impl Drop for BrowserProcess {
    fn drop(&mut self) {
        self.0.shutdown(Duration::from_secs(2));
    }
}
fn start_browser(directory: &Path, url: &str, driver: &str) -> BrowserProcess {
    start_browser_with_visibility(directory, url, driver, false)
}
fn start_browser_with_visibility(
    directory: &Path,
    url: &str,
    driver: &str,
    visible: bool,
) -> BrowserProcess {
    let binary = directory.join("browser-fixture");
    let source =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/browser-participation-fixture.m");
    let output = Command::new("clang")
        .args(["-fobjc-arc", "-mmacosx-version-min=13.5"])
        .arg(source)
        .args(["-framework", "Cocoa", "-framework", "WebKit", "-o"])
        .arg(&binary)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let source = directory.join("driver.js");
    std::fs::write(&source, driver).unwrap();
    let mut command = Command::new(binary);
    command
        .arg(url)
        .arg(source)
        .arg(directory)
        .stdout(std::fs::File::create(directory.join("browser.stdout")).unwrap())
        .stderr(std::fs::File::create(directory.join("browser.stderr")).unwrap());
    if visible {
        command.arg("--visible");
    }
    let registry =
        crate::project::children::ChildRegistry::new(directory.join("browser-registry.json"));
    BrowserProcess(
        crate::project::children::SupervisedChild::spawn(
            &registry,
            "browser-participation-proof",
            &mut command,
        )
        .unwrap(),
    )
}
fn wait_browser_phase(browser: &mut BrowserProcess, directory: &Path, phase: &str) {
    let deadline = Instant::now() + Duration::from_secs(35);
    while !directory.join(format!("{phase}.json")).exists() {
        let status = browser.0.try_wait().unwrap();
        assert!(
            status.is_none() && Instant::now() < deadline,
            "browser {status:?}: {}",
            std::fs::read_to_string(directory.join("browser.stderr")).unwrap()
        );
        std::thread::sleep(Duration::from_millis(30));
    }
}
fn finish_browser(browser: &mut BrowserProcess, directory: &Path) {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if let Some(status) = browser.0.try_wait().unwrap() {
            assert!(
                status.success(),
                "{}",
                std::fs::read_to_string(directory.join("browser.stderr")).unwrap()
            );
            assert!(std::fs::read_to_string(directory.join("browser.stdout"))
                .unwrap()
                .contains("\"passed\":true"));
            break;
        }
        assert!(
            Instant::now() < deadline,
            "browser did not finish: {}",
            std::fs::read_to_string(directory.join("browser.stderr")).unwrap()
        );
        std::thread::sleep(Duration::from_millis(30));
    }
}
fn host_app() -> AppHandle<tauri::test::MockRuntime> {
    let app = tauri::test::mock_app().handle().clone();
    crate::events::events_builder().mount_events(&app);
    app.manage(crate::commands::preferences::PreferencesCache::for_test(
        crate::types::AppPreferences {
            node_name: Some("Browser Host".into()),
            ..Default::default()
        },
    ));
    app
}
fn browser_project(root: &Path) -> crate::test_support::FixturePorts<2> {
    let ports = super::runtime_ports_tests::setup_adapted_fixture(root);
    let path = root.join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    manifest["scoreServer"]["browserParticipation"] = 1.into();
    std::fs::write(path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let modules = Path::new(env!("CARGO_MANIFEST_DIR")).join("../node_modules/socket.io");
    std::fs::write(
        root.join("io-module.json"),
        serde_json::to_vec(&modules.to_string_lossy()).unwrap(),
    )
    .unwrap();
    std::fs::write(root.join("browser-page.html"), "<!doctype html><script src='./__pnds/context.js'></script><script src='./socket.io/socket.io.js'></script><script src='./score.js'></script>").unwrap();
    std::fs::write(
        root.join("browser-score.js"),
        include_str!("browser-score-fixture.js"),
    )
    .unwrap();
    std::fs::write(
        root.join("browser-worker.js"),
        include_str!("browser-worker-fixture.js"),
    )
    .unwrap();
    ports
}

#[test]
#[ignore = "opens an owned plain WKWebView; explicit native integration acceptance"]
fn plain_browser_real_document_worker_socketio_and_identity_survive_host_replacement() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let _a_ports = browser_project(a.path());
    let _b_ports = browser_project(b.path());
    let data = tempfile::tempdir().unwrap();
    let evidence = tempfile::tempdir().unwrap();
    let app = host_app();
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    let start = |root: &Path| {
        manager
            .start(
                app.clone(),
                data.path().to_owned(),
                StartRequest::new(
                    root.to_string_lossy().into_owned(),
                    AudioMode::None,
                    lan(),
                    None,
                ),
            )
            .unwrap();
        let snapshot = wait_finished(&manager);
        assert_eq!(snapshot.status, SessionStatus::Ready, "{snapshot:?}");
        snapshot
    };
    let original = start(a.path());
    let url = original.client_entry_url.unwrap();
    let mut browser = start_browser(
        evidence.path(),
        &url,
        include_str!("browser-entry-driver.js"),
    );
    wait_browser_phase(&mut browser, evidence.path(), "first");
    manager.stop(&app).unwrap();
    let actual = original.applied_ports.unwrap();
    let occupied = std::net::TcpListener::bind(("0.0.0.0", actual.performer_port)).unwrap();
    let path = b.path().join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    manifest["scoreServer"]["performerPort"] = actual.performer_port.into();
    std::fs::write(path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let replacement = start(b.path());
    assert_eq!(replacement.client_entry_url.as_deref(), Some(url.as_str()));
    assert_ne!(
        replacement.applied_ports.unwrap().performer_port,
        actual.performer_port
    );
    wait_browser_phase(&mut browser, evidence.path(), "second");
    manager.stop(&app).unwrap();
    drop(occupied);
    start(a.path());
    wait_browser_phase(&mut browser, evidence.path(), "third");
    finish_browser(&mut browser, evidence.path());
    for root in [a.path(), b.path()] {
        let received = std::fs::read_to_string(root.join("received.ndjson")).unwrap();
        assert!(
            !received.contains("forbidden-old"),
            "old document reached replacement: {received}"
        );
        assert!(received
            .lines()
            .any(|line| line.contains("asset.json?part=7") && line.contains("\"native\":false")));
    }
    println!("PASS real ordinary WKWebView, public Host start, queried assets, live Worker, Socket.IO polling/WS, old Document fences, A→B→A identity recovery");
}

#[test]
#[ignore = "opens an owned plain WKWebView; explicit Blank browser acceptance"]
fn plain_browser_created_blank_reports_actual_page_preparation() {
    let projects = tempfile::tempdir().unwrap();
    let root = create_blank(projects.path());
    let data = tempfile::tempdir().unwrap();
    let evidence = tempfile::tempdir().unwrap();
    let app = host_app();
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    manager
        .start(
            app.clone(),
            data.path().to_owned(),
            StartRequest::new(
                root.to_string_lossy().into_owned(),
                AudioMode::None,
                lan(),
                None,
            ),
        )
        .unwrap();
    let snapshot = wait_finished(&manager);
    assert_eq!(snapshot.status, SessionStatus::Ready, "{snapshot:?}");
    let driver = r#"async function verifyBrowserEntry() {
        const form = document.querySelector('form'); if (!form) throw new Error('Blank is not compatible');
        form.requestSubmit(); const deadline=Date.now()+10000; let frame;
        while(!(frame=document.querySelector('iframe[data-pnds-current]'))) {if(Date.now()>deadline) throw new Error('Blank did not prepare'); await new Promise(r=>setTimeout(r,20));}
        const context=frame.contentWindow.PNDS_PARTICIPATION; if(context.preparation?.performanceId!==context.performanceId) throw new Error('Wrong preparation context');
        return {passed:true,preparation:context.preparation,project:frame.contentDocument.querySelector('h1').textContent};
    }"#;
    let mut browser = start_browser(evidence.path(), &snapshot.client_entry_url.unwrap(), driver);
    finish_browser(&mut browser, evidence.path());
}

#[test]
#[ignore = "opens an owned plain WKWebView; browser continuity acceptance"]
fn plain_browser_entry_keeps_document_and_discovers_restart_without_preloading() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let _a_ports = browser_project(a.path());
    let _b_ports = browser_project(b.path());
    let data = tempfile::tempdir().unwrap();
    let evidence = tempfile::tempdir().unwrap();
    let app = host_app();
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    let start = |root: &Path| {
        manager
            .start(
                app.clone(),
                data.path().to_owned(),
                StartRequest::new(
                    root.to_string_lossy().into_owned(),
                    AudioMode::None,
                    lan(),
                    None,
                ),
            )
            .unwrap();
        let snapshot = wait_finished(&manager);
        assert_eq!(snapshot.status, SessionStatus::Ready, "{snapshot:?}");
        snapshot
    };
    let original = start(a.path());
    let mut browser = start_browser(
        evidence.path(),
        &original.client_entry_url.unwrap(),
        include_str!("browser-continuity-driver.js"),
    );
    wait_browser_phase(&mut browser, evidence.path(), "first");
    manager.stop(&app).unwrap();
    wait_browser_phase(&mut browser, evidence.path(), "idle");
    start(b.path());
    wait_browser_phase(&mut browser, evidence.path(), "second");
    assert!(
        !b.path().join("received.ndjson").exists()
            || std::fs::read_to_string(b.path().join("received.ndjson"))
                .unwrap()
                .lines()
                .all(|line| line.contains("__pnds/health"))
    );
    manager.stop(&app).unwrap();
    wait_browser_phase(&mut browser, evidence.path(), "stopped");
    start(a.path());
    wait_browser_phase(&mut browser, evidence.path(), "third");
    finish_browser(&mut browser, evidence.path());
}

#[test]
#[ignore = "opens an owned plain WKWebView; browser switch acceptance"]
fn plain_browser_failed_candidate_keeps_original_document_and_can_cancel_and_retry() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let _a_ports = browser_project(a.path());
    let _b_ports = browser_project(b.path());
    std::fs::write(
        b.path().join("browser-score.js"),
        "throw new Error('Controlled required script failure')",
    )
    .unwrap();
    let data = tempfile::tempdir().unwrap();
    let evidence = tempfile::tempdir().unwrap();
    let app = host_app();
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    let start = |root: &Path| {
        manager
            .start(
                app.clone(),
                data.path().to_owned(),
                StartRequest::new(
                    root.to_string_lossy().into_owned(),
                    AudioMode::None,
                    lan(),
                    None,
                ),
            )
            .unwrap();
        let snapshot = wait_finished(&manager);
        assert_eq!(snapshot.status, SessionStatus::Ready, "{snapshot:?}");
        snapshot
    };
    let original = start(a.path());
    let mut browser = start_browser(
        evidence.path(),
        &original.client_entry_url.unwrap(),
        include_str!("browser-switch-driver.js"),
    );
    wait_browser_phase(&mut browser, evidence.path(), "first");
    manager.stop(&app).unwrap();
    start(b.path());
    wait_browser_phase(&mut browser, evidence.path(), "failed");
    manager.stop(&app).unwrap();
    std::fs::write(
        b.path().join("browser-score.js"),
        include_str!("browser-score-fixture.js"),
    )
    .unwrap();
    std::fs::write(b.path().join("hold-preparation"), "hold").unwrap();
    start(b.path());
    wait_browser_phase(&mut browser, evidence.path(), "cancelled");
    let closed = Instant::now() + Duration::from_secs(3);
    loop {
        let events = std::fs::read_to_string(b.path().join("socket-events.ndjson")).unwrap();
        if events
            .lines()
            .filter(|line| line.contains("disconnected"))
            .count()
            >= 2
        {
            break;
        }
        assert!(
            Instant::now() < closed,
            "Cancelled candidate left real Socket.IO connections alive: {events}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    std::fs::remove_file(b.path().join("hold-preparation")).unwrap();
    wait_browser_phase(&mut browser, evidence.path(), "second");
    finish_browser(&mut browser, evidence.path());
}

#[test]
#[ignore = "opens an owned plain WKWebView; browser candidate race acceptance"]
fn plain_browser_candidate_change_does_not_reuse_the_displayed_entry_action() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let c = tempfile::tempdir().unwrap();
    let _a_ports = browser_project(a.path());
    let _b_ports = browser_project(b.path());
    let _c_ports = browser_project(c.path());
    std::fs::write(b.path().join("hold-preparation"), "hold").unwrap();
    let data = tempfile::tempdir().unwrap();
    let evidence = tempfile::tempdir().unwrap();
    let app = host_app();
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    let start = |root: &Path| {
        manager
            .start(
                app.clone(),
                data.path().to_owned(),
                StartRequest::new(
                    root.to_string_lossy().into_owned(),
                    AudioMode::None,
                    lan(),
                    None,
                ),
            )
            .unwrap();
        let snapshot = wait_finished(&manager);
        assert_eq!(snapshot.status, SessionStatus::Ready, "{snapshot:?}");
        snapshot
    };
    let original = start(a.path());
    let mut browser = start_browser(
        evidence.path(),
        &original.client_entry_url.unwrap(),
        include_str!("browser-race-driver.js"),
    );
    wait_browser_phase(&mut browser, evidence.path(), "first");
    manager.stop(&app).unwrap();
    start(b.path());
    wait_browser_phase(&mut browser, evidence.path(), "pending");
    manager.stop(&app).unwrap();
    start(c.path());
    wait_browser_phase(&mut browser, evidence.path(), "second");
    finish_browser(&mut browser, evidence.path());
    let received = std::fs::read_to_string(c.path().join("received.ndjson")).unwrap();
    assert!(
        !received.contains("forbidden-old"),
        "Retained A reached C: {received}"
    );
}
