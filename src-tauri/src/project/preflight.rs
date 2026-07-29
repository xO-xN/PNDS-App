//! Preflight checks: orphaned-process cleanup, dependency check, and port
//! availability. See `docs/PNDS_APP_REQUIREMENTS.md` §4, §7, §8.2.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

/// File (inside the app data dir) recording child processes of the current
/// session. Task-2 (Node runtime) and task-4 (scsynth) register children here
/// so an abnormal App exit can be cleaned up on the next launch (§8.2).
const SESSION_CHILDREN_FILE: &str = "session-children.json";

/// A child process started by this App, with a marker substring that must
/// appear in the live command line for the PID to be considered ours.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionChild {
    pub pid: u32,
    /// Substring expected in the process command line (e.g. the absolute
    /// project entry path for node, or "scsynth" plus its `-u` port).
    pub marker: String,
}

fn session_children_path(dir: &Path) -> PathBuf {
    dir.join(SESSION_CHILDREN_FILE)
}

/// Records a child process started by this session (called when spawning
/// node/scsynth in later tasks).
#[allow(dead_code)] // Used by task-2 (node runtime) and task-4 (scsynth).
pub fn record_session_child(dir: &Path, pid: u32, marker: String) -> Result<(), String> {
    let mut children = read_session_children(dir).unwrap_or_default();
    children.retain(|c| c.pid != pid);
    children.push(SessionChild { pid, marker });
    write_session_children(dir, &children)
}

/// Removes a child from the session record (called after graceful shutdown).
#[allow(dead_code)] // Used by task-2 (node runtime) and task-4 (scsynth).
pub fn clear_session_child(dir: &Path, pid: u32) -> Result<(), String> {
    let mut children = read_session_children(dir).unwrap_or_default();
    children.retain(|c| c.pid != pid);
    write_session_children(dir, &children)
}

fn read_session_children(dir: &Path) -> Result<Vec<SessionChild>, String> {
    let path = session_children_path(dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read session children file: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Failed to parse session children file: {e}"))
}

#[allow(dead_code)] // Used via record_session_child / clear_session_child.
fn write_session_children(dir: &Path, children: &[SessionChild]) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
    let raw = serde_json::to_string_pretty(children)
        .map_err(|e| format!("Failed to serialize session children: {e}"))?;
    std::fs::write(session_children_path(dir), raw)
        .map_err(|e| format!("Failed to write session children file: {e}"))
}

