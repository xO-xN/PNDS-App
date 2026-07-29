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

use crate::project::children::{self, ChildRegistry};
use crate::project::manifest::{load_manifest, Manifest};
use crate::project::preflight;

/// Health polling cadence and overall startup timeout (§8.1 step 5).
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(500);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(30);
/// Per-request timeout for each health GET.
const HEALTH_REQUEST_TIMEOUT: Duration = Duration::from_millis(800);
/// Number of node stdout/stderr lines kept for error reports (§10.3).
const OUTPUT_TAIL_LINES: usize = 50;

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
    /// Master volume percent (§6.4; new sessions always start at 80).
    pub volume: f32,
    /// §10.3 five-stage loading animation dot (1–5).
    pub startup_stage: u8,
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

// ============================================================================
// Session manager
// ============================================================================

struct SessionInner {
    status: String, // idle | starting | ready | error | stopping
    child: Option<Child>,
    /// scsynth process and its OSC port (internal mode only, §6.2).
    scsynth: Option<Child>,
    scsynth_port: Option<u16>,
    /// Whether the App Master Synth has been created (§6.4).
    master_synth_ready: bool,
    project_name: Option<String>,
    project_path: Option<String>,
    audio_mode: Option<String>,
    lan_ip: Option<String>,
    osc_target: Option<String>,
    health: Option<HealthPayload>,
    error: Option<String>,
    output_tail: VecDeque<String>,
    /// Master volume percent; every new session starts at 80 (§6.4).
    volume: f32,
    /// §10.3 five-stage loading progression (1–5).
    startup_stage: u8,
    /// Incremented on every start/stop so stale supervisor threads exit.
    generation: u64,
    /// §11: per-session log file.
    logger: Option<crate::project::logs::SessionLogger>,
}

