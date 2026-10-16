//! Thin CLI adapter over the same workflow used by the desktop commands.
use pnds_app_lib::{
    default_gate_path, run_controlled_check, AudioMode, ControlledCheckContext,
    ControlledCheckOptions, ControlledCheckReport, ControlledCheckStatus, RuntimeLease,
};
use std::ffi::OsString;
use std::io::{Read, Write};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

static INTERRUPTED: AtomicBool = AtomicBool::new(false);
extern "C" fn interrupt(_: libc::c_int) {
    INTERRUPTED.store(true, Ordering::Relaxed);
}

/// A separate worker keeps ownership until cleanup, even if the CLI front end
/// exits unexpectedly. EOF on its private stdin pipe is cancellation.
pub fn supervise(arguments: Vec<OsString>) -> Result<u8, String> {
    // SAFETY: handler only stores an atomic flag; no allocation or I/O.
    unsafe {
        libc::signal(libc::SIGINT, interrupt as *const () as libc::sighandler_t);
        libc::signal(libc::SIGTERM, interrupt as *const () as libc::sighandler_t);
    }
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let mut worker = Command::new(executable)
        .arg("__controlled-check-worker")
        .args(arguments)
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .process_group(0)
        .spawn()
        .map_err(|error| format!("Cannot start controlled-check worker: {error}"))?;
    let mut control = worker.stdin.take();
    loop {
        if INTERRUPTED.load(Ordering::Relaxed) {
            if let Some(mut pipe) = control.take() {
                let _ = pipe.write_all(b"cancel");
            }
        }
        if let Some(status) = worker.try_wait().map_err(|error| error.to_string())? {
            return Ok(status
                .code()
                .and_then(|code| u8::try_from(code).ok())
                .unwrap_or(1));
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

struct Invocation {
    project: PathBuf,
    options: ControlledCheckOptions,
    contents: PathBuf,
    shared: PathBuf,
    json: bool,
}

fn parse(arguments: Vec<OsString>) -> Result<Invocation, String> {
    let mut arguments = arguments.into_iter();
    let mut project = None;
    let mut options = ControlledCheckOptions::default();
    let mut contents = None;
    let mut shared = None;
    let mut json = false;
    let mut paths_only = false;
    while let Some(argument) = arguments.next() {
        match argument.to_str() {
            Some("--") if !paths_only => paths_only = true,
            Some("--run") if !paths_only => {}
            Some("--json") if !paths_only => json = true,
            Some("--compile") if !paths_only => options.compile = true,
            Some("--mode") if !paths_only => {
                options.mode =
                    match arguments.next().as_deref().and_then(|value| value.to_str()) {
                        Some("none") => AudioMode::None,
                        Some("internal") => AudioMode::Internal,
                        _ => return Err(
                            "--mode requires none or internal; External uses App manual testing"
                                .into(),
                        ),
                    };
            }
            Some("--timeout-ms") if !paths_only => {
                options.timeout_ms = arguments
                    .next()
                    .and_then(|value| value.to_str()?.parse().ok())
                    .filter(|value| (100..=120_000).contains(value))
                    .ok_or("--timeout-ms requires 100–120000")?;
            }
            Some("--sample-rate") if !paths_only => {
                options.sample_rate = arguments
                    .next()
                    .and_then(|value| value.to_str()?.parse().ok())
                    .filter(|value| pnds_app_lib::STANDARD_SAMPLE_RATES.contains(value))
                    .ok_or("--sample-rate requires a supported positive sample rate")?;
            }
            Some("--output-device") if !paths_only => {
                options.output_device = Some(
                    arguments
                        .next()
                        .and_then(|value| value.into_string().ok())
                        .filter(|value| !value.is_empty())
                        .ok_or("--output-device requires a device name")?,
                );
            }
            Some("--app-root") if !paths_only => {
                contents = Some(
                    PathBuf::from(arguments.next().ok_or("--app-root requires PNDS.app")?)
                        .join("Contents"),
                );
            }
            Some("--resources-root") if !paths_only => {
                shared = Some(PathBuf::from(
                    arguments
                        .next()
                        .ok_or("--resources-root requires a directory")?,
                ));
            }
            Some(value) if !paths_only && value.starts_with('-') => {
                return Err(format!("Unknown option: {value}"))
            }
            _ => {
                if project.replace(PathBuf::from(argument)).is_some() {
                    return Err("Exactly one project directory is required".into());
                }
            }
        }
    }
    let project = project.ok_or("A project directory is required")?;
    let contents = match contents {
        Some(path) => path,
        None => std::env::current_exe()
            .map_err(|error| error.to_string())?
            .parent()
            .and_then(|path| path.parent())
            .ok_or("Cannot locate installed App resources")?
            .to_path_buf(),
    };
    let shared = shared.unwrap_or_else(|| contents.join("Resources/shared-libraries"));
    Ok(Invocation {
        project,
        options,
        contents,
        shared,
        json,
    })
}

pub fn run_worker(arguments: Vec<OsString>) -> Result<u8, String> {
    let invocation = parse(arguments)?;
    let task_id = format!(
        "cli-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos()
    );
    let cancelled = Arc::new(AtomicBool::new(false));
    let cancellation = cancelled.clone();
    std::thread::spawn(move || {
        let mut byte = [0];
        let _ = std::io::stdin().read(&mut byte);
        cancellation.store(true, Ordering::Release);
    });
    let gate_path = default_gate_path()?;
    let lease = RuntimeLease::acquire(&gate_path);
    let report = match lease {
        Err(error) => ControlledCheckReport::not_executed(
            &task_id,
            &invocation.project,
            invocation.options.mode,
            error,
        ),
        Ok(lease) => match lease.begin_check(&task_id) {
            Err(error) => ControlledCheckReport::not_executed(
                &task_id,
                &invocation.project,
                invocation.options.mode,
                error,
            ),
            Ok(()) => {
                let resources = invocation.contents.join("Resources");
                let context = ControlledCheckContext {
                    task_id,
                    expected_source_identity: None,
                    app_data_dir: gate_path
                        .parent()
                        .ok_or("Invalid runtime directory")?
                        .join("controlled-checks"),
                    shared_root: Some(invocation.shared),
                    node_binary: invocation.contents.join("MacOS/node"),
                    scsynth_binary: Some(resources.join("scsynth")),
                    plugins_dir: Some(resources.join("plugins")),
                    master_synthdef: Some(resources.join("synthdefs/pndsMaster.scsyndef")),
                };
                let mut report = run_controlled_check(
                    &invocation.project,
                    &invocation.options,
                    &context,
                    &cancelled,
                    |progress| {
                        if !invocation.json {
                            let _ = writeln!(
                                std::io::stderr(),
                                "{:?}: {}",
                                progress.phase,
                                progress.path.unwrap_or_default()
                            );
                        }
                    },
                );
                let ownership = lease.finish_check(
                    report.cleanup.node_confirmed && report.cleanup.audio_confirmed,
                    &report.unresolved_groups,
                );
                report.record_ownership_result(ownership);
                report
            }
        },
    };
    let code = match report.status {
        ControlledCheckStatus::Passed => 0,
        ControlledCheckStatus::Cancelled => 130,
        _ => 1,
    };
    let mut output = std::io::stdout().lock();
    if invocation.json {
        serde_json::to_writer_pretty(&mut output, &report).map_err(|error| error.to_string())?;
        writeln!(output).map_err(|error| error.to_string())?;
    } else {
        writeln!(
            output,
            "PNDS controlled check: {:?}\nProject: {}\nTask: {}\nMode: {:?}",
            report.status, report.project_path, report.task_id, report.mode
        )
        .map_err(|error| error.to_string())?;
        if let Some(error) = &report.error {
            writeln!(output, "Reason: {error}").map_err(|error| error.to_string())?;
        }
        // Human output carries the complete same evidence, cleanup and scope.
        serde_json::to_writer_pretty(&mut output, &report).map_err(|error| error.to_string())?;
        writeln!(output).map_err(|error| error.to_string())?;
    }
    output.flush().map_err(|error| error.to_string())?;
    Ok(code)
}
