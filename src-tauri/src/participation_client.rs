//! App-owned participation lifecycle. Musical messages remain project-owned.
use crate::lan_discovery::LanNodeRole;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientHostInfo {
    pub protocol_version: u32,
    pub host_id: String,
    pub node_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<LanNodeRole>,
    pub performance: Option<ClientPerformance>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientPerformance {
    pub project_id: String,
    pub performance_id: String,
    pub project_name: String,
    pub performer_url: String,
    pub supports_performer_url: bool,
}

use hyper::service::service_fn;
use hyper_util::client::legacy::{connect::HttpConnector, Client};
use hyper_util::rt::{TokioExecutor, TokioIo};
use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub(crate) static ROLE_ADMISSION: Mutex<()> = Mutex::new(());

const METADATA_PATH: &str = "/__pnds/participation";
const METADATA_LIMIT: usize = 65536;
const TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ClientPhase {
    #[default]
    Idle,
    Inspecting,
    Confirm,
    Connecting,
    Open,
    Disconnected,
    Ended,
    Changed,
    Leaving,
    CleanupFailed,
    Error,
}
/// Stable localized workflow code, with optional diagnostic data shown separately.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientError {
    pub code: String,
    pub detail: Option<String>,
}
impl From<String> for ClientError {
    fn from(error: String) -> Self {
        let (code, detail) = error
            .split_once(": ")
            .map_or((error.as_str(), None), |(code, detail)| {
                (code, Some(detail.to_string()))
            });
        if code.starts_with("participation.errors.") {
            Self {
                code: code.into(),
                detail,
            }
        } else {
            Self {
                code: "participation.errors.unexpected".into(),
                detail: Some(error),
            }
        }
    }
}
impl From<&str> for ClientError {
    fn from(error: &str) -> Self {
        error.to_string().into()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClientSnapshot {
    pub revision: u32,
    pub phase: ClientPhase,
    pub address: Option<String>,
    pub host: Option<ClientHostInfo>,
    /// Host and performance confirmed for the retained page.
    pub active_host: Option<ClientHostInfo>,
    pub expected_host_id: Option<String>,
    pub page_url: Option<String>,
    pub error: Option<ClientError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecentHost {
    pub host_id: String,
    pub node_name: String,
    pub address: String,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ClientNodePreview {
    pub address: String,
    pub host: ClientHostInfo,
    pub readme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
}

/// Native score views navigate the durable origin and use the actual loopback
/// listener as their HTTP proxy. Transport allocation is never a storage key.
#[derive(Debug, Clone)]
pub(crate) struct ClientPageTarget {
    pub epoch: u32,
    pub page_url: String,
    pub proxy_address: SocketAddr,
}

type Sink = Arc<dyn Fn(ClientSnapshot) + Send + Sync>;
type ViewPrepare = Arc<
    dyn Fn(
            ClientPageTarget,
        )
            -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send>>
        + Send
        + Sync,
>;
type ViewTransition = Arc<dyn Fn(ClientPageTarget) -> Result<(), String> + Send + Sync>;
type ViewCleanup = Arc<dyn Fn() -> Result<(), String> + Send + Sync>;
fn cleanup_errors(view: Option<String>, network: Option<String>) -> Option<String> {
    match (view, network) {
        (Some(view), Some(network)) => Some(format!("{view}; {network}")),
        (Some(error), None) | (None, Some(error)) => Some(error),
        (None, None) => None,
    }
}
#[derive(Default)]
pub struct ClientCoordinator {
    inner: Mutex<ClientState>,
    sink: Mutex<Option<Sink>>,
    view_cleanup: Mutex<Option<ViewCleanup>>,
    view_prepare: Mutex<Option<ViewPrepare>>,
    view_commit: Mutex<Option<ViewTransition>>,
    view_cancel: Mutex<Option<ViewTransition>>,
}
#[derive(Default)]
struct ClientState {
    epoch: u32,
    page_epoch: u32,
    committing: bool,
    handoff_failed: bool,
    pending: Option<PendingEntry>,
    entry_resume_phase: Option<ClientPhase>,
    retired: Vec<ClientProxy>,
    snapshot: ClientSnapshot,
    target: Option<SocketAddr>,
    proxy: Option<ClientProxy>,
    confirmed: Option<ClientHostInfo>,
    context_revoked: bool,
}
impl ClientState {
    fn public_snapshot(&self) -> ClientSnapshot {
        ClientSnapshot {
            active_host: self
                .snapshot
                .page_url
                .as_ref()
                .and(self.confirmed.as_ref())
                .cloned(),
            ..self.snapshot.clone()
        }
    }
}
impl ClientCoordinator {
    pub fn set_view_cleanup(&self, cleanup: ViewCleanup) {
        *self.view_cleanup.lock().unwrap() = Some(cleanup);
    }
    fn cleanup_view(&self) -> Result<(), String> {
        let cleanup = self.view_cleanup.lock().unwrap().clone();
        cleanup.map_or(Ok(()), |cleanup| {
            cleanup().map_err(|error| format!("participation.errors.cleanupFailed: {error}"))
        })
    }
    fn retire_proxy(&self, proxy: &mut ClientProxy) -> Result<(), String> {
        let view = self.cleanup_view().err();
        let network = proxy.shutdown().err();
        cleanup_errors(view, network).map_or(Ok(()), Err)
    }
    pub fn set_sink(&self, sink: Sink) {
        *self.sink.lock().unwrap() = Some(sink);
    }
    fn publish(&self) -> ClientSnapshot {
        let snapshot = self.snapshot();
        if let Some(sink) = self.sink.lock().unwrap().as_ref() {
            sink(snapshot.clone());
        }
        snapshot
    }
    pub fn snapshot(&self) -> ClientSnapshot {
        self.inner.lock().unwrap().public_snapshot()
    }
    pub(crate) fn view_target(&self) -> Option<ClientPageTarget> {
        let state = self.inner.lock().unwrap();
        if state.committing || state.handoff_failed {
            return None;
        }
        Some(ClientPageTarget {
            epoch: state.page_epoch,
            page_url: state.snapshot.page_url.clone()?,
            proxy_address: state.proxy.as_ref()?.address,
        })
    }
    pub fn busy(&self) -> bool {
        let state = self.inner.lock().unwrap();
        let snapshot = &state.snapshot;
        state.target.is_some()
            || snapshot.page_url.is_some()
            || matches!(
                snapshot.phase,
                ClientPhase::Inspecting
                    | ClientPhase::Confirm
                    | ClientPhase::Connecting
                    | ClientPhase::Open
                    | ClientPhase::Disconnected
                    | ClientPhase::Leaving
                    | ClientPhase::CleanupFailed
            )
    }
    pub async fn inspect_guarded(
        &self,
        address: String,
        expected: Option<String>,
        host_active: impl FnOnce() -> bool,
    ) -> Result<ClientSnapshot, String> {
        let (normalized, target) = parse_address(&address)?;
        let epoch = {
            let _admission = ROLE_ADMISSION.lock().unwrap();
            if host_active() {
                return Err("participation.errors.hostActive".into());
            }
            let mut state = self.inner.lock().unwrap();
            if state.proxy.is_some()
                || matches!(
                    state.snapshot.phase,
                    ClientPhase::Inspecting
                        | ClientPhase::Connecting
                        | ClientPhase::Leaving
                        | ClientPhase::CleanupFailed
                )
            {
                return Err("participation.errors.leaveFirst".into());
            }
            state.epoch = state.epoch.wrapping_add(1);
            state.snapshot = ClientSnapshot {
                revision: state.snapshot.revision.wrapping_add(1),
                phase: ClientPhase::Inspecting,
                address: Some(normalized.clone()),
                expected_host_id: expected,
                ..Default::default()
            };
            state.target = Some(target);
            state.epoch
        };
        self.publish();
        let result = fetch_host(&normalized, target).await;
        {
            let mut state = self.inner.lock().unwrap();
            if state.epoch != epoch {
                return Ok(state.public_snapshot());
            }
            match result {
                Ok(host) => {
                    state.snapshot.host = Some(host);
                    state.snapshot.phase = ClientPhase::Confirm;
                }
                Err(error) => {
                    state.snapshot.phase = ClientPhase::Error;
                    state.snapshot.error = Some(error.to_string().into());
                }
            }
            state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
        }
        Ok(self.publish())
    }
    #[cfg(test)]
    pub async fn join(&self, data_dir: &Path) -> Result<ClientSnapshot, String> {
        let (epoch, address, target, confirmed) = {
            let mut state = self.inner.lock().unwrap();
            if state.snapshot.phase != ClientPhase::Confirm {
                return Err("participation.errors.confirmFirst".into());
            }
            let host = state
                .snapshot
                .host
                .clone()
                .ok_or("participation.errors.confirmFirst")?;
            let performance = host
                .performance
                .as_ref()
                .ok_or("participation.errors.ended")?;
            if !performance.supports_performer_url {
                return Err("participation.errors.adaptation".into());
            }
            let address = state
                .snapshot
                .address
                .clone()
                .ok_or("participation.errors.invalidAddress")?;
            let target = state.target.ok_or("participation.errors.invalidAddress")?;
            state.epoch = state.epoch.wrapping_add(1);
            state.snapshot.phase = ClientPhase::Connecting;
            state.snapshot.error = None;
            state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
            (state.epoch, address, target, host)
        };
        self.publish();
        let latest = fetch_host(&address, target).await;
        {
            let mut state = self.inner.lock().unwrap();
            if state.epoch != epoch {
                return Ok(state.public_snapshot());
            }
            install_confirmed(&mut state, latest, &confirmed, data_dir, target, epoch);
            state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
        }
        Ok(self.publish())
    }
    /// Discovery may revoke network admission, never ownership of a loaded document.
    pub async fn poll(&self) -> ClientSnapshot {
        let current = {
            let state = self.inner.lock().unwrap();
            if matches!(
                state.snapshot.phase,
                ClientPhase::Idle
                    | ClientPhase::Inspecting
                    | ClientPhase::Connecting
                    | ClientPhase::Leaving
                    | ClientPhase::CleanupFailed
            ) {
                return state.public_snapshot();
            }
            let (Some(address), Some(target)) = (&state.snapshot.address, state.target) else {
                return state.public_snapshot();
            };
            (state.epoch, address.clone(), target)
        };
        let result = fetch_host(&current.1, current.2).await;
        {
            let mut state = self.inner.lock().unwrap();
            if state.epoch != current.0 {
                return state.public_snapshot();
            }
            match result {
                Ok(host) => {
                    let same = state
                        .confirmed
                        .as_ref()
                        .is_some_and(|confirmed| same_context(confirmed, &host));
                    if state.proxy.is_some() {
                        if !same {
                            state.context_revoked = true;
                        }
                        let admitted = same && !state.context_revoked;
                        state.proxy.as_ref().unwrap().set_admission(admitted);
                        state.snapshot.phase = if admitted {
                            ClientPhase::Open
                        } else if host.performance.is_none() {
                            ClientPhase::Ended
                        } else {
                            ClientPhase::Changed
                        };
                    } else {
                        state.snapshot.phase = ClientPhase::Confirm;
                    }
                    state.snapshot.host = Some(host);
                    state.snapshot.error = None;
                }
                Err(error) => {
                    if let Some(proxy) = &state.proxy {
                        proxy.set_admission(false);
                    }
                    state.snapshot.phase = match &error {
                        HostReadError::Unavailable(_) => ClientPhase::Disconnected,
                        HostReadError::Rejected(_) => ClientPhase::Error,
                    };
                    state.snapshot.error = Some(error.to_string().into());
                }
            }
            state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
        }
        self.publish()
    }
    pub fn leave(&self) -> ClientSnapshot {
        // Admission and ownership transfer are one transaction. In particular,
        // no intermediate cancellation publication may reopen entry admission.
        let (epoch, mut pending, mut current, mut retired) = {
            let mut state = self.inner.lock().unwrap();
            if state.committing {
                return state.public_snapshot();
            }
            if state.snapshot.phase == ClientPhase::Leaving {
                // A manual Refresh may be waiting for its own cleanup. Revoke
                // its later reinstall; that operation still owns its resource.
                state.epoch = state.epoch.wrapping_add(1);
                state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
                return state.public_snapshot();
            }
            state.committing = true;
            state.epoch = state.epoch.wrapping_add(1);
            state.snapshot.page_url = None;
            state.snapshot.phase = ClientPhase::Leaving;
            state.snapshot.error = None;
            state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
            state.entry_resume_phase = None;
            (
                state.epoch,
                state.pending.take(),
                state.proxy.take(),
                std::mem::take(&mut state.retired),
            )
        };
        self.publish();
        let cancel = self.view_cancel.lock().unwrap().clone();
        let pending_error = pending.as_mut().and_then(|pending| {
            let view = cancel
                .as_ref()
                .and_then(|cancel| cancel(pending.target.clone()).err());
            pending.proxy.set_admission(false);
            cleanup_errors(view, pending.proxy.shutdown().err())
        });
        if pending_error.is_none() {
            pending = None;
        }
        // Always attempt the active native owner as well, even if a staged
        // store failed to flush. Their actual WebKit store owners are separate.
        let view_error = self.cleanup_view().err();
        let network_error = current.as_mut().and_then(|proxy| {
            proxy.set_admission(false);
            proxy.shutdown().err()
        });
        let current_error = cleanup_errors(view_error, network_error);
        if current_error.is_none() {
            current = None;
        }
        let mut errors = pending_error
            .into_iter()
            .chain(current_error)
            .collect::<Vec<_>>();
        retired.retain_mut(|proxy| {
            proxy.set_admission(false);
            if let Err(error) = proxy.shutdown() {
                errors.push(error);
                true
            } else {
                false
            }
        });
        {
            let mut state = self.inner.lock().unwrap();
            if state.epoch != epoch {
                return state.public_snapshot();
            }
            state.committing = false;
            if errors.is_empty() {
                state.snapshot = ClientSnapshot {
                    revision: state.snapshot.revision.wrapping_add(1),
                    ..Default::default()
                };
                state.target = None;
                state.confirmed = None;
                state.context_revoked = false;
                state.handoff_failed = false;
            } else {
                state.pending = pending;
                state.proxy = current;
                state.retired = retired;
                state.snapshot.phase = ClientPhase::CleanupFailed;
                state.snapshot.error = Some(
                    format!("participation.errors.cleanupFailed: {}", errors.join("; ")).into(),
                );
                state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
            }
        }
        self.publish()
    }
    /// Refresh is one owned operation; cancellation cannot create a second join.
    pub async fn refresh(&self, data_dir: &Path) -> Result<ClientSnapshot, String> {
        let (epoch, address, target, confirmed, mut retired) = {
            let mut state = self.inner.lock().unwrap();
            if state.committing
                || state.pending.is_some()
                || state.snapshot.phase == ClientPhase::CleanupFailed
            {
                return Err("participation.errors.leaveFirst".into());
            }
            if state.snapshot.page_url.is_none() {
                return Err("participation.errors.inactive".into());
            }
            let confirmed = state
                .confirmed
                .clone()
                .ok_or("participation.errors.confirmFirst")?;
            let address = state
                .snapshot
                .address
                .clone()
                .ok_or("participation.errors.invalidAddress")?;
            let target = state.target.ok_or("participation.errors.invalidAddress")?;
            let retired = state.proxy.take().ok_or("participation.errors.inactive")?;
            state.epoch = state.epoch.wrapping_add(1);
            state.snapshot.phase = ClientPhase::Leaving;
            state.snapshot.page_url = None;
            state.snapshot.error = None;
            state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
            (state.epoch, address, target, confirmed, retired)
        };
        self.publish();
        if let Err(error) = self.retire_proxy(&mut retired) {
            let mut state = self.inner.lock().unwrap();
            if state.epoch == epoch || state.snapshot.phase == ClientPhase::Leaving {
                state.proxy = Some(retired);
                state.snapshot.phase = ClientPhase::CleanupFailed;
                state.snapshot.error = Some(error.into());
                state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
            }
            drop(state);
            return Ok(self.publish());
        }
        {
            let mut state = self.inner.lock().unwrap();
            if state.epoch != epoch {
                if state.snapshot.phase == ClientPhase::Leaving {
                    state.snapshot = ClientSnapshot {
                        revision: state.snapshot.revision.wrapping_add(1),
                        ..Default::default()
                    };
                    state.target = None;
                }
                drop(state);
                return Ok(self.publish());
            }
            state.snapshot.phase = ClientPhase::Connecting;
            state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
        }
        self.publish();
        let latest = fetch_host(&address, target).await;
        {
            let mut state = self.inner.lock().unwrap();
            if state.epoch != epoch {
                return Ok(state.public_snapshot());
            }
            install_confirmed(&mut state, latest, &confirmed, data_dir, target, epoch);
            state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
        }
        Ok(self.publish())
    }
}
fn install_confirmed(
    state: &mut ClientState,
    latest: Result<ClientHostInfo, HostReadError>,
    confirmed: &ClientHostInfo,
    data_dir: &Path,
    target: SocketAddr,
    epoch: u32,
) {
    match latest {
        Ok(host) if same_context(confirmed, &host) => {
            match ClientProxy::start(data_dir, target, &host) {
                Ok(proxy) => {
                    state.snapshot.page_url = Some(format!(
                        "http://{}:{}/?pndsClientPass={epoch}",
                        proxy.hostname, proxy.origin_port
                    ));
                    state.proxy = Some(proxy);
                    state.page_epoch = epoch;
                    state.snapshot.expected_host_id = Some(host.host_id.clone());
                    state.confirmed = Some(host.clone());
                    state.context_revoked = false;
                    state.handoff_failed = false;
                    state.snapshot.host = Some(host);
                    state.snapshot.phase = ClientPhase::Open;
                    state.snapshot.error = None;
                }
                Err(error) => {
                    state.snapshot.error = Some(error.into());
                    state.snapshot.phase = ClientPhase::Error;
                }
            }
        }
        Ok(host) => {
            state.snapshot.host = Some(host);
            state.snapshot.phase = ClientPhase::Confirm;
            state.snapshot.error = Some("participation.errors.changed".into());
        }
        Err(error) => {
            state.snapshot.error = Some(error.to_string().into());
            state.snapshot.phase = ClientPhase::Error;
        }
    }
}

pub(crate) fn validate_recent_hosts(hosts: &[RecentHost]) -> Result<(), String> {
    let mut identities = std::collections::HashSet::new();
    if hosts.len() > 32 {
        return Err("participation.errors.recentLimit".into());
    }
    for host in hosts {
        for value in [&host.host_id, &host.node_name] {
            if value.trim().is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
                return Err("participation.errors.invalidRecent".into());
            }
        }
        if !identities.insert(&host.host_id) {
            return Err("participation.errors.invalidRecent".into());
        }
        parse_address(&host.address)?;
    }
    Ok(())
}

fn same_context(a: &ClientHostInfo, b: &ClientHostInfo) -> bool {
    a.host_id == b.host_id
        && a.performance
            .as_ref()
            .zip(b.performance.as_ref())
            .is_some_and(|(a, b)| {
                a.project_id == b.project_id && a.performance_id == b.performance_id
            })
}
fn parse_address(address: &str) -> Result<(String, SocketAddr), String> {
    let url =
        reqwest::Url::parse(address.trim()).map_err(|_| "participation.errors.invalidAddress")?;
    if url.scheme() != "http"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
        || url.port().is_none()
    {
        return Err("participation.errors.invalidAddress".into());
    }
    let host = url
        .host_str()
        .ok_or("participation.errors.invalidAddress")?;
    let ip = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<IpAddr>()
        .map_err(|_| "participation.errors.invalidAddress")?;
    let local = match ip {
        IpAddr::V4(ip) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.segments()[0] & 0xfe00 == 0xfc00
                || ip.segments()[0] & 0xffc0 == 0xfe80
        }
    };
    if !local {
        return Err("participation.errors.localAddress".into());
    }
    let target = SocketAddr::new(ip, url.port().unwrap());
    Ok((url.to_string(), target))
}
#[derive(Debug)]
enum HostReadError {
    Unavailable(String),
    Rejected(String),
}
impl std::fmt::Display for HostReadError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unavailable(error) | Self::Rejected(error) => formatter.write_str(error),
        }
    }
}
fn participation_http_client(
    address: &str,
    target: SocketAddr,
) -> Result<reqwest::Client, HostReadError> {
    let url = reqwest::Url::parse(address).map_err(|error| {
        HostReadError::Unavailable(format!("participation.errors.unavailable: {error}"))
    })?;
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .no_proxy()
        .timeout(TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .resolve(url.host_str().unwrap(), target)
        .build()
        .map_err(|error| {
            HostReadError::Unavailable(format!("participation.errors.unavailable: {error}"))
        })
}

async fn fetch_host(address: &str, target: SocketAddr) -> Result<ClientHostInfo, HostReadError> {
    let mut response = participation_http_client(address, target)?
        .get(format!("{}{METADATA_PATH}", address.trim_end_matches('/')))
        .header("x-pnds-native-client", "1")
        .send()
        .await
        .map_err(|error| {
            HostReadError::Unavailable(format!("participation.errors.unavailable: {error}"))
        })?;
    let status = response.status();
    if status != reqwest::StatusCode::OK {
        let detail = format!("GET {METADATA_PATH} returned HTTP {status}");
        return Err(
            if status.is_server_error()
                || status == reqwest::StatusCode::REQUEST_TIMEOUT
                || status == reqwest::StatusCode::TOO_MANY_REQUESTS
            {
                HostReadError::Unavailable(format!("participation.errors.unavailable: {detail}"))
            } else {
                HostReadError::Rejected(format!("participation.errors.invalidMetadata: {detail}"))
            },
        );
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        HostReadError::Unavailable(format!("participation.errors.unavailable: {error}"))
    })? {
        if bytes.len() + chunk.len() > METADATA_LIMIT {
            return Err(HostReadError::Rejected(format!(
                "participation.errors.metadataTooLarge: GET {METADATA_PATH} exceeded {METADATA_LIMIT} bytes"
            )));
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_host_metadata(&bytes).map_err(HostReadError::Rejected)
}

pub(crate) async fn preview_client_node(
    address: &str,
    expected_host_id: Option<&str>,
    locale: &str,
    known_performance_id: Option<&str>,
) -> Result<ClientNodePreview, String> {
    let (address, target) = parse_address(address)?;
    let host = fetch_host(&address, target)
        .await
        .map_err(|error| error.to_string())?;
    if expected_host_id.is_some_and(|expected| expected != host.host_id) {
        return Err("participation.errors.changed".into());
    }
    let unchanged = host.performance.as_ref().is_some_and(|performance| {
        Some(performance.performance_id.as_str()) == known_performance_id
    });
    let (readme, cover) = if !unchanged && host.role.is_some() && host.performance.is_some() {
        match participation_http_client(&address, target) {
            Ok(client) => tokio::join!(
                fetch_preview_asset(&client, &address, &host, locale, README),
                fetch_preview_asset(&client, &address, &host, locale, README_COVER),
            ),
            Err(_) => (None, None),
        }
    } else {
        (None, None)
    };
    Ok(ClientNodePreview {
        address,
        host,
        readme: readme.and_then(|(_, bytes)| String::from_utf8(bytes).ok()),
        cover: cover.map(|(mime, bytes)| {
            let body = base64::engine::general_purpose::STANDARD.encode(bytes);
            format!("data:{mime};base64,{body}")
        }),
    })
}

struct PreviewAsset {
    path: &'static str,
    media_types: &'static [&'static str],
    limit: usize,
}

const README: PreviewAsset = PreviewAsset {
    path: "/__pnds/participation/readme",
    media_types: &["text/markdown"],
    limit: 512 * 1024,
};
const README_COVER: PreviewAsset = PreviewAsset {
    path: "/__pnds/participation/readme-cover",
    media_types: &["image/png", "image/jpeg", "image/webp"],
    limit: 4 * 1024 * 1024,
};

async fn fetch_preview_asset(
    client: &reqwest::Client,
    address: &str,
    host: &ClientHostInfo,
    locale: &str,
    asset: PreviewAsset,
) -> Option<(&'static str, Vec<u8>)> {
    let performance = host.performance.as_ref()?;
    let mut response = client
        .get(format!("{}{}", address.trim_end_matches('/'), asset.path))
        .header("x-pnds-host-id", &host.host_id)
        .header("x-pnds-project-id", &performance.project_id)
        .header("x-pnds-performance-id", &performance.performance_id)
        .header(reqwest::header::ACCEPT_LANGUAGE, locale)
        .send()
        .await
        .ok()?;
    if response.status() != reqwest::StatusCode::OK {
        return None;
    }
    let media_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)?
        .to_str()
        .ok()?
        .split(';')
        .next()?;
    let media_type = asset
        .media_types
        .iter()
        .copied()
        .find(|value| *value == media_type)?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if bytes.len() + chunk.len() > asset.limit {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    Some((media_type, bytes))
}

/// The Host probes the same metadata contract that a remote Client inspects.
/// Diagnostics describe the failure without returning untrusted response data.
pub(crate) fn parse_host_metadata(bytes: &[u8]) -> Result<ClientHostInfo, String> {
    if bytes.len() > METADATA_LIMIT {
        return Err(format!(
            "participation.errors.metadataTooLarge: GET {METADATA_PATH} exceeded {METADATA_LIMIT} bytes"
        ));
    }
    let metadata: serde_json::Value = serde_json::from_slice(bytes).map_err(|error| {
        let category = error.classify();
        let line = error.line();
        let column = error.column();
        format!("participation.errors.invalidMetadata: GET {METADATA_PATH} returned invalid JSON ({category:?}, line {line}, column {column})")
    })?;
    let version = metadata
        .get("protocolVersion")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| {
            "participation.errors.invalidMetadata: protocolVersion must be an unsigned integer"
                .to_string()
        })?;
    if version != 1 {
        return Err(format!(
            "participation.errors.incompatible: Host protocolVersion {version}; Client supports protocolVersion 1"
        ));
    }
    let host: ClientHostInfo = serde_json::from_value(metadata).map_err(|_| {
        "participation.errors.invalidMetadata: participation fields do not match the protocolVersion 1 schema"
            .to_string()
    })?;
    let validate = |field: &str, value: &str| {
        if value.trim().is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
            Err(format!(
                "participation.errors.invalidMetadata: {field} must be nonblank, at most 256 UTF-8 bytes and contain no control characters"
            ))
        } else {
            Ok(())
        }
    };
    validate("hostId", &host.host_id)?;
    validate("nodeName", &host.node_name)?;
    if let Some(performance) = &host.performance {
        validate("performance.projectId", &performance.project_id)?;
        validate("performance.performanceId", &performance.performance_id)?;
        validate("performance.projectName", &performance.project_name)?;
    }
    Ok(host)
}

