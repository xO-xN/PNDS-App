//! #139: HTTPS certificate-material commands — thin AppHandle wrappers
//! over `crate::https`. The domain/port preference fields ride the normal
//! preferences round-trip; only the material (chain + private key) lives
//! in the backend's protected storage and never crosses to React.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::https::{
    clear_stored_material, import_material, public_trust_anchors, summarize_stored,
    HttpsValidationOutcome,
};

/// The app data dir for the material's protected storage. Same base the
/// preferences and child registry use.
fn app_data_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))
}

/// Reads the stored material and re-derives its standing against the
/// CURRENT saved domain preference and clock. `Ok(None)` = nothing
/// imported yet.
#[tauri::command]
#[specta::specta]
pub async fn load_https_certificate(
    app: AppHandle,
) -> Result<Option<HttpsValidationOutcome>, String> {
    let dir = app_data_dir(&app)?;
    let domain = crate::commands::preferences::load_preferences_sync(&app)?.https_domain;
    summarize_stored(
        &dir,
        domain.as_deref(),
        public_trust_anchors(),
        std::time::SystemTime::now(),
    )
}

/// Validates the two picked files (full chain + matching key) against
/// the given domain and, only on success, atomically replaces the
/// stored material. Failure leaves the previous material untouched.
#[tauri::command]
#[specta::specta]
pub async fn import_https_certificate(
    app: AppHandle,
    domain: String,
    certificate_pem_path: String,
    private_key_pem_path: String,
) -> Result<HttpsValidationOutcome, String> {
    let dir = app_data_dir(&app)?;
    import_material(
        &dir,
        &domain,
        PathBuf::from(certificate_pem_path).as_path(),
        PathBuf::from(private_key_pem_path).as_path(),
        public_trust_anchors(),
        std::time::SystemTime::now(),
    )
}

/// Removes the stored material (the settings「清除」button). Plain
/// config fields survive in preferences — this only clears the
/// certificate/key file.
#[tauri::command]
#[specta::specta]
pub async fn clear_https_certificate(app: AppHandle) -> Result<bool, String> {
    clear_stored_material(&app_data_dir(&app)?)
}
