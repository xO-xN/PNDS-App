//! One local assembly/measurement path for previews and authenticated turns.
//! Encoding is explicitly selected; model names never imply a capability.
use super::{chat, AssistantModelMessage, ModelServiceError};
use crate::types::ModelServiceConfig;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specta::Type;

pub(super) const MAX_CONTEXT_BYTES: usize = 128 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContextTokenizer {
    Unknown,
    #[serde(rename = "cl100kBase")]
    Cl100kBase,
    #[serde(rename = "o200kBase")]
    O200kBase,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CapacitySource {
    ManualUnverified,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelContextConfig {
    pub capacity: Option<u32>,
    pub input_target: Option<u32>,
    pub max_output: u32,
    pub reasoning_reserve: u32,
    pub safety_margin: u32,
    pub tokenizer: ContextTokenizer,
    pub source: CapacitySource,
}

impl Default for ModelContextConfig {
    fn default() -> Self {
        Self {
            capacity: None,
            input_target: None,
            max_output: 4096,
            reasoning_reserve: 0,
            safety_margin: 256,
            tokenizer: ContextTokenizer::Unknown,
            source: CapacitySource::ManualUnverified,
        }
    }
}

impl ModelContextConfig {
    pub(super) fn validate(&self) -> Result<(), ModelServiceError> {
        let reserve = u64::from(self.max_output)
            + u64::from(self.reasoning_reserve)
            + u64::from(self.safety_margin);
        if self.max_output == 0
            || reserve > 16_000_000
            || self.capacity.is_some_and(|capacity| {
                capacity == 0 || capacity > 16_000_000 || reserve >= u64::from(capacity)
            })
            || self.input_target.is_some_and(|target| {
                target == 0
                    || target > 16_000_000
                    || self
                        .capacity
                        .is_some_and(|capacity| u64::from(target) + reserve > u64::from(capacity))
            })
        {
            return Err(ModelServiceError::InvalidConfig);
        }
        Ok(())
    }

    fn input_budget(&self) -> Option<u32> {
        let available = self.capacity.map(|capacity| {
            capacity - self.max_output - self.reasoning_reserve - self.safety_margin
        });
        match (available, self.input_target) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextPart {
    pub kind: String,
    pub characters: u32,
    pub utf8_bytes: u32,
    pub estimated_tokens: Option<u32>,
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextMeasurement {
    pub characters: u32,
    pub utf8_bytes: u32,
    pub estimated_tokens: Option<u32>,
    /// Portable display-only fallback. Never used for admission or server usage.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference_estimated_tokens: Option<u32>,
    pub admission_estimate: u32,
    pub tokenizer: ContextTokenizer,
    pub capacity: Option<u32>,
    pub effective_input: Option<u32>,
    pub output_reserve: u32,
    pub safety_margin: u32,
    pub parts: Vec<ContextPart>,
    pub exceeded: Option<String>,
}

pub(super) fn assemble(
    config: &ModelServiceConfig,
    messages: Vec<AssistantModelMessage>,
) -> Result<(Value, ContextMeasurement), ModelServiceError> {
    super::validate_config(config)?;
    let context = config.context.clone().unwrap_or_default();
    let kinds: Vec<_> = messages
        .iter()
        .map(|message| message.context_kind)
        .collect();
    let messages = chat::wire_messages(messages)?;
    let project_reading = matches!(
        kinds.first(),
        Some(Some(chat::ContextContentKind::ProjectPolicy))
    );
    let tools = chat::document_tools(project_reading);
    let mut body = json!({"model":config.model,"messages":messages,"stream":true,"stream_options":{"include_usage":true},"tools":tools,"tool_choice":"auto"});
    let output = context.max_output + context.reasoning_reserve;
    if context.reasoning_reserve > 0 {
        body["max_completion_tokens"] = json!(output);
    } else {
        body["max_tokens"] = json!(output);
    }
    let encoded = serde_json::to_string(&body).map_err(|_| ModelServiceError::Protocol)?;
    let count = |text: &str| -> Option<u32> {
        match context.tokenizer {
            ContextTokenizer::Unknown => None,
            ContextTokenizer::Cl100kBase => Some(
                tiktoken_rs::cl100k_base_singleton()
                    .encode_ordinary(text)
                    .len() as u32,
            ),
            ContextTokenizer::O200kBase => Some(
                tiktoken_rs::o200k_base_singleton()
                    .encode_ordinary(text)
                    .len() as u32,
            ),
        }
    };
    let mut parts = Vec::new();
    let last_user = messages
        .iter()
        .rposition(|message| message["role"] == "user");
    for kind in [
        "policyTools",
        "history",
        "input",
        "documents",
        "summary",
        "projectOverview",
        "projectFragment",
        "attachment",
    ] {
        let mut values = Vec::new();
        if kind == "policyTools" {
            values.push(tools.clone());
        }
        for (index, message) in messages.iter().enumerate() {
            let role = message["role"].as_str().unwrap_or("");
            let category = if let Some(kind) = kinds[index] {
                match kind {
                    chat::ContextContentKind::ProjectPolicy => "policyTools",
                    chat::ContextContentKind::History => "history",
                    chat::ContextContentKind::Input => "input",
                    chat::ContextContentKind::Documents => "documents",
                    chat::ContextContentKind::Summary => "summary",
                    chat::ContextContentKind::ProjectOverview => "projectOverview",
                    chat::ContextContentKind::ProjectFragment => "projectFragment",
                    chat::ContextContentKind::Attachment => "attachment",
                }
            } else {
                match role {
                    "system" => "policyTools",
                    "tool" => "documents",
                    "user" if Some(index) == last_user => "input",
                    "assistant" if last_user.is_some_and(|last| index > last) => "documents",
                    _ => "history",
                }
            };
            if category == kind {
                values.push(message.clone());
            }
        }
        if values.is_empty()
            && matches!(
                kind,
                "summary" | "projectOverview" | "projectFragment" | "attachment"
            )
        {
            continue;
        }
        let text = if values.is_empty() {
            String::new()
        } else {
            serde_json::to_string(&values).map_err(|_| ModelServiceError::Protocol)?
        };
        parts.push(ContextPart {
            kind: kind.into(),
            characters: text.chars().count() as u32,
            utf8_bytes: text.len() as u32,
            estimated_tokens: count(&text),
        });
    }
    // JSON encoding is measured as a whole, including tools and protocol fields.
    // Tokenizer counts are estimates of provider framing, never server usage.
    let estimated_tokens = count(&encoded);
    let reference_estimated_tokens = estimated_tokens.is_none().then(|| {
        tiktoken_rs::o200k_base_singleton()
            .encode_ordinary(&encoded)
            .len() as u32
    });
    // Without a selected encoder, use a deliberately conservative byte-sized
    // admission estimate, while keeping actual token occupancy unknown.
    let admission_estimate = estimated_tokens.unwrap_or(encoded.len() as u32);
    let effective_input = context.input_budget();
    let exceeded = if encoded.len() > MAX_CONTEXT_BYTES {
        Some("contextBytes".into())
    } else if effective_input.is_some_and(|limit| admission_estimate > limit) {
        Some("contextTokens".into())
    } else {
        None
    };
    Ok((
        body,
        ContextMeasurement {
            characters: encoded.chars().count() as u32,
            utf8_bytes: encoded.len() as u32,
            estimated_tokens,
            reference_estimated_tokens,
            admission_estimate,
            tokenizer: context.tokenizer,
            capacity: context.capacity,
            effective_input,
            output_reserve: output,
            safety_margin: context.safety_margin,
            parts,
            exceeded,
        },
    ))
}

pub fn measure_context(
    config: ModelServiceConfig,
    messages: Vec<AssistantModelMessage>,
) -> Result<ContextMeasurement, ModelServiceError> {
    assemble(&config, messages).map(|(_, measurement)| measurement)
}
