//! Task-owned directories use the same grant/journal as saved text. A staged
//! inode is recorded before exclusive publication, closing the mkdir/checkpoint gap.
use super::*;

#[derive(Serialize, Deserialize)]
pub(super) struct DirectoryEntry {
    pub path: String,
    directory_identity: String,
    staging: Option<String>,
    pub undone: bool,
    #[serde(default)]
    pending_remove: bool,
}

fn directory_identity(directory: &File) -> Result<String, CreationError> {
    let metadata = directory.metadata().map_err(io_error)?;
    Ok(format!("{}:{}", metadata.dev(), metadata.ino()))
}
fn admitted(path: &str) -> Result<(), CreationError> {
    text_creation::admitted_destination(path)?;
    if path.len() > 4096 || Path::new(path).components().count() > MAX_DEPTH {
        return Err(CreationError::new(CreationErrorCode::TooLarge, path));
    }
    // Apply exclusions to every prefix; a sensitive directory must not become
    // permissible merely by giving its child an ordinary name.
    let mut prefix = PathBuf::new();
    for component in Path::new(path).components() {
        prefix.push(component);
        if assistant::excluded(&prefix.to_string_lossy()).is_some() {
            return Err(CreationError::new(CreationErrorCode::Permission, path));
        }
    }
    Ok(())
}
fn child(parent: &File, name: &CStr) -> Result<File, CreationError> {
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        let error = io::Error::last_os_error();
        return Err(
            if matches!(error.raw_os_error(), Some(libc::ENOTDIR | libc::ELOOP)) {
                CreationError::new(CreationErrorCode::TargetExists, name.to_string_lossy())
            } else {
                io_error(error)
            },
        );
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}
pub(super) fn direct(project: &OpenProject, path: &str) -> Result<File, CreationError> {
    admitted(path)?;
    let mut held = project.directory.try_clone().map_err(io_error)?;
    for part in path.split('/') {
        let name = CString::new(part).map_err(|_| invalid("Invalid directory name"))?;
        held = child(&held, &name)?;
    }
    Ok(held)
}
fn parent(project: &OpenProject, path: &str) -> Result<(File, CString), CreationError> {
    let relative = Path::new(path);
    let parent = relative.parent().expect("admitted path");
    let held = if parent.as_os_str().is_empty() {
        project.directory.try_clone().map_err(io_error)?
    } else {
        direct(project, &parent.to_string_lossy())?
    };
    let name = CString::new(relative.file_name().expect("admitted path").as_bytes())
        .map_err(|_| invalid("Invalid directory name"))?;
    Ok((held, name))
}
fn conflict(path: &str) -> CreationError {
    CreationError::new(CreationErrorCode::VersionConflict, path)
}

