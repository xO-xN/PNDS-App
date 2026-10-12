//! Port occupancy inspection and identity-confirmed release (#14, #163).
//!
//! The Runtime Contract is unchanged: a port conflict still fails preflight —
//! this service only adds *visibility* (who holds the port) and a manual
//! release that runs the shared SIGTERM → grace → SIGKILL escalation from
//! `project/children.rs` (§12) against the foreign pid.
//!
//! Occupancy is resolved with `lsof -nP -w -Fp -iTCP:{port} -sTCP:LISTEN`
//! (machine-readable pid lines, listeners only); the full identity (process
//! name + command line) comes from `ps -p <pid> -o command=`, mirroring the
//! orphan-cleanup ownership check.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashSet;
use std::path::Path;
use std::process::Command;

use crate::project::children::{
    process_command_line, terminate_pid_escalate_checked, with_managed_child_pids,
    ManagedChildIdentity, PidTermination, ORPHAN_GRACE_WINDOW,
};

/// Who is listening on a project port.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PortOccupant {
    pub pid: u32,
    /// Executable name from ps comm, independent of whitespace in its path.
    pub name: String,
    /// Full command line, for the confirm dialog and the error page.
    pub command_line: String,
    /// Kernel process birth time; distinguishes a reused PID with the same command.
    pub started_at: String,
}

/// Occupancy of one TCP port.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PortStatus {
    pub port: u16,
    pub occupant: Option<PortOccupant>,
    pub managed_by_app: bool,
    pub running_project: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PortReleaseOutcome {
    Released,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PortReleaseResult {
    pub outcome: PortReleaseOutcome,
    pub status: PortStatus,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPorts {
    pub performer_port: u16,
    pub monitor_port: u16,
}

/// Read saved declarations even when runtime preflight fails. No process
/// cleanup, artifact/dependency validation, or project code execution.
pub fn project_ports(root: &Path) -> Result<ProjectPorts, String> {
    let manifest = crate::project::manifest::load_manifest_lenient(root)?;
    Ok(ProjectPorts {
        performer_port: manifest.score_server.performer_port,
        monitor_port: manifest.score_server.monitor_port,
    })
}

/// Parses `lsof -Fp` output: one `p<pid>` line per listening process, in
/// lsof's order. Junk lines (warnings, other field letters) are ignored;
/// duplicate pids collapse.
pub(crate) fn parse_lsof_pids(stdout: &str) -> Vec<u32> {
    let mut pids: Vec<u32> = Vec::new();
    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix('p') {
            if let Ok(pid) = rest.trim().parse::<u32>() {
                if !pids.contains(&pid) {
                    pids.push(pid);
                }
            }
        }
    }
    pids
}

/// PIDs of every process LISTENing on `port`, regardless of bind address
/// (wildcard, loopback, or a specific interface). The authoritative occupancy
/// signal for port conflicts — a plain wildcard bind misses specific-address
/// holders on macOS (SO_REUSEADDR lets it succeed anyway). `/usr/sbin/lsof`
/// is tried first — GUI processes get a minimal PATH that usually lacks
/// /usr/sbin.
pub(crate) fn listening_pids(port: u16) -> Vec<u32> {
    query_listening_pids(port).unwrap_or_default()
}

fn query_listening_pids(port: u16) -> Result<Vec<u32>, String> {
    let args = ["-nP", "-w", "-Fp", &format!("-iTCP:{port}"), "-sTCP:LISTEN"];
    for binary in ["/usr/sbin/lsof", "lsof"] {
        if let Ok(output) = Command::new(binary).args(args.iter()).output() {
            if output.status.success()
                || (output.status.code() == Some(1) && output.stderr.is_empty())
            {
                return Ok(parse_lsof_pids(&String::from_utf8_lossy(&output.stdout)));
            }
        }
    }
    Err(format!("Could not inspect TCP listeners on port {port}"))
}

#[cfg(target_os = "macos")]
pub(crate) fn process_started_at(pid: u32) -> Option<String> {
    let pid = i32::try_from(pid).ok()?;
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::uninit();
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    // SAFETY: proc_pidinfo writes at most `size` bytes to an aligned buffer.
    // Read it only if the kernel returned the complete initialized struct.
    let written = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        )
    };
    if written != size {
        return None;
    }
    let info = unsafe { info.assume_init() };
    Some(format!(
        "{}:{}",
        info.pbi_start_tvsec, info.pbi_start_tvusec
    ))
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn process_started_at(pid: u32) -> Option<String> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    // Linux starttime is field 22; comm (field 2) may contain spaces.
    Some(stat.rsplit_once(')')?.1.split_whitespace().nth(19)?.into())
}

