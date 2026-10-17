//! Process-free replacement for the #201 reader; it retains parent-repository
//! inspection without granting those repositories write capabilities.
use super::git::*;
use super::*;
use git2::{Repository, Status, StatusOptions};

fn failure(error: git2::Error) -> GitFailure {
    unreadable(error.message())
}

pub(super) fn bounded_index(repo: &Repository) -> Result<git2::Index, CreationError> {
    if fs::metadata(repo.path().join("index")).is_ok_and(|metadata| metadata.len() > TEXT_MAX_BYTES)
    {
        return Err(CreationError::new(
            CreationErrorCode::TooLarge,
            "Git index exceeds 1 MiB. Use an external Git tool.",
        ));
    }
    let index = repo.index().map_err(local_git::git_error)?;
    if index.len() > MAX_ENTRIES {
        return Err(CreationError::new(
            CreationErrorCode::TooLarge,
            "Git index exceeds 4096 entries. Use an external Git tool.",
        ));
    }
    Ok(index)
}
pub(super) fn held_path(directory: &File) -> Result<PathBuf, CreationError> {
    #[cfg(target_os = "macos")]
    {
        let mut path = [0i8; libc::PATH_MAX as usize];
        if unsafe { libc::fcntl(directory.as_raw_fd(), libc::F_GETPATH, path.as_mut_ptr()) } < 0 {
            return Err(io_error(io::Error::last_os_error()));
        }
        Ok(PathBuf::from(std::ffi::OsStr::from_bytes(
            unsafe { CStr::from_ptr(path.as_ptr()) }.to_bytes(),
        )))
    }
    #[cfg(not(target_os = "macos"))]
    {
        fs::read_link(format!("/proc/self/fd/{}", directory.as_raw_fd())).map_err(io_error)
    }
}
pub(super) fn repository(root: &Path) -> Result<Repository, CreationError> {
    let repo = Repository::discover(root).map_err(|error| if error.message().to_ascii_lowercase().contains("partialclone") { CreationError::new(CreationErrorCode::TestValidation, "Cannot read partial clone repositories. Complete missing objects using an external Git tool.") } else { local_git::git_error(error) })?;
    local_git::local_config(&repo)?;
    Ok(repo)
}
fn open(directory: &File) -> GitResult<(Repository, PathBuf)> {
    let root = held_path(directory).map_err(|error| unreadable(error.detail))?;
    if !root
        .ancestors()
        .any(|parent| fs::symlink_metadata(parent.join(".git")).is_ok())
    {
        return Err(GitFailure {
            state: GitState::NotRepository,
            detail: "This project is not inside a Git working tree".into(),
        });
    }
    let repo = repository(&root).map_err(|error| unreadable(error.detail))?;
    Ok((repo, root))
}
fn prefix(repo: &Repository, root: &Path) -> GitResult<PathBuf> {
    let workdir = fs::canonicalize(
        repo.workdir()
            .ok_or_else(|| unreadable("Bare repositories are unsupported"))?,
    )
    .map_err(|error| unreadable(error.to_string()))?;
    root.strip_prefix(workdir)
        .map(Path::to_path_buf)
        .map_err(|_| unreadable("Git working tree is outside the project"))
}
pub(super) fn read_status(directory: &File) -> GitResult<CreationGitStatus> {
    let (repo, root) = open(directory)?;
    let project = OpenProject {
        descriptor: CreationProject {
            identity: String::new(),
            root: root.to_string_lossy().into_owned(),
            name: String::new(),
            source: CreationSource::Folder,
        },
        directory: directory
            .try_clone()
            .map_err(|error| unreadable(error.to_string()))?,
        root: root.clone(),
        watch: BTreeMap::new(),
        pending: BTreeMap::new(),
        revision: 0,
    };
    project
        .walk(Path::new(""), 0, &mut 0, &mut Vec::new(), &mut Vec::new())
        .map_err(|error| GitFailure {
            state: if error.code == CreationErrorCode::TooLarge {
                GitState::TooLarge
            } else {
                GitState::Unreadable
            },
            detail: error.detail,
        })?;
    let index = bounded_index(&repo).map_err(|error| GitFailure {
        state: if error.code == CreationErrorCode::TooLarge {
            GitState::TooLarge
        } else {
            GitState::Unreadable
        },
        detail: error.detail,
    })?;
    let mut budget = GitReadBudget::default();
    if let Ok(head) = repo.head() {
        if let Some(id) = head.target() {
            let commit = budget.commit(&repo, id).map_err(|error| GitFailure {
                state: if error.code == CreationErrorCode::TooLarge {
                    GitState::TooLarge
                } else {
                    GitState::Unreadable
                },
                detail: error.detail,
            })?;
            budget
                .tree(&repo, commit.tree_id())
                .map_err(|error| GitFailure {
                    state: if error.code == CreationErrorCode::TooLarge {
                        GitState::TooLarge
                    } else {
                        GitState::Unreadable
                    },
                    detail: error.detail,
                })?;
        }
    }
    let prefix = prefix(&repo, &root)?;
    let mut tracked_bytes = 0;
    for item in index.iter() {
        let path = Path::new(std::ffi::OsStr::from_bytes(&item.path));
        let Ok(relative) = path.strip_prefix(&prefix) else {
            continue;
        };
        if let Ok(metadata) = fs::symlink_metadata(root.join(relative)) {
            if metadata.is_file() {
                tracked_bytes += metadata.len();
            }
            if metadata.len() > local_git::GIT_FILE_LIMIT
                || tracked_bytes > local_git::GIT_TOTAL_LIMIT
            {
                return Err(GitFailure {state:GitState::TooLarge,detail:"Tracked saved content exceeds the 64 MiB file / 256 MiB collection limits. Use an external Git tool.".into()});
            }
        }
    }
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .renames_head_to_index(false)
        .renames_index_to_workdir(false)
        .exclude_submodules(true)
        .update_index(false)
        .disable_pathspec_match(true);
    if !prefix.as_os_str().is_empty() {
        options.pathspec(&prefix);
    }
    let statuses = repo.statuses(Some(&mut options)).map_err(failure)?;
    let mut changes = Vec::new();
    for item in statuses.iter() {
        let path = item.path().map_err(failure)?;
        let Some(path) = Path::new(path)
            .strip_prefix(&prefix)
            .ok()
            .and_then(Path::to_str)
        else {
            continue;
        };
        if path.is_empty() {
            continue;
        }
        let status = item.status();
        let index = if status.contains(Status::INDEX_NEW) {
            "A"
        } else if status.contains(Status::INDEX_DELETED) {
            "D"
        } else if status.intersects(Status::INDEX_MODIFIED | Status::INDEX_TYPECHANGE) {
            "M"
        } else {
            " "
        };
        let disk = if status.contains(Status::WT_NEW) {
            "?"
        } else if status.contains(Status::WT_DELETED) {
            "D"
        } else if status.intersects(Status::WT_MODIFIED | Status::WT_TYPECHANGE) {
            "M"
        } else {
            " "
        };
        changes.push(CreationGitChange {
            path: path.into(),
            staged: index != " ",
            unstaged: disk != " " && disk != "?",
            untracked: disk == "?",
            index_status: index.into(),
            disk_status: disk.into(),
        });
        if changes.len() > MAX_ENTRIES {
            return Err(GitFailure {
                state: GitState::TooLarge,
                detail: "Git status exceeds 4096 files".into(),
            });
        }
    }
    let head = repo
        .head()
        .ok()
        .and_then(|head| head.target())
        .map(|id| id.to_string());
    let branch = if repo.head_detached().unwrap_or(false) {
        None
    } else {
        repo.find_reference("HEAD").ok().and_then(|head| {
            head.symbolic_target()
                .ok()
                .flatten()
                .map(|name| name.trim_start_matches("refs/heads/").to_owned())
        })
    };
    Ok(CreationGitStatus {
        state: GitState::Available,
        branch,
        head,
        changes,
        detail: None,
    })
}
pub(super) fn read_diff(
    directory: &File,
    path: &str,
    layer: GitDiffLayer,
    untracked: Option<&File>,
) -> GitResult<CreationGitDiff> {
    let status = read_status(directory)?;
    if !status.changes.iter().any(|change| {
        change.path == path
            && match layer {
                GitDiffLayer::Staged => change.staged,
                GitDiffLayer::Unstaged => change.unstaged,
                GitDiffLayer::Untracked => change.untracked,
            }
    }) {
        return Ok(CreationGitDiff {
            state: GitDiffState::NoChange,
            text: None,
            detail: None,
        });
    }
    let (repo, root) = open(directory)?;
    if layer == GitDiffLayer::Untracked {
        let file = untracked
            .ok_or_else(|| unreadable("Untracked file is no longer readable"))?
            .try_clone()
            .map_err(|error| unreadable(error.to_string()))?;
        let bytes = bounded_read(file, TEXT_MAX_BYTES).map_err(|error| GitFailure {
            state: if error.code == CreationErrorCode::TooLarge {
                GitState::TooLarge
            } else {
                GitState::Unreadable
            },
            detail: error.detail,
        })?;
        if bytes.contains(&0) {
            return Ok(CreationGitDiff {
                state: GitDiffState::Binary,
                text: None,
                detail: None,
            });
        }
        let text = String::from_utf8(bytes).map_err(|_| unreadable("Git text is not UTF-8"))?;
        return Ok(CreationGitDiff {
            state: GitDiffState::Text,
            text: Some(text.lines().map(|line| format!("+{line}\n")).collect()),
            detail: None,
        });
    }
    let mut options = git2::DiffOptions::new();
    options
        .pathspec(prefix(&repo, &root)?.join(path))
        .disable_pathspec_match(true)
        .ignore_submodules(true);
    let tree = repo
        .head()
        .ok()
        .map(|head| head.peel_to_tree())
        .transpose()
        .map_err(failure)?;
    let index = bounded_index(&repo).map_err(|error| GitFailure {
        state: if error.code == CreationErrorCode::TooLarge {
            GitState::TooLarge
        } else {
            GitState::Unreadable
        },
        detail: error.detail,
    })?;
    let relative = prefix(&repo, &root)?.join(path);
    let old = tree
        .as_ref()
        .and_then(|tree| tree.get_path(&relative).ok())
        .map(|entry| entry.id());
    let staged = index.get_path(&relative, 0).map(|entry| entry.id);
    let database = repo.odb().map_err(failure)?;
    for id in [old, staged].into_iter().flatten() {
        let (size, _) = database.read_header(id).map_err(failure)?;
        if size > TEXT_MAX_BYTES as usize {
            return Err(GitFailure {
                state: GitState::TooLarge,
                detail: "Git comparison content exceeds 1 MiB".into(),
            });
        }
    }
    if layer == GitDiffLayer::Unstaged
        && fs::symlink_metadata(root.join(path))
            .is_ok_and(|metadata| metadata.is_file() && metadata.len() > TEXT_MAX_BYTES)
    {
        return Err(GitFailure {
            state: GitState::TooLarge,
            detail: "Saved comparison content exceeds 1 MiB".into(),
        });
    }
    let diff = match layer {
        GitDiffLayer::Staged => {
            repo.diff_tree_to_index(tree.as_ref(), Some(&index), Some(&mut options))
        }
        _ => repo.diff_index_to_workdir(Some(&index), Some(&mut options)),
    }
    .map_err(failure)?;
    let mut text = Vec::new();
    let mut binary = false;
    let mut exceeded = false;
    let result = diff.print(git2::DiffFormat::Patch, |delta, _, line| {
        binary |= delta.flags().contains(git2::DiffFlags::BINARY);
        if matches!(line.origin(), '+' | '-' | ' ') {
            text.push(line.origin() as u8);
        }
        text.extend_from_slice(line.content());
        exceeded = text.len() > TEXT_MAX_BYTES as usize;
        !exceeded
    });
    if exceeded {
        return Err(GitFailure {
            state: GitState::TooLarge,
            detail: "Git diff exceeds 1 MiB".into(),
        });
    }
    result.map_err(failure)?;
    let state = if binary {
        GitDiffState::Binary
    } else if text.is_empty() {
        GitDiffState::NoChange
    } else {
        GitDiffState::Text
    };
    Ok(CreationGitDiff {
        state,
        text: if state == GitDiffState::Text {
            Some(String::from_utf8(text).map_err(|_| unreadable("Git text is not UTF-8"))?)
        } else {
            None
        },
        detail: None,
    })
}

