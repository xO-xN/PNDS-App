//! Returning to a version restores saved files; HEAD, index and history stay intact.
use super::*;
use git2::{ObjectType, Repository};

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitRestorePreview {
    pub token: String,
    pub commit: String,
    pub paths: Vec<String>,
}
pub(super) struct GitRestoreSession {
    identity: String,
    fingerprint: String,
    checkout_fingerprint: String,
    preview: GitRestorePreview,
}
fn refuse(detail: impl Into<String>) -> CreationError {
    CreationError::new(CreationErrorCode::TestValidation, detail)
}

pub(super) fn target<'a>(
    repo: &'a Repository,
    commit: &str,
) -> Result<git2::Tree<'a>, CreationError> {
    target_tree(repo, commit, &[], false, false)
}
pub(super) fn target_for_switch<'a>(
    repo: &'a Repository,
    commit: &str,
    discarded: &[String],
) -> Result<git2::Tree<'a>, CreationError> {
    target_tree(repo, commit, discarded, true, false)
}

pub(super) fn target_for_switch_preview<'a>(
    repo: &'a Repository,
    commit: &str,
    discarded: &[String],
    discard: bool,
) -> Result<git2::Tree<'a>, CreationError> {
    target_tree(repo, commit, discarded, true, discard)
}

pub(super) fn target_for_sync(
    repo: &Repository,
    commit: git2::Oid,
) -> Result<git2::Tree<'_>, CreationError> {
    let commit = repo.find_commit(commit).map_err(local_git::git_error)?;
    validate_checkout_tree(
        repo,
        commit.tree().map_err(local_git::git_error)?,
        &[],
        true,
        false,
    )
}

fn target_tree<'a>(
    repo: &'a Repository,
    commit: &str,
    discarded: &[String],
    all_routes: bool,
    allow_untracked: bool,
) -> Result<git2::Tree<'a>, CreationError> {
    let selected = if all_routes {
        git_versions::reachable(repo, commit)?
    } else {
        git_history::reachable(repo, commit)?
    };
    validate_checkout_tree(
        repo,
        selected.tree().map_err(local_git::git_error)?,
        discarded,
        false,
        allow_untracked,
    )
}

