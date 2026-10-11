use super::*;
use std::fs;

#[test]
fn rename_cannot_replace_a_recoverable_draft_through_a_destination_alias() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "rename-alias");
    fs::create_dir(root.join("real")).unwrap();
    fs::write(root.join("real/target.js"), "recoverable base").unwrap();
    std::os::unix::fs::symlink(root.join("real"), root.join("alias")).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    access
        .read(&identity, "real/target.js", &protection)
        .unwrap();
    fs::remove_file(root.join("real/target.js")).unwrap();
    let error = access
        .rename(
            &identity,
            "server.js",
            "alias/target.js",
            &["real/target.js".into()],
            &protection,
        )
        .unwrap_err();
    assert_eq!(error.code, CreationErrorCode::TargetExists);
    assert!(access.read(&identity, "server.js", &protection).is_ok());
    assert_eq!(
        access
            .read(&identity, "real/target.js", &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::Missing
    );
}

#[test]
fn watch_reports_add_remove_and_same_size_edits_without_losing_unacknowledged_changes() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "watched");
    fs::write(root.join("page.html"), "old").unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let opened = access.open(&root, &protection).unwrap();
    let identity = &opened.project.identity;
    assert!(access
        .poll(identity, 0, &protection)
        .unwrap()
        .changed
        .is_empty());
    fs::write(root.join("page.html"), "new").unwrap();
    fs::write(root.join("added.js"), "added").unwrap();
    fs::remove_file(root.join("server.js")).unwrap();
    let change = access.poll(identity, 0, &protection).unwrap();
    assert_eq!(change.changed, ["added.js", "page.html", "server.js"]);
    assert!(change.files.iter().any(|file| file.path == "added.js"));
    assert!(!change.files.iter().any(|file| file.path == "server.js"));
    assert_eq!(
        access.poll(identity, 0, &protection).unwrap().changed,
        change.changed
    );
    assert!(access
        .poll(identity, change.revision, &protection)
        .unwrap()
        .changed
        .is_empty());
    let next = project(temp.path(), "next");
    access.open(&next, &protection).unwrap();
    assert_eq!(
        access.poll(identity, 0, &protection).unwrap_err().code,
        CreationErrorCode::InvalidIdentity
    );
}

