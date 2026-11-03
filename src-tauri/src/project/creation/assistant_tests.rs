use super::*;

#[test]
fn private_creation_data_is_not_project_source_or_an_editable_path() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "private-creation");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let workspace = access.open(&root, &protection).unwrap();
    let identity = workspace.project.identity;
    let original = access.assistant_inventory(&identity, &protection).unwrap();
    let original_fingerprint =
        handoff::fingerprint(access.current(&identity, &protection).unwrap()).unwrap();
    let private = root.join(".PnDs-CrEaTiOn");
    fs::create_dir(&private).unwrap();
    fs::write(private.join("history.json"), "private conversation").unwrap();
    symlink(&private, root.join("material-alias")).unwrap();
    symlink(private.join("history.json"), root.join("conversation.json")).unwrap();
    let inventory = access.assistant_inventory(&identity, &protection).unwrap();
    assert_eq!(inventory.fingerprint, original.fingerprint);
    assert_eq!(
        handoff::fingerprint(access.current(&identity, &protection).unwrap()).unwrap(),
        original_fingerprint
    );
    let changes = access.poll(&identity, 0, &protection).unwrap();
    assert!(changes.changed.is_empty());
    assert_eq!(changes.files.len(), workspace.files.len());
    for path in [
        ".pnds-creation/history.json",
        "material-alias/history.json",
        "conversation.json",
    ] {
        assert_eq!(
            access.read(&identity, path, &protection).unwrap_err().code,
            CreationErrorCode::Permission
        );
        assert_eq!(
            access
                .save(&identity, path, "overwrite", "irrelevant", &protection)
                .unwrap_err()
                .code,
            CreationErrorCode::Permission
        );
        assert_eq!(
            access
                .assistant_read(
                    &identity,
                    &AssistantProjectRead {
                        path: path.into(),
                        version: None,
                        offset: 0,
                        page_length: 100
                    },
                    &protection
                )
                .unwrap_err()
                .code,
            CreationErrorCode::Permission
        );
    }
    let project = access.current(&identity, &protection).unwrap();
    assert_eq!(
        project
            .destination(".pnds-creation/new.txt")
            .unwrap_err()
            .code,
        CreationErrorCode::Permission
    );
    assert_eq!(
        project
            .destination("material-alias/new.txt")
            .unwrap_err()
            .code,
        CreationErrorCode::Permission
    );
    assert_eq!(
        fs::read_to_string(private.join("history.json")).unwrap(),
        "private conversation"
    );
}
use std::os::unix::fs::symlink;

#[test]
fn excluded_nonempty_assets_never_claim_to_be_empty_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "score");
    fs::write(root.join("voice.scsyndef"), b"SCgf\0nonempty synthdef").unwrap();
    fs::write(root.join("empty.js"), "").unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let inventory = access.assistant_inventory(&identity, &protection).unwrap();
    let serialized = serde_json::to_value(&inventory).unwrap();
    let find = |path| {
        serialized["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["path"] == path)
            .unwrap()
    };
    let binary = find("voice.scsyndef");
    assert!(binary["reason"].is_string());
    assert!(
        binary["bytes"].is_null(),
        "an excluded size is unknown, not zero"
    );
    assert_eq!(find("empty.js")["bytes"], 0);
    let legacy = serde_json::to_string(&inventory.files)
        .unwrap()
        .replace("\"bytes\":null", "\"bytes\":0");
    assert_eq!(inventory.fingerprint, file_version(legacy.as_bytes()));
    let search = access
        .assistant_search(&identity, &["voice.scsyndef".into()], "voice", &protection)
        .unwrap();
    assert!(serde_json::to_value(search).unwrap()["skipped"][0]["bytes"].is_null());
}

#[test]
fn large_saved_sketches_use_complete_pages_and_keep_utf16_offsets_and_versions() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "large-score");
    let text = format!("// 曲🎵\n{}", "const value = 1;\n".repeat(6000));
    fs::write(root.join("monitor.js"), &text).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let scope = access.assistant_inventory(&identity, &protection).unwrap();
    let file = scope
        .files
        .iter()
        .find(|file| file.path == "monitor.js")
        .unwrap();
    assert!(file.reason.is_none());
    let mut collected = String::new();
    let mut offset = 0;
    loop {
        let page = access
            .assistant_read(
                &identity,
                &AssistantProjectRead {
                    path: "monitor.js".into(),
                    version: file.version.clone(),
                    offset,
                    page_length: 65536,
                },
                &protection,
            )
            .unwrap();
        assert_eq!(page.offset, offset);
        collected.push_str(&page.text);
        match page.next_offset {
            Some(next) => {
                assert!(next > offset);
                offset = next;
            }
            None => break,
        }
    }
    assert_eq!(collected, text);
    assert_eq!(offset, 65536);
}

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
    fs::write(root.join("large.js"), "x".repeat(1024 * 1024 + 1)).unwrap();
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
    let metadata = before.manifest_metadata.as_ref().unwrap();
    assert_eq!(metadata.name, "Draft");
    assert_eq!(metadata.score_entry, "server.js");
    assert_eq!(metadata.working_directory, ".");
    assert_eq!(metadata.synthdefs, vec!["not-compiled.scsyndef"]);
    assert!(before.snapshot.files.iter().any(|file| {
        file.path == metadata.path && file.version.as_ref() == Some(&metadata.version)
    }));
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
fn assistant_overview_never_turns_invalid_or_oversized_manifest_metadata_into_current_facts() {
    let temp = tempfile::tempdir().unwrap();
    let root = tests::project(temp.path(), "overview-metadata");
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let original = fs::read_to_string(root.join("manifest.json")).unwrap();
    let mut manifest: serde_json::Value = serde_json::from_str(&original).unwrap();
    manifest["name"] = serde_json::json!("长".repeat(8192));
    fs::write(
        root.join("manifest.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    let oversized = access.assistant_overview(&identity, &protection).unwrap();
    assert_eq!(oversized.manifest_status, "valid");
    assert!(oversized.manifest_metadata.is_none());
    assert!(oversized
        .evidence
        .iter()
        .any(|page| page.path == "manifest.json" && page.next_offset.is_some()));
    fs::write(root.join("manifest.json"), "{invalid").unwrap();
    let invalid = access.assistant_overview(&identity, &protection).unwrap();
    assert_eq!(invalid.manifest_status, "invalid");
    assert!(invalid.manifest_metadata.is_none());
    assert_ne!(oversized.snapshot.fingerprint, invalid.snapshot.fingerprint);
    fs::remove_file(root.join("manifest.json")).unwrap();
    let missing = access.assistant_overview(&identity, &protection).unwrap();
    assert_eq!(missing.manifest_status, "unreadable");
    assert!(missing.manifest_metadata.is_none());
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
