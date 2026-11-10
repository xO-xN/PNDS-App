//! The public listener belongs to the online App, independently of a local run.
use super::*;
use std::net::Ipv4Addr;

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
