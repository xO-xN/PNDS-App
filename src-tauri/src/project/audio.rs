//! scsynth process management, OSC control, and the App Master Synth.
//! See `docs/PNDS_APP_REQUIREMENTS.md` §6.2–§6.4.
//!
//! Signal path (internal mode):
//!   project synths → private bus 2/3 → pndsMaster (gain) → hw bus 0/1

use rosc::{OscMessage, OscPacket, OscType};
use serde::Serialize;
use specta::Type;
use std::net::UdpSocket;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use crate::project::manifest::ScsynthConfig;

/// §6.5: available CoreAudio output devices (name = scsynth -H value).
#[derive(Debug, Clone, Default, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceList {
    pub devices: Vec<String>,
    /// Name of the system default output device, if any.
    pub default: Option<String>,
}

/// §6.5: enumerate CoreAudio output devices via cpal.
pub fn list_output_devices() -> Result<AudioDeviceList, String> {
    use cpal::traits::HostTrait;
    let host = cpal::default_host();
    let devices = host
        .output_devices()
        .map_err(|e| format!("Failed to enumerate audio output devices: {e}"))?
        .map(|d| d.to_string())
        .collect();
    let default = host.default_output_device().map(|d| d.to_string());
    Ok(AudioDeviceList { devices, default })
}

/// §6.3 output bus protocol: project audio goes to the private stereo bus.
pub const PRIVATE_OUTPUT_BUS: i32 = 2;
/// §6.4 master synth identity and defaults.
pub const MASTER_SYNTHDEF_NAME: &str = "pndsMaster";
pub const MASTER_NODE_ID: i32 = 2001;
pub const DEFAULT_VOLUME_PERCENT: f32 = 80.0;

const SCSYNTH_BOOT_TIMEOUT: Duration = Duration::from_secs(10);
const OSC_REPLY_TIMEOUT: Duration = Duration::from_millis(1500);

