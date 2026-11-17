//! Bundle-related commands (v1.2.0, issue #16): `.pnds` packing from the
//! settings developer tools, installing an opened `.pnds` into the
//! app-managed `bundles/` directory, reclaiming installs on history removal,
//! and the macOS double-click open queue.

use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tauri_specta::Event as _;

use crate::project::bundle::{self, BundleOutputInfo, PackResult, BUNDLES_DIR};
use crate::project::setlist::{self, SetlistExportResult, SetlistProjectInfo, SetlistReadout};

/// Paths of `.pnds` files macOS asked the App to open (file-association
/// double-click or launch-with-document). Filled by `RunEvent::Opened`,
/// drained by the frontend via [`take_pending_bundle_opens`] — the drain is
/// atomic, so the live event and the mount-time drain never double-process
/// the same file.
#[derive(Default)]
pub struct PendingBundleOpens(std::sync::Mutex<PendingBundleOpenQueue>);

#[derive(Default)]
struct PendingBundleOpenQueue {
    paths: Vec<String>,
    events_ready: bool,
}

/// The app-managed install root: `<app-data>/bundles/`.
pub(crate) fn bundles_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::commands::project::app_data_dir(app)?.join(BUNDLES_DIR))
}

/// Pre-flight info for the pack UI: the `<name>-<version>.pnds` path the
/// pack would produce and whether it already exists (overwrite confirm),
/// plus the same manifest/dependency validations the pack itself runs.
#[tauri::command]
#[specta::specta]
pub async fn get_bundle_output_info(
    path: String,
    output_path: Option<String>,
) -> Result<BundleOutputInfo, String> {
    let output = output_path.map(PathBuf::from);
    bundle::output_info(&PathBuf::from(path), output.as_deref())
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
    output_path: Option<String>,
) -> Result<PackResult, String> {
    let packed_with = app.package_info().version.to_string();
    let output = output_path.map(PathBuf::from);
    let root = PathBuf::from(path);
    match output {
        Some(output) => bundle::pack_project_at(&root, Some(&output), overwrite, &packed_with),
        None => bundle::pack_project(&root, overwrite, &packed_with),
    }
}

