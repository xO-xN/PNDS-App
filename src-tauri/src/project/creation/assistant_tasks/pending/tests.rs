use super::*;
use crate::project::controlled_checks::{
    persist_report_receipt, run_controlled_check, ControlledCheckContext, ControlledCheckOptions,
    ControlledCheckReport, ControlledCheckStatus,
};
use crate::types::AudioMode;
use std::sync::atomic::AtomicBool;

struct Integration {
    _temporary: tempfile::TempDir,
    _ports: crate::test_support::FixturePorts<2>,
    root: PathBuf,
    data: PathBuf,
    access: CreationAccess,
    identity: String,
    task_id: String,
    completion: PendingIntegrationCompletion,
}

impl Integration {
    fn new(document_only: bool) -> Self {
        let temporary = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(crate::project::creation::tests::project(
            temporary.path(),
            "policy-project",
        ))
        .unwrap();
        let mut ports =
            crate::test_support::FixturePorts::<2>::reserve("integration-verification-policy")
                .unwrap();
        let [performer, monitor] = ports.values();
        fs::write(root.join("manifest.json"), serde_json::json!({
            "schemaVersion":1,"id":"runtime-fixture","name":"Policy project","version":"1.0.0",
            "scoreServer":{"entry":"server.cjs","workingDirectory":".","performerPort":performer,"monitorPort":monitor,"runtimePorts":1},
            "audio":{"defaultMode":"none","supportedModes":["none"]}
        }).to_string()).unwrap();
        let entry = include_str!("../../../session/runtime-ports-fixture.cjs");
        let entry = if document_only {
            entry.into()
        } else {
            format!("require('./Integrated.js');\n{entry}")
        };
        fs::write(root.join("server.cjs"), entry).unwrap();
        ports.release_for_start();
        let data = temporary.path().join("data");
        let protection = Protection::default();
        let mut access = CreationAccess::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        let name = if document_only {
            "Integration.md"
        } else {
            "Integrated.js"
        };
        let source = access
            .save_pending_document(
                &data,
                &identity,
                &CreationPendingDocumentSave {
                    id: "7".repeat(32),
                    name: name.into(),
                    text: if document_only {
                        "# Saved integration notes"
                    } else {
                        "module.exports = 23;"
                    }
                    .into(),
                    version: None,
                },
                &protection,
            )
            .unwrap();
        let task = access
            .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
            .unwrap();
        access
            .adopt_assistant_material(
                &identity,
                &task.id,
                &AssistantMaterialAdoption {
                    id: source.id.clone(),
                    version: source.version.clone(),
                    path: name.into(),
                    text: None,
                },
                &data,
                &protection,
            )
            .unwrap();
        let CreationContent::Text { version, .. } =
            access.read(&identity, name, &protection).unwrap()
        else {
            panic!("saved target")
        };
        Self {
            _temporary: temporary,
            _ports: ports,
            root,
            data,
            access,
            identity,
            task_id: task.id,
            completion: PendingIntegrationCompletion {
                sources: vec![PendingIntegrationSource {
                    id: source.id,
                    version: source.version,
                    path: name.into(),
                }],
                targets: vec![PendingIntegrationTarget {
                    path: name.into(),
                    version: Some(version),
                }],
                check_task_id: None,
            },
        }
    }

    fn runtime_report(&self, mode: AudioMode) -> ControlledCheckReport {
        let context = ControlledCheckContext {
            task_id: "integration-policy-check".into(),
            expected_source_identity: None,
            app_data_dir: self.data.join("check-runtime"),
            shared_root: None,
            node_binary: crate::project::session::node_binary_path().unwrap(),
            scsynth_binary: None,
            plugins_dir: None,
            master_synthdef: None,
            test_audio_device: None,
            test_sclang: None,
        };
        run_controlled_check(
            &self.root,
            &ControlledCheckOptions {
                mode,
                ..Default::default()
            },
            &context,
            &AtomicBool::new(false),
            |_| {},
        )
    }

