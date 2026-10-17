use super::git::{GitDiffState, GitState};
use super::tests::project;
use super::*;
use std::process::Command;

fn git(root: &Path, args: &[&str]) -> Vec<u8> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

#[test]
fn git_status_reads_only_the_open_project_inside_a_larger_repository() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    git(temp.path(), &["init", "-b", "main"]);
    fs::write(temp.path().join("outside.txt"), "outside base\n").unwrap();
    git(temp.path(), &["add", "."]);
    git(
        temp.path(),
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-m",
            "base",
        ],
    );
    fs::write(root.join("server.js"), "staged change\n").unwrap();
    git(temp.path(), &["add", "score/server.js"]);
    fs::write(root.join("server.js"), "disk change\n").unwrap();
    fs::write(root.join("new file.txt"), "new content\n").unwrap();
    fs::write(temp.path().join("outside.txt"), "private outside change\n").unwrap();
    let before = git(temp.path(), &["status", "--porcelain=v1", "-z"]);
    let index = fs::read(temp.path().join(".git/index")).unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let output = access
        .prepare_git_status(&identity, &protection)
        .unwrap()
        .run(&GitReader::default());
    let status = access.finish_git_status(output, &protection).unwrap();
    assert_eq!(status.state, GitState::Available);
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!(status.head.as_deref().unwrap().len(), 40);
    assert_eq!(status.changes.len(), 2);
    let tracked = status
        .changes
        .iter()
        .find(|file| file.path == "server.js")
        .unwrap();
    assert!(tracked.staged && tracked.unstaged && !tracked.untracked);
    assert!(status
        .changes
        .iter()
        .any(|file| file.path == "new file.txt" && file.untracked));
    assert_eq!(
        git(temp.path(), &["status", "--porcelain=v1", "-z"]),
        before
    );
    assert_eq!(fs::read(temp.path().join(".git/index")).unwrap(), index);
}

#[test]
fn git_inspection_keeps_partial_clone_objects_index_and_working_files_unchanged() {
    use std::os::unix::fs::PermissionsExt;

    fn snapshot(root: &Path) -> std::collections::BTreeMap<PathBuf, Vec<u8>> {
        fn collect(
            root: &Path,
            directory: &Path,
            files: &mut std::collections::BTreeMap<PathBuf, Vec<u8>>,
        ) {
            for entry in fs::read_dir(directory).unwrap() {
                let entry = entry.unwrap();
                let path = entry.path();
                if entry.file_type().unwrap().is_dir() {
                    collect(root, &path, files);
                } else {
                    files.insert(
                        path.strip_prefix(root).unwrap().to_owned(),
                        fs::read(path).unwrap(),
                    );
                }
            }
        }
        let mut files = std::collections::BTreeMap::new();
        collect(root, root, &mut files);
        files
    }

    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    fs::create_dir(&source).unwrap();
    let source_project = project(&source, "score");
    fs::write(source_project.join("server.js"), "original\n").unwrap();
    git(&source, &["init", "-b", "main"]);
    git(&source, &["add", "."]);
    git(
        &source,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-m",
            "base",
        ],
    );
    git(&source, &["config", "uploadpack.allowFilter", "true"]);
    let remote = format!("file://{}", source.display());
    git(
        temp.path(),
        &[
            "clone",
            "--filter=blob:none",
            "--no-checkout",
            &remote,
            "clone",
        ],
    );
    let repository = temp.path().join("clone");
    // Populate the index and ordinary project files without asking Git to
    // checkout/hydrate the deliberately missing blobs.
    git(&repository, &["read-tree", "HEAD"]);
    let root = project(&repository, "score");
    fs::write(root.join("server.js"), "modified\n").unwrap();
    assert_eq!(
        git(&repository, &["config", "remote.origin.promisor"]),
        b"true\n"
    );
    let missing = git(
        &repository,
        &["rev-list", "--objects", "--all", "--missing=print"],
    );
    assert!(missing
        .split(|byte| *byte == b'\n')
        .any(|line| line.starts_with(b"?")));
    let marker = temp.path().join("transport-helper-ran");
    let helper = temp.path().join("upload-pack-helper");
    fs::write(
        &helper,
        format!(
            "#!/bin/sh\ntouch '{}'\nexec '{}' upload-pack \"$@\"\n",
            marker.display(),
            "git",
        ),
    )
    .unwrap();
    fs::set_permissions(&helper, fs::Permissions::from_mode(0o755)).unwrap();
    git(
        &repository,
        &[
            "config",
            "remote.origin.uploadpack",
            helper.to_str().unwrap(),
        ],
    );
    let before = snapshot(&repository);
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let output = access
        .prepare_git_status(&identity, &protection)
        .unwrap()
        .run(&GitReader::default());
    let status = access.finish_git_status(output, &protection).unwrap();
    let output = access
        .prepare_git_diff(&identity, "server.js", GitDiffLayer::Unstaged, &protection)
        .unwrap()
        .run(&GitReader::default());
    let diff = access.finish_git_diff(output, &protection).unwrap();
    assert!(access.git_history(&identity, &protection).is_err());
    assert!(access
        .git_history_file(
            &identity,
            status
                .head
                .as_deref()
                .unwrap_or("0000000000000000000000000000000000000000"),
            "server.js",
            &protection
        )
        .is_err());
    assert!(access.preview_git_record(&identity, &protection).is_err());
    let after = snapshot(&repository);
    assert_eq!(
        after.keys().collect::<Vec<_>>(),
        before.keys().collect::<Vec<_>>()
    );
    for (path, bytes) in before {
        assert!(after[&path] == bytes, "Git inspection changed {path:?}");
    }
    assert!(!marker.exists(), "Git inspection ran the transport helper");
    assert_eq!(status.state, GitState::Unreadable);
    assert_eq!(diff.state, GitDiffState::Unreadable);
    assert!(status.detail.as_deref().unwrap().contains("partial clone"));
    assert!(diff.detail.as_deref().unwrap().contains("partial clone"));
}

