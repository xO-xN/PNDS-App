//! Explicit version navigation. Viewing never writes; switching preserves all routes.
use super::*;
use git2::{Oid, Repository};
use sha2::{Digest, Sha256};

const SCAN_LIMIT: usize = 1200;
const PAGE_SIZE: usize = 60;
const BRANCH_LIMIT: usize = 128;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitVersionBranch {
    pub name: String,
    pub tip: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitVersion {
    pub id: String,
    pub parents: Vec<String>,
    pub message: String,
    pub timestamp: f64,
    pub files: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitVersionGraph {
    pub head: Option<String>,
    pub branches: Vec<GitVersionBranch>,
    pub versions: Vec<GitVersion>,
    pub next_offset: Option<u32>,
    pub limited: bool,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitSwitchPreview {
    pub token: String,
    pub commit: String,
    pub paths: Vec<String>,
    pub discarded_paths: Vec<String>,
}
pub(super) struct GitSwitchSession {
    identity: String,
    fingerprint: String,
    discard: bool,
    branch: Option<String>,
    preview: GitSwitchPreview,
}
fn refuse(detail: impl Into<String>) -> CreationError {
    CreationError::new(CreationErrorCode::TestValidation, detail)
}
fn branches(repo: &Repository) -> Result<Vec<GitVersionBranch>, CreationError> {
    let mut result = Vec::new();
    for branch in repo
        .branches(Some(git2::BranchType::Local))
        .map_err(local_git::git_error)?
    {
        if result.len() >= BRANCH_LIMIT {
            return Err(refuse(
                "More than 128 local branches; use an external Git tool.",
            ));
        }
        let (branch, _) = branch.map_err(local_git::git_error)?;
        let tip = branch
            .get()
            .target()
            .ok_or_else(|| refuse("Unsupported symbolic local branch"))?;
        let name = branch
            .name()
            .map_err(local_git::git_error)?
            .ok_or_else(|| refuse("Branch name is not UTF-8"))?;
        result.push(GitVersionBranch {
            name: name.into(),
            tip: tip.to_string(),
            message: Some(
                repo.find_commit(tip)
                    .map_err(local_git::git_error)?
                    .summary()
                    .map_err(local_git::git_error)?
                    .unwrap_or("")
                    .chars()
                    .take(1000)
                    .collect(),
            ),
        });
    }
    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}
struct VersionWalk<'a> {
    repo: &'a Repository,
    pending: std::collections::VecDeque<Oid>,
    seen: std::collections::BTreeSet<Oid>,
    budget: native_git::GitReadBudget,
}
impl Iterator for VersionWalk<'_> {
    type Item = Result<Oid, CreationError>;
    fn next(&mut self) -> Option<Self::Item> {
        while let Some(id) = self.pending.pop_front() {
            if !self.seen.insert(id) {
                continue;
            }
            return Some((|| {
                let commit = self.budget.commit(self.repo, id)?;
                for parent in commit.parent_ids() {
                    if !self.seen.contains(&parent) {
                        self.pending.push_back(parent);
                    }
                }
                if self.pending.len() > MAX_ENTRIES {
                    return Err(refuse("Version graph frontier exceeds 4096 entries"));
                }
                Ok(id)
            })());
        }
        None
    }
}
fn walk_from(repo: &Repository, include_head: bool) -> Result<VersionWalk<'_>, CreationError> {
    let mut pending = std::collections::VecDeque::new();
    if include_head {
        match repo.head() {
            Ok(head) => pending.push_back(head.target().ok_or_else(|| refuse("No readable HEAD"))?),
            Err(error)
                if matches!(
                    error.code(),
                    git2::ErrorCode::UnbornBranch | git2::ErrorCode::NotFound
                ) => {}
            Err(error) => return Err(local_git::git_error(error)),
        }
    }
    for branch in branches(repo)? {
        pending.push_back(Oid::from_str(&branch.tip).map_err(local_git::git_error)?);
    }
    Ok(VersionWalk {
        repo,
        pending,
        seen: Default::default(),
        budget: Default::default(),
    })
}
fn walk(repo: &Repository) -> Result<VersionWalk<'_>, CreationError> {
    walk_from(repo, true)
}
pub(super) fn reachable<'a>(
    repo: &'a Repository,
    id: &str,
) -> Result<git2::Commit<'a>, CreationError> {
    let selected = Oid::from_str(id).map_err(local_git::git_error)?;
    let mut traversal = walk(repo)?;
    for _ in 0..SCAN_LIMIT {
        let Some(id) = traversal.next() else {
            break;
        };
        let id = id?;
        let commit = traversal.budget.commit(repo, id)?;
        if id == selected {
            traversal.budget.tree(repo, commit.tree_id())?;
            return Ok(commit);
        }
    }
    Err(refuse("Version is no longer reachable within 1200 local commits. Refresh versions or use an external Git tool."))
}
pub(super) fn new_branch_ref(
    repo: &Repository,
    name: Option<&str>,
) -> Result<String, CreationError> {
    let name = name.unwrap_or("").trim();
    if name.len() > 120 || name.contains(['\0', '\n', '\r']) {
        return Err(refuse("Branch name is too long or invalid"));
    }
    // The display name can be Chinese or contain spaces; derive a valid ref.
    let slug: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let stem = if slug.is_empty() { "attempt" } else { &slug };
    for suffix in 1..=10000 {
        let candidate = format!("refs/heads/pnds/{stem}-{suffix}");
        if git2::Reference::is_valid_name(&candidate) {
            match repo.find_reference(&candidate) {
                Err(error) if error.code() == git2::ErrorCode::NotFound => return Ok(candidate),
                Err(error) => return Err(local_git::git_error(error)),
                Ok(_) => {}
            }
        }
    }
    Err(refuse("Cannot allocate a new local branch"))
}
fn snapshot(
    project: &OpenProject,
    discard: bool,
    owned_locks: bool,
) -> Result<(Repository, String, Vec<String>), CreationError> {
    let saved = local_git::snapshot_with_locks(project, owned_locks)?;
    let repo = saved
        .repo
        .ok_or_else(|| refuse("Save the first version before switching"))?;
    let mut discarded = Vec::new();
    let index = native_git::bounded_index(&repo)?;
    for file in saved.files {
        if file.exclusion.is_some() && index.get_path(Path::new(&file.path), 0).is_none() {
            continue;
        }
        if file.staged {
            return Err(refuse(
                "External staged changes must be handled before switching versions.",
            ));
        }
        if !discard {
            return Err(refuse(
                "Save current changes or explicitly discard them before switching.",
            ));
        }
        if file.exclusion.is_some() {
            return Err(refuse(format!(
                "Excluded or large file cannot be discarded by version switching: {}",
                file.path
            )));
        }
        discarded.push(file.path);
    }
    let mut hash = Sha256::new();
    hash.update(saved.fingerprint);
    for branch in branches(&repo)? {
        hash.update(branch.name);
        hash.update(b"\0");
        hash.update(branch.tip);
        hash.update(b"\0");
    }
    Ok((repo, format!("{:x}", hash.finalize()), discarded))
}
impl CreationAccess {
    pub fn git_version_paths(
        &self,
        identity: &str,
        commit: &str,
        protection: &Protection,
    ) -> Result<Vec<String>, CreationError> {
        let project = self.current(identity, protection)?;
        let repo = native_git::repository(&project.root)?;
        let selected = reachable(&repo, commit)?;
        let mut budget = native_git::GitReadBudget::default();
        budget.tree(&repo, selected.tree_id())?;
        let head = repo
            .head()
            .and_then(|head| head.peel_to_commit())
            .map_err(local_git::git_error)?;
        budget.tree(&repo, head.tree_id())?;
        let workdir = fs::canonicalize(repo.workdir().ok_or_else(|| refuse("Bare repository"))?)
            .map_err(io_error)?;
        let prefix = project
            .root
            .strip_prefix(&workdir)
            .map_err(|_| refuse("Project boundary changed"))?;
        let diff = repo
            .diff_tree_to_tree(
                Some(&head.tree().map_err(local_git::git_error)?),
                Some(&selected.tree().map_err(local_git::git_error)?),
                None,
            )
            .map_err(local_git::git_error)?;
        let mut paths = std::collections::BTreeSet::new();
        for delta in diff.deltas() {
            for file in [delta.old_file(), delta.new_file()] {
                if let Some(path) = file
                    .path()
                    .and_then(|path| path.strip_prefix(prefix).ok())
                    .and_then(Path::to_str)
                {
                    paths.insert(path.to_owned());
                }
                if paths.len() > MAX_ENTRIES {
                    return Err(refuse("Version difference exceeds 4096 paths"));
                }
            }
        }
        Ok(paths.into_iter().collect())
    }
    pub fn git_version_graph(
        &self,
        identity: &str,
        offset: u32,
        protection: &Protection,
    ) -> Result<GitVersionGraph, CreationError> {
        let project = self.current(identity, protection)?;
        let repo = native_git::repository(&project.root)?;
        let workdir = fs::canonicalize(repo.workdir().ok_or_else(|| refuse("Bare repository"))?)
            .map_err(io_error)?;
        let prefix = project
            .root
            .strip_prefix(&workdir)
            .map_err(|_| refuse("Project boundary changed"))?;
        if offset as usize >= SCAN_LIMIT {
            return Err(refuse("Version graph scan limit reached"));
        }
        let refs = branches(&repo)?;
        let head = repo
            .head()
            .ok()
            .and_then(|head| head.target())
            .map(|id| id.to_string());
        let mut walk = walk(&repo)?;
        let mut versions = Vec::new();
        let mut scanned = 0;
        let mut message_bytes = 0;
        let mut path_count = 0;
        for id in walk.by_ref().take(offset as usize) {
            id?;
        }
        let count = PAGE_SIZE.min(SCAN_LIMIT - offset as usize);
        for _ in 0..count {
            let Some(id) = walk.next() else {
                break;
            };
            scanned += 1;
            let commit = walk.budget.commit(&repo, id?)?;
            walk.budget.tree(&repo, commit.tree_id())?;
            let tree = commit.tree().map_err(local_git::git_error)?;
            let parent = if let Some(id) = commit.parent_ids().next() {
                let parent = walk.budget.commit(&repo, id)?;
                walk.budget.tree(&repo, parent.tree_id())?;
                Some(parent.tree().map_err(local_git::git_error)?)
            } else {
                None
            };
            let diff = repo
                .diff_tree_to_tree(parent.as_ref(), Some(&tree), None)
                .map_err(local_git::git_error)?;
            let mut files = std::collections::BTreeSet::new();
            for delta in diff.deltas() {
                for file in [delta.old_file(), delta.new_file()] {
                    if let Some(path) = file
                        .path()
                        .and_then(|path| path.strip_prefix(prefix).ok())
                        .and_then(Path::to_str)
                    {
                        files.insert(path.to_owned());
                    }
                }
            }
            if !prefix.as_os_str().is_empty() && files.is_empty() {
                continue;
            }
            path_count += files.len();
            let message = commit.message().map_err(local_git::git_error)?.to_owned();
            message_bytes += message.len();
            if path_count > MAX_ENTRIES || message_bytes > TEXT_MAX_BYTES as usize {
                return Err(refuse("Version page is too large"));
            }
            versions.push(GitVersion {
                id: commit.id().to_string(),
                parents: commit.parent_ids().map(|id| id.to_string()).collect(),
                message,
                timestamp: commit.time().seconds() as f64,
                files: files.into_iter().collect(),
            });
        }
        let more = walk.next().transpose()?.is_some();
        let next = offset as usize + scanned;
        self.current(identity, protection)?;
        Ok(GitVersionGraph {
            head,
            branches: refs,
            versions,
            next_offset: (more && next < SCAN_LIMIT).then_some(next as u32),
            limited: more && next >= SCAN_LIMIT,
        })
    }
    fn git_tasks_idle(
        &self,
        identity: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        if self.git_task_pending(identity, data, protection)? {
            return Err(refuse(
                "Explicitly end the unfinished assistant task before switching versions.",
            ));
        }
        Ok(())
    }
    pub fn git_task_pending(
        &self,
        identity: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<bool, CreationError> {
        self.current(identity, protection)?;
        Ok(self
            .assistant_grant
            .as_ref()
            .is_some_and(|(owner, _, _)| owner == identity)
            || self.has_assistant_resume(identity, data, protection)?)
    }
    pub fn end_git_assistant_task(
        &mut self,
        identity: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        self.current(identity, protection)?;
        if let Ok(Some(task_id)) = self.assistant_resume_id(identity, data, protection) {
            self.git_ended_tasks.insert(task_id);
        }
        if let Some((owner, task, _)) = &self.assistant_grant {
            if owner == identity {
                self.git_ended_tasks.insert(task.clone());
            }
        }
        self.clear_assistant_resume(identity, None, data, protection)?;
        self.assistant_grant = None;
        Ok(())
    }
    pub fn preview_git_switch(
        &mut self,
        identity: &str,
        commit: &str,
        discard: bool,
        data: &Path,
        protection: &Protection,
    ) -> Result<GitSwitchPreview, CreationError> {
        self.preview_git_switch_target(identity, (commit, None), discard, data, protection)
    }
    pub fn preview_git_branch_switch(
        &mut self,
        identity: &str,
        target: (&str, &str),
        discard: bool,
        data: &Path,
        protection: &Protection,
    ) -> Result<GitSwitchPreview, CreationError> {
        let (branch, expected_commit) = target;
        self.git_switch_preview = None;
        let project = self.current(identity, protection)?;
        let (repo, _, _) = snapshot(project, discard, false)?;
        let reference = repo
            .find_branch(branch, git2::BranchType::Local)
            .map_err(local_git::git_error)?;
        let commit = reference
            .get()
            .target()
            .ok_or_else(|| refuse("Unsupported symbolic local branch"))?
            .to_string();
        if commit != expected_commit {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Branch changed; review again",
            ));
        }
        let name = reference
            .get()
            .name()
            .map_err(local_git::git_error)?
            .to_owned();
        self.preview_git_switch_target(identity, (&commit, Some(&name)), discard, data, protection)
    }
    fn preview_git_switch_target(
        &mut self,
        identity: &str,
        target: (&str, Option<&str>),
        discard: bool,
        data: &Path,
        protection: &Protection,
    ) -> Result<GitSwitchPreview, CreationError> {
        let (commit, branch) = target;
        self.git_switch_preview = None;
        self.git_tasks_idle(identity, data, protection)?;
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        let (repo, fingerprint, discarded_paths) = snapshot(project, discard, false)?;
        let tree = git_restore::target_for_switch(&repo, commit, &discarded_paths)?;
        let head = repo
            .head()
            .and_then(|head| head.peel_to_commit())
            .map_err(local_git::git_error)?;
        if branch.is_none()
            && head.id() == Oid::from_str(commit).map_err(local_git::git_error)?
            && !discard
        {
            return Err(refuse("Already at this version"));
        }
        let diff = repo
            .diff_tree_to_tree(
                Some(&head.tree().map_err(local_git::git_error)?),
                Some(&tree),
                None,
            )
            .map_err(local_git::git_error)?;
        let mut paths: std::collections::BTreeSet<String> =
            discarded_paths.iter().cloned().collect();
        for delta in diff.deltas() {
            for file in [delta.old_file(), delta.new_file()] {
                if let Some(path) = file.path().and_then(Path::to_str) {
                    paths.insert(path.into());
                }
            }
        }
        let mut options = git2::build::CheckoutBuilder::new();
        options
            .dry_run()
            .update_index(false)
            .overwrite_ignored(false);
        if discard {
            options.force();
        } else {
            options.safe();
        }
        repo.checkout_tree(tree.as_object(), Some(&mut options))
            .map_err(local_git::git_error)?;
        self.change_sequence += 1;
        let preview = GitSwitchPreview {
            token: format!("switch-{identity}-{}", self.change_sequence),
            commit: commit.into(),
            paths: paths.into_iter().collect(),
            discarded_paths,
        };
        self.git_switch_preview = Some(GitSwitchSession {
            identity: identity.into(),
            fingerprint,
            discard,
            branch: branch.map(str::to_owned),
            preview: preview.clone(),
        });
        Ok(preview)
    }
    pub fn confirm_git_switch(
        &mut self,
        identity: &str,
        token: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let session = self
            .git_switch_preview
            .take()
            .filter(|s| s.identity == identity && s.preview.token == token)
            .ok_or_else(|| refuse("Version switch preview expired"))?;
        self.git_tasks_idle(identity, data, protection)?;
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        let (repo, fingerprint, _) = snapshot(project, session.discard, false)?;
        if fingerprint != session.fingerprint {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Files or Git state changed; review the switch again.",
            ));
        }
        let tree = git_restore::target_for_switch(
            &repo,
            &session.preview.commit,
            &session.preview.discarded_paths,
        )?;
        let old = repo
            .head()
            .and_then(|head| head.peel_to_commit())
            .map_err(local_git::git_error)?;
        let target = Oid::from_str(&session.preview.commit).map_err(local_git::git_error)?;
        let restore_current = old.id() == target && session.branch.is_none();
        let mut transaction = repo.transaction().map_err(local_git::git_error)?;
        transaction.lock_ref("HEAD").map_err(local_git::git_error)?;
        if let Some(name) = repo
            .head()
            .map_err(local_git::git_error)?
            .name()
            .ok()
            .filter(|name| *name != "HEAD")
        {
            transaction.lock_ref(name).map_err(local_git::git_error)?;
        }
        if let Some(branch) = &session.branch {
            let current = repo.head().map_err(local_git::git_error)?;
            if current.name().ok() != Some(branch.as_str()) {
                transaction.lock_ref(branch).map_err(local_git::git_error)?;
            }
            if repo
                .find_reference(branch)
                .map_err(local_git::git_error)?
                .target()
                != Some(target)
            {
                return Err(CreationError::new(
                    CreationErrorCode::VersionConflict,
                    "Branch changed; review again",
                ));
            }
        }
        // Pin a detached starting point before moving away, even when imported
        // from external Git. Every previous saved route remains reachable.
        let retained = walk_from(&repo, false)?;
        let mut preserved = false;
        for id in retained.take(SCAN_LIMIT) {
            if id? == old.id() {
                preserved = true;
                break;
            }
        }
        let pin = if preserved || restore_current {
            None
        } else {
            Some(new_branch_ref(&repo, Some("saved"))?)
        };
        if let Some(pin) = &pin {
            transaction.lock_ref(pin).map_err(local_git::git_error)?;
        }
        let lock_path = repo.path().join("index.lock");
        struct IndexLock(PathBuf);
        impl Drop for IndexLock {
            fn drop(&mut self) {
                let _ = fs::remove_file(&self.0);
            }
        }
        let mut locked = File::options()
            .write(true)
            .create_new(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&lock_path)
            .map_err(io_error)?;
        let _lock = IndexLock(lock_path.clone());
        if snapshot(project, session.discard, true)?.1 != session.fingerprint {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Git state changed during switch preparation",
            ));
        }
        validate_identity(project, protection)?;
        let mut options = git2::build::CheckoutBuilder::new();
        options.update_index(false).overwrite_ignored(false);
        if session.discard {
            options.force();
        } else {
            options.safe();
        }
        let mut index = git2::Index::new().map_err(local_git::git_error)?;
        index.read_tree(&tree).map_err(local_git::git_error)?;
        let temporary = tempfile::tempdir().map_err(io_error)?;
        let mut replacement =
            git2::Index::open(&temporary.path().join("index")).map_err(local_git::git_error)?;
        for item in index.iter() {
            replacement.add(&item).map_err(local_git::git_error)?;
        }
        replacement.write().map_err(local_git::git_error)?;
        locked
            .write_all(&fs::read(temporary.path().join("index")).map_err(io_error)?)
            .map_err(io_error)?;
        locked.sync_all().map_err(io_error)?;
        // No other branch ref moves when inspecting an old version.
        if let Some(pin) = &pin {
            if repo.find_reference(pin).is_ok() {
                return Err(refuse("A branch was created during switch preparation"));
            }
            transaction
                .set_target(
                    pin,
                    old.id(),
                    None,
                    "Preserve project version before switch",
                )
                .map_err(local_git::git_error)?;
        }
        if let Some(branch) = &session.branch {
            transaction
                .set_symbolic_target("HEAD", branch, None, "Switch project branch")
                .map_err(local_git::git_error)?;
        } else if !restore_current {
            transaction
                .set_target("HEAD", target, None, "Switch project version")
                .map_err(local_git::git_error)?;
        }
        repo.checkout_tree(tree.as_object(), Some(&mut options)).map_err(|e| CreationError::new(CreationErrorCode::Io, format!("Version checkout did not finish: {e}. Inspect saved files; recorded versions are retained.")))?;
        if session.discard {
            for path in &session.preview.discarded_paths {
                if native_git::bounded_index(&repo)?
                    .get_path(Path::new(path), 0)
                    .is_none()
                    && tree.get_path(Path::new(path)).is_err()
                {
                    fs::remove_file(project.root.join(path)).map_err(io_error)?;
                }
            }
        }
        // If publication fails, explicitly report the partial disk operation.
        transaction.commit().map_err(|e| CreationError::new(CreationErrorCode::Io, format!("Files were checked out but version publication failed: {e}. Inspect the project before retrying.")))?;
        fs::rename(lock_path, repo.path().join("index")).map_err(|e| CreationError::new(CreationErrorCode::Io, format!("Version changed but index publication failed: {e}. Use an external Git tool before retrying.")))?;
        Ok(())
    }
}
