use super::super::*;

#[test]
fn retirement_staging_is_reclaimed_without_retiring_the_recoverable_task() {
    let mut fixture = Fixture::new();
    fixture.save().unwrap();
    let task_id = fixture.record.task_id.clone();
    let journal = fixture.journal_path(&task_id);
    let original = fs::read(&journal).unwrap();
    let root = fs::canonicalize(&fixture.root).unwrap();
    let metadata = fs::metadata(&root).unwrap();
    let owner = format!("{}:{}", metadata.dev(), metadata.ino());
    let prefix = super::temporary_prefix(&root, &owner);
    let directory = journal.parent().unwrap();
    let staging = directory.join(format!("{prefix}1-2-3"));
    let foreign = directory.join(format!(
        "{}1-2-3",
        super::temporary_prefix(&root, "other-inode")
    ));
    let link = directory.join(format!("{prefix}1-2-4"));
    let target = fixture._temp.path().join("outside");
    fs::write(&staging, "incomplete private snapshot").unwrap();
    fs::write(&foreign, "other owner's staging").unwrap();
    fs::write(&target, "outside bytes").unwrap();
    std::os::unix::fs::symlink(&target, &link).unwrap();
    fixture.reopen();
    assert_eq!(fixture.load().unwrap().unwrap().record.task_id, task_id);
    assert!(!staging.exists());
    assert_eq!(
        fs::read_to_string(foreign).unwrap(),
        "other owner's staging"
    );
    assert!(link.is_symlink());
    assert_eq!(fs::read_to_string(target).unwrap(), "outside bytes");
    assert_eq!(fs::read(journal).unwrap(), original);
}

