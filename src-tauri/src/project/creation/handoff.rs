use super::*;
use crate::project::handoff::{
    append_task, initial_document, HandoffDocument, HandoffTask, HANDOFF_PATH,
};
use std::os::unix::fs::PermissionsExt;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HandoffReview {
    pub token: String,
    pub identity: String,
    pub task: HandoffTask,
    pub revision: String,
    pub document: HandoffDocument,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HandoffReceipt {
    pub task: HandoffTask,
    pub revision: String,
    pub document: HandoffDocument,
    pub instructions: String,
    pub task_recorded: bool,
    pub baseline_id: Option<String>,
    pub baseline_error: Option<CreationError>,
}

pub(super) fn fingerprint(project: &OpenProject) -> Result<String, CreationError> {
    use sha2::{Digest, Sha256};
    let mut files = Vec::new();
    project.walk(Path::new(""), 0, &mut 0, &mut Vec::new(), &mut files)?;
    let versions = project.watch_versions(&files)?;
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&versions).expect("versions serialize"))
    ))
}

impl CreationAccess {
    pub fn preview_handoff(
        &mut self,
        identity: &str,
        task: HandoffTask,
        protection: &Protection,
    ) -> Result<HandoffReview, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        task.validate()?;
        use ring::rand::SecureRandom;
        let mut random = [0u8; 32];
        ring::rand::SystemRandom::new()
            .fill(&mut random)
            .map_err(|_| {
                CreationError::new(CreationErrorCode::Io, "Could not prepare confirmation")
            })?;
        let review = HandoffReview {
            token: random.iter().map(|byte| format!("{byte:02x}")).collect(),
            identity: identity.into(),
            revision: task.revision(),
            task,
            document: self.read_handoff(identity, protection)?,
            fingerprint: fingerprint(project)?,
        };
        self.handoff_review = Some(review.clone());
        Ok(review)
    }

    pub fn confirm_handoff(
        &mut self,
        identity: &str,
        token: &str,
        protection: &Protection,
    ) -> Result<HandoffReceipt, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        if let Some((previous, receipt)) = &self.handoff_receipt {
            if previous == token {
                return Ok(receipt.clone());
            }
        }
        let review = self
            .handoff_review
            .as_ref()
            .filter(|review| review.identity == identity && review.token == token)
            .ok_or_else(|| {
                CreationError::new(
                    CreationErrorCode::VersionConflict,
                    "Review the handoff again",
                )
            })?
            .clone();
        if fingerprint(project)? != review.fingerprint {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Project files changed; review the handoff again",
            ));
        }
        let document = self.append_handoff_version(
            identity,
            &review.task,
            review.document.version.as_deref(),
            protection,
            true,
        )?;
        let instructions = instructions(&review.task);
        let receipt = HandoffReceipt {
            task: review.task,
            revision: review.revision,
            document,
            instructions,
            task_recorded: true,
            baseline_id: None,
            baseline_error: None,
        };
        self.handoff_receipt = Some((token.into(), receipt.clone()));
        Ok(receipt)
    }

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
        self.append_handoff_version(identity, task, expected_version, protection, false)
    }

    pub(super) fn append_handoff_version(
        &self,
        identity: &str,
        task: &HandoffTask,
        expected_version: Option<&str>,
        protection: &Protection,
        reviewed: bool,
    ) -> Result<HandoffDocument, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        task.validate()?;
        let previous = self.read_handoff(identity, protection)?;
        // Stable IDs make a retry after a lost command reply idempotent, even if
        // an external agent has since advanced this task's status.
        let marker = if reviewed {
            task.revision_marker()
        } else {
            task.marker()
        };
        if previous.text.lines().any(|line| line == marker) {
            return Ok(previous);
        }
        if previous.version.as_deref() != expected_version {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                HANDOFF_PATH,
            ));
        }
        let mut text = append_task(&previous.text, task);
        if reviewed {
            text.push_str(&format!("{}\n", task.revision_marker()));
        }
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

pub(super) fn instructions(task: &HandoffTask) -> String {
    let revision = task.revision();
    let task_id = &task.id;
    format!("PNDS creator handoff\nTask: {task_id}\nRevision: {revision}\nRead docs/creator-handoff.md and the installed PNDS contracts referenced by AGENTS.md.\n{}\nScope: {}\nAcceptance: {}\nPending requirements are not implemented facts. Verify actual results with the creator; do not assume completion.", task.intent, task.files.join(", "), task.acceptance)
}
