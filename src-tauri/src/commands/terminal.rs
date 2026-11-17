//! Terminal controls keep the issued creation identity at the native boundary.

use super::creation::{protection, CreationState};
use crate::project::terminal::{
    ProjectTerminalManager, TerminalOpenError, TerminalPacket, TerminalSession,
};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
#[specta::specta]
pub async fn get_project_terminal_task_context(
    app: AppHandle,
    creation: State<'_, CreationState>,
    identity: String,
    locale: String,
) -> Result<crate::project::creation::ProjectTerminalTaskContext, String> {
    if !matches!(locale.as_str(), "en" | "zh-CN") {
        return Err("Unsupported terminal task documentation language".into());
    }
    let access = creation.access.clone();
    run(move || {
        let documentation_root = app
            .path()
            .resource_dir()
            .map_err(|error| error.to_string())?
            .join("help")
            .join(locale);
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let checker_path = executable
            .parent()
            .ok_or("Cannot locate the PNDS checker")?
            .join("pnds");
        access
            .lock()
            .map_err(|_| "Creation workspace lock failed")?
            .terminal_task_context(
                &identity,
                &documentation_root,
                &checker_path,
                &protection(&app).map_err(|error| error.detail)?,
            )
            .map_err(|error| error.detail)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn write_project_terminal_task(
    app: AppHandle,
    creation: State<'_, CreationState>,
    identity: String,
    contents: String,
) -> Result<String, String> {
    let access = creation.access.clone();
    run(move || {
        let path = access
            .lock()
            .map_err(|_| "Creation workspace lock failed")?
            .write_terminal_task(
                &identity,
                &contents,
                &protection(&app).map_err(|error| error.detail)?,
            )
            .map_err(|error| error.detail)?;
        path.to_str()
            .map(str::to_owned)
            .ok_or_else(|| "The task path is not UTF-8".into())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_project_terminal_visibility(
    app: AppHandle,
) -> Result<crate::project::terminal::visibility::TerminalVisibilitySnapshot, String> {
    crate::project::terminal::visibility::snapshot(app).await
}

async fn run<T: Send + 'static, E: From<String> + Send + 'static>(
    operation: impl FnOnce() -> Result<T, E> + Send + 'static,
) -> Result<T, E> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| E::from(error.to_string()))?
}

fn validate(
    app: &AppHandle,
    access: &Arc<Mutex<crate::project::creation::CreationAccess>>,
    identity: &str,
) -> Result<(), String> {
    access
        .lock()
        .map_err(|_| "Creation workspace lock failed")?
        .terminal_directory(identity, &protection(app).map_err(|error| error.detail)?)
        .map(|_| ())
        .map_err(|error| error.detail)
}

#[tauri::command]
#[specta::specta]
pub async fn open_project_terminal(
    app: AppHandle,
    creation: State<'_, CreationState>,
    terminal: State<'_, ProjectTerminalManager>,
    identity: String,
    cols: u16,
    rows: u16,
) -> Result<TerminalSession, TerminalOpenError> {
    let access = creation.access.clone();
    let terminal = terminal.inner().clone();
    run(move || {
        let access = access
            .lock()
            .map_err(|_| "Creation workspace lock failed".to_string())?;
        terminal.open(
            &access,
            &identity,
            &protection(&app).map_err(|error| error.detail)?,
            cols,
            rows,
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_project_terminal(
    app: AppHandle,
    creation: State<'_, CreationState>,
    terminal: State<'_, ProjectTerminalManager>,
    identity: String,
) -> Result<Option<TerminalSession>, String> {
    let access = creation.access.clone();
    let terminal = terminal.inner().clone();
    run(move || {
        validate(&app, &access, &identity)?;
        terminal.get(&identity)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn read_project_terminal(
    app: AppHandle,
    creation: State<'_, CreationState>,
    terminal: State<'_, ProjectTerminalManager>,
    identity: String,
    id: String,
) -> Result<TerminalPacket, String> {
    let access = creation.access.clone();
    let terminal = terminal.inner().clone();
    run(move || {
        validate(&app, &access, &identity)?;
        let packet = terminal.read(&identity, &id)?;
        // A workspace replacement during the long poll revokes the response too.
        validate(&app, &access, &identity)?;
        Ok(packet)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn write_project_terminal(
    app: AppHandle,
    creation: State<'_, CreationState>,
    terminal: State<'_, ProjectTerminalManager>,
    identity: String,
    id: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let access = creation.access.clone();
    let terminal = terminal.inner().clone();
    run(move || {
        let access = access
            .lock()
            .map_err(|_| "Creation workspace lock failed")?;
        access
            .terminal_directory(&identity, &protection(&app).map_err(|error| error.detail)?)
            .map_err(|error| error.detail)?;
        terminal.write(&identity, &id, &bytes)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn resize_project_terminal(
    app: AppHandle,
    creation: State<'_, CreationState>,
    terminal: State<'_, ProjectTerminalManager>,
    identity: String,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let access = creation.access.clone();
    let terminal = terminal.inner().clone();
    run(move || {
        let access = access
            .lock()
            .map_err(|_| "Creation workspace lock failed")?;
        access
            .terminal_directory(&identity, &protection(&app).map_err(|error| error.detail)?)
            .map_err(|error| error.detail)?;
        terminal.resize(&identity, &id, cols, rows)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn close_project_terminal(
    terminal: State<'_, ProjectTerminalManager>,
    identity: String,
    id: String,
) -> Result<(), String> {
    let terminal = terminal.inner().clone();
    // Cleanup remains available for its original owner after capability revocation.
    run(move || terminal.close(&identity, &id)).await
}
