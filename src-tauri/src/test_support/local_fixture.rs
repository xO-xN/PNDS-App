use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::TcpListener;
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

const READY_TIMEOUT: Duration = Duration::from_secs(5);
const STOP_TIMEOUT: Duration = Duration::from_secs(3);
const FORCE_STOP_TIMEOUT: Duration = Duration::from_secs(1);
const PROBE_TIMEOUT: Duration = Duration::from_millis(300);
const POLL_INTERVAL: Duration = Duration::from_millis(25);
const OUTPUT_TAIL_BYTES: u64 = 16 * 1024;
const HEALTH_MAX_BYTES: usize = 64 * 1024;

// This coordinates only callers of FixturePorts in this test process. The
// numbers remain registered after releasing the listeners for the real server;
// no mutex spans startup or a complete test. Foreign processes can still win
// that handoff, which must remain a reported failure rather than a hidden retry.
static FIXTURE_PORTS: LazyLock<Mutex<HashSet<u16>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

fn automatic_tcp_port_ranges() -> std::io::Result<Vec<std::ops::RangeInclusive<u16>>> {
    #[cfg(target_os = "macos")]
    {
        fn value(name: &std::ffi::CStr) -> std::io::Result<u16> {
            let mut port: libc::c_int = 0;
            let mut length = std::mem::size_of_val(&port);
            // SAFETY: the output points to a live integer with its exact size;
            // a null new-value pointer makes this a read-only kernel query.
            if unsafe {
                libc::sysctlbyname(
                    name.as_ptr(),
                    std::ptr::from_mut(&mut port).cast(),
                    &mut length,
                    std::ptr::null_mut(),
                    0,
                )
            } != 0
            {
                return Err(std::io::Error::last_os_error());
            }
            if length != std::mem::size_of_val(&port) {
                return Err(std::io::Error::other("Unexpected TCP port-range size"));
            }
            u16::try_from(port).map_err(std::io::Error::other)
        }
        let first = value(c"net.inet.ip.portrange.first")?;
        let last = value(c"net.inet.ip.portrange.last")?;
        let high_first = value(c"net.inet.ip.portrange.hifirst")?;
        let high_last = value(c"net.inet.ip.portrange.hilast")?;
        let low_first = value(c"net.inet.ip.portrange.lowfirst")?;
        let low_last = value(c"net.inet.ip.portrange.lowlast")?;
        Ok(vec![
            first.min(last)..=first.max(last),
            high_first.min(high_last)..=high_first.max(high_last),
            low_first.min(low_last)..=low_first.max(low_last),
        ])
    }
    #[cfg(not(target_os = "macos"))]
    {
        let values = std::fs::read_to_string("/proc/sys/net/ipv4/ip_local_port_range")?;
        let ports: Vec<u16> = values
            .split_whitespace()
            .map(str::parse)
            .collect::<Result<_, _>>()
            .map_err(std::io::Error::other)?;
        match ports.as_slice() {
            [first, last] => Ok(vec![*first.min(last)..=*first.max(last)]),
            _ => Err(std::io::Error::other("Unexpected TCP port range")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FixturePhase {
    Ports,
    Spawn,
    Ready,
    GracefulStop,
    Cleanup,
}

#[derive(Debug)]
pub(crate) struct FixtureFailure {
    pub(crate) phase: FixturePhase,
    diagnostics: Box<FixtureDiagnostics>,
}

#[derive(Debug)]
pub(crate) struct FixtureDiagnostics {
    pub(crate) label: &'static str,
    pub(crate) ports: Vec<u16>,
    pub(crate) exit: Option<ExitStatus>,
    pub(crate) last_probe: Option<String>,
    pub(crate) stdout_tail: String,
    pub(crate) stderr_tail: String,
    pub(crate) cleanup_errors: Vec<String>,
}

impl FixtureFailure {
    fn new(
        phase: FixturePhase,
        label: &'static str,
        ports: &[u16],
        detail: impl Into<String>,
    ) -> Self {
        Self {
            phase,
            diagnostics: Box::new(FixtureDiagnostics {
                label,
                ports: ports.to_vec(),
                exit: None,
                last_probe: Some(detail.into()),
                stdout_tail: String::new(),
                stderr_tail: String::new(),
                cleanup_errors: Vec::new(),
            }),
        }
    }
}

impl std::ops::Deref for FixtureFailure {
    type Target = FixtureDiagnostics;

    fn deref(&self) -> &Self::Target {
        &self.diagnostics
    }
}

impl std::fmt::Display for FixtureFailure {
    fn fmt(&self, output: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            output,
            "{} fixture failed in {:?}; ports={:?}; exit={:?}",
            self.label, self.phase, self.ports, self.exit
        )?;
        if let Some(probe) = &self.last_probe {
            write!(output, "\nlast observation: {probe}")?;
        }
        if !self.stdout_tail.is_empty() {
            write!(output, "\nstdout tail:\n{}", self.stdout_tail)?;
        }
        if !self.stderr_tail.is_empty() {
            write!(output, "\nstderr tail:\n{}", self.stderr_tail)?;
        }
        if !self.cleanup_errors.is_empty() {
            write!(output, "\ncleanup: {}", self.cleanup_errors.join("; "))?;
        }
        Ok(())
    }
}

impl std::error::Error for FixtureFailure {}

#[derive(Debug)]
pub(crate) struct FixturePorts<const N: usize> {
    label: &'static str,
    values: [u16; N],
    listeners: Vec<TcpListener>,
}

impl<const N: usize> FixturePorts<N> {
    pub(crate) fn reserve(label: &'static str) -> Result<Self, FixtureFailure> {
        // A numerical lease cannot stop the kernel assigning a released :0
        // port to another test's listener or outbound client. Keep handed-off
        // server ports outside the actual automatic pools instead.
        let automatic = automatic_tcp_port_ranges().map_err(|error| {
            FixtureFailure::new(FixturePhase::Ports, label, &[], error.to_string())
        })?;
        let mut registered = FIXTURE_PORTS
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut values = [0; N];
        let mut listeners = Vec::with_capacity(N);
        for value in &mut values {
            let mut selected = None;
            for port in (10240..=u16::MAX).chain(1024..10240) {
                if registered.contains(&port) || automatic.iter().any(|range| range.contains(&port))
                {
                    continue;
                }
                match TcpListener::bind(("127.0.0.1", port)) {
                    Ok(listener) => {
                        selected = Some((port, listener));
                        break;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => {}
                    Err(error) => {
                        return Err(FixtureFailure::new(
                            FixturePhase::Ports,
                            label,
                            &[port],
                            error.to_string(),
                        ));
                    }
                }
            }
            let Some((port, listener)) = selected else {
                return Err(FixtureFailure::new(
                    FixturePhase::Ports,
                    label,
                    &[],
                    "Could not select a fixture port outside the kernel automatic pools",
                ));
            };
            *value = port;
            listeners.push(listener);
        }
        registered.extend(values);
        Ok(Self {
            label,
            values,
            listeners,
        })
    }

    pub(crate) fn values(&self) -> [u16; N] {
        self.values
    }

    pub(crate) fn release_for_start(&mut self) {
        self.listeners.clear();
    }
}

impl<const N: usize> Drop for FixturePorts<N> {
    fn drop(&mut self) {
        let mut registered = FIXTURE_PORTS
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        for port in self.values {
            registered.remove(&port);
        }
    }
}

#[derive(Debug)]
pub(crate) struct HealthPair {
    pub(crate) performer: serde_json::Value,
    pub(crate) monitor: serde_json::Value,
}

#[derive(Debug)]
pub(crate) struct CleanupReceipt {
    pub(crate) process_reaped: bool,
    pub(crate) ports_released: bool,
}

pub(crate) struct OwnedNodeFixture {
    ports: FixturePorts<2>,
    child: Option<Child>,
    exit: Option<ExitStatus>,
    output: tempfile::TempDir,
    client: reqwest::Client,
    ready_timeout: Duration,
    stop_timeout: Duration,
}

impl OwnedNodeFixture {
    pub(crate) fn spawn(ports: FixturePorts<2>, command: Command) -> Result<Self, FixtureFailure> {
        Self::spawn_with_timeouts(ports, command, READY_TIMEOUT, STOP_TIMEOUT)
    }

    pub(crate) fn spawn_with_timeouts(
        mut ports: FixturePorts<2>,
        mut command: Command,
        ready_timeout: Duration,
        stop_timeout: Duration,
    ) -> Result<Self, FixtureFailure> {
        let failure = |detail: String| {
            FixtureFailure::new(FixturePhase::Spawn, ports.label, &ports.values, detail)
        };
        let output = tempfile::tempdir().map_err(|error| failure(error.to_string()))?;
        let stdout = File::create(output.path().join("stdout"))
            .map_err(|error| failure(error.to_string()))?;
        let stderr = File::create(output.path().join("stderr"))
            .map_err(|error| failure(error.to_string()))?;
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(PROBE_TIMEOUT)
            .build()
            .map_err(|error| failure(error.to_string()))?;
        command
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));
        ports.release_for_start();
        let child = command.spawn().map_err(|error| {
            FixtureFailure::new(
                FixturePhase::Spawn,
                ports.label,
                &ports.values,
                error.to_string(),
            )
        })?;
        Ok(Self {
            ports,
            child: Some(child),
            exit: None,
            output,
            client,
            ready_timeout,
            stop_timeout,
        })
    }

    pub(crate) fn client(&self) -> &reqwest::Client {
        &self.client
    }

    pub(crate) async fn ready(&mut self) -> Result<HealthPair, FixtureFailure> {
        let deadline = Instant::now() + self.ready_timeout;
        let mut health = Vec::with_capacity(2);
        for port in self.ports.values {
            let mut last_probe = format!("Waiting for health on {port}");
            loop {
                match self.try_exit() {
                    Ok(Some(_)) => {
                        return Err(
                            self.failure(FixturePhase::Ready, "Child exited before readiness")
                        )
                    }
                    Err(error) => return Err(self.failure(FixturePhase::Ready, error.to_string())),
                    Ok(None) => {}
                }
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(self.failure(FixturePhase::Ready, last_probe));
                }
                match self.health(port, remaining.min(PROBE_TIMEOUT)).await {
                    Ok(value) if value["status"] == "ready" => {
                        health.push(value);
                        break;
                    }
                    Ok(value) => last_probe = format!("Health on {port} is not ready: {value}"),
                    Err(error) => last_probe = format!("Health on {port}: {error}"),
                }
                let remaining = deadline.saturating_duration_since(Instant::now());
                tokio::time::sleep(remaining.min(POLL_INTERVAL)).await;
            }
        }
        Ok(HealthPair {
            performer: health.remove(0),
            monitor: health.remove(0),
        })
    }

    async fn health(&self, port: u16, timeout: Duration) -> Result<serde_json::Value, String> {
        let mut response = self
            .client
            .get(format!("http://127.0.0.1:{port}/__pnds/health"))
            .timeout(timeout)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|error| error.to_string())?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
            if bytes.len() + chunk.len() > HEALTH_MAX_BYTES {
                return Err("Health response exceeded its fixture bound".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|error| error.to_string())
    }

    pub(crate) async fn finish(&mut self) -> Result<CleanupReceipt, FixtureFailure> {
        let deadline = Instant::now() + self.stop_timeout;
        match self.try_exit() {
            Ok(Some(_)) => {}
            Ok(None) => {
                let child = self.child.as_ref().expect("live child is present");
                let result = unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGTERM) };
                if result != 0 {
                    let reason = std::io::Error::last_os_error();
                    if reason.raw_os_error() != Some(libc::ESRCH) {
                        let cleanup_errors = self.force_stop().await;
                        let mut failure =
                            self.failure(FixturePhase::GracefulStop, reason.to_string());
                        failure.diagnostics.cleanup_errors = cleanup_errors;
                        return Err(failure);
                    }
                }
            }
            Err(error) => {
                let cleanup_errors = self.force_stop().await;
                let mut failure = self.failure(FixturePhase::GracefulStop, error.to_string());
                failure.diagnostics.cleanup_errors = cleanup_errors;
                return Err(failure);
            }
        }
        loop {
            match self.try_exit() {
                Ok(Some(_)) => break,
                Err(error) => {
                    let cleanup_errors = self.force_stop().await;
                    let mut failure = self.failure(FixturePhase::GracefulStop, error.to_string());
                    failure.diagnostics.cleanup_errors = cleanup_errors;
                    return Err(failure);
                }
                Ok(None) if Instant::now() >= deadline => {
                    let cleanup_errors = self.force_stop().await;
                    let mut failure = self.failure(
                        FixturePhase::GracefulStop,
                        "Child did not exit during the graceful-stop deadline",
                    );
                    failure.diagnostics.cleanup_errors = cleanup_errors;
                    return Err(failure);
                }
                Ok(None) => tokio::time::sleep(POLL_INTERVAL).await,
            }
        }
        loop {
            match self.released_ports() {
                Ok(()) => {
                    return Ok(CleanupReceipt {
                        process_reaped: true,
                        ports_released: true,
                    })
                }
                Err(error) if Instant::now() >= deadline => {
                    return Err(self.failure(FixturePhase::Cleanup, error))
                }
                Err(_) => tokio::time::sleep(POLL_INTERVAL).await,
            }
        }
    }

    fn try_exit(&mut self) -> std::io::Result<Option<ExitStatus>> {
        if let Some(exit) = self.exit {
            return Ok(Some(exit));
        }
        let Some(child) = &mut self.child else {
            return Ok(None);
        };
        let exit = child.try_wait()?;
        if let Some(status) = exit {
            self.exit = Some(status);
            self.child = None;
        }
        Ok(exit)
    }

    async fn force_stop(&mut self) -> Vec<String> {
        let mut errors = Vec::new();
        if let Some(child) = &mut self.child {
            if let Err(error) = child.kill() {
                errors.push(format!("Forced child stop failed: {error}"));
            }
            let deadline = Instant::now() + FORCE_STOP_TIMEOUT;
            loop {
                match self.try_exit() {
                    Ok(Some(_)) => break,
                    Err(error) => {
                        errors.push(format!("Forced child reap failed: {error}"));
                        break;
                    }
                    Ok(None) if Instant::now() >= deadline => {
                        errors.push("Forced child reap timed out".into());
                        break;
                    }
                    Ok(None) => tokio::time::sleep(POLL_INTERVAL).await,
                }
            }
        }
        if let Err(error) = self.released_ports() {
            errors.push(error);
        }
        errors
    }

    fn released_ports(&self) -> Result<(), String> {
        let listeners: Result<Vec<_>, _> = self
            .ports
            .values
            .iter()
            .map(|port| {
                TcpListener::bind(("127.0.0.1", *port))
                    .map_err(|error| format!("Port {port} is not released: {error}"))
            })
            .collect();
        listeners.map(|_| ())
    }

    fn failure(&self, phase: FixturePhase, detail: impl Into<String>) -> FixtureFailure {
        let mut failure = FixtureFailure::new(phase, self.ports.label, &self.ports.values, detail);
        failure.diagnostics.exit = self.exit;
        failure.diagnostics.stdout_tail = output_tail(&self.output.path().join("stdout"));
        failure.diagnostics.stderr_tail = output_tail(&self.output.path().join("stderr"));
        failure
    }
}

