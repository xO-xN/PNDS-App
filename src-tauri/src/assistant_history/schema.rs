use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, Serialize, Type, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AssistantHistoryError {
    InvalidIdentity,
    Io,
    InvalidFormat,
    UnsupportedVersion,
    StaleHistory,
    TooLarge,
}

#[derive(Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AssistantHistoryRequestError {
    InvalidConfig,
    MissingCredential,
    CredentialStore,
    Authentication,
    Network,
    Timeout,
    RequestDeadline,
    Protocol,
    RequestRejected,
    OutputTruncated,
    ResponseInterrupted,
    ResponseTooLarge,
    ToolsUnsupported,
    RateLimited,
    ServiceUnavailable,
    Cancelled,
    BudgetExceeded,
    ContextTokensExceeded,
    ContextWindowExceeded,
    ContextBytesExceeded,
    ContextMessagesExceeded,
    ToolCallsExceeded,
    ToolCharactersExceeded,
    RequestBusy,
    InvalidIdentity,
    InvalidTool,
    NoProgress,
    CorpusUnavailable,
    NotConfigured,
    RequestFailed,
    InvalidSummary,
    ProjectReadingDisabled,
    ProjectScopeChanged,
    ProjectUnavailable,
    AttachmentExcluded,
    WholeProjectExceeded,
}

#[derive(Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssistantHistoryRole {
    User,
    Assistant,
}
#[derive(Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssistantHistoryStatus {
    Pending,
    Completed,
    Failed,
    Cancelled,
}
#[derive(Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssistantHistoryScope {
    Platform,
    Project,
}
#[derive(Clone, Copy, Serialize, Deserialize, Type)]
pub enum AssistantHistoryLocale {
    #[serde(rename = "en")]
    En,
    #[serde(rename = "zh-CN")]
    ZhCn,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum AssistantAttachmentSource {
    Saved,
    Draft,
    Proposal,
}
#[derive(Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssistantProposalPreview {
    None,
    Temporary,
    Stale,
    Historical,
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantHistorySource {
    pub doc_id: String,
    pub section_id: String,
    pub title: String,
    pub locale: AssistantHistoryLocale,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_offset: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_characters: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<AssistantSourceFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<crate::project::creation::AssistantProjectPage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material: Option<crate::project::creation::CreationMaterialPage>,
}

#[derive(Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AssistantSourceFormat {
    PlainText,
    Markdown,
}
#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantHistoryAttachment {
    pub id: String,
    pub project_key: String,
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub source: AssistantAttachmentSource,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_revision: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proposal_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_version: Option<String>,
    pub text: String,
}
#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantHistoryAppliedDiff {
    pub before: String,
    pub after: String,
}
#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantHistoryProposal {
    pub id: String,
    pub project_key: String,
    pub path: String,
    pub source_version: String,
    pub candidate_revision: u32,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub applied_diff: Option<AssistantHistoryAppliedDiff>,
    pub preview: AssistantProposalPreview,
    pub pending_refresh: bool,
}

/// A recorded handoff's display/copy snapshot. Task operations still require a
/// fresh native task/baseline lookup; this record carries no execution grant.
#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantHandoffSnapshot {
    pub task_id: String,
    pub revision: String,
    pub prompt: String,
}

/// Public discussion result only. Restoring it never recreates its live offer.
#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantDiscussionPlan {
    pub reason: String,
    pub intent: String,
    pub known_problems: String,
    pub acceptance: String,
    pub files: Vec<String>,
    pub plan: String,
}

