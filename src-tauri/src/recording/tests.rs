use super::*;
use crate::test_support::{FixturePorts, OwnedNodeFixture};
use std::process::Command;

fn test_store(data: &Path, key: &str) -> RecordingStore {
    RecordingStore::app_local(data, key).unwrap()
}

#[test]
fn unsupported_project_does_not_gain_recording_capability() {
    let root = tempfile::tempdir().unwrap();
    assert!(launch_source(root.path()).unwrap().is_none());
}

#[test]
fn source_fingerprint_preserves_existing_bytes_and_tracks_large_resources() {
    let root = tempfile::tempdir().unwrap();
    for directory in ["assets", "docs", "empty", "node_modules"] {
        fs::create_dir(root.path().join(directory)).unwrap();
    }
    fs::write(root.path().join("manifest.json"), br#"{"schemaVersion":2,"id":"fingerprint-fixture","name":"Fingerprint","version":"0.1.0","scoreServer":{"entry":"server.js","workingDirectory":".","performerPort":6000,"monitorPort":6001},"audio":{"defaultMode":"none","supportedModes":["none"]}}"#).unwrap();
    fs::write(
        root.path().join("pnds.recording.json"),
        br#"{"protocolVersion":1,"adapterId":"fingerprint-v1"}"#,
    )
    .unwrap();
    fs::write(root.path().join("server.js"), b"// score fixture\n").unwrap();
    fs::write(root.path().join("docs/notes.txt"), b"creator notes\n").unwrap();
    fs::write(root.path().join("assets/音色.bin"), [0, 255, 128]).unwrap();
    let mut resource: Vec<u8> = (0..70_001).map(|index| (index % 251) as u8).collect();
    fs::write(root.path().join("assets/large.bin"), &resource).unwrap();
    fs::write(
        root.path().join("node_modules/ignored.js"),
        b"installed dependency",
    )
    .unwrap();

    let source = launch_source(root.path()).unwrap().unwrap();
    // Pinned before the hashing implementation changed. Includes path/type/size
    // framing, an empty directory, UTF-8 paths and multiple 32KiB read chunks.
    assert_eq!(
        source.source.content_digest,
        "sha256:741388edda3cc6d62400b3d2df027bf79479cdcf9191d7a24af72a212f302c80"
    );
    verify_launch_source(root.path(), &source).unwrap();
    fs::write(
        root.path().join("node_modules/ignored.js"),
        b"dependency changed",
    )
    .unwrap();
    verify_launch_source(root.path(), &source).unwrap();

    let private = root.path().join(".PNDS-CREATION/recordings");
    fs::create_dir_all(&private).unwrap();
    let record = private.join("record.json");
    fs::write(&record, b"private recording").unwrap();
    verify_launch_source(root.path(), &source).unwrap();
    std::os::unix::fs::symlink(&private, root.path().join("recordings-alias")).unwrap();
    std::os::unix::fs::symlink(&record, root.path().join("record-alias.json")).unwrap();
    verify_launch_source(root.path(), &source).unwrap();
    fs::write(&record, b"updated recording").unwrap();
    verify_launch_source(root.path(), &source).unwrap();

    // Same-sized edits past the first two chunks must still invalidate source.
    resource[65_536] ^= 1;
    fs::write(root.path().join("assets/large.bin"), &resource).unwrap();
    assert!(verify_launch_source(root.path(), &source).is_err());
    resource[65_536] ^= 1;
    fs::write(root.path().join("assets/large.bin"), &resource).unwrap();
    fs::write(root.path().join("docs/notes.txt"), b"updated notes\n").unwrap();
    assert!(verify_launch_source(root.path(), &source).is_err());

    let linked = tempfile::tempdir().unwrap();
    let linked_source = linked.path().join("library.js");
    fs::write(&linked_source, b"// original source\n").unwrap();
    std::os::unix::fs::symlink(&linked_source, root.path().join("library-alias.js")).unwrap();
    let source = launch_source(root.path()).unwrap().unwrap();
    fs::write(&linked_source, b"// modified source\n").unwrap();
    assert!(verify_launch_source(root.path(), &source).is_err());
}

async fn fixture() -> (OwnedNodeFixture, u16) {
    fixture_with_adapter(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/performance-recording/adapter.cjs"),
    )
    .await
}

async fn fixture_with_adapter(adapter: &Path) -> (OwnedNodeFixture, u16) {
    let ports = FixturePorts::<2>::reserve("recording-public-controls").unwrap();
    let values = ports.values();
    let mut command = Command::new(crate::project::session::node_binary_path().unwrap());
    command
        .arg("-e")
        .arg(include_str!("fixture.cjs"))
        .env(
            "PNDS_FIXTURE_PORTS",
            serde_json::to_string(&values).unwrap(),
        )
        .env("RECORDING_ADAPTER", adapter);
    let mut fixture = OwnedNodeFixture::spawn(ports, command).unwrap();
    fixture.ready().await.unwrap();
    (fixture, values[0])
}

fn target(port: u16) -> RecordingTarget {
    RecordingTarget {
        project_path: "/score".into(),
        port,
        generation: "1".into(),
        launch: LaunchSource {
            directory: Arc::new(File::open(std::env::temp_dir()).unwrap()),
            project_key: "physical-project-one".into(),
            source: RecordingSource {
                project_id: "fixture".into(),
                project_name: "Fixture".into(),
                content_digest: "sha256:original".into(),
                adapter: RecordingCapability {
                    protocol_version: 1,
                    adapter_id: "fixture-v1".into(),
                },
            },
        },
    }
}

#[tokio::test]
async fn migrated_recording_replays_after_project_move_and_keeps_legacy_bytes_unchanged() {
    use std::sync::atomic::{AtomicU32, Ordering};
    let (mut fixture, port) = fixture().await;
    let data = tempfile::tempdir().unwrap();
    let files = tempfile::tempdir().unwrap();
    let root = files.path().join("original");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("manifest.json"), json!({
        "schemaVersion":1,"id":"portable-recording","name":"Portable recording","version":"1.0.0",
        "scoreServer":{"entry":"server.js","workingDirectory":".","performerPort":6000,"monitorPort":6001},
        "audio":{"defaultMode":"none","supportedModes":["none"]}
    }).to_string()).unwrap();
    fs::write(root.join("server.js"), "// portable recording fixture\n").unwrap();
    fs::write(
        root.join("pnds.recording.json"),
        r#"{"protocolVersion":1,"adapterId":"fixture-v1"}"#,
    )
    .unwrap();
    let launch = launch_source(&root).unwrap().unwrap();
    let digest = launch.source.content_digest.clone();
    let mut run = target(port);
    run.project_path = root.to_string_lossy().into_owned();
    run.launch = launch;
    let clock = Arc::new(AtomicU32::new(0));
    let manager = RecordingManager::with_clock({
        let clock = clock.clone();
        Arc::new(move || clock.load(Ordering::SeqCst))
    });
    // Simulate a record saved by the previous App before migration.
    let old = test_store(data.path(), &run.launch.project_key);
    manager
        .begin(&old, run.clone(), "recording", None, None, false, true)
        .unwrap();
    assert!(play(port, Some("phone-A"), json!("portable-performance")));
    clock.store(200, Ordering::SeqCst);
    manager.stop(false).unwrap();
    let record = manager.list(&old).unwrap().remove(0);
    let name = format!("{}.json", record.id);
    let old_file = old.reveal_path().unwrap().join(&name);
    let original_bytes = fs::read(&old_file).unwrap();
    let portable = RecordingStore::project_at(
        data.path(),
        &root.canonicalize().unwrap(),
        &File::open(&root).unwrap(),
    )
    .unwrap();
    assert_eq!(manager.list(&portable).unwrap()[0].id, record.id);
    assert_eq!(
        fs::read(portable.reveal_path().unwrap().join(&name)).unwrap(),
        original_bytes
    );
    let moved = files.path().join("renamed");
    fs::rename(&root, &moved).unwrap();
    let moved_launch = launch_source(&moved).unwrap().unwrap();
    assert_eq!(moved_launch.source.content_digest, digest);
    let moved_store = RecordingStore::project_at(
        data.path(),
        &moved.canonicalize().unwrap(),
        &File::open(&moved).unwrap(),
    )
    .unwrap();
    run.project_path = moved.to_string_lossy().into_owned();
    run.launch = moved_launch;
    manager
        .begin(
            &moved_store,
            run.clone(),
            "playback",
            Some(&record.id),
            None,
            false,
            false,
        )
        .unwrap();
    assert!(!play(port, Some("phone-A"), json!("blocked-during-replay")));
    clock.store(400, Ordering::SeqCst);
    manager.advance(Some("1")).unwrap();
    assert!(manager.snapshot(true).operation_id.is_none());
    manager
        .begin(
            &moved_store,
            run,
            "overdub",
            Some(&record.id),
            None,
            false,
            true,
        )
        .unwrap();
    assert!(play(port, Some("phone-B"), json!("new-pass")));
    clock.store(600, Ordering::SeqCst);
    manager.advance(Some("1")).unwrap();
    let updated = manager.list(&moved_store).unwrap().remove(0);
    assert_eq!(updated.passes.len(), 2);
    assert_eq!(fs::read(old_file).unwrap(), original_bytes);
    manager.delete_record(&moved_store, &record.id).unwrap();
    assert!(manager
        .list(
            &RecordingStore::project_at(
                data.path(),
                &moved.canonicalize().unwrap(),
                &File::open(&moved).unwrap()
            )
            .unwrap()
        )
        .unwrap()
        .is_empty());
    fixture.finish().await.unwrap();
}

