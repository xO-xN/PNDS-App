//! Saved-content handoff journals. Nothing here consults Git or conversation history.
use super::handoff::HandoffArchive;
use super::handoff_operation::HandoffOperation;
use super::*;
use crate::project::handoff::{HandoffTask, HANDOFF_PATH};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::time::{SystemTime, UNIX_EPOCH};

const SCHEMA: u32 = 1;
const RECORD_LIMIT: u64 = 64 * 1024 * 1024;
const STORAGE_LIMIT: u64 = 256 * 1024 * 1024;
const TEXT_BUDGET: usize = 8 * 1024 * 1024;
const RESOURCE_LIMIT: u64 = 512 * 1024 * 1024;
const HASH_BUDGET: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BaselineFile {
    pub path: String,
    pub sha256: String,
    pub size: f64,
    pub text: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BaselineExclusion {
    pub path: String,
    pub reason: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HandoffBaseline {
    schema: u32,
    project_key: String,
    pub id: String,
    pub task: HandoffTask,
    pub revision: String,
    pub captured_at: f64,
    pub complete: bool,
    expected_document: Option<String>,
    source_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    archive: Option<HandoffArchive>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    publication_version: Option<String>,
    #[serde(default)]
    exact_publication: bool,
    document: crate::project::handoff::HandoffDocument,
    pub files: Vec<BaselineFile>,
    pub excluded: Vec<BaselineExclusion>,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HandoffBaselineSummary {
    pub id: String,
    pub task_id: String,
    pub task: Option<HandoffTask>,
    pub intent: String,
    pub revision: String,
    pub captured_at: f64,
    pub complete: bool,
    pub bytes: f64,
    pub files: u32,
    pub excluded: Vec<BaselineExclusion>,
    pub error: Option<CreationError>,
}
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HandoffBaselineCatalog {
    pub baselines: Vec<HandoffBaselineSummary>,
    pub used_bytes: f64,
    pub limit_bytes: f64,
}

pub(super) fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn baseline_id(task: &HandoffTask) -> String {
    digest(format!("{}:{}", task.id, task.revision()).as_bytes())
}
fn publication_id(task: &HandoffTask, version: Option<&str>, source: &str) -> String {
    version.map_or_else(
        || baseline_id(task),
        |version| digest(format!("{}:{}:{version}:{source}", task.id, task.revision()).as_bytes()),
    )
}

fn same_archive(previous: Option<&HandoffArchive>, current: Option<&HandoffArchive>) -> bool {
    match (previous, current) {
        (None, None) => true,
        (Some(previous), Some(current)) => {
            previous.path == current.path && previous.text == current.text
        }
        _ => false,
    }
}
fn key(project: &OpenProject) -> String {
    digest(project.root.as_os_str().as_bytes())
}
fn invalid(detail: &str) -> CreationError {
    CreationError::new(CreationErrorCode::InvalidProject, detail)
}
fn conflict(path: &str) -> CreationError {
    CreationError::new(CreationErrorCode::VersionConflict, path)
}
fn stamp(metadata: &Metadata) -> (u64, u64, u64, i64, i64, i64, i64) {
    (
        metadata.dev(),
        metadata.ino(),
        metadata.len(),
        metadata.mtime(),
        metadata.mtime_nsec(),
        metadata.ctime(),
        metadata.ctime_nsec(),
    )
}

#[derive(Default)]
struct Snapshot {
    files: Vec<BaselineFile>,
    excluded: Vec<BaselineExclusion>,
    entries: usize,
    text_bytes: usize,
    hash_bytes: u64,
}
impl Snapshot {
    fn exclude(&mut self, path: &str, reason: &str) {
        self.excluded.push(BaselineExclusion {
            path: path.into(),
            reason: reason.into(),
        });
    }
    fn walk(
        &mut self,
        project: &OpenProject,
        relative: &Path,
        depth: usize,
        operation: &HandoffOperation,
    ) -> Result<(), CreationError> {
        operation.check(&project.descriptor.identity)?;
        if depth > MAX_DEPTH {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                "baselineDepth",
            ));
        }
        let directory = project.file(&relative.to_string_lossy())?;
        let before = stamp(&directory.metadata().map_err(io_error)?);
        let mut names = directory_names(directory)?;
        names.sort();
        for name in names {
            operation.check(&project.descriptor.identity)?;
            if crate::creation_data::contains(Path::new(&name)) {
                continue;
            }
            let child = relative.join(name);
            if fs::canonicalize(project.root.join(&child)).is_ok_and(|target| {
                target
                    .strip_prefix(&project.root)
                    .is_ok_and(crate::creation_data::contains)
            }) {
                continue;
            }
            self.entries += 1;
            if self.entries > MAX_ENTRIES {
                return Err(CreationError::new(
                    CreationErrorCode::TooLarge,
                    "baselineEntries",
                ));
            }
            let path = child.to_str().ok_or_else(|| invalid("baselinePathUtf8"))?;
            if let Some(reason) =
                super::assistant::excluded(path).filter(|reason| *reason != "lockfile")
            {
                self.exclude(path, reason);
                continue;
            }
            // Links are explicit exclusions; a changed alias can never smuggle a sensitive target into a snapshot.
            let metadata = fs::symlink_metadata(project.root.join(&child)).map_err(io_error)?;
            if metadata.file_type().is_symlink() {
                self.exclude(path, "symlink");
                continue;
            }
            let mut file = project.file(path)?;
            let metadata = file.metadata().map_err(io_error)?;
            if metadata.is_dir() {
                self.walk(project, &child, depth + 1, operation)?;
                continue;
            }
            if !metadata.is_file() {
                self.exclude(path, "notRegular");
                continue;
            }
            let text = file_kind(path) == CreationFileKind::Text
                || super::assistant::excluded(path) == Some("lockfile");
            if (text && metadata.len() > TEXT_MAX_BYTES)
                || metadata.len() > RESOURCE_LIMIT
                || self.hash_bytes + metadata.len() > HASH_BUDGET
            {
                self.exclude(path, "fileLimit");
                continue;
            }
            if text && self.text_bytes + metadata.len() as usize > TEXT_BUDGET {
                self.exclude(path, "textBudget");
                continue;
            }
            let mut hash = Sha256::new();
            let mut content = Vec::new();
            let mut total = 0u64;
            let mut buffer = [0u8; 64 * 1024];
            operation.hashing(path, 0, metadata.len(), self.files.len() as u32)?;
            loop {
                operation.check(&project.descriptor.identity)?;
                let count = file.read(&mut buffer).map_err(io_error)?;
                if count == 0 {
                    break;
                }
                total += count as u64;
                if total > metadata.len() {
                    return Err(conflict(path));
                }
                hash.update(&buffer[..count]);
                operation.hashing(path, total, metadata.len(), self.files.len() as u32)?;
                if text {
                    content.extend_from_slice(&buffer[..count]);
                }
            }
            if total != metadata.len()
                || stamp(&file.metadata().map_err(io_error)?) != stamp(&metadata)
                || stamp(&project.file(path)?.metadata().map_err(io_error)?) != stamp(&metadata)
            {
                return Err(conflict(path));
            }
            self.hash_bytes += total;
            let content = if text {
                match String::from_utf8(content) {
                    Ok(value) if !value.contains('\0') => {
                        self.text_bytes += value.len();
                        Some(value)
                    }
                    _ => {
                        self.exclude(path, "invalidText");
                        continue;
                    }
                }
            } else {
                None
            };
            self.files.push(BaselineFile {
                path: path.into(),
                sha256: format!("{:x}", hash.finalize()),
                size: total as f64,
                text: content,
            });
        }
        if stamp(
            &project
                .file(&relative.to_string_lossy())?
                .metadata()
                .map_err(io_error)?,
        ) != before
        {
            return Err(conflict(&relative.to_string_lossy()));
        }
        Ok(())
    }
    fn signature(&self) -> String {
        digest(&serde_json::to_vec(&(&self.files, &self.excluded)).expect("snapshot serializes"))
    }
}

pub(super) fn capture(
    project: &OpenProject,
    protection: &Protection,
    operation: &HandoffOperation,
) -> Result<(Vec<BaselineFile>, Vec<BaselineExclusion>), CreationError> {
    let mut first = Snapshot::default();
    first.walk(project, Path::new(""), 0, operation)?;
    let mut second = Snapshot::default();
    second.walk(project, Path::new(""), 0, operation)?;
    validate_identity(project, protection)?;
    if first.signature() != second.signature() {
        return Err(conflict("Project changed during baseline capture"));
    }
    Ok((first.files, first.excluded))
}
fn directory(
    app_data: &Path,
    project: &OpenProject,
    create: bool,
) -> Result<PathBuf, CreationError> {
    let mut path = app_data.to_path_buf();
    if create {
        fs::create_dir_all(&path).map_err(io_error)?;
    }
    for part in ["handoff-baselines", &key(project)] {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) if !meta.file_type().is_symlink() && meta.is_dir() => {}
            Ok(_) => {
                return Err(invalid(
                    "Unsafe baseline storage; choose a valid App data directory",
                ))
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if create {
                    fs::DirBuilder::new()
                        .mode(0o700)
                        .create(&path)
                        .map_err(io_error)?;
                }
            }
            Err(error) => return Err(io_error(error)),
        }
    }
    Ok(path)
}
fn record_path(directory: &Path, id: &str) -> Result<PathBuf, CreationError> {
    if id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(invalid("Invalid baseline ID"));
    }
    Ok(directory.join(format!("{id}.json")))
}
fn read_record(
    path: &Path,
    project: &OpenProject,
    id: &str,
) -> Result<HandoffBaseline, CreationError> {
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(io_error)?;
    let bytes = bounded_read(file, RECORD_LIMIT)?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| {
        invalid("Baseline is damaged; choose another baseline or explicitly delete this record")
    })?;
    if value.get("schema").and_then(|v| v.as_u64()) != Some(u64::from(SCHEMA)) {
        return Err(invalid(
            "Unsupported baseline format; use a compatible App or explicitly delete this record",
        ));
    }
    let record: HandoffBaseline = serde_json::from_value(value).map_err(|_| {
        invalid("Invalid baseline record; choose another baseline or explicitly delete this record")
    })?;
    if record.project_key != key(project)
        || record.id != id
        || publication_id(
            &record.task,
            record.publication_version.as_deref(),
            &record.source_fingerprint,
        ) != id
        || record.revision != record.task.revision()
        || record.document.version.as_deref()
            != Some(file_version(record.document.text.as_bytes()).as_str())
        || record
            .publication_version
            .as_ref()
            .is_some_and(|version| record.document.version.as_ref() != Some(version))
        || (record.exact_publication
            && !record
                .document
                .text
                .lines()
                .any(|line| line == record.task.revision_marker()))
        || record.archive.as_ref().is_some_and(|archive| {
            archive.path != super::handoff::archive_path(&archive.text)
                || archive.text.len() as u64 > TEXT_MAX_BYTES
                || record.expected_document.as_deref()
                    != Some(file_version(archive.text.as_bytes()).as_str())
        })
    {
        return Err(invalid("Baseline identity or revision mismatch"));
    }
    record.task.validate()?;
    let mut paths = std::collections::HashSet::new();
    for file in &record.files {
        if !paths.insert(&file.path)
            || file.path.is_empty()
            || Path::new(&file.path)
                .components()
                .any(|part| !matches!(part, Component::Normal(_)))
            || file.sha256.len() != 64
            || !file.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
            || !file.size.is_finite()
            || file.size < 0.0
            || file.text.as_ref().is_some_and(|text| {
                text.len() as f64 != file.size || digest(text.as_bytes()) != file.sha256
            })
        {
            return Err(invalid("Invalid baseline content"));
        }
    }
    Ok(record)
}
fn usage(directory: &Path) -> Result<u64, CreationError> {
    if !directory.exists() {
        return Ok(0);
    }
    let mut total = 0u64;
    for item in fs::read_dir(directory).map_err(io_error)? {
        let item = item.map_err(io_error)?;
        let metadata = item.path().symlink_metadata().map_err(io_error)?;
        if !metadata.file_type().is_symlink() && !metadata.is_file() {
            return Err(invalid("Unsafe baseline storage entry"));
        }
        total = total.saturating_add(metadata.len());
    }
    Ok(total)
}
fn publish(directory: &Path, record: &HandoffBaseline) -> Result<(), CreationError> {
    let path = record_path(directory, &record.id)?;
    let bytes = serde_json::to_vec(record).map_err(|_| invalid("Baseline serialization failed"))?;
    let old = path.symlink_metadata().map(|meta| meta.len()).unwrap_or(0);
    if bytes.len() as u64 > RECORD_LIMIT
        || usage(directory)?.saturating_sub(old) + bytes.len() as u64 > STORAGE_LIMIT
    {
        return Err(CreationError::new(
            CreationErrorCode::TooLarge,
            "Baseline capacity reached; explicitly delete selected old baselines and retry",
        ));
    }
    atomic_write(&path, &bytes, fs::Permissions::from_mode(0o600))
}
fn receipt(record: &HandoffBaseline) -> HandoffReceipt {
    HandoffReceipt {
        task: record.task.clone(),
        revision: record.revision.clone(),
        document: record.document.clone(),
        instructions: super::handoff::instructions(&record.task),
        task_recorded: record.complete,
        baseline_id: Some(record.id.clone()),
        baseline_error: None,
        archive_path: record.archive.as_ref().map(|archive| archive.path.clone()),
    }
}

