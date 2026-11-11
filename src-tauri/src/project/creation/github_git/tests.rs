use super::*;
use crate::project::creation::git_versions_tests::{save, setup};

fn local_url(root: &Path) -> &str {
    root.to_str().unwrap()
}

fn set_ref(repo: &Repository, branch: &str, oid: Oid) {
    repo.reference(&branch_ref(branch).unwrap(), oid, true, "test branch")
        .unwrap();
}

fn probe(repo: &Repository, url: &str, check_shared: bool) -> GithubGitProbe {
    let repo = Repository::open(repo.workdir().unwrap()).unwrap();
    local_git::local_config(&repo).unwrap();
    let local = local_state(&repo).unwrap();
    probe_repository(&repo, local, url, None, check_shared).unwrap()
}

fn push(repo: &Repository, url: &str, expected: &GithubGitProbe) -> Result<(), CreationError> {
    let repo = Repository::open(repo.workdir().unwrap()).unwrap();
    push_repository(&repo, url, None, expected, || Ok(()))
}

#[test]
fn github_locations_only_accept_canonical_repository_names() {
    assert_eq!(
        github_url("owner/score.git").unwrap(),
        "https://github.com/owner/score.git.git"
    );
    assert_eq!(
        github_origin("git@github.com:owner/score.git").as_deref(),
        Some("owner/score")
    );
    assert_eq!(
        github_origin("ssh://git@github.com/owner/score.git").as_deref(),
        Some("owner/score")
    );
    for invalid in [
        "owner/../other",
        "owner/a?b",
        "owner/%2F",
        "owner/a\\b",
        "-owner/score",
        "owner-/score",
        "https://github.com/a/b",
        "owner/.",
    ] {
        assert!(github_url(invalid).is_err(), "{invalid}");
    }
    assert!(github_origin("https://github.com.evil.invalid/owner/score").is_none());
    assert!(github_origin("https://private@github.com/owner/score").is_none());
    assert!(github_origin("https://github.com/owner/score.git?secret").is_none());
    assert!(branch_ref("main:refs/tags/tag").is_err());
    assert!(branch_ref("").is_err());
}

#[test]
fn offline_connection_failures_are_retriable_and_certificate_refusals_are_not() {
    let connection = git2::Error::new(
        ErrorCode::GenericError,
        ErrorClass::Os,
        "failed to connect to github.com",
    );
    assert_eq!(
        transport_error(connection).code,
        CreationErrorCode::GitHubNetwork
    );
    let certificate = git2::Error::new(
        ErrorCode::Certificate,
        ErrorClass::Ssl,
        "untrusted connection error",
    );
    assert_eq!(
        transport_error(certificate).code,
        CreationErrorCode::Permission
    );
}

#[test]
fn bound_root_key_is_stable_until_the_project_directory_is_replaced() {
    let (temp, root, mut access, id) = setup();
    let protection = Protection::default();
    let context = access.github_context(&id, &protection).unwrap();
    assert_eq!(access.github_active_identity(), Some(id.as_str()));
    let key = context.directory_key().unwrap();
    assert_eq!(key, github_directory_key(context.root()).unwrap());
    save(&mut access, &id, "Initial project");
    assert_eq!(key, context.directory_key().unwrap());
    fs::rename(&root, temp.path().join("old")).unwrap();
    fs::create_dir(&root).unwrap();
    assert_eq!(
        context.directory_key().unwrap_err().code,
        CreationErrorCode::InvalidIdentity
    );
    assert_ne!(key, github_directory_key(&root).unwrap());
}

