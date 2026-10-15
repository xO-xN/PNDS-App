//! Real CLI entry: installed resources, inter-process ownership and cancellation.
use std::fs;
use std::process::Command;

#[test]
fn host_runtime_ownership_blocks_cli_execution_but_allows_static_diagnostics() {
    let dir = tempfile::tempdir().unwrap();
    let gate = dir
        .path()
        .join("Library/Application Support/com.xo-xn.pnds-app/runtime.lock");
    let _host = pnds_app_lib::RuntimeLease::acquire(&gate).unwrap();
    let project = dir.path().join("project");
    fs::create_dir(&project).unwrap();
    fs::write(project.join("manifest.json"), r#"{"schemaVersion":1,"id":"busy","name":"Busy","version":"1.0.0","scoreServer":{"entry":"server.js","workingDirectory":".","performerPort":6868,"monitorPort":6869},"audio":{"defaultMode":"none","supportedModes":["none"]}}"#).unwrap();
    fs::write(project.join("server.js"), "throw Error('must not execute')").unwrap();
    let command = |run: bool| {
        let mut command = Command::new(env!("CARGO_BIN_EXE_pnds"));
        command
            .arg("check")
            .arg(&project)
            .arg("--json")
            .env("HOME", dir.path());
        if run {
            command.arg("--run");
        }
        command.output().unwrap()
    };
    let busy = command(true);
    assert_eq!(busy.status.code(), Some(1));
    let report: serde_json::Value = serde_json::from_slice(&busy.stdout).unwrap();
    assert_eq!(report["status"], "notExecuted");
    assert!(report["error"].as_str().unwrap().contains("active"));
    let static_check = command(false);
    assert_eq!(static_check.status.code(), Some(0));
    assert_eq!(fs::read_dir(project).unwrap().count(), 2);
    assert!(pnds_app_lib::RuntimeLease::acquire(&gate).is_err());
}

#[test]
fn runtime_invocation_preserves_source_and_reports_missing_installed_node() {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("project");
    fs::create_dir(&project).unwrap();
    let manifest = r#"{"schemaVersion":1,"id":"cli-run","name":"CLI run","version":"1.0.0","scoreServer":{"entry":"server.js","workingDirectory":".","performerPort":6868,"monitorPort":6869},"audio":{"defaultMode":"none","supportedModes":["none"]}}"#;
    fs::write(project.join("manifest.json"), manifest).unwrap();
    fs::write(
        project.join("server.js"),
        "throw Error('must not execute without Node')",
    )
    .unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_pnds"))
        .args([
            "check",
            project.to_str().unwrap(),
            "--run",
            "--json",
            "--app-root",
        ])
        .arg(dir.path().join("Missing.app"))
        .env("HOME", dir.path())
        .output()
        .unwrap();
    assert_eq!(
        output.status.code(),
        Some(1),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["mode"], "none");
    assert_ne!(report["status"], "passed");
    assert_eq!(report["cleanup"]["temporaryFilesRemoved"], true);
    assert_eq!(
        fs::read_to_string(project.join("manifest.json")).unwrap(),
        manifest
    );
    assert_eq!(fs::read_dir(project).unwrap().count(), 2);
}

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::process::{Child, ExitStatus, Stdio};
use std::time::{Duration, Instant};

struct InstalledFixture {
    home: tempfile::TempDir,
    project: PathBuf,
    app: PathBuf,
    ports: [u16; 2],
    source: BTreeMap<String, Vec<u8>>,
}

impl InstalledFixture {
    fn new(ready_after_ms: u32) -> Self {
        let home = tempfile::tempdir().unwrap();
        let project = home.path().join("score");
        let app = home.path().join("Installed PNDS.app");
        fs::create_dir(&project).unwrap();
        fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        let architecture = match std::env::consts::ARCH {
            "aarch64" => "aarch64",
            "x86_64" => "x86_64",
            other => panic!("Unsupported macOS test architecture: {other}"),
        };
        let node = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!("binaries/node-{architecture}-apple-darwin"));
        assert!(
            node.is_file(),
            "Bundled Node must be provisioned: {}",
            node.display()
        );
        symlink(node, app.join("Contents/MacOS/node")).unwrap();
        // Hold both reservations together so these two ports cannot coincide.
        let performer = TcpListener::bind("127.0.0.1:0").unwrap();
        let monitor = TcpListener::bind("127.0.0.1:0").unwrap();
        let ports = [
            performer.local_addr().unwrap().port(),
            monitor.local_addr().unwrap().port(),
        ];
        let manifest = serde_json::json!({
            "schemaVersion": 1, "id": "installed-cli-fixture", "name": "Installed CLI Fixture", "version": "1.0.0",
            "scoreServer": { "entry": "server.cjs", "workingDirectory": ".", "performerPort": ports[0], "monitorPort": ports[1] },
            "audio": { "defaultMode": "none", "supportedModes": ["none"] }
        }).to_string();
        let script = format!(
            r#"const fs = require('node:fs'), http = require('node:http');
const manifest = JSON.parse(fs.readFileSync('manifest.json'));
fs.writeFileSync('generated-cache', 'only the captured copy may contain this');
const health = {{status:'starting', projectId:manifest.id, audioMode:process.argv.at(-1),
  audio:{{status:'starting', target:null, error:null}},
  scoreServer:{{performerPort:manifest.scoreServer.performerPort, monitorPort:manifest.scoreServer.monitorPort, error:null}},
  fixtureNodePid:process.pid, fixtureWorkerPid:process.ppid}};
setTimeout(() => {{ health.status='ready'; health.audio.status='disabled'; }}, {ready_after_ms});
http.createServer((request,response)=>response.end(request.url==='/__pnds/health' ? JSON.stringify(health) : 'performer')).listen(manifest.scoreServer.performerPort,'127.0.0.1');
http.createServer((request,response)=>response.end('monitor')).listen(manifest.scoreServer.monitorPort,'127.0.0.1');
"#
        );
        let source = BTreeMap::from([
            ("manifest.json".into(), manifest.into_bytes()),
            ("server.cjs".into(), script.into_bytes()),
        ]);
        for (path, bytes) in &source {
            fs::write(project.join(path), bytes).unwrap();
        }
        drop((performer, monitor));
        Self {
            home,
            project,
            app,
            ports,
            source,
        }
    }

    fn gate(&self) -> PathBuf {
        self.home
            .path()
            .join("Library/Application Support/com.xo-xn.pnds-app/runtime.lock")
    }

    fn start(&self, label: &str) -> CliProcess {
        let stdout = self.home.path().join(format!("{label}.stdout"));
        let stderr = self.home.path().join(format!("{label}.stderr"));
        let child = Command::new(env!("CARGO_BIN_EXE_pnds"))
            .arg("check")
            .arg(&self.project)
            .args(["--run", "--json", "--app-root"])
            .arg(&self.app)
            .args(["--timeout-ms", "10000"])
            .env("HOME", self.home.path())
            .stdout(Stdio::from(fs::File::create(&stdout).unwrap()))
            .stderr(Stdio::from(fs::File::create(&stderr).unwrap()))
            .spawn()
            .unwrap();
        CliProcess {
            child,
            stdout,
            stderr,
            observed_pids: None,
        }
    }

    fn assert_source_unchanged(&self) {
        let actual: BTreeMap<String, Vec<u8>> = fs::read_dir(&self.project)
            .unwrap()
            .map(|entry| {
                let entry = entry.unwrap();
                (
                    entry.file_name().into_string().unwrap(),
                    fs::read(entry.path()).unwrap(),
                )
            })
            .collect();
        assert_eq!(actual, self.source, "A check wrote to its source project");
    }

    fn assert_resources_released(&self) {
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            let sockets: Option<Vec<_>> = self
                .ports
                .iter()
                .map(|port| TcpListener::bind(("127.0.0.1", *port)).ok())
                .collect();
            if sockets.is_some() && pnds_app_lib::RuntimeLease::acquire(&self.gate()).is_ok() {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "CLI worker retained ports or runtime ownership after its front end ended"
            );
            std::thread::sleep(Duration::from_millis(25));
        }
        self.assert_source_unchanged();
    }
}

