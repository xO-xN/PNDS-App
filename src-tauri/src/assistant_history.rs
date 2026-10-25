//! Versioned private chat snapshots. History carries evidence, never authority.

mod schema;
pub use schema::*;
#[cfg(test)]
mod tests;

use ring::rand::{SecureRandom, SystemRandom};
use sha2::{Digest, Sha256};
use std::ffi::CString;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use std::sync::Mutex;

const MAX_HISTORY_BYTES: usize = 8 * 1024 * 1024;
const HISTORY_VERSION: u32 = 7;
const HISTORY_NAME: &str = "history.json";
type Publish = fn(&File, &[u8]) -> Result<(), AssistantHistoryError>;

pub struct AssistantHistoryStore {
    /// Covers migration/read/check/stage/publish, including clear.
    access: Mutex<()>,
    publish: Publish,
}
impl Default for AssistantHistoryStore {
    fn default() -> Self {
        Self {
            access: Mutex::new(()),
            publish: publish_atomic,
        }
    }
}

impl AssistantHistoryStore {
    pub fn load_at(
        &self,
        app_data: &Path,
        directory: &File,
        key: &str,
    ) -> Result<AssistantHistory, AssistantHistoryError> {
        let _access = self.access.lock().map_err(|_| AssistantHistoryError::Io)?;
        let history = self.read_or_migrate(app_data, directory, key)?;
        Ok(schema::restore(history))
    }

    pub fn save_at(
        &self,
        app_data: &Path,
        directory: &File,
        key: &str,
        epoch: &str,
        mut messages: Vec<AssistantHistoryMessage>,
    ) -> Result<(), AssistantHistoryError> {
        let _access = self.access.lock().map_err(|_| AssistantHistoryError::Io)?;
        // A corrupt/unknown file cannot silently become an empty overwrite.
        let current = self.read_or_migrate(app_data, directory, key)?;
        if current.epoch != epoch {
            return Err(AssistantHistoryError::StaleHistory);
        }
        for message in &mut messages {
            if message.app_version.is_none() {
                message.app_version = Some(env!("CARGO_PKG_VERSION").to_owned());
            }
        }
        schema::validate_messages(&messages, key)?;
        let file = HistoryFile {
            version: HISTORY_VERSION,
            epoch: current.epoch,
            project_key: key.into(),
            app_version: env!("CARGO_PKG_VERSION").into(),
            messages,
        };
        let bytes = serialize_file(&file)?;
        (self.publish)(directory, &bytes)
    }

    pub fn clear_at(
        &self,
        directory: &File,
        key: &str,
    ) -> Result<AssistantHistory, AssistantHistoryError> {
        let _access = self.access.lock().map_err(|_| AssistantHistoryError::Io)?;
        let history = AssistantHistory {
            epoch: new_epoch()?,
            project_key: key.into(),
            app_version: env!("CARGO_PKG_VERSION").into(),
            messages: vec![],
        };
        let file = HistoryFile {
            version: HISTORY_VERSION,
            epoch: history.epoch.clone(),
            project_key: key.into(),
            app_version: history.app_version.clone(),
            messages: vec![],
        };
        // Only successful publication retires the prior epoch. Explicit clear
        // is also recovery from an unreadable format; ordinary save is not.
        (self.publish)(directory, &serialize_file(&file)?)?;
        Ok(history)
    }

    fn read_or_migrate(
        &self,
        app_data: &Path,
        directory: &File,
        key: &str,
    ) -> Result<AssistantHistory, AssistantHistoryError> {
        let local = read_record(directory, HISTORY_NAME)?;
        let missing = local.is_none();
        let mut file = match local {
            Some(file) => file,
            None => match read_legacy(app_data, key)? {
                Some(file) => file,
                None => HistoryFile {
                    version: HISTORY_VERSION,
                    epoch: new_epoch()?,
                    project_key: key.into(),
                    app_version: env!("CARGO_PKG_VERSION").into(),
                    messages: vec![],
                },
            },
        };
        // Portable records are validated against their original owner first.
        // Then bind display evidence to this physical copy's current owner.
        let relocated = file.project_key != key;
        if relocated {
            file.project_key = key.into();
            file.epoch = new_epoch()?;
            for message in &mut file.messages {
                for attachment in message.attachments.iter_mut().flatten() {
                    attachment.project_key = key.into();
                }
                for proposal in message.proposals.iter_mut().flatten() {
                    proposal.project_key = key.into();
                }
            }
        }
        if missing || relocated {
            file.version = HISTORY_VERSION;
            (self.publish)(directory, &serialize_file(&file)?)?;
        }
        Ok(AssistantHistory {
            epoch: file.epoch,
            project_key: file.project_key,
            app_version: file.app_version,
            messages: file.messages,
        })
    }
}

fn new_epoch() -> Result<String, AssistantHistoryError> {
    let mut bytes = [0; 16];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| AssistantHistoryError::Io)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
/// The creation capability already owns this canonical root. Do not resolve
/// the path again after validating it: disk paths can be replaced concurrently.
pub(crate) fn key_for_root(canonical: &Path) -> String {
    format!("{:x}", Sha256::digest(canonical.as_os_str().as_bytes()))
}

