use super::*;

fn scope() -> AssistantQuestionScope {
    AssistantQuestionScope {
        chat_id: "material-chat".into(),
        message_id: "material-reply".into(),
    }
}

#[test]
fn scoped_material_replace_waits_for_its_answer_and_restores_the_original() {
    let temp = tempfile::tempdir().unwrap();
    let root = crate::project::creation::tests::project(temp.path(), "score");
    let data = temp.path().join("data");
    let source = temp.path().join("Grid.js");
    fs::write(&source, "class Grid { size = 8; }").unwrap();
    fs::write(root.join("Grid.js"), "class Grid { size = 3; }").unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let material = access
        .add_material(&data, &identity, &source, &protection)
        .unwrap();
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
    let adoption = AssistantMaterialAdoption {
        id: material.id.clone(),
        version: material.version.clone(),
        path: "Grid.js".into(),
        text: None,
    };
    let waiting = access
        .adopt_assistant_material(&identity, &task.id, &adoption, &data, &protection)
        .unwrap();
    assert_eq!(
        waiting.questions[0].status,
        AssistantQuestionStatus::Pending
    );
    assert_eq!(
        fs::read_to_string(root.join("Grid.js")).unwrap(),
        "class Grid { size = 3; }"
    );
    access
        .answer_assistant_question(
            &identity,
            &task.id,
            AssistantQuestionSubmission {
                question_id: &waiting.questions[0].id,
                scope: &scope(),
                answer: &AssistantQuestionAnswer {
                    option_id: Some("replace".into()),
                    text: None,
                },
            },
            &data,
            &protection,
        )
        .unwrap();
    let saved = access
        .adopt_assistant_material(&identity, &task.id, &adoption, &data, &protection)
        .unwrap();
    assert_eq!(saved.files.len(), 1);
    assert_eq!(
        fs::read_to_string(root.join("Grid.js")).unwrap(),
        "class Grid { size = 8; }"
    );
    access.end_assistant_task(&identity, &task.id);
    access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("Grid.js")).unwrap(),
        "class Grid { size = 3; }"
    );
    assert_eq!(
        access
            .material_text(
                &data,
                &identity,
                &material.id,
                &material.version,
                &protection
            )
            .unwrap(),
        "class Grid { size = 8; }"
    );
}

struct Collision {
    _temp: tempfile::TempDir,
    root: PathBuf,
    data: PathBuf,
    access: CreationAccess,
    identity: String,
    task: AssistantTask,
    adoption: AssistantMaterialAdoption,
}
impl Collision {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = crate::project::creation::tests::project(temp.path(), "score");
        let data = temp.path().join("data");
        let source = temp.path().join("Grid.js");
        fs::write(&source, "class Grid { size = 8; }").unwrap();
        fs::write(root.join("Grid.js"), "class Grid { size = 3; }").unwrap();
        let mut access = CreationAccess::default();
        let identity = access
            .open(&root, &Protection::default())
            .unwrap()
            .project
            .identity;
        let material = access
            .add_material(&data, &identity, &source, &Protection::default())
            .unwrap();
        let task = access
            .begin_scoped_assistant_task(
                &identity,
                AssistantMode::Edit,
                None,
                Some(&scope()),
                &data,
                &Protection::default(),
            )
            .unwrap();
        let adoption = AssistantMaterialAdoption {
            id: material.id,
            version: material.version,
            path: "Grid.js".into(),
            text: None,
        };
        let task = access
            .adopt_assistant_material(
                &identity,
                &task.id,
                &adoption,
                &data,
                &Protection::default(),
            )
            .unwrap();
        Self {
            _temp: temp,
            root,
            data,
            access,
            identity,
            task,
            adoption,
        }
    }
    fn answer(
        &self,
        question: &AssistantQuestion,
        answer: AssistantQuestionAnswer,
    ) -> Result<AssistantQuestion, CreationError> {
        self.access.answer_assistant_question(
            &self.identity,
            &self.task.id,
            AssistantQuestionSubmission {
                question_id: &question.id,
                scope: &scope(),
                answer: &answer,
            },
            &self.data,
            &Protection::default(),
        )
    }
    fn adopt(&mut self) -> Result<AssistantTask, CreationError> {
        self.access.adopt_assistant_material(
            &self.identity,
            &self.task.id,
            &self.adoption,
            &self.data,
            &Protection::default(),
        )
    }
    fn resume(&mut self) -> Result<AssistantTask, CreationError> {
        self.access.begin_scoped_assistant_task(
            &self.identity,
            AssistantMode::Edit,
            Some(&self.task.id),
            Some(&scope()),
            &self.data,
            &Protection::default(),
        )
    }
}
fn choice(option: &str) -> AssistantQuestionAnswer {
    AssistantQuestionAnswer {
        option_id: Some(option.into()),
        text: None,
    }
}

