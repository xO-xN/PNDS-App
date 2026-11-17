use super::*;
use crate::project::creation::tests::project;

fn request(alternative: Option<&str>) -> AssistantResourceRequest {
    AssistantResourceRequest {
        modules: vec!["players".into()],
        libraries: vec![],
        reason: "Preserve numeric selection and restore client identity".into(),
        alternative: alternative.map(String::from),
    }
}

#[test]
fn hub_proposal_groups_its_verified_exact_node_client_before_any_project_write() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "hub-score");
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let before = fs::read(root.join("manifest.json")).unwrap();
    let proposed = access
        .propose_assistant_resources(
            &identity,
            &task.id,
            &AssistantResourceRequest {
                modules: vec!["hub".into()],
                libraries: vec![],
                reason: "Connect to the existing hub without changing local controls".into(),
                alternative: None,
            },
            &data,
            &crate::project::creation::tests::shared_libraries(),
            &protection,
        )
        .unwrap();
    let plan = &proposed.resource_plans[0];
    assert_eq!(plan.resources.len(), 2);
    assert_eq!(plan.resources[0].id, "hub");
    assert_eq!(plan.resources[1].id, "socket.io-client");
    assert_eq!(plan.resources[1].version, "4.8.4");
    assert_eq!(fs::read(root.join("manifest.json")).unwrap(), before);
    assert!(!root.join("package.json").exists());
    assert!(!root.join("modules").exists());
}

#[test]
fn approved_hub_adoption_journals_exact_runtime_and_production_dependencies_for_undo() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "hub-score");
    let data = temp.path().join("data");
    let resources = crate::project::creation::tests::shared_libraries();
    let package = r#"{"name":"custom-score","dependencies":{"custom-kit":"1.2.3"},"scripts":{"start":"node server.js"}}"#;
    fs::write(root.join("package.json"), package).unwrap();
    let manifest = fs::read(root.join("manifest.json")).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let requested = AssistantResourceRequest {
        modules: vec!["hub".into()],
        libraries: vec![],
        reason: "Connect an optional existing relay".into(),
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
    assert!(access
        .adopt_assistant_module(&identity, &task.id, "hub", &data, &resources, &protection)
        .is_err());
    assert_eq!(fs::read(root.join("manifest.json")).unwrap(), manifest);
    assert_eq!(
        fs::read_to_string(root.join("package.json")).unwrap(),
        package
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
    let adopted = access
        .adopt_assistant_module(&identity, &task.id, "hub", &data, &resources, &protection)
        .unwrap();
    let manifest_value: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(
        manifest_value["sharedLibraries"],
        serde_json::json!([
            {"id":"socket.io-client","version":"4.8.4"}
        ])
    );
    let package_value: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("package.json")).unwrap()).unwrap();
    assert_eq!(package_value["dependencies"]["socket.io-client"], "4.8.4");
    assert_eq!(package_value["dependencies"]["custom-kit"], "1.2.3");
    assert_eq!(package_value["scripts"]["start"], "node server.js");
    assert!(adopted
        .files
        .iter()
        .any(|file| file.path == "manifest.json"));
    assert!(adopted.files.iter().any(|file| file.path == "package.json"));
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "// unfinished score server"
    );
    assert!(!root.join("node_modules").exists());
    let again = access
        .propose_assistant_resources(
            &identity,
            &task.id,
            &requested,
            &data,
            &resources,
            &protection,
        )
        .unwrap();
    assert_eq!(again.resource_plans.len(), 1);
    assert_eq!(
        again.resource_plans[0].decision,
        AssistantResourceDecision::Approved
    );
    access.end_assistant_task(&identity, &task.id);
    access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .unwrap();
    assert_eq!(fs::read(root.join("manifest.json")).unwrap(), manifest);
    assert_eq!(
        fs::read_to_string(root.join("package.json")).unwrap(),
        package
    );
    assert!(!root.join("modules/pnds-hub").exists());
}

