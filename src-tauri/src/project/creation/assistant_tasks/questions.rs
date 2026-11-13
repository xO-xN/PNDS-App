//! One creator answer is a scoped task fact, never execution authority.
use super::*;
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantQuestionScope {
    pub chat_id: String,
    pub message_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantQuestionOption {
    pub id: String,
    pub label: String,
    pub description: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantQuestionRequest {
    pub prompt: String,
    pub options: Vec<AssistantQuestionOption>,
    pub recommended_option_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantQuestionAnswer {
    pub option_id: Option<String>,
    pub text: Option<String>,
}
pub struct AssistantQuestionSubmission<'a> {
    pub question_id: &'a str,
    pub scope: &'a AssistantQuestionScope,
    pub answer: &'a AssistantQuestionAnswer,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AssistantQuestionStatus {
    Pending,
    Answered,
    Cancelled,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantQuestion {
    pub id: String,
    pub task_id: String,
    pub scope: AssistantQuestionScope,
    pub prompt: String,
    pub options: Vec<AssistantQuestionOption>,
    pub recommended_option_id: Option<String>,
    pub status: AssistantQuestionStatus,
    pub answer: Option<AssistantQuestionAnswer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub material_conflict: Option<AssistantMaterialConflictFacts>,
}
fn bounded(value: &str, limit: usize, empty: bool) -> Result<(), CreationError> {
    if value.chars().count() > limit || (!empty && value.trim().is_empty()) || value.contains('\0')
    {
        return Err(invalid("Invalid creator question field"));
    }
    Ok(())
}
impl AssistantQuestionScope {
    pub(super) fn validate(&self) -> Result<(), CreationError> {
        bounded(&self.chat_id, 128, false)?;
        bounded(&self.message_id, 128, false)
    }
}
impl AssistantQuestionRequest {
    fn validate(&self) -> Result<(), CreationError> {
        bounded(&self.prompt, 2000, false)?;
        if self.options.len() > 4 {
            return Err(invalid("A question supports at most four options"));
        }
        let mut ids = HashSet::new();
        for option in &self.options {
            bounded(&option.id, 64, false)?;
            bounded(&option.label, 200, false)?;
            bounded(&option.description, 1000, true)?;
            if !ids.insert(&option.id) {
                return Err(invalid("Question options must have unique IDs"));
            }
        }
        if self
            .recommended_option_id
            .as_ref()
            .is_some_and(|id| !ids.contains(id))
        {
            return Err(invalid("The recommended option does not exist"));
        }
        Ok(())
    }
}
impl AssistantQuestion {
    /// Also validates display-only snapshots; it does not authenticate their facts.
    pub fn validate(&self) -> Result<(), CreationError> {
        bounded(&self.id, 128, false)?;
        bounded(&self.task_id, 128, false)?;
        self.scope.validate()?;
        if let Some(facts) = &self.material_conflict {
            facts.validate()?;
            if self
                .options
                .iter()
                .map(|option| option.id.as_str())
                .collect::<Vec<_>>()
                != ["replace", "coexist"]
                || self.recommended_option_id.as_deref() != Some("coexist")
            {
                return Err(invalid("Invalid material conflict choices"));
            }
        }
        AssistantQuestionRequest {
            prompt: self.prompt.clone(),
            options: self.options.clone(),
            recommended_option_id: self.recommended_option_id.clone(),
        }
        .validate()?;
        match (&self.status, &self.answer) {
            (AssistantQuestionStatus::Answered, Some(answer)) => self.validate_answer(answer),
            (AssistantQuestionStatus::Pending | AssistantQuestionStatus::Cancelled, None) => Ok(()),
            _ => Err(invalid("Question status does not match its answer")),
        }
    }
    fn validate_answer(&self, answer: &AssistantQuestionAnswer) -> Result<(), CreationError> {
        match (&answer.option_id, &answer.text) {
            (Some(id), None) if self.options.iter().any(|option| &option.id == id) => Ok(()),
            (None, Some(text)) => bounded(text, 4000, false),
            _ => Err(invalid("Submit one valid option or a free answer")),
        }
    }
}
impl Journal {
    pub(super) fn validate_questions(&self) -> Result<(), CreationError> {
        if let Some(scope) = &self.question_scope {
            scope.validate()?;
        }
        if self.questions.len() > 64 {
            return Err(invalid("Task question history is full"));
        }
        let mut ids = HashSet::new();
        let mut pending = 0;
        for question in &self.questions {
            question.validate()?;
            if question.task_id != self.id
                || self.question_scope.as_ref() != Some(&question.scope)
                || !ids.insert(&question.id)
            {
                return Err(invalid("Invalid question owner"));
            }
            pending += usize::from(question.status == AssistantQuestionStatus::Pending);
        }
        if pending > 1 {
            return Err(invalid("Only one question can await an answer"));
        }
        Ok(())
    }
    pub(super) fn require_question_answer(&self) -> Result<(), CreationError> {
        if self
            .questions
            .iter()
            .any(|question| question.status == AssistantQuestionStatus::Pending)
        {
            return Err(invalid(
                "Wait for the creator's answer before continuing the task",
            ));
        }
        Ok(())
    }
}
impl CreationAccess {
    pub fn authorize_assistant_check(
        &self,
        identity: &str,
        id: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        self.authorize_assistant_task(identity, id, true, protection)?;
        load(data, &self.current(identity, protection)?.root, id)?.require_resource_decision()
    }
    pub fn assistant_questions(
        &self,
        identity: &str,
        id: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<Vec<AssistantQuestion>, CreationError> {
        if self.git_ended_tasks.contains(id) {
            return Err(invalid("This task was ended before switching versions"));
        }
        Ok(load(data, &self.current(identity, protection)?.root, id)?.questions)
    }
    pub fn ask_assistant_question(
        &self,
        identity: &str,
        id: &str,
        scope: &AssistantQuestionScope,
        request: &AssistantQuestionRequest,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantTask, CreationError> {
        self.authorize_assistant_task(identity, id, false, protection)?;
        let mut journal = load(data, &self.current(identity, protection)?.root, id)?;
        if journal.question_scope.as_ref() != Some(scope) {
            return Err(invalid("Question scope does not match its task"));
        }
        journal.require_resource_decision()?;
        request.validate()?;
        if request.prompt == super::media_adoption::IMAGE_CONFLICT {
            return Err(invalid("Only native image adoption can ask this question"));
        }
        if journal.questions.len() >= 64 {
            return Err(invalid("Task question history is full"));
        }
        journal.questions.push(AssistantQuestion {
            id: format!("{id}-question-{}", journal.questions.len() + 1),
            task_id: id.into(),
            scope: scope.clone(),
            prompt: request.prompt.clone(),
            options: request.options.clone(),
            recommended_option_id: request.recommended_option_id.clone(),
            status: AssistantQuestionStatus::Pending,
            answer: None,
            material_conflict: None,
        });
        journal.persist(data)?;
        Ok(journal.summary())
    }
    pub fn answer_assistant_question(
        &self,
        identity: &str,
        id: &str,
        submission: AssistantQuestionSubmission<'_>,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantQuestion, CreationError> {
        let AssistantQuestionSubmission {
            question_id,
            scope,
            answer,
        } = submission;
        let mut journal = self.question_decision_journal(identity, id, scope, data, protection)?;
        self.verified_assistant_journal_files(identity, &journal, protection)?;
        self.verify_material_answer(identity, &journal, question_id, data, protection)?;
        if answer
            .option_id
            .as_deref()
            .is_some_and(|choice| choice != "cancel")
        {
            self.verify_image_answer(identity, &journal, question_id, protection)?;
        }
        let question = journal
            .questions
            .iter_mut()
            .find(|question| {
                question.id == question_id && question.status == AssistantQuestionStatus::Pending
            })
            .ok_or_else(|| invalid("This question no longer awaits an answer"))?;
        question.validate_answer(answer)?;
        if question.prompt == super::media_adoption::IMAGE_CONFLICT && answer.option_id.is_none() {
            return Err(invalid("Choose replace, coexist, or cancel for the image"));
        }
        question.status = AssistantQuestionStatus::Answered;
        question.answer = Some(answer.clone());
        let result = question.clone();
        journal.persist(data)?;
        Ok(result)
    }
    pub fn cancel_assistant_question(
        &self,
        identity: &str,
        id: &str,
        question_id: &str,
        scope: &AssistantQuestionScope,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantQuestion, CreationError> {
        let mut journal = self.question_decision_journal(identity, id, scope, data, protection)?;
        let question = journal
            .questions
            .iter_mut()
            .find(|question| {
                question.id == question_id && question.status == AssistantQuestionStatus::Pending
            })
            .ok_or_else(|| invalid("This question no longer awaits an answer"))?;
        question.status = AssistantQuestionStatus::Cancelled;
        let result = question.clone();
        journal.persist(data)?;
        Ok(result)
    }
    fn question_decision_journal(
        &self,
        identity: &str,
        id: &str,
        scope: &AssistantQuestionScope,
        data: &Path,
        protection: &Protection,
    ) -> Result<Journal, CreationError> {
        if self.git_ended_tasks.contains(id)
            || self
                .assistant_grant
                .as_ref()
                .is_some_and(|(owner, task, _)| owner == identity && task != id)
        {
            return Err(invalid(
                "This question no longer belongs to the current task",
            ));
        }
        let journal = load(data, &self.current(identity, protection)?.root, id)?;
        if journal.question_scope.as_ref() != Some(scope) {
            return Err(invalid("Question scope does not match its task"));
        }
        Ok(journal)
    }
}

#[cfg(test)]
mod tests;