/// Captures output in files so a dead front end cannot block the test reading
/// inherited worker pipes. Drop bounds cleanup even when an assertion fails.
struct CliProcess {
    child: Child,
    stdout: PathBuf,
    stderr: PathBuf,
    observed_pids: Option<(i32, i32)>,
}

impl CliProcess {
    fn health(&mut self, port: u16) -> serde_json::Value {
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            if let Ok(mut socket) = TcpStream::connect_timeout(
                &([127, 0, 0, 1], port).into(),
                Duration::from_millis(100),
            ) {
                socket
                    .set_read_timeout(Some(Duration::from_millis(200)))
                    .unwrap();
                socket
                    .set_write_timeout(Some(Duration::from_millis(200)))
                    .unwrap();
                let _ = socket.write_all(
                    b"GET /__pnds/health HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n",
                );
                let mut response = String::new();
                if socket.read_to_string(&mut response).is_ok() {
                    if let Some(body) = response.split_once("\r\n\r\n").map(|(_, body)| body) {
                        if let Ok(health) = serde_json::from_str::<serde_json::Value>(body) {
                            if let (Some(node), Some(worker)) = (
                                health["fixtureNodePid"].as_i64(),
                                health["fixtureWorkerPid"].as_i64(),
                            ) {
                                self.observed_pids = Some((
                                    i32::try_from(node).unwrap(),
                                    i32::try_from(worker).unwrap(),
                                ));
                                return health;
                            }
                        }
                    }
                }
            }
            assert!(
                Instant::now() < deadline,
                "CLI did not start its real Node fixture: {}\n{}",
                fs::read_to_string(&self.stdout).unwrap(),
                fs::read_to_string(&self.stderr).unwrap()
            );
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn assert_owned_processes_exited(&self) {
        let (node, worker) = self.observed_pids.expect("fixture ownership was observed");
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            // SAFETY: signal zero only probes the two owned fixture PIDs.
            let exited = unsafe { libc::kill(node, 0) != 0 && libc::kill(worker, 0) != 0 };
            if exited {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "Owned Node or worker survived reported cleanup"
            );
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn signal(&self, signal: i32) {
        let pid = i32::try_from(self.child.id()).unwrap();
        // SAFETY: this is the child spawned and retained by this guard.
        assert_eq!(unsafe { libc::kill(pid, signal) }, 0);
    }

    fn finish(&mut self) -> ExitStatus {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                return status;
            }
            assert!(
                Instant::now() < deadline,
                "CLI did not exit in time: {}",
                fs::read_to_string(&self.stderr).unwrap()
            );
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn report(&self) -> serde_json::Value {
        // SIGKILL ends the front end before the worker's final JSON flush.
        // Wait boundedly for that same report, never for inherited pipes.
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let bytes = fs::read(&self.stdout).unwrap();
            match serde_json::from_slice(&bytes) {
                Ok(report) => return report,
                Err(error) if Instant::now() >= deadline => panic!(
                    "Invalid CLI JSON: {error}\n{}\n{}",
                    String::from_utf8_lossy(&bytes),
                    fs::read_to_string(&self.stderr).unwrap()
                ),
                Err(_) => std::thread::sleep(Duration::from_millis(25)),
            }
        }
    }
}

impl Drop for CliProcess {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            // SAFETY: the guard still owns this child. TERM gives its worker
            // time to release resources before emergency bounded cleanup.
            unsafe {
                libc::kill(i32::try_from(self.child.id()).unwrap(), libc::SIGTERM);
            }
            let deadline = Instant::now() + Duration::from_secs(4);
            while self.child.try_wait().ok().flatten().is_none() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(25));
            }
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        if let Some((node, worker)) = self.observed_pids {
            // SAFETY: the fixture observed these owned process-group leaders;
            // kill only a still-existing owned group, never a project root.
            unsafe {
                if libc::kill(node, 0) == 0 {
                    libc::kill(-node, libc::SIGKILL);
                }
                if libc::kill(worker, 0) == 0 {
                    libc::kill(-worker, libc::SIGKILL);
                }
            }
        }
    }
}