fn play(port: u16, id: Option<&str>, payload: Value) -> bool {
    let result: Value = ureq::post(format!("http://127.0.0.1:{port}/play"))
        .header("Content-Type", "application/json")
        .send(serde_json::to_vec(&json!({"id":id,"payload":payload})).unwrap())
        .unwrap()
        .body_mut()
        .read_to_string()
        .map(|text| serde_json::from_str(&text).unwrap())
        .unwrap();
    result["admitted"].as_bool().unwrap()
}

#[tokio::test]
async fn public_recording_controls_capture_restore_and_release_real_adapter_sources() {
    let (mut fixture, port) = fixture().await;
    let data = tempfile::tempdir().unwrap();
    let manager = RecordingManager::default();
    manager
        .begin(
            &test_store(data.path(), &(target(port)).launch.project_key),
            target(port),
            "recording",
            None,
            None,
            false,
            false,
        )
        .unwrap();
    assert_eq!(
        manager.snapshot(true).project_path.as_deref(),
        Some("/score")
    );
    // Starting recording did not invoke the work's independent START.
    let before: Value = ureq::get(format!("http://127.0.0.1:{port}/result"))
        .call()
        .unwrap()
        .body_mut()
        .read_to_string()
        .map(|text| serde_json::from_str(&text).unwrap())
        .unwrap();
    assert_eq!(before["conducting"], json!([]));
    assert!(play(port, None, json!("START")));
    assert!(play(port, Some("phone-A"), json!({"hold":0.4})));
    assert!(play(port, Some("phone-A"), json!({"hold":0.4})));
    assert!(play(port, Some("phone-B"), json!({"hold":0.7})));
    manager.stop(false).unwrap();
    assert_eq!(
        manager.snapshot(true).project_path.as_deref(),
        Some("/score"),
        "completion retains the native runtime owner independently of the UI selection"
    );
    let records = manager
        .list(&test_store(data.path(), "physical-project-one"))
        .unwrap();
    assert_eq!(records.len(), 1);
    let record = &records[0];
    assert!(record.complete);
    let saved = serde_json::to_value(record).unwrap();
    assert_eq!(saved["schemaVersion"], json!(2));
    assert_eq!(saved["passes"].as_array().unwrap().len(), 1);
    assert_eq!(
        saved["passes"][0]["performerIds"].as_array().unwrap().len(),
        2
    );
    assert_eq!(record.performers.len(), 2);
    assert_eq!(record.performers[0].selection, json!(3));
    assert_eq!(record.performers[1].selection, json!(3));
    assert_eq!(
        record.events.len(),
        4,
        "repeated holds retain their semantics"
    );
    let stopped: Value = ureq::get(format!("http://127.0.0.1:{port}/result"))
        .call()
        .unwrap()
        .body_mut()
        .read_to_string()
        .map(|text| serde_json::from_str(&text).unwrap())
        .unwrap();
    assert_eq!(stopped["sound"]["phone-A"], json!({"hold":0.4}));
    assert_eq!(
        stopped["releases"], 0,
        "ordinary recording stop leaves live music running"
    );
    manager
        .begin(
            &test_store(data.path(), &(target(port)).launch.project_key),
            target(port),
            "playback",
            Some(&record.id),
            None,
            false,
            false,
        )
        .unwrap();
    assert!(
        !play(port, None, json!("SEEK")),
        "manual conductor is blocked at the work's effective entry"
    );
    assert!(!play(port, Some("phone-A"), json!("unrecorded")));
    let deadline = Instant::now() + Duration::from_secs(2);
    while manager.snapshot(true).operation_id.is_some() {
        manager.advance(Some("1")).unwrap();
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(2));
    }
    let played: Value = ureq::get(format!("http://127.0.0.1:{port}/result"))
        .call()
        .unwrap()
        .body_mut()
        .read_to_string()
        .map(|text| serde_json::from_str(&text).unwrap())
        .unwrap();
    assert_eq!(played["composition"], json!([11, 7, 19]));
    assert_eq!(played["conducting"], json!(["START"]));
    assert_eq!(played["sound"], json!({}));
    assert_eq!(played["releases"], 1);
    fixture.finish().await.unwrap();
}

fn copy_score(source: &Path, destination: &Path) {
    fs::create_dir_all(destination).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let path = entry.unwrap().path();
        let dest = destination.join(path.file_name().unwrap());
        if path.is_dir() {
            copy_score(&path, &dest);
        } else {
            fs::copy(path, dest).unwrap();
        }
    }
}

