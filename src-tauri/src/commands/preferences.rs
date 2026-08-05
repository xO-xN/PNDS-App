//! Preferences management commands.
//!
//! Handles loading and saving user preferences to disk, with an in-memory
//! cache: the file is read at most once per app run (the first request),
//! everything after serves the cached copy. Startup, preflight and
//! session start each load preferences — a cache removes those repeated
//! disk reads from the critical path.

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::types::{validate_theme, AppPreferences};

/// In-memory cache of the preferences file. Managed by Tauri.
#[derive(Default)]
pub struct PreferencesCache {
    cached: Mutex<Option<AppPreferences>>,
}

/// Gets the path to the preferences file.
fn get_preferences_path<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;

    // Ensure the directory exists
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;

    Ok(app_data_dir.join("preferences.json"))
}

/// Loads user preferences (sync variant for internal callers), caching
/// the parsed value in memory so repeated reads skip the disk.
///
/// Generic over the runtime so session start stays testable under
/// `tauri::test::mock_app()`.
pub fn load_preferences_sync<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<AppPreferences, String> {
    let cache = app.state::<PreferencesCache>();
    if let Some(prefs) = cache
        .cached
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
    {
        return Ok(prefs);
    }

    let prefs_path = get_preferences_path(app)?;
    let prefs = if !prefs_path.exists() {
        AppPreferences::default()
    } else {
        let contents = std::fs::read_to_string(&prefs_path).map_err(|e| {
            log::error!("Failed to read preferences file: {e}");
            format!("Failed to read preferences file: {e}")
        })?;

        serde_json::from_str(&contents).map_err(|e| {
            log::error!("Failed to parse preferences JSON: {e}");
            format!("Failed to parse preferences: {e}")
        })?
    };

    *cache.cached.lock().unwrap_or_else(|e| e.into_inner()) = Some(prefs.clone());
    Ok(prefs)
}

/// Loads user preferences from disk.
/// Returns default preferences if the file doesn't exist.
#[tauri::command]
#[specta::specta]
pub async fn load_preferences(app: AppHandle) -> Result<AppPreferences, String> {
    log::debug!("Loading preferences from disk");
    let preferences = load_preferences_sync(&app)?;
    log::info!("Successfully loaded preferences");
    Ok(preferences)
}

/// Saves user preferences to disk.
/// Uses atomic write (temp file + rename) to prevent corruption.
#[tauri::command]
#[specta::specta]
pub async fn save_preferences(app: AppHandle, preferences: AppPreferences) -> Result<(), String> {
    // Validate theme value
    validate_theme(&preferences.theme)?;

    log::debug!("Saving preferences to disk: {preferences:?}");
    let prefs_path = get_preferences_path(&app)?;

    let json_content = serde_json::to_string_pretty(&preferences).map_err(|e| {
        log::error!("Failed to serialize preferences: {e}");
        format!("Failed to serialize preferences: {e}")
    })?;

    // Write to a temporary file first, then rename (atomic operation)
    let temp_path = prefs_path.with_extension("tmp");

    std::fs::write(&temp_path, json_content).map_err(|e| {
        log::error!("Failed to write preferences file: {e}");
        format!("Failed to write preferences file: {e}")
    })?;

    if let Err(rename_err) = std::fs::rename(&temp_path, &prefs_path) {
        log::error!("Failed to finalize preferences file: {rename_err}");
        // Clean up the temp file to avoid leaving orphaned files on disk
        if let Err(remove_err) = std::fs::remove_file(&temp_path) {
            log::warn!("Failed to remove temp file after rename failure: {remove_err}");
        }
        return Err(format!("Failed to finalize preferences file: {rename_err}"));
    }

    // Update the in-memory cache so later reads see the new values.
    let cache = app.state::<PreferencesCache>();
    *cache.cached.lock().unwrap_or_else(|e| e.into_inner()) = Some(preferences.clone());

    log::info!("Successfully saved preferences to {prefs_path:?}");
    Ok(())
}
