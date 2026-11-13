//! Confirmed GitHub creation intents survive the gap before template backup can pin its merge.
use super::*;
use template_backup::{access_target, finish, persist_pending};

const DATABASE: &str = "creator-github-uploads.json";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GithubNewRepositoryTarget {
    account_id: String,
    owner: String,
    name: String,
    private: bool,
}

impl GithubNewRepositoryTarget {
    fn full_name(&self) -> String {
        format!("{}/{}", self.owner, self.name)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct InitialUpload {
    pub(super) target: GithubNewRepositoryTarget,
    pub(super) branch: String,
    pub(super) head: String,
    pub(super) repository: Option<GithubRepository>,
    #[serde(default)]
    pub(super) request_started: bool,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GithubInitialUploadSummary {
    target: GithubNewRepositoryTarget,
    branch: String,
    head: String,
    repository: Option<GithubRepository>,
    request_started: bool,
}

impl InitialUpload {
    pub(super) fn summary(self) -> GithubInitialUploadSummary {
        GithubInitialUploadSummary {
            target: self.target,
            branch: self.branch,
            head: self.head,
            repository: self.repository,
            request_started: self.request_started,
        }
    }
}

impl GithubSync {
    fn uploads<T>(
        &self,
        app: &AppHandle,
        action: impl FnOnce(&mut BTreeMap<String, InitialUpload>) -> Result<(T, bool)>,
    ) -> Result<T> {
        self.storage(app, DATABASE, action)
    }

    pub(super) fn initial_upload(
        &self,
        app: &AppHandle,
        key: &str,
    ) -> Result<Option<InitialUpload>> {
        self.uploads(app, |data| Ok((data.get(key).cloned(), false)))
    }

    fn reserve_upload(&self, app: &AppHandle, key: &str, pending: &InitialUpload) -> Result<()> {
        self.uploads(app, |data| {
            if data.contains_key(key) {
                return Err(GithubError::Conflict);
            }
            data.insert(key.to_owned(), pending.clone());
            Ok(((), true))
        })
    }

    fn note_created_repository(
        &self,
        app: &AppHandle,
        key: &str,
        pending: &InitialUpload,
        repository: GithubRepository,
    ) -> Result<()> {
        self.uploads(app, |data| {
            let current = data
                .get_mut(key)
                .filter(|current| *current == pending)
                .ok_or(GithubError::Conflict)?;
            current.repository = Some(repository);
            Ok(((), true))
        })
    }

    pub(super) fn release_upload(&self, app: &AppHandle, key: &str) -> Result<()> {
        self.uploads(app, |data| Ok(((), data.remove(key).is_some())))
    }
}

// Once the durable state records dispatch, loss of the result stays ambiguous.
// Callers may release only a definitive rejection, never a timeout.
async fn dispatch_repository_creation(
    intent: &mut InitialUpload,
    persist: impl FnOnce(&InitialUpload, &InitialUpload) -> Result<()>,
    send: impl std::future::Future<Output = Result<GithubRepository>>,
) -> Result<GithubRepository> {
    let mut started = intent.clone();
    started.request_started = true;
    persist(intent, &started)?;
    *intent = started;
    send.await
}

#[tauri::command]
#[specta::specta]
pub async fn github_new_repository_owners(
    app: AppHandle,
    account_id: String,
) -> Result<Vec<String>> {
    let auth = app.state::<GithubAuth>();
    let access = auth.access().await?;
    if access.account.id != account_id {
        return Err(GithubError::ConfirmationExpired);
    }
    auth.creation_owners(&access).await
}

fn definitive_creation_rejection(error: GithubError) -> bool {
    matches!(
        error,
        GithubError::CreationForbidden
            | GithubError::RepositoryNameUnavailable
            | GithubError::Authentication
            | GithubError::RateLimited
            | GithubError::RepositoryUnavailable
            | GithubError::InvalidRepository
    )
}

#[tauri::command]
#[specta::specta]
pub async fn github_upload_new_project(
    app: AppHandle,
    identity: String,
    initial_head: String,
    target: GithubNewRepositoryTarget,
) -> Result<GithubSyncStatus> {
    let sync = app.state::<GithubSync>();
    let _operation = sync.operation.lock().await;
    let project = active_project(&app, identity).await?;
    if project.local.head.as_deref() != Some(&initial_head)
        || project.local.branch.as_deref() != Some("main")
    {
        return Err(GithubError::ConfirmationExpired);
    }
    if sync.binding(&app, &project.key)?.is_some()
        || sync.pending_template(&app, &project.key)?.is_some()
        || sync.initial_upload(&app, &project.key)?.is_some()
    {
        return Err(GithubError::Conflict);
    }
    let project = blocking(move || {
        if !project
            .git
            .can_upload_initial_version(&initial_head)
            .map_err(git_error)?
        {
            return Err(GithubError::Unsupported);
        }
        Ok(project)
    })
    .await?;

    crate::github_auth::repository_name(&target.full_name())?;
    still_current(&app, &project).await?;
    let mut intent = InitialUpload {
        target,
        branch: "main".into(),
        head: project
            .local
            .head
            .clone()
            .ok_or(GithubError::ConfirmationExpired)?,
        repository: None,
        request_started: false,
    };
    sync.reserve_upload(&app, &project.key, &intent)?;
    let auth = app.state::<GithubAuth>();
    let checked = async {
        let access = auth.access().await?;
        if access.account.id != intent.target.account_id {
            return Err(GithubError::ConfirmationExpired);
        }
        let owners = auth.creation_owners(&access).await?;
        if !owners
            .iter()
            .any(|owner| owner.eq_ignore_ascii_case(&intent.target.owner))
        {
            return Err(GithubError::AccessDenied);
        }
        Ok(access)
    }
    .await;
    let access = match checked {
        Ok(access) => access,
        Err(
            error @ (GithubError::ConfirmationExpired
            | GithubError::AccessDenied
            | GithubError::Disconnected
            | GithubError::NotConfigured
            | GithubError::Authentication),
        ) => {
            sync.release_upload(&app, &project.key)?;
            return Err(error);
        }
        Err(error) => return Err(error),
    };
    still_current(&app, &project).await?;
    let target = intent.target.clone();
    let send = auth.generate_template(&access, &target.owner, &target.name, target.private);
    let repository = match dispatch_repository_creation(
        &mut intent,
        |before, started| {
            sync.uploads(&app, |data| {
                let current = data
                    .get_mut(&project.key)
                    .filter(|current| *current == before)
                    .ok_or(GithubError::Conflict)?;
                *current = started.clone();
                Ok(((), true))
            })
        },
        send,
    )
    .await
    {
        Ok(repository) => repository,
        Err(error) if definitive_creation_rejection(error) => {
            sync.release_upload(&app, &project.key)?;
            return Err(error);
        }
        Err(error) => return Err(error),
    };
    sync.note_created_repository(&app, &project.key, &intent, repository.clone())?;
    if repository.private != intent.target.private
        || !repository
            .full_name
            .eq_ignore_ascii_case(&intent.target.full_name())
        || repository.default_branch != intent.branch
    {
        return Err(GithubError::Conflict);
    }

    upload_created_repository(&app, project, &intent, repository).await
}

async fn upload_created_repository(
    app: &AppHandle,
    project: Project,
    intent: &InitialUpload,
    repository: GithubRepository,
) -> Result<GithubSyncStatus> {
    let (project, account_id, checked) =
        verify_template_backup(app, project, &repository.full_name, &repository.id).await?;
    let GithubTemplateVerification::Ready { remote_head, .. } = checked.verification else {
        return Err(GithubError::Conflict);
    };
    if account_id != intent.target.account_id
        || checked.repository.private != intent.target.private
        || checked.repository.default_branch != intent.branch
    {
        return Err(GithubError::ConfirmationExpired);
    }
    let (repository, access) = access_target(app, &checked.repository, &account_id).await?;
    if repository.private != intent.target.private {
        return Err(GithubError::ConfirmationExpired);
    }
    let target = repository.clone();
    let local_head = intent.head.clone();
    let (project, pending) = blocking(move || {
        let commit = project
            .git
            .prepare_template_backup(&target, access.token(), &local_head, &remote_head)
            .map_err(git_error)?;
        Ok((
            project,
            PendingTemplateBackup {
                repository: target,
                account_id,
                commit,
            },
        ))
    })
    .await?;

    let (repository, access) = access_target(app, &repository, &intent.target.account_id).await?;
    if repository.private != intent.target.private {
        return Err(GithubError::ConfirmationExpired);
    }
    let (project, pending) = persist_pending(app, project, pending, true).await?;
    let (project, pending) = blocking(move || {
        project
            .git
            .push_template_backup(&repository, access.token(), &pending.commit, true)
            .map_err(git_error)?;
        Ok((project, pending))
    })
    .await?;
    finish(app, project, pending.repository.clone(), pending).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn an_unknown_creation_response_retains_the_intent_written_before_dispatch() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join(DATABASE);
        let key = project_key(folder.path(), "original");
        let mut intent = InitialUpload {
            target: GithubNewRepositoryTarget {
                account_id: "42".into(),
                owner: "original-owner".into(),
                name: "my-score".into(),
                private: true,
            },
            branch: "main".into(),
            head: "confirmed-commit".into(),
            repository: None,
            request_started: false,
        };
        write_sync_data(&path, &BTreeMap::from([(key.clone(), intent.clone())])).unwrap();
        let failed_storage =
            dispatch_repository_creation(&mut intent, |_, _| Err(GithubError::Storage), async {
                panic!("creation must wait for persisted confirmation")
            })
            .await;
        assert_eq!(failed_storage, Err(GithubError::Storage));
        assert!(!intent.request_started);
        let result = dispatch_repository_creation(
            &mut intent,
            |before, started| {
                let mut saved: BTreeMap<String, InitialUpload> = read_sync_data(&path)?;
                assert_eq!(&saved[&key], before);
                assert!(!before.request_started);
                saved.insert(key.clone(), started.clone());
                write_sync_data(&path, &saved)
            },
            async {
                let saved: BTreeMap<String, InitialUpload> = read_sync_data(&path)?;
                assert!(saved[&key].request_started);
                assert!(saved[&key].repository.is_none());
                assert_eq!(saved[&key].head, "confirmed-commit");
                Err(GithubError::Timeout)
            },
        )
        .await;
        assert_eq!(result, Err(GithubError::Timeout));
        let reopened: BTreeMap<String, InitialUpload> = read_sync_data(&path).unwrap();
        assert_eq!(reopened[&key], intent);
        assert!(!reopened.contains_key(&project_key(folder.path(), "replacement")));

        intent.repository = Some(GithubRepository {
            id: "1701".into(),
            full_name: "original-owner/my-score".into(),
            private: true,
            default_branch: "main".into(),
            can_push: false,
        });
        write_sync_data(&path, &BTreeMap::from([(key.clone(), intent.clone())])).unwrap();
        let reopened: BTreeMap<String, InitialUpload> = read_sync_data(&path).unwrap();
        assert_eq!(reopened[&key], intent);
    }
}
