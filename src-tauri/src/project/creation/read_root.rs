//! Shared held-root path and saved-content reading; no workspace/watch state.
use super::*;

pub(super) struct RootAccess<'a> {
    pub(super) root: &'a Path,
    pub(super) directory: &'a File,
}

impl RootAccess<'_> {
    pub(super) fn resolve(&self, path: &str) -> Result<PathBuf, CreationError> {
        if crate::creation_data::contains(Path::new(path)) {
            return Err(CreationError::new(
                CreationErrorCode::Permission,
                "privateCreationData",
            ));
        }
        if Path::new(path).components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return Err(CreationError::new(CreationErrorCode::PathEscape, path));
        }
        let resolved = fs::canonicalize(self.root.join(path)).map_err(io_error)?;
        if !resolved.starts_with(self.root) {
            return Err(CreationError::new(CreationErrorCode::PathEscape, path));
        }
        if crate::creation_data::contains(resolved.strip_prefix(self.root).expect("contained")) {
            return Err(CreationError::new(
                CreationErrorCode::Permission,
                "privateCreationData",
            ));
        }
        Ok(resolved)
    }

    pub(super) fn file(&self, path: &str) -> Result<File, CreationError> {
        let resolved = self.resolve(path)?;
        self.resolved_file(&resolved, path)
    }

    /// Open exactly the canonical target already checked by the caller. Never
    /// resolve a mutable entry alias again after policy checks.
    pub(super) fn resolved_file(&self, resolved: &Path, path: &str) -> Result<File, CreationError> {
        let relative = resolved
            .strip_prefix(self.root)
            .expect("containment checked");
        if crate::creation_data::contains(relative) {
            return Err(CreationError::new(
                CreationErrorCode::Permission,
                "privateCreationData",
            ));
        }
        // A new open file description keeps directory enumeration cursors
        // independent; dup/try_clone would share the previous walk's cursor.
        let fd = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                c".".as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(io_error(io::Error::last_os_error()));
        }
        let mut handle = unsafe { File::from_raw_fd(fd) };
        // Resolve internal symlinks, then open each canonical component relative
        // to the held root. O_NOFOLLOW closes the canonicalize/open race.
        for component in relative.components() {
            let name = CString::new(component.as_os_str().as_encoded_bytes())
                .map_err(|_| CreationError::new(CreationErrorCode::PathEscape, path))?;
            // SAFETY: live directory fd and NUL-terminated name; ownership of a
            // successful new fd transfers immediately to File.
            let fd = unsafe {
                libc::openat(
                    handle.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
                )
            };
            if fd < 0 {
                return Err(io_error(io::Error::last_os_error()));
            }
            handle = unsafe { File::from_raw_fd(fd) };
        }
        Ok(handle)
    }

    pub(super) fn read(&self, path: &str) -> Result<CreationContent, CreationError> {
        let file = self.file(path)?;
        if !file.metadata().map_err(io_error)?.is_file() {
            return Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                "Select a regular file",
            ));
        }
        match file_kind(path) {
            CreationFileKind::Binary => Ok(CreationContent::Binary),
            CreationFileKind::Image => {
                let bytes = bounded_read(file, IMAGE_MAX_BYTES)?;
                let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
                let mime = image_mime(path).expect("image kind has a MIME type");
                Ok(CreationContent::Image {
                    url: format!("data:{mime};base64,{encoded}"),
                })
            }
            CreationFileKind::Text => {
                let bytes = bounded_read(file, TEXT_MAX_BYTES)?;
                let text = String::from_utf8(bytes).map_err(|e| {
                    CreationError::new(CreationErrorCode::InvalidUtf8, e.to_string())
                })?;
                let version = file_version(text.as_bytes());
                Ok(CreationContent::Text { text, version })
            }
        }
    }
}
