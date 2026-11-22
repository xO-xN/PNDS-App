//! UI-thread-owned native project documents. Project pages receive no Tauri IPC.
use super::*;
use crate::controller_mapping::page as controller;
use block2::{DynBlock, RcBlock};
use objc2::{
    msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel},
    sel,
};
use objc2_app_kit::{NSModalResponseOK, NSOpenPanel, NSView, NSWindow};
use objc2_foundation::{
    MainThreadMarker, NSArray, NSPoint, NSRect, NSSize, NSString, NSURLRequest, NSURL,
};
use serde_json::{json, Value};
use std::cell::{Cell, RefCell};
use tauri_specta::Event;

#[path = "native_input.rs"]
mod input;
#[cfg(feature = "native-client-fixture")]
#[path = "native_snapshot.rs"]
mod snapshot;

type Gate = Box<dyn Fn() -> bool>;
type Sink = Box<dyn Fn(&str, Value)>;
struct Page {
    target: ProjectMediaTarget,
    view: Retained<AnyObject>,
    delegate: Retained<AnyObject>,
    parent: Retained<NSView>,
    shell: Retained<NSView>,
    shell_z_position: f64,
    viewport: Option<(f64, f64)>,
    origin: String,
    gate: Gate,
    sink: Sink,
    visible: bool,
    input_blocked: bool,
    closed: bool,
    focus_requested: bool,
    last_edge: Cell<i8>,
    guest_interacting: Cell<bool>,
    panel: Option<Retained<NSOpenPanel>>,
    controller: Option<controller::PageBridge>,
}
thread_local! { static PAGES: RefCell<BTreeMap<String, Page>> = const { RefCell::new(BTreeMap::new()) }; }

