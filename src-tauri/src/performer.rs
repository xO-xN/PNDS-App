//! Project test windows have independent lifetimes and no music-message bridge.
use tauri::{AppHandle, Manager, Runtime};
#[cfg(target_os = "macos")]
mod native;

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
