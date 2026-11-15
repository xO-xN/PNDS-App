use super::super::git_versions_tests::{save as record_version, setup};
use super::*;
fn protection() -> Protection {
    Protection::default()
}
fn checkout(root: &Path, id: &str, branch: &str) {
    let repo = Repository::open(root).unwrap();
    repo.set_head(branch).unwrap();
    let commit = repo.find_commit(parse(id).unwrap()).unwrap();
    let mut options = git2::build::CheckoutBuilder::new();
    options.force();
    repo.checkout_tree(commit.as_object(), Some(&mut options))
        .unwrap();
    let mut index = repo.index().unwrap();
    index.read_tree(&commit.tree().unwrap()).unwrap();
    index.write().unwrap();
}
fn fork(
    conflicting: bool,
) -> (
    tempfile::TempDir,
    PathBuf,
    CreationAccess,
    String,
    String,
    String,
) {
    let (temp, root, mut access, id) = setup();
    fs::write(root.join("shared.txt"), "base\n").unwrap();
    let base = record_version(&mut access, &id, "Base");
    let repo = Repository::open(&root).unwrap();
    repo.branch(
        "source",
        &repo.find_commit(parse(&base).unwrap()).unwrap(),
        false,
    )
    .unwrap();
    fs::write(
        root.join(if conflicting {
            "shared.txt"
        } else {
            "left.txt"
        }),
        "current\n",
    )
    .unwrap();
    let target = record_version(&mut access, &id, "Current");
    checkout(&root, &base, "refs/heads/source");
    fs::write(
        root.join(if conflicting {
            "shared.txt"
        } else {
            "right.txt"
        }),
        "incoming\n",
    )
    .unwrap();
    let source = record_version(&mut access, &id, "Incoming");
    checkout(&root, &target, "refs/heads/main");
    (temp, root, access, id, target, source)
}
fn prepare(access: &mut CreationAccess, id: &str, source: &str, data: &Path) -> GitMergeCandidate {
    access
        .prepare_git_merge(id, source, false, data, &protection())
        .unwrap()
}
fn head(root: &Path) -> String {
    Repository::open(root)
        .unwrap()
        .head()
        .unwrap()
        .target()
        .unwrap()
        .to_string()
}
fn resolve(
    access: &mut CreationAccess,
    id: &str,
    candidate: GitMergeCandidate,
) -> GitMergeCandidate {
    let file = candidate
        .files
        .iter()
        .find(|file| file.conflict.is_some())
        .unwrap();
    access
        .edit_git_merge_owned(
            id,
            &candidate.id,
            candidate.revision,
            None,
            vec![GitMergeEdit {
                path: file.path.clone(),
                version: file.version.clone(),
                text: Some("resolved\n<<<<<<< original legitimate content\n".into()),
                choice: None,
            }],
            &protection(),
        )
        .unwrap()
}
#[test]
fn included_relationship_precedes_dirty_cleanup_and_has_no_side_effects() {
    let (temp, root, mut access, id, _target, source) = fork(false);
    let repo = Repository::open(&root).unwrap();
    let base = repo
        .find_commit(parse(&source).unwrap())
        .unwrap()
        .parent_id(0)
        .unwrap()
        .to_string();
    let original = head(&root);
    fs::write(root.join("shared.txt"), "unsaved work").unwrap();
    let reply = access
        .prepare_git_merge(&id, &base, true, temp.path(), &protection())
        .unwrap();
    assert_eq!(reply.relation, GitMergeRelation::Included);
    assert_eq!(head(&root), original);
    assert_eq!(
        fs::read_to_string(root.join("shared.txt")).unwrap(),
        "unsaved work"
    );
    assert!(active_id(access.current(&id, &protection()).unwrap())
        .unwrap()
        .is_none());
}
#[test]
fn candidate_is_isolated_real_writers_are_blocked_and_cancel_preserves_sources() {
    let (temp, root, mut access, id, target, source) = fork(true);
    let old_index = fs::read(root.join(".git/index")).unwrap();
    let old_file = fs::read(root.join("shared.txt")).unwrap();
    let candidate = prepare(&mut access, &id, &source, temp.path());
    assert_eq!(candidate.unresolved, 1);
    assert_eq!(head(&root), target);
    assert_eq!(fs::read(root.join(".git/index")).unwrap(), old_index);
    assert_eq!(fs::read(root.join("shared.txt")).unwrap(), old_file);
    let version = match access.read(&id, "shared.txt", &protection()).unwrap() {
        CreationContent::Text { version, .. } => version,
        _ => panic!(),
    };
    assert!(access
        .save(&id, "shared.txt", "ordinary write", &version, &protection())
        .is_err());
    assert!(access.preview_git_record(&id, &protection()).is_err());
    assert!(require_no_candidate_at_root(&root).is_err());
    access
        .cancel_git_merge(&id, &candidate.id, candidate.revision, &protection())
        .unwrap();
    assert!(require_no_candidate_at_root(&root).is_ok());
    assert_eq!(head(&root), target);
    assert_eq!(fs::read(root.join("shared.txt")).unwrap(), old_file);
}
#[test]
fn merge_creates_exact_two_parent_commit_and_does_not_move_source_route() {
    let (temp, root, mut access, id, target, source) = fork(false);
    let candidate = prepare(&mut access, &id, &source, temp.path());
    assert_eq!(candidate.unresolved, 0);
    let result = access
        .finish_git_merge(
            &id,
            &candidate.id,
            candidate.revision,
            "Creator",
            "",
            &protection(),
        )
        .unwrap();
    let repo = Repository::open(&root).unwrap();
    let commit = repo
        .find_commit(parse(result.result.as_deref().unwrap()).unwrap())
        .unwrap();
    assert_eq!(commit.parent_count(), 2);
    assert_eq!(commit.parent_id(0).unwrap().to_string(), target);
    assert_eq!(commit.parent_id(1).unwrap().to_string(), source);
    assert_eq!(
        repo.find_reference("refs/heads/source")
            .unwrap()
            .target()
            .unwrap()
            .to_string(),
        source
    );
    assert!(root.join("left.txt").exists() && root.join("right.txt").exists());
    let repeated = access
        .finish_git_merge(
            &id,
            &candidate.id,
            candidate.revision,
            "Other",
            "",
            &protection(),
        )
        .unwrap();
    assert_eq!(repeated.result, result.result);
    assert_eq!(head(&root), result.result.unwrap());
}
#[test]
fn text_conflicts_use_captured_labels_and_compare_and_swap() {
    let (temp, _root, mut access, id, _target, source) = fork(true);
    let candidate = prepare(&mut access, &id, &source, temp.path());
    let file = candidate
        .files
        .iter()
        .find(|file| file.path == "shared.txt")
        .unwrap();
    let content = access
        .read_git_merge_file(
            &id,
            &candidate.id,
            "shared.txt",
            GitMergeSide::Result,
            &protection(),
        )
        .unwrap();
    assert!(content.text.unwrap().contains("PNDS-merge-"));
    let changed = resolve(&mut access, &id, candidate.clone());
    assert_eq!(changed.unresolved, 0);
    assert!(access
        .edit_git_merge_owned(
            &id,
            &candidate.id,
            candidate.revision,
            None,
            vec![GitMergeEdit {
                path: file.path.clone(),
                version: file.version.clone(),
                text: Some("late".into()),
                choice: None
            }],
            &protection()
        )
        .is_err());
    access
        .validate_git_merge(&id, &candidate.id, changed.revision, &protection())
        .unwrap();
}
#[test]
fn reopen_requires_explicit_continue_and_target_route_identity_is_bound() {
    let (temp, root, mut access, id, _target, source) = fork(false);
    let candidate = prepare(&mut access, &id, &source, temp.path());
    let mut reopened = CreationAccess::default();
    let workspace = reopened.open(&root, &protection()).unwrap();
    assert_eq!(workspace.merge_pending, Some(true));
    let id = workspace.project.identity;
    let paused = reopened.get_git_merge(&id, &protection()).unwrap().unwrap();
    assert_eq!(paused.phase, GitMergePhase::Paused);
    let continued = reopened
        .resume_git_merge(&id, &candidate.id, candidate.revision, &protection())
        .unwrap();
    let repo = Repository::open(&root).unwrap();
    repo.branch(
        "another",
        &repo.head().unwrap().peel_to_commit().unwrap(),
        false,
    )
    .unwrap();
    repo.set_head("refs/heads/another").unwrap();
    let stale = reopened.get_git_merge(&id, &protection()).unwrap().unwrap();
    assert_eq!(stale.phase, GitMergePhase::Stale);
    assert!(stale.revision > continued.revision);
    assert!(reopened
        .finish_git_merge(&id, &stale.id, stale.revision, "Creator", "", &protection())
        .is_err());
}
#[test]
fn advancing_source_route_does_not_replace_the_fixed_source_or_expire_candidate() {
    let (temp, root, mut access, id, _target, source) = fork(false);
    let candidate = prepare(&mut access, &id, &source, temp.path());
    let repo = Repository::open(&root).unwrap();
    let old = repo.find_commit(parse(&source).unwrap()).unwrap();
    let signature = git2::Signature::now("External", "outside@example.test").unwrap();
    repo.commit(
        Some("refs/heads/source"),
        &signature,
        &signature,
        "later source",
        &old.tree().unwrap(),
        &[&old],
    )
    .unwrap();
    let fresh = access
        .git_merge_fresh(&id, &candidate.id, candidate.revision, &protection())
        .unwrap();
    assert_eq!(fresh.source, source);
}
#[test]
fn snapshots_are_fixed_saved_trees_and_manual_changes_expire_the_old_revision() {
    let (temp, _root, mut access, id, _target, source) = fork(true);
    let candidate = prepare(&mut access, &id, &source, temp.path());
    assert!(access
        .prepare_git_merge_snapshot(&id, &candidate.id, candidate.revision, true, &protection())
        .is_err());
    let candidate = resolve(&mut access, &id, candidate);
    let snapshot = access
        .prepare_git_merge_snapshot(&id, &candidate.id, candidate.revision, true, &protection())
        .unwrap();
    let file = access
        .read_git_merge_file(
            &id,
            &candidate.id,
            "shared.txt",
            GitMergeSide::Result,
            &protection(),
        )
        .unwrap();
    let updated = access
        .edit_git_merge_owned(
            &id,
            &candidate.id,
            candidate.revision,
            None,
            vec![GitMergeEdit {
                path: "shared.txt".into(),
                version: file.version,
                text: Some("later\n".into()),
                choice: None,
            }],
            &protection(),
        )
        .unwrap();
    assert!(fs::read_to_string(snapshot.root.join("shared.txt"))
        .unwrap()
        .starts_with("resolved"));
    assert!(updated.revision > snapshot.candidate.revision);
    assert!(access
        .git_merge_fresh(
            &id,
            &candidate.id,
            snapshot.candidate.revision,
            &protection()
        )
        .is_err());
}
#[test]
fn checkpoint_undo_preserves_unrelated_edits_and_refuses_overlapping_later_edits() {
    let (temp, _root, mut access, id, _target, source) = fork(false);
    let candidate = prepare(&mut access, &id, &source, temp.path());
    let round = access
        .begin_git_merge_round(&id, &candidate.id, candidate.revision, &protection())
        .unwrap();
    let file = access
        .read_git_merge_file(
            &id,
            &candidate.id,
            "right.txt",
            GitMergeSide::Result,
            &protection(),
        )
        .unwrap();
    let changed = access
        .edit_git_merge_owned(
            &id,
            &candidate.id,
            candidate.revision,
            Some(&round.id),
            vec![GitMergeEdit {
                path: "right.txt".into(),
                version: file.version,
                text: Some("assistant\n".into()),
                choice: None,
            }],
            &protection(),
        )
        .unwrap();
    assert!(access
        .edit_git_merge_owned(
            &id,
            &candidate.id,
            changed.revision,
            None,
            vec![],
            &protection()
        )
        .is_err());
    access
        .end_git_merge_round(&id, &candidate.id, &round.id, &protection())
        .unwrap();
    let file = access
        .read_git_merge_file(
            &id,
            &candidate.id,
            "left.txt",
            GitMergeSide::Result,
            &protection(),
        )
        .unwrap();
    let manual = access
        .edit_git_merge_owned(
            &id,
            &candidate.id,
            changed.revision,
            None,
            vec![GitMergeEdit {
                path: "left.txt".into(),
                version: file.version,
                text: Some("manual\n".into()),
                choice: None,
            }],
            &protection(),
        )
        .unwrap();
    let undone = access
        .undo_git_merge_round(&id, &candidate.id, manual.revision, &protection())
        .unwrap();
    assert_eq!(
        access
            .read_git_merge_file(
                &id,
                &candidate.id,
                "left.txt",
                GitMergeSide::Result,
                &protection()
            )
            .unwrap()
            .text
            .unwrap(),
        "manual\n"
    );
    assert_eq!(
        access
            .read_git_merge_file(
                &id,
                &candidate.id,
                "right.txt",
                GitMergeSide::Result,
                &protection()
            )
            .unwrap()
            .text
            .unwrap(),
        "incoming\n"
    );
    assert!(!undone.can_undo);
}
#[test]
fn every_publication_boundary_recovers_the_same_result_without_repeating_commits() {
    for boundary in 0..7 {
        let (temp, root, mut access, id, _target, source) = fork(false);
        let candidate = prepare(&mut access, &id, &source, temp.path());
        publication::FAULT.with(|fault| fault.set(Some(boundary)));
        let first = access.finish_git_merge(
            &id,
            &candidate.id,
            candidate.revision,
            "Creator",
            "",
            &protection(),
        );
        publication::FAULT.with(|fault| fault.set(None));
        if first.is_ok() {
            continue;
        }
        let stored = load(access.current(&id, &protection()).unwrap(), &candidate.id).unwrap();
        let fixed = stored.publication.unwrap().result;
        assert!(access.preview_git_record(&id, &protection()).is_err());
        let recovered = access
            .recover_git_merge(&id, &candidate.id, candidate.revision, &protection())
            .unwrap();
        assert_eq!(recovered.result.as_deref(), Some(fixed.as_str()));
        assert_eq!(head(&root), fixed);
        assert_eq!(
            Repository::open(&root)
                .unwrap()
                .find_commit(parse(&fixed).unwrap())
                .unwrap()
                .parent_count(),
            2
        );
    }
}
#[test]
fn recovery_never_overwrites_external_third_content() {
    let (temp, root, mut access, id, _target, source) = fork(false);
    let candidate = prepare(&mut access, &id, &source, temp.path());
    publication::FAULT.with(|fault| fault.set(Some(2)));
    assert!(access
        .finish_git_merge(
            &id,
            &candidate.id,
            candidate.revision,
            "Creator",
            "",
            &protection()
        )
        .is_err());
    publication::FAULT.with(|fault| fault.set(None));
    fs::write(root.join("right.txt"), "external new work").unwrap();
    assert!(access
        .recover_git_merge(&id, &candidate.id, candidate.revision, &protection())
        .is_err());
    assert_eq!(
        fs::read_to_string(root.join("right.txt")).unwrap(),
        "external new work"
    );
    assert!(access
        .cancel_git_merge(&id, &candidate.id, candidate.revision, &protection())
        .is_err());
}
#[test]
fn binary_choice_can_resolve_without_changing_target_content() {
    let (temp, root, mut access, id, _target, source) = fork(false);
    fs::write(root.join("texture.png"), b"\x89PNG\r\n\x1acurrent").unwrap();
    let target = record_version(&mut access, &id, "Current image");
    checkout(&root, &source, "refs/heads/source");
    fs::write(root.join("texture.png"), b"\x89PNG\r\n\x1aincoming").unwrap();
    let source = record_version(&mut access, &id, "Incoming image");
    checkout(&root, &target, "refs/heads/main");
    let candidate = prepare(&mut access, &id, &source, temp.path());
    assert_eq!(candidate.unresolved, 1);
    let file = candidate
        .files
        .iter()
        .find(|file| file.path == "texture.png")
        .unwrap();
    assert_eq!(file.kind, GitMergeFileKind::Image);
    let resolved = access
        .edit_git_merge_owned(
            &id,
            &candidate.id,
            candidate.revision,
            None,
            vec![GitMergeEdit {
                path: file.path.clone(),
                version: file.version.clone(),
                text: None,
                choice: Some(GitMergeChoice::Current),
            }],
            &protection(),
        )
        .unwrap();
    assert_eq!(resolved.unresolved, 0);
    assert!(resolved.revision > candidate.revision);
    assert!(!resolved.files.iter().any(|file| file.path == "texture.png"));
    assert_eq!(head(&root), target);
}
#[test]
fn delete_modify_choice_preserves_missing_as_distinct_from_zero_bytes() {
    let (temp, root, mut access, id, _target, source) = fork(true);
    fs::remove_file(root.join("shared.txt")).unwrap();
    let target = record_version(&mut access, &id, "Remove shared");
    let candidate = prepare(&mut access, &id, &source, temp.path());
    let file = candidate
        .files
        .iter()
        .find(|file| file.path == "shared.txt")
        .unwrap();
    assert_eq!(file.conflict, Some(GitMergeConflictKind::DeleteModify));
    assert!(!file.current && file.incoming);
    let current = access
        .read_git_merge_file(
            &id,
            &candidate.id,
            "shared.txt",
            GitMergeSide::Current,
            &protection(),
        )
        .unwrap();
    assert!(!current.exists);
    assert_eq!(current.version, "missing");
    let resolved = access
        .edit_git_merge_owned(
            &id,
            &candidate.id,
            candidate.revision,
            None,
            vec![GitMergeEdit {
                path: file.path.clone(),
                version: file.version.clone(),
                text: None,
                choice: Some(GitMergeChoice::Current),
            }],
            &protection(),
        )
        .unwrap();
    assert_eq!(resolved.unresolved, 0);
    assert!(
        !access
            .read_git_merge_file(
                &id,
                &candidate.id,
                "shared.txt",
                GitMergeSide::Result,
                &protection()
            )
            .unwrap()
            .exists
    );
    let result = access
        .finish_git_merge(
            &id,
            &candidate.id,
            resolved.revision,
            "Creator",
            "",
            &protection(),
        )
        .unwrap();
    assert_eq!(
        Repository::open(&root)
            .unwrap()
            .find_commit(parse(result.result.as_deref().unwrap()).unwrap())
            .unwrap()
            .parent_id(0)
            .unwrap()
            .to_string(),
        target
    );
    assert!(!root.join("shared.txt").exists());
}
#[test]
fn detached_fast_forward_uses_exact_source_oid_and_a_new_route_without_new_commit() {
    let (temp, root, mut access, id, target, source) = fork(false);
    let repo = Repository::open(&root).unwrap();
    let base = repo
        .find_commit(parse(&target).unwrap())
        .unwrap()
        .parent_id(0)
        .unwrap();
    repo.reference("refs/heads/main", base, true, "test restore")
        .unwrap();
    checkout(&root, &base.to_string(), "refs/heads/main");
    repo.set_head_detached(base).unwrap();
    let candidate = prepare(&mut access, &id, &source, temp.path());
    assert_eq!(candidate.relation, GitMergeRelation::FastForward);
    assert!(access
        .edit_git_merge_owned(
            &id,
            &candidate.id,
            candidate.revision,
            None,
            vec![],
            &protection()
        )
        .is_err());
    let result = access
        .finish_git_merge(
            &id,
            &candidate.id,
            candidate.revision,
            "Creator",
            "",
            &protection(),
        )
        .unwrap();
    assert_eq!(result.result.as_deref(), Some(source.as_str()));
    assert_eq!(head(&root), source);
    assert!(repo
        .head()
        .unwrap()
        .name()
        .unwrap()
        .starts_with("refs/heads/pnds/merge-"));
    assert_eq!(
        repo.find_reference("refs/heads/main").unwrap().target(),
        Some(base)
    );
    assert_eq!(
        repo.find_reference("refs/heads/source")
            .unwrap()
            .target()
            .unwrap()
            .to_string(),
        source
    );
}
#[test]
fn a_divergent_same_tree_result_still_records_both_histories() {
    let (temp, root, mut access, id, target, source) = fork(false);
    let repo = Repository::open(&root).unwrap();
    let old_target = repo.find_commit(parse(&target).unwrap()).unwrap();
    let old_source = repo.find_commit(parse(&source).unwrap()).unwrap();
    let base = old_target.parent(0).unwrap();
    let signature = git2::Signature::now("Creator", "creator@example.test").unwrap();
    let target = repo
        .commit(
            Some("refs/heads/main"),
            &signature,
            &signature,
            "Current same tree",
            &base.tree().unwrap(),
            &[&old_target],
        )
        .unwrap();
    let source = repo
        .commit(
            Some("refs/heads/source"),
            &signature,
            &signature,
            "Incoming same tree",
            &base.tree().unwrap(),
            &[&old_source],
        )
        .unwrap();
    checkout(&root, &target.to_string(), "refs/heads/main");
    let candidate = prepare(&mut access, &id, &source.to_string(), temp.path());
    assert!(candidate.files.is_empty());
    let result = access
        .finish_git_merge(
            &id,
            &candidate.id,
            candidate.revision,
            "Creator",
            "",
            &protection(),
        )
        .unwrap();
    let commit = repo
        .find_commit(parse(result.result.as_deref().unwrap()).unwrap())
        .unwrap();
    assert_eq!(commit.tree_id(), base.tree_id());
    assert_eq!(commit.parent_count(), 2);
    assert_eq!(commit.parent_id(0).unwrap(), target);
    assert_eq!(commit.parent_id(1).unwrap(), source);
}
#[test]
fn no_write_round_does_not_destroy_prior_undo_and_round_tokens_survive_reopen() {
    let (temp, root, mut access, id, _target, source) = fork(false);
    let candidate = prepare(&mut access, &id, &source, temp.path());
    let round = access
        .begin_git_merge_round(&id, &candidate.id, candidate.revision, &protection())
        .unwrap();
    let file = access
        .read_git_merge_file(
            &id,
            &candidate.id,
            "right.txt",
            GitMergeSide::Result,
            &protection(),
        )
        .unwrap();
    let changed = access
        .edit_git_merge_owned(
            &id,
            &candidate.id,
            candidate.revision,
            Some(&round.id),
            vec![GitMergeEdit {
                path: "right.txt".into(),
                version: file.version,
                text: Some("assistant".into()),
                choice: None,
            }],
            &protection(),
        )
        .unwrap();
    access
        .end_git_merge_round(&id, &candidate.id, &round.id, &protection())
        .unwrap();
    let next = access
        .begin_git_merge_round(&id, &candidate.id, changed.revision, &protection())
        .unwrap();
    let ended = access
        .end_git_merge_round(&id, &candidate.id, &next.id, &protection())
        .unwrap();
    assert!(ended.can_undo);
    access
        .pause_git_merge_candidate(&id, &candidate.id, ended.revision, &protection())
        .unwrap();
    let mut reopened = CreationAccess::default();
    let id = reopened
        .open(&root, &protection())
        .unwrap()
        .project
        .identity;
    let paused = reopened.get_git_merge(&id, &protection()).unwrap().unwrap();
    reopened
        .resume_git_merge(&id, &candidate.id, paused.revision, &protection())
        .unwrap();
    let after = reopened
        .begin_git_merge_round(&id, &candidate.id, paused.revision, &protection())
        .unwrap();
    assert_ne!(round.id, after.id);
    assert_ne!(next.id, after.id);
}
fn wave(amplitude: i16) -> Vec<u8> {
    let count = 2205u32;
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + count * 2).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&22050u32.to_le_bytes());
    bytes.extend_from_slice(&44100u32.to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&(count * 2).to_le_bytes());
    for _ in 0..count {
        bytes.extend_from_slice(&amplitude.to_le_bytes());
    }
    bytes
}
#[test]
fn audio_comparison_returns_real_metadata_and_waveform_without_any_audio_payload() {
    let (temp, root, mut access, id, _target, source) = fork(false);
    fs::write(root.join("water.wav"), wave(4096)).unwrap();
    let target = record_version(&mut access, &id, "Current audio");
    checkout(&root, &source, "refs/heads/source");
    fs::write(root.join("water.wav"), wave(8192)).unwrap();
    let source = record_version(&mut access, &id, "Incoming audio");
    checkout(&root, &target, "refs/heads/main");
    let candidate = prepare(&mut access, &id, &source, temp.path());
    let content = access
        .read_git_merge_file(
            &id,
            &candidate.id,
            "water.wav",
            GitMergeSide::Incoming,
            &protection(),
        )
        .unwrap();
    assert!(content.url.is_none() && content.text.is_none());
    assert_eq!(content.sample_rate, Some(22050));
    assert_eq!(content.channels, Some(1));
    assert_eq!(content.duration_ms, Some(100));
    assert!(content
        .waveform
        .unwrap()
        .iter()
        .all(|peak| (*peak - 0.25).abs() < 0.001));
    let source = access
        .prepare_git_merge_audio(
            &id,
            &candidate.id,
            candidate.revision,
            "water.wav",
            GitMergeSide::Incoming,
            &content.version,
            &protection(),
        )
        .unwrap();
    assert_eq!(fs::read(source.path()).unwrap(), wave(8192));
}
#[test]
fn merge_author_uses_repository_identity_before_preferences_and_records_the_signature() {
    let (temp, root, mut access, id, _target, source) = fork(false);
    let repo = Repository::open(&root).unwrap();
    repo.config()
        .unwrap()
        .set_str("user.name", "Repository Artist")
        .unwrap();
    repo.config()
        .unwrap()
        .set_str("user.email", "repository@example.test")
        .unwrap();
    let candidate = prepare(&mut access, &id, &source, temp.path());
    let result = access
        .finish_git_merge(
            &id,
            &candidate.id,
            candidate.revision,
            "Preference Name",
            "preference@example.test",
            &protection(),
        )
        .unwrap();
    let commit = repo
        .find_commit(parse(result.result.as_deref().unwrap()).unwrap())
        .unwrap();
    assert_eq!(commit.author().name().unwrap(), "Repository Artist");
    assert_eq!(commit.author().email().unwrap(), "repository@example.test");
    let record = load(access.current(&id, &protection()).unwrap(), &candidate.id).unwrap();
    let intent = record.publication.unwrap();
    assert_eq!(intent.author_name, "Repository Artist");
    assert_eq!(intent.author_email, "repository@example.test");
    assert_eq!(intent.author_time, commit.author().when().seconds());
    assert_eq!(
        intent.author_offset,
        commit.author().when().offset_minutes()
    );
}