fn owner<T>(view: &AnyObject, action: impl FnOnce(&Page) -> T) -> Option<T> {
    PAGES.with(|pages| {
        pages
            .borrow()
            .values()
            .find(|page| std::ptr::eq::<AnyObject>(&*page.view, view))
            .map(action)
    })
}
fn same_origin(page: &Page, url: &str) -> bool {
    tauri::Url::parse(url).is_ok_and(|url| url.origin().ascii_serialization() == page.origin)
        && !page.closed
        && (page.gate)()
}
unsafe fn origin_url(origin: &AnyObject) -> String {
    let scheme: Retained<NSString> = unsafe { msg_send![origin, protocol] };
    let host: Retained<NSString> = unsafe { msg_send![origin, host] };
    let port: isize = unsafe { msg_send![origin, port] };
    format!("{scheme}://{host}:{port}/")
}
unsafe extern "C" fn policy(
    _this: &AnyObject,
    _cmd: Sel,
    view: &AnyObject,
    action: &AnyObject,
    handler: &DynBlock<dyn Fn(isize)>,
) {
    let request: Retained<AnyObject> = unsafe { msg_send![action, request] };
    let url: Option<Retained<NSURL>> = unsafe { msg_send![&*request, URL] };
    let permitted = url.and_then(|url| url.absoluteString()).is_some_and(|url| {
        owner(view, |page| same_origin(page, &url.to_string())).unwrap_or(false)
    });
    handler.call((isize::from(permitted),));
}
unsafe extern "C" fn media(
    _this: &AnyObject,
    _cmd: Sel,
    view: &AnyObject,
    origin: &AnyObject,
    frame: &AnyObject,
    _kind: isize,
    handler: &DynBlock<dyn Fn(isize)>,
) {
    let main: Bool = unsafe { msg_send![frame, isMainFrame] };
    let origin = unsafe { origin_url(origin) };
    let permitted = main.as_bool()
        && owner(view, |page| {
            page.visible
                && page.target.role != ProjectMediaRole::Projection
                && same_origin(page, &origin)
        })
        .unwrap_or(false);
    // Prompt, never Grant. macOS/TCC and WebKit retain the actual user choice.
    handler.call((if permitted { 0 } else { 2 },));
}
unsafe extern "C" fn popup(
    _this: &AnyObject,
    _cmd: Sel,
    _view: &AnyObject,
    _configuration: &AnyObject,
    _action: &AnyObject,
    _features: &AnyObject,
) -> *mut AnyObject {
    std::ptr::null_mut()
}
unsafe extern "C" fn started(
    _this: &AnyObject,
    _cmd: Sel,
    view: &AnyObject,
    navigation: *mut AnyObject,
) {
    owner(view, |page| {
        if let Some(controller) = &page.controller {
            controller.start(navigation);
        }
    });
}
unsafe extern "C" fn finished(
    _this: &AnyObject,
    _cmd: Sel,
    view: &AnyObject,
    navigation: *mut AnyObject,
) {
    owner(view, |page| {
        if !page.closed && (page.gate)() {
            if let Some(controller) = &page.controller {
                controller.finish(view, navigation);
            }
            (page.sink)("loaded", Value::Null);
        }
    });
}
unsafe extern "C" fn failed(
    _this: &AnyObject,
    _cmd: Sel,
    view: &AnyObject,
    navigation: *mut AnyObject,
    error: &AnyObject,
) {
    let description: Retained<NSString> = unsafe { msg_send![error, localizedDescription] };
    owner(view, |page| {
        if !page.closed && (page.gate)() {
            if let Some(controller) = &page.controller {
                controller.fail(navigation);
            }
            (page.sink)("error", json!(description.to_string()));
        }
    });
}
unsafe extern "C" fn process_terminated(_this: &AnyObject, _cmd: Sel, view: &AnyObject) {
    owner(view, |page| {
        if let Some(controller) = &page.controller {
            controller.retire();
        }
    });
}
unsafe extern "C" fn message(
    _this: &AnyObject,
    _cmd: Sel,
    _controller: &AnyObject,
    message: &AnyObject,
) {
    let view: *mut AnyObject = unsafe { msg_send![message, webView] };
    let Some(view) = (unsafe { view.as_ref() }) else {
        return;
    };
    let frame: Retained<AnyObject> = unsafe { msg_send![message, frameInfo] };
    let main: Bool = unsafe { msg_send![&*frame, isMainFrame] };
    if !main.as_bool() {
        return;
    }
    let origin: Retained<AnyObject> = unsafe { msg_send![&*frame, securityOrigin] };
    let origin = unsafe { origin_url(&origin) };
    let body: Retained<AnyObject> = unsafe { msg_send![message, body] };
    let Some(string) = AnyClass::get(c"NSString") else {
        return;
    };
    let is_string: Bool = unsafe { msg_send![&*body, isKindOfClass: string] };
    if !is_string.as_bool() {
        return;
    }
    let body = unsafe { &*Retained::as_ptr(&body).cast::<NSString>() }.to_string();
    if body.len() > 65536 {
        return;
    }
    let Ok(data) = serde_json::from_str::<Value>(&body) else {
        return;
    };
    if controller::is_controller_message(message) {
        owner(view, |page| {
            if let Some(controller) = page
                .controller
                .as_ref()
                .filter(|_| same_origin(page, &origin))
            {
                controller.receive(&data);
            }
        });
        return;
    }
    if !incoming_message(&data) {
        return;
    }
    owner(view, |page| {
        if same_origin(page, &origin) {
            if data["type"] == "pnds:guest-focus" {
                if let Some(interacting) = data["interacting"].as_bool() {
                    page.guest_interacting.set(interacting);
                }
            }
            (page.sink)("message", data);
        }
    });
}
unsafe extern "C" fn open_panel(
    _this: &AnyObject,
    _cmd: Sel,
    view: &AnyObject,
    parameters: &AnyObject,
    frame: &AnyObject,
    handler: &DynBlock<dyn Fn(*const NSArray<NSURL>)>,
) {
    let main: Bool = unsafe { msg_send![frame, isMainFrame] };
    let permit = main.as_bool()
        && owner(view, |page| {
            page.visible && !page.closed && (page.gate)() && page.panel.is_none()
        })
        .unwrap_or(false);
    let Some(mtm) = MainThreadMarker::new() else {
        handler.call((std::ptr::null(),));
        return;
    };
    let window: Option<Retained<NSWindow>> = unsafe { msg_send![view, window] };
    let Some(window) = window.filter(|_| permit) else {
        handler.call((std::ptr::null(),));
        return;
    };
    let panel = NSOpenPanel::openPanel(mtm);
    let multiple: Bool = unsafe { msg_send![parameters, allowsMultipleSelection] };
    let directories: Bool = unsafe { msg_send![parameters, allowsDirectories] };
    panel.setAllowsMultipleSelection(multiple.as_bool());
    panel.setCanChooseDirectories(directories.as_bool());
    panel.setCanChooseFiles(true);
    let owner_view = unsafe { Retained::retain((view as *const AnyObject).cast_mut()) }
        .expect("live WebKit view");
    PAGES.with(|pages| {
        if let Some(page) = pages
            .borrow_mut()
            .values_mut()
            .find(|page| std::ptr::eq::<AnyObject>(&*page.view, view))
        {
            page.panel = Some(panel.clone());
        }
    });
    let keep = panel.clone();
    let completion = handler.copy();
    let callback = RcBlock::new(move |response: isize| {
        let owned = PAGES.with(|pages| {
            let mut pages = pages.borrow_mut();
            let Some(page) = pages
                .values_mut()
                .find(|page| std::ptr::eq::<AnyObject>(&*page.view, &*owner_view))
            else {
                return false;
            };
            if !page
                .panel
                .as_ref()
                .is_some_and(|panel| std::ptr::eq::<NSOpenPanel>(&**panel, &*keep))
            {
                return false;
            }
            page.panel.take();
            !page.closed && (page.gate)()
        });
        if owned && response == NSModalResponseOK {
            completion.call((Retained::as_ptr(&keep.URLs()),));
        } else {
            completion.call((std::ptr::null(),));
        }
    });
    panel.beginSheetModalForWindow_completionHandler(&window, &callback);
}
fn delegate_class() -> Result<&'static AnyClass, String> {
    if let Some(class) = AnyClass::get(c"PNDSProjectPageDelegate") {
        return Ok(class);
    }
    let parent = AnyClass::get(c"NSObject").ok_or("NSObject unavailable")?;
    let mut builder = ClassBuilder::new(c"PNDSProjectPageDelegate", parent)
        .ok_or("Could not create project page delegate")?;
    unsafe {
        builder.add_method(
            sel!(webView:decidePolicyForNavigationAction:decisionHandler:),
            policy as unsafe extern "C" fn(_, _, _, _, _),
        );
        builder.add_method(sel!(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:), media as unsafe extern "C" fn(_,_,_,_,_,_,_));
        builder.add_method(
            sel!(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:),
            popup as unsafe extern "C" fn(_, _, _, _, _, _) -> _,
        );
        builder.add_method(
            sel!(webView:didStartProvisionalNavigation:),
            started as unsafe extern "C" fn(_, _, _, _),
        );
        builder.add_method(
            sel!(webViewWebContentProcessDidTerminate:),
            process_terminated as unsafe extern "C" fn(_, _, _),
        );
        builder.add_method(
            sel!(webView:didFinishNavigation:),
            finished as unsafe extern "C" fn(_, _, _, _),
        );
        builder.add_method(
            sel!(webView:didFailNavigation:withError:),
            failed as unsafe extern "C" fn(_, _, _, _, _),
        );
        builder.add_method(
            sel!(webView:didFailProvisionalNavigation:withError:),
            failed as unsafe extern "C" fn(_, _, _, _, _),
        );
        builder.add_method(
            sel!(userContentController:didReceiveScriptMessage:),
            message as unsafe extern "C" fn(_, _, _, _),
        );
        builder.add_method(
            sel!(webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:),
            open_panel as unsafe extern "C" fn(_, _, _, _, _, _),
        );
    }
    crate::performer::add_client_dialog_callbacks(&mut builder);
    Ok(builder.register())
}
unsafe fn script(controller: &AnyObject, source: &str) -> Result<(), String> {
    let class = AnyClass::get(c"WKUserScript").ok_or("WKUserScript unavailable")?;
    let source = NSString::from_str(source);
    unsafe {
        let allocated: objc2::rc::Allocated<AnyObject> = msg_send![class, alloc];
        let script: Retained<AnyObject> = msg_send![allocated, initWithSource: &*source, injectionTime: 0_isize, forMainFrameOnly: true];
        let _: () = msg_send![controller, addUserScript: &*script];
    }
    Ok(())
}
fn frame(parent: &NSView, shell: &NSView, bounds: &ProjectMediaBounds) -> NSRect {
    let host = compositor::shell_frame(
        parent,
        shell,
        Some((bounds.viewport_width, bounds.viewport_height)),
    );
    let size = host.size;
    let x = bounds.x * size.width / bounds.viewport_width;
    let width = bounds.width * size.width / bounds.viewport_width;
    let height = bounds.height * size.height / bounds.viewport_height;
    let y = bounds.y * size.height / bounds.viewport_height;
    NSRect::new(
        NSPoint::new(
            host.origin.x + x,
            host.origin.y
                + if parent.isFlipped() {
                    y
                } else {
                    size.height - y - height
                },
        ),
        NSSize::new(width, height),
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn create<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    target: &ProjectMediaTarget,
    generation: &str,
    page_url: String,
    proxy_address: SocketAddr,
    shell_origin: &str,
    bounds: Option<ProjectMediaBounds>,
) -> Result<(), String> {
    MainThreadMarker::new().ok_or("Native project page requires the main thread")?;
    let window = app
        .get_webview_window(label)
        .ok_or("Project window missing")?;
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    let window = unsafe { &*pointer.cast::<NSWindow>() };
    let parent = window
        .contentView()
        .ok_or("Project window content missing")?;
    let shell = compositor::shell_view(&parent).ok_or("Project shell webview missing")?;
    // Keep NSView order for project input, but composite its pixels below the
    // transparent App shell. A visual mask would expose the shell's empty
    // stage/background around rounded, translucent and fading App controls.
    let shell_window = app
        .get_webview_window(label)
        .ok_or("Project shell webview missing")?;
    let webview: &tauri::Webview<R> = shell_window.as_ref();
    webview
        .set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)))
        .map_err(|error| error.to_string())?;
    let temporary_store = if target.role == ProjectMediaRole::Performer {
        performer_store(app, label)?
    } else {
        storage_root(app)?
    };
    let configuration = crate::client_score_view::project_configuration(
        app,
        page_url.clone(),
        proxy_address,
        Some(&temporary_store),
    )?;
    let class = occlusion::view_class()?;
    for selector in [sel!(_close), sel!(_isClosed), sel!(setPageZoom:)] {
        if class.instance_method(selector).is_none() {
            return Err("Project document lifetime API unavailable".into());
        }
    }
    let origin = tauri::Url::parse(&page_url)
        .map_err(|error| error.to_string())?
        .origin()
        .ascii_serialization();
    let expected = target.clone();
    let current_app = app.clone();
    let expected_label = label.to_owned();
    let generation = generation.to_owned();
    let controller_bridge = (label == "main" && target.role == ProjectMediaRole::Monitor)
        .then(|| {
            app.state::<SessionManager>()
                .controller_monitor_scope(&generation)
        })
        .flatten()
        .map(|scope| {
            let app_for_gate = app.clone();
            let expected = target.clone();
            let generation = generation.clone();
            controller::PageBridge::new(app, scope, move || {
                crate::window::main_performance_key_owner()
                    && current(&app_for_gate, "main", &expected, &generation)
                    && app_for_gate
                        .state::<SessionManager>()
                        .owns_controller_monitor(&generation)
            })
        });
    let gate = move || current(&current_app, &expected_label, &expected, &generation);
    let sink_app = app.clone();
    let sink_label = label.to_owned();
    let navigation = target.navigation.clone();
    let sink = move |kind: &str, data: Value| {
        let _ = crate::events::ProjectMediaViewEvent {
            label: sink_label.clone(),
            navigation: navigation.clone(),
            kind: kind.into(),
            data,
        }
        .emit_to(&sink_app, &sink_label);
    };
    let metadata = json!({"role":target.role,"shellOrigin":shell_origin});
    let source = include_str!("bridge.js").replace("__PNDS_PROJECT_OWNER__", &metadata.to_string());
    let labels = crate::client_score_view::project_dialog_labels(app)?;
    unsafe {
        let delegate: Retained<AnyObject> = msg_send![delegate_class()?, new];
        crate::performer::set_client_dialog_labels(&delegate, &labels.0, &labels.1);
        let controller: Retained<AnyObject> = msg_send![&*configuration, userContentController];
        let _: () = msg_send![&*controller,addScriptMessageHandler:&*delegate,name:&*NSString::from_str("pndsProject")];
        script(&controller, &source)?;
        if controller_bridge.is_some() {
            controller::install(&controller, &delegate)?;
        }
        if target.role == ProjectMediaRole::Performer {
            script(
                &controller,
                include_str!("../../../src/lib/performer-touch-script.js"),
            )?;
        }
        let allocated: objc2::rc::Allocated<AnyObject> = msg_send![class, alloc];
        let initial = bounds
            .as_ref()
            .map(|bounds| frame(&parent, &shell, bounds))
            .unwrap_or_else(|| compositor::shell_frame(&parent, &shell, None));
        let view: Retained<AnyObject> =
            msg_send![allocated,initWithFrame:initial,configuration:&*configuration];
        let _: () = msg_send![&*view,setNavigationDelegate:&*delegate];
        let _: () = msg_send![&*view,setUIDelegate:&*delegate];
        let _: () = msg_send![&*view,setHidden:Bool::YES];
        parent.setWantsLayer(true);
        shell.setWantsLayer(true);
        let _: () = msg_send![&*view,setWantsLayer:Bool::YES];
        let _: () = msg_send![&*parent,addSubview:&*view];
        let native_view = view
            .downcast_ref::<NSView>()
            .ok_or("Project page is not an AppKit view")?;
        let shell_z_position = compositor::place_below_shell(native_view, &shell)?;
        PAGES.with(|pages| {
            pages.borrow_mut().insert(
                label.into(),
                Page {
                    target: target.clone(),
                    view: view.clone(),
                    delegate,
                    parent,
                    shell,
                    shell_z_position,
                    viewport: bounds
                        .as_ref()
                        .map(|bounds| (bounds.viewport_width, bounds.viewport_height)),
                    origin,
                    gate: Box::new(gate),
                    sink: Box::new(sink),
                    visible: false,
                    input_blocked: false,
                    closed: false,
                    focus_requested: false,
                    last_edge: Cell::new(0),
                    guest_interacting: Cell::new(false),
                    panel: None,
                    controller: controller_bridge,
                },
            )
        });
        let url = NSURL::URLWithString(&NSString::from_str(&page_url))
            .ok_or("Invalid project page URL")?;
        let reload = tauri::Url::parse(&target.url)
            .map_err(|error| error.to_string())?
            .query_pairs()
            .any(|(key, value)| key == "_r" && value.parse::<u64>().is_ok_and(|value| value > 0));
        let request = NSURLRequest::requestWithURL_cachePolicy_timeoutInterval(
            &url,
            if reload {
                objc2_foundation::NSURLRequestCachePolicy::ReloadIgnoringLocalCacheData
            } else {
                objc2_foundation::NSURLRequestCachePolicy::UseProtocolCachePolicy
            },
            30.0,
        );
        let _: *mut AnyObject = msg_send![&*view,loadRequest:&*request];
    }
    window.setAcceptsMouseMovedEvents(true);
    input::install(app)?;
    Ok(())
}

