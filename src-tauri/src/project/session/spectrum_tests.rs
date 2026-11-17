use super::*;
use crate::events::CreationAudioAnalyzerEvent;
use rosc::{OscMessage, OscPacket, OscType};
use std::net::SocketAddr;

fn receive(server: &UdpSocket) -> (OscPacket, SocketAddr) {
    let mut buffer = [0; 4096];
    let (size, peer) = server.recv_from(&mut buffer).unwrap();
    let (_, packet) = rosc::decoder::decode_udp(&buffer[..size]).unwrap();
    (packet, peer)
}

fn send(server: &UdpSocket, peer: SocketAddr, addr: &str, args: Vec<OscType>) {
    let bytes = rosc::encoder::encode(&OscPacket::Message(OscMessage {
        addr: addr.into(),
        args,
    }))
    .unwrap();
    server.send_to(&bytes, peer).unwrap();
}

fn confirm(server: &UdpSocket, expected: &str) -> SocketAddr {
    let (packet, peer) = receive(server);
    let OscPacket::Message(message) = packet else {
        panic!("Expected a single OSC message");
    };
    assert_eq!(message.addr, expected);
    send(
        server,
        peer,
        "/done",
        vec![OscType::String(expected.into())],
    );
    peer
}

#[test]
fn creation_spectrum_taps_two_private_buses_and_releases_nodes() {
    use OscType::{Float, Int, String as OscString};
    let app = tauri::test::mock_app().handle().clone();
    crate::events::events_builder().mount_events(&app);
    let (frame_tx, frame_rx) = std::sync::mpsc::channel();
    CreationAudioAnalyzerEvent::listen_any(&app, move |event| {
        let _ = frame_tx.send(event.payload);
    });
    let manager = SessionManager::default();
    let server = UdpSocket::bind("127.0.0.1:0").unwrap();
    server
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let port = server.local_addr().unwrap().port();
    {
        let mut inner = manager.lock();
        inner.status = SessionStatus::Ready;
        inner.generation = 7;
        inner.audio_mode = Some(AudioMode::Internal);
        inner.scsynth_port = Some(port);
        inner.master_synth_ready = true;
        inner.channel_plan = Some(crate::project::audio::channel_plan(8, 4));
        inner.applied_sample_rate = Some(48_000);
    }
    let fixture = std::thread::spawn(move || {
        let peer = confirm(&server, "/d_load");
        assert_eq!(confirm(&server, "/notify"), peer);
        let (packet, source) = receive(&server);
        assert_eq!(source, peer);
        let OscPacket::Bundle(bundle) = packet else {
            panic!("Expected simultaneous synth creation");
        };
        assert_eq!(bundle.content.len(), 2);
        let ids: Vec<_> = bundle
            .content
            .into_iter()
            .zip([4, 5])
            .map(|(packet, bus)| {
                let OscPacket::Message(message) = packet else {
                    panic!("Expected a synth command");
                };
                assert_eq!(message.addr, "/s_new");
                let [OscString(name), Int(node), Int(2), Int(group), OscString(input), Int(actual)] =
                    message.args.as_slice()
                else {
                    panic!("Unexpected synth arguments");
                };
                assert_eq!(name, "pndsSpectrum");
                assert_eq!(*group, crate::project::audio::MASTER_GROUP_ID);
                assert_eq!(input, "in");
                assert_eq!(*actual, bus);
                *node
            })
            .collect();
        for chunk in 0..8 {
            for (index, node) in ids.iter().enumerate() {
                let mut args = vec![Int(*node), Int(0), Float(1.0), Float(chunk as f32)];
                args.extend(std::iter::repeat_n(Float(index as f32 * 0.5), 512));
                send(&server, peer, "/pnds/spectrum", args);
            }
        }
        let (OscPacket::Message(free), source) = receive(&server) else {
            panic!("Expected analyzer release");
        };
        assert_eq!(source, peer);
        assert_eq!(free.addr, "/n_free");
        assert_eq!(free.args, ids.into_iter().map(Int).collect::<Vec<_>>());
        let (OscPacket::Message(unsubscribe), source) = receive(&server) else {
            panic!("Expected OSC unsubscribe");
        };
        assert_eq!(source, peer);
        assert_eq!(unsubscribe.addr, "/notify");
        assert_eq!(unsubscribe.args, vec![Int(0)]);
    });

    assert!(manager
        .set_creation_audio_analyzer(app.clone(), "6".into(), true)
        .is_err());
    manager
        .set_creation_audio_analyzer(app.clone(), "7".into(), true)
        .unwrap();
    let frame = frame_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    assert_eq!(frame.generation, "7");
    assert_eq!(frame.sample_rate, 48_000);
    assert_eq!(frame.fft_size, 8192);
    assert_eq!(frame.magnitudes, vec![0.5; 4096]);
    assert!(manager
        .set_creation_audio_analyzer(app.clone(), "6".into(), false)
        .is_err());
    manager
        .set_creation_audio_analyzer(app, "7".into(), false)
        .unwrap();
    fixture.join().unwrap();
    assert!(manager.lock().creation_audio_analyzer.is_none());
}