#[tokio::test]
async fn overdub_and_rerecord_publish_only_successful_passes_and_preserve_fixed_duration() {
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicU32, Ordering};
    let (mut fixture, port) = fixture().await;
    let data = tempfile::tempdir().unwrap();
    let time = Arc::new(AtomicU32::new(0));
    let clock = time.clone();
    let manager = RecordingManager::with_clock(Arc::new(move || clock.load(Ordering::SeqCst)));
    let run = target(port);
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "recording",
            None,
            None,
            false,
            true,
        )
        .unwrap();
    assert!(play(port, Some("phone-A"), json!("first-A")));
    assert!(play(port, Some("phone-B"), json!("first-B")));
    // The first pass determines length on the score's monotonic capture clock.
    let deadline = Instant::now() + Duration::from_millis(80);
    while Instant::now() < deadline {
        manager.advance(Some("1")).unwrap();
    }
    manager.stop(false).unwrap();
    let original = manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap()
        .remove(0);
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "overdub",
            Some(&original.id),
            None,
            false,
            true,
        )
        .unwrap();
    assert!(play(port, Some("phone-A"), json!("new-A")));
    assert!(play(port, Some("phone-B"), json!("new-B")));
    manager.stop(false).unwrap();
    let merged = manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap()
        .remove(0);
    assert_eq!(
        merged.performers.len(),
        4,
        "each reused device becomes independent within the new pass"
    );
    assert_eq!(merged.duration_ms, original.duration_ms);
    assert_eq!(
        merged
            .events
            .iter()
            .filter(|event| event.payload == json!("first-A"))
            .count(),
        1,
        "inherited events are not recaptured"
    );
    let extra = merged
        .performers
        .iter()
        .find(|p| !original.performers.iter().any(|old| old.id == p.id))
        .unwrap();
    assert_eq!(extra.selection, json!(3));
    assert!(merged
        .events
        .iter()
        .any(|event| event.performer_id.as_ref() == Some(&extra.id) && event.kind == "release"));
    let a = &original.passes[0];
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "rerecord",
            Some(&merged.id),
            Some(&a.id),
            false,
            true,
        )
        .unwrap();
    assert!(play(port, Some("phone-B"), json!("discarded-A")));
    manager.stop(true).unwrap();
    let retained = manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap()
        .remove(0);
    assert_eq!(
        serde_json::to_value(&retained).unwrap(),
        serde_json::to_value(&merged).unwrap()
    );
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "rerecord",
            Some(&merged.id),
            Some(&a.id),
            false,
            true,
        )
        .unwrap();
    assert!(play(port, Some("phone-B"), json!("replacement-A")));
    manager.stop(false).unwrap();
    let replaced = manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap()
        .remove(0);
    assert!(!replaced
        .events
        .iter()
        .any(|event| event.payload == json!("first-A")));
    assert!(replaced
        .events
        .iter()
        .any(|event| event.payload == json!("replacement-A")
            && event
                .performer_id
                .as_ref()
                .is_some_and(|id| replaced.passes[0].performer_ids.contains(id))));
    assert!(replaced
        .events
        .iter()
        .any(|event| event.payload == json!("new-B")));
    assert!(!replaced
        .events
        .iter()
        .any(|event| event.payload == json!("first-B")));
    assert_eq!(replaced.passes.len(), 2);
    assert_eq!(replaced.passes[0].id, a.id);
    assert_eq!(replaced.duration_ms, original.duration_ms);
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "rerecord",
            Some(&replaced.id),
            Some(&a.id),
            false,
            true,
        )
        .unwrap();
    play(port, Some("phone-B"), json!("unsaved-A"));
    let directory = data.path().join("recordings").join(&run.launch.project_key);
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o500)).unwrap();
    assert!(
        manager.stop(false).is_err(),
        "save failure is reported honestly"
    );
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
    let recovered = RecordingManager::default()
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap();
    assert!(recovered.iter().any(|record| !record.complete));
    let completed = recovered.iter().find(|record| record.complete).unwrap();
    assert_eq!(
        serde_json::to_value(completed).unwrap(),
        serde_json::to_value(&replaced).unwrap()
    );
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "playback",
            Some(&replaced.id),
            None,
            false,
            false,
        )
        .unwrap();
    time.store(replaced.duration_ms, Ordering::SeqCst);
    manager.advance(Some("1")).unwrap();
    assert_eq!(
        manager.snapshot(true).status,
        "idle",
        "common time automatically ends playback exactly once"
    );
    manager.advance(Some("1")).unwrap();
    fixture.finish().await.unwrap();
}

#[tokio::test]
async fn independent_files_check_compatibility_and_preserve_original_provenance() {
    let (mut fixture, port) = fixture().await;
    let data = tempfile::tempdir().unwrap();
    let manager = RecordingManager::default();
    let run = target(port);
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "recording",
            None,
            None,
            false,
            false,
        )
        .unwrap();
    play(port, Some("phone-A"), json!("portable"));
    manager.stop(false).unwrap();
    let record = manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap()
        .remove(0);
    let file = data.path().join("portable.pndsrecord");
    manager
        .export(
            &test_store(data.path(), &run.launch.project_key),
            &record.id,
            &file,
        )
        .unwrap();
    let imported = manager
        .import(&test_store(data.path(), "second-physical-project"), &file)
        .unwrap();
    assert_ne!(imported.id, record.id);
    let mut changed = run.clone();
    changed.launch.project_key = "second-physical-project".into();
    changed.launch.source.content_digest = "sha256:changed".into();
    assert_eq!(
        manager
            .begin(
                &test_store(data.path(), &(changed.clone()).launch.project_key),
                changed.clone(),
                "playback",
                Some(&imported.id),
                None,
                false,
                false
            )
            .unwrap_err(),
        "recording.contentChanged"
    );
    manager
        .begin(
            &test_store(data.path(), &(changed.clone()).launch.project_key),
            changed.clone(),
            "overdub",
            Some(&imported.id),
            None,
            true,
            true,
        )
        .unwrap();
    play(port, Some("phone-B"), json!("new-interpretation"));
    manager.stop(false).unwrap();
    let updated = manager
        .list(&test_store(data.path(), &changed.launch.project_key))
        .unwrap()
        .remove(0);
    assert_eq!(updated.original_source.content_digest, "sha256:original");
    assert_eq!(updated.interpreted_by.content_digest, "sha256:changed");
    let mut damaged: Value = read_json(&file).unwrap();
    damaged["schemaVersion"] = json!(99);
    fs::write(&file, serde_json::to_vec(&damaged).unwrap()).unwrap();
    assert!(manager
        .import(&test_store(data.path(), &changed.launch.project_key), &file)
        .is_err());
    assert_eq!(
        manager
            .list(&test_store(data.path(), &changed.launch.project_key))
            .unwrap()
            .len(),
        1
    );
    manager
        .begin(
            &test_store(data.path(), &(changed.clone()).launch.project_key),
            changed.clone(),
            "recording",
            None,
            None,
            false,
            false,
        )
        .unwrap();
    assert!(
        manager
            .begin(
                &test_store(data.path(), &(changed.clone()).launch.project_key),
                changed.clone(),
                "recording",
                None,
                None,
                false,
                false
            )
            .is_err(),
        "duplicate operations cannot acquire another driver"
    );
    assert!(manager.advance(Some("stale-run")).is_err());
    let restarted = RecordingManager::default()
        .list(&test_store(data.path(), &changed.launch.project_key))
        .unwrap();
    assert!(restarted.iter().any(|record| !record.complete));
    assert_eq!(restarted.iter().filter(|record| record.complete).count(), 1);
    fixture.finish().await.unwrap();
}

