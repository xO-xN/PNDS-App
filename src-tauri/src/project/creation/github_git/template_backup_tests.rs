use super::*;
use crate::project::creation::git_versions_tests::{save, setup};

fn initial_template(repo: &Repository) -> Oid {
    let mut tree = repo.treebuilder(None).unwrap();
    tree.insert(
        "template.txt",
        repo.blob(b"official snapshot").unwrap(),
        0o100644,
    )
    .unwrap();
    let tree = tree.write().unwrap();
    let author = git2::Signature::now("Template", "template@example.test").unwrap();
    repo.commit(
        Some("HEAD"),
        &author,
        &author,
        "Generated from the template",
        &repo.find_tree(tree).unwrap(),
        &[],
    )
    .unwrap()
}

#[test]
fn first_template_backup_pins_one_exact_merge_and_preserves_a_later_version() {
    let (temp, root, mut access, identity) = setup();
    let confirmed = save(&mut access, &identity, "Saved composition");
    let local = Repository::open(&root).unwrap();
    let other = local.find_commit(parse_oid(&confirmed).unwrap()).unwrap();
    local.branch("other", &other, false).unwrap();
    let remote = initialize(&temp.path().join("remote.git"), "main", true).unwrap();
    let url = remote.path().to_str().unwrap();
    let remote_root = initial_template(&remote);

    let plan = prepare_repository(
        &local,
        (url, None),
        "main",
        parse_oid(&confirmed).unwrap(),
        remote_root,
        false,
        || Ok(()),
    )
    .unwrap();
    let merge = parse_oid(&plan.merge_head).unwrap();
    assert!(local.find_reference(&pin_name(merge)).is_err());
    let local = Repository::open(&root).unwrap();
    pin_repository(&local, &plan, false, || Ok(())).unwrap();
    let merged = local.find_commit(merge).unwrap();
    assert_eq!(
        merged.parent_ids().collect::<Vec<_>>(),
        [other.id(), remote_root]
    );
    assert_eq!(merged.tree_id(), other.tree_id());
    assert_eq!(local.head().unwrap().target(), Some(other.id()));
    assert_eq!(remote.head().unwrap().target(), Some(remote_root));
    assert_eq!(
        local.find_reference(&pin_name(merge)).unwrap().target(),
        Some(merge)
    );
    assert!(!root.join(".git/FETCH_HEAD").exists());

    fs::write(root.join("server.js"), "// saved after interruption").unwrap();
    let later = save(&mut access, &identity, "Later composition");
    let reopened = Repository::open(&root).unwrap();
    let persisted = serde_json::to_string(&plan).unwrap();
    let plan = serde_json::from_str::<GithubTemplateCommit>(&persisted).unwrap();
    fs::write(root.join("server.js"), "// externally staged").unwrap();
    let mut index = reopened.index().unwrap();
    index.add_path(Path::new("server.js")).unwrap();
    index.write().unwrap();
    fs::write(root.join("server.js"), "// unstaged draft").unwrap();
    let index_before = fs::read(reopened.path().join("index")).unwrap();

    assert_eq!(
        read_remote_head(&reopened, url, None, "main").unwrap(),
        Some(remote_root)
    );
    let error =
        push_template_repository(&reopened, (url, None), &plan, true, || Ok(())).unwrap_err();
    assert_eq!(error.code, CreationErrorCode::VersionConflict);
    assert_eq!(remote.head().unwrap().target(), Some(remote_root));
    push_template_repository(&reopened, (url, None), &plan, false, || Ok(())).unwrap();
    assert_eq!(
        read_remote_head(&reopened, url, None, "main").unwrap(),
        Some(merge)
    );
    assert!(remote.find_commit(parse_oid(&later).unwrap()).is_err());
    let remote_merge = remote.find_commit(merge).unwrap();
    assert_eq!(
        remote_merge.parent_ids().collect::<Vec<_>>(),
        [other.id(), remote_root]
    );
    assert_eq!(remote_merge.tree_id(), other.tree_id());

    let reopened = Repository::open(&root).unwrap();
    let result = finish_repository(&reopened, &plan, || Ok(())).unwrap();
    let later = reopened.find_commit(parse_oid(&later).unwrap()).unwrap();
    let integrated = reopened
        .find_commit(parse_oid(result.head.as_deref().unwrap()).unwrap())
        .unwrap();
    assert_eq!(
        integrated.parent_ids().collect::<Vec<_>>(),
        [later.id(), merge]
    );
    assert_eq!(integrated.tree_id(), later.tree_id());
    assert_eq!(
        finish_repository(&reopened, &plan, || Ok(())).unwrap().head,
        result.head
    );
    assert_eq!(
        fs::read(reopened.path().join("index")).unwrap(),
        index_before
    );
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "// unstaged draft"
    );
    assert_eq!(
        reopened
            .find_reference("refs/heads/other")
            .unwrap()
            .target(),
        Some(other.id())
    );
    release_repository(&reopened, &plan, || Ok(())).unwrap();
    assert!(reopened.find_reference(&pin_name(merge)).is_err());
    release_repository(&reopened, &plan, || Ok(())).unwrap();
}

