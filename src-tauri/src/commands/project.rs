//! Project-related commands: preflight validation and orphan cleanup.
//!
//! Implements the startup sequence stage that runs before any process is
//! spawned (docs/PNDS_APP_REQUIREMENTS.md §4, §5, §7, §8.2).

use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

use crate::project::manifest::{load_manifest, Manifest};
use crate::project::ports::PortStatus;
use crate::project::preflight;
use crate::project::session::{SessionManager, SessionSnapshot};

/// Resolves (and creates) the app data directory used for session records.
pub(crate) fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
    Ok(dir)
}

/// Cleans up child processes left behind by an abnormal previous exit.
/// Also runs automatically at app startup and at the start of preflight.
#[tauri::command]
#[specta::specta]
pub async fn cleanup_orphaned_processes(app: AppHandle) -> Result<u32, String> {
    let dir = app_data_dir(&app)?;
    crate::project::children::ChildRegistry::new(dir).cleanup_orphans()
}

/// Full preflight for a candidate project directory (§8.1 step 1):
/// orphan cleanup → manifest validation → dependency check → port check.
/// Returns the validated manifest so the frontend can show project info.
#[tauri::command]
#[specta::specta]
pub async fn preflight_project(app: AppHandle, path: String) -> Result<Manifest, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Project directory not found: {path}"));
    }

    // §8.2: stale children must be gone before port checks are meaningful.
    let dir = app_data_dir(&app)?;
    let terminated = crate::project::children::ChildRegistry::new(dir.clone()).cleanup_orphans()?;
    if terminated > 0 {
        log::info!("Preflight terminated {terminated} orphaned process(es)");
    }

    let manifest = load_manifest(&root)?;
    preflight::check_dependencies(&root)?;
    preflight::check_ports_available(
        manifest.score_server.performer_port,
        manifest.score_server.monitor_port,
    )?;

    log::info!(
        "Preflight passed for project \"{}\" at {path}",
        manifest.name
    );
    Ok(manifest)
}

/// Starts the score server of a validated project (§8.1). Progress and
/// health updates are delivered via `pnds:session` events. `osc_target` is
/// required (and validated) only for external mode (§6.6).
#[tauri::command]
#[specta::specta]
pub async fn start_project(
    app: AppHandle,
    state: State<'_, SessionManager>,
    path: String,
    mode: String,
    lan_ip: String,
    osc_target: Option<String>,
) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    state.start(app, dir, path, mode, lan_ip, osc_target)
}

/// Stops the running score server (§8.2). Idempotent.
#[tauri::command]
#[specta::specta]
pub async fn stop_project(app: AppHandle, state: State<'_, SessionManager>) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    state.stop(&app, &dir)
}

/// Current session snapshot (frontend restores state on load).
#[tauri::command]
#[specta::specta]
pub async fn get_session_state(
    state: State<'_, SessionManager>,
) -> Result<SessionSnapshot, String> {
    Ok(state.snapshot())
}

/// §6.4: set the master volume (0-100, dB-linear; live via OSC in internal
/// mode). External/none modes store the value but apply nothing.
#[tauri::command]
#[specta::specta]
pub async fn set_master_volume(
    app: AppHandle,
    state: State<'_, SessionManager>,
    percent: f32,
) -> Result<(), String> {
    state.set_master_volume(&app, percent)
}

/// Usable LAN IPv4 addresses (§7). The user must choose when more than
/// one exists; loopback is never offered.
#[tauri::command]
#[specta::specta]
pub async fn list_lan_addresses() -> Result<Vec<String>, String> {
    crate::project::session::list_lan_addresses()
}

/// §7.6: CoreAudio output devices with their usable output channel count
/// at the given project sample rate, plus the system default. Always
/// re-enumerates (the settings UI must see hot-plugged devices), while
/// session start reuses the process cache.
#[tauri::command]
#[specta::specta]
pub async fn list_output_devices(
    sample_rate: u32,
) -> Result<crate::project::audio::AudioDeviceCapabilities, String> {
    crate::project::audio::refresh_output_devices(sample_rate)
}

/// v1.2.0 (issue #14): occupancy of one TCP port — the listening process's
/// pid, name and full command line, or None when free. The Settings port
/// section queries this on open / manual refresh (no polling).
#[tauri::command]
#[specta::specta]
pub async fn check_port_status(port: u16) -> Result<PortStatus, String> {
    Ok(crate::project::ports::port_status(port))
}

/// v1.2.0 (issue #14): release an occupied port — SIGTERM → grace → SIGKILL
/// on the freshly-resolved occupant (same escalation as §8.2 child cleanup).
/// Returns the port's post-release status; the caller refreshes from it.
#[tauri::command]
#[specta::specta]
pub async fn release_port(port: u16) -> Result<PortStatus, String> {
    Ok(crate::project::ports::release_port(port))
}