#[tokio::test]
async fn app_recording_commands_round_trip_the_actual_runes_composition_and_conducting() {
    let score = tempfile::tempdir().unwrap();
    copy_score(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/recording-runes"),
        score.path(),
    );
    let ports = FixturePorts::<2>::reserve("recording-actual-runes").unwrap();
    let values = ports.values();
    let manifest_path = score.path().join("manifest.json");
    let mut manifest: Value = read_json(&manifest_path).unwrap();
    manifest["scoreServer"]["performerPort"] = json!(values[0]);
    manifest["scoreServer"]["monitorPort"] = json!(values[1]);
    // This exact-source fixture omits audio artifacts and declares only the
    // None runtime exercised here; the original project verifies audio modes.
    manifest["audio"]["defaultMode"] = json!("none");
    manifest["audio"]["supportedModes"] = json!(["none"]);
    manifest["audio"]["synthdefs"] = json!([]);
    manifest["audio"]["scsynth"] = Value::Null;
    fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let applied_source = launch_source(score.path()).unwrap().unwrap();
    let node_modules = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("node_modules");
    let mut command = Command::new(crate::project::session::node_binary_path().unwrap());
    command
        .current_dir(score.path())
        .args(["server.js", "--audio-mode", "none"])
        .env(
            "PNDS_SHARED_LIBRARIES",
            json!({"socket.io":{"path":node_modules.join("socket.io")}}).to_string(),
        );
    let mut fixture = OwnedNodeFixture::spawn(ports, command).unwrap();
    fixture.ready().await.unwrap();
    verify_launch_source(score.path(), &applied_source).unwrap();
    let entry = score.path().join("server.js");
    let loaded_bytes = fs::read(&entry).unwrap();
    let mut changed_bytes = loaded_bytes.clone();
    changed_bytes.extend_from_slice(b"\n// saved after runtime loaded\n");
    fs::write(&entry, changed_bytes).unwrap();
    assert!(
        verify_launch_source(score.path(), &applied_source).is_err(),
        "a changed startup source cannot be advertised as the applied one"
    );
    let mut run = target(values[0]);
    run.launch = applied_source;
    let data = tempfile::tempdir().unwrap();
    let manager = RecordingManager::default();
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "recording",
            None,
            None,
            false,
            true,
        )
        .unwrap();
    let mut input = Command::new(crate::project::session::node_binary_path().unwrap());
    input
        .arg("-e")
        .arg(include_str!("runes-performers.cjs"))
        .env("PNDS_FIXTURE_PORTS", json!(values).to_string())
        .env("SOCKET_CLIENT", node_modules.join("socket.io-client"));
    let performed = input.output().unwrap();
    assert!(
        performed.status.success(),
        "{}",
        String::from_utf8_lossy(&performed.stderr)
    );
    let result: Value = serde_json::from_slice(&performed.stdout).unwrap();
    assert_eq!(result["touches"].as_array().unwrap().len(), 2);
    while manager.snapshot(true).elapsed_ms < 1000 {
        manager.advance(Some("1")).unwrap();
        std::thread::sleep(Duration::from_millis(2));
    }
    manager.stop(false).unwrap();
    let records = manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap();
    let record = &records[0];
    assert_ne!(
        record.original_source.content_digest,
        launch_source(score.path())
            .unwrap()
            .unwrap()
            .source
            .content_digest,
        "later saved bytes do not replace the actual applied launch provenance"
    );
    assert_eq!(record.performers.len(), 2);
    assert_eq!(
        record
            .events
            .iter()
            .filter(|event| event.kind == "touch")
            .count(),
        3
    );
    let composition = record.initial_state["score"]["items"].clone();
    assert!(composition
        .as_array()
        .is_some_and(|items| !items.is_empty()));
    assert_eq!(record.performers[0].selection, json!(3));
    assert_eq!(record.performers[1].selection, json!(3));
    assert!(record.duration_ms >= 1000);
    use std::io::{BufRead as _, BufReader};
    use std::process::Stdio;
    let mut live = Command::new(crate::project::session::node_binary_path().unwrap())
        .arg("-e")
        .arg(include_str!("runes-pass-input.cjs"))
        .env("PNDS_FIXTURE_PORTS", json!(values).to_string())
        .env("SOCKET_CLIENT", node_modules.join("socket.io-client"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut live_input = live.stdin.take().unwrap();
    let mut live_output = BufReader::new(live.stdout.take().unwrap());
    let mut reply = String::new();
    live_output.read_line(&mut reply).unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&reply).unwrap()["ready"],
        true
    );
    let mut send = |value: Value| -> Value {
        writeln!(live_input, "{value}").unwrap();
        live_input.flush().unwrap();
        let mut line = String::new();
        live_output.read_line(&mut line).unwrap();
        serde_json::from_str(&line).unwrap()
    };
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "overdub",
            Some(&record.id),
            None,
            false,
            true,
        )
        .unwrap();
    send(json!({"action":"touch", "name":"a", "number":3, "x":111}));
    // A remains online. A new accepted device joins only after begin: the exact
    // admission order that the old single-source adapter silently rejected.
    send(json!({"action":"join", "name":"b"}));
    let online = send(json!({"action":"touch", "name":"b", "number":3, "x":222}));
    assert_eq!(online["touches"].as_array().unwrap().len(), 2);
    manager.stop(false).unwrap();
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "overdub",
            Some(&record.id),
            None,
            false,
            true,
        )
        .unwrap();
    send(json!({"action":"touch", "name":"a", "number":5, "x":333}));
    manager.stop(false).unwrap();
    let record = manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap()
        .remove(0);
    assert_eq!(record.passes.len(), 3);
    assert!(record.passes[1].performer_ids.len() >= 2);
    for (x, number) in [(111, 3), (222, 3), (333, 5)] {
        assert!(record.events.iter().any(|event| event.kind == "touch"
            && event.payload["x"] == x
            && event.payload["number"] == number));
    }
    let second_a = record
        .events
        .iter()
        .find(|event| event.payload["x"] == 111)
        .unwrap()
        .performer_id
        .as_ref()
        .unwrap();
    let third_a = record
        .events
        .iter()
        .find(|event| event.payload["x"] == 333)
        .unwrap()
        .performer_id
        .as_ref()
        .unwrap();
    assert_ne!(
        second_a, third_a,
        "same persistent device changes score number in a new pass"
    );
    send(json!({"action":"reset"}));
    manager
        .begin(
            &test_store(data.path(), &(run).launch.project_key),
            run,
            "playback",
            Some(&record.id),
            None,
            false,
            true,
        )
        .unwrap();
    let locked = input.env("EXPECT_LOCKED", "true").output().unwrap();
    assert!(
        locked.status.success(),
        "{}",
        String::from_utf8_lossy(&locked.stderr)
    );
    let deadline = Instant::now() + Duration::from_secs(3);
    while manager.snapshot(true).operation_id.is_some() {
        manager.advance(Some("1")).unwrap();
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(2));
    }
    let state: Value = serde_json::from_str(
        &ureq::get(format!("http://127.0.0.1:{}/__score/state", values[0]))
            .call()
            .unwrap()
            .body_mut()
            .read_to_string()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        state["items"], composition,
        "actual randomly generated score restored"
    );
    assert_eq!(state["playing"], false);
    assert_eq!(state["playhead"], 1000);
    let playback = send(json!({"action":"end"}));
    for x in [111, 222, 333] {
        assert!(
            playback["observed"]
                .as_array()
                .unwrap()
                .iter()
                .any(|touch| touch["x"] == x),
            "persisted input {x} reaches the actual Runes replay display"
        );
    }
    drop(live_input);
    assert!(live.wait_with_output().unwrap().status.success());
    fixture.finish().await.unwrap();
}

#[tokio::test]
async fn ambiguous_begin_retains_cleanup_ownership_without_publishing_unconfirmed_state() {
    let (mut fixture, port) = fixture().await;
    let data = tempfile::tempdir().unwrap();
    let manager = RecordingManager::default();
    let run = target(port);
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "recording",
            None,
            None,
            false,
            false,
        )
        .unwrap();
    play(port, Some("phone-A"), json!("saved"));
    manager.stop(false).unwrap();
    let original = manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap()
        .remove(0);
    ureq::post(format!(
        "http://127.0.0.1:{port}/damage-next-recording-replies"
    ))
    .header("Content-Type", "application/json")
    .send(serde_json::to_vec(&json!({"count":2})).unwrap())
    .unwrap();
    assert!(manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "playback",
            Some(&original.id),
            None,
            false,
            false
        )
        .is_err());
    let failed = manager.snapshot(true);
    assert_eq!(failed.status, "error");
    assert!(
        failed.operation_id.is_some(),
        "uncertain begin/end remains owned until confirmed cleanup"
    );
    assert_eq!(
        manager
            .begin(
                &test_store(data.path(), &(run.clone()).launch.project_key),
                run.clone(),
                "recording",
                None,
                None,
                false,
                false
            )
            .unwrap_err(),
        "recording.busy"
    );
    manager.stop(false).unwrap();
    assert!(manager.snapshot(true).operation_id.is_none());
    assert!(play(port, Some("phone-A"), json!("live-again")));
    let records = manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(
        serde_json::to_value(&records[0]).unwrap(),
        serde_json::to_value(&original).unwrap()
    );
    fixture.finish().await.unwrap();
}

