//! Confirmed chat task -> actual Blank page -> accepted feature -> recording -> visual replay.
use super::*;
use crate::test_support::{FixturePorts, OwnedNodeFixture};
use serde_json::json;
use std::process::Command;

fn task_write(
    access: &mut CreationAccess,
    identity: &str,
    task: &str,
    data: &Path,
    path: &str,
    text: String,
) {
    let protection = Protection::default();
    let version = match access.read(identity, path, &protection) {
        Ok(CreationContent::Text { version, .. }) => Some(version),
        Err(cause) if cause.code == CreationErrorCode::Missing => None,
        other => panic!("expected editable task source: {other:?}"),
    };
    access
        .write_assistant_file(
            identity,
            task,
            &AssistantWrite {
                path: path.into(),
                version,
                text: Some(text),
                edits: None,
            },
            data,
            &protection,
        )
        .unwrap();
}

#[tokio::test]
async fn confirmed_motion_task_drives_actual_project_and_recorded_replay_then_undoes() {
    let temp = tempfile::tempdir().unwrap();
    let data = temp.path().join("data");
    let resources = tests::shared_libraries();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let prepared = access
        .create_blank(
            &NewProjectOptions {
                parent: temp.path().display().to_string(),
                folder_name: "motion-score".into(),
                name: "Motion score".into(),
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
    let root = PathBuf::from(&prepared.project.root);
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let original_server = fs::read_to_string(root.join("server.js")).unwrap();
    let original_manifest = fs::read(root.join("manifest.json")).unwrap();
    assert!(!root.join("modules/pnds-device-motion").exists());
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let requested = AssistantResourceRequest {
        modules: vec!["device-motion".into()],
        libraries: vec![],
        reason: "Use current device tilt to rotate the score and replay accepted motion".into(),
        alternative: None,
    };
    let proposed = access
        .propose_assistant_resources(
            &identity,
            &task.id,
            &requested,
            &data,
            &resources,
            &protection,
        )
        .unwrap();
    assert_eq!(proposed.resource_plans[0].resources.len(), 1);
    assert!(access
        .adopt_assistant_module(
            &identity,
            &task.id,
            "device-motion",
            &data,
            &resources,
            &protection,
        )
        .is_err());
    assert!(!root.join("modules/pnds-device-motion").exists());
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
            "device-motion",
            &data,
            &resources,
            &protection,
        )
        .unwrap();
    assert_eq!(
        fs::read(root.join("manifest.json")).unwrap(),
        original_manifest
    );
    assert!(!root.join("node_modules").exists());
    let ports = FixturePorts::<2>::reserve("motion chat project").unwrap();
    let values = ports.values();
    let mut manifest: serde_json::Value = serde_json::from_slice(&original_manifest).unwrap();
    manifest["scoreServer"]["performerPort"] = json!(values[0]);
    manifest["scoreServer"]["monitorPort"] = json!(values[1]);
    task_write(
        &mut access,
        &identity,
        &task.id,
        &data,
        "manifest.json",
        manifest.to_string(),
    );
    task_write(
        &mut access,
        &identity,
        &task.id,
        &data,
        "performance/motion.js",
        include_str!("motion_piece.mjs").into(),
    );
    task_write(
        &mut access,
        &identity,
        &task.id,
        &data,
        "public/motion.js",
        include_str!("motion_client.mjs").into(),
    );
    let server = original_server
        .replace("from './performance/state.js'", "from './performance/motion.js'")
        .replace("if (path === '/pnds-players.js')", "if (path === '/pnds-device-motion.js') {\n resource = await fileResource(new URL('./modules/pnds-device-motion/device-motion.js', import.meta.url), null, mimeTypes['.js'])\n } else if (path === '/pnds-players.js')");
    task_write(&mut access, &identity, &task.id, &data, "server.js", server);
    let performer = fs::read_to_string(root.join("public/performer.html")).unwrap()
        .replace("</body>", "<script src='/pnds-device-motion.js'></script><script src='/motion.js'></script></body>");
    task_write(
        &mut access,
        &identity,
        &task.id,
        &data,
        "public/performer.html",
        performer,
    );
    let monitor = fs::read_to_string(root.join("public/monitor.js")).unwrap()
        + "\nconst effect = document.createElement('div'); effect.id = 'motion-effect'; effect.textContent = 'Motion'; document.querySelector('main').append(effect); socket.on('pnds:performance', state => { const value = state.motion?.[0]?.rotation; effect.style.transform = value ? `rotateX(${value.x}deg) rotateY(${value.y}deg)` : ''; });\n";
    task_write(
        &mut access,
        &identity,
        &task.id,
        &data,
        "public/monitor.js",
        monitor,
    );
    let manifest = crate::project::manifest::load_manifest(&root).unwrap();
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
    let mut server = Command::new(crate::project::session::node_binary_path().unwrap());
    server
        .current_dir(&root)
        .args(["server.js", "--audio-mode", "none"])
        .env_clear()
        .env(
            "PNDS_SHARED_LIBRARIES",
            serde_json::to_string(&shared).unwrap(),
        );
    let mut process = OwnedNodeFixture::spawn(ports, server).unwrap();
    process.ready().await.unwrap();
    let result = Command::new(crate::project::session::node_binary_path().unwrap())
        .args([
            "--input-type=module",
            "-e",
            include_str!("motion_project.mjs"),
        ])
        .current_dir(&root)
        .env_clear()
        .env("PNDS_FIXTURE_PORTS", json!(values).to_string())
        .env("SOCKET_CLIENT", client.path)
        .env(
            "DOM_ENTRY",
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .join("node_modules/jsdom/lib/api.js"),
        )
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "actual motion project: {}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
    process.finish().await.unwrap();
    access.end_assistant_task(&identity, &task.id);
    access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .unwrap();
    assert!(!root.join("modules/pnds-device-motion").exists());
    assert!(!root.join("performance/motion.js").exists());
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        original_server
    );
    assert_eq!(
        fs::read(root.join("manifest.json")).unwrap(),
        original_manifest
    );

    // An already-adopted author's module is reused and never replaced or owned by the new task.
    let catalog = access.module_catalog(&identity, &protection).unwrap();
    access
        .add_module(
            &identity,
            "device-motion",
            None,
            catalog.handoff_version.as_deref(),
            &protection,
        )
        .unwrap();
    let module_path = root.join("modules/pnds-device-motion/device-motion.js");
    let custom = fs::read_to_string(&module_path).unwrap() + "\n// author customization\n";
    fs::write(&module_path, &custom).unwrap();
    let reuse = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    access
        .adopt_assistant_module(
            &identity,
            &reuse.id,
            "device-motion",
            &data,
            &resources,
            &protection,
        )
        .unwrap();
    access.end_assistant_task(&identity, &reuse.id);
    access
        .undo_assistant_task(&identity, &reuse.id, None, &data, &protection)
        .unwrap();
    assert_eq!(fs::read_to_string(&module_path).unwrap(), custom);
}
