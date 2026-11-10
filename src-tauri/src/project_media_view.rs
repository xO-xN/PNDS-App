//! Trusted first-party project pages, owned by the actual App window/document.
use crate::project::session::{SessionManager, SessionSnapshot};
use crate::types::SessionStatus;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{BTreeMap, BTreeSet};
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
pub(crate) mod fixture;
#[cfg(target_os = "macos")]
mod native;
#[cfg(target_os = "macos")]
mod occlusion;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ProjectMediaRole {
    Monitor,
    Projection,
    Performer,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectMediaTarget {
    pub role: ProjectMediaRole,
    pub url: String,
    pub navigation: String,
    pub generation: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectMediaOcclusion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectMediaBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub viewport_width: f64,
    pub viewport_height: f64,
    pub page_width: f64,
    pub page_height: f64,
    #[serde(default = "full_opacity")]
    pub opacity: f64,
    #[serde(default)]
    pub corner_radius: f64,
    #[serde(default)]
    pub occlusions: Vec<ProjectMediaOcclusion>,
}

fn full_opacity() -> f64 {
    1.0
}

#[derive(Default)]
pub struct ProjectMediaViews {
    requests: Mutex<BTreeMap<String, f64>>,
    sources: Mutex<BTreeMap<String, Source>>,
    performer_stores: Mutex<BTreeMap<String, tempfile::TempDir>>,
    cleanup_in_progress: Mutex<BTreeSet<String>>,
    #[cfg(any(test, feature = "native-client-fixture"))]
    fixture_cleanup_probe: Mutex<Option<std::sync::Arc<dyn Fn() + Send + Sync>>>,
    #[cfg(feature = "native-client-fixture")]
    pub(crate) fixture_storage: Mutex<Option<std::path::PathBuf>>,
}

const CLEANUP_IN_PROGRESS: &str = "Native project page cleanup is in progress";

struct CleanupGuard<'a> {
    active: &'a Mutex<BTreeSet<String>>,
    label: &'a str,
}
impl Drop for CleanupGuard<'_> {
    fn drop(&mut self) {
        self.active.lock().unwrap().remove(self.label);
    }
}
impl ProjectMediaViews {
    fn begin_cleanup<'a>(&'a self, label: &'a str) -> Result<CleanupGuard<'a>, String> {
        if !self
            .cleanup_in_progress
            .lock()
            .unwrap()
            .insert(label.into())
        {
            return Err(CLEANUP_IN_PROGRESS.into());
        }
        Ok(CleanupGuard {
            active: &self.cleanup_in_progress,
            label,
        })
    }
    fn ensure_available(&self, label: &str) -> Result<(), String> {
        if self.cleanup_in_progress.lock().unwrap().contains(label) {
            return Err(CLEANUP_IN_PROGRESS.into());
        }
        Ok(())
    }
}
struct Source {
    target: ProjectMediaTarget,
    generation: String,
    proxy: crate::participation_client::ClientProxy,
    retiring: bool,
}

fn authorize_target(
    snapshot: &SessionSnapshot,
    label: &str,
    target: &ProjectMediaTarget,
) -> Result<SocketAddr, String> {
    let role_matches = match target.role {
        ProjectMediaRole::Monitor => label == "main",
        ProjectMediaRole::Projection => label == "projection",
        ProjectMediaRole::Performer => crate::performer::is_performer_label(label),
    };
    if !role_matches
        || target.generation != snapshot.runtime_generation
        || !matches!(snapshot.status, SessionStatus::Ready | SessionStatus::Error)
    {
        return Err("The project page has no active window/session owner".into());
    }
    let url = tauri::Url::parse(&target.url).map_err(|error| error.to_string())?;
    let health = snapshot
        .health
        .as_ref()
        .and_then(|health| health.score_server.as_ref());
    let port = health
        .and_then(|server| match target.role {
            ProjectMediaRole::Performer => server.performer_port,
            _ => server.monitor_port,
        })
        .ok_or("The managed project page port is unavailable")?;
    let host = snapshot
        .host_address
        .as_deref()
        .ok_or("The managed project page host is unavailable")?;
    let expected =
        tauri::Url::parse(&format!("http://{host}:{port}/")).map_err(|error| error.to_string())?;
    if url.scheme() != "http"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.origin() != expected.origin()
        || url.port_or_known_default() != Some(port)
        || target.navigation.is_empty()
        || target.navigation.len() > 16384
    {
        return Err("The project page does not match the current managed source".into());
    }
    if target.role == ProjectMediaRole::Projection && !snapshot.projection_started {
        return Err("The projection start gate is closed".into());
    }
    Ok((Ipv4Addr::LOCALHOST, port).into())
}

