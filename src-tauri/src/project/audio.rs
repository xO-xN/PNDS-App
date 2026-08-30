//! scsynth process management, OSC control, and the App master stage.
//! See `docs/zh-CN/reference/runtime-contract.md` §7, §8 and the App-side
//! audio host rules in `docs/developer/app-behavior.md` (音频 Host 行为).
//!
//! Signal path (internal mode, §7.3/§7.4):
//!   project synths → private buses B..B+N-1 → K mono pndsMaster instances
//!   in the App master group (gain) → hardware buses 0..K-1

use rosc::{OscMessage, OscPacket, OscType};
use serde::Serialize;
use specta::Type;
use std::io::{BufRead, BufReader};
use std::net::UdpSocket;
use std::os::unix::process::ExitStatusExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crate::project::manifest::ScsynthConfig;
use crate::types::AppPreferences;

/// §7.6: one CoreAudio output device and what it can do at the project's
/// sample rate. `maxOutputChannels` is 0 when no configuration of the
/// device supports that rate.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputDevice {
    pub name: String,
    pub is_default: bool,
    pub max_output_channels: u32,
}

/// §7.6: sample-rate-aware device capabilities (name = scsynth -H value).
#[derive(Debug, Clone, Default, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceCapabilities {
    pub devices: Vec<AudioOutputDevice>,
    pub sample_rate: u32,
}

/// §7.1: device capability resolved for one Internal start.
pub struct DeviceCapability {
    /// Final output device (the selected one, or the system default).
    pub name: String,
    /// H: output channels usable at the project sample rate.
    pub channels: u32,
}

/// §7.1: the Internal channel plan computed at session start.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPlan {
    /// N: discrete signals the project produces (manifest audio.outputChannels).
    pub project_channels: u32,
    /// H: channels the output device offers at the project sample rate.
    pub device_channels: u32,
    /// K: channels actually bridged to hardware, min(N, H).
    pub bridged_channels: u32,
    /// B: first private project bus; equals K.
    pub private_bus_start: u32,
}

/// §7.1: N/H/K/B. A channel-poor device (H < N) is bridged partially —
/// never an error.
pub fn channel_plan(project_channels: u32, device_channels: u32) -> ChannelPlan {
    let k = project_channels.min(device_channels);
    ChannelPlan {
        project_channels,
        device_channels,
        bridged_channels: k,
        private_bus_start: k,
    }
}

/// Process-global cache of the last device enumeration, keyed by sample
/// rate. Preflight and session start both enumerate the same devices at
/// the same rates; caching skips the repeated cpal/CoreAudio walk
/// (~0.5–1s) from the start critical path. Devices are hot-pluggable, so
/// the cache is one entry and cleared on every call to the frontend's
/// listing command (see `refresh_output_devices`).
static DEVICE_CACHE: std::sync::Mutex<Option<(u32, AudioDeviceCapabilities)>> =
    std::sync::Mutex::new(None);

/// §7.6: enumerate CoreAudio output devices via cpal, computing each
/// device's usable output channel count at the project's sample rate.
/// Channel counts come from supported stream configs only — never from
/// parsing scsynth logs. Cached per sample rate.
pub fn list_output_devices(sample_rate: u32) -> Result<AudioDeviceCapabilities, String> {
    if let Ok(guard) = DEVICE_CACHE.lock() {
        if let Some((cached_rate, cached)) = guard.as_ref() {
            if *cached_rate == sample_rate {
                return Ok(cached.clone());
            }
        }
    }
    let result = enumerate_output_devices(sample_rate);
    if let Ok(caps) = &result {
        if let Ok(mut guard) = DEVICE_CACHE.lock() {
            *guard = Some((sample_rate, caps.clone()));
        }
    }
    result
}

/// §7.6: force a fresh enumeration (frontend device list must see
/// hot-plugged devices).
pub fn refresh_output_devices(sample_rate: u32) -> Result<AudioDeviceCapabilities, String> {
    if let Ok(mut guard) = DEVICE_CACHE.lock() {
        *guard = None;
    }
    list_output_devices(sample_rate)
}

/// The uncached cpal walk.
fn enumerate_output_devices(sample_rate: u32) -> Result<AudioDeviceCapabilities, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let default_name = host.default_output_device().map(|d| d.to_string());
    let mut devices = Vec::new();
    for device in host
        .output_devices()
        .map_err(|e| format!("Failed to enumerate audio output devices: {e}"))?
    {
        let name = device.to_string();
        match device.supported_output_configs() {
            Ok(ranges) => {
                let channels = select_max_channels(
                    ranges.map(|r| (r.min_sample_rate(), r.max_sample_rate(), r.channels())),
                    sample_rate,
                );
                devices.push(AudioOutputDevice {
                    is_default: default_name.as_deref() == Some(name.as_str()),
                    name,
                    max_output_channels: channels,
                });
            }
            Err(e) => {
                log::warn!("Skipping output device \"{name}\": {e}");
            }
        }
    }
    if devices.is_empty() {
        return Err("No audio output devices found.".to_string());
    }
    Ok(AudioDeviceCapabilities {
        devices,
        sample_rate,
    })
}

/// §7.6: max output channels among the configs supporting `sample_rate`.
/// `ranges` are (min sample rate, max sample rate, channels) tuples.
/// Pure so the selection rule is testable without audio hardware.
pub fn select_max_channels(
    ranges: impl IntoIterator<Item = (u32, u32, u16)>,
    sample_rate: u32,
) -> u32 {
    ranges
        .into_iter()
        .filter(|(min, max, _)| *min <= sample_rate && sample_rate <= *max)
        .map(|(_, _, channels)| u32::from(channels))
        .max()
        .unwrap_or(0)
}

/// Issue #21: the discrete sample rates the Settings Audio section offers.
/// CoreAudio config ranges are continuous (e.g. 44.1k–96k), so the offered
/// list is the standard rates that fall inside some device's supported
/// range — never every integer rate of the range. Also the fallback list
/// when enumeration fails or finds nothing.
pub const STANDARD_SAMPLE_RATES: [u32; 4] = [44_100, 48_000, 88_200, 96_000];

/// Issue #21: the union of standard rates covered by any supported config
/// range, deduplicated and ascending (by construction — `STANDARD_SAMPLE_
/// RATES` is a sorted set). `ranges` are (min, max) pairs across all
/// enumerated output devices. `None` when no range covers any standard
/// rate; the caller falls back to the full standard list.
/// Pure so the union rule is testable without audio hardware.
pub fn supported_standard_rates(ranges: impl IntoIterator<Item = (u32, u32)>) -> Option<Vec<u32>> {
    let ranges: Vec<(u32, u32)> = ranges.into_iter().collect();
    let covered: Vec<u32> = STANDARD_SAMPLE_RATES
        .into_iter()
        .filter(|rate| ranges.iter().any(|(min, max)| min <= rate && rate <= max))
        .collect();
    (!covered.is_empty()).then_some(covered)
}

/// Issue #21: sample rates offered by the Settings Audio section — the
/// standard rates supported by at least one enumerated output device, or
/// the full standard list when enumeration fails or the union is empty.
/// Hot-pluggable devices must be seen, so this always walks cpal fresh.
pub fn supported_sample_rates() -> Vec<u32> {
    let ranges = enumerate_config_ranges().unwrap_or_default();
    supported_standard_rates(ranges).unwrap_or_else(|| STANDARD_SAMPLE_RATES.to_vec())
}

/// The uncached (min, max) range of every config of every output device.
fn enumerate_config_ranges() -> Result<Vec<(u32, u32)>, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let mut ranges = Vec::new();
    for device in host
        .output_devices()
        .map_err(|e| format!("Failed to enumerate audio output devices: {e}"))?
    {
        match device.supported_output_configs() {
            Ok(configs) => {
                ranges.extend(configs.map(|r| (r.min_sample_rate(), r.max_sample_rate())));
            }
            Err(e) => {
                log::warn!("Skipping output device \"{device}\": {e}");
            }
        }
    }
    Ok(ranges)
}

