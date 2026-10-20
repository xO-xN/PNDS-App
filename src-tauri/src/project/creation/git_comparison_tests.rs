use super::tests::project;
use super::*;
fn save(access: &mut CreationAccess, identity: &str) -> String {
    let preview = access
        .preview_git_record(identity, &Protection::default())
        .unwrap();
    access
        .confirm_git_record(
            identity,
            &preview.token,
            GitRecordRequest {
                paths: preview
                    .files
                    .iter()
                    .filter(|f| f.default_selected)
                    .map(|f| f.path.clone())
                    .collect(),
                name: "Creator".into(),
                email: "creator@pnds.local".into(),
                message: "Version".into(),
            },
            &Protection::default(),
        )
        .unwrap()
        .commit
}
fn read(access: &CreationAccess, id: &str, token: &str, path: &str) -> GitComparisonDiff {
    access
        .git_comparison_file(
            id,
            &GitComparisonFileRequest {
                token: token.into(),
                path: path.into(),
                full_context: false,
            },
            &Protection::default(),
        )
        .unwrap()
}
#[test]
fn compares_parent_to_selected_with_real_lines_and_missing_files_without_mutation() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "compare");
    fs::write(root.join("server.js"), "const size = 12;\nkeep();\n").unwrap();
    fs::write(root.join("removed.js"), "removed();\n").unwrap();
    let mut access = CreationAccess::default();
    let id = access
        .open(&root, &Protection::default())
        .unwrap()
        .project
        .identity;
    let first = save(&mut access, &id);
    fs::write(root.join("server.js"), "const size = 24;\nkeep();\n").unwrap();
    fs::remove_file(root.join("removed.js")).unwrap();
    fs::write(root.join("added.js"), "added();\n").unwrap();
    let second = save(&mut access, &id);
    fs::write(root.join("server.js"), "unsavedToGit();\n").unwrap();
    let head = fs::read(root.join(".git/HEAD")).unwrap();
    let index = fs::read(root.join(".git/index")).unwrap();
    let comparison = access
        .git_comparison(
            &id,
            GitComparisonRequest {
                commit: Some(second.clone()),
                mode: GitComparisonMode::Parent,
                parent: None,
            },
            &Protection::default(),
        )
        .unwrap();
    assert_eq!(comparison.before.commit.as_deref(), Some(first.as_str()));
    assert_eq!(comparison.after.commit.as_deref(), Some(second.as_str()));
    assert_eq!(
        comparison
            .files
            .iter()
            .find(|f| f.path == "removed.js")
            .unwrap()
            .status,
        GitComparisonStatus::Deleted
    );
    let diff = read(&access, &id, &comparison.token, "server.js");
    assert_eq!((diff.added, diff.deleted), (1, 1));
    assert!(diff.hunks[0]
        .lines
        .iter()
        .any(|line| line.old_line == Some(1) && line.content == "const size = 12;"));
    assert!(diff.hunks[0]
        .lines
        .iter()
        .any(|line| line.new_line == Some(1) && line.content == "const size = 24;"));
    assert_eq!(
        read(&access, &id, &comparison.token, "removed.js").deleted,
        1
    );
    assert_eq!(read(&access, &id, &comparison.token, "added.js").added, 1);
    assert_eq!(fs::read(root.join(".git/HEAD")).unwrap(), head);
    assert_eq!(fs::read(root.join(".git/index")).unwrap(), index);
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "unsavedToGit();\n"
    );
}
#[test]
fn saved_comparison_reads_disk_and_rejects_stale_bytes_tokens_and_paths() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "saved");
    let mut access = CreationAccess::default();
    let id = access
        .open(&root, &Protection::default())
        .unwrap()
        .project
        .identity;
    let commit = save(&mut access, &id);
    fs::write(root.join("server.js"), "savedCode();\n").unwrap();
    let request = GitComparisonRequest {
        commit: Some(commit),
        mode: GitComparisonMode::Saved,
        parent: None,
    };
    let comparison = access
        .git_comparison(&id, request.clone(), &Protection::default())
        .unwrap();
    assert!(comparison.after.saved);
    assert!(read(&access, &id, &comparison.token, "server.js")
        .hunks
        .iter()
        .flat_map(|h| &h.lines)
        .any(|l| l.content == "savedCode();"));
    fs::write(root.join("server.js"), "newerCode();\n").unwrap();
    let file = GitComparisonFileRequest {
        token: comparison.token.clone(),
        path: "server.js".into(),
        full_context: false,
    };
    assert_eq!(
        access
            .git_comparison_file(&id, &file, &Protection::default())
            .unwrap_err()
            .code,
        CreationErrorCode::VersionConflict
    );
    let fresh = access
        .git_comparison(&id, request, &Protection::default())
        .unwrap();
    assert_ne!(fresh.token, comparison.token);
    assert!(access
        .git_comparison_file(&id, &file, &Protection::default())
        .is_err());
    for path in ["../outside.js", ".env", "node_modules/test.js"] {
        assert_eq!(
            access
                .git_comparison_file(
                    &id,
                    &GitComparisonFileRequest {
                        token: fresh.token.clone(),
                        path: path.into(),
                        full_context: false
                    },
                    &Protection::default()
                )
                .unwrap_err()
                .code,
            CreationErrorCode::PathEscape
        );
    }
}
#[test]
fn initial_binary_and_large_files_are_explicit_and_private_files_are_excluded() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "initial");
    fs::write(root.join("image.png"), [0u8, 1, 2]).unwrap();
    fs::write(
        root.join("large.js"),
        vec![b'x'; TEXT_MAX_BYTES as usize + 1],
    )
    .unwrap();
    fs::write(root.join(".env"), "private").unwrap();
    let mut access = CreationAccess::default();
    let id = access
        .open(&root, &Protection::default())
        .unwrap()
        .project
        .identity;
    let commit = save(&mut access, &id);
    let comparison = access
        .git_comparison(
            &id,
            GitComparisonRequest {
                commit: Some(commit.clone()),
                mode: GitComparisonMode::Parent,
                parent: None,
            },
            &Protection::default(),
        )
        .unwrap();
    assert!(comparison.before.commit.is_none());
    assert!(comparison
        .files
        .iter()
        .all(|f| f.status == GitComparisonStatus::Added));
    assert!(!comparison.files.iter().any(|f| f.path == ".env"));
    assert!(matches!(
        read(&access, &id, &comparison.token, "image.png").reason,
        Some(GitHistoryReason::Binary)
    ));
    assert!(matches!(
        read(&access, &id, &comparison.token, "large.js").reason,
        Some(GitHistoryReason::TooLarge)
    ));
    assert!(access
        .git_comparison(
            &id,
            GitComparisonRequest {
                commit: Some(commit),
                mode: GitComparisonMode::Parent,
                parent: Some("0".repeat(40))
            },
            &Protection::default()
        )
        .is_err());
}
#[test]
fn saved_symbolic_paths_never_read_external_content() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "symlink");
    let mut access = CreationAccess::default();
    let id = access
        .open(&root, &Protection::default())
        .unwrap()
        .project
        .identity;
    save(&mut access, &id);
    fs::write(temp.path().join("external.js"), "private external").unwrap();
    symlink(temp.path().join("external.js"), root.join("alias.js")).unwrap();
    assert!(access
        .git_comparison(
            &id,
            GitComparisonRequest {
                commit: None,
                mode: GitComparisonMode::Saved,
                parent: None
            },
            &Protection::default()
        )
        .is_err());
}

