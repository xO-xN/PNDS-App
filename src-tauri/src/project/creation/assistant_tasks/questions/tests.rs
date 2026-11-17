use super::*;
use crate::project::creation::tests::project;

fn scope() -> AssistantQuestionScope {
    AssistantQuestionScope {
        chat_id: "chat-a".into(),
        message_id: "reply-a".into(),
    }
}
fn request() -> AssistantQuestionRequest {
    AssistantQuestionRequest {
        prompt: "How should performer gestures affect the pulse?".into(),
        options: vec![AssistantQuestionOption {
            id: "shared".into(),
            label: "Shared pulse".into(),
            description: "Each gesture changes the common pulse".into(),
        }],
        recommended_option_id: Some("shared".into()),
    }
}
fn answer() -> AssistantQuestionAnswer {
    AssistantQuestionAnswer {
        option_id: Some("shared".into()),
        text: None,
    }
}
fn write() -> AssistantWrite {
    AssistantWrite {
        path: "pulse.js".into(),
        version: None,
        text: Some("export const shared = true".into()),
        edits: None,
    }
}

#[test]
fn work_saves_bilingual_readmes_after_the_existing_english_choice() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "bilingual");
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let legacy =
        "# Prior cover\n\ntitle: Prior cover\n\n## Introduction\n\nEarlier audience text.\n";
    let english =
        "# Pulse Field\n\ntitle: Pulse Field\ncomposer: Lin\n\n## Introduction\n\nPlayers trade pulses.\n";
    let chinese = "# 脉冲场\n\ntitle: 脉冲场\ncomposer: Lin\n\n## 作品简介\n\n演奏者交换脉冲。\n";
    std::fs::write(root.join("README.en.md"), legacy).unwrap();
    let variant = access.read(&identity, "README.en.md", &protection).unwrap();
    let CreationContent::Text { version, .. } = variant else {
        panic!("saved English variant is not text");
    };
    let task = access
        .begin_scoped_assistant_task(
            &identity,
            AssistantMode::Edit,
            None,
            Some(&scope()),
            &data,
            &protection,
        )
        .unwrap();
    let cover = |path: &str, version: Option<String>, text: &str| AssistantWrite {
        path: path.into(),
        version,
        text: Some(text.into()),
        edits: None,
    };
    let question = access
        .ask_assistant_question(
            &identity,
            &task.id,
            &scope(),
            &AssistantQuestionRequest {
                prompt: "README.en.md is shown in English. Sync it?".into(),
                options: vec![AssistantQuestionOption {
                    id: "pnds-readme-sync".into(),
                    label: "Sync".into(),
                    description: "Update README.en.md".into(),
                }],
                recommended_option_id: None,
            },
            &data,
            &protection,
        )
        .unwrap()
        .questions
        .remove(0);
    assert!(access
        .write_assistant_file(
            &identity,
            &task.id,
            &cover("README.md", None, english),
            &data,
            &protection
        )
        .is_err());
    assert!(!root.join("README.md").exists());
    access
        .answer_assistant_question(
            &identity,
            &task.id,
            AssistantQuestionSubmission {
                question_id: &question.id,
                scope: &scope(),
                answer: &AssistantQuestionAnswer {
                    option_id: Some("pnds-readme-sync".into()),
                    text: None,
                },
            },
            &data,
            &protection,
        )
        .unwrap();
    for (path, text) in [("README.md", english), ("README.zh-CN.md", chinese)] {
        access
            .write_assistant_file(
                &identity,
                &task.id,
                &cover(path, None, text),
                &data,
                &protection,
            )
            .unwrap();
    }
    assert_eq!(
        crate::project::readme::read_project_readme(root.clone(), Some("en"))
            .unwrap()
            .as_deref(),
        Some(legacy)
    );
    assert_eq!(
        crate::project::readme::read_project_readme(root.clone(), Some("zh-CN"))
            .unwrap()
            .as_deref(),
        Some(chinese)
    );
    assert_eq!(
        crate::project::readme::ParticipationReadmes::capture(&root).for_locale("en"),
        Some(legacy)
    );
    assert_eq!(
        crate::project::readme::ParticipationReadmes::capture(&root).for_locale("zh-CN"),
        Some(chinese)
    );
    access
        .write_assistant_file(
            &identity,
            &task.id,
            &cover("README.en.md", Some(version.clone()), english),
            &data,
            &protection,
        )
        .unwrap();
    assert!(access
        .write_assistant_file(
            &identity,
            &task.id,
            &cover("README.en.md", Some(version), legacy),
            &data,
            &protection
        )
        .is_err());
    assert_eq!(
        crate::project::readme::read_project_readme(root.clone(), Some("en"))
            .unwrap()
            .as_deref(),
        Some(english)
    );
    assert_eq!(
        crate::project::readme::ParticipationReadmes::capture(&root).for_locale("en"),
        Some(english)
    );
}

