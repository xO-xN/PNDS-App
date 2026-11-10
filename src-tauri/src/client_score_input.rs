//! Native sibling pages cannot post modifier/edge input to the host DOM.
//! This narrow AppKit adapter never handles musical keys or consumes events.
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use crate::events::{ClientPointerEdge, ClientViewInputEvent};
    use block2::RcBlock;
    use objc2::{rc::Retained, runtime::AnyObject};
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSEventType, NSWindow};
    use std::cell::{Cell, RefCell};
    use std::ptr::NonNull;
    use tauri::Manager;
    use tauri_specta::Event;

    thread_local! {
        static MONITOR: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
        static LAST_EDGE: Cell<i8> = const { Cell::new(0) };
    }

    pub(super) fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
        if MONITOR.with(|monitor| monitor.borrow().is_some()) {
            return Ok(());
        }
        let main = app
            .get_webview_window("main")
            .ok_or("main window missing")?;
        let pointer = main.ns_window().map_err(|error| error.to_string())?;
        // SAFETY: install is called on AppKit's main thread; Tauri owns NSWindow.
        unsafe { (&*pointer.cast::<NSWindow>()).setAcceptsMouseMovedEvents(true) };
        let app = app.clone();
        let handler = RcBlock::new(move |pointer: NonNull<NSEvent>| -> *mut NSEvent {
            // SAFETY: AppKit supplies a valid event only during this callback.
            let event = unsafe { pointer.as_ref() };
            if !crate::client_score_view::client_input_owner(&app) {
                return pointer.as_ptr();
            }
            let Some(main) = app.get_webview_window("main") else {
                return pointer.as_ptr();
            };
            let Ok(native) = main.ns_window() else {
                return pointer.as_ptr();
            };
            // SAFETY: local event monitors run on the main thread.
            let window = unsafe { &*native.cast::<NSWindow>() };
            // A guest-owned sheet or a newly focused App window may receive
            // the release after the guest was hidden. Never latch that peek.
            if event.r#type() == NSEventType::FlagsChanged
                && !event
                    .modifierFlags()
                    .contains(NSEventModifierFlags::Command)
            {
                LAST_EDGE.with(|edge| edge.set(0));
                let _ = ClientViewInputEvent {
                    command: Some(false),
                    edge: None,
                }
                .emit_to(&app, "main");
                return pointer.as_ptr();
            }
            if event.windowNumber() != window.windowNumber() {
                LAST_EDGE.with(|edge| edge.set(0));
                return pointer.as_ptr();
            }
            if event.r#type() == NSEventType::FlagsChanged {
                LAST_EDGE.with(|edge| edge.set(0));
                let _ = ClientViewInputEvent {
                    command: Some(
                        event
                            .modifierFlags()
                            .contains(NSEventModifierFlags::Command),
                    ),
                    edge: None,
                }
                .emit_to(&app, "main");
            } else if event.r#type() == NSEventType::MouseMoved {
                if !crate::client_score_view::client_input_visible(&app) {
                    LAST_EDGE.with(|edge| edge.set(0));
                    return pointer.as_ptr();
                }
                let x = event.locationInWindow().x;
                let width = window
                    .contentView()
                    .map(|view| view.frame().size.width)
                    .unwrap_or(0.0);
                let tolerance = 14.0 * crate::client_score_view::client_input_scale(&app);
                let edge = if (0.0..tolerance).contains(&x) {
                    -1
                } else if width > 0.0 && x >= width - tolerance && x <= width {
                    1
                } else {
                    0
                };
                let changed = LAST_EDGE.with(|last| last.replace(edge) != edge);
                if edge != 0 && changed {
                    let _ = ClientViewInputEvent {
                        command: None,
                        edge: Some(if edge < 0 {
                            ClientPointerEdge::Left
                        } else {
                            ClientPointerEdge::Right
                        }),
                    }
                    .emit_to(&app, "main");
                }
            }
            pointer.as_ptr()
        });
        // SAFETY: the callback always returns the original valid event, and
        // AppKit retains its block until the matching monitor is removed.
        let token = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(
                NSEventMask::FlagsChanged | NSEventMask::MouseMoved,
                &handler,
            )
        }
        .ok_or("native Client input monitor unavailable")?;
        MONITOR.with(|monitor| *monitor.borrow_mut() = Some(token));
        Ok(())
    }

    pub(super) fn teardown<R: Runtime>(app: &AppHandle<R>) {
        MONITOR.with(|monitor| {
            if let Some(token) = monitor.borrow_mut().take() {
                // SAFETY: this is the token returned by AppKit, on its UI thread.
                unsafe { NSEvent::removeMonitor(&token) };
            }
        });
        LAST_EDGE.with(|edge| edge.set(0));
        let _ = ClientViewInputEvent {
            command: Some(false),
            edge: None,
        }
        .emit_to(app, "main");
    }
}

/// Called on the main thread after a Client view has a current native owner.
pub(crate) fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::install(app)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

/// Called on the main thread before the owning child is destroyed.
pub(crate) fn teardown<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    macos::teardown(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}