impl Drop for OwnedNodeFixture {
    fn drop(&mut self) {
        let mut cleanup_errors = Vec::new();
        if self.child.is_some() && !matches!(self.try_exit(), Ok(Some(_))) {
            if let Some(child) = &mut self.child {
                if let Err(error) = child.kill() {
                    cleanup_errors.push(format!("Forced child stop in Drop failed: {error}"));
                }
            }
            let deadline = Instant::now() + FORCE_STOP_TIMEOUT;
            loop {
                match self.try_exit() {
                    Ok(Some(_)) => break,
                    Err(error) => {
                        cleanup_errors.push(format!("Child reap in Drop failed: {error}"));
                        break;
                    }
                    Ok(None) if Instant::now() >= deadline => {
                        cleanup_errors.push("Child reap timed out in Drop".into());
                        break;
                    }
                    Ok(None) => std::thread::sleep(POLL_INTERVAL),
                }
            }
        }
        if std::thread::panicking() {
            let snapshot = self.failure(FixturePhase::Cleanup, "Test assertion panicked");
            let _ = writeln!(
                std::io::stderr().lock(),
                "{} fixture diagnostics while unwinding; ports={:?}; exit={:?}; cleanup={cleanup_errors:?}\nstdout tail:\n{}\nstderr tail:\n{}",
                snapshot.label, snapshot.ports, snapshot.exit, snapshot.stdout_tail, snapshot.stderr_tail
            );
        } else if !cleanup_errors.is_empty() {
            let mut failure = self.failure(FixturePhase::Cleanup, "Drop could not confirm cleanup");
            failure.diagnostics.cleanup_errors = cleanup_errors;
            let _ = writeln!(std::io::stderr().lock(), "{failure}");
        }
    }
}

fn output_tail(path: &Path) -> String {
    let read = || -> std::io::Result<String> {
        let mut file = File::open(path)?;
        let length = file.metadata()?.len();
        file.seek(SeekFrom::Start(length.saturating_sub(OUTPUT_TAIL_BYTES)))?;
        let mut bytes = Vec::new();
        file.take(OUTPUT_TAIL_BYTES).read_to_end(&mut bytes)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    };
    read().unwrap_or_else(|error| format!("<output unavailable: {error}>"))
}

#[cfg(test)]
#[path = "local_fixture_tests.rs"]
mod tests;
