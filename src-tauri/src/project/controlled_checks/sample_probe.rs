//! An isolated scsynth NRT read/write probe proves a saved WAV can load as a buffer.
use super::*;
use crate::project::children::{ChildRegistry, ShutdownOutcome, SupervisedChild};
use rosc::{OscBundle, OscMessage, OscPacket, OscTime, OscType};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

fn bundle(
    file: &mut File,
    fractional: u32,
    address: &str,
    args: Vec<OscType>,
) -> Result<(), String> {
    let encoded = rosc::encoder::encode(&OscPacket::Bundle(OscBundle {
        timetag: OscTime {
            seconds: 0,
            fractional,
        },
        content: vec![OscPacket::Message(OscMessage {
            addr: address.into(),
            args,
        })],
    }))
    .map_err(|cause| cause.to_string())?;
    file.write_all(&(encoded.len() as u32).to_be_bytes())
        .and_then(|()| file.write_all(&encoded))
        .map_err(|cause| cause.to_string())
}

fn probe(
    root: &Path,
    binary: &Path,
    plugins: &Path,
    sample: &Path,
    cancelled: &AtomicBool,
    report: &mut ControlledCheckReport,
) -> Result<(), String> {
    let work = tempfile::Builder::new()
        .prefix("sample-probe-")
        .tempdir_in(root.parent().ok_or("Missing controlled workspace")?)
        .map_err(|cause| cause.to_string())?;
    let score_path = work.path().join("probe.osc");
    let render_path = work.path().join("render.wav");
    let buffer_path = work.path().join("buffer.wav");
    let mut score = File::create(&score_path).map_err(|cause| cause.to_string())?;
    bundle(
        &mut score,
        0,
        "/b_allocRead",
        vec![
            0.into(),
            sample.to_string_lossy().into_owned().into(),
            0.into(),
            128.into(),
        ],
    )?;
    bundle(
        &mut score,
        429_496_729,
        "/b_write",
        vec![
            0.into(),
            buffer_path.to_string_lossy().into_owned().into(),
            "wav".into(),
            "int16".into(),
            (-1).into(),
            0.into(),
            0.into(),
        ],
    )?;
    bundle(&mut score, 858_993_459, "/c_set", vec![0.into(), 0.into()])?;
    drop(score);

    let log = File::create(work.path().join("scsynth.log")).map_err(|cause| cause.to_string())?;
    let mut command = Command::new(binary);
    command
        .arg("-N")
        .arg(&score_path)
        .arg("_")
        .arg(&render_path)
        .args([
            "48000", "WAV", "int16", "-o", "2", "-i", "0", "-z", "64", "-D", "0", "-U",
        ])
        .arg(plugins)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|cause| cause.to_string())?)
        .stderr(log);
    let registry = ChildRegistry::new(work.path().join("children"));
    let mut child = SupervisedChild::spawn_group(&registry, binary.to_string_lossy(), &mut command)
        .map_err(|cause| format!("Cannot start the isolated scsynth WAV probe: {cause}"))?;
    let deadline = Instant::now() + Duration::from_secs(10);
    let status = loop {
        if cancelled.load(Ordering::Acquire) || Instant::now() >= deadline {
            break Err("WAV sample probe cancelled or timed out".to_owned());
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(cause) => break Err(cause.to_string()),
        }
    };
    if child.shutdown(Duration::from_secs(2)) != ShutdownOutcome::Confirmed {
        let error = format!(
            "Isolated scsynth WAV probe cleanup was not confirmed; retained {}",
            work.keep().display()
        );
        report.cleanup.audio_confirmed = false;
        report.cleanup.errors.push(error.clone());
        if let Some(group) = child.owned_runtime_group() {
            report.unresolved_groups.push(group);
        }
        return Err(error);
    }
    let mut log = String::new();
    File::open(work.path().join("scsynth.log"))
        .and_then(|file| file.take(8192).read_to_string(&mut log))
        .map_err(|cause| cause.to_string())?;
    if !status?.success()
        || log.contains("ERROR")
        || log.contains("FAILURE")
        || fs::metadata(buffer_path).map_or(true, |metadata| metadata.len() <= 44)
    {
        return Err(format!(
            "SuperCollider did not load and write the WAV buffer: {log}"
        ));
    }
    Ok(())
}

pub(crate) fn inspect(
    root: &Path,
    samples: &[(String, String)],
    context: &ControlledCheckContext,
    cancelled: &AtomicBool,
    report: &mut ControlledCheckReport,
) -> Result<(), String> {
    if samples.is_empty() {
        return Ok(());
    }
    let binary = context
        .scsynth_binary
        .as_deref()
        .filter(|path| path.is_file());
    let plugins = context.plugins_dir.as_deref().filter(|path| path.is_dir());
    let (Some(binary), Some(plugins)) = (binary, plugins) else {
        report.status = ControlledCheckStatus::NotExecuted;
        report.error =
            Some("Bundled scsynth or its plugins are unavailable for the WAV buffer check".into());
        return Ok(());
    };
    let mut verified = Vec::new();
    for (path, expected) in samples {
        super::check_cancel(cancelled)?;
        let sample = fs::canonicalize(root.join(path)).map_err(|cause| cause.to_string())?;
        if !sample.starts_with(root) || !sample.is_file() {
            return Err("Sample is outside the isolated project".into());
        }
        let mut digest = Sha256::new();
        let bytes = io::copy(
            &mut File::open(&sample)
                .map_err(|cause| cause.to_string())?
                .take(512 * 1024 * 1024 + 1),
            &mut digest,
        )
        .map_err(|cause| cause.to_string())?;
        if bytes > 512 * 1024 * 1024 || &format!("{:x}", digest.finalize()) != expected {
            return Err(format!("Captured sample changed: {path}"));
        }
        probe(root, binary, plugins, &sample, cancelled, report)?;
        verified.push(expected.clone());
        report
            .loaded_media
            .get_or_insert_with(Vec::new)
            .push(ControlledMediaLoad {
                path: path.clone(),
                sha256: expected.clone(),
            });
    }
    report.loaded_sample_sha256 = Some(verified);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn controlled_scsynth_sample_probe_loads_a_real_wav_and_rejects_an_invalid_wav() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("project");
        fs::create_dir(&root).unwrap();
        let mut wav = b"RIFF".to_vec();
        wav.extend(16_036_u32.to_le_bytes());
        wav.extend(b"WAVEfmt ");
        wav.extend(16_u32.to_le_bytes());
        wav.extend(1_u16.to_le_bytes());
        wav.extend(1_u16.to_le_bytes());
        wav.extend(8_000_u32.to_le_bytes());
        wav.extend(16_000_u32.to_le_bytes());
        wav.extend(2_u16.to_le_bytes());
        wav.extend(16_u16.to_le_bytes());
        wav.extend(b"data");
        wav.extend(16_000_u32.to_le_bytes());
        for _ in 0..8_000 {
            wav.extend(1000_i16.to_le_bytes());
        }
        let sample = root.join("voice.wav");
        fs::write(&sample, &wav).unwrap();
        let binary = crate::project::audio::scsynth_binary_path().unwrap();
        let plugins = crate::project::audio::plugins_dir().unwrap();
        let cancelled = AtomicBool::new(false);
        let mut report = ControlledCheckReport::not_executed(
            "probe-fixture",
            &root,
            AudioMode::None,
            String::new(),
        );
        probe(&root, &binary, &plugins, &sample, &cancelled, &mut report).unwrap();
        fs::write(&sample, b"not a valid WAV").unwrap();
        assert!(probe(&root, &binary, &plugins, &sample, &cancelled, &mut report).is_err());
    }
}
