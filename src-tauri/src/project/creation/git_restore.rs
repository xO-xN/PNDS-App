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
    preview: GitRestorePreview,
}
fn refuse(detail: impl Into<String>) -> CreationError {
    CreationError::new(CreationErrorCode::TestValidation, detail)
}

pub(super) fn target<'a>(
    repo: &'a Repository,
    commit: &str,
) -> Result<git2::Tree<'a>, CreationError> {
    target_tree(repo, commit, &[], false)
}
pub(super) fn target_for_switch<'a>(
    repo: &'a Repository,
    commit: &str,
    discarded: &[String],
) -> Result<git2::Tree<'a>, CreationError> {
    target_tree(repo, commit, discarded, true)
}
fn target_tree<'a>(
    repo: &'a Repository,
    commit: &str,
    discarded: &[String],
    all_routes: bool,
) -> Result<git2::Tree<'a>, CreationError> {
    if repo.path().join("info/attributes").exists() {
        return Err(refuse(
            "Repository-local checkout attributes require an external Git tool.",
        ));
    }
    let selected = if all_routes {
        git_versions::reachable(repo, commit)?
    } else {
        git_history::reachable(repo, commit)?
    };
    let tree = selected.tree().map_err(local_git::git_error)?;
    let index = native_git::bounded_index(repo)?;
    let root = repo
        .workdir()
        .ok_or_else(|| refuse("No project worktree"))?;
    let mut pending = vec![(tree.id(), String::new())];
    let mut bytes = 0;
    while let Some((id, prefix)) = pending.pop() {
        let current = repo.find_tree(id).map_err(local_git::git_error)?;
        for entry in current.iter() {
            let name = entry.name().map_err(local_git::git_error)?;
            if matches!(name, ".git" | ".gitattributes" | ".gitmodules")
                || name.contains(['/', '\\'])
                || matches!(name, "." | "..")
            {
                return Err(refuse(
                    "Historical Git metadata or attributes require an external Git tool.",
                ));
            }
            let path = format!("{prefix}{name}");
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
            {
                return Err(refuse(format!(
                    "An untracked or ignored path blocks restoration: {path}"
                )));
            }
            match entry.kind() {
                Some(ObjectType::Tree) => pending.push((entry.id(), format!("{path}/"))),
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
                            "Historical files exceed the supported restore size",
                        ));
                    }
                    if local_git::excluded(&path, size as u64)
                        .is_some_and(|reason| reason != GitExclusion::LargeMedia)
                    {
                        return Err(refuse(format!(
                            "Historical file requires an external Git tool: {path}"
                        )));
                    }
                }
                _ => {
                    return Err(refuse(
                        "Historical symbolic links and submodules require an external Git tool.",
                    ))
                }
            }
        }
    }
    Ok(tree)
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
        target(&repo, &session.preview.commit)?;
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
        let mut options = git2::build::CheckoutBuilder::new();
        options.safe().update_index(false).overwrite_ignored(false);
        repo.checkout_tree(tree.as_object(), Some(&mut options)).map_err(|error| CreationError::new(CreationErrorCode::Io, format!("Restore did not finish: {error}. HEAD and recorded history remain intact; inspect saved files before retrying.")))?;
        Ok(())
    }
}