#[test]
fn hub_refuses_dependency_version_changes_before_confirmation_or_after_a_late_disk_edit() {
    for section in [
        "sharedLibraries",
        "dependencies",
        "optionalDependencies",
        "devDependencies",
    ] {
        let temp = tempfile::tempdir().unwrap();
        let root = project(temp.path(), "hub-conflict");
        let data = temp.path().join("data");
        let resources = crate::project::creation::tests::shared_libraries();
        if section == "sharedLibraries" {
            let mut manifest: serde_json::Value =
                serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
            manifest["schemaVersion"] = serde_json::json!(2);
            manifest[section] = serde_json::json!([{"id":"socket.io-client","version":"4.8.3"}]);
            fs::write(root.join("manifest.json"), manifest.to_string()).unwrap();
        } else {
            let mut package = serde_json::json!({"name":"keep-custom"});
            package[section] = serde_json::json!({"socket.io-client":"^4.8.4"});
            fs::write(root.join("package.json"), package.to_string()).unwrap();
        }
        let manifest_before = fs::read(root.join("manifest.json")).unwrap();
        let package_before = fs::read(root.join("package.json")).ok();
        let protection = Protection::default();
        let mut access = CreationAccess::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        let task = access
            .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
            .unwrap();
        let request = AssistantResourceRequest {
            modules: vec!["hub".into()],
            libraries: vec![],
            reason: "Use the existing relay".into(),
            alternative: None,
        };
        let cause = access
            .propose_assistant_resources(
                &identity,
                &task.id,
                &request,
                &data,
                &resources,
                &protection,
            )
            .unwrap_err();
        assert_eq!(cause.code, CreationErrorCode::VersionConflict, "{section}");
        assert!(cause.detail.contains("socket.io-client"));
        assert_eq!(
            fs::read(root.join("manifest.json")).unwrap(),
            manifest_before
        );
        assert_eq!(fs::read(root.join("package.json")).ok(), package_before);
        assert!(!root.join("modules").exists());
    }

    // A creator's disk edit after approval cannot silently switch an exact version.
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "late-shared-conflict");
    let data = temp.path().join("data");
    let resources = crate::project::creation::tests::shared_libraries();
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
            &AssistantResourceRequest {
                modules: vec!["hub".into()],
                libraries: vec![],
                reason: "Use the existing relay".into(),
                alternative: None,
            },
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
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    manifest["schemaVersion"] = serde_json::json!(2);
    manifest["sharedLibraries"] = serde_json::json!([{"id":"socket.io-client","version":"4.8.3"}]);
    let saved = manifest.to_string();
    fs::write(root.join("manifest.json"), &saved).unwrap();
    assert_eq!(
        access
            .adopt_assistant_library(
                &identity,
                &task.id,
                "socket.io-client",
                &data,
                &resources,
                &protection,
            )
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    assert_eq!(
        fs::read_to_string(root.join("manifest.json")).unwrap(),
        saved
    );
}

#[test]
fn managed_libraries_cannot_be_new_standalone_recommendations_but_existing_facts_are_reused() {
    for (library, version) in [("socket.io-client", "4.8.4"), ("qrcode", "1.5.4")] {
        let temp = tempfile::tempdir().unwrap();
        let root = project(temp.path(), "managed-library");
        let data = temp.path().join("data");
        let resources = crate::project::creation::tests::shared_libraries();
        let protection = Protection::default();
        let mut access = CreationAccess::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        let task = access
            .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
            .unwrap();
        let request = AssistantResourceRequest {
            modules: vec![],
            libraries: vec![library.into()],
            reason: "A model independently recommended this dependency".into(),
            alternative: None,
        };
        assert!(access
            .propose_assistant_resources(
                &identity,
                &task.id,
                &request,
                &data,
                &resources,
                &protection,
            )
            .is_err());
        assert!(access
            .adopt_assistant_library(&identity, &task.id, library, &data, &resources, &protection,)
            .is_err());
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
        manifest["schemaVersion"] = serde_json::json!(2);
        manifest["sharedLibraries"] = serde_json::json!([{"id":library,"version":version}]);
        let saved = manifest.to_string();
        fs::write(root.join("manifest.json"), &saved).unwrap();
        assert!(access
            .propose_assistant_resources(
                &identity,
                &task.id,
                &request,
                &data,
                &resources,
                &protection,
            )
            .unwrap()
            .resource_plans
            .is_empty());
        assert!(access
            .adopt_assistant_library(&identity, &task.id, library, &data, &resources, &protection,)
            .unwrap()
            .files
            .is_empty());
        assert_eq!(
            fs::read_to_string(root.join("manifest.json")).unwrap(),
            saved
        );
    }
}

