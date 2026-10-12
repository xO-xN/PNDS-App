//! Supply the standard JavaScript dialogs omitted by wry's macOS UI delegate.
//! Subclass only the selected performer's existing delegate, preserving file
//! upload/new-window handling and every unrelated App window. No page JS or
//! music protocol is replaced.
use block2::{DynBlock, RcBlock};
use objc2::{
    msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel},
    sel,
};
use objc2_app_kit::{NSAlert, NSAlertFirstButtonReturn, NSModalResponse, NSTextField, NSWindow};
use objc2_foundation::{MainThreadMarker, NSPoint, NSRect, NSSize, NSString};
use std::ffi::c_void;

static OK_KEY: u8 = 0;
static CANCEL_KEY: u8 = 0;
#[link(name = "objc")]
unsafe extern "C" {
    fn objc_setAssociatedObject(
        object: *mut AnyObject,
        key: *const c_void,
        value: *mut AnyObject,
        policy: usize,
    );
    fn objc_getAssociatedObject(object: *const AnyObject, key: *const c_void) -> *mut AnyObject;
}

unsafe fn alert_panel(
    this: &AnyObject,
    webview: &AnyObject,
    message: &NSString,
    frame: &AnyObject,
) -> Option<(Retained<NSAlert>, Retained<NSWindow>)> {
    let mtm = MainThreadMarker::new()?;
    let window: Option<Retained<NSWindow>> = unsafe { msg_send![webview, window] };
    let window = window?;
    // SAFETY: install associates retained NSStrings under these private keys.
    let ok = unsafe {
        Retained::<NSString>::retain(
            objc_getAssociatedObject(this, (&OK_KEY as *const u8).cast()).cast(),
        )
    }?;
    let cancel = unsafe {
        Retained::<NSString>::retain(
            objc_getAssociatedObject(this, (&CANCEL_KEY as *const u8).cast()).cast(),
        )
    }?;
    let alert = NSAlert::new(mtm);
    alert.setMessageText(message);
    // Attribute the page's dialog to its origin without displaying URL tokens.
    let origin: *mut AnyObject = unsafe { msg_send![frame, securityOrigin] };
    if !origin.is_null() {
        let host: Retained<NSString> = unsafe { msg_send![origin, host] };
        let scheme: Retained<NSString> = unsafe { msg_send![origin, protocol] };
        let port: isize = unsafe { msg_send![origin, port] };
        alert.setInformativeText(&NSString::from_str(&format!("{scheme}://{host}:{port}")));
    }
    alert.addButtonWithTitle(&ok);
    alert
        .addButtonWithTitle(&cancel)
        .setKeyEquivalent(&NSString::from_str("\u{1b}"));
    Some((alert, window))
}

unsafe extern "C" fn alert(
    this: &AnyObject,
    _cmd: Sel,
    webview: &AnyObject,
    message: &NSString,
    frame: &AnyObject,
    handler: &DynBlock<dyn Fn()>,
) {
    let Some((panel, window)) = (unsafe { alert_panel(this, webview, message, frame) }) else {
        handler.call(());
        return;
    };
    let completion = handler.copy();
    let keep_alive = panel.clone();
    let finished = RcBlock::new(move |_response: NSModalResponse| {
        let _ = &keep_alive;
        completion.call(());
    });
    panel.beginSheetModalForWindow_completionHandler(&window, Some(&finished));
}
unsafe extern "C" fn confirm(
    this: &AnyObject,
    _cmd: Sel,
    webview: &AnyObject,
    message: &NSString,
    frame: &AnyObject,
    handler: &DynBlock<dyn Fn(Bool)>,
) {
    let Some((panel, window)) = (unsafe { alert_panel(this, webview, message, frame) }) else {
        handler.call((Bool::NO,));
        return;
    };
    let completion = handler.copy();
    let keep_alive = panel.clone();
    let finished = RcBlock::new(move |response: NSModalResponse| {
        let _ = &keep_alive;
        completion.call((Bool::new(response == NSAlertFirstButtonReturn),));
    });
    panel.beginSheetModalForWindow_completionHandler(&window, Some(&finished));
}
unsafe extern "C" fn prompt(
    this: &AnyObject,
    _cmd: Sel,
    webview: &AnyObject,
    message: &NSString,
    default: *mut NSString,
    frame: &AnyObject,
    handler: &DynBlock<dyn Fn(*mut NSString)>,
) {
    let Some((panel, window)) = (unsafe { alert_panel(this, webview, message, frame) }) else {
        handler.call((std::ptr::null_mut(),));
        return;
    };
    let Some(mtm) = MainThreadMarker::new() else {
        handler.call((std::ptr::null_mut(),));
        return;
    };
    let field = NSTextField::initWithFrame(
        mtm.alloc(),
        NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(320.0, 24.0)),
    );
    if let Some(text) = unsafe { default.as_ref() } {
        field.setStringValue(text);
    }
    panel.setAccessoryView(Some(&field));
    let completion = handler.copy();
    let input = field.clone();
    let keep_alive = panel.clone();
    let finished = RcBlock::new(move |response: NSModalResponse| {
        let _ = &keep_alive;
        if response == NSAlertFirstButtonReturn {
            let text = input.stringValue();
            completion.call((Retained::as_ptr(&text).cast_mut(),));
        } else {
            completion.call((std::ptr::null_mut(),));
        }
    });
    panel.beginSheetModalForWindow_completionHandler(&window, Some(&finished));
    panel.window().makeFirstResponder(Some(&field));
    field.selectText(None);
}

