//! Each operation holds the current creation capability through private publication.
use crate::project::audio_preview::{AudioPreviewAction, AudioPreviewError, AudioPreviewSnapshot};
use crate::project::creation::{
    CreationAccess, CreationMaterial, CreationMaterialPage, CreationMaterialRead,
    CreationPendingDocument, CreationPendingDocumentSave, CreationPendingMedia,
    ImportedCreationResource, MaterialError, Protection,
};
use base64::Engine as _;
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

#[tauri::command]
#[specta::specta]
pub async fn import_creation_resource(
    app: AppHandle,
    identity: String,
    path: String,
) -> Result<ImportedCreationResource, MaterialError> {
    #[cfg(target_os = "macos")]
    if crate::project::creation::is_pending_audio_source(Path::new(&path)) {
        // Authorize the workspace before opening a large source. Hash and
        // decode outside its access lock, then revalidate before publication.
        with_materials(
            app.clone(),
            identity.clone(),
            |access, _, identity, protection| {
                access
                    .descriptor(identity, protection)
                    .map(|_| ())
                    .map_err(|_| MaterialError::InvalidIdentity)
            },
        )
        .await?;
        let prepared = tauri::async_runtime::spawn_blocking(move || {
            crate::project::creation::prepare_audio_import(Path::new(&path))
        })
        .await
        .map_err(|_| MaterialError::Storage)??;
        return with_materials(app, identity, move |access, _, identity, protection| {
            access
                .publish_audio_import(identity, prepared, protection)
                .map(ImportedCreationResource::Media)
        })
        .await;
    }

    with_materials(app, identity, move |access, data, identity, protection| {
        access.import_creation_resource(data, identity, Path::new(&path), protection)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn list_creation_pending_media(
    app: AppHandle,
    identity: String,
) -> Result<Vec<CreationPendingMedia>, MaterialError> {
    with_materials(app, identity, |access, _, identity, protection| {
        access.list_pending_media(identity, protection)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn read_creation_pending_image(
    app: AppHandle,
    identity: String,
    id: String,
    version: String,
) -> Result<String, MaterialError> {
    with_materials(app, identity, move |access, _, identity, protection| {
        let (mime, bytes) = access.read_pending_image(identity, &id, &version, protection)?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        Ok(format!("data:{mime};base64,{encoded}"))
    })
    .await
}

#[cfg(target_os = "macos")]
#[derive(Default)]
pub(crate) struct PendingAudioRequest(std::sync::Mutex<Option<String>>);

#[cfg(target_os = "macos")]
async fn on_audio_thread<T: Send + 'static>(
    app: &AppHandle,
    operation: impl FnOnce() -> Result<T, AudioPreviewError> + Send + 'static,
) -> Result<T, AudioPreviewError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(operation());
    })
    .map_err(|_| AudioPreviewError::Playback)?;
    receiver.await.map_err(|_| AudioPreviewError::Playback)?
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn start_pending_audio_preview(
    app: AppHandle,
    identity: String,
    id: String,
    version: String,
    preview: String,
    device: Option<String>,
    position_ms: u32,
    gain: f32,
) -> Result<AudioPreviewSnapshot, AudioPreviewError> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (
            app,
            identity,
            id,
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
        let state = app.state::<PendingAudioRequest>();
        {
            let mut request = state.0.lock().map_err(|_| AudioPreviewError::Playback)?;
            *request = Some(preview.clone());
        }
        let file = with_materials(
            app.clone(),
            identity.clone(),
            move |access, _, identity, protection| {
                access.prepare_pending_audio(identity, &id, &version, protection)
            },
        )
        .await
        .map_err(|_| AudioPreviewError::SourceUnavailable)?;
        let (source, metadata) = file;
        let copy =
            tauri::async_runtime::spawn_blocking(move || metadata.verified_audio_copy(source))
                .await
                .map_err(|_| AudioPreviewError::Playback)?
                .map_err(|_| AudioPreviewError::SourceUnavailable)?;
        let handle = app.clone();
        let watchdog_token = preview.clone();
        let result = on_audio_thread(&app, move || {
            let state = handle.state::<PendingAudioRequest>();
            let request = state.0.lock().map_err(|_| AudioPreviewError::Playback)?;
            if request.as_deref() != Some(preview.as_str()) {
                return Err(AudioPreviewError::Cancelled);
            }
            let creation = handle.state::<super::creation::CreationState>();
            let access = creation
                .access
                .try_lock()
                .map_err(|_| AudioPreviewError::Cancelled)?;
            let protection =
                super::creation::protection(&handle).map_err(|_| AudioPreviewError::Cancelled)?;
            access
                .descriptor(&identity, &protection)
                .map_err(|_| AudioPreviewError::Cancelled)?;
            let disconnect = preview.clone();
            let event_handle = handle.clone();
            crate::project::audio_preview::start(
                preview,
                copy,
                device.as_deref(),
                position_ms,
                gain,
                move || emit_preview_disconnect(&event_handle, disconnect.clone()),
            )
        })
        .await?;
        // Guard the hardware route even if the WebView is throttled or unfocused.
        tauri::async_runtime::spawn(monitor_pending_audio(app, watchdog_token));
        Ok(result)
    }
}

#[cfg(target_os = "macos")]
fn emit_preview_disconnect(app: &AppHandle, preview: String) {
    use tauri_specta::Event;
    let _ = crate::events::CreationAudioPreviewDisconnected { preview }.emit(app);
}

#[cfg(target_os = "macos")]
async fn monitor_pending_audio(app: AppHandle, preview: String) {
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let token = preview.clone();
        let handle = app.clone();
        let result = on_audio_thread(&app, move || {
            let result = crate::project::audio_preview::control(&token, AudioPreviewAction::Status);
            if matches!(result, Err(AudioPreviewError::DeviceDisconnected)) {
                emit_preview_disconnect(&handle, token);
            }
            result
        })
        .await;
        if result.is_err() {
            break;
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn control_pending_audio_preview(
    app: AppHandle,
    preview: String,
    action: AudioPreviewAction,
) -> Result<AudioPreviewSnapshot, AudioPreviewError> {
    #[cfg(target_os = "macos")]
    return on_audio_thread(&app, move || {
        crate::project::audio_preview::control(&preview, action)
    })
    .await;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, preview, action);
        Err(AudioPreviewError::Playback)
    }
}

#[tauri::command]
#[specta::specta]
pub async fn stop_pending_audio_preview(
    app: AppHandle,
    preview: String,
) -> Result<(), AudioPreviewError> {
    #[cfg(target_os = "macos")]
    {
        let state = app.state::<PendingAudioRequest>();
        {
            let mut request = state.0.lock().map_err(|_| AudioPreviewError::Playback)?;
            if request.as_deref() == Some(preview.as_str()) {
                request.take();
            }
        }
        on_audio_thread(&app, move || {
            crate::project::audio_preview::stop(&preview);
            Ok(())
        })
        .await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, preview);
        Ok(())
    }
}
