//! Project session: score-server (Node.js) process lifecycle and health
//! polling. See `docs/PNDS_APP_REQUIREMENTS.md` §7, §8, §9.
//!
//! Startup order (§8.1): preflight → (internal: allocate OSC UDP port;
//! scsynth itself arrives in task-4) → spawn node → poll health → ready.
//! Shutdown (§8.2): SIGTERM → graceful wait → SIGKILL on timeout.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::net::UdpSocket;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::project::manifest::{load_manifest, Manifest};
use crate::project::preflight;

/// Graceful-shutdown window before SIGKILL (§8.2 step 2).
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
/// Health polling cadence and overall startup timeout (§8.1 step 5).
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(500);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(30);
/// Per-request timeout for each health GET.
const HEALTH_REQUEST_TIMEOUT: Duration = Duration::from_millis(800);
/// Number of node stdout/stderr lines kept for error reports (§10.3).
const OUTPUT_TAIL_LINES: usize = 50;
/// Default external OSC target (editable in the sidebar from task-5, §6.6).
pub const DEFAULT_EXTERNAL_TARGET: &str = "127.0.0.1:3333";

// ============================================================================
// Types shared with the frontend
// ============================================================================

/// §9.1 health payload. Only the contract fields are modeled; the App must
/// not rely on anything else.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HealthPayload {
    /// `starting | ready | error | stopping`
    pub status: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub audio_mode: Option<String>,
    #[serde(default)]
    pub audio: Option<HealthAudio>,
    #[serde(default)]
    pub score_server: Option<HealthScoreServer>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HealthAudio {
    /// `starting | ready | error | disabled` (disabled = none mode, §9.1)
    pub status: String,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HealthScoreServer {
    #[serde(default)]
    pub performer_port: Option<u16>,
    #[serde(default)]
    pub monitor_port: Option<u16>,
    #[serde(default)]
    pub error: Option<String>,
}

/// Session snapshot emitted to the frontend as the `pnds:session` event.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    /// `idle | starting | ready | error | stopping`
    pub status: String,
    pub project_name: Option<String>,
    pub project_path: Option<String>,
    pub audio_mode: Option<String>,
    pub lan_ip: Option<String>,
    pub osc_target: Option<String>,
    pub health: Option<HealthPayload>,
    pub error: Option<String>,
    pub output_tail: Vec<String>,
}

// ============================================================================
// Pure / testable helpers
// ============================================================================

/// Locates the bundled Node.js sidecar. V1 is Apple Silicon only (§2).
pub fn node_binary_path() -> Result<PathBuf, String> {
    const TRIPLE: &str = "aarch64-apple-darwin";
    let name = format!("node-{TRIPLE}");

    // 1. Next to the executable (bundled app; also dev when the CLI copies it)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(&name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }
    // 2. Development fallback: src-tauri/binaries (compile-time source dir)
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(&name);
    if dev.exists() {
        return Ok(dev);
    }
    Err("Embedded Node.js runtime not found.\nRun `npm run node:fetch` and try again.".to_string())
}

/// Environment variables injected into the score server (§6.1, §6.3, §7).
/// `none` mode receives only `PNDS_HOST_IP`.
pub fn build_score_server_env(
    mode: &str,
    lan_ip: &str,
    osc_target: Option<&str>,
    audio_output_bus: Option<u32>,
) -> Vec<(String, String)> {
    let mut env = vec![("PNDS_HOST_IP".to_string(), lan_ip.to_string())];
    match mode {
        "internal" => {
            let target = osc_target.expect("internal mode requires an OSC target");
            env.push(("PNDS_OSC_TARGET".to_string(), target.to_string()));
            env.push((
                "PNDS_AUDIO_OUTPUT_BUS".to_string(),
                audio_output_bus.unwrap_or(2).to_string(),
            ));
            env.push(("PNDS_AUDIO_OUTPUT_CHANNELS".to_string(), "2".to_string()));
        }
        "external" => {
            let target = osc_target.expect("external mode requires an OSC target");
            env.push(("PNDS_OSC_TARGET".to_string(), target.to_string()));
        }
        _ => {}
    }
    env
}

/// Allocates a free local UDP port for scsynth (§6.2). The port is released
/// immediately; scsynth (task-4) binds it at session start.
pub fn allocate_udp_port() -> Result<u16, String> {
    let socket = UdpSocket::bind(("127.0.0.1", 0))
        .map_err(|e| format!("Failed to allocate a local UDP port: {e}"))?;
    socket
        .local_addr()
        .map(|a| a.port())
        .map_err(|e| format!("Failed to read allocated UDP port: {e}"))
}

