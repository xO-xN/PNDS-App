use std::time::Duration;

use reqwest::{Client, Url};
use serde_json::{json, Value};

use super::{provider, ModelConnectionReport, ModelServiceError};
use crate::types::ModelServiceConfig;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
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
    let client = client(Some(REQUEST_TIMEOUT))?;
    let endpoint = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    tokio::time::timeout(
        REQUEST_TIMEOUT,
        probe(&client, &endpoint, &config.model, key),
    )
    .await
    .map_err(|_| probe_failure("request_deadline", ModelServiceError::Timeout))?
}

pub(super) fn client(timeout: Option<Duration>) -> Result<Client, ModelServiceError> {
    // reqwest 0.13's rustls-no-provider edge reuses the App's ring stack.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .connect_timeout(Duration::from_secs(10));
    if let Some(timeout) = timeout {
        builder = builder.timeout(timeout);
    }
    builder.build().map_err(|_| ModelServiceError::Network)
}

async fn probe(
    client: &Client,
    endpoint: &str,
    model: &str,
    key: &str,
) -> Result<ModelConnectionReport, ModelServiceError> {
    // A forced tool is unsupported in DeepSeek's default thinking mode. Probe
    // the small controlled exchange without thinking; real tasks retain it.
    let send = |mut body: Value, tool_phase| {
        if provider::is_deepseek(endpoint) {
            body["thinking"] = json!({"type":"disabled"});
        }
        request(client, endpoint, key, body, tool_phase)
    };
    let mut messages = vec![
        json!({"role":"user","content":"This is a connection check. Reply with a short greeting."}),
    ];
    let text = send(
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
    let response = send(json!({"model":model,"messages":messages,"stream":false,"max_tokens":128,"tools":tools,"tool_choice":{"type":"function","function":{"name":PROBE_NAME}}}), true).await.map_err(|error| probe_failure("tool_call", error))?;
    let id = probe_call_id(&response).map_err(|error| probe_failure("tool_response", error))?;
    // Reconstruct only the validated protocol fields. Provider metadata never
    // becomes another message, tool or instruction in the follow-up request.
    messages.push(json!({"role":"assistant","content":null,"tool_calls":[{"id":id,"type":"function","function":{"name":PROBE_NAME,"arguments":json!({"value":PROBE_VALUE}).to_string()}}]}));
    messages.push(json!({"role":"tool","tool_call_id":id,"content":json!({"value":PROBE_VALUE,"ok":true}).to_string()}));
    let final_text = send(json!({"model":model,"messages":messages,"stream":false,"max_tokens":128,"tools":tools,"tool_choice":"none"}), true).await.map_err(|error| probe_failure("tool_result", error))?;
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
    read_message(
        response(client, endpoint, key, body, tool_phase).await?,
        false,
    )
    .await
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
    let mut response = client
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
        400 | 413 | 422 => {
            // Only structured, recognized context errors permit automatic recovery.
            // Never surface or log provider bodies (they may echo private input).
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(transport_error)? {
                if bytes.len() + chunk.len() > 16 * 1024 {
                    return Err(protocol_failure("oversized_error_body"));
                }
                bytes.extend_from_slice(&chunk);
            }
            let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
            if context_overflow(&value) {
                return Err(ModelServiceError::ContextWindowExceeded);
            }
            return Err(if tool_phase && unsupported_tools(&value) {
                ModelServiceError::ToolsUnsupported
            } else {
                log::warn!("[model-transport] rejected reason=request_parameters");
                ModelServiceError::RequestRejected
            });
        }
        _ => return Err(protocol_failure("unexpected_http_status")),
    }
    Ok(response)
}