impl CreationAccess {
    pub fn create_assistant_directory(
        &mut self,
        identity: &str,
        id: &str,
        path: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantTask, CreationError> {
        self.authorize_assistant_task(identity, id, true, protection)?;
        admitted(path)?;
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        let mut journal = load(data, &project.root, id)?;
        journal.require_resource_decision()?;
        self.reconcile_assistant_directories(identity, &mut journal, data, protection)?;
        self.verify_assistant_directories(identity, &journal, protection)?;
        let mut count = 0;
        project.walk(
            Path::new(""),
            0,
            &mut count,
            &mut Vec::new(),
            &mut Vec::new(),
        )?;
        let mut held = project.directory.try_clone().map_err(io_error)?;
        let mut prefix = PathBuf::new();
        for part in path.split('/') {
            prefix.push(part);
            let relative = prefix.to_string_lossy().into_owned();
            let name = CString::new(part).map_err(|_| invalid("Invalid directory name"))?;
            match child(&held, &name) {
                Ok(existing) => {
                    held = existing;
                    continue;
                }
                Err(cause) if cause.code == CreationErrorCode::Missing => {}
                Err(cause) => return Err(cause),
            }
            if journal.directories.len() >= 64 || count >= MAX_ENTRIES {
                return Err(CreationError::new(CreationErrorCode::TooLarge, &relative));
            }
            static SERIAL: AtomicU64 = AtomicU64::new(0);
            let serial = SERIAL.fetch_add(1, Ordering::Relaxed);
            let pid = std::process::id();
            let staging = format!(".pnds-save-directory-{pid}-{serial}");
            let temporary = CString::new(staging.as_str()).expect("generated name");
            validate_identity(project, protection)?;
            if unsafe { libc::mkdirat(held.as_raw_fd(), temporary.as_ptr(), 0o755) } != 0 {
                return Err(io_error(io::Error::last_os_error()));
            }
            let created = child(&held, &temporary)?;
            journal.directories.push(DirectoryEntry {
                path: relative.clone(),
                directory_identity: directory_identity(&created)?,
                staging: Some(staging),
                undone: false,
                pending_remove: false,
            });
            // Even if publication succeeds but the next persist fails, the
            // original inode can be reconciled after restarting the App.
            journal.persist(data)?;
            let (current_parent, _) = parent(project, &relative)?;
            if directory_identity(&current_parent)? != directory_identity(&held)? {
                return Err(conflict(&relative));
            }
            validate_identity(project, protection)?;
            #[cfg(target_os = "macos")]
            let result = unsafe {
                libc::renameatx_np(
                    held.as_raw_fd(),
                    temporary.as_ptr(),
                    held.as_raw_fd(),
                    name.as_ptr(),
                    libc::RENAME_EXCL,
                )
            };
            #[cfg(target_os = "linux")]
            let result = unsafe {
                libc::renameat2(
                    held.as_raw_fd(),
                    temporary.as_ptr(),
                    held.as_raw_fd(),
                    name.as_ptr(),
                    libc::RENAME_NOREPLACE,
                )
            };
            if result != 0 {
                let error = io::Error::last_os_error();
                // Publication failed, so the empty staged inode remains ours.
                if directory_identity(&child(&held, &temporary)?)? != directory_identity(&created)?
                {
                    return Err(conflict(&relative));
                }
                if unsafe {
                    libc::unlinkat(held.as_raw_fd(), temporary.as_ptr(), libc::AT_REMOVEDIR)
                } != 0
                {
                    return Err(io_error(io::Error::last_os_error()));
                }
                journal.directories.pop();
                journal.persist(data)?;
                return Err(if error.kind() == io::ErrorKind::AlreadyExists {
                    CreationError::new(CreationErrorCode::TargetExists, relative)
                } else {
                    io_error(error)
                });
            }
            if directory_identity(&direct(project, &relative)?)? != directory_identity(&created)? {
                return Err(conflict(&relative));
            }
            journal.directories.last_mut().expect("just pushed").staging = None;
            journal.persist(data)?;
            count += 1;
            held = created;
        }
        self.last_change = None;
        Ok(journal.summary())
    }

    pub(super) fn verify_assistant_directories(
        &self,
        identity: &str,
        journal: &Journal,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let project = self.current(identity, protection)?;
        for entry in journal.directories.iter().filter(|entry| !entry.undone) {
            if entry.staging.is_some() || entry.pending_remove {
                return Err(conflict(&entry.path));
            }
            let actual = direct(project, &entry.path)
                .and_then(|directory| directory_identity(&directory))
                .map_err(|_| conflict(&entry.path))?;
            if actual != entry.directory_identity {
                return Err(conflict(&entry.path));
            }
        }
        Ok(())
    }

    pub(super) fn reconcile_assistant_directories(
        &self,
        identity: &str,
        journal: &mut Journal,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        if !journal
            .directories
            .iter()
            .any(|entry| !entry.undone && (entry.staging.is_some() || entry.pending_remove))
        {
            return Ok(());
        }
        let project = self.current(identity, protection)?;
        let mut unpublished = Vec::new();
        for (index, entry) in journal.directories.iter_mut().enumerate() {
            admitted(&entry.path)?;
            if entry.undone || (entry.staging.is_none() && !entry.pending_remove) {
                continue;
            }
            match direct(project, &entry.path) {
                Ok(directory) if directory_identity(&directory)? == entry.directory_identity => {
                    entry.staging = None;
                    entry.pending_remove = false;
                }
                Err(cause) if cause.code == CreationErrorCode::Missing => {
                    if entry.pending_remove {
                        entry.undone = true;
                        entry.pending_remove = false;
                    } else if let Some(staging) = &entry.staging {
                        if !staging.starts_with(".pnds-save-directory-") || staging.contains('/') {
                            return Err(conflict(&entry.path));
                        }
                        let (parent, _) = parent(project, &entry.path)?;
                        let temporary =
                            CString::new(staging.as_str()).map_err(|_| conflict(&entry.path))?;
                        if directory_identity(&child(&parent, &temporary)?)?
                            != entry.directory_identity
                        {
                            return Err(conflict(&entry.path));
                        }
                        if unsafe {
                            libc::unlinkat(
                                parent.as_raw_fd(),
                                temporary.as_ptr(),
                                libc::AT_REMOVEDIR,
                            )
                        } != 0
                        {
                            return Err(io_error(io::Error::last_os_error()));
                        }
                        unpublished.push(index);
                    }
                }
                _ => return Err(conflict(&entry.path)),
            }
        }
        for index in unpublished.into_iter().rev() {
            journal.directories.remove(index);
        }
        journal.persist(data)
    }

    pub(super) fn undo_assistant_directories(
        &self,
        identity: &str,
        journal: &mut Journal,
        selected_path: Option<&str>,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let project = self.current(identity, protection)?;
        // Children and task files are removed before their parent directories.
        for index in (0..journal.directories.len()).rev() {
            let entry = &journal.directories[index];
            if entry.undone || selected_path.is_some_and(|path| path != entry.path) {
                continue;
            }
            let (parent, name) = parent(project, &entry.path)?;
            if directory_identity(&child(&parent, &name)?)? != entry.directory_identity {
                return Err(conflict(&entry.path));
            }
            journal.directories[index].pending_remove = true;
            journal.persist(data)?;
            validate_identity(project, protection)?;
            if unsafe { libc::unlinkat(parent.as_raw_fd(), name.as_ptr(), libc::AT_REMOVEDIR) } != 0
            {
                let error = io::Error::last_os_error();
                journal.directories[index].pending_remove = false;
                journal.persist(data)?;
                // Creator files, even in nested directories, keep their parents.
                if error.raw_os_error() == Some(libc::ENOTEMPTY)
                    || error.raw_os_error() == Some(libc::EEXIST)
                {
                    continue;
                }
                return Err(io_error(error));
            }
            journal.directories[index].undone = true;
            journal.directories[index].pending_remove = false;
            journal.persist(data)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interrupted_directory_publication_reconciles_only_the_recorded_inode() {
        for published in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            let root = super::super::super::tests::project(temp.path(), "score");
            let data = temp.path().join("data");
            let protection = Protection::default();
            let mut access = CreationAccess::default();
            let identity = access.open(&root, &protection).unwrap().project.identity;
            let task = access
                .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
                .unwrap();
            access
                .create_assistant_directory(&identity, &task.id, "grid", &data, &protection)
                .unwrap();
            // Simulate the on-disk state at the journal/publication boundary.
            let staging = ".pnds-save-directory-interrupted";
            let mut journal = load(&data, &fs::canonicalize(&root).unwrap(), &task.id).unwrap();
            journal.directories[0].staging = Some(staging.into());
            journal.persist(&data).unwrap();
            if !published {
                fs::rename(root.join("grid"), root.join(staging)).unwrap();
            }
            drop(access);
            let mut access = CreationAccess::default();
            let identity = access.open(&root, &protection).unwrap().project.identity;
            let resumed = access
                .begin_assistant_task(
                    &identity,
                    AssistantMode::Edit,
                    Some(&task.id),
                    &data,
                    &protection,
                )
                .unwrap();
            assert_eq!(resumed.files.len(), usize::from(published));
            assert_eq!(root.join("grid").exists(), published);
            assert!(!root.join(staging).exists());
            access
                .create_assistant_directory(&identity, &task.id, "grid", &data, &protection)
                .unwrap();
            access.end_assistant_task(&identity, &task.id);
            access
                .undo_assistant_task(&identity, &task.id, None, &data, &protection)
                .unwrap();
            assert!(!root.join("grid").exists());
        }
    }

    #[test]
    fn interrupted_empty_directory_removal_is_recoverable_on_undo() {
        let temp = tempfile::tempdir().unwrap();
        let root = super::super::super::tests::project(temp.path(), "score");
        let data = temp.path().join("data");
        let protection = Protection::default();
        let mut access = CreationAccess::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        let task = access
            .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
            .unwrap();
        access
            .create_assistant_directory(&identity, &task.id, "grid", &data, &protection)
            .unwrap();
        let mut journal = load(&data, &fs::canonicalize(&root).unwrap(), &task.id).unwrap();
        journal.directories[0].pending_remove = true;
        journal.persist(&data).unwrap();
        fs::remove_dir(root.join("grid")).unwrap();
        drop(access);
        let mut access = CreationAccess::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        let undone = access
            .undo_assistant_task(&identity, &task.id, None, &data, &protection)
            .unwrap();
        assert_eq!(undone.files.len(), 1);
        assert!(undone.files[0].undone);
        assert!(!root.join("grid").exists());
    }
}
