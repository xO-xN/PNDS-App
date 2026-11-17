//! History is an immutable object read; loading returns text plus the *current*
//! disk baseline and never writes a worktree, index or reference.
use super::git_read::{self, GitReadJob, GitReadOutput, ReadProject};
use super::*;
use git2::{Oid, Repository};
const HISTORY_LIMIT: usize = 30;
const HISTORY_SCAN_LIMIT: usize = 300;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryCommit {
    pub id: String,
    pub timestamp: f64,
    pub author: String,
    pub email: String,
    pub message: String,
    pub files: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitHistory {
    pub head: Option<String>,
    pub commits: Vec<GitHistoryCommit>,
    pub limited: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitHistoryReason {
    TooLarge,
    Binary,
    UnsupportedText,
    NotRegular,
    MissingHistory,
    MissingCurrent,
    NotEditable,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryFile {
    pub commit: String,
    pub path: String,
    pub historical_text: Option<String>,
    pub historical_size: f64,
    pub saved_text: Option<String>,
    pub disk_version: Option<String>,
    pub loadable: bool,
    pub reason: Option<GitHistoryReason>,
}
fn unavailable(detail: impl Into<String>) -> CreationError {
    CreationError::new(CreationErrorCode::TestValidation, detail)
}
fn relative(path: &str) -> Result<(), CreationError> {
    if path.is_empty()
        || Path::new(path)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)) || part.as_os_str() == ".git")
    {
        return Err(CreationError::new(
            CreationErrorCode::PathEscape,
            "History paths must stay in the current project.",
        ));
    }
    Ok(())
}
fn repository_prefix(repo: &Repository, project: &ReadProject) -> Result<PathBuf, CreationError> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| unavailable("Bare repositories are unsupported"))?;
    let workdir = fs::canonicalize(workdir).map_err(io_error)?;
    project
        .root
        .strip_prefix(workdir)
        .map(Path::to_path_buf)
        .map_err(|_| {
            CreationError::new(
                CreationErrorCode::PathEscape,
                "Git project boundary changed",
            )
        })
}
pub(super) fn reachable<'a>(
    repo: &'a Repository,
    commit: &str,
) -> Result<git2::Commit<'a>, CreationError> {
    let selected = Oid::from_str(commit).map_err(local_git::git_error)?;
    let mut next = repo.head().map_err(local_git::git_error)?.target();
    let mut budget = native_git::GitReadBudget::default();
    for _ in 0..HISTORY_SCAN_LIMIT {
        let Some(id) = next else {
            break;
        };
        let current = budget.commit(repo, id)?;
        if id == selected {
            budget.tree(repo, current.tree_id())?;
            return Ok(current);
        }
        next = current.parent_ids().next();
    }
    if next.is_some() {
        return Err(CreationError::new(CreationErrorCode::TooLarge, "Selected history is beyond the supported 300 first-parent commits. Use an external Git tool."));
    }
    Err(unavailable("The selected history is no longer reachable in the supported first-parent history. Refresh local history."))
}

pub(crate) struct GitHistoryJob {
    project: ReadProject,
}

pub(crate) struct GitHistoryFileJob {
    project: ReadProject,
    commit: String,
    path: String,
    all_routes: bool,
    expected_version: Option<String>,
}

impl git_read::sealed::Sealed for GitHistoryJob {}
impl GitReadJob for GitHistoryJob {
    type Reply = GitHistory;

    fn run(self, _reader: &GitReader) -> GitReadOutput<Self::Reply> {
        let result = read_history(&self.project);
        GitReadOutput::observation(self.project, result)
    }
}

impl git_read::sealed::Sealed for GitHistoryFileJob {}
impl GitReadJob for GitHistoryFileJob {
    type Reply = GitHistoryFile;

    fn run(self, _reader: &GitReader) -> GitReadOutput<Self::Reply> {
        let result = read_history_file(&self.project, &self.commit, &self.path, self.all_routes)
            .and_then(|result| {
                if let Some(version) = self.expected_version.as_deref() {
                    if !result.loadable {
                        return Err(unavailable("Only a currently existing supported text file can be loaded. No file was created or restored."));
                    }
                    if result.disk_version.as_deref() != Some(version) {
                        return Err(CreationError::new(
                            CreationErrorCode::VersionConflict,
                            "The saved file changed. Review the history comparison again.",
                        ));
                    }
                }
                Ok(result)
            });
        GitReadOutput::observation(self.project, result)
    }
}

