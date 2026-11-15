//! Opt-in checkout acceptance against a private local project copy, never its source.
use super::git_versions_tests::{save, setup};
use super::*;
use git2::{IndexAddOption, ObjectType, Oid, Repository};
use std::collections::BTreeMap;
use std::io::Read;
use std::os::unix::fs::{MetadataExt, PermissionsExt};

fn external_commit(root: &Path, label: &str, paths: &[&str]) -> String {
    let repo = Repository::open(root).unwrap();
    let mut index = repo.index().unwrap();
    for path in paths {
        if root.join(path).exists() {
            index.add_all([path], IndexAddOption::FORCE, None).unwrap();
        } else {
            index.remove_path(Path::new(path)).unwrap();
        }
    }
    let tree_id = index.write_tree().unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let parent = repo.head().unwrap().peel_to_commit().unwrap();
    let signature = git2::Signature::now("Acceptance", "acceptance@example.test").unwrap();
    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        label,
        &tree,
        &[&parent],
    )
    .unwrap()
    .to_string()
}

fn write(root: &Path, path: &str, bytes: &[u8]) {
    let target = root.join(path);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(target, bytes).unwrap();
}

fn target_files(repo: &Repository, commit: &str) -> BTreeMap<String, (Oid, u32)> {
    let commit = repo.find_commit(Oid::from_str(commit).unwrap()).unwrap();
    let mut pending = vec![(commit.tree_id(), String::new())];
    let mut files = BTreeMap::new();
    while let Some((id, prefix)) = pending.pop() {
        let tree = repo.find_tree(id).unwrap();
        for entry in tree.iter() {
            let path = format!("{prefix}{}", entry.name().unwrap());
            if entry.kind() == Some(ObjectType::Tree) {
                pending.push((entry.id(), format!("{path}/")));
            } else {
                assert_eq!(entry.kind(), Some(ObjectType::Blob));
                assert!(matches!(entry.filemode(), 0o100644 | 0o100755));
                files.insert(path, (entry.id(), entry.filemode() as u32));
            }
        }
    }
    files
}

fn assert_checked_out(root: &Path, commit: &str) -> usize {
    let repo = Repository::open(root).unwrap();
    let files = target_files(&repo, commit);
    let index = repo.index().unwrap();
    assert_eq!(index.len(), files.len());
    for (path, (id, mode)) in &files {
        let full = root.join(path);
        let metadata = fs::symlink_metadata(&full).unwrap();
        assert!(metadata.is_file() && !metadata.is_symlink(), "{path}");
        let bytes = fs::read(&full).unwrap();
        assert_eq!(
            Oid::hash_object(ObjectType::Blob, &bytes).unwrap(),
            *id,
            "{path}"
        );
        assert_eq!(metadata.mode() & 0o111 != 0, *mode == 0o100755, "{path}");
        let entry = index.get_path(Path::new(path), 0).unwrap();
        assert_eq!(entry.id, *id, "{path}");
        assert_eq!(entry.mode, *mode, "{path}");
    }
    files.len()
}

#[test]
fn ordinary_generated_history_roundtrips_without_cleaning_unrelated_local_files() {
    let (temp, root, mut access, id) = setup();
    let data = temp.path().join("private");
    let first = save(&mut access, &id, "Before generated history");
    let artifacts = [
        ("build/archive.log", b"committed archive".as_slice()),
        (
            "node_modules/example/index.js",
            b"export default 42".as_slice(),
        ),
        ("dist/resource.bin", b"\0\x01\x02".as_slice()),
    ];
    for (path, bytes) in artifacts {
        write(&root, path, bytes);
    }
    let complete = external_commit(
        &root,
        "Imported complete saved history",
        &[
            "build/archive.log",
            "node_modules/example/index.js",
            "dist/resource.bin",
        ],
    );
    write(&root, ".pnds-creation/acceptance-canary", b"private state");
    write(&root, ".cache/unrelated.log", b"unrelated generated state");
    let preview = access
        .preview_git_switch(&id, &first, false, &data, &Protection::default())
        .unwrap();
    access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .unwrap();
    for (path, _) in artifacts {
        assert!(!root.join(path).exists(), "{path}");
    }
    write(&root, "build/archive.log", b"local archive to replace");
    let preview = access
        .preview_git_switch(&id, &complete, true, &data, &Protection::default())
        .unwrap();
    assert!(preview
        .overwritten_paths
        .contains(&"build/archive.log".to_owned()));
    assert!(!preview
        .discarded_paths
        .contains(&"build/archive.log".to_owned()));
    access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .unwrap();
    assert_checked_out(&root, &complete);
    assert_eq!(
        fs::read(root.join(".pnds-creation/acceptance-canary")).unwrap(),
        b"private state"
    );
    assert_eq!(
        fs::read(root.join(".cache/unrelated.log")).unwrap(),
        b"unrelated generated state"
    );
}

