use super::*;
use serde_json::json;
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::PathBuf;

fn history_path(root: &Path) -> PathBuf {
    root.join(crate::creation_data::DIRECTORY)
        .join(HISTORY_NAME)
}

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
fn a_skill_only_user_message_preserves_its_display_choice_without_creating_authority() {
    let mut encoded = serde_json::to_value(message("inventory-request")).unwrap();
    encoded["role"] = json!("user");
    encoded["scope"] = json!("project");
    encoded["text"] = json!("");
    encoded["sources"] = json!([]);
    encoded["skill"] = json!("check-unused-files");
    let record = serde_json::from_value(encoded.clone()).unwrap();
    assert!(schema::validate_messages(&[record], "project").is_ok());
    let unknown = {
        let mut value = encoded.clone();
        value["skill"] = json!("invented-skill");
        value
    };
    assert!(serde_json::from_value::<AssistantHistoryMessage>(unknown).is_err());
    encoded["role"] = json!("assistant");
    let invalid = serde_json::from_value(encoded).unwrap();
    assert!(schema::validate_messages(&[invalid], "project").is_err());
}

#[test]
fn completed_work_evidence_roundtrips_as_bounded_display_facts_without_authority() {
    let mut reply = message("checked-work");
    reply.scope = AssistantHistoryScope::Project;
    reply.check_outcome = Some(
        serde_json::from_value(json!({
            "schemaVersion": 1,
            "taskId": "701a5180-a2dd-47dc-9319-9312f3790f64",
            "savedPaths": ["supercollider/source/pad.scd"],
            "staticCheck": {"status":"passed", "inputVersion":"saved-input"},
            "build": {"status":"failed", "reason":"Compiler reported an error."},
            "runtime": {"status":"observed", "reason":"Old instance only."},
        "behavior": {"status":"notRun"},
        "projectTests": {"status":"passed", "inputVersion":"test-input"}
        }))
        .unwrap(),
    );
    assert!(schema::validate_messages(&[reply.clone()], "project").is_ok());
    let encoded = serde_json::to_value(&reply).unwrap();
    let restored: AssistantHistoryMessage = serde_json::from_value(encoded.clone()).unwrap();
    assert_eq!(
        serde_json::to_value(restored.check_outcome).unwrap(),
        encoded["checkOutcome"]
    );
    let mut legacy = encoded.clone();
    legacy.as_object_mut().unwrap().remove("checkOutcome");
    assert!(serde_json::from_value::<AssistantHistoryMessage>(legacy)
        .unwrap()
        .check_outcome
        .is_none());
    for (field, value) in [
        ("role", json!("user")),
        ("status", json!("pending")),
        ("scope", json!("platform")),
        ("contextMarker", json!({"type":"topic"})),
    ] {
        let mut invalid = encoded.clone();
        invalid[field] = value;
        assert!(
            schema::validate_messages(&[serde_json::from_value(invalid).unwrap()], "project")
                .is_err()
        );
    }
    for (field, value) in [
        ("schemaVersion", json!(2)),
        ("taskId", json!("../not-a-task")),
        ("taskId", json!("")),
        ("taskId", json!("x".repeat(101))),
        ("taskId", json!("task/id")),
        ("taskId", json!("task\\id")),
        ("taskId", json!("task\0id")),
        ("taskId", json!("任务-id")),
        ("taskId", json!("task_id")),
        ("savedPaths", json!(["../outside.scd"])),
        ("savedPaths", json!(["score.js", "score.js"])),
        ("savedPaths", json!(vec!["score.js"; 257])),
        (
            "build",
            json!({"status":"failed", "reason":"x".repeat(4097)}),
        ),
        (
            "projectTests",
            json!({"status":"passed", "inputVersion":"x".repeat(4097)}),
        ),
    ] {
        let mut invalid = encoded.clone();
        invalid["checkOutcome"][field] = value;
        assert!(
            schema::validate_messages(&[serde_json::from_value(invalid).unwrap()], "project")
                .is_err()
        );
    }
    let mut forged = encoded;
    let mut chinese_reason = forged.clone();
    chinese_reason["checkOutcome"]["build"] = json!({
        "status":"failed", "reason":"编".repeat(2048)
    });
    assert_eq!(
        schema::validate_messages(
            &[serde_json::from_value(chinese_reason).unwrap()],
            "project"
        ),
        Err(AssistantHistoryError::TooLarge),
        "2048 UTF-16 units can exceed the 4096 UTF-8 byte evidence field bound"
    );
    forged["checkOutcome"]["grant"] = json!("cannot-restore");
    assert!(serde_json::from_value::<AssistantHistoryMessage>(forged).is_err());
}

