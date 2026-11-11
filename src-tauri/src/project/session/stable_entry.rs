//! The public listener belongs to the online App, independently of a local run.
use super::*;
use std::net::Ipv4Addr;

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
            if self.public_performance && self.status == SessionStatus::Starting {
                PublicEntryStatus::Preparing
            } else if self.public_performance
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
        let performance = entry.and_then(|entry| entry.info().performance);
        PublicEntrySnapshot {
            project_name: performance.as_ref().map(|run| run.project_name.clone()),
            browser_participation: performance.and_then(|run| run.browser_participation),
            status,
            url: entry.map(|entry| entry.url()),
            error,
            port_changed: entry.is_some_and(|entry| entry.port_changed()),
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
            if !guard.public_performance
                || (status == SessionStatus::Ready
                    && (guard.client_entry_error.is_some()
                        || guard.applied_score_process.is_none()
                        || guard.health.is_none()))
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
                (PublicEntryCheck::Starting, Some(root), Some(name), Some(ports)) => {
                    entry.begin(crate::participation_host::HostRun {
                        project_root: Path::new(root),
                        project_name: name,
                        performer_port: ports[0],
                        supports_performer_url: guard.supports_client_entry,
                        browser_participation: guard.browser_participation,
                    })
                }
                _ => Ok(()),
            };
            (entry, guard.health.clone(), admission)
        };
        let result = admission.and_then(|()| {
            if let Some(error) = entry.failure() {
                return Err(error);
            }
            if matches!(check, PublicEntryCheck::Running { probe_due: false }) {
                return Ok(());
            }
            let Some(expected) = expected_health else {
                return Ok(());
            };
            let actual = entry.probe()?;
            if actual == expected {
                return Ok(());
            }
            let detail = match check {
                PublicEntryCheck::Starting => "forwarded health did not match this ready project",
                PublicEntryCheck::Running { .. } => {
                    "forwarded health no longer matches this performance"
                }
            };
            Err(format!("participation.errors.hostEntryRuntime: {detail}"))
        });
        match result {
            Ok(()) => true,
            Err(error) => {
                Self::apply_public_entry_failure(app, inner, generation, status, &entry, error)
            }
        }
    }

    pub(super) fn apply_public_entry_failure<R: tauri::Runtime>(
        app: &AppHandle<R>,
        inner: &Arc<Mutex<SessionInner>>,
        generation: u64,
        status: SessionStatus,
        entry: &Arc<crate::participation_host::HostEntry>,
        error: String,
    ) -> bool {
        let mut guard = inner.lock().unwrap_or_else(|poison| poison.into_inner());
        if guard.generation != generation || guard.status != status {
            return false;
        }
        if guard.client_entry_error.is_none()
            && guard
                .participation_host
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, entry))
        {
            let cleanup = entry.suspend(&error);
            guard.client_entry_error = Some(cleanup.err().unwrap_or(error));
            drop(guard);
            if status == SessionStatus::Ready {
                Self::emit_static(app, inner);
            }
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
        if inner.participation_host.is_some() {
            return inner.public_entry_snapshot();
        }
        if node_name.trim().is_empty() {
            return inner.public_entry_snapshot();
        }
        match crate::participation_host::HostEntry::bind(app_data, node_name, bind_ip) {
            Ok(entry) => {
                inner.participation_host = Some(Arc::new(entry));
                inner.host_entry_error = None;
            }
            Err(error) => inner.host_entry_error = Some(error),
        }
        inner.public_entry_snapshot()
    }
}