pub(super) fn show<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    bounds: Option<ProjectMediaBounds>,
) -> Result<(), String> {
    let (view, restore_focus, visible) = PAGES.with(|pages| {
        let mut pages = pages.borrow_mut();
        let page = pages.get_mut(label).ok_or("Project page missing")?;
        if page.closed || !(page.gate)() {
            return Err("Project page has retired".into());
        }
        unsafe {
            let old_visible = page.visible;
            if let Some(bounds) = bounds {
                page.input_blocked = bounds.occlusions.iter().any(|region| {
                    region.x <= 0.0 && region.y <= 0.0
                        && region.width >= bounds.width && region.height >= bounds.height
                });
                let frame = frame(&page.parent, &page.shell, &bounds);
                page.viewport=Some((bounds.viewport_width,bounds.viewport_height));
                let _: () = msg_send![&*page.view,setFrame:frame];
                let _: () = msg_send![&*page.view,setPageZoom:frame.size.width/bounds.page_width];
                let _: () = msg_send![&*page.view,setAlphaValue:bounds.opacity];
                let _: () = msg_send![&*page.view,setWantsLayer:Bool::YES];
                let layer: *mut AnyObject = msg_send![&*page.view, layer];
                if !layer.is_null() {
                    let _: () = msg_send![layer,setMasksToBounds:Bool::YES];
                    let _: () = msg_send![layer,setCornerRadius:bounds.corner_radius*frame.size.width/bounds.width];
                }
                occlusion::apply(&page.view, &bounds, frame)?;
                let _: () = msg_send![&*page.view,setHidden:Bool::NO];
                page.visible = true;
            } else {
                let _: () = msg_send![&*page.view,setHidden:Bool::YES];
                page.visible = false;
                page.input_blocked = false;
            }
            if page.visible && !page.input_blocked && page.focus_requested {
                let window: *mut AnyObject = msg_send![&*page.view, window];
                let _: Bool = msg_send![window,makeFirstResponder:&*page.view];
                page.focus_requested = false;
            }
            Ok::<_, String>((
                page.view.clone(),
                old_visible && (!page.visible || page.input_blocked),
                page.visible,
            ))
        }
    })?;
    if restore_focus {
        let window: Option<Retained<NSWindow>> = unsafe { msg_send![&*view, window] };
        if let Some(window) = window {
            let first: *mut AnyObject = unsafe { msg_send![&*window, firstResponder] };
            let descendant = !first.is_null()
                && unsafe {
                    let responds: Bool =
                        msg_send![&*first,respondsToSelector:sel!(isDescendantOf:)];
                    responds.as_bool() && {
                        let test: Bool = msg_send![&*first,isDescendantOf:&*view];
                        test.as_bool()
                    }
                };
            if descendant || first == Retained::as_ptr(&view).cast_mut() {
                if let Some(shell) = app.get_webview_window(label) {
                    shell
                        .with_webview(|platform| unsafe {
                            let host = &*platform.inner().cast::<AnyObject>();
                            let window: *mut AnyObject = msg_send![host, window];
                            let _: Bool = msg_send![window,makeFirstResponder:host];
                        })
                        .map_err(|error| error.to_string())?;
                }
            }
        }
    }
    let _ = visible;
    Ok(())
}

