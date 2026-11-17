//! Same-directory staged text publication. Callers retain path and domain policy.
use super::{io_error, CreationError, CreationErrorCode};
use std::ffi::{CStr, CString};
use std::fs::{self, File};
use std::io::{self, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::sync::atomic::{AtomicU64, Ordering};

pub(super) struct TextPublication<'a> {
    pub(super) directory: &'a File,
    pub(super) name: &'a CStr,
    pub(super) bytes: &'a [u8],
    pub(super) policy: PublishPolicy,
}

pub(super) enum PublishPolicy {
    Replace { permissions: fs::Permissions },
    Create { permissions: CreatePermissions },
}

pub(super) enum CreatePermissions {
    /// Preserve the caller's existing open-mode/umask contract.
    Umask(libc::mode_t),
    /// Apply the exact final permissions before syncing the staged file.
    Exact(fs::Permissions),
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum PublicationState {
    Installed,
    Occupied,
}

#[derive(Debug)]
pub(super) struct PublicationReceipt {
    pub(super) state: PublicationState,
    pub(super) cleanup_issue: Option<io::Error>,
}

/// A successful installation remains successful if only temporary-name removal
/// fails. The receipt reports that cleanup issue and this module logs it once.
/// Callers map Occupied to their existing conflict or idempotency semantics.
pub(super) fn publish_text_at(
    request: TextPublication<'_>,
    before_publish: impl FnOnce() -> Result<(), CreationError>,
) -> Result<PublicationReceipt, CreationError> {
    publish_stream_at(
        request.directory,
        request.name,
        request.policy,
        |file| file.write_all(request.bytes),
        before_publish,
    )
}

pub(super) fn publish_stream_at(
    directory: &File,
    target: &CStr,
    policy: PublishPolicy,
    write: impl FnOnce(&mut File) -> io::Result<()>,
    before_publish: impl FnOnce() -> Result<(), CreationError>,
) -> Result<PublicationReceipt, CreationError> {
    let name = target.to_bytes();
    if name.is_empty() || name == b"." || name == b".." || name.contains(&b'/') {
        return Err(CreationError::new(
            CreationErrorCode::InvalidProject,
            "Publication needs a single file name",
        ));
    }
    let (replace, create_mode, exact_permissions) = match policy {
        PublishPolicy::Replace { permissions } => (true, 0o600, Some(permissions)),
        PublishPolicy::Create {
            permissions: CreatePermissions::Umask(mode),
        } => (false, mode, None),
        PublishPolicy::Create {
            permissions: CreatePermissions::Exact(permissions),
        } => (false, 0o600, Some(permissions)),
    };
    let mut staged = StagedText::create(directory, create_mode).map_err(io_error)?;
    #[cfg(test)]
    test_support::fail(test_support::Phase::Write).map_err(io_error)?;
    write(&mut staged.file).map_err(io_error)?;
    if let Some(permissions) = exact_permissions {
        #[cfg(test)]
        test_support::fail(test_support::Phase::Permissions).map_err(io_error)?;
        staged.file.set_permissions(permissions).map_err(io_error)?;
    }
    #[cfg(test)]
    test_support::fail(test_support::Phase::Sync).map_err(io_error)?;
    staged.file.sync_all().map_err(io_error)?;
    #[cfg(test)]
    test_support::run_before_publish_hook(target);
    before_publish()?;
    #[cfg(test)]
    test_support::fail(test_support::Phase::Install).map_err(io_error)?;
    let directory = directory.as_raw_fd();
    // SAFETY: the live directory and both NUL-terminated basenames stay borrowed
    // throughout this call. Replace never follows the final target entry.
    let result = unsafe {
        if replace {
            libc::renameat(directory, staged.name.as_ptr(), directory, target.as_ptr())
        } else {
            libc::linkat(
                directory,
                staged.name.as_ptr(),
                directory,
                target.as_ptr(),
                0,
            )
        }
    };
    let state = if result == 0 {
        if replace {
            staged.armed = false;
        }
        PublicationState::Installed
    } else {
        let cause = io::Error::last_os_error();
        if !replace && cause.kind() == io::ErrorKind::AlreadyExists {
            PublicationState::Occupied
        } else {
            return Err(io_error(cause));
        }
    };
    let receipt = PublicationReceipt {
        state,
        cleanup_issue: staged.cleanup().err(),
    };
    if let Some(cause) = &receipt.cleanup_issue {
        staged.cleanup_reported = true;
        log::warn!(
            "Text publication {:?}; temporary cleanup failed for {:?}: {cause}",
            receipt.state,
            staged.name
        );
    }
    Ok(receipt)
}

struct StagedText<'a> {
    directory: &'a File,
    name: CString,
    file: File,
    armed: bool,
    cleanup_reported: bool,
}

