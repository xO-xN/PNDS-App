//! One bounded, cancellable authenticated request. Document execution remains
//! in the shared installed-corpus frontend flow; this layer exposes no I/O tools.
use super::{stream, transport, CredentialStore, ModelService, ModelServiceError};
use crate::project::creation::{CreationAccess, CreationSource, Protection};
use crate::types::ModelServiceConfig;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specta::Type;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::sync::watch;
use tokio::time::Instant;

const MAX_CONTEXT_BYTES: usize = 128 * 1024;
const MAX_TURNS: usize = 12;
const MAX_REQUEST_DURATION: Duration = Duration::from_secs(120);

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssistantMessageRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantModelMessage {
    pub role: AssistantMessageRole,
    pub content: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<Vec<AssistantToolCall>>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_kind: Option<ContextContentKind>,
}

#[derive(Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ContextContentKind {
    ProjectPolicy,
    History,
    Input,
    Documents,
    Summary,
    ProjectOverview,
    ProjectFragment,
    Attachment,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantModelTurn {
    pub text: Option<String>,
    pub tool_calls: Vec<AssistantToolCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<super::ModelUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measurement: Option<super::ContextMeasurement>,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantRequestSnapshot {
    pub request_id: String,
    pub model: String,
    pub base_url: String,
    pub config: ModelServiceConfig,
}

struct AssistantSession {
    id: String,
    identity: String,
    config: ModelServiceConfig,
    key: OnceLock<String>,
    client: reqwest::Client,
    cancel: watch::Sender<bool>,
    deadline: Instant,
    busy: AtomicBool,
    turns: AtomicUsize,
}

#[derive(Default)]
struct RequestState {
    revision: u64,
    // Caller-generated UUIDs are single-use. A small recent-token ledger also
    // handles a stop IPC arriving before its begin IPC reserves the session.
    recent_ids: VecDeque<String>,
    active: Option<Arc<AssistantSession>>,
}

#[derive(Default)]
pub(super) struct AssistantRequests(Mutex<RequestState>);

impl AssistantRequests {
    fn remember(state: &mut RequestState, request_id: &str) {
        if state.recent_ids.iter().any(|id| id == request_id) {
            return;
        }
        if state.recent_ids.len() == 256 {
            state.recent_ids.pop_front();
        }
        state.recent_ids.push_back(request_id.to_owned());
    }

    pub(super) fn invalidate(&self) {
        let mut state = self.0.lock().unwrap_or_else(|error| error.into_inner());
        state.revision += 1;
        if let Some(session) = state.active.take() {
            session.cancel.send_replace(true);
        }
    }
}

struct TurnGuard(Arc<AssistantSession>);
impl Drop for TurnGuard {
    fn drop(&mut self) {
        self.0.busy.store(false, Ordering::Release);
    }
}

impl<S: CredentialStore + Clone + 'static> ModelService<S> {
    pub fn assistant_revision(&self) -> u64 {
        self.assistant
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .revision
    }

    pub fn invalidate_assistant(&self) {
        self.assistant.invalidate();
    }

    pub fn cancel_assistant(&self, request_id: &str) {
        if !valid_request_id(request_id) {
            return;
        }
        let mut state = self
            .assistant
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        AssistantRequests::remember(&mut state, request_id);
        if state
            .active
            .as_ref()
            .is_some_and(|session| session.id == request_id)
        {
            if let Some(session) = state.active.take() {
                session.cancel.send_replace(true);
            }
        }
    }

    pub fn cancel_assistant_owner(&self, identity: &str) {
        let mut state = self
            .assistant
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if state
            .active
            .as_ref()
            .is_some_and(|session| session.identity == identity)
        {
            if let Some(session) = state.active.take() {
                session.cancel.send_replace(true);
            }
        }
    }

    fn assistant_session(
        &self,
        request_id: &str,
    ) -> Result<Arc<AssistantSession>, ModelServiceError> {
        self.assistant
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .active
            .as_ref()
            .filter(|session| session.id == request_id && !*session.cancel.borrow())
            .cloned()
            .ok_or(ModelServiceError::Cancelled)
    }

    pub fn assistant_identity(&self, request_id: &str) -> Result<String, ModelServiceError> {
        Ok(self.assistant_session(request_id)?.identity.clone())
    }

    pub async fn begin_assistant(
        &self,
        identity: String,
        request_id: String,
        config: ModelServiceConfig,
        expected_revision: u64,
    ) -> Result<AssistantRequestSnapshot, ModelServiceError> {
        if !valid_request_id(&request_id) {
            return Err(ModelServiceError::Protocol);
        }
        transport::validate_config(&config)?;
        let client = transport::client(MAX_REQUEST_DURATION)?;
        let session = {
            let mut state = self
                .assistant
                .0
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if state.revision != expected_revision {
                return Err(ModelServiceError::Cancelled);
            }
            if state.active.is_some() {
                return Err(ModelServiceError::RequestBusy);
            }
            if state.recent_ids.contains(&request_id) {
                return Err(ModelServiceError::Cancelled);
            }
            AssistantRequests::remember(&mut state, &request_id);
            let (cancel, _) = watch::channel(false);
            let session = Arc::new(AssistantSession {
                id: request_id,
                identity,
                config,
                client,
                key: OnceLock::new(),
                cancel,
                deadline: Instant::now() + MAX_REQUEST_DURATION,
                busy: AtomicBool::new(false),
                turns: AtomicUsize::new(0),
            });
            state.active = Some(session.clone());
            session
        };
        let mut cancelled = session.cancel.subscribe();
        self.assistant_session(&session.id)?;
        let key = tokio::select! {
            biased;
            _ = cancelled.changed() => Err(ModelServiceError::Cancelled),
            result = self.with_credentials(|store| store.read()) => result.and_then(|key| key.ok_or(ModelServiceError::MissingCredential)),
            _ = tokio::time::sleep_until(session.deadline) => Err(ModelServiceError::Timeout),
        };
        let outcome = key.and_then(|key| {
            super::validate_key(&key)?;
            self.assistant_session(&session.id)?;
            let _ = session.key.set(key);
            Ok(AssistantRequestSnapshot {
                request_id: session.id.clone(),
                model: session.config.model.clone(),
                base_url: session.config.base_url.clone(),
                config: session.config.clone(),
            })
        });
        if outcome.is_err() {
            self.cancel_assistant(&session.id);
        }
        outcome
    }

    pub async fn assistant_turn(
        &self,
        request_id: &str,
        messages: Vec<AssistantModelMessage>,
        mut on_text: impl FnMut(&str) + Send,
    ) -> Result<AssistantModelTurn, ModelServiceError> {
        let session = self.assistant_session(request_id)?;
        if session.busy.swap(true, Ordering::AcqRel) {
            return Err(ModelServiceError::RequestBusy);
        }
        let _guard = TurnGuard(session.clone());
        if session.turns.fetch_add(1, Ordering::AcqRel) >= MAX_TURNS {
            self.cancel_assistant(request_id);
            return Err(ModelServiceError::BudgetExceeded);
        }
        let (body, measurement) = super::context::assemble(&session.config, messages)
            .inspect_err(|_| self.cancel_assistant(request_id))?;
        if let Some(limit) = measurement.exceeded {
            self.cancel_assistant(request_id);
            return Err(if limit == "contextBytes" {
                ModelServiceError::ContextBytesExceeded
            } else {
                ModelServiceError::ContextTokensExceeded
            });
        }
        let key = session.key.get().ok_or(ModelServiceError::RequestBusy)?;
        let endpoint = format!(
            "{}/chat/completions",
            session.config.base_url.trim_end_matches('/')
        );
        let mut cancelled = session.cancel.subscribe();
        // subscribe before validating ownership so cancellation cannot fall
        // between the check and the receiver's observed version.
        self.assistant_session(request_id)?;
        let started = Instant::now();
        let turn_number = session.turns.load(Ordering::Acquire);
        log::info!("[assistant-request] turn={turn_number} started");
        let outcome = tokio::select! {
            biased;
            _ = cancelled.changed() => Err(ModelServiceError::Cancelled),
            _ = tokio::time::sleep_until(session.deadline) => Err(ModelServiceError::Timeout),
            result = stream::request(&session.client, &endpoint, key, body, |text| {
                if self.assistant_session(request_id).is_ok() {
                    on_text(text);
                }
            }) => result.and_then(parse_turn),
        };
        let elapsed_ms = started.elapsed().as_millis();
        match &outcome {
            Ok(_) => log::info!("[assistant-request] turn={turn_number} completed elapsed_ms={elapsed_ms}"),
            Err(error) => log::warn!("[assistant-request] turn={turn_number} failed elapsed_ms={elapsed_ms} error={error:?}"),
        }
        self.assistant_session(request_id)?;
        if outcome.is_err() {
            self.cancel_assistant(request_id);
        }
        outcome.map(|mut turn| {
            turn.measurement = Some(measurement);
            turn
        })
    }
}