#[test]
fn changed_material_target_requires_a_fresh_same_task_question_on_explicit_resume() {
    let mut fixture = Collision::new();
    let original = fixture.task.questions[0].clone();
    fixture.answer(&original, choice("replace")).unwrap();
    fs::write(fixture.root.join("Grid.js"), "creator later grid").unwrap();
    assert_eq!(
        fixture.adopt().unwrap_err().code,
        CreationErrorCode::VersionConflict
    );
    let resumed = fixture.resume().unwrap();
    let fresh = resumed.questions.last().unwrap();
    assert_ne!(fresh.id, original.id);
    assert_eq!(fresh.status, AssistantQuestionStatus::Pending);
    assert_eq!(
        fresh
            .material_conflict
            .as_ref()
            .unwrap()
            .supersedes_question_id
            .as_deref(),
        Some(original.id.as_str())
    );
    assert_eq!(
        fresh.material_conflict.as_ref().unwrap().saved_excerpt,
        "creator later grid"
    );
    assert_eq!(
        fs::read_to_string(fixture.root.join("Grid.js")).unwrap(),
        "creator later grid"
    );
    assert!(fixture.answer(&original, choice("replace")).is_err());
    fixture.answer(fresh, choice("replace")).unwrap();
    let receipt = fixture.adopt().unwrap();
    assert_eq!(receipt.material_adoptions[0].question_id, fresh.id);
}