#[test]
fn watch_omits_dependencies_and_rejects_external_symlinks_and_replaced_roots() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "bounded");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let opened = access.open(&root, &protection).unwrap();
    for name in ["node_modules", ".git"] {
        fs::create_dir(root.join(name)).unwrap();
        fs::write(root.join(name).join("ignored.js"), "ignored").unwrap();
    }
    assert!(access
        .poll(&opened.project.identity, 0, &protection)
        .unwrap()
        .changed
        .is_empty());
    let outside = temp.path().join("secret.txt");
    fs::write(&outside, "not project content").unwrap();
    std::os::unix::fs::symlink(&outside, root.join("escape.txt")).unwrap();
    assert_eq!(
        access
            .poll(&opened.project.identity, 0, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::PathEscape
    );
    fs::remove_file(root.join("escape.txt")).unwrap();
    fs::rename(&root, temp.path().join("old-root")).unwrap();
    project(temp.path(), "bounded");
    assert_eq!(
        access
            .poll(&opened.project.identity, 0, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
}

#[test]
fn runtime_generation_change_rejects_a_prepared_mode_commit() {
    let manager = crate::project::session::SessionManager::default();
    let initial = manager.creation_runtime();
    let app = tauri::test::mock_app();
    crate::events::events_builder::<tauri::test::MockRuntime>().mount_events(app.handle());
    manager.stop(app.handle()).unwrap();
    assert!(manager
        .with_creation_generation(&initial.generation, |_| Ok(()))
        .is_err());
    let current = manager.creation_runtime();
    assert_ne!(initial.generation, current.generation);
    manager
        .with_creation_generation(&current.generation, |_| Ok(()))
        .unwrap();
}

#[test]
fn preparing_then_cancelling_keeps_the_active_project_readable() {
    let temp = tempfile::tempdir().unwrap();
    let first = project(temp.path(), "first");
    let second = project(temp.path(), "second");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let original = access.open(&first, &protection).unwrap().project;
    let pending = access.prepare(&second, &protection).unwrap().project;
    access
        .read(&original.identity, "server.js", &protection)
        .unwrap();
    access.close(&pending.identity);
    access
        .read(&original.identity, "server.js", &protection)
        .unwrap();
    assert!(access.commit(&pending.identity, &protection).is_err());
    let pending = access.prepare(&second, &protection).unwrap().project;
    access.commit(&pending.identity, &protection).unwrap();
    access
        .read(&pending.identity, "server.js", &protection)
        .unwrap();
    assert_eq!(
        access
            .read(&original.identity, "server.js", &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
}

fn project(parent: &std::path::Path, name: &str) -> std::path::PathBuf {
    let root = parent.join(name);
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("server.js"), "// unfinished score server").unwrap();
    fs::write(root.join("manifest.json"), r#"{
        "schemaVersion": 1, "id": "draft", "name": "Draft", "version": "0.1.0",
        "scoreServer": { "entry": "server.js", "workingDirectory": ".", "performerPort": 6868, "monitorPort": 6869 },
        "audio": { "defaultMode": "internal", "supportedModes": ["internal"], "synthdefs": ["not-compiled.scsyndef"], "scsynth": { "blockSize": 64, "audioBusChannels": 128 } }
    }"#).unwrap();
    root
}

#[test]
fn opens_an_agent_draft_without_runtime_or_compile_acceptance() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "draft");
    fs::write(
        root.join("package.json"),
        r#"{"dependencies":{"socket.io":"4"}}"#,
    )
    .unwrap();
    let mut workspace = CreationAccess::default();
    let opened = workspace
        .open(&root, &Protection::default())
        .unwrap()
        .project;
    assert_eq!(opened.source, CreationSource::Folder);
    assert_eq!(opened.name, "Draft");
    assert_eq!(
        workspace
            .read(&opened.identity, "server.js", &Protection::default())
            .unwrap(),
        CreationContent::Text {
            text: "// unfinished score server".into(),
            version: file_version(b"// unfinished score server"),
        }
    );
}

#[test]
fn reopening_installs_and_registered_tools_through_symlinks_keeps_their_source() {
    let temp = tempfile::tempdir().unwrap();
    let installed = project(temp.path(), "bundles/draft");
    let tool = project(temp.path(), "utilities/tool");
    let protection = Protection {
        bundles: vec![temp.path().join("bundles")],
        utilities: vec![tool.clone()],
    };
    std::os::unix::fs::symlink(&installed, temp.path().join("alias")).unwrap();
    let mut workspace = CreationAccess::default();
    for path in [&installed, &temp.path().join("alias")] {
        assert_eq!(
            workspace.open(path, &protection).unwrap().project.source,
            CreationSource::Bundle
        );
    }
    assert_eq!(
        workspace.open(&tool, &protection).unwrap().project.source,
        CreationSource::Utility
    );
    let enclosing = project(temp.path(), "enclosing");
    let contained = project(&enclosing, "bundles/installed");
    assert_eq!(
        workspace
            .open(
                &enclosing,
                &Protection {
                    bundles: vec![contained],
                    utilities: vec![]
                }
            )
            .unwrap()
            .project
            .source,
        CreationSource::Bundle
    );
}

#[test]
fn an_unwritable_folder_explains_its_read_only_identity() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "readonly");
    fs::set_permissions(&root, fs::Permissions::from_mode(0o555)).unwrap();
    let mut workspace = CreationAccess::default();
    assert_eq!(
        workspace
            .open(&root, &Protection::default())
            .unwrap()
            .project
            .source,
        CreationSource::ReadOnlyFolder
    );
}

