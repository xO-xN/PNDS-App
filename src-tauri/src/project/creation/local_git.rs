//! Local-only Git engine. Objects are made from held, bounded file bytes, never
//! through Git's filter/checkout/transport APIs or a child process.
use super::*;
use git2::{IndexEntry, IndexTime, Repository, RepositoryInitOptions};

pub const GIT_FILE_LIMIT: u64 = 64 * 1024 * 1024;
pub const GIT_TOTAL_LIMIT: u64 = 256 * 1024 * 1024;
pub const GIT_LARGE_MEDIA: u64 = 10 * 1024 * 1024;
pub const GIT_PLACEHOLDER_EMAIL: &str = "creator@pnds.local";

pub(super) fn git_error(error: git2::Error) -> CreationError {
    CreationError::new(CreationErrorCode::Io, error.message())
}
fn refuse(detail: impl Into<String>) -> CreationError {
    CreationError::new(CreationErrorCode::TestValidation, detail)
}

pub(super) fn require_no_parent_repository(root: &Path) -> Result<(), CreationError> {
    for parent in root.ancestors() {
        if fs::symlink_metadata(parent.join(".git")).is_ok() {
            return Err(refuse("This location belongs to a parent Git repository. Choose a separate folder or manage it with an external Git tool."));
        }
    }
    Ok(())
}

fn initialize(root: &Path) -> Result<Repository, CreationError> {
    let mut options = RepositoryInitOptions::new();
    options.external_template(false).initial_head("main");
    Repository::init_opts(root, &options).map_err(git_error)
}

fn metadata_boundary(path: &Path, depth: usize, count: &mut usize) -> Result<(), CreationError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io_error(error)),
    };
    *count += 1;
    if depth > MAX_DEPTH || *count > 65_536 {
        return Err(refuse(
            "Git metadata exceeds the supported inventory. Use an external Git tool.",
        ));
    }
    if metadata.is_symlink() {
        return Err(refuse(
            "Symbolic Git metadata requires an external Git tool.",
        ));
    }
    if metadata.is_dir() {
        let directory = File::options()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
            .open(path)
            .map_err(io_error)?;
        for name in directory_names(directory)? {
            metadata_boundary(&path.join(name), depth + 1, count)?;
        }
    } else if !metadata.is_file() {
        return Err(refuse(
            "Git metadata must use regular files and directories.",
        ));
    }
    Ok(())
}

// Only this repository's config participates: no machine identity, global
// filters, credential helpers or template paths are inherited.
pub(super) fn local_config(repo: &Repository) -> Result<git2::Config, CreationError> {
    let mut config = git2::Config::new().map_err(git_error)?;
    config
        .add_file(&repo.path().join("config"), git2::ConfigLevel::Local, false)
        .map_err(git_error)?;
    repo.set_config(&config).map_err(git_error)?;
    let mut entries = config.entries(None).map_err(git_error)?;
    while let Some(entry) = entries.next() {
        let entry = entry.map_err(git_error)?;
        let key = entry.name().map_err(git_error)?.to_ascii_lowercase();
        if key == "extensions.partialclone"
            || (key.starts_with("remote.")
                && (key.ends_with(".promisor") || key.ends_with(".partialclonefilter")))
        {
            return Err(refuse("Cannot read partial clone repositories. Complete missing objects using an external Git tool; PNDS never fetches them."));
        }
    }
    drop(entries);
    Ok(config)
}

