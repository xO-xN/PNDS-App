use super::tests::project;
use super::*;
use git2::{Oid, Repository};
pub(super) fn setup() -> (tempfile::TempDir, PathBuf, CreationAccess, String) {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "versions");
    let mut access = CreationAccess::default();
    let id = access
        .open(&root, &Protection::default())
        .unwrap()
        .project
        .identity;
    (temp, root, access, id)
}
pub(super) fn save(access: &mut CreationAccess, id: &str, label: &str) -> String {
    let preview = access
        .preview_git_record(id, &Protection::default())
        .unwrap();
    access
        .confirm_git_record_named(
            id,
            &preview.token,
            GitRecordRequest {
                paths: preview
                    .files
                    .iter()
                    .filter(|f| f.default_selected)
                    .map(|f| f.path.clone())
                    .collect(),
                name: "Creator".into(),
                email: "".into(),
                message: label.into(),
            },
            Some("新路线"),
            &Protection::default(),
        )
        .unwrap()
        .commit
}
#[test]
fn version_graph_reports_the_commit_author_instead_of_the_committer_or_repository_identity() {
    let (_temp, root, mut access, id) = setup();
    let initial = save(&mut access, &id, "Initial project");
    let repo = Repository::open(&root).unwrap();
    let parent = repo.find_commit(Oid::from_str(&initial).unwrap()).unwrap();
    let author = git2::Signature::now("Original 作者", "author@example.test").unwrap();
    let committer = git2::Signature::now("Build Service", "committer@example.test").unwrap();
    let commit = repo
        .commit(
            Some("HEAD"),
            &author,
            &committer,
            "Imported version",
            &parent.tree().unwrap(),
            &[&parent],
        )
        .unwrap();

    let graph = access
        .git_version_graph(&id, 0, &Protection::default())
        .unwrap();
    let imported = graph
        .versions
        .iter()
        .find(|version| version.id == commit.to_string())
        .unwrap();
    assert_eq!(imported.author, "Original 作者");
    assert_eq!(
        graph
            .versions
            .iter()
            .find(|version| version.id == initial)
            .unwrap()
            .author,
        "Creator"
    );
    assert_eq!(repo.signature().unwrap().name().unwrap(), "Creator");
}

#[test]
fn excluded_untracked_files_do_not_require_saving_before_switching_versions() {
    let (temp, root, mut access, id) = setup();
    let data = temp.path().join("private");
    let original = fs::read(root.join("server.js")).unwrap();
    let first = save(&mut access, &id, "Initial project");
    fs::write(root.join("server.js"), "// second version").unwrap();
    save(&mut access, &id, "Second version");

    fs::write(root.join(".pnds-seats.json"), "{\"seats\":[]}").unwrap();
    fs::write(root.join("debug.log"), "runtime output").unwrap();
    fs::File::create(root.join("new.wav"))
        .unwrap()
        .set_len(10 * 1024 * 1024)
        .unwrap();
    let output = access
        .prepare_git_status(&id, &Protection::default())
        .unwrap()
        .run(&GitReader::default());
    let status = access
        .finish_git_status(output, &Protection::default())
        .unwrap();
    assert_eq!(status.changes.len(), 3);
    assert!(status.changes.iter().all(|change| change.untracked));
    let record = access
        .preview_git_record(&id, &Protection::default())
        .unwrap();
    assert!(!record.files.iter().any(|file| file.default_selected));

    let switching = access
        .preview_git_switch(&id, &first, false, &data, &Protection::default())
        .unwrap();
    access
        .confirm_git_switch(&id, &switching.token, &data, &Protection::default())
        .unwrap();
    assert_eq!(fs::read(root.join("server.js")).unwrap(), original);
    assert_eq!(
        fs::read_to_string(root.join(".pnds-seats.json")).unwrap(),
        "{\"seats\":[]}"
    );
    assert_eq!(
        fs::read_to_string(root.join("debug.log")).unwrap(),
        "runtime output"
    );
    assert_eq!(
        fs::metadata(root.join("new.wav")).unwrap().len(),
        10 * 1024 * 1024
    );
    let output = access
        .prepare_git_status(&id, &Protection::default())
        .unwrap()
        .run(&GitReader::default());
    let after_switch = access
        .finish_git_status(output, &Protection::default())
        .unwrap();
    assert_eq!(after_switch.head.as_deref(), Some(first.as_str()));
    assert!(after_switch.branch.is_none());
    assert_eq!(after_switch.changes.len(), 3);
    assert!(after_switch.changes.iter().all(|change| change.untracked));
    let record_after_switch = access
        .git_record_files(&id, &Protection::default())
        .unwrap();
    assert_eq!(record_after_switch.len(), 3);
    assert!(!record_after_switch.iter().any(|file| file.default_selected));
}

