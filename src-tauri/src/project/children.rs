//! Child-process registry: unified lifecycle for score-server (Node) and
//! audio-server (scsynth) processes. Owns the session-children bookkeeping
//! (§12) and the SIGTERM → grace → SIGKILL escalation policy.
//!
//! `SupervisedChild` bundles the whole owned-child lifecycle — spawn (with
//! the §12 ownership record) → supervise (poll) → bounded shutdown — so the
//! escalation policy and its registry discipline are written once; session
//! children (node score server, scsynth) are held as this type.
//! `terminate_pid_escalate` is the same escalation for foreign processes
//! the App holds no Child handle of (port release, orphan cleanup).
//!
//! Formerly these responsibilities were split between `session.rs`
//! (`stop_child_gracefully` + record calls) and `preflight.rs`
//! (`terminate`, `process_alive`, the orphan registry).

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::time::{Duration, Instant};

/// Issue #93: the score server's shutdown grace window. Healthy projects
/// exit in 0.01–0.2s; the 2s bound keeps a SIGTERM-ignoring pathological
/// server from stretching the StopCover past "two or three seconds". The
/// score server has no persistent state and phone clients sit in a
/// reconnect loop, so escalating to SIGKILL early is side-effect free.
pub const SCORE_SERVER_SHUTDOWN_GRACE_WINDOW: Duration = Duration::from_secs(2);
/// Issue #93: scsynth keeps the full 5s window — CoreAudio teardown can
/// legitimately take longer than a Node exit, and rushing it risks device
/// state for a mere restart. Two named constants so the windows can be
/// tuned independently (user story #8).
pub const SCSYNTH_SHUTDOWN_GRACE_WINDOW: Duration = Duration::from_secs(5);
/// Orphan cleanup and port release use a shorter window.
pub(crate) const ORPHAN_GRACE_WINDOW: Duration = Duration::from_secs(2);
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

/// §12: graceful stop — SIGTERM, poll, escalate to SIGKILL on timeout.
/// The **single** implementation of the policy for processes the App owns
/// (a live `Child` handle).
///
/// Returns `true` only when the child was **reaped** — i.e. the process is
/// provably gone. An unconfirmed kill (§12) means the caller must keep the
/// registry's ownership record so the next start re-runs the targeted
/// orphan cleanup before it checks ports.
#[must_use]
pub fn kill_escalate(child: &mut Child, pid: u32, timeout: Duration) -> bool {
    let _ = Command::new("/bin/kill").arg(pid.to_string()).status();
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => {
                if Instant::now() >= deadline {
                    log::warn!("PID {pid} ignored SIGTERM for {timeout:?}; sending SIGKILL");
                    let _ = child.kill();
                    return child.wait().is_ok();
                }
                std::thread::sleep(PROCESS_POLL_INTERVAL);
            }
            Err(e) => {
                log::warn!("Failed to wait for PID {pid}: {e}; sending SIGKILL");
                let _ = child.kill();
                return child.wait().is_ok();
            }
        }
    }
}

/// The same §12 escalation for a pid the App does NOT own a handle of
/// (port release, and the orphan cleanup below): SIGTERM → poll → SIGKILL.
/// The orphan cleanup inlines this flow only because it also rewrites the
/// record file between the two signals; everything else goes through here.
pub(crate) fn terminate_pid_escalate(pid: u32, timeout: Duration) -> bool {
    let _ = Command::new("/bin/kill").arg(pid.to_string()).status();
    if wait_until_gone(pid, timeout) {
        return true;
    }
    log::warn!("PID {pid} ignored SIGTERM; sending SIGKILL");
    let _ = Command::new("/bin/kill")
        .args(["-9", &pid.to_string()])
        .status();
    wait_until_gone(pid, timeout)
}