/// Only the running project's declared listeners can be addressed through a
/// local page's PAC proxy. Older monitors use hostname + performerPort for
/// scripts and Socket.IO; preserve those URLs without opening a general proxy.
#[derive(Clone)]
struct LocalPageRoutes {
    hostname: String,
    routes: BTreeMap<u16, SocketAddr>,
}
impl LocalPageRoutes {
    fn target(&self, uri: &hyper::Uri) -> Option<SocketAddr> {
        if !matches!(uri.scheme_str(), Some("http" | "ws")) || uri.host() != Some(&self.hostname) {
            return None;
        }
        self.routes.get(&uri.port_u16().unwrap_or(80)).copied()
    }
    fn http_sources(&self) -> String {
        self.routes
            .keys()
            .map(|port| format!(" http://{}:{port}", self.hostname))
            .collect()
    }
    fn socket_sources(&self) -> String {
        self.routes
            .keys()
            .map(|port| format!(" ws://{}:{port}", self.hostname))
            .collect()
    }
}

pub(crate) struct ClientProxy {
    pub(crate) address: SocketAddr,
    pub(crate) hostname: String,
    pub(crate) origin_port: u16,
    shutdown: tokio::sync::watch::Sender<bool>,
    admission: tokio::sync::watch::Sender<bool>,
    thread: Option<std::thread::JoinHandle<()>>,
    done: std::sync::mpsc::Receiver<()>,
}
impl ClientProxy {
    fn start(data_dir: &Path, target: SocketAddr, host: &ClientHostInfo) -> Result<Self, String> {
        let performance = host
            .performance
            .as_ref()
            .ok_or("participation.errors.ended")?;
        if !performance.supports_performer_url {
            return Err("participation.errors.adaptation".into());
        }
        let key = format!("{}\n{}", host.host_id, performance.project_id);
        let headers = vec![
            ("x-pnds-host-id", host.host_id.clone()),
            ("x-pnds-project-id", performance.project_id.clone()),
            ("x-pnds-performance-id", performance.performance_id.clone()),
        ];
        Self::start_forwarding(data_dir, target, &key, headers, None)
    }

