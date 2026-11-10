//! Recording files belong to a held directory, never to a later resolution of its path.
use super::{PerformanceRecord, MAX_BYTES};
use sha2::{Digest, Sha256};
use std::ffi::{CStr, CString};
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, IntoRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const DIRECTORY: &str = "recordings";
const READY: &str = "storage.ready";
const VERSION: &[u8] = b"1\n";

#[derive(Clone)]
pub(crate) struct RecordingStore {
    directory: Arc<File>,
    readonly: bool,
    private: bool,
}

impl RecordingStore {
    /// App-owned/built-in sources retain their existing local catalog.
    pub(crate) fn app_local(data: &Path, key: &str) -> Result<Self, String> {
        if key.is_empty()
            || key.len() > 128
            || !key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(invalid());
        }
        let data = open_root(data).map_err(unavailable)?;
        let recordings = directory_at(&data, DIRECTORY, true, false)?;
        let directory = directory_at(&recordings, key, true, false)?;
        Ok(Self::new(directory, false, false))
    }

    #[cfg(test)]
    pub(crate) fn project(data: &Path, root: &Path) -> Result<Self, String> {
        let canonical = std::fs::canonicalize(root).map_err(unavailable)?;
        let root = open_root(&canonical).map_err(unavailable)?;
        Self::project_at(data, &canonical, &root)
    }

    /// The caller classifies and verifies this exact root before granting writes.
    /// Its path is only provenance for the legacy hash, never an I/O authority.
    pub(crate) fn project_at(data: &Path, canonical: &Path, root: &File) -> Result<Self, String> {
        validate_project(root)?;
        let private = crate::creation_data::open(root).map_err(unavailable)?;
        root.sync_all().map_err(unavailable)?;
        if let Some(directory) = optional_directory(&private, DIRECTORY, true)? {
            validate_ready(&directory)?;
            return Ok(Self::new(directory, false, true));
        }

        // Publish the entire migration together. A crash cannot make a partial
        // catalog authoritative, and an empty initialized catalog never migrates again.
        let staged = StagedDirectory::new(&private)?;
        let key = format!(
            "{:x}",
            Sha256::digest(canonical.to_string_lossy().as_bytes())
        );
        if let Some(source) = legacy_directory(data, &key)? {
            copy_catalog(&source, &staged.directory, true)?;
        }
        write_bytes(&staged.directory, READY, VERSION, false)?;
        match rename_exclusive(&private, &staged.name, c"recordings") {
            Ok(()) => {
                private.sync_all().map_err(unavailable)?;
                Ok(Self::new(
                    staged.directory.try_clone().map_err(unavailable)?,
                    false,
                    true,
                ))
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let directory = directory_at(&private, DIRECTORY, false, true)?;
                validate_ready(&directory)?;
                Ok(Self::new(directory, false, true))
            }
            Err(error) => Err(unavailable(error)),
        }
    }

    /// Reading a protected project must not initialize or migrate private data.
    #[cfg(test)]
    pub(crate) fn project_readonly(root: &Path) -> Result<Self, String> {
        let canonical = std::fs::canonicalize(root).map_err(unavailable)?;
        let root = open_root(&canonical).map_err(unavailable)?;
        Self::project_readonly_at(&root)
    }

    pub(crate) fn project_readonly_at(root: &File) -> Result<Self, String> {
        validate_project(root)?;
        let private = directory_at(root, crate::creation_data::DIRECTORY, false, true)?;
        let directory = directory_at(&private, DIRECTORY, false, true)?;
        validate_ready(&directory)?;
        Ok(Self::new(directory, true, true))
    }

    fn new(directory: File, readonly: bool, private: bool) -> Self {
        Self {
            directory: Arc::new(directory),
            readonly,
            private,
        }
    }

    pub(crate) fn ensure_writable(&self) -> Result<(), String> {
        if self.readonly {
            Err("recording.readOnly".into())
        } else {
            Ok(())
        }
    }

    pub(crate) fn entries(&self) -> Result<Vec<String>, String> {
        let mut records = Vec::new();
        for name in directory_names(&self.directory)? {
            if name.ends_with(".json") {
                record_name(&name)?;
                // A matching filename must be a regular file, never a link or FIFO.
                open_file(&self.directory, &name)?.ok_or_else(invalid)?;
                records.push(name);
            }
        }
        records.sort();
        Ok(records)
    }

    pub(crate) fn read(&self, name: &str) -> Result<PerformanceRecord, String> {
        record_name(name)?;
        let bytes = read_bytes(&self.directory, name, MAX_BYTES)?.ok_or_else(|| {
            unavailable(io::Error::new(
                io::ErrorKind::NotFound,
                "Recording file not found",
            ))
        })?;
        super::read_record_from_bytes(&bytes)
    }

    pub(crate) fn write(&self, name: &str, record: &PerformanceRecord) -> Result<(), String> {
        self.ensure_writable()?;
        record_name(name)?;
        let bytes = serde_json::to_vec(record).map_err(|error| error.to_string())?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("recording.tooLarge".into());
        }
        write_bytes(&self.directory, name, &bytes, true)
    }

    pub(crate) fn remove(&self, name: &str) -> Result<(), String> {
        self.ensure_writable()?;
        record_name(name)?;
        open_file(&self.directory, name)?.ok_or_else(invalid)?;
        unlink(&self.directory, name, false)?;
        self.directory.sync_all().map_err(unavailable)
    }

    pub(crate) fn backup_legacy(&self, name: &str) -> Result<(), String> {
        self.ensure_writable()?;
        record_name(name)?;
        let bytes = read_bytes(&self.directory, name, MAX_BYTES)?.ok_or_else(invalid)?;
        super::read_record_from_bytes(&bytes)?;
        let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
        if value["schemaVersion"] != serde_json::json!(1) {
            return Ok(());
        }
        let legacy = directory_at(&self.directory, "legacy", true, self.private)?;
        if open_file(&legacy, name)?.is_none() {
            write_bytes(&legacy, name, &bytes, false)?;
        }
        Ok(())
    }

    pub(crate) fn same_directory(&self, other: &Self) -> bool {
        self.directory
            .metadata()
            .ok()
            .zip(other.directory.metadata().ok())
            .is_some_and(|(left, right)| left.dev() == right.dev() && left.ino() == right.ino())
    }

    pub(crate) fn reveal_path(&self) -> Result<PathBuf, String> {
        #[cfg(target_os = "macos")]
        {
            let mut bytes = [0u8; libc::PATH_MAX as usize];
            if unsafe {
                libc::fcntl(
                    self.directory.as_raw_fd(),
                    libc::F_GETPATH,
                    bytes.as_mut_ptr(),
                )
            } < 0
            {
                return Err(unavailable(io::Error::last_os_error()));
            }
            let path = unsafe { CStr::from_ptr(bytes.as_ptr().cast()) };
            Ok(PathBuf::from(std::ffi::OsStr::from_bytes(path.to_bytes())))
        }
        #[cfg(not(target_os = "macos"))]
        {
            let fd = self.directory.as_raw_fd();
            std::fs::read_link(format!("/proc/self/fd/{fd}")).map_err(unavailable)
        }
    }
}