#[test]
fn checkout_token_hashes_ignored_historical_archive_bytes_under_generated_directories() {
    let (temp, root, mut access, id) = setup();
    let data = temp.path().join("private");
    save(&mut access, &id, "Initial project");
    write(&root, "logs/archive.log", b"recorded version");
    let recorded = external_commit(&root, "External archive", &["logs/archive.log"]);
    fs::remove_file(root.join("logs/archive.log")).unwrap();
    write(&root, ".gitignore", b"logs/\n");
    external_commit(
        &root,
        "Archive is absent",
        &["logs/archive.log", ".gitignore"],
    );
    write(&root, "logs/archive.log", b"pending one");
    write(&root, "logs/unrelated.log", b"keep this generated data");
    let preview = access
        .preview_git_switch(&id, &recorded, true, &data, &Protection::default())
        .unwrap();
    assert_eq!(preview.overwritten_paths, ["logs/archive.log"]);
    // Saving intentionally skips the entire logs directory. Checkout must still
    // bind these exact overwrite bytes, including an equal-length replacement.
    write(&root, "logs/archive.log", b"pending two");
    let error = access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .unwrap_err();
    assert_eq!(error.code, CreationErrorCode::VersionConflict);
    assert_eq!(
        fs::read(root.join("logs/archive.log")).unwrap(),
        b"pending two"
    );
    let reviewed = access
        .preview_git_switch(&id, &recorded, true, &data, &Protection::default())
        .unwrap();
    access
        .confirm_git_switch(&id, &reviewed.token, &data, &Protection::default())
        .unwrap();
    assert_eq!(
        fs::read(root.join("logs/archive.log")).unwrap(),
        b"recorded version"
    );
    assert_eq!(
        fs::read(root.join("logs/unrelated.log")).unwrap(),
        b"keep this generated data"
    );
}

fn entries(directory: &Path) -> Vec<fs::DirEntry> {
    let mut entries: Vec<_> = fs::read_dir(directory)
        .unwrap()
        .map(Result::unwrap)
        .collect();
    entries.sort_by_key(fs::DirEntry::file_name);
    entries
}

fn omitted(relative: &Path, inside_git: bool) -> bool {
    !inside_git
        && (crate::creation_data::contains(relative)
            || relative
                .components()
                .any(|part| part.as_os_str() == "node_modules"))
}

fn copy_source(source: &Path, target: &Path, relative: &Path, inside_git: bool) -> usize {
    fs::create_dir_all(target.join(relative)).unwrap();
    let mut count = 0;
    for entry in entries(&source.join(relative)) {
        let next = relative.join(entry.file_name());
        let git = inside_git || (relative.as_os_str().is_empty() && entry.file_name() == ".git");
        if omitted(&next, git) {
            continue;
        }
        let kind = entry.file_type().unwrap();
        assert!(
            !kind.is_symlink(),
            "Manual fixture contains a symbolic source entry"
        );
        if kind.is_dir() {
            count += copy_source(source, target, &next, git);
        } else {
            assert!(
                kind.is_file(),
                "Manual fixture contains a nonregular source entry"
            );
            fs::copy(entry.path(), target.join(next)).unwrap();
            count += 1;
        }
    }
    count
}

