//! Child-process registry: unified lifecycle for score-server (Node) and
//! audio-server (scsynth) processes. Owns the session-children bookkeeping
//! (§8.2) and the SIGTERM → grace → SIGKILL escalation policy.
//!
//! Formerly these responsibilities were split between `session.rs`
//! (`stop_child_gracefully` + record calls) and `preflight.rs`
//! (`terminate`, `process_alive`, the orphan registry).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::time::{Duration, Instant};

/// Default escalation window (§8.2). Overridable per call.
pub const SHUTDOWN_GRACE_WINDOW: Duration = Duration::from_secs(5);
/// Orphan cleanup uses a shorter window.
const ORPHAN_GRACE_WINDOW: Duration = Duration::from_secs(2);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(100);

const SESSION_CHILDREN_FILE: &str = "session-children.json";

/// A process that the App started and must clean up on exit / next launch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionChild {
    pub pid: u32,
    pub marker: String,
}

// ---------------------------------------------------------------------------
// Shared kill escalation
// ---------------------------------------------------------------------------

/// §8.2: graceful stop — SIGTERM, poll, escalate to SIGKILL on timeout.
/// The **single** implementation of the policy.
pub fn kill_escalate(child: &mut Child, pid: u32, timeout: Duration) {
    let _ = Command::new("/bin/kill").arg(pid.to_string()).status();
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {
                if Instant::now() >= deadline {
                    log::warn!("PID {pid} ignored SIGTERM for {timeout:?}; sending SIGKILL");
                    let _ = child.kill();
                    let _ = child.wait();
                    return;
                }
                std::thread::sleep(PROCESS_POLL_INTERVAL);
            }
            Err(e) => {
                log::warn!("Failed to wait for PID {pid}: {e}; sending SIGKILL");
                let _ = child.kill();
                let _ = child.wait();
                return;
            }
        }
    }
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

// ---------------------------------------------------------------------------
// Child registry
// ---------------------------------------------------------------------------

pub struct ChildRegistry {
    dir: PathBuf,
}

impl ChildRegistry {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self { dir: app_data_dir }
    }

    fn file(&self) -> PathBuf {
        self.dir.join(SESSION_CHILDREN_FILE)
    }

    pub fn record(&self, pid: u32, marker: String) {
        let mut children = self.read().unwrap_or_default();
        children.retain(|c| c.pid != pid);
        children.push(SessionChild { pid, marker });
        if let Err(e) = self.write(&children) {
            log::warn!("Failed to record session child {pid}: {e}");
        }
    }

    pub fn clear(&self, pid: u32) {
        let mut children = self.read().unwrap_or_default();
        children.retain(|c| c.pid != pid);
        if let Err(e) = self.write(&children) {
            log::warn!("Failed to clear session child {pid}: {e}");
        }
    }

    fn read(&self) -> Result<Vec<SessionChild>, String> {
        let path = self.file();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read session children file: {e}"))?;
        serde_json::from_str(&raw)
            .map_err(|e| format!("Failed to parse session children file: {e}"))
    }

    fn write(&self, children: &[SessionChild]) -> Result<(), String> {
        std::fs::create_dir_all(&self.dir)
            .map_err(|e| format!("Failed to create app data dir: {e}"))?;
        let raw = serde_json::to_string_pretty(children)
            .map_err(|e| format!("Failed to serialize session children: {e}"))?;
        std::fs::write(self.file(), raw)
            .map_err(|e| format!("Failed to write session children file: {e}"))
    }

    /// §8.2: terminates child processes left behind by an abnormal
    /// previous exit. Returns how many were terminated.
    pub fn cleanup_orphans(&self) -> Result<u32, String> {
        let path = self.file();
        if !path.exists() {
            return Ok(0);
        }

        let children = self.read().unwrap_or_else(|e| {
            log::warn!("Discarding unreadable session children file: {e}");
            Vec::new()
        });

        let mut terminated = 0u32;
        for child in &children {
            if !process_alive(child.pid) {
                continue;
            }
            match process_command_line(child.pid) {
                Some(cmdline) if cmdline.contains(&child.marker) => {
                    log::info!(
                        "Terminating orphaned {} (pid {}): {cmdline}",
                        child.marker,
                        child.pid
                    );
                    let _ = Command::new("/bin/kill")
                        .arg(child.pid.to_string())
                        .status();
                    let deadline = Instant::now() + ORPHAN_GRACE_WINDOW;
                    while process_alive(child.pid) && Instant::now() < deadline {
                        std::thread::sleep(PROCESS_POLL_INTERVAL);
                    }
                    if process_alive(child.pid) {
                        log::warn!("Orphan pid {} ignored SIGTERM; sending SIGKILL", child.pid);
                        let _ = Command::new("/bin/kill")
                            .args(["-9", &child.pid.to_string()])
                            .status();
                    }
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
        if let Err(e) = std::fs::remove_file(&path) {
            log::warn!("Failed to remove session children file: {e}");
        }
        Ok(terminated)
    }
}

/// PendingChild guard (architecture review finding #6) — defined but not
/// yet wired. The current start()'s boot_scsynth already handles
/// kill-on-/status-timeout; node-spawn failure is rare enough for now.

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn escalate_kills_child() {
        let mut child = Command::new("sleep").arg("30").spawn().unwrap();
        let pid = child.id();
        kill_escalate(&mut child, pid, Duration::from_secs(2));
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn cleanup_without_record_is_noop() {
        let dir = tempfile::tempdir().unwrap();
        let reg = ChildRegistry::new(dir.path().to_path_buf());
        assert_eq!(reg.cleanup_orphans().unwrap(), 0);
    }

    #[test]
    fn cleanup_ignores_dead_pids_and_removes_record() {
        let dir = tempfile::tempdir().unwrap();
        let reg = ChildRegistry::new(dir.path().to_path_buf());
        reg.record(4_000_000, "node".into());
        assert_eq!(reg.cleanup_orphans().unwrap(), 0);
        assert!(!reg.file().exists());
    }

    #[test]
    fn record_and_clear_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let reg = ChildRegistry::new(dir.path().to_path_buf());
        reg.record(1234, "node server.js".into());
        reg.record(5678, "scsynth -u 57110".into());
        assert_eq!(reg.read().unwrap().len(), 2);

        reg.clear(1234);
        let remaining = reg.read().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].pid, 5678);
    }
}
