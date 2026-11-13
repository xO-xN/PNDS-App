//! Pending images are copied natively. The model receives metadata and receipts only.
use super::{compilation::artifact_bytes, *};

pub(super) const IMAGE_CONFLICT: &str = "pending-image-conflict";
const CHOICES: [&str; 3] = ["replace", "coexist", "cancel"];

#[derive(Serialize, Deserialize)]
pub(super) struct ImageConflict {
    question_id: String,
    id: String,
    version: String,
    path: String,
    target_version: String,
    coexist: String,
}

fn exact_hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn version_conflict(path: &str) -> CreationError {
    CreationError::new(CreationErrorCode::VersionConflict, path)
}

impl Journal {
    pub(super) fn validate_image_adoptions(&self) -> Result<(), CreationError> {
        if self.image_conflicts.len() > 64 || self.image_adoptions.len() > 64 {
            return Err(invalid("Task image history is full"));
        }
        for conflict in &self.image_conflicts {
            directories::admitted(&conflict.path)?;
            directories::admitted(&conflict.coexist)?;
            let question = self
                .questions
                .iter()
                .find(|question| question.id == conflict.question_id);
            if !exact_hex(&conflict.id, 32)
                || !exact_hex(&conflict.version, 64)
                || !exact_hex(&conflict.target_version, 64)
                || image_mime(&conflict.path).is_none()
                || image_mime(&conflict.path) != image_mime(&conflict.coexist)
                || conflict.coexist == conflict.path
                || !self
                    .pending_selections
                    .iter()
                    .any(|source| source.id == conflict.id && source.version == conflict.version)
                || question.is_none_or(|question| {
                    question.prompt != IMAGE_CONFLICT
                        || question
                            .options
                            .iter()
                            .map(|option| option.id.as_str())
                            .ne(CHOICES)
                        || question.options[0].label != conflict.path
                        || question.options[1].label != conflict.coexist
                })
            {
                return Err(invalid("Invalid pending image conflict"));
            }
        }
        for receipt in &self.image_adoptions {
            directories::admitted(&receipt.path)?;
            directories::admitted(&receipt.target_path)?;
            if image_mime(&receipt.path).is_none()
                || image_mime(&receipt.path) != image_mime(&receipt.target_path)
                || !exact_hex(&receipt.material_id, 32)
                || !exact_hex(&receipt.material_version, 64)
                || receipt.candidate_sha256 != receipt.material_version
                || (!receipt.question_id.is_empty()
                    && !self.image_conflicts.iter().any(|conflict| {
                        conflict.question_id == receipt.question_id
                            && conflict.id == receipt.material_id
                            && conflict.version == receipt.material_version
                            && conflict.path == receipt.target_path
                            && self.questions.iter().any(|question| {
                                question.id == conflict.question_id
                                    && question.status == AssistantQuestionStatus::Answered
                                    && question
                                        .answer
                                        .as_ref()
                                        .and_then(|answer| answer.option_id.as_deref())
                                        == Some(if receipt.path == conflict.path {
                                            "replace"
                                        } else {
                                            "coexist"
                                        })
                            })
                            && (receipt.path == conflict.path || receipt.path == conflict.coexist)
                    }))
                || !self.pending_sources.iter().any(|source| {
                    source.id == receipt.material_id
                        && source.version == receipt.material_version
                        && source.path == receipt.path
                })
            {
                return Err(invalid("Invalid pending image receipt"));
            }
        }
        Ok(())
    }
}

