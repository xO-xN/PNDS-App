//! Public creation/editor -> actual Blank inputs -> native record management.
use super::*;
use crate::recording::{launch_source, verify_launch_source, RecordingManager, RecordingTarget};
use crate::test_support::{FixturePorts, OwnedNodeFixture};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{atomic::AtomicU32, Arc};

struct Inputs {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}
impl Inputs {
    fn spawn(ports: [u16; 2], client: &Path) -> Self {
        let mut child = Command::new(crate::project::session::node_binary_path().unwrap())
            .arg("--input-type=module")
            .arg("-e")
            .arg(include_str!("blank_recording.mjs"))
            .env_clear()
            .env("PNDS_FIXTURE_PORTS", json!(ports).to_string())
            .env("SOCKET_CLIENT", client)
            .env(
                "DOM_ENTRY",
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .unwrap()
                    .join("node_modules/jsdom/lib/api.js"),
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let output = BufReader::new(child.stdout.take().unwrap());
        Self {
            child,
            input,
            output,
        }
    }
    fn command(&mut self, command: Value) -> Value {
        writeln!(self.input, "{command}").unwrap();
        self.input.flush().unwrap();
        let mut line = String::new();
        self.output.read_line(&mut line).unwrap();
        assert!(!line.is_empty(), "real Socket.IO driver exited");
        let result: Value = serde_json::from_str(&line).unwrap();
        assert!(result.get("error").is_none(), "{result}");
        result
    }
}
impl Drop for Inputs {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
fn contact(id: &str, phase: &str, x: u32) -> Value {
    json!({"kind":"contact","id":id,"phase":phase,"pointerType":"touch",
        "x":x,"y":20,"width":100,"height":100,"nx":f64::from(x)/100.0,"ny":0.2})
}
fn save(
    access: &mut CreationAccess,
    identity: &str,
    path: &str,
    edit: impl FnOnce(String) -> String,
) {
    let protection = Protection::default();
    let CreationContent::Text { text, version, .. } =
        access.read(identity, path, &protection).unwrap()
    else {
        panic!("expected editable source")
    };
    access
        .save(identity, path, &edit(text), &version, &protection)
        .unwrap();
}

fn adopt_piece(access: &mut CreationAccess, identity: &str) {
    access
        .create_text_file(
            identity,
            "performance/piece.js",
            &[],
            &Protection::default(),
        )
        .unwrap();
    save(access, identity, "performance/piece.js", |_| {
        include_str!("blank_recording_piece.mjs").to_string()
    });
    save(access, identity, "performance/state.js", |text| {
        text.replace("const fields =", "import { createPiece } from './piece.js'\nconst fields =")
            .replace("  const performers = new Map()", "  const performers = new Map()\n  const piece = createPiece({ publish: () => publish({ ...snapshot(), piece: piece.snapshot() }) })")
            .replace("publish(snapshot())", "publish({ ...snapshot(), piece: piece.snapshot() })")
            .replace("    snapshot,", "    snapshot: () => ({ ...snapshot(), piece: piece.snapshot() }),")
            .replace("    snapshotInput: snapshot,", "    snapshotInput: snapshot,\n restoreWork: (state, members, context) => piece.restore(state.piece, members, { liveIds: context.liveIds, current: context.currentState.piece }),\n applyWork: event => piece.apply(event), releaseWork: () => piece.release(), advanceWork: elapsed => piece.advance(elapsed),\n prepareConductor: payload => piece.prepareConductor(payload), prepareAction: payload => piece.prepareAction(payload), selectionFor: id => piece.selectionFor(id),")
    });
}

#[tokio::test]
async fn blank_recording_captures_held_input_and_replays_real_common_state() {
    let temporary = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let mut access = CreationAccess::default();
    let created = access
        .create_blank(
            &NewProjectOptions {
                parent: temporary.path().display().to_string(),
                folder_name: "recorded-blank".into(),
                name: "Recorded Blank".into(),
                author: String::new(),
                description: String::new(),
                locale: "en".into(),
                git_name: None,
                git_email: None,
            },
            &tests::shared_libraries(),
            &Protection::default(),
        )
        .unwrap();
    let root = Path::new(&created.project.root);
    let identity = access
        .open(root, &Protection::default())
        .unwrap()
        .project
        .identity;
    let ports = FixturePorts::<2>::reserve("Blank native recording").unwrap();
    let values = ports.values();
    save(&mut access, &identity, "manifest.json", |text| {
        let mut manifest: Value = serde_json::from_str(&text).unwrap();
        manifest["scoreServer"]["performerPort"] = json!(values[0]);
        manifest["scoreServer"]["monitorPort"] = json!(values[1]);
        serde_json::to_string_pretty(&manifest).unwrap()
    });
    let launch = launch_source(root)
        .unwrap()
        .expect("Blank recording must be wired by default");
    let manifest = crate::project::manifest::load_manifest(root).unwrap();
    let shared = crate::project::shared_libraries::resolve_at(
        &tests::shared_libraries(),
        &manifest.shared_libraries,
    )
    .unwrap();
    let client = crate::project::shared_libraries::resolve_at(
        &tests::shared_libraries(),
        &[crate::project::manifest::SharedLibraryReference {
            id: "socket.io-client".into(),
            version: "4.8.4".into(),
        }],
    )
    .unwrap()
    .remove("socket.io-client")
    .unwrap();
    let store = crate::recording::storage::RecordingStore::project(data.path(), root).unwrap();
    let clock_file = temporary.path().join("monotonic-clock");
    fs::write(&clock_file, "0").unwrap();
    let preload = temporary.path().join("clock.mjs");
    fs::write(&preload, format!("import {{ readFileSync }} from 'node:fs'; Object.defineProperty(performance, 'now', {{ value: () => Number(readFileSync({}, 'utf8')) }});", serde_json::to_string(&clock_file).unwrap())).unwrap();
    let mut command = Command::new(crate::project::session::node_binary_path().unwrap());
    command
        .arg("--import")
        .arg(preload)
        .current_dir(root)
        .args(["server.js", "--audio-mode", "none"])
        .env_clear()
        .env(
            "PNDS_SHARED_LIBRARIES",
            serde_json::to_string(&shared).unwrap(),
        );
    let mut process = OwnedNodeFixture::spawn(ports, command).unwrap();
    process.ready().await.unwrap();
    verify_launch_source(root, &launch).unwrap();
    let run = RecordingTarget {
        launch,
        project_path: root.display().to_string(),
        port: values[0],
        generation: "blank-recording-run".into(),
    };
    let time = Arc::new(AtomicU32::new(0));
    let clock = time.clone();
    let manager = RecordingManager::with_clock(Arc::new(move || clock.load(Ordering::SeqCst)));
    let tick = |milliseconds: u32| {
        let staged = clock_file.with_extension("next");
        fs::write(&staged, milliseconds.to_string()).unwrap();
        fs::rename(staged, &clock_file).unwrap();
        time.store(milliseconds, Ordering::SeqCst);
    };
    let mut inputs = Inputs::spawn(values, Path::new(&client.path));
    let joined = inputs.command(json!({"action":"join","name":"a"}));
    let source = joined["identity"]["id"].as_str().unwrap().to_string();
    inputs.command(json!({"action":"input","name":"a","payload":contact("held", "start", 10)}));
    manager
        .begin(&store, run.clone(), "recording", None, None, false, true)
        .unwrap();
    tick(100);
    inputs.command(json!({"action":"input","name":"a","payload":contact("held", "move", 30)}));
    tick(1000);
    manager.stop(false).unwrap();
    let record = manager.list(&store).unwrap().remove(0);
    assert_eq!(record.performers.len(), 1);
    assert_eq!(record.performers[0].id, source);
    assert_eq!(
        record.initial_state["performers"][0]["contacts"][0]["x"],
        10
    );
    assert!(record
        .events
        .iter()
        .any(|event| event.kind == "input" && event.payload["x"] == 30));
    let state = inputs.command(json!({"action":"state","contacts":1}));
    assert_eq!(state["performers"][0]["contacts"][0]["x"], 30);
    manager
        .begin(
            &store,
            run.clone(),
            "overdub",
            Some(&record.id),
            None,
            false,
            true,
        )
        .unwrap();
    let combined = inputs.command(json!({"action":"state","contacts":2}));
    assert!(combined["performers"]
        .as_array()
        .unwrap()
        .iter()
        .any(|player| player["id"] == source && player["contacts"][0]["x"] == 30));
    tick(1100);
    inputs.command(json!({"action":"input","name":"a","payload":contact("held", "move", 40)}));
    tick(1200);
    let rejoined =
        inputs.command(json!({"action":"join","name":"a-again","token":joined["token"]}));
    assert_eq!(rejoined["identity"]["id"], source);
    inputs.command(
        json!({"action":"input","name":"a-again","payload":contact("again", "start", 50)}),
    );
    inputs.command(json!({"action":"join","name":"b"}));
    tick(1250);
    inputs.command(json!({"action":"input","name":"b","payload":contact("late", "start", 70)}));
    tick(1500);
    manager.stop(false).unwrap();
    let merged = manager.list(&store).unwrap().remove(0);
    assert_eq!(merged.passes.len(), 2);
    assert_eq!(merged.passes[1].performer_ids.len(), 2);
    assert_eq!(merged.performers.len(), 3);
    assert!(merged
        .performers
        .iter()
        .all(|performer| performer.selection.is_null()));
    let second_id = &merged.passes[1].performer_ids[0];
    assert_ne!(second_id, &source);
    assert!(merged
        .events
        .iter()
        .any(|event| event.performer_id.as_ref() == Some(second_id)
            && event.kind == "input"
            && event.at_ms == 0
            && event.payload["phase"] == "start"
            && event.payload["x"] == 30));
    manager
        .begin(
            &store,
            run.clone(),
            "playback",
            Some(&record.id),
            None,
            false,
            true,
        )
        .unwrap();
    let restored = inputs.command(json!({"action":"state","contacts":1}));
    assert_eq!(restored["performers"][0]["contacts"][0]["x"], 10);
    tick(1500);
    manager.advance(Some("blank-recording-run")).unwrap();
    inputs.command(json!({"action":"state","contacts":2}));
    inputs.command(
        json!({"action":"emit","name":"a-again","payload":contact("forbidden", "start", 99)}),
    );
    tick(1750);
    manager.advance(Some("blank-recording-run")).unwrap();
    let replayed = inputs.command(json!({"action":"state","contacts":3}));
    let positions: Vec<_> = replayed["performers"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|performer| performer["contacts"].as_array().unwrap())
        .map(|contact| contact["x"].as_u64().unwrap())
        .collect();
    assert!(positions.contains(&30) && positions.contains(&50) && positions.contains(&70));
    assert!(!positions.contains(&99));
    tick(2500);
    manager.advance(Some("blank-recording-run")).unwrap();
    assert_eq!(
        inputs.command(json!({"action":"state","contacts":0}))["performers"],
        json!([])
    );
    let page = inputs.command(json!({"action":"page"}));
    assert!(page["id"].is_string());
    inputs.command(json!({"action":"page-input","phase":"mousedown","x":15}));
    manager
        .begin(&store, run.clone(), "recording", None, None, false, true)
        .unwrap();
    tick(3000);
    manager.stop(false).unwrap();
    let page_record = manager.list(&store).unwrap().remove(0);
    manager
        .begin(
            &store,
            run.clone(),
            "playback",
            Some(&page_record.id),
            None,
            false,
            true,
        )
        .unwrap();
    inputs.command(json!({"action":"page-mode","mode":"playback"}));
    assert_eq!(
        inputs.command(json!({"action":"page-local","contacts":0}))["contacts"],
        json!([]),
        "actual playback restore releases just its known live gesture IDs"
    );
    assert_eq!(
        inputs.command(json!({"action":"page-attempt","phase":"mousedown","x":25}))["contacts"],
        json!([]),
        "pure playback still blocks new local starts"
    );
    assert!(
        inputs.command(json!({"action":"state","contacts":1}))["performers"]
            .as_array()
            .unwrap()
            .iter()
            .all(|performer| performer["id"] != page["id"]),
        "the only held input during playback is a real replay source"
    );
    inputs.command(json!({"action":"page-attempt","phase":"mouseup","x":25}));
    manager.stop(false).unwrap();
    inputs.command(json!({"action":"page-mode","mode":null}));
    inputs.command(json!({"action":"page-input","phase":"mousedown","x":15}));
    // Hold genuine mode packets before playback begins. Server management and
    // upstream gestures continue while downstream mode delivery is delayed.
    inputs.command(json!({"action":"page-delay"}));
    manager
        .begin(
            &store,
            run.clone(),
            "playback",
            Some(&page_record.id),
            None,
            false,
            true,
        )
        .unwrap();
    tick(3100);
    manager.stop(false).unwrap();
    inputs.command(json!({"action":"page-pending"}));
    inputs.command(json!({"action":"page-input","phase":"mouseup","x":15}));
    manager
        .begin(&store, run.clone(), "recording", None, None, false, true)
        .unwrap();
    let successor = inputs.command(json!({"action":"page-input","phase":"mousedown","x":35}));
    let gesture = successor["contacts"][0]["id"].clone();
    let queued =
        inputs.command(json!({"action":"page-pending","modes":["playback",null,"record"]}));
    assert!(
        queued["pending"].as_u64().unwrap() >= 3,
        "actual playback/end/new-record packets must remain FIFO"
    );
    let delivered = inputs.command(json!({"action":"page-deliver"}));
    assert_eq!(
        delivered["contacts"][0]["id"], gesture,
        "old FIFO playback/end notifications must not cancel the new recording gesture"
    );
    tick(3200);
    inputs.command(json!({"action":"page-input","phase":"mousemove","x":45}));
    tick(3500);
    manager.stop(false).unwrap();
    let next_record = manager.list(&store).unwrap().remove(0);
    assert!(
        next_record.events.iter().any(|event| event.kind == "input"
            && event.payload["id"] == gesture
            && event.payload["phase"] == "move"
            && event.payload["x"] == 45),
        "the new recording must retain its real successor movement"
    );
    assert!(
        !next_record.events.iter().any(|event| event.kind == "input"
            && event.payload["id"] == gesture
            && event.payload["phase"] == "cancel"),
        "old mode delivery must not inject cancellation into the new recording"
    );
    inputs.command(json!({"action":"page-input","phase":"mouseup","x":45}));
    drop(inputs);
    process.finish().await.unwrap();
}

#[tokio::test]
async fn blank_recording_public_work_extension_replays_effects_and_conducting_time() {
    let temporary = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let mut access = CreationAccess::default();
    let created = access
        .create_blank(
            &NewProjectOptions {
                parent: temporary.path().display().to_string(),
                folder_name: "authored-blank".into(),
                name: "Authored Blank".into(),
                author: String::new(),
                description: String::new(),
                locale: "en".into(),
                git_name: None,
                git_email: None,
            },
            &tests::shared_libraries(),
            &Protection::default(),
        )
        .unwrap();
    let root = Path::new(&created.project.root);
    let identity = access
        .open(root, &Protection::default())
        .unwrap()
        .project
        .identity;
    adopt_piece(&mut access, &identity);
    let ports = FixturePorts::<2>::reserve("Blank authored recording").unwrap();
    let values = ports.values();
    save(&mut access, &identity, "manifest.json", |text| {
        let mut manifest: Value = serde_json::from_str(&text).unwrap();
        manifest["scoreServer"]["performerPort"] = json!(values[0]);
        manifest["scoreServer"]["monitorPort"] = json!(values[1]);
        serde_json::to_string_pretty(&manifest).unwrap()
    });
    let launch = launch_source(root)
        .unwrap()
        .expect("Blank recording must be wired by default");
    let manifest = crate::project::manifest::load_manifest(root).unwrap();
    let shared = crate::project::shared_libraries::resolve_at(
        &tests::shared_libraries(),
        &manifest.shared_libraries,
    )
    .unwrap();
    let client = crate::project::shared_libraries::resolve_at(
        &tests::shared_libraries(),
        &[crate::project::manifest::SharedLibraryReference {
            id: "socket.io-client".into(),
            version: "4.8.4".into(),
        }],
    )
    .unwrap()
    .remove("socket.io-client")
    .unwrap();
    let store = crate::recording::storage::RecordingStore::project(data.path(), root).unwrap();
    let clock_file = temporary.path().join("monotonic-clock");
    fs::write(&clock_file, "0").unwrap();
    let preload = temporary.path().join("clock.mjs");
    fs::write(&preload, format!("import {{ readFileSync }} from 'node:fs'; Object.defineProperty(performance, 'now', {{ value: () => Number(readFileSync({}, 'utf8')) }});", serde_json::to_string(&clock_file).unwrap())).unwrap();
    let mut command = Command::new(crate::project::session::node_binary_path().unwrap());
    command
        .arg("--import")
        .arg(preload)
        .current_dir(root)
        .args(["server.js", "--audio-mode", "none"])
        .env_clear()
        .env(
            "PNDS_SHARED_LIBRARIES",
            serde_json::to_string(&shared).unwrap(),
        );
    let mut process = OwnedNodeFixture::spawn(ports, command).unwrap();
    process.ready().await.unwrap();
    verify_launch_source(root, &launch).unwrap();
    let run = RecordingTarget {
        launch,
        project_path: root.display().to_string(),
        port: values[0],
        generation: "authored-recording-run".into(),
    };
    let time = Arc::new(AtomicU32::new(0));
    let clock = time.clone();
    let manager = RecordingManager::with_clock(Arc::new(move || clock.load(Ordering::SeqCst)));
    let tick = |milliseconds: u32| {
        let staged = clock_file.with_extension("next");
        fs::write(&staged, milliseconds.to_string()).unwrap();
        fs::rename(staged, &clock_file).unwrap();
        time.store(milliseconds, Ordering::SeqCst);
    };
    let mut inputs = Inputs::spawn(values, Path::new(&client.path));

    let joined = inputs.command(json!({"action":"join","name":"a"}));
    let source = joined["identity"]["id"].as_str().unwrap();
    inputs.command(json!({"action":"input","name":"a","payload":contact("voice", "start", 20)}));
    let initial = inputs.command(json!({"action":"state","contacts":1}));
    assert_eq!(initial["piece"]["voices"][0]["gain"], json!(0.2));
    assert_eq!(
        inputs.command(json!({"action":"management"}))["status"],
        200
    );
    assert_eq!(
        inputs.command(json!({"action":"management","headers":{"Origin":"http://venue.invalid"}}))
            ["status"],
        403
    );
    assert_eq!(
        inputs.command(json!({"action":"management","headers":{"Host":"venue.invalid"}}))["status"],
        403
    );
    assert_eq!(
        inputs.command(json!({"action":"management","monitor":true}))["status"],
        404
    );
    assert_eq!(inputs.command(json!({"action":"management","body":{"action":"end","operationId":"cancelled-before-begin","release":true}}))["status"], 200);
    assert_eq!(inputs.command(json!({"action":"management","body":{"action":"begin","operationId":"cancelled-before-begin","mode":"record","livePassId":"invalid-late-pass"}}))["status"], 409);

    inputs.command(json!({"action":"action","name":"a","payload":{"kind":"selection","value":2}}));
    assert_eq!(
        inputs.command(json!({"action":"conduct","payload":{"kind":"play"}}))["applied"],
        true
    );
    manager
        .begin(&store, run.clone(), "recording", None, None, false, true)
        .unwrap();
    let active_operation = manager.snapshot(true).operation_id.clone();
    assert_eq!(inputs.command(json!({"action":"management","body":{"action":"drive","operationId":"stale-operation","elapsedMs":9999,"events":[]}}))["status"], 409);
    assert_eq!(inputs.command(json!({"action":"management","body":{"action":"end","operationId":"stale-operation","release":true}}))["status"], 409);
    assert_eq!(manager.snapshot(true).operation_id, active_operation);
    assert_eq!(
        inputs.command(json!({"action":"state","contacts":1}))["piece"]["voices"][0]["gain"],
        json!(0.2)
    );
    tick(100);
    inputs.command(json!({"action":"input","name":"a","payload":contact("voice", "move", 60)}));
    tick(250);
    inputs.command(json!({"action":"conduct","payload":{"kind":"pause"}}));
    tick(400);
    inputs.command(json!({"action":"conduct","payload":{"kind":"seek","positionMs":500}}));
    tick(500);
    inputs.command(json!({"action":"conduct","payload":{"kind":"play"}}));
    tick(1000);
    manager.stop(false).unwrap();
    let record = manager.list(&store).unwrap().remove(0);
    assert_eq!(record.performers[0].id, source);
    assert_eq!(record.performers[0].selection, json!(2));
    assert_eq!(
        record
            .events
            .iter()
            .filter(|event| event.kind == "conductor")
            .count(),
        3
    );
    manager
        .begin(
            &store,
            run.clone(),
            "playback",
            Some(&record.id),
            None,
            false,
            true,
        )
        .unwrap();
    let restored = inputs.command(json!({"action":"state","contacts":1}));
    assert_eq!(restored["piece"]["voices"][0]["gain"], json!(0.2));
    assert_eq!(
        inputs.command(json!({"action":"conduct","payload":{"kind":"pause"}}))["applied"],
        false
    );
    tick(1200);
    manager.advance(Some("authored-recording-run")).unwrap();
    let advanced = inputs.command(json!({"action":"state","contacts":1}));
    assert_eq!(advanced["piece"]["voices"][0]["gain"], json!(0.6));
    assert_eq!(advanced["piece"]["transport"]["positionMs"], 200);
    tick(1300);
    manager.advance(Some("authored-recording-run")).unwrap();
    assert_eq!(
        inputs.command(json!({"action":"state","contacts":1}))["piece"]["transport"]["positionMs"],
        250
    );
    tick(1450);
    manager.advance(Some("authored-recording-run")).unwrap();
    assert_eq!(
        inputs.command(json!({"action":"state","contacts":1}))["piece"]["transport"]["positionMs"],
        500
    );
    tick(1600);
    manager.advance(Some("authored-recording-run")).unwrap();
    assert_eq!(
        inputs.command(json!({"action":"state","contacts":1}))["piece"]["transport"]["positionMs"],
        600
    );
    tick(2000);
    manager.advance(Some("authored-recording-run")).unwrap();
    let ended = inputs.command(json!({"action":"state","contacts":0}));
    assert_eq!(ended["piece"]["voices"], json!([]));
    assert_eq!(ended["piece"]["transport"]["playing"], false);
    assert_eq!(
        manager.list(&store).unwrap()[0].events.len(),
        record.events.len(),
        "replay did not recapture its own business events"
    );
    manager
        .begin(&store, run.clone(), "recording", None, None, false, true)
        .unwrap();
    tick(2100);
    inputs.command(
        json!({"action":"input","name":"a","payload":contact("before-fault", "start", 80)}),
    );
    manager.advance(Some("authored-recording-run")).unwrap();
    tick(2200);
    inputs.command(
        json!({"action":"emit","name":"a","event":"pnds:action","payload":{"kind":"fail"}}),
    );
    inputs.command(json!({"action":"repeat","name":"a"}));
    assert!(
        manager.stop(false).is_err(),
        "Stop before poll must not publish a failed work application as a complete record"
    );
    assert_eq!(manager.snapshot(true).status, "error");
    assert!(
        manager.snapshot(true).operation_id.is_none(),
        "fault cleanup should be acknowledged automatically"
    );
    let recovered = manager.list(&store).unwrap();
    assert_eq!(recovered.iter().filter(|entry| entry.complete).count(), 1);
    assert!(recovered.iter().any(|entry| !entry.complete
        && entry
            .events
            .iter()
            .any(|event| event.kind == "input" && event.payload["x"] == 80)));
    let cleared = inputs.command(json!({"action":"state","contacts":0}));
    assert_eq!(cleared["piece"]["voices"], json!([]));
    assert_eq!(
        serde_json::to_value(
            recovered
                .iter()
                .find(|entry| entry.id == record.id)
                .unwrap()
        )
        .unwrap(),
        serde_json::to_value(&record).unwrap()
    );

    tick(2300);
    manager
        .begin(
            &store,
            run.clone(),
            "overdub",
            Some(&record.id),
            None,
            false,
            true,
        )
        .unwrap();
    inputs.command(
        json!({"action":"input","name":"a","payload":contact("release-fault", "start", 40)}),
    );
    inputs.command(json!({"action":"action","name":"a","payload":{"kind":"arm-release-failure"}}));
    tick(2400);
    manager.advance(Some("authored-recording-run")).unwrap();
    assert!(
        manager.stop(false).is_err(),
        "a real release callback failure must preserve the previous complete record"
    );
    assert!(
        manager.snapshot(true).operation_id.is_none(),
        "the native failure path retries only owned cleanup"
    );
    let failed_release = inputs.command(json!({"action":"state","contacts":0}));
    assert_eq!(failed_release["piece"]["voices"], json!([]));
    assert_eq!(failed_release["piece"]["releaseFailureArmed"], false);
    assert_eq!(
        manager
            .list(&store)
            .unwrap()
            .iter()
            .filter(|entry| entry.complete)
            .count(),
        1
    );
    assert_eq!(
        serde_json::to_value(
            manager
                .list(&store)
                .unwrap()
                .iter()
                .find(|entry| entry.id == record.id)
                .unwrap()
        )
        .unwrap(),
        serde_json::to_value(&record).unwrap()
    );

    tick(2500);
    inputs
        .command(json!({"action":"input","name":"a","payload":contact("next-pass", "start", 30)}));
    inputs.command(json!({"action":"action","name":"a","payload":{"kind":"selection","value":5}}));
    manager
        .begin(
            &store,
            run.clone(),
            "overdub",
            Some(&record.id),
            None,
            false,
            true,
        )
        .unwrap();
    assert_eq!(
        inputs.command(json!({"action":"conduct","payload":{"kind":"pause"}}))["applied"],
        false
    );
    inputs.command(json!({"action":"action","name":"a","payload":{"kind":"selection","value":7}}));
    tick(2600);
    inputs.command(json!({"action":"input","name":"a","payload":contact("next-pass", "move", 40)}));
    manager.advance(Some("authored-recording-run")).unwrap();
    tick(3000);
    manager.stop(false).unwrap();
    let merged = manager
        .list(&store)
        .unwrap()
        .into_iter()
        .find(|entry| entry.id == record.id)
        .unwrap();
    assert_eq!(merged.duration_ms, 1000);
    assert_eq!(merged.passes.len(), 2);
    let retained_id = merged.passes[1].performer_ids[0].clone();
    assert_ne!(retained_id, source);
    assert_eq!(
        merged
            .performers
            .iter()
            .find(|performer| performer.id == retained_id)
            .unwrap()
            .selection,
        json!(7)
    );
    assert_eq!(
        merged
            .performers
            .iter()
            .find(|performer| performer.id == source)
            .unwrap()
            .selection,
        json!(2)
    );

    tick(3100);
    inputs.command(
        json!({"action":"input","name":"a","payload":contact("replacement", "start", 80)}),
    );
    inputs.command(json!({"action":"action","name":"a","payload":{"kind":"selection","value":3}}));
    let first_pass = merged.passes[0].id.clone();
    manager
        .begin(
            &store,
            run.clone(),
            "rerecord",
            Some(&record.id),
            Some(&first_pass),
            false,
            true,
        )
        .unwrap();
    let filtered = inputs.command(json!({"action":"state","contacts":1}));
    assert_eq!(filtered["piece"]["voices"][0]["gain"], json!(0.8));
    assert_eq!(filtered["performers"][0]["id"], source, "only genuine live held state remains before replay drive; removed initial pass must not return");
    manager.advance(Some("authored-recording-run")).unwrap();
    inputs.command(json!({"action":"state","contacts":2}));
    inputs.command(json!({"action":"action","name":"a","payload":{"kind":"selection","value":4}}));
    tick(3200);
    inputs
        .command(json!({"action":"input","name":"a","payload":contact("replacement", "move", 90)}));
    manager.advance(Some("authored-recording-run")).unwrap();
    tick(3400);
    manager.advance(Some("authored-recording-run")).unwrap();
    manager.stop(false).unwrap();
    let replaced = manager
        .list(&store)
        .unwrap()
        .into_iter()
        .find(|entry| entry.id == record.id)
        .unwrap();
    assert_eq!(replaced.passes[0].id, first_pass);
    assert_eq!(replaced.passes[1].performer_ids, vec![retained_id.clone()]);
    assert!(!replaced
        .performers
        .iter()
        .any(|performer| performer.id == source));
    assert!(!replaced
        .events
        .iter()
        .any(|event| event.performer_id.as_deref() == Some(source)));
    let replacement_id = &replaced.passes[0].performer_ids[0];
    assert_ne!(replacement_id, &retained_id);
    assert_eq!(
        replaced
            .performers
            .iter()
            .find(|performer| &performer.id == replacement_id)
            .unwrap()
            .selection,
        json!(4)
    );
    let before_discard = serde_json::to_value(&replaced).unwrap();
    manager
        .begin(
            &store,
            run.clone(),
            "rerecord",
            Some(&record.id),
            Some(&first_pass),
            false,
            true,
        )
        .unwrap();
    manager.stop(true).unwrap();
    assert_eq!(
        serde_json::to_value(
            manager
                .list(&store)
                .unwrap()
                .iter()
                .find(|entry| entry.id == record.id)
                .unwrap()
        )
        .unwrap(),
        before_discard
    );
    let deleted = manager
        .delete_pass(&store, &record.id, &first_pass)
        .unwrap();
    assert_eq!(deleted.initial_state, record.initial_state);
    manager
        .begin(
            &store,
            run.clone(),
            "playback",
            Some(&record.id),
            None,
            false,
            true,
        )
        .unwrap();
    let without_first = inputs.command(json!({"action":"state","contacts":0}));
    assert_eq!(without_first["piece"]["voices"], json!([]));
    manager.advance(Some("authored-recording-run")).unwrap();
    let retained = inputs.command(json!({"action":"state","contacts":1}));
    assert_eq!(retained["piece"]["voices"][0]["gain"], json!(0.3));
    manager.stop(false).unwrap();

    let mut malformed = serde_json::to_value(&record).unwrap();
    let contacts = malformed["initialState"]["performers"][0]["contacts"]
        .as_array_mut()
        .unwrap();
    contacts.push(contacts[0].clone());
    let imported_path = temporary.path().join("malformed-business.pndsrecord");
    fs::write(&imported_path, serde_json::to_vec(&malformed).unwrap()).unwrap();
    let malformed = manager.import(&store, &imported_path).unwrap();
    assert!(manager
        .begin(
            &store,
            run.clone(),
            "playback",
            Some(&malformed.id),
            None,
            false,
            true
        )
        .is_err());
    assert!(manager.snapshot(true).operation_id.is_none());
    assert_eq!(
        inputs.command(json!({"action":"state","contacts":0}))["piece"]["voices"],
        json!([])
    );
    manager
        .begin(&store, run, "playback", Some(&record.id), None, false, true)
        .unwrap();
    manager.stop(false).unwrap();
    drop(inputs);
    process.finish().await.unwrap();
}
