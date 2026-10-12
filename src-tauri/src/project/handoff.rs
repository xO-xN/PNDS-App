//! Source-project handoff format shared by creation and future project/module generators.
use super::creation::{CreationError, CreationErrorCode};
use serde::{Deserialize, Serialize};
use specta::Type;

pub const HANDOFF_PATH: &str = "docs/creator-handoff.md";
pub const HANDOFF_HEADER: &str = include_str!("../../resources/creator-handoff.md");
pub const AGENT_ENTRY: &str = include_str!("../../resources/creator-agent-entry.md");

pub fn initial_document() -> String {
    format!("{HANDOFF_HEADER}\n{AGENT_ENTRY}")
}

#[derive(Debug, Clone, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HandoffTask {
    pub id: String,
    pub intent: String,
    pub files: Vec<String>,
    pub acceptance: String,
    pub status: String,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HandoffDocument {
    pub text: String,
    pub version: Option<String>,
}

impl HandoffTask {
    pub fn marker(&self) -> String {
        format!("<!-- pnds-task:{} -->", self.id)
    }

    pub fn validate(&self) -> Result<(), CreationError> {
        let valid_id = self.id.len() == 36
            && self.id.bytes().enumerate().all(|(i, byte)| {
                if [8, 13, 18, 23].contains(&i) {
                    byte == b'-'
                } else {
                    byte.is_ascii_hexdigit()
                }
            });
        let valid_file = |path: &String| {
            !path.trim().is_empty()
                && !path.contains(['\r', '\n'])
                && std::path::Path::new(path)
                    .components()
                    .all(|part| matches!(part, std::path::Component::Normal(_)))
        };
        if !valid_id
            || self.intent.trim().is_empty()
            || self.acceptance.trim().is_empty()
            || self.files.is_empty()
            || self.files.len() > 128
            || !self.files.iter().all(valid_file)
            || !["pending", "in-progress", "blocked"].contains(&self.status.as_str())
        {
            return Err(CreationError::new(CreationErrorCode::InvalidProject, "Task requires an ID, intent, relative files, acceptance and a creator-supplied pending/in-progress/blocked status"));
        }
        Ok(())
    }
}

/** Append without parsing or rewriting old tasks, including unknown agent status/evidence. */
pub fn append_task(existing: &str, task: &HandoffTask) -> String {
    let marker = task.marker();
    let title = task.intent.lines().next().unwrap_or_default();
    let status = &task.status;
    let intent = &task.intent;
    let acceptance = &task.acceptance;
    let files = task
        .files
        .iter()
        .map(|file| format!("- {file}"))
        .collect::<Vec<_>>()
        .join("\n");
    let separator = if existing.ends_with('\n') {
        "\n"
    } else {
        "\n\n"
    };
    format!("{existing}{separator}{marker}\n## {title}\n\nStatus / 状态: {status}\n\n### Intent / 意图\n\n{intent}\n\n### Files / 涉及文件\n\n{files}\n\n### Acceptance / 验收条件\n\n{acceptance}\n")
}