impl CreationAccess {
    pub(crate) fn pending_image_check_inputs(
        &self,
        identity: &str,
        task_id: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<Vec<String>, CreationError> {
        let journal = load(data, &self.current(identity, protection)?.root, task_id)?;
        let mut versions: Vec<_> = journal
            .image_adoptions
            .into_iter()
            .map(|receipt| receipt.candidate_sha256)
            .collect();
        versions.sort_unstable();
        versions.dedup();
        Ok(versions)
    }

    pub(super) fn verify_image_answer(
        &self,
        identity: &str,
        journal: &Journal,
        question_id: &str,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let Some(conflict) = journal
            .image_conflicts
            .iter()
            .find(|item| item.question_id == question_id)
        else {
            return Ok(());
        };
        self.read_pending_image(identity, &conflict.id, &conflict.version, protection)
            .map_err(|_| version_conflict(&conflict.path))?;
        let project = self.current(identity, protection)?;
        if artifact_bytes(project, &conflict.path)?
            .as_deref()
            .map(|bytes| format!("{:x}", Sha256::digest(bytes)))
            .as_ref()
            != Some(&conflict.target_version)
        {
            return Err(version_conflict(&conflict.path));
        }
        Ok(())
    }

    pub(super) fn adopt_assistant_image(
        &mut self,
        identity: &str,
        task_id: &str,
        adoption: &AssistantMaterialAdoption,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantTask, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        directories::admitted(&adoption.path)?;
        let (mime, bytes) = self
            .read_pending_image(identity, &adoption.id, &adoption.version, protection)
            .map_err(|cause| invalid(format!("Pending image is unavailable: {cause:?}")))?;
        if adoption.text.is_some() || image_mime(&adoption.path) != Some(&mime) {
            return Err(invalid(
                "Use an image destination with the original format and no text payload",
            ));
        }

        let mut journal = load(data, &project.root, task_id)?;
        self.reconcile_assistant_journal(identity, &mut journal, data, protection)?;
        self.verify_assistant_directories(identity, &journal, protection)?;
        journal.require_resource_decision()?;
        let source = PendingIntegrationSource {
            id: adoption.id.clone(),
            version: adoption.version.clone(),
            path: adoption.path.clone(),
        };
        if let Some(receipt) = journal.image_adoptions.iter().find(|receipt| {
            receipt.material_id == adoption.id
                && receipt.material_version == adoption.version
                && receipt.target_path == adoption.path
        }) {
            if artifact_bytes(project, &receipt.path)?.as_deref() != Some(bytes.as_slice()) {
                return Err(version_conflict(&receipt.path));
            }
            return Ok(journal.summary());
        }
        if !journal.pending_selections.contains(&source) {
            if journal.pending_selections.len() >= 64
                || journal
                    .pending_selections
                    .iter()
                    .any(|old| old.id == source.id)
            {
                return Err(invalid(
                    "The source already has a different adoption in this Work task",
                ));
            }
            journal.pending_selections.push(source.clone());
        }

        if journal
            .image_adoptions
            .iter()
            .any(|receipt| receipt.path.eq_ignore_ascii_case(&source.path))
        {
            return Err(invalid(
                "The destination already belongs to a different adopted image",
            ));
        }
        let mut target = artifact_bytes(project, &adoption.path)?;
        let mut path = adoption.path.clone();
        let mut question_id = String::new();
        if let Some(conflict) = journal.image_conflicts.iter().rev().find(|conflict| {
            conflict.id == source.id
                && conflict.version == source.version
                && conflict.path == source.path
        }) {
            let question = journal
                .questions
                .iter()
                .find(|item| item.id == conflict.question_id)
                .expect("validated image conflict");
            match question
                .answer
                .as_ref()
                .and_then(|answer| answer.option_id.as_deref())
            {
                Some("replace" | "coexist") => {
                    let replacing = question
                        .answer
                        .as_ref()
                        .and_then(|answer| answer.option_id.as_deref())
                        == Some("replace");
                    if replacing
                        && target.as_deref() == Some(&bytes)
                        && journal.artifacts.iter().any(|entry| entry.path == path)
                    {
                        // A publication can finish before its receipt reaches disk.
                    } else {
                        self.verify_image_answer(
                            identity,
                            &journal,
                            &conflict.question_id,
                            protection,
                        )?;
                    }
                    if !replacing {
                        path.clone_from(&conflict.coexist);
                        target = artifact_bytes(project, &path)?;
                        if target.is_some()
                            && (target.as_deref() != Some(&bytes)
                                || !journal.artifacts.iter().any(|entry| entry.path == path))
                        {
                            return Err(version_conflict(&path));
                        }
                    }
                    question_id.clone_from(&conflict.question_id);
                }
                _ => {
                    return Err(invalid(
                        "The image was not adopted. The original remains in the inbox",
                    ))
                }
            }
        } else if let Some(existing) = target.as_ref().filter(|existing| *existing != &bytes) {
            let metadata = self
                .pending_image_metadata(identity, &source.id, &source.version, protection)
                .map_err(|_| version_conflict(&source.path))?;
            let stem = Path::new(&path)
                .file_stem()
                .and_then(|name| name.to_str())
                .ok_or_else(|| invalid("Invalid image name"))?;
            let extension = Path::new(&path)
                .extension()
                .and_then(|name| name.to_str())
                .ok_or_else(|| invalid("Missing image format"))?;
            let mut coexist = None;
            for index in 1..=64 {
                let suffix = if index == 1 {
                    "imported".into()
                } else {
                    format!("imported-{index}")
                };
                let candidate =
                    Path::new(&path).with_file_name(format!("{stem}-{suffix}.{extension}"));
                let candidate = candidate
                    .to_str()
                    .ok_or_else(|| invalid("Invalid image destination"))?;
                if artifact_bytes(project, candidate)?.is_none() {
                    coexist = Some(candidate.to_string());
                    break;
                }
            }
            let coexist = coexist.ok_or_else(|| invalid("No free coexistence path"))?;
            let scope = journal
                .question_scope
                .clone()
                .ok_or_else(|| invalid("Replacing an image requires a scoped creator choice"))?;
            let question_id = format!("{task_id}-question-{}", journal.questions.len() + 1);
            let target_version = format!("{:x}", Sha256::digest(existing));
            journal.questions.push(AssistantQuestion {
                id: question_id.clone(),
                task_id: task_id.into(),
                scope,
                prompt: IMAGE_CONFLICT.into(),
                options: vec![
                    AssistantQuestionOption {
                        id: "replace".into(),
                        label: path.clone(),
                        description: format!(
                            "{} · {} bytes · SHA-256 {}",
                            mime,
                            existing.len(),
                            target_version
                        ),
                    },
                    AssistantQuestionOption {
                        id: "coexist".into(),
                        label: coexist.clone(),
                        description: format!(
                            "{} · {} · {} bytes · SHA-256 {}",
                            metadata.name, mime, metadata.size, metadata.version
                        ),
                    },
                    AssistantQuestionOption {
                        id: "cancel".into(),
                        label: "cancel".into(),
                        description: String::new(),
                    },
                ],
                recommended_option_id: Some("coexist".into()),
                status: AssistantQuestionStatus::Pending,
                answer: None,
                material_conflict: None,
            });
            journal.image_conflicts.push(ImageConflict {
                question_id,
                id: source.id,
                version: source.version,
                path,
                target_version,
                coexist,
            });
            journal.persist(data)?;
            return Ok(journal.summary());
        }

        let version = file_version(&bytes);
        if target.as_deref() != Some(bytes.as_slice()) {
            Self::publish_assistant_image(
                project,
                &mut journal,
                &path,
                target,
                bytes,
                data,
                protection,
            )?;
        }
        journal.pending_sources.push(PendingIntegrationSource {
            path: path.clone(),
            ..source.clone()
        });
        journal.image_adoptions.push(AssistantMaterialReceipt {
            question_id,
            material_id: source.id,
            material_version: source.version.clone(),
            target_path: source.path,
            path,
            version,
            candidate_sha256: source.version,
        });
        journal.persist(data)?;
        self.last_change = None;
        Ok(journal.summary())
    }
}