#[test]
fn pre_intent_failure_allows_editing_and_a_new_publication_attempt() {
    let (temp, root, mut access, id, target, source) = fork(false);
    let candidate = prepare(&mut access, &id, &source, temp.path());
    publication::FAULT.with(|fault| fault.set(Some(usize::MAX)));
    let failed = access.finish_git_merge(
        &id,
        &candidate.id,
        candidate.revision,
        "Creator",
        "",
        &protection(),
    );
    publication::FAULT.with(|fault| fault.set(None));
    assert!(failed.is_err());
    assert_eq!(head(&root), target);
    let stored = load(access.current(&id, &protection()).unwrap(), &candidate.id).unwrap();
    assert_eq!(stored.phase, GitMergePhase::Active);
    assert!(stored.publication.is_none());
    let edited = access
        .edit_git_merge_owned(
            &id,
            &candidate.id,
            candidate.revision,
            None,
            vec![GitMergeEdit {
                path: "retry.txt".into(),
                version: entry_version(None),
                text: Some("retry after failed staging\n".into()),
                choice: None,
            }],
            &protection(),
        )
        .unwrap();
    let completed = access
        .finish_git_merge(
            &id,
            &candidate.id,
            edited.revision,
            "Creator",
            "",
            &protection(),
        )
        .unwrap();
    assert_eq!(completed.phase, GitMergePhase::Completed);
    assert_eq!(
        fs::read_to_string(root.join("retry.txt")).unwrap(),
        "retry after failed staging\n"
    );
}

