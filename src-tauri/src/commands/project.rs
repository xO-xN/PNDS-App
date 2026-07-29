//! Project-related commands: preflight validation and orphan cleanup.
//!
//! Implements the startup sequence stage that runs before any process is
//! spawned (docs/PNDS_APP_REQUIREMENTS.md §4, §5, §7, §8.2).

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::project::manifest::{load_manifest, Manifest};
use crate::project::preflight;

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
    preflight::cleanup_orphaned_processes(&dir)
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
    let terminated = preflight::cleanup_orphaned_processes(&dir)?;
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
