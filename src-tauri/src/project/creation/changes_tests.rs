use super::*;
use crate::project::creation::tests::project;

#[test]
fn guarded_change_keeps_actual_before_after_and_undo_works_without_git() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let CreationContent::Text { text, version } =
        access.read(&identity, "server.js", &protection).unwrap()
    else {
        panic!("text")
    };
    let change = access
        .save_change(
            &identity,
            "server.js",
            "// new score",
            &version,
            &protection,
        )
        .unwrap();
    assert_eq!(change.before_text, text);
    assert_eq!(change.after_text, "// new score");
    assert_eq!(
        std::fs::read_to_string(root.join("server.js")).unwrap(),
        "// new score"
    );
    let undone = access
        .undo_change(&identity, &change.id, &protection)
        .unwrap();
    assert!(matches!(undone, CreationContent::Text { text: restored, .. } if restored == text));
    assert_eq!(
        std::fs::read_to_string(root.join("server.js")).unwrap(),
        text
    );
    assert_eq!(
        access
            .undo_change(&identity, &change.id, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
}

#[test]
fn undo_refuses_a_later_save_even_when_the_saved_bytes_match_again() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let CreationContent::Text { version, .. } =
        access.read(&identity, "server.js", &protection).unwrap()
    else {
        panic!("text")
    };
    let change = access
        .save_change(
            &identity,
            "server.js",
            "// new score",
            &version,
            &protection,
        )
        .unwrap();
    access
        .save(
            &identity,
            "server.js",
            "// new score",
            &change.after_version,
            &protection,
        )
        .unwrap();
    assert_eq!(
        access
            .undo_change(&identity, &change.id, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    assert_eq!(
        std::fs::read_to_string(root.join("server.js")).unwrap(),
        "// new score"
    );
}

#[test]
fn guarded_change_refuses_a_noop_or_repeated_submission_and_protects_external_changes() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let CreationContent::Text { text, version } =
        access.read(&identity, "server.js", &protection).unwrap()
    else {
        panic!("text")
    };
    assert!(access
        .save_change(&identity, "server.js", &text, &version, &protection)
        .is_err());
    let change = access
        .save_change(
            &identity,
            "server.js",
            "// candidate",
            &version,
            &protection,
        )
        .unwrap();
    assert_eq!(
        access
            .save_change(
                &identity,
                "server.js",
                "// candidate",
                &version,
                &protection
            )
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    std::fs::write(root.join("server.js"), "// external work").unwrap();
    assert_eq!(
        access
            .undo_change(&identity, &change.id, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    assert_eq!(
        std::fs::read_to_string(root.join("server.js")).unwrap(),
        "// external work"
    );
}

#[test]
fn rename_roundtrip_invalidates_old_undo_without_overwriting_new_work() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let CreationContent::Text { version, .. } =
        access.read(&identity, "server.js", &protection).unwrap()
    else {
        panic!("text")
    };
    let change = access
        .save_change(
            &identity,
            "server.js",
            "// renamed score",
            &version,
            &protection,
        )
        .unwrap();
    access
        .rename(&identity, "server.js", "renamed.js", &[], &protection)
        .unwrap();
    access
        .rename(&identity, "renamed.js", "server.js", &[], &protection)
        .unwrap();
    assert_eq!(
        access
            .undo_change(&identity, &change.id, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    assert_eq!(
        std::fs::read_to_string(root.join("server.js")).unwrap(),
        "// renamed score"
    );
}

#[test]
fn guarded_change_enforces_existing_text_paths_sources_and_workspace_identity() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let other = project(temp.path(), "other");
    let outside = temp.path().join("outside.js");
    std::fs::write(&outside, "outside work").unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let CreationContent::Text { version, .. } =
        access.read(&identity, "server.js", &protection).unwrap()
    else {
        panic!("text")
    };
    symlink(&outside, root.join("escape.js")).unwrap();
    for path in ["../outside.js", "escape.js", "gone.js"] {
        assert!(access
            .save_change(&identity, path, "replacement", &version, &protection)
            .is_err());
    }
    assert!(!root.join("gone.js").exists());
    assert_eq!(std::fs::read_to_string(&outside).unwrap(), "outside work");
    std::fs::remove_file(root.join("escape.js")).unwrap();
    let change = access
        .save_change(
            &identity,
            "server.js",
            "// saved change",
            &version,
            &protection,
        )
        .unwrap();
    let prepared = access.prepare(&other, &protection).unwrap();
    access.close(&prepared.project.identity);
    // Cancelling a prepared switch retains the current file and undo capability.
    access
        .undo_change(&identity, &change.id, &protection)
        .unwrap();
    let change = access
        .save_change(
            &identity,
            "server.js",
            "// second change",
            &version,
            &protection,
        )
        .unwrap();
    std::fs::remove_file(root.join("server.js")).unwrap();
    assert_eq!(
        access
            .undo_change(&identity, &change.id, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::Missing
    );
    assert!(!root.join("server.js").exists());
    access.open(&other, &protection).unwrap();
    assert_eq!(
        access
            .undo_change(&identity, &change.id, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
    std::fs::write(root.join("server.js"), "// readonly score").unwrap();
    let readonly = Protection {
        bundles: vec![root.clone()],
        utilities: vec![],
    };
    let identity = access.open(&root, &readonly).unwrap().project.identity;
    let CreationContent::Text { version, .. } =
        access.read(&identity, "server.js", &readonly).unwrap()
    else {
        panic!("text")
    };
    assert_eq!(
        access
            .save_change(&identity, "server.js", "replacement", &version, &readonly)
            .unwrap_err()
            .code,
        CreationErrorCode::Permission
    );
    assert_eq!(
        std::fs::read_to_string(root.join("server.js")).unwrap(),
        "// readonly score"
    );
}