#[test]
fn candidate_edits_and_artifact_adoption_reject_collisions_without_journal_changes() {
    let (temp, root, mut access, id, target, source) = fork(false);
    let candidate = prepare(&mut access, &id, &source, temp.path());
    for paths in [["Alias.txt", "alias.txt"], ["part", "part/file.txt"]] {
        let round = access
            .begin_git_merge_round(&id, &candidate.id, candidate.revision, &protection())
            .unwrap();
        let edits = paths
            .into_iter()
            .map(|path| GitMergeEdit {
                path: path.into(),
                version: entry_version(None),
                text: Some("content".into()),
                choice: None,
            })
            .collect();
        assert!(access
            .edit_git_merge_owned(
                &id,
                &candidate.id,
                candidate.revision,
                Some(&round.id),
                edits,
                &protection()
            )
            .is_err());
        access
            .end_git_merge_round(&id, &candidate.id, &round.id, &protection())
            .unwrap();
        let stored = load(access.current(&id, &protection()).unwrap(), &candidate.id).unwrap();
        assert_eq!(stored.revision, candidate.revision);
        assert!(paths
            .into_iter()
            .all(|path| !stored.entries.contains_key(path)));
    }
    assert!(access
        .adopt_git_merge_artifacts(
            &id,
            &candidate.id,
            candidate.revision,
            vec![
                GitMergeArtifact {
                    path: "Tone.scsyndef".into(),
                    bytes: vec![1]
                },
                GitMergeArtifact {
                    path: "tone.scsyndef".into(),
                    bytes: vec![2]
                }
            ],
            &protection()
        )
        .is_err());
    assert_eq!(head(&root), target);
    let stored = load(access.current(&id, &protection()).unwrap(), &candidate.id).unwrap();
    assert_eq!(stored.revision, candidate.revision);
    assert!(!stored.entries.contains_key("Tone.scsyndef"));
}

