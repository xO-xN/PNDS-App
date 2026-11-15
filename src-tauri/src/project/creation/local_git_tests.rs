use super::tests::project;
use super::*;

#[test]
fn enabling_is_explicit_and_records_only_the_previewed_default_scope() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    fs::write(root.join(".env"), "secret=private").unwrap();
    fs::write(root.join("cover.png"), [0, 1, 2]).unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let id = access.open(&root, &protection).unwrap().project.identity;
    let preview = access.preview_git_record(&id, &protection).unwrap();
    assert!(!root.join(".git").exists());
    assert!(preview.initial);
    assert_eq!(preview.email, "creator@pnds.local");
    let paths = preview
        .files
        .iter()
        .filter(|file| file.default_selected)
        .map(|file| file.path.clone())
        .collect();
    let receipt = access
        .confirm_git_record(
            &id,
            &preview.token,
            GitRecordRequest {
                paths,
                name: "Local Creator".into(),
                email: "".into(),
                message: "Initial project".into(),
            },
            &protection,
        )
        .unwrap();
    let repo = git2::Repository::open(&root).unwrap();
    let commit = repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(receipt.commit, commit.id().to_string());
    assert_eq!(commit.author().name().unwrap(), "Local Creator");
    let tree = commit.tree().unwrap();
    assert!(tree.get_path(Path::new("server.js")).is_ok());
    assert!(tree.get_path(Path::new("cover.png")).is_ok());
    assert!(tree.get_path(Path::new(".env")).is_err());
}

#[test]
fn an_unborn_repository_is_reused_after_initial_record_failure() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let repo = git2::Repository::init(&root).unwrap();
    repo.set_head("refs/heads/main").unwrap();
    fs::create_dir_all(root.join(".git/refs/heads")).unwrap();
    fs::write(root.join(".git/refs/heads/main.lock"), "external lock").unwrap();
    let config_before = fs::read(root.join(".git/config")).unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let id = access.open(&root, &protection).unwrap().project.identity;
    let preview = access.preview_git_record(&id, &protection).unwrap();
    let request = || GitRecordRequest {
        paths: vec!["server.js".into()],
        name: "Creator".into(),
        email: "".into(),
        message: "Initial".into(),
    };
    let failure = access
        .confirm_git_record(&id, &preview.token, request(), &protection)
        .unwrap_err();
    assert!(failure.detail.contains("initial version incomplete"));
    assert!(root.join("manifest.json").exists());
    assert_eq!(fs::read(root.join(".git/config")).unwrap(), config_before);
    fs::remove_file(root.join(".git/refs/heads/main.lock")).unwrap();
    let preview = access.preview_git_record(&id, &protection).unwrap();
    let receipt = access
        .confirm_git_record(&id, &preview.token, request(), &protection)
        .unwrap();
    let commit = repo
        .find_commit(git2::Oid::from_str(&receipt.commit).unwrap())
        .unwrap();
    assert_eq!(commit.parent_count(), 0);
}

fn enabled() -> (tempfile::TempDir, PathBuf, CreationAccess, String) {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    fs::write(root.join("remove.txt"), "remove me").unwrap();
    fs::write(root.join("unselected.txt"), "base").unwrap();
    let mut access = CreationAccess::default();
    let id = access
        .open(&root, &Protection::default())
        .unwrap()
        .project
        .identity;
    let preview = access
        .preview_git_record(&id, &Protection::default())
        .unwrap();
    let paths = preview
        .files
        .iter()
        .filter(|file| file.default_selected)
        .map(|file| file.path.clone())
        .collect();
    access
        .confirm_git_record(
            &id,
            &preview.token,
            GitRecordRequest {
                paths,
                name: "Creator".into(),
                email: "".into(),
                message: "Initial".into(),
            },
            &Protection::default(),
        )
        .unwrap();
    (temp, root, access, id)
}

#[test]
fn reading_recordable_files_preserves_the_active_record_preview_and_its_token() {
    let (_temp, root, mut access, id) = enabled();
    let protection = Protection::default();
    fs::write(root.join("server.js"), "// new code").unwrap();
    fs::write(root.join("debug.log"), "runtime output").unwrap();
    let preview = access.preview_git_record(&id, &protection).unwrap();
    let sequence = access.change_sequence;
    for _ in 0..2 {
        let files = access.git_record_files(&id, &protection).unwrap();
        assert_eq!(files.len(), 2);
        assert!(files
            .iter()
            .any(|file| file.path == "server.js" && file.default_selected));
        assert!(files
            .iter()
            .any(|file| file.path == "debug.log" && !file.default_selected));
        assert_eq!(access.change_sequence, sequence);
    }
    assert!(access.git_record_files("stale owner", &protection).is_err());
    let receipt = access
        .confirm_git_record(
            &id,
            &preview.token,
            GitRecordRequest {
                paths: vec!["server.js".into()],
                name: "Creator".into(),
                email: "".into(),
                message: "Record after reading file scope".into(),
            },
            &protection,
        )
        .unwrap();
    assert_eq!(receipt.paths, ["server.js"]);
}

