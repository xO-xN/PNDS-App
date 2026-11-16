use super::*;
use crate::project::creation::{CreationAccess, Protection};
use std::os::unix::fs::PermissionsExt;
use std::time::{Duration, Instant};

fn workspace() -> (tempfile::TempDir, CreationAccess, String) {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("工程 with spaces");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("server.js"), "// terminal fixture").unwrap();
    std::fs::write(root.join("manifest.json"), r#"{
        "schemaVersion":1,"id":"terminal-fixture","name":"Terminal","version":"0.1.0",
        "scoreServer":{"entry":"server.js","workingDirectory":".","performerPort":6868,"monitorPort":6869},
        "audio":{"defaultMode":"none","supportedModes":["none"],"synthdefs":[],"scsynth":{"blockSize":64,"audioBusChannels":128}}
    }"#).unwrap();
    let mut access = CreationAccess::default();
    let identity = access
        .open(&root, &Protection::default())
        .unwrap()
        .project
        .identity;
    (temporary, access, identity)
}

#[test]
fn preparing_app_exit_ends_the_real_terminal_and_blocks_new_sessions_until_exit_is_cancelled() {
    let (temporary, access, identity) = workspace();
    let manager = ProjectTerminalManager::new(temporary.path().join("app-data"));
    let session = manager
        .open(&access, &identity, &Protection::default(), 80, 24)
        .unwrap();
    manager
        .write(
            &identity,
            &session.id,
            b"printf '\\nEXIT_%s:%s\\nEXIT_READY\\n' SHELL $$\r",
        )
        .unwrap();
    let output = read_until(&manager, &identity, &session.id, "EXIT_READY\r\n");
    let pid: libc::pid_t = output
        .lines()
        .find_map(|line| line.trim().strip_prefix("EXIT_SHELL:")?.parse().ok())
        .unwrap();

    manager.prepare_exit().unwrap();
    assert!(process_identity_including_zombies(pid).is_none());
    assert!(manager.get(&identity).unwrap().is_none());
    assert!(manager
        .open(&access, &identity, &Protection::default(), 80, 24)
        .is_err());

    // Another native exit barrier can fail after terminal cleanup succeeded.
    // The retained App permits a new explicit terminal after that cancellation.
    manager.resume_after_failed_exit();
    let replacement = manager
        .open(&access, &identity, &Protection::default(), 80, 24)
        .unwrap();
    assert_ne!(replacement.id, session.id);
    manager.close(&identity, &replacement.id).unwrap();
}