/// Installs a `.pnds` into `bundles/<id>-<version>/` (always reinstalling
/// over an existing install) and returns the installed project directory —
/// the frontend then runs the normal open flow from there.
#[tauri::command]
#[specta::specta]
pub async fn install_bundle(
    app: AppHandle,
    state: State<'_, crate::project::session::SessionManager>,
    path: String,
) -> Result<String, String> {
    let root = bundles_root(&app)?;
    let installed = bundle::install_bundle_for_session(&root, &PathBuf::from(&path), &state)?;
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

/// v1.4.0 (#59): the setlist export pre-flight — per project the same
/// packability gate a pack would run plus the manifest identity and the
/// derived `.pnds` file name, so the frontend can assemble set.json
/// before anything is written.
#[tauri::command]
#[specta::specta]
pub async fn get_setlist_export_info(
    paths: Vec<String>,
) -> Result<Vec<SetlistProjectInfo>, String> {
    setlist::describe_projects(&paths)
}

/// v1.4.0 (#59): packs every project (in list order) into `destDir`, then
/// writes the frontend-serialized set.json and the folder's
/// self-description README.md beside them (#126 — frontend-composed from
/// the folder's name + intro; the retired README.txt instructions file
/// is removed best-effort). A failure removes everything this run wrote
/// — a partial export never reads as complete. Each pack is announced on
/// `pnds:setlist-export-progress` (`{ done, total, fileName }`, done
/// 0-based) so the UI can show per-project progress.
#[tauri::command]
#[specta::specta]
pub async fn export_setlist(
    app: AppHandle,
    dest_dir: String,
    setlist_json: String,
    readme: String,
    project_paths: Vec<String>,
) -> Result<SetlistExportResult, String> {
    let packed_with = app.package_info().version.to_string();
    let emit_app = app.clone();
    setlist::export_setlist(
        &PathBuf::from(dest_dir),
        &project_paths,
        &setlist_json,
        &readme,
        &packed_with,
        &|done, total, file_name| {
            let _ = crate::events::SetlistExportProgressEvent {
                done: done as u32,
                total: total as u32,
                file_name: file_name.to_string(),
            }
            .emit(&emit_app);
        },
    )
}

/// v1.4.0 (#63): reads a setlist export directory for the import — the
/// raw set.json body (the frontend's `parseSetlist` validates it) plus
/// every `.pnds` beside it with its probed identity. Directories without
/// a set.json error out; the frontend routing seam reads exactly that as
/// "not a setlist export" and falls through to the normal open flow.
#[tauri::command]
#[specta::specta]
pub async fn read_setlist(dir: String) -> Result<SetlistReadout, String> {
    setlist::read_setlist(&PathBuf::from(dir))
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
    Ok(std::mem::take(&mut queue.paths))
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
/// and wakes the frontend once the typed event registry is mounted.
/// macOS can deliver this before setup; queueing must not depend on setup.
pub(crate) fn record_pending_bundle_open<R: tauri::Runtime>(
    app: &AppHandle<R>,
    path: &std::path::Path,
) {
    let state = app.state::<PendingBundleOpens>();
    let notify = if let Ok(mut queue) = state.0.lock() {
        queue.paths.push(path.to_string_lossy().into_owned());
        queue.events_ready
    } else {
        false
    };
    if notify {
        let _ = crate::events::OpenBundleEvent {}.emit(app);
    }
}

/// Called only after mounting typed events. Early requests stay queued until
/// the frontend drains them, including when no frontend listener exists yet.
pub(crate) fn enable_pending_bundle_open_events<R: tauri::Runtime>(app: &AppHandle<R>) {
    let state = app.state::<PendingBundleOpens>();
    let notify = if let Ok(mut queue) = state.0.lock() {
        let notify = !queue.events_ready && !queue.paths.is_empty();
        queue.events_ready = true;
        notify
    } else {
        false
    };
    if notify {
        let _ = crate::events::OpenBundleEvent {}.emit(app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use tauri::test::{mock_builder, mock_context, noop_assets};

    #[tokio::test]
    async fn bundle_open_before_event_mount_is_queued_without_panicking() {
        let app = mock_builder()
            .manage(PendingBundleOpens::default())
            .build(mock_context(noop_assets()))
            .unwrap();

        record_pending_bundle_open(app.handle(), std::path::Path::new("/scores/cold.pnds"));

        assert_eq!(
            take_pending_bundle_opens(app.state()).await.unwrap(),
            ["/scores/cold.pnds"]
        );
        assert!(take_pending_bundle_opens(app.state())
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn event_mount_notifies_early_opens_and_drains_them_once() {
        let app = mock_builder()
            .manage(PendingBundleOpens::default())
            .build(mock_context(noop_assets()))
            .unwrap();
        record_pending_bundle_open(app.handle(), std::path::Path::new("/scores/first.pnds"));
        record_pending_bundle_open(app.handle(), std::path::Path::new("/scores/second.pnds"));

        crate::events::events_builder::<tauri::test::MockRuntime>().mount_events(&app);
        let notifications = Arc::new(AtomicUsize::new(0));
        let observed = notifications.clone();
        crate::events::OpenBundleEvent::listen(&app, move |_| {
            observed.fetch_add(1, Ordering::SeqCst);
        });

        enable_pending_bundle_open_events(app.handle());
        enable_pending_bundle_open_events(app.handle());
        assert_eq!(notifications.load(Ordering::SeqCst), 1);
        assert_eq!(
            take_pending_bundle_opens(app.state()).await.unwrap(),
            ["/scores/first.pnds", "/scores/second.pnds"]
        );
        assert!(take_pending_bundle_opens(app.state())
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn warm_opens_notify_and_share_the_atomic_frontend_drain() {
        let app = mock_builder()
            .manage(PendingBundleOpens::default())
            .build(mock_context(noop_assets()))
            .unwrap();
        crate::events::events_builder::<tauri::test::MockRuntime>().mount_events(&app);
        let notifications = Arc::new(AtomicUsize::new(0));
        let observed = notifications.clone();
        crate::events::OpenBundleEvent::listen(&app, move |_| {
            observed.fetch_add(1, Ordering::SeqCst);
        });

        enable_pending_bundle_open_events(app.handle());
        assert_eq!(notifications.load(Ordering::SeqCst), 0);
        record_pending_bundle_open(app.handle(), std::path::Path::new("/scores/warm.pnds"));
        assert_eq!(notifications.load(Ordering::SeqCst), 1);

        let (mount_drain, event_drain) = tokio::join!(
            take_pending_bundle_opens(app.state()),
            take_pending_bundle_opens(app.state())
        );
        let paths: Vec<_> = mount_drain
            .unwrap()
            .into_iter()
            .chain(event_drain.unwrap())
            .collect();
        assert_eq!(paths, ["/scores/warm.pnds"]);
    }
}
