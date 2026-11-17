//! Project test windows have independent lifetimes and no music-message bridge.
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};
use tauri_specta::Event;
#[derive(Default)]
pub struct VisibilityIntent {
    manually_controlled: Mutex<HashSet<String>>,
}

pub fn initial_reveal_allowed<R: Runtime>(app: &AppHandle<R>, label: &str) -> bool {
    !app.state::<VisibilityIntent>()
        .manually_controlled
        .lock()
        .unwrap()
        .contains(label)
}

pub fn forget_visibility<R: Runtime>(app: &AppHandle<R>, label: &str) {
    app.state::<VisibilityIntent>()
        .manually_controlled
        .lock()
        .unwrap()
        .remove(label);
}

#[cfg(target_os = "macos")]
mod native;

#[cfg(target_os = "macos")]
pub(crate) fn add_client_dialog_callbacks(builder: &mut objc2::runtime::ClassBuilder) {
    native::add_dialog_callbacks(builder);
}

#[cfg(target_os = "macos")]
pub(crate) unsafe fn set_client_dialog_labels(
    delegate: &objc2::runtime::AnyObject,
    ok: &str,
    cancel: &str,
) {
    unsafe {
        native::set_dialog_labels(delegate, ok, cancel);
    }
}

#[cfg(target_os = "macos")]
pub(crate) unsafe fn cancel_client_dialogs(delegate: &objc2::runtime::AnyObject) {
    unsafe {
        native::cancel_dialogs(delegate);
    }
}

pub async fn prepare_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    ok: String,
    cancel: String,
) -> Result<(), String> {
    if !is_performer_label(label) {
        return Err("Invalid performer window label".into());
    }
    let window = app
        .get_webview_window(label)
        .ok_or("Performer window not found")?;
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        window
            .with_webview(move |webview| {
                // Tauri runs this closure on the UI thread; await it before the
                // shell creates any project iframe (including its first prompt).
                let result = unsafe { native::install(webview.inner().cast(), &ok, &cancel) };
                let _ = tx.send(result);
            })
            .map_err(|error| error.to_string())?;
        rx.await.map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, ok, cancel);
        Ok(())
    }
}

pub fn is_performer_label(label: &str) -> bool {
    let Some(id) = label.strip_prefix("performer-") else {
        return false;
    };
    id.len() == 36
        && id.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
            }
        })
}

/// Visibility does not retire the device or its performer connection.
pub fn set_visibility<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    visible: bool,
) -> Result<(), String> {
    if !is_performer_label(label) {
        return Err("Invalid performer window label".into());
    }
    let window = app
        .get_webview_window(label)
        .ok_or("Performer window not found")?;
    // Explicit show/hide owns this device from now on; a delayed cold-start
    // reveal must never supersede a user's choice.
    app.state::<VisibilityIntent>()
        .manually_controlled
        .lock()
        .unwrap()
        .insert(label.into());
    if visible {
        window.show()
    } else {
        window.hide()
    }
    .map_err(|error| error.to_string())?;
    crate::events::PerformerVisibilityEvent {
        label: label.into(),
        visible,
    }
    .emit(app)
    .map_err(|error| error.to_string())
}

/// Pin only a scoped test shell. A successful setter acknowledges its target:
/// macOS queues the level update, so an immediate query can return the old level.
/// An independent query still reads native state when the shell reloads.
pub fn window_pinned<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    pinned: Option<bool>,
) -> Result<bool, String> {
    if !is_performer_label(label) {
        return Err("Invalid performer window label".into());
    }
    let window = app
        .get_webview_window(label)
        .ok_or("Performer window not found")?;
    if let Some(pinned) = pinned {
        window
            .set_always_on_top(pinned)
            .map_err(|error| error.to_string())?;
        return Ok(pinned);
    }
    window.is_always_on_top().map_err(|error| error.to_string())
}

