//! Project-related commands: preflight validation and orphan cleanup.
//!
//! Implements the startup sequence stage that runs before any process is
//! spawned (docs/zh-CN/reference/runtime-contract.md §8 steps 1–2 and §11
//! orphan cleanup; preflight checklist in docs/developer/app-behavior.md).

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
/// Children of the live session are never touched (v1.2.3, issue #37).
#[tauri::command]
#[specta::specta]
pub async fn cleanup_orphaned_processes(
    app: AppHandle,
    state: State<'_, SessionManager>,
) -> Result<u32, String> {
    let dir = app_data_dir(&app)?;
    let live_pids = state.active_child_pids();
    crate::project::children::ChildRegistry::new(dir).cleanup_orphans(&live_pids)
}

/// Full preflight for a candidate project directory (§8 step 2):
/// orphan cleanup → manifest validation → dependency check → port check.
/// Returns the validated manifest so the frontend can show project info.
///
/// v1.2.3 (issue #37): preflight never harms the running session — its
/// children are exempt from the orphan cleanup, and ports held only by
/// them pass (they are released when the session stops). Ports held by
/// any other process still conflict.
#[tauri::command]
#[specta::specta]
pub async fn preflight_project(
    app: AppHandle,
    state: State<'_, SessionManager>,
    path: String,
) -> Result<Manifest, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Project directory not found: {path}"));
    }

    let live_pids = state.active_child_pids();

    // §11: stale children must be gone before port checks are meaningful.
    let dir = app_data_dir(&app)?;
    let terminated =
        crate::project::children::ChildRegistry::new(dir.clone()).cleanup_orphans(&live_pids)?;
    if terminated > 0 {
        log::info!("Preflight terminated {terminated} orphaned process(es)");
    }

    let manifest = load_manifest(&root)?;
    preflight::check_dependencies(&root)?;
    preflight::check_ports_available(
        manifest.score_server.performer_port,
        manifest.score_server.monitor_port,
        &live_pids,
    )?;

    log::info!(
        "Preflight passed for project \"{}\" at {path}",
        manifest.name
    );
    Ok(manifest)
}

/// Starts the score server of a validated project (§8). Progress and
/// health updates are delivered via `pnds:session` events. `osc_target` is
/// required (and validated) only for external mode (§9).
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

/// Stops the running score server (§11). Idempotent.
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

/// §7.5: set the master volume (0-100, dB-linear; live via OSC in internal
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

/// Usable LAN IPv4 addresses (§4). The user must choose when more than
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

/// Issue #21: the sample rates the Settings Audio section offers — the
/// standard rates supported across all enumerated output devices
/// (deduplicated, ascending). Enumeration failure or an empty union already
/// falls back to the full standard list inside, so the frontend never has
/// to handle an error or an empty list.
#[tauri::command]
#[specta::specta]
pub async fn list_supported_sample_rates() -> Vec<u32> {
    crate::project::audio::supported_sample_rates()
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
/// on the freshly-resolved occupant (same escalation as §11 child cleanup).
/// Returns the port's post-release status; the caller refreshes from it.
#[tauri::command]
#[specta::specta]
pub async fn release_port(port: u16) -> Result<PortStatus, String> {
    Ok(crate::project::ports::release_port(port))
}