#[cfg(test)]
fn project_key(root: &Path) -> Result<String, AssistantHistoryError> {
    let canonical =
        std::fs::canonicalize(root).map_err(|_| AssistantHistoryError::InvalidIdentity)?;
    if !canonical.is_dir() {
        return Err(AssistantHistoryError::InvalidIdentity);
    }
    Ok(key_for_root(&canonical))
}
#[cfg(test)]
fn history_directory(root: &Path) -> Result<File, AssistantHistoryError> {
    let root = File::open(root).map_err(|_| AssistantHistoryError::Io)?;
    crate::creation_data::open(&root).map_err(|_| AssistantHistoryError::Io)
}
#[cfg(test)]
impl AssistantHistoryStore {
    fn load(&self, data: &Path, root: &Path) -> Result<AssistantHistory, AssistantHistoryError> {
        self.load_at(data, &history_directory(root)?, &project_key(root)?)
    }
    fn save(
        &self,
        data: &Path,
        root: &Path,
        epoch: &str,
        messages: Vec<AssistantHistoryMessage>,
    ) -> Result<(), AssistantHistoryError> {
        self.save_at(
            data,
            &history_directory(root)?,
            &project_key(root)?,
            epoch,
            messages,
        )
    }
    fn clear(&self, _data: &Path, root: &Path) -> Result<AssistantHistory, AssistantHistoryError> {
        self.clear_at(&history_directory(root)?, &project_key(root)?)
    }
}

fn open_record(directory: &File, name: &str) -> Result<Option<File>, AssistantHistoryError> {
    let name = CString::new(name).map_err(|_| AssistantHistoryError::InvalidFormat)?;
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return if std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound {
            Ok(None)
        } else {
            Err(AssistantHistoryError::Io)
        };
    }
    let file = unsafe { File::from_raw_fd(fd) };
    if !file
        .metadata()
        .map_err(|_| AssistantHistoryError::Io)?
        .is_file()
    {
        return Err(AssistantHistoryError::Io);
    }
    Ok(Some(file))
}

fn read_legacy(app_data: &Path, key: &str) -> Result<Option<HistoryFile>, AssistantHistoryError> {
    let directory = match OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(app_data.join("assistant-history"))
    {
        Ok(directory) => directory,
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(AssistantHistoryError::Io),
    };
    let file = read_record(&directory, &format!("{key}.json"))?;
    if file
        .as_ref()
        .is_some_and(|file| file.project_key != key || file.version > 6)
    {
        return Err(AssistantHistoryError::InvalidFormat);
    }
    Ok(file)
}

fn read_record(directory: &File, name: &str) -> Result<Option<HistoryFile>, AssistantHistoryError> {
    let Some(file) = open_record(directory, name)? else {
        return Ok(None);
    };
    if file
        .metadata()
        .map_err(|_| AssistantHistoryError::Io)?
        .len()
        > MAX_HISTORY_BYTES as u64
    {
        return Err(AssistantHistoryError::TooLarge);
    }
    let mut bytes = Vec::new();
    file.take(MAX_HISTORY_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| AssistantHistoryError::Io)?;
    if bytes.len() > MAX_HISTORY_BYTES {
        return Err(AssistantHistoryError::TooLarge);
    }
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| AssistantHistoryError::InvalidFormat)?;
    let version = value
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .ok_or(AssistantHistoryError::InvalidFormat)?;
    if !(1..=u64::from(HISTORY_VERSION)).contains(&version) {
        return Err(AssistantHistoryError::UnsupportedVersion);
    }
    let file: HistoryFile =
        serde_json::from_value(value).map_err(|_| AssistantHistoryError::InvalidFormat)?;
    if file.project_key.len() != 64
        || !file
            .project_key
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || file.epoch.len() != 32
        || !file.epoch.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(AssistantHistoryError::InvalidFormat);
    }
    schema::bounded(&file.app_version, 64, false)?;
    schema::validate_messages(&file.messages, &file.project_key)?;
    Ok(Some(file))
}
fn serialize_file(file: &HistoryFile) -> Result<Vec<u8>, AssistantHistoryError> {
    let bytes = serde_json::to_vec(file).map_err(|_| AssistantHistoryError::InvalidFormat)?;
    if bytes.len() > MAX_HISTORY_BYTES {
        return Err(AssistantHistoryError::TooLarge);
    }
    Ok(bytes)
}
struct StagedHistory<'a> {
    directory: &'a File,
    name: CString,
    file: File,
}
impl Drop for StagedHistory<'_> {
    fn drop(&mut self) {
        unsafe { libc::unlinkat(self.directory.as_raw_fd(), self.name.as_ptr(), 0) };
    }
}
fn stage_file<'a>(
    directory: &'a File,
    bytes: &[u8],
) -> Result<StagedHistory<'a>, AssistantHistoryError> {
    // Explicit clear may repair invalid JSON, but never a redirected file.
    open_record(directory, HISTORY_NAME)?;
    let unique = new_epoch()?;
    let name = CString::new(format!(".history-{unique}")).expect("generated name");
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        return Err(AssistantHistoryError::Io);
    }
    let mut staged = StagedHistory {
        directory,
        name,
        file: unsafe { File::from_raw_fd(fd) },
    };
    staged
        .file
        .write_all(bytes)
        .map_err(|_| AssistantHistoryError::Io)?;
    staged
        .file
        .sync_all()
        .map_err(|_| AssistantHistoryError::Io)?;
    Ok(staged)
}
fn publish_atomic(directory: &File, bytes: &[u8]) -> Result<(), AssistantHistoryError> {
    let staged = stage_file(directory, bytes)?;
    let name = CString::new(HISTORY_NAME).expect("fixed name");
    if unsafe {
        libc::renameat(
            directory.as_raw_fd(),
            staged.name.as_ptr(),
            directory.as_raw_fd(),
            name.as_ptr(),
        )
    } != 0
    {
        return Err(AssistantHistoryError::Io);
    }
    // Rename is publication; a later directory sync cannot undo success.
    let _ = directory.sync_all();
    Ok(())
}
