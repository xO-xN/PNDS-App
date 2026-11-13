//! The live page receives AppKit input first, while the shell paints over it.
use objc2::{
    msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, Bool},
};
use objc2_app_kit::NSView;
use objc2_foundation::NSRect;

pub(crate) fn shell_view(root: &NSView) -> Option<Retained<NSView>> {
    let class = AnyClass::get(c"WKWebView")?;
    let matches: Bool = unsafe { msg_send![root,isKindOfClass:class] };
    if matches.as_bool() {
        return unsafe { Retained::retain((root as *const NSView).cast_mut()) };
    }
    root.subviews().iter().find_map(|child| shell_view(&child))
}

pub(crate) fn shell_frame(parent: &NSView, shell: &NSView, viewport: Option<(f64, f64)>) -> NSRect {
    // The regular titlebar excludes the safe top inset. The production overlay
    // titlebar does not. Match the CSS viewport with the actual AppKit frame.
    let full = shell.bounds();
    let safe = shell.safeAreaRect();
    let content = if let Some((width, height)) = viewport {
        let expected = width / height;
        let full_error = (full.size.width / full.size.height - expected).abs();
        let safe_error = (safe.size.width / safe.size.height - expected).abs();
        if full_error <= safe_error {
            full
        } else {
            safe
        }
    } else {
        safe
    };
    unsafe { msg_send![parent,convertRect:content,fromView:shell] }
}

pub(crate) fn place_below_shell(page: &NSView, shell: &NSView) -> Result<f64, String> {
    let page_layer: Option<Retained<AnyObject>> = unsafe { msg_send![page, layer] };
    let shell_layer: Option<Retained<AnyObject>> = unsafe { msg_send![shell, layer] };
    let page_layer = page_layer.ok_or("Project page layer unavailable")?;
    let shell_layer = shell_layer.ok_or("Project shell layer unavailable")?;
    unsafe {
        let previous: f64 = msg_send![&*shell_layer, zPosition];
        // The page remains above macOS's z=0 vibrancy backdrop. Layer order
        // leaves AppKit's subview order, and therefore hit-testing, intact.
        let _: () = msg_send![&*page_layer,setZPosition:0.0_f64];
        let _: () = msg_send![&*shell_layer,setZPosition:1.0_f64];
        Ok(previous)
    }
}

pub(crate) fn restore_shell(shell: &NSView, previous: f64) {
    let layer: Option<Retained<AnyObject>> = unsafe { msg_send![shell, layer] };
    if let Some(layer) = layer {
        let _: () = unsafe { msg_send![&*layer, setZPosition: previous] };
    }
}
