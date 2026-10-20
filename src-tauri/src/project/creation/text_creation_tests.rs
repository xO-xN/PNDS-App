use super::tests::project;
use super::*;
use std::os::unix::fs::symlink;

#[test]
fn new_code_files_can_be_created_in_the_root_and_pages_directory_with_existing_drafts() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "manual-create-pages");
    fs::create_dir(root.join("public")).unwrap();
    fs::write(root.join("public/performer.html"), "<!doctype html>").unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    for path in ["sketch.js", "public/Sketch.js", "public/图形.js"] {
        let created = access
            .create_text_file(
                &identity,
                path,
                &["manifest.json".into(), "public/performer.html".into()],
                &protection,
            )
            .unwrap();
        assert_eq!(created.path, path);
        assert!(root.join(path).is_file());
    }
}

#[test]
fn new_files_accept_existing_readable_dot_relative_drafts_and_still_protect_their_targets() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "manual-create-relative-draft");
    fs::create_dir(root.join("public")).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    access.read(&identity, "./server.js", &protection).unwrap();
    let created = access
        .create_text_file(
            &identity,
            "public/sketch.js",
            &["./server.js".into()],
            &protection,
        )
        .unwrap();
    assert_eq!(created.path, "public/sketch.js");
    assert_eq!(
        access
            .create_text_file(
                &identity,
                "public/recovered.js",
                &["./public/recovered.js".into()],
                &protection,
            )
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    assert!(!root.join("public/recovered.js").exists());
    assert_eq!(
        access
            .create_text_file(
                &identity,
                "public/blocked.js",
                &["./../outside.js".into()],
                &protection,
            )
            .unwrap_err()
            .code,
        CreationErrorCode::PathEscape
    );
    assert!(!root.join("public/blocked.js").exists());
}

#[test]
fn missing_relative_parent_prefixes_are_reported_as_missing_without_home_expansion() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "manual-create-parent");
    fs::create_dir(root.join("public")).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    for path in [
        "public/public/sketch.js",
        "manual-create-parent/public/sketch.js",
        "~/public/sketch.js",
    ] {
        assert_eq!(
            access
                .create_text_file(&identity, path, &[], &protection)
                .unwrap_err()
                .code,
            CreationErrorCode::Missing,
            "{path}"
        );
    }
    assert!(!root.join("public/sketch.js").exists());
}

