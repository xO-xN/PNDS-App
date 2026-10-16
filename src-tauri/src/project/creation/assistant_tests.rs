use super::*;
use std::os::unix::fs::symlink;

#[test]
fn assistant_reads_saved_pages_and_reports_exclusions_through_the_creation_capability() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    fs::write(
        root.join("score.js"),
        "const tempo = 80;\nconst title = '曲';\n",
    )
    .unwrap();
    fs::write(root.join(".env"), "SECRET=never-send").unwrap();
    fs::create_dir(root.join("dist")).unwrap();
    fs::write(root.join("dist/private.js"), "never-send").unwrap();
    symlink(".env", root.join("alias.js")).unwrap();
    symlink("dist/private.js", root.join("built.js")).unwrap();
    let scope = access.assistant_inventory(&identity, &protection).unwrap();
    let source = scope
        .files
        .iter()
        .find(|file| file.path == "score.js")
        .unwrap();
    assert!(source.reason.is_none());
    let page = access
        .assistant_read(
            &identity,
            &AssistantProjectRead {
                path: "score.js".into(),
                version: source.version.clone(),
                offset: 0,
                page_length: 64,
            },
            &protection,
        )
        .unwrap();
    assert_eq!(page.text, "const tempo = 80;\nconst title = '曲';\n");
    assert_eq!(page.start_line, 1);
    for path in [".env", "alias.js", "dist/private.js", "built.js"] {
        assert!(
            access
                .assistant_read(
                    &identity,
                    &AssistantProjectRead {
                        path: path.into(),
                        version: None,
                        offset: 0,
                        page_length: 64
                    },
                    &protection
                )
                .is_err(),
            "{path}"
        );
    }
    assert!(scope
        .files
        .iter()
        .any(|file| file.path == "dist" && file.reason.is_some()));
    fs::write(root.join("score.js"), "changed").unwrap();
    assert_eq!(
        access
            .assistant_read(
                &identity,
                &AssistantProjectRead {
                    path: "score.js".into(),
                    version: source.version.clone(),
                    offset: 0,
                    page_length: 64
                },
                &protection
            )
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    assert!(access
        .assistant_read(
            &identity,
            &AssistantProjectRead {
                path: "score.js".into(),
                version: None,
                offset: 0,
                page_length: 64
            },
            &protection
        )
        .is_ok());
}

#[test]
fn assistant_refuses_external_entry_even_when_it_points_back_inside_and_caps_real_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let external = temp.path().join("external.js");
    symlink(root.join("server.js"), &external).unwrap();
    symlink(&external, root.join("escape.js")).unwrap();
    fs::write(root.join("large.js"), "x".repeat(65537)).unwrap();
    fs::write(root.join("package-lock.json"), "secret lock data").unwrap();
    for path in [
        "../external.js",
        external.to_str().unwrap(),
        "large.js",
        "package-lock.json",
    ] {
        assert!(
            access
                .assistant_read(
                    &identity,
                    &AssistantProjectRead {
                        path: path.into(),
                        version: None,
                        offset: 0,
                        page_length: 64
                    },
                    &protection
                )
                .is_err(),
            "{path}"
        );
    }
    let snapshot = access.assistant_inventory(&identity, &protection).unwrap();
    assert!(snapshot
        .files
        .iter()
        .any(|file| file.path == "large.js" && file.reason.as_deref() == Some("tooLarge")));
    let result = access
        .assistant_search(
            &identity,
            &["server.js".into(), "package-lock.json".into()],
            "score",
            &protection,
        )
        .unwrap();
    assert_eq!(result.pages[0].path, "server.js");
    assert_eq!(result.skipped[0].path, "package-lock.json");
    fs::write(
        root.join("unicode.js"),
        format!("{}😀tail", "中".repeat(63)),
    )
    .unwrap();
    let page = access
        .assistant_read(
            &identity,
            &AssistantProjectRead {
                path: "unicode.js".into(),
                version: None,
                offset: 0,
                page_length: 64,
            },
            &protection,
        )
        .unwrap();
    assert_eq!(page.text, "中".repeat(63));
    let next = access
        .assistant_read(
            &identity,
            &AssistantProjectRead {
                path: "unicode.js".into(),
                version: Some(page.version),
                offset: page.next_offset.unwrap(),
                page_length: 64,
            },
            &protection,
        )
        .unwrap();
    assert_eq!(next.text, "😀tail");
}

#[test]
fn assistant_overview_reports_only_versioned_local_facts_and_refreshes_after_saved_changes() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    fs::write(root.join("README.md"), "# A sparse score\nComposer intent.").unwrap();
    fs::write(
        root.join("package.json"),
        r#"{"dependencies":{"socket.io":"4"}}"#,
    )
    .unwrap();
    let before = access.assistant_overview(&identity, &protection).unwrap();
    assert_eq!(before.manifest_status, "valid");
    assert!(before
        .evidence
        .iter()
        .any(|page| page.path == "README.md" && page.text.contains("Composer intent")));
    assert!(before
        .evidence
        .iter()
        .any(|page| page.path == "package.json"));
    fs::write(root.join("server.js"), "console.log('score content');").unwrap();
    let after = access.assistant_overview(&identity, &protection).unwrap();
    assert_ne!(before.snapshot.fingerprint, after.snapshot.fingerprint);
    assert!(after.content_paths.iter().any(|path| path == "server.js"));
    assert!(!root.join("node_modules").exists());
}

#[test]
fn assistant_inventory_never_returns_a_silently_partial_directory_after_its_entry_budget() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let nested = root.join("zz-last");
    fs::create_dir(&nested).unwrap();
    for index in 0..4097 {
        fs::write(nested.join(format!("{index:04}.js")), "x").unwrap();
    }
    assert_eq!(
        access
            .assistant_inventory(&identity, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::TooLarge
    );
}

#[test]
fn assistant_alias_retargeting_never_opens_a_sensitive_canonical_target() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    fs::write(root.join("public.js"), "public source").unwrap();
    fs::write(root.join(".env"), "PRIVATE-CREDENTIAL").unwrap();
    symlink("public.js", root.join("alias.js")).unwrap();
    std::thread::scope(|scope| {
        scope.spawn(|| {
            for index in 0..1000 {
                symlink(
                    if index % 2 == 0 { ".env" } else { "public.js" },
                    root.join("next-alias"),
                )
                .unwrap();
                fs::rename(root.join("next-alias"), root.join("alias.js")).unwrap();
            }
        });
        for _ in 0..1000 {
            if let Ok(page) = access.assistant_read(
                &identity,
                &AssistantProjectRead {
                    path: "alias.js".into(),
                    version: None,
                    offset: 0,
                    page_length: 64,
                },
                &protection,
            ) {
                assert_eq!(page.text, "public source");
            }
        }
    });
}
