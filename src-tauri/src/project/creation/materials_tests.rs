use super::tests::project;
use super::*;

#[test]
fn material_copies_survive_restart_and_removal_keeps_adopted_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "material-score");
    let data = temp.path().join("app-data");
    let original = temp.path().join("Grid.js");
    fs::write(&original, "class Grid { /* 潮汐 🎼 */ }").unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let files_before = access.list(&identity, &protection).unwrap();
    let manifest_before = fs::read(root.join("manifest.json")).unwrap();
    let server_before = fs::read(root.join("server.js")).unwrap();
    let added = access
        .add_material(&data, &identity, &original, &protection)
        .unwrap();
    assert_eq!(added.name, "Grid.js");
    assert_eq!(
        access.list(&identity, &protection).unwrap().len(),
        files_before.len()
    );
    fs::write(&original, "changed external original").unwrap();
    drop(access);
    let mut reopened = CreationAccess::default();
    let identity = reopened.open(&root, &protection).unwrap().project.identity;
    let materials = reopened
        .list_materials(&data, &identity, &protection)
        .unwrap();
    assert_eq!(materials.len(), 1);
    assert_eq!(materials[0].id, added.id);
    let page = reopened
        .read_material(
            &data,
            &identity,
            &CreationMaterialRead {
                id: added.id.clone(),
                version: added.version.clone(),
                offset: 0,
                page_length: 10_000,
            },
            &protection,
        )
        .unwrap();
    assert_eq!(page.text, "class Grid { /* 潮汐 🎼 */ }");
    fs::write(root.join("adopted.js"), "class Grid { /* adapted */ }").unwrap();
    reopened
        .remove_material(&data, &identity, &added.id, &protection)
        .unwrap();
    assert!(reopened
        .list_materials(&data, &identity, &protection)
        .unwrap()
        .is_empty());
    assert_eq!(
        fs::read_to_string(root.join("adopted.js")).unwrap(),
        "class Grid { /* adapted */ }"
    );
    assert_eq!(
        fs::read_to_string(original).unwrap(),
        "changed external original"
    );
    assert_eq!(
        fs::read(root.join("manifest.json")).unwrap(),
        manifest_before
    );
    assert_eq!(fs::read(root.join("server.js")).unwrap(), server_before);
}

#[test]
fn materials_are_bound_to_current_actual_directory_and_reject_invalid_selected_files() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "materials-a");
    let other = project(temp.path(), "materials-b");
    fs::copy(root.join("manifest.json"), other.join("manifest.json")).unwrap();
    let data = temp.path().join("data");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let source = temp.path().join("Notes.md");
    fs::write(&source, "Keep the original score").unwrap();
    let material = access
        .add_material(&data, &identity, &source, &protection)
        .unwrap();
    for (name, bytes, expected) in [
        ("binary.js", vec![0, 1, 2], MaterialError::Binary),
        ("encoding.txt", vec![255], MaterialError::Binary),
        (
            "large.md",
            vec![b'a'; TEXT_MAX_BYTES as usize + 1],
            MaterialError::TooLarge,
        ),
        (
            "picture.png",
            b"text".to_vec(),
            MaterialError::UnsupportedType,
        ),
    ] {
        let path = temp.path().join(name);
        fs::write(&path, bytes).unwrap();
        assert_eq!(
            access
                .add_material(&data, &identity, &path, &protection)
                .unwrap_err(),
            expected
        );
    }
    assert_eq!(
        access
            .add_material(
                &data,
                &identity,
                &temp.path().join("absent.js"),
                &protection
            )
            .unwrap_err(),
        MaterialError::Unreadable
    );
    assert_eq!(
        access
            .list_materials(&data, &identity, &protection)
            .unwrap()
            .len(),
        1
    );
    let next = access.open(&other, &protection).unwrap().project.identity;
    assert!(access
        .list_materials(&data, &next, &protection)
        .unwrap()
        .is_empty());
    assert_eq!(
        access
            .add_material(&data, &identity, &source, &protection)
            .unwrap_err(),
        MaterialError::InvalidIdentity
    );
    assert_eq!(
        access
            .remove_material(&data, &identity, &material.id, &protection)
            .unwrap_err(),
        MaterialError::InvalidIdentity
    );
    let alias = temp.path().join("alias");
    symlink(&root, &alias).unwrap();
    let aliased = access.open(&alias, &protection).unwrap().project.identity;
    assert_eq!(
        access.list_materials(&data, &aliased, &protection).unwrap()[0].id,
        material.id
    );
}

