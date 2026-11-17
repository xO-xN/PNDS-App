use super::*;
use crate::project::creation::tests::{project, shared_libraries};

fn camera_request() -> AssistantResourceRequest {
    AssistantResourceRequest {
        modules: vec!["camera-handpose".into()],
        libraries: vec![],
        reason: "Use local camera landmarks in the work".into(),
        alternative: None,
    }
}
#[test]
fn camera_without_trusted_p5_leaves_no_companion_resource() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "no-p5");
    let protection = Protection::default();
    let data = temp.path().join("data");
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let before = fs::read(root.join("manifest.json")).unwrap();
    let error = access
        .propose_assistant_resources(
            &identity,
            &task.id,
            &camera_request(),
            &data,
            &shared_libraries(),
            &protection,
        )
        .unwrap_err();
    assert!(error.detail.contains("本工程还没有 p5.js"));
    assert_eq!(fs::read(root.join("manifest.json")).unwrap(), before);
    assert!(!root.join("modules").exists());
    fs::create_dir_all(root.join("public")).unwrap();
    fs::write(
        root.join("public/p5.js"),
        "/* p5.js v2.3.4 */ window.p5 = function() {};",
    )
    .unwrap();
    assert!(access
        .propose_assistant_resources(
            &identity,
            &task.id,
            &camera_request(),
            &data,
            &shared_libraries(),
            &protection
        )
        .is_err());
    assert!(!root.join("modules").exists());
}

#[test]
fn camera_combines_exact_ml5_and_models_in_one_recoverable_author_task() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "camera-score");
    let resources = shared_libraries();
    fs::create_dir_all(root.join("public/libraries")).unwrap();
    let p5 = fs::read(resources.join("browser/p5/2.3.4/p5.min.js")).unwrap();
    fs::write(root.join("public/libraries/p5.min.js"), &p5).unwrap();
    let protection = Protection::default();
    let data = temp.path().join("data");
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let proposed = access
        .propose_assistant_resources(
            &identity,
            &task.id,
            &camera_request(),
            &data,
            &resources,
            &protection,
        )
        .unwrap();
    let plan = &proposed.resource_plans[0];
    assert_eq!(
        plan.resources
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        ["camera-handpose", "ml5"]
    );
    assert_eq!(plan.resources[1].version, "1.4.0");
    assert!(!root.join("modules").exists());
    access
        .decide_assistant_resources(
            &identity,
            &task.id,
            &plan.id,
            AssistantResourceDecision::Approved,
            &data,
            &protection,
        )
        .unwrap();
    let adopted = access
        .adopt_assistant_module(
            &identity,
            &task.id,
            "camera-handpose",
            &data,
            &resources,
            &protection,
        )
        .unwrap();
    assert!(adopted
        .files
        .iter()
        .any(|file| file.path.ends_with("detector.weights.0.txt")));
    assert_eq!(
        fs::read(root.join("public/libraries/p5.min.js")).unwrap(),
        p5
    );
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(
        manifest["sharedLibraries"],
        serde_json::json!([{"id":"ml5","version":"1.4.0"}])
    );
    // Restart and verify the full frozen model survives the public task recovery boundary.
    let mut reopened = CreationAccess::default();
    let new_identity = reopened.open(&root, &protection).unwrap().project.identity;
    let resumed = reopened
        .assistant_tasks(&new_identity, &data, &protection)
        .unwrap()
        .remove(0);
    assert_eq!(resumed.files.len(), adopted.files.len());
    reopened
        .undo_assistant_task(&new_identity, &task.id, None, &data, &protection)
        .unwrap();
    assert!(!root.join("modules/pnds-camera-handpose").exists());
    assert_eq!(
        fs::read(root.join("public/libraries/p5.min.js")).unwrap(),
        p5
    );
}