impl<'a> StagedText<'a> {
    fn create(directory: &'a File, mode: libc::mode_t) -> io::Result<Self> {
        let name = temporary_name();
        // SAFETY: successful ownership transfers immediately to File. The guard
        // is armed only after O_EXCL succeeds, so a collision is never removed.
        let descriptor = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                mode as libc::c_uint,
            )
        };
        if descriptor < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self {
            directory,
            name,
            file: unsafe { File::from_raw_fd(descriptor) },
            armed: true,
            cleanup_reported: false,
        })
    }

    fn cleanup(&mut self) -> io::Result<()> {
        if !self.armed {
            return Ok(());
        }
        #[cfg(test)]
        test_support::fail(test_support::Phase::Cleanup)?;
        // SAFETY: this basename was created by this guard in its held directory.
        if unsafe { libc::unlinkat(self.directory.as_raw_fd(), self.name.as_ptr(), 0) } != 0 {
            return Err(io::Error::last_os_error());
        }
        self.armed = false;
        Ok(())
    }
}

impl Drop for StagedText<'_> {
    fn drop(&mut self) {
        if let Err(cause) = self.cleanup() {
            if !self.cleanup_reported {
                log::warn!("Temporary text cleanup failed for {:?}: {cause}", self.name);
            }
        }
    }
}

fn temporary_name() -> CString {
    #[cfg(test)]
    if let Some(name) = test_support::temporary_name() {
        return name;
    }
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    let serial = SERIAL.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    CString::new(format!(".pnds-save-{pid}-{serial}.tmp")).expect("generated name")
}

#[cfg(test)]
pub(super) use test_support::{with_before_publish_hook, with_before_publish_hook_for};

#[cfg(test)]
mod test_support {
    use std::cell::RefCell;
    use std::ffi::{CStr, CString};
    use std::io;

    #[derive(Clone, Copy, PartialEq, Eq)]
    pub(super) enum Phase {
        Write,
        Permissions,
        Sync,
        Install,
        Cleanup,
    }

    struct Hook {
        name: Option<CString>,
        callback: Box<dyn FnOnce()>,
    }
    thread_local! {
        static BEFORE_PUBLISH: RefCell<Option<Hook>> = const { RefCell::new(None) };
        static FAILURE: RefCell<Option<Phase>> = const { RefCell::new(None) };
        static TEMPORARY_NAME: RefCell<Option<CString>> = const { RefCell::new(None) };
    }

    struct HookScope(Option<Hook>);
    impl Drop for HookScope {
        fn drop(&mut self) {
            BEFORE_PUBLISH.with(|slot| slot.replace(self.0.take()));
        }
    }

    pub(in super::super) fn with_before_publish_hook<R>(
        hook: impl FnOnce() + 'static,
        operation: impl FnOnce() -> R,
    ) -> R {
        with_hook(None, hook, operation)
    }

    pub(in super::super) fn with_before_publish_hook_for<R>(
        name: &CStr,
        hook: impl FnOnce() + 'static,
        operation: impl FnOnce() -> R,
    ) -> R {
        with_hook(Some(name.to_owned()), hook, operation)
    }

    fn with_hook<R>(
        name: Option<CString>,
        hook: impl FnOnce() + 'static,
        operation: impl FnOnce() -> R,
    ) -> R {
        let registered = Hook {
            name,
            callback: Box::new(hook),
        };
        let previous = BEFORE_PUBLISH.with(|slot| slot.replace(Some(registered)));
        let _scope = HookScope(previous);
        operation()
    }

    pub(super) fn run_before_publish_hook(name: &CStr) {
        let hook = BEFORE_PUBLISH.with(|slot| {
            let matches = slot
                .borrow()
                .as_ref()
                .is_some_and(|hook| hook.name.as_deref().is_none_or(|expected| expected == name));
            if matches {
                slot.borrow_mut().take()
            } else {
                None
            }
        });
        if let Some(hook) = hook {
            (hook.callback)();
        }
    }

    pub(super) fn fail(phase: Phase) -> io::Result<()> {
        if FAILURE.with(|slot| *slot.borrow() == Some(phase)) {
            Err(io::Error::other("Injected text publication failure"))
        } else {
            Ok(())
        }
    }

    pub(super) fn temporary_name() -> Option<CString> {
        TEMPORARY_NAME.with(|slot| slot.borrow().clone())
    }

    pub(super) fn with_failure<R>(phase: Phase, operation: impl FnOnce() -> R) -> R {
        struct Scope(Option<Phase>);
        impl Drop for Scope {
            fn drop(&mut self) {
                FAILURE.with(|slot| slot.replace(self.0));
            }
        }
        let previous = FAILURE.with(|slot| slot.replace(Some(phase)));
        let _scope = Scope(previous);
        operation()
    }

    pub(super) fn with_temporary_name<R>(name: CString, operation: impl FnOnce() -> R) -> R {
        struct Scope(Option<CString>);
        impl Drop for Scope {
            fn drop(&mut self) {
                TEMPORARY_NAME.with(|slot| slot.replace(self.0.take()));
            }
        }
        let previous = TEMPORARY_NAME.with(|slot| slot.replace(Some(name)));
        let _scope = Scope(previous);
        operation()
    }
}

#[cfg(test)]
#[path = "text_publication_tests.rs"]
mod tests;
