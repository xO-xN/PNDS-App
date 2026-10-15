use super::*;
use std::fs;
#[test]
fn valid_static_project_reports_runtime_as_unverified_without_changing_files() {
    let dir = tempfile::tempdir().unwrap();
    let manifest = r#"{"schemaVersion":1,"id":"test","name":"Test","version":"1.0.0","scoreServer":{"entry":"server.js","workingDirectory":".","performerPort":6868,"monitorPort":6869},"audio":{"defaultMode":"none","supportedModes":["none"]}}"#;
    fs::write(dir.path().join("manifest.json"), manifest).unwrap();
    fs::write(
        dir.path().join("server.js"),
        "throw new Error('must never execute')",
    )
    .unwrap();
    let report = diagnose_project(dir.path(), None);
    assert!(report.static_passed);
    assert!(report.unverified.contains(&"runtime".to_string()));
    assert!(report.unverified.contains(&"sound".to_string()));
    assert_eq!(
        fs::read_to_string(dir.path().join("manifest.json")).unwrap(),
        manifest
    );
    assert_eq!(
        serde_json::to_string(&report).unwrap(),
        serde_json::to_string(&diagnose_project(dir.path(), None)).unwrap()
    );
}
#[test]
fn bundle_name_constraints_remain_distinct_from_valid_manifest_declarations() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("manifest.json"), r#"{"schemaVersion":1,"id":"test","name":"Test","version":"../bad","scoreServer":{"entry":"server.js","workingDirectory":".","performerPort":6868,"monitorPort":6869},"audio":{"defaultMode":"none","supportedModes":["none"]}}"#).unwrap();
    fs::write(dir.path().join("server.js"), "").unwrap();
    let report = diagnose_project(dir.path(), None);
    assert!(report
        .checks
        .iter()
        .any(|check| check.code == "manifest" && check.status == DiagnosticStatus::Passed));
    assert!(!report.static_passed);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "packaging" && issue.reason.contains("single path segment")));
}
#[test]
fn unreadable_manifest_does_not_infer_that_production_dependencies_are_unshared() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("manifest.json"), "{ unfinished").unwrap();
    fs::write(
        dir.path().join("package.json"),
        r#"{"dependencies":{"express":"5.3.0"}}"#,
    )
    .unwrap();
    let report = diagnose_project(dir.path(), None);
    assert!(report.issues.iter().any(|issue| issue.code == "manifest"));
    assert!(report
        .checks
        .iter()
        .any(|check| check.code == "dependencies" && check.status == DiagnosticStatus::Skipped));
    assert!(!report
        .issues
        .iter()
        .any(|issue| issue.reason.contains("dependencies are missing")));
}
#[test]
fn unfinished_project_reports_independent_paths_dependencies_and_exact_shared_requirements() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("manifest.json"), r#"{"schemaVersion":2,"id":"test","name":"Test","version":"1.0.0","sharedLibraries":[{"id":"p5","version":"2.3.4"}],"scoreServer":{"entry":"server.js","workingDirectory":"work","performerPort":6868,"monitorPort":6869},"audio":{"defaultMode":"none","supportedModes":["none"],"synthdefs":["tone.scsyndef","other.scsyndef"]}}"#).unwrap();
    fs::write(
        dir.path().join("package.json"),
        r#"{"dependencies":{"express":"5.3.0"}}"#,
    )
    .unwrap();
    let report = diagnose_project(dir.path(), Some(&dir.path().join("missing-app-resources")));
    assert!(!report.static_passed);
    for code in [
        "entry",
        "workingDirectory",
        "synthdef",
        "dependencies",
        "sharedLibraries",
    ] {
        assert!(
            report.issues.iter().any(|issue| issue.code == code),
            "{code}: {report:?}"
        );
    }
    assert_eq!(
        report
            .issues
            .iter()
            .filter(|issue| issue.code == "synthdef")
            .count(),
        2
    );
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "sharedLibraries" && issue.reason.contains("p5 2.3.4")));
    assert!(!dir.path().join("node_modules").exists());
    assert!(!dir.path().join("server.js").exists());
}
fn project(root: &Path) -> serde_json::Value {
    let manifest = serde_json::json!({
        "schemaVersion": 1, "id": "test", "name": "Test", "version": "1.0.0",
        "scoreServer": {"entry": "server.js", "workingDirectory": ".", "performerPort": 6868, "monitorPort": 6869},
        "audio": {"defaultMode": "none", "supportedModes": ["none"]}
    });
    fs::write(root.join("manifest.json"), manifest.to_string()).unwrap();
    fs::write(root.join("server.js"), "process.exit(99)").unwrap();
    manifest
}

