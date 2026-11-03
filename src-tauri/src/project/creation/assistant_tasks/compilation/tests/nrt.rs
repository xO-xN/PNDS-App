//! Local acceptance against compiled bytes. This is a controlled fixture, not a
//! general inference of arbitrary scores' OSC or musical ending semantics.
use super::*;
use crate::project::children::{ChildRegistry, ShutdownOutcome, SupervisedChild};
use rosc::{OscBundle, OscMessage, OscPacket, OscTime, OscType};
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Instant;

const RATE: u32 = 48_000;
const WAVES: [&str; 8] = [
    "SinOsc.ar(freq)",
    "(SinOsc.ar(freq) + SinOsc.ar(freq * 2, 0, 0.3)) * 0.77",
    "LFTri.ar(freq) * 0.8",
    "Pulse.ar(freq, 0.35) * 0.4",
    "Saw.ar(freq) * 0.5",
    "VarSaw.ar(freq, 0, 0.4) * 0.6",
    "SinOsc.ar(freq + (SinOsc.ar(2) * 2))",
    "(SinOsc.ar(freq) + SinOsc.ar(freq * 3, 0, 0.2)) * 0.8",
];

fn source(pluck: bool) -> String {
    WAVES
        .iter()
        .enumerate()
        .map(|(index, wave)| {
            let envelope = if pluck && index == 0 {
                "Env.perc(0.03, 0.3, 1, 0)"
            } else {
                "Env.asr(0.03, 1, release, 0)"
            };
            let done_action = if pluck && index == 0 { 0 } else { 2 };
            format!(
                "SynthDef('fixture_pad_{index}', {{ |out=0, gate=1, freq=220, release=0.5| var env = EnvGen.kr({envelope}, gate, doneAction: {done_action}); Out.ar(out, (({wave}) * env * 0.2).dup); }}).add;\n"
            )
        })
        .collect()
}

fn message(address: &str, args: Vec<OscType>) -> OscPacket {
    OscPacket::Message(OscMessage {
        addr: address.into(),
        args,
    })
}

fn bundle(file: &mut fs::File, seconds: f64, packet: OscPacket) {
    let encoded = rosc::encoder::encode(&OscPacket::Bundle(OscBundle {
        timetag: OscTime {
            seconds: seconds.floor() as u32,
            fractional: (seconds.fract() * 4_294_967_296.0) as u32,
        },
        content: vec![packet],
    }))
    .unwrap();
    file.write_all(&(encoded.len() as u32).to_be_bytes())
        .unwrap();
    file.write_all(&encoded).unwrap();
}

fn gate(file: &mut fs::File, time: f64, value: f32) {
    bundle(
        file,
        time,
        message("/n_set", vec![1000.into(), "gate".into(), value.into()]),
    );
}

/// Every process owns a durable marker and process group. NRT reads an OSC file
/// and writes a WAV file; it opens neither an audio device nor an OSC listener.
fn render(fixture: &Fixture, index: usize, release_at: Option<f64>) -> Vec<f64> {
    let root = fixture.temp.path();
    let score_path = root.join("fixture.osc");
    let wave_path = root.join("fixture.wav");
    let log_path = root.join("scsynth.log");
    let release = 0.4 + index as f64 * 0.1;
    let end = release_at.unwrap_or(3.0) + release + 0.25;
    let mut score = fs::File::create(&score_path).unwrap();
    let name = format!("fixture_pad_{index}");
    let artifact = fixture
        .root
        .join(format!("supercollider/synthdefs/{name}.scsyndef"));
    bundle(
        &mut score,
        0.0,
        message(
            "/d_load",
            vec![artifact.to_string_lossy().into_owned().into()],
        ),
    );
    bundle(
        &mut score,
        0.05,
        message(
            "/s_new",
            vec![
                name.into(),
                1000.into(),
                0.into(),
                0.into(),
                "freq".into(),
                (180.0 + index as f32 * 30.0).into(),
                "release".into(),
                (release as f32).into(),
            ],
        ),
    );
    // Repeated active heartbeat/gate observations must not cause early release.
    let active_until = release_at.unwrap_or(end);
    for tick in 1..((active_until * 10.0) as u32) {
        gate(&mut score, f64::from(tick) / 10.0, 1.0);
    }
    if let Some(release_at) = release_at {
        gate(&mut score, release_at, 0.0);
    }
    bundle(&mut score, end, message("/c_set", vec![0.into(), 0.into()]));
    drop(score);
    let binary = PathBuf::from("/Applications/SuperCollider.app/Contents/Resources/scsynth");
    assert!(
        binary.is_file(),
        "Install standard SuperCollider for this local acceptance test"
    );
    let log = fs::File::create(&log_path).unwrap();
    let mut command = Command::new(&binary);
    command
        .arg("-N")
        .arg(&score_path)
        .arg("_")
        .arg(&wave_path)
        .args([
            "48000", "WAV", "int16", "-o", "2", "-i", "0", "-z", "64", "-D", "0",
        ])
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(log.try_clone().unwrap())
        .stderr(log);
    let registry = ChildRegistry::new(root.join("nrt-ownership"));
    let mut child =
        SupervisedChild::spawn_group(&registry, binary.to_string_lossy(), &mut command).unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        assert!(Instant::now() < deadline, "NRT timed out");
        std::thread::sleep(Duration::from_millis(10));
    };
    let outcome = child.shutdown(Duration::from_secs(2));
    assert!(matches!(outcome, ShutdownOutcome::Confirmed));
    let log = fs::read_to_string(log_path).unwrap();
    assert!(status.success(), "scsynth failed: {log}");
    assert!(
        !log.contains("ERROR") && !log.contains("FAILURE"),
        "scsynth reported: {log}"
    );
    pcm16_left_channel(&fs::read(wave_path).unwrap())
}