#[test]
fn saved_comparison_keeps_separate_hunks_and_explicit_missing_newlines() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "hunks");
    let original = (0..40)
        .map(|index| format!("line {index}\n"))
        .collect::<String>();
    fs::write(root.join("server.js"), &original).unwrap();
    let mut access = CreationAccess::default();
    let id = access
        .open(&root, &Protection::default())
        .unwrap()
        .project
        .identity;
    save(&mut access, &id);
    fs::write(
        root.join("server.js"),
        original
            .replace("line 1\n", "early\n")
            .replace("line 39\n", "末尾"),
    )
    .unwrap();
    let comparison = access
        .git_comparison(
            &id,
            GitComparisonRequest {
                commit: None,
                mode: GitComparisonMode::Saved,
                parent: None,
            },
            &Protection::default(),
        )
        .unwrap();
    let diff = read(&access, &id, &comparison.token, "server.js");
    assert_eq!(diff.hunks.len(), 2);
    assert!(diff.hunks[1]
        .lines
        .iter()
        .any(|line| line.no_newline && line.content == "末尾"));
    let expanded = access
        .git_comparison_file(
            &id,
            &GitComparisonFileRequest {
                token: comparison.token,
                path: "server.js".into(),
                full_context: true,
            },
            &Protection::default(),
        )
        .unwrap();
    assert_eq!(expanded.hunks.len(), 1);
    assert_eq!((expanded.added, expanded.deleted), (2, 2));
}

