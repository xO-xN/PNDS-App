//! A durable terminal flag precedes checkpoint removal and snapshot deletion.
use super::super::assistant_resume;
use super::*;

pub(super) fn open_directory(data: &Path, root: &Path) -> Result<Option<File>, CreationError> {
    if let Some(directory) = private_recovery_directory(data, root, false)? {
        return Ok(Some(directory));
    }
    let mut directory = match fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(data)
    {
        Ok(directory) => directory,
        Err(cause) if cause.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(cause) => return Err(io_error(cause)),
    };
    let path = journal_directory(data, root);
    for name in [
        std::ffi::OsStr::new("assistant-tasks"),
        path.file_name().expect("generated project digest"),
    ] {
        let name = CString::new(name.as_bytes()).expect("generated directory name");
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            let cause = io::Error::last_os_error();
            return if cause.kind() == io::ErrorKind::NotFound {
                Ok(None)
            } else {
                Err(io_error(cause))
            };
        }
        directory = unsafe { File::from_raw_fd(fd) };
    }
    Ok(Some(directory))
}

fn persist_retired(directory: &File, journal: &Journal) -> Result<(), CreationError> {
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    let serial = SERIAL.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|cause| invalid(cause.to_string()))?
        .as_nanos();
    let prefix = temporary_prefix(&journal.root, &journal.directory_identity);
    let temporary =
        CString::new(format!("{prefix}{pid}-{nanos}-{serial}")).expect("generated name");
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            temporary.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        return Err(io_error(io::Error::last_os_error()));
    }
    let mut file = unsafe { File::from_raw_fd(fd) };
    let result = (|| {
        let bytes = serde_json::to_vec(journal).map_err(|cause| invalid(cause.to_string()))?;
        if bytes.len() > 16 * 1024 * 1024 {
            return Err(invalid("Task recovery record is full"));
        }
        file.write_all(&bytes).map_err(io_error)?;
        file.sync_all().map_err(io_error)?;
        let name = CString::new(format!("{}.json", journal.id)).expect("validated task ID");
        if unsafe {
            libc::renameat(
                directory.as_raw_fd(),
                temporary.as_ptr(),
                directory.as_raw_fd(),
                name.as_ptr(),
            )
        } != 0
        {
            return Err(io_error(io::Error::last_os_error()));
        }
        // Do not remove recovery before the terminal flag is durable. A sync
        // failure leaves the flag/full journal available for an idempotent retry.
        directory.sync_all().map_err(io_error)
    })();
    if result.is_err() {
        unsafe { libc::unlinkat(directory.as_raw_fd(), temporary.as_ptr(), 0) };
    }
    result
}

fn temporary_prefix(root: &Path, owner: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(root.as_os_str().as_bytes());
    digest.update(b"\0");
    digest.update(owner.as_bytes());
    format!(".retired-{:x}-", digest.finalize())
}

fn is_temporary(name: &str, prefix: &str) -> bool {
    let Some(suffix) = name.strip_prefix(prefix) else {
        return false;
    };
    let fields: Vec<_> = suffix.split('-').collect();
    fields.len() == 3
        && fields[0].parse::<u32>().is_ok()
        && fields[1].parse::<u128>().is_ok()
        && fields[2].parse::<u64>().is_ok()
}

fn remove_regular(directory: &File, name: &CStr) -> Result<(), CreationError> {
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        let cause = io::Error::last_os_error();
        return if cause.kind() == io::ErrorKind::NotFound
            || cause.raw_os_error() == Some(libc::ELOOP)
        {
            Ok(())
        } else {
            Err(io_error(cause))
        };
    }
    if !unsafe { File::from_raw_fd(fd) }
        .metadata()
        .map_err(io_error)?
        .is_file()
    {
        return Ok(());
    }
    if unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0) } != 0 {
        let cause = io::Error::last_os_error();
        if cause.kind() != io::ErrorKind::NotFound {
            return Err(io_error(cause));
        }
    }
    Ok(())
}

fn mark_retired(
    project: &OpenProject,
    data: &Path,
    id: &str,
    discard_unusable: bool,
) -> Result<(), CreationError> {
    let Some(directory) = open_directory(data, &project.root)? else {
        return Ok(());
    };
    let read = read_from_directory(&directory, &project.root, id);
    let journal = match read {
        Err(cause)
            if discard_unusable
                && matches!(
                    cause.code,
                    CreationErrorCode::TestValidation | CreationErrorCode::TooLarge
                ) =>
        {
            return Ok(());
        }
        result => result?,
    };
    let Some(mut journal) = journal else {
        return Ok(());
    };
    if !journal.retired {
        journal.retired = true;
        persist_retired(&directory, &journal)?;
    } else {
        directory.sync_all().map_err(io_error)?;
    }
    Ok(())
}