#[test]
fn recording_file_catalog_reads_a_parent_repository_without_granting_recording() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "nested");
    fs::write(temp.path().join("outside.js"), "outside();").unwrap();
    let repo = git2::Repository::init(temp.path()).unwrap();
    let mut index = repo.index().unwrap();
    index
        .add_all(
            ["nested", "outside.js"],
            git2::IndexAddOption::DEFAULT,
            None,
        )
        .unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let signature = git2::Signature::now("Creator", "creator@pnds.local").unwrap();
    let commit = repo
        .commit(Some("HEAD"), &signature, &signature, "Initial", &tree, &[])
        .unwrap();
    fs::write(root.join("debug.log"), "runtime output").unwrap();
    fs::write(root.join("new.js"), "// new code").unwrap();
    fs::write(temp.path().join("outside-new.js"), "outsideNew();").unwrap();
    let head_before = fs::read(temp.path().join(".git/HEAD")).unwrap();
    let index_before = fs::read(temp.path().join(".git/index")).unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let id = access.open(&root, &protection).unwrap().project.identity;
    let files = access
        .git_record_files(&id, &protection)
        .expect("a read-only catalog must support the same parent scope as Git inspection");
    assert_eq!(files.len(), 2);
    assert!(files
        .iter()
        .any(|file| file.path == "debug.log" && !file.default_selected));
    assert!(files
        .iter()
        .any(|file| file.path == "new.js" && file.default_selected));
    assert!(access.preview_git_record(&id, &protection).is_err());
    let output = access
        .prepare_git_status(&id, &protection)
        .unwrap()
        .run(&GitReader::default());
    let status = access.finish_git_status(output, &protection).unwrap();
    assert_eq!(status.head.as_deref(), Some(commit.to_string().as_str()));
    assert_eq!(status.changes.len(), 2);
    let graph = access.git_version_graph(&id, 0, &protection).unwrap();
    assert_eq!(graph.head.as_deref(), Some(commit.to_string().as_str()));
    assert_eq!(graph.versions.len(), 1);
    assert_eq!(
        fs::read(temp.path().join(".git/HEAD")).unwrap(),
        head_before
    );
    assert_eq!(
        fs::read(temp.path().join(".git/index")).unwrap(),
        index_before
    );
}

#[test]
fn records_only_selected_saved_whole_files_and_preserves_unselected_external_index() {
    let (_temp, root, mut access, id) = enabled();
    let repo = git2::Repository::open(&root).unwrap();
    fs::write(root.join("server.js"), "selected saved change\n").unwrap();
    fs::write(root.join("new [*] ü\nfile.txt"), "literal new file\n").unwrap();
    fs::remove_file(root.join("remove.txt")).unwrap();
    fs::write(root.join("unselected.txt"), "external staged").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("unselected.txt")).unwrap();
    index.write().unwrap();
    let staged = index.get_path(Path::new("unselected.txt"), 0).unwrap().id;
    fs::write(root.join("unselected.txt"), "external worktree").unwrap();
    let preview = access
        .preview_git_record(&id, &Protection::default())
        .unwrap();
    let result = access
        .confirm_git_record(
            &id,
            &preview.token,
            GitRecordRequest {
                paths: vec![
                    "server.js".into(),
                    "remove.txt".into(),
                    "new [*] ü\nfile.txt".into(),
                ],
                name: preview.name,
                email: preview.email,
                message: "My saved changes".into(),
            },
            &Protection::default(),
        )
        .unwrap();
    let commit = repo
        .find_commit(git2::Oid::from_str(&result.commit).unwrap())
        .unwrap();
    assert_eq!(commit.parent_count(), 1);
    let tree = commit.tree().unwrap();
    assert_eq!(
        repo.find_blob(tree.get_path(Path::new("server.js")).unwrap().id())
            .unwrap()
            .content(),
        b"selected saved change\n"
    );
    assert!(tree.get_path(Path::new("remove.txt")).is_err());
    assert!(tree.get_path(Path::new("new [*] ü\nfile.txt")).is_ok());
    assert_eq!(
        repo.find_blob(tree.get_path(Path::new("unselected.txt")).unwrap().id())
            .unwrap()
            .content(),
        b"base"
    );
    assert_eq!(
        repo.index()
            .unwrap()
            .get_path(Path::new("unselected.txt"), 0)
            .unwrap()
            .id,
        staged
    );
    assert_eq!(
        fs::read(root.join("unselected.txt")).unwrap(),
        b"external worktree"
    );
}

