//! One bounded, cancellable authenticated request. Document execution remains
//! in the shared installed-corpus frontend flow; this layer exposes no I/O tools.
use super::{provider, stream, transport, CredentialStore, ModelService, ModelServiceError};
use crate::project::creation::{CreationAccess, CreationSource, Protection};
use crate::types::ModelServiceConfig;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specta::Type;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::watch;
use tokio::time::Instant;

const MAX_CONTEXT_BYTES: usize = 512 * 1024;
const MAX_TURNS: usize = 128;

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
    /// Internal provider replay data; never answer text or display activity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
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
    HandoffPolicy,
    HandoffDraftPolicy,
    SummaryPolicy,
    EditPolicy,
    MergePolicy,
    MergeReadPolicy,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
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
        let client = transport::client(None)?;
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
        // The frontend discards incomplete generations and bounds recovery.
        // Keep the captured native session for those two recoverable limits;
        // ownership/config checks and explicit cancellation still apply.
        if outcome.is_err()
            && !matches!(
                outcome,
                Err(ModelServiceError::ContextWindowExceeded | ModelServiceError::OutputTruncated)
            )
        {
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
    retain_reasoning: bool,
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
        if let Some(reasoning) = &message.reasoning_content {
            if message.role != AssistantMessageRole::Assistant {
                return Err(ModelServiceError::Protocol);
            }
            if reasoning.len() > provider::MAX_REASONING_BYTES {
                return Err(ModelServiceError::ResponseTooLarge);
            }
        }
        if retain_reasoning && message.role == AssistantMessageRole::Assistant {
            // Older display-only history has no reasoning. An empty protocol
            // value preserves compatibility without inventing missing thought.
            wire["reasoning_content"] = json!(message.reasoning_content.unwrap_or_default());
        }
        if let Some(calls) = message.tool_calls.filter(|calls| !calls.is_empty()) {
            wire["tool_calls"] = Value::Array(calls.into_iter().map(|call| json!({"id":call.id,"type":"function","function":{"name":call.name,"arguments":call.arguments}})).collect());
        }
        if let Some(id) = message.tool_call_id { wire["tool_call_id"] = json!(id); }
        Ok(wire)
    }).collect()
}

pub(super) fn parse_turn(message: Value) -> Result<AssistantModelTurn, ModelServiceError> {
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
    if text.as_ref().is_some_and(|text| text.len() > 64 * 1024) {
        return Err(ModelServiceError::ResponseTooLarge);
    }
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
        if call["function"]["arguments"]
            .as_str()
            .is_some_and(|args| args.len() > 256 * 1024)
        {
            return Err(ModelServiceError::ResponseTooLarge);
        }
        tool_calls.push(AssistantToolCall {
            id: field(&call["id"], 256)?,
            name: field(&call["function"]["name"], 128)?,
            arguments: field(&call["function"]["arguments"], 256 * 1024)?,
        });
    }
    if tool_calls.is_empty() && text.as_deref().is_none_or(|text| text.trim().is_empty()) {
        return Err(ModelServiceError::Protocol);
    }
    Ok(AssistantModelTurn {
        text,
        reasoning_content: provider::reasoning(&message)?,
        tool_calls,
        usage: super::usage::parse(&message["usage"]),
        measurement: None,
    })
}

// Shared with the frontend dispatcher. Tool descriptions, schemas and mode
// availability are authored once; native write authorization remains separate.
fn tools_for_mode(mode: &str) -> Value {
    static CONTRACTS: OnceLock<Value> = OnceLock::new();
    let manifest = CONTRACTS.get_or_init(|| {
        serde_json::from_str(include_str!("../../resources/assistant-tools.json"))
            .expect("installed assistant tool contracts")
    });
    Value::Array(
        manifest["tools"]
            .as_array()
            .expect("assistant tool array")
            .iter()
            .filter(|tool| {
                tool["modes"]
                    .as_array()
                    .is_some_and(|modes| modes.iter().any(|value| value == mode))
            })
            .map(|tool| {
                json!({"type":"function","function":{
                    "name":tool["name"],
                    "description":tool["description"],
                    "parameters":tool["schema"]
                }})
            })
            .collect(),
    )
}

pub(super) fn document_tools(project_reading: bool) -> Value {
    tools_for_mode(if project_reading {
        "legacy"
    } else {
        "platform"
    })
}

/// Explicit creation modes replace the legacy candidate-only wire tools.
pub(super) fn task_tools(mode: ContextContentKind) -> Value {
    tools_for_mode(if matches!(mode, ContextContentKind::EditPolicy) {
        "edit"
    } else {
        "discussion"
    })
}

