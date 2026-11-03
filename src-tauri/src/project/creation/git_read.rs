//! Owned version reads: capture under the access lock, run without it, then
//! revalidate capability and comparison ownership before publishing anything.
use super::*;
use std::sync::Mutex;

pub(super) mod sealed {
    pub trait Sealed {}
}

pub(crate) trait GitReadJob: sealed::Sealed + Send + 'static {
    type Reply: Send + 'static;

    /// Even a failed read retains its capability for the completion check.
    fn run(self, reader: &GitReader) -> GitReadOutput<Self::Reply>;
}

pub(super) struct ReadProject {
    pub(super) descriptor: CreationProject,
    pub(super) directory: File,
    pub(super) root: PathBuf,
}

impl ReadProject {
    fn access(&self) -> read_root::RootAccess<'_> {
        read_root::RootAccess {
            root: &self.root,
            directory: &self.directory,
        }
    }

    pub(super) fn file(&self, path: &str) -> Result<File, CreationError> {
        self.access().file(path)
    }

    pub(super) fn read(&self, path: &str) -> Result<CreationContent, CreationError> {
        self.access().read(path)
    }

    pub(super) fn repository(&self) -> Result<git2::Repository, CreationError> {
        // Resolve through the held root, then refuse a moved/replaced path
        // instead of opening a different project through the original name.
        let held = native_git::held_path(&self.directory)?;
        if held != self.root {
            return Err(invalid_identity());
        }
        let disk = fs::metadata(&held).map_err(|_| invalid_identity())?;
        let original = self.directory.metadata().map_err(io_error)?;
        if disk.dev() != original.dev() || disk.ino() != original.ino() {
            return Err(invalid_identity());
        }
        native_git::repository(&held)
    }
}

fn invalid_identity() -> CreationError {
    CreationError::new(
        CreationErrorCode::InvalidIdentity,
        "Reopen the project folder",
    )
}

pub(super) enum ReadCompletion {
    Observation,
    ComparisonBuild {
        epoch: u64,
        session: Option<git_comparison::GitComparisonSession>,
    },
    ComparisonFile {
        epoch: u64,
        token: String,
    },
}

pub(crate) struct GitReadOutput<T> {
    project: ReadProject,
    result: Result<T, CreationError>,
    completion: ReadCompletion,
}

impl<T> GitReadOutput<T> {
    pub(super) fn observation(project: ReadProject, result: Result<T, CreationError>) -> Self {
        Self::new(project, result, ReadCompletion::Observation)
    }

    pub(super) fn new(
        project: ReadProject,
        result: Result<T, CreationError>,
        completion: ReadCompletion,
    ) -> Self {
        Self {
            project,
            result,
            completion,
        }
    }

    fn validate(
        &self,
        access: &CreationAccess,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let current = access.current(&self.project.descriptor.identity, protection)?;
        let captured = self.project.directory.metadata().map_err(io_error)?;
        let held = current.directory.metadata().map_err(io_error)?;
        if current.root != self.project.root
            || current.descriptor.source != self.project.descriptor.source
            || held.dev() != captured.dev()
            || held.ino() != captured.ino()
        {
            return Err(invalid_identity());
        }
        let current_comparison = match &self.completion {
            ReadCompletion::Observation => true,
            ReadCompletion::ComparisonBuild { epoch, .. } => *epoch == access.git_comparison_epoch,
            ReadCompletion::ComparisonFile { epoch, token } => {
                *epoch == access.git_comparison_epoch
                    && access.git_comparison.as_ref().is_some_and(|session| {
                        session.epoch == *epoch
                            && session.token == *token
                            && session.identity == self.project.descriptor.identity
                    })
            }
        };
        if !current_comparison {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Comparison changed; refresh",
            ));
        }
        Ok(())
    }

    /// Compatibility adapters for the original read fixtures use the same
    /// ownership checks; they never publish a comparison session.
    #[cfg(test)]
    pub(super) fn finish_readonly(
        self,
        access: &CreationAccess,
        protection: &Protection,
    ) -> Result<T, CreationError> {
        self.validate(access, protection)?;
        assert!(!matches!(
            self.completion,
            ReadCompletion::ComparisonBuild { .. }
        ));
        self.result
    }
}

impl CreationAccess {
    pub(super) fn prepare_read_project(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<ReadProject, CreationError> {
        let project = self.current(identity, protection)?;
        Ok(ReadProject {
            descriptor: project.descriptor.clone(),
            directory: project.directory.try_clone().map_err(io_error)?,
            root: project.root.clone(),
        })
    }

    pub(crate) fn finish_git_read<T>(
        &mut self,
        output: GitReadOutput<T>,
        protection: &Protection,
    ) -> Result<T, CreationError> {
        output.validate(self, protection)?;
        let report = output.result?;
        if let ReadCompletion::ComparisonBuild { session, .. } = output.completion {
            self.git_comparison = session;
        }
        Ok(report)
    }
}

/// Shared by the Tauri blocking worker and deterministic real-repository tests.
pub(crate) fn run_read<J: GitReadJob>(
    shared: &Mutex<CreationAccess>,
    protection: &Protection,
    prepare: impl FnOnce(&mut CreationAccess, &Protection) -> Result<J, CreationError>,
) -> Result<J::Reply, CreationError> {
    let lock_error =
        |_| CreationError::new(CreationErrorCode::Io, "Creation workspace lock failed");
    let job = {
        let mut access = shared.lock().map_err(lock_error)?;
        prepare(&mut access, protection)?
    };
    let output = job.run(&GitReader::default());
    let mut access = shared.lock().map_err(lock_error)?;
    access.finish_git_read(output, protection)
}
