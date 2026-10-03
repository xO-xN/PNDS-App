//! #174: DNS-service commands — status / enable / disable for the
//! settings「演出 DNS」section. The enable path carries the operator's
//! upstream list (validated at the preference save boundary and
//! re-parsed here); enable itself parks a worker thread while the
//! system's approval dialog runs.

use crate::dns::{self, DnsServiceStatus, DEFAULT_UPSTREAMS};

/// Full service status: registration, control-plane liveness, listeners,
/// upstreams, mapping and counters. Never fails — a down daemon is a
/// status fact (see `dns::daemon_status`).
#[tauri::command]
#[specta::specta]
pub async fn dns_service_status() -> DnsServiceStatus {
    dns::daemon_status()
}

/// Enables the background DNS service. `upstreams` is the operator's
/// forwarding list (IP[:port] entries); blank entries fall back to the
/// defaults. Blocks until the approval flow and readiness poll finish.
#[tauri::command]
#[specta::specta]
pub async fn dns_service_enable(
    upstreams: Option<Vec<String>>,
    listen_ip: Option<String>,
) -> Result<(), String> {
    let list = normalize_upstreams(upstreams)?;
    // registerAndReturnError parks while the approval dialog is up —
    // run the whole flow on a blocking thread, not on a runtime worker.
    tauri::async_runtime::spawn_blocking(move || dns::enable(list, listen_ip))
        .await
        .map_err(|e| format!("the enable task failed: {e}"))?
}

/// Pushes the operator's current config to a RUNNING daemon (settings
/// commits and App launch call this; a down daemon simply reports so —
/// the config applies on the next enable).
#[tauri::command]
#[specta::specta]
pub async fn dns_service_apply_config(
    upstreams: Option<Vec<String>>,
    listen_ip: Option<String>,
) -> Result<(), String> {
    let list = normalize_upstreams(upstreams)?;
    tauri::async_runtime::spawn_blocking(move || dns::apply_config(list, listen_ip))
        .await
        .map_err(|e| format!("the apply task failed: {e}"))?
}

/// Opens System Settings → Login Items — the recovery path when the
/// daemon registration awaits approval (the operator dismissed the
/// approval dialog; the status row routes here).
#[tauri::command]
#[specta::specta]
pub async fn dns_service_open_system_settings() -> Result<(), String> {
    crate::dns::service::open_system_settings_login_items()
}

/// Disables the background DNS service (unregisters the LaunchDaemon —
/// the daemon stops, the port is freed, the authorization is removed).
#[tauri::command]
#[specta::specta]
pub async fn dns_service_disable() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(dns::disable)
        .await
        .map_err(|e| format!("the disable task failed: {e}"))?
}

/// The effective upstream list: trimmed, IP-validated entries, or the
/// defaults when the operator cleared the field. Invalid entries are a
/// hard error — the settings layer mirror-validates before offering this.
fn normalize_upstreams(upstreams: Option<Vec<String>>) -> Result<Vec<String>, String> {
    let raw = upstreams.unwrap_or_default();
    let entries: Vec<String> = raw
        .into_iter()
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
        .collect();
    if entries.is_empty() {
        return Ok(DEFAULT_UPSTREAMS.iter().map(|s| s.to_string()).collect());
    }
    for entry in &entries {
        crate::dns::parse_upstream_entry(entry).ok_or_else(|| {
            format!(
                "\"{entry}\" is not a valid upstream — use an IPv4 address, optionally with :port"
            )
        })?;
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_upstream_list_falls_back_to_defaults() {
        assert_eq!(
            normalize_upstreams(None).unwrap(),
            vec!["223.5.5.5".to_string(), "119.29.29.29".to_string()]
        );
        assert_eq!(
            normalize_upstreams(Some(vec!["   ".to_string()])).unwrap(),
            vec!["223.5.5.5".to_string(), "119.29.29.29".to_string()]
        );
    }

    #[test]
    fn upstreams_accept_ips_with_optional_ports() {
        assert_eq!(
            normalize_upstreams(Some(vec!["223.5.5.5".into(), "1.1.1.1:5353".into()])).unwrap(),
            vec!["223.5.5.5".to_string(), "1.1.1.1:5353".to_string()]
        );
    }

    #[test]
    fn upstreams_refuse_hostnames_and_junk() {
        assert!(normalize_upstreams(Some(vec!["dns.example.org".into()])).is_err());
        assert!(normalize_upstreams(Some(vec!["not an ip".into()])).is_err());
    }

    #[test]
    fn upstream_entries_normalize_to_the_shared_parser() {
        assert_eq!(
            crate::dns::parse_upstream_entry("223.5.5.5"),
            Some("223.5.5.5".to_string())
        );
        assert_eq!(
            crate::dns::parse_upstream_entry("223.5.5.5:5353"),
            Some("223.5.5.5:5353".to_string())
        );
        // IPv6 and hostnames are outside the documented scope.
        assert_eq!(crate::dns::parse_upstream_entry("dns.example.org"), None);
        assert_eq!(crate::dns::parse_upstream_entry("2001:db8::1"), None);
    }
}
