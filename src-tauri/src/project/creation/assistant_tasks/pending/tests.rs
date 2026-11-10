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