#[test]
fn completed_recovery_retries_only_attached_steps_and_preserves_later_work() {
    let (temp, root, mut access, id, _target, source) = fork(false);
    let candidate = prepare(&mut access, &id, &source, temp.path());
    let completed = access
        .finish_git_merge(
            &id,
            &candidate.id,
            candidate.revision,
            "Creator",
            "",
            &protection(),
        )
        .unwrap();
    let project = access.current(&id, &protection()).unwrap();
    write_json(&private_root(project).unwrap().join(ACTIVE), &candidate.id).unwrap();
    fs::write(root.join("right.txt"), "later uncommitted work\n").unwrap();
    let recovered = access
        .recover_git_merge(&id, &candidate.id, completed.revision, &protection())
        .unwrap();
    assert_eq!(recovered.phase, GitMergePhase::Completed);
    assert_eq!(recovered.result, completed.result);
    assert_eq!(
        fs::read_to_string(root.join("right.txt")).unwrap(),
        "later uncommitted work\n"
    );
    assert!(active_id(access.current(&id, &protection()).unwrap())
        .unwrap()
        .is_none());
}

#[test]
fn unavailable_private_payload_keeps_a_durable_discardable_candidate() {
    let (temp, _root, mut access, id, _target, source) = fork(false);
    let candidate = prepare(&mut access, &id, &source, temp.path());
    let project = access.current(&id, &protection()).unwrap();
    fs::rename(
        operation_path(project, &candidate.id)
            .unwrap()
            .join("repository"),
        temp.path().join("removed-merge-repository"),
    )
    .unwrap();
    let restored = access.get_git_merge(&id, &protection()).unwrap().unwrap();
    assert_eq!(restored.id, candidate.id);
    assert_eq!(restored.phase, GitMergePhase::Stale);
    assert!(restored.detail.is_some());
    access
        .cancel_git_merge(&id, &candidate.id, restored.revision, &protection())
        .unwrap();
    assert!(access.get_git_merge(&id, &protection()).unwrap().is_none());
}

