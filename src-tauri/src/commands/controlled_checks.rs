//! Desktop adapter for the independent saved-copy workflow.
use crate::project::controlled_checks::{
    load_report_receipt, persist_report_receipt, run_controlled_check_observed,
    run_controlled_node_tests, ControlledCheckContext, ControlledCheckOptions,
    ControlledCheckProgress, ControlledCheckReport,
};
use crate::project::creation::{CreationError, CreationErrorCode};
use crate::project::runtime_gate::RuntimeLease;
use serde::Serialize;
use specta::Type;
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationCheckTask {
    pub task_id: String,
    pub identity: String,
    pub progress: Option<ControlledCheckProgress>,
    pub report: Option<ControlledCheckReport>,
}

type Completion = Arc<(Mutex<bool>, Condvar)>;
struct Task {
    snapshot: CreationCheckTask,
    cancel: Arc<AtomicBool>,
    completion: Completion,
}

#[derive(Default, Clone)]
pub struct ControlledCheckState(Arc<Mutex<Option<Task>>>);

fn error(detail: impl Into<String>) -> CreationError {
    CreationError::new(CreationErrorCode::TestValidation, detail)
}

/// Observe only the ready session owned by this creation workspace. Never
/// launch an extra runtime or create a browser client in a live performance.
#[tauri::command]
#[specta::specta]
pub async fn inspect_creation_runtime(
    app: AppHandle,
    creation: State<'_, super::creation::CreationState>,
    identity: String,
    pages: bool,
) -> Result<crate::project::live_checks::LiveRuntimeReport, CreationError> {
    let access = creation.access.clone();
    super::creation::run_blocking(move || {
        let protection = super::creation::protection(&app)?;
        let project = access
            .lock()
            .map_err(|_| error("Creation lock failed"))?
            .descriptor(&identity, &protection)?;
        let manager = app.state::<crate::project::session::SessionManager>();
        let before = manager.creation_runtime();
        if before.project_root.as_deref() != Some(project.root.as_str())
            || before.snapshot.status != crate::types::SessionStatus::Ready
        {
            return Err(error("No ready runtime belongs to this creation workspace"));
        }
        let report = crate::project::live_checks::observe(&before, pages);
        access
            .lock()
            .map_err(|_| error("Creation lock failed"))?
            .descriptor(&identity, &protection)?;
        if !crate::project::live_checks::same_runtime(&before, &manager.creation_runtime()) {
            return Err(error(
                "Runtime changed during observation; discard this observation",
            ));
        }
        Ok(report)
    })
    .await
}

impl ControlledCheckState {
    pub fn cancel_except(&self, identity: Option<&str>) {
        if let Ok(task) = self.0.lock() {
            if let Some(task) = task
                .as_ref()
                .filter(|task| Some(task.snapshot.identity.as_str()) != identity)
            {
                task.cancel.store(true, Ordering::Release);
            }
        }
    }

    pub fn cancel_owner(&self, identity: &str) {
        if let Ok(task) = self.0.lock() {
            if let Some(task) = task
                .as_ref()
                .filter(|task| task.snapshot.identity == identity)
            {
                task.cancel.store(true, Ordering::Release);
            }
        }
    }

