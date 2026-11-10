//! Versioned App-owned TCP listener handoff. Availability checks never reserve ports.
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::net::{Ipv4Addr, TcpListener};
use std::os::fd::{AsRawFd, RawFd};
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::process::CommandExt;
use std::process::Command;

pub(crate) struct RuntimePorts {
    sockets: Option<[TcpListener; 2]>,
    report_dir: tempfile::TempDir,
    assignment: Assignment,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Assignment {
    version: u32,
    run_id: String,
    report_path: String,
    services: [Service; 2],
}
#[derive(Serialize)]
struct Service {
    role: &'static str,
    port: u16,
    fd: RawFd,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Report {
    version: u32,
    run_id: String,
    status: String,
    #[serde(default)]
    services: Vec<ReportedService>,
    error: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReportedService {
    role: String,
    port: u16,
}

impl RuntimePorts {
    pub(crate) fn allocate(preferred: [u16; 2]) -> Result<Self, String> {
        let bind = |port| {
            super::ports::bind_available_listener(Ipv4Addr::UNSPECIFIED, port)
                .map_err(|error| format!("participation.errors.runtimePortsBind: {error}"))
        };
        let sockets = [bind(preferred[0])?, bind(preferred[1])?];
        let report_dir = tempfile::tempdir()
            .map_err(|error| format!("participation.errors.runtimePortsProtocol: {error}"))?;
        let mut random = [0u8; 32];
        ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut random).map_err(
            |_| "participation.errors.runtimePortsProtocol: random identity unavailable",
        )?;
        let run_id: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let services = std::array::from_fn(|index| Service {
            role: ["performer", "monitor"][index],
            port: sockets[index].local_addr().expect("bound listener").port(),
            fd: sockets[index].as_raw_fd(),
        });
        Ok(Self {
            assignment: Assignment {
                version: 1,
                run_id,
                report_path: report_dir
                    .path()
                    .join("bound.json")
                    .to_string_lossy()
                    .into_owned(),
                services,
            },
            report_dir,
            sockets: Some(sockets),
        })
    }

    pub(crate) fn ports(&self) -> [u16; 2] {
        self.assignment
            .services
            .each_ref()
            .map(|service| service.port)
    }
    pub(crate) fn run_id(&self) -> &str {
        &self.assignment.run_id
    }
    pub(crate) fn take_sockets(&mut self) -> Option<[TcpListener; 2]> {
        self.sockets.take()
    }

    /// The caller must hold the session lifecycle lock and retain both sockets
    /// through spawn. Only the child clears CLOEXEC; other child processes never
    /// inherit these listeners, including concurrent audio/compile launches.
    pub(crate) fn configure(&self, command: &mut Command) -> Result<(), String> {
        let json = serde_json::to_string(&self.assignment)
            .map_err(|error| format!("participation.errors.runtimePortsProtocol: {error}"))?;
        command.env("PNDS_RUNTIME_PORTS", json);
        let fds = self
            .assignment
            .services
            .each_ref()
            .map(|service| service.fd);
        // SAFETY: the fork child runs only async-signal-safe fcntl operations.
        // The session lock keeps these exact parent descriptors alive until spawn returns.
        unsafe {
            command.pre_exec(move || {
                for fd in fds {
                    let flags = libc::fcntl(fd, libc::F_GETFD);
                    if flags < 0 || libc::fcntl(fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) < 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                }
                Ok(())
            });
        }
        Ok(())
    }

    /// A report must be atomically published once both project servers adopted
    /// their inherited descriptors. No health request is made before this proof.
    pub(crate) fn reported(&self, pid: u32) -> Result<bool, String> {
        let path = self.report_dir.path().join("bound.json");
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => {
                return Err(format!(
                    "participation.errors.runtimePortsProtocol: {error}"
                ))
            }
        };
        if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 4096 {
            return Err("participation.errors.runtimePortsProtocol: invalid report file".into());
        }
        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
            .map_err(|error| format!("participation.errors.runtimePortsProtocol: {error}"))?;
        let mut bytes = Vec::new();
        file.take(4097)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("participation.errors.runtimePortsProtocol: {error}"))?;
        if bytes.len() > 4096 {
            return Err("participation.errors.runtimePortsProtocol: oversized report".into());
        }
        let report: Report = serde_json::from_slice(&bytes)
            .map_err(|error| format!("participation.errors.runtimePortsProtocol: {error}"))?;
        if report.version != 1 || report.run_id != self.assignment.run_id {
            return Err(
                "participation.errors.runtimePortsProtocol: mismatched run or version".into(),
            );
        }
        if report.status == "error" {
            return Err(format!(
                "participation.errors.runtimePortsProtocol: {}",
                report
                    .error
                    .as_deref()
                    .unwrap_or("project could not adopt listeners")
            ));
        }
        if report.status != "bound" || report.services.len() != 2 || report.error.is_some() {
            return Err(
                "participation.errors.runtimePortsProtocol: incomplete binding report".into(),
            );
        }
        for service in &self.assignment.services {
            if report
                .services
                .iter()
                .filter(|actual| actual.role == service.role && actual.port == service.port)
                .count()
                != 1
            {
                return Err(
                    "participation.errors.runtimePortsProtocol: mismatched role or port".into(),
                );
            }
            let owners = super::ports::listening_pids(service.port);
            if owners != [pid] {
                return Err(format!(
                    "participation.errors.runtimePortsOwnership: {}:{}",
                    service.role, service.port
                ));
            }
        }
        Ok(true)
    }
}