#[test]
fn question_waits_for_explicit_answer_and_reopen_preserves_facts_without_write_authority() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_scoped_assistant_task(
            &identity,
            AssistantMode::Edit,
            None,
            Some(&scope()),
            &data,
            &protection,
        )
        .unwrap();
    let proposed = access
        .ask_assistant_question(
            &identity,
            &task.id,
            &scope(),
            &request(),
            &data,
            &protection,
        )
        .unwrap();
    let question = &proposed.questions[0];
    assert_eq!(question.status, AssistantQuestionStatus::Pending);
    assert!(question.answer.is_none());
    assert!(access
        .write_assistant_file(&identity, &task.id, &write(), &data, &protection)
        .is_err());
    access.end_assistant_task(&identity, &task.id);

    let mut reopened = CreationAccess::default();
    let identity = reopened.open(&root, &protection).unwrap().project.identity;
    let pending = reopened
        .assistant_questions(&identity, &task.id, &data, &protection)
        .unwrap();
    assert_eq!(pending[0].status, AssistantQuestionStatus::Pending);
    let submitted = reopened
        .answer_assistant_question(
            &identity,
            &task.id,
            AssistantQuestionSubmission {
                question_id: &question.id,
                scope: &scope(),
                answer: &answer(),
            },
            &data,
            &protection,
        )
        .unwrap();
    assert_eq!(submitted.status, AssistantQuestionStatus::Answered);
    assert_eq!(
        submitted.answer.unwrap().option_id.as_deref(),
        Some("shared")
    );
    assert!(reopened
        .write_assistant_file(&identity, &task.id, &write(), &data, &protection)
        .is_err());
    assert_eq!(
        reopened
            .assistant_questions(&identity, &task.id, &data, &protection)
            .unwrap()[0]
            .status,
        AssistantQuestionStatus::Answered
    );
    reopened
        .begin_scoped_assistant_task(
            &identity,
            AssistantMode::Edit,
            Some(&task.id),
            Some(&scope()),
            &data,
            &protection,
        )
        .unwrap();
    reopened
        .write_assistant_file(&identity, &task.id, &write(), &data, &protection)
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(root.join("pulse.js")).unwrap(),
        "export const shared = true"
    );
}