#[test]
fn escaped_dependency_directory_is_reported_as_an_unusable_resource() {
    let dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    project(dir.path());
    fs::write(
        dir.path().join("package.json"),
        r#"{"dependencies":{"express":"5.3.0"}}"#,
    )
    .unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("node_modules")).unwrap();
    let report = diagnose_project(dir.path(), None);
    assert!(!report.static_passed);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "dependencies" && issue.reason.contains("outside the project")));
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
}
#[test]
fn bounded_and_unreadable_inputs_are_explained_instead_of_reading_or_running_them() {
    use std::os::unix::fs::PermissionsExt;
    for name in ["manifest.json", "package.json"] {
        let dir = tempfile::tempdir().unwrap();
        project(dir.path());
        let path = dir.path().join(name);
        File::create(&path)
            .unwrap()
            .set_len(TEXT_LIMIT + 1)
            .unwrap();
        let report = diagnose_project(dir.path(), None);
        assert!(!report.static_passed);
        assert!(
            report
                .issues
                .iter()
                .any(|issue| issue.reason.contains("static read limit")),
            "{report:?}"
        );
        fs::write(&path, "{}").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0)).unwrap();
        let report = diagnose_project(dir.path(), None);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(!report.static_passed);
        assert!(
            report
                .issues
                .iter()
                .any(|issue| issue.reason.contains("Permission denied")),
            "{report:?}"
        );
    }
    let dir = tempfile::tempdir().unwrap();
    project(dir.path());
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0)).unwrap();
    let report = diagnose_project(dir.path(), None);
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
    assert!(report.issues.iter().any(|issue| issue.code == "project"));
    assert!(report
        .checks
        .iter()
        .any(|check| check.code == "manifest" && check.status == DiagnosticStatus::Skipped));
}

#[test]
fn escaped_manifest_and_package_are_never_read_as_project_content() {
    let dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    project(outside.path());
    fs::write(outside.path().join("package.json"), "{}").unwrap();
    std::os::unix::fs::symlink(
        outside.path().join("manifest.json"),
        dir.path().join("manifest.json"),
    )
    .unwrap();
    std::os::unix::fs::symlink(
        outside.path().join("package.json"),
        dir.path().join("package.json"),
    )
    .unwrap();
    let report = diagnose_project(dir.path(), None);
    assert!(report.project.is_none());
    assert!(!report.inputs.iter().any(|input| input.kind == "content"));
    assert!(
        report
            .issues
            .iter()
            .filter(|issue| issue.reason.contains("outside the project"))
            .count()
            >= 2
    );
}

#[test]
fn relative_escaping_and_wrong_kind_assets_produce_separate_located_issues() {
    let dir = tempfile::tempdir().unwrap();
    let mut manifest = project(dir.path());
    manifest["scoreServer"]["entry"] = "../outside.js".into();
    manifest["scoreServer"]["workingDirectory"] = "server.js".into();
    manifest["audio"]["synthdefs"] = serde_json::json!(["/tmp/absolute.scsyndef", "."]);
    fs::write(dir.path().join("manifest.json"), manifest.to_string()).unwrap();
    let report = diagnose_project(dir.path(), None);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.field.as_deref() == Some("scoreServer.entry")
            && issue.reason.contains("must not escape")));
    assert!(report.issues.iter().any(|issue| issue.field.as_deref()
        == Some("scoreServer.workingDirectory")
        && issue.reason.contains("directory")));
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.field.as_deref() == Some("audio.synthdefs[0]")
            && issue.reason.contains("relative")));
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.field.as_deref() == Some("audio.synthdefs[1]")
            && issue.reason.contains("file")));
}

#[test]
fn unchanged_inputs_are_deterministic_and_saved_manifest_or_asset_changes_invalidate_them() {
    let dir = tempfile::tempdir().unwrap();
    let mut manifest = project(dir.path());
    let initial = diagnose_project(dir.path(), None);
    assert_eq!(
        initial.input_fingerprint,
        diagnose_project(dir.path(), None).input_fingerprint
    );
    fs::write(dir.path().join("server.js"), "changed server source").unwrap();
    let changed = diagnose_project(dir.path(), None);
    assert_ne!(initial.input_fingerprint, changed.input_fingerprint);
    manifest["version"] = "1.0.1".into();
    fs::write(dir.path().join("manifest.json"), manifest.to_string()).unwrap();
    let changed_manifest = diagnose_project(dir.path(), None);
    assert_ne!(
        changed.input_fingerprint,
        changed_manifest.input_fingerprint
    );
    assert_eq!(changed_manifest.project.unwrap().version, "1.0.1");
}