/// §7.1/§7.6: resolve H for the selected (or system default) device.
/// Missing capability or zero usable channels fails Internal startup with a
/// diagnosable error; a channel-poor device (H < N) is NOT an error.
///
/// Pure form over an already-enumerated list.
pub fn resolve_in_list(
    list: &AudioDeviceCapabilities,
    device: Option<&str>,
) -> Result<DeviceCapability, String> {
    let found = match device {
        Some(name) => list
            .devices
            .iter()
            .find(|d| d.name == name)
            .ok_or_else(|| {
                format!(
                    "Output device \"{name}\" is not available at {} Hz",
                    list.sample_rate
                )
            })?,
        None => list
            .devices
            .iter()
            .find(|d| d.is_default)
            .ok_or("No system default output device is available")?,
    };
    if found.max_output_channels == 0 {
        return Err(format!(
            "Output device \"{}\" has no output channels at {} Hz",
            found.name, list.sample_rate
        ));
    }
    Ok(DeviceCapability {
        name: found.name.clone(),
        channels: found.max_output_channels,
    })
}

/// §7.4: scsynth node IDs are a shared namespace; the upper part of the
/// i32 range is reserved for the App master stage (contract §7.4:
/// `2147480000..=2147483647` = `..=i32::MAX`). Projects must never use it.
pub const RESERVED_NODE_ID_MIN: i32 = 2_147_480_000;
/// Documented reserved-range upper bound (i32::MAX per contract §7.4);
/// referenced by the node-ID tests.
#[allow(dead_code)]
pub const RESERVED_NODE_ID_MAX: i32 = i32::MAX;
/// Node ID of the App master group.
pub const MASTER_GROUP_ID: i32 = RESERVED_NODE_ID_MIN;
/// Node ID of master instance `i` is `MASTER_NODE_BASE + i`.
pub const MASTER_NODE_BASE: i32 = RESERVED_NODE_ID_MIN + 1;
/// §3.3/spec: outputChannels (and therefore K) never exceeds 64.
pub const MAX_MASTER_INSTANCES: u32 = 64;

pub const MASTER_SYNTHDEF_NAME: &str = "pndsMaster";
pub const DEFAULT_VOLUME_PERCENT: f32 = 80.0;

const SCSYNTH_BOOT_TIMEOUT: Duration = Duration::from_secs(10);
const OSC_REPLY_TIMEOUT: Duration = Duration::from_millis(1500);
/// Issue #92 (+2026-08-30 field revision): session-start retries for a
/// transient scsynth boot crash. Raised from 1 to 3 after field
/// measurement — a machine in a crash storm showed a 53% per-spawn death
/// rate, where one retry still leaves a ~28% chance of back-to-back
/// failures; three retries bring the residual error-page rate to ~8%.
pub const SESSION_BOOT_TRANSIENT_RETRIES: u32 = 3;
/// Issue #92: launch-prewarm retries (silent, same transient gate only).
/// Matches the session budget so a stormy boot leaves the subsystem warm.
const PREWARM_BOOT_TRANSIENT_RETRIES: u32 = 3;
/// Issue #92: settle delay before each transient retry — the crash itself
/// is instant, the delay just lets the dead process's resources settle so
/// the fresh spawn starts clean.
pub const TRANSIENT_RETRY_DELAY: Duration = Duration::from_millis(750);
/// 2026-08-30 field revision: how many of a dead boot attempt's last
/// output lines are kept in the `BootFailure` for the session log — the
/// ObjC runtime's own corruption diagnostics land at the END of the
/// output, after the CoreAudio device list.
const CRASH_OUTPUT_TAIL: usize = 8;

/// Locates the bundled scsynth binary. V1 is Apple Silicon only.
pub fn scsynth_binary_path() -> Result<PathBuf, String> {
    const TRIPLE: &str = "aarch64-apple-darwin";
    let name = format!("scsynth-{TRIPLE}");

    // 1. Bundled resource: Contents/Resources/scsynth. Keeping scsynth out
    // of Contents/MacOS prevents LaunchServices from registering it as a
    // second foreground application with the PNDS Dock icon.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("../Resources/scsynth");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    // 2. Development fallback: src-tauri/binaries (raw fetched binary, still
    // named with the target-triple suffix as `scripts/fetch-scsynth.sh` leaves it).
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(&name);
    if dev.is_file() {
        return Ok(dev);
    }
    Err("Embedded scsynth not found.\nRun `npm run scsynth:fetch` and try again.".to_string())
}

/// Locates the master synth definition artifact (built by
/// `npm run synthdefs:build`; bundled as a resource).
pub fn master_synthdef_path() -> Result<PathBuf, String> {
    // 1. Bundled resource: <Resources>/synthdefs/pndsMaster.scsyndef
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir
                .join("../Resources/synthdefs/pndsMaster.scsyndef")
                .canonicalize()
                .unwrap_or_else(|_| dir.join("../Resources/synthdefs/pndsMaster.scsyndef"));
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }
    // 2. Development: src-tauri/resources/synthdefs
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/synthdefs/pndsMaster.scsyndef");
    if dev.exists() {
        return Ok(dev);
    }
    Err("pndsMaster.scsyndef not found.\nRun `npm run synthdefs:build` and try again.".to_string())
}

/// Locates the bundled UGen plugins directory (passed via -U so the App
/// never depends on the host's SuperCollider installation.
pub fn plugins_dir() -> Result<PathBuf, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("../Resources/plugins");
            if candidate.is_dir() {
                return Ok(candidate);
            }
        }
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("plugins");
    if dev.is_dir() {
        return Ok(dev);
    }
    Err("UGen plugins not found.\nRun `npm run scsynth:fetch` and try again.".to_string())
}

/// Issue #20: the scsynth config the session actually runs with. The App's
/// global sample-rate preference is the sole audio authority — a legacy
/// `audio.scsynth.sampleRate` still present in the manifest is read and
/// ignored; block size and bus channels still come from the manifest.
/// Pure so the preference → `-S` flow is testable without spawning.
pub fn with_effective_sample_rate(cfg: &ScsynthConfig, prefs: &AppPreferences) -> ScsynthConfig {
    ScsynthConfig {
        sample_rate: prefs.effective_sample_rate(),
        ..cfg.clone()
    }
}

/// §7.2: the exact scsynth command line. `-o` opens K hardware output
/// channels (the session-computed value, never a hardcoded 2). Pure so the
/// flags are testable without spawning a process.
pub fn scsynth_args(
    cfg: &ScsynthConfig,
    hw_output_channels: u32,
    port: u16,
    plugins: &Path,
    device: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "-i".to_string(),
        "0".to_string(),
        "-o".to_string(),
        hw_output_channels.to_string(),
        "-S".to_string(),
        cfg.sample_rate.to_string(),
        "-z".to_string(),
        cfg.block_size.to_string(),
        "-a".to_string(),
        cfg.audio_bus_channels.to_string(),
        "-u".to_string(),
        port.to_string(),
        "-B".to_string(),
        "127.0.0.1".to_string(),
        "-U".to_string(),
        plugins.to_string_lossy().into_owned(),
    ];
    if let Some(name) = device {
        args.extend(["-H".to_string(), name.to_string()]);
    }
    args
}

/// Spawns scsynth with the §7.2 flags and returns the child (stdout/stderr
/// are wired into the session output tail by the caller). `device` selects
/// the output via -H (app-behavior「音频 Host 行为」); None uses the system default.
///
/// We bundle SC 3.14.x because 3.13's -H opened devices for input even with
/// `-i 0`, which broke output-only devices (built-in speakers, TVs). The
/// upstream guard on `mNumInputs > 0` in 3.14 lets any CoreAudio device work.
pub fn spawn_scsynth(
    binary: &Path,
    cfg: &ScsynthConfig,
    hw_output_channels: u32,
    port: u16,
    plugins: &Path,
    device: Option<&str>,
) -> Result<Child, String> {
    Command::new(binary)
        .args(scsynth_args(cfg, hw_output_channels, port, plugins, device))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start scsynth: {e}"))
}

