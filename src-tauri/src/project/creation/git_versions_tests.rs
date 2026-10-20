use super::tests::project;
use super::*;
use git2::{Oid, Repository};
fn setup() -> (tempfile::TempDir, PathBuf, CreationAccess, String) {
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
fn save(access: &mut CreationAccess, id: &str, label: &str) -> String {
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
fn external_staging_and_live_assistant_grants_block_version_switching() {
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
    assert!(access
        .preview_git_switch(&id, &a, true, &data, &Protection::default())
        .unwrap_err()
        .detail
        .contains("assistant"));
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
fn switching_restores_additions_and_deletions_and_protects_ignored_collisions() {
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
        .preview_git_switch(&id, &a, true, &data, &Protection::default())
        .is_err());
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
