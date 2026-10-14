use super::*;

fn resources() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/shared-libraries")
}
fn options(parent: &Path) -> NewProjectOptions {
    NewProjectOptions {
        parent: parent.to_string_lossy().into_owned(),
        folder_name: "new-score".into(),
        name: "New Score".into(),
        author: "Composer".into(),
        description: "My score".into(),
        locale: "en".into(),
    }
}

#[test]
fn classic_creation_keeps_the_reference_implementation_and_initializes_an_editable_project() {
    let temp = tempfile::tempdir().unwrap();
    let old = super::tests::project(temp.path(), "old");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&old, &protection).unwrap().project.identity;
    let workspace = access
        .create_classic(&options(temp.path()), &resources(), &protection)
        .unwrap();
    assert_eq!(workspace.project.source, CreationSource::Folder);
    assert!(access.read(&identity, "server.js", &protection).is_ok());
    let root = Path::new(&workspace.project.root);
    let manifest = crate::project::manifest::load_manifest(root).unwrap();
    assert_eq!(manifest.audio.output_channels, 16);
    assert_eq!(manifest.version, "0.1.0");
    assert_eq!(manifest.name, "New Score");
    assert_ne!(manifest.id, "pnds-template");
    assert_eq!(manifest.shared_libraries.len(), 5);
    assert!(root.join("lib/protocol.js").is_file());
    assert!(root.join("test/integration.test.js").is_file());
    assert!(root
        .join("supercollider/source/template-sine.scd")
        .is_file());
    let package: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("package.json")).unwrap()).unwrap();
    assert_eq!(package["name"], manifest.id);
    assert_eq!(package["version"], "0.1.0");
    assert_eq!(package["author"], "Composer");
    let readme = fs::read_to_string(root.join("README.md")).unwrap();
    assert!(readme.starts_with("# New Score\n"));
    assert!(readme.contains("title: New Score\ncomposer: Composer"));
    assert!(!readme.contains("fresh PNDS Template"));
    assert!(!readme.contains("github_url:"));
    assert!(fs::read_to_string(root.join("AGENTS.md"))
        .unwrap()
        .contains("Contents/Resources/help/en/reference/README.md"));
    let source: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("docs/template-source.json")).unwrap()).unwrap();
    assert_eq!(source["template"], "PNDS Classic");
    assert_eq!(source["version"], "0.7.0");
    for excluded in [
        ".git",
        "node_modules",
        ".pnds-seats.json",
        ".pnds-seats.json.tmp",
        "cover.png",
    ] {
        assert!(!root.join(excluded).exists());
    }
    crate::project::bundle::validate_packable_with_libraries(root, Some(&resources())).unwrap();
}

#[test]
fn classic_creator_documents_describe_saved_file_bundles_with_app_shared_dependencies() {
    let temp = tempfile::tempdir().unwrap();
    let created = CreationAccess::default()
        .create_classic(&options(temp.path()), &resources(), &Protection::default())
        .unwrap();
    let root = Path::new(&created.project.root);
    assert!(!root.join(".github/workflows/package.yml").exists());
    assert!(!root.join("node_modules").exists());
    for path in [
        "AGENTS.md",
        "docs/implementation.md",
        "docs/start.md",
        "README.md",
        "README.zh-CN.md",
    ] {
        let document = fs::read_to_string(root.join(path)).unwrap();
        assert!(
            !document.contains(".github/workflows/package.yml"),
            "{path}"
        );
        assert!(!document.contains("`node_modules` 预装"), "{path}");
        if matches!(path, "AGENTS.md" | "docs/implementation.md") {
            assert!(document.contains(".pnds"), "{path}");
            assert!(document.contains("sharedLibraries"), "{path}");
            assert!(document.contains("reference/pnds-bundle.md"), "{path}");
        }
    }
}

#[test]
fn repeated_creation_at_different_locations_has_independent_project_and_client_identities() {
    let temp = tempfile::tempdir().unwrap();
    for classic in [false, true] {
        let mut manifests = Vec::new();
        let mut tokens = Vec::new();
        for copy in 0..2 {
            let parent = temp.path().join(format!("{classic}-{copy}"));
            fs::create_dir(&parent).unwrap();
            let mut access = CreationAccess::default();
            let protection = Protection::default();
            let created = if classic {
                access.create_classic(&options(&parent), &resources(), &protection)
            } else {
                access.create_blank(&options(&parent), &protection)
            }
            .unwrap();
            let root = Path::new(&created.project.root);
            let before = fs::read(root.join("manifest.json")).unwrap();
            let manifest = crate::project::manifest::load_manifest(root).unwrap();
            manifests.push(manifest.id);
            if classic {
                tokens.push(fs::read_to_string(root.join("public/shared.js")).unwrap());
            }
            access.open(root, &protection).unwrap();
            assert_eq!(fs::read(root.join("manifest.json")).unwrap(), before);
        }
        assert_ne!(
            manifests[0], manifests[1],
            "same folder names do not imply the same project"
        );
        if classic {
            assert_ne!(tokens[0], tokens[1]);
        }
    }
}

