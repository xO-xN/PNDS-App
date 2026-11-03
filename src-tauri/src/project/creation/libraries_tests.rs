use super::*;
use sha2::{Digest, Sha256};

fn library_fixture(root: &Path) {
    fs::create_dir_all(root.join("browser/p5/2.3.4")).unwrap();
    let bytes = b"window.p5 = function () {};";
    fs::write(root.join("browser/p5/2.3.4/p5.min.js"), bytes).unwrap();
    fs::write(root.join("catalog.json"), serde_json::json!({
        "schemaVersion": 1,
        "libraries": [{
            "id": "p5", "version": "2.3.4", "kind": "browser",
            "entry": "browser/p5/2.3.4/p5.min.js",
            "source": { "url": "https://registry.npmjs.org/p5/-/p5-2.3.4.tgz", "integrity": "sha512-fixture" },
            "files": [{ "path": "browser/p5/2.3.4/p5.min.js", "sha256": format!("{:x}", Sha256::digest(bytes)), "bytes": bytes.len() }]
        }]
    }).to_string()).unwrap();
}

#[test]
fn adopting_shared_library_atomically_updates_reference_and_project_version_without_source_changes()
{
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let libraries = temp.path().join("libraries");
    library_fixture(&libraries);
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let catalog = access
        .library_catalog(&identity, &libraries, &protection)
        .unwrap();
    let result = access
        .adopt_library(
            &identity,
            &CreationLibraryAdoption {
                id: "p5".into(),
                version: "2.3.4".into(),
                project_version: "0.2.0".into(),
                manifest_version: catalog.manifest_version,
            },
            &libraries,
            &protection,
        )
        .unwrap();
    assert!(!result.already_added);
    let manifest = crate::project::manifest::load_manifest_lenient(&root).unwrap();
    assert_eq!(manifest.schema_version, 2);
    assert_eq!(manifest.version, "0.2.0");
    assert_eq!(manifest.shared_libraries[0].id, "p5");
    assert_eq!(manifest.shared_libraries[0].version, "2.3.4");
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "// unfinished score server"
    );
    assert!(!root.join("shared").exists());
    let again = access
        .adopt_library(
            &identity,
            &CreationLibraryAdoption {
                id: "p5".into(),
                version: "2.3.4".into(),
                project_version: "0.2.0".into(),
                manifest_version: result.manifest_version.clone(),
            },
            &libraries,
            &protection,
        )
        .unwrap();
    assert!(again.already_added);
    assert_eq!(result.manifest_version, again.manifest_version);
}

