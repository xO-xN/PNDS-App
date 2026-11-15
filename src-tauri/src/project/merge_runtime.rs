//! Explicit ownership for the one main engine when it runs a saved merge copy.
use super::creation::{CreationError, CreationErrorCode, GitMergeSnapshot};
use super::session::{CreationRuntime, SessionManager};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64},
    Arc, Condvar, Mutex,
};

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeRuntimeOwner {
    pub identity: String,
    pub project_root: String,
    pub candidate_id: String,
    pub revision: u32,
    pub execution_path: String,
    pub generation: String,
}

pub(crate) struct MergeExecution {
    pub root: PathBuf,
    pub _directory: tempfile::TempDir,
    pub saved: GitMergeSnapshot,
    pub source_inputs: super::check_evidence::InputEvidence,
}

pub(crate) struct OwnedMergeRuntime {
    pub owner: GitMergeRuntimeOwner,
    pub _execution: MergeExecution,
}

#[derive(Clone)]
pub(crate) struct MergeOperation {
    pub identity: String,
    pub candidate_id: String,
    pub round_id: Option<String>,
    pub cancelled: Arc<AtomicBool>,
    pub completed: Arc<(Mutex<bool>, Condvar)>,
}

#[derive(Clone)]
pub(crate) struct MergeAudition {
    pub identity: String,
    pub candidate_id: String,
    pub token: String,
}

#[derive(Default)]
pub struct MergeRuntimeState {
    shutting_down: AtomicBool,
    pub(crate) transition_sequence: AtomicU64,
    pub(crate) runtime: Mutex<Option<OwnedMergeRuntime>>,
    pub(crate) operation: Mutex<Option<MergeOperation>>,
    pub(crate) audition: Mutex<Option<MergeAudition>>,
    pub(crate) transitioning: Mutex<BTreeMap<(String, String), u64>>,
}

impl MergeRuntimeState {
    pub(crate) fn accepting_operations(&self) -> bool {
        !self
            .shutting_down
            .load(std::sync::atomic::Ordering::Acquire)
    }

    pub fn resume_operations(&self) {
        self.shutting_down
            .store(false, std::sync::atomic::Ordering::Release);
    }

    pub fn shutdown_operations(&self) -> Result<(), String> {
        self.shutting_down
            .store(true, std::sync::atomic::Ordering::Release);
        // A saved-copy start holds this lock through admission/spawning. Quit
        // must retry rather than stop the engine before that start completes.
        drop(
            self.runtime
                .try_lock()
                .map_err(|_| "A merge test is starting; retry quitting after it settles")?,
        );
        let operation = self
            .operation
            .lock()
            .map_err(|_| "Merge operation lock failed")?
            .clone();
        if let Some(operation) = operation {
            operation
                .cancelled
                .store(true, std::sync::atomic::Ordering::Release);
            let (done, changed) = &*operation.completed;
            let done = done.lock().map_err(|_| "Merge completion lock failed")?;
            let (done, _) = changed
                .wait_timeout_while(done, std::time::Duration::from_secs(10), |done| !*done)
                .map_err(|_| "Merge cleanup wait failed")?;
            if !*done {
                return Err("Merge check cleanup is not confirmed".into());
            }
        }
        Ok(())
    }
    pub fn annotate(&self, runtime: &mut CreationRuntime) {
        let owner = self
            .runtime
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(run) = owner.as_ref().filter(|run| {
            run.owner.generation == runtime.generation
                && runtime.snapshot.project_path.as_deref()
                    == Some(run.owner.execution_path.as_str())
        }) {
            runtime.project_root = Some(run.owner.project_root.clone());
            runtime.merge = Some(run.owner.clone());
        }
    }

    pub fn current(&self, manager: &SessionManager) -> CreationRuntime {
        let mut runtime = manager.creation_runtime();
        self.annotate(&mut runtime);
        runtime
    }
}

/// Ready is published only after the main engine confirms all predecessor
/// cleanup. A different ready path therefore proves this older copy is retired.
pub(crate) fn previous_run_is_retired(
    owner: &GitMergeRuntimeOwner,
    current: &CreationRuntime,
) -> bool {
    current.generation != owner.generation
        && current.snapshot.status == crate::types::SessionStatus::Ready
        && current
            .snapshot
            .project_path
            .as_deref()
            .is_some_and(|path| path != owner.execution_path)
}

