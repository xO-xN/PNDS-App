use super::*;
use std::fs;

fn fixture(test: Option<&str>) -> (tempfile::TempDir, PathBuf, ControlledCheckContext) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("score");
    fs::create_dir_all(root.join("test")).unwrap();
    fs::write(
        root.join("server.js"),
        "throw new Error('the score server must never run');",
    )
    .unwrap();
    fs::write(root.join("manifest.json"), r#"{"schemaVersion":1,"id":"test-score","name":"Tests","version":"1.0.0","scoreServer":{"entry":"server.js","workingDirectory":".","performerPort":6868,"monitorPort":6869},"audio":{"defaultMode":"internal","supportedModes":["internal"],"synthdefs":["not-required-by-tests.scsyndef"],"scsynth":{"blockSize":64,"audioBusChannels":128}}}"#).unwrap();
    fs::write(root.join("package.json"), "{\"type\":\"module\"}").unwrap();
    if let Some(test) = test {
        fs::write(root.join("test/behavior.test.js"), test).unwrap();
    }
    let context = ControlledCheckContext {
        task_id: "node-tests-fixture".into(),
        expected_source_identity: None,
        app_data_dir: temp.path().join("app-data"),
        shared_root: None,
        node_binary: crate::project::session::node_binary_path().unwrap(),
        scsynth_binary: None,
        plugins_dir: None,
        master_synthdef: None,
        test_audio_device: None,
        test_sclang: None,
    };
    (temp, root, context)
}

#[test]
fn controlled_node_tests_run_saved_copy_without_starting_score_or_publishing_writes() {
    let (_temp, root, context) = fixture(Some("import test from 'node:test'; import assert from 'node:assert/strict'; import {writeFileSync} from 'node:fs'; test('sustain',()=>{ writeFileSync('generated.txt','temporary'); assert.equal(2+2,4); });"));
    let report = run_controlled_node_tests(
        &root,
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |_| {},
    );
    assert_eq!(report.status, ControlledCheckStatus::Passed, "{report:?}");
    assert_eq!(
        report.node_tests.as_ref().unwrap().entries,
        ["test/behavior.test.js"]
    );
    assert_eq!(report.node_tests.as_ref().unwrap().exit_code, Some(0));
    assert!(!root.join("generated.txt").exists());
    assert!(report.health.is_none());
    assert!(report.environment.osc_target.is_none());
    assert!(report.cleanup.node_confirmed && report.cleanup.temporary_files_removed);
    assert!(report
        .output_tail
        .iter()
        .any(|line| line.contains("sustain")));
    assert!(report
        .freshness
        .as_ref()
        .is_some_and(|freshness| !freshness.stale));
}

#[test]
fn controlled_node_tests_keep_failure_exit_and_assertion_output() {
    let (_temp, root, context) = fixture(Some("import test from 'node:test'; import assert from 'node:assert/strict'; test('sustain invariant',()=>assert.equal('released','held'));"));
    let report = run_controlled_node_tests(
        &root,
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |_| {},
    );
    assert_eq!(report.status, ControlledCheckStatus::Failed, "{report:?}");
    assert_ne!(report.node_tests.as_ref().unwrap().exit_code, Some(0));
    assert!(report
        .output_tail
        .iter()
        .any(|line| line.contains("released")));
    assert!(report.cleanup.node_confirmed && report.cleanup.temporary_files_removed);
}

#[test]
fn controlled_node_tests_no_supported_entry_is_not_a_pass() {
    let (_temp, root, context) = fixture(None);
    let report = run_controlled_node_tests(
        &root,
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |_| {},
    );
    assert_eq!(report.status, ControlledCheckStatus::NotExecuted);
    assert!(report.node_tests.as_ref().unwrap().entries.is_empty());
    assert!(report.environment.node_version.is_none());
}

#[test]
fn controlled_node_tests_timeout_and_cancel_clean_owned_processes() {
    for cancel in [false, true] {
        let (_temp, root, context) = fixture(Some("import test from 'node:test'; test('never finishes',()=>new Promise(()=>setInterval(()=>{},1000)));"));
        let cancelled = AtomicBool::new(false);
        let options = ControlledCheckOptions {
            timeout_ms: 500,
            ..ControlledCheckOptions::default()
        };
        let report = run_controlled_node_tests(&root, &options, &context, &cancelled, |progress| {
            if cancel && progress.phase == ControlledCheckPhase::Starting {
                cancelled.store(true, Ordering::Release);
            }
        });
        assert_eq!(
            report.status,
            if cancel {
                ControlledCheckStatus::Cancelled
            } else {
                ControlledCheckStatus::Failed
            },
            "{report:?}"
        );
        assert!(report.cleanup.node_confirmed && report.cleanup.temporary_files_removed);
    }
}

#[test]
fn controlled_node_tests_bound_output_and_report_source_changes() {
    let (_temp, root, context) = fixture(Some("import test from 'node:test'; test('verbose',()=>{ for(let i=0;i<20000;i++)console.log('row '+i); });"));
    let report = run_controlled_node_tests(
        &root,
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |progress| {
            if progress.phase == ControlledCheckPhase::Starting {
                fs::write(root.join("server.js"), "// changed during test").unwrap();
            }
        },
    );
    assert_eq!(report.status, ControlledCheckStatus::Passed, "{report:?}");
    assert!(report.output_tail.len() <= 50);
    assert!(report
        .freshness
        .as_ref()
        .is_some_and(|freshness| freshness.stale));
}

#[test]
fn controlled_node_tests_missing_dependency_fails_without_installing() {
    let (_temp, root, context) = fixture(Some("import 'pnds-fixture-missing-dependency';"));
    let report = run_controlled_node_tests(
        &root,
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |_| {},
    );
    assert_eq!(report.status, ControlledCheckStatus::Failed);
    assert!(report
        .output_tail
        .iter()
        .any(|line| line.contains("ERR_MODULE_NOT_FOUND")));
    assert!(!root.join("node_modules").exists());
    assert!(!root.join("package-lock.json").exists());
    assert!(report.cleanup.node_confirmed && report.cleanup.temporary_files_removed);
}

#[test]
fn controlled_node_tests_cancel_after_test_process_has_started() {
    let (temp, root, context) = fixture(None);
    let marker = temp.path().join("test-started");
    let marker_literal = serde_json::to_string(&marker.to_string_lossy()).unwrap();
    // The explicitly temporary absolute marker lets the test wait for the real
    // child, without treating a start progress event as process evidence.
    fs::write(root.join("test/running.test.js"), format!("import test from 'node:test'; import {{writeFileSync}} from 'node:fs'; test('running',()=>{{ writeFileSync({marker_literal},'started'); return new Promise(()=>setInterval(()=>{{}},1000)); }});")).unwrap();
    let cancelled = AtomicBool::new(false);
    let report = std::thread::scope(|scope| {
        scope.spawn(|| {
            let deadline = Instant::now() + Duration::from_secs(5);
            while !marker.exists() {
                assert!(Instant::now() < deadline, "test child never started");
                std::thread::sleep(Duration::from_millis(10));
            }
            cancelled.store(true, Ordering::Release);
        });
        run_controlled_node_tests(
            &root,
            &ControlledCheckOptions::default(),
            &context,
            &cancelled,
            |_| {},
        )
    });
    assert!(marker.exists());
    assert_eq!(report.status, ControlledCheckStatus::Cancelled);
    assert!(report.cleanup.node_confirmed && report.cleanup.temporary_files_removed);
}