// Capture defaults are not checkout permissions: tracked ordinary history (including
// archived logs and resources) is restorable, while private/runtime authority is not.
pub(super) fn checkout_protection(path: &str) -> Option<&'static str> {
    if path.contains('\\')
        || path.split('/').any(str::is_empty)
        || Path::new(path).components().any(|part| {
            matches!(
                part,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Some("invalid project-relative paths");
    }
    for part in path.split('/') {
        let name = checkout_name_key(part);
        if private_project_name(&name) {
            return Some("PNDS private project data");
        }
        if matches!(
            name.as_str(),
            ".git" | ".gitattributes" | ".gitmodules" | "." | ".."
        ) {
            return Some("Git metadata or checkout attributes");
        }
        if name.starts_with(".env")
            || matches!(
                name.as_str(),
                "credentials.json" | "secrets.json" | "id_rsa" | "id_ed25519"
            )
            || [".pem", ".key", ".p12", ".pfx"]
                .iter()
                .any(|suffix| name.ends_with(suffix))
        {
            return Some("sensitive credentials or keys");
        }
    }
    None
}

// Status presentation omits private/generated paths; write authority must not.
pub(super) fn require_unstaged(repo: &Repository) -> Result<(), CreationError> {
    let index = native_git::bounded_index(repo)?;
    let head = repo
        .head()
        .and_then(|head| head.peel_to_commit())
        .map_err(local_git::git_error)?;
    let tree = head.tree().map_err(local_git::git_error)?;
    let diff = repo
        .diff_tree_to_index(Some(&tree), Some(&index), None)
        .map_err(local_git::git_error)?;
    if let Some(delta) = diff.deltas().next() {
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default();
        return Err(refuse(format!(
            "External staged changes must be handled before checkout: {path}"
        )));
    }
    Ok(())
}

// Hash the exact current/target file union separately from save inventory. In
// particular excluded/ignored archive bytes must not escape preview ownership.
pub(super) fn checkout_snapshot(
    project: &OpenProject,
    repo: &Repository,
    tree: &git2::Tree<'_>,
) -> Result<(String, Vec<String>), CreationError> {
    use sha2::{Digest, Sha256};
    let index = native_git::bounded_index(repo)?;
    let mut paths = std::collections::BTreeSet::new();
    for entry in index.iter() {
        let path =
            std::str::from_utf8(&entry.path).map_err(|_| refuse("Checkout path is not UTF-8"))?;
        if let Some(reason) = checkout_protection(path) {
            return Err(refuse(format!("Checkout cannot replace {reason}: {path}")));
        }
        paths.insert(path.to_owned());
    }
    let mut target_paths = std::collections::BTreeSet::new();
    let mut pending = vec![(tree.id(), String::new())];
    while let Some((id, prefix)) = pending.pop() {
        let current = repo.find_tree(id).map_err(local_git::git_error)?;
        for entry in current.iter() {
            let name = entry.name().map_err(local_git::git_error)?;
            let path = format!("{prefix}{name}");
            if path.split('/').count() > MAX_DEPTH || paths.len() > MAX_ENTRIES * 2 {
                return Err(refuse(format!(
                    "Checkout exceeds 4096 files / 32 levels: {path}"
                )));
            }
            if entry.kind() == Some(ObjectType::Tree) {
                pending.push((entry.id(), format!("{path}/")));
            } else {
                target_paths.insert(path.clone());
                paths.insert(path);
            }
        }
    }
    let mut hash = Sha256::new();
    let mut total = 0_u64;
    let mut overwritten = Vec::new();
    for path in paths {
        if let Some(reason) = checkout_protection(&path) {
            return Err(refuse(format!("Checkout cannot replace {reason}: {path}")));
        }
        for ancestor in Path::new(&path)
            .ancestors()
            .filter(|path| !path.as_os_str().is_empty())
        {
            if fs::symlink_metadata(project.root.join(ancestor))
                .is_ok_and(|metadata| metadata.is_symlink())
            {
                return Err(refuse(format!("A symbolic path blocks checkout: {path}")));
            }
        }
        hash.update(path.as_bytes());
        hash.update(b"\0");
        let metadata = match fs::symlink_metadata(project.root.join(&path)) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                hash.update(b"missing\0");
                continue;
            }
            Err(error) => return Err(io_error(error)),
        };
        if !metadata.is_file() {
            return Err(refuse(format!(
                "A nonregular saved path blocks checkout: {path}"
            )));
        }
        total += metadata.len();
        if metadata.len() > local_git::GIT_FILE_LIMIT || total > local_git::GIT_TOTAL_LIMIT {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                format!("Saved checkout file exceeds 64 MiB per file / 256 MiB total: {path}"),
            ));
        }
        hash.update(format!(
            "{}:{}:{}:{}:{}:{}:{}\0",
            metadata.len(),
            metadata.mode(),
            metadata.dev(),
            metadata.ino(),
            metadata.mtime(),
            metadata.mtime_nsec(),
            metadata.ctime_nsec()
        ));
        hash.update(bounded_read(
            project.resolved_file(&project.root.join(&path), &path)?,
            local_git::GIT_FILE_LIMIT,
        )?);
        if target_paths.contains(&path) && index.get_path(Path::new(&path), 0).is_none() {
            overwritten.push(path);
        }
    }
    Ok((format!("{:x}", hash.finalize()), overwritten))
}

