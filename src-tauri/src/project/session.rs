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
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_specta::Event as _;

use crate::project::children::{self, ChildRegistry, ShutdownOutcome, SupervisedChild};
use crate::project::manifest::{load_manifest, Manifest};
use crate::project::preflight;
use crate::types::{AudioMode, SessionStatus};

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
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub status: SessionStatus,
    pub project_name: Option<String>,
    pub project_path: Option<String>,
    pub audio_mode: Option<AudioMode>,
    pub lan_ip: Option<String>,
    /// #62: the connection address actually injected as `PNDS_HOST_IP` —
    /// the manifest-declared performer address when present, else the
    /// selected LAN IP. The monitor origin and every shareable address
    /// derive from it; `lan_ip` stays the operator's selection fact.
    pub host_address: Option<String>,
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
    /// #130: the projection start gate (投影开演) — true once the conductor
    /// has revealed the monitor on the venue screen, false while it holds
    /// the 简介 (project README) screen. Session-level and
    /// Rust-authoritative: `reset_run_state` returns it to false on every
    /// Load/switch, and both windows plus the ⌘⏎ menu accelerator act
    /// through `SessionManager::toggle_projection_start` so neither can
    /// drift. Survives the projection window closing (the gate is a
    /// session fact, not a window fact).
    pub projection_started: bool,
    /// #140: the trusted-HTTPS entry's own state — independent from the
    /// session status because a healthy local server and a usable entry
    /// are two facts (§15). `off` for every pre-#140-shaped start
    /// (switch off, project undeclared, no session).
    pub https_entry: HttpsEntryState,
    /// #174: the performance DNS mapping's own state — a mapping the
    /// background daemon holds for THIS session, installed after the
    /// entry gateway binds and verified in-daemon before it counts.
    /// Independent from `https_entry` (DNS reachable ≠ HTTPS serving);
    /// `off` whenever no mapping was requested or the daemon is absent.
    pub dns_mapping: DnsMappingState,
}

/// #140: the entry's four states (spec: at least 关闭/准备/就绪/错误).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum HttpsEntryStatus {
    /// No entry this session — the legacy HTTP flow is in effect.
    Off,
    /// Launched and probing; the URL is already fixed and injected.
    Preparing,
    /// The local TLS/HTTP probe succeeded — the URL is served end to
    /// end. This proves the Host-side tunnel only; it never claims
    /// phones' DNS/trust (final device acceptance owns that, §15).
    Ready,
    /// Launch or runtime entry failure — `error` says which step.
    Error,
}

/// #140: the entry facts a snapshot carries (existing session snapshot
/// / typed event — no new channel).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HttpsEntryState {
    pub status: HttpsEntryStatus,
    /// The complete performer root URL fixed for this performance
    /// (`https://domain:port/`) — present from `preparing` on, so the
    /// QR (project-rendered), the menu copy items and this field all
    /// read one value.
    pub url: Option<String>,
    pub error: Option<String>,
}

impl Default for HttpsEntryState {
    fn default() -> Self {
        Self {
            status: HttpsEntryStatus::Off,
            url: None,
            error: None,
        }
    }
}

/// #174: the DNS mapping's three states. There is no `preparing`: the
/// install + in-daemon verify complete synchronously on the local
/// control socket (milliseconds), so a mapping is either live (`ready`,
/// verified) or it failed (`error`, the session itself unaffected).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum DnsMappingStatus {
    /// No mapping this session (switch off, entry off, daemon absent).
    Off,
    /// The daemon holds the mapping and its own verify resolved the
    /// domain to the session's LAN address.
    Ready,
    /// Install or verify failed — `error` says which. The performance
    /// keeps running; phones fall back to manual DNS or the router.
    Error,
}

/// #174: the mapping facts a snapshot carries (existing session
/// snapshot — no new channel).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DnsMappingState {
    pub status: DnsMappingStatus,
    pub domain: Option<String>,
    pub ip: Option<String>,
    pub error: Option<String>,
}

impl Default for DnsMappingState {
    fn default() -> Self {
        Self {
            status: DnsMappingStatus::Off,
            domain: None,
            ip: None,
            error: None,
        }
    }
}

// ============================================================================
// Pure / testable helpers
// ============================================================================

/// Locates the bundled Node.js sidecar for the architecture this App was
/// built for. Tauri strips the `-{target-triple}` suffix from `externalBin`
/// sidecars placed next to the executable, so the packaged file is just `node`.
pub fn node_binary_path() -> Result<PathBuf, String> {
    crate::project::sidecars::resolve("node", "node").ok_or_else(|| {
        "Embedded Node.js runtime not found.\nRun `npm run node:fetch` and try again.".to_string()
    })
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
    pub mode: AudioMode,
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
    /// Resolved during start (#58): the telematic hub variables injected
    /// when the manifest declares `telematic` and the App-global node
    /// config is complete. Orthogonal to the audio mode — every mode
    /// carries them or none does. `None` injects nothing, silently.
    pub hub: Option<HubInjection>,
    /// Resolved during start (#62): the manifest-declared performer
    /// address that REPLACES the value injected as `PNDS_HOST_IP` (the
    /// Project keeps reading the same variable — zero project changes).
    /// `None` (undeclared) keeps the selected LAN IP, exactly today's
    /// behavior; the snapshot's `host_address` and every URL the App
    /// derives (monitor origin, shareable addresses) follow this value.
    pub performer_address: Option<String>,
    /// Resolved during start (#140): the complete performer root URL
    /// injected as `PNDS_PERFORMER_URL` when the trusted-HTTPS entry is
    /// live for this performance (§3/§15). `None` (entry off / project
    /// undeclared / start not launched it) injects nothing — the
    /// project reads the variable's absence and stays on the HTTP flow.
    pub performer_url: Option<String>,
}

/// #58: the four telematic hub variables one start may inject (TND's
/// frozen contract): `PNDS_NODE_ID` / `PNDS_HUB_URL` / `PNDS_HUB_TOKEN` /
/// `PNDS_HUB_ROOM`. All-or-nothing by construction — the resolver only
/// produces this when the manifest declares capability and the global
/// node config is complete.
#[derive(Debug, Clone)]
pub struct HubInjection {
    pub node_id: String,
    pub url: String,
    pub token: String,
    pub room: String,
}

impl StartRequest {
    /// The command boundary's constructor: intent only, the resolved
    /// fields start empty and fill in during `start_generation`.
    pub fn new(path: String, mode: AudioMode, lan_ip: String, osc_target: Option<String>) -> Self {
        Self {
            path,
            mode,
            lan_ip,
            osc_target,
            channel_plan: None,
            output_device: None,
            resolved_osc_target: None,
            hub: None,
            performer_address: None,
            performer_url: None,
        }
    }

    /// #62: the connection address actually injected as `PNDS_HOST_IP` —
    /// the resolved performer address when declared, else the selected
    /// LAN IP (the frontend's `effectiveHostAddress` mirrors this).
    pub fn host_address(&self) -> &str {
        self.performer_address.as_deref().unwrap_or(&self.lan_ip)
    }
}

