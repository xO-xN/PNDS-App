use super::*;
use crate::project::handoff::{
    append_task, initial_document, HandoffDocument, HandoffTask, HANDOFF_PATH,
};
use std::os::unix::fs::PermissionsExt;

impl CreationAccess {
    pub fn read_handoff(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<HandoffDocument, CreationError> {
        let project = self.current(identity, protection)?;
        let Some(directory) = handoff_directory(project, false)? else {
            return Ok(HandoffDocument {
                text: initial_document(),
                version: None,
            });
        };
        read_document(&directory)
    }

    pub fn append_handoff(
        &self,
        identity: &str,
        task: &HandoffTask,
        expected_version: Option<&str>,
        protection: &Protection,
    ) -> Result<HandoffDocument, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        task.validate()?;
        let previous = self.read_handoff(identity, protection)?;
        // Stable IDs make a retry after a lost command reply idempotent, even if
        // an external agent has since advanced this task's status.
        if previous.text.lines().any(|line| line == task.marker()) {
            return Ok(previous);
        }
        if previous.version.as_deref() != expected_version {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                HANDOFF_PATH,
            ));
        }
        let text = append_task(&previous.text, task);
        if text.len() as u64 > TEXT_MAX_BYTES {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                HANDOFF_PATH,
            ));
        }
        let directory = handoff_directory(project, true)?.expect("created directory");
        let current = read_document(&directory)?;
        if current.version != previous.version {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                HANDOFF_PATH,
            ));
        }
        let mode = open_at(&directory, c"creator-handoff.md", libc::O_RDONLY, 0)?
            .map(|file| file.metadata().map(|meta| meta.permissions()))
            .transpose()
            .map_err(io_error)?
            .unwrap_or_else(|| fs::Permissions::from_mode(0o644));
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let serial = COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let temp = CString::new(format!(".pnds-save-{pid}-{serial}.tmp")).expect("generated name");
        let mut file = open_at(
            &directory,
            &temp,
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
            0o600,
        )?
        .expect("created file");
        let result = (|| {
            file.write_all(text.as_bytes()).map_err(io_error)?;
            file.set_permissions(mode).map_err(io_error)?;
            file.sync_all().map_err(io_error)?;
            validate_identity(project, protection)?;
            let actual_directory = project.file("docs")?.metadata().map_err(io_error)?;
            let held = directory.metadata().map_err(io_error)?;
            if actual_directory.dev() != held.dev() || actual_directory.ino() != held.ino() {
                return Err(CreationError::new(
                    CreationErrorCode::VersionConflict,
                    HANDOFF_PATH,
                ));
            }
            if read_document(&directory)?.version != previous.version {
                return Err(CreationError::new(
                    CreationErrorCode::VersionConflict,
                    HANDOFF_PATH,
                ));
            }
            let fd = directory.as_raw_fd();
            let code = unsafe {
                if previous.version.is_none() {
                    // An absent-file save never replaces a concurrently created task file.
                    libc::linkat(fd, temp.as_ptr(), fd, c"creator-handoff.md".as_ptr(), 0)
                } else {
                    libc::renameat(fd, temp.as_ptr(), fd, c"creator-handoff.md".as_ptr())
                }
            };
            if code != 0 {
                let error = io::Error::last_os_error();
                return Err(if error.kind() == io::ErrorKind::AlreadyExists {
                    CreationError::new(CreationErrorCode::VersionConflict, HANDOFF_PATH)
                } else {
                    io_error(error)
                });
            }
            Ok(HandoffDocument {
                version: Some(file_version(text.as_bytes())),
                text,
            })
        })();
        unsafe {
            libc::unlinkat(directory.as_raw_fd(), temp.as_ptr(), 0);
        }
        result
    }
}

fn open_at(
    directory: &File,
    name: &CStr,
    flags: i32,
    mode: libc::mode_t,
) -> Result<Option<File>, CreationError> {
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            flags | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
            mode as libc::c_uint,
        )
    };
    if fd >= 0 {
        return Ok(Some(unsafe { File::from_raw_fd(fd) }));
    }
    let error = io::Error::last_os_error();
    if error.kind() == io::ErrorKind::NotFound && flags & libc::O_CREAT == 0 {
        return Ok(None);
    }
    if error.raw_os_error() == Some(libc::ELOOP) || error.raw_os_error() == Some(libc::ENOTDIR) {
        return Err(CreationError::new(
            CreationErrorCode::PathEscape,
            HANDOFF_PATH,
        ));
    }
    Err(io_error(error))
}

fn handoff_directory(project: &OpenProject, create: bool) -> Result<Option<File>, CreationError> {
    let opened = open_at(
        &project.directory,
        c"docs",
        libc::O_RDONLY | libc::O_DIRECTORY,
        0,
    )?;
    if opened.is_some() || !create {
        return Ok(opened);
    }
    if unsafe { libc::mkdirat(project.directory.as_raw_fd(), c"docs".as_ptr(), 0o755) } != 0 {
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::AlreadyExists {
            return Err(io_error(error));
        }
    }
    open_at(
        &project.directory,
        c"docs",
        libc::O_RDONLY | libc::O_DIRECTORY,
        0,
    )
}

fn read_document(directory: &File) -> Result<HandoffDocument, CreationError> {
    let Some(file) = open_at(directory, c"creator-handoff.md", libc::O_RDONLY, 0)? else {
        return Ok(HandoffDocument {
            text: initial_document(),
            version: None,
        });
    };
    let bytes = bounded_read(file, TEXT_MAX_BYTES)?;
    let version = Some(file_version(&bytes));
    let text = String::from_utf8(bytes)
        .map_err(|error| CreationError::new(CreationErrorCode::InvalidUtf8, error.to_string()))?;
    Ok(HandoffDocument { text, version })
}