fn process_alive(pid: u32) -> bool {
    Command::new("/bin/kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Full command line of a live pid (`ps -p <pid> -o command=`), or None when
/// the process is gone or unreadable. Shared with the port-release service.
pub(crate) fn process_command_line(pid: u32) -> Option<String> {
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

/// Cheap to clone (a directory path) so a `SupervisedChild` can carry its
/// own registry handle from spawn to shutdown.
#[derive(Clone)]
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

    /// §12 / §12: terminates child processes left behind by an abnormal
    /// previous exit or by a generation whose teardown could not confirm
    /// the kill. Returns how many were terminated.
    ///
    /// The cleanup is **targeted**, never a blanket `pkill`: a record is
    /// only acted on when the live pid's command line still contains the
    /// marker recorded when the App spawned it. Records whose process
    /// survives even SIGKILL are kept on disk so the next start tries
    /// again before its port preflight.
    ///
    /// `live_session_pids` exempts children the SessionManager still owns
    /// handles for (v1.2.3, issue #37): a child of the *live* session is
    /// not an orphan, so preflighting another project must leave both the
    /// process and its record alone — teardown or the next launch (after a
    /// crash) handles it. Callers with no live session pass an empty set.
    pub fn cleanup_orphans(&self, live_session_pids: &HashSet<u32>) -> Result<u32, String> {
        let path = self.file();
        if !path.exists() {
            return Ok(0);
        }

        let children = self.read().unwrap_or_else(|e| {
            log::warn!("Discarding unreadable session children file: {e}");
            Vec::new()
        });

        let mut terminated = 0u32;
        // Records that must stay on disk: children the live session still
        // owns, and orphans that survived even SIGKILL.
        let mut survivors: Vec<SessionChild> = Vec::new();
        for child in &children {
            if live_session_pids.contains(&child.pid) {
                log::debug!("Skipping pid {}: owned by the live session", child.pid);
                survivors.push(child.clone());
                continue;
            }
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
                    if !wait_until_gone(child.pid, ORPHAN_GRACE_WINDOW) {
                        log::warn!("Orphan pid {} ignored SIGTERM; sending SIGKILL", child.pid);
                        let _ = Command::new("/bin/kill")
                            .args(["-9", &child.pid.to_string()])
                            .status();
                    }
                    if wait_until_gone(child.pid, ORPHAN_GRACE_WINDOW) {
                        terminated += 1;
                    } else {
                        // §12: still alive after SIGKILL. Keep the ownership
                        // record — the port it holds is ours, and the next
                        // start must retry this cleanup before preflight.
                        log::warn!(
                            "Orphan pid {} survived SIGKILL; keeping the ownership record",
                            child.pid
                        );
                        survivors.push(child.clone());
                    }
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
        if survivors.is_empty() {
            if let Err(e) = std::fs::remove_file(&path) {
                log::warn!("Failed to remove session children file: {e}");
            }
        } else if let Err(e) = self.write(&survivors) {
            log::warn!("Failed to rewrite session children file: {e}");
        }
        Ok(terminated)
    }
}

/// Polls until `pid` is gone or `timeout` elapses. Returns whether it is gone.
pub(crate) fn wait_until_gone(pid: u32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if !process_alive(pid) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(PROCESS_POLL_INTERVAL);
    }
}

// ---------------------------------------------------------------------------
// SupervisedChild: spawn → supervise → bounded shutdown, written once
// ---------------------------------------------------------------------------

/// §12 outcome of [`SupervisedChild::shutdown`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShutdownOutcome {
    /// The child was reaped — provably gone. The ownership record (if any)
    /// is removed from the registry.
    Confirmed,
    /// The child ignored SIGTERM and could not be confirmed dead after
    /// SIGKILL. The ownership record is KEPT (created for a never-registered
    /// child) so the next start re-runs the targeted orphan cleanup before
    /// its port preflight.
    Unconfirmed,
}

/// One child process the App owns and must clean up: spawn → supervise →
/// bounded shutdown, with the §12 registry discipline attached. Session-side
/// children (node score server, scsynth) are held as this type so the kill
/// policy and the record-keeping rule exist exactly here.
pub struct SupervisedChild {
    child: Child,
    pid: u32,
    registry: ChildRegistry,
    marker: String,
    registered: bool,
}

impl SupervisedChild {
    /// Spawns `cmd` and records ownership immediately (§12): if the App
    /// dies, the next launch's targeted cleanup finds the pid + marker.
    pub fn spawn(
        registry: &ChildRegistry,
        marker: impl Into<String>,
        cmd: &mut Command,
    ) -> std::io::Result<Self> {
        let mut supervised = Self::spawn_deferred(registry, marker, cmd)?;
        supervised.register();
        Ok(supervised)
    }

    /// Spawns `cmd` WITHOUT the ownership record — for boots whose record
    /// must wait until the process proves healthy (scsynth: a failed boot
    /// kills the child itself, so only a live process earns a record; a
    /// concurrent preflight's orphan cleanup must not see a boot in flight).
    /// Call [`register`](Self::register) once it has; an unconfirmed
    /// [`shutdown`](Self::shutdown) records on its own — a corpse still owns
    /// its port / audio device.
    pub fn spawn_deferred(
        registry: &ChildRegistry,
        marker: impl Into<String>,
        cmd: &mut Command,
    ) -> std::io::Result<Self> {
        let child = cmd.spawn()?;
        let pid = child.id();
        Ok(Self {
            child,
            pid,
            registry: registry.clone(),
            marker: marker.into(),
            registered: false,
        })
    }

    /// Writes the ownership record now (idempotent).
    pub fn register(&mut self) {
        if !self.registered {
            self.registry.record(self.pid, self.marker.clone());
            self.registered = true;
        }
    }

    /// §12 bounded shutdown: SIGTERM → grace window → SIGKILL → confirm.
    /// `Confirmed` drops the ownership record; `Unconfirmed` keeps it.
    pub fn shutdown(&mut self, window: Duration) -> ShutdownOutcome {
        let outcome = if kill_escalate(&mut self.child, self.pid, window) {
            ShutdownOutcome::Confirmed
        } else {
            ShutdownOutcome::Unconfirmed
        };
        self.settle_registry(outcome);
        outcome
    }

    /// The §12 record-keeping rule as one unit, so the outcome → registry
    /// mapping is testable without faking a SIGKILL-proof process:
    /// `Confirmed` clears the record; `Unconfirmed` keeps it — creating one
    /// for a never-registered child (a boot whose health wait failed).
    fn settle_registry(&mut self, outcome: ShutdownOutcome) {
        match outcome {
            ShutdownOutcome::Confirmed => {
                if self.registered {
                    self.registry.clear(self.pid);
                }
            }
            ShutdownOutcome::Unconfirmed => self.register(),
        }
    }

    pub fn id(&self) -> u32 {
        self.pid
    }

    /// Non-blocking reap poll — the supervisor / watchdog exit checks.
    pub fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        self.child.try_wait()
    }

    /// The raw handle, for what only it can do (taking the stdout/stderr
    /// pipes, handing the live child to a health waiter). Escalation stays
    /// here.
    pub fn child(&mut self) -> &mut Child {
        &mut self.child
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    /// The no-live-session callers (app startup, the §12 retry path).
    fn no_live_session() -> HashSet<u32> {
        HashSet::new()
    }

    #[test]
    fn escalate_kills_child() {
        let mut child = Command::new("sleep").arg("30").spawn().unwrap();
        let pid = child.id();
        assert!(kill_escalate(&mut child, pid, Duration::from_secs(2)));
        assert!(child.try_wait().unwrap().is_some());
    }

    /// Issue #93: the shutdown windows are a product decision, not a
    /// mechanical default — the score server's teardown is bounded at 2s
    /// (healthy projects exit in 0.01–0.2s) while scsynth keeps 5s for
    /// CoreAudio teardown. Pin both so a casual edit surfaces in review.
    #[test]
    fn shutdown_grace_windows_match_the_spec() {
        assert_eq!(
            SCORE_SERVER_SHUTDOWN_GRACE_WINDOW,
            Duration::from_secs(2),
            "the score-server window is the StopCover bound (issue #93)"
        );
        assert_eq!(
            SCSYNTH_SHUTDOWN_GRACE_WINDOW,
            Duration::from_secs(5),
            "scsynth keeps the full window for CoreAudio teardown (issue #93)"
        );
    }

    /// §12: an unmatched marker never gets killed, and the record is
    /// dropped (the pid was recycled by an unrelated process).
    #[test]
    fn cleanup_skips_pids_whose_command_no_longer_matches() {
        let dir = tempfile::tempdir().unwrap();
        let reg = ChildRegistry::new(dir.path().to_path_buf());
        let mut child = Command::new("sleep").arg("30").spawn().unwrap();
        let pid = child.id();
        reg.record(pid, "definitely-not-this-command".into());

        assert_eq!(reg.cleanup_orphans(&no_live_session()).unwrap(), 0);
        assert!(child.try_wait().unwrap().is_none(), "must not be killed");

        assert!(kill_escalate(&mut child, pid, Duration::from_secs(2)));
    }

    /// §12: a recorded, still-matching orphan is terminated and the record
    /// file is removed once nothing is left unresolved.
    ///
    /// The orphan is spawned **detached** (re-parented to launchd) so it
    /// mirrors production: a real orphan outlived the App process and is
    /// never this test's child, so killing it leaves no zombie behind.
    #[test]
    fn cleanup_terminates_matching_orphan_and_clears_record() {
        let dir = tempfile::tempdir().unwrap();
        let reg = ChildRegistry::new(dir.path().to_path_buf());
        let out = Command::new("/bin/sh")
            .args(["-c", "sleep 41 >/dev/null 2>&1 & echo $!"])
            .output()
            .unwrap();
        let pid: u32 = String::from_utf8_lossy(&out.stdout).trim().parse().unwrap();
        reg.record(pid, "sleep 41".into());

        assert_eq!(reg.cleanup_orphans(&no_live_session()).unwrap(), 1);
        assert!(!process_alive(pid));
        assert!(!reg.file().exists());
    }

    /// v1.2.3 (issue #37): a child the live session still owns is not an
    /// orphan — cleanup must leave both the process and its record alone,
    /// or preflighting project B would kill the running project A. Once no
    /// session owns it, the same record is cleaned as before.
    #[test]
    fn cleanup_spares_children_owned_by_the_live_session() {
        let dir = tempfile::tempdir().unwrap();
        let reg = ChildRegistry::new(dir.path().to_path_buf());
        let out = Command::new("/bin/sh")
            .args(["-c", "sleep 41 >/dev/null 2>&1 & echo $!"])
            .output()
            .unwrap();
        let pid: u32 = String::from_utf8_lossy(&out.stdout).trim().parse().unwrap();
        reg.record(pid, "sleep 41".into());

        let live = HashSet::from([pid]);
        assert_eq!(reg.cleanup_orphans(&live).unwrap(), 0);
        assert!(process_alive(pid), "the live session's child must survive");
        assert_eq!(
            reg.read().unwrap().len(),
            1,
            "the ownership record must survive for teardown / crash recovery"
        );

        // Without the exemption the child is a true orphan again.
        assert_eq!(reg.cleanup_orphans(&no_live_session()).unwrap(), 1);
        assert!(!process_alive(pid));
        assert!(!reg.file().exists());
    }

    #[test]
    fn cleanup_without_record_is_noop() {
        let dir = tempfile::tempdir().unwrap();
        let reg = ChildRegistry::new(dir.path().to_path_buf());
        assert_eq!(reg.cleanup_orphans(&no_live_session()).unwrap(), 0);
    }

    #[test]
    fn cleanup_ignores_dead_pids_and_removes_record() {
        let dir = tempfile::tempdir().unwrap();
        let reg = ChildRegistry::new(dir.path().to_path_buf());
        reg.record(4_000_000, "node".into());
        assert_eq!(reg.cleanup_orphans(&no_live_session()).unwrap(), 0);
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

    // --- SupervisedChild -----------------------------------------------------

    /// §12: shutdown of a live child is Confirmed and clears the ownership
    /// record `spawn` wrote.
    #[test]
    fn supervised_shutdown_confirms_and_clears_the_record() {
        let dir = tempfile::tempdir().unwrap();
        let reg = ChildRegistry::new(dir.path().to_path_buf());
        let mut cmd = Command::new("sleep");
        cmd.arg("30");
        let mut child = SupervisedChild::spawn(&reg, "sleep 30", &mut cmd).unwrap();
        let pid = child.id();
        assert_eq!(reg.read().unwrap().len(), 1, "spawn records ownership");

        assert_eq!(
            child.shutdown(Duration::from_secs(2)),
            ShutdownOutcome::Confirmed
        );
        assert!(!process_alive(pid));
        assert!(
            reg.read().unwrap().is_empty(),
            "a confirmed kill clears the record"
        );
    }

    /// `kill_escalate`'s first `try_wait` already sees an exited child, so an
    /// already-exited child shuts down Confirmed — and its record clears.
    #[test]
    fn supervised_shutdown_of_an_already_exited_child_is_confirmed() {
        let dir = tempfile::tempdir().unwrap();
        let reg = ChildRegistry::new(dir.path().to_path_buf());
        let mut cmd = Command::new("sleep");
        cmd.arg("0");
        let mut child = SupervisedChild::spawn_deferred(&reg, "sleep 0", &mut cmd).unwrap();
        let _ = child.child().wait(); // exited AND reaped before shutdown
        assert!(
            reg.read().unwrap().is_empty(),
            "deferred spawn records nothing"
        );
        child.register();

        assert_eq!(
            child.shutdown(Duration::from_secs(2)),
            ShutdownOutcome::Confirmed
        );
        assert!(reg.read().unwrap().is_empty());
    }

    /// §12 record-keeping, unit-tested at its own seam: no honest
    /// short-lived process can be made to survive SIGKILL, so each outcome
    /// is mapped onto a registered / deferred child directly instead of
    /// faking the kill itself.
    #[test]
    fn unconfirmed_shutdown_keeps_or_creates_the_ownership_record() {
        let dir = tempfile::tempdir().unwrap();
        let reg = ChildRegistry::new(dir.path().to_path_buf());

        // Registered + Unconfirmed → the record survives.
        let mut cmd = Command::new("sleep");
        cmd.arg("0");
        let mut registered = SupervisedChild::spawn(&reg, "sleep 0", &mut cmd).unwrap();
        registered.settle_registry(ShutdownOutcome::Unconfirmed);
        assert_eq!(reg.read().unwrap().len(), 1);

        // Never registered + Unconfirmed → the record is CREATED: an
        // unconfirmable corpse still owns its port / audio device, and the
        // next start must retry the cleanup.
        let mut cmd = Command::new("sleep");
        cmd.arg("0");
        let mut deferred = SupervisedChild::spawn_deferred(&reg, "sleep 0", &mut cmd).unwrap();
        deferred.settle_registry(ShutdownOutcome::Unconfirmed);
        assert_eq!(reg.read().unwrap().len(), 2);

        // Never registered + Confirmed → still no record (nothing to clear).
        let mut cmd = Command::new("sleep");
        cmd.arg("0");
        let mut clean = SupervisedChild::spawn_deferred(&reg, "sleep 0", &mut cmd).unwrap();
        clean.settle_registry(ShutdownOutcome::Confirmed);
        assert_eq!(reg.read().unwrap().len(), 2);

        let _ = registered.child().wait();
        let _ = deferred.child().wait();
        let _ = clean.child().wait();
    }

    /// §12 pid-based escalation for a foreign process the App holds no Child
    /// handle of (the port-release shape). Spawned detached — re-parented to
    /// launchd — so this test truly owns no handle, and the killed orphan is
    /// reaped by init rather than zombified under the test (a forgotten
    /// direct child would zombie, and `kill -0` would keep reporting it
    /// alive, lying about the outcome).
    #[test]
    fn terminate_pid_escalate_kills_a_process_without_a_handle() {
        let out = Command::new("/bin/sh")
            .args(["-c", "sleep 41 >/dev/null 2>&1 & echo $!"])
            .output()
            .unwrap();
        let pid: u32 = String::from_utf8_lossy(&out.stdout).trim().parse().unwrap();
        assert!(terminate_pid_escalate(pid, ORPHAN_GRACE_WINDOW));
        assert!(!process_alive(pid));
    }
}
