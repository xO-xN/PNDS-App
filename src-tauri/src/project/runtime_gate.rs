//! One runtime owner across the desktop Host and installed CLI.

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

pub fn default_gate_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("Cannot locate the user runtime directory")?;
    Ok(PathBuf::from(home).join("Library/Application Support/com.xo-xn.pnds-app/runtime.lock"))
}

/// The OS releases the lock after the owner exits; the durable journal still
/// rejects ownership until prior check resources are confirmed absent. Never unlink:
/// unlinking would let another opener lock a different inode at the same path.
#[derive(Debug)]
pub struct RuntimeLease(File);

/// Exact ownership evidence captured when a check creates its own process group.
/// Gate recovery only probes group absence; it never signals a process.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedRuntimeGroup {
    pub group_id: u32,
    pub leader_started_at: Option<String>,
    pub marker: String,
}

impl RuntimeLease {
    /// Persist before any check process starts. An interrupted write cannot
    /// discard already-recorded unresolved ownership: updates append records.
    pub fn begin_check(&self, task_id: &str) -> Result<(), String> {
        self.append_record(&OwnershipRecord {
            schema_version: 1,
            task_id: task_id.into(),
            boot_session: boot_session(),
            groups: None,
        })
    }

    /// Cleanup is the only authority allowed to clear the durable blocker.
    /// Unknown/incomplete ownership stays blocked, even after this owner exits.
    pub fn finish_check(
        &self,
        confirmed: bool,
        groups: &[OwnedRuntimeGroup],
    ) -> Result<(), String> {
        if confirmed {
            return self.clear_record();
        }
        let mut record = self
            .read_record()?
            .ok_or("Missing durable check ownership record")?;
        if groups.is_empty() {
            return Err("Unconfirmed cleanup has no complete process-group evidence; ownership remains blocked".into());
        }
        validate_groups(groups)?;
        record.groups = Some(groups.to_vec());
        self.append_record(&record)
    }

    fn append_record(&self, record: &OwnershipRecord) -> Result<(), String> {
        let mut file = &self.0;
        file.seek(SeekFrom::End(0)).map_err(journal_error)?;
        serde_json::to_writer(&mut file, record)
            .map_err(|error| format!("Cannot persist runtime ownership: {error}"))?;
        file.write_all(b"\n").map_err(journal_error)?;
        file.sync_all().map_err(journal_error)
    }

    fn read_record(&self) -> Result<Option<OwnershipRecord>, String> {
        let mut file = &self.0;
        file.seek(SeekFrom::Start(0)).map_err(journal_error)?;
        if file.metadata().map_err(journal_error)?.len() > 128 * 1024 {
            return Err(
                "Runtime ownership journal is too large; new runtime ownership is blocked".into(),
            );
        }
        let mut text = String::new();
        file.read_to_string(&mut text).map_err(journal_error)?;
        let mut latest = None;
        for line in text.lines() {
            let record: OwnershipRecord = serde_json::from_str(line).map_err(|error| {
                format!("Runtime ownership journal is incomplete; new runs are blocked: {error}")
            })?;
            if record.schema_version != 1 {
                return Err("Unknown runtime ownership journal; new runs are blocked".into());
            }
            latest = Some(record);
        }
        Ok(latest)
    }

    fn clear_record(&self) -> Result<(), String> {
        self.0.set_len(0).map_err(journal_error)?;
        self.0.sync_all().map_err(journal_error)
    }