    /// App-owned local pages use the same first-party forwarding mechanism,
    /// without authorizing a remote participation source or merging identities.
    pub(crate) fn start_local(
        data_dir: &Path,
        target: SocketAddr,
        key: &str,
        listeners: &[SocketAddr],
    ) -> Result<Self, String> {
        if !target.ip().is_loopback()
            || listeners
                .iter()
                .any(|listener| !listener.ip().is_loopback())
        {
            return Err("A local project page requires a loopback upstream".into());
        }
        Self::start_forwarding(data_dir, target, key, Vec::new(), Some(listeners.to_vec()))
    }

    fn start_forwarding(
        data_dir: &Path,
        target: SocketAddr,
        key: &str,
        headers: Vec<(&'static str, String)>,
        local_listeners: Option<Vec<SocketAddr>>,
    ) -> Result<Self, String> {
        use sha2::{Digest, Sha256};
        let digest = format!("{:x}", Sha256::digest(key.as_bytes()));
        let hostname = format!("pnds-{}.localhost", &digest[..32]);
        let excluded = local_listeners
            .as_ref()
            .map(|listeners| listeners.iter().map(SocketAddr::port).collect::<Vec<_>>())
            .unwrap_or_default();
        let (listener, origin_port) = if local_listeners.is_some() {
            bind_origin_excluding(data_dir, key, &excluded)?
        } else {
            bind_origin(data_dir, key)?
        };
        listener
            .set_nonblocking(true)
            .map_err(|error| error.to_string())?;
        let address = listener.local_addr().map_err(|error| error.to_string())?;
        let proxy_origin = format!("http://{hostname}:{origin_port}");
        let websocket_origin = format!("ws://{hostname}:{origin_port}");
        let routes = local_listeners.map(|listeners| {
            let mut routes = listeners
                .into_iter()
                .map(|listener| (listener.port(), listener))
                .collect::<BTreeMap<_, _>>();
            routes.insert(origin_port, target);
            LocalPageRoutes {
                hostname: hostname.clone(),
                routes,
            }
        });
        let alias_http = routes
            .as_ref()
            .map(LocalPageRoutes::http_sources)
            .unwrap_or_default();
        let alias_sockets = routes
            .as_ref()
            .map(LocalPageRoutes::socket_sources)
            .unwrap_or_default();
        let policy=format!("default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:{alias_http}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' {websocket_origin}{alias_http}{alias_sockets}; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|error| format!("participation.errors.networkRuntime: {error}"))?;
        let listener = {
            let entered = runtime.enter();
            let converted = tokio::net::TcpListener::from_std(listener);
            drop(entered);
            match converted {
                Ok(listener) => listener,
                Err(error) => {
                    runtime.shutdown_background();
                    return Err(format!("participation.errors.networkRuntime: {error}"));
                }
            }
        };
        // Keep failure cleanup outside an async Runtime drop. The spawned
        // thread takes the already verified runtime before serving requests.
        let runtime = Arc::new(Mutex::new(Some(runtime)));
        let thread_runtime = runtime.clone();
        let (shutdown, mut stop) = tokio::sync::watch::channel(false);
        let (admission, admitted) = tokio::sync::watch::channel(true);
        let (done_tx, done) = std::sync::mpsc::channel();
        let thread = std::thread::Builder::new().name("pnds-client-origin".into()).spawn(move || {
            let runtime=thread_runtime.lock().unwrap().take().expect("one thread owns the prepared Client runtime");
            runtime.block_on(async move {
                let client: Client<HttpConnector, hyper::body::Incoming> = Client::builder(TokioExecutor::new()).build_http();
                let capacity = Arc::new(tokio::sync::Semaphore::new(64));
                loop {
                    let accepted = tokio::select! { _ = stop.changed() => break, accepted = listener.accept() => accepted };
                    let Ok((stream, _)) = accepted else { break };
                    let Ok(permit) = capacity.clone().try_acquire_owned() else { continue };
                    let client = client.clone();
                    let headers = headers.clone();
                    let proxy_origin=proxy_origin.clone();
                    let routes=routes.clone();
                    let policy=policy.clone();
                    let mut connection_stop = stop.clone();
                    let mut connection_admission = admitted.clone();
                    connection_admission.borrow_and_update();
                    let request_admission = admitted.clone();
                    let permit_slot = Arc::new(Mutex::new(Some(permit)));
                    tokio::spawn(async move {
                        let service = service_fn(move |mut request: hyper::Request<hyper::body::Incoming>| {
                            for (name, value) in &headers {
                                request.headers_mut().insert(hyper::header::HeaderName::from_static(name), value.parse().expect("validated identity header"));
                            }
                            let proxy_origin=proxy_origin.clone();
                            let routes=routes.clone();
                            let policy=policy.clone();
                            let client=client.clone();
                            let permit_slot=permit_slot.clone();
                            let mut request_admission=request_admission.clone();
                            async move {
                                let admitted = *request_admission.borrow_and_update();
                                if !admitted {
                                    return Ok(crate::gateway::error_body(hyper::StatusCode::GONE, "participationNetworkSuspended"));
                                }
                                let target = match &routes {
                                    Some(routes) => match routes.target(request.uri()) {
                                        Some(target) => target,
                                        None => return Ok(crate::gateway::error_body(hyper::StatusCode::FORBIDDEN, "unmanagedProjectSource")),
                                    },
                                    None => target,
                                };
                                let origin=routes.as_ref().map(|routes|format!("http://{}:{}",routes.hostname,request.uri().port_u16().unwrap_or(80))).unwrap_or(proxy_origin);
                                let mut response=crate::gateway::proxy_with_cancellation(request,client,target,permit_slot,Some(request_admission)).await?;
                                let redirected_outside=response.headers().get(hyper::header::LOCATION).and_then(|value|value.to_str().ok()).is_some_and(|location| {
                                    reqwest::Url::parse(&origin).and_then(|base|base.join(location)).map_or(true,|url|url.origin().ascii_serialization()!=origin)
                                });
                                if redirected_outside {
                                    *response.status_mut()=hyper::StatusCode::BAD_GATEWAY;
                                    response.headers_mut().remove(hyper::header::LOCATION);
                                }
                                response.headers_mut().insert(hyper::header::CONTENT_SECURITY_POLICY,policy.parse().expect("static Client policy"));
                                Ok::<_,std::convert::Infallible>(response)
                            }
                        });
                        let connection = hyper::server::conn::http1::Builder::new().serve_connection(TokioIo::new(stream), service).with_upgrades();
                        tokio::select! { _ = connection_stop.changed() => {}, _ = connection_admission.changed() => {}, result = connection => { if let Err(error)=result { log::warn!("Client origin connection failed: {error}"); } } }
                    });
                }
            });
            runtime.shutdown_timeout(Duration::from_secs(2));
            let _=done_tx.send(());
        });
        let thread = match thread {
            Ok(thread) => thread,
            Err(error) => {
                if let Some(runtime) = runtime.lock().unwrap().take() {
                    runtime.shutdown_background();
                }
                return Err(format!("participation.errors.networkRuntime: {error}"));
            }
        };
        Ok(Self {
            address,
            hostname,
            origin_port,
            shutdown,
            admission,
            thread: Some(thread),
            done,
        })
    }
    fn set_admission(&self, admitted: bool) {
        self.admission.send_if_modified(|current| {
            if *current == admitted {
                return false;
            }
            *current = admitted;
            true
        });
    }
    pub(crate) fn shutdown(&mut self) -> Result<(), String> {
        let _ = self.shutdown.send(true);
        if self.thread.is_none() {
            return Ok(());
        }
        match self.done.recv_timeout(Duration::from_secs(5)) {
            Ok(()) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                if let Some(thread) = self.thread.take() {
                    let _ = thread.join();
                }
                Ok(())
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                Err("participation.errors.cleanupFailed".into())
            }
        }
    }
}
impl Drop for ClientProxy {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}
fn bind_origin(data_dir: &Path, key: &str) -> Result<(TcpListener, u16), String> {
    bind_origin_excluding(data_dir, key, &[])
}

fn bind_origin_excluding(
    data_dir: &Path,
    key: &str,
    excluded: &[u16],
) -> Result<(TcpListener, u16), String> {
    std::fs::create_dir_all(data_dir)
        .map_err(|error| format!("participation.errors.originStorage: {error}"))?;
    let path: PathBuf = data_dir.join("client-origins.json");
    let mut origins: BTreeMap<String, u16> = if path.exists() {
        serde_json::from_slice(
            &std::fs::read(&path)
                .map_err(|error| format!("participation.errors.originStorage: {error}"))?,
        )
        .map_err(|error| format!("participation.errors.invalidOrigins: {error}"))?
    } else {
        BTreeMap::new()
    };
    if origins.len() > 1024 || origins.values().any(|port| *port < 1024) {
        return Err("participation.errors.invalidOrigins".into());
    }
    if let Some(port) = origins.get(key).filter(|port| !excluded.contains(port)) {
        let listener = crate::project::ports::bind_available_listener(Ipv4Addr::LOCALHOST, *port)
            .map_err(|error| {
            format!("participation.errors.originUnavailable: port {port}: {error}")
        })?;
        return Ok((listener, *port));
    }
    // A newly configured runtime listener may reuse a retired local origin's
    // number. Its alias must stay distinct from the document origin. Client
    // origins pass no exclusions and retain their existing durability rule.
    origins.remove(key);
    if origins.len() >= 1024 {
        return Err("participation.errors.originLimit".into());
    }
    let mut allocated = None;
    for _ in 0..128 {
        let candidate = crate::project::ports::bind_available_listener(Ipv4Addr::LOCALHOST, 0)
            .map_err(|error| format!("participation.errors.originStorage: {error}"))?;
        if !excluded.contains(&candidate.local_addr().unwrap().port())
            && !origins
                .values()
                .any(|port| *port == candidate.local_addr().unwrap().port())
        {
            allocated = Some(candidate);
            break;
        }
    }
    let listener =
        allocated.ok_or("participation.errors.originUnavailable: bounded allocation exhausted")?;
    origins.insert(
        key.into(),
        listener
            .local_addr()
            .map_err(|error| format!("participation.errors.originStorage: {error}"))?
            .port(),
    );
    let mut temporary = tempfile::NamedTempFile::new_in(data_dir)
        .map_err(|error| format!("participation.errors.originStorage: {error}"))?;
    use std::io::Write;
    temporary
        .write_all(
            &serde_json::to_vec(&origins)
                .map_err(|error| format!("participation.errors.originStorage: {error}"))?,
        )
        .map_err(|error| format!("participation.errors.originStorage: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("participation.errors.originStorage: {error}"))?;
    temporary
        .persist(&path)
        .map_err(|error| format!("participation.errors.originStorage: {error}"))?;
    std::fs::File::open(data_dir)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("participation.errors.originStorage: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("participation.errors.originStorage: {error}"))?
        .port();
    Ok((listener, port))
}

#[cfg(test)]
mod local_pages;

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    fn assert_listener_released(address: SocketAddr, reason: &str) {
        // Proxy cleanup has completed. Wait only for the observed global fork
        // copies to close; a persistent leaked listener still fails the bound.
        crate::project::children::with_managed_child_pids(|_| {
            crate::test_support::wait_for_tcp_listener_release(address)
                .unwrap_or_else(|error| panic!("{reason}: {address}: {error}"));
        });
    }

    #[tokio::test]
    async fn native_score_requests_reject_old_bounds_and_previous_join_context() {
        use tauri::Manager as _;
        let host = HostFixture::new();
        let data = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        app.manage(ClientCoordinator::default());
        app.manage(crate::client_score_view::ClientScoreView::default());
        let client = app.state::<ClientCoordinator>();
        client
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        let first = client.join(data.path()).await.unwrap().page_url.unwrap();
        let rect = crate::client_score_view::ClientScoreBounds {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 80.0,
            viewport_width: 100.0,
            viewport_height: 100.0,
            sidebar: None,
            toast: None,
        };
        let sequence = 1_800_000_000_000_000.0;
        crate::client_score_view::sync(app.handle().clone(), first.clone(), sequence, None)
            .await
            .unwrap();
        // There is deliberately no main window: an accepted visible update
        // fails visibly, while an older update must never attempt creation.
        crate::client_score_view::sync(
            app.handle().clone(),
            first.clone(),
            sequence - 1.0,
            Some(rect),
        )
        .await
        .unwrap();
        assert_eq!(
            crate::client_score_view::sync(
                app.handle().clone(),
                first.clone(),
                sequence + 1.0,
                Some(rect)
            )
            .await
            .unwrap_err()
            .code,
            "participation.errors.scoreView"
        );
        let refreshed = client.refresh(data.path()).await.unwrap().page_url.unwrap();
        assert_ne!(refreshed, first);
        crate::client_score_view::sync(app.handle().clone(), refreshed.clone(), 1.0, None)
            .await
            .unwrap();
        crate::client_score_view::sync(
            app.handle().clone(),
            first,
            9_007_199_254_740_991.0,
            Some(rect),
        )
        .await
        .unwrap();
        assert_eq!(
            crate::client_score_view::sync(app.handle().clone(), refreshed, 2.0, Some(rect))
                .await
                .unwrap_err()
                .code,
            "participation.errors.scoreView"
        );
        assert!(app.get_webview_window("main").is_none());
        assert_eq!(client.leave().phase, ClientPhase::Idle);
    }

    #[tokio::test]
    async fn native_score_storage_failure_releases_network_and_keeps_cleanup_retry() {
        let host = HostFixture::new();
        let data = tempfile::tempdir().unwrap();
        let client = ClientCoordinator::default();
        client
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        let opened = client.join(data.path()).await.unwrap();
        let address = client.view_target().unwrap().proxy_address;
        let mut url = reqwest::Url::parse(opened.page_url.as_ref().unwrap()).unwrap();
        url.set_path("/socket.io/");
        url.set_query(Some("EIO=4&transport=websocket"));
        let mut websocket = std::net::TcpStream::connect(address).unwrap();
        websocket.set_read_timeout(Some(TIMEOUT)).unwrap();
        write!(websocket, "GET {url} HTTP/1.1\r\nHost: {}:{}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n", url.host_str().unwrap(), url.port().unwrap()).unwrap();
        let mut headers = vec![];
        while !headers.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            websocket.read_exact(&mut byte).unwrap();
            headers.push(byte[0]);
        }
        assert!(String::from_utf8_lossy(&headers).starts_with("HTTP/1.1 101"));
        websocket.write_all(b"ping").unwrap();
        let mut echo = [0; 4];
        websocket.read_exact(&mut echo).unwrap();
        assert_eq!(&echo, b"ping");
        client.set_view_cleanup(Arc::new(|| Err("fixture store flush failed".into())));
        assert_eq!(client.leave().phase, ClientPhase::CleanupFailed);
        assert!(client.busy());
        assert_listener_released(
            address,
            "old native proxy listener survived completed cleanup",
        );
        match websocket.read(&mut [0]) {
            Ok(0) => {}
            Err(cause)
                if matches!(
                    cause.kind(),
                    std::io::ErrorKind::ConnectionReset
                        | std::io::ErrorKind::ConnectionAborted
                        | std::io::ErrorKind::BrokenPipe
                ) => {}
            other => panic!("old upgraded connection survived leave: {other:?}"),
        }
        client.set_view_cleanup(Arc::new(|| Ok(())));
        assert_eq!(client.leave().phase, ClientPhase::Idle);
        assert_listener_released(
            address,
            "old native proxy listener survived completed cleanup",
        );
    }

    #[tokio::test]
    async fn local_host_start_requires_pending_client_participation_to_be_left() {
        use tauri::Manager as _;
        let remote = HostFixture::new();
        let data = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        crate::events::events_builder().mount_events(&app);
        app.manage(ClientCoordinator::default());
        let client = app.state::<ClientCoordinator>();
        assert_eq!(
            client
                .inspect_guarded(remote.address.clone(), None, || false)
                .await
                .unwrap()
                .phase,
            ClientPhase::Confirm
        );
        let session = crate::project::session::SessionManager::default();
        let request = || {
            crate::project::session::StartRequest::new(
                data.path()
                    .join("missing-project")
                    .to_string_lossy()
                    .into_owned(),
                crate::types::AudioMode::None,
                "192.168.1.2".into(),
                None,
            )
        };
        assert!(session
            .start(app.handle().clone(), data.path().into(), request())
            .is_err());
        assert_eq!(session.snapshot().status, crate::types::SessionStatus::Idle);
        assert_eq!(client.leave().phase, ClientPhase::Idle);
        assert!(session
            .start(app.handle().clone(), data.path().into(), request())
            .is_err());
        assert_eq!(
            session.snapshot().status,
            crate::types::SessionStatus::Error
        );
    }
    pub(super) struct HostFixture {
        pub(super) address: String,
        pub(super) metadata: Arc<Mutex<ClientHostInfo>>,
        pub(super) metadata_response: Arc<Mutex<Option<(u16, String)>>>,
        pub(super) score_response: Arc<Mutex<String>>,
        requests: Arc<Mutex<Vec<String>>>,
        pause: Arc<Mutex<Option<(std::sync::mpsc::Receiver<()>, std::sync::mpsc::Sender<()>)>>>,
        stop: Arc<std::sync::atomic::AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
    }
    impl HostFixture {
        pub(super) fn new() -> Self {
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
            listener.set_nonblocking(true).unwrap();
            let address = format!("http://{}/", listener.local_addr().unwrap());
            let metadata = Arc::new(Mutex::new(ClientHostInfo {
                protocol_version: 1,
                host_id: "host-a".into(),
                node_name: "Stage".into(),
                role: None,
                performance: Some(ClientPerformance {
                    project_id: "copy-a".into(),
                    performance_id: "run-a".into(),
                    project_name: "Score".into(),
                    performer_url: address.clone(),
                    supports_performer_url: true,
                }),
            }));
            let shared = metadata.clone();
            let metadata_response = Arc::new(Mutex::new(None::<(u16, String)>));
            let responding = metadata_response.clone();
            let requests = Arc::new(Mutex::new(Vec::new()));
            let observed = requests.clone();
            let score_response = Arc::new(Mutex::new("score-page".to_string()));
            let score = score_response.clone();
            let pause = Arc::new(Mutex::new(
                None::<(std::sync::mpsc::Receiver<()>, std::sync::mpsc::Sender<()>)>,
            ));
            let pausing = pause.clone();
            let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let stopping = stop.clone();
            let thread = std::thread::spawn(move || {
                let mut upgrades = Vec::new();
                while !stopping.load(std::sync::atomic::Ordering::SeqCst) {
                    let (mut stream, _) = match listener.accept() {
                        Ok(value) => value,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(Duration::from_millis(2));
                            continue;
                        }
                        Err(_) => break,
                    };
                    stream.set_nonblocking(false).unwrap();
                    stream.set_read_timeout(Some(TIMEOUT)).unwrap();
                    let mut bytes = Vec::new();
                    while !bytes.ends_with(b"\r\n\r\n") && bytes.len() < 8192 {
                        let mut byte = [0];
                        if stream.read_exact(&mut byte).is_err() {
                            break;
                        }
                        bytes.push(byte[0]);
                    }
                    let request = String::from_utf8_lossy(&bytes).to_string();
                    if let Some((release, arrived)) = pausing.lock().unwrap().take() {
                        arrived.send(()).unwrap();
                        release.recv_timeout(Duration::from_secs(6)).unwrap();
                    }
                    if request.to_lowercase().contains("upgrade: websocket") {
                        observed.lock().unwrap().push(request);
                        upgrades.push(std::thread::spawn(move || {
                        write!(stream,"HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n").unwrap();
                        let mut payload = [0; 4];
                        let read = stream.read_exact(&mut payload);
                        if read.is_ok() {
                            stream.write_all(&payload).unwrap();
                            let mut end = [0];
                            let _ = stream.read(&mut end);
                        }
                        }));
                        continue;
                    }
                    let (status, body, content_type) =
                        if request.starts_with("GET /__pnds/participation ") {
                            let (status, body) =
                                responding.lock().unwrap().clone().unwrap_or_else(|| {
                                    (
                                        200,
                                        serde_json::to_string(&*shared.lock().unwrap()).unwrap(),
                                    )
                                });
                            (status, body, "application/json")
                        } else if request.starts_with("GET /__pnds/participation/readme ") {
                            observed.lock().unwrap().push(request);
                            (
                                200,
                                "# Score preview".to_string(),
                                "text/markdown; charset=utf-8",
                            )
                        } else if request.starts_with("GET /__pnds/participation/readme-cover ") {
                            observed.lock().unwrap().push(request);
                            (200, "sample image bytes".to_string(), "image/png")
                        } else {
                            observed.lock().unwrap().push(request);
                            (200, score.lock().unwrap().clone(), "text/html")
                        };
                    let _ = write!(
                        stream,
                        "HTTP/1.1 {status} Fixture\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                }
                for upgrade in upgrades {
                    upgrade.join().unwrap();
                }
            });
            Self {
                address,
                metadata,
                metadata_response,
                score_response,
                requests,
                pause,
                stop,
                thread: Some(thread),
            }
        }
    }
    #[tokio::test]
    async fn node_preview_fetches_only_the_named_performances_intro_assets() {
        let host = HostFixture::new();
        host.metadata.lock().unwrap().role = Some(LanNodeRole::Host);
        let preview = preview_client_node(&host.address, Some("host-a"), "zh-CN", None)
            .await
            .unwrap();
        assert_eq!(preview.address, host.address);
        assert_eq!(preview.readme.as_deref(), Some("# Score preview"));
        assert_eq!(
            preview.cover.as_deref(),
            Some("data:image/png;base64,c2FtcGxlIGltYWdlIGJ5dGVz")
        );
        let unchanged = preview_client_node(&host.address, Some("host-a"), "zh-CN", Some("run-a"))
            .await
            .unwrap();
        assert!(unchanged.readme.is_none());
        assert!(unchanged.cover.is_none());
        assert!(
            preview_client_node(&host.address, Some("different-node"), "zh-CN", None)
                .await
                .is_err()
        );
        let requests = host.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        for path in [README.path, README_COVER.path] {
            let request = requests
                .iter()
                .find(|request| request.starts_with(&format!("GET {path} ")))
                .unwrap()
                .to_ascii_lowercase();
            assert!(request.contains("x-pnds-host-id: host-a\r\n"));
            assert!(request.contains("x-pnds-project-id: copy-a\r\n"));
            assert!(request.contains("x-pnds-performance-id: run-a\r\n"));
            assert!(request.contains("accept-language: zh-cn\r\n"));
        }
    }

    #[tokio::test]
    async fn changing_to_a_creation_endpoint_preserves_the_active_endpoint_until_commit() {
        let host = HostFixture::new();
        let creator = HostFixture::new();
        {
            let mut metadata = creator.metadata.lock().unwrap();
            metadata.host_id = "creation-b".into();
            metadata.role = Some(LanNodeRole::Creation);
        }
        let data = tempfile::tempdir().unwrap();
        let client = ClientCoordinator::default();
        let first = host.metadata.lock().unwrap().clone();
        let next = creator.metadata.lock().unwrap().clone();
        client.set_view_prepare(Arc::new(|_| Box::pin(async { Ok(()) })));
        client.set_view_commit(Arc::new(|_| Ok(())));
        let original = client
            .enter_at(data.path(), &host.address, first, || false)
            .await
            .unwrap();
        assert_eq!(original.phase, ClientPhase::Open);
        assert_eq!(original.address.as_deref(), Some(host.address.as_str()));
        let preview = preview_client_node(&creator.address, Some("creation-b"), "en", None)
            .await
            .unwrap();
        assert_eq!(preview.host, next);
        assert_eq!(client.snapshot().page_url, original.page_url);

        client.set_view_prepare(Arc::new(|_| {
            Box::pin(async { Err("test preparation failed".into()) })
        }));
        let failed = client
            .enter_at(data.path(), &creator.address, next.clone(), || false)
            .await
            .unwrap();
        assert!(failed.error.is_some());
        assert_eq!(failed.phase, ClientPhase::Open);
        assert_eq!(failed.address, original.address);
        assert_eq!(failed.active_host, original.active_host);
        assert_eq!(failed.page_url, original.page_url);
        assert_eq!(client.poll().await.host, original.host);

        client.set_view_prepare(Arc::new(|_| Box::pin(async { Ok(()) })));
        let replaced = client
            .enter_at(data.path(), &creator.address, next.clone(), || false)
            .await
            .unwrap();
        assert_eq!(replaced.phase, ClientPhase::Open);
        assert_eq!(replaced.address.as_deref(), Some(creator.address.as_str()));
        assert_eq!(replaced.active_host, Some(next.clone()));
        assert_ne!(replaced.page_url, original.page_url);
        assert_eq!(client.poll().await.host, Some(next));
        assert_eq!(client.leave().phase, ClientPhase::Idle);
    }
    impl HostFixture {
        pub(super) fn pause_next_response(
            &self,
        ) -> (std::sync::mpsc::Sender<()>, std::sync::mpsc::Receiver<()>) {
            let (release_tx, release_rx) = std::sync::mpsc::channel();
            let (arrived_tx, arrived_rx) = std::sync::mpsc::channel();
            *self.pause.lock().unwrap() = Some((release_rx, arrived_tx));
            (release_tx, arrived_rx)
        }
    }
    impl Drop for HostFixture {
        fn drop(&mut self) {
            self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
            self.thread.take().unwrap().join().unwrap();
        }
    }
    #[tokio::test]
    async fn metadata_http_failures_do_not_require_a_host_upgrade() {
        let host = HostFixture::new();
        for (status, expected_code) in [
            (301, "participation.errors.invalidMetadata"),
            (401, "participation.errors.invalidMetadata"),
            (404, "participation.errors.invalidMetadata"),
            (408, "participation.errors.unavailable"),
            (429, "participation.errors.unavailable"),
            (500, "participation.errors.unavailable"),
            (503, "participation.errors.unavailable"),
        ] {
            *host.metadata_response.lock().unwrap() =
                Some((status, "private-response-body".into()));
            let client = ClientCoordinator::default();
            let inspected = client
                .inspect_guarded(host.address.clone(), None, || false)
                .await
                .unwrap();
            assert_eq!(inspected.phase, ClientPhase::Error);
            let error = inspected.error.unwrap();
            assert_eq!(error.code, expected_code, "HTTP {status}");
            let detail = error.detail.unwrap();
            assert!(detail.contains(&format!("HTTP {status}")), "{detail}");
            assert!(detail.contains(METADATA_PATH), "{detail}");
            assert!(!detail.contains("private-response-body"));
            assert!(inspected.page_url.is_none());
            assert!(host.requests.lock().unwrap().is_empty());
        }
    }

    #[tokio::test]
    async fn metadata_reports_invalid_data_separately_from_unsupported_versions() {
        let host = HostFixture::new();
        let valid = serde_json::to_value(&*host.metadata.lock().unwrap()).unwrap();
        let mut missing_field = valid.clone();
        missing_field.as_object_mut().unwrap().remove("nodeName");
        let mut invalid_field = valid.clone();
        invalid_field["hostId"] = serde_json::json!({"private-response-body": "secret"});
        let mut invalid_identity = valid.clone();
        invalid_identity["hostId"] = serde_json::json!("private-response-body\n");
        for (body, expected_code) in [
            (
                "<html>private-response-body</html>".into(),
                "participation.errors.invalidMetadata",
            ),
            ("[]".into(), "participation.errors.invalidMetadata"),
            (
                missing_field.to_string(),
                "participation.errors.invalidMetadata",
            ),
            (
                invalid_field.to_string(),
                "participation.errors.invalidMetadata",
            ),
            (
                invalid_identity.to_string(),
                "participation.errors.invalidMetadata",
            ),
            (
                r#"{"protocolVersion":"private-response-body"}"#.into(),
                "participation.errors.invalidMetadata",
            ),
            (
                r#"{"protocolVersion":2}"#.into(),
                "participation.errors.incompatible",
            ),
            (" ".repeat(65537), "participation.errors.metadataTooLarge"),
        ] {
            *host.metadata_response.lock().unwrap() = Some((200, body));
            let client = ClientCoordinator::default();
            let inspected = client
                .inspect_guarded(host.address.clone(), None, || false)
                .await
                .unwrap();
            assert_eq!(inspected.phase, ClientPhase::Error);
            let error = inspected.error.unwrap();
            assert_eq!(error.code, expected_code);
            let detail = error.detail.unwrap();
            assert!(!detail.contains("private-response-body"), "{detail}");
            if expected_code == "participation.errors.incompatible" {
                assert!(detail.contains("protocolVersion 2"), "{detail}");
            }
            assert!(inspected.page_url.is_none());
            assert!(host.requests.lock().unwrap().is_empty());
        }
    }

    #[tokio::test]
    async fn metadata_service_failure_preserves_open_score_and_recovers_same_context() {
        let host = HostFixture::new();
        let dir = tempfile::tempdir().unwrap();
        let client = ClientCoordinator::default();
        client
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        let opened = client.join(dir.path()).await.unwrap();
        *host.metadata_response.lock().unwrap() = Some((503, "entry unavailable".into()));
        let interrupted = client.poll().await;
        assert_eq!(interrupted.phase, ClientPhase::Disconnected);
        assert_eq!(interrupted.page_url, opened.page_url);
        assert_eq!(
            interrupted.error.unwrap().code,
            "participation.errors.unavailable"
        );
        assert!(client.view_target().is_some());
        *host.metadata_response.lock().unwrap() = None;
        let recovered = client.poll().await;
        assert_eq!(recovered.phase, ClientPhase::Open);
        assert_eq!(recovered.page_url, opened.page_url);
        assert!(recovered.error.is_none());
        client.leave();
    }

    #[tokio::test]
    async fn metadata_invalid_response_preserves_document_and_recovers_same_context() {
        for (body, expected_code) in [
            (
                "<html>wrong service</html>",
                "participation.errors.invalidMetadata",
            ),
            (
                r#"{"protocolVersion":2}"#,
                "participation.errors.incompatible",
            ),
        ] {
            let host = HostFixture::new();
            let dir = tempfile::tempdir().unwrap();
            let client = ClientCoordinator::default();
            client
                .inspect_guarded(host.address.clone(), None, || false)
                .await
                .unwrap();
            let opened = client.join(dir.path()).await.unwrap();
            *host.metadata_response.lock().unwrap() = Some((200, body.into()));
            let failed = client.poll().await;
            assert_eq!(failed.phase, ClientPhase::Error);
            assert_eq!(failed.error.unwrap().code, expected_code);
            assert_eq!(failed.page_url, opened.page_url);
            assert!(client.view_target().is_some());
            *host.metadata_response.lock().unwrap() = None;
            let recovered = client.poll().await;
            assert_eq!(recovered.phase, ClientPhase::Open);
            assert_eq!(recovered.page_url, opened.page_url);
            client.leave();
        }
    }

    #[tokio::test]
    async fn rejected_metadata_closes_old_websocket_but_recovery_keeps_the_page_source() {
        let host = HostFixture::new();
        let dir = tempfile::tempdir().unwrap();
        let client = ClientCoordinator::default();
        client
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        let opened = client.join(dir.path()).await.unwrap();
        let target = client.view_target().unwrap();
        let mut websocket = std::net::TcpStream::connect(target.proxy_address).unwrap();
        websocket.set_read_timeout(Some(TIMEOUT)).unwrap();
        write!(websocket,"GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: fixture\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n").unwrap();
        let mut headers = Vec::new();
        while !headers.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            websocket.read_exact(&mut byte).unwrap();
            headers.push(byte[0]);
        }
        assert!(String::from_utf8_lossy(&headers).starts_with("HTTP/1.1 101"));
        websocket.write_all(b"ping").unwrap();
        let mut echo = [0; 4];
        websocket.read_exact(&mut echo).unwrap();
        assert_eq!(&echo, b"ping");
        *host.metadata_response.lock().unwrap() = Some((200, "invalid metadata".into()));
        let failed = client.poll().await;
        assert_eq!(failed.phase, ClientPhase::Error);
        assert_eq!(failed.page_url, opened.page_url);
        match websocket.read(&mut [0]) {
            Ok(0) => {}
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted
                ) => {}
            other => panic!("old websocket survived metadata rejection: {other:?}"),
        }
        let before = host.requests.lock().unwrap().len();
        assert_eq!(
            reqwest::get(opened.page_url.as_ref().unwrap())
                .await
                .unwrap()
                .status(),
            reqwest::StatusCode::GONE
        );
        assert_eq!(host.requests.lock().unwrap().len(), before);
        *host.metadata_response.lock().unwrap() = None;
        assert_eq!(client.poll().await.phase, ClientPhase::Open);
        assert_eq!(client.view_target().unwrap().page_url, target.page_url);
        assert_eq!(
            reqwest::get(opened.page_url.unwrap())
                .await
                .unwrap()
                .status(),
            reqwest::StatusCode::OK
        );
        client.leave();
    }

    #[tokio::test]
    async fn client_requires_confirmed_context_before_page_access() {
        let host = HostFixture::new();
        let dir = tempfile::tempdir().unwrap();
        let client = ClientCoordinator::default();
        assert!(client.join(dir.path()).await.is_err());
        let inspected = client
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        assert_eq!(inspected.phase, ClientPhase::Confirm);
        assert!(inspected.page_url.is_none());
        assert!(host.requests.lock().unwrap().is_empty());
        let joined = client.join(dir.path()).await.unwrap();
        assert_eq!(joined.phase, ClientPhase::Open);
        let page = reqwest::get(joined.page_url.as_ref().unwrap())
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert_eq!(page, "score-page");
        let request = host.requests.lock().unwrap().last().unwrap().to_lowercase();
        assert!(request.contains("x-pnds-host-id: host-a"));
        assert!(request.contains("x-pnds-project-id: copy-a"));
        assert!(request.contains("x-pnds-performance-id: run-a"));
        client.leave();
        assert!(reqwest::get(joined.page_url.unwrap()).await.is_err());
    }

    #[tokio::test]
    async fn occupied_client_transport_preserves_origin_and_does_not_stop_its_owner() {
        let host = HostFixture::new();
        let dir = tempfile::tempdir().unwrap();
        let first = ClientCoordinator::default();
        first
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        let initial = first.join(dir.path()).await.unwrap();
        let original = reqwest::Url::parse(initial.page_url.as_ref().unwrap()).unwrap();
        first.leave();
        let occupied = TcpListener::bind((Ipv4Addr::LOCALHOST, original.port().unwrap())).unwrap();
        let restarted = ClientCoordinator::default();
        restarted
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        let joined = restarted.join(dir.path()).await.unwrap();
        assert_eq!(joined.phase, ClientPhase::Open, "{joined:?}");
        assert_eq!(
            reqwest::Url::parse(joined.page_url.as_ref().unwrap())
                .unwrap()
                .origin(),
            original.origin()
        );
        let transport = restarted.view_target().unwrap();
        assert_ne!(transport.proxy_address.port(), original.port().unwrap());
        let browser = reqwest::Client::builder()
            .proxy(reqwest::Proxy::all(format!("http://{}", transport.proxy_address)).unwrap())
            .build()
            .unwrap();
        assert_eq!(
            browser
                .get(&transport.page_url)
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap(),
            "score-page"
        );
        assert!(
            TcpListener::bind(occupied.local_addr().unwrap()).is_err(),
            "the unrelated listener still owns its socket"
        );
        restarted.leave();
        assert!(restarted.view_target().is_none());
        assert_listener_released(
            transport.proxy_address,
            "the actual proxy listener survived completed cleanup",
        );
        assert!(TcpListener::bind(occupied.local_addr().unwrap()).is_err());
    }

    #[tokio::test]
    async fn revisions_and_saved_origin_survive_manual_rejoin_and_host_port_changes() {
        let host = HostFixture::new();
        let dir = tempfile::tempdir().unwrap();
        let client = ClientCoordinator::default();
        client
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        let first = client.join(dir.path()).await.unwrap();
        let stopped = client.leave();
        let inspected = client
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        assert!(
            inspected.revision > stopped.revision,
            "new operations must never regress public facts"
        );
        let again = client.join(dir.path()).await.unwrap();
        assert_eq!(
            reqwest::Url::parse(first.page_url.as_ref().unwrap())
                .unwrap()
                .origin(),
            reqwest::Url::parse(again.page_url.as_ref().unwrap())
                .unwrap()
                .origin()
        );
        client.leave();
        let moved = HostFixture::new();
        moved.metadata.lock().unwrap().node_name = "Renamed stage".into();
        moved
            .metadata
            .lock()
            .unwrap()
            .performance
            .as_mut()
            .unwrap()
            .performance_id = "run-after-restart".into();
        let restarted = ClientCoordinator::default();
        restarted
            .inspect_guarded(moved.address.clone(), Some("host-a".into()), || false)
            .await
            .unwrap();
        let restored = restarted.join(dir.path()).await.unwrap();
        assert_eq!(restored.host.as_ref().unwrap().node_name, "Renamed stage");
        let original_origin = reqwest::Url::parse(first.page_url.as_ref().unwrap())
            .unwrap()
            .origin();
        assert_eq!(
            reqwest::Url::parse(restored.page_url.as_ref().unwrap())
                .unwrap()
                .origin(),
            original_origin,
            "changing the remote address and restarting App preserves the local origin"
        );
        assert_eq!(
            reqwest::get(restored.page_url.as_ref().unwrap())
                .await
                .unwrap()
                .text()
                .await
                .unwrap(),
            "score-page"
        );
        restarted.leave();
        moved.metadata.lock().unwrap().host_id = "another-host".into();
        restarted
            .inspect_guarded(moved.address.clone(), Some("host-a".into()), || false)
            .await
            .unwrap();
        let other = restarted.join(dir.path()).await.unwrap();
        assert_ne!(
            reqwest::Url::parse(other.page_url.as_ref().unwrap())
                .unwrap()
                .host_str(),
            reqwest::Url::parse(first.page_url.as_ref().unwrap())
                .unwrap()
                .host_str(),
            "different Host identities isolate cookie hostnames as well as ports"
        );
        restarted.leave();
    }

    #[tokio::test]
    async fn changed_context_is_reconfirmed_before_any_project_request() {
        let host = HostFixture::new();
        let dir = tempfile::tempdir().unwrap();
        let client = ClientCoordinator::default();
        client
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        host.metadata
            .lock()
            .unwrap()
            .performance
            .as_mut()
            .unwrap()
            .performance_id = "run-b".into();
        let changed = client.join(dir.path()).await.unwrap();
        assert_eq!(changed.phase, ClientPhase::Confirm);
        assert!(changed.page_url.is_none());
        assert!(host.requests.lock().unwrap().is_empty());
        client.leave();
    }
    #[tokio::test]
    async fn entering_visible_candidate_preserves_old_page_until_ready_and_rejects_stale_click() {
        let host = HostFixture::new();
        let data = tempfile::tempdir().unwrap();
        let client = ClientCoordinator::default();
        let inspected = client
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        assert!(inspected.active_host.is_none());
        let original = client.join(data.path()).await.unwrap();
        assert_eq!(original.active_host, original.host);
        let old_target = client.view_target().unwrap();
        let mut candidate = original.host.clone().unwrap();
        candidate.performance.as_mut().unwrap().project_id = "copy-b".into();
        candidate.performance.as_mut().unwrap().performance_id = "run-b".into();
        *host.metadata.lock().unwrap() = candidate.clone();
        let discovered = client.poll().await;
        assert_eq!(discovered.host, Some(candidate.clone()));
        assert_eq!(discovered.active_host, original.active_host);
        client.set_view_prepare(Arc::new(|_| {
            Box::pin(async { Err("required resource failed".into()) })
        }));
        let failed = client.enter(data.path(), candidate.clone()).await.unwrap();
        assert_eq!(failed.page_url, original.page_url);
        assert_eq!(failed.active_host, original.active_host);
        assert_eq!(client.view_target().unwrap().epoch, old_target.epoch);
        assert!(failed.error.is_some());
        let mut newer = candidate.clone();
        newer.performance.as_mut().unwrap().performance_id = "run-c".into();
        *host.metadata.lock().unwrap() = newer.clone();
        let stale = client.enter(data.path(), candidate).await.unwrap();
        assert_eq!(stale.page_url, original.page_url);
        assert_eq!(stale.host, Some(newer.clone()));
        assert_eq!(stale.active_host, original.active_host);
        client.set_view_prepare(Arc::new(|_| Box::pin(async { Ok(()) })));
        client.set_view_commit(Arc::new(|_| Ok(())));
        let replaced = client.enter(data.path(), newer).await.unwrap();
        assert_ne!(replaced.page_url, original.page_url);
        assert_eq!(replaced.phase, ClientPhase::Open);
        assert_eq!(replaced.active_host, replaced.host);
        assert_ne!(replaced.active_host, original.active_host);
        assert!(client.leave().active_host.is_none());
    }

    #[tokio::test]
    async fn cancelled_and_changed_candidates_cannot_retire_or_replace_current_document() {
        let host = HostFixture::new();
        let data = tempfile::tempdir().unwrap();
        let client = Arc::new(ClientCoordinator::default());
        client
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        let original = client.join(data.path()).await.unwrap();
        let mut candidate = original.host.clone().unwrap();
        candidate.performance.as_mut().unwrap().performance_id = "run-b".into();
        *host.metadata.lock().unwrap() = candidate.clone();
        client.poll().await;
        let (ready, wait) = tokio::sync::oneshot::channel();
        let wait = Arc::new(Mutex::new(Some(wait)));
        client.set_view_prepare(Arc::new(move |_| {
            let wait = wait.lock().unwrap().take().unwrap();
            Box::pin(async move {
                wait.await.unwrap();
                Ok(())
            })
        }));
        let attempt = client.enter(data.path(), candidate.clone());
        tokio::pin!(attempt);
        tokio::select! { result = &mut attempt => panic!("candidate completed before readiness: {result:?}"), _ = tokio::time::sleep(Duration::from_millis(50)) => {} }
        let staging = client.poll().await;
        assert_eq!(staging.page_url, original.page_url);
        assert_eq!(staging.active_host, original.active_host);
        let cancelled = client.cancel_entry();
        assert_eq!(cancelled.page_url, original.page_url);
        assert_eq!(cancelled.active_host, original.active_host);
        ready.send(()).unwrap();
        let stale = attempt.await.unwrap();
        assert_eq!(stale.page_url, original.page_url);
        assert_eq!(stale.active_host, original.active_host);
        client.set_view_prepare(Arc::new(|_| Box::pin(async { Ok(()) })));
        let changes = host.metadata.clone();
        client.set_view_prepare(Arc::new(move |_| {
            changes
                .lock()
                .unwrap()
                .performance
                .as_mut()
                .unwrap()
                .performance_id = "run-c".into();
            Box::pin(async { Ok(()) })
        }));
        let changed = client.enter(data.path(), candidate).await.unwrap();
        assert_eq!(changed.page_url, original.page_url);
        assert_eq!(
            changed.host.unwrap().performance.unwrap().performance_id,
            "run-c"
        );
        client.leave();
    }

    #[tokio::test]
    async fn native_handoff_is_atomic_and_failed_cleanup_keeps_owners_for_leave_retry() {
        let host = HostFixture::new();
        let data = tempfile::tempdir().unwrap();
        let client = Arc::new(ClientCoordinator::default());
        client
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        let original = client.join(data.path()).await.unwrap();
        let mut candidate = original.host.clone().unwrap();
        candidate.performance.as_mut().unwrap().performance_id = "run-b".into();
        *host.metadata.lock().unwrap() = candidate.clone();
        client.poll().await;
        client.set_view_prepare(Arc::new(|_| Box::pin(async { Ok(()) })));
        let during_commit = client.clone();
        let old_page = original.page_url.clone();
        client.set_view_commit(Arc::new(move |_| {
            // Native callbacks may pump their run loop during a flush. A
            // cancellation at this boundary cannot steal the promoted page.
            assert_eq!(during_commit.cancel_entry().page_url, old_page);
            assert!(during_commit.view_target().is_none());
            Err("owned old store flush incomplete".into())
        }));
        let failed = client.enter(data.path(), candidate).await.unwrap();
        assert_eq!(failed.phase, ClientPhase::CleanupFailed);
        assert_eq!(failed.page_url, original.page_url);
        assert!(
            client.view_target().is_none(),
            "retired documents must not be recreated by late bounds"
        );
        client.set_view_cancel(Arc::new(|_| Err("candidate store flush incomplete".into())));
        assert_eq!(client.leave().phase, ClientPhase::CleanupFailed);
        client.set_view_cancel(Arc::new(|_| Ok(())));
        assert_eq!(client.leave().phase, ClientPhase::Idle);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn leave_owns_all_sources_before_prepared_candidate_cleanup_begins() {
        let host = HostFixture::new();
        let data = tempfile::tempdir().unwrap();
        let client = Arc::new(ClientCoordinator::default());
        client
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        let original = client.join(data.path()).await.unwrap();
        let old_source = client.view_target().unwrap().proxy_address;
        let mut candidate = original.host.unwrap();
        candidate.performance.as_mut().unwrap().performance_id = "run-b".into();
        *host.metadata.lock().unwrap() = candidate.clone();
        client.poll().await;
        let (prepared, preparation_started) = tokio::sync::oneshot::channel();
        let prepared = Arc::new(Mutex::new(Some(prepared)));
        let (finish_preparation, preparation_gate) = tokio::sync::oneshot::channel();
        let preparation_gate = Arc::new(Mutex::new(Some(preparation_gate)));
        client.set_view_prepare(Arc::new(move |target| {
            prepared
                .lock()
                .unwrap()
                .take()
                .unwrap()
                .send(target.proxy_address)
                .unwrap();
            let gate = preparation_gate.lock().unwrap().take().unwrap();
            Box::pin(async move {
                gate.await.unwrap();
                Ok(())
            })
        }));
        let (cleanup_started, cleanup_barrier) = tokio::sync::oneshot::channel();
        let cleanup_started = Mutex::new(Some(cleanup_started));
        let (finish_cleanup, cleanup_gate) = std::sync::mpsc::channel();
        let cleanup_gate = Mutex::new(cleanup_gate);
        client.set_view_cancel(Arc::new(move |_| {
            cleanup_started
                .lock()
                .unwrap()
                .take()
                .unwrap()
                .send(())
                .unwrap();
            cleanup_gate
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(3))
                .unwrap();
            Ok(())
        }));
        let entering_client = client.clone();
        let entering_data = data.path().to_owned();
        let expected = candidate.clone();
        let entering =
            tokio::spawn(async move { entering_client.enter(&entering_data, expected).await });
        let candidate_source = preparation_started.await.unwrap();
        let leaving_client = client.clone();
        let leaving = tokio::task::spawn_blocking(move || leaving_client.leave());
        cleanup_barrier.await.unwrap();
        let during_cleanup = client.snapshot();
        let competing_entry = client.enter(data.path(), candidate).await;
        let duplicate_leave = client.leave();
        finish_cleanup.send(()).unwrap();
        let left = leaving.await.unwrap();
        finish_preparation.send(()).unwrap();
        let late_preparation = entering.await.unwrap().unwrap();
        assert_eq!(
            during_cleanup.phase,
            ClientPhase::Leaving,
            "Leave must claim the whole transaction before native cleanup"
        );
        assert_eq!(duplicate_leave.phase, ClientPhase::Leaving);
        assert!(competing_entry.is_err());
        assert_eq!(left.phase, ClientPhase::Idle);
        assert_eq!(late_preparation.phase, ClientPhase::Idle);
        assert!(!client.busy());
        assert_listener_released(old_source, "old source escaped Leave ownership");
        assert_listener_released(candidate_source, "candidate source escaped Leave ownership");
        client
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        client.set_view_prepare(Arc::new(|_| Box::pin(async { Ok(()) })));
        client.set_view_commit(Arc::new(|_| Ok(())));
        let reentered = client
            .enter(data.path(), client.snapshot().host.unwrap())
            .await
            .unwrap();
        assert_eq!(
            reentered.phase,
            ClientPhase::Open,
            "an idle snapshot must not conceal a pending source"
        );
        client.leave();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn leave_cannot_steal_an_in_flight_native_commit_owner() {
        let host = HostFixture::new();
        let data = tempfile::tempdir().unwrap();
        let client = Arc::new(ClientCoordinator::default());
        client
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        let candidate = client.snapshot().host.unwrap();
        client.set_view_prepare(Arc::new(|_| Box::pin(async { Ok(()) })));
        let (commit_started, commit_barrier) = tokio::sync::oneshot::channel();
        let commit_started = Mutex::new(Some(commit_started));
        let (finish_commit, commit_gate) = std::sync::mpsc::channel();
        let commit_gate = Mutex::new(commit_gate);
        client.set_view_commit(Arc::new(move |target| {
            commit_started
                .lock()
                .unwrap()
                .take()
                .unwrap()
                .send(target.proxy_address)
                .unwrap();
            commit_gate
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(3))
                .unwrap();
            Ok(())
        }));
        let entering_client = client.clone();
        let entering_data = data.path().to_owned();
        let entering =
            tokio::spawn(async move { entering_client.enter(&entering_data, candidate).await });
        let candidate_source = commit_barrier.await.unwrap();
        let deferred_leave = client.leave();
        assert_ne!(deferred_leave.phase, ClientPhase::Idle);
        assert!(client.busy());
        finish_commit.send(()).unwrap();
        assert_eq!(entering.await.unwrap().unwrap().phase, ClientPhase::Open);
        assert_eq!(client.leave().phase, ClientPhase::Idle);
        assert_listener_released(
            candidate_source,
            "committed candidate proxy survived completed Leave",
        );
        assert_eq!(client.snapshot().phase, ClientPhase::Idle);
    }

    #[tokio::test]
    async fn inspected_entry_keeps_discovering_after_rejected_metadata_without_a_page() {
        let host = HostFixture::new();
        let client = ClientCoordinator::default();
        *host.metadata_response.lock().unwrap() = Some((200, "invalid json".into()));
        assert_eq!(
            client
                .inspect_guarded(host.address.clone(), None, || false)
                .await
                .unwrap()
                .phase,
            ClientPhase::Error
        );
        assert!(
            client.busy(),
            "an inspected entry must keep automatic discovery owned after invalid metadata"
        );
        *host.metadata_response.lock().unwrap() = None;
        let recovered = client.poll().await;
        assert_eq!(recovered.phase, ClientPhase::Confirm);
        assert!(recovered.page_url.is_none());
        assert_eq!(recovered.host.unwrap().host_id, "host-a");
        client.leave();
    }

    #[tokio::test]
    async fn verified_stop_keeps_document_and_discovers_later_candidates_without_joining() {
        let host = HostFixture::new();
        let dir = tempfile::tempdir().unwrap();
        let client = ClientCoordinator::default();
        client
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        let opened = client.join(dir.path()).await.unwrap();
        host.metadata.lock().unwrap().performance = None;
        let ended = client.poll().await;
        assert_eq!(ended.phase, ClientPhase::Ended);
        assert_eq!(ended.page_url, opened.page_url);
        assert_eq!(ended.active_host, opened.active_host);
        assert!(client.view_target().is_some());
        assert!(client.busy());
        let mut replacement = opened.host.clone().unwrap();
        let performance = replacement.performance.as_mut().unwrap();
        performance.project_id = "copy-b".into();
        performance.performance_id = "run-b".into();
        performance.project_name = "New score".into();
        *host.metadata.lock().unwrap() = replacement;
        let changed = client.poll().await;
        assert_eq!(changed.phase, ClientPhase::Changed);
        assert_eq!(
            changed.host.unwrap().performance.unwrap().project_name,
            "New score"
        );
        assert_eq!(changed.page_url, opened.page_url);
        assert_eq!(client.poll().await.phase, ClientPhase::Changed);
        // Repeating an old run identity after verified Stop cannot restore its authorization.
        *host.metadata.lock().unwrap() = opened.host.clone().unwrap();
        assert_eq!(client.poll().await.phase, ClientPhase::Changed);
        assert!(client.join(dir.path()).await.is_err());
        let before = host.requests.lock().unwrap().len();
        let response = reqwest::get(opened.page_url.unwrap()).await.unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::GONE);
        assert_eq!(host.requests.lock().unwrap().len(), before);
        client.leave();
    }
    #[tokio::test]
    async fn connection_loss_preserves_the_same_page_and_is_not_a_host_stop() {
        let host = HostFixture::new();
        let dir = tempfile::tempdir().unwrap();
        let client = ClientCoordinator::default();
        client
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        let opened = client.join(dir.path()).await.unwrap();
        drop(host);
        let interrupted = client.poll().await;
        assert_eq!(interrupted.phase, ClientPhase::Disconnected);
        assert_eq!(interrupted.page_url, opened.page_url);
        client.leave();
    }