fn validate_bounds(bounds: &ProjectMediaBounds) -> Result<(), String> {
    if ![
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        bounds.viewport_width,
        bounds.viewport_height,
        bounds.page_width,
        bounds.page_height,
        bounds.opacity,
        bounds.corner_radius,
    ]
    .iter()
    .all(|value| value.is_finite())
        || bounds.x < 0.0
        || bounds.y < 0.0
        || bounds.width <= 0.0
        || bounds.height <= 0.0
        || bounds.viewport_width <= 0.0
        || bounds.viewport_height <= 0.0
        || bounds.page_width <= 0.0
        || bounds.page_height <= 0.0
        || bounds.x + bounds.width > bounds.viewport_width + 1.0
        || bounds.y + bounds.height > bounds.viewport_height + 1.0
        || !(0.0..=1.0).contains(&bounds.opacity)
        || !(0.0..=1000.0).contains(&bounds.corner_radius)
    {
        return Err("Invalid native project page bounds".into());
    }
    if bounds.occlusions.len() > 32
        || bounds.occlusions.iter().any(|rect| {
            ![rect.x, rect.y, rect.width, rect.height]
                .iter()
                .all(|value| value.is_finite())
                || rect.x < 0.0
                || rect.y < 0.0
                || rect.width < 0.0
                || rect.height < 0.0
                || rect.x + rect.width > bounds.width + 1.0
                || rect.y + rect.height > bounds.height + 1.0
        })
    {
        return Err("Invalid native project page occlusion".into());
    }
    Ok(())
}

fn admit<R: Runtime>(app: &AppHandle<R>, label: &str, request: f64) -> Result<bool, String> {
    if !request.is_finite()
        || request.fract() != 0.0
        || !(0.0..=9_007_199_254_740_991.0).contains(&request)
    {
        return Err("Invalid native project page request".into());
    }
    let state = app.state::<ProjectMediaViews>();
    state.ensure_available(label)?;
    let mut requests = state.requests.lock().unwrap();
    if requests
        .get(label)
        .is_some_and(|current| *current >= request)
    {
        return Ok(false);
    }
    requests.insert(label.into(), request);
    Ok(true)
}

fn storage_root<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    #[cfg(feature = "native-client-fixture")]
    if let Some(root) = app
        .state::<ProjectMediaViews>()
        .fixture_storage
        .lock()
        .unwrap()
        .clone()
    {
        return Ok(root);
    }
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn performer_store<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
) -> Result<std::path::PathBuf, String> {
    let state = app.state::<ProjectMediaViews>();
    let mut stores = state.performer_stores.lock().unwrap();
    if !stores.contains_key(label) {
        stores.insert(
            label.into(),
            tempfile::Builder::new()
                .prefix("pnds-performer-store-")
                .tempdir()
                .map_err(|error| error.to_string())?,
        );
    }
    Ok(stores
        .get(label)
        .expect("owned performer storage")
        .path()
        .to_path_buf())
}

fn current<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    target: &ProjectMediaTarget,
    generation: &str,
) -> bool {
    app.state::<ProjectMediaViews>()
        .sources
        .lock()
        .unwrap()
        .get(label)
        .is_some_and(|owner| {
            !owner.retiring && owner.target == *target && owner.generation == generation
        })
        && app.state::<SessionManager>().runtime_generation() == generation
}

