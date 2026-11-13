use super::*;

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GithubTemplateBackupPending {
    repository: GithubRepository,
    branch: String,
    pub(super) head: String,
}

#[derive(Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GithubTemplateBackupTarget {
    repository_id: String,
    full_name: String,
    branch: String,
    head: String,
    remote_head: String,
    private: bool,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GithubTemplateBackupPlan {
    token: String,
    repository: GithubRepository,
    branch: String,
    head: String,
    confirm_public: bool,
    resuming: bool,
}

#[derive(Serialize, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GithubPrepareTemplateBackupResult {
    Ready { plan: GithubTemplateBackupPlan },
    Completed { status: GithubSyncStatus },
}

pub(super) struct PreparedTemplateBackup {
    identity: String,
    key: String,
    account_id: String,
    plan: GithubTemplateBackupPlan,
    remote_head: String,
    expires: Instant,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct PendingTemplateBackup {
    pub(super) repository: GithubRepository,
    pub(super) account_id: String,
    pub(super) commit: GithubTemplateCommit,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum TemplateRemoteState {
    Waiting,
    Received,
    Conflict,
}

impl PendingTemplateBackup {
    pub(super) fn summary(&self) -> GithubTemplateBackupPending {
        GithubTemplateBackupPending {
            repository: self.repository.clone(),
            branch: self.commit.branch.clone(),
            head: self.commit.local_head.clone(),
        }
    }

    pub(super) fn remote_state(&self, head: Option<&str>) -> TemplateRemoteState {
        if head == Some(self.commit.remote_head.as_str()) {
            TemplateRemoteState::Waiting
        } else if head == Some(self.commit.merge_head.as_str()) {
            TemplateRemoteState::Received
        } else {
            TemplateRemoteState::Conflict
        }
    }
}

fn require_unbound(sync: &GithubSync, app: &AppHandle, project: &Project) -> Result<()> {
    if sync.binding(app, &project.key)?.is_some() {
        return Err(GithubError::Conflict);
    }
    Ok(())
}

pub(super) async fn access_target(
    app: &AppHandle,
    expected: &GithubRepository,
    account_id: &str,
) -> Result<(GithubRepository, GithubAccess)> {
    let auth = app.state::<GithubAuth>();
    let remote = authorized_remote(&auth, &expected.full_name, Some(account_id)).await?;
    let repository = remote.repository;
    if repository.id != expected.id || !repository.can_push {
        return Err(GithubError::AccessDenied);
    }
    if repository.default_branch != expected.default_branch
        || !repository
            .full_name
            .eq_ignore_ascii_case(&expected.full_name)
    {
        return Err(GithubError::Conflict);
    }
    let access = remote.access.ok_or(GithubError::AccessDenied)?;
    if !auth.official_template_source(&access, &repository).await? {
        return Err(GithubError::Conflict);
    }
    Ok((repository, access))
}

async fn remote_state(
    project: Project,
    repository: GithubRepository,
    access: GithubAccess,
    pending: PendingTemplateBackup,
) -> Result<(
    Project,
    GithubRepository,
    GithubAccess,
    PendingTemplateBackup,
    TemplateRemoteState,
)> {
    blocking(move || {
        let head = project
            .git
            .template_remote_head(&repository, access.token())
            .map_err(git_error)?;
        let state = pending.remote_state(head.as_deref());
        Ok((project, repository, access, pending, state))
    })
    .await
}

pub(super) async fn finish(
    app: &AppHandle,
    project: Project,
    repository: GithubRepository,
    pending: PendingTemplateBackup,
) -> Result<GithubSyncStatus> {
    let app = app.clone();
    let state = app.state::<CreationState>().access.clone();
    blocking(move || {
        let access = state.lock().map_err(|_| GithubError::Storage)?;
        let (key, git) = project_context(&access, &app, &project.identity)?;
        if key != project.key {
            return Err(GithubError::WorkspaceChanged);
        }
        let local = git
            .finish_template_backup(&pending.commit)
            .map_err(git_error)?;
        let sync = app.state::<GithubSync>();
        sync.database(&app, |data| {
            let binding = data.get_mut(&key).ok_or(GithubError::Conflict)?;
            if binding.template_pending.as_ref().is_none_or(|current| {
                current.commit.merge_head != pending.commit.merge_head
                    || current.repository.id != repository.id
            }) {
                return Err(GithubError::Conflict);
            }
            let remote_head = Some(pending.commit.merge_head.clone());
            let relation = if local.head == remote_head {
                GithubGitRelation::Equal
            } else {
                GithubGitRelation::Ahead
            };
            binding.repository = repository.clone();
            binding.public_confirmed = !pending.repository.private && !repository.private;
            binding.template_published = binding.public_confirmed;
            binding.template_pending = None;
            binding.observe(&GithubGitProbe {
                local,
                remote_head,
                remote_empty: false,
                shared_history: true,
                relation,
                ahead: 0,
                behind: 0,
            });
            Ok(((), true))
        })?;
        if let Err(error) = git.release_template_backup(&pending.commit) {
            log::warn!(
                "Could not remove the completed template backup ref: {:?}",
                error.code
            );
        }
        if let Err(error) = sync.release_upload(&app, &key) {
            log::warn!("Could not remove a completed initial upload intent: {error:?}");
        }
        sync.clear_issue(&key);
        cached_status(&sync, &app, &project_from(&project.identity, key, git)?)
    })
    .await
}

pub(super) async fn refresh_pending(
    sync: &GithubSync,
    app: &AppHandle,
    project: Project,
    pending: PendingTemplateBackup,
) -> Result<GithubSyncStatus> {
    let identity = project.identity.clone();
    let result = async {
        let (repository, access) =
            access_target(app, &pending.repository, &pending.account_id).await?;
        let (project, repository, _, pending, state) =
            remote_state(project, repository, access, pending).await?;
        match state {
            TemplateRemoteState::Received => {
                let mut status = finish(app, project, repository, pending).await?;
                status.template_backup_recovered = true;
                Ok(status)
            }
            TemplateRemoteState::Waiting => {
                still_current(app, &project).await?;
                let mut status = cached_status(sync, app, &project)?;
                if let Some(summary) = status.template_backup_pending.as_mut() {
                    summary.repository = repository;
                }
                // Keep a prior push rejection visible while the original
                // remote commit is still waiting for a successful retry.
                Ok(status)
            }
            TemplateRemoteState::Conflict => Err(GithubError::Conflict),
        }
    }
    .await;
    match result {
        Ok(status) => Ok(status),
        Err(error) => {
            let current = active_project(app, identity).await?;
            sync.record_issue(&current, error, None);
            cached_status(sync, app, &current)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn github_prepare_template_backup(
    app: AppHandle,
    identity: String,
    target: Option<GithubTemplateBackupTarget>,
) -> Result<GithubPrepareTemplateBackupResult> {
    let sync = app.state::<GithubSync>();
    let _operation = sync.operation.lock().await;
    *sync
        .template_plan
        .lock()
        .map_err(|_| GithubError::Storage)? = None;
    let project = active_project(&app, identity).await?;
    require_unbound(&sync, &app, &project)?;
    let pending = sync.pending_template(&app, &project.key)?;
    if pending.is_none() && sync.initial_upload(&app, &project.key)?.is_some() {
        return Err(GithubError::Conflict);
    }
    let resuming = target.is_none();
    let (project, account_id, repository, branch, head, remote_head) = match (target, pending) {
        (Some(target), None) => {
            if project.local.head.as_deref() != Some(&target.head)
                || project.local.branch.as_deref() != Some(&target.branch)
            {
                return Err(GithubError::ConfirmationExpired);
            }
            let (project, account_id, checked) =
                verify_template_backup(&app, project, &target.full_name, &target.repository_id)
                    .await?;
            if !matches!(&checked.verification, GithubTemplateVerification::Ready { remote_head, .. }
                if remote_head == &target.remote_head)
                || checked.repository.default_branch != target.branch
                || checked.repository.private != target.private
            {
                return Err(GithubError::ConfirmationExpired);
            }
            (
                project,
                account_id,
                checked.repository,
                target.branch,
                target.head,
                target.remote_head,
            )
        }
        (None, Some(pending)) => {
            let (repository, access) =
                access_target(&app, &pending.repository, &pending.account_id).await?;
            let (project, repository, _, pending, state) =
                remote_state(project, repository, access, pending).await?;
            match state {
                TemplateRemoteState::Received => {
                    return Ok(GithubPrepareTemplateBackupResult::Completed {
                        status: finish(&app, project, repository, pending).await?,
                    });
                }
                TemplateRemoteState::Conflict => return Err(GithubError::Conflict),
                TemplateRemoteState::Waiting => {}
            }
            still_current(&app, &project).await?;
            if project.local.branch.as_deref() != Some(&pending.commit.branch) {
                return Err(GithubError::WorkspaceChanged);
            }
            (
                project,
                pending.account_id,
                repository,
                pending.commit.branch,
                pending.commit.local_head,
                pending.commit.remote_head,
            )
        }
        _ => return Err(GithubError::Conflict),
    };
    let plan = GithubTemplateBackupPlan {
        token: format!("{:x}", sync.sequence.fetch_add(1, Ordering::Relaxed)),
        confirm_public: !repository.private,
        repository,
        branch,
        head,
        resuming,
    };
    *sync
        .template_plan
        .lock()
        .map_err(|_| GithubError::Storage)? = Some(PreparedTemplateBackup {
        identity: project.identity,
        key: project.key,
        account_id,
        plan: plan.clone(),
        remote_head,
        expires: Instant::now() + Duration::from_secs(300),
    });
    Ok(GithubPrepareTemplateBackupResult::Ready { plan })
}

pub(super) async fn persist_pending(
    app: &AppHandle,
    project: Project,
    pending: PendingTemplateBackup,
    exact_local_head: bool,
) -> Result<(Project, PendingTemplateBackup)> {
    let app = app.clone();
    let state = app.state::<CreationState>().access.clone();
    blocking(move || {
        let access = state.lock().map_err(|_| GithubError::Storage)?;
        let (key, git) = project_context(&access, &app, &project.identity)?;
        let current = git.local().map_err(git_error)?;
        if key != project.key
            || current.branch.as_deref() != Some(&pending.commit.branch)
            || (exact_local_head && current.head.as_deref() != Some(&pending.commit.local_head))
        {
            return Err(GithubError::ConfirmationExpired);
        }
        if exact_local_head {
            git.pin_template_backup(&pending.commit)
                .map_err(git_error)?;
        }
        app.state::<GithubSync>().database(&app, |data| {
            use std::collections::btree_map::Entry;
            let binding = match data.entry(key) {
                Entry::Vacant(entry) if exact_local_head => entry.insert(Binding::new(
                    pending.repository.clone(),
                    Some(pending.account_id.clone()),
                )),
                Entry::Occupied(entry)
                    if !exact_local_head
                        && entry
                            .get()
                            .template_pending
                            .as_ref()
                            .is_some_and(|current| {
                                current.commit == pending.commit
                                    && current.repository.id == pending.repository.id
                                    && current.account_id == pending.account_id
                            }) =>
                {
                    entry.into_mut()
                }
                _ => return Err(GithubError::Conflict),
            };
            binding.repository = pending.repository.clone();
            binding.template_pending = Some(pending.clone());
            Ok(((), true))
        })?;
        Ok((project, pending))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn github_push_template_backup(
    app: AppHandle,
    identity: String,
    token: String,
) -> Result<GithubSyncStatus> {
    let sync = app.state::<GithubSync>();
    let _operation = sync.operation.lock().await;
    let prepared = sync
        .template_plan
        .lock()
        .map_err(|_| GithubError::Storage)?
        .take()
        .filter(|prepared| {
            prepared.identity == identity
                && prepared.plan.token == token
                && prepared.expires > Instant::now()
        })
        .ok_or(GithubError::ConfirmationExpired)?;
    let project = active_project(&app, identity).await?;
    require_unbound(&sync, &app, &project)?;
    let plan = prepared.plan;
    if project.key != prepared.key
        || project.local.branch.as_deref() != Some(&plan.branch)
        || (!plan.resuming && project.local.head.as_deref() != Some(&plan.head))
    {
        return Err(GithubError::ConfirmationExpired);
    }
    let (repository, access) = access_target(&app, &plan.repository, &prepared.account_id).await?;
    let pending = sync.pending_template(&app, &project.key)?;
    let (project, repository, mut pending) = match (plan.resuming, pending) {
        (true, Some(pending)) => {
            if pending.commit.local_head != plan.head
                || pending.commit.remote_head != prepared.remote_head
            {
                return Err(GithubError::ConfirmationExpired);
            }
            let (project, repository, _, pending, state) =
                remote_state(project, repository, access, pending).await?;
            match state {
                TemplateRemoteState::Received => {
                    return finish(&app, project, repository, pending).await
                }
                TemplateRemoteState::Conflict => return Err(GithubError::Conflict),
                TemplateRemoteState::Waiting => {}
            }
            (project, repository, pending)
        }
        (false, None) => {
            if repository.private != plan.repository.private {
                return Err(GithubError::ConfirmationExpired);
            }
            let target = repository.clone();
            blocking(move || {
                let commit = project
                    .git
                    .prepare_template_backup(
                        &target,
                        access.token(),
                        &plan.head,
                        &prepared.remote_head,
                    )
                    .map_err(git_error)?;
                let pending = PendingTemplateBackup {
                    repository: target,
                    account_id: prepared.account_id,
                    commit,
                };
                Ok((project, repository, pending))
            })
            .await?
        }
        _ => return Err(GithubError::ConfirmationExpired),
    };
    // A refresh here covers visibility or authorization changes during the
    // fetch. The Git push separately guards the exact advertised branch tip.
    let (repository, access) = access_target(&app, &repository, &pending.account_id).await?;
    if repository.private != plan.repository.private {
        return Err(GithubError::ConfirmationExpired);
    }
    pending.repository = repository.clone();
    let exact_local_head = !plan.resuming;
    let (project, pending) = persist_pending(&app, project, pending, exact_local_head).await?;
    let owner = project.identity.clone();
    let sent = blocking(move || {
        project
            .git
            .push_template_backup(
                &repository,
                access.token(),
                &pending.commit,
                exact_local_head,
            )
            .map_err(git_error)?;
        Ok((project, repository, pending))
    })
    .await;
    let result = match sent {
        Ok((project, repository, pending)) => finish(&app, project, repository, pending).await,
        Err(error) => Err(error),
    };
    if let Err(error) = result {
        if let Ok(current) = active_project(&app, owner).await {
            sync.record_issue(&current, error, None);
        }
    }
    result
}