#[test]
fn material_pages_use_actual_utf16_ranges_and_require_the_immutable_version() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "material-pages");
    let data = temp.path().join("data");
    let source = temp.path().join("Intent.txt");
    let text = format!("{}🎼\nnext", "a".repeat(63));
    fs::write(&source, &text).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let material = access
        .add_material(&data, &identity, &source, &protection)
        .unwrap();
    let mut read = CreationMaterialRead {
        id: material.id,
        version: material.version,
        offset: 0,
        page_length: 64,
    };
    let first = access
        .read_material(&data, &identity, &read, &protection)
        .unwrap();
    assert_eq!(first.text, "a".repeat(63));
    assert_eq!(
        (first.offset, first.end_offset, first.next_offset),
        (0, 63, Some(63))
    );
    read.offset = 63;
    let last = access
        .read_material(&data, &identity, &read, &protection)
        .unwrap();
    assert_eq!(last.text, "🎼\nnext");
    assert_eq!(
        (
            last.offset,
            last.end_offset,
            last.total_characters,
            last.next_offset
        ),
        (63, 70, 70, None)
    );
    assert_eq!((last.start_line, last.end_line), (1, 2));
    read.offset = 64;
    let boundary = access
        .read_material(&data, &identity, &read, &protection)
        .unwrap();
    assert_eq!((boundary.offset, boundary.text.as_str()), (65, "\nnext"));
    read.version = "outdated".into();
    assert_eq!(
        access
            .read_material(&data, &identity, &read, &protection)
            .unwrap_err(),
        MaterialError::VersionConflict
    );
}

#[test]
fn failed_material_publication_keeps_previous_bytes_and_symlinked_storage_is_refused() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "material-failures");
    let data = temp.path().join("data");
    let source = temp.path().join("Notes.txt");
    fs::write(&source, "valid original").unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let material = access
        .add_material(&data, &identity, &source, &protection)
        .unwrap();
    let directory = root.join(".pnds-creation");
    let record = directory.join("materials.json");
    let before = fs::read(&record).unwrap();
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o500)).unwrap();
    // The operation must not relax an existing private directory's permissions.
    assert_eq!(
        access.remove_material(&data, &identity, &material.id, &protection),
        Err(MaterialError::Storage)
    );
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(fs::read(&record).unwrap(), before);
    assert_eq!(
        access
            .list_materials(&data, &identity, &protection)
            .unwrap()
            .len(),
        1
    );
    let moved = temp.path().join("kept-materials");
    fs::rename(&directory, &moved).unwrap();
    symlink(&moved, &directory).unwrap();
    assert_eq!(
        access
            .list_materials(&data, &identity, &protection)
            .unwrap_err(),
        MaterialError::Storage
    );
    assert_eq!(
        fs::read(moved.join(record.file_name().unwrap())).unwrap(),
        before
    );
}