#[test]
fn newly_staged_files_are_described_as_added_but_cannot_be_selected() {
    let (_temp, root, mut access, id) = enabled();
    fs::write(root.join("externally-added.txt"), "external new file\n").unwrap();
    let repo = git2::Repository::open(&root).unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("externally-added.txt")).unwrap();
    index.write().unwrap();
    let preview = access
        .preview_git_record(&id, &Protection::default())
        .unwrap();
    let file = preview
        .files
        .iter()
        .find(|file| file.path == "externally-added.txt")
        .unwrap();
    assert!(file.staged);
    assert!(!file.default_selected);
    assert_eq!(file.status, GitRecordStatus::Added);
}

#[test]
fn tracked_large_resources_stay_selectable_while_new_large_resources_are_default_excluded() {
    let (_temp, root, mut access, id) = enabled();
    let repo = git2::Repository::open(&root).unwrap();
    let data = vec![7; 10 * 1024 * 1024];
    fs::write(root.join("new.wav"), &data).unwrap();
    let preview = access
        .preview_git_record(&id, &Protection::default())
        .unwrap();
    let large = preview
        .files
        .iter()
        .find(|file| file.path == "new.wav")
        .unwrap();
    assert!(!large.default_selected);
    assert_eq!(large.exclusion, Some(GitExclusion::LargeMedia));
    access
        .confirm_git_record(
            &id,
            &preview.token,
            GitRecordRequest {
                paths: vec!["new.wav".into()],
                name: preview.name,
                email: preview.email,
                message: "Include audio".into(),
            },
            &Protection::default(),
        )
        .unwrap();
    fs::write(root.join(".gitignore"), "*.wav\n").unwrap();
    fs::write(root.join("new.wav"), vec![8; data.len()]).unwrap();
    let preview = access
        .preview_git_record(&id, &Protection::default())
        .unwrap();
    let large = preview
        .files
        .iter()
        .find(|file| file.path == "new.wav")
        .unwrap();
    assert!(large.default_selected);
    access
        .confirm_git_record(
            &id,
            &preview.token,
            GitRecordRequest {
                paths: vec!["new.wav".into()],
                name: preview.name,
                email: preview.email,
                message: "Update tracked audio".into(),
            },
            &Protection::default(),
        )
        .unwrap();
    let tree = repo.head().unwrap().peel_to_tree().unwrap();
    assert_eq!(
        repo.find_blob(tree.get_path(Path::new("new.wav")).unwrap().id())
            .unwrap()
            .content()
            .len(),
        data.len()
    );
}

#[test]
fn filter_attributes_require_external_tools_even_without_a_configured_driver() {
    let (_temp, root, mut access, id) = enabled();
    fs::write(root.join(".gitattributes"), "*.js filter=lfs\n").unwrap();
    fs::write(root.join("server.js"), "saved").unwrap();
    let preview = access
        .preview_git_record(&id, &Protection::default())
        .unwrap();
    let head = fs::read(root.join(".git/refs/heads/main")).unwrap();
    let result = access.confirm_git_record(
        &id,
        &preview.token,
        GitRecordRequest {
            paths: vec!["server.js".into()],
            name: preview.name,
            email: preview.email,
            message: "Filtered change".into(),
        },
        &Protection::default(),
    );
    assert!(result.is_err(), "must not bypass LFS clean rules");
    assert_eq!(fs::read(root.join(".git/refs/heads/main")).unwrap(), head);
}

