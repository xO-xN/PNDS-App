//! System-level commands: reveal app-managed directories in Finder, and
//! probe the system's WebKit vintage for the startup baseline gate.
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

/// v1.4.2 (#110): the installed Safari version — the user-facing proxy for
/// the system WebKit. WKWebView's `navigator.userAgent` is frozen at
/// `AppleWebKit/605.1.15` (since Safari 13), so the frontend cannot learn
/// the engine version from JS; Safari ships every system WebKit update, so
/// its bundle version ("15.1" / "16.4" / "17.6" …) is the number the
/// baseline contract speaks in. `None` when the bundle is missing or
/// carries no readable version — the frontend treats unknown as "stay
/// silent", keeping the zero-disturbance half of the contract.
#[tauri::command]
#[specta::specta]
pub async fn system_safari_version() -> Result<Option<String>, String> {
    Ok(safari_version_string())
}

#[cfg(target_os = "macos")]
fn safari_version_string() -> Option<String> {
    use objc2_foundation::{NSBundle, NSString};

    let bundle = NSBundle::bundleWithPath(&NSString::from_str("/Applications/Safari.app"))?;
    let version = bundle
        .infoDictionary()?
        .objectForKey(&NSString::from_str("CFBundleShortVersionString"))?
        .downcast::<NSString>()
        .ok()?;
    Some(version.to_string())
}

#[cfg(not(target_os = "macos"))]
fn safari_version_string() -> Option<String> {
    // The app only ships on macOS; a build elsewhere has no Safari bundle
    // to read, which lands on the same "unknown → silent" path as an
    // unreadable bundle.
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// #110: the value the baseline check consumes must be the dotted
    /// Safari version ("16.4"), not some other plist field — every macOS
    /// host that can run this test ships a readable Safari bundle.
    #[cfg(target_os = "macos")]
    #[test]
    fn safari_version_is_dotted_numeric() {
        let version =
            safari_version_string().expect("system Safari bundle should be readable on macOS");
        assert!(
            version
                .split('.')
                .all(|part| { !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()) }),
            "unexpected Safari version string: {version}"
        );
    }
}
