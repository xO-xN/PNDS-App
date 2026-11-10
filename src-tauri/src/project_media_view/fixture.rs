//! Opt-in native probes. No release command or project page can call these.
use super::*;

pub(crate) async fn capture(
    app: AppHandle,
    label: &str,
    path: std::path::PathBuf,
    points: Vec<(f64, f64)>,
) -> Result<serde_json::Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let label = label.to_owned();
    app.run_on_main_thread(move || {
        let _ = tx.send(native::fixture_capture(&label, &path, &points));
    })
    .map_err(|error| error.to_string())?;
    rx.await.map_err(|error| error.to_string())?
}

pub(crate) async fn keys(
    app: AppHandle,
    label: &str,
    characters: &str,
    key_code: u16,
    modifiers: usize,
) -> Result<serde_json::Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let label = label.to_owned();
    let characters = characters.to_owned();
    app.run_on_main_thread(move || {
        let _ = tx.send(native::fixture_keys(
            &label,
            &characters,
            key_code,
            modifiers,
        ));
    })
    .map_err(|error| error.to_string())?;
    rx.await.map_err(|error| error.to_string())?
}
pub(crate) async fn ownership(app: AppHandle, label: &str) -> Result<serde_json::Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let label = label.to_owned();
    app.run_on_main_thread(move || {
        let _ = tx.send(native::fixture_ownership(&label));
    })
    .map_err(|error| error.to_string())?;
    rx.await.map_err(|error| error.to_string())?
}
