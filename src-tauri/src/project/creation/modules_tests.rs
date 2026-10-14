use super::*;

#[test]
fn adds_six_offline_modules_with_real_sources_provenance_and_one_pending_handoff_each() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let before = fs::read(root.join("manifest.json")).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let ids = [
        "qr",
        "players",
        "theme-follow",
        "locale-follow",
        "monitor-state",
        "hub",
    ];
    assert_eq!(
        access
            .module_catalog(&identity, &protection)
            .unwrap()
            .modules
            .len(),
        6
    );
    for id in ids {
        let catalog = access.module_catalog(&identity, &protection).unwrap();
        let result = access
            .add_module(
                &identity,
                id,
                None,
                catalog.handoff_version.as_deref(),
                &protection,
            )
            .unwrap();
        assert!(result.handoff_recorded);
        assert!(!result.already_added);
        assert!(result.error.is_none());
        for path in result.files {
            assert!(matches!(
                access.read(&identity, &path, &protection).unwrap(),
                CreationContent::Text { .. }
            ));
        }
        let record =
            fs::read_to_string(root.join(format!("modules/pnds-{id}/pnds-module.json"))).unwrap();
        assert!(record.contains("sha256:"));
        assert!(record.contains("hostProtocol"));
        assert!(record.contains("sha256"));
        assert!(record.contains("pending"));
    }
    assert_eq!(fs::read(root.join("manifest.json")).unwrap(), before);
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "// unfinished score server"
    );
    assert!(!root.join("node_modules").exists());
    let handoff = access.read_handoff(&identity, &protection).unwrap();
    assert_eq!(handoff.text.matches("<!-- pnds-task:").count(), 6);
    let source = fs::read_to_string(root.join("modules/pnds-players/protocol.js")).unwrap();
    assert!(source.contains("function attachPlayers"));
    assert!(source.contains("policy.join"));
}

#[test]
fn repeats_preserve_custom_sources_agent_tasks_and_do_not_duplicate_handoffs() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    access
        .add_module(&identity, "theme-follow", None, None, &protection)
        .unwrap();
    let custom = root.join("modules/pnds-theme-follow/theme-follow.js");
    fs::write(&custom, "// artist customization").unwrap();
    let handoff_path = root.join("docs/creator-handoff.md");
    let before = fs::read_to_string(&handoff_path).unwrap().replace(
        "Status / 状态: pending",
        "Status / 状态: verified by artist",
    );
    fs::write(&handoff_path, &before).unwrap();
    let catalog = access.module_catalog(&identity, &protection).unwrap();
    let entry = catalog
        .modules
        .iter()
        .find(|entry| entry.id == "theme-follow")
        .unwrap();
    let repeated = access
        .add_module(
            &identity,
            "theme-follow",
            entry.record_version.as_deref(),
            catalog.handoff_version.as_deref(),
            &protection,
        )
        .unwrap();
    assert!(repeated.already_added);
    assert_eq!(
        fs::read_to_string(custom).unwrap(),
        "// artist customization"
    );
    assert_eq!(fs::read_to_string(handoff_path).unwrap(), before);
}

#[test]
fn external_handoff_and_record_changes_require_fresh_confirmation() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let catalog = access.module_catalog(&identity, &protection).unwrap();
    fs::create_dir(root.join("docs")).unwrap();
    fs::write(root.join("docs/creator-handoff.md"), "External task").unwrap();
    let error = access
        .add_module(
            &identity,
            "qr",
            None,
            catalog.handoff_version.as_deref(),
            &protection,
        )
        .unwrap_err();
    assert_eq!(error.code, CreationErrorCode::VersionConflict);
    assert!(!root.join("modules").exists());
    let catalog = access.module_catalog(&identity, &protection).unwrap();
    access
        .add_module(
            &identity,
            "qr",
            None,
            catalog.handoff_version.as_deref(),
            &protection,
        )
        .unwrap();
    let catalog = access.module_catalog(&identity, &protection).unwrap();
    let entry = catalog
        .modules
        .iter()
        .find(|entry| entry.id == "qr")
        .unwrap();
    let record = root.join("modules/pnds-qr/pnds-module.json");
    let text = fs::read_to_string(&record).unwrap();
    fs::write(&record, format!("{text}\n")).unwrap();
    assert_eq!(
        access
            .add_module(
                &identity,
                "qr",
                entry.record_version.as_deref(),
                catalog.handoff_version.as_deref(),
                &protection
            )
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
}

