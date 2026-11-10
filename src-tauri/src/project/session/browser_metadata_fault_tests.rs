//! A test-owned HTTP fault boundary forwards the actual Host entry unchanged.
//! Only metadata failures are injected; the score still comes from SessionManager.
use super::*;

#[test]
#[ignore = "opens an owned ordinary WKWebView through metadata faults"]
fn plain_browser_entry_preserves_real_document_across_metadata_faults_and_recovery() {
    let project = tempfile::tempdir().unwrap();
    let _ports = browser_project(project.path());
    // This score deliberately has an unsaved clock and no reconnection policy.
    // Its preparation report follows its own required initialization.
    std::fs::write(
        project.path().join("browser-score.js"),
        "window.documentToken=Math.random().toString(36);window.localTicks=0;setInterval(()=>window.localTicks++,10);PNDS_PARTICIPATION.reportPrepared();",
    )
    .unwrap();
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
                project.path().to_string_lossy().into_owned(),
                AudioMode::None,
                lan(),
                None,
            ),
        )
        .unwrap();
    let snapshot = wait_finished(&manager);
    assert_eq!(snapshot.status, SessionStatus::Ready, "{snapshot:?}");
    let source = evidence.path().join("fault-entry.cjs");
    std::fs::write(&source, include_str!("browser-metadata-fault-fixture.cjs")).unwrap();
    let registry = crate::project::children::ChildRegistry::new(
        evidence.path().join("fault-entry-registry.json"),
    );
    let mut command = Command::new("node");
    command
        .arg(source)
        .arg(snapshot.client_entry_url.unwrap())
        .arg(evidence.path())
        .stdout(std::fs::File::create(evidence.path().join("fault-entry.stdout")).unwrap())
        .stderr(std::fs::File::create(evidence.path().join("fault-entry.stderr")).unwrap());
    let mut faults = BrowserProcess(
        crate::project::children::SupervisedChild::spawn(
            &registry,
            "browser-metadata-faults",
            &mut command,
        )
        .unwrap(),
    );
    let ready = evidence.path().join("fault-entry-url.txt");
    let deadline = Instant::now() + Duration::from_secs(5);
    while !ready.exists() {
        assert!(
            faults.0.try_wait().unwrap().is_none() && Instant::now() < deadline,
            "{}",
            std::fs::read_to_string(evidence.path().join("fault-entry.stderr")).unwrap()
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    let url = std::fs::read_to_string(ready).unwrap();
    let mut browser = start_browser(
        evidence.path(),
        &url,
        include_str!("browser-metadata-fault-driver.js"),
    );
    finish_browser(&mut browser, evidence.path());
    println!("PASS actual Host entry and ordinary browser: timeout, HTTP failure, malformed/incompatible metadata, different Host, same-Document recovery and advancing unsaved clock");
}
