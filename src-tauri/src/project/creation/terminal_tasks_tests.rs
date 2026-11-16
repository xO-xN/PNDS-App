use super::*;
use std::os::unix::fs::PermissionsExt;

#[test]
fn terminal_task_exports_remain_private_unique_and_readable_by_the_local_cli() {
    let temporary = tempfile::tempdir().unwrap();
    let root = tests::project(temporary.path(), "终端 Chinese space");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let content = "# Selected plan\nKeep the 17-cent limit.\n";
    let first = access
        .write_terminal_task(&identity, content, &protection)
        .unwrap();
    assert_eq!(fs::read_to_string(&first).unwrap(), content);
    assert_eq!(
        first.parent().unwrap(),
        root.canonicalize()
            .unwrap()
            .join(crate::creation_data::DIRECTORY)
    );
    assert_eq!(
        fs::metadata(&first).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(
        fs::metadata(first.parent().unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    let second = access
        .write_terminal_task(&identity, "Another selected plan", &protection)
        .unwrap();
    assert_ne!(first, second);
    assert_eq!(fs::read_to_string(first).unwrap(), content);
    assert_eq!(fs::read_to_string(second).unwrap(), "Another selected plan");
}

#[test]
fn terminal_task_context_uses_the_active_saved_root_and_real_local_resources() {
    let temporary = tempfile::tempdir().unwrap();
    let root = tests::project(temporary.path(), "工程 Chinese space");
    let docs = temporary
        .path()
        .join("PNDS Tools.app/Contents/Resources/help/en");
    fs::create_dir_all(docs.join("reference")).unwrap();
    fs::write(docs.join("reference/README.md"), "# Installed contracts").unwrap();
    fs::write(
        docs.join("app-tutorial.md"),
        "# Installed testing instructions",
    )
    .unwrap();
    let checker = temporary.path().join("PNDS Tools.app/Contents/MacOS/pnds");
    fs::create_dir_all(checker.parent().unwrap()).unwrap();
    fs::write(&checker, "fixture executable; never run").unwrap();
    fs::set_permissions(&checker, fs::Permissions::from_mode(0o755)).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let context = access
        .terminal_task_context(&identity, &docs, &checker, &protection)
        .unwrap();
    assert_eq!(
        context.project_root,
        root.canonicalize().unwrap().to_str().unwrap()
    );
    assert_eq!(context.documentation_root, docs.to_str().unwrap());
    assert_eq!(context.checker_path, checker.to_str().unwrap());
}

#[test]
fn terminal_context_refuses_missing_documents_and_an_unusable_checker() {
    let temporary = tempfile::tempdir().unwrap();
    let root = tests::project(temporary.path(), "saved project");
    let docs = temporary.path().join("Contents/Resources/help/en");
    let checker = temporary.path().join("Contents/MacOS/pnds");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    assert!(access
        .terminal_task_context(&identity, &docs, &checker, &protection)
        .is_err());
    fs::create_dir_all(docs.join("reference")).unwrap();
    fs::write(docs.join("reference/README.md"), "contracts").unwrap();
    fs::write(docs.join("app-tutorial.md"), "checks").unwrap();
    assert!(access
        .terminal_task_context(&identity, &docs, &checker, &protection)
        .is_err());
    fs::create_dir_all(checker.parent().unwrap()).unwrap();
    fs::write(&checker, "not executable").unwrap();
    fs::set_permissions(&checker, fs::Permissions::from_mode(0o600)).unwrap();
    assert!(access
        .terminal_task_context(&identity, &docs, &checker, &protection)
        .is_err());
    fs::set_permissions(&checker, fs::Permissions::from_mode(0o601)).unwrap();
    assert!(access
        .terminal_task_context(&identity, &docs, &checker, &protection)
        .is_err());
    fs::set_permissions(&checker, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(access
        .terminal_task_context(&identity, &docs, &checker, &protection)
        .is_ok());
}

#[test]
fn terminal_exports_reject_stale_and_read_only_workspace_owners() {
    let temporary = tempfile::tempdir().unwrap();
    let first = tests::project(temporary.path(), "first");
    let second = tests::project(temporary.path(), "second");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let old = access.open(&first, &protection).unwrap().project.identity;
    access.open(&second, &protection).unwrap();
    assert_eq!(
        access
            .write_terminal_task(&old, "Stale task", &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
    assert!(!first.join(crate::creation_data::DIRECTORY).exists());
    for bundle in [true, false] {
        let guarded = Protection {
            bundles: if bundle { vec![second.clone()] } else { vec![] },
            utilities: if bundle { vec![] } else { vec![second.clone()] },
        };
        let identity = access.open(&second, &guarded).unwrap().project.identity;
        assert_eq!(
            access
                .write_terminal_task(&identity, "Read-only task", &guarded)
                .unwrap_err()
                .code,
            CreationErrorCode::Permission
        );
        assert_eq!(
            access
                .terminal_task_context(&identity, &second, &second, &guarded)
                .unwrap_err()
                .code,
            CreationErrorCode::Permission
        );
    }
    fs::set_permissions(&first, fs::Permissions::from_mode(0o555)).unwrap();
    let identity = access.open(&first, &protection).unwrap().project.identity;
    let result = access.write_terminal_task(&identity, "Unwritable task", &protection);
    fs::set_permissions(&first, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(result.unwrap_err().code, CreationErrorCode::Permission);
}

#[test]
fn terminal_exports_refuse_private_symlinks_and_widened_permissions_without_touching_existing_files(
) {
    use std::os::unix::fs::symlink;
    let temporary = tempfile::tempdir().unwrap();
    let root = tests::project(temporary.path(), "saved project");
    let outside = temporary.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("canary.md"), "outside unchanged").unwrap();
    let private = root.join(crate::creation_data::DIRECTORY);
    symlink(&outside, &private).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    assert!(access
        .write_terminal_task(&identity, "Must not escape", &protection)
        .is_err());
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 1);
    assert_eq!(
        fs::read_to_string(outside.join("canary.md")).unwrap(),
        "outside unchanged"
    );
    fs::remove_file(&private).unwrap();
    let first = access
        .write_terminal_task(&identity, "Existing task", &protection)
        .unwrap();
    fs::set_permissions(&private, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(access
        .write_terminal_task(&identity, "No widened access", &protection)
        .is_err());
    fs::set_permissions(&private, fs::Permissions::from_mode(0o500)).unwrap();
    assert!(access
        .write_terminal_task(&identity, "Actual write permission failure", &protection)
        .is_err());
    fs::set_permissions(&private, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(fs::read_to_string(first).unwrap(), "Existing task");
    assert_eq!(fs::read_dir(private).unwrap().count(), 1);
}

#[test]
fn terminal_exports_reject_unbounded_or_non_text_input_before_creating_files() {
    let temporary = tempfile::tempdir().unwrap();
    let root = tests::project(temporary.path(), "saved project");
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    for contents in [
        String::new(),
        " \n\t".into(),
        "hidden\0suffix".into(),
        "中".repeat(TEXT_MAX_BYTES as usize / 3 + 1),
    ] {
        assert_eq!(
            access
                .write_terminal_task(&identity, &contents, &protection)
                .unwrap_err()
                .code,
            CreationErrorCode::InvalidProject
        );
    }
    assert!(!root.join(crate::creation_data::DIRECTORY).exists());
}

#[test]
fn terminal_export_rechecks_the_project_and_private_directory_before_publication() {
    use super::text_publication::with_before_publish_hook;
    for replace_root in [true, false] {
        let temporary = tempfile::tempdir().unwrap();
        let root = tests::project(temporary.path(), "saved project");
        let protection = Protection::default();
        let mut access = CreationAccess::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        let first = access
            .write_terminal_task(&identity, "Retained task", &protection)
            .unwrap();
        let private = root.join(crate::creation_data::DIRECTORY);
        let moved = temporary.path().join("moved");
        let source = if replace_root {
            root.clone()
        } else {
            private.clone()
        };
        let destination = moved.clone();
        let result = with_before_publish_hook(
            move || {
                fs::rename(&source, &destination).unwrap();
                fs::create_dir(&source).unwrap();
                fs::set_permissions(&source, fs::Permissions::from_mode(0o700)).unwrap();
            },
            || {
                access.write_terminal_task(
                    &identity,
                    "Must not publish into a replacement",
                    &protection,
                )
            },
        );
        assert_eq!(result.unwrap_err().code, CreationErrorCode::InvalidIdentity);
        let retained = if replace_root {
            moved.join(crate::creation_data::DIRECTORY)
        } else {
            moved
        };
        assert_eq!(
            fs::read_to_string(retained.join(first.file_name().unwrap())).unwrap(),
            "Retained task"
        );
        assert_eq!(fs::read_dir(retained).unwrap().count(), 1);
        assert_eq!(
            fs::read_dir(if replace_root { root } else { private })
                .unwrap()
                .count(),
            0
        );
    }
}

#[test]
fn exported_terminal_tasks_survive_versions_without_entering_git_sharing_or_performance_bundles() {
    use super::git_versions_tests::save;
    use git2::Repository;
    use std::os::unix::fs::symlink;
    let temporary = tempfile::tempdir().unwrap();
    let root = tests::project(temporary.path(), "工程 space");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    manifest["audio"]["defaultMode"] = "none".into();
    manifest["audio"]["supportedModes"] = serde_json::json!(["none"]);
    manifest["audio"]["synthdefs"] = serde_json::json!([]);
    fs::write(
        root.join("manifest.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let initial = save(&mut access, &identity, "Initial saved project");
    let contents = "# Current selected task\nPRIVATE TERMINAL TASK; must stay readable locally.\n";
    let task = access
        .write_terminal_task(&identity, contents, &protection)
        .unwrap();
    fs::create_dir(root.join("public")).unwrap();
    symlink(&task, root.join("public/task-alias.md")).unwrap();
    fs::write(root.join("server.js"), "// saved CLI change\n").unwrap();
    assert_eq!(
        access
            .preview_git_record(&identity, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::TestValidation
    );
    fs::remove_file(root.join("public/task-alias.md")).unwrap();
    let preview = access.preview_git_record(&identity, &protection).unwrap();
    assert!(preview
        .files
        .iter()
        .all(|file| !file.path.contains(crate::creation_data::DIRECTORY)
            && file.path != "public/task-alias.md"));
    let saved = save(&mut access, &identity, "Reviewed CLI changes");
    access
        .github_context(&identity, &protection)
        .unwrap()
        .require_shareable_route_history(&saved)
        .unwrap();
    let repository = Repository::open(&root).unwrap();
    let tree = repository
        .find_commit(git2::Oid::from_str(&saved).unwrap())
        .unwrap()
        .tree()
        .unwrap();
    assert!(tree.get_name(crate::creation_data::DIRECTORY).is_none());
    assert!(tree.get_path(Path::new("public/task-alias.md")).is_err());
    let remote = Repository::init_bare(temporary.path().join("shared.git")).unwrap();
    repository
        .remote_anonymous(remote.path().to_str().unwrap())
        .unwrap()
        .push(&["HEAD:refs/heads/shared"], None)
        .unwrap();
    let shared = remote
        .find_reference("refs/heads/shared")
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .tree()
        .unwrap();
    assert!(shared.get_name(crate::creation_data::DIRECTORY).is_none());
    assert!(shared.get_path(Path::new("public/task-alias.md")).is_err());
    symlink(&task, root.join("public/task-alias.md")).unwrap();
    let bundle = temporary.path().join("performance.pnds");
    crate::project::bundle::pack_project_at_with_libraries(
        &root,
        Some(&bundle),
        false,
        "test",
        Some(&tests::shared_libraries()),
    )
    .unwrap();
    let installed =
        crate::project::bundle::install_bundle(&temporary.path().join("installed"), &bundle)
            .unwrap();
    assert!(!installed.join(crate::creation_data::DIRECTORY).exists());
    assert!(!installed.join("public/task-alias.md").exists());
    fs::remove_file(root.join("public/task-alias.md")).unwrap();
    let data = temporary.path().join("app-data");
    let preview = access
        .preview_git_switch(&identity, &initial, false, &data, &protection)
        .unwrap();
    access
        .confirm_git_switch(&identity, &preview.token, &data, &protection)
        .unwrap();
    assert_eq!(fs::read_to_string(&task).unwrap(), contents);
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "// unfinished score server"
    );
}

#[test]
fn sharing_refuses_an_external_git_commit_that_contains_a_real_exported_task() {
    use super::git_versions_tests::{save, setup};
    use git2::Repository;
    let (_temporary, root, mut access, identity) = setup();
    let protection = Protection::default();
    let saved = save(&mut access, &identity, "Initial project");
    let task = access
        .write_terminal_task(&identity, "Private selected plan", &protection)
        .unwrap();
    let repository = Repository::open(&root).unwrap();
    let parent = repository
        .find_commit(git2::Oid::from_str(&saved).unwrap())
        .unwrap();
    // Simulate an external CLI explicitly force-recording the task. PNDS's
    // normal record flow above never admits this private path.
    let mut private = repository.treebuilder(None).unwrap();
    private
        .insert(
            task.file_name().unwrap(),
            repository.blob(&fs::read(&task).unwrap()).unwrap(),
            0o100644,
        )
        .unwrap();
    let mut tree = repository
        .treebuilder(Some(&parent.tree().unwrap()))
        .unwrap();
    tree.insert(
        crate::creation_data::DIRECTORY,
        private.write().unwrap(),
        0o040000,
    )
    .unwrap();
    let signature = git2::Signature::now("Creator", "creator@example.test").unwrap();
    let private_commit = repository
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            "External private task commit",
            &repository.find_tree(tree.write().unwrap()).unwrap(),
            &[&parent],
        )
        .unwrap();
    assert_eq!(
        access
            .github_context(&identity, &protection)
            .unwrap()
            .require_shareable_route_history(&private_commit.to_string())
            .unwrap_err()
            .code,
        CreationErrorCode::PrivateGitHistory
    );
    assert_eq!(fs::read_to_string(task).unwrap(), "Private selected plan");
}

#[test]
fn entering_a_real_merge_candidate_revokes_terminal_task_exports() {
    use super::git_versions_tests::{save, setup};
    let (temporary, root, mut access, identity) = setup();
    let protection = Protection::default();
    let initial = save(&mut access, &identity, "Initial version");
    let existing = access
        .write_terminal_task(&identity, "Retained current task", &protection)
        .unwrap();
    fs::write(root.join("server.js"), "// incoming saved version").unwrap();
    let incoming = save(&mut access, &identity, "Incoming version");
    let data = temporary.path().join("app-data");
    let switch = access
        .preview_git_switch(&identity, &initial, false, &data, &protection)
        .unwrap();
    access
        .confirm_git_switch(&identity, &switch.token, &data, &protection)
        .unwrap();
    let candidate = access
        .prepare_git_merge(&identity, &incoming, false, &data, &protection)
        .unwrap();
    assert!(!candidate.id.is_empty());
    assert_eq!(
        access
            .write_terminal_task(
                &identity,
                "Must not export the real project from candidate",
                &protection
            )
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
    assert_eq!(
        access
            .terminal_task_context(&identity, &root, &root, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
    assert_eq!(
        fs::read_to_string(existing).unwrap(),
        "Retained current task"
    );
}
