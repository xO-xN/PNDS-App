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
        range: None,
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

#[test]
fn confirmed_client_identity_restores_only_its_mapping_and_rejects_retired_input() {
    use crate::participation_client::{ClientHostInfo, ClientPerformance};

    let host = |host_id: &str, project_id: &str, performance_id: &str| ClientHostInfo {
        protocol_version: 1,
        host_id: host_id.into(),
        node_name: "Same node name".into(),
        role: Some(crate::lan_discovery::LanNodeRole::Host),
        performance: Some(ClientPerformance {
            project_id: project_id.into(),
            performance_id: performance_id.into(),
            project_name: "Same project name".into(),
            performer_url: "http://example.local/".into(),
            supports_performer_url: true,
        }),
    };
    let first = ControllerScope::client(&host("peer:a", "project", "show-a")).unwrap();
    let different_peer = ControllerScope::client(&host("other", "project", "show-a")).unwrap();
    let copy = ControllerScope::client(&host("peer:a", "project-copy", "show-a")).unwrap();
    let different_pair = ControllerScope::client(&host("peer", "a:project", "show-a")).unwrap();
    let reopened = ControllerScope::client(&host("peer:a", "project", "show-b")).unwrap();
    assert_ne!(first.key, different_peer.key);
    assert_ne!(first.key, copy.key);
    assert_ne!(first.key, different_pair.key);
    assert_ne!(
        first.key,
        ControllerScope::host("project".into(), "Same project name".into()).key
    );
    assert_eq!(first.key, reopened.key);

    let mut mapping = MappingState::default();
    let retired = mapping.attach(first);
    let input = trigger("/action");
    mapping.set_learning(retired, true);
    mapping.handle_page(retired, PageReport::Selected(target("first", false)));
    assert!(mapping.receive(retired, &input).is_none());

    let replacement = mapping.attach(different_peer);
    assert!(mapping.receive(replacement, &input).is_none());
    mapping.set_learning(replacement, true);
    mapping.handle_page(
        replacement,
        PageReport::Selected(target("different", false)),
    );
    assert!(mapping.receive(replacement, &input).is_none());
    mapping.set_learning(replacement, false);
    // The new page has a matching address. An input already acquired by the
    // old owner must not trigger either page after this handoff.
    assert!(mapping.receive(retired, &input).is_none());
    assert_eq!(
        mapping.receive(replacement, &input).unwrap().target.id,
        "different"
    );

    let returning = mapping.attach(reopened);
    assert_eq!(
        mapping.receive(returning, &input).unwrap().target.id,
        "first"
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

#[test]
fn different_lan_senders_can_map_the_same_numeric_osc_address() {
    let packet = rosc::encoder::encode(&rosc::OscPacket::Message(rosc::OscMessage {
        addr: "/same".into(),
        args: vec![rosc::OscType::Int(64)],
    }))
    .unwrap();
    let first = osc::decode(&packet, "192.0.2.10".parse().unwrap()).unwrap();
    let second = osc::decode(&packet, "192.0.2.11".parse().unwrap()).unwrap();
    let mut state = MappingState::default();
    let page = state.attach(ControllerScope::host("/score".into(), "Score".into()));
    state.set_learning(page, true);
    for (name, input) in [("first", &first), ("second", &second)] {
        let mut control = target(name, false);
        control.kind = ControllerTargetKind::Switch;
        assert!(state.handle_page(page, PageReport::Selected(control)));
        state.receive(page, input);
    }
    state.set_learning(page, false);
    assert_eq!(state.snapshot().mappings.len(), 2);
    assert_eq!(state.receive(page, &first).unwrap().target.id, "first");
    assert_eq!(state.receive(page, &second).unwrap().target.id, "second");
}