#[test]
fn changed_disk_head_index_and_configuration_invalidate_confirmation_without_overwriting_work() {
    for change in ["disk", "head", "index", "signing", "lock", "conflict"] {
        let (_temp, root, mut access, id) = enabled();
        fs::write(root.join("server.js"), "selected saved").unwrap();
        let preview = access
            .preview_git_record(&id, &Protection::default())
            .unwrap();
        let repo = git2::Repository::open(&root).unwrap();
        match change {
            "disk" => fs::write(root.join("server.js"), "new external disk").unwrap(),
            "head" => {
                let old = repo.head().unwrap().peel_to_commit().unwrap();
                let signature = git2::Signature::now("External", "e@local").unwrap();
                repo.commit(
                    Some("HEAD"),
                    &signature,
                    &signature,
                    "External",
                    &old.tree().unwrap(),
                    &[&old],
                )
                .unwrap();
            }
            "index" => {
                let mut index = repo.index().unwrap();
                index.add_path(Path::new("server.js")).unwrap();
                index.write().unwrap();
            }
            "signing" => repo
                .config()
                .unwrap()
                .set_bool("commit.gpgsign", true)
                .unwrap(),
            "lock" => fs::write(root.join(".git/index.lock"), "external lock").unwrap(),
            _ => fs::write(
                root.join(".git/MERGE_HEAD"),
                repo.head().unwrap().target().unwrap().to_string(),
            )
            .unwrap(),
        }
        let head = repo.head().unwrap().target().unwrap();
        let index = fs::read(root.join(".git/index")).unwrap();
        let disk = fs::read(root.join("server.js")).unwrap();
        assert!(
            access
                .confirm_git_record(
                    &id,
                    &preview.token,
                    GitRecordRequest {
                        paths: vec!["server.js".into()],
                        name: preview.name,
                        email: preview.email,
                        message: "User note".into()
                    },
                    &Protection::default()
                )
                .is_err(),
            "{change}"
        );
        assert_eq!(repo.head().unwrap().target().unwrap(), head, "{change}");
        assert_eq!(
            fs::read(root.join(".git/index")).unwrap(),
            index,
            "{change}"
        );
        assert_eq!(fs::read(root.join("server.js")).unwrap(), disk, "{change}");
    }
}

#[test]
fn selected_external_staged_content_cannot_be_bypassed_by_another_confirmation() {
    let (_temp, root, mut access, id) = enabled();
    fs::write(root.join("server.js"), "external staged").unwrap();
    let repo = git2::Repository::open(&root).unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("server.js")).unwrap();
    index.write().unwrap();
    fs::write(root.join("server.js"), "different disk").unwrap();
    let head = repo.head().unwrap().target();
    for _ in 0..2 {
        let preview = access
            .preview_git_record(&id, &Protection::default())
            .unwrap();
        assert!(access
            .confirm_git_record(
                &id,
                &preview.token,
                GitRecordRequest {
                    paths: vec!["server.js".into()],
                    name: preview.name,
                    email: preview.email,
                    message: "No override".into()
                },
                &Protection::default()
            )
            .is_err());
    }
    assert_eq!(repo.head().unwrap().target(), head);
}