#[test]
fn private_creation_data_is_unrecorded_and_survives_version_switches() {
    let (temp, root, mut access, id) = setup();
    let data = temp.path().join("private");
    let first = save(&mut access, &id, "Initial project");
    let private = root.join(crate::creation_data::DIRECTORY);
    fs::create_dir(&private).unwrap();
    fs::write(
        private.join("history.json"),
        "conversation after initial version",
    )
    .unwrap();
    fs::write(private.join("materials.json"), "creator material").unwrap();
    fs::write(root.join("server.js"), "// changed artwork").unwrap();
    let preview = access
        .preview_git_record(&id, &Protection::default())
        .unwrap();
    assert!(preview
        .files
        .iter()
        .all(|file| !file.path.contains(crate::creation_data::DIRECTORY)));
    fs::write(private.join("history.json"), "chat during Git confirmation").unwrap();
    let second = access
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
        .unwrap()
        .commit;
    let repo = Repository::open(&root).unwrap();
    let tree = repo
        .find_commit(Oid::from_str(&second).unwrap())
        .unwrap()
        .tree()
        .unwrap();
    assert!(tree.get_name(crate::creation_data::DIRECTORY).is_none());
    access
        .preview_git_restore(&id, &first, &Protection::default())
        .unwrap();
    let preview = access
        .preview_git_switch(&id, &first, false, &data, &Protection::default())
        .unwrap();
    fs::write(
        private.join("history.json"),
        "chat during version switching",
    )
    .unwrap();
    access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .unwrap();
    assert_eq!(
        fs::read_to_string(private.join("history.json")).unwrap(),
        "chat during version switching"
    );
    assert_eq!(
        fs::read_to_string(private.join("materials.json")).unwrap(),
        "creator material"
    );
}

#[test]
fn restoring_the_current_version_discards_edits_without_moving_head_or_branch() {
    let (temp, root, mut access, id) = setup();
    let data = temp.path().join("private");
    fs::write(root.join(".gitignore"), ".env\n").unwrap();
    let original = fs::read(root.join("server.js")).unwrap();
    let initial = save(&mut access, &id, "Initial project");
    let head = fs::read(root.join(".git/HEAD")).unwrap();
    fs::write(root.join("server.js"), "// unwanted changes").unwrap();
    fs::write(root.join("extra.js"), "// newly created").unwrap();
    fs::write(root.join(".env"), "private fixture").unwrap();
    assert!(access
        .preview_git_switch(&id, &initial, false, &data, &Protection::default())
        .is_err());
    let preview = access
        .preview_git_switch(&id, &initial, true, &data, &Protection::default())
        .expect("current version must support explicit restoration of unrecorded changes");
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "// unwanted changes"
    );
    access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .unwrap();
    assert_eq!(fs::read(root.join("server.js")).unwrap(), original);
    assert!(!root.join("extra.js").exists());
    assert_eq!(
        fs::read_to_string(root.join(".env")).unwrap(),
        "private fixture"
    );
    assert_eq!(fs::read(root.join(".git/HEAD")).unwrap(), head);
    let repo = Repository::open(&root).unwrap();
    assert!(!repo.head_detached().unwrap());
    assert_eq!(repo.head().unwrap().target().unwrap().to_string(), initial);
    assert_eq!(
        access
            .git_version_graph(&id, 0, &Protection::default())
            .unwrap()
            .versions
            .len(),
        1
    );
    assert!(repo
        .statuses(None)
        .unwrap()
        .iter()
        .all(|status| status.status() == git2::Status::IGNORED));
}

#[test]
fn current_version_restore_accepts_draft_only_discard_and_keeps_detached_head() {
    let (temp, root, mut access, id) = setup();
    let data = temp.path().join("private");
    save(&mut access, &id, "Initial project");
    let repo = Repository::open(&root).unwrap();
    let parent = repo.head().unwrap().peel_to_commit().unwrap();
    let signature = git2::Signature::now("Creator", "creator@pnds.local").unwrap();
    let detached = repo
        .commit(
            None,
            &signature,
            &signature,
            "Detached version",
            &parent.tree().unwrap(),
            &[&parent],
        )
        .unwrap();
    repo.set_head_detached(detached).unwrap();
    let head = fs::read(root.join(".git/HEAD")).unwrap();
    let preview = access
        .preview_git_switch(
            &id,
            &detached.to_string(),
            true,
            &data,
            &Protection::default(),
        )
        .unwrap();
    assert!(preview.paths.is_empty());
    assert!(preview.discarded_paths.is_empty());
    access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .unwrap();
    assert_eq!(fs::read(root.join(".git/HEAD")).unwrap(), head);
    assert!(repo.head_detached().unwrap());
    assert_eq!(repo.head().unwrap().target().unwrap(), detached);
    let graph = access
        .git_version_graph(&id, 0, &Protection::default())
        .unwrap();
    assert_eq!(graph.versions.len(), 2);
    assert_eq!(graph.branches.len(), 1);
}