fn write_boundary(root: &Path, owned_locks: bool) -> Result<Option<Repository>, CreationError> {
    let metadata = match fs::symlink_metadata(root.join(".git")) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            require_no_parent_repository(root)?;
            return Ok(None);
        }
        Err(error) => return Err(io_error(error)),
    };
    if !metadata.is_dir() || metadata.is_symlink() {
        return Err(refuse("Linked worktrees, submodules and symbolic Git directories require an external Git tool."));
    }
    if let Some(parent) = root.parent() {
        require_no_parent_repository(parent)?;
    }
    let mut metadata_count = 0;
    for path in ["objects", "refs", "logs"] {
        metadata_boundary(&root.join(".git").join(path), 0, &mut metadata_count)?;
    }
    let repo = Repository::open(root).map_err(git_error)?;
    if repo.is_bare()
        || repo.is_worktree()
        || fs::canonicalize(repo.path()).map_err(io_error)? != root.join(".git")
    {
        return Err(refuse(
            "Only an independent project repository supports local version recording.",
        ));
    }
    for path in [
        "commondir",
        "objects/info/alternates",
        "info/grafts",
        "shallow",
    ] {
        if repo.path().join(path).exists() {
            return Err(refuse("Alternate object stores, grafts and shallow repositories require an external Git tool."));
        }
    }
    for path in ["objects", "refs", "hooks"] {
        if fs::symlink_metadata(repo.path().join(path)).is_ok_and(|metadata| metadata.is_symlink())
        {
            return Err(refuse(
                "Symbolic Git metadata requires an external Git tool.",
            ));
        }
    }
    let config = local_config(&repo)?;
    let mut entries = config.entries(None).map_err(git_error)?;
    while let Some(entry) = entries.next() {
        let entry = entry.map_err(git_error)?;
        let key = entry.name().unwrap_or("").to_ascii_lowercase();
        if key.starts_with("filter.")
            || key.starts_with("include.")
            || key.starts_with("includeif.")
            || key == "core.eol"
            || (matches!(key.as_str(), "core.autocrlf" | "core.safecrlf")
                && entry.value().ok() != Some("false"))
            || key == "core.attributesfile"
            || key == "core.worktree"
            || key == "extensions.worktreeconfig"
            || key == "core.sparsecheckout"
            || key == "extensions.refstorage"
            || key == "extensions.objectformat"
            || (key == "commit.gpgsign" && entry.value().ok() != Some("false"))
        {
            return Err(refuse("This repository requires unsupported filters, signing or repository configuration. Use an external Git tool; its configuration is preserved."));
        }
    }
    drop(entries);
    if repo.state() != git2::RepositoryState::Clean
        || native_git::bounded_index(&repo)?.has_conflicts()
    {
        return Err(refuse(
            "Finish the merge, rebase, cherry-pick or conflicts using an external Git tool first.",
        ));
    }
    for name in [
        "index.lock",
        "HEAD.lock",
        "config.lock",
        "shallow.lock",
        "packed-refs.lock",
    ] {
        if !(owned_locks && matches!(name, "index.lock" | "HEAD.lock"))
            && repo.path().join(name).exists()
        {
            return Err(refuse(
                "The repository is locked. Finish the other Git operation and preview again.",
            ));
        }
    }
    Ok(Some(repo))
}

fn local_signature(name: &str, email: &str) -> Result<git2::Signature<'static>, CreationError> {
    let name = name.trim();
    if name.is_empty()
        || name.len() > 128
        || name.contains(['\n', '\r', '\0', '<', '>'])
        || email.len() > 254
        || email.contains(['\n', '\r', '\0', '<', '>'])
    {
        return Err(refuse(
            "Enter a nonempty local Git name and a valid optional email.",
        ));
    }
    let email = if email.trim().is_empty() {
        GIT_PLACEHOLDER_EMAIL
    } else {
        email.trim()
    };
    git2::Signature::now(name, email).map_err(git_error)
}

fn excluded(path: &str, size: u64) -> Option<GitExclusion> {
    let lower = path.to_ascii_lowercase();
    let parts: Vec<_> = lower.split('/').collect();
    if parts.iter().any(|part| {
        matches!(
            *part,
            "node_modules"
                | "target"
                | "dist"
                | "build"
                | ".cache"
                | "coverage"
                | ".pnds"
                | "logs"
                | ".ds_store"
        ) || part.starts_with(".pnds-")
            || part.starts_with(".env")
            || matches!(
                *part,
                "credentials.json" | "secrets.json" | "id_rsa" | "id_ed25519"
            )
    }) || [".pem", ".key", ".p12", ".pfx", ".log"]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
    {
        return Some(GitExclusion::SensitiveOrGenerated);
    }
    if size > GIT_FILE_LIMIT {
        return Some(GitExclusion::TooLarge);
    }
    let extension = Path::new(&lower)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if size >= GIT_LARGE_MEDIA
        && matches!(
            extension,
            "wav"
                | "aif"
                | "aiff"
                | "flac"
                | "mp3"
                | "ogg"
                | "mp4"
                | "mov"
                | "mkv"
                | "webm"
                | "onnx"
                | "pt"
                | "pth"
                | "bin"
                | "gguf"
                | "safetensors"
        )
    {
        return Some(GitExclusion::LargeMedia);
    }
    None
}

