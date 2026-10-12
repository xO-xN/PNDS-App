//! Confirmed seam: trusted engineering-file workflow with controlled sclang.
use super::compile::SynthdefReferenceStatus;
use super::tests::project;
use super::*;

#[test]
fn creation_compiles_the_whole_standard_source_set_and_checks_every_declared_reference() {
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "compile");
    fs::create_dir_all(root.join("supercollider/source")).unwrap();
    fs::write(root.join("supercollider/source/a.scd"), "// first").unwrap();
    fs::write(root.join("supercollider/source/b.scd"), "// second").unwrap();
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    manifest["audio"]["synthdefs"] = serde_json::json!(["supercollider/synthdefs/voice.scsyndef"]);
    fs::write(
        root.join("manifest.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    let compiler = temp.path().join("sclang");
    fs::write(
        &compiler,
        r#"#!/bin/sh
[ "$#" -eq 4 ] || exit 9
printf '\123\103\147\146\000\000\000\002\000\001\005voice' > "$2/voice.scsyndef"
echo compiled-both-sources
"#,
    )
    .unwrap();
    fs::set_permissions(&compiler, fs::Permissions::from_mode(0o755)).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let job = access.prepare_synthdefs(&identity, &protection).unwrap();
    let output = job.run(&SynthdefCompiler {
        sclang: Ok(compiler.clone()),
        timeout: Duration::from_secs(5),
    });
    let report = access.finish_synthdefs(output, &protection).unwrap();
    assert_eq!(report.sclang_path, Some(compiler.display().to_string()));
    assert_eq!(report.produced, ["voice.scsyndef"]);
    assert!(report.error.is_none(), "{report:?}");
    assert_eq!(report.references.len(), 1);
    assert_eq!(
        report.references[0].status,
        SynthdefReferenceStatus::Verified
    );
    assert!(report.output.contains("compiled-both-sources"));
    assert!(access
        .list(&identity, &protection)
        .unwrap()
        .iter()
        .any(|file| file.path == "supercollider/synthdefs/voice.scsyndef"));
}

#[test]
fn creation_compile_timeout_terminates_the_compiler_and_its_children() {
    use std::os::unix::fs::PermissionsExt;
    use std::time::{Duration, Instant};
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "timeout");
    fs::create_dir_all(root.join("supercollider/source")).unwrap();
    fs::write(root.join("supercollider/source/voice.scd"), "// source").unwrap();
    let executable = temp.path().join("sclang");
    let pid_file = temp.path().join("child.pid");
    fs::write(
        &executable,
        format!(
            "#!/bin/sh\nsleep 60 &\necho $! > '{}'\necho waiting-for-compiler\nwait\n",
            pid_file.display()
        ),
    )
    .unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let started = Instant::now();
    let output = access
        .prepare_synthdefs(&identity, &protection)
        .unwrap()
        .run(&SynthdefCompiler {
            sclang: Ok(executable),
            timeout: Duration::from_millis(1000),
        });
    let report = access.finish_synthdefs(output, &protection).unwrap();
    assert!(report.error.unwrap().contains("terminated"));
    assert!(report.produced.is_empty());
    assert_eq!(
        report.references[0].status,
        SynthdefReferenceStatus::NotChecked
    );
    assert!(started.elapsed() < Duration::from_secs(5));
    let pid: i32 = fs::read_to_string(pid_file)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert_ne!(
        unsafe { libc::kill(pid, 0) },
        0,
        "compiler child survived timeout"
    );
}