#[test]
fn completed_work_history_accepts_the_actual_native_assistant_task_identity() {
    use crate::project::creation::{AssistantMode, AssistantWrite, CreationAccess, Protection};
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "native-work-history");
    fs::write(root.join("manifest.json"), r#"{
        "schemaVersion": 1, "id": "history-fixture", "name": "History fixture", "version": "0.1.0",
        "scoreServer": {"entry":"server.js", "workingDirectory":".", "performerPort":6868, "monitorPort":6869},
        "audio": {"defaultMode":"none", "supportedModes":["none"]}
    }"#).unwrap();
    fs::write(
        root.join("server.js"),
        "// Temporary history regression fixture\n",
    )
    .unwrap();
    let data = temp.path().join("app");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let started = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let task = access
        .write_assistant_file(
            &identity,
            &started.id,
            &AssistantWrite {
                path: "notes.md".into(),
                version: None,
                text: Some("Completed fixture change.\n".into()),
                edits: None,
            },
            &data,
            &protection,
        )
        .unwrap();
    let mut reply = message("native-work-reply");
    reply.scope = AssistantHistoryScope::Project;
    reply.check_outcome = Some(serde_json::from_value(json!({
        "schemaVersion":1,
        "taskId":task.id,
        "savedPaths":task.files.iter().filter(|file| !file.undone && file.directory != Some(true)).map(|file| &file.path).collect::<Vec<_>>(),
        "staticCheck":{"status":"passed"},
        "build":{"status":"notRequired"},
        "runtime":{"status":"notRequired"},
        "behavior":{"status":"notRequired"}
    })).unwrap());
    let mut without_evidence = reply.clone();
    without_evidence.check_outcome = None;
    assert_eq!(
        schema::validate_messages(&[without_evidence], "project"),
        Ok(())
    );
    assert_eq!(
        schema::validate_messages(&[reply.clone()], "project"),
        Ok(()),
        "The history boundary must accept the ID generated by begin_assistant_task: {}",
        started.id
    );
    let store = AssistantHistoryStore::default();
    let initial = store.load(&data, &root).unwrap();
    store
        .save(&data, &root, &initial.epoch, vec![reply])
        .unwrap();
    let restored = AssistantHistoryStore::default().load(&data, &root).unwrap();
    assert_eq!(
        restored.messages[0].check_outcome.as_ref().unwrap().task_id,
        started.id
    );
}

#[test]
fn discussion_plan_history_keeps_the_complete_public_result_without_restoring_an_offer() {
    let mut reply = message("discussion-plan");
    reply.scope = AssistantHistoryScope::Project;
    reply.text = "Hold sustains; lift begins the full release tail.".into();
    reply.discussion_plan = Some(
        serde_json::from_value(json!({
            "reason":"Choices resolved", "intent":"Sustain while held", "knownProblems":"",
            "files":["public/controller.js"], "acceptance":"One release after lift.",
            "plan":reply.text
        }))
        .unwrap(),
    );
    assert!(schema::validate_messages(&[reply.clone()], "project").is_ok());
    let encoded = serde_json::to_value(reply).unwrap();
    let mut forged = encoded.clone();
    forged["discussionPlan"]["canStart"] = json!(true);
    assert!(serde_json::from_value::<AssistantHistoryMessage>(forged).is_err());
    for (field, value) in [
        ("plan", json!("")),
        ("plan", json!("x".repeat(32769))),
        ("files", json!([])),
        ("files", json!(["../outside.js"])),
        ("files", json!(["line\nbreak.js"])),
        ("intent", json!(" ")),
    ] {
        let mut invalid = encoded.clone();
        invalid["discussionPlan"][field] = value;
        assert!(
            schema::validate_messages(&[serde_json::from_value(invalid).unwrap()], "project")
                .is_err()
        );
    }
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "discussion-plan");
    let data = temp.path().join("app");
    let store = AssistantHistoryStore::default();
    let initial = store.load(&data, &root).unwrap();
    store
        .save(
            &data,
            &root,
            &initial.epoch,
            vec![serde_json::from_value(encoded.clone()).unwrap()],
        )
        .unwrap();
    let restored = AssistantHistoryStore::default().load(&data, &root).unwrap();
    assert_eq!(
        serde_json::to_value(&restored.messages[0]).unwrap()["discussionPlan"],
        encoded["discussionPlan"]
    );
}

#[test]
fn recorded_handoff_snapshots_restore_as_display_only_and_legacy_history_omits_them() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "recorded-handoff");
    let data = temp.path().join("app");
    let store = AssistantHistoryStore::default();
    let initial = store.load(&data, &root).unwrap();
    let mut reply = message("handoff-reply");
    reply.scope = AssistantHistoryScope::Project;
    reply.handoff = Some(AssistantHandoffSnapshot {
        task_id: "701a5180-a2dd-47dc-9319-9312f3790f64".into(),
        revision: "a".repeat(64),
        prompt: "Implement only the recorded task, then archive its report.".into(),
    });
    store
        .save(&data, &root, &initial.epoch, vec![reply])
        .unwrap();
    let restored = AssistantHistoryStore::default().load(&data, &root).unwrap();
    let encoded = serde_json::to_value(&restored.messages[0]).unwrap();
    assert_eq!(
        encoded["handoff"],
        json!({
            "taskId":"701a5180-a2dd-47dc-9319-9312f3790f64",
            "revision":"a".repeat(64),
            "prompt":"Implement only the recorded task, then archive its report."
        })
    );
    assert!(restored.messages[0].questions.is_empty());
    assert!(encoded.get("grant").is_none());
    assert!(encoded.get("canExecute").is_none());
    let path = history_path(&root);
    let mut old: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    old["messages"][0]
        .as_object_mut()
        .unwrap()
        .remove("handoff");
    fs::write(&path, serde_json::to_vec(&old).unwrap()).unwrap();
    assert!(AssistantHistoryStore::default()
        .load(&data, &root)
        .unwrap()
        .messages[0]
        .handoff
        .is_none());
}

