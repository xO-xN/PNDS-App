use super::candidate::{copy_inputs, fresh, mandatory, require_active, require_revision};
use super::text_publication::{
    publish_text_at, CreatePermissions, PublicationState, PublishPolicy, TextPublication,
};
use super::*;

fn parent_at(root: &File, path: &str, create: bool) -> Result<(File, CString), CreationError> {
    let parts = path.split('/').collect::<Vec<_>>();
    if parts.is_empty()
        || parts.iter().any(|part| {
            part.is_empty() || matches!(*part, "." | "..") || part.contains(['\\', '\0'])
        })
    {
        return Err(invalid("Invalid publication path"));
    }
    let mut directory = root.try_clone().map_err(io_error)?;
    for part in &parts[..parts.len() - 1] {
        let name = CString::new(*part).map_err(|_| invalid("Invalid publication directory"))?;
        if create && unsafe { libc::mkdirat(directory.as_raw_fd(), name.as_ptr(), 0o755) } != 0 {
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::AlreadyExists {
                return Err(io_error(error));
            }
        }
        if create {
            directory.sync_all().map_err(io_error)?;
        }
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(io_error(io::Error::last_os_error()));
        }
        directory = unsafe { File::from_raw_fd(fd) };
    }
    Ok((
        directory,
        CString::new(*parts.last().expect("nonempty path"))
            .map_err(|_| invalid("Invalid publication name"))?,
    ))
}
fn observed(project: &OpenProject, path: &str) -> Result<Option<Entry>, CreationError> {
    valid_path(path)?;
    let parent = parent_at(&project.directory, path, false);
    let (directory, name) = match parent {
        Ok(parent) => parent,
        Err(error) if error.code == CreationErrorCode::Missing => return Ok(None),
        Err(error) => return Err(error),
    };
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        let error = io::Error::last_os_error();
        return if error.kind() == io::ErrorKind::NotFound {
            Ok(None)
        } else {
            Err(io_error(error))
        };
    }
    let file = unsafe { File::from_raw_fd(fd) };
    let metadata = file.metadata().map_err(io_error)?;
    if !metadata.is_file() {
        return Err(conflict(format!(
            "An external non-file blocks merge publication: {path}"
        )));
    }
    let bytes = bounded_read(file, local_git::GIT_FILE_LIMIT)?;
    Ok(Some(Entry {
        oid: Oid::hash_object(ObjectType::Blob, &bytes)
            .map_err(git)?
            .to_string(),
        mode: if metadata.mode() & 0o111 != 0 {
            0o100755
        } else {
            0o100644
        },
    }))
}
fn index_version(repo: &Repository) -> Result<Option<String>, CreationError> {
    let path = repo.path().join("index");
    match File::options()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
    {
        Ok(file) => Ok(Some(hash(&bounded_read(file, local_git::GIT_FILE_LIMIT)?))),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error(error)),
    }
}
fn real_head(repo: &Repository) -> Result<Vec<u8>, CreationError> {
    bounded_read(
        File::options()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(repo.path().join("HEAD"))
            .map_err(io_error)?,
        TEXT_MAX_BYTES,
    )
}
fn expected_old_head(record: &Record) -> Vec<u8> {
    record.branch.as_ref().map_or_else(
        || format!("{}\n", record.target).into_bytes(),
        |branch| format!("ref: {branch}\n").into_bytes(),
    )
}
fn expected_new_head(publication: &Publication) -> Vec<u8> {
    format!("ref: {}\n", publication.branch).into_bytes()
}
fn inspect_publication(
    project: &OpenProject,
    real: &Repository,
    record: &Record,
) -> Result<(), CreationError> {
    let publication = record
        .publication
        .as_ref()
        .ok_or_else(|| invalid("Missing merge publication intent"))?;
    let head = real_head(real)?;
    if head != expected_old_head(record) && head != expected_new_head(publication) {
        return Err(conflict(
            "HEAD changed externally during publication; preserve the project and use external Git",
        ));
    }
    let actual = match real.find_reference(&publication.branch) {
        Ok(reference) => {
            if reference.symbolic_target().map_err(git)?.is_some() {
                return Err(conflict("The target route became symbolic"));
            }
            reference.target().map(|id| id.to_string())
        }
        Err(error) if error.code() == git2::ErrorCode::NotFound => None,
        Err(error) => return Err(git(error)),
    };
    let old = publication
        .old_branch
        .as_ref()
        .map(|_| record.target.clone());
    if actual != old && actual.as_deref() != Some(publication.result.as_str()) {
        return Err(conflict(
            "The target route changed externally; automatic recovery will not overwrite it",
        ));
    }
    let new_index = base64::engine::general_purpose::STANDARD
        .decode(&publication.new_index)
        .map_err(|error| invalid(error.to_string()))?;
    let actual_index = index_version(real)?;
    if actual_index != publication.old_index
        && actual_index.as_deref() != Some(hash(&new_index).as_str())
    {
        return Err(conflict(
            "The Git index changed externally; automatic recovery will not overwrite it",
        ));
    }
    for path in &publication.paths {
        let value = observed(project, path)?;
        if value.as_ref() != publication.old.get(path)
            && value.as_ref() != publication.new.get(path)
        {
            return Err(conflict(format!(
                "External content is preserved; cannot automatically continue publication: {path}"
            )));
        }
    }
    Ok(())
}
struct Lock {
    directory: File,
    name: CString,
    source: PathBuf,
    renamed: bool,
}
impl Lock {
    fn acquire(directory: &File, name: CString, source: &Path) -> Result<Self, CreationError> {
        let source_metadata = fs::symlink_metadata(source).map_err(io_error)?;
        if !source_metadata.is_file() || source_metadata.is_symlink() {
            return Err(invalid("Invalid private merge lock payload"));
        }
        let source_name = CString::new(source.as_os_str().as_bytes())
            .map_err(|_| invalid("Invalid lock path"))?;
        if unsafe {
            libc::linkat(
                libc::AT_FDCWD,
                source_name.as_ptr(),
                directory.as_raw_fd(),
                name.as_ptr(),
                0,
            )
        } != 0
        {
            let cause = io::Error::last_os_error();
            if cause.kind() != io::ErrorKind::AlreadyExists {
                return Err(io_error(cause));
            }
            let fd = unsafe {
                libc::openat(
                    directory.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if fd < 0 {
                return Err(conflict("An unrelated Git lock prevents merge recovery"));
            }
            let held = unsafe { File::from_raw_fd(fd) };
            let metadata = held.metadata().map_err(io_error)?;
            if metadata.dev() != source_metadata.dev() || metadata.ino() != source_metadata.ino() {
                return Err(conflict("An unrelated Git lock prevents merge recovery"));
            }
        }
        Ok(Self {
            directory: directory.try_clone().map_err(io_error)?,
            name,
            source: source.to_path_buf(),
            renamed: false,
        })
    }
    fn install(&mut self, target: &CStr) -> Result<(), CreationError> {
        let own = fs::metadata(&self.source).map_err(io_error)?;
        let fd = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                self.name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(conflict("Merge publication lock was removed"));
        }
        let held = unsafe { File::from_raw_fd(fd) };
        let metadata = held.metadata().map_err(io_error)?;
        if own.dev() != metadata.dev() || own.ino() != metadata.ino() {
            return Err(conflict("Merge publication lock was replaced"));
        }
        if unsafe {
            libc::renameat(
                self.directory.as_raw_fd(),
                self.name.as_ptr(),
                self.directory.as_raw_fd(),
                target.as_ptr(),
            )
        } != 0
        {
            return Err(io_error(io::Error::last_os_error()));
        }
        self.renamed = true;
        self.directory.sync_all().map_err(io_error)
    }
}
impl Drop for Lock {
    fn drop(&mut self) {
        if self.renamed {
            return;
        }
        let source = fs::metadata(&self.source).ok();
        let fd = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                self.name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return;
        }
        let held = unsafe { File::from_raw_fd(fd) };
        if source
            .zip(held.metadata().ok())
            .is_some_and(|(a, b)| a.dev() == b.dev() && a.ino() == b.ino())
        {
            let _ = unsafe { libc::unlinkat(self.directory.as_raw_fd(), self.name.as_ptr(), 0) };
        }
    }
}
fn stage(path: &Path, bytes: &[u8]) -> Result<(), CreationError> {
    match File::options()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
    {
        Ok(mut file) => {
            file.write_all(bytes).map_err(io_error)?;
            file.sync_all().map_err(io_error)
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            let actual = bounded_read(
                File::options()
                    .read(true)
                    .custom_flags(libc::O_NOFOLLOW)
                    .open(path)
                    .map_err(io_error)?,
                local_git::GIT_FILE_LIMIT,
            )?;
            if actual == bytes {
                Ok(())
            } else {
                Err(conflict("The private merge publication payload changed"))
            }
        }
        Err(error) => Err(io_error(error)),
    }
}
fn replace_stage(path: &Path, bytes: &[u8]) -> Result<(), CreationError> {
    let directory = checked_record_parent(path)?;
    let name = CString::new(
        path.file_name()
            .ok_or_else(|| invalid("Missing private payload name"))?
            .as_bytes(),
    )
    .map_err(|_| invalid("Invalid private payload name"))?;
    let receipt = publish_text_at(
        TextPublication {
            directory: &directory,
            name: &name,
            bytes,
            policy: PublishPolicy::Replace {
                permissions: fs::Permissions::from_mode(0o600),
            },
        },
        || Ok(()),
    )?;
    if receipt.state != PublicationState::Installed {
        return Err(conflict("Private publication payload became occupied"));
    }
    directory.sync_all().map_err(io_error)
}
fn apply_path(
    project: &OpenProject,
    private: &Repository,
    publication: &Publication,
    path: &str,
    protection: &Protection,
) -> Result<(), CreationError> {
    let actual = observed(project, path)?;
    if actual.as_ref() == publication.new.get(path) {
        return Ok(());
    }
    if actual.as_ref() != publication.old.get(path) {
        return Err(conflict(format!(
            "External content changed before publication: {path}"
        )));
    }
    let (directory, name) =
        parent_at(&project.directory, path, publication.new.contains_key(path))?;
    let identity = directory.metadata().map_err(io_error)?;
    let verify = || {
        validate_identity(project, protection)?;
        let (current, _) = parent_at(&project.directory, path, false)?;
        let metadata = current.metadata().map_err(io_error)?;
        if metadata.dev() != identity.dev()
            || metadata.ino() != identity.ino()
            || observed(project, path)?.as_ref() != publication.old.get(path)
        {
            return Err(conflict(format!("Publication target changed: {path}")));
        }
        Ok(())
    };
    if let Some(entry) = publication.new.get(path) {
        let bytes = blob(private, entry)?;
        let policy = if actual.is_some() {
            let target = project.file(path)?;
            let mode = target.metadata().map_err(io_error)?.mode() & 0o666;
            let mode = mode
                | if entry.mode & 0o111 != 0 {
                    (mode & 0o444) >> 2
                } else {
                    0
                };
            PublishPolicy::Replace {
                permissions: fs::Permissions::from_mode(mode),
            }
        } else {
            PublishPolicy::Create {
                permissions: CreatePermissions::Umask(if entry.mode & 0o111 != 0 {
                    0o755
                } else {
                    0o644
                }),
            }
        };
        let receipt = publish_text_at(
            TextPublication {
                directory: &directory,
                name: &name,
                bytes: &bytes,
                policy,
            },
            verify,
        )?;
        if receipt.state != PublicationState::Installed {
            return Err(conflict(format!(
                "Publication path became occupied: {path}"
            )));
        }
        directory.sync_all().map_err(io_error)?;
    } else {
        verify()?;
        if unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0) } != 0 {
            return Err(io_error(io::Error::last_os_error()));
        }
        directory.sync_all().map_err(io_error)?;
    }
    Ok(())
}
#[cfg(test)]
thread_local! {pub(super) static FAULT:std::cell::Cell<Option<usize>>=const{std::cell::Cell::new(None)};}
fn boundary(_step: usize) -> Result<(), CreationError> {
    #[cfg(test)]
    {
        return FAULT.with(|fault| {
            if fault.get() == Some(_step) {
                Err(CreationError::new(
                    CreationErrorCode::Io,
                    format!("Injected publication boundary {_step}"),
                ))
            } else {
                Ok(())
            }
        });
    }
    #[cfg(not(test))]
    Ok(())
}
fn publish(
    project: &OpenProject,
    record: &mut Record,
    protection: &Protection,
) -> Result<(), CreationError> {
    if record.phase == GitMergePhase::Completed {
        return complete_attachments(project, record);
    }
    let real = local_git::write_boundary(&project.root, true)?
        .ok_or_else(|| invalid("The real Git repository disappeared"))?;
    let private = private_repository(project, record)?;
    let publication = record
        .publication
        .clone()
        .ok_or_else(|| invalid("Missing publication intent"))?;
    inspect_publication(project, &real, record)?;
    let operation = operation_path(project, &record.id)?;
    let new_index = base64::engine::general_purpose::STANDARD
        .decode(&publication.new_index)
        .map_err(|error| invalid(error.to_string()))?;
    stage(&operation.join("publication-index"), &new_index)?;
    stage(
        &operation.join("publication-ref"),
        format!("{}\n", publication.result).as_bytes(),
    )?;
    stage(
        &operation.join("publication-head"),
        &expected_new_head(&publication),
    )?;
    let git_directory = File::options()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(real.path())
        .map_err(io_error)?;
    let (ref_directory, ref_name) = parent_at(&git_directory, &publication.branch, true)?;
    let ref_lock_name = CString::new(format!("{}.lock", ref_name.to_string_lossy()))
        .map_err(|_| invalid("Invalid route lock"))?;
    let mut head_lock = Lock::acquire(
        &git_directory,
        CString::new("HEAD.lock").expect("literal"),
        &operation.join("publication-head"),
    )?;
    let mut index_lock = Lock::acquire(
        &git_directory,
        CString::new("index.lock").expect("literal"),
        &operation.join("publication-index"),
    )?;
    let mut route_lock = Lock::acquire(
        &ref_directory,
        ref_lock_name,
        &operation.join("publication-ref"),
    )?;
    inspect_publication(project, &real, record)?;
    validate_identity(project, protection)?;
    boundary(0)?;
    copy_inputs(&private, &real, &[parse(&publication.result)?])?;
    boundary(1)?;
    for (index, path) in publication.paths.iter().enumerate() {
        apply_path(project, &private, &publication, path, protection)?;
        boundary(2 + index)?;
    }
    inspect_publication(project, &real, record)?;
    let route = real
        .find_reference(&publication.branch)
        .ok()
        .and_then(|reference| reference.target());
    if route != Some(parse(&publication.result)?) {
        route_lock.install(&ref_name)?;
    }
    boundary(2 + publication.paths.len())?;
    if real_head(&real)? != expected_new_head(&publication) {
        head_lock.install(&CString::new("HEAD").expect("literal"))?;
    }
    boundary(3 + publication.paths.len())?;
    if index_version(&real)?.as_deref() != Some(hash(&new_index).as_str()) {
        index_lock.install(&CString::new("index").expect("literal"))?;
    }
    boundary(4 + publication.paths.len())?;
    inspect_publication(project, &real, record)?;
    if real_head(&real)? != expected_new_head(&publication)
        || real
            .find_reference(&publication.branch)
            .map_err(git)?
            .target()
            != Some(parse(&publication.result)?)
        || index_version(&real)?.as_deref() != Some(hash(&new_index).as_str())
    {
        return Err(conflict("Publication identity changed before completion"));
    }
    if publication
        .paths
        .iter()
        .any(|path| observed(project, path).ok().flatten().as_ref() != publication.new.get(path))
    {
        return Err(conflict("Published files changed before completion"));
    }
    record.phase = GitMergePhase::Completed;
    record.owner = None;
    record.detail = None;
    save(project, record)?;
    // Attached metadata uses the ordinary repository boundary. Release only our
    // inode-identified locks after durable success, before entering that boundary.
    drop((head_lock, index_lock, route_lock));
    complete_attachments(project, record)
}
fn remove_completed_lock(
    directory: &File,
    name: &CStr,
    source: &Path,
) -> Result<(), CreationError> {
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        let error = io::Error::last_os_error();
        return if error.kind() == io::ErrorKind::NotFound {
            Ok(())
        } else {
            Err(conflict(
                "An unrelated Git lock prevents completed merge cleanup",
            ))
        };
    }
    let held = unsafe { File::from_raw_fd(fd) };
    let metadata = held.metadata().map_err(io_error)?;
    let payload = fs::symlink_metadata(source)
        .map_err(|_| conflict("Cannot identify the completed merge lock"))?;
    if !metadata.is_file()
        || !payload.is_file()
        || payload.is_symlink()
        || metadata.dev() != payload.dev()
        || metadata.ino() != payload.ino()
    {
        return Err(conflict(
            "An unrelated Git lock prevents completed merge cleanup",
        ));
    }
    if unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0) } != 0 {
        return Err(io_error(io::Error::last_os_error()));
    }
    directory.sync_all().map_err(io_error)
}
fn completed_repository(
    project: &OpenProject,
    record: &Record,
) -> Result<Repository, CreationError> {
    let real = local_git::write_boundary(&project.root, true)?
        .ok_or_else(|| invalid("The completed repository disappeared"))?;
    let publication = record
        .publication
        .as_ref()
        .ok_or_else(|| invalid("Missing completed publication result"))?;
    let operation = operation_path(project, &record.id)?;
    let directory = File::options()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(real.path())
        .map_err(io_error)?;
    remove_completed_lock(
        &directory,
        &CString::new("HEAD.lock").expect("literal"),
        &operation.join("publication-head"),
    )?;
    remove_completed_lock(
        &directory,
        &CString::new("index.lock").expect("literal"),
        &operation.join("publication-index"),
    )?;
    let (parent, name) = parent_at(&directory, &publication.branch, false)?;
    let name = CString::new(format!("{}.lock", name.to_string_lossy()))
        .map_err(|_| invalid("Invalid completed route lock"))?;
    remove_completed_lock(&parent, &name, &operation.join("publication-ref"))?;
    repository(project)
}
pub(super) fn complete_attachments(
    project: &OpenProject,
    record: &mut Record,
) -> Result<(), CreationError> {
    if record.phase != GitMergePhase::Completed {
        return Err(invalid("Only a completed merge can retry attached cleanup"));
    }
    let publication = record
        .publication
        .as_ref()
        .ok_or_else(|| invalid("Missing completed publication result"))?;
    let real = completed_repository(project, record)?;
    // Name metadata is an attached step: failure cannot revoke a completed merge.
    if record.relation == GitMergeRelation::Diverged {
        let named = git_version_names::for_save(&real, &record.name).and_then(|name| {
            git_version_names::persist(
                &real,
                &real.find_commit(parse(&publication.result)?).map_err(git)?,
                &name,
            )
        });
        if let Err(error) = named {
            record.detail = Some(format!(
                "The merge is complete; display name metadata needs retry: {}",
                error.detail
            ));
            save(project, record)?;
        }
    }
    if active_id(project)?.as_deref() == Some(record.id.as_str()) {
        let root = private_root(project)?;
        fs::remove_file(root.join(ACTIVE)).map_err(io_error)?;
        File::open(&root)
            .map_err(io_error)?
            .sync_all()
            .map_err(io_error)?;
    }
    Ok(())
}
impl CreationAccess {
    pub fn finish_git_merge(
        &mut self,
        identity: &str,
        id: &str,
        revision: u32,
        author_name: &str,
        author_email: &str,
        protection: &Protection,
    ) -> Result<GitMergeCandidate, CreationError> {
        let project = self.current(identity, protection)?;
        let mut record = load(project, id)?;
        require_revision(&record, revision)?;
        if record.phase == GitMergePhase::Completed {
            complete_attachments(project, &mut record)?;
            let response = dto(project, &record)?;
            if let Some(project) = self.project.as_mut() {
                project.merge_active = false;
            }
            return Ok(response);
        }
        if matches!(
            record.phase,
            GitMergePhase::Publishing | GitMergePhase::Recovery
        ) {
            return self.recover_git_merge(identity, id, revision, protection);
        }
        require_active(&record, None)?;
        fresh(project, &record)?;
        let private = private_repository(project, &record)?;
        mandatory(&private, &record)?;
        let real = repository(project)?;
        let signature = if record.relation == GitMergeRelation::FastForward {
            private
                .find_commit(parse(&record.source)?)
                .map_err(git)?
                .author()
                .to_owned()
        } else {
            let config = local_git::local_config(&real)?;
            let valid_name = |name: &str| {
                !name.trim().is_empty()
                    && name.len() <= 128
                    && !name.contains(['\0', '\n', '\r', '<', '>'])
            };
            let valid_email = |email: &str| {
                !email.trim().is_empty()
                    && email.len() <= 254
                    && !email.contains(['\0', '\n', '\r', '<', '>'])
            };
            let name = config
                .get_string("user.name")
                .ok()
                .filter(|name| valid_name(name))
                .unwrap_or_else(|| author_name.trim().to_owned());
            let email = config
                .get_string("user.email")
                .ok()
                .filter(|email| valid_email(email))
                .unwrap_or_else(|| {
                    if author_email.trim().is_empty() {
                        local_git::GIT_PLACEHOLDER_EMAIL.into()
                    } else {
                        author_email.trim().into()
                    }
                });
            if !valid_name(&name) || !valid_email(&email) {
                return Err(invalid("Enter a valid local Git author name and email"));
            }
            git2::Signature::now(&name, &email).map_err(git)?
        };
        let result = if record.relation == GitMergeRelation::FastForward {
            record.source.clone()
        } else {
            let current = private.find_commit(parse(&record.target)?).map_err(git)?;
            let incoming = private.find_commit(parse(&record.source)?).map_err(git)?;
            let result_tree = private
                .find_tree(tree(&private, &record.entries)?)
                .map_err(git)?;
            private
                .commit(
                    None,
                    &signature,
                    &signature,
                    &record.name,
                    &result_tree,
                    &[&current, &incoming],
                )
                .map_err(git)?
                .to_string()
        };
        sync_private_repository(&private)?;
        let branch = record
            .branch
            .clone()
            .map(Ok)
            .unwrap_or_else(|| git_versions::new_branch_ref(&real, Some("merge")))?;
        let new_tree = private
            .find_tree(tree(&private, &record.entries)?)
            .map_err(git)?;
        let operation = operation_path(project, id)?;
        let prepared = tempfile::Builder::new()
            .prefix("index-")
            .tempdir_in(&operation)
            .map_err(io_error)?;
        let prepared_index = prepared.path().join("index");
        let mut index = git2::Index::open(&prepared_index).map_err(git)?;
        index.read_tree(&new_tree).map_err(git)?;
        index.write().map_err(git)?;
        let new_index = fs::read(&prepared_index).map_err(io_error)?;
        // Pre-intent files are disposable: a failed attempt may be edited or retried.
        // After intent is persisted publish() only accepts the frozen payload bytes.
        replace_stage(
            &operation_path(project, id)?.join("publication-index"),
            &new_index,
        )?;
        replace_stage(
            &operation_path(project, id)?.join("publication-ref"),
            format!("{result}\n").as_bytes(),
        )?;
        replace_stage(
            &operation_path(project, id)?.join("publication-head"),
            format!("ref: {branch}\n").as_bytes(),
        )?;
        boundary(usize::MAX)?;
        record.publication = Some(Publication {
            author_name: signature.name().ok().unwrap_or("").into(),
            author_email: signature.email().ok().unwrap_or("").into(),
            author_time: signature.when().seconds(),
            author_offset: signature.when().offset_minutes(),
            result,
            branch,
            old_branch: record.branch.clone(),
            old_index: index_version(&real)?,
            new_index: base64::engine::general_purpose::STANDARD.encode(new_index),
            paths: changed_paths(&record.current, &record.entries),
            old: record.current.clone(),
            new: record.entries.clone(),
        });
        record.phase = GitMergePhase::Publishing;
        save(project, &record)?;
        if let Err(error) = publish(project, &mut record, protection) {
            record.phase = if record.phase == GitMergePhase::Completed {
                GitMergePhase::Completed
            } else {
                GitMergePhase::Recovery
            };
            record.detail = Some(error.detail.clone());
            save(project, &record)?;
            return Err(error);
        }
        let response = dto(project, &record)?;
        if let Some(project) = self.project.as_mut() {
            project.merge_active = false;
        }
        Ok(response)
    }
    pub fn recover_git_merge(
        &mut self,
        identity: &str,
        id: &str,
        revision: u32,
        protection: &Protection,
    ) -> Result<GitMergeCandidate, CreationError> {
        let project = self.current(identity, protection)?;
        let mut record = load(project, id)?;
        require_revision(&record, revision)?;
        if !matches!(
            record.phase,
            GitMergePhase::Publishing | GitMergePhase::Recovery | GitMergePhase::Completed
        ) {
            return Err(invalid("This candidate has no publication to recover"));
        }
        if let Err(error) = publish(project, &mut record, protection) {
            if record.phase != GitMergePhase::Completed {
                record.phase = GitMergePhase::Recovery;
            }
            record.detail = Some(error.detail.clone());
            save(project, &record)?;
            return Err(error);
        }
        let response = dto(project, &record)?;
        if let Some(project) = self.project.as_mut() {
            project.merge_active = false;
        }
        Ok(response)
    }
}
