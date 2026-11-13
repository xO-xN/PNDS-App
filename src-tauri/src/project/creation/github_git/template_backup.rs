use super::*;
use crate::github_auth::GithubRepository;
use git2::{Commit, Signature};

const PIN_PREFIX: &str = "refs/pnds/template-backup";
const BACKUP_MESSAGE: &str = "Connect project history to the official PNDS template";
const INTEGRATE_MESSAGE: &str = "Integrate the first PNDS template backup";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubTemplateCommit {
    pub branch: String,
    pub local_head: String,
    pub remote_head: String,
    pub merge_head: String,
}

impl GithubGitContext {
    pub(crate) fn template_remote_head(
        &self,
        repository: &GithubRepository,
        token: &str,
    ) -> Result<Option<String>, CreationError> {
        self.check_template_owner()?;
        let scratch = tempfile::tempdir().map_err(io_error)?;
        let repo = initialize(scratch.path(), "main", true)?;
        let head = read_remote_head(
            &repo,
            &github_url(&repository.full_name)?,
            Some(token),
            &repository.default_branch,
        )?;
        self.check_template_owner()?;
        Ok(head.map(|id| id.to_string()))
    }

    pub(crate) fn prepare_template_backup(
        &self,
        repository: &GithubRepository,
        token: &str,
        expected_local_head: &str,
        expected_remote_head: &str,
    ) -> Result<GithubTemplateCommit, CreationError> {
        prepare_repository(
            &self.template_repository()?,
            (&github_url(&repository.full_name)?, Some(token)),
            &repository.default_branch,
            parse_oid(expected_local_head)?,
            parse_oid(expected_remote_head)?,
            || self.check_template_owner(),
        )
    }

    pub(crate) fn pin_template_backup(
        &self,
        plan: &GithubTemplateCommit,
    ) -> Result<(), CreationError> {
        pin_repository(&self.template_repository()?, plan, || {
            self.check_template_owner()
        })
    }

    pub(crate) fn push_template_backup(
        &self,
        repository: &GithubRepository,
        token: &str,
        plan: &GithubTemplateCommit,
        exact_local_head: bool,
    ) -> Result<(), CreationError> {
        if repository.default_branch != plan.branch {
            return Err(remote_changed());
        }
        push_template_repository(
            &self.template_repository()?,
            (&github_url(&repository.full_name)?, Some(token)),
            plan,
            exact_local_head,
            || self.check_template_owner(),
        )
    }

    pub(crate) fn finish_template_backup(
        &self,
        plan: &GithubTemplateCommit,
    ) -> Result<GithubLocalGit, CreationError> {
        finish_repository(&self.template_repository()?, plan, || {
            self.check_template_owner()
        })
    }

    pub(crate) fn release_template_backup(
        &self,
        plan: &GithubTemplateCommit,
    ) -> Result<(), CreationError> {
        release_repository(&self.template_repository()?, plan, || {
            self.check_template_owner()
        })
    }

    fn template_repository(&self) -> Result<Repository, CreationError> {
        self.repository()?
            .ok_or_else(|| conflict("Save a local version before backing up."))
    }

    fn check_template_owner(&self) -> Result<(), CreationError> {
        blank::check_directory_identity(&self.root, &self.directory)
    }
}

fn pin_name(merge: Oid) -> String {
    format!("{PIN_PREFIX}/{merge}")
}

fn local_changed() -> CreationError {
    conflict("The local branch changed. Review the first backup again.")
}

fn remote_changed() -> CreationError {
    conflict("The default GitHub branch changed. Review the first backup again.")
}

fn read_remote_head(
    repo: &Repository,
    url: &str,
    token: Option<&str>,
    branch: &str,
) -> Result<Option<Oid>, CreationError> {
    let target = branch_ref(branch)?;
    let _config = transport_config(repo)?;
    let mut remote = repo.remote_anonymous(url).map_err(transport_error)?;
    let mut connection = remote
        .connect_auth(
            Direction::Fetch,
            Some(callbacks(token)),
            Some(ProxyOptions::new()),
        )
        .map_err(transport_error)?;
    template::advertised_default(connection.remote(), &target)
}

fn is_same_or_descendant(
    repo: &Repository,
    candidate: Oid,
    ancestor: Oid,
) -> Result<bool, CreationError> {
    if candidate == ancestor {
        return Ok(true);
    }
    repo.graph_descendant_of(candidate, ancestor)
        .map_err(local_git::git_error)
}

