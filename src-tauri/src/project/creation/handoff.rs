use super::*;
use crate::project::handoff::{
    append_task, initial_document, plan_task, HandoffDocument, HandoffTask, HANDOFF_PATH,
};
use serde::Deserialize;
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub planned_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archive_path: Option<String>,
    #[serde(skip)]
    #[specta(skip)]
    pub(super) archive: Option<HandoffArchive>,
    #[serde(skip)]
    #[specta(skip)]
    pub(super) edited_base: bool,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archive_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct HandoffArchive {
    pub path: String,
    pub text: String,
    pub existed: bool,
}

impl HandoffReview {
    pub(super) fn planned_document(&self) -> Result<HandoffDocument, CreationError> {
        let text = self.planned_text.as_ref().ok_or_else(|| {
            CreationError::new(
                CreationErrorCode::VersionConflict,
                "Review the handoff again",
            )
        })?;
        Ok(HandoffDocument {
            text: text.clone(),
            version: Some(file_version(text.as_bytes())),
        })
    }
}

pub(super) fn fingerprint(project: &OpenProject) -> Result<String, CreationError> {
    fingerprint_without(project, None)
}

fn fingerprint_without(
    project: &OpenProject,
    omitted: Option<&str>,
) -> Result<String, CreationError> {
    use sha2::{Digest, Sha256};
    let mut files = Vec::new();
    project.walk(Path::new(""), 0, &mut 0, &mut Vec::new(), &mut files)?;
    files.retain(|file| Some(file.path.as_str()) != omitted);
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
        self.prepare_handoff(identity, task, None, protection)
    }

    /// Explicit creator editing of the existing active text is separate from the
    /// model-generated task. The original saved version still guards both.
    pub fn preview_handoff_update(
        &mut self,
        identity: &str,
        task: HandoffTask,
        document: HandoffDocument,
        protection: &Protection,
    ) -> Result<HandoffReview, CreationError> {
        self.prepare_handoff(identity, task, Some(document), protection)
    }

    fn prepare_handoff(
        &mut self,
        identity: &str,
        task: HandoffTask,
        edited: Option<HandoffDocument>,
        protection: &Protection,
    ) -> Result<HandoffReview, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        task.validate()?;
        let document = self.read_handoff(identity, protection)?;
        let base = edited.as_ref().unwrap_or(&document);
        if base.version != document.version {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                HANDOFF_PATH,
            ));
        }
        if base.text.len() as u64 > TEXT_MAX_BYTES {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                HANDOFF_PATH,
            ));
        }
        let (planned_text, replaced) = if edited.is_none()
            && document
                .text
                .lines()
                .any(|line| line == task.revision_marker())
        {
            // Opening an unchanged recorded task preserves later external status.
            (document.text.clone(), false)
        } else {
            plan_task(&base.text, &task)?
        };
        if planned_text.len() as u64 > TEXT_MAX_BYTES {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                HANDOFF_PATH,
            ));
        }
        let edited_base = base.text != document.text;
        let archive = if document.version.is_some() && (replaced || edited_base) {
            let path = archive_path(&document.text);
            let mut archive = HandoffArchive {
                path,
                text: document.text.clone(),
                existed: false,
            };
            archive.existed = archive_present(project, &archive)?;
            Some(archive)
        } else {
            None
        };
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
            document,
            fingerprint: fingerprint(project)?,
            planned_text: Some(planned_text),
            archive_path: archive.as_ref().map(|archive| archive.path.clone()),
            archive,
            edited_base,
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
        if publication_fingerprint(project, review.archive.as_ref())? != review.fingerprint {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Project files changed; review the handoff again",
            ));
        }
        let document = self.publish_handoff_plan(
            identity,
            &review.planned_document()?,
            review.document.version.as_deref(),
            &review.fingerprint,
            review.archive.as_ref(),
            protection,
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
            archive_path: review.archive_path,
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
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        task.validate()?;
        let previous = self.read_handoff(identity, protection)?;
        // Stable IDs make a retry after a lost command reply idempotent, even if
        // an external agent has since advanced this task's status.
        let marker = task.marker();
        if previous.text.lines().any(|line| line == marker) {
            return Ok(previous);
        }
        if previous.version.as_deref() != expected_version {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                HANDOFF_PATH,
            ));
        }
        let text = append_task(&previous.text, task);
        if text.len() as u64 > TEXT_MAX_BYTES {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                HANDOFF_PATH,
            ));
        }
        write_document(project, &previous, &text, protection)
    }

    pub(super) fn publish_handoff_plan(
        &self,
        identity: &str,
        planned: &HandoffDocument,
        expected_version: Option<&str>,
        source_fingerprint: &str,
        archive: Option<&HandoffArchive>,
        protection: &Protection,
    ) -> Result<HandoffDocument, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        if planned.text.len() as u64 > TEXT_MAX_BYTES
            || planned.version.as_deref() != Some(file_version(planned.text.as_bytes()).as_str())
        {
            return Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                "Invalid reviewed handoff document",
            ));
        }
        let previous = self.read_handoff(identity, protection)?;
        if previous.version == planned.version {
            if let Some(archive) = archive {
                publish_archive(project, archive, protection)?;
            }
            return Ok(previous);
        }
        if previous.version.as_deref() != expected_version
            || publication_fingerprint(project, archive)? != source_fingerprint
        {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                HANDOFF_PATH,
            ));
        }
        if let Some(archive) = archive {
            publish_archive(project, archive, protection)?;
        }
        // A prior failed attempt may have published only the archive. Only that
        // exact content-addressed file can be omitted from the captured scope.
        if publication_fingerprint(project, archive)? != source_fingerprint {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Project files changed; review the handoff again",
            ));
        }
        write_document(project, &previous, &planned.text, protection)
    }
}

