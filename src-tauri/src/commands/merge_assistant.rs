//! Round-bound candidate tools. Ordinary creation task authority is never reused.
use crate::project::creation::{
    AssistantQuestion, AssistantQuestionAnswer, AssistantQuestionRequest, AssistantQuestionScope,
    CreationAccess, CreationError, CreationErrorCode, GitMergeAssistantChanges,
    GitMergeAssistantDiff, GitMergeAssistantTask, GitMergeAssistantUpdate, GitMergeAssistantWrite,
    GitMergeCandidate, GitMergeContent, GitMergeSide, Protection,
};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

async fn run<T: Send + 'static>(
    app: AppHandle,
    access: Arc<Mutex<CreationAccess>>,
    operation: impl FnOnce(&mut CreationAccess, &Protection) -> Result<T, CreationError>
        + Send
        + 'static,
) -> Result<T, CreationError> {
    super::creation::run_blocking(move || {
        let protection = super::creation::protection(&app)?;
        let mut access = access.lock().map_err(|_| {
            CreationError::new(CreationErrorCode::Io, "Creation workspace lock failed")
        })?;
        operation(&mut access, &protection)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_git_merge_assistant_changes(
    app: AppHandle,
    state: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    round_id: String,
) -> Result<GitMergeAssistantChanges, CreationError> {
    run(app, state.access.clone(), move |access, protection| {
        access.git_merge_assistant_changes(&identity, &candidate_id, &round_id, protection)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn read_git_merge_assistant_diff(
    app: AppHandle,
    state: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    round_id: String,
    path: String,
    full_context: bool,
) -> Result<GitMergeAssistantDiff, CreationError> {
    run(app, state.access.clone(), move |access, protection| {
        access.read_git_merge_assistant_diff(
            &identity,
            &candidate_id,
            &round_id,
            &path,
            full_context,
            protection,
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn begin_git_merge_assistant(
    app: AppHandle,
    state: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
    scope: AssistantQuestionScope,
    input: String,
) -> Result<GitMergeAssistantTask, CreationError> {
    run(app, state.access.clone(), move |access, protection| {
        access.begin_git_merge_assistant(
            &identity,
            &candidate_id,
            revision,
            scope,
            input,
            protection,
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_git_merge_assistant_tasks(
    app: AppHandle,
    state: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
) -> Result<Vec<GitMergeAssistantTask>, CreationError> {
    run(app, state.access.clone(), move |access, protection| {
        access.git_merge_assistant_tasks(&identity, &candidate_id, protection)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn update_git_merge_assistant(
    app: AppHandle,
    state: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    round_id: String,
    update: GitMergeAssistantUpdate,
) -> Result<GitMergeAssistantTask, CreationError> {
    run(app, state.access.clone(), move |access, protection| {
        access.update_git_merge_assistant(&identity, &candidate_id, &round_id, update, protection)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn ask_git_merge_question(
    app: AppHandle,
    state: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    round_id: String,
    request: AssistantQuestionRequest,
) -> Result<AssistantQuestion, CreationError> {
    run(app, state.access.clone(), move |access, protection| {
        access.ask_git_merge_question(&identity, &candidate_id, &round_id, request, protection)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn answer_git_merge_question(
    app: AppHandle,
    state: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    round_id: String,
    question_id: String,
    answer: AssistantQuestionAnswer,
) -> Result<GitMergeAssistantTask, CreationError> {
    run(app, state.access.clone(), move |access, protection| {
        access.answer_git_merge_question(
            &identity,
            &candidate_id,
            &round_id,
            &question_id,
            answer,
            protection,
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn list_git_merge_assistant_files(
    app: AppHandle,
    state: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    round_id: String,
    side: GitMergeSide,
) -> Result<Vec<String>, CreationError> {
    run(app, state.access.clone(), move |access, protection| {
        access.git_merge_assistant_paths(&identity, &candidate_id, &round_id, side, protection)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn read_git_merge_assistant_file(
    app: AppHandle,
    state: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    round_id: String,
    side: GitMergeSide,
    path: String,
) -> Result<GitMergeContent, CreationError> {
    run(app, state.access.clone(), move |access, protection| {
        access.read_git_merge_assistant_file(
            &identity,
            &candidate_id,
            &round_id,
            side,
            &path,
            protection,
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn write_git_merge_assistant_file(
    app: AppHandle,
    state: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    round_id: String,
    revision: u32,
    write: GitMergeAssistantWrite,
) -> Result<GitMergeCandidate, CreationError> {
    run(app, state.access.clone(), move |access, protection| {
        access.write_git_merge_assistant_file(
            &identity,
            &candidate_id,
            &round_id,
            revision,
            write,
            protection,
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn run_git_merge_assistant_check(
    app: AppHandle,
    state: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    round_id: String,
    revision: u32,
    kind: String,
) -> Result<super::merge_runtime::GitMergeChecks, CreationError> {
    let access = state.access.clone();
    let auth_identity = identity.clone();
    let auth_candidate = candidate_id.clone();
    let auth_round = round_id.clone();
    run(app.clone(), access.clone(), move |access, protection| {
        access.authorize_git_merge_assistant_check(
            &auth_identity,
            &auth_candidate,
            &auth_round,
            revision,
            protection,
        )
    })
    .await?;
    super::merge_runtime::run_merge_assistant_check(
        app,
        access,
        identity,
        candidate_id,
        revision,
        round_id,
        kind,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn end_git_merge_assistant(
    app: AppHandle,
    state: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    round_id: String,
) -> Result<GitMergeCandidate, CreationError> {
    let retire_identity = identity.clone();
    let retire_candidate = candidate_id.clone();
    let retire_round = round_id.clone();
    run(
        app.clone(),
        state.access.clone(),
        move |access, protection| {
            access.retire_git_merge_assistant(
                &retire_identity,
                &retire_candidate,
                &retire_round,
                protection,
            )
        },
    )
    .await?;
    super::merge_runtime::cancel_merge_assistant_checks(
        app.clone(),
        identity.clone(),
        candidate_id.clone(),
        round_id.clone(),
    )
    .await?;
    run(app, state.access.clone(), move |access, protection| {
        access.end_git_merge_assistant(&identity, &candidate_id, &round_id, protection)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn undo_git_merge_assistant(
    app: AppHandle,
    state: State<'_, super::creation::CreationState>,
    identity: String,
    candidate_id: String,
    revision: u32,
) -> Result<GitMergeCandidate, CreationError> {
    run(app, state.access.clone(), move |access, protection| {
        access.undo_git_merge_round(&identity, &candidate_id, revision, protection)
    })
    .await
}