#[test]
fn merge_comparison_uses_first_parent_by_default_and_accepts_only_actual_parents() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "merge");
    let mut access = CreationAccess::default();
    let id = access
        .open(&root, &Protection::default())
        .unwrap()
        .project
        .identity;
    let first = save(&mut access, &id);
    fs::write(root.join("server.js"), "second();\n").unwrap();
    let second = save(&mut access, &id);
    let repo = git2::Repository::open(&root).unwrap();
    let first = repo
        .find_commit(git2::Oid::from_str(&first).unwrap())
        .unwrap();
    let second = repo
        .find_commit(git2::Oid::from_str(&second).unwrap())
        .unwrap();
    let signature = git2::Signature::now("Creator", "creator@pnds.local").unwrap();
    let merge = repo
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            "Merge",
            &second.tree().unwrap(),
            &[&second, &first],
        )
        .unwrap();
    let comparison = access
        .git_comparison(
            &id,
            GitComparisonRequest {
                commit: Some(merge.to_string()),
                mode: GitComparisonMode::Parent,
                parent: None,
            },
            &Protection::default(),
        )
        .unwrap();
    assert_eq!(comparison.before.commit, Some(second.id().to_string()));
    assert!(comparison
        .files
        .iter()
        .all(|file| file.status == GitComparisonStatus::Unchanged));
    let comparison = access
        .git_comparison(
            &id,
            GitComparisonRequest {
                commit: Some(merge.to_string()),
                mode: GitComparisonMode::Parent,
                parent: Some(first.id().to_string()),
            },
            &Protection::default(),
        )
        .unwrap();
    assert_eq!(comparison.before.commit, Some(first.id().to_string()));
    assert!(comparison
        .files
        .iter()
        .any(|file| file.path == "server.js" && file.status == GitComparisonStatus::Modified));
}

#[test]
fn parent_repository_catalog_is_scoped_to_the_open_project() {
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
    let mut access = CreationAccess::default();
    let id = access
        .open(&root, &Protection::default())
        .unwrap()
        .project
        .identity;
    let comparison = access
        .git_comparison(
            &id,
            GitComparisonRequest {
                commit: Some(commit.to_string()),
                mode: GitComparisonMode::Parent,
                parent: None,
            },
            &Protection::default(),
        )
        .unwrap();
    assert!(comparison.files.iter().any(|file| file.path == "server.js"));
    assert!(!comparison
        .files
        .iter()
        .any(|file| file.path.contains("outside") || file.path.starts_with("nested/")));
    fs::write(root.join("server.js"), "nestedSaved();\n").unwrap();
    let saved = access
        .git_comparison(
            &id,
            GitComparisonRequest {
                commit: None,
                mode: GitComparisonMode::Saved,
                parent: None,
            },
            &Protection::default(),
        )
        .unwrap();
    assert_eq!(read(&access, &id, &saved.token, "server.js").added, 1);
}
