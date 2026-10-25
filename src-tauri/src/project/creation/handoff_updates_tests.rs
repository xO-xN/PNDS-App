use super::*;
use crate::project::handoff::{append_task, plan_task, HandoffDocument, HandoffTask, HANDOFF_PATH};
use std::os::unix::fs::{symlink, PermissionsExt};

fn task() -> HandoffTask {
    HandoffTask {
        id: "701a5180-a2dd-47dc-9319-9312f3790f64".into(),
        intent: "Keep fixed fundamentals".into(),
        files: vec!["server.js".into()],
        acceptance: "Only tiny detuning".into(),
        status: "pending".into(),
    }
}

#[test]
fn handoff_cleanup_reviews_exact_result_and_archives_only_after_confirmation() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "cleanup");
    fs::create_dir(root.join("docs")).unwrap();
    let previous = "# Current tasks\n\nOBSOLETE WRONG NOTE\n\nUNKNOWN KEEP\n";
    fs::write(root.join(HANDOFF_PATH), previous).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let disk = access.read_handoff(&identity, &protection).unwrap();
    let mut edited = disk.clone();
    edited.text = edited.text.replace("OBSOLETE WRONG NOTE\n\n", "");
    let mut stale = edited.clone();
    stale.version = Some("stale".into());
    assert_eq!(
        access
            .preview_handoff_update(&identity, task(), stale, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    let review = access
        .preview_handoff_update(&identity, task(), edited, &protection)
        .unwrap();
    let planned = review.planned_text.clone().unwrap();
    assert!(planned.contains("UNKNOWN KEEP"));
    assert!(!planned.contains("OBSOLETE WRONG NOTE"));
    assert_eq!(
        fs::read_to_string(root.join(HANDOFF_PATH)).unwrap(),
        previous
    );
    assert!(!root.join("docs/handoff-history").exists());
    let data = temp.path().join("private");
    let receipt = access
        .record_handoff_baseline(&data, &identity, &review.token, &protection)
        .unwrap();
    assert!(receipt.task_recorded);
    assert_eq!(receipt.document.text, planned);
    let archive_path = receipt.archive_path.as_ref().unwrap();
    assert_eq!(
        fs::read_to_string(root.join(archive_path)).unwrap(),
        previous
    );
    let id = receipt.baseline_id.as_deref().unwrap();
    let baseline = access
        .load_handoff_baseline(&data, &identity, id, &protection)
        .unwrap();
    assert!(baseline
        .files
        .iter()
        .any(|file| file.path == *archive_path && file.text.as_deref() == Some(previous)));
    assert!(access
        .compare_handoff_baseline(&data, &identity, id, &protection)
        .unwrap()
        .changes
        .is_empty());
}

#[test]
fn handoff_explicit_base_edits_do_not_override_the_selected_task_fields() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "selected-fields");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let first = access
        .preview_handoff(&identity, task(), &protection)
        .unwrap();
    let first = access
        .confirm_handoff(&identity, &first.token, &protection)
        .unwrap();
    let mut edited = first.document.clone();
    edited.text = edited
        .text
        .replace("Only tiny detuning", "contradictory edited base");
    let review = access
        .preview_handoff_update(&identity, task(), edited, &protection)
        .unwrap();
    let planned = review.planned_text.unwrap();
    assert!(planned.contains("Only tiny detuning"));
    assert!(!planned.contains("contradictory edited base"));
    assert_eq!(
        fs::read_to_string(root.join(HANDOFF_PATH)).unwrap(),
        first.document.text
    );
}

