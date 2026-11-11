//! Rendered ordinary-browser motion: actual bundled entry, Host and WK animations.
use super::*;

#[test]
#[ignore = "opens an owned visible WKWebView; explicit browser animation acceptance"]
fn plain_browser_entry_launches_while_fading_to_rotating_loader() {
    verify_browser_entry_motion(false);
}

#[test]
#[ignore = "opens an owned visible WKWebView; explicit reduced-motion browser acceptance"]
fn plain_browser_entry_keeps_essential_switch_motion_with_reduced_motion() {
    verify_browser_entry_motion(true);
}

fn verify_browser_entry_motion(reduced_motion: bool) {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let c = tempfile::tempdir().unwrap();
    let _a_ports = browser_project(a.path());
    let _b_ports = browser_project(b.path());
    let _c_ports = browser_project(c.path());
    for root in [b.path(), c.path()] {
        std::fs::write(
            root.join("browser-score.js"),
            "fetch(PNDS_PARTICIPATION.resource('preparation.json')).then(r=>{if(!r.ok)throw Error('Required resource failed');PNDS_PARTICIPATION.reportPrepared()});",
        )
        .unwrap();
    }
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
    let first = start(a.path());
    let mut browser = start_browser_with_visibility(
        evidence.path(),
        &first.client_entry_url.unwrap(),
        &format!(
            "globalThis.PNDS_TEST_REDUCED_MOTION = {reduced_motion};\n{}",
            include_str!("browser-animation-driver.js")
        ),
        true,
    );
    wait_browser_phase(&mut browser, evidence.path(), "first");
    manager.stop(&app).unwrap();
    start(b.path());
    wait_browser_phase(&mut browser, evidence.path(), "loading");
    std::fs::remove_file(b.path().join("hold-preparation")).unwrap();
    wait_browser_phase(&mut browser, evidence.path(), "second");
    manager.stop(&app).unwrap();
    start(c.path());
    finish_browser(&mut browser, evidence.path());
    println!("PASS real WK slower entry/crossfade, full offscreen slingshot flight, rotating loader, fast-preparation gate, background touch cancellation and unchanged score-iframe touch; reduced_motion={reduced_motion}");
}
