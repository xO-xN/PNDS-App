//! Shared types for the Tauri application.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::fmt;

// ============================================================================
// Session vocabulary
// ============================================================================

/// The session state machine's vocabulary (runtime-contract §8/§9).
/// Previously a bare `String` on `SessionInner`/`SessionSnapshot`, so a
/// typo compiled and only surfaced mid-performance. serde pins the wire
/// format (`idle | starting | ready | error | stopping`) — the frontend
/// snapshot type and runtime-contract.md see no change, but a missed
/// match arm stops compiling instead of shipping.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Idle,
    Starting,
    Ready,
    Error,
    Stopping,
}

impl SessionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            SessionStatus::Idle => "idle",
            SessionStatus::Starting => "starting",
            SessionStatus::Ready => "ready",
            SessionStatus::Error => "error",
            SessionStatus::Stopping => "stopping",
        }
    }
}

impl fmt::Display for SessionStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The audio mode domain (§6.1) shared by the manifest fields, the start
/// request and the session snapshot. The manifest's raw-JSON validation
/// (manifest.rs) still owns the creator-facing error strings; serde pins
/// the wire format (`internal | external | none`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum AudioMode {
    Internal,
    External,
    None,
}

impl AudioMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            AudioMode::Internal => "internal",
            AudioMode::External => "external",
            AudioMode::None => "none",
        }
    }
}

impl fmt::Display for AudioMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

// ============================================================================
// Preferences
// ============================================================================

/// Application preferences that persist to disk.
/// Only contains settings that should be saved between sessions.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppPreferences {
    /// Legacy light/dark/system field — load-only since v1.2.3: the App is
    /// fixed-light and the UI theme lives in `color_theme` below. Kept (and
    /// still validated) so pre-v1.2.3 files round-trip losslessly; reserved
    /// for a future "follow the system" mode.
    pub theme: String,
    /// v1.2.3 (issue #38): the app color theme driving the root node's
    /// `data-color-theme` attribute. Enum-validated at the save boundary;
    /// the legacy `midnight` (renamed to `brutal` in #41's second
    /// redirect) and `glass` (abandoned ticket) values stay accepted so
    /// stored preferences keep validating — the frontend maps renamed
    /// values to their successors and falls back to `pond` for anything
    /// its build cannot render. App-local, never touches project manifests.
    #[serde(default = "default_color_theme")]
    pub color_theme: String,
    /// User's preferred language (V1 ships English-only)
    /// If None, uses system locale detection
    pub language: Option<String>,
    /// Chosen CoreAudio output device name. `None` = system default.
    /// This is an app-local preference and never touches project manifests.
    #[serde(default)]
    pub output_device: Option<String>,
    /// Issue #20: global audio sample rate (Hz). The App's sole audio
    /// authority — scsynth boots and device capabilities resolve at this
    /// rate; a manifest's legacy `audio.scsynth.sampleRate` (when still
    /// present) is read and ignored. `None` = unset → 48000. App-local,
    /// never touches project manifests.
    #[serde(default)]
    pub sample_rate: Option<u32>,
    /// Last valid external OSC target per project id.
    #[serde(default)]
    pub osc_targets: HashMap<String, String>,
    /// Recently-opened project paths. Appended on open, kept across
    /// launches. Removing from the sidebar drops it here.
    #[serde(default)]
    pub recent_projects: Vec<String>,
    /// v1.1.2: one-level performance folders (set lists). Membership only —
    /// the trusted list above stays the master list, so deleting a folder
    /// merely returns its projects to the ungrouped section.
    #[serde(default)]
    pub project_folders: Vec<ProjectFolder>,
    /// v1.1.2 T6: user-chosen display name per project path (spec issue #10).
    /// Absent entry = derived path-basename name. Never touches manifests.
    #[serde(default)]
    pub project_display_names: HashMap<String, String>,
    /// v1.2.0 (issue #16): manifest-declared project name per path, learned
    /// on every successful preflight. The project listings show it (a user
    /// override above always wins) so a bundle install reads as its manifest
    /// name, not its `<id>-<version>` directory. Never touches manifests.
    #[serde(default)]
    pub project_manifest_names: HashMap<String, String>,
    /// v1.3.0 (issue #55): resource paths of the built-in utilities this
    /// install has already offered to the Utilities folder. Every shipped
    /// tool is offered exactly once — a newly shipped tool (TND joining
    /// in v1.3.0) reaches upgrade installs on their next launch, while a
    /// user's later removal sticks because the path stays recorded.
    /// Absent in pre-v1.3.0 files: a shipped path already present in the
    /// index counts as offered, so the record backfills silently.
    #[serde(default)]
    pub offered_utilities: Vec<String>,
    /// v1.4.0 (issue #58): this machine's node identity for telematic
    /// performance — global, set once in the Settings「节点」section, never
    /// per-project. `None`/blank = never set (the「设置节点」gate blocks
    /// telematic starts until all three node fields are filled).
    /// Whitespace-only counts as unset at the injection seam.
    #[serde(default)]
    pub node_name: Option<String>,
    /// v1.4.0 (issue #58): the telematic hub's full URL (`wss://host[:port]`).
    /// The token NEVER rides this string — it has its own field below and
    /// only ever travels in the injected `PNDS_HUB_TOKEN` variable.
    #[serde(default)]
    pub hub_url: Option<String>,
    /// v1.4.0 (issue #58): the hub access token, stored as its own field,
    /// displayed masked in the UI and never logged, never concatenated
    /// into URLs. Injection is the only consumer.
    #[serde(default)]
    pub hub_token: Option<String>,
    /// v1.4.0 (issue #58): telematic room group number (1..=3) per project
    /// manifest id — the user-visible「Room」dropdown. The App derives the
    /// wire room as `{manifest.id}_{group}`; absent entry = group 1.
    /// Persisted per project and never reset: crash recovery must land a
    /// machine back in its own group's room (ADR-0004).
    #[serde(default)]
    pub hub_rooms: HashMap<String, u8>,
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
            color_theme: default_color_theme(),
            language: None, // None means use system locale
            output_device: None,
            sample_rate: None,
            osc_targets: HashMap::new(),
            recent_projects: Vec::new(),
            project_folders: Vec::new(),
            project_display_names: HashMap::new(),
            project_manifest_names: HashMap::new(),
            offered_utilities: Vec::new(),
            node_name: None,
            hub_url: None,
            hub_token: None,
            hub_rooms: HashMap::new(),
        }
    }
}