#[test]
fn failed_native_exit_preserves_the_terminal_before_cancelling_merge_work_or_stopping_runtime() {
    use tauri::Manager as _;
    let (temporary, access, identity) = workspace();
    let data = temporary.path().join("app-data");
    let manager = ProjectTerminalManager::new(data.clone());
    let session = manager
        .open(&access, &identity, &Protection::default(), 80, 24)
        .unwrap();
    manager
        .write(
            &identity,
            &session.id,
            b"stty -echo; /bin/sleep 30 & printf '\\nEXIT_GUARD_READY\\n'\r",
        )
        .unwrap();
    read_until(&manager, &identity, &session.id, "EXIT_GUARD_READY\r\n");
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    crate::events::events_builder().mount_events(&app);
    app.manage(manager.clone());
    app.manage(crate::project::session::SessionManager::default());
    app.manage(crate::commands::creation::CreationState::default());
    app.manage(crate::project::merge_runtime::MergeRuntimeState::default());
    app.manage(crate::participation_client::ClientCoordinator::default());
    app.manage(crate::window::WindowManager::default());
    let cancelled = Arc::new(AtomicBool::new(false));
    *app.state::<crate::project::merge_runtime::MergeRuntimeState>()
        .operation
        .lock()
        .unwrap() = Some(crate::project::merge_runtime::MergeOperation {
        identity: identity.clone(),
        candidate_id: "candidate-fixture".into(),
        round_id: None,
        cancelled: cancelled.clone(),
        completed: Arc::new((Mutex::new(true), Condvar::new())),
    });
    let generation = app
        .state::<crate::project::session::SessionManager>()
        .creation_runtime()
        .generation;

    // The new job is not in the initial record. Its identity must be durably
    // refreshed before signalling any managed job, including the shell.
    std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o500)).unwrap();
    let failed = crate::window::prepare_exit(app.handle());
    std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(failed
        .unwrap_err()
        .starts_with("creation.terminal.exitFailed:"));
    assert!(!cancelled.load(Ordering::Acquire));
    assert_eq!(
        app.state::<crate::project::session::SessionManager>()
            .creation_runtime()
            .generation,
        generation
    );
    assert_eq!(manager.get(&identity).unwrap().unwrap().id, session.id);
    manager
        .write(&identity, &session.id, b"printf '\\nEXIT_RETRY_READY\\n'\r")
        .unwrap();
    read_until(&manager, &identity, &session.id, "EXIT_RETRY_READY\r\n");
    assert_eq!(
        manager
            .open(&access, &identity, &Protection::default(), 80, 24)
            .unwrap()
            .id,
        session.id,
        "failed cleanup restores admission to the retained owner"
    );

    // Terminal teardown can succeed before a different exit barrier refuses.
    // Retaining the App must not leave terminal admission permanently closed.
    let merge = app.state::<crate::project::merge_runtime::MergeRuntimeState>();
    let busy = merge.runtime.lock().unwrap();
    let later = crate::window::prepare_exit(app.handle());
    drop(busy);
    assert!(later.unwrap_err().contains("merge test is starting"));
    assert!(manager.get(&identity).unwrap().is_none());
    assert!(!cancelled.load(Ordering::Acquire));
    let replacement = manager
        .open(&access, &identity, &Protection::default(), 80, 24)
        .unwrap();
    assert_ne!(replacement.id, session.id);
    crate::window::prepare_exit(app.handle()).unwrap();
    assert!(manager.get(&identity).unwrap().is_none());
    assert!(cancelled.load(Ordering::Acquire));
}