pub(crate) fn error(detail: impl Into<String>) -> CreationError {
    CreationError::new(CreationErrorCode::TestValidation, detail)
}

/// Bounded saved-copy service includes installed dependencies; then replace all
/// versioned paths with the exact candidate tree, including actual deletions.
pub(crate) fn execution_copy(
    saved: GitMergeSnapshot,
    data: &Path,
    cancelled: &AtomicBool,
) -> Result<MergeExecution, CreationError> {
    let runs = data.join("merge-runs");
    std::fs::create_dir_all(&runs).map_err(|cause| error(cause.to_string()))?;
    let directory = tempfile::Builder::new()
        .prefix("merge-")
        .tempdir_in(runs)
        .map_err(|cause| error(cause.to_string()))?;
    let snapshot = super::check_evidence::prepare_snapshot(
        &saved.project_root,
        None,
        directory.path(),
        cancelled,
        |_, _| {},
    )
    .map_err(error)?;
    let mut old_directories = BTreeSet::new();
    for path in &saved.managed_paths {
        if Path::new(path)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        {
            return Err(error("Invalid merge runtime path"));
        }
        let target = snapshot.project_root.join(path);
        let mut parent = target.parent();
        while let Some(directory) = parent.filter(|path| *path != snapshot.project_root) {
            old_directories.insert(directory.to_path_buf());
            parent = directory.parent();
        }
        match std::fs::symlink_metadata(&target) {
            Ok(metadata) if metadata.is_file() && !metadata.is_symlink() => {
                std::fs::remove_file(target).map_err(|cause| error(cause.to_string()))?;
            }
            Ok(metadata) if metadata.is_dir() && !metadata.is_symlink() => {
                old_directories.insert(target);
            }
            Ok(_) => return Err(error("A merge runtime file is occupied by another type")),
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {}
            Err(cause) => return Err(error(cause.to_string())),
        }
    }
    for directory in old_directories.into_iter().rev() {
        match std::fs::remove_dir(directory) {
            Ok(()) => {}
            Err(cause)
                if matches!(
                    cause.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
                ) => {}
            Err(cause) => return Err(error(cause.to_string())),
        }
    }
    let mut pending = vec![PathBuf::new()];
    while let Some(relative) = pending.pop() {
        for entry in std::fs::read_dir(saved.root.join(&relative))
            .map_err(|cause| error(cause.to_string()))?
        {
            if cancelled.load(std::sync::atomic::Ordering::Acquire) {
                return Err(CreationError::new(
                    CreationErrorCode::Cancelled,
                    "Merge copy cancelled",
                ));
            }
            let entry = entry.map_err(|cause| error(cause.to_string()))?;
            let path = relative.join(entry.file_name());
            let metadata = std::fs::symlink_metadata(entry.path())
                .map_err(|cause| error(cause.to_string()))?;
            let target = snapshot.project_root.join(&path);
            if metadata.is_symlink() {
                return Err(error("Merge runtime inputs cannot be symbolic links"));
            }
            if metadata.is_dir() {
                std::fs::create_dir_all(&target).map_err(|cause| error(cause.to_string()))?;
                pending.push(path);
            } else if metadata.is_file() {
                // Removing old tracked leaves can leave an empty directory
                // where the saved Git result now has one ordinary file.
                if target.is_dir() {
                    std::fs::remove_dir(&target).map_err(|cause| error(cause.to_string()))?;
                }
                std::fs::copy(entry.path(), target).map_err(|cause| error(cause.to_string()))?;
            } else {
                return Err(error("Unsupported merge runtime input"));
            }
        }
    }
    Ok(MergeExecution {
        root: snapshot.project_root,
        _directory: directory,
        saved,
        source_inputs: snapshot.evidence,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::creation::{GitMergeCandidate, GitMergePhase, GitMergeRelation};

    fn saved_candidate(project: &Path) -> GitMergeSnapshot {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("changed.js"), "candidate result").unwrap();
        GitMergeSnapshot {
            candidate: GitMergeCandidate {
                id: "merge".into(),
                revision: 2,
                relation: GitMergeRelation::Diverged,
                phase: GitMergePhase::Active,
                source: "source".into(),
                target: "target".into(),
                base: None,
                branch: Some("main".into()),
                name: "Merge".into(),
                files: vec![],
                unresolved: 0,
                result: None,
                detail: None,
                assistant_owner: None,
                can_undo: false,
            },
            project_root: project.to_path_buf(),
            fingerprint: "tree".into(),
            root: directory.path().to_path_buf(),
            _directory: directory,
            managed_paths: vec!["changed.js".into(), "removed.js".into()],
        }
    }

    #[test]
    fn saved_candidate_execution_keeps_installed_dependencies_and_actual_deletions_isolated() {
        let project = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("manifest.json"), r#"{"id":"sample"}"#).unwrap();
        std::fs::write(project.path().join("changed.js"), "original").unwrap();
        std::fs::write(
            project.path().join("removed.js"),
            "removed only in candidate",
        )
        .unwrap();
        std::fs::create_dir_all(project.path().join("node_modules/local")).unwrap();
        std::fs::write(
            project.path().join("node_modules/local/index.js"),
            "installed dependency",
        )
        .unwrap();
        std::fs::create_dir(project.path().join(".pnds-creation")).unwrap();
        std::fs::write(
            project.path().join(".pnds-creation/private.json"),
            "must not enter runtime",
        )
        .unwrap();
        let execution = execution_copy(
            saved_candidate(project.path()),
            data.path(),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(execution.root.join("changed.js")).unwrap(),
            "candidate result"
        );
        assert!(!execution.root.join("removed.js").exists());
        assert_eq!(
            std::fs::read_to_string(execution.root.join("node_modules/local/index.js")).unwrap(),
            "installed dependency"
        );
        assert!(!execution.root.join(".pnds-creation").exists());
        assert_eq!(
            std::fs::read_to_string(project.path().join("changed.js")).unwrap(),
            "original"
        );
        assert!(project.path().join("removed.js").exists());
        let root = execution.root.clone();
        let saved = execution.saved.root.clone();
        std::fs::write(root.join("runtime-output.log"), "relative runtime output").unwrap();
        assert!(!project.path().join("runtime-output.log").exists());
        drop(execution);
        assert!(!root.exists());
        assert!(!saved.exists());
    }

    #[test]
    fn a_new_foreign_ready_generation_proves_retirement_but_starting_and_same_path_do_not() {
        let owner = GitMergeRuntimeOwner {
            identity: "identity".into(),
            project_root: "/project".into(),
            candidate_id: "merge".into(),
            revision: 1,
            execution_path: "/copy".into(),
            generation: "1".into(),
        };
        let mut current = SessionManager::default().creation_runtime();
        current.generation = "2".into();
        current.snapshot.project_path = Some("/other".into());
        current.snapshot.status = crate::types::SessionStatus::Starting;
        assert!(!previous_run_is_retired(&owner, &current));
        current.snapshot.status = crate::types::SessionStatus::Ready;
        assert!(previous_run_is_retired(&owner, &current));
        current.snapshot.project_path = Some("/copy".into());
        assert!(!previous_run_is_retired(&owner, &current));
        current.snapshot.project_path = Some("/other".into());
        current.generation = "1".into();
        assert!(!previous_run_is_retired(&owner, &current));
    }

    #[test]
    fn a_candidate_can_replace_an_old_tracked_directory_with_a_file() {
        let project = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("manifest.json"), r#"{"id":"sample"}"#).unwrap();
        std::fs::create_dir_all(project.path().join("part/nested")).unwrap();
        std::fs::write(project.path().join("part/nested/old.js"), "old").unwrap();
        let mut saved = saved_candidate(project.path());
        saved.managed_paths.push("part/nested/old.js".into());
        saved.managed_paths.push("part".into());
        std::fs::write(saved.root.join("part"), "candidate file").unwrap();
        let execution = execution_copy(saved, data.path(), &AtomicBool::new(false)).unwrap();
        assert_eq!(
            std::fs::read_to_string(execution.root.join("part")).unwrap(),
            "candidate file"
        );
        assert!(project.path().join("part/nested/old.js").is_file());
    }

    #[test]
    fn quit_closes_merge_admission_until_explicit_failure_rollback() {
        let state = MergeRuntimeState::default();
        assert!(state.accepting_operations());
        state.shutdown_operations().unwrap();
        assert!(!state.accepting_operations());
        state.resume_operations();
        assert!(state.accepting_operations());
        let _starting = state.runtime.lock().unwrap();
        assert!(state.shutdown_operations().is_err());
        assert!(!state.accepting_operations());
        state.resume_operations();
        assert!(state.accepting_operations());
    }
}