    fn complete(
        &mut self,
        active_performance: bool,
    ) -> Result<PendingIntegrationReceipt, CreationError> {
        self.access.complete_pending_integration(
            &self.identity,
            &self.task_id,
            &self.completion,
            PendingIntegrationEnvironment {
                shared_root: None,
                active_performance,
            },
            &self.data,
            &Protection::default(),
        )
    }

    fn attach(&mut self, report: &ControlledCheckReport) {
        persist_report_receipt(&self.data, report).unwrap();
        self.completion.check_task_id = Some(report.task_id.clone());
    }
}

#[test]
fn integration_fixture_retains_port_lease_until_drop() {
    let fixture = Integration::new(false);
    let declared = crate::project::ports::project_ports(&fixture.root).unwrap();
    let sibling =
        crate::test_support::FixturePorts::<2>::reserve("integration-sibling-lease").unwrap();
    for port in sibling.values() {
        assert!(
            port != declared.performer_port && port != declared.monitor_port,
            "Integration dropped its numerical lease before the real runtime check: {port}"
        );
    }
}

#[test]
fn integration_completion_verifies_a_fresh_real_runtime_receipt_before_consuming_sources() {
    let mut fixture = Integration::new(false);
    let report = fixture.runtime_report(AudioMode::None);
    assert_eq!(
        report.status,
        ControlledCheckStatus::Passed,
        "{:?}",
        report.error
    );
    fixture.attach(&report);
    let receipt = fixture.complete(false).unwrap();
    assert!(matches!(
        receipt.verification,
        PendingIntegrationVerification::Passed
    ));
    assert!(fixture
        .access
        .list_materials(&fixture.data, &fixture.identity, &Protection::default())
        .unwrap()
        .is_empty());
    assert_eq!(
        fs::read_to_string(fixture.root.join("Integrated.js")).unwrap(),
        "module.exports = 23;"
    );
}

#[test]
fn integration_completion_retains_sources_for_stale_failed_test_only_or_unclean_receipts() {
    use crate::project::controlled_checks::NodeTestEvidence;
    for failure in [
        "stale",
        "failed",
        "cancelled",
        "test-only",
        "no-health",
        "no-evidence",
        "node-cleanup",
        "audio-cleanup",
        "temporary-cleanup",
        "cleanup-error",
        "unavailable-cleanup",
        "unavailable-stale",
    ] {
        let mut fixture = Integration::new(false);
        let mut report = fixture.runtime_report(AudioMode::None);
        assert_eq!(
            report.status,
            ControlledCheckStatus::Passed,
            "{failure}: {:?}",
            report.error
        );
        fixture.attach(&report);
        match failure {
            "stale" | "unavailable-stale" => {
                fs::write(fixture.root.join("later-asset.txt"), "new saved inputs").unwrap()
            }
            "failed" => report.status = ControlledCheckStatus::Failed,
            "cancelled" => report.status = ControlledCheckStatus::Cancelled,
            "test-only" => {
                report.node_tests = Some(NodeTestEvidence {
                    entries: vec!["project.test.cjs".into()],
                    exit_code: Some(0),
                });
                report.health = None;
            }
            "no-health" => report.health = None,
            "no-evidence" => report.evidence = None,
            "node-cleanup" => report.cleanup.node_confirmed = false,
            "audio-cleanup" => report.cleanup.audio_confirmed = false,
            "temporary-cleanup" => report.cleanup.temporary_files_removed = false,
            _ => report
                .cleanup
                .errors
                .push("ownership journal could not be settled".into()),
        }
        if failure.starts_with("unavailable-") {
            report.status = ControlledCheckStatus::NotExecuted;
            report.error = Some("Runtime capability unavailable".into());
        }
        // Fault the persisted system-boundary receipt, including states which
        // the receipt publisher itself correctly refuses to create normally.
        fs::write(
            fixture
                .data
                .join("controlled-check-reports")
                .join(format!("{}.json", report.task_id)),
            serde_json::to_vec(&report).unwrap(),
        )
        .unwrap();
        let error = fixture.complete(true).unwrap_err();
        assert_eq!(
            error.code,
            CreationErrorCode::TestValidation,
            "{failure}: {error:?}"
        );
        if failure.ends_with("stale") {
            assert!(error.detail.contains("stale"), "{failure}: {error:?}");
        }
        let documents = fixture
            .access
            .list_materials(&fixture.data, &fixture.identity, &Protection::default())
            .unwrap();
        assert_eq!(documents.len(), 1, "{failure}");
        assert_eq!(
            fixture
                .access
                .material_text(
                    &fixture.data,
                    &fixture.identity,
                    &documents[0].id,
                    &documents[0].version,
                    &Protection::default()
                )
                .unwrap(),
            "module.exports = 23;"
        );
        assert_eq!(
            fs::read_to_string(fixture.root.join("Integrated.js")).unwrap(),
            "module.exports = 23;"
        );
        assert!(fixture
            .access
            .pending_integration(&fixture.identity, &fixture.data, &Protection::default())
            .unwrap()
            .is_none());
    }
}