/// #58: resolves the hub injection for one start. Injects only when the
/// manifest declares `telematic: true` AND all three global node fields
/// (node name / hub URL / token) hold non-blank values — completeness
/// only, never connectivity. The room is ALWAYS derived, never
/// hand-written: `{manifest.id}_{group}` with the per-project group
/// (「Room」dropdown, 1..=3, default 1) — same work + same group = same
/// room; a different work or group is invisible to this one (ADR-0004).
pub fn resolve_hub_injection(
    manifest: &Manifest,
    prefs: &crate::types::AppPreferences,
) -> Option<HubInjection> {
    if !manifest.telematic() {
        return None;
    }
    let non_blank = |value: Option<&String>| {
        value
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    // All three present or nothing — partial config never injects.
    let node_id = non_blank(prefs.node_name.as_ref())?;
    let url = non_blank(prefs.hub_url.as_ref())?;
    let token = non_blank(prefs.hub_token.as_ref())?;
    let group = prefs.hub_rooms.get(&manifest.id).copied().unwrap_or(1);
    let id = &manifest.id;
    Some(HubInjection {
        node_id,
        url,
        token,
        room: format!("{id}_{group}"),
    })
}

/// #140: the complete performer root URL fixed at start — protocol,
/// domain and the ACTUAL port, trailing slash root. One constructor so
/// the injected env var, the snapshot field and every display read the
/// same spelling.
pub fn performer_entry_url(domain: &str, port: u16) -> String {
    format!("https://{domain}:{port}/")
}

/// #140: the bound entry between `start_gateway` and the state
/// publication — the handle plus the facts the supervisor probe needs.
struct LiveEntry {
    handle: crate::gateway::GatewayHandle,
    url: String,
    domain: String,
}

/// #140: everything a start needs to open the entry gateway — URL,
/// domain/port and the revalidated chain/key. Computed before any
/// child spawns; consumed by `start_generation`.
#[derive(Debug)]
pub struct EntryLaunch {
    pub url: String,
    pub domain: String,
    pub port: u16,
    pub chain: Vec<rustls::pki_types::CertificateDer<'static>>,
    pub key: rustls::pki_types::PrivateKeyDer<'static>,
}

/// #140: resolves whether this start opens the trusted-HTTPS entry.
///
/// Activation is operator switch × project declaration × valid
/// material: `httpsEnabled == true` AND
/// `scoreServer.supportsPerformerUrl == true` AND the stored chain/key
/// revalidates for the configured domain right now (public anchors,
/// same rules as the import). Everything else → `Ok(None)` — the
/// legacy HTTP flow, byte-identical to pre-#140.
///
/// Switch on × declaration on × configuration broken → `Err`: the
/// start itself fails with the actionable message. An adapted project
/// must never silently fall back to HTTP (spec #140); the operator
/// fixes the material or turns the switch off.
pub fn resolve_entry_launch(
    app_data: &Path,
    prefs: &crate::types::AppPreferences,
    manifest: &Manifest,
    anchors: &[webpki::types::TrustAnchor<'_>],
    now: std::time::SystemTime,
) -> Result<Option<EntryLaunch>, String> {
    if prefs.https_enabled != Some(true) {
        return Ok(None);
    }
    if manifest.score_server.supports_performer_url != Some(true) {
        return Ok(None);
    }
    let domain = prefs
        .https_domain
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .ok_or_else(|| {
            "The HTTPS entry is enabled but no domain is configured — set it in 设置 → 可信 HTTPS."
                .to_string()
        })?;
    let domain = crate::https::validate_https_domain(domain)
        .map_err(|e| format!("The HTTPS entry domain is not usable: {e}"))?;
    let port = prefs.https_port.ok_or_else(|| {
        "The HTTPS entry is enabled but no port is configured — set it in 设置 → 可信 HTTPS."
            .to_string()
    })?;
    crate::https::validate_https_port(port)
        .map_err(|e| format!("The HTTPS entry port is not usable: {e}"))?;
    let (chain, key) =
        crate::https::launch_material(app_data, &domain, anchors, now).map_err(|problem| {
            format!(
                "The HTTPS entry certificate is not launch-ready ({:?}): {}",
                problem.code, problem.detail
            )
        })?;
    Ok(Some(EntryLaunch {
        url: performer_entry_url(&domain, port),
        domain,
        port,
        chain,
        key,
    }))
}

/// #174: whether a start installs the performance DNS mapping. The
/// activation gate is the operator's service switch × the HTTPS entry
/// actually launching this start (`resolve_entry_launch` = `Ok(Some)`):
/// the mapping serves the entry's domain, so an HTTP-flow start never
/// maps. The daemon's own reachability is NOT part of this decision —
/// an absent daemon surfaces as a mapping error on the snapshot
/// (independent fact), never as a start failure.
pub fn resolve_dns_mapping(
    prefs: &crate::types::AppPreferences,
    entry_launch: Option<&EntryLaunch>,
) -> Option<String> {
    if prefs.dns_enabled != Some(true) {
        return None;
    }
    entry_launch.map(|launch| launch.domain.clone())
}

/// Environment variables injected into the score server (§3, §6, §7),
/// read from the start record (issue #77). `none` mode receives only
/// `PNDS_HOST_IP`. Internal receives the dynamic OSC target plus the
/// session channel plan: `PNDS_AUDIO_OUTPUT_BUS = B` (private bus
/// start) and `PNDS_AUDIO_OUTPUT_CHANNELS = N` (declared project
/// outputs) — never a hardcoded stereo pair.
pub fn build_score_server_env(request: &StartRequest) -> Vec<(String, String)> {
    // #62: a manifest-declared performer address replaces the injected
    // host value (the Project keeps reading the same variable); undeclared
    // falls back to the selected LAN IP — exactly today's behavior.
    let mut env = vec![(
        "PNDS_HOST_IP".to_string(),
        request.host_address().to_string(),
    )];
    match request.mode {
        AudioMode::Internal => {
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
        AudioMode::External => {
            env.push((
                "PNDS_OSC_TARGET".to_string(),
                request
                    .resolved_osc_target
                    .as_deref()
                    .expect("external mode requires the validated OSC target")
                    .to_string(),
            ));
        }
        AudioMode::None => {}
    }
    // #58: the telematic hub variables ride every mode — they address the
    // score server's outbound hub connection, not its audio graph. The
    // token travels here as its own variable, never inside the URL.
    if let Some(hub) = &request.hub {
        env.push(("PNDS_NODE_ID".to_string(), hub.node_id.clone()));
        env.push(("PNDS_HUB_URL".to_string(), hub.url.clone()));
        env.push(("PNDS_HUB_TOKEN".to_string(), hub.token.clone()));
        env.push(("PNDS_HUB_ROOM".to_string(), hub.room.clone()));
    }
    // #140 (§3/§15): the complete performer root URL — injected only
    // when the trusted-HTTPS entry is live for this performance. The
    // project's external addresses prefer it over anything derived
    // from PNDS_HOST_IP; absence = the legacy HTTP flow.
    if let Some(url) = &request.performer_url {
        env.push(("PNDS_PERFORMER_URL".to_string(), url.clone()));
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

/// Enumerates usable LAN IPv4 addresses (§4). Loopback and recognized
/// VPN tunnel interfaces cannot serve as the venue's performer address.
pub fn list_lan_addresses() -> Result<Vec<String>, String> {
    let addrs = if_addrs::get_if_addrs().map_err(|e| format!("Failed to list interfaces: {e}"))?;
    Ok(lan_addresses_from_interfaces(addrs))
}

fn lan_addresses_from_interfaces(addrs: Vec<if_addrs::Interface>) -> Vec<String> {
    let mut ips: Vec<String> = addrs
        .into_iter()
        .filter(|iface| {
            // Classify the interface, not its private IP range: a venue
            // may legitimately use 10/8 or 172.16/12. Mesl's macOS TUN
            // adapter is utun, just like other NetworkExtension VPNs.
            !["utun", "tun", "tap", "ppp", "ipsec", "wg", "tailscale"]
                .iter()
                .any(|prefix| iface.name.starts_with(prefix))
        })
        .filter_map(|iface| match iface.addr {
            if_addrs::IfAddr::V4(v4) if !v4.ip.is_loopback() => Some(v4.ip.to_string()),
            _ => None,
        })
        .collect();
    ips.sort();
    ips.dedup();
    ips
}

/// One health GET against the performer port. Errors (connection refused,
/// timeout, bad JSON) all mean "not ready yet" to the polling loop.
fn fetch_health(performer_port: u16) -> Result<HealthPayload, String> {
    let url = format!(
        "http://127.0.0.1:{performer_port}{}",
        crate::https::HEALTH_PATH
    );
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
    status: SessionStatus,
    /// The node score server and the scsynth engine, held through their
    /// `SupervisedChild` lifecycle (spawn-recorded → bounded shutdown).
    child: Option<SupervisedChild>,
    /// scsynth process and its OSC port (internal mode only, §7).
    scsynth: Option<SupervisedChild>,
    scsynth_port: Option<u16>,
    /// Whether the App Master Synth has been created (§7.4).
    master_synth_ready: bool,
    project_name: Option<String>,
    project_path: Option<String>,
    audio_mode: Option<AudioMode>,
    lan_ip: Option<String>,
    /// #62: the injected connection address (see `SessionSnapshot`).
    host_address: Option<String>,
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
    /// #130: the projection start gate — see `SessionSnapshot`.
    projection_started: bool,
    /// #140: the running entry gateway, owned exactly as long as the
    /// session (bound before the children spawn; closed by
    /// `teardown_children` on every exit path).
    gateway: Option<crate::gateway::GatewayHandle>,
    /// #140: the entry state — see `SessionSnapshot`.
    https_entry: HttpsEntryState,
    /// #174: the DNS mapping state — see `SessionSnapshot`.
    dns_mapping: DnsMappingState,
    /// #174: the generation that installed the current mapping — the
    /// authority `teardown_children` uses to revoke it (`None` = no
    /// mapping installed this session).
    dns_mapping_generation: Option<u64>,
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
            status: SessionStatus::Idle,
            child: None,
            scsynth: None,
            scsynth_port: None,
            master_synth_ready: false,
            project_name: None,
            project_path: None,
            audio_mode: None,
            lan_ip: None,
            host_address: None,
            osc_target: None,
            health: None,
            error: None,
            output_tail: VecDeque::new(),
            volume: crate::project::audio::DEFAULT_VOLUME_PERCENT,
            startup_stage: 0,
            channel_plan: None,
            output_device: None,
            projection_started: false,
            gateway: None,
            https_entry: HttpsEntryState::default(),
            dns_mapping: DnsMappingState::default(),
            dns_mapping_generation: None,
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
            status: self.status,
            project_name: self.project_name.clone(),
            project_path: self.project_path.clone(),
            audio_mode: self.audio_mode,
            lan_ip: self.lan_ip.clone(),
            host_address: self.host_address.clone(),
            osc_target: self.osc_target.clone(),
            health: self.health.clone(),
            error: self.error.clone(),
            output_tail: self.output_tail.iter().cloned().collect(),
            volume: self.volume,
            startup_stage: self.startup_stage,
            channel_plan: self.channel_plan.clone(),
            output_device: self.output_device.clone(),
            projection_started: self.projection_started,
            https_entry: self.https_entry.clone(),
            dns_mapping: self.dns_mapping.clone(),
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
        self.host_address = None;
        self.osc_target = None;
        self.health = None;
        self.error = None;
        self.output_tail.clear();
        self.volume = crate::project::audio::DEFAULT_VOLUME_PERCENT;
        self.channel_plan = None;
        self.output_device = None;
        self.startup_stage = 0;
        // #130: every Load/switch re-gates the projection to 简介 — the
        // next work's monitor is never revealed by the previous one's
        // 开演.
        self.projection_started = false;
        // #140: the entry resets with the run (the gateway itself is
        // closed by `teardown_children` — this only clears the reported
        // state for whatever comes next).
        self.https_entry = HttpsEntryState::default();
        // #174: the mapping report clears with the run (the daemon-side
        // revoke itself happens in `teardown_children` — this only
        // clears the snapshot's view for whatever comes next).
        self.dns_mapping = DnsMappingState::default();
        self.dns_mapping_generation = None;
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
                status: SessionStatus::Idle,
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
        Self::publish_snapshot(app, &self.inner);
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
        let generation = self.lock().generation + 1;
        // §12 + Retry: the opening move (`any → Starting` on a new
        // generation) also resets the previous run's state, so the first
        // snapshot the UI sees is a clean `starting` at stage 1. A
        // rejection means another start/stop opened a generation after we
        // read ours — surface it instead of plowing over the winner.
        let opened = Self::transition(
            &app,
            &self.inner,
            generation,
            SessionStatus::Starting,
            |inner| {
                inner.reset_run_state();
                inner.project_path = Some(request.path.clone());
                inner.audio_mode = Some(request.mode);
                inner.lan_ip = Some(request.lan_ip.clone());
                // #62: the pre-manifest default — the declared performer
                // address (if any) overrides this once the manifest is loaded
                // in `start_generation`.
                inner.host_address = Some(request.lan_ip.clone());
                inner.startup_stage = 1;
            },
        );
        if !opened {
            return Err(
                "The session changed while starting; wait for it to settle and try again."
                    .to_string(),
            );
        }

        let result = self.start_generation(&app, &app_data_dir, generation, request);
        if let Err(message) = &result {
            self.fail_start(&app, generation, message);
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
                manifest
                    .audio
                    .supported_modes
                    .iter()
                    .map(AudioMode::as_str)
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        if request.lan_ip.parse::<std::net::Ipv4Addr>().is_err()
            || request.lan_ip.starts_with("127.")
        {
            return Err(format!("Invalid LAN IPv4 address: \"{}\"", request.lan_ip));
        }
        // #62: a declared performer address replaces the injected
        // connection address — the score server's env, the snapshot's
        // `host_address` and every URL the App derives (monitor origin)
        // all follow this one value. Undeclared keeps the LAN IP. Read at
        // spawn, so a manifest edit applies at the next start.
        request.performer_address = manifest.performer_address().map(str::to_string);
        {
            let mut inner = self.lock();
            inner.project_name = Some(manifest.name.clone());
            if let Some(address) = &request.performer_address {
                inner.host_address = Some(address.clone());
            }
        }

        // #58: telematic declaration + complete global node config → the
        // four hub variables ride this start's env (every audio mode).
        // Incomplete config silently skips injection — the frontend's
        // 「设置节点」gate is the UX that forces completeness; this is the
        // injection authority. Values are read at spawn, so config edits
        // apply at the next start, never mid-session.
        if manifest.telematic() {
            let prefs = crate::commands::preferences::load_preferences_sync(app)?;
            request.hub = resolve_hub_injection(&manifest, &prefs);
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

        // #140: resolve and BIND the trusted-HTTPS entry before any child
        // spawns — an unusable entry (broken material, occupied port)
        // fails the start through `fail_start` with nothing running yet.
        // `Ok(None)` = the legacy HTTP flow, unchanged.
        let entry_decision = {
            let prefs = crate::commands::preferences::load_preferences_sync(app)?;
            let entry_launch = resolve_entry_launch(
                app_data_dir,
                &prefs,
                &manifest,
                crate::https::public_trust_anchors(),
                std::time::SystemTime::now(),
            )?;
            // #174: the DNS mapping decision rides the same gate — one
            // prefs read decides both the entry and the mapping.
            let dns_mapping_domain = resolve_dns_mapping(&prefs, entry_launch.as_ref());
            (entry_launch, dns_mapping_domain)
        };
        let (entry_launch, dns_mapping_domain) = entry_decision;
        let mut live_entry: Option<LiveEntry> = None;
        if let Some(launch) = entry_launch {
            let bind_ip: std::net::IpAddr = request
                .lan_ip
                .parse()
                .map_err(|_| format!("Invalid LAN IPv4 address: \"{}\"", request.lan_ip))?;
            // Runtime entry failures (listener death) report through the
            // entry state — the session itself keeps running (spec #140).
            let failure_inner = Arc::clone(&self.inner);
            let failure_app = app.clone();
            let sink: crate::gateway::FailureSink = Arc::new(move |message| {
                Self::mark_entry_failure(&failure_app, &failure_inner, generation, message);
            });
            let handle = crate::gateway::start_gateway(
                crate::gateway::GatewayConfig {
                    bind_addr: std::net::SocketAddr::new(bind_ip, launch.port),
                    upstream: std::net::SocketAddr::new(
                        std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
                        manifest.score_server.performer_port,
                    ),
                    chain: launch.chain,
                    key: launch.key,
                    max_connections: crate::gateway::MAX_CONNECTIONS,
                },
                sink,
            )
            .map_err(|e| format!("The HTTPS entry could not start: {e}"))?;
            let upstream_port = manifest.score_server.performer_port;
            log::info!(
                "HTTPS entry bound: {} on {} → 127.0.0.1:{upstream_port}",
                launch.url,
                handle.local_addr()
            );
            request.performer_url = Some(launch.url.clone());
            live_entry = Some(LiveEntry {
                handle,
                url: launch.url,
                domain: launch.domain,
            });
        }

        // §7.1/§7.6: for internal sessions resolve the output device and
        // its capability at the effective sample rate, then compute
        // N/H/K/B. Unreadable capability or H = 0 fails before anything is
        // spawned; a channel-poor device (H < N) is bridged partially,
        // never an error.
        let (device, effective_sc_cfg) = if request.mode == AudioMode::Internal {
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
            request.output_device = Some(cap.name.clone());
            // Issue #100: every spawn carries -H with the RESOLVED name —
            // the saved preference or the system default it fell back to —
            // because scsynth's own default-device resolution path is the
            // #99 ObjC race. A device vanishing between this resolution and
            // the spawn surfaces as scsynth's clean-exit error (error page,
            // output in the session log), never a silent fallback.
            (Some(cap.name), Some(sc_cfg))
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
                audio_mode: request.mode.as_str(),
                lan_ip: &request.lan_ip,
                osc_target: request.osc_target.as_deref().unwrap_or("none"),
                output_device: request.output_device.as_deref().unwrap_or("system default"),
            },
        )
        .ok();
        // #62: both values on one line — the injected address and the LAN
        // selection it replaced.
        if let (Some(log), Some(address)) = (&mut session_log, &request.performer_address) {
            let lan_ip = &request.lan_ip;
            log.write_line(&format!(
                "Performer address from manifest: {address} (replaces LAN IP {lan_ip})"
            ));
        }
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
        // #140: publish the entry state (URL fixed, probing) and hand the
        // gateway to the session — every path from here runs through
        // `teardown_children`, which closes it.
        if let Some(live) = live_entry {
            let probe_addr = live.handle.local_addr();
            let url = live.url;
            let upstream_port = manifest.score_server.performer_port;
            Self::write_session_log_line(
                &self.inner,
                Some(generation),
                &format!(
                    "HTTPS entry: {url} on {probe_addr} → 127.0.0.1:{upstream_port} (probing)"
                ),
            );
            {
                let mut inner = self.lock();
                inner.gateway = Some(live.handle);
                inner.https_entry = HttpsEntryState {
                    status: HttpsEntryStatus::Preparing,
                    url: Some(url),
                    error: None,
                };
            }
            self.spawn_entry_supervisor(
                app.clone(),
                generation,
                probe_addr,
                live.domain.clone(),
                crate::gateway::public_root_store().clone(),
            );
            // #174: install the performance DNS mapping for this start
            // (the gate was resolved with the entry launch above). The
            // daemon installs AND verifies (its own A query through the
            // real pipeline) before this counts. A mapping fault is an
            // independent fact: the session keeps running and phones
            // fall back to manual DNS / the router.
            if let Some(mapping_domain) = &dns_mapping_domain {
                match crate::dns::install_mapping(mapping_domain, &request.lan_ip, generation) {
                    Ok(()) => {
                        Self::write_session_log_line(
                            &self.inner,
                            Some(generation),
                            &format!(
                                "DNS mapping installed: {} → {} (lease supervisor running)",
                                live.domain, request.lan_ip
                            ),
                        );
                        let mut inner = self.lock();
                        inner.dns_mapping = DnsMappingState {
                            status: DnsMappingStatus::Ready,
                            domain: Some(mapping_domain.clone()),
                            ip: Some(request.lan_ip.clone()),
                            error: None,
                        };
                        inner.dns_mapping_generation = Some(generation);
                        self.spawn_dns_mapping_supervisor(app.clone(), generation);
                    }
                    Err(e) => {
                        log::warn!("DNS mapping install failed: {e}");
                        Self::write_session_log_line(
                            &self.inner,
                            Some(generation),
                            &format!("DNS mapping failed: {e}"),
                        );
                        let mut inner = self.lock();
                        inner.dns_mapping = DnsMappingState {
                            status: DnsMappingStatus::Error,
                            domain: Some(mapping_domain.clone()),
                            ip: Some(request.lan_ip.clone()),
                            error: Some(e),
                        };
                    }
                }
            }
            self.emit(app);
        }

        // §8: internal mode boots scsynth first (and waits for /status)
        // before the score server starts. External/none skip this entirely.
        request.resolved_osc_target = match request.mode {
            AudioMode::Internal => {
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
                if let Some(stdout) = sc_child.child().stdout.take() {
                    self.spawn_output_reader(stdout, "scsynth", generation);
                }
                if let Some(stderr) = sc_child.child().stderr.take() {
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
            AudioMode::External => {
                // §9: external mode requires a valid user-provided target.
                let target = request
                    .osc_target
                    .clone()
                    .ok_or("External mode requires an OSC target (host:port)")?;
                crate::project::audio::validate_osc_target(&target)?;
                Some(target)
            }
            AudioMode::None => None,
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
            .arg(request.mode.as_str())
            .current_dir(&working_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .envs(env.iter().map(|(k, v)| (k, v)));

        // §12: spawn + ownership record (pid + entry marker) in one step —
        // if the App dies, the next launch's targeted cleanup finds it.
        let mut child =
            SupervisedChild::spawn(&registry, entry.to_string_lossy().to_string(), &mut cmd)
                .map_err(|e| {
                    format!(
                        "Failed to start the score server with the embedded Node.js runtime: {e}"
                    )
                })?;
        let pid = child.id();

        log::info!(
            "Score server started (pid {pid}): {} --audio-mode {}",
            entry.display(),
            request.mode
        );

        // Pipe node stdout/stderr into the session tail (app-behavior「Error Page」).
        if let Some(stdout) = child.child().stdout.take() {
            self.spawn_output_reader(stdout, "node", generation);
        }
        if let Some(stderr) = child.child().stderr.take() {
            self.spawn_output_reader(stderr, "node", generation);
        }

        {
            let mut inner = self.lock();
            inner.child = Some(child);
            inner.startup_stage = 3;
        }
        self.emit(app);

        self.spawn_supervisor(app.clone(), pid, manifest, generation);
        Ok(())
    }

    /// §12: a synchronously failing start must leave nothing behind.
    /// Tears down whatever this generation already spawned, clears the
    /// handles, and only then publishes the `error` snapshot — so the
    /// state the user retries from is provably clean.
    fn fail_start<R: tauri::Runtime>(&self, app: &AppHandle<R>, generation: u64, message: &str) {
        let inner = Arc::clone(&self.inner);
        Self::fail_generation(app, &inner, generation, message.to_string());
    }

    /// §12: the **single** failure exit for a generation, shared by the
    /// synchronous start path, the startup supervisor and the running
    /// watchdog. Order is the contract: cleanup first, `error` snapshot
    /// second. A superseded generation is a no-op — a dying old session
    /// must never overwrite the retry that replaced it.
    fn fail_generation<R: tauri::Runtime>(
        app: &AppHandle<R>,
        inner: &Arc<Mutex<SessionInner>>,
        generation: u64,
        message: String,
    ) {
        {
            let guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            if guard.generation != generation {
                return;
            }
        }
        Self::teardown_children(inner);
        // Only the status/error write and its publication route through the
        // transition; the teardown ORDER above stays this function's own
        // contract (cleanup first, `error` snapshot second). The lattice
        // covers the second generation check: `Starting`/`Ready → Error` is
        // steady, so a stop/retry that opened a newer generation in between
        // is rejected here.
        Self::transition(app, inner, generation, SessionStatus::Error, |guard| {
            guard.error = Some(message);
            guard.startup_stage = 0;
            // #140: the session died wholesale — its entry (already
            // closed by the teardown above) stops claiming a URL. The
            // session error carries the reason; entry-specific
            // failures while the session lives go through
            // `mark_entry_failure` instead.
            guard.https_entry = HttpsEntryState::default();
            // #174: the mapping is revoked (daemon-side) by the teardown
            // above; the reported state clears with the failed run.
            guard.dns_mapping = DnsMappingState::default();
        });
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

    /// #140: the entry readiness probe — a dedicated thread per
    /// generation. Waits for the session to reach `ready` (the project
    /// server serving health is the precondition for a meaningful
    /// probe), then probes the entry itself (TLS + HTTP 200 through the
    /// tunnel) with a short deadline: entry `ready` publishes only
    /// after that succeeds, and a probe that never succeeds publishes
    /// entry `error` WITHOUT failing the session (the local audio and
    /// server keep running — spec #140: an entry fault is reported, not
    /// escalated).
    fn spawn_entry_supervisor<R: tauri::Runtime>(
        &self,
        app: AppHandle<R>,
        generation: u64,
        probe_addr: std::net::SocketAddr,
        domain: String,
        probe_roots: rustls::RootCertStore,
    ) {
        const ENTRY_PROBE_INTERVAL: Duration = Duration::from_millis(500);
        const ENTRY_PROBE_DEADLINE: Duration = Duration::from_secs(10);
        let inner = Arc::clone(&self.inner);
        std::thread::Builder::new()
            .name("pnds-https-entry-probe".to_string())
            .spawn(move || {
                let mut deadline: Option<Instant> = None;
                loop {
                    std::thread::sleep(ENTRY_PROBE_INTERVAL);
                    let live = {
                        let guard = inner.lock().unwrap_or_else(|e| e.into_inner());
                        if guard.generation != generation {
                            return; // replaced/stopped — the gateway is gone
                        }
                        match guard.status {
                            SessionStatus::Starting | SessionStatus::Ready => {}
                            _ => return, // failed or stopped: entry follows the teardown
                        }
                        guard.status == SessionStatus::Ready
                    };
                    if !live {
                        continue; // the project server is not serving yet
                    }
                    let deadline =
                        *deadline.get_or_insert_with(|| Instant::now() + ENTRY_PROBE_DEADLINE);
                    match crate::gateway::probe_tls_http(
                        probe_addr,
                        &domain,
                        &probe_roots,
                        HEALTH_REQUEST_TIMEOUT,
                    ) {
                        Ok(()) => {
                            Self::mark_entry_state(&app, &inner, generation, |entry| {
                                if entry.status == HttpsEntryStatus::Preparing {
                                    entry.status = HttpsEntryStatus::Ready;
                                }
                            });
                            return;
                        }
                        Err(e) => {
                            if Instant::now() >= deadline {
                                Self::mark_entry_failure(
                                    &app,
                                    &inner,
                                    generation,
                                    format!("The HTTPS entry did not become reachable: {e}"),
                                );
                                return;
                            }
                        }
                    }
                }
            })
            .expect("entry probe thread spawns");
    }

    /// The single writer for entry-state updates outside the start path:
    /// generation-guarded (a replaced session's probe/failure can never
    /// touch the new run's entry), then published through the normal
    /// snapshot funnel.
    fn mark_entry_state<R: tauri::Runtime>(
        app: &AppHandle<R>,
        inner: &Arc<Mutex<SessionInner>>,
        generation: u64,
        mutate: impl FnOnce(&mut HttpsEntryState),
    ) {
        {
            let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            if guard.generation != generation {
                return;
            }
            mutate(&mut guard.https_entry);
        }
        Self::emit_static(app, inner);
    }

    /// #174: the mapping lease supervisor — one thread per generation,
    /// renewing the daemon lease well inside its bound (20 s against a
    /// 60 s lease). Losing the mapping (daemon restarted with state
    /// gone, another run taking over) is logged and published on the
    /// session's `dns_mapping` state — like every mapping fault, it
    /// never fails the session itself.
    fn spawn_dns_mapping_supervisor<R: tauri::Runtime>(&self, app: AppHandle<R>, generation: u64) {
        const LEASE_RENEWAL_INTERVAL: Duration = Duration::from_secs(20);
        let inner = Arc::clone(&self.inner);
        std::thread::Builder::new()
            .name("pnds-dns-mapping-supervisor".to_string())
            .spawn(move || loop {
                std::thread::sleep(LEASE_RENEWAL_INTERVAL);
                {
                    let guard = inner.lock().unwrap_or_else(|e| e.into_inner());
                    if guard.generation != generation {
                        return; // replaced/stopped — teardown owns the revoke
                    }
                    if guard.dns_mapping.status != DnsMappingStatus::Ready {
                        return; // already failed/revoked — nothing to renew
                    }
                }
                if let Err(e) = crate::dns::refresh_mapping(generation) {
                    log::warn!("DNS lease renewal failed (generation {generation}): {e}");
                    Self::mark_dns_mapping_failure(&app, &inner, generation, e);
                    return;
                }
            })
            .expect("dns lease supervisor spawns");
    }

    /// #174: generation-guarded mapping-failure publication — a replaced
    /// session's late lease report must not touch the newer run.
    fn mark_dns_mapping_failure<R: tauri::Runtime>(
        app: &AppHandle<R>,
        inner: &Arc<Mutex<SessionInner>>,
        generation: u64,
        message: String,
    ) {
        {
            let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            if guard.generation != generation {
                return;
            }
            if guard.dns_mapping.status == DnsMappingStatus::Ready {
                guard.dns_mapping.status = DnsMappingStatus::Error;
                guard.dns_mapping.error = Some(message);
            }
        }
        Self::emit_static(app, inner);
    }

    /// #140: a runtime entry failure (probe deadline passed, listener
    /// died) — the entry goes to `error` with the message; the session
    /// itself is untouched. Only a still-launching or already-published
    /// entry can fail this way; a superseded generation's late report
    /// is dropped.
    fn mark_entry_failure<R: tauri::Runtime>(
        app: &AppHandle<R>,
        inner: &Arc<Mutex<SessionInner>>,
        generation: u64,
        message: String,
    ) {
        log::warn!("HTTPS entry failure (generation {generation}): {message}");
        Self::mark_entry_state(app, inner, generation, |entry| {
            if matches!(
                entry.status,
                HttpsEntryStatus::Preparing | HttpsEntryStatus::Ready
            ) {
                entry.status = HttpsEntryStatus::Error;
                entry.error = Some(message);
            }
        });
    }

    fn spawn_supervisor<R: tauri::Runtime>(
        &self,
        app: AppHandle<R>,
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
                    if guard.generation != generation || guard.status != SessionStatus::Starting {
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
                                    generation,
                                    Self::create_master_stage,
                                ) {
                                    Self::watch_running(&app, &inner, pid, generation);
                                }
                                return;
                            }
                            "error" => {
                                drop(guard);
                                Self::fail_generation(
                                    &app,
                                    &inner,
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
                    generation,
                    format!("Audio master stage failed: {e}"),
                );
                return false;
            }
        }
        // The lattice is the authority: `Starting → Ready` is a steady
        // move, so a stop/retry that replaced this generation in the
        // meantime (generation or status moved) is rejected — the session
        // stays exactly as the winner left it.
        Self::transition(app, inner, generation, SessionStatus::Ready, |guard| {
            if needs_master_stage {
                guard.master_synth_ready = true;
            }
            guard.startup_stage = 4;
        })
    }

    /// After ready: watch for unexpected exits until stop is requested.
    fn watch_running<R: tauri::Runtime>(
        app: &AppHandle<R>,
        inner: &Arc<Mutex<SessionInner>>,
        pid: u32,
        generation: u64,
    ) {
        loop {
            std::thread::sleep(HEALTH_POLL_INTERVAL);
            let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            if guard.generation != generation || guard.status != SessionStatus::Ready {
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
                    generation,
                    format!("Score server exited unexpectedly ({status})."),
                );
                return;
            }
        }
    }

    fn emit_static<R: tauri::Runtime>(app: &AppHandle<R>, inner: &Arc<Mutex<SessionInner>>) {
        Self::publish_snapshot(app, inner);
    }

    /// The single authority for production status changes: every
    /// `guard.status = ...` write outside tests routes through here. Owns,
    /// in order, (1) generation validation, (2) the legal-move lattice,
    /// (3) the caller's mutation plus the status write in one critical
    /// section, and (4) publication through the funnel below (App-Nap
    /// refresh included). Returns false — after a `log::warn!` — when the
    /// move is stale or illegal, touching nothing; stale supervisors are
    /// expected life, not bugs, so nothing panics.
    ///
    /// The lattice, derived from the production writers:
    ///
    /// * **Opening moves** — `start` and `stop` open the NEXT generation
    ///   (`generation == current + 1`, installed here), which retires every
    ///   in-flight worker of the old one:
    ///   * `any → Starting` — `start` (first run and Retry from any state)
    ///   * `any → Stopping` — `stop` while child handles are still held
    ///   * `any → Idle` — `stop` with no children (idempotent stop)
    /// * **Steady moves** — the caller acts under the current generation:
    ///   * `Starting → Ready` — `complete_startup`
    ///   * `Starting → Error` / `Ready → Error` — `fail_generation` (startup
    ///     failures and the running watchdog)
    ///   * `Stopping → Idle` — stop's teardown completion (a second `stop`
    ///     racing that teardown re-opens as `any → Idle` above)
    ///
    /// Everything else is rejected: `Idle → Ready` (readiness is claimed
    /// only from `starting`), `Ready → Starting` without a new generation
    /// (a Retry must open one), `Stopping → Error` (a stopped generation
    /// cannot fail — entering `stopping` already retired its supervisors).
    fn transition<R: tauri::Runtime>(
        app: &AppHandle<R>,
        inner: &Arc<Mutex<SessionInner>>,
        generation: u64,
        to: SessionStatus,
        mutate: impl FnOnce(&mut SessionInner),
    ) -> bool {
        let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
        let from = guard.status;
        let opens_generation = generation == guard.generation + 1;
        let steady = generation == guard.generation;
        let legal = match (from, to) {
            // start's reset path and stop's openings leave any status —
            // but only by opening a new generation.
            (_, SessionStatus::Starting) | (_, SessionStatus::Stopping) => opens_generation,
            // stop's childless opening (any status, new generation) and
            // stop's teardown completion (`stopping → idle` on the same
            // generation the stop opened).
            (_, SessionStatus::Idle) => {
                opens_generation || (steady && from == SessionStatus::Stopping)
            }
            // complete_startup: readiness is claimed from `starting` only.
            (SessionStatus::Starting, SessionStatus::Ready) => steady,
            // fail_generation: the single failure exit, from startup or the
            // running watchdog.
            (SessionStatus::Starting, SessionStatus::Error)
            | (SessionStatus::Ready, SessionStatus::Error) => steady,
            _ => false,
        };
        if !legal {
            log::warn!(
                "Rejected session transition {from} → {to} \
                 (generation {generation}, current {}): stale or illegal move",
                guard.generation
            );
            return false;
        }
        mutate(&mut guard);
        guard.status = to;
        if opens_generation {
            guard.generation = generation;
        }
        drop(guard);
        Self::publish_snapshot(app, inner);
        true
    }

    /// The single funnel every state publication passes through (`emit`,
    /// `emit_static` and the transition authority above route here):
    /// refreshes the App-Nap activity —
    /// hold one while the session is live, release it once idle/error
    /// settles (process_activity.rs) — snapshots under the lock, and
    /// emits `pnds:session`. Previously the App-Nap refresh was inlined
    /// twice (emit + emit_static); a third transition path would have
    /// copied it again.
    fn publish_snapshot<R: tauri::Runtime>(app: &AppHandle<R>, inner: &Mutex<SessionInner>) {
        let snapshot = {
            let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            let live = matches!(
                guard.status,
                SessionStatus::Starting | SessionStatus::Ready | SessionStatus::Stopping
            );
            if live && guard.process_activity.is_none() {
                guard.process_activity = Some(crate::process_activity::ProcessActivity::begin(
                    "PNDS live score session",
                ));
            } else if !live {
                guard.process_activity = None;
            }
            guard.snapshot()
        };
        if let Err(e) = (crate::events::SessionSnapshotEvent { snapshot }).emit(app) {
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
    /// the child is shut down through the supervised §12 escalation; an
    /// unconfirmed kill records the pid so the next start's targeted cleanup
    /// can free the audio device.
    fn boot_scsynth(
        app_data_dir: &Path,
        sc_cfg: &crate::project::manifest::ScsynthConfig,
        k: u32,
        device: Option<&str>,
    ) -> Result<(SupervisedChild, u16), crate::project::audio::BootFailure> {
        let port = allocate_udp_port().map_err(crate::project::audio::BootFailure::other)?;
        let binary = crate::project::audio::scsynth_binary_path()
            .map_err(crate::project::audio::BootFailure::other)?;
        let plugins = crate::project::audio::plugins_dir()
            .map_err(crate::project::audio::BootFailure::other)?;
        // §12: the ownership record is DEFERRED until the boot proves
        // healthy — a failed boot kills the child right here (below), and a
        // concurrent preflight's orphan cleanup must not see a boot in
        // flight. `shutdown` records on its own when a kill stays
        // unconfirmed.
        let registry = ChildRegistry::new(app_data_dir.to_path_buf());
        let mut cmd =
            crate::project::audio::scsynth_command(&binary, sc_cfg, k, port, &plugins, device);
        // §12 marker: the resolved path is part of the spawned command line
        // in both the packaged and the dev layout, so a later targeted
        // cleanup matches exactly this scsynth — never a performer's own.
        let marker = binary.to_string_lossy().into_owned();
        let mut child =
            SupervisedChild::spawn_deferred(&registry, marker, &mut cmd).map_err(|e| {
                crate::project::audio::BootFailure::other(format!("Failed to start scsynth: {e}"))
            })?;
        let pid = child.id();

        let wait = match crate::project::audio::OscClient::connect(&format!("127.0.0.1:{port}")) {
            Ok(client) => crate::project::audio::wait_for_scsynth(&client, child.child()),
            Err(e) => Err(crate::project::audio::BootWaitFailure::Osc(e)),
        };
        if let Err(wait_failure) = wait {
            let failure =
                crate::project::audio::classify_boot_failure(&wait_failure, child.child());
            // §12 bounded shutdown: an unconfirmed kill keeps (here:
            // creates) the ownership record for the next start's cleanup.
            child.shutdown(children::SCSYNTH_SHUTDOWN_GRACE_WINDOW);
            return Err(failure);
        }
        child.register();
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
    /// re-runs the targeted orphan cleanup before its port preflight. Both
    /// rules live in `SupervisedChild::shutdown` — teardown only sequences
    /// the two children and mirrors the outcomes into the logs.
    fn teardown_children(inner: &Arc<Mutex<SessionInner>>) {
        let (
            node_child,
            sc_child,
            sc_port,
            master_ready,
            gateway,
            dns_mapping_generation,
            log_generation,
        ) = {
            let mut guard = inner.lock().unwrap_or_else(|e| e.into_inner());
            (
                guard.child.take(),
                guard.scsynth.take(),
                guard.scsynth_port.take(),
                std::mem::take(&mut guard.master_synth_ready),
                // #140: the entry closes FIRST — phones see a clean
                // disconnect instead of routing into whatever comes
                // next, and no stale entry outlives the session.
                guard.gateway.take(),
                // #174: the generation that holds the daemon's DNS
                // mapping — only that holder may revoke it.
                guard.dns_mapping_generation.take(),
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

        if let Some(gateway) = gateway {
            Self::write_session_log_line(inner, log_generation, "Closing the HTTPS entry");
            gateway.shutdown();
            Self::write_session_log_line(inner, log_generation, "HTTPS entry closed");
        }

        // #174: revoke the DNS mapping right after the entry closes — the
        // daemon clears it, the domain turns NXDOMAIN (never the public
        // address), and ordinary forwarding continues. Best-effort: the
        // lease bounds any residue if the daemon is gone.
        if let Some(mapping_generation) = dns_mapping_generation {
            Self::write_session_log_line(inner, log_generation, "Revoking the DNS mapping");
            crate::dns::remove_mapping(mapping_generation);
            Self::write_session_log_line(inner, log_generation, "DNS mapping revoked");
        }

        if let Some(mut node) = node_child {
            Self::stop_child_and_log(
                inner,
                &mut node,
                children::SCORE_SERVER_SHUTDOWN_GRACE_WINDOW,
                "Score server",
                log_generation,
            );
        }

        if let Some(mut sc) = sc_child {
            if let Some(port) = sc_port {
                if let Ok(client) =
                    crate::project::audio::OscClient::connect(&format!("127.0.0.1:{port}"))
                {
                    crate::project::audio::quit_scsynth(&client, master_ready);
                }
            }
            Self::stop_child_and_log(
                inner,
                &mut sc,
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

    /// Issue #93: shuts one child down through the supervised §12 escalation
    /// and mirrors the outcome into both the App log and the session log
    /// (gated on `log_generation` so a concurrent newer session's log is
    /// never touched). The registry discipline (clear on confirm, keep on
    /// unconfirmed) is `SupervisedChild::shutdown`'s own.
    fn stop_child_and_log(
        inner: &Arc<Mutex<SessionInner>>,
        child: &mut SupervisedChild,
        window: std::time::Duration,
        label: &str,
        log_generation: Option<u64>,
    ) {
        let pid = child.id();
        let line = match child.shutdown(window) {
            ShutdownOutcome::Confirmed => {
                log::info!("{label} stopped (pid {pid})");
                format!("{label} stopped (pid {pid})")
            }
            ShutdownOutcome::Unconfirmed => {
                log::warn!(
                    "{label} (pid {pid}) could not be confirmed dead; keeping its ownership record for the next start"
                );
                format!(
                    "{label} (pid {pid}) could not be confirmed dead; keeping its ownership record for the next start"
                )
            }
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
    pub fn stop<R: tauri::Runtime>(&self, app: &AppHandle<R>) -> Result<(), String> {
        let (generation, had_children) = {
            let guard = self.lock();
            (
                guard.generation + 1,
                guard.child.is_some() || guard.scsynth.is_some(),
            )
        };
        // The opening move: `any → Stopping` while child handles are still
        // held (clearing mode/ip so the frontend's ??-guard preserves the
        // user's pending selection across the stop barrier), or the direct
        // `any → Idle` of an idempotent stop. Either way a new generation
        // opens, retiring every supervisor of the old one.
        if had_children {
            Self::transition(
                app,
                &self.inner,
                generation,
                SessionStatus::Stopping,
                |inner| {
                    inner.audio_mode = None;
                    inner.lan_ip = None;
                    inner.host_address = None;
                },
            );
        } else {
            Self::transition(app, &self.inner, generation, SessionStatus::Idle, |inner| {
                inner.reset_run_state();
            });
        }

        let inner = Arc::clone(&self.inner);
        Self::teardown_children(&inner);

        // The completion move closes `stopping` on the generation this stop
        // opened. If a start interleaved during the kill windows, the
        // generation has moved and this is rejected — a dying stop must
        // never overwrite the retry that replaced it (the same §12 rule
        // `fail_generation` upholds for dying supervisors).
        if had_children {
            Self::transition(app, &self.inner, generation, SessionStatus::Idle, |inner| {
                inner.reset_run_state();
            });
        }
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

    /// v1.5.0 (#130): flips the projection start gate (投影开演 ⇄ 撤回).
    /// The gate is Rust-authoritative and session-level: both windows and
    /// the ⌘⏎ menu accelerator act through here (an occluded projection
    /// webview can drop frontend-relayed events; a command + snapshot
    /// publication cannot), and `reset_run_state` returns it to 简介 on
    /// every Load/switch. Only a READY session has a stage to reveal —
    /// anything else is a diagnosable error (the UI entries are gated on
    /// ready; this is the defense behind them).
    pub fn toggle_projection_start<R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
    ) -> Result<(), String> {
        let started = {
            let mut inner = self.lock();
            if inner.status != SessionStatus::Ready {
                return Err("The projection gate only acts on a ready session.".to_string());
            }
            inner.projection_started = !inner.projection_started;
            inner.projection_started
        };
        log::info!("Projection gate toggled: {started}");
        // Outside the inner lock (the emit funnel takes its own).
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

    /// A supervised `sleep` child recorded in `dir`'s registry — the test
    /// stand-in for a session child (node score server / scsynth).
    fn supervised_sleep(dir: &Path, seconds: u32) -> SupervisedChild {
        let registry = ChildRegistry::new(dir.to_path_buf());
        let mut cmd = Command::new("sleep");
        cmd.arg(seconds.to_string());
        SupervisedChild::spawn(&registry, format!("sleep {seconds}"), &mut cmd).unwrap()
    }

    #[test]
    fn env_internal_injects_osc_bus_and_channels() {
        let mut request = StartRequest::new(
            "/p".to_string(),
            crate::types::AudioMode::Internal,
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
            crate::types::AudioMode::External,
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
            crate::types::AudioMode::None,
            "192.168.1.10".to_string(),
            None,
        );
        let env = build_score_server_env(&request);
        assert_eq!(env.len(), 1);
        assert_eq!(env[0].0, "PNDS_HOST_IP");
    }

    /// #58: a minimal manifest with a chosen `telematic` declaration.
    fn manifest_with(id: &str, telematic_json: &str) -> Manifest {
        serde_json::from_str(&format!(
            r#"{{ "schemaVersion": 1, "id": "{id}", "name": "X", "version": "0.1.0", {telematic_json}
                "scoreServer": {{ "entry": "s.js", "workingDirectory": ".", "performerPort": 1, "monitorPort": 2 }},
                "audio": {{ "defaultMode": "none", "supportedModes": ["none"] }} }}"#
        ))
        .unwrap()
    }

    /// #58: global node config of the Settings「节点」section.
    fn node_prefs(
        name: Option<&str>,
        url: Option<&str>,
        token: Option<&str>,
    ) -> crate::types::AppPreferences {
        crate::types::AppPreferences {
            node_name: name.map(str::to_string),
            hub_url: url.map(str::to_string),
            hub_token: token.map(str::to_string),
            ..Default::default()
        }
    }

    const NODE_NAME: Option<&str> = Some("Concert-MacBook");
    const HUB_URL: Option<&str> = Some("wss://hub.example.org:3000");
    const HUB_TOKEN: Option<&str> = Some("secret-token");

    /// #58: the resolver injects only on declaration × completeness, and
    /// the room is always the derivation `{manifest.id}_{group}` — default
    /// group 1, the project's own「Room」choice when saved, never another
    /// project's.
    #[test]
    fn hub_resolution_requires_declaration_and_complete_config() {
        let declared = manifest_with("my-work", "\"telematic\": true,");
        let undeclared = manifest_with("my-work", "");

        // No declaration → never injected, whatever the config.
        assert!(
            resolve_hub_injection(&undeclared, &node_prefs(NODE_NAME, HUB_URL, HUB_TOKEN))
                .is_none()
        );

        // Declared + complete → all four, derived room at the default group.
        let injection =
            resolve_hub_injection(&declared, &node_prefs(NODE_NAME, HUB_URL, HUB_TOKEN)).unwrap();
        assert_eq!(injection.node_id, "Concert-MacBook");
        assert_eq!(injection.url, "wss://hub.example.org:3000");
        assert_eq!(injection.token, "secret-token");
        assert_eq!(injection.room, "my-work_1");

        // Declared but any field missing/blank → nothing (all-or-nothing).
        for incomplete in [
            node_prefs(None, HUB_URL, HUB_TOKEN),
            node_prefs(NODE_NAME, None, HUB_TOKEN),
            node_prefs(NODE_NAME, HUB_URL, None),
            node_prefs(Some("   "), HUB_URL, HUB_TOKEN),
            node_prefs(NODE_NAME, Some(""), HUB_TOKEN),
            node_prefs(NODE_NAME, HUB_URL, Some(" \t ")),
        ] {
            assert!(
                resolve_hub_injection(&declared, &incomplete).is_none(),
                "must not inject: {incomplete:?}"
            );
        }

        // Saved group of THIS project picks the suffix; another project's
        // entry is irrelevant; the range's top end works.
        let mut prefs = node_prefs(NODE_NAME, HUB_URL, HUB_TOKEN);
        prefs.hub_rooms.insert("my-work".to_string(), 3);
        let injection = resolve_hub_injection(&declared, &prefs).unwrap();
        assert_eq!(injection.room, "my-work_3");
        prefs.hub_rooms.insert("other-work".to_string(), 2);
        let injection = resolve_hub_injection(&declared, &prefs).unwrap();
        assert_eq!(injection.room, "my-work_3");
        prefs.hub_rooms.insert("my-work".to_string(), 2);
        let injection = resolve_hub_injection(&declared, &prefs).unwrap();
        assert_eq!(injection.room, "my-work_2");
    }

    /// #58: the four hub variables are orthogonal to the audio mode —
    /// every mode carries all four when resolved, none when not; the token
    /// arrives as its own variable, the URL stays exactly the configured
    /// string.
    #[test]
    fn hub_env_rides_every_audio_mode_or_none_at_all() {
        let hub = resolve_hub_injection(
            &manifest_with("my-work", "\"telematic\": true,"),
            &node_prefs(NODE_NAME, HUB_URL, HUB_TOKEN),
        )
        .unwrap();
        for mode in [AudioMode::Internal, AudioMode::External, AudioMode::None] {
            let mut request =
                StartRequest::new("/p".to_string(), mode, "192.168.1.10".to_string(), None);
            request.resolved_osc_target = Some("127.0.0.1:49328".to_string());
            request.channel_plan = Some(crate::project::audio::channel_plan(2, 2));
            request.hub = Some(hub.clone());
            let env = build_score_server_env(&request);
            let get = |k: &str| {
                env.iter()
                    .find(|(key, _)| key == k)
                    .map(|(_, v)| v.as_str())
            };
            assert_eq!(get("PNDS_NODE_ID"), Some("Concert-MacBook"), "{mode}");
            assert_eq!(
                get("PNDS_HUB_URL"),
                Some("wss://hub.example.org:3000"),
                "{mode}"
            );
            assert_eq!(get("PNDS_HUB_TOKEN"), Some("secret-token"), "{mode}");
            assert_eq!(get("PNDS_HUB_ROOM"), Some("my-work_1"), "{mode}");

            // Unresolved (undeclared or incomplete) → not one of them, any mode.
            request.hub = None;
            let env = build_score_server_env(&request);
            assert!(
                env.iter()
                    .all(|(key, _)| !key.starts_with("PNDS_HUB_") && key != "PNDS_NODE_ID"),
                "{mode}"
            );
        }
    }

    /// #62: a manifest-declared performer address replaces the injected
    /// `PNDS_HOST_IP` in every audio mode — the Project keeps reading the
    /// same variable; undeclared keeps the selected LAN IP (the earlier
    /// env tests pin that fallback with plain IPs for all three modes).
    #[test]
    fn declared_performer_address_replaces_host_ip_in_every_mode() {
        for mode in [AudioMode::Internal, AudioMode::External, AudioMode::None] {
            let mut request =
                StartRequest::new("/p".to_string(), mode, "192.168.1.10".to_string(), None);
            request.resolved_osc_target = Some("127.0.0.1:49328".to_string());
            request.channel_plan = Some(crate::project::audio::channel_plan(2, 2));
            request.performer_address = Some("mywork.local".to_string());
            let env = build_score_server_env(&request);
            let host = env
                .iter()
                .find(|(key, _)| key == "PNDS_HOST_IP")
                .unwrap_or_else(|| panic!("{mode}: PNDS_HOST_IP missing"));
            assert_eq!(host.1, "mywork.local", "{mode}");
            // Declared + none mode still injects ONLY the host variable —
            // the replacement never widens the none-mode surface.
            if mode == AudioMode::None {
                assert_eq!(env.len(), 1, "{mode}: {env:?}");
            }

            // Undeclared → exactly the selected LAN IP.
            request.performer_address = None;
            let env = build_score_server_env(&request);
            let host = env
                .iter()
                .find(|(key, _)| key == "PNDS_HOST_IP")
                .unwrap_or_else(|| panic!("{mode}: PNDS_HOST_IP missing"));
            assert_eq!(host.1, "192.168.1.10", "{mode}");
        }
    }

    #[test]
    fn multichannel_volume_is_fixed_at_unity() {
        let app = tauri::test::mock_app().handle().clone();
        // tauri-specta emits resolve their registry entry at call time;
        // mount the real event set on the mock app.
        crate::events::events_builder().mount_events(&app);
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
        // tauri-specta emits resolve their registry entry at call time;
        // mount the real event set on the mock app.
        crate::events::events_builder().mount_events(&app);
        let manager = SessionManager::default();
        {
            let mut inner = manager.lock();
            inner.channel_plan = Some(crate::project::audio::channel_plan(2, 2));
        }
        manager.set_master_volume(&app, 40.0).unwrap();
        assert_eq!(manager.snapshot().volume, 40.0);
    }

    /// #130: the projection gate — ready-gated toggling, session-level
    /// reset through `reset_run_state` (the Load/switch reset point).
    #[test]
    fn projection_gate_toggles_on_ready_and_resets_per_session() {
        let app = tauri::test::mock_app().handle().clone();
        crate::events::events_builder().mount_events(&app);
        let manager = SessionManager::default();

        // Not a ready session: a diagnosable error, never a silent flip.
        let err = manager.toggle_projection_start(&app).unwrap_err();
        assert!(err.contains("ready"), "unexpected: {err}");
        assert!(!manager.snapshot().projection_started);

        {
            let mut inner = manager.lock();
            inner.status = SessionStatus::Ready;
        }
        manager.toggle_projection_start(&app).unwrap();
        assert!(manager.snapshot().projection_started);
        // 撤回 — the same action reverses.
        manager.toggle_projection_start(&app).unwrap();
        assert!(!manager.snapshot().projection_started);

        // 开演 again, then a Load/switch (reset_run_state) re-gates the
        // NEXT work to 简介 even if the previous one was revealed.
        manager.toggle_projection_start(&app).unwrap();
        {
            let mut inner = manager.lock();
            inner.reset_run_state();
        }
        assert!(!manager.snapshot().projection_started);
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
    fn lan_addresses_exclude_vpn_tunnels_but_keep_physical_private_addresses() {
        let interface = |name: &str, ip: &str| if_addrs::Interface {
            name: name.to_string(),
            addr: if_addrs::IfAddr::V4(if_addrs::Ifv4Addr {
                ip: ip.parse().unwrap(),
                netmask: "255.255.255.0".parse().unwrap(),
                prefixlen: 24,
                broadcast: None,
            }),
            index: None,
            #[cfg(windows)]
            adapter_name: name.to_string(),
        };
        let ips = lan_addresses_from_interfaces(vec![
            interface("utun6", "172.19.0.1"),
            interface("tun0", "10.8.0.1"),
            interface("en0", "192.168.11.31"),
            interface("en1", "10.0.0.5"),
            interface("en0", "192.168.11.31"),
            interface("lo0", "127.0.0.1"),
        ]);
        assert_eq!(ips, vec!["10.0.0.5", "192.168.11.31"]);
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
        // tauri-specta emits resolve their registry entry at call time;
        // mount the real event set on the mock app.
        crate::events::events_builder().mount_events(&app);
        let manager = SessionManager::default();
        manager.stop(&app).unwrap();
        assert_eq!(manager.snapshot().status, SessionStatus::Idle);
        // Idempotent: a second stop is fine too.
        manager.stop(&app).unwrap();
    }

    #[test]
    fn stop_with_child_terminates_and_resets() {
        let app = tauri::test::mock_app().handle().clone();
        // tauri-specta emits resolve their registry entry at call time;
        // mount the real event set on the mock app.
        crate::events::events_builder().mount_events(&app);
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();

        let pid = {
            let mut inner = manager.lock();
            let child = supervised_sleep(dir.path(), 30);
            let pid = child.id();
            inner.child = Some(child);
            inner.status = SessionStatus::Ready;
            pid
        };
        assert!(manager.has_active_session());

        manager.stop(&app).unwrap();

        assert!(!manager.has_active_session());
        assert_eq!(manager.snapshot().status, SessionStatus::Idle);
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
        // tauri-specta emits resolve their registry entry at call time;
        // mount the real event set on the mock app.
        crate::events::events_builder().mount_events(&app);
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();
        assert!(manager.active_child_pids().is_empty());

        let expected: HashSet<u32> = {
            let mut inner = manager.lock();
            let node = supervised_sleep(dir.path(), 30);
            let scsynth = supervised_sleep(dir.path(), 31);
            let expected: HashSet<u32> = [node.id(), scsynth.id()].into_iter().collect();
            inner.child = Some(node);
            inner.scsynth = Some(scsynth);
            inner.status = SessionStatus::Ready;
            expected
        };
        assert_eq!(manager.active_child_pids(), expected);

        manager.stop(&app).unwrap();
        assert!(manager.active_child_pids().is_empty());
    }

    /// §12: an error-state session has NO lingering children — the failed
    /// generation was torn down before the error snapshot. Retry starts
    /// from a clean slate.
    #[test]
    fn teardown_clears_children_for_retry() {
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();

        let pid = {
            let mut inner = manager.lock();
            let child = supervised_sleep(dir.path(), 30);
            let pid = child.id();
            inner.child = Some(child);
            inner.status = SessionStatus::Error;
            pid
        };

        // Simulate the supervisor's failure path: teardown, then the
        // error snapshot.
        let inner = std::sync::Arc::clone(&manager.inner);
        SessionManager::teardown_children(&inner);

        let snapshot = manager.snapshot();
        assert_eq!(snapshot.status, SessionStatus::Error);
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
        // tauri-specta emits resolve their registry entry at call time;
        // mount the real event set on the mock app.
        crate::events::events_builder().mount_events(&app);
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();

        let node = supervised_sleep(dir.path(), 30);
        let scsynth = supervised_sleep(dir.path(), 30);
        let (node_pid, sc_pid) = (node.id(), scsynth.id());
        let generation = {
            let mut inner = manager.lock();
            inner.generation += 1;
            inner.child = Some(node);
            inner.scsynth = Some(scsynth);
            inner.scsynth_port = Some(57110);
            inner.status = SessionStatus::Starting;
            inner.startup_stage = 3;
            inner.generation
        };

        let inner = std::sync::Arc::clone(&manager.inner);
        SessionManager::fail_generation(
            &app,
            &inner,
            generation,
            "Timed out waiting for the project to report ready (30s).".to_string(),
        );

        let snapshot = manager.snapshot();
        assert_eq!(snapshot.status, SessionStatus::Error);
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
        // tauri-specta emits resolve their registry entry at call time;
        // mount the real event set on the mock app.
        crate::events::events_builder().mount_events(&app);
        let manager = SessionManager::default();
        let generation = {
            let mut inner = manager.lock();
            inner.generation += 1;
            inner.status = SessionStatus::Starting;
            inner.startup_stage = 3;
            inner.scsynth_port = Some(57110);
            inner.channel_plan = Some(crate::project::audio::channel_plan(2, 2));
            inner.generation
        };

        let inner = std::sync::Arc::clone(&manager.inner);
        let observed = std::sync::Mutex::new(SessionStatus::Idle);
        let reached_ready =
            SessionManager::complete_startup(&app, &inner, generation, |_port, _k, _b, _gain| {
                *observed.lock().unwrap() = manager.lock().status;
                Ok(())
            });

        assert!(reached_ready);
        assert_eq!(
            *observed.lock().unwrap(),
            SessionStatus::Starting,
            "the session must still be `starting` while the master stage is being confirmed"
        );
        let guard = manager.lock();
        assert_eq!(guard.status, SessionStatus::Ready);
        assert_eq!(guard.startup_stage, 4);
        assert!(guard.master_synth_ready);
    }

    /// §8: a master-stage failure fails the whole generation — from
    /// `starting`, never leaving a phantom ready state behind.
    #[test]
    fn master_stage_failure_fails_the_generation_instead_of_ready() {
        let app = tauri::test::mock_app().handle().clone();
        // tauri-specta emits resolve their registry entry at call time;
        // mount the real event set on the mock app.
        crate::events::events_builder().mount_events(&app);
        let manager = SessionManager::default();
        let generation = {
            let mut inner = manager.lock();
            inner.generation += 1;
            inner.status = SessionStatus::Starting;
            inner.startup_stage = 3;
            inner.scsynth_port = Some(57110);
            inner.channel_plan = Some(crate::project::audio::channel_plan(2, 2));
            inner.generation
        };

        let inner = std::sync::Arc::clone(&manager.inner);
        let reached_ready =
            SessionManager::complete_startup(&app, &inner, generation, |_port, _k, _b, _gain| {
                Err("synthdef load timed out".to_string())
            });

        assert!(!reached_ready);
        let snapshot = manager.snapshot();
        assert_eq!(snapshot.status, SessionStatus::Error);
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
        // tauri-specta emits resolve their registry entry at call time;
        // mount the real event set on the mock app.
        crate::events::events_builder().mount_events(&app);
        let manager = SessionManager::default();
        let generation = {
            let mut inner = manager.lock();
            inner.generation += 1;
            inner.status = SessionStatus::Starting;
            inner.startup_stage = 3;
            inner.generation
        };

        let inner = std::sync::Arc::clone(&manager.inner);
        let reached_ready =
            SessionManager::complete_startup(&app, &inner, generation, |_port, _k, _b, _gain| {
                panic!("none mode must not touch scsynth")
            });

        assert!(reached_ready);
        let snapshot = manager.snapshot();
        assert_eq!(snapshot.status, SessionStatus::Ready);
        assert_eq!(snapshot.startup_stage, 4);
        assert!(!manager.lock().master_synth_ready);
    }

    /// §12: a dying old generation must never overwrite the retry that
    /// replaced it — the late failure is dropped, not published.
    #[test]
    fn stale_generation_failure_does_not_touch_the_new_session() {
        let app = tauri::test::mock_app().handle().clone();
        // tauri-specta emits resolve their registry entry at call time;
        // mount the real event set on the mock app.
        crate::events::events_builder().mount_events(&app);
        let manager = SessionManager::default();

        let stale_generation = {
            let mut inner = manager.lock();
            inner.generation = 7;
            inner.generation
        };
        // A Retry bumped the generation; the new session is already starting.
        {
            let mut inner = manager.lock();
            inner.generation = 8;
            inner.status = SessionStatus::Starting;
            inner.startup_stage = 2;
        }

        let inner = std::sync::Arc::clone(&manager.inner);
        SessionManager::fail_generation(
            &app,
            &inner,
            stale_generation,
            "stale supervisor error".to_string(),
        );

        let snapshot = manager.snapshot();
        assert_eq!(snapshot.status, SessionStatus::Starting);
        assert_eq!(snapshot.error, None);
        assert_eq!(snapshot.startup_stage, 2);
    }

    /// A mock app with the real event set mounted plus a typed
    /// `SessionSnapshotEvent` recorder. Tauri's Rust listeners live in the
    /// app manager — runtime-agnostic — and are invoked synchronously
    /// during emit, so a committed transition's snapshot is already in the
    /// vec by the time the call returns.
    fn app_with_snapshot_recorder() -> (
        tauri::AppHandle<tauri::test::MockRuntime>,
        Arc<Mutex<Vec<SessionSnapshot>>>,
    ) {
        let app = tauri::test::mock_app().handle().clone();
        // tauri-specta emits resolve their registry entry at call time;
        // mount the real event set on the mock app.
        crate::events::events_builder().mount_events(&app);
        let received: Arc<Mutex<Vec<SessionSnapshot>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&received);
        crate::events::SessionSnapshotEvent::listen_any(&app, move |event| {
            sink.lock().unwrap().push(event.payload.snapshot);
        });
        (app, received)
    }

    /// The production lattice: every legal move commits — the status lands,
    /// the mutation ran, and an opening move installed the new generation
    /// it acted on. `true` = the move opens the next generation (start,
    /// stop); `false` = a steady move under the current one.
    #[test]
    fn transition_commits_every_legal_production_move() {
        let (app, _received) = app_with_snapshot_recorder();
        let cases: &[(SessionStatus, SessionStatus, bool)] = &[
            // start's reset path: any status → Starting on a new generation.
            (SessionStatus::Idle, SessionStatus::Starting, true),
            (SessionStatus::Starting, SessionStatus::Starting, true),
            (SessionStatus::Ready, SessionStatus::Starting, true),
            (SessionStatus::Error, SessionStatus::Starting, true),
            (SessionStatus::Stopping, SessionStatus::Starting, true),
            // complete_startup.
            (SessionStatus::Starting, SessionStatus::Ready, false),
            // fail_generation from startup and from the running watchdog.
            (SessionStatus::Starting, SessionStatus::Error, false),
            (SessionStatus::Ready, SessionStatus::Error, false),
            // stop's opening with children held.
            (SessionStatus::Idle, SessionStatus::Stopping, true),
            (SessionStatus::Starting, SessionStatus::Stopping, true),
            (SessionStatus::Ready, SessionStatus::Stopping, true),
            (SessionStatus::Error, SessionStatus::Stopping, true),
            // stop's opening without children (idempotent stop).
            (SessionStatus::Idle, SessionStatus::Idle, true),
            (SessionStatus::Error, SessionStatus::Idle, true),
            // stop's teardown completion, and a second stop racing it.
            (SessionStatus::Stopping, SessionStatus::Idle, false),
            (SessionStatus::Stopping, SessionStatus::Idle, true),
        ];
        for &(from, to, opens_generation) in cases {
            let manager = SessionManager::default();
            let generation = {
                let mut inner = manager.lock();
                inner.status = from;
                inner.generation + u64::from(opens_generation)
            };
            let committed =
                SessionManager::transition(&app, &manager.inner, generation, to, |inner| {
                    inner.output_tail.push_back("mutated".to_string())
                });
            assert!(committed, "{from} → {to} is a legal production move");
            let guard = manager.lock();
            assert_eq!(guard.status, to, "{from} → {to}");
            assert_eq!(guard.generation, generation, "{from} → {to}");
            assert_eq!(
                guard.output_tail.back().map(String::as_str),
                Some("mutated"),
                "{from} → {to}: the mutation must run"
            );
        }
    }

    /// Everything off the lattice is rejected and logged: no status write,
    /// no mutation, no publication. The last two cases pin the generation
    /// discipline — readiness is claimed under the CURRENT generation, and
    /// a Retry MUST open a new one (Ready → Starting same generation is the
    /// stale-supervisor shape).
    #[test]
    fn transition_rejects_illegal_moves_and_touches_nothing() {
        let (app, received) = app_with_snapshot_recorder();
        // (from, to, generation offset from the current one)
        let cases: &[(SessionStatus, SessionStatus, u64)] = &[
            (SessionStatus::Idle, SessionStatus::Ready, 0),
            (SessionStatus::Idle, SessionStatus::Error, 0),
            (SessionStatus::Error, SessionStatus::Ready, 0),
            (SessionStatus::Error, SessionStatus::Error, 0),
            (SessionStatus::Stopping, SessionStatus::Error, 0),
            (SessionStatus::Stopping, SessionStatus::Ready, 0),
            (SessionStatus::Ready, SessionStatus::Ready, 0),
            (SessionStatus::Ready, SessionStatus::Idle, 0),
            // A Retry that did not open a new generation.
            (SessionStatus::Ready, SessionStatus::Starting, 0),
            // A steady move claiming the NEXT generation.
            (SessionStatus::Starting, SessionStatus::Ready, 1),
        ];
        for &(from, to, offset) in cases {
            let manager = SessionManager::default();
            {
                let mut inner = manager.lock();
                inner.status = from;
            }
            let generation = manager.lock().generation + offset;
            let committed =
                SessionManager::transition(&app, &manager.inner, generation, to, |inner| {
                    inner.output_tail.push_back("must not run".to_string())
                });
            assert!(
                !committed,
                "{from} → {to} (generation +{offset}) must be rejected"
            );
            let guard = manager.lock();
            assert_eq!(
                guard.status, from,
                "{from} → {to}: the state must be untouched"
            );
            assert!(
                guard.output_tail.is_empty(),
                "{from} → {to}: the mutation must not run"
            );
        }
        assert!(
            received.lock().unwrap().is_empty(),
            "a rejected transition must not publish"
        );
    }

    /// A stale generation is the expected life of superseded supervisor
    /// threads: the move is a no-op — no status change, no mutation, no
    /// publication — whatever the target.
    #[test]
    fn transition_with_a_stale_generation_is_a_noop() {
        let (app, received) = app_with_snapshot_recorder();
        let manager = SessionManager::default();
        {
            let mut inner = manager.lock();
            inner.generation = 8;
            inner.status = SessionStatus::Starting;
        }
        // One behind: the supervisor's captured generation.
        assert!(!SessionManager::transition(
            &app,
            &manager.inner,
            7,
            SessionStatus::Ready,
            |inner| inner.startup_stage = 4,
        ));
        // Skipping ahead is just as stale: generations only advance by one.
        assert!(!SessionManager::transition(
            &app,
            &manager.inner,
            10,
            SessionStatus::Starting,
            |_| {},
        ));
        let guard = manager.lock();
        assert_eq!(guard.status, SessionStatus::Starting);
        assert_eq!(guard.generation, 8);
        assert_eq!(guard.startup_stage, 0);
        drop(guard);
        assert!(
            received.lock().unwrap().is_empty(),
            "a stale transition must not publish"
        );
    }

    /// A committed transition publishes exactly one snapshot, through the
    /// same funnel as every other publication, carrying the new status and
    /// the mutation's fields.
    #[test]
    fn committed_transition_publishes_exactly_one_snapshot() {
        let (app, received) = app_with_snapshot_recorder();
        let manager = SessionManager::default();
        {
            let mut inner = manager.lock();
            inner.generation = 3;
            inner.status = SessionStatus::Starting;
        }
        assert!(SessionManager::transition(
            &app,
            &manager.inner,
            3,
            SessionStatus::Ready,
            |inner| inner.startup_stage = 4,
        ));
        let events = received.lock().unwrap();
        assert_eq!(events.len(), 1, "one committed transition, one snapshot");
        assert_eq!(events[0].status, SessionStatus::Ready);
        assert_eq!(events[0].startup_stage, 4);
    }

    /// §12: `start` opens a new generation before it does any work — the
    /// previous run's error/health/output tail never bleeds into the retry,
    /// and the very first snapshot the UI sees is `starting` at stage 1.
    #[test]
    fn start_failure_opens_a_clean_generation_then_reports_the_new_error() {
        let app = tauri::test::mock_app().handle().clone();
        // tauri-specta emits resolve their registry entry at call time;
        // mount the real event set on the mock app.
        crate::events::events_builder().mount_events(&app);
        let manager = SessionManager::default();
        let dir = tempfile::tempdir().unwrap();

        {
            let mut inner = manager.lock();
            inner.status = SessionStatus::Error;
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
                    crate::types::AudioMode::None,
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
        assert_eq!(snapshot.status, SessionStatus::Error);
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
        let mut child = {
            let registry = ChildRegistry::new(dir.path().to_path_buf());
            let mut cmd = Command::new("/bin/sh");
            cmd.arg("-c")
                .arg(
                    "trap 'echo shutting-down; exit 0' TERM; echo ready; \
                 while :; do sleep 0.1; done",
                )
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            SupervisedChild::spawn(&registry, "graceful-shutdown-fixture", &mut cmd).unwrap()
        };
        let reader = manager.spawn_output_reader(child.child().stdout.take().unwrap(), "node", 3);
        {
            let mut inner = manager.lock();
            inner.status = SessionStatus::Stopping;
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
        SessionManager::teardown_children(&inner);
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
        // tauri-specta emits resolve their registry entry at call time;
        // mount the real event set on the mock app.
        crate::events::events_builder().mount_events(&app);
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

        let (pid, generation) = {
            let mut inner = manager.lock();
            let child = supervised_sleep(dir.path(), 30);
            let pid = child.id();
            inner.generation += 1;
            inner.status = SessionStatus::Starting;
            inner.startup_stage = 3;
            inner.child = Some(child);
            (pid, inner.generation)
        };

        manager.spawn_supervisor(app.clone(), pid, manifest, generation);

        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let status = manager.lock().status;
            if status == SessionStatus::Ready {
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
        assert_eq!(snapshot.status, SessionStatus::Ready);
        assert_eq!(snapshot.startup_stage, 4);
        assert_eq!(
            snapshot.health.as_ref().map(|h| h.status.as_str()),
            Some("ready")
        );

        manager.stop(&app).unwrap();
        assert_eq!(manager.snapshot().status, SessionStatus::Idle);
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

    // ------------------------------------------------------------------
    // #140: the trusted-HTTPS entry
    // ------------------------------------------------------------------

    #[test]
    fn env_carries_performer_url_only_when_the_entry_is_active() {
        let mut request = StartRequest::new(
            "/p".to_string(),
            AudioMode::None,
            "192.168.1.10".to_string(),
            None,
        );
        let env = build_score_server_env(&request);
        assert!(!env.iter().any(|(k, _)| k == "PNDS_PERFORMER_URL"));

        request.performer_url = Some("https://show.example.org:8443/".to_string());
        let env = build_score_server_env(&request);
        let get = |k: &str| {
            env.iter()
                .find(|(key, _)| key == k)
                .map(|(_, v)| v.as_str())
        };
        assert_eq!(
            get("PNDS_PERFORMER_URL"),
            Some("https://show.example.org:8443/")
        );
        // §3: the host variables are untouched by the entry.
        assert_eq!(get("PNDS_HOST_IP"), Some("192.168.1.10"));
    }

    #[test]
    fn performer_entry_url_spells_the_full_root() {
        assert_eq!(
            performer_entry_url("show.example.org", 8443),
            "https://show.example.org:8443/"
        );
    }

    /// A minimal manifest with an optional `supportsPerformerUrl`
    /// declaration (the #138 lenient boolean).
    fn entry_manifest(declared: bool) -> Manifest {
        let declaration = if declared {
            ", \"supportsPerformerUrl\": true"
        } else {
            ""
        };
        serde_json::from_str(&format!(
            r#"{{ "schemaVersion": 1, "id": "my-work", "name": "X", "version": "0.1.0",
                "scoreServer": {{ "entry": "s.js", "workingDirectory": ".", "performerPort": 1, "monitorPort": 2{declaration} }},
                "audio": {{ "defaultMode": "none", "supportedModes": ["none"] }} }}"#
        ))
        .unwrap()
    }

    fn entry_prefs(
        enabled: Option<bool>,
        domain: Option<&str>,
        port: Option<u16>,
    ) -> crate::types::AppPreferences {
        crate::types::AppPreferences {
            https_enabled: enabled,
            https_domain: domain.map(str::to_string),
            https_port: port,
            ..Default::default()
        }
    }

    /// Imports real rcgen certificate material into the tempdir's
    /// protected storage through the #139 pipeline, returning the test
    /// anchors it installed (the resolution call sites trust exactly
    /// these — never the system, never Mozilla).
    fn import_entry_material(dir: &Path, domain: &str) -> Vec<webpki::types::TrustAnchor<'static>> {
        let ca_key = rcgen::KeyPair::generate().unwrap();
        let mut ca_params = rcgen::CertificateParams::new(Vec::<String>::new()).unwrap();
        ca_params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        ca_params
            .distinguished_name
            .push(rcgen::DnType::CommonName, "PNDS Entry Test CA");
        let ca = ca_params.self_signed(&ca_key).unwrap();
        let leaf_key = rcgen::KeyPair::generate().unwrap();
        let mut leaf_params = rcgen::CertificateParams::new(vec![domain.to_string()]).unwrap();
        leaf_params
            .distinguished_name
            .push(rcgen::DnType::CommonName, domain);
        let leaf = leaf_params.signed_by(&leaf_key, &ca, &ca_key).unwrap();

        let cert_path = dir.join("fullchain.pem");
        let key_path = dir.join("privkey.pem");
        std::fs::write(&cert_path, format!("{}{}", leaf.pem(), ca.pem())).unwrap();
        std::fs::write(&key_path, leaf_key.serialize_pem()).unwrap();

        let ca_der: &'static webpki::types::CertificateDer = Box::leak(Box::new(ca.der().clone()));
        let anchors = vec![webpki::anchor_from_trusted_cert(ca_der).unwrap()];
        crate::https::import_material(
            dir,
            domain,
            &cert_path,
            &key_path,
            &anchors,
            std::time::SystemTime::now(),
        )
        .unwrap();
        anchors
    }

    #[test]
    fn entry_resolution_requires_switch_declaration_and_valid_config() {
        let dir = tempfile::tempdir().unwrap();
        let test_anchors = import_entry_material(dir.path(), "show.example.org");
        let declared = entry_manifest(true);
        let undeclared = entry_manifest(false);
        let now = std::time::SystemTime::now();

        // Switch off or project undeclared → None (the legacy flow), no
        // matter what else is configured.
        assert!(resolve_entry_launch(
            dir.path(),
            &entry_prefs(None, Some("show.example.org"), Some(8443)),
            &declared,
            &test_anchors,
            now
        )
        .unwrap()
        .is_none());
        assert!(resolve_entry_launch(
            dir.path(),
            &entry_prefs(Some(false), Some("show.example.org"), Some(8443)),
            &declared,
            &test_anchors,
            now
        )
        .unwrap()
        .is_none());
        assert!(resolve_entry_launch(
            dir.path(),
            &entry_prefs(Some(true), Some("show.example.org"), Some(8443)),
            &undeclared,
            &test_anchors,
            now
        )
        .unwrap()
        .is_none());

        // Switch on × declared × config missing → the start fails with
        // the actionable message (never a silent HTTP fallback).
        let err = resolve_entry_launch(
            dir.path(),
            &entry_prefs(Some(true), None, None),
            &declared,
            &test_anchors,
            now,
        )
        .unwrap_err();
        assert!(err.contains("domain"), "{err}");
        let err = resolve_entry_launch(
            dir.path(),
            &entry_prefs(Some(true), Some("show.example.org"), None),
            &declared,
            &test_anchors,
            now,
        )
        .unwrap_err();
        assert!(err.contains("port"), "{err}");

        // Fully configured → the launch facts (URL + material).
        let launch = resolve_entry_launch(
            dir.path(),
            &entry_prefs(Some(true), Some("show.example.org"), Some(8443)),
            &declared,
            &test_anchors,
            now,
        )
        .unwrap()
        .expect("activated");
        assert_eq!(launch.url, "https://show.example.org:8443/");
        assert_eq!(launch.domain, "show.example.org");
        assert_eq!(launch.port, 8443);
        assert!(!launch.chain.is_empty());

        // Material valid for ANOTHER domain (operator changed the
        // domain preference since import) → launch refuses.
        let err = resolve_entry_launch(
            dir.path(),
            &entry_prefs(Some(true), Some("other.example.org"), Some(8443)),
            &declared,
            &test_anchors,
            now,
        )
        .unwrap_err();
        assert!(err.to_lowercase().contains("domain"), "{err}");
    }

    #[test]
    fn entry_resolution_fails_when_no_material_is_stored() {
        let dir = tempfile::tempdir().unwrap();
        let err = resolve_entry_launch(
            dir.path(),
            &entry_prefs(Some(true), Some("show.example.org"), Some(8443)),
            &entry_manifest(true),
            crate::https::public_trust_anchors(),
            std::time::SystemTime::now(),
        )
        .unwrap_err();
        assert!(
            err.to_lowercase().contains("certificate"),
            "the error should point at the missing material: {err}"
        );
    }

    /// A raw TCP /__pnds/health responder — the same stand-in the
    /// supervisor tests use, now standing behind the real gateway.
    fn spawn_health_responder() -> u16 {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let body = r#"{"status":"ready","projectId":"fixture"}"#;
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
    }

    /// The launch-shaped gateway the lifecycle tests install into a
    /// session: real listener, real TLS, test CA (trusted only by the
    /// probe's injected root store).
    fn launch_test_gateway(
        upstream_port: u16,
    ) -> (crate::gateway::GatewayHandle, rustls::RootCertStore) {
        let ca_key = rcgen::KeyPair::generate().unwrap();
        let mut ca_params = rcgen::CertificateParams::new(Vec::<String>::new()).unwrap();
        ca_params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        ca_params
            .distinguished_name
            .push(rcgen::DnType::CommonName, "PNDS Entry Test CA");
        let ca = ca_params.self_signed(&ca_key).unwrap();
        let leaf_key = rcgen::KeyPair::generate().unwrap();
        let mut leaf_params =
            rcgen::CertificateParams::new(vec!["entry.test".to_string()]).unwrap();
        leaf_params
            .distinguished_name
            .push(rcgen::DnType::CommonName, "entry.test");
        let leaf = leaf_params.signed_by(&leaf_key, &ca, &ca_key).unwrap();
        let mut roots = rustls::RootCertStore::empty();
        roots.add(ca.der().clone()).unwrap();
        let handle = crate::gateway::start_gateway(
            crate::gateway::GatewayConfig {
                bind_addr: "127.0.0.1:0".parse().unwrap(),
                upstream: format!("127.0.0.1:{upstream_port}").parse().unwrap(),
                chain: vec![leaf.der().clone()],
                key: webpki::types::PrivateKeyDer::Pkcs8(leaf_key.serialize_der().into()),
                max_connections: crate::gateway::MAX_CONNECTIONS,
            },
            Arc::new(|_| {}),
        )
        .unwrap();
        (handle, roots)
    }

    #[test]
    fn entry_supervisor_publishes_ready_through_a_real_gateway() {
        let app = tauri::test::mock_app().handle().clone();
        crate::events::events_builder().mount_events(&app);
        let manager = SessionManager::default();

        let upstream_port = spawn_health_responder();
        let (gateway, probe_roots) = launch_test_gateway(upstream_port);
        let probe_addr = gateway.local_addr();

        let generation = {
            let mut inner = manager.lock();
            inner.generation += 1;
            inner.status = SessionStatus::Ready;
            inner.gateway = Some(gateway);
            inner.https_entry = HttpsEntryState {
                status: HttpsEntryStatus::Preparing,
                url: Some("https://entry.test:8443/".to_string()),
                error: None,
            };
            inner.generation
        };
        manager.spawn_entry_supervisor(
            app.clone(),
            generation,
            probe_addr,
            "entry.test".to_string(),
            probe_roots,
        );

        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let status = manager.lock().https_entry.status;
            if status == HttpsEntryStatus::Ready {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "entry never became ready (status: {status:?})"
            );
            std::thread::sleep(Duration::from_millis(100));
        }
        let snapshot = manager.snapshot();
        assert_eq!(snapshot.https_entry.status, HttpsEntryStatus::Ready);
        assert_eq!(
            snapshot.https_entry.url.as_deref(),
            Some("https://entry.test:8443/")
        );

        manager.stop(&app).unwrap();
        let snapshot = manager.snapshot();
        assert_eq!(snapshot.https_entry.status, HttpsEntryStatus::Off);
        assert!(snapshot.https_entry.url.is_none());
        // The listener really is gone.
        let mut refused = false;
        for _ in 0..20 {
            if std::net::TcpStream::connect_timeout(&probe_addr, Duration::from_millis(200))
                .is_err()
            {
                refused = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(refused, "stop must release the entry port");
    }

    #[test]
    fn dns_mapping_resolution_matrix() {
        // The gate: service switch × the entry actually launching this
        // start. Domain/IP arrive from the entry launch; the daemon's
        // reachability is checked at install time, not here.
        let on = entry_prefs(Some(true), Some("show.example.org"), Some(8443));
        let dns_on = crate::types::AppPreferences {
            dns_enabled: Some(true),
            ..Default::default()
        };
        let dns_off = crate::types::AppPreferences {
            dns_enabled: Some(false),
            ..Default::default()
        };
        let launch = EntryLaunch {
            url: "https://show.example.org:8443/".to_string(),
            domain: "show.example.org".to_string(),
            port: 8443,
            chain: Vec::new(),
            key: webpki::types::PrivateKeyDer::Pkcs8(vec![].into()),
        };
        // Switch off (either knob) → no mapping, whatever else says.
        assert!(resolve_dns_mapping(&dns_off, Some(&launch)).is_none());
        assert!(resolve_dns_mapping(&on, None).is_none());
        // Switch on × entry launching → the entry's domain.
        assert_eq!(
            resolve_dns_mapping(&dns_on, Some(&launch)).as_deref(),
            Some("show.example.org")
        );
        // Switch unset (never touched) → off.
        assert!(
            resolve_dns_mapping(&crate::types::AppPreferences::default(), Some(&launch)).is_none()
        );
    }

    #[test]
    fn dns_mapping_failure_is_reported_without_failing_the_session() {
        let app = tauri::test::mock_app().handle().clone();
        crate::events::events_builder().mount_events(&app);
        let manager = SessionManager::default();
        let (generation, inner) = {
            let mut guard = manager.lock();
            guard.generation += 1;
            guard.status = SessionStatus::Ready;
            guard.dns_mapping = DnsMappingState {
                status: DnsMappingStatus::Ready,
                domain: Some("show.example.org".to_string()),
                ip: Some("192.168.11.31".to_string()),
                error: None,
            };
            (guard.generation, Arc::clone(&manager.inner))
        };
        // A lease-renewal fault flips ONLY the mapping state — the
        // session stays exactly where it was.
        SessionManager::mark_dns_mapping_failure(
            &app,
            &inner,
            generation,
            "lease refresh refused".to_string(),
        );
        let snapshot = manager.snapshot();
        assert_eq!(snapshot.status, SessionStatus::Ready);
        assert_eq!(snapshot.dns_mapping.status, DnsMappingStatus::Error);
        assert_eq!(
            snapshot.dns_mapping.error.as_deref(),
            Some("lease refresh refused")
        );
        // A stale generation's late report must not touch the new run.
        let (new_generation, inner) = {
            let mut guard = manager.lock();
            guard.generation += 1;
            guard.dns_mapping = DnsMappingState::default();
            (guard.generation, Arc::clone(&manager.inner))
        };
        SessionManager::mark_dns_mapping_failure(
            &app,
            &inner,
            generation,
            "stale report".to_string(),
        );
        let snapshot = manager.snapshot();
        assert_eq!(snapshot.dns_mapping.status, DnsMappingStatus::Off);
        let _ = new_generation;
    }

    #[test]
    fn stop_clears_the_dns_mapping_snapshot_and_holders_record() {
        let app = tauri::test::mock_app().handle().clone();
        crate::events::events_builder().mount_events(&app);
        let manager = SessionManager::default();
        {
            let mut guard = manager.lock();
            guard.generation += 1;
            guard.status = SessionStatus::Ready;
            guard.dns_mapping = DnsMappingState {
                status: DnsMappingStatus::Ready,
                domain: Some("show.example.org".to_string()),
                ip: Some("192.168.11.31".to_string()),
                error: None,
            };
            guard.dns_mapping_generation = Some(guard.generation);
        }
        // Stop revokes daemon-side (the daemon is absent here — the lease
        // bounds any residue) and clears the session's reported state.
        manager.stop(&app).unwrap();
        let snapshot = manager.snapshot();
        assert_eq!(snapshot.status, SessionStatus::Idle);
        assert_eq!(snapshot.dns_mapping.status, DnsMappingStatus::Off);
        let guard = manager.lock();
        assert!(guard.dns_mapping_generation.is_none());
    }

    #[test]
    fn remove_mapping_without_a_daemon_is_quiet() {
        // The daemon is absent in tests: revocation must be a quiet
        // no-op (the lease bounds any residue) — never a panic, never a
        // teardown failure.
        crate::dns::remove_mapping(7);
    }

    #[test]
    fn fail_generation_returns_the_entry_to_off() {
        let app = tauri::test::mock_app().handle().clone();
        crate::events::events_builder().mount_events(&app);
        let manager = SessionManager::default();
        let inner = {
            let mut guard = manager.lock();
            guard.generation += 1;
            guard.status = SessionStatus::Starting;
            guard.https_entry = HttpsEntryState {
                status: HttpsEntryStatus::Preparing,
                url: Some("https://entry.test:8443/".to_string()),
                error: None,
            };
            Arc::clone(&manager.inner)
        };
        let generation = {
            let guard = manager.lock();
            guard.generation
        };
        SessionManager::fail_generation(&app, &inner, generation, "boom".to_string());
        let snapshot = manager.snapshot();
        assert_eq!(snapshot.status, SessionStatus::Error);
        assert_eq!(snapshot.https_entry.status, HttpsEntryStatus::Off);
        assert!(snapshot.https_entry.url.is_none());
    }

    #[test]
    fn runtime_entry_failure_is_reported_without_failing_the_session() {
        let app = tauri::test::mock_app().handle().clone();
        crate::events::events_builder().mount_events(&app);
        let manager = SessionManager::default();
        let (generation, inner) = {
            let mut guard = manager.lock();
            guard.generation += 1;
            guard.status = SessionStatus::Ready;
            guard.https_entry = HttpsEntryState {
                status: HttpsEntryStatus::Preparing,
                url: Some("https://entry.test:8443/".to_string()),
                error: None,
            };
            (guard.generation, Arc::clone(&manager.inner))
        };
        SessionManager::mark_entry_failure(
            &app,
            &inner,
            generation,
            "The HTTPS entry did not become reachable".to_string(),
        );
        let snapshot = manager.snapshot();
        // The session lives on; only the entry reports the fault.
        assert_eq!(snapshot.status, SessionStatus::Ready);
        assert_eq!(snapshot.https_entry.status, HttpsEntryStatus::Error);
        assert_eq!(
            snapshot.https_entry.error.as_deref(),
            Some("The HTTPS entry did not become reachable")
        );
        // The URL survives the fault — it is still the entry's origin
        // (the operator decides how to recover; no silent HTTP swap).
        assert_eq!(
            snapshot.https_entry.url.as_deref(),
            Some("https://entry.test:8443/")
        );

        // A stale generation's late report changes nothing.
        SessionManager::mark_entry_failure(&app, &inner, generation + 5, "late".to_string());
        assert_eq!(
            manager.snapshot().https_entry.error.as_deref(),
            Some("The HTTPS entry did not become reachable")
        );
    }
}