pub(super) fn post<R: Runtime>(
    _app: &AppHandle<R>,
    label: &str,
    navigation: &str,
    message: &Value,
) -> Result<(), String> {
    let view = PAGES.with(|pages| {
        pages
            .borrow()
            .get(label)
            .filter(|page| page.target.navigation == navigation && !page.closed && (page.gate)())
            .map(|page| {
                (
                    page.view.clone(),
                    page.visible,
                    page.shell.clone(),
                    page.guest_interacting.get(),
                )
            })
    });
    let Some((view, visible, shell, interacting)) = view else {
        return Ok(());
    };
    unsafe {
        if message["type"] == "pnds:host-focus" {
            let window: Option<Retained<NSWindow>> = msg_send![&*view, window];
            if let Some(window) =
                window.filter(|window| visible && !interacting && window.isKeyWindow())
            {
                let first: *mut AnyObject = msg_send![&*window, firstResponder];
                let descendant = !first.is_null() && {
                    let responds: Bool = msg_send![first,respondsToSelector:sel!(isDescendantOf:)];
                    responds.as_bool() && {
                        let answer: Bool = msg_send![first,isDescendantOf:&*view];
                        answer.as_bool()
                    }
                };
                if descendant || first == Retained::as_ptr(&view).cast_mut() {
                    let _: Bool = msg_send![&*window,makeFirstResponder:&*shell];
                }
            }
        } else if message["type"] == "pnds:focus" {
            let blocked = PAGES.with(|pages| {
                pages
                    .borrow()
                    .get(label)
                    .is_some_and(|page| page.input_blocked)
            });
            if !visible || blocked {
                PAGES.with(|pages| {
                    if let Some(page) = pages.borrow_mut().get_mut(label) {
                        page.focus_requested = true;
                    }
                });
            }
            if visible && !blocked {
                let window: *mut AnyObject = msg_send![&*view, window];
                let _: Bool = msg_send![window,makeFirstResponder:&*view];
            }
        } else {
            let source =
                NSString::from_str(&format!("globalThis.__PNDSProjectReceive?.({message})"));
            let completion = RcBlock::new(|_value: *mut AnyObject, _error: *mut AnyObject| {});
            let _: () =
                msg_send![&*view,evaluateJavaScript:&*source,completionHandler:&*completion];
        }
    }
    Ok(())
}

