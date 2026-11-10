//! Explicit real maintained-ASBS/browser acceptance; no development server.
use super::*;
#[path = "../../asbs_fixture.rs"]
mod source;

#[test]
#[ignore = "opens an owned WK browser and requires built PNDS_ASBS_SOURCE"]
fn plain_browser_actual_asbs_prepares_before_handoff_and_scrolls_after_host_stop() {
    let a = tempfile::tempdir().unwrap();
    let _ports = browser_project(a.path());
    let c = tempfile::tempdir().unwrap();
    let _c_ports = browser_project(c.path());
    let projects = tempfile::tempdir().unwrap();
    let asbs = source::project(projects.path());
    let data = tempfile::tempdir().unwrap();
    let evidence = tempfile::Builder::new()
        .prefix("pnds-asbs-browser-")
        .tempdir()
        .unwrap()
        .keep();
    println!("ASBS browser evidence: {}", evidence.display());
    let app = host_app();
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    let start = |root: &Path| {
        manager
            .start(
                app.clone(),
                data.path().into(),
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
    let first = start(a.path());
    let driver = include_str!("asbs-browser-driver.js");
    let mut browser =
        start_browser_with_visibility(&evidence, &first.client_entry_url.unwrap(), driver, true);
    wait_browser_phase(&mut browser, &evidence, "first");
    start(&asbs);
    source::hide_middle(&asbs);
    wait_browser_phase(&mut browser, &evidence, "failed");
    source::restore_middle(&asbs);
    wait_browser_phase(&mut browser, &evidence, "pending");
    start(c.path());
    wait_browser_phase(&mut browser, &evidence, "race");
    start(&asbs);
    wait_browser_phase(&mut browser, &evidence, "prepared");
    start(c.path());
    wait_browser_phase(&mut browser, &evidence, "active-candidate");
    manager.stop(&app).unwrap();
    // The real full-part render deliberately advances thousands of frames.
    // This fixture deadline is separate from the unchanged 20s entry contract.
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        if let Some(status) = browser.0.try_wait().unwrap() {
            assert!(
                status.success(),
                "{}",
                std::fs::read_to_string(evidence.join("browser.stderr")).unwrap()
            );
            assert!(std::fs::read_to_string(evidence.join("browser.stdout"))
                .unwrap()
                .contains("\"passed\":true"));
            break;
        }
        assert!(
            Instant::now() < deadline,
            "ASBS full-part render exceeded fixture deadline: {}",
            std::fs::read_to_string(evidence.join("browser.stderr")).unwrap()
        );
        std::thread::sleep(Duration::from_millis(30));
    }
}
