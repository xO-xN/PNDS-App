//! The public CLI seam: actual binary, temporary projects, stdout and exit codes.
use pnds_app_lib::diagnose_project;
use serde_json::{json, Value};
use std::fs;
use std::os::fd::FromRawFd;
use std::path::Path;
use std::process::{Child, Command, Output, Stdio};

fn project(root: &Path) {
    fs::write(
        root.join("manifest.json"),
        json!({
            "schemaVersion": 1, "id": "cli-project", "name": "CLI project", "version": "0.1.0",
            "scoreServer": {"entry": "server.js", "workingDirectory": ".", "performerPort": 6868, "monitorPort": 6869},
            "audio": {"defaultMode": "none", "supportedModes": ["none"]}
        }).to_string(),
    ).unwrap();
    fs::write(
        root.join("server.js"),
        "throw new Error('static check must never execute this');",
    )
    .unwrap();
}

fn check(root: &Path, resources: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_pnds"))
        .arg("check")
        .arg(root)
        .arg("--json")
        .arg("--resources-root")
        .arg(resources)
        .output()
        .unwrap()
}

#[test]
fn valid_project_json_matches_the_public_app_diagnostic_report() {
    let temp = tempfile::tempdir().unwrap();
    project(temp.path());
    let resources = temp.path().join("absent-resources");
    let output = check(temp.path(), &resources);
    assert_eq!(
        output.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["staticPassed"], true);
    assert!(!report["unverified"].as_array().unwrap().is_empty());
    assert_eq!(
        report,
        serde_json::to_value(diagnose_project(temp.path(), Some(&resources))).unwrap()
    );
}

#[test]
fn malformed_or_incomplete_projects_return_reports_and_exit_one() {
    let temp = tempfile::tempdir().unwrap();
    for declaration in ["{ invalid JSON", "{}"] {
        fs::write(temp.path().join("manifest.json"), declaration).unwrap();
        let output = check(temp.path(), &temp.path().join("missing"));
        assert_eq!(output.status.code(), Some(1));
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["staticPassed"], false);
        assert_eq!(
            report,
            serde_json::to_value(diagnose_project(
                temp.path(),
                Some(&temp.path().join("missing"))
            ))
            .unwrap()
        );
        assert!(report["issues"]
            .as_array()
            .unwrap()
            .iter()
            .any(|issue| issue["code"] == "manifest"));
        assert!(report["checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["status"] == "skipped"));
    }
}

fn shared_project(root: &Path) {
    project(root);
    let manifest_path = root.join("manifest.json");
    let mut declaration: Value =
        serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    declaration["schemaVersion"] = json!(2);
    declaration["sharedLibraries"] = json!([{"id": "p5", "version": "2.3.4"}]);
    fs::write(manifest_path, declaration.to_string()).unwrap();
}

fn shared_resources(root: &Path) {
    fs::create_dir_all(root.join("browser")).unwrap();
    fs::write(root.join("browser/p5.js"), b"original").unwrap();
    fs::write(root.join("catalog.json"), json!({
        "schemaVersion": 1,
        "libraries": [{
            "id": "p5", "version": "2.3.4", "kind": "browser", "entry": "browser/p5.js",
            "source": {"url": "https://registry.npmjs.org/fixture.tgz", "integrity": "sha512-fixture"},
            "files": [{"path": "browser/p5.js", "bytes": 8, "sha256": "0682c5f2076f099c34cfdd15a9e063849ed437a49677e6fcc5b4198c76575be5"}]
        }]
    }).to_string()).unwrap();
}

#[test]
fn installed_executable_finds_fixed_resources_offline_and_reports_missing_bytes() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("project with spaces");
    fs::create_dir(&root).unwrap();
    shared_project(&root);
    let contents = temp.path().join("Moved PNDS.app/Contents");
    let macos = contents.join("MacOS");
    fs::create_dir_all(&macos).unwrap();
    let binary = macos.join("pnds");
    fs::copy(env!("CARGO_BIN_EXE_pnds"), &binary).unwrap();
    let resources = contents.join("Resources/shared-libraries");
    shared_resources(&resources);
    let run = || {
        Command::new(&binary)
            .arg("check")
            .arg(&root)
            .arg("--json")
            .current_dir(temp.path())
            .env_clear()
            .output()
            .unwrap()
    };
    let output = run();
    assert_eq!(
        output.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let expected = serde_json::to_value(diagnose_project(&root, Some(&resources))).unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap(),
        expected
    );
    assert_eq!(run().stdout, output.stdout);
    fs::remove_file(resources.join("browser/p5.js")).unwrap();
    let output = run();
    assert_eq!(output.status.code(), Some(1));
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(
        report,
        serde_json::to_value(diagnose_project(&root, Some(&resources))).unwrap()
    );
    assert!(report["issues"]
        .as_array()
        .unwrap()
        .iter()
        .any(|issue| issue["code"] == "sharedLibraries"));
    let output = check(&root, &temp.path().join("missing-resources"));
    assert_eq!(
        output.status.code(),
        Some(1),
        "explicit missing resources must not fall back to a developer catalog"
    );
}