#[test]
fn handoff_snapshot_history_rejects_wrong_scope_status_identity_and_unbounded_prompt() {
    let base = json!({
        "id":"handoff-reply", "role":"assistant", "text":"Recorded", "status":"completed",
        "scope":"project", "sources":[],
        "handoff":{"taskId":"701a5180-a2dd-47dc-9319-9312f3790f64", "revision":"a".repeat(64), "prompt":"Copy this task prompt."}
    });
    for (field, value) in [
        ("role", json!("user")),
        ("scope", json!("platform")),
        ("status", json!("pending")),
        ("status", json!("failed")),
        ("contextMarker", json!({"type":"topic"})),
    ] {
        let mut data = base.clone();
        data[field] = value;
        let record: AssistantHistoryMessage = serde_json::from_value(data).unwrap();
        assert_eq!(
            schema::validate_messages(&[record], "project"),
            Err(AssistantHistoryError::InvalidFormat)
        );
    }
    for (field, value, expected) in [
        (
            "taskId",
            json!("not-a-native-task"),
            AssistantHistoryError::InvalidFormat,
        ),
        (
            "revision",
            json!("g".repeat(64)),
            AssistantHistoryError::InvalidFormat,
        ),
        (
            "revision",
            json!("a".repeat(63)),
            AssistantHistoryError::InvalidFormat,
        ),
        ("prompt", json!(""), AssistantHistoryError::InvalidFormat),
        (
            "prompt",
            json!("x".repeat(16 * 1024 + 1)),
            AssistantHistoryError::TooLarge,
        ),
    ] {
        let mut data = base.clone();
        data["handoff"][field] = value;
        let record: AssistantHistoryMessage = serde_json::from_value(data).unwrap();
        assert_eq!(
            schema::validate_messages(&[record], "project"),
            Err(expected)
        );
    }
    let mut forged = base;
    forged["handoff"]["grant"] = json!("not-authority");
    assert!(serde_json::from_value::<AssistantHistoryMessage>(forged).is_err());
}

#[test]
fn private_material_sources_roundtrip_as_exact_snapshots_and_reject_invalid_scope_or_ranges() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "material-source");
    let data = temp.path().join("app");
    let store = AssistantHistoryStore::default();
    let initial = store.load(&data, &root).unwrap();
    let source = json!({"docId":"a".repeat(32),"sectionId":"L2","title":"Pattern.js:2–2","locale":"en","version":"b".repeat(64),"offset":64,"endOffset":68,"totalCharacters":68,"format":"plainText","material":{"material":{"id":"a".repeat(32),"name":"Pattern.js","version":"b".repeat(64),"size":68,"totalCharacters":68},"text":"page","offset":64,"endOffset":68,"totalCharacters":68,"nextOffset":null,"startLine":2,"endLine":2}});
    let mut reply = message("material-reply");
    reply.scope = AssistantHistoryScope::Project;
    reply.sources = vec![serde_json::from_value(source.clone()).unwrap()];
    store
        .save(&data, &root, &initial.epoch, vec![reply.clone()])
        .unwrap();
    let loaded = AssistantHistoryStore::default().load(&data, &root).unwrap();
    assert_eq!(
        loaded.messages[0].sources[0]
            .material
            .as_ref()
            .unwrap()
            .text,
        "page"
    );
    reply.scope = AssistantHistoryScope::Platform;
    assert_eq!(
        store.save(&data, &root, &initial.epoch, vec![reply.clone()]),
        Err(AssistantHistoryError::InvalidFormat)
    );
    reply.scope = AssistantHistoryScope::Project;
    for (field, value) in [
        ("endOffset", json!(69)),
        ("text", json!("different")),
        ("nextOffset", json!(2)),
    ] {
        let mut malformed = source.clone();
        malformed["material"][field] = value;
        reply.sources = vec![serde_json::from_value(malformed).unwrap()];
        assert_eq!(
            store.save(&data, &root, &initial.epoch, vec![reply.clone()]),
            Err(AssistantHistoryError::InvalidFormat)
        );
    }
}

#[test]
fn activity_is_bounded_display_history_and_legacy_snapshots_still_load() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "activity");
    let data = temp.path().join("app");
    let store = AssistantHistoryStore::default();
    let initial = store.load(&data, &root).unwrap();
    let mut reply = message("reply");
    reply.activity = Some(vec!["Checked the saved parameter source.".into()]);
    store
        .save(&data, &root, &initial.epoch, vec![reply.clone()])
        .unwrap();
    let loaded = store.load(&data, &root).unwrap();
    assert_eq!(
        loaded.messages[0].activity.as_ref().unwrap(),
        &vec!["Checked the saved parameter source."]
    );
    assert_eq!(loaded.messages[0].text, "Saved answer");
    let path = history_path(&root);
    let mut legacy: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(legacy["version"], HISTORY_VERSION);
    legacy["version"] = json!(3);
    legacy["messages"][0]
        .as_object_mut()
        .unwrap()
        .remove("activity");
    fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
    assert!(store.load(&data, &root).unwrap().messages[0]
        .activity
        .is_none());
    reply.activity = Some(vec!["x".repeat(65537)]);
    assert!(matches!(
        store.save(&data, &root, &initial.epoch, vec![reply]),
        Err(AssistantHistoryError::TooLarge)
    ));
}

