use super::*;
use std::collections::HashSet;
use std::net::TcpListener;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::process::Command;
use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};

const READY_NODE: &str = r#"
const http = require('node:http');
const ports = JSON.parse(process.env.PNDS_FIXTURE_PORTS);
const health = {
  status: 'ready', projectId: 'test-support-fixture', audioMode: 'none',
  audio: { status: 'disabled', target: null, error: null },
  scoreServer: { performerPort: ports[0], monitorPort: ports[1], error: null },
  fixtureNodePid: process.pid,
};
for (const port of ports) {
  http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(health));
  }).listen(port, '127.0.0.1');
}
"#;

fn node_command(ports: [u16; 2], script: &str) -> Command {
    let node = crate::project::session::node_binary_path()
        .expect("provisioned bundled Node for local fixture tests");
    let mut command = Command::new(node);
    command
        .arg("-e")
        .arg(script)
        .env("PNDS_FIXTURE_PORTS", serde_json::to_string(&ports).unwrap());
    command
}

fn failure<T>(result: Result<T, FixtureFailure>) -> FixtureFailure {
    match result {
        Ok(_) => panic!("fixture unexpectedly succeeded"),
        Err(error) => error,
    }
}

fn assert_ports_released(ports: [u16; 2]) {
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        let listeners: Option<Vec<_>> = ports
            .iter()
            .map(|port| TcpListener::bind(("127.0.0.1", *port)).ok())
            .collect();
        if listeners.is_some() {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "fixture retained ports {ports:?}"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn assert_process_gone(pid: u32) {
    let pid = i32::try_from(pid).unwrap();
    // SAFETY: signal zero only observes the PID reported by this owned fixture.
    assert_ne!(
        unsafe { libc::kill(pid, 0) },
        0,
        "fixture process {pid} survived"
    );
}

#[test]
fn server_leases_do_not_share_the_kernels_automatic_tcp_port_pool() {
    let automatic = automatic_tcp_port_ranges().unwrap();
    let mut lease = FixturePorts::<2>::reserve("outside-automatic-pool").unwrap();
    let values = lease.values();
    lease.release_for_start();
    for port in values {
        assert!(
            automatic.iter().all(|range| !range.contains(&port)),
            "released server lease {port} can be reused by an automatic listener or client: {automatic:?}"
        );
        // The allocator's listener itself is gone; numerical registration only
        // protects participating fixtures, while pool separation protects the
        // handoff from unrelated :0 listeners and outbound source allocation.
        assert!(TcpListener::bind(("127.0.0.1", port)).is_ok());
    }
}

#[test]
fn simultaneous_leases_remain_distinct_after_listeners_are_released() {
    const WORKERS: usize = 8;
    let barrier = Arc::new(Barrier::new(WORKERS));
    let workers: Vec<_> = (0..WORKERS)
        .map(|_| {
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut first = FixturePorts::<2>::reserve("concurrent-first");
                let first_values = first
                    .as_ref()
                    .map(|ports| ports.values())
                    .map_err(|error| format!("{error:?}"));
                barrier.wait();
                if let Ok(ports) = first.as_mut() {
                    ports.release_for_start();
                    ports.release_for_start();
                }
                barrier.wait();
                let second = FixturePorts::<2>::reserve("concurrent-second");
                let second_values = second
                    .as_ref()
                    .map(|ports| ports.values())
                    .map_err(|error| format!("{error:?}"));
                // Keep both generations registered until every worker reserved.
                barrier.wait();
                (first_values, second_values)
            })
        })
        .collect();
    let mut distinct = HashSet::new();
    for worker in workers {
        let (first, second) = worker.join().unwrap();
        for port in first.unwrap().into_iter().chain(second.unwrap()) {
            assert!(
                distinct.insert(port),
                "two active leases selected port {port}"
            );
        }
    }
    assert_eq!(distinct.len(), WORKERS * 4);
}

#[tokio::test]
async fn observes_both_real_origins_and_confirms_graceful_cleanup() {
    let ports = FixturePorts::<2>::reserve("real-ready").unwrap();
    let values = ports.values();
    let mut fixture = OwnedNodeFixture::spawn(ports, node_command(values, READY_NODE)).unwrap();
    let health = fixture.ready().await.unwrap();
    assert_eq!(health.performer["status"], "ready");
    assert_eq!(health.monitor["status"], "ready");
    assert_eq!(health.performer["projectId"], "test-support-fixture");
    assert_eq!(health.monitor["scoreServer"]["monitorPort"], values[1]);
    let pid = u32::try_from(health.performer["fixtureNodePid"].as_u64().unwrap()).unwrap();
    let actual: serde_json::Value = fixture
        .client()
        .get(format!("http://127.0.0.1:{}/", values[0]))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(actual["fixtureNodePid"], pid);
    let cleanup = fixture.finish().await.unwrap();
    assert!(cleanup.process_reaped);
    assert!(cleanup.ports_released);
    assert_ports_released(values);
    assert_process_gone(pid);
}

