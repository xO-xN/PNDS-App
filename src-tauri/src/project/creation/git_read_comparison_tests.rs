//! Comparison publication is owned by a request, independently of its content token.
use super::git_read::GitReadJob;
use super::git_versions_tests::{save, setup};
use super::*;
use std::os::unix::fs::PermissionsExt;

fn saved(commit: &str) -> GitComparisonRequest {
    GitComparisonRequest {
        commit: Some(commit.into()),
        mode: GitComparisonMode::Saved,
        parent: None,
    }
}

fn file(token: &str, path: &str) -> GitComparisonFileRequest {
    GitComparisonFileRequest {
        token: token.into(),
        path: path.into(),
        full_context: false,
    }
}

fn build(access: &mut CreationAccess, identity: &str, commit: &str) -> GitComparison {
    let output = access
        .prepare_git_comparison(identity, saved(commit), &Protection::default())
        .unwrap()
        .run(&GitReader::default());
    access
        .finish_git_read(output, &Protection::default())
        .unwrap()
}

fn read(access: &mut CreationAccess, identity: &str, token: &str) -> GitComparisonDiff {
    let output = access
        .prepare_git_comparison_file(identity, &file(token, "server.js"), &Protection::default())
        .unwrap()
        .run(&GitReader::default());
    access
        .finish_git_read(output, &Protection::default())
        .unwrap()
}

#[test]
fn an_older_comparison_cannot_replace_a_newer_published_session() {
    let (_temp, root, mut access, identity) = setup();
    let commit = save(&mut access, &identity, "Base");
    fs::write(root.join("server.js"), "currentSaved();\n").unwrap();
    let older = access
        .prepare_git_comparison(&identity, saved(&commit), &Protection::default())
        .unwrap();
    let current = build(&mut access, &identity, &commit);
    let error = access
        .finish_git_read(older.run(&GitReader::default()), &Protection::default())
        .unwrap_err();
    assert_eq!(error.code, CreationErrorCode::VersionConflict);
    let actual = read(&mut access, &identity, &current.token);
    assert!(actual
        .hunks
        .iter()
        .flat_map(|hunk| &hunk.lines)
        .any(|line| {
            matches!(line.kind, GitComparisonLineKind::Addition)
                && line.content == "currentSaved();"
        }));
}

#[test]
fn an_older_failed_worker_cannot_clear_a_newer_session_or_publish_its_error() {
    let (_temp, _root, mut access, identity) = setup();
    let commit = save(&mut access, &identity, "Base");
    let older = access
        .prepare_git_comparison(
            &identity,
            GitComparisonRequest {
                commit: Some(commit.clone()),
                mode: GitComparisonMode::Parent,
                parent: Some("0".repeat(40)),
            },
            &Protection::default(),
        )
        .unwrap();
    let current = build(&mut access, &identity, &commit);
    let error = access
        .finish_git_read(older.run(&GitReader::default()), &Protection::default())
        .unwrap_err();
    assert_eq!(error.code, CreationErrorCode::VersionConflict);
    assert_eq!(
        read(&mut access, &identity, &current.token).token,
        current.token
    );
}

#[test]
fn identical_content_tokens_do_not_allow_old_file_results_into_a_new_session() {
    let (_temp, root, mut access, identity) = setup();
    let commit = save(&mut access, &identity, "Base");
    fs::write(root.join("server.js"), "savedNow();\n").unwrap();
    let first = build(&mut access, &identity, &commit);
    let older_file = access
        .prepare_git_comparison_file(
            &identity,
            &file(&first.token, "server.js"),
            &Protection::default(),
        )
        .unwrap();
    let second = build(&mut access, &identity, &commit);
    assert_eq!(first.token, second.token);
    let error = access
        .finish_git_read(
            older_file.run(&GitReader::default()),
            &Protection::default(),
        )
        .unwrap_err();
    assert_eq!(error.code, CreationErrorCode::VersionConflict);
    assert_eq!(
        read(&mut access, &identity, &second.token).token,
        second.token
    );
}