#[test]
fn handoff_failure_reports_real_partial_files_and_retry_only_records_the_task() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let docs = root.join("docs");
    fs::create_dir(&docs).unwrap();
    fs::set_permissions(&docs, fs::Permissions::from_mode(0o555)).unwrap();
    let result = access
        .add_module(&identity, "locale-follow", None, None, &protection)
        .unwrap();
    fs::set_permissions(&docs, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(!result.handoff_recorded);
    assert_eq!(result.error.unwrap().code, CreationErrorCode::Permission);
    assert!(result.files.iter().all(|path| root.join(path).is_file()));
    let source = root.join("modules/pnds-locale-follow/locale-follow.js");
    fs::write(&source, "// external agent already wired this").unwrap();
    let catalog = access.module_catalog(&identity, &protection).unwrap();
    let entry = catalog
        .modules
        .iter()
        .find(|entry| entry.id == "locale-follow")
        .unwrap();
    let retry = access
        .add_module(
            &identity,
            "locale-follow",
            entry.record_version.as_deref(),
            catalog.handoff_version.as_deref(),
            &protection,
        )
        .unwrap();
    assert!(retry.handoff_recorded);
    assert_eq!(
        fs::read_to_string(source).unwrap(),
        "// external agent already wired this"
    );
    assert_eq!(
        access
            .read_handoff(&identity, &protection)
            .unwrap()
            .text
            .matches("<!-- pnds-task:")
            .count(),
        1
    );
    assert!(fs::read_dir(root.join("modules"))
        .unwrap()
        .all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".pnds-save-")));
}

