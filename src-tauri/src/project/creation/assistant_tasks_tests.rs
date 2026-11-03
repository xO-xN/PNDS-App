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
fn assistant_material_adoption_uses_private_original_and_journaled_undo() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let data = temp.path().join("data");
    let source = temp.path().join("Grid.js");
    fs::write(&source, "class Grid { size = 8; }").unwrap();
    fs::write(root.join("identical.js"), "class Grid { size = 8; }").unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let material = access
        .add_material(&data, &identity, &source, &protection)
        .unwrap();
    fs::write(&source, "creator changed external original").unwrap();
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    access
        .create_assistant_directory(&identity, &task.id, "public/scores", &data, &protection)
        .unwrap();
    let adoption = AssistantMaterialAdoption {
        id: material.id.clone(),
        version: material.version.clone(),
        path: "public/scores/Grid.js".into(),
        text: None,
    };
    let saved = access
        .adopt_assistant_material(&identity, &task.id, &adoption, &data, &protection)
        .unwrap();
    assert!(saved
        .files
        .iter()
        .any(|file| file.path == adoption.path && file.created));
    assert_eq!(
        access
            .adopt_assistant_material(&identity, &task.id, &adoption, &data, &protection)
            .unwrap()
            .files
            .len(),
        saved.files.len()
    );
    let identical = AssistantMaterialAdoption {
        path: "identical.js".into(),
        ..adoption.clone()
    };
    assert_eq!(
        access
            .adopt_assistant_material(&identity, &task.id, &identical, &data, &protection)
            .unwrap()
            .files
            .len(),
        saved.files.len()
    );
    assert!(
        matches!(access.read(&identity, &adoption.path, &protection).unwrap(), CreationContent::Text { text, .. } if text == "class Grid { size = 8; }")
    );
    access.end_assistant_task(&identity, &task.id);
    access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .unwrap();
    assert!(!root.join("public").exists());
    assert_eq!(
        fs::read_to_string(root.join("identical.js")).unwrap(),
        "class Grid { size = 8; }"
    );
    assert_eq!(
        access
            .read_material(
                &data,
                &identity,
                &CreationMaterialRead {
                    id: material.id,
                    version: material.version,
                    offset: 0,
                    page_length: 65536
                },
                &protection
            )
            .unwrap()
            .text,
        "class Grid { size = 8; }"
    );
    assert_eq!(
        fs::read_to_string(source).unwrap(),
        "creator changed external original"
    );
}
#[test]
fn assistant_material_collision_cannot_fall_back_to_a_generic_versioned_write() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let data = temp.path().join("data");
    let source = temp.path().join("Grid.js");
    fs::write(&source, "class Grid { size = 8; }").unwrap();
    fs::write(root.join("Grid.js"), "creator grid").unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let material = access
        .add_material(&data, &identity, &source, &protection)
        .unwrap();
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let adoption = AssistantMaterialAdoption {
        id: material.id,
        version: material.version,
        path: "Grid.js".into(),
        text: None,
    };
    assert_eq!(
        access
            .adopt_assistant_material(&identity, &task.id, &adoption, &data, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    let CreationContent::Text { version, .. } =
        access.read(&identity, "Grid.js", &protection).unwrap()
    else {
        panic!("text target")
    };
    assert_eq!(
        access
            .write_assistant_file(
                &identity,
                &task.id,
                &write("Grid.js", Some(version.clone()), "bypass collision"),
                &data,
                &protection
            )
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    assert_eq!(
        access
            .write_assistant_file(
                &identity,
                &task.id,
                &write("grid.js", Some(version), "bypass using path case"),
                &data,
                &protection
            )
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    access.end_assistant_task(&identity, &task.id);
    drop(access);
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    access
        .begin_assistant_task(
            &identity,
            AssistantMode::Edit,
            Some(&task.id),
            &data,
            &protection,
        )
        .unwrap();
    let CreationContent::Text { version, .. } =
        access.read(&identity, "Grid.js", &protection).unwrap()
    else {
        panic!("text target")
    };
    assert_eq!(
        access
            .write_assistant_file(
                &identity,
                &task.id,
                &write("Grid.js", Some(version.clone()), "bypass after restart"),
                &data,
                &protection
            )
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    assert_eq!(
        access
            .remove_assistant_file(&identity, &task.id, "Grid.js", &version, &data, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    assert_eq!(
        fs::read_to_string(root.join("Grid.js")).unwrap(),
        "creator grid"
    );
}
#[test]
fn assistant_material_adoption_protects_current_source_owner_and_direct_paths() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let other = tests::project(temp.path(), "other");
    let data = temp.path().join("data");
    let source = temp.path().join("Grid.js");
    fs::write(&source, "class Grid {}").unwrap();
    fs::create_dir(root.join("real")).unwrap();
    symlink(root.join("real"), root.join("alias")).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let material = access
        .add_material(&data, &identity, &source, &protection)
        .unwrap();
    symlink(&source, root.join("alias.js")).unwrap();
    let mut adoption = AssistantMaterialAdoption {
        id: material.id,
        version: material.version,
        path: "Grid.js".into(),
        text: None,
    };
    let discussion = access
        .begin_assistant_task(
            &identity,
            AssistantMode::Discussion,
            None,
            &data,
            &protection,
        )
        .unwrap();
    assert!(access
        .adopt_assistant_material(&identity, &discussion.id, &adoption, &data, &protection)
        .is_err());
    access.end_assistant_task(&identity, &discussion.id);
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let original_version = adoption.version.clone();
    adoption.version = "0".repeat(64);
    assert_eq!(
        access
            .adopt_assistant_material(&identity, &task.id, &adoption, &data, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    adoption.version = original_version;
    for path in [
        ".env",
        "../outside.js",
        "alias/Grid.js",
        "alias.js",
        "node_modules/Grid.js",
    ] {
        adoption.path = path.into();
        assert!(
            access
                .adopt_assistant_material(&identity, &task.id, &adoption, &data, &protection)
                .is_err(),
            "{path}"
        );
    }
    adoption.path = "Grid.js".into();
    access
        .remove_material(&data, &identity, &adoption.id, &protection)
        .unwrap();
    assert_eq!(
        access
            .adopt_assistant_material(&identity, &task.id, &adoption, &data, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::Missing
    );
    access.open(&other, &protection).unwrap();
    assert_eq!(
        access
            .adopt_assistant_material(&identity, &task.id, &adoption, &data, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
    assert!(!root.join("Grid.js").exists());
    assert_eq!(fs::read_to_string(source).unwrap(), "class Grid {}");
}

#[test]
fn assistant_material_adaptations_and_later_creator_edits_keep_originals_and_atomic_undo() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let data = temp.path().join("data");
    let source = temp.path().join("Pattern.js");
    fs::write(&source, "class Pattern { resource = './palette.txt'; }").unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let material = access
        .add_material(&data, &identity, &source, &protection)
        .unwrap();
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let adoption = AssistantMaterialAdoption {
        id: material.id.clone(),
        version: material.version.clone(),
        path: "Pattern.js".into(),
        text: Some("class Pattern { resource = './assets/palette.txt'; }".into()),
    };
    access
        .adopt_assistant_material(&identity, &task.id, &adoption, &data, &protection)
        .unwrap();
    let CreationContent::Text {
        text: server,
        version,
    } = access.read(&identity, "server.js", &protection).unwrap()
    else {
        panic!("entry text")
    };
    access
        .write_assistant_file(
            &identity,
            &task.id,
            &write("server.js", Some(version.clone()), "// wired entry"),
            &data,
            &protection,
        )
        .unwrap();
    assert_eq!(
        access
            .save(&identity, "server.js", "stale entry", &version, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    fs::write(root.join("Pattern.js"), "creator later edit").unwrap();
    access.end_assistant_task(&identity, &task.id);
    assert_eq!(
        access
            .undo_assistant_task(&identity, &task.id, None, &data, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "// wired entry"
    );
    access
        .undo_assistant_task(&identity, &task.id, Some("server.js"), &data, &protection)
        .unwrap();
    assert_eq!(fs::read_to_string(root.join("server.js")).unwrap(), server);
    assert_eq!(
        fs::read_to_string(root.join("Pattern.js")).unwrap(),
        "creator later edit"
    );
    assert_eq!(
        access
            .read_material(
                &data,
                &identity,
                &CreationMaterialRead {
                    id: material.id,
                    version: material.version,
                    offset: 0,
                    page_length: 65536
                },
                &protection
            )
            .unwrap()
            .text,
        "class Pattern { resource = './palette.txt'; }"
    );
}
#[test]
fn assistant_directories_survive_restart_accept_files_and_undo_after_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    fs::create_dir(root.join("public")).unwrap();
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let created = access
        .create_assistant_directory(
            &identity,
            &task.id,
            "public/grid/patterns",
            &data,
            &protection,
        )
        .unwrap();
    assert_eq!(created.files.len(), 2);
    assert!(access
        .poll(&identity, 0, &protection)
        .unwrap()
        .directories
        .unwrap()
        .contains(&"public/grid/patterns".into()));
    drop(access);
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    access
        .begin_assistant_task(
            &identity,
            AssistantMode::Edit,
            Some(&task.id),
            &data,
            &protection,
        )
        .unwrap();
    let reused = access
        .create_assistant_directory(
            &identity,
            &task.id,
            "public/grid/patterns",
            &data,
            &protection,
        )
        .unwrap();
    assert_eq!(reused.files.len(), 2);
    access
        .write_assistant_file(
            &identity,
            &task.id,
            &write(
                "public/grid/patterns/Grid.js",
                None,
                "export const grid = 8;",
            ),
            &data,
            &protection,
        )
        .unwrap();
    access.end_assistant_task(&identity, &task.id);
    access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .unwrap();
    assert!(!root.join("public/grid").exists());
    assert!(root.join("public").is_dir());
}
#[test]
fn assistant_directory_ownership_refuses_writes_after_creator_replacement() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    access
        .create_assistant_directory(&identity, &task.id, "grid", &data, &protection)
        .unwrap();
    fs::rename(root.join("grid"), root.join("original-grid")).unwrap();
    fs::create_dir(root.join("grid")).unwrap();
    assert!(access
        .write_assistant_file(
            &identity,
            &task.id,
            &write("grid/Grid.js", None, "do not publish"),
            &data,
            &protection
        )
        .is_err());
    assert!(!root.join("grid/Grid.js").exists());
    access.end_assistant_task(&identity, &task.id);
    assert!(access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .is_err());
    assert!(root.join("grid").is_dir());
}
#[test]
fn assistant_directories_refuse_discussion_files_aliases_exclusions_and_lost_identity() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let data = temp.path().join("data");
    let protection = Protection::default();
    fs::write(root.join("Grid"), "creator source").unwrap();
    fs::create_dir(root.join("real")).unwrap();
    symlink(root.join("real"), root.join("alias")).unwrap();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let discussion = access
        .begin_assistant_task(
            &identity,
            AssistantMode::Discussion,
            None,
            &data,
            &protection,
        )
        .unwrap();
    assert!(access
        .create_assistant_directory(&identity, &discussion.id, "unapproved", &data, &protection)
        .is_err());
    assert!(!root.join("unapproved").exists());
    access.end_assistant_task(&identity, &discussion.id);
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    for path in [
        "Grid",
        "Grid/nested",
        "alias",
        "alias/nested",
        "../escape",
        "/escape",
        "node_modules/generated",
        ".env/secret",
        "grid//nested",
    ] {
        assert!(
            access
                .create_assistant_directory(&identity, &task.id, path, &data, &protection)
                .is_err(),
            "{path}"
        );
    }
    assert_eq!(
        fs::read_to_string(root.join("Grid")).unwrap(),
        "creator source"
    );
    assert!(!root.join("real/nested").exists());
    fs::rename(&root, temp.path().join("moved-score")).unwrap();
    fs::create_dir(&root).unwrap();
    assert_eq!(
        access
            .create_assistant_directory(&identity, &task.id, "grid", &data, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
    assert!(!root.join("grid").exists());
}

#[test]
fn assistant_directory_undo_retains_creator_files_and_later_file_changes() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    access
        .create_assistant_directory(&identity, &task.id, "grid/patterns", &data, &protection)
        .unwrap();
    access
        .write_assistant_file(
            &identity,
            &task.id,
            &write("grid/patterns/Grid.js", None, "original task bytes"),
            &data,
            &protection,
        )
        .unwrap();
    access.end_assistant_task(&identity, &task.id);
    fs::write(root.join("grid/patterns/Grid.js"), "later creator change").unwrap();
    assert!(access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .is_err());
    assert_eq!(
        fs::read_to_string(root.join("grid/patterns/Grid.js")).unwrap(),
        "later creator change"
    );
    fs::write(root.join("grid/patterns/Grid.js"), "original task bytes").unwrap();
    fs::write(root.join("grid/patterns/creator.txt"), "keep me").unwrap();
    let undone = access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .unwrap();
    assert!(!root.join("grid/patterns/Grid.js").exists());
    assert_eq!(
        fs::read_to_string(root.join("grid/patterns/creator.txt")).unwrap(),
        "keep me"
    );
    assert!(undone
        .files
        .iter()
        .filter(|file| file.directory == Some(true))
        .all(|directory| !directory.undone));
}

#[test]
fn assistant_directory_partial_failure_retains_verified_progress_for_resume_and_undo() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    for index in 0..63 {
        access
            .create_assistant_directory(
                &identity,
                &task.id,
                &format!("grid-{index}"),
                &data,
                &protection,
            )
            .unwrap();
    }
    assert_eq!(
        access
            .create_assistant_directory(
                &identity,
                &task.id,
                "extra/unpublished",
                &data,
                &protection
            )
            .unwrap_err()
            .code,
        CreationErrorCode::TooLarge
    );
    assert!(root.join("extra").is_dir());
    assert!(!root.join("extra/unpublished").exists());
    drop(access);
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let resumed = access
        .begin_assistant_task(
            &identity,
            AssistantMode::Edit,
            Some(&task.id),
            &data,
            &protection,
        )
        .unwrap();
    assert_eq!(resumed.files.len(), 64);
    assert!(resumed.files.iter().any(|file| file.path == "extra"));
    assert!(!resumed
        .files
        .iter()
        .any(|file| file.path == "extra/unpublished"));
    access.end_assistant_task(&identity, &task.id);
    access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .unwrap();
    assert!(!root.join("extra").exists());
    assert!(!root.join("grid-0").exists());
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
        .begin_assistant_task(
            &identity,
            AssistantMode::Discussion,
            None,
            &data,
            &protection,
        )
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
fn discussion_grant_refuses_project_and_handoff_writes_and_checks() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    fs::write(root.join("score.js"), "saved artwork").unwrap();
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(
            &identity,
            AssistantMode::Discussion,
            None,
            &data,
            &protection,
        )
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
    assert!(access
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
        .is_err());
    assert!(access
        .write_assistant_file(
            &identity,
            &task.id,
            &write("docs/creator-handoff.md", None, "overwrite"),
            &data,
            &protection
        )
        .is_err());
    assert!(access
        .write_assistant_file(
            &identity,
            &task.id,
            &write("score.js", Some(file_version(b"saved artwork")), "changed"),
            &data,
            &protection,
        )
        .is_err());
    assert!(access
        .remove_assistant_file(
            &identity,
            &task.id,
            "score.js",
            &file_version(b"saved artwork"),
            &data,
            &protection,
        )
        .is_err());
    assert!(access
        .install_assistant_preview_adapter(&identity, &task.id, &data, &protection,)
        .is_err());
    assert_eq!(
        fs::read_to_string(root.join("score.js")).unwrap(),
        "saved artwork"
    );
    assert!(!root.join("docs").exists());
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

#[test]
fn assistant_text_publication_keeps_new_file_umask_and_existing_file_permissions() {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "publication-modes");
    let data = temp.path().join("private");
    let reference = temp.path().join("umask-reference");
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o644)
        .open(&reference)
        .unwrap();
    let expected_mode = fs::metadata(reference).unwrap().permissions().mode() & 0o777;
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    access
        .write_assistant_file(
            &identity,
            &task.id,
            &write("created.js", None, "const pulse = 1;"),
            &data,
            &protection,
        )
        .unwrap();
    let target = root.join("created.js");
    assert_eq!(
        fs::metadata(&target).unwrap().permissions().mode() & 0o777,
        expected_mode
    );
    fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).unwrap();
    let version = match access.read(&identity, "created.js", &protection).unwrap() {
        CreationContent::Text { version, .. } => version,
        other => panic!("unexpected content: {other:?}"),
    };
    access
        .write_assistant_file(
            &identity,
            &task.id,
            &write("created.js", Some(version), "const pulse = 2;"),
            &data,
            &protection,
        )
        .unwrap();
    assert_eq!(fs::read_to_string(&target).unwrap(), "const pulse = 2;");
    assert_eq!(
        fs::metadata(target).unwrap().permissions().mode() & 0o777,
        0o640
    );
    assert!(!fs::read_dir(root).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".pnds-save")));
}

#[test]
fn assistant_new_file_publication_keeps_a_target_created_after_the_initial_read() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "assistant-no-clobber");
    let data = temp.path().join("private");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let target = root.join("created.js");
    let raced_target = target.clone();
    // The first publication persists the pending journal, after the initial
    // target read. A creator file appearing there must survive the later link.
    let result = text_publication::with_before_publish_hook(
        move || fs::write(raced_target, "creator content").unwrap(),
        || {
            access.write_assistant_file(
                &identity,
                &task.id,
                &write("created.js", None, "assistant content"),
                &data,
                &protection,
            )
        },
    );
    assert_eq!(result.unwrap_err().code, CreationErrorCode::TargetExists);
    assert_eq!(fs::read_to_string(target).unwrap(), "creator content");
    assert!(access
        .assistant_tasks(&identity, &data, &protection)
        .unwrap()
        .is_empty());
    assert!(!fs::read_dir(root).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".pnds-save")));
}
