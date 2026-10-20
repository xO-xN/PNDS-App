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
        .adopt_assistant_module(&identity, &task.id, "players", &data, &protection)
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
        .adopt_assistant_module(&reopened, &task.id, "players", &data, &protection)
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
        .adopt_assistant_module(&reopened, &task.id, "players", &data, &protection)
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
        .adopt_assistant_module(&identity, &task.id, "players", &data, &protection)
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
            .adopt_assistant_module(&identity, &task.id, "players", &data, &protection)
            .unwrap();
        access.end_assistant_task(&identity, &task.id);
        access
            .undo_assistant_task(&identity, &task.id, None, &data, &protection)
            .unwrap();
        assert!(!root.join("modules/pnds-players").exists());
    }
}