pub(super) fn reconcile_controller_mode() {
    PAGES.with_borrow(|pages| {
        let Some(page) = pages.get("main") else {
            return;
        };
        if let Some(controller) = &page.controller {
            if crate::window::main_performance_key_owner() {
                controller.resume(&page.view);
            } else {
                controller.suspend();
            }
        }
    });
}

pub(super) fn close(label: &str) -> Result<(), String> {
    let Some(mut page) = PAGES.with(|pages| pages.borrow_mut().remove(label)) else {
        return Ok(());
    };
    if let Some(controller) = &page.controller {
        controller.retire();
    }
    let result: Result<(), String> = (|| {
        unsafe {
            let _: () = msg_send![&*page.view,setHidden:Bool::YES];
            page.visible = false;
            occlusion::clear(&page.view);
            (page.sink)("input", json!({"command":false,"edge":null}));
            crate::performer::cancel_client_dialogs(&page.delegate);
            if let Some(panel) = page.panel.take() {
                let _: () = msg_send![&*panel,cancel:std::ptr::null::<AnyObject>()];
            }
            if !page.closed {
                let _: () = msg_send![&*page.view, stopLoading];
                let _: () = msg_send![&*page.view, _close];
                let closed: Bool = msg_send![&*page.view, _isClosed];
                if !closed.as_bool() {
                    return Err("Project document closure was not confirmed".into());
                }
                page.closed = true;
                let _: () = msg_send![&*page.view, removeFromSuperview];
                compositor::restore_shell(&page.shell, page.shell_z_position);
            }
            let config: Retained<AnyObject> = msg_send![&*page.view, configuration];
            let store: Retained<AnyObject> = msg_send![&*config, websiteDataStore];
            objc2_foundation::NSRunLoop::mainRunLoop().runUntilDate(
                &objc2_foundation::NSDate::dateWithTimeIntervalSinceNow(0.01),
            );
            crate::client_score_view::flush_project_store(&store)?;
            let controller: Retained<AnyObject> = msg_send![&*config, userContentController];
            let _: () = msg_send![&*controller,removeScriptMessageHandlerForName:&*NSString::from_str("pndsProject")];
            if page.controller.is_some() {
                controller::uninstall(&controller);
            }
        }
        Ok(())
    })();
    if result.is_err() {
        PAGES.with(|pages| pages.borrow_mut().insert(label.into(), page));
    } else {
        input::teardown_if_empty();
    }
    result
}

