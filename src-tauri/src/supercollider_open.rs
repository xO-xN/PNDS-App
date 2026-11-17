//! Hand a saved file to the fixed local SuperCollider GUI through Launch Services.
//! No compiler, shell, audio environment or code evaluation is involved.
use crate::project::creation::{CreationError, CreationErrorCode};
use std::path::Path;
use tokio::sync::oneshot;

pub type Completion = oneshot::Receiver<Result<(), CreationError>>;

#[cfg(target_os = "macos")]
pub fn open(path: &Path) -> Result<Completion, CreationError> {
    use block2::RcBlock;
    use objc2_app_kit::{NSRunningApplication, NSWorkspace, NSWorkspaceOpenConfiguration};
    use objc2_foundation::{NSArray, NSError, NSString, NSURL};
    use std::sync::Mutex;

    let workspace = NSWorkspace::sharedWorkspace();
    let application = workspace
        .URLForApplicationWithBundleIdentifier(&NSString::from_str("net.sourceforge.supercollider"))
        .ok_or_else(|| {
            CreationError::new(
                CreationErrorCode::SupercolliderMissing,
                "SuperCollider.app was not found by macOS Launch Services",
            )
        })?;
    let path = path.to_str().ok_or_else(|| {
        CreationError::new(
            CreationErrorCode::InvalidUtf8,
            "The saved source path is not UTF-8",
        )
    })?;
    let source = NSURL::fileURLWithPath(&NSString::from_str(path));
    let configuration = NSWorkspaceOpenConfiguration::configuration();
    configuration.setPromptsUserIfNeeded(false);
    let (send, completion) = oneshot::channel();
    let send = Mutex::new(Some(send));
    let finished = RcBlock::new(
        move |application: *mut NSRunningApplication, error: *mut NSError| {
            // SAFETY: AppKit supplies pointers valid throughout this callback; only
            // the error's owned diagnostic string crosses back to the async caller.
            let result = unsafe {
                if let Some(error) = error.as_ref() {
                    Err(CreationError::new(
                        CreationErrorCode::ExternalOpen,
                        error.localizedDescription().to_string(),
                    ))
                } else if application.is_null() {
                    Err(CreationError::new(
                        CreationErrorCode::ExternalOpen,
                        "macOS did not confirm the SuperCollider open request",
                    ))
                } else {
                    Ok(())
                }
            };
            if let Some(send) = send.lock().ok().and_then(|mut send| send.take()) {
                let _ = send.send(result);
            }
        },
    );
    workspace.openURLs_withApplicationAtURL_configuration_completionHandler(
        &NSArray::from_slice(&[&*source]),
        &application,
        &configuration,
        Some(&finished),
    );
    Ok(completion)
}

#[cfg(not(target_os = "macos"))]
pub fn open(_path: &Path) -> Result<Completion, CreationError> {
    Err(CreationError::new(
        CreationErrorCode::ExternalOpen,
        "SuperCollider GUI opening is available on macOS",
    ))
}
