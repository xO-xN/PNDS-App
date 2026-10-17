//! Process-free Git reads. Jobs retain the issued root outside the access
//! mutex and completion revalidates the workspace capability.
use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitState {
    Available,
    NotRepository,
    Unreadable,
    TooLarge,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationGitChange {
    pub path: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub index_status: String,
    pub disk_status: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationGitStatus {
    pub state: GitState,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub changes: Vec<CreationGitChange>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitDiffLayer {
    Staged,
    Unstaged,
    Untracked,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitDiffState {
    Text,
    Binary,
    Unreadable,
    TooLarge,
    Unavailable,
    NoChange,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationGitDiff {
    pub state: GitDiffState,
    pub text: Option<String>,
    pub detail: Option<String>,
}
pub struct GitDiffJob {
    identity: String,
    directory: File,
    path: String,
    layer: GitDiffLayer,
    untracked: Option<File>,
}
pub struct GitDiffOutput {
    identity: String,
    report: CreationGitDiff,
}

#[derive(Default)]
pub struct GitReader {
    _private: (),
}
pub struct GitStatusJob {
    identity: String,
    directory: File,
}
pub struct GitStatusOutput {
    identity: String,
    report: CreationGitStatus,
}
pub(super) struct GitFailure {
    pub state: GitState,
    pub detail: String,
}
pub(super) type GitResult<T> = Result<T, GitFailure>;

impl CreationAccess {
    pub fn prepare_git_status(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<GitStatusJob, CreationError> {
        let project = self.current(identity, protection)?;
        Ok(GitStatusJob {
            identity: identity.into(),
            directory: project.directory.try_clone().map_err(io_error)?,
        })
    }
    pub fn finish_git_status(
        &self,
        output: GitStatusOutput,
        protection: &Protection,
    ) -> Result<CreationGitStatus, CreationError> {
        self.current(&output.identity, protection)?;
        Ok(output.report)
    }
}
impl CreationAccess {
    pub fn prepare_git_diff(
        &self,
        identity: &str,
        path: &str,
        layer: GitDiffLayer,
        protection: &Protection,
    ) -> Result<GitDiffJob, CreationError> {
        let project = self.current(identity, protection)?;
        if path.is_empty() || !safe_relative(path) {
            return Err(CreationError::new(
                CreationErrorCode::PathEscape,
                "Git diff must stay inside this project",
            ));
        }
        // Existing working-tree paths must satisfy the same containment as file
        // reading. Missing paths remain valid for staged/unstaged deletions.
        let untracked = match project.file(path) {
            Ok(file) if layer == GitDiffLayer::Untracked => Some(file),
            Ok(_) => None,
            Err(error) if error.code == CreationErrorCode::Missing => None,
            Err(error) => return Err(error),
        };
        if layer == GitDiffLayer::Untracked
            && fs::symlink_metadata(project.root.join(path))
                .is_ok_and(|metadata| metadata.is_symlink())
        {
            return Err(CreationError::new(
                CreationErrorCode::PathEscape,
                "Untracked Git previews do not follow symbolic links",
            ));
        }
        Ok(GitDiffJob {
            identity: identity.into(),
            directory: project.directory.try_clone().map_err(io_error)?,
            path: path.into(),
            layer,
            untracked,
        })
    }
    pub fn finish_git_diff(
        &self,
        output: GitDiffOutput,
        protection: &Protection,
    ) -> Result<CreationGitDiff, CreationError> {
        self.current(&output.identity, protection)?;
        Ok(output.report)
    }
}
impl GitDiffJob {
    pub fn run(self, _reader: &GitReader) -> GitDiffOutput {
        let report = native_git::read_diff(
            &self.directory,
            &self.path,
            self.layer,
            self.untracked.as_ref(),
        )
        .unwrap_or_else(|error| CreationGitDiff {
            state: match error.state {
                GitState::TooLarge => GitDiffState::TooLarge,
                GitState::NotRepository => GitDiffState::Unavailable,
                _ => GitDiffState::Unreadable,
            },
            text: None,
            detail: Some(error.detail),
        });
        GitDiffOutput {
            identity: self.identity,
            report,
        }
    }
}
impl GitStatusJob {
    pub fn run(self, _reader: &GitReader) -> GitStatusOutput {
        let report =
            native_git::read_status(&self.directory).unwrap_or_else(|error| CreationGitStatus {
                state: error.state,
                branch: None,
                head: None,
                changes: vec![],
                detail: Some(error.detail),
            });
        GitStatusOutput {
            identity: self.identity,
            report,
        }
    }
}
fn safe_relative(path: &str) -> bool {
    !Path::new(path).components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        ) || component.as_os_str() == ".git"
    })
}
pub(super) fn unreadable(detail: impl Into<String>) -> GitFailure {
    GitFailure {
        state: GitState::Unreadable,
        detail: detail.into(),
    }
}