fn read_history(project: &ReadProject) -> Result<GitHistory, CreationError> {
    let repo = project.repository()?;
    let prefix = repository_prefix(&repo, project)?;
    let head = match repo.head() {
        Ok(head) => head.target(),
        Err(error) if error.code() == git2::ErrorCode::UnbornBranch => None,
        Err(error) => return Err(local_git::git_error(error)),
    };
    let mut commits = Vec::new();
    let mut limited = false;
    if let Some(head) = head {
        let mut next = Some(head);
        let mut budget = native_git::GitReadBudget::default();
        let mut path_count = 0;
        let mut message_bytes = 0;
        for _ in 0..HISTORY_SCAN_LIMIT {
            let Some(id) = next else {
                break;
            };
            if commits.len() >= HISTORY_LIMIT {
                break;
            }
            let commit = budget.commit(&repo, id)?;
            next = commit.parent_ids().next();
            budget.tree(&repo, commit.tree_id())?;
            let tree = commit.tree().map_err(local_git::git_error)?;
            let parent = if let Some(parent) = next {
                let parent = budget.commit(&repo, parent)?;
                budget.tree(&repo, parent.tree_id())?;
                Some(parent.tree().map_err(local_git::git_error)?)
            } else {
                None
            };
            let diff = repo
                .diff_tree_to_tree(parent.as_ref(), Some(&tree), None)
                .map_err(local_git::git_error)?;
            let mut files = Vec::new();
            for delta in diff.deltas() {
                let Some(path) = delta.new_file().path().or_else(|| delta.old_file().path()) else {
                    return Err(unavailable("Unreadable history path"));
                };
                let Ok(path) = path.strip_prefix(&prefix) else {
                    continue;
                };
                let path = path
                    .to_str()
                    .ok_or_else(|| unavailable("History path is not UTF-8"))?;
                relative(path)?;
                files.push(path.to_owned());
                path_count += 1;
                if path_count > MAX_ENTRIES {
                    return Err(CreationError::new(
                        CreationErrorCode::TooLarge,
                        "History exceeds 4096 changed paths. Use an external Git tool.",
                    ));
                }
            }
            if files.is_empty() {
                continue;
            }
            let message = super::git_version_names::display(&repo, &commit)?;
            message_bytes += message.len();
            if message_bytes > TEXT_MAX_BYTES as usize {
                return Err(CreationError::new(
                    CreationErrorCode::TooLarge,
                    "History messages exceed 1 MiB",
                ));
            }
            commits.push(GitHistoryCommit {
                id: commit.id().to_string(),
                timestamp: commit.time().seconds() as f64,
                author: commit
                    .author()
                    .name()
                    .map_err(local_git::git_error)?
                    .to_owned(),
                email: commit
                    .author()
                    .email()
                    .map_err(local_git::git_error)?
                    .to_owned(),
                message,
                files,
            });
        }
        limited = next.is_some();
    }
    Ok(GitHistory {
        head: head.map(|head| head.to_string()),
        commits,
        limited,
    })
}