#[test]
fn git_diff_separates_head_index_and_disk_without_returning_outside_content() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    git(temp.path(), &["init", "-b", "main"]);
    fs::write(root.join("server.js"), "HEAD content\n").unwrap();
    fs::write(temp.path().join("private.txt"), "outside secret\n").unwrap();
    git(temp.path(), &["add", "."]);
    git(
        temp.path(),
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-m",
            "base",
        ],
    );
    fs::write(root.join("server.js"), "index content\n").unwrap();
    git(temp.path(), &["add", "score/server.js"]);
    fs::write(root.join("server.js"), "disk content\n").unwrap();
    fs::write(root.join("fresh.txt"), "fresh text\n").unwrap();
    fs::rename(temp.path().join("private.txt"), root.join("moved.txt")).unwrap();
    git(temp.path(), &["add", "."]);
    // Reintroduce separate working-tree text after staging the cross-boundary move.
    fs::write(root.join("server.js"), "later disk content\n").unwrap();
    let index = fs::read(temp.path().join(".git/index")).unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    for (layer, removed, added) in [
        (GitDiffLayer::Staged, "HEAD content", "disk content"),
        (GitDiffLayer::Unstaged, "disk content", "later disk content"),
    ] {
        let output = access
            .prepare_git_diff(&identity, "server.js", layer, &protection)
            .unwrap()
            .run(&GitReader::default());
        let diff = access.finish_git_diff(output, &protection).unwrap();
        assert_eq!(diff.state, GitDiffState::Text);
        let text = diff.text.unwrap();
        assert!(text.contains(&format!("-{removed}")) && text.contains(&format!("+{added}")));
        assert!(!text.contains("outside secret"));
    }
    let output = access
        .prepare_git_diff(&identity, "moved.txt", GitDiffLayer::Staged, &protection)
        .unwrap()
        .run(&GitReader::default());
    let text = access
        .finish_git_diff(output, &protection)
        .unwrap()
        .text
        .unwrap();
    assert!(!text.contains("private.txt"));
    assert!(text.contains("+outside secret")); // now a file belonging to this project
    assert_eq!(
        access
            .prepare_git_diff(
                &identity,
                "../private.txt",
                GitDiffLayer::Staged,
                &protection
            )
            .err()
            .unwrap()
            .code,
        CreationErrorCode::PathEscape
    );
    assert_eq!(fs::read(temp.path().join(".git/index")).unwrap(), index);
}

#[test]
fn git_untracked_preview_is_bounded_utf8_and_never_reads_external_symlinks() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    git(&root, &["init", "-b", "main"]);
    fs::write(root.join("fresh.txt"), "fresh text\n").unwrap();
    fs::write(root.join("binary.dat"), [0, 1, 2, 3]).unwrap();
    fs::write(root.join("invalid.txt"), [0xff, 0xfe]).unwrap();
    fs::write(
        root.join("large.txt"),
        vec![b'x'; TEXT_MAX_BYTES as usize + 1],
    )
    .unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    for (path, expected) in [
        ("fresh.txt", GitDiffState::Text),
        ("binary.dat", GitDiffState::Binary),
        ("invalid.txt", GitDiffState::Unreadable),
        ("large.txt", GitDiffState::TooLarge),
    ] {
        let output = access
            .prepare_git_diff(&identity, path, GitDiffLayer::Untracked, &protection)
            .unwrap()
            .run(&GitReader::default());
        let diff = access.finish_git_diff(output, &protection).unwrap();
        assert_eq!(diff.state, expected, "{path}");
        if path == "fresh.txt" {
            assert!(diff.text.unwrap().contains("+fresh text"));
        }
    }
    fs::write(temp.path().join("secret.txt"), "external secret").unwrap();
    symlink(temp.path().join("secret.txt"), root.join("link.txt")).unwrap();
    assert_eq!(
        access
            .prepare_git_diff(&identity, "link.txt", GitDiffLayer::Untracked, &protection)
            .err()
            .unwrap()
            .code,
        CreationErrorCode::PathEscape
    );
    assert!(!root.join(".git/index").exists());
}