    #[tokio::test]
    async fn cancellation_owns_a_late_inspection_and_refresh_result() {
        let host = HostFixture::new();
        let dir = tempfile::tempdir().unwrap();
        let client = Arc::new(ClientCoordinator::default());
        let (release, arrived) = host.pause_next_response();
        let pending = {
            let client = client.clone();
            let address = host.address.clone();
            tokio::spawn(async move { client.inspect_guarded(address, None, || false).await })
        };
        tokio::task::spawn_blocking(move || arrived.recv_timeout(TIMEOUT).unwrap())
            .await
            .unwrap();
        assert_eq!(client.leave().phase, ClientPhase::Idle);
        release.send(()).unwrap();
        assert_eq!(pending.await.unwrap().unwrap().phase, ClientPhase::Idle);
        client
            .inspect_guarded(host.address.clone(), None, || false)
            .await
            .unwrap();
        client.join(dir.path()).await.unwrap();
        let (release, arrived) = host.pause_next_response();
        let pending = {
            let client = client.clone();
            let dir = dir.path().to_path_buf();
            tokio::spawn(async move { client.refresh(&dir).await })
        };
        tokio::task::spawn_blocking(move || arrived.recv_timeout(TIMEOUT).unwrap())
            .await
            .unwrap();
        client.leave();
        release.send(()).unwrap();
        let final_state = pending.await.unwrap().unwrap();
        assert_eq!(final_state.phase, ClientPhase::Idle);
        assert!(final_state.page_url.is_none());
    }
    #[tokio::test]
    async fn public_join_traverses_the_real_host_gate_for_http_and_websocket() {
        use crate::participation_host::{HostEntry, HostRun};
        let score = HostFixture::new();
        let host_data = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let client_data = tempfile::tempdir().unwrap();
        let entry = HostEntry::bind(host_data.path(), "Stage", Ipv4Addr::LOCALHOST).unwrap();
        let port = reqwest::Url::parse(&score.address).unwrap().port().unwrap();
        entry
            .begin(HostRun {
                project_root: project.path(),
                project_name: "Score",
                performer_port: port,
                supports_performer_url: true,
                browser_participation: None,
            })
            .unwrap();
        let client = ClientCoordinator::default();
        client
            .inspect_guarded(entry.url(), None, || false)
            .await
            .unwrap();
        let joined = client.join(client_data.path()).await.unwrap();
        let page_url = joined.page_url.unwrap();
        assert_eq!(
            reqwest::get(&page_url).await.unwrap().text().await.unwrap(),
            "score-page"
        );
        let origin = reqwest::Url::parse(&page_url).unwrap();
        let mut websocket =
            std::net::TcpStream::connect((Ipv4Addr::LOCALHOST, origin.port().unwrap())).unwrap();
        websocket.set_read_timeout(Some(TIMEOUT)).unwrap();
        write!(websocket,"GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n").unwrap();
        let mut headers = Vec::new();
        while !headers.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            websocket
                .read_exact(&mut byte)
                .expect("upgraded response headers");
            headers.push(byte[0]);
        }
        assert!(String::from_utf8_lossy(&headers).starts_with("HTTP/1.1 101"));
        websocket.write_all(b"ping").unwrap();
        let mut echo = [0; 4];
        websocket.read_exact(&mut echo).unwrap();
        assert_eq!(&echo, b"ping");
        drop(websocket);
        entry.stop().unwrap();
        assert_eq!(
            reqwest::get(&page_url).await.unwrap().status(),
            reqwest::StatusCode::GONE
        );
        entry
            .begin(HostRun {
                project_root: project.path(),
                project_name: "Score",
                performer_port: port,
                supports_performer_url: true,
                browser_participation: None,
            })
            .unwrap();
        assert_eq!(
            reqwest::get(&page_url).await.unwrap().status(),
            reqwest::StatusCode::CONFLICT
        );
        assert_eq!(client.poll().await.phase, ClientPhase::Changed);
        assert_eq!(
            reqwest::get(&page_url).await.unwrap().status(),
            reqwest::StatusCode::GONE
        );
        client.leave();
    }
}

#[cfg(all(test, target_os = "macos"))]
#[path = "participation_client/native_continuity.rs"]
mod native_continuity;

mod entry;
use entry::PendingEntry;
