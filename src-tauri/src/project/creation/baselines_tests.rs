use super::*;
use crate::project::handoff::{HandoffTask, HANDOFF_PATH};

fn task() -> HandoffTask {
    HandoffTask {
        id: "701a5180-a2dd-47dc-9319-9312f3790f64".into(),
        intent: "Wire the saved score".into(),
        files: vec!["server.js".into()],
        acceptance: "Creator verifies output".into(),
        status: "pending".into(),
    }
}

#[test]
fn baseline_records_saved_uncommitted_text_and_hashes_resources_without_copies() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "baseline-score");
    let data = temp.path().join("app-data");
    fs::write(root.join("server.js"), "saved but not committed").unwrap();
    fs::write(root.join("sound.wav"), [0u8, 1, 2, 3]).unwrap();
    fs::write(root.join(".env"), "SECRET=excluded").unwrap();
    fs::create_dir(root.join("node_modules")).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let review = access
        .preview_handoff(&identity, task(), &protection)
        .unwrap();
    let receipt = access
        .record_handoff_baseline(&data, &identity, &review.token, &protection)
        .unwrap();
    assert!(receipt.task_recorded);
    assert!(receipt.baseline_error.is_none());
    let id = receipt.baseline_id.unwrap();
    let baseline = access
        .load_handoff_baseline(&data, &identity, &id, &protection)
        .unwrap();
    assert!(baseline.complete);
    assert_eq!(
        baseline
            .files
            .iter()
            .find(|f| f.path == "server.js")
            .unwrap()
            .text
            .as_deref(),
        Some("saved but not committed")
    );
    let resource = baseline
        .files
        .iter()
        .find(|f| f.path == "sound.wav")
        .unwrap();
    assert!(resource.text.is_none());
    assert_eq!(
        resource.sha256,
        "054edec1d0211f624fed0cbca9d4f9400b0e491c43742af2c5b0abebf0c990d8"
    );
    assert!(baseline
        .excluded
        .iter()
        .any(|f| f.path == ".env" && f.reason == "sensitive"));
    assert!(baseline.excluded.iter().any(|f| f.path == "node_modules"));
    assert_eq!(
        baseline
            .files
            .iter()
            .find(|f| f.path == HANDOFF_PATH)
            .unwrap()
            .text
            .as_deref(),
        Some(receipt.document.text.as_str())
    );
    fs::write(root.join("server.js"), "external work").unwrap();
    let mut reopened = CreationAccess::default();
    let next = reopened.open(&root, &protection).unwrap().project.identity;
    let again = reopened
        .retry_handoff_baseline(&data, &next, &id, &protection)
        .unwrap();
    assert_eq!(again.baseline_id.as_deref(), Some(id.as_str()));
    assert_eq!(
        reopened
            .load_handoff_baseline(&data, &next, &id, &protection)
            .unwrap()
            .files
            .iter()
            .find(|f| f.path == "server.js")
            .unwrap()
            .text
            .as_deref(),
        Some("saved but not committed")
    );
    assert_eq!(
        reopened
            .list_handoff_baselines(&data, &next, &protection)
            .unwrap()
            .baselines
            .len(),
        1
    );
    reopened
        .delete_handoff_baseline(&data, &next, &id, &protection)
        .unwrap();
    assert!(reopened
        .list_handoff_baselines(&data, &next, &protection)
        .unwrap()
        .baselines
        .is_empty());
}

#[test]
fn pending_baseline_survives_task_write_failure_and_retry_keeps_the_original_revision() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "partial-handoff");
    let data = temp.path().join("data");
    fs::create_dir(root.join("docs")).unwrap();
    fs::set_permissions(root.join("docs"), fs::Permissions::from_mode(0o555)).unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let review = access
        .preview_handoff(&identity, task(), &protection)
        .unwrap();
    let failed = access
        .record_handoff_baseline(&data, &identity, &review.token, &protection)
        .unwrap();
    assert!(!failed.task_recorded);
    assert!(failed.baseline_error.is_some());
    let id = failed.baseline_id.unwrap();
    let original = access
        .load_handoff_baseline(&data, &identity, &id, &protection)
        .unwrap();
    assert!(!original.complete);
    fs::set_permissions(root.join("docs"), fs::Permissions::from_mode(0o755)).unwrap();
    let retried = access
        .retry_handoff_baseline(&data, &identity, &id, &protection)
        .unwrap();
    assert!(retried.task_recorded);
    assert!(retried.baseline_error.is_none());
    assert_eq!(retried.revision, original.revision);
    let resumed = access
        .load_handoff_baseline(&data, &identity, &id, &protection)
        .unwrap();
    assert_eq!(resumed.captured_at, original.captured_at);
    assert_eq!(resumed.files[0].sha256, original.files[0].sha256);
}