#[test]
fn history_reads_saved_versions_and_rechecks_the_current_disk_baseline_before_loading() {
    let (_temp, root, mut access, id) = enabled();
    let protection = Protection::default();
    let repo = git2::Repository::open(&root).unwrap();
    let initial = repo.head().unwrap().target().unwrap().to_string();
    fs::write(root.join("server.js"), "new saved\n").unwrap();
    let preview = access.preview_git_record(&id, &protection).unwrap();
    access
        .confirm_git_record(
            &id,
            &preview.token,
            GitRecordRequest {
                paths: vec!["server.js".into()],
                name: preview.name,
                email: preview.email,
                message: "Updated server".into(),
            },
            &protection,
        )
        .unwrap();
    let history = access.git_history(&id, &protection).unwrap();
    assert_eq!(history.commits.len(), 2);
    assert_eq!(history.commits[0].message, "Updated server");
    let before = fs::read(root.join("server.js")).unwrap();
    let index = fs::read(root.join(".git/index")).unwrap();
    let head = repo.head().unwrap().target();
    let file = access
        .git_history_file(&id, &initial, "server.js", &protection)
        .unwrap();
    assert!(file.loadable);
    assert_eq!(file.saved_text.as_deref(), Some("new saved\n"));
    let version = file.disk_version.unwrap();
    let loaded = access
        .load_git_history_text(&id, &initial, "server.js", &version, &protection)
        .unwrap();
    assert_eq!(loaded.historical_text, file.historical_text);
    assert_eq!(fs::read(root.join("server.js")).unwrap(), before);
    assert_eq!(fs::read(root.join(".git/index")).unwrap(), index);
    assert_eq!(repo.head().unwrap().target(), head);
    fs::write(root.join("server.js"), "external newer\n").unwrap();
    assert_eq!(
        access
            .load_git_history_text(&id, &initial, "server.js", &version, &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
}

#[test]
fn history_rejects_deleted_binary_directory_escape_and_unreachable_targets() {
    let (temp, root, access, id) = enabled();
    let protection = Protection::default();
    let repo = git2::Repository::open(&root).unwrap();
    let head = repo.head().unwrap().peel_to_commit().unwrap();
    let commit = head.id().to_string();
    fs::remove_file(root.join("server.js")).unwrap();
    assert!(
        !access
            .git_history_file(&id, &commit, "server.js", &protection)
            .unwrap()
            .loadable
    );
    assert!(!root.join("server.js").exists());
    fs::write(root.join("server.js"), [0, 1, 2]).unwrap();
    assert!(
        !access
            .git_history_file(&id, &commit, "server.js", &protection)
            .unwrap()
            .loadable
    );
    fs::remove_file(root.join("server.js")).unwrap();
    fs::create_dir(root.join("server.js")).unwrap();
    assert!(
        !access
            .git_history_file(&id, &commit, "server.js", &protection)
            .unwrap()
            .loadable
    );
    assert!(access
        .git_history_file(&id, &commit, "../outside.txt", &protection)
        .is_err());
    assert!(
        !access
            .git_history_file(&id, &commit, "never-existed.txt", &protection)
            .unwrap()
            .loadable
    );
    let signature = git2::Signature::now("Other", "other@local").unwrap();
    let orphan = repo
        .commit(
            None,
            &signature,
            &signature,
            "unreachable",
            &head.tree().unwrap(),
            &[],
        )
        .unwrap();
    assert!(access
        .git_history_file(&id, &orphan.to_string(), "remove.txt", &protection)
        .is_err());
    fs::write(temp.path().join("outside.txt"), "private").unwrap();
    std::os::unix::fs::symlink(temp.path(), root.join("escape")).unwrap();
    assert!(access
        .git_history_file(&id, &commit, "escape/outside.txt", &protection)
        .is_err());
}

#[test]
fn git_write_boundary_rejects_parent_nested_worktree_and_symlink_metadata() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    git2::Repository::init(temp.path()).unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let id = access.open(&root, &protection).unwrap().project.identity;
    assert!(access.preview_git_record(&id, &protection).is_err());
    assert!(!root.join(".git").exists());
    let (_temp, root, mut access, id) = enabled();
    let nested = root.join("nested");
    fs::create_dir(&nested).unwrap();
    git2::Repository::init(&nested).unwrap();
    assert!(access.preview_git_record(&id, &protection).is_err());
    let (_temp, root, mut access, id) = enabled();
    let repo = git2::Repository::open(&root).unwrap();
    let worktree_root = root.parent().unwrap().join("worktree");
    repo.worktree("other", &worktree_root, None).unwrap();
    let linked = access
        .open(&worktree_root, &protection)
        .unwrap()
        .project
        .identity;
    assert!(access.preview_git_record(&linked, &protection).is_err());
    assert!(access.git_history(&linked, &protection).is_ok());
    let _ = id;
}

#[test]
fn both_templates_and_recording_work_without_system_git_or_developer_tools() {
    const CHILD: &str = "PNDS_LOCAL_GIT_TEST_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let config = tempfile::tempdir().unwrap();
        fs::create_dir(config.path().join("git")).unwrap();
        fs::write(
            config.path().join("git/config"),
            "[user]\nname = Machine Author\nemail = personal@example.test\n",
        )
        .unwrap();
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "project::creation::local_git_tests::both_templates_and_recording_work_without_system_git_or_developer_tools",
                "--nocapture",
            ])
            .env_clear()
            .env("PATH", "/nonexistent-pnds-no-tools")
            .env("XDG_CONFIG_HOME", config.path())
            .env(CHILD, "1")
            .output()
            .unwrap();
        assert!(
            child.status.success(),
            "{}",
            String::from_utf8_lossy(&child.stderr)
        );
        return;
    }
    let temp = tempfile::tempdir().unwrap();
    assert_eq!(
        git2::Config::open_default()
            .unwrap()
            .get_string("user.email")
            .unwrap(),
        "personal@example.test"
    );
    for (folder, email) in [
        ("blank", None),
        ("classic", None),
        (
            "blank-noreply",
            Some("123+composer@users.noreply.github.com"),
        ),
    ] {
        let expected_email = email.unwrap_or("creator@pnds.local");
        let mut access = CreationAccess::default();
        let protection = Protection::default();
        let options = NewProjectOptions {
            parent: temp.path().to_string_lossy().into_owned(),
            folder_name: folder.into(),
            name: "Local".into(),
            author: "".into(),
            description: "".into(),
            locale: "en".into(),
            git_name: Some("My Local Name".into()),
            git_email: email.map(String::from),
        };
        let workspace = if folder == "classic" {
            access.create_classic(
                &options,
                &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/shared-libraries"),
                &protection,
            )
        } else {
            access.create_blank(&options, &super::tests::shared_libraries(), &protection)
        }
        .unwrap();
        access
            .commit(&workspace.project.identity, &protection)
            .unwrap();
        let root = PathBuf::from(&workspace.project.root);
        let repo = git2::Repository::open(&root).unwrap();
        let initial = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(initial.author().name().unwrap(), "My Local Name");
        assert_eq!(initial.author().email().unwrap(), expected_email);
        assert_eq!(initial.committer().email().unwrap(), expected_email);
        assert_eq!(initial.parent_count(), 0);
        assert!(repo.remotes().unwrap().is_empty());
        fs::write(root.join("local.txt"), "saved").unwrap();
        let preview = access
            .preview_git_record(&workspace.project.identity, &protection)
            .unwrap();
        access
            .confirm_git_record(
                &workspace.project.identity,
                &preview.token,
                GitRecordRequest {
                    paths: vec!["local.txt".into()],
                    name: preview.name,
                    email: preview.email,
                    message: "Offline saved version".into(),
                },
                &protection,
            )
            .unwrap();
        let saved = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(saved.author().email().unwrap(), expected_email);
        assert_eq!(saved.committer().email().unwrap(), expected_email);
        assert_eq!(saved.parent_id(0).unwrap(), initial.id());
        assert_eq!(
            access
                .git_history(&workspace.project.identity, &protection)
                .unwrap()
                .commits
                .len(),
            2
        );
    }
}

