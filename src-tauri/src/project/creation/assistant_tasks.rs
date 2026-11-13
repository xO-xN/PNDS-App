//! Native mode grants and durable, content-checked task recovery. Git is independent.
use super::text_publication::{
    publish_text_at, CreatePermissions, PublicationState, PublishPolicy, TextPublication,
};
use super::*;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::os::unix::fs::PermissionsExt;
mod resources;
pub use resources::*;
mod questions;
pub use questions::*;
mod directories;
use directories::DirectoryEntry;
mod materials;
mod media_adoption;
pub use materials::*;
mod compilation;
mod media_artifacts;
mod pending;
mod retirement;
pub use compilation::*;
pub use pending::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AssistantMode {
    #[serde(alias = "handoff")]
    Discussion,
    Edit,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantEdit {
    pub old_text: String,
    pub new_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantWrite {
    pub path: String,
    pub version: Option<String>,
    pub text: Option<String>,
    pub edits: Option<Vec<AssistantEdit>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTaskFile {
    pub path: String,
    pub created: bool,
    pub undone: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub removed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directory: Option<bool>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTask {
    pub id: String,
    pub mode: AssistantMode,
    pub files: Vec<AssistantTaskFile>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    #[specta(optional)]
    pub resource_plans: Vec<AssistantResourcePlan>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    #[specta(optional)]
    pub questions: Vec<AssistantQuestion>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    #[specta(optional)]
    pub material_adoptions: Vec<AssistantMaterialReceipt>,
}
#[derive(Serialize, Deserialize)]
struct Entry {
    path: String,
    before: Option<String>,
    after: String,
    pending: Option<String>,
    undone: bool,
    #[serde(default)]
    removed: bool,
    #[serde(default)]
    pending_remove: bool,
}
enum AssistantWriteAuthority<'a> {
    Ordinary,
    Library,
    Material(&'a materials::MaterialWritePermit),
}
#[derive(Serialize, Deserialize)]
struct Journal {
    root: PathBuf,
    directory_identity: String,
    id: String,
    mode: AssistantMode,
    #[serde(default)]
    retired: bool,
    entries: Vec<Entry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    artifacts: Vec<compilation::ArtifactEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    media_artifacts: Vec<media_artifacts::MediaArtifact>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    compilation: Option<AssistantCompilationReceipt>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    directories: Vec<DirectoryEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    resource_plans: Vec<AssistantResourcePlan>,
    #[serde(default)]
    question_scope: Option<AssistantQuestionScope>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    questions: Vec<AssistantQuestion>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    material_conflicts: Vec<materials::MaterialConflict>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    image_conflicts: Vec<media_adoption::ImageConflict>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    image_adoptions: Vec<AssistantMaterialReceipt>,
    #[serde(default)]
    pending_sources: Vec<PendingIntegrationSource>,
    #[serde(default)]
    pending_selections: Vec<PendingIntegrationSource>,
    #[serde(default)]
    pending_completed: bool,
    #[serde(default)]
    undoing: Vec<String>,
}
impl Journal {
    fn summary(&self) -> AssistantTask {
        AssistantTask {
            id: self.id.clone(),
            mode: self.mode,
            resource_plans: self.resource_plans.clone(),
            questions: self.questions.clone(),
            material_adoptions: self
                .material_conflicts
                .iter()
                .filter_map(|conflict| conflict.receipt.clone())
                .chain(self.image_adoptions.iter().cloned())
                .collect(),
            files: self
                .entries
                .iter()
                .map(|entry| AssistantTaskFile {
                    path: entry.path.clone(),
                    created: entry.before.is_none(),
                    undone: entry.undone,
                    removed: entry.removed.then_some(true),
                    directory: None,
                })
                .chain(self.directories.iter().map(|entry| AssistantTaskFile {
                    path: entry.path.clone(),
                    created: true,
                    undone: entry.undone,
                    removed: None,
                    directory: Some(true),
                }))
                .chain(self.media_artifacts.iter().map(|entry| AssistantTaskFile {
                    path: entry.path.clone(),
                    created: entry.created(),
                    undone: entry.undone,
                    removed: None,
                    directory: None,
                }))
                .chain(self.artifacts.iter().map(|entry| AssistantTaskFile {
                    path: entry.path.clone(),
                    created: entry.before.is_none(),
                    undone: entry.undone,
                    removed: None,
                    directory: None,
                }))
                .collect(),
        }
    }
    fn persist(&self, data: &Path) -> Result<(), CreationError> {
        // Validate the complete constructed state before replacing a usable
        // recovery record, rather than discovering invalid questions on load.
        self.validate_questions()?;
        self.validate_material_conflicts()?;
        self.validate_image_adoptions()?;
        self.validate_media_artifacts()?;
        if let Some(directory) = private_recovery_directory(data, &self.root, true)? {
            let bytes = serde_json::to_vec(self).map_err(|cause| invalid(cause.to_string()))?;
            if bytes.len() as u64 > TASK_JOURNAL_LIMIT {
                return Err(invalid("Task recovery record is full"));
            }
            return super::materials::publish_bytes(
                &directory,
                &format!("{}.json", self.id),
                &bytes,
            )
            .map_err(|cause| invalid(format!("Private recovery: {cause:?}")));
        }
        let directory = journal_directory(data, &self.root);
        fs::create_dir_all(&directory).map_err(io_error)?;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).map_err(io_error)?;
        let bytes = serde_json::to_vec(self).map_err(|cause| invalid(cause.to_string()))?;
        if bytes.len() as u64 > TASK_JOURNAL_LIMIT {
            return Err(invalid("Task recovery record is full"));
        }
        atomic_write(
            &directory.join(format!("{}.json", self.id)),
            &bytes,
            fs::Permissions::from_mode(0o600),
        )
    }
}
const TASK_JOURNAL_LIMIT: u64 = 64 * 1024 * 1024;

fn invalid(detail: impl Into<String>) -> CreationError {
    CreationError::new(CreationErrorCode::TestValidation, detail)
}
fn journal_directory(data: &Path, root: &Path) -> PathBuf {
    let digest = format!("{:x}", Sha256::digest(root.as_os_str().as_bytes()));
    data.join("assistant-tasks").join(digest)
}
/// Traverse the project-private undo namespace from its actual directory.
fn private_recovery_directory(
    data: &Path,
    root: &Path,
    create: bool,
) -> Result<Option<File>, CreationError> {
    if data
        != root
            .join(crate::creation_data::DIRECTORY)
            .join("pending-recovery")
    {
        return Ok(None);
    }
    let project = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(root)
        .map_err(io_error)?;
    let mut directory = crate::creation_data::open(&project).map_err(io_error)?;
    // This directory already belongs to the held project. Its restore journals
    // must keep the same location when that complete project is moved or copied.
    for name in ["pending-recovery", "assistant-tasks"] {
        directory = if create {
            super::materials::directory_at(&directory, name)
        } else {
            super::materials::open_directory_at(&directory, name)
        }
        .map_err(|cause| invalid(format!("Private recovery: {cause:?}")))?;
    }
    Ok(Some(directory))
}
fn load(data: &Path, root: &Path, id: &str) -> Result<Journal, CreationError> {
    let journal = load_raw(data, root, id)?;
    if journal.retired {
        return Err(invalid("This assistant task has ended"));
    }
    Ok(journal)
}
fn load_raw(data: &Path, root: &Path, id: &str) -> Result<Journal, CreationError> {
    let directory = retirement::open_directory(data, root)?
        .ok_or_else(|| io_error(io::Error::from(io::ErrorKind::NotFound)))?;
    read_from_directory(&directory, root, id)?
        .ok_or_else(|| io_error(io::Error::from(io::ErrorKind::NotFound)))
}
pub(crate) fn valid_assistant_task_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}
fn read_from_directory(
    directory: &File,
    root: &Path,
    id: &str,
) -> Result<Option<Journal>, CreationError> {
    let Some(journal) = read_record(directory, id)? else {
        return Ok(None);
    };
    let metadata = fs::metadata(root).map_err(io_error)?;
    let directory_identity = format!("{}:{}", metadata.dev(), metadata.ino());
    if journal.root != root || journal.directory_identity != directory_identity {
        return Err(invalid("Invalid recovery owner"));
    }
    Ok(Some(journal))
}

fn read_record(directory: &File, id: &str) -> Result<Option<Journal>, CreationError> {
    if !valid_assistant_task_id(id) {
        return Err(invalid("Invalid task ID"));
    }
    let name = CString::new(format!("{id}.json")).expect("validated task ID");
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
    if !file.metadata().map_err(io_error)?.is_file() {
        return Err(invalid("Invalid recovery record"));
    }
    let bytes = bounded_read(file, TASK_JOURNAL_LIMIT)?;
    let journal: Journal =
        serde_json::from_slice(&bytes).map_err(|cause| invalid(cause.to_string()))?;
    if journal.id != id
        || journal.entries.len() > 64
        || journal.entries.len() + journal.artifacts.len() + journal.media_artifacts.len() > 64
        || journal.directories.len() > 64
        || journal.resource_plans.len() > 16
        || journal.material_conflicts.len() > 64
        || journal.pending_sources.len() > 64
        || journal.pending_selections.len() > 64
        || journal.undoing.len() > 64
        || journal
            .undoing
            .iter()
            .any(|path| !journal.entries.iter().any(|entry| entry.path == *path))
    {
        return Err(invalid("Invalid recovery owner"));
    }
    journal.validate_questions()?;
    journal.validate_material_conflicts()?;
    journal.validate_image_adoptions()?;
    journal.validate_media_artifacts()?;
    Ok(Some(journal))
}
pub(super) fn saved_assistant_mode(
    data: &Path,
    root: &Path,
    id: &str,
) -> Result<AssistantMode, CreationError> {
    load(data, root, id).map(|journal| journal.mode)
}
fn text_content(content: CreationContent) -> Result<(String, String), CreationError> {
    match content {
        CreationContent::Text { text, version } => Ok((text, version)),
        _ => Err(invalid("Only text is editable")),
    }
}
fn apply(write: &AssistantWrite, before: &str) -> Result<String, CreationError> {
    match (&write.text, &write.edits) {
        (Some(text), None) => Ok(text.clone()),
        (None, Some(edits)) if !edits.is_empty() && edits.len() <= 64 => {
            let mut replacements = Vec::new();
            for edit in edits {
                if edit.old_text.is_empty() {
                    return Err(invalid("An edit anchor must not be empty"));
                }
                let mut matches = before.match_indices(&edit.old_text);
                let (offset, _) = matches
                    .next()
                    .ok_or_else(|| invalid("Edit anchor was not found"))?;
                if matches.next().is_some() {
                    return Err(invalid("Edit anchor is ambiguous"));
                }
                replacements.push((offset, offset + edit.old_text.len(), &edit.new_text));
            }
            replacements.sort_by_key(|entry| entry.0);
            if replacements.windows(2).any(|pair| pair[0].1 > pair[1].0) {
                return Err(invalid("Edit anchors overlap"));
            }
            let mut text = before.to_owned();
            for (start, end, replacement) in replacements.into_iter().rev() {
                text.replace_range(start..end, replacement);
            }
            Ok(text)
        }
        _ => Err(invalid("Supply complete text OR exact replacement edits")),
    }
}

impl CreationAccess {
    /// Reconcile an interrupted native write without restoring a live grant.
    /// Only bytes still owned by this journal may explain a stale checkpoint.
    pub(super) fn assistant_resume_files(
        &self,
        identity: &str,
        id: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<Vec<AssistantTaskResumeFile>, CreationError> {
        let mut journal = load(data, &self.current(identity, protection)?.root, id)?;
        self.reconcile_assistant_journal(identity, &mut journal, data, protection)?;
        self.verified_assistant_journal_files(identity, &journal, protection)
    }
    fn verified_assistant_journal_files(
        &self,
        identity: &str,
        journal: &Journal,
        protection: &Protection,
    ) -> Result<Vec<AssistantTaskResumeFile>, CreationError> {
        self.verify_assistant_directories(identity, journal, protection)?;
        let mut files = Vec::new();
        for entry in &journal.entries {
            if entry.undone || entry.pending.is_some() || entry.pending_remove {
                return Err(invalid("This task cannot be continued"));
            }
            self.assistant_target(identity, &entry.path, protection)?;
            let version = match self.read(identity, &entry.path, protection) {
                Err(cause) if cause.code == CreationErrorCode::Missing && entry.removed => None,
                Ok(CreationContent::Text { text, version })
                    if !entry.removed && text == entry.after =>
                {
                    Some(version)
                }
                _ => {
                    return Err(CreationError::new(
                        CreationErrorCode::VersionConflict,
                        &entry.path,
                    ))
                }
            };
            files.push(AssistantTaskResumeFile {
                path: entry.path.clone(),
                version,
            });
        }
        files.extend(self.verified_assistant_artifacts(identity, journal, protection)?);
        files.extend(Self::verified_media_artifacts(
            self.current(identity, protection)?,
            journal,
        )?);
        Ok(files)
    }
    fn reconcile_assistant_journal(
        &self,
        identity: &str,
        journal: &mut Journal,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        self.reconcile_assistant_directories(identity, journal, data, protection)?;
        Self::reconcile_media_artifacts(self.current(identity, protection)?, journal)?;
        self.reconcile_assistant_artifacts(identity, journal, data, protection)?;
        let mut unpublished = Vec::new();
        for (index, entry) in journal.entries.iter_mut().enumerate() {
            if journal.undoing.contains(&entry.path) {
                let current = self.read(identity, &entry.path, protection);
                let completed = match (&current, &entry.before) {
                    (Ok(CreationContent::Text { text, .. }), Some(before)) => text == before,
                    (Err(cause), None) => cause.code == CreationErrorCode::Missing,
                    _ => false,
                };
                if completed {
                    entry.undone = true;
                    entry.pending = None;
                } else {
                    match current {
                        Ok(CreationContent::Text { text, .. })
                            if !entry.removed && text == entry.after => {}
                        Err(cause) if entry.removed && cause.code == CreationErrorCode::Missing => {
                        }
                        _ => {
                            return Err(CreationError::new(
                                CreationErrorCode::VersionConflict,
                                &entry.path,
                            ))
                        }
                    }
                }
                journal.undoing.retain(|path| path != &entry.path);
            }
            if entry.pending_remove {
                self.assistant_target(identity, &entry.path, protection)?;
                match self.read(identity, &entry.path, protection) {
                    Err(cause) if cause.code == CreationErrorCode::Missing => {
                        entry.removed = true;
                        entry.pending_remove = false;
                    }
                    Ok(CreationContent::Text { text, .. }) if text == entry.after => {
                        entry.pending_remove = false
                    }
                    _ => {}
                }
            }
            if let Some(pending) = &entry.pending {
                // Only exact frozen bytes in an absent module can explain a missing parent.
                if entry.before.is_none() && entry.after.is_empty() {
                    if let Some(module) = entry
                        .path
                        .strip_prefix("modules/pnds-")
                        .and_then(|path| path.split('/').next())
                    {
                        if modules::assistant_module_assets(module).is_ok_and(|assets| {
                            assets
                                .iter()
                                .any(|(path, text)| path == &entry.path && text == pending)
                        }) && self
                            .module_catalog(identity, protection)?
                            .modules
                            .iter()
                            .any(|item| {
                                item.id == module && item.state == modules::ModuleState::Available
                            })
                        {
                            unpublished.push(index);
                            continue;
                        }
                    }
                }
                self.assistant_target(identity, &entry.path, protection)?;
                match self.read(identity, &entry.path, protection) {
                    Ok(content) => {
                        let (current, _) = text_content(content)?;
                        if &current == pending {
                            entry.after = current;
                            entry.pending = None;
                        } else if current == entry.after {
                            entry.pending = None;
                        }
                    }
                    Err(cause)
                        if cause.code == CreationErrorCode::Missing && entry.before.is_none() =>
                    {
                        if entry.after.is_empty() && !entry.undone && !entry.removed {
                            // The first atomic publication never happened. No
                            // project bytes or undo evidence need restoring.
                            unpublished.push(index);
                        } else {
                            return Err(CreationError::new(
                                CreationErrorCode::VersionConflict,
                                &entry.path,
                            ));
                        }
                    }
                    Err(cause) => return Err(cause),
                }
            }
        }
        for index in unpublished.into_iter().rev() {
            journal.entries.remove(index);
        }
        journal.persist(data)
    }
    #[cfg(test)]
    pub fn begin_assistant_task(
        &mut self,
        identity: &str,
        mode: AssistantMode,
        resume: Option<&str>,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantTask, CreationError> {
        self.begin_scoped_assistant_task(identity, mode, resume, None, data, protection)
    }
    pub fn begin_scoped_assistant_task(
        &mut self,
        identity: &str,
        mode: AssistantMode,
        resume: Option<&str>,
        scope: Option<&AssistantQuestionScope>,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantTask, CreationError> {
        self.reap_retired_assistant_tasks(identity, data, protection)?;
        if self
            .assistant_grant
            .as_ref()
            .is_some_and(|(owner, task, _)| owner == identity && resume != Some(task.as_str()))
        {
            return Err(invalid("Another assistant task is active"));
        }
        if let Some(scope) = scope {
            scope.validate()?;
        }
        if resume.is_some_and(|id| self.git_ended_tasks.contains(id)) {
            return Err(invalid(
                "This task was explicitly ended before switching versions",
            ));
        }
        let project = self.current(identity, protection)?;
        let journal = if let Some(id) = resume {
            let mut journal = load(data, &project.root, id)?;
            self.reconcile_assistant_journal(identity, &mut journal, data, protection)?;
            if journal.pending_completed
                || journal.mode != mode
                || journal
                    .question_scope
                    .as_ref()
                    .is_some_and(|owner| Some(owner) != scope)
                || journal
                    .entries
                    .iter()
                    .any(|entry| entry.undone || entry.pending_remove || entry.pending.is_some())
                || journal.directories.iter().any(|entry| entry.undone)
            {
                return Err(invalid("This task cannot be continued"));
            }
            self.verified_assistant_journal_files(identity, &journal, protection)?;
            self.refresh_material_questions(identity, &mut journal, data, protection)?;
            // Old journals had no chat scope. Only this explicit, freshly
            // verified continuation may bind them before asking a question.
            if journal.question_scope.is_none() && scope.is_some() {
                journal.question_scope = scope.cloned();
                journal.persist(data)?;
            }
            journal
        } else {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|cause| invalid(cause.to_string()))?
                .as_nanos();
            let journal = Journal {
                root: project.root.clone(),
                directory_identity: {
                    let metadata = project.directory.metadata().map_err(io_error)?;
                    format!("{}:{}", metadata.dev(), metadata.ino())
                },
                id: format!("{nanos}-{}", std::process::id()),
                mode,
                retired: false,
                entries: vec![],
                artifacts: vec![],
                media_artifacts: vec![],
                compilation: None,
                directories: vec![],
                resource_plans: vec![],
                question_scope: scope.cloned(),
                questions: vec![],
                material_conflicts: vec![],
                image_conflicts: vec![],
                image_adoptions: vec![],
                pending_sources: vec![],
                pending_selections: vec![],
                pending_completed: false,
                undoing: vec![],
            };
            journal.persist(data)?;
            journal
        };
        self.assistant_grant = Some((identity.into(), journal.id.clone(), mode));
        Ok(journal.summary())
    }
    pub fn authorize_assistant_task(
        &self,
        identity: &str,
        id: &str,
        edit: bool,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        self.current(identity, protection)?;
        if !self
            .assistant_grant
            .as_ref()
            .is_some_and(|(owner, task, mode)| {
                owner == identity && task == id && (!edit || *mode == AssistantMode::Edit)
            })
        {
            return Err(invalid(
                "Assistant task is inactive or this mode cannot implement changes",
            ));
        }
        Ok(())
    }
    pub fn end_assistant_task(&mut self, identity: &str, id: &str) {
        self.cancel_assistant_operation(identity, id);
        if self
            .assistant_grant
            .as_ref()
            .is_some_and(|(owner, task, _)| owner == identity && task == id)
        {
            self.assistant_grant = None;
        }
    }
    fn assistant_target(
        &self,
        identity: &str,
        path: &str,
        protection: &Protection,
    ) -> Result<PathBuf, CreationError> {
        text_creation::admitted_path(path)?;
        if Path::new(path).components().count() > MAX_DEPTH + 1 {
            return Err(invalid("Project path is too deep"));
        }
        if assistant::excluded(path).is_some() {
            return Err(invalid("Excluded project path"));
        }
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        let target = project.destination(path)?;
        if target.exists()
            && fs::symlink_metadata(&target)
                .map_err(io_error)?
                .file_type()
                .is_symlink()
        {
            return Err(invalid("Assistant writes cannot follow file symlinks"));
        }
        let relative = target
            .strip_prefix(&project.root)
            .map_err(|_| invalid("Outside project"))?
            .to_string_lossy();
        if relative != path || assistant::excluded(&relative).is_some() {
            return Err(invalid("Use a direct project path without symlink aliases"));
        }
        Ok(target)
    }
    pub fn write_assistant_file(
        &mut self,
        identity: &str,
        id: &str,
        write: &AssistantWrite,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantTask, CreationError> {
        self.write_assistant_file_inner(
            identity,
            id,
            write,
            data,
            protection,
            AssistantWriteAuthority::Ordinary,
        )
    }
    fn write_assistant_file_inner(
        &mut self,
        identity: &str,
        id: &str,
        write: &AssistantWrite,
        data: &Path,
        protection: &Protection,
        authority: AssistantWriteAuthority<'_>,
    ) -> Result<AssistantTask, CreationError> {
        self.authorize_assistant_task(identity, id, true, protection)?;
        let mut journal = load(data, &self.current(identity, protection)?.root, id)?;
        journal.require_resource_decision()?;
        if let AssistantWriteAuthority::Material(permit) = &authority {
            journal.require_material_permit(write, permit)?;
        } else {
            journal.require_material_path(self.current(identity, protection)?, &write.path)?;
        }
        self.reconcile_assistant_directories(identity, &mut journal, data, protection)?;
        self.verify_assistant_directories(identity, &journal, protection)?;
        // Only this standard documentation directory is created implicitly.
        // Code files may use any existing project directory.
        if write.path == "docs/creator-handoff.md" {
            let project = self.current(identity, protection)?;
            if !project.root.join("docs").exists() {
                fs::create_dir(project.root.join("docs")).map_err(io_error)?;
            }
        }
        let target = self.assistant_target(identity, &write.path, protection)?;
        let before = match self.read(identity, &write.path, protection) {
            Ok(content) => {
                let (text, version) = text_content(content)?;
                if write.version.as_ref() != Some(&version) {
                    return Err(CreationError::new(
                        CreationErrorCode::VersionConflict,
                        &write.path,
                    ));
                }
                Some(text)
            }
            Err(cause) if cause.code == CreationErrorCode::Missing && write.version.is_none() => {
                None
            }
            Err(cause) => return Err(cause),
        };
        let after = apply(write, before.as_deref().unwrap_or(""))?;
        if [".js", ".mjs", ".cjs"]
            .iter()
            .any(|suffix| write.path.ends_with(suffix))
        {
            let head = after.trim_start().to_ascii_lowercase();
            if head.starts_with("<!doctype html") || head.starts_with("<html") {
                return Err(invalid("HTML pages must use an .html extension; JavaScript files must contain JavaScript"));
            }
        }
        if after.len() as u64 > TEXT_MAX_BYTES {
            return Err(CreationError::new(CreationErrorCode::TooLarge, &write.path));
        }
        if is_root_manifest(&write.path) {
            crate::project::manifest::parse_manifest(&after)
                .map_err(|cause| CreationError::new(CreationErrorCode::ManifestInvalid, cause))?;
        }
        journal.check_resource_write(
            &write.path,
            before.as_deref(),
            &after,
            matches!(authority, AssistantWriteAuthority::Library),
        )?;
        if before.as_deref() == Some(&after) {
            return Ok(journal.summary());
        }
        let index = if let Some(index) = journal
            .entries
            .iter()
            .position(|entry| entry.path == write.path)
        {
            let entry = &journal.entries[index];
            if entry.undone || before.as_ref() != Some(&entry.after) {
                return Err(CreationError::new(
                    CreationErrorCode::VersionConflict,
                    &write.path,
                ));
            }
            index
        } else {
            if journal.entries.len() + journal.artifacts.len() + journal.media_artifacts.len() >= 64
            {
                return Err(invalid("Task recovery supports 64 files"));
            }
            journal.entries.push(Entry {
                path: write.path.clone(),
                before: before.clone(),
                after: before.clone().unwrap_or_default(),
                pending: None,
                undone: false,
                removed: false,
                pending_remove: false,
            });
            journal.entries.len() - 1
        };
        journal.entries[index].pending = Some(after.clone());
        journal.persist(data)?;
        let result = if let Some(version) = &write.version {
            self.save(identity, &write.path, &after, version, protection)
                .map(|_| ())
        } else {
            self.publish_assistant_file(identity, &write.path, &after, protection)
        };
        if let Err(cause) = result {
            journal.entries[index].pending = None;
            if before.is_none() {
                journal.entries.remove(index);
            }
            journal.persist(data)?;
            return Err(cause);
        }
        debug_assert!(target.exists());
        journal.entries[index].after = after;
        journal.entries[index].pending = None;
        journal.persist(data)?;
        self.last_change = None;
        Ok(journal.summary())
    }
    pub fn remove_assistant_file(
        &mut self,
        identity: &str,
        id: &str,
        path: &str,
        version: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantTask, CreationError> {
        self.authorize_assistant_task(identity, id, true, protection)?;
        if is_root_manifest(path) {
            return Err(invalid("The project manifest cannot be removed"));
        }
        self.assistant_target(identity, path, protection)?;
        let (before, actual) = text_content(self.read(identity, path, protection)?)?;
        if actual != version {
            return Err(CreationError::new(CreationErrorCode::VersionConflict, path));
        }
        let mut journal = load(data, &self.current(identity, protection)?.root, id)?;
        journal.require_resource_decision()?;
        journal.require_material_path(self.current(identity, protection)?, path)?;
        self.reconcile_assistant_directories(identity, &mut journal, data, protection)?;
        self.verify_assistant_directories(identity, &journal, protection)?;
        let index = if let Some(index) = journal.entries.iter().position(|entry| entry.path == path)
        {
            let entry = &journal.entries[index];
            if entry.undone || entry.removed || entry.after != before {
                return Err(CreationError::new(CreationErrorCode::VersionConflict, path));
            }
            index
        } else {
            if journal.entries.len() + journal.artifacts.len() + journal.media_artifacts.len() >= 64
            {
                return Err(invalid("Task recovery supports 64 files"));
            }
            journal.entries.push(Entry {
                path: path.into(),
                before: Some(before.clone()),
                after: before,
                pending: None,
                undone: false,
                removed: false,
                pending_remove: false,
            });
            journal.entries.len() - 1
        };
        journal.entries[index].pending_remove = true;
        journal.persist(data)?;
        let project = self.current(identity, protection)?;
        let relative = Path::new(path);
        let directory =
            project.file(&relative.parent().unwrap_or(Path::new("")).to_string_lossy())?;
        let name = CString::new(
            relative
                .file_name()
                .ok_or_else(|| invalid("Missing file name"))?
                .as_bytes(),
        )
        .map_err(|_| invalid("Invalid name"))?;
        if unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0) } != 0 {
            return Err(io_error(io::Error::last_os_error()));
        }
        journal.entries[index].removed = true;
        journal.entries[index].pending_remove = false;
        journal.persist(data)?;
        self.last_change = None;
        Ok(journal.summary())
    }
    pub fn install_assistant_preview_adapter(
        &mut self,
        identity: &str,
        id: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantTask, CreationError> {
        self.authorize_assistant_task(identity, id, true, protection)?;
        let path = "public/pnds-preview.mjs";
        let text = include_str!("../../../resources/parameter-preview/adapter.mjs");
        match self.read(identity, path, protection) {
            Ok(CreationContent::Text { text: existing, .. }) if existing == text => {
                return load(data, &self.current(identity, protection)?.root, id)
                    .map(|journal| journal.summary())
            }
            Ok(_) => return Err(CreationError::new(CreationErrorCode::TargetExists, path)),
            Err(cause) if cause.code == CreationErrorCode::Missing => {}
            Err(cause) => return Err(cause),
        }
        self.write_assistant_file(
            identity,
            id,
            &AssistantWrite {
                path: path.into(),
                version: None,
                text: Some(text.into()),
                edits: None,
            },
            data,
            protection,
        )
    }
    fn publish_assistant_file(
        &self,
        identity: &str,
        path: &str,
        text: &str,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let project = self.current(identity, protection)?;
        let relative = Path::new(path);
        let directory =
            project.file(&relative.parent().unwrap_or(Path::new("")).to_string_lossy())?;
        let name = CString::new(
            relative
                .file_name()
                .ok_or_else(|| invalid("Missing file name"))?
                .as_bytes(),
        )
        .map_err(|_| invalid("Invalid name"))?;
        let publication = publish_text_at(
            TextPublication {
                directory: &directory,
                name: &name,
                bytes: text.as_bytes(),
                policy: PublishPolicy::Create {
                    permissions: CreatePermissions::Umask(0o644),
                },
            },
            || validate_identity(project, protection),
        )?;
        match publication.state {
            PublicationState::Installed => Ok(()),
            PublicationState::Occupied => {
                Err(CreationError::new(CreationErrorCode::TargetExists, path))
            }
        }
    }
    pub fn adopt_assistant_library(
        &mut self,
        identity: &str,
        id: &str,
        library: &str,
        data: &Path,
        resources: &Path,
        protection: &Protection,
    ) -> Result<AssistantTask, CreationError> {
        self.authorize_assistant_task(identity, id, true, protection)?;
        let catalog = self.library_catalog(identity, resources, protection)?;
        let selected = catalog
            .libraries
            .iter()
            .find(|entry| entry.id == library)
            .ok_or_else(|| invalid("This package is not shipped locally with the App"))?;
        resources::require_exact_library_reference(selected)?;
        if selected.referenced_version.as_ref() == Some(&selected.version) {
            return load(data, &self.current(identity, protection)?.root, id)
                .map(|journal| journal.summary());
        }
        let journal = load(data, &self.current(identity, protection)?.root, id)?;
        journal.require_resource_decision()?;
        if !journal.approved(&AssistantResource {
            kind: AssistantResourceKind::Library,
            id: library.into(),
            version: selected.version.clone(),
            source: serde_json::to_string(&selected.source).expect("source"),
        }) {
            return Err(invalid(
                "Creator confirmation is required before adding this shared library",
            ));
        }
        let (text, version) = text_content(self.read(identity, "manifest.json", protection)?)?;
        if version != catalog.manifest_version {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "manifest.json",
            ));
        }
        let mut value: serde_json::Value =
            serde_json::from_str(&text).map_err(|cause| invalid(cause.to_string()))?;
        let mut references = value["sharedLibraries"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        references.retain(|entry| entry["id"].as_str() != Some(library));
        references.push(serde_json::json!({"id":library,"version":selected.version}));
        value["schemaVersion"] = serde_json::json!(2);
        value["sharedLibraries"] = serde_json::json!(references);
        value["version"] = serde_json::json!(format!("{}-pnds.{id}", catalog.project_version));
        self.write_assistant_file_inner(
            identity,
            id,
            &AssistantWrite {
                path: "manifest.json".into(),
                version: Some(version),
                text: Some(
                    serde_json::to_string_pretty(&value)
                        .map_err(|cause| invalid(cause.to_string()))?
                        + "\n",
                ),
                edits: None,
            },
            data,
            protection,
            AssistantWriteAuthority::Library,
        )
    }
    pub fn assistant_tasks(
        &self,
        identity: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<Vec<AssistantTask>, CreationError> {
        let project = self.current(identity, protection)?;
        let directory = journal_directory(data, &project.root);
        if !directory.exists() {
            return Ok(vec![]);
        }
        let mut files = fs::read_dir(directory)
            .map_err(io_error)?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .collect::<Vec<_>>();
        files.sort_by(|a, b| b.cmp(a));
        files
            .into_iter()
            .take(100)
            .map(|path| {
                let id = path
                    .file_stem()
                    .and_then(|name| name.to_str())
                    .ok_or_else(|| invalid("Invalid task record"))?;
                let mut journal = load(data, &project.root, id)?;
                self.reconcile_assistant_directories(identity, &mut journal, data, protection)?;
                Self::reconcile_media_artifacts(project, &mut journal)?;
                self.reconcile_assistant_artifacts(identity, &mut journal, data, protection)?;
                Ok(journal.summary())
            })
            .filter(|result| match result {
                Ok(task) => !task.files.is_empty(),
                Err(_) => true,
            })
            .take(20)
            .collect()
    }
    pub fn undo_assistant_task(
        &mut self,
        identity: &str,
        id: &str,
        path: Option<&str>,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantTask, CreationError> {
        let mut journal = load(data, &self.current(identity, protection)?.root, id)?;
        self.reconcile_assistant_journal(identity, &mut journal, data, protection)?;
        if self
            .assistant_grant
            .as_ref()
            .is_some_and(|(owner, task, _)| owner == identity && task == id)
        {
            return Err(invalid("Stop the assistant task before undo"));
        }
        self.verify_assistant_directories(identity, &journal, protection)?;
        self.validate_assistant_artifact_undo(identity, &journal, path, protection)?;
        Self::validate_media_undo(self.current(identity, protection)?, &journal, path)?;
        let selected = journal
            .entries
            .iter()
            .enumerate()
            .filter(|(_, entry)| !entry.undone && path.is_none_or(|path| path == entry.path))
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        // Validate the entire selection before restoring anything.
        for &index in &selected {
            let entry = &journal.entries[index];
            self.assistant_target(identity, &entry.path, protection)?;
            if entry.removed {
                if !matches!(self.read(identity, &entry.path, protection), Err(cause) if cause.code == CreationErrorCode::Missing)
                {
                    return Err(CreationError::new(
                        CreationErrorCode::VersionConflict,
                        &entry.path,
                    ));
                }
                continue;
            }
            let (current, _) = text_content(self.read(identity, &entry.path, protection)?)?;
            if current != entry.after && entry.pending.as_ref() != Some(&current) {
                return Err(CreationError::new(
                    CreationErrorCode::VersionConflict,
                    &entry.path,
                ));
            }
        }
        for index in selected {
            journal.undoing.push(journal.entries[index].path.clone());
            journal.persist(data)?;
            let entry = &journal.entries[index];
            if entry.removed {
                if let Some(before) = &entry.before {
                    self.publish_assistant_file(identity, &entry.path, before, protection)?;
                }
                journal.entries[index].undone = true;
                journal
                    .undoing
                    .retain(|path| path != &journal.entries[index].path);
                journal.persist(data)?;
                continue;
            }
            let (current, version) = text_content(self.read(identity, &entry.path, protection)?)?;
            if current != entry.after && entry.pending.as_ref() != Some(&current) {
                return Err(CreationError::new(
                    CreationErrorCode::VersionConflict,
                    &entry.path,
                ));
            }
            if let Some(before) = &entry.before {
                self.save(identity, &entry.path, before, &version, protection)?;
            } else {
                let project = self.current(identity, protection)?;
                let relative = Path::new(&entry.path);
                let directory =
                    project.file(&relative.parent().unwrap_or(Path::new("")).to_string_lossy())?;
                let name = CString::new(relative.file_name().expect("validated path").as_bytes())
                    .map_err(|_| invalid("Invalid name"))?;
                if unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0) } != 0 {
                    return Err(io_error(io::Error::last_os_error()));
                }
            }
            journal.entries[index].undone = true;
            journal.entries[index].pending = None;
            journal
                .undoing
                .retain(|path| path != &journal.entries[index].path);
            journal.persist(data)?;
        }
        for plan in &journal.resource_plans {
            for item in &plan.resources {
                if item.kind == AssistantResourceKind::Module {
                    let prefix = format!("modules/pnds-{}/", item.id);
                    let entries: Vec<_> = journal
                        .entries
                        .iter()
                        .filter(|entry| entry.path.starts_with(&prefix))
                        .collect();
                    if !entries.is_empty()
                        && entries
                            .iter()
                            .all(|entry| entry.before.is_none() && entry.undone)
                    {
                        self.cleanup_assistant_module(identity, &item.id, protection)?;
                    }
                }
            }
        }
        self.undo_assistant_artifacts(identity, &mut journal, path, data, protection)?;
        Self::undo_media_artifacts(
            self.current(identity, protection)?,
            &mut journal,
            path,
            data,
            protection,
        )?;
        self.undo_assistant_directories(identity, &mut journal, path, data, protection)?;
        self.last_change = None;
        Ok(journal.summary())
    }
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    #[test]
    fn interrupted_removal_recovers_missing_original_on_undo() {
        let temp = tempfile::tempdir().unwrap();
        let root = tests::project(temp.path(), "score");
        let data = temp.path().join("data");
        let protection = Protection::default();
        let mut access = CreationAccess::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        let task = access
            .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
            .unwrap();
        let mut journal = load(&data, &fs::canonicalize(&root).unwrap(), &task.id).unwrap();
        journal.entries.push(Entry {
            path: "removed.js".into(),
            before: Some("original".into()),
            after: "latest task version".into(),
            pending: None,
            undone: false,
            removed: false,
            pending_remove: true,
        });
        journal.persist(&data).unwrap();
        drop(access);
        let mut access = CreationAccess::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        access
            .undo_assistant_task(&identity, &task.id, None, &data, &protection)
            .unwrap();
        assert_eq!(
            fs::read_to_string(root.join("removed.js")).unwrap(),
            "original"
        );
    }
    #[test]
    fn interrupted_publication_reconciles_before_resume_and_undo() {
        let temp = tempfile::tempdir().unwrap();
        let root = super::super::tests::project(temp.path(), "score");
        let data = temp.path().join("data");
        let protection = Protection::default();
        let mut access = CreationAccess::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        let task = access
            .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
            .unwrap();
        let mut journal = load(&data, &fs::canonicalize(&root).unwrap(), &task.id).unwrap();
        journal.entries.push(Entry {
            path: "new.js".into(),
            before: None,
            after: String::new(),
            pending: Some("created".into()),
            undone: false,
            removed: false,
            pending_remove: false,
        });
        journal.persist(&data).unwrap();
        fs::write(root.join("new.js"), "created").unwrap();
        drop(access);
        let mut access = CreationAccess::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        access
            .begin_assistant_task(
                &identity,
                AssistantMode::Edit,
                Some(&task.id),
                &data,
                &protection,
            )
            .unwrap();
        access
            .write_assistant_file(
                &identity,
                &task.id,
                &AssistantWrite {
                    path: "new.js".into(),
                    version: Some(file_version(b"created")),
                    text: Some("second revision".into()),
                    edits: None,
                },
                &data,
                &protection,
            )
            .unwrap();
        access.end_assistant_task(&identity, &task.id);
        access
            .undo_assistant_task(&identity, &task.id, None, &data, &protection)
            .unwrap();
        assert!(!root.join("new.js").exists());
    }
}