#[cfg(feature = "native-client-fixture")]
pub(super) fn fixture_evaluate(
    label: &str,
    script: String,
    tx: tokio::sync::oneshot::Sender<Result<String, String>>,
) {
    let view = PAGES.with(|pages| pages.borrow().get(label).map(|page| page.view.clone()));
    let Some(view) = view else {
        let _ = tx.send(Err("document absent".into()));
        return;
    };
    let visibility = unsafe {
        let hidden: Bool = msg_send![&*view, isHiddenOrHasHiddenAncestor];
        let window: *mut AnyObject = msg_send![&*view, window];
        let visible: Bool = msg_send![window, isVisible];
        let key: Bool = msg_send![window, isKeyWindow];
        let occlusion: usize = msg_send![window, occlusionState];
        let frame: NSRect = msg_send![&*view, frame];
        let application: Retained<AnyObject> =
            msg_send![AnyClass::get(c"NSApplication").unwrap(), sharedApplication];
        let active: Bool = msg_send![&*application, isActive];
        json!({"viewHidden":hidden.as_bool(),"windowVisible":visible.as_bool(),"keyWindow":key.as_bool(),"appActive":active.as_bool(),"windowOcclusion":occlusion,"frame":[frame.origin.x,frame.origin.y,frame.size.width,frame.size.height]})
    };
    let tx = Mutex::new(Some(tx));
    let callback = RcBlock::new(move |value: *mut AnyObject, cause: *mut AnyObject| {
        let result = if value.is_null() || !cause.is_null() {
            Err("JavaScript probe failed".into())
        } else {
            unsafe {
                let value = &*value.cast::<NSString>();
                serde_json::from_str::<Value>(&value.to_string())
                    .map(|mut value| {
                        if let Some(object) = value.as_object_mut() {
                            object.insert("nativeVisibility".into(), visibility.clone());
                        }
                        value.to_string()
                    })
                    .map_err(|error| error.to_string())
            }
        };
        if let Some(tx) = tx.lock().unwrap().take() {
            let _ = tx.send(result);
        }
    });
    unsafe {
        let _: () = msg_send![&*view,evaluateJavaScript:&*NSString::from_str(&script),completionHandler:&*callback];
    }
}
#[cfg(feature = "native-client-fixture")]
pub(super) fn fixture_focus(label: &str) -> Result<(), String> {
    PAGES.with(|pages| {
        let pages = pages.borrow();
        let page = pages.get(label).ok_or("Project page missing")?;
        unsafe {
            let app: Retained<AnyObject> = msg_send![
                AnyClass::get(c"NSApplication").ok_or("NSApplication missing")?,
                sharedApplication
            ];
            let _: () = msg_send![&*app,activateIgnoringOtherApps:Bool::YES];
            let window: *mut AnyObject = msg_send![&*page.view, window];
            let _: () = msg_send![window,makeKeyAndOrderFront:std::ptr::null::<AnyObject>()];
            let _: Bool = msg_send![window,makeFirstResponder:&*page.view];
        }
        Ok(())
    })
}

