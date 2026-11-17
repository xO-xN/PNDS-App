use super::*;
use std::time::Duration;

mod nrt;

struct Fixture {
    temp: tempfile::TempDir,
    root: PathBuf,
    data: PathBuf,
    access: CreationAccess,
    identity: String,
    task: AssistantTask,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = crate::project::creation::tests::project(temp.path(), "score");
        fs::create_dir_all(root.join("supercollider/source")).unwrap();
        fs::write(
            root.join("supercollider/source/voice.scd"),
            "SynthDef('voice', { Out.ar(0, Silent.ar(2)) }).add;\n",
        )
        .unwrap();
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
        manifest["audio"]["synthdefs"] =
            serde_json::json!(["supercollider/synthdefs/voice.scsyndef"]);
        fs::write(
            root.join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        let data = temp.path().join("data");
        let mut access = CreationAccess::default();
        let identity = access
            .open(&root, &Protection::default())
            .unwrap()
            .project
            .identity;
        let task = access
            .begin_assistant_task(
                &identity,
                AssistantMode::Edit,
                None,
                &data,
                &Protection::default(),
            )
            .unwrap();
        Self {
            temp,
            root,
            data,
            access,
            identity,
            task,
        }
    }
    fn compiler(&self, body: &str) -> SynthdefCompiler {
        let path = self.temp.path().join("sclang");
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        SynthdefCompiler {
            sclang: Ok(path),
            timeout: Duration::from_secs(5),
        }
    }
    fn successful_compiler(&self) -> SynthdefCompiler {
        self.compiler("printf '\\123\\103\\147\\146\\000\\000\\000\\002\\000\\001\\005voice\\377' > \"$2/voice.scsyndef\"\necho compiled")
    }
    fn prepare(&mut self) -> AssistantCompileJob {
        self.access
            .prepare_assistant_synthdefs(
                &self.identity,
                &self.task.id,
                &[],
                &self.data,
                &Protection::default(),
            )
            .unwrap()
    }
    fn finish(&mut self, output: AssistantCompileOutput) -> AssistantCompileResult {
        self.access
            .finish_assistant_synthdefs(output, &self.data, &Protection::default())
            .unwrap()
    }
    fn compile(&mut self) -> AssistantCompileResult {
        let compiler = self.successful_compiler();
        let output = self.prepare().run(&compiler);
        self.finish(output)
    }
    fn state(&self) -> AssistantBuildState {
        self.state_for_project_check(false)
    }
    fn state_for_project_check(&self, project_check: bool) -> AssistantBuildState {
        self.access
            .assistant_build_state(
                &self.identity,
                &self.task.id,
                project_check,
                &self.data,
                &Protection::default(),
            )
            .unwrap()
    }
    fn write(&mut self, path: &str, text: &str) {
        let version = fs::read(self.root.join(path))
            .ok()
            .map(|bytes| file_version(&bytes));
        self.access
            .write_assistant_file(
                &self.identity,
                &self.task.id,
                &AssistantWrite {
                    path: path.into(),
                    version,
                    text: Some(text.into()),
                    edits: None,
                },
                &self.data,
                &Protection::default(),
            )
            .unwrap();
    }
}

#[test]
fn assistant_compile_publishes_binary_journal_reuses_receipt_and_undoes_after_restart() {
    let mut f = Fixture::new();
    fs::create_dir_all(f.root.join("supercollider/synthdefs")).unwrap();
    let original = b"SCgf\0\0\0\x02\0\x01\x05voice\0original";
    let output_path = f.root.join("supercollider/synthdefs/voice.scsyndef");
    fs::write(&output_path, original).unwrap();
    fs::set_permissions(&output_path, fs::Permissions::from_mode(0o640)).unwrap();
    f.write("supercollider/source/voice.scd", "// changed source\n");
    assert!(f.state().needed);
    let result = f.compile();
    assert_eq!(result.status, AssistantCompileStatus::Succeeded);
    assert!(!result.reused);
    assert!(result
        .report
        .references
        .iter()
        .all(|reference| reference.status == compile::SynthdefReferenceStatus::Verified));
    assert!(result
        .task
        .files
        .iter()
        .any(|file| file.path.ends_with("voice.scsyndef") && !file.created));
    assert!(!f.state().needed);
    let output = f.prepare().run(&SynthdefCompiler {
        sclang: Err("compiler must not run for fresh receipt".into()),
        timeout: Duration::ZERO,
    });
    let reused = f.finish(output);
    assert!(reused.reused);
    assert_eq!(reused.status, AssistantCompileStatus::Succeeded);
    f.access.end_assistant_task(&f.identity, &f.task.id);
    f.access = CreationAccess::default();
    f.identity = f
        .access
        .open(&f.root, &Protection::default())
        .unwrap()
        .project
        .identity;
    f.access
        .undo_assistant_task(
            &f.identity,
            &f.task.id,
            None,
            &f.data,
            &Protection::default(),
        )
        .unwrap();
    assert_eq!(fs::read(&output_path).unwrap(), original);
    assert_eq!(
        fs::metadata(output_path).unwrap().permissions().mode() & 0o777,
        0o640
    );
}