#[test]
fn question_answers_refuse_wrong_scope_duplicates_cancelled_cards_and_late_tasks() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_scoped_assistant_task(
            &identity,
            AssistantMode::Edit,
            None,
            Some(&scope()),
            &data,
            &protection,
        )
        .unwrap();
    let proposed = access
        .ask_assistant_question(
            &identity,
            &task.id,
            &scope(),
            &request(),
            &data,
            &protection,
        )
        .unwrap();
    let id = &proposed.questions[0].id;
    assert!(access
        .ask_assistant_question(
            &identity,
            &task.id,
            &scope(),
            &request(),
            &data,
            &protection
        )
        .is_err());
    let other_scope = AssistantQuestionScope {
        chat_id: "chat-b".into(),
        ..scope()
    };
    assert!(access
        .answer_assistant_question(
            &identity,
            &task.id,
            AssistantQuestionSubmission {
                question_id: id,
                scope: &other_scope,
                answer: &answer()
            },
            &data,
            &protection
        )
        .is_err());
    for invalid in [
        AssistantQuestionAnswer {
            option_id: None,
            text: None,
        },
        AssistantQuestionAnswer {
            option_id: Some("missing".into()),
            text: None,
        },
        AssistantQuestionAnswer {
            option_id: Some("shared".into()),
            text: Some("both".into()),
        },
        AssistantQuestionAnswer {
            option_id: None,
            text: Some(" ".into()),
        },
        AssistantQuestionAnswer {
            option_id: None,
            text: Some("x".repeat(4001)),
        },
    ] {
        assert!(access
            .answer_assistant_question(
                &identity,
                &task.id,
                AssistantQuestionSubmission {
                    question_id: id,
                    scope: &scope(),
                    answer: &invalid
                },
                &data,
                &protection
            )
            .is_err());
    }
    let free = AssistantQuestionAnswer {
        option_id: None,
        text: Some("Let each performer decide the local pulse".into()),
    };
    let answered = access
        .answer_assistant_question(
            &identity,
            &task.id,
            AssistantQuestionSubmission {
                question_id: id,
                scope: &scope(),
                answer: &free,
            },
            &data,
            &protection,
        )
        .unwrap();
    assert_eq!(
        answered.answer.unwrap().text.as_deref(),
        Some("Let each performer decide the local pulse")
    );
    assert!(access
        .answer_assistant_question(
            &identity,
            &task.id,
            AssistantQuestionSubmission {
                question_id: id,
                scope: &scope(),
                answer: &answer()
            },
            &data,
            &protection
        )
        .is_err());
    let next = access
        .ask_assistant_question(
            &identity,
            &task.id,
            &scope(),
            &request(),
            &data,
            &protection,
        )
        .unwrap();
    let next_id = &next.questions[1].id;
    assert!(access
        .answer_assistant_question(
            &identity,
            &task.id,
            AssistantQuestionSubmission {
                question_id: id,
                scope: &scope(),
                answer: &answer()
            },
            &data,
            &protection
        )
        .is_err());
    access
        .cancel_assistant_question(&identity, &task.id, next_id, &scope(), &data, &protection)
        .unwrap();
    assert!(access
        .answer_assistant_question(
            &identity,
            &task.id,
            AssistantQuestionSubmission {
                question_id: next_id,
                scope: &scope(),
                answer: &answer()
            },
            &data,
            &protection
        )
        .is_err());
    let third = access
        .ask_assistant_question(
            &identity,
            &task.id,
            &scope(),
            &request(),
            &data,
            &protection,
        )
        .unwrap();
    let third_id = &third.questions[2].id;
    access.end_assistant_task(&identity, &task.id);
    access
        .begin_scoped_assistant_task(
            &identity,
            AssistantMode::Edit,
            None,
            Some(&other_scope),
            &data,
            &protection,
        )
        .unwrap();
    assert!(access
        .answer_assistant_question(
            &identity,
            &task.id,
            AssistantQuestionSubmission {
                question_id: third_id,
                scope: &scope(),
                answer: &answer()
            },
            &data,
            &protection
        )
        .is_err());
    assert!(access
        .begin_scoped_assistant_task(
            &identity,
            AssistantMode::Edit,
            Some(&task.id),
            Some(&other_scope),
            &data,
            &protection
        )
        .is_err());
    let other_root = project(temp.path(), "other");
    let other_identity = access
        .open(&other_root, &protection)
        .unwrap()
        .project
        .identity;
    assert!(access
        .answer_assistant_question(
            &other_identity,
            &task.id,
            AssistantQuestionSubmission {
                question_id: third_id,
                scope: &scope(),
                answer: &answer()
            },
            &data,
            &protection
        )
        .is_err());
}

#[test]
fn discussion_answer_does_not_authorize_project_or_handoff_writes() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_scoped_assistant_task(
            &identity,
            AssistantMode::Discussion,
            None,
            Some(&scope()),
            &data,
            &protection,
        )
        .unwrap();
    let proposed = access
        .ask_assistant_question(
            &identity,
            &task.id,
            &scope(),
            &request(),
            &data,
            &protection,
        )
        .unwrap();
    let question = &proposed.questions[0];
    access
        .answer_assistant_question(
            &identity,
            &task.id,
            AssistantQuestionSubmission {
                question_id: &question.id,
                scope: &scope(),
                answer: &answer(),
            },
            &data,
            &protection,
        )
        .unwrap();
    assert!(access
        .write_assistant_file(&identity, &task.id, &write(), &data, &protection)
        .is_err());
    let handoff = AssistantWrite {
        path: "docs/creator-handoff.md".into(),
        ..write()
    };
    assert!(access
        .write_assistant_file(&identity, &task.id, &handoff, &data, &protection)
        .is_err());
    assert!(!root.join("docs/creator-handoff.md").exists());
    access.end_assistant_task(&identity, &task.id);
    access
        .begin_scoped_assistant_task(
            &identity,
            AssistantMode::Discussion,
            Some(&task.id),
            Some(&scope()),
            &data,
            &protection,
        )
        .unwrap();
    assert!(access
        .write_assistant_file(&identity, &task.id, &handoff, &data, &protection)
        .is_err());
}

