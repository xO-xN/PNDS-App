use super::*;
use std::os::unix::fs::{symlink, PermissionsExt};
use text_publication::with_before_publish_hook;

struct SavedProject {
    temporary: tempfile::TempDir,
    root: PathBuf,
    access: CreationAccess,
    identity: String,
    protection: Protection,
}

impl SavedProject {
    fn new() -> Self {
        let temporary = tempfile::tempdir().unwrap();
        let root = tests::project(temporary.path(), "saved-publication");
        fs::create_dir(root.join("source")).unwrap();
        fs::write(root.join("source/score.js"), "before").unwrap();
        let protection = Protection::default();
        let mut access = CreationAccess::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        Self {
            temporary,
            root,
            access,
            identity,
            protection,
        }
    }

    fn version(&self, path: &str) -> String {
        let CreationContent::Text { version, .. } = self
            .access
            .read(&self.identity, path, &self.protection)
            .unwrap()
        else {
            panic!("expected saved text")
        };
        version
    }

    fn save(&mut self, path: &str, version: &str) -> Result<String, CreationError> {
        self.access
            .save(&self.identity, path, "after", version, &self.protection)
    }
}

fn assert_no_publication_temps(directory: &Path) {
    for entry in fs::read_dir(directory).unwrap() {
        let entry = entry.unwrap();
        assert!(
            !entry
                .file_name()
                .to_string_lossy()
                .starts_with(".pnds-save-"),
            "staging file remains: {}",
            entry.path().display()
        );
    }
}

#[test]
fn save_refuses_the_project_directory_even_through_a_text_named_alias() {
    let mut fixture = SavedProject::new();
    symlink(".", fixture.root.join("root-alias.js")).unwrap();
    for path in ["", ".", "root-alias.js"] {
        assert_eq!(
            fixture
                .save(path, &file_version(b"unused"))
                .unwrap_err()
                .code,
            CreationErrorCode::InvalidProject,
            "directory target {path:?}"
        );
    }
    assert_no_publication_temps(&fixture.root);
}

#[test]
fn save_rechecks_root_identity_after_staging_and_cleans_the_held_directory() {
    let mut fixture = SavedProject::new();
    let version = fixture.version("source/score.js");
    let root = fixture.root.clone();
    let displaced = fixture.temporary.path().join("displaced-root");
    let displaced_after = displaced.clone();
    let outcome = with_before_publish_hook(
        move || {
            fs::rename(&root, &displaced).unwrap();
            fs::create_dir(&root).unwrap();
            fs::create_dir(root.join("source")).unwrap();
            fs::write(root.join("source/score.js"), "replacement project").unwrap();
        },
        || fixture.save("source/score.js", &version),
    );
    assert_eq!(
        outcome.unwrap_err().code,
        CreationErrorCode::InvalidIdentity
    );
    assert_eq!(
        fs::read_to_string(fixture.root.join("source/score.js")).unwrap(),
        "replacement project"
    );
    assert_eq!(
        fs::read_to_string(displaced_after.join("source/score.js")).unwrap(),
        "before"
    );
    assert_no_publication_temps(&displaced_after.join("source"));
    assert_no_publication_temps(&fixture.root.join("source"));
}

#[test]
fn save_rejects_a_replaced_canonical_parent_and_cleans_its_displaced_parent() {
    let mut fixture = SavedProject::new();
    let version = fixture.version("source/score.js");
    let parent = fixture.root.join("source");
    let displaced = fixture.root.join("old-source");
    let displaced_after = displaced.clone();
    let outcome = with_before_publish_hook(
        move || {
            fs::rename(&parent, &displaced).unwrap();
            fs::create_dir(&parent).unwrap();
            fs::write(parent.join("score.js"), "replacement parent").unwrap();
        },
        || fixture.save("source/score.js", &version),
    );
    assert_eq!(
        outcome.unwrap_err().code,
        CreationErrorCode::VersionConflict
    );
    assert_eq!(
        fs::read_to_string(fixture.root.join("source/score.js")).unwrap(),
        "replacement parent"
    );
    assert_eq!(
        fs::read_to_string(displaced_after.join("score.js")).unwrap(),
        "before"
    );
    assert_no_publication_temps(&displaced_after);
    assert_no_publication_temps(&fixture.root.join("source"));
}

