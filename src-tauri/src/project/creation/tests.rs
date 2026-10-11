use super::*;
use std::fs;

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
            text: "// unfinished score server".into()
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
    fs::set_permissions(root.join("denied.txt"), fs::Permissions::from_mode(0)).unwrap();
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
