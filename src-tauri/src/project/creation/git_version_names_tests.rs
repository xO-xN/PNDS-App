use super::git_versions_tests::{save, setup};
use super::*;
use git2::Repository;

#[test]
fn unnamed_saves_follow_the_current_series_even_when_history_exceeds_the_page_limit() {
    let (_temp, root, mut access, id) = setup();
    let protection = Protection::default();
    let first = save(&mut access, &id, "Starting point");
    let repo = Repository::open(&root).unwrap();
    let first = repo.find_commit(first.parse().unwrap()).unwrap();
    let tree = first.tree().unwrap();
    let signature = repo.signature().unwrap();

    // These two older changes exceed one page's combined path budget. The
    // current index and working tree stay small enough to record normally.
    let blob = repo.blob(b"historical file").unwrap();
    let mut expanded = repo.treebuilder(Some(&tree)).unwrap();
    for index in 0..=(MAX_ENTRIES / 2) {
        expanded
            .insert(format!("old-{index}.txt"), blob, 0o100644)
            .unwrap();
    }
    let expanded = repo.find_tree(expanded.write().unwrap()).unwrap();
    let commit = |reference, message, tree: &git2::Tree<'_>, parent| {
        repo.commit(reference, &signature, &signature, message, tree, &[parent])
            .unwrap()
    };
    let older = commit(Some("HEAD"), "Added files", &expanded, &first);
    let older = repo.find_commit(older).unwrap();
    let current = commit(Some("HEAD"), "Removed files", &tree, &older);
    let other = commit(None, "流动 1", &tree, &first);
    repo.branch("experiment", &repo.find_commit(other).unwrap(), false)
        .unwrap();
    access
        .rename_git_version(
            &id,
            &current.to_string(),
            "Removed files",
            "流动",
            &protection,
        )
        .unwrap();
    assert_eq!(
        access
            .git_version_graph(&id, 0, &protection)
            .unwrap_err()
            .detail,
        "Version page is too large"
    );

    let mut parent = current;
    for (index, name) in [(2, "   "), (3, "")] {
        if index == 3 {
            for route in 0..128 {
                repo.branch(&format!("route-{route:03}"), &first, false)
                    .unwrap();
            }
            assert!(access
                .git_version_graph(&id, 0, &protection)
                .unwrap_err()
                .detail
                .contains("More than 128 local branches"));
        }
        fs::write(root.join("server.js"), format!("// edit {index}")).unwrap();
        let preview = access.preview_git_record(&id, &protection).unwrap();
        let receipt = access
            .confirm_git_record_named(
                &id,
                &preview.token,
                GitRecordRequest {
                    paths: vec!["server.js".into()],
                    name: "Creator".into(),
                    email: "".into(),
                    message: name.into(),
                },
                None,
                &protection,
            )
            .unwrap();
        let expected = format!("流动 {index}");
        assert_eq!(receipt.message, expected);
        assert!(receipt.warning.is_none());
        let saved = repo.find_commit(receipt.commit.parse().unwrap()).unwrap();
        assert_eq!(saved.message().unwrap(), expected);
        assert_eq!(saved.parent_id(0).unwrap(), parent);
        parent = saved.id();
    }
    assert!(access.git_version_graph(&id, 0, &protection).is_err());
}

