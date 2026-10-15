//! Offline static diagnostics. Linking the App library does not run the App.
use pnds_app_lib::{diagnose_project, DiagnosticReport};
use std::io::{self, Write};
use std::path::PathBuf;
use std::process::ExitCode;

#[path = "pnds/controlled.rs"]
mod controlled;

const USAGE: &str = "PNDS static project diagnostics\n\nUsage: pnds check <project-directory> [--json] [--resources-root <shared-library-directory>]\n       pnds check <project-directory> --run [--mode none|internal] [--compile] [--json]\n            [--timeout-ms 30000] [--sample-rate 48000] [--output-device NAME]\n            [--app-root PNDS.app] [--resources-root <shared-library-directory>]\n       pnds --help\n       pnds --version\n\nResources default to ../Resources/shared-libraries beside this executable.\n--resources-root overrides the shared-library directory for an explicit installation.\nUse -- before a project path that begins with a dash.\n\nExit codes: 0 = selected static checks passed; 1 = static checks failed or incomplete;\n            2 = invalid invocation or output error.\nRuntime checks use saved temporary copies and reject an active performance/check.\nNone is the default; Internal requires --mode internal. External uses App manual testing.\nCtrl-C/SIGTERM cancels and waits for cleanup. Runtime cancellation exits 130.\nRuntime sidecars come only from the installed or explicit --app-root layout.\nStatic checks never verify execution, pages, devices, or sound.\n";

fn write_text(text: &str) -> Result<u8, String> {
    let mut output = io::stdout().lock();
    output
        .write_all(text.as_bytes())
        .and_then(|()| output.flush())
        .map_err(|error| format!("Cannot write output: {error}"))?;
    Ok(0)
}

fn run() -> Result<u8, String> {
    let invocation: Vec<_> = std::env::args_os().skip(1).collect();
    if invocation
        .first()
        .is_some_and(|argument| argument == "__controlled-check-worker")
    {
        return controlled::run_worker(invocation.into_iter().skip(1).collect());
    }
    if invocation
        .first()
        .is_some_and(|argument| argument == "check")
        && invocation
            .iter()
            .skip(1)
            .take_while(|argument| *argument != "--")
            .any(|argument| argument == "--run")
    {
        return controlled::supervise(invocation.into_iter().skip(1).collect());
    }
    let mut args = std::env::args_os().skip(1);
    let command = args.next().ok_or_else(|| USAGE.to_owned())?;
    if command == "--help" || command == "-h" {
        return write_text(USAGE);
    }
    if command == "--version" {
        return write_text(&format!("pnds {}\n", env!("CARGO_PKG_VERSION")));
    }
    if command != "check" {
        return Err(format!(
            "Unknown command: {}\n\n{USAGE}",
            command.to_string_lossy()
        ));
    }

    let mut project = None;
    let mut resources = None;
    let mut json = false;
    let mut paths_only = false;
    while let Some(argument) = args.next() {
        match argument.to_str() {
            Some("--") if !paths_only => paths_only = true,
            Some("--help" | "-h") if !paths_only => {
                return write_text(USAGE);
            }
            Some("--json") if !paths_only => json = true,
            Some("--resources-root") if !paths_only => {
                resources = Some(PathBuf::from(
                    args.next().ok_or("--resources-root requires a directory")?,
                ));
            }
            Some(value) if !paths_only && value.starts_with('-') => {
                return Err(format!("Unknown option: {value}\n\n{USAGE}"));
            }
            _ => {
                if project.replace(PathBuf::from(argument)).is_some() {
                    return Err(format!(
                        "Exactly one project directory is required\n\n{USAGE}"
                    ));
                }
            }
        }
    }
    let project = project.ok_or_else(|| format!("A project directory is required\n\n{USAGE}"))?;
    let resources = match resources {
        Some(root) => root,
        None => {
            let executable = std::env::current_exe()
                .and_then(|path| path.canonicalize())
                .map_err(|error| format!("Cannot locate this executable: {error}"))?;
            executable
                .parent()
                .and_then(|path| path.parent())
                .ok_or("Cannot locate the installed resource directory")?
                .join("Resources/shared-libraries")
        }
    };
    // Always explicit, including when absent: the core's development fallback
    // must never make the installed CLI depend on a maintainer checkout.
    let report = diagnose_project(&project, Some(&resources));
    let mut output = io::stdout().lock();
    if json {
        serde_json::to_writer_pretty(&mut output, &report)
            .map_err(|error| format!("Cannot write diagnostic JSON: {error}"))?;
        writeln!(output).map_err(|error| format!("Cannot write diagnostic JSON: {error}"))?;
    } else {
        write_human(&mut output, &report)
            .map_err(|error| format!("Cannot write diagnostic report: {error}"))?;
    }
    output
        .flush()
        .map_err(|error| format!("Cannot write diagnostic report: {error}"))?;
    Ok(u8::from(!report.static_passed))
}

fn write_human(output: &mut impl Write, report: &DiagnosticReport) -> io::Result<()> {
    writeln!(output, "PNDS static project check")?;
    writeln!(output, "Project: {}", report.project_path)?;
    if let Some(project) = &report.project {
        writeln!(
            output,
            "Identity: {} ({}) {}",
            project.name, project.id, project.version
        )?;
    }
    writeln!(
        output,
        "Checker: {} / report schema {}",
        report.checker_version, report.schema_version
    )?;
    writeln!(output, "Input fingerprint: {}", report.input_fingerprint)?;
    writeln!(output, "Static checks passed: {}", report.static_passed)?;
    for check in &report.checks {
        writeln!(
            output,
            "[{:?}] {}: {}",
            check.status, check.code, check.reason
        )?;
    }
    for issue in &report.issues {
        writeln!(
            output,
            "[{:?}] {}: {}",
            issue.severity, issue.code, issue.reason
        )?;
        if let Some(field) = &issue.field {
            writeln!(output, "  Field: {field}")?;
        }
        if let Some(path) = &issue.path {
            writeln!(output, "  Path: {path}")?;
        }
    }
    for reason in &report.unverified {
        writeln!(output, "[Unverified] {reason}")?;
    }
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(code) => ExitCode::from(code),
        Err(error) => {
            let _ = writeln!(io::stderr().lock(), "{error}");
            ExitCode::from(2)
        }
    }
}
