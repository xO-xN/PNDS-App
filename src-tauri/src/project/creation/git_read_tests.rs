use super::git_read::{self, GitReadJob, GitReadOutput};
use super::git_versions_tests::{save as record, setup};
use super::tests::project;
use super::*;
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

// These bounds only prevent a broken test from hanging the suite. Lock
// availability, rather than elapsed time, is the concurrency assertion.
const GATE_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Copy)]
enum GateAt {
    BeforeRead,
    AfterRead,
}

struct GateJob<J> {
    job: J,
    at: GateAt,
    entered: mpsc::Sender<()>,
    resume: mpsc::Receiver<()>,
}

impl<J: GitReadJob> git_read::sealed::Sealed for GateJob<J> {}

impl<J: GitReadJob> GitReadJob for GateJob<J> {
    type Reply = J::Reply;

    fn run(self, reader: &GitReader) -> GitReadOutput<Self::Reply> {
        let pause = || {
            self.entered.send(()).unwrap();
            self.resume
                .recv_timeout(GATE_TIMEOUT)
                .expect("test did not release its real Git read");
        };
        match self.at {
            GateAt::BeforeRead => {
                pause();
                self.job.run(reader)
            }
            GateAt::AfterRead => {
                let output = self.job.run(reader);
                pause();
                output
            }
        }
    }
}

struct PausedRead<T> {
    resume: mpsc::Sender<()>,
    worker: JoinHandle<Result<T, CreationError>>,
}

impl<T> PausedRead<T> {
    fn finish(self) -> Result<T, CreationError> {
        self.resume.send(()).unwrap();
        self.worker.join().unwrap()
    }
}

fn paused_read<J: GitReadJob>(
    shared: Arc<Mutex<CreationAccess>>,
    at: GateAt,
    prepare: impl FnOnce(&mut CreationAccess, &Protection) -> Result<J, CreationError> + Send + 'static,
) -> PausedRead<J::Reply> {
    let (entered, started) = mpsc::channel();
    let (resume, waiting) = mpsc::channel();
    let worker = thread::spawn(move || {
        git_read::run_read(&shared, &Protection::default(), |access, protection| {
            Ok(GateJob {
                job: prepare(access, protection)?,
                at,
                entered,
                resume: waiting,
            })
        })
    });
    started
        .recv_timeout(GATE_TIMEOUT)
        .expect("real Git read did not reach the unlocked execution phase");
    PausedRead { resume, worker }
}

#[test]
fn paused_execution_releases_access_for_a_real_saved_file_write() {
    let (_temp, root, mut access, identity) = setup();
    let first = record(&mut access, &identity, "Initial project");
    let shared = Arc::new(Mutex::new(access));
    let read_identity = identity.clone();
    let reading = paused_read(shared.clone(), GateAt::BeforeRead, move |access, p| {
        access.prepare_git_version_graph(&read_identity, 0, p)
    });

    {
        let mut access = shared
            .try_lock()
            .expect("version execution retained the workspace lock");
        let CreationContent::Text { version, .. } = access
            .read(&identity, "server.js", &Protection::default())
            .unwrap()
        else {
            panic!("fixture server must be editable text");
        };
        access
            .save(
                &identity,
                "server.js",
                "// saved while a version read is executing",
                &version,
                &Protection::default(),
            )
            .unwrap();
    }

    let graph = reading.finish().unwrap();
    assert_eq!(graph.head.as_deref(), Some(first.as_str()));
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "// saved while a version read is executing"
    );
}

#[test]
fn graph_observation_allows_a_version_name_change_during_unlocked_execution() {
    let (_temp, _root, mut access, identity) = setup();
    let commit = record(&mut access, &identity, "Initial project");
    let shared = Arc::new(Mutex::new(access));
    let read_identity = identity.clone();
    let reading = paused_read(shared.clone(), GateAt::BeforeRead, move |access, p| {
        access.prepare_git_version_graph(&read_identity, 0, p)
    });

    shared
        .try_lock()
        .expect("version execution retained the workspace lock")
        .rename_git_version(
            &identity,
            &commit,
            "Initial project",
            "Renamed while reading",
            &Protection::default(),
        )
        .unwrap();

    let graph = reading.finish().unwrap();
    assert_eq!(graph.head.as_deref(), Some(commit.as_str()));
    assert_eq!(
        graph
            .versions
            .iter()
            .find(|version| version.id == commit)
            .unwrap()
            .message,
        "Renamed while reading"
    );
}

#[test]
fn completed_success_is_revoked_when_the_project_closes_before_finish() {
    let (_temp, _root, mut access, identity) = setup();
    record(&mut access, &identity, "Initial project");
    let shared = Arc::new(Mutex::new(access));
    let read_identity = identity.clone();
    let reading = paused_read(shared.clone(), GateAt::AfterRead, move |access, p| {
        access.prepare_git_history(&read_identity, p)
    });

    shared
        .try_lock()
        .expect("version completion retained the workspace lock")
        .close(&identity);
    assert_eq!(
        reading.finish().unwrap_err().code,
        CreationErrorCode::InvalidIdentity
    );
}

#[test]
fn a_completed_read_cannot_survive_project_replacement_or_same_path_reopening() {
    for reopen_original in [false, true] {
        let (temp, root, mut access, identity) = setup();
        record(&mut access, &identity, "Initial project");
        let other = project(temp.path(), "other");
        let shared = Arc::new(Mutex::new(access));
        let read_identity = identity.clone();
        let reading = paused_read(shared.clone(), GateAt::AfterRead, move |access, p| {
            access.prepare_git_history(&read_identity, p)
        });

        {
            let mut access = shared
                .try_lock()
                .expect("completed version read retained the workspace lock");
            let next = access.open(&other, &Protection::default()).unwrap();
            assert_ne!(next.project.identity, identity);
            if reopen_original {
                let reopened = access.open(&root, &Protection::default()).unwrap();
                assert_ne!(reopened.project.identity, identity);
            }
        }
        assert_eq!(
            reading.finish().unwrap_err().code,
            CreationErrorCode::InvalidIdentity
        );
    }
}