#[test]
fn an_open_queued_behind_real_job_cleanup_cannot_recreate_a_terminal_during_exit() {
    let (temporary, access, identity) = workspace();
    let manager = ProjectTerminalManager::new(temporary.path().join("app-data"));
    let session = manager
        .open(&access, &identity, &Protection::default(), 80, 24)
        .unwrap();
    let signalled = temporary.path().join("exit-signalled");
    let marker = signalled.to_string_lossy().replace('\'', "'\\''");
    let source = format!(
        r#"stty -echo; /bin/sh -c 'trap "" HUP; trap "printf signalled > \"$1\"" TERM; printf "\nEXIT_JOB_PID:%s\nEXIT_JOB_READY\n" "$$"; while :; do /bin/sleep .1; done' sh '{marker}' &{enter}"#,
        enter = '\r'
    );
    manager
        .write(&identity, &session.id, source.as_bytes())
        .unwrap();
    let output = read_until(&manager, &identity, &session.id, "EXIT_JOB_READY\r\n");
    let pid: libc::pid_t = output
        .lines()
        .find_map(|line| line.trim().strip_prefix("EXIT_JOB_PID:")?.parse().ok())
        .unwrap();
    let _cleanup = FixtureJob(process_identity(pid).unwrap());
    let exiting = manager.clone();
    let exit = std::thread::spawn(move || exiting.prepare_exit());
    let deadline = Instant::now() + Duration::from_secs(2);
    while !signalled.exists() {
        assert!(
            Instant::now() < deadline,
            "the real job did not receive TERM"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(
        !exit.is_finished(),
        "the ignoring job still owns exit cleanup"
    );
    let queued = manager.clone();
    let owner = identity.clone();
    let (finished, result) = std::sync::mpsc::channel();
    let open = std::thread::spawn(move || {
        finished
            .send(queued.open(&access, &owner, &Protection::default(), 80, 24))
            .unwrap();
    });
    let denied = result
        .recv_timeout(Duration::from_secs(4))
        .expect("queued admission exceeded bounded terminal cleanup");
    exit.join().unwrap().unwrap();
    open.join().unwrap();
    assert!(denied.is_err());
    assert!(process_identity(pid).is_none());
    assert!(manager.get(&identity).unwrap().is_none());
    manager.prepare_exit().unwrap();
}

#[test]
fn native_quit_with_a_terminal_requests_the_same_owner_confirmation_without_ending_it() {
    use tauri::Manager as _;
    use tauri_specta::Event as _;
    let (temporary, access, identity) = workspace();
    let manager = ProjectTerminalManager::new(temporary.path().join("app-data"));
    let session = manager
        .open(&access, &identity, &Protection::default(), 80, 24)
        .unwrap();
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    crate::events::events_builder().mount_events(&app);
    app.manage(manager.clone());
    app.manage(crate::window::WindowManager::default());
    assert!(crate::window::defer_terminal_quit(app.handle())
        .unwrap_err()
        .contains("main window is unavailable"));
    assert_eq!(manager.get(&identity).unwrap().unwrap().id, session.id);
    let window =
        tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::App("index.html".into()))
            .build()
            .unwrap();
    let (published, received) = std::sync::mpsc::channel();
    crate::events::TerminalQuitRequestedEvent::listen_any(&app, move |event| {
        published.send(event.payload).unwrap();
    });

    for _ in 0..2 {
        assert!(crate::window::defer_terminal_quit(app.handle()).unwrap());
        let request = received.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(request.identity, identity);
        assert_eq!(request.session_id, session.id);
        assert_eq!(manager.get(&identity).unwrap().unwrap().id, session.id);
        assert!(window.is_visible().unwrap());
    }
    // Ignoring/cancelling the request does not signal the terminal or its jobs.
    manager
        .write(
            &identity,
            &session.id,
            b"printf '\\nCANCELLED_QUIT_READY\\n'\r",
        )
        .unwrap();
    read_until(&manager, &identity, &session.id, "CANCELLED_QUIT_READY\r\n");
    let state = app.state::<crate::window::WindowManager>();
    let cancelled = state.begin_terminal_quit().unwrap();
    let saving = state.begin_terminal_quit().unwrap();
    state.finish_terminal_quit(cancelled).unwrap();
    manager.close(&identity, &session.id).unwrap();
    assert!(
        crate::window::defer_terminal_quit(app.handle()).unwrap(),
        "an old Cancel cannot release a newer confirmation that is still saving after terminal close"
    );
    state.quitting.store(true, Ordering::SeqCst);
    assert!(
        crate::window::defer_terminal_quit(app.handle()).unwrap(),
        "beforeunload/fade bookkeeping is not approval to bypass confirmation"
    );
    assert!(received.try_recv().is_err());
    state.quit_approved.store(true, Ordering::SeqCst);
    assert!(!crate::window::defer_terminal_quit(app.handle()).unwrap());
    manager.prepare_exit().unwrap();
    state.quit_approved.store(false, Ordering::SeqCst);
    state.quitting.store(false, Ordering::SeqCst);
    state.finish_terminal_quit(saving).unwrap();
    state.finish_terminal_quit(saving).unwrap();
    assert!(!crate::window::defer_terminal_quit(app.handle()).unwrap());
    assert!(received.try_recv().is_err());
}

#[test]
fn unconfirmed_terminal_cleanup_survives_manager_drop_and_is_recovered_without_harming_other_processes(
) {
    let (temporary, access, identity) = workspace();
    let data = temporary.path().join("app-data");
    let manager = ProjectTerminalManager::new(data.clone());
    let session = manager
        .open(&access, &identity, &Protection::default(), 80, 24)
        .unwrap();
    let mut unrelated = UnrelatedProcess(
        std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap(),
    );
    manager.write(&identity, &session.id, b"stty -echo; /bin/sh -c 'trap \"\" HUP TERM; while :; do /bin/sleep 1; done' & pid=$!; /bin/sleep .1; printf '\\nRECOVER_%s:%s\\nRECOVERY_%s\\n' PID $pid READY; /bin/sleep 30\r").unwrap();
    let output = read_until(&manager, &identity, &session.id, "RECOVERY_READY\r\n");
    let pid: libc::pid_t = output
        .lines()
        .find_map(|line| {
            line.trim()
                .strip_prefix("RECOVER_PID:")
                .and_then(|pid| pid.parse().ok())
        })
        .unwrap();
    let _job_cleanup = FixtureJob(process_identity(pid).unwrap());
    // System-boundary fixture: kernel teardown cannot be confirmed. Both
    // explicit close and the final owner drop must leave recovery possible.
    manager.simulate_unconfirmed_cleanup();
    // Also make the first journal refresh genuinely unwritable. A retry must
    // publish the job identities before treating that refresh as complete.
    let retained = temporary.path().join("retained-app-data");
    std::fs::rename(&data, &retained).unwrap();
    std::fs::write(&data, "temporary storage failure").unwrap();
    assert!(manager.close(&identity, &session.id).is_err());
    std::fs::rename(&data, temporary.path().join("storage-obstacle")).unwrap();
    std::fs::rename(retained, &data).unwrap();
    assert!(manager.close(&identity, &session.id).is_err());
    assert!(manager.get(&identity).unwrap().is_some());
    drop(manager);
    assert!(process_identity(pid).is_some());
    let leader = unsafe { libc::getsid(pid) };
    unsafe {
        libc::kill(leader, libc::SIGKILL);
        libc::waitpid(leader, std::ptr::null_mut(), 0);
    }
    let recovered = ProjectTerminalManager::new(data);
    recovered.recover().unwrap();
    assert!(process_identity(pid).is_none());
    assert!(unrelated.0.try_wait().unwrap().is_none());
    let replacement = recovered
        .open(&access, &identity, &Protection::default(), 80, 24)
        .unwrap();
    assert_ne!(replacement.id, session.id);
    recovered.close(&identity, &replacement.id).unwrap();
}

#[test]
fn recovered_terminal_ownership_never_signals_a_reused_or_foreign_identity() {
    let (temporary, access, identity) = workspace();
    let data = temporary.path().join("app-data");
    std::fs::create_dir(&data).unwrap();
    let mut command = Command::new("/bin/sleep");
    command.arg("30");
    // A real unrelated POSIX session; its PID deliberately stands in for a
    // reused saved session ID, with a different recorded birth identity.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut foreign = UnrelatedProcess(command.spawn().unwrap());
    let pid = foreign.0.id() as libc::pid_t;
    let birth = process_identity_including_zombies(pid).unwrap();
    let record = serde_json::json!({
        "leader": {"pid":pid,"seconds":birth.seconds + 1,"microseconds":birth.microseconds},
        "members": [{"pid":pid,"seconds":birth.seconds + 1,"microseconds":birth.microseconds}]
    });
    let saved = serde_json::to_vec(&record).unwrap();
    let file = data.join("project-terminal.json");
    std::fs::write(&file, &saved).unwrap();
    let manager = ProjectTerminalManager::new(data);
    assert!(manager
        .recover()
        .unwrap_err()
        .contains("could not be verified"));
    assert!(manager
        .open(&access, &identity, &Protection::default(), 80, 24)
        .is_err());
    assert_eq!(
        std::fs::read(file).unwrap(),
        saved,
        "unresolved ownership stays durable"
    );
    assert!(
        foreign.0.try_wait().unwrap().is_none(),
        "PID reuse never authorizes a signal"
    );
    foreign.0.kill().unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while process_identity(pid).is_some() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    manager.recover().unwrap();
    assert!(
        foreign.0.wait().is_ok(),
        "recovery must not reap an unrelated exited child"
    );
}

#[test]
fn failed_terminal_registration_retains_the_live_owner_when_startup_cleanup_is_unconfirmed() {
    // Dropping the PTY can end its last job between recovery's process census
    // and birth verification. Repeat the real public rollback to cover that race.
    for _ in 0..200 {
        let (temporary, access, identity) = workspace();
        let data = temporary.path().join("app-data");
        std::fs::create_dir(&data).unwrap();
        std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o500)).unwrap();
        let manager = ProjectTerminalManager::new(data.clone());
        manager.simulate_unconfirmed_cleanup();
        assert!(manager
            .open(&access, &identity, &Protection::default(), 80, 24)
            .is_err());
        let owned = manager
            .get(&identity)
            .unwrap()
            .expect("unconfirmed shell is retained");
        assert!(manager
            .open(&access, &identity, &Protection::default(), 80, 24)
            .is_err());
        assert_eq!(
            manager.get(&identity).unwrap().unwrap().id,
            owned.id,
            "a failed startup cannot admit a second shell"
        );
        std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(manager.close(&identity, &owned.id).is_err());
        drop(manager);
        ProjectTerminalManager::new(data).recover().unwrap();
    }
}