#[test]
fn integration_completion_marks_real_unavailable_checks_documents_and_live_busy_as_unverified() {
    for reason in ["runtime-unavailable", "documentation", "live-busy"] {
        let mut fixture = Integration::new(reason == "documentation");
        if reason == "runtime-unavailable" {
            // The real checker captures current saved inputs but cannot execute
            // External audio. This is unavailable evidence, not a passed run.
            let report = fixture.runtime_report(AudioMode::External);
            assert_eq!(
                report.status,
                ControlledCheckStatus::NotExecuted,
                "{:?}",
                report.error
            );
            fixture.attach(&report);
        }
        let receipt = fixture.complete(reason == "live-busy").unwrap();
        assert!(matches!(
            receipt.verification,
            PendingIntegrationVerification::Unverified
        ));
        let expected = match reason {
            "documentation" => "Documentation-only",
            "live-busy" => "running performance",
            _ => "External mode",
        };
        assert!(
            receipt.reason.contains(expected),
            "{reason}: {}",
            receipt.reason
        );
        assert!(fixture
            .access
            .list_materials(&fixture.data, &fixture.identity, &Protection::default())
            .unwrap()
            .is_empty());
    }
}

#[test]
fn integration_completion_requires_runtime_evidence_and_never_bypasses_missing_saved_files() {
    let mut fixture = Integration::new(false);
    let error = fixture.complete(false).unwrap_err();
    assert!(error.detail.contains("Run a controlled check"));
    fs::rename(
        fixture.root.join("server.cjs"),
        fixture.root.join("saved-entry-kept.cjs"),
    )
    .unwrap();
    let error = fixture.complete(true).unwrap_err();
    assert!(error.detail.contains("Static checks failed"));
    assert_eq!(
        fixture
            .access
            .list_materials(&fixture.data, &fixture.identity, &Protection::default())
            .unwrap()
            .len(),
        1
    );
    assert!(fixture
        .access
        .pending_integration(&fixture.identity, &fixture.data, &Protection::default())
        .unwrap()
        .is_none());
}