impl Default for SessionInner {
    fn default() -> Self {
        Self {
            status: "idle".to_string(),
            child: None,
            scsynth: None,
            scsynth_port: None,
            master_synth_ready: false,
            project_name: None,
            project_path: None,
            audio_mode: None,
            lan_ip: None,
            osc_target: None,
            health: None,
            error: None,
            output_tail: VecDeque::new(),
            volume: crate::project::audio::DEFAULT_VOLUME_PERCENT,
            startup_stage: 0,
            generation: 0,
            logger: None,
        }
    }
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
            volume: self.volume,
            startup_stage: self.startup_stage,
        }
    }

    fn reset_run_state(&mut self) {
        self.child = None;
        self.scsynth = None;
        self.scsynth_port = None;
        self.master_synth_ready = false;
        self.project_name = None;
        self.project_path = None;
        self.audio_mode = None;
        self.lan_ip = None;
        self.osc_target = None;
        self.health = None;
        self.error = None;
        self.output_tail.clear();
        self.volume = crate::project::audio::DEFAULT_VOLUME_PERCENT;
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
                volume: crate::project::audio::DEFAULT_VOLUME_PERCENT,
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

    fn emit<R: tauri::Runtime>(&self, app: &AppHandle<R>) {
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
        osc_target: Option<String>,
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
        let registry = ChildRegistry::new(app_data_dir.clone());
        preflight::check_ports_available(
            manifest.score_server.performer_port,
            manifest.score_server.monitor_port,
        )?;

        // §6.5: the output device comes from app-local preferences (never
        // from the project manifest). A missing saved device falls back to
        // the system default with a warning.
        let device = if mode == "internal" {
            let prefs = crate::commands::preferences::load_preferences_sync(&app)?;
            match prefs.output_device {
                Some(name) => {
                    let devices = crate::project::audio::list_output_devices()
                        .unwrap_or_default()
                        .devices;
                    if devices.contains(&name) {
                        Some(name)
                    } else {
                        log::warn!(
                            "Saved output device \"{name}\" is not available; falling back to the system default (§6.5)"
                        );
                        None
                    }
                }
                None => None,
            }
        } else {
            None
        };

        // §11: open the per-session log file.
        let session_log = crate::project::logs::SessionLogger::open(
            &app_data_dir,
            crate::project::logs::SessionLogParams {
                project_id: &manifest.id,
                project_name: &manifest.name,
                project_path: &path,
                audio_mode: &mode,
                lan_ip: &lan_ip,
                osc_target: osc_target.as_deref().unwrap_or("none"),
                output_device: device.as_deref().unwrap_or("system default"),
            },
        )
        .ok();

        // §8.1: internal mode boots scsynth first (and waits for /status)
        // before the score server starts. External/none skip this entirely.
        let (osc_target, scsynth_child, scsynth_port) = match mode.as_str() {
            "internal" => {
                let sc_cfg = manifest
                    .audio
                    .scsynth
                    .as_ref()
                    .ok_or("manifest is missing audio.scsynth (required for internal mode)")?;
                // CoreAudio driver init can fail transiently (device still
                // held by a previous run); retry once before giving up.
                let mut last_err = String::new();
                let mut booted = None;
                for attempt in 1..=2 {
                    match Self::boot_scsynth(&app_data_dir, sc_cfg, device.as_deref()) {
                        Ok(ok) => {
                            booted = Some(ok);
                            break;
                        }
                        Err(e) => {
                            last_err = e;
                            log::warn!("scsynth boot attempt {attempt} failed: {last_err}");
                        }
                    }
                }
                let Some((sc_child, port)) = booted else {
                    return Err(last_err);
                };
                (
                    Some(format!("127.0.0.1:{port}")),
                    Some(sc_child),
                    Some(port),
                )
            }
            "external" => {
                // §6.6: external mode requires a valid user-provided target.
                let target =
                    osc_target.ok_or("External mode requires an OSC target (host:port)")?;
                crate::project::audio::validate_osc_target(&target)?;
                (Some(target), None, None)
            }
            _ => (None, None, None),
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

        registry.record(pid, entry.to_string_lossy().to_string());
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
            inner.logger = session_log;
            inner.generation
        };
        self.emit(&app);

        // Pipe node stdout/stderr into the session tail (§10.3 details).
        if let Some(stdout) = child.stdout.take() {
            self.spawn_output_reader(stdout, "node");
        }
        if let Some(stderr) = child.stderr.take() {
            self.spawn_output_reader(stderr, "node");
        }

        {
            let mut inner = self.lock();
            inner.child = Some(child);
            if let Some(mut sc) = scsynth_child {
                if let Some(stdout) = sc.stdout.take() {
                    self.spawn_output_reader(stdout, "scsynth");
                }
                if let Some(stderr) = sc.stderr.take() {
                    self.spawn_output_reader(stderr, "scsynth");
                }
                inner.scsynth_port = scsynth_port;
                inner.scsynth = Some(sc);
            }
        }

        self.spawn_supervisor(app, app_data_dir, pid, manifest, generation);
        Ok(())
    }

    fn spawn_output_reader<R: std::io::Read + Send + 'static>(&self, reader: R, tag: &'static str) {
        let inner = Arc::clone(&self.inner);
        std::thread::spawn(move || {
            for line in BufReader::new(reader).lines() {
                match line {
                    Ok(line) => {
                        log::debug!("[{tag}] {line}");
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
                    Self::teardown_children(&inner, &app_data_dir);
                    Self::emit_static(&app, &inner);
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
                                let sc_port = guard.scsynth_port;
                                let volume = guard.volume;
                                drop(guard);

                                // §8.1 step 7 (internal): the master synth goes
                                // after the project group (§6.4). Without it the
                                // private bus reaches nothing — fail loudly.
                                if let Some(port) = sc_port {
                                    if let Err(e) = Self::create_master_stage(port, volume) {
                                        let mut guard =
                                            inner.lock().unwrap_or_else(|e| e.into_inner());
                                        guard.status = "error".to_string();
                                        guard.error =
                                            Some(format!("Audio master stage failed: {e}"));
                                        drop(guard);
                                        Self::teardown_children(&inner, &app_data_dir);
                                        Self::emit_static(&app, &inner);
                                        return;
                                    }
                                    let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
                                    guard.master_synth_ready = true;
                                    drop(guard);
                                }

                                Self::emit_static(&app, &inner);
                                Self::watch_running(&app, &inner, &app_data_dir, pid, generation);
                                return;
                            }
                            "error" => {
                                guard.status = "error".to_string();
                                guard.error = Some(health_error_message(&health));
                                drop(guard);
                                Self::teardown_children(&inner, &app_data_dir);
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
                            drop(guard);
                            Self::teardown_children(&inner, &app_data_dir);
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
                ChildRegistry::new(app_data_dir.to_path_buf()).clear(pid);
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

    /// Boots scsynth on a fresh dynamic UDP port and waits for /status
    /// (§6.2, §8.1 step 2). On failure the child is killed before returning.
    fn boot_scsynth(
        app_data_dir: &Path,
        sc_cfg: &crate::project::manifest::ScsynthConfig,
        device: Option<&str>,
    ) -> Result<(Child, u16), String> {
        let port = allocate_udp_port()?;
        let binary = crate::project::audio::scsynth_binary_path()?;
        let plugins = crate::project::audio::plugins_dir()?;
        let mut child =
            crate::project::audio::spawn_scsynth(&binary, sc_cfg, port, &plugins, device)?;
        let pid = child.id();

        let client = crate::project::audio::OscClient::connect(&format!("127.0.0.1:{port}"))?;
        if let Err(e) = crate::project::audio::wait_for_scsynth(&client, &mut child) {
            children::kill_escalate(&mut child, pid, children::SHUTDOWN_GRACE_WINDOW);
            return Err(e);
        }
        ChildRegistry::new(app_data_dir.to_path_buf())
            .record(pid, "scsynth-aarch64-apple-darwin".to_string());
        log::info!(
            "scsynth ready on UDP port {port} (pid {pid}, device: {})",
            device.unwrap_or("system default")
        );
        Ok((child, port))
    }

    /// §8.1 step 7 (internal): create the App Master Synth at the tail of
    /// the root group, applying the session's current volume (§6.4).
    fn create_master_stage(port: u16, volume_percent: f32) -> Result<(), String> {
        let client = crate::project::audio::OscClient::connect(&format!("127.0.0.1:{port}"))?;
        let synthdef = crate::project::audio::master_synthdef_path()?;
        crate::project::audio::create_master_synth(
            &client,
            &synthdef,
            crate::project::audio::volume_percent_to_gain(volume_percent),
        )
    }

    /// Stops the node score server and scsynth (§8.2): node SIGTERM with a
    /// grace window, master synth release, scsynth quit. Both are removed
    /// from the session-children record afterwards.
    fn teardown_children(inner: &Arc<Mutex<SessionInner>>, app_data_dir: &Path) {
        let registry = ChildRegistry::new(app_data_dir.to_path_buf());
        let (node_child, node_pid, sc_child, sc_pid, sc_port, master_ready, mut logger_opt) = {
            let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            let node_pid = guard.child.as_ref().map(|c| c.id());
            let sc_pid = guard.scsynth.as_ref().map(|c| c.id());
            (
                guard.child.take(),
                node_pid,
                guard.scsynth.take(),
                sc_pid,
                guard.scsynth_port,
                guard.master_synth_ready,
                guard.logger.take(),
            )
        };
        if let Some(ref mut log) = logger_opt {
            log.write_line("Session ending — stopping processes");
        }

        if let Some(mut c) = node_child {
            children::kill_escalate(
                &mut c,
                node_pid.unwrap_or(0),
                children::SHUTDOWN_GRACE_WINDOW,
            );
            registry.clear(node_pid.unwrap_or(0));
            log::info!("Score server stopped (pid {})", node_pid.unwrap_or(0));
        }

        if let Some(mut sc) = sc_child {
            if let Some(port) = sc_port {
                if let Ok(client) =
                    crate::project::audio::OscClient::connect(&format!("127.0.0.1:{port}"))
                {
                    crate::project::audio::quit_scsynth(&client, master_ready);
                }
            }
            children::kill_escalate(
                &mut sc,
                sc_pid.unwrap_or(0),
                children::SHUTDOWN_GRACE_WINDOW,
            );
            registry.clear(sc_pid.unwrap_or(0));
            log::info!("scsynth stopped (pid {})", sc_pid.unwrap_or(0));
        }

        if let Some(ref mut log) = logger_opt {
            log.write_line("All processes stopped");
            log.close();
        }
    }

    /// §8.2 stop sequence. Idempotent.
    ///
    /// NOTE: never call `emit` while holding the inner lock — `emit` takes a
    /// snapshot, which locks again (std Mutex is not reentrant → deadlock).
    pub fn stop<R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
        app_data_dir: &Path,
    ) -> Result<(), String> {
        {
            let mut inner = self.lock();
            inner.generation += 1;
            if inner.child.is_none() && inner.scsynth.is_none() {
                inner.reset_run_state();
                inner.status = "idle".to_string();
            } else {
                inner.status = "stopping".to_string();
                // Clear mode/ip so the frontend's ??-guard preserves the
                // user's pending selection across the stop barrier.
                inner.audio_mode = None;
                inner.lan_ip = None;
            }
        }
        self.emit(app);

        let inner = Arc::clone(&self.inner);
        Self::teardown_children(&inner, app_data_dir);

        {
            let mut guard = self.lock();
            guard.reset_run_state();
            guard.status = "idle".to_string();
        }
        self.emit(app);
        Ok(())
    }

    /// §6.4: set the master volume (percent 0-100, dB-linear). Applied live
    /// via OSC when an internal session is running.
    pub fn set_master_volume<R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
        percent: f32,
    ) -> Result<(), String> {
        let percent = percent.clamp(0.0, 100.0);
        let (port, apply) = {
            let mut inner = self.lock();
            inner.volume = percent;
            (
                inner.scsynth_port,
                inner.status == "ready" && inner.master_synth_ready,
            )
        };
        if apply {
            if let Some(port) = port {
                let client =
                    crate::project::audio::OscClient::connect(&format!("127.0.0.1:{port}"))?;
                crate::project::audio::set_master_gain(
                    &client,
                    crate::project::audio::volume_percent_to_gain(percent),
                )?;
            }
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
        children::kill_escalate(&mut child, pid, Duration::from_secs(2));
        assert!(child.try_wait().unwrap().is_some());
    }

    /// Regression: stop() with no running child deadlocked before (emit was
    /// called while holding the inner lock).
    #[test]
    fn stop_without_child_returns_ok() {
        let app = tauri::test::mock_app().handle().clone();
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();
        manager.stop(&app, dir.path()).unwrap();
        assert_eq!(manager.snapshot().status, "idle");
        // Idempotent: a second stop is fine too.
        manager.stop(&app, dir.path()).unwrap();
    }

    #[test]
    fn stop_with_child_terminates_and_resets() {
        let app = tauri::test::mock_app().handle().clone();
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();

        let child = Command::new("sleep").arg("30").spawn().unwrap();
        let pid = child.id();
        {
            let mut inner = manager.lock();
            inner.child = Some(child);
            inner.status = "ready".to_string();
        }
        assert!(manager.has_active_session());

        manager.stop(&app, dir.path()).unwrap();

        assert!(!manager.has_active_session());
        assert_eq!(manager.snapshot().status, "idle");
        let alive = Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        assert!(!alive);
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
        children::kill_escalate(&mut child, pid, Duration::from_secs(2));
        assert!(child.try_wait().unwrap().is_some());
    }
}
