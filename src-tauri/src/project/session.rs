//! Project session: score-server (Node.js) process lifecycle and health
//! polling. See `docs/zh-CN/reference/runtime-contract.md` §3–§12; App-side
//! session behavior in `docs/developer/app-behavior.md` (状态与 Session).
//!
//! Startup order (runtime-contract §8): preflight → (internal: resolve
//! channel plan and boot scsynth) → spawn node → poll health → ready
//! (internal: master stage). Shutdown (§12): SIGTERM → graceful wait →
//! SIGKILL on timeout.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{HashSet, VecDeque};
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

/// Health polling cadence and overall startup timeout (§8).
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(500);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(30);
/// Per-request timeout for each health GET.
const HEALTH_REQUEST_TIMEOUT: Duration = Duration::from_millis(800);
/// Number of node stdout/stderr lines kept for error reports (the
/// error-page technical tail, app-behavior「Error Page」).
const OUTPUT_TAIL_LINES: usize = 50;
/// Delay before the FIRST scsynth boot attempt when the audio subsystem
/// was NOT prewarmed at launch (cold coreaudiod). The one-time
/// AVAudioSession init can crash (objc cache corruption in the HAL XPC
/// path) when the daemon is still settling; the grace period avoids the
/// common "first load always retries" case. When the launch-time prewarm
/// succeeded, this shrinks to PREWARMED_FIRST_BOOT_DELAY.
const FIRST_BOOT_DELAY: Duration = Duration::from_millis(1500);
const PREWARMED_FIRST_BOOT_DELAY: Duration = Duration::from_millis(300);
/// Issue #93: settle time between the children being reaped and the session
/// log closing, so the output readers can drain the pipes' last buffered
/// lines — losing those final lines is exactly what made past teardown
/// stalls undiagnosable.
const OUTPUT_DRAIN_SETTLE: Duration = Duration::from_millis(100);

// ============================================================================
// Types shared with the frontend
// ============================================================================

/// Runtime-contract §5 health payload. Only the contract fields are modeled; the App must
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
    /// `starting | ready | error | disabled` (disabled = none mode, §9)
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
    /// Master volume percent (§7.5; new N<=2 sessions always start at 80,
    /// N>2 sessions are fixed at 100).
    pub volume: f32,
    /// Five-stage loading animation dot (1–5); app-behavior「Loading」.
    pub startup_stage: u8,
    /// §7.1: internal channel plan (N/H/K/B), present for internal sessions.
    pub channel_plan: Option<crate::project::audio::ChannelPlan>,
    /// Final CoreAudio output device in use (internal sessions).
    pub output_device: Option<String>,
}

// ============================================================================
// Pure / testable helpers
// ============================================================================

/// Locates the bundled Node.js sidecar. V1 is Apple Silicon only.
pub fn node_binary_path() -> Result<PathBuf, String> {
    const TRIPLE: &str = "aarch64-apple-darwin";
    let name = format!("node-{TRIPLE}");

    // 1. Next to the executable (bundled app; also dev when the CLI copies it).
    // Tauri strips the `-{target-triple}` suffix from `externalBin` sidecars
    // when placing them next to the executable, so the file is just `node`.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("node");
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }
    // 2. Development fallback: src-tauri/binaries (compile-time source dir,
    // raw fetched sidecar still named with the target-triple suffix)
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(&name);
    if dev.exists() {
        return Ok(dev);
    }
    Err("Embedded Node.js runtime not found.\nRun `npm run node:fetch` and try again.".to_string())
}

/// What to start (v1.3.2, issue #77): the conceptual inputs of one
/// score-server start as a single record, instead of positional
/// parameters widening through the layers (command → `start` →
/// `start_generation` → `build_score_server_env`). The command boundary
/// constructs it once; v1.4.0's hub variables (spec #57) will land as
/// fields here without widening a single downstream signature.
///
/// The first four fields are the user's intent. The resolved fields fill
/// in along the way — `start_generation` performs internal mode's audio
/// resolution and settles the OSC target actually injected — so the env
/// construction reads everything from this one record.
pub struct StartRequest {
    /// Score project root directory.
    pub path: String,
    /// Requested audio mode; must be manifest-supported.
    pub mode: String,
    /// The user-selected LAN IPv4 (§4) — becomes `PNDS_HOST_IP`.
    pub lan_ip: String,
    /// User OSC target (§9); required for external mode. Internal mode
    /// ignores it and allocates the dynamic loopback target.
    pub osc_target: Option<String>,
    /// Resolved during start (internal only, §7.1): the N/H/K/B plan.
    pub channel_plan: Option<crate::project::audio::ChannelPlan>,
    /// Resolved during start (internal only): the CoreAudio device the
    /// session actually runs on.
    pub output_device: Option<String>,
    /// Resolved during start: the OSC target actually injected —
    /// internal's dynamic loopback, external's validated user target.
    pub resolved_osc_target: Option<String>,
}

impl StartRequest {
    /// The command boundary's constructor: intent only, the resolved
    /// fields start empty and fill in during `start_generation`.
    pub fn new(path: String, mode: String, lan_ip: String, osc_target: Option<String>) -> Self {
        Self {
            path,
            mode,
            lan_ip,
            osc_target,
            channel_plan: None,
            output_device: None,
            resolved_osc_target: None,
        }
    }
}

/// Environment variables injected into the score server (§3, §6, §7),
/// read from the start record (issue #77). `none` mode receives only
/// `PNDS_HOST_IP`. Internal receives the dynamic OSC target plus the
/// session channel plan: `PNDS_AUDIO_OUTPUT_BUS = B` (private bus
/// start) and `PNDS_AUDIO_OUTPUT_CHANNELS = N` (declared project
/// outputs) — never a hardcoded stereo pair.
pub fn build_score_server_env(request: &StartRequest) -> Vec<(String, String)> {
    let mut env = vec![("PNDS_HOST_IP".to_string(), request.lan_ip.clone())];
    match request.mode.as_str() {
        "internal" => {
            env.push((
                "PNDS_OSC_TARGET".to_string(),
                request
                    .resolved_osc_target
                    .as_deref()
                    .expect("internal mode requires the resolved OSC target")
                    .to_string(),
            ));
            let plan = request
                .channel_plan
                .as_ref()
                .expect("internal mode requires the resolved channel plan");
            env.push((
                "PNDS_AUDIO_OUTPUT_BUS".to_string(),
                plan.private_bus_start.to_string(),
            ));
            env.push((
                "PNDS_AUDIO_OUTPUT_CHANNELS".to_string(),
                plan.project_channels.to_string(),
            ));
        }
        "external" => {
            env.push((
                "PNDS_OSC_TARGET".to_string(),
                request
                    .resolved_osc_target
                    .as_deref()
                    .expect("external mode requires the validated OSC target")
                    .to_string(),
            ));
        }
        _ => {}
    }
    env
}

/// Allocates a free local UDP port for scsynth (§7.2). The port is released
/// immediately; scsynth binds it at session start.
pub fn allocate_udp_port() -> Result<u16, String> {
    let socket = UdpSocket::bind(("127.0.0.1", 0))
        .map_err(|e| format!("Failed to allocate a local UDP port: {e}"))?;
    socket
        .local_addr()
        .map(|a| a.port())
        .map_err(|e| format!("Failed to read allocated UDP port: {e}"))
}

/// Enumerates usable LAN IPv4 addresses (§4). Loopback is never offered.
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
    /// scsynth process and its OSC port (internal mode only, §7).
    scsynth: Option<Child>,
    scsynth_port: Option<u16>,
    /// Whether the App Master Synth has been created (§7.4).
    master_synth_ready: bool,
    project_name: Option<String>,
    project_path: Option<String>,
    audio_mode: Option<String>,
    lan_ip: Option<String>,
    osc_target: Option<String>,
    health: Option<HealthPayload>,
    error: Option<String>,
    output_tail: VecDeque<String>,
    /// Master volume percent; every new session starts at 80 (§7.5).
    volume: f32,
    /// app-behavior「Loading」: five-stage progression (1–5).
    startup_stage: u8,
    /// §7.1: internal channel plan (N/H/K/B) for the running session.
    channel_plan: Option<crate::project::audio::ChannelPlan>,
    /// Final output device name for the running internal session.
    output_device: Option<String>,
    /// Incremented on every start/stop so stale supervisor threads exit.
    generation: u64,
    /// §12: per-session log file.
    logger: Option<crate::project::logs::SessionLogger>,
    /// Issue #93: the generation whose children the open logger belongs to.
    /// Output readers persist only while this matches their generation —
    /// through their own session's teardown (the shutdown diagnostics this
    /// log exists for) but never into a newer session's log.
    logger_generation: Option<u64>,
    /// App-Nap prevention held while the session is live (see
    /// process_activity.rs); refreshed on every state publication.
    process_activity: Option<crate::process_activity::ProcessActivity>,
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
            channel_plan: None,
            output_device: None,
            generation: 0,
            logger: None,
            logger_generation: None,
            process_activity: None,
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
            channel_plan: self.channel_plan.clone(),
            output_device: self.output_device.clone(),
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
        self.channel_plan = None;
        self.output_device = None;
        self.startup_stage = 0;
    }
}