#[test]
fn pending_image_reuses_identical_target_and_restores_the_inbox_after_reopening() {
    let mut fixture = Integration::new(false);
    let protection = Protection::default();
    let external = fixture._temporary.path().join("Backdrop.png");
    let png = b"\x89PNG\r\n\x1a\noriginal image";
    fs::write(&external, png).unwrap();
    let image = fixture
        .access
        .add_pending_image(&fixture.identity, &external, &protection)
        .unwrap();
    let path = "Backdrop.png";
    fs::write(fixture.root.join(path), png).unwrap();
    let task = fixture
        .access
        .adopt_assistant_material(
            &fixture.identity,
            &fixture.task_id,
            &AssistantMaterialAdoption {
                id: image.id.clone(),
                version: image.version.clone(),
                path: path.into(),
                text: None,
            },
            &fixture.data,
            &protection,
        )
        .unwrap();
    assert!(!task.files.iter().any(|file| file.path == path));
    assert_eq!(task.material_adoptions.last().unwrap().path, path);
    fixture.completion.sources.push(PendingIntegrationSource {
        id: image.id.clone(),
        version: image.version.clone(),
        path: path.into(),
    });
    fixture.completion.targets.push(PendingIntegrationTarget {
        path: path.into(),
        version: Some(file_version(png)),
    });
    assert!(
        fixture.complete(true).is_err(),
        "a copied or reused image without saved wiring is not complete"
    );
    let CreationContent::Text { version, text, .. } = fixture
        .access
        .read(&fixture.identity, "Integrated.js", &protection)
        .unwrap()
    else {
        panic!("script")
    };
    let saved = fixture
        .access
        .write_assistant_file(
            &fixture.identity,
            &fixture.task_id,
            &AssistantWrite {
                path: "Integrated.js".into(),
                version: Some(version),
                text: Some(format!(
                    "{text}\n// false '/elsewhere/Backdrop.png'\nconst backdrop = 'Backdrop.png';"
                )),
                edits: None,
            },
            &fixture.data,
            &protection,
        )
        .unwrap();
    let _ = saved;
    let CreationContent::Text { version, .. } = fixture
        .access
        .read(&fixture.identity, "Integrated.js", &protection)
        .unwrap()
    else {
        panic!("script")
    };
    fixture.completion.targets[0].version = Some(version);
    fixture.complete(true).unwrap();
    assert!(fixture
        .access
        .list_pending_media(&fixture.identity, &protection)
        .unwrap()
        .is_empty());
    let mut reopened = CreationAccess::default();
    let identity = reopened
        .open(&fixture.root, &protection)
        .unwrap()
        .project
        .identity;
    reopened
        .restore_pending_integration(&identity, false, &fixture.data, &protection)
        .unwrap();
    assert_eq!(fs::read(fixture.root.join(path)).unwrap(), png);
    assert_eq!(
        reopened.list_pending_media(&identity, &protection).unwrap(),
        vec![image]
    );
}