fn validate_checkout_tree<'a>(
    repo: &Repository,
    tree: git2::Tree<'a>,
    discarded: &[String],
    remote: bool,
    allow_untracked: bool,
) -> Result<git2::Tree<'a>, CreationError> {
    if repo.path().join("info/attributes").exists() {
        return Err(refuse(
            "Repository-local checkout attributes require an external Git tool: .git/info/attributes",
        ));
    }
    let index = native_git::bounded_index(repo)?;
    for entry in index.iter() {
        let path =
            std::str::from_utf8(&entry.path).map_err(|_| refuse("Checkout path is not UTF-8"))?;
        if let Some(reason) = checkout_protection(path) {
            return Err(refuse(format!("Checkout cannot replace {reason}: {path}")));
        }
    }
    if remote
        && index.iter().any(|entry| {
            std::str::from_utf8(&entry.path).is_ok_and(|path| {
                path.split('/')
                    .any(|name| private_project_name(&checkout_name_key(name)))
            })
        })
    {
        return Err(refuse(
            "GitHub updates cannot replace tracked PNDS private project data.",
        ));
    }
    let root = repo
        .workdir()
        .ok_or_else(|| refuse("No project worktree"))?;
    let mut pending = vec![(tree.id(), String::new())];
    let mut bytes = 0;
    let mut entries = 0;
    while let Some((id, prefix)) = pending.pop() {
        let current = repo.find_tree(id).map_err(local_git::git_error)?;
        let mut names = std::collections::BTreeSet::new();
        for entry in current.iter() {
            let name = entry.name().map_err(local_git::git_error)?;
            let checked_name = {
                let name = checkout_name_key(name);
                if !names.insert(name.clone()) {
                    return Err(refuse(format!(
                        "Historical paths collide on a macOS filesystem: {prefix}{name}"
                    )));
                }
                name
            };
            if matches!(
                checked_name.as_str(),
                ".git" | ".gitattributes" | ".gitmodules" | "." | ".."
            ) || name.contains(['/', '\\'])
                || checked_name.is_empty()
            {
                return Err(refuse(
                    format!("Historical Git metadata or attributes require an external Git tool: {prefix}{name}"),
                ));
            }
            let path = format!("{prefix}{name}");
            if let Some(reason) = checkout_protection(&path) {
                return Err(refuse(format!("Checkout cannot restore {reason}: {path}")));
            }
            entries += 1;
            if entries > MAX_ENTRIES || path.split('/').count() > MAX_DEPTH {
                return Err(CreationError::new(
                    CreationErrorCode::TooLarge,
                    format!("Checkout exceeds 4096 entries / 32 levels: {path}"),
                ));
            }
            for ancestor in Path::new(&path)
                .ancestors()
                .filter(|path| !path.as_os_str().is_empty())
            {
                if fs::symlink_metadata(root.join(ancestor))
                    .is_ok_and(|metadata| metadata.is_symlink())
                {
                    return Err(refuse(format!(
                        "A symbolic path blocks restoration: {path}"
                    )));
                }
            }
            let saved = fs::symlink_metadata(root.join(&path));
            if saved.as_ref().is_ok_and(|metadata| metadata.is_symlink()) {
                return Err(refuse(format!(
                    "A symbolic path blocks restoration: {path}"
                )));
            }
            if entry.kind() == Some(ObjectType::Blob)
                && saved.is_ok()
                && index.get_path(Path::new(&path), 0).is_none()
                && !discarded.contains(&path)
                && !allow_untracked
            {
                return Err(refuse(format!(
                    "An untracked or ignored path blocks restoration: {path}"
                )));
            }
            match entry.kind() {
                Some(ObjectType::Tree) => {
                    pending.push((entry.id(), format!("{path}/")));
                }
                Some(ObjectType::Blob) if matches!(entry.filemode(), 0o100644 | 0o100755) => {
                    let (size, kind) = repo
                        .odb()
                        .map_err(local_git::git_error)?
                        .read_header(entry.id())
                        .map_err(local_git::git_error)?;
                    bytes += size as u64;
                    if kind != ObjectType::Blob
                        || size as u64 > local_git::GIT_FILE_LIMIT
                        || bytes > local_git::GIT_TOTAL_LIMIT
                    {
                        return Err(CreationError::new(
                            CreationErrorCode::TooLarge,
                            format!(
                                "Historical file exceeds 64 MiB per file / 256 MiB total: {path}"
                            ),
                        ));
                    }
                }
                _ => {
                    return Err(refuse(format!(
                    "Historical symbolic link or submodule requires an external Git tool: {path}"
                )))
                }
            }
        }
    }
    Ok(tree)
}