#[test]
fn task_revisions_keep_separate_baselines_and_corruption_is_never_an_empty_success() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "revisions");
    let data = temp.path().join("data");
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let first = access
        .preview_handoff(&identity, task(), &protection)
        .unwrap();
    let first = access
        .record_handoff_baseline(&data, &identity, &first.token, &protection)
        .unwrap();
    fs::write(root.join("server.js"), "second saved version").unwrap();
    let mut revised = task();
    revised.acceptance = "Also verify a second output".into();
    let second = access
        .preview_handoff(&identity, revised, &protection)
        .unwrap();
    let second = access
        .record_handoff_baseline(&data, &identity, &second.token, &protection)
        .unwrap();
    assert_ne!(first.baseline_id, second.baseline_id);
    assert_eq!(first.task.id, second.task.id);
    assert_eq!(
        access
            .list_handoff_baselines(&data, &identity, &protection)
            .unwrap()
            .baselines
            .len(),
        2
    );
    let folder = fs::read_dir(data.join("handoff-baselines"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let id = first.baseline_id.unwrap();
    fs::write(folder.join(format!("{id}.json")), b"broken").unwrap();
    assert!(access
        .load_handoff_baseline(&data, &identity, &id, &protection)
        .is_err());
    let catalog = access
        .list_handoff_baselines(&data, &identity, &protection)
        .unwrap();
    assert!(catalog
        .baselines
        .iter()
        .find(|item| item.id == id)
        .unwrap()
        .error
        .is_some());
    access
        .delete_handoff_baseline(&data, &identity, &id, &protection)
        .unwrap();
    assert_eq!(
        access
            .list_handoff_baselines(&data, &identity, &protection)
            .unwrap()
            .baselines
            .len(),
        1
    );
}

#[test]
fn comparison_includes_committed_and_manual_changes_and_never_treats_exclusions_as_deletions() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "compare-score");
    let data = temp.path().join("data");
    fs::write(root.join("old.md"), "old notes\n").unwrap();
    fs::write(root.join("sound.wav"), [1u8, 2, 3]).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let review = access
        .preview_handoff(&identity, task(), &protection)
        .unwrap();
    let id = access
        .record_handoff_baseline(&data, &identity, &review.token, &protection)
        .unwrap()
        .baseline_id
        .unwrap();
    let unchanged = access
        .compare_handoff_baseline(&data, &identity, &id, &protection)
        .unwrap();
    assert!(unchanged.changes.is_empty());
    fs::write(root.join("server.js"), "external saved implementation\n").unwrap();
    fs::write(root.join("new.md"), "added text\n").unwrap();
    fs::remove_file(root.join("old.md")).unwrap();
    fs::write(root.join("sound.wav"), [3u8, 4, 5, 6]).unwrap();
    let without_git = access
        .compare_handoff_baseline(&data, &identity, &id, &protection)
        .unwrap();
    assert_eq!(without_git.changes.len(), 4);
    assert_eq!(without_git.changes[0].path, "server.js");
    assert_eq!(
        without_git.changes[0]
            .after
            .as_ref()
            .unwrap()
            .text
            .as_deref(),
        Some("external saved implementation\n")
    );
    assert_eq!(
        without_git
            .changes
            .iter()
            .find(|change| change.path == "old.md")
            .unwrap()
            .kind,
        "deleted"
    );
    let git = |args: &[&str]| {
        assert!(std::process::Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(args)
            .output()
            .unwrap()
            .status
            .success());
    };
    git(&["init", "--quiet"]);
    git(&["add", "."]);
    git(&[
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--quiet",
        "-m",
        "External implementation",
    ]);
    let clean = std::process::Command::new("git")
        .arg("-C")
        .arg(&root)
        .args(["status", "--porcelain"])
        .output()
        .unwrap();
    assert!(clean.stdout.is_empty());
    let committed = access
        .compare_handoff_baseline(&data, &identity, &id, &protection)
        .unwrap();
    assert_eq!(committed.changes.len(), 4);
    assert!(!access
        .handoff_comparison_is_stale(&identity, &committed.current_fingerprint, &protection)
        .unwrap());
    fs::write(root.join("new.md"), "manual creator adjustment\n").unwrap();
    assert!(access
        .handoff_comparison_is_stale(&identity, &committed.current_fingerprint, &protection)
        .unwrap());
    // A file that has become a link is uncovered, not proven deleted.
    fs::remove_file(root.join("server.js")).unwrap();
    std::os::unix::fs::symlink(root.join("new.md"), root.join("server.js")).unwrap();
    let uncovered = access
        .compare_handoff_baseline(&data, &identity, &id, &protection)
        .unwrap();
    assert!(!uncovered
        .changes
        .iter()
        .any(|change| change.path == "server.js"));
    assert!(uncovered
        .current_excluded
        .iter()
        .any(|file| file.path == "server.js" && file.reason == "symlink"));
    access
        .delete_handoff_baseline(&data, &identity, &id, &protection)
        .unwrap();
    assert_eq!(
        access
            .compare_handoff_baseline(&data, &identity, &id, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::Missing
    );
}

