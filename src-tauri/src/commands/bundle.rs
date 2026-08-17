//! Bundle-related commands (v1.2.0, issue #16): `.pnds` packing from the
//! settings developer tools, installing an opened `.pnds` into the
//! app-managed `bundles/` directory, reclaiming installs on history removal,
//! and the macOS double-click open queue.

use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

use crate::project::bundle::{self, BundleOutputInfo, PackResult, BUNDLES_DIR};

/// Paths of `.pnds` files macOS asked the App to open (file-association
/// double-click or launch-with-document). Filled by `RunEvent::Opened`,
/// drained by the frontend via [`take_pending_bundle_opens`] — the drain is
/// atomic, so the live event and the mount-time drain never double-process
/// the same file.
#[derive(Default)]
pub struct PendingBundleOpens(pub std::sync::Mutex<Vec<String>>);

/// The app-managed install root: `<app-data>/bundles/`.
pub(crate) fn bundles_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::commands::project::app_data_dir(app)?.join(BUNDLES_DIR))
}

/// Pre-flight info for the pack UI: the `<name>-<version>.pnds` path the
/// pack would produce and whether it already exists (overwrite confirm),
/// plus the same manifest/dependency validations the pack itself runs.
#[tauri::command]
#[specta::specta]
pub async fn get_bundle_output_info(path: String) -> Result<BundleOutputInfo, String> {
    let (_, output) = bundle::validate_packable(&PathBuf::from(&path))?;
    Ok(BundleOutputInfo {
        output_path: output.to_string_lossy().into_owned(),
        exists: output.exists(),
    })
}

/// Packs the project at `path` (spec issue #16: staging-isolated, no npm,
/// source untouched). `overwrite` must be true to replace an existing
/// output — the UI confirms first via [`get_bundle_output_info`].
#[tauri::command]
#[specta::specta]
pub async fn pack_project_bundle(
    app: AppHandle,
    path: String,
    overwrite: bool,
) -> Result<PackResult, String> {
    let packed_with = app.package_info().version.to_string();
    bundle::pack_project(&PathBuf::from(path), overwrite, &packed_with)
}

/// Installs a `.pnds` into `bundles/<id>-<version>/` (always reinstalling
/// over an existing install) and returns the installed project directory —
/// the frontend then runs the normal open flow from there.
#[tauri::command]
#[specta::specta]
pub async fn install_bundle(app: AppHandle, path: String) -> Result<String, String> {
    let root = bundles_root(&app)?;
    let installed = bundle::install_bundle(&root, &PathBuf::from(&path))?;
    log::info!("Installed bundle {path} as {}", installed.to_string_lossy());
    Ok(installed.to_string_lossy().into_owned())
}

/// Deletes the extracted bundle directory behind a history entry when (and
/// only when) it is a direct child of the app-managed `bundles/` root.
/// `Ok(false)` = not a managed install, nothing was touched.
#[tauri::command]
#[specta::specta]
pub async fn reclaim_project_bundle(app: AppHandle, path: String) -> Result<bool, String> {
    let root = bundles_root(&app)?;
    bundle::reclaim_bundle_dir(&root, &PathBuf::from(&path))
}

/// Atomically drains the queue of `.pnds` paths macOS asked the App to open.
#[tauri::command]
#[specta::specta]
pub async fn take_pending_bundle_opens(
    state: State<'_, PendingBundleOpens>,
) -> Result<Vec<String>, String> {
    let mut queue = state
        .0
        .lock()
        .map_err(|_| "bundle queue poisoned".to_string())?;
    Ok(std::mem::take(&mut *queue))
}

/// The ⌘O picker: one native panel that accepts a project directory or a
/// `.pnds` bundle file (see `open_panel.rs` for why the dialog plugin can't
/// do this). Synchronous on purpose — the modal panel must block its caller
/// while running on the main thread.
#[tauri::command]
#[specta::specta]
pub fn pick_project_or_bundle(app: AppHandle, title: String) -> Result<Option<String>, String> {
    crate::open_panel::pick_project_or_bundle_path(&app, &title)
}

/// Records a `.pnds` open request coming from macOS (`RunEvent::Opened`)
/// and wakes the frontend. Idempotent when no listener is up yet: the
/// frontend drains the queue on mount as well.
pub(crate) fn record_pending_bundle_open(app: &AppHandle, path: &std::path::Path) {
    let state = app.state::<PendingBundleOpens>();
    if let Ok(mut queue) = state.0.lock() {
        queue.push(path.to_string_lossy().into_owned());
    }
    use tauri::Emitter;
    let _ = app.emit("pnds:open-bundle", ());
}
