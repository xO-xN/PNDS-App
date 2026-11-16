use super::*;
use crate::project::creation::{CreationAccess, Protection};
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
fn project_terminal_is_a_real_tty_in_the_issued_project_directory() {
    let (_temporary, access, identity) = workspace();
    let manager = ProjectTerminalManager::default();
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
    let (_temporary, access, identity) = workspace();
    let manager = ProjectTerminalManager::default();
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
    let (_temporary, access, identity) = workspace();
    let manager = ProjectTerminalManager::default();
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

#[test]
fn ending_a_terminal_cleans_surviving_jobs_after_the_leader_exits_and_preserves_other_processes() {
    let (_temporary, access, identity) = workspace();
    let manager = ProjectTerminalManager::default();
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
    let (_temporary, access, identity) = workspace();
    let manager = ProjectTerminalManager::default();
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