#[test]
fn unsupported_cross_version_file_directory_and_case_transitions_are_rejected_before_preparation() {
    for (old, new) in [
        ("part", "part/file.txt"),
        ("part/file.txt", "part"),
        ("Alias.txt", "alias.txt"),
    ] {
        let (temp, root, mut access, id, _target, source) = fork(false);
        checkout(&root, &source, "refs/heads/source");
        let repo = Repository::open(&root).unwrap();
        let old_source = repo.head().unwrap().peel_to_commit().unwrap();
        let mut entries = inventory(&repo, old_source.tree_id()).unwrap();
        let entry = Entry {
            oid: repo.blob(b"incoming").unwrap().to_string(),
            mode: 0o100644,
        };
        entries.insert(new.into(), entry);
        let tree = repo.find_tree(tree(&repo, &entries).unwrap()).unwrap();
        let signature = git2::Signature::now("Creator", "creator@example.test").unwrap();
        let source = repo
            .commit(
                None,
                &signature,
                &signature,
                "source transition",
                &tree,
                &[&old_source],
            )
            .unwrap();
        let main = repo
            .find_reference("refs/heads/main")
            .unwrap()
            .target()
            .unwrap();
        checkout(&root, &main.to_string(), "refs/heads/main");
        if let Some(parent) = Path::new(old).parent() {
            fs::create_dir_all(root.join(parent)).unwrap();
        }
        fs::write(root.join(old), b"current").unwrap();
        let target = record_version(&mut access, &id, "current transition");
        let result =
            access.prepare_git_merge(&id, &source.to_string(), false, temp.path(), &protection());
        assert!(result.is_err(), "{old} -> {new}");
        assert_eq!(head(&root), target);
        assert!(access.get_git_merge(&id, &protection()).unwrap().is_none());
        assert_eq!(fs::read(root.join(old)).unwrap(), b"current");
    }
}

