use super::*;
use crate::recording::{RecordingCapability, RecordingSource};
use std::fs;
use std::os::unix::fs::symlink;

const ID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

fn record(id: &str) -> PerformanceRecord {
    let source = RecordingSource {
        project_id: "same-project-id".into(),
        project_name: "Same project name".into(),
        content_digest: "sha256:fixture".into(),
        adapter: RecordingCapability {
            protocol_version: 1,
            adapter_id: "fixture-v1".into(),
        },
    };
    PerformanceRecord {
        schema_version: 2,
        id: id.into(),
        created_at: "1234".into(),
        complete: true,
        duration_ms: 1000,
        original_source: source.clone(),
        interpreted_by: source,
        initial_state: serde_json::json!({"score": 2}),
        performers: Vec::new(),
        events: Vec::new(),
        passes: Vec::new(),
    }
}

fn project(parent: &Path, name: &str) -> PathBuf {
    let root = parent.join(name);
    fs::create_dir(&root).unwrap();
    fs::write(root.join("manifest.json"), br#"{"schemaVersion":2,"id":"same-project-id","name":"Same project name","version":"0.1.0","scoreServer":{"entry":"server.js","workingDirectory":".","performerPort":6000,"monitorPort":6001},"audio":{"defaultMode":"none","supportedModes":["none"]}}"#).unwrap();
    fs::write(root.join("server.js"), b"// score fixture\n").unwrap();
    root
}

fn legacy(data: &Path, root: &Path) -> PathBuf {
    let canonical = fs::canonicalize(root).unwrap();
    let key = format!(
        "{:x}",
        Sha256::digest(canonical.to_string_lossy().as_bytes())
    );
    let directory = data.join(DIRECTORY).join(key);
    fs::create_dir_all(&directory).unwrap();
    directory
}

fn private_directory(parent: &Path, name: &str) -> PathBuf {
    let path = parent.join(name);
    fs::create_dir(&path).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
    path
}

#[test]
fn migrates_complete_pending_and_legacy_bytes_once_and_preserves_originals() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let data = temp.path().join("app");
    let old = legacy(&data, &root);
    let complete_name = format!("{ID}.json");
    let pending_name = format!("pending-{OTHER}.json");
    let complete = serde_json::to_vec_pretty(&record(ID)).unwrap();
    let mut pending = record(ID);
    pending.complete = false;
    let pending = serde_json::to_vec_pretty(&pending).unwrap();
    let mut schema_one = serde_json::to_value(record(ID)).unwrap();
    schema_one["schemaVersion"] = serde_json::json!(1);
    schema_one.as_object_mut().unwrap().remove("passes");
    let backup = serde_json::to_vec_pretty(&schema_one).unwrap();
    fs::write(old.join(&complete_name), &complete).unwrap();
    fs::write(old.join(&pending_name), &pending).unwrap();
    fs::create_dir(old.join("legacy")).unwrap();
    fs::write(old.join("legacy").join(&complete_name), &backup).unwrap();
    fs::write(old.join("abandoned-temporary"), b"not a recording").unwrap();

    let store = RecordingStore::project(&data, &root).unwrap();
    assert_eq!(
        store.entries().unwrap(),
        [complete_name.clone(), pending_name.clone()]
    );
    let local = store.reveal_path().unwrap();
    assert_eq!(fs::read(local.join(&complete_name)).unwrap(), complete);
    assert_eq!(fs::read(local.join(&pending_name)).unwrap(), pending);
    assert_eq!(
        fs::read(local.join("legacy").join(&complete_name)).unwrap(),
        backup
    );
    assert_eq!(fs::read(old.join(&complete_name)).unwrap(), complete);
    assert_eq!(fs::read(old.join(&pending_name)).unwrap(), pending);
    assert_eq!(
        fs::read(old.join("legacy").join(&complete_name)).unwrap(),
        backup
    );
    assert_eq!(store.read(&pending_name).unwrap().id, ID);
    assert!(!store.read(&pending_name).unwrap().complete);
    assert_eq!(
        fs::metadata(&local).unwrap().permissions().mode() & 0o077,
        0
    );

    let reopened = RecordingStore::project(&data, &root).unwrap();
    assert!(store.same_directory(&reopened));
    assert_eq!(reopened.entries().unwrap().len(), 2);
    store.remove(&complete_name).unwrap();
    store.remove(&pending_name).unwrap();
    assert!(RecordingStore::project(&data, &root)
        .unwrap()
        .entries()
        .unwrap()
        .is_empty());
    assert!(old.join(complete_name).exists());
    assert!(old.join(pending_name).exists());
}

