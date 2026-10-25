//! Portable creator records, kept apart from artwork sources and performance bundles.
use std::ffi::CString;
use std::fs::File;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

pub(crate) const DIRECTORY: &str = ".pnds-creation";

pub(crate) fn contains(path: &Path) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .as_encoded_bytes()
            .eq_ignore_ascii_case(DIRECTORY.as_bytes())
    })
}

/// Anchor every operation to the already held project directory. Existing
/// links or widened permissions are errors, never an implicit repair.
pub(crate) fn open(root: &File) -> io::Result<File> {
    let name = CString::new(DIRECTORY).expect("fixed directory name");
    if unsafe { libc::mkdirat(root.as_raw_fd(), name.as_ptr(), 0o700) } != 0 {
        let cause = io::Error::last_os_error();
        if cause.kind() != io::ErrorKind::AlreadyExists {
            return Err(cause);
        }
    }
    let fd = unsafe {
        libc::openat(
            root.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    let directory = unsafe { File::from_raw_fd(fd) };
    if directory.metadata()?.permissions().mode() & 0o077 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Invalid creation data permissions",
        ));
    }
    Ok(directory)
}