#[test]
fn switching_then_saving_forks_from_the_selected_parent_and_retains_old_route() {
    let (temp, root, mut access, id) = setup();
    let data = temp.path().join("private");
    let initial = fs::read(root.join("server.js")).unwrap();
    let a = save(&mut access, &id, "A");
    fs::write(root.join("server.js"), "// B").unwrap();
    let b = save(&mut access, &id, "B");
    fs::write(root.join("server.js"), "// C").unwrap();
    let c = save(&mut access, &id, "C");
    let repo = Repository::open(&root).unwrap();
    let branch = repo.head().unwrap().name().unwrap().to_owned();
    let before = fs::read(root.join(".git/HEAD")).unwrap();
    let preview = access
        .preview_git_switch(&id, &a, false, &data, &Protection::default())
        .unwrap();
    assert_eq!(fs::read(root.join(".git/HEAD")).unwrap(), before);
    assert_eq!(fs::read_to_string(root.join("server.js")).unwrap(), "// C");
    access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .unwrap();
    assert_eq!(fs::read(root.join("server.js")).unwrap(), initial);
    assert!(repo.head_detached().unwrap());
    assert_eq!(repo.head().unwrap().target().unwrap().to_string(), a);
    assert_eq!(
        repo.find_reference(&branch)
            .unwrap()
            .target()
            .unwrap()
            .to_string(),
        c
    );
    fs::write(root.join("server.js"), "// D").unwrap();
    let d = save(&mut access, &id, "D");
    let commit = repo.find_commit(Oid::from_str(&d).unwrap()).unwrap();
    assert_eq!(commit.parent_id(0).unwrap().to_string(), a);
    assert!(!repo.head_detached().unwrap());
    assert_ne!(repo.head().unwrap().name().unwrap(), branch);
    let graph = access
        .git_version_graph(&id, 0, &Protection::default())
        .unwrap();
    assert_eq!(graph.versions.len(), 4);
    assert!(graph
        .versions
        .iter()
        .any(|v| v.id == c && v.parents == [b.clone()]));
    assert!(graph
        .versions
        .iter()
        .any(|v| v.id == d && v.parents == [a.clone()]));
    assert!(graph.branches.iter().any(|r| r.tip == c));
}
#[test]
fn switch_tokens_recheck_disk_state_and_cannot_be_reused() {
    let (temp, root, mut access, id) = setup();
    let data = temp.path().join("private");
    let a = save(&mut access, &id, "A");
    fs::write(root.join("server.js"), "// B").unwrap();
    let b = save(&mut access, &id, "B");
    let preview = access
        .preview_git_switch(&id, &a, false, &data, &Protection::default())
        .unwrap();
    fs::write(root.join("server.js"), "// external edit").unwrap();
    assert!(access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .is_err());
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "// external edit"
    );
    assert_eq!(
        Repository::open(&root)
            .unwrap()
            .head()
            .unwrap()
            .target()
            .unwrap()
            .to_string(),
        b
    );
    assert!(access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .is_err());
}
#[test]
fn explicit_discard_removes_only_eligible_changes_and_preserves_private_files() {
    let (temp, root, mut access, id) = setup();
    let data = temp.path().join("private");
    fs::write(root.join(".gitignore"), ".env\nnode_modules/\n").unwrap();
    let a = save(&mut access, &id, "A");
    fs::write(root.join("server.js"), "// B").unwrap();
    save(&mut access, &id, "B");
    fs::write(root.join("extra.js"), "unsaved new file").unwrap();
    fs::write(root.join("server.js"), "// dirty").unwrap();
    fs::write(root.join(".env"), "private").unwrap();
    assert!(access
        .preview_git_switch(&id, &a, false, &data, &Protection::default())
        .is_err());
    let preview = access
        .preview_git_switch(&id, &a, true, &data, &Protection::default())
        .unwrap();
    assert!(preview.discarded_paths.contains(&"extra.js".into()));
    access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .unwrap();
    assert!(!root.join("extra.js").exists());
    assert_eq!(fs::read_to_string(root.join(".env")).unwrap(), "private");
    let repo = Repository::open(&root).unwrap();
    let statuses = repo.statuses(None).unwrap();
    assert!(
        statuses.iter().all(|s| s.status() == git2::Status::IGNORED),
        "{:?}",
        statuses
            .iter()
            .map(|s| (s.path().unwrap().to_owned(), s.status()))
            .collect::<Vec<_>>()
    );
}
#[test]
fn external_staging_blocks_preview_while_live_assistant_grants_block_confirmation() {
    let (temp, root, mut access, id) = setup();
    let data = temp.path().join("private");
    let a = save(&mut access, &id, "A");
    fs::write(root.join("server.js"), "// B").unwrap();
    save(&mut access, &id, "B");
    let task = access
        .begin_assistant_task(
            &id,
            AssistantMode::Edit,
            None,
            &data,
            &Protection::default(),
        )
        .unwrap();
    let before_head = fs::read(root.join(".git/HEAD")).unwrap();
    let before_index = fs::read(root.join(".git/index")).unwrap();
    let before_server = fs::read(root.join("server.js")).unwrap();
    let preview = access
        .preview_git_switch(&id, &a, true, &data, &Protection::default())
        .expect("read-only checkout review must precede ending an assistant task");
    assert!(access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .unwrap_err()
        .detail
        .contains("assistant"));
    assert_eq!(fs::read(root.join(".git/HEAD")).unwrap(), before_head);
    assert_eq!(fs::read(root.join(".git/index")).unwrap(), before_index);
    assert_eq!(fs::read(root.join("server.js")).unwrap(), before_server);
    access
        .end_git_assistant_task(&id, &data, &Protection::default())
        .unwrap();
    assert!(access
        .authorize_assistant_task(&id, &task.id, true, &Protection::default())
        .is_err());
    assert!(data.join("assistant-tasks").exists());
    let repo = Repository::open(&root).unwrap();
    fs::write(root.join("server.js"), "// staged").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("server.js")).unwrap();
    index.write().unwrap();
    assert!(access
        .preview_git_switch(&id, &a, true, &data, &Protection::default())
        .unwrap_err()
        .detail
        .contains("staged"));
}

