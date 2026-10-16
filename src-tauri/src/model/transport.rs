use std::time::Duration;

use reqwest::{Client, Url};
use serde_json::{json, Value};

use super::{ModelConnectionReport, ModelServiceError};
use crate::types::ModelServiceConfig;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const PROBE_NAME: &str = "pnds_connection_probe";
const PROBE_VALUE: &str = "pnds-connection-check";

pub fn validate_config(config: &ModelServiceConfig) -> Result<(), ModelServiceError> {
    if let Some(context) = &config.context {
        context.validate()?;
    }
    if config.model.trim().is_empty()
        || config.model.len() > 256
        || config.model.chars().any(char::is_control)
        || config.base_url.len() > 2048
        || config.base_url.trim() != config.base_url
    {
        return Err(ModelServiceError::InvalidConfig);
    }
    let url = Url::parse(&config.base_url).map_err(|_| ModelServiceError::InvalidConfig)?;
    let host = url.host_str().ok_or(ModelServiceError::InvalidConfig)?;
    let loopback = host == "localhost"
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    if !(url.scheme() == "https" || url.scheme() == "http" && loopback)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(ModelServiceError::InvalidConfig);
    }
    Ok(())
}

pub(super) async fn test_connection(
    config: &ModelServiceConfig,
    key: &str,
) -> Result<ModelConnectionReport, ModelServiceError> {
    validate_config(config)?;
    let client = client(REQUEST_TIMEOUT)?;
    let endpoint = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    tokio::time::timeout(
        REQUEST_TIMEOUT,
        probe(&client, &endpoint, &config.model, key),
    )
    .await
    .map_err(|_| probe_failure("request_deadline", ModelServiceError::Timeout))?
}

pub(super) fn client(timeout: Duration) -> Result<Client, ModelServiceError> {
    // reqwest 0.13's rustls-no-provider edge reuses the App's ring stack.
    let _ = rustls::crypto::ring::default_provider().install_default();
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .timeout(timeout)
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| ModelServiceError::Network)
}

async fn probe(
    client: &Client,
    endpoint: &str,
    model: &str,
    key: &str,
) -> Result<ModelConnectionReport, ModelServiceError> {
    let mut messages = vec![
        json!({"role":"user","content":"This is a connection check. Reply with a short greeting."}),
    ];
    let text = request(
        client,
        endpoint,
        key,
        json!({"model":model,"messages":messages,"stream":false,"max_tokens":128}),
        false,
    )
    .await
    .map_err(|error| probe_failure("text_request", error))?;
    require_text(&text).map_err(|error| probe_failure("text_response", error))?;

    messages = vec![
        json!({"role":"user","content":"Call pnds_connection_probe exactly once with value pnds-connection-check. After receiving the tool result, give a short confirmation."}),
    ];
    let tools = json!([{"type":"function","function":{"name":PROBE_NAME,"description":"A harmless connection capability check.","parameters":{"type":"object","properties":{"value":{"type":"string","enum":[PROBE_VALUE]}},"required":["value"],"additionalProperties":false}}}]);
    let response = request(client, endpoint, key, json!({"model":model,"messages":messages,"stream":false,"max_tokens":128,"tools":tools,"tool_choice":{"type":"function","function":{"name":PROBE_NAME}}}), true).await.map_err(|error| probe_failure("tool_call", error))?;
    let id = probe_call_id(&response).map_err(|error| probe_failure("tool_response", error))?;
    // Reconstruct only the validated protocol fields. Provider metadata never
    // becomes another message, tool or instruction in the follow-up request.
    messages.push(json!({"role":"assistant","content":null,"tool_calls":[{"id":id,"type":"function","function":{"name":PROBE_NAME,"arguments":json!({"value":PROBE_VALUE}).to_string()}}]}));
    messages.push(json!({"role":"tool","tool_call_id":id,"content":json!({"value":PROBE_VALUE,"ok":true}).to_string()}));
    let final_text = request(client, endpoint, key, json!({"model":model,"messages":messages,"stream":false,"max_tokens":128,"tools":tools,"tool_choice":"none"}), true).await.map_err(|error| probe_failure("tool_result", error))?;
    require_text(&final_text).map_err(|error| probe_failure("final_text", error))?;
    log::info!("[model-connection] passed text=true tool_call=true");
    Ok(ModelConnectionReport {
        text: true,
        tool_call: true,
    })
}