pub(super) fn checkout_name_key(name: &str) -> String {
    // These characters are ignored by the HFS name comparison used by Git.
    // In particular, a remote alias must not resolve to PNDS's private paths.
    name.chars()
        .filter(|character| {
            !matches!(character, '\u{200c}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{206a}'..='\u{206f}' | '\u{feff}')
        })
        .flat_map(char::to_lowercase)
        .collect()
}

pub(super) fn private_project_name(name: &str) -> bool {
    name == ".pnds" || name.starts_with(".pnds-")
}
impl CreationAccess {
    pub fn preview_git_restore(
        &mut self,
        identity: &str,
        commit: &str,
        protection: &Protection,
    ) -> Result<GitRestorePreview, CreationError> {
        self.git_restore_preview = None;
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        let (repo, fingerprint) = local_git::clean_restore_snapshot(project, false)?;
        let tree = target(&repo, commit)?;
        let (checkout_fingerprint, _) = checkout_snapshot(project, &repo, &tree)?;
        let head_commit = repo
            .head()
            .and_then(|head| head.peel_to_commit())
            .map_err(local_git::git_error)?;
        let head = target(&repo, &head_commit.id().to_string())?;
        let diff = repo
            .diff_tree_to_tree(Some(&head), Some(&tree), None)
            .map_err(local_git::git_error)?;
        let mut paths = std::collections::BTreeSet::new();
        for delta in diff.deltas() {
            for file in [delta.old_file(), delta.new_file()] {
                if let Some(path) = file.path().and_then(Path::to_str) {
                    paths.insert(path.to_owned());
                }
            }
        }
        if paths.is_empty() {
            return Err(refuse("The saved project already matches this version."));
        }
        let mut options = git2::build::CheckoutBuilder::new();
        options
            .dry_run()
            .update_index(false)
            .overwrite_ignored(false);
        repo.checkout_tree(tree.as_object(), Some(&mut options))
            .map_err(local_git::git_error)?;
        self.change_sequence += 1;
        let preview = GitRestorePreview {
            token: format!("restore-{identity}-{}", self.change_sequence),
            commit: commit.into(),
            paths: paths.into_iter().collect(),
        };
        self.git_restore_preview = Some(GitRestoreSession {
            identity: identity.into(),
            fingerprint,
            checkout_fingerprint,
            preview: preview.clone(),
        });
        Ok(preview)
    }
    pub fn confirm_git_restore(
        &mut self,
        identity: &str,
        token: &str,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let session = self
            .git_restore_preview
            .take()
            .filter(|session| session.identity == identity && session.preview.token == token)
            .ok_or_else(|| refuse("This restore preview expired. Review the version again."))?;
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        let (repo, fingerprint) = local_git::clean_restore_snapshot(project, false)?;
        if fingerprint != session.fingerprint {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Files or Git state changed. Review the version again.",
            ));
        }
        let checked_tree = target(&repo, &session.preview.commit)?;
        if checkout_snapshot(project, &repo, &checked_tree)?.0 != session.checkout_fingerprint {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Checkout files changed; review the restore again.",
            ));
        }
        let lock_path = repo.path().join("index.lock");
        struct IndexLock(PathBuf);
        impl Drop for IndexLock {
            fn drop(&mut self) {
                let _ = fs::remove_file(&self.0);
            }
        }
        let _file = File::options()
            .write(true)
            .create_new(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&lock_path)
            .map_err(io_error)?;
        let _lock = IndexLock(lock_path);
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
        if local_git::clean_restore_snapshot(project, true)?.1 != session.fingerprint {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Files or Git state changed. Review the version again.",
            ));
        }
        validate_identity(project, protection)?;
        let tree = target(&repo, &session.preview.commit)?;
        if checkout_snapshot(project, &repo, &tree)?.0 != session.checkout_fingerprint {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Checkout files changed; review the restore again.",
            ));
        }
        let mut options = git2::build::CheckoutBuilder::new();
        options.safe().update_index(false).overwrite_ignored(false);
        repo.checkout_tree(tree.as_object(), Some(&mut options)).map_err(|error| CreationError::new(CreationErrorCode::Io, format!("Restore did not finish: {error}. HEAD and recorded history remain intact; inspect saved files before retrying.")))?;
        Ok(())
    }
}