#[test]
fn candidate_cannot_replace_a_tracked_file_with_a_directory_even_after_deleting_the_file() {
    let (temp, _root, mut access, id, _target, source) = fork(false);
    let candidate = prepare(&mut access, &id, &source, temp.path());
    let current = access
        .read_git_merge_file(
            &id,
            &candidate.id,
            "shared.txt",
            GitMergeSide::Result,
            &protection(),
        )
        .unwrap();
    let removed = access
        .edit_git_merge_owned(
            &id,
            &candidate.id,
            candidate.revision,
            None,
            vec![GitMergeEdit {
                path: "shared.txt".into(),
                version: current.version,
                text: None,
                choice: None,
            }],
            &protection(),
        )
        .unwrap();
    let failed = access.edit_git_merge_owned(
        &id,
        &candidate.id,
        removed.revision,
        None,
        vec![GitMergeEdit {
            path: "shared.txt/child.txt".into(),
            version: entry_version(None),
            text: Some("blocked".into()),
            choice: None,
        }],
        &protection(),
    );
    assert!(failed.is_err());
    let record = load(access.current(&id, &protection()).unwrap(), &candidate.id).unwrap();
    assert_eq!(record.revision, removed.revision);
    assert!(!record.entries.contains_key("shared.txt/child.txt"));
}