#[test]
fn classic_failure_never_publishes_an_incomplete_project_or_replaces_the_active_workspace() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let old = super::tests::project(temp.path(), "old");
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&old, &protection).unwrap().project.identity;
    let opts = options(temp.path());
    let missing = temp.path().join("missing-resources");
    let error = access
        .create_classic(&opts, &missing, &protection)
        .unwrap_err();
    assert!(error.detail.contains("express 5.3.0"));
    assert!(error.detail.contains("p5 2.3.4"));
    assert!(!temp.path().join("new-score").exists());
    assert!(!fs::read_dir(temp.path()).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".pnds-create-")));
    assert!(access.read(&identity, "server.js", &protection).is_ok());
    let target = temp.path().join("new-score");
    fs::create_dir(&target).unwrap();
    fs::write(target.join("author.txt"), "author-owned").unwrap();
    assert_eq!(
        access
            .create_classic(&opts, &resources(), &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    assert_eq!(
        fs::read_to_string(target.join("author.txt")).unwrap(),
        "author-owned"
    );
    let denied = temp.path().join("denied");
    fs::create_dir(&denied).unwrap();
    fs::set_permissions(&denied, fs::Permissions::from_mode(0o555)).unwrap();
    let result = access.create_classic(&options(&denied), &resources(), &protection);
    fs::set_permissions(&denied, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(result.unwrap_err().code, CreationErrorCode::Permission);
    assert!(fs::read_dir(&denied).unwrap().next().is_none());
    assert!(access.read(&identity, "server.js", &protection).is_ok());
}

#[test]
fn created_template_identity_and_runtime_files_survive_the_public_bundle_install_roundtrip() {
    for classic in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let mut access = CreationAccess::default();
        let workspace = if classic {
            access.create_classic(&options(temp.path()), &resources(), &Protection::default())
        } else {
            access.create_blank(&options(temp.path()), &Protection::default())
        }
        .unwrap();
        let root = Path::new(&workspace.project.root);
        let package = temp.path().join("created.pnds");
        crate::project::bundle::pack_project_at_with_libraries(
            root,
            Some(&package),
            false,
            "test",
            Some(&resources()),
        )
        .unwrap();
        let installed = crate::project::bundle::install_bundle_with_libraries(
            &temp.path().join("installed"),
            &package,
            Some(&resources()),
        )
        .unwrap();
        let paths = if classic {
            [
                "manifest.json",
                "public/shared.js",
                "server.js",
                "supercollider/synthdefs/template-sine.scsyndef",
            ]
        } else {
            [
                "manifest.json",
                "public/performer.html",
                "server.js",
                "supercollider/synthdefs/pndsBlank.scsyndef",
            ]
        };
        for path in paths {
            assert_eq!(
                fs::read(root.join(path)).unwrap(),
                fs::read(installed.join(path)).unwrap()
            );
        }
        assert!(!installed.join(".git").exists());
        assert!(!installed.join("node_modules").exists());
        crate::project::bundle::validate_packable_with_libraries(&installed, Some(&resources()))
            .unwrap();
    }
}

#[test]
fn generated_classic_runs_offline_in_all_audio_modes_with_real_independent_clients_and_installed_copy(
) {
    use crate::project::manifest::SharedLibraryReference;
    use std::process::Command;
    let temp = tempfile::tempdir().unwrap();
    let mut projects = Vec::new();
    for copy in 0..2 {
        let parent = temp.path().join(format!("copy-{copy}"));
        fs::create_dir(&parent).unwrap();
        let created = CreationAccess::default()
            .create_classic(&options(&parent), &resources(), &Protection::default())
            .unwrap();
        projects.push(PathBuf::from(created.project.root));
    }
    let bundle = temp.path().join("created.pnds");
    crate::project::bundle::pack_project_at_with_libraries(
        &projects[0],
        Some(&bundle),
        false,
        "test",
        Some(&resources()),
    )
    .unwrap();
    projects.push(
        crate::project::bundle::install_bundle_with_libraries(
            &temp.path().join("installed"),
            &bundle,
            Some(&resources()),
        )
        .unwrap(),
    );
    let mut references = crate::project::manifest::load_manifest(&projects[0])
        .unwrap()
        .shared_libraries;
    references.push(SharedLibraryReference {
        id: "socket.io-client".into(),
        version: "4.8.4".into(),
    });
    let mut resolved =
        crate::project::shared_libraries::resolve_at(&resources(), &references).unwrap();
    let client = resolved.remove("socket.io-client").unwrap();
    let fixture = temp.path().join("classic-runtime.mjs");
    fs::write(&fixture, include_str!("classic_runtime.mjs")).unwrap();
    let osc = super::blank_runtime::OscServer::new();
    let output = Command::new(crate::project::session::node_binary_path().unwrap())
        .arg(&fixture)
        .arg(&client.path)
        .args(&projects)
        .env_clear()
        .env(
            "PNDS_SHARED_LIBRARIES",
            serde_json::to_string(&resolved).unwrap(),
        )
        .env("PNDS_OSC_TARGET", format!("127.0.0.1:{}", osc.port))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let messages = osc.messages.lock().unwrap();
    assert!(messages.iter().any(|message| message.addr == "/s_new"));
    assert!(messages.iter().any(|message| message.addr == "/c1/amp"));
    assert!(!messages.iter().any(|message| message.addr == "/quit"));
}