fn occupant_identity(pid: u32) -> Option<PortOccupant> {
    let started_at = process_started_at(pid)?;
    let command_line = process_command_line(pid)?;
    let output = Command::new("/bin/ps")
        .args(["-ww", "-p", &pid.to_string(), "-o", "comm="])
        .output()
        .ok()?;
    if !output.status.success() || process_started_at(pid)? != started_at {
        return None;
    }
    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Some(PortOccupant {
        pid,
        name,
        command_line,
        started_at,
    })
}

/// First listener's complete identity. Failed inspection is an error, never
/// a claim that the port is available. Ownership is from actual managed handles.
pub fn port_status(port: u16) -> Result<PortStatus, String> {
    with_managed_child_pids(|managed| inspect_port(port, managed))
}

fn inspect_port(port: u16, managed: &HashSet<ManagedChildIdentity>) -> Result<PortStatus, String> {
    let pids = query_listening_pids(port)?;
    let occupant = pids.iter().find_map(|pid| occupant_identity(*pid));
    if !pids.is_empty() && occupant.is_none() {
        return Err(format!(
            "Could not read the process identity on port {port}; refresh and retry"
        ));
    }
    let managed_by_app = occupant.as_ref().is_some_and(|process| {
        process.pid == std::process::id()
            || managed
                .iter()
                .any(|identity| identity.matches(process.pid, Some(&process.started_at)))
    });
    Ok(PortStatus {
        port,
        occupant,
        managed_by_app,
        running_project: None,
    })
}

