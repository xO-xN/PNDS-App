//! Port occupancy inspection and release (v1.2.0, issue #14).
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

use serde::Serialize;
use specta::Type;
use std::process::Command;

use crate::project::children::{process_command_line, terminate_pid_escalate, ORPHAN_GRACE_WINDOW};

/// Who is listening on a project port.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PortOccupant {
    pub pid: u32,
    /// Short process name — the first token of the full command line.
    pub name: String,
    /// Full command line, for the confirm dialog and the error page.
    pub command_line: String,
}

/// Occupancy of one TCP port.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PortStatus {
    pub port: u16,
    pub occupant: Option<PortOccupant>,
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
    let args = ["-nP", "-w", "-Fp", &format!("-iTCP:{port}"), "-sTCP:LISTEN"];
    for binary in ["/usr/sbin/lsof", "lsof"] {
        if let Ok(output) = Command::new(binary).args(args.iter()).output() {
            return parse_lsof_pids(&String::from_utf8_lossy(&output.stdout));
        }
    }
    Vec::new()
}

fn occupant_identity(pid: u32) -> Option<PortOccupant> {
    let command_line = process_command_line(pid)?;
    let name = command_line
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_string();
    Some(PortOccupant {
        pid,
        name,
        command_line,
    })
}

/// Occupancy of `port`: the first listener's full identity, or None when the
/// port is free (or lsof is unavailable — the status then reads "available",
/// and the authoritative check remains the preflight bind).
pub fn port_status(port: u16) -> PortStatus {
    let occupant = listening_pids(port).into_iter().find_map(occupant_identity);
    PortStatus { port, occupant }
}

/// Releases `port`: resolves the occupant fresh (so a stale confirm dialog
/// can never kill a recycled pid), terminates it via the shared §12
/// escalation, and reports the port's new truth — free, or held by whoever
/// took it over.
pub fn release_port(port: u16) -> PortStatus {
    let before = port_status(port);
    let Some(occupant) = &before.occupant else {
        return before;
    };
    if terminate_pid_escalate(occupant.pid, ORPHAN_GRACE_WINDOW) {
        log::info!("Released port {port} (terminated pid {})", occupant.pid);
    } else {
        log::warn!(
            "Port {port}: pid {} survived SIGKILL; reporting live status",
            occupant.pid
        );
    }
    port_status(port)
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn release_of_a_free_port_is_a_noop_reporting_free() {
        let port = {
            let l = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
            l.local_addr().unwrap().port()
        };
        let status = release_port(port);
        assert_eq!(status.port, port);
        assert!(status.occupant.is_none());
    }

    /// port_status on an ephemeral port nobody holds reads available. The
    /// port is bound-and-dropped first to guarantee the kernel has seen it.
    #[test]
    fn free_port_reports_no_occupant() {
        let port = {
            let l = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
            l.local_addr().unwrap().port()
        };
        let status = port_status(port);
        // The just-closed listener may linger as TIME_WAIT, but it is not a
        // LISTEN — lsof must not report an occupant for it.
        assert_eq!(status.port, port);
        assert!(status.occupant.is_none());
    }
}