fn probe_call_id(response: &Value) -> Result<&str, ModelServiceError> {
    let calls = response
        .get("tool_calls")
        .and_then(Value::as_array)
        .ok_or(ModelServiceError::ToolsUnsupported)?;
    if calls.is_empty() {
        return Err(ModelServiceError::ToolsUnsupported);
    }
    if calls.len() != 1 {
        return Err(ModelServiceError::Protocol);
    }
    let call = &calls[0];
    let id = call
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= 256)
        .ok_or(ModelServiceError::Protocol)?;
    if call["type"] != "function" || call["function"]["name"] != PROBE_NAME {
        return Err(ModelServiceError::Protocol);
    }
    let arguments = call["function"]["arguments"]
        .as_str()
        .ok_or(ModelServiceError::Protocol)?;
    let arguments: Value =
        serde_json::from_str(arguments).map_err(|_| ModelServiceError::Protocol)?;
    if arguments != json!({"value":PROBE_VALUE}) {
        return Err(ModelServiceError::Protocol);
    }
    Ok(id)
}

fn probe_failure(phase: &'static str, error: ModelServiceError) -> ModelServiceError {
    log::warn!("[model-connection] failed phase={phase} error={error:?}");
    error
}

fn protocol_failure(reason: &'static str) -> ModelServiceError {
    log::warn!("[model-transport] rejected reason={reason}");
    ModelServiceError::Protocol
}

fn require_text(message: &Value) -> Result<(), ModelServiceError> {
    if message.get("tool_calls").is_some_and(|calls| {
        !calls.is_null() && calls.as_array().is_none_or(|items| !items.is_empty())
    }) || !message
        .get("content")
        .and_then(Value::as_str)
        .is_some_and(|text| !text.trim().is_empty())
    {
        return Err(protocol_failure(
            "missing_final_text_or_unexpected_tool_call",
        ));
    }
    Ok(())
}

pub(super) async fn request(
    client: &Client,
    endpoint: &str,
    key: &str,
    body: Value,
    tool_phase: bool,
) -> Result<Value, ModelServiceError> {
    read_message(response(client, endpoint, key, body, tool_phase).await?).await
}

pub(super) async fn response(
    client: &Client,
    endpoint: &str,
    key: &str,
    body: Value,
    tool_phase: bool,
) -> Result<reqwest::Response, ModelServiceError> {
    let mut authorization = reqwest::header::HeaderValue::from_str(&format!("Bearer {key}"))
        .map_err(|_| ModelServiceError::InvalidConfig)?;
    authorization.set_sensitive(true);
    let response = client
        .post(endpoint)
        .header(reqwest::header::AUTHORIZATION, authorization)
        .json(&body)
        .send()
        .await
        .map_err(transport_error)?;
    let status = response.status().as_u16();
    log::debug!("[model-transport] http_status={status}");
    match status {
        200..=299 => {}
        401 | 403 => return Err(ModelServiceError::Authentication),
        429 => return Err(ModelServiceError::RateLimited),
        500..=599 => return Err(ModelServiceError::ServiceUnavailable),
        400 | 422 if tool_phase => return Err(ModelServiceError::ToolsUnsupported),
        _ => return Err(protocol_failure("unexpected_http_status")),
    }
    Ok(response)
}

pub(super) async fn read_message(
    mut response: reqwest::Response,
) -> Result<Value, ModelServiceError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(protocol_failure("response_size_limit"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(transport_error)? {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(protocol_failure("response_size_limit"));
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| protocol_failure("invalid_json"))?;
    let choices = value["choices"]
        .as_array()
        .filter(|choices| choices.len() == 1)
        .ok_or_else(|| protocol_failure("missing_or_multiple_choices"))?;
    let message = &choices[0]["message"];
    let calls = message["tool_calls"]
        .as_array()
        .is_some_and(|calls| !calls.is_empty());
    let finish_reason = if calls { "tool_calls" } else { "stop" };
    if message["role"] != "assistant" || choices[0]["finish_reason"] != finish_reason {
        let finish = match choices[0]["finish_reason"].as_str() {
            Some("stop") => "stop",
            Some("tool_calls") => "tool_calls",
            Some("length") => "length",
            Some("content_filter") => "content_filter",
            Some(_) => "other",
            None => "missing",
        };
        log::warn!("[model-transport] rejected reason=role_or_finish_reason finish={finish}");
        return Err(ModelServiceError::Protocol);
    }
    let mut message = message.clone();
    message["usage"] = value["usage"].clone();
    Ok(message)
}

pub(super) fn transport_error(error: reqwest::Error) -> ModelServiceError {
    if error.is_timeout() {
        ModelServiceError::Timeout
    } else {
        ModelServiceError::Network
    }
}