#[test]
fn installed_cli_runs_real_none_health_and_returns_the_shared_report_with_saved_input_evidence() {
    use sha2::{Digest, Sha256};
    let fixture = InstalledFixture::new(250);
    let mut cli = fixture.start("success");
    assert_eq!(
        cli.health(fixture.ports[0])["projectId"],
        "installed-cli-fixture"
    );
    assert_eq!(
        cli.finish().code(),
        Some(0),
        "{}",
        fs::read_to_string(&cli.stderr).unwrap()
    );
    let json = cli.report();
    // Deserialize the public CLI output into the core workflow report. There
    // is no separately maintained CLI success or evidence schema.
    let report: pnds_app_lib::ControlledCheckReport = serde_json::from_value(json.clone()).unwrap();
    assert_eq!(report.status, pnds_app_lib::ControlledCheckStatus::Passed);
    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["mode"], "none");
    assert_eq!(json["health"]["projectId"], "installed-cli-fixture");
    assert_eq!(json["health"]["status"], "ready");
    assert_eq!(json["health"]["audio"]["status"], "disabled");
    assert_eq!(json["diagnostics"]["staticPassed"], true);
    let evidence = report.evidence.unwrap();
    assert_eq!(
        Path::new(&evidence.source_root),
        fixture.project.canonicalize().unwrap()
    );
    assert_eq!(evidence.project_files.len(), 2);
    for entry in evidence.project_files {
        let bytes = fixture
            .source
            .get(&entry.path)
            .expect("only saved input is evidence");
        assert_eq!(entry.bytes, bytes.len() as u64);
        assert_eq!(entry.sha256, format!("{:x}", Sha256::digest(bytes)));
    }
    assert_eq!(json["freshness"]["stale"], false);
    assert_eq!(json["cleanup"]["nodeConfirmed"], true);
    assert_eq!(json["cleanup"]["temporaryFilesRemoved"], true);
    assert!(report.unverified.iter().any(|scope| scope == "sound"));
    fixture.assert_resources_released();
}

