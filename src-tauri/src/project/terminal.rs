//! The current editable project's terminal, independent of performance processes.

pub(crate) mod visibility;

use super::creation::{CreationAccess, Protection};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::VecDeque;
use std::fs::File;
use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const PACKET_BYTES: usize = 16 * 1024;
const QUEUE_BYTES: usize = 8 * PACKET_BYTES;
const POLL: Duration = Duration::from_millis(100);
static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);
mod ownership;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    pub id: String,
    pub identity: String,
    pub state: TerminalState,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Copy, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalState {
    Running,
    Exited,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TerminalPacket {
    pub session_id: String,
    pub sequence: u32,
    pub bytes: Vec<u8>,
    pub eof: bool,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

#[derive(Default)]
struct Output {
    bytes: VecDeque<u8>,
    sequence: u32,
    eof: bool,
    error: Option<String>,
}

#[derive(Default)]
struct Stream {
    output: Mutex<Output>,
    changed: Condvar,
    closed: AtomicBool,
}

struct OwnedProcess {
    child: Child,
    reaped: Option<ExitStatus>,
}

struct Session {
    id: String,
    identity: String,
    process: Mutex<OwnedProcess>,
    writer: Mutex<File>,
    stream: Arc<Stream>,
    reader: Mutex<Option<JoinHandle<()>>>,
    ownership: super::children::ManagedTerminalSession,
    journal: ownership::Journal,
    record: Mutex<ownership::Record>,
    startup_error: Mutex<Option<String>>,
    #[cfg(test)]
    cleanup_unavailable: Arc<AtomicBool>,
    read: Mutex<()>,
}

/// At most one session; byte consumers never hold the session/control lock.
#[derive(Clone)]
pub struct ProjectTerminalManager {
    inner: Arc<TerminalInner>,
}

struct TerminalInner {
    session: Mutex<Option<Arc<Session>>>,
    // Read and written while holding session, so a queued open cannot follow
    // a completed exit cleanup by admitting another shell.
    exiting: AtomicBool,
    journal: Result<ownership::Journal, String>,
    #[cfg(test)]
    cleanup_unavailable: Arc<AtomicBool>,
}

struct SpawnFailure {
    detail: String,
    owner: Option<Arc<Session>>,
}

impl From<String> for SpawnFailure {
    fn from(detail: String) -> Self {
        Self {
            detail,
            owner: None,
        }
    }
}

impl Drop for TerminalInner {
    fn drop(&mut self) {
        let active = self.session.get_mut().unwrap_or_else(|e| e.into_inner());
        if let Some(session) = active.as_ref() {
            if let Err(error) = session.shutdown() {
                log::error!("Project terminal cleanup was not confirmed: {error}");
                // Release a discarded view's descriptors/reader without claiming
                // the processes ended. Durable and port-protection ownership stay.
                if let Err(error) = session.stop_output() {
                    log::error!("Project terminal output cleanup failed: {error}");
                }
            }
        }
    }
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "The project terminal lock failed".into()
}

impl ProjectTerminalManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            inner: Arc::new(TerminalInner {
                session: Mutex::new(None),
                exiting: AtomicBool::new(false),
                journal: Ok(ownership::Journal::new(app_data_dir)),
                #[cfg(test)]
                cleanup_unavailable: Arc::new(AtomicBool::new(false)),
            }),
        }
    }

    pub fn unavailable(error: String) -> Self {
        Self {
            inner: Arc::new(TerminalInner {
                session: Mutex::new(None),
                exiting: AtomicBool::new(false),
                journal: Err(format!("Cannot locate terminal ownership storage: {error}")),
                #[cfg(test)]
                cleanup_unavailable: Arc::new(AtomicBool::new(false)),
            }),
        }
    }

    fn journal(&self) -> Result<&ownership::Journal, String> {
        self.inner.journal.as_ref().map_err(Clone::clone)
    }

    /// Called at startup and again before admission. Unverified records block
    /// only the terminal; they never become permission to signal a reused SID.
    pub fn recover(&self) -> Result<(), String> {
        let active = self.inner.session.lock().map_err(lock_error)?;
        if active.is_none() {
            self.recover_pending()?;
        }
        Ok(())
    }

    fn recover_pending(&self) -> Result<(), String> {
        let journal = self.journal()?;
        if let Some(mut record) = journal.read()? {
            record.end_jobs(Some(journal), false, false)?;
            // A previous owner in this host may have dropped an unreaped Child.
            // On a new host ECHILD is expected; live jobs have already ended.
            if process_identity_including_zombies(record.leader.pid).as_ref()
                == Some(&record.leader)
            {
                unsafe {
                    libc::waitpid(record.leader.pid, std::ptr::null_mut(), libc::WNOHANG);
                }
            }
            journal.clear(&record.leader)?;
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn simulate_unconfirmed_cleanup(&self) {
        self.inner
            .cleanup_unavailable
            .store(true, Ordering::Release);
    }

    pub fn open(
        &self,
        access: &CreationAccess,
        identity: &str,
        protection: &Protection,
        cols: u16,
        rows: u16,
    ) -> Result<TerminalSession, String> {
        let directory = access
            .terminal_directory(identity, protection)
            .map_err(|e| e.detail)?;
        let mut active = self.inner.session.lock().map_err(lock_error)?;
        if self.inner.exiting.load(Ordering::Acquire) {
            return Err("The app is exiting; a new project terminal cannot be opened".into());
        }
        if let Some(session) = active.as_ref() {
            if session.identity != identity {
                return Err("End the previous project's terminal first".into());
            }
            if let Some(error) = session.startup_error.lock().map_err(lock_error)?.as_ref() {
                return Err(error.clone());
            }
            return session.snapshot();
        }
        self.recover_pending()?;
        let session = match Session::spawn(
            identity,
            directory,
            cols,
            rows,
            self.journal()?.clone(),
            #[cfg(test)]
            self.inner.cleanup_unavailable.clone(),
        ) {
            Ok(session) => session,
            Err(failure) => {
                if let Some(owner) = failure.owner.as_ref() {
                    *owner.startup_error.lock().map_err(lock_error)? = Some(failure.detail.clone());
                }
                *active = failure.owner;
                return Err(failure.detail);
            }
        };
        let snapshot = match session.snapshot() {
            Ok(snapshot) => snapshot,
            Err(error) => {
                if let Err(cleanup) = session.shutdown() {
                    *active = Some(session);
                    return Err(format!("{error}; terminal cleanup failed: {cleanup}"));
                }
                return Err(error);
            }
        };
        *active = Some(session);
        Ok(snapshot)
    }

    pub fn get(&self, identity: &str) -> Result<Option<TerminalSession>, String> {
        let active = self.inner.session.lock().map_err(lock_error)?;
        match active.as_ref() {
            Some(session) if session.identity == identity => session.snapshot().map(Some),
            Some(_) => Err("The project terminal belongs to another project".into()),
            None => Ok(None),
        }
    }

    /// Native App exit must confirm any retained owner, including exited shells.
    pub fn owner(&self) -> Result<Option<TerminalSession>, String> {
        self.inner
            .session
            .lock()
            .map_err(lock_error)?
            .as_ref()
            .map(|session| session.snapshot())
            .transpose()
    }

    fn session(&self, identity: &str, id: &str) -> Result<Arc<Session>, String> {
        self.inner
            .session
            .lock()
            .map_err(lock_error)?
            .as_ref()
            .filter(|s| s.identity == identity && s.id == id)
            .cloned()
            .ok_or_else(|| "The project terminal session expired".into())
    }

    pub fn read(&self, identity: &str, id: &str) -> Result<TerminalPacket, String> {
        let session = self.session(identity, id)?;
        let _read = session
            .read
            .try_lock()
            .map_err(|_| "A terminal read is already pending")?;
        let mut output = session.stream.output.lock().map_err(lock_error)?;
        if output.bytes.is_empty() && !output.eof && !session.stream.closed.load(Ordering::Acquire)
        {
            output = session
                .stream
                .changed
                .wait_timeout(output, POLL)
                .map_err(lock_error)?
                .0;
        }
        if session.stream.closed.load(Ordering::Acquire) {
            return Err("The project terminal session ended".into());
        }
        let count = output.bytes.len().min(PACKET_BYTES);
        let bytes = output.bytes.drain(..count).collect();
        output.sequence = output.sequence.wrapping_add(1);
        let mut packet = TerminalPacket {
            session_id: session.id.clone(),
            sequence: output.sequence,
            bytes,
            eof: output.eof && output.bytes.is_empty(),
            exit_code: None,
            error: output.error.clone(),
        };
        drop(output);
        session.stream.changed.notify_all();
        packet.exit_code = session.snapshot()?.exit_code;
        Ok(packet)
    }

    pub fn write(&self, identity: &str, id: &str, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() > 64 * 1024 {
            return Err("Terminal input exceeds 64 KiB per write".into());
        }
        let session = self.session(identity, id)?;
        let mut writer = session.writer.lock().map_err(lock_error)?;
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut remaining = bytes;
        while !remaining.is_empty() {
            if session.stream.closed.load(Ordering::Acquire) {
                return Err("The project terminal session ended".into());
            }
            match writer.write(remaining) {
                Ok(0) => return Err("The project terminal input closed".into()),
                Ok(count) => remaining = &remaining[count..],
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error)
                    if error.kind() == io::ErrorKind::WouldBlock && Instant::now() < deadline =>
                {
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(error) => return Err(error.to_string()),
            }
        }
        Ok(())
    }

    pub fn resize(&self, identity: &str, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let size = size(cols, rows)?;
        let session = self.session(identity, id)?;
        let master = session.writer.lock().map_err(lock_error)?;
        // SAFETY: the live master fd and initialized winsize remain valid during ioctl.
        if unsafe { libc::ioctl(master.as_raw_fd(), libc::TIOCSWINSZ, &size) } == -1 {
            return Err(io::Error::last_os_error().to_string());
        }
        Ok(())
    }

    pub fn close(&self, identity: &str, id: &str) -> Result<(), String> {
        let mut active = self.inner.session.lock().map_err(lock_error)?;
        let Some(session) = active.as_ref() else {
            return Ok(());
        };
        if session.identity != identity || session.id != id {
            return Err("The project terminal session expired".into());
        }
        session.shutdown()?;
        *active = None;
        Ok(())
    }

    /// Close admission and retire the current owner under one control lock.
    pub fn prepare_exit(&self) -> Result<(), String> {
        let mut active = self.inner.session.lock().map_err(lock_error)?;
        self.inner.exiting.store(true, Ordering::Release);
        if let Some(session) = active.as_ref() {
            if let Err(error) = session.shutdown() {
                self.inner.exiting.store(false, Ordering::Release);
                return Err(error);
            }
            *active = None;
        }
        Ok(())
    }

    /// A later native cleanup barrier failed; the retained App may be used again.
    pub fn resume_after_failed_exit(&self) {
        let _active = self
            .inner
            .session
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        self.inner.exiting.store(false, Ordering::Release);
    }

    pub fn shutdown(&self) -> Result<(), String> {
        self.prepare_exit()
    }
}

fn size(cols: u16, rows: u16) -> Result<libc::winsize, String> {
    if cols == 0 || rows == 0 || cols > 1000 || rows > 1000 {
        return Err("Terminal dimensions must be between 1 and 1000".into());
    }
    Ok(libc::winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    })
}

