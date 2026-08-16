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
    /// v1.1.2: one-level performance folders (set lists). Membership only —
    /// the trusted list above stays the master list, so deleting a folder
    /// merely returns its projects to the ungrouped section.
    #[serde(default)]
    pub project_folders: Vec<ProjectFolder>,
}

/// A named one-level group of project paths (spec issue #4).
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFolder {
    pub id: String,
    pub name: String,
    pub project_paths: Vec<String>,
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            language: None, // None means use system locale
            output_device: None,
            osc_targets: HashMap::new(),
            recent_projects: Vec::new(),
            project_folders: Vec::new(),
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

#[cfg(test)]
mod tests {
    use super::*;

    /// v1.1.2: preference files written before `projectFolders` existed must
    /// load losslessly (serde defaults fill the field in).
    #[test]
    fn deserializes_preferences_without_project_folders() {
        let legacy = r#"{
            "theme": "dark",
            "language": null,
            "outputDevice": "BlackHole 16ch",
            "oscTargets": { "inarticulate-iii": "127.0.0.1:3333" },
            "recentProjects": ["/Users/test/Inarticulate III"]
        }"#;
        let prefs: AppPreferences = serde_json::from_str(legacy).expect("legacy prefs parse");
        assert!(prefs.project_folders.is_empty());
        assert_eq!(prefs.recent_projects, vec!["/Users/test/Inarticulate III"]);
        assert_eq!(prefs.output_device.as_deref(), Some("BlackHole 16ch"));
    }

    #[test]
    fn deserializes_preferences_with_project_folders() {
        let modern = r#"{
            "theme": "system",
            "language": null,
            "recentProjects": ["/a", "/b"],
            "projectFolders": [
                { "id": "f1", "name": "Gig", "projectPaths": ["/a"] }
            ]
        }"#;
        let prefs: AppPreferences = serde_json::from_str(modern).expect("modern prefs parse");
        assert_eq!(
            prefs.project_folders,
            vec![ProjectFolder {
                id: "f1".to_string(),
                name: "Gig".to_string(),
                project_paths: vec!["/a".to_string()],
            }]
        );
    }
}