#[test]
fn excessive_file_count_or_depth_cannot_replace_the_current_project() {
    let temp = tempfile::tempdir().unwrap();
    let first = project(temp.path(), "first");
    let many = project(temp.path(), "many");
    let deep = project(temp.path(), "deep");
    for index in 0..4096 {
        fs::write(many.join(format!("file-{index}.txt")), "").unwrap();
    }
    let mut nested = deep.clone();
    for _ in 0..33 {
        nested = nested.join("child");
        fs::create_dir(&nested).unwrap();
    }
    let protection = Protection::default();
    let mut workspace = CreationAccess::default();
    let identity = workspace
        .open(&first, &protection)
        .unwrap()
        .project
        .identity;
    for rejected in [many, deep] {
        assert_eq!(
            workspace.open(&rejected, &protection).unwrap_err().code,
            CreationErrorCode::TooLarge
        );
        workspace.read(&identity, "server.js", &protection).unwrap();
    }
}

#[test]
fn all_file_operations_reject_escape_and_unknown_or_replaced_identities() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "draft");
    fs::write(temp.path().join("secret.txt"), "outside").unwrap();
    let mut workspace = CreationAccess::default();
    let protection = Protection::default();
    let opened = workspace.open(&root, &protection).unwrap().project;
    std::os::unix::fs::symlink(temp.path().join("secret.txt"), root.join("escape.txt")).unwrap();
    for path in ["../secret.txt", "/etc/passwd", "escape.txt"] {
        assert_eq!(
            workspace
                .read(&opened.identity, path, &protection)
                .unwrap_err()
                .code,
            CreationErrorCode::PathEscape
        );
        assert_eq!(
            workspace
                .finder_target(&opened.identity, Some(path), &protection)
                .unwrap_err()
                .code,
            CreationErrorCode::PathEscape
        );
    }
    assert_eq!(
        workspace
            .list(&opened.identity, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::PathEscape
    );
    assert_eq!(
        workspace.list("forged", &protection).unwrap_err().code,
        CreationErrorCode::InvalidIdentity
    );
    assert_eq!(
        workspace
            .read("forged", "server.js", &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
    assert_eq!(
        workspace
            .finder_target("forged", None, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
    fs::rename(&root, temp.path().join("old")).unwrap();
    project(temp.path(), "draft");
    assert_eq!(
        workspace
            .list(&opened.identity, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
}

#[test]
fn failed_switch_preserves_identity_and_successful_switch_revokes_it() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "first");
    let second = project(temp.path(), "second");
    let mut workspace = CreationAccess::default();
    let protection = Protection::default();
    let first = workspace.open(&root, &protection).unwrap().project;
    assert!(workspace.open(temp.path(), &protection).is_err());
    workspace
        .read(&first.identity, "server.js", &protection)
        .unwrap();
    let next = workspace.open(&second, &protection).unwrap().project;
    workspace.close(&first.identity);
    workspace
        .read(&next.identity, "server.js", &protection)
        .unwrap();
    assert_eq!(
        workspace
            .read(&first.identity, "server.js", &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
    workspace.close(&next.identity);
    assert_eq!(
        workspace
            .list(&next.identity, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
}

#[test]
fn bounded_reads_distinguish_missing_permission_utf8_and_size() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "draft");
    let protection = Protection::default();
    let mut workspace = CreationAccess::default();
    let identity = workspace.open(&root, &protection).unwrap().project.identity;
    fs::write(root.join("invalid.txt"), [0xff]).unwrap();
    fs::write(
        root.join("large.txt"),
        vec![b'a'; TEXT_MAX_BYTES as usize + 1],
    )
    .unwrap();
    fs::write(root.join("denied.txt"), "private").unwrap();
    fs::set_permissions(root.join("denied.txt"), fs::Permissions::from_mode(0o0)).unwrap();
    for (path, code) in [
        ("gone.txt", CreationErrorCode::Missing),
        ("invalid.txt", CreationErrorCode::InvalidUtf8),
        ("large.txt", CreationErrorCode::TooLarge),
        ("denied.txt", CreationErrorCode::Permission),
    ] {
        assert_eq!(
            workspace
                .read(&identity, path, &protection)
                .unwrap_err()
                .code,
            code
        );
    }
}

#[test]
fn listing_preserves_paths_internal_links_and_asset_types_with_bounded_previews() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "draft");
    fs::create_dir_all(root.join("public/images")).unwrap();
    fs::create_dir_all(root.join("audio")).unwrap();
    fs::create_dir_all(root.join("node_modules/hidden")).unwrap();
    fs::write(root.join("public/images/score.PNG"), b"image").unwrap();
    fs::write(root.join("audio/track.wav"), b"audio").unwrap();
    std::os::unix::fs::symlink(root.join("server.js"), root.join("linked.js")).unwrap();
    let mut workspace = CreationAccess::default();
    let protection = Protection::default();
    let opened = workspace.open(&root, &protection).unwrap();
    let identity = opened.project.identity;
    assert_eq!(
        workspace.list(&identity, &protection).unwrap().len(),
        opened.files.len()
    );
    let image = opened
        .files
        .iter()
        .find(|f| f.path == "public/images/score.PNG")
        .unwrap();
    assert_eq!(image.category, CreationCategory::Assets);
    assert_eq!(image.kind, CreationFileKind::Image);
    assert_eq!(image.size, 5.0);
    assert_eq!(
        workspace
            .read(&identity, "audio/track.wav", &protection)
            .unwrap(),
        CreationContent::Binary
    );
    assert_eq!(
        workspace
            .read(&identity, "public/images/score.PNG", &protection)
            .unwrap(),
        CreationContent::Image {
            url: "data:image/png;base64,aW1hZ2U=".into()
        }
    );
    assert!(workspace.read(&identity, "linked.js", &protection).is_ok());
    assert_eq!(
        workspace
            .finder_target(&identity, Some("linked.js"), &protection)
            .unwrap(),
        fs::canonicalize(root.join("server.js")).unwrap()
    );
    fs::write(
        root.join("public/images/score.PNG"),
        vec![0; IMAGE_MAX_BYTES as usize + 1],
    )
    .unwrap();
    assert_eq!(
        workspace
            .read(&identity, "public/images/score.PNG", &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::TooLarge
    );
}

#[test]
fn saves_atomically_with_version_checking_and_reports_new_versions() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "draft");
    let protection = Protection::default();
    let mut workspace = CreationAccess::default();
    let identity = workspace.open(&root, &protection).unwrap().project.identity;
    let read = match workspace.read(&identity, "server.js", &protection).unwrap() {
        CreationContent::Text { text, version } => (text, version),
        other => panic!("unexpected content: {other:?}"),
    };
    let saved = workspace
        .save(&identity, "server.js", "// edited", &read.1, &protection)
        .unwrap();
    assert_eq!(saved, file_version(b"// edited"));
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "// edited"
    );
    assert_eq!(
        workspace.read(&identity, "server.js", &protection).unwrap(),
        CreationContent::Text {
            text: "// edited".into(),
            version: saved,
        }
    );
    // No atomic-save temp litter survives a successful write.
    assert!(!fs::read_dir(&root).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".pnds-")));
}