#[test]
fn invalid_legacy_record_prevents_partial_publication_and_retry_keeps_ids() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let data = temp.path().join("app");
    let old = legacy(&data, &root);
    let valid = serde_json::to_vec_pretty(&record(ID)).unwrap();
    fs::write(old.join(format!("{ID}.json")), &valid).unwrap();
    fs::write(old.join(format!("{OTHER}.json")), b"corrupt").unwrap();

    assert!(RecordingStore::project(&data, &root).is_err());
    let private = root.join(crate::creation_data::DIRECTORY);
    assert!(!private.join(DIRECTORY).exists());
    assert_eq!(fs::read_dir(&private).unwrap().count(), 0);
    assert_eq!(fs::read(old.join(format!("{ID}.json"))).unwrap(), valid);
    assert_eq!(
        fs::read(old.join(format!("{OTHER}.json"))).unwrap(),
        b"corrupt"
    );

    fs::write(
        old.join(format!("{OTHER}.json")),
        serde_json::to_vec(&record(OTHER)).unwrap(),
    )
    .unwrap();
    let store = RecordingStore::project(&data, &root).unwrap();
    assert_eq!(
        store.entries().unwrap(),
        [format!("{ID}.json"), format!("{OTHER}.json")]
    );
    assert_eq!(store.read(&format!("{ID}.json")).unwrap().id, ID);
}

#[test]
fn local_directory_without_valid_ready_state_never_falls_back_or_overwrites() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let data = temp.path().join("app");
    let old = legacy(&data, &root);
    fs::write(
        old.join(format!("{ID}.json")),
        serde_json::to_vec(&record(ID)).unwrap(),
    )
    .unwrap();
    let private = private_directory(&root, crate::creation_data::DIRECTORY);
    let local = private_directory(&private, DIRECTORY);
    assert_eq!(
        RecordingStore::project(&data, &root).err().unwrap(),
        "recording.storageInvalid"
    );
    assert_eq!(fs::read_dir(&local).unwrap().count(), 0);
    fs::write(local.join(READY), b"unsupported-version\n").unwrap();
    assert!(RecordingStore::project(&data, &root).is_err());
    assert_eq!(
        fs::read(local.join(READY)).unwrap(),
        b"unsupported-version\n"
    );
    fs::write(local.join(READY), VERSION).unwrap();
    fs::write(local.join(format!("{ID}.json")), b"corrupt local record").unwrap();
    let store = RecordingStore::project(&data, &root).unwrap();
    assert!(store.read(&format!("{ID}.json")).is_err());
    assert_eq!(
        fs::read(local.join(format!("{ID}.json"))).unwrap(),
        b"corrupt local record"
    );
}

#[test]
fn held_store_follows_move_and_never_writes_into_replacement_at_old_path() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let data = temp.path().join("app");
    let store = RecordingStore::project(&data, &root).unwrap();
    store.write(&format!("{ID}.json"), &record(ID)).unwrap();
    let moved = temp.path().join("renamed-and-moved");
    fs::rename(&root, &moved).unwrap();
    project(temp.path(), "score");
    let replacement = RecordingStore::project(&data, &root).unwrap();
    store
        .write(&format!("{OTHER}.json"), &record(OTHER))
        .unwrap();
    assert!(!store.same_directory(&replacement));
    assert!(store.same_directory(&store.clone()));
    assert!(replacement.entries().unwrap().is_empty());
    let reopened = RecordingStore::project(&data, &moved).unwrap();
    assert!(store.same_directory(&reopened));
    assert_eq!(reopened.entries().unwrap().len(), 2);
    assert_eq!(
        store.reveal_path().unwrap(),
        fs::canonicalize(moved.join(".pnds-creation/recordings")).unwrap()
    );
}