#[test]
fn display_rename_survives_reopen_without_rewriting_commits_files_or_index() {
    let (_temp, root, mut access, id) = setup();
    let first = save(&mut access, &id, "呼吸");
    fs::write(root.join("server.js"), "// second").unwrap();
    let second = save(&mut access, &id, "呼吸 1");
    let repo = Repository::open(&root).unwrap();
    let old = repo
        .find_commit(git2::Oid::from_str(&first).unwrap())
        .unwrap();
    let tree = old.tree_id();
    let index = fs::read(root.join(".git/index")).unwrap();
    let files = fs::read(root.join("server.js")).unwrap();
    access
        .rename_git_version(&id, &first, "呼吸", "早期实验", &Protection::default())
        .unwrap();
    assert_eq!(repo.head().unwrap().target().unwrap().to_string(), second);
    assert_eq!(repo.find_commit(old.id()).unwrap().tree_id(), tree);
    assert_eq!(
        repo.find_commit(old.id()).unwrap().message().unwrap(),
        "呼吸"
    );
    assert_eq!(fs::read(root.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(root.join("server.js")).unwrap(), files);
    let reopened = access
        .open(&root, &Protection::default())
        .unwrap()
        .project
        .identity;
    let graph = access
        .git_version_graph(&reopened, 0, &Protection::default())
        .unwrap();
    assert_eq!(
        graph
            .versions
            .iter()
            .find(|v| v.id == first)
            .unwrap()
            .message,
        "早期实验"
    );
    assert_eq!(graph.next_name.as_deref(), Some("呼吸 2"));
    let history = access
        .git_history(&reopened, &Protection::default())
        .unwrap();
    assert_eq!(
        history
            .commits
            .iter()
            .find(|v| v.id == first)
            .unwrap()
            .message,
        "早期实验"
    );
    let request = GitComparisonRequest {
        commit: Some(second),
        mode: GitComparisonMode::Parent,
        parent: None,
    };
    let comparison = access
        .git_comparison(&reopened, request, &Protection::default())
        .unwrap();
    assert_eq!(comparison.before.message.as_deref(), Some("早期实验"));
}

#[test]
fn series_continues_from_head_and_skips_names_on_other_routes_after_renaming() {
    let (_temp, root, mut access, id) = setup();
    let first = save(&mut access, &id, "呼吸");
    assert_eq!(
        access
            .git_version_graph(&id, 0, &Protection::default())
            .unwrap()
            .next_name
            .as_deref(),
        Some("呼吸 1")
    );
    fs::write(root.join("server.js"), "// second").unwrap();
    let second = save(&mut access, &id, "呼吸 1");
    fs::write(root.join("server.js"), "// third").unwrap();
    let third = save(&mut access, &id, "呼吸 2");
    assert_eq!(
        access
            .git_version_graph(&id, 0, &Protection::default())
            .unwrap()
            .next_name
            .as_deref(),
        Some("呼吸 3")
    );
    access
        .rename_git_version(&id, &third, "呼吸 2", "流动", &Protection::default())
        .unwrap();
    assert_eq!(
        access
            .git_version_graph(&id, 0, &Protection::default())
            .unwrap()
            .next_name
            .as_deref(),
        Some("流动 1")
    );
    access
        .rename_git_version(&id, &second, "呼吸 1", "流动 1", &Protection::default())
        .unwrap();
    assert_eq!(
        access
            .git_version_graph(&id, 0, &Protection::default())
            .unwrap()
            .next_name
            .as_deref(),
        Some("流动 2")
    );
    let repo = Repository::open(&root).unwrap();
    // Fixture-only checkout: product checkout retains its independent protection workflow.
    repo.set_head_detached(git2::Oid::from_str(&first).unwrap())
        .unwrap();
    assert_eq!(
        access
            .git_version_graph(&id, 0, &Protection::default())
            .unwrap()
            .next_name
            .as_deref(),
        Some("呼吸 1")
    );
    let object = repo
        .find_object(git2::Oid::from_str(&first).unwrap(), None)
        .unwrap();
    repo.reset(&object, git2::ResetType::Hard, None).unwrap();
    fs::write(root.join("server.js"), "// new route").unwrap();
    save(&mut access, &id, "呼吸 1");
    assert_eq!(
        access
            .git_version_graph(&id, 0, &Protection::default())
            .unwrap()
            .next_name
            .as_deref(),
        Some("呼吸 2")
    );
}

#[test]
fn rename_rejects_stale_names_invalid_names_unreachable_objects_and_old_identity() {
    let (_temp, root, mut access, id) = setup();
    let first = save(&mut access, &id, "Name");
    access
        .rename_git_version(&id, &first, "Name", "Renamed", &Protection::default())
        .unwrap();
    let changed = access
        .rename_git_version(&id, &first, "Name", "Overwrite", &Protection::default())
        .unwrap_err();
    assert_eq!(changed.code, CreationErrorCode::VersionConflict);
    for name in ["", "  ", "bad\nname", &"x".repeat(121)] {
        assert!(access
            .rename_git_version(&id, &first, "Renamed", name, &Protection::default())
            .is_err());
    }
    assert!(access
        .rename_git_version(&id, &"0".repeat(40), "Name", "No", &Protection::default())
        .is_err());
    let second_root = super::tests::project(root.parent().unwrap(), "other");
    access.open(&second_root, &Protection::default()).unwrap();
    assert!(access
        .rename_git_version(
            &id,
            &first,
            "Renamed",
            "Wrong project",
            &Protection::default()
        )
        .is_err());
}
