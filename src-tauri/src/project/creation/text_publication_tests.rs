use super::*;
use std::cell::Cell;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use tempfile::TempDir;

struct Directory {
    temp: TempDir,
    file: File,
}

impl Directory {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let file = File::open(temp.path()).unwrap();
        Self { temp, file }
    }

    fn path(&self, name: &str) -> PathBuf {
        self.temp.path().join(name)
    }

    fn temporary_names(&self) -> Vec<PathBuf> {
        fs::read_dir(self.temp.path())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(".pnds-save-")
            })
            .collect()
    }
}

fn exact_create(mode: u32) -> PublishPolicy {
    PublishPolicy::Create {
        permissions: CreatePermissions::Exact(fs::Permissions::from_mode(mode)),
    }
}

fn publish(
    directory: &Directory,
    name: &CStr,
    bytes: &[u8],
    policy: PublishPolicy,
) -> Result<PublicationReceipt, CreationError> {
    publish_text_at(
        TextPublication {
            directory: &directory.file,
            name,
            bytes,
            policy,
        },
        || Ok(()),
    )
}

fn mode(path: &Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[test]
fn replaces_complete_text_with_captured_permissions_and_removes_staging() {
    let directory = Directory::new();
    let path = directory.path("谱面.js");
    fs::write(&path, "before").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o750)).unwrap();
    let text = "const title = '音符 🎼';\n".repeat(4096);
    let receipt = publish(
        &directory,
        c"谱面.js",
        text.as_bytes(),
        PublishPolicy::Replace {
            permissions: fs::metadata(&path).unwrap().permissions(),
        },
    )
    .unwrap();
    assert_eq!(receipt.state, PublicationState::Installed);
    assert!(receipt.cleanup_issue.is_none());
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
    assert_eq!(mode(&path), 0o750);
    assert!(directory.temporary_names().is_empty());
}

#[test]
fn creates_an_actual_empty_file_with_exact_permissions() {
    let directory = Directory::new();
    let receipt = publish(&directory, c"empty.md", b"", exact_create(0o600)).unwrap();
    assert_eq!(receipt.state, PublicationState::Installed);
    assert!(receipt.cleanup_issue.is_none());
    assert_eq!(fs::read(directory.path("empty.md")).unwrap(), b"");
    assert_eq!(mode(&directory.path("empty.md")), 0o600);
    assert!(directory.temporary_names().is_empty());
}

#[test]
fn create_never_clobbers_files_directories_or_symlinks() {
    for kind in ["file", "directory", "symlink", "dangling-symlink"] {
        let directory = Directory::new();
        let target = directory.path("target.md");
        let outside = tempfile::tempdir().unwrap();
        let external = outside.path().join("external.md");
        fs::write(&external, "external text").unwrap();
        match kind {
            "file" => fs::write(&target, "creator text").unwrap(),
            "directory" => fs::create_dir(&target).unwrap(),
            "symlink" => symlink(&external, &target).unwrap(),
            _ => symlink(outside.path().join("absent.md"), &target).unwrap(),
        }
        let receipt = publish(&directory, c"target.md", b"new", exact_create(0o644)).unwrap();
        assert_eq!(receipt.state, PublicationState::Occupied, "{kind}");
        assert!(receipt.cleanup_issue.is_none());
        assert_eq!(fs::read_to_string(&external).unwrap(), "external text");
        match kind {
            "file" => assert_eq!(fs::read_to_string(&target).unwrap(), "creator text"),
            "directory" => assert!(target.is_dir()),
            _ => assert!(fs::symlink_metadata(&target).unwrap().is_symlink()),
        }
        assert!(directory.temporary_names().is_empty());
    }
}

#[test]
fn rejects_non_basename_destinations_before_staging() {
    let directory = Directory::new();
    for name in ["", ".", "..", "parent/target.md"] {
        let name = CString::new(name).unwrap();
        assert_eq!(
            publish(&directory, &name, b"text", exact_create(0o600))
                .unwrap_err()
                .code,
            CreationErrorCode::InvalidProject
        );
        assert!(directory.temporary_names().is_empty());
    }
}

