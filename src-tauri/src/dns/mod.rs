//! #174: the App-side DNS service seam — everything the App does with the
//! background LAN-DNS LaunchDaemon (enable / disable / status, session
//! mapping lifecycle) goes through this module and never spawns a shell.
//!
//! Layers: [`client`] speaks the line-JSON control protocol to the
//! daemon's Unix socket; [`service`] wraps SMAppService (registration,
//! macOS 13+); this file orchestrates both plus the App-run identity the
//! daemon's holder rules key on.

pub mod client;
mod mapping;
pub(crate) use mapping::MappingLease;
#[cfg(target_os = "macos")]
pub mod service;
#[cfg(test)]
pub(crate) mod test_support;

use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::OnceLock;
use std::time::Duration;

/// Parses one upstream entry: an IPv4 literal, optionally `:port`
/// (defaults to 53). Hostnames are refused — resolving one at daemon
/// runtime would loop through this daemon itself. Single authority for
/// the preference save boundary (`types.rs`), the enable command
/// (`commands/dns.rs`) and the daemon's own reload path.
pub fn parse_upstream_entry(text: &str) -> Option<String> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let (host, port) = match text.rsplit_once(':') {
        Some((host, port)) => (host, port.parse::<u16>().ok()?),
        None => (text, 53u16),
    };
    // IPv4 only (spec §4 scope): the venue LAN and the mapping address
    // are IPv4; `Ipv4Addr::parse` also rejects an IPv6 tail.
    host.parse::<std::net::Ipv4Addr>().ok()?;
    Some(if port == 53 {
        host.to_string()
    } else {
        format!("{host}:{port}")
    })
}

/// The plist the bundler places at `Contents/Library/LaunchDaemons/`.
pub const DAEMON_PLIST_NAME: &str = "com.xo-xn.pnds-app.dnsd.plist";
/// Default forwarding upstreams (IP literals, port 53 implied). Public
/// resolvers — the router itself is deliberately NOT a default: once
/// DHCP points at this Mac, the router would forward queries straight
/// back here (the loop the spec forbids, #174).
pub const DEFAULT_UPSTREAMS: [&str; 2] = ["223.5.5.5", "119.29.29.29"];
/// How long `enable` waits for the daemon's control plane to answer
/// after SMAppService reports the registration.
const DAEMON_READINESS_TIMEOUT: Duration = Duration::from_secs(10);
/// The mapping lease the App installs and refreshes (≈1/5 of the
/// daemon's maximum): a crashed App stops renewing and the mapping dies
/// within minutes (lease + one miss), never blocking a later start.
pub const MAPPING_LEASE: Duration = Duration::from_secs(60);

/// The App-run identity daemon-side holder rules key on: a stale
/// generation of an older run can neither refresh nor clear the mapping
/// a newer run installed (the daemon accepts cross-run takeovers — the
/// single-instance App means a different run is a restart).
pub fn run_id() -> &'static str {
    static RUN_ID: OnceLock<String> = OnceLock::new();
    RUN_ID.get_or_init(|| {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        format!("app-{}-{nanos}", std::process::id())
    })
}

/// Registration facts from SMAppService (macOS 13+).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum DnsRegistrationStatus {
    /// Not registered — the daemon is neither enabled nor pending.
    NotRegistered,
    /// Registered and approved — the daemon runs (and returns on boot).
    Enabled,
    /// Registered but awaiting the system's approval (the approval
    /// dialog was dismissed; System Settings → Login Items is the fix).
    RequiresApproval,
    /// Registered but the bundle has moved or been removed since.
    NotFound,
}

/// Control-plane listener liveness as reported by the daemon.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DnsListeners {
    pub udp: bool,
    pub tcp: bool,
}

/// The performance mapping facts the daemon currently holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DnsMappingFacts {
    pub domain: String,
    pub ip: String,
    pub run_id: String,
    /// u32, not u64: specta's TS export forbids BigInt, and neither the
    /// session generation nor a lease outlives 2^32.
    pub generation: u32,
    pub lease_seconds_remaining: u32,
}

/// The full status surface the settings section renders.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DnsServiceStatus {
    pub registration: DnsRegistrationStatus,
    /// The control plane answered — the daemon process is up and serving.
    pub daemon: bool,
    /// The bundle ships the LaunchDaemon plist (false in dev builds —
    /// enabling requires the installed, bundled App).
    pub plist_present: bool,
    pub listeners: Option<DnsListeners>,
    pub bind_error: Option<String>,
    pub upstreams: Vec<String>,
    pub mapping: Option<DnsMappingFacts>,
    pub known_domains: Vec<String>,
    pub stats: Option<serde_json::Value>,
}