#[test]
fn creates_one_empty_code_file_then_uses_normal_versioned_save_without_clobbering() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "manual-create");
    fs::create_dir(root.join("public")).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let file = access
        .create_text_file(&identity, "public/Grid.js", &[], &protection)
        .unwrap();
    assert_eq!(file.path, "public/Grid.js");
    assert_eq!(file.kind, CreationFileKind::Text);
    assert_eq!(fs::read(root.join(&file.path)).unwrap(), b"");
    let CreationContent::Text { version, .. } =
        access.read(&identity, &file.path, &protection).unwrap()
    else {
        panic!("expected text")
    };
    access
        .save(
            &identity,
            &file.path,
            "class Grid {}",
            &version,
            &protection,
        )
        .unwrap();
    assert_eq!(
        access
            .create_text_file(&identity, &file.path, &[], &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    assert_eq!(
        fs::read_to_string(root.join(&file.path)).unwrap(),
        "class Grid {}"
    );
    assert!(access
        .list(&identity, &protection)
        .unwrap()
        .iter()
        .any(|file| file.path == "public/Grid.js"));
}

#[test]
fn new_text_files_obey_scope_source_path_and_recoverable_draft_guards() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "guarded-create");
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    for path in [
        "../outside/escape.js",
        "/absolute.js",
        ".git/new.js",
        "node_modules/new.js",
        ".pnds-save-hidden.js",
        "bad\\path.js",
        "bad\nname.js",
    ] {
        assert_eq!(
            access
                .create_text_file(&identity, path, &[], &protection)
                .unwrap_err()
                .code,
            CreationErrorCode::PathEscape
        );
    }
    assert_eq!(
        access
            .create_text_file(&identity, "asset.png", &[], &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidProject
    );
    assert_eq!(
        access
            .create_text_file(&identity, "absent/new.js", &[], &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::Missing
    );
    assert_eq!(
        access
            .create_text_file(
                &identity,
                "recovered.js",
                &["recovered.js".into()],
                &protection
            )
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    assert!(!root.join("recovered.js").exists());
    symlink(&outside, root.join("escape")).unwrap();
    assert_eq!(
        access
            .create_text_file(&identity, "escape/new.js", &[], &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::PathEscape
    );
    assert!(!outside.join("new.js").exists());
    let protected_root = project(temp.path(), "protected-create");
    let protected = Protection {
        bundles: vec![protected_root.clone()],
        utilities: vec![],
    };
    let protected_identity = access
        .open(&protected_root, &protected)
        .unwrap()
        .project
        .identity;
    assert_eq!(
        access
            .create_text_file(&protected_identity, "locked.js", &[], &protected)
            .unwrap_err()
            .code,
        CreationErrorCode::Permission
    );
    access
        .open(&project(temp.path(), "other-create"), &protection)
        .unwrap();
    assert_eq!(
        access
            .create_text_file(&identity, "late.js", &[], &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
    assert!(!root.join("late.js").exists());
}

#[test]
fn creation_resolves_internal_aliases_and_refuses_hidden_targets_and_dangling_symlinks() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "aliased-create");
    fs::create_dir(root.join("public")).unwrap();
    fs::create_dir(root.join(".git")).unwrap();
    symlink(root.join("public"), root.join("alias")).unwrap();
    symlink(root.join(".git"), root.join("hidden-alias")).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let created = access
        .create_text_file(&identity, "alias/Grid.js", &[], &protection)
        .unwrap();
    assert_eq!(created.path, "public/Grid.js");
    assert_eq!(
        access
            .create_text_file(
                &identity,
                "alias/recovered.js",
                &["public/recovered.js".into()],
                &protection
            )
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    assert_eq!(
        access
            .create_text_file(&identity, "hidden-alias/new.js", &[], &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::PathEscape
    );
    symlink(
        temp.path().join("missing-target"),
        root.join("public/taken.js"),
    )
    .unwrap();
    assert_eq!(
        access
            .create_text_file(&identity, "public/taken.js", &[], &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    assert!(fs::symlink_metadata(root.join("public/taken.js"))
        .unwrap()
        .is_symlink());
}

#[test]
fn empty_directories_are_created_exclusively_and_survive_reopening_and_polling() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "directory-tree");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    access
        .create_directory(&identity, "public", &["./server.js".into()], &protection)
        .unwrap();
    access
        .create_directory(&identity, "public/sketches", &[], &protection)
        .unwrap();
    let changes = access.poll(&identity, 0, &protection).unwrap();
    assert_eq!(changes.directories.unwrap(), ["public", "public/sketches"]);
    assert_eq!(
        access
            .create_directory(&identity, "public", &[], &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    assert_eq!(
        access
            .create_directory(&identity, "recovered", &["./recovered".into()], &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    let reopened = access.open(&root, &protection).unwrap();
    assert!(reopened
        .directories
        .unwrap()
        .contains(&"public/sketches".into()));
    access
        .create_text_file(
            &reopened.project.identity,
            "public/sketches/Grid.js",
            &[],
            &protection,
        )
        .unwrap();
    assert!(root.join("public/sketches/Grid.js").is_file());
}

#[test]
fn directory_creation_rejects_escapes_protected_paths_and_existing_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "directory-protection");
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    for path in [
        "../escaped",
        "node_modules/new",
        ".git/new",
        "/absolute",
        ".pnds-save-new",
    ] {
        assert_eq!(
            access
                .create_directory(&identity, path, &[], &protection)
                .unwrap_err()
                .code,
            CreationErrorCode::PathEscape
        );
    }
    assert_eq!(
        access
            .create_directory(&identity, "server.js", &[], &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    symlink(&outside, root.join("alias")).unwrap();
    assert_eq!(
        access
            .create_directory(&identity, "alias/new", &[], &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::PathEscape
    );
    assert!(!outside.join("new").exists());
}