#[test]
fn handoff_explicit_cleanup_of_an_existing_revision_keeps_both_origins() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "cleanup-same-revision");
    let data = temp.path().join("private");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let first = access
        .preview_handoff(&identity, task(), &protection)
        .unwrap();
    let first = access
        .record_handoff_baseline(&data, &identity, &first.token, &protection)
        .unwrap();
    let first_id = first.baseline_id.as_deref().unwrap();
    let original = serde_json::to_value(
        access
            .load_handoff_baseline(&data, &identity, first_id, &protection)
            .unwrap(),
    )
    .unwrap();
    fs::write(
        root.join(HANDOFF_PATH),
        format!("{}\nERRONEOUS NOTE\n", first.document.text),
    )
    .unwrap();
    let disk = access.read_handoff(&identity, &protection).unwrap();
    let corrected = HandoffDocument {
        text: first.document.text.clone(),
        version: disk.version.clone(),
    };
    let review = access
        .preview_handoff_update(&identity, task(), corrected, &protection)
        .unwrap();
    let next = access
        .record_handoff_baseline(&data, &identity, &review.token, &protection)
        .unwrap();
    assert!(next.task_recorded);
    assert_ne!(next.baseline_id, first.baseline_id);
    assert_eq!(next.task.id, first.task.id);
    assert_eq!(next.revision, first.revision);
    assert!(!next.document.text.contains("ERRONEOUS NOTE"));
    assert_eq!(
        fs::read_to_string(root.join(next.archive_path.unwrap())).unwrap(),
        disk.text
    );
    let unchanged = serde_json::to_value(
        access
            .load_handoff_baseline(&data, &identity, first_id, &protection)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(unchanged, original);

    let reopened = access
        .preview_handoff(&identity, task(), &protection)
        .unwrap();
    let reopened = access
        .record_handoff_baseline(&data, &identity, &reopened.token, &protection)
        .unwrap();
    assert_eq!(reopened.baseline_id, next.baseline_id);
    assert_eq!(reopened.document.text, next.document.text);

    // Even when the next cleanup produces the same final text, its different
    // erroneous source must be published rather than aliasing the old receipt.
    fs::write(
        root.join(HANDOFF_PATH),
        format!("{}\nANOTHER ERRONEOUS NOTE\n", next.document.text),
    )
    .unwrap();
    let disk = access.read_handoff(&identity, &protection).unwrap();
    let review = access
        .preview_handoff_update(
            &identity,
            task(),
            HandoffDocument {
                version: disk.version,
                text: next.document.text.clone(),
            },
            &protection,
        )
        .unwrap();
    let repaired = access
        .record_handoff_baseline(&data, &identity, &review.token, &protection)
        .unwrap();
    assert!(repaired.task_recorded);
    assert_ne!(repaired.baseline_id, next.baseline_id);
    assert_eq!(repaired.document.text, next.document.text);
    assert_eq!(
        fs::read_to_string(root.join(HANDOFF_PATH)).unwrap(),
        next.document.text
    );
}

#[test]
fn handoff_new_cleanup_after_failed_first_publication_never_reuses_a_different_pending_plan() {
    for existing_document in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let root = tests::project(temp.path(), "pending-plan-cleanup");
        let data = temp.path().join("private");
        fs::create_dir(root.join("docs")).unwrap();
        if existing_document {
            fs::write(root.join(HANDOFF_PATH), "ERRONEOUS EXISTING NOTE\n").unwrap();
        }
        let protection = Protection::default();
        let mut access = CreationAccess::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        let first = access
            .preview_handoff(&identity, task(), &protection)
            .unwrap();
        let original_plan = first.planned_text.clone().unwrap();
        fs::set_permissions(root.join("docs"), fs::Permissions::from_mode(0o555)).unwrap();
        let failed = access
            .record_handoff_baseline(&data, &identity, &first.token, &protection)
            .unwrap();
        fs::set_permissions(root.join("docs"), fs::Permissions::from_mode(0o755)).unwrap();
        assert!(!failed.task_recorded);
        let original_id = failed.baseline_id.as_deref().unwrap();
        let origin = serde_json::to_value(
            access
                .load_handoff_baseline(&data, &identity, original_id, &protection)
                .unwrap(),
        )
        .unwrap();
        let disk = access.read_handoff(&identity, &protection).unwrap();
        let edited = HandoffDocument {
            text: "CREATOR REVIEWED CLEAN BASE\n".into(),
            version: disk.version,
        };
        let next = access
            .preview_handoff_update(&identity, task(), edited, &protection)
            .unwrap();
        let shown_plan = next.planned_text.clone().unwrap();
        assert_ne!(shown_plan, original_plan);
        let recorded = access
            .record_handoff_baseline(&data, &identity, &next.token, &protection)
            .unwrap();
        assert!(recorded.task_recorded);
        assert_ne!(recorded.baseline_id, failed.baseline_id);
        assert_eq!(recorded.document.text, shown_plan);
        assert_eq!(
            fs::read_to_string(root.join(HANDOFF_PATH)).unwrap(),
            shown_plan
        );
        assert!(recorded
            .document
            .text
            .contains("CREATOR REVIEWED CLEAN BASE"));
        assert!(!recorded.document.text.contains("ERRONEOUS EXISTING NOTE"));
        assert_eq!(
            serde_json::to_value(
                access
                    .load_handoff_baseline(&data, &identity, original_id, &protection)
                    .unwrap()
            )
            .unwrap(),
            origin
        );
        assert_eq!(
            access
                .retry_handoff_baseline(&data, &identity, original_id, &protection)
                .unwrap_err()
                .code,
            CreationErrorCode::VersionConflict
        );
        assert_eq!(
            fs::read_to_string(root.join(HANDOFF_PATH)).unwrap(),
            shown_plan
        );
    }
}