#[test]
fn pending_image_conflict_uses_only_the_creators_frozen_choice() {
    for choice in ["replace", "coexist", "cancel"] {
        let mut fixture = Integration::new(false);
        let protection = Protection::default();
        let scope = AssistantQuestionScope {
            chat_id: "chat".into(),
            message_id: "reply".into(),
        };
        fixture
            .access
            .end_assistant_task(&fixture.identity, &fixture.task_id);
        fixture
            .access
            .begin_scoped_assistant_task(
                &fixture.identity,
                AssistantMode::Edit,
                Some(&fixture.task_id),
                Some(&scope),
                &fixture.data,
                &protection,
            )
            .unwrap();
        let source = fixture._temporary.path().join("Backdrop.png");
        let mut original = b"\x89PNG\r\n\x1a\noriginal bytes".to_vec();
        let mut saved = b"\x89PNG\r\n\x1a\nprevious bytes".to_vec();
        if choice == "replace" {
            original.resize(documents::IMAGE_LIMIT as usize, 1);
            saved.resize(documents::IMAGE_LIMIT as usize, 2);
        }
        fs::write(&source, &original).unwrap();
        let image = fixture
            .access
            .add_pending_image(&fixture.identity, &source, &protection)
            .unwrap();
        let path = fixture.root.join("Backdrop.png");
        fs::write(&path, &saved).unwrap();
        let adoption = AssistantMaterialAdoption {
            id: image.id.clone(),
            version: image.version.clone(),
            path: "Backdrop.png".into(),
            text: None,
        };
        let task = fixture
            .access
            .adopt_assistant_material(
                &fixture.identity,
                &fixture.task_id,
                &adoption,
                &fixture.data,
                &protection,
            )
            .unwrap();
        let question = task.questions.last().unwrap();
        assert_eq!(
            question
                .options
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["replace", "coexist", "cancel"]
        );
        assert_eq!(fs::read(&path).unwrap(), saved);
        let answer = AssistantQuestionAnswer {
            option_id: Some(choice.into()),
            text: None,
        };
        let submit = || AssistantQuestionSubmission {
            question_id: &question.id,
            scope: &scope,
            answer: &answer,
        };
        if choice != "cancel" {
            fs::write(&path, b"changed after the proposal").unwrap();
            let stale = fixture
                .access
                .answer_assistant_question(
                    &fixture.identity,
                    &fixture.task_id,
                    submit(),
                    &fixture.data,
                    &protection,
                )
                .unwrap_err();
            assert_eq!(stale.code, CreationErrorCode::VersionConflict);
            fs::write(&path, &saved).unwrap();
        }
        fixture
            .access
            .answer_assistant_question(
                &fixture.identity,
                &fixture.task_id,
                submit(),
                &fixture.data,
                &protection,
            )
            .unwrap();
        let result = fixture.access.adopt_assistant_material(
            &fixture.identity,
            &fixture.task_id,
            &adoption,
            &fixture.data,
            &protection,
        );
        if choice == "cancel" {
            assert!(result.is_err());
            assert_eq!(fs::read(&path).unwrap(), saved);
            assert_eq!(
                fixture
                    .access
                    .list_pending_media(&fixture.identity, &protection)
                    .unwrap(),
                vec![image]
            );
            continue;
        }
        let task = result.unwrap();
        let receipt = task.material_adoptions.last().unwrap();
        let expected_path = if choice == "replace" {
            "Backdrop.png"
        } else {
            "Backdrop-imported.png"
        };
        assert_eq!(receipt.path, expected_path);
        assert_eq!(
            fs::read(fixture.root.join(expected_path)).unwrap(),
            original
        );
        fixture
            .access
            .end_assistant_task(&fixture.identity, &fixture.task_id);
        fixture
            .access
            .undo_assistant_task(
                &fixture.identity,
                &fixture.task_id,
                None,
                &fixture.data,
                &protection,
            )
            .unwrap();
        assert_eq!(fs::read(path).unwrap(), saved);
        assert!(!fixture.root.join("Backdrop-imported.png").exists());
        assert_eq!(
            fixture
                .access
                .list_pending_media(&fixture.identity, &protection)
                .unwrap(),
            vec![image]
        );
    }
}