#[test]
fn probe_and_push_preserve_external_remotes_and_detect_deleted_or_changed_tips() {
    let (temp, root, mut access, id) = setup();
    let original = save(&mut access, &id, "Initial project");
    let repo = Repository::open(&root).unwrap();
    repo.remote("origin", "git@github.com:creator/external.git")
        .unwrap();
    let remote_path = temp.path().join("remote.git");
    let remote = initialize(&remote_path, "main", true).unwrap();
    let decoy_path = temp.path().join("decoy.git");
    let decoy = initialize(&decoy_path, "main", true).unwrap();
    let url = local_url(&remote_path);
    let rewrite = format!("url.{}.insteadOf", local_url(&decoy_path));
    repo.config().unwrap().set_str(&rewrite, url).unwrap();
    let before = fs::read(root.join(".git/config")).unwrap();
    let empty = probe(&repo, url, true);
    assert_eq!(empty.local.origin.as_deref(), Some("creator/external"));
    assert!(empty.remote_empty);
    assert_eq!(empty.relation, GithubGitRelation::NewBranch);
    push(&repo, url, &empty).unwrap();
    assert_eq!(
        remote.head().unwrap().target().unwrap().to_string(),
        original
    );
    assert!(decoy.head().is_err());
    assert_eq!(probe(&repo, url, false).relation, GithubGitRelation::Equal);
    assert_eq!(fs::read(root.join(".git/config")).unwrap(), before);

    let private_branch = repo.find_commit(parse_oid(&original).unwrap()).unwrap();
    repo.branch("private-sketch", &private_branch, false)
        .unwrap();
    fs::write(root.join("server.js"), "// new version").unwrap();
    let updated = save(&mut access, &id, "Updated project");
    let before = fs::read(root.join(".git/config")).unwrap();
    let ahead = probe(&repo, url, false);
    assert_eq!(ahead.relation, GithubGitRelation::Ahead);
    assert_eq!(ahead.ahead, 1);
    remote
        .find_reference("refs/heads/main")
        .unwrap()
        .delete()
        .unwrap();
    assert_eq!(
        push(&repo, url, &ahead).unwrap_err().code,
        CreationErrorCode::VersionConflict
    );
    assert!(remote.head().is_err());
    assert!(remote.find_reference("refs/heads/private-sketch").is_err());
    let recreate = probe(&repo, url, false);
    assert_eq!(recreate.relation, GithubGitRelation::NewBranch);
    assert_eq!(fs::read(root.join(".git/config")).unwrap(), before);
    fs::write(root.join("server.js"), "// saved during backup").unwrap();
    let later = save(&mut access, &id, "Saved during backup");
    let before = fs::read(root.join(".git/config")).unwrap();
    push(&repo, url, &recreate).unwrap();
    assert_eq!(
        remote.head().unwrap().target().unwrap().to_string(),
        updated
    );
    assert_eq!(repo.head().unwrap().target().unwrap().to_string(), later);
    assert_eq!(probe(&repo, url, false).ahead, 1);
    assert!(remote.find_reference("refs/heads/private-sketch").is_err());
    assert!(!root.join(".git/FETCH_HEAD").exists());
    assert_eq!(fs::read(root.join(".git/config")).unwrap(), before);

    let ahead = probe(&repo, url, false);
    set_ref(&repo, "other", parse_oid(&later).unwrap());
    repo.set_head("refs/heads/other").unwrap();
    assert_eq!(
        push(&repo, url, &ahead).unwrap_err().code,
        CreationErrorCode::VersionConflict
    );
    assert_eq!(
        remote.head().unwrap().target().unwrap().to_string(),
        updated
    );
    assert!(remote.find_reference("refs/heads/other").is_err());

    repo.set_head_detached(parse_oid(&later).unwrap()).unwrap();
    let detached = probe(&repo, url, false);
    assert!(detached.local.branch.is_none());
    assert_eq!(detached.relation, GithubGitRelation::NoLocalBranch);
    assert!(push(&repo, url, &detached).is_err());
}

#[test]
fn binding_detects_shared_history_on_a_differently_named_branch_and_rejects_unrelated_history() {
    let (temp, root, mut access, id) = setup();
    let original = save(&mut access, &id, "Initial project");
    let repo = Repository::open(&root).unwrap();
    let remote_path = temp.path().join("remote.git");
    let remote = initialize(&remote_path, "archive", true).unwrap();
    let url = local_url(&remote_path);
    let empty = probe(&repo, url, true);
    push(&repo, url, &empty).unwrap();
    let head = parse_oid(&original).unwrap();
    set_ref(&remote, "archive", head);
    remote
        .find_reference("refs/heads/main")
        .unwrap()
        .delete()
        .unwrap();
    let matched = probe(&repo, url, true);
    assert_eq!(matched.relation, GithubGitRelation::NewBranch);
    assert!(matched.shared_history);
    assert!(!matched.remote_empty);

    let signature = git2::Signature::now("GitHub", "github@example.com").unwrap();
    let tree = remote.find_commit(head).unwrap().tree().unwrap();
    let independent = remote
        .commit(None, &signature, &signature, "Independent", &tree, &[])
        .unwrap();
    set_ref(&remote, "archive", independent);
    let scratch = tempfile::tempdir().unwrap();
    let staging = initialize(scratch.path(), "main", true).unwrap();
    seed_history_probe(&repo, &staging).unwrap();
    let unrelated =
        probe_repository(&staging, local_state(&repo).unwrap(), url, None, true).unwrap();
    assert!(!unrelated.remote_empty);
    assert!(!unrelated.shared_history);
    assert!(staging.find_commit(independent).is_ok());
    assert!(repo.find_commit(independent).is_err());
}