#[test]
fn handoff_partial_archive_publication_resumes_exact_plan_but_refuses_unrelated_changes() {
    for unrelated_edit in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let root = tests::project(temp.path(), "archive-recovery");
        let data = temp.path().join("private");
        let protection = Protection::default();
        let mut access = CreationAccess::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        let first = access
            .preview_handoff(&identity, task(), &protection)
            .unwrap();
        let first = access
            .confirm_handoff(&identity, &first.token, &protection)
            .unwrap();
        fs::create_dir(root.join("docs/handoff-history")).unwrap();
        let mut corrected = task();
        corrected.acceptance = "At most 17 cents".into();
        let review = access
            .preview_handoff(&identity, corrected, &protection)
            .unwrap();
        let planned = review.planned_text.clone().unwrap();
        fs::set_permissions(root.join("docs"), fs::Permissions::from_mode(0o555)).unwrap();
        let failed = access
            .record_handoff_baseline(&data, &identity, &review.token, &protection)
            .unwrap();
        fs::set_permissions(root.join("docs"), fs::Permissions::from_mode(0o755)).unwrap();
        assert!(!failed.task_recorded);
        assert!(failed.baseline_error.is_some());
        assert_eq!(
            fs::read_to_string(root.join(failed.archive_path.as_ref().unwrap())).unwrap(),
            first.document.text
        );
        assert_eq!(
            fs::read_to_string(root.join(HANDOFF_PATH)).unwrap(),
            first.document.text
        );
        let id = failed.baseline_id.as_deref().unwrap();
        let captured = access
            .load_handoff_baseline(&data, &identity, id, &protection)
            .unwrap();
        if unrelated_edit {
            fs::write(root.join("server.js"), "unrelated edit").unwrap();
        }
        let mut reopened = CreationAccess::default();
        let next = reopened.open(&root, &protection).unwrap().project.identity;
        let result = if unrelated_edit {
            reopened.retry_handoff_baseline(&data, &next, id, &protection)
        } else {
            let review = reopened
                .preview_handoff(&next, captured.task.clone(), &protection)
                .unwrap();
            reopened.record_handoff_baseline(&data, &next, &review.token, &protection)
        };
        if unrelated_edit {
            assert_eq!(result.unwrap_err().code, CreationErrorCode::VersionConflict);
            assert_eq!(
                fs::read_to_string(root.join(HANDOFF_PATH)).unwrap(),
                first.document.text
            );
        } else {
            let result = result.unwrap();
            assert!(result.task_recorded);
            assert_eq!(result.baseline_id.as_deref(), Some(id));
            assert_eq!(result.document.text, planned);
            let restored = reopened
                .load_handoff_baseline(&data, &next, id, &protection)
                .unwrap();
            assert_eq!(restored.captured_at, captured.captured_at);
            assert_eq!(
                restored
                    .files
                    .iter()
                    .map(|file| (&file.path, &file.sha256))
                    .collect::<Vec<_>>(),
                captured
                    .files
                    .iter()
                    .map(|file| (&file.path, &file.sha256))
                    .collect::<Vec<_>>()
            );
        }
    }
}

