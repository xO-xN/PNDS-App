//! Cancellation and progress bypass the creation access lock held by a file scan.
use super::{CreationError, CreationErrorCode};
use ring::rand::{SecureRandom, SystemRandom};
use serde::Serialize;
use specta::Type;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HandoffOperationPhase {
    Reading,
    Hashing,
    Publishing,
    Complete,
    Cancelled,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HandoffOperationProgress {
    pub phase: HandoffOperationPhase,
    pub cancellable: bool,
    pub path: Option<String>,
    pub bytes_read: f64,
    pub bytes_total: f64,
    pub files: u32,
}
struct OperationState {
    progress: HandoffOperationProgress,
    cancelled: bool,
    finished: bool,
    started: bool,
}
pub struct HandoffOperation {
    owner: String,
    state: Mutex<OperationState>,
}
impl HandoffOperation {
    pub fn new(owner: &str) -> Self {
        Self {
            owner: owner.into(),
            state: Mutex::new(OperationState {
                progress: HandoffOperationProgress {
                    phase: HandoffOperationPhase::Reading,
                    cancellable: true,
                    path: None,
                    bytes_read: 0.0,
                    bytes_total: 0.0,
                    files: 0,
                },
                cancelled: false,
                finished: false,
                started: false,
            }),
        }
    }
    pub fn check(&self, owner: &str) -> Result<(), CreationError> {
        let state = self.state.lock().map_err(|_| failure())?;
        if self.owner != owner {
            return Err(CreationError::new(
                CreationErrorCode::InvalidIdentity,
                "Handoff operation owner changed",
            ));
        }
        if state.cancelled {
            return Err(CreationError::new(
                CreationErrorCode::Cancelled,
                "Handoff collection cancelled; any captured origin is retained",
            ));
        }
        Ok(())
    }
    pub fn claim(&self, owner: &str) -> Result<(), CreationError> {
        self.check(owner)?;
        let mut state = self.state.lock().map_err(|_| failure())?;
        if state.cancelled {
            return Err(CreationError::new(
                CreationErrorCode::Cancelled,
                "Handoff collection cancelled",
            ));
        }
        if state.started || state.finished {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Start a fresh handoff operation",
            ));
        }
        state.started = true;
        Ok(())
    }
    pub fn progress(&self) -> Result<HandoffOperationProgress, CreationError> {
        Ok(self.state.lock().map_err(|_| failure())?.progress.clone())
    }
    pub fn hashing(
        &self,
        path: &str,
        read: u64,
        total: u64,
        files: u32,
    ) -> Result<(), CreationError> {
        self.check(&self.owner)?;
        let mut state = self.state.lock().map_err(|_| failure())?;
        if !state.cancelled {
            state.progress = HandoffOperationProgress {
                phase: HandoffOperationPhase::Hashing,
                cancellable: true,
                path: Some(path.into()),
                bytes_read: read as f64,
                bytes_total: total as f64,
                files,
            };
        }
        Ok(())
    }
    pub fn begin_publication(&self) -> Result<(), CreationError> {
        let mut state = self.state.lock().map_err(|_| failure())?;
        if state.cancelled {
            return Err(CreationError::new(
                CreationErrorCode::Cancelled,
                "Handoff collection cancelled; the captured origin is retained",
            ));
        }
        state.progress.phase = HandoffOperationPhase::Publishing;
        state.progress.cancellable = false;
        Ok(())
    }
    pub fn cancel(&self) -> Result<HandoffOperationProgress, CreationError> {
        let mut state = self.state.lock().map_err(|_| failure())?;
        if state.progress.cancellable && !state.finished {
            state.cancelled = true;
            state.finished = true;
            state.progress.phase = HandoffOperationPhase::Cancelled;
            state.progress.cancellable = false;
        }
        Ok(state.progress.clone())
    }
    pub fn finish(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.finished = true;
            state.progress.cancellable = false;
            if !state.cancelled {
                state.progress.phase = HandoffOperationPhase::Complete;
            }
        }
    }
}
fn failure() -> CreationError {
    CreationError::new(CreationErrorCode::Io, "Handoff progress lock failed")
}
#[derive(Default)]
pub struct HandoffOperations {
    operations: Mutex<BTreeMap<String, Arc<HandoffOperation>>>,
}
impl HandoffOperations {
    pub fn begin(&self, owner: &str) -> Result<String, CreationError> {
        let mut operations = self.operations.lock().map_err(|_| failure())?;
        operations.retain(|_, operation| operation.state.lock().is_ok_and(|state| !state.finished));
        if operations.len() >= 16 {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                "Finish or cancel the active handoff operations",
            ));
        }
        let mut random = [0u8; 32];
        SystemRandom::new()
            .fill(&mut random)
            .map_err(|_| failure())?;
        let id: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        operations.insert(id.clone(), Arc::new(HandoffOperation::new(owner)));
        Ok(id)
    }
    pub fn get(&self, id: &str) -> Result<Arc<HandoffOperation>, CreationError> {
        self.operations
            .lock()
            .map_err(|_| failure())?
            .get(id)
            .cloned()
            .ok_or_else(|| {
                CreationError::new(
                    CreationErrorCode::Missing,
                    "Handoff operation is no longer active",
                )
            })
    }
}