#[test]
fn creation_compile_checks_missing_invalid_and_escaping_references_in_none_mode() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    use std::time::Duration;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "references");
    fs::create_dir_all(root.join("supercollider/source")).unwrap();
    fs::create_dir_all(root.join("supercollider/synthdefs")).unwrap();
    fs::write(root.join("supercollider/source/voice.scd"), "// source").unwrap();
    fs::write(
        root.join("supercollider/synthdefs/stale.scsyndef"),
        b"SCgf\0\0\0\x02\0\x01\x05stale",
    )
    .unwrap();
    fs::write(
        root.join("supercollider/synthdefs/wrong.scsyndef"),
        b"SCgf\0\0\0\x02\0\x01\x05other",
    )
    .unwrap();
    fs::write(
        temp.path().join("outside.scsyndef"),
        b"SCgf\0\0\0\x02\0\x01\x07outside",
    )
    .unwrap();
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    manifest["audio"] = serde_json::json!({"defaultMode":"none", "supportedModes":["none"], "synthdefs":["supercollider/synthdefs/voice.scsyndef", "supercollider/synthdefs/missing.scsyndef", "supercollider/synthdefs/wrong.scsyndef", "alias.scsyndef", "../outside.scsyndef", "supercollider/synthdefs/stale.scsyndef"]});
    fs::write(
        root.join("manifest.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    let compiler = temp.path().join("sclang");
    fs::write(
        &compiler,
        r#"#!/bin/sh
printf '\123\103\147\146\000\000\000\002\000\001\005voice' > "$2/voice.scsyndef"
"#,
    )
    .unwrap();
    fs::set_permissions(&compiler, fs::Permissions::from_mode(0o755)).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    symlink(
        temp.path().join("outside.scsyndef"),
        root.join("alias.scsyndef"),
    )
    .unwrap();
    let output = access
        .prepare_synthdefs(&identity, &protection)
        .unwrap()
        .run(&SynthdefCompiler {
            sclang: Ok(compiler),
            timeout: Duration::from_secs(5),
        });
    let report = access.finish_synthdefs(output, &protection).unwrap();
    assert!(report.error.unwrap().contains("every manifest"));
    assert_eq!(report.produced, ["voice.scsyndef"]);
    assert_eq!(
        report
            .references
            .iter()
            .map(|reference| reference.status)
            .collect::<Vec<_>>(),
        [
            SynthdefReferenceStatus::Verified,
            SynthdefReferenceStatus::Missing,
            SynthdefReferenceStatus::Invalid,
            SynthdefReferenceStatus::Invalid,
            SynthdefReferenceStatus::Invalid,
            SynthdefReferenceStatus::Verified
        ]
    );
}

#[test]
fn creation_compile_refuses_to_overwrite_artifacts_changed_while_the_compiler_ran() {
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "conflict");
    fs::create_dir_all(root.join("supercollider/source")).unwrap();
    fs::create_dir_all(root.join("supercollider/synthdefs")).unwrap();
    fs::write(root.join("supercollider/source/voice.scd"), "// source").unwrap();
    let artifact = root.join("supercollider/synthdefs/voice.scsyndef");
    fs::write(&artifact, b"old version").unwrap();
    let compiler = temp.path().join("sclang");
    fs::write(
        &compiler,
        r#"#!/bin/sh
printf '\123\103\147\146\000\000\000\002\000\001\005voice' > "$2/voice.scsyndef"
"#,
    )
    .unwrap();
    fs::set_permissions(&compiler, fs::Permissions::from_mode(0o755)).unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let job = access.prepare_synthdefs(&identity, &protection).unwrap();
    fs::write(&artifact, b"external author change").unwrap();
    let output = job.run(&SynthdefCompiler {
        sclang: Ok(compiler),
        timeout: Duration::from_secs(5),
    });
    assert_eq!(
        access
            .finish_synthdefs(output, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    assert_eq!(fs::read(&artifact).unwrap(), b"external author change");
}

#[test]
fn creation_compile_reports_missing_compiler_process_failure_silent_success_and_name_mismatch() {
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "errors");
    fs::create_dir_all(root.join("supercollider/source")).unwrap();
    fs::write(root.join("supercollider/source/voice.scd"), "// source").unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let missing = SynthdefCompiler {
        sclang: Err("SuperCollider not found; install sclang or add it to PATH".into()),
        timeout: Duration::from_secs(5),
    };
    let report = access
        .finish_synthdefs(
            access
                .prepare_synthdefs(&identity, &protection)
                .unwrap()
                .run(&missing),
            &protection,
        )
        .unwrap();
    assert!(report.error.unwrap().contains("PATH"));
    assert!(report.sclang_path.is_none());
    assert!(report.produced.is_empty());
    for (body, message) in [
        (
            "echo 'ERROR: parse failure'; echo 'compiler stderr' >&2; exit 7",
            "exit code 7",
        ),
        ("exit 0", "produced no"),
        (
            r#"printf '\123\103\147\146\000\000\000\002\000\001\005other' > "$2/voice.scsyndef""#,
            "embedded name",
        ),
    ] {
        let compiler = temp.path().join("sclang");
        fs::write(&compiler, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(&compiler, fs::Permissions::from_mode(0o755)).unwrap();
        let output = access
            .prepare_synthdefs(&identity, &protection)
            .unwrap()
            .run(&SynthdefCompiler {
                sclang: Ok(compiler),
                timeout: Duration::from_secs(5),
            });
        let report = access.finish_synthdefs(output, &protection).unwrap();
        let error = report.error.unwrap();
        assert!(error.contains(message), "{error}");
        if message == "exit code 7" {
            assert!(error.contains("ERROR: parse failure"));
            assert!(error.contains("compiler stderr"));
        }
        assert!(report.produced.is_empty());
        assert_eq!(
            report.references[0].status,
            SynthdefReferenceStatus::NotChecked
        );
        assert!(!root.join("supercollider/synthdefs/voice.scsyndef").exists());
    }
}

#[test]
fn creation_compile_enforces_identity_editable_source_and_unchanged_inputs() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    use std::time::Duration;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "scope");
    fs::create_dir_all(root.join("supercollider/source")).unwrap();
    fs::write(root.join("supercollider/source/voice.scd"), "// source").unwrap();
    let compiler = temp.path().join("sclang");
    fs::write(
        &compiler,
        r#"#!/bin/sh
printf '\123\103\147\146\000\000\000\002\000\001\005voice' > "$2/voice.scsyndef"
"#,
    )
    .unwrap();
    fs::set_permissions(&compiler, fs::Permissions::from_mode(0o755)).unwrap();
    let compiler = SynthdefCompiler {
        sclang: Ok(compiler),
        timeout: Duration::from_secs(5),
    };
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    assert_eq!(
        access
            .prepare_synthdefs("raw-root-or-forged", &protection)
            .err()
            .unwrap()
            .code,
        CreationErrorCode::InvalidIdentity
    );
    let output = access
        .prepare_synthdefs(&identity, &protection)
        .unwrap()
        .run(&compiler);
    fs::write(
        root.join("supercollider/source/voice.scd"),
        "// newer source",
    )
    .unwrap();
    assert_eq!(
        access
            .finish_synthdefs(output, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    assert!(!root.join("supercollider/synthdefs").exists());
    let output = access
        .prepare_synthdefs(&identity, &protection)
        .unwrap()
        .run(&compiler);
    let other = project(temp.path(), "other");
    access.open(&other, &protection).unwrap();
    assert_eq!(
        access
            .finish_synthdefs(output, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
    let protected = Protection {
        bundles: vec![root.clone()],
        utilities: vec![],
    };
    let identity = access.open(&root, &protected).unwrap().project.identity;
    assert_eq!(
        access
            .prepare_synthdefs(&identity, &protected)
            .err()
            .unwrap()
            .code,
        CreationErrorCode::Permission
    );
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    symlink(&outside, root.join("supercollider/synthdefs")).unwrap();
    assert_eq!(
        access
            .prepare_synthdefs(&identity, &protection)
            .err()
            .unwrap()
            .code,
        CreationErrorCode::PathEscape
    );
    assert!(fs::read_dir(outside).unwrap().next().is_none());
}

#[test]
fn creation_compile_reports_absent_sources_and_can_compile_without_declared_references() {
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "no-references");
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    assert_eq!(
        access
            .prepare_synthdefs(&identity, &protection)
            .err()
            .unwrap()
            .code,
        CreationErrorCode::Missing
    );
    fs::create_dir_all(root.join("supercollider/source")).unwrap();
    assert_eq!(
        access
            .prepare_synthdefs(&identity, &protection)
            .err()
            .unwrap()
            .code,
        CreationErrorCode::Missing
    );
    fs::write(root.join("supercollider/source/voice.scd"), "// source").unwrap();
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    manifest["audio"] =
        serde_json::json!({"defaultMode": "external", "supportedModes": ["external"]});
    let CreationContent::Text { version, .. } = access
        .read(&identity, "manifest.json", &protection)
        .unwrap()
    else {
        panic!("manifest text");
    };
    access
        .save(
            &identity,
            "manifest.json",
            &serde_json::to_string(&manifest).unwrap(),
            &version,
            &protection,
        )
        .unwrap();
    let compiler = temp.path().join("sclang");
    fs::write(
        &compiler,
        r#"#!/bin/sh
printf '\123\103\147\146\000\000\000\002\000\001\005voice' > "$2/voice.scsyndef"
"#,
    )
    .unwrap();
    fs::set_permissions(&compiler, fs::Permissions::from_mode(0o755)).unwrap();
    let output = access
        .prepare_synthdefs(&identity, &protection)
        .unwrap()
        .run(&SynthdefCompiler {
            sclang: Ok(compiler),
            timeout: Duration::from_secs(5),
        });
    let report = access.finish_synthdefs(output, &protection).unwrap();
    assert!(report.error.is_none());
    assert!(report.references.is_empty());
    assert_eq!(report.produced, ["voice.scsyndef"]);
}

#[test]
fn creation_compile_keeps_the_compiler_report_when_artifact_publication_fails() {
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "publish-failure");
    fs::create_dir_all(root.join("supercollider/source")).unwrap();
    fs::create_dir_all(root.join("supercollider/synthdefs")).unwrap();
    fs::write(root.join("supercollider/source/voice.scd"), "// source").unwrap();
    let compiler = temp.path().join("sclang");
    fs::write(
        &compiler,
        r#"#!/bin/sh
printf '\123\103\147\146\000\000\000\002\000\001\005voice' > "$2/voice.scsyndef"
echo compiled-voice
"#,
    )
    .unwrap();
    fs::set_permissions(&compiler, fs::Permissions::from_mode(0o755)).unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let output = access
        .prepare_synthdefs(&identity, &protection)
        .unwrap()
        .run(&SynthdefCompiler {
            sclang: Ok(compiler.clone()),
            timeout: Duration::from_secs(5),
        });
    let output_dir = root.join("supercollider/synthdefs");
    fs::set_permissions(&output_dir, fs::Permissions::from_mode(0o555)).unwrap();
    let result = access.finish_synthdefs(output, &protection);
    fs::set_permissions(&output_dir, fs::Permissions::from_mode(0o755)).unwrap();
    let report = result.unwrap();
    assert!(report.error.unwrap().contains("Permission denied"));
    assert_eq!(report.sclang_path, Some(compiler.display().to_string()));
    assert!(report.output.contains("compiled-voice"));
    assert!(report.produced.is_empty());
    assert_eq!(report.references[0].path, "not-compiled.scsyndef");
    assert_eq!(
        report.references[0].status,
        SynthdefReferenceStatus::NotChecked
    );
    assert!(!output_dir.join("voice.scsyndef").exists());
}

/// Release-only evidence against an installed compiler. CI has no sclang.
#[test]
#[ignore]
fn compile_with_real_sclang() {
    let temp = tempfile::tempdir().unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let workspace = access
        .create_blank(
            &NewProjectOptions {
                parent: temp.path().display().to_string(),
                folder_name: "real-compile".into(),
                name: "Real compiler check".into(),
                author: String::new(),
                description: String::new(),
                locale: "en".into(),
            },
            &protection,
        )
        .unwrap();
    let identity = workspace.project.identity;
    access.commit(&identity, &protection).unwrap();
    let output = access
        .prepare_synthdefs(&identity, &protection)
        .unwrap()
        .run(&SynthdefCompiler::default());
    let report = access.finish_synthdefs(output, &protection).unwrap();
    assert!(report.error.is_none(), "{report:?}");
    assert_eq!(report.produced, ["pndsBlank.scsyndef"]);
    assert_eq!(
        report.references[0].status,
        SynthdefReferenceStatus::Verified
    );
}
