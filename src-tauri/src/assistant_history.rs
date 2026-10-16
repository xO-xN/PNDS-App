//! Versioned private chat snapshots. History carries evidence, never authority.

mod schema;
pub use schema::*;
#[cfg(test)]
mod tests;

use ring::rand::{SecureRandom, SystemRandom};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const MAX_HISTORY_BYTES: usize = 2 * 1024 * 1024;
const HISTORY_VERSION: u32 = 3;
type Publish = fn(&Path, &[u8]) -> Result<(), AssistantHistoryError>;

pub struct AssistantHistoryStore {
    /// The same lock covers read/check/stage/publish, including clear. Missing
    /// histories need an in-memory epoch until the first successful write.
    epochs: Mutex<HashMap<String, String>>,
    publish: Publish,
}
impl Default for AssistantHistoryStore {
    fn default() -> Self {
        Self {
            epochs: Mutex::new(HashMap::new()),
            publish: publish_atomic,
        }
    }
}

impl AssistantHistoryStore {
    pub fn load(
        &self,
        app_data: &Path,
        root: &Path,
    ) -> Result<AssistantHistory, AssistantHistoryError> {
        let key = project_key(root)?;
        let mut epochs = self.epochs.lock().map_err(|_| AssistantHistoryError::Io)?;
        let path = history_path(app_data, &key)?;
        let history = read_or_empty(&path, &key, &mut epochs)?;
        Ok(schema::restore(history))
    }

    pub fn save(
        &self,
        app_data: &Path,
        root: &Path,
        epoch: &str,
        mut messages: Vec<AssistantHistoryMessage>,
    ) -> Result<(), AssistantHistoryError> {
        let key = project_key(root)?;
        let mut epochs = self.epochs.lock().map_err(|_| AssistantHistoryError::Io)?;
        let path = history_path(app_data, &key)?;
        // A corrupt/unknown file cannot silently become an empty overwrite.
        let current = read_or_empty(&path, &key, &mut epochs)?;
        if current.epoch != epoch {
            return Err(AssistantHistoryError::StaleHistory);
        }
        for message in &mut messages {
            if message.app_version.is_none() {
                message.app_version = Some(env!("CARGO_PKG_VERSION").to_owned());
            }
        }
        schema::validate_messages(&messages, &key)?;
        let file = HistoryFile {
            version: HISTORY_VERSION,
            epoch: current.epoch,
            project_key: key,
            app_version: env!("CARGO_PKG_VERSION").into(),
            messages,
        };
        let bytes = serialize_file(&file)?;
        (self.publish)(&path, &bytes)
    }

    pub fn clear(
        &self,
        app_data: &Path,
        root: &Path,
    ) -> Result<AssistantHistory, AssistantHistoryError> {
        let key = project_key(root)?;
        let mut epochs = self.epochs.lock().map_err(|_| AssistantHistoryError::Io)?;
        let path = history_path(app_data, &key)?;
        let history = AssistantHistory {
            epoch: new_epoch()?,
            project_key: key.clone(),
            app_version: env!("CARGO_PKG_VERSION").into(),
            messages: vec![],
        };
        let file = HistoryFile {
            version: HISTORY_VERSION,
            epoch: history.epoch.clone(),
            project_key: key.clone(),
            app_version: history.app_version.clone(),
            messages: vec![],
        };
        // Only successful publication retires the prior epoch. Explicit clear
        // is also recovery from an unreadable format; ordinary save is not.
        (self.publish)(&path, &serialize_file(&file)?)?;
        epochs.insert(key, history.epoch.clone());
        Ok(history)
    }
}

