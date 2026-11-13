use super::*;

fn repository(private: bool) -> GithubRepository {
    GithubRepository {
        id: "43".into(),
        full_name: "creator/score".into(),
        private,
        default_branch: "main".into(),
        can_push: true,
    }
}

fn probe(
    branch: &str,
    head: &str,
    remote: Option<&str>,
    relation: GithubGitRelation,
) -> GithubGitProbe {
    GithubGitProbe {
        local: GithubLocalGit {
            branch: Some(branch.into()),
            head: Some(head.into()),
            origin: None,
        },
        remote_head: remote.map(str::to_owned),
        remote_empty: false,
        shared_history: true,
        relation,
        ahead: 0,
        behind: 0,
    }
}

#[test]
fn queue_reopens_with_project_and_branch_and_respects_auto_opt_in() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("sync.json");
    let key = project_key(root.path(), "original");
    let mut binding = Binding::new(repository(true), Some("creator".into()));
    assert!(!binding.enqueue("main", "first"));
    binding.set_auto_backup(true);
    assert!(binding.enqueue("main", "first"));
    assert!(binding.enqueue("main", "latest"));
    let data = BTreeMap::from([(key.clone(), binding)]);
    write_bindings(&path, &data).unwrap();
    let mut reopened = read_bindings(&path).unwrap();
    assert!(!reopened.contains_key(&project_key(root.path(), "replacement")));
    let binding = reopened.get_mut(&key).unwrap();
    assert_eq!(
        binding.pending_head(&probe("main", "latest", None, GithubGitRelation::NewBranch).local),
        Some("latest")
    );
    assert_eq!(
        binding.pending_head(&probe("other", "latest", None, GithubGitRelation::NewBranch).local),
        None
    );
    binding.set_auto_backup(false);
    binding.set_auto_backup(true);
    assert!(binding.branches["main"].pending.is_none());
}

#[test]
fn new_public_backups_and_deleted_branches_require_confirmation() {
    let mut binding = Binding::new(repository(false), Some("creator".into()));
    let push = probe("main", "next", None, GithubGitRelation::NewBranch);
    assert_eq!(binding.confirms(&push), (true, false));
    binding.record_push(&push, None);
    let deleted = probe("main", "later", None, GithubGitRelation::NewBranch);
    binding.observe(&deleted);
    assert_eq!(binding.confirms(&deleted), (false, true));
    assert!(binding.branches["main"]
        .observation
        .as_ref()
        .is_some_and(|value| value.relation == GithubSyncRelation::DeletedBranch));
    assert_eq!(
        binding.confirms(&probe("new", "later", None, GithubGitRelation::NewBranch)),
        (false, false)
    );
}

#[test]
fn an_in_flight_push_does_not_clear_a_newer_queued_version() {
    let mut binding = Binding::new(repository(true), Some("creator".into()));
    binding.set_auto_backup(true);
    assert!(binding.enqueue("main", "before"));
    assert!(binding.enqueue("main", "during"));
    binding.record_push(
        &probe("main", "before", Some("remote"), GithubGitRelation::Ahead),
        Some("before"),
    );
    assert_eq!(binding.branches["main"].pending.as_deref(), Some("during"));
    binding.observe(&probe(
        "main",
        "during",
        Some("during"),
        GithubGitRelation::Equal,
    ));
    assert_eq!(binding.branches["main"].pending, None);
}

#[test]
fn rebind_has_manual_defaults_and_never_inherits_public_consent_or_queued_work() {
    let mut before = Binding::new(repository(false), Some("creator".into()));
    before.set_auto_backup(true);
    before.record_push(
        &probe("main", "before", None, GithubGitRelation::NewBranch),
        None,
    );
    before.enqueue("main", "queued");
    let after = Binding::new(repository(false), Some("new-account".into()));
    assert!(!after.auto_backup);
    assert!(!after.public_confirmed);
    assert!(after.branches.is_empty());
}

#[test]
fn a_remote_that_already_contains_the_queued_version_satisfies_its_backup() {
    let mut binding = Binding::new(repository(true), Some("creator".into()));
    binding.set_auto_backup(true);
    assert!(binding.enqueue("main", "already-pushed"));
    binding.observe(&probe(
        "main",
        "already-pushed",
        Some("newer"),
        GithubGitRelation::Behind,
    ));
    assert!(binding.branches["main"].pending.is_none());
}

#[test]
fn pending_template_backup_reopens_with_its_exact_commits_and_classifies_the_remote() {
    use template_backup::TemplateRemoteState::{Conflict, Received, Waiting};
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("sync.json");
    let pending = PendingTemplateBackup {
        repository: repository(true),
        account_id: "creator".into(),
        commit: GithubTemplateCommit {
            branch: "main".into(),
            local_head: "local".into(),
            remote_head: "initial".into(),
            merge_head: "merge".into(),
        },
    };
    let mut binding = Binding::new(repository(true), Some("creator".into()));
    binding.template_pending = Some(pending);
    write_bindings(&path, &BTreeMap::from([("project".to_owned(), binding)])).unwrap();
    let mut reopened = read_bindings(&path).unwrap();
    let reopened = reopened
        .remove("project")
        .unwrap()
        .template_pending
        .unwrap();
    assert_eq!(reopened.summary().head, "local");
    assert_eq!(reopened.remote_state(Some("initial")), Waiting);
    assert_eq!(reopened.remote_state(Some("merge")), Received);
    assert_eq!(reopened.remote_state(Some("elsewhere")), Conflict);
    assert_eq!(reopened.remote_state(None), Conflict);
}
