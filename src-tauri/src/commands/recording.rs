//! Main-shell control boundary; a score WebView never receives these commands.
use crate::project::creation::CreationSource;
use crate::project::session::SessionManager;
use crate::recording::storage::RecordingStore;
use crate::recording::{PerformanceRecord, RecordingManager, RecordingSnapshot};
use std::fs::File;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

fn main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("recording.mainOnly".into());
    }
    Ok(())
}
fn key(path: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let canonical = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    Ok(format!(
        "{:x}",
        Sha256::digest(canonical.to_string_lossy().as_bytes())
    ))
}

fn store(app: &AppHandle, path: &str) -> Result<RecordingStore, String> {
    let data = super::project::app_data_dir(app)?;
    let protection = super::creation::protection(app).map_err(|error| error.detail)?;
    store_at(&data, Path::new(path), &protection, None)
}

fn store_at(
    data: &Path,
    path: &Path,
    protection: &crate::project::creation::Protection,
    expected: Option<&File>,
) -> Result<RecordingStore, String> {
    let root = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
    let directory = File::options()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(&root)
        .map_err(|error| error.to_string())?;
    let held = directory.metadata().map_err(|error| error.to_string())?;
    if let Some(expected) = expected {
        if !crate::recording::same_root(&directory, expected)? {
            return Err("recording.storageUnavailable".into());
        }
    }
    crate::recording::storage::validate_project(&directory)?;
    let current = std::fs::metadata(&root).map_err(|error| error.to_string())?;
    if (held.dev(), held.ino()) != (current.dev(), current.ino()) {
        return Err("recording.storageUnavailable".into());
    }
    match protection.source(&root) {
        CreationSource::Folder => RecordingStore::project_at(data, &root, &directory),
        CreationSource::ReadOnlyFolder => RecordingStore::project_readonly_at(&directory),
        CreationSource::Bundle | CreationSource::Utility => {
            RecordingStore::app_local(data, &key(&root.to_string_lossy())?)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_recording_state(
    window: WebviewWindow,
    state: State<'_, RecordingManager>,
    session: State<'_, SessionManager>,
) -> Result<RecordingSnapshot, String> {
    main(&window)?;
    Ok(state.snapshot(session.recording_target().is_ok()))
}

#[tauri::command]
#[specta::specta]
pub fn list_performance_records(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, RecordingManager>,
    project_path: String,
) -> Result<Vec<PerformanceRecord>, String> {
    main(&window)?;
    state.list(&store(&app, &project_path)?)
}

#[tauri::command]
#[specta::specta]
pub fn reveal_performance_recordings(
    app: AppHandle,
    window: WebviewWindow,
    project_path: String,
) -> Result<(), String> {
    main(&window)?;
    let directory = store(&app, &project_path)?.reveal_path()?;
    app.opener()
        .reveal_item_in_dir(directory)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub fn begin_performance_recording(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, RecordingManager>,
    session: State<'_, SessionManager>,
    workspace: State<'_, super::creation::CreationState>,
    mode: String,
    record_id: Option<String>,
    pass_id: Option<String>,
    allow_changed: bool,
    creation_identity: Option<String>,
) -> Result<RecordingSnapshot, String> {
    main(&window)?;
    let access = workspace
        .access
        .lock()
        .map_err(|_| "recording.creationOnly")?;
    let project = creation_identity
        .as_ref()
        .map(|identity| {
            access
                .descriptor(
                    identity,
                    &super::creation::protection(&app).map_err(|e| e.detail)?,
                )
                .map_err(|e| e.detail)
        })
        .transpose()?;
    session.with_recording_target(|target| {
        if let Some(project) = &project {
            if key(&project.root)? != target.launch.project_key {
                return Err("recording.creationOnly".into());
            }
        }
        let directory = store_at(
            &super::project::app_data_dir(&app)?,
            Path::new(&target.project_path),
            &super::creation::protection(&app).map_err(|error| error.detail)?,
            Some(&target.launch.directory),
        )?;
        state.begin(
            &directory,
            target,
            &mode,
            record_id.as_deref(),
            pass_id.as_deref(),
            allow_changed,
            project.is_some(),
        )
    })
}

#[tauri::command]
#[specta::specta]
pub fn delete_performance_record(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, RecordingManager>,
    project_path: String,
    id: String,
) -> Result<(), String> {
    main(&window)?;
    state.delete_record(&store(&app, &project_path)?, &id)
}

#[tauri::command]
#[specta::specta]
pub fn delete_recording_pass(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, RecordingManager>,
    project_path: String,
    record_id: String,
    pass_id: String,
) -> Result<PerformanceRecord, String> {
    main(&window)?;
    state.delete_pass(&store(&app, &project_path)?, &record_id, &pass_id)
}

#[tauri::command]
#[specta::specta]
pub fn stop_performance_recording(
    window: WebviewWindow,
    state: State<'_, RecordingManager>,
    discard: bool,
) -> Result<RecordingSnapshot, String> {
    main(&window)?;
    state.stop(discard)
}

#[tauri::command]
#[specta::specta]
pub fn import_performance_record(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, RecordingManager>,
    project_path: String,
    path: String,
) -> Result<PerformanceRecord, String> {
    main(&window)?;
    state.import(&store(&app, &project_path)?, Path::new(&path))
}

#[tauri::command]
#[specta::specta]
pub fn export_performance_record(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, RecordingManager>,
    project_path: String,
    id: String,
    path: String,
) -> Result<(), String> {
    main(&window)?;
    state.export(&store(&app, &project_path)?, &id, &PathBuf::from(path))
}

/// There is one driver for the entire App, independent of any panel's lifetime.
pub fn start_driver(app: AppHandle) {
    std::thread::spawn(move || {
        let mut emitted_revision = None;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(20));
            let manager = app.state::<RecordingManager>();
            let target = app.state::<SessionManager>().recording_target().ok();
            if let Err(error) =
                manager.advance(target.as_ref().map(|target| target.generation.as_str()))
            {
                log::warn!("Performance recording: {error}");
            }
            use tauri_specta::Event as _;
            let snapshot = manager.snapshot(target.is_some());
            if emitted_revision != Some(snapshot.revision) {
                emitted_revision = Some(snapshot.revision);
                let _ = crate::events::RecordingSnapshotEvent { snapshot }.emit(&app);
            }
        }
    });
}

#[cfg(test)]
mod tests;
