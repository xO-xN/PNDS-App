//! Deterministic, independently owned project checks against saved temporary inputs.
use super::audio::ChannelPlan;
use super::diagnostics::{DiagnosticCheck, DiagnosticReport};
use super::session::HealthPayload;
use crate::types::AudioMode;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControlledCheckOptions {
    pub mode: AudioMode,
    pub compile: bool,
    pub timeout_ms: u32,
    pub output_device: Option<String>,
    pub sample_rate: u32,
}
impl Default for ControlledCheckOptions {
    fn default() -> Self {
        Self {
            mode: AudioMode::None,
            compile: false,
            timeout_ms: 30_000,
            output_device: None,
            sample_rate: crate::types::DEFAULT_SAMPLE_RATE,
        }
    }
}

pub struct ControlledCheckContext {
    pub task_id: String,
    pub expected_source_identity: Option<String>,
    pub app_data_dir: PathBuf,
    pub shared_root: Option<PathBuf>,
    pub node_binary: PathBuf,
    pub scsynth_binary: Option<PathBuf>,
    pub plugins_dir: Option<PathBuf>,
    pub master_synthdef: Option<PathBuf>,
    #[cfg(test)]
    pub test_audio_device: Option<(String, u32)>,
    #[cfg(test)]
    pub test_sclang: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ControlledCheckStatus {
    Passed,
    Failed,
    Cancelled,
    NotExecuted,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ControlledCheckPhase {
    Preparing,
    Static,
    Compiling,
    Audio,
    Starting,
    Health,
    Http,
    Cleaning,
    Finished,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControlledCheckProgress {
    pub task_id: String,
    pub project_path: String,
    pub phase: ControlledCheckPhase,
    pub path: Option<String>,
    #[specta(type = f64)]
    pub copied_bytes: u64,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControlledCheckEnvironment {
    pub node_binary: String,
    pub node_version: Option<String>,
    pub output_device: Option<String>,
    pub sample_rate: Option<u32>,
    pub channel_plan: Option<ChannelPlan>,
    pub osc_target: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControlledCheckCleanup {
    pub node_confirmed: bool,
    pub audio_confirmed: bool,
    pub temporary_files_removed: bool,
    pub errors: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControlledCheckReport {
    pub schema_version: u32,
    pub checker_version: String,
    pub task_id: String,
    pub project_path: String,
    pub mode: AudioMode,
    pub status: ControlledCheckStatus,
    pub error: Option<String>,
    pub diagnostics: Option<DiagnosticReport>,
    pub evidence: Option<InputEvidence>,
    pub freshness: Option<Freshness>,
    pub environment: ControlledCheckEnvironment,
    pub checks: Vec<DiagnosticCheck>,
    pub health: Option<HealthPayload>,
    pub output_tail: Vec<String>,
    pub cleanup: ControlledCheckCleanup,
    pub unverified: Vec<String>,
    /// Adapter-only journal metadata. Serialized reports keep cleanup details.
    #[serde(skip)]
    #[specta(skip)]
    pub unresolved_groups: Vec<super::runtime_gate::OwnedRuntimeGroup>,
}

impl ControlledCheckReport {
    /// Journal I/O is an operational cleanup fact; preserve completed task evidence.
    pub fn record_ownership_result(&mut self, result: Result<(), String>) {
        if let Err(cause) = result {
            self.cleanup.errors.push(cause.clone());
            if self.status == ControlledCheckStatus::Passed {
                self.status = ControlledCheckStatus::Failed;
                self.error = Some(cause);
            }
        }
    }

    pub fn not_executed(task_id: &str, root: &Path, mode: AudioMode, reason: String) -> Self {
        Self {
            schema_version: 1,
            checker_version: env!("CARGO_PKG_VERSION").into(),
            task_id: task_id.into(),
            project_path: root.to_string_lossy().into_owned(),
            mode,
            status: ControlledCheckStatus::NotExecuted,
            error: Some(reason),
            diagnostics: None,
            environment: ControlledCheckEnvironment::default(),
            checks: vec![],
            health: None,
            output_tail: vec![],
            cleanup: ControlledCheckCleanup {
                node_confirmed: true,
                audio_confirmed: true,
                temporary_files_removed: true,
                errors: vec![],
            },
            unverified: [
                "pageRendering",
                "phoneConnections",
                "modelInference",
                "sound",
                "artisticQuality",
                "externalAudio",
                "trustedHttps",
                "telematicHub",
            ]
            .map(str::to_owned)
            .to_vec(),
            unresolved_groups: vec![],
            evidence: None,
            freshness: None,
        }
    }
}

use super::check_evidence::{self, Freshness, InputEvidence, PreparedSnapshot};
use super::children::{self, ChildRegistry, ShutdownOutcome, SupervisedChild};
use super::diagnostics::{diagnose_project, DiagnosticStatus};
use super::manifest::{load_manifest, load_manifest_lenient, Manifest};
use super::session::{self, StartRequest};
use std::collections::{HashSet, VecDeque};
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const POLL: Duration = Duration::from_millis(50);

#[derive(Default)]
struct Resources {
    node: Option<SupervisedChild>,
    audio: Option<SupervisedChild>,
}

/// The caller holds the cross-process runtime lease for this entire invocation.
/// Every child, log, registry and configuration belongs to this task, never SessionManager.
pub fn run_controlled_check(
    root: &Path,
    options: &ControlledCheckOptions,
    context: &ControlledCheckContext,
    cancelled: &AtomicBool,
    progress: impl Fn(ControlledCheckProgress),
) -> ControlledCheckReport {
    let root = root.to_path_buf();
    let mut report =
        ControlledCheckReport::not_executed(&context.task_id, &root, options.mode, String::new());
    report.error = None;
    report.environment.node_binary = context.node_binary.to_string_lossy().into_owned();
    let publish = |phase, path, copied_bytes| {
        progress(ControlledCheckProgress {
            task_id: context.task_id.clone(),
            project_path: root.to_string_lossy().into_owned(),
            phase,
            path,
            copied_bytes,
        })
    };
    let tail = Arc::new(Mutex::new(VecDeque::<String>::new()));
    let mut resources = Resources::default();
    let mut temporary = None;
    let result = (|| {
        check_cancel(cancelled)?;
        if !(100..=120_000).contains(&options.timeout_ms) {
            return Err("Check timeout must be between 100 and 120000 ms".into());
        }
        if !super::audio::STANDARD_SAMPLE_RATES.contains(&options.sample_rate) {
            return Err("Unsupported audio sample rate".into());
        }
        let checks_dir = context.app_data_dir.join("controlled-checks");
        std::fs::create_dir_all(&checks_dir)
            .map_err(|e| format!("Cannot create check workspace: {e}"))?;
        temporary = Some(
            tempfile::Builder::new()
                .prefix("check-")
                .tempdir_in(&checks_dir)
                .map_err(|e| format!("Cannot create temporary check directory: {e}"))?,
        );
        let temp = temporary.as_ref().expect("created check directory");
        publish(ControlledCheckPhase::Preparing, None, 0);
        let snapshot = check_evidence::prepare_snapshot(
            &root,
            context.shared_root.as_deref(),
            temp.path(),
            cancelled,
            |path, bytes| publish(ControlledCheckPhase::Preparing, Some(path.into()), bytes),
        )?;
        report.evidence = Some(snapshot.evidence.clone());
        if context
            .expected_source_identity
            .as_ref()
            .is_some_and(|expected| *expected != snapshot.evidence.source_identity)
        {
            return Err("Project directory identity changed after App selection; select it again before checking".into());
        }
        run_snapshot(
            &snapshot,
            options,
            context,
            cancelled,
            &publish,
            &tail,
            &mut resources,
            &mut report,
        )
    })();
    if let Err(error) = result {
        report.status = if cancelled.load(Ordering::Acquire) {
            ControlledCheckStatus::Cancelled
        } else {
            ControlledCheckStatus::Failed
        };
        report.error = Some(error);
    }
    publish(ControlledCheckPhase::Cleaning, None, 0);
    if let Some(node) = &mut resources.node {
        report.cleanup.node_confirmed = node.shutdown(children::SCORE_SERVER_SHUTDOWN_GRACE_WINDOW)
            == ShutdownOutcome::Confirmed;
    }
    if let Some(audio) = &mut resources.audio {
        if let Some(target) = &report.environment.osc_target {
            if let Ok(client) = super::audio::OscClient::connect(target) {
                super::audio::release_master_and_quit(&client);
                let deadline = Instant::now() + Duration::from_millis(200);
                while Instant::now() < deadline && matches!(audio.try_wait(), Ok(None)) {
                    std::thread::sleep(POLL);
                }
            }
        }
        report.cleanup.audio_confirmed =
            audio.shutdown(children::SCSYNTH_SHUTDOWN_GRACE_WINDOW) == ShutdownOutcome::Confirmed;
    }
    if !report.cleanup.node_confirmed {
        if let Some(group) = resources
            .node
            .as_ref()
            .and_then(SupervisedChild::owned_runtime_group)
        {
            report.unresolved_groups.push(group);
        }
        report
            .cleanup
            .errors
            .push("Node process cleanup was not confirmed".into());
    }
    if !report.cleanup.audio_confirmed {
        if let Some(group) = resources
            .audio
            .as_ref()
            .and_then(SupervisedChild::owned_runtime_group)
        {
            report.unresolved_groups.push(group);
        }
        report
            .cleanup
            .errors
            .push("Audio process cleanup was not confirmed".into());
    }
    report.output_tail = tail
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .cloned()
        .collect();
    if let Some(evidence) = &report.evidence {
        report.freshness = Some(check_evidence::source_freshness(
            &root,
            context.shared_root.as_deref(),
            evidence,
            cancelled,
        ));
    }
    if let Some(temp) = temporary {
        if report.cleanup.node_confirmed && report.cleanup.audio_confirmed {
            if let Err(error) = temp.close() {
                report.cleanup.temporary_files_removed = false;
                report
                    .cleanup
                    .errors
                    .push(format!("Temporary directory removal failed: {error}"));
            }
        } else {
            report.cleanup.temporary_files_removed = false;
            report.cleanup.errors.push(format!(
                "Preserved workspace for unresolved process ownership: {}",
                temp.keep().display()
            ));
        }
    }
    if !report.cleanup.errors.is_empty() && report.status == ControlledCheckStatus::Passed {
        report.status = ControlledCheckStatus::Failed;
        report.error = Some(report.cleanup.errors.join("; "));
    }
    publish(ControlledCheckPhase::Finished, None, 0);
    report
}

#[allow(clippy::too_many_arguments)]
fn run_snapshot(
    snapshot: &PreparedSnapshot,
    options: &ControlledCheckOptions,
    context: &ControlledCheckContext,
    cancelled: &AtomicBool,
    publish: &impl Fn(ControlledCheckPhase, Option<String>, u64),
    tail: &Arc<Mutex<VecDeque<String>>>,
    resources: &mut Resources,
    report: &mut ControlledCheckReport,
) -> Result<(), String> {
    let root = &snapshot.project_root;
    publish(ControlledCheckPhase::Static, None, 0);
    report.diagnostics = Some(diagnose_project(root, snapshot.shared_root.as_deref()));
    let manifest = load_manifest_lenient(root)?;
    if options.mode == AudioMode::External
        || !manifest.audio.supported_modes.contains(&options.mode)
    {
        report.status = ControlledCheckStatus::NotExecuted;
        report.error = Some(if options.mode == AudioMode::External {
            "External mode requires manual App testing".into()
        } else {
            format!(
                "Project does not declare support for {} mode; runtime check was not executed",
                options.mode
            )
        });
        return Ok(());
    }
    if options.compile {
        publish(ControlledCheckPhase::Compiling, None, 0);
        check_cancel(cancelled)?;
        compile_snapshot(root, options, context, cancelled, report)?;
        report.diagnostics = Some(diagnose_project(root, snapshot.shared_root.as_deref()));
    }
    if !report.diagnostics.as_ref().is_some_and(|d| d.static_passed) {
        return Err("Saved snapshot failed static diagnostics; required resources are not skipped by audio mode".into());
    }
    let manifest = load_manifest(root)?;
    check_cancel(cancelled)?;
    let registry = ChildRegistry::new(context.app_data_dir.join("controlled-checks/ownership"));
    registry.cleanup_orphans(&HashSet::new())?;
    super::preflight::check_ports_available(
        manifest.score_server.performer_port,
        manifest.score_server.monitor_port,
        &HashSet::new(),
    )?;
    report.environment.node_version = Some(capture_node_version(
        root, options, context, cancelled, &registry, resources, tail,
    )?);
    let mut request = StartRequest::new(
        root.to_string_lossy().into_owned(),
        options.mode,
        "127.0.0.1".into(),
        None,
    );
    request.shared_libraries = if manifest.shared_libraries.is_empty() {
        Default::default()
    } else {
        super::shared_libraries::SharedLibraryResolver::default().resolve_at(
            snapshot
                .shared_root
                .as_deref()
                .ok_or("Required captured App shared resources are missing")?,
            &manifest.shared_libraries,
        )?
    };
    if options.mode == AudioMode::Internal {
        publish(ControlledCheckPhase::Audio, None, 0);
        check_cancel(cancelled)?;
        let device = resolve_device(options, context)?;
        let plan = super::audio::channel_plan(manifest.audio.output_channels, device.channels);
        let mut config = manifest
            .audio
            .scsynth
            .clone()
            .ok_or("Internal check requires audio.scsynth")?;
        config.sample_rate = options.sample_rate;
        report.environment.output_device = Some(device.name.clone());
        report.environment.sample_rate = Some(config.sample_rate);
        report.environment.channel_plan = Some(plan.clone());
        let binary = context
            .scsynth_binary
            .as_deref()
            .filter(|p| p.is_file())
            .ok_or("Bundled scsynth is unavailable")?;
        let plugins = context
            .plugins_dir
            .as_deref()
            .filter(|p| p.is_dir())
            .ok_or("Bundled UGen plugins are unavailable")?;
        context
            .master_synthdef
            .as_deref()
            .filter(|p| p.is_file())
            .ok_or("Bundled master SynthDef is unavailable")?;
        let port = session::allocate_udp_port()?;
        let target = format!("127.0.0.1:{port}");
        let mut command = super::audio::scsynth_command(
            binary,
            &config,
            plan.bridged_channels,
            port,
            plugins,
            Some(&device.name),
        );
        command.current_dir(root);
        resources.audio = Some(
            SupervisedChild::spawn_group(&registry, binary.to_string_lossy(), &mut command)
                .map_err(|e| format!("Failed to start check audio: {e}"))?,
        );
        drain_output(
            resources.audio.as_mut().expect("spawned audio"),
            "scsynth",
            tail,
        );
        report.environment.osc_target = Some(target.clone());
        let client = super::audio::OscClient::connect(&target)?;
        let deadline = Instant::now() + Duration::from_millis(u64::from(options.timeout_ms));
        loop {
            check_cancel(cancelled)?;
            ensure_alive(resources)?;
            client.send(rosc::OscMessage {
                addr: "/status".into(),
                args: vec![],
            })?;
            if client
                .wait_for("/status.reply", Duration::from_millis(100))
                .is_ok()
            {
                break;
            }
            if Instant::now() >= deadline {
                return Err("Timed out waiting for audio /status.reply".into());
            }
            std::thread::sleep(POLL);
        }
        request.channel_plan = Some(plan);
        request.output_device = Some(device.name);
        request.resolved_osc_target = Some(target);
    }
    publish(ControlledCheckPhase::Starting, None, 0);
    let entry = root.join(&manifest.score_server.entry);
    let mut command = Command::new(&context.node_binary);
    command
        .arg(&entry)
        .args(["--audio-mode", options.mode.as_str()])
        .current_dir(root.join(&manifest.score_server.working_directory))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for key in [
        "PNDS_HOST_IP",
        "PNDS_OSC_TARGET",
        "PNDS_AUDIO_OUTPUT_BUS",
        "PNDS_AUDIO_OUTPUT_CHANNELS",
        "PNDS_SHARED_LIBRARIES",
        "PNDS_PERFORMER_URL",
        "PNDS_NODE_ID",
        "PNDS_HUB_URL",
        "PNDS_HUB_TOKEN",
        "PNDS_HUB_ROOM",
        "NODE_OPTIONS",
        "NODE_PATH",
    ] {
        command.env_remove(key);
    }
    command.envs(session::build_score_server_env(&request));
    resources.node = Some(
        SupervisedChild::spawn_group(&registry, entry.to_string_lossy(), &mut command)
            .map_err(|e| format!("Failed to start embedded Node: {e}"))?,
    );
    drain_output(resources.node.as_mut().expect("spawned Node"), "node", tail);
    publish(ControlledCheckPhase::Health, None, 0);
    let deadline = Instant::now() + Duration::from_millis(u64::from(options.timeout_ms));
    loop {
        check_cancel(cancelled)?;
        ensure_alive(resources)?;
        match session::fetch_health(manifest.score_server.performer_port) {
            Ok(health) => {
                report.health = Some(health.clone());
                validate_health(&health, &manifest, &request)?;
                if health.status == "ready" {
                    break;
                }
            }
            Err(error) => {
                if Instant::now() >= deadline {
                    return Err(format!("Timed out waiting for project health: {error}"));
                }
            }
        }
        if Instant::now() >= deadline {
            return Err("Timed out waiting for project ready health".into());
        }
        std::thread::sleep(POLL);
    }
    publish(ControlledCheckPhase::Http, None, 0);
    for port in [
        manifest.score_server.performer_port,
        manifest.score_server.monitor_port,
    ] {
        check_cancel(cancelled)?;
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .max_redirects(0)
            .timeout_global(Some(Duration::from_millis(800)))
            .build()
            .into();
        let response = agent
            .get(format!("http://127.0.0.1:{port}/"))
            .call()
            .map_err(|e| format!("HTTP entry on port {port} failed: {e}"))?;
        if response.status() != 200 {
            return Err(format!(
                "HTTP entry on port {port} returned {}",
                response.status()
            ));
        }
    }
    ensure_alive(resources)?;
    check_cancel(cancelled)?;
    if options.mode == AudioMode::Internal {
        let plan = request
            .channel_plan
            .as_ref()
            .expect("Internal channel plan");
        let client = super::audio::OscClient::connect(
            request
                .resolved_osc_target
                .as_deref()
                .expect("Internal target"),
        )?;
        super::audio::create_master_stage(
            &client,
            context
                .master_synthdef
                .as_deref()
                .expect("validated master SynthDef"),
            plan.bridged_channels,
            plan.private_bus_start,
            if plan.project_channels > 2 {
                1.0
            } else {
                super::audio::volume_percent_to_gain(super::audio::DEFAULT_VOLUME_PERCENT)
            },
        )?;
        check_cancel(cancelled)?;
        ensure_alive(resources)?;
        report.checks.push(DiagnosticCheck { code: "audio".into(), status: DiagnosticStatus::Passed, reason: "Owned audio process answered OSC status and all master bus instances were confirmed; sound content remains unverified".into() });
    }
    report.checks.push(DiagnosticCheck {
        code: "runtime".into(),
        status: DiagnosticStatus::Passed,
        reason: "Owned Node remained alive, health became ready and both HTTP entries returned 200"
            .into(),
    });
    report.status = ControlledCheckStatus::Passed;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn capture_node_version(
    root: &Path,
    options: &ControlledCheckOptions,
    context: &ControlledCheckContext,
    cancelled: &AtomicBool,
    registry: &ChildRegistry,
    resources: &mut Resources,
    tail: &Arc<Mutex<VecDeque<String>>>,
) -> Result<String, String> {
    let output =
        tempfile::NamedTempFile::new_in(root.parent().ok_or("Snapshot parent is missing")?)
            .map_err(|e| format!("Cannot prepare runtime version capture: {e}"))?;
    let mut command = Command::new(&context.node_binary);
    command
        .arg("--version")
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(output.reopen().map_err(|e| e.to_string())?))
        .stderr(Stdio::piped())
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH");
    resources.node = Some(
        SupervisedChild::spawn_group(
            registry,
            context.node_binary.to_string_lossy(),
            &mut command,
        )
        .map_err(|e| format!("Embedded Node is unavailable: {e}"))?,
    );
    drain_output(
        resources.node.as_mut().expect("version child"),
        "node-version",
        tail,
    );
    let deadline = Instant::now() + Duration::from_millis(u64::from(options.timeout_ms.min(2000)));
    loop {
        check_cancel(cancelled)?;
        if let Some(status) = resources
            .node
            .as_mut()
            .expect("version child")
            .try_wait()
            .map_err(|e| e.to_string())?
        {
            if !status.success() {
                return Err(format!("Embedded Node version check failed ({status})"));
            }
            break;
        }
        if Instant::now() >= deadline {
            return Err("Embedded Node version check timed out".into());
        }
        std::thread::sleep(POLL);
    }
    if resources
        .node
        .as_mut()
        .expect("version child")
        .shutdown(children::SCORE_SERVER_SHUTDOWN_GRACE_WINDOW)
        != ShutdownOutcome::Confirmed
    {
        return Err("Embedded Node version process cleanup was not confirmed".into());
    }
    resources.node.take();
    let mut version = String::new();
    output
        .reopen()
        .map_err(|e| e.to_string())?
        .take(4096)
        .read_to_string(&mut version)
        .map_err(|e| e.to_string())?;
    let version = version.trim();
    if !version.starts_with('v') || version.contains(char::is_whitespace) {
        return Err("Embedded Node returned an invalid version".into());
    }
    Ok(version.into())
}

fn compile_snapshot(
    root: &Path,
    options: &ControlledCheckOptions,
    context: &ControlledCheckContext,
    cancelled: &AtomicBool,
    report: &mut ControlledCheckReport,
) -> Result<(), String> {
    use super::creation::{CreationAccess, Protection, SynthdefCompiler};
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let workspace = access.open(root, &protection).map_err(|e| e.detail)?;
    let job = access
        .prepare_synthdefs(&workspace.project.identity, &protection)
        .map_err(|e| e.detail)?;
    let sclang = super::synthdef::find_sclang();
    #[cfg(test)]
    let sclang = context.test_sclang.clone().map_or(sclang, Ok);
    let compiler = SynthdefCompiler {
        sclang,
        timeout: Duration::from_millis(u64::from(options.timeout_ms)),
    };
    #[cfg(not(test))]
    let _ = context;
    let output = job.run_cancellable(&compiler, cancelled);
    check_cancel(cancelled)?;
    let compiled = access
        .finish_synthdefs(output, &protection)
        .map_err(|e| e.detail)?;
    let mut reason = format!(
        "sclang={}; produced={}; {}",
        compiled.sclang_path.as_deref().unwrap_or("unavailable"),
        compiled.produced.join(", "),
        compiled.output
    );
    use sha2::{Digest, Sha256};
    for name in &compiled.produced {
        let path = root.join("supercollider/synthdefs").join(name);
        let bytes =
            std::fs::read(&path).map_err(|e| format!("Compiled artifact cannot be read: {e}"))?;
        reason.push_str(&format!("; {name} sha256={:x}", Sha256::digest(bytes)));
    }
    let success = compiled.error.is_none();
    report.checks.push(DiagnosticCheck {
        code: "compile".into(),
        status: if success {
            DiagnosticStatus::Passed
        } else {
            DiagnosticStatus::Failed
        },
        reason,
    });
    match compiled.error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

fn resolve_device(
    options: &ControlledCheckOptions,
    _context: &ControlledCheckContext,
) -> Result<super::audio::DeviceCapability, String> {
    #[cfg(test)]
    if let Some((name, channels)) = &_context.test_audio_device {
        return Ok(super::audio::DeviceCapability {
            name: name.clone(),
            channels: *channels,
        });
    }
    let capabilities = super::audio::list_output_devices(options.sample_rate)?;
    super::audio::resolve_in_list(&capabilities, options.output_device.as_deref())
}

fn validate_health(
    health: &HealthPayload,
    manifest: &Manifest,
    request: &StartRequest,
) -> Result<(), String> {
    if health.project_id.as_deref() != Some(manifest.id.as_str()) {
        return Err("Health projectId does not match the captured manifest".into());
    }
    if health.audio_mode.as_deref() != Some(request.mode.as_str()) {
        return Err("Health audioMode does not match this check".into());
    }
    let server = health
        .score_server
        .as_ref()
        .ok_or("Health scoreServer configuration is missing")?;
    if server.performer_port != Some(manifest.score_server.performer_port)
        || server.monitor_port != Some(manifest.score_server.monitor_port)
    {
        return Err("Health HTTP ports do not match the captured manifest".into());
    }
    if let Some(error) = &server.error {
        return Err(format!("Health score server error: {error}"));
    }
    let audio = health
        .audio
        .as_ref()
        .ok_or("Health audio configuration is missing")?;
    if let Some(error) = &audio.error {
        return Err(format!("Health audio error: {error}"));
    }
    let awaiting_audio_target =
        health.status == "starting" && audio.status == "starting" && audio.target.is_none();
    if audio.target != request.resolved_osc_target && !awaiting_audio_target {
        return Err("Health audio target does not match this check".into());
    }
    if !["starting", "ready"].contains(&health.status.as_str()) {
        return Err(format!(
            "Health reported non-ready state: {}",
            health.status
        ));
    }
    let expected = if request.mode == AudioMode::None {
        "disabled"
    } else {
        "ready"
    };
    if health.status == "ready" && audio.status != expected {
        return Err(format!("Ready health requires audio.status={expected}"));
    }
    if health.status == "starting" && ![expected, "starting"].contains(&audio.status.as_str()) {
        return Err(format!("Invalid starting audio state: {}", audio.status));
    }
    Ok(())
}

fn check_cancel(cancelled: &AtomicBool) -> Result<(), String> {
    if cancelled.load(Ordering::Acquire) {
        Err("Check cancelled".into())
    } else {
        Ok(())
    }
}
fn ensure_alive(resources: &mut Resources) -> Result<(), String> {
    for (name, child) in [
        ("Node", &mut resources.node),
        ("Audio", &mut resources.audio),
    ] {
        if let Some(child) = child {
            if let Some(status) = child
                .try_wait()
                .map_err(|e| format!("Cannot supervise {name}: {e}"))?
            {
                return Err(format!(
                    "{name} process exited before check completion ({status})"
                ));
            }
        }
    }
    Ok(())
}
fn drain_output(child: &mut SupervisedChild, label: &str, tail: &Arc<Mutex<VecDeque<String>>>) {
    let readers: Vec<Box<dyn Read + Send>> = child
        .child()
        .stdout
        .take()
        .map(|s| Box::new(s) as Box<dyn Read + Send>)
        .into_iter()
        .chain(
            child
                .child()
                .stderr
                .take()
                .map(|s| Box::new(s) as Box<dyn Read + Send>),
        )
        .collect();
    for mut reader in readers {
        let tail = Arc::clone(tail);
        let label = label.to_owned();
        std::thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            while let Ok(count) = reader.read(&mut buffer) {
                if count == 0 {
                    break;
                }
                let mut lines = tail.lock().unwrap_or_else(|e| e.into_inner());
                for line in String::from_utf8_lossy(&buffer[..count]).lines() {
                    if lines.len() == 50 {
                        lines.pop_front();
                    }
                    lines.push_back(format!("[{label}] {line}"));
                }
            }
        });
    }
}

#[cfg(test)]
mod tests;