#[test]
fn baseline_capacity_and_collection_races_stop_without_publishing_a_task() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "race-score");
    let data = temp.path().join("data");
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let resource = File::create(root.join("large.bin")).unwrap();
    resource.set_len(16 * 1024 * 1024).unwrap();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let review = access
        .preview_handoff(&identity, task(), &protection)
        .unwrap();
    let changed_root = root.clone();
    let writer = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(10));
        fs::write(changed_root.join("server.js"), "changed during collection").unwrap();
    });
    let result = access.record_handoff_baseline(&data, &identity, &review.token, &protection);
    writer.join().unwrap();
    assert_eq!(result.unwrap_err().code, CreationErrorCode::VersionConflict);
    assert!(access
        .read_handoff(&identity, &protection)
        .unwrap()
        .version
        .is_none());
    let directory = fs::read_dir(data.join("handoff-baselines"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let capacity_id = "f".repeat(64);
    File::create(directory.join(format!("{capacity_id}.json")))
        .unwrap()
        .set_len(256 * 1024 * 1024)
        .unwrap();
    let review = access
        .preview_handoff(&identity, task(), &protection)
        .unwrap();
    let result = access.record_handoff_baseline(&data, &identity, &review.token, &protection);
    assert_eq!(result.unwrap_err().code, CreationErrorCode::TooLarge);
    assert!(access
        .read_handoff(&identity, &protection)
        .unwrap()
        .version
        .is_none());
    access
        .delete_handoff_baseline(&data, &identity, &capacity_id, &protection)
        .unwrap();
}

#[test]
fn deleting_a_baseline_does_not_allow_the_same_recorded_revision_to_capture_a_new_origin() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "deleted-origin");
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let review = access
        .preview_handoff(&identity, task(), &protection)
        .unwrap();
    let original = access
        .record_handoff_baseline(&data, &identity, &review.token, &protection)
        .unwrap();
    access
        .delete_handoff_baseline(
            &data,
            &identity,
            original.baseline_id.as_deref().unwrap(),
            &protection,
        )
        .unwrap();
    fs::write(root.join("server.js"), "later external work").unwrap();
    let review = access
        .preview_handoff(&identity, task(), &protection)
        .unwrap();
    assert_eq!(
        access
            .record_handoff_baseline(&data, &identity, &review.token, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::Missing
    );
    assert!(access
        .list_handoff_baselines(&data, &identity, &protection)
        .unwrap()
        .baselines
        .is_empty());
    assert_eq!(
        access.read_handoff(&identity, &protection).unwrap().text,
        original.document.text
    );
}