#[test]
fn pending_image_completion_checks_bytes_actually_served_by_the_performer() {
    use crate::project::controlled_checks::run_controlled_check_observed;
    let mut fixture = Integration::new(false);
    let protection = Protection::default();
    let source = fixture._temporary.path().join("Backdrop.png");
    let png = base64::engine::general_purpose::STANDARD.decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=",
    ).unwrap();
    fs::write(&source, &png).unwrap();
    let image = fixture
        .access
        .add_pending_image(&fixture.identity, &source, &protection)
        .unwrap();
    let task = fixture
        .access
        .adopt_assistant_material(
            &fixture.identity,
            &fixture.task_id,
            &AssistantMaterialAdoption {
                id: image.id.clone(),
                version: image.version.clone(),
                path: "Backdrop.png".into(),
                text: None,
            },
            &fixture.data,
            &protection,
        )
        .unwrap();
    let adopted = task.material_adoptions.last().unwrap();
    fixture.completion.sources.push(PendingIntegrationSource {
        id: image.id.clone(),
        version: image.version.clone(),
        path: adopted.path.clone(),
    });
    fixture.completion.targets.push(PendingIntegrationTarget {
        path: adopted.path.clone(),
        version: Some(adopted.version.clone()),
    });
    let CreationContent::Text { version, .. } = fixture
        .access
        .read(&fixture.identity, "Integrated.js", &protection)
        .unwrap()
    else {
        panic!("script")
    };
    fixture
        .access
        .write_assistant_file(
            &fixture.identity,
            &fixture.task_id,
            &AssistantWrite {
                path: "Integrated.js".into(),
                version: Some(version),
                text: Some(
                    r#"module.exports = '<img src="/Backdrop.png" alt="Backdrop">';"#.into(),
                ),
                edits: None,
            },
            &fixture.data,
            &protection,
        )
        .unwrap();
    let CreationContent::Text { version, .. } = fixture
        .access
        .read(&fixture.identity, "Integrated.js", &protection)
        .unwrap()
    else {
        panic!("script")
    };
    fixture.completion.targets[0].version = Some(version);
    let server = fixture.root.join("server.cjs");
    let original = fs::read_to_string(&server).unwrap();
    let updated = original.replace(
        "require('./Integrated.js');",
        r#"
const entry = require('./Integrated.js');
const httpModule = require('node:http');
const createServer = httpModule.createServer;
httpModule.createServer = function(handle) {
  return createServer(function(req, res) {
    if (req.url === '/Backdrop.png') {
      res.setHeader('Content-Type', 'image/png');
      res.end(require('node:fs').readFileSync('Backdrop.png'));
    } else if (req.url === '/') {
      res.end(entry);
    } else {
      handle(req, res);
    }
  });
};"#,
    );
    fs::write(server, updated).unwrap();
    let unchecked = fixture.runtime_report(AudioMode::None);
    assert_eq!(
        unchecked.status,
        ControlledCheckStatus::Passed,
        "{:?}",
        unchecked.error
    );
    fixture.attach(&unchecked);
    assert!(fixture
        .complete(false)
        .unwrap_err()
        .detail
        .contains("did not load"));
    let context = ControlledCheckContext {
        task_id: "integration-image-performer".into(),
        expected_source_identity: None,
        app_data_dir: fixture.data.join("check-runtime"),
        shared_root: None,
        node_binary: crate::project::session::node_binary_path().unwrap(),
        scsynth_binary: None,
        plugins_dir: None,
        master_synthdef: None,
        test_audio_device: None,
        test_sclang: None,
    };
    let checked = run_controlled_check_observed(
        &fixture.root,
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |_| {},
        |manifest, _, report| {
            let port = manifest.score_server.performer_port;
            let entry = ureq::get(format!("http://127.0.0.1:{port}/"))
                .call()
                .unwrap()
                .into_body()
                .read_to_string()
                .unwrap();
            assert!(entry.contains(r#"src="/Backdrop.png""#));
            let expected = [("Backdrop.png".to_string(), image.version.clone())];
            let wrong_path = [("different/Backdrop.png".to_string(), image.version.clone())];
            let requests = [format!("http://127.0.0.1:{port}/Backdrop.png")];
            assert!(crate::commands::check_browser::loaded_media(
                port,
                &requests,
                &wrong_path,
                "image/",
                &AtomicBool::new(false)
            )
            .is_empty());
            let loaded = crate::commands::check_browser::loaded_media(
                port,
                &requests,
                &expected,
                "image/",
                &AtomicBool::new(false),
            );
            report.loaded_image_sha256 =
                Some(loaded.iter().map(|asset| asset.sha256.clone()).collect());
            report.loaded_media = Some(loaded);
            Ok(())
        },
    );
    assert_eq!(checked.loaded_image_sha256, Some(vec![image.version]));
    assert_eq!(checked.status, ControlledCheckStatus::Passed);
    fixture.attach(&checked);
    assert!(matches!(
        fixture.complete(false).unwrap().verification,
        PendingIntegrationVerification::Passed
    ));
}

#[cfg(target_os = "macos")]
fn integration_wav(amplitude: i16) -> Vec<u8> {
    let mut wav = b"RIFF".to_vec();
    wav.extend(16_036_u32.to_le_bytes());
    wav.extend(b"WAVEfmt ");
    wav.extend(16_u32.to_le_bytes());
    wav.extend(1_u16.to_le_bytes());
    wav.extend(1_u16.to_le_bytes());
    wav.extend(8_000_u32.to_le_bytes());
    wav.extend(16_000_u32.to_le_bytes());
    wav.extend(2_u16.to_le_bytes());
    wav.extend(16_u16.to_le_bytes());
    wav.extend(b"data");
    wav.extend(16_000_u32.to_le_bytes());
    for _ in 0..8_000 {
        wav.extend(amplitude.to_le_bytes());
    }
    wav
}

#[cfg(target_os = "macos")]
#[test]
fn pending_mixed_audio_adoption_restores_originals_and_protects_later_changes() {
    let mut fixture = Integration::new(false);
    let protection = Protection::default();
    let original = integration_wav(2000);
    let previous = integration_wav(1000);
    let png = b"\x89PNG\r\n\x1a\nsaved image";
    let mut adopted = vec![];
    let scope = AssistantQuestionScope {
        chat_id: "chat".into(),
        message_id: "reply".into(),
    };
    fixture
        .access
        .end_assistant_task(&fixture.identity, &fixture.task_id);
    fixture
        .access
        .begin_scoped_assistant_task(
            &fixture.identity,
            AssistantMode::Edit,
            Some(&fixture.task_id),
            Some(&scope),
            &fixture.data,
            &protection,
        )
        .unwrap();
    for (name, body) in [
        ("Take.wav", original.as_slice()),
        ("Backdrop.png", png.as_slice()),
    ] {
        let file = fixture._temporary.path().join(name);
        fs::write(&file, body).unwrap();
        let ImportedCreationResource::Media(media) = fixture
            .access
            .import_creation_resource(&fixture.data, &fixture.identity, &file, &protection)
            .unwrap()
        else {
            panic!("media")
        };
        if name.ends_with(".wav") {
            fs::write(fixture.root.join(name), &previous).unwrap();
        }
        let adoption = AssistantMaterialAdoption {
            id: media.id.clone(),
            version: media.version.clone(),
            path: name.into(),
            text: None,
        };
        let mut task = fixture
            .access
            .adopt_assistant_material(
                &fixture.identity,
                &fixture.task_id,
                &adoption,
                &fixture.data,
                &protection,
            )
            .unwrap();
        if let Some(question) = task
            .questions
            .last()
            .filter(|question| question.status == AssistantQuestionStatus::Pending)
        {
            assert_eq!(question.prompt, "pending-audio-conflict");
            fixture
                .access
                .answer_assistant_question(
                    &fixture.identity,
                    &fixture.task_id,
                    AssistantQuestionSubmission {
                        question_id: &question.id,
                        scope: &scope,
                        answer: &AssistantQuestionAnswer {
                            option_id: Some("replace".into()),
                            text: None,
                        },
                    },
                    &fixture.data,
                    &protection,
                )
                .unwrap();
            task = fixture
                .access
                .adopt_assistant_material(
                    &fixture.identity,
                    &fixture.task_id,
                    &adoption,
                    &fixture.data,
                    &protection,
                )
                .unwrap();
        }
        let receipt = task.material_adoptions.last().unwrap();
        assert_eq!(receipt.path, name);
        assert_eq!(fs::read(fixture.root.join(name)).unwrap(), body);
        fixture.completion.sources.push(PendingIntegrationSource {
            id: media.id.clone(),
            version: media.version.clone(),
            path: name.into(),
        });
        fixture.completion.targets.push(PendingIntegrationTarget {
            path: name.into(),
            version: Some(receipt.version.clone()),
        });
        adopted.push(media);
    }
    let CreationContent::Text { version, .. } = fixture
        .access
        .read(&fixture.identity, "Integrated.js", &protection)
        .unwrap()
    else {
        panic!("script")
    };
    fixture
        .access
        .write_assistant_file(
            &fixture.identity,
            &fixture.task_id,
            &AssistantWrite {
                path: "Integrated.js".into(),
                version: Some(version),
                text: Some("const audio = 'Take.wav', image = 'Backdrop.png';".into()),
                edits: None,
            },
            &fixture.data,
            &protection,
        )
        .unwrap();
    let CreationContent::Text { version, .. } = fixture
        .access
        .read(&fixture.identity, "Integrated.js", &protection)
        .unwrap()
    else {
        panic!("script")
    };
    fixture.completion.targets[0].version = Some(version);
    assert!(fixture
        .complete(false)
        .unwrap_err()
        .detail
        .contains("Run a controlled check"));
    let mut unobserved = fixture.runtime_report(AudioMode::None);
    assert_eq!(unobserved.status, ControlledCheckStatus::Passed);
    unobserved.loaded_media = Some(
        adopted
            .iter()
            .filter(|media| media.mime == "image/png")
            .map(
                |media| crate::project::controlled_checks::ControlledMediaLoad {
                    path: media.name.clone(),
                    sha256: media.version.clone(),
                },
            )
            .collect(),
    );
    fixture.attach(&unobserved);
    assert!(fixture
        .complete(false)
        .unwrap_err()
        .detail
        .contains("did not load adopted media Take.wav"));
    assert_eq!(
        fixture
            .access
            .list_pending_media(&fixture.identity, &protection)
            .unwrap()
            .len(),
        2
    );
    fixture.completion.check_task_id = None;
    let unverified = fixture.complete(true).unwrap();
    assert!(matches!(
        unverified.verification,
        PendingIntegrationVerification::Unverified
    ));
    assert_eq!(unverified.sources.len(), 1);
    assert_eq!(unverified.media_sources.as_ref().unwrap().len(), 2);
    assert!(fixture
        .access
        .list_pending_media(&fixture.identity, &protection)
        .unwrap()
        .is_empty());
    let mut reopened = CreationAccess::default();
    let identity = reopened
        .open(&fixture.root, &protection)
        .unwrap()
        .project
        .identity;
    fs::write(fixture.root.join("Take.wav"), b"later edit").unwrap();
    assert!(reopened
        .restore_pending_integration(&identity, false, &fixture.data, &protection)
        .is_err());
    let same_name = fixture._temporary.path().join("Take.wav");
    fs::write(&same_name, integration_wav(500)).unwrap();
    reopened
        .import_creation_resource(&fixture.data, &identity, &same_name, &protection)
        .unwrap();
    assert!(reopened
        .restore_pending_integration(&identity, true, &fixture.data, &protection)
        .is_err());
    // Remove the independent conflicting test copy through the private catalog.
    let private =
        crate::creation_data::open(&reopened.current(&identity, &protection).unwrap().directory)
            .unwrap();
    let newcomer = reopened.list_pending_media(&identity, &protection).unwrap();
    documents::update_pending_media_originals(&private, &newcomer, false, true).unwrap();
    reopened
        .restore_pending_integration(&identity, true, &fixture.data, &protection)
        .unwrap();
    assert_eq!(
        fs::read(fixture.root.join("Take.wav")).unwrap(),
        b"later edit"
    );
    let mut restored = reopened.list_pending_media(&identity, &protection).unwrap();
    restored.sort_by(|a, b| a.name.cmp(&b.name));
    adopted.sort_by(|a, b| a.name.cmp(&b.name));
    assert_eq!(restored, adopted);
    fs::write(fixture.root.join("Take.wav"), &original).unwrap();
    reopened
        .restore_pending_integration(&identity, false, &fixture.data, &protection)
        .unwrap();
    assert_eq!(fs::read(fixture.root.join("Take.wav")).unwrap(), previous);
    assert!(!fixture.root.join("Backdrop.png").exists());
}

#[test]
fn sample_reference_requires_a_buffer_call_and_the_exact_project_path() {
    let target = "supercollider/samples/voice.wav";
    let matched = |text: &str| {
        saved_media_literals(text)
            .into_iter()
            .any(|(value, prefix)| sample_read_literal(prefix) && value == target)
    };
    assert!(matched(
        r#"Buffer.read(s, "supercollider/samples/voice.wav");"#
    ));
    assert!(matched(
        r#"osc.send("/b_allocRead", 2, "supercollider/samples/voice.wav");"#
    ));
    assert!(!matched(
        r#"Buffer.read(s, "other/voice.wav"); var candidate = "supercollider/samples/voice.wav";"#
    ));
    assert!(!matched(
        r#"// Buffer.read(s, "supercollider/samples/voice.wav");"#
    ));
}