pub async fn sync<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    shell_origin: String,
    target: ProjectMediaTarget,
    request: f64,
    bounds: Option<ProjectMediaBounds>,
) -> Result<(), String> {
    app.state::<ProjectMediaViews>().ensure_available(&label)?;
    let runtime = app.state::<SessionManager>().creation_runtime();
    let upstream = authorize_target(&runtime.snapshot, &label, &target)?;
    if let Some(bounds) = bounds.as_ref() {
        validate_bounds(bounds)?;
    }
    if !admit(&app, &label, request)? {
        return Ok(());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let main = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| {
            main.state::<ProjectMediaViews>().ensure_available(&label)?;
            if main
                .state::<ProjectMediaViews>()
                .requests
                .lock()
                .unwrap()
                .get(&label)
                != Some(&request)
                || main.state::<SessionManager>().creation_runtime().generation
                    != runtime.generation
            {
                return Ok(());
            }
            authorize_target(&main.state::<SessionManager>().snapshot(), &label, &target)?;
            let matches = main
                .state::<ProjectMediaViews>()
                .sources
                .lock()
                .unwrap()
                .get(&label)
                .is_some_and(|source| {
                    source.target == target
                        && source.generation == runtime.generation
                        && !source.retiring
                });
            if !matches {
                close_on_main(&main, &label, None)?;
                let storage_key = format!(
                    "project-page\n{}\n{label}\n{:?}",
                    runtime.snapshot.project_path.as_deref().unwrap_or(""),
                    target.role
                );
                let origin_data = if target.role == ProjectMediaRole::Performer {
                    performer_store(&main, &label)?
                } else {
                    storage_root(&main)?
                };
                let proxy = crate::participation_client::ClientProxy::start_local(
                    &origin_data,
                    upstream,
                    &storage_key,
                    &runtime
                        .snapshot
                        .health
                        .as_ref()
                        .and_then(|health| health.score_server.as_ref())
                        .map(|server| {
                            [server.performer_port, server.monitor_port]
                                .into_iter()
                                .flatten()
                                .map(|port| SocketAddr::from((Ipv4Addr::LOCALHOST, port)))
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default(),
                )?;
                let requested =
                    tauri::Url::parse(&target.url).map_err(|error| error.to_string())?;
                let page_url = format!(
                    "http://{}:{}{}{}",
                    proxy.hostname,
                    proxy.origin_port,
                    requested.path(),
                    requested
                        .query()
                        .map(|query| format!("?{query}"))
                        .unwrap_or_default()
                );
                let proxy_address = proxy.address;
                main.state::<ProjectMediaViews>()
                    .sources
                    .lock()
                    .unwrap()
                    .insert(
                        label.clone(),
                        Source {
                            target: target.clone(),
                            generation: runtime.generation.clone(),
                            proxy,
                            retiring: false,
                        },
                    );
                #[cfg(target_os = "macos")]
                if let Err(error) = native::create(
                    &main,
                    &label,
                    &target,
                    &runtime.generation,
                    page_url,
                    proxy_address,
                    &shell_origin,
                    bounds.clone(),
                ) {
                    let _ = close_on_main(&main, &label, None);
                    return Err(error);
                }
                #[cfg(not(target_os = "macos"))]
                {
                    let _ = (page_url, proxy_address, shell_origin);
                    return Err("Native project media requires macOS".into());
                }
            }
            #[cfg(target_os = "macos")]
            native::show(&main, &label, bounds)?;
            Ok(())
        })();
        let _ = tx.send(result);
    })
    .map_err(|error| error.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(10), rx)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?
}

fn close_on_main<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    navigation: Option<&str>,
) -> Result<(), String> {
    let state = app.state::<ProjectMediaViews>();
    let _cleanup = state.begin_cleanup(label)?;
    let captured = {
        let mut sources = state.sources.lock().unwrap();
        let Some(source) = sources.get_mut(label) else {
            return Ok(());
        };
        if navigation.is_some_and(|navigation| source.target.navigation != navigation) {
            return Ok(());
        }
        source.retiring = true;
        (source.target.clone(), source.generation.clone())
    };
    #[cfg(any(test, feature = "native-client-fixture"))]
    {
        let probe = state.fixture_cleanup_probe.lock().unwrap().clone();
        if let Some(probe) = probe {
            probe();
        }
    }
    #[cfg(target_os = "macos")]
    native::close(label)?;
    {
        let mut sources = state.sources.lock().unwrap();
        let source = sources
            .get_mut(label)
            .filter(|source| source.target == captured.0 && source.generation == captured.1)
            .ok_or("Native project page owner changed during cleanup")?;
        source.proxy.shutdown()?;
        sources.remove(label);
    }
    Ok(())
}

