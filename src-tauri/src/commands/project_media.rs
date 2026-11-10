//! App shell controls only its own first-party project document.
use crate::project_media_view::{self, ProjectMediaBounds, ProjectMediaTarget};
use tauri::AppHandle;

#[tauri::command]
#[specta::specta]
pub async fn sync_project_media_view(
    app: AppHandle,
    webview: tauri::Webview,
    target: ProjectMediaTarget,
    request: f64,
    bounds: Option<ProjectMediaBounds>,
) -> Result<(), String> {
    let url = webview.url().map_err(|error| error.to_string())?;
    let origin = shell_message_origin(&url)?;
    project_media_view::sync(app, webview.label().into(), origin, target, request, bounds).await
}
#[tauri::command]
#[specta::specta]
pub async fn close_project_media_view(
    app: AppHandle,
    webview: tauri::Webview,
    navigation: String,
    request: f64,
) -> Result<(), String> {
    project_media_view::close(app, webview.label().into(), navigation, request).await
}
#[tauri::command]
#[specta::specta]
pub async fn post_project_media_message(
    app: AppHandle,
    webview: tauri::Webview,
    navigation: String,
    message: serde_json::Value,
) -> Result<(), String> {
    project_media_view::post(app, webview.label().into(), navigation, message).await
}

/// WebKit serializes the trusted Tauri application scheme as a tuple origin;
/// the generic URL crate intentionally classifies unknown schemes as opaque.
pub(crate) fn shell_message_origin(url: &tauri::Url) -> Result<String, String> {
    if url.scheme() == "tauri"
        && url.host_str() == Some("localhost")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
    {
        Ok("tauri://localhost".into())
    } else {
        let origin = url.origin().ascii_serialization();
        if origin == "null" {
            Err("Unsupported project shell origin".into())
        } else {
            Ok(origin)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn release_tauri_shell_origin_keeps_the_exact_preview_message_sender() {
        assert_eq!(
            shell_message_origin(&"tauri://localhost/index.html".parse().unwrap()).unwrap(),
            "tauri://localhost"
        );
        assert_eq!(
            shell_message_origin(&"http://localhost:1420/".parse().unwrap()).unwrap(),
            "http://localhost:1420"
        );
        assert!(shell_message_origin(&"tauri://other-host/".parse().unwrap()).is_err());
        assert!(shell_message_origin(&"about:blank".parse().unwrap()).is_err());
    }
}
