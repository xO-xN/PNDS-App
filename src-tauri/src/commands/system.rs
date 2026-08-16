//! System-level commands: reveal app-managed directories in Finder.
//!
//! v1.2.0 (issue #13): the Settings About section offers one-click access to
//! the data directory (session records, preferences) and the log directory
//! (tauri-plugin-log's LogDir target) so support material is easy to collect
//! on site.

use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// Reveals the app data directory in Finder, creating it if needed.
#[tauri::command]
#[specta::specta]
pub async fn open_app_data_dir(app: AppHandle) -> Result<(), String> {
    // Same resolver as the session-record paths, so the Finder lands on the
    // exact directory the app writes to.
    let dir = super::project::app_data_dir(&app)?;
    app.opener()
        .reveal_item_in_dir(&dir)
        .map_err(|e| format!("Failed to reveal app data directory: {e}"))
}

/// Reveals the app log directory in Finder. This is the root the log plugin
/// writes to (macOS: `~/Library/Logs/<bundle-id>`); it is created on demand
/// because a fresh install may not have logged anything yet.
#[tauri::command]
#[specta::specta]
pub async fn open_app_log_dir(app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to resolve app log directory: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app log directory: {e}"))?;
    app.opener()
        .reveal_item_in_dir(&dir)
        .map_err(|e| format!("Failed to reveal app log directory: {e}"))
}