#[test]
fn legacy_directories_larger_than_the_project_inventory_limit_do_not_block_recovery() {
    let mut fixture = Fixture::new();
    fixture.save().unwrap();
    let task_id = fixture.record.task_id.clone();
    let journal = fixture.journal_path(&task_id);
    let directory = journal.parent().unwrap();
    for index in 0..4097 {
        fs::write(
            directory.join(format!("legacy-{index}.json")),
            "unknown old record",
        )
        .unwrap();
    }
    fixture.clear(Some(&task_id)).unwrap();
    assert!(!journal.exists());
    fixture.reopen();
    assert!(fixture.load().unwrap().is_none());
    assert_eq!(fs::read_dir(directory).unwrap().count(), 4097);
    fixture
        .access
        .begin_assistant_task(
            &fixture.identity,
            AssistantMode::Edit,
            None,
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
}

#[test]
fn whole_clear_does_not_mistake_terminal_publication_failure_for_an_invalid_journal() {
    let mut fixture = Fixture::new();
    fixture.save().unwrap();
    let journal = fixture.journal_path(&fixture.record.task_id);
    let checkpoint = fixture.checkpoint_path();
    let checkpoint_bytes = fs::read(&checkpoint).unwrap();
    let mut value: serde_json::Value =
        serde_json::from_slice(&fs::read(&journal).unwrap()).unwrap();
    value.as_object_mut().unwrap().remove("retired");
    value["entries"] = serde_json::json!([{
        "path":"server.js", "before":"", "after":"", "pending":null,
        "undone":false, "removed":false, "pending_remove":false
    }]);
    let remaining = 16 * 1024 * 1024 - serde_json::to_vec(&value).unwrap().len();
    value["entries"][0]["before"] = "x".repeat(remaining).into();
    let original = serde_json::to_vec(&value).unwrap();
    assert_eq!(original.len(), 16 * 1024 * 1024);
    fs::write(&journal, &original).unwrap();
    assert!(fixture.clear(None).is_err());
    assert_eq!(fs::read(journal).unwrap(), original);
    assert_eq!(fs::read(checkpoint).unwrap(), checkpoint_bytes);
}
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
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = super::super::super::tests::project(temp.path(), "score");
        let data = temp.path().join("data");
        let mut access = CreationAccess::default();
        let identity = access
            .open(&root, &Protection::default())
            .unwrap()
            .project
            .identity;
        let task = access
            .begin_assistant_task(
                &identity,
                AssistantMode::Edit,
                None,
                &data,
                &Protection::default(),
            )
            .unwrap();
        let record = AssistantTaskResume {
            task_id: task.id,
            mode: AssistantMode::Edit,
            user_message_id: "user-message".into(),
            reply_message_id: "reply-message".into(),
            conversation_id: Some("conversation".into()),
            input: "Add individual performer controls".into(),
            locale: "en".into(),
            model_key: "local-model-configuration-fingerprint".into(),
            state: AssistantTaskResumeState::Running,
            payload: "{}".into(),
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

    fn clear(&mut self, task_id: Option<&str>) -> Result<(), CreationError> {
        self.access.clear_assistant_resume(
            &self.identity,
            task_id,
            &self.data,
            &Protection::default(),
        )
    }

    fn journal_path(&self, task_id: &str) -> PathBuf {
        journal_directory(&self.data, &fs::canonicalize(&self.root).unwrap())
            .join(format!("{task_id}.json"))
    }

    fn checkpoint_path(&self) -> PathBuf {
        let paths: Vec<_> = fs::read_dir(self.data.join("assistant-resume"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        assert_eq!(paths.len(), 1);
        paths[0].clone()
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

    fn resume(&mut self, task_id: &str) -> Result<AssistantTask, CreationError> {
        self.access.begin_assistant_task(
            &self.identity,
            AssistantMode::Edit,
            Some(task_id),
            &self.data,
            &Protection::default(),
        )
    }

    fn write(&mut self) {
        let before = fs::read(self.root.join("server.js")).unwrap();
        self.access
            .write_assistant_file(
                &self.identity,
                &self.record.task_id,
                &AssistantWrite {
                    path: "server.js".into(),
                    version: Some(file_version(&before)),
                    text: Some("// saved performer controls".into()),
                    edits: None,
                },
                &self.data,
                &Protection::default(),
            )
            .unwrap();
    }

    fn mark_retired(&self) {
        let path = self.journal_path(&self.record.task_id);
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        value["retired"] = true.into();
        fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
    }
}

#[test]
fn ending_execution_retains_the_paused_checkpoint_and_file_recovery() {
    let mut fixture = Fixture::new();
    fixture.write();
    fixture.record.state = AssistantTaskResumeState::Paused;
    fixture.save().unwrap();
    let journal = fixture.journal_path(&fixture.record.task_id);
    let checkpoint = fixture.checkpoint_path();
    fixture
        .access
        .end_assistant_task(&fixture.identity, &fixture.record.task_id);
    assert!(journal.is_file());
    assert!(checkpoint.is_file());
    assert!(fixture
        .access
        .authorize_assistant_task(
            &fixture.identity,
            &fixture.record.task_id,
            true,
            &Protection::default(),
        )
        .is_err());
    fixture.reopen();
    let recovered = fixture.load().unwrap().unwrap();
    assert_eq!(recovered.record.state, AssistantTaskResumeState::Paused);
    assert_eq!(recovered.files.len(), 1);
    assert_eq!(recovered.files[0].path, "server.js");
    let task_id = fixture.record.task_id.clone();
    fixture.resume(&task_id).unwrap();
}

#[test]
fn clearing_a_task_removes_private_snapshots_without_reverting_saved_files() {
    let mut fixture = Fixture::new();
    fixture.write();
    fixture.save().unwrap();
    let task_id = fixture.record.task_id.clone();
    let journal = fixture.journal_path(&task_id);
    let checkpoint = fixture.checkpoint_path();
    fixture.clear(Some(&task_id)).unwrap();
    assert!(!journal.exists());
    assert!(!checkpoint.exists());
    assert!(fixture.load().unwrap().is_none());
    assert_eq!(
        fs::read_to_string(fixture.root.join("server.js")).unwrap(),
        "// saved performer controls"
    );
    assert!(fixture.save().is_err());
    assert!(fixture.resume(&task_id).is_err());
    fixture.reopen();
    assert!(fixture.save().is_err());
    assert!(fixture.resume(&task_id).is_err());
    assert!(!journal.exists());
    assert!(!checkpoint.exists());
}

#[test]
fn clearing_a_known_task_without_a_checkpoint_still_retires_its_journal() {
    let mut fixture = Fixture::new();
    let task_id = fixture.record.task_id.clone();
    let journal = fixture.journal_path(&task_id);
    assert!(journal.is_file());
    fixture.clear(Some(&task_id)).unwrap();
    assert!(!journal.exists());
    assert!(fixture.save().is_err());
    assert!(fixture.resume(&task_id).is_err());
}

#[test]
fn an_old_task_clear_preserves_the_new_checkpoint_after_its_grant_has_ended() {
    let mut fixture = Fixture::new();
    fixture.save().unwrap();
    let old = fixture.record.clone();
    fixture
        .access
        .end_assistant_task(&fixture.identity, &old.task_id);
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
    fixture.record.task_id = next.id.clone();
    fixture.save().unwrap();
    fixture
        .access
        .end_assistant_task(&fixture.identity, &next.id);
    let checkpoint = fixture.checkpoint_path();
    let contents = fs::read(&checkpoint).unwrap();
    let next_journal = fixture.journal_path(&next.id);
    let next_contents = fs::read(&next_journal).unwrap();
    fixture.clear(Some(&old.task_id)).unwrap();
    assert!(!fixture.journal_path(&old.task_id).exists());
    assert_eq!(fs::read(&checkpoint).unwrap(), contents);
    assert_eq!(fs::read(&next_journal).unwrap(), next_contents);
    assert_eq!(fixture.load().unwrap().unwrap().record.task_id, next.id);
    assert!(fixture
        .access
        .save_assistant_resume(
            &fixture.identity,
            old.clone(),
            &fixture.data,
            &Protection::default(),
        )
        .is_err());
    assert!(fixture.resume(&old.task_id).is_err());
    assert_eq!(fs::read(checkpoint).unwrap(), contents);
    fixture.resume(&next.id).unwrap();
}

#[test]
fn a_live_grant_rejects_new_and_other_resumed_tasks_until_it_ends() {
    let mut fixture = Fixture::new();
    let first_id = fixture.record.task_id.clone();
    fixture
        .access
        .end_assistant_task(&fixture.identity, &first_id);
    let second = fixture
        .access
        .begin_assistant_task(
            &fixture.identity,
            AssistantMode::Edit,
            None,
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    fixture
        .access
        .end_assistant_task(&fixture.identity, &second.id);
    fixture.resume(&first_id).unwrap();
    assert!(fixture
        .access
        .begin_assistant_task(
            &fixture.identity,
            AssistantMode::Edit,
            None,
            &fixture.data,
            &Protection::default(),
        )
        .is_err());
    assert!(fixture.resume(&second.id).is_err());
    fixture
        .access
        .authorize_assistant_task(&fixture.identity, &first_id, true, &Protection::default())
        .unwrap();
    fixture
        .access
        .end_assistant_task(&fixture.identity, &first_id);
    fixture.resume(&second.id).unwrap();
    fixture
        .access
        .end_assistant_task(&fixture.identity, &second.id);
    fixture
        .access
        .begin_assistant_task(
            &fixture.identity,
            AssistantMode::Edit,
            None,
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
}

#[test]
fn ordinary_legacy_foreign_and_corrupt_journals_are_not_retired_by_another_task() {
    let mut fixture = Fixture::new();
    fixture.save().unwrap();
    let task_id = fixture.record.task_id.clone();
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(fixture.journal_path(&task_id)).unwrap()).unwrap();
    let mut legacy = value.clone();
    legacy["id"] = "legacy-task".into();
    legacy.as_object_mut().unwrap().remove("retired");
    let mut foreign = value;
    foreign["id"] = "foreign-task".into();
    foreign["root"] = fixture
        .root
        .join("foreign-project")
        .to_string_lossy()
        .as_ref()
        .into();
    foreign["retired"] = true.into();
    let artifacts = [
        (
            fixture.journal_path("legacy-task"),
            serde_json::to_vec(&legacy).unwrap(),
        ),
        (
            fixture.journal_path("foreign-task"),
            serde_json::to_vec(&foreign).unwrap(),
        ),
        (
            fixture.journal_path("corrupt-task"),
            b"{incomplete".to_vec(),
        ),
    ];
    for (path, contents) in &artifacts {
        fs::write(path, contents).unwrap();
    }
    fixture.clear(Some(&task_id)).unwrap();
    fixture.reopen();
    assert!(fixture.load().unwrap().is_none());
    for (path, contents) in artifacts {
        assert_eq!(fs::read(path).unwrap(), contents);
    }
}

#[test]
fn selecting_a_foreign_or_corrupt_journal_preserves_both_private_records() {
    for corrupt in [false, true] {
        let mut fixture = Fixture::new();
        fixture.save().unwrap();
        let task_id = fixture.record.task_id.clone();
        let journal = fixture.journal_path(&task_id);
        let checkpoint = fixture.checkpoint_path();
        let checkpoint_contents = fs::read(&checkpoint).unwrap();
        let contents = if corrupt {
            b"{incomplete".to_vec()
        } else {
            let mut value: serde_json::Value =
                serde_json::from_slice(&fs::read(&journal).unwrap()).unwrap();
            value["root"] = fixture
                .root
                .join("foreign-project")
                .to_string_lossy()
                .as_ref()
                .into();
            serde_json::to_vec(&value).unwrap()
        };
        fs::write(&journal, &contents).unwrap();
        assert!(fixture.clear(Some(&task_id)).is_err());
        assert_eq!(fs::read(journal).unwrap(), contents);
        assert_eq!(fs::read(checkpoint).unwrap(), checkpoint_contents);
    }
}

#[test]
fn whole_clear_recovers_a_foreign_or_corrupt_journal_without_deleting_it() {
    for corrupt in [false, true] {
        for restart in [false, true] {
            let mut fixture = Fixture::new();
            fixture.save().unwrap();
            let task_id = fixture.record.task_id.clone();
            let journal = fixture.journal_path(&task_id);
            let checkpoint = fixture.checkpoint_path();
            let contents = if corrupt {
                b"{incomplete".to_vec()
            } else {
                let mut value: serde_json::Value =
                    serde_json::from_slice(&fs::read(&journal).unwrap()).unwrap();
                value["root"] = fixture
                    .root
                    .join("foreign-project")
                    .to_string_lossy()
                    .as_ref()
                    .into();
                serde_json::to_vec(&value).unwrap()
            };
            fs::write(&journal, &contents).unwrap();
            if restart {
                fixture.reopen();
            }
            fixture.clear(None).unwrap();
            assert_eq!(fs::read(&journal).unwrap(), contents);
            assert!(!checkpoint.exists());
            assert!(fixture.load().unwrap().is_none());
            assert!(
                fixture
                    .access
                    .authorize_assistant_task(
                        &fixture.identity,
                        &task_id,
                        true,
                        &Protection::default(),
                    )
                    .is_err()
            );
            fixture
                .access
                .begin_assistant_task(
                    &fixture.identity,
                    AssistantMode::Edit,
                    None,
                    &fixture.data,
                    &Protection::default(),
                )
                .unwrap();
            assert_eq!(fs::read(&journal).unwrap(), contents);
        }
    }
}

#[test]
fn interrupted_retirement_is_retried_when_loading_or_resuming_after_restart() {
    for resume in [false, true] {
        let mut fixture = Fixture::new();
        fixture.write();
        fixture.save().unwrap();
        let task_id = fixture.record.task_id.clone();
        let journal = fixture.journal_path(&task_id);
        let checkpoint = fixture.checkpoint_path();
        fixture.mark_retired();
        fixture.reopen();
        if resume {
            assert!(fixture.resume(&task_id).is_err());
        } else {
            assert!(fixture.load().unwrap().is_none());
        }
        assert!(!journal.exists());
        assert!(!checkpoint.exists());
        assert!(fixture.save().is_err());
        assert_eq!(
            fs::read_to_string(fixture.root.join("server.js")).unwrap(),
            "// saved performer controls"
        );
    }
}

#[test]
fn loading_reaps_a_retired_journal_after_checkpoint_unlink_was_interrupted() {
    let mut fixture = Fixture::new();
    fixture.write();
    fixture.save().unwrap();
    let task_id = fixture.record.task_id.clone();
    let journal = fixture.journal_path(&task_id);
    let checkpoint = fixture.checkpoint_path();
    fixture.mark_retired();
    fs::remove_file(&checkpoint).unwrap();
    fixture.reopen();
    assert!(journal.is_file());
    assert!(fixture.load().unwrap().is_none());
    assert!(!journal.exists());
    assert!(!checkpoint.exists());
    assert!(fixture.save().is_err());
    assert!(fixture.resume(&task_id).is_err());
    assert_eq!(
        fs::read_to_string(fixture.root.join("server.js")).unwrap(),
        "// saved performer controls"
    );
}

#[test]
fn explicit_whole_clear_retries_retirement_blocked_by_a_corrupt_checkpoint() {
    let mut fixture = Fixture::new();
    fixture.save().unwrap();
    let task_id = fixture.record.task_id.clone();
    let journal = fixture.journal_path(&task_id);
    let checkpoint = fixture.checkpoint_path();
    fixture.mark_retired();
    let retired_contents = fs::read(&journal).unwrap();
    fs::write(&checkpoint, b"{incomplete").unwrap();
    fixture.reopen();
    assert!(fixture.load().is_err());
    assert!(fixture.clear(Some(&task_id)).is_err());
    assert_eq!(fs::read(&journal).unwrap(), retired_contents);
    assert_eq!(fs::read(&checkpoint).unwrap(), b"{incomplete");
    fixture.clear(None).unwrap();
    assert!(!journal.exists());
    assert!(!checkpoint.exists());
    assert!(fixture.load().unwrap().is_none());
    assert!(fixture.save().is_err());
    assert!(fixture.resume(&task_id).is_err());
}

#[test]
fn journal_and_parent_directory_symlinks_refuse_cleanup_without_touching_targets() {
    for parent_depth in 0..3 {
        let mut fixture = Fixture::new();
        fixture.save().unwrap();
        let task_id = fixture.record.task_id.clone();
        let journal = fixture.journal_path(&task_id);
        let checkpoint = fixture.checkpoint_path();
        let checkpoint_contents = fs::read(&checkpoint).unwrap();
        let journal_contents = fs::read(&journal).unwrap();
        let replaced = journal.ancestors().nth(parent_depth).unwrap();
        let outside = fixture._temp.path().join("outside");
        let outside_journal = if parent_depth == 0 {
            outside.clone()
        } else {
            outside.join(journal.strip_prefix(replaced).unwrap())
        };
        fs::rename(replaced, &outside).unwrap();
        symlink(&outside, replaced).unwrap();
        fixture.reopen();
        assert!(fixture.clear(Some(&task_id)).is_err());
        assert!(fixture.load().is_err());
        assert_eq!(fs::read(&outside_journal).unwrap(), journal_contents);
        assert_eq!(fs::read(&checkpoint).unwrap(), checkpoint_contents);
        assert!(fs::symlink_metadata(replaced)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_link(replaced).unwrap(), outside);
    }
}
