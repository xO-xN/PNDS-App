//! One local assembly/measurement path for previews and authenticated turns.
//! Encoding is explicitly selected; model names never imply a capability.
use super::{chat, AssistantModelMessage, ModelServiceError};
use crate::types::ModelServiceConfig;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specta::Type;

pub(super) const MAX_CONTEXT_BYTES: usize = 512 * 1024;

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
    // Missing in pre-auto preferences: legacy targets no longer block input.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<ContextMode>,
    pub capacity: Option<u32>,
    pub input_target: Option<u32>,
    /// None leaves the output limit to the provider, including reasoning.
    #[serde(default)]
    pub max_output: Option<u32>,
    pub reasoning_reserve: u32,
    pub safety_margin: u32,
    pub tokenizer: ContextTokenizer,
    pub source: CapacitySource,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContextMode {
    Auto,
    Manual,
}

impl Default for ModelContextConfig {
    fn default() -> Self {
        Self {
            mode: None,
            capacity: None,
            input_target: None,
            max_output: None,
            reasoning_reserve: 0,
            safety_margin: 256,
            tokenizer: ContextTokenizer::Unknown,
            source: CapacitySource::ManualUnverified,
        }
    }
}

impl ModelContextConfig {
    pub(super) fn validate(&self) -> Result<(), ModelServiceError> {
        let reserve = u64::from(self.max_output.unwrap_or(0))
            + u64::from(self.reasoning_reserve)
            + u64::from(self.safety_margin);
        if self.max_output == Some(0)
            || self.max_output.is_none()
                && (self.reasoning_reserve > 0
                    || self.mode == Some(ContextMode::Manual) && self.capacity.is_some())
            || reserve > 16_000_000
            || self.capacity.is_some_and(|capacity| {
                capacity == 0
                    || capacity > 16_000_000
                    || self.mode == Some(ContextMode::Manual) && reserve >= u64::from(capacity)
            })
            || self.input_target.is_some_and(|target| {
                target == 0
                    || target > 16_000_000
                    || self.mode == Some(ContextMode::Manual)
                        && self.capacity.is_some_and(|capacity| {
                            u64::from(target) + reserve > u64::from(capacity)
                        })
            })
        {
            return Err(ModelServiceError::InvalidConfig);
        }
        Ok(())
    }

    fn input_budget(&self) -> Option<u32> {
        if self.mode != Some(ContextMode::Manual) {
            return None;
        }
        let available = self
            .capacity
            .zip(self.max_output)
            .map(|(capacity, output)| {
                capacity - output - self.reasoning_reserve - self.safety_margin
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
    /// Portable token estimate for unknown encoders; never measured server usage.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference_estimated_tokens: Option<u32>,
    pub admission_estimate: u32,
    pub tokenizer: ContextTokenizer,
    pub capacity: Option<u32>,
    pub effective_input: Option<u32>,
    pub output_reserve: Option<u32>,
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
    let deepseek = super::provider::is_deepseek(&config.base_url);
    let messages = chat::wire_messages(messages, deepseek)?;
    let project_reading = matches!(
        kinds.first(),
        Some(Some(chat::ContextContentKind::ProjectPolicy))
    );
    let tools = match kinds.first().copied().flatten() {
        Some(chat::ContextContentKind::SummaryPolicy) => None,
        Some(chat::ContextContentKind::HandoffDraftPolicy) => Some(chat::handoff_draft_tools()),
        Some(
            kind @ (chat::ContextContentKind::HandoffPolicy | chat::ContextContentKind::EditPolicy),
        ) => Some(chat::task_tools(kind)),
        _ => Some(chat::document_tools(project_reading)),
    };
    let mut body = json!({"model":config.model,"messages":messages,"stream":true,"stream_options":{"include_usage":true}});
    if let Some(tools) = &tools {
        body["tools"] = tools.clone();
        body["tool_choice"] = json!("auto");
    }
    let output = context
        .max_output
        .map(|maximum| maximum + context.reasoning_reserve);
    if deepseek {
        body["thinking"] = json!({"type":"enabled"});
    }
    if let Some(output) = output {
        if context.reasoning_reserve > 0 && !deepseek {
            body["max_completion_tokens"] = json!(output);
        } else {
            body["max_tokens"] = json!(output);
        }
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
            values.extend(tools.iter().cloned());
        }
        for (index, message) in messages.iter().enumerate() {
            let role = message["role"].as_str().unwrap_or("");
            let category = if let Some(kind) = kinds[index] {
                match kind {
                    chat::ContextContentKind::ProjectPolicy
                    | chat::ContextContentKind::HandoffDraftPolicy
                    | chat::ContextContentKind::SummaryPolicy
                    | chat::ContextContentKind::HandoffPolicy
                    | chat::ContextContentKind::EditPolicy => "policyTools",
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
    // Token budgets are compared with token estimates. Applying another
    // multiplier here silently shrinks the configured working context and can
    // reject a normal project before its final candidate. The configured output
    // and safety reserves plus the independent byte bound remain in force.
    // No model name implies a matching provider tokenizer.
    let admission_estimate = estimated_tokens
        .or(reference_estimated_tokens)
        .unwrap_or(encoded.len() as u32);
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