pub(super) fn merge_tools(edit: bool) -> Value {
    static CONTRACTS: OnceLock<Value> = OnceLock::new();
    let manifest = CONTRACTS.get_or_init(|| {
        serde_json::from_str(include_str!("../../resources/merge-assistant-tools.json"))
            .expect("installed merge assistant tool contracts")
    });
    let mode = if edit { "edit" } else { "read" };
    Value::Array(
        manifest["tools"]
            .as_array()
            .expect("merge assistant tool array")
            .iter()
            .filter(|tool| {
                tool["modes"]
                    .as_array()
                    .is_some_and(|modes| modes.iter().any(|value| value == mode))
            })
            .map(|tool| {
                json!({"type":"function","function":{
                    "name":tool["name"],
                    "description":tool["description"],
                    "parameters":tool["schema"]
                }})
            })
            .collect(),
    )
}

pub(super) fn handoff_draft_tools() -> Value {
    Value::Array(
        task_tools(ContextContentKind::HandoffPolicy)
            .as_array()
            .expect("discussion tools")
            .iter()
            .filter(|tool| tool["function"]["name"] == "ask_question")
            .cloned()
            .collect(),
    )
}

#[cfg(test)]
mod tool_contract_tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn candidate_tools_never_expose_ordinary_project_or_runtime_authority() {
        let writable = merge_tools(true);
        let readonly = merge_tools(false);
        let names = |tools: &Value| {
            tools
                .as_array()
                .unwrap()
                .iter()
                .map(|tool| tool["function"]["name"].as_str().unwrap().to_owned())
                .collect::<HashSet<_>>()
        };
        let writable = names(&writable);
        let readonly = names(&readonly);
        assert!(writable.contains("write_merge_file"));
        assert!(writable.contains("run_merge_check"));
        assert!(!readonly.contains("write_merge_file"));
        assert!(!readonly.contains("delete_merge_file"));
        assert!(!readonly.contains("run_merge_check"));
        for tools in [&writable, &readonly] {
            assert!(tools.contains("read_merge_file"));
            assert!(!tools.contains("write_project_file"));
            assert!(!tools.contains("start_creation_project"));
            assert!(!tools.iter().any(|name| name.contains("adopt")
                || name.contains("shell")
                || name.contains("publish")));
        }
    }

    #[test]
    fn shared_contract_modes_and_wire_schemas_agree() {
        let manifest: Value =
            serde_json::from_str(include_str!("../../resources/assistant-tools.json")).unwrap();
        assert_eq!(manifest["version"], 1);
        let tools = manifest["tools"].as_array().unwrap();
        let mut names = HashSet::new();
        for tool in tools {
            assert!(names.insert(tool["name"].as_str().unwrap()));
            assert!(matches!(
                tool["handler"].as_str().unwrap(),
                "documents" | "project" | "materials" | "proposal" | "task"
            ));
            assert!(matches!(
                tool["effect"].as_str().unwrap(),
                "read" | "write" | "check" | "parameter"
            ));
            assert_eq!(tool["schema"]["additionalProperties"], false);
        }
        assert_eq!(tools.len(), 28);
        for mode in ["platform", "legacy", "discussion", "edit"] {
            let wire = tools_for_mode(mode);
            let selected: Vec<_> = tools
                .iter()
                .filter(|tool| tool["modes"].as_array().unwrap().iter().any(|m| m == mode))
                .collect();
            assert_eq!(wire.as_array().unwrap().len(), selected.len());
            for (published, contract) in wire.as_array().unwrap().iter().zip(selected) {
                assert_eq!(published["function"]["name"], contract["name"]);
                assert_eq!(published["function"]["parameters"], contract["schema"]);
                assert!(published["function"].get("handler").is_none());
            }
        }
    }

    #[test]
    fn mode_specific_write_and_parameter_contracts_remain_distinct() {
        let handoff = task_tools(ContextContentKind::HandoffPolicy);
        let edit = task_tools(ContextContentKind::EditPolicy);
        for mode in ["platform", "legacy", "discussion"] {
            assert!(!tools_for_mode(mode)
                .as_array()
                .unwrap()
                .iter()
                .any(|tool| tool["function"]["name"] == "complete_pending_integration"));
        }
        let find = |tools: &Value, name: &str| {
            tools
                .as_array()
                .unwrap()
                .iter()
                .find(|tool| tool["function"]["name"] == name)
                .unwrap()["function"]["parameters"]
                .clone()
        };
        assert!(!handoff
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["function"]["name"] == "write_handoff"));
        assert_eq!(
            find(&edit, "write_project_file")["properties"]["version"]["type"],
            "string"
        );
        assert_eq!(
            find(&edit, "create_project_file")["required"],
            json!(["path", "text"])
        );
        assert_eq!(
            find(&edit, "complete_pending_integration")["required"],
            json!(["sources", "targets", "checkTaskId"])
        );
        let legacy = document_tools(true);
        assert_eq!(
            find(&legacy, "propose_text_change")["properties"]["parameters"],
            find(&edit, "expose_project_parameters")["properties"]["parameters"]
        );
    }
}
