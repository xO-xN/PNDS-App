//! Input routing between the App shell and its live project underlay.
//! These rectangles never cut visual holes out of the project layer; App
//! chrome composites above it through the shell's transparent stage.
use super::ProjectMediaBounds;
use objc2::{
    msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel},
    sel,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use std::{cell::RefCell, collections::BTreeMap};

thread_local! {
    static REGIONS: RefCell<BTreeMap<usize, Vec<NSRect>>> = const { RefCell::new(BTreeMap::new()) };
}

fn key(view: &AnyObject) -> usize {
    view as *const AnyObject as usize
}

unsafe extern "C" fn hit_test(view: &AnyObject, _cmd: Sel, point: NSPoint) -> *mut AnyObject {
    // NSView hitTest receives a point in its superview's coordinates.
    let parent: *mut AnyObject = unsafe { msg_send![view, superview] };
    let local: NSPoint = unsafe { msg_send![view, convertPoint: point, fromView: parent] };
    let excluded = REGIONS.with(|regions| {
        regions.borrow().get(&key(view)).is_some_and(|regions| {
            regions.iter().any(|rect| {
                local.x >= rect.origin.x
                    && local.x < rect.origin.x + rect.size.width
                    && local.y >= rect.origin.y
                    && local.y < rect.origin.y + rect.size.height
            })
        })
    });
    if excluded {
        return std::ptr::null_mut();
    }
    let Some(parent_class) = AnyClass::get(c"WKWebView") else {
        return std::ptr::null_mut();
    };
    // SAFETY: the registered class is a direct WKWebView subclass. Its normal
    // controls retain WebKit's hit testing everywhere outside an App notice.
    unsafe { msg_send![super(view, parent_class), hitTest: point] }
}

pub(super) fn view_class() -> Result<&'static AnyClass, String> {
    if let Some(class) = AnyClass::get(c"PNDSProjectMediaWebView") {
        return Ok(class);
    }
    let parent = AnyClass::get(c"WKWebView").ok_or("WKWebView unavailable")?;
    let mut builder = ClassBuilder::new(c"PNDSProjectMediaWebView", parent)
        .ok_or("Could not create project page view class")?;
    // SAFETY: the ABI exactly matches NSView's -hitTest:(NSPoint).
    unsafe {
        builder.add_method(
            sel!(hitTest:),
            hit_test as unsafe extern "C" fn(_, _, _) -> _,
        );
    }
    Ok(builder.register())
}

/// `bounds.occlusions` use top-left visual CSS pixels relative to the native
/// surface. Only hit coordinates are converted: their visual content remains
/// in the project underlay, beneath the App shell's native compositor layer.
pub(super) unsafe fn apply(
    view: &AnyObject,
    bounds: &ProjectMediaBounds,
    frame: NSRect,
) -> Result<(), String> {
    let scale_x = frame.size.width / bounds.width;
    let scale_y = frame.size.height / bounds.height;
    let flipped: Bool = unsafe { msg_send![view, isFlipped] };
    let view_regions: Vec<NSRect> = bounds
        .occlusions
        .iter()
        .map(|rect| {
            NSRect::new(
                NSPoint::new(
                    rect.x * scale_x,
                    if flipped.as_bool() {
                        rect.y * scale_y
                    } else {
                        frame.size.height - (rect.y + rect.height) * scale_y
                    },
                ),
                NSSize::new(rect.width * scale_x, rect.height * scale_y),
            )
        })
        .collect();
    unsafe {
        let _: () = msg_send![view, setWantsLayer: Bool::YES];
    }
    let layer: Option<Retained<AnyObject>> = unsafe { msg_send![view, layer] };
    let layer = layer.ok_or("Project page layer unavailable")?;
    if view_regions.is_empty() {
        unsafe {
            let _: () = msg_send![&*layer, setMask: std::ptr::null::<AnyObject>()];
        }
        clear(view);
        return Ok(());
    }
    REGIONS.with(|regions| {
        regions.borrow_mut().insert(key(view), view_regions);
    });
    Ok(())
}

pub(super) fn clear(view: &AnyObject) {
    REGIONS.with(|regions| {
        regions.borrow_mut().remove(&key(view));
    });
}