/// Issue #92, revised 2026-08-30 after field measurement: the
/// transient-crash gate. The bundled scsynth 3.14.1 rolls the dice on
/// every spawn on macOS 26 — an ObjC runtime corruption race (observed
/// frames: AVAudioSession/objc_initWeak, `_objc_fatalv`, method-cache
/// insert, SCSession symbol interning) that kills the process by signal
/// (SIGTRAP / SIGABRT / SIGSEGV).
///
/// The original #92 gate additionally required ZERO output. Field
/// measurement falsified that premise: on a machine with 12 audio
/// devices, every crashed spawn had already printed the 24-line CoreAudio
/// device list to stdout, and SIGABRT deaths carry the ObjC runtime's own
/// diagnostics ("bad weak table", "Method cache corrupted") on unbuffered
/// stderr — so no real transient crash can ever present zero output, and
/// the retry never fired. The gate is now SIGNAL DEATH alone: every
/// signal-terminated boot is a per-spawn dice roll worth retrying, while
/// the real failures the zero-output clause existed to protect stay
/// excluded — a configuration error (e.g. an output device rejected by
/// `-H`) prints its error and exits CLEANLY (exit code, no signal), and a
/// boot timeout never exits at all. Pure so every shape (signals × exit
/// codes × timeout) is table-testable.
fn is_transient_boot_crash(exit: Option<&ExitStatus>) -> bool {
    matches!(exit, Some(status) if status.signal().is_some())
}

/// Issue #92: how a failed /status boot wait ended. The retry gate needs
/// the failure's shape, not just a display message.
#[derive(Debug)]
pub enum BootWaitFailure {
    /// The child exited during the wait — by exit code or by signal. Only
    /// the signal form can pass the transient-crash gate.
    Exited(ExitStatus),
    /// The child stayed alive but never answered /status in time.
    TimedOut,
    /// The OSC probe itself failed (send/connect error); not retryable.
    Osc(String),
}

impl BootWaitFailure {
    /// The error-page wording — unchanged from the pre-retry behavior.
    pub fn message(&self) -> String {
        match self {
            Self::Exited(status) => {
                format!("Audio engine exited during startup ({status}). See output below.")
            }
            Self::TimedOut => {
                "Audio engine failed to start (scsynth did not answer /status in time).".to_string()
            }
            Self::Osc(e) => e.clone(),
        }
    }
}

/// Issue #92: one failed scsynth boot attempt — the unchanged error-page
/// message, the transient-gate input, and what the dead child printed
/// (the blind spot of the first field diagnosis: a failed boot's output
/// used to be counted and discarded, so no log ever showed what a crashed
/// scsynth said).
#[derive(Debug)]
pub struct BootFailure {
    /// Exact error-page wording (the retry policy must not mask or reword
    /// real failures).
    pub message: String,
    /// The child's exit status when it died during the boot wait; `None`
    /// for a timeout or a failure before/without a child exit.
    pub exit: Option<ExitStatus>,
    /// stdout + stderr lines the dead child left in its pipes (for the
    /// log line's shape description).
    pub output_lines: usize,
    /// The last `CRASH_OUTPUT_TAIL` of those lines — the ObjC runtime's
    /// corruption diagnostics land here, after the device list.
    pub output_tail: Vec<String>,
}

impl BootFailure {
    /// A failure with no child exit to inspect (port/spawn/OSC) — never
    /// transient-retryable.
    pub fn other(message: String) -> Self {
        Self {
            message,
            exit: None,
            output_lines: 0,
            output_tail: Vec::new(),
        }
    }

    /// Issue #92 gate (2026-08-30 revision): signal death.
    pub fn is_transient_crash(&self) -> bool {
        is_transient_boot_crash(self.exit.as_ref())
    }

    /// One-line description for the retry log lines — the crash rate these
    /// capture is the evidence base for the future scsynth binary upgrade
    /// decision (issue #92).
    pub fn describe(&self) -> String {
        let death = match self.exit.as_ref().and_then(|s| s.signal()) {
            Some(signal) => format!("signal {signal}"),
            None if self.exit.is_some() => "exited without a signal".to_string(),
            None => "no exit (timeout)".to_string(),
        };
        format!("{death}, {} output lines", self.output_lines)
    }
}

/// Issue #92: reduces a failed /status wait to the gate's input plus the
/// dead child's output, draining its pipes to EOF. Only an exited
/// (already reaped) child is drained — reading a live child's pipe would
/// block until its next output.
pub fn classify_boot_failure(wait: &BootWaitFailure, child: &mut Child) -> BootFailure {
    let exit = match wait {
        BootWaitFailure::Exited(status) => Some(*status),
        _ => None,
    };
    let (output_lines, output_tail) = if exit.is_some() {
        let lines = drain_output_lines(child);
        let count = lines.len();
        let tail = if count > CRASH_OUTPUT_TAIL {
            lines[count - CRASH_OUTPUT_TAIL..].to_vec()
        } else {
            lines
        };
        (count, tail)
    } else {
        (0, Vec::new())
    };
    BootFailure {
        message: wait.message(),
        exit,
        output_lines,
        output_tail,
    }
}

/// Collects the lines a dead child left in its pipes: both write ends
/// close with the reaped process, so reading runs to EOF after the
/// buffered output (a trailing unterminated chunk still counts as one
/// line). stdout then stderr — cross-stream ordering is unrecoverable,
/// but the tail (stderr diagnostics after the stdout device list) is what
/// matters.
fn drain_output_lines(child: &mut Child) -> Vec<String> {
    fn drain_pipe(pipe: impl std::io::Read, lines: &mut Vec<String>) {
        for line in BufReader::new(pipe).lines() {
            match line {
                Ok(line) => lines.push(line),
                Err(_) => break,
            }
        }
    }
    let mut lines = Vec::new();
    if let Some(pipe) = child.stdout.take() {
        drain_pipe(pipe, &mut lines);
    }
    if let Some(pipe) = child.stderr.take() {
        drain_pipe(pipe, &mut lines);
    }
    lines
}

/// Issue #92: the shared transient-crash retry policy. Runs boot attempts,
/// retrying ONLY the transient signature (signal death — a per-spawn dice
/// roll, so an immediate fresh spawn is the correct recovery) at most
/// `retries` times. Any other failure — and any failure once the retries
/// are spent — surfaces immediately: real errors must reach the error page
/// unmasked. `on_retry` fires on every accepted retry (the logging seam).
/// Session start and the launch prewarm both pass 3 retries (a 53%
/// crash-storm spawn rate leaves ~8% residual after 3 retries).
pub fn boot_with_transient_retries<T>(
    retries: u32,
    retry_delay: Duration,
    mut boot: impl FnMut() -> Result<T, BootFailure>,
    mut on_retry: impl FnMut(&BootFailure),
) -> Result<T, BootFailure> {
    let mut attempt = 0;
    loop {
        if attempt > 0 {
            std::thread::sleep(retry_delay);
        }
        attempt += 1;
        match boot() {
            Ok(booted) => return Ok(booted),
            Err(failure) => {
                if failure.is_transient_crash() && attempt <= retries {
                    on_retry(&failure);
                    continue;
                }
                return Err(failure);
            }
        }
    }
}

/// Whether the audio subsystem has been prewarmed this run (process-global,
/// set by the background prewarm thread, read by session start to shorten
/// the first-boot delay when the warm-up already succeeded).
static PREWARMED: AtomicBool = AtomicBool::new(false);

/// True if `prewarm_scsynth` completed successfully this run.
pub fn is_audio_prewarmed() -> bool {
    PREWARMED.load(Ordering::SeqCst)
}

