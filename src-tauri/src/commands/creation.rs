//! Creation commands accept a raw root only at open/preparation/description; subsequent
//! operations use the backend-issued identity and project-relative paths.

use crate::project::creation::{
    CreationAccess, CreationChanges, CreationContent, CreationError, CreationErrorCode,
    CreationFile, CreationProject, CreationWorkspace, Protection,
};
use crate::project::session::{CreationRuntime, SessionManager};
use crate::types::SessionStatus;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct CreationState {
    pub(super) access: Arc<Mutex<CreationAccess>>,
    compile_busy: Arc<AtomicBool>,
    handoff_operations: Arc<crate::project::creation::HandoffOperations>,
}

struct CompileGuard(Arc<AtomicBool>);
impl Drop for CompileGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[tauri::command]
#[specta::specta]
pub async fn compile_creation_synthdefs(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<crate::project::creation::SynthdefCompileReport, CreationError> {
    let access = state.access.clone();
    let busy = state.compile_busy.clone();
    run_blocking(move || {
        if busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(CreationError::new(
                CreationErrorCode::TestValidation,
                "SynthDef compilation is already running",
            ));
        }
        let _guard = CompileGuard(busy);
        let lock_error =
            |_| CreationError::new(CreationErrorCode::Io, "Creation workspace lock failed");
        let job = access
            .lock()
            .map_err(lock_error)?
            .prepare_synthdefs(&identity, &protection(&app)?)?;
        let output = job.run(&crate::project::creation::SynthdefCompiler::default());
        let result = access
            .lock()
            .map_err(lock_error)?
            .finish_synthdefs(output, &protection(&app)?);
        result
    })
    .await
}

pub(super) fn protection(app: &AppHandle) -> Result<Protection, CreationError> {
    let bundles = app
        .path()
        .app_data_dir()
        .map_err(|e| CreationError::new(CreationErrorCode::Io, e.to_string()))?
        .join(crate::project::bundle::BUNDLES_DIR);
    let registry = super::tools::builtin_tool_registry()
        .map_err(|e| CreationError::new(CreationErrorCode::Io, e))?;
    let utilities = super::tools::staged_dir_candidates(app)
        .into_iter()
        .flat_map(|root| registry.iter().map(move |tool| root.join(&tool.id)))
        .collect();
    Ok(Protection {
        bundles: vec![bundles],
        utilities,
    })
}

pub(super) async fn run_blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, CreationError> + Send + 'static,
) -> Result<T, CreationError> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|e| CreationError::new(CreationErrorCode::Io, e.to_string()))?
}

impl CreationState {
    async fn run<T: Send + 'static>(
        &self,
        operation: impl FnOnce(&mut CreationAccess) -> Result<T, CreationError> + Send + 'static,
    ) -> Result<T, CreationError> {
        let state = self.access.clone();
        run_blocking(move || {
            let mut access = state.lock().map_err(|_| {
                CreationError::new(CreationErrorCode::Io, "Creation workspace lock failed")
            })?;
            operation(&mut access)
        })
        .await
    }
}