fn invalid() -> String {
    "recording.storageInvalid".into()
}
fn unavailable(error: io::Error) -> String {
    format!("recording.storageUnavailable: {error}")
}

fn open_root(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
}

pub(crate) fn validate_project(root: &File) -> Result<(), String> {
    let bytes = read_bytes(root, "manifest.json", 1024 * 1024)?.ok_or_else(invalid)?;
    let text = std::str::from_utf8(&bytes).map_err(|_| invalid())?;
    crate::project::manifest::parse_manifest(text).map(|_| ())
}

fn optional_directory(parent: &File, name: &str, private: bool) -> Result<Option<File>, String> {
    let name = CString::new(name).map_err(|_| invalid())?;
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        let error = io::Error::last_os_error();
        return if error.kind() == io::ErrorKind::NotFound {
            Ok(None)
        } else {
            Err(unavailable(error))
        };
    }
    let directory = unsafe { File::from_raw_fd(fd) };
    if private
        && directory
            .metadata()
            .map_err(unavailable)?
            .permissions()
            .mode()
            & 0o077
            != 0
    {
        return Err(invalid());
    }
    Ok(Some(directory))
}

fn directory_at(parent: &File, name: &str, create: bool, private: bool) -> Result<File, String> {
    if create {
        let name = CString::new(name).map_err(|_| invalid())?;
        if unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) } != 0 {
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::AlreadyExists {
                return Err(unavailable(error));
            }
        } else {
            parent.sync_all().map_err(unavailable)?;
        }
    }
    optional_directory(parent, name, private)?.ok_or_else(|| {
        unavailable(io::Error::new(
            io::ErrorKind::NotFound,
            "Recording directory not found",
        ))
    })
}