/// §7.2 prewarm: boot scsynth once in the background and quit it, so
/// coreaudiod's one-time audio-session initialization (which can crash on
/// the first request after launch) happens while the user is still on the
/// welcome screen — the first real session load then boots scsynth on a
/// warm audio subsystem instead of paying the cold-start cost.
///
/// Issue #92: the boot itself rolls the same transient-crash dice as any
/// other spawn, so the prewarm retries through the shared gate — up to
/// `PREWARM_BOOT_TRANSIENT_RETRIES` (3) retries, transient signature only,
/// fully silent, and the prewarm flag is set only after a boot actually
/// succeeded. Real failures give up silently; the session-start path
/// surfaces any real failure to the error page.
pub fn prewarm_scsynth() {
    std::thread::spawn(|| {
        let Ok(binary) = scsynth_binary_path() else {
            return;
        };
        let Ok(plugins) = plugins_dir() else {
            return;
        };
        let cfg = ScsynthConfig {
            sample_rate: 48_000,
            block_size: 64,
            audio_bus_channels: 128,
        };
        let prewarmed = boot_with_transient_retries(
            PREWARM_BOOT_TRANSIENT_RETRIES,
            TRANSIENT_RETRY_DELAY,
            || {
                let port =
                    crate::project::session::allocate_udp_port().map_err(BootFailure::other)?;
                let mut child = spawn_scsynth(&binary, &cfg, 2, port, &plugins, None)
                    .map_err(BootFailure::other)?;
                let wait = match OscClient::connect(&format!("127.0.0.1:{port}")) {
                    Ok(client) => wait_for_scsynth(&client, &mut child),
                    Err(e) => Err(BootWaitFailure::Osc(e)),
                };
                let result =
                    wait.map_err(|wait_failure| classify_boot_failure(&wait_failure, &mut child));
                let _ = child.kill();
                let _ = child.wait();
                result
            },
            |failure| {
                log::info!(
                    "Prewarm: scsynth transient startup crash ({}); retrying",
                    failure.describe()
                );
            },
        );
        if prewarmed.is_ok() {
            PREWARMED.store(true, Ordering::SeqCst);
            log::info!("Audio subsystem prewarmed (scsynth booted and quit)");
        }
    });
}

// ============================================================================
// Minimal OSC client (UDP, blocking with timeouts)
// ============================================================================

pub struct OscClient {
    socket: UdpSocket,
}

impl OscClient {
    pub fn connect(target: &str) -> Result<Self, String> {
        let socket = UdpSocket::bind("127.0.0.1:0")
            .map_err(|e| format!("Failed to create OSC socket: {e}"))?;
        socket
            .connect(target)
            .map_err(|e| format!("Failed to connect OSC socket to {target}: {e}"))?;
        socket
            .set_read_timeout(Some(Duration::from_millis(250)))
            .map_err(|e| format!("Failed to configure OSC socket: {e}"))?;
        Ok(Self { socket })
    }

    pub fn send(&self, msg: OscMessage) -> Result<(), String> {
        let bytes = rosc::encoder::encode(&OscPacket::Message(msg))
            .map_err(|e| format!("Failed to encode OSC message: {e}"))?;
        self.socket
            .send(&bytes)
            .map_err(|e| format!("Failed to send OSC message: {e}"))?;
        Ok(())
    }

