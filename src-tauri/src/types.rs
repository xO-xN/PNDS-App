//! Shared types for the Tauri application.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;

// ============================================================================
// Preferences
// ============================================================================

/// Application preferences that persist to disk.
/// Only contains settings that should be saved between sessions.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppPreferences {
    pub theme: String,
    /// User's preferred language (V1 ships English-only)
    /// If None, uses system locale detection
    pub language: Option<String>,
    /// §6.5: chosen CoreAudio output device name. `None` = system default.
    /// This is an app-local preference and never touches project manifests.
    #[serde(default)]
    pub output_device: Option<String>,
    /// §6.6: last valid external OSC target per project id.
    #[serde(default)]
    pub osc_targets: HashMap<String, String>,
    /// §4.1: recently-opened (and trusted) project paths. Appended on first
    /// trust, kept across launches. Removing from the sidebar drops it here.
    #[serde(default)]
    pub recent_projects: Vec<String>,
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            language: None, // None means use system locale
            output_device: None,
            osc_targets: HashMap::new(),
            recent_projects: Vec::new(),
        }
    }
}

// ============================================================================
// Validation Functions
// ============================================================================

/// Validates theme value.
pub fn validate_theme(theme: &str) -> Result<(), String> {
    match theme {
        "light" | "dark" | "system" => Ok(()),
        _ => Err("Invalid theme: must be 'light', 'dark', or 'system'".to_string()),
    }
}
