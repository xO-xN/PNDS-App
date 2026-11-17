//! Stock scsynth verification of the compiled App analyzer, without CoreAudio.
#![cfg(target_os = "macos")]

use rosc::{OscBundle, OscMessage, OscPacket, OscTime, OscType};
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use std::process::Command;

fn message(addr: &str, args: Vec<OscType>) -> OscPacket {
    OscPacket::Message(OscMessage {
        addr: addr.into(),
        args,
    })
}

fn bundle(file: &mut File, at: f64, content: Vec<OscPacket>) {
    let packet = OscPacket::Bundle(OscBundle {
        timetag: OscTime {
            seconds: at.floor() as u32,
            fractional: (at.fract() * 4_294_967_296.0) as u32,
        },
        content,
    });
    let bytes = rosc::encoder::encode(&packet).unwrap();
    file.write_all(&(bytes.len() as u32).to_be_bytes()).unwrap();
    file.write_all(&bytes).unwrap();
}

#[test]
#[ignore = "local acceptance: requires installed sclang and fetched stock scsynth; no audio device used"]
fn bundled_spectrum_emits_coherent_calibrated_frames() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let temp = tempfile::tempdir().unwrap();
    let fixture = temp.path().join("tones.scd");
    fs::write(
        &fixture,
        r#"(
SynthDef(\spectrumTestTones, { |gain = 1|
    var unit = SampleRate.ir / 8192;
    Out.ar(2, ((SinOsc.ar(unit * 128, 0, 0.5) + SinOsc.ar(unit * 3500, 0, 0.25)) - 0.125) * gain);
}).writeDefFile(thisProcess.argv[0]);
0.exit;
)"#,
    )
    .unwrap();
    let compiler = std::env::var_os("SCLANG")
        .unwrap_or_else(|| "/Applications/SuperCollider.app/Contents/MacOS/sclang".into());
    let compiled = Command::new(compiler)
        .arg("-D")
        .arg(&fixture)
        .arg(temp.path())
        .output()
        .unwrap();
    assert!(compiled.status.success(), "{compiled:?}");

    let score_path = temp.path().join("spectrum.osc");
    let mut score = File::create(&score_path).unwrap();
    let synthdefs = [
        temp.path().join("spectrumTestTones.scsyndef"),
        root.join("resources/synthdefs/pndsSpectrum.scsyndef"),
    ];
    bundle(
        &mut score,
        0.0,
        synthdefs
            .iter()
            .map(|path| message("/d_load", vec![path.to_string_lossy().to_string().into()]))
            .collect(),
    );
    bundle(
        &mut score,
        0.05,
        vec![
            message(
                "/s_new",
                vec!["spectrumTestTones".into(), 11.into(), 1.into(), 0.into()],
            ),
            message(
                "/s_new",
                vec![
                    "pndsSpectrum".into(),
                    12.into(),
                    1.into(),
                    0.into(),
                    "in".into(),
                    2.into(),
                ],
            ),
        ],
    );
    // NRT disables network replies. Trace the actual SendReply inputs over
    // each control block of a complete capture, before and after silencing the tone.
    for (blocks, mute_at) in [(155..185, None), (380..420, Some(0.28))] {
        if let Some(at) = mute_at {
            bundle(
                &mut score,
                at,
                vec![message("/n_set", vec![11.into(), "gain".into(), 0.into()])],
            );
        }
        for block in blocks {
            let at = (f64::from(block) + 0.1) * 64.0 / 48_000.0;
            bundle(&mut score, at, vec![message("/n_trace", vec![12.into()])]);
        }
    }
    bundle(
        &mut score,
        0.6,
        vec![message("/n_free", vec![12.into(), 11.into()])],
    );
    bundle(
        &mut score,
        0.65,
        vec![message("/c_set", vec![0.into(), 0.into()])],
    );
    drop(score);

    let binary = root.join(format!(
        "binaries/scsynth-{}-apple-darwin",
        std::env::consts::ARCH
    ));
    let rendered = Command::new(binary)
        .args(["-i", "0", "-o", "2", "-z", "64", "-U"])
        .arg(root.join("plugins"))
        .arg("-N")
        .arg(score_path)
        .arg("_")
        .arg(temp.path().join("silent.wav"))
        .args(["48000", "WAV", "float"])
        .output()
        .unwrap();
    assert!(
        rendered.status.success(),
        "{}",
        String::from_utf8_lossy(&rendered.stderr)
    );

    let trace = String::from_utf8_lossy(&rendered.stdout);
    let mut frames = BTreeMap::<u32, BTreeMap<u32, Vec<f32>>>::new();
    for (_, inputs) in trace
        .lines()
        .zip(trace.lines().skip(1))
        .filter(|(unit, _)| unit.ends_with(" SendReply"))
    {
        let fields: Vec<&str> = inputs.split_whitespace().skip(1).collect();
        if fields[0] != "1" {
            continue;
        }
        let path_len: usize = fields[2].parse().unwrap();
        assert!(fields[3..3 + path_len]
            .iter()
            .map(|byte| byte.parse::<u8>().unwrap())
            .eq(b"/pnds/spectrum".iter().copied()));
        let reply = &fields[3 + path_len..];
        let frame = reply[0].parse().unwrap();
        let chunk = reply[1].parse().unwrap();
        let bins: Vec<f32> = reply[2..]
            .iter()
            .map(|value| value.parse().unwrap())
            .collect();
        assert_eq!(bins.len(), 512);
        assert!(bins.iter().all(|bin| bin.is_finite() && *bin >= 0.0));
        assert!(frames
            .entry(frame)
            .or_default()
            .insert(chunk, bins)
            .is_none());
    }
    let complete: Vec<_> = frames.values().filter(|chunks| chunks.len() == 8).collect();
    assert!(complete.len() >= 2);
    for chunks in [&complete[0], complete.last().unwrap()] {
        assert!(chunks.keys().copied().eq(0..8));
    }
    let tone: Vec<_> = complete[0].values().flatten().copied().collect();
    for (bin, amplitude) in [
        (0, 0.125),
        (127, 0.25),
        (128, 0.5),
        (129, 0.25),
        (3500, 0.25),
    ] {
        assert!(
            (tone[bin] - amplitude).abs() < 0.001,
            "bin {bin} was {}",
            tone[bin]
        );
    }
    assert!(complete
        .last()
        .unwrap()
        .values()
        .flatten()
        .all(|bin| *bin < 0.000001));
}