#[test]
fn first_template_backup_detects_remote_competition_even_when_it_would_fast_forward() {
    let (temp, root, mut access, identity) = setup();
    let confirmed = parse_oid(&save(&mut access, &identity, "Saved composition")).unwrap();
    let local = Repository::open(&root).unwrap();
    let remote = initialize(&temp.path().join("remote.git"), "main", true).unwrap();
    let url = remote.path().to_str().unwrap();
    let remote_root = initial_template(&remote);
    local
        .remote_anonymous(url)
        .unwrap()
        .push(&[format!("{confirmed}:refs/heads/other")], None)
        .unwrap();
    let plan = prepare_repository(
        &local,
        (url, None),
        "main",
        confirmed,
        remote_root,
        false,
        || Ok(()),
    )
    .unwrap();
    let local = Repository::open(&root).unwrap();
    pin_repository(&local, &plan, false, || Ok(())).unwrap();
    let attempts = Cell::new(0);
    let compete = || {
        attempts.set(attempts.get() + 1);
        if attempts.get() == 2 {
            remote
                .reference("refs/heads/main", confirmed, true, "Concurrent push")
                .unwrap();
        }
        Ok(())
    };
    let error = push_template_repository(&local, (url, None), &plan, true, compete).unwrap_err();
    assert_eq!(error.code, CreationErrorCode::VersionConflict);
    assert_eq!(remote.head().unwrap().target(), Some(confirmed));
    assert_eq!(local.head().unwrap().target(), Some(confirmed));
    let reopened = Repository::open(&root).unwrap();
    assert_eq!(
        read_remote_head(&reopened, url, None, "main").unwrap(),
        Some(confirmed)
    );
    let error =
        push_template_repository(&reopened, (url, None), &plan, false, || Ok(())).unwrap_err();
    assert_eq!(error.code, CreationErrorCode::VersionConflict);
    assert!(reopened
        .find_reference(&pin_name(parse_oid(&plan.merge_head).unwrap()))
        .is_ok());
}

#[test]
fn first_template_backup_reconciles_the_saved_branch_after_the_creator_switches_branches() {
    let (temp, root, mut access, identity) = setup();
    let confirmed = parse_oid(&save(&mut access, &identity, "Saved composition")).unwrap();
    let local = Repository::open(&root).unwrap();
    local
        .branch("other", &local.find_commit(confirmed).unwrap(), false)
        .unwrap();
    let remote = initialize(&temp.path().join("remote.git"), "main", true).unwrap();
    let url = remote.path().to_str().unwrap();
    let remote_root = initial_template(&remote);
    let plan = prepare_repository(
        &local,
        (url, None),
        "main",
        confirmed,
        remote_root,
        false,
        || Ok(()),
    )
    .unwrap();
    let local = Repository::open(&root).unwrap();
    pin_repository(&local, &plan, false, || Ok(())).unwrap();
    push_template_repository(&local, (url, None), &plan, true, || Ok(())).unwrap();
    local.set_head("refs/heads/other").unwrap();
    let reopened = Repository::open(&root).unwrap();
    let result = finish_repository(&reopened, &plan, || Ok(())).unwrap();
    assert_eq!(result.branch.as_deref(), Some("main"));
    assert_eq!(result.head.as_deref(), Some(plan.merge_head.as_str()));
    assert_eq!(reopened.head().unwrap().name().unwrap(), "refs/heads/other");
    assert_eq!(reopened.head().unwrap().target(), Some(confirmed));
}