fn read_history_file(
    project: &ReadProject,
    commit: &str,
    path: &str,
    all_routes: bool,
) -> Result<GitHistoryFile, CreationError> {
    relative(path)?;
    let repo = project.repository()?;
    let selected = if all_routes {
        git_versions::reachable(&repo, commit)?
    } else {
        reachable(&repo, commit)?
    };
    let tree = selected.tree().map_err(local_git::git_error)?;
    let mut result = GitHistoryFile {
        commit: commit.into(),
        path: path.into(),
        historical_text: None,
        historical_size: 0.,
        saved_text: None,
        disk_version: None,
        loadable: false,
        reason: None,
    };
    match tree.get_path(&repository_prefix(&repo, project)?.join(path)) {
        Ok(item) if matches!(item.filemode(), 0o100644 | 0o100755) => {
            let (size, _) = repo
                .odb()
                .map_err(local_git::git_error)?
                .read_header(item.id())
                .map_err(local_git::git_error)?;
            result.historical_size = size as f64;
            if size > TEXT_MAX_BYTES as usize {
                result.reason = Some(GitHistoryReason::TooLarge);
            } else {
                let blob = repo.find_blob(item.id()).map_err(local_git::git_error)?;
                if blob.is_binary() || file_kind(path) != CreationFileKind::Text {
                    result.reason = Some(GitHistoryReason::Binary);
                } else {
                    match std::str::from_utf8(blob.content()) {
                        Ok(text) => result.historical_text = Some(text.into()),
                        Err(_) => result.reason = Some(GitHistoryReason::UnsupportedText),
                    };
                }
            }
        }
        Ok(_) => result.reason = Some(GitHistoryReason::NotRegular),
        Err(error) if error.code() == git2::ErrorCode::NotFound => {
            result.reason = Some(GitHistoryReason::MissingHistory)
        }
        Err(error) => return Err(local_git::git_error(error)),
    }
    // A historical symlink is never dereferenced. Current containment and
    // editor support are checked independently of the historical object.
    match fs::symlink_metadata(project.root.join(path)) {
        Ok(metadata) if metadata.is_symlink() || !metadata.is_file() => {
            result.reason = Some(GitHistoryReason::NotRegular)
        }
        Ok(_) => match project.read(path) {
            Ok(CreationContent::Text { text, version }) if !text.contains('\0') => {
                result.saved_text = Some(text);
                result.disk_version = Some(version);
            }
            Ok(_) => result.reason = Some(GitHistoryReason::UnsupportedText),
            Err(error) if error.code == CreationErrorCode::PathEscape => return Err(error),
            Err(error) => {
                result.reason = Some(match error.code {
                    CreationErrorCode::TooLarge => GitHistoryReason::TooLarge,
                    CreationErrorCode::Missing => GitHistoryReason::MissingCurrent,
                    _ => GitHistoryReason::UnsupportedText,
                });
            }
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            result.reason = Some(GitHistoryReason::MissingCurrent)
        }
        Err(error) => return Err(io_error(error)),
    }
    if project.descriptor.source != CreationSource::Folder {
        result.reason = Some(GitHistoryReason::NotEditable);
    }
    result.loadable =
        result.reason.is_none() && result.historical_text.is_some() && result.saved_text.is_some();
    Ok(result)
}

impl CreationAccess {
    pub(crate) fn prepare_git_history(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<GitHistoryJob, CreationError> {
        Ok(GitHistoryJob {
            project: self.prepare_read_project(identity, protection)?,
        })
    }

    pub(crate) fn prepare_git_history_file(
        &self,
        identity: &str,
        commit: &str,
        path: &str,
        protection: &Protection,
    ) -> Result<GitHistoryFileJob, CreationError> {
        self.prepare_history_file(identity, commit, path, false, None, protection)
    }

    pub(crate) fn prepare_git_version_file(
        &self,
        identity: &str,
        commit: &str,
        path: &str,
        protection: &Protection,
    ) -> Result<GitHistoryFileJob, CreationError> {
        self.prepare_history_file(identity, commit, path, true, None, protection)
    }

    pub(crate) fn prepare_load_git_history_text(
        &self,
        identity: &str,
        commit: &str,
        path: &str,
        version: &str,
        protection: &Protection,
    ) -> Result<GitHistoryFileJob, CreationError> {
        self.prepare_history_file(
            identity,
            commit,
            path,
            false,
            Some(version.into()),
            protection,
        )
    }

    fn prepare_history_file(
        &self,
        identity: &str,
        commit: &str,
        path: &str,
        all_routes: bool,
        expected_version: Option<String>,
        protection: &Protection,
    ) -> Result<GitHistoryFileJob, CreationError> {
        relative(path)?;
        Ok(GitHistoryFileJob {
            project: self.prepare_read_project(identity, protection)?,
            commit: commit.into(),
            path: path.into(),
            all_routes,
            expected_version,
        })
    }

    #[cfg(test)]
    pub fn git_history(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<GitHistory, CreationError> {
        self.prepare_git_history(identity, protection)?
            .run(&GitReader::default())
            .finish_readonly(self, protection)
    }

    #[cfg(test)]
    pub fn git_history_file(
        &self,
        identity: &str,
        commit: &str,
        path: &str,
        protection: &Protection,
    ) -> Result<GitHistoryFile, CreationError> {
        self.prepare_git_history_file(identity, commit, path, protection)?
            .run(&GitReader::default())
            .finish_readonly(self, protection)
    }

    #[cfg(test)]
    pub fn load_git_history_text(
        &self,
        identity: &str,
        commit: &str,
        path: &str,
        version: &str,
        protection: &Protection,
    ) -> Result<GitHistoryFile, CreationError> {
        self.prepare_load_git_history_text(identity, commit, path, version, protection)?
            .run(&GitReader::default())
            .finish_readonly(self, protection)
    }
}
