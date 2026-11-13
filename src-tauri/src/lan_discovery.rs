//! App-owned DNS-SD directory. Announcements are hints for explicit native
//! inspection; the participation endpoint still verifies every selected run.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::net::SocketAddr;
use std::sync::{mpsc, Arc, Mutex};

#[cfg(target_os = "macos")]
mod bonjour;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum LanNodeRole {
    Host,
    Client,
    Creation,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ClientLanNode {
    pub node_id: String,
    pub node_name: String,
    pub role: LanNodeRole,
    pub address: Option<String>,
    pub project_name: Option<String>,
    pub loading: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct LanIdentity {
    pub node_id: String,
    pub node_name: String,
    pub role: LanNodeRole,
    pub address: SocketAddr,
    pub interface: u32,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct LanRun {
    pub role: Option<LanNodeRole>,
    pub project_name: Option<String>,
    pub loading: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Announcement {
    identity: LanIdentity,
    run: LanRun,
}

#[derive(Default)]
struct State {
    announcement: Option<Announcement>,
    local_node_id: Option<String>,
    sender: Option<mpsc::Sender<Option<Announcement>>>,
}

#[derive(Default)]
pub struct LanDiscovery {
    state: Mutex<State>,
    nodes: Arc<Mutex<Vec<ClientLanNode>>>,
}

impl LanDiscovery {
    pub(crate) fn sync(&self, identity: Option<LanIdentity>, run: LanRun) -> Result<(), String> {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let announcement = identity.map(|identity| Announcement { identity, run });
        if state.sender.is_none() {
            let (sender, receiver) = mpsc::channel();
            let nodes = self.nodes.clone();
            std::thread::Builder::new()
                .name("pnds-lan-discovery".into())
                .spawn(move || browse(receiver, nodes))
                .map_err(|error| format!("participation.errors.lanDiscovery: {error}"))?;
            state.sender = Some(sender);
        }
        if let Some(local) = &announcement {
            state.local_node_id = Some(local.identity.node_id.clone());
        }
        state.publish(announcement);
        Ok(())
    }

    pub(crate) fn update_run(&self, run: LanRun) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(current) = &state.announcement {
            let announcement = Announcement {
                identity: current.identity.clone(),
                run,
            };
            state.publish(Some(announcement));
        }
    }

    pub(crate) fn nodes(&self) -> Vec<ClientLanNode> {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        self.nodes
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .iter()
            .filter(|node| state.local_node_id.as_ref() != Some(&node.node_id))
            .cloned()
            .collect()
    }
}

impl State {
    fn publish(&mut self, announcement: Option<Announcement>) {
        if self.announcement == announcement {
            return;
        }
        if let Some(sender) = &self.sender {
            let _ = sender.send(announcement.clone());
        }
        self.announcement = announcement;
    }
}

#[cfg(target_os = "macos")]
use bonjour::browse;

#[cfg(not(target_os = "macos"))]
fn browse(receiver: mpsc::Receiver<Option<Announcement>>, _: Arc<Mutex<Vec<ClientLanNode>>>) {
    while receiver.recv().is_ok() {}
}