#[test]
fn save_refuses_changed_missing_symlink_and_nonregular_targets_after_staging() {
    for change in ["bytes", "missing", "symlink", "directory"] {
        let mut fixture = SavedProject::new();
        let version = fixture.version("source/score.js");
        let target = fixture.root.join("source/score.js");
        let outside = fixture.temporary.path().join("outside.js");
        fs::write(&outside, "external work").unwrap();
        let hook_outside = outside.clone();
        let outcome = with_before_publish_hook(
            move || match change {
                "bytes" => fs::write(&target, "external edit").unwrap(),
                "missing" => fs::remove_file(&target).unwrap(),
                "symlink" => {
                    fs::remove_file(&target).unwrap();
                    symlink(&hook_outside, &target).unwrap();
                }
                "directory" => {
                    fs::remove_file(&target).unwrap();
                    fs::create_dir(&target).unwrap();
                    fs::write(target.join("creator.txt"), "keep").unwrap();
                }
                _ => unreachable!(),
            },
            || fixture.save("source/score.js", &version),
        );
        assert!(outcome.is_err(), "changed target accepted: {change}");
        let target = fixture.root.join("source/score.js");
        match change {
            "bytes" => assert_eq!(fs::read_to_string(&target).unwrap(), "external edit"),
            "missing" => assert!(!target.exists()),
            "symlink" => assert!(fs::symlink_metadata(&target)
                .unwrap()
                .file_type()
                .is_symlink()),
            "directory" => {
                assert!(target.is_dir());
                assert_eq!(
                    fs::read_to_string(target.join("creator.txt")).unwrap(),
                    "keep"
                );
            }
            _ => unreachable!(),
        }
        assert_eq!(fs::read_to_string(outside).unwrap(), "external work");
        assert_no_publication_temps(&fixture.root.join("source"));
    }
}

#[test]
fn save_uses_the_captured_target_when_an_internal_file_alias_is_rebound() {
    let mut fixture = SavedProject::new();
    fs::write(fixture.root.join("source/other.js"), "other source").unwrap();
    let alias = fixture.root.join("alias.js");
    symlink("source/score.js", &alias).unwrap();
    let version = fixture.version("alias.js");
    let outcome = with_before_publish_hook(
        move || {
            fs::remove_file(&alias).unwrap();
            symlink("source/other.js", &alias).unwrap();
        },
        || fixture.save("alias.js", &version),
    );
    assert_eq!(outcome.unwrap(), file_version(b"after"));
    assert_eq!(
        fs::read_to_string(fixture.root.join("source/score.js")).unwrap(),
        "after"
    );
    assert_eq!(
        fs::read_to_string(fixture.root.join("alias.js")).unwrap(),
        "other source"
    );
    assert!(fs::symlink_metadata(fixture.root.join("alias.js"))
        .unwrap()
        .file_type()
        .is_symlink());
    assert_no_publication_temps(&fixture.root.join("source"));
    assert_no_publication_temps(&fixture.root);
}

#[test]
fn save_accepts_same_bytes_with_a_new_inode_and_keeps_captured_permissions() {
    let mut fixture = SavedProject::new();
    let target = fixture.root.join("source/score.js");
    fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).unwrap();
    let version = fixture.version("source/score.js");
    let replacement = fixture.root.join("source/external-same-bytes.js");
    let outcome = with_before_publish_hook(
        move || {
            fs::write(&replacement, "before").unwrap();
            fs::set_permissions(&replacement, fs::Permissions::from_mode(0o755)).unwrap();
            fs::rename(&replacement, &target).unwrap();
        },
        || fixture.save("source/score.js", &version),
    );
    assert_eq!(outcome.unwrap(), file_version(b"after"));
    let target = fixture.root.join("source/score.js");
    assert_eq!(fs::read_to_string(&target).unwrap(), "after");
    assert_eq!(
        fs::metadata(target).unwrap().permissions().mode() & 0o777,
        0o640
    );
    assert_no_publication_temps(&fixture.root.join("source"));
}

#[test]
fn save_replaces_only_the_selected_directory_entry_when_target_has_a_hardlink() {
    let mut fixture = SavedProject::new();
    let target = fixture.root.join("source/score.js");
    let linked = fixture.root.join("linked.js");
    fs::hard_link(&target, &linked).unwrap();
    let version = fixture.version("source/score.js");
    assert_eq!(
        fixture.save("source/score.js", &version).unwrap(),
        file_version(b"after")
    );
    assert_eq!(fs::read_to_string(target).unwrap(), "after");
    assert_eq!(fs::read_to_string(linked).unwrap(), "before");
    assert_no_publication_temps(&fixture.root.join("source"));
}

#[test]
fn save_uses_the_captured_target_when_an_internal_directory_alias_is_rebound() {
    let mut fixture = SavedProject::new();
    fs::create_dir(fixture.root.join("other-source")).unwrap();
    fs::write(
        fixture.root.join("other-source/score.js"),
        "other directory source",
    )
    .unwrap();
    let alias = fixture.root.join("alias-directory");
    symlink("source", &alias).unwrap();
    let version = fixture.version("alias-directory/score.js");
    let outcome = with_before_publish_hook(
        move || {
            fs::remove_file(&alias).unwrap();
            symlink("other-source", &alias).unwrap();
        },
        || fixture.save("alias-directory/score.js", &version),
    );
    assert_eq!(outcome.unwrap(), file_version(b"after"));
    assert_eq!(
        fs::read_to_string(fixture.root.join("source/score.js")).unwrap(),
        "after"
    );
    assert_eq!(
        fs::read_to_string(fixture.root.join("alias-directory/score.js")).unwrap(),
        "other directory source"
    );
    assert_no_publication_temps(&fixture.root.join("source"));
    assert_no_publication_temps(&fixture.root.join("other-source"));
}