/// Enumerates usable LAN IPv4 addresses (§7). Loopback is never offered.
pub fn list_lan_addresses() -> Result<Vec<String>, String> {
    let addrs = if_addrs::get_if_addrs().map_err(|e| format!("Failed to list interfaces: {e}"))?;
    let mut ips: Vec<String> = addrs
        .into_iter()
        .filter_map(|iface| match iface.addr {
            if_addrs::IfAddr::V4(v4) if !v4.ip.is_loopback() => Some(v4.ip.to_string()),
            _ => None,
        })
        .collect();
    ips.sort();
    ips.dedup();
    Ok(ips)
}

/// One health GET against the performer port. Errors (connection refused,
/// timeout, bad JSON) all mean "not ready yet" to the polling loop.
fn fetch_health(performer_port: u16) -> Result<HealthPayload, String> {
    let url = format!("http://127.0.0.1:{performer_port}/__pnds/health");
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(HEALTH_REQUEST_TIMEOUT))
        .build()
        .into();
    let body = agent
        .get(&url)
        .call()
        .map_err(|e| format!("health request failed: {e}"))?
        .into_body()
        .read_to_string()
        .map_err(|e| format!("health read failed: {e}"))?;
    serde_json::from_str(&body).map_err(|e| format!("health payload is not valid JSON: {e}"))
}

/// §8.2 stop: SIGTERM, wait, then SIGKILL. Returns when the child is dead.
fn stop_child_gracefully(child: &mut Child, pid: u32, timeout: Duration) {
    let _ = Command::new("/bin/kill").arg(pid.to_string()).status();
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {
                if Instant::now() >= deadline {
                    log::warn!("Score server (pid {pid}) ignored SIGTERM; sending SIGKILL");
                    let _ = child.kill();
                    let _ = child.wait();
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                log::warn!("Failed to wait for score server (pid {pid}): {e}");
                let _ = child.kill();
                let _ = child.wait();
                return;
            }
        }
    }
}

// ============================================================================
// Session manager
// ============================================================================

#[derive(Default)]
struct SessionInner {
    status: String, // idle | starting | ready | error | stopping
    child: Option<Child>,
    project_name: Option<String>,
    project_path: Option<String>,
    audio_mode: Option<String>,
    lan_ip: Option<String>,
    osc_target: Option<String>,
    health: Option<HealthPayload>,
    error: Option<String>,
    output_tail: VecDeque<String>,
    /// Incremented on every start/stop so stale supervisor threads exit.
    generation: u64,
}

impl SessionInner {
    fn snapshot(&self) -> SessionSnapshot {
        SessionSnapshot {
            status: self.status.clone(),
            project_name: self.project_name.clone(),
            project_path: self.project_path.clone(),
            audio_mode: self.audio_mode.clone(),
            lan_ip: self.lan_ip.clone(),
            osc_target: self.osc_target.clone(),
            health: self.health.clone(),
            error: self.error.clone(),
            output_tail: self.output_tail.iter().cloned().collect(),
        }
    }

    fn reset_run_state(&mut self) {
        self.child = None;
        self.project_name = None;
        self.project_path = None;
        self.audio_mode = None;
        self.lan_ip = None;
        self.osc_target = None;
        self.health = None;
        self.error = None;
        self.output_tail.clear();
    }
}

/// Tauri-managed session state. One running project at a time (§8.3).
pub struct SessionManager {
    inner: Arc<Mutex<SessionInner>>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(SessionInner {
                status: "idle".to_string(),
                ..Default::default()
            })),
        }
    }
}