/// Destroy only issued test-window labels. `None` also catches orphaned shells
/// after a main-webview reload; no unrelated window can be a target.
pub fn close_windows<R: Runtime>(
    app: &AppHandle<R>,
    labels: Option<Vec<String>>,
) -> Result<(), String> {
    let windows = app.webview_windows();
    let targets = labels.unwrap_or_else(|| {
        windows
            .keys()
            .filter(|label| is_performer_label(label))
            .cloned()
            .collect()
    });
    if targets.iter().any(|label| !is_performer_label(label)) {
        return Err("Invalid performer window label".into());
    }
    let mut errors = Vec::new();
    for label in targets {
        if let Some(window) = windows.get(&label) {
            if let Err(error) = crate::project_media_view::close_window(app, &label) {
                errors.push(format!("{label}: {error}"));
                continue;
            }
            if let Err(error) = window.destroy() {
                errors.push(format!("{label}: {error}"));
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    #[tokio::test]
    async fn preparation_rejects_unrelated_or_missing_windows_before_native_access() {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        for label in [
            "main",
            "projection",
            "performer-../../main",
            "performer-00000000-0000-4000-8000-000000000001",
        ] {
            assert!(
                prepare_window(app.handle(), label, "OK".into(), "Cancel".into())
                    .await
                    .is_err()
            );
        }
    }

    #[test]
    fn hiding_preserves_the_issued_device_window() {
        let app = mock_builder()
            .manage(VisibilityIntent::default())
            .manage(crate::window::WindowManager::default())
            .build(mock_context(noop_assets()))
            .unwrap();
        let registry = crate::events::events_builder::<tauri::test::MockRuntime>();
        registry.mount_events(&app);
        let label = "performer-00000000-0000-4000-8000-000000000001";
        tauri::WebviewWindowBuilder::new(
            &app,
            label,
            tauri::WebviewUrl::App("performer.html".into()),
        )
        .build()
        .unwrap();
        assert!(initial_reveal_allowed(app.handle(), label));
        set_visibility(app.handle(), label, true).unwrap();
        set_visibility(app.handle(), label, false).unwrap();
        assert!(!initial_reveal_allowed(app.handle(), label));
        let window = app.get_webview_window(label).unwrap();
        assert!(!crate::window::reveal_performer_if_allowed(app.handle(), &window, label).unwrap());

        assert!(app.get_webview_window(label).is_some());
        set_visibility(app.handle(), label, true).unwrap();
        assert!(app.get_webview_window(label).is_some());
    }

    #[test]
    fn visibility_rejects_unrelated_or_missing_windows() {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        for label in [
            "main",
            "projection",
            "performer-../../main",
            "performer-00000000-0000-4000-8000-000000000001",
        ] {
            assert!(set_visibility(app.handle(), label, false).is_err());
            assert!(set_visibility(app.handle(), label, true).is_err());
            assert!(window_pinned(app.handle(), label, Some(true)).is_err());
            assert!(window_pinned(app.handle(), label, None).is_err());
        }
    }

    #[test]
    fn one_click_pin_acknowledges_the_requested_state_before_native_query_catches_up() {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let label = "performer-00000000-0000-4000-8000-000000000001";
        tauri::WebviewWindowBuilder::new(
            &app,
            label,
            tauri::WebviewUrl::App("performer.html".into()),
        )
        .build()
        .unwrap();
        assert!(!window_pinned(app.handle(), label, None).unwrap());
        // MockRuntime retains the old native query value, reproducing a queued
        // macOS level update. Each successful setter must acknowledge its target.
        assert!(window_pinned(app.handle(), label, Some(true)).unwrap());
        assert!(!window_pinned(app.handle(), label, Some(false)).unwrap());
        assert!(window_pinned(app.handle(), label, Some(true)).unwrap());
    }

    #[test]
    fn scoped_close_rejects_non_test_labels_before_dispatch() {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let first = "performer-00000000-0000-4000-8000-000000000001";
        assert!(close_windows(app.handle(), Some(vec!["main".into()])).is_err());
        assert!(
            close_windows(app.handle(), Some(vec![first.into(), "projection".into()])).is_err()
        );
        assert!(close_windows(app.handle(), Some(vec!["performer-../../main".into()])).is_err());
        close_windows(app.handle(), Some(vec![first.into()])).unwrap();
        close_windows(app.handle(), None).unwrap();
    }
}
