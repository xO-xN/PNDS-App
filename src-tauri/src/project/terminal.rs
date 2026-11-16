//! The current editable project's terminal, independent of performance processes.

use super::creation::{CreationAccess, Protection};
use serde::Serialize;
use specta::Type;
use std::collections::VecDeque;
use std::fs::File;
use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const PACKET_BYTES: usize = 16 * 1024;
const QUEUE_BYTES: usize = 8 * PACKET_BYTES;
const POLL: Duration = Duration::from_millis(100);
static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

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

struct Session {
    id: String,
    identity: String,
    process: Mutex<Child>,
    writer: Mutex<File>,
    stream: Arc<Stream>,
    reader: Mutex<Option<JoinHandle<()>>>,
    _ownership: super::children::ManagedTerminalSession,
    read: Mutex<()>,
}

/// At most one session; byte consumers never hold the session/control lock.
#[derive(Clone, Default)]
pub struct ProjectTerminalManager {
    inner: Arc<TerminalInner>,
}

#[derive(Default)]
struct TerminalInner {
    session: Mutex<Option<Arc<Session>>>,
}

impl Drop for TerminalInner {
    fn drop(&mut self) {
        let active = self.session.get_mut().unwrap_or_else(|e| e.into_inner());
        if let Some(session) = active.as_ref() {
            if let Err(error) = session.shutdown() {
                log::error!("Project terminal cleanup was not confirmed: {error}");
            }
        }
    }
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "The project terminal lock failed".into()
}

impl ProjectTerminalManager {
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
        if let Some(session) = active.as_ref() {
            if session.identity != identity {
                return Err("End the previous project's terminal first".into());
            }
            return session.snapshot();
        }
        let session = Arc::new(Session::spawn(identity, directory, cols, rows)?);
        let snapshot = match session.snapshot() {
            Ok(snapshot) => snapshot,
            Err(error) => {
                session.shutdown()?;
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

    #[cfg(feature = "native-client-fixture")]
    pub fn shutdown(&self) -> Result<(), String> {
        let mut active = self.inner.session.lock().map_err(lock_error)?;
        if let Some(session) = active.as_ref() {
            session.shutdown()?;
            *active = None;
        }
        Ok(())
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
    fn spawn(identity: &str, directory: File, cols: u16, rows: u16) -> Result<Self, String> {
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
            return Err(io::Error::last_os_error().to_string());
        }
        // SAFETY: openpty returned new descriptors, each adopted exactly once.
        let (master, slave) = unsafe { (File::from_raw_fd(master), File::from_raw_fd(slave)) };
        for fd in [master.as_raw_fd(), slave.as_raw_fd()] {
            if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } == -1 {
                return Err(io::Error::last_os_error().to_string());
            }
        }
        if unsafe { libc::fcntl(master.as_raw_fd(), libc::F_SETFL, libc::O_NONBLOCK) } == -1 {
            return Err(io::Error::last_os_error().to_string());
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
        drop(command);
        drop(directory);
        let stream = Arc::new(Stream::default());
        let output = stream.clone();
        let session = Self {
            id: format!(
                "{}-{}",
                std::process::id(),
                NEXT_SESSION.fetch_add(1, Ordering::Relaxed)
            ),
            identity: identity.into(),
            process: Mutex::new(child),
            writer: Mutex::new(master),
            stream,
            reader: Mutex::new(None),
            _ownership: ownership,
            read: Mutex::new(()),
        };
        match std::thread::Builder::new()
            .name("project-terminal-output".into())
            .spawn(move || read_output(reader, output))
        {
            Ok(reader) => *session.reader.lock().map_err(lock_error)? = Some(reader),
            Err(error) => {
                session.shutdown()?;
                return Err(error.to_string());
            }
        }
        Ok(session)
    }

    fn snapshot(&self) -> Result<TerminalSession, String> {
        let child = self.process.lock().map_err(lock_error)?;
        let mut status = std::mem::MaybeUninit::<libc::siginfo_t>::zeroed();
        // Keep the exited leader unreaped until every managed job has ended.
        // Its reserved PID anchors session ownership after ordinary shell exit.
        if unsafe {
            libc::waitid(
                libc::P_PID,
                child.id(),
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
        if self.stream.closed.load(Ordering::Acquire) {
            return Ok(());
        }
        let mut child = self.process.lock().map_err(lock_error)?;
        let sid = child.id() as libc::pid_t;
        let deadline = Instant::now() + Duration::from_secs(3);
        let force_at = Instant::now() + Duration::from_secs(1);
        loop {
            let members = session_members(sid)?;
            if members.is_empty() {
                break;
            }
            if Instant::now() >= deadline {
                return Err("The terminal's managed jobs could not be confirmed ended".into());
            }
            for member in members {
                if process_identity(member.pid).is_some_and(|now| now == member)
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
        while child.try_wait().map_err(|e| e.to_string())?.is_none() {
            if Instant::now() >= deadline {
                return Err("The terminal shell could not be reaped".into());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        drop(child);
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

#[derive(PartialEq, Eq)]
struct ProcessIdentity {
    pid: libc::pid_t,
    seconds: u64,
    microseconds: u64,
}

#[cfg(target_os = "macos")]
fn process_identity(pid: libc::pid_t) -> Option<ProcessIdentity> {
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
    (info.pbi_status != libc::SZOMB).then_some(ProcessIdentity {
        pid,
        seconds: info.pbi_start_tvsec,
        microseconds: info.pbi_start_tvusec,
    })
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
    Ok(members)
}

#[cfg(test)]
mod tests;