pub async fn close<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    navigation: String,
    request: f64,
) -> Result<(), String> {
    if !admit(&app, &label, request)? {
        return Ok(());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let main = app.clone();
    app.run_on_main_thread(move || {
        let is_current = main
            .state::<ProjectMediaViews>()
            .requests
            .lock()
            .unwrap()
            .get(&label)
            == Some(&request);
        let _ = tx.send(if is_current {
            close_on_main(&main, &label, Some(&navigation))
        } else {
            Ok(())
        });
    })
    .map_err(|error| error.to_string())?;
    rx.await.map_err(|error| error.to_string())?
}

pub async fn post<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    navigation: String,
    message: serde_json::Value,
) -> Result<(), String> {
    if serde_json::to_vec(&message)
        .map_err(|error| error.to_string())?
        .len()
        > 65536
        || !outgoing_message(&message)
    {
        return Err("Unsupported project page message".into());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let main = app.clone();
    app.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        let result = native::post(&main, &label, &navigation, &message);
        #[cfg(not(target_os = "macos"))]
        let result = {
            let _ = (main, label, navigation, message);
            Err("Native project media requires macOS".into())
        };
        let _ = tx.send(result);
    })
    .map_err(|error| error.to_string())?;
    rx.await.map_err(|error| error.to_string())?
}

fn outgoing_message(message: &serde_json::Value) -> bool {
    message.get("channel").and_then(|value| value.as_str()) == Some("pnds.preview")
        || (message.get("version").and_then(|value| value.as_u64()) == Some(1)
            && matches!(
                message.get("type").and_then(|value| value.as_str()),
                Some(
                    "pnds:theme"
                        | "pnds:locale"
                        | "pnds:test-touch"
                        | "pnds:focus"
                        | "pnds:host-focus"
                )
            ))
}

fn incoming_message(message: &serde_json::Value) -> bool {
    message.get("channel").and_then(|value| value.as_str()) == Some("pnds.preview")
        || matches!(
            message.get("type").and_then(|value| value.as_str()),
            Some("pnds:guest-focus" | "pnds-projection" | "pnds:media-error" | "pnds:media-active")
        )
}

/// Explicit native window retirement, also used when a shell is destroyed.
/// The document and its proxy remain owned if cleanup reports a failure.
pub(crate) fn close_window<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<(), String> {
    retire_window(app, label)?;
    if let Some(state) = app.try_state::<ProjectMediaViews>() {
        state.performer_stores.lock().unwrap().remove(label);
        state.requests.lock().unwrap().remove(label);
    }
    Ok(())
}