#[tokio::test]
async fn public_status_revisions_change_only_for_visible_status_or_whole_seconds() {
    use std::sync::atomic::{AtomicU32, Ordering};
    let (mut fixture, port) = fixture().await;
    let data = tempfile::tempdir().unwrap();
    let time = Arc::new(AtomicU32::new(0));
    let clock = time.clone();
    let manager = RecordingManager::with_clock(Arc::new(move || clock.load(Ordering::SeqCst)));
    let idle = manager.snapshot(false);
    assert_eq!(
        manager.snapshot(false).revision,
        idle.revision,
        "reading idle status must not publish new facts"
    );
    manager
        .begin(
            &test_store(data.path(), &(target(port)).launch.project_key),
            target(port),
            "recording",
            None,
            None,
            false,
            false,
        )
        .unwrap();
    let started = manager.snapshot(true);
    assert_eq!(manager.snapshot(true).revision, started.revision);
    time.store(500, Ordering::SeqCst);
    manager.advance(Some("1")).unwrap();
    assert_eq!(manager.snapshot(true).revision, started.revision);
    time.store(1000, Ordering::SeqCst);
    manager.advance(Some("1")).unwrap();
    let second = manager.snapshot(true);
    assert!(second.revision > started.revision);
    assert_eq!(second.elapsed_ms, 1000);
    assert_eq!(manager.snapshot(true).revision, second.revision);
    assert!(manager.snapshot(false).revision > second.revision);
    manager.stop(false).unwrap();
    fixture.finish().await.unwrap();
}

#[tokio::test]
async fn rejected_begin_confirms_no_authority_before_allowing_another_operation() {
    let (mut fixture, port) = fixture().await;
    let data = tempfile::tempdir().unwrap();
    let manager = RecordingManager::default();
    let run = target(port);
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "recording",
            None,
            None,
            false,
            false,
        )
        .unwrap();
    manager.stop(false).unwrap();
    let original = manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap()
        .remove(0);
    let file = data.path().join("invalid-initial-state.pndsrecord");
    manager
        .export(
            &test_store(data.path(), &run.launch.project_key),
            &original.id,
            &file,
        )
        .unwrap();
    let mut value: Value = read_json(&file).unwrap();
    value["initialState"] = Value::Null;
    fs::write(&file, serde_json::to_vec(&value).unwrap()).unwrap();
    let imported = manager
        .import(&test_store(data.path(), &run.launch.project_key), &file)
        .unwrap();
    assert!(manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "playback",
            Some(&imported.id),
            None,
            false,
            false
        )
        .is_err());
    assert!(
        manager.snapshot(true).operation_id.is_none(),
        "adapter confirmed that the rejected begin holds no authority"
    );
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "recording",
            None,
            None,
            false,
            false,
        )
        .unwrap();
    manager.stop(true).unwrap();
    assert!(manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap()
        .iter()
        .any(|record| record.id == original.id && record.complete));
    fixture.finish().await.unwrap();
}