type SavedFiles = BTreeMap<String, (Vec<u8>, u32, Option<GitExclusion>)>;

fn inventory(root: &Path, repo: Option<&Repository>) -> Result<SavedFiles, CreationError> {
    fn walk(
        project: &OpenProject,
        relative: &Path,
        repo: Option<&Repository>,
        depth: usize,
        total: &mut u64,
        count: &mut usize,
        files: &mut SavedFiles,
    ) -> Result<(), CreationError> {
        if depth > MAX_DEPTH || files.len() > MAX_ENTRIES {
            return Err(refuse(
                "Git preview exceeds 4096 files or 32 directories in depth.",
            ));
        }
        let root = &project.root;
        let directory = project.resolved_file(&root.join(relative), &relative.to_string_lossy())?;
        for name in directory_names(directory)? {
            if name == ".git" {
                if !relative.as_os_str().is_empty() {
                    return Err(refuse(
                        "Nested Git repositories require an external Git tool.",
                    ));
                }
                continue;
            }
            *count += 1;
            if *count > MAX_ENTRIES {
                return Err(refuse(
                    "Git preview exceeds 4096 entries. Use an external Git tool.",
                ));
            }
            let next = relative.join(name);
            let path = next
                .to_str()
                .ok_or_else(|| refuse("Git paths must be UTF-8"))?;
            let metadata = fs::symlink_metadata(root.join(&next)).map_err(io_error)?;
            if metadata.is_symlink() {
                return Err(refuse(format!(
                    "Symbolic links cannot be recorded by PNDS: {path}"
                )));
            }
            if metadata.is_dir() {
                if excluded(path, 0).is_none() {
                    walk(project, &next, repo, depth + 1, total, count, files)?;
                }
                continue;
            }
            if !metadata.is_file() {
                return Err(refuse(format!("Unsupported file: {path}")));
            }
            let ignored = repo
                .map(|repo| repo.status_should_ignore(&next))
                .transpose()
                .map_err(git_error)?
                .unwrap_or(false);
            let reason =
                excluded(path, metadata.len()).or_else(|| ignored.then_some(GitExclusion::Ignored));
            // Excluded oversized data is represented by metadata, never allocated.
            let bytes = if metadata.len() <= GIT_FILE_LIMIT
                && reason
                    .as_ref()
                    .is_none_or(|reason| *reason == GitExclusion::LargeMedia)
            {
                *total += metadata.len();
                if *total > GIT_TOTAL_LIMIT {
                    return Err(refuse("Git preview exceeds the 256 MiB collection limit."));
                }
                bounded_read(
                    project.resolved_file(&root.join(&next), path)?,
                    GIT_FILE_LIMIT,
                )?
            } else {
                Vec::new()
            };
            let mode = if metadata.mode() & 0o111 != 0 {
                0o100755
            } else {
                0o100644
            };
            files.insert(path.into(), (bytes, mode, reason));
        }
        Ok(())
    }
    let mut files = BTreeMap::new();
    let project = OpenProject {
        descriptor: CreationProject {
            identity: String::new(),
            root: root.to_string_lossy().into_owned(),
            name: String::new(),
            source: CreationSource::Folder,
        },
        directory: File::options()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
            .open(root)
            .map_err(io_error)?,
        root: root.into(),
        watch: BTreeMap::new(),
        pending: BTreeMap::new(),
        revision: 0,
    };
    walk(&project, Path::new(""), repo, 0, &mut 0, &mut 0, &mut files)?;
    Ok(files)
}

fn entry(
    path: &str,
    bytes: &[u8],
    mode: u32,
    repo: &Repository,
) -> Result<IndexEntry, CreationError> {
    Ok(IndexEntry {
        ctime: IndexTime::new(0, 0),
        mtime: IndexTime::new(0, 0),
        dev: 0,
        ino: 0,
        mode,
        uid: 0,
        gid: 0,
        file_size: bytes.len() as u32,
        id: repo.blob(bytes).map_err(git_error)?,
        flags: 0,
        flags_extended: 0,
        path: path.as_bytes().to_vec(),
    })
}