fn retire_window<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<(), String> {
    if app.try_state::<ProjectMediaViews>().is_none() {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    if objc2_foundation::MainThreadMarker::new().is_some() {
        return close_on_main(app, label, None);
    }
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let main = app.clone();
    let label = label.to_owned();
    app.run_on_main_thread(move || {
        let _ = tx.send(close_on_main(&main, &label, None));
    })
    .map_err(|error| error.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|error| error.to_string())?
}

pub(crate) fn close_all<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let Some(state) = app.try_state::<ProjectMediaViews>() else {
        return Ok(());
    };
    let labels = state
        .sources
        .lock()
        .unwrap()
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    for label in labels {
        retire_window(app, &label)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn native_cleanup_barrier_rejects_reentrant_public_close_and_sync_then_allows_retry() {
        let app = tauri::test::mock_builder()
            .manage(ProjectMediaViews::default())
            .manage(SessionManager::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let state = app.state::<ProjectMediaViews>();
        let barrier = state.begin_cleanup("main").unwrap();
        assert_eq!(
            close(app.handle().clone(), "main".into(), "owned".into(), 1.0).await,
            Err(CLEANUP_IN_PROGRESS.into())
        );
        let target = ProjectMediaTarget {
            role: ProjectMediaRole::Monitor,
            url: "http://192.0.2.25:8080/".into(),
            navigation: "replacement".into(),
            generation: "old".into(),
        };
        assert_eq!(
            sync(
                app.handle().clone(),
                "main".into(),
                "tauri://localhost".into(),
                target,
                2.0,
                None
            )
            .await,
            Err(CLEANUP_IN_PROGRESS.into())
        );
        drop(barrier);
        assert!(
            close(app.handle().clone(), "main".into(), "owned".into(), 3.0)
                .await
                .is_ok()
        );
    }

    #[test]
    fn idle_shell_cannot_turn_the_native_page_into_an_arbitrary_network_proxy() {
        let snapshot = SessionManager::default().snapshot();
        let target = ProjectMediaTarget {
            role: ProjectMediaRole::Monitor,
            url: "http://192.0.2.25:8080/".into(),
            navigation: "first".into(),
            generation: snapshot.runtime_generation.clone(),
        };
        assert!(authorize_target(&snapshot, "main", &target).is_err());
    }

    #[test]
    fn page_source_and_window_role_are_locked_to_the_running_project() {
        let mut snapshot = SessionManager::default().snapshot();
        snapshot.status = SessionStatus::Ready;
        snapshot.host_address = Some("192.0.2.10".into());
        snapshot.health = Some(serde_json::from_value(serde_json::json!({"status":"ready","scoreServer":{"performerPort":8081,"monitorPort":8082}})).unwrap());
        let mut target = ProjectMediaTarget {
            role: ProjectMediaRole::Monitor,
            url: "http://192.0.2.10:8082/?lang=en".into(),
            navigation: "run-a:monitor".into(),
            generation: snapshot.runtime_generation.clone(),
        };
        assert_eq!(
            authorize_target(&snapshot, "main", &target).unwrap(),
            "127.0.0.1:8082".parse::<SocketAddr>().unwrap()
        );
        for url in [
            "http://192.0.2.11:8082/",
            "http://192.0.2.10:8081/",
            "http://user@192.0.2.10:8082/",
            "https://192.0.2.10:8082/",
        ] {
            target.url = url.into();
            assert!(authorize_target(&snapshot, "main", &target).is_err());
        }
        target.url = "http://192.0.2.10:8082/".into();
        assert!(authorize_target(&snapshot, "projection", &target).is_err());
        let current_generation = target.generation.clone();
        target.generation = "earlier-run".into();
        assert!(authorize_target(&snapshot, "main", &target).is_err());
        target.generation = current_generation;
        target.role = ProjectMediaRole::Projection;
        assert!(authorize_target(&snapshot, "projection", &target).is_err());
        snapshot.projection_started = true;
        assert!(authorize_target(&snapshot, "projection", &target).is_ok());
    }

    #[test]
    fn declared_dns_host_case_is_canonical_at_each_native_authorization_boundary() {
        let mut snapshot = SessionManager::default().snapshot();
        snapshot.status = SessionStatus::Ready;
        snapshot.host_address = Some("Stage.Local".into());
        snapshot.projection_started = true;
        snapshot.health = Some(serde_json::from_value(serde_json::json!({"status":"ready","scoreServer":{"performerPort":8081,"monitorPort":8082}})).unwrap());
        for (role, label, port) in [
            (ProjectMediaRole::Monitor, "main", 8082),
            (ProjectMediaRole::Projection, "projection", 8082),
            (
                ProjectMediaRole::Performer,
                "performer-00000000-0000-4000-8000-000000000323",
                8081,
            ),
        ] {
            let mut target = ProjectMediaTarget {
                role,
                url: format!("http://stage.local:{port}/"),
                navigation: "uppercase-host".into(),
                generation: snapshot.runtime_generation.clone(),
            };
            assert_eq!(
                authorize_target(&snapshot, label, &target).unwrap(),
                SocketAddr::from((Ipv4Addr::LOCALHOST, port))
            );
            target.url = format!("http://stage.local.invalid:{port}/");
            assert!(authorize_target(&snapshot, label, &target).is_err());
        }
    }

    #[test]
    fn project_messages_cannot_invoke_app_commands_or_send_arbitrary_code() {
        for message in [
            serde_json::json!({"type":"tauri:invoke","cmd":"quit_app"}),
            serde_json::json!({"script":"alert(1)"}),
            serde_json::json!({"type":"pnds:focus","version":2}),
        ] {
            assert!(!outgoing_message(&message));
            assert!(!incoming_message(&message));
        }
        assert!(outgoing_message(
            &serde_json::json!({"channel":"pnds.preview","version":1,"type":"set","values":{"tempo":120}})
        ));
        assert!(incoming_message(
            &serde_json::json!({"type":"pnds-projection","zoom":"page"})
        ));
    }
}

#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
pub(crate) fn fixture_set_cleanup_probe(
    app: &AppHandle,
    probe: Option<std::sync::Arc<dyn Fn() + Send + Sync>>,
) {
    *app.state::<ProjectMediaViews>()
        .fixture_cleanup_probe
        .lock()
        .unwrap() = probe;
}

#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
pub(crate) fn fixture_stop_source(app: &AppHandle, label: &str) -> Result<(), String> {
    app.state::<ProjectMediaViews>()
        .sources
        .lock()
        .unwrap()
        .get_mut(label)
        .ok_or("Fixture source missing")?
        .proxy
        .shutdown()
}

#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
pub(crate) async fn fixture_evaluate(
    app: AppHandle,
    label: String,
    script: &str,
) -> Result<serde_json::Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let source = script.to_owned();
    app.run_on_main_thread(move || native::fixture_evaluate(&label, source, tx))
        .map_err(|error| error.to_string())?;
    let result = tokio::time::timeout(std::time::Duration::from_secs(3), rx)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())??;
    serde_json::from_str(&result).map_err(|error| error.to_string())
}