#[cfg(feature = "native-client-fixture")]
pub(super) fn fixture_capture(
    label: &str,
    path: &std::path::Path,
    points: &[(f64, f64)],
) -> Result<Value, String> {
    PAGES.with(|pages| {
        let pages = pages.borrow();
        let page = pages.get(label).ok_or("Project page missing")?;
        unsafe {
            let window: Retained<NSWindow> = msg_send![&*page.view, window];
            snapshot::capture(
                &window,
                &page.parent,
                compositor::shell_frame(&page.parent, &page.shell, page.viewport),
                path,
                points,
            )
        }
    })
}

#[cfg(feature = "native-client-fixture")]
pub(super) fn fixture_click(label: &str, x: f64, y: f64) -> Result<Value, String> {
    PAGES.with(|pages|{
        let pages=pages.borrow();let page=pages.get(label).ok_or("Project page missing")?;
        unsafe {
            let window:Retained<NSWindow>=msg_send![&*page.view,window];
            let host=compositor::shell_frame(&page.parent,&page.shell,page.viewport);
            let point=NSPoint::new(host.origin.x+x,host.origin.y+if page.parent.isFlipped(){y}else{host.size.height-y});
            let hit:*mut AnyObject=msg_send![&*page.parent,hitTest:point];
            let native_hit=if hit.is_null(){false}else{let native:Bool=msg_send![hit,isDescendantOf:&*page.view];native.as_bool()};
            let hit_class=if hit.is_null(){"nil".into()}else{(&*hit).class().name().to_string_lossy().into_owned()};
            let app:Retained<AnyObject>=msg_send![AnyClass::get(c"NSApplication").ok_or("NSApplication missing")?,sharedApplication];
            let class=AnyClass::get(c"NSEvent").ok_or("NSEvent missing")?;
            // NSButton.mouseDown tracks synchronously until a queued mouseUp.
            // Queue release before dispatching the press; WK input also keeps
            // the same down/up sequence through the AppKit event loop.
            for kind in [2_usize,1_usize]{
                let event:Retained<AnyObject>=msg_send![class,mouseEventWithType:kind,location:point,modifierFlags:0_usize,timestamp:objc2_foundation::NSProcessInfo::processInfo().systemUptime(),windowNumber:window.windowNumber(),context:std::ptr::null::<AnyObject>(),eventNumber:1_isize,clickCount:1_isize,pressure:1.0_f32];
                if kind == 2 {
                    let _:()=msg_send![&*app,postEvent:&*event,atStart:Bool::NO];
                } else {
                    let _:()=msg_send![&*app,sendEvent:&*event];
                }
            }
            let insets=page.shell.safeAreaInsets();
            let safe=page.shell.safeAreaRect();let visible=page.shell.visibleRect();let layout=window.contentLayoutRect();let shell=page.shell.frame();let parent=page.parent.frame();
            let rectangle=|rect:NSRect|[rect.origin.x,rect.origin.y,rect.size.width,rect.size.height];
            let responds:Bool=msg_send![&*page.shell,respondsToSelector:sel!(_topContentInset)];
            let top_inset:Option<f64>=if responds.as_bool(){Some(msg_send![&*page.shell,_topContentInset])}else{None};
            Ok(json!({"hitNativePage":native_hit,"hitClass":hit_class,"point":[point.x,point.y],"shellFrame":rectangle(shell),"parentFrame":rectangle(parent),"safeAreaRect":rectangle(safe),"visibleRect":rectangle(visible),"contentLayoutRect":rectangle(layout),"safeAreaInsets":[insets.top,insets.left,insets.bottom,insets.right],"topContentInset":top_inset}))
        }
    })
}

