//! Native mode grants and durable, content-checked task recovery. Git is independent.
use super::*;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::os::unix::fs::PermissionsExt;
mod resources;
pub use resources::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AssistantMode {
    Handoff,
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
#[derive(Serialize, Deserialize)]
struct Journal {
    root: PathBuf,
    directory_identity: String,
    id: String,
    mode: AssistantMode,
    entries: Vec<Entry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    resource_plans: Vec<AssistantResourcePlan>,
}
impl Journal {
    fn summary(&self) -> AssistantTask {
        AssistantTask {
            id: self.id.clone(),
            mode: self.mode,
            resource_plans: self.resource_plans.clone(),
            files: self
                .entries
                .iter()
                .map(|entry| AssistantTaskFile {
                    path: entry.path.clone(),
                    created: entry.before.is_none(),
                    undone: entry.undone,
                    removed: entry.removed.then_some(true),
                })
                .collect(),
        }
    }
    fn persist(&self, data: &Path) -> Result<(), CreationError> {
        let directory = journal_directory(data, &self.root);
        fs::create_dir_all(&directory).map_err(io_error)?;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).map_err(io_error)?;
        let bytes = serde_json::to_vec(self).map_err(|cause| invalid(cause.to_string()))?;
        if bytes.len() > 16 * 1024 * 1024 {
            return Err(invalid("Task recovery record is full"));
        }
        atomic_write(
            &directory.join(format!("{}.json", self.id)),
            &bytes,
            fs::Permissions::from_mode(0o600),
        )
    }
}
fn invalid(detail: impl Into<String>) -> CreationError {
    CreationError::new(CreationErrorCode::TestValidation, detail)
}
fn journal_directory(data: &Path, root: &Path) -> PathBuf {
    let digest = format!("{:x}", Sha256::digest(root.as_os_str().as_bytes()));
    data.join("assistant-tasks").join(digest)
}
fn load(data: &Path, root: &Path, id: &str) -> Result<Journal, CreationError> {
    if id.is_empty()
        || id.len() > 100
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(invalid("Invalid task ID"));
    }
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(journal_directory(data, root).join(format!("{id}.json")))
        .map_err(io_error)?;
    if !file.metadata().map_err(io_error)?.is_file() {
        return Err(invalid("Invalid recovery record"));
    }
    let bytes = bounded_read(file, 16 * 1024 * 1024)?;
    let journal: Journal =
        serde_json::from_slice(&bytes).map_err(|cause| invalid(cause.to_string()))?;
    let metadata = fs::metadata(root).map_err(io_error)?;
    let directory_identity = format!("{}:{}", metadata.dev(), metadata.ino());
    if journal.root != root
        || journal.directory_identity != directory_identity
        || journal.id != id
        || journal.entries.len() > 64
        || journal.resource_plans.len() > 16
    {
        return Err(invalid("Invalid recovery owner"));
    }
    Ok(journal)
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
        Ok(files)
    }
    fn reconcile_assistant_journal(
        &self,
        identity: &str,
        journal: &mut Journal,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let mut unpublished = Vec::new();
        for (index, entry) in journal.entries.iter_mut().enumerate() {
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
    pub fn begin_assistant_task(
        &mut self,
        identity: &str,
        mode: AssistantMode,
        resume: Option<&str>,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantTask, CreationError> {
        if resume.is_some_and(|id| self.git_ended_tasks.contains(id)) {
            return Err(invalid(
                "This task was explicitly ended before switching versions",
            ));
        }
        let project = self.current(identity, protection)?;
        let journal = if let Some(id) = resume {
            let mut journal = load(data, &project.root, id)?;
            self.reconcile_assistant_journal(identity, &mut journal, data, protection)?;
            if journal.mode != mode
                || journal
                    .entries
                    .iter()
                    .any(|entry| entry.undone || entry.pending_remove || entry.pending.is_some())
            {
                return Err(invalid("This task cannot be continued"));
            }
            self.verified_assistant_journal_files(identity, &journal, protection)?;
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
                entries: vec![],
                resource_plans: vec![],
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
        self.write_assistant_file_inner(identity, id, write, data, protection, false)
    }
    fn write_assistant_file_inner(
        &mut self,
        identity: &str,
        id: &str,
        write: &AssistantWrite,
        data: &Path,
        protection: &Protection,
        validated_library: bool,
    ) -> Result<AssistantTask, CreationError> {
        self.authorize_assistant_task(identity, id, false, protection)?;
        let mut journal = load(data, &self.current(identity, protection)?.root, id)?;
        journal.require_resource_decision()?;
        if journal.mode == AssistantMode::Handoff && write.path != "docs/creator-handoff.md" {
            return Err(invalid(
                "Handoff mode only maintains docs/creator-handoff.md",
            ));
        }
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
        journal.check_resource_write(&write.path, before.as_deref(), &after, validated_library)?;
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
            if journal.entries.len() >= 64 {
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
        let index = if let Some(index) = journal.entries.iter().position(|entry| entry.path == path)
        {
            let entry = &journal.entries[index];
            if entry.undone || entry.removed || entry.after != before {
                return Err(CreationError::new(CreationErrorCode::VersionConflict, path));
            }
            index
        } else {
            if journal.entries.len() >= 64 {
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
        static SERIAL: AtomicU64 = AtomicU64::new(0);
        let serial = SERIAL.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let temp = CString::new(format!(".pnds-save-task-{pid}-{serial}")).expect("generated name");
        let fd = directory.as_raw_fd();
        let temporary = unsafe {
            libc::openat(
                fd,
                temp.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o644,
            )
        };
        if temporary < 0 {
            return Err(io_error(io::Error::last_os_error()));
        }
        let mut file = unsafe { File::from_raw_fd(temporary) };
        let result = (|| {
            file.write_all(text.as_bytes()).map_err(io_error)?;
            file.sync_all().map_err(io_error)?;
            validate_identity(project, protection)?;
            if unsafe { libc::linkat(fd, temp.as_ptr(), fd, name.as_ptr(), 0) } != 0 {
                return Err(io_error(io::Error::last_os_error()));
            }
            Ok(())
        })();
        unsafe {
            libc::unlinkat(fd, temp.as_ptr(), 0);
        }
        result
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
            true,
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
                load(data, &project.root, id).map(|journal| journal.summary())
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
            let entry = &journal.entries[index];
            if entry.removed {
                if let Some(before) = &entry.before {
                    self.publish_assistant_file(identity, &entry.path, before, protection)?;
                }
                journal.entries[index].undone = true;
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
