use super::*;
use serde_json::json;
use std::os::unix::fs::{symlink, PermissionsExt};

fn project(parent: &Path, name: &str) -> PathBuf {
    let root = parent.join(name);
    fs::create_dir(&root).unwrap();
    fs::write(root.join("manifest.json"), r#"{"id":"same-id"}"#).unwrap();
    root
}
fn message(id: &str) -> AssistantHistoryMessage {
    serde_json::from_value(json!({"id":id,"role":"assistant","text":"Saved answer","status":"completed","scope":"platform","sources":[{"docId":"reference/manifest.md","sectionId":"audio","title":"Audio","locale":"en"}]})).unwrap()
}

#[test]
fn history_restores_across_store_restart_and_uses_real_source_roots() {
    let temp = tempfile::tempdir().unwrap();
    let app_data = temp.path().join("app");
    let first = project(temp.path(), "first");
    let second = project(temp.path(), "second");
    let alias = temp.path().join("alias");
    symlink(&first, &alias).unwrap();
    let store = AssistantHistoryStore::default();
    let initial = store.load(&app_data, &first).unwrap();
    assert!(initial.messages.is_empty());
    store
        .save(&app_data, &first, &initial.epoch, vec![message("answer")])
        .unwrap();
    let reopened = AssistantHistoryStore::default()
        .load(&app_data, &alias)
        .unwrap();
    assert_eq!(reopened.project_key, initial.project_key);
    assert_eq!(reopened.epoch, initial.epoch);
    assert_eq!(reopened.messages[0].text, "Saved answer");
    assert_eq!(
        reopened.messages[0].app_version.as_deref(),
        Some(env!("CARGO_PKG_VERSION"))
    );
    assert_eq!(reopened.messages[0].sources[0].section_id, "audio");
    let other = store.load(&app_data, &second).unwrap();
    assert_ne!(other.project_key, reopened.project_key);
    assert!(other.messages.is_empty());
    assert_eq!(fs::read_dir(&first).unwrap().count(), 1);
    let path = app_data
        .join("assistant-history")
        .join(format!("{}.json", initial.project_key));
    assert_eq!(
        fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(
        fs::metadata(app_data.join("assistant-history"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
}

#[test]
fn legacy_history_migrates_without_fabricating_usage_and_roundtrips_bounded_statistics() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "usage");
    let app = temp.path().join("app");
    let store = AssistantHistoryStore::default();
    let history = store.load(&app, &root).unwrap();
    store
        .save(&app, &root, &history.epoch, vec![message("reply")])
        .unwrap();
    let path = app
        .join("assistant-history")
        .join(format!("{}.json", history.project_key));
    let mut old: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    old["version"] = json!(1);
    fs::write(&path, old.to_string()).unwrap();
    let loaded = AssistantHistoryStore::default().load(&app, &root).unwrap();
    assert!(loaded.messages[0].usage.is_none());
    let mut records = loaded.messages;
    records[0].usage = Some(serde_json::from_value(json!({"calls":[{"inputTokens":123,"outputTokens":null,"cachedInputTokens":null,"reasoningTokens":null},null],"complete":false})).unwrap());
    store.save(&app, &root, &history.epoch, records).unwrap();
    let reopened = AssistantHistoryStore::default().load(&app, &root).unwrap();
    let usage = reopened.messages[0].usage.as_ref().unwrap();
    assert!(!usage.complete);
    assert_eq!(usage.calls[0].as_ref().unwrap().input_tokens, Some(123));
    assert!(usage.calls[0].as_ref().unwrap().output_tokens.is_none());
    assert!(usage.calls[1].is_none());
}

#[test]
fn reviewed_summary_and_topic_survive_restart_but_invalid_provenance_cannot_overwrite_history() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "context");
    let app = temp.path().join("app");
    let store = AssistantHistoryStore::default();
    let initial = store.load(&app, &root).unwrap();
    let key = r#"["https://example.test/v1","fixture"]"#;
    let summary: AssistantHistoryMessage = serde_json::from_value(json!({"id":"summary","role":"assistant","text":"Reviewed summary","scope":"platform","status":"completed","sources":[],"contextMarker":{"type":"summary","serviceKey":key,"sourceIds":["original"],"sections":{"userDecisions":[{"text":"A decision","sourceIds":["original"]}],"assistantSuggestions":[],"verifiedFacts":[],"unverifiedFacts":[],"openQuestions":[]}}})).unwrap();
    let topic: AssistantHistoryMessage = serde_json::from_value(json!({"id":"topic","role":"assistant","text":"New topic","scope":"platform","status":"completed","sources":[],"contextMarker":{"type":"topic"}})).unwrap();
    let mut original = message("original");
    original.context_service_key = Some(key.into());
    let records = vec![original, summary, topic];
    store
        .save(&app, &root, &initial.epoch, records.clone())
        .unwrap();
    let restored = AssistantHistoryStore::default().load(&app, &root).unwrap();
    assert_eq!(restored.messages.len(), 3);
    assert!(matches!(
        restored.messages[1].context_marker,
        Some(AssistantContextMarker::Summary { .. })
    ));
    assert!(matches!(
        restored.messages[2].context_marker,
        Some(AssistantContextMarker::Topic)
    ));
    let mut corrupt = records.clone();
    corrupt[0].scope = AssistantHistoryScope::Project;
    assert_eq!(
        store.save(&app, &root, &initial.epoch, corrupt),
        Err(AssistantHistoryError::InvalidFormat)
    );
    let mut corrupt = records;
    if let Some(AssistantContextMarker::Summary { source_ids, .. }) = &mut corrupt[1].context_marker
    {
        *source_ids = vec!["future-or-missing".into()];
    }
    assert_eq!(
        store.save(&app, &root, &initial.epoch, corrupt),
        Err(AssistantHistoryError::InvalidFormat)
    );
    assert_eq!(
        store.load(&app, &root).unwrap().messages[0].text,
        "Saved answer"
    );
}

#[test]
fn successful_clear_changes_epoch_and_rejects_every_preclear_save() {
    let temp = tempfile::tempdir().unwrap();
    let app_data = temp.path().join("app");
    let root = project(temp.path(), "score");
    let store = AssistantHistoryStore::default();
    let old = store.load(&app_data, &root).unwrap();
    store
        .save(&app_data, &root, &old.epoch, vec![message("one")])
        .unwrap();
    store
        .save(&app_data, &root, &old.epoch, vec![message("two")])
        .unwrap();
    let cleared = store.clear(&app_data, &root).unwrap();
    assert_ne!(cleared.epoch, old.epoch);
    for _ in 0..2 {
        assert_eq!(
            store.save(&app_data, &root, &old.epoch, vec![message("late")]),
            Err(AssistantHistoryError::StaleHistory)
        );
    }
    let restarted = AssistantHistoryStore::default()
        .load(&app_data, &root)
        .unwrap();
    assert!(restarted.messages.is_empty());
    assert_eq!(restarted.epoch, cleared.epoch);
    store
        .save(&app_data, &root, &cleared.epoch, vec![message("fresh")])
        .unwrap();
    assert_eq!(
        store.load(&app_data, &root).unwrap().messages[0].id,
        "fresh"
    );
}

fn fail_after_staging(path: &Path, bytes: &[u8]) -> Result<(), AssistantHistoryError> {
    let _staged = stage_file(path, bytes)?;
    Err(AssistantHistoryError::Io)
}

#[test]
fn failed_save_and_failed_clear_preserve_old_bytes_epoch_and_remove_staging_files() {
    let temp = tempfile::tempdir().unwrap();
    let app_data = temp.path().join("app");
    let root = project(temp.path(), "score");
    let store = AssistantHistoryStore::default();
    let first = store.load(&app_data, &root).unwrap();
    store
        .save(&app_data, &root, &first.epoch, vec![message("original")])
        .unwrap();
    let path = history_path(&app_data, &first.project_key).unwrap();
    let bytes = fs::read(&path).unwrap();
    let failing = AssistantHistoryStore {
        publish: fail_after_staging,
        ..Default::default()
    };
    assert_eq!(
        failing.save(&app_data, &root, &first.epoch, vec![message("replacement")]),
        Err(AssistantHistoryError::Io)
    );
    assert!(matches!(
        failing.clear(&app_data, &root),
        Err(AssistantHistoryError::Io)
    ));
    assert_eq!(fs::read(&path).unwrap(), bytes);
    let restored = failing.load(&app_data, &root).unwrap();
    assert_eq!(restored.epoch, first.epoch);
    assert_eq!(restored.messages[0].id, "original");
    assert_eq!(
        fs::read_dir(app_data.join("assistant-history"))
            .unwrap()
            .count(),
        1
    );
    store
        .save(&app_data, &root, &first.epoch, vec![message("retry")])
        .unwrap();
}

#[test]
fn corrupt_unknown_and_oversized_files_never_fall_back_to_empty_or_overwrite() {
    let temp = tempfile::tempdir().unwrap();
    let app_data = temp.path().join("app");
    let root = project(temp.path(), "score");
    let store = AssistantHistoryStore::default();
    let first = store.load(&app_data, &root).unwrap();
    let path = history_path(&app_data, &first.project_key).unwrap();
    for (bytes, expected) in [
        (b"not json".to_vec(), AssistantHistoryError::InvalidFormat),
        (
            br#"{"version":9000}"#.to_vec(),
            AssistantHistoryError::UnsupportedVersion,
        ),
        (
            vec![b' '; MAX_HISTORY_BYTES + 1],
            AssistantHistoryError::TooLarge,
        ),
    ] {
        fs::write(&path, &bytes).unwrap();
        assert!(matches!(store.load(&app_data, &root), Err(error) if error == expected));
        assert_eq!(
            store.save(&app_data, &root, &first.epoch, vec![]),
            Err(expected)
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
        let cleared = store.clear(&app_data, &root).unwrap();
        assert!(cleared.messages.is_empty());
        assert_ne!(cleared.epoch, first.epoch);
    }
}

fn snapshot_message(project_key: &str) -> AssistantHistoryMessage {
    serde_json::from_value(json!({
        "id":"snapshots","role":"assistant","text":"Historical suggestion","status":"pending","scope":"project","sources":[],"appVersion":"1.6.4",
        "attachments":[{"id":"attachment","projectKey":project_key,"path":"deleted/source.js","startLine":4,"endLine":8,"source":"draft","version":"saved-version","candidateRevision":3,"text":"actually sent draft bytes"}],
        "proposals":[{"id":"proposal","projectKey":project_key,"path":"deleted/source.js","sourceVersion":"old-version","candidateRevision":7,"text":"old candidate bytes","appliedDiff":{"before":"old disk bytes","after":"applied bytes"},"preview":"temporary","pendingRefresh":true}]
    })).unwrap()
}

#[test]
fn restored_snapshots_keep_sent_content_and_versions_but_never_active_authority() {
    let temp = tempfile::tempdir().unwrap();
    let app_data = temp.path().join("app");
    let root = project(temp.path(), "score");
    let store = AssistantHistoryStore::default();
    let first = store.load(&app_data, &root).unwrap();
    store
        .save(
            &app_data,
            &root,
            &first.epoch,
            vec![snapshot_message(&first.project_key)],
        )
        .unwrap();
    let restored = AssistantHistoryStore::default()
        .load(&app_data, &root)
        .unwrap();
    let record = &restored.messages[0];
    assert!(record.status == AssistantHistoryStatus::Cancelled);
    assert!(record.error == Some(AssistantHistoryRequestError::Cancelled));
    assert_eq!(record.app_version.as_deref(), Some("1.6.4"));
    let attachment = &record.attachments.as_ref().unwrap()[0];
    assert_eq!(attachment.text, "actually sent draft bytes");
    assert_eq!(attachment.version, "saved-version");
    let proposal = &record.proposals.as_ref().unwrap()[0];
    assert!(proposal.preview == AssistantProposalPreview::Historical);
    assert_eq!(proposal.candidate_revision, 7);
    assert_eq!(proposal.source_version, "old-version");
    assert_eq!(
        proposal.applied_diff.as_ref().unwrap().after,
        "applied bytes"
    );
    assert!(!root.join("deleted/source.js").exists());
    let value = serde_json::to_value(record).unwrap();
    for field in [
        "apiKey",
        "baseUrl",
        "authorized",
        "requestId",
        "canApply",
        "canPreview",
    ] {
        assert!(value.get(field).is_none());
    }
}

#[test]
fn snapshots_reject_cross_project_paths_duplicate_ids_and_authorization_fields() {
    let temp = tempfile::tempdir().unwrap();
    let app_data = temp.path().join("app");
    let root = project(temp.path(), "score");
    let store = AssistantHistoryStore::default();
    let first = store.load(&app_data, &root).unwrap();
    let original = snapshot_message(&first.project_key);
    store
        .save(&app_data, &root, &first.epoch, vec![original.clone()])
        .unwrap();
    let path = history_path(&app_data, &first.project_key).unwrap();
    let bytes = fs::read(&path).unwrap();
    for bad_path in [
        "/absolute.js",
        "../escape",
        "a/../escape",
        "a//file",
        "a\\file",
        ".",
        "file\0.js",
    ] {
        let mut invalid = original.clone();
        invalid.attachments.as_mut().unwrap()[0].path = bad_path.into();
        assert_eq!(
            store.save(&app_data, &root, &first.epoch, vec![invalid]),
            Err(AssistantHistoryError::InvalidFormat)
        );
    }
    let mut foreign = original.clone();
    foreign.proposals.as_mut().unwrap()[0].project_key = "another-project".into();
    assert_eq!(
        store.save(&app_data, &root, &first.epoch, vec![foreign]),
        Err(AssistantHistoryError::InvalidFormat)
    );
    let mut mislabeled = original.clone();
    mislabeled.scope = AssistantHistoryScope::Platform;
    assert_eq!(
        store.save(&app_data, &root, &first.epoch, vec![mislabeled]),
        Err(AssistantHistoryError::InvalidFormat)
    );
    assert_eq!(
        store.save(
            &app_data,
            &root,
            &first.epoch,
            vec![original.clone(), original.clone()]
        ),
        Err(AssistantHistoryError::InvalidFormat)
    );
    for field in [
        "apiKey",
        "authorization",
        "modelService",
        "requestId",
        "canApply",
    ] {
        let mut value = serde_json::to_value(&original).unwrap();
        value[field] = json!("forbidden");
        assert!(serde_json::from_value::<AssistantHistoryMessage>(value).is_err());
    }
    let mut value = serde_json::to_value(&original).unwrap();
    value["error"] = json!("provider error body with private data");
    assert!(serde_json::from_value::<AssistantHistoryMessage>(value).is_err());
    assert_eq!(fs::read(path).unwrap(), bytes);
}

#[test]
fn storage_and_context_limits_preserve_previous_history_without_partial_writes() {
    let temp = tempfile::tempdir().unwrap();
    let app_data = temp.path().join("app");
    let root = project(temp.path(), "score");
    let store = AssistantHistoryStore::default();
    let first = store.load(&app_data, &root).unwrap();
    store
        .save(&app_data, &root, &first.epoch, vec![message("original")])
        .unwrap();
    let mut too_long = message("long");
    too_long.text = "x".repeat(64 * 1024 + 1);
    assert_eq!(
        store.save(&app_data, &root, &first.epoch, vec![too_long]),
        Err(AssistantHistoryError::TooLarge)
    );
    let too_many = (0..401)
        .map(|index| message(&format!("message-{index}")))
        .collect();
    assert_eq!(
        store.save(&app_data, &root, &first.epoch, too_many),
        Err(AssistantHistoryError::TooLarge)
    );
    let total: Vec<_> = (0..40)
        .map(|index| {
            let mut message = message(&format!("message-{index}"));
            message.text = "x".repeat(64 * 1024);
            message
        })
        .collect();
    assert_eq!(
        store.save(&app_data, &root, &first.epoch, total),
        Err(AssistantHistoryError::TooLarge)
    );
    assert_eq!(
        store.load(&app_data, &root).unwrap().messages[0].id,
        "original"
    );
}

#[test]
fn moved_and_cloned_folders_do_not_automatically_adopt_old_history() {
    let temp = tempfile::tempdir().unwrap();
    let app_data = temp.path().join("app");
    let root = project(temp.path(), "score");
    let store = AssistantHistoryStore::default();
    let original = store.load(&app_data, &root).unwrap();
    store
        .save(&app_data, &root, &original.epoch, vec![message("original")])
        .unwrap();
    let moved = temp.path().join("moved");
    fs::rename(&root, &moved).unwrap();
    let cloned = project(temp.path(), "clone");
    for path in [&moved, &cloned] {
        let independent = store.load(&app_data, path).unwrap();
        assert_ne!(independent.project_key, original.project_key);
        assert!(independent.messages.is_empty());
    }
}

#[test]
fn history_files_and_directory_cannot_redirect_io_through_symlinks() {
    let temp = tempfile::tempdir().unwrap();
    let app_data = temp.path().join("app");
    let root = project(temp.path(), "score");
    let store = AssistantHistoryStore::default();
    let history = store.load(&app_data, &root).unwrap();
    let external = temp.path().join("external.json");
    fs::write(&external, "untouched").unwrap();
    let path = history_path(&app_data, &history.project_key).unwrap();
    symlink(&external, &path).unwrap();
    assert!(matches!(
        store.load(&app_data, &root),
        Err(AssistantHistoryError::Io)
    ));
    assert!(matches!(
        store.clear(&app_data, &root),
        Err(AssistantHistoryError::Io)
    ));
    assert_eq!(fs::read_to_string(&external).unwrap(), "untouched");
    let other_data = temp.path().join("other-app");
    fs::create_dir(&other_data).unwrap();
    symlink(&root, other_data.join("assistant-history")).unwrap();
    assert!(matches!(
        store.load(&other_data, &root),
        Err(AssistantHistoryError::Io)
    ));
    assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
}

#[test]
fn concurrent_preclear_saves_cannot_repopulate_clear_or_touch_another_project() {
    let temp = tempfile::tempdir().unwrap();
    let app_data = temp.path().join("app");
    let root = project(temp.path(), "score");
    let other = project(temp.path(), "other");
    let store = std::sync::Arc::new(AssistantHistoryStore::default());
    let first = store.load(&app_data, &root).unwrap();
    let another = store.load(&app_data, &other).unwrap();
    store
        .save(
            &app_data,
            &other,
            &another.epoch,
            vec![message("other-stays")],
        )
        .unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(9));
    let mut saves = Vec::new();
    for index in 0..8 {
        let store = store.clone();
        let barrier = barrier.clone();
        let app_data = app_data.clone();
        let root = root.clone();
        let epoch = first.epoch.clone();
        saves.push(std::thread::spawn(move || {
            barrier.wait();
            store.save(
                &app_data,
                &root,
                &epoch,
                vec![message(&format!("old-{index}"))],
            )
        }));
    }
    barrier.wait();
    let cleared = store.clear(&app_data, &root).unwrap();
    for save in saves {
        assert!(matches!(
            save.join().unwrap(),
            Ok(()) | Err(AssistantHistoryError::StaleHistory)
        ));
    }
    let restored = store.load(&app_data, &root).unwrap();
    assert_eq!(restored.epoch, cleared.epoch);
    assert!(restored.messages.is_empty());
    assert_eq!(
        store.load(&app_data, &other).unwrap().messages[0].id,
        "other-stays"
    );
    assert_eq!(fs::read_dir(root).unwrap().count(), 1);
}

#[test]
fn stored_unknown_fields_and_wrong_owner_are_rejected_without_replacement() {
    let temp = tempfile::tempdir().unwrap();
    let app_data = temp.path().join("app");
    let root = project(temp.path(), "score");
    let store = AssistantHistoryStore::default();
    let initial = store.load(&app_data, &root).unwrap();
    store
        .save(&app_data, &root, &initial.epoch, vec![message("saved")])
        .unwrap();
    let path = history_path(&app_data, &initial.project_key).unwrap();
    let original: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    for field in ["apiKey", "projectKey"] {
        let mut value = original.clone();
        value[field] = json!("unexpected-value");
        let bytes = serde_json::to_vec(&value).unwrap();
        fs::write(&path, &bytes).unwrap();
        assert!(matches!(
            store.load(&app_data, &root),
            Err(AssistantHistoryError::InvalidFormat)
        ));
        assert_eq!(
            store.save(&app_data, &root, &initial.epoch, vec![]),
            Err(AssistantHistoryError::InvalidFormat)
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}