#[test]
fn graph_pages_keep_all_merge_parents_and_do_not_duplicate_commits() {
    let (_temp, root, mut access, id) = setup();
    let a = save(&mut access, &id, "A");
    let repo = Repository::open(&root).unwrap();
    let signature = git2::Signature::now("Creator", "creator@pnds.local").unwrap();
    let initial = repo.find_commit(Oid::from_str(&a).unwrap()).unwrap();
    let tree = initial.tree().unwrap();
    let side = repo
        .commit(
            Some("refs/heads/side"),
            &signature,
            &signature,
            "Side route",
            &tree,
            &[&initial],
        )
        .unwrap();
    let mut head = initial.id();
    for n in 0..65 {
        let parent = repo.find_commit(head).unwrap();
        head = repo
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                &format!("Version {n}"),
                &tree,
                &[&parent],
            )
            .unwrap();
    }
    let main = repo.find_commit(head).unwrap();
    let side_commit = repo.find_commit(side).unwrap();
    let merge = repo
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            "External merge",
            &tree,
            &[&main, &side_commit],
        )
        .unwrap();
    let first = access
        .git_version_graph(&id, 0, &Protection::default())
        .unwrap();
    assert_eq!(first.versions.len(), 60);
    assert_eq!(first.next_offset, Some(60));
    assert_eq!(
        first
            .versions
            .iter()
            .find(|v| v.id == merge.to_string())
            .unwrap()
            .parents,
        [head.to_string(), side.to_string()]
    );
    let second = access
        .git_version_graph(&id, first.next_offset.unwrap(), &Protection::default())
        .unwrap();
    assert!(second.next_offset.is_none());
    let ids: std::collections::BTreeSet<_> = first
        .versions
        .iter()
        .chain(&second.versions)
        .map(|v| &v.id)
        .collect();
    assert_eq!(ids.len(), 68);
    assert_eq!(ids.len(), first.versions.len() + second.versions.len());
}

#[test]
fn switching_restores_additions_and_deletions_and_reviews_ignored_collisions() {
    let (temp, root, mut access, id) = setup();
    let data = temp.path().join("private");
    fs::write(root.join("old.js"), "old content").unwrap();
    let a = save(&mut access, &id, "A");
    fs::remove_file(root.join("old.js")).unwrap();
    fs::write(root.join("new.js"), "new content").unwrap();
    fs::write(root.join(".gitignore"), "old.js\n").unwrap();
    let b = save(&mut access, &id, "B");
    fs::write(root.join("old.js"), "private local content").unwrap();
    assert!(access
        .preview_git_switch(&id, &a, false, &data, &Protection::default())
        .is_err());
    let collision = access
        .preview_git_switch(&id, &a, true, &data, &Protection::default())
        .expect("ordinary ignored collisions may be reviewed before explicit checkout");
    assert_eq!(collision.overwritten_paths, ["old.js"]);
    assert!(collision.paths.iter().any(|path| path == "old.js"));
    assert_eq!(
        fs::read_to_string(root.join("old.js")).unwrap(),
        "private local content"
    );
    fs::remove_file(root.join("old.js")).unwrap();
    let preview = access
        .preview_git_switch(&id, &a, false, &data, &Protection::default())
        .unwrap();
    access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("old.js")).unwrap(),
        "old content"
    );
    assert!(!root.join("new.js").exists());
    let repo = Repository::open(&root).unwrap();
    assert!(repo.find_commit(Oid::from_str(&b).unwrap()).is_ok());
}

#[test]
fn switch_refuses_repo_locks_and_a_head_changed_after_preview() {
    let (temp, root, mut access, id) = setup();
    let data = temp.path().join("private");
    let a = save(&mut access, &id, "A");
    fs::write(root.join("server.js"), "// B").unwrap();
    save(&mut access, &id, "B");
    let preview = access
        .preview_git_switch(&id, &a, false, &data, &Protection::default())
        .unwrap();
    fs::write(root.join(".git/index.lock"), "external").unwrap();
    assert!(access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .is_err());
    fs::remove_file(root.join(".git/index.lock")).unwrap();
    let preview = access
        .preview_git_switch(&id, &a, false, &data, &Protection::default())
        .unwrap();
    let repo = Repository::open(&root).unwrap();
    let head = repo.head().unwrap().peel_to_commit().unwrap();
    let signature = git2::Signature::now("Other", "other@local").unwrap();
    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        "External commit",
        &head.tree().unwrap(),
        &[&head],
    )
    .unwrap();
    assert!(access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .is_err());
    assert_eq!(fs::read_to_string(root.join("server.js")).unwrap(), "// B");
}

