//! Private execution checkpoints contain evidence, never an active permission.
use super::*;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};

const PAYLOAD_MAX_BYTES: usize = 8 * 1024 * 1024;
// The public payload is JSON text; its surrounding JSON string can double it.
const RECORD_MAX_BYTES: u64 = 2 * PAYLOAD_MAX_BYTES as u64 + 512 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AssistantTaskResumeState {
    Running,
    Paused,
    AwaitingResources,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantTaskResume {
    pub task_id: String,
    pub mode: AssistantMode,
    pub user_message_id: String,
    pub reply_message_id: String,
    pub conversation_id: Option<String>,
    pub input: String,
    pub locale: String,
    pub model_key: String,
    pub state: AssistantTaskResumeState,
    /// An explicit frontend checkpoint DTO, without callbacks or credentials.
    /// Native code validates its shape/bounds but never executes its contents.
    pub payload: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTaskResumeFile {
    pub path: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTaskResumeRecovery {
    pub record: AssistantTaskResume,
    pub files: Vec<AssistantTaskResumeFile>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResumeFile {
    schema_version: u32,
    root: PathBuf,
    directory_identity: String,
    record: AssistantTaskResume,
}

fn invalid(detail: &str) -> CreationError {
    CreationError::new(CreationErrorCode::TestValidation, detail)
}

fn bounded(value: &str, limit: usize, empty: bool) -> Result<(), CreationError> {
    if value.len() > limit || (!empty && value.trim().is_empty()) || value.contains('\0') {
        return Err(invalid("Invalid assistant continuation field"));
    }
    Ok(())
}

fn validate(record: &AssistantTaskResume) -> Result<(), CreationError> {
    for value in [
        &record.task_id,
        &record.user_message_id,
        &record.reply_message_id,
    ] {
        bounded(value, 128, false)?;
    }
    if let Some(id) = &record.conversation_id {
        bounded(id, 128, false)?;
    }
    bounded(&record.input, 64 * 1024, false)?;
    bounded(&record.locale, 64, false)?;
    bounded(&record.model_key, 4096, false)?;
    bounded(&record.payload, PAYLOAD_MAX_BYTES, false)?;
    let payload: serde_json::Value = serde_json::from_str(&record.payload)
        .map_err(|_| invalid("Invalid assistant continuation payload"))?;
    if !payload.is_object() {
        return Err(invalid("Assistant continuation payload must be an object"));
    }
    // Check structure, not text: credentials are forbidden everywhere. Provider
    // reasoning is allowed only in the typed assistant messages that need it
    // for protocol replay, never as arbitrary checkpoint metadata or authority.
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Scope {
        Root,
        Continuation,
        Messages,
        Message,
        Other,
    }
    let mut pending = vec![(&payload, Scope::Root)];
    while let Some((value, scope)) = pending.pop() {
        match value {
            serde_json::Value::Object(fields) => {
                for (key, value) in fields {
                    let normalized = key
                        .chars()
                        .filter(|character| *character != '_' && *character != '-')
                        .flat_map(char::to_lowercase)
                        .collect::<String>();
                    if matches!(
                        normalized.as_str(),
                        "apikey"
                            | "authorization"
                            | "credential"
                            | "credentials"
                            | "accesstoken"
                            | "refreshtoken"
                            | "password"
                    ) {
                        return Err(invalid("Private service fields cannot be checkpointed"));
                    }
                    if normalized == "reasoningcontent" {
                        if scope != Scope::Message
                            || key != "reasoningContent"
                            || fields.get("role").and_then(serde_json::Value::as_str)
                                != Some("assistant")
                        {
                            return Err(invalid(
                                "Reasoning must belong to an assistant protocol message",
                            ));
                        }
                        match value {
                            serde_json::Value::Null => {}
                            serde_json::Value::String(text)
                                if text.len() <= crate::model::MAX_REASONING_BYTES => {}
                            _ => return Err(invalid("Invalid assistant protocol reasoning")),
                        }
                    }
                    let next = match (scope, key.as_str()) {
                        (Scope::Root, "continuation") => Scope::Continuation,
                        (Scope::Root, "history") | (Scope::Continuation, "messages") => {
                            Scope::Messages
                        }
                        _ => Scope::Other,
                    };
                    pending.push((value, next));
                }
            }
            serde_json::Value::Array(values) => pending.extend(values.iter().map(|value| {
                (
                    value,
                    if scope == Scope::Messages {
                        Scope::Message
                    } else {
                        Scope::Other
                    },
                )
            })),
            _ => {}
        }
    }
    Ok(())
}

fn open_directory(data: &Path, create: bool) -> Result<Option<File>, CreationError> {
    let path = data.join("assistant-resume");
    if create {
        fs::create_dir_all(data).map_err(io_error)?;
        match fs::DirBuilder::new().mode(0o700).create(&path) {
            Ok(()) => {}
            Err(cause) if cause.kind() == io::ErrorKind::AlreadyExists => {}
            Err(cause) => return Err(io_error(cause)),
        }
    }
    let directory = match fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
    {
        Ok(directory) => directory,
        Err(cause) if !create && cause.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(cause) => return Err(io_error(cause)),
    };
    directory
        .set_permissions(fs::Permissions::from_mode(0o700))
        .map_err(io_error)?;
    Ok(Some(directory))
}

fn file_name(project: &OpenProject) -> Result<CString, CreationError> {
    let mut digest = Sha256::new();
    digest.update(project.root.as_os_str().as_bytes());
    digest.update(b"\0");
    digest.update(directory_identity(project)?.as_bytes());
    let digest = format!("{:x}", digest.finalize());
    Ok(CString::new(format!("{digest}.json")).expect("generated checkpoint name"))
}

fn directory_identity(project: &OpenProject) -> Result<String, CreationError> {
    let metadata = project.directory.metadata().map_err(io_error)?;
    Ok(format!("{}:{}", metadata.dev(), metadata.ino()))
}

fn read_record(
    directory: &File,
    project: &OpenProject,
    data: &Path,
) -> Result<Option<AssistantTaskResume>, CreationError> {
    let name = file_name(project)?;
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
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
    let file = unsafe { File::from_raw_fd(fd) };
    let metadata = file.metadata().map_err(io_error)?;
    if !metadata.is_file() || metadata.permissions().mode() & 0o077 != 0 {
        return Err(invalid("Invalid private assistant continuation file"));
    }
    let bytes = bounded_read(file, RECORD_MAX_BYTES)?;
    let file: ResumeFile = serde_json::from_slice(&bytes)
        .map_err(|_| invalid("Invalid assistant continuation record"))?;
    if file.schema_version != 1
        || file.root != project.root
        || file.directory_identity != directory_identity(project)?
    {
        return Err(invalid("Invalid assistant continuation owner or version"));
    }
    validate(&file.record)?;
    if assistant_tasks::saved_assistant_mode(data, &project.root, &file.record.task_id)?
        != file.record.mode
    {
        return Err(invalid(
            "Assistant continuation mode does not match its task",
        ));
    }
    Ok(Some(file.record))
}

fn publish(directory: &File, project: &OpenProject, bytes: &[u8]) -> Result<(), CreationError> {
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    let serial = SERIAL.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let temporary = CString::new(format!(".resume-{pid}-{serial}")).expect("generated name");
    let directory_fd = directory.as_raw_fd();
    let fd = unsafe {
        libc::openat(
            directory_fd,
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
        file.write_all(bytes).map_err(io_error)?;
        file.sync_all().map_err(io_error)?;
        let name = file_name(project)?;
        if unsafe {
            libc::renameat(
                directory_fd,
                temporary.as_ptr(),
                directory_fd,
                name.as_ptr(),
            )
        } != 0
        {
            return Err(io_error(io::Error::last_os_error()));
        }
        // Rename is the publication point. A later fsync failure cannot be
        // reported as though the old checkpoint were still intact.
        let _ = directory.sync_all();
        Ok(())
    })();
    if result.is_err() {
        unsafe { libc::unlinkat(directory_fd, temporary.as_ptr(), 0) };
    }
    result
}

impl CreationAccess {
    pub(super) fn assistant_resume_id(
        &self,
        identity: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<Option<String>, CreationError> {
        let project = self.current(identity, protection)?;
        let Some(directory) = open_directory(data, false)? else {
            return Ok(None);
        };
        Ok(read_record(&directory, project, data)?.map(|record| record.task_id))
    }
    pub fn has_assistant_resume(
        &self,
        identity: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<bool, CreationError> {
        let project = self.current(identity, protection)?;
        let Some(directory) = open_directory(data, false)? else {
            return Ok(false);
        };
        // An invalid checkpoint still requires explicit ending. Current file
        // divergence must not prevent a creator from ending an old task.
        Ok(read_record(&directory, project, data).map_or(true, |record| record.is_some()))
    }
    pub fn save_assistant_resume(
        &self,
        identity: &str,
        record: AssistantTaskResume,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let project = self.current(identity, protection)?;
        validate(&record)?;
        if self.git_ended_tasks.contains(&record.task_id) {
            return Err(invalid(
                "This task was ended before switching project versions",
            ));
        }
        if assistant_tasks::saved_assistant_mode(data, &project.root, &record.task_id)?
            != record.mode
        {
            return Err(invalid(
                "Assistant continuation mode does not match its task",
            ));
        }
        if self
            .assistant_grant
            .as_ref()
            .is_some_and(|(owner, task, _)| owner == identity && task != &record.task_id)
        {
            return Err(invalid("A newer assistant task is active"));
        }
        let directory = open_directory(data, true)?.expect("created directory");
        // Corrupt/unknown records are never silently replaced by ordinary save.
        read_record(&directory, project, data)?;
        let file = ResumeFile {
            schema_version: 1,
            root: project.root.clone(),
            directory_identity: directory_identity(project)?,
            record,
        };
        let bytes = serde_json::to_vec(&file)
            .map_err(|_| invalid("Invalid assistant continuation record"))?;
        if bytes.len() as u64 > RECORD_MAX_BYTES {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                "Assistant continuation is full",
            ));
        }
        validate_identity(project, protection)?;
        publish(&directory, project, &bytes)
    }

    pub fn load_assistant_resume(
        &self,
        identity: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<Option<AssistantTaskResumeRecovery>, CreationError> {
        let project = self.current(identity, protection)?;
        let Some(directory) = open_directory(data, false)? else {
            return Ok(None);
        };
        let Some(record) = read_record(&directory, project, data)? else {
            return Ok(None);
        };
        let files = self.assistant_resume_files(identity, &record.task_id, data, protection)?;
        Ok(Some(AssistantTaskResumeRecovery { record, files }))
    }

    pub fn clear_assistant_resume(
        &self,
        identity: &str,
        task_id: Option<&str>,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let project = self.current(identity, protection)?;
        let Some(directory) = open_directory(data, false)? else {
            return Ok(());
        };
        if let Some(task_id) = task_id {
            let Some(record) = read_record(&directory, project, data)? else {
                return Ok(());
            };
            if record.task_id != task_id {
                return Ok(());
            }
        }
        // None is the explicit whole-history clear/recovery path. Its private
        // filename is derived from the current root and held inode, so corrupt
        // content need not be parsed and another directory's record is untouched.
        let name = file_name(project)?;
        if unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0) } != 0 {
            let cause = io::Error::last_os_error();
            if cause.kind() != io::ErrorKind::NotFound {
                return Err(io_error(cause));
            }
        }
        let _ = directory.sync_all();
        Ok(())
    }
}

#[cfg(test)]
mod tests;
