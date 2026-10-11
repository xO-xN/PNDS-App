//! Creation commands accept a raw root only at open/preparation/description; subsequent
//! operations use the backend-issued identity and project-relative paths.

use crate::project::creation::{
    CreationAccess, CreationChanges, CreationContent, CreationError, CreationErrorCode,
    CreationFile, CreationProject, CreationWorkspace, Protection,
};
use crate::project::session::{CreationRuntime, SessionManager};
use crate::types::SessionStatus;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct CreationState(Arc<Mutex<CreationAccess>>);

fn protection(app: &AppHandle) -> Result<Protection, CreationError> {
    let bundles = super::bundle::bundles_root(app)
        .map_err(|e| CreationError::new(CreationErrorCode::Io, e))?;
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

async fn run_blocking<T: Send + 'static>(
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
        let state = self.0.clone();
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
        .run(move |access| access.open(Path::new(&path), &protection(&app)?))
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
    identity: String,
) -> Result<(), CreationError> {
    state
        .run(move |access| {
            access.close(&identity);
            Ok(())
        })
        .await
}