#[test]
fn competing_cli_is_rejected_while_the_first_real_check_is_waiting_for_ready_health() {
    let fixture = InstalledFixture::new(60_000);
    let mut first = fixture.start("first");
    assert_eq!(first.health(fixture.ports[0])["status"], "starting");
    let mut competitor = fixture.start("competitor");
    assert_eq!(competitor.finish().code(), Some(1));
    let report = competitor.report();
    assert_eq!(report["status"], "notExecuted");
    assert!(report["error"].as_str().unwrap().contains("active"));
    assert_eq!(first.health(fixture.ports[0])["status"], "starting");
    first.signal(libc::SIGTERM);
    assert_eq!(first.finish().code(), Some(130));
    fixture.assert_resources_released();
}

#[test]
fn sigterm_cancels_the_real_cli_with_exit_130_and_releases_its_ports_and_gate() {
    let fixture = InstalledFixture::new(60_000);
    let mut cli = fixture.start("term");
    assert_eq!(cli.health(fixture.ports[0])["status"], "starting");
    cli.signal(libc::SIGTERM);
    assert_eq!(cli.finish().code(), Some(130));
    let report = cli.report();
    assert_eq!(report["status"], "cancelled");
    assert_eq!(report["cleanup"]["nodeConfirmed"], true);
    assert_eq!(report["cleanup"]["temporaryFilesRemoved"], true);
    fixture.assert_resources_released();
}

#[test]
fn killing_the_cli_front_end_cancels_its_worker_through_stdin_eof_and_releases_resources() {
    use std::os::unix::process::ExitStatusExt;
    let fixture = InstalledFixture::new(60_000);
    let mut cli = fixture.start("kill");
    assert_eq!(cli.health(fixture.ports[0])["status"], "starting");
    cli.signal(libc::SIGKILL);
    assert_eq!(cli.finish().signal(), Some(libc::SIGKILL));
    fixture.assert_resources_released();
    let report = cli.report();
    assert_eq!(report["status"], "cancelled");
    assert_eq!(report["cleanup"]["nodeConfirmed"], true);
    assert_eq!(report["cleanup"]["temporaryFilesRemoved"], true);
    cli.assert_owned_processes_exited();
}