fn commit_server(repo: &Repository, source: &[u8], parent: Oid) -> Oid {
    let parent = repo.find_commit(parent).unwrap();
    let base = parent.tree().unwrap();
    let mut builder = repo.treebuilder(Some(&base)).unwrap();
    builder
        .insert("server.js", repo.blob(source).unwrap(), 0o100644)
        .unwrap();
    let tree = repo.find_tree(builder.write().unwrap()).unwrap();
    let signature = git2::Signature::now("GitHub", "github@example.com").unwrap();
    repo.commit(
        Some("refs/heads/main"),
        &signature,
        &signature,
        "Remote edit",
        &tree,
        &[&parent],
    )
    .unwrap()
}

#[test]
fn fetch_and_fast_forward_preserve_other_branches_and_require_clean_worktree() {
    let (temp, root, mut access, id) = setup();
    let original = parse_oid(&save(&mut access, &id, "Initial project")).unwrap();
    let repo = Repository::open(&root).unwrap();
    set_ref(&repo, "other", original);
    let remote_path = temp.path().join("remote.git");
    let remote = initialize(&remote_path, "main", true).unwrap();
    let url = local_url(&remote_path);
    push(&repo, url, &probe(&repo, url, true)).unwrap();
    let changed = b"// fetched branch content";
    let updated = commit_server(&remote, changed, original);
    assert!(repo.find_commit(updated).is_err());
    let behind = probe(&repo, url, false);
    assert_eq!(behind.relation, GithubGitRelation::Behind);
    assert_eq!(behind.behind, 1);
    assert_eq!(repo.head().unwrap().target(), Some(original));
    assert!(!root.join(".git/FETCH_HEAD").exists());
    let protection = Protection::default();
    let data = temp.path().join("assistant");
    let server = root.join("server.js");
    let before = fs::read(&server).unwrap();
    fs::write(&server, "// unsaved local work").unwrap();
    assert!(access
        .github_fast_forward(&id, &behind, &data, &protection)
        .is_err());
    assert_eq!(
        fs::read_to_string(&server).unwrap(),
        "// unsaved local work"
    );
    fs::write(&server, before).unwrap();
    repo.set_head("refs/heads/other").unwrap();
    assert!(access
        .github_fast_forward(&id, &behind, &data, &protection)
        .is_err());
    assert_eq!(repo.head().unwrap().target(), Some(original));
    assert_ne!(fs::read(&server).unwrap(), changed);
    repo.set_head("refs/heads/main").unwrap();
    access
        .github_fast_forward(&id, &behind, &data, &protection)
        .unwrap();
    assert_eq!(fs::read(&server).unwrap(), changed);
    assert_eq!(repo.head().unwrap().target(), Some(updated));
    assert_eq!(repo.head().unwrap().name().unwrap(), "refs/heads/main");
    assert_eq!(
        repo.find_reference("refs/heads/other").unwrap().target(),
        Some(original)
    );
    assert_eq!(probe(&repo, url, false).relation, GithubGitRelation::Equal);
    assert!(access
        .github_fast_forward(&id, &behind, &data, &protection)
        .is_err());
}