/// Reuse the creation capability's inode/source validation; chat accepts no
/// caller-provided root or source flag and opens no project file content.
pub fn validate_assistant_owner(
    access: &CreationAccess,
    identity: &str,
    protection: &Protection,
) -> Result<(), ModelServiceError> {
    let project = access
        .descriptor(identity, protection)
        .map_err(|_| ModelServiceError::InvalidIdentity)?;
    if project.source != CreationSource::Folder {
        return Err(ModelServiceError::InvalidIdentity);
    }
    Ok(())
}

fn valid_request_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub(super) fn wire_messages(
    messages: Vec<AssistantModelMessage>,
) -> Result<Vec<Value>, ModelServiceError> {
    if messages.is_empty() || messages.len() > 128 {
        return Err(ModelServiceError::ContextMessagesExceeded);
    }
    if serde_json::to_vec(&messages)
        .map_err(|_| ModelServiceError::Protocol)?
        .len()
        > MAX_CONTEXT_BYTES
    {
        return Err(ModelServiceError::ContextBytesExceeded);
    }
    messages.into_iter().map(|message| {
        let has_calls = message.tool_calls.as_ref().is_some_and(|calls| !calls.is_empty());
        if (has_calls && message.role != AssistantMessageRole::Assistant)
            || (message.tool_call_id.is_some() && message.role != AssistantMessageRole::Tool)
            || (message.role == AssistantMessageRole::Tool && message.tool_call_id.as_deref().is_none_or(str::is_empty))
            || (message.content.as_deref().is_none_or(str::is_empty) && !has_calls)
        { return Err(ModelServiceError::Protocol); }
        let mut wire = json!({"role":message.role,"content":message.content});
        if let Some(calls) = message.tool_calls.filter(|calls| !calls.is_empty()) {
            wire["tool_calls"] = Value::Array(calls.into_iter().map(|call| json!({"id":call.id,"type":"function","function":{"name":call.name,"arguments":call.arguments}})).collect());
        }
        if let Some(id) = message.tool_call_id { wire["tool_call_id"] = json!(id); }
        Ok(wire)
    }).collect()
}