fn process_alive(pid: u32) -> bool {
    Command::new("/bin/kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn process_command_line(pid: u32) -> Option<String> {
    let output = Command::new("/bin/ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn terminate(pid: u32) {
    let _ = Command::new("/bin/kill").arg(pid.to_string()).status();
    let deadline = Instant::now() + Duration::from_secs(2);
    while process_alive(pid) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
    }
    if process_alive(pid) {
        log::warn!("PID {pid} ignored SIGTERM, sending SIGKILL");
        let _ = Command::new("/bin/kill")
            .args(["-9", &pid.to_string()])
            .status();
    }
}

/// §8.2: terminates child processes left behind by an abnormal previous exit.
/// Runs at startup and before preflight; the port-conflict check is only
/// meaningful afterwards. Returns how many processes were terminated.
pub fn cleanup_orphaned_processes(dir: &Path) -> Result<u32, String> {
    let path = session_children_path(dir);
    if !path.exists() {
        return Ok(0);
    }

    let children = read_session_children(dir).unwrap_or_else(|e| {
        log::warn!("Discarding unreadable session children file: {e}");
        Vec::new()
    });

    let mut terminated = 0u32;
    for child in &children {
        if !process_alive(child.pid) {
            continue;
        }
        match process_command_line(child.pid) {
            // Only kill when the live process still looks like ours; a
            // recycled PID belonging to something else must be left alone.
            Some(cmdline) if cmdline.contains(&child.marker) => {
                log::info!(
                    "Terminating orphaned {} (pid {}): {cmdline}",
                    child.marker,
                    child.pid
                );
                terminate(child.pid);
                terminated += 1;
            }
            other => {
                log::debug!(
                    "Skipping pid {} (marker {:?}); live command does not match: {other:?}",
                    child.pid,
                    child.marker
                );
            }
        }
    }

    if terminated > 0 {
        log::info!("Cleaned up {terminated} orphaned process(es) from previous session");
    }
    // Whether or not anything was alive, the old record is now stale.
    if let Err(e) = std::fs::remove_file(&path) {
        log::warn!("Failed to remove session children file: {e}");
    }
    Ok(terminated)
}

/// §4: the project must ship its installed production dependencies.
pub fn check_dependencies(project_root: &Path) -> Result<(), String> {
    let node_modules = project_root.join("node_modules");
    if !node_modules.is_dir() {
        return Err(format!(
            "Project dependencies are missing.\nExpected: {}",
            node_modules.display()
        ));
    }
    Ok(())
}

/// §7: both HTTP ports must be free. No auto-rebinding, no manifest edits —
/// a conflict fails preflight with an actionable message.
pub fn check_ports_available(performer_port: u16, monitor_port: u16) -> Result<(), String> {
    for port in [performer_port, monitor_port] {
        if std::net::TcpListener::bind(("0.0.0.0", port)).is_err() {
            return Err(format!(
                "Port {port} is already in use.\nClose the application using it (find it with: lsof -i :{port}) and try again."
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn dependencies_missing_uses_contract_wording() {
        let dir = tempfile::tempdir().unwrap();
        let err = check_dependencies(dir.path()).unwrap_err();
        assert!(
            err.contains("Project dependencies are missing."),
            "unexpected: {err}"
        );
        assert!(err.contains("node_modules"), "unexpected: {err}");
    }

    #[test]
    fn dependencies_present_passes() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("node_modules")).unwrap();
        check_dependencies(dir.path()).unwrap();
    }

    #[test]
    fn occupied_port_is_reported() {
        let listener = std::net::TcpListener::bind(("0.0.0.0", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let err = check_ports_available(port, 0).unwrap_err();
        assert!(
            err.contains(&format!("Port {port} is already in use")),
            "unexpected: {err}"
        );
        // No rebind-after-drop assertion: tests run in parallel, and another
        // test may legitimately grab the freed ephemeral port first (a
        // 127.0.0.1 bind collides with a 0.0.0.0 wildcard bind on macOS).
    }

    #[test]
    fn cleanup_without_record_is_noop() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(cleanup_orphaned_processes(dir.path()).unwrap(), 0);
    }

    #[test]
    fn cleanup_ignores_dead_pids_and_removes_record() {
        let dir = tempfile::tempdir().unwrap();
        // Almost certainly not a live PID.
        write_session_children(
            dir.path(),
            &[SessionChild {
                pid: 4_000_000,
                marker: "node".into(),
            }],
        )
        .unwrap();
        assert_eq!(cleanup_orphaned_processes(dir.path()).unwrap(), 0);
        assert!(!session_children_path(dir.path()).exists());
    }

    #[test]
    fn cleanup_kills_matching_live_process() {
        let dir = tempfile::tempdir().unwrap();
        let mut child = Command::new("sleep").arg("30").spawn().unwrap();
        let pid = child.id();
        record_session_child(dir.path(), pid, "sleep 30".into()).unwrap();

        assert_eq!(cleanup_orphaned_processes(dir.path()).unwrap(), 1);

        // Reap and confirm it is gone.
        let _ = child.wait();
        assert!(!process_alive(pid));
    }

    #[test]
    fn cleanup_spares_process_when_marker_mismatches() {
        let dir = tempfile::tempdir().unwrap();
        let mut child = Command::new("sleep").arg("30").spawn().unwrap();
        let pid = child.id();
        write_session_children(
            dir.path(),
            &[SessionChild {
                pid,
                marker: "definitely-not-sleep".into(),
            }],
        )
        .unwrap();

        assert_eq!(cleanup_orphaned_processes(dir.path()).unwrap(), 0);
        assert!(process_alive(pid));

        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn record_and_clear_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        record_session_child(dir.path(), 1234, "node server.js".into()).unwrap();
        record_session_child(dir.path(), 5678, "scsynth -u 57110".into()).unwrap();
        assert_eq!(read_session_children(dir.path()).unwrap().len(), 2);

        clear_session_child(dir.path(), 1234).unwrap();
        let remaining = read_session_children(dir.path()).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].pid, 5678);
    }
}
