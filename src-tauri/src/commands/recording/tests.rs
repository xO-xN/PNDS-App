use super::*;
use crate::project::creation::Protection;
use serde_json::json;
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};

fn project(root: &Path) {
    fs::create_dir_all(root).unwrap();
    fs::write(root.join("manifest.json"), json!({
        "schemaVersion":1,"id":"portable-recordings","name":"Portable recordings","version":"1.0.0",
        "scoreServer":{"entry":"server.js","workingDirectory":".","performerPort":6000,"monitorPort":6001},
        "audio":{"defaultMode":"none","supportedModes":["none"]}
    }).to_string()).unwrap();
    fs::write(root.join("server.js"), "// portable source\n").unwrap();
}

fn protection() -> Protection {
    Protection {
        bundles: vec![],
        utilities: vec![],
    }
}

fn external_record(path: &Path) {
    let source = json!({"projectId":"portable-recordings","projectName":"Portable recordings",
        "contentDigest":"sha256:fixture","adapter":{"protocolVersion":1,"adapterId":"fixture-v1"}});
    fs::write(
        path,
        json!({
            "schemaVersion":2,"id":"0123456789abcdef0123456789abcdef","createdAt":"1",
            "complete":true,"durationMs":100,"originalSource":source,"interpretedBy":source,
            "initialState":{},"performers":[],"events":[],"passes":[]
        })
        .to_string(),
    )
    .unwrap();
}

fn copy_directory(source: &Path, destination: &Path) {
    fs::create_dir(destination).unwrap();
    fs::set_permissions(destination, fs::metadata(source).unwrap().permissions()).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let target = destination.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_directory(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

#[test]
fn project_catalog_survives_rename_and_copy_without_sharing_later_mutations() {
    let files = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let root = files.path().join("original");
    project(&root);
    let external = data.path().join("old.json");
    external_record(&external);
    let manager = RecordingManager::default();
    let catalog = store_at(data.path(), &root, &protection(), None).unwrap();
    let record = manager.import(&catalog, &external).unwrap();
    // Editing an incomplete project must not make its saved recordings inaccessible.
    fs::remove_file(root.join("server.js")).unwrap();
    assert_eq!(
        manager
            .list(&store_at(data.path(), &root, &protection(), None).unwrap())
            .unwrap()[0]
            .id,
        record.id
    );
    assert!(!data.path().join("recordings").exists());
    let moved = files.path().join("renamed");
    fs::rename(&root, &moved).unwrap();
    let moved_catalog = store_at(data.path(), &moved, &protection(), None).unwrap();
    assert_eq!(manager.list(&moved_catalog).unwrap()[0].id, record.id);
    let copied = files.path().join("copy");
    copy_directory(&moved, &copied);
    let copied_catalog = store_at(data.path(), &copied, &protection(), None).unwrap();
    assert!(!moved_catalog.same_directory(&copied_catalog));
    manager.delete_record(&copied_catalog, &record.id).unwrap();
    assert!(manager.list(&copied_catalog).unwrap().is_empty());
    assert_eq!(manager.list(&moved_catalog).unwrap()[0].id, record.id);
    let exported = data.path().join("retained.pndsrecord");
    manager
        .export(&moved_catalog, &record.id, &exported)
        .unwrap();
    assert!(exported.exists());
}

#[test]
fn protected_installed_sources_keep_recordings_outside_replaceable_source_directories() {
    let files = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let bundles = files.path().join("bundles");
    let bundle = bundles.join("installed-1.0.0");
    let utility = files.path().join("utility");
    project(&bundle);
    project(&utility);
    let external = data.path().join("old.json");
    external_record(&external);
    let protection = Protection {
        bundles: vec![bundles],
        utilities: vec![utility.clone()],
    };
    let manager = RecordingManager::default();
    for root in [&bundle, &utility] {
        let catalog = store_at(data.path(), root, &protection, None).unwrap();
        manager.import(&catalog, &external).unwrap();
        assert!(catalog
            .reveal_path()
            .unwrap()
            .starts_with(data.path().canonicalize().unwrap()));
        assert!(!root.join(".pnds-creation").exists());
    }
}

#[test]
fn inaccessible_project_storage_never_silently_falls_back_to_app_data() {
    let files = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let root = files.path().join("project");
    project(&root);
    symlink(outside.path(), root.join(".pnds-creation")).unwrap();
    assert!(store_at(data.path(), &root, &protection(), None).is_err());
    assert!(!data.path().join("recordings").exists());
    assert!(fs::read_dir(outside.path()).unwrap().next().is_none());
}

#[test]
fn read_only_project_keeps_carried_records_readable_and_rejects_changes() {
    let files = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let root = files.path().join("project");
    project(&root);
    let external = data.path().join("old.json");
    external_record(&external);
    let manager = RecordingManager::default();
    let record = manager
        .import(
            &store_at(data.path(), &root, &protection(), None).unwrap(),
            &external,
        )
        .unwrap();
    fs::set_permissions(&root, fs::Permissions::from_mode(0o500)).unwrap();
    let catalog = store_at(data.path(), &root, &protection(), None).unwrap();
    assert_eq!(manager.list(&catalog).unwrap()[0].id, record.id);
    assert_eq!(
        manager.import(&catalog, &external).unwrap_err(),
        "recording.readOnly"
    );
    assert_eq!(
        manager.delete_record(&catalog, &record.id).unwrap_err(),
        "recording.readOnly"
    );
    manager
        .export(
            &catalog,
            &record.id,
            &data.path().join("read-only.pndsrecord"),
        )
        .unwrap();
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
}

#[test]
fn running_project_root_replacement_cannot_initialize_another_projects_catalog() {
    let files = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let root = files.path().join("project");
    project(&root);
    let running_root = File::open(&root).unwrap();
    let moved = files.path().join("running-project");
    fs::rename(&root, &moved).unwrap();
    copy_directory(&moved, &root);

    assert!(matches!(
        store_at(data.path(), &root, &protection(), Some(&running_root)),
        Err(error) if error == "recording.storageUnavailable"
    ));
    assert!(!root.join(".pnds-creation").exists());
    assert!(!moved.join(".pnds-creation").exists());
    assert!(!data.path().join("recordings").exists());
}

#[test]
fn launch_source_verification_rejects_identical_content_in_a_replacement_directory() {
    let files = tempfile::tempdir().unwrap();
    let root = files.path().join("project");
    project(&root);
    fs::write(
        root.join("pnds.recording.json"),
        br#"{"protocolVersion":1,"adapterId":"fixture-v1"}"#,
    )
    .unwrap();
    let source = crate::recording::launch_source(&root).unwrap().unwrap();
    let moved = files.path().join("running-project");
    fs::rename(&root, &moved).unwrap();
    copy_directory(&moved, &root);

    let replacement = crate::recording::launch_source(&root).unwrap().unwrap();
    assert_eq!(source.project_key, replacement.project_key);
    assert_eq!(
        source.source.content_digest,
        replacement.source.content_digest
    );
    assert!(crate::recording::verify_launch_source(&root, &source).is_err());
}