/// Locates the bundled scsynth sidecar. V1 is Apple Silicon only (§2).
pub fn scsynth_binary_path() -> Result<PathBuf, String> {
    const TRIPLE: &str = "aarch64-apple-darwin";
    let name = format!("scsynth-{TRIPLE}");

    // 1. Next to the executable (bundled app; dev when the CLI copies it)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(&name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }
    // 2. Development fallback: src-tauri/binaries
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(&name);
    if dev.exists() {
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
/// never depends on the host's SuperCollider installation, §6.2).
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

/// Spawns scsynth with the §6.2 flags and returns the child plus its
/// stdout/stderr handles (wired into the session output tail by the caller).
/// `device` selects the output via -H (§6.5); None uses the system default.
///
/// We bundle SC 3.14.x because 3.13's -H opened devices for input even with
/// `-i 0`, which broke output-only devices (built-in speakers, TVs). The
/// upstream guard on `mNumInputs > 0` in 3.14 lets any CoreAudio device work.
pub fn spawn_scsynth(
    binary: &Path,
    cfg: &ScsynthConfig,
    port: u16,
    plugins: &Path,
    device: Option<&str>,
) -> Result<Child, String> {
    let mut cmd = Command::new(binary);
    cmd.args([
        "-i",
        "0",
        "-o",
        "2",
        "-S",
        &cfg.sample_rate.to_string(),
        "-z",
        &cfg.block_size.to_string(),
        "-a",
        &cfg.audio_bus_channels.to_string(),
        "-u",
        &port.to_string(),
        "-B",
        "127.0.0.1",
        "-U",
        &plugins.to_string_lossy(),
    ]);
    if let Some(name) = device {
        cmd.args(["-H", name]);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start scsynth: {e}"))
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

    /// Waits for a reply whose address matches `address` (e.g. "/done",
    /// "/synced", "/status.reply"), ignoring other packets until timeout.
    fn wait_for(&self, address: &str, timeout: Duration) -> Result<(), String> {
        let deadline = Instant::now() + timeout;
        let mut buf = [0u8; 8192];
        loop {
            match self.socket.recv(&mut buf) {
                Ok(n) => {
                    if let Ok((_remaining, packet)) = rosc::decoder::decode_udp(&buf[..n]) {
                        let is_match =
                            matches!(&packet, OscPacket::Message(msg) if msg.addr == address);
                        if is_match {
                            return Ok(());
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
}

/// §8.1 step 2: wait until scsynth answers /status (it is fully booted).
/// Fails fast when the process exits during boot (e.g. an output-only
/// device rejected by -H) instead of waiting out the full timeout.
pub fn wait_for_scsynth(client: &OscClient, child: &mut Child) -> Result<(), String> {
    let deadline = Instant::now() + SCSYNTH_BOOT_TIMEOUT;
    loop {
        client.send(OscMessage {
            addr: "/status".to_string(),
            args: vec![],
        })?;
        if client
            .wait_for("/status.reply", Duration::from_millis(500))
            .is_ok()
        {
            return Ok(());
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "Audio engine exited during startup ({status}). See output below."
            ));
        }
        if Instant::now() >= deadline {
            return Err(
                "Audio engine failed to start (scsynth did not answer /status in time)."
                    .to_string(),
            );
        }
    }
}

/// §8.1 step 7 (internal): load pndsMaster and create the master synth at
/// the tail of the root group so it runs after the project group (§6.4).
pub fn create_master_synth(client: &OscClient, synthdef: &Path, gain: f32) -> Result<(), String> {
    client.send(OscMessage {
        addr: "/d_load".to_string(),
        args: vec![OscType::String(synthdef.to_string_lossy().to_string())],
    })?;
    client
        .wait_for("/done", OSC_REPLY_TIMEOUT)
        .map_err(|e| format!("Failed to load {}: {e}", synthdef.display()))?;

    client.send(OscMessage {
        addr: "/s_new".to_string(),
        args: vec![
            OscType::String(MASTER_SYNTHDEF_NAME.to_string()),
            OscType::Int(MASTER_NODE_ID),
            // addAction 1 = add to tail of the target group
            OscType::Int(1),
            // target: root group 0 (bare scsynth has no group 1)
            OscType::Int(0),
            OscType::String("in".to_string()),
            OscType::Int(PRIVATE_OUTPUT_BUS),
            OscType::String("out".to_string()),
            OscType::Int(0),
            OscType::String("gain".to_string()),
            OscType::Float(gain),
        ],
    })?;

    // /sync confirms the synth was created (the server processes the queue)
    client.send(OscMessage {
        addr: "/sync".to_string(),
        args: vec![OscType::Int(1)],
    })?;
    client
        .wait_for("/synced", OSC_REPLY_TIMEOUT)
        .map_err(|e| format!("Master synth creation was not confirmed: {e}"))?;
    log::info!("Master synth ready (node {MASTER_NODE_ID}, in={PRIVATE_OUTPUT_BUS}, gain={gain})");
    Ok(())
}

/// §6.4: set the master gain (live volume changes).
pub fn set_master_gain(client: &OscClient, gain: f32) -> Result<(), String> {
    client.send(OscMessage {
        addr: "/n_set".to_string(),
        args: vec![
            OscType::Int(MASTER_NODE_ID),
            OscType::String("gain".to_string()),
            OscType::Float(gain),
        ],
    })
}

/// §8.2 step 3: release the master synth, then quit scsynth politely.
pub fn release_master_and_quit(client: &OscClient) {
    let _ = client.send(OscMessage {
        addr: "/n_free".to_string(),
        args: vec![OscType::Int(MASTER_NODE_ID)],
    });
    let _ = client.send(OscMessage {
        addr: "/quit".to_string(),
        args: vec![],
    });
}

/// §8.2: ask scsynth to quit (optionally releasing the master synth first).
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

/// §6.4 volume curve: linear in dB. `100% = 0 dB`, `80% = -6 dB`,
/// `0%` = mute. Intermediate values interpolate in dB.
pub fn volume_percent_to_gain(percent: f32) -> f32 {
    let p = percent.clamp(0.0, 100.0);
    if p <= 0.0 {
        return 0.0;
    }
    let db = 30.0 * (p / 100.0 - 1.0);
    10f32.powf(db / 20.0)
}

/// §6.6: validate an external OSC target in `host:port` form.
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
    use crate::project::session::allocate_udp_port;
    use std::io::Read;

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

    /// End-to-end against the real bundled scsynth: boot → /status →
    /// master synth → gain change → quit. Skipped when the sidecar or the
    /// synthdef artifact has not been fetched/built yet.
    #[test]
    fn scsynth_internal_lifecycle() {
        let (Ok(binary), Ok(synthdef), Ok(plugins)) =
            (scsynth_binary_path(), master_synthdef_path(), plugins_dir())
        else {
            eprintln!("skipping: scsynth sidecar, synthdef, or plugins missing");
            return;
        };

        // Boot attempts: system default first; if CoreAudio init is flaky
        // on this machine (e.g. a network/display device as default), fall
        // back to a stable duplex device when one is available.
        let mut attempts: Vec<Option<String>> = vec![None];
        if let Ok(list) = list_output_devices() {
            if let Some(stable) = list
                .devices
                .iter()
                .find(|d| d.starts_with("BlackHole"))
                .cloned()
            {
                attempts.push(Some(stable));
            }
        }

        let (mut child, client) = {
            let mut last_err = None;
            let mut booted = None;
            'outer: for device in &attempts {
                for _ in 0..2 {
                    let port = allocate_udp_port().unwrap();
                    let mut c = spawn_scsynth(
                        &binary,
                        &ScsynthConfig {
                            sample_rate: 48000,
                            block_size: 64,
                            audio_bus_channels: 128,
                        },
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
                            booted = Some((c, client));
                            break 'outer;
                        }
                        Err(e) => {
                            last_err = Some(e);
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
        create_master_synth(&client, &synthdef, 0.5).expect("master synth should be created");
        set_master_gain(&client, 0.25).unwrap();
        release_master_and_quit(&client);

        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Ok(Some(_)) = child.try_wait() {
                break;
            }
            assert!(Instant::now() < deadline, "scsynth did not quit in time");
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(child.try_wait().unwrap().is_some());
    }
}
