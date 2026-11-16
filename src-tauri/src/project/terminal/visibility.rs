//! Native main-window visibility for terminal painting, independent of focus.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;

/// App-owned show/hide can leave occlusion unchanged; refresh after its dispatch.
pub fn notify_window_change<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        if window.label() != "main" {
            return;
        }
        let app = window.app_handle().clone();
        let _ = window.run_on_main_thread(move || native::refresh_observed(&app));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TerminalVisibilitySnapshot {
    pub revision: u32,
    pub visible: bool,
}

pub async fn snapshot(app: AppHandle) -> Result<TerminalVisibilitySnapshot, String> {
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let _ = sender.send(native::capture(&handle));
        })
        .map_err(|error| error.to_string())?;
        receiver.await.map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Native project terminal visibility requires macOS".into())
    }
}

#[cfg(target_os = "macos")]
pub fn shutdown() {
    native::shutdown();
}

#[cfg(target_os = "macos")]
mod native {
    use super::TerminalVisibilitySnapshot;
    use block2::RcBlock;
    use objc2::{
        rc::Retained,
        runtime::{AnyObject, ProtocolObject},
        MainThreadMarker,
    };
    use objc2_app_kit::{
        NSApplication, NSApplicationDidHideNotification, NSApplicationDidUnhideNotification,
        NSWindow, NSWindowDidChangeOcclusionStateNotification,
        NSWindowDidDeminiaturizeNotification, NSWindowDidMiniaturizeNotification,
    };
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol};
    use std::{cell::RefCell, ptr::NonNull, sync::Mutex};
    use tauri::{AppHandle, Manager, Runtime};
    use tauri_specta::Event as _;

    static LAST: Mutex<Option<TerminalVisibilitySnapshot>> = Mutex::new(None);
    thread_local! {
        static OBSERVERS: RefCell<Option<Observers>> = const { RefCell::new(None) };
    }

    struct Observers {
        window: usize,
        tokens: Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
    }
    impl Drop for Observers {
        fn drop(&mut self) {
            let center = NSNotificationCenter::defaultCenter();
            for token in &self.tokens {
                let observer: &AnyObject = (**token).as_ref();
                // SAFETY: these are our retained notification registration tokens.
                unsafe {
                    center.removeObserver(observer);
                }
            }
        }
    }

    pub(super) fn refresh_observed<R: Runtime>(app: &AppHandle<R>) {
        if OBSERVERS.with(|saved| saved.borrow().is_some()) {
            if let Err(error) = capture(app) {
                log::warn!("Could not update terminal visibility: {error}");
            }
        }
    }

    pub(super) fn capture<R: Runtime>(
        app: &AppHandle<R>,
    ) -> Result<TerminalVisibilitySnapshot, String> {
        let mtm = MainThreadMarker::new().ok_or("Terminal visibility requires the main thread")?;
        let window = app
            .get_webview_window("main")
            .ok_or("Main window not found")?;
        let pointer = window.ns_window().map_err(|error| error.to_string())?;
        // SAFETY: Tauri owns this live main NSWindow, and capture runs on its UI thread.
        let window = unsafe { &*pointer.cast::<NSWindow>() };
        let application = NSApplication::sharedApplication(mtm);
        OBSERVERS.with(|saved| {
            if saved
                .borrow()
                .as_ref()
                .is_some_and(|observed| observed.window == pointer as usize)
            {
                return;
            }
            // A replacement main NSWindow cannot inherit the previous object's filters.
            saved.borrow_mut().take();
            let center = NSNotificationCenter::defaultCenter();
            // SAFETY: AppKit notification-name constants have process lifetime.
            let notifications = unsafe {
                [
                    (NSWindowDidMiniaturizeNotification, true),
                    (NSWindowDidDeminiaturizeNotification, true),
                    (NSWindowDidChangeOcclusionStateNotification, true),
                    (NSApplicationDidHideNotification, false),
                    (NSApplicationDidUnhideNotification, false),
                ]
            };
            let mut tokens = Vec::with_capacity(notifications.len());
            for (name, is_window) in notifications {
                let object: &AnyObject = if is_window { window } else { &application };
                let handle = app.clone();
                let callback = RcBlock::new(move |_: NonNull<NSNotification>| {
                    let owner = handle.clone();
                    let _ = handle.run_on_main_thread(move || {
                        if let Err(error) = capture(&owner) {
                            log::warn!("Could not update terminal visibility: {error}");
                        }
                    });
                });
                // SAFETY: object matches each notification's AppKit owner. The block
                // captures only a sendable AppHandle and schedules AppKit work on main.
                tokens.push(unsafe {
                    center.addObserverForName_object_queue_usingBlock(
                        Some(name),
                        Some(object),
                        None,
                        &callback,
                    )
                });
            }
            *saved.borrow_mut() = Some(Observers {
                window: pointer as usize,
                tokens,
            });
        });
        let visible = window.isVisible() && !window.isMiniaturized() && !application.isHidden();
        let (snapshot, changed) = {
            let mut last = LAST.lock().map_err(|_| "Terminal visibility lock failed")?;
            let changed = last.as_ref().is_none_or(|old| old.visible != visible);
            if changed {
                let revision = last.as_ref().map_or(1, |old| old.revision.wrapping_add(1));
                *last = Some(TerminalVisibilitySnapshot { revision, visible });
            }
            (
                last.as_ref()
                    .expect("initial visibility was captured")
                    .clone(),
                changed,
            )
        };
        if changed {
            crate::events::ProjectTerminalVisibilityEvent {
                snapshot: snapshot.clone(),
            }
            .emit(app)
            .map_err(|error| error.to_string())?;
        }
        Ok(snapshot)
    }

    pub(super) fn shutdown() {
        OBSERVERS.with(|saved| {
            saved.borrow_mut().take();
        });
    }
}