fn write_document(
    project: &OpenProject,
    previous: &HandoffDocument,
    text: &str,
    protection: &Protection,
) -> Result<HandoffDocument, CreationError> {
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
            text: text.into(),
        })
    })();
    unsafe {
        libc::unlinkat(directory.as_raw_fd(), temp.as_ptr(), 0);
    }
    result
}

pub(super) fn archive_path(text: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = format!("{:x}", Sha256::digest(text.as_bytes()));
    format!("docs/handoff-history/{digest}.md")
}

fn archive_name(archive: &HandoffArchive) -> Result<CString, CreationError> {
    if archive.text.len() as u64 > TEXT_MAX_BYTES || archive.path != archive_path(&archive.text) {
        return Err(CreationError::new(
            CreationErrorCode::InvalidProject,
            "Invalid handoff archive",
        ));
    }
    CString::new(
        archive
            .path
            .strip_prefix("docs/handoff-history/")
            .expect("validated archive path"),
    )
    .map_err(|_| CreationError::new(CreationErrorCode::InvalidProject, "Invalid handoff archive"))
}

fn archive_directory(project: &OpenProject, create: bool) -> Result<Option<File>, CreationError> {
    let Some(docs) = handoff_directory(project, create)? else {
        return Ok(None);
    };
    let opened = open_at(
        &docs,
        c"handoff-history",
        libc::O_RDONLY | libc::O_DIRECTORY,
        0,
    )?;
    if opened.is_some() || !create {
        return Ok(opened);
    }
    if unsafe { libc::mkdirat(docs.as_raw_fd(), c"handoff-history".as_ptr(), 0o755) } != 0 {
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::AlreadyExists {
            return Err(io_error(error));
        }
    }
    docs.sync_all().map_err(io_error)?;
    open_at(
        &docs,
        c"handoff-history",
        libc::O_RDONLY | libc::O_DIRECTORY,
        0,
    )
}

fn archive_present(project: &OpenProject, archive: &HandoffArchive) -> Result<bool, CreationError> {
    let name = archive_name(archive)?;
    let Some(directory) = archive_directory(project, false)? else {
        return Ok(false);
    };
    let Some(file) = open_at(&directory, &name, libc::O_RDONLY, 0)? else {
        return Ok(false);
    };
    if bounded_read(file, TEXT_MAX_BYTES)? != archive.text.as_bytes() {
        return Err(CreationError::new(
            CreationErrorCode::VersionConflict,
            &archive.path,
        ));
    }
    Ok(true)
}

/// Publication adds at most one exact archive. Excluding only that newly added
/// path lets a failed active-file save resume without accepting unrelated edits.
pub(super) fn publication_fingerprint(
    project: &OpenProject,
    archive: Option<&HandoffArchive>,
) -> Result<String, CreationError> {
    let omitted = if let Some(archive) = archive {
        if archive_present(project, archive)? && !archive.existed {
            Some(archive.path.as_str())
        } else {
            None
        }
    } else {
        None
    };
    fingerprint_without(project, omitted)
}

pub(super) fn publish_archive(
    project: &OpenProject,
    archive: &HandoffArchive,
    protection: &Protection,
) -> Result<(), CreationError> {
    let name = archive_name(archive)?;
    if archive_present(project, archive)? {
        return Ok(());
    }
    validate_identity(project, protection)?;
    let directory = archive_directory(project, true)?.expect("created archive directory");
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let serial = COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let temp =
        CString::new(format!(".pnds-save-archive-{pid}-{serial}.tmp")).expect("generated name");
    let mut file = open_at(
        &directory,
        &temp,
        libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
        0o600,
    )?
    .expect("created archive file");
    let result = (|| {
        file.write_all(archive.text.as_bytes()).map_err(io_error)?;
        file.sync_all().map_err(io_error)?;
        validate_identity(project, protection)?;
        let actual = project
            .file("docs/handoff-history")?
            .metadata()
            .map_err(io_error)?;
        let held = directory.metadata().map_err(io_error)?;
        if actual.dev() != held.dev() || actual.ino() != held.ino() {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                &archive.path,
            ));
        }
        if unsafe {
            libc::linkat(
                directory.as_raw_fd(),
                temp.as_ptr(),
                directory.as_raw_fd(),
                name.as_ptr(),
                0,
            )
        } != 0
        {
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::AlreadyExists {
                return Err(io_error(error));
            }
        }
        directory.sync_all().map_err(io_error)?;
        if !archive_present(project, archive)? {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                &archive.path,
            ));
        }
        Ok(())
    })();
    unsafe {
        libc::unlinkat(directory.as_raw_fd(), temp.as_ptr(), 0);
    }
    result
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

pub(super) fn instructions(_task: &HandoffTask) -> String {
    crate::project::handoff::handoff_instructions().to_owned()
}