#[test]
fn camera_chat_wires_a_real_blank_and_keeps_models_through_bundle_install() {
    let temp = tempfile::tempdir().unwrap();
    let data = temp.path().join("data");
    let resources = shared_libraries();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let prepared = access
        .create_blank(
            &NewProjectOptions {
                parent: temp.path().to_string_lossy().into(),
                folder_name: "camera-piece".into(),
                name: "Camera piece".into(),
                author: "Composer".into(),
                description: String::new(),
                locale: "en".into(),
                git_name: None,
                git_email: None,
            },
            &resources,
            &protection,
        )
        .unwrap();
    let root = Path::new(&prepared.project.root);
    fs::create_dir_all(root.join("public/libraries")).unwrap();
    fs::copy(
        resources.join("browser/p5/2.3.4/p5.min.js"),
        root.join("public/libraries/p5.min.js"),
    )
    .unwrap();
    let identity = access.open(root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let proposed = access
        .propose_assistant_resources(
            &identity,
            &task.id,
            &camera_request(),
            &data,
            &resources,
            &protection,
        )
        .unwrap();
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
            "camera-handpose",
            &data,
            &resources,
            &protection,
        )
        .unwrap();
    let CreationContent::Text { text, version } =
        access.read(&identity, "server.js", &protection).unwrap()
    else {
        panic!("text")
    };
    let wired = text.replace("const recording = createPerformanceRecording({", r#"const { createHandPoseWork } = createRequire(import.meta.url)('./modules/pnds-camera-handpose/work.js')
const { createHandPoseAssets } = createRequire(import.meta.url)('./modules/pnds-camera-handpose/assets.js')
const cameraAssets = createHandPoseAssets({ ml5Path: JSON.parse(process.env.PNDS_SHARED_LIBRARIES).ml5.path })
const originalSnapshot = performance.snapshot
const work = createHandPoseWork({ publish() { for (const io of realtime.values()) io.emit('pnds:performance', performance.snapshot()) } })
Object.assign(performance, work)
performance.snapshot = () => ({ ...originalSnapshot(), ...work.snapshotWork() })
const recording = createPerformanceRecording({"#).replace("  app.use(async (request, response, next) => {", "  app.use(async (request, response, next) => {\n    if (cameraAssets(request, response)) return");
    access
        .write_assistant_file(
            &identity,
            &task.id,
            &AssistantWrite {
                path: "server.js".into(),
                version: Some(version),
                text: Some(wired),
                edits: None,
            },
            &data,
            &protection,
        )
        .unwrap();
    for (path, extra) in [
        ("public/monitor.js", include_str!("camera_monitor.mjs")),
        (
            "public/performer.html",
            r#"<script src="./libraries/p5.min.js"></script><script src="./modules/pnds-camera-handpose/handpose-worker-client.js"></script><script src="./modules/pnds-camera-handpose/camera-handpose.js"></script>"#,
        ),
        (
            "public/performer.js",
            r#"
PNDS_CAMERA_HANDPOSE.mountCameraControls({ element: document.querySelector('main'), baseUrl: './modules/pnds-camera-handpose/', messages: { enable: 'Enable camera', stop: 'Stop camera', input: 'Camera input', front: 'Front camera', back: 'Back camera', unnamed: 'Camera' }, canSend: () => Boolean(globalThis.PNDS_PLAYER?.joined && globalThis.PNDS_PLAYER?.connected), send: payload => globalThis.PNDS_PLAYER.sendAction(payload) })
"#,
        ),
    ] {
        let CreationContent::Text { text, version } =
            access.read(&identity, path, &protection).unwrap()
        else {
            panic!("text")
        };
        let text = if path.ends_with(".html") {
            text.replace(
                "<script src=\"./performer.js\"></script>",
                &format!("{extra}<script src=\"./performer.js\"></script>"),
            )
        } else {
            text + extra
        };
        access
            .write_assistant_file(
                &identity,
                &task.id,
                &AssistantWrite {
                    path: path.into(),
                    version: Some(version),
                    text: Some(text),
                    edits: None,
                },
                &data,
                &protection,
            )
            .unwrap();
    }
    let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src/project/creation/assistant_tasks/resources/camera_runtime.mjs");
    let node = crate::project::session::node_binary_path().unwrap();
    let run = |project: &Path| {
        let output = std::process::Command::new(&node)
            .arg(&runtime)
            .arg(project)
            .arg(&resources)
            .output()
            .unwrap();
        if output.status.success() {
            println!("{}", String::from_utf8_lossy(&output.stdout));
        }
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    };
    run(root);
    let output = temp.path().join("camera-piece.pnds");
    crate::project::bundle::pack_project_at_with_libraries(
        root,
        Some(&output),
        false,
        "camera-test",
        Some(&resources),
    )
    .unwrap();
    let installed = crate::project::bundle::install_bundle_with_libraries(
        &temp.path().join("installed"),
        &output,
        Some(&resources),
    )
    .unwrap();
    run(&installed);
    access.end_assistant_task(&identity, &task.id);
    access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .unwrap();
    assert!(!root.join("modules/pnds-camera-handpose").exists());
}

#[test]
fn camera_declared_shared_p5_must_pass_the_actual_offline_resource_check() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "declared-p5");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    manifest["schemaVersion"] = serde_json::json!(2);
    manifest["sharedLibraries"] = serde_json::json!([{"id":"p5", "version":"2.3.4"}]);
    fs::write(
        root.join("manifest.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    let broken = temp.path().join("broken-resources");
    fs::create_dir(&broken).unwrap();
    fs::copy(
        shared_libraries().join("catalog.json"),
        broken.join("catalog.json"),
    )
    .unwrap();
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    assert!(access
        .validate_camera_module_resources(&identity, &broken, &protection)
        .is_err());
    assert!(access
        .propose_assistant_resources(
            &identity,
            &task.id,
            &camera_request(),
            &data,
            &broken,
            &protection
        )
        .is_err());
    assert!(!root.join("modules").exists());
    let after: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(after, manifest);
}

#[test]
fn camera_publication_failure_rolls_back_its_companion_manifest_change() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "camera-no-publish");
    let resources = shared_libraries();
    fs::create_dir_all(root.join("public")).unwrap();
    fs::copy(
        resources.join("browser/p5/2.3.4/p5.min.js"),
        root.join("public/p5.js"),
    )
    .unwrap();
    let protection = Protection::default();
    let data = temp.path().join("data");
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let proposed = access
        .propose_assistant_resources(
            &identity,
            &task.id,
            &camera_request(),
            &data,
            &resources,
            &protection,
        )
        .unwrap();
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
    let before = fs::read(root.join("manifest.json")).unwrap();
    fs::create_dir(root.join("modules")).unwrap();
    fs::set_permissions(root.join("modules"), fs::Permissions::from_mode(0o555)).unwrap();
    let result = access.adopt_assistant_module(
        &identity,
        &task.id,
        "camera-handpose",
        &data,
        &resources,
        &protection,
    );
    fs::set_permissions(root.join("modules"), fs::Permissions::from_mode(0o755)).unwrap();
    assert!(result.is_err());
    assert_eq!(fs::read(root.join("manifest.json")).unwrap(), before);
    assert!(!root.join("modules/pnds-camera-handpose").exists());
}

#[test]
fn camera_capacity_failure_keeps_the_authors_large_task_and_approval_without_companion_writes() {
    for existing_ml5 in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let root = project(temp.path(), "camera-capacity");
        let resources = shared_libraries();
        if existing_ml5 {
            let mut manifest: serde_json::Value =
                serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
            manifest["schemaVersion"] = serde_json::json!(2);
            manifest["sharedLibraries"] = serde_json::json!([{"id":"ml5","version":"1.4.0"}]);
            fs::write(
                root.join("manifest.json"),
                serde_json::to_vec(&manifest).unwrap(),
            )
            .unwrap();
        }
        fs::create_dir_all(root.join("public")).unwrap();
        fs::copy(
            resources.join("browser/p5/2.3.4/p5.min.js"),
            root.join("public/p5.js"),
        )
        .unwrap();
        for index in 0..7 {
            fs::write(
                root.join(format!("author-{index}.txt")),
                "original author text ".repeat(45000),
            )
            .unwrap();
        }
        let protection = Protection::default();
        let data = temp.path().join("data");
        let mut access = CreationAccess::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        let task = access
            .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
            .unwrap();
        let proposed = access
            .propose_assistant_resources(
                &identity,
                &task.id,
                &camera_request(),
                &data,
                &resources,
                &protection,
            )
            .unwrap();
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
        let authored = "composer-approved revision ".repeat(34000);
        for index in 0..7 {
            let path = format!("author-{index}.txt");
            let CreationContent::Text { version, .. } =
                access.read(&identity, &path, &protection).unwrap()
            else {
                panic!("author text")
            };
            access
                .write_assistant_file(
                    &identity,
                    &task.id,
                    &AssistantWrite {
                        path,
                        version: Some(version),
                        text: Some(authored.clone()),
                        edits: None,
                    },
                    &data,
                    &protection,
                )
                .unwrap();
        }
        let manifest_before = fs::read(root.join("manifest.json")).unwrap();
        let task_before = access
            .assistant_tasks(&identity, &data, &protection)
            .unwrap()
            .remove(0);
        let cause = access
            .adopt_assistant_module(
                &identity,
                &task.id,
                "camera-handpose",
                &data,
                &resources,
                &protection,
            )
            .unwrap_err();
        assert!(cause.detail.contains("recovery"), "{cause:?}");
        assert_eq!(
            fs::read(root.join("manifest.json")).unwrap(),
            manifest_before
        );
        assert!(!root.join("modules/pnds-camera-handpose").exists());
        for index in 0..7 {
            assert_eq!(
                fs::read_to_string(root.join(format!("author-{index}.txt"))).unwrap(),
                authored
            );
        }
        let task_after = access
            .assistant_tasks(&identity, &data, &protection)
            .unwrap()
            .remove(0);
        assert_eq!(task_after.files.len(), task_before.files.len());
        assert_eq!(
            task_after.resource_plans[0].decision,
            AssistantResourceDecision::Approved
        );
        assert_eq!(
            task_after.resource_plans[0].id,
            task_before.resource_plans[0].id
        );
    }
}

#[test]
fn camera_adopts_an_existing_verified_vendor_p5_without_moving_or_upgrading_it() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "vendor-p5");
    let resources = shared_libraries();
    fs::create_dir_all(root.join("vendor")).unwrap();
    let p5 = fs::read(resources.join("browser/p5/2.3.4/p5.min.js")).unwrap();
    fs::write(root.join("vendor/p5.bundle"), &p5).unwrap();
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let proposed = access
        .propose_assistant_resources(
            &identity,
            &task.id,
            &camera_request(),
            &data,
            &resources,
            &protection,
        )
        .unwrap();
    assert_eq!(
        proposed.resource_plans[0]
            .resources
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        ["camera-handpose", "ml5"]
    );
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
            "camera-handpose",
            &data,
            &resources,
            &protection,
        )
        .unwrap();
    assert_eq!(fs::read(root.join("vendor/p5.bundle")).unwrap(), p5);
    assert!(!root.join("public/p5.js").exists());
    assert!(root
        .join("modules/pnds-camera-handpose/PINNED.json")
        .is_file());
}

#[test]
fn camera_final_journal_capacity_is_checked_before_publishing_any_model_directory() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "camera-final-capacity");
    let resources = shared_libraries();
    fs::create_dir_all(root.join("vendor")).unwrap();
    fs::copy(
        resources.join("browser/p5/2.3.4/p5.min.js"),
        root.join("vendor/p5.bundle"),
    )
    .unwrap();
    for index in 0..6 {
        fs::write(
            root.join(format!("author-{index}.txt")),
            "original author text ".repeat(45000),
        )
        .unwrap();
    }
    let protection = Protection::default();
    let data = temp.path().join("data");
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let proposed = access
        .propose_assistant_resources(
            &identity,
            &task.id,
            &camera_request(),
            &data,
            &resources,
            &protection,
        )
        .unwrap();
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
    // A separately adopted, already approved dependency remains the author's task fact.
    access
        .adopt_assistant_library(&identity, &task.id, "ml5", &data, &resources, &protection)
        .unwrap();
    let authored = "composer-approved revision ".repeat(34000);
    for index in 0..6 {
        let path = format!("author-{index}.txt");
        let CreationContent::Text { version, .. } =
            access.read(&identity, &path, &protection).unwrap()
        else {
            panic!("author text")
        };
        access
            .write_assistant_file(
                &identity,
                &task.id,
                &AssistantWrite {
                    path,
                    version: Some(version),
                    text: Some(authored.clone()),
                    edits: None,
                },
                &data,
                &protection,
            )
            .unwrap();
    }
    // Setup uses the real serialization only to position a legal public task one
    // byte below the pending limit. Business assertions below observe public files.
    let assets = modules::assistant_module_assets("camera-handpose").unwrap();
    let mut pending = load(&data, &fs::canonicalize(&root).unwrap(), &task.id).unwrap();
    pending.entries.push(Entry {
        path: "padding.txt".into(),
        before: None,
        after: String::new(),
        pending: None,
        undone: false,
        removed: false,
        pending_remove: false,
    });
    for (path, text) in &assets {
        pending.entries.push(Entry {
            path: path.clone(),
            before: None,
            after: String::new(),
            pending: Some(text.clone()),
            undone: false,
            removed: false,
            pending_remove: false,
        });
    }
    let padding_len = 16 * 1024 * 1024 - 1 - serde_json::to_vec(&pending).unwrap().len();
    assert!(padding_len > 0 && padding_len < TEXT_MAX_BYTES as usize);
    let padding = "x".repeat(padding_len);
    access
        .write_assistant_file(
            &identity,
            &task.id,
            &AssistantWrite {
                path: "padding.txt".into(),
                version: None,
                text: Some(padding.clone()),
                edits: None,
            },
            &data,
            &protection,
        )
        .unwrap();
    let before = fs::read(root.join("manifest.json")).unwrap();
    assert!(access
        .adopt_assistant_module(
            &identity,
            &task.id,
            "camera-handpose",
            &data,
            &resources,
            &protection
        )
        .is_err());
    assert!(
        !root.join("modules/pnds-camera-handpose").exists(),
        "a final-size failure must precede exclusive module publication"
    );
    assert_eq!(fs::read(root.join("manifest.json")).unwrap(), before);
    assert_eq!(
        fs::read_to_string(root.join("padding.txt")).unwrap(),
        padding
    );
    for index in 0..6 {
        assert_eq!(
            fs::read_to_string(root.join(format!("author-{index}.txt"))).unwrap(),
            authored
        );
    }
    let recovered = access
        .assistant_tasks(&identity, &data, &protection)
        .unwrap()
        .remove(0);
    assert_eq!(recovered.files.len(), 8);
    assert_eq!(
        recovered.resource_plans[0].decision,
        AssistantResourceDecision::Approved
    );
}