#[test]
fn existing_custom_hub_source_gains_only_missing_dependencies_and_survives_task_undo() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "custom-hub");
    let data = temp.path().join("data");
    let resources = crate::project::creation::tests::shared_libraries();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    access
        .add_module(&identity, "hub", None, None, &protection)
        .unwrap();
    let custom = "// creator-owned hub behavior";
    fs::write(root.join("modules/pnds-hub/hub.js"), custom).unwrap();
    let handoff = fs::read(root.join("docs/creator-handoff.md")).unwrap();
    let manifest = fs::read(root.join("manifest.json")).unwrap();
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let request = AssistantResourceRequest {
        modules: vec!["hub".into()],
        libraries: vec![],
        reason: "Connect the existing customized module".into(),
        alternative: None,
    };
    let proposed = access
        .propose_assistant_resources(
            &identity,
            &task.id,
            &request,
            &data,
            &resources,
            &protection,
        )
        .unwrap();
    assert_eq!(proposed.resource_plans[0].resources.len(), 1);
    assert_eq!(
        proposed.resource_plans[0].resources[0].id,
        "socket.io-client"
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
    let adopted = access
        .adopt_assistant_module(&identity, &task.id, "hub", &data, &resources, &protection)
        .unwrap();
    assert_eq!(adopted.files.len(), 2);
    assert!(adopted
        .files
        .iter()
        .all(|file| file.path == "manifest.json" || file.path == "package.json"));
    let again = access
        .adopt_assistant_module(&identity, &task.id, "hub", &data, &resources, &protection)
        .unwrap();
    assert_eq!(again.files.len(), 2);
    assert_eq!(
        access
            .propose_assistant_resources(
                &identity,
                &task.id,
                &request,
                &data,
                &resources,
                &protection,
            )
            .unwrap()
            .resource_plans
            .len(),
        1
    );
    access.end_assistant_task(&identity, &task.id);
    access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("modules/pnds-hub/hub.js")).unwrap(),
        custom
    );
    assert_eq!(fs::read(root.join("manifest.json")).unwrap(), manifest);
    assert!(!root.join("package.json").exists());
    assert_eq!(
        fs::read(root.join("docs/creator-handoff.md")).unwrap(),
        handoff
    );
}

#[test]
fn creator_confirmation_survives_reopen_and_never_restores_a_live_grant() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    assert!(access
        .adopt_assistant_module(
            &identity,
            &task.id,
            "players",
            &data,
            temp.path(),
            &protection
        )
        .is_err());
    let proposed = access
        .propose_assistant_resources(
            &identity,
            &task.id,
            &request(None),
            &data,
            temp.path(),
            &protection,
        )
        .unwrap();
    assert!(!root.join("modules").exists());
    assert!(access
        .write_assistant_file(
            &identity,
            &task.id,
            &AssistantWrite {
                path: "new.js".into(),
                version: None,
                text: Some("unexpected".into()),
                edits: None
            },
            &data,
            &protection
        )
        .is_err());
    access.end_assistant_task(&identity, &task.id);
    // A new process reloads the private decision, without reopening write access.
    let mut next = CreationAccess::default();
    let reopened = next.open(&root, &protection).unwrap().project.identity;
    let plans = next
        .assistant_resource_plans(&reopened, &task.id, &data, &protection)
        .unwrap();
    assert_eq!(plans[0].id, proposed.resource_plans[0].id);
    assert_eq!(plans[0].decision, AssistantResourceDecision::Pending);
    next.decide_assistant_resources(
        &reopened,
        &task.id,
        &plans[0].id,
        AssistantResourceDecision::Approved,
        &data,
        &protection,
    )
    .unwrap();
    assert!(next
        .adopt_assistant_module(
            &reopened,
            &task.id,
            "players",
            &data,
            temp.path(),
            &protection
        )
        .is_err());
    next.begin_assistant_task(
        &reopened,
        AssistantMode::Edit,
        Some(&task.id),
        &data,
        &protection,
    )
    .unwrap();
    let installed = next
        .adopt_assistant_module(
            &reopened,
            &task.id,
            "players",
            &data,
            temp.path(),
            &protection,
        )
        .unwrap();
    assert_eq!(installed.files.len(), 9);
    assert!(installed.files.iter().all(|file| file.created));
    assert_eq!(
        fs::read_to_string(root.join("modules/pnds-players/protocol.js")).unwrap(),
        include_str!("../../../../../resources/modules/players/protocol.js")
    );
    // No repeated prompt for an existing module; no unrelated handoff tasks.
    assert!(next
        .propose_assistant_resources(
            &reopened,
            &task.id,
            &request(None),
            &data,
            temp.path(),
            &protection
        )
        .unwrap()
        .resource_plans
        .iter()
        .all(|plan| plan.decision != AssistantResourceDecision::Pending));
    assert!(!root.join("docs/creator-handoff.md").exists());
    next.end_assistant_task(&reopened, &task.id);
    let undone = next
        .undo_assistant_task(&reopened, &task.id, None, &data, &protection)
        .unwrap();
    assert!(undone.files.iter().all(|file| file.undone));
    assert!(!root.join("modules/pnds-players").exists());
    assert_eq!(
        next.module_catalog(&reopened, &protection)
            .unwrap()
            .modules
            .iter()
            .find(|item| item.id == "players")
            .unwrap()
            .state,
        ModuleState::Available
    );
}

