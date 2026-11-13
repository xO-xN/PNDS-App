use super::*;
use crate::project::creation::git_versions_tests::{save, setup};

fn initial_template(repo: &Repository) -> Oid {
    let tree = repo.treebuilder(None).unwrap().write().unwrap();
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
        || Ok(()),
    )
    .unwrap();
    let merge = parse_oid(&plan.merge_head).unwrap();
    assert!(local.find_reference(&pin_name(merge)).is_err());
    let local = Repository::open(&root).unwrap();
    pin_repository(&local, &plan, || Ok(())).unwrap();
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
    let plan = prepare_repository(&local, (url, None), "main", confirmed, remote_root, || {
        Ok(())
    })
    .unwrap();
    let local = Repository::open(&root).unwrap();
    pin_repository(&local, &plan, || Ok(())).unwrap();
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
    let plan = prepare_repository(&local, (url, None), "main", confirmed, remote_root, || {
        Ok(())
    })
    .unwrap();
    let local = Repository::open(&root).unwrap();
    pin_repository(&local, &plan, || Ok(())).unwrap();
    push_template_repository(&local, (url, None), &plan, true, || Ok(())).unwrap();
    local.set_head("refs/heads/other").unwrap();
    let reopened = Repository::open(&root).unwrap();
    let result = finish_repository(&reopened, &plan, || Ok(())).unwrap();
    assert_eq!(result.branch.as_deref(), Some("main"));
    assert_eq!(result.head.as_deref(), Some(plan.merge_head.as_str()));
    assert_eq!(reopened.head().unwrap().name().unwrap(), "refs/heads/other");
    assert_eq!(reopened.head().unwrap().target(), Some(confirmed));
}