#[test]
fn reasoning_is_private_assistant_data_and_legacy_history_remains_readable() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "deepseek");
    let data = temp.path().join("app");
    let store = AssistantHistoryStore::default();
    let initial = store.load(&data, &root).unwrap();
    let mut reply = message("reply");
    reply.reasoning_content = Some("private protocol reasoning".into());
    store
        .save(&data, &root, &initial.epoch, vec![reply.clone()])
        .unwrap();
    let reopened = AssistantHistoryStore::default().load(&data, &root).unwrap();
    assert_eq!(
        reopened.messages[0].reasoning_content.as_deref(),
        Some("private protocol reasoning")
    );
    assert_eq!(reopened.messages[0].text, "Saved answer");
    assert!(reopened.messages[0].activity.is_none());
    let path = history_path(&root);
    let mut legacy: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    legacy["version"] = json!(4);
    legacy["messages"][0]
        .as_object_mut()
        .unwrap()
        .remove("reasoningContent");
    fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
    assert!(store.load(&data, &root).unwrap().messages[0]
        .reasoning_content
        .is_none());
    reply.role = AssistantHistoryRole::User;
    assert_eq!(
        store.save(&data, &root, &initial.epoch, vec![reply.clone()]),
        Err(AssistantHistoryError::InvalidFormat)
    );
    reply.role = AssistantHistoryRole::Assistant;
    reply.reasoning_content = Some("x".repeat(crate::model::MAX_REASONING_BYTES + 1));
    assert_eq!(
        store.save(&data, &root, &initial.epoch, vec![reply]),
        Err(AssistantHistoryError::TooLarge)
    );
}