impl Session {
    fn spawn(
        identity: &str,
        directory: File,
        cols: u16,
        rows: u16,
        journal: ownership::Journal,
        #[cfg(test)] cleanup_unavailable: Arc<AtomicBool>,
    ) -> Result<Arc<Self>, SpawnFailure> {
        let mut size = size(cols, rows)?;
        let mut master = -1;
        let mut slave = -1;
        // SAFETY: openpty initializes both owned descriptors or returns an error.
        if unsafe {
            libc::openpty(
                &mut master,
                &mut slave,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut size,
            )
        } == -1
        {
            return Err(io::Error::last_os_error().to_string().into());
        }
        // SAFETY: openpty returned new descriptors, each adopted exactly once.
        let (master, slave) = unsafe { (File::from_raw_fd(master), File::from_raw_fd(slave)) };
        for fd in [master.as_raw_fd(), slave.as_raw_fd()] {
            if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } == -1 {
                return Err(io::Error::last_os_error().to_string().into());
            }
        }
        if unsafe { libc::fcntl(master.as_raw_fd(), libc::F_SETFL, libc::O_NONBLOCK) } == -1 {
            return Err(io::Error::last_os_error().to_string().into());
        }
        #[cfg(not(test))]
        let shell = std::env::var_os("SHELL")
            .filter(|s| std::path::Path::new(s).is_absolute())
            .unwrap_or_else(|| "/bin/zsh".into());
        #[cfg(test)]
        let shell = "/bin/zsh";
        let mut command = Command::new(shell);
        #[cfg(test)]
        command.args(["-d", "-f", "-i"]);
        #[cfg(not(test))]
        command.args(["-l", "-i"]);
        command
            .env("TERM", "xterm-256color")
            .env("COLORTERM", "truecolor")
            .stdin(Stdio::from(slave.try_clone().map_err(|e| e.to_string())?))
            .stdout(Stdio::from(slave.try_clone().map_err(|e| e.to_string())?))
            .stderr(Stdio::from(slave));
        let directory_fd = directory.as_raw_fd();
        // SAFETY: only async-signal-safe syscalls run in the forked child.
        unsafe {
            command.pre_exec(move || {
                if libc::setsid() == -1
                    || libc::ioctl(0, libc::TIOCSCTTY.into(), 0) == -1
                    || libc::fchdir(directory_fd) == -1
                {
                    return Err(io::Error::last_os_error());
                }
                for signal in [
                    libc::SIGINT,
                    libc::SIGQUIT,
                    libc::SIGTERM,
                    libc::SIGHUP,
                    libc::SIGTSTP,
                    libc::SIGTTIN,
                    libc::SIGTTOU,
                ] {
                    libc::signal(signal, libc::SIG_DFL);
                }
                Ok(())
            });
        }
        let reader = master.try_clone().map_err(|e| e.to_string())?;
        let (child, ownership) =
            super::children::spawn_terminal(&mut command).map_err(|e| e.to_string())?;
        let leader = process_identity_including_zombies(child.id() as libc::pid_t);
        let record = ownership::Record::new(leader.unwrap_or(ProcessIdentity {
            pid: child.id() as libc::pid_t,
            seconds: 0,
            microseconds: 0,
        }));
        let registration = match leader {
            Some(leader) if leader.seconds > 0 => journal.write(&record),
            _ => Err("Cannot verify terminal shell ownership".into()),
        };
        drop(command);
        drop(directory);
        let stream = Arc::new(Stream::default());
        let output = stream.clone();
        let session = Arc::new(Self {
            id: format!(
                "{}-{}",
                std::process::id(),
                NEXT_SESSION.fetch_add(1, Ordering::Relaxed)
            ),
            identity: identity.into(),
            process: Mutex::new(OwnedProcess {
                child,
                reaped: None,
            }),
            writer: Mutex::new(master),
            stream,
            reader: Mutex::new(None),
            ownership,
            journal,
            record: Mutex::new(record),
            startup_error: Mutex::new(None),
            #[cfg(test)]
            cleanup_unavailable,
            read: Mutex::new(()),
        });
        if let Err(error) = registration {
            // Startup files can create jobs before the session is returned.
            // If disk registration fails, still try bounded full-session
            // rollback, retaining the actual owner when it is unconfirmed.
            return Err(match session.shutdown_with_journal(None) {
                Ok(()) => error.into(),
                Err(cleanup) => SpawnFailure {
                    detail: format!("{error}; terminal startup cleanup unconfirmed: {cleanup}"),
                    owner: Some(session),
                },
            });
        }
        match std::thread::Builder::new()
            .name("project-terminal-output".into())
            .spawn(move || read_output(reader, output))
        {
            Ok(reader) => *session.reader.lock().map_err(lock_error)? = Some(reader),
            Err(error) => {
                return Err(match session.shutdown() {
                    Ok(()) => error.to_string().into(),
                    Err(cleanup) => SpawnFailure {
                        detail: format!("{error}; terminal cleanup unconfirmed: {cleanup}"),
                        owner: Some(session),
                    },
                });
            }
        }
        Ok(session)
    }

    fn snapshot(&self) -> Result<TerminalSession, String> {
        let process = self.process.lock().map_err(lock_error)?;
        if let Some(status) = process.reaped {
            return Ok(TerminalSession {
                id: self.id.clone(),
                identity: self.identity.clone(),
                state: TerminalState::Exited,
                exit_code: status
                    .code()
                    .or_else(|| status.signal().map(|signal| 128 + signal)),
            });
        }
        let mut status = std::mem::MaybeUninit::<libc::siginfo_t>::zeroed();
        // Keep the exited leader unreaped until every managed job has ended.
        // Its reserved PID anchors session ownership after ordinary shell exit.
        if unsafe {
            libc::waitid(
                libc::P_PID,
                process.child.id(),
                status.as_mut_ptr(),
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            )
        } == -1
        {
            return Err(io::Error::last_os_error().to_string());
        }
        let status = unsafe { status.assume_init() };
        let exited = status.si_pid != 0;
        Ok(TerminalSession {
            id: self.id.clone(),
            identity: self.identity.clone(),
            state: if exited {
                TerminalState::Exited
            } else {
                TerminalState::Running
            },
            exit_code: exited.then_some(if status.si_code == libc::CLD_EXITED {
                status.si_status
            } else {
                128 + status.si_status
            }),
        })
    }

    fn shutdown(&self) -> Result<(), String> {
        self.shutdown_with_journal(Some(&self.journal))
    }

    fn shutdown_with_journal(&self, journal: Option<&ownership::Journal>) -> Result<(), String> {
        if self.stream.closed.load(Ordering::Acquire) {
            return Ok(());
        }
        let mut process = self.process.lock().map_err(lock_error)?;
        let mut record = self.record.lock().map_err(lock_error)?;
        #[cfg(test)]
        let unavailable = self.cleanup_unavailable.load(Ordering::Acquire);
        #[cfg(not(test))]
        let unavailable = false;
        // The unreaped Child reserves the leader PID even when Darwin cannot
        // inspect its zombie birth. Recovered owners need a saved live anchor.
        record.end_jobs(journal, process.reaped.is_none(), unavailable)?;
        let deadline = Instant::now() + Duration::from_secs(3);
        while process.reaped.is_none() {
            process.reaped = process
                .child
                .try_wait()
                .map_err(|error| error.to_string())?;
            if process.reaped.is_some() {
                break;
            }
            if Instant::now() >= deadline {
                return Err("The terminal shell could not be reaped".into());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        drop(process);
        if let Some(journal) = journal {
            journal.clear(&record.leader)?;
        } else {
            // A failed first registration may never have published a file.
            // All jobs are now confirmed ended even if disk remains unusable.
            let _ = self.journal.clear(&record.leader);
        }
        self.ownership.confirm_ended();
        self.stop_output()
    }

    fn stop_output(&self) -> Result<(), String> {
        self.stream.closed.store(true, Ordering::Release);
        self.stream.changed.notify_all();
        if let Some(reader) = self.reader.lock().map_err(lock_error)?.take() {
            reader
                .join()
                .map_err(|_| "The terminal output reader failed")?;
        }
        Ok(())
    }
}

fn read_output(mut reader: File, stream: Arc<Stream>) {
    let mut buffer = [0; PACKET_BYTES];
    loop {
        let mut poll = libc::pollfd {
            fd: reader.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        // A finite poll keeps idle readers asleep and bounds explicit shutdown.
        let ready = unsafe { libc::poll(&mut poll, 1, POLL.as_millis() as i32) };
        if ready == 0 && !stream.closed.load(Ordering::Acquire) {
            continue;
        }
        let mut output = stream.output.lock().unwrap_or_else(|e| e.into_inner());
        while output.bytes.len() == QUEUE_BYTES && !stream.closed.load(Ordering::Acquire) {
            output = stream
                .changed
                .wait_timeout(output, POLL)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
        if stream.closed.load(Ordering::Acquire) {
            return;
        }
        let available = (QUEUE_BYTES - output.bytes.len()).min(buffer.len());
        match reader.read(&mut buffer[..available]) {
            Ok(0) => {
                output.eof = true;
                stream.changed.notify_all();
                return;
            }
            Ok(count) => {
                output.bytes.extend(&buffer[..count]);
                stream.changed.notify_all();
            }
            Err(error)
                if error.kind() == io::ErrorKind::WouldBlock
                    || error.kind() == io::ErrorKind::Interrupted =>
            {
                drop(output);
            }
            Err(error) => {
                output.eof = true;
                if error.raw_os_error() != Some(libc::EIO) {
                    output.error = Some(error.to_string());
                }
                stream.changed.notify_all();
                return;
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
struct ProcessIdentity {
    pid: libc::pid_t,
    seconds: u64,
    microseconds: u64,
}

#[cfg(target_os = "macos")]
fn process_identity(pid: libc::pid_t) -> Option<ProcessIdentity> {
    process_info(pid)
        .filter(|(_, zombie)| !zombie)
        .map(|(identity, _)| identity)
}

fn process_identity_including_zombies(pid: libc::pid_t) -> Option<ProcessIdentity> {
    process_info(pid).map(|(identity, _)| identity)
}

#[cfg(target_os = "macos")]
fn process_info(pid: libc::pid_t) -> Option<(ProcessIdentity, bool)> {
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    if unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        )
    } != size
    {
        return None;
    }
    let info = unsafe { info.assume_init() };
    Some((
        ProcessIdentity {
            pid,
            seconds: info.pbi_start_tvsec,
            microseconds: info.pbi_start_tvusec,
        },
        info.pbi_status == libc::SZOMB,
    ))
}

#[cfg(target_os = "macos")]
fn session_members(sid: libc::pid_t) -> Result<Vec<ProcessIdentity>, String> {
    if sid <= 0 || sid == unsafe { libc::getsid(0) } {
        return Err("Invalid terminal process ownership".into());
    }
    let needed = unsafe { libc::proc_listpids(1, 0, std::ptr::null_mut(), 0) };
    if needed <= 0 {
        return Err("Terminal process enumeration failed".into());
    }
    let mut pids = vec![0_i32; needed as usize / std::mem::size_of::<i32>() + 1024];
    let size = std::mem::size_of_val(pids.as_slice()) as i32;
    let count = unsafe { libc::proc_listpids(1, 0, pids.as_mut_ptr().cast(), size) };
    if count <= 0 || count >= size {
        return Err("Terminal process enumeration was incomplete".into());
    }
    let mut members = Vec::new();
    for &pid in &pids[..count as usize / std::mem::size_of::<i32>()] {
        if pid <= 0 || unsafe { libc::getsid(pid) } != sid {
            continue;
        }
        let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
        if unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                info.as_mut_ptr().cast(),
                size,
            )
        } != size
        {
            if unsafe { libc::getsid(pid) } == sid {
                return Err("A terminal job's identity could not be verified".into());
            }
            continue;
        }
        let info = unsafe { info.assume_init() };
        if info.pbi_status != libc::SZOMB {
            members.push(ProcessIdentity {
                pid,
                seconds: info.pbi_start_tvsec,
                microseconds: info.pbi_start_tvusec,
            });
        }
    }
    members.sort_unstable_by_key(|member| member.pid);
    Ok(members)
}

#[cfg(test)]
mod tests;
