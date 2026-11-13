//! Each operation holds the current creation capability through private publication.
use crate::project::creation::{
    CreationAccess, CreationMaterial, CreationMaterialPage, CreationMaterialRead,
    CreationPendingDocument, CreationPendingDocumentSave, MaterialError, Protection,
};
use std::path::Path;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

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

#[tauri::command]
#[specta::specta]
pub async fn save_creation_pending_document(
    app: AppHandle,
    identity: String,
    document: CreationPendingDocumentSave,
) -> Result<CreationMaterial, MaterialError> {
    with_materials(app, identity, move |access, data, identity, protection| {
        access.save_pending_document(data, identity, &document, protection)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn read_creation_pending_document(
    app: AppHandle,
    identity: String,
    id: String,
    version: String,
) -> Result<CreationPendingDocument, MaterialError> {
    with_materials(app, identity, move |access, data, identity, protection| {
        access.read_pending_document(data, identity, &id, &version, protection)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn rename_creation_pending_document(
    app: AppHandle,
    identity: String,
    id: String,
    version: String,
    name: String,
) -> Result<CreationMaterial, MaterialError> {
    with_materials(app, identity, move |access, data, identity, protection| {
        access.rename_pending_document(data, identity, &id, &version, &name, protection)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_creation_pending_document(
    app: AppHandle,
    identity: String,
    id: String,
    version: String,
) -> Result<(), MaterialError> {
    with_materials(app, identity, move |access, data, identity, protection| {
        access.delete_pending_document(data, identity, &id, &version, protection)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn reveal_creation_pending_document(
    app: AppHandle,
    identity: String,
    id: String,
    version: String,
) -> Result<(), MaterialError> {
    let opener = app.clone();
    with_materials(app, identity, move |access, data, identity, protection| {
        let path = access.pending_document_path(data, identity, &id, &version, protection)?;
        opener
            .opener()
            .reveal_item_in_dir(path)
            .map_err(|_| MaterialError::Unreadable)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn drag_creation_pending_document(
    app: AppHandle,
    window: tauri::WebviewWindow,
    identity: String,
    id: String,
    version: String,
    token: String,
) -> Result<(), MaterialError> {
    if window.label() != "main" {
        return Err(MaterialError::InvalidIdentity);
    }
    let (done, completion) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| {
            let creation = handle.state::<super::creation::CreationState>();
            let access = creation.access.lock().map_err(|_| MaterialError::Storage)?;
            let protection =
                super::creation::protection(&handle).map_err(|_| MaterialError::InvalidIdentity)?;
            let data = handle
                .path()
                .app_data_dir()
                .map_err(|_| MaterialError::Storage)?;
            let path =
                access.pending_document_path(&data, &identity, &id, &version, &protection)?;
            crate::file_drag::start_private(&window, &path, &token)
                .map_err(|_| MaterialError::Unreadable)
        })();
        let _ = done.send(result);
    })
    .map_err(|_| MaterialError::Storage)?;
    completion.await.map_err(|_| MaterialError::Storage)?
}