    /// Waits for a message whose address matches `address` (e.g. "/done",
    /// "/synced", "/status.reply"), returning it and ignoring other packets
    /// until timeout.
    fn wait_for_msg(&self, address: &str, timeout: Duration) -> Result<OscMessage, String> {
        let deadline = Instant::now() + timeout;
        let mut buf = [0u8; 8192];
        loop {
            match self.socket.recv(&mut buf) {
                Ok(n) => {
                    if let Ok((_remaining, OscPacket::Message(msg))) =
                        rosc::decoder::decode_udp(&buf[..n])
                    {
                        if msg.addr == address {
                            return Ok(msg);
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(e) => return Err(format!("OSC receive failed: {e}")),
            }
            if Instant::now() >= deadline {
                return Err(format!("Timed out waiting for {address} from scsynth"));
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Like `wait_for_msg` but discards the payload (presence check only).
    fn wait_for(&self, address: &str, timeout: Duration) -> Result<(), String> {
        self.wait_for_msg(address, timeout).map(|_| ())
    }
}

/// §8 step 4: wait until scsynth answers /status (it is fully booted).
/// Fails fast when the process exits during boot (e.g. an output-only
/// device rejected by -H) instead of waiting out the full timeout. The
/// failure carries its shape (issue #92) — exit status vs timeout — so the
/// caller can classify it for the transient-crash gate.
pub fn wait_for_scsynth(client: &OscClient, child: &mut Child) -> Result<(), BootWaitFailure> {
    let deadline = Instant::now() + SCSYNTH_BOOT_TIMEOUT;
    loop {
        client
            .send(OscMessage {
                addr: "/status".to_string(),
                args: vec![],
            })
            .map_err(BootWaitFailure::Osc)?;
        if client
            .wait_for("/status.reply", Duration::from_millis(500))
            .is_ok()
        {
            return Ok(());
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(BootWaitFailure::Exited(status));
        }
        if Instant::now() >= deadline {
            return Err(BootWaitFailure::TimedOut);
        }
    }
}

/// §7.4: (node ID, input bus, hardware output bus) for master instance `i`.
/// Instance `i` reads private bus `B + i` and writes hardware bus `i`.
/// Pure so the mapping and reserved-range invariant are testable.
pub fn master_instance_spec(k: u32, b: u32, i: u32) -> (i32, i32, i32) {
    debug_assert!(i < k && k <= MAX_MASTER_INSTANCES);
    (MASTER_NODE_BASE + i as i32, (b + i) as i32, i as i32)
}

/// §8 steps 8–9 (internal): load the mono pndsMaster SynthDef, create the
/// App master group at the tail of the root group (so it runs after the
/// project's pre-created audio root group), and create K mono instances
/// bridging private bus B+i to hardware bus i. Only returns Ok once the
/// server confirms all K instances exist; on any failure the partial stage
/// is freed before the error propagates (§8: session must fail cleanly).
pub fn create_master_stage(
    client: &OscClient,
    synthdef: &Path,
    k: u32,
    private_bus_start: u32,
    gain: f32,
) -> Result<(), String> {
    if k == 0 || k > MAX_MASTER_INSTANCES {
        return Err(format!(
            "Master stage needs 1..={MAX_MASTER_INSTANCES} instances, got {k}"
        ));
    }
    let result = create_master_stage_inner(client, synthdef, k, private_bus_start, gain);
    if result.is_err() {
        // Best effort: never leave a partial master stage behind.
        let _ = client.send(OscMessage {
            addr: "/n_free".to_string(),
            args: vec![OscType::Int(MASTER_GROUP_ID)],
        });
    }
    result
}

fn create_master_stage_inner(
    client: &OscClient,
    synthdef: &Path,
    k: u32,
    private_bus_start: u32,
    gain: f32,
) -> Result<(), String> {
    client.send(OscMessage {
        addr: "/d_load".to_string(),
        args: vec![OscType::String(synthdef.to_string_lossy().to_string())],
    })?;
    client
        .wait_for("/done", OSC_REPLY_TIMEOUT)
        .map_err(|e| format!("Failed to load {}: {e}", synthdef.display()))?;

    // Master group at the tail of the root group (addAction 1, target 0).
    client.send(OscMessage {
        addr: "/g_new".to_string(),
        args: vec![
            OscType::Int(MASTER_GROUP_ID),
            OscType::Int(1),
            OscType::Int(0),
        ],
    })?;

    for i in 0..k {
        let (node_id, in_bus, out_bus) = master_instance_spec(k, private_bus_start, i);
        client.send(OscMessage {
            addr: "/s_new".to_string(),
            args: vec![
                OscType::String(MASTER_SYNTHDEF_NAME.to_string()),
                OscType::Int(node_id),
                // addAction 1 = add to tail of the master group
                OscType::Int(1),
                OscType::Int(MASTER_GROUP_ID),
                OscType::String("in".to_string()),
                OscType::Int(in_bus),
                OscType::String("out".to_string()),
                OscType::Int(out_bus),
                OscType::String("gain".to_string()),
                OscType::Float(gain),
            ],
        })?;
    }

    // /sync confirms the queue was processed; the tree query below confirms
    // every instance actually exists (§8: ready requires all K confirmed).
    client.send(OscMessage {
        addr: "/sync".to_string(),
        args: vec![OscType::Int(1)],
    })?;
    client
        .wait_for("/synced", OSC_REPLY_TIMEOUT)
        .map_err(|e| format!("Master stage creation was not confirmed: {e}"))?;

    let instances = query_group_children(client, MASTER_GROUP_ID)
        .map_err(|e| format!("Master stage verification failed: {e}"))?;
    for i in 0..k {
        let (node_id, _, _) = master_instance_spec(k, private_bus_start, i);
        if !instances.contains(&node_id) {
            return Err(format!(
                "Master instance {i}/{k} (node {node_id}) was not created"
            ));
        }
    }
    log::info!(
        "Master stage ready (group {MASTER_GROUP_ID}, {k} mono instances, bus {private_bus_start}..{} -> hw 0..{}, gain={gain})",
        private_bus_start + k - 1,
        k - 1
    );
    Ok(())
}

/// Queries a group's direct child node IDs via /g_queryTree.
pub fn query_group_children(client: &OscClient, group_id: i32) -> Result<Vec<i32>, String> {
    client.send(OscMessage {
        addr: "/g_queryTree".to_string(),
        args: vec![OscType::Int(group_id), OscType::Int(0)],
    })?;
    let reply = client.wait_for_msg("/g_queryTree.reply", OSC_REPLY_TIMEOUT)?;
    // Reply layout: [flag, groupID, childCount, ...children]. Accept a
    // flagless form as a fallback (parsing the flagged form as flagless
    // fails cleanly because the "child count" would exceed the arg list).
    let args = reply.args.as_slice();
    let parsed = parse_query_tree(args.get(1..).unwrap_or(&[]))
        .filter(|(id, _)| *id == group_id)
        .or_else(|| parse_query_tree(args).filter(|(id, _)| *id == group_id));
    let (_, children) =
        parsed.ok_or_else(|| format!("Malformed /g_queryTree.reply for group {group_id}"))?;
    Ok(children)
}

/// Parses flat /g_queryTree.reply args into (root id, direct child ids),
/// walking nested subtrees so malformed replies are rejected. Reply layout
/// (flag 0): groups are `(nodeID, childCount, ...children)`; synth leaves
/// are `(nodeID, -1, synthName)`.
fn parse_query_tree(args: &[OscType]) -> Option<(i32, Vec<i32>)> {
    fn walk(args: &[OscType], cursor: &mut usize) -> Option<(i32, Vec<i32>)> {
        let id = match args.get(*cursor) {
            Some(OscType::Int(id)) => *id,
            _ => return None,
        };
        *cursor += 1;
        match args.get(*cursor) {
            // Synth leaf: (nodeID, -1, synthName).
            Some(OscType::Int(-1)) => {
                *cursor += 1;
                match args.get(*cursor) {
                    Some(OscType::String(_)) => *cursor += 1,
                    _ => return None,
                }
                Some((id, Vec::new()))
            }
            // Group node: (nodeID, childCount, ...children).
            Some(OscType::Int(count)) if *count >= 0 => {
                *cursor += 1;
                let count = *count as usize;
                let mut children = Vec::with_capacity(count);
                for _ in 0..count {
                    let (child_id, _) = walk(args, cursor)?;
                    children.push(child_id);
                }
                Some((id, children))
            }
            _ => None,
        }
    }
    let mut cursor = 0;
    walk(args, &mut cursor)
}

/// §7.5: set the master gain on the whole master group with one group
/// /n_set (scsynth applies a group-targeted /n_set to every child synth).
pub fn set_master_gain(client: &OscClient, gain: f32) -> Result<(), String> {
    client.send(OscMessage {
        addr: "/n_set".to_string(),
        args: vec![
            OscType::Int(MASTER_GROUP_ID),
            OscType::String("gain".to_string()),
            OscType::Float(gain),
        ],
    })
}

/// §12: free the entire master group (instances go with it), then quit.
pub fn release_master_and_quit(client: &OscClient) {
    let _ = client.send(OscMessage {
        addr: "/n_free".to_string(),
        args: vec![OscType::Int(MASTER_GROUP_ID)],
    });
    let _ = client.send(OscMessage {
        addr: "/quit".to_string(),
        args: vec![],
    });
}

/// §12: ask scsynth to quit (releasing the master stage first when up).
pub fn quit_scsynth(client: &OscClient, release_master: bool) {
    if release_master {
        release_master_and_quit(client);
    } else {
        let _ = client.send(OscMessage {
            addr: "/quit".to_string(),
            args: vec![],
        });
    }
}

/// §7.5 volume curve (N <= 2): linear in dB. `100% = 0 dB`, `80% = -6 dB`,
/// `0%` = mute. Intermediate values interpolate in dB.
pub fn volume_percent_to_gain(percent: f32) -> f32 {
    let p = percent.clamp(0.0, 100.0);
    if p <= 0.0 {
        return 0.0;
    }
    let db = 30.0 * (p / 100.0 - 1.0);
    10f32.powf(db / 20.0)
}

/// §9: validate an external OSC target in `host:port` form.
pub fn validate_osc_target(target: &str) -> Result<(), String> {
    let (host, port) = target
        .rsplit_once(':')
        .ok_or("OSC target must be host:port (e.g. 127.0.0.1:3333)")?;
    if host.trim().is_empty() {
        return Err("OSC target host must not be empty".to_string());
    }
    if host.chars().any(char::is_whitespace) {
        return Err("OSC target host must not contain whitespace".to_string());
    }
    match port.parse::<u16>() {
        Ok(p) if p > 0 => Ok(()),
        _ => Err("OSC target port must be a number between 1 and 65535".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::session::allocate_udp_port;
    use std::io::Read;

    #[test]
    fn osc_target_validation() {
        assert!(validate_osc_target("127.0.0.1:3333").is_ok());
        assert!(validate_osc_target("192.168.1.20:57120").is_ok());
        assert!(validate_osc_target("localhost:9000").is_ok());
        assert!(validate_osc_target("127.0.0.1").is_err());
        assert!(validate_osc_target("127.0.0.1:").is_err());
        assert!(validate_osc_target(":3333").is_err());
        assert!(validate_osc_target("127.0.0.1:0").is_err());
        assert!(validate_osc_target("127.0.0.1:70000").is_err());
        assert!(validate_osc_target("my host:3333").is_err());
        assert!(validate_osc_target("127.0.0.1:abc").is_err());
    }

    #[test]
    fn volume_curve_matches_contract() {
        // 100% = 0 dB → gain 1.0
        assert!((volume_percent_to_gain(100.0) - 1.0).abs() < 1e-6);
        // 80% = -6 dB → gain ≈ 0.501
        assert!((volume_percent_to_gain(80.0) - 0.501_187_2).abs() < 1e-4);
        // 0% = mute
        assert_eq!(volume_percent_to_gain(0.0), 0.0);
        // Clamping
        assert_eq!(volume_percent_to_gain(-10.0), 0.0);
        assert!((volume_percent_to_gain(150.0) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn channel_plan_computes_n_h_k_b() {
        // Full bridge: 16ch project on a 16ch device.
        let plan = channel_plan(16, 16);
        assert_eq!(plan.project_channels, 16);
        assert_eq!(plan.device_channels, 16);
        assert_eq!(plan.bridged_channels, 16);
        assert_eq!(plan.private_bus_start, 16);
        // Channel-poor device: 16ch project on a 2ch device bridges only 2.
        let plan = channel_plan(16, 2);
        assert_eq!(plan.bridged_channels, 2);
        assert_eq!(plan.private_bus_start, 2);
        // Device with headroom: stereo project on an 8ch device.
        let plan = channel_plan(2, 8);
        assert_eq!(plan.bridged_channels, 2);
        assert_eq!(plan.private_bus_start, 2);
        // Mono project.
        let plan = channel_plan(1, 2);
        assert_eq!(plan.bridged_channels, 1);
        assert_eq!(plan.private_bus_start, 1);
    }

    #[test]
    fn resolve_in_list_picks_selected_or_default_device() {
        let list = AudioDeviceCapabilities {
            sample_rate: 48_000,
            devices: vec![
                AudioOutputDevice {
                    name: "Built-in".to_string(),
                    is_default: true,
                    max_output_channels: 2,
                },
                AudioOutputDevice {
                    name: "Interface".to_string(),
                    is_default: false,
                    max_output_channels: 16,
                },
                AudioOutputDevice {
                    name: "Muted".to_string(),
                    is_default: false,
                    max_output_channels: 0,
                },
            ],
        };
        assert_eq!(resolve_in_list(&list, None).unwrap().channels, 2);
        let cap = resolve_in_list(&list, Some("Interface")).unwrap();
        assert_eq!(cap.channels, 16);
        assert_eq!(cap.name, "Interface");
        // Unknown device and zero-channel device are diagnosable errors.
        assert!(resolve_in_list(&list, Some("Missing")).is_err());
        assert!(resolve_in_list(&list, Some("Muted")).is_err());
    }

    #[test]
    fn sample_rate_filters_configs_and_takes_max_channels() {
        // (min rate, max rate, channels) per supported config range.
        let ranges = [
            (44_100, 44_100, 2u16), // 2ch at 44.1k only
            (48_000, 96_000, 16),   // 16ch across 48k–96k
            (48_000, 48_000, 8),    // a second 48k config with fewer channels
        ];
        assert_eq!(select_max_channels(ranges, 48_000), 16);
        assert_eq!(select_max_channels(ranges, 44_100), 2);
        // Unsupported sample rate → 0 usable channels (diagnosable upstream).
        assert_eq!(select_max_channels(ranges, 22_050), 0);
        // No configs at all → 0.
        assert_eq!(select_max_channels([], 48_000), 0);
    }

    /// Issue #21: the offered rates are the standard list intersected with
    /// the devices' continuous ranges — unioned across devices, deduplicated
    /// and ascending by construction.
    #[test]
    fn supported_standard_rates_union_devices() {
        // Two devices with different coverage overlap at 44.1k and 48k.
        let rates = supported_standard_rates([(8_000, 48_000), (44_100, 96_000)]).unwrap();
        assert_eq!(rates, vec![44_100, 48_000, 88_200, 96_000]);
        // A single narrow device yields only the rates it covers.
        assert_eq!(
            supported_standard_rates([(44_100, 48_000)]).unwrap(),
            vec![44_100, 48_000]
        );
        // Range bounds are inclusive.
        assert_eq!(
            supported_standard_rates([(48_000, 88_200)]).unwrap(),
            vec![48_000, 88_200]
        );
        // No device covers any standard rate (or no devices at all) → None,
        // the caller's cue to fall back to the full standard list.
        assert_eq!(supported_standard_rates([(8_000, 22_050)]), None);
        assert_eq!(supported_standard_rates([]), None);
    }

    /// Issue #21: whatever the hardware says, the offered list is always a
    /// non-empty, ascending, deduplicated subset of the standard rates
    /// (enumeration failure degrades to the full standard list).
    #[test]
    fn supported_sample_rates_is_sorted_standard_subset() {
        let rates = supported_sample_rates();
        assert!(!rates.is_empty());
        assert!(rates.windows(2).all(|w| w[0] < w[1]));
        assert!(rates
            .iter()
            .all(|rate| STANDARD_SAMPLE_RATES.contains(rate)));
    }

    #[test]
    fn scsynth_args_use_session_output_channel_count() {
        let cfg = ScsynthConfig {
            sample_rate: 48000,
            block_size: 64,
            audio_bus_channels: 128,
        };
        let args = scsynth_args(&cfg, 16, 57110, Path::new("/plugins"), Some("My Device"));
        let value_after = |flag: &str| {
            let pos = args.iter().position(|a| a == flag).unwrap();
            args[pos + 1].clone()
        };
        assert_eq!(value_after("-o"), "16");
        assert_eq!(value_after("-i"), "0");
        assert_eq!(value_after("-S"), "48000");
        assert_eq!(value_after("-z"), "64");
        assert_eq!(value_after("-a"), "128");
        assert_eq!(value_after("-u"), "57110");
        assert_eq!(value_after("-B"), "127.0.0.1");
        assert_eq!(value_after("-U"), "/plugins");
        assert_eq!(value_after("-H"), "My Device");
        // No device → no -H flag at all.
        let args = scsynth_args(&cfg, 2, 57110, Path::new("/plugins"), None);
        assert!(!args.iter().any(|a| a == "-H"));
    }

    /// Issue #20: `-S` carries the App's effective sample rate — the global
    /// preference when set, 48000 when unset — never a legacy manifest
    /// rate that is still present. Block size and bus channels stay from
    /// the manifest.
    #[test]
    fn scsynth_args_use_effective_sample_rate() {
        let manifest_cfg = ScsynthConfig {
            sample_rate: 44_100,
            block_size: 512,
            audio_bus_channels: 128,
        };
        let s_flag = |prefs: &AppPreferences| {
            let cfg = with_effective_sample_rate(&manifest_cfg, prefs);
            let args = scsynth_args(&cfg, 2, 57110, Path::new("/plugins"), None);
            let pos = args.iter().position(|a| a == "-S").unwrap();
            (args[pos + 1].clone(), args)
        };

        // (a) a set preference is the effective rate.
        let prefs = AppPreferences {
            sample_rate: Some(96_000),
            ..Default::default()
        };
        let (s, args) = s_flag(&prefs);
        assert_eq!(s, "96000");
        // Manifest-declared fields pass through untouched.
        let z = args.iter().position(|a| a == "-z").unwrap();
        assert_eq!(args[z + 1], "512");

        // (b) unset → 48000, not the manifest rate.
        let (s, _) = s_flag(&AppPreferences::default());
        assert_eq!(s, "48000");

        // (c) a preference that differs from the manifest rate still wins.
        let prefs = AppPreferences {
            sample_rate: Some(48_000),
            ..Default::default()
        };
        let (s, _) = s_flag(&prefs);
        assert_eq!(s, "48000");
    }

    /// Issue #92: exit statuses synthesized like waitpid's raw values.
    fn signaled(signal: i32) -> ExitStatus {
        use std::os::unix::process::ExitStatusExt;
        ExitStatus::from_raw(signal)
    }

    fn exited_with(code: i32) -> ExitStatus {
        use std::os::unix::process::ExitStatusExt;
        ExitStatus::from_raw(code << 8)
    }

    fn transient_failure(signal: i32) -> BootFailure {
        BootFailure {
            message: format!("Audio engine exited during startup (signal: {signal})."),
            exit: Some(signaled(signal)),
            output_lines: 0,
            output_tail: Vec::new(),
        }
    }

    /// A signal death that already printed (the 2026-08-30 field shape:
    /// CoreAudio device list on stdout, ObjC runtime diagnostics on
    /// stderr) — the first gate version rejected this as a real failure
    /// and the retry never fired.
    fn printing_transient_failure(signal: i32) -> BootFailure {
        BootFailure {
            message: format!("Audio engine exited during startup (signal: {signal})."),
            exit: Some(signaled(signal)),
            output_lines: 24,
            output_tail: vec!["objc[1]: Method cache corrupted.".to_string()],
        }
    }

    /// Issue #92 (2026-08-30 revision): the gate accepts ANY signal death —
    /// clean exits and timeouts stay excluded. Table-driven across the
    /// observed crash flavors and the real-failure shapes.
    #[test]
    fn transient_crash_gate_accepts_signal_deaths_regardless_of_output() {
        // Signal deaths → retryable, with or without output (field
        // measurement: real crashes carry the CoreAudio device list and
        // ObjC runtime diagnostics, so "zero output" never happens).
        for signal in [5, 6, 10, 11, 9] {
            assert!(
                is_transient_boot_crash(Some(&signaled(signal))),
                "signal {signal} death must be retryable"
            );
        }
        // Clean exits are NOT signal deaths — a configuration error (e.g. a
        // device rejected by -H) prints its error and exits with a code.
        assert!(!is_transient_boot_crash(Some(&exited_with(1))));
        assert!(!is_transient_boot_crash(Some(&exited_with(0))));
        // A boot timeout (the child never exited during the wait) is a real
        // failure.
        assert!(!is_transient_boot_crash(None));
        // The field-shaped failure (signal + output) passes through
        // BootFailure too.
        assert!(printing_transient_failure(6).is_transient_crash());
        assert!(transient_failure(5).is_transient_crash());
        assert!(!BootFailure::other("Failed to start scsynth".into()).is_transient_crash());
    }

    /// Issue #92 product decision: 3 retries for both the session start and
    /// the prewarm — measured at a 53% per-spawn crash rate, one retry
    /// leaves ~28% back-to-back failures, three leave ~8%.
    #[test]
    fn transient_retry_budgets_match_the_field_revision() {
        assert_eq!(SESSION_BOOT_TRANSIENT_RETRIES, 3);
        assert_eq!(PREWARM_BOOT_TRANSIENT_RETRIES, 3);
    }

    /// Issue #92 (2026-08-30 revision): classify_boot_failure counts what
    /// the dead child printed AND keeps its last words — the ObjC runtime's
    /// corruption diagnostics land at the end of the output and are the
    /// diagnosis that the first field investigation never had.
    #[test]
    fn classify_boot_failure_keeps_the_dead_childs_last_words() {
        use std::process::Command;

        // Killed by a signal before printing anything → transient, empty tail.
        let mut silent = Command::new("/bin/sh")
            .arg("-c")
            .arg("kill -9 $$")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let status = silent.wait().unwrap();
        let failure = classify_boot_failure(&BootWaitFailure::Exited(status), &mut silent);
        assert_eq!(failure.exit, Some(status));
        assert_eq!(failure.output_lines, 0);
        assert!(failure.output_tail.is_empty());
        assert!(failure.is_transient_crash());
        assert_eq!(
            failure.message,
            format!("Audio engine exited during startup ({status}). See output below.")
        );

        // The field shape: device list on stdout, runtime diagnostic at the
        // end of stderr → counted, tail keeps the LAST CRASH_OUTPUT_TAIL
        // lines, still transient (signal death).
        let mut chatty = Command::new("/bin/sh")
            .arg("-c")
            .arg("seq 1 12; echo 'objc[1]: bad weak table' >&2; kill -9 $$")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let status = chatty.wait().unwrap();
        let failure = classify_boot_failure(&BootWaitFailure::Exited(status), &mut chatty);
        assert_eq!(failure.output_lines, 13);
        assert_eq!(failure.output_tail.len(), CRASH_OUTPUT_TAIL);
        assert_eq!(
            failure.output_tail.last().unwrap(),
            "objc[1]: bad weak table"
        );
        assert!(failure.is_transient_crash(), "signal death stays retryable");

        // A timeout is classified without touching the (live) child's pipes.
        let mut live = Command::new("sleep").arg("30").spawn().unwrap();
        let failure = classify_boot_failure(&BootWaitFailure::TimedOut, &mut live);
        assert_eq!(failure.exit, None);
        assert_eq!(failure.output_lines, 0);
        assert!(!failure.is_transient_crash());
        let _ = live.kill();
        let _ = live.wait();
    }

    /// Issue #92: the retry runner retries ONLY the transient signature,
    /// at most `retries` times, and otherwise surfaces the failure
    /// unchanged. Injection-based — no real scsynth involved.
    #[test]
    fn retry_runner_retries_a_transient_crash_then_succeeds() {
        let calls = std::cell::Cell::new(0u32);
        let retries = std::cell::Cell::new(0u32);
        let result = boot_with_transient_retries(
            SESSION_BOOT_TRANSIENT_RETRIES,
            Duration::ZERO,
            || {
                calls.set(calls.get() + 1);
                if calls.get() == 1 {
                    Err(transient_failure(5))
                } else {
                    Ok("booted")
                }
            },
            |_| retries.set(retries.get() + 1),
        );
        assert_eq!(result.unwrap(), "booted");
        assert_eq!(calls.get(), 2, "one attempt then the retry");
        assert_eq!(retries.get(), 1);
    }

    #[test]
    fn retry_runner_does_not_retry_a_timeout() {
        let calls = std::cell::Cell::new(0u32);
        let result: Result<(), BootFailure> = boot_with_transient_retries(
            SESSION_BOOT_TRANSIENT_RETRIES,
            Duration::ZERO,
            || {
                calls.set(calls.get() + 1);
                Err(BootFailure::other(
                    "Audio engine failed to start (scsynth did not answer /status in time)."
                        .to_string(),
                ))
            },
            |_| panic!("a timeout must not be retried"),
        );
        assert_eq!(calls.get(), 1);
        assert_eq!(
            result.unwrap_err().message,
            "Audio engine failed to start (scsynth did not answer /status in time)."
        );
    }

    /// 2026-08-30 field regression: a signal death THAT PRINTED must be
    /// retried — the first gate version rejected exactly this shape (every
    /// real crash on the measured machine carried output), so the retry
    /// never fired in production.
    #[test]
    fn retry_runner_retries_a_signal_death_that_printed() {
        let calls = std::cell::Cell::new(0u32);
        let result = boot_with_transient_retries(
            SESSION_BOOT_TRANSIENT_RETRIES,
            Duration::ZERO,
            || {
                calls.set(calls.get() + 1);
                if calls.get() == 1 {
                    Err(printing_transient_failure(6))
                } else {
                    Ok("booted")
                }
            },
            |_| {},
        );
        assert_eq!(result.unwrap(), "booted");
        assert_eq!(calls.get(), 2);
    }

    /// A clean-exit failure (configuration error, e.g. a `-H` device
    /// rejection: prints its error, exits with a code) is NOT retried.
    #[test]
    fn retry_runner_does_not_retry_a_clean_exit() {
        let calls = std::cell::Cell::new(0u32);
        let result: Result<(), BootFailure> = boot_with_transient_retries(
            SESSION_BOOT_TRANSIENT_RETRIES,
            Duration::ZERO,
            || {
                calls.set(calls.get() + 1);
                Err(BootFailure {
                    message: "Audio engine exited during startup (exit status: 1).".to_string(),
                    exit: Some(exited_with(1)),
                    output_lines: 3,
                    output_tail: vec!["requested device not found".to_string()],
                })
            },
            |_| panic!("a clean exit must not be retried"),
        );
        assert_eq!(calls.get(), 1);
        assert!(!result.unwrap_err().is_transient_crash());
    }

    #[test]
    fn retry_runner_surfaces_the_error_when_the_retry_also_crashes() {
        let calls = std::cell::Cell::new(0u32);
        let result: Result<(), BootFailure> = boot_with_transient_retries(
            SESSION_BOOT_TRANSIENT_RETRIES,
            Duration::ZERO,
            || {
                calls.set(calls.get() + 1);
                Err(transient_failure(6))
            },
            |_| {},
        );
        assert_eq!(
            calls.get(),
            1 + SESSION_BOOT_TRANSIENT_RETRIES,
            "the full retry budget is spent before the error surfaces"
        );
        let failure = result.unwrap_err();
        assert!(failure.is_transient_crash());
        assert_eq!(
            failure.message,
            "Audio engine exited during startup (signal: 6)."
        );
    }

    /// Issue #92: the prewarm policy is the same runner with the same
    /// three-retry budget — the third retry still succeeds.
    #[test]
    fn retry_runner_allows_the_prewarms_three_retries() {
        let calls = std::cell::Cell::new(0u32);
        let result = boot_with_transient_retries(
            PREWARM_BOOT_TRANSIENT_RETRIES,
            Duration::ZERO,
            || {
                calls.set(calls.get() + 1);
                if calls.get() <= 3 {
                    Err(transient_failure(5))
                } else {
                    Ok(())
                }
            },
            |_| {},
        );
        assert!(result.is_ok());
        assert_eq!(calls.get(), 4);
    }

    #[test]
    fn master_instances_map_private_bus_to_hardware_bus() {
        // K = B = 2 (stereo device): instance 0 reads bus 2 -> hw 0, etc.
        assert_eq!(master_instance_spec(2, 2, 0), (MASTER_NODE_BASE, 2, 0));
        assert_eq!(master_instance_spec(2, 2, 1), (MASTER_NODE_BASE + 1, 3, 1));
        // K = B = 16 (multichannel device).
        assert_eq!(
            master_instance_spec(16, 16, 15),
            (MASTER_NODE_BASE + 15, 31, 15)
        );
    }

    #[test]
    fn master_node_ids_stay_inside_the_reserved_range() {
        assert!(RESERVED_NODE_ID_MIN >= 2_147_480_000);
        assert!(MASTER_GROUP_ID == RESERVED_NODE_ID_MIN);
        let (last_id, _, _) =
            master_instance_spec(MAX_MASTER_INSTANCES, 0, MAX_MASTER_INSTANCES - 1);
        assert!(last_id <= RESERVED_NODE_ID_MAX);
        assert!(MASTER_GROUP_ID < MASTER_NODE_BASE);
    }

    /// End-to-end against the real bundled scsynth: boot → project group →
    /// master stage → ordering → group gain → release → quit. Skipped when
    /// the sidecar or the synthdef artifact has not been fetched/built yet.
    #[test]
    fn scsynth_internal_lifecycle() {
        let (Ok(binary), Ok(synthdef), Ok(plugins)) =
            (scsynth_binary_path(), master_synthdef_path(), plugins_dir())
        else {
            eprintln!("skipping: scsynth binary, synthdef, or plugins missing");
            return;
        };

        // A 16-channel project on whatever hardware is present: K = min(16, H).
        // Prefer a stable virtual device (BlackHole) when one exists — the
        // system default can be an unreliable network/display device whose
        // CoreAudio init stalls scsynth. The default is the fallback.
        let sample_rate = 48_000;
        let attempts: Vec<Option<String>> = {
            let mut v = Vec::new();
            if let Ok(list) = list_output_devices(sample_rate) {
                for name in ["BlackHole 16ch", "BlackHole 2ch", "BlackHole 64ch"] {
                    if list.devices.iter().any(|d| d.name == name) {
                        v.push(Some(name.to_string()));
                    }
                }
            }
            v.push(None);
            v
        };

        let (mut child, client, k, b) = {
            let mut last_err = None;
            let mut booted = None;
            'outer: for device in &attempts {
                for _ in 0..3 {
                    let cap = match list_output_devices(sample_rate)
                        .ok()
                        .and_then(|list| resolve_in_list(&list, device.as_deref()).ok())
                    {
                        Some(c) => c,
                        None => {
                            last_err = Some(format!(
                                "no usable capability for device {device:?} at {sample_rate} Hz"
                            ));
                            continue;
                        }
                    };
                    let k = 16u32.min(cap.channels);
                    let port = allocate_udp_port().unwrap();
                    let mut c = spawn_scsynth(
                        &binary,
                        &ScsynthConfig {
                            sample_rate,
                            block_size: 64,
                            audio_bus_channels: 128,
                        },
                        k,
                        port,
                        &plugins,
                        device.as_deref(),
                    )
                    .unwrap();

                    // Drain scsynth output so it cannot block on a full pipe.
                    let mut stdout = c.stdout.take().unwrap();
                    std::thread::spawn(move || {
                        let mut buf = [0u8; 1024];
                        while stdout.read(&mut buf).is_ok_and(|n| n > 0) {}
                    });
                    let mut stderr = c.stderr.take().unwrap();
                    std::thread::spawn(move || {
                        let mut buf = [0u8; 1024];
                        while stderr.read(&mut buf).is_ok_and(|n| n > 0) {}
                    });

                    let client = OscClient::connect(&format!("127.0.0.1:{port}")).unwrap();
                    match wait_for_scsynth(&client, &mut c) {
                        Ok(()) => {
                            booted = Some((c, client, k, k));
                            break 'outer;
                        }
                        Err(e) => {
                            last_err = Some(e.message());
                            let pid = c.id();
                            let _ = Command::new("/bin/kill").arg(pid.to_string()).status();
                            let _ = c.wait();
                        }
                    }
                }
            }
            match booted {
                Some(v) => v,
                None => panic!("scsynth should boot and answer /status: {last_err:?}"),
            }
        };

        // The whole scenario runs in a nested scope so that any panic or
        // failure leaves NO scsynth behind: the guard's Drop always quits
        // (and kills) the booted instance before the process is reaped.
        let outcome = std::panic::catch_unwind(|| {
            // The project creates its audio root group BEFORE reporting
            // ready (contract §7.4), i.e. before the App creates the master
            // stage.
            client
                .send(OscMessage {
                    addr: "/g_new".to_string(),
                    args: vec![OscType::Int(1000), OscType::Int(0), OscType::Int(0)],
                })
                .unwrap();

            create_master_stage(&client, &synthdef, k, b, 0.5)
                .expect("master stage should be created");

            // All K instances confirmed in the master group.
            let instances = query_group_children(&client, MASTER_GROUP_ID).unwrap();
            assert_eq!(instances.len(), k as usize);
            for i in 0..k {
                let (node_id, _, _) = master_instance_spec(k, b, i);
                assert!(instances.contains(&node_id), "missing instance {i}");
            }

            // §7.4: the master group runs after the project group.
            let root_children = query_group_children(&client, 0).unwrap();
            assert_eq!(root_children.last(), Some(&MASTER_GROUP_ID));
            assert!(root_children.contains(&1000));

            // A dynamic synth the project creates inside its existing group
            // after ready still executes before the master stage. The
            // bundled scsynth has no built-in "default" SynthDef, so reuse
            // the loaded pndsMaster; in/out point at empty high buses so
            // the node is silent.
            client
                .send(OscMessage {
                    addr: "/s_new".to_string(),
                    args: vec![
                        OscType::String(MASTER_SYNTHDEF_NAME.to_string()),
                        OscType::Int(1001),
                        OscType::Int(1),
                        OscType::Int(1000),
                        OscType::String("in".to_string()),
                        OscType::Int(101),
                        OscType::String("out".to_string()),
                        OscType::Int(100),
                        OscType::String("gain".to_string()),
                        OscType::Float(0.0),
                    ],
                })
                .unwrap();
            client
                .send(OscMessage {
                    addr: "/sync".to_string(),
                    args: vec![OscType::Int(2)],
                })
                .unwrap();
            client.wait_for("/synced", OSC_REPLY_TIMEOUT).unwrap();
            let root_children = query_group_children(&client, 0).unwrap();
            assert_eq!(root_children.last(), Some(&MASTER_GROUP_ID));
            assert!(query_group_children(&client, 1000).unwrap().contains(&1001));

            // §7.5: one group /n_set updates every instance's gain.
            set_master_gain(&client, 0.25).unwrap();
            std::thread::sleep(Duration::from_millis(100));
            client
                .send(OscMessage {
                    addr: "/s_get".to_string(),
                    args: vec![
                        OscType::Int(MASTER_NODE_BASE),
                        OscType::String("gain".to_string()),
                    ],
                })
                .unwrap();
            // /s_get replies on /n_set (not /n_set.info) in SC 3.14.
            let reply = client.wait_for_msg("/n_set", OSC_REPLY_TIMEOUT).unwrap();
            let gain = reply.args.iter().find_map(|a| match a {
                OscType::Float(g) => Some(*g),
                _ => None,
            });
            assert!((gain.unwrap() - 0.25).abs() < 1e-6, "gain reply: {gain:?}");

            // §12: freeing the master group removes it and all instances.
            client
                .send(OscMessage {
                    addr: "/n_free".to_string(),
                    args: vec![OscType::Int(MASTER_GROUP_ID)],
                })
                .unwrap();
            std::thread::sleep(Duration::from_millis(100));
            let root_children = query_group_children(&client, 0).unwrap();
            assert!(!root_children.contains(&MASTER_GROUP_ID));
        });
        // Any panic above must not leak scsynth: force-quit it before the
        // panic propagates, then surface the original failure.
        if outcome.is_err() {
            let pid = child.id();
            let _ = Command::new("/bin/kill").arg(pid.to_string()).status();
            let _ = child.wait();
            std::panic::resume_unwind(outcome.unwrap_err());
        }

        // §12: quit politely, then verify the process is actually gone.
        // A CoreAudio stall can hang /quit; force-kill after the grace
        // window so a hung engine can never leak out of this test.
        release_master_and_quit(&client);
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Ok(Some(_)) = child.try_wait() {
                break;
            }
            if Instant::now() >= deadline {
                let pid = child.id();
                let _ = Command::new("/bin/kill").arg(pid.to_string()).status();
                let _ = child.wait();
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(child.try_wait().unwrap().is_some());
    }
}