#[test]
fn named_branch_switch_attaches_head_and_subsequent_save_advances_that_route() {
    let (temp, root, mut access, id) = setup();
    let data = temp.path().join("private");
    let initial = save(&mut access, &id, "Initial project");
    let repo = Repository::open(&root).unwrap();
    let original_branch = repo.head().unwrap().shorthand().unwrap().to_owned();
    repo.branch(
        "breathing",
        &repo.find_commit(Oid::from_str(&initial).unwrap()).unwrap(),
        false,
    )
    .unwrap();
    fs::write(root.join("server.js"), "// main changes").unwrap();
    let latest = save(&mut access, &id, "Main changes");
    let preview = access
        .preview_git_branch_switch(
            &id,
            ("breathing", &initial),
            false,
            &data,
            &Protection::default(),
        )
        .unwrap();
    access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .unwrap();
    assert!(!repo.head_detached().unwrap());
    assert_eq!(repo.head().unwrap().shorthand().unwrap(), "breathing");
    assert_eq!(
        repo.find_branch(&original_branch, git2::BranchType::Local)
            .unwrap()
            .get()
            .target()
            .unwrap()
            .to_string(),
        latest
    );
    fs::write(root.join("server.js"), "// breathing changes").unwrap();
    let child = save(&mut access, &id, "Breathing changes");
    assert_eq!(
        repo.find_commit(Oid::from_str(&child).unwrap())
            .unwrap()
            .parent_id(0)
            .unwrap()
            .to_string(),
        initial
    );
    assert_eq!(
        repo.find_branch("breathing", git2::BranchType::Local)
            .unwrap()
            .get()
            .target()
            .unwrap()
            .to_string(),
        child
    );
}

#[test]
fn named_branch_preview_rejects_ref_changes_and_can_attach_the_current_commit() {
    let (temp, root, mut access, id) = setup();
    let data = temp.path().join("private");
    let initial = save(&mut access, &id, "Initial project");
    let repo = Repository::open(&root).unwrap();
    repo.branch(
        "same",
        &repo.find_commit(Oid::from_str(&initial).unwrap()).unwrap(),
        false,
    )
    .unwrap();
    let preview = access
        .preview_git_branch_switch(
            &id,
            ("same", &initial),
            false,
            &data,
            &Protection::default(),
        )
        .unwrap();
    access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .unwrap();
    assert_eq!(repo.head().unwrap().shorthand().unwrap(), "same");
    fs::write(root.join("server.js"), "// next version").unwrap();
    let next = save(&mut access, &id, "Next");
    repo.branch(
        "another",
        &repo.find_commit(Oid::from_str(&next).unwrap()).unwrap(),
        false,
    )
    .unwrap();
    let preview = access
        .preview_git_branch_switch(
            &id,
            ("another", &next),
            false,
            &data,
            &Protection::default(),
        )
        .unwrap();
    repo.find_reference("refs/heads/another")
        .unwrap()
        .set_target(Oid::from_str(&initial).unwrap(), "external move")
        .unwrap();
    assert_eq!(
        access
            .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    assert_ne!(initial, next);
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "// next version"
    );
}

fn archived_log_versions() -> (
    tempfile::TempDir,
    PathBuf,
    CreationAccess,
    String,
    String,
    String,
) {
    let (temp, root, mut access, id) = setup();
    let first = save(&mut access, &id, "Before archived verification");
    fs::create_dir_all(root.join("docs/handoff-history")).unwrap();
    fs::write(
        root.join("docs/handoff-history/verification.log"),
        "saved verification output\n",
    )
    .unwrap();
    fs::write(root.join("artwork.bin"), [0, 255, 1, 128]).unwrap();
    fs::write(root.join("server.js"), "// November artwork\n").unwrap();
    let repo = Repository::open(&root).unwrap();
    let parent = repo.head().unwrap().peel_to_commit().unwrap();
    let mut index = repo.index().unwrap();
    for file in [
        "docs/handoff-history/verification.log",
        "artwork.bin",
        "server.js",
    ] {
        index.add_path(Path::new(file)).unwrap();
    }
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let author = repo.signature().unwrap();
    let latest = repo
        .commit(
            Some("HEAD"),
            &author,
            &author,
            "Archived verification and artwork",
            &tree,
            &[&parent],
        )
        .unwrap();
    repo.branch("november-latest", &repo.find_commit(latest).unwrap(), false)
        .unwrap();
    (temp, root, access, id, first, latest.to_string())
}

#[test]
fn historical_archive_logs_switch_back_to_the_named_latest_branch_with_binary_artwork() {
    let (temp, root, mut access, id, first, latest) = archived_log_versions();
    let data = temp.path().join("private");
    let older = access
        .preview_git_switch(&id, &first, false, &data, &Protection::default())
        .unwrap();
    access
        .confirm_git_switch(&id, &older.token, &data, &Protection::default())
        .unwrap();
    assert!(!root.join("docs/handoff-history/verification.log").exists());
    assert!(!root.join("artwork.bin").exists());
    let newer = access
        .preview_git_branch_switch(
            &id,
            ("november-latest", &latest),
            false,
            &data,
            &Protection::default(),
        )
        .expect("a previously committed verification log is ordinary historical content");
    access
        .confirm_git_switch(&id, &newer.token, &data, &Protection::default())
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("docs/handoff-history/verification.log")).unwrap(),
        "saved verification output\n"
    );
    assert_eq!(
        fs::read(root.join("artwork.bin")).unwrap(),
        [0, 255, 1, 128]
    );
    let repo = Repository::open(&root).unwrap();
    assert!(!repo.head_detached().unwrap());
    assert_eq!(repo.head().unwrap().shorthand().unwrap(), "november-latest");
    assert_eq!(repo.head().unwrap().target().unwrap().to_string(), latest);
    assert!(repo.find_commit(Oid::from_str(&first).unwrap()).is_ok());
}