struct RunningChild(Child);

impl Drop for RunningChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn checking_preserves_project_bytes_occupied_ports_and_an_active_process() {
    let temp = tempfile::tempdir().unwrap();
    project(temp.path());
    let performer = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let monitor = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let manifest_path = temp.path().join("manifest.json");
    let mut manifest: Value = serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest["scoreServer"]["performerPort"] = json!(performer.local_addr().unwrap().port());
    manifest["scoreServer"]["monitorPort"] = json!(monitor.local_addr().unwrap().port());
    fs::write(&manifest_path, manifest.to_string()).unwrap();
    fs::write(temp.path().join("server.js"), "require('fs').writeFileSync(__dirname + '/started-by-check', 'unexpected'); setInterval(() => {}, 1000);").unwrap();
    let before = [
        fs::read(&manifest_path).unwrap(),
        fs::read(temp.path().join("server.js")).unwrap(),
    ];
    let mut active = RunningChild(Command::new("/bin/sleep").arg("60").spawn().unwrap());
    let output = check(temp.path(), &temp.path().join("missing"));
    assert_eq!(output.status.code(), Some(0));
    assert!(active.0.try_wait().unwrap().is_none());
    assert_eq!(
        before,
        [
            fs::read(&manifest_path).unwrap(),
            fs::read(temp.path().join("server.js")).unwrap()
        ]
    );
    assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 2);
    assert!(std::net::TcpListener::bind(performer.local_addr().unwrap()).is_err());
    assert!(std::net::TcpListener::bind(monitor.local_addr().unwrap()).is_err());
}

#[test]
fn invalid_invocations_and_output_errors_exit_two() {
    for args in [
        vec![],
        vec!["check"],
        vec!["check", "--unknown"],
        vec!["start"],
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_pnds"))
            .args(args)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        assert!(!output.stderr.is_empty());
    }
    let mut descriptors = [0; 2];
    // SAFETY: pipe initializes two valid owned descriptors on success.
    assert_eq!(unsafe { libc::pipe(descriptors.as_mut_ptr()) }, 0);
    // SAFETY: each successfully created descriptor is owned by exactly one File.
    let reader = unsafe { fs::File::from_raw_fd(descriptors[0]) };
    let writer = unsafe { fs::File::from_raw_fd(descriptors[1]) };
    drop(reader);
    let output = Command::new(env!("CARGO_BIN_EXE_pnds"))
        .arg("--help")
        .stdout(Stdio::from(writer))
        .output()
        .unwrap();
    assert_eq!(
        output.status.code(),
        Some(2),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn human_output_explains_skipped_and_unverified_scope() {
    let temp = tempfile::tempdir().unwrap();
    fs::write(temp.path().join("manifest.json"), "{}").unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_pnds"))
        .arg("check")
        .arg(temp.path())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("Static checks passed: false"));
    assert!(text.contains("[Skipped]"));
    assert!(text.contains("[Error] manifest"));
    assert!(text.contains("[Unverified] runtime"));
    assert!(text.contains("[Unverified] sound"));
}
