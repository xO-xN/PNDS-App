use super::*;

pub(super) fn admitted_destination(path: &str) -> Result<(), CreationError> {
    if path.is_empty()
        || path.contains('\\')
        || path.chars().any(char::is_control)
        || path.split('/').any(|part| {
            matches!(part, "" | "." | ".." | ".git" | "node_modules")
                || part.starts_with(".pnds-save-")
        })
    {
        return Err(CreationError::new(CreationErrorCode::PathEscape, path));
    }
    Ok(())
}

pub(super) fn admitted_path(path: &str) -> Result<(), CreationError> {
    admitted_destination(path)?;
    if file_kind(path) != CreationFileKind::Text {
        return Err(CreationError::new(
            CreationErrorCode::InvalidProject,
            "Create a code or text file",
        ));
    }
    Ok(())
}

impl CreationAccess {
    pub fn create_directory(
        &mut self,
        identity: &str,
        path: &str,
        draft_paths: &[String],
        protection: &Protection,
    ) -> Result<String, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        admitted_destination(path)?;
        if draft_paths.len() > MAX_ENTRIES {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                "Too many drafts",
            ));
        }
        let target = project.destination(path)?;
        let relative = target
            .strip_prefix(&project.root)
            .expect("containment checked");
        let canonical = relative.to_string_lossy().into_owned();
        admitted_destination(&canonical)?;
        for draft in draft_paths {
            let normalized: PathBuf = Path::new(draft)
                .components()
                .filter(|component| !matches!(component, Component::CurDir))
                .collect();
            match project.destination(&normalized.to_string_lossy()) {
                Ok(destination) if destination == target => {
                    return Err(CreationError::new(CreationErrorCode::TargetExists, path))
                }
                Ok(_) => {}
                Err(error) if error.code == CreationErrorCode::Missing => {}
                Err(error) => return Err(error),
            }
        }
        let mut count = 0;
        project.walk(
            Path::new(""),
            0,
            &mut count,
            &mut Vec::new(),
            &mut Vec::new(),
        )?;
        if count >= MAX_ENTRIES || relative.components().count() > MAX_DEPTH {
            return Err(CreationError::new(CreationErrorCode::TooLarge, path));
        }
        let directory =
            project.file(&relative.parent().unwrap_or(Path::new("")).to_string_lossy())?;
        let name = CString::new(relative.file_name().expect("validated name").as_bytes())
            .map_err(|_| CreationError::new(CreationErrorCode::PathEscape, path))?;
        validate_identity(project, protection)?;
        // mkdirat never replaces a file or symlink; the held parent cannot be redirected.
        if unsafe { libc::mkdirat(directory.as_raw_fd(), name.as_ptr(), 0o755) } < 0 {
            let error = io::Error::last_os_error();
            return Err(if error.kind() == io::ErrorKind::AlreadyExists {
                CreationError::new(CreationErrorCode::TargetExists, path)
            } else {
                io_error(error)
            });
        }
        Ok(canonical)
    }

    /// Manual creation publishes one empty text file. Existing files and
    /// recoverable drafts are never replaced; subsequent edits use normal save.
    pub fn create_text_file(
        &mut self,
        identity: &str,
        path: &str,
        draft_paths: &[String],
        protection: &Protection,
    ) -> Result<CreationFile, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        admitted_path(path)?;
        if draft_paths.len() > MAX_ENTRIES {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                "Too many drafts",
            ));
        }
        let target = project.destination(path)?;
        let relative = target
            .strip_prefix(&project.root)
            .expect("containment checked");
        let canonical = relative.to_string_lossy().into_owned();
        admitted_path(&canonical)?;
        match fs::symlink_metadata(&target) {
            Ok(_) => return Err(CreationError::new(CreationErrorCode::TargetExists, path)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error(error)),
        }
        for draft in draft_paths {
            // Existing reads permit a leading `./`; it is the same draft as
            // the canonical relative path, not an escape in a new destination.
            // Keep root/parent components so destination still rejects them.
            let draft: PathBuf = Path::new(draft)
                .components()
                .filter(|component| !matches!(component, Component::CurDir))
                .collect();
            match project.destination(&draft.to_string_lossy()) {
                Ok(destination) if destination == target => {
                    return Err(CreationError::new(CreationErrorCode::TargetExists, path));
                }
                Ok(_) => {}
                Err(error) if error.code == CreationErrorCode::Missing => {}
                Err(error) => return Err(error),
            }
        }
        let mut entries = 0;
        project.walk(
            Path::new(""),
            0,
            &mut entries,
            &mut Vec::new(),
            &mut Vec::new(),
        )?;
        if entries >= MAX_ENTRIES || relative.components().count() > MAX_DEPTH + 1 {
            return Err(CreationError::new(CreationErrorCode::TooLarge, path));
        }
        let parent = relative.parent().unwrap_or(Path::new(""));
        let directory = project.file(&parent.to_string_lossy())?;
        let name = CString::new(relative.file_name().expect("validated name").as_bytes())
            .map_err(|_| CreationError::new(CreationErrorCode::PathEscape, path))?;
        validate_identity(project, protection)?;
        // O_EXCL also refuses dangling symlinks and targets created by another
        // process. The held parent fd prevents a symlink swap redirecting creation.
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o644,
            )
        };
        if fd < 0 {
            let error = io::Error::last_os_error();
            return Err(if error.kind() == io::ErrorKind::AlreadyExists {
                CreationError::new(CreationErrorCode::TargetExists, path)
            } else {
                io_error(error)
            });
        }
        drop(unsafe { File::from_raw_fd(fd) });
        self.last_change = None;
        Ok(CreationFile {
            path: canonical.clone(),
            size: 0.0,
            kind: CreationFileKind::Text,
            category: category(&canonical),
        })
    }
}