#[test]
fn external_disk_changes_conflict_and_repeated_changes_rerequire_confirmation() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "draft");
    let protection = Protection::default();
    let mut workspace = CreationAccess::default();
    let identity = workspace.open(&root, &protection).unwrap().project.identity;
    let first = text_version(&workspace, &identity, "server.js", &protection);
    // First external change: the version read at open time no longer matches.
    fs::write(root.join("server.js"), "// external one").unwrap();
    assert_eq!(
        workspace
            .save(&identity, "server.js", "// mine", &first, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "// external one"
    );
    assert!(!fs::read_dir(&root).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".pnds-")));
    // The user re-reads and confirms overwriting the displayed version…
    let second = text_version(&workspace, &identity, "server.js", &protection);
    // …but the disk changes again before the write: a new confirmation is
    // required, the overwrite is refused.
    fs::write(root.join("server.js"), "// external two").unwrap();
    assert_eq!(
        workspace
            .save(&identity, "server.js", "// mine", &second, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    // Re-reading the newest version finally lets the explicit overwrite land.
    let third = text_version(&workspace, &identity, "server.js", &protection);
    workspace
        .save(&identity, "server.js", "// mine", &third, &protection)
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "// mine"
    );
    // Idempotent external writes keep the version stable — no false conflict.
    let stable = text_version(&workspace, &identity, "server.js", &protection);
    fs::write(root.join("server.js"), "// mine").unwrap();
    workspace
        .save(
            &identity,
            "server.js",
            "// mine again",
            &stable,
            &protection,
        )
        .unwrap();
}

