//! Compiler output is a task mutation: stage first, journal every byte, then
//! publish through held directories. Recovery never grants permission to run.
use super::super::compile;
use super::*;
use std::sync::{atomic::AtomicBool, Arc};

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantBuildFile {
    pub path: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantCompilationReceipt {
    pub inputs: Vec<AssistantBuildFile>,
    pub artifacts: Vec<AssistantBuildFile>,
    pub report: SynthdefCompileReport,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantBuildState {
    pub needed: bool,
    pub reason: Option<String>,
    pub receipt: Option<AssistantCompilationReceipt>,
}

#[derive(Debug, Clone, Copy, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AssistantCompileStatus {
    Succeeded,
    CompilerUnavailable,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantCompileResult {
    pub task: AssistantTask,
    pub status: AssistantCompileStatus,
    pub reused: bool,
    pub report: SynthdefCompileReport,
    pub inputs: Vec<AssistantBuildFile>,
    pub artifacts: Vec<AssistantBuildFile>,
}

#[derive(Serialize, Deserialize)]
pub(super) struct ArtifactEntry {
    pub path: String,
    pub before: Option<Vec<u8>>,
    after: Vec<u8>,
    pending: Option<Vec<u8>>,
    pub undone: bool,
    #[serde(default)]
    pending_undo: bool,
    permissions: u32,
}

pub struct AssistantOperation {
    identity: String,
    task_id: String,
    cancelled: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
}
pub(crate) struct OperationGuard {
    pub(crate) cancelled: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
}
impl Drop for OperationGuard {
    fn drop(&mut self) {
        self.finished.store(true, Ordering::Release);
    }
}

pub struct AssistantCompileJob {
    task_id: String,
    job: compile::SynthdefCompileJob,
    previous: Option<AssistantCompilationReceipt>,
    operation: OperationGuard,
}
pub struct AssistantCompileOutput {
    task_id: String,
    output: compile::SynthdefCompileOutput,
    reused: bool,
    unavailable: bool,
    operation: OperationGuard,
}

fn files(versions: &BTreeMap<String, String>, prefix: &str) -> Vec<AssistantBuildFile> {
    versions
        .iter()
        .map(|(path, version)| AssistantBuildFile {
            path: format!("{prefix}{path}"),
            version: version.clone(),
        })
        .collect()
}
fn matches_receipt(
    job: &compile::SynthdefCompileJob,
    receipt: &AssistantCompilationReceipt,
) -> bool {
    receipt.report.error.is_none()
        && !receipt.report.produced.is_empty()
        && receipt.inputs == files(&job.inputs, "")
        && receipt.artifacts == files(&job.artifacts, "supercollider/synthdefs/")
}

fn artifact_name(path: &str) -> Result<&str, CreationError> {
    let name = path
        .strip_prefix("supercollider/synthdefs/")
        .filter(|name| !name.is_empty() && !name.contains('/') && name.ends_with(".scsyndef"))
        .ok_or_else(|| invalid("Task artifacts must be direct SynthDef outputs"))?;
    text_creation::admitted_destination(path)?;
    Ok(name)
}
fn artifact_bytes(project: &OpenProject, path: &str) -> Result<Option<Vec<u8>>, CreationError> {
    let name = CString::new(artifact_name(path)?).map_err(|_| invalid("Invalid artifact name"))?;
    let directory = match directories::direct(project, "supercollider/synthdefs") {
        Ok(directory) => directory,
        Err(error) if error.code == CreationErrorCode::Missing => return Ok(None),
        Err(error) => return Err(error),
    };
    match compile::open_at(&directory, &name, libc::O_RDONLY, 0) {
        Ok(file) => bounded_read(file, IMAGE_MAX_BYTES).map(Some),
        Err(error) if error.code == CreationErrorCode::Missing => Ok(None),
        Err(error) => Err(error),
    }
}
fn conflict(path: &str) -> CreationError {
    CreationError::new(CreationErrorCode::VersionConflict, path)
}
fn verify_artifact_directory(project: &OpenProject, held: &fs::File) -> Result<(), CreationError> {
    let current = directories::direct(project, "supercollider/synthdefs")?
        .metadata()
        .map_err(io_error)?;
    let held = held.metadata().map_err(io_error)?;
    if current.ino() != held.ino() || current.dev() != held.dev() {
        return Err(conflict("SynthDef output directory changed"));
    }
    Ok(())
}

impl CreationAccess {
    pub(crate) fn begin_assistant_operation(
        &mut self,
        identity: &str,
        task_id: &str,
    ) -> Result<OperationGuard, CreationError> {
        if self
            .assistant_operation
            .as_ref()
            .is_some_and(|operation| !operation.finished.load(Ordering::Acquire))
        {
            return Err(invalid(
                "An assistant compiler or test process is still running",
            ));
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(AtomicBool::new(false));
        self.assistant_operation = Some(AssistantOperation {
            identity: identity.into(),
            task_id: task_id.into(),
            cancelled: cancelled.clone(),
            finished: finished.clone(),
        });
        Ok(OperationGuard {
            cancelled,
            finished,
        })
    }
    pub fn cancel_assistant_operation(&self, identity: &str, task_id: &str) {
        if let Some(operation) = self
            .assistant_operation
            .as_ref()
            .filter(|operation| operation.identity == identity && operation.task_id == task_id)
        {
            operation.cancelled.store(true, Ordering::Release);
        }
    }
    pub fn cancel_assistant_operations(&self, identity: Option<&str>) -> Option<Arc<AtomicBool>> {
        self.assistant_operation
            .as_ref()
            .filter(|operation| identity.is_none_or(|identity| operation.identity == identity))
            .map(|operation| {
                operation.cancelled.store(true, Ordering::Release);
                operation.finished.clone()
            })
    }
    pub fn assistant_build_state(
        &self,
        identity: &str,
        id: &str,
        project_check: bool,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantBuildState, CreationError> {
        self.authorize_assistant_task(identity, id, true, protection)?;
        let project = self.current(identity, protection)?;
        let journal = load(data, &project.root, id)?;
        let touched_source = journal.entries.iter().any(|entry| {
            !entry.undone
                && entry.path.starts_with("supercollider/source/")
                && entry.path.ends_with(".scd")
        });
        let source_work = journal.entries.iter().any(|entry| {
            !entry.undone
                && !["md", "txt"].contains(
                    &Path::new(&entry.path)
                        .extension()
                        .and_then(|s| s.to_str())
                        .unwrap_or(""),
                )
        });
        let inspect_missing_references =
            source_work || (project_check && !journal.entries.iter().any(|entry| !entry.undone));
        let references = if inspect_missing_references || journal.compilation.is_some() {
            self.manifest(identity, protection)?
                .audio
                .synthdefs
                .unwrap_or_default()
        } else {
            vec![]
        };
        // Removing the final source and its declarations ends the build
        // obligation, including a previous receipt. A JS-only project also
        // needs no compiler merely because its manifest or server changed.
        if (inspect_missing_references || journal.compilation.is_some()) && references.is_empty() {
            let names = match project
                .file("supercollider/source")
                .and_then(directory_names)
            {
                Ok(names) => names,
                Err(error) if error.code == CreationErrorCode::Missing => vec![],
                Err(error) => return Err(error),
            };
            if !names
                .iter()
                .any(|name| Path::new(name).extension().is_some_and(|ext| ext == "scd"))
            {
                return Ok(AssistantBuildState {
                    needed: false,
                    reason: None,
                    receipt: None,
                });
            }
        }
        let missing_reference = inspect_missing_references
            && references.iter().any(|path| {
                project
                    .file(path)
                    .and_then(|file| bounded_read(file, IMAGE_MAX_BYTES))
                    .ok()
                    .is_none_or(|bytes| {
                        let name = Path::new(path)
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy();
                        compile::validate_artifact(&name, &bytes).is_err()
                    })
            });
        if !touched_source && !missing_reference && journal.compilation.is_none() {
            return Ok(AssistantBuildState {
                needed: false,
                reason: None,
                receipt: None,
            });
        }
        let current = self.prepare_synthdefs(identity, protection);
        let fresh = current
            .as_ref()
            .ok()
            .zip(journal.compilation.as_ref())
            .is_some_and(|(job, receipt)| matches_receipt(job, receipt));
        Ok(AssistantBuildState {
            needed: !fresh,
            reason: (!fresh).then(|| {
                current.err().map(|error| error.detail).unwrap_or_else(|| {
                    "Saved SynthDef inputs or generated artifacts need compilation".into()
                })
            }),
            receipt: fresh.then_some(journal.compilation).flatten(),
        })
    }
    pub fn prepare_assistant_synthdefs(
        &mut self,
        identity: &str,
        id: &str,
        protected_paths: &[String],
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantCompileJob, CreationError> {
        self.authorize_assistant_check(identity, id, data, protection)?;
        if protected_paths
            .iter()
            .any(|path| path == "manifest.json" || path.starts_with("supercollider/"))
        {
            return Err(conflict(
                "Save or reload protected SynthDef sources and manifest before compiling",
            ));
        }
        let mut journal = load(data, &self.current(identity, protection)?.root, id)?;
        self.reconcile_assistant_journal(identity, &mut journal, data, protection)?;
        self.verify_assistant_directories(identity, &journal, protection)?;
        let job = self.prepare_synthdefs(identity, protection)?;
        let previous = journal
            .compilation
            .filter(|receipt| matches_receipt(&job, receipt));
        let operation = self.begin_assistant_operation(identity, id)?;
        Ok(AssistantCompileJob {
            task_id: id.into(),
            job,
            previous,
            operation,
        })
    }
    pub fn finish_assistant_synthdefs(
        &mut self,
        mut result: AssistantCompileOutput,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantCompileResult, CreationError> {
        let identity = result.output.job.identity.clone();
        self.authorize_assistant_check(&identity, &result.task_id, data, protection)?;
        let cancelled = result.operation.cancelled.load(Ordering::Acquire);
        let mut journal = load(
            data,
            &self.current(&identity, protection)?.root,
            &result.task_id,
        )?;
        if cancelled {
            result.output.job.report.error =
                Some("SynthDef compilation cancelled; no staged output was published".into());
        } else if result.output.job.report.error.is_none() {
            let current = self.prepare_synthdefs(&identity, protection)?;
            if current.inputs != result.output.job.inputs
                || current.sources != result.output.job.sources
                || current.artifacts != result.output.job.artifacts
            {
                return Err(conflict(
                    "Compile inputs or artifacts changed while the compiler was running",
                ));
            }
            if !result.reused {
                let artifacts = result
                    .output
                    .staging
                    .as_ref()
                    .ok_or_else(|| invalid("Compiler staging is missing"))
                    .and_then(|staging| compile::collect_artifacts(staging.path()));
                match artifacts.and_then(|artifacts| {
                    self.publish_assistant_artifacts(
                        &identity,
                        &result.task_id,
                        &result.output.job,
                        artifacts,
                        data,
                        protection,
                    )
                }) {
                    Ok(report) => result.output.job.report = report,
                    Err(error) => result.output.job.report.error = Some(error.detail),
                }
                journal = load(
                    data,
                    &self.current(&identity, protection)?.root,
                    &result.task_id,
                )?;
            }
        }
        let cancelled = result.operation.cancelled.load(Ordering::Acquire);
        let status = if cancelled {
            AssistantCompileStatus::Cancelled
        } else if result.unavailable {
            AssistantCompileStatus::CompilerUnavailable
        } else if result.output.job.report.error.is_some() {
            AssistantCompileStatus::Failed
        } else {
            AssistantCompileStatus::Succeeded
        };
        let inputs = files(&result.output.job.inputs, "");
        let artifacts = files(
            &compile::artifact_versions(self.current(&identity, protection)?)?,
            "supercollider/synthdefs/",
        );
        if status == AssistantCompileStatus::Succeeded {
            journal.compilation = Some(AssistantCompilationReceipt {
                inputs: inputs.clone(),
                artifacts: artifacts.clone(),
                report: result.output.job.report.clone(),
            });
            journal.persist(data)?;
        }
        Ok(AssistantCompileResult {
            task: journal.summary(),
            status,
            reused: result.reused,
            report: result.output.job.report,
            inputs,
            artifacts,
        })
    }

    fn publish_assistant_artifacts(
        &mut self,
        identity: &str,
        id: &str,
        job: &compile::SynthdefCompileJob,
        artifacts: BTreeMap<String, Vec<u8>>,
        data: &Path,
        protection: &Protection,
    ) -> Result<SynthdefCompileReport, CreationError> {
        let mut report = job.report.clone();
        // Every declared output must come from this run, never a stale file.
        for reference in &mut report.references {
            let name = artifact_name(&reference.path)?;
            if !artifacts.contains_key(name) {
                return Err(invalid(format!(
                    "Compiler did not generate declared SynthDef {}",
                    reference.path
                )));
            }
            reference.status = compile::SynthdefReferenceStatus::Verified;
        }
        self.create_assistant_directory(identity, id, "supercollider/synthdefs", data, protection)?;
        let project = self.current(identity, protection)?;
        let mut journal = load(data, &project.root, id)?;
        for (name, bytes) in &artifacts {
            let path = format!("supercollider/synthdefs/{name}");
            let before = artifact_bytes(project, &path)?;
            if before.as_ref().map(|bytes| file_version(bytes)).as_ref() != job.artifacts.get(name)
            {
                return Err(conflict(&path));
            }
            let permissions = project
                .file(&path)
                .and_then(|file| file.metadata().map_err(io_error))
                .map(|metadata| metadata.permissions().mode())
                .unwrap_or(0o644);
            if let Some(entry) = journal
                .artifacts
                .iter_mut()
                .find(|entry| entry.path == path)
            {
                if entry.undone || before.as_deref() != Some(entry.after.as_slice()) {
                    return Err(conflict(&path));
                }
                entry.pending = Some(bytes.clone());
            } else {
                if journal.entries.len() + journal.artifacts.len() >= 64 {
                    return Err(invalid("Task recovery supports 64 files"));
                }
                journal.artifacts.push(ArtifactEntry {
                    path,
                    before: before.clone(),
                    after: before.unwrap_or_default(),
                    pending: Some(bytes.clone()),
                    undone: false,
                    pending_undo: false,
                    permissions,
                });
            }
        }
        journal.persist(data)?;
        let mut expected_artifacts = job.artifacts.clone();
        expected_artifacts.extend(
            artifacts
                .iter()
                .map(|(name, bytes)| (name.clone(), file_version(bytes))),
        );
        for (name, bytes) in artifacts {
            let path = format!("supercollider/synthdefs/{name}");
            let index = journal
                .artifacts
                .iter()
                .position(|entry| entry.path == path)
                .expect("journalled artifact");
            let entry = &journal.artifacts[index];
            let expected = if entry.before.is_none() && entry.after.is_empty() {
                None
            } else {
                Some(entry.after.as_slice())
            };
            let project = self.current(identity, protection)?;
            let directory = directories::direct(project, "supercollider/synthdefs")?;
            let target =
                CString::new(name.as_str()).map_err(|_| invalid("Invalid artifact name"))?;
            let policy = if expected.is_some() {
                PublishPolicy::Replace {
                    permissions: fs::Permissions::from_mode(entry.permissions),
                }
            } else {
                PublishPolicy::Create {
                    permissions: CreatePermissions::Exact(fs::Permissions::from_mode(
                        entry.permissions,
                    )),
                }
            };
            let receipt = publish_text_at(
                TextPublication {
                    directory: &directory,
                    name: &target,
                    bytes: &bytes,
                    policy,
                },
                || {
                    self.authorize_assistant_check(identity, id, data, protection)?;
                    if self
                        .assistant_operation
                        .as_ref()
                        .is_some_and(|operation| operation.cancelled.load(Ordering::Acquire))
                    {
                        return Err(invalid("SynthDef compilation cancelled before publication"));
                    }
                    let current = self.prepare_synthdefs(identity, protection)?;
                    if current.inputs != job.inputs
                        || current.sources != job.sources
                        || artifact_bytes(project, &path)?.as_deref() != expected
                    {
                        return Err(conflict(&path));
                    }
                    verify_artifact_directory(project, &directory)
                },
            )?;
            if receipt.state == PublicationState::Occupied {
                return Err(conflict(&path));
            }
            journal.artifacts[index].after = bytes;
            journal.artifacts[index].pending = None;
            journal.persist(data)?;
            report.produced.push(name);
        }
        let current = self.prepare_synthdefs(identity, protection)?;
        if current.inputs != job.inputs
            || current.sources != job.sources
            || current.artifacts != expected_artifacts
        {
            return Err(conflict("Compile inputs or artifacts changed during publication; task outputs remain recoverable"));
        }
        self.last_change = None;
        Ok(report)
    }

    pub(super) fn reconcile_assistant_artifacts(
        &self,
        identity: &str,
        journal: &mut Journal,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let project = self.current(identity, protection)?;
        let mut unpublished = Vec::new();
        for (index, entry) in journal.artifacts.iter_mut().enumerate() {
            let current = artifact_bytes(project, &entry.path)?;
            if entry.pending_undo {
                if current == entry.before {
                    entry.undone = true;
                    entry.pending_undo = false;
                    entry.pending = None;
                } else if current.as_deref() == Some(entry.after.as_slice()) {
                    entry.pending_undo = false;
                }
            }
            if let Some(pending) = &entry.pending {
                if current.as_ref() == Some(pending) {
                    entry.after = pending.clone();
                    entry.pending = None;
                } else if current.as_deref() == Some(entry.after.as_slice()) {
                    entry.pending = None;
                } else if current.is_none() && entry.before.is_none() && entry.after.is_empty() {
                    unpublished.push(index);
                }
            }
        }
        for index in unpublished.into_iter().rev() {
            journal.artifacts.remove(index);
        }
        journal.persist(data)
    }
    pub(super) fn verified_assistant_artifacts(
        &self,
        identity: &str,
        journal: &Journal,
        protection: &Protection,
    ) -> Result<Vec<AssistantTaskResumeFile>, CreationError> {
        let project = self.current(identity, protection)?;
        journal
            .artifacts
            .iter()
            .map(|entry| {
                if entry.undone
                    || entry.pending.is_some()
                    || entry.pending_undo
                    || artifact_bytes(project, &entry.path)?.as_deref()
                        != Some(entry.after.as_slice())
                {
                    return Err(conflict(&entry.path));
                }
                Ok(AssistantTaskResumeFile {
                    path: entry.path.clone(),
                    version: Some(file_version(&entry.after)),
                })
            })
            .collect()
    }
    pub(super) fn validate_assistant_artifact_undo(
        &self,
        identity: &str,
        journal: &Journal,
        path: Option<&str>,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let project = self.current(identity, protection)?;
        for entry in journal
            .artifacts
            .iter()
            .filter(|entry| !entry.undone && path.is_none_or(|path| path == entry.path))
        {
            let current = artifact_bytes(project, &entry.path)?;
            if entry.pending_undo
                || (current.as_deref() != Some(entry.after.as_slice()) && current != entry.pending)
            {
                return Err(conflict(&entry.path));
            }
        }
        Ok(())
    }
    pub(super) fn undo_assistant_artifacts(
        &self,
        identity: &str,
        journal: &mut Journal,
        path: Option<&str>,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        for index in 0..journal.artifacts.len() {
            if journal.artifacts[index].undone
                || path.is_some_and(|path| path != journal.artifacts[index].path)
            {
                continue;
            }
            self.validate_assistant_artifact_undo(
                identity,
                journal,
                Some(&journal.artifacts[index].path),
                protection,
            )?;
            journal.artifacts[index].pending_undo = true;
            journal.persist(data)?;
            let entry = &journal.artifacts[index];
            let project = self.current(identity, protection)?;
            let directory = directories::direct(project, "supercollider/synthdefs")?;
            let name = CString::new(artifact_name(&entry.path)?)
                .map_err(|_| invalid("Invalid artifact name"))?;
            if let Some(before) = &entry.before {
                publish_text_at(
                    TextPublication {
                        directory: &directory,
                        name: &name,
                        bytes: before,
                        policy: PublishPolicy::Replace {
                            permissions: fs::Permissions::from_mode(entry.permissions),
                        },
                    },
                    || {
                        validate_identity(project, protection)?;
                        if artifact_bytes(project, &entry.path)?.as_deref()
                            != Some(entry.after.as_slice())
                        {
                            return Err(conflict(&entry.path));
                        }
                        verify_artifact_directory(project, &directory)
                    },
                )?;
            } else {
                validate_identity(project, protection)?;
                if artifact_bytes(project, &entry.path)?.as_deref() != Some(entry.after.as_slice())
                {
                    return Err(conflict(&entry.path));
                }
                verify_artifact_directory(project, &directory)?;
                if unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0) } != 0 {
                    return Err(io_error(io::Error::last_os_error()));
                }
            }
            journal.artifacts[index].undone = true;
            journal.artifacts[index].pending_undo = false;
            journal.artifacts[index].pending = None;
            journal.compilation = None;
            journal.persist(data)?;
        }
        Ok(())
    }
}

impl AssistantCompileJob {
    pub fn run(self, compiler: &SynthdefCompiler) -> AssistantCompileOutput {
        let reused = self.previous.is_some();
        let unavailable = !reused && compiler.sclang.is_err();
        let output = if let Some(receipt) = self.previous {
            let mut job = self.job;
            job.report = receipt.report;
            compile::SynthdefCompileOutput { job, staging: None }
        } else {
            self.job
                .run_cancellable(compiler, &self.operation.cancelled)
        };
        AssistantCompileOutput {
            task_id: self.task_id,
            output,
            reused,
            unavailable,
            operation: self.operation,
        }
    }
}

#[cfg(test)]
mod tests;