#[test]
fn remote_checkout_refuses_to_remove_tracked_private_project_data() {
    let (_temp, root, mut access, id) = setup();
    let original = parse_oid(&save(&mut access, &id, "Initial project")).unwrap();
    let repo = Repository::open(&root).unwrap();
    let path = Path::new(".pnds-private");
    fs::write(root.join(path), b"private project data").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(path).unwrap();
    index.write().unwrap();
    let local_tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let initial = repo.find_commit(original).unwrap();
    let signature = git2::Signature::now("Author", "author@example.com").unwrap();
    let local = repo
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            "Existing external history",
            &local_tree,
            &[&initial],
        )
        .unwrap();
    let updated = repo
        .commit(
            None,
            &signature,
            &signature,
            "GitHub update",
            &initial.tree().unwrap(),
            &[&repo.find_commit(local).unwrap()],
        )
        .unwrap();

    assert!(git_restore::target_for_sync(&repo, updated).is_err());
    assert_eq!(fs::read(root.join(path)).unwrap(), b"private project data");
}

#[test]
fn clone_validates_before_publication_and_never_replaces_destination() {
    let (temp, root, mut access, id) = setup();
    let original = parse_oid(&save(&mut access, &id, "Initial project")).unwrap();
    let repo = Repository::open(&root).unwrap();
    let remote_path = temp.path().join("remote.git");
    let remote = initialize(&remote_path, "main", true).unwrap();
    let url = local_url(&remote_path);
    push(&repo, url, &probe(&repo, url, true)).unwrap();
    set_ref(&remote, "other", original);

    let protection = Protection::default();
    let parent = temp.path();
    let (target, directory_key) =
        clone_project(url, "main", None, parent, "cloned-score", &protection).unwrap();
    assert_eq!(directory_key, github_directory_key(&target).unwrap());
    let clone = Repository::open(&target).unwrap();
    assert_eq!(clone.head().unwrap().target(), Some(original));
    assert!(clone.find_reference("refs/heads/other").is_err());
    assert_eq!(
        fs::read(root.join("server.js")).unwrap(),
        fs::read(target.join("server.js")).unwrap()
    );
    assert_eq!(
        clone_project(url, "main", None, parent, "cloned-score", &protection)
            .unwrap_err()
            .code,
        CreationErrorCode::TargetExists
    );
    assert!(clone_project(url, "missing", None, parent, "unknown-branch", &protection).is_err());
    assert!(!parent.join("unknown-branch").exists());

    let head = remote.find_commit(original).unwrap();
    let base = head.tree().unwrap();
    let mut builder = remote.treebuilder(Some(&base)).unwrap();
    builder.remove("manifest.json").unwrap();
    let missing_manifest = remote.find_tree(builder.write().unwrap()).unwrap();
    let signature = git2::Signature::now("GitHub", "github@example.com").unwrap();
    remote
        .commit(
            Some("refs/heads/main"),
            &signature,
            &signature,
            "Invalid project",
            &missing_manifest,
            &[&head],
        )
        .unwrap();
    assert!(clone_project(url, "main", None, parent, "bad-score", &protection).is_err());
    assert!(!parent.join("bad-score").exists());
    assert!(fs::read_dir(parent).unwrap().flatten().all(|entry| !entry
        .file_name()
        .to_string_lossy()
        .starts_with(".pnds-clone-")));

    let mut builder = remote.treebuilder(Some(&base)).unwrap();
    builder
        .insert("redirect", remote.blob(b"../").unwrap(), 0o120000)
        .unwrap();
    let unsafe_tree = remote.find_tree(builder.write().unwrap()).unwrap();
    remote
        .commit(
            Some("refs/heads/unsafe"),
            &signature,
            &signature,
            "Untrusted link",
            &unsafe_tree,
            &[&head],
        )
        .unwrap();
    assert!(clone_project(url, "unsafe", None, parent, "unsafe-score", &protection).is_err());
    assert!(!parent.join("unsafe-score").exists());

    let mut builder = remote.treebuilder(Some(&base)).unwrap();
    builder
        .insert(
            ".PNDS-creation",
            remote.blob(b"untrusted creator state").unwrap(),
            0o100644,
        )
        .unwrap();
    let private_tree = remote.find_tree(builder.write().unwrap()).unwrap();
    remote
        .commit(
            Some("refs/heads/private-data"),
            &signature,
            &signature,
            "Private project data",
            &private_tree,
            &[&head],
        )
        .unwrap();
    assert!(clone_project(
        url,
        "private-data",
        None,
        parent,
        "private-data",
        &protection
    )
    .is_err());
    assert!(!parent.join("private-data").exists());
}