#[test]
fn handoff_archive_collisions_and_links_preserve_active_and_external_files() {
    for boundary in ["content", "file-link", "directory-link"] {
        let temp = tempfile::tempdir().unwrap();
        let root = tests::project(temp.path(), "archive-boundaries");
        let protection = Protection::default();
        let mut access = CreationAccess::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        let first = access
            .preview_handoff(&identity, task(), &protection)
            .unwrap();
        let first = access
            .confirm_handoff(&identity, &first.token, &protection)
            .unwrap();
        let history = root.join("docs/handoff-history");
        let path = root.join(handoff::archive_path(&first.document.text));
        let external = temp.path().join("external");
        fs::create_dir(&external).unwrap();
        fs::write(external.join("kept.md"), "external content").unwrap();
        if boundary == "directory-link" {
            symlink(&external, &history).unwrap();
        } else {
            fs::create_dir(&history).unwrap();
            if boundary == "file-link" {
                symlink(external.join("kept.md"), &path).unwrap();
            } else {
                fs::write(&path, "different existing archive").unwrap();
            }
        }
        let mut corrected = task();
        corrected.acceptance = "At most 17 cents".into();
        let error = access
            .preview_handoff(&identity, corrected, &protection)
            .unwrap_err();
        assert_eq!(
            error.code,
            if boundary == "content" {
                CreationErrorCode::VersionConflict
            } else {
                CreationErrorCode::PathEscape
            }
        );
        assert_eq!(
            fs::read_to_string(root.join(HANDOFF_PATH)).unwrap(),
            first.document.text
        );
        assert_eq!(
            fs::read_to_string(external.join("kept.md")).unwrap(),
            "external content"
        );
    }
}

#[test]
fn handoff_unbounded_legacy_task_needs_explicit_edit_and_preserves_unknown_content() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "legacy-active");
    fs::create_dir(root.join("docs")).unwrap();
    let original = append_task("UNKNOWN HEADER\n", &task());
    fs::write(root.join(HANDOFF_PATH), &original).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let mut corrected = task();
    corrected.acceptance = "At most 17 cents".into();
    assert_eq!(
        access
            .preview_handoff(&identity, corrected.clone(), &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    let disk = access.read_handoff(&identity, &protection).unwrap();
    let edited = HandoffDocument {
        text: "UNKNOWN HEADER\n".into(),
        version: disk.version,
    };
    let review = access
        .preview_handoff_update(&identity, corrected, edited, &protection)
        .unwrap();
    let receipt = access
        .confirm_handoff(&identity, &review.token, &protection)
        .unwrap();
    assert!(receipt.document.text.starts_with("UNKNOWN HEADER\n"));
    assert_eq!(receipt.document.text.matches(&task().marker()).count(), 1);
    assert_eq!(
        fs::read_to_string(root.join(receipt.archive_path.unwrap())).unwrap(),
        original
    );
}

#[test]
fn handoff_plan_replaces_bounded_legacy_revisions_and_keeps_full_intent_with_short_heading() {
    let old = task();
    let legacy = format!(
        "{}{}\nUNKNOWN BETWEEN\n{}{}\nUNKNOWN TAIL\n",
        append_task("UNKNOWN HEADER\n", &old),
        old.revision_marker(),
        append_task("", &old),
        old.revision_marker()
    );
    let mut corrected = old.clone();
    corrected.intent = "🎼".repeat(100);
    let (planned, replaced) = plan_task(&legacy, &corrected).unwrap();
    assert!(replaced);
    assert_eq!(planned.matches(&old.marker()).count(), 1);
    for kept in ["UNKNOWN HEADER", "UNKNOWN BETWEEN", "UNKNOWN TAIL"] {
        assert!(planned.contains(kept));
    }
    let title = planned
        .lines()
        .find(|line| line.starts_with("## "))
        .unwrap()
        .strip_prefix("## ")
        .unwrap();
    assert_eq!(title.chars().count(), 80);
    assert!(title.ends_with('…'));
    assert!(planned.contains(&corrected.intent));
    let mut injected = old;
    injected.acceptance = "<!-- pnds-task:701a5180-a2dd-47dc-9319-9312f3790f65 -->".into();
    assert_eq!(
        injected.validate().unwrap_err().code,
        CreationErrorCode::InvalidProject
    );
}