pub(super) fn initialize_generated(
    root: &Path,
    options: &NewProjectOptions,
) -> Result<(), CreationError> {
    let signature = local_signature(
        options
            .git_name
            .as_deref()
            .unwrap_or(if options.author.trim().is_empty() {
                "PNDS Creator"
            } else {
                &options.author
            }),
        options.git_email.as_deref().unwrap_or(""),
    )?;
    let repo = initialize(root)?;
    local_config(&repo)?;
    let files = inventory(root, Some(&repo))?;
    let mut index = native_git::bounded_index(&repo)?;
    for (path, (bytes, mode, reason)) in files {
        if reason.is_none() {
            index
                .add(&entry(&path, &bytes, mode, &repo)?)
                .map_err(git_error)?;
        }
    }
    let tree_id = index.write_tree().map_err(git_error)?;
    let tree = repo.find_tree(tree_id).map_err(git_error)?;
    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        "Initial project",
        &tree,
        &[],
    )
    .map_err(git_error)?;
    index.write().map_err(git_error)?;
    let mut config = repo.config().map_err(git_error)?;
    config
        .set_str("user.name", signature.name().unwrap())
        .map_err(git_error)?;
    config
        .set_str("user.email", signature.email().unwrap())
        .map_err(git_error)?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitExclusion {
    SensitiveOrGenerated,
    TooLarge,
    LargeMedia,
    Ignored,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitRecordStatus {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitRecordFile {
    pub path: String,
    pub size: f64,
    pub status: GitRecordStatus,
    pub default_selected: bool,
    pub exclusion: Option<GitExclusion>,
    pub staged: bool,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitRecordPreview {
    pub token: String,
    pub initial: bool,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub name: String,
    pub email: String,
    pub files: Vec<GitRecordFile>,
}
#[derive(Debug, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitRecordRequest {
    pub paths: Vec<String>,
    pub name: String,
    pub email: String,
    pub message: String,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitRecordReceipt {
    pub commit: String,
    pub message: String,
    pub paths: Vec<String>,
    pub warning: Option<String>,
}
pub(super) struct GitPreviewSession {
    identity: String,
    preview: GitRecordPreview,
    fingerprint: String,
}

struct RecordSnapshot {
    repo: Option<Repository>,
    bytes: SavedFiles,
    files: Vec<GitRecordFile>,
    fingerprint: String,
    content_fingerprint: String,
    head: Option<String>,
    branch: Option<String>,
}
fn snapshot(project: &OpenProject) -> Result<RecordSnapshot, CreationError> {
    snapshot_with_locks(project, false)
}
fn snapshot_with_locks(
    project: &OpenProject,
    owned_locks: bool,
) -> Result<RecordSnapshot, CreationError> {
    use sha2::{Digest, Sha256};
    let repo = write_boundary(&project.root, owned_locks)?;
    let temporary = tempfile::tempdir().map_err(io_error)?;
    let ignore_repo;
    let rules = if let Some(repo) = &repo {
        repo
    } else {
        ignore_repo = initialize(temporary.path())?;
        local_config(&ignore_repo)?;
        ignore_repo
            .set_workdir(&project.root, false)
            .map_err(git_error)?;
        &ignore_repo
    };
    let mut bytes = inventory(&project.root, Some(rules))?;
    let mut collected: u64 = bytes
        .values()
        .map(|(content, _, _)| content.len() as u64)
        .sum();
    let status = if repo.is_some() {
        Some(native_git::read_status(&project.directory).map_err(|error| refuse(error.detail))?)
    } else {
        None
    };
    let head = status.as_ref().and_then(|status| status.head.clone());
    let branch = status.as_ref().and_then(|status| status.branch.clone());
    let mut files = Vec::new();
    if let Some(status) = &status {
        for change in &status.changes {
            let metadata = match fs::symlink_metadata(project.root.join(&change.path)) {
                Ok(metadata) => Some(metadata),
                Err(error)
                    if error.kind() == io::ErrorKind::NotFound && change.disk_status == "D" =>
                {
                    None
                }
                Err(error) => return Err(io_error(error)),
            };
            let size = metadata
                .as_ref()
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            if let Some(metadata) = &metadata {
                if !metadata.is_file() || metadata.is_symlink() {
                    return Err(refuse("Only regular saved files can be recorded; symbolic links and submodules require an external Git tool."));
                }
                let reason = excluded(&change.path, size)
                    .filter(|reason| change.untracked || *reason != GitExclusion::LargeMedia);
                if !change.untracked || !bytes.contains_key(&change.path) {
                    let content = if reason.is_none() && size <= GIT_FILE_LIMIT {
                        collected -= bytes
                            .get(&change.path)
                            .map(|(content, _, _)| content.len() as u64)
                            .unwrap_or(0);
                        collected += size;
                        if collected > GIT_TOTAL_LIMIT {
                            return Err(refuse(
                                "Git preview exceeds the 256 MiB collection limit.",
                            ));
                        }
                        bounded_read(
                            project
                                .resolved_file(&project.root.join(&change.path), &change.path)?,
                            GIT_FILE_LIMIT,
                        )?
                    } else {
                        Vec::new()
                    };
                    let mode = if metadata.mode() & 0o111 != 0 {
                        0o100755
                    } else {
                        0o100644
                    };
                    bytes.insert(change.path.clone(), (content, mode, reason));
                }
            }
            let exclusion = bytes.get(&change.path).and_then(|(_, _, reason)| *reason);
            files.push(GitRecordFile {
                path: change.path.clone(),
                size: size as f64,
                status: if change.disk_status == "D" {
                    GitRecordStatus::Deleted
                } else if change.untracked || change.index_status == "A" {
                    GitRecordStatus::Added
                } else {
                    GitRecordStatus::Modified
                },
                default_selected: exclusion.is_none() && !change.staged,
                exclusion,
                staged: change.staged,
            });
        }
    } else {
        for (path, (_, _, exclusion)) in &bytes {
            let size = fs::metadata(project.root.join(path))
                .map_err(io_error)?
                .len();
            files.push(GitRecordFile {
                path: path.clone(),
                size: size as f64,
                status: GitRecordStatus::Added,
                default_selected: exclusion.is_none(),
                exclusion: *exclusion,
                staged: false,
            });
        }
    }
    let mut hash = Sha256::new();
    for (path, (content, mode, reason)) in &bytes {
        let metadata = fs::symlink_metadata(project.root.join(path)).map_err(io_error)?;
        hash.update(format!(
            "{path}\0{mode}:{reason:?}:{}:{}:{}:{}:{}",
            metadata.len(),
            metadata.ino(),
            metadata.mtime_nsec(),
            metadata.ctime(),
            metadata.ctime_nsec()
        ));
        hash.update(content);
    }
    let content_fingerprint = format!("{:x}", hash.clone().finalize());
    hash.update(format!("{head:?}{branch:?}"));
    if let Some(repo) = &repo {
        for path in [
            "HEAD",
            "index",
            "config",
            "info/attributes",
            "info/exclude",
            "shallow",
            "packed-refs",
        ] {
            let target = repo.path().join(path);
            match fs::symlink_metadata(&target) {
                Ok(metadata) => {
                    if !metadata.is_file() || metadata.is_symlink() {
                        return Err(refuse("Git metadata must be regular files."));
                    }
                    hash.update(path);
                    hash.update(bounded_read(
                        File::options()
                            .read(true)
                            .custom_flags(libc::O_NOFOLLOW)
                            .open(target)
                            .map_err(io_error)?,
                        GIT_FILE_LIMIT,
                    )?);
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    hash.update(b"missing");
                }
                Err(error) => return Err(io_error(error)),
            }
        }
    }
    Ok(RecordSnapshot {
        repo,
        bytes,
        files,
        fingerprint: format!("{:x}", hash.finalize()),
        content_fingerprint,
        head,
        branch,
    })
}

impl CreationAccess {
    pub fn preview_git_record(
        &mut self,
        identity: &str,
        protection: &Protection,
    ) -> Result<GitRecordPreview, CreationError> {
        self.git_preview = None;
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        // Preserve an explicitly configured identity from an existing repository
        // without inheriting global operational configuration into the engine.
        let resolved_identity = if project.root.join(".git").exists() {
            Repository::open(&project.root)
                .ok()
                .and_then(|repo| repo.signature().ok())
        } else {
            None
        };
        let snapshot = snapshot(project)?;
        let (name, email) = resolved_identity
            .map(|signature| {
                (
                    signature.name().unwrap_or("PNDS Creator").to_owned(),
                    signature
                        .email()
                        .unwrap_or(GIT_PLACEHOLDER_EMAIL)
                        .to_owned(),
                )
            })
            .unwrap_or_else(|| ("PNDS Creator".into(), GIT_PLACEHOLDER_EMAIL.into()));
        self.change_sequence += 1;
        let preview = GitRecordPreview {
            token: format!("git-{identity}-{}", self.change_sequence),
            initial: snapshot.head.is_none(),
            branch: snapshot.branch,
            head: snapshot.head,
            name,
            email,
            files: snapshot.files,
        };
        self.git_preview = Some(GitPreviewSession {
            identity: identity.into(),
            preview: preview.clone(),
            fingerprint: snapshot.fingerprint,
        });
        Ok(preview)
    }
    pub fn confirm_git_record(
        &mut self,
        identity: &str,
        token: &str,
        request: GitRecordRequest,
        protection: &Protection,
    ) -> Result<GitRecordReceipt, CreationError> {
        let session = self
            .git_preview
            .take()
            .filter(|session| session.identity == identity && session.preview.token == token)
            .ok_or_else(|| refuse("This Git preview expired. Preview the saved files again."))?;
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        let current = snapshot(project)?;
        if current.fingerprint != session.fingerprint {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Files, HEAD, index or configuration changed. Preview again.",
            ));
        }
        let signature = local_signature(&request.name, &request.email)?;
        if request.message.trim().is_empty()
            || request.message.len() > 4096
            || request.message.contains('\0')
        {
            return Err(refuse("Enter a version message of at most 4096 bytes."));
        }
        if request.paths.is_empty() {
            return Err(refuse("No saved files were selected."));
        }
        let mut unique = std::collections::BTreeSet::new();
        for path in &request.paths {
            if !unique.insert(path) {
                return Err(refuse("Select each complete file only once."));
            }
            let file = current
                .files
                .iter()
                .find(|file| &file.path == path)
                .ok_or_else(|| refuse("A selected file is no longer in this preview."))?;
            if file.staged {
                return Err(refuse("A selected file has external staged content. Handle it in an external Git tool before recording."));
            }
            if file
                .exclusion
                .as_ref()
                .is_some_and(|reason| *reason != GitExclusion::LargeMedia)
            {
                return Err(refuse(format!("Excluded file cannot be recorded: {path}")));
            }
        }
        let existing_repository = current.repo.is_some();
        let repo = if let Some(repo) = current.repo {
            repo
        } else {
            initialize(&project.root)?
        };
        let result = (|| {
            local_config(&repo)?;
            let updated = snapshot(project)?;
            if updated.content_fingerprint != current.content_fingerprint {
                return Err(CreationError::new(
                    CreationErrorCode::VersionConflict,
                    "Saved files changed during Git preparation. Preview again.",
                ));
            }
            if updated.head != current.head
                || (existing_repository && updated.fingerprint != current.fingerprint)
                || (!existing_repository && repo.path().join("index").exists())
            {
                return Err(CreationError::new(CreationErrorCode::VersionConflict, "HEAD, index or repository configuration changed during preparation. Preview again."));
            }
            let expected = updated.fingerprint;
            for path in &request.paths {
                for attribute in [
                    "filter",
                    "working-tree-encoding",
                    "ident",
                    "text",
                    "eol",
                    "crlf",
                ] {
                    let value = repo
                        .get_attr(Path::new(path), attribute, git2::AttrCheckFlags::NO_SYSTEM)
                        .map_err(git_error)?;
                    if !matches!(
                        git2::AttrValue::from_string(value),
                        git2::AttrValue::Unspecified | git2::AttrValue::False
                    ) {
                        return Err(refuse(format!("{path} uses unsupported {attribute} attributes. Record it with an external Git tool.")));
                    }
                }
            }
            record_saved(&repo, &current.bytes, &request, &signature, || {
                validate_identity(project, protection)?;
                if snapshot_with_locks(project, true)?.fingerprint != expected {
                    return Err(CreationError::new(
                        CreationErrorCode::VersionConflict,
                        "Files, HEAD, index or configuration changed. Preview again.",
                    ));
                }
                Ok(())
            })
        })();
        if current.head.is_none() {
            result.map_err(|error| CreationError::new(error.code, format!("Repository established; initial version incomplete. Preview and retry without deleting the folder. {}", error.detail)))
        } else {
            result
        }
    }
}
// Hold the standard index lock and reference locks across the final check.
// Build the commit from HEAD, and a separate replacement index from the user's
// actual index. Unselected staged entries never become commit inputs.
fn record_saved(
    repo: &Repository,
    files: &SavedFiles,
    request: &GitRecordRequest,
    signature: &git2::Signature<'_>,
    revalidate: impl FnOnce() -> Result<(), CreationError>,
) -> Result<GitRecordReceipt, CreationError> {
    struct IndexLock(PathBuf);
    impl Drop for IndexLock {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }
    let lock_path = repo.path().join("index.lock");
    let mut locked = File::options()
        .write(true)
        .create_new(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&lock_path)
        .map_err(io_error)?;
    let _lock = IndexLock(lock_path.clone());
    let mut transaction = repo.transaction().map_err(git_error)?;
    transaction.lock_ref("HEAD").map_err(git_error)?;
    let head_ref = repo.find_reference("HEAD").map_err(git_error)?;
    let target_ref = head_ref
        .symbolic_target()
        .map_err(git_error)?
        .unwrap_or("HEAD")
        .to_owned();
    if target_ref != "HEAD" {
        transaction.lock_ref(&target_ref).map_err(git_error)?;
    }
    let parent = match repo.head() {
        Ok(head) => Some(head.peel_to_commit().map_err(git_error)?),
        Err(error)
            if matches!(
                error.code(),
                git2::ErrorCode::UnbornBranch | git2::ErrorCode::NotFound
            ) =>
        {
            None
        }
        Err(error) => return Err(git_error(error)),
    };
    let mut selected = git2::Index::new().map_err(git_error)?;
    if let Some(parent) = &parent {
        selected
            .read_tree(&parent.tree().map_err(git_error)?)
            .map_err(git_error)?;
    }
    let temporary = tempfile::tempdir().map_err(io_error)?;
    let index_path = temporary.path().join("index");
    let mut replacement = git2::Index::open(&index_path).map_err(git_error)?;
    let original = native_git::bounded_index(repo)?;
    for item in original.iter() {
        replacement.add(&item).map_err(git_error)?;
    }
    for path in &request.paths {
        if let Some((bytes, mode, _)) = files.get(path) {
            let item = entry(path, bytes, *mode, repo)?;
            selected.add(&item).map_err(git_error)?;
            replacement.add(&item).map_err(git_error)?;
        } else {
            selected.remove_path(Path::new(path)).map_err(git_error)?;
            replacement
                .remove_path(Path::new(path))
                .map_err(git_error)?;
        }
    }
    let tree_id = selected.write_tree_to(repo).map_err(git_error)?;
    if parent
        .as_ref()
        .is_some_and(|parent| parent.tree_id() == tree_id)
    {
        return Err(refuse(
            "No selected saved changes remain; no empty version was recorded.",
        ));
    }
    let tree = repo.find_tree(tree_id).map_err(git_error)?;
    replacement.write().map_err(git_error)?;
    locked
        .write_all(&fs::read(&index_path).map_err(io_error)?)
        .map_err(io_error)?;
    locked.sync_all().map_err(io_error)?;
    revalidate()?;
    let parents: Vec<_> = parent.iter().collect();
    let commit = repo
        .commit(
            None,
            signature,
            signature,
            request.message.trim(),
            &tree,
            &parents,
        )
        .map_err(git_error)?;
    transaction
        .set_target(&target_ref, commit, Some(signature), request.message.trim())
        .map_err(git_error)?;
    let reference_warning = if let Err(error) = transaction.commit() {
        if repo
            .find_reference(&target_ref)
            .ok()
            .and_then(|reference| reference.target())
            != Some(commit)
        {
            return Err(git_error(error));
        }
        Some(format!("Commit {commit} succeeded, but reference bookkeeping failed: {error}. Inspect it with an external Git tool."))
    } else {
        None
    };
    // From here on a real commit exists. Always return its identity, including
    // a partial index/config failure, so a refresh cannot prompt a duplicate.
    let mut warning = fs::rename(&lock_path, repo.path().join("index")).err().map(|error| format!("Commit {commit} succeeded, but index update failed: {error}. Check with an external Git tool before retrying.")).or(reference_warning);
    let config_result = (|| {
        let mut config = repo.config().map_err(git_error)?;
        config
            .set_str("user.name", signature.name().map_err(git_error)?)
            .map_err(git_error)?;
        config
            .set_str("user.email", signature.email().map_err(git_error)?)
            .map_err(git_error)
    })();
    if let Err(error) = config_result {
        warning = Some(format!(
            "Commit {commit} succeeded; local identity persistence failed: {}",
            error.detail
        ));
    }
    Ok(GitRecordReceipt {
        commit: commit.to_string(),
        message: request.message.trim().into(),
        paths: request.paths.clone(),
        warning,
    })
}