#[test]
fn pending_question_blocks_checks_and_resources_without_extending_edit_approval() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_scoped_assistant_task(
            &identity,
            AssistantMode::Edit,
            None,
            Some(&scope()),
            &data,
            &protection,
        )
        .unwrap();
    let proposed = access
        .ask_assistant_question(
            &identity,
            &task.id,
            &scope(),
            &request(),
            &data,
            &protection,
        )
        .unwrap();
    assert!(access
        .authorize_assistant_check(&identity, &task.id, &data, &protection)
        .is_err());
    let resources = AssistantResourceRequest {
        modules: vec!["players".into()],
        libraries: vec![],
        reason: "Use client identity".into(),
        alternative: None,
    };
    assert!(access
        .propose_assistant_resources(
            &identity,
            &task.id,
            &resources,
            &data,
            temp.path(),
            &protection
        )
        .is_err());
    assert!(access
        .adopt_assistant_module(
            &identity,
            &task.id,
            "players",
            &data,
            temp.path(),
            &protection
        )
        .is_err());
    access
        .answer_assistant_question(
            &identity,
            &task.id,
            AssistantQuestionSubmission {
                question_id: &proposed.questions[0].id,
                scope: &scope(),
                answer: &answer(),
            },
            &data,
            &protection,
        )
        .unwrap();
    access
        .authorize_assistant_check(&identity, &task.id, &data, &protection)
        .unwrap();
    assert!(access
        .adopt_assistant_module(
            &identity,
            &task.id,
            "players",
            &data,
            temp.path(),
            &protection
        )
        .is_err());
    assert!(!root.join("modules").exists());
    access
        .write_assistant_file(&identity, &task.id, &write(), &data, &protection)
        .unwrap();
    let next = access
        .ask_assistant_question(
            &identity,
            &task.id,
            &scope(),
            &request(),
            &data,
            &protection,
        )
        .unwrap();
    std::fs::write(root.join("pulse.js"), "changed outside the task").unwrap();
    assert_eq!(
        access
            .answer_assistant_question(
                &identity,
                &task.id,
                AssistantQuestionSubmission {
                    question_id: &next.questions[1].id,
                    scope: &scope(),
                    answer: &answer()
                },
                &data,
                &protection
            )
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    assert_eq!(
        access
            .assistant_questions(&identity, &task.id, &data, &protection)
            .unwrap()[1]
            .status,
        AssistantQuestionStatus::Pending
    );
}

#[test]
fn legacy_task_requires_explicit_scope_binding_and_question_checkpoint_restores_without_grant() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    assert!(access
        .ask_assistant_question(
            &identity,
            &task.id,
            &scope(),
            &request(),
            &data,
            &protection
        )
        .is_err());
    access.end_assistant_task(&identity, &task.id);
    access
        .begin_scoped_assistant_task(
            &identity,
            AssistantMode::Edit,
            Some(&task.id),
            Some(&scope()),
            &data,
            &protection,
        )
        .unwrap();
    let proposed = access
        .ask_assistant_question(
            &identity,
            &task.id,
            &scope(),
            &request(),
            &data,
            &protection,
        )
        .unwrap();
    let record = AssistantTaskResume {
        task_id: task.id.clone(),
        mode: AssistantMode::Edit,
        user_message_id: "user-a".into(),
        reply_message_id: "reply-a".into(),
        conversation_id: Some("chat-a".into()),
        input: "Implement a shared pulse".into(),
        locale: "en".into(),
        model_key: "local-model".into(),
        state: AssistantTaskResumeState::AwaitingQuestion,
        payload: serde_json::json!({"waitingQuestionId": proposed.questions[0].id}).to_string(),
    };
    access
        .save_assistant_resume(&identity, record, &data, &protection)
        .unwrap();
    let mut reopened = CreationAccess::default();
    let identity = reopened.open(&root, &protection).unwrap().project.identity;
    let recovered = reopened
        .load_assistant_resume(&identity, &data, &protection)
        .unwrap()
        .unwrap();
    assert_eq!(
        recovered.record.state,
        AssistantTaskResumeState::AwaitingQuestion
    );
    assert_eq!(recovered.record.task_id, task.id);
    assert_eq!(
        reopened
            .assistant_questions(&identity, &task.id, &data, &protection)
            .unwrap()[0]
            .status,
        AssistantQuestionStatus::Pending
    );
    assert!(reopened
        .authorize_assistant_task(&identity, &task.id, true, &protection)
        .is_err());
    assert!(reopened
        .write_assistant_file(&identity, &task.id, &write(), &data, &protection)
        .is_err());
}