#[test]
fn files_in_one_comparison_can_run_in_parallel_without_retiring_each_other() {
    let (_temp, root, mut access, identity) = setup();
    fs::write(root.join("first.js"), "oldFirst();\n").unwrap();
    fs::write(root.join("second.js"), "oldSecond();\n").unwrap();
    let commit = save(&mut access, &identity, "Base");
    fs::write(root.join("first.js"), "newFirst();\n").unwrap();
    fs::write(root.join("second.js"), "newSecond();\n").unwrap();
    let comparison = build(&mut access, &identity, &commit);
    let jobs: Vec<_> = ["first.js", "second.js"]
        .into_iter()
        .map(|path| {
            access
                .prepare_git_comparison_file(
                    &identity,
                    &file(&comparison.token, path),
                    &Protection::default(),
                )
                .unwrap()
        })
        .collect();
    let workers: Vec<_> = jobs
        .into_iter()
        .map(|job| std::thread::spawn(move || job.run(&GitReader::default())))
        .collect();
    for worker in workers {
        let diff = access
            .finish_git_read(worker.join().unwrap(), &Protection::default())
            .unwrap();
        assert_eq!(diff.token, comparison.token);
        assert_eq!((diff.added, diff.deleted), (1, 1));
    }
}

#[test]
fn file_workers_recheck_saved_bytes_mode_and_presence_after_preparation() {
    for mutation in ["same-length bytes", "executable mode", "deleted file"] {
        let (_temp, root, mut access, identity) = setup();
        let commit = save(&mut access, &identity, "Base");
        let path = root.join("server.js");
        fs::write(&path, "savedA();\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        let comparison = build(&mut access, &identity, &commit);
        let job = access
            .prepare_git_comparison_file(
                &identity,
                &file(&comparison.token, "server.js"),
                &Protection::default(),
            )
            .unwrap();
        match mutation {
            "same-length bytes" => fs::write(&path, "savedB();\n").unwrap(),
            "executable mode" => {
                fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap()
            }
            "deleted file" => fs::remove_file(&path).unwrap(),
            _ => unreachable!(),
        }
        let error = access
            .finish_git_read(job.run(&GitReader::default()), &Protection::default())
            .unwrap_err();
        assert_eq!(error.code, CreationErrorCode::VersionConflict, "{mutation}");
    }
}

#[test]
fn a_deleted_saved_file_that_reappears_after_preparation_rejects_the_comparison() {
    let (_temp, root, mut access, identity) = setup();
    fs::write(root.join("removed.js"), "old();\n").unwrap();
    let commit = save(&mut access, &identity, "Base");
    fs::remove_file(root.join("removed.js")).unwrap();
    let comparison = build(&mut access, &identity, &commit);
    let job = access
        .prepare_git_comparison_file(
            &identity,
            &file(&comparison.token, "removed.js"),
            &Protection::default(),
        )
        .unwrap();
    fs::write(root.join("removed.js"), "appeared();\n").unwrap();
    let error = access
        .finish_git_read(job.run(&GitReader::default()), &Protection::default())
        .unwrap_err();
    assert_eq!(error.code, CreationErrorCode::VersionConflict);
}

#[test]
fn a_current_failed_comparison_does_not_revive_the_previous_session() {
    let (_temp, _root, mut access, identity) = setup();
    let commit = save(&mut access, &identity, "Base");
    let previous = build(&mut access, &identity, &commit);
    let failed = access
        .prepare_git_comparison(
            &identity,
            GitComparisonRequest {
                commit: Some(commit),
                mode: GitComparisonMode::Parent,
                parent: Some("0".repeat(40)),
            },
            &Protection::default(),
        )
        .unwrap();
    assert_eq!(
        access
            .finish_git_read(failed.run(&GitReader::default()), &Protection::default())
            .unwrap_err()
            .code,
        CreationErrorCode::TestValidation
    );
    assert_eq!(
        access
            .prepare_git_comparison_file(
                &identity,
                &file(&previous.token, "server.js"),
                &Protection::default(),
            )
            .err()
            .unwrap()
            .code,
        CreationErrorCode::VersionConflict
    );
}
