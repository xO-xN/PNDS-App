//! Candidate-specific assistant facts. No ordinary task grant or real-root writes.
use super::*;

fn assistant_token(prefix: &str) -> Result<String, CreationError> {
    let mut bytes = [0u8; 16];
    ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut bytes)
        .map_err(|_| invalid("Could not create a merge assistant scope"))?;
    let suffix: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    Ok(format!("{prefix}-{suffix}"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitMergeAssistantState {
    Running,
    Waiting,
    Stopped,
    Failed,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitMergeAssistantTask {
    pub id: String,
    pub candidate_id: String,
    pub revision: u32,
    pub writable: bool,
    pub created_at: f64,
    pub scope: AssistantQuestionScope,
    pub input: String,
    pub response: String,
    pub state: GitMergeAssistantState,
    pub questions: Vec<AssistantQuestion>,
    pub checkpoint: Option<String>,
    #[serde(default)]
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitMergeAssistantUpdate {
    pub response: String,
    pub state: GitMergeAssistantState,
    pub checkpoint: Option<String>,
    #[serde(default)]
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitMergeAssistantWrite {
    pub path: String,
    pub version: String,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeAssistantChanges {
    pub available: bool,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeAssistantDiff {
    pub diff: GitComparisonDiff,
    pub conflict_changed: bool,
    pub before_exists: bool,
    pub after_exists: bool,
}

fn round_checkpoint<'a>(record: &'a Record, round: &str) -> Option<&'a Checkpoint> {
    record
        .pending_round
        .as_ref()
        .filter(|value| value.id == round)
        .or_else(|| record.checkpoint.as_ref().filter(|value| value.id == round))
}

fn round_paths(checkpoint: &Checkpoint) -> BTreeSet<String> {
    let mut paths = changed_paths(&checkpoint.before, &checkpoint.after)
        .into_iter()
        .collect::<BTreeSet<_>>();
    for path in checkpoint
        .before_conflicts
        .keys()
        .chain(checkpoint.after_conflicts.keys())
    {
        if checkpoint.before_conflicts.get(path) != checkpoint.after_conflicts.get(path) {
            paths.insert(path.clone());
        }
    }
    paths
}

fn task_path(project: &OpenProject, candidate: &str, task: &str) -> Result<PathBuf, CreationError> {
    if task.is_empty()
        || task.len() > 128
        || !task
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
    {
        return Err(invalid("Invalid merge assistant round"));
    }
    Ok(operation_path(project, candidate)?.join(format!("assistant-{task}.json")))
}

fn validate_task(task: &GitMergeAssistantTask) -> Result<(), CreationError> {
    if task.input.trim().is_empty()
        || task.input.len() > 16 * 1024
        || task.response.len() > 64 * 1024
        || task
            .checkpoint
            .as_ref()
            .is_some_and(|value| value.len() > 4 * 1024 * 1024)
        || task.questions.len() > 64
        || task.request_id.as_ref().is_some_and(|value| {
            value.is_empty()
                || value.len() > 128
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
        || !task.created_at.is_finite()
        || task.created_at < 0.0
    {
        return Err(invalid(
            "Merge assistant record exceeds its supported limits",
        ));
    }
    let mut ids = BTreeSet::new();
    let mut pending = 0;
    for question in &task.questions {
        question.validate()?;
        if question.task_id != task.id || question.scope != task.scope || !ids.insert(&question.id)
        {
            return Err(invalid("Merge question belongs to another round"));
        }
        pending += usize::from(question.status == AssistantQuestionStatus::Pending);
    }
    if pending > 1 {
        return Err(invalid("Only one merge question can await an answer"));
    }
    Ok(())
}

fn read_task(
    project: &OpenProject,
    candidate: &str,
    task: &str,
) -> Result<GitMergeAssistantTask, CreationError> {
    let value: GitMergeAssistantTask = read_json(&task_path(project, candidate, task)?)?;
    validate_task(&value)?;
    if value.id != task || value.candidate_id != candidate {
        return Err(conflict(
            "Merge assistant record belongs to another candidate",
        ));
    }
    Ok(value)
}

fn persist_task(project: &OpenProject, task: &GitMergeAssistantTask) -> Result<(), CreationError> {
    validate_task(task)?;
    write_json(&task_path(project, &task.candidate_id, &task.id)?, task)
}

fn pending_question(task: &GitMergeAssistantTask) -> bool {
    task.questions
        .iter()
        .any(|question| question.status == AssistantQuestionStatus::Pending)
}

fn require_running(task: &GitMergeAssistantTask) -> Result<(), CreationError> {
    if task.state != GitMergeAssistantState::Running || pending_question(task) {
        return Err(invalid(
            "This merge round is stopped or waiting for the creator",
        ));
    }
    Ok(())
}

impl CreationAccess {
    pub fn git_merge_assistant_changes(
        &self,
        identity: &str,
        candidate: &str,
        task: &str,
        protection: &Protection,
    ) -> Result<GitMergeAssistantChanges, CreationError> {
        let project = self.current(identity, protection)?;
        read_task(project, candidate, task)?;
        let record = load(project, candidate)?;
        Ok(match round_checkpoint(&record, task) {
            Some(checkpoint) => GitMergeAssistantChanges {
                available: true,
                paths: round_paths(checkpoint).into_iter().collect(),
            },
            None => GitMergeAssistantChanges {
                available: false,
                paths: Vec::new(),
            },
        })
    }

    pub fn read_git_merge_assistant_diff(
        &self,
        identity: &str,
        candidate: &str,
        task: &str,
        path: &str,
        full_context: bool,
        protection: &Protection,
    ) -> Result<GitMergeAssistantDiff, CreationError> {
        let project = self.current(identity, protection)?;
        read_task(project, candidate, task)?;
        let record = load(project, candidate)?;
        let checkpoint = round_checkpoint(&record, task)
            .ok_or_else(|| conflict("This round checkpoint was replaced or undone"))?;
        if !round_paths(checkpoint).contains(path) {
            return Err(invalid("This path was not changed by the assistant round"));
        }
        let repo = private_repository(project, &record)?;
        let before = checkpoint
            .before
            .get(path)
            .map(|entry| blob(&repo, entry))
            .transpose()?;
        let after = checkpoint
            .after
            .get(path)
            .map(|entry| blob(&repo, entry))
            .transpose()?;
        let binary = [before.as_deref(), after.as_deref()]
            .into_iter()
            .flatten()
            .any(|bytes| kind(path, Some(bytes)) != GitMergeFileKind::Text);
        let diff = if binary {
            GitComparisonDiff {
                token: format!("{candidate}:{task}"),
                path: path.into(),
                hunks: vec![],
                added: 0,
                deleted: 0,
                reason: Some(GitHistoryReason::Binary),
            }
        } else {
            git_comparison::compare_bytes(
                &format!("{candidate}:{task}"),
                path,
                before.as_deref().unwrap_or_default(),
                after.as_deref().unwrap_or_default(),
                full_context,
            )?
        };
        Ok(GitMergeAssistantDiff {
            diff,
            conflict_changed: checkpoint.before_conflicts.get(path)
                != checkpoint.after_conflicts.get(path),
            before_exists: before.is_some(),
            after_exists: after.is_some(),
        })
    }

    fn merge_assistant_scope(
        &mut self,
        identity: &str,
        candidate: &str,
        task: &str,
        protection: &Protection,
    ) -> Result<(GitMergeCandidate, GitMergeAssistantTask), CreationError> {
        let current = self
            .get_git_merge(identity, protection)?
            .filter(|value| value.id == candidate)
            .ok_or_else(|| conflict("This merge candidate is no longer current"))?;
        if current.phase != GitMergePhase::Active {
            return Err(conflict(
                "Resume or reprepare the current merge before starting assistance",
            ));
        }
        let record = read_task(self.current(identity, protection)?, candidate, task)?;
        if !matches!(
            record.state,
            GitMergeAssistantState::Running | GitMergeAssistantState::Waiting
        ) || (record.writable && current.assistant_owner.as_deref() != Some(task))
            || (!record.writable && current.relation != GitMergeRelation::FastForward)
        {
            return Err(conflict(
                "This assistant round no longer owns the merge candidate",
            ));
        }
        Ok((current, record))
    }

    pub fn begin_git_merge_assistant(
        &mut self,
        identity: &str,
        candidate: &str,
        revision: u32,
        scope: AssistantQuestionScope,
        input: String,
        protection: &Protection,
    ) -> Result<GitMergeAssistantTask, CreationError> {
        if [&scope.chat_id, &scope.message_id].iter().any(|value| {
            value.trim().is_empty() || value.chars().count() > 128 || value.contains('\0')
        }) {
            return Err(invalid("Invalid merge assistant conversation scope"));
        }
        let current = self
            .get_git_merge(identity, protection)?
            .filter(|value| value.id == candidate && value.revision == revision)
            .ok_or_else(|| conflict("The merge candidate changed before assistance started"))?;
        if current.phase != GitMergePhase::Active || current.assistant_owner.is_some() {
            return Err(conflict(
                "This merge candidate is not available for a new round",
            ));
        }
        let count = fs::read_dir(operation_path(
            self.current(identity, protection)?,
            candidate,
        )?)
        .map_err(io_error)?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with("assistant-") && name.ends_with(".json"))
        })
        .take(128)
        .count();
        if count >= 128 {
            return Err(invalid(
                "Merge assistant history is full; continue manually",
            ));
        }
        let writable = current.relation == GitMergeRelation::Diverged;
        let mut task = GitMergeAssistantTask {
            id: String::new(),
            candidate_id: candidate.to_owned(),
            revision,
            writable,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| invalid("The system clock is unavailable"))?
                .as_millis() as f64,
            scope,
            input,
            response: String::new(),
            state: GitMergeAssistantState::Running,
            questions: Vec::new(),
            checkpoint: None,
            request_id: None,
        };
        validate_task(&task)?;
        task.id = if writable {
            self.begin_git_merge_round(identity, candidate, revision, protection)?
                .id
        } else {
            assistant_token("read")?
        };
        if let Err(error) = persist_task(self.current(identity, protection)?, &task) {
            if writable {
                // A failed private task admission must not claim that manual editing resumed.
                self.end_git_merge_round(identity, candidate, &task.id, protection)?;
            }
            return Err(error);
        }
        Ok(task)
    }

    pub fn git_merge_assistant_tasks(
        &mut self,
        identity: &str,
        candidate: &str,
        protection: &Protection,
    ) -> Result<Vec<GitMergeAssistantTask>, CreationError> {
        self.get_git_merge(identity, protection)?
            .filter(|value| value.id == candidate)
            .ok_or_else(|| conflict("This merge candidate is no longer current"))?;
        let project = self.current(identity, protection)?;
        let mut records = Vec::new();
        for entry in fs::read_dir(operation_path(project, candidate)?).map_err(io_error)? {
            let entry = entry.map_err(io_error)?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            let Some(task) = name
                .strip_prefix("assistant-")
                .and_then(|name| name.strip_suffix(".json"))
            else {
                continue;
            };
            if records.len() >= 128 {
                return Err(invalid(
                    "Merge assistant history exceeds its supported limit",
                ));
            }
            records.push(read_task(project, candidate, task)?);
        }
        records.sort_by(|a, b| {
            a.created_at
                .total_cmp(&b.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(records)
    }

    pub fn update_git_merge_assistant(
        &mut self,
        identity: &str,
        candidate: &str,
        task: &str,
        update: GitMergeAssistantUpdate,
        protection: &Protection,
    ) -> Result<GitMergeAssistantTask, CreationError> {
        let (_, mut record) = self.merge_assistant_scope(identity, candidate, task, protection)?;
        if (update.state == GitMergeAssistantState::Waiting) != pending_question(&record)
            && !matches!(
                update.state,
                GitMergeAssistantState::Stopped | GitMergeAssistantState::Failed
            )
        {
            return Err(invalid(
                "Merge question state does not match this assistant update",
            ));
        }
        if matches!(
            update.state,
            GitMergeAssistantState::Stopped | GitMergeAssistantState::Failed
        ) {
            for question in &mut record.questions {
                if question.status == AssistantQuestionStatus::Pending {
                    question.status = AssistantQuestionStatus::Cancelled;
                    question.answer = None;
                }
            }
        }
        record.response = update.response;
        record.state = update.state;
        record.checkpoint = update.checkpoint;
        record.request_id = update.request_id;
        persist_task(self.current(identity, protection)?, &record)?;
        Ok(record)
    }

    pub fn ask_git_merge_question(
        &mut self,
        identity: &str,
        candidate: &str,
        task: &str,
        request: AssistantQuestionRequest,
        protection: &Protection,
    ) -> Result<AssistantQuestion, CreationError> {
        let (_, mut record) = self.merge_assistant_scope(identity, candidate, task, protection)?;
        require_running(&record)?;
        let question = AssistantQuestion {
            id: assistant_token("question")?,
            task_id: task.to_owned(),
            scope: record.scope.clone(),
            prompt: request.prompt,
            options: request.options,
            recommended_option_id: request.recommended_option_id,
            status: AssistantQuestionStatus::Pending,
            answer: None,
            material_conflict: None,
        };
        question.validate()?;
        record.questions.push(question.clone());
        record.state = GitMergeAssistantState::Waiting;
        persist_task(self.current(identity, protection)?, &record)?;
        Ok(question)
    }

    pub fn answer_git_merge_question(
        &mut self,
        identity: &str,
        candidate: &str,
        task: &str,
        question: &str,
        answer: AssistantQuestionAnswer,
        protection: &Protection,
    ) -> Result<GitMergeAssistantTask, CreationError> {
        let (_, mut record) = self.merge_assistant_scope(identity, candidate, task, protection)?;
        if record.state != GitMergeAssistantState::Waiting {
            return Err(conflict(
                "This merge question is no longer waiting for an answer",
            ));
        }
        let target = record
            .questions
            .iter_mut()
            .find(|item| item.id == question && item.status == AssistantQuestionStatus::Pending)
            .ok_or_else(|| conflict("This question belongs to another merge round"))?;
        target.status = AssistantQuestionStatus::Answered;
        target.answer = Some(answer);
        target.validate()?;
        record.state = GitMergeAssistantState::Running;
        persist_task(self.current(identity, protection)?, &record)?;
        Ok(record)
    }

    pub fn git_merge_assistant_paths(
        &mut self,
        identity: &str,
        candidate: &str,
        task: &str,
        side: GitMergeSide,
        protection: &Protection,
    ) -> Result<Vec<String>, CreationError> {
        self.merge_assistant_scope(identity, candidate, task, protection)?;
        self.git_merge_paths(identity, candidate, side, protection)
    }

    pub fn read_git_merge_assistant_file(
        &mut self,
        identity: &str,
        candidate: &str,
        task: &str,
        side: GitMergeSide,
        path: &str,
        protection: &Protection,
    ) -> Result<GitMergeContent, CreationError> {
        self.merge_assistant_scope(identity, candidate, task, protection)?;
        let mut content = self.read_git_merge_file(identity, candidate, path, side, protection)?;
        // The assistant receives bounded text/metadata, never local media URLs or bytes.
        content.url = None;
        Ok(content)
    }

    pub fn write_git_merge_assistant_file(
        &mut self,
        identity: &str,
        candidate: &str,
        task: &str,
        revision: u32,
        write: GitMergeAssistantWrite,
        protection: &Protection,
    ) -> Result<GitMergeCandidate, CreationError> {
        let (_, record) = self.merge_assistant_scope(identity, candidate, task, protection)?;
        require_running(&record)?;
        if !record.writable {
            return Err(invalid("Fast-forward assistance is read-only"));
        }
        let GitMergeAssistantWrite {
            path,
            version,
            text,
        } = write;
        text_creation::admitted_path(&path)?;
        let current =
            self.read_git_merge_file(identity, candidate, &path, GitMergeSide::Result, protection)?;
        if current.exists && current.text.is_none() {
            return Err(invalid("Only the creator can choose binary file contents"));
        }
        let removing = text.is_none();
        self.edit_git_merge_owned(
            identity,
            candidate,
            revision,
            Some(task),
            vec![GitMergeEdit {
                path,
                version,
                text,
                choice: removing.then_some(GitMergeChoice::Delete),
            }],
            protection,
        )
    }

    pub fn authorize_git_merge_assistant_check(
        &mut self,
        identity: &str,
        candidate: &str,
        task: &str,
        revision: u32,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let (current, record) =
            self.merge_assistant_scope(identity, candidate, task, protection)?;
        require_running(&record)?;
        if !record.writable || current.revision != revision {
            return Err(conflict(
                "This merge check no longer belongs to the current assistant round",
            ));
        }
        Ok(())
    }

    /// Revoke new tool admission before waiting for already admitted checks.
    /// The core owner remains held until the caller confirms cleanup.
    pub fn retire_git_merge_assistant(
        &mut self,
        identity: &str,
        candidate: &str,
        task: &str,
        protection: &Protection,
    ) -> Result<GitMergeCandidate, CreationError> {
        let current = self
            .get_git_merge(identity, protection)?
            .filter(|value| value.id == candidate)
            .ok_or_else(|| conflict("This merge candidate is no longer current"))?;
        if current
            .assistant_owner
            .as_deref()
            .is_some_and(|owner| owner != task)
        {
            return Err(conflict(
                "Another assistant round owns this merge candidate",
            ));
        }
        let project = self.current(identity, protection)?;
        // This also releases a restored core owner if task admission was interrupted.
        if task_path(project, candidate, task)?.exists() {
            let mut record = read_task(project, candidate, task)?;
            if matches!(
                record.state,
                GitMergeAssistantState::Running | GitMergeAssistantState::Waiting
            ) {
                record.state = GitMergeAssistantState::Stopped;
                record.checkpoint = None;
                for question in &mut record.questions {
                    if question.status == AssistantQuestionStatus::Pending {
                        question.status = AssistantQuestionStatus::Cancelled;
                    }
                }
                persist_task(project, &record)?;
            }
        }
        Ok(current)
    }

    pub fn end_git_merge_assistant(
        &mut self,
        identity: &str,
        candidate: &str,
        task: &str,
        protection: &Protection,
    ) -> Result<GitMergeCandidate, CreationError> {
        let current = self.retire_git_merge_assistant(identity, candidate, task, protection)?;
        if current.assistant_owner.as_deref() == Some(task) {
            self.end_git_merge_round(identity, candidate, task, protection)
        } else if current.assistant_owner.is_none() {
            Ok(current)
        } else {
            Err(conflict(
                "Another assistant round owns this merge candidate",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::creation::git_versions_tests::{save as record_version, setup};

    fn checkout(root: &Path, id: &str, branch: Option<&str>) {
        let repo = Repository::open(root).unwrap();
        if let Some(branch) = branch {
            repo.set_head(branch).unwrap();
        } else {
            repo.set_head_detached(parse(id).unwrap()).unwrap();
        }
        let commit = repo.find_commit(parse(id).unwrap()).unwrap();
        repo.checkout_tree(
            commit.as_object(),
            Some(git2::build::CheckoutBuilder::new().force()),
        )
        .unwrap();
        let mut index = repo.index().unwrap();
        index.read_tree(&commit.tree().unwrap()).unwrap();
        index.write().unwrap();
    }

    fn fixture() -> (
        tempfile::TempDir,
        PathBuf,
        CreationAccess,
        String,
        GitMergeCandidate,
    ) {
        let (temp, root, mut access, identity) = setup();
        fs::write(root.join("shared.txt"), "base\n").unwrap();
        fs::write(root.join("texture.png"), b"base\0binary").unwrap();
        let base = record_version(&mut access, &identity, "Base");
        let repo = Repository::open(&root).unwrap();
        repo.branch(
            "source",
            &repo.find_commit(parse(&base).unwrap()).unwrap(),
            false,
        )
        .unwrap();
        fs::write(root.join("shared.txt"), "current\n").unwrap();
        fs::write(root.join("texture.png"), b"current\0binary").unwrap();
        let target = record_version(&mut access, &identity, "Current");
        checkout(&root, &base, Some("refs/heads/source"));
        fs::write(root.join("shared.txt"), "incoming\n").unwrap();
        fs::write(root.join("texture.png"), b"incoming\0binary").unwrap();
        let source = record_version(&mut access, &identity, "Incoming");
        checkout(&root, &target, Some("refs/heads/main"));
        let candidate = access
            .prepare_git_merge(
                &identity,
                &source,
                false,
                temp.path(),
                &Protection::default(),
            )
            .unwrap();
        (temp, root, access, identity, candidate)
    }

    fn begin(
        access: &mut CreationAccess,
        identity: &str,
        candidate: &GitMergeCandidate,
    ) -> GitMergeAssistantTask {
        access
            .begin_git_merge_assistant(
                identity,
                &candidate.id,
                candidate.revision,
                AssistantQuestionScope {
                    chat_id: "candidate-chat".into(),
                    message_id: "candidate-reply".into(),
                },
                "Preserve both musical choices".into(),
                &Protection::default(),
            )
            .unwrap()
    }

    fn write(
        access: &mut CreationAccess,
        identity: &str,
        candidate: &GitMergeCandidate,
        task: &str,
        path: &str,
        text: &str,
    ) -> Result<GitMergeCandidate, CreationError> {
        let version = access
            .read_git_merge_file(
                identity,
                &candidate.id,
                path,
                GitMergeSide::Result,
                &Protection::default(),
            )?
            .version;
        access.write_git_merge_assistant_file(
            identity,
            &candidate.id,
            task,
            candidate.revision,
            GitMergeAssistantWrite {
                path: path.into(),
                version,
                text: Some(text.into()),
            },
            &Protection::default(),
        )
    }

    #[test]
    fn merge_assistant_reads_fixed_inputs_and_writes_only_owned_candidate_text() {
        let (_temp, root, mut access, identity, candidate) = fixture();
        let actual_head = Repository::open(&root)
            .unwrap()
            .head()
            .unwrap()
            .target()
            .unwrap();
        let task = begin(&mut access, &identity, &candidate);
        for (side, expected) in [
            (GitMergeSide::Base, "base\n"),
            (GitMergeSide::Current, "current\n"),
            (GitMergeSide::Incoming, "incoming\n"),
        ] {
            assert_eq!(
                access
                    .read_git_merge_assistant_file(
                        &identity,
                        &candidate.id,
                        &task.id,
                        side,
                        "shared.txt",
                        &Protection::default()
                    )
                    .unwrap()
                    .text
                    .as_deref(),
                Some(expected)
            );
        }
        let changed = write(
            &mut access,
            &identity,
            &candidate,
            &task.id,
            "shared.txt",
            "combined\n",
        )
        .unwrap();
        let paths = access
            .git_merge_assistant_changes(&identity, &candidate.id, &task.id, &Protection::default())
            .unwrap();
        assert!(paths.available);
        assert_eq!(paths.paths, ["shared.txt"]);
        let diff = access
            .read_git_merge_assistant_diff(
                &identity,
                &candidate.id,
                &task.id,
                "shared.txt",
                false,
                &Protection::default(),
            )
            .unwrap();
        assert!(diff.conflict_changed);
        assert!(diff
            .diff
            .hunks
            .iter()
            .flat_map(|hunk| &hunk.lines)
            .any(|line| matches!(line.kind, GitComparisonLineKind::Addition)
                && line.content.contains("combined")));
        assert!(access
            .read_git_merge_assistant_diff(
                &identity,
                &candidate.id,
                &task.id,
                "texture.png",
                false,
                &Protection::default()
            )
            .is_err());
        assert_eq!(
            fs::read_to_string(root.join("shared.txt")).unwrap(),
            "current\n"
        );
        assert_eq!(
            Repository::open(&root).unwrap().head().unwrap().target(),
            Some(actual_head)
        );
        assert!(write(
            &mut access,
            &identity,
            &changed,
            &task.id,
            "texture.png",
            "not a binary rewrite"
        )
        .is_err());
        assert!(write(
            &mut access,
            &identity,
            &changed,
            "another-round",
            "shared.txt",
            "late\n"
        )
        .is_err());
        let content = access
            .read_git_merge_assistant_file(
                &identity,
                &candidate.id,
                &task.id,
                GitMergeSide::Result,
                "texture.png",
                &Protection::default(),
            )
            .unwrap();
        assert!(content.text.is_none());
        assert!(content.url.is_none());
        access
            .end_git_merge_assistant(&identity, &candidate.id, &task.id, &Protection::default())
            .unwrap();
        assert!(write(
            &mut access,
            &identity,
            &changed,
            &task.id,
            "shared.txt",
            "late\n"
        )
        .is_err());
    }

    #[test]
    fn merge_assistant_questions_keep_round_scope_and_hold_writes_until_the_answer() {
        let (_temp, _root, mut access, identity, candidate) = fixture();
        let task = begin(&mut access, &identity, &candidate);
        let question = access
            .ask_git_merge_question(
                &identity,
                &candidate.id,
                &task.id,
                AssistantQuestionRequest {
                    prompt: "Which rhythm?".into(),
                    options: vec![],
                    recommended_option_id: None,
                },
                &Protection::default(),
            )
            .unwrap();
        assert_eq!(question.scope, task.scope);
        assert!(write(
            &mut access,
            &identity,
            &candidate,
            &task.id,
            "shared.txt",
            "guessed\n"
        )
        .is_err());
        assert!(access
            .answer_git_merge_question(
                &identity,
                &candidate.id,
                "another-round",
                &question.id,
                AssistantQuestionAnswer {
                    option_id: None,
                    text: Some("Both".into())
                },
                &Protection::default()
            )
            .is_err());
        let answered = access
            .answer_git_merge_question(
                &identity,
                &candidate.id,
                &task.id,
                &question.id,
                AssistantQuestionAnswer {
                    option_id: None,
                    text: Some("Both".into()),
                },
                &Protection::default(),
            )
            .unwrap();
        assert_eq!(
            answered.questions[0].status,
            AssistantQuestionStatus::Answered
        );
        assert!(write(
            &mut access,
            &identity,
            &candidate,
            &task.id,
            "shared.txt",
            "both\n"
        )
        .is_ok());
    }

    #[test]
    fn merge_assistant_retirement_fences_new_tools_before_releasing_the_core_owner() {
        let (_temp, _root, mut access, identity, candidate) = fixture();
        let task = begin(&mut access, &identity, &candidate);
        let retired = access
            .retire_git_merge_assistant(&identity, &candidate.id, &task.id, &Protection::default())
            .unwrap();
        assert_eq!(retired.assistant_owner.as_deref(), Some(task.id.as_str()));
        assert!(access
            .authorize_git_merge_assistant_check(
                &identity,
                &candidate.id,
                &task.id,
                candidate.revision,
                &Protection::default()
            )
            .is_err());
        assert!(write(
            &mut access,
            &identity,
            &candidate,
            &task.id,
            "shared.txt",
            "late write\n"
        )
        .is_err());
        let released = access
            .end_git_merge_assistant(&identity, &candidate.id, &task.id, &Protection::default())
            .unwrap();
        assert!(released.assistant_owner.is_none());
    }

    #[test]
    fn merge_assistant_undo_refuses_the_whole_round_after_a_later_manual_overlap() {
        let (_temp, _root, mut access, identity, candidate) = fixture();
        let task = begin(&mut access, &identity, &candidate);
        let first = write(
            &mut access,
            &identity,
            &candidate,
            &task.id,
            "shared.txt",
            "both\n",
        )
        .unwrap();
        let second = write(
            &mut access,
            &identity,
            &first,
            &task.id,
            "new.txt",
            "round-added\n",
        )
        .unwrap();
        access
            .end_git_merge_assistant(&identity, &candidate.id, &task.id, &Protection::default())
            .unwrap();
        let source = access
            .read_git_merge_file(
                &identity,
                &candidate.id,
                "shared.txt",
                GitMergeSide::Result,
                &Protection::default(),
            )
            .unwrap();
        let manual = access
            .edit_git_merge_owned(
                &identity,
                &candidate.id,
                second.revision,
                None,
                vec![GitMergeEdit {
                    path: "shared.txt".into(),
                    version: source.version,
                    text: Some("manual\n".into()),
                    choice: None,
                }],
                &Protection::default(),
            )
            .unwrap();
        assert!(access
            .undo_git_merge_round(
                &identity,
                &candidate.id,
                manual.revision,
                &Protection::default()
            )
            .is_err());
        assert_eq!(
            access
                .read_git_merge_file(
                    &identity,
                    &candidate.id,
                    "new.txt",
                    GitMergeSide::Result,
                    &Protection::default()
                )
                .unwrap()
                .text
                .as_deref(),
            Some("round-added\n")
        );
        assert_eq!(
            access
                .read_git_merge_file(
                    &identity,
                    &candidate.id,
                    "shared.txt",
                    GitMergeSide::Result,
                    &Protection::default()
                )
                .unwrap()
                .text
                .as_deref(),
            Some("manual\n")
        );
    }

    #[test]
    fn merge_assistant_fast_forward_is_explanation_only() {
        let (temp, root, mut access, identity) = setup();
        let base = record_version(&mut access, &identity, "Base");
        fs::write(root.join("next.txt"), "incoming\n").unwrap();
        let source = record_version(&mut access, &identity, "Incoming");
        checkout(&root, &base, None);
        let candidate = access
            .prepare_git_merge(
                &identity,
                &source,
                false,
                temp.path(),
                &Protection::default(),
            )
            .unwrap();
        let task = begin(&mut access, &identity, &candidate);
        assert!(!task.writable);
        assert!(access
            .get_git_merge(&identity, &Protection::default())
            .unwrap()
            .unwrap()
            .assistant_owner
            .is_none());
        assert!(write(
            &mut access,
            &identity,
            &candidate,
            &task.id,
            "next.txt",
            "changed\n"
        )
        .is_err());
        assert!(access
            .authorize_git_merge_assistant_check(
                &identity,
                &candidate.id,
                &task.id,
                candidate.revision,
                &Protection::default()
            )
            .is_err());
        assert_eq!(
            access
                .read_git_merge_assistant_file(
                    &identity,
                    &candidate.id,
                    &task.id,
                    GitMergeSide::Result,
                    "next.txt",
                    &Protection::default()
                )
                .unwrap()
                .text
                .as_deref(),
            Some("incoming\n")
        );
    }
}
