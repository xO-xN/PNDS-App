use super::*;
use std::os::unix::fs::symlink;

struct Fixture {
    _temp: tempfile::TempDir,
    root: PathBuf,
    data: PathBuf,
    access: CreationAccess,
    identity: String,
    record: AssistantTaskResume,
}

impl Fixture {
    fn new(mode: AssistantMode) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = super::super::tests::project(temp.path(), "score");
        let data = temp.path().join("data");
        let mut access = CreationAccess::default();
        let identity = access
            .open(&root, &Protection::default())
            .unwrap()
            .project
            .identity;
        let task = access
            .begin_assistant_task(&identity, mode, None, &data, &Protection::default())
            .unwrap();
        let record = AssistantTaskResume {
            task_id: task.id,
            mode,
            user_message_id: "user-message".into(),
            reply_message_id: "reply-message".into(),
            conversation_id: Some("conversation".into()),
            input: "Add individual performer controls".into(),
            locale: "en".into(),
            model_key: "local-model-configuration-fingerprint".into(),
            state: AssistantTaskResumeState::Running,
            payload: r#"{"request":{"input":"Add controls"},"continuation":{"messages":[]}}"#
                .into(),
        };
        Self {
            _temp: temp,
            root,
            data,
            access,
            identity,
            record,
        }
    }

    fn save(&self) -> Result<(), CreationError> {
        self.access.save_assistant_resume(
            &self.identity,
            self.record.clone(),
            &self.data,
            &Protection::default(),
        )
    }

    fn load(&self) -> Result<Option<AssistantTaskResumeRecovery>, CreationError> {
        self.access
            .load_assistant_resume(&self.identity, &self.data, &Protection::default())
    }

    fn path(&self) -> PathBuf {
        let project = self
            .access
            .current(&self.identity, &Protection::default())
            .unwrap();
        self.data
            .join("assistant-resume")
            .join(file_name(project).unwrap().to_str().unwrap())
    }

    fn reopen(&mut self) {
        self.access = CreationAccess::default();
        self.identity = self
            .access
            .open(&self.root, &Protection::default())
            .unwrap()
            .project
            .identity;
    }

    fn journal_path(&self) -> PathBuf {
        let canonical = fs::canonicalize(&self.root).unwrap();
        let digest = format!("{:x}", Sha256::digest(canonical.as_os_str().as_bytes()));
        self.data
            .join("assistant-tasks")
            .join(digest)
            .join(format!("{}.json", self.record.task_id))
    }
}

