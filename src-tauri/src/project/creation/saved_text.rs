//! Bind a logical editor path once, then recheck its captured saved target.
use super::text_publication::{publish_text_at, PublicationState, PublishPolicy, TextPublication};
use super::*;

struct SavedTextTarget<'a> {
    directory: File,
    canonical_parent: PathBuf,
    name: CString,
    path: &'a str,
    expected_version: &'a str,
    permissions: fs::Permissions,
}

impl<'a> SavedTextTarget<'a> {
    fn capture(
        project: &OpenProject,
        path: &'a str,
        expected_version: &'a str,
    ) -> Result<Self, CreationError> {
        // This is the only resolution of the logical path/alias. Every later
        // open and publication uses the captured canonical parent and basename.
        let canonical = project.resolve(path)?;
        if canonical == project.root {
            return Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                "Select a regular file",
            ));
        }
        let canonical_parent = canonical
            .parent()
            .ok_or_else(|| CreationError::new(CreationErrorCode::InvalidProject, path))?
            .to_path_buf();
        let directory = project.resolved_file(&canonical_parent, path)?;
        let name = CString::new(
            canonical
                .file_name()
                .ok_or_else(|| CreationError::new(CreationErrorCode::InvalidProject, path))?
                .as_bytes(),
        )
        .map_err(|_| CreationError::new(CreationErrorCode::InvalidProject, path))?;
        let file = open_target(&directory, &name).map_err(io_error)?;
        let metadata = file.metadata().map_err(io_error)?;
        if !metadata.is_file() {
            return Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                "Select a regular file",
            ));
        }
        let existing = bounded_read(file, TEXT_MAX_BYTES)?;
        if file_version(&existing) != expected_version {
            return Err(CreationError::new(CreationErrorCode::VersionConflict, path));
        }
        Ok(Self {
            directory,
            canonical_parent,
            name,
            path,
            expected_version,
            permissions: metadata.permissions(),
        })
    }

    fn recheck(&self, project: &OpenProject, protection: &Protection) -> Result<(), CreationError> {
        validate_identity(project, protection)?;
        let conflict = || CreationError::new(CreationErrorCode::VersionConflict, self.path);
        let current = project
            .resolved_file(&self.canonical_parent, self.path)
            .map_err(|_| conflict())?
            .metadata()
            .map_err(|_| conflict())?;
        let held = self.directory.metadata().map_err(io_error)?;
        if !current.is_dir() || current.dev() != held.dev() || current.ino() != held.ino() {
            return Err(conflict());
        }
        let file = open_target(&self.directory, &self.name).map_err(|_| conflict())?;
        let bytes = bounded_read(file, TEXT_MAX_BYTES).map_err(|_| conflict())?;
        if file_version(&bytes) != self.expected_version {
            return Err(conflict());
        }
        Ok(())
    }
}

fn open_target(directory: &File, name: &CStr) -> io::Result<File> {
    // NONBLOCK prevents a concurrently substituted FIFO from blocking a save;
    // bounded_read rejects every non-regular target before reading its bytes.
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
        )
    };
    if descriptor < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: successful openat transferred a new owned descriptor.
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

pub(super) fn publish(
    project: &OpenProject,
    path: &str,
    text: &str,
    expected_version: &str,
    protection: &Protection,
) -> Result<(), CreationError> {
    let target = SavedTextTarget::capture(project, path, expected_version)?;
    let receipt = publish_text_at(
        TextPublication {
            directory: &target.directory,
            name: &target.name,
            bytes: text.as_bytes(),
            policy: PublishPolicy::Replace {
                permissions: target.permissions.clone(),
            },
        },
        || target.recheck(project, protection),
    )?;
    debug_assert!(matches!(receipt.state, PublicationState::Installed));
    Ok(())
}