fn parse_turn(message: Value) -> Result<AssistantModelTurn, ModelServiceError> {
    let text = match message.get("content") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => Some(text.clone()),
        _ => return Err(ModelServiceError::Protocol),
    };
    let calls = match message.get("tool_calls") {
        None | Some(Value::Null) => &[][..],
        Some(Value::Array(calls)) if calls.len() <= 8 => calls.as_slice(),
        _ => return Err(ModelServiceError::Protocol),
    };
    let mut tool_calls = Vec::new();
    for call in calls {
        if call["type"] != "function" {
            return Err(ModelServiceError::Protocol);
        }
        let field = |value: &Value, max| {
            value
                .as_str()
                .filter(|s| !s.is_empty() && s.len() <= max)
                .map(str::to_owned)
                .ok_or(ModelServiceError::Protocol)
        };
        tool_calls.push(AssistantToolCall {
            id: field(&call["id"], 256)?,
            name: field(&call["function"]["name"], 128)?,
            arguments: field(&call["function"]["arguments"], 8192)?,
        });
    }
    if tool_calls.is_empty() && text.as_deref().is_none_or(|text| text.trim().is_empty()) {
        return Err(ModelServiceError::Protocol);
    }
    Ok(AssistantModelTurn {
        text,
        tool_calls,
        usage: super::usage::parse(&message["usage"]),
        measurement: None,
    })
}