#[test]
fn material_collection_budget_and_invalid_records_cannot_overwrite_valid_copies() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "material-limits");
    let data = temp.path().join("data");
    let source = temp.path().join("Long.txt");
    fs::write(&source, "\n".repeat(TEXT_MAX_BYTES as usize)).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    for _ in 0..3 {
        access
            .add_material(&data, &identity, &source, &protection)
            .unwrap();
    }
    assert_eq!(
        access
            .add_material(&data, &identity, &source, &protection)
            .unwrap_err(),
        MaterialError::LimitExceeded
    );
    assert_eq!(
        access
            .list_materials(&data, &identity, &protection)
            .unwrap()
            .len(),
        3
    );
    let record = root.join(".pnds-creation/materials.json");
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&record).unwrap()).unwrap();
    value["schema"] = serde_json::json!(99);
    let unknown = serde_json::to_vec(&value).unwrap();
    fs::write(&record, &unknown).unwrap();
    assert_eq!(
        access
            .add_material(&data, &identity, &source, &protection)
            .unwrap_err(),
        MaterialError::InvalidRecord
    );
    assert_eq!(
        access.remove_material(&data, &identity, "any", &protection),
        Err(MaterialError::InvalidRecord)
    );
    assert_eq!(fs::read(record).unwrap(), unknown);
}

fn legacy_material_record(root: &Path, data: &Path) -> (PathBuf, CreationMaterial) {
    use sha2::{Digest, Sha256};
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    let text = "Original creative notes 🎼";
    let key = format!(
        "{:x}",
        Sha256::digest(fs::canonicalize(root).unwrap().as_os_str().as_bytes())
    );
    let material = CreationMaterial {
        id: "a".repeat(32),
        name: "Intent.md".into(),
        version: format!("{:x}", Sha256::digest(text.as_bytes())),
        size: text.len() as u32,
        total_characters: text.encode_utf16().count() as u32,
    };
    let directory = data.join("assistant-materials");
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&directory)
        .unwrap();
    let path = directory.join(format!("{key}.json"));
    fs::write(
        &path,
        serde_json::to_vec(&serde_json::json!({
            "schema": 1,
            "projectKey": key,
            "materials": [{"material": material, "text": text}]
        }))
        .unwrap(),
    )
    .unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    (path, material)
}

#[test]
fn materials_move_with_the_project_and_copied_projects_keep_independent_changes() {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "portable-materials");
    let data = temp.path().join("app-data");
    let source = temp.path().join("Intent.txt");
    fs::write(&source, "Portable material 🎼").unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let material = access
        .add_material(&data, &identity, &source, &protection)
        .unwrap();
    drop(access);
    let moved = temp.path().join("moved-materials");
    fs::rename(&root, &moved).unwrap();
    // Another machine has neither the original path nor its App-data directory.
    let fresh_data = temp.path().join("another-machine-data");
    let mut access = CreationAccess::default();
    let moved_identity = access.open(&moved, &protection).unwrap().project.identity;
    assert_eq!(
        access
            .material_text(
                &fresh_data,
                &moved_identity,
                &material.id,
                &material.version,
                &protection
            )
            .unwrap(),
        "Portable material 🎼"
    );
    let copy = project(temp.path(), "copied-materials");
    fs::copy(moved.join("manifest.json"), copy.join("manifest.json")).unwrap();
    fs::DirBuilder::new()
        .mode(0o700)
        .create(copy.join(".pnds-creation"))
        .unwrap();
    fs::copy(
        moved.join(".pnds-creation/materials.json"),
        copy.join(".pnds-creation/materials.json"),
    )
    .unwrap();
    let mut copied_access = CreationAccess::default();
    let copied_identity = copied_access
        .open(&copy, &protection)
        .unwrap()
        .project
        .identity;
    assert_eq!(
        copied_access
            .list_materials(&fresh_data, &copied_identity, &protection)
            .unwrap()[0]
            .id,
        material.id
    );
    copied_access
        .remove_material(&fresh_data, &copied_identity, &material.id, &protection)
        .unwrap();
    assert_eq!(
        access
            .list_materials(&fresh_data, &moved_identity, &protection)
            .unwrap()[0]
            .id,
        material.id
    );
    fs::write(&source, "Only the copy receives this material").unwrap();
    copied_access
        .add_material(&fresh_data, &copied_identity, &source, &protection)
        .unwrap();
    assert_eq!(
        access
            .list_materials(&fresh_data, &moved_identity, &protection)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        access
            .material_text(
                &fresh_data,
                &moved_identity,
                &material.id,
                &material.version,
                &protection
            )
            .unwrap(),
        "Portable material 🎼"
    );
    assert_eq!(
        fs::metadata(copy.join(".pnds-creation/materials.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
}

#[test]
fn legacy_materials_migrate_once_and_local_removal_never_resurrects_the_backup() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "legacy-materials");
    let data = temp.path().join("data");
    let (legacy, material) = legacy_material_record(&root, &data);
    let before = fs::read(&legacy).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    assert_eq!(
        access
            .list_materials(&data, &identity, &protection)
            .unwrap()[0]
            .id,
        material.id
    );
    let local = root.join(".pnds-creation/materials.json");
    let local_value: serde_json::Value =
        serde_json::from_slice(&fs::read(&local).unwrap()).unwrap();
    assert_eq!(local_value["schema"], 2);
    assert_eq!(local_value["projectKey"], "project");
    assert_eq!(fs::read(&legacy).unwrap(), before);
    access
        .remove_material(&data, &identity, &material.id, &protection)
        .unwrap();
    drop(access);
    let mut reopened = CreationAccess::default();
    let identity = reopened.open(&root, &protection).unwrap().project.identity;
    assert!(reopened
        .list_materials(&data, &identity, &protection)
        .unwrap()
        .is_empty());
    assert_eq!(fs::read(&legacy).unwrap(), before);
    // A new directory with the same manifest does not import another root's backup.
    let other = project(temp.path(), "legacy-materials-copy");
    fs::copy(root.join("manifest.json"), other.join("manifest.json")).unwrap();
    let identity = reopened.open(&other, &protection).unwrap().project.identity;
    assert!(reopened
        .list_materials(&data, &identity, &protection)
        .unwrap()
        .is_empty());
}

