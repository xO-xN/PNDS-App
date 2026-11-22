//! Only a committed WKWebView main document owns controller delivery.
use super::{
    initialize, show_changed, ControllerMappings, ControllerScope, InputOwner, PageReport,
};
use block2::RcBlock;
use objc2::{
    msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject},
};
use objc2_foundation::{NSNumber, NSString};
use serde_json::Value;
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use tauri::{AppHandle, Manager, Runtime};

const HANDLER: &str = "pndsController";

type Eligible = Rc<dyn Fn() -> bool>;

struct Route {
    id: u32,
    nonce: String,
    view: Retained<AnyObject>,
    eligible: Eligible,
}

thread_local! { static ROUTE: RefCell<Option<Route>> = const { RefCell::new(None) }; }

fn world() -> Retained<AnyObject> {
    let class = AnyClass::get(c"WKContentWorld").expect("WKContentWorld is available on macOS 13");
    let name = NSString::from_str("PNDSControllerMapping");
    unsafe { msg_send![class, worldWithName: &*name] }
}

pub(crate) fn install(content: &AnyObject, delegate: &AnyObject) -> Result<(), String> {
    let script_class = AnyClass::get(c"WKUserScript").ok_or("WKUserScript unavailable")?;
    let world = world();
    let source = NSString::from_str(concat!(
        include_str!("declared-targets.js"),
        "\n",
        include_str!("page.js")
    ));
    let project_api = NSString::from_str(include_str!("project-api.js"));
    let handler = NSString::from_str(HANDLER);
    unsafe {
        let allocated: objc2::rc::Allocated<AnyObject> = msg_send![script_class, alloc];
        let script: Retained<AnyObject> = msg_send![
            allocated, initWithSource: &*source,
            injectionTime: 0_isize, forMainFrameOnly: true,
            inContentWorld: &*world
        ];
        let _: () = msg_send![content, addUserScript: &*script];
        let allocated: objc2::rc::Allocated<AnyObject> = msg_send![script_class, alloc];
        let script: Retained<AnyObject> = msg_send![
            allocated, initWithSource: &*project_api,
            injectionTime: 0_isize, forMainFrameOnly: true
        ];
        let _: () = msg_send![content, addUserScript: &*script];
        let _: () = msg_send![
            content, addScriptMessageHandler: delegate,
            contentWorld: &*world, name: &*handler
        ];
    }
    Ok(())
}

pub(crate) fn uninstall(content: &AnyObject) {
    let world = world();
    let handler = NSString::from_str(HANDLER);
    unsafe {
        let _: () =
            msg_send![content, removeScriptMessageHandlerForName: &*handler, contentWorld: &*world];
    }
}

pub(crate) fn is_controller_message(message: &AnyObject) -> bool {
    let name: Retained<NSString> = unsafe { msg_send![message, name] };
    *name == *NSString::from_str(HANDLER)
}

fn evaluate(
    view: &AnyObject,
    script: &str,
    callback: impl Fn(*mut AnyObject, *mut AnyObject) + 'static,
) {
    let source = NSString::from_str(script);
    let world = world();
    let callback = RcBlock::new(callback);
    unsafe {
        let _: () = msg_send![
            view, evaluateJavaScript: &*source,
            inFrame: std::ptr::null::<AnyObject>(),
            inContentWorld: &*world, completionHandler: &*callback
        ];
    }
}

pub(super) fn owns(id: u32) -> bool {
    ROUTE.with_borrow(|route| {
        route
            .as_ref()
            .is_some_and(|route| route.id == id && (route.eligible)())
    })
}

fn current_document(id: u32) -> Option<(Retained<AnyObject>, Value)> {
    ROUTE.with_borrow(|route| {
        let route = route
            .as_ref()
            .filter(|route| route.id == id && (route.eligible)())?;
        Some((route.view.clone(), Value::String(route.nonce.clone())))
    })
}

pub(super) fn send(id: u32, payload: &Value) -> bool {
    let Some((view, nonce)) = current_document(id) else {
        return false;
    };
    evaluate(
        &view,
        &format!("globalThis.__pndsController?.receive({nonce}, {id}, {payload})"),
        |_, _| {},
    );
    true
}

pub(super) fn verify_learning(
    owner: InputOwner,
    click: u32,
    complete: impl Fn(Option<bool>) + 'static,
) {
    let InputOwner { page, version } = owner;
    let Some((view, nonce)) = current_document(page) else {
        complete(None);
        return;
    };
    evaluate(
        &view,
        &format!(
            "globalThis.__pndsController?.verifyLearning({nonce}, {page}, {version}, {click})"
        ),
        move |value, error| {
            let answer =
                unsafe { value.as_ref() }.and_then(|value| value.downcast_ref::<NSNumber>());
            complete(if error.is_null() {
                answer.map(NSNumber::boolValue)
            } else {
                None
            });
        },
    );
}

type Attach = Box<dyn Fn(&AnyObject, String) -> Option<u32>>;
type Report = Box<dyn Fn(u32, Option<PageReport>)>;

