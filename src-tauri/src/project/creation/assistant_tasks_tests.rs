use super::*;
fn write(path: &str, version: Option<String>, text: &str) -> AssistantWrite {
    AssistantWrite {
        path: path.into(),
        version,
        text: Some(text.into()),
        edits: None,
    }
}
#[test]
fn local_preview_install_is_recoverable_and_preserves_custom_adapters() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    fs::create_dir_all(root.join("public")).unwrap();
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let installed = access
        .install_assistant_preview_adapter(&identity, &task.id, &data, &protection)
        .unwrap();
    assert_eq!(installed.files.len(), 1);
    assert!(installed.files[0].created);
    assert_eq!(
        fs::read_to_string(root.join("public/pnds-preview.mjs")).unwrap(),
        include_str!("../../../resources/parameter-preview/adapter.mjs")
    );
    access
        .install_assistant_preview_adapter(&identity, &task.id, &data, &protection)
        .unwrap();
    access.end_assistant_task(&identity, &task.id);
    access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .unwrap();
    assert!(!root.join("public/pnds-preview.mjs").exists());
    fs::write(root.join("public/pnds-preview.mjs"), "custom").unwrap();
    let next = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    assert_eq!(
        access
            .install_assistant_preview_adapter(&identity, &next.id, &data, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    assert_eq!(
        fs::read_to_string(root.join("public/pnds-preview.mjs")).unwrap(),
        "custom"
    );
}

#[test]
fn structure_edits_refuse_stale_removal_handoff_deletion_and_html_script_names() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    fs::write(root.join("old.js"), "saved").unwrap();
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    assert_eq!(
        access
            .remove_assistant_file(&identity, &task.id, "old.js", "stale", &data, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    assert!(access
        .remove_assistant_file(
            &identity,
            &task.id,
            "manifest.json",
            "stale",
            &data,
            &protection
        )
        .is_err());
    assert!(access
        .write_assistant_file(
            &identity,
            &task.id,
            &write("monitor.html.js", None, "<!doctype html><html></html>"),
            &data,
            &protection
        )
        .is_err());
    access.end_assistant_task(&identity, &task.id);
    let handoff = access
        .begin_assistant_task(&identity, AssistantMode::Handoff, None, &data, &protection)
        .unwrap();
    assert!(access
        .remove_assistant_file(
            &identity,
            &handoff.id,
            "old.js",
            &file_version(b"saved"),
            &data,
            &protection
        )
        .is_err());
    assert_eq!(fs::read_to_string(root.join("old.js")).unwrap(), "saved");
}

#[test]
fn removed_files_are_recoverable_after_reopen_and_never_overwrite_recreated_content() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    fs::write(root.join("old.js"), "original").unwrap();
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    access
        .remove_assistant_file(
            &identity,
            &task.id,
            "old.js",
            &file_version(b"original"),
            &data,
            &protection,
        )
        .unwrap();
    assert!(!root.join("old.js").exists());
    access.end_assistant_task(&identity, &task.id);
    drop(access);
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    fs::write(root.join("old.js"), "creator edit").unwrap();
    assert!(access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .is_err());
    fs::remove_file(root.join("old.js")).unwrap();
    access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .unwrap();
    assert_eq!(fs::read_to_string(root.join("old.js")).unwrap(), "original");
}
#[test]
fn edit_task_recovers_existing_and_new_files_after_reopen_and_refuses_external_changes() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let data = temp.path().join("data");
    fs::write(root.join("score.js"), "before").unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let CreationContent::Text { version, .. } =
        access.read(&identity, "score.js", &protection).unwrap()
    else {
        panic!()
    };
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    access
        .write_assistant_file(
            &identity,
            &task.id,
            &write("score.js", Some(version), "after"),
            &data,
            &protection,
        )
        .unwrap();
    access
        .write_assistant_file(
            &identity,
            &task.id,
            &write("new.html", None, "<html></html>"),
            &data,
            &protection,
        )
        .unwrap();
    drop(access);
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    assert_eq!(
        access
            .assistant_tasks(&identity, &data, &protection)
            .unwrap()[0]
            .files
            .len(),
        2
    );
    fs::write(root.join("score.js"), "user edit").unwrap();
    assert_eq!(
        access
            .undo_assistant_task(&identity, &task.id, None, &data, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    assert!(root.join("new.html").exists());
    access
        .undo_assistant_task(&identity, &task.id, Some("new.html"), &data, &protection)
        .unwrap();
    assert!(!root.join("new.html").exists());
    fs::write(root.join("score.js"), "after").unwrap();
    access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .unwrap();
    assert_eq!(fs::read_to_string(root.join("score.js")).unwrap(), "before");
}
#[test]
fn handoff_grant_cannot_edit_code_or_run_checks_and_preserves_existing_document() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Handoff, None, &data, &protection)
        .unwrap();
    assert!(access
        .authorize_assistant_task(&identity, &task.id, true, &protection)
        .is_err());
    assert!(access
        .write_assistant_file(
            &identity,
            &task.id,
            &write("new.js", None, "bad"),
            &data,
            &protection
        )
        .is_err());
    access
        .write_assistant_file(
            &identity,
            &task.id,
            &write(
                "docs/creator-handoff.md",
                None,
                "# Confirmed requirements\nTask A: done",
            ),
            &data,
            &protection,
        )
        .unwrap();
    assert!(access
        .write_assistant_file(
            &identity,
            &task.id,
            &write("docs/creator-handoff.md", None, "overwrite"),
            &data,
            &protection
        )
        .is_err());
    access.end_assistant_task(&identity, &task.id);
    assert!(access
        .write_assistant_file(
            &identity,
            &task.id,
            &write("new.js", None, "bad"),
            &data,
            &protection
        )
        .is_err());
}
#[test]
fn exact_edits_on_large_files_preserve_middle_and_refuse_ambiguous_anchors() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let data = temp.path().join("data");
    let before = format!("start\n{}\nend", "middle\n".repeat(10000));
    fs::write(root.join("large.js"), &before).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let mut change = AssistantWrite {
        path: "large.js".into(),
        version: Some(file_version(before.as_bytes())),
        text: None,
        edits: Some(vec![AssistantEdit {
            old_text: "middle".into(),
            new_text: "lost".into(),
        }]),
    };
    assert!(access
        .write_assistant_file(&identity, &task.id, &change, &data, &protection)
        .is_err());
    change.edits = Some(vec![AssistantEdit {
        old_text: "start".into(),
        new_text: "updated".into(),
    }]);
    access
        .write_assistant_file(&identity, &task.id, &change, &data, &protection)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("large.js")).unwrap(),
        before.replacen("start", "updated", 1)
    );
}

#[test]
fn coordinated_edit_can_create_more_than_eight_files_and_undo_every_file() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    for number in 0..10 {
        access
            .write_assistant_file(
                &identity,
                &task.id,
                &write(
                    &format!("part-{number}.js"),
                    None,
                    "export const ready = true;",
                ),
                &data,
                &protection,
            )
            .unwrap();
    }
    assert_eq!(
        access
            .assistant_tasks(&identity, &data, &protection)
            .unwrap()[0]
            .files
            .len(),
        10
    );
    access.end_assistant_task(&identity, &task.id);
    access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .unwrap();
    for number in 0..10 {
        assert!(!root.join(format!("part-{number}.js")).exists());
    }
}