#[cfg(feature = "native-client-fixture")]
pub(super) fn fixture_keys(
    label: &str,
    characters: &str,
    key_code: u16,
    modifiers: usize,
) -> Result<Value, String> {
    PAGES.with(|pages|{
        let pages=pages.borrow();let page=pages.get(label).ok_or("Project page missing")?;
        unsafe {
            let window:Retained<NSWindow>=msg_send![&*page.view,window];
            let app:Retained<AnyObject>=msg_send![AnyClass::get(c"NSApplication").ok_or("NSApplication missing")?,sharedApplication];
            let class=AnyClass::get(c"NSEvent").ok_or("NSEvent missing")?;
            let empty=NSString::from_str("");let text=NSString::from_str(characters);
            if modifiers!=0 {
                let flags:Retained<AnyObject>=msg_send![class,keyEventWithType:12_usize,location:NSPoint::new(0.0,0.0),modifierFlags:modifiers,timestamp:objc2_foundation::NSProcessInfo::processInfo().systemUptime(),windowNumber:window.windowNumber(),context:std::ptr::null::<AnyObject>(),characters:&*empty,charactersIgnoringModifiers:&*empty,isARepeat:Bool::NO,keyCode:55_u16];
                let _:()=msg_send![&*app,sendEvent:&*flags];
            }
            for kind in [10_usize,11_usize]{
                let event:Retained<AnyObject>=msg_send![class,keyEventWithType:kind,location:NSPoint::new(0.0,0.0),modifierFlags:modifiers,timestamp:objc2_foundation::NSProcessInfo::processInfo().systemUptime(),windowNumber:window.windowNumber(),context:std::ptr::null::<AnyObject>(),characters:&*text,charactersIgnoringModifiers:&*text,isARepeat:Bool::NO,keyCode:key_code];
                let _:()=msg_send![&*app,sendEvent:&*event];
            }
            if modifiers!=0 {
                let flags:Retained<AnyObject>=msg_send![class,keyEventWithType:12_usize,location:NSPoint::new(0.0,0.0),modifierFlags:0_usize,timestamp:objc2_foundation::NSProcessInfo::processInfo().systemUptime(),windowNumber:window.windowNumber(),context:std::ptr::null::<AnyObject>(),characters:&*empty,charactersIgnoringModifiers:&*empty,isARepeat:Bool::NO,keyCode:55_u16];
                let _:()=msg_send![&*app,sendEvent:&*flags];
            }
            Ok(json!({"key":characters,"modifiers":modifiers,"guestInteracting":page.guest_interacting.get()}))
        }
    })
}

#[cfg(feature = "native-client-fixture")]
pub(super) fn fixture_ownership(label: &str) -> Result<Value, String> {
    PAGES.with(|pages|{
        let pages=pages.borrow();let page=pages.get(label).ok_or("Project page missing")?;
        unsafe {
            let window:Retained<NSWindow>=msg_send![&*page.view,window];
            let first:*mut AnyObject=msg_send![&*window,firstResponder];
            let descendant=|view:&AnyObject|->bool {if first.is_null(){return false;}let responds:Bool=msg_send![first,respondsToSelector:sel!(isDescendantOf:)];responds.as_bool() && {let answer:Bool=msg_send![first,isDescendantOf:view];answer.as_bool()}};
            Ok(json!({"guest":descendant(&page.view),"shell":descendant(&page.shell),"interacting":page.guest_interacting.get(),"keyWindow":window.isKeyWindow(),"visible":page.visible}))
        }
    })
}