#[test]
fn git_workflow_handles_nonrepository_unborn_detached_and_revoked_jobs() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let other = project(temp.path(), "other");
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let output = access
        .prepare_git_status(&identity, &protection)
        .unwrap()
        .run(&GitReader::default());
    assert_eq!(
        access.finish_git_status(output, &protection).unwrap().state,
        GitState::NotRepository
    );
    git(&root, &["init", "-b", "main"]);
    let output = access
        .prepare_git_status(&identity, &protection)
        .unwrap()
        .run(&GitReader::default());
    let unborn = access.finish_git_status(output, &protection).unwrap();
    assert_eq!(unborn.branch.as_deref(), Some("main"));
    assert!(unborn.head.is_none());
    git(&root, &["add", "."]);
    git(
        &root,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-m",
            "base",
        ],
    );
    git(&root, &["checkout", "--detach"]);
    let job = access.prepare_git_status(&identity, &protection).unwrap();
    let output = access
        .prepare_git_status(&identity, &protection)
        .unwrap()
        .run(&GitReader::default());
    let detached = access.finish_git_status(output, &protection).unwrap();
    assert!(detached.branch.is_none() && detached.head.is_some());
    let diff = access
        .prepare_git_diff(&identity, "server.js", GitDiffLayer::Unstaged, &protection)
        .unwrap();
    access.open(&other, &protection).unwrap();
    assert_eq!(
        access
            .finish_git_status(job.run(&GitReader::default()), &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
    assert_eq!(
        access
            .finish_git_diff(diff.run(&GitReader::default()), &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::InvalidIdentity
    );
}

#[test]
fn git_reader_reports_corrupt_repository_without_starting_a_process() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    fs::write(root.join(".git"), "gitdir: /nonexistent/repository\n").unwrap();
    let output = access
        .prepare_git_status(&identity, &protection)
        .unwrap()
        .run(&GitReader::default());
    assert_eq!(
        access.finish_git_status(output, &protection).unwrap().state,
        GitState::Unreadable
    );
}

#[test]
fn git_inspection_never_executes_repository_filters_fsmonitor_or_diff_helpers() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    git(&root, &["init", "-b", "main"]);
    fs::write(root.join("server.js"), "base text\n").unwrap();
    git(&root, &["add", "."]);
    git(
        &root,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-m",
            "base",
        ],
    );
    let helper = temp.path().join("helper");
    fs::write(
        &helper,
        format!(
            "#!/bin/sh\ntouch '{}/helper-ran'\ncat\n",
            temp.path().display()
        ),
    )
    .unwrap();
    fs::set_permissions(&helper, fs::Permissions::from_mode(0o755)).unwrap();
    let helper = helper.to_str().unwrap();
    git(&root, &["config", "filter.agent.clean", helper]);
    git(&root, &["config", "filter.agent.required", "true"]);
    git(&root, &["config", "diff.agent.textconv", helper]);
    git(&root, &["config", "diff.external", helper]);
    git(&root, &["config", "core.fsmonitor", helper]);
    fs::write(
        root.join(".gitattributes"),
        "server.js filter=agent diff=agent\n",
    )
    .unwrap();
    fs::write(root.join("server.js"), "disk text\n").unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let output = access
        .prepare_git_status(&identity, &protection)
        .unwrap()
        .run(&GitReader::default());
    assert_eq!(
        access.finish_git_status(output, &protection).unwrap().state,
        GitState::Available
    );
    let output = access
        .prepare_git_diff(&identity, "server.js", GitDiffLayer::Unstaged, &protection)
        .unwrap()
        .run(&GitReader::default());
    let text = access
        .finish_git_diff(output, &protection)
        .unwrap()
        .text
        .unwrap();
    assert!(text.contains("+disk text"));
    assert!(!temp.path().join("helper-ran").exists());
}