#[test]
fn failed_adoption_retains_disk_and_refuses_conflicts_sources_versions_and_resource_escape() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let libraries = temp.path().join("libraries");
    library_fixture(&libraries);
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let catalog = access
        .library_catalog(&identity, &libraries, &protection)
        .unwrap();
    let mut adoption = CreationLibraryAdoption {
        id: "p5".into(),
        version: "2.3.4".into(),
        project_version: "0.2.0".into(),
        manifest_version: catalog.manifest_version.clone(),
    };
    let original = fs::read(root.join("manifest.json")).unwrap();
    adoption.project_version = "0.1.0".into();
    assert_eq!(
        access
            .adopt_library(&identity, &adoption, &libraries, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::ManifestInvalid
    );
    adoption.project_version = "0.2.0".into();
    adoption.manifest_version = "stale".into();
    assert_eq!(
        access
            .adopt_library(&identity, &adoption, &libraries, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    adoption.manifest_version = catalog.manifest_version;
    adoption.version = "9.0.0".into();
    assert!(access
        .adopt_library(&identity, &adoption, &libraries, &protection)
        .unwrap_err()
        .detail
        .contains("p5 9.0.0"));
    adoption.version = "2.3.4".into();
    let protected = Protection {
        bundles: vec![root.clone()],
        utilities: vec![],
    };
    assert!(access
        .adopt_library(&identity, &adoption, &libraries, &protected)
        .is_err());
    let resource = libraries.join("browser/p5/2.3.4/p5.min.js");
    fs::write(&resource, b"damaged").unwrap();
    assert!(access
        .adopt_library(&identity, &adoption, &libraries, &protection)
        .unwrap_err()
        .detail
        .contains("damaged"));
    fs::remove_file(&resource).unwrap();
    std::os::unix::fs::symlink(root.join("server.js"), &resource).unwrap();
    assert!(access
        .adopt_library(&identity, &adoption, &libraries, &protection)
        .unwrap_err()
        .detail
        .contains("escapes"));
    assert_eq!(fs::read(root.join("manifest.json")).unwrap(), original);
    access.close(&identity);
    assert_eq!(
        access
            .adopt_library(&identity, &adoption, &libraries, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
}

#[tokio::test]
async fn verified_shared_browser_resource_is_served_by_real_node_on_both_project_origins() {
    use crate::test_support::{FixturePorts, OwnedNodeFixture};
    use std::net::TcpListener;
    use std::process::Command;
    let node = crate::project::session::node_binary_path()
        .expect("fetch the bundled Node runtime before this integration test");
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("score");
    fs::create_dir(&root).unwrap();
    let example = Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/shared-p5");
    fs::copy(example.join("server.mjs"), root.join("server.mjs")).unwrap();
    let mut manifest: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(example.join("manifest.json")).unwrap()).unwrap();
    let ports_lease = FixturePorts::<2>::reserve("shared-browser-library").unwrap();
    let ports = ports_lease.values();
    manifest["scoreServer"]["performerPort"] = serde_json::json!(ports[0]);
    manifest["scoreServer"]["monitorPort"] = serde_json::json!(ports[1]);
    fs::write(root.join("manifest.json"), manifest.to_string()).unwrap();
    let libraries = temp.path().join("libraries");
    library_fixture(&libraries);
    let manifest = crate::project::manifest::load_manifest(&root).unwrap();
    let mut request = crate::project::session::StartRequest::new(
        root.to_string_lossy().into_owned(),
        crate::types::AudioMode::None,
        "192.168.1.2".into(),
        None,
    );
    request.shared_libraries = crate::project::shared_libraries::LibraryCatalog::load(&libraries)
        .unwrap()
        .resolve(&libraries, &manifest.shared_libraries)
        .unwrap();
    let mut command = Command::new(node);
    command
        .arg(root.join("server.mjs"))
        .envs(crate::project::session::build_score_server_env(&request));
    let mut fixture = OwnedNodeFixture::spawn(ports_lease, command).unwrap();
    let health = fixture.ready().await.unwrap();
    for payload in [&health.performer, &health.monitor] {
        assert_eq!(payload["audio"]["status"], "disabled");
    }
    let client = fixture.client();
    for port in ports {
        let bytes = client
            .get(format!("http://127.0.0.1:{port}/shared/p5.js"))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        assert_eq!(bytes.as_ref(), b"window.p5 = function () {};");
        let page = client
            .get(format!("http://127.0.0.1:{port}/"))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert!(page.contains("src=\"/shared/p5.js\""));
        assert!(!page.contains(&libraries.to_string_lossy().to_string()));
    }
    let cleanup = fixture.finish().await.unwrap();
    assert!(cleanup.process_reaped && cleanup.ports_released);
    for port in ports {
        assert!(TcpListener::bind(("0.0.0.0", port)).is_ok());
    }
}

#[test]
fn adoption_resource_failures_name_the_requested_exact_library_and_preserve_manifest() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let CreationContent::Text { text, version } = access
        .read(&identity, "manifest.json", &protection)
        .unwrap()
    else {
        panic!("fixture manifest must be text");
    };
    let adoption = CreationLibraryAdoption {
        id: "p5".into(),
        version: "2.3.4".into(),
        project_version: "0.2.0".into(),
        manifest_version: version,
    };
    let missing_root = temp.path().join("missing");
    let missing_catalog = temp.path().join("without-catalog");
    fs::create_dir(&missing_catalog).unwrap();
    let invalid_catalog = temp.path().join("invalid-catalog");
    fs::create_dir(&invalid_catalog).unwrap();
    fs::write(invalid_catalog.join("catalog.json"), b"invalid JSON").unwrap();
    for resources in [&missing_root, &missing_catalog, &invalid_catalog] {
        let error = access
            .adopt_library(&identity, &adoption, resources, &protection)
            .unwrap_err();
        assert_eq!(error.code, CreationErrorCode::TestValidation);
        let detail = &error.detail;
        assert!(detail.contains("p5 2.3.4"), "{detail}");
        assert_eq!(
            fs::read_to_string(root.join("manifest.json")).unwrap(),
            text
        );
    }
}

#[test]
fn edit_task_adopts_only_shipped_local_versions_and_undo_restores_the_original_manifest() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let libraries = temp.path().join("libraries");
    let data = temp.path().join("data");
    library_fixture(&libraries);
    let protection = Protection::default();
    let before = fs::read_to_string(root.join("manifest.json")).unwrap();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let task = access
        .begin_assistant_task(&identity, AssistantMode::Edit, None, &data, &protection)
        .unwrap();
    assert!(access
        .adopt_assistant_library(
            &identity,
            &task.id,
            "online-only-package",
            &data,
            &libraries,
            &protection
        )
        .is_err());
    assert!(access
        .adopt_assistant_library(&identity, &task.id, "p5", &data, &libraries, &protection)
        .is_err());
    let proposal = access
        .propose_assistant_resources(
            &identity,
            &task.id,
            &AssistantResourceRequest {
                modules: vec![],
                libraries: vec!["p5".into()],
                reason: "Local graphics runtime".into(),
                alternative: None,
            },
            &data,
            &libraries,
            &protection,
        )
        .unwrap();
    access
        .decide_assistant_resources(
            &identity,
            &task.id,
            &proposal.resource_plans[0].id,
            AssistantResourceDecision::Approved,
            &data,
            &protection,
        )
        .unwrap();
    // Even an approved item must go through the catalog-validating adoption
    // tool; generic manifest writes cannot bypass its provenance check.
    let mut value: serde_json::Value = serde_json::from_str(&before).unwrap();
    value["schemaVersion"] = serde_json::json!(2);
    value["sharedLibraries"] = serde_json::json!([{"id":"p5","version":"2.3.4"}]);
    assert!(access
        .write_assistant_file(
            &identity,
            &task.id,
            &AssistantWrite {
                path: "manifest.json".into(),
                version: Some(file_version(before.as_bytes())),
                text: Some(value.to_string()),
                edits: None,
            },
            &data,
            &protection
        )
        .is_err());
    access
        .adopt_assistant_library(&identity, &task.id, "p5", &data, &libraries, &protection)
        .unwrap();
    let manifest = crate::project::manifest::load_manifest_lenient(&root).unwrap();
    assert_eq!(manifest.shared_libraries[0].version, "2.3.4");
    assert_ne!(manifest.version, "0.1.0");
    access.end_assistant_task(&identity, &task.id);
    access
        .undo_assistant_task(&identity, &task.id, None, &data, &protection)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("manifest.json")).unwrap(),
        before
    );
}
