//! Model commands expose only status and sanitized errors to the WebView.

use crate::events::{AssistantTextEvent, ModelConfigurationChangedEvent};
use crate::model::ModelConnectionReport;
use crate::model::{AssistantModelMessage, AssistantModelTurn, AssistantRequestSnapshot};
use crate::model::{KeychainCredentials, ModelCredentialStatus, ModelService, ModelServiceError};
use crate::types::ModelServiceConfig;
use tauri::State;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;

/// Local-only measurement: no credential read, HTTP call or project access.
#[tauri::command]
#[specta::specta]
pub async fn measure_assistant_context(
    config: ModelServiceConfig,
    messages: Vec<AssistantModelMessage>,
) -> Result<crate::model::ContextMeasurement, ModelServiceError> {
    tauri::async_runtime::spawn_blocking(move || crate::model::measure_context(config, messages))
        .await
        .map_err(|_| ModelServiceError::Protocol)?
}

pub(super) fn configuration_changed(app: &AppHandle) {
    app.state::<ModelService<KeychainCredentials>>()
        .invalidate_assistant();
    let _ = ModelConfigurationChangedEvent {}.emit(app);
}

#[tauri::command]
#[specta::specta]
pub async fn get_model_credential_status(
    service: State<'_, ModelService<KeychainCredentials>>,
) -> Result<ModelCredentialStatus, ModelServiceError> {
    service.credential_status().await
}

#[tauri::command]
#[specta::specta]
pub async fn save_model_credential(
    app: AppHandle,
    service: State<'_, ModelService<KeychainCredentials>>,
    key: String,
) -> Result<(), ModelServiceError> {
    service.save_credential(&key).await?;
    let _ = ModelConfigurationChangedEvent {}.emit(&app);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn remove_model_credential(
    app: AppHandle,
    service: State<'_, ModelService<KeychainCredentials>>,
) -> Result<(), ModelServiceError> {
    service.remove_credential().await?;
    let _ = ModelConfigurationChangedEvent {}.emit(&app);
    Ok(())
}

async fn validate_owner(app: &AppHandle, identity: &str) -> Result<(), ModelServiceError> {
    let app = app.clone();
    let identity = identity.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let creation = app.state::<super::creation::CreationState>();
        let protection =
            super::creation::protection(&app).map_err(|_| ModelServiceError::InvalidIdentity)?;
        let access = creation
            .access
            .lock()
            .map_err(|_| ModelServiceError::InvalidIdentity)?;
        crate::model::validate_assistant_owner(&access, &identity, &protection)
    })
    .await
    .map_err(|_| ModelServiceError::InvalidIdentity)?
}

#[tauri::command]
#[specta::specta]
pub async fn begin_assistant_request(
    app: AppHandle,
    service: State<'_, ModelService<KeychainCredentials>>,
    identity: String,
    request_id: String,
) -> Result<AssistantRequestSnapshot, ModelServiceError> {
    let revision = service.assistant_revision();
    validate_owner(&app, &identity).await?;
    let config = super::preferences::load_preferences_sync(&app)
        .map_err(|_| ModelServiceError::InvalidConfig)?
        .model_service
        .ok_or(ModelServiceError::InvalidConfig)?;
    let snapshot = service
        .begin_assistant(identity.clone(), request_id, config, revision)
        .await?;
    if let Err(error) = validate_owner(&app, &identity).await {
        service.cancel_assistant(&snapshot.request_id);
        return Err(error);
    }
    // A credential/config change can arrive while the identity check reads disk.
    service.assistant_identity(&snapshot.request_id)?;
    Ok(snapshot)
}

#[tauri::command]
#[specta::specta]
pub async fn assistant_model_turn(
    app: AppHandle,
    service: State<'_, ModelService<KeychainCredentials>>,
    request_id: String,
    messages: Vec<AssistantModelMessage>,
    turn_id: String,
) -> Result<AssistantModelTurn, ModelServiceError> {
    if turn_id.is_empty() || turn_id.len() > 128 {
        return Err(ModelServiceError::Protocol);
    }
    let identity = service.assistant_identity(&request_id)?;
    if let Err(error) = validate_owner(&app, &identity).await {
        service.cancel_assistant(&request_id);
        return Err(error);
    }
    let turn = service
        .assistant_turn(&request_id, messages, |text| {
            let _ = AssistantTextEvent {
                request_id: request_id.clone(),
                turn_id: turn_id.clone(),
                text: text.to_owned(),
            }
            .emit_to(&app, "main");
        })
        .await?;
    if let Err(error) = validate_owner(&app, &identity).await {
        service.cancel_assistant(&request_id);
        return Err(error);
    }
    service.assistant_identity(&request_id)?;
    Ok(turn)
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_assistant_request(
    service: State<'_, ModelService<KeychainCredentials>>,
    request_id: String,
) -> Result<(), ModelServiceError> {
    service.cancel_assistant(&request_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn test_model_connection(
    service: State<'_, ModelService<KeychainCredentials>>,
    config: ModelServiceConfig,
    key: Option<String>,
) -> Result<ModelConnectionReport, ModelServiceError> {
    service.test_connection(&config, key.as_deref()).await
}