#[test]
fn corrupt_material_migration_and_existing_local_records_are_never_overwritten() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "corrupt-legacy-materials");
    let data = temp.path().join("data");
    let (legacy, _) = legacy_material_record(&root, &data);
    let valid_legacy = fs::read(&legacy).unwrap();
    fs::write(&legacy, "corrupt backup").unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    assert_eq!(
        access
            .list_materials(&data, &identity, &protection)
            .unwrap_err(),
        MaterialError::InvalidRecord
    );
    let local = root.join(".pnds-creation/materials.json");
    assert!(!local.exists());
    assert_eq!(fs::read_to_string(&legacy).unwrap(), "corrupt backup");
    fs::write(&legacy, &valid_legacy).unwrap();
    fs::write(&local, "corrupt local collection").unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&local, fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(
        access
            .list_materials(&data, &identity, &protection)
            .unwrap_err(),
        MaterialError::InvalidRecord
    );
    assert_eq!(
        fs::read_to_string(&local).unwrap(),
        "corrupt local collection"
    );
    assert_eq!(fs::read(&legacy).unwrap(), valid_legacy);
}

#[test]
fn symlinked_material_files_cannot_import_or_redirect_project_storage() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "symlink-material-files");
    let data = temp.path().join("data");
    let (legacy, _) = legacy_material_record(&root, &data);
    let kept = temp.path().join("kept-legacy.json");
    fs::rename(&legacy, &kept).unwrap();
    symlink(&kept, &legacy).unwrap();
    let before = fs::read(&kept).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    assert_eq!(
        access
            .list_materials(&data, &identity, &protection)
            .unwrap_err(),
        MaterialError::Storage
    );
    let local = root.join(".pnds-creation/materials.json");
    assert!(!local.exists());
    symlink(&kept, &local).unwrap();
    assert_eq!(
        access
            .list_materials(&data, &identity, &protection)
            .unwrap_err(),
        MaterialError::Storage
    );
    assert_eq!(fs::read(&kept).unwrap(), before);
}