#[test]
fn git_metadata_subdirectory_links_never_grant_writes_outside_the_repository() {
    let (temp, root, mut access, id) = enabled();
    let outside = temp.path().join("external-heads");
    fs::rename(root.join(".git/refs/heads"), &outside).unwrap();
    std::os::unix::fs::symlink(&outside, root.join(".git/refs/heads")).unwrap();
    assert!(access
        .preview_git_record(&id, &Protection::default())
        .is_err());
}

#[test]
fn historical_manifest_text_cannot_bypass_the_existing_save_validator() {
    let (_temp, root, mut access, id) = enabled();
    let protection = Protection::default();
    let repo = git2::Repository::open(&root).unwrap();
    let parent = repo.head().unwrap().peel_to_commit().unwrap();
    let mut index = repo.index().unwrap();
    let mut item = index.get_path(Path::new("manifest.json"), 0).unwrap();
    item.id = repo.blob(b"{invalid history}").unwrap();
    index.add(&item).unwrap();
    let tree = repo.find_tree(index.write_tree_to(&repo).unwrap()).unwrap();
    let signature = git2::Signature::now("External", "e@local").unwrap();
    let historical = repo
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            "Invalid historical manifest",
            &tree,
            &[&parent],
        )
        .unwrap();
    let before = fs::read(root.join("manifest.json")).unwrap();
    let source = access
        .git_history_file(&id, &historical.to_string(), "manifest.json", &protection)
        .unwrap();
    let loaded = access
        .load_git_history_text(
            &id,
            &historical.to_string(),
            "manifest.json",
            source.disk_version.as_deref().unwrap(),
            &protection,
        )
        .unwrap();
    assert_eq!(
        access
            .save(
                &id,
                "manifest.json",
                loaded.historical_text.as_deref().unwrap(),
                loaded.disk_version.as_deref().unwrap(),
                &protection
            )
            .unwrap_err()
            .code,
        CreationErrorCode::ManifestInvalid
    );
    assert_eq!(fs::read(root.join("manifest.json")).unwrap(), before);
}

#[test]
fn unsupported_eol_processing_and_new_repository_partial_state_are_explicit() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    fs::write(root.join(".gitattributes"), "*.js filter=lfs\n").unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let id = access.open(&root, &protection).unwrap().project.identity;
    let preview = access.preview_git_record(&id, &protection).unwrap();
    let error = access
        .confirm_git_record(
            &id,
            &preview.token,
            GitRecordRequest {
                paths: vec!["server.js".into()],
                name: preview.name,
                email: preview.email,
                message: "Initial".into(),
            },
            &protection,
        )
        .unwrap_err();
    assert!(root.join(".git").is_dir());
    assert!(error
        .detail
        .contains("Repository established; initial version incomplete"));
    let (_temp, root, mut access, id) = enabled();
    fs::write(root.join(".gitattributes"), "*.js text eol=lf\n").unwrap();
    fs::write(root.join("server.js"), "saved\r\n").unwrap();
    let preview = access.preview_git_record(&id, &protection).unwrap();
    assert!(access
        .confirm_git_record(
            &id,
            &preview.token,
            GitRecordRequest {
                paths: vec!["server.js".into()],
                name: preview.name,
                email: preview.email,
                message: "No hidden normalization".into()
            },
            &protection
        )
        .is_err());
}