#[test]
fn large_read_pages_candidates_and_new_interruption_errors_survive_history_round_trips() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "large-score");
    let app_data = temp.path().join("app");
    let store = AssistantHistoryStore::default();
    let initial = store.load(&app_data, &root).unwrap();
    let text = "// saved sketch\n".repeat(5000);
    let records = ["protocol", "outputTruncated", "responseInterrupted", "responseTooLarge"].into_iter().enumerate().map(|(index, error)| {
        serde_json::from_value(json!({
            "id":format!("large-{index}"), "role":"assistant", "text":"partial", "status":"failed", "scope":"project", "error":error,
            "sources":[{"docId":"monitor.js", "sectionId":"L1", "title":"Sketch", "locale":"en", "project":{
                "path":"monitor.js", "version":"v1", "text":text, "offset":0, "endOffset":text.len(), "totalCharacters":text.len(), "nextOffset":null, "startLine":1, "endLine":5001
            }}],
            "proposals":[{"id":format!("candidate-{index}"), "projectKey":initial.project_key, "path":"monitor.js", "sourceVersion":"v1", "candidateRevision":1, "text":text, "preview":"none", "pendingRefresh":false}],
            "usage":{"calls":vec![serde_json::Value::Null;40],"complete":false,"documentMetrics":{"returnedCharacters":80000,"reusedCharacters":524288,"resultCharacters":100000}}
        })).unwrap()
    }).collect();
    store
        .save(&app_data, &root, &initial.epoch, records)
        .unwrap();
    let reopened = AssistantHistoryStore::default()
        .load(&app_data, &root)
        .unwrap();
    assert_eq!(reopened.messages.len(), 4);
    assert_eq!(
        reopened.messages[0].sources[0]
            .project
            .as_ref()
            .unwrap()
            .text,
        text
    );
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
    assert_eq!(fs::read_dir(&first).unwrap().count(), 2);
    let path = history_path(&first);
    assert_eq!(
        fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(
        fs::metadata(first.join(crate::creation_data::DIRECTORY))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
}

#[test]
fn selected_draft_and_pending_suggestion_snapshots_restore_exact_sources_without_reading_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "source");
    let app = temp.path().join("app");
    let store = AssistantHistoryStore::default();
    let original = store.load(&app, &root).unwrap();
    let sent:AssistantHistoryMessage=serde_json::from_value(json!({"id":"selected","role":"user","text":"Discuss these selected snapshots","status":"completed","scope":"project","sources":[{"docId":"score.js","sectionId":"L2","title":"score.js:2","locale":"en","version":"draft-v1","offset":0,"endOffset":5,"totalCharacters":5,"project":{"path":"score.js","version":"draft-v1","text":"draft","source":"draft","offset":0,"endOffset":5,"totalCharacters":5,"nextOffset":null,"startLine":2,"endLine":2}}],"attachments":[{"id":"selection","projectKey":original.project_key,"path":"score.js","startLine":2,"endLine":2,"source":"proposal","version":"candidate-v7","sourceVersion":"saved-v1","proposalId":"suggestion-id","candidateRevision":7,"text":"selected candidate only"}]})).unwrap();
    store
        .save(&app, &root, &original.epoch, vec![sent])
        .unwrap();
    let restored = AssistantHistoryStore::default().load(&app, &root).unwrap();
    let encoded = serde_json::to_value(&restored.messages[0]).unwrap();
    assert_eq!(encoded["attachments"][0]["proposalId"], "suggestion-id");
    assert_eq!(encoded["attachments"][0]["candidateRevision"], 7);
    assert_eq!(encoded["attachments"][0]["sourceVersion"], "saved-v1");
    assert_eq!(encoded["sources"][0]["project"]["text"], "draft");
    assert!(!root.join("score.js").exists());
    assert!(encoded.get("authorization").is_none());
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
    let path = history_path(&root);
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
fn cumulative_usage_survives_multiple_stages_without_unbounded_per_call_records() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "staged-usage");
    let app = temp.path().join("app");
    let store = AssistantHistoryStore::default();
    let initial = store.load(&app, &root).unwrap();
    let mut record = message("long-task");
    record.usage = Some(serde_json::from_value(json!({
        "calls":vec![json!({"inputTokens":100,"outputTokens":10,"cachedInputTokens":null,"reasoningTokens":null});128],
        "previousCalls":{"count":272,"unknown":0,"usage":{"inputTokens":272_000_000_000u64,"outputTokens":5440,"cachedInputTokens":null,"reasoningTokens":null}},
        "complete":true,
        "documentMetrics":{"returnedCharacters":32_000_000,"reusedCharacters":40_000_000,"resultCharacters":64_000_000}
    })).unwrap());
    store
        .save(&app, &root, &initial.epoch, vec![record.clone()])
        .unwrap();
    let loaded = AssistantHistoryStore::default().load(&app, &root).unwrap();
    let usage = loaded.messages[0].usage.as_ref().unwrap();
    assert_eq!(usage.calls.len(), 128);
    let previous = usage.previous_calls.as_ref().unwrap();
    assert_eq!(previous.count, 272);
    assert_eq!(previous.usage.input_tokens, Some(272_000_000_000));
    assert!(previous.usage.cached_input_tokens.is_none());

    for invalid in [
        json!({"count":1,"unknown":2,"usage":{"inputTokens":null,"outputTokens":null,"cachedInputTokens":null,"reasoningTokens":null}}),
        json!({"count":1,"unknown":0,"usage":{"inputTokens":null,"outputTokens":10,"cachedInputTokens":null,"reasoningTokens":null}}),
        json!({"count":1,"unknown":0,"usage":{"inputTokens":9_007_199_254_740_992u64,"outputTokens":10,"cachedInputTokens":null,"reasoningTokens":null}}),
        json!({"count":1,"unknown":1,"usage":{"inputTokens":100,"outputTokens":null,"cachedInputTokens":null,"reasoningTokens":null}}),
    ] {
        record.usage.as_mut().unwrap().previous_calls =
            Some(serde_json::from_value(invalid).unwrap());
        assert_eq!(
            store.save(&app, &root, &initial.epoch, vec![record.clone()]),
            Err(AssistantHistoryError::InvalidFormat)
        );
    }
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