#[test]
fn copied_private_catalog_is_independent_and_never_absorbs_a_new_paths_legacy_data() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let copy = project(temp.path(), "copy");
    let data = temp.path().join("app");
    let first = RecordingStore::project(&data, &root).unwrap();
    first.write(&format!("{ID}.json"), &record(ID)).unwrap();
    let private = private_directory(&copy, crate::creation_data::DIRECTORY);
    let local = private_directory(&private, DIRECTORY);
    fs::copy(
        first.reveal_path().unwrap().join(format!("{ID}.json")),
        local.join(format!("{ID}.json")),
    )
    .unwrap();
    fs::write(local.join(READY), VERSION).unwrap();
    let foreign = legacy(&data, &copy);
    fs::write(
        foreign.join(format!("{OTHER}.json")),
        serde_json::to_vec(&record(OTHER)).unwrap(),
    )
    .unwrap();

    let second = RecordingStore::project(&data, &copy).unwrap();
    assert!(!first.same_directory(&second));
    assert_eq!(second.entries().unwrap(), [format!("{ID}.json")]);
    second.remove(&format!("{ID}.json")).unwrap();
    assert!(RecordingStore::project(&data, &copy)
        .unwrap()
        .entries()
        .unwrap()
        .is_empty());
    assert_eq!(first.entries().unwrap(), [format!("{ID}.json")]);
}

#[test]
fn same_manifest_does_not_identify_an_unrelated_paths_old_recordings() {
    let temp = tempfile::tempdir().unwrap();
    let original = project(temp.path(), "original");
    let other = project(temp.path(), "same-manifest");
    let data = temp.path().join("app");
    let old = legacy(&data, &original);
    fs::write(
        old.join(format!("{ID}.json")),
        serde_json::to_vec(&record(ID)).unwrap(),
    )
    .unwrap();
    assert!(RecordingStore::project(&data, &other)
        .unwrap()
        .entries()
        .unwrap()
        .is_empty());
    assert_eq!(
        RecordingStore::project(&data, &original)
            .unwrap()
            .entries()
            .unwrap(),
        [format!("{ID}.json")]
    );
}

#[test]
fn readonly_open_does_not_initialize_migrate_or_mutate() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    assert!(RecordingStore::project_readonly(&root).is_err());
    assert!(!root.join(crate::creation_data::DIRECTORY).exists());
    let writable = RecordingStore::project(&temp.path().join("missing-app-data"), &root).unwrap();
    let name = format!("{ID}.json");
    writable.write(&name, &record(ID)).unwrap();
    let readonly = RecordingStore::project_readonly(&root).unwrap();
    assert!(writable.same_directory(&readonly));
    assert_eq!(readonly.entries().unwrap(), [name.clone()]);
    assert_eq!(readonly.read(&name).unwrap().id, ID);
    for result in [
        readonly.ensure_writable(),
        readonly.write(&name, &record(ID)),
        readonly.remove(&name),
        readonly.backup_legacy(&name),
    ] {
        assert_eq!(result.unwrap_err(), "recording.readOnly");
    }
    assert_eq!(writable.entries().unwrap(), [name]);
}

#[test]
fn redirected_private_directory_and_widened_permissions_are_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let redirected = project(temp.path(), "redirected");
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    symlink(&outside, redirected.join(crate::creation_data::DIRECTORY)).unwrap();
    assert!(RecordingStore::project(temp.path(), &redirected).is_err());
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    let wide = project(temp.path(), "wide");
    fs::create_dir(wide.join(crate::creation_data::DIRECTORY)).unwrap();
    fs::set_permissions(
        wide.join(crate::creation_data::DIRECTORY),
        fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    assert!(RecordingStore::project(temp.path(), &wide).is_err());
    assert_eq!(
        fs::metadata(wide.join(crate::creation_data::DIRECTORY))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o755
    );
}