#[test]
fn private_repository_symbolic_config_is_not_followed_and_candidate_remains_discardable() {
    let (temp, _root, mut access, id, _target, source) = fork(false);
    let candidate = prepare(&mut access, &id, &source, temp.path());
    let project = access.current(&id, &protection()).unwrap();
    let config = operation_path(project, &candidate.id)
        .unwrap()
        .join("repository/config");
    let external = temp.path().join("external-git-config");
    fs::rename(&config, &external).unwrap();
    std::os::unix::fs::symlink(&external, &config).unwrap();
    let restored = access.get_git_merge(&id, &protection()).unwrap().unwrap();
    assert_eq!(restored.phase, GitMergePhase::Stale);
    access
        .cancel_git_merge(&id, &candidate.id, restored.revision, &protection())
        .unwrap();
    assert!(external.exists());
}

#[test]
fn recovery_never_treats_an_unrelated_standard_git_lock_as_its_own() {
    let (temp, root, mut access, id, target, source) = fork(false);
    let candidate = prepare(&mut access, &id, &source, temp.path());
    publication::FAULT.with(|fault| fault.set(Some(0)));
    let failed = access.finish_git_merge(
        &id,
        &candidate.id,
        candidate.revision,
        "Creator",
        "",
        &protection(),
    );
    publication::FAULT.with(|fault| fault.set(None));
    assert!(failed.is_err());
    let lock = root.join(".git/HEAD.lock");
    fs::write(&lock, b"another git operation\n").unwrap();
    assert!(access
        .recover_git_merge(&id, &candidate.id, candidate.revision, &protection())
        .is_err());
    assert_eq!(fs::read(&lock).unwrap(), b"another git operation\n");
    assert_eq!(head(&root), target);
    let stored = load(access.current(&id, &protection()).unwrap(), &candidate.id).unwrap();
    assert_eq!(stored.phase, GitMergePhase::Recovery);
}