fn dialog_class(parent: &AnyClass) -> Result<&'static AnyClass, String> {
    if let Some(class) = AnyClass::get(c"PNDSPerformerDialogDelegate") {
        return Ok(class);
    }
    let mut builder = ClassBuilder::new(c"PNDSPerformerDialogDelegate", parent)
        .ok_or("Could not create performer dialog delegate")?;
    // SAFETY: signatures match Apple's WKUIDelegate methods. This subclass
    // adds no ivars and inherits wry's original handlers and destruction.
    unsafe {
        builder.add_method(
            sel!(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:),
            alert as unsafe extern "C" fn(_, _, _, _, _, _),
        );
        builder.add_method(
            sel!(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:),
            confirm as unsafe extern "C" fn(_, _, _, _, _, _),
        );
        builder.add_method(sel!(webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:), prompt as unsafe extern "C" fn(_, _, _, _, _, _, _));
    }
    Ok(builder.register())
}

unsafe fn install_input_script(view: &AnyObject) -> Result<(), String> {
    let script_class = AnyClass::get(c"WKUserScript").ok_or("WKUserScript not available")?;
    let source = NSString::from_str(include_str!("../../../src/lib/performer-touch-script.js"));
    // SAFETY: public WebKit APIs, on the same UI thread as delegate setup.
    // The controller retains the script for all future frame navigations.
    unsafe {
        let configuration: *mut AnyObject = msg_send![view, configuration];
        let controller: *mut AnyObject = msg_send![configuration, userContentController];
        if controller.is_null() {
            return Err("Missing performer script controller".into());
        }
        let alloc: *mut AnyObject = msg_send![script_class, alloc];
        let script: *mut AnyObject = msg_send![alloc, initWithSource: &*source, injectionTime: 0_isize, forMainFrameOnly: false];
        let script = Retained::from_raw(script).ok_or("Could not create performer input script")?;
        let _: () = msg_send![controller, addUserScript: &*script];
    }
    Ok(())
}

/// Main thread only, for the UUID window already checked by prepare_window.
pub unsafe fn install(webview: *mut AnyObject, ok: &str, cancel: &str) -> Result<(), String> {
    let view = unsafe { webview.as_ref() }.ok_or("Missing performer webview")?;
    let delegate: *mut AnyObject = unsafe { msg_send![view, UIDelegate] };
    let original = unsafe { delegate.as_ref() }.ok_or("Missing performer UI delegate")?;
    let class = dialog_class(original.class())?;
    let first = original.class() != class;
    if first {
        unsafe {
            install_input_script(view)?;
        }
    }
    let ok = NSString::from_str(ok);
    let cancel = NSString::from_str(cancel);
    // SAFETY: retained associations use private static keys and are released
    // with the original delegate; its superclass layout/ivars are unchanged.
    unsafe {
        objc_setAssociatedObject(
            delegate,
            (&OK_KEY as *const u8).cast(),
            Retained::as_ptr(&ok).cast_mut().cast(),
            1,
        );
        objc_setAssociatedObject(
            delegate,
            (&CANCEL_KEY as *const u8).cast(),
            Retained::as_ptr(&cancel).cast_mut().cast(),
            1,
        );
        if first {
            AnyObject::set_class(original, class);
        }
        // WebKit caches respondsToSelector when its delegate is assigned.
        let _: () = msg_send![view, setUIDelegate: std::ptr::null::<AnyObject>()];
        let _: () = msg_send![view, setUIDelegate: delegate];
    }
    Ok(())
}
