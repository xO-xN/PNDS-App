use super::*;
use crate::test_support::FixturePorts;
use std::cell::{Cell, RefCell};
use std::fs;
use std::io::Write;

/// The real checker retains process ownership. This adapter only hands off the
/// fixture's ports and remembers its actual reports for assertion diagnostics.
struct ControlledFixture {
    directory: tempfile::TempDir,
    ports: RefCell<FixturePorts<2>>,
    values: [u16; 2],
    label: String,
    phase: Cell<Option<ControlledCheckPhase>>,
    last_report: RefCell<Option<String>>,
}

impl ControlledFixture {
    fn path(&self) -> &Path {
        self.directory.path()
    }

    fn values(&self) -> [u16; 2] {
        self.values
    }

    fn run(
        &self,
        root: &Path,
        options: &ControlledCheckOptions,
        context: &ControlledCheckContext,
        cancelled: &AtomicBool,
        progress: impl Fn(ControlledCheckProgress),
    ) -> ControlledCheckReport {
        self.ports.borrow_mut().release_for_start();
        let report = run_controlled_check(root, options, context, cancelled, |value| {
            self.phase.set(Some(value.phase));
            progress(value);
        });
        self.record(&report);
        report
    }

    fn run_observed(
        &self,
        root: &Path,
        options: &ControlledCheckOptions,
        context: &ControlledCheckContext,
        cancelled: &AtomicBool,
        progress: impl Fn(ControlledCheckProgress),
        browser: impl Fn(&Manifest, &mut ControlledCheckReport) -> Result<(), String>,
    ) -> ControlledCheckReport {
        self.ports.borrow_mut().release_for_start();
        let report = run_controlled_check_observed(
            root,
            options,
            context,
            cancelled,
            |value| {
                self.phase.set(Some(value.phase));
                progress(value);
            },
            |manifest, _, report| browser(manifest, report),
        );
        self.record(&report);
        report
    }

    fn record(&self, report: &ControlledCheckReport) {
        let tail: Vec<_> = report
            .output_tail
            .iter()
            .rev()
            .take(8)
            .rev()
            .map(|line| line.chars().take(512).collect::<String>())
            .collect();
        let error: String = report
            .error
            .as_deref()
            .unwrap_or("")
            .chars()
            .take(2048)
            .collect();
        let cleanup: String = format!("{:?}", report.cleanup).chars().take(2048).collect();
        *self.last_report.borrow_mut() = Some(format!(
            "status={:?}; error={error:?}; cleanup={cleanup}; output_tail={tail:?}",
            report.status
        ));
    }
}

impl Drop for ControlledFixture {
    fn drop(&mut self) {
        if std::thread::panicking() {
            let report = self.last_report.try_borrow().ok();
            let _ = writeln!(
                std::io::stderr().lock(),
                "Controlled fixture {} at {} ports={:?} phase={:?}: {}",
                self.label,
                self.path().display(),
                self.values,
                self.phase.get(),
                report
                    .as_deref()
                    .and_then(Option::as_deref)
                    .unwrap_or("native check has not returned")
            );
        }
    }
}

fn fixture(body: &str) -> (ControlledFixture, ControlledCheckContext) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("project");
    fs::create_dir(&root).unwrap();
    let ports = FixturePorts::<2>::reserve("controlled-check").unwrap();
    let [performer, monitor] = ports.values();
    fs::write(root.join("manifest.json"), serde_json::json!({"schemaVersion":1,"id":"controlled-fixture","name":"Controlled Fixture","version":"1.0.0","scoreServer":{"entry":"server.cjs","workingDirectory":".","performerPort":performer,"monitorPort":monitor},"audio":{"defaultMode":"none","supportedModes":["none"]}}).to_string()).unwrap();
    let script = format!(
        r#"const fs = require('node:fs'), http = require('node:http');
const manifest = JSON.parse(fs.readFileSync('manifest.json'));
const mode = process.argv.at(-1);
const health = {{status:'ready',projectId:manifest.id,audioMode:mode,audio:{{status:mode==='none'?'disabled':'ready',target:process.env.PNDS_OSC_TARGET || null,error:null}},scoreServer:{{performerPort:manifest.scoreServer.performerPort,monitorPort:manifest.scoreServer.monitorPort,error:null}}}};
{body}
http.createServer((req,res)=>{{res.end(req.url==='/__pnds/health'?JSON.stringify(health):'performer')}}).listen(manifest.scoreServer.performerPort,'127.0.0.1');
http.createServer((req,res)=>res.end('monitor')).listen(manifest.scoreServer.monitorPort,'127.0.0.1');
"#
    );
    fs::write(root.join("server.cjs"), script).unwrap();
    let node =
        super::super::session::node_binary_path().expect("provisioned bundled Node test runtime");
    assert!(node.is_file());
    let context = ControlledCheckContext {
        task_id: "fixture-check".into(),
        expected_source_identity: None,
        app_data_dir: dir.path().join("app-data"),
        shared_root: None,
        node_binary: node,
        scsynth_binary: None,
        plugins_dir: None,
        master_synthdef: None,
        test_audio_device: None,
        test_sclang: None,
    };
    (
        ControlledFixture {
            directory: dir,
            ports: RefCell::new(ports),
            values: [performer, monitor],
            label: std::thread::current()
                .name()
                .unwrap_or("controlled-check")
                .to_owned(),
            phase: Cell::new(None),
            last_report: RefCell::new(None),
        },
        context,
    )
}