#[test]
fn declined_resources_cannot_be_silently_reproposed_or_written_through_manifest() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
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
            &request(Some(
                "Keep the existing HTTP transport; retain its current recovery limitations",
            )),
            &data,
            temp.path(),
            &protection,
        )
        .unwrap();
    access
        .decide_assistant_resources(
            &identity,
            &task.id,
            &proposed.resource_plans[0].id,
            AssistantResourceDecision::Alternative,
            &data,
            &protection,
        )
        .unwrap();
    assert!(access
        .propose_assistant_resources(
            &identity,
            &task.id,
            &request(None),
            &data,
            temp.path(),
            &protection
        )
        .is_err());
    assert!(access
        .adopt_assistant_module(
            &identity,
            &task.id,
            "players",
            &data,
            temp.path(),
            &protection
        )
        .is_err());
    let (before, version) = text_content(
        access
            .read(&identity, "manifest.json", &protection)
            .unwrap(),
    )
    .unwrap();
    let mut value: serde_json::Value = serde_json::from_str(&before).unwrap();
    value["schemaVersion"] = serde_json::json!(2);
    value["sharedLibraries"] = serde_json::json!([{"id":"socket.io","version":"4.8.4"}]);
    assert!(access
        .write_assistant_file(
            &identity,
            &task.id,
            &AssistantWrite {
                path: "manifest.json".into(),
                version: Some(version),
                text: Some(value.to_string()),
                edits: None
            },
            &data,
            &protection
        )
        .is_err());
    // Case aliases on default macOS volumes must not evade the manifest gate.
    let journal = load(&data, &root.canonicalize().unwrap(), &task.id).unwrap();
    assert!(journal
        .check_resource_write("Manifest.JSON", Some(&before), &value.to_string(), false)
        .is_err());
    assert_eq!(
        fs::read_to_string(root.join("manifest.json")).unwrap(),
        before
    );
}

#[test]
fn interrupted_atomic_module_publication_reconciles_on_both_sides_of_rename() {
    for published in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let root = project(temp.path(), "score");
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
                &request(None),
                &data,
                temp.path(),
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
        let mut journal = load(&data, &root.canonicalize().unwrap(), &task.id).unwrap();
        for (path, text) in modules::assistant_module_assets("players").unwrap() {
            journal.entries.push(Entry {
                path,
                before: None,
                after: String::new(),
                pending: Some(text),
                undone: false,
                removed: false,
                pending_remove: false,
            });
        }
        journal.persist(&data).unwrap();
        if published {
            access
                .publish_assistant_module(&identity, "players", &protection)
                .unwrap();
        }
        access.end_assistant_task(&identity, &task.id);
        let resumed = access
            .begin_assistant_task(
                &identity,
                AssistantMode::Edit,
                Some(&task.id),
                &data,
                &protection,
            )
            .unwrap();
        assert_eq!(resumed.files.len(), if published { 9 } else { 0 });
        access
            .adopt_assistant_module(
                &identity,
                &task.id,
                "players",
                &data,
                temp.path(),
                &protection,
            )
            .unwrap();
        access.end_assistant_task(&identity, &task.id);
        access
            .undo_assistant_task(&identity, &task.id, None, &data, &protection)
            .unwrap();
        assert!(!root.join("modules/pnds-players").exists());
    }
}