#[test]
fn assistant_compile_new_artifacts_and_directory_are_task_owned() {
    let mut f = Fixture::new();
    let result = f.compile();
    assert_eq!(result.status, AssistantCompileStatus::Succeeded);
    assert!(result
        .task
        .files
        .iter()
        .any(|file| file.path.ends_with("voice.scsyndef") && file.created));
    f.access.end_assistant_task(&f.identity, &f.task.id);
    f.access
        .undo_assistant_task(
            &f.identity,
            &f.task.id,
            None,
            &f.data,
            &Protection::default(),
        )
        .unwrap();
    assert!(!f.root.join("supercollider/synthdefs").exists());
}

#[test]
fn assistant_compile_reports_missing_compiler_and_execution_failure_distinctly() {
    let mut f = Fixture::new();
    let output = f.prepare().run(&SynthdefCompiler {
        sclang: Err("not found".into()),
        timeout: Duration::ZERO,
    });
    assert_eq!(
        f.finish(output).status,
        AssistantCompileStatus::CompilerUnavailable
    );
    let compiler = f.compiler("echo source-error\nexit 4");
    let output = f.prepare().run(&compiler);
    let result = f.finish(output);
    assert_eq!(result.status, AssistantCompileStatus::Failed);
    assert!(result.report.error.unwrap().contains("source-error"));
    assert!(!f.root.join("supercollider/synthdefs").exists());
    assert_eq!(f.compile().status, AssistantCompileStatus::Succeeded);
}

#[test]
fn assistant_compile_rejects_changed_inputs_artifacts_and_protected_drafts() {
    for path in [
        "supercollider/source/voice.scd",
        "supercollider/synthdefs/voice.scsyndef",
    ] {
        let mut f = Fixture::new();
        let compiler = f.successful_compiler();
        let output = f.prepare().run(&compiler);
        fs::create_dir_all(f.root.join("supercollider/synthdefs")).unwrap();
        fs::write(f.root.join(path), "external bytes").unwrap();
        let error = f
            .access
            .finish_assistant_synthdefs(output, &f.data, &Protection::default())
            .unwrap_err();
        assert_eq!(error.code, CreationErrorCode::VersionConflict);
        assert_eq!(fs::read(f.root.join(path)).unwrap(), b"external bytes");
    }
    let mut f = Fixture::new();
    assert!(f
        .access
        .prepare_assistant_synthdefs(
            &f.identity,
            &f.task.id,
            &["manifest.json".into()],
            &f.data,
            &Protection::default()
        )
        .is_err());
    f.access.end_assistant_task(&f.identity, &f.task.id);
    let discussion = f
        .access
        .begin_assistant_task(
            &f.identity,
            AssistantMode::Discussion,
            None,
            &f.data,
            &Protection::default(),
        )
        .unwrap();
    assert!(f
        .access
        .prepare_assistant_synthdefs(
            &f.identity,
            &discussion.id,
            &[],
            &f.data,
            &Protection::default()
        )
        .is_err());
}