#[test]
fn saved_none_check_runs_real_node_http_and_cleans_without_source_writes() {
    let (dir, context) = fixture("fs.writeFileSync('generated-cache','copy only');");
    let root = dir.path().join("project");
    let manifest = fs::read(root.join("manifest.json")).unwrap();
    let report = dir.run(
        &root,
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |_| {},
    );
    assert_eq!(
        report.status,
        ControlledCheckStatus::Passed,
        "{:?}",
        report.error
    );
    assert!(report.cleanup.node_confirmed && report.cleanup.temporary_files_removed);
    assert!(!root.join("generated-cache").exists());
    assert_eq!(fs::read(root.join("manifest.json")).unwrap(), manifest);
}

#[test]
fn durable_real_check_receipt_rehashes_assets_installed_packages_and_shared_inputs() {
    let (dir, mut context) = fixture("");
    let root = fs::canonicalize(dir.path().join("project")).unwrap();
    let libraries = dir.path().join("shared");
    fs::create_dir_all(libraries.join("node")).unwrap();
    fs::write(libraries.join("node/express.js"), "original").unwrap();
    fs::write(libraries.join("catalog.json"),r#"{"schemaVersion":1,"libraries":[{"id":"express","version":"5.3.0","kind":"node","entry":"node/express.js","source":{"url":"fixture","integrity":"fixture"},"files":[{"path":"node/express.js","bytes":8,"sha256":"0682c5f2076f099c34cfdd15a9e063849ed437a49677e6fcc5b4198c76575be5"}]}]}"#).unwrap();
    context.shared_root = Some(libraries.clone());
    let manifest = root.join("manifest.json");
    let mut value: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
    value["schemaVersion"] = serde_json::json!(2);
    value["sharedLibraries"] = serde_json::json!([{"id":"express","version":"5.3.0"}]);
    fs::write(manifest, value.to_string()).unwrap();
    fs::write(
        root.join("package.json"),
        r#"{"dependencies":{"express":"5.3.0","local":"^1.0.0"}}"#,
    )
    .unwrap();
    fs::create_dir_all(root.join("node_modules/local")).unwrap();
    let package = root.join("node_modules/local/package.json");
    let package_text = r#"{"name":"local","version":"1.2.0"}"#;
    fs::write(&package, package_text).unwrap();
    let asset = root.join("animation.bin");
    fs::write(&asset, b"original asset").unwrap();
    let report = dir.run(
        &root,
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |_| {},
    );
    assert_eq!(
        report.status,
        ControlledCheckStatus::Passed,
        "{:?}",
        report.error
    );
    let data = dir.path().join("private-receipts");
    persist_report_receipt(&data, &report).unwrap();
    let loaded = load_report_receipt(&data, &root, &report.task_id).unwrap();
    let evidence = loaded.evidence.unwrap();
    let fresh = || {
        check_evidence::source_freshness(
            &root,
            Some(&libraries),
            &evidence,
            &AtomicBool::new(false),
        )
    };
    assert!(!fresh().stale);
    fs::write(&asset, b"new animation asset").unwrap();
    assert!(fresh().stale);
    fs::write(&asset, b"original asset").unwrap();
    assert!(!fresh().stale);
    fs::write(&package, r#"{"name":"local","version":"1.3.0"}"#).unwrap();
    assert!(fresh().stale);
    fs::write(&package, package_text).unwrap();
    assert!(!fresh().stale);
    fs::write(libraries.join("node/express.js"), "changed").unwrap();
    let result = fresh();
    assert!(result.stale && result.complete);
    assert!(result
        .reasons
        .iter()
        .any(|reason| reason.contains("Shared library")));
}

#[test]
fn newly_created_classic_passes_none_check_with_disabled_audio_health() {
    use super::super::creation::{CreationAccess, NewProjectOptions, Protection};
    let (dir, mut context) = fixture("");
    let shared = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/shared-libraries");
    context.shared_root = Some(shared.clone());
    let workspace = CreationAccess::default()
        .create_classic(
            &NewProjectOptions {
                parent: dir.path().to_string_lossy().into_owned(),
                folder_name: "classic".into(),
                name: "Classic None".into(),
                author: "".into(),
                description: "".into(),
                locale: "en".into(),
                git_name: None,
                git_email: None,
            },
            &shared,
            &Protection::default(),
        )
        .unwrap();
    let root = Path::new(&workspace.project.root);
    let path = root.join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let [performer, monitor] = dir.values();
    manifest["scoreServer"]["performerPort"] = performer.into();
    manifest["scoreServer"]["monitorPort"] = monitor.into();
    fs::write(&path, manifest.to_string()).unwrap();
    let report = dir.run(
        root,
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |_| {},
    );
    assert_eq!(
        report.status,
        ControlledCheckStatus::Passed,
        "{:?}",
        report.error
    );
    let audio = report.health.unwrap().audio.unwrap();
    assert_eq!(audio.status, "disabled");
    assert_eq!(audio.target, None);
    assert!(report.cleanup.node_confirmed && report.cleanup.temporary_files_removed);
}

#[test]
fn ready_health_must_match_this_project_mode_ports_and_audio_configuration() {
    for mismatch in [
        "health.projectId='another-project'",
        "health.audioMode='internal'",
        "health.scoreServer.performerPort=1",
        "health.scoreServer.monitorPort=1",
        "health.audio.status='ready'",
        "health.audio.target='127.0.0.1:57110'",
        "health.audio.error='broken'",
        "health.scoreServer.error='broken'",
    ] {
        let (dir, context) = fixture(mismatch);
        let report = dir.run(
            &dir.path().join("project"),
            &ControlledCheckOptions::default(),
            &context,
            &AtomicBool::new(false),
            |_| {},
        );
        assert_eq!(
            report.status,
            ControlledCheckStatus::Failed,
            "health mismatch accepted: {mismatch}"
        );
        assert!(report.cleanup.node_confirmed && report.cleanup.temporary_files_removed);
    }
}

#[test]
fn owned_node_descendants_cannot_keep_ports_after_check_cleanup() {
    let mut child_ports = FixturePorts::<1>::reserve("controlled-descendant").unwrap();
    let [child_port] = child_ports.values();
    let script=format!("const net=require('node:net');process.on('SIGTERM',()=>{{}});net.createServer().listen({child_port},'127.0.0.1',()=>process.stdout.write('ready'))");
    let body=format!("health.status='starting'; const sub=require('node:child_process').spawn(process.execPath,['-e',{}],{{stdio:['ignore','pipe','ignore']}}); sub.stdout.once('data',()=>{{health.status='ready'}}); console.log('descendant='+sub.pid);",serde_json::to_string(&script).unwrap());
    let (dir, context) = fixture(&body);
    // Only the real checker may start this child; retain its number claim until
    // this test finishes while releasing the socket immediately before that run.
    child_ports.release_for_start();
    let report = dir.run(
        &dir.path().join("project"),
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |_| {},
    );
    let survived = std::net::TcpStream::connect(("127.0.0.1", child_port)).is_ok();
    if survived {
        for line in &report.output_tail {
            if let Some(pid) = line
                .split("descendant=")
                .nth(1)
                .and_then(|s| s.trim().parse::<u32>().ok())
            {
                let _ = std::process::Command::new("/bin/kill")
                    .args(["-9", &pid.to_string()])
                    .status();
            }
        }
    }
    assert_eq!(
        report.status,
        ControlledCheckStatus::Passed,
        "{:?}",
        report.error
    );
    assert!(
        !survived,
        "a descendant retained its TCP listener after reported cleanup"
    );
}

fn executable(path: &Path, script: &str) {
    use std::os::unix::fs::PermissionsExt;
    fs::write(path, script).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}
fn internal_fixture(
    node_body: &str,
    audio_body: &str,
) -> (ControlledFixture, ControlledCheckContext, PathBuf) {
    let (dir, mut context) = fixture(node_body);
    let root = dir.path().join("project");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    manifest["audio"] = serde_json::json!({"defaultMode":"none","supportedModes":["none","internal"],"outputChannels":2,"synthdefs":["tone.scsyndef"],"scsynth":{"blockSize":64,"audioBusChannels":128}});
    fs::write(root.join("manifest.json"), manifest.to_string()).unwrap();
    fs::write(root.join("tone.scsyndef"), "controlled artifact").unwrap();
    let events = dir.path().join("audio-events");
    let script = format!(
        r#"const fs=require('node:fs'),dgram=require('node:dgram');
const events={};const record=s=>fs.appendFileSync(events,s+'\n');record('pid='+process.pid);record(process.argv.slice(2).join(' '));
function string(s){{const b=Buffer.alloc(Math.ceil((Buffer.byteLength(s)+1)/4)*4);b.write(s);return b}}
function osc(addr,args=[]){{return Buffer.concat([string(addr),string(','+args.map(a=>typeof a==='number'?'i':'s').join('')),...args.map(a=>{{if(typeof a!=='number')return string(a);const b=Buffer.alloc(4);b.writeInt32BE(a);return b}})])}}
const socket=dgram.createSocket('udp4');
{audio_body}
socket.on('message',(b,r)=>{{const a=b.toString('utf8',0,b.indexOf(0));record(a);
if(a==='/quit'){{record('released');socket.close(()=>process.exit(0));return}}
let response;if(a==='/status')response=osc('/status.reply');
if(a==='/d_load')response=osc('/done');if(a==='/sync')response=osc('/synced',[1]);
if(a==='/g_queryTree')response=osc('/g_queryTree.reply',[0,2147480000,2,2147480001,-1,'pndsMaster',2147480002,-1,'pndsMaster']);
if(response)socket.send(response,r.port,r.address)}});
socket.bind(Number(process.argv[process.argv.indexOf('-u')+1]),'127.0.0.1');
"#,
        serde_json::to_string(&events.to_string_lossy()).unwrap()
    );
    let audio_script = dir.path().join("audio.cjs");
    fs::write(&audio_script, script).unwrap();
    let binary = dir.path().join("scsynth-fixture");
    executable(
        &binary,
        &format!(
            "#!/bin/sh\nexec '{}' '{}' \"$@\"\n",
            context.node_binary.display(),
            audio_script.display()
        ),
    );
    context.scsynth_binary = Some(binary);
    context.plugins_dir = Some(dir.path().to_owned());
    let master = dir.path().join("pndsMaster.scsyndef");
    fs::write(&master, "controlled master").unwrap();
    context.master_synthdef = Some(master);
    context.test_audio_device = Some(("Controlled output fixture".into(), 2));
    (dir, context, events)
}

#[test]
fn internal_check_waits_for_starting_health_without_an_audio_target() {
    let (dir, context, events) = internal_fixture(
        r#"const ready=structuredClone(health);let polls=0;
health.toJSON=()=>{if(polls++===0){console.log('starting-health-observed');return {...ready,status:'starting',audio:{...ready.audio,status:'starting',target:null}}}console.log('ready-health-observed');return ready};"#,
        "",
    );
    let report = dir.run(
        &dir.path().join("project"),
        &ControlledCheckOptions {
            mode: AudioMode::Internal,
            ..Default::default()
        },
        &context,
        &AtomicBool::new(false),
        |_| {},
    );
    assert_eq!(
        report.status,
        ControlledCheckStatus::Passed,
        "{:?}",
        report.error
    );
    for marker in ["starting-health-observed", "ready-health-observed"] {
        assert!(report.output_tail.iter().any(|line| line.contains(marker)));
    }
    assert_eq!(report.health.unwrap().status, "ready");
    assert!(report
        .checks
        .iter()
        .any(|check| check.code == "audio" && check.status == DiagnosticStatus::Passed));
    assert!(
        report.cleanup.node_confirmed
            && report.cleanup.audio_confirmed
            && report.cleanup.temporary_files_removed
    );
    assert!(fs::read_to_string(events).unwrap().contains("released"));
}

#[test]
fn internal_starting_health_still_rejects_errors_and_requires_a_valid_ready_target() {
    for (body, expected_error) in [
        ("health.audio.target=null", "Health audio target does not match"),
        ("health.audio.status='starting'", "Ready health requires audio.status=ready"),
        ("health.status='starting';health.audio.status='starting';health.audio.target='127.0.0.1:1'", "Health audio target does not match"),
        ("health.status='starting';health.audio.status='starting';health.audio.target=null;health.audio.error='startup failed'", "Health audio error: startup failed"),
        ("health.status='starting';health.audio.status='starting';health.audio.target=null", "Timed out waiting for project ready health"),
    ] {
        let cold_boot = expected_error == "Health audio error: startup failed";
        let audio_body = if cold_boot {
            // Simulate a cold scheduled audio fixture without busy-spinning.
            // Health validation must still run after this independent bootstrap.
            "record('fixture-bootstrap-entered'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2000); record('fixture-bootstrap-ready');"
        } else { "" };
        let (dir, context, events) = internal_fixture(body, audio_body);
        let started = Instant::now();
        let phases = RefCell::new(vec![]);
        let report = dir.run(
            &dir.path().join("project"),
            &ControlledCheckOptions {
                mode: AudioMode::Internal,
                // Invalid-health cases use the normal bootstrap budget. The
                // intentional never-ready case alone needs a short test bound,
                // with room for independently scheduled real Node processes.
                timeout_ms: if expected_error.starts_with("Timed out") { 5000 } else { ControlledCheckOptions::default().timeout_ms },
                ..Default::default()
            },
            &context,
            &AtomicBool::new(false),
            |progress| phases.borrow_mut().push((progress.phase, started.elapsed())),
        );
        assert_eq!(report.status, ControlledCheckStatus::Failed, "{body}");
        assert!(report.health.is_some(), "health validation was never reached: {:?}; phases={:?}; audio={:?}", report.error, phases.borrow(), fs::read_to_string(&events));
        assert!(report.error.as_deref().is_some_and(|error| error.contains(expected_error)), "{body}: {:?}; phases={:?}; audio={:?}", report.error, phases.borrow(), fs::read_to_string(&events));
        assert!(phases.borrow().iter().any(|(phase, _)| *phase == ControlledCheckPhase::Health));
        if cold_boot {
            let events = fs::read_to_string(events).unwrap();
            for marker in ["fixture-bootstrap-entered", "fixture-bootstrap-ready", "/status"] {
                assert!(events.contains(marker), "{events}");
            }
        }
        assert!(report.cleanup.node_confirmed && report.cleanup.audio_confirmed && report.cleanup.temporary_files_removed);
        assert!(!report.checks.iter().any(|check| check.code == "audio" && check.status == DiagnosticStatus::Passed));
    }
}

#[test]
fn explicitly_selected_internal_check_boots_audio_verifies_master_and_releases_device() {
    let (dir, context, events) = internal_fixture("", "");
    let options = ControlledCheckOptions {
        mode: AudioMode::Internal,
        ..Default::default()
    };
    let report = dir.run(
        &dir.path().join("project"),
        &options,
        &context,
        &AtomicBool::new(false),
        |_| {},
    );
    assert_eq!(
        report.status,
        ControlledCheckStatus::Passed,
        "{:?}",
        report.error
    );
    assert_eq!(
        report.environment.output_device.as_deref(),
        Some("Controlled output fixture")
    );
    assert_eq!(report.environment.sample_rate, Some(48000));
    assert!(
        report.cleanup.node_confirmed
            && report.cleanup.audio_confirmed
            && report.cleanup.temporary_files_removed
    );
    assert!(fs::read_to_string(events).unwrap().contains("released"));
}

#[test]
fn explicit_compilation_verifies_artifacts_in_copy_without_publishing_to_source() {
    let (dir, mut context) = fixture("");
    let root = dir.path().join("project");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    manifest["audio"]["synthdefs"] = serde_json::json!(["supercollider/synthdefs/tone.scsyndef"]);
    fs::write(root.join("manifest.json"), manifest.to_string()).unwrap();
    fs::create_dir_all(root.join("supercollider/source")).unwrap();
    fs::write(
        root.join("supercollider/source/tone.scd"),
        "controlled source",
    )
    .unwrap();
    let compiler = dir.path().join("sclang-fixture");
    executable(&compiler,"#!/bin/sh\nmkdir -p \"$2\"\nprintf 'SCgf\\000\\000\\000\\002\\000\\001\\004tone' > \"$2/tone.scsyndef\"\n");
    context.test_sclang = Some(compiler);
    let options = ControlledCheckOptions {
        compile: true,
        ..Default::default()
    };
    let report = dir.run(&root, &options, &context, &AtomicBool::new(false), |_| {});
    assert_eq!(
        report.status,
        ControlledCheckStatus::Passed,
        "{:?}",
        report.error
    );
    assert!(!root.join("supercollider/synthdefs/tone.scsyndef").exists());
    assert!(report
        .checks
        .iter()
        .any(|c| c.code == "compile"
            && c.status == super::super::diagnostics::DiagnosticStatus::Passed));
}

#[test]
fn app_capability_rejects_replaced_project_directory_before_any_execution() {
    let (dir, mut context) = fixture("");
    context.expected_source_identity = Some("replaced-directory-identity".into());
    let report = dir.run(
        &dir.path().join("project"),
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |_| {},
    );
    assert_eq!(report.status, ControlledCheckStatus::Failed);
    assert!(report.error.unwrap().contains("identity"));
}

#[test]
fn report_records_the_actual_bundled_node_version() {
    let (dir, context) = fixture("");
    let report = dir.run(
        &dir.path().join("project"),
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |_| {},
    );
    assert_eq!(report.environment.node_version.as_deref(), Some("v24.18.1"));
}

#[test]
fn premature_exit_health_error_and_timeout_fail_with_bounded_cleanup() {
    for (body, reason) in [
        ("process.exit(7)", "exited"),
        ("health.status='error'", "Health"),
        ("health.status='starting'", "Timed out"),
    ] {
        let (dir, context) = fixture(body);
        let options = ControlledCheckOptions {
            // Reach the saved server even on a cold Node launch under the full
            // parallel suite. Every case must still fail for its intended
            // reason and complete within the total bound below.
            timeout_ms: 2000,
            ..Default::default()
        };
        let started = Instant::now();
        let report = dir.run(
            &dir.path().join("project"),
            &options,
            &context,
            &AtomicBool::new(false),
            |_| {},
        );
        assert_eq!(
            report.status,
            ControlledCheckStatus::Failed,
            "{body}: {:?}",
            report.error
        );
        assert!(
            report
                .error
                .as_deref()
                .is_some_and(|error| error.contains(reason)),
            "{body}: expected {reason}, got {:?}",
            report.error
        );
        assert!(report.cleanup.node_confirmed && report.cleanup.temporary_files_removed);
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}

#[test]
fn cancelling_preparation_or_health_ends_only_the_owned_check() {
    for phase in [
        ControlledCheckPhase::Preparing,
        ControlledCheckPhase::Health,
    ] {
        let (dir, context) = fixture("health.status='starting'");
        let cancelled = AtomicBool::new(false);
        let report = dir.run(
            &dir.path().join("project"),
            &ControlledCheckOptions::default(),
            &context,
            &cancelled,
            |p| {
                if p.phase == phase {
                    cancelled.store(true, Ordering::Release)
                }
            },
        );
        assert_eq!(report.status, ControlledCheckStatus::Cancelled);
        assert!(
            report.cleanup.node_confirmed
                && report.cleanup.audio_confirmed
                && report.cleanup.temporary_files_removed
        );
    }
}

#[test]
fn missing_required_artifacts_fail_even_when_none_mode_avoids_audio() {
    let (dir, context) = fixture("");
    let root = dir.path().join("project");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    manifest["audio"]["synthdefs"] = serde_json::json!(["missing.scsyndef"]);
    fs::write(root.join("manifest.json"), manifest.to_string()).unwrap();
    let report = dir.run(
        &root,
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |_| {},
    );
    assert_eq!(report.status, ControlledCheckStatus::Failed);
    assert!(!report.diagnostics.unwrap().static_passed);
    assert!(report.cleanup.node_confirmed && report.cleanup.temporary_files_removed);
}

#[test]
fn unsupported_none_and_external_are_not_executed_or_changed_implicitly() {
    let (dir, context, events) = internal_fixture("", "");
    let root = dir.path().join("project");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    manifest["audio"]["defaultMode"] = serde_json::json!("internal");
    manifest["audio"]["supportedModes"] = serde_json::json!(["internal"]);
    fs::write(root.join("manifest.json"), manifest.to_string()).unwrap();
    let original = fs::read(root.join("manifest.json")).unwrap();
    for mode in [AudioMode::None, AudioMode::External] {
        let options = ControlledCheckOptions {
            mode,
            ..Default::default()
        };
        let report = dir.run(&root, &options, &context, &AtomicBool::new(false), |_| {});
        assert_eq!(report.status, ControlledCheckStatus::NotExecuted);
        assert!(report.environment.node_version.is_none());
    }
    assert!(!events.exists());
    assert_eq!(fs::read(root.join("manifest.json")).unwrap(), original);
}

#[test]
fn internal_audio_exit_node_failure_timeout_and_cancel_all_release_owned_resources() {
    for scenario in ["audioExit", "nodeExit", "audioTimeout", "cancel"] {
        let audio_body = match scenario {
            "audioExit" => "process.exit(3)",
            "audioTimeout" => "socket.once('listening',()=>socket.removeAllListeners('message'))",
            _ => "",
        };
        let node_body = if scenario == "nodeExit" {
            "process.exit(4)"
        } else {
            ""
        };
        let (dir, context, _events) = internal_fixture(node_body, audio_body);
        let options = ControlledCheckOptions {
            mode: AudioMode::Internal,
            timeout_ms: if scenario == "audioTimeout" {
                500
            } else {
                3000
            },
            ..Default::default()
        };
        let cancelled = AtomicBool::new(false);
        let started = Instant::now();
        let report = dir.run(
            &dir.path().join("project"),
            &options,
            &context,
            &cancelled,
            |p| {
                if scenario == "cancel" && p.phase == ControlledCheckPhase::Health {
                    cancelled.store(true, Ordering::Release)
                }
            },
        );
        assert_eq!(
            report.status,
            if scenario == "cancel" {
                ControlledCheckStatus::Cancelled
            } else {
                ControlledCheckStatus::Failed
            },
            "{scenario}: {:?}",
            report.error
        );
        assert!(
            report.cleanup.node_confirmed
                && report.cleanup.audio_confirmed
                && report.cleanup.temporary_files_removed,
            "{scenario}: {:?}",
            report.cleanup
        );
        assert!(started.elapsed() < Duration::from_secs(8), "{scenario}");
    }
}

#[test]
fn malformed_health_and_unavailable_http_entry_cannot_report_success() {
    for failure in ["json", "http"] {
        let (dir, context) = fixture("");
        let root = dir.path().join("project");
        let entry = root.join("server.cjs");
        let body = fs::read_to_string(&entry).unwrap();
        let body = if failure == "json" {
            body.replace("JSON.stringify(health)", "'not-json'")
        } else {
            body.replace(
                "res.end('monitor')",
                "{res.statusCode=503;res.end('unavailable')}",
            )
        };
        fs::write(entry, body).unwrap();
        let options = ControlledCheckOptions {
            timeout_ms: 400,
            ..Default::default()
        };
        let report = dir.run(&root, &options, &context, &AtomicBool::new(false), |_| {});
        assert_eq!(report.status, ControlledCheckStatus::Failed, "{failure}");
        assert!(report.cleanup.node_confirmed && report.cleanup.temporary_files_removed);
    }
}

#[test]
fn stopping_explicit_compilation_reaps_compiler_and_its_children() {
    let (dir, mut context) = fixture("");
    let root = dir.path().join("project");
    fs::create_dir_all(root.join("supercollider/source")).unwrap();
    fs::write(
        root.join("supercollider/source/tone.scd"),
        "controlled source",
    )
    .unwrap();
    let marker = dir.path().join("compiler-started");
    let compiler = dir.path().join("sclang-fixture");
    executable(
        &compiler,
        &format!("#!/bin/sh\necho $$ > '{}'\nsleep 30\n", marker.display()),
    );
    context.test_sclang = Some(compiler);
    let cancelled = Arc::new(AtomicBool::new(false));
    let signal = Arc::clone(&cancelled);
    let watcher = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(3);
        while !marker.exists() && Instant::now() < deadline {
            std::thread::sleep(POLL)
        }
        signal.store(true, Ordering::Release);
    });
    let options = ControlledCheckOptions {
        compile: true,
        timeout_ms: 5000,
        ..Default::default()
    };
    let started = Instant::now();
    let report = dir.run(&root, &options, &context, &cancelled, |_| {});
    watcher.join().unwrap();
    assert_eq!(
        report.status,
        ControlledCheckStatus::Cancelled,
        "{:?}",
        report.error
    );
    assert!(report.cleanup.temporary_files_removed);
    assert!(started.elapsed() < Duration::from_secs(4));
}

#[test]
fn saved_copy_report_becomes_stale_when_original_changes_during_runtime() {
    let (dir, context) = fixture("");
    let root = dir.path().join("project");
    let entry = root.join("server.cjs");
    let report = dir.run(
        &root,
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |p| {
            if p.phase == ControlledCheckPhase::Starting {
                fs::write(&entry, "new saved version").unwrap()
            }
        },
    );
    assert_eq!(
        report.status,
        ControlledCheckStatus::Passed,
        "{:?}",
        report.error
    );
    assert!(report.freshness.unwrap().stale);
    assert_eq!(fs::read_to_string(entry).unwrap(), "new saved version");
}

#[test]
fn journal_finalization_failure_preserves_complete_report_and_primary_outcome() {
    for status in [
        ControlledCheckStatus::Passed,
        ControlledCheckStatus::Cancelled,
        ControlledCheckStatus::Failed,
    ] {
        let mut report = ControlledCheckReport::not_executed(
            "journal-fixture",
            Path::new("/saved/project"),
            AudioMode::None,
            "primary outcome".into(),
        );
        report.status = status;
        report.record_ownership_result(Err("journal append failed".into()));
        let json = serde_json::to_value(&report).unwrap();
        assert_eq!(
            report.status,
            if status == ControlledCheckStatus::Passed {
                ControlledCheckStatus::Failed
            } else {
                status
            }
        );
        assert_eq!(json["taskId"], "journal-fixture");
        assert_eq!(json["cleanup"]["errors"][0], "journal append failed");
        if status != ControlledCheckStatus::Passed {
            assert_eq!(json["error"], "primary outcome");
        }
    }
}

#[test]
fn browser_failure_observation_runs_while_server_is_alive_and_cannot_bypass_cleanup() {
    let (dir, context) = fixture("");
    let root = dir.path().join("project");
    let observed = AtomicBool::new(false);
    let report = dir.run_observed(
        &root,
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |_| {},
        |manifest, report| {
            assert!(session::fetch_health(manifest.score_server.performer_port).is_ok());
            assert_eq!(report.status, ControlledCheckStatus::Passed);
            observed.store(true, Ordering::Release);
            Err("ReferenceError: canvas setup failed".into())
        },
    );
    assert!(observed.load(Ordering::Acquire));
    assert_eq!(report.status, ControlledCheckStatus::Failed);
    assert!(report.error.unwrap().contains("canvas setup failed"));
    assert!(report.cleanup.node_confirmed && report.cleanup.temporary_files_removed);
}

#[test]
#[ignore = "optional private runes project acceptance; copies input and never edits the source"]
fn runes_edit_task_adopts_local_p5_creates_pages_repairs_checks_and_undoes() {
    use super::super::creation::{
        AssistantMode, AssistantWrite, CreationAccess, CreationContent, Protection,
    };
    let source = PathBuf::from(
        std::env::var("PNDS_ASSISTANT_REPLAY_PROJECT").expect("set PNDS_ASSISTANT_REPLAY_PROJECT"),
    );
    let shared = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/shared-libraries");
    let acceptance = tempfile::tempdir().unwrap();
    let snapshot = check_evidence::prepare_snapshot(
        &source,
        Some(&shared),
        acceptance.path(),
        &AtomicBool::new(false),
        |_, _| {},
    )
    .unwrap();
    let root = &snapshot.project_root;
    let (dir, mut context) = fixture("");
    context.shared_root = Some(shared.clone());
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    let [performer, monitor] = dir.values();
    manifest["scoreServer"]["performerPort"] = serde_json::json!(performer);
    manifest["scoreServer"]["monitorPort"] = serde_json::json!(monitor);
    fs::write(
        root.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();
    let protection = Protection::default();
    let data = acceptance.path().join("recovery");
    let before_server = fs::read_to_string(root.join("server.js")).unwrap();
    let before_manifest = fs::read_to_string(root.join("manifest.json")).unwrap();
    let mut access = CreationAccess::default();
    let identity = access.open(root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    let failed = dir.run(
        root,
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |_| {},
    );
    assert_eq!(
        failed.status,
        ControlledCheckStatus::Failed,
        "original task must reproduce the missing-page failure"
    );
    access
        .adopt_assistant_library(&identity, &task.id, "p5", &data, &shared, &protection)
        .unwrap();
    let performer_text = fs::read_to_string(root.join("public/performer.js")).unwrap();
    let monitor_text="<!doctype html><html><head><meta charset=\"utf-8\"><title>Runes</title></head><body><script src=\"/p5.js\"></script><script src=\"/Grid.js\"></script><script src=\"/Pattern.js\"></script><script src=\"/monitor.js\"></script></body></html>";
    for (path, text) in [
        ("public/performer.html", performer_text.as_str()),
        ("public/monitor.html", monitor_text),
    ] {
        access
            .write_assistant_file(
                &identity,
                &task.id,
                &AssistantWrite {
                    path: path.into(),
                    version: None,
                    text: Some(text.into()),
                    edits: None,
                },
                &data,
                &protection,
            )
            .unwrap();
    }
    let server=before_server.replace("const servers = []","const servers = []\nconst assets = new Map()")
        .replace("    } else {\n      response.writeHead(404)","    } else if (assets.has(path)) {\n      response.setHeader('Content-Type', 'application/javascript; charset=utf-8')\n      response.end(request.method === 'HEAD' ? undefined : assets.get(path))\n    } else {\n      response.writeHead(404)")
        .replace("  audio = await createAudio(mode)","  audio = await createAudio(mode)\n  const shared = JSON.parse(process.env.PNDS_SHARED_LIBRARIES ?? '{}')\n  assets.set('/p5.js', await readFile(shared.p5.path))\n  for (const name of ['Grid.js', 'Pattern.js', 'monitor.js']) assets.set('/' + name, await readFile(new URL('./public/' + name, import.meta.url)))");
    let CreationContent::Text { version, .. } =
        access.read(&identity, "server.js", &protection).unwrap()
    else {
        panic!()
    };
    access
        .write_assistant_file(
            &identity,
            &task.id,
            &AssistantWrite {
                path: "server.js".into(),
                version: Some(version),
                text: Some(server),
                edits: None,
            },
            &data,
            &protection,
        )
        .unwrap();
    let passed = dir.run(
        root,
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |_| {},
    );
    assert_eq!(
        passed.status,
        ControlledCheckStatus::Passed,
        "{:?} {:?}",
        passed.error,
        passed.output_tail
    );
    assert!(passed.cleanup.node_confirmed && passed.cleanup.temporary_files_removed);
    assert_eq!(
        access
            .assistant_tasks(&identity, &data, &protection)
            .unwrap()[0]
            .files
            .len(),
        4
    );
    access.end_assistant_task(&identity, &task.id);
    access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        before_server
    );
    assert_eq!(
        fs::read_to_string(root.join("manifest.json")).unwrap(),
        before_manifest
    );
    assert!(!root.join("public/monitor.html").exists());
    assert!(!root.join("public/performer.html").exists());
}

#[test]
fn adapted_saved_check_uses_actual_handed_off_ports_and_cleans_them() {
    let (fixture, context) = fixture("");
    let root = fixture.path().join("project");
    let manifest = root.join("manifest.json");
    let mut value: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
    value["id"] = serde_json::json!("runtime-fixture");
    value["scoreServer"]["runtimePorts"] = serde_json::json!(1);
    fs::write(&manifest, value.to_string()).unwrap();
    fs::write(
        root.join("server.cjs"),
        include_str!("../session/runtime-ports-fixture.cjs"),
    )
    .unwrap();
    fixture.ports.borrow_mut().release_for_start();
    let foreign: Vec<_> = fixture
        .values()
        .into_iter()
        .map(|port| std::net::TcpListener::bind(("0.0.0.0", port)).unwrap())
        .collect();
    let report = fixture.run(
        &root,
        &ControlledCheckOptions::default(),
        &context,
        &AtomicBool::new(false),
        |_| {},
    );
    assert_eq!(
        report.status,
        ControlledCheckStatus::Passed,
        "{:?}",
        report.error
    );
    let server = report.health.unwrap().score_server.unwrap();
    let actual = [server.performer_port.unwrap(), server.monitor_port.unwrap()];
    for (index, port) in actual.into_iter().enumerate() {
        assert_ne!(port, fixture.values()[index]);
        assert!(std::net::TcpListener::bind(("0.0.0.0", port)).is_ok());
    }
    assert!(report.cleanup.node_confirmed && report.cleanup.temporary_files_removed);
    for listener in foreign {
        assert!(listener.local_addr().is_ok());
    }
}