#[test]
fn terminal_recovery_cleans_only_the_completed_operations_inode_owned_locks() {
    for owned in [true, false] {
        let (temp, root, mut access, id, _target, source) = fork(false);
        let candidate = prepare(&mut access, &id, &source, temp.path());
        let completed = access
            .finish_git_merge(
                &id,
                &candidate.id,
                candidate.revision,
                "Creator",
                "",
                &protection(),
            )
            .unwrap();
        let project = access.current(&id, &protection()).unwrap();
        write_json(&private_root(project).unwrap().join(ACTIVE), &candidate.id).unwrap();
        let lock = root.join(".git/HEAD.lock");
        if owned {
            fs::hard_link(
                operation_path(project, &candidate.id)
                    .unwrap()
                    .join("publication-head"),
                &lock,
            )
            .unwrap();
        } else {
            fs::write(&lock, b"foreign operation").unwrap();
        }
        fs::write(root.join("right.txt"), b"later work").unwrap();
        let result =
            access.recover_git_merge(&id, &candidate.id, completed.revision, &protection());
        assert_eq!(fs::read(root.join("right.txt")).unwrap(), b"later work");
        if owned {
            assert_eq!(result.unwrap().phase, GitMergePhase::Completed);
            assert!(!lock.exists());
        } else {
            assert!(result.is_err());
            assert_eq!(fs::read(&lock).unwrap(), b"foreign operation");
            let visible = access.get_git_merge(&id, &protection()).unwrap().unwrap();
            assert_eq!(visible.phase, GitMergePhase::Recovery);
            assert_eq!(
                load(access.current(&id, &protection()).unwrap(), &candidate.id)
                    .unwrap()
                    .phase,
                GitMergePhase::Completed
            );
            fs::remove_file(&lock).unwrap();
            let retried = access
                .recover_git_merge(&id, &candidate.id, visible.revision, &protection())
                .unwrap();
            assert_eq!(retried.phase, GitMergePhase::Completed);
            assert_eq!(fs::read(root.join("right.txt")).unwrap(), b"later work");
        }
    }
}