/// Bounded display evidence from a completed Work task, never a restored grant.
#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantDeliveryEvidence {
    pub schema_version: u32,
    pub task_id: String,
    pub saved_paths: Vec<String>,
    pub static_check: AssistantEvidenceStage,
    pub build: AssistantEvidenceStage,
    pub runtime: AssistantEvidenceStage,
    pub behavior: AssistantEvidenceStage,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_tests: Option<AssistantEvidenceStage>,
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantEvidenceStage {
    pub status: AssistantEvidenceStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_version: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AssistantEvidenceStatus {
    Passed,
    Failed,
    Blocked,
    NotRun,
    NotRequired,
    Observed,
}

#[derive(Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AssistantSkillId {
    CheckUnusedFiles,
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantHistoryMessage {
    pub id: String,
    pub role: AssistantHistoryRole,
    pub text: String,
    /// Display only. Executable skill choice is captured separately by a new task.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill: Option<AssistantSkillId>,
    /// Private provider protocol data, excluded from rendering and summaries.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    pub status: AssistantHistoryStatus,
    /// Display-only tool-turn commentary, never execution authority or private reasoning.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity: Option<Vec<String>>,
    pub sources: Vec<AssistantHistorySource>,
    pub scope: AssistantHistoryScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<AssistantHistoryRequestError>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<AssistantHistoryAttachment>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proposals: Option<Vec<AssistantHistoryProposal>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handoff: Option<AssistantHandoffSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check_outcome: Option<AssistantDeliveryEvidence>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discussion_plan: Option<AssistantDiscussionPlan>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<AssistantRoundUsage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_marker: Option<AssistantContextMarker>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_service_key: Option<String>,
    /// Historical facts only; live answerability comes from the native task journal.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    #[specta(optional)]
    pub questions: Vec<crate::project::creation::AssistantQuestion>,
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantSummaryItem {
    pub text: String,
    pub source_ids: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantSummarySections {
    pub user_decisions: Vec<AssistantSummaryItem>,
    pub assistant_suggestions: Vec<AssistantSummaryItem>,
    pub verified_facts: Vec<AssistantSummaryItem>,
    pub unverified_facts: Vec<AssistantSummaryItem>,
    pub open_questions: Vec<AssistantSummaryItem>,
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum AssistantContextMarker {
    Topic,
    Summary {
        #[serde(rename = "sourceIds")]
        source_ids: Vec<String>,
        #[serde(rename = "serviceKey")]
        service_key: String,
        sections: AssistantSummarySections,
    },
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantRoundUsage {
    pub calls: Vec<Option<crate::model::ModelUsage>>,
    pub complete: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_calls: Option<AssistantPreviousCalls>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_metrics: Option<AssistantDocumentMetrics>,
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantPreviousCalls {
    #[specta(type = f64)]
    pub count: u64,
    #[specta(type = f64)]
    pub unknown: u64,
    pub usage: AssistantUsageTotals,
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantUsageTotals {
    #[specta(type = Option<f64>)]
    pub input_tokens: Option<u64>,
    #[specta(type = Option<f64>)]
    pub output_tokens: Option<u64>,
    #[specta(type = Option<f64>)]
    pub cached_input_tokens: Option<u64>,
    #[specta(type = Option<f64>)]
    pub reasoning_tokens: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantDocumentMetrics {
    #[specta(type = f64)]
    pub returned_characters: u64,
    #[specta(type = f64)]
    pub reused_characters: u64,
    #[specta(type = f64)]
    pub result_characters: u64,
}
#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantHistory {
    pub epoch: String,
    pub project_key: String,
    pub app_version: String,
    pub messages: Vec<AssistantHistoryMessage>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct HistoryFile {
    pub version: u32,
    pub epoch: String,
    pub project_key: String,
    pub app_version: String,
    pub messages: Vec<AssistantHistoryMessage>,
}

pub(super) fn bounded(value: &str, max: usize, empty: bool) -> Result<(), AssistantHistoryError> {
    if value.len() > max {
        return Err(AssistantHistoryError::TooLarge);
    }
    if !empty && value.is_empty() {
        return Err(AssistantHistoryError::InvalidFormat);
    }
    Ok(())
}
fn relative_path(path: &str) -> Result<(), AssistantHistoryError> {
    bounded(path, 1024, false)?;
    if path.contains(['\\', '\0']) || path.split('/').any(|part| matches!(part, "" | "." | "..")) {
        return Err(AssistantHistoryError::InvalidFormat);
    }
    Ok(())
}
pub(super) fn validate_messages(
    messages: &[AssistantHistoryMessage],
    project_key: &str,
) -> Result<(), AssistantHistoryError> {
    if messages.len() > 400 {
        return Err(AssistantHistoryError::TooLarge);
    }
    let mut ids = HashSet::new();
    for (index, message) in messages.iter().enumerate() {
        if message.skill.is_some()
            && (message.role != AssistantHistoryRole::User
                || message.scope != AssistantHistoryScope::Project
                || message.context_marker.is_some())
        {
            return Err(AssistantHistoryError::InvalidFormat);
        }
        if let Some(plan) = &message.discussion_plan {
            if message.role != AssistantHistoryRole::Assistant
                || message.status != AssistantHistoryStatus::Completed
                || message.scope != AssistantHistoryScope::Project
                || message.context_marker.is_some()
                || plan.plan != message.text
                || plan.plan.trim().is_empty()
                || plan.plan.encode_utf16().count() > 32768
                || plan.files.is_empty()
                || plan.files.len() > 128
            {
                return Err(AssistantHistoryError::InvalidFormat);
            }
            for field in [&plan.reason, &plan.intent, &plan.acceptance] {
                if field.trim().is_empty() || field.encode_utf16().count() > 8192 {
                    return Err(AssistantHistoryError::InvalidFormat);
                }
            }
            if plan.known_problems.encode_utf16().count() > 8192 {
                return Err(AssistantHistoryError::TooLarge);
            }
            for path in &plan.files {
                if path.is_empty()
                    || path.encode_utf16().count() > 1024
                    || path.contains('\\')
                    || path.chars().any(char::is_control)
                    || path.split('/').any(|part| matches!(part, "" | "." | ".."))
                {
                    return Err(AssistantHistoryError::InvalidFormat);
                }
            }
        }
        if let Some(evidence) = &message.check_outcome {
            if message.role != AssistantHistoryRole::Assistant
                || message.status != AssistantHistoryStatus::Completed
                || message.scope != AssistantHistoryScope::Project
                || message.context_marker.is_some()
                || evidence.schema_version != 1
                || !crate::project::creation::valid_assistant_task_id(&evidence.task_id)
            {
                return Err(AssistantHistoryError::InvalidFormat);
            }
            if evidence.saved_paths.len() > 256 {
                return Err(AssistantHistoryError::TooLarge);
            }
            let mut paths = HashSet::new();
            for path in &evidence.saved_paths {
                relative_path(path)?;
                if !paths.insert(path) {
                    return Err(AssistantHistoryError::InvalidFormat);
                }
            }
            for stage in [
                &evidence.static_check,
                &evidence.build,
                &evidence.runtime,
                &evidence.behavior,
            ]
            .into_iter()
            .chain(evidence.project_tests.iter())
            {
                if let Some(reason) = &stage.reason {
                    bounded(reason, 4096, false)?;
                }
                if let Some(version) = &stage.input_version {
                    bounded(version, 4096, false)?;
                }
            }
        }
        if let Some(handoff) = &message.handoff {
            let valid_task_id = handoff.task_id.len() == 36
                && handoff.task_id.bytes().enumerate().all(|(index, byte)| {
                    if [8, 13, 18, 23].contains(&index) {
                        byte == b'-'
                    } else {
                        byte.is_ascii_hexdigit()
                    }
                });
            if message.role != AssistantHistoryRole::Assistant
                || message.status != AssistantHistoryStatus::Completed
                || message.scope != AssistantHistoryScope::Project
                || message.context_marker.is_some()
                || !valid_task_id
                || handoff.revision.len() != 64
                || !handoff
                    .revision
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit())
            {
                return Err(AssistantHistoryError::InvalidFormat);
            }
            bounded(&handoff.prompt, 16 * 1024, false)?;
        }
        if let Some(key) = &message.context_service_key {
            bounded(key, 4096, false)?;
        }
        if let Some(marker) = &message.context_marker {
            if message.role != AssistantHistoryRole::Assistant
                || message.status != AssistantHistoryStatus::Completed
            {
                return Err(AssistantHistoryError::InvalidFormat);
            }
            if let AssistantContextMarker::Summary {
                source_ids,
                service_key,
                sections,
            } = marker
            {
                bounded(service_key, 4096, false)?;
                if source_ids.is_empty()
                    || source_ids.len() > 400
                    || source_ids.iter().collect::<HashSet<_>>().len() != source_ids.len()
                {
                    return Err(AssistantHistoryError::InvalidFormat);
                }
                for id in source_ids {
                    let source = messages[..index]
                        .iter()
                        .find(|source| &source.id == id)
                        .ok_or(AssistantHistoryError::InvalidFormat)?;
                    if source.context_marker.is_some()
                        || source.status != AssistantHistoryStatus::Completed
                        || (message.scope == AssistantHistoryScope::Platform
                            && (source.scope != AssistantHistoryScope::Platform
                                || source.context_service_key.as_ref() != Some(service_key)
                                || source
                                    .attachments
                                    .as_ref()
                                    .is_some_and(|items| !items.is_empty())
                                || source
                                    .proposals
                                    .as_ref()
                                    .is_some_and(|items| !items.is_empty())))
                    {
                        return Err(AssistantHistoryError::InvalidFormat);
                    }
                }
                for items in [
                    &sections.user_decisions,
                    &sections.assistant_suggestions,
                    &sections.verified_facts,
                    &sections.unverified_facts,
                    &sections.open_questions,
                ] {
                    if items.len() > 32 {
                        return Err(AssistantHistoryError::TooLarge);
                    }
                    for item in items {
                        bounded(&item.text, 4096, false)?;
                        if item.source_ids.is_empty()
                            || item.source_ids.len() > 32
                            || item.source_ids.iter().any(|id| !source_ids.contains(id))
                        {
                            return Err(AssistantHistoryError::InvalidFormat);
                        }
                    }
                }
            }
        }
        if !message.questions.is_empty() {
            if message.questions.len() > 64 {
                return Err(AssistantHistoryError::TooLarge);
            }
            if message.role != AssistantHistoryRole::Assistant
                || message.scope != AssistantHistoryScope::Project
                || message.context_marker.is_some()
            {
                return Err(AssistantHistoryError::InvalidFormat);
            }
            let mut question_ids = HashSet::new();
            let mut pending_tasks = HashSet::new();
            for question in &message.questions {
                question
                    .validate()
                    .map_err(|_| AssistantHistoryError::InvalidFormat)?;
                if !question_ids.insert(&question.id)
                    || (question.status
                        == crate::project::creation::AssistantQuestionStatus::Pending
                        && !pending_tasks.insert(&question.task_id))
                {
                    return Err(AssistantHistoryError::InvalidFormat);
                }
            }
        }
        if let Some(usage) = &message.usage {
            const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
            if usage.document_metrics.as_ref().is_some_and(|metrics| {
                metrics.returned_characters > MAX_SAFE_INTEGER
                    || metrics.reused_characters > MAX_SAFE_INTEGER
                    || metrics.result_characters > MAX_SAFE_INTEGER
            }) {
                return Err(AssistantHistoryError::InvalidFormat);
            }
            if usage.previous_calls.as_ref().is_some_and(|previous| {
                previous.count == 0
                    || previous.count > MAX_SAFE_INTEGER - usage.calls.len() as u64
                    || previous.unknown > previous.count
                    || (previous.unknown == 0
                        && (previous.usage.input_tokens.is_none()
                            || previous.usage.output_tokens.is_none()))
                    || (previous.unknown > 0
                        && previous.usage.input_tokens.is_some()
                        && previous.usage.output_tokens.is_some())
                    || [
                        previous.usage.input_tokens,
                        previous.usage.output_tokens,
                        previous.usage.cached_input_tokens,
                        previous.usage.reasoning_tokens,
                    ]
                    .into_iter()
                    .flatten()
                    .any(|count| count > MAX_SAFE_INTEGER)
                    || (usage.complete && previous.unknown > 0)
            }) {
                return Err(AssistantHistoryError::InvalidFormat);
            }
            if usage.calls.len() > 128
                || (usage.complete
                    && usage.calls.iter().any(|call| {
                        call.as_ref().is_none_or(|call| {
                            call.input_tokens.is_none() || call.output_tokens.is_none()
                        })
                    }))
            {
                return Err(AssistantHistoryError::InvalidFormat);
            }
            for call in usage.calls.iter().flatten() {
                if [
                    call.input_tokens,
                    call.output_tokens,
                    call.cached_input_tokens,
                    call.reasoning_tokens,
                ]
                .into_iter()
                .flatten()
                .any(|count| count > 1_000_000_000)
                {
                    return Err(AssistantHistoryError::InvalidFormat);
                }
            }
        }
        bounded(&message.id, 256, false)?;
        if !ids.insert(&message.id) {
            return Err(AssistantHistoryError::InvalidFormat);
        }
        bounded(&message.text, 64 * 1024, true)?;
        if let Some(reasoning) = &message.reasoning_content {
            if message.role != AssistantHistoryRole::Assistant || message.context_marker.is_some() {
                return Err(AssistantHistoryError::InvalidFormat);
            }
            bounded(reasoning, crate::model::MAX_REASONING_BYTES, true)?;
        }
        if let Some(activity) = &message.activity {
            if message.role != AssistantHistoryRole::Assistant || activity.len() > 128 {
                return Err(AssistantHistoryError::InvalidFormat);
            }
            if activity.iter().map(String::len).sum::<usize>() > 64 * 1024 {
                return Err(AssistantHistoryError::TooLarge);
            }
            for entry in activity {
                bounded(entry, 64 * 1024, true)?;
            }
        }
        if let Some(version) = &message.app_version {
            bounded(version, 64, false)?;
        }
        if message.sources.len() > 256 {
            return Err(AssistantHistoryError::TooLarge);
        }
        for source in &message.sources {
            if let Some(page) = &source.material {
                let material = &page.material;
                if source.project.is_some()
                    || message.scope != AssistantHistoryScope::Project
                    || material.id.len() != 32
                    || !material.id.bytes().all(|byte| byte.is_ascii_hexdigit())
                    || material.version.len() != 64
                    || !material
                        .version
                        .bytes()
                        .all(|byte| byte.is_ascii_hexdigit())
                    || material.name.is_empty()
                    || material.name.len() > 255
                    || material
                        .name
                        .chars()
                        .any(|character| character.is_control() || matches!(character, '/' | '\\'))
                    || material.size > 1024 * 1024
                    || material.total_characters > material.size
                    || source.doc_id != material.id
                    || source.version.as_ref() != Some(&material.version)
                    || source.offset != Some(page.offset)
                    || source.end_offset != Some(page.end_offset)
                    || source.total_characters != Some(page.total_characters)
                    || page.offset > page.end_offset
                    || page.end_offset > page.total_characters
                    || page.total_characters != material.total_characters
                    || page.text.encode_utf16().count() != (page.end_offset - page.offset) as usize
                    || page.text.len() > 256 * 1024
                    || page.start_line == 0
                    || page.end_line < page.start_line
                    || page.next_offset
                        != (page.end_offset < page.total_characters).then_some(page.end_offset)
                {
                    return Err(AssistantHistoryError::InvalidFormat);
                }
            }
            if let Some(page) = &source.project {
                relative_path(&page.path)?;
                bounded(&page.version, 128, false)?;
                bounded(&page.text, 256 * 1024, true)?;
                if message.scope != AssistantHistoryScope::Project
                    || page.offset > page.end_offset
                    || page.end_offset > page.total_characters
                    || page.start_line == 0
                    || page.end_line < page.start_line
                {
                    return Err(AssistantHistoryError::InvalidFormat);
                }
            }
            bounded(&source.doc_id, 1024, false)?;
            bounded(&source.section_id, 256, false)?;
            bounded(&source.title, 1024, false)?;
            if let Some(version) = &source.version {
                bounded(version, 128, false)?;
            }
            match (source.offset, source.end_offset, source.total_characters) {
                (None, None, None) => {}
                (Some(start), Some(end), Some(total)) if start <= end && end <= total => {}
                _ => return Err(AssistantHistoryError::InvalidFormat),
            }
        }
        let attachments = message.attachments.as_deref().unwrap_or_default();
        let proposals = message.proposals.as_deref().unwrap_or_default();
        if attachments.len() > 8 || proposals.len() > 8 {
            return Err(AssistantHistoryError::TooLarge);
        }
        if (!attachments.is_empty() || !proposals.is_empty())
            && message.scope != AssistantHistoryScope::Project
        {
            return Err(AssistantHistoryError::InvalidFormat);
        }
        let mut attachment_ids = HashSet::new();
        for attachment in attachments {
            if let Some(id) = &attachment.proposal_id {
                bounded(id, 256, false)?;
            }
            if let Some(version) = &attachment.source_version {
                bounded(version, 512, false)?;
            }
            bounded(&attachment.id, 256, false)?;
            if !attachment_ids.insert(&attachment.id)
                || attachment.project_key != project_key
                || attachment.start_line == 0
                || attachment.end_line < attachment.start_line
                || attachment.end_line > 1_000_000
            {
                return Err(AssistantHistoryError::InvalidFormat);
            }
            relative_path(&attachment.path)?;
            bounded(&attachment.version, 512, false)?;
            bounded(&attachment.text, 64 * 1024, true)?;
        }
        let mut proposal_ids = HashSet::new();
        for proposal in proposals {
            bounded(&proposal.id, 256, false)?;
            if !proposal_ids.insert(&proposal.id) || proposal.project_key != project_key {
                return Err(AssistantHistoryError::InvalidFormat);
            }
            relative_path(&proposal.path)?;
            bounded(&proposal.source_version, 512, false)?;
            bounded(&proposal.text, 1024 * 1024, true)?;
            if let Some(diff) = &proposal.applied_diff {
                bounded(&diff.before, 1024 * 1024, true)?;
                bounded(&diff.after, 1024 * 1024, true)?;
            }
        }
    }
    Ok(())
}

pub(super) fn restore(mut history: AssistantHistory) -> AssistantHistory {
    for message in &mut history.messages {
        if message.status == AssistantHistoryStatus::Pending {
            message.status = AssistantHistoryStatus::Cancelled;
            message.error = Some(AssistantHistoryRequestError::Cancelled);
            if let Some(usage) = &mut message.usage {
                usage.complete = false;
            }
        }
        if let Some(proposals) = &mut message.proposals {
            for proposal in proposals {
                proposal.preview = AssistantProposalPreview::Historical;
            }
        }
    }
    history
}
