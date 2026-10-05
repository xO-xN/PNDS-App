use super::*;
use crate::dns::test_support::{ControlFixture, Reply};
use hickory_proto::op::ResponseCode;
use pnds_dnsd_lib::engine::MappingHolder;

const DOMAIN: &str = "show.example.org";
const IP: &str = "192.168.11.31";

fn lease(fixture: &ControlFixture, generation: u64) -> MappingLease {
    MappingLease::new_on(generation, fixture.socket.clone())
}

#[test]
fn install_refresh_and_revoke_cross_the_real_daemon_seam() {
    let fixture = ControlFixture::new(|_| Reply::Normal);
    let mapping = lease(&fixture, 1);
    mapping.install(DOMAIN, IP).unwrap();
    assert_eq!(fixture.response_code(DOMAIN), ResponseCode::NoError);
    assert_eq!(fixture.engine.mapping_snapshot().unwrap().1.to_string(), IP);
    mapping.refresh().unwrap();
    mapping.revoke();
    assert_eq!(fixture.response_code(DOMAIN), ResponseCode::NXDomain);
    assert_eq!(
        fixture.operations(),
        ["mapping.set", "verify", "mapping.refresh", "mapping.clear"]
    );
    // A late renew or install cannot recreate a revoked mapping.
    assert!(mapping.refresh().is_err());
    assert!(mapping.install(DOMAIN, IP).is_err());
    mapping.revoke();
    assert_eq!(fixture.operations().len(), 4);
}

#[test]
fn failed_verification_immediately_rolls_back_the_installed_mapping() {
    let fixture = ControlFixture::new(|request| {
        if request["op"] == "verify" {
            Reply::Respond(json!({ "ok": true, "data": { "resolved": "192.168.11.99" } }))
        } else {
            Reply::Normal
        }
    });
    let mapping = lease(&fixture, 2);
    assert!(mapping
        .install(DOMAIN, IP)
        .unwrap_err()
        .contains("did not verify"));
    assert_eq!(
        fixture.operations(),
        ["mapping.set", "verify", "mapping.clear"]
    );
    assert_eq!(fixture.response_code(DOMAIN), ResponseCode::NXDomain);
    mapping.revoke();
    assert_eq!(fixture.operations().len(), 3);
}

#[test]
fn lost_set_reply_still_revokes_the_daemons_accepted_mapping() {
    let fixture = ControlFixture::new(|request| {
        if request["op"] == "mapping.set" {
            Reply::Drop
        } else {
            Reply::Normal
        }
    });
    let mapping = lease(&fixture, 3);
    assert!(mapping
        .install(DOMAIN, IP)
        .unwrap_err()
        .contains("without answering"));
    assert_eq!(fixture.operations(), ["mapping.set", "mapping.clear"]);
    assert_eq!(fixture.response_code(DOMAIN), ResponseCode::NXDomain);
}

#[test]
fn lost_verify_reply_also_rolls_back() {
    let fixture = ControlFixture::new(|request| {
        if request["op"] == "verify" {
            Reply::Drop
        } else {
            Reply::Normal
        }
    });
    let mapping = lease(&fixture, 4);
    assert!(mapping.install(DOMAIN, IP).is_err());
    assert_eq!(fixture.response_code(DOMAIN), ResponseCode::NXDomain);
}

#[test]
fn failed_rollback_keeps_cleanup_for_teardown() {
    let mut clears = 0;
    let fixture = ControlFixture::new(move |request| {
        if request["op"] == "verify" {
            Reply::Drop
        } else if request["op"] == "mapping.clear" {
            clears += 1;
            if clears == 1 {
                Reply::Respond(json!({ "ok": false, "code": "injectedRefusal" }))
            } else {
                Reply::Normal
            }
        } else {
            Reply::Normal
        }
    });
    let mapping = lease(&fixture, 5);
    assert!(mapping.install(DOMAIN, IP).is_err());
    assert!(fixture.engine.mapping_snapshot().is_some());
    assert!(mapping.refresh().is_err());
    mapping.revoke();
    assert_eq!(fixture.response_code(DOMAIN), ResponseCode::NXDomain);
    assert_eq!(
        fixture.operations(),
        ["mapping.set", "verify", "mapping.clear", "mapping.clear"]
    );
}

#[test]
fn old_cleanup_cannot_revoke_a_newer_mapping() {
    let fixture = ControlFixture::new(|_| Reply::Normal);
    let old = lease(&fixture, 6);
    let new = lease(&fixture, 7);
    old.install(DOMAIN, IP).unwrap();
    new.install(DOMAIN, "192.168.11.32").unwrap();
    old.revoke();
    assert_eq!(
        fixture.engine.mapping_snapshot().unwrap().1.to_string(),
        "192.168.11.32"
    );
    old.revoke(); // notHolder finishes the old cleanup obligation.
    assert_eq!(
        fixture
            .operations()
            .iter()
            .filter(|op| *op == "mapping.clear")
            .count(),
        1
    );
    new.revoke();
}

#[test]
fn clear_before_a_delayed_set_retires_that_holder_in_the_daemon() {
    let fixture = ControlFixture::new(|request| {
        if request["op"] == "mapping.set" {
            // The App sees a failed exchange before the server applies
            // the set. Simulate its delayed application after rollback.
            Reply::Respond(json!({ "ok": false, "code": "injectedLostSet" }))
        } else {
            Reply::Normal
        }
    });
    let mapping = lease(&fixture, 8);
    assert!(mapping.install(DOMAIN, IP).is_err());
    let late = fixture.engine.mapping_set(
        DOMAIN,
        IP.parse().unwrap(),
        MappingHolder {
            run_id: run_id().to_string(),
            generation: 8,
        },
        MAPPING_LEASE,
    );
    assert_eq!(
        late,
        Err(pnds_dnsd_lib::engine::MappingError::StaleGeneration)
    );
    assert!(fixture.engine.mapping_snapshot().is_none());
}

#[test]
fn revocation_before_install_sends_no_request() {
    let fixture = ControlFixture::new(|_| Reply::Normal);
    let mapping = lease(&fixture, 9);
    mapping.revoke();
    assert!(mapping.install(DOMAIN, IP).is_err());
    assert!(fixture.operations().is_empty());
}

#[test]
fn absent_daemon_is_a_mapping_error_and_cleanup_remains_bounded() {
    let dir = tempfile::tempdir_in("/tmp").unwrap();
    let mapping = MappingLease::new_on(10, dir.path().join("missing.sock"));
    assert!(mapping.install(DOMAIN, IP).unwrap_err().contains("connect"));
    mapping.revoke();
}