#[test]
fn held_root_replacement_cannot_return_a_completed_old_result() {
    let (temp, root, mut access, identity) = setup();
    record(&mut access, &identity, "Initial project");
    let original_head = fs::read(root.join(".git/HEAD")).unwrap();
    let shared = Arc::new(Mutex::new(access));
    let reading = paused_read(shared, GateAt::AfterRead, move |access, p| {
        access.prepare_git_history(&identity, p)
    });

    let held = temp.path().join("held-original");
    fs::rename(&root, &held).unwrap();
    let replacement = project(temp.path(), "versions");
    fs::write(
        replacement.join("server.js"),
        "// replacement must stay private",
    )
    .unwrap();

    assert_eq!(
        reading.finish().unwrap_err().code,
        CreationErrorCode::InvalidIdentity
    );
    assert_eq!(fs::read(held.join(".git/HEAD")).unwrap(), original_head);
    assert_eq!(
        fs::read_to_string(replacement.join("server.js")).unwrap(),
        "// replacement must stay private"
    );
    assert!(!replacement.join(".git").exists());
}

#[test]
fn revoked_identity_takes_priority_over_an_already_computed_repository_error() {
    let (temp, root, mut access, identity) = setup();
    record(&mut access, &identity, "Initial project");
    fs::rename(root.join(".git"), temp.path().join("held-git")).unwrap();
    let shared = Arc::new(Mutex::new(access));
    let ordinary_error = git_read::run_read(&shared, &Protection::default(), |access, p| {
        access.prepare_git_history(&identity, p)
    })
    .unwrap_err();
    assert_ne!(ordinary_error.code, CreationErrorCode::InvalidIdentity);

    let read_identity = identity.clone();
    let reading = paused_read(shared.clone(), GateAt::AfterRead, move |access, p| {
        access.prepare_git_history(&read_identity, p)
    });
    shared
        .try_lock()
        .expect("failed version read retained the workspace lock")
        .close(&identity);
    assert_eq!(
        reading.finish().unwrap_err().code,
        CreationErrorCode::InvalidIdentity
    );
}

fn inventory(root: &Path) -> BTreeMap<PathBuf, (Vec<u8>, u32)> {
    let mut files = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            let metadata = fs::symlink_metadata(&path).unwrap();
            if metadata.is_dir() {
                pending.push(path);
            } else {
                assert!(metadata.is_file());
                files.insert(
                    path.strip_prefix(root).unwrap().to_path_buf(),
                    (fs::read(&path).unwrap(), metadata.mode()),
                );
            }
        }
    }
    files
}

#[test]
fn all_eight_read_flows_use_real_repositories_without_mutating_saved_or_git_data() {
    let (_temp, root, mut access, identity) = setup();
    let commit = record(&mut access, &identity, "Initial project");
    let private = root.join(crate::creation_data::DIRECTORY);
    fs::create_dir_all(&private).unwrap();
    fs::write(private.join("history.json"), "private discussion").unwrap();
    let before = inventory(&root);
    let shared = Mutex::new(access);
    let protection = Protection::default();

    let graph = git_read::run_read(&shared, &protection, |access, p| {
        access.prepare_git_version_graph(&identity, 0, p)
    })
    .unwrap();
    assert_eq!(graph.head.as_deref(), Some(commit.as_str()));
    let paths = git_read::run_read(&shared, &protection, |access, p| {
        access.prepare_git_version_paths(&identity, &commit, p)
    })
    .unwrap();
    assert!(paths.is_empty());
    let history = git_read::run_read(&shared, &protection, |access, p| {
        access.prepare_git_history(&identity, p)
    })
    .unwrap();
    assert_eq!(history.commits[0].id, commit);
    let historical = git_read::run_read(&shared, &protection, |access, p| {
        access.prepare_git_history_file(&identity, &commit, "server.js", p)
    })
    .unwrap();
    assert!(historical.loadable);
    let version = git_read::run_read(&shared, &protection, |access, p| {
        access.prepare_git_version_file(&identity, &commit, "server.js", p)
    })
    .unwrap();
    assert_eq!(version.historical_text, historical.historical_text);
    let loaded = git_read::run_read(&shared, &protection, |access, p| {
        access.prepare_load_git_history_text(
            &identity,
            &commit,
            "server.js",
            historical.disk_version.as_deref().unwrap(),
            p,
        )
    })
    .unwrap();
    assert_eq!(loaded.saved_text, historical.saved_text);
    let comparison = git_read::run_read(&shared, &protection, |access, p| {
        access.prepare_git_comparison(
            &identity,
            GitComparisonRequest {
                commit: Some(commit.clone()),
                mode: GitComparisonMode::Saved,
                parent: None,
            },
            p,
        )
    })
    .unwrap();
    let diff = git_read::run_read(&shared, &protection, |access, p| {
        access.prepare_git_comparison_file(
            &identity,
            &GitComparisonFileRequest {
                token: comparison.token.clone(),
                path: "server.js".into(),
                full_context: false,
            },
            p,
        )
    })
    .unwrap();
    assert_eq!(diff.token, comparison.token);
    assert_eq!(diff.reason, None);
    assert!(diff.hunks.is_empty());
    assert_eq!(inventory(&root), before);
}
