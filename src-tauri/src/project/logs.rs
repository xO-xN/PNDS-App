//! Session log files (app-behavior「日志与清理」): one file per project session, kept in
//! `app_data_dir/session-logs/`. Metadata header, per-line timestamps, stdout/stderr
//! interleaved from both children, and a stop footer. Files are rotated —
//! the last 20 are kept; older files are removed on session start.

use std::fs;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Log directory relative to the app data dir.
const LOGS_DIR: &str = "session-logs";
/// Maximum number of session log files to retain.
const MAX_LOG_FILES: usize = 20;

pub struct SessionLogParams<'a> {
    pub project_id: &'a str,
    pub project_name: &'a str,
    pub project_path: &'a str,
    pub audio_mode: &'a str,
    pub lan_ip: &'a str,
    pub osc_target: &'a str,
    pub output_device: &'a str,
}

pub struct SessionLogger {
    file: Option<BufWriter<fs::File>>,
}

impl SessionLogger {
    /// Creates log directory and rotates old files. Returns a new logger
    /// that appends one line per call.
    pub fn open(app_data_dir: &Path, params: SessionLogParams) -> Result<Self, String> {
        let dir = app_data_dir.join(LOGS_DIR);
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create session-logs dir: {e}"))?;

        Self::rotate(&dir)?;

        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let fname = format!("session-{ts}-{}.log", params.project_id);
        let path = dir.join(&fname);

        let file = fs::File::create(&path)
            .map_err(|e| format!("Failed to create session log {path:?}: {e}"))?;
        let mut writer = BufWriter::new(file);

        let _ = writeln!(
            writer,
            "PNDS session log | project: {} ({}) | path: {}",
            params.project_name, params.project_id, params.project_path
        );
        let _ = writeln!(
            writer,
            "mode={} lan={} osc={} device={}",
            params.audio_mode, params.lan_ip, params.osc_target, params.output_device
        );

        Ok(Self { file: Some(writer) })
    }

    /// Appends one timestamped line, flushing immediately: the log's whole
    /// purpose (issue #93) is post-hoc diagnosis of slow shutdowns and
    /// crashes, so lines must survive a hard App exit and be observable
    /// while the session is live. Volume is line-rate child output — the
    /// per-line flush cost is negligible.
    pub fn write_line(&mut self, line: &str) {
        if let Some(ref mut f) = self.file {
            let ts = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default();
            let secs = ts.as_secs();
            let ms = ts.subsec_millis();
            if writeln!(f, "[{secs}.{ms:03}] {line}")
                .and_then(|()| f.flush())
                .is_err()
            {
                log::warn!("Failed to append to the session log");
            }
        }
    }

    /// Closes the log file, writing a stop marker.
    pub fn close(&mut self) {
        if let Some(mut f) = self.file.take() {
            let _ = writeln!(f);
            let _ = writeln!(f, "[session end]");
        }
    }

    /// Removes older log files so at most MAX_LOG_FILES remain.
    fn rotate(dir: &Path) -> Result<(), String> {
        let mut entries: Vec<(u64, PathBuf)> = Vec::new();
        for entry in fs::read_dir(dir).map_err(|e| format!("log rotation: {e}"))? {
            let entry = entry.map_err(|e| format!("log rotation: {e}"))?;
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("session-") || !name.ends_with(".log") {
                continue;
            }
            // Extract the leading time_t portion for stable ordering.
            let secs = name
                .strip_prefix("session-")
                .and_then(|rest| rest.split('-').next())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            entries.push((secs, entry.path()));
        }
        entries.sort_by_key(|(s, _)| *s);

        while entries.len() > MAX_LOG_FILES {
            if let Some((_, path)) = entries.first() {
                let _ = fs::remove_file(path);
                entries.remove(0);
            } else {
                break;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn log_rotation_keeps_max() {
        let dir = tempfile::tempdir().unwrap();
        // Create MAX_LOG_FILES + 3 files; the oldest 3 should be gone.
        for i in 1..=MAX_LOG_FILES + 3 {
            let path = dir.path().join(format!("session-{i:06}-test.log"));
            fs::write(&path, "body").unwrap();
        }
        SessionLogger::rotate(dir.path()).unwrap();
        let remaining: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert_eq!(remaining.len(), MAX_LOG_FILES);
        // Oldest should be #4 (1-3 removed)
        let min = remaining
            .iter()
            .filter_map(|e| {
                e.file_name()
                    .to_string_lossy()
                    .strip_prefix("session-")
                    .and_then(|r| r[..6].parse::<u64>().ok())
            })
            .min()
            .unwrap();
        assert_eq!(min, 4);
    }
}