fn shared_fixture(root: &Path) {
    fs::create_dir_all(root.join("browser")).unwrap();
    fs::create_dir_all(root.join("node")).unwrap();
    fs::write(root.join("browser/p5.js"), "original").unwrap();
    fs::write(root.join("node/express.js"), "original").unwrap();
    fs::write(root.join("catalog.json"), serde_json::json!({"schemaVersion":1,"libraries":[
            {"id":"p5","version":"2.3.4","kind":"browser","entry":"browser/p5.js","source":{"url":"https://registry.npmjs.org/p5","integrity":"fixture"},"files":[{"path":"browser/p5.js","bytes":8,"sha256":"0682c5f2076f099c34cfdd15a9e063849ed437a49677e6fcc5b4198c76575be5"}]},
            {"id":"express","version":"5.3.0","kind":"node","entry":"node/express.js","source":{"url":"https://registry.npmjs.org/express","integrity":"fixture"},"files":[{"path":"node/express.js","bytes":8,"sha256":"0682c5f2076f099c34cfdd15a9e063849ed437a49677e6fcc5b4198c76575be5"}]}
        ]}).to_string()).unwrap();
}

#[test]
fn exact_shared_declarations_and_resource_integrity_are_checked_without_local_dependencies() {
    let dir = tempfile::tempdir().unwrap();
    let resources = tempfile::tempdir().unwrap();
    shared_fixture(resources.path());
    let mut manifest = project(dir.path());
    manifest["schemaVersion"] = 2.into();
    manifest["sharedLibraries"] =
        serde_json::json!([{"id":"p5","version":"2.3.4"},{"id":"express","version":"5.3.0"}]);
    fs::write(dir.path().join("manifest.json"), manifest.to_string()).unwrap();
    fs::write(
        dir.path().join("package.json"),
        r#"{"dependencies":{"express":"5.3.0"}}"#,
    )
    .unwrap();
    let initial = diagnose_project(dir.path(), Some(resources.path()));
    assert!(initial.static_passed, "{initial:?}");
    assert!(!dir.path().join("node_modules").exists());
    fs::write(resources.path().join("node/express.js"), "tampered").unwrap();
    manifest["sharedLibraries"][0]["version"] = "2.3.5".into();
    fs::write(dir.path().join("manifest.json"), manifest.to_string()).unwrap();
    let report = diagnose_project(dir.path(), Some(resources.path()));
    assert_ne!(initial.input_fingerprint, report.input_fingerprint);
    assert_eq!(
        report
            .issues
            .iter()
            .filter(|issue| issue.code == "sharedLibraries")
            .count(),
        2
    );
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.reason.contains("p5 2.3.5")
            && issue.reason.contains("no version substitution")));
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.reason.contains("express 5.3.0")
            && issue.reason.contains("SHA-256 mismatch")));
}

#[test]
fn active_ports_and_internal_artifact_files_never_claim_runtime_or_sound_validation() {
    let dir = tempfile::tempdir().unwrap();
    let performer = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let monitor = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let mut manifest = project(dir.path());
    manifest["scoreServer"]["performerPort"] = performer.local_addr().unwrap().port().into();
    manifest["scoreServer"]["monitorPort"] = monitor.local_addr().unwrap().port().into();
    manifest["audio"] = serde_json::json!({"defaultMode":"internal","supportedModes":["internal"],"synthdefs":["tone.scsyndef"],"scsynth":{"blockSize":64,"audioBusChannels":128}});
    fs::write(dir.path().join("manifest.json"), manifest.to_string()).unwrap();
    fs::write(
        dir.path().join("tone.scsyndef"),
        "fixture only; no validated sound",
    )
    .unwrap();
    let report = diagnose_project(dir.path(), None);
    assert!(report.static_passed, "{report:?}");
    assert!(report.unverified.contains(&"sound".to_string()));
    assert!(report.unverified.contains(&"ports".to_string()));
    std::net::TcpStream::connect(performer.local_addr().unwrap()).unwrap();
    performer.accept().unwrap();
    std::net::TcpStream::connect(monitor.local_addr().unwrap()).unwrap();
    monitor.accept().unwrap();
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 3);
    assert_eq!(
        fs::read_to_string(dir.path().join("server.js")).unwrap(),
        "process.exit(99)"
    );
}

