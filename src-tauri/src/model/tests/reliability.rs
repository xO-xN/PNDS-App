//! Opt-in stdio transport for the frontend reliability evaluator. No creator
//! project or transcript is read; the selected config/key stay in native memory.
use super::*;
use std::io::{BufRead, Write};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EvalRequest {
    id: u32,
    op: String,
    #[serde(default)]
    request_id: String,
    #[serde(default)]
    messages: Vec<AssistantModelMessage>,
}

fn response(id: u32, data: Result<Value, ModelServiceError>) {
    let value = match data {
        Ok(value) => json!({"id":id, "data":value}),
        Err(error) => json!({"id":id, "error":error}),
    };
    println!("PNDS_EVAL_RPC {value}");
    std::io::stdout().flush().unwrap();
}

#[cfg(target_os = "macos")]
fn selected_config() -> Result<ModelServiceConfig, ModelServiceError> {
    let app: Value = serde_json::from_str(include_str!("../../../tauri.conf.json"))
        .map_err(|_| ModelServiceError::InvalidConfig)?;
    let identifier = app["identifier"]
        .as_str()
        .ok_or(ModelServiceError::InvalidConfig)?;
    let path = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .ok_or(ModelServiceError::InvalidConfig)?
        .join("Library/Application Support")
        .join(identifier)
        .join("preferences.json");
    let bytes = std::fs::read(path).map_err(|_| ModelServiceError::InvalidConfig)?;
    let preferences: crate::types::AppPreferences =
        serde_json::from_slice(&bytes).map_err(|_| ModelServiceError::InvalidConfig)?;
    preferences
        .model_service
        .ok_or(ModelServiceError::InvalidConfig)
}

#[cfg(not(target_os = "macos"))]
fn selected_config() -> Result<ModelServiceConfig, ModelServiceError> {
    Err(ModelServiceError::CredentialStore)
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "Paid configured-provider evaluation; run only through the frontend opt-in evaluator"]
async fn configured_provider_reliability_stdio_bridge() {
    if std::env::var("PNDS_ASSISTANT_PROVIDER_EVAL").as_deref() != Ok("1") {
        return;
    }
    let config = match selected_config() {
        Ok(config) => config,
        Err(error) => {
            response(0, Err(error));
            return;
        }
    };
    if let Err(error) = validate_config(&config) {
        response(0, Err(error));
        return;
    }
    let service = ModelService::new(KeychainCredentials);
    match service.credential_status().await {
        Ok(status) if status.has_key => {}
        Ok(_) => {
            response(0, Err(ModelServiceError::MissingCredential));
            return;
        }
        Err(error) => {
            response(0, Err(error));
            return;
        }
    }
    response(0, Ok(json!({"config":config})));
    let mut turns = 0;
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.len() > 2 * 1024 * 1024 {
            response(0, Err(ModelServiceError::ContextBytesExceeded));
            break;
        }
        let Ok(request) = serde_json::from_str::<EvalRequest>(&line) else {
            response(0, Err(ModelServiceError::Protocol));
            break;
        };
        let result = match request.op.as_str() {
            "begin" => service
                .begin_assistant(
                    "reliability-memory-fixture".into(),
                    request.request_id,
                    config.clone(),
                    service.assistant_revision(),
                )
                .await
                .map(|snapshot| serde_json::to_value(snapshot).unwrap()),
            "measure" => measure_context(config.clone(), request.messages)
                .map(|measurement| serde_json::to_value(measurement).unwrap()),
            "turn" if turns < 72 => {
                turns += 1;
                service
                    .assistant_turn(&request.request_id, request.messages, |_| {})
                    .await
                    .map(|turn| serde_json::to_value(turn).unwrap())
            }
            "cancel" => {
                service.cancel_assistant(&request.request_id);
                Ok(Value::Null)
            }
            "stop" => break,
            _ => Err(ModelServiceError::Protocol),
        };
        response(request.id, result);
    }
}
