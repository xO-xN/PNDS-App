//! AppKit input ownership for native project documents.
use super::*;

thread_local! {
    static INPUT:RefCell<Option<Retained<AnyObject>>>=const {RefCell::new(None)};
    static POINTERS:RefCell<BTreeMap<usize,bool>>=const {RefCell::new(BTreeMap::new())};
}

fn pointer_inside(page: &Page, window: &NSWindow) -> bool {
    if !page.visible {
        return false;
    }
    let location = window.mouseLocationOutsideOfEventStream();
    // hitTest takes superview coordinates and respects the App notice holes.
    unsafe {
        let point: NSPoint =
            msg_send![&*page.parent,convertPoint:location,fromView:std::ptr::null::<AnyObject>()];
        let hit: *mut AnyObject = msg_send![&*page.view,hitTest:point];
        !hit.is_null()
    }
}
pub(super) fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSEventType};
    use std::ptr::NonNull;
    if INPUT.with(|input| input.borrow().is_some()) {
        return Ok(());
    }
    let _app = app.clone();
    let handler = RcBlock::new(move |pointer: NonNull<NSEvent>| -> *mut NSEvent {
        let event = unsafe { pointer.as_ref() };
        let command = event
            .modifierFlags()
            .contains(NSEventModifierFlags::Command);
        PAGES.with(|pages| {
            for page in pages
                .borrow()
                .values()
                .filter(|page| !page.closed && (page.gate)())
            {
                if event.r#type() == NSEventType::FlagsChanged && !command {
                    page.last_edge.set(0);
                    (page.sink)("input", json!({"command":false,"edge":null,"interacting":page.guest_interacting.get()}));
                    continue;
                }
                let window: Option<Retained<NSWindow>> = unsafe { msg_send![&*page.view, window] };
                let Some(window) =
                    window.filter(|window| window.windowNumber() == event.windowNumber())
                else {
                    continue;
                };
                if event.r#type() == NSEventType::FlagsChanged {
                    page.last_edge.set(0);
                    let inside=pointer_inside(page,&window);
                    POINTERS.with(|pointers| pointers.borrow_mut().insert(Retained::as_ptr(&page.view) as usize,inside));
                    (page.sink)("input", json!({"command":command,"edge":null,"pointerInside":inside,"interacting":page.guest_interacting.get()}));
                } else if event.r#type() == NSEventType::MouseMoved {
                    let inside=pointer_inside(page,&window);
                    let changed=POINTERS.with(|pointers| pointers.borrow_mut().insert(Retained::as_ptr(&page.view) as usize,inside)!=Some(inside));
                    if changed {
                        (page.sink)("input",json!({"command":command,"pointerInside":inside,"interacting":page.guest_interacting.get()}));
                    }
                    let x = event.locationInWindow().x;
                    let width = window
                        .contentView()
                        .map(|view| view.frame().size.width)
                        .unwrap_or(0.0);
                    let edge = if x < 14.0 {
                        Some("left")
                    } else if x > width - 14.0 {
                        Some("right")
                    } else {
                        None
                    };
                    let code = match edge {
                        Some("left") => -1,
                        Some("right") => 1,
                        _ => 0,
                    };
                    let changed = page.last_edge.replace(code) != code;
                    if let Some(edge) = edge.filter(|_| changed && page.visible) {
                        (page.sink)("input", json!({"command":null,"edge":edge}));
                    }
                }
            }
        });
        pointer.as_ptr()
    });
    let token = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(
            NSEventMask::FlagsChanged | NSEventMask::MouseMoved,
            &handler,
        )
    }
    .ok_or("Native project input observer unavailable")?;
    INPUT.with(|input| *input.borrow_mut() = Some(token));
    Ok(())
}

pub(super) fn teardown_if_empty() {
    POINTERS.with(|pointers| {
        pointers.borrow_mut().retain(|key, _| {
            PAGES.with(|pages| {
                pages
                    .borrow()
                    .values()
                    .any(|page| Retained::as_ptr(&page.view) as usize == *key)
            })
        })
    });
    if PAGES.with(|pages| pages.borrow().is_empty()) {
        POINTERS.with(|pointers| pointers.borrow_mut().clear());
        INPUT.with(|input| {
            if let Some(token) = input.borrow_mut().take() {
                unsafe {
                    objc2_app_kit::NSEvent::removeMonitor(&token);
                }
            }
        });
    }
}
