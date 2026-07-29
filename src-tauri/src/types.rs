//! Shared types for the Tauri application.

use serde::{Deserialize, Serialize};
use specta::Type;

// ============================================================================
// Preferences
// ============================================================================

/// Application preferences that persist to disk.
/// Only contains settings that should be saved between sessions.
/// Audio device and per-project OSC targets arrive in task-5.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AppPreferences {
    pub theme: String,
    /// User's preferred language (V1 ships English-only)
    /// If None, uses system locale detection
    pub language: Option<String>,
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            language: None, // None means use system locale
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
