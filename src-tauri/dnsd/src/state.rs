//! #174: the daemon's persisted state — the upstream list and the
//! known-performance-domain set. Written atomically (tmp + rename) after
//! every `config.set` / mapping install, loaded at boot, so an App update
//! or a Mac reboot restores the operator's forwarding configuration and
//! the NXDOMAIN knowledge for retired performance domains.
//!
//! The ACTIVE mapping is deliberately NOT persisted: it belongs to a live
//! App run and dies with it (crash-recovery uses the lease, spec #174).

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DaemonState {
    /// Forwarding upstreams (`ip` or `ip:port`, port defaults to 53).
    #[serde(default)]
    pub upstreams: Vec<String>,
    /// The fixed LAN address the listeners bind (spec #174: 监听操作者
    /// 明确选定的物理地址). `None` = all interfaces; a stale address
    /// (network changed) falls back to all interfaces at boot.
    #[serde(default)]
    pub listen_ip: Option<String>,
    /// Domains ever installed as performance mappings — answered
    /// NXDOMAIN while no performance is active (never forwarded).
    #[serde(default)]
    pub known_domains: Vec<String>,
}

/// Loads the state file; a missing or corrupt file falls back to the
/// default (empty) state — the daemon still boots and the App re-derives
/// everything from `config.set` on its next enable.
pub fn load(path: &Path) -> DaemonState {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|e| {
            log::warn!(
                "state file {} unparseable ({e}); starting from defaults",
                path.display()
            );
            DaemonState::default()
        }),
        Err(_) => DaemonState::default(),
    }
}

/// Saves the state atomically: temp file + rename, so a crash mid-write
/// never leaves a truncated state behind. Serialized process-wide: the
/// housekeeping loop and `config.set` both write this file, and their
/// load-modify-write cycles must not interleave (that interleave is
/// exactly how a known-domains update was lost to a concurrent
/// `config.set` in the field).
pub fn save(path: &Path, state: &DaemonState) -> std::io::Result<()> {
    static SAVE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = SAVE_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(state).expect("daemon state serializes");
    let temp = path.with_extension("tmp");
    std::fs::write(&temp, bytes)?;
    std::fs::rename(&temp, path)
}

/// Mirrors the engine's live state into the persisted record.
pub fn from_engine(engine: &crate::engine::Engine) -> DaemonState {
    DaemonState {
        upstreams: engine.upstreams().iter().map(|a| a.to_string()).collect(),
        known_domains: engine.known_domains(),
        listen_ip: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pnds-dnsd-state-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn round_trips_upstreams_and_known_domains() {
        let dir = scratch();
        let path = dir.join("state.json");
        let state = DaemonState {
            upstreams: vec!["223.5.5.5:53".to_string(), "119.29.29.29".to_string()],
            known_domains: vec!["show.example.org.".to_string()],
            listen_ip: None,
        };
        save(&path, &state).unwrap();
        assert_eq!(load(&path), state);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn missing_file_loads_the_default_state() {
        let dir = scratch();
        let path = dir.join("absent.json");
        assert_eq!(load(&path), DaemonState::default());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn corrupt_file_loads_the_default_state() {
        let dir = scratch();
        let path = dir.join("state.json");
        std::fs::write(&path, b"{not json").unwrap();
        assert_eq!(load(&path), DaemonState::default());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_is_atomic_and_replaces_the_previous_state() {
        let dir = scratch();
        let path = dir.join("state.json");
        save(
            &path,
            &DaemonState {
                upstreams: vec!["1.1.1.1".into()],
                known_domains: vec![],
                listen_ip: None,
            },
        )
        .unwrap();
        save(
            &path,
            &DaemonState {
                upstreams: vec![],
                known_domains: vec!["a.example.org.".into()],
                listen_ip: None,
            },
        )
        .unwrap();
        let loaded = load(&path);
        assert!(loaded.upstreams.is_empty());
        assert_eq!(loaded.known_domains, vec!["a.example.org.".to_string()]);
        // No temp litter survives.
        assert!(!path.with_extension("tmp").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