#[test]
fn history_reachability_is_bounded_before_scanning_deep_ancestry() {
    let (_temp, root, access, id) = enabled();
    let repo = git2::Repository::open(&root).unwrap();
    let initial = repo.head().unwrap().peel_to_commit().unwrap();
    let selected = initial.id().to_string();
    let tree = initial.tree().unwrap();
    let signature = git2::Signature::now("External", "e@local").unwrap();
    let mut parent = initial.id();
    for _ in 0..301 {
        let prior = repo.find_commit(parent).unwrap();
        parent = repo
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                "unchanged saved tree",
                &tree,
                &[&prior],
            )
            .unwrap();
    }
    let report = access.git_history(&id, &Protection::default()).unwrap();
    assert!(report.limited);
    assert_eq!(
        access
            .git_history_file(&id, &selected, "server.js", &Protection::default())
            .unwrap_err()
            .code,
        CreationErrorCode::TooLarge
    );
}

#[test]
fn oversized_index_is_rejected_before_it_is_parsed() {
    let (_temp, root, mut access, id) = enabled();
    File::options()
        .write(true)
        .open(root.join(".git/index"))
        .unwrap()
        .set_len(TEXT_MAX_BYTES + 1)
        .unwrap();
    assert_eq!(
        access
            .preview_git_record(&id, &Protection::default())
            .unwrap_err()
            .code,
        CreationErrorCode::TooLarge
    );
}

#[test]
fn repeated_subtrees_cannot_expand_past_the_history_reader_budget() {
    const CHILD: &str = "PNDS_GIT_REPEATED_TREE_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let mut child=std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact","project::creation::local_git_tests::repeated_subtrees_cannot_expand_past_the_history_reader_budget","--nocapture"]).env(CHILD,"1").spawn().unwrap();
        let started = std::time::Instant::now();
        loop {
            if let Some(status) = child.try_wait().unwrap() {
                assert!(status.success());
                break;
            }
            if started.elapsed() > std::time::Duration::from_secs(5) {
                let _ = child.kill();
                let _ = child.wait();
                panic!("Repeated-tree history was not rejected within the bounded workflow");
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        return;
    }
    let (_temp, root, access, id) = enabled();
    let repo = git2::Repository::open(&root).unwrap();
    let mut builder = repo.treebuilder(None).unwrap();
    builder
        .insert("leaf.txt", repo.blob(b"text").unwrap(), 0o100644)
        .unwrap();
    let mut tree = builder.write().unwrap();
    for _ in 0..30 {
        let mut branch = repo.treebuilder(None).unwrap();
        branch.insert("a", tree, 0o040000).unwrap();
        branch.insert("b", tree, 0o040000).unwrap();
        tree = branch.write().unwrap();
    }
    let signature = git2::Signature::now("External", "e@local").unwrap();
    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        "Repeated subtree DAG",
        &repo.find_tree(tree).unwrap(),
        &[&repo.head().unwrap().peel_to_commit().unwrap()],
    )
    .unwrap();
    assert_eq!(
        access
            .git_history(&id, &Protection::default())
            .unwrap_err()
            .code,
        CreationErrorCode::TooLarge
    );
}

#[test]
fn returns_saved_files_to_a_version_without_changing_head_or_index() {
    let (_temp, root, mut access, id) = enabled();
    let repo = git2::Repository::open(&root).unwrap();
    let original = repo.head().unwrap().target().unwrap();
    let old_server = fs::read(root.join("server.js")).unwrap();
    fs::write(root.join("server.js"), "new server").unwrap();
    fs::remove_file(root.join("remove.txt")).unwrap();
    fs::write(root.join("new.png"), [0, 1, 2, 255]).unwrap();
    let preview = access
        .preview_git_record(&id, &Protection::default())
        .unwrap();
    access
        .confirm_git_record(
            &id,
            &preview.token,
            GitRecordRequest {
                paths: preview
                    .files
                    .iter()
                    .filter(|file| file.default_selected)
                    .map(|file| file.path.clone())
                    .collect(),
                name: "Creator".into(),
                email: "".into(),
                message: "Second version".into(),
            },
            &Protection::default(),
        )
        .unwrap();
    let head = repo.head().unwrap().target().unwrap();
    let index = fs::read(root.join(".git/index")).unwrap();
    let preview = access
        .preview_git_restore(&id, &original.to_string(), &Protection::default())
        .unwrap();
    assert!(preview.paths.contains(&"remove.txt".into()));
    assert!(preview.paths.contains(&"new.png".into()));
    access
        .confirm_git_restore(&id, &preview.token, &Protection::default())
        .unwrap();
    assert_eq!(fs::read(root.join("server.js")).unwrap(), old_server);
    assert!(root.join("remove.txt").exists());
    assert!(!root.join("new.png").exists());
    assert_eq!(repo.head().unwrap().target().unwrap(), head);
    assert_eq!(fs::read(root.join(".git/index")).unwrap(), index);
    assert!(repo.find_commit(original).is_ok());
    assert!(access
        .confirm_git_restore(&id, &preview.token, &Protection::default())
        .is_err());
}

