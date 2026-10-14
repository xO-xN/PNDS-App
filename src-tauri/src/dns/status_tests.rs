use super::*;
use crate::dns::test_support::{ControlFixture, Reply};
use serde_json::json;
use std::sync::atomic::Ordering;

fn status(fixture: &ControlFixture) -> DnsServiceStatus {
    daemon_status_on(&fixture.socket, DnsRegistrationStatus::NotRegistered, false)
}

#[test]
fn status_reads_real_daemon_facts_in_a_dev_bundle() {
    let fixture = ControlFixture::new(|_| Reply::Normal);
    fixture.listeners.udp.store(true, Ordering::SeqCst);
    fixture.listeners.tcp.store(true, Ordering::SeqCst);
    fixture
        .engine
        .set_upstreams(vec!["127.0.0.1:5353".parse().unwrap()]);
    let lease = MappingLease::new_on(7, fixture.socket.clone());
    lease.install("show.example.org", "192.168.11.31").unwrap();

    let facts = status(&fixture);
    assert_eq!(facts.registration, DnsRegistrationStatus::NotRegistered);
    assert!(!facts.plist_present);
    assert!(facts.daemon);
    assert_eq!(
        facts.listeners,
        Some(DnsListeners {
            udp: true,
            tcp: true
        })
    );
    assert_eq!(facts.bind_error, None);
    assert_eq!(facts.upstreams, ["127.0.0.1:5353"]);
    let mapping = facts.mapping.unwrap();
    assert_eq!(mapping.domain, "show.example.org.");
    assert_eq!(mapping.ip, "192.168.11.31");
    assert_eq!(mapping.run_id, run_id());
    assert_eq!(mapping.generation, 7);
    assert!(mapping.lease_seconds_remaining > 0);
    assert!(mapping.lease_seconds_remaining <= 60);
    assert_eq!(facts.known_domains, ["show.example.org."]);
    assert!(facts.stats.is_some());

    lease.revoke();
    let facts = status(&fixture);
    assert!(facts.daemon);
    assert_eq!(facts.mapping, None);
    assert_eq!(facts.known_domains, ["show.example.org."]);
}

#[test]
fn status_reports_an_unreachable_daemon_without_touching_system_socket() {
    let dir = tempfile::tempdir().unwrap();
    let facts = daemon_status_on(
        &dir.path().join("absent.sock"),
        DnsRegistrationStatus::Enabled,
        true,
    );
    assert_eq!(facts.registration, DnsRegistrationStatus::Enabled);
    assert!(facts.plist_present);
    assert!(!facts.daemon);
    assert_eq!(facts.listeners, None);
    assert_eq!(facts.mapping, None);
    assert_eq!(facts.bind_error, None);
    assert!(facts.upstreams.is_empty());
    assert!(facts.known_domains.is_empty());
    assert_eq!(facts.stats, None);
}

#[test]
fn refused_status_is_not_daemon_readiness() {
    let fixture = ControlFixture::new(|_| {
        Reply::Respond(json!({ "id": 1, "ok": false, "code": "invalidRequest" }))
    });
    assert!(!status(&fixture).daemon);
    assert!(request_status_on(&fixture.socket, Duration::from_secs(1))
        .unwrap_err()
        .contains("invalidRequest"));
}

#[test]
fn bind_failure_remains_visible_and_prevents_enable_success() {
    let fixture = ControlFixture::new(|_| Reply::Normal);
    fixture.listeners.udp.store(true, Ordering::SeqCst);
    *fixture.listeners.bind_error.lock().unwrap() = Some("Address already in use".into());

    let facts = status(&fixture);
    assert!(facts.daemon);
    assert_eq!(
        facts.listeners,
        Some(DnsListeners {
            udp: true,
            tcp: false
        })
    );
    assert_eq!(facts.bind_error.as_deref(), Some("Address already in use"));
    let data = request_status_on(&fixture.socket, Duration::from_secs(1)).unwrap();
    let error = check_bind_error(&data).unwrap_err();
    assert!(error.contains("port 53"));
    assert!(error.contains("Address already in use"));
}

#[test]
fn healthy_listeners_pass_the_enable_check() {
    let fixture = ControlFixture::new(|_| Reply::Normal);
    fixture.listeners.udp.store(true, Ordering::SeqCst);
    fixture.listeners.tcp.store(true, Ordering::SeqCst);
    let data = request_status_on(&fixture.socket, Duration::from_secs(1)).unwrap();
    assert!(check_bind_error(&data).is_ok());
}
