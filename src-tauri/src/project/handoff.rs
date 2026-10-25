//! Source-project handoff format shared by creation and future project/module generators.
use super::creation::{CreationError, CreationErrorCode};
use serde::{Deserialize, Serialize};
use specta::Type;

pub const HANDOFF_PATH: &str = "docs/creator-handoff.md";
pub const HANDOFF_HEADER: &str = include_str!("../../resources/creator-handoff.md");
pub const AGENT_ENTRY: &str = include_str!("../../resources/creator-agent-entry.md");
pub const HANDOFF_SKILL: &str = include_str!("../../resources/skills/pnds-handoff/SKILL.md");

pub fn handoff_instructions() -> &'static str {
    HANDOFF_SKILL
        .split_once("\n---\n")
        .expect("bundled handoff skill has YAML frontmatter")
        .1
        .trim()
}

pub fn initial_document() -> String {
    HANDOFF_HEADER.to_owned()
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

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HandoffDocument {
    pub text: String,
    pub version: Option<String>,
}

impl HandoffTask {
    pub fn revision(&self) -> String {
        use sha2::{Digest, Sha256};
        let bytes = serde_json::to_vec(self).expect("task serializes");
        format!("{:x}", Sha256::digest(bytes))
    }

    pub fn revision_marker(&self) -> String {
        let id = &self.id;
        let revision = self.revision();
        format!("<!-- pnds-task-revision:{id}:{revision} -->")
    }

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
            || self.intent.len() > 16_384
            || self.acceptance.len() > 32_768
            || self.files.iter().any(|path| path.len() > 1024)
            || !self.files.iter().all(valid_file)
            || [&self.intent, &self.acceptance].iter().any(|text| {
                text.lines().any(|line| {
                    line.trim_start().starts_with("<!-- pnds-task:")
                        || line.trim_start().starts_with("<!-- pnds-task-revision:")
                        || line.trim_start().starts_with("<!-- pnds-task-end:")
                })
            })
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
    let first_line = task.intent.lines().next().unwrap_or_default();
    let title = if first_line.chars().count() > 80 {
        let prefix: String = first_line.chars().take(79).collect();
        format!("{prefix}…")
    } else {
        first_line.into()
    };
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
    format!("{existing}{separator}{marker}\n## {title}\n\nStatus: {status}\n\n### Intent\n\n{intent}\n\n### Files\n\n{files}\n\n### Acceptance\n\n{acceptance}\n")
}

/// Reviewed tasks are bounded so correcting one never consumes unrelated or
/// unknown text. Old reviewed blocks end at their existing revision marker.
pub fn plan_task(existing: &str, task: &HandoffTask) -> Result<(String, bool), CreationError> {
    task.validate()?;
    let revision = task.revision_marker();
    let marker = task.marker();
    let end_marker = format!("<!-- pnds-task-end:{} -->", task.id);
    let revision_prefix = format!("<!-- pnds-task-revision:{}:", task.id);
    let lines: Vec<_> = existing.split_inclusive('\n').collect();
    let mut ranges = Vec::new();
    let mut start = None;
    let mut offset = 0;
    for (index, line) in lines.iter().enumerate() {
        let content = line.trim_end_matches(['\r', '\n']);
        if content == marker {
            if start.is_some() {
                return Err(unbounded_task());
            }
            start = Some(offset);
        } else if let Some(begin) = start {
            let revision_end = content
                .strip_prefix(&revision_prefix)
                .and_then(|rest| rest.strip_suffix(" -->"))
                .is_some_and(|hash| {
                    hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
                });
            if content == end_marker || revision_end {
                let next_end = revision_end
                    && lines
                        .get(index + 1)
                        .is_some_and(|line| line.trim_end_matches(['\r', '\n']) == end_marker);
                ranges.push(
                    begin..offset + line.len() + if next_end { lines[index + 1].len() } else { 0 },
                );
                start = None;
            } else if content.starts_with("<!-- pnds-task:") {
                return Err(unbounded_task());
            }
        }
        offset += line.len();
    }
    if start.is_some() {
        return Err(unbounded_task());
    }
    let replaced = !ranges.is_empty();
    let mut base = String::new();
    let mut copied = 0;
    for range in ranges {
        base.push_str(&existing[copied..range.start]);
        copied = range.end;
    }
    base.push_str(&existing[copied..]);
    let base = if replaced {
        base.trim_end_matches(['\r', '\n'])
    } else {
        &base
    };
    let text = append_task(base, task);
    Ok((format!("{text}{revision}\n{end_marker}\n"), replaced))
}

fn unbounded_task() -> CreationError {
    CreationError::new(
        CreationErrorCode::VersionConflict,
        "This legacy task has no safe end marker. Review and edit the existing handoff content before replacing it.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_task_uses_single_language_labels_and_preserves_legacy_content() {
        let previous =
            "# Creation handoff\n\nStatus / 状态: blocked\nExternal evidence: keep verbatim.\n";
        let task = HandoffTask {
            id: "701a5180-a2dd-47dc-9319-9312f3790f64".into(),
            intent: "保持固定色彩基频\n\nBubble 的滑音范围由已确认方案规定。".into(),
            files: vec!["audio/controller.js".into()],
            acceptance: "记录实际检查和未验证的听感。".into(),
            status: "pending".into(),
        };
        let (document, replaced) = plan_task(previous, &task).unwrap();
        assert!(!replaced);
        assert!(document.starts_with(previous));
        let appended = &document[previous.len()..];
        assert!(appended.contains("## 保持固定色彩基频\n"));
        assert!(appended.contains("Status: pending\n"));
        assert!(appended.contains("### Intent\n"));
        assert!(appended.contains("### Files\n"));
        assert!(appended.contains("### Acceptance\n"));
        assert!(!appended.contains(" / "));
        assert!(appended.contains(&task.intent));
        assert!(appended.contains(&task.acceptance));
        assert!(appended.contains(&task.revision_marker()));
    }
}