#[test]
fn roundtrip_survives_restart_for_both_modes_without_restoring_authority() {
    for mode in [AssistantMode::Edit, AssistantMode::Handoff] {
        let mut fixture = Fixture::new(mode);
        assert!(fixture.load().unwrap().is_none());
        fixture.save().unwrap();
        let path = fixture.path();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(path.parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        fixture.reopen();
        let restored = fixture.load().unwrap().unwrap();
        assert_eq!(restored.record.task_id, fixture.record.task_id);
        assert_eq!(restored.record.payload, fixture.record.payload);
        assert_eq!(restored.record.mode, mode);
        assert!(restored.files.is_empty());
        assert!(fixture
            .access
            .authorize_assistant_task(
                &fixture.identity,
                &fixture.record.task_id,
                false,
                &Protection::default()
            )
            .is_err());
        fixture
            .access
            .begin_assistant_task(
                &fixture.identity,
                mode,
                Some(&fixture.record.task_id),
                &fixture.data,
                &Protection::default(),
            )
            .unwrap();
        fixture
            .access
            .authorize_assistant_task(
                &fixture.identity,
                &fixture.record.task_id,
                mode == AssistantMode::Edit,
                &Protection::default(),
            )
            .unwrap();
    }
}

#[test]
fn validates_payload_metadata_task_and_mode_before_atomic_overwrite() {
    let mut fixture = Fixture::new(AssistantMode::Edit);
    fixture.save().unwrap();
    let path = fixture.path();
    let original = fs::read(&path).unwrap();
    for payload in [
        "[]".to_owned(),
        "{incomplete".to_owned(),
        r#"{"request":{"credentials":"secret"}}"#.to_owned(),
        r#"{"continuation":{"reasoning_content":"private"}}"#.to_owned(),
        serde_json::json!({"text":"x".repeat(PAYLOAD_MAX_BYTES)}).to_string(),
    ] {
        fixture.record.payload = payload;
        assert!(fixture.save().is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
    }
    fixture.record.payload = "{}".into();
    fixture.record.input = "x".repeat(64 * 1024 + 1);
    assert!(fixture.save().is_err());
    fixture.record.input = "same goal".into();
    fixture.record.mode = AssistantMode::Handoff;
    assert!(fixture.save().is_err());
    fixture.record.mode = AssistantMode::Edit;
    fixture.record.task_id = "missing-task".into();
    assert!(fixture.save().is_err());
    assert_eq!(fs::read(&path).unwrap(), original);
    fixture.record.task_id = fixture.load().unwrap().unwrap().record.task_id;
    fixture.record.state = AssistantTaskResumeState::Paused;
    fixture.save().unwrap();
    assert_eq!(
        fixture.load().unwrap().unwrap().record.state,
        AssistantTaskResumeState::Paused
    );
    assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
}

#[test]
fn reasoning_survives_restart_only_in_assistant_protocol_messages() {
    let mut fixture = Fixture::new(AssistantMode::Edit);
    fixture.record.payload = serde_json::json!({
        "version":1,
        "history":[{"role":"assistant","text":"Saved answer","reasoningContent":"private history reasoning"}],
        "continuation":{"messages":[{"role":"assistant","content":null,"reasoningContent":"","toolCalls":[{"id":"one","name":"search_help","arguments":"{}"}]},{"role":"tool","content":"found","toolCallId":"one"}]}
    }).to_string();
    fixture.save().unwrap();
    let restored = fixture.load().unwrap().unwrap();
    assert_eq!(restored.record.payload, fixture.record.payload);
    let original = fs::read(fixture.path()).unwrap();
    for payload in [
        serde_json::json!({"continuation":{"messages":[{"role":"user","reasoningContent":"private"}]}}),
        serde_json::json!({"continuation":{"messages":[{"role":"assistant","reasoningContent":42}]}}),
        serde_json::json!({"continuation":{"messages":[{"role":"assistant","reasoningContent":"x".repeat(crate::model::MAX_REASONING_BYTES + 1)}]}}),
        serde_json::json!({"continuation":{"reasoningContent":"outside a message"}}),
        serde_json::json!({"continuation":{"messages":[{"role":"assistant","credentials":"secret"}]}}),
    ] {
        fixture.record.payload = payload.to_string();
        assert!(fixture.save().is_err());
        assert_eq!(fs::read(fixture.path()).unwrap(), original);
    }
}

#[test]
fn stale_clear_and_old_saves_cannot_replace_a_new_active_task() {
    let mut fixture = Fixture::new(AssistantMode::Edit);
    fixture.save().unwrap();
    let old = fixture.record.clone();
    let next = fixture
        .access
        .begin_assistant_task(
            &fixture.identity,
            AssistantMode::Edit,
            None,
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    assert!(fixture.save().is_err());
    fixture.record.task_id = next.id;
    fixture.save().unwrap();
    fixture
        .access
        .clear_assistant_resume(
            &fixture.identity,
            Some(&old.task_id),
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    assert_eq!(
        fixture.load().unwrap().unwrap().record.task_id,
        fixture.record.task_id
    );
    fixture
        .access
        .clear_assistant_resume(
            &fixture.identity,
            Some(&fixture.record.task_id),
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    assert!(fixture.load().unwrap().is_none());
}

#[test]
fn explicit_whole_history_clear_recovers_corrupt_and_unknown_records_without_parsing() {
    let fixture = Fixture::new(AssistantMode::Edit);
    for contents in [
        b"{incomplete".as_slice(),
        br#"{"schemaVersion":999}"#.as_slice(),
    ] {
        fixture.save().unwrap();
        let path = fixture.path();
        fs::write(&path, contents).unwrap();
        assert!(fixture.load().is_err());
        assert!(fixture
            .access
            .clear_assistant_resume(
                &fixture.identity,
                Some(&fixture.record.task_id),
                &fixture.data,
                &Protection::default(),
            )
            .is_err());
        fixture
            .access
            .clear_assistant_resume(
                &fixture.identity,
                None,
                &fixture.data,
                &Protection::default(),
            )
            .unwrap();
        assert!(!path.exists());
        assert!(fixture.load().unwrap().is_none());
    }
    fixture
        .access
        .clear_assistant_resume(
            &fixture.identity,
            None,
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
}

#[test]
fn wrong_project_replaced_inode_and_unsupported_records_are_refused() {
    let mut fixture = Fixture::new(AssistantMode::Edit);
    fixture.save().unwrap();
    let path = fixture.path();
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let original_root = value["root"].clone();
    value["schemaVersion"] = serde_json::json!(2);
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(fixture.load().is_err());
    assert!(fixture.save().is_err());
    value["schemaVersion"] = serde_json::json!(1);
    value["root"] = serde_json::json!(fixture.root.with_file_name("other-project"));
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(fixture.load().is_err());
    value["root"] = original_root;
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    fs::rename(&fixture.root, fixture.root.with_file_name("previous-inode")).unwrap();
    super::super::tests::project(fixture._temp.path(), "score");
    assert!(fixture.load().is_err());
    fixture.reopen();
    assert!(fixture.load().unwrap().is_none());
    assert!(path.is_file());
    let next = fixture
        .access
        .begin_assistant_task(
            &fixture.identity,
            AssistantMode::Edit,
            None,
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    fixture.record.task_id = next.id;
    fixture.save().unwrap();
    assert_ne!(fixture.path(), path);
    assert!(path.is_file());
    fixture
        .access
        .clear_assistant_resume(
            &fixture.identity,
            None,
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    assert!(fixture.load().unwrap().is_none());
    assert!(path.is_file());
}

#[test]
fn storage_directory_and_record_symlinks_are_not_followed() {
    let fixture = Fixture::new(AssistantMode::Edit);
    let outside = fixture._temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    symlink(&outside, fixture.data.join("assistant-resume")).unwrap();
    assert!(fixture.save().is_err());
    assert!(fixture.load().is_err());
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    fs::remove_file(fixture.data.join("assistant-resume")).unwrap();
    fixture.save().unwrap();
    let path = fixture.path();
    fs::rename(&path, path.with_extension("backup")).unwrap();
    let target = outside.join("target.json");
    fs::write(&target, "untouched").unwrap();
    symlink(&target, &path).unwrap();
    assert!(fixture.save().is_err());
    assert!(fixture.load().is_err());
    assert_eq!(fs::read_to_string(target).unwrap(), "untouched");
    fixture
        .access
        .clear_assistant_resume(
            &fixture.identity,
            None,
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    assert!(fixture.load().unwrap().is_none());
    assert_eq!(
        fs::read_to_string(outside.join("target.json")).unwrap(),
        "untouched"
    );
}

#[test]
fn recovery_reconciles_completed_unknown_write_and_refuses_external_edits() {
    let mut fixture = Fixture::new(AssistantMode::Edit);
    fixture.save().unwrap();
    let journal = fixture.journal_path();
    let mut value: serde_json::Value =
        serde_json::from_slice(&fs::read(&journal).unwrap()).unwrap();
    value["entries"] = serde_json::json!([{
        "path":"controls.js", "before":null, "after":"", "pending":"saved task bytes",
        "undone":false, "removed":false, "pending_remove":false
    }]);
    fs::write(&journal, serde_json::to_vec(&value).unwrap()).unwrap();
    fs::write(fixture.root.join("controls.js"), "saved task bytes").unwrap();
    fixture.reopen();
    let recovered = fixture.load().unwrap().unwrap();
    assert_eq!(recovered.files.len(), 1);
    assert_eq!(recovered.files[0].path, "controls.js");
    assert_eq!(
        recovered.files[0].version.as_deref(),
        Some(file_version(b"saved task bytes").as_str())
    );
    assert!(fixture.access.assistant_grant.is_none());
    fs::write(fixture.root.join("controls.js"), "creator changed this").unwrap();
    assert_eq!(
        fixture.load().unwrap_err().code,
        CreationErrorCode::VersionConflict
    );
    assert!(fixture
        .access
        .begin_assistant_task(
            &fixture.identity,
            AssistantMode::Edit,
            Some(&fixture.record.task_id),
            &fixture.data,
            &Protection::default(),
        )
        .is_err());
}

#[test]
fn interrupted_initial_publication_can_continue_but_committed_deletion_refuses() {
    for committed in [false, true] {
        let mut fixture = Fixture::new(AssistantMode::Edit);
        fixture.save().unwrap();
        let path = fixture.journal_path();
        let mut journal: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        journal["entries"] = serde_json::json!([{
            "path":"controls.js", "before":null,
            "after":if committed { "previous committed task bytes" } else { "" },
            "pending":"next task bytes", "undone":false, "removed":false,
            "pending_remove":false
        }]);
        fs::write(&path, serde_json::to_vec(&journal).unwrap()).unwrap();
        fixture.reopen();
        if committed {
            assert_eq!(
                fixture.load().unwrap_err().code,
                CreationErrorCode::VersionConflict
            );
            continue;
        }
        assert!(fixture.load().unwrap().unwrap().files.is_empty());
        fixture
            .access
            .begin_assistant_task(
                &fixture.identity,
                AssistantMode::Edit,
                Some(&fixture.record.task_id),
                &fixture.data,
                &Protection::default(),
            )
            .unwrap();
        fixture
            .access
            .write_assistant_file(
                &fixture.identity,
                &fixture.record.task_id,
                &AssistantWrite {
                    path: "controls.js".into(),
                    version: None,
                    text: Some("observed missing, now create".into()),
                    edits: None,
                },
                &fixture.data,
                &Protection::default(),
            )
            .unwrap();
        assert_eq!(
            fs::read_to_string(fixture.root.join("controls.js")).unwrap(),
            "observed missing, now create"
        );
    }
}

#[test]
fn verified_removal_receipts_do_not_allow_recreated_creator_files() {
    let mut fixture = Fixture::new(AssistantMode::Edit);
    fs::write(fixture.root.join("obsolete.js"), "old task bytes").unwrap();
    fixture.save().unwrap();
    fixture
        .access
        .remove_assistant_file(
            &fixture.identity,
            &fixture.record.task_id,
            "obsolete.js",
            &file_version(b"old task bytes"),
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    fixture.reopen();
    let recovery = fixture.load().unwrap().unwrap();
    assert_eq!(recovery.files.len(), 1);
    assert_eq!(recovery.files[0].path, "obsolete.js");
    assert!(recovery.files[0].version.is_none());
    fs::write(fixture.root.join("obsolete.js"), "new creator bytes").unwrap();
    assert_eq!(
        fixture.load().unwrap_err().code,
        CreationErrorCode::VersionConflict
    );
    assert_eq!(
        fs::read_to_string(fixture.root.join("obsolete.js")).unwrap(),
        "new creator bytes"
    );
}

#[test]
fn explicit_git_task_ending_clears_stale_recovery_and_rejects_late_publication() {
    let mut fixture = Fixture::new(AssistantMode::Edit);
    fixture
        .access
        .write_assistant_file(
            &fixture.identity,
            &fixture.record.task_id,
            &AssistantWrite {
                path: "controls.js".into(),
                version: None,
                text: Some("saved task changes".into()),
                edits: None,
            },
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    fixture.save().unwrap();
    let journal = fixture.journal_path();
    fs::write(fixture.root.join("controls.js"), "later creator changes").unwrap();
    fixture.reopen();
    assert!(fixture.load().is_err());
    assert!(fixture
        .access
        .git_task_pending(&fixture.identity, &fixture.data, &Protection::default())
        .unwrap());
    fixture
        .access
        .end_git_assistant_task(&fixture.identity, &fixture.data, &Protection::default())
        .unwrap();
    assert!(!fixture
        .access
        .git_task_pending(&fixture.identity, &fixture.data, &Protection::default())
        .unwrap());
    assert!(journal.exists());
    assert_eq!(
        fs::read_to_string(fixture.root.join("controls.js")).unwrap(),
        "later creator changes"
    );
    assert!(fixture.save().is_err());
    assert!(fixture
        .access
        .begin_assistant_task(
            &fixture.identity,
            AssistantMode::Edit,
            Some(&fixture.record.task_id),
            &fixture.data,
            &Protection::default()
        )
        .is_err());
    fixture.reopen();
    assert!(fixture.load().unwrap().is_none());
}