/// Asks the daemon for its status; `daemon: false` (not an error) when
/// the control socket does not answer — the daemon being down is a
/// status fact, not a command failure.
pub fn daemon_status() -> DnsServiceStatus {
    let registration = service::registration_status();
    let plist_present = service::plist_path().is_some();
    let status = client::request("status", serde_json::json!({}), Duration::from_secs(2)).ok();
    let listeners = status
        .as_ref()
        .and_then(|s| s.get("listeners"))
        .map(|l| DnsListeners {
            udp: l
                .get("udp")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false),
            tcp: l
                .get("tcp")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false),
        });
    let bind_error = status
        .as_ref()
        .and_then(|s| s.get("bindError"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let mapping = status
        .as_ref()
        .and_then(|s| s.get("mapping"))
        .and_then(|m| {
            Some(DnsMappingFacts {
                domain: m.get("domain")?.as_str()?.to_string(),
                ip: m.get("ip")?.as_str()?.to_string(),
                run_id: m.get("runId")?.as_str()?.to_string(),
                generation: m.get("generation")?.as_u64()? as u32,
                lease_seconds_remaining: m.get("leaseSecondsRemaining")?.as_u64()? as u32,
            })
        });
    DnsServiceStatus {
        registration,
        daemon: status.is_some(),
        plist_present,
        listeners,
        bind_error,
        upstreams: status
            .as_ref()
            .and_then(|s| s.get("upstreams"))
            .and_then(serde_json::Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        mapping,
        known_domains: status
            .as_ref()
            .and_then(|s| s.get("knownDomains"))
            .and_then(serde_json::Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        stats: status.as_ref().and_then(|s| s.get("stats")).cloned(),
    }
}

/// Enables the background DNS service: registers the LaunchDaemon (the
/// one-time system approval dialog), waits for the control plane, then
/// applies the operator's upstream list and the fixed listen address.
/// A port-53 bind failure (another DNS service running) is a definite,
/// actionable result — the daemon stays up and reports `bindError`,
/// which this reads back to the caller instead of a vague "not ready".
pub fn enable(upstreams: Vec<String>, listen_ip: Option<String>) -> Result<(), String> {
    if service::plist_path().is_none() {
        return Err(
            "The bundled DNS daemon is missing — enabling requires the installed app.".to_string(),
        );
    }
    service::register()?;
    // The registration returns only after the approval flow completes;
    // the daemon may still be booting — poll the control plane.
    let deadline = std::time::Instant::now() + DAEMON_READINESS_TIMEOUT;
    let mut ready = false;
    while std::time::Instant::now() < deadline {
        if client::request("status", serde_json::json!({}), Duration::from_secs(1)).is_ok() {
            ready = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    if !ready {
        return Err(
            "The DNS daemon registered but its control plane is not answering yet — \
             check its status in a moment."
                .to_string(),
        );
    }
    apply_config(upstreams, listen_ip)?;
    // The config.set above may have self-restarted the daemon (listen
    // address change): wait for the control plane again, then surface a
    // bind failure as the definite result it is.
    let deadline = std::time::Instant::now() + DAEMON_READINESS_TIMEOUT;
    while std::time::Instant::now() < deadline {
        if let Ok(status) = client::request("status", serde_json::json!({}), Duration::from_secs(1))
        {
            if let Some(bind_error) = status.get("bindError").and_then(serde_json::Value::as_str) {
                return Err(format!(
                    "the DNS daemon could not bind port 53 ({bind_error}) — another DNS \
                     service is probably running; stop it and enable again"
                ));
            }
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    Err(
        "The DNS daemon applied the config but is restarting — check its status in a moment."
            .to_string(),
    )
}

/// Pushes the current config to a RUNNING daemon: upstream list plus the
/// fixed listen address. Called on enable and whenever the operator
/// commits new settings while the daemon is up (the preference alone
/// would otherwise drift from the daemon's live config).
pub fn apply_config(upstreams: Vec<String>, listen_ip: Option<String>) -> Result<(), String> {
    let list: Vec<serde_json::Value> = upstreams
        .iter()
        .map(String::as_str)
        .map(serde_json::Value::from)
        .collect();
    client::call(
        "config.set",
        serde_json::json!({
            "upstreams": list,
            "listenIp": listen_ip,
        }),
        Duration::from_secs(3),
    )
    .map(|_| ())
    .map_err(|e| format!("the DNS daemon did not accept the config: {e}"))
}

/// Disables the service: the operator's switch-off. Unregisters the
/// LaunchDaemon — the daemon stops, the port is freed and the
/// authorization is removed together. (A full uninstall means deleting
/// the App itself; the router's DHCP must get its original DNS back —
/// the help article covers both steps.)
pub fn disable() -> Result<(), String> {
    service::unregister()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_id_is_stable_per_process() {
        let first = run_id().to_string();
        let second = run_id().to_string();
        assert_eq!(first, second);
        assert!(first.starts_with("app-"));
    }

    #[test]
    fn default_upstreams_are_plain_ip_literals() {
        for upstream in DEFAULT_UPSTREAMS {
            upstream
                .parse::<std::net::IpAddr>()
                .unwrap_or_else(|e| panic!("default upstream {upstream} is not an IP: {e}"));
        }
    }

    #[test]
    fn mapping_lease_stays_inside_the_daemon_bounds() {
        use crate::dns::MAPPING_LEASE;
        assert!(
            MAPPING_LEASE >= Duration::from_secs(5) && MAPPING_LEASE <= Duration::from_secs(300)
        );
    }
}