#[tokio::test]
async fn early_exit_reports_the_real_status_and_stderr() {
    let ports = FixturePorts::<2>::reserve("early-exit").unwrap();
    let values = ports.values();
    let command = node_command(
        values,
        "process.stderr.write('intentional startup failure', () => process.exit(17));",
    );
    let mut fixture = OwnedNodeFixture::spawn(ports, command).unwrap();
    let error = failure(fixture.ready().await);
    assert_eq!(error.phase, FixturePhase::Ready);
    assert_eq!(error.label, "early-exit");
    assert_eq!(error.ports, values);
    assert_eq!(error.exit.and_then(|status| status.code()), Some(17));
    assert!(error.stderr_tail.contains("intentional startup failure"));
    drop(fixture);
    assert_ports_released(values);
}

#[tokio::test]
async fn large_output_is_drained_without_blocking_and_reports_bounded_tails() {
    let ports = FixturePorts::<2>::reserve("large-output").unwrap();
    let values = ports.values();
    let command = node_command(
        values,
        r#"
const output = 'x'.repeat(128 * 1024);
process.stdout.write(output + 'STDOUT-END', () => {
  process.stderr.write(output + 'STDERR-END', () => process.exit(7));
});
"#,
    );
    let mut fixture = OwnedNodeFixture::spawn(ports, command).unwrap();
    let error = failure(fixture.ready().await);
    assert_eq!(error.phase, FixturePhase::Ready);
    assert_eq!(error.exit.and_then(|status| status.code()), Some(7));
    assert!(error.stdout_tail.ends_with("STDOUT-END"));
    assert!(error.stderr_tail.ends_with("STDERR-END"));
    assert!(error.stdout_tail.len() <= 64 * 1024);
    assert!(error.stderr_tail.len() <= 64 * 1024);
    drop(fixture);
    assert_ports_released(values);
}

#[tokio::test]
async fn readiness_timeout_keeps_probe_evidence_and_releases_its_process() {
    let ports = FixturePorts::<2>::reserve("never-listens").unwrap();
    let values = ports.values();
    let command = node_command(values, "setInterval(() => {}, 1000);");
    let mut fixture = OwnedNodeFixture::spawn_with_timeouts(
        ports,
        command,
        Duration::from_millis(200),
        Duration::from_millis(200),
    )
    .unwrap();
    let error = failure(
        tokio::time::timeout(Duration::from_secs(5), fixture.ready())
            .await
            .expect("readiness deadline did not settle"),
    );
    assert_eq!(error.phase, FixturePhase::Ready);
    assert!(error.last_probe.is_some());
    drop(fixture);
    assert_ports_released(values);
}

#[tokio::test]
async fn failed_graceful_stop_remains_an_error_after_forced_recovery() {
    let ports = FixturePorts::<2>::reserve("ignores-term").unwrap();
    let values = ports.values();
    let script = format!("process.on('SIGTERM', () => {{}});\n{READY_NODE}");
    let mut fixture = OwnedNodeFixture::spawn_with_timeouts(
        ports,
        node_command(values, &script),
        Duration::from_secs(5),
        Duration::from_millis(150),
    )
    .unwrap();
    let health = fixture.ready().await.unwrap();
    let pid = u32::try_from(health.performer["fixtureNodePid"].as_u64().unwrap()).unwrap();
    let error = failure(fixture.finish().await);
    assert_eq!(error.phase, FixturePhase::GracefulStop);
    assert_eq!(error.ports, values);
    assert!(error.exit.is_some());
    assert_ports_released(values);
    assert_process_gone(pid);
}

#[tokio::test]
async fn assertion_unwind_reaps_the_owned_process_and_releases_ports() {
    let ports = FixturePorts::<2>::reserve("case-panics").unwrap();
    let values = ports.values();
    let mut fixture = OwnedNodeFixture::spawn(ports, node_command(values, READY_NODE)).unwrap();
    let health = fixture.ready().await.unwrap();
    let pid = u32::try_from(health.performer["fixtureNodePid"].as_u64().unwrap()).unwrap();
    let outcome = catch_unwind(AssertUnwindSafe(move || {
        let _owned = fixture;
        panic!("synthetic business assertion");
    }));
    assert!(outcome.is_err());
    assert_ports_released(values);
    assert_process_gone(pid);
}

#[test]
fn spawn_failure_releases_the_port_lease() {
    let ports = FixturePorts::<2>::reserve("missing-node").unwrap();
    let values = ports.values();
    let temp = tempfile::tempdir().unwrap();
    let missing = temp.path().join("absent-node-runtime");
    let error = failure(OwnedNodeFixture::spawn(ports, Command::new(missing)));
    assert_eq!(error.phase, FixturePhase::Spawn);
    assert_eq!(error.label, "missing-node");
    assert_eq!(error.ports, values);
    assert!(error.exit.is_none());
    assert_ports_released(values);
}
