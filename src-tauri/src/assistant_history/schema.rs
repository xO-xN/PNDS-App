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
    Protocol,
    ToolsUnsupported,
    RateLimited,
    ServiceUnavailable,
    Cancelled,
    BudgetExceeded,
    ContextTokensExceeded,
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
#[derive(Clone, Copy, Serialize, Deserialize, Type)]
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
#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantHistoryMessage {
    pub id: String,
    pub role: AssistantHistoryRole,
    pub text: String,
    pub status: AssistantHistoryStatus,
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
    pub usage: Option<AssistantRoundUsage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_marker: Option<AssistantContextMarker>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_service_key: Option<String>,
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
    pub document_metrics: Option<AssistantDocumentMetrics>,
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantDocumentMetrics {
    pub returned_characters: u32,
    pub reused_characters: u32,
    pub result_characters: u32,
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
        if let Some(usage) = &message.usage {
            if usage.document_metrics.as_ref().is_some_and(|metrics| {
                metrics.returned_characters > 24000
                    || metrics.reused_characters > 24000
                    || metrics.result_characters > 24000
            }) {
                return Err(AssistantHistoryError::InvalidFormat);
            }
            if usage.calls.len() > 12
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
        if let Some(version) = &message.app_version {
            bounded(version, 64, false)?;
        }
        if message.sources.len() > 64 {
            return Err(AssistantHistoryError::TooLarge);
        }
        for source in &message.sources {
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
            bounded(&proposal.text, 64 * 1024, true)?;
            if let Some(diff) = &proposal.applied_diff {
                bounded(&diff.before, 64 * 1024, true)?;
                bounded(&diff.after, 64 * 1024, true)?;
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