impl AppPreferences {
    /// Issue #20: the App's effective audio sample rate. An unset
    /// preference resolves to [`DEFAULT_SAMPLE_RATE`] so existing installs
    /// see no behaviour change.
    pub fn effective_sample_rate(&self) -> u32 {
        self.sample_rate.unwrap_or(DEFAULT_SAMPLE_RATE)
    }
}

/// Issue #20: the rate an unset sample-rate preference resolves to. Also
/// the placeholder the manifest parser fills in for a legacy
/// `audio.scsynth.sampleRate` that is absent (see `ScsynthConfig`).
pub const DEFAULT_SAMPLE_RATE: u32 = 48_000;

/// v1.2.3 (issue #38): the value an absent `colorTheme` resolves to — the
/// Pond theme (id renamed from `lavender` in #91; the look is unchanged),
/// which is the pre-v1.2.3 look, so existing installs see no change.
pub fn default_color_theme() -> String {
    "pond".to_string()
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

/// v1.2.3 (issue #38): validates the color-theme preference against the
/// v1.2.3 theme enum. `midnight` (renamed to `brutal` in #41's second
/// redirect), `lavender` (renamed to `pond` in #91) and `glass` (the
/// abandoned liquid-glass ticket) stay valid persisted values; the
/// frontend maps the first two to their successors and the rest to Pond
/// at render, so no stored preference ever renders wrong. Unsupported
/// values are rejected at the save boundary.
pub fn validate_color_theme(theme: &str) -> Result<(), String> {
    match theme {
        "pond" | "lavender" | "sand" | "stage" | "brutal" | "midnight" | "glass" => Ok(()),
        _ => Err(
            "Invalid colorTheme: must be 'pond', 'lavender', 'sand', 'stage', 'brutal', 'midnight', or 'glass'"
                .to_string(),
        ),
    }
}

/// Issue #20: validates the global sample-rate preference. `Option<u32>`
/// already rules out non-integers and negatives at the serde boundary;
/// this rejects 0 with a readable error.
pub fn validate_sample_rate(rate: Option<u32>) -> Result<(), String> {
    match rate {
        None | Some(1..) => Ok(()),
        Some(0) => Err("Invalid sampleRate: must be a positive integer (Hz)".to_string()),
    }
}

/// #58: validates the per-project telematic room group numbers. The wire
/// room derives as `{manifest.id}_{group}`; groups outside 1..=3 have no
///「Room」dropdown entry and are rejected at the save boundary with a
/// readable error. Non-integers/negatives never get here — `u8` rejects
/// them at the serde boundary.
pub fn validate_hub_rooms(rooms: &HashMap<String, u8>) -> Result<(), String> {
    for (project_id, group) in rooms {
        if !(1..=3).contains(group) {
            return Err(format!(
                "Invalid hubRooms entry for \"{project_id}\": room group must be 1, 2 or 3 (got {group})"
            ));
        }
    }
    Ok(())
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
        assert_eq!(prefs.project_folders.len(), 1);
        assert!(prefs.project_display_names.is_empty());
    }

    /// v1.1.2 T6: preference files written before `projectDisplayNames`
    /// existed must load losslessly (serde default fills the field in).
    #[test]
    fn deserializes_preferences_without_project_display_names() {
        let legacy = r#"{
            "theme": "dark",
            "language": null,
            "recentProjects": ["/Users/test/Inarticulate III"],
            "projectFolders": [
                { "id": "f1", "name": "Gig", "projectPaths": ["/Users/test/Inarticulate III"] }
            ]
        }"#;
        let prefs: AppPreferences = serde_json::from_str(legacy).expect("legacy prefs parse");
        assert!(prefs.project_display_names.is_empty());
        assert_eq!(prefs.project_folders.len(), 1);
    }

    #[test]
    fn roundtrips_project_display_names() {
        let modern = r#"{
            "theme": "system",
            "language": null,
            "recentProjects": ["/a", "/b"],
            "projectDisplayNames": { "/a": "Opening Set" }
        }"#;
        let prefs: AppPreferences = serde_json::from_str(modern).expect("modern prefs parse");
        assert_eq!(
            prefs.project_display_names.get("/a").map(String::as_str),
            Some("Opening Set")
        );
        let reserialized = serde_json::to_string(&prefs).expect("prefs serialize");
        assert!(reserialized.contains("\"projectDisplayNames\""));
    }

    /// v1.2.0 (issue #16): preference files written before
    /// `projectManifestNames` existed must load losslessly (serde default).
    #[test]
    fn deserializes_preferences_without_project_manifest_names() {
        let legacy = r#"{
            "theme": "dark",
            "language": null,
            "recentProjects": ["/a"],
            "projectDisplayNames": { "/a": "Opening Set" }
        }"#;
        let prefs: AppPreferences = serde_json::from_str(legacy).expect("legacy prefs parse");
        assert!(prefs.project_manifest_names.is_empty());
        assert_eq!(prefs.project_display_names.len(), 1);
    }

    #[test]
    fn roundtrips_project_manifest_names() {
        let modern = r#"{
            "theme": "system",
            "language": null,
            "recentProjects": ["/bundles/inarticulate-iii-0.1.0"],
            "projectManifestNames": { "/bundles/inarticulate-iii-0.1.0": "Inarticulate III" }
        }"#;
        let prefs: AppPreferences = serde_json::from_str(modern).expect("modern prefs parse");
        assert_eq!(
            prefs
                .project_manifest_names
                .get("/bundles/inarticulate-iii-0.1.0")
                .map(String::as_str),
            Some("Inarticulate III")
        );
        let reserialized = serde_json::to_string(&prefs).expect("prefs serialize");
        assert!(reserialized.contains("\"projectManifestNames\""));
    }

    /// v1.3.0 (issue #55): preference files written before
    /// `offeredUtilities` existed must load losslessly (serde default).
    #[test]
    fn deserializes_preferences_without_offered_utilities() {
        let legacy = r#"{
            "theme": "dark",
            "language": null,
            "recentProjects": ["/a"]
        }"#;
        let prefs: AppPreferences = serde_json::from_str(legacy).expect("legacy prefs parse");
        assert!(prefs.offered_utilities.is_empty());
    }

    #[test]
    fn roundtrips_offered_utilities() {
        let modern = r#"{
            "theme": "system",
            "language": null,
            "recentProjects": [],
            "offeredUtilities": ["/Applications/PNDS.app/Contents/Resources/utilities/telematic-network-diagnostics"]
        }"#;
        let prefs: AppPreferences = serde_json::from_str(modern).expect("modern prefs parse");
        assert_eq!(prefs.offered_utilities.len(), 1);
        let reserialized = serde_json::to_string(&prefs).expect("prefs serialize");
        assert!(reserialized.contains("\"offeredUtilities\""));
    }

    /// Issue #20: preference files written before `sampleRate` existed must
    /// load losslessly (serde default fills the field in), and an unset
    /// preference resolves to the 48000 fallback.
    #[test]
    fn deserializes_preferences_without_sample_rate() {
        let legacy = r#"{
            "theme": "dark",
            "language": null,
            "recentProjects": ["/a"]
        }"#;
        let prefs: AppPreferences = serde_json::from_str(legacy).expect("legacy prefs parse");
        assert_eq!(prefs.sample_rate, None);
        assert_eq!(prefs.effective_sample_rate(), 48_000);
    }

    #[test]
    fn roundtrips_sample_rate() {
        let modern = r#"{
            "theme": "system",
            "language": null,
            "recentProjects": ["/a"],
            "sampleRate": 96000
        }"#;
        let prefs: AppPreferences = serde_json::from_str(modern).expect("modern prefs parse");
        assert_eq!(prefs.sample_rate, Some(96_000));
        assert_eq!(prefs.effective_sample_rate(), 96_000);
        let reserialized = serde_json::to_string(&prefs).expect("prefs serialize");
        assert!(reserialized.contains("\"sampleRate\""));
    }

    /// Issue #20: the save path must reject a non-positive sample rate with
    /// a readable error. Non-integers/negatives never get here — the
    /// `Option<u32>` type rejects them at the serde boundary.
    #[test]
    fn validates_sample_rate() {
        assert!(validate_sample_rate(None).is_ok());
        assert!(validate_sample_rate(Some(48_000)).is_ok());
        let err = validate_sample_rate(Some(0)).expect_err("0 Hz must be rejected");
        assert!(
            err.contains("positive integer"),
            "readable error, got: {err}"
        );
    }

    /// v1.2.3 (issue #38): preference files written before `colorTheme`
    /// existed must load as the default Lavender theme (serde default fills
    /// the field in), and the legacy `theme` field round-trips untouched.
    #[test]
    fn deserializes_preferences_without_color_theme() {
        let legacy = r#"{
            "theme": "dark",
            "language": null,
            "recentProjects": ["/a"]
        }"#;
        let prefs: AppPreferences = serde_json::from_str(legacy).expect("legacy prefs parse");
        assert_eq!(prefs.color_theme, "pond");
        assert_eq!(prefs.theme, "dark");
    }

    /// v1.2.3 (issue #38): a saved color theme survives a load-save round
    /// trip, and the field serializes camelCase like every other preference.
    #[test]
    fn roundtrips_color_theme() {
        let modern = r#"{
            "theme": "system",
            "colorTheme": "sand",
            "language": null,
            "recentProjects": ["/a"]
        }"#;
        let prefs: AppPreferences = serde_json::from_str(modern).expect("modern prefs parse");
        assert_eq!(prefs.color_theme, "sand");
        let reserialized = serde_json::to_string(&prefs).expect("prefs serialize");
        assert!(reserialized.contains("\"colorTheme\":\"sand\""));
    }

    /// v1.2.3 (issue #38): the whole v1.2.3 theme enum validates — the
    /// shipped names plus the legacy persisted values (`midnight` renamed
    /// to `brutal`, `lavender` renamed to `pond` in #91, `glass`
    /// abandoned); anything else is rejected with a readable error at
    /// the save boundary.
    #[test]
    fn validates_color_theme() {
        for theme in [
            "pond", "lavender", "sand", "stage", "brutal", "midnight", "glass",
        ] {
            assert!(validate_color_theme(theme).is_ok(), "{theme} must be valid");
        }
        assert_eq!(default_color_theme(), "pond");
        let err = validate_color_theme("banana").expect_err("must be rejected");
        assert!(
            err.contains("Invalid colorTheme"),
            "readable error, got: {err}"
        );
    }

    /// v1.4.0 (#58): preference files written before the telematic node
    /// fields existed must load losslessly (serde defaults fill them in).
    #[test]
    fn deserializes_preferences_without_node_fields() {
        let legacy = r#"{
            "theme": "dark",
            "language": null,
            "recentProjects": ["/a"]
        }"#;
        let prefs: AppPreferences = serde_json::from_str(legacy).expect("legacy prefs parse");
        assert_eq!(prefs.node_name, None);
        assert_eq!(prefs.hub_url, None);
        assert_eq!(prefs.hub_token, None);
        assert!(prefs.hub_rooms.is_empty());
    }

    /// v1.4.0 (#58): the node identity trio and the per-project room groups
    /// survive a load-save round trip, each in its own field — the token
    /// never rides the hub URL.
    #[test]
    fn roundtrips_node_fields_and_hub_rooms() {
        let modern = r#"{
            "theme": "system",
            "language": null,
            "recentProjects": [],
            "nodeName": "Concert-MacBook",
            "hubUrl": "wss://hub.example.org:3000",
            "hubToken": "secret-token",
            "hubRooms": { "telematic-network-diagnostics": 2, "inarticulate-iii": 3 }
        }"#;
        let prefs: AppPreferences = serde_json::from_str(modern).expect("modern prefs parse");
        assert_eq!(prefs.node_name.as_deref(), Some("Concert-MacBook"));
        assert_eq!(prefs.hub_url.as_deref(), Some("wss://hub.example.org:3000"));
        assert_eq!(prefs.hub_token.as_deref(), Some("secret-token"));
        assert_eq!(
            prefs.hub_rooms.get("telematic-network-diagnostics"),
            Some(&2)
        );
        let reserialized = serde_json::to_string(&prefs).expect("prefs serialize");
        assert!(reserialized.contains("\"nodeName\":\"Concert-MacBook\""));
        assert!(reserialized.contains("\"hubToken\":\"secret-token\""));
        assert!(reserialized.contains("\"hubRooms\""));
        // The token stays its own field — it never leaks into the URL.
        assert_eq!(prefs.hub_url.unwrap().contains("secret-token"), false);
    }

    /// v1.4.0 (#58): the save boundary rejects room groups outside the
    ///「Room」dropdown's 1..=3 with a readable error naming the project.
    #[test]
    fn validates_hub_rooms() {
        let ok = [
            ("a".to_string(), 1u8),
            ("b".to_string(), 2),
            ("c".to_string(), 3),
        ]
        .into_iter()
        .collect();
        assert!(validate_hub_rooms(&ok).is_ok());

        let bad = [("telematic-network-diagnostics".to_string(), 0u8)]
            .into_iter()
            .collect();
        let err = validate_hub_rooms(&bad).expect_err("group 0 must be rejected");
        assert!(err.contains("room group must be 1, 2 or 3"), "got: {err}");
        assert!(err.contains("telematic-network-diagnostics"), "got: {err}");

        let bad = [("x".to_string(), 4u8)].into_iter().collect();
        assert!(validate_hub_rooms(&bad).is_err());
    }
}