fn new_epoch() -> Result<String, AssistantHistoryError> {
    let mut bytes = [0; 16];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| AssistantHistoryError::Io)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn project_key(root: &Path) -> Result<String, AssistantHistoryError> {
    let canonical = fs::canonicalize(root).map_err(|_| AssistantHistoryError::InvalidIdentity)?;
    if !canonical.is_dir() {
        return Err(AssistantHistoryError::InvalidIdentity);
    }
    Ok(format!(
        "{:x}",
        Sha256::digest(canonical.as_os_str().as_bytes())
    ))
}
fn history_path(app_data: &Path, key: &str) -> Result<PathBuf, AssistantHistoryError> {
    let directory = app_data.join("assistant-history");
    if let Ok(metadata) = fs::symlink_metadata(&directory) {
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(AssistantHistoryError::Io);
        }
    }
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&directory)
        .map_err(|_| AssistantHistoryError::Io)?;
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
        .map_err(|_| AssistantHistoryError::Io)?;
    Ok(directory.join(format!("{key}.json")))
}
fn read_or_empty(
    path: &Path,
    key: &str,
    epochs: &mut HashMap<String, String>,
) -> Result<AssistantHistory, AssistantHistoryError> {
    let file = match OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let epoch = match epochs.get(key) {
                Some(epoch) => epoch.clone(),
                None => new_epoch()?,
            };
            epochs.insert(key.to_owned(), epoch.clone());
            return Ok(AssistantHistory {
                epoch,
                project_key: key.to_owned(),
                app_version: env!("CARGO_PKG_VERSION").into(),
                messages: vec![],
            });
        }
        Err(_) => return Err(AssistantHistoryError::Io),
    };
    let metadata = file.metadata().map_err(|_| AssistantHistoryError::Io)?;
    if !metadata.is_file() {
        return Err(AssistantHistoryError::Io);
    }
    if metadata.len() > MAX_HISTORY_BYTES as u64 {
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
    if file.project_key != key
        || file.epoch.len() != 32
        || !file.epoch.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(AssistantHistoryError::InvalidFormat);
    }
    schema::bounded(&file.app_version, 64, false)?;
    schema::validate_messages(&file.messages, key)?;
    epochs.insert(key.to_owned(), file.epoch.clone());
    Ok(AssistantHistory {
        epoch: file.epoch,
        project_key: file.project_key,
        app_version: file.app_version,
        messages: file.messages,
    })
}
fn serialize_file(file: &HistoryFile) -> Result<Vec<u8>, AssistantHistoryError> {
    let bytes = serde_json::to_vec(file).map_err(|_| AssistantHistoryError::InvalidFormat)?;
    if bytes.len() > MAX_HISTORY_BYTES {
        return Err(AssistantHistoryError::TooLarge);
    }
    Ok(bytes)
}
fn stage_file(path: &Path, bytes: &[u8]) -> Result<tempfile::NamedTempFile, AssistantHistoryError> {
    let directory = path.parent().ok_or(AssistantHistoryError::Io)?;
    if fs::symlink_metadata(path)
        .is_ok_and(|metadata| !metadata.is_file() || metadata.file_type().is_symlink())
    {
        return Err(AssistantHistoryError::Io);
    }
    let mut staged = tempfile::Builder::new()
        .prefix(".history-")
        .tempfile_in(directory)
        .map_err(|_| AssistantHistoryError::Io)?;
    staged
        .as_file()
        .set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|_| AssistantHistoryError::Io)?;
    staged
        .write_all(bytes)
        .map_err(|_| AssistantHistoryError::Io)?;
    staged
        .as_file()
        .sync_all()
        .map_err(|_| AssistantHistoryError::Io)?;
    Ok(staged)
}
fn publish_atomic(path: &Path, bytes: &[u8]) -> Result<(), AssistantHistoryError> {
    stage_file(path, bytes)?
        .persist(path)
        .map_err(|_| AssistantHistoryError::Io)?;
    // The rename is the publication point; a later directory sync failure
    // cannot truthfully be reported as an unchanged-history failure.
    if let Some(parent) = path.parent() {
        let _ = File::open(parent).and_then(|directory| directory.sync_all());
    }
    Ok(())
}