fn text_version(
    workspace: &CreationAccess,
    identity: &str,
    path: &str,
    protection: &Protection,
) -> String {
    match workspace.read(identity, path, protection).unwrap() {
        CreationContent::Text { version, .. } => version,
        other => panic!("unexpected content: {other:?}"),
    }
}

#[test]
fn saves_reject_escape_symlinks_read_only_sources_and_bad_targets() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "draft");
    fs::write(temp.path().join("secret.txt"), "outside").unwrap();
    fs::write(root.join("track.wav"), b"audio").unwrap();
    fs::write(root.join("gone.js"), "bye").unwrap();
    let protection = Protection::default();
    let mut workspace = CreationAccess::default();
    let identity = workspace.open(&root, &protection).unwrap().project.identity;
    // Symlinks out of the project join after opening: the tree walk that
    // gates opening refuses them up front.
    std::os::unix::fs::symlink(temp.path().join("secret.txt"), root.join("escape.txt")).unwrap();
    let version = file_version(b"bye");
    for (path, code) in [
        ("../server.js", CreationErrorCode::PathEscape),
        ("/etc/passwd", CreationErrorCode::PathEscape),
        ("escape.txt", CreationErrorCode::PathEscape),
        ("missing.js", CreationErrorCode::Missing),
        ("track.wav", CreationErrorCode::InvalidProject),
    ] {
        assert_eq!(
            workspace
                .save(&identity, path, "// x", &version, &protection)
                .unwrap_err()
                .code,
            code,
            "case {path}"
        );
    }
    assert_eq!(
        workspace
            .save("forged", "server.js", "// x", &version, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
    fs::remove_file(root.join("gone.js")).unwrap();
    assert_eq!(
        workspace
            .save(&identity, "gone.js", "// x", &version, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::Missing
    );
    // A read-only folder opens as a read-only source: writing is refused
    // with readable feedback, not a silent pass-through.
    let readonly = project(temp.path(), "readonly");
    fs::set_permissions(&readonly, fs::Permissions::from_mode(0o555)).unwrap();
    let read_only_identity = workspace
        .open(&readonly, &protection)
        .unwrap()
        .project
        .identity;
    let version = text_version(&workspace, &read_only_identity, "server.js", &protection);
    assert_eq!(
        workspace
            .save(
                &read_only_identity,
                "server.js",
                "// x",
                &version,
                &protection
            )
            .unwrap_err()
            .code,
        CreationErrorCode::Permission
    );
    assert_eq!(
        workspace
            .rename(
                &read_only_identity,
                "server.js",
                "next.js",
                &[],
                &protection
            )
            .unwrap_err()
            .code,
        CreationErrorCode::Permission
    );
    fs::set_permissions(&readonly, fs::Permissions::from_mode(0o755)).unwrap();
}

#[test]
fn saves_over_the_text_limit_are_refused_before_touching_disk() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "draft");
    let protection = Protection::default();
    let mut workspace = CreationAccess::default();
    let identity = workspace.open(&root, &protection).unwrap().project.identity;
    let version = text_version(&workspace, &identity, "server.js", &protection);
    let huge = "a".repeat(TEXT_MAX_BYTES as usize + 1);
    assert_eq!(
        workspace
            .save(&identity, "server.js", &huge, &version, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::TooLarge
    );
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "// unfinished score server"
    );
}