#[test]
fn historical_archive_collision_requires_explicit_discard_and_preserves_private_work() {
    let (temp, root, mut access, id, first, latest) = archived_log_versions();
    let data = temp.path().join("private");
    let older = access
        .preview_git_switch(&id, &first, false, &data, &Protection::default())
        .unwrap();
    access
        .confirm_git_switch(&id, &older.token, &data, &Protection::default())
        .unwrap();
    fs::write(root.join("server.js"), "// unrecorded experiment").unwrap();
    fs::write(root.join("new-experiment.js"), "// new unrecorded source").unwrap();
    fs::create_dir_all(root.join("docs/handoff-history")).unwrap();
    fs::write(
        root.join("docs/handoff-history/verification.log"),
        "untracked local verification",
    )
    .unwrap();
    fs::write(root.join(".env"), "PRIVATE_FIXTURE=keep").unwrap();
    let private = root.join(crate::creation_data::DIRECTORY);
    fs::create_dir_all(private.join("recordings")).unwrap();
    fs::write(private.join("history.json"), "creator conversation").unwrap();
    fs::write(
        private.join("recordings/kept.json"),
        "kept performance record",
    )
    .unwrap();
    assert!(access
        .preview_git_branch_switch(
            &id,
            ("november-latest", &latest),
            false,
            &data,
            &Protection::default()
        )
        .is_err());
    let preview = access
        .preview_git_branch_switch(
            &id,
            ("november-latest", &latest),
            true,
            &data,
            &Protection::default(),
        )
        .expect("explicit discard may replace an ordinary archived log collision");
    for file in ["server.js", "new-experiment.js"] {
        assert!(
            preview.discarded_paths.iter().any(|path| path == file),
            "missing disclosed discarded path: {file}"
        );
        assert!(preview.paths.iter().any(|path| path == file));
    }
    assert_eq!(
        preview.overwritten_paths,
        ["docs/handoff-history/verification.log"]
    );
    assert!(preview
        .paths
        .iter()
        .any(|path| path == "docs/handoff-history/verification.log"));
    assert!(preview
        .discarded_paths
        .iter()
        .all(|path| !path.starts_with(".pnds-") && path != ".env"));
    access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "// November artwork\n"
    );
    assert!(!root.join("new-experiment.js").exists());
    assert_eq!(
        fs::read_to_string(root.join("docs/handoff-history/verification.log")).unwrap(),
        "saved verification output\n"
    );
    assert_eq!(
        fs::read(root.join("artwork.bin")).unwrap(),
        [0, 255, 1, 128]
    );
    assert_eq!(
        fs::read_to_string(root.join(".env")).unwrap(),
        "PRIVATE_FIXTURE=keep"
    );
    assert_eq!(
        fs::read_to_string(private.join("history.json")).unwrap(),
        "creator conversation"
    );
    assert_eq!(
        fs::read_to_string(private.join("recordings/kept.json")).unwrap(),
        "kept performance record"
    );
    let repo = Repository::open(&root).unwrap();
    assert!(!repo.head_detached().unwrap());
    assert_eq!(repo.head().unwrap().shorthand().unwrap(), "november-latest");
    assert_eq!(repo.head().unwrap().target().unwrap().to_string(), latest);
}

fn imported_guard_target(repo: &Repository, path: &str, bytes: &[u8], mode: i32) -> String {
    fn insert_path(
        repo: &Repository,
        base: Option<&git2::Tree<'_>>,
        parts: &[&str],
        object: Oid,
        mode: i32,
    ) -> Oid {
        let mut builder = repo.treebuilder(base).unwrap();
        if parts.len() == 1 {
            builder.insert(parts[0], object, mode).unwrap();
        } else {
            let child = insert_path(repo, None, &parts[1..], object, mode);
            builder.insert(parts[0], child, 0o040000).unwrap();
        }
        builder.write().unwrap()
    }
    let parent = repo.head().unwrap().peel_to_commit().unwrap();
    let object = if mode == 0o160000 {
        parent.id()
    } else {
        repo.blob(bytes).unwrap()
    };
    let parent_tree = parent.tree().unwrap();
    let tree_id = insert_path(
        repo,
        Some(&parent_tree),
        &path.split('/').collect::<Vec<_>>(),
        object,
        mode,
    );
    let tree = repo.find_tree(tree_id).unwrap();
    let author = repo.signature().unwrap();
    repo.commit(
        Some("refs/heads/unsafe-target"),
        &author,
        &author,
        "Imported historical tree",
        &tree,
        &[&parent],
    )
    .unwrap()
    .to_string()
}