pub(super) async fn read_message(
    mut response: reqwest::Response,
    retain_reasoning: bool,
) -> Result<Value, ModelServiceError> {
    let maximum = MAX_RESPONSE_BYTES
        + if retain_reasoning {
            provider::MAX_REASONING_BYTES
        } else {
            0
        };
    if response
        .content_length()
        .is_some_and(|length| length > maximum as u64)
    {
        return Err(ModelServiceError::ResponseTooLarge);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(transport_error)? {
        if bytes.len() + chunk.len() > maximum {
            return Err(ModelServiceError::ResponseTooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| protocol_failure("invalid_json"))?;
    if let Some(error) = structured_error(&value) {
        return Err(error);
    }
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
        return Err(finish_failure(&choices[0]["finish_reason"]));
    }
    let mut message = message.clone();
    if retain_reasoning {
        provider::reasoning(&message)?;
    } else if let Some(fields) = message.as_object_mut() {
        fields.remove("reasoning_content");
    }
    message["usage"] = value["usage"].clone();
    Ok(message)
}

fn unsupported_tools(value: &Value) -> bool {
    [
        value["error"]["code"].as_str(),
        value["error"]["type"].as_str(),
    ]
    .into_iter()
    .flatten()
    .any(|code| {
        matches!(
            code,
            "unsupported_tools"
                | "tools_not_supported"
                | "tool_calls_not_supported"
                | "unsupported_tool_use"
        )
    })
}

/// Interpret fixed structured categories only. Free-form provider messages can
/// echo private requests and must never be used as diagnostics or instructions.
pub(super) fn structured_error(value: &Value) -> Option<ModelServiceError> {
    if context_overflow(value) {
        return Some(ModelServiceError::ContextWindowExceeded);
    }
    if unsupported_tools(value) {
        return Some(ModelServiceError::ToolsUnsupported);
    }
    [
        value["error"]["code"].as_str(),
        value["error"]["type"].as_str(),
    ]
    .into_iter()
    .flatten()
    .find_map(|code| match code {
        "invalid_request_error"
        | "invalid_request"
        | "invalid_parameter"
        | "unsupported_parameter" => Some(ModelServiceError::RequestRejected),
        "insufficient_system_resource" | "server_error" => {
            Some(ModelServiceError::ServiceUnavailable)
        }
        _ => None,
    })
}

/// Log only fixed categories, never provider text, prompts or credentials.
pub(super) fn finish_failure(reason: &Value) -> ModelServiceError {
    let (finish, error) = match reason.as_str() {
        Some("model_context_window_exceeded") => {
            ("context_window", ModelServiceError::ContextWindowExceeded)
        }
        Some("length") => ("length", ModelServiceError::OutputTruncated),
        Some("insufficient_system_resource") => {
            ("service_resource", ModelServiceError::ServiceUnavailable)
        }
        Some("aborted") => ("aborted", ModelServiceError::ResponseInterrupted),
        Some("stop") => ("stop", ModelServiceError::Protocol),
        Some("tool_calls") => ("tool_calls", ModelServiceError::Protocol),
        Some("content_filter") => ("content_filter", ModelServiceError::Protocol),
        Some(_) => ("other", ModelServiceError::Protocol),
        None => ("missing", ModelServiceError::ResponseInterrupted),
    };
    log::warn!("[model-transport] rejected reason=finish_reason finish={finish} error={error:?}");
    error
}

pub(super) fn transport_error(error: reqwest::Error) -> ModelServiceError {
    if error.is_timeout() {
        ModelServiceError::Timeout
    } else {
        ModelServiceError::Network
    }
}

/// Codes only: provider messages may echo private prompts or credentials.
pub(super) fn context_overflow(value: &Value) -> bool {
    [
        value["error"]["code"].as_str(),
        value["error"]["type"].as_str(),
    ]
    .into_iter()
    .flatten()
    .any(|code| {
        matches!(
            code,
            "context_length_exceeded"
                | "context_window_exceeded"
                | "max_context_length_exceeded"
                | "input_tokens_exceeded"
                | "model_context_window_exceeded"
                | "1261"
        )
    })
}

#[cfg(test)]
#[path = "transport_tests.rs"]
mod deepseek_tests;