/// Tauri-managed session state. One running project at a time (app-behavior「状态与 Session」).
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

    /// Publishes the current snapshot — the `emit` funnel, opened up for
    /// the window-focus regain path (see lib.rs): coming back from
    /// another desktop, the webview's JS was suspended and its queued
    /// `pnds:session` events lag the backend; this pushes the truth.
    pub fn publish<R: tauri::Runtime>(&self, app: &AppHandle<R>) {
        self.emit(app)
    }

    fn emit<R: tauri::Runtime>(&self, app: &AppHandle<R>) {
        let snapshot = {
            let mut inner = self.lock();
            // App-Nap prevention rides the same funnel every state
            // publication passes through: hold an activity while the
            // session is live, release it once idle/error settles.
            let live = matches!(inner.status.as_str(), "starting" | "ready" | "stopping");
            if live && inner.process_activity.is_none() {
                inner.process_activity = Some(crate::process_activity::ProcessActivity::begin(
                    "PNDS live score session",
                ));
            } else if !live {
                inner.process_activity = None;
            }
            inner.snapshot()
        };
        if let Err(e) = app.emit("pnds:session", snapshot) {
            log::warn!("Failed to emit session snapshot: {e}");
        }
    }

    /// Starts a score-server session (§8). Validation (manifest, ports)
    /// is re-run here so a stale preflight result cannot start a process.
    ///
    /// §12: this is also the **Retry** entry point — no stop is required
    /// first. The generation is bumped and the previous run's
    /// error/health/output is cleared before anything else, so a retry
    /// always begins from a clean `starting` snapshot. Every failure below
    /// funnels through `fail_start`, which tears down whatever this
    /// generation already spawned *before* the `error` snapshot is
    /// published — the next Retry never inherits a live Node or scsynth.
    pub fn start<R: tauri::Runtime>(
        &self,
        app: AppHandle<R>,
        app_data_dir: PathBuf,
        request: StartRequest,
    ) -> Result<(), String> {
        let generation = {
            let mut inner = self.lock();
            inner.generation += 1;
            inner.reset_run_state();
            inner.status = "starting".to_string();
            inner.project_path = Some(request.path.clone());
            inner.audio_mode = Some(request.mode.clone());
            inner.lan_ip = Some(request.lan_ip.clone());
            inner.startup_stage = 1;
            inner.generation
        };
        self.emit(&app);

        let result = self.start_generation(&app, &app_data_dir, generation, request);
        if let Err(message) = &result {
            self.fail_start(&app, &app_data_dir, generation, message);
        }
        result
    }

    /// The body of `start` for one generation. Never called directly:
    /// `start` owns the `starting` snapshot and the failure teardown.
    /// Takes the start record by value and enriches it along the way
    /// (internal mode's audio resolution, the settled OSC target).
    fn start_generation<R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
        app_data_dir: &Path,
        generation: u64,
        mut request: StartRequest,
    ) -> Result<(), String> {
        let root = PathBuf::from(&request.path);
        let manifest = load_manifest(&root)?;

        if !manifest.audio.supported_modes.contains(&request.mode) {
            return Err(format!(
                "Audio mode \"{}\" is not supported by this project (supported: {})",
                request.mode,
                manifest.audio.supported_modes.join(", ")
            ));
        }
        if request.lan_ip.parse::<std::net::Ipv4Addr>().is_err()
            || request.lan_ip.starts_with("127.")
        {
            return Err(format!("Invalid LAN IPv4 address: \"{}\"", request.lan_ip));
        }
        {
            let mut inner = self.lock();
            inner.project_name = Some(manifest.name.clone());
        }

        let registry = ChildRegistry::new(app_data_dir.to_path_buf());
        // §12: a previous generation whose SIGKILL was never confirmed
        // still owns its ports. Re-run the targeted (pid + marker) cleanup
        // BEFORE the port preflight, so a Retry after a hard failure is
        // not blocked by the corpse of its own last attempt.
        //
        // Nothing is exempt: `start` already dropped this manager's child
        // handles, so a corpse from an unconfirmed kill must still read as
        // a conflict here — it is not the live session's process anymore.
        match registry.cleanup_orphans(&HashSet::new()) {
            Ok(n) if n > 0 => log::info!("Start cleanup terminated {n} orphan(s) before preflight"),
            Ok(_) => {}
            Err(e) => log::warn!("Orphan cleanup before start failed: {e}"),
        }
        preflight::check_ports_available(
            manifest.score_server.performer_port,
            manifest.score_server.monitor_port,
            &HashSet::new(),
        )?;

        // §7.1/§7.6: for internal sessions resolve the output device and
        // its capability at the effective sample rate, then compute
        // N/H/K/B. Unreadable capability or H = 0 fails before anything is
        // spawned; a channel-poor device (H < N) is bridged partially,
        // never an error.
        let (device, effective_sc_cfg) = if request.mode == "internal" {
            let sc_cfg = manifest
                .audio
                .scsynth
                .as_ref()
                .ok_or("manifest is missing audio.scsynth (required for internal mode)")?;
            // The output device comes from app-local preferences (app-behavior「音频 Host 行为」)
            // (never the manifest). A missing saved device falls back to
            // the system default with a warning.
            let prefs = crate::commands::preferences::load_preferences_sync(app)?;
            // Issue #20: the App's global sample-rate preference is the
            // sole audio authority — device enumeration and the scsynth
            // boot below both use this config; a legacy manifest rate is
            // never read for boot.
            let sc_cfg = crate::project::audio::with_effective_sample_rate(sc_cfg, &prefs);
            let caps = crate::project::audio::list_output_devices(sc_cfg.sample_rate)?;
            let device = match prefs.output_device {
                Some(name) => {
                    if caps.devices.iter().any(|d| d.name == name) {
                        Some(name)
                    } else {
                        log::warn!(
                            "Saved output device \"{name}\" is not available; falling back to the system default"
                        );
                        None
                    }
                }
                None => None,
            };
            let cap = crate::project::audio::resolve_in_list(&caps, device.as_deref())?;
            let plan =
                crate::project::audio::channel_plan(manifest.audio.output_channels, cap.channels);
            log::info!(
                "Audio channel plan: N={} H={} K={} B={} (device: {})",
                plan.project_channels,
                plan.device_channels,
                plan.bridged_channels,
                plan.private_bus_start,
                cap.name
            );
            request.channel_plan = Some(plan);
            request.output_device = Some(cap.name);
            (device, Some(sc_cfg))
        } else {
            (None, None)
        };

        if let Some(plan) = &request.channel_plan {
            let mut inner = self.lock();
            inner.channel_plan = Some(plan.clone());
            inner.output_device = request.output_device.clone();
            // §7.5: multichannel masters are fixed at 100% / 0 dB.
            if plan.project_channels > 2 {
                inner.volume = 100.0;
            }
        }

        // §12: open the per-session log file. The session owns it from
        // here on, so `teardown_children` closes it on a failed start too.
        let mut session_log = crate::project::logs::SessionLogger::open(
            app_data_dir,
            crate::project::logs::SessionLogParams {
                project_id: &manifest.id,
                project_name: &manifest.name,
                project_path: &request.path,
                audio_mode: &request.mode,
                lan_ip: &request.lan_ip,
                osc_target: request.osc_target.as_deref().unwrap_or("none"),
                output_device: request.output_device.as_deref().unwrap_or("system default"),
            },
        )
        .ok();
        if let (Some(log), Some(plan), Some(device_name)) = (
            &mut session_log,
            &request.channel_plan,
            &request.output_device,
        ) {
            log.write_line(&format!(
                "Audio channel plan: N={} H={} K={} B={} device=\"{device_name}\"",
                plan.project_channels,
                plan.device_channels,
                plan.bridged_channels,
                plan.private_bus_start
            ));
        }
        // Issue #20: record the authority the session runs at — the App's
        // global setting (or its 48000 fallback), not the manifest rate.
        if let (Some(log), Some(sc_cfg)) = (&mut session_log, &effective_sc_cfg) {
            log.write_line(&format!(
                "Sample rate: {} Hz (App global setting)",
                sc_cfg.sample_rate
            ));
        }
        {
            let mut inner = self.lock();
            inner.logger = session_log;
            // Issue #93: the log belongs to this generation's children —
            // their output readers key off this to persist.
            inner.logger_generation = Some(generation);
        }

        // §8: internal mode boots scsynth first (and waits for /status)
        // before the score server starts. External/none skip this entirely.
        request.resolved_osc_target = match request.mode.as_str() {
            "internal" => {
                // Issue #20: the config resolved above already carries the
                // App's effective sample rate; the manifest rate is never
                // re-read here.
                let sc_cfg = effective_sc_cfg
                    .as_ref()
                    .ok_or("internal mode requires a resolved scsynth config")?;
                // §7.2: scsynth opens exactly K hardware output channels.
                let k = request
                    .channel_plan
                    .as_ref()
                    .map(|plan| plan.bridged_channels)
                    .ok_or("internal mode requires a resolved channel plan")?;
                // Issue #92 (2026-08-30 field revision): the bundled scsynth
                // 3.14.1 dies probabilistically on macOS 26 — an ObjC runtime
                // corruption race killing the process by signal. ANY signal
                // death is that dice roll (the first implementation also
                // required zero output, which field measurement falsified:
                // real crashes carry the CoreAudio device list on stdout and
                // the ObjC runtime's own diagnostics on stderr, so the retry
                // never fired). Signal deaths retry transparently on a fresh
                // port while the session stays in `starting`; timeouts and
                // clean-exit failures (configuration errors) are real errors
                // and fail straight through to the error page, unmasked.
                //
                // The first attempt still waits out the cold-coreaudiod
                // grace period (§ FIRST_BOOT_DELAY); each failed attempt's
                // scsynth was already reclaimed by `boot_scsynth`'s failure
                // path before the retry spawns.
                let prewarmed = crate::project::audio::is_audio_prewarmed();
                std::thread::sleep(if prewarmed {
                    PREWARMED_FIRST_BOOT_DELAY
                } else {
                    FIRST_BOOT_DELAY
                });
                let logger_inner = Arc::clone(&self.inner);
                let (mut sc_child, port) = crate::project::audio::boot_with_transient_retries(
                    crate::project::audio::SESSION_BOOT_TRANSIENT_RETRIES,
                    crate::project::audio::TRANSIENT_RETRY_DELAY,
                    || Self::boot_scsynth(app_data_dir, sc_cfg, k, device.as_deref()),
                    |failure| Self::log_transient_retry(&logger_inner, failure),
                )
                .map_err(|failure| {
                    // The final failure's shape and the dead child's last
                    // words land in the session log before the teardown
                    // closes it — the first field diagnosis had no such
                    // record, which is how the zero-output premise went
                    // unchallenged.
                    Self::log_boot_failure(&logger_inner, &failure);
                    failure.message
                })?;
                // §12: hand the handle to the session immediately. Every
                // failure below this point is now covered by the teardown
                // in `fail_start` instead of leaking a live scsynth.
                if let Some(stdout) = sc_child.stdout.take() {
                    self.spawn_output_reader(stdout, "scsynth", generation);
                }
                if let Some(stderr) = sc_child.stderr.take() {
                    self.spawn_output_reader(stderr, "scsynth", generation);
                }
                {
                    let mut inner = self.lock();
                    inner.scsynth_port = Some(port);
                    inner.scsynth = Some(sc_child);
                    inner.startup_stage = 2;
                }
                self.emit(app);
                Some(format!("127.0.0.1:{port}"))
            }
            "external" => {
                // §9: external mode requires a valid user-provided target.
                let target = request
                    .osc_target
                    .clone()
                    .ok_or("External mode requires an OSC target (host:port)")?;
                crate::project::audio::validate_osc_target(&target)?;
                Some(target)
            }
            _ => None,
        };

        {
            let mut inner = self.lock();
            inner.osc_target = request.resolved_osc_target.clone();
        }

        let node = node_binary_path()?;
        let working_dir = root.join(&manifest.score_server.working_directory);
        let entry = root.join(&manifest.score_server.entry);
        let env = build_score_server_env(&request);

        let mut cmd = Command::new(&node);
        cmd.arg(&entry)
            .arg("--audio-mode")
            .arg(&request.mode)
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
            "Score server started (pid {pid}): {} --audio-mode {}",
            entry.display(),
            request.mode
        );

        // Pipe node stdout/stderr into the session tail (app-behavior「Error Page」).
        if let Some(stdout) = child.stdout.take() {
            self.spawn_output_reader(stdout, "node", generation);
        }
        if let Some(stderr) = child.stderr.take() {
            self.spawn_output_reader(stderr, "node", generation);
        }

        {
            let mut inner = self.lock();
            inner.child = Some(child);
            inner.startup_stage = 3;
        }
        self.emit(app);

        self.spawn_supervisor(
            app.clone(),
            app_data_dir.to_path_buf(),
            pid,
            manifest,
            generation,
        );
        Ok(())
    }

    /// §12: a synchronously failing start must leave nothing behind.
    /// Tears down whatever this generation already spawned, clears the
    /// handles, and only then publishes the `error` snapshot — so the
    /// state the user retries from is provably clean.
    fn fail_start<R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
        app_data_dir: &Path,
        generation: u64,
        message: &str,
    ) {
        let inner = Arc::clone(&self.inner);
        Self::fail_generation(app, &inner, app_data_dir, generation, message.to_string());
    }

    /// §12: the **single** failure exit for a generation, shared by the
    /// synchronous start path, the startup supervisor and the running
    /// watchdog. Order is the contract: cleanup first, `error` snapshot
    /// second. A superseded generation is a no-op — a dying old session
    /// must never overwrite the retry that replaced it.
    fn fail_generation<R: tauri::Runtime>(
        app: &AppHandle<R>,
        inner: &Arc<Mutex<SessionInner>>,
        app_data_dir: &Path,
        generation: u64,
        message: String,
    ) {
        {
            let guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            if guard.generation != generation {
                return;
            }
        }
        Self::teardown_children(inner, app_data_dir);
        {
            let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            if guard.generation != generation {
                return;
            }
            guard.status = "error".to_string();
            guard.error = Some(message);
            guard.startup_stage = 0;
        }
        Self::emit_static(app, inner);
    }

    /// Pipes one child's stdout/stderr into the in-memory output tail and,
    /// issue #93, line by line into the session log with a `[node]` /
    /// `[scsynth]` source prefix. The two sinks carry different generation
    /// guards: the log accepts a line only while it is the log of the
    /// reader's OWN generation — which stays true through that session's
    /// teardown, so the children's final shutdown lines land (the whole
    /// reason this persistence exists) — while a newer session's log can
    /// never receive an older generation's stragglers. The in-memory tail
    /// keeps the strict current-generation guard (§12): a superseded
    /// generation's late lines must not pollute the retry's error page.
    /// The handle lets tests join the reader deterministically.
    fn spawn_output_reader<R: std::io::Read + Send + 'static>(
        &self,
        reader: R,
        tag: &'static str,
        generation: u64,
    ) -> std::thread::JoinHandle<()> {
        let inner = Arc::clone(&self.inner);
        std::thread::spawn(move || {
            for line in BufReader::new(reader).lines() {
                match line {
                    Ok(line) => {
                        log::debug!("[{tag}] {line}");
                        let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
                        if guard.logger_generation == Some(generation) {
                            if let Some(log) = guard.logger.as_mut() {
                                log.write_line(&format!("[{tag}] {line}"));
                            }
                        }
                        if guard.generation != generation {
                            continue;
                        }
                        guard.output_tail.push_back(line);
                        while guard.output_tail.len() > OUTPUT_TAIL_LINES {
                            guard.output_tail.pop_front();
                        }
                    }
                    Err(_) => break,
                }
            }
        })
    }

    fn spawn_supervisor<R: tauri::Runtime>(
        &self,
        app: AppHandle<R>,
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
                    Self::fail_generation(
                        &app,
                        &inner,
                        &app_data_dir,
                        generation,
                        format!("Score server exited during startup ({status}). See output below."),
                    );
                    return;
                }

                match fetch_health(performer_port) {
                    Ok(health) => {
                        let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
                        guard.health = Some(health.clone());
                        match health.status.as_str() {
                            // §5: readiness is the payload field, not HTTP 200.
                            "ready" => {
                                drop(guard);

                                if Self::complete_startup(
                                    &app,
                                    &inner,
                                    &app_data_dir,
                                    generation,
                                    Self::create_master_stage,
                                ) {
                                    Self::watch_running(
                                        &app,
                                        &inner,
                                        &app_data_dir,
                                        pid,
                                        generation,
                                    );
                                }
                                return;
                            }
                            "error" => {
                                drop(guard);
                                Self::fail_generation(
                                    &app,
                                    &inner,
                                    &app_data_dir,
                                    generation,
                                    health_error_message(&health),
                                );
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
                            Self::fail_generation(
                                &app,
                                &inner,
                                &app_data_dir,
                                generation,
                                format!(
                                    "Timed out waiting for the project to report ready ({}s).",
                                    HEALTH_TIMEOUT.as_secs()
                                ),
                            );
                            return;
                        }
                    }
                }
            }
        });
    }

    /// §8 steps 8–10 (internal) and step 10 (none/external): finish the
    /// health→ready transition once the payload reports ready. Internal
    /// sessions must confirm the master stage BEFORE the session claims
    /// `ready`; a master-stage failure fails the whole generation (§8). For
    /// none/external sessions health ready is the final condition — there is
    /// no App-side master stage. Returns true when the session reached
    /// `ready` (the caller then continues into `watch_running`).
    ///
    /// `create_master` runs at exactly the point production performs the
    /// OSC handshake against scsynth; tests observe the session state
    /// through it to pin the ordering invariant.
    fn complete_startup<R: tauri::Runtime, F>(
        app: &AppHandle<R>,
        inner: &Arc<Mutex<SessionInner>>,
        app_data_dir: &Path,
        generation: u64,
        create_master: F,
    ) -> bool
    where
        F: FnOnce(u16, u32, u32, f32) -> Result<(), String>,
    {
        let (sc_port, volume, plan, current_generation) = {
            let guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            (
                guard.scsynth_port,
                guard.volume,
                guard.channel_plan.clone(),
                guard.generation,
            )
        };
        // §12: a stop/retry that landed while health was being polled must
        // not run the OSC handshake on a torn-down engine.
        if current_generation != generation {
            return false;
        }
        // §8 steps 8–9 (internal): the master stage runs after the project
        // group (§7.4). Without it the private buses reach nothing — fail
        // loudly. N > 2 masters are fixed at unity gain (§7.5).
        let needs_master_stage = matches!((sc_port, &plan), (Some(_), Some(_)));
        if let (Some(port), Some(plan)) = (sc_port, &plan) {
            let gain = if plan.project_channels > 2 {
                1.0
            } else {
                crate::project::audio::volume_percent_to_gain(volume)
            };
            if let Err(e) = create_master(port, plan.bridged_channels, plan.private_bus_start, gain)
            {
                Self::fail_generation(
                    app,
                    inner,
                    app_data_dir,
                    generation,
                    format!("Audio master stage failed: {e}"),
                );
                return false;
            }
        }
        let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
        if guard.generation != generation || guard.status != "starting" {
            return false; // a retry already replaced this generation
        }
        if needs_master_stage {
            guard.master_synth_ready = true;
        }
        guard.status = "ready".to_string();
        guard.startup_stage = 4;
        drop(guard);
        Self::emit_static(app, inner);
        true
    }

    /// After ready: watch for unexpected exits until stop is requested.
    fn watch_running<R: tauri::Runtime>(
        app: &AppHandle<R>,
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
                drop(guard);
                log::warn!("Score server (pid {pid}) exited unexpectedly: {status}");
                // §12: the failed generation must not leave the audio
                // engine behind — node/scsynth stop before the error
                // snapshot is emitted, so Retry starts clean.
                Self::fail_generation(
                    app,
                    inner,
                    app_data_dir,
                    generation,
                    format!("Score server exited unexpectedly ({status})."),
                );
                return;
            }
        }
    }

    fn emit_static<R: tauri::Runtime>(app: &AppHandle<R>, inner: &Arc<Mutex<SessionInner>>) {
        let snapshot = {
            let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            // The supervisor funnel refreshes the App-Nap activity too —
            // error transitions land here without passing through emit.
            let live = matches!(guard.status.as_str(), "starting" | "ready" | "stopping");
            if live && guard.process_activity.is_none() {
                guard.process_activity = Some(crate::process_activity::ProcessActivity::begin(
                    "PNDS live score session",
                ));
            } else if !live {
                guard.process_activity = None;
            }
            guard.snapshot()
        };
        if let Err(e) = app.emit("pnds:session", snapshot) {
            log::warn!("Failed to emit session snapshot: {e}");
        }
    }

    /// Issue #92: the transparent auto-retry's audit trail — the App log
    /// and the per-session log both record every transient crash. The crash
    /// rate these lines capture is the evidence base for the future
    /// scsynth binary upgrade decision.
    fn log_transient_retry(
        inner: &Arc<Mutex<SessionInner>>,
        failure: &crate::project::audio::BootFailure,
    ) {
        log::warn!(
            "scsynth transient startup crash ({}); auto-retrying",
            failure.describe()
        );
        let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(log) = guard.logger.as_mut() {
            log.write_line(&format!(
                "scsynth transient startup crash ({}); auto-retrying",
                failure.describe()
            ));
        }
    }

    /// Issue #92 (2026-08-30 revision): the FINAL boot failure — after the
    /// retries are spent or on a non-transient shape — leaves its shape and
    /// the dead child's last output lines in the session log. A failed
    /// boot's output never reaches the error page (the output readers attach
    /// only after a successful boot), so without this line the only
    /// machine-readable trace of what a crashed scsynth said was nothing.
    fn log_boot_failure(
        inner: &Arc<Mutex<SessionInner>>,
        failure: &crate::project::audio::BootFailure,
    ) {
        log::warn!("scsynth boot failed ({})", failure.describe());
        let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(log) = guard.logger.as_mut() {
            log.write_line(&format!("scsynth boot failed ({})", failure.describe()));
            for line in &failure.output_tail {
                log.write_line(&format!("  | {line}"));
            }
        }
    }

    /// Boots scsynth on a fresh dynamic UDP port with K hardware output
    /// channels (§7.2) and waits for /status (§8 step 4). On failure the
    /// attempt is classified for the transient-crash gate (issue #92) and
    /// the child is killed before returning; an unconfirmed kill keeps its
    /// registry record so the next start's targeted cleanup can free the
    /// audio device.
    fn boot_scsynth(
        app_data_dir: &Path,
        sc_cfg: &crate::project::manifest::ScsynthConfig,
        k: u32,
        device: Option<&str>,
    ) -> Result<(Child, u16), crate::project::audio::BootFailure> {
        let port = allocate_udp_port().map_err(crate::project::audio::BootFailure::other)?;
        let binary = crate::project::audio::scsynth_binary_path()
            .map_err(crate::project::audio::BootFailure::other)?;
        let plugins = crate::project::audio::plugins_dir()
            .map_err(crate::project::audio::BootFailure::other)?;
        let mut child =
            crate::project::audio::spawn_scsynth(&binary, sc_cfg, k, port, &plugins, device)
                .map_err(crate::project::audio::BootFailure::other)?;
        let pid = child.id();

        let wait = match crate::project::audio::OscClient::connect(&format!("127.0.0.1:{port}")) {
            Ok(client) => crate::project::audio::wait_for_scsynth(&client, &mut child),
            Err(e) => Err(crate::project::audio::BootWaitFailure::Osc(e)),
        };
        if let Err(wait_failure) = wait {
            let failure = crate::project::audio::classify_boot_failure(&wait_failure, &mut child);
            if !children::kill_escalate(&mut child, pid, children::SCSYNTH_SHUTDOWN_GRACE_WINDOW) {
                // §12: record the unconfirmed kill so the next start's
                // targeted orphan cleanup frees the audio device.
                ChildRegistry::new(app_data_dir.to_path_buf())
                    .record(pid, "scsynth-aarch64-apple-darwin".to_string());
            }
            return Err(failure);
        }
        ChildRegistry::new(app_data_dir.to_path_buf())
            .record(pid, "scsynth-aarch64-apple-darwin".to_string());
        log::info!(
            "scsynth ready on UDP port {port} (pid {pid}, device: {})",
            device.unwrap_or("system default")
        );
        Ok((child, port))
    }

    /// §8 steps 8–9 (internal): create the App master group with K mono
    /// instances bridging private bus B+i to hardware bus i (§7.4).
    fn create_master_stage(port: u16, k: u32, b: u32, gain: f32) -> Result<(), String> {
        let client = crate::project::audio::OscClient::connect(&format!("127.0.0.1:{port}"))?;
        let synthdef = crate::project::audio::master_synthdef_path()?;
        crate::project::audio::create_master_stage(&client, &synthdef, k, b, gain)
    }

    /// Stops the node score server and scsynth (§12): node SIGTERM with a
    /// grace window, master synth release, scsynth quit. Handles are always
    /// cleared, so the session is provably child-free afterwards (§12).
    ///
    /// Issue #93: the two children have separate grace windows — the score
    /// server is bounded at 2s (healthy projects exit in 0.01–0.2s; a
    /// SIGTERM-ignoring server must not stretch the StopCover), scsynth
    /// keeps 5s for CoreAudio teardown. Order stays node-then-scsynth: the
    /// project's graceful shutdown needs scsynth alive to release its
    /// synths (parallelizing was evaluated and rejected).
    ///
    /// The session log stays open THROUGH the teardown (closed at the very
    /// end): the children's final output lines — the shutdown diagnostics
    /// this log exists for (issue #93) — land between the two markers below.
    ///
    /// The session-children record is only cleared for a **confirmed** kill;
    /// an unconfirmed one keeps its ownership record so the next start
    /// re-runs the targeted orphan cleanup before its port preflight.
    fn teardown_children(inner: &Arc<Mutex<SessionInner>>, app_data_dir: &Path) {
        let registry = ChildRegistry::new(app_data_dir.to_path_buf());
        let (node_child, node_pid, sc_child, sc_pid, sc_port, master_ready, log_generation) = {
            let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            let node_pid = guard.child.as_ref().map(|c| c.id());
            let sc_pid = guard.scsynth.as_ref().map(|c| c.id());
            (
                guard.child.take(),
                node_pid,
                guard.scsynth.take(),
                sc_pid,
                guard.scsynth_port.take(),
                std::mem::take(&mut guard.master_synth_ready),
                // Issue #93: teardown may only touch the log of the session
                // it is tearing down. A start() that interleaves during the
                // kill windows installs the NEXT session's log — every write
                // and the close below are gated on this captured generation
                // so a dying generation's teardown can never close a newer
                // session's log.
                guard.logger_generation,
            )
        };
        let had_children = node_child.is_some() || sc_child.is_some();
        Self::write_session_log_line(inner, log_generation, "Session ending — stopping processes");

        if let Some(mut c) = node_child {
            let pid = node_pid.unwrap_or(0);
            Self::stop_child_and_log(
                inner,
                &registry,
                &mut c,
                pid,
                children::SCORE_SERVER_SHUTDOWN_GRACE_WINDOW,
                "Score server",
                log_generation,
            );
        }

        if let Some(mut sc) = sc_child {
            let pid = sc_pid.unwrap_or(0);
            if let Some(port) = sc_port {
                if let Ok(client) =
                    crate::project::audio::OscClient::connect(&format!("127.0.0.1:{port}"))
                {
                    crate::project::audio::quit_scsynth(&client, master_ready);
                }
            }
            Self::stop_child_and_log(
                inner,
                &registry,
                &mut sc,
                pid,
                children::SCSYNTH_SHUTDOWN_GRACE_WINDOW,
                "scsynth",
                log_generation,
            );
        }

        // Issue #93: the children are reaped by now; give their output
        // readers a short settle so the pipes' last buffered lines land
        // before the log closes, then write the end marker and close. The
        // close stays generation-gated: if a newer session's log replaced
        // this one mid-teardown, leave that log strictly alone (the
        // superseded log then simply ends without its footer).
        if had_children {
            std::thread::sleep(OUTPUT_DRAIN_SETTLE);
        }
        {
            let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            if guard.logger_generation == log_generation {
                if let Some(ref mut log) = guard.logger {
                    log.write_line("All processes stopped");
                    log.close();
                }
                guard.logger = None;
                guard.logger_generation = None;
            }
        }
    }

    /// Issue #93: kills one child through the §12 escalation and mirrors
    /// the outcome into both the App log and the session log (gated on
    /// `log_generation` so a concurrent newer session's log is never
    /// touched). The session-children record is only cleared for a
    /// **confirmed** kill; an unconfirmed one keeps its ownership record so
    /// the next start re-runs the targeted orphan cleanup.
    #[allow(clippy::too_many_arguments)]
    fn stop_child_and_log(
        inner: &Arc<Mutex<SessionInner>>,
        registry: &ChildRegistry,
        child: &mut Child,
        pid: u32,
        window: std::time::Duration,
        label: &str,
        log_generation: Option<u64>,
    ) {
        let line = if children::kill_escalate(child, pid, window) {
            registry.clear(pid);
            log::info!("{label} stopped (pid {pid})");
            format!("{label} stopped (pid {pid})")
        } else {
            log::warn!(
                "{label} (pid {pid}) could not be confirmed dead; keeping its ownership record for the next start"
            );
            format!(
                "{label} (pid {pid}) could not be confirmed dead; keeping its ownership record for the next start"
            )
        };
        Self::write_session_log_line(inner, log_generation, &line);
    }

    /// Issue #93: appends one line to the session log, but only while that
    /// log still belongs to `log_generation` — teardown's own markers and
    /// stop outcomes go through here while the log is still open, and a
    /// newer session's log is never written to.
    fn write_session_log_line(
        inner: &Arc<Mutex<SessionInner>>,
        log_generation: Option<u64>,
        line: &str,
    ) {
        let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
        if guard.logger_generation == log_generation {
            if let Some(log) = guard.logger.as_mut() {
                log.write_line(line);
            }
        }
    }

    /// §12 stop sequence. Idempotent.
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

    /// §7.5: set the master volume (percent 0-100, dB-linear). Applied live
    /// via OSC when an internal session is running. For N > 2 projects the
    /// master is fixed at 100% / 0 dB: 100 is a successful no-op, anything
    /// else is a diagnosable error.
    pub fn set_master_volume<R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
        percent: f32,
    ) -> Result<(), String> {
        let percent = percent.clamp(0.0, 100.0);
        {
            let inner = self.lock();
            if let Some(plan) = &inner.channel_plan {
                if plan.project_channels > 2 {
                    if (percent - 100.0).abs() > f32::EPSILON {
                        return Err(format!(
                            "Master volume is fixed at 100% (0 dB) for {}-channel projects; adjust the monitoring level downstream",
                            plan.project_channels
                        ));
                    }
                    return Ok(());
                }
            }
        }
        let (port, apply) = {
            let mut inner = self.lock();
            inner.volume = percent;
            // §8 step 10: master_synth_ready flips in the same critical
            // section as `ready`, so this single flag is the live-audio gate
            // (none/external sessions never set it).
            (inner.scsynth_port, inner.master_synth_ready)
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

    /// PIDs of the child processes this manager currently owns handles for
    /// (node score server + scsynth). Empty when no session is live; empties
    /// as teardown reaps each child. Preflight passes these to the orphan
    /// cleanup and the port check so that checking project B never harms the
    /// running project A (v1.2.3, issue #37).
    pub fn active_child_pids(&self) -> HashSet<u32> {
        let inner = self.lock();
        let mut pids = HashSet::new();
        if let Some(pid) = inner.child.as_ref().map(|c| c.id()) {
            pids.insert(pid);
        }
        if let Some(pid) = inner.scsynth.as_ref().map(|c| c.id()) {
            pids.insert(pid);
        }
        pids
    }
}

/// Builds a readable error line from a health payload in `error` status (§5).
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
    fn env_internal_injects_osc_bus_and_channels() {
        let mut request = StartRequest::new(
            "/p".to_string(),
            "internal".to_string(),
            "192.168.1.10".to_string(),
            None,
        );
        request.resolved_osc_target = Some("127.0.0.1:49328".to_string());
        // A 16ch project fully bridged: B = K = 16, N = 16 — never fixed 2.
        request.channel_plan = Some(crate::project::audio::channel_plan(16, 16));
        let env = build_score_server_env(&request);
        let get = |k: &str| {
            env.iter()
                .find(|(key, _)| key == k)
                .map(|(_, v)| v.as_str())
        };
        assert_eq!(get("PNDS_OSC_TARGET"), Some("127.0.0.1:49328"));
        assert_eq!(get("PNDS_AUDIO_OUTPUT_BUS"), Some("16"));
        assert_eq!(get("PNDS_AUDIO_OUTPUT_CHANNELS"), Some("16"));
        assert_eq!(get("PNDS_HOST_IP"), Some("192.168.1.10"));
        // Channel-poor bridge: 16ch project on a 2ch device → B = K = 2, N = 16.
        request.channel_plan = Some(crate::project::audio::channel_plan(16, 2));
        let env = build_score_server_env(&request);
        let get = |k: &str| {
            env.iter()
                .find(|(key, _)| key == k)
                .map(|(_, v)| v.as_str())
        };
        assert_eq!(get("PNDS_AUDIO_OUTPUT_BUS"), Some("2"));
        assert_eq!(get("PNDS_AUDIO_OUTPUT_CHANNELS"), Some("16"));
    }

    #[test]
    fn env_external_injects_target_only() {
        let mut request = StartRequest::new(
            "/p".to_string(),
            "external".to_string(),
            "192.168.1.10".to_string(),
            Some("127.0.0.1:3333".to_string()),
        );
        request.resolved_osc_target = Some("127.0.0.1:3333".to_string());
        let env = build_score_server_env(&request);
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
        let request = StartRequest::new(
            "/p".to_string(),
            "none".to_string(),
            "192.168.1.10".to_string(),
            None,
        );
        let env = build_score_server_env(&request);
        assert_eq!(env.len(), 1);
        assert_eq!(env[0].0, "PNDS_HOST_IP");
    }

    #[test]
    fn multichannel_volume_is_fixed_at_unity() {
        let app = tauri::test::mock_app().handle().clone();
        let manager = SessionManager::default();
        {
            let mut inner = manager.lock();
            inner.channel_plan = Some(crate::project::audio::channel_plan(16, 16));
            inner.volume = 100.0;
        }
        // Non-100 is a diagnosable error.
        let err = manager.set_master_volume(&app, 50.0).unwrap_err();
        assert!(err.contains("fixed at 100%"), "unexpected: {err}");
        assert!(err.contains("16"), "unexpected: {err}");
        // 100 is a successful no-op.
        manager.set_master_volume(&app, 100.0).unwrap();
        assert_eq!(manager.snapshot().volume, 100.0);
    }

    #[test]
    fn stereo_volume_updates_normally() {
        let app = tauri::test::mock_app().handle().clone();
        let manager = SessionManager::default();
        {
            let mut inner = manager.lock();
            inner.channel_plan = Some(crate::project::audio::channel_plan(2, 2));
        }
        manager.set_master_volume(&app, 40.0).unwrap();
        assert_eq!(manager.snapshot().volume, 40.0);
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
        assert!(children::kill_escalate(
            &mut child,
            pid,
            Duration::from_secs(2)
        ));
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

    /// v1.2.3 (issue #37): the manager exposes exactly the pids it owns
    /// handles for, so preflight can exempt the live session's children
    /// (node + scsynth) from orphan cleanup and port conflicts. The set
    /// empties once stop() has reaped the children.
    #[test]
    fn active_child_pids_track_owned_children_until_stop() {
        let app = tauri::test::mock_app().handle().clone();
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();
        assert!(manager.active_child_pids().is_empty());

        let node = Command::new("sleep").arg("30").spawn().unwrap();
        let scsynth = Command::new("sleep").arg("31").spawn().unwrap();
        let expected: HashSet<u32> = [node.id(), scsynth.id()].into_iter().collect();
        {
            let mut inner = manager.lock();
            inner.child = Some(node);
            inner.scsynth = Some(scsynth);
            inner.status = "ready".to_string();
        }
        assert_eq!(manager.active_child_pids(), expected);

        manager.stop(&app, dir.path()).unwrap();
        assert!(manager.active_child_pids().is_empty());
    }

    /// §12: an error-state session has NO lingering children — the failed
    /// generation was torn down before the error snapshot. Retry starts
    /// from a clean slate.
    #[test]
    fn teardown_clears_children_for_retry() {
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();

        let child = Command::new("sleep").arg("30").spawn().unwrap();
        let pid = child.id();
        {
            let mut inner = manager.lock();
            inner.child = Some(child);
            inner.status = "error".to_string();
        }

        // Simulate the supervisor's failure path: teardown, then the
        // error snapshot.
        let inner = std::sync::Arc::clone(&manager.inner);
        SessionManager::teardown_children(&inner, dir.path());

        let snapshot = manager.snapshot();
        assert_eq!(snapshot.status, "error");
        assert!(!manager.has_active_session());
        let alive = Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        assert!(!alive, "teardown must kill the lingering node");
    }

    /// §12: every asynchronous failure (health timeout, health `error`,
    /// master-stage failure, early Node/scsynth exit) funnels through
    /// `fail_generation`. Its contract: children are gone and the handles
    /// are cleared BEFORE the `error` snapshot becomes observable.
    #[test]
    fn fail_generation_cleans_up_before_publishing_error() {
        let app = tauri::test::mock_app().handle().clone();
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();

        let node = Command::new("sleep").arg("30").spawn().unwrap();
        let scsynth = Command::new("sleep").arg("30").spawn().unwrap();
        let (node_pid, sc_pid) = (node.id(), scsynth.id());
        let generation = {
            let mut inner = manager.lock();
            inner.generation += 1;
            inner.child = Some(node);
            inner.scsynth = Some(scsynth);
            inner.scsynth_port = Some(57110);
            inner.status = "starting".to_string();
            inner.startup_stage = 3;
            inner.generation
        };

        let inner = std::sync::Arc::clone(&manager.inner);
        SessionManager::fail_generation(
            &app,
            &inner,
            dir.path(),
            generation,
            "Timed out waiting for the project to report ready (30s).".to_string(),
        );

        let snapshot = manager.snapshot();
        assert_eq!(snapshot.status, "error");
        assert_eq!(
            snapshot.error.as_deref(),
            Some("Timed out waiting for the project to report ready (30s).")
        );
        assert_eq!(snapshot.startup_stage, 0);
        assert!(!manager.has_active_session());
        {
            let guard = manager.lock();
            assert!(guard.scsynth.is_none(), "scsynth handle must be cleared");
            assert!(guard.scsynth_port.is_none(), "scsynth port must be cleared");
        }
        for pid in [node_pid, sc_pid] {
            let alive = Command::new("/bin/kill")
                .args(["-0", &pid.to_string()])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            assert!(!alive, "pid {pid} must be gone before the error snapshot");
        }
    }

    /// #23 / §8 step 10 regression: `ready` must be claimed only AFTER the
    /// master stage is confirmed. The closure observes the session state at
    /// exactly the point production performs the OSC handshake — with the
    /// pre-fix ordering (status flipped on health ready) it would observe
    /// "ready" while the audio chain is not yet built.
    #[test]
    fn ready_is_claimed_only_after_the_master_stage_confirms() {
        let app = tauri::test::mock_app().handle().clone();
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();
        let generation = {
            let mut inner = manager.lock();
            inner.generation += 1;
            inner.status = "starting".to_string();
            inner.startup_stage = 3;
            inner.scsynth_port = Some(57110);
            inner.channel_plan = Some(crate::project::audio::channel_plan(2, 2));
            inner.generation
        };

        let inner = std::sync::Arc::clone(&manager.inner);
        let observed = std::sync::Mutex::new(String::new());
        let reached_ready = SessionManager::complete_startup(
            &app,
            &inner,
            dir.path(),
            generation,
            |_port, _k, _b, _gain| {
                *observed.lock().unwrap() = manager.lock().status.clone();
                Ok(())
            },
        );

        assert!(reached_ready);
        assert_eq!(
            *observed.lock().unwrap(),
            "starting",
            "the session must still be `starting` while the master stage is being confirmed"
        );
        let guard = manager.lock();
        assert_eq!(guard.status, "ready");
        assert_eq!(guard.startup_stage, 4);
        assert!(guard.master_synth_ready);
    }

    /// §8: a master-stage failure fails the whole generation — from
    /// `starting`, never leaving a phantom ready state behind.
    #[test]
    fn master_stage_failure_fails_the_generation_instead_of_ready() {
        let app = tauri::test::mock_app().handle().clone();
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();
        let generation = {
            let mut inner = manager.lock();
            inner.generation += 1;
            inner.status = "starting".to_string();
            inner.startup_stage = 3;
            inner.scsynth_port = Some(57110);
            inner.channel_plan = Some(crate::project::audio::channel_plan(2, 2));
            inner.generation
        };

        let inner = std::sync::Arc::clone(&manager.inner);
        let reached_ready = SessionManager::complete_startup(
            &app,
            &inner,
            dir.path(),
            generation,
            |_port, _k, _b, _gain| Err("synthdef load timed out".to_string()),
        );

        assert!(!reached_ready);
        let snapshot = manager.snapshot();
        assert_eq!(snapshot.status, "error");
        assert_eq!(
            snapshot.error.as_deref(),
            Some("Audio master stage failed: synthdef load timed out")
        );
        assert_eq!(snapshot.startup_stage, 0);
        assert!(!manager.lock().master_synth_ready);
    }

    /// None mode has no App-side master stage (§9): health ready is the
    /// final condition, and the session must never claim master readiness.
    #[test]
    fn none_mode_ready_needs_no_master_stage() {
        let app = tauri::test::mock_app().handle().clone();
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();
        let generation = {
            let mut inner = manager.lock();
            inner.generation += 1;
            inner.status = "starting".to_string();
            inner.startup_stage = 3;
            inner.generation
        };

        let inner = std::sync::Arc::clone(&manager.inner);
        let reached_ready = SessionManager::complete_startup(
            &app,
            &inner,
            dir.path(),
            generation,
            |_port, _k, _b, _gain| panic!("none mode must not touch scsynth"),
        );

        assert!(reached_ready);
        let snapshot = manager.snapshot();
        assert_eq!(snapshot.status, "ready");
        assert_eq!(snapshot.startup_stage, 4);
        assert!(!manager.lock().master_synth_ready);
    }

    /// §12: a dying old generation must never overwrite the retry that
    /// replaced it — the late failure is dropped, not published.
    #[test]
    fn stale_generation_failure_does_not_touch_the_new_session() {
        let app = tauri::test::mock_app().handle().clone();
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();

        let stale_generation = {
            let mut inner = manager.lock();
            inner.generation = 7;
            inner.generation
        };
        // A Retry bumped the generation; the new session is already starting.
        {
            let mut inner = manager.lock();
            inner.generation = 8;
            inner.status = "starting".to_string();
            inner.startup_stage = 2;
        }

        let inner = std::sync::Arc::clone(&manager.inner);
        SessionManager::fail_generation(
            &app,
            &inner,
            dir.path(),
            stale_generation,
            "stale supervisor error".to_string(),
        );

        let snapshot = manager.snapshot();
        assert_eq!(snapshot.status, "starting");
        assert_eq!(snapshot.error, None);
        assert_eq!(snapshot.startup_stage, 2);
    }

    /// §12: `start` opens a new generation before it does any work — the
    /// previous run's error/health/output tail never bleeds into the retry,
    /// and the very first snapshot the UI sees is `starting` at stage 1.
    #[test]
    fn start_failure_opens_a_clean_generation_then_reports_the_new_error() {
        let app = tauri::test::mock_app().handle().clone();
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();

        {
            let mut inner = manager.lock();
            inner.status = "error".to_string();
            inner.error = Some("Port 6868 is already in use".to_string());
            inner.health = Some(HealthPayload {
                status: "error".to_string(),
                project_id: None,
                audio_mode: None,
                audio: None,
                score_server: None,
            });
            inner
                .output_tail
                .push_back("stale line from the failed run".into());
        }
        let before = manager.lock().generation;

        // Missing project directory: fails inside start_generation, i.e.
        // after the `starting` snapshot was already published.
        let err = manager
            .start(
                app,
                dir.path().to_path_buf(),
                StartRequest::new(
                    dir.path().join("missing").to_string_lossy().to_string(),
                    "none".to_string(),
                    "192.168.1.10".to_string(),
                    None,
                ),
            )
            .unwrap_err();

        assert!(
            manager.lock().generation > before,
            "generation must advance"
        );
        let snapshot = manager.snapshot();
        assert_eq!(snapshot.status, "error");
        assert_eq!(snapshot.error.as_deref(), Some(err.as_str()));
        assert_ne!(
            snapshot.error.as_deref(),
            Some("Port 6868 is already in use"),
            "the retry must surface its own error, not the previous one"
        );
        assert!(snapshot.health.is_none(), "stale health must be cleared");
        assert!(
            snapshot.output_tail.is_empty(),
            "stale output must be cleared"
        );
        assert!(!manager.has_active_session());
    }

    /// Opens a fixture session log in `dir` and returns it with its file
    /// path (the fresh tempdir holds exactly one log file).
    fn open_session_log(dir: &Path) -> (crate::project::logs::SessionLogger, PathBuf) {
        let logger = crate::project::logs::SessionLogger::open(
            dir,
            crate::project::logs::SessionLogParams {
                project_id: "fixture",
                project_name: "fixture",
                project_path: "/p",
                audio_mode: "internal",
                lan_ip: "192.168.1.10",
                osc_target: "none",
                output_device: "fixture",
            },
        )
        .unwrap();
        let log_path = std::fs::read_dir(dir.join("session-logs"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        (logger, log_path)
    }

    /// Issue #92: the transparent scsynth auto-retry leaves its audit trail
    /// in the per-session log — the crash-rate record the future scsynth
    /// binary upgrade decision will be judged from.
    #[test]
    fn transient_retry_is_written_to_the_session_log() {
        use std::os::unix::process::ExitStatusExt;
        use std::process::ExitStatus;

        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();
        let (logger, log_path) = open_session_log(dir.path());
        {
            let mut inner = manager.lock();
            inner.logger = Some(logger);
        }
        let failure = crate::project::audio::BootFailure {
            message: "Audio engine exited during startup (signal: 5 (SIGTRAP)). See output below."
                .to_string(),
            exit: Some(ExitStatus::from_raw(5)),
            output_lines: 0,
            output_tail: Vec::new(),
        };

        let inner = std::sync::Arc::clone(&manager.inner);
        SessionManager::log_transient_retry(&inner, &failure);

        manager.lock().logger.as_mut().unwrap().close();
        let content = std::fs::read_to_string(&log_path).unwrap();
        assert!(
            content.contains(
                "scsynth transient startup crash (signal 5, 0 output lines); auto-retrying"
            ),
            "session log must record the retry: {content}"
        );
    }

    /// Issue #92 (2026-08-30 revision): the FINAL boot failure leaves its
    /// shape and the dead child's last words in the session log — the
    /// record whose absence let the zero-output premise go unchallenged
    /// through the first field diagnosis.
    #[test]
    fn final_boot_failure_is_logged_with_the_dead_childs_last_words() {
        use std::os::unix::process::ExitStatusExt;
        use std::process::ExitStatus;

        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();
        let (logger, log_path) = open_session_log(dir.path());
        {
            let mut inner = manager.lock();
            inner.logger = Some(logger);
        }
        let failure = crate::project::audio::BootFailure {
            message: "Audio engine exited during startup (signal: 6 (SIGABRT)). See output below."
                .to_string(),
            exit: Some(ExitStatus::from_raw(6)),
            output_lines: 24,
            output_tail: vec![
                "Number of Devices: 12".to_string(),
                "objc[94757]: bad weak table".to_string(),
            ],
        };

        let inner = std::sync::Arc::clone(&manager.inner);
        SessionManager::log_boot_failure(&inner, &failure);

        manager.lock().logger.as_mut().unwrap().close();
        let content = std::fs::read_to_string(&log_path).unwrap();
        assert!(
            content.contains("scsynth boot failed (signal 6, 24 output lines)"),
            "log: {content}"
        );
        assert!(
            content.contains("  | objc[94757]: bad weak table"),
            "the dead child's last words must land: {content}"
        );
    }

    /// Issue #93: node/scsynth stdout/stderr lands line by line in the
    /// session log with a source prefix — and a superseded generation's
    /// lines land in neither the log nor the in-memory tail.
    #[test]
    fn child_output_lands_in_the_session_log_with_source_prefix() {
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();
        let (logger, log_path) = open_session_log(dir.path());
        {
            let mut inner = manager.lock();
            inner.generation = 7;
            inner.logger = Some(logger);
            inner.logger_generation = Some(7);
        }

        let mut child = Command::new("/bin/sh")
            .arg("-c")
            .arg("echo one; echo two")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let reader = manager.spawn_output_reader(child.stdout.take().unwrap(), "node", 7);
        let mut stale = Command::new("/bin/sh")
            .arg("-c")
            .arg("echo stale-line")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let stale_reader = manager.spawn_output_reader(stale.stdout.take().unwrap(), "scsynth", 6);
        reader.join().unwrap();
        stale_reader.join().unwrap();
        let _ = child.wait();
        let _ = stale.wait();

        // write_line flushes per line (issue #93), so the log is readable
        // live — no close needed for the assertions.
        let content = std::fs::read_to_string(&log_path).unwrap();
        assert!(content.contains("[node] one"), "log: {content}");
        assert!(content.contains("[node] two"), "log: {content}");
        assert!(!content.contains("stale-line"), "log: {content}");
        let tail = manager.snapshot().output_tail;
        assert!(tail.iter().any(|l| l == "one"));
        assert!(
            !tail.iter().any(|l| l == "stale-line"),
            "a stale generation must not pollute the tail: {tail:?}"
        );
    }

    /// Issue #93: teardown keeps the session log open until both children
    /// are stopped — the dying session's final output lines (the shutdown
    /// diagnostics this persistence exists for) land BETWEEN the teardown
    /// markers even though the generation was already bumped, the tail
    /// never sees them, and teardown closes and clears the log at the end.
    #[test]
    fn teardown_closes_the_session_log_after_the_childrens_final_output() {
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();
        let (logger, log_path) = open_session_log(dir.path());
        {
            // Production order: the log exists before the children spawn.
            // stop() has already bumped the generation (3 → 4) at this point.
            let mut inner = manager.lock();
            inner.generation = 4;
            inner.logger = Some(logger);
            inner.logger_generation = Some(3);
        }
        // Graceful-shutdown fixture: registers its TERM trap, reports
        // ready, and only then keeps running — so the teardown SIGTERM
        // always arrives at an armed, listening process (exactly like the
        // real score server; a bare `echo` would race the signal and lose).
        let mut child = Command::new("/bin/sh")
            .arg("-c")
            .arg(
                "trap 'echo shutting-down; exit 0' TERM; echo ready; \
                 while :; do sleep 0.1; done",
            )
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let reader = manager.spawn_output_reader(child.stdout.take().unwrap(), "node", 3);
        {
            let mut inner = manager.lock();
            inner.status = "stopping".to_string();
            inner.child = Some(child);
        }
        // The fixture's ready line is already persisted output (write_line
        // flushes per line) — seeing it proves the trap is armed before the
        // teardown starts signaling.
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let content = std::fs::read_to_string(&log_path).unwrap_or_default();
            if content.contains("[node] ready") {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "graceful-shutdown fixture never became ready: {content}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }

        let inner = std::sync::Arc::clone(&manager.inner);
        SessionManager::teardown_children(&inner, dir.path());
        reader.join().unwrap();

        {
            let guard = manager.lock();
            assert!(
                guard.logger.is_none(),
                "teardown must close and clear the log"
            );
            assert_eq!(guard.logger_generation, None);
        }
        assert!(
            manager.snapshot().output_tail.is_empty(),
            "teardown-window lines must not enter the tail"
        );
        let content = std::fs::read_to_string(&log_path).unwrap();
        let position = |needle: &str| {
            content
                .find(needle)
                .unwrap_or_else(|| panic!("session log must contain {needle:?}: {content}"))
        };
        let ending = position("Session ending — stopping processes");
        let output = position("[node] shutting-down");
        let stopped = position("Score server stopped");
        let all = position("All processes stopped");
        let end = position("[session end]");
        assert!(ending < output, "log: {content}");
        assert!(output < stopped, "log: {content}");
        assert!(all < end, "log: {content}");
        assert!(stopped < all, "log: {content}");
    }

    /// Issue #93: teardown's session-log writes are gated on the log's own
    /// generation — a start() interleaving during the kill windows installs
    /// the next session's log, and the dying generation's teardown must
    /// never write into (or later close) that newer log.
    #[test]
    fn session_log_writes_are_gated_on_the_log_generation() {
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();
        let (logger, log_path) = open_session_log(dir.path());
        {
            let mut inner = manager.lock();
            inner.logger = Some(logger);
            inner.logger_generation = Some(9); // a newer session's log
        }

        let inner = std::sync::Arc::clone(&manager.inner);
        SessionManager::write_session_log_line(&inner, Some(3), "stale teardown line");
        assert!(
            manager.lock().logger.is_some(),
            "the newer session's log must stay untouched and open"
        );
        let content = std::fs::read_to_string(&log_path).unwrap();
        assert!(
            !content.contains("stale teardown line"),
            "a stale generation must not write into a newer log: {content}"
        );

        SessionManager::write_session_log_line(&inner, Some(9), "current line");
        let content = std::fs::read_to_string(&log_path).unwrap();
        assert!(
            content.contains("current line"),
            "the owning generation still writes: {content}"
        );
    }

    /// Integration: the REAL supervisor thread polling a live (stdlib) HTTP
    /// health server — none mode, so readiness needs no master stage. Pins
    /// the full §8 step 6 → step 10 transition including the ready snapshot
    /// fields, then tears the session down through the public stop path.
    #[test]
    fn supervisor_reports_ready_for_a_healthy_none_mode_session() {
        let app = tauri::test::mock_app().handle().clone();
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();

        // Minimal /__pnds/health responder (§5: readiness is the payload
        // field, not HTTP 200 — no status-line tricks needed).
        let port = {
            let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let port = listener.local_addr().unwrap().port();
            std::thread::spawn(move || {
                let body =
                    r#"{"status":"ready","projectId":"fixture","audio":{"status":"disabled"}}"#;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
                    body.len()
                );
                for conn in listener.incoming() {
                    let Ok(mut stream) = conn else { break };
                    let mut buf = [0u8; 512];
                    let _ = std::io::Read::read(&mut stream, &mut buf);
                    let _ = std::io::Write::write_all(&mut stream, response.as_bytes());
                }
            });
            port
        };

        let manifest: Manifest = serde_json::from_str(&format!(
            r#"{{
                "schemaVersion": 1,
                "id": "fixture",
                "name": "fixture",
                "version": "0.0.0",
                "scoreServer": {{
                    "entry": "fixture.js",
                    "workingDirectory": ".",
                    "performerPort": {port},
                    "monitorPort": {port}
                }},
                "audio": {{"defaultMode": "none", "supportedModes": ["none"]}}
            }}"#
        ))
        .unwrap();

        let generation = {
            let child = Command::new("sleep").arg("30").spawn().unwrap();
            let mut inner = manager.lock();
            inner.generation += 1;
            inner.status = "starting".to_string();
            inner.startup_stage = 3;
            inner.child = Some(child);
            inner.generation
        };
        let pid = {
            let guard = manager.lock();
            guard.child.as_ref().unwrap().id()
        };

        manager.spawn_supervisor(
            app.clone(),
            dir.path().to_path_buf(),
            pid,
            manifest,
            generation,
        );

        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let status = manager.lock().status.clone();
            if status == "ready" {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "supervisor never reached ready (status: {status})"
            );
            std::thread::sleep(Duration::from_millis(100));
        }
        {
            let guard = manager.lock();
            assert_eq!(guard.startup_stage, 4);
            assert!(!guard.master_synth_ready, "none mode has no master stage");
        }
        let snapshot = manager.snapshot();
        assert_eq!(snapshot.status, "ready");
        assert_eq!(snapshot.startup_stage, 4);
        assert_eq!(
            snapshot.health.as_ref().map(|h| h.status.as_str()),
            Some("ready")
        );

        manager.stop(&app, dir.path()).unwrap();
        assert_eq!(manager.snapshot().status, "idle");
        assert!(!manager.has_active_session());
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
        assert!(children::kill_escalate(
            &mut child,
            pid,
            Duration::from_secs(2)
        ));
        assert!(child.try_wait().unwrap().is_some());
    }
}