#[test]
fn historical_checkout_never_restores_a_private_project_tree_or_sensitive_file() {
    for path in [
        ".pnds-creation/nested/recordings/old.json",
        ".pnds-shared/nested/data.json",
        ".pnds/nested/data.json",
        ".PNDS-CREATION/nested/chat.json",
        ".env",
    ] {
        let (temp, root, mut access, id) = setup();
        save(&mut access, &id, "Initial project");
        let data = temp.path().join("private");
        let private = root.join(crate::creation_data::DIRECTORY);
        fs::create_dir_all(private.join("recordings")).unwrap();
        fs::write(private.join("history.json"), "keep current conversation").unwrap();
        fs::write(private.join("recordings/live.json"), "keep current record").unwrap();
        fs::write(root.join(".env"), "PRIVATE_FIXTURE=keep").unwrap();
        let repo = Repository::open(&root).unwrap();
        let before_head = repo.head().unwrap().target();
        let target = imported_guard_target(&repo, path, b"historical protected bytes", 0o100644);
        let failure = access
            .preview_git_branch_switch(
                &id,
                ("unsafe-target", &target),
                true,
                &data,
                &Protection::default(),
            )
            .unwrap_err();
        let detail = failure.detail.to_ascii_lowercase();
        let protected_root = path.split('/').next().unwrap().to_ascii_lowercase();
        assert!(
            detail.contains(&protected_root),
            "missing protected path in {}",
            failure.detail
        );
        assert!(
            detail.contains("private") || detail.contains("sensitive"),
            "missing protection reason in {}",
            failure.detail
        );
        assert_eq!(
            fs::read_to_string(private.join("history.json")).unwrap(),
            "keep current conversation"
        );
        assert_eq!(
            fs::read_to_string(private.join("recordings/live.json")).unwrap(),
            "keep current record"
        );
        assert_eq!(
            fs::read_to_string(root.join(".env")).unwrap(),
            "PRIVATE_FIXTURE=keep"
        );
        assert_eq!(repo.head().unwrap().target(), before_head);
    }
}

#[test]
fn historical_checkout_reports_the_symbolic_link_or_submodule_path_without_mutation() {
    for (path, mode, reason) in [
        ("assets/link.js", 0o120000, "symbolic"),
        ("assets/module", 0o160000, "submodule"),
    ] {
        let (temp, root, mut access, id) = setup();
        save(&mut access, &id, "Initial project");
        let data = temp.path().join("private");
        let repo = Repository::open(&root).unwrap();
        let before_head = fs::read(root.join(".git/HEAD")).unwrap();
        let before_index = fs::read(root.join(".git/index")).unwrap();
        let before_server = fs::read(root.join("server.js")).unwrap();
        let target = imported_guard_target(&repo, path, b"../outside", mode);
        let failure = access
            .preview_git_branch_switch(
                &id,
                ("unsafe-target", &target),
                false,
                &data,
                &Protection::default(),
            )
            .unwrap_err();
        assert!(
            failure.detail.contains(path),
            "missing rejected path in {}",
            failure.detail
        );
        assert!(
            failure.detail.to_ascii_lowercase().contains(reason),
            "missing rejected kind in {}",
            failure.detail
        );
        assert_eq!(fs::read(root.join(".git/HEAD")).unwrap(), before_head);
        assert_eq!(fs::read(root.join(".git/index")).unwrap(), before_index);
        assert_eq!(fs::read(root.join("server.js")).unwrap(), before_server);
        assert!(!root.join("assets").exists());
    }
}

#[test]
fn historical_checkout_reports_the_file_path_and_size_limit_before_writing() {
    let (temp, root, mut access, id) = setup();
    save(&mut access, &id, "Initial project");
    let data = temp.path().join("private");
    let repo = Repository::open(&root).unwrap();
    let before_head = repo.head().unwrap().target();
    let oversized = vec![0; local_git::GIT_FILE_LIMIT as usize + 1];
    let target = imported_guard_target(&repo, "assets/oversized.bin", &oversized, 0o100644);
    drop(oversized);
    let failure = access
        .preview_git_branch_switch(
            &id,
            ("unsafe-target", &target),
            false,
            &data,
            &Protection::default(),
        )
        .unwrap_err();
    assert_eq!(failure.code, CreationErrorCode::TooLarge);
    assert!(
        failure.detail.contains("assets/oversized.bin"),
        "missing oversized path in {}",
        failure.detail
    );
    let detail = failure.detail.to_ascii_lowercase();
    assert!(
        detail.contains("size") || detail.contains("64") || detail.contains("large"),
        "missing size reason in {}",
        failure.detail
    );
    assert_eq!(repo.head().unwrap().target(), before_head);
    assert!(!root.join("assets").exists());
}

#[test]
fn historical_archive_discard_preview_expires_after_a_same_length_local_log_edit() {
    let (temp, root, mut access, id, first, latest) = archived_log_versions();
    let data = temp.path().join("private");
    let older = access
        .preview_git_switch(&id, &first, false, &data, &Protection::default())
        .unwrap();
    access
        .confirm_git_switch(&id, &older.token, &data, &Protection::default())
        .unwrap();
    let log = root.join("docs/handoff-history/verification.log");
    fs::create_dir_all(log.parent().unwrap()).unwrap();
    fs::write(&log, "reviewed log\n").unwrap();
    let preview = access
        .preview_git_branch_switch(
            &id,
            ("november-latest", &latest),
            true,
            &data,
            &Protection::default(),
        )
        .unwrap();
    let head = fs::read(root.join(".git/HEAD")).unwrap();
    let index = fs::read(root.join(".git/index")).unwrap();
    assert_eq!("reviewed log\n".len(), "modified log\n".len());
    fs::write(&log, "modified log\n").unwrap();
    let failure = access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .unwrap_err();
    assert_eq!(failure.code, CreationErrorCode::VersionConflict);
    assert_eq!(fs::read_to_string(&log).unwrap(), "modified log\n");
    assert_eq!(fs::read(root.join(".git/HEAD")).unwrap(), head);
    assert_eq!(fs::read(root.join(".git/index")).unwrap(), index);
    assert!(!root.join("artwork.bin").exists());
}

