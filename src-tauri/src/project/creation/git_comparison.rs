//! Bounded read-only comparisons. Tokens identify immutable objects and saved byte fingerprints;
//! they never authorize editing, checkout, runtime actions, or assistant execution.
use super::git_read::{self, GitReadJob, GitReadOutput, ReadCompletion, ReadProject};
use super::*;
use git2::{ObjectType, Oid, Repository};
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitComparisonMode {
    Parent,
    Saved,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitComparisonRequest {
    pub commit: Option<String>,
    pub mode: GitComparisonMode,
    pub parent: Option<String>,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitComparisonSide {
    pub commit: Option<String>,
    pub message: Option<String>,
    pub saved: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitComparisonStatus {
    Unchanged,
    Added,
    Deleted,
    Modified,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitComparisonFile {
    pub path: String,
    pub status: GitComparisonStatus,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitComparison {
    pub token: String,
    pub before: GitComparisonSide,
    pub after: GitComparisonSide,
    pub files: Vec<GitComparisonFile>,
}
#[derive(Debug, Clone, Copy, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitComparisonLineKind {
    Context,
    Addition,
    Deletion,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitComparisonLine {
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
    pub kind: GitComparisonLineKind,
    pub content: String,
    pub no_newline: bool,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitComparisonHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<GitComparisonLine>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitComparisonFileRequest {
    pub token: String,
    pub path: String,
    pub full_context: bool,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitComparisonDiff {
    pub token: String,
    pub path: String,
    pub hunks: Vec<GitComparisonHunk>,
    pub added: u32,
    pub deleted: u32,
    pub reason: Option<GitHistoryReason>,
}
#[derive(Clone)]
struct Entry {
    oid: Oid,
    mode: u32,
    size: u64,
    saved: bool,
}
type Inventory = BTreeMap<String, Entry>;
pub(super) struct GitComparisonSession {
    pub(super) identity: String,
    pub(super) token: String,
    pub(super) epoch: u64,
    before: Inventory,
    after: Inventory,
    saved: bool,
}
fn refuse(detail: impl Into<String>) -> CreationError {
    CreationError::new(CreationErrorCode::TestValidation, detail)
}
fn private(path: &str) -> bool {
    local_git::excluded(path, 0) == Some(GitExclusion::SensitiveOrGenerated)
        || Path::new(path)
            .components()
            .any(|part| part.as_os_str() == ".git")
}
fn valid_path(path: &str) -> Result<(), CreationError> {
    if path.is_empty()
        || path.contains('\\')
        || path.chars().any(char::is_control)
        || Path::new(path)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        || path.split('/').any(|part| matches!(part, "" | "." | ".."))
        || private(path)
    {
        return Err(CreationError::new(CreationErrorCode::PathEscape, path));
    }
    Ok(())
}
fn prefix(repo: &Repository, project: &ReadProject) -> Result<PathBuf, CreationError> {
    let root = fs::canonicalize(repo.workdir().ok_or_else(|| refuse("Bare repository"))?)
        .map_err(io_error)?;
    project
        .root
        .strip_prefix(root)
        .map(Path::to_path_buf)
        .map_err(|_| refuse("Git project boundary changed"))
}
fn tree_inventory(
    repo: &Repository,
    tree: Option<Oid>,
    scope: &Path,
) -> Result<Inventory, CreationError> {
    let mut result = Inventory::new();
    let Some(root) = tree else {
        return Ok(result);
    };
    native_git::GitReadBudget::default().tree(repo, root)?;
    let mut pending = vec![(root, PathBuf::new())];
    while let Some((id, parent)) = pending.pop() {
        for item in repo.find_tree(id).map_err(local_git::git_error)?.iter() {
            let name = item.name().map_err(local_git::git_error)?;
            if name.contains(['/', '\\']) || matches!(name, "." | "..") {
                return Err(refuse("Unsupported history path"));
            }
            let path = parent.join(name);
            if item.kind() == Some(ObjectType::Tree) {
                pending.push((item.id(), path));
                continue;
            }
            let Ok(relative) = path.strip_prefix(scope) else {
                continue;
            };
            let path = relative
                .to_str()
                .ok_or_else(|| refuse("History path is not UTF-8"))?;
            if private(path) {
                continue;
            }
            valid_path(path)?;
            let size = if item.kind() == Some(ObjectType::Blob) {
                repo.odb()
                    .map_err(local_git::git_error)?
                    .read_header(item.id())
                    .map_err(local_git::git_error)?
                    .0 as u64
            } else {
                0
            };
            result.insert(
                path.into(),
                Entry {
                    oid: item.id(),
                    mode: item.filemode() as u32,
                    size,
                    saved: false,
                },
            );
            if result.len() > MAX_ENTRIES {
                return Err(refuse("Comparison exceeds 4096 files"));
            }
        }
    }
    Ok(result)
}
fn saved_inventory(
    project: &ReadProject,
    repo: &Repository,
    scope: &Path,
) -> Result<Inventory, CreationError> {
    let index = native_git::bounded_index(repo)?;
    let mut result = Inventory::new();
    let mut pending = vec![(PathBuf::new(), 0)];
    let mut count = 0;
    let mut total = 0;
    while let Some((parent, depth)) = pending.pop() {
        if depth > MAX_DEPTH {
            return Err(refuse("Comparison directory depth exceeds 32"));
        }
        for name in directory_names(project.file(&parent.to_string_lossy())?)? {
            let next = parent.join(name);
            let path = next
                .to_str()
                .ok_or_else(|| refuse("Saved path is not UTF-8"))?;
            if private(path) {
                continue;
            }
            valid_path(path)?;
            count += 1;
            if count > MAX_ENTRIES {
                return Err(refuse("Comparison exceeds 4096 entries"));
            }
            let metadata = fs::symlink_metadata(project.root.join(&next)).map_err(io_error)?;
            if metadata.is_symlink() {
                return Err(refuse("Symbolic saved paths are not compared"));
            }
            if metadata.is_dir() {
                pending.push((next, depth + 1));
                continue;
            }
            if !metadata.is_file() {
                return Err(refuse("Only regular saved files can be compared"));
            }
            if index.get_path(&scope.join(&next), 0).is_none()
                && repo
                    .status_should_ignore(&scope.join(&next))
                    .map_err(local_git::git_error)?
            {
                continue;
            }
            total += metadata.len();
            if metadata.len() > local_git::GIT_FILE_LIMIT || total > local_git::GIT_TOTAL_LIMIT {
                return Err(CreationError::new(
                    CreationErrorCode::TooLarge,
                    "Saved comparison exceeds 64 MiB per file / 256 MiB total",
                ));
            }
            let content = bounded_read(project.file(path)?, local_git::GIT_FILE_LIMIT)?;
            result.insert(
                path.into(),
                Entry {
                    oid: Oid::hash_object(ObjectType::Blob, &content)
                        .map_err(local_git::git_error)?,
                    mode: if metadata.mode() & 0o111 != 0 {
                        0o100755
                    } else {
                        0o100644
                    },
                    size: content.len() as u64,
                    saved: true,
                },
            );
        }
    }
    Ok(result)
}
fn side(
    repo: &Repository,
    commit: Option<&git2::Commit<'_>>,
    saved: bool,
) -> Result<GitComparisonSide, CreationError> {
    Ok(GitComparisonSide {
        commit: commit.map(|value| value.id().to_string()),
        message: commit
            .map(|commit| {
                super::git_version_names::display(repo, commit).map(|name| {
                    name.lines()
                        .next()
                        .unwrap_or("")
                        .chars()
                        .take(120)
                        .collect()
                })
            })
            .transpose()?,
        saved,
    })
}
fn content(
    project: &ReadProject,
    repo: &Repository,
    path: &str,
    entry: Option<&Entry>,
) -> Result<Result<Vec<u8>, GitHistoryReason>, CreationError> {
    let Some(entry) = entry else {
        return Ok(Ok(Vec::new()));
    };
    if !matches!(entry.mode, 0o100644 | 0o100755) {
        return Ok(Err(GitHistoryReason::NotRegular));
    }
    if entry.size > TEXT_MAX_BYTES {
        return Ok(Err(GitHistoryReason::TooLarge));
    }
    if file_kind(path) != CreationFileKind::Text {
        return Ok(Err(GitHistoryReason::Binary));
    }
    let bytes = if entry.saved {
        let metadata = fs::symlink_metadata(project.root.join(path)).map_err(|error| {
            if error.kind() == io::ErrorKind::NotFound {
                CreationError::new(CreationErrorCode::VersionConflict, path)
            } else {
                io_error(error)
            }
        })?;
        if !metadata.is_file() || metadata.is_symlink() {
            return Err(CreationError::new(CreationErrorCode::VersionConflict, path));
        }
        let mode = if metadata.mode() & 0o111 != 0 {
            0o100755
        } else {
            0o100644
        };
        if mode != entry.mode {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Saved file mode changed; refresh comparison",
            ));
        }
        let bytes = bounded_read(project.file(path)?, TEXT_MAX_BYTES)?;
        if Oid::hash_object(ObjectType::Blob, &bytes).map_err(local_git::git_error)? != entry.oid {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Saved file changed; refresh comparison",
            ));
        }
        bytes
    } else {
        let (size, kind) = repo
            .odb()
            .map_err(local_git::git_error)?
            .read_header(entry.oid)
            .map_err(local_git::git_error)?;
        if kind != ObjectType::Blob {
            return Ok(Err(GitHistoryReason::NotRegular));
        }
        if size > TEXT_MAX_BYTES as usize {
            return Ok(Err(GitHistoryReason::TooLarge));
        }
        repo.find_blob(entry.oid)
            .map_err(local_git::git_error)?
            .content()
            .to_vec()
    };
    if bytes.contains(&0) {
        return Ok(Err(GitHistoryReason::Binary));
    }
    if std::str::from_utf8(&bytes).is_err() {
        return Ok(Err(GitHistoryReason::UnsupportedText));
    }
    Ok(Ok(bytes))
}
pub(crate) struct ComparisonJob {
    project: ReadProject,
    request: GitComparisonRequest,
    epoch: u64,
}

pub(crate) struct ComparisonFileJob {
    project: ReadProject,
    request: GitComparisonFileRequest,
    epoch: u64,
    before: Option<Entry>,
    after: Option<Entry>,
    saved: bool,
}

impl git_read::sealed::Sealed for ComparisonJob {}
impl git_read::sealed::Sealed for ComparisonFileJob {}

impl GitReadJob for ComparisonJob {
    type Reply = GitComparison;

    fn run(self, _reader: &GitReader) -> GitReadOutput<Self::Reply> {
        let (result, session) = match build_comparison(&self.project, self.request, self.epoch) {
            Ok((report, session)) => (Ok(report), Some(session)),
            Err(error) => (Err(error), None),
        };
        GitReadOutput::new(
            self.project,
            result,
            ReadCompletion::ComparisonBuild {
                epoch: self.epoch,
                session,
            },
        )
    }
}

impl GitReadJob for ComparisonFileJob {
    type Reply = GitComparisonDiff;

    fn run(self, _reader: &GitReader) -> GitReadOutput<Self::Reply> {
        let result = read_comparison_file(
            &self.project,
            &self.request,
            self.before.as_ref(),
            self.after.as_ref(),
            self.saved,
        );
        GitReadOutput::new(
            self.project,
            result,
            ReadCompletion::ComparisonFile {
                epoch: self.epoch,
                token: self.request.token,
            },
        )
    }
}

impl CreationAccess {
    pub(crate) fn prepare_git_comparison(
        &mut self,
        identity: &str,
        request: GitComparisonRequest,
        protection: &Protection,
    ) -> Result<ComparisonJob, CreationError> {
        let project = self.prepare_read_project(identity, protection)?;
        self.git_comparison_epoch = self
            .git_comparison_epoch
            .checked_add(1)
            .ok_or_else(|| refuse("Comparison sequence is exhausted"))?;
        self.git_comparison = None;
        Ok(ComparisonJob {
            project,
            request,
            epoch: self.git_comparison_epoch,
        })
    }

    pub(crate) fn prepare_git_comparison_file(
        &self,
        identity: &str,
        request: &GitComparisonFileRequest,
        protection: &Protection,
    ) -> Result<ComparisonFileJob, CreationError> {
        valid_path(&request.path)?;
        let project = self.prepare_read_project(identity, protection)?;
        let session = self
            .git_comparison
            .as_ref()
            .filter(|session| session.identity == identity && session.token == request.token)
            .ok_or_else(|| {
                CreationError::new(
                    CreationErrorCode::VersionConflict,
                    "Comparison changed; refresh",
                )
            })?;
        if !session.before.contains_key(&request.path) && !session.after.contains_key(&request.path)
        {
            return Err(refuse("File is outside this comparison"));
        }
        Ok(ComparisonFileJob {
            project,
            request: request.clone(),
            epoch: session.epoch,
            before: session.before.get(&request.path).cloned(),
            after: session.after.get(&request.path).cloned(),
            saved: session.saved,
        })
    }

    #[cfg(test)]
    pub fn git_comparison(
        &mut self,
        identity: &str,
        request: GitComparisonRequest,
        protection: &Protection,
    ) -> Result<GitComparison, CreationError> {
        let output = self
            .prepare_git_comparison(identity, request, protection)?
            .run(&GitReader::default());
        self.finish_git_read(output, protection)
    }

    #[cfg(test)]
    pub fn git_comparison_file(
        &self,
        identity: &str,
        request: &GitComparisonFileRequest,
        protection: &Protection,
    ) -> Result<GitComparisonDiff, CreationError> {
        self.prepare_git_comparison_file(identity, request, protection)?
            .run(&GitReader::default())
            .finish_readonly(self, protection)
    }
}

fn build_comparison(
    project: &ReadProject,
    request: GitComparisonRequest,
    epoch: u64,
) -> Result<(GitComparison, GitComparisonSession), CreationError> {
    let repo = project.repository()?;
    let scope = prefix(&repo, project)?;
    let selected = match request.commit.as_deref() {
        Some(id) => Some(git_versions::reachable(&repo, id)?),
        None => repo
            .head()
            .ok()
            .map(|head| head.peel_to_commit())
            .transpose()
            .map_err(local_git::git_error)?,
    };
    let parent_mode = request.commit.is_some() && matches!(request.mode, GitComparisonMode::Parent);
    let parent = if parent_mode {
        selected
            .as_ref()
            .and_then(|commit| {
                request
                    .parent
                    .as_deref()
                    .and_then(|id| commit.parent_ids().find(|parent| parent.to_string() == id))
                    .or_else(|| {
                        if request.parent.is_none() {
                            commit.parent_ids().next()
                        } else {
                            None
                        }
                    })
            })
            .map(|id| native_git::GitReadBudget::default().commit(&repo, id))
            .transpose()?
    } else {
        None
    };
    if parent_mode && request.parent.is_some() && parent.is_none() {
        return Err(refuse("Selected parent is not a parent of this version"));
    }
    let (before_commit, after_commit) = if parent_mode {
        (parent.as_ref(), selected.as_ref())
    } else {
        (selected.as_ref(), None)
    };
    let before = tree_inventory(&repo, before_commit.map(|commit| commit.tree_id()), &scope)?;
    let after = if parent_mode {
        tree_inventory(&repo, after_commit.map(|commit| commit.tree_id()), &scope)?
    } else {
        saved_inventory(project, &repo, &scope)?
    };
    let mut hash = Sha256::new();
    hash.update(&project.descriptor.identity);
    hash.update(format!("{request:?}"));
    hash.update(format!(
        "{:?}:{:?}",
        before_commit.map(|commit| commit.id()),
        after_commit.map(|commit| commit.id())
    ));
    for (label, inventory) in [("before", &before), ("after", &after)] {
        hash.update(label);
        for (path, entry) in inventory {
            hash.update(format!(
                "{path}\0{}:{}:{}",
                entry.oid, entry.mode, entry.size
            ));
        }
    }
    let token = format!("{:x}", hash.finalize());
    if before
        .keys()
        .chain(after.keys())
        .collect::<std::collections::BTreeSet<_>>()
        .len()
        > MAX_ENTRIES
    {
        return Err(refuse("Comparison exceeds 4096 paths"));
    }
    let files = before
        .keys()
        .chain(after.keys())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .map(|path| GitComparisonFile {
            path: path.clone(),
            status: match (before.get(path), after.get(path)) {
                (None, _) => GitComparisonStatus::Added,
                (_, None) => GitComparisonStatus::Deleted,
                (Some(old), Some(new)) if old.oid == new.oid && old.mode == new.mode => {
                    GitComparisonStatus::Unchanged
                }
                _ => GitComparisonStatus::Modified,
            },
        })
        .collect();
    let comparison = GitComparison {
        token: token.clone(),
        before: side(&repo, before_commit, false)?,
        after: side(&repo, after_commit, !parent_mode)?,
        files,
    };
    Ok((
        comparison,
        GitComparisonSession {
            identity: project.descriptor.identity.clone(),
            token,
            epoch,
            before,
            after,
            saved: !parent_mode,
        },
    ))
}

fn read_comparison_file(
    project: &ReadProject,
    request: &GitComparisonFileRequest,
    before_entry: Option<&Entry>,
    after_entry: Option<&Entry>,
    saved: bool,
) -> Result<GitComparisonDiff, CreationError> {
    let repo = project.repository()?;
    let mut result = GitComparisonDiff {
        token: request.token.clone(),
        path: request.path.clone(),
        hunks: Vec::new(),
        added: 0,
        deleted: 0,
        reason: None,
    };
    if saved && after_entry.is_none() {
        match fs::symlink_metadata(project.root.join(&request.path)) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error(error)),
            Ok(_) => {
                return Err(CreationError::new(
                    CreationErrorCode::VersionConflict,
                    "Saved file appeared; refresh comparison",
                ))
            }
        }
    }
    let before = content(project, &repo, &request.path, before_entry)?;
    let after = content(project, &repo, &request.path, after_entry)?;
    let (before, after) = match (before, after) {
        (Ok(before), Ok(after)) => (before, after),
        (Err(reason), _) | (_, Err(reason)) => {
            result.reason = Some(reason);
            return Ok(result);
        }
    };
    compare_bytes(
        &request.token,
        &request.path,
        &before,
        &after,
        request.full_context,
    )
}

/// Shared bounded libgit2 rendering for saved project and private candidate bytes.
pub(super) fn compare_bytes(
    token: &str,
    path: &str,
    before: &[u8],
    after: &[u8],
    full_context: bool,
) -> Result<GitComparisonDiff, CreationError> {
    let mut result = GitComparisonDiff {
        token: token.to_owned(),
        path: path.to_owned(),
        hunks: Vec::new(),
        added: 0,
        deleted: 0,
        reason: None,
    };
    let mut options = git2::DiffOptions::new();
    options
        .context_lines(if full_context { 4000 } else { 3 })
        .max_size(TEXT_MAX_BYTES as i64);
    let patch = git2::Patch::from_buffers(before, None, after, None, Some(&mut options))
        .map_err(local_git::git_error)?;
    if patch.size(true, true, true) > TEXT_MAX_BYTES as usize {
        result.reason = Some(GitHistoryReason::TooLarge);
        return Ok(result);
    }
    let (_, added, deleted) = patch.line_stats().map_err(local_git::git_error)?;
    result.added = added as u32;
    result.deleted = deleted as u32;
    let mut lines_total = 0;
    for index in 0..patch.num_hunks() {
        let (hunk, count) = patch.hunk(index).map_err(local_git::git_error)?;
        lines_total += count;
        if lines_total > 4000 || index >= 1000 {
            result.hunks.clear();
            result.reason = Some(GitHistoryReason::TooLarge);
            return Ok(result);
        }
        let mut lines: Vec<GitComparisonLine> = Vec::new();
        for offset in 0..count {
            let line = patch
                .line_in_hunk(index, offset)
                .map_err(local_git::git_error)?;
            let kind = match line.origin() {
                ' ' => GitComparisonLineKind::Context,
                '+' => GitComparisonLineKind::Addition,
                '-' => GitComparisonLineKind::Deletion,
                _ => {
                    if let Some(last) = lines.last_mut() {
                        last.no_newline = true;
                    }
                    continue;
                }
            };
            let text = std::str::from_utf8(line.content())
                .map_err(|_| refuse("Diff line is not UTF-8"))?;
            let text = text.strip_suffix('\n').unwrap_or(text);
            let content = text.strip_suffix('\r').unwrap_or(text).to_owned();
            lines.push(GitComparisonLine {
                old_line: line.old_lineno(),
                new_line: line.new_lineno(),
                kind,
                content,
                no_newline: false,
            });
        }
        result.hunks.push(GitComparisonHunk {
            old_start: hunk.old_start(),
            old_lines: hunk.old_lines(),
            new_start: hunk.new_start(),
            new_lines: hunk.new_lines(),
            lines,
        });
    }
    Ok(result)
}