impl SessionManager {
    fn lock(&self) -> MutexGuard<'_, SessionInner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn snapshot(&self) -> SessionSnapshot {
        self.lock().snapshot()
    }

    fn emit(&self, app: &AppHandle) {
        let snapshot = self.snapshot();
        if let Err(e) = app.emit("pnds:session", snapshot) {
            log::warn!("Failed to emit session snapshot: {e}");
        }
    }

    /// Starts a score-server session (§8.1). Validation (manifest, ports)
    /// is re-run here so a stale preflight result cannot start a process.
    pub fn start(
        &self,
        app: AppHandle,
        app_data_dir: PathBuf,
        path: String,
        mode: String,
        lan_ip: String,
    ) -> Result<(), String> {
        let root = PathBuf::from(&path);
        let manifest = load_manifest(&root)?;

        if !manifest.audio.supported_modes.contains(&mode) {
            return Err(format!(
                "Audio mode \"{mode}\" is not supported by this project (supported: {})",
                manifest.audio.supported_modes.join(", ")
            ));
        }
        if lan_ip.parse::<std::net::Ipv4Addr>().is_err() || lan_ip.starts_with("127.") {
            return Err(format!("Invalid LAN IPv4 address: \"{lan_ip}\""));
        }
        preflight::check_ports_available(
            manifest.score_server.performer_port,
            manifest.score_server.monitor_port,
        )?;

        // OSC target per mode (§6.1). scsynth itself starts in task-4.
        let osc_target = match mode.as_str() {
            "internal" => Some(format!("127.0.0.1:{}", allocate_udp_port()?)),
            "external" => Some(DEFAULT_EXTERNAL_TARGET.to_string()),
            _ => None,
        };

        let node = node_binary_path()?;
        let working_dir = root.join(&manifest.score_server.working_directory);
        let entry = root.join(&manifest.score_server.entry);
        let env = build_score_server_env(&mode, &lan_ip, osc_target.as_deref(), Some(2));

        let mut cmd = Command::new(&node);
        cmd.arg(&entry)
            .arg("--audio-mode")
            .arg(&mode)
            .current_dir(&working_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .envs(env.iter().map(|(k, v)| (k, v)));

        let mut child = cmd.spawn().map_err(|e| {
            format!("Failed to start the score server with the embedded Node.js runtime: {e}")
        })?;
        let pid = child.id();

        if let Err(e) =
            preflight::record_session_child(&app_data_dir, pid, entry.to_string_lossy().to_string())
        {
            log::warn!("Failed to record session child: {e}");
        }
        log::info!(
            "Score server started (pid {pid}): {} --audio-mode {mode}",
            entry.display()
        );

        let generation = {
            let mut inner = self.lock();
            inner.generation += 1;
            inner.reset_run_state();
            inner.status = "starting".to_string();
            inner.project_name = Some(manifest.name.clone());
            inner.project_path = Some(path.clone());
            inner.audio_mode = Some(mode.clone());
            inner.lan_ip = Some(lan_ip.clone());
            inner.osc_target = osc_target.clone();
            inner.generation
        };
        self.emit(&app);

        // Pipe node stdout/stderr into the session tail (§10.3 details).
        if let Some(stdout) = child.stdout.take() {
            self.spawn_output_reader(stdout);
        }
        if let Some(stderr) = child.stderr.take() {
            self.spawn_output_reader(stderr);
        }

        {
            let mut inner = self.lock();
            inner.child = Some(child);
        }

        self.spawn_supervisor(app, app_data_dir, pid, manifest, generation);
        Ok(())
    }

    fn spawn_output_reader<R: std::io::Read + Send + 'static>(&self, reader: R) {
        let inner = Arc::clone(&self.inner);
        std::thread::spawn(move || {
            for line in BufReader::new(reader).lines() {
                match line {
                    Ok(line) => {
                        log::debug!("[node] {line}");
                        let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
                        guard.output_tail.push_back(line);
                        while guard.output_tail.len() > OUTPUT_TAIL_LINES {
                            guard.output_tail.pop_front();
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    fn spawn_supervisor(
        &self,
        app: AppHandle,
        app_data_dir: PathBuf,
        pid: u32,
        manifest: Manifest,
        generation: u64,
    ) {
        let inner = Arc::clone(&self.inner);
        let performer_port = manifest.score_server.performer_port;

        std::thread::spawn(move || {
            let deadline = Instant::now() + HEALTH_TIMEOUT;

            loop {
                std::thread::sleep(HEALTH_POLL_INTERVAL);

                {
                    let guard = inner.lock().unwrap_or_else(|e| e.into_inner());
                    if guard.generation != generation || guard.status != "starting" {
                        return; // stopped or replaced by a newer session
                    }
                }

                // Node died before becoming ready?
                let exited = {
                    let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
                    guard
                        .child
                        .as_mut()
                        .and_then(|c| c.try_wait().ok().flatten())
                };
                if let Some(status) = exited {
                    let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
                    guard.status = "error".to_string();
                    guard.error = Some(format!(
                        "Score server exited during startup ({status}). See output below."
                    ));
                    drop(guard);
                    Self::emit_static(&app, &inner);
                    let _ = preflight::clear_session_child(&app_data_dir, pid);
                    return;
                }

                match fetch_health(performer_port) {
                    Ok(health) => {
                        let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
                        guard.health = Some(health.clone());
                        match health.status.as_str() {
                            // §9.1: readiness is the payload field, not HTTP 200.
                            "ready" => {
                                guard.status = "ready".to_string();
                                drop(guard);
                                Self::emit_static(&app, &inner);
                                Self::watch_running(&app, &inner, &app_data_dir, pid, generation);
                                return;
                            }
                            "error" => {
                                guard.status = "error".to_string();
                                guard.error = Some(health_error_message(&health));
                                let mut child = guard.child.take();
                                drop(guard);
                                if let Some(mut c) = child.take() {
                                    stop_child_gracefully(&mut c, pid, SHUTDOWN_TIMEOUT);
                                }
                                let _ = preflight::clear_session_child(&app_data_dir, pid);
                                Self::emit_static(&app, &inner);
                                return;
                            }
                            _ => {
                                drop(guard);
                                Self::emit_static(&app, &inner);
                            }
                        }
                    }
                    Err(e) => {
                        log::debug!("health not ready yet: {e}");
                        if Instant::now() >= deadline {
                            let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
                            guard.status = "error".to_string();
                            guard.error = Some(format!(
                                "Timed out waiting for the project to report ready ({}s).",
                                HEALTH_TIMEOUT.as_secs()
                            ));
                            let mut child = guard.child.take();
                            drop(guard);
                            if let Some(mut c) = child.take() {
                                stop_child_gracefully(&mut c, pid, SHUTDOWN_TIMEOUT);
                            }
                            let _ = preflight::clear_session_child(&app_data_dir, pid);
                            Self::emit_static(&app, &inner);
                            return;
                        }
                    }
                }
            }
        });
    }

    /// After ready: watch for unexpected exits until stop is requested.
    fn watch_running(
        app: &AppHandle,
        inner: &Arc<Mutex<SessionInner>>,
        app_data_dir: &Path,
        pid: u32,
        generation: u64,
    ) {
        loop {
            std::thread::sleep(HEALTH_POLL_INTERVAL);
            let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            if guard.generation != generation || guard.status != "ready" {
                return;
            }
            let exited = guard
                .child
                .as_mut()
                .and_then(|c| c.try_wait().ok().flatten());
            if let Some(status) = exited {
                guard.status = "error".to_string();
                guard.error = Some(format!("Score server exited unexpectedly ({status})."));
                drop(guard);
                let _ = preflight::clear_session_child(app_data_dir, pid);
                Self::emit_static(app, inner);
                return;
            }
        }
    }

    fn emit_static(app: &AppHandle, inner: &Arc<Mutex<SessionInner>>) {
        let snapshot = {
            let guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            guard.snapshot()
        };
        if let Err(e) = app.emit("pnds:session", snapshot) {
            log::warn!("Failed to emit session snapshot: {e}");
        }
    }

    /// §8.2 stop sequence for the score server. Idempotent.
    pub fn stop(&self, app: &AppHandle, app_data_dir: &Path) -> Result<(), String> {
        let (child, pid) = {
            let mut inner = self.lock();
            if inner.child.is_none() {
                inner.generation += 1;
                inner.reset_run_state();
                inner.status = "idle".to_string();
                self.emit(app);
                return Ok(());
            }
            inner.generation += 1;
            inner.status = "stopping".to_string();
            let pid = inner.child.as_ref().map(|c| c.id()).unwrap_or(0);
            (inner.child.take(), pid)
        };
        self.emit(app);

        if let Some(mut c) = child {
            stop_child_gracefully(&mut c, pid, SHUTDOWN_TIMEOUT);
            let _ = preflight::clear_session_child(app_data_dir, pid);
            log::info!("Score server stopped (pid {pid})");
        }

        {
            let mut inner = self.lock();
            inner.reset_run_state();
            inner.status = "idle".to_string();
        }
        self.emit(app);
        Ok(())
    }

    /// True while a score-server child is (or should be) running.
    pub fn has_active_session(&self) -> bool {
        let inner = self.lock();
        inner.child.is_some()
    }
}

/// Builds a readable error line from a health payload in `error` status (§9.1).
fn health_error_message(health: &HealthPayload) -> String {
    let mut parts = Vec::new();
    if let Some(audio) = &health.audio {
        if let Some(err) = &audio.error {
            parts.push(format!("Audio: {err}"));
        }
    }
    if let Some(server) = &health.score_server {
        if let Some(err) = &server.error {
            parts.push(format!("Score server: {err}"));
        }
    }
    if parts.is_empty() {
        "Project reported an error during startup.".to_string()
    } else {
        parts.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_internal_injects_osc_and_bus() {
        let env =
            build_score_server_env("internal", "192.168.1.10", Some("127.0.0.1:49328"), Some(2));
        let get = |k: &str| {
            env.iter()
                .find(|(key, _)| key == k)
                .map(|(_, v)| v.as_str())
        };
        assert_eq!(get("PNDS_OSC_TARGET"), Some("127.0.0.1:49328"));
        assert_eq!(get("PNDS_AUDIO_OUTPUT_BUS"), Some("2"));
        assert_eq!(get("PNDS_AUDIO_OUTPUT_CHANNELS"), Some("2"));
        assert_eq!(get("PNDS_HOST_IP"), Some("192.168.1.10"));
    }

    #[test]
    fn env_external_injects_target_only() {
        let env = build_score_server_env("external", "192.168.1.10", Some("127.0.0.1:3333"), None);
        let get = |k: &str| {
            env.iter()
                .find(|(key, _)| key == k)
                .map(|(_, v)| v.as_str())
        };
        assert_eq!(get("PNDS_OSC_TARGET"), Some("127.0.0.1:3333"));
        assert_eq!(get("PNDS_AUDIO_OUTPUT_BUS"), None);
        assert_eq!(get("PNDS_HOST_IP"), Some("192.168.1.10"));
    }

    #[test]
    fn env_none_injects_host_only() {
        let env = build_score_server_env("none", "192.168.1.10", None, None);
        assert_eq!(env.len(), 1);
        assert_eq!(env[0].0, "PNDS_HOST_IP");
    }

    #[test]
    fn udp_port_allocation_returns_free_port() {
        let port = allocate_udp_port().unwrap();
        assert!(port > 1023);
    }

    #[test]
    fn lan_addresses_exclude_loopback() {
        let ips = list_lan_addresses().unwrap();
        assert!(ips.iter().all(|ip| !ip.starts_with("127.")));
    }

    #[test]
    fn graceful_stop_kills_child() {
        let mut child = Command::new("sleep").arg("30").spawn().unwrap();
        let pid = child.id();
        stop_child_gracefully(&mut child, pid, Duration::from_secs(2));
        assert!(child.try_wait().unwrap().is_some());
    }

    /// Integration: health polling against a real (fixture) score server.
    /// Skipped when the embedded Node runtime has not been fetched.
    #[test]
    fn health_polling_parses_ready_payload() {
        let Ok(node) = node_binary_path() else {
            eprintln!("skipping: node sidecar not fetched");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let port = {
            let l = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
            l.local_addr().unwrap().port()
        };
        std::fs::write(
            dir.path().join("fixture.js"),
            r#"
            const http = require('http');
            const port = Number(process.env.FIXTURE_PORT);
            http.createServer((req, res) => {
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({
                status: 'ready', projectId: 'fixture', audioMode: 'none',
                audio: { status: 'disabled', target: null },
                scoreServer: { performerPort: port, monitorPort: port + 1 }
              }));
            }).listen(port, '0.0.0.0');
            "#,
        )
        .unwrap();

        let mut child = Command::new(node)
            .arg(dir.path().join("fixture.js"))
            .env("FIXTURE_PORT", port.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();

        // Poll until the fixture is up (same semantics as the supervisor).
        let deadline = Instant::now() + Duration::from_secs(10);
        let health = loop {
            if let Ok(h) = fetch_health(port) {
                break h;
            }
            assert!(Instant::now() < deadline, "fixture never became ready");
            std::thread::sleep(Duration::from_millis(200));
        };
        assert_eq!(health.status, "ready");
        assert_eq!(health.audio.as_ref().unwrap().status, "disabled");

        let pid = child.id();
        stop_child_gracefully(&mut child, pid, Duration::from_secs(2));
        assert!(child.try_wait().unwrap().is_some());
    }
}