#[test]
fn historical_checkout_never_deletes_current_index_private_or_credential_files() {
    for path in [
        ".pnds-creation/recordings/current.json",
        "credentials.json",
        "audio/private.key",
        ".env",
    ] {
        let (temp, root, mut access, id) = setup();
        let initial = save(&mut access, &id, "Before protected external commit");
        let data = temp.path().join("private");
        let repo = Repository::open(&root).unwrap();
        let protected = imported_guard_target(&repo, path, b"protected current bytes", 0o100644);
        repo.set_head("refs/heads/unsafe-target").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();
        let before_head = fs::read(root.join(".git/HEAD")).unwrap();
        let before_index = fs::read(root.join(".git/index")).unwrap();
        assert!(repo
            .find_commit(Oid::from_str(&initial).unwrap())
            .unwrap()
            .tree()
            .unwrap()
            .get_path(Path::new(path))
            .is_err());
        let failure = access
            .preview_git_switch(&id, &initial, true, &data, &Protection::default())
            .unwrap_err();
        assert!(
            failure.detail.contains(path),
            "missing current protected path in {}",
            failure.detail
        );
        let reason = failure.detail.to_ascii_lowercase();
        assert!(
            reason.contains("private")
                || reason.contains("sensitive")
                || reason.contains("credential"),
            "missing current protection reason in {}",
            failure.detail
        );
        assert_eq!(
            fs::read(root.join(path)).unwrap(),
            b"protected current bytes"
        );
        assert_eq!(fs::read(root.join(".git/HEAD")).unwrap(), before_head);
        assert_eq!(fs::read(root.join(".git/index")).unwrap(), before_index);
        assert_eq!(
            repo.head().unwrap().target().unwrap().to_string(),
            protected
        );
    }
}

#[test]
fn staged_deletions_of_excluded_or_private_files_block_checkout_before_any_write() {
    for path in [
        "docs/archive.log",
        ".env",
        ".pnds-creation/recordings/current.json",
    ] {
        let (temp, root, mut access, id) = setup();
        let safe = save(&mut access, &id, "Before external protected content");
        let data = temp.path().join("private");
        let repo = Repository::open(&root).unwrap();
        imported_guard_target(&repo, path, b"externally committed bytes", 0o100644);
        repo.set_head("refs/heads/unsafe-target").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();
        let mut index = repo.index().unwrap();
        index.remove_path(Path::new(path)).unwrap();
        index.write().unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(
            repo.diff_tree_to_index(Some(&head.tree().unwrap()), Some(&index), None)
                .unwrap()
                .deltas()
                .len(),
            1
        );
        let before_head = fs::read(root.join(".git/HEAD")).unwrap();
        let before_index = fs::read(root.join(".git/index")).unwrap();
        let before_server = fs::read(root.join("server.js")).unwrap();
        let failure = access
            .preview_git_switch(&id, &safe, true, &data, &Protection::default())
            .unwrap_err();
        assert!(
            failure.detail.to_ascii_lowercase().contains("staged"),
            "staged deletion must be handled before excluded-file filtering: {}",
            failure.detail
        );
        assert_eq!(
            fs::read(root.join(path)).unwrap(),
            b"externally committed bytes"
        );
        assert_eq!(fs::read(root.join(".git/HEAD")).unwrap(), before_head);
        assert_eq!(fs::read(root.join(".git/index")).unwrap(), before_index);
        assert_eq!(fs::read(root.join("server.js")).unwrap(), before_server);
    }
}

#[test]
fn staged_deletion_after_review_cannot_be_consumed_by_checkout_confirmation() {
    for path in [
        "docs/archive.log",
        ".env",
        ".pnds-creation/recordings/current.json",
    ] {
        let (temp, root, mut access, id) = setup();
        let safe = save(&mut access, &id, "Before external staged deletion");
        fs::write(root.join("server.js"), "// currently saved source").unwrap();
        save(&mut access, &id, "Saved source before review");
        let data = temp.path().join("private");
        let preview = access
            .preview_git_switch(&id, &safe, false, &data, &Protection::default())
            .unwrap();
        // An external Git operation may introduce a formerly tracked private
        // path and stage its deletion while the App's earlier review is open.
        let repo = Repository::open(&root).unwrap();
        imported_guard_target(&repo, path, b"externally committed bytes", 0o100644);
        repo.set_head("refs/heads/unsafe-target").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();
        let mut index = repo.index().unwrap();
        index.remove_path(Path::new(path)).unwrap();
        index.write().unwrap();
        let before_head = fs::read(root.join(".git/HEAD")).unwrap();
        let before_index = fs::read(root.join(".git/index")).unwrap();
        let failure = access
            .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
            .unwrap_err();
        assert!(
            failure.code == CreationErrorCode::VersionConflict
                || failure.detail.to_ascii_lowercase().contains("staged"),
            "changed staging must not be consumed by checkout: {}",
            failure.detail
        );
        assert_eq!(
            fs::read(root.join(path)).unwrap(),
            b"externally committed bytes"
        );
        assert_eq!(
            fs::read_to_string(root.join("server.js")).unwrap(),
            "// currently saved source"
        );
        assert_eq!(fs::read(root.join(".git/HEAD")).unwrap(), before_head);
        assert_eq!(fs::read(root.join(".git/index")).unwrap(), before_index);
    }
}