fn check_active_branch(
    repo: &Repository,
    target: &str,
    confirmed: Oid,
    exact: bool,
) -> Result<(), CreationError> {
    let active = repo.head().map_err(local_git::git_error)?;
    let tip = active.target().ok_or_else(local_changed)?;
    if active.name().ok() != Some(target)
        || (tip != confirmed && (exact || !is_same_or_descendant(repo, tip, confirmed)?))
    {
        return Err(local_changed());
    }
    Ok(())
}

fn merge_using_first_tree(
    repo: &Repository,
    first: &Commit<'_>,
    second: &Commit<'_>,
    signature: &Signature<'_>,
    message: &str,
) -> Result<Oid, CreationError> {
    let tree = first.tree().map_err(local_git::git_error)?;
    repo.commit(None, signature, signature, message, &tree, &[first, second])
        .map_err(local_git::git_error)
}

fn backup_signature(repo: &Repository) -> Result<Signature<'static>, CreationError> {
    repo.signature()
        .or_else(|_| Signature::now("PNDS Creator", local_git::GIT_PLACEHOLDER_EMAIL))
        .map_err(local_git::git_error)
}

fn prepare_repository(
    repo: &Repository,
    (url, token): (&str, Option<&str>),
    branch: &str,
    local: Oid,
    remote: Oid,
    verify_owner: impl Fn() -> Result<(), CreationError>,
) -> Result<GithubTemplateCommit, CreationError> {
    let target = branch_ref(branch)?;
    let signature = backup_signature(repo)?;
    verify_owner()?;
    check_active_branch(repo, &target, local, true)?;

    // Fetch only the verified branch into the local object store. No configured
    // remotes, tracking refs or FETCH_HEAD are changed.
    let _config = transport_config(repo)?;
    let mut source = repo.remote_anonymous(url).map_err(transport_error)?;
    let mut connection = source
        .connect_auth(
            Direction::Fetch,
            Some(callbacks(token)),
            Some(ProxyOptions::new()),
        )
        .map_err(transport_error)?;
    if template::advertised_default(connection.remote(), &target)? != Some(remote) {
        return Err(remote_changed());
    }
    download_refs(connection.remote(), token, std::slice::from_ref(&target))?;

    let mut transaction = repo.transaction().map_err(local_git::git_error)?;
    transaction.lock_ref("HEAD").map_err(local_git::git_error)?;
    transaction
        .lock_ref(&target)
        .map_err(local_git::git_error)?;
    verify_owner()?;
    check_active_branch(repo, &target, local, true)?;
    let mut budget = native_git::GitReadBudget::default();
    let confirmed = budget.commit(repo, local)?;
    let initial = budget.commit(repo, remote)?;
    if initial.parent_count() != 0 || local == remote {
        return Err(remote_changed());
    }
    budget.tree(repo, confirmed.tree_id())?;
    let merge = merge_using_first_tree(repo, &confirmed, &initial, &signature, BACKUP_MESSAGE)?;
    Ok(GithubTemplateCommit {
        branch: branch.to_owned(),
        local_head: local.to_string(),
        remote_head: remote.to_string(),
        merge_head: merge.to_string(),
    })
}

fn pin_repository(
    repo: &Repository,
    plan: &GithubTemplateCommit,
    verify_owner: impl Fn() -> Result<(), CreationError>,
) -> Result<(), CreationError> {
    let target = branch_ref(&plan.branch)?;
    let id = parse_oid(&plan.merge_head)?;
    let pin = pin_name(id);
    let mut transaction = repo.transaction().map_err(local_git::git_error)?;
    transaction.lock_ref("HEAD").map_err(local_git::git_error)?;
    transaction
        .lock_ref(&target)
        .map_err(local_git::git_error)?;
    transaction.lock_ref(&pin).map_err(local_git::git_error)?;
    verify_owner()?;
    check_active_branch(repo, &target, parse_oid(&plan.local_head)?, true)?;
    let merge = checked_merge(repo, plan)?;
    transaction
        .set_target(&pin, id, Some(&merge.committer()), BACKUP_MESSAGE)
        .map_err(local_git::git_error)?;
    transaction.commit().map_err(local_git::git_error)
}

fn checked_merge<'a>(
    repo: &'a Repository,
    plan: &GithubTemplateCommit,
) -> Result<Commit<'a>, CreationError> {
    let id = parse_oid(&plan.merge_head)?;
    let local = parse_oid(&plan.local_head)?;
    let remote = parse_oid(&plan.remote_head)?;
    let mut budget = native_git::GitReadBudget::default();
    let confirmed = budget.commit(repo, local)?;
    let merge = budget.commit(repo, id)?;
    if !merge.parent_ids().eq([local, remote]) || merge.tree_id() != confirmed.tree_id() {
        return Err(conflict("The pending first backup commit changed."));
    }
    Ok(merge)
}

