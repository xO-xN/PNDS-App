//! The public listener belongs to the online App, independently of a local run.
use super::*;
use crate::lan_discovery::{LanDiscovery, LanIdentity, LanNodeRole, LanRun};
use crate::participation_host::HostEntryProbeError;
use std::net::Ipv4Addr;

const PUBLIC_ENTRY_FAILURE_THRESHOLD: u8 = 3;

pub(super) enum PublicEntryCheck {
    Starting,
    Running { probe_due: bool },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PublicEntryStatus {
    Unbound,
    Waiting,
    Preparing,
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PublicEntrySnapshot {
    pub status: PublicEntryStatus,
    pub url: Option<String>,
    pub error: Option<String>,
    pub port_changed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub browser_participation: Option<u32>,
}

impl SessionInner {
    fn public_entry_snapshot(&self) -> PublicEntrySnapshot {
        let entry = self.participation_host.as_ref();
        let error = self
            .host_entry_error
            .clone()
            .or_else(|| entry.and_then(|entry| entry.failure()))
            .or_else(|| self.client_entry_error.clone());
        let status = if error.is_some() {
            PublicEntryStatus::Error
        } else if let Some(entry) = entry {
            if self.participation_role == Some(LanNodeRole::Host)
                && self.status == SessionStatus::Starting
            {
                PublicEntryStatus::Preparing
            } else if self.participation_role == Some(LanNodeRole::Host)
                && self.status == SessionStatus::Ready
                && entry.info().performance.is_some()
            {
                PublicEntryStatus::Ready
            } else {
                PublicEntryStatus::Waiting
            }
        } else {
            PublicEntryStatus::Unbound
        };
        let performance = entry
            .filter(|_| self.participation_role == Some(LanNodeRole::Host))
            .and_then(|entry| entry.info().performance);
        PublicEntrySnapshot {
            project_name: performance.as_ref().map(|run| run.project_name.clone()),
            browser_participation: performance.and_then(|run| run.browser_participation),
            status,
            url: entry.map(|entry| entry.url()),
            error,
            port_changed: entry.is_some_and(|entry| entry.port_changed()),
        }
    }

    pub(super) fn lan_run(&self) -> LanRun {
        let role = self.participation_role;
        let status = self.status;
        LanRun {
            role: role.filter(|_| matches!(status, SessionStatus::Starting | SessionStatus::Ready)),
            loading: role.is_some() && status == SessionStatus::Starting,
            project_name: self.participation_host.as_ref().and_then(|entry| {
                (status == SessionStatus::Ready
                    && self.client_entry_error.is_none()
                    && entry.failure().is_none())
                .then(|| entry.info().performance.map(|run| run.project_name))
                .flatten()
            }),
        }
    }

    fn prepare_host_entry(&mut self, app_data: &Path, node_name: &str, bind_ip: Ipv4Addr) {
        if self.participation_host.is_some() || node_name.trim().is_empty() {
            return;
        }
        match crate::participation_host::HostEntry::bind(app_data, node_name, bind_ip) {
            Ok(entry) => {
                self.participation_host = Some(Arc::new(entry));
                self.host_entry_error = None;
            }
            Err(error) => self.host_entry_error = Some(error),
        }
    }
}

impl SessionManager {
    /// Capture the current run under its lock, observe HTTP without the lock,
    /// then recheck ownership before revoking anything. The listener's Arc is
    /// reused across runs, so it never substitutes for the generation check.
    pub(super) fn check_public_entry<R: tauri::Runtime>(
        app: &AppHandle<R>,
        inner: &Arc<Mutex<SessionInner>>,
        generation: u64,
        check: PublicEntryCheck,
    ) -> bool {
        let status = match check {
            PublicEntryCheck::Starting => SessionStatus::Starting,
            PublicEntryCheck::Running { .. } => SessionStatus::Ready,
        };
        let (entry, expected_health, admission) = {
            let guard = inner.lock().unwrap_or_else(|error| error.into_inner());
            if guard.generation != generation || guard.status != status {
                return false;
            }
            let Some(role) = guard.participation_role else {
                return true;
            };
            if status == SessionStatus::Ready
                && (guard.client_entry_error.is_some()
                    || guard.applied_score_process.is_none()
                    || guard.health.is_none())
            {
                return true;
            }
            let Some(entry) = guard.participation_host.clone() else {
                return true;
            };
            let admission = match (
                &check,
                &guard.project_path,
                &guard.project_name,
                guard.applied_score_ports,
            ) {
                (PublicEntryCheck::Starting, Some(root), Some(name), Some(ports)) => entry
                    .begin_for_role(
                        crate::participation_host::HostRun {
                            project_root: Path::new(root),
                            project_name: name,
                            performer_port: ports[0],
                            supports_performer_url: guard.supports_client_entry,
                            browser_participation: guard.browser_participation,
                        },
                        role,
                    ),
                _ => Ok(()),
            };
            (entry, guard.health.clone(), admission)
        };
        let result = if let Some(error) = admission.err().or_else(|| entry.failure()) {
            Err(HostEntryProbeError::Fatal(error))
        } else {
            let Some(expected) = expected_health else {
                return true;
            };
            if matches!(check, PublicEntryCheck::Running { probe_due: false }) {
                return true;
            }
            entry.probe().and_then(|actual| {
                if actual == expected {
                    return Ok(());
                }
                let detail = match check {
                    PublicEntryCheck::Starting => {
                        "forwarded health did not match this ready project"
                    }
                    PublicEntryCheck::Running { .. } => {
                        "forwarded health no longer matches this performance"
                    }
                };
                Err(HostEntryProbeError::Fatal(format!(
                    "participation.errors.hostEntryRuntime: {detail}"
                )))
            })
        };
        Self::apply_public_entry_probe(app, inner, generation, status, &entry, result)
    }

    pub(super) fn apply_public_entry_probe<R: tauri::Runtime>(
        app: &AppHandle<R>,
        inner: &Arc<Mutex<SessionInner>>,
        generation: u64,
        status: SessionStatus,
        entry: &Arc<crate::participation_host::HostEntry>,
        result: Result<(), HostEntryProbeError>,
    ) -> bool {
        let mut guard = inner.lock().unwrap_or_else(|poison| poison.into_inner());
        if guard.generation != generation || guard.status != status {
            return false;
        }
        if guard.client_entry_error.is_some()
            || !guard
                .participation_host
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, entry))
        {
            return true;
        }
        let error = match result {
            Ok(()) => {
                if guard.public_entry_probe_failures != 0 {
                    guard.public_entry_probe_failures = 0;
                    log::info!("Public entry probe recovered");
                }
                return true;
            }
            Err(HostEntryProbeError::Transient(error)) if status == SessionStatus::Ready => {
                guard.public_entry_probe_failures += 1;
                let failures = guard.public_entry_probe_failures;
                if failures < PUBLIC_ENTRY_FAILURE_THRESHOLD {
                    log::warn!("Public entry probe failed ({failures}/{PUBLIC_ENTRY_FAILURE_THRESHOLD}): {error}");
                    return true;
                }
                error
            }
            Err(HostEntryProbeError::Transient(error) | HostEntryProbeError::Fatal(error)) => error,
        };
        log::warn!("Public entry suspended: {error}");
        let cleanup = entry.suspend(&error);
        guard.client_entry_error = Some(cleanup.err().unwrap_or(error));
        drop(guard);
        if status == SessionStatus::Ready {
            Self::emit_static(app, inner);
        }
        true
    }

