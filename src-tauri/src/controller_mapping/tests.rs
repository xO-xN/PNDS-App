use super::*;
use serde_json::json;
use std::net::{Ipv4Addr, UdpSocket};

fn host_scope(path: &str, name: &str) -> ControllerScope {
    ControllerScope {
        key: format!("host-fixture:{path}"),
        name: name.into(),
        role: ControllerRole::Host,
    }
}

fn trigger(address: &str) -> ControllerInput {
    ControllerInput {
        address: ControllerAddress::Osc {
            sender: None,
            address: address.into(),
        },
        value: None,
        midi_cc: None,
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

fn select(state: &mut MappingState, id: u32, target: ControllerTarget) -> bool {
    let page = state.page(id).unwrap();
    let click = page.latest_click + 1;
    let mode = page.mode_version;
    state.handle_page(
        id,
        PageReport::Selected {
            target,
            click,
            mode,
        },
    )
}

fn deliver_test(
    state: &mut MappingState,
    id: u32,
    input: &ControllerInput,
) -> Option<ControllerMapping> {
    let owner = state.page(id)?.input_owner();
    match state.prepare_input(owner, input)? {
        InputDelivery::Apply(mapping) => Some(mapping),
        InputDelivery::VerifySelection { .. } => {
            assert!(state.finish_learning(owner, input, Some(true)));
            None
        }
    }
}

#[test]
fn learning_replaces_both_ends_and_keeps_temporary_targets_out_of_preferences() {
    let mut mapping = MappingState::default();
    let page = mapping.attach(host_scope("/demo", "Demo"));
    mapping.set_learning(page, true);
    select(&mut mapping, page, target("left", false));
    assert!(deliver_test(&mut mapping, page, &trigger("/one")).is_none());
    select(&mut mapping, page, target("right", false));
    assert!(deliver_test(&mut mapping, page, &trigger("/two")).is_none());
    select(&mut mapping, page, target("left", false));
    assert!(deliver_test(&mut mapping, page, &trigger("/two")).is_none());
    assert_eq!(mapping.snapshot().mappings.len(), 1);
    select(&mut mapping, page, target("current", true));
    assert!(deliver_test(&mut mapping, page, &trigger("/temporary")).is_none());

    let saved = mapping.snapshot().preferences;
    assert_eq!(saved.groups.len(), 1);
    assert_eq!(saved.groups[0].mappings.len(), 1);
    assert_eq!(saved.groups[0].mappings[0].target.id, "left");

    mapping.set_learning(page, false);
    assert_eq!(
        deliver_test(&mut mapping, page, &trigger("/two"))
            .unwrap()
            .target
            .id,
        "left"
    );
    let fresh = mapping.attach(host_scope("/demo", "Demo"));
    assert!(deliver_test(&mut mapping, page, &trigger("/two")).is_none());
    assert!(deliver_test(&mut mapping, fresh, &trigger("/temporary")).is_none());
    assert_eq!(
        deliver_test(&mut mapping, fresh, &trigger("/two"))
            .unwrap()
            .target
            .id,
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
    assert_ne!(first.key, host_scope("project", "Same project name").key);
    assert_eq!(first.key, reopened.key);

    let mut mapping = MappingState::default();
    let retired = mapping.attach(first);
    let input = trigger("/action");
    mapping.set_learning(retired, true);
    select(&mut mapping, retired, target("first", false));
    assert!(deliver_test(&mut mapping, retired, &input).is_none());

    let replacement = mapping.attach(different_peer);
    assert!(deliver_test(&mut mapping, replacement, &input).is_none());
    mapping.set_learning(replacement, true);
    select(&mut mapping, replacement, target("different", false));
    assert!(deliver_test(&mut mapping, replacement, &input).is_none());
    mapping.set_learning(replacement, false);
    // The new page has a matching address. An input already acquired by the
    // old owner must not trigger either page after this handoff.
    assert!(deliver_test(&mut mapping, retired, &input).is_none());
    assert_eq!(
        deliver_test(&mut mapping, replacement, &input)
            .unwrap()
            .target
            .id,
        "different"
    );

    let returning = mapping.attach(reopened);
    assert_eq!(
        deliver_test(&mut mapping, returning, &input)
            .unwrap()
            .target
            .id,
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
    let page = state.attach(host_scope("/score", "Score"));
    state.set_learning(page, true);
    for (name, input) in [("first", &first), ("second", &second)] {
        let mut control = target(name, false);
        control.kind = ControllerTargetKind::Switch;
        assert!(select(&mut state, page, control));
        deliver_test(&mut state, page, input);
    }
    state.set_learning(page, false);
    assert_eq!(state.snapshot().mappings.len(), 2);
    assert_eq!(
        deliver_test(&mut state, page, &first).unwrap().target.id,
        "first"
    );
    assert_eq!(
        deliver_test(&mut state, page, &second).unwrap().target.id,
        "second"
    );
}

#[test]
fn settings_learns_only_declared_controls_of_the_current_page() {
    let key = r#"declared:["/score","pulse"]"#;
    let pulse = target(key, false);
    let scope = host_scope("/custom", "Custom");
    let mut mapping = MappingState::default();
    let retired = mapping.attach(scope.clone());
    assert!(mapping.select_declared(retired, key).is_err());
    assert!(mapping.handle_page(
        retired,
        PageReport::DeclaredTargets {
            targets: vec![pulse.clone()]
        },
    ));
    assert!(mapping.select_declared(retired, key).unwrap());

    assert!(mapping.handle_page(
        retired,
        PageReport::DeclaredTargets {
            targets: Vec::new()
        },
    ));
    deliver_test(&mut mapping, retired, &trigger("/no-longer-registered"));
    assert!(mapping.snapshot().mappings.is_empty());
    assert!(mapping.snapshot().pending.is_none());

    mapping.handle_page(
        retired,
        PageReport::DeclaredTargets {
            targets: vec![pulse.clone()],
        },
    );
    assert!(mapping.select_declared(retired, key).unwrap());
    deliver_test(&mut mapping, retired, &trigger("/pulse"));
    assert_eq!(
        mapping.snapshot().preferences.groups[0].mappings[0].target,
        pulse
    );

    let page = mapping.attach(scope);
    assert!(mapping.select_declared(retired, key).is_err());
    assert!(deliver_test(&mut mapping, page, &trigger("/pulse")).is_none());
    mapping.handle_page(
        page,
        PageReport::DeclaredTargets {
            targets: vec![pulse.clone()],
        },
    );
    assert_eq!(
        deliver_test(&mut mapping, page, &trigger("/pulse"))
            .unwrap()
            .target,
        pulse
    );
}

#[test]
fn cc_release_rearms_buttons_without_learning_or_triggering() {
    let mut routes = midi::Routes::default();
    routes.replace([(11, 1), (22, 2)]);
    let cc = |routes: &mut midi::Routes, token, channel, number, value| {
        routes
            .receive(
                token,
                midi::Message {
                    status: 0xB,
                    channel,
                    number,
                    value,
                },
            )
            .unwrap()
    };
    let mut state = MappingState::default();
    let page = state.attach(host_scope("/score", "Score"));
    state.set_learning(page, true);
    select(&mut state, page, target("Play", false));
    deliver_test(&mut state, page, &cc(&mut routes, 1, 2, 7, 63));
    assert!(state.snapshot().mappings.is_empty());
    deliver_test(&mut state, page, &cc(&mut routes, 1, 2, 7, 64));
    assert_eq!(state.snapshot().mappings.len(), 1);
    state.set_learning(page, false);

    assert!(deliver_test(&mut state, page, &cc(&mut routes, 1, 2, 7, 127)).is_none());
    assert!(deliver_test(&mut state, page, &cc(&mut routes, 2, 2, 7, 127)).is_none());
    assert!(deliver_test(&mut state, page, &cc(&mut routes, 1, 3, 7, 127)).is_none());
    assert!(deliver_test(&mut state, page, &cc(&mut routes, 1, 2, 8, 127)).is_none());
    assert!(deliver_test(&mut state, page, &cc(&mut routes, 1, 2, 7, 63)).is_none());
    assert_eq!(
        deliver_test(&mut state, page, &cc(&mut routes, 1, 2, 7, 64))
            .unwrap()
            .target
            .id,
        "Play"
    );
}

#[test]
fn continuous_cc_preserves_fixed_input_bounds_when_editing_output() {
    let mut routes = midi::Routes::default();
    routes.replace([(11, 1)]);
    let input = routes
        .receive(
            1,
            midi::Message {
                status: 0xB,
                channel: 0,
                number: 7,
                value: 0,
            },
        )
        .unwrap();
    let scope = host_scope("/score", "Score");
    let mut state = MappingState::default();
    let page = state.attach(scope.clone());
    state.set_learning(page, true);
    let mut fader = target("Fader", false);
    fader.kind = ControllerTargetKind::Continuous;
    fader.range = Some(ControllerRange {
        min: 0.0,
        max: 100.0,
        step: Some(5.0),
        step_base: 0.0,
    });
    assert!(select(&mut state, page, fader));
    deliver_test(&mut state, page, &input);
    let default = state.snapshot().mappings[0].range.unwrap();
    assert_eq!((default.input_min, default.input_max), (0.0, 127.0));
    let reversed = ControllerMappingRange {
        target_min: 20.0,
        target_max: 80.0,
        reversed: true,
        ..default
    };
    assert!(state
        .configure_range(&scope.key, "Fader", reversed)
        .unwrap());
    let invalid = ControllerMappingRange {
        input_max: 100.0,
        ..reversed
    };
    assert!(state.configure_range(&scope.key, "Fader", invalid).is_err());
    assert_eq!(state.snapshot().mappings[0].range, Some(reversed));
}

#[test]
fn host_does_not_restore_a_mapping_to_a_replacement_install_at_the_same_path() {
    let stage = tempfile::tempdir().unwrap();
    let path = stage.path().join("score");
    std::fs::create_dir(&path).unwrap();
    let original = ControllerScope::host(&path, "Score".into()).unwrap();
    assert_eq!(
        original.key,
        ControllerScope::host(&path, "Renamed".into()).unwrap().key
    );
    std::fs::rename(&path, stage.path().join("retired")).unwrap();
    std::fs::create_dir(&path).unwrap();
    let replacement = ControllerScope::host(&path, "Score".into()).unwrap();
    assert_ne!(original.key, replacement.key);
}

#[test]
fn a_retired_temporary_selection_and_a_queued_old_selection_preserve_the_saved_mapping() {
    let mut state = MappingState::default();
    let page = state.attach(host_scope("/score", "Score"));
    let action = trigger("/action");
    state.set_learning(page, true);
    assert!(select(&mut state, page, target("stable", false)));
    deliver_test(&mut state, page, &action);

    assert!(select(&mut state, page, target("removed", true)));
    let removed = state.page(page).unwrap().input_owner();
    assert!(matches!(
        state.prepare_input(removed, &action),
        Some(InputDelivery::VerifySelection { .. })
    ));
    assert!(state.finish_learning(removed, &action, Some(false)));
    assert_eq!(state.snapshot().mappings[0].target.id, "stable");
    assert_eq!(
        state.snapshot().preferences.groups[0].mappings[0].target.id,
        "stable"
    );

    assert!(select(&mut state, page, target("old", false)));
    let queued = state.page(page).unwrap().input_owner();
    assert!(select(&mut state, page, target("new", false)));
    assert!(state.prepare_input(queued, &action).is_none());

    let awaiting = state.page(page).unwrap().input_owner();
    assert!(matches!(
        state.prepare_input(awaiting, &action),
        Some(InputDelivery::VerifySelection { .. })
    ));
    assert!(select(&mut state, page, target("newest", false)));
    assert!(!state.finish_learning(awaiting, &action, Some(true)));
    assert_eq!(state.snapshot().pending.unwrap().id, "newest");
    assert_eq!(state.snapshot().mappings[0].target.id, "stable");
}

#[test]
fn editing_a_declared_mapping_uses_the_current_legal_range() {
    let mut state = MappingState::default();
    let scope = host_scope("/score", "Score");
    let page = state.attach(scope.clone());
    let id = r#"declared:["/score","mix"]"#;
    let mut mix = target(id, false);
    mix.kind = ControllerTargetKind::Continuous;
    mix.range = Some(ControllerRange {
        min: 0.0,
        max: 100.0,
        step: Some(5.0),
        step_base: 0.0,
    });
    let input = ControllerInput {
        value: Some(0.5),
        ..trigger("/mix")
    };
    let register = |state: &mut MappingState, target: ControllerTarget| {
        state.handle_page(
            page,
            PageReport::DeclaredTargets {
                targets: vec![target],
            },
        )
    };
    assert!(register(&mut state, mix.clone()));
    assert!(state.select_declared(page, id).unwrap());
    deliver_test(&mut state, page, &input);
    assert!(state.set_learning(page, false));
    assert!(deliver_test(&mut state, page, &input).is_some());
    let old_range = state.snapshot().mappings[0].range.unwrap();

    mix.range = Some(ControllerRange {
        min: 40.0,
        max: 50.0,
        step: Some(5.0),
        step_base: 40.0,
    });
    assert!(register(&mut state, mix.clone()));
    let snapshot = state.snapshot();
    assert_eq!(snapshot.mappings[0].target.range, mix.range);
    assert_eq!(snapshot.unavailable, vec![id]);
    assert!(deliver_test(&mut state, page, &input).is_none());
    assert!(state.configure_range(&scope.key, id, old_range).is_err());

    assert!(state
        .configure_range(
            &scope.key,
            id,
            ControllerMappingRange {
                target_min: 40.0,
                target_max: 50.0,
                ..old_range
            }
        )
        .unwrap());
    let snapshot = state.snapshot();
    assert!(snapshot.unavailable.is_empty());
    assert_eq!(
        snapshot.preferences.groups[0].mappings[0].target.range,
        mix.range
    );
    assert!(deliver_test(&mut state, page, &input).is_some());
}

#[cfg(target_os = "macos")]
#[test]
fn page_badges_use_the_app_language_catalog_for_midi_addresses() {
    let chinese = crate::native_locale::catalog("zh-CN").unwrap();
    let english = crate::native_locale::catalog("en").unwrap();
    let note = ControllerAddress::MidiNote {
        port: i32::MIN,
        channel: 2,
        note: 64,
    };
    let cc = ControllerAddress::MidiCc {
        port: i32::MIN,
        channel: 3,
        controller: 7,
    };
    assert!(note.display_label(chinese).ends_with("通道 2 · Note 64"));
    assert!(note.display_label(english).ends_with("Ch 2 · Note 64"));
    assert!(cc.display_label(chinese).ends_with("通道 3 · CC 7"));
    assert!(cc.display_label(english).ends_with("Ch 3 · CC 7"));
}