#[test]
fn oversized_shared_inventories_are_explained_without_hashing_sparse_large_files() {
    let dir = tempfile::tempdir().unwrap();
    let resources = tempfile::tempdir().unwrap();
    shared_fixture(resources.path());
    let mut manifest = project(dir.path());
    manifest["schemaVersion"] = 2.into();
    manifest["sharedLibraries"] = serde_json::json!([{"id":"express","version":"5.3.0"}]);
    fs::write(dir.path().join("manifest.json"), manifest.to_string()).unwrap();
    let catalog_path = resources.path().join("catalog.json");
    let original: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&catalog_path).unwrap()).unwrap();
    let mut oversized = original.clone();
    oversized["libraries"][1]["files"][0]["bytes"] = (RESOURCE_LIMIT + 1).into();
    File::create(resources.path().join("node/express.js"))
        .unwrap()
        .set_len(RESOURCE_LIMIT + 1)
        .unwrap();
    fs::write(&catalog_path, oversized.to_string()).unwrap();
    let report = diagnose_project(dir.path(), Some(resources.path()));
    assert!(!report.static_passed);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "sharedLibraries" && issue.reason.contains("64 MiB/file")));
    let mut aggregate = original;
    let mut files = Vec::new();
    for index in 0..17 {
        let name = if index == 0 {
            "node/express.js".to_string()
        } else {
            format!("node/asset-{index}.js")
        };
        File::create(resources.path().join(&name))
            .unwrap()
            .set_len(32 * TEXT_LIMIT)
            .unwrap();
        files.push(serde_json::json!({"path":name,"bytes":32*TEXT_LIMIT,"sha256":"0682c5f2076f099c34cfdd15a9e063849ed437a49677e6fcc5b4198c76575be5"}));
    }
    aggregate["libraries"][1]["files"] = files.into();
    fs::write(&catalog_path, aggregate.to_string()).unwrap();
    let report = diagnose_project(dir.path(), Some(resources.path()));
    assert!(!report.static_passed);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "sharedLibraries" && issue.reason.contains("512 MiB/report")));
}

#[test]
fn replacement_shared_links_and_nonregular_inputs_remain_explicit_failures() {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let dir = tempfile::tempdir().unwrap();
    let resources = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    shared_fixture(resources.path());
    let mut manifest = project(dir.path());
    manifest["schemaVersion"] = 2.into();
    manifest["sharedLibraries"] = serde_json::json!([{"id":"express","version":"5.3.0"}]);
    fs::write(dir.path().join("manifest.json"), manifest.to_string()).unwrap();
    assert!(diagnose_project(dir.path(), Some(resources.path())).static_passed);
    let entry = resources.path().join("node/express.js");
    fs::rename(&entry, resources.path().join("node/original.js")).unwrap();
    std::os::unix::fs::symlink("original.js", &entry).unwrap();
    assert!(diagnose_project(dir.path(), Some(resources.path())).static_passed);
    fs::rename(&entry, resources.path().join("node/previous-link")).unwrap();
    fs::write(outside.path().join("express.js"), "original").unwrap();
    std::os::unix::fs::symlink(outside.path().join("express.js"), &entry).unwrap();
    let report = diagnose_project(dir.path(), Some(resources.path()));
    assert!(!report.static_passed);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "sharedLibraries"));
    fs::rename(&entry, resources.path().join("node/escaped-link")).unwrap();
    let fifo = CString::new(entry.as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
    let report = diagnose_project(dir.path(), Some(resources.path()));
    assert!(!report.static_passed);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "sharedLibraries" && issue.reason.contains("not a file")));
    let catalog = resources.path().join("catalog.json");
    fs::rename(&catalog, resources.path().join("previous-catalog.json")).unwrap();
    let fifo = CString::new(catalog.as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
    let report = diagnose_project(dir.path(), Some(resources.path()));
    assert!(!report.static_passed);
    assert!(report.issues.iter().any(
        |issue| issue.code == "sharedLibraries" && issue.reason.contains("not a regular file")
    ));
}

