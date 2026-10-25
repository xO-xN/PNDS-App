//! Each operation holds the current creation capability through private publication.
use crate::project::creation::{
    CreationAccess, CreationMaterial, CreationMaterialPage, CreationMaterialRead, MaterialError,
    Protection,
};
use std::path::Path;
use tauri::{AppHandle, Manager};

async fn with_materials<T: Send + 'static>(
    app: AppHandle,
    identity: String,
    operation: impl FnOnce(&CreationAccess, &Path, &str, &Protection) -> Result<T, MaterialError>
        + Send
        + 'static,
) -> Result<T, MaterialError> {
    tauri::async_runtime::spawn_blocking(move || {
        let protection =
            super::creation::protection(&app).map_err(|_| MaterialError::InvalidIdentity)?;
        let creation = app.state::<super::creation::CreationState>();
        let access = creation.access.lock().map_err(|_| MaterialError::Storage)?;
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|_| MaterialError::Storage)?;
        operation(&access, &app_data, &identity, &protection)
    })
    .await
    .map_err(|_| MaterialError::Storage)?
}

#[tauri::command]
#[specta::specta]
pub async fn list_creation_materials(
    app: AppHandle,
    identity: String,
) -> Result<Vec<CreationMaterial>, MaterialError> {
    with_materials(app, identity, |access, data, identity, protection| {
        access.list_materials(data, identity, protection)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn add_creation_material(
    app: AppHandle,
    identity: String,
    path: String,
) -> Result<CreationMaterial, MaterialError> {
    with_materials(app, identity, move |access, data, identity, protection| {
        access.add_material(data, identity, Path::new(&path), protection)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn read_creation_material(
    app: AppHandle,
    identity: String,
    read: CreationMaterialRead,
) -> Result<CreationMaterialPage, MaterialError> {
    with_materials(app, identity, move |access, data, identity, protection| {
        access.read_material(data, identity, &read, protection)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn remove_creation_material(
    app: AppHandle,
    identity: String,
    id: String,
) -> Result<(), MaterialError> {
    with_materials(app, identity, move |access, data, identity, protection| {
        access.remove_material(data, identity, &id, protection)
    })
    .await
}