fn pinned_merge<'a>(
    repo: &'a Repository,
    plan: &GithubTemplateCommit,
) -> Result<Commit<'a>, CreationError> {
    let id = parse_oid(&plan.merge_head)?;
    if repo
        .find_reference(&pin_name(id))
        .ok()
        .and_then(|pin| pin.target())
        != Some(id)
    {
        return Err(conflict(
            "The pending first backup is unavailable in this project.",
        ));
    }
    checked_merge(repo, plan)
}

fn push_template_repository(
    repo: &Repository,
    (url, token): (&str, Option<&str>),
    plan: &GithubTemplateCommit,
    exact_local_head: bool,
    verify_owner: impl Fn() -> Result<(), CreationError>,
) -> Result<(), CreationError> {
    let target = branch_ref(&plan.branch)?;
    let confirmed = parse_oid(&plan.local_head)?;
    let previous = parse_oid(&plan.remote_head)?;
    let merge = pinned_merge(repo, plan)?.id();
    let check_head = || {
        verify_owner()?;
        check_active_branch(repo, &target, confirmed, exact_local_head)
    };
    check_head()?;
    if read_remote_head(repo, url, token, &plan.branch)? != Some(previous) {
        return Err(remote_changed());
    }
    push_commit(repo, url, token, &target, merge, Some(previous), check_head)
}

fn finish_repository(
    repo: &Repository,
    plan: &GithubTemplateCommit,
    verify_owner: impl Fn() -> Result<(), CreationError>,
) -> Result<GithubLocalGit, CreationError> {
    let target = branch_ref(&plan.branch)?;
    let confirmed = parse_oid(&plan.local_head)?;
    let merge = pinned_merge(repo, plan)?;
    let mut transaction = repo.transaction().map_err(local_git::git_error)?;
    transaction.lock_ref("HEAD").map_err(local_git::git_error)?;
    transaction
        .lock_ref(&target)
        .map_err(local_git::git_error)?;
    verify_owner()?;
    let tip = repo
        .find_reference(&target)
        .ok()
        .and_then(|branch| branch.target())
        .ok_or_else(local_changed)?;
    if !is_same_or_descendant(repo, tip, confirmed)? {
        return Err(local_changed());
    }
    let updated = if is_same_or_descendant(repo, tip, merge.id())? {
        tip
    } else {
        let signature = backup_signature(repo)?;
        let next = if tip == confirmed {
            merge.id()
        } else {
            let mut budget = native_git::GitReadBudget::default();
            let current = budget.commit(repo, tip)?;
            budget.tree(repo, current.tree_id())?;
            merge_using_first_tree(repo, &current, &merge, &signature, INTEGRATE_MESSAGE)?
        };
        // The target's tree is unchanged. Moving only the ref preserves the
        // worktree, the external index and any currently checked out branch.
        transaction
            .set_target(&target, next, Some(&signature), INTEGRATE_MESSAGE)
            .map_err(local_git::git_error)?;
        transaction.commit().map_err(local_git::git_error)?;
        next
    };
    Ok(GithubLocalGit {
        branch: Some(plan.branch.clone()),
        head: Some(updated.to_string()),
        origin: local_state(repo)?.origin,
    })
}

fn release_repository(
    repo: &Repository,
    plan: &GithubTemplateCommit,
    verify_owner: impl Fn() -> Result<(), CreationError>,
) -> Result<(), CreationError> {
    let id = parse_oid(&plan.merge_head)?;
    let pin = pin_name(id);
    let mut transaction = repo.transaction().map_err(local_git::git_error)?;
    transaction.lock_ref(&pin).map_err(local_git::git_error)?;
    verify_owner()?;
    match repo.find_reference(&pin) {
        Ok(reference) if reference.target() == Some(id) => {
            transaction.remove(&pin).map_err(local_git::git_error)?;
            transaction.commit().map_err(local_git::git_error)
        }
        Ok(_) => Err(conflict("The pending first backup reference changed.")),
        Err(error) if error.code() == ErrorCode::NotFound => Ok(()),
        Err(error) => Err(local_git::git_error(error)),
    }
}

#[cfg(test)]
#[path = "template_backup_tests.rs"]
mod tests;