pub(super) fn document_tools(project_reading: bool) -> Value {
    let mut tools = json!([
        {"type":"function","function":{"name":"search_help","description":"Search installed PNDS help sections. No project content is available.","parameters":{"type":"object","properties":{"query":{"type":"string","maxLength":256}},"required":["query"],"additionalProperties":false}}},
        {"type":"function","function":{"name":"read_help_section","description":"Read a short page of an installed PNDS help section. Default 1200 UTF-16 units, maximum 2000. Only segments are new evidence; reusedRanges reference previous tool results without duplicating text. Follow nextOffset only when needed. Unreturned ranges remain unread.","parameters":{"type":"object","properties":{"docId":{"type":"string"},"sectionId":{"type":"string"},"offset":{"type":"integer","minimum":0},"pageLength":{"type":"integer","minimum":64,"maximum":2000}},"required":["docId","sectionId"],"additionalProperties":false}}}
    ]);
    if project_reading {
        tools.as_array_mut().expect("array").extend([
            json!({"type":"function","function":{"name":"list_project_files","description":"List the confirmed saved-text scope and exclusions. Inventory is not evidence of having read file content.","parameters":{"type":"object","properties":{},"additionalProperties":false}}}),
            json!({"type":"function","function":{"name":"search_project_text","description":"Search allowed saved project text, at most 64 files and 6 short hits per call. remainingFiles are not searched. Never read drafts.","parameters":{"type":"object","properties":{"query":{"type":"string","maxLength":256}},"required":["query"],"additionalProperties":false}}}),
            json!({"type":"function","function":{"name":"read_project_text","description":"Read a saved-text page in the confirmed project. UTF-16 offset, pageLength 64–2000 (default 1200). Supply returned version for subsequent pages; changed versions must be re-read. Unreturned ranges are unread.","parameters":{"type":"object","properties":{"path":{"type":"string"},"version":{"type":"string"},"offset":{"type":"integer","minimum":0},"pageLength":{"type":"integer","minimum":64,"maximum":2000}},"required":["path"],"additionalProperties":false}}}),
            json!({"type":"function","function":{
                "name":"propose_text_change",
                "description":"Offer one pending change to one existing fully read saved text at its actual version. No write, execution or preview. Clarify ambiguous intent first. Return the complete candidate. Use a few accurately located JSON primitive whole-line controls only when relevant, or parameters:[] for code. Copy project limits/capabilities exactly from pnds.preview.json; undeclared controls require empty limits and unsupported preview. New/delete/rename/multi-file or complex adaptation requires confirmed external handoff; never split a cross-file task into this tool.",
                "parameters":{"type":"object","properties":{
                    "path":{"type":"string"},"version":{"type":"string"},"text":{"type":"string"},
                    "parameters":{"type":"array","maxItems":16,"items":{"type":"object","properties":{
                        "spec":{"type":"object","properties":{
                            "id":{"type":"string"},"path":{"type":"string"},"prefix":{"type":"string"},"suffix":{"type":"string"},
                            "kind":{"enum":["number","boolean","text","color","option"]},
                            "preview":{"enum":["live","refresh","restart","unsupported"]},
                            "limits":{"type":"object","properties":{"min":{"type":"number"},"max":{"type":"number"},"step":{"type":"number"},"options":{"type":"array","items":{"type":"string"}},"maxLength":{"type":"integer","minimum":0}},"additionalProperties":false}
                        },"required":["id","path","prefix","suffix","kind","preview","limits"],"additionalProperties":false},
                        "current":{"type":["number","boolean","string"]},"suggestedMin":{"type":"number"},"suggestedMax":{"type":"number"}
                    },"required":["spec","current"],"additionalProperties":false}}
                },"required":["path","version","text","parameters"],"additionalProperties":false}
            }})
        ]);
    }
    tools
}
