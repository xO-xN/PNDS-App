//! History commands accept only the current native creation capability.
use crate::assistant_history::{
    AssistantHistory, AssistantHistoryError, AssistantHistoryMessage, AssistantHistoryStore,
};
use crate::model::{KeychainCredentials, ModelService};
use std::path::Path;
use tauri::{AppHandle, Manager};

async fn with_history<T: Send + 'static>(
    app: AppHandle,
    identity: String,
    operation: impl FnOnce(&AssistantHistoryStore, &Path, &Path) -> Result<T, AssistantHistoryError>
        + Send
        + 'static,
) -> Result<T, AssistantHistoryError> {
    tauri::async_runtime::spawn_blocking(move || {
        let protection = super::creation::protection(&app)
            .map_err(|_| AssistantHistoryError::InvalidIdentity)?;
        let creation = app.state::<super::creation::CreationState>();
        // Hold the existing creation lock through publication: a queued old
        // identity cannot publish after native close/project replacement.
        let access = creation
            .access
            .lock()
            .map_err(|_| AssistantHistoryError::InvalidIdentity)?;
        crate::model::validate_assistant_owner(&access, &identity, &protection)
            .map_err(|_| AssistantHistoryError::InvalidIdentity)?;
        let project = access
            .descriptor(&identity, &protection)
            .map_err(|_| AssistantHistoryError::InvalidIdentity)?;
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|_| AssistantHistoryError::Io)?;
        operation(
            &app.state::<AssistantHistoryStore>(),
            &app_data,
            Path::new(&project.root),
        )
    })
    .await
    .map_err(|_| AssistantHistoryError::Io)?
}

#[tauri::command]
#[specta::specta]
pub async fn load_assistant_history(
    app: AppHandle,
    identity: String,
) -> Result<AssistantHistory, AssistantHistoryError> {
    with_history(app, identity, |store, app_data, root| {
        store.load(app_data, root)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn save_assistant_history(
    app: AppHandle,
    identity: String,
    epoch: String,
    messages: Vec<AssistantHistoryMessage>,
) -> Result<(), AssistantHistoryError> {
    with_history(app, identity, move |store, app_data, root| {
        store.save(app_data, root, &epoch, messages)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn clear_assistant_history(
    app: AppHandle,
    identity: String,
) -> Result<AssistantHistory, AssistantHistoryError> {
    let model = app
        .state::<ModelService<KeychainCredentials>>()
        .inner()
        .clone();
    with_history(app, identity, move |store, app_data, root| {
        let history = store.clear(app_data, root)?;
        // Also invalidate begins still awaiting ownership/keychain; history
        // epochs independently reject every late pre-clear persistence call.
        model.invalidate_assistant();
        Ok(history)
    })
    .await
}