/// Release only the confirmed identity. Revalidate occupancy, birth time,
/// command and managed ownership immediately before both §12 signals.
/// Stale confirmation and managed targets return Cancelled with fresh status.
pub fn release_port(port: u16, confirmed: &PortOccupant) -> Result<PortReleaseResult, String> {
    let before = port_status(port)?;
    if before.managed_by_app || before.occupant.as_ref() != Some(confirmed) {
        return Ok(PortReleaseResult {
            outcome: PortReleaseOutcome::Cancelled,
            status: before,
        });
    }
    let outcome = match terminate_pid_escalate_checked(confirmed.pid, ORPHAN_GRACE_WINDOW, || {
        listening_pids(port).contains(&confirmed.pid)
            && occupant_identity(confirmed.pid).as_ref() == Some(confirmed)
    }) {
        PidTermination::Gone => PortReleaseOutcome::Released,
        PidTermination::Cancelled => PortReleaseOutcome::Cancelled,
        PidTermination::Survived => PortReleaseOutcome::Failed,
    };
    log::info!("Port {port} release for pid {}: {outcome:?}", confirmed.pid);
    Ok(PortReleaseResult {
        outcome,
        status: port_status(port)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::children::terminate_pid_escalate;
    use crate::project::children::wait_until_gone;

    /// Fixture-style parsing tests: no real ports involved (issue #14).
    #[test]
    fn parse_lsof_pids_extracts_pid_lines() {
        let out = "p1234\n";
        assert_eq!(parse_lsof_pids(out), vec![1234]);
    }

    #[test]
    fn parse_lsof_pids_takes_multiple_and_dedups() {
        let out = "p1234\np5678\np1234\n";
        assert_eq!(parse_lsof_pids(out), vec![1234, 5678]);
    }

    #[test]
    fn parse_lsof_pids_ignores_other_fields_and_junk() {
        // -Fp emits only pid lines, but warnings can precede them and other
        // field letters appear when flags change — both must be skipped.
        let out = "lsof: some warning text\np99\nf12\ncnode\nnot-a-pid\np\np0x10\n";
        assert_eq!(parse_lsof_pids(out), vec![99]);
    }

    #[test]
    fn parse_lsof_pids_empty_output_is_empty() {
        assert!(parse_lsof_pids("").is_empty());
        assert!(parse_lsof_pids("\n\n").is_empty());
    }

    /// The escalation policy on a real process (same detached-spawn style
    /// as the children.rs orphan tests — the target is reaped by launchd,
    /// never this test, mirroring the foreign processes release acts on).
    #[test]
    fn terminate_kills_a_live_process() {
        let out = Command::new("/bin/sh")
            .args(["-c", "sleep 41 >/dev/null 2>&1 & echo $!"])
            .output()
            .unwrap();
        let pid: u32 = String::from_utf8_lossy(&out.stdout).trim().parse().unwrap();
        assert!(terminate_pid_escalate(pid, ORPHAN_GRACE_WINDOW));
        assert!(process_command_line(pid).is_none());
    }

    #[test]
    fn terminate_on_dead_process_reports_gone() {
        let mut child = Command::new("sleep").arg("0").spawn().unwrap();
        let pid = child.id();
        let _ = child.wait();
        assert!(terminate_pid_escalate(pid, ORPHAN_GRACE_WINDOW));
    }

    #[test]
    fn terminate_missing_pid_reports_gone() {
        assert!(terminate_pid_escalate(u32::MAX, ORPHAN_GRACE_WINDOW));
        assert!(wait_until_gone(u32::MAX, ORPHAN_GRACE_WINDOW));
    }

    /// Orchestration: releasing a free port is a resolve-and-return no-op
    /// that truthfully reports it free (issue #14).
    #[test]
    fn stale_confirmation_never_terminates_the_replacement_listener() {
        let original = test_support::Listener::spawn(0);
        let port = original.port;
        let confirmed = port_status(port).unwrap().occupant.unwrap();
        drop(original);
        let replacement = test_support::Listener::spawn(port);
        let result = release_port(port, &confirmed).unwrap();
        assert_eq!(result.outcome, PortReleaseOutcome::Cancelled);
        assert_eq!(result.status.occupant.unwrap().pid, replacement.pid);
    }

    #[test]
    fn confirmed_listener_is_released_and_reports_current_truth() {
        let listener = test_support::Listener::spawn(0);
        let confirmed = port_status(listener.port).unwrap().occupant.unwrap();
        let result = release_port(listener.port, &confirmed).unwrap();
        assert_eq!(result.outcome, PortReleaseOutcome::Released);
        assert!(result.status.occupant.is_none());
        assert!(process_command_line(listener.pid).is_none());
    }

    #[test]
    fn changed_birth_time_or_command_cancels_without_signalling() {
        let listener = test_support::Listener::spawn(0);
        let confirmed = port_status(listener.port).unwrap().occupant.unwrap();
        let mut recycled = confirmed.clone();
        recycled.started_at = "earlier-process".into();
        let result = release_port(listener.port, &recycled).unwrap();
        assert_eq!(result.outcome, PortReleaseOutcome::Cancelled);
        assert_eq!(result.status.occupant, Some(confirmed.clone()));
        let mut changed = confirmed.clone();
        changed.command_line = "previous command".into();
        let result = release_port(listener.port, &changed).unwrap();
        assert_eq!(result.outcome, PortReleaseOutcome::Cancelled);
        assert_eq!(result.status.occupant, Some(confirmed));
    }

    #[test]
    fn disappeared_occupancy_cancels_even_when_the_process_is_still_alive() {
        let listener = test_support::Listener::spawn(0);
        let confirmed = port_status(listener.port).unwrap().occupant.unwrap();
        let _ = Command::new("/bin/kill")
            .args(["-USR1", &listener.pid.to_string()])
            .status();
        test_support::wait_for_free_port(listener.port);
        let result = release_port(listener.port, &confirmed).unwrap();
        assert_eq!(result.outcome, PortReleaseOutcome::Cancelled);
        assert!(result.status.occupant.is_none());
        assert!(process_command_line(listener.pid).is_some());
    }

    #[test]
    fn graceful_close_cancels_escalation_if_the_process_keeps_running() {
        let listener = test_support::Listener::spawn_with_term_policy("close");
        let confirmed = port_status(listener.port).unwrap().occupant.unwrap();
        let result = release_port(listener.port, &confirmed).unwrap();
        assert_eq!(result.outcome, PortReleaseOutcome::Cancelled);
        assert!(result.status.occupant.is_none());
        assert!(process_command_line(listener.pid).is_some());
    }

    #[test]
    fn confirmed_listener_ignoring_term_uses_bounded_force_exit() {
        let listener = test_support::Listener::spawn_with_term_policy("ignore");
        let confirmed = port_status(listener.port).unwrap().occupant.unwrap();
        let result = release_port(listener.port, &confirmed).unwrap();
        assert_eq!(result.outcome, PortReleaseOutcome::Released);
        assert!(result.status.occupant.is_none());
        assert!(process_command_line(listener.pid).is_none());
    }

    #[test]
    fn app_process_is_protected_from_a_direct_release() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let before = port_status(port).unwrap();
        assert!(before.managed_by_app);
        let result = release_port(port, &before.occupant.unwrap()).unwrap();
        assert_eq!(result.outcome, PortReleaseOutcome::Cancelled);
        assert!(result.status.managed_by_app);
    }

    /// port_status on an ephemeral port nobody holds reads available. The
    /// port is bound-and-dropped first to guarantee the kernel has seen it.
    #[test]
    fn free_port_reports_no_occupant() {
        let port = {
            let l = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
            l.local_addr().unwrap().port()
        };
        let status = port_status(port).unwrap();
        // The just-closed listener may linger as TIME_WAIT, but it is not a
        // LISTEN — lsof must not report an occupant for it.
        assert_eq!(status.port, port);
        assert!(status.occupant.is_none());
    }

    #[tokio::test]
    async fn target_ports_are_read_from_saved_manifest_without_runtime_preflight() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("manifest.json"), r#"{
            "schemaVersion":1,"id":"ports-target","name":"Ports target","version":"1.0.0",
            "scoreServer":{"entry":"missing.js","workingDirectory":".","performerPort":7200,"monitorPort":7201},
            "audio":{"defaultMode":"none","supportedModes":["none"]}
        }"#).unwrap();
        let ports =
            crate::commands::project::get_project_ports(temp.path().to_string_lossy().into())
                .await
                .unwrap();
        assert_eq!((ports.performer_port, ports.monitor_port), (7200, 7201));
        assert!(!temp.path().join("missing.js").exists());
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::process::{Child, Stdio};

    pub fn listener_command(port: u16) -> Command {
        let mut command = Command::new("python3");
        command.args(["-u", "-c", "import socket,sys,time,signal,os\ns=socket.socket(); s.bind(('127.0.0.1',int(sys.argv[1]))); s.listen()\nsignal.signal(signal.SIGUSR1,lambda *_:s.close())\npolicy=os.environ.get('PNDS_TEST_TERM','')\nif policy=='close': signal.signal(signal.SIGTERM,lambda *_:s.close())\nif policy=='ignore': signal.signal(signal.SIGTERM,signal.SIG_IGN)\nprint(s.getsockname()[1],flush=True)\ntime.sleep(60)", &port.to_string()]);
        command.stdout(Stdio::piped());
        command
    }

    pub fn read_port(child: &mut Child) -> u16 {
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        line.trim().parse().unwrap()
    }

    /// Only this fixture's child is ever signalled. A waiter reaps it so
    /// the foreign-PID shutdown path observes a dead process, not a zombie.
    pub struct Listener {
        pub port: u16,
        pub pid: u32,
        waiter: Option<std::thread::JoinHandle<()>>,
    }

    impl Listener {
        pub fn spawn(port: u16) -> Self {
            let child = listener_command(port).spawn().unwrap();
            Self::from_child(child)
        }

        pub fn spawn_with_term_policy(policy: &str) -> Self {
            let child = listener_command(0)
                .env("PNDS_TEST_TERM", policy)
                .spawn()
                .unwrap();
            Self::from_child(child)
        }

        fn from_child(mut child: Child) -> Self {
            let port = read_port(&mut child);
            let pid = child.id();
            let waiter = Some(std::thread::spawn(move || {
                child.wait().unwrap();
            }));
            Self { port, pid, waiter }
        }
    }

    impl Drop for Listener {
        fn drop(&mut self) {
            if process_command_line(self.pid).is_some() {
                let _ = Command::new("/bin/kill")
                    .args(["-9", &self.pid.to_string()])
                    .status();
            }
            self.waiter.take().unwrap().join().unwrap();
        }
    }

    pub fn wait_for_free_port(port: u16) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while port_status(port).unwrap().occupant.is_some() {
            assert!(
                std::time::Instant::now() < deadline,
                "fixture failed to close port"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
}
