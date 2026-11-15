//! AppKit gesture phases for the main shell's folder browser.

use std::{
    cell::{Cell, RefCell},
    ptr::NonNull,
};

use block2::RcBlock;
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSEventPhase, NSView};
use tauri::{Runtime, WebviewWindow};
use tauri_specta::Event as _;

use crate::events::{SidebarTrackpadEvent, SidebarTrackpadPhase};

thread_local! {
    static MONITOR: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
}

fn trackpad_phase(phase: NSEventPhase, momentum: NSEventPhase) -> Option<SidebarTrackpadPhase> {
    if !momentum.is_empty() {
        return None;
    }
    match phase {
        NSEventPhase::Began => Some(SidebarTrackpadPhase::Began),
        NSEventPhase::Changed => Some(SidebarTrackpadPhase::Changed),
        NSEventPhase::Ended => Some(SidebarTrackpadPhase::Ended),
        NSEventPhase::Cancelled => Some(SidebarTrackpadPhase::Cancelled),
        _ => None,
    }
}

fn finger_deltas(x: f64, y: f64, direction_inverted_from_device: bool) -> (f64, f64) {
    // Natural scrolling has AppKit content travel follow the fingers.
    // Undo the traditional setting and convert AppKit's up-positive Y.
    if direction_inverted_from_device {
        (x, -y)
    } else {
        (-x, y)
    }
}

/// Install once after the main shell and typed event registry exist. AppKit
/// still delivers ordinary wheel input to its original view, including
/// vertical scrolling, zoom and unrelated windows.
pub fn install<R: Runtime>(window: &WebviewWindow<R>) {
    let target = window.clone();
    let result = window.with_webview(move |webview| {
        if MONITOR.with(|monitor| monitor.borrow().is_some()) {
            return;
        }
        // SAFETY: the macOS platform handle is a live WKWebView (NSView
        // subclass) on the main thread. Keep the handle for the monitor.
        let Some(view) = (unsafe { Retained::retain(webview.inner().cast::<NSView>()) }) else {
            return;
        };
        let active = Cell::new(false);
        let handler = RcBlock::new(move |pointer: NonNull<NSEvent>| -> *mut NSEvent {
            // SAFETY: AppKit supplies a live ScrollWheel event.
            let event = unsafe { pointer.as_ref() };
            let Some(window) = view.window() else {
                return pointer.as_ptr();
            };
            if event.windowNumber() != window.windowNumber() || !event.hasPreciseScrollingDeltas() {
                return pointer.as_ptr();
            }
            let Some(mut phase) = trackpad_phase(event.phase(), event.momentumPhase()) else {
                return pointer.as_ptr();
            };
            let modifiers = NSEventModifierFlags::Command
                | NSEventModifierFlags::Option
                | NSEventModifierFlags::Control
                | NSEventModifierFlags::Shift;
            if event.modifierFlags().intersects(modifiers) || NSEvent::pressedMouseButtons() != 0 {
                if !active.replace(false) {
                    return pointer.as_ptr();
                }
                phase = SidebarTrackpadPhase::Cancelled;
            } else if phase == SidebarTrackpadPhase::Began {
                active.set(true);
            } else if !active.get() {
                return pointer.as_ptr();
            } else if phase != SidebarTrackpadPhase::Changed {
                active.set(false);
            }

            let point = view.convertPoint_fromView(event.locationInWindow(), None);
            let bounds = view.bounds();
            let x = point.x - bounds.origin.x;
            let local_y = point.y - bounds.origin.y;
            let y = if view.isFlipped() {
                local_y
            } else {
                bounds.size.height - local_y
            };
            let (delta_x, delta_y) = finger_deltas(
                event.scrollingDeltaX(),
                event.scrollingDeltaY(),
                event.isDirectionInvertedFromDevice(),
            );
            let _ = SidebarTrackpadEvent {
                phase,
                x,
                y,
                delta_x,
                delta_y,
            }
            .emit_to(&target, target.label());
            pointer.as_ptr()
        });
        // SAFETY: the observer returns each original event unchanged.
        let token = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(
                NSEventMask::ScrollWheel,
                &handler,
            )
        };
        if token.is_none() {
            log::warn!("Could not install the main-window trackpad observer");
        }
        MONITOR.with(|monitor| *monitor.borrow_mut() = token);
    });
    if let Err(error) = result {
        log::warn!("Could not resolve main window for the trackpad observer: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trackpad_gestures_report_only_physical_movement_and_terminal_phases() {
        use NSEventPhase as Phase;
        use SidebarTrackpadPhase as Trackpad;
        assert_eq!(
            trackpad_phase(Phase::Began, Phase::None),
            Some(Trackpad::Began)
        );
        assert_eq!(
            trackpad_phase(Phase::Changed, Phase::None),
            Some(Trackpad::Changed)
        );
        assert_eq!(
            trackpad_phase(Phase::Ended, Phase::None),
            Some(Trackpad::Ended)
        );
        assert_eq!(
            trackpad_phase(Phase::Cancelled, Phase::None),
            Some(Trackpad::Cancelled)
        );
        assert_eq!(trackpad_phase(Phase::MayBegin, Phase::None), None);
        assert_eq!(trackpad_phase(Phase::None, Phase::None), None);
        assert_eq!(trackpad_phase(Phase::Changed, Phase::Changed), None);
    }

    #[test]
    fn natural_scroll_setting_does_not_reverse_finger_travel() {
        assert_eq!(finger_deltas(22.0, -6.0, true), (22.0, 6.0));
        assert_eq!(finger_deltas(-22.0, 6.0, false), (22.0, 6.0));
    }
}