#[test]
fn protected_sources_unknown_ids_and_escaping_links_cannot_add_modules() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    for source in [
        CreationSource::Bundle,
        CreationSource::Utility,
        CreationSource::ReadOnlyFolder,
    ] {
        let protection = match source {
            CreationSource::Bundle => Protection {
                bundles: vec![root.clone()],
                ..Default::default()
            },
            CreationSource::Utility => Protection {
                utilities: vec![root.clone()],
                ..Default::default()
            },
            _ => {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&root, fs::Permissions::from_mode(0o555)).unwrap();
                Protection::default()
            }
        };
        let mut access = CreationAccess::default();
        let opened = access.open(&root, &protection).unwrap();
        assert_eq!(opened.project.source, source);
        assert_eq!(
            access
                .add_module(&opened.project.identity, "qr", None, None, &protection)
                .unwrap_err()
                .code,
            CreationErrorCode::Permission
        );
    }
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    assert_eq!(
        access
            .add_module(&identity, "../../elsewhere", None, None, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidProject
    );
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    symlink(&outside, root.join("modules")).unwrap();
    assert_eq!(
        access
            .add_module(&identity, "qr", None, None, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::PathEscape
    );
    assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
}

#[test]
fn existing_unknown_module_files_are_never_replaced_or_claimed_as_added() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    fs::create_dir_all(root.join("modules/pnds-qr")).unwrap();
    fs::write(root.join("modules/pnds-qr/qr.js"), "// custom QR").unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    assert_eq!(
        access
            .add_module(&identity, "qr", None, None, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    assert_eq!(
        fs::read_to_string(root.join("modules/pnds-qr/qr.js")).unwrap(),
        "// custom QR"
    );
    assert!(!root.join("docs").exists());
}

#[test]
fn added_sources_round_trip_in_a_real_bundle_while_handoff_stays_in_source() {
    let temp = tempfile::tempdir().unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let prepared = access
        .create_blank(
            &NewProjectOptions {
                parent: temp.path().to_string_lossy().into_owned(),
                folder_name: "score".into(),
                name: "Score".into(),
                author: "".into(),
                description: "".into(),
                locale: "en".into(),
            },
            &protection,
        )
        .unwrap();
    let identity = prepared.project.identity;
    access.commit(&identity, &protection).unwrap();
    let before_manifest = fs::read(temp.path().join("score/manifest.json")).unwrap();
    let catalog = access.module_catalog(&identity, &protection).unwrap();
    access
        .add_module(
            &identity,
            "players",
            None,
            catalog.handoff_version.as_deref(),
            &protection,
        )
        .unwrap();
    let before = fs::read(temp.path().join("score/modules/pnds-players/protocol.js")).unwrap();
    let output = temp.path().join("score.pnds");
    crate::project::bundle::pack_project_to(&temp.path().join("score"), &output, "1.6.0").unwrap();
    let installed =
        crate::project::bundle::install_bundle(&temp.path().join("bundles"), &output).unwrap();
    assert_eq!(
        fs::read(installed.join("modules/pnds-players/protocol.js")).unwrap(),
        before
    );
    assert!(!installed.join("docs/creator-handoff.md").exists());
    assert_eq!(
        fs::read(temp.path().join("score/manifest.json")).unwrap(),
        before_manifest
    );
    assert!(temp.path().join("score/docs/creator-handoff.md").is_file());
}

#[test]
fn app_updates_preserve_legacy_module_versions_files_and_original_pending_task() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let directory = root.join("modules/pnds-monitor-state");
    fs::create_dir_all(&directory).unwrap();
    let names = [
        "monitor-state.js",
        "client.js",
        "package.json",
        "README.md",
        "LICENSE.md",
    ];
    for name in names {
        fs::write(directory.join(name), "// author's legacy implementation").unwrap();
    }
    let legacy_hashes: serde_json::Value =
        serde_json::from_str(include_str!("../../../resources/modules/LEGACY.json")).unwrap();
    let record = serde_json::json!({
        "formatVersion": 1, "id": "monitor-state", "version": "0.1.0",
        "source": { "repository": "https://github.com/xO-xN/PNDS-Template",
            "revision": "e3f4769537d6aeb2016b76610e80dea7b639384f", "version": "0.5.1" },
        "files": names.map(|name| serde_json::json!({"path": name, "sha256": legacy_hashes[if name == "LICENSE.md" {name.to_string()} else {format!("monitor-state/{name}")}]})),
        "wiring": "pending", "validation": "pending"
    });
    fs::write(
        directory.join("pnds-module.json"),
        serde_json::to_vec(&record).unwrap(),
    )
    .unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let catalog = access.module_catalog(&identity, &protection).unwrap();
    let module = catalog
        .modules
        .iter()
        .find(|entry| entry.id == "monitor-state")
        .unwrap();
    assert_eq!(module.version, "0.1.0");
    assert_eq!(module.state, modules::ModuleState::NeedsHandoff);
    let result = access
        .add_module(
            &identity,
            "monitor-state",
            module.record_version.as_deref(),
            None,
            &protection,
        )
        .unwrap();
    assert!(result.handoff_recorded);
    assert!(!directory.join("monitor-client.js").exists());
    assert_eq!(
        fs::read_to_string(directory.join("client.js")).unwrap(),
        "// author's legacy implementation"
    );
    assert!(access
        .read_handoff(&identity, &protection)
        .unwrap()
        .text
        .contains("(0.1.0)"));
    assert_eq!(result.files.len(), 6);
    let catalog = access.module_catalog(&identity, &protection).unwrap();
    assert_eq!(
        catalog
            .modules
            .iter()
            .find(|entry| entry.id == "monitor-state")
            .unwrap()
            .state,
        modules::ModuleState::Added
    );
}

#[test]
fn published_modules_wire_together_through_real_node_http_and_socket_clients() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    for id in [
        "qr",
        "players",
        "theme-follow",
        "locale-follow",
        "monitor-state",
        "hub",
    ] {
        let catalog = access.module_catalog(&identity, &protection).unwrap();
        let result = access
            .add_module(
                &identity,
                id,
                None,
                catalog.handoff_version.as_deref(),
                &protection,
            )
            .unwrap();
        assert!(result.handoff_recorded);
    }
    let script =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/project/creation/modules_runtime.mjs");
    let output = std::process::Command::new("node")
        .arg(script)
        .arg(root)
        .output()
        .expect("Node 24 for the published-module fixture");
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