#[test]
fn assistant_compile_rejects_retargeted_sources_with_unchanged_saved_bytes() {
    let mut f = Fixture::new();
    let source = f.root.join("supercollider/source/voice.scd");
    let original = f.root.join("original.scd");
    let replacement = f.root.join("replacement.scd");
    fs::rename(&source, &original).unwrap();
    fs::copy(&original, &replacement).unwrap();
    std::os::unix::fs::symlink(&original, &source).unwrap();
    let compiler = f.compiler("cat \"$3\"\nprintf '\\123\\103\\147\\146\\000\\000\\000\\002\\000\\001\\005voice\\377' > \"$2/voice.scsyndef\"");
    let job = f.prepare();

    // Keep the saved logical input identical while the compiler's captured
    // canonical source has different bytes. Those outputs belong to neither
    // the current saved source nor a successful build receipt.
    let next_link = f.root.join("next-source");
    std::os::unix::fs::symlink(&replacement, &next_link).unwrap();
    fs::rename(next_link, &source).unwrap();
    fs::write(&original, "// changed captured canonical source\n").unwrap();
    let output = job.run(&compiler);
    let error = f
        .access
        .finish_assistant_synthdefs(output, &f.data, &Protection::default())
        .unwrap_err();
    assert_eq!(error.code, CreationErrorCode::VersionConflict);
    assert!(!f
        .root
        .join("supercollider/synthdefs/voice.scsyndef")
        .exists());
}

#[test]
fn assistant_compile_first_publication_refuses_target_changed_after_initial_validation() {
    for existed in [false, true] {
        let mut f = Fixture::new();
        fs::create_dir_all(f.root.join("supercollider/synthdefs")).unwrap();
        let artifact = f.root.join("supercollider/synthdefs/voice.scsyndef");
        if existed {
            fs::write(&artifact, b"SCgf\0\0\0\x02\0\x01\x05voice\0original").unwrap();
        }
        let compiler = f.successful_compiler();
        let output = f.prepare().run(&compiler);
        let job = &output.output.job;
        let current = f
            .access
            .prepare_synthdefs(&f.identity, &Protection::default())
            .unwrap();
        assert_eq!(current.inputs, job.inputs);
        assert_eq!(current.artifacts, job.artifacts);
        let artifacts =
            compile::collect_artifacts(output.output.staging.as_ref().unwrap().path()).unwrap();

        // Enter the publication seam after the finish phase has validated its
        // snapshot. A concurrent write here must not become an accepted before.
        let external = b"SCgf\0\0\0\x02\0\x01\x05voice\0creator-edit";
        fs::write(&artifact, external).unwrap();
        let error = f
            .access
            .publish_assistant_artifacts(
                &f.identity,
                &f.task.id,
                job,
                artifacts,
                &f.data,
                &Protection::default(),
            )
            .unwrap_err();
        assert_eq!(error.code, CreationErrorCode::VersionConflict);
        assert_eq!(fs::read(&artifact).unwrap(), external);
        let journal = load(&f.data, &fs::canonicalize(&f.root).unwrap(), &f.task.id).unwrap();
        assert!(
            journal.artifacts.is_empty(),
            "external bytes must not be adopted into the task journal"
        );
    }
}

#[test]
fn assistant_compile_cancellation_never_adopts_staging() {
    let mut f = Fixture::new();
    let compiler = f.successful_compiler();
    let output = f.prepare().run(&compiler);
    f.access.cancel_assistant_operation(&f.identity, &f.task.id);
    assert_eq!(f.finish(output).status, AssistantCompileStatus::Cancelled);
    assert!(!f.root.join("supercollider/synthdefs").exists());
    assert_eq!(f.compile().status, AssistantCompileStatus::Succeeded);
}

#[test]
fn assistant_compile_invalid_or_missing_declared_output_publishes_nothing() {
    for body in ["echo invalid > \"$2/voice.scsyndef\"", "printf '\\123\\103\\147\\146\\000\\000\\000\\002\\000\\001\\005other' > \"$2/other.scsyndef\""] {
        let mut f = Fixture::new();
        let compiler = f.compiler(body);
        let output = f.prepare().run(&compiler);
        assert_eq!(f.finish(output).status, AssistantCompileStatus::Failed);
        assert!(!f.root.join("supercollider/synthdefs").exists());
    }
}