    /// Actual application exit waits for the owned worker's bounded cleanup.
    pub fn shutdown(&self) {
        let completion = self.0.lock().ok().and_then(|task| {
            task.as_ref().map(|task| {
                task.cancel.store(true, Ordering::Release);
                task.completion.clone()
            })
        });
        if let Some(completion) = completion {
            let (finished, signal) = &*completion;
            if let Ok(finished) = finished.lock() {
                match signal.wait_timeout_while(
                    finished,
                    std::time::Duration::from_secs(25),
                    |finished| !*finished,
                ) {
                    Ok((finished, _)) if *finished => {}
                    _ => log::warn!(
                        "Controlled-check cleanup was not confirmed before application exit"
                    ),
                }
            }
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn start_creation_check(
    app: AppHandle,
    creation: State<'_, super::creation::CreationState>,
    checks: State<'_, ControlledCheckState>,
    identity: String,
    options: ControlledCheckOptions,
) -> Result<String, CreationError> {
    start_check(app, creation, checks, identity, options, None, false).await
}

async fn start_check(
    app: AppHandle,
    creation: State<'_, super::creation::CreationState>,
    checks: State<'_, ControlledCheckState>,
    identity: String,
    options: ControlledCheckOptions,
    assistant_task: Option<String>,
    node_tests: bool,
) -> Result<String, CreationError> {
    let access = creation.access.clone();
    let checks = checks.inner().clone();
    super::creation::run_blocking(move || {
        let protection = super::creation::protection(&app)?;
        // Keep identity capture and task registration in one creation transaction,
        // so closing a workspace cannot miss a not-yet-registered cancellation.
        let mut access = access
            .lock()
            .map_err(|_| error("Creation workspace lock failed"))?;
        let project = access.descriptor(&identity, &protection)?;
        if let Some(task_id) = &assistant_task {
            access.authorize_assistant_check(&identity, task_id, &super::creation::assistant_task_data(&app)?, &protection)?;
        }
        let (images, audio) = match assistant_task.as_deref().filter(|_| !node_tests) {
            Some(task_id) => {
                let task_data = super::creation::assistant_task_data(&app)?;
                (
                    access.pending_image_check_inputs(&identity, task_id, &task_data, &protection)?,
                    access.pending_audio_check_inputs(&identity, task_id, &task_data, &protection)?,
                )
            }
            None => (vec![], vec![]),
        };
        let (samples, page_audio): (Vec<_>, Vec<_>) = audio.into_iter()
            .partition(|(path, _)| crate::project::controlled_checks::is_supercollider_sample(path));
        let task_id = format!(
            "app-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|cause| error(cause.to_string()))?.as_nanos()
        );
        if node_tests && !access.has_node_test_entries(&identity, &protection)? {
            let mut report = ControlledCheckReport::not_executed(&task_id, Path::new(&project.root), options.mode, "No supported Node test entry (*.test.js, *.test.mjs, *.test.cjs) exists in the saved project".into());
            report.node_tests = Some(crate::project::controlled_checks::NodeTestEvidence { entries: vec![], exit_code: None });
            let mut task = checks.0.lock().map_err(|_| error("Controlled-check lock failed"))?;
            if task.as_ref().is_some_and(|task| task.snapshot.report.is_none()) { return Err(error("A controlled check is active or cleanup is unconfirmed")); }
            *task = Some(Task {
                snapshot: CreationCheckTask { task_id: task_id.clone(), identity, progress: None, report: Some(report) },
                cancel: Arc::new(AtomicBool::new(false)),
                completion: Arc::new((Mutex::new(true), Condvar::new())),
            });
            return Ok(task_id);
        }
        let source =
            std::fs::symlink_metadata(&project.root).map_err(|cause| error(cause.to_string()))?;
        let expected_source_identity = Some(format!("{}:{}", source.dev(), source.ino()));
        access.descriptor(&identity, &protection)?;
        let data = super::project::app_data_dir(&app).map_err(error)?;
        let lease = RuntimeLease::acquire(&data.join("runtime.lock")).map_err(|cause| {
            if cause == crate::project::runtime_gate::RUNTIME_BUSY {
                CreationError::new(CreationErrorCode::RuntimeBusy, cause)
            } else {
                error(cause)
            }
        })?;
        if app
            .state::<crate::project::session::SessionManager>()
            .has_active_session()
        {
            return Err(CreationError::new(
                CreationErrorCode::RuntimeBusy,
                "A PNDS performance is active; wait for it to finish",
            ));
        }
        let context = ControlledCheckContext {
            task_id: task_id.clone(),
            expected_source_identity,
            app_data_dir: data.join("controlled-checks"),
            shared_root: crate::project::shared_libraries::shipped_root(&app).ok(),
            node_binary: crate::project::session::node_binary_path()
                .unwrap_or_else(|_| data.join("missing-node")),
            scsynth_binary: crate::project::audio::scsynth_binary_path().ok(),
            plugins_dir: crate::project::audio::plugins_dir().ok(),
            master_synthdef: crate::project::audio::master_synthdef_path().ok(),
            #[cfg(test)]
            test_audio_device: None,
            #[cfg(test)]
            test_sclang: None,
        };
        let operation = if node_tests {
            Some(access.begin_assistant_operation(&identity, assistant_task.as_deref().ok_or_else(|| error("Project tests require an assistant task"))?)?)
        } else { None };
        let cancel = operation.as_ref().map(|operation| operation.cancelled.clone()).unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
        let completion = Arc::new((Mutex::new(false), Condvar::new()));
        {
            let mut task = checks
                .0
                .lock()
                .map_err(|_| error("Controlled-check lock failed"))?;
            if task
                .as_ref()
                .is_some_and(|task| task.snapshot.report.is_none())
            {
                return Err(error(
                    "A controlled check is active or cleanup is unconfirmed",
                ));
            }
            // Do not leave an unfinished runtime journal when operation/task
            // registration refuses before a worker can own cleanup.
            lease.begin_check(&task_id).map_err(error)?;
            *task = Some(Task {
                snapshot: CreationCheckTask {
                    task_id: task_id.clone(),
                    identity,
                    progress: None,
                    report: None,
                },
                cancel: cancel.clone(),
                completion: completion.clone(),
            });
        }
        drop(access);
        let returned_id = task_id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _operation = operation;
            let progress = |progress| {
                if let Ok(mut task) = checks.0.lock() {
                    if let Some(task) = task.as_mut().filter(|task| task.snapshot.task_id == task_id) {
                        task.snapshot.progress = Some(progress);
                    }
                }
            };
            let mut report = if node_tests {
                run_controlled_node_tests(Path::new(&project.root), &options, &context, &cancel, progress)
            } else { run_controlled_check_observed(
                Path::new(&project.root),
                &options,
                &context,
                &cancel,
                progress,
                |manifest, snapshot, report| {
                    if report.status != crate::project::controlled_checks::ControlledCheckStatus::Passed {
                        return Ok(());
                    }
                    super::check_browser::inspect(&app, manifest, &cancel, &images, &page_audio, report)?;
                    crate::project::controlled_checks::sample_probe::inspect(snapshot, &samples, &context, &cancel, report)
                },
            ) };
            let confirmed = report.cleanup.node_confirmed && report.cleanup.audio_confirmed;
            report
                .record_ownership_result(lease.finish_check(confirmed, &report.unresolved_groups));
            if persist_report_receipt(&data, &report).is_err() {
                log::warn!("Completed check has no durable input receipt; restart will recheck");
            }
            if let Ok(mut task) = checks.0.lock() {
                if let Some(task) = task
                    .as_mut()
                    .filter(|task| task.snapshot.task_id == task_id)
                {
                    task.snapshot.report = Some(report);
                }
            }
            let (finished, signal) = &*completion;
            if let Ok(mut finished) = finished.lock() {
                *finished = true;
                signal.notify_all();
            }
        });
        Ok(returned_id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_creation_check(
    app: AppHandle,
    creation: State<'_, super::creation::CreationState>,
    checks: State<'_, ControlledCheckState>,
    identity: String,
    task_id: String,
) -> Result<CreationCheckTask, CreationError> {
    let access = creation.access.clone();
    let checks = checks.inner().clone();
    super::creation::run_blocking(move || {
        let protection = super::creation::protection(&app)?;
        let access = access
            .lock()
            .map_err(|_| error("Creation workspace lock failed"))?;
        access.descriptor(&identity, &protection)?;
        let task = checks
            .0
            .lock()
            .map_err(|_| error("Controlled-check lock failed"))?;
        task.as_ref()
            .filter(|task| task.snapshot.task_id == task_id && task.snapshot.identity == identity)
            .map(|task| task.snapshot.clone())
            .ok_or_else(|| error("The controlled check belongs to another workspace or task"))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub fn cancel_creation_check(
    checks: State<'_, ControlledCheckState>,
    task_id: String,
) -> Result<(), CreationError> {
    let task = checks
        .0
        .lock()
        .map_err(|_| error("Controlled-check lock failed"))?;
    if let Some(task) = task
        .as_ref()
        .filter(|task| task.snapshot.task_id == task_id)
    {
        task.cancel.store(true, Ordering::Release);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn creation_check_is_stale(
    app: AppHandle,
    creation: State<'_, super::creation::CreationState>,
    checks: State<'_, ControlledCheckState>,
    identity: String,
    task_id: String,
) -> Result<bool, CreationError> {
    let access = creation.access.clone();
    let checks = checks.inner().clone();
    super::creation::run_blocking(move || {
        let protection = super::creation::protection(&app)?;
        let project = access
            .lock()
            .map_err(|_| error("Creation workspace lock failed"))?
            .descriptor(&identity, &protection)?;
        let evidence = checks
            .0
            .lock()
            .map_err(|_| error("Controlled-check lock failed"))?
            .as_ref()
            .filter(|task| task.snapshot.task_id == task_id && task.snapshot.identity == identity)
            .and_then(|task| task.snapshot.report.as_ref())
            .and_then(|report| report.evidence.clone());
        let evidence = match evidence {
            Some(evidence) => evidence,
            None => load_report_receipt(
                &super::project::app_data_dir(&app).map_err(error)?,
                Path::new(&project.root),
                &task_id,
            )
            .map_err(error)?
            .evidence
            .ok_or_else(|| error("No input evidence exists for this task"))?,
        };
        let shared = crate::project::shared_libraries::shipped_root(&app).ok();
        let freshness = crate::project::check_evidence::source_freshness(
            Path::new(&project.root),
            shared.as_deref(),
            &evidence,
            &AtomicBool::new(false),
        );
        access
            .lock()
            .map_err(|_| error("Creation workspace lock failed"))?
            .descriptor(&identity, &protection)?;
        Ok(freshness.stale || !freshness.complete)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn start_assistant_check(
    app: AppHandle,
    creation: State<'_, super::creation::CreationState>,
    checks: State<'_, ControlledCheckState>,
    identity: String,
    task_id: String,
) -> Result<String, CreationError> {
    start_check(
        app,
        creation,
        checks,
        identity,
        ControlledCheckOptions::default(),
        Some(task_id),
        false,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn start_assistant_tests(
    app: AppHandle,
    creation: State<'_, super::creation::CreationState>,
    checks: State<'_, ControlledCheckState>,
    identity: String,
    task_id: String,
) -> Result<String, CreationError> {
    start_check(
        app,
        creation,
        checks,
        identity,
        ControlledCheckOptions::default(),
        Some(task_id),
        true,
    )
    .await
}