fn fail_after_staging(directory: &File, bytes: &[u8]) -> Result<(), AssistantHistoryError> {
    let _staged = stage_file(directory, bytes)?;
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
    let path = history_path(&root);
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
        fs::read_dir(root.join(crate::creation_data::DIRECTORY))
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
    let path = history_path(&root);
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
    let path = history_path(&root);
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
    let total: Vec<_> = (0..=MAX_HISTORY_BYTES / (64 * 1024))
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
fn moved_and_copied_folders_carry_history_and_subsequent_changes_are_independent() {
    let temp = tempfile::tempdir().unwrap();
    let app_data = temp.path().join("app");
    let root = project(temp.path(), "score");
    let store = AssistantHistoryStore::default();
    let original = store.load(&app_data, &root).unwrap();
    store
        .save(
            &app_data,
            &root,
            &original.epoch,
            vec![snapshot_message(&original.project_key)],
        )
        .unwrap();
    let moved = temp.path().join("moved");
    fs::rename(&root, &moved).unwrap();
    let copied = project(temp.path(), "copy");
    fs::create_dir(copied.join(crate::creation_data::DIRECTORY)).unwrap();
    fs::set_permissions(
        copied.join(crate::creation_data::DIRECTORY),
        fs::Permissions::from_mode(0o700),
    )
    .unwrap();
    fs::copy(history_path(&moved), history_path(&copied)).unwrap();
    // Different App data simulates a second machine without the original cache.
    let other_data = temp.path().join("other-app");
    let moved_history = store.load(&other_data, &moved).unwrap();
    let copied_history = AssistantHistoryStore::default()
        .load(&other_data, &copied)
        .unwrap();
    for history in [&moved_history, &copied_history] {
        assert_eq!(
            history.messages[0].text,
            snapshot_message(&original.project_key).text
        );
        assert_ne!(history.project_key, original.project_key);
        assert_ne!(history.epoch, original.epoch);
        assert_eq!(
            history.messages[0].attachments.as_ref().unwrap()[0].project_key,
            history.project_key
        );
        assert_eq!(
            history.messages[0].proposals.as_ref().unwrap()[0].project_key,
            history.project_key
        );
        assert!(matches!(
            history.messages[0].proposals.as_ref().unwrap()[0].preview,
            AssistantProposalPreview::Historical
        ));
    }
    assert_ne!(moved_history.project_key, copied_history.project_key);
    assert_ne!(moved_history.epoch, copied_history.epoch);
    assert_eq!(
        store.save(&other_data, &copied, &original.epoch, vec![]),
        Err(AssistantHistoryError::StaleHistory)
    );
    store.clear(&other_data, &copied).unwrap();
    assert_eq!(store.load(&other_data, &moved).unwrap().messages.len(), 1);
    store
        .save(
            &other_data,
            &moved,
            &moved_history.epoch,
            vec![message("new")],
        )
        .unwrap();
    assert!(store
        .load(&other_data, &copied)
        .unwrap()
        .messages
        .is_empty());
}

#[test]
fn history_files_and_directory_cannot_redirect_io_through_symlinks() {
    let temp = tempfile::tempdir().unwrap();
    let app_data = temp.path().join("app");
    let root = project(temp.path(), "score");
    let store = AssistantHistoryStore::default();
    store.load(&app_data, &root).unwrap();
    let external = temp.path().join("external.json");
    fs::write(&external, "untouched").unwrap();
    let path = history_path(&root);
    fs::remove_file(&path).unwrap();
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
    let other = project(temp.path(), "other");
    symlink(&root, other.join(crate::creation_data::DIRECTORY)).unwrap();
    assert!(matches!(
        store.load(&app_data, &other),
        Err(AssistantHistoryError::Io)
    ));
    assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
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
    assert_eq!(fs::read_dir(root).unwrap().count(), 2);
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
    let path = history_path(&root);
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

#[test]
fn question_history_preserves_pending_and_answered_facts_and_rejects_invalid_display_records() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "questions");
    let data = temp.path().join("data");
    let store = AssistantHistoryStore::default();
    let initial = store.load(&data, &root).unwrap();
    let question = json!({
        "id":"task-question-1", "taskId":"task", "scope":{"chatId":"chat", "messageId":"original-reply"},
        "prompt":"Which pulse should the performers share?", "options":[{"id":"shared", "label":"Shared pulse", "description":"Gestures affect everyone"}],
        "recommendedOptionId":"shared", "status":"pending", "answer":null
    });
    let mut reply = message("copied-reply");
    reply.scope = AssistantHistoryScope::Project;
    reply.questions = vec![serde_json::from_value(question.clone()).unwrap()];
    store
        .save(&data, &root, &initial.epoch, vec![reply.clone()])
        .unwrap();
    let reopened = AssistantHistoryStore::default().load(&data, &root).unwrap();
    assert_eq!(
        reopened.messages[0].questions[0].status,
        crate::project::creation::AssistantQuestionStatus::Pending
    );
    assert_eq!(
        reopened.messages[0].questions[0].scope.message_id,
        "original-reply"
    );
    let mut answered = question.clone();
    answered["status"] = json!("answered");
    answered["answer"] = json!({"optionId":null,"text":"Each performer keeps a local pulse"});
    reply.questions[0] = serde_json::from_value(answered).unwrap();
    store
        .save(&data, &root, &initial.epoch, vec![reply.clone()])
        .unwrap();
    assert_eq!(
        store.load(&data, &root).unwrap().messages[0].questions[0]
            .answer
            .as_ref()
            .unwrap()
            .text
            .as_deref(),
        Some("Each performer keeps a local pulse")
    );
    let mut invalid = reply.clone();
    invalid.questions.push(invalid.questions[0].clone());
    assert_eq!(
        store.save(&data, &root, &initial.epoch, vec![invalid]),
        Err(AssistantHistoryError::InvalidFormat)
    );
    let mut invalid = reply.clone();
    invalid.role = AssistantHistoryRole::User;
    assert_eq!(
        store.save(&data, &root, &initial.epoch, vec![invalid]),
        Err(AssistantHistoryError::InvalidFormat)
    );
    let mut invalid = reply.clone();
    invalid.scope = AssistantHistoryScope::Platform;
    assert_eq!(
        store.save(&data, &root, &initial.epoch, vec![invalid]),
        Err(AssistantHistoryError::InvalidFormat)
    );
    let mut invalid = reply.clone();
    invalid.questions[0].answer = None;
    assert_eq!(
        store.save(&data, &root, &initial.epoch, vec![invalid]),
        Err(AssistantHistoryError::InvalidFormat)
    );
    let mut pending = reply.clone();
    pending.questions = vec![serde_json::from_value(question).unwrap()];
    let mut second = pending.questions[0].clone();
    second.id = "task-question-2".into();
    pending.questions.push(second);
    assert_eq!(
        store.save(&data, &root, &initial.epoch, vec![pending]),
        Err(AssistantHistoryError::InvalidFormat)
    );
    let path = history_path(&root);
    let mut legacy: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(legacy["version"], HISTORY_VERSION);
    legacy["version"] = json!(5);
    legacy["messages"][0]
        .as_object_mut()
        .unwrap()
        .remove("questions");
    fs::write(path, serde_json::to_vec(&legacy).unwrap()).unwrap();
    assert!(store.load(&data, &root).unwrap().messages[0]
        .questions
        .is_empty());
}