#[test]
fn runtime_sample_rate_arguments_use_the_hosts_shared_policy() {
    let dir = tempfile::tempdir().unwrap();
    for rate in [22050, 32000, 176400, 192000] {
        let output = Command::new(env!("CARGO_BIN_EXE_pnds"))
            .args([
                "check",
                "/unused",
                "--run",
                "--sample-rate",
                &rate.to_string(),
            ])
            .env("HOME", dir.path())
            .output()
            .unwrap();
        assert_eq!(
            output.status.code(),
            Some(2),
            "invalid rate {rate} was accepted"
        );
        assert!(String::from_utf8_lossy(&output.stderr).contains("--sample-rate"));
    }
}

#[test]
fn unresolved_group_blocks_app_and_cli_after_frontend_exit_until_whole_group_is_absent() {
    use std::io::BufRead;
    use std::os::unix::process::CommandExt;
    let fixture = InstalledFixture::new(0);
    let mut leader = Command::new("/bin/sh")
        .args(["-c", "sleep 30 & echo $!; wait"])
        .stdout(Stdio::piped())
        .process_group(0)
        .spawn()
        .unwrap();
    let group_id = leader.id();
    let mut ready = String::new();
    std::io::BufReader::new(leader.stdout.take().unwrap())
        .read_line(&mut ready)
        .unwrap();
    let lease = pnds_app_lib::RuntimeLease::acquire(&fixture.gate()).unwrap();
    lease.begin_check("unconfirmed-fixture").unwrap();
    lease
        .finish_check(
            false,
            &[pnds_app_lib::OwnedRuntimeGroup {
                group_id,
                leader_started_at: None,
                marker: "owned fixture group".into(),
            }],
        )
        .unwrap();
    drop(lease); // The front end has ended; only durable ownership can block new runs.
    leader.kill().unwrap();
    leader.wait().unwrap(); // A dead leader must not discard its live descendants.
    let app_refused = pnds_app_lib::RuntimeLease::acquire(&fixture.gate()).is_err();
    let mut cli = fixture.start("unconfirmed-group");
    let status = cli.finish();
    let report = cli.report();
    unsafe {
        libc::kill(-(group_id as i32), libc::SIGKILL);
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    while unsafe { libc::kill(-(group_id as i32), 0) == 0 } && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(25));
    }
    assert!(
        app_refused,
        "App gate admitted a new run after unconfirmed cleanup"
    );
    assert_eq!(status.code(), Some(1));
    assert_eq!(report["status"], "notExecuted");
    assert!(report["error"].as_str().unwrap().contains("unconfirmed"));
    assert!(
        pnds_app_lib::RuntimeLease::acquire(&fixture.gate()).is_ok(),
        "absent owned groups should allow safe recovery"
    );
}

#[test]
fn runtime_journal_start_failure_is_a_structured_operational_report() {
    use std::os::unix::process::CommandExt;
    let fixture = InstalledFixture::new(0);
    let mut command = Command::new(env!("CARGO_BIN_EXE_pnds"));
    command
        .arg("check")
        .arg(&fixture.project)
        .args(["--run", "--json", "--app-root"])
        .arg(&fixture.app)
        .env("HOME", fixture.home.path());
    // Real file-I/O failure at the public CLI boundary: gate creation works,
    // but its first durable journal write exceeds this child-only file limit.
    unsafe {
        command.pre_exec(|| {
            libc::signal(libc::SIGXFSZ, libc::SIG_IGN);
            let limit = libc::rlimit {
                rlim_cur: 0,
                rlim_max: 0,
            };
            if libc::setrlimit(libc::RLIMIT_FSIZE, &limit) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let output = command.output().unwrap();
    assert_eq!(
        output.status.code(),
        Some(1),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["status"], "notExecuted");
    assert!(report["error"].as_str().unwrap().contains("persist"));
    assert_eq!(report["cleanup"]["nodeConfirmed"], true);
    fixture.assert_source_unchanged();
}