#[test]
fn git_inspection_isolates_included_and_linked_worktree_filters() {
    use std::os::unix::fs::PermissionsExt;

    for scope in ["included", "worktree"] {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        fs::create_dir(&source).unwrap();
        let root = project(&source, "score");
        git(&source, &["init", "-b", "main"]);
        fs::write(root.join("server.js"), "base text\n").unwrap();
        fs::write(root.join(".gitattributes"), "server.js filter=agent\n").unwrap();
        git(&source, &["add", "."]);
        git(
            &source,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "-m",
                "base",
            ],
        );
        let linked = temp.path().join("linked");
        git(
            &source,
            &[
                "worktree",
                "add",
                "--detach",
                linked.to_str().unwrap(),
                "HEAD",
            ],
        );
        let root = linked.join("score");
        let marker = temp.path().join("filter-ran");
        let helper = temp.path().join("filter-helper");
        fs::write(
            &helper,
            format!("#!/bin/sh\ntouch '{}'\ncat\n", marker.display()),
        )
        .unwrap();
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o755)).unwrap();
        if scope == "included" {
            let included = temp.path().join("included-config");
            fs::write(
                &included,
                format!(
                    "[filter \"agent\"]\nclean = {}\nrequired = true\n",
                    helper.display()
                ),
            )
            .unwrap();
            git(
                &linked,
                &["config", "include.path", included.to_str().unwrap()],
            );
        } else {
            git(&source, &["config", "extensions.worktreeConfig", "true"]);
            git(
                &linked,
                &[
                    "config",
                    "--worktree",
                    "filter.agent.clean",
                    helper.to_str().unwrap(),
                ],
            );
            git(
                &linked,
                &["config", "--worktree", "filter.agent.required", "true"],
            );
        }
        fs::write(root.join("server.js"), "disk text\n").unwrap();
        let index = PathBuf::from(
            String::from_utf8(git(
                &linked,
                &["rev-parse", "--path-format=absolute", "--git-path", "index"],
            ))
            .unwrap()
            .trim(),
        );
        let before = fs::read(&index).unwrap();
        let mut access = CreationAccess::default();
        let protection = Protection::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        let output = access
            .prepare_git_status(&identity, &protection)
            .unwrap()
            .run(&GitReader::default());
        assert_eq!(
            access.finish_git_status(output, &protection).unwrap().state,
            GitState::Available,
            "{scope}"
        );
        let output = access
            .prepare_git_diff(&identity, "server.js", GitDiffLayer::Unstaged, &protection)
            .unwrap()
            .run(&GitReader::default());
        let diff = access.finish_git_diff(output, &protection).unwrap();
        assert_eq!(diff.state, GitDiffState::Text, "{scope}: {:?}", diff.detail);
        let text = diff.text.unwrap();
        assert!(
            text.contains("-base text") && text.contains("+disk text"),
            "{scope}"
        );
        assert!(!marker.exists(), "{scope} filter executed");
        assert_eq!(fs::read(index).unwrap(), before, "{scope}");
        assert_eq!(
            fs::read(root.join("server.js")).unwrap(),
            b"disk text\n",
            "{scope}"
        );
    }
}

#[test]
fn git_diffs_handle_deleted_binary_invalid_text_and_literal_names() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "score");
    git(&root, &["init", "-b", "main"]);
    for (name, bytes) in [
        ("deleted.txt", b"deleted base\n".as_slice()),
        ("binary.dat", &[0, 1, 2]),
        ("invalid.txt", &[0xff, 0xfe]),
        (":(glob)*.txt", b"literal base\n"),
    ] {
        fs::write(root.join(name), bytes).unwrap();
    }
    git(&root, &["add", "."]);
    git(
        &root,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-m",
            "base",
        ],
    );
    fs::remove_file(root.join("deleted.txt")).unwrap();
    fs::write(root.join("binary.dat"), [0, 9, 2]).unwrap();
    fs::write(root.join("invalid.txt"), [0xff, 0xff]).unwrap();
    fs::write(root.join(":(glob)*.txt"), "literal change\n").unwrap();
    fs::write(root.join("outside-selection.txt"), "selection secret\n").unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    for (path, expected) in [
        ("deleted.txt", GitDiffState::Text),
        ("binary.dat", GitDiffState::Binary),
        ("invalid.txt", GitDiffState::Unreadable),
        (":(glob)*.txt", GitDiffState::Text),
    ] {
        let output = access
            .prepare_git_diff(&identity, path, GitDiffLayer::Unstaged, &protection)
            .unwrap()
            .run(&GitReader::default());
        let diff = access.finish_git_diff(output, &protection).unwrap();
        assert_eq!(diff.state, expected, "{path}");
        if path == ":(glob)*.txt" {
            let text = diff.text.unwrap();
            assert!(text.contains("+literal change"));
            assert!(!text.contains("selection secret"));
        }
    }
}