struct Owner {
    navigation: Cell<*mut AnyObject>,
    epoch: Cell<u32>,
    committed: Cell<bool>,
    token: Cell<Option<u32>>,
    attach: Attach,
    report: Report,
}

/// Connects a view to the controller only after its navigation is committed.
/// A view can retain this bridge while offscreen. Replacement is explicit.
pub(crate) struct PageBridge(Rc<Owner>);

impl PageBridge {
    pub(crate) fn new<R: Runtime>(
        app: &AppHandle<R>,
        scope: ControllerScope,
        eligible: impl Fn() -> bool + 'static,
    ) -> Self {
        let eligible: Eligible = Rc::new(eligible);
        let attach_app = app.clone();
        let attach = move |view: &AnyObject, nonce: String| {
            if !eligible() || initialize(&attach_app).is_err() {
                return None;
            }
            let state = attach_app.try_state::<ControllerMappings>()?;
            // The caller's live WKWebView is retained only while it owns input.
            let view = unsafe { Retained::retain(std::ptr::from_ref(view).cast_mut()) }?;
            let (id, snapshot) = {
                let mut state = state.lock();
                (state.attach(scope.clone()), state.snapshot())
            };
            ROUTE.with_borrow_mut(|route| {
                *route = Some(Route {
                    id,
                    nonce,
                    view,
                    eligible: eligible.clone(),
                });
            });
            show_changed(&attach_app, snapshot);
            Some(id)
        };
        let report_app = app.clone();
        let report = move |id, report| {
            let Some(state) = report_app.try_state::<ControllerMappings>() else {
                return;
            };
            let snapshot = {
                let mut state = state.lock();
                let changed = match report {
                    Some(report) if owns(id) => state.handle_page(id, report),
                    Some(_) => false,
                    None => state.retire(id),
                };
                changed.then(|| state.snapshot())
            };
            if let Some(snapshot) = snapshot {
                show_changed(&report_app, snapshot);
            }
        };
        Self(Rc::new(Owner {
            navigation: Cell::new(std::ptr::null_mut()),
            epoch: Cell::new(0),
            committed: Cell::new(false),
            token: Cell::new(None),
            attach: Box::new(attach),
            report: Box::new(report),
        }))
    }

    pub(crate) fn start(&self, navigation: *mut AnyObject) {
        self.retire();
        self.0.navigation.set(navigation);
    }

    pub(crate) fn finish(&self, view: &AnyObject, navigation: *mut AnyObject) {
        if self.0.navigation.get() != navigation {
            return;
        }
        self.0.committed.set(true);
        self.resume(view);
    }

    pub(crate) fn resume(&self, view: &AnyObject) {
        if !self.0.committed.get() || self.0.token.get().is_some() {
            return;
        }
        let owner = Rc::downgrade(&self.0);
        let epoch = self.0.epoch.get();
        let Some(retained) = (unsafe { Retained::retain(std::ptr::from_ref(view).cast_mut()) })
        else {
            return;
        };
        evaluate(
            view,
            "globalThis.__pndsController?.nonce",
            move |value, error| {
                let Some(owner) = owner.upgrade() else {
                    return;
                };
                if owner.epoch.get() != epoch || !error.is_null() || owner.token.get().is_some() {
                    return;
                }
                let Some(value) =
                    (unsafe { value.as_ref() }).and_then(|value| value.downcast_ref::<NSString>())
                else {
                    return;
                };
                let nonce = value.to_string();
                if nonce.len() == 32 && nonce.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                    owner.token.set((owner.attach)(&retained, nonce));
                }
            },
        );
    }

    pub(crate) fn fail(&self, navigation: *mut AnyObject) {
        if self.0.navigation.get() == navigation {
            self.retire();
        }
    }

    pub(crate) fn receive(&self, data: &Value) {
        let Some(id) = self.0.token.get() else {
            return;
        };
        let matches = ROUTE.with_borrow(|route| {
            route.as_ref().is_some_and(|route| {
                route.id == id
                    && data["nonce"].as_str() == Some(route.nonce.as_str())
                    && data["page"].as_u64() == Some(u64::from(id))
            })
        });
        if matches {
            if let Ok(report) = serde_json::from_value(data["report"].clone()) {
                (self.0.report)(id, Some(report));
            }
        }
    }

    pub(crate) fn suspend(&self) {
        self.0.epoch.set(self.0.epoch.get().wrapping_add(1));
        if let Some(id) = self.0.token.take() {
            let retired = ROUTE.with_borrow_mut(|route| {
                if route.as_ref().is_some_and(|route| route.id == id) {
                    route.take()
                } else {
                    None
                }
            });
            if let Some(retired) = retired {
                let nonce = Value::String(retired.nonce);
                evaluate(
                    &retired.view,
                    &format!(
                        "globalThis.__pndsController?.receive({nonce}, {id}, {{type:'deactivate'}})"
                    ),
                    |_, _| {},
                );
            }
            (self.0.report)(id, None);
        }
    }

    pub(crate) fn retire(&self) {
        self.0.navigation.set(std::ptr::null_mut());
        self.0.committed.set(false);
        self.suspend();
    }
}

impl Drop for PageBridge {
    fn drop(&mut self) {
        self.retire();
    }
}