impl CreationAccess {
    pub fn record_handoff_baseline_with_operation(
        &mut self,
        app_data: &Path,
        identity: &str,
        token: &str,
        protection: &Protection,
        operation: &HandoffOperation,
    ) -> Result<HandoffReceipt, CreationError> {
        operation.check(identity)?;
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        let review = self
            .handoff_review
            .as_ref()
            .filter(|review| review.identity == identity && review.token == token)
            .ok_or_else(|| conflict("Review the handoff again"))?
            .clone();
        let directory = directory(app_data, project, true)?;
        let planned = review.planned_document()?;
        let existing_revision = review
            .document
            .text
            .lines()
            .any(|line| line == review.task.revision_marker());
        // An explicit cleanup can change only the document while task criteria
        // stay identical. Keep its new origin separate from the old task baseline.
        let publication_version = (review.archive.is_some() || review.edited_base)
            .then(|| planned.version.clone().expect("planned document version"));
        let mut id = publication_id(
            &review.task,
            publication_version.as_deref(),
            &review.fingerprint,
        );
        // Reopening a recorded task must reuse its origin even when a prior
        // cleanup gave it a publication-specific ID. A pending publication that
        // only managed to add its own archive also keeps the original capture.
        let catalog = self.list_handoff_baselines(app_data, identity, protection)?;
        let mut completed = None;
        for summary in catalog.baselines.iter().filter(|summary| {
            summary.error.is_none()
                && summary.task_id == review.task.id
                && summary.revision == review.revision
        }) {
            let previous =
                self.load_handoff_baseline(app_data, identity, &summary.id, protection)?;
            if existing_revision && publication_version.is_none() {
                if previous.document.version == planned.version {
                    id = previous.id;
                    completed = None;
                    break;
                }
                if completed.is_none() && previous.complete {
                    completed = Some(previous.id);
                }
            } else if !previous.complete
                && previous.document.version == planned.version
                && previous.expected_document == review.document.version
                && same_archive(previous.archive.as_ref(), review.archive.as_ref())
                && super::handoff::publication_fingerprint(project, previous.archive.as_ref())?
                    == previous.source_fingerprint
            {
                id = previous.id;
                break;
            }
        }
        if let Some(completed) = completed {
            id = completed;
        }
        if record_path(&directory, &id)?.exists() {
            let previous = self.load_handoff_baseline(app_data, identity, &id, protection)?;
            let already_published = previous.document.version == review.document.version
                && previous.document.version == planned.version;
            if !previous.complete
                && !already_published
                && (previous.document.version != planned.version
                    || previous.expected_document != review.document.version
                    || !same_archive(previous.archive.as_ref(), review.archive.as_ref()))
            {
                return Err(conflict("This pending origin belongs to a different prepared handoff. Review an explicitly updated task or retry the original recorded origin."));
            }
            operation.begin_publication()?;
            if previous.complete
                && publication_version.is_some()
                && review.document.version != planned.version
            {
                // Identical saved source and output can recur (for example the
                // same erroneous note was reintroduced). Reapply this exact
                // reviewed plan without replacing its equivalent saved origin.
                let mut result = receipt(&previous);
                result.document = self.confirm_handoff(identity, token, protection)?.document;
                return Ok(result);
            }
            return self.retry_handoff_baseline(app_data, identity, &id, protection);
        }
        if existing_revision && publication_version.is_none() {
            return Err(CreationError::new(CreationErrorCode::Missing, "The baseline for this recorded task revision is missing. Review a new task revision to establish a new origin"));
        }
        if super::handoff::fingerprint(project)? != review.fingerprint {
            return Err(conflict("Project changed; review the handoff again"));
        }
        let (mut files, excluded) = capture(project, protection, operation)?;
        if super::handoff::fingerprint(project)? != review.fingerprint {
            return Err(conflict("Project changed during baseline capture"));
        }
        let text = planned.text;
        files.retain(|file| file.path != HANDOFF_PATH);
        files.push(BaselineFile {
            path: HANDOFF_PATH.into(),
            sha256: digest(text.as_bytes()),
            size: text.len() as f64,
            text: Some(text.clone()),
        });
        if let Some(archive) = &review.archive {
            files.retain(|file| file.path != archive.path);
            files.push(BaselineFile {
                path: archive.path.clone(),
                sha256: digest(archive.text.as_bytes()),
                size: archive.text.len() as f64,
                text: Some(archive.text.clone()),
            });
        }
        if files
            .iter()
            .filter_map(|file| file.text.as_ref())
            .map(String::len)
            .sum::<usize>()
            > TEXT_BUDGET
        {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                "baselineTextBudget",
            ));
        }
        files.sort_by(|a, b| a.path.cmp(&b.path));
        let mut record = HandoffBaseline {
            schema: SCHEMA,
            project_key: key(project),
            id: id.clone(),
            revision: review.revision,
            task: review.task,
            captured_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| invalid("Invalid clock"))?
                .as_millis() as f64,
            complete: false,
            expected_document: review.document.version,
            source_fingerprint: review.fingerprint,
            archive: review.archive,
            publication_version,
            exact_publication: true,
            document: crate::project::handoff::HandoffDocument {
                version: Some(file_version(text.as_bytes())),
                text,
            },
            files,
            excluded,
        };
        // Persist the immutable origin before task publication. A later retry never recaptures current files.
        operation.check(identity)?;
        publish(&directory, &record)?;
        operation.begin_publication()?;
        match self.confirm_handoff(identity, token, protection) {
            Ok(_) => {
                record.complete = true;
                let mut result = receipt(&record);
                if let Err(error) = publish(&directory, &record) {
                    result.baseline_error = Some(error);
                }
                Ok(result)
            }
            Err(error) => {
                let mut result = receipt(&record);
                result.baseline_error = Some(error);
                Ok(result)
            }
        }
    }
    pub fn load_handoff_baseline(
        &self,
        app_data: &Path,
        identity: &str,
        id: &str,
        protection: &Protection,
    ) -> Result<HandoffBaseline, CreationError> {
        let project = self.current(identity, protection)?;
        read_record(
            &record_path(&directory(app_data, project, false)?, id)?,
            project,
            id,
        )
    }
    pub fn retry_handoff_baseline(
        &mut self,
        app_data: &Path,
        identity: &str,
        id: &str,
        protection: &Protection,
    ) -> Result<HandoffReceipt, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        let directory = directory(app_data, project, false)?;
        let mut record = self.load_handoff_baseline(app_data, identity, id, protection)?;
        if record.complete {
            let mut result = receipt(&record);
            result.document = self.read_handoff(identity, protection)?;
            return Ok(result);
        }
        let current = self.read_handoff(identity, protection)?;
        let published = if record.exact_publication || record.publication_version.is_some() {
            current.version == record.document.version
        } else {
            current
                .text
                .lines()
                .any(|line| line == record.task.revision_marker())
        };
        if !published {
            if super::handoff::publication_fingerprint(project, record.archive.as_ref())?
                != record.source_fingerprint
            {
                return Err(conflict("Saved files changed; the captured origin is retained. Review a new task revision"));
            }
            if current.version != record.expected_document {
                return Err(conflict(
                    "Handoff changed; the captured origin is retained. Review a new task revision",
                ));
            }
            let written = self.publish_handoff_plan(
                identity,
                &record.document,
                record.expected_document.as_deref(),
                &record.source_fingerprint,
                record.archive.as_ref(),
                protection,
            )?;
            if written.version != record.document.version {
                return Err(conflict("Handoff publication differs from captured origin"));
            }
        }
        if let Some(archive) = &record.archive {
            super::handoff::publish_archive(project, archive, protection)?;
        }
        record.complete = true;
        let mut result = receipt(&record);
        result.document = self.read_handoff(identity, protection)?;
        if let Err(error) = publish(&directory, &record) {
            result.baseline_error = Some(error);
        }
        Ok(result)
    }
    pub fn list_handoff_baselines(
        &self,
        app_data: &Path,
        identity: &str,
        protection: &Protection,
    ) -> Result<HandoffBaselineCatalog, CreationError> {
        let project = self.current(identity, protection)?;
        let directory = directory(app_data, project, false)?;
        let mut baselines = Vec::new();
        if directory.exists() {
            for item in fs::read_dir(&directory).map_err(io_error)? {
                let item = item.map_err(io_error)?;
                let name = item.file_name();
                let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".json")) else {
                    continue;
                };
                record_path(&directory, id)?;
                let bytes = item.path().symlink_metadata().map_err(io_error)?.len() as f64;
                let summary = match read_record(&item.path(), project, id) {
                    Ok(record) => HandoffBaselineSummary {
                        id: id.into(),
                        task: Some(record.task.clone()),
                        task_id: record.task.id,
                        intent: record.task.intent,
                        revision: record.revision,
                        captured_at: record.captured_at,
                        complete: record.complete,
                        bytes,
                        files: record.files.len() as u32,
                        excluded: record.excluded,
                        error: None,
                    },
                    Err(error) => HandoffBaselineSummary {
                        id: id.into(),
                        task: None,
                        task_id: String::new(),
                        intent: String::new(),
                        revision: String::new(),
                        captured_at: 0.0,
                        complete: false,
                        bytes,
                        files: 0,
                        excluded: Vec::new(),
                        error: Some(error),
                    },
                };
                baselines.push(summary);
            }
        }
        baselines.sort_by(|a, b| b.captured_at.total_cmp(&a.captured_at));
        Ok(HandoffBaselineCatalog {
            baselines,
            used_bytes: usage(&directory)? as f64,
            limit_bytes: STORAGE_LIMIT as f64,
        })
    }
    pub fn delete_handoff_baseline(
        &self,
        app_data: &Path,
        identity: &str,
        id: &str,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let project = self.current(identity, protection)?;
        let path = record_path(&directory(app_data, project, false)?, id)?;
        fs::remove_file(path).map_err(io_error)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HandoffChangeKind {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HandoffFileDifference {
    pub path: String,
    pub kind: HandoffChangeKind,
    pub mentioned: bool,
    pub before: Option<BaselineFile>,
    pub after: Option<BaselineFile>,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HandoffComparison {
    pub baseline_id: String,
    pub task: HandoffTask,
    pub revision: String,
    pub captured_at: f64,
    pub current_fingerprint: String,
    pub changes: Vec<HandoffFileDifference>,
    pub baseline_excluded: Vec<BaselineExclusion>,
    pub current_excluded: Vec<BaselineExclusion>,
    pub compared_files: u32,
}
impl CreationAccess {
    pub fn compare_handoff_baseline_with_operation(
        &self,
        app_data: &Path,
        identity: &str,
        id: &str,
        protection: &Protection,
        operation: &HandoffOperation,
    ) -> Result<HandoffComparison, CreationError> {
        operation.check(identity)?;
        let project = self.current(identity, protection)?;
        let baseline = self.load_handoff_baseline(app_data, identity, id, protection)?;
        if !baseline.complete {
            return Err(invalid(
                "Handoff baseline is incomplete; retry this handoff first",
            ));
        }
        let fingerprint = super::handoff::fingerprint(project)?;
        let (files, excluded) = capture(project, protection, operation)?;
        if super::handoff::fingerprint(project)? != fingerprint {
            return Err(conflict("Saved files changed during comparison; retry"));
        }
        let before: BTreeMap<_, _> = baseline
            .files
            .into_iter()
            .map(|file| (file.path.clone(), file))
            .collect();
        let after: BTreeMap<_, _> = files
            .into_iter()
            .map(|file| (file.path.clone(), file))
            .collect();
        let paths: std::collections::BTreeSet<_> =
            before.keys().chain(after.keys()).cloned().collect();
        let uncovered = |path: &str| {
            baseline
                .excluded
                .iter()
                .chain(excluded.iter())
                .any(|file| path == file.path || path.starts_with(&format!("{}/", file.path)))
        };
        let mut changes = Vec::new();
        let mut compared = 0;
        for path in paths {
            operation.check(identity)?;
            if uncovered(&path) {
                continue;
            }
            compared += 1;
            let old = before.get(&path);
            let new = after.get(&path);
            if old.map(|file| &file.sha256) == new.map(|file| &file.sha256) {
                continue;
            }
            let kind = match (old, new) {
                (None, Some(_)) => HandoffChangeKind::Added,
                (Some(_), None) => HandoffChangeKind::Deleted,
                _ => HandoffChangeKind::Modified,
            };
            changes.push(HandoffFileDifference {
                mentioned: baseline
                    .task
                    .files
                    .iter()
                    .any(|file| file == &path || path.starts_with(&format!("{file}/"))),
                path,
                kind,
                before: old.cloned(),
                after: new.cloned(),
            });
        }
        changes.sort_by(|a, b| {
            b.mentioned
                .cmp(&a.mentioned)
                .then_with(|| a.path.cmp(&b.path))
        });
        Ok(HandoffComparison {
            baseline_id: id.into(),
            task: baseline.task,
            revision: baseline.revision,
            captured_at: baseline.captured_at,
            current_fingerprint: fingerprint,
            changes,
            baseline_excluded: baseline.excluded,
            current_excluded: excluded,
            compared_files: compared,
        })
    }
    pub fn handoff_comparison_is_stale(
        &self,
        identity: &str,
        fingerprint: &str,
        protection: &Protection,
    ) -> Result<bool, CreationError> {
        Ok(super::handoff::fingerprint(self.current(identity, protection)?)? != fingerprint)
    }
}

#[cfg(test)]
impl CreationAccess {
    pub fn record_handoff_baseline(
        &mut self,
        data: &Path,
        identity: &str,
        token: &str,
        protection: &Protection,
    ) -> Result<HandoffReceipt, CreationError> {
        self.record_handoff_baseline_with_operation(
            data,
            identity,
            token,
            protection,
            &HandoffOperation::new(identity),
        )
    }
    pub fn compare_handoff_baseline(
        &self,
        data: &Path,
        identity: &str,
        id: &str,
        protection: &Protection,
    ) -> Result<HandoffComparison, CreationError> {
        self.compare_handoff_baseline_with_operation(
            data,
            identity,
            id,
            protection,
            &HandoffOperation::new(identity),
        )
    }
}
