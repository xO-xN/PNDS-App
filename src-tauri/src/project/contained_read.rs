//! Protected contained file opens shared by static observations and integrity reads.
use super::manifest;
use std::ffi::CString;
use std::fs::File;
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf};

/// Held root and descriptor-relative opens prevent a symlink replacement from
/// turning a contained path into an outside read between resolution and opening.
pub(crate) struct ReadRoot {
    pub(crate) path: PathBuf,
    pub(crate) directory: File,
}
impl ReadRoot {
    pub(crate) fn new(path: &Path) -> Result<Self, String> {
        let path = path
            .canonicalize()
            .map_err(|error| format!("Cannot resolve project directory: {error}"))?;
        let anchor = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open("/")
            .map_err(|error| format!("Cannot open filesystem root: {error}"))?;
        let relative = path.strip_prefix("/").map_err(|error| error.to_string())?;
        let directory = descend(anchor, relative, true)
            .map_err(|error| format!("Cannot read project directory: {error}"))?;
        Ok(Self { path, directory })
    }
    /// A held directory remains readable after rename, but it no longer
    /// represents the selected path if that name now points to another inode.
    pub(crate) fn check_current(&self) -> Result<(), String> {
        let changed =
            || "Project directory changed during inspection; reopen and check again".to_string();
        let current = std::fs::symlink_metadata(&self.path).map_err(|_| changed())?;
        let held = self.directory.metadata().map_err(|_| changed())?;
        if !current.is_dir() || current.dev() != held.dev() || current.ino() != held.ino() {
            return Err(changed());
        }
        Ok(())
    }

    pub(crate) fn open(&self, relative: &str, field: &str) -> Result<File, String> {
        self.check_current()?;
        let resolved = manifest::resolve_within(&self.path, &self.path, relative, field)?;
        let relative = resolved
            .strip_prefix(&self.path)
            .map_err(|error| error.to_string())?;
        let directory = self
            .directory
            .try_clone()
            .map_err(|error| error.to_string())?;
        descend(directory, relative, false).map_err(|error| format!("{field}: {error}"))
    }
}

fn descend(mut directory: File, relative: &Path, final_is_directory: bool) -> Result<File, String> {
    let parts: Vec<_> = relative.components().collect();
    for (index, part) in parts.iter().enumerate() {
        let Component::Normal(name) = part else {
            return Err("Invalid contained path".into());
        };
        let name = CString::new(name.as_bytes()).map_err(|error| error.to_string())?;
        let flags = libc::O_RDONLY
            | libc::O_NOFOLLOW
            | libc::O_CLOEXEC
            | libc::O_NONBLOCK
            | if final_is_directory || index + 1 < parts.len() {
                libc::O_DIRECTORY
            } else {
                0
            };
        let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        directory = unsafe { File::from_raw_fd(fd) };
    }
    Ok(directory)
}
