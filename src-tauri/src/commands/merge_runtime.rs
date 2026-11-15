//! Saved candidate checks and the explicitly owned main-engine test run.
use crate::project::controlled_checks::{
    ControlledCheckContext, ControlledCheckOptions, ControlledCheckReport,
};
use crate::project::creation::{
    CreationAccess, CreationError, CreationErrorCode, GitMergeArtifact, GitMergeCandidate,
    GitMergeSnapshot, SynthdefCompileReport, SynthdefCompiler,
};
use crate::project::diagnostics::DiagnosticReport;
use crate::project::merge_runtime::{
    error, execution_copy, GitMergeRuntimeOwner, MergeAudition, MergeOperation, MergeRuntimeState,
    OwnedMergeRuntime,
};
use crate::project::session::{CreationRuntime, SessionManager, StartRequest};
use crate::types::AudioMode;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::io::{Read, Write};
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, Mutex,
};
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitMergeCheckOutcome {
    NotExecuted,
    Unavailable,
    Passed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeChecks {
    pub candidate_id: String,
    pub revision: u32,
    pub fingerprint: String,
    pub diagnostics: Option<DiagnosticReport>,
    pub compile: Option<SynthdefCompileReport>,
    pub compile_status: Option<GitMergeCheckOutcome>,
    pub tests: Option<ControlledCheckReport>,
    pub can_adopt: bool,
    pub fresh: bool,
    pub detail: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct SavedArtifact {
    path: String,
    bytes: String,
}
#[derive(Serialize, Deserialize)]
struct SavedChecks {
    report: GitMergeChecks,
    artifacts: Vec<SavedArtifact>,
    #[serde(default)]
    source_inputs: Option<crate::project::check_evidence::InputEvidence>,
}

fn read_record<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>, CreationError> {
    match std::fs::symlink_metadata(path) {
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(cause) => return Err(error(cause.to_string())),
        Ok(metadata)
            if !metadata.is_file()
                || metadata.is_symlink()
                || metadata.len() > 64 * 1024 * 1024 =>
        {
            return Err(error("Invalid merge operation receipt"))
        }
        Ok(_) => {}
    }
    let file = std::fs::File::open(path).map_err(|cause| error(cause.to_string()))?;
    serde_json::from_reader(file.take(64 * 1024 * 1024))
        .map(Some)
        .map_err(|cause| error(cause.to_string()))
}

fn write_record(path: &Path, record: &impl Serialize) -> Result<(), CreationError> {
    let parent = path
        .parent()
        .ok_or_else(|| error("Missing merge receipt directory"))?;
    let mut file =
        tempfile::NamedTempFile::new_in(parent).map_err(|cause| error(cause.to_string()))?;
    serde_json::to_writer(file.as_file_mut(), record).map_err(|cause| error(cause.to_string()))?;
    file.as_file_mut()
        .flush()
        .map_err(|cause| error(cause.to_string()))?;
    file.as_file()
        .sync_all()
        .map_err(|cause| error(cause.to_string()))?;
    file.persist(path)
        .map_err(|cause| error(cause.to_string()))?;
    Ok(())
}

fn source_inputs_fresh(evidence: Option<&crate::project::check_evidence::InputEvidence>) -> bool {
    let Some(evidence) = evidence else {
        return false;
    };
    let fresh = crate::project::check_evidence::source_freshness(
        Path::new(&evidence.source_root),
        None,
        evidence,
        &AtomicBool::new(false),
    );
    fresh.complete && !fresh.stale
}

fn has_node_tests(root: &Path) -> Result<bool, CreationError> {
    let mut pending = vec![std::path::PathBuf::new()];
    let mut entries = 0usize;
    while let Some(relative) = pending.pop() {
        for item in
            std::fs::read_dir(root.join(&relative)).map_err(|cause| error(cause.to_string()))?
        {
            entries += 1;
            if entries > 100_000 {
                return Err(error("Too many saved test inputs"));
            }
            let item = item.map_err(|cause| error(cause.to_string()))?;
            if item.file_name() == "node_modules" {
                continue;
            }
            let path = relative.join(item.file_name());
            let kind = item.file_type().map_err(|cause| error(cause.to_string()))?;
            if kind.is_dir() {
                pending.push(path);
            } else if kind.is_file()
                && crate::project::controlled_checks::supported_node_test_path(
                    &path.to_string_lossy(),
                )
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

struct Completion(MergeOperation);
impl Drop for Completion {
    fn drop(&mut self) {
        let (done, changed) = &*self.0.completed;
        *done.lock().unwrap_or_else(|cause| cause.into_inner()) = true;
        changed.notify_all();
    }
}
fn require_operations(
    app: &AppHandle,
    identity: &str,
    candidate: &str,
) -> Result<(), CreationError> {
    if !app.state::<MergeRuntimeState>().accepting_operations() {
        return Err(CreationError::new(
            CreationErrorCode::RuntimeBusy,
            "The app is shutting down; merge operations are paused",
        ));
    }
    if app
        .state::<MergeRuntimeState>()
        .transitioning
        .lock()
        .map_err(|_| error("Merge transition lock failed"))?
        .contains_key(&(identity.into(), candidate.into()))
    {
        return Err(CreationError::new(
            CreationErrorCode::RuntimeBusy,
            "Merge cleanup or publication owns this candidate",
        ));
    }
    Ok(())
}
pub(super) fn allow_candidate_operations(app: &AppHandle, identity: &str, candidate: &str) {
    app.state::<MergeRuntimeState>()
        .transitioning
        .lock()
        .unwrap_or_else(|cause| cause.into_inner())
        .remove(&(identity.into(), candidate.into()));
}
pub(super) fn allow_failed_candidate_transition(
    app: &AppHandle,
    identity: &str,
    candidate: &str,
    ticket: u64,
) {
    let state = app.state::<MergeRuntimeState>();
    let mut transitions = state
        .transitioning
        .lock()
        .unwrap_or_else(|cause| cause.into_inner());
    release_failed_transition(&mut transitions, identity, candidate, ticket);
}
fn release_failed_transition(
    transitions: &mut std::collections::BTreeMap<(String, String), u64>,
    identity: &str,
    candidate: &str,
    ticket: u64,
) {
    let key = (identity.into(), candidate.into());
    if transitions.get(&key) == Some(&ticket) {
        transitions.remove(&key);
    }
}
fn begin_operation(
    app: &AppHandle,
    identity: &str,
    candidate: &str,
    round: Option<&str>,
    authorize: impl FnOnce() -> Result<(), CreationError>,
) -> Result<Completion, CreationError> {
    require_operations(app, identity, candidate)?;
    let state = app.state::<MergeRuntimeState>();
    let mut slot = state
        .operation
        .lock()
        .map_err(|_| error("Merge check lock failed"))?;
    if slot.as_ref().is_some_and(|previous| {
        !*previous
            .completed
            .0
            .lock()
            .unwrap_or_else(|cause| cause.into_inner())
    }) {
        return Err(error(
            "A merge check is active or cleanup has not completed",
        ));
    }
    // A transition may have begun while this caller waited for the slot.
    // Publish only while both lifecycle admission and assistant ownership hold.
    require_operations(app, identity, candidate)?;
    authorize()?;
    let operation = MergeOperation {
        identity: identity.into(),
        candidate_id: candidate.into(),
        round_id: round.map(str::to_owned),
        cancelled: Arc::new(AtomicBool::new(false)),
        completed: Arc::new((Mutex::new(false), Condvar::new())),
    };
    *slot = Some(operation.clone());
    Ok(Completion(operation))
}
fn cancel_operation(
    app: &AppHandle,
    identity: &str,
    candidate: &str,
    round: Option<&str>,
) -> Result<(), CreationError> {
    let operation = app
        .state::<MergeRuntimeState>()
        .operation
        .lock()
        .map_err(|_| error("Merge check lock failed"))?
        .clone();
    if let Some(operation) = operation.filter(|operation| {
        operation.identity == identity
            && operation.candidate_id == candidate
            && round.is_none_or(|round| operation.round_id.as_deref() == Some(round))
    }) {
        operation.cancelled.store(true, Ordering::Release);
        let (done, changed) = &*operation.completed;
        let done = done
            .lock()
            .map_err(|_| error("Merge check completion lock failed"))?;
        let (done, _) = changed
            .wait_timeout_while(done, std::time::Duration::from_secs(10), |done| !*done)
            .map_err(|_| error("Merge check cleanup failed"))?;
        if !*done {
            return Err(CreationError::new(
                CreationErrorCode::RuntimeBusy,
                "Merge check cleanup is not confirmed; retry stopping",
            ));
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_merge_candidate_manifest(
    app: AppHandle,
    creation: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
) -> Result<crate::project::manifest::Manifest, CreationError> {
    let access = creation.access.clone();
    super::creation::run_blocking(move || {
        let saved = access
            .lock()
            .map_err(|_| error("Creation lock failed"))?
            .prepare_git_merge_snapshot(
                &identity,
                &candidate_id,
                revision,
                false,
                &super::creation::protection(&app)?,
            )?;
        crate::project::manifest::load_manifest(&saved.root).map_err(error)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn preflight_merge_candidate(
    app: AppHandle,
    creation: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
) -> Result<crate::project::manifest::Manifest, CreationError> {
    let access = creation.access.clone();
    super::creation::run_blocking(move || {
        let protection = super::creation::protection(&app)?;
        let saved = access
            .lock()
            .map_err(|_| error("Creation lock failed"))?
            .prepare_git_merge_snapshot(&identity, &candidate_id, revision, true, &protection)?;
        let data = super::project::app_data_dir(&app).map_err(error)?;
        let copy = execution_copy(saved, &data, &AtomicBool::new(false))?;
        let manifest = super::project::preflight_candidate(
            &app,
            &app.state::<SessionManager>(),
            &copy.root.to_string_lossy(),
        )
        .map_err(error)?;
        access
            .lock()
            .map_err(|_| error("Creation lock failed"))?
            .git_merge_fresh(&identity, &candidate_id, revision, &protection)?;
        Ok(manifest)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_merge_candidate_runtime(app: AppHandle) -> Result<CreationRuntime, CreationError> {
    Ok(app
        .state::<MergeRuntimeState>()
        .current(&app.state::<SessionManager>()))
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn start_merge_candidate_runtime(
    app: AppHandle,
    creation: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
    mode: AudioMode,
    lan_ip: String,
    osc_target: Option<String>,
) -> Result<CreationRuntime, CreationError> {
    let access = creation.access.clone();
    super::creation::run_blocking(move || {
        require_operations(&app, &identity, &candidate_id)?;
        let protection = super::creation::protection(&app)?;
        let saved = access
            .lock()
            .map_err(|_| error("Creation lock failed"))?
            .prepare_git_merge_snapshot(&identity, &candidate_id, revision, true, &protection)?;
        let data = super::project::app_data_dir(&app).map_err(error)?;
        let execution = execution_copy(saved, &data, &AtomicBool::new(false))?;
        let state = app.state::<MergeRuntimeState>();
        let mut slot = state
            .runtime
            .lock()
            .map_err(|_| error("Merge runtime lock failed"))?;
        if slot.is_some() {
            return Err(CreationError::new(
                CreationErrorCode::RuntimeBusy,
                "Stop the previous merge test and confirm cleanup before starting",
            ));
        }
        let access = access.lock().map_err(|_| error("Creation lock failed"))?;
        require_operations(&app, &identity, &candidate_id)?;
        access.git_merge_fresh(&identity, &candidate_id, revision, &protection)?;
        let records = access.git_merge_records_directory(&identity, &candidate_id, &protection)?;
        let manager = app.state::<SessionManager>();
        if manager.has_active_session() {
            return Err(CreationError::new(
                CreationErrorCode::RuntimeBusy,
                "Stop the current runtime before testing the merge",
            ));
        }
        let path = execution.root.to_string_lossy().into_owned();
        // Reserve the exact next generation before spawning; a crash leaves a
        // durable receipt and the normal runtime journal retains cleanup truth.
        let generation = manager
            .creation_runtime()
            .generation
            .parse::<u64>()
            .map_err(|_| error("Invalid runtime generation"))?
            + 1;
        let mut owner = GitMergeRuntimeOwner {
            identity,
            project_root: execution.saved.project_root.to_string_lossy().into_owned(),
            candidate_id,
            revision,
            execution_path: path.clone(),
            generation: generation.to_string(),
        };
        write_record(&records.join("runtime.json"), &owner)?;
        let result = manager.start_merge_candidate(
            app.clone(),
            data,
            StartRequest::new(path, mode, lan_ip, osc_target).for_merge_candidate(),
        );
        if let Ok(generation) = &result {
            owner.generation = generation.clone();
        } else if manager.creation_runtime().snapshot.project_path.as_deref()
            != Some(owner.execution_path.as_str())
        {
            std::fs::remove_file(records.join("runtime.json"))
                .map_err(|cause| error(cause.to_string()))?;
            return Err(CreationError::new(
                CreationErrorCode::TestStartup,
                result.err().unwrap_or_default(),
            ));
        }
        *slot = Some(OwnedMergeRuntime {
            owner: owner.clone(),
            _execution: execution,
        });
        write_record(&records.join("runtime.json"), &owner)?;
        drop(slot);
        if let Err(detail) = result {
            return Err(CreationError::new(CreationErrorCode::TestStartup, detail));
        }
        let mut runtime = manager.creation_runtime();
        state.annotate(&mut runtime);
        Ok(runtime)
    })
    .await
}

/// Stops only the matching candidate generation. An original project run is
/// preserved. A missing in-memory owner still reconciles a crash receipt.
#[tauri::command]
#[specta::specta]
pub async fn stop_merge_candidate_runtime(
    app: AppHandle,
    creation: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
) -> Result<CreationRuntime, CreationError> {
    stop_candidate_runtime(app, creation.access.clone(), identity, candidate_id).await
}

pub(super) async fn stop_candidate_runtime_for_transition_with_ticket(
    app: AppHandle,
    identity: String,
    candidate_id: String,
) -> Result<u64, CreationError> {
    let ticket = {
        let state = app.state::<MergeRuntimeState>();
        let mut transitions = state
            .transitioning
            .lock()
            .map_err(|_| error("Merge transition lock failed"))?;
        let ticket = state.transition_sequence.fetch_add(1, Ordering::AcqRel) + 1;
        transitions.insert((identity.clone(), candidate_id.clone()), ticket);
        ticket
    };
    let access = app.state::<super::creation::CreationState>().access.clone();
    stop_candidate_runtime(app, access, identity, candidate_id)
        .await
        .map(|_| ticket)
}

async fn stop_candidate_runtime(
    app: AppHandle,
    access: Arc<Mutex<CreationAccess>>,
    identity: String,
    candidate_id: String,
) -> Result<CreationRuntime, CreationError> {
    stop_candidate_audition(&app, &identity, &candidate_id).await?;
    super::creation::run_blocking(move || {
        cancel_operation(&app, &identity, &candidate_id, None)?;
        let (records, project_root) = {
            let access = access.lock().map_err(|_| error("Creation lock failed"))?;
            let protection = super::creation::protection(&app)?;
            (
                access.git_merge_records_directory(&identity, &candidate_id, &protection)?,
                access.descriptor(&identity, &protection)?.root,
            )
        };
        let state = app.state::<MergeRuntimeState>();
        let mut slot = state
            .runtime
            .lock()
            .map_err(|_| error("Merge runtime lock failed"))?;
        let active = slot
            .as_ref()
            .filter(|run| run.owner.identity == identity && run.owner.candidate_id == candidate_id);
        let receipt = read_record::<GitMergeRuntimeOwner>(&records.join("runtime.json"))?;
        let owner = active.map(|run| run.owner.clone()).or(receipt);
        let manager = app.state::<SessionManager>();
        if let Some(owner) = owner {
            if owner.project_root != project_root || owner.candidate_id != candidate_id {
                return Err(error("Merge runtime receipt belongs to another candidate"));
            }
            let current = manager.creation_runtime();
            if current.generation == owner.generation
                && current.snapshot.project_path.as_deref() == Some(owner.execution_path.as_str())
            {
                manager
                    .stop_creation_generation(&app, &owner.generation)
                    .map_err(error)?;
            }
            let retired = crate::project::merge_runtime::previous_run_is_retired(&owner, &current);
            if !retired && manager.has_active_session() {
                return Err(CreationError::new(
                    CreationErrorCode::RuntimeBusy,
                    "Runtime cleanup is not confirmed; the candidate remains protected",
                ));
            }
            let data = super::project::app_data_dir(&app).map_err(error)?;
            let _lease = if retired {
                None
            } else {
                Some(
                    crate::project::runtime_gate::RuntimeLease::acquire(&data.join("runtime.lock"))
                        .map_err(|detail| {
                            CreationError::new(CreationErrorCode::RuntimeBusy, detail)
                        })?,
                )
            };
            std::fs::remove_file(records.join("runtime.json"))
                .map_err(|cause| error(cause.to_string()))?;
            if slot.as_ref().is_some_and(|run| run.owner == owner) {
                slot.take();
            }
        }
        drop(slot);
        Ok(state.current(&manager))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_merge_candidate_checks(
    app: AppHandle,
    creation: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
) -> Result<Option<GitMergeChecks>, CreationError> {
    let access = creation.access.clone();
    super::creation::run_blocking(move || {
        let access = access.lock().map_err(|_| error("Creation lock failed"))?;
        let protection = super::creation::protection(&app)?;
        let records = access.git_merge_records_directory(&identity, &candidate_id, &protection)?;
        let saved = read_record::<SavedChecks>(&records.join("checks.json"))?;
        Ok(saved.map(|mut saved| {
            saved.report.fresh = saved.report.candidate_id == candidate_id
                && saved.report.revision == revision
                && access
                    .git_merge_fresh(&identity, &candidate_id, revision, &protection)
                    .is_ok()
                && source_inputs_fresh(saved.source_inputs.as_ref());
            saved.report.can_adopt &= saved.report.fresh;
            saved.report
        }))
    })
    .await
}

async fn run_check(
    app: AppHandle,
    access: Arc<Mutex<CreationAccess>>,
    identity: String,
    candidate_id: String,
    revision: u32,
    kind: String,
    round_id: Option<String>,
) -> Result<GitMergeChecks, CreationError> {
    super::creation::run_blocking(move || {
        if !matches!(kind.as_str(), "diagnose" | "compile" | "tests") {
            return Err(error("Unsupported candidate check"));
        }
        let protection = super::creation::protection(&app)?;
        let completion =
            begin_operation(&app, &identity, &candidate_id, round_id.as_deref(), || {
                if let Some(round) = round_id.as_deref() {
                    access
                        .lock()
                        .map_err(|_| error("Creation lock failed"))?
                        .authorize_git_merge_assistant_check(
                            &identity,
                            &candidate_id,
                            round,
                            revision,
                            &protection,
                        )?;
                }
                Ok(())
            })?;
        let saved: GitMergeSnapshot = {
            let mut access = access.lock().map_err(|_| error("Creation lock failed"))?;
            match round_id.as_deref() {
                Some(round) => access.prepare_git_merge_assistant_snapshot(
                    &identity,
                    &candidate_id,
                    revision,
                    round,
                    kind == "tests",
                    &protection,
                )?,
                None => access.prepare_git_merge_snapshot(
                    &identity,
                    &candidate_id,
                    revision,
                    kind == "tests",
                    &protection,
                )?,
            }
        };
        let data = super::project::app_data_dir(&app).map_err(error)?;
        let execution = execution_copy(saved, &data, &completion.0.cancelled)?;
        let records = access
            .lock()
            .map_err(|_| error("Creation lock failed"))?
            .git_merge_records_directory(&identity, &candidate_id, &protection)?;
        let fingerprint = execution.saved.fingerprint.clone();
        let previous = read_record::<SavedChecks>(&records.join("checks.json"))
            .ok()
            .flatten();
        let mut saved = previous
            .filter(|previous| {
                previous.report.revision == revision
                    && previous.report.fingerprint == fingerprint
                    && previous.source_inputs.as_ref().is_some_and(|inputs| {
                        inputs.project_sha256 == execution.source_inputs.project_sha256
                    })
            })
            .unwrap_or_else(|| SavedChecks {
                report: GitMergeChecks {
                    candidate_id: candidate_id.clone(),
                    revision,
                    fingerprint,
                    diagnostics: None,
                    compile: None,
                    compile_status: None,
                    tests: None,
                    can_adopt: false,
                    fresh: true,
                    detail: None,
                },
                artifacts: vec![],
                source_inputs: Some(execution.source_inputs.clone()),
            });
        let shared = crate::project::shared_libraries::shipped_root(&app).ok();
        saved.report.diagnostics = Some(crate::project::diagnostics::diagnose_project(
            &execution.root,
            shared.as_deref(),
        ));
        if kind == "compile" {
            let mut copy_access = CreationAccess::default();
            let compiler = SynthdefCompiler::default();
            let prepared = copy_access
                .open(&execution.root, &protection)
                .and_then(|workspace| {
                    copy_access.prepare_synthdefs(&workspace.project.identity, &protection)
                });
            let (mut report, outcome) = match prepared {
                Err(cause) => (
                    SynthdefCompileReport {
                        sclang_path: None,
                        produced: vec![],
                        references: vec![],
                        output: String::new(),
                        error: Some(cause.detail),
                    },
                    if cause.code == CreationErrorCode::Missing {
                        GitMergeCheckOutcome::NotExecuted
                    } else {
                        GitMergeCheckOutcome::Failed
                    },
                ),
                Ok(_) if compiler.sclang.is_err() => (
                    SynthdefCompileReport {
                        sclang_path: None,
                        produced: vec![],
                        references: vec![],
                        output: String::new(),
                        error: compiler.sclang.as_ref().err().cloned(),
                    },
                    GitMergeCheckOutcome::Unavailable,
                ),
                Ok(job) => {
                    let output = job.run_cancellable(&compiler, &completion.0.cancelled);
                    let report = copy_access.finish_synthdefs(output, &protection)?;
                    let outcome = if completion.0.cancelled.load(Ordering::Acquire) {
                        GitMergeCheckOutcome::Cancelled
                    } else if report.error.is_none() {
                        GitMergeCheckOutcome::Passed
                    } else {
                        GitMergeCheckOutcome::Failed
                    };
                    (report, outcome)
                }
            };
            saved.artifacts.clear();
            if report.error.is_none()
                && report.references.iter().any(|reference| {
                    !report.produced.iter().any(|produced| {
                        reference.path == format!("supercollider/synthdefs/{produced}")
                    })
                })
            {
                report.error =
                    Some("This compile did not produce every declared SynthDef reference".into());
            }
            if report.error.is_none() && !completion.0.cancelled.load(Ordering::Acquire) {
                for produced in &report.produced {
                    let path = format!("supercollider/synthdefs/{produced}");
                    let bytes = std::fs::read(execution.root.join(&path))
                        .map_err(|cause| error(cause.to_string()))?;
                    if bytes.len() > 4 * 1024 * 1024 {
                        return Err(error("Compiled merge artifact is too large"));
                    }
                    saved.artifacts.push(SavedArtifact {
                        path,
                        bytes: STANDARD.encode(bytes),
                    });
                }
            }
            saved.report.can_adopt = !saved.artifacts.is_empty()
                && execution.saved.candidate.relation
                    == crate::project::creation::GitMergeRelation::Diverged;
            saved.report.compile_status = Some(
                if report.error.is_some() && matches!(outcome, GitMergeCheckOutcome::Passed) {
                    GitMergeCheckOutcome::Failed
                } else {
                    outcome
                },
            );
            saved.report.compile = Some(report);
        } else if kind == "tests" {
            let task_id = format!("merge-{}-{revision}", candidate_id);
            let options = ControlledCheckOptions::default();
            if !has_node_tests(&execution.root)? {
                let mut report = ControlledCheckReport::not_executed(
                    &task_id,
                    &execution.root,
                    options.mode,
                    "No supported saved Node test entry exists".into(),
                );
                report.node_tests = Some(crate::project::controlled_checks::NodeTestEvidence {
                    entries: vec![],
                    exit_code: None,
                });
                saved.report.tests = Some(report);
            } else {
                let metadata =
                    std::fs::metadata(&execution.root).map_err(|cause| error(cause.to_string()))?;
                let context = ControlledCheckContext {
                    task_id: task_id.clone(),
                    expected_source_identity: Some(format!(
                        "{}:{}",
                        metadata.dev(),
                        metadata.ino()
                    )),
                    app_data_dir: data.clone(),
                    shared_root: shared,
                    node_binary: crate::project::session::node_binary_path().map_err(error)?,
                    scsynth_binary: None,
                    plugins_dir: None,
                    master_synthdef: None,
                    #[cfg(test)]
                    test_audio_device: None,
                    #[cfg(test)]
                    test_sclang: None,
                };
                let lease =
                    crate::project::runtime_gate::RuntimeLease::acquire(&data.join("runtime.lock"))
                        .map_err(|detail| {
                            CreationError::new(CreationErrorCode::RuntimeBusy, detail)
                        })?;
                lease.begin_check(&task_id).map_err(error)?;
                let mut report = crate::project::controlled_checks::run_controlled_node_tests(
                    &execution.root,
                    &options,
                    &context,
                    &completion.0.cancelled,
                    |_| {},
                );
                let confirmed = report.cleanup.node_confirmed && report.cleanup.audio_confirmed;
                report.record_ownership_result(
                    lease.finish_check(confirmed, &report.unresolved_groups),
                );
                saved.report.tests = Some(report);
            }
        }
        if completion.0.cancelled.load(Ordering::Acquire) {
            saved.report.detail =
                Some("Check cancelled; the saved candidate was not changed".into());
        }
        let access = access.lock().map_err(|_| error("Creation lock failed"))?;
        saved.report.fresh = access
            .git_merge_fresh(&identity, &candidate_id, revision, &protection)
            .is_ok()
            && source_inputs_fresh(saved.source_inputs.as_ref());
        saved.report.can_adopt &=
            saved.report.fresh && !completion.0.cancelled.load(Ordering::Acquire);
        if let Some(round) = round_id.as_deref() {
            access.require_git_merge_assistant_owner(
                &identity,
                &candidate_id,
                round,
                &protection,
            )?;
        }
        write_record(&records.join("checks.json"), &saved)?;
        Ok(saved.report)
    })
    .await
}

pub(super) async fn run_merge_assistant_check(
    app: AppHandle,
    access: Arc<Mutex<CreationAccess>>,
    identity: String,
    candidate_id: String,
    revision: u32,
    round_id: String,
    kind: String,
) -> Result<GitMergeChecks, CreationError> {
    run_check(
        app,
        access,
        identity,
        candidate_id,
        revision,
        kind,
        Some(round_id),
    )
    .await
}

pub(super) async fn cancel_merge_assistant_checks(
    app: AppHandle,
    identity: String,
    candidate_id: String,
    round_id: String,
) -> Result<(), CreationError> {
    super::creation::run_blocking(move || {
        cancel_operation(&app, &identity, &candidate_id, Some(&round_id))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn diagnose_merge_candidate(
    app: AppHandle,
    creation: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
) -> Result<GitMergeChecks, CreationError> {
    run_check(
        app,
        creation.access.clone(),
        identity,
        candidate_id,
        revision,
        "diagnose".into(),
        None,
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn compile_merge_candidate(
    app: AppHandle,
    creation: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
) -> Result<GitMergeChecks, CreationError> {
    run_check(
        app,
        creation.access.clone(),
        identity,
        candidate_id,
        revision,
        "compile".into(),
        None,
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn run_merge_candidate_tests(
    app: AppHandle,
    creation: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
) -> Result<GitMergeChecks, CreationError> {
    run_check(
        app,
        creation.access.clone(),
        identity,
        candidate_id,
        revision,
        "tests".into(),
        None,
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn adopt_merge_artifacts(
    app: AppHandle,
    creation: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
) -> Result<GitMergeCandidate, CreationError> {
    let access = creation.access.clone();
    super::creation::run_blocking(move || {
        require_operations(&app, &identity, &candidate_id)?;
        let mut access = access.lock().map_err(|_| error("Creation lock failed"))?;
        let protection = super::creation::protection(&app)?;
        access.git_merge_fresh(&identity, &candidate_id, revision, &protection)?;
        let records = access.git_merge_records_directory(&identity, &candidate_id, &protection)?;
        let saved = read_record::<SavedChecks>(&records.join("checks.json"))?
            .ok_or_else(|| error("Compile this candidate before adopting artifacts"))?;
        if saved.report.candidate_id != candidate_id
            || saved.report.revision != revision
            || !saved.report.can_adopt
            || !source_inputs_fresh(saved.source_inputs.as_ref())
            || saved
                .report
                .compile
                .as_ref()
                .is_none_or(|report| report.error.is_some())
        {
            return Err(error("Compilation receipt is stale or cannot be adopted"));
        }
        let artifacts = saved
            .artifacts
            .into_iter()
            .map(|artifact| {
                Ok(GitMergeArtifact {
                    path: artifact.path,
                    bytes: STANDARD
                        .decode(artifact.bytes)
                        .map_err(|cause| error(cause.to_string()))?,
                })
            })
            .collect::<Result<Vec<_>, CreationError>>()?;
        access.adopt_git_merge_artifacts(&identity, &candidate_id, revision, artifacts, &protection)
    })
    .await
}

async fn stop_candidate_audition(
    app: &AppHandle,
    identity: &str,
    candidate: &str,
) -> Result<(), CreationError> {
    let state = app.state::<MergeRuntimeState>();
    let owner = state
        .audition
        .lock()
        .map_err(|_| error("Merge audio preview lock failed"))?
        .clone();
    if let Some(owner) =
        owner.filter(|owner| owner.identity == identity && owner.candidate_id == candidate)
    {
        super::materials::stop_pending_audio_preview(app.clone(), owner.token.clone())
            .await
            .map_err(|_| error("Merge audio preview cleanup was not confirmed"))?;
        let mut slot = state
            .audition
            .lock()
            .map_err(|_| error("Merge audio preview lock failed"))?;
        if slot
            .as_ref()
            .is_some_and(|current| current.token == owner.token)
        {
            slot.take();
        }
    }
    Ok(())
}

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitMergeAudioPreviewRequest {
    pub identity: String,
    pub candidate_id: String,
    pub revision: u32,
    pub path: String,
    pub side: crate::project::creation::GitMergeSide,
    pub version: String,
    pub preview: String,
    pub device: Option<String>,
    pub position_ms: u32,
    pub gain: f32,
}

#[tauri::command]
#[specta::specta]
pub async fn start_merge_audio_preview(
    app: AppHandle,
    request: GitMergeAudioPreviewRequest,
) -> Result<
    crate::project::audio_preview::AudioPreviewSnapshot,
    crate::project::audio_preview::AudioPreviewError,
> {
    use crate::project::audio_preview::AudioPreviewError;
    let GitMergeAudioPreviewRequest {
        identity,
        candidate_id,
        revision,
        path,
        side,
        version,
        preview,
        device,
        position_ms,
        gain,
    } = request;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (
            app,
            identity,
            candidate_id,
            revision,
            path,
            side,
            version,
            preview,
            device,
            position_ms,
            gain,
        );
        Err(AudioPreviewError::Playback)
    }
    #[cfg(target_os = "macos")]
    {
        if preview.len() != 36
            || !preview
                .bytes()
                .all(|byte| byte == b'-' || byte.is_ascii_hexdigit())
        {
            return Err(AudioPreviewError::Cancelled);
        }
        require_operations(&app, &identity, &candidate_id)
            .map_err(|_| AudioPreviewError::Cancelled)?;
        *app.state::<super::materials::PendingAudioRequest>()
            .0
            .lock()
            .map_err(|_| AudioPreviewError::Playback)? = Some(preview.clone());
        *app.state::<MergeRuntimeState>()
            .audition
            .lock()
            .map_err(|_| AudioPreviewError::Playback)? = Some(MergeAudition {
            identity: identity.clone(),
            candidate_id: candidate_id.clone(),
            token: preview.clone(),
        });
        let handle = app.clone();
        let source_identity = identity.clone();
        let source_candidate = candidate_id.clone();
        let source_path = path.clone();
        let source_version = version.clone();
        let copy = super::creation::run_blocking(move || {
            let creation = handle.state::<super::creation::CreationState>();
            let access = creation
                .access
                .lock()
                .map_err(|_| error("Creation lock failed"))?;
            access.prepare_git_merge_audio(
                &source_identity,
                &source_candidate,
                revision,
                &source_path,
                side,
                &source_version,
                &super::creation::protection(&handle)?,
            )
        })
        .await
        .map_err(|_| AudioPreviewError::SourceUnavailable)?;
        let handle = app.clone();
        let watchdog = preview.clone();
        let result = super::materials::on_audio_thread(&app, move || {
            let pending = handle.state::<super::materials::PendingAudioRequest>();
            let request = pending.0.lock().map_err(|_| AudioPreviewError::Playback)?;
            if request.as_deref() != Some(preview.as_str()) {
                return Err(AudioPreviewError::Cancelled);
            }
            require_operations(&handle, &identity, &candidate_id)
                .map_err(|_| AudioPreviewError::Cancelled)?;
            let creation = handle.state::<super::creation::CreationState>();
            let access = creation
                .access
                .try_lock()
                .map_err(|_| AudioPreviewError::Cancelled)?;
            access
                .validate_git_merge_audio_preview(
                    &identity,
                    &candidate_id,
                    revision,
                    &path,
                    side,
                    &version,
                    &super::creation::protection(&handle)
                        .map_err(|_| AudioPreviewError::Cancelled)?,
                )
                .map_err(|_| AudioPreviewError::Cancelled)?;
            let disconnected = preview.clone();
            let events = handle.clone();
            crate::project::audio_preview::start(
                preview,
                copy,
                device.as_deref(),
                position_ms,
                gain,
                move || super::materials::emit_preview_disconnect(&events, disconnected.clone()),
            )
        })
        .await?;
        tauri::async_runtime::spawn(super::materials::monitor_pending_audio(app, watchdog));
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_transition_cannot_reopen_admission_owned_by_a_newer_transition() {
        let mut transitions = std::collections::BTreeMap::new();
        let key = ("project".into(), "candidate".into());
        transitions.insert(key.clone(), 2);
        release_failed_transition(&mut transitions, "project", "candidate", 1);
        assert_eq!(transitions.get(&key), Some(&2));
        release_failed_transition(&mut transitions, "project", "other", 2);
        assert_eq!(transitions.get(&key), Some(&2));
        release_failed_transition(&mut transitions, "project", "candidate", 2);
        assert!(transitions.is_empty());
    }

    #[test]
    fn candidate_node_tests_ignore_dependency_tests_and_do_not_treat_package_scripts_as_entries() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("node_modules/dependency")).unwrap();
        std::fs::write(
            root.path().join("node_modules/dependency/hidden.test.mjs"),
            "test",
        )
        .unwrap();
        std::fs::write(
            root.path().join("package.json"),
            r#"{"scripts":{"test":"custom shell"}}"#,
        )
        .unwrap();
        assert!(!has_node_tests(root.path()).unwrap());
        std::fs::create_dir(root.path().join("tests")).unwrap();
        std::fs::write(
            root.path().join("tests/score.test.mjs"),
            "actual saved test",
        )
        .unwrap();
        assert!(has_node_tests(root.path()).unwrap());
    }

    #[test]
    fn optional_report_freshness_includes_installed_dependencies() {
        let root = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("manifest.json"), r#"{"id":"score"}"#).unwrap();
        std::fs::create_dir_all(root.path().join("node_modules/local")).unwrap();
        std::fs::write(root.path().join("node_modules/local/index.js"), "v1").unwrap();
        let saved = crate::project::check_evidence::prepare_snapshot(
            root.path(),
            None,
            destination.path(),
            &AtomicBool::new(false),
            |_, _| {},
        )
        .unwrap();
        assert!(source_inputs_fresh(Some(&saved.evidence)));
        std::fs::write(root.path().join("node_modules/local/index.js"), "v2").unwrap();
        assert!(!source_inputs_fresh(Some(&saved.evidence)));
        assert!(!source_inputs_fresh(None));
    }

    #[test]
    fn optional_receipts_reject_symbolic_links_and_oversized_json_before_reading() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.json");
        std::fs::write(&source, "{}").unwrap();
        let linked = root.path().join("checks.json");
        std::os::unix::fs::symlink(&source, &linked).unwrap();
        assert!(read_record::<serde_json::Value>(&linked).is_err());
        let huge = root.path().join("oversized.json");
        std::fs::File::create(&huge)
            .unwrap()
            .set_len(64 * 1024 * 1024 + 1)
            .unwrap();
        assert!(read_record::<serde_json::Value>(&huge).is_err());
    }
}
