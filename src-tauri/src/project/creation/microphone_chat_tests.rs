//! Confirmed chat -> actual Blank score -> accepted microphone action and replay.
use super::*;
use crate::test_support::{FixturePorts, OwnedNodeFixture};
use std::process::Command;

#[tokio::test]
async fn microphone_chat_adoption_runs_four_features_through_real_score_and_recording() {
    let temporary = tempfile::tempdir().unwrap();
    let data = temporary.path().join("data");
    let resources = tests::shared_libraries();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let created = access
        .create_blank(
            &NewProjectOptions {
                parent: temporary.path().display().to_string(),
                folder_name: "microphone-score".into(),
                name: "Microphone score".into(),
                author: String::new(),
                description: String::new(),
                locale: "en".into(),
                git_name: None,
                git_email: None,
            },
            &resources,
            &protection,
        )
        .unwrap();
    let root = Path::new(&created.project.root);
    let identity = access.open(root, &protection).unwrap().project.identity;
    fs::write(
        root.join("author-notes.txt"),
        "Preserve this author's choices",
    )
    .unwrap();
    let original_manifest = fs::read(root.join("manifest.json")).unwrap();
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let proposed = access.propose_assistant_resources(&identity, &task.id, &AssistantResourceRequest {
        modules: vec!["device-microphone".into()], libraries: vec![], reason: "Use this device's four microphone features for the score's brightness, radius, trace and spectrum".into(), alternative: None,
    }, &data, &resources, &protection).unwrap();
    assert!(!root.join("modules/pnds-device-microphone").exists());
    assert!(access
        .adopt_assistant_module(
            &identity,
            &task.id,
            "device-microphone",
            &data,
            &resources,
            &protection
        )
        .is_err());
    access
        .decide_assistant_resources(
            &identity,
            &task.id,
            &proposed.resource_plans[0].id,
            AssistantResourceDecision::Approved,
            &data,
            &protection,
        )
        .unwrap();
    access
        .adopt_assistant_module(
            &identity,
            &task.id,
            "device-microphone",
            &data,
            &resources,
            &protection,
        )
        .unwrap();
    access
        .adopt_assistant_module(
            &identity,
            &task.id,
            "device-microphone",
            &data,
            &resources,
            &protection,
        )
        .unwrap();
    let write = |access: &mut CreationAccess, path: &str, text: String| {
        let version = match access.read(&identity, path, &protection) {
            Ok(CreationContent::Text { version, .. }) => Some(version),
            Err(error) if error.code == CreationErrorCode::Missing => None,
            _ => panic!("Expected writable score text"),
        };
        access
            .write_assistant_file(
                &identity,
                &task.id,
                &AssistantWrite {
                    path: path.into(),
                    version,
                    text: Some(text),
                    edits: None,
                },
                &data,
                &protection,
            )
            .unwrap();
    };
    let ports = FixturePorts::<2>::reserve("Microphone chat score").unwrap();
    let values = ports.values();
    let mut manifest: serde_json::Value = serde_json::from_slice(&original_manifest).unwrap();
    manifest["scoreServer"]["performerPort"] = serde_json::json!(values[0]);
    manifest["scoreServer"]["monitorPort"] = serde_json::json!(values[1]);
    write(
        &mut access,
        "manifest.json",
        serde_json::to_string(&manifest).unwrap(),
    );
    write(
        &mut access,
        "performance/microphone-piece.js",
        include_str!("microphone_piece.mjs").into(),
    );
    let state = fs::read_to_string(root.join("performance/state.js")).unwrap()
        .replace("const fields =", "import { createMicrophonePiece } from './microphone-piece.js'\nconst fields =")
        .replace("  const performers = new Map()", "  const performers = new Map()\n  const piece = createMicrophonePiece({ publish: () => publish({ ...snapshot(), microphone: piece.snapshot() }) })")
        .replace("publish(snapshot())", "publish({ ...snapshot(), microphone: piece.snapshot() })")
        .replace("    snapshot,", "    snapshot: () => ({ ...snapshot(), microphone: piece.snapshot() }),")
        .replace("    snapshotInput: snapshot,", "    snapshotInput: snapshot,\n prepareAction: piece.prepareAction, applyWork: piece.apply, restoreWork: (state, members) => piece.restore(state.microphone, members), releaseWork: piece.release,");
    write(&mut access, "performance/state.js", state);
    let server = fs::read_to_string(root.join("server.js")).unwrap().replace("if (path === '/pnds-players.js')", "if (path === '/pnds-microphone.js') {\n resource = await fileResource(new URL('./modules/pnds-device-microphone/microphone.js', import.meta.url), null, mimeTypes['.js'])\n } else if (path === '/pnds-players.js')");
    write(&mut access, "server.js", server);
    let page = fs::read_to_string(root.join("public/performer.html"))
        .unwrap()
        .replace(
            "<script src=\"./performer.js\">",
            "<script src=\"./pnds-microphone.js\"></script>\n<script src=\"./performer.js\">",
        );
    write(&mut access, "public/performer.html", page);
    let performer = fs::read_to_string(root.join("public/performer.js")).unwrap().replace("  globalThis.PNDS_PLAYER = player", "  globalThis.PNDS_PLAYER = player\n  globalThis.MICROPHONE_CONTROLS = PNDSMicrophone.mountMicrophoneControls({ player, container: document.querySelector('main'), canSend: () => recordingMode !== 'playback' })");
    write(&mut access, "public/performer.js", performer);
    let monitor = fs::read_to_string(root.join("public/monitor.js")).unwrap();
    write(
        &mut access,
        "public/monitor.js",
        monitor + include_str!("microphone_monitor.mjs"),
    );
    let manifest = crate::project::manifest::load_manifest(root).unwrap();
    let shared =
        crate::project::shared_libraries::resolve_at(&resources, &manifest.shared_libraries)
            .unwrap();
    let client = crate::project::shared_libraries::resolve_at(
        &resources,
        &[crate::project::manifest::SharedLibraryReference {
            id: "socket.io-client".into(),
            version: "4.8.4".into(),
        }],
    )
    .unwrap()
    .remove("socket.io-client")
    .unwrap();
    let mut command = Command::new(crate::project::session::node_binary_path().unwrap());
    command
        .current_dir(root)
        .args(["server.js", "--audio-mode", "none"])
        .env_clear()
        .env(
            "PNDS_SHARED_LIBRARIES",
            serde_json::to_string(&shared).unwrap(),
        );
    let mut process = OwnedNodeFixture::spawn(ports, command).unwrap();
    process.ready().await.unwrap();
    let output = Command::new(crate::project::session::node_binary_path().unwrap())
        .arg(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src/project/creation/microphone_runtime.mjs"),
        )
        .arg(values[0].to_string())
        .arg(values[1].to_string())
        .arg(client.path)
        .arg(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .join("node_modules/jsdom/lib/api.js"),
        )
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    println!("{}", String::from_utf8_lossy(&output.stdout));
    drop(process);
    assert!(!root.join("node_modules").exists());
    let references: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    assert!(references["sharedLibraries"]
        .as_array()
        .unwrap()
        .iter()
        .all(|reference| reference["id"] != "p5" && reference["id"] != "ml5"));
    access.end_assistant_task(&identity, &task.id);
    let undone = access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .unwrap();
    assert!(undone.files.iter().all(|file| file.undone));
    assert!(!root.join("modules/pnds-device-microphone").exists());
    assert!(!root.join("performance/microphone-piece.js").exists());
    assert_eq!(
        fs::read(root.join("manifest.json")).unwrap(),
        original_manifest
    );
    assert_eq!(
        fs::read_to_string(root.join("author-notes.txt")).unwrap(),
        "Preserve this author's choices"
    );
}