#[test]
fn a_reaped_terminal_stays_queryable_when_clearing_its_durable_record_fails() {
    let (temporary, access, identity) = workspace();
    let data = temporary.path().join("app-data");
    let manager = ProjectTerminalManager::new(data.clone());
    let session = manager
        .open(&access, &identity, &Protection::default(), 80, 24)
        .unwrap();
    manager.write(&identity, &session.id, b"exit 7\r").unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    while manager.get(&identity).unwrap().unwrap().state != TerminalState::Exited {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o500)).unwrap();
    let cleanup = manager.close(&identity, &session.id);
    std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(cleanup.is_err());
    let retained = manager.get(&identity).unwrap().unwrap();
    assert_eq!(retained.state, TerminalState::Exited);
    assert_eq!(retained.exit_code, Some(7));
    manager.close(&identity, &session.id).unwrap();
}

#[test]
fn project_terminal_is_a_real_tty_in_the_issued_project_directory() {
    let (temporary, access, identity) = workspace();
    let manager = ProjectTerminalManager::new(temporary.path().join("app-data"));
    let session = manager
        .open(&access, &identity, &Protection::default(), 80, 24)
        .unwrap();
    manager
        .write(
            &identity,
            &session.id,
            b"test -t 0 && printf '\\nTTY_OK\\n'; pwd; printf '\\nREADY_END\\n'\r",
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut output = Vec::new();
    while !String::from_utf8_lossy(&output).contains("TTY_OK\r\n")
        || !String::from_utf8_lossy(&output).contains("工程 with spaces\r\n")
    {
        assert!(
            Instant::now() < deadline,
            "{}",
            String::from_utf8_lossy(&output)
        );
        output.extend(manager.read(&identity, &session.id).unwrap().bytes);
    }
    manager.close(&identity, &session.id).unwrap();
}

#[test]
fn project_terminal_preserves_split_utf8_and_reports_eof_separately_from_exit() {
    let (temporary, access, identity) = workspace();
    let manager = ProjectTerminalManager::new(temporary.path().join("app-data"));
    let session = manager
        .open(&access, &identity, &Protection::default(), 80, 24)
        .unwrap();
    manager.write(&identity, &session.id, b"stty -echo; printf '\\nUTF_START\\n\\360\\237'; sleep .05; printf '\\221\\251\\342\\200\\215\\360\\237\\222\\273\\nUTF_END\\n'; exit 7\r").unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut bytes = Vec::new();
    let mut sequence = 0;
    loop {
        let packet = manager.read(&identity, &session.id).unwrap();
        assert_eq!(packet.session_id, session.id);
        assert!(packet.sequence > sequence);
        sequence = packet.sequence;
        bytes.extend(packet.bytes);
        if packet.eof {
            break;
        }
        assert!(Instant::now() < deadline, "terminal did not reach EOF");
    }
    assert!(String::from_utf8(bytes)
        .unwrap()
        .contains("UTF_START\r\n👩‍💻\r\nUTF_END\r\n"));
    let snapshot = loop {
        let snapshot = manager.get(&identity).unwrap().unwrap();
        if snapshot.state == TerminalState::Exited {
            break snapshot;
        }
        assert!(Instant::now() < deadline, "shell did not exit after EOF");
        std::thread::sleep(Duration::from_millis(5));
    };
    assert_eq!(snapshot.state, TerminalState::Exited);
    assert_eq!(snapshot.exit_code, Some(7));
    manager.close(&identity, &session.id).unwrap();
    manager.close(&identity, &session.id).unwrap();
    assert!(manager.read(&identity, &session.id).is_err());
}

fn read_until(
    manager: &ProjectTerminalManager,
    identity: &str,
    id: &str,
    expected: &str,
) -> String {
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut bytes = Vec::new();
    loop {
        bytes.extend(manager.read(identity, id).unwrap().bytes);
        let output = String::from_utf8_lossy(&bytes);
        if output.contains(expected) {
            return output.into_owned();
        }
        assert!(Instant::now() < deadline, "missing {expected:?}: {output}");
    }
}

#[test]
fn project_terminal_resizes_and_ctrl_c_interrupts_the_foreground_job_only() {
    let (temporary, access, identity) = workspace();
    let manager = ProjectTerminalManager::new(temporary.path().join("app-data"));
    let session = manager
        .open(&access, &identity, &Protection::default(), 80, 24)
        .unwrap();
    manager.resize(&identity, &session.id, 91, 27).unwrap();
    manager
        .write(
            &identity,
            &session.id,
            b"stty -echo; stty size; printf '\\nFOREGROUND_READY\\n'; /bin/sleep 30\r",
        )
        .unwrap();
    let output = read_until(&manager, &identity, &session.id, "FOREGROUND_READY\r\n");
    assert!(output.contains("27 91\r\n"));
    std::thread::sleep(Duration::from_millis(50));
    manager.write(&identity, &session.id, &[3]).unwrap();
    std::thread::sleep(Duration::from_millis(50));
    manager
        .write(&identity, &session.id, b"printf '\\nAFTER_INTERRUPT\\n'\r")
        .unwrap();
    read_until(&manager, &identity, &session.id, "AFTER_INTERRUPT\r\n");
    assert_eq!(
        manager.get(&identity).unwrap().unwrap().state,
        TerminalState::Running
    );
    manager.close(&identity, &session.id).unwrap();
}

struct UnrelatedProcess(std::process::Child);
impl Drop for UnrelatedProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct FixtureJob(ProcessIdentity);
impl Drop for FixtureJob {
    fn drop(&mut self) {
        // Failed assertions must not leak the deliberately HUP/TERM-ignoring
        // fixture. Its own process group is unrelated to the test runner.
        if process_identity(self.0.pid).as_ref() == Some(&self.0)
            && unsafe { libc::getpgid(self.0.pid) } == self.0.pid
        {
            unsafe {
                libc::kill(-self.0.pid, libc::SIGKILL);
            }
        }
    }
}

#[test]
fn ending_a_terminal_cleans_surviving_jobs_after_the_leader_exits_and_preserves_other_processes() {
    let (temporary, access, identity) = workspace();
    let manager = ProjectTerminalManager::new(temporary.path().join("app-data"));
    let session = manager
        .open(&access, &identity, &Protection::default(), 80, 24)
        .unwrap();
    let mut unrelated = UnrelatedProcess(
        std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap(),
    );
    manager
        .write(
            &identity,
            &session.id,
            b"stty -echo; printf '\\nJOB_FIXTURE_READY\\n'\r",
        )
        .unwrap();
    read_until(&manager, &identity, &session.id, "JOB_FIXTURE_READY\r\n");
    manager.write(&identity, &session.id, b"stty -echo; /bin/sh -c 'trap \"\" HUP TERM; while :; do /bin/sleep 1; done' & pid=$!; /bin/sleep .1; printf '\\nSURVIVOR_%s:%s\\nJOB_%s\\n' PID $pid ANCHOR; kill -KILL $$\r").unwrap();
    let output = read_until(&manager, &identity, &session.id, "JOB_ANCHOR\r\n");
    let pid: libc::pid_t = output
        .lines()
        .find_map(|line| {
            line.trim()
                .strip_prefix("SURVIVOR_PID:")
                .and_then(|pid| pid.parse().ok())
        })
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while manager.get(&identity).unwrap().unwrap().state != TerminalState::Exited {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(
        unsafe { libc::kill(pid, 0) },
        0,
        "a background job survives the shell leader"
    );
    crate::project::children::with_managed_child_pids(|managed| {
        assert!(
            managed.iter().any(|owner| owner.matches(pid as u32, None)),
            "terminal jobs are protected from foreign port release"
        );
    });
    manager.close(&identity, &session.id).unwrap();
    assert!(
        process_identity(pid).is_none(),
        "the managed job ended, not just its leader"
    );
    assert!(
        unrelated.0.try_wait().unwrap().is_none(),
        "unrelated/performance processes stay alive"
    );
    assert!(manager.get(&identity).unwrap().is_none());
}

fn close_with_deadline(manager: &ProjectTerminalManager, identity: &str, id: &str) {
    let manager = manager.clone();
    let identity = identity.to_owned();
    let id = id.to_owned();
    let (finished, result) = std::sync::mpsc::channel();
    let close = std::thread::spawn(move || finished.send(manager.close(&identity, &id)).unwrap());
    result
        .recv_timeout(Duration::from_secs(4))
        .expect("terminal close exceeded its bound")
        .unwrap();
    close.join().unwrap();
}

#[test]
fn ending_a_terminal_unblocks_pending_reads_and_full_output_without_a_lock_cycle() {
    let (temporary, access, identity) = workspace();
    let manager = ProjectTerminalManager::new(temporary.path().join("app-data"));
    let session = manager
        .open(&access, &identity, &Protection::default(), 80, 24)
        .unwrap();
    manager
        .write(&identity, &session.id, b"printf '\\nIDLE_READY\\n'\r")
        .unwrap();
    read_until(&manager, &identity, &session.id, "IDLE_READY\r\n");
    let reader = manager.clone();
    let owner = identity.clone();
    let id = session.id.clone();
    let (started, pending) = std::sync::mpsc::channel();
    let read = std::thread::spawn(move || {
        started.send(()).unwrap();
        reader.read(&owner, &id)
    });
    pending.recv_timeout(Duration::from_secs(1)).unwrap();
    std::thread::sleep(Duration::from_millis(10));
    close_with_deadline(&manager, &identity, &session.id);
    let _ = read.join().unwrap();
    assert!(manager.read(&identity, &session.id).is_err());

    let replacement = manager
        .open(&access, &identity, &Protection::default(), 80, 24)
        .unwrap();
    assert_ne!(replacement.id, session.id);
    manager
        .write(&identity, &replacement.id, b"/usr/bin/yes bounded-output\r")
        .unwrap();
    std::thread::sleep(Duration::from_millis(100));
    close_with_deadline(&manager, &identity, &replacement.id);
    assert!(manager.get(&identity).unwrap().is_none());
}
