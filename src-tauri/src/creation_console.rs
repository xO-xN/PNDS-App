use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tokio::sync::{oneshot, Mutex, Notify};

pub const LABEL: &str = "creation-console";
const MAIN_LABEL: &str = "main";
const CLOSED_EVENT: &str = "creation-console:closed";

#[derive(Default)]
pub struct ConsoleWindow {
    operations: Mutex<()>,
    destroyed: Notify,
}

enum Action {
    Show(String),
    Toggle(String),
    Close,
}

enum Outcome {
    Open,
    Closing,
    Closed,
}

fn apply<R: Runtime>(app: &AppHandle<R>, action: Action) -> tauri::Result<Outcome> {
    match (action, app.get_webview_window(LABEL)) {
        (Action::Toggle(_) | Action::Close, Some(window)) => {
            window.destroy()?;
            Ok(Outcome::Closing)
        }
        (Action::Close, None) => Ok(Outcome::Closed),
        (Action::Show(title), Some(window)) => {
            window.set_title(&title)?;
            if window.is_minimized()? {
                window.unminimize()?;
            }
            // The page reveals itself after applying its theme.
            if window.is_visible()? {
                window.set_focus()?;
            }
            Ok(Outcome::Open)
        }
        (Action::Show(title) | Action::Toggle(title), None) => {
            WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("creation-console.html".into()))
                .title(title)
                .inner_size(720.0, 460.0)
                .min_inner_size(440.0, 280.0)
                .center()
                .visible(false)
                .build()?;
            Ok(Outcome::Open)
        }
    }
}

async fn update<R: Runtime>(caller: &WebviewWindow<R>, action: Action) -> Result<bool, String> {
    if caller.label() != MAIN_LABEL {
        return Err("Only the main window manages the creation console".into());
    }
    let app = caller.app_handle();
    let state = app.state::<ConsoleWindow>();
    let _operation = state.operations.lock().await;
    // Tauri queues destruction. Keep subsequent commands behind the close
    // until the label is available again, even with a fast close and reopen.
    let mut destroyed = std::pin::pin!(state.destroyed.notified());
    destroyed.as_mut().enable();
    let (tx, rx) = oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(apply(&handle, action));
    })
    .map_err(|error| error.to_string())?;
    match rx
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?
    {
        Outcome::Open => Ok(true),
        Outcome::Closed => Ok(false),
        Outcome::Closing => {
            tokio::time::timeout(Duration::from_secs(3), destroyed)
                .await
                .map_err(|_| "Timed out closing the creation console".to_string())?;
            Ok(false)
        }
    }
}

pub fn notify_destroyed<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit_to(MAIN_LABEL, CLOSED_EVENT, ());
    app.state::<ConsoleWindow>().destroyed.notify_waiters();
}

#[tauri::command]
#[specta::specta]
pub async fn toggle_creation_console(window: WebviewWindow, title: String) -> Result<bool, String> {
    update(&window, Action::Toggle(title)).await
}

#[tauri::command]
#[specta::specta]
pub async fn show_creation_console(window: WebviewWindow, title: String) -> Result<(), String> {
    update(&window, Action::Show(title)).await.map(|_| ())
}

#[tauri::command]
#[specta::specta]
pub async fn close_creation_console(window: WebviewWindow) -> Result<(), String> {
    update(&window, Action::Close).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    #[tokio::test]
    async fn show_reuses_the_console_and_only_the_main_window_can_manage_it() {
        let app = mock_builder()
            .manage(ConsoleWindow::default())
            .build(mock_context(noop_assets()))
            .unwrap();
        let main = WebviewWindowBuilder::new(&app, MAIN_LABEL, WebviewUrl::default())
            .build()
            .unwrap();

        assert!(!update(&main, Action::Close).await.unwrap());
        assert!(update(&main, Action::Toggle("Console".into()))
            .await
            .unwrap());
        let console = app.get_webview_window(LABEL).unwrap();
        assert!(update(&main, Action::Show("Console".into())).await.unwrap());
        assert_eq!(app.webview_windows().len(), 2);
        assert!(update(&console, Action::Close).await.is_err());
        assert!(app.get_webview_window(LABEL).is_some());
    }
}
