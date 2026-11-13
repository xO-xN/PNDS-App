//! Frozen material conflicts consume only their own scoped, explicit creator choice.
use super::*;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantMaterialAdoption {
    pub id: String,
    pub version: String,
    pub path: String,
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantMaterialConflictFacts {
    pub material_id: String,
    pub material_version: String,
    pub path: String,
    pub target_version: String,
    pub candidate_sha256: String,
    pub coexist_path: String,
    pub saved_excerpt: String,
    pub candidate_excerpt: String,
    pub first_changed_line: u32,
    pub truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub supersedes_question_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantMaterialReceipt {
    pub question_id: String,
    pub material_id: String,
    pub material_version: String,
    pub target_path: String,
    pub path: String,
    pub version: String,
    pub candidate_sha256: String,
}

#[derive(Serialize, Deserialize)]
pub(super) struct MaterialConflict {
    path: String,
    material_id: String,
    material_version: String,
    target_version: Option<String>,
    proposed_sha256: String,
    // Older reservations remain readable and fail closed until a fresh proposal.
    #[serde(default)]
    candidate: Option<String>,
    #[serde(default)]
    question_id: Option<String>,
    #[serde(default)]
    coexist_path: Option<String>,
    #[serde(default)]
    publishing: Option<String>,
    #[serde(default)]
    pub(super) receipt: Option<AssistantMaterialReceipt>,
    #[serde(default)]
    superseded: bool,
    #[serde(default)]
    guidance_observed: bool,
}

struct MaterialConflictProposal<'a> {
    adoption: &'a AssistantMaterialAdoption,
    saved: &'a str,
    version: String,
    candidate: &'a str,
    supersedes: Option<String>,
}

pub(super) struct MaterialWritePermit {
    question_id: String,
    path: String,
}

fn digest(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
fn hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}
fn direct(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 4096
        && !path.contains('\0')
        && !path.starts_with('/')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
        && assistant::excluded(path).is_none()
}
impl AssistantMaterialConflictFacts {
    pub(super) fn validate(&self) -> Result<(), CreationError> {
        if !hex(&self.material_id, 32)
            || !hex(&self.material_version, 64)
            || !hex(&self.candidate_sha256, 64)
            || !direct(&self.path)
            || !direct(&self.coexist_path)
            || self.path == self.coexist_path
            || self.target_version.is_empty()
            || self.target_version.len() > 256
            || self.saved_excerpt.chars().count() > 1600
            || self.candidate_excerpt.chars().count() > 1600
            || self.first_changed_line == 0
            || self
                .supersedes_question_id
                .as_ref()
                .is_some_and(|id| id.is_empty() || id.len() > 128)
        {
            return Err(invalid("Invalid material conflict facts"));
        }
        Ok(())
    }
}

impl Journal {
    pub(super) fn validate_material_conflicts(&self) -> Result<(), CreationError> {
        let mut questions = std::collections::HashSet::new();
        for conflict in &self.material_conflicts {
            if !direct(&conflict.path)
                || !hex(&conflict.material_id, 32)
                || !hex(&conflict.material_version, 64)
                || !hex(&conflict.proposed_sha256, 64)
                || conflict.candidate.as_ref().is_some_and(|text| {
                    text.len() as u64 > TEXT_MAX_BYTES || digest(text) != conflict.proposed_sha256
                })
            {
                return Err(invalid("Invalid material reservation"));
            }
            if let Some(id) = &conflict.question_id {
                let question = self
                    .questions
                    .iter()
                    .find(|question| &question.id == id)
                    .ok_or_else(|| invalid("Missing material question"))?;
                let facts = question
                    .material_conflict
                    .as_ref()
                    .ok_or_else(|| invalid("Unbound material question"))?;
                if !questions.insert(id)
                    || conflict.candidate.is_none()
                    || facts.path != conflict.path
                    || Some(&facts.target_version) != conflict.target_version.as_ref()
                    || facts.material_id != conflict.material_id
                    || facts.material_version != conflict.material_version
                    || facts.candidate_sha256 != conflict.proposed_sha256
                    || Some(&facts.coexist_path) != conflict.coexist_path.as_ref()
                {
                    return Err(invalid("Material question does not match its reservation"));
                }
                if let Some(path) = &conflict.publishing {
                    let selected = match question
                        .answer
                        .as_ref()
                        .and_then(|answer| answer.option_id.as_deref())
                    {
                        Some("replace") => Some(&conflict.path),
                        Some("coexist") => Some(&facts.coexist_path),
                        _ => None,
                    };
                    if question.status != AssistantQuestionStatus::Answered
                        || selected != Some(path)
                    {
                        return Err(invalid("Invalid material publication"));
                    }
                }
                if let Some(receipt) = &conflict.receipt {
                    if receipt.question_id != *id
                        || receipt.material_id != conflict.material_id
                        || receipt.material_version != conflict.material_version
                        || receipt.target_path != conflict.path
                        || receipt.candidate_sha256 != conflict.proposed_sha256
                        || conflict.publishing.as_ref() != Some(&receipt.path)
                        || receipt.version.is_empty()
                        || receipt.version.len() > 256
                    {
                        return Err(invalid("Invalid material receipt"));
                    }
                }
                if conflict.superseded
                    && (conflict.receipt.is_some()
                        || !self.questions.iter().any(|next| {
                            next.material_conflict.as_ref().is_some_and(|next| {
                                next.supersedes_question_id.as_ref() == Some(id)
                                    && next.path == conflict.path
                                    && next.material_id == conflict.material_id
                                    && next.material_version == conflict.material_version
                                    && next.candidate_sha256 == conflict.proposed_sha256
                            })
                        }))
                {
                    return Err(invalid("Material reservation has no valid successor"));
                }
                if let Some(previous_id) = &facts.supersedes_question_id {
                    let previous = self
                        .questions
                        .iter()
                        .take_while(|previous| previous.id != question.id)
                        .find(|previous| &previous.id == previous_id)
                        .and_then(|previous| previous.material_conflict.as_ref())
                        .ok_or_else(|| invalid("Invalid material question lineage"))?;
                    if previous.path != facts.path
                        || previous.material_id != facts.material_id
                        || previous.material_version != facts.material_version
                        || previous.candidate_sha256 != facts.candidate_sha256
                    {
                        return Err(invalid("Material refresh changed its frozen candidate"));
                    }
                }
            } else if conflict.publishing.is_some() || conflict.receipt.is_some() {
                return Err(invalid("Material decision has no question"));
            } else if conflict.superseded
                && !self.material_conflicts.iter().any(|next| {
                    next.question_id.is_some()
                        && next.path == conflict.path
                        && next.material_id == conflict.material_id
                        && next.material_version == conflict.material_version
                        && next.proposed_sha256 == conflict.proposed_sha256
                })
            {
                return Err(invalid(
                    "Earlier material reservation has no fresh scoped successor",
                ));
            }
        }
        if self.questions.iter().any(|question| {
            question.material_conflict.is_some() && !questions.contains(&question.id)
        }) {
            return Err(invalid("Material question has no reservation"));
        }
        Ok(())
    }
    pub(super) fn require_material_path(
        &self,
        project: &OpenProject,
        path: &str,
    ) -> Result<(), CreationError> {
        let resolved = project.resolve(path).ok();
        if self.material_conflicts.iter().any(|conflict| {
            // Replacement transfers this exact target into the ordinary task journal.
            let replaced = conflict
                .receipt
                .as_ref()
                .is_some_and(|receipt| receipt.path == conflict.path);
            !conflict.superseded
                && !replaced
                && (conflict.path == path
                    || resolved.as_ref().is_some_and(|target| {
                        project.resolve(&conflict.path).ok().as_ref() == Some(target)
                    }))
        }) {
            return Err(CreationError::new(CreationErrorCode::TargetExists,
                format!("{path} is reserved by a material conflict. Only its scoped adoption consumer may replace it; preserve it during coexistence or free-text guidance.")));
        }
        Ok(())
    }
    pub(super) fn require_material_permit(
        &self,
        write: &AssistantWrite,
        permit: &MaterialWritePermit,
    ) -> Result<(), CreationError> {
        let conflict = self
            .material_conflicts
            .iter()
            .find(|conflict| conflict.question_id.as_ref() == Some(&permit.question_id))
            .ok_or_else(|| invalid("Missing material decision"))?;
        let question = self
            .questions
            .iter()
            .find(|question| question.id == permit.question_id)
            .ok_or_else(|| invalid("Missing material question"))?;
        let choice = question
            .answer
            .as_ref()
            .and_then(|answer| answer.option_id.as_deref());
        let selected = match choice {
            Some("replace") => Some(&conflict.path),
            Some("coexist") => conflict.coexist_path.as_ref(),
            _ => None,
        };
        if question.status != AssistantQuestionStatus::Answered
            || conflict.receipt.is_some()
            || selected != Some(&permit.path)
            || write.path != permit.path
            || write.text.as_ref() != conflict.candidate.as_ref()
            || conflict.publishing.as_ref() != Some(&permit.path)
            || (choice == Some("replace") && write.version != conflict.target_version)
            || (choice == Some("coexist") && write.version.is_some())
        {
            return Err(invalid("Material choice cannot authorize this write"));
        }
        Ok(())
    }
}

impl CreationAccess {
    pub(super) fn refresh_material_questions(
        &self,
        identity: &str,
        journal: &mut Journal,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let Some(index) = journal.material_conflicts.iter().rposition(|conflict| {
            !conflict.superseded
                && conflict.receipt.is_none()
                && conflict.publishing.is_none()
                && conflict.question_id.is_some()
        }) else {
            return Ok(());
        };
        let conflict = &journal.material_conflicts[index];
        let question_id = conflict.question_id.clone().expect("checked question");
        if journal.questions.iter().any(|question| {
            question.id == question_id && question.status == AssistantQuestionStatus::Cancelled
        }) {
            return Ok(());
        }
        self.assistant_target(identity, &conflict.path, protection)?;
        let (saved, version) = text_content(self.read(identity, &conflict.path, protection)?)?;
        if Some(&version) == conflict.target_version.as_ref() {
            return Ok(());
        }
        let adoption = AssistantMaterialAdoption {
            id: conflict.material_id.clone(),
            version: conflict.material_version.clone(),
            path: conflict.path.clone(),
            text: conflict.candidate.clone(),
        };
        self.adoption_source(identity, &adoption, data, protection)?;
        let candidate = adoption
            .text
            .as_deref()
            .ok_or_else(|| invalid("Missing frozen material candidate"))?;
        journal.material_conflicts[index].superseded = true;
        if let Some(question) = journal.questions.iter_mut().find(|question| {
            question.id == question_id && question.status == AssistantQuestionStatus::Pending
        }) {
            question.status = AssistantQuestionStatus::Cancelled;
        }
        self.propose_material_conflict(
            identity,
            journal,
            MaterialConflictProposal {
                adoption: &adoption,
                saved: &saved,
                version,
                candidate,
                supersedes: Some(question_id),
            },
            data,
            protection,
        )
    }
    fn adoption_source(
        &self,
        identity: &str,
        adoption: &AssistantMaterialAdoption,
        data: &Path,
        protection: &Protection,
    ) -> Result<String, CreationError> {
        self.material_text(data, identity, &adoption.id, &adoption.version, protection)
            .map_err(|error| {
                CreationError::new(
                    match error {
                        MaterialError::Missing => CreationErrorCode::Missing,
                        MaterialError::VersionConflict => CreationErrorCode::VersionConflict,
                        MaterialError::InvalidIdentity => CreationErrorCode::InvalidIdentity,
                        _ => CreationErrorCode::TestValidation,
                    },
                    format!("Private material {} is unavailable: {error:?}", adoption.id),
                )
            })
    }
    fn material_coexist_path(
        &self,
        identity: &str,
        path: &str,
        protection: &Protection,
    ) -> Result<String, CreationError> {
        let path = Path::new(path);
        let stem = path
            .file_stem()
            .ok_or_else(|| invalid("Missing material file name"))?
            .to_string_lossy();
        let extension = path
            .extension()
            .map(|extension| format!(".{}", extension.to_string_lossy()))
            .unwrap_or_default();
        for index in 1..=64 {
            let suffix = if index == 1 {
                "-imported".into()
            } else {
                format!("-imported-{index}")
            };
            let candidate = path
                .with_file_name(format!("{stem}{suffix}{extension}"))
                .to_string_lossy()
                .into_owned();
            let target = self.assistant_target(identity, &candidate, protection)?;
            if !target.exists() {
                return Ok(candidate);
            }
        }
        Err(invalid(
            "No free coexistence path; choose another placement",
        ))
    }
    fn propose_material_conflict(
        &self,
        identity: &str,
        journal: &mut Journal,
        proposal: MaterialConflictProposal<'_>,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let MaterialConflictProposal {
            adoption,
            saved,
            version,
            candidate,
            supersedes,
        } = proposal;
        if journal.material_conflicts.len() >= 64 {
            return Err(invalid("Task recovery supports 64 material conflicts"));
        }
        let question_id = if let Some(scope) = journal.question_scope.clone() {
            if journal.questions.len() >= 64 {
                return Err(invalid("Task question history is full"));
            }
            let coexist_path = self.material_coexist_path(identity, &adoption.path, protection)?;
            let old: Vec<_> = saved.split_inclusive('\n').collect();
            let new: Vec<_> = candidate.split_inclusive('\n').collect();
            let first = old
                .iter()
                .zip(&new)
                .position(|(a, b)| a != b)
                .unwrap_or(old.len().min(new.len()));
            let common = old
                .get(first)
                .unwrap_or(&"")
                .chars()
                .zip(new.get(first).unwrap_or(&"").chars())
                .take_while(|(a, b)| a == b)
                .count();
            let skipped = common.saturating_sub(120);
            let excerpt = |lines: &[&str]| {
                let text = lines
                    .iter()
                    .skip(first)
                    .take(12)
                    .copied()
                    .collect::<String>();
                let excerpt = text
                    .chars()
                    .skip(skipped)
                    .take(if skipped > 0 { 1599 } else { 1600 })
                    .collect::<String>();
                if skipped > 0 {
                    format!("…{excerpt}")
                } else {
                    excerpt
                }
            };
            let facts = AssistantMaterialConflictFacts {
                material_id: adoption.id.clone(),
                material_version: adoption.version.clone(),
                path: adoption.path.clone(),
                target_version: version.clone(),
                candidate_sha256: digest(candidate),
                coexist_path: coexist_path.clone(),
                saved_excerpt: excerpt(&old),
                candidate_excerpt: excerpt(&new),
                first_changed_line: first as u32 + 1,
                truncated: skipped > 0
                    || old.len().saturating_sub(first) > 12
                    || new.len().saturating_sub(first) > 12
                    || saved.chars().count() > 1600
                    || candidate.chars().count() > 1600,
                supersedes_question_id: supersedes,
            };
            let id = format!("{}-question-{}", journal.id, journal.questions.len() + 1);
            journal.questions.push(AssistantQuestion {
                id: id.clone(),
                task_id: journal.id.clone(),
                scope,
                // These are machine fields. The localized card renders the
                // complete paths from material_conflict, outside label bounds.
                prompt: "material-conflict".into(),
                options: vec![
                    AssistantQuestionOption {
                        id: "replace".into(),
                        label: "replace".into(),
                        description: String::new(),
                    },
                    AssistantQuestionOption {
                        id: "coexist".into(),
                        label: "coexist".into(),
                        description: String::new(),
                    },
                ],
                recommended_option_id: Some("coexist".into()),
                status: AssistantQuestionStatus::Pending,
                answer: None,
                material_conflict: Some(facts),
            });
            Some((id, coexist_path))
        } else {
            None
        };
        journal.material_conflicts.push(MaterialConflict {
            path: adoption.path.clone(),
            material_id: adoption.id.clone(),
            material_version: adoption.version.clone(),
            target_version: Some(version),
            proposed_sha256: digest(candidate),
            candidate: Some(candidate.into()),
            question_id: question_id.as_ref().map(|(id, _)| id.clone()),
            coexist_path: question_id.map(|(_, path)| path),
            publishing: None,
            receipt: None,
            superseded: false,
            guidance_observed: false,
        });
        journal.persist(data)
    }
    pub fn adopt_assistant_material(
        &mut self,
        identity: &str,
        task_id: &str,
        adoption: &AssistantMaterialAdoption,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantTask, CreationError> {
        self.authorize_assistant_task(identity, task_id, true, protection)?;
        if image_mime(&adoption.path).is_some()
            || super::super::materials::audio_format(&adoption.path).is_some()
        {
            return self.adopt_assistant_media(identity, task_id, adoption, data, protection);
        }
        self.adoption_source(identity, adoption, data, protection)?;
        let mut journal = load(data, &self.current(identity, protection)?.root, task_id)?;
        if !journal
            .pending_selections
            .iter()
            .any(|source| source.id == adoption.id && source.version == adoption.version)
        {
            if journal.pending_selections.len() >= 64 {
                return Err(invalid("An integration task supports 64 sources"));
            }
            journal.pending_selections.push(PendingIntegrationSource {
                id: adoption.id.clone(),
                version: adoption.version.clone(),
                path: adoption.path.clone(),
            });
            journal.persist(data)?;
        }
        let result =
            self.adopt_assistant_material_inner(identity, task_id, adoption, data, protection)?;
        let mut journal = load(data, &self.current(identity, protection)?.root, task_id)?;
        let actual_path = journal
            .material_conflicts
            .iter()
            .rev()
            .find(|conflict| {
                conflict.material_id == adoption.id
                    && conflict.material_version == adoption.version
                    && conflict.path == adoption.path
            })
            .and_then(|conflict| conflict.receipt.as_ref())
            .map(|receipt| receipt.path.clone())
            .unwrap_or_else(|| adoption.path.clone());
        let pending = journal
            .material_conflicts
            .iter()
            .rev()
            .find(|conflict| conflict.path == adoption.path)
            .is_some_and(|conflict| conflict.receipt.is_none() && !conflict.superseded);
        if !pending {
            let original = self.adoption_source(identity, adoption, data, protection)?;
            let expected = adoption.text.as_ref().unwrap_or(&original);
            let (current, _) = text_content(self.read(identity, &actual_path, protection)?)?;
            if current == *expected {
                let source = PendingIntegrationSource {
                    id: adoption.id.clone(),
                    version: adoption.version.clone(),
                    path: actual_path,
                };
                if !journal
                    .pending_sources
                    .iter()
                    .any(|current| current == &source)
                {
                    // An explicit adoption of the freshly saved version renews
                    // this source only; all task file changes remain journaled.
                    journal.pending_sources.retain(|current| {
                        current.id != source.id || current.version == source.version
                    });
                    journal.pending_selections.retain(|current| {
                        current.id != source.id || current.version == source.version
                    });
                    journal.pending_sources.push(source);
                    journal.persist(data)?;
                }
            }
        }
        Ok(result)
    }

    fn adopt_assistant_material_inner(
        &mut self,
        identity: &str,
        task_id: &str,
        adoption: &AssistantMaterialAdoption,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantTask, CreationError> {
        self.authorize_assistant_task(identity, task_id, true, protection)?;
        let mut journal = load(data, &self.current(identity, protection)?.root, task_id)?;
        self.reconcile_assistant_journal(identity, &mut journal, data, protection)?;
        self.verify_assistant_directories(identity, &journal, protection)?;
        let original = self.adoption_source(identity, adoption, data, protection)?;
        let text = adoption.text.as_ref().unwrap_or(&original);
        if text.len() as u64 > TEXT_MAX_BYTES {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                &adoption.path,
            ));
        }
        self.assistant_target(identity, &adoption.path, protection)?;
        let index = journal
            .material_conflicts
            .iter()
            .rposition(|conflict| conflict.path == adoption.path);
        if let Some(index) = index {
            let conflict = &journal.material_conflicts[index];
            if conflict.material_id != adoption.id
                || conflict.material_version != adoption.version
                || conflict
                    .candidate
                    .as_ref()
                    .is_some_and(|candidate| candidate != text)
                || conflict.proposed_sha256 != digest(text)
            {
                return Err(CreationError::new(CreationErrorCode::VersionConflict, "Material candidate changed; retain the original target and propose a new safe placement"));
            }
            if conflict.question_id.is_none() && journal.question_scope.is_some() {
                journal.require_resource_decision()?;
                let (saved, version) =
                    text_content(self.read(identity, &adoption.path, protection)?)?;
                journal.material_conflicts[index].superseded = true;
                self.propose_material_conflict(
                    identity,
                    &mut journal,
                    MaterialConflictProposal {
                        adoption,
                        saved: &saved,
                        version,
                        candidate: text,
                        supersedes: None,
                    },
                    data,
                    protection,
                )?;
                return Ok(journal.summary());
            }
            if let Some(receipt) = &conflict.receipt {
                let (current, version) =
                    text_content(self.read(identity, &receipt.path, protection)?)?;
                if current != *text
                    || version != receipt.version
                    || !journal.entries.iter().any(|entry| {
                        entry.path == receipt.path
                            && entry.after == current
                            && !entry.undone
                            && !entry.removed
                    })
                {
                    return Err(CreationError::new(
                        CreationErrorCode::VersionConflict,
                        &receipt.path,
                    ));
                }
                return Ok(journal.summary());
            }
            let question_id = conflict.question_id.clone().ok_or_else(|| {
                CreationError::new(
                    CreationErrorCode::TargetExists,
                    "This earlier material reservation needs a fresh scoped task",
                )
            })?;
            let question = journal
                .questions
                .iter()
                .find(|question| question.id == question_id)
                .ok_or_else(|| invalid("Missing material question"))?;
            if question.status == AssistantQuestionStatus::Pending {
                return Ok(journal.summary());
            }
            if question.status != AssistantQuestionStatus::Answered {
                return Err(invalid("This material question was cancelled"));
            }
            journal.require_resource_decision()?;
            let choice = question
                .answer
                .as_ref()
                .and_then(|answer| answer.option_id.as_deref());
            let path = match choice {
                Some("replace") => adoption.path.clone(),
                Some("coexist") => conflict
                    .coexist_path
                    .clone()
                    .ok_or_else(|| invalid("Missing coexistence path"))?,
                _ => {
                    if !conflict.guidance_observed {
                        journal.material_conflicts[index].guidance_observed = true;
                        journal.persist(data)?;
                        return Ok(journal.summary());
                    }
                    self.verify_material_conflict(identity, conflict, data, protection)?;
                    let (saved, version) =
                        text_content(self.read(identity, &adoption.path, protection)?)?;
                    journal.material_conflicts[index].superseded = true;
                    self.propose_material_conflict(
                        identity,
                        &mut journal,
                        MaterialConflictProposal {
                            adoption,
                            saved: &saved,
                            version,
                            candidate: text,
                            supersedes: Some(question_id),
                        },
                        data,
                        protection,
                    )?;
                    return Ok(journal.summary());
                }
            };
            // A write can publish before the final conflict receipt is persisted.
            if conflict.publishing.as_ref() == Some(&path)
                && journal.entries.iter().any(|entry| {
                    entry.path == path
                        && entry.after == *text
                        && !entry.undone
                        && !entry.removed
                        && entry.pending.is_none()
                })
            {
                let (current, version) = text_content(self.read(identity, &path, protection)?)?;
                if current != *text {
                    return Err(CreationError::new(CreationErrorCode::VersionConflict, path));
                }
                journal.material_conflicts[index].receipt = Some(AssistantMaterialReceipt {
                    question_id,
                    material_id: adoption.id.clone(),
                    material_version: adoption.version.clone(),
                    target_path: adoption.path.clone(),
                    path,
                    version,
                    candidate_sha256: digest(text),
                });
                journal.persist(data)?;
                return Ok(journal.summary());
            }
            self.verify_material_conflict(identity, conflict, data, protection)?;
            if choice == Some("coexist")
                && self.assistant_target(identity, &path, protection)?.exists()
            {
                return Err(CreationError::new(CreationErrorCode::TargetExists, path));
            }
            let version = if choice == Some("replace") {
                conflict.target_version.clone()
            } else {
                None
            };
            journal.material_conflicts[index].publishing = Some(path.clone());
            journal.persist(data)?;
            let permit = MaterialWritePermit {
                question_id: question_id.clone(),
                path: path.clone(),
            };
            if let Err(error) = self.write_assistant_file_inner(
                identity,
                task_id,
                &AssistantWrite {
                    path: path.clone(),
                    version,
                    text: Some(text.clone()),
                    edits: None,
                },
                data,
                protection,
                AssistantWriteAuthority::Material(&permit),
            ) {
                let mut current = load(data, &self.current(identity, protection)?.root, task_id)?;
                current.material_conflicts[index].publishing = None;
                current.persist(data)?;
                return Err(error);
            }
            let mut journal = load(data, &self.current(identity, protection)?.root, task_id)?;
            let (current, version) = text_content(self.read(identity, &path, protection)?)?;
            if current != *text {
                return Err(CreationError::new(CreationErrorCode::VersionConflict, path));
            }
            self.adoption_source(identity, adoption, data, protection)?;
            journal.material_conflicts[index].receipt = Some(AssistantMaterialReceipt {
                question_id,
                material_id: adoption.id.clone(),
                material_version: adoption.version.clone(),
                target_path: adoption.path.clone(),
                path,
                version,
                candidate_sha256: digest(text),
            });
            journal.persist(data)?;
            return Ok(journal.summary());
        }
        journal.require_resource_decision()?;
        journal.require_material_path(self.current(identity, protection)?, &adoption.path)?;
        let version = match self.read(identity, &adoption.path, protection) {
            Ok(content) => {
                let (saved, version) = text_content(content)?;
                if saved != *text {
                    self.propose_material_conflict(
                        identity,
                        &mut journal,
                        MaterialConflictProposal {
                            adoption,
                            saved: &saved,
                            version,
                            candidate: text,
                            supersedes: None,
                        },
                        data,
                        protection,
                    )?;
                    if journal.question_scope.is_none() {
                        return Err(CreationError::new(
                            CreationErrorCode::TargetExists,
                            &adoption.path,
                        ));
                    }
                    return Ok(journal.summary());
                }
                Some(version)
            }
            Err(error) if error.code == CreationErrorCode::Missing => None,
            Err(error) => return Err(error),
        };
        let result = self.write_assistant_file(
            identity,
            task_id,
            &AssistantWrite {
                path: adoption.path.clone(),
                version,
                text: Some(text.clone()),
                edits: None,
            },
            data,
            protection,
        );
        if let Err(error) = &result {
            if matches!(
                error.code,
                CreationErrorCode::TargetExists | CreationErrorCode::VersionConflict
            ) {
                let mut current = load(data, &self.current(identity, protection)?.root, task_id)?;
                let (saved, version) =
                    text_content(self.read(identity, &adoption.path, protection)?)?;
                self.propose_material_conflict(
                    identity,
                    &mut current,
                    MaterialConflictProposal {
                        adoption,
                        saved: &saved,
                        version,
                        candidate: text,
                        supersedes: None,
                    },
                    data,
                    protection,
                )?;
                if current.question_scope.is_some() {
                    return Ok(current.summary());
                }
            }
        }
        result
    }
    fn verify_material_conflict(
        &self,
        identity: &str,
        conflict: &MaterialConflict,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        self.adoption_source(
            identity,
            &AssistantMaterialAdoption {
                id: conflict.material_id.clone(),
                version: conflict.material_version.clone(),
                path: conflict.path.clone(),
                text: None,
            },
            data,
            protection,
        )?;
        self.assistant_target(identity, &conflict.path, protection)?;
        let (_, version) = text_content(self.read(identity, &conflict.path, protection)?)?;
        if Some(version) != conflict.target_version {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                &conflict.path,
            ));
        }
        Ok(())
    }
    pub(super) fn verify_material_answer(
        &self,
        identity: &str,
        journal: &Journal,
        question_id: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        if let Some(conflict) = journal
            .material_conflicts
            .iter()
            .find(|conflict| conflict.question_id.as_deref() == Some(question_id))
        {
            self.verify_material_conflict(identity, conflict, data, protection)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