/// Bound object inputs before libgit2 materializes commit/tree/diff structures.
/// Shared by an entire history request, so old unchanged trees are counted once.
#[derive(Default)]
pub(super) struct GitReadBudget {
    seen: std::collections::HashSet<git2::Oid>,
    bytes: usize,
    entries: usize,
}
impl GitReadBudget {
    fn object(
        &mut self,
        repo: &Repository,
        id: git2::Oid,
        kind: git2::ObjectType,
    ) -> Result<(), CreationError> {
        if self.seen.contains(&id) {
            return Ok(());
        }
        let (size, actual) = repo
            .odb()
            .map_err(local_git::git_error)?
            .read_header(id)
            .map_err(local_git::git_error)?;
        if actual != kind {
            return Err(CreationError::new(
                CreationErrorCode::TestValidation,
                "Unsupported Git object type.",
            ));
        }
        self.bytes += size;
        if size > TEXT_MAX_BYTES as usize
            || self.bytes > 16 * 1024 * 1024
            || self.seen.len() >= 65_536
        {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                "Git object input exceeds the bounded reader. Use an external Git tool.",
            ));
        }
        self.seen.insert(id);
        Ok(())
    }
    pub(super) fn commit<'a>(
        &mut self,
        repo: &'a Repository,
        id: git2::Oid,
    ) -> Result<git2::Commit<'a>, CreationError> {
        self.object(repo, id, git2::ObjectType::Commit)?;
        repo.find_commit(id).map_err(local_git::git_error)
    }
    pub(super) fn tree(&mut self, repo: &Repository, id: git2::Oid) -> Result<(), CreationError> {
        let mut pending = vec![(id, 0)];
        let mut entries = 0;
        while let Some((id, depth)) = pending.pop() {
            if depth > MAX_DEPTH {
                return Err(CreationError::new(
                    CreationErrorCode::TooLarge,
                    "Git tree exceeds depth 32.",
                ));
            }
            self.object(repo, id, git2::ObjectType::Tree)?;
            let tree = repo.find_tree(id).map_err(local_git::git_error)?;
            entries += tree.len();
            self.entries += tree.len();
            if entries > MAX_ENTRIES || self.entries > 65_536 {
                return Err(CreationError::new(
                    CreationErrorCode::TooLarge,
                    "Git tree inventory exceeds the bounded reader. Use an external Git tool.",
                ));
            }
            for item in tree.iter() {
                if item.kind() == Some(git2::ObjectType::Tree) {
                    pending.push((item.id(), depth + 1));
                }
            }
        }
        Ok(())
    }
}