#[test]
fn guard_failure_preserves_existing_or_absent_target() {
    for replace in [false, true] {
        let directory = Directory::new();
        let target = directory.path("target.md");
        if replace {
            fs::write(&target, "before").unwrap();
        }
        let error = publish_text_at(
            TextPublication {
                directory: &directory.file,
                name: c"target.md",
                bytes: b"after",
                policy: if replace {
                    PublishPolicy::Replace {
                        permissions: fs::Permissions::from_mode(0o600),
                    }
                } else {
                    exact_create(0o600)
                },
            },
            || {
                Err(CreationError::new(
                    CreationErrorCode::VersionConflict,
                    "changed",
                ))
            },
        )
        .unwrap_err();
        assert_eq!(error.code, CreationErrorCode::VersionConflict);
        if replace {
            assert_eq!(fs::read_to_string(target).unwrap(), "before");
        } else {
            assert!(!target.exists());
        }
        assert!(directory.temporary_names().is_empty());
    }
}

#[test]
fn ordinary_prepublication_io_failures_preserve_target_and_cleanup() {
    use test_support::{with_failure, Phase};
    for phase in [
        Phase::Write,
        Phase::Permissions,
        Phase::Sync,
        Phase::Install,
    ] {
        for replace in [false, true] {
            let directory = Directory::new();
            let target = directory.path("target.md");
            if replace {
                fs::write(&target, "before").unwrap();
            }
            let guard_called = Cell::new(false);
            let error = with_failure(phase, || {
                publish_text_at(
                    TextPublication {
                        directory: &directory.file,
                        name: c"target.md",
                        bytes: b"after",
                        policy: if replace {
                            PublishPolicy::Replace {
                                permissions: fs::Permissions::from_mode(0o600),
                            }
                        } else {
                            exact_create(0o600)
                        },
                    },
                    || {
                        guard_called.set(true);
                        Ok(())
                    },
                )
            })
            .unwrap_err();
            assert_eq!(error.code, CreationErrorCode::Io);
            assert_eq!(guard_called.get(), phase == Phase::Install);
            if replace {
                assert_eq!(fs::read_to_string(target).unwrap(), "before");
            } else {
                assert!(!target.exists());
            }
            assert!(directory.temporary_names().is_empty());
        }
    }
}

#[test]
fn successful_install_is_not_reported_as_failure_when_cleanup_fails() {
    let directory = Directory::new();
    let receipt = test_support::with_failure(test_support::Phase::Cleanup, || {
        publish(&directory, c"target.md", b"installed", exact_create(0o600))
    })
    .unwrap();
    assert_eq!(receipt.state, PublicationState::Installed);
    assert!(receipt.cleanup_issue.is_some());
    assert_eq!(fs::read(directory.path("target.md")).unwrap(), b"installed");
    assert_eq!(directory.temporary_names().len(), 1);
    // The temp directory owns the remaining alias; the target was installed once.
    assert_eq!(
        fs::read(&directory.temporary_names()[0]).unwrap(),
        b"installed"
    );
}

#[test]
fn a_temporary_name_collision_never_arms_cleanup_for_someone_elses_entry() {
    for link in [false, true] {
        let directory = Directory::new();
        let occupied = directory.path(".pnds-save-collision.tmp");
        let outside = tempfile::tempdir().unwrap();
        let external = outside.path().join("external.txt");
        fs::write(&external, "external original").unwrap();
        if link {
            symlink(&external, &occupied).unwrap();
        } else {
            fs::write(&occupied, "unrelated temporary file").unwrap();
        }
        let error =
            test_support::with_temporary_name(c".pnds-save-collision.tmp".to_owned(), || {
                publish(&directory, c"target.md", b"new", exact_create(0o600))
            })
            .unwrap_err();
        assert_eq!(error.code, CreationErrorCode::Io);
        assert!(!directory.path("target.md").exists());
        assert!(fs::symlink_metadata(&occupied).is_ok());
        assert_eq!(fs::read_to_string(&external).unwrap(), "external original");
        if !link {
            assert_eq!(
                fs::read_to_string(&occupied).unwrap(),
                "unrelated temporary file"
            );
        }
    }
}

#[test]
fn final_hook_observes_complete_staged_text_and_runs_before_domain_guard() {
    let directory = Directory::new();
    let path = directory.path("target.md");
    fs::write(&path, "before").unwrap();
    let hook_ran = Rc::new(Cell::new(false));
    let observed = Rc::clone(&hook_ran);
    let parent = directory.temp.path().to_path_buf();
    let receipt = with_before_publish_hook(
        move || {
            assert_eq!(
                fs::read_to_string(parent.join("target.md")).unwrap(),
                "before"
            );
            let staged = fs::read_dir(&parent)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .find(|path| {
                    path.file_name()
                        .unwrap()
                        .to_string_lossy()
                        .starts_with(".pnds-save-")
                })
                .unwrap();
            assert_eq!(fs::read_to_string(&staged).unwrap(), "complete after text");
            assert_eq!(mode(&staged), 0o640);
            observed.set(true);
        },
        || {
            publish_text_at(
                TextPublication {
                    directory: &directory.file,
                    name: c"target.md",
                    bytes: b"complete after text",
                    policy: PublishPolicy::Replace {
                        permissions: fs::Permissions::from_mode(0o640),
                    },
                },
                || {
                    assert!(hook_ran.get());
                    Ok(())
                },
            )
        },
    )
    .unwrap();
    assert_eq!(receipt.state, PublicationState::Installed);
    assert!(directory.temporary_names().is_empty());
}