fn source_fingerprint(source: &Path) -> ring::digest::Digest {
    fn visit(source: &Path, relative: &Path, inside_git: bool, hash: &mut ring::digest::Context) {
        for entry in entries(&source.join(relative)) {
            let next = relative.join(entry.file_name());
            let git =
                inside_git || (relative.as_os_str().is_empty() && entry.file_name() == ".git");
            if omitted(&next, git) {
                continue;
            }
            hash.update(next.as_os_str().as_encoded_bytes());
            hash.update(b"\0");
            let metadata = fs::symlink_metadata(entry.path()).unwrap();
            assert!(!metadata.is_symlink());
            if metadata.is_dir() {
                hash.update(b"directory\0");
                visit(source, &next, git, hash);
            } else {
                assert!(metadata.is_file());
                hash.update(&metadata.len().to_le_bytes());
                hash.update(&metadata.permissions().mode().to_le_bytes());
                let mut file = File::open(entry.path()).unwrap();
                let mut buffer = [0; 64 * 1024];
                loop {
                    let count = file.read(&mut buffer).unwrap();
                    if count == 0 {
                        break;
                    }
                    hash.update(&buffer[..count]);
                }
            }
        }
    }
    let mut hash = ring::digest::Context::new(&ring::digest::SHA256);
    visit(source, Path::new(""), false, &mut hash);
    hash.finish()
}

#[test]
#[ignore = "Opt-in local project checkout acceptance; set PNDS_GIT_ACCEPTANCE_SOURCE/BRANCH/COMMIT"]
fn manual_checkout_of_a_real_project_copy_preserves_its_source_and_private_data() {
    let source = PathBuf::from(
        std::env::var_os("PNDS_GIT_ACCEPTANCE_SOURCE").expect("Set PNDS_GIT_ACCEPTANCE_SOURCE"),
    );
    let branch =
        std::env::var("PNDS_GIT_ACCEPTANCE_BRANCH").expect("Set PNDS_GIT_ACCEPTANCE_BRANCH");
    let commit =
        std::env::var("PNDS_GIT_ACCEPTANCE_COMMIT").expect("Set PNDS_GIT_ACCEPTANCE_COMMIT");
    let before = source_fingerprint(&source);
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("score");
    let copied = copy_source(&source, &root, Path::new(""), false);
    let data = temp.path().join("host-data");
    write(
        &root,
        ".pnds-creation/acceptance-canary",
        b"synthetic private data",
    );
    write(
        &root,
        ".cache/acceptance-unrelated.log",
        b"synthetic generated data",
    );
    let untracked = "acceptance-untracked-source.js";
    let mut access = CreationAccess::default();
    let id = access
        .open(&root, &Protection::default())
        .unwrap()
        .project
        .identity;
    let repo = Repository::open(&root).unwrap();
    let target = target_files(&repo, &commit);
    assert!(!target.contains_key(untracked));
    write(&root, untracked, b"discard only this temporary test source");
    let index = repo.index().unwrap();
    let expected_overwritten: Vec<_> = target
        .keys()
        .filter(|path| root.join(path).is_file() && index.get_path(Path::new(path), 0).is_none())
        .cloned()
        .collect();
    drop(index);
    drop(repo);
    let preview = access
        .preview_git_branch_switch(&id, (&branch, &commit), true, &data, &Protection::default())
        .unwrap();
    assert_eq!(preview.overwritten_paths, expected_overwritten);
    assert!(preview.discarded_paths.contains(&untracked.to_owned()));
    access
        .confirm_git_switch(&id, &preview.token, &data, &Protection::default())
        .unwrap();
    let files = assert_checked_out(&root, &commit);
    let checked = Repository::open(&root).unwrap();
    assert!(!checked.head_detached().unwrap());
    assert_eq!(
        checked.head().unwrap().shorthand().unwrap(),
        branch.as_str()
    );
    assert_eq!(
        checked.head().unwrap().target(),
        Some(Oid::from_str(&commit).unwrap())
    );
    assert!(!root.join(untracked).exists());
    assert_eq!(
        fs::read(root.join(".pnds-creation/acceptance-canary")).unwrap(),
        b"synthetic private data"
    );
    assert_eq!(
        fs::read(root.join(".cache/acceptance-unrelated.log")).unwrap(),
        b"synthetic generated data"
    );
    assert_eq!(
        source_fingerprint(&source).as_ref(),
        before.as_ref(),
        "The actual source project changed during manual acceptance"
    );
    println!("Manual copied-project checkout accepted: {copied} copied files, {files} exact target blobs, {} reviewed overwrites; actual source unchanged", expected_overwritten.len());
}