#[tauri::command]
#[specta::specta]
pub async fn get_creation_parameter_contract(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<Option<(crate::project::creation::ParameterContract, String)>, CreationError> {
    state
        .run(move |access| access.parameter_contract(&identity, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn bind_creation_parameters(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    path: String,
    version: String,
    candidate: String,
    parameters: Vec<crate::project::creation::ParameterRequest>,
) -> Result<crate::project::creation::ParameterCandidate, CreationError> {
    state
        .run(move |access| {
            access.bind_parameters(
                &identity,
                &path,
                &version,
                &candidate,
                &parameters,
                &protection(&app)?,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn authorize_creation_preview(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    path: String,
    version: String,
    contract_version: String,
) -> Result<crate::project::creation::PreviewAuthorization, CreationError> {
    state
        .run(move |access| {
            access.authorize_parameter_preview(
                &identity,
                &path,
                &version,
                &contract_version,
                app.state::<SessionManager>().creation_runtime(),
                &protection(&app)?,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn assistant_project_inventory(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<crate::project::creation::AssistantProjectSnapshot, CreationError> {
    state
        .run(move |access| access.assistant_inventory(&identity, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn assistant_project_overview(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<crate::project::creation::AssistantProjectOverview, CreationError> {
    state
        .run(move |access| access.assistant_overview(&identity, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn assistant_project_read(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    read: crate::project::creation::AssistantProjectRead,
) -> Result<crate::project::creation::AssistantProjectPage, CreationError> {
    state
        .run(move |access| access.assistant_read(&identity, &read, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn assistant_project_search(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    paths: Vec<String>,
    query: String,
) -> Result<crate::project::creation::AssistantProjectSearch, CreationError> {
    state
        .run(move |access| access.assistant_search(&identity, &paths, &query, &protection(&app)?))
        .await
}

/// Diagnostics capture and revalidate the issued identity without holding a
/// creation or runtime lock during I/O. Protection lookup performs no writes.
async fn creation_diagnostic(
    app: AppHandle,
    access: Arc<Mutex<CreationAccess>>,
    identity: String,
) -> Result<crate::project::diagnostics::DiagnosticReport, CreationError> {
    run_blocking(move || {
        let protection = protection(&app)?;
        let lock_error =
            |_| CreationError::new(CreationErrorCode::Io, "Creation workspace lock failed");
        let project = access
            .lock()
            .map_err(lock_error)?
            .descriptor(&identity, &protection)?;
        let libraries = crate::project::shared_libraries::shipped_root(&app).ok();
        let report = crate::project::diagnostics::diagnose_project(
            Path::new(&project.root),
            libraries.as_deref(),
        );
        access
            .lock()
            .map_err(lock_error)?
            .descriptor(&identity, &protection)?;
        Ok(report)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn diagnose_creation_project(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<crate::project::diagnostics::DiagnosticReport, CreationError> {
    creation_diagnostic(app, state.access.clone(), identity).await
}

#[tauri::command]
#[specta::specta]
pub async fn creation_diagnostic_is_stale(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    input_fingerprint: String,
) -> Result<bool, CreationError> {
    Ok(creation_diagnostic(app, state.access.clone(), identity)
        .await?
        .input_fingerprint
        != input_fingerprint)
}

#[tauri::command]
#[specta::specta]
pub async fn get_creation_manifest(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<crate::project::manifest::Manifest, CreationError> {
    state
        .run(move |access| access.manifest(&identity, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn preflight_creation_project(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<crate::project::manifest::Manifest, CreationError> {
    state
        .run(move |access| {
            let protection = protection(&app)?;
            let project = access.descriptor(&identity, &protection)?;
            let manifest = super::project::preflight_candidate(
                &app,
                &app.state::<SessionManager>(),
                &project.root,
            )
            .map_err(|detail| CreationError::new(CreationErrorCode::TestValidation, detail))?;
            access.descriptor(&identity, &protection)?;
            Ok(manifest)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn start_creation_project(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    mode: crate::types::AudioMode,
    lan_ip: String,
    osc_target: Option<String>,
) -> Result<CreationRuntime, CreationError> {
    state
        .run(move |access| {
            let project = access.descriptor(&identity, &protection(&app)?)?;
            let data_dir = super::project::app_data_dir(&app)
                .map_err(|detail| CreationError::new(CreationErrorCode::Io, detail))?;
            let manager = app.state::<SessionManager>();
            manager
                .start(
                    app.clone(),
                    data_dir,
                    crate::project::session::StartRequest::new(
                        project.root,
                        mode,
                        lan_ip,
                        osc_target,
                    ),
                )
                .map_err(|detail| CreationError::new(CreationErrorCode::TestStartup, detail))?;
            Ok(manager.creation_runtime())
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn open_creation_project(
    app: AppHandle,
    state: State<'_, CreationState>,
    path: String,
) -> Result<CreationWorkspace, CreationError> {
    state
        .run(move |access| {
            let workspace = access.open(Path::new(&path), &protection(&app)?)?;
            app.state::<super::controlled_checks::ControlledCheckState>()
                .cancel_except(Some(&workspace.project.identity));
            app.state::<crate::model::ModelService<crate::model::KeychainCredentials>>()
                .invalidate_assistant();
            Ok(workspace)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn create_blank_project(
    app: AppHandle,
    state: State<'_, CreationState>,
    options: crate::project::creation::NewProjectOptions,
) -> Result<CreationWorkspace, CreationError> {
    state
        .run(move |access| {
            let resources = crate::project::shared_libraries::shipped_root(&app)
                .map_err(|detail| CreationError::new(CreationErrorCode::TestValidation, detail))?;
            let workspace = access.create_blank(&options, &resources, &protection(&app)?)?;
            app.state::<super::controlled_checks::ControlledCheckState>()
                .cancel_except(Some(&workspace.project.identity));
            Ok(workspace)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn create_classic_project(
    app: AppHandle,
    state: State<'_, CreationState>,
    options: crate::project::creation::NewProjectOptions,
) -> Result<CreationWorkspace, CreationError> {
    state
        .run(move |access| {
            let resources = crate::project::shared_libraries::shipped_root(&app)
                .map_err(|detail| CreationError::new(CreationErrorCode::TestValidation, detail))?;
            let workspace = access.create_classic(&options, &resources, &protection(&app)?)?;
            app.state::<super::controlled_checks::ControlledCheckState>()
                .cancel_except(Some(&workspace.project.identity));
            Ok(workspace)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn prepare_creation_project(
    app: AppHandle,
    state: State<'_, CreationState>,
    path: String,
) -> Result<CreationWorkspace, CreationError> {
    state
        .run(move |access| access.prepare(Path::new(&path), &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_creation_runtime(app: AppHandle) -> Result<CreationRuntime, CreationError> {
    run_blocking(move || Ok(app.state::<SessionManager>().creation_runtime())).await
}

#[tauri::command]
#[specta::specta]
pub async fn close_creation_projection(app: AppHandle) -> Result<(), CreationError> {
    if let Some(window) = app.get_webview_window("projection") {
        window
            .destroy()
            .map_err(|e| CreationError::new(CreationErrorCode::Io, e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn close_creation_performer_windows(
    app: AppHandle,
    labels: Option<Vec<String>>,
) -> Result<(), CreationError> {
    crate::performer::close_windows(&app, labels)
        .map_err(|error| CreationError::new(CreationErrorCode::Io, error))
}

#[tauri::command]
#[specta::specta]
pub async fn set_creation_performer_visibility(
    app: AppHandle,
    label: String,
    visible: bool,
) -> Result<(), CreationError> {
    crate::performer::set_visibility(&app, &label, visible)
        .map_err(|error| CreationError::new(CreationErrorCode::Io, error))
}

#[tauri::command]
#[specta::specta]
pub async fn prepare_performer_window(
    app: AppHandle,
    label: String,
    ok: String,
    cancel: String,
) -> Result<(), CreationError> {
    crate::performer::prepare_window(&app, &label, ok, cancel)
        .await
        .map_err(|error| CreationError::new(CreationErrorCode::Io, error))
}

#[tauri::command]
#[specta::specta]
pub async fn creation_performer_pinned(
    app: AppHandle,
    label: String,
    pinned: Option<bool>,
) -> Result<bool, CreationError> {
    crate::performer::window_pinned(&app, &label, pinned)
        .map_err(|error| CreationError::new(CreationErrorCode::Io, error))
}

#[tauri::command]
#[specta::specta]
pub async fn commit_creation_project(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: Option<String>,
    generation: String,
) -> Result<CreationRuntime, CreationError> {
    state
        .run(move |access| {
            let protection = protection(&app)?;
            let project = identity
                .as_deref()
                .map(|identity| access.prepared_project(identity, &protection))
                .transpose()?;
            app.state::<SessionManager>()
                .with_creation_generation(&generation, |runtime| {
                    if runtime.snapshot.status == SessionStatus::Ready
                        && !project.as_ref().is_some_and(|project| {
                            project.source == crate::project::creation::CreationSource::Folder
                                && Some(&project.root) == runtime.project_root.as_ref()
                        })
                    {
                        return Err(
                            "End the current runtime before changing the creation project".into(),
                        );
                    }
                    if let Some(identity) = &identity {
                        access.activate_prepared(identity).map_err(|e| e.detail)?;
                    }
                    app.state::<super::controlled_checks::ControlledCheckState>()
                        .cancel_except(identity.as_deref());
                    app.state::<crate::model::ModelService<crate::model::KeychainCredentials>>()
                        .invalidate_assistant();
                    Ok(runtime)
                })
                .map_err(|e| CreationError::new(CreationErrorCode::InvalidIdentity, e))
        })
        .await
}

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationOption {
    path: String,
    project: Option<CreationProject>,
    error: Option<CreationError>,
}

#[tauri::command]
#[specta::specta]
pub async fn describe_creation_projects(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<Vec<CreationOption>, CreationError> {
    if paths.len() > 100 {
        return Err(CreationError::new(
            CreationErrorCode::TooLarge,
            "Choose up to 100 recent projects",
        ));
    }
    run_blocking(move || {
        let protection = protection(&app)?;
        Ok(paths
            .into_iter()
            .map(|path| {
                let mut access = CreationAccess::default();
                match access.open(Path::new(&path), &protection) {
                    Ok(workspace) => CreationOption {
                        path,
                        project: Some(workspace.project),
                        error: None,
                    },
                    Err(error) => CreationOption {
                        path,
                        project: None,
                        error: Some(error),
                    },
                }
            })
            .collect())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_creation_libraries(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<crate::project::creation::CreationLibraryCatalog, CreationError> {
    state
        .run(move |access| {
            let resources = crate::project::shared_libraries::shipped_root(&app)
                .map_err(|detail| CreationError::new(CreationErrorCode::TestValidation, detail))?;
            access.library_catalog(&identity, &resources, &protection(&app)?)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn adopt_creation_library(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    adoption: crate::project::creation::CreationLibraryAdoption,
) -> Result<crate::project::creation::CreationLibraryResult, CreationError> {
    state
        .run(move |access| {
            let resources = crate::project::shared_libraries::shipped_root(&app).map_err(|detail| {
                let id = &adoption.id;
                let version = &adoption.version;
                CreationError::new(
                    CreationErrorCode::TestValidation,
                    format!("Required shared libraries [{id} {version}] cannot be verified: {detail}"),
                )
            })?;
            access.adopt_library(&identity, &adoption, &resources, &protection(&app)?)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_creation_modules(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<crate::project::creation::CreationModuleCatalog, CreationError> {
    state
        .run(move |access| access.module_catalog(&identity, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn add_creation_module(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    module_id: String,
    expected_record: Option<String>,
    expected_handoff: Option<String>,
) -> Result<crate::project::creation::CreationModuleAddResult, CreationError> {
    state
        .run(move |access| {
            access.add_module(
                &identity,
                &module_id,
                expected_record.as_deref(),
                expected_handoff.as_deref(),
                &protection(&app)?,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn list_creation_files(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<Vec<CreationFile>, CreationError> {
    state
        .run(move |access| access.list(&identity, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn poll_creation_changes(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    since: u32,
) -> Result<CreationChanges, CreationError> {
    state
        .run(move |access| access.poll(&identity, since, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn read_creation_file(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    path: String,
) -> Result<CreationContent, CreationError> {
    state
        .run(move |access| access.read(&identity, &path, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn create_creation_file(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    path: String,
    draft_paths: Vec<String>,
) -> Result<crate::project::creation::CreationFile, CreationError> {
    state
        .run(move |access| {
            access.create_text_file(&identity, &path, &draft_paths, &protection(&app)?)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn create_creation_directory(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    path: String,
    draft_paths: Vec<String>,
) -> Result<String, CreationError> {
    state
        .run(move |access| {
            access.create_directory(&identity, &path, &draft_paths, &protection(&app)?)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn save_creation_file(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    path: String,
    text: String,
    expected_version: String,
) -> Result<String, CreationError> {
    state
        .run(move |access| {
            access.save(
                &identity,
                &path,
                &text,
                &expected_version,
                &protection(&app)?,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn read_creation_handoff(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<crate::project::handoff::HandoffDocument, CreationError> {
    state
        .run(move |access| access.read_handoff(&identity, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn preview_creation_handoff(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task: crate::project::handoff::HandoffTask,
) -> Result<crate::project::creation::HandoffReview, CreationError> {
    state
        .run(move |access| access.preview_handoff(&identity, task, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn preview_creation_handoff_update(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task: crate::project::handoff::HandoffTask,
    document: crate::project::handoff::HandoffDocument,
) -> Result<crate::project::creation::HandoffReview, CreationError> {
    state
        .run(move |access| {
            access.preview_handoff_update(&identity, task, document, &protection(&app)?)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn confirm_creation_handoff(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    token: String,
    operation_id: String,
) -> Result<crate::project::creation::HandoffReceipt, CreationError> {
    let operation = state.handoff_operations.get(&operation_id)?;
    operation.claim(&identity)?;
    let worker = operation.clone();
    let result = state
        .run(move |access| {
            let data = app
                .path()
                .app_data_dir()
                .map_err(|error| CreationError::new(CreationErrorCode::Io, error.to_string()))?;
            access.record_handoff_baseline_with_operation(
                &data,
                &identity,
                &token,
                &protection(&app)?,
                &worker,
            )
        })
        .await;
    operation.finish();
    result
}

#[tauri::command]
#[specta::specta]
pub async fn append_creation_handoff(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task: crate::project::handoff::HandoffTask,
    expected_version: Option<String>,
) -> Result<crate::project::handoff::HandoffDocument, CreationError> {
    state
        .run(move |access| {
            access.append_handoff(
                &identity,
                &task,
                expected_version.as_deref(),
                &protection(&app)?,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn rename_creation_file(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    path: String,
    next_path: String,
    draft_paths: Vec<String>,
) -> Result<String, CreationError> {
    state
        .run(move |access| {
            access.rename(
                &identity,
                &path,
                &next_path,
                &draft_paths,
                &protection(&app)?,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn drag_creation_file(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, CreationState>,
    identity: String,
    path: String,
) -> Result<(), CreationError> {
    if window.label() != "main" {
        return Err(CreationError::new(
            CreationErrorCode::InvalidIdentity,
            "Only the creation workspace can export files",
        ));
    }
    // Resolve immediately before AppKit starts; keep the issued identity locked
    // through dispatch so a late IPC cannot export another workspace's file.
    let target = state.access.clone();
    let (done, completion) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| {
            let access = target.lock().map_err(|_| {
                CreationError::new(CreationErrorCode::Io, "Creation access lock failed")
            })?;
            let path = access.drag_target(&identity, &path, &protection(&handle)?)?;
            crate::file_drag::start(&window, &path)
                .map_err(|error| CreationError::new(CreationErrorCode::Io, error))
        })();
        let _ = done.send(result);
    })
    .map_err(|error| CreationError::new(CreationErrorCode::Io, error.to_string()))?;
    completion
        .await
        .map_err(|error| CreationError::new(CreationErrorCode::Io, error.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn open_creation_scd(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, CreationState>,
    identity: String,
    path: String,
) -> Result<(), CreationError> {
    if window.label() != "main" {
        return Err(CreationError::new(
            CreationErrorCode::InvalidIdentity,
            "Only the creation workspace can open saved SCD source",
        ));
    }
    let completion = state
        .run(move |access| {
            access.open_scd(
                &identity,
                &path,
                &protection(&app)?,
                crate::supercollider_open::open,
            )
        })
        .await?;
    completion
        .await
        .map_err(|error| CreationError::new(CreationErrorCode::ExternalOpen, error.to_string()))?
}

#[tauri::command]
#[specta::specta]
pub async fn reveal_creation_path(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    path: Option<String>,
) -> Result<(), CreationError> {
    state
        .run(move |access| {
            let target = access.finder_target(&identity, path.as_deref(), &protection(&app)?)?;
            let opened = if path.is_some() {
                app.opener().reveal_item_in_dir(target)
            } else {
                app.opener()
                    .open_path(target.to_string_lossy(), None::<&str>)
            };
            opened.map_err(|e| CreationError::new(CreationErrorCode::Io, e.to_string()))
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn close_creation_project(
    state: State<'_, CreationState>,
    checks: State<'_, super::controlled_checks::ControlledCheckState>,
    model: State<'_, crate::model::ModelService<crate::model::KeychainCredentials>>,
    identity: String,
) -> Result<(), CreationError> {
    let checks = checks.inner().clone();
    let model = model.inner().clone();
    state
        .run(move |access| {
            access.close(&identity);
            checks.cancel_owner(&identity);
            model.cancel_assistant_owner(&identity);
            Ok(())
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn preview_creation_git_record(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<crate::project::creation::GitRecordPreview, CreationError> {
    state
        .run(move |access| access.preview_git_record(&identity, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_creation_git_history(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<crate::project::creation::GitHistory, CreationError> {
    state
        .run(move |access| access.git_history(&identity, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn read_creation_git_history_file(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    commit: String,
    path: String,
) -> Result<crate::project::creation::GitHistoryFile, CreationError> {
    state
        .run(move |access| access.git_history_file(&identity, &commit, &path, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn load_creation_git_history_text(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    commit: String,
    path: String,
    version: String,
) -> Result<crate::project::creation::GitHistoryFile, CreationError> {
    state
        .run(move |access| {
            access.load_git_history_text(&identity, &commit, &path, &version, &protection(&app)?)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn confirm_creation_git_record(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    token: String,
    request: crate::project::creation::GitRecordRequest,
) -> Result<crate::project::creation::GitRecordReceipt, CreationError> {
    state
        .run(move |access| {
            access.confirm_git_record(&identity, &token, request, &protection(&app)?)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_creation_git_status(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<crate::project::creation::CreationGitStatus, CreationError> {
    let access = state.access.clone();
    run_blocking(move || {
        let protection = protection(&app)?;
        let lock_error =
            |_| CreationError::new(CreationErrorCode::Io, "Creation workspace lock failed");
        let job = access
            .lock()
            .map_err(lock_error)?
            .prepare_git_status(&identity, &protection)?;
        let output = job.run(&crate::project::creation::GitReader::default());
        let result = access
            .lock()
            .map_err(lock_error)?
            .finish_git_status(output, &protection);
        result
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn read_creation_git_diff(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    path: String,
    layer: crate::project::creation::GitDiffLayer,
) -> Result<crate::project::creation::CreationGitDiff, CreationError> {
    let access = state.access.clone();
    run_blocking(move || {
        let protection = protection(&app)?;
        let lock_error =
            |_| CreationError::new(CreationErrorCode::Io, "Creation workspace lock failed");
        let job = access.lock().map_err(lock_error)?.prepare_git_diff(
            &identity,
            &path,
            layer,
            &protection,
        )?;
        let output = job.run(&crate::project::creation::GitReader::default());
        let result = access
            .lock()
            .map_err(lock_error)?
            .finish_git_diff(output, &protection);
        result
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn save_creation_file_change(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    path: String,
    text: String,
    expected_version: String,
) -> Result<crate::project::creation::CreationFileChange, CreationError> {
    state
        .run(move |access| {
            access.save_change(
                &identity,
                &path,
                &text,
                &expected_version,
                &protection(&app)?,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn undo_creation_file_change(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    change_id: String,
) -> Result<CreationContent, CreationError> {
    state
        .run(move |access| access.undo_change(&identity, &change_id, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn list_handoff_baselines(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<crate::project::creation::HandoffBaselineCatalog, CreationError> {
    state
        .run(move |access| {
            let data = app
                .path()
                .app_data_dir()
                .map_err(|error| CreationError::new(CreationErrorCode::Io, error.to_string()))?;
            access.list_handoff_baselines(&data, &identity, &protection(&app)?)
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn retry_handoff_baseline(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    id: String,
) -> Result<crate::project::creation::HandoffReceipt, CreationError> {
    state
        .run(move |access| {
            let data = app
                .path()
                .app_data_dir()
                .map_err(|error| CreationError::new(CreationErrorCode::Io, error.to_string()))?;
            access.retry_handoff_baseline(&data, &identity, &id, &protection(&app)?)
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn delete_handoff_baseline(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    id: String,
) -> Result<(), CreationError> {
    state
        .run(move |access| {
            let data = app
                .path()
                .app_data_dir()
                .map_err(|error| CreationError::new(CreationErrorCode::Io, error.to_string()))?;
            access.delete_handoff_baseline(&data, &identity, &id, &protection(&app)?)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn compare_handoff_baseline(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    id: String,
    operation_id: String,
) -> Result<crate::project::creation::HandoffComparison, CreationError> {
    let operation = state.handoff_operations.get(&operation_id)?;
    operation.claim(&identity)?;
    let worker = operation.clone();
    let result = state
        .run(move |access| {
            let data = app
                .path()
                .app_data_dir()
                .map_err(|error| CreationError::new(CreationErrorCode::Io, error.to_string()))?;
            access.compare_handoff_baseline_with_operation(
                &data,
                &identity,
                &id,
                &protection(&app)?,
                &worker,
            )
        })
        .await;
    operation.finish();
    result
}
#[tauri::command]
#[specta::specta]
pub async fn handoff_comparison_is_stale(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    fingerprint: String,
) -> Result<bool, CreationError> {
    state
        .run(move |access| {
            access.handoff_comparison_is_stale(&identity, &fingerprint, &protection(&app)?)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn begin_handoff_operation(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<String, CreationError> {
    let operations = state.handoff_operations.clone();
    state
        .run(move |access| {
            access.descriptor(&identity, &protection(&app)?)?;
            operations.begin(&identity)
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub fn handoff_operation_progress(
    state: State<'_, CreationState>,
    operation_id: String,
) -> Result<crate::project::creation::HandoffOperationProgress, CreationError> {
    state.handoff_operations.get(&operation_id)?.progress()
}
#[tauri::command]
#[specta::specta]
pub fn cancel_handoff_operation(
    state: State<'_, CreationState>,
    operation_id: String,
) -> Result<crate::project::creation::HandoffOperationProgress, CreationError> {
    state.handoff_operations.get(&operation_id)?.cancel()
}

pub(super) fn assistant_task_data(app: &AppHandle) -> Result<std::path::PathBuf, CreationError> {
    app.path()
        .app_data_dir()
        .map_err(|cause| CreationError::new(CreationErrorCode::Io, cause.to_string()))
}

#[tauri::command]
#[specta::specta]
pub async fn begin_creation_assistant_task(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    mode: crate::project::creation::AssistantMode,
    resume: Option<String>,
    scope: Option<crate::project::creation::AssistantQuestionScope>,
) -> Result<crate::project::creation::AssistantTask, CreationError> {
    state
        .run(move |access| {
            access.begin_scoped_assistant_task(
                &identity,
                mode,
                resume.as_deref(),
                scope.as_ref(),
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn save_creation_assistant_resume(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    record: crate::project::creation::AssistantTaskResume,
) -> Result<(), CreationError> {
    state
        .run(move |access| {
            access.save_assistant_resume(
                &identity,
                record,
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn load_creation_assistant_resume(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<Option<crate::project::creation::AssistantTaskResumeRecovery>, CreationError> {
    state
        .run(move |access| {
            access.load_assistant_resume(&identity, &assistant_task_data(&app)?, &protection(&app)?)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn clear_creation_assistant_resume(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task_id: Option<String>,
) -> Result<(), CreationError> {
    state
        .run(move |access| {
            access.clear_assistant_resume(
                &identity,
                task_id.as_deref(),
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn write_creation_assistant_file(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task_id: String,
    write: crate::project::creation::AssistantWrite,
) -> Result<crate::project::creation::AssistantTask, CreationError> {
    state
        .run(move |access| {
            access.write_assistant_file(
                &identity,
                &task_id,
                &write,
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn adopt_creation_assistant_library(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task_id: String,
    library: String,
) -> Result<crate::project::creation::AssistantTask, CreationError> {
    state
        .run(move |access| {
            let resources = crate::project::shared_libraries::shipped_root(&app)
                .map_err(|cause| CreationError::new(CreationErrorCode::TestValidation, cause))?;
            access.adopt_assistant_library(
                &identity,
                &task_id,
                &library,
                &assistant_task_data(&app)?,
                &resources,
                &protection(&app)?,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn adopt_creation_assistant_material(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task_id: String,
    adoption: crate::project::creation::AssistantMaterialAdoption,
) -> Result<crate::project::creation::AssistantTask, CreationError> {
    state
        .run(move |access| {
            access.adopt_assistant_material(
                &identity,
                &task_id,
                &adoption,
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn create_creation_assistant_directory(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task_id: String,
    path: String,
) -> Result<crate::project::creation::AssistantTask, CreationError> {
    state
        .run(move |access| {
            access.create_assistant_directory(
                &identity,
                &task_id,
                &path,
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn remove_creation_assistant_file(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task_id: String,
    path: String,
    version: String,
) -> Result<crate::project::creation::AssistantTask, CreationError> {
    state
        .run(move |access| {
            access.remove_assistant_file(
                &identity,
                &task_id,
                &path,
                &version,
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn install_creation_assistant_preview(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task_id: String,
) -> Result<crate::project::creation::AssistantTask, CreationError> {
    state
        .run(move |access| {
            access.install_assistant_preview_adapter(
                &identity,
                &task_id,
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn end_creation_assistant_task(
    state: State<'_, CreationState>,
    identity: String,
    task_id: String,
) -> Result<(), CreationError> {
    state
        .run(move |access| {
            access.end_assistant_task(&identity, &task_id);
            Ok(())
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn list_creation_assistant_tasks(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<Vec<crate::project::creation::AssistantTask>, CreationError> {
    state
        .run(move |access| {
            access.assistant_tasks(&identity, &assistant_task_data(&app)?, &protection(&app)?)
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn undo_creation_assistant_task(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task_id: String,
    path: Option<String>,
) -> Result<crate::project::creation::AssistantTask, CreationError> {
    state
        .run(move |access| {
            access.undo_assistant_task(
                &identity,
                &task_id,
                path.as_deref(),
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn preview_creation_git_restore(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    commit: String,
) -> Result<crate::project::creation::GitRestorePreview, CreationError> {
    state
        .run(move |access| access.preview_git_restore(&identity, &commit, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn confirm_creation_git_restore(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    token: String,
) -> Result<(), CreationError> {
    state
        .run(move |access| {
            let path = crate::project::runtime_gate::default_gate_path()
                .map_err(|error| CreationError::new(CreationErrorCode::Io, error))?;
            let _lease = crate::project::runtime_gate::RuntimeLease::acquire(&path)
                .map_err(|error| CreationError::new(CreationErrorCode::TestValidation, error))?;
            access.confirm_git_restore(&identity, &token, &protection(&app)?)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_creation_git_versions(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    offset: u32,
) -> Result<crate::project::creation::GitVersionGraph, CreationError> {
    state
        .run(move |access| access.git_version_graph(&identity, offset, &protection(&app)?))
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn rename_creation_git_version(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    commit: String,
    expected_name: String,
    name: String,
) -> Result<String, CreationError> {
    state
        .run(move |access| {
            access.rename_git_version(
                &identity,
                &commit,
                &expected_name,
                &name,
                &protection(&app)?,
            )
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn get_creation_git_version_paths(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    commit: String,
) -> Result<Vec<String>, CreationError> {
    state
        .run(move |access| access.git_version_paths(&identity, &commit, &protection(&app)?))
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn confirm_creation_git_version(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    token: String,
    request: crate::project::creation::GitRecordRequest,
    branch_name: Option<String>,
) -> Result<crate::project::creation::GitRecordReceipt, CreationError> {
    state
        .run(move |access| {
            access.confirm_git_record_named(
                &identity,
                &token,
                request,
                branch_name.as_deref(),
                &protection(&app)?,
            )
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn end_creation_git_assistant_task(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<(), CreationError> {
    state
        .run(move |access| {
            access.end_git_assistant_task(
                &identity,
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn preview_creation_git_switch(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    commit: String,
    discard: bool,
) -> Result<crate::project::creation::GitSwitchPreview, CreationError> {
    state
        .run(move |access| {
            access.preview_git_switch(
                &identity,
                &commit,
                discard,
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn preview_creation_git_branch_switch(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    branch: String,
    commit: String,
    discard: bool,
) -> Result<crate::project::creation::GitSwitchPreview, CreationError> {
    state
        .run(move |access| {
            access.preview_git_branch_switch(
                &identity,
                (&branch, &commit),
                discard,
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn confirm_creation_git_switch(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    token: String,
) -> Result<(), CreationError> {
    state
        .run(move |access| {
            let path = crate::project::runtime_gate::default_gate_path()
                .map_err(|e| CreationError::new(CreationErrorCode::Io, e))?;
            let _lease = crate::project::runtime_gate::RuntimeLease::acquire(&path)
                .map_err(|e| CreationError::new(CreationErrorCode::TestValidation, e))?;
            access.confirm_git_switch(
                &identity,
                &token,
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn read_creation_git_version_file(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    commit: String,
    path: String,
) -> Result<crate::project::creation::GitHistoryFile, CreationError> {
    state
        .run(move |access| access.git_version_file(&identity, &commit, &path, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_creation_git_task_pending(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<bool, CreationError> {
    state
        .run(move |access| {
            access.git_task_pending(&identity, &assistant_task_data(&app)?, &protection(&app)?)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_creation_git_comparison(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    request: crate::project::creation::GitComparisonRequest,
) -> Result<crate::project::creation::GitComparison, CreationError> {
    state
        .run(move |access| access.git_comparison(&identity, request, &protection(&app)?))
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn read_creation_git_comparison_file(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    request: crate::project::creation::GitComparisonFileRequest,
) -> Result<crate::project::creation::GitComparisonDiff, CreationError> {
    state
        .run(move |access| access.git_comparison_file(&identity, &request, &protection(&app)?))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn propose_creation_assistant_resources(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task_id: String,
    request: crate::project::creation::AssistantResourceRequest,
) -> Result<crate::project::creation::AssistantTask, CreationError> {
    state
        .run(move |access| {
            let resources = crate::project::shared_libraries::shipped_root(&app)
                .map_err(|cause| CreationError::new(CreationErrorCode::TestValidation, cause))?;
            access.propose_assistant_resources(
                &identity,
                &task_id,
                &request,
                &assistant_task_data(&app)?,
                &resources,
                &protection(&app)?,
            )
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn get_creation_assistant_resource_plans(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task_id: String,
) -> Result<Vec<crate::project::creation::AssistantResourcePlan>, CreationError> {
    state
        .run(move |access| {
            access.assistant_resource_plans(
                &identity,
                &task_id,
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn decide_creation_assistant_resources(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task_id: String,
    plan_id: String,
    decision: crate::project::creation::AssistantResourceDecision,
) -> Result<crate::project::creation::AssistantResourcePlan, CreationError> {
    state
        .run(move |access| {
            access.decide_assistant_resources(
                &identity,
                &task_id,
                &plan_id,
                decision,
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn adopt_creation_assistant_module(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task_id: String,
    module: String,
) -> Result<crate::project::creation::AssistantTask, CreationError> {
    state
        .run(move |access| {
            access.adopt_assistant_module(
                &identity,
                &task_id,
                &module,
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn ask_creation_assistant_question(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task_id: String,
    scope: crate::project::creation::AssistantQuestionScope,
    request: crate::project::creation::AssistantQuestionRequest,
) -> Result<crate::project::creation::AssistantTask, CreationError> {
    state
        .run(move |access| {
            access.ask_assistant_question(
                &identity,
                &task_id,
                &scope,
                &request,
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn get_creation_assistant_questions(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task_id: String,
) -> Result<Vec<crate::project::creation::AssistantQuestion>, CreationError> {
    state
        .run(move |access| {
            access.assistant_questions(
                &identity,
                &task_id,
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn answer_creation_assistant_question(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task_id: String,
    question_id: String,
    scope: crate::project::creation::AssistantQuestionScope,
    answer: crate::project::creation::AssistantQuestionAnswer,
) -> Result<crate::project::creation::AssistantQuestion, CreationError> {
    state
        .run(move |access| {
            access.answer_assistant_question(
                &identity,
                &task_id,
                crate::project::creation::AssistantQuestionSubmission {
                    question_id: &question_id,
                    scope: &scope,
                    answer: &answer,
                },
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn cancel_creation_assistant_question(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    task_id: String,
    question_id: String,
    scope: crate::project::creation::AssistantQuestionScope,
) -> Result<crate::project::creation::AssistantQuestion, CreationError> {
    state
        .run(move |access| {
            access.cancel_assistant_question(
                &identity,
                &task_id,
                &question_id,
                &scope,
                &assistant_task_data(&app)?,
                &protection(&app)?,
            )
        })
        .await
}
