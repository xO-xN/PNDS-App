//! GitHub bindings, status snapshots and pending backups are owned by the native workspace.
use super::creation::{assistant_task_data, protection, CreationState};
use crate::github_auth::{GithubAccess, GithubAuth, GithubError, GithubRepository};
use crate::project::creation::github_git::{
    clone_github_project, GithubGitContext, GithubGitProbe, GithubGitRelation, GithubLocalGit,
    GithubTemplateCommit, GithubTemplateVerification,
};
use crate::project::creation::{
    CreationAccess, CreationError, CreationErrorCode, GitRecordReceipt,
};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

type Result<T> = std::result::Result<T, GithubError>;

pub(crate) mod initial_upload;
pub(crate) mod template_backup;
use template_backup::{GithubTemplateBackupPending, PendingTemplateBackup, PreparedTemplateBackup};

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub enum GithubSyncRelation {
    Unchecked,
    Equal,
    Ahead,
    Behind,
    Diverged,
    NewBranch,
    DeletedBranch,
    Detached,
    Unborn,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GithubSyncStatus {
    supported: bool,
    template_backup_eligible: bool,
    template_backup_pending: Option<GithubTemplateBackupPending>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    initial_upload_pending: Option<Box<initial_upload::GithubInitialUploadSummary>>,
    template_backup_published: bool,
    template_backup_recovered: bool,
    branch: Option<String>,
    head: Option<String>,
    origin: Option<String>,
    repository: Option<GithubRepository>,
    account_id: Option<String>,
    auto_backup: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    #[specta(optional)]
    auto_backup_paused: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    #[specta(optional)]
    first_backup_confirmed: bool,
    pending: bool,
    relation: GithubSyncRelation,
    remote_head: Option<String>,
    stale: bool,
    issue: Option<GithubError>,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GithubPushPlan {
    token: String,
    repository: GithubRepository,
    branch: String,
    head: String,
    confirm_public: bool,
    confirm_recreate: bool,
}

#[derive(Serialize, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GithubPreparePushResult {
    AlreadySynced { status: GithubSyncStatus },
    Ready { plan: GithubPushPlan },
}

#[derive(Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GithubUpdateTarget {
    repository_id: String,
    branch: String,
    head: String,
    remote_head: String,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GithubCloneResult {
    path: String,
    warning: Option<GithubError>,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GithubTemplateBackupCheck {
    repository: GithubRepository,
    verification: GithubTemplateVerification,
}

#[derive(Clone, Serialize, Deserialize)]
struct Observation {
    local_head: Option<String>,
    remote_head: Option<String>,
    relation: GithubSyncRelation,
}

#[derive(Default, Serialize, Deserialize)]
struct Branch {
    pending: Option<String>,
    known_remote: bool,
    observation: Option<Observation>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    first_backup_confirmed: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    public_confirmed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    automatic: Option<AutomaticBackup>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum AutomaticBackup {
    Disabled,
    Enabled { private: bool },
    Paused,
}

#[derive(Serialize, Deserialize)]
struct Binding {
    repository: GithubRepository,
    account_id: Option<String>,
    // Legacy project-wide opt-in only records migration state. It never
    // authorizes a push. New choices live on each individual branch.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    auto_backup: bool,
    branches: BTreeMap<String, Branch>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    template_pending: Option<PendingTemplateBackup>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    template_published: bool,
}

impl Binding {
    fn new(repository: GithubRepository, account_id: Option<String>) -> Self {
        Self {
            repository,
            account_id,
            auto_backup: false,
            branches: BTreeMap::new(),
            template_pending: None,
            template_published: false,
        }
    }

    fn automatic_status(&self, branch: Option<&str>) -> (bool, bool, bool) {
        let Some(branch) = branch else {
            return (false, false, false);
        };
        let entry = self.branches.get(branch);
        let first = entry.is_some_and(|entry| entry.first_backup_confirmed);
        let (enabled, paused) = match entry.and_then(|entry| entry.automatic.as_ref()) {
            Some(AutomaticBackup::Enabled { private }) => (
                *private == self.repository.private && self.repository.can_push,
                *private != self.repository.private || !self.repository.can_push,
            ),
            Some(AutomaticBackup::Paused) => (false, true),
            Some(AutomaticBackup::Disabled) => (false, false),
            None => (false, self.auto_backup && entry.is_some()),
        };
        (enabled, paused, first)
    }

    fn enqueue(&mut self, branch: &str, commit: &str) -> bool {
        let Some(entry) = self.branches.get_mut(branch) else {
            return false;
        };
        if self.account_id.is_none()
            || !matches!(
                entry.automatic,
                Some(AutomaticBackup::Enabled { private }) if private == self.repository.private
            )
        {
            return false;
        }
        entry.pending = Some(commit.to_owned());
        true
    }

    fn set_auto_backup(&mut self, branch: &str, enabled: bool) -> Result<()> {
        let entry = self.branches.entry(branch.to_owned()).or_default();
        entry.automatic = Some(if enabled {
            if !entry.first_backup_confirmed
                || self.account_id.is_none()
                || !self.repository.can_push
            {
                return Err(GithubError::ConfirmationRequired);
            }
            entry.public_confirmed = !self.repository.private;
            AutomaticBackup::Enabled {
                private: self.repository.private,
            }
        } else {
            entry.pending = None;
            AutomaticBackup::Disabled
        });
        Ok(())
    }

    fn confirm_first_backup(&mut self, branch: &str, public_confirmed: bool) {
        let entry = self.branches.entry(branch.to_owned()).or_default();
        entry.first_backup_confirmed = true;
        entry.public_confirmed |= public_confirmed;
    }

    fn pause_automatic_backup(&mut self, branch: &str) {
        if let Some(entry) = self.branches.get_mut(branch) {
            if matches!(entry.automatic, Some(AutomaticBackup::Enabled { .. })) {
                entry.automatic = Some(AutomaticBackup::Paused);
            }
        }
    }

    fn observe_repository(&mut self, remote: &Remote) {
        if self.repository.private != remote.repository.private {
            for entry in self.branches.values_mut() {
                entry.public_confirmed = false;
                if matches!(entry.automatic, Some(AutomaticBackup::Enabled { .. })) {
                    entry.automatic = Some(AutomaticBackup::Paused);
                }
            }
        }
        self.repository = remote.repository.clone();
        if self.account_id.is_none() {
            self.account_id = remote.account_id().map(str::to_owned);
        }
    }

    fn observe(&mut self, probe: &GithubGitProbe) {
        let Some(branch) = &probe.local.branch else {
            return;
        };
        let entry = self.branches.entry(branch.clone()).or_default();
        entry.known_remote |= probe.remote_head.is_some();
        entry.observation = Some(Observation {
            local_head: probe.local.head.clone(),
            remote_head: probe.remote_head.clone(),
            relation: relation(probe, entry.known_remote),
        });
        if matches!(
            probe.relation,
            GithubGitRelation::Equal | GithubGitRelation::Behind
        ) && entry.pending == probe.local.head
        {
            entry.pending = None;
        }
    }

    fn confirms(&self, probe: &GithubGitProbe) -> (bool, bool) {
        let known = probe
            .local
            .branch
            .as_ref()
            .and_then(|name| self.branches.get(name));
        (
            !self.repository.private && !known.is_some_and(|entry| entry.public_confirmed),
            probe.remote_head.is_none() && known.is_some_and(|entry| entry.known_remote),
        )
    }

    fn pending_head(&self, local: &GithubLocalGit) -> Option<&str> {
        self.account_id.as_ref()?;
        let entry = self.branches.get(local.branch.as_deref()?)?;
        match entry.automatic {
            Some(AutomaticBackup::Enabled { private }) if private == self.repository.private => {
                entry.pending.as_deref()
            }
            _ => None,
        }
    }

    fn record_push(&mut self, probe: &GithubGitProbe, pending_before: Option<&str>) {
        let Some(branch) = &probe.local.branch else {
            return;
        };
        let entry = self.branches.entry(branch.clone()).or_default();
        entry.known_remote = true;
        entry.first_backup_confirmed = true;
        entry.public_confirmed |= !self.repository.private;
        entry.observation = Some(Observation {
            local_head: probe.local.head.clone(),
            remote_head: probe.local.head.clone(),
            relation: GithubSyncRelation::Equal,
        });
        if entry.pending.as_deref() == pending_before {
            entry.pending = None;
        }
    }
}

#[derive(Default)]
pub struct GithubSync {
    disk: Mutex<()>,
    pub(crate) operation: tokio::sync::Mutex<()>,
    push_plan: Mutex<Option<PreparedPush>>,
    template_plan: Mutex<Option<PreparedTemplateBackup>>,
    initial_upload_plan: Mutex<Option<initial_upload::PreparedInitialUpload>>,
    sequence: AtomicU64,
    wake: tokio::sync::Notify,
    issue: Mutex<Option<ScopedIssue>>,
}

struct PreparedPush {
    identity: String,
    key: String,
    account_id: String,
    plan: GithubPushPlan,
    remote_head: Option<String>,
    expires: Instant,
}

struct ScopedIssue {
    key: String,
    branch: Option<String>,
    error: GithubError,
    // Permanent failures wait for a fresh save, a refresh, or workspace reopen.
    blocked: Option<(String, String)>,
}

struct Project {
    identity: String,
    key: String,
    git: GithubGitContext,
    local: GithubLocalGit,
}

impl Project {
    fn template_backup_eligible(&self) -> Result<bool> {
        match self.local.head.as_deref() {
            Some(head) => self.git.can_verify_template(head).map_err(git_error),
            None => Ok(false),
        }
    }
}

struct Remote {
    repository: GithubRepository,
    access: Option<GithubAccess>,
}

impl Remote {
    fn account_id(&self) -> Option<&str> {
        self.access
            .as_ref()
            .map(|access| access.account.id.as_str())
    }
}

impl GithubSync {
    fn database<T>(
        &self,
        app: &AppHandle,
        action: impl FnOnce(&mut BTreeMap<String, Binding>) -> Result<(T, bool)>,
    ) -> Result<T> {
        self.storage(app, "creator-github.json", action)
    }

    fn storage<D: Default + Serialize + serde::de::DeserializeOwned, T>(
        &self,
        app: &AppHandle,
        filename: &str,
        action: impl FnOnce(&mut D) -> Result<(T, bool)>,
    ) -> Result<T> {
        let path = app
            .path()
            .app_data_dir()
            .map_err(|_| GithubError::Storage)?;
        let _lock = self.disk.lock().map_err(|_| GithubError::Storage)?;
        let file = path.join(filename);
        let mut data = read_sync_data(&file)?;
        let (output, changed) = action(&mut data)?;
        if changed {
            write_sync_data(&file, &data)?;
        }
        Ok(output)
    }

    fn binding(&self, app: &AppHandle, key: &str) -> Result<Option<Binding>> {
        self.database(app, |data| {
            Ok((
                data.remove(key)
                    .filter(|binding| binding.template_pending.is_none()),
                false,
            ))
        })
    }

    fn pending_template(
        &self,
        app: &AppHandle,
        key: &str,
    ) -> Result<Option<PendingTemplateBackup>> {
        self.database(app, |data| {
            Ok((
                data.remove(key)
                    .and_then(|binding| binding.template_pending),
                false,
            ))
        })
    }

    fn modify_binding<T>(
        &self,
        app: &AppHandle,
        key: &str,
        repository_id: &str,
        action: impl FnOnce(&mut Binding) -> Result<T>,
    ) -> Result<T> {
        self.database(app, |data| {
            let binding = data
                .get_mut(key)
                .filter(|binding| binding.template_pending.is_none())
                .ok_or(GithubError::Conflict)?;
            if binding.repository.id != repository_id {
                return Err(GithubError::Conflict);
            }
            Ok((action(binding)?, true))
        })
    }

    fn clear_issue(&self, key: &str) {
        if let Ok(mut slot) = self.issue.lock() {
            if slot.as_ref().is_some_and(|issue| issue.key == key) {
                *slot = None;
            }
        }
    }

    fn record_issue(&self, project: &Project, error: GithubError, block_head: Option<&str>) {
        if let Ok(mut slot) = self.issue.lock() {
            *slot = Some(ScopedIssue {
                key: project.key.clone(),
                branch: project.local.branch.clone(),
                error,
                blocked: block_head.map(|head| (project.identity.clone(), head.to_owned())),
            });
        }
    }
}

#[cfg(test)]
fn read_bindings(path: &Path) -> Result<BTreeMap<String, Binding>> {
    read_sync_data(path)
}

fn read_sync_data<D: Default + serde::de::DeserializeOwned>(path: &Path) -> Result<D> {
    match File::open(path) {
        Ok(file) => serde_json::from_reader(file).map_err(|_| GithubError::Storage),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(D::default()),
        Err(_) => Err(GithubError::Storage),
    }
}

#[cfg(test)]
fn write_bindings(path: &Path, data: &BTreeMap<String, Binding>) -> Result<()> {
    write_sync_data(path, data)
}

fn write_sync_data(path: &Path, data: &impl Serialize) -> Result<()> {
    let directory = path.parent().ok_or(GithubError::Storage)?;
    fs::create_dir_all(directory).map_err(|_| GithubError::Storage)?;
    let mut staged =
        tempfile::NamedTempFile::new_in(directory).map_err(|_| GithubError::Storage)?;
    serde_json::to_writer(&mut staged, data).map_err(|_| GithubError::Storage)?;
    staged
        .as_file()
        .sync_all()
        .map_err(|_| GithubError::Storage)?;
    staged.persist(path).map_err(|_| GithubError::Storage)?;
    File::open(directory)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| GithubError::Storage)?;
    Ok(())
}

fn git_error(error: CreationError) -> GithubError {
    match error.code {
        CreationErrorCode::GitHubNetwork => GithubError::Network,
        CreationErrorCode::InvalidIdentity => GithubError::WorkspaceChanged,
        CreationErrorCode::VersionConflict => GithubError::Conflict,
        CreationErrorCode::Permission => GithubError::AccessDenied,
        CreationErrorCode::TargetExists => GithubError::TargetExists,
        CreationErrorCode::Io => GithubError::Storage,
        _ => GithubError::Unsupported,
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| GithubError::Storage)?
}

fn project_key(root: &Path, directory_key: &str) -> String {
    format!("{directory_key}\n{}", root.display())
}

fn project_context(
    access: &CreationAccess,
    app: &AppHandle,
    identity: &str,
) -> Result<(String, GithubGitContext)> {
    let git = access
        .github_context(identity, &protection(app).map_err(git_error)?)
        .map_err(git_error)?;
    let key = project_key(git.root(), &git.directory_key().map_err(git_error)?);
    Ok((key, git))
}

fn project_from(identity: &str, key: String, git: GithubGitContext) -> Result<Project> {
    let local = git.local().map_err(git_error)?;
    Ok(Project {
        identity: identity.to_owned(),
        key,
        git,
        local,
    })
}

async fn active_project(app: &AppHandle, identity: String) -> Result<Project> {
    let state = app.state::<CreationState>().access.clone();
    let app = app.clone();
    blocking(move || {
        let access = state.lock().map_err(|_| GithubError::Storage)?;
        let (key, git) = project_context(&access, &app, &identity)?;
        project_from(&identity, key, git)
    })
    .await
}

async fn pending_project(app: &AppHandle) -> Result<Option<(Project, Binding)>> {
    let app = app.clone();
    let state = app.state::<CreationState>().access.clone();
    blocking(move || {
        let access = state.lock().map_err(|_| GithubError::Storage)?;
        let Some(identity) = access.github_active_identity() else {
            return Ok(None);
        };
        let Ok((key, git)) = project_context(&access, &app, identity) else {
            return Ok(None);
        };
        let binding = app.state::<GithubSync>().binding(&app, &key)?;
        let Some(binding) = binding else {
            return Ok(None);
        };
        let project = project_from(identity, key, git)?;
        Ok(binding
            .pending_head(&project.local)
            .is_some()
            .then_some((project, binding)))
    })
    .await
}

fn relation(probe: &GithubGitProbe, known_remote: bool) -> GithubSyncRelation {
    match probe.relation {
        GithubGitRelation::NoLocalBranch if probe.local.head.is_some() => {
            GithubSyncRelation::Detached
        }
        GithubGitRelation::NoLocalBranch => GithubSyncRelation::Unborn,
        GithubGitRelation::Equal => GithubSyncRelation::Equal,
        GithubGitRelation::Ahead => GithubSyncRelation::Ahead,
        GithubGitRelation::Behind => GithubSyncRelation::Behind,
        GithubGitRelation::Diverged => GithubSyncRelation::Diverged,
        GithubGitRelation::NewBranch if known_remote => GithubSyncRelation::DeletedBranch,
        GithubGitRelation::NewBranch => GithubSyncRelation::NewBranch,
    }
}

fn cached_status(
    sync: &GithubSync,
    app: &AppHandle,
    project: &Project,
) -> Result<GithubSyncStatus> {
    let (binding, pending) = sync.database(app, |data| {
        let (binding, pending) = match data.remove(&project.key) {
            Some(binding) if binding.template_pending.is_some() => (None, binding.template_pending),
            binding => (binding, None),
        };
        Ok(((binding, pending), false))
    })?;
    let account_id = binding
        .as_ref()
        .and_then(|binding| binding.account_id.clone())
        .or_else(|| pending.as_ref().map(|pending| pending.account_id.clone()));
    let entry = binding
        .as_ref()
        .and_then(|item| item.branches.get(project.local.branch.as_ref()?));
    let observation = entry.and_then(|entry| entry.observation.as_ref());
    let issue = sync
        .issue
        .lock()
        .map_err(|_| GithubError::Storage)?
        .as_ref()
        .filter(|issue| issue.key == project.key && issue.branch == project.local.branch)
        .map(|issue| issue.error);
    let unavailable = issue.is_some_and(|error| {
        !matches!(
            error,
            GithubError::Conflict | GithubError::ConfirmationRequired
        )
    });
    let stale = binding.is_some()
        && (unavailable || observation.is_none_or(|value| value.local_head != project.local.head));
    let relation = match (&project.local.branch, &project.local.head, observation) {
        (_, None, _) => GithubSyncRelation::Unborn,
        (None, Some(_), _) => GithubSyncRelation::Detached,
        (_, _, Some(value)) if value.local_head == project.local.head || unavailable => {
            value.relation
        }
        _ => GithubSyncRelation::Unchecked,
    };
    let (auto_backup, auto_backup_paused, first_backup_confirmed) = binding
        .as_ref()
        .map(|binding| binding.automatic_status(project.local.branch.as_deref()))
        .unwrap_or_default();
    Ok(GithubSyncStatus {
        supported: true,
        template_backup_eligible: false,
        template_backup_recovered: false,
        initial_upload_pending: if binding.is_none() && pending.is_none() {
            sync.initial_upload(app, &project.key)?
                .map(|pending| Box::new(pending.summary()))
        } else {
            None
        },
        template_backup_pending: pending.map(|pending| pending.summary()),
        template_backup_published: binding
            .as_ref()
            .is_some_and(|binding| binding.template_published && !binding.repository.private),
        branch: project.local.branch.clone(),
        head: project.local.head.clone(),
        origin: project.local.origin.clone(),
        auto_backup,
        auto_backup_paused,
        first_backup_confirmed,
        pending: entry.is_some_and(|entry| entry.pending.is_some()),
        remote_head: observation.and_then(|value| value.remote_head.clone()),
        relation,
        stale,
        issue,
        account_id,
        repository: binding.map(|item| item.repository),
    })
}

async fn status_with_template_backup_eligibility(
    sync: &GithubSync,
    app: &AppHandle,
    project: Project,
) -> Result<GithubSyncStatus> {
    let mut status = cached_status(sync, app, &project)?;
    if status.repository.is_none()
        && status.template_backup_pending.is_none()
        && status.initial_upload_pending.is_none()
    {
        status.template_backup_eligible = blocking(move || project.template_backup_eligible())
            .await
            .unwrap_or(false);
    }
    Ok(status)
}

async fn authorized_remote(
    auth: &GithubAuth,
    full_name: &str,
    account_id: Option<&str>,
) -> Result<Remote> {
    let access = auth.access().await?;
    if account_id.is_some_and(|id| access.account.id != id) {
        return Err(GithubError::AccessDenied);
    }
    let repository = auth.authorized_repository(&access, full_name).await?;
    Ok(Remote {
        repository,
        access: Some(access),
    })
}

fn completed_status(
    local: &GithubLocalGit,
    remote: &Remote,
    binding: &Binding,
    pending: bool,
    issue: GithubError,
) -> GithubSyncStatus {
    let (auto_backup, auto_backup_paused, first_backup_confirmed) =
        binding.automatic_status(local.branch.as_deref());
    GithubSyncStatus {
        supported: true,
        template_backup_eligible: false,
        template_backup_recovered: false,
        template_backup_pending: None,
        initial_upload_pending: None,
        template_backup_published: binding.template_published && !remote.repository.private,
        branch: local.branch.clone(),
        head: local.head.clone(),
        origin: local.origin.clone(),
        repository: Some(remote.repository.clone()),
        account_id: remote
            .account_id()
            .map(str::to_owned)
            .or_else(|| binding.account_id.clone()),
        auto_backup,
        auto_backup_paused,
        first_backup_confirmed,
        pending,
        relation: GithubSyncRelation::Equal,
        remote_head: local.head.clone(),
        stale: true,
        issue: Some(issue),
    }
}

async fn public_remote(auth: &GithubAuth, full_name: &str) -> Result<Remote> {
    Ok(Remote {
        repository: auth.public_repository(full_name).await?,
        access: None,
    })
}

async fn remote_for(app: &AppHandle, binding: &Binding, writing: bool) -> Result<Remote> {
    let auth = app.state::<GithubAuth>();
    let name = &binding.repository.full_name;
    let authorized = authorized_remote(&auth, name, binding.account_id.as_deref()).await;
    let remote = match authorized {
        Ok(remote) => remote,
        Err(
            GithubError::Disconnected
            | GithubError::NotConfigured
            | GithubError::AccessDenied
            | GithubError::RepositoryUnavailable,
        ) if !writing && !binding.repository.private => public_remote(&auth, name).await?,
        Err(error) => return Err(error),
    };
    if remote.repository.id != binding.repository.id || (writing && !remote.repository.can_push) {
        return Err(GithubError::AccessDenied);
    }
    Ok(remote)
}

async fn probe(
    project: Project,
    remote: Remote,
    shared: bool,
) -> Result<(Project, Remote, GithubGitProbe)> {
    blocking(move || {
        let snapshot = project
            .git
            .probe(
                &remote.repository.full_name,
                remote.access.as_ref().map(GithubAccess::token),
                shared,
            )
            .map_err(git_error)?;
        if project.local.branch != snapshot.local.branch
            || project.local.head != snapshot.local.head
        {
            return Err(GithubError::WorkspaceChanged);
        }
        Ok((project, remote, snapshot))
    })
    .await
}

async fn still_current(app: &AppHandle, project: &Project) -> Result<()> {
    let current = active_project(app, project.identity.clone()).await?;
    if current.key != project.key
        || current.local.branch != project.local.branch
        || current.local.head != project.local.head
    {
        return Err(GithubError::WorkspaceChanged);
    }
    Ok(())
}

fn observe(
    sync: &GithubSync,
    app: &AppHandle,
    project: &Project,
    remote: &Remote,
    snapshot: &GithubGitProbe,
) -> Result<()> {
    sync.modify_binding(app, &project.key, &remote.repository.id, |binding| {
        binding.observe_repository(remote);
        binding.observe(snapshot);
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub async fn github_sync_status(
    app: AppHandle,
    identity: String,
    refresh: bool,
) -> Result<GithubSyncStatus> {
    let sync = app.state::<GithubSync>();
    let project = match active_project(&app, identity.clone()).await {
        Ok(project) => project,
        Err(GithubError::Unsupported | GithubError::AccessDenied) => {
            return Ok(GithubSyncStatus {
                supported: false,
                template_backup_eligible: false,
                template_backup_recovered: false,
                template_backup_pending: None,
                initial_upload_pending: None,
                template_backup_published: false,
                branch: None,
                head: None,
                origin: None,
                repository: None,
                account_id: None,
                auto_backup: false,
                auto_backup_paused: false,
                first_backup_confirmed: false,
                pending: false,
                relation: GithubSyncRelation::Unchecked,
                remote_head: None,
                stale: false,
                issue: None,
            })
        }
        Err(error) => return Err(error),
    };
    if !refresh {
        return status_with_template_backup_eligibility(&sync, &app, project).await;
    }
    let _operation = sync.operation.lock().await;
    let project = active_project(&app, identity.clone()).await?;
    if let Some(pending) = sync.pending_template(&app, &project.key)? {
        return template_backup::refresh_pending(&sync, &app, project, pending).await;
    }
    let Some(binding) = sync.binding(&app, &project.key)? else {
        return status_with_template_backup_eligibility(&sync, &app, project).await;
    };
    let original = project.local.clone();
    let refreshed = async {
        let remote = remote_for(&app, &binding, false).await?;
        let (project, remote, snapshot) = probe(project, remote, false).await?;
        still_current(&app, &project).await?;
        observe(&sync, &app, &project, &remote, &snapshot)?;
        Ok(project)
    }
    .await;
    match refreshed {
        Ok(project) => {
            sync.clear_issue(&project.key);
            sync.wake.notify_one();
            cached_status(&sync, &app, &project)
        }
        Err(error) => {
            let current = active_project(&app, identity).await?;
            if current.local.branch == original.branch && current.local.head == original.head {
                sync.record_issue(&current, error, None);
            }
            cached_status(&sync, &app, &current)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn github_verify_template_backup(
    app: AppHandle,
    identity: String,
    full_name: String,
    expected_repository_id: String,
) -> Result<GithubTemplateBackupCheck> {
    let sync = app.state::<GithubSync>();
    let _operation = sync.operation.lock().await;
    let project = active_project(&app, identity).await?;
    if sync.binding(&app, &project.key)?.is_some()
        || sync.pending_template(&app, &project.key)?.is_some()
        || sync.initial_upload(&app, &project.key)?.is_some()
    {
        return Err(GithubError::Conflict);
    }
    let (_, _, result) =
        verify_template_backup(&app, project, &full_name, &expected_repository_id).await?;
    Ok(result)
}

async fn verify_template_backup(
    app: &AppHandle,
    project: Project,
    full_name: &str,
    expected_repository_id: &str,
) -> Result<(Project, String, GithubTemplateBackupCheck)> {
    verify_template_version(app, project, full_name, expected_repository_id, None).await
}

async fn verify_template_version(
    app: &AppHandle,
    project: Project,
    full_name: &str,
    expected_repository_id: &str,
    resume: Option<&initial_upload::InitialUpload>,
) -> Result<(Project, String, GithubTemplateBackupCheck)> {
    let branch = resume
        .map(|intent| &intent.branch)
        .or(project.local.branch.as_ref())
        .cloned();
    let head = resume
        .map(|intent| &intent.head)
        .or(project.local.head.as_ref())
        .cloned();
    let project = blocking(move || {
        let eligible = head
            .as_deref()
            .map(|head| project.git.can_verify_template(head))
            .transpose()
            .map_err(git_error)?;
        if eligible != Some(true) {
            return Err(GithubError::Unsupported);
        }
        Ok(project)
    })
    .await?;

    let auth = app.state::<GithubAuth>();
    let remote = authorized_remote(
        &auth,
        full_name,
        resume.map(initial_upload::InitialUpload::account_id),
    )
    .await?;
    let repository = remote.repository;
    if repository.id != expected_repository_id || !repository.can_push {
        return Err(GithubError::AccessDenied);
    }
    let access = remote.access.ok_or(GithubError::AccessDenied)?;
    let account_id = access.account.id.clone();
    let (project, verification) = if auth.official_template_source(&access, &repository).await? {
        let target = repository.clone();
        let (project, access, verification) = blocking(move || {
            let verification = project
                .git
                .verify_template(&target, access.token(), branch.as_deref())
                .map_err(git_error)?;
            Ok((project, access, verification))
        })
        .await?;
        if matches!(verification, GithubTemplateVerification::Ready { .. }) {
            let latest = auth
                .authorized_repository(&access, &repository.full_name)
                .await?;
            if !latest.can_push || latest.id != repository.id {
                return Err(GithubError::AccessDenied);
            }
            if latest != repository || !auth.official_template_source(&access, &repository).await? {
                return Err(GithubError::Conflict);
            }
        }
        (project, verification)
    } else {
        (project, GithubTemplateVerification::NotOfficialTemplate)
    };
    if let Some(intent) = resume {
        template_backup::still_current_template_version(
            app,
            &project,
            &intent.branch,
            &intent.head,
            true,
        )
        .await?;
    } else {
        still_current(app, &project).await?;
    }
    Ok((
        project,
        account_id,
        GithubTemplateBackupCheck {
            repository,
            verification,
        },
    ))
}

#[tauri::command]
#[specta::specta]
pub async fn github_bind_repository(
    app: AppHandle,
    identity: String,
    full_name: String,
    expected_repository_id: Option<String>,
    target_repository_id: String,
) -> Result<GithubSyncStatus> {
    let sync = app.state::<GithubSync>();
    let _operation = sync.operation.lock().await;
    let project = active_project(&app, identity).await?;
    if sync.initial_upload(&app, &project.key)?.is_some() {
        return Err(GithubError::Conflict);
    }
    let remote = authorized_remote(&app.state::<GithubAuth>(), &full_name, None).await?;
    if remote.repository.id != target_repository_id {
        return Err(GithubError::Conflict);
    }
    if !remote.repository.can_push {
        return Err(GithubError::AccessDenied);
    }
    let (project, remote, snapshot) = probe(project, remote, true).await?;
    if !snapshot.remote_empty && !snapshot.shared_history {
        return Err(GithubError::Conflict);
    }
    still_current(&app, &project).await?;
    let account = remote.account_id().map(str::to_owned);
    sync.database(&app, |data| {
        let current = data.get(&project.key);
        if current.is_some_and(|binding| binding.template_pending.is_some())
            || current.map(|binding| &binding.repository.id) != expected_repository_id.as_ref()
        {
            return Err(GithubError::Conflict);
        }
        let mut binding = match data.remove(&project.key) {
            Some(binding)
                if binding.repository.id == remote.repository.id
                    && binding.account_id == account =>
            {
                binding
            }
            _ => Binding::new(remote.repository.clone(), account),
        };
        binding.observe_repository(&remote);
        binding.observe(&snapshot);
        data.insert(project.key.clone(), binding);
        Ok(((), true))
    })?;
    *sync.push_plan.lock().map_err(|_| GithubError::Storage)? = None;
    sync.clear_issue(&project.key);
    cached_status(&sync, &app, &project)
}

#[tauri::command]
#[specta::specta]
pub async fn github_unbind_repository(
    app: AppHandle,
    identity: String,
    expected_repository_id: String,
) -> Result<GithubSyncStatus> {
    let sync = app.state::<GithubSync>();
    let _operation = sync.operation.lock().await;
    let project = active_project(&app, identity).await?;
    sync.database(&app, |data| {
        if data
            .get(&project.key)
            .filter(|binding| binding.template_pending.is_none())
            .map(|binding| &binding.repository.id)
            != Some(&expected_repository_id)
        {
            return Err(GithubError::Conflict);
        }
        data.remove(&project.key);
        Ok(((), true))
    })?;
    if let Err(error) = sync.release_upload(&app, &project.key) {
        log::warn!("Could not remove a completed initial upload intent after unbinding: {error:?}");
    }
    *sync.push_plan.lock().map_err(|_| GithubError::Storage)? = None;
    sync.clear_issue(&project.key);
    status_with_template_backup_eligibility(&sync, &app, project).await
}

#[tauri::command]
#[specta::specta]
pub async fn github_set_auto_backup(
    app: AppHandle,
    identity: String,
    expected_repository_id: String,
    expected_branch: String,
    expected_private: bool,
    enabled: bool,
) -> Result<GithubSyncStatus> {
    let sync = app.state::<GithubSync>();
    let _operation = sync.operation.lock().await;
    let project = active_project(&app, identity).await?;
    if project.local.branch.as_deref() != Some(&expected_branch) {
        return Err(GithubError::ConfirmationExpired);
    }
    if enabled {
        let binding = sync
            .binding(&app, &project.key)?
            .ok_or(GithubError::Conflict)?;
        let remote = remote_for(&app, &binding, true).await?;
        still_current(&app, &project).await?;
        if remote.repository.private != expected_private {
            return Err(GithubError::ConfirmationExpired);
        }
        sync.modify_binding(&app, &project.key, &expected_repository_id, |binding| {
            binding.observe_repository(&remote);
            binding.set_auto_backup(&expected_branch, true)?;
            let entry = binding
                .branches
                .get_mut(&expected_branch)
                .ok_or(GithubError::Conflict)?;
            if entry.pending.is_some() {
                entry.pending = project.local.head.clone();
            }
            Ok(())
        })?;
        sync.wake.notify_one();
    } else {
        still_current(&app, &project).await?;
        sync.modify_binding(&app, &project.key, &expected_repository_id, |binding| {
            binding.set_auto_backup(&expected_branch, false)
        })?;
    }
    sync.clear_issue(&project.key);
    cached_status(&sync, &app, &project)
}

#[tauri::command]
#[specta::specta]
pub async fn github_prepare_push(
    app: AppHandle,
    identity: String,
    confirm_existing_only: bool,
) -> Result<GithubPreparePushResult> {
    let sync = app.state::<GithubSync>();
    let _operation = sync.operation.lock().await;
    *sync.push_plan.lock().map_err(|_| GithubError::Storage)? = None;
    let project = active_project(&app, identity).await?;
    let binding = sync
        .binding(&app, &project.key)?
        .ok_or(GithubError::Conflict)?;
    let remote = remote_for(&app, &binding, true).await?;
    let (project, remote, snapshot) = probe(project, remote, false).await?;
    still_current(&app, &project).await?;
    observe(&sync, &app, &project, &remote, &snapshot)?;
    sync.clear_issue(&project.key);
    if matches!(
        snapshot.relation,
        GithubGitRelation::Equal | GithubGitRelation::Behind
    ) {
        if let Some(branch) = snapshot.local.branch.as_deref() {
            sync.modify_binding(&app, &project.key, &remote.repository.id, |binding| {
                binding.confirm_first_backup(branch, false);
                Ok(())
            })?;
        }
        return Ok(GithubPreparePushResult::AlreadySynced {
            status: cached_status(&sync, &app, &project)?,
        });
    }
    if confirm_existing_only {
        return Err(GithubError::ConfirmationExpired);
    }
    if !matches!(
        snapshot.relation,
        GithubGitRelation::Ahead | GithubGitRelation::NewBranch
    ) {
        return Err(GithubError::Conflict);
    }
    // Use current visibility and the persistent branch history.
    let (confirm_public, confirm_recreate) = sync
        .binding(&app, &project.key)?
        .ok_or(GithubError::Conflict)?
        .confirms(&snapshot);
    let plan = GithubPushPlan {
        token: format!("{:x}", sync.sequence.fetch_add(1, Ordering::Relaxed)),
        repository: remote.repository.clone(),
        branch: project.local.branch.clone().ok_or(GithubError::Conflict)?,
        head: project.local.head.clone().ok_or(GithubError::Conflict)?,
        confirm_public,
        confirm_recreate,
    };
    *sync.push_plan.lock().map_err(|_| GithubError::Storage)? = Some(PreparedPush {
        identity: project.identity,
        key: project.key,
        account_id: remote
            .account_id()
            .ok_or(GithubError::AccessDenied)?
            .to_owned(),
        plan: plan.clone(),
        remote_head: snapshot.remote_head,
        expires: Instant::now() + Duration::from_secs(300),
    });
    Ok(GithubPreparePushResult::Ready { plan })
}

async fn push_snapshot(
    sync: &GithubSync,
    app: &AppHandle,
    project: Project,
    remote: Remote,
    snapshot: GithubGitProbe,
) -> Result<GithubSyncStatus> {
    let binding = sync
        .binding(app, &project.key)?
        .ok_or(GithubError::Conflict)?;
    // Fetching objects may take time. Recheck the destination and visibility
    // after the fetch, immediately before sending any objects to GitHub.
    let latest = authorized_remote(
        &app.state::<GithubAuth>(),
        &remote.repository.full_name,
        remote.account_id(),
    )
    .await?;
    if latest.repository.id != remote.repository.id
        || latest.repository.private != remote.repository.private
        || !latest.repository.can_push
    {
        return Err(GithubError::ConfirmationExpired);
    }
    let pending = project
        .local
        .branch
        .as_ref()
        .and_then(|branch| binding.branches.get(branch))
        .and_then(|entry| entry.pending.clone());
    still_current(app, &project).await?;
    let (project, remote, snapshot) = blocking(move || {
        let token = latest
            .access
            .as_ref()
            .ok_or(GithubError::AccessDenied)?
            .token();
        project
            .git
            .push(&latest.repository.full_name, token, &snapshot)
            .map_err(git_error)?;
        Ok((project, latest, snapshot))
    })
    .await?;
    let issue = sync
        .modify_binding(app, &project.key, &remote.repository.id, |binding| {
            binding.observe_repository(&remote);
            binding.record_push(&snapshot, pending.as_deref());
            Ok(())
        })
        .err();
    sync.clear_issue(&project.key);
    if let Some(error) = issue {
        sync.record_issue(&project, error, None);
        return Ok(completed_status(
            &snapshot.local,
            &remote,
            &binding,
            pending.is_some(),
            error,
        ));
    }
    let current = active_project(app, project.identity.clone()).await;
    Ok(current
        .and_then(|current| cached_status(sync, app, &current))
        .unwrap_or_else(|error| completed_status(&snapshot.local, &remote, &binding, false, error)))
}

#[tauri::command]
#[specta::specta]
pub async fn github_push(
    app: AppHandle,
    identity: String,
    token: String,
) -> Result<GithubSyncStatus> {
    let sync = app.state::<GithubSync>();
    let _operation = sync.operation.lock().await;
    let prepared = sync
        .push_plan
        .lock()
        .map_err(|_| GithubError::Storage)?
        .take()
        .filter(|prepared| {
            prepared.identity == identity
                && prepared.plan.token == token
                && prepared.expires > Instant::now()
        })
        .ok_or(GithubError::ConfirmationExpired)?;
    let project = active_project(&app, identity.clone()).await?;
    let binding = sync
        .binding(&app, &project.key)?
        .ok_or(GithubError::ConfirmationExpired)?;
    let remote = remote_for(&app, &binding, true).await?;
    let (project, remote, snapshot) = probe(project, remote, false).await?;
    still_current(&app, &project).await?;
    let plan = &prepared.plan;
    if prepared.key != project.key
        || remote.account_id() != Some(prepared.account_id.as_str())
        || plan.repository.id != remote.repository.id
        || plan.repository.private != remote.repository.private
        || project.local.branch.as_deref() != Some(plan.branch.as_str())
        || project.local.head.as_deref() != Some(plan.head.as_str())
        || snapshot.remote_head != prepared.remote_head
    {
        return Err(GithubError::ConfirmationExpired);
    }
    observe(&sync, &app, &project, &remote, &snapshot)?;
    let binding = sync
        .binding(&app, &project.key)?
        .ok_or(GithubError::Conflict)?;
    let (public, recreate) = binding.confirms(&snapshot);
    match snapshot.relation {
        GithubGitRelation::Equal => {
            sync.clear_issue(&project.key);
            cached_status(&sync, &app, &project)
        }
        GithubGitRelation::Ahead | GithubGitRelation::NewBranch
            if (!public || plan.confirm_public) && (!recreate || plan.confirm_recreate) =>
        {
            push_snapshot(&sync, &app, project, remote, snapshot).await
        }
        _ => Err(GithubError::ConfirmationExpired),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn github_update(
    app: AppHandle,
    identity: String,
    target: GithubUpdateTarget,
) -> Result<GithubSyncStatus> {
    let sync = app.state::<GithubSync>();
    let _operation = sync.operation.lock().await;
    let project = active_project(&app, identity.clone()).await?;
    let binding = sync
        .binding(&app, &project.key)?
        .ok_or(GithubError::Conflict)?;
    if binding.repository.id != target.repository_id {
        return Err(GithubError::Conflict);
    }
    let remote = remote_for(&app, &binding, false).await?;
    let (project, remote, snapshot) = probe(project, remote, false).await?;
    still_current(&app, &project).await?;
    observe(&sync, &app, &project, &remote, &snapshot)?;
    if snapshot.relation != GithubGitRelation::Behind
        || snapshot.local.branch.as_deref() != Some(target.branch.as_str())
        || snapshot.local.head.as_deref() != Some(target.head.as_str())
        || snapshot.remote_head.as_deref() != Some(target.remote_head.as_str())
    {
        return Err(GithubError::Conflict);
    }
    let access = app.state::<CreationState>().access.clone();
    let app_handle = app.clone();
    let owner = identity.clone();
    let after = blocking(move || {
        let gate =
            crate::project::runtime_gate::default_gate_path().map_err(|_| GithubError::Storage)?;
        let _lease = crate::project::runtime_gate::RuntimeLease::acquire(&gate)
            .map_err(|_| GithubError::UpdateBlocked)?;
        let mut access = access.lock().map_err(|_| GithubError::Storage)?;
        access
            .github_fast_forward(
                &owner,
                &snapshot,
                &assistant_task_data(&app_handle).map_err(git_error)?,
                &protection(&app_handle).map_err(git_error)?,
            )
            .map_err(|error| match error.code {
                CreationErrorCode::TestValidation | CreationErrorCode::RuntimeBusy => {
                    GithubError::UpdateBlocked
                }
                _ => git_error(error),
            })?;
        Ok(GithubGitProbe {
            local: GithubLocalGit {
                head: snapshot.remote_head.clone(),
                ..snapshot.local
            },
            relation: GithubGitRelation::Equal,
            ahead: 0,
            behind: 0,
            ..snapshot
        })
    })
    .await?;
    // A cache write failure cannot turn a completed checkout into a failed update.
    sync.clear_issue(&project.key);
    if let Err(error) = observe(&sync, &app, &project, &remote, &after) {
        sync.record_issue(&project, error, None);
        return Ok(completed_status(
            &after.local,
            &remote,
            &binding,
            false,
            error,
        ));
    }
    let updated = active_project(&app, identity).await;
    Ok(updated
        .and_then(|updated| cached_status(&sync, &app, &updated))
        .unwrap_or_else(|error| completed_status(&after.local, &remote, &binding, false, error)))
}

#[tauri::command]
#[specta::specta]
pub async fn github_clone_repository(
    app: AppHandle,
    full_name: String,
    branch: String,
    parent: String,
    folder: String,
) -> Result<GithubCloneResult> {
    let sync = app.state::<GithubSync>();
    let _operation = sync.operation.lock().await;
    let auth = app.state::<GithubAuth>();
    let remote = match authorized_remote(&auth, &full_name, None).await {
        Ok(remote) => remote,
        Err(error) => match public_remote(&auth, &full_name).await {
            Ok(remote) => remote,
            Err(GithubError::RepositoryUnavailable) => return Err(error),
            Err(error) => return Err(error),
        },
    };
    let app_handle = app.clone();
    let (path, key, binding) = blocking(move || {
        let protection = protection(&app_handle).map_err(git_error)?;
        let (path, directory_key) = clone_github_project(
            &remote.repository.full_name,
            &branch,
            remote.access.as_ref().map(GithubAccess::token),
            &PathBuf::from(parent),
            &folder,
            &protection,
        )
        .map_err(git_error)?;
        let mut binding = Binding::new(
            remote.repository.clone(),
            remote.account_id().map(str::to_owned),
        );
        binding.branches.insert(
            branch,
            Branch {
                known_remote: true,
                ..Branch::default()
            },
        );
        let key = project_key(&path, &directory_key);
        Ok((path, key, binding))
    })
    .await?;
    let warning = sync
        .database(&app, |data| {
            data.insert(key, binding);
            Ok(((), true))
        })
        .err();
    Ok(GithubCloneResult {
        path: path.to_string_lossy().into_owned(),
        warning,
    })
}

pub(super) fn note_local_save(
    app: &AppHandle,
    access: &CreationAccess,
    identity: &str,
    receipt: &mut GitRecordReceipt,
) {
    let Some(sync) = app.try_state::<GithubSync>() else {
        return;
    };
    let Ok((key, git)) = project_context(access, app, identity) else {
        return;
    };
    match sync.database(app, |data| {
        let Some(binding) = data.get_mut(&key) else {
            return Ok((false, false));
        };
        let local = git.local().map_err(git_error)?;
        let changed = local.branch.as_deref().is_some_and(|branch| {
            local.head.as_deref() == Some(receipt.commit.as_str())
                && binding.enqueue(branch, &receipt.commit)
        });
        Ok((changed, changed))
    }) {
        Ok(true) => {
            sync.clear_issue(&key);
            sync.wake.notify_one();
        }
        Ok(false) => {}
        Err(_) => {
            const WARNING: &str =
                "The local version was saved, but its GitHub backup could not be queued.";
            receipt.warning = Some(match receipt.warning.take() {
                Some(warning) => format!("{warning}\n{WARNING}"),
                None => WARNING.to_owned(),
            });
        }
    }
}

fn retryable(error: GithubError) -> bool {
    matches!(
        error,
        GithubError::Network
            | GithubError::Timeout
            | GithubError::RateLimited
            | GithubError::ServiceUnavailable
            | GithubError::Disconnected
            | GithubError::Authentication
            | GithubError::AccessDenied
            | GithubError::RepositoryUnavailable
    )
}

async fn auto_attempt(
    app: &AppHandle,
    sync: &GithubSync,
    project: Project,
    binding: Binding,
    pending: &str,
) -> Result<()> {
    let remote = remote_for(app, &binding, true).await?;
    let (project, remote, snapshot) = probe(project, remote, false).await?;
    still_current(app, &project).await?;
    observe(sync, app, &project, &remote, &snapshot)?;
    if matches!(
        snapshot.relation,
        GithubGitRelation::Equal | GithubGitRelation::Behind
    ) {
        sync.clear_issue(&project.key);
        return Ok(());
    }
    let binding = sync
        .binding(app, &project.key)?
        .ok_or(GithubError::Conflict)?;
    let (public, recreate) = binding.confirms(&snapshot);
    if binding.automatic_status(snapshot.local.branch.as_deref()).1 || public || recreate {
        return Err(GithubError::ConfirmationRequired);
    }
    if binding.pending_head(&project.local) != Some(pending)
        || !matches!(
            snapshot.relation,
            GithubGitRelation::Ahead | GithubGitRelation::NewBranch
        )
    {
        return Err(GithubError::Conflict);
    }
    push_snapshot(sync, app, project, remote, snapshot).await?;
    Ok(())
}

async fn retry_pending(app: &AppHandle) -> Result<()> {
    let sync = app.state::<GithubSync>();
    let Ok(_operation) = sync.operation.try_lock() else {
        return Ok(());
    };
    let Some((project, binding)) = pending_project(app).await? else {
        return Ok(());
    };
    let Some(pending) = binding.pending_head(&project.local).map(str::to_owned) else {
        return Ok(());
    };
    if project.local.head.as_deref() != Some(pending.as_str()) {
        sync.record_issue(&project, GithubError::Conflict, None);
        return Ok(());
    }
    let blocked = sync
        .issue
        .lock()
        .map_err(|_| GithubError::Storage)?
        .as_ref()
        .is_some_and(|issue| {
            issue.key == project.key
                && issue.branch == project.local.branch
                && issue.blocked.as_ref().is_some_and(|(identity, head)| {
                    *identity == project.identity && *head == pending
                })
        });
    if blocked {
        return Ok(());
    }
    let owner = project.identity.clone();
    let repository_id = binding.repository.id.clone();
    if let Err(error) = auto_attempt(app, &sync, project, binding, &pending).await {
        if let Ok(project) = active_project(app, owner).await {
            if project.local.head.as_deref() == Some(pending.as_str()) {
                if matches!(
                    error,
                    GithubError::ConfirmationRequired | GithubError::ConfirmationExpired
                ) {
                    if let Some(branch) = project.local.branch.as_deref() {
                        let _ = sync.modify_binding(app, &project.key, &repository_id, |binding| {
                            binding.pause_automatic_backup(branch);
                            Ok(())
                        });
                    }
                }
                sync.record_issue(
                    &project,
                    error,
                    (!retryable(error)).then_some(pending.as_str()),
                );
            }
        }
    }
    Ok(())
}

pub fn start_driver(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let sync = app.state::<GithubSync>();
            tokio::select! {
                _ = sync.wake.notified() => {},
                _ = tokio::time::sleep(Duration::from_secs(20)) => {},
            }
            if let Err(error) = retry_pending(&app).await {
                log::debug!("GitHub backup status unavailable: {error:?}");
            }
        }
    });
}

#[cfg(test)]
mod tests;