    /// Read-only; inspecting controls never allocates or repairs a listener.
    pub fn public_entry_snapshot(&self) -> PublicEntrySnapshot {
        self.lock().public_entry_snapshot()
    }

    /// Check the held listener before and after encoding; never allocates a listener.
    pub fn public_entry_qr_url(&self, expected_url: &str) -> Result<String, String> {
        let snapshot = self.public_entry_snapshot();
        if matches!(
            snapshot.status,
            PublicEntryStatus::Unbound | PublicEntryStatus::Error
        ) || snapshot.url.as_deref() != Some(expected_url)
        {
            return Err(
                "participation.errors.hostEntryRuntime: public entry changed or unavailable".into(),
            );
        }
        snapshot
            .url
            .ok_or_else(|| "participation.errors.hostEntryRuntime".into())
    }

    /// Node/LAN preparation binds the real entry without starting a runtime or
    /// acquiring the Host/Client activity gate. An existing live address wins.
    pub(crate) fn prepare_host_entry(
        &self,
        app_data: &Path,
        node_name: &str,
        bind_ip: Ipv4Addr,
    ) -> PublicEntrySnapshot {
        let mut inner = self.lock();
        // Configuration edits are next-start preferences. Once published, the
        // actual App-owned listener is never replaced by a panel or role change.
        inner.prepare_host_entry(app_data, node_name, bind_ip);
        inner.public_entry_snapshot()
    }

    pub(crate) fn sync_client_lan(
        &self,
        discovery: &LanDiscovery,
        app_data: &Path,
        node_name: &str,
        role: LanNodeRole,
        selected: Option<Ipv4Addr>,
        interface_for_ip: impl Fn(Ipv4Addr) -> Option<u32>,
    ) -> Result<(), String> {
        let interface_for_entry = |entry: &crate::participation_host::HostEntry| {
            let std::net::IpAddr::V4(ip) = entry.local_addr().ip() else {
                return None;
            };
            interface_for_ip(ip)
        };
        let mut inner = self.lock();
        if let Some(ip) = selected.filter(|ip| interface_for_ip(*ip).is_some()) {
            if inner.status == SessionStatus::Idle
                && inner.participation_host.as_ref().is_some_and(|entry| {
                    Arc::strong_count(entry) == 1 && interface_for_entry(entry).is_none()
                })
            {
                // An address the machine no longer owns cannot preserve its
                // origin. Retry the saved port on the new interface only
                // after the old idle listener has released its socket.
                inner.participation_host = None;
            }
            inner.prepare_host_entry(app_data, node_name, ip);
        }
        let identity = inner
            .participation_host
            .as_ref()
            .and_then(|entry| Some((entry, interface_for_entry(entry)?)));
        let identity = identity
            .filter(|_| !node_name.trim().is_empty())
            .map(|(entry, interface)| {
                entry.set_node_name(node_name)?;
                entry.set_idle_role(role);
                let info = entry.info();
                Ok::<_, String>(LanIdentity {
                    node_id: info.host_id,
                    node_name: info.node_name,
                    role,
                    address: entry.local_addr(),
                    interface,
                })
            })
            .transpose()?;
        discovery.sync(identity, inner.lan_run())
    }
}
