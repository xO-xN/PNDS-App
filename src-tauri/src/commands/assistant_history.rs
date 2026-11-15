//! History commands accept only the current native creation capability.
use crate::assistant_history::{
    AssistantHistory, AssistantHistoryError, AssistantHistoryMessage, AssistantHistoryStore,
};
use crate::model::{KeychainCredentials, ModelService};
use std::collections::BTreeMap;
use std::fs::File;
use std::path::Path;
use tauri::{AppHandle, Manager};

async fn with_history<T: Send + 'static>(
    app: AppHandle,
    identity: String,
    operation: impl FnOnce(&AssistantHistoryStore, &Path, &File, &str) -> Result<T, AssistantHistoryError>
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
        let directory = access
            .creation_data_directory(&identity, &protection)
            .map_err(|_| AssistantHistoryError::Io)?;
        let key = crate::assistant_history::key_for_root(Path::new(&project.root));
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|_| AssistantHistoryError::Io)?;
        operation(
            &app.state::<AssistantHistoryStore>(),
            &app_data,
            &directory,
            &key,
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
    with_history(app, identity, |store, app_data, directory, key| {
        store.load_at(app_data, directory, key)
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
    conversation_titles: BTreeMap<String, String>,
) -> Result<(), AssistantHistoryError> {
    with_history(app, identity, move |store, app_data, directory, key| {
        store.save_at(
            app_data,
            directory,
            key,
            &epoch,
            messages,
            conversation_titles,
        )
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
    with_history(app, identity, move |store, _app_data, directory, key| {
        let history = store.clear_at(directory, key)?;
        // Also invalidate begins still awaiting ownership/keychain; history
        // epochs independently reject every late pre-clear persistence call.
        model.invalidate_assistant();
        Ok(history)
    })
    .await
}