struct JournalNames(*mut libc::DIR);

impl JournalNames {
    fn open(directory: &File) -> Result<Self, CreationError> {
        let fd = directory.try_clone().map_err(io_error)?.into_raw_fd();
        let pointer = unsafe { libc::fdopendir(fd) };
        if pointer.is_null() {
            let cause = io::Error::last_os_error();
            drop(unsafe { File::from_raw_fd(fd) });
            return Err(io_error(cause));
        }
        Ok(Self(pointer))
    }

    fn next(&mut self) -> Result<Option<OsString>, CreationError> {
        loop {
            #[cfg(target_os = "macos")]
            unsafe {
                *libc::__error() = 0;
            }
            #[cfg(target_os = "linux")]
            unsafe {
                *libc::__errno_location() = 0;
            }
            let entry = unsafe { libc::readdir(self.0) };
            if entry.is_null() {
                let cause = io::Error::last_os_error();
                return if cause.raw_os_error() == Some(0) {
                    Ok(None)
                } else {
                    Err(io_error(cause))
                };
            }
            let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
            if name.to_bytes() != b"." && name.to_bytes() != b".." {
                return Ok(Some(
                    std::ffi::OsStr::from_bytes(name.to_bytes()).to_os_string(),
                ));
            }
        }
    }
}

impl Drop for JournalNames {
    fn drop(&mut self) {
        unsafe { libc::closedir(self.0) };
    }
}

impl CreationAccess {
    pub(in super::super) fn retire_assistant_task(
        &mut self,
        identity: &str,
        id: &str,
        data: &Path,
        protection: &Protection,
        discard_unusable: bool,
    ) -> Result<(), CreationError> {
        mark_retired(
            self.current(identity, protection)?,
            data,
            id,
            discard_unusable,
        )?;
        self.end_assistant_task(identity, id);
        Ok(())
    }

    pub(in super::super) fn reap_retired_assistant_tasks(
        &self,
        identity: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let project = self.current(identity, protection)?;
        let Some(directory) = open_directory(data, &project.root)? else {
            return Ok(());
        };
        // Unknown recovery must remain inspectable/explicitly clearable. It
        // cannot be interpreted as absence of a reference to a snapshot.
        let mut referenced = match assistant_resume::retirement_reference(project, data) {
            Ok(record) => record,
            Err(_) => return Ok(()),
        };
        // A prior terminal rename may have succeeded before its directory sync
        // failed. Finish that durability barrier before removing any recovery.
        directory.sync_all().map_err(io_error)?;
        if let Some(id) = &referenced {
            if read_from_directory(&directory, &project.root, id)
                .ok()
                .flatten()
                .is_some_and(|journal| journal.retired)
            {
                assistant_resume::remove_checkpoint(project, data, Some(id))?;
                referenced = None;
            }
        }
        // This is App history, not the bounded project inventory. Stream names
        // so a large legacy directory cannot block task creation or recovery.
        let mut names = JournalNames::open(&directory)?;
        let metadata = project.directory.metadata().map_err(io_error)?;
        let owner = format!("{}:{}", metadata.dev(), metadata.ino());
        let temporary = temporary_prefix(&project.root, &owner);
        while let Some(name) = names.next()? {
            if name
                .to_str()
                .is_some_and(|name| is_temporary(name, &temporary))
            {
                // Staging files are never recovery authority. Native operations
                // share one lock, so no current publisher can still own one.
                let name = CString::new(name.as_bytes()).expect("validated temporary name");
                remove_regular(&directory, &name)?;
                continue;
            }
            let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".json")) else {
                continue;
            };
            if referenced.as_deref() == Some(id)
                || self
                    .assistant_grant
                    .as_ref()
                    .is_some_and(|(owner, task, _)| owner == identity && task == id)
            {
                continue;
            }
            let Ok(Some(journal)) = read_from_directory(&directory, &project.root, id) else {
                continue;
            };
            if !journal.retired {
                continue;
            }
            let name = CString::new(name.as_bytes()).expect("validated task filename");
            remove_regular(&directory, &name)?;
        }
        directory.sync_all().map_err(io_error)
    }
}

#[cfg(test)]
mod tests;