#[test]
fn scoped_coexistence_retains_the_original_reservation_and_protects_later_edits_and_undo() {
    let mut fixture = Collision::new();
    let question = fixture.task.questions[0].clone();
    let facts = question.material_conflict.as_ref().unwrap();
    assert_eq!(facts.saved_excerpt, "class Grid { size = 3; }");
    assert_eq!(facts.candidate_excerpt, "class Grid { size = 8; }");
    assert_eq!(facts.coexist_path, "Grid-imported.js");
    fixture.answer(&question, choice("coexist")).unwrap();
    let adopted = fixture.adopt().unwrap();
    assert_eq!(adopted.material_adoptions[0].path, "Grid-imported.js");
    assert_eq!(
        fs::read_to_string(fixture.root.join("Grid.js")).unwrap(),
        "class Grid { size = 3; }"
    );
    assert_eq!(
        fs::read_to_string(fixture.root.join("Grid-imported.js")).unwrap(),
        "class Grid { size = 8; }"
    );
    assert_eq!(fixture.adopt().unwrap().files.len(), 1);
    let (_, version) = text_content(
        fixture
            .access
            .read(&fixture.identity, "Grid.js", &Protection::default())
            .unwrap(),
    )
    .unwrap();
    assert!(fixture
        .access
        .write_assistant_file(
            &fixture.identity,
            &fixture.task.id,
            &AssistantWrite {
                path: "Grid.js".into(),
                version: Some(version.clone()),
                text: Some("bypass".into()),
                edits: None
            },
            &fixture.data,
            &Protection::default()
        )
        .is_err());
    assert!(fixture
        .access
        .remove_assistant_file(
            &fixture.identity,
            &fixture.task.id,
            "Grid.js",
            &version,
            &fixture.data,
            &Protection::default()
        )
        .is_err());
    fixture
        .access
        .end_assistant_task(&fixture.identity, &fixture.task.id);
    fs::write(
        fixture.root.join("Grid-imported.js"),
        "later creator change",
    )
    .unwrap();
    assert!(fixture
        .access
        .undo_assistant_task(
            &fixture.identity,
            &fixture.task.id,
            None,
            &fixture.data,
            &Protection::default()
        )
        .is_err());
    assert_eq!(
        fs::read_to_string(fixture.root.join("Grid-imported.js")).unwrap(),
        "later creator change"
    );
    fs::write(
        fixture.root.join("Grid-imported.js"),
        "class Grid { size = 8; }",
    )
    .unwrap();
    fixture
        .access
        .undo_assistant_task(
            &fixture.identity,
            &fixture.task.id,
            Some("Grid-imported.js"),
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    assert!(!fixture.root.join("Grid-imported.js").exists());
    assert_eq!(
        fs::read_to_string(fixture.root.join("Grid.js")).unwrap(),
        "class Grid { size = 3; }"
    );
}

#[test]
fn material_free_text_keeps_its_target_protected_and_can_continue_at_a_safe_new_path() {
    let mut fixture = Collision::new();
    fixture
        .answer(
            &fixture.task.questions[0],
            AssistantQuestionAnswer {
                option_id: None,
                text: Some("Keep my original and explain the rhythm first".into()),
            },
        )
        .unwrap();
    let guidance = fixture.adopt().unwrap();
    assert!(guidance.material_adoptions.is_empty());
    assert!(guidance.files.is_empty());
    fixture.adoption.path = "Grid-new.js".into();
    fixture.adopt().unwrap();
    assert_eq!(
        fs::read_to_string(fixture.root.join("Grid.js")).unwrap(),
        "class Grid { size = 3; }"
    );
    assert_eq!(
        fs::read_to_string(fixture.root.join("Grid-new.js")).unwrap(),
        "class Grid { size = 8; }"
    );
}

#[test]
fn material_consumption_rechecks_changed_candidate_target_source_and_coexistence_path() {
    for changed in ["candidate", "target", "source", "coexist"] {
        let mut fixture = Collision::new();
        let question = fixture.task.questions[0].clone();
        fixture
            .answer(
                &question,
                choice(if changed == "coexist" {
                    "coexist"
                } else {
                    "replace"
                }),
            )
            .unwrap();
        match changed {
            "candidate" => {
                fixture.adoption.text = Some("new candidate without a new decision".into())
            }
            "target" => fs::write(fixture.root.join("Grid.js"), "later target").unwrap(),
            "source" => {
                fixture
                    .access
                    .remove_material(
                        &fixture.data,
                        &fixture.identity,
                        &fixture.adoption.id,
                        &Protection::default(),
                    )
                    .unwrap();
            }
            "coexist" => {
                fs::write(fixture.root.join("Grid-imported.js"), "later alternate").unwrap()
            }
            _ => unreachable!(),
        }
        assert!(fixture.adopt().is_err(), "{changed}");
        assert_eq!(
            fs::read_to_string(fixture.root.join("Grid.js")).unwrap(),
            if changed == "target" {
                "later target"
            } else {
                "class Grid { size = 3; }"
            }
        );
        if changed == "coexist" {
            assert_eq!(
                fs::read_to_string(fixture.root.join("Grid-imported.js")).unwrap(),
                "later alternate"
            );
        }
    }
}

#[test]
fn scoped_material_answers_reject_wrong_scope_duplicate_cancelled_and_new_grant_consumption() {
    let mut fixture = Collision::new();
    let question = fixture.task.questions[0].clone();
    let wrong = AssistantQuestionScope {
        chat_id: "other-chat".into(),
        ..scope()
    };
    assert!(fixture
        .access
        .answer_assistant_question(
            &fixture.identity,
            &fixture.task.id,
            AssistantQuestionSubmission {
                question_id: &question.id,
                scope: &wrong,
                answer: &choice("replace")
            },
            &fixture.data,
            &Protection::default()
        )
        .is_err());
    assert_eq!(
        fixture.adopt().unwrap().questions[0].status,
        AssistantQuestionStatus::Pending
    );
    fixture
        .access
        .cancel_assistant_question(
            &fixture.identity,
            &fixture.task.id,
            &question.id,
            &scope(),
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    assert!(fixture.answer(&question, choice("replace")).is_err());
    assert!(fixture.adopt().is_err());
    fixture
        .access
        .end_assistant_task(&fixture.identity, &fixture.task.id);
    let another = fixture
        .access
        .begin_scoped_assistant_task(
            &fixture.identity,
            AssistantMode::Edit,
            None,
            Some(&wrong),
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    assert_ne!(another.id, fixture.task.id);
    assert!(fixture.adopt().is_err());
    assert!(fixture.answer(&question, choice("replace")).is_err());
    assert_eq!(
        fs::read_to_string(fixture.root.join("Grid.js")).unwrap(),
        "class Grid { size = 3; }"
    );
    let mut fixture = Collision::new();
    let question = fixture.task.questions[0].clone();
    fixture.answer(&question, choice("replace")).unwrap();
    assert!(fixture.answer(&question, choice("coexist")).is_err());
    fixture.adopt().unwrap();
    assert!(fixture.answer(&question, choice("replace")).is_err());
}

#[test]
fn real_material_decision_survives_restart_without_restoring_a_write_grant() {
    for answered in [false, true] {
        let mut fixture = Collision::new();
        let question = fixture.task.questions[0].clone();
        if answered {
            fixture.answer(&question, choice("replace")).unwrap();
        }
        fixture
            .access
            .end_assistant_task(&fixture.identity, &fixture.task.id);
        fixture.access = CreationAccess::default();
        fixture.identity = fixture
            .access
            .open(&fixture.root, &Protection::default())
            .unwrap()
            .project
            .identity;
        assert!(fixture.adopt().is_err());
        let questions = fixture
            .access
            .assistant_questions(
                &fixture.identity,
                &fixture.task.id,
                &fixture.data,
                &Protection::default(),
            )
            .unwrap();
        assert_eq!(questions[0].material_conflict, question.material_conflict);
        if !answered {
            fixture.answer(&questions[0], choice("replace")).unwrap();
        }
        assert!(fixture.adopt().is_err());
        fixture.resume().unwrap();
        fixture.adopt().unwrap();
        assert_eq!(
            fs::read_to_string(fixture.root.join("Grid.js")).unwrap(),
            "class Grid { size = 8; }"
        );
    }
}

#[test]
fn crash_after_material_publication_reconciles_the_exact_saved_receipt_without_a_second_write() {
    let mut fixture = Collision::new();
    fixture
        .answer(&fixture.task.questions[0], choice("coexist"))
        .unwrap();
    fixture.adopt().unwrap();
    fixture
        .access
        .end_assistant_task(&fixture.identity, &fixture.task.id);
    let journal_path = journal_directory(&fixture.data, &fs::canonicalize(&fixture.root).unwrap())
        .join(format!("{}.json", fixture.task.id));
    let mut journal: serde_json::Value =
        serde_json::from_slice(&fs::read(&journal_path).unwrap()).unwrap();
    journal["material_conflicts"][0]["receipt"] = serde_json::Value::Null;
    journal["entries"][0]["pending"] = serde_json::json!("class Grid { size = 8; }");
    journal["entries"][0]["after"] = serde_json::json!("");
    fs::write(&journal_path, serde_json::to_vec(&journal).unwrap()).unwrap();
    fixture.access = CreationAccess::default();
    fixture.identity = fixture
        .access
        .open(&fixture.root, &Protection::default())
        .unwrap()
        .project
        .identity;
    assert!(fixture.adopt().is_err());
    fixture.resume().unwrap();
    let saved = fixture.adopt().unwrap();
    assert_eq!(saved.files.len(), 1);
    assert_eq!(saved.material_adoptions[0].path, "Grid-imported.js");
    assert_eq!(
        fixture.adopt().unwrap().material_adoptions[0].version,
        saved.material_adoptions[0].version
    );
    fs::write(fixture.root.join("Grid-imported.js"), "later creator edit").unwrap();
    assert!(fixture.adopt().is_err());
    assert_eq!(
        fs::read_to_string(fixture.root.join("Grid-imported.js")).unwrap(),
        "later creator edit"
    );
}

#[test]
fn material_difference_excerpts_show_the_actual_change_even_after_a_long_common_prefix() {
    let mut fixture = Collision::new();
    fixture
        .access
        .cancel_assistant_question(
            &fixture.identity,
            &fixture.task.id,
            &fixture.task.questions[0].id,
            &scope(),
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    fixture
        .access
        .end_assistant_task(&fixture.identity, &fixture.task.id);
    let task = fixture
        .access
        .begin_scoped_assistant_task(
            &fixture.identity,
            AssistantMode::Edit,
            None,
            Some(&scope()),
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    fixture.task = task;
    let prefix = "same ".repeat(1000);
    fs::write(
        fixture.root.join("Grid.js"),
        format!("{prefix}old-value\r\n"),
    )
    .unwrap();
    fixture.adoption.text = Some(format!("{prefix}new-value\n"));
    let waiting = fixture.adopt().unwrap();
    let facts = waiting.questions[0].material_conflict.as_ref().unwrap();
    assert!(facts.saved_excerpt.contains("old-value\r\n"));
    assert!(facts.candidate_excerpt.contains("new-value\n"));
    assert!(facts.saved_excerpt.chars().count() <= 1600);
    assert!(facts.truncated);
}

#[test]
fn earlier_material_reservation_upgrades_only_after_explicit_scoped_adoption() {
    let mut fixture = Collision::new();
    fixture
        .access
        .cancel_assistant_question(
            &fixture.identity,
            &fixture.task.id,
            &fixture.task.questions[0].id,
            &scope(),
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    fixture
        .access
        .end_assistant_task(&fixture.identity, &fixture.task.id);
    fixture.task = fixture
        .access
        .begin_assistant_task(
            &fixture.identity,
            AssistantMode::Edit,
            None,
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    assert_eq!(
        fixture.adopt().unwrap_err().code,
        CreationErrorCode::TargetExists
    );
    fixture
        .access
        .end_assistant_task(&fixture.identity, &fixture.task.id);
    let resumed = fixture.resume().unwrap();
    assert!(resumed.questions.is_empty());
    let waiting = fixture.adopt().unwrap();
    assert_eq!(
        waiting.questions[0].status,
        AssistantQuestionStatus::Pending
    );
    assert_eq!(
        fs::read_to_string(fixture.root.join("Grid.js")).unwrap(),
        "class Grid { size = 3; }"
    );
    fixture
        .answer(&waiting.questions[0], choice("replace"))
        .unwrap();
    fixture.adopt().unwrap();
    assert_eq!(
        fs::read_to_string(fixture.root.join("Grid.js")).unwrap(),
        "class Grid { size = 8; }"
    );
}

#[test]
fn ordinary_question_with_the_same_option_ids_cannot_consume_a_material_conflict() {
    let mut fixture = Collision::new();
    fixture
        .answer(
            &fixture.task.questions[0],
            AssistantQuestionAnswer {
                option_id: None,
                text: Some("Explain first".into()),
            },
        )
        .unwrap();
    let generic = fixture
        .access
        .ask_assistant_question(
            &fixture.identity,
            &fixture.task.id,
            &scope(),
            &AssistantQuestionRequest {
                prompt: "Replace the rhythm or keep both voices?".into(),
                options: vec![
                    AssistantQuestionOption {
                        id: "replace".into(),
                        label: "Replace rhythm".into(),
                        description: String::new(),
                    },
                    AssistantQuestionOption {
                        id: "coexist".into(),
                        label: "Keep both voices".into(),
                        description: String::new(),
                    },
                ],
                recommended_option_id: Some("replace".into()),
            },
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    fixture
        .answer(generic.questions.last().unwrap(), choice("replace"))
        .unwrap();
    assert!(fixture.adopt().unwrap().files.is_empty());
    let (_, version) = text_content(
        fixture
            .access
            .read(&fixture.identity, "Grid.js", &Protection::default())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        fixture
            .access
            .write_assistant_file(
                &fixture.identity,
                &fixture.task.id,
                &AssistantWrite {
                    path: "Grid.js".into(),
                    version: Some(version),
                    text: Some("ordinary answer bypass".into()),
                    edits: None
                },
                &fixture.data,
                &Protection::default()
            )
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    assert_eq!(
        fs::read_to_string(fixture.root.join("Grid.js")).unwrap(),
        "class Grid { size = 3; }"
    );
}

#[test]
fn malformed_material_reservations_fail_closed_on_real_task_reopen() {
    for field in [
        "candidate",
        "material_id",
        "question_id",
        "coexist_path",
        "superseded",
        "receipt",
    ] {
        let mut fixture = Collision::new();
        fixture
            .access
            .end_assistant_task(&fixture.identity, &fixture.task.id);
        let journal_path =
            journal_directory(&fixture.data, &fs::canonicalize(&fixture.root).unwrap())
                .join(format!("{}.json", fixture.task.id));
        let mut journal: serde_json::Value =
            serde_json::from_slice(&fs::read(&journal_path).unwrap()).unwrap();
        journal["material_conflicts"][0][field] = match field {
            "superseded" => serde_json::json!(true),
            "receipt" => {
                serde_json::json!({ "questionId": fixture.task.questions[0].id, "materialId": fixture.adoption.id, "materialVersion": fixture.adoption.version, "targetPath": "Grid.js", "path": "Grid.js", "version": "forged", "candidateSha256": "a".repeat(64) })
            }
            _ => serde_json::json!("forged"),
        };
        fs::write(journal_path, serde_json::to_vec(&journal).unwrap()).unwrap();
        assert!(fixture.resume().is_err(), "{field}");
        assert_eq!(
            fs::read_to_string(fixture.root.join("Grid.js")).unwrap(),
            "class Grid { size = 3; }"
        );
    }
}

#[test]
fn a_target_published_during_material_creation_becomes_a_scoped_conflict_and_stays_reserved() {
    use std::io::Write;
    let temp = tempfile::tempdir().unwrap();
    let root = crate::project::creation::tests::project(temp.path(), "score");
    let data = temp.path().join("data");
    let source = temp.path().join("Race.js");
    let candidate = "/".repeat(TEXT_MAX_BYTES as usize);
    fs::write(&source, &candidate).unwrap();
    let mut access = CreationAccess::default();
    let identity = access
        .open(&root, &Protection::default())
        .unwrap()
        .project
        .identity;
    let material = access
        .add_material(&data, &identity, &source, &Protection::default())
        .unwrap();
    let task = access
        .begin_scoped_assistant_task(
            &identity,
            AssistantMode::Edit,
            None,
            Some(&scope()),
            &data,
            &Protection::default(),
        )
        .unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let actor_barrier = barrier.clone();
    let actor_root = root.clone();
    let actor = std::thread::spawn(move || {
        actor_barrier.wait();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            if fs::read_dir(&actor_root).unwrap().flatten().any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".pnds-save-task-")
            }) {
                let mut file = fs::OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(actor_root.join("Race.js"))
                    .expect("racing creator publishes first");
                file.write_all(b"creator published during adoption")
                    .unwrap();
                return;
            }
            std::thread::yield_now();
        }
        panic!("Native publication staging was not observed");
    });
    barrier.wait();
    let waiting = access
        .adopt_assistant_material(
            &identity,
            &task.id,
            &AssistantMaterialAdoption {
                id: material.id.clone(),
                version: material.version.clone(),
                path: "Race.js".into(),
                text: None,
            },
            &data,
            &Protection::default(),
        )
        .unwrap();
    actor.join().unwrap();
    assert_eq!(
        waiting.questions[0].status,
        AssistantQuestionStatus::Pending
    );
    assert_eq!(
        fs::read_to_string(root.join("Race.js")).unwrap(),
        "creator published during adoption"
    );
    assert!(waiting.files.is_empty());
    let (_, version) = text_content(
        access
            .read(&identity, "Race.js", &Protection::default())
            .unwrap(),
    )
    .unwrap();
    assert!(access
        .write_assistant_file(
            &identity,
            &task.id,
            &AssistantWrite {
                path: "Race.js".into(),
                version: Some(version),
                text: Some(candidate.clone()),
                edits: None
            },
            &data,
            &Protection::default()
        )
        .is_err());
    assert_eq!(
        access
            .material_text(
                &data,
                &identity,
                &material.id,
                &material.version,
                &Protection::default()
            )
            .unwrap(),
        candidate
    );
}

#[test]
fn material_free_text_can_clarify_then_obtain_a_fresh_same_path_choice_in_the_original_task() {
    let mut fixture = Collision::new();
    let first = fixture.task.questions[0].clone();
    fixture
        .answer(
            &first,
            AssistantQuestionAnswer {
                option_id: None,
                text: Some("Explain before I choose".into()),
            },
        )
        .unwrap();
    assert!(fixture.adopt().unwrap().files.is_empty());
    let clarified = fixture
        .access
        .ask_assistant_question(
            &fixture.identity,
            &fixture.task.id,
            &scope(),
            &AssistantQuestionRequest {
                prompt: "Should the existing pulse remain while the implementation changes?".into(),
                options: vec![],
                recommended_option_id: None,
            },
            &fixture.data,
            &Protection::default(),
        )
        .unwrap();
    fixture
        .answer(
            clarified.questions.last().unwrap(),
            AssistantQuestionAnswer {
                option_id: None,
                text: Some("Yes, keep the original pulse".into()),
            },
        )
        .unwrap();
    let waiting = fixture.adopt().unwrap();
    let next = waiting.questions.last().unwrap();
    assert_ne!(next.id, first.id);
    assert_eq!(next.status, AssistantQuestionStatus::Pending);
    assert_eq!(
        next.material_conflict
            .as_ref()
            .unwrap()
            .supersedes_question_id
            .as_deref(),
        Some(first.id.as_str())
    );
    assert_eq!(
        fs::read_to_string(fixture.root.join("Grid.js")).unwrap(),
        "class Grid { size = 3; }"
    );
    fixture.answer(next, choice("replace")).unwrap();
    let saved = fixture.adopt().unwrap();
    assert_eq!(saved.id, fixture.task.id);
    assert_eq!(
        saved.questions[0].answer.as_ref().unwrap().text.as_deref(),
        Some("Explain before I choose")
    );
    assert_eq!(saved.material_adoptions[0].question_id, next.id);
    assert_eq!(
        fs::read_to_string(fixture.root.join("Grid.js")).unwrap(),
        "class Grid { size = 8; }"
    );
}

#[test]
fn long_material_paths_keep_answers_restart_consumption_and_earlier_task_undo_usable() {
    for option in ["replace", "coexist"] {
        let mut fixture = Collision::new();
        fixture
            .access
            .cancel_assistant_question(
                &fixture.identity,
                &fixture.task.id,
                &fixture.task.questions[0].id,
                &scope(),
                &fixture.data,
                &Protection::default(),
            )
            .unwrap();
        let directory = format!("{}/{}/{}", "d".repeat(60), "e".repeat(60), "f".repeat(65));
        fixture.adoption.path = format!("{directory}/Grid.js");
        assert_eq!(fixture.adoption.path.chars().count(), 195);
        fs::create_dir_all(fixture.root.join(&directory)).unwrap();
        fs::write(
            fixture.root.join(&fixture.adoption.path),
            "creator nested grid",
        )
        .unwrap();
        fixture
            .access
            .end_assistant_task(&fixture.identity, &fixture.task.id);
        fixture.task = fixture
            .access
            .begin_scoped_assistant_task(
                &fixture.identity,
                AssistantMode::Edit,
                None,
                Some(&scope()),
                &fixture.data,
                &Protection::default(),
            )
            .unwrap();
        fixture
            .access
            .write_assistant_file(
                &fixture.identity,
                &fixture.task.id,
                &AssistantWrite {
                    path: "earlier.js".into(),
                    version: None,
                    text: Some("earlier task change".into()),
                    edits: None,
                },
                &fixture.data,
                &Protection::default(),
            )
            .unwrap();
        let waiting = fixture.adopt().unwrap();
        let question = waiting.questions.last().unwrap();
        let facts = question.material_conflict.as_ref().unwrap();
        assert_eq!(facts.path, fixture.adoption.path);
        assert!(facts.coexist_path.chars().count() > 200);
        let adopted_path = if option == "replace" {
            facts.path.clone()
        } else {
            facts.coexist_path.clone()
        };
        fixture.answer(question, choice(option)).unwrap();
        fixture
            .access
            .end_assistant_task(&fixture.identity, &fixture.task.id);
        fixture.access = CreationAccess::default();
        fixture.identity = fixture
            .access
            .open(&fixture.root, &Protection::default())
            .unwrap()
            .project
            .identity;
        let restored = fixture
            .access
            .assistant_questions(
                &fixture.identity,
                &fixture.task.id,
                &fixture.data,
                &Protection::default(),
            )
            .unwrap();
        assert_eq!(
            restored.last().unwrap().material_conflict,
            question.material_conflict
        );
        assert!(fixture.adopt().is_err());
        fixture.resume().unwrap();
        let adopted = fixture.adopt().unwrap();
        assert_eq!(adopted.files.len(), 2);
        assert_eq!(adopted.material_adoptions[0].path, adopted_path);
        assert_eq!(
            fs::read_to_string(fixture.root.join(&adopted_path)).unwrap(),
            "class Grid { size = 8; }"
        );
        fixture
            .access
            .end_assistant_task(&fixture.identity, &fixture.task.id);
        fixture
            .access
            .undo_assistant_task(
                &fixture.identity,
                &fixture.task.id,
                None,
                &fixture.data,
                &Protection::default(),
            )
            .unwrap();
        assert!(!fixture.root.join("earlier.js").exists());
        assert_eq!(
            fs::read_to_string(fixture.root.join(&fixture.adoption.path)).unwrap(),
            "creator nested grid"
        );
        if option == "coexist" {
            assert!(!fixture.root.join(adopted_path).exists());
        }
        assert_eq!(
            fixture
                .access
                .material_text(
                    &fixture.data,
                    &fixture.identity,
                    &fixture.adoption.id,
                    &fixture.adoption.version,
                    &Protection::default()
                )
                .unwrap(),
            "class Grid { size = 8; }"
        );
    }
}
