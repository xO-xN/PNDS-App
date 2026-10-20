//! Small wire-format differences at the native provider boundary. No model
//! capacity or tokenizer is inferred from a provider or model name.
use reqwest::Url;
use serde_json::Value;

use super::ModelServiceError;

pub(crate) const MAX_REASONING_BYTES: usize = 1024 * 1024;

pub(super) fn is_deepseek(base: &str) -> bool {
    Url::parse(base)
        .ok()
        .is_some_and(|url| url.host_str() == Some("api.deepseek.com"))
}

/// Preserve the empty-string case too: it is a valid protocol value, distinct
/// from accidentally omitting reasoning on a tool-call message.
pub(super) fn reasoning(value: &Value) -> Result<Option<String>, ModelServiceError> {
    match value.get("reasoning_content") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) if text.len() <= MAX_REASONING_BYTES => Ok(Some(text.clone())),
        Some(Value::String(_)) => Err(ModelServiceError::ResponseTooLarge),
        Some(_) => Err(ModelServiceError::Protocol),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deepseek_compatibility_is_scoped_to_the_official_host() {
        for base in ["https://api.deepseek.com", "https://api.deepseek.com/v1/"] {
            assert!(is_deepseek(base));
        }
        for base in [
            "https://api.deepseek.com.example/v1",
            "https://example.com/deepseek-flash",
            "http://localhost:1234",
        ] {
            assert!(!is_deepseek(base));
        }
    }

    #[test]
    fn reasoning_is_replayed_only_to_deepseek_and_old_history_gets_an_empty_protocol_value() {
        use crate::model::{context, AssistantModelMessage};
        for base in ["https://api.deepseek.com", "https://example.com/v1"] {
            let config = crate::types::ModelServiceConfig {
                base_url: base.into(),
                model: "selected-model".into(),
                context: None,
            };
            let messages: Vec<AssistantModelMessage> = serde_json::from_value(serde_json::json!([
                {"role":"user","content":"Earlier question"},
                {"role":"assistant","content":"Earlier answer","reasoningContent":"private protocol reasoning"},
                {"role":"assistant","content":"Legacy answer"},
                {"role":"user","content":"Next question"}
            ])).unwrap();
            let (body, _) = context::assemble(&config, messages).unwrap();
            if is_deepseek(base) {
                assert_eq!(
                    body["messages"][1]["reasoning_content"],
                    "private protocol reasoning"
                );
                assert_eq!(body["messages"][2]["reasoning_content"], "");
            } else {
                assert!(body["messages"][1].get("reasoning_content").is_none());
                assert!(body.get("thinking").is_none());
            }
        }
    }
}
