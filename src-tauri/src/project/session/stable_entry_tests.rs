use super::*;
use std::net::Ipv4Addr;

fn metadata(url: &str) -> serde_json::Value {
    serde_json::from_str(
        &ureq::get(format!("{url}__pnds/participation"))
            .call()
            .unwrap()
            .into_body()
            .read_to_string()
            .unwrap(),
    )
    .unwrap()
}

#[test]
fn idle_entry_is_reachable_without_starting_a_project_or_claiming_a_role() {
    let manager = SessionManager::default();
    let data = tempfile::tempdir().unwrap();
    let entry = manager.prepare_host_entry(data.path(), "Stage", Ipv4Addr::LOCALHOST);
    assert_eq!(entry.status, PublicEntryStatus::Waiting);
    let url = entry.url.unwrap();
    let info = metadata(&url);
    assert_eq!(info["nodeName"], "Stage");
    assert!(info["performance"].is_null());
    assert_eq!(manager.snapshot().status, SessionStatus::Idle);
    assert!(!manager.has_active_session());
    assert!(manager.active_child_pids().is_empty());
    assert_eq!(
        manager.public_entry_snapshot().url.as_deref(),
        Some(url.as_str())
    );
    let again = manager.prepare_host_entry(data.path(), "Stage", Ipv4Addr::LOCALHOST);
    assert_eq!(again.url.as_deref(), Some(url.as_str()));
    assert_eq!(metadata(&url)["hostId"], info["hostId"]);
    let pending_edit =
        manager.prepare_host_entry(data.path(), "Next name", Ipv4Addr::new(192, 0, 2, 77));
    assert_eq!(pending_edit.url.as_deref(), Some(url.as_str()));
    assert_eq!(metadata(&url)["nodeName"], "Stage");
}

#[test]
fn reopening_reuses_the_held_port_and_reports_conflict_without_stopping_its_owner() {
    use crate::project::children::with_managed_child_pids;

    let data = tempfile::tempdir().unwrap();
    let first = SessionManager::default();
    let opened = first.prepare_host_entry(data.path(), "Stage", Ipv4Addr::LOCALHOST);
    let first_url = opened.url.unwrap();
    let host_id = metadata(&first_url)["hostId"].clone();
    assert!(!opened.port_changed);
    drop(first);
    let second = SessionManager::default();
    // A concurrent managed fork can retain a CLOEXEC copy until exec. Keep
    // manager destruction outside the registry lock; fence only each original
    // single bind, matching the HostEntry drop/rebind fixture contract.
    let reopened = with_managed_child_pids(|_| {
        second.prepare_host_entry(data.path(), "Stage", Ipv4Addr::LOCALHOST)
    });
    assert_eq!(reopened.url.as_deref(), Some(first_url.as_str()));
    assert!(!reopened.port_changed);
    let address = reqwest::Url::parse(&first_url)
        .unwrap()
        .socket_addrs(|| None)
        .unwrap()[0];
    drop(second);
    let occupied = with_managed_child_pids(|_| std::net::TcpListener::bind(address)).unwrap();
    let third = SessionManager::default();
    let avoided = third.prepare_host_entry(data.path(), "Stage", Ipv4Addr::LOCALHOST);
    let actual_url = avoided.url.unwrap();
    assert_ne!(actual_url, first_url);
    assert!(
        avoided.port_changed,
        "saved entries must be updated after startup conflict"
    );
    assert_eq!(metadata(&actual_url)["hostId"], host_id);
    assert!(std::net::TcpStream::connect(occupied.local_addr().unwrap()).is_ok());
    assert_eq!(
        third.public_entry_snapshot().url.as_deref(),
        Some(actual_url.as_str())
    );
}

#[test]
fn public_entry_qr_tracks_only_the_held_available_listener_without_starting_a_run() {
    let manager = SessionManager::default();
    let data = tempfile::tempdir().unwrap();
    assert!(manager.public_entry_qr_url("http://127.0.0.1:1/").is_err());
    let entry = manager.prepare_host_entry(data.path(), "Stage", Ipv4Addr::LOCALHOST);
    let url = entry.url.unwrap();
    assert_eq!(manager.public_entry_qr_url(&url).unwrap(), url);
    assert!(manager.public_entry_qr_url("http://127.0.0.1:1/").is_err());
    assert!(metadata(&url)["performance"].is_null());
    assert!(!manager.has_active_session());
    assert!(manager.active_child_pids().is_empty());
    manager.lock().host_entry_error = Some("participation.errors.hostEntryRuntime: fault".into());
    assert!(manager.public_entry_qr_url(&url).is_err());
    assert_eq!(
        manager.public_entry_snapshot().url.as_deref(),
        Some(url.as_str())
    );
}

#[test]
fn test_performer_qr_requires_the_ready_generation_and_never_changes_display_or_publication() {
    let manager = SessionManager::default();
    let url = "http://test.local:52341/";
    assert!(manager.creation_performer_qr_url(url, "41").is_err());
    {
        let mut inner = manager.lock();
        inner.generation = 41;
        inner.status = SessionStatus::Ready;
        inner.host_address = Some("test.local".into());
        inner.applied_score_ports = Some([52341, 52342]);
    }
    assert_eq!(manager.creation_performer_qr_url(url, "41").unwrap(), url);
    assert!(manager
        .creation_performer_qr_url("http://test.local:6868/", "41")
        .is_err());
    assert!(manager.snapshot().performer_qr.is_none());
    assert!(manager.lock().participation_host.is_none());
    manager.lock().generation = 42;
    assert!(manager.creation_performer_qr_url(url, "41").is_err());
    let https = "https://test.example:8443/join?room=one&piece=two";
    {
        let mut inner = manager.lock();
        inner.https_entry = HttpsEntryState {
            status: HttpsEntryStatus::Ready,
            url: Some(https.into()),
            error: None,
        };
    }
    assert_eq!(
        manager.creation_performer_qr_url(https, "42").unwrap(),
        https
    );
    assert!(manager.creation_performer_qr_url(url, "42").is_err());
    manager.lock().https_entry.status = HttpsEntryStatus::Error;
    assert!(manager.creation_performer_qr_url(https, "42").is_err());
    assert!(manager.creation_performer_qr_url(url, "42").is_err());
    manager.lock().status = SessionStatus::Stopping;
    assert!(manager.creation_performer_qr_url(https, "42").is_err());
}
