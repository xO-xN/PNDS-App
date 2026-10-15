//! Desktop adapter for the independent saved-copy workflow.
use crate::project::controlled_checks::{
    run_controlled_check, ControlledCheckContext, ControlledCheckOptions, ControlledCheckProgress,
    ControlledCheckReport,
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
    let access = creation.access.clone();
    let checks = checks.inner().clone();
    super::creation::run_blocking(move || {
        let protection = super::creation::protection(&app)?;
        // Keep identity capture and task registration in one creation transaction,
        // so closing a workspace cannot miss a not-yet-registered cancellation.
        let access = access
            .lock()
            .map_err(|_| error("Creation workspace lock failed"))?;
        let project = access.descriptor(&identity, &protection)?;
        let source =
            std::fs::symlink_metadata(&project.root).map_err(|cause| error(cause.to_string()))?;
        let expected_source_identity = Some(format!("{}:{}", source.dev(), source.ino()));
        access.descriptor(&identity, &protection)?;
        let data = super::project::app_data_dir(&app).map_err(error)?;
        let lease = RuntimeLease::acquire(&data.join("runtime.lock")).map_err(error)?;
        if app
            .state::<crate::project::session::SessionManager>()
            .has_active_session()
        {
            return Err(error("A PNDS performance is active; wait for it to finish"));
        }
        let task_id = format!(
            "app-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|cause| error(cause.to_string()))?
                .as_nanos()
        );
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
        lease.begin_check(&task_id).map_err(error)?;
        let cancel = Arc::new(AtomicBool::new(false));
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
            let mut report = run_controlled_check(
                Path::new(&project.root),
                &options,
                &context,
                &cancel,
                |progress| {
                    if let Ok(mut task) = checks.0.lock() {
                        if let Some(task) = task
                            .as_mut()
                            .filter(|task| task.snapshot.task_id == task_id)
                        {
                            task.snapshot.progress = Some(progress);
                        }
                    }
                },
            );
            let confirmed = report.cleanup.node_confirmed && report.cleanup.audio_confirmed;
            report
                .record_ownership_result(lease.finish_check(confirmed, &report.unresolved_groups));
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
            .and_then(|report| report.evidence.clone())
            .ok_or_else(|| error("No input evidence exists for this task"))?;
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
