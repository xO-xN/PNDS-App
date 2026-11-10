//! App-lifetime public listener preparation and read-only facts.
use crate::project::session::{PublicEntrySnapshot, SessionManager};
use std::net::Ipv4Addr;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
#[specta::specta]
pub async fn sync_host_entry(
    app: AppHandle,
    lan_ip: Option<String>,
) -> Result<PublicEntrySnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = app.state::<SessionManager>();
        let preferences = super::preferences::load_preferences_sync(&app)?;
        let Some(ip) = lan_ip else {
            return Ok(manager.public_entry_snapshot());
        };
        let ip: Ipv4Addr = ip
            .parse()
            .map_err(|error| format!("participation.errors.invalidHostAddress: {error}"))?;
        if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() {
            return Err("participation.errors.invalidHostAddress".into());
        }
        let data = super::project::app_data_dir(&app)?;
        Ok(manager.prepare_host_entry(&data, preferences.node_name.as_deref().unwrap_or(""), ip))
    })
    .await
    .map_err(|error| format!("participation.errors.hostEntryRuntime: {error}"))?
}

#[tauri::command]
#[specta::specta]
pub async fn get_host_entry(
    state: State<'_, SessionManager>,
) -> Result<PublicEntrySnapshot, String> {
    Ok(state.public_entry_snapshot())
}

#[tauri::command]
#[specta::specta]
pub async fn get_host_entry_qr(app: AppHandle, expected_url: String) -> Result<String, String> {
    app.state::<SessionManager>()
        .public_entry_qr_url(&expected_url)?;
    let encoder_app = app.clone();
    let url = expected_url.clone();
    let image = tauri::async_runtime::spawn_blocking(move || {
        crate::project::qr::render_for_app(&encoder_app, &url)
    })
    .await
    .map_err(|error| format!("The App QR encoder task failed: {error}"))??;
    app.state::<SessionManager>()
        .public_entry_qr_url(&expected_url)?;
    Ok(image)
}
