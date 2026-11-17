//! Failure-only snapshots for real test-owned TCP listener handoffs.
use std::net::SocketAddr;
use std::process::Command;

pub(crate) fn tcp_endpoint_snapshot(actual: SocketAddr) -> String {
    let listening = crate::project::ports::query_listening_pids(actual.port());
    let selector = format!("-iTCP:{}", actual.port());
    let lsof = Command::new("/usr/sbin/lsof")
        .args(["-nP", "-w", &selector])
        .output()
        .map(|output| {
            format!(
                "exit={:?}; stdout={}; stderr={}",
                output.status.code(),
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            )
        })
        .unwrap_or_else(|error| format!("lsof failed: {error}"));
    let local = format!("{}.{}", actual.ip(), actual.port());
    let port_suffix = format!(".{}", actual.port());
    let states = Command::new("/usr/sbin/netstat")
        .args(["-anv", "-p", "tcp"])
        .output()
        .map(|output| {
            let rows = String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter(|line| {
                    line.split_whitespace().nth(3).is_some_and(|endpoint| {
                        if actual.ip().is_unspecified() {
                            endpoint.ends_with(&port_suffix)
                        } else {
                            endpoint == local
                                || endpoint == format!("*{port_suffix}")
                                || endpoint == format!("0.0.0.0{port_suffix}")
                        }
                    })
                })
                .map(str::to_owned)
                .collect::<Vec<_>>();
            format!(
                "exit={:?}; local endpoint rows={rows:?}; stderr={}",
                output.status.code(),
                String::from_utf8_lossy(&output.stderr)
            )
        })
        .unwrap_or_else(|error| format!("netstat failed: {error}"));
    format!("LISTEN PIDs={listening:?}; all TCP lsof={lsof}; kernel TCP states={states}")
}