#[test]
fn saves_into_an_unwritable_directory_report_permission_and_change_nothing() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "draft");
    fs::create_dir_all(root.join("locked")).unwrap();
    fs::write(root.join("locked/page.js"), "// page").unwrap();
    // The project root stays writable (still an editable Folder source);
    // only the target directory refuses the atomic-save temp file.
    fs::set_permissions(root.join("locked"), fs::Permissions::from_mode(0o555)).unwrap();
    let protection = Protection::default();
    let mut workspace = CreationAccess::default();
    let identity = workspace.open(&root, &protection).unwrap().project.identity;
    let version = text_version(&workspace, &identity, "locked/page.js", &protection);
    assert_eq!(
        workspace
            .save(
                &identity,
                "locked/page.js",
                "// edited",
                &version,
                &protection
            )
            .unwrap_err()
            .code,
        CreationErrorCode::Permission
    );
    assert_eq!(
        fs::read_to_string(root.join("locked/page.js")).unwrap(),
        "// page"
    );
    fs::set_permissions(root.join("locked"), fs::Permissions::from_mode(0o755)).unwrap();
    workspace
        .save(
            &identity,
            "locked/page.js",
            "// edited",
            &version,
            &protection,
        )
        .unwrap();
}

#[test]
fn renames_move_files_without_overwriting_targets_or_fixing_references() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "draft");
    fs::create_dir_all(root.join("public")).unwrap();
    fs::create_dir_all(root.join("pages")).unwrap();
    fs::write(root.join("public/page.js"), "// page").unwrap();
    let protection = Protection::default();
    let mut workspace = CreationAccess::default();
    let identity = workspace.open(&root, &protection).unwrap().project.identity;
    let moved = workspace
        .rename(
            &identity,
            "public/page.js",
            "pages/page.js",
            &[],
            &protection,
        )
        .unwrap();
    assert_eq!(moved, "pages/page.js");
    assert_eq!(
        fs::read_to_string(root.join("pages/page.js")).unwrap(),
        "// page"
    );
    assert!(!root.join("public/page.js").exists());
    // Existing targets are never replaced — the original stays intact.
    fs::write(root.join("target.js"), "// existing").unwrap();
    assert_eq!(
        workspace
            .rename(&identity, "pages/page.js", "target.js", &[], &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    assert_eq!(
        fs::read_to_string(root.join("target.js")).unwrap(),
        "// existing"
    );
    assert_eq!(
        fs::read_to_string(root.join("pages/page.js")).unwrap(),
        "// page"
    );
    // The manifest keeps pointing at the old name — references are the
    // external agent's job, never rewritten by the rename itself.
    workspace
        .rename(
            &identity,
            "server.js",
            "renamed-server.js",
            &[],
            &protection,
        )
        .unwrap();
    assert!(fs::read_to_string(root.join("manifest.json"))
        .unwrap()
        .contains("\"entry\": \"server.js\""));
    for (path, code) in [
        ("../page.js", CreationErrorCode::PathEscape),
        ("/tmp/page.js", CreationErrorCode::PathEscape),
        ("", CreationErrorCode::InvalidProject),
        (".", CreationErrorCode::PathEscape),
        ("..", CreationErrorCode::PathEscape),
        ("no-such-dir/page.js", CreationErrorCode::Missing),
        ("manifest.json/../new.js", CreationErrorCode::PathEscape),
    ] {
        assert_eq!(
            workspace
                .rename(&identity, "pages/page.js", path, &[], &protection)
                .unwrap_err()
                .code,
            code,
            "case {path}"
        );
    }
    // A missing source and an escaping source symlink read clearly.
    assert_eq!(
        workspace
            .rename(&identity, "gone.js", "next.js", &[], &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::Missing
    );
    fs::write(temp.path().join("secret.txt"), "outside").unwrap();
    std::os::unix::fs::symlink(temp.path().join("secret.txt"), root.join("out.js")).unwrap();
    assert_eq!(
        workspace
            .rename(&identity, "out.js", "in.js", &[], &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::PathEscape
    );
    // Directories are not rename targets through the file workspace.
    assert_eq!(
        workspace
            .rename(&identity, "public", "renamed", &[], &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidProject
    );
    assert_eq!(
        workspace
            .rename("forged", "pages/page.js", "next.js", &[], &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
}