#[test]
fn local_history_migrates_current_legacy_once_and_preserves_backup_after_clear() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "legacy");
    let data = temp.path().join("app");
    let store = AssistantHistoryStore::default();
    let initial = store.load(&data, &root).unwrap();
    store
        .save(
            &data,
            &root,
            &initial.epoch,
            vec![snapshot_message(&initial.project_key)],
        )
        .unwrap();
    let local = history_path(&root);
    let mut record: serde_json::Value = serde_json::from_slice(&fs::read(&local).unwrap()).unwrap();
    record["version"] = json!(6);
    let bytes = serde_json::to_vec(&record).unwrap();
    fs::create_dir_all(data.join("assistant-history")).unwrap();
    let legacy = data
        .join("assistant-history")
        .join(format!("{}.json", initial.project_key));
    fs::write(&legacy, &bytes).unwrap();
    fs::remove_file(&local).unwrap();
    let migrated = AssistantHistoryStore::default().load(&data, &root).unwrap();
    assert_eq!(migrated.epoch, initial.epoch);
    assert_eq!(
        migrated.messages[0].text,
        snapshot_message(&initial.project_key).text
    );
    assert_eq!(fs::read(&legacy).unwrap(), bytes);
    let local_bytes = fs::read(&local).unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&local_bytes).unwrap()["version"],
        HISTORY_VERSION
    );
    assert_eq!(store.load(&data, &root).unwrap().epoch, migrated.epoch);
    assert_eq!(fs::read(&local).unwrap(), local_bytes);
    let cleared = store.clear(&data, &root).unwrap();
    assert!(AssistantHistoryStore::default()
        .load(&data, &root)
        .unwrap()
        .messages
        .is_empty());
    assert_ne!(cleared.epoch, migrated.epoch);
    assert_eq!(fs::read(&legacy).unwrap(), bytes);
    // Existing corrupt local data never falls back to the valid legacy backup.
    fs::write(&local, "corrupt").unwrap();
    assert!(matches!(
        store.load(&data, &root),
        Err(AssistantHistoryError::InvalidFormat)
    ));
    assert_eq!(fs::read_to_string(&local).unwrap(), "corrupt");
}