#[test]
fn concurrent_shared_replacements_never_hash_or_parse_external_bytes() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Barrier};
    for relative in ["node/express.js", "catalog.json"] {
        let dir = tempfile::tempdir().unwrap();
        let resources = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        shared_fixture(resources.path());
        let mut manifest = project(dir.path());
        manifest["schemaVersion"] = 2.into();
        manifest["sharedLibraries"] = serde_json::json!([{"id":"express","version":"5.3.0"}]);
        fs::write(dir.path().join("manifest.json"), manifest.to_string()).unwrap();
        assert!(diagnose_project(dir.path(), Some(resources.path())).static_passed);
        let target = resources.path().join(relative);
        let original = fs::read(&target).unwrap();
        let external = outside.path().join("external");
        // All legitimate in-root replacements remain valid. Either of these
        // errors would show the checker read the deliberately invalid outsider.
        fs::write(&external, "external").unwrap();
        let active = Arc::new(AtomicBool::new(true));
        let barrier = Arc::new(Barrier::new(2));
        let writer_active = active.clone();
        let writer_barrier = barrier.clone();
        let writer = std::thread::spawn(move || {
            let normal = target.with_extension("normal-next");
            let redirect = target.with_extension("redirect-next");
            writer_barrier.wait();
            while writer_active.load(Ordering::Acquire) {
                fs::write(&normal, &original).unwrap();
                fs::rename(&normal, &target).unwrap();
                std::os::unix::fs::symlink(&external, &redirect).unwrap();
                fs::rename(&redirect, &target).unwrap();
            }
        });
        barrier.wait();
        let mut outside_read = None;
        for _ in 0..60 {
            let report = diagnose_project(dir.path(), Some(resources.path()));
            if let Some(issue) = report.issues.iter().find(|issue| {
                issue.reason.contains("SHA-256 mismatch")
                    || issue.reason.contains("catalog is invalid")
            }) {
                outside_read = Some(issue.reason.clone());
                break;
            }
        }
        active.store(false, Ordering::Release);
        writer.join().unwrap();
        assert!(outside_read.is_none(), "{relative}: {outside_read:?}");
    }
}

#[test]
fn replacing_the_shared_root_during_integrity_read_invalidates_the_public_report() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, SystemTime};
    let dir = tempfile::tempdir().unwrap();
    let parent = tempfile::tempdir().unwrap();
    let resources = parent.path().join("resources");
    let replacement = parent.path().join("replacement");
    fs::create_dir(&resources).unwrap();
    fs::create_dir(&replacement).unwrap();
    shared_fixture(&resources);
    let entry = resources.join("node/express.js");
    File::create(&entry)
        .unwrap()
        .set_len(RESOURCE_LIMIT)
        .unwrap();
    let path = resources.join("catalog.json");
    let mut catalog: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    catalog["libraries"][1]["files"][0]["bytes"] = RESOURCE_LIMIT.into();
    catalog["libraries"][1]["files"][0]["sha256"] =
        "3b6a07d0d404fab4e23b6d34bc6696a6a312dd92821332385e5af7c01c421351".into();
    fs::write(&path, catalog.to_string()).unwrap();
    fs::create_dir(replacement.join("node")).unwrap();
    // Even identical catalog/resource identities must not bless a different
    // directory object at the selected root path.
    fs::hard_link(&entry, replacement.join("node/express.js")).unwrap();
    fs::hard_link(&path, replacement.join("catalog.json")).unwrap();
    File::open(&entry)
        .unwrap()
        .set_times(fs::FileTimes::new().set_accessed(SystemTime::UNIX_EPOCH))
        .unwrap();
    let mut manifest = project(dir.path());
    manifest["schemaVersion"] = 2.into();
    manifest["sharedLibraries"] = serde_json::json!([{"id":"express","version":"5.3.0"}]);
    fs::write(dir.path().join("manifest.json"), manifest.to_string()).unwrap();
    let active = Arc::new(AtomicBool::new(true));
    let writer_active = active.clone();
    let resource_path = resources.clone();
    let previous = parent.path().join("previous-root");
    let writer = std::thread::spawn(move || {
        // Access time changes only once the checker starts reading integrity
        // bytes; directory observations and File::open alone do not trigger it.
        while writer_active.load(Ordering::Acquire) {
            if fs::metadata(&entry).unwrap().accessed().unwrap() != SystemTime::UNIX_EPOCH {
                fs::rename(&resource_path, &previous).unwrap();
                fs::rename(&replacement, &resource_path).unwrap();
                return true;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        false
    });
    let report = diagnose_project(dir.path(), Some(&resources));
    active.store(false, Ordering::Release);
    let replaced = writer.join().unwrap();
    assert!(
        replaced,
        "fixture must replace the directory while integrity bytes are read"
    );
    assert!(!report.static_passed, "{report:?}");
    assert!(
        report
            .issues
            .iter()
            .any(|issue| issue.code == "sharedLibraries"
                && issue.reason.contains("directory changed")),
        "{report:?}"
    );
}