#[test]
fn assistant_compile_receipt_detects_source_and_binary_drift_and_skips_documents() {
    let mut f = Fixture::new();
    f.write("README.md", "New documentation\n");
    assert!(!f.state().needed);
    f.write("server.js", "// implementation changed\n");
    assert!(
        f.state().needed,
        "missing declared binary matters for implementation tasks"
    );
    f.compile();
    assert!(!f.state().needed);
    let source = f.root.join("supercollider/source/voice.scd");
    let original = fs::read(&source).unwrap();
    fs::write(&source, "// external source").unwrap();
    assert!(f.state().needed);
    fs::write(&source, original).unwrap();
    assert!(!f.state().needed);
    fs::write(
        f.root.join("supercollider/synthdefs/voice.scsyndef"),
        "external output",
    )
    .unwrap();
    assert!(f.state().needed);
    f.access.end_assistant_task(&f.identity, &f.task.id);
    assert_eq!(
        f.access
            .undo_assistant_task(
                &f.identity,
                &f.task.id,
                None,
                &f.data,
                &Protection::default()
            )
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    assert_eq!(
        fs::read_to_string(f.root.join("server.js")).unwrap(),
        "// implementation changed\n",
        "whole undo validates binaries before restoring text"
    );
}

#[test]
fn assistant_compile_empty_task_explicit_check_reads_required_artifacts_without_mutating() {
    let mut f = Fixture::new();
    let root = fs::canonicalize(&f.root).unwrap();
    let before = serde_json::to_value(load(&f.data, &root, &f.task.id).unwrap()).unwrap();
    assert!(
        !f.state().needed,
        "ordinary task validation does not audit untouched inputs"
    );
    assert!(f.state_for_project_check(true).needed);
    assert!(!f.root.join("supercollider/synthdefs").exists());
    assert_eq!(
        before,
        serde_json::to_value(load(&f.data, &root, &f.task.id).unwrap()).unwrap()
    );

    fs::create_dir_all(f.root.join("supercollider/synthdefs")).unwrap();
    fs::write(
        f.root.join("supercollider/synthdefs/voice.scsyndef"),
        b"SCgf\0\0\0\x02\0\x01\x05voice\0provided",
    )
    .unwrap();
    assert!(
        !f.state_for_project_check(true).needed,
        "present valid artifacts do not imply a historical freshness audit"
    );
    fs::remove_file(f.root.join("supercollider/synthdefs/voice.scsyndef")).unwrap();
    f.write("README.md", "Only documentation changed\n");
    assert!(
        !f.state_for_project_check(true).needed,
        "pure document edits retain their build exemption"
    );
}

#[test]
fn assistant_compile_build_state_skips_js_only_manifest_and_server_changes() {
    let mut f = Fixture::new();
    fs::remove_file(f.root.join("supercollider/source/voice.scd")).unwrap();
    fs::remove_dir(f.root.join("supercollider/source")).unwrap();
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(f.root.join("manifest.json")).unwrap()).unwrap();
    manifest["name"] = "Renamed JavaScript score".into();
    manifest["audio"] = serde_json::json!({"defaultMode":"none","supportedModes":["none"]});
    f.write("manifest.json", &manifest.to_string());
    f.write("server.js", "// changed JavaScript entry\n");
    let state = f.state();
    assert!(!state.needed);
    assert!(state.receipt.is_none());
    assert!(!f.state_for_project_check(true).needed);
}

#[test]
fn assistant_compile_removing_last_source_and_references_clears_build_obligation() {
    for prior_receipt in [false, true] {
        let mut f = Fixture::new();
        if prior_receipt {
            assert_eq!(f.compile().status, AssistantCompileStatus::Succeeded);
        }
        let path = "supercollider/source/voice.scd";
        let version = file_version(&fs::read(f.root.join(path)).unwrap());
        f.access
            .remove_assistant_file(
                &f.identity,
                &f.task.id,
                path,
                &version,
                &f.data,
                &Protection::default(),
            )
            .unwrap();
        assert!(
            f.state().needed,
            "remaining declared output still needs a source build"
        );
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(f.root.join("manifest.json")).unwrap()).unwrap();
        manifest["audio"] =
            serde_json::json!({"defaultMode":"none","supportedModes":["none"],"synthdefs":[]});
        f.write("manifest.json", &manifest.to_string());
        let state = f.state();
        assert!(!state.needed);
        assert!(
            state.receipt.is_none(),
            "old binary receipt cannot survive a removed build scope"
        );
    }
}