#[test]
fn new_blank_at_a_reused_path_starts_empty_without_migrating_old_project_chat() {
    use crate::project::creation::{CreationAccess, NewProjectOptions, Protection};

    let temp = tempfile::tempdir().unwrap();
    let parent = fs::canonicalize(temp.path()).unwrap();
    let root = parent.join("reused-score");
    let data = parent.join("app");
    let key = key_for_root(&root);
    // The original folder has gone, but the path-keyed migration backup remains.
    let backup = HistoryFile {
        version: 6,
        epoch: new_epoch().unwrap(),
        project_key: key.clone(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        messages: vec![message("previous-project-answer")],
    };
    let bytes = serialize_file(&backup).unwrap();
    let legacy = data.join("assistant-history").join(format!("{key}.json"));
    fs::create_dir_all(legacy.parent().unwrap()).unwrap();
    fs::write(&legacy, &bytes).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let libraries = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/shared-libraries");
    let created = access
        .create_blank(
            &NewProjectOptions {
                parent: parent.to_string_lossy().into_owned(),
                folder_name: "reused-score".into(),
                name: "Fresh score".into(),
                author: String::new(),
                description: String::new(),
                locale: "en".into(),
                git_name: None,
                git_email: None,
            },
            &libraries,
            &protection,
        )
        .unwrap();
    access
        .commit(&created.project.identity, &protection)
        .unwrap();
    let directory = access
        .creation_data_directory(&created.project.identity, &protection)
        .unwrap();
    let history = AssistantHistoryStore::default()
        .load_at(&data, &directory, &key)
        .unwrap();
    assert!(
        history.messages.is_empty(),
        "Creating a new project must not import a previous project's path-keyed chat"
    );
    assert_ne!(history.epoch, backup.epoch);
    let reloaded = AssistantHistoryStore::default()
        .load_at(&data, &directory, &key)
        .unwrap();
    assert_eq!(reloaded.epoch, history.epoch);
    assert!(reloaded.messages.is_empty());
    AssistantHistoryStore::default()
        .save_at(
            &data,
            &directory,
            &key,
            &reloaded.epoch,
            vec![message("new-project-answer")],
        )
        .unwrap();
    let saved = AssistantHistoryStore::default()
        .load_at(&data, &directory, &key)
        .unwrap();
    assert_eq!(saved.messages.len(), 1);
    assert_eq!(saved.messages[0].id, "new-project-answer");
    assert_eq!(fs::read(legacy).unwrap(), bytes);

    let repository = git2::Repository::open(&root).unwrap();
    let initial_tree = repository.head().unwrap().peel_to_tree().unwrap();
    assert!(initial_tree
        .get_name(crate::creation_data::DIRECTORY)
        .is_none());
    let output = parent.join("fresh-score.pnds");
    crate::project::bundle::pack_project_at_with_libraries(
        &root,
        Some(&output),
        false,
        env!("CARGO_PKG_VERSION"),
        Some(&libraries),
    )
    .unwrap();
    let mut bundle = zip::ZipArchive::new(File::open(output).unwrap()).unwrap();
    for index in 0..bundle.len() {
        let entry = bundle.by_index(index).unwrap();
        assert!(
            !entry
                .name()
                .split('/')
                .any(|part| part == crate::creation_data::DIRECTORY),
            "A performance bundle must not carry the new project's private chat"
        );
    }
}

#[test]
fn invalid_or_failed_legacy_migration_does_not_publish_or_modify_the_backup() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "legacy");
    let data = temp.path().join("app");
    let key = project_key(&root).unwrap();
    fs::create_dir_all(data.join("assistant-history")).unwrap();
    let legacy = data.join("assistant-history").join(format!("{key}.json"));
    let record = HistoryFile {
        version: 6,
        epoch: new_epoch().unwrap(),
        project_key: key.clone(),
        app_version: "1.6.5".into(),
        messages: vec![message("old")],
    };
    let valid = serialize_file(&record).unwrap();
    for bytes in [b"corrupt".to_vec(), br#"{"version":999}"#.to_vec(), serde_json::to_vec(&json!({"version":6,"epoch":record.epoch,"projectKey":"a".repeat(64),"appVersion":"1.6.5","messages":[]})).unwrap()] {
        fs::write(&legacy, &bytes).unwrap();
        assert!(AssistantHistoryStore::default().load(&data, &root).is_err());
        assert!(!history_path(&root).exists());
        assert_eq!(fs::read(&legacy).unwrap(), bytes);
    }
    fs::write(&legacy, &valid).unwrap();
    let failing = AssistantHistoryStore {
        publish: fail_after_staging,
        ..Default::default()
    };
    assert!(matches!(
        failing.load(&data, &root),
        Err(AssistantHistoryError::Io)
    ));
    assert!(!history_path(&root).exists());
    assert_eq!(fs::read(&legacy).unwrap(), valid);
    assert_eq!(
        fs::read_dir(root.join(crate::creation_data::DIRECTORY))
            .unwrap()
            .count(),
        0
    );
    assert_eq!(
        AssistantHistoryStore::default()
            .load(&data, &root)
            .unwrap()
            .messages[0]
            .id,
        "old"
    );
}

#[test]
fn failed_relocation_preserves_copied_history_and_epoch_for_retry() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "original");
    let data = temp.path().join("app");
    let store = AssistantHistoryStore::default();
    let initial = store.load(&data, &root).unwrap();
    store
        .save(
            &data,
            &root,
            &initial.epoch,
            vec![snapshot_message(&initial.project_key)],
        )
        .unwrap();
    let moved = temp.path().join("relocated");
    fs::rename(&root, &moved).unwrap();
    let before = fs::read(history_path(&moved)).unwrap();
    let failing = AssistantHistoryStore {
        publish: fail_after_staging,
        ..Default::default()
    };
    assert!(matches!(
        failing.load(&data, &moved),
        Err(AssistantHistoryError::Io)
    ));
    assert_eq!(fs::read(history_path(&moved)).unwrap(), before);
    let loaded = store.load(&data, &moved).unwrap();
    assert_ne!(loaded.epoch, initial.epoch);
    assert_eq!(loaded.messages[0].id, "snapshots");
}

#[test]
fn held_project_directory_prevents_replaced_root_from_redirecting_chat_io() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "original");
    let replacement = project(temp.path(), "replacement");
    let data = temp.path().join("app");
    let store = AssistantHistoryStore::default();
    let other = store.load(&data, &replacement).unwrap();
    store
        .save(&data, &replacement, &other.epoch, vec![message("other")])
        .unwrap();
    let other_bytes = fs::read(history_path(&replacement)).unwrap();
    let key = project_key(&root).unwrap();
    let held_root = File::open(&root).unwrap();
    let moved = temp.path().join("moved");
    fs::rename(&root, &moved).unwrap();
    symlink(&replacement, &root).unwrap();
    // The same operation can finish after validation even if its pathname is
    // swapped. Both directory creation and publication use the held root.
    let directory = crate::creation_data::open(&held_root).unwrap();
    let initial = store.load_at(&data, &directory, &key).unwrap();
    assert!(initial.messages.is_empty());
    store
        .save_at(
            &data,
            &directory,
            &key,
            &initial.epoch,
            vec![message("owned")],
        )
        .unwrap();
    assert_eq!(
        store.load_at(&data, &directory, &key).unwrap().messages[0].id,
        "owned"
    );
    store.clear_at(&directory, &key).unwrap();
    assert_eq!(fs::read(history_path(&replacement)).unwrap(), other_bytes);
    assert!(store.load(&data, &moved).unwrap().messages.is_empty());
}