    fn recover_or_reject(&self) -> Result<(), String> {
        let Some(record) = self.read_record()? else {
            return Ok(());
        };
        if record
            .boot_session
            .as_ref()
            .zip(boot_session().as_ref())
            .is_some_and(|(previous, current)| previous != current)
        {
            return self.clear_record(); // A reboot proves every prior group is gone.
        }
        let Some(groups) = record.groups else {
            return Err(format!("Controlled check {} has incomplete ownership evidence; new runs are blocked. Restart this Mac to confirm previous resources are absent", record.task_id));
        };
        validate_groups(&groups)?;
        if groups.iter().all(group_absent) {
            return self.clear_record();
        }
        let details = groups
            .iter()
            .map(|group| {
                format!(
                    "{} ({}, leader started {:?})",
                    group.group_id, group.marker, group.leader_started_at
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        Err(format!("Controlled check {} has unconfirmed cleanup for owned process groups: {details}. New runs remain blocked; close the owned task or restart this Mac, then retry. No foreign process was stopped", record.task_id))
    }

    pub fn acquire(path: &Path) -> Result<Self, String> {
        let parent = path.parent().ok_or("Invalid runtime lock path")?;
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot prepare runtime coordination: {error}"))?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
            .open(path)
            .map_err(|error| format!("Cannot open runtime coordination: {error}"))?;
        if !file
            .metadata()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            return Err("Runtime coordination requires a regular file".into());
        }
        // SAFETY: flock operates on this owned, live file descriptor.
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::WouldBlock {
                return Err(
                    "A PNDS performance or controlled check is active; wait for it to finish"
                        .into(),
                );
            }
            return Err(format!("Cannot acquire runtime coordination: {error}"));
        }
        let lease = Self(file);
        lease.recover_or_reject()?;
        Ok(lease)
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnershipRecord {
    schema_version: u32,
    task_id: String,
    boot_session: Option<String>,
    /// None is an armed run whose final ownership has not been recorded.
    groups: Option<Vec<OwnedRuntimeGroup>>,
}

fn journal_error(error: std::io::Error) -> String {
    format!("Cannot persist runtime ownership; new runs remain blocked until cleanup is confirmed: {error}")
}
fn validate_groups(groups: &[OwnedRuntimeGroup]) -> Result<(), String> {
    if groups.is_empty()
        || groups
            .iter()
            .any(|group| group.group_id <= 1 || group.group_id > i32::MAX as u32)
    {
        return Err(
            "Invalid unresolved process-group evidence; new runtime ownership is blocked".into(),
        );
    }
    Ok(())
}
fn group_absent(group: &OwnedRuntimeGroup) -> bool {
    // SAFETY: signal zero only probes a validated group; no recovery path kills.
    (unsafe { libc::kill(-(group.group_id as i32), 0) != 0 })
        && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
}
fn boot_session() -> Option<String> {
    let output = std::process::Command::new("/usr/sbin/sysctl")
        .args(["-n", "kern.bootsessionuuid"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8(output.stdout).ok()?.trim().to_owned();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

impl Drop for RuntimeLease {
    fn drop(&mut self) {
        // SAFETY: the descriptor remains owned until after this destructor.
        unsafe { libc::flock(self.0.as_raw_fd(), libc::LOCK_UN) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_owner_covers_competing_entries_until_cleanup_finishes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("runtime.lock");
        let performance = RuntimeLease::acquire(&path).unwrap();
        assert!(RuntimeLease::acquire(&path).unwrap_err().contains("active"));
        drop(performance);
        let check = RuntimeLease::acquire(&path).unwrap();
        assert!(RuntimeLease::acquire(&path).is_err());
        drop(check);
        assert!(RuntimeLease::acquire(&path).is_ok());
    }

    #[test]
    fn linked_lock_cannot_create_an_independent_owner() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("runtime.lock");
        std::os::unix::fs::symlink(dir.path().join("other"), &path).unwrap();
        assert!(RuntimeLease::acquire(&path).is_err());
        assert!(!dir.path().join("other").exists());
    }

    #[test]
    fn interrupted_owner_does_not_implicitly_confirm_cleanup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("runtime.lock");
        let owner = RuntimeLease::acquire(&path).unwrap();
        owner.begin_check("interrupted-check").unwrap();
        drop(owner);
        let error = RuntimeLease::acquire(&path).unwrap_err();
        assert!(error.contains("interrupted-check") && error.contains("incomplete"));
    }

    #[test]
    fn incomplete_journal_update_remains_blocked_instead_of_losing_ownership() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("runtime.lock");
        let owner = RuntimeLease::acquire(&path).unwrap();
        owner.begin_check("partial-update").unwrap();
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"{\"schemaVersion\":1,")
            .unwrap();
        drop(owner);
        assert!(RuntimeLease::acquire(&path)
            .unwrap_err()
            .contains("incomplete"));
    }

    #[test]
    fn unconfirmed_cleanup_without_group_evidence_stays_blocked() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("runtime.lock");
        let owner = RuntimeLease::acquire(&path).unwrap();
        owner.begin_check("unknown-groups").unwrap();
        assert!(owner.finish_check(false, &[]).is_err());
        drop(owner);
        assert!(RuntimeLease::acquire(&path).is_err());
    }
}