#[test]
fn first_template_backup_does_not_import_fetched_objects_after_the_workspace_changes() {
    let (temp, root, mut access, identity) = setup();
    let confirmed = parse_oid(&save(&mut access, &identity, "Saved composition")).unwrap();
    let local = Repository::open(&root).unwrap();
    let remote = initialize(&temp.path().join("remote.git"), "main", true).unwrap();
    let remote_root = initial_template(&remote);
    let owner_checks = Cell::new(0);
    let error = prepare_repository(
        &local,
        (remote.path().to_str().unwrap(), None),
        "main",
        confirmed,
        remote_root,
        false,
        || {
            owner_checks.set(owner_checks.get() + 1);
            if owner_checks.get() == 1 {
                return Ok(());
            }
            Err(CreationError::new(
                CreationErrorCode::InvalidIdentity,
                "Fixture workspace changed",
            ))
        },
    )
    .unwrap_err();
    assert_eq!(error.code, CreationErrorCode::InvalidIdentity);
    assert_eq!(owner_checks.get(), 2);
    assert!(!local.odb().unwrap().exists(remote_root));
    assert_eq!(local.head().unwrap().target(), Some(confirmed));
    assert_eq!(
        local
            .references_glob(&format!("{PIN_PREFIX}/*"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn first_template_backup_leaves_a_replacement_git_directory_unmodified() {
    let (temp, root, mut access, identity) = setup();
    let confirmed = parse_oid(&save(&mut access, &identity, "Saved composition")).unwrap();
    let local = Repository::open(&root).unwrap();
    let remote = initialize(&temp.path().join("remote.git"), "main", true).unwrap();
    let remote_root = initial_template(&remote);
    let owner_checks = Cell::new(0);
    let previous = temp.path().join("previous.git");
    let error = prepare_repository(
        &local,
        (remote.path().to_str().unwrap(), None),
        "main",
        confirmed,
        remote_root,
        false,
        || {
            owner_checks.set(owner_checks.get() + 1);
            if owner_checks.get() == 2 {
                fs::rename(root.join(".git"), &previous).unwrap();
                initialize(&root, "main", false).unwrap();
            }
            Ok(())
        },
    )
    .unwrap_err();
    assert_eq!(error.code, CreationErrorCode::InvalidIdentity);
    let original = Repository::open(&previous).unwrap();
    let replacement = Repository::open(&root).unwrap();
    assert_eq!(original.head().unwrap().target(), Some(confirmed));
    assert!(replacement.head().is_err());
    assert!(!original.odb().unwrap().exists(remote_root));
    assert!(!replacement.odb().unwrap().exists(remote_root));
}

#[test]
fn recovered_template_backup_prepares_and_pushes_original_version_after_saves_and_branch_switch() {
    let (temp, root, mut access, identity) = setup();
    let confirmed = parse_oid(&save(&mut access, &identity, "Initial composition")).unwrap();
    let local = Repository::open(&root).unwrap();
    local
        .branch("other", &local.find_commit(confirmed).unwrap(), false)
        .unwrap();
    fs::write(root.join("server.js"), "// later one").unwrap();
    let later_one = parse_oid(&save(&mut access, &identity, "Later one")).unwrap();
    fs::write(root.join("server.js"), "// later two").unwrap();
    let later_two = parse_oid(&save(&mut access, &identity, "Later two")).unwrap();
    local.set_head("refs/heads/other").unwrap();
    let local = Repository::open(&root).unwrap();
    let index = fs::read(local.path().join("index")).unwrap();
    let working = fs::read(root.join("server.js")).unwrap();
    let remote = initialize(&temp.path().join("remote.git"), "main", true).unwrap();
    let url = remote.path().to_str().unwrap();
    let remote_root = initial_template(&remote);

    let plan = prepare_repository(
        &local,
        (url, None),
        "main",
        confirmed,
        remote_root,
        true,
        || Ok(()),
    )
    .unwrap();
    pin_repository(&local, &plan, true, || Ok(())).unwrap();
    push_template_repository(&local, (url, None), &plan, false, || Ok(())).unwrap();
    let uploaded = remote.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(
        uploaded.parent_ids().collect::<Vec<_>>(),
        [confirmed, remote_root]
    );
    assert_eq!(
        uploaded.tree_id(),
        local.find_commit(confirmed).unwrap().tree_id()
    );
    assert!(remote.find_commit(later_one).is_err());
    assert!(remote.find_commit(later_two).is_err());

    let integrated = finish_repository(&local, &plan, || Ok(())).unwrap();
    let integrated = local
        .find_commit(parse_oid(integrated.head.as_deref().unwrap()).unwrap())
        .unwrap();
    assert_eq!(
        integrated.parent_ids().collect::<Vec<_>>(),
        [later_two, uploaded.id()]
    );
    assert_eq!(
        integrated.tree_id(),
        local.find_commit(later_two).unwrap().tree_id()
    );
    assert_eq!(local.head().unwrap().name().unwrap(), "refs/heads/other");
    assert_eq!(local.head().unwrap().target(), Some(confirmed));
    assert_eq!(fs::read(local.path().join("index")).unwrap(), index);
    assert_eq!(fs::read(root.join("server.js")).unwrap(), working);

    local.set_head("refs/heads/main").unwrap();
    let state = local_state(&local).unwrap();
    let probe = probe_repository(&local, state, url, None, false).unwrap();
    assert_eq!(probe.relation, GithubGitRelation::Ahead);
    push_repository(&local, url, None, &probe, || Ok(())).unwrap();
    assert_eq!(remote.head().unwrap().target(), Some(integrated.id()));
    assert!(remote.find_commit(later_one).is_ok());
    assert!(remote.find_commit(later_two).is_ok());
}

#[test]
fn saved_route_backup_includes_deleted_committed_files_and_only_its_history() {
    let (temp, root, mut access, identity) = setup();
    let first = parse_oid(&save(&mut access, &identity, "Initial composition")).unwrap();
    let local = Repository::open(&root).unwrap();
    local
        .branch("experiment", &local.find_commit(first).unwrap(), false)
        .unwrap();
    local.set_head("refs/heads/experiment").unwrap();
    fs::write(root.join("server.js"), "// experiment only").unwrap();
    let experiment = parse_oid(&save(&mut access, &identity, "Experiment")).unwrap();
    local.set_head("refs/heads/main").unwrap();
    fs::write(root.join("server.js"), "// first route version").unwrap();
    fs::write(root.join("published-notes.md"), "early notes").unwrap();
    let private = root.join(crate::creation_data::DIRECTORY);
    fs::create_dir(&private).unwrap();
    fs::write(private.join("materials.json"), "private resources").unwrap();
    let earlier = parse_oid(&save(&mut access, &identity, "Early notes")).unwrap();
    fs::remove_file(root.join("published-notes.md")).unwrap();
    let confirmed = parse_oid(&save(&mut access, &identity, "Delete early notes")).unwrap();
    fs::write(root.join("server.js"), "// unsaved work").unwrap();
    let remote = initialize(&temp.path().join("remote.git"), "main", true).unwrap();
    let remote_root = initial_template(&remote);
    let url = remote.path().to_str().unwrap();

    let plan = prepare_repository(
        &local,
        (url, None),
        "main",
        confirmed,
        remote_root,
        false,
        || Ok(()),
    )
    .unwrap();
    pin_repository(&local, &plan, false, || Ok(())).unwrap();
    push_template_repository(&local, (url, None), &plan, true, || Ok(())).unwrap();
    let uploaded = remote.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(
        uploaded.parent_ids().collect::<Vec<_>>(),
        [confirmed, remote_root]
    );
    let uploaded_tree = uploaded.tree().unwrap();
    assert!(uploaded_tree
        .get_path(Path::new("published-notes.md"))
        .is_err());
    let early_commit = remote.find_commit(earlier).unwrap();
    assert!(early_commit
        .tree()
        .unwrap()
        .get_name(crate::creation_data::DIRECTORY)
        .is_none());
    assert_eq!(
        fs::read_to_string(private.join("materials.json")).unwrap(),
        "private resources"
    );
    assert_eq!(
        early_commit.author().email(),
        local.find_commit(earlier).unwrap().author().email()
    );
    assert!(early_commit
        .tree()
        .unwrap()
        .get_path(Path::new("published-notes.md"))
        .is_ok());
    assert!(remote.find_commit(experiment).is_err());
    assert!(remote.find_reference("refs/heads/experiment").is_err());
    assert_eq!(
        uploaded_tree.id(),
        local.find_commit(confirmed).unwrap().tree_id()
    );
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "// unsaved work"
    );
}

#[test]
fn template_preparation_refuses_a_saved_private_history_before_importing_the_remote() {
    let (temp, root, mut access, identity) = setup();
    let initial = parse_oid(&save(&mut access, &identity, "Initial project")).unwrap();
    let local = Repository::open(&root).unwrap();
    let original = local.find_commit(initial).unwrap();
    let clean_tree = original.tree().unwrap();
    let signature = original.author();
    let mut private_tree = local.treebuilder(Some(&clean_tree)).unwrap();
    private_tree
        .insert(
            ".pnds-creation",
            local.blob(b"private material").unwrap(),
            0o100644,
        )
        .unwrap();
    let private = local
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            "External private commit",
            &local.find_tree(private_tree.write().unwrap()).unwrap(),
            &[&original],
        )
        .unwrap();
    let private_commit = local.find_commit(private).unwrap();
    let clean = local
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            "Remove private file",
            &clean_tree,
            &[&private_commit],
        )
        .unwrap();
    let remote = initialize(&temp.path().join("remote.git"), "main", true).unwrap();
    let remote_root = initial_template(&remote);
    let url = remote.path().to_str().unwrap();
    let error = prepare_repository(
        &local,
        (url, None),
        "main",
        clean,
        remote_root,
        false,
        || Ok(()),
    )
    .unwrap_err();
    assert_eq!(error.code, CreationErrorCode::PrivateGitHistory);
    assert_eq!(remote.head().unwrap().target(), Some(remote_root));
    assert_eq!(local.head().unwrap().target(), Some(clean));
    assert!(local.find_commit(remote_root).is_err());
}
