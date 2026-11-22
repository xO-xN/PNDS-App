use super::*;
use serde_json::json;
use std::net::{Ipv4Addr, UdpSocket};

fn trigger(address: &str) -> ControllerInput {
    ControllerInput {
        address: ControllerAddress::Osc {
            sender: None,
            address: address.into(),
        },
        value: None,
    }
}

fn target(id: &str, temporary: bool) -> ControllerTarget {
    ControllerTarget {
        id: id.into(),
        name: id.into(),
        kind: ControllerTargetKind::Trigger,
        temporary,
    }
}

#[test]
fn learning_replaces_both_ends_and_keeps_temporary_targets_out_of_preferences() {
    let mut mapping = MappingState::default();
    let page = mapping.attach(ControllerScope::host("/demo".into(), "Demo".into()));
    mapping.set_learning(page, true);
    mapping.handle_page(page, PageReport::Selected(target("left", false)));
    assert!(mapping.receive(page, &trigger("/one")).is_none());
    mapping.handle_page(page, PageReport::Selected(target("right", false)));
    assert!(mapping.receive(page, &trigger("/two")).is_none());
    mapping.handle_page(page, PageReport::Selected(target("left", false)));
    assert!(mapping.receive(page, &trigger("/two")).is_none());
    assert_eq!(mapping.snapshot().mappings.len(), 1);
    mapping.handle_page(page, PageReport::Selected(target("current", true)));
    assert!(mapping.receive(page, &trigger("/temporary")).is_none());

    let saved = mapping.snapshot().preferences;
    assert_eq!(saved.groups.len(), 1);
    assert_eq!(saved.groups[0].mappings.len(), 1);
    assert_eq!(saved.groups[0].mappings[0].target.id, "left");

    mapping.set_learning(page, false);
    assert_eq!(
        mapping.receive(page, &trigger("/two")).unwrap().target.id,
        "left"
    );
    let fresh = mapping.attach(ControllerScope::host("/demo".into(), "Demo".into()));
    assert!(mapping.receive(page, &trigger("/two")).is_none());
    assert!(mapping.receive(fresh, &trigger("/temporary")).is_none());
    assert_eq!(
        mapping.receive(fresh, &trigger("/two")).unwrap().target.id,
        "left"
    );
}

#[tokio::test]
async fn loopback_udp_receives_a_single_osc_trigger() {
    let receiver = tokio::net::UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = receiver.local_addr().unwrap().port();
    let sender = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    sender
        .send_to(b"/test\0\0\0,\0\0\0", (Ipv4Addr::LOCALHOST, port))
        .unwrap();
    let mut bytes = [0; 1024];
    let (len, source) = receiver.recv_from(&mut bytes).await.unwrap();
    assert_eq!(
        serde_json::to_value(osc::decode(&bytes[..len], source.ip())).unwrap(),
        json!({"address":{"kind":"osc","sender":null,"address":"/test"},"value":null})
    );
    assert!(osc::decode(b"/test\0\0\0,i\0\0", source.ip()).is_none());
}
