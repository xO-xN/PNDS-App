//! Merge commands keep actual creation identity separate from private candidate state.
use super::creation::{assistant_task_data, protection, run_blocking, CreationState};
use crate::project::creation::*;
use tauri::{AppHandle, Manager, State};
async fn access<T: Send + 'static>(
    app: AppHandle,
    state: &CreationState,
    operation: impl FnOnce(&mut CreationAccess, &Protection, &std::path::Path) -> Result<T, CreationError>
        + Send
        + 'static,
) -> Result<T, CreationError> {
    require_merge_admission(&app)?;
    let access = state.access.clone();
    run_blocking(move || {
        let protection = protection(&app)?;
        let data = assistant_task_data(&app)?;
        let mut access = access.lock().map_err(|_| {
            CreationError::new(CreationErrorCode::Io, "Creation workspace lock failed")
        })?;
        require_merge_admission(&app)?;
        operation(&mut access, &protection, &data)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn get_creation_git_merge(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
) -> Result<Option<GitMergeCandidate>, CreationError> {
    access(app, &state, move |access, protection, _| {
        access.get_git_merge(&identity, protection)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn probe_creation_git_merge(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    source: String,
) -> Result<GitMergeProbe, CreationError> {
    access(app, &state, move |access, protection, _| {
        access.probe_git_merge(&identity, &source, protection)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn prepare_creation_git_merge(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    source: String,
    discard: bool,
) -> Result<GitMergeCandidate, CreationError> {
    access(app, &state, move |access, protection, data| {
        access.prepare_git_merge(&identity, &source, discard, data, protection)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn resume_creation_git_merge(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
) -> Result<GitMergeCandidate, CreationError> {
    let retained = app.clone();
    let owner = identity.clone();
    let candidate = access(app, &state, move |access, protection, _| {
        access.resume_git_merge(&identity, &candidate_id, revision, protection)
    })
    .await?;
    super::merge_runtime::allow_candidate_operations(&retained, &owner, &candidate.id);
    Ok(candidate)
}
#[tauri::command]
#[specta::specta]
pub async fn pause_creation_git_merge(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
) -> Result<GitMergeCandidate, CreationError> {
    transition(
        app,
        &state,
        identity.clone(),
        candidate_id.clone(),
        move |access, protection, _| {
            access.pause_git_merge_candidate(&identity, &candidate_id, revision, protection)
        },
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn reprepare_creation_git_merge(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
) -> Result<GitMergeCandidate, CreationError> {
    transition(
        app,
        &state,
        identity.clone(),
        candidate_id.clone(),
        move |access, protection, data| {
            access.reprepare_git_merge(&identity, &candidate_id, revision, data, protection)
        },
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn cancel_creation_git_merge(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
) -> Result<(), CreationError> {
    transition(
        app,
        &state,
        identity.clone(),
        candidate_id.clone(),
        move |access, protection, _| {
            access.cancel_git_merge(&identity, &candidate_id, revision, protection)
        },
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn get_creation_git_merge_file(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    candidate_id: String,
    path: String,
    side: GitMergeSide,
) -> Result<GitMergeContent, CreationError> {
    access(app, &state, move |access, protection, _| {
        access.read_git_merge_file(&identity, &candidate_id, &path, side, protection)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn read_creation_git_merge_diff(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
    path: String,
    full_context: bool,
) -> Result<GitComparisonDiff, CreationError> {
    access(app, &state, move |access, protection, _| {
        access.read_git_merge_diff(
            &identity,
            &candidate_id,
            revision,
            &path,
            full_context,
            protection,
        )
    })
    .await
}
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn save_creation_git_merge_text(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
    path: String,
    version: String,
    text: String,
) -> Result<GitMergeCandidate, CreationError> {
    access(app, &state, move |access, protection, _| {
        access.edit_git_merge_owned(
            &identity,
            &candidate_id,
            revision,
            None,
            vec![GitMergeEdit {
                path,
                version,
                text: Some(text),
                choice: None,
            }],
            protection,
        )
    })
    .await
}
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn choose_creation_git_merge_file(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
    path: String,
    version: String,
    choice: GitMergeChoice,
) -> Result<GitMergeCandidate, CreationError> {
    access(app, &state, move |access, protection, _| {
        access.edit_git_merge_owned(
            &identity,
            &candidate_id,
            revision,
            None,
            vec![GitMergeEdit {
                path,
                version,
                text: None,
                choice: Some(choice),
            }],
            protection,
        )
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn rename_creation_git_merge(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
    name: String,
) -> Result<GitMergeCandidate, CreationError> {
    access(app, &state, move |access, protection, _| {
        access.rename_git_merge(&identity, &candidate_id, revision, &name, protection)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn validate_creation_git_merge(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
) -> Result<GitMergeCandidate, CreationError> {
    access(app, &state, move |access, protection, _| {
        access.validate_git_merge(&identity, &candidate_id, revision, protection)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn finish_creation_git_merge(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
    author_name: String,
    author_email: String,
) -> Result<GitMergeCandidate, CreationError> {
    let retained = app.clone();
    transition(
        app,
        &state,
        identity.clone(),
        candidate_id.clone(),
        move |access, protection, _| {
            require_inactive_runtime(&retained)?;
            let _lease = publication_lease()?;
            let candidate = access.finish_git_merge(
                &identity,
                &candidate_id,
                revision,
                &author_name,
                &author_email,
                protection,
            )?;
            Ok(note_completed(
                &retained, access, &identity, candidate, protection,
            ))
        },
    )
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn recover_creation_git_merge(
    app: AppHandle,
    state: State<'_, CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
) -> Result<GitMergeCandidate, CreationError> {
    let retained = app.clone();
    transition(
        app,
        &state,
        identity.clone(),
        candidate_id.clone(),
        move |access, protection, _| {
            require_inactive_runtime(&retained)?;
            let _lease = publication_lease()?;
            let candidate =
                access.recover_git_merge(&identity, &candidate_id, revision, protection)?;
            Ok(note_completed(
                &retained, access, &identity, candidate, protection,
            ))
        },
    )
    .await
}

fn require_inactive_runtime(app: &AppHandle) -> Result<(), CreationError> {
    if app
        .state::<crate::project::session::SessionManager>()
        .has_active_session()
    {
        return Err(CreationError::new(
            CreationErrorCode::RuntimeBusy,
            "Stop the active project before completing this merge",
        ));
    }
    Ok(())
}

fn may_resume_after_failed_transition(candidate: &GitMergeCandidate, expected: &str) -> bool {
    candidate.id == expected
        && candidate.phase == GitMergePhase::Active
        && candidate.assistant_owner.is_none()
}

async fn transition<T: Send + 'static>(
    app: AppHandle,
    state: &CreationState,
    identity: String,
    candidate_id: String,
    operation: impl FnOnce(&mut CreationAccess, &Protection, &std::path::Path) -> Result<T, CreationError>
        + Send
        + 'static,
) -> Result<T, CreationError> {
    // An uncertain stop keeps admission closed. Only confirmed cleanup may
    // roll back a later rejection that left the same manual candidate active.
    let ticket = super::merge_runtime::stop_candidate_runtime_for_transition_with_ticket(
        app.clone(),
        identity.clone(),
        candidate_id.clone(),
    )
    .await?;
    let result = access(app.clone(), state, operation).await;
    if result.is_err() {
        let retained = app.clone();
        let _ = access(app, state, move |access, protection, _| {
            if let Some(candidate) = access.get_git_merge(&identity, protection)? {
                if may_resume_after_failed_transition(&candidate, &candidate_id) {
                    access.git_merge_fresh(
                        &identity,
                        &candidate_id,
                        candidate.revision,
                        protection,
                    )?;
                    super::merge_runtime::allow_failed_candidate_transition(
                        &retained,
                        &identity,
                        &candidate_id,
                        ticket,
                    );
                }
            }
            Ok(())
        })
        .await;
    }
    result
}

fn publication_lease() -> Result<crate::project::runtime_gate::RuntimeLease, CreationError> {
    let path = crate::project::runtime_gate::default_gate_path()
        .map_err(|error| CreationError::new(CreationErrorCode::Io, error))?;
    crate::project::runtime_gate::RuntimeLease::acquire(&path)
        .map_err(|error| CreationError::new(CreationErrorCode::RuntimeBusy, error))
}

fn note_completed(
    app: &AppHandle,
    access: &mut CreationAccess,
    identity: &str,
    mut candidate: GitMergeCandidate,
    protection: &Protection,
) -> GitMergeCandidate {
    if candidate.phase != GitMergePhase::Completed {
        return candidate;
    }
    let Some(commit) = candidate.result.clone() else {
        return candidate;
    };
    let mut receipt = GitRecordReceipt {
        commit,
        message: candidate.name.clone(),
        paths: candidate
            .files
            .iter()
            .map(|file| file.path.clone())
            .collect(),
        warning: None,
    };
    super::github_sync::note_local_save(app, access, identity, &mut receipt);
    if let Some(warning) = receipt.warning {
        match access.note_git_merge_warning(identity, &candidate.id, &warning, protection) {
            Ok(updated) => candidate = updated,
            Err(error) => {
                log::warn!(
                    "Completed merge backup receipt could not be persisted: {}",
                    error.detail
                );
                candidate.detail = Some(
                    candidate
                        .detail
                        .map_or(warning.clone(), |existing| format!("{existing}\n{warning}")),
                );
            }
        }
    }
    candidate
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failed_transition_may_only_return_the_same_active_candidate_to_manual_operations() {
        let mut candidate = GitMergeCandidate {
            id: "candidate".into(),
            revision: 1,
            relation: GitMergeRelation::Diverged,
            phase: GitMergePhase::Active,
            source: "source".into(),
            target: "target".into(),
            base: None,
            branch: None,
            name: "Merge".into(),
            files: vec![],
            unresolved: 0,
            result: None,
            detail: None,
            assistant_owner: None,
            can_undo: false,
        };
        assert!(may_resume_after_failed_transition(&candidate, "candidate"));
        assert!(!may_resume_after_failed_transition(&candidate, "other"));
        candidate.assistant_owner = Some("round".into());
        assert!(!may_resume_after_failed_transition(&candidate, "candidate"));
        candidate.assistant_owner = None;
        for phase in [
            GitMergePhase::Paused,
            GitMergePhase::Stale,
            GitMergePhase::Publishing,
            GitMergePhase::Recovery,
            GitMergePhase::Completed,
        ] {
            candidate.phase = phase;
            assert!(!may_resume_after_failed_transition(&candidate, "candidate"));
        }
    }
}

fn require_merge_admission(app: &AppHandle) -> Result<(), CreationError> {
    if app
        .try_state::<crate::project::merge_runtime::MergeRuntimeState>()
        .is_some_and(|state| !state.accepting_operations())
    {
        return Err(CreationError::new(
            CreationErrorCode::Cancelled,
            "Merge operations are paused while the application is leaving",
        ));
    }
    Ok(())
}