#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
pub(crate) async fn fixture_focus(app: AppHandle, label: String) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(native::fixture_focus(&label));
    })
    .map_err(|error| error.to_string())?;
    rx.await.map_err(|error| error.to_string())?
}

#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
pub(crate) async fn fixture_shell_origin(
    app: AppHandle,
    label: &str,
) -> Result<serde_json::Value, String> {
    fixture_shell_evaluate(
        app,
        label,
        "JSON.stringify({origin:location.origin,url:location.href,ready:document.readyState})",
    )
    .await
}

#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
pub(crate) async fn fixture_shell_evaluate(
    app: AppHandle,
    label: &str,
    source: &str,
) -> Result<serde_json::Value, String> {
    use block2::RcBlock;
    use objc2::{msg_send, runtime::AnyObject};
    use objc2_foundation::NSString;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let window = app
        .get_webview_window(label)
        .ok_or("Origin probe window missing")?;
    let source = source.to_owned();
    window
        .with_webview(move |platform| {
            let tx = Mutex::new(Some(tx));
            let callback = RcBlock::new(move |value: *mut AnyObject, cause: *mut AnyObject| {
                let result = if value.is_null() || !cause.is_null() {
                    Err("Shell origin probe failed".into())
                } else {
                    unsafe {
                        let text = &*value.cast::<NSString>();
                        serde_json::from_str::<serde_json::Value>(&text.to_string())
                            .map_err(|error| error.to_string())
                    }
                };
                if let Some(tx) = tx.lock().unwrap().take() {
                    let _ = tx.send(result);
                }
            });
            unsafe {
                let view = &*platform.inner().cast::<AnyObject>();
                let source = NSString::from_str(&source);
                let _: () =
                    msg_send![view,evaluateJavaScript:&*source,completionHandler:&*callback];
            }
        })
        .map_err(|error| error.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(3), rx)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?
}

#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
pub(crate) async fn fixture_click(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
) -> Result<serde_json::Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(native::fixture_click(&label, x, y));
    })
    .map_err(|error| error.to_string())?;
    rx.await.map_err(|error| error.to_string())?
}