struct ManagedRecordingSession {
    app: tauri::App<tauri::test::MockRuntime>,
    score: tempfile::TempDir,
    data: tempfile::TempDir,
    _ports: FixturePorts<2>,
}
impl ManagedRecordingSession {
    fn start() -> Self {
        use tauri::Manager as _;
        let score = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let mut ports = FixturePorts::<2>::reserve("recording-managed-session").unwrap();
        let values = ports.values();
        let adapter = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources/performance-recording/adapter.cjs");
        let server = include_str!("fixture.cjs")
            .replace(
                "process.env.RECORDING_ADAPTER",
                &serde_json::to_string(&adapter).unwrap(),
            )
            .replace(
                "JSON.parse(process.env.PNDS_FIXTURE_PORTS)",
                &serde_json::to_string(&values).unwrap(),
            );
        fs::write(score.path().join("server.js"), server).unwrap();
        fs::write(
            score.path().join("pnds.recording.json"),
            r#"{"protocolVersion":1,"adapterId":"fixture-v1"}"#,
        )
        .unwrap();
        fs::write(score.path().join("manifest.json"), json!({
            "schemaVersion":1,"id":"recording-fixture","name":"Recording fixture","version":"1.0.0",
            "scoreServer":{"entry":"server.js","workingDirectory":".","performerPort":values[0],"monitorPort":values[1]},
            "audio":{"defaultMode":"none","supportedModes":["none"]}
        }).to_string()).unwrap();
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        // Mock path resolution joins this absolute identifier into its data root.
        context.config_mut().identifier = data
            .path()
            .join("preferences")
            .to_string_lossy()
            .into_owned();
        let app = tauri::test::mock_builder().build(context).unwrap();
        crate::events::events_builder().mount_events(&app);
        app.manage(crate::commands::preferences::PreferencesCache::default());
        app.manage(crate::project::session::SessionManager::default());
        app.manage(RecordingManager::default());
        app.manage(crate::participation_client::ClientCoordinator::default());
        app.manage(crate::window::WindowManager::default());
        assert_eq!(
            app.path().app_data_dir().unwrap(),
            data.path().join("preferences")
        );
        ports.release_for_start();
        let fixture = Self {
            app,
            score,
            data,
            _ports: ports,
        };
        fixture.restart().unwrap();
        fixture
    }
    fn restart(&self) -> Result<(), String> {
        use tauri::Manager as _;
        let session = self.app.state::<crate::project::session::SessionManager>();
        session.start(
            self.app.handle().clone(),
            self.data.path().into(),
            crate::project::session::StartRequest::new(
                self.score.path().to_string_lossy().into_owned(),
                crate::types::AudioMode::None,
                "192.168.1.10".into(),
                None,
            ),
        )?;
        let deadline = Instant::now() + Duration::from_secs(5);
        while session.snapshot().status == crate::types::SessionStatus::Starting {
            assert!(
                Instant::now() < deadline,
                "managed session never became ready"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            session.snapshot().status,
            crate::types::SessionStatus::Ready,
            "{:?}",
            session.snapshot().error
        );
        Ok(())
    }
}
impl Drop for ManagedRecordingSession {
    fn drop(&mut self) {
        use tauri::Manager as _;
        let session = self.app.state::<crate::project::session::SessionManager>();
        for pid in session.active_child_pids() {
            let _ = Command::new("/bin/kill")
                .args(["-9", &pid.to_string()])
                .status();
        }
        let _ = session.stop(self.app.handle());
        let deadline = Instant::now() + Duration::from_secs(5);
        while session.has_active_session() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

#[test]
fn runtime_health_failure_retires_recording_and_preserves_complete_and_captured_data() {
    use tauri::Manager as _;
    let fixture = ManagedRecordingSession::start();
    let session = fixture
        .app
        .state::<crate::project::session::SessionManager>();
    let manager = fixture.app.state::<RecordingManager>();
    let run = session.recording_target().unwrap();
    let store = test_store(fixture.data.path(), &run.launch.project_key);
    manager
        .begin(&store, run.clone(), "recording", None, None, false, false)
        .unwrap();
    assert!(play(run.port, Some("phone-A"), json!("completed-original")));
    manager.stop(false).unwrap();
    let original = manager.list(&store).unwrap().remove(0);
    assert!(original.complete);
    let original_file = store
        .reveal_path()
        .unwrap()
        .join(format!("{}.json", original.id));
    let original_bytes = fs::read(&original_file).unwrap();

    let active = manager
        .begin(&store, run.clone(), "recording", None, None, false, false)
        .unwrap();
    let pending_id = active.operation_id.unwrap();
    assert!(play(
        run.port,
        Some("phone-A"),
        json!("captured-before-health-failure")
    ));
    // Poll through the real recording adapter before the session tears its
    // process down. Retirement must retain this captured native state without
    // publishing the interrupted take as a completed recording.
    manager.advance(Some(&run.generation)).unwrap();
    let original_pids = session.active_child_pids();
    assert_eq!(original_pids.len(), 1);
    let audio_error = "fixture audio controller failed while the process stayed alive";
    let response = ureq::post(format!("http://127.0.0.1:{}/fail-runtime-health", run.port))
        .header("Content-Type", "application/json")
        .send(serde_json::to_vec(&json!({"error":audio_error})).unwrap())
        .unwrap()
        .into_body()
        .read_to_string()
        .unwrap();
    let response: Value = serde_json::from_str(&response).unwrap();
    assert_eq!(
        response["pid"].as_u64(),
        original_pids.iter().next().copied().map(u64::from)
    );

    let deadline = Instant::now() + Duration::from_secs(6);
    while session.snapshot().status != crate::types::SessionStatus::Error {
        assert!(
            Instant::now() < deadline,
            "explicit runtime health failure was not reported: {:?}",
            session.snapshot()
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    let snapshot = session.snapshot();
    assert!(snapshot.error.as_deref().unwrap().contains(audio_error));
    let runtime = snapshot.runtime_health.unwrap();
    assert_eq!(
        serde_json::to_value(runtime.project.status).unwrap(),
        json!("failed")
    );
    assert_eq!(
        runtime.project.error.as_deref(),
        Some(format!("Audio: {audio_error}").as_str())
    );
    assert!(runtime.audio.is_none(), "None mode never probes scsynth");
    assert!(session.active_child_pids().is_empty());
    assert!(!session.has_active_session());
    let recording = manager.snapshot(true);
    assert_eq!(recording.status, "error");
    assert!(recording.operation_id.is_none());
    assert!(recording.error.is_some());

    let records = manager.list(&store).unwrap();
    assert_eq!(records.len(), 2);
    assert_eq!(records.iter().filter(|record| record.complete).count(), 1);
    assert_eq!(fs::read(&original_file).unwrap(), original_bytes);
    let incomplete = records.iter().find(|record| !record.complete).unwrap();
    assert_eq!(incomplete.id, pending_id);
    assert!(incomplete
        .events
        .iter()
        .any(|event| event.payload == json!("captured-before-health-failure")));
    assert!(store
        .entries()
        .unwrap()
        .contains(&format!("pending-{pending_id}.json")));
    assert!(!store
        .entries()
        .unwrap()
        .contains(&format!("{}.json", active.record_id.unwrap())));
}

#[test]
fn confirmed_managed_process_death_retires_recording_without_publishing_a_completed_pass() {
    use tauri::Manager as _;
    let fixture = ManagedRecordingSession::start();
    let session = fixture
        .app
        .state::<crate::project::session::SessionManager>();
    let manager = fixture.app.state::<RecordingManager>();
    let run = session.recording_target().unwrap();
    assert_eq!(run.project_path, fixture.score.path().to_string_lossy());
    manager
        .begin(
            &test_store(fixture.data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "recording",
            None,
            None,
            false,
            false,
        )
        .unwrap();
    play(run.port, Some("phone-A"), json!("completed-original"));
    manager.stop(false).unwrap();
    let original = manager
        .list(&test_store(fixture.data.path(), &run.launch.project_key))
        .unwrap()
        .remove(0);
    manager
        .begin(
            &test_store(fixture.data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "recording",
            None,
            None,
            false,
            false,
        )
        .unwrap();
    play(run.port, Some("phone-A"), json!("incomplete-at-crash"));
    for pid in session.active_child_pids() {
        assert!(Command::new("/bin/kill")
            .args(["-9", &pid.to_string()])
            .status()
            .unwrap()
            .success());
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    while session.has_active_session() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(
        manager.snapshot(true).operation_id.is_none(),
        "confirmed retirement releases native operation ownership"
    );
    assert_eq!(
        manager.snapshot(true).status,
        "error",
        "runtime death must remain a failed recording"
    );
    let records = manager
        .list(&test_store(fixture.data.path(), &run.launch.project_key))
        .unwrap();
    assert!(records.iter().any(|record| !record.complete));
    assert_eq!(
        serde_json::to_value(records.iter().find(|record| record.complete).unwrap()).unwrap(),
        serde_json::to_value(&original).unwrap()
    );
    fixture.restart().unwrap();
    manager
        .begin(
            &test_store(
                fixture.data.path(),
                &(session.recording_target().unwrap()).launch.project_key,
            ),
            session.recording_target().unwrap(),
            "recording",
            None,
            None,
            false,
            false,
        )
        .unwrap();
    manager.stop(false).unwrap();
    crate::window::prepare_exit(fixture.app.handle()).unwrap();
}

#[test]
fn confirmed_runtime_retirement_reconciles_a_failed_provisional_begin_but_live_uncertainty_stays_locked(
) {
    use tauri::Manager as _;
    let fixture = ManagedRecordingSession::start();
    let session = fixture
        .app
        .state::<crate::project::session::SessionManager>();
    let manager = fixture.app.state::<RecordingManager>();
    let run = session.recording_target().unwrap();
    manager
        .begin(
            &test_store(fixture.data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "recording",
            None,
            None,
            false,
            false,
        )
        .unwrap();
    manager.stop(false).unwrap();
    let original = manager
        .list(&test_store(fixture.data.path(), &run.launch.project_key))
        .unwrap()
        .remove(0);
    ureq::post(format!(
        "http://127.0.0.1:{}/damage-next-recording-replies",
        run.port
    ))
    .header("Content-Type", "application/json")
    .send(serde_json::to_vec(&json!({"count":100})).unwrap())
    .unwrap();
    assert!(manager
        .begin(
            &test_store(fixture.data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "playback",
            Some(&original.id),
            None,
            false,
            false
        )
        .is_err());
    assert!(manager.snapshot(true).operation_id.is_some());
    assert_eq!(
        session.snapshot().status,
        crate::types::SessionStatus::Ready
    );
    assert!(
        session.recording_target().is_ok(),
        "transport failure is not a retired runtime"
    );
    manager.advance(Some("different-generation")).unwrap();
    assert_eq!(
        manager
            .begin(
                &test_store(fixture.data.path(), &(run.clone()).launch.project_key),
                run.clone(),
                "recording",
                None,
                None,
                false,
                false
            )
            .unwrap_err(),
        "recording.busy"
    );
    for pid in session.active_child_pids() {
        assert!(Command::new("/bin/kill")
            .args(["-9", &pid.to_string()])
            .status()
            .unwrap()
            .success());
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    while session.has_active_session() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(manager.snapshot(true).operation_id.is_none());
    assert_eq!(manager.snapshot(true).status, "error");
    let records = manager
        .list(&test_store(fixture.data.path(), &run.launch.project_key))
        .unwrap();
    assert_eq!(
        records.len(),
        1,
        "unconfirmed initial state cannot become a complete or playable pass"
    );
    assert_eq!(
        serde_json::to_value(&records[0]).unwrap(),
        serde_json::to_value(&original).unwrap()
    );
    fixture.restart().unwrap();
    manager
        .begin(
            &test_store(
                fixture.data.path(),
                &(session.recording_target().unwrap()).launch.project_key,
            ),
            session.recording_target().unwrap(),
            "recording",
            None,
            None,
            false,
            false,
        )
        .unwrap();
    crate::window::prepare_exit(fixture.app.handle()).unwrap();
}

#[test]
fn explicit_session_stop_confirms_process_cleanup_after_end_failure_but_reports_the_failed_save() {
    use tauri::Manager as _;
    let fixture = ManagedRecordingSession::start();
    let session = fixture
        .app
        .state::<crate::project::session::SessionManager>();
    let manager = fixture.app.state::<RecordingManager>();
    let run = session.recording_target().unwrap();
    manager
        .begin(
            &test_store(fixture.data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "recording",
            None,
            None,
            false,
            false,
        )
        .unwrap();
    manager.stop(false).unwrap();
    let original = manager
        .list(&test_store(fixture.data.path(), &run.launch.project_key))
        .unwrap()
        .remove(0);
    manager
        .begin(
            &test_store(fixture.data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "recording",
            None,
            None,
            false,
            false,
        )
        .unwrap();
    ureq::post(format!(
        "http://127.0.0.1:{}/damage-next-recording-replies",
        run.port
    ))
    .header("Content-Type", "application/json")
    .send(serde_json::to_vec(&json!({"count":100})).unwrap())
    .unwrap();
    assert!(
        session.stop(fixture.app.handle()).is_err(),
        "process teardown must not disguise the failed recording save"
    );
    assert!(!session.has_active_session());
    assert!(session.active_child_pids().is_empty());
    assert!(manager.snapshot(true).operation_id.is_none());
    assert_eq!(manager.snapshot(true).status, "error");
    let records = manager
        .list(&test_store(fixture.data.path(), &run.launch.project_key))
        .unwrap();
    assert!(records.iter().any(|record| !record.complete));
    assert_eq!(
        serde_json::to_value(records.iter().find(|record| record.complete).unwrap()).unwrap(),
        serde_json::to_value(&original).unwrap()
    );
    crate::window::prepare_exit(fixture.app.handle()).unwrap();
}

#[tokio::test]
async fn import_refuses_an_interpreting_adapter_contract_different_from_the_original() {
    let (mut fixture, port) = fixture().await;
    let data = tempfile::tempdir().unwrap();
    let manager = RecordingManager::default();
    let run = target(port);
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "recording",
            None,
            None,
            false,
            false,
        )
        .unwrap();
    manager.stop(false).unwrap();
    let original = manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap()
        .remove(0);
    let file = data.path().join("foreign-interpretation.pndsrecord");
    manager
        .export(
            &test_store(data.path(), &run.launch.project_key),
            &original.id,
            &file,
        )
        .unwrap();
    let valid: Value = read_json(&file).unwrap();
    for (field, value) in [
        ("protocolVersion", json!(2)),
        ("adapterId", json!("another-score-v1")),
    ] {
        let mut changed = valid.clone();
        changed["interpretedBy"]["adapter"][field] = value;
        fs::write(&file, serde_json::to_vec(&changed).unwrap()).unwrap();
        assert_eq!(
            manager
                .import(&test_store(data.path(), &run.launch.project_key), &file)
                .unwrap_err(),
            "recording.incompatible"
        );
    }
    assert_eq!(
        manager
            .list(&test_store(data.path(), &run.launch.project_key))
            .unwrap()
            .len(),
        1
    );
    fixture.finish().await.unwrap();
}

#[test]
fn multi_source_adapter_regressions_cover_late_join_and_reused_device() {
    let result = Command::new(crate::project::session::node_binary_path().unwrap())
        .arg("--test")
        .arg(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("resources/performance-recording/adapter.test.cjs"),
        )
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
}

#[tokio::test]
async fn pass_management_preserves_common_state_and_rejects_active_deletion() {
    // Pass management is independent of HTTP scheduling; only musical time advances.
    let source_clock = tempfile::tempdir().unwrap();
    let clock_path = source_clock.path().join("clock");
    fs::write(&clock_path, b"0").unwrap();
    let clock_json = serde_json::to_string(&clock_path).unwrap();
    let adapter_json = serde_json::to_string(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/performance-recording/adapter.cjs"),
    )
    .unwrap();
    let adapter_path = source_clock.path().join("adapter.cjs");
    fs::write(
        &adapter_path,
        format!(
            "const fs = require('node:fs');\n\
             Object.defineProperty(performance, 'now', {{\n\
               value: () => Number(fs.readFileSync({clock_json}, 'utf8'))\n\
             }});\n\
             module.exports = require({adapter_json});\n"
        ),
    )
    .unwrap();
    let (mut fixture, port) = fixture_with_adapter(&adapter_path).await;
    let data = tempfile::tempdir().unwrap();
    let manager = RecordingManager::default();
    let run = target(port);
    assert!(play(port, Some("phone-A"), json!("held-before-recording")));
    let started = manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "recording",
            None,
            None,
            false,
            true,
        )
        .unwrap();
    let id = started.record_id.unwrap();
    assert_eq!(
        manager
            .delete_record(&test_store(data.path(), &run.launch.project_key), &id)
            .unwrap_err(),
        "recording.busy"
    );
    assert_eq!(
        manager
            .delete_record(
                &test_store(data.path(), &run.launch.project_key),
                started.operation_id.as_ref().unwrap()
            )
            .unwrap_err(),
        "recording.busy"
    );
    assert!(play(port, None, json!("START")));
    assert!(play(port, Some("phone-A"), json!("first-A")));
    assert!(play(port, Some("phone-B"), json!("first-B")));
    fs::write(&clock_path, b"100").unwrap();
    manager.stop(false).unwrap();
    let original = manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap()
        .remove(0);
    assert_eq!(original.duration_ms, 100);
    assert_eq!(original.passes.len(), 1);
    for payload in ["second-A", "third-A"] {
        manager
            .begin(
                &test_store(data.path(), &(run.clone()).launch.project_key),
                run.clone(),
                "overdub",
                Some(&id),
                None,
                false,
                true,
            )
            .unwrap();
        assert_eq!(
            manager
                .delete_pass(
                    &test_store(data.path(), &run.launch.project_key),
                    &id,
                    &original.passes[0].id
                )
                .unwrap_err(),
            "recording.busy"
        );
        assert!(play(port, Some("phone-A"), json!(payload)));
        manager.stop(false).unwrap();
    }
    let merged = manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap()
        .remove(0);
    assert_eq!(merged.passes.len(), 3);
    let touch_ids: std::collections::HashSet<_> = merged
        .events
        .iter()
        .filter(|event| {
            [json!("first-A"), json!("second-A"), json!("third-A")].contains(&event.payload)
        })
        .map(|event| event.performer_id.clone().unwrap())
        .collect();
    assert_eq!(
        touch_ids.len(),
        3,
        "one source receives an independent identity every pass"
    );
    let deleted = manager
        .delete_pass(
            &test_store(data.path(), &run.launch.project_key),
            &id,
            &original.passes[0].id,
        )
        .unwrap();
    assert_eq!(deleted.passes.len(), 2);
    assert_eq!(deleted.duration_ms, original.duration_ms);
    assert_eq!(deleted.initial_state, original.initial_state);
    assert!(deleted
        .events
        .iter()
        .any(|event| event.performer_id.is_none() && event.payload == json!("START")));
    assert!(!deleted
        .performers
        .iter()
        .any(|performer| performer.id == "phone-A" || performer.id == "phone-B"));
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "playback",
            Some(&id),
            None,
            false,
            false,
        )
        .unwrap();
    let restored: Value = serde_json::from_str(
        &ureq::get(format!("http://127.0.0.1:{port}/result"))
            .call()
            .unwrap()
            .body_mut()
            .read_to_string()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        restored["sound"],
        json!({}),
        "deleting the first pass does not restore its initially held touch"
    );
    manager.stop(false).unwrap();
    for pass in deleted.passes {
        manager
            .delete_pass(
                &test_store(data.path(), &run.launch.project_key),
                &id,
                &pass.id,
            )
            .unwrap();
    }
    let empty = manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap()
        .remove(0);
    assert!(empty.passes.is_empty());
    assert!(empty.performers.is_empty());
    assert_eq!(empty.duration_ms, original.duration_ms);
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "overdub",
            Some(&id),
            None,
            false,
            true,
        )
        .unwrap();
    assert!(play(port, Some("phone-B"), json!("new-after-empty")));
    manager.stop(false).unwrap();
    let resumed = manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap()
        .remove(0);
    assert_eq!(resumed.passes.len(), 1);
    manager
        .delete_record(&test_store(data.path(), &run.launch.project_key), &id)
        .unwrap();
    assert!(manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap()
        .is_empty());
    fixture.finish().await.unwrap();
}

#[test]
fn legacy_records_normalize_as_one_pass_and_preserve_original_bytes_before_deletion() {
    let data = tempfile::tempdir().unwrap();
    let key = "legacy-project";
    let id = "0123456789abcdef0123456789abcdef";
    let source = target(0).launch.source;
    let raw = serde_json::to_vec_pretty(&json!({
        "schemaVersion": 1, "id": id, "createdAt": "1", "complete": true, "durationMs": 100,
        "originalSource": source, "interpretedBy": source, "initialState": {"sound":{"old":"held"}},
        "performers": [{"id":"old", "label":"Old", "selection":3}],
        "events":[{"atMs":0,"sequence":1,"performerId":null,"kind":"conduct","payload":"START"},
                  {"atMs":1,"sequence":2,"performerId":"old","kind":"touch","payload":"old-touch"}]
    }))
    .unwrap();
    let directory = data.path().join("recordings").join(key);
    fs::create_dir_all(&directory).unwrap();
    let path = directory.join(format!("{id}.json"));
    fs::write(&path, &raw).unwrap();
    let manager = RecordingManager::default();
    let record = manager
        .list(&test_store(data.path(), key))
        .unwrap()
        .remove(0);
    assert_eq!(record.schema_version, 2);
    assert_eq!(record.passes.len(), 1);
    assert!(record.passes[0].legacy);
    assert_eq!(fs::read(&path).unwrap(), raw, "listing is read-only");
    let deleted = manager
        .delete_pass(&test_store(data.path(), key), id, &record.passes[0].id)
        .unwrap();
    assert_eq!(
        fs::read(directory.join("legacy").join(format!("{id}.json"))).unwrap(),
        raw
    );
    assert!(deleted.passes.is_empty());
    assert_eq!(deleted.events.len(), 1);
    assert_eq!(deleted.events[0].performer_id, None);
    assert_eq!(deleted.initial_state, record.initial_state);
    assert_eq!(
        manager.list(&test_store(data.path(), key)).unwrap().len(),
        1,
        "backup is outside the catalog"
    );
    let pending_id = "abcdef0123456789abcdef0123456789";
    fs::write(directory.join(format!("pending-{pending_id}.json")), &raw).unwrap();
    manager
        .delete_record(&test_store(data.path(), key), pending_id)
        .unwrap();
    assert!(
        path.exists(),
        "discarding recovery data never deletes its completed base"
    );
}

#[tokio::test]
async fn incompatible_pass_capture_and_replayed_identity_cannot_replace_a_completed_record() {
    let wrapper = tempfile::tempdir().unwrap();
    let path = wrapper.path().join("fault-adapter.cjs");
    let production =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/performance-recording/adapter.cjs");
    let script = r#"
const { createRecordingAdapter } = require(PRODUCTION_ADAPTER)
module.exports.createRecordingAdapter = options => {
  const adapter = createRecordingAdapter(options), original = adapter.handle
  let fault = null, sequence = 0
  adapter.handle = async (request, response) => {
    if (request.url.startsWith('/inject-recording-fault/')) {
      fault = request.url.split('/').at(-1)
      response.end('{}')
      return true
    }
    const end = response.end.bind(response)
    response.end = data => {
      if (request.url === '/__pnds/recording' && request.method === 'POST') {
        const body = JSON.parse(data)
        for (const event of body.events ?? []) sequence = Math.max(sequence, event.sequence)
        if (fault === 'missing') delete body.passId
        if (fault === 'cross' && body.passId) {
          body.performers = []
          body.events = [{ atMs: 0, sequence: sequence + 1, performerId: 'phone-A', kind: 'touch', payload: 'recaptured-old-source' }]
        }
        data = JSON.stringify(body)
      }
      return end(data)
    }
    return original(request, response)
  }
  return adapter
}
"#.replace("PRODUCTION_ADAPTER", &serde_json::to_string(&production).unwrap());
    fs::write(&path, script).unwrap();
    let (mut fixture, port) = fixture_with_adapter(&path).await;
    let data = tempfile::tempdir().unwrap();
    let manager = RecordingManager::default();
    let run = target(port);
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "recording",
            None,
            None,
            false,
            true,
        )
        .unwrap();
    assert!(play(port, Some("phone-A"), json!("original")));
    manager.stop(false).unwrap();
    let record = manager
        .list(&test_store(data.path(), &run.launch.project_key))
        .unwrap()
        .remove(0);
    let saved_path = data
        .path()
        .join("recordings")
        .join(&run.launch.project_key)
        .join(format!("{}.json", record.id));
    let original = fs::read(&saved_path).unwrap();
    ureq::get(format!(
        "http://127.0.0.1:{port}/inject-recording-fault/missing"
    ))
    .call()
    .unwrap();
    assert_eq!(
        manager
            .begin(
                &test_store(data.path(), &(run.clone()).launch.project_key),
                run.clone(),
                "overdub",
                Some(&record.id),
                None,
                false,
                true
            )
            .unwrap_err(),
        "recording.passUnsupported"
    );
    assert_eq!(fs::read(&saved_path).unwrap(), original);
    ureq::get(format!(
        "http://127.0.0.1:{port}/inject-recording-fault/none"
    ))
    .call()
    .unwrap();
    manager
        .begin(
            &test_store(data.path(), &(run.clone()).launch.project_key),
            run.clone(),
            "overdub",
            Some(&record.id),
            None,
            false,
            true,
        )
        .unwrap();
    ureq::get(format!(
        "http://127.0.0.1:{port}/inject-recording-fault/cross"
    ))
    .call()
    .unwrap();
    assert_eq!(
        manager.advance(Some("1")).unwrap_err(),
        "recording.invalidAdapter"
    );
    assert_eq!(
        fs::read(&saved_path).unwrap(),
        original,
        "replay identities cannot be recaptured into another pass"
    );
    fixture.finish().await.unwrap();
}

#[test]
fn imported_passes_require_unique_ids_and_complete_performer_ownership() {
    let data = tempfile::tempdir().unwrap();
    let path = data.path().join("invalid.pndsrecord");
    let id = "0123456789abcdef0123456789abcdef";
    let source = target(0).launch.source;
    let valid = json!({
        "schemaVersion":2,"id":id,"createdAt":"1","complete":true,"durationMs":100,
        "originalSource":source,"interpretedBy":source,"initialState":{},
        "performers":[{"id":"a","label":"A","selection":3}],
        "events":[{"atMs":0,"sequence":1,"performerId":"a","kind":"touch","payload":1}],
        "passes":[{"id":id,"performerIds":["a"],"legacy":false}]
    });
    let manager = RecordingManager::default();
    let mut missing_member = valid.clone();
    missing_member["passes"][0]["performerIds"] = json!([]);
    let mut duplicate_member = valid.clone();
    duplicate_member["passes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"abcdef0123456789abcdef0123456789","performerIds":["a"],"legacy":false}));
    let mut duplicate_pass = valid.clone();
    duplicate_pass["passes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":id,"performerIds":[],"legacy":false}));
    let mut unknown_event = valid.clone();
    unknown_event["events"][0]["performerId"] = json!("foreign");
    for invalid in [
        missing_member,
        duplicate_member,
        duplicate_pass,
        unknown_event,
    ] {
        fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
        assert_eq!(
            manager
                .import(&test_store(data.path(), "project"), &path)
                .unwrap_err(),
            "recording.invalidFile"
        );
    }
    assert!(manager
        .list(&test_store(data.path(), "project"))
        .unwrap()
        .is_empty());
}