fn open_file(directory: &File, name: &str) -> Result<Option<File>, String> {
    let name = CString::new(name).map_err(|_| invalid())?;
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        let error = io::Error::last_os_error();
        return if error.kind() == io::ErrorKind::NotFound {
            Ok(None)
        } else {
            Err(unavailable(error))
        };
    }
    let file = unsafe { File::from_raw_fd(fd) };
    if !file.metadata().map_err(unavailable)?.is_file() {
        return Err(invalid());
    }
    Ok(Some(file))
}

fn read_bytes(directory: &File, name: &str, limit: u64) -> Result<Option<Vec<u8>>, String> {
    let Some(file) = open_file(directory, name)? else {
        return Ok(None);
    };
    if file.metadata().map_err(unavailable)?.len() > limit {
        return Err("recording.tooLarge".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(unavailable)?;
    if bytes.len() as u64 > limit {
        return Err("recording.tooLarge".into());
    }
    Ok(Some(bytes))
}

fn record_name(name: &str) -> Result<(), String> {
    let stem = name.strip_suffix(".json").ok_or_else(invalid)?;
    super::valid_id(stem.strip_prefix("pending-").unwrap_or(stem))
}

fn validate_ready(directory: &File) -> Result<(), String> {
    if read_bytes(directory, READY, 16)?.as_deref() != Some(VERSION) {
        return Err(invalid());
    }
    Ok(())
}

fn legacy_directory(data: &Path, key: &str) -> Result<Option<File>, String> {
    let data = match open_root(data) {
        Ok(data) => data,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(unavailable(error)),
    };
    let Some(recordings) = optional_directory(&data, DIRECTORY, false)? else {
        return Ok(None);
    };
    optional_directory(&recordings, key, false)
}

fn copy_catalog(source: &File, destination: &File, include_legacy: bool) -> Result<(), String> {
    for name in directory_names(source)? {
        if include_legacy && name == "legacy" {
            let legacy_source = directory_at(source, "legacy", false, false)?;
            let legacy_destination = directory_at(destination, "legacy", true, true)?;
            copy_catalog(&legacy_source, &legacy_destination, false)?;
        } else if name.ends_with(".json") {
            record_name(&name)?;
            let bytes = read_bytes(source, &name, MAX_BYTES)?.ok_or_else(invalid)?;
            super::read_record_from_bytes(&bytes)?;
            write_bytes(destination, &name, &bytes, false)?;
        }
    }
    Ok(())
}

fn write_bytes(directory: &File, name: &str, bytes: &[u8], replace: bool) -> Result<(), String> {
    // Refuse an existing redirected destination, including for replacement.
    open_file(directory, name)?;
    let temporary =
        CString::new(format!(".recording-{}", super::random_id()?)).expect("generated name");
    let name = CString::new(name).map_err(|_| invalid())?;
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            temporary.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        return Err(unavailable(io::Error::last_os_error()));
    }
    let mut file = unsafe { File::from_raw_fd(fd) };
    let result = (|| {
        file.write_all(bytes).map_err(unavailable)?;
        file.sync_all().map_err(unavailable)?;
        if replace {
            if unsafe {
                libc::renameat(
                    directory.as_raw_fd(),
                    temporary.as_ptr(),
                    directory.as_raw_fd(),
                    name.as_ptr(),
                )
            } != 0
            {
                return Err(unavailable(io::Error::last_os_error()));
            }
        } else {
            rename_exclusive(directory, &temporary, &name).map_err(unavailable)?;
        }
        directory.sync_all().map_err(unavailable)
    })();
    unsafe {
        libc::unlinkat(directory.as_raw_fd(), temporary.as_ptr(), 0);
    }
    result
}

fn rename_exclusive(directory: &File, from: &CStr, to: &CStr) -> io::Result<()> {
    let fd = directory.as_raw_fd();
    #[cfg(target_os = "macos")]
    let result =
        unsafe { libc::renameatx_np(fd, from.as_ptr(), fd, to.as_ptr(), libc::RENAME_EXCL) };
    #[cfg(not(target_os = "macos"))]
    let result =
        unsafe { libc::renameat2(fd, from.as_ptr(), fd, to.as_ptr(), libc::RENAME_NOREPLACE) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn unlink(directory: &File, name: &str, is_directory: bool) -> Result<(), String> {
    let name = CString::new(name).map_err(|_| invalid())?;
    if unsafe {
        libc::unlinkat(
            directory.as_raw_fd(),
            name.as_ptr(),
            if is_directory { libc::AT_REMOVEDIR } else { 0 },
        )
    } != 0
    {
        return Err(unavailable(io::Error::last_os_error()));
    }
    Ok(())
}

struct StagedDirectory<'a> {
    parent: &'a File,
    name: CString,
    directory: File,
}

impl<'a> StagedDirectory<'a> {
    fn new(parent: &'a File) -> Result<Self, String> {
        let name = format!(".recordings-{}", super::random_id()?);
        let directory = directory_at(parent, &name, true, true)?;
        Ok(Self {
            parent,
            name: CString::new(name).expect("generated name"),
            directory,
        })
    }
}

impl Drop for StagedDirectory<'_> {
    fn drop(&mut self) {
        // After publication the old staging name is absent; never empty the
        // held directory then, because that descriptor now owns the live catalog.
        let Ok(Some(current)) =
            optional_directory(self.parent, self.name.to_str().unwrap_or(""), true)
        else {
            return;
        };
        let same = current
            .metadata()
            .ok()
            .zip(self.directory.metadata().ok())
            .is_some_and(|(left, right)| left.dev() == right.dev() && left.ino() == right.ino());
        if same {
            let _ = remove_staging_contents(&self.directory);
            unsafe {
                libc::unlinkat(
                    self.parent.as_raw_fd(),
                    self.name.as_ptr(),
                    libc::AT_REMOVEDIR,
                );
            }
        }
    }
}

fn remove_staging_contents(directory: &File) -> Result<(), String> {
    for name in directory_names(directory)? {
        let c_name = CString::new(name.as_str()).map_err(|_| invalid())?;
        let mut metadata: libc::stat = unsafe { std::mem::zeroed() };
        if unsafe {
            libc::fstatat(
                directory.as_raw_fd(),
                c_name.as_ptr(),
                &mut metadata,
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } != 0
        {
            return Err(unavailable(io::Error::last_os_error()));
        }
        let is_directory = metadata.st_mode & libc::S_IFMT == libc::S_IFDIR;
        if is_directory {
            let child = directory_at(directory, &name, false, true)?;
            remove_staging_contents(&child)?;
        }
        unlink(directory, &name, is_directory)?;
    }
    Ok(())
}

fn directory_names(directory: &File) -> Result<Vec<String>, String> {
    struct Directory(*mut libc::DIR);
    impl Drop for Directory {
        fn drop(&mut self) {
            unsafe {
                libc::closedir(self.0);
            }
        }
    }
    // Opening '.' gives this scan an independent offset; dup would share it
    // with earlier scans of the long-lived directory descriptor.
    let file = directory_at(directory, ".", false, false)?;
    let fd = file.into_raw_fd();
    let pointer = unsafe { libc::fdopendir(fd) };
    if pointer.is_null() {
        drop(unsafe { File::from_raw_fd(fd) });
        return Err(unavailable(io::Error::last_os_error()));
    }
    let directory = Directory(pointer);
    let mut names = Vec::new();
    loop {
        #[cfg(target_os = "macos")]
        unsafe {
            *libc::__error() = 0;
        }
        #[cfg(not(target_os = "macos"))]
        unsafe {
            *libc::__errno_location() = 0;
        }
        let entry = unsafe { libc::readdir(directory.0) };
        if entry.is_null() {
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(0) {
                return Err(unavailable(error));
            }
            break;
        }
        let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
        if matches!(name.to_bytes(), b"." | b"..") {
            continue;
        }
        names.push(name.to_str().map_err(|_| invalid())?.to_owned());
    }
    Ok(names)
}

#[cfg(test)]
mod tests;