#[test]
fn assistant_compile_recovers_interrupted_binary_publication_before_resume() {
    let mut f = Fixture::new();
    f.compile();
    let root = fs::canonicalize(&f.root).unwrap();
    let mut journal = load(&f.data, &root, &f.task.id).unwrap();
    let entry = &mut journal.artifacts[0];
    let actual = entry.after.clone();
    entry.pending = Some(actual);
    entry.after = Vec::new();
    journal.persist(&f.data).unwrap();
    f.access = CreationAccess::default();
    f.identity = f
        .access
        .open(&f.root, &Protection::default())
        .unwrap()
        .project
        .identity;
    f.access
        .begin_assistant_task(
            &f.identity,
            AssistantMode::Edit,
            Some(&f.task.id),
            &f.data,
            &Protection::default(),
        )
        .unwrap();
    let journal = load(&f.data, &root, &f.task.id).unwrap();
    assert!(journal.artifacts[0].pending.is_none());
    f.access.end_assistant_task(&f.identity, &f.task.id);
    f.access
        .undo_assistant_task(
            &f.identity,
            &f.task.id,
            None,
            &f.data,
            &Protection::default(),
        )
        .unwrap();
    assert!(!f
        .root
        .join("supercollider/synthdefs/voice.scsyndef")
        .exists());
}

#[test]
fn assistant_compile_cancel_running_process_and_retry_same_task() {
    let mut f = Fixture::new();
    let compiler = f.compiler("touch \"$0.started\"\nsleep 30");
    // The mock records startup next to itself, within the temporary fixture.
    let marker = f.temp.path().join("sclang.started");
    let job = f.prepare();
    let running = std::thread::spawn(move || job.run(&compiler));
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    while !marker.exists() {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(f
        .access
        .begin_assistant_operation(&f.identity, &f.task.id)
        .is_err());
    f.access.cancel_assistant_operation(&f.identity, &f.task.id);
    let result = f.finish(running.join().unwrap());
    assert_eq!(result.status, AssistantCompileStatus::Cancelled);
    assert!(!f.root.join("supercollider/synthdefs").exists());
    assert_eq!(f.compile().status, AssistantCompileStatus::Succeeded);
}

#[test]
fn assistant_compile_rejects_symlinked_binary_destination() {
    let mut f = Fixture::new();
    let outside = f.temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, f.root.join("supercollider/synthdefs")).unwrap();
    let compiler = f.successful_compiler();
    let prepared = f.access.prepare_assistant_synthdefs(
        &f.identity,
        &f.task.id,
        &[],
        &f.data,
        &Protection::default(),
    );
    if let Ok(job) = prepared {
        assert_eq!(
            f.finish(job.run(&compiler)).status,
            AssistantCompileStatus::Failed
        );
    }
    assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
}

#[test]
fn assistant_compile_reconciles_undo_that_published_before_journal_update() {
    let mut f = Fixture::new();
    fs::create_dir_all(f.root.join("supercollider/synthdefs")).unwrap();
    let original = b"SCgf\0\0\0\x02\0\x01\x05voice\0original";
    let artifact = f.root.join("supercollider/synthdefs/voice.scsyndef");
    fs::write(&artifact, original).unwrap();
    f.compile();
    let root = fs::canonicalize(&f.root).unwrap();
    let mut journal = load(&f.data, &root, &f.task.id).unwrap();
    journal.artifacts[0].pending_undo = true;
    journal.persist(&f.data).unwrap();
    fs::write(&artifact, original).unwrap();
    f.access.end_assistant_task(&f.identity, &f.task.id);
    let tasks = f
        .access
        .assistant_tasks(&f.identity, &f.data, &Protection::default())
        .unwrap();
    assert!(tasks[0]
        .files
        .iter()
        .any(|file| file.path.ends_with("voice.scsyndef") && file.undone));
    assert_eq!(fs::read(artifact).unwrap(), original);
}

#[test]
#[ignore = "local acceptance: runs installed sclang against a temporary silent definition, without booting audio"]
fn assistant_compile_real_sclang_temporary_fixture() {
    let mut f = Fixture::new();
    let output = f.prepare().run(&SynthdefCompiler::default());
    let result = f.finish(output);
    assert_eq!(
        result.status,
        AssistantCompileStatus::Succeeded,
        "{result:?}"
    );
    assert_eq!(result.report.produced, ["voice.scsyndef"]);
    assert!(!f.state().needed);
    f.access.end_assistant_task(&f.identity, &f.task.id);
    f.access
        .undo_assistant_task(
            &f.identity,
            &f.task.id,
            None,
            &f.data,
            &Protection::default(),
        )
        .unwrap();
    assert!(!f.root.join("supercollider/synthdefs").exists());
}
