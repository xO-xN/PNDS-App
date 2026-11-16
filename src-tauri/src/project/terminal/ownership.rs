//! Terminal-only durable ownership; never shares the score child registry.

use super::{process_identity_including_zombies, session_members, ProcessIdentity};
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::time::{Duration, Instant};

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Record {
    pub leader: ProcessIdentity,
    pub members: Vec<ProcessIdentity>,
}

#[derive(Clone)]
pub(super) struct Journal {
    directory: PathBuf,
}

impl Journal {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    fn file(&self) -> PathBuf {
        self.directory.join("project-terminal.json")
    }

    pub fn read(&self) -> Result<Option<Record>, String> {
        let mut file = match OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC)
            .open(self.file())
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("Cannot read terminal ownership: {error}")),
        };
        let metadata = file.metadata().map_err(|error| error.to_string())?;
        if !metadata.is_file() || metadata.len() > 1024 * 1024 {
            return Err("Invalid terminal ownership file; ownership retained".into());
        }
        let mut raw = String::new();
        file.read_to_string(&mut raw)
            .map_err(|error| error.to_string())?;
        let record: Record = serde_json::from_str(&raw)
            .map_err(|error| format!("Cannot parse terminal ownership: {error}"))?;
        if std::iter::once(&record.leader)
            .chain(&record.members)
            .any(|identity| identity.pid <= 0 || identity.seconds == 0)
        {
            return Err("Invalid terminal process identity; ownership retained".into());
        }
        Ok(Some(record))
    }

    pub fn write(&self, record: &Record) -> Result<(), String> {
        std::fs::create_dir_all(&self.directory).map_err(|error| error.to_string())?;
        let bytes = serde_json::to_vec(record).map_err(|error| error.to_string())?;
        let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)
            .map_err(|error| format!("Cannot stage terminal ownership: {error}"))?;
        temporary
            .write_all(&bytes)
            .and_then(|()| temporary.as_file().sync_all())
            .map_err(|error| format!("Cannot flush terminal ownership: {error}"))?;
        temporary
            .persist(self.file())
            .map_err(|error| format!("Cannot publish terminal ownership: {error}"))?;
        self.sync()
    }

    pub fn clear(&self, leader: &ProcessIdentity) -> Result<(), String> {
        match std::fs::remove_file(self.file()) {
            Ok(()) => self.sync()?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Cannot clear terminal ownership: {error}")),
        }
        super::super::children::confirm_terminal_ended(leader.pid as u32);
        Ok(())
    }

    fn sync(&self) -> Result<(), String> {
        File::open(&self.directory)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("Cannot synchronize terminal ownership: {error}"))
    }
}

impl Record {
    pub fn new(leader: ProcessIdentity) -> Self {
        Self {
            leader,
            members: vec![leader],
        }
    }

    /// Numeric session IDs alone are never sufficient after a host restart.
    fn verified(&self) -> bool {
        // An inspectable leader's exact birth proves its recorded ownership.
        // Saved jobs additionally have to remain in that original session.
        process_identity_including_zombies(self.leader.pid).as_ref() == Some(&self.leader)
            || self.members.iter().any(|identity| {
                process_identity_including_zombies(identity.pid).as_ref() == Some(identity)
                    && unsafe { libc::getsid(identity.pid) } == self.leader.pid
            })
    }

    pub fn end_jobs(
        &mut self,
        journal: Option<&Journal>,
        held_leader: bool,
        unavailable: bool,
    ) -> Result<(), String> {
        let mut persisted = match journal {
            Some(journal) => match journal.read()? {
                Some(saved) if saved.leader != self.leader => {
                    return Err("Terminal ownership changed; cleanup record retained".into());
                }
                Some(saved) => saved.members == self.members,
                None => false,
            },
            None => true,
        };
        let sid = self.leader.pid;
        let deadline = Instant::now() + Duration::from_secs(3);
        let force_at = Instant::now() + Duration::from_secs(1);
        loop {
            let members = session_members(sid)?;
            if members.is_empty() {
                return Ok(());
            }
            if !held_leader && !self.verified() {
                // The last job can exit between the census and birth check.
                // Confirm that empty state without ever signaling an unverified PID.
                if session_members(sid)?.is_empty() {
                    return Ok(());
                }
                return Err(
                    "Terminal ownership could not be verified; recovery record retained".into(),
                );
            }
            // Before any signal, preserve all verified job identities. An exited
            // leader may be reaped when this host dies; a saved job can anchor
            // the same session next time, including its other process groups.
            if !persisted || self.members != members {
                let updated = Self {
                    leader: self.leader,
                    members: members.clone(),
                };
                if let Some(journal) = journal {
                    journal.write(&updated)?;
                }
                *self = updated;
                persisted = true;
            }
            if unavailable || Instant::now() >= deadline {
                return Err("The terminal's managed jobs could not be confirmed ended".into());
            }
            for member in members {
                if super::process_identity(member.pid).as_ref() == Some(&member)
                    && unsafe { libc::getsid(member.pid) } == sid
                {
                    unsafe {
                        libc::kill(
                            member.pid,
                            if Instant::now() >= force_at {
                                libc::SIGKILL
                            } else {
                                libc::SIGTERM
                            },
                        );
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}
