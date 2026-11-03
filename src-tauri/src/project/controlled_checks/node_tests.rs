//! A fixed test runner, never a shell or package installation surface.
use super::*;

pub(crate) fn supported_node_test_path(path: &str) -> bool {
    !path.split('/').any(|part| part == "node_modules")
        && [".test.js", ".test.mjs", ".test.cjs"]
            .iter()
            .any(|extension| path.ends_with(extension))
}

#[allow(clippy::too_many_arguments)]
pub(super) fn run_snapshot_tests(
    snapshot: &PreparedSnapshot,
    options: &ControlledCheckOptions,
    context: &ControlledCheckContext,
    cancelled: &AtomicBool,
    publish: &impl Fn(ControlledCheckPhase, Option<String>, u64),
    tail: &Arc<Mutex<VecDeque<String>>>,
    resources: &mut Resources,
    report: &mut ControlledCheckReport,
) -> Result<(), String> {
    let entries = snapshot
        .evidence
        .project_files
        .iter()
        .filter(|file| !file.directory && supported_node_test_path(&file.path))
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    report.node_tests = Some(NodeTestEvidence {
        entries: entries.clone(),
        exit_code: None,
    });
    if entries.is_empty() {
        report.status = ControlledCheckStatus::NotExecuted;
        report.error = Some("No supported Node test entry (*.test.js, *.test.mjs, *.test.cjs) exists in the saved project".into());
        return Ok(());
    }
    if entries.len() > 256 {
        return Err("The fixed Node runner supports at most 256 test entry files".into());
    }
    let root = &snapshot.project_root;
    let registry = ChildRegistry::new(context.app_data_dir.join("controlled-checks/ownership"));
    registry.cleanup_orphans(&HashSet::new())?;
    report.environment.node_version = Some(capture_node_version(
        root, options, context, cancelled, &registry, resources, tail,
    )?);
    check_cancel(cancelled)?;
    publish(ControlledCheckPhase::Starting, None, 0);
    check_cancel(cancelled)?;
    let mut command = Command::new(&context.node_binary);
    command
        .args(["--test", "--test-reporter=tap", "--test-concurrency=1"])
        .args(entries.iter().map(|entry| format!("./{entry}")))
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH");
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("PNDS_") {
            command.env_remove(key);
        }
    }
    let manifest = load_manifest_lenient(root)?;
    if !manifest.shared_libraries.is_empty() {
        let shared = super::super::shared_libraries::SharedLibraryResolver::default().resolve_at(
            snapshot
                .shared_root
                .as_deref()
                .ok_or("Declared shared libraries are unavailable")?,
            &manifest.shared_libraries,
        )?;
        command.env(
            "PNDS_SHARED_LIBRARIES",
            serde_json::to_string(&shared).map_err(|error| error.to_string())?,
        );
    }
    resources.node = Some(
        SupervisedChild::spawn_group(
            &registry,
            context.node_binary.to_string_lossy(),
            &mut command,
        )
        .map_err(|error| format!("Embedded Node test runner could not start: {error}"))?,
    );
    resources.output_readers = drain_output(
        resources.node.as_mut().expect("test child"),
        "project-tests",
        tail,
    );
    let deadline = Instant::now() + Duration::from_millis(u64::from(options.timeout_ms));
    let status = loop {
        check_cancel(cancelled)?;
        if let Some(status) = resources
            .node
            .as_mut()
            .expect("test child")
            .try_wait()
            .map_err(|error| error.to_string())?
        {
            break status;
        }
        if Instant::now() >= deadline {
            return Err("Node project tests timed out".into());
        }
        std::thread::sleep(POLL);
    };
    report.node_tests.as_mut().expect("test evidence").exit_code = status.code();
    report.checks.push(DiagnosticCheck {
        code: "projectTests".into(),
        status: if status.success() {
            DiagnosticStatus::Passed
        } else {
            DiagnosticStatus::Failed
        },
        reason: format!(
            "Embedded Node ran {} saved test entry files; exit status {status}",
            entries.len()
        ),
    });
    if !status.success() {
        return Err(format!(
            "Node project tests failed ({status}); inspect the captured test output"
        ));
    }
    report.status = ControlledCheckStatus::Passed;
    Ok(())
}

#[cfg(test)]
mod tests;