#[test]
fn redirected_record_cannot_be_read_replaced_removed_or_backed_up() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let store = RecordingStore::project(temp.path(), &root).unwrap();
    let bytes = serde_json::to_vec(&record(ID)).unwrap();
    let outside = temp.path().join("outside.json");
    fs::write(&outside, &bytes).unwrap();
    let name = format!("{ID}.json");
    let redirected = store.reveal_path().unwrap().join(&name);
    symlink(&outside, &redirected).unwrap();
    assert!(store.read(&name).is_err());
    assert!(store.write(&name, &record(ID)).is_err());
    assert!(store.remove(&name).is_err());
    assert!(store.backup_legacy(&name).is_err());
    assert!(store.entries().is_err());
    assert!(fs::symlink_metadata(redirected)
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(fs::read(outside).unwrap(), bytes);
}

#[test]
fn redirected_migration_source_and_backup_directory_are_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let data = temp.path().join("app");
    let old = legacy(&data, &root);
    let outside = temp.path().join("outside.json");
    let mut value = serde_json::to_value(record(ID)).unwrap();
    value["schemaVersion"] = serde_json::json!(1);
    value.as_object_mut().unwrap().remove("passes");
    let bytes = serde_json::to_vec_pretty(&value).unwrap();
    fs::write(&outside, &bytes).unwrap();
    let name = format!("{ID}.json");
    symlink(&outside, old.join(&name)).unwrap();
    assert!(RecordingStore::project(&data, &root).is_err());
    assert!(!root.join(".pnds-creation/recordings").exists());
    fs::remove_file(old.join(&name)).unwrap();
    let store = RecordingStore::project(&data, &root).unwrap();
    let local = store.reveal_path().unwrap();
    fs::write(local.join(&name), &bytes).unwrap();
    let redirected = temp.path().join("backup-outside");
    fs::create_dir(&redirected).unwrap();
    symlink(&redirected, local.join("legacy")).unwrap();
    assert!(store.backup_legacy(&name).is_err());
    assert_eq!(fs::read_dir(&redirected).unwrap().count(), 0);
    assert_eq!(fs::read(&outside).unwrap(), bytes);
}

#[test]
fn file_names_and_bounded_regular_reads_protect_the_catalog() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let store = RecordingStore::project(temp.path(), &root).unwrap();
    for name in [
        "../escape.json",
        "storage.ready",
        "legacy/test.json",
        "invalid.json",
        "pending-.json",
    ] {
        assert!(store.read(name).is_err());
        assert!(store.write(name, &record(ID)).is_err());
        assert!(store.remove(name).is_err());
    }
    let name = format!("{ID}.json");
    let path = store.reveal_path().unwrap().join(&name);
    File::create(&path).unwrap().set_len(MAX_BYTES + 1).unwrap();
    assert_eq!(store.read(&name).unwrap_err(), "recording.tooLarge");
    fs::remove_file(&path).unwrap();
    let path = CString::new(path.as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
    assert_eq!(store.read(&name).unwrap_err(), "recording.storageInvalid");
}

#[test]
fn app_local_accepts_existing_legacy_permissions_and_creates_new_private_files() {
    let temp = tempfile::tempdir().unwrap();
    let directory = temp.path().join("recordings/legacy-project");
    fs::create_dir_all(&directory).unwrap();
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o755)).unwrap();
    let store = RecordingStore::app_local(temp.path(), "legacy-project").unwrap();
    let name = format!("{ID}.json");
    store.write(&name, &record(ID)).unwrap();
    assert_eq!(store.read(&name).unwrap().id, ID);
    assert_eq!(
        fs::metadata(directory.join(&name))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert_eq!(store.entries().unwrap(), store.entries().unwrap());
    assert!(RecordingStore::app_local(temp.path(), "../escape").is_err());
}