#[test]
fn a_filtered_hook_waits_for_its_target_after_private_publications() {
    let directory = Directory::new();
    let hook_ran = Rc::new(Cell::new(false));
    let observed = Rc::clone(&hook_ran);
    let root = directory.temp.path().to_path_buf();
    with_before_publish_hook_for(
        c"Race.js",
        move || {
            assert!(root.join("private-journal.json").is_file());
            assert!(root.join("private-baseline.json").is_file());
            assert!(!root.join("Race.js").exists());
            observed.set(true);
        },
        || {
            for name in [c"private-journal.json", c"private-baseline.json"] {
                let receipt = publish(&directory, name, b"{}", exact_create(0o600)).unwrap();
                assert_eq!(receipt.state, PublicationState::Installed);
                assert!(!hook_ran.get());
            }
            publish(&directory, c"Race.js", b"source", exact_create(0o644)).unwrap();
            assert!(hook_ran.get());
        },
    );
    assert_eq!(fs::read(directory.path("Race.js")).unwrap(), b"source");
    assert!(directory.temporary_names().is_empty());
}

#[test]
fn unwind_cleans_staging_and_restores_the_previous_hook() {
    let directory = Directory::new();
    let previous_ran = Rc::new(Cell::new(false));
    let previous = Rc::clone(&previous_ran);
    with_before_publish_hook(
        move || previous.set(true),
        || {
            let panicked = catch_unwind(AssertUnwindSafe(|| {
                with_before_publish_hook(
                    || panic!("publication gate panicked"),
                    || publish(&directory, c"never.md", b"new", exact_create(0o600)),
                )
            }));
            assert!(panicked.is_err());
            assert!(!directory.path("never.md").exists());
            assert!(directory.temporary_names().is_empty());
            publish(&directory, c"next.md", b"next", exact_create(0o600)).unwrap();
        },
    );
    assert!(previous_ran.get());
    assert!(directory.temporary_names().is_empty());
}

#[test]
fn a_panicking_domain_guard_cleans_its_staging_without_publishing() {
    let directory = Directory::new();
    let panicked = catch_unwind(AssertUnwindSafe(|| {
        publish_text_at(
            TextPublication {
                directory: &directory.file,
                name: c"target.md",
                bytes: b"after",
                policy: exact_create(0o600),
            },
            || panic!("domain validation panicked"),
        )
    }));
    assert!(panicked.is_err());
    assert!(!directory.path("target.md").exists());
    assert!(directory.temporary_names().is_empty());
}

#[test]
fn creation_modes_honor_umask_without_changing_exact_permissions() {
    const CHILD: &str = "PNDS_TEXT_PUBLICATION_UMASK_CHILD";
    if std::env::var(CHILD).as_deref() != Ok("1") {
        let test_name = "project::creation::text_publication::tests::creation_modes_honor_umask_without_changing_exact_permissions";
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", test_name, "--nocapture"])
            .env(CHILD, "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("running 1 test"));
        return;
    }
    let directory = Directory::new();
    // Only this isolated test process changes umask; parallel tests cannot see it.
    unsafe { libc::umask(0o777) };
    for (name, policy, expected) in [
        (
            c"assistant.js",
            PublishPolicy::Create {
                permissions: CreatePermissions::Umask(0o644),
            },
            0,
        ),
        (
            c"archive.md",
            PublishPolicy::Create {
                permissions: CreatePermissions::Umask(0o600),
            },
            0,
        ),
        (c"handoff.md", exact_create(0o644), 0o644),
        (c"private.json", exact_create(0o600), 0o600),
        (
            c"replaced.md",
            PublishPolicy::Replace {
                permissions: fs::Permissions::from_mode(0o640),
            },
            0o640,
        ),
    ] {
        let receipt = publish(&directory, name, b"text", policy).unwrap();
        assert_eq!(receipt.state, PublicationState::Installed);
        let path = directory
            .temp
            .path()
            .join(std::ffi::OsStr::from_bytes(name.to_bytes()));
        assert_eq!(mode(&path), expected);
    }
    assert!(directory.temporary_names().is_empty());
}
