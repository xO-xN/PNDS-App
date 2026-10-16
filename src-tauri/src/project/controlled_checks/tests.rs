use super::*;
use std::fs;
use std::net::TcpListener;

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}
fn fixture(body: &str) -> (tempfile::TempDir, ControlledCheckContext) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("project");
    fs::create_dir(&root).unwrap();
    let performer = free_port();
    let monitor = free_port();
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
    (dir, context)
}

#[test]
fn saved_none_check_runs_real_node_http_and_cleans_without_source_writes() {
    let (dir, context) = fixture("fs.writeFileSync('generated-cache','copy only');");
    let root = dir.path().join("project");
    let manifest = fs::read(root.join("manifest.json")).unwrap();
    let report = run_controlled_check(
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
            },
            &shared,
            &Protection::default(),
        )
        .unwrap();
    let root = Path::new(&workspace.project.root);
    let path = root.join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let performer = free_port();
    let mut monitor = free_port();
    while monitor == performer {
        monitor = free_port();
    }
    manifest["scoreServer"]["performerPort"] = performer.into();
    manifest["scoreServer"]["monitorPort"] = monitor.into();
    fs::write(&path, manifest.to_string()).unwrap();
    let report = run_controlled_check(
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
        let report = run_controlled_check(
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
    let child_port = free_port();
    let script=format!("const net=require('node:net');process.on('SIGTERM',()=>{{}});net.createServer().listen({child_port},'127.0.0.1',()=>process.stdout.write('ready'))");
    let body=format!("health.status='starting'; const sub=require('node:child_process').spawn(process.execPath,['-e',{}],{{stdio:['ignore','pipe','ignore']}}); sub.stdout.once('data',()=>{{health.status='ready'}}); console.log('descendant='+sub.pid);",serde_json::to_string(&script).unwrap());
    let (dir, context) = fixture(&body);
    let report = run_controlled_check(
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
) -> (tempfile::TempDir, ControlledCheckContext, PathBuf) {
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
    let report = run_controlled_check(
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
        let (dir, context, _) = internal_fixture(body, "");
        let report = run_controlled_check(
            &dir.path().join("project"),
            &ControlledCheckOptions { mode: AudioMode::Internal, timeout_ms: 1500, ..Default::default() },
            &context,
            &AtomicBool::new(false),
            |_| {},
        );
        assert_eq!(report.status, ControlledCheckStatus::Failed, "{body}");
        assert!(report.error.as_deref().is_some_and(|error| error.contains(expected_error)), "{body}: {:?}", report.error);
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
    let report = run_controlled_check(
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
    let report = run_controlled_check(&root, &options, &context, &AtomicBool::new(false), |_| {});
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
    let report = run_controlled_check(
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
    let report = run_controlled_check(
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
        let report = run_controlled_check(
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
        let report = run_controlled_check(
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
    let report = run_controlled_check(
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
        let report =
            run_controlled_check(&root, &options, &context, &AtomicBool::new(false), |_| {});
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
        let report = run_controlled_check(
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
        let report =
            run_controlled_check(&root, &options, &context, &AtomicBool::new(false), |_| {});
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
    let report = run_controlled_check(&root, &options, &context, &cancelled, |_| {});
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
    let report = run_controlled_check(
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
