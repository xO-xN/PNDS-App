use crate::controller_mapping::{
    self, ControllerMappingRange, ControllerMappingSnapshot, ControllerMidiPort,
    ControllerOscSettings,
};
use tauri::{AppHandle, Webview};

fn main_only(webview: &Webview) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Only the main shell controls mapping".into());
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_controller_mapping(
    app: AppHandle,
    webview: Webview,
) -> Result<ControllerMappingSnapshot, String> {
    main_only(&webview)?;
    controller_mapping::snapshot(&app)
}

#[tauri::command]
#[specta::specta]
pub async fn configure_controller_osc(
    app: AppHandle,
    webview: Webview,
    settings: ControllerOscSettings,
) -> Result<ControllerMappingSnapshot, String> {
    main_only(&webview)?;
    controller_mapping::configure_osc(app, settings).await
}

#[tauri::command]
#[specta::specta]
pub async fn set_controller_learning(
    app: AppHandle,
    webview: Webview,
    page: u32,
    learning: bool,
) -> Result<ControllerMappingSnapshot, String> {
    main_only(&webview)?;
    controller_mapping::set_learning(app, page, learning).await
}

#[tauri::command]
#[specta::specta]
pub async fn remove_controller_mapping(
    app: AppHandle,
    webview: Webview,
    scope: String,
    target: String,
) -> Result<ControllerMappingSnapshot, String> {
    main_only(&webview)?;
    controller_mapping::remove_mapping(app, scope, target).await
}

#[tauri::command]
#[specta::specta]
pub fn get_controller_osc_activity(
    app: AppHandle,
    webview: Webview,
) -> Result<Option<String>, String> {
    main_only(&webview)?;
    Ok(controller_mapping::osc_activity(&app))
}

#[tauri::command]
#[specta::specta]
pub fn get_controller_midi_ports(
    app: AppHandle,
    webview: Webview,
) -> Result<Vec<ControllerMidiPort>, String> {
    main_only(&webview)?;
    controller_mapping::midi_ports(&app)
}

#[tauri::command]
#[specta::specta]
pub async fn configure_controller_midi_port(
    app: AppHandle,
    webview: Webview,
    port: i32,
    enabled: bool,
) -> Result<ControllerMappingSnapshot, String> {
    main_only(&webview)?;
    controller_mapping::configure_midi_port(app, port, enabled).await
}

#[tauri::command]
#[specta::specta]
pub async fn configure_controller_mapping_range(
    app: AppHandle,
    webview: Webview,
    scope: String,
    target: String,
    range: ControllerMappingRange,
) -> Result<ControllerMappingSnapshot, String> {
    main_only(&webview)?;
    controller_mapping::configure_mapping_range(app, scope, target, range).await
}
