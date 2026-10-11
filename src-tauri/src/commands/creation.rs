//! Creation commands accept a raw root only at open/description; subsequent
//! operations use the backend-issued identity and project-relative paths.

use crate::project::creation::{
    CreationAccess, CreationContent, CreationError, CreationErrorCode, CreationFile,
    CreationProject, CreationWorkspace, Protection,
};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};
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
pub async fn open_creation_project(
    app: AppHandle,
    state: State<'_, CreationState>,
    path: String,
) -> Result<CreationWorkspace, CreationError> {
    state
        .run(move |access| access.open(Path::new(&path), &protection(&app)?))
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