fn pcm16_left_channel(bytes: &[u8]) -> Vec<f64> {
    assert_eq!(&bytes[..4], b"RIFF");
    assert_eq!(&bytes[8..12], b"WAVE");
    let mut cursor = 12;
    let mut format_seen = false;
    while cursor + 8 <= bytes.len() {
        let len = u32::from_le_bytes(bytes[cursor + 4..cursor + 8].try_into().unwrap()) as usize;
        let data = &bytes[cursor + 8..cursor + 8 + len];
        match &bytes[cursor..cursor + 4] {
            b"fmt " => {
                assert_eq!(u16::from_le_bytes(data[0..2].try_into().unwrap()), 1);
                assert_eq!(u16::from_le_bytes(data[2..4].try_into().unwrap()), 2);
                assert_eq!(u32::from_le_bytes(data[4..8].try_into().unwrap()), RATE);
                assert_eq!(u16::from_le_bytes(data[14..16].try_into().unwrap()), 16);
                format_seen = true;
            }
            b"data" => {
                assert!(format_seen);
                return data
                    .chunks_exact(4)
                    .map(|frame| f64::from(i16::from_le_bytes([frame[0], frame[1]])) / 32768.0)
                    .collect();
            }
            _ => {}
        }
        cursor += 8 + len + len % 2;
    }
    panic!("WAV has no PCM data");
}

fn rms(samples: &[f64], start: f64, end: f64) -> f64 {
    let window = &samples[(start * f64::from(RATE)) as usize..(end * f64::from(RATE)) as usize];
    (window.iter().map(|value| value * value).sum::<f64>() / window.len() as f64).sqrt()
}

fn holds(samples: &[f64], end: f64) -> bool {
    let baseline = rms(samples, 0.3, 0.5);
    baseline > 0.01 && rms(samples, end - 0.2, end - 0.05) / baseline > 0.75
}

#[test]
#[ignore = "local acceptance: installed sclang and scsynth NRT render temporary fixtures only, without device output"]
fn assistant_compile_eight_pads_real_nrt_sustain_release_and_expiry() {
    let mut fixture = Fixture::new();
    let references = (0..8)
        .map(|index| format!("supercollider/synthdefs/fixture_pad_{index}.scsyndef"))
        .collect::<Vec<_>>();
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(fixture.root.join("manifest.json")).unwrap()).unwrap();
    manifest["audio"]["synthdefs"] = serde_json::json!(references);
    fixture.write("manifest.json", &manifest.to_string());
    fixture.write("supercollider/source/voice.scd", &source(false));
    let output = fixture.prepare().run(&SynthdefCompiler::default());
    let compiled = fixture.finish(output);
    assert_eq!(
        compiled.status,
        AssistantCompileStatus::Succeeded,
        "{compiled:?}"
    );
    assert_eq!(compiled.report.produced.len(), 8);
    let mut measurements = Vec::new();
    for index in 0..8 {
        let release = 0.4 + index as f64 * 0.1;
        for (scenario, release_at) in [
            ("held", None),
            ("fingerUp", Some(2.0)),
            ("elementExpiry", Some(3.0)),
        ] {
            let samples = render(&fixture, index, release_at);
            let active_end = release_at.unwrap_or(3.0);
            let baseline = rms(&samples, 0.3, 0.5);
            let held_ratio = rms(&samples, active_end - 0.2, active_end - 0.05) / baseline;
            assert!(
                holds(&samples, active_end),
                "pad {index} {scenario}: gate stopped sustaining ({held_ratio})"
            );
            let mut evidence = serde_json::json!({"pad":index,"scenario":scenario,"releaseSeconds":release,"baselineRms":baseline,"heldRatio":held_ratio});
            if let Some(at) = release_at {
                let middle = rms(&samples, at + release * 0.4, at + release * 0.6) / baseline;
                let late = rms(&samples, at + release * 0.8, at + release * 0.9) / baseline;
                let silence = rms(&samples, at + release + 0.05, at + release + 0.15);
                assert!(
                    (0.30..0.75).contains(&middle),
                    "pad {index} {scenario}: missing middle tail ({middle})"
                );
                assert!(
                    (0.06..0.25).contains(&late),
                    "pad {index} {scenario}: truncated or wrong tail ({late})"
                );
                assert!(
                    silence < 0.0001,
                    "pad {index} {scenario}: voice did not end ({silence})"
                );
                evidence["middleTailRatio"] = middle.into();
                evidence["lateTailRatio"] = late.into();
                evidence["postTailRms"] = silence.into();
            }
            measurements.push(evidence);
        }
    }
    // Prove the audio assertion rejects a real pluck binary even when its name,
    // publication, manifest validation and compiler receipt are all correct.
    fixture.write("supercollider/source/voice.scd", &source(true));
    assert!(fixture.state().needed);
    let output = fixture.prepare().run(&SynthdefCompiler::default());
    let pluck = fixture.finish(output);
    assert_eq!(pluck.status, AssistantCompileStatus::Succeeded);
    let wrong = render(&fixture, 0, Some(2.0));
    assert!(
        !holds(&wrong, 2.0),
        "negative control must expose the pluck envelope"
    );
    println!(
        "NRT_ACCEPTANCE={}",
        serde_json::json!({
            "sampleRate":RATE,"channels":2,"sampleFormat":"int16","blockSize":64,
            "compiler":compiled.report.sclang_path,"inputs":compiled.inputs,"artifacts":compiled.artifacts,
            "measurements":measurements,"pluckNegativeControlRejected":true,
            "scope":"controlled gate protocol only; no real score server, device output, or artistic assessment"
        })
    );
}
