//! The only Client control entry points. No project or audio engine is started.
use crate::events::ClientSnapshotEvent;
use crate::participation_client::{
    preview_client_node, ClientCoordinator, ClientError, ClientHostInfo, ClientNodePreview,
    ClientSnapshot,
};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tauri_specta::Event;

fn publish_to_app(app: &AppHandle, client: &ClientCoordinator) {
    let cleanup_app = app.clone();
    client.set_view_cleanup(Arc::new(move || {
        crate::client_score_view::close(&cleanup_app)
    }));
    let prepare_app = app.clone();
    client.set_view_prepare(Arc::new(move |target| {
        Box::pin(crate::client_score_view::prepare(
            prepare_app.clone(),
            target,
        ))
    }));
    let commit_app = app.clone();
    client.set_view_commit(Arc::new(move |target| {
        crate::client_score_view::commit(commit_app.clone(), target)
    }));
    let cancel_app = app.clone();
    client.set_view_cancel(Arc::new(move |target| {
        crate::client_score_view::cancel(cancel_app.clone(), target)
    }));
    let app = app.clone();
    client.set_sink(Arc::new(move |snapshot| {
        let _ = ClientSnapshotEvent { snapshot }.emit(&app);
    }));
}

#[tauri::command]
#[specta::specta]
pub async fn sync_client_score_view(
    app: AppHandle,
    webview: tauri::Webview,
    expected_page_url: String,
    request: f64,
    bounds: Option<crate::client_score_view::ClientScoreBounds>,
) -> Result<(), ClientError> {
    if webview.label() != "main" {
        return Err(ClientError::from(
            "participation.errors.scoreView: Only the main App page controls the Client view",
        ));
    }
    crate::client_score_view::sync(app, expected_page_url, request, bounds).await
}
#[tauri::command]
#[specta::specta]
pub async fn inspect_client_host(
    app: AppHandle,
    client: State<'_, ClientCoordinator>,
    address: String,
    expected_host_id: Option<String>,
) -> Result<ClientSnapshot, ClientError> {
    publish_to_app(&app, &client);
    client
        .inspect_guarded(address, expected_host_id, || {
            app.state::<crate::project::session::SessionManager>()
                .has_active_session()
        })
        .await
        .map_err(ClientError::from)
}
#[tauri::command]
#[specta::specta]
pub async fn inspect_client_node(
    address: String,
    expected_host_id: Option<String>,
    locale: String,
    known_performance_id: Option<String>,
) -> Result<ClientNodePreview, ClientError> {
    preview_client_node(
        &address,
        expected_host_id.as_deref(),
        &locale,
        known_performance_id.as_deref(),
    )
    .await
    .map_err(ClientError::from)
}
#[tauri::command]
#[specta::specta]
pub async fn join_client_node(
    app: AppHandle,
    client: State<'_, ClientCoordinator>,
    address: String,
    expected_host: ClientHostInfo,
) -> Result<ClientSnapshot, ClientError> {
    publish_to_app(&app, &client);
    client
        .enter_at(
            &app.path()
                .app_data_dir()
                .map_err(|error| ClientError::from(error.to_string()))?,
            &address,
            expected_host,
            || {
                app.state::<crate::project::session::SessionManager>()
                    .has_active_session()
            },
        )
        .await
        .map_err(ClientError::from)
}
#[tauri::command]
#[specta::specta]
pub async fn join_client_performance(
    app: AppHandle,
    client: State<'_, ClientCoordinator>,
    expected_host: ClientHostInfo,
) -> Result<ClientSnapshot, ClientError> {
    publish_to_app(&app, &client);
    client
        .enter(
            &app.path()
                .app_data_dir()
                .map_err(|error| ClientError::from(error.to_string()))?,
            expected_host,
        )
        .await
        .map_err(ClientError::from)
}
#[tauri::command]
#[specta::specta]
pub async fn get_client_participation(
    client: State<'_, ClientCoordinator>,
) -> Result<ClientSnapshot, ClientError> {
    if !client.busy() {
        return Ok(client.snapshot());
    }
    Ok(client.poll().await)
}
#[tauri::command]
#[specta::specta]
pub async fn leave_client_performance(
    client: State<'_, ClientCoordinator>,
) -> Result<ClientSnapshot, ClientError> {
    Ok(client.leave())
}
#[tauri::command]
#[specta::specta]
pub async fn refresh_client_performance(
    app: AppHandle,
    client: State<'_, ClientCoordinator>,
) -> Result<ClientSnapshot, ClientError> {
    client
        .refresh(
            &app.path()
                .app_data_dir()
                .map_err(|error| ClientError::from(error.to_string()))?,
        )
        .await
        .map_err(ClientError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_client_entry(
    client: State<'_, ClientCoordinator>,
) -> Result<ClientSnapshot, ClientError> {
    Ok(client.cancel_entry())
}