#[test]
fn historical_restore_refuses_dirty_files_and_stale_previews() {
    let (_temp, root, mut access, id) = enabled();
    let repo = git2::Repository::open(&root).unwrap();
    let original = repo.head().unwrap().target().unwrap();
    fs::write(root.join("server.js"), "new server").unwrap();
    assert!(access
        .preview_git_restore(&id, &original.to_string(), &Protection::default())
        .is_err());
    let preview = access
        .preview_git_record(&id, &Protection::default())
        .unwrap();
    access
        .confirm_git_record(
            &id,
            &preview.token,
            GitRecordRequest {
                paths: vec!["server.js".into()],
                name: "Creator".into(),
                email: "".into(),
                message: "Second".into(),
            },
            &Protection::default(),
        )
        .unwrap();
    let preview = access
        .preview_git_restore(&id, &original.to_string(), &Protection::default())
        .unwrap();
    fs::write(root.join("server.js"), "keep this work").unwrap();
    assert!(access
        .confirm_git_restore(&id, &preview.token, &Protection::default())
        .is_err());
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "keep this work"
    );
}

#[test]
fn historical_restore_never_overwrites_an_ignored_local_file() {
    let (_temp, root, mut access, id) = enabled();
    fs::write(root.join("old.png"), [0, 1, 255]).unwrap();
    let preview = access
        .preview_git_record(&id, &Protection::default())
        .unwrap();
    access
        .confirm_git_record(
            &id,
            &preview.token,
            GitRecordRequest {
                paths: vec!["old.png".into()],
                name: "Creator".into(),
                email: "".into(),
                message: "Resource".into(),
            },
            &Protection::default(),
        )
        .unwrap();
    let repo = git2::Repository::open(&root).unwrap();
    let selected = repo.head().unwrap().target().unwrap();
    fs::remove_file(root.join("old.png")).unwrap();
    let preview = access
        .preview_git_record(&id, &Protection::default())
        .unwrap();
    access
        .confirm_git_record(
            &id,
            &preview.token,
            GitRecordRequest {
                paths: vec!["old.png".into()],
                name: "Creator".into(),
                email: "".into(),
                message: "Remove resource".into(),
            },
            &Protection::default(),
        )
        .unwrap();
    fs::write(root.join(".git/info/exclude"), "old.png\n").unwrap();
    fs::write(root.join("old.png"), "local work").unwrap();
    assert!(access
        .preview_git_restore(&id, &selected.to_string(), &Protection::default())
        .is_err());
    assert_eq!(
        fs::read_to_string(root.join("old.png")).unwrap(),
        "local work"
    );
}

#[test]
fn newly_created_archive_logs_stay_out_of_normal_version_recording() {
    let (_temp, root, mut access, id) = enabled();
    fs::create_dir_all(root.join("docs/handoff-history")).unwrap();
    fs::write(
        root.join("docs/handoff-history/new.log"),
        "new verification output",
    )
    .unwrap();
    fs::write(root.join("server.js"), "// eligible saved code").unwrap();
    let preview = access
        .preview_git_record(&id, &Protection::default())
        .unwrap();
    let log = preview
        .files
        .iter()
        .find(|file| file.path == "docs/handoff-history/new.log")
        .unwrap();
    assert!(!log.default_selected);
    assert_eq!(log.exclusion, Some(GitExclusion::SensitiveOrGenerated));
    let result = access
        .confirm_git_record(
            &id,
            &preview.token,
            GitRecordRequest {
                paths: preview
                    .files
                    .iter()
                    .filter(|file| file.default_selected)
                    .map(|file| file.path.clone())
                    .collect(),
                name: "Creator".into(),
                email: "".into(),
                message: "Saved code without generated output".into(),
            },
            &Protection::default(),
        )
        .unwrap();
    let repo = git2::Repository::open(&root).unwrap();
    let tree = repo
        .find_commit(git2::Oid::from_str(&result.commit).unwrap())
        .unwrap()
        .tree()
        .unwrap();
    assert!(tree
        .get_path(Path::new("docs/handoff-history/new.log"))
        .is_err());
    assert_eq!(
        fs::read_to_string(root.join("docs/handoff-history/new.log")).unwrap(),
        "new verification output"
    );
}
