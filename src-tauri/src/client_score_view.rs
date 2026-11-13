//! First-party Client score storage stays at its durable origin while the
//! app-owned HTTP proxy can bind another transport port.
use crate::participation_client::{ClientCoordinator, ClientError, ClientPageTarget};
use serde::Deserialize;
use specta::Type;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Clone, Copy, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientScoreBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub viewport_width: f64,
    pub viewport_height: f64,
    pub sidebar: Option<ClientScoreSidebar>,
    #[serde(default)]
    pub toast: Option<ClientScoreToastBounds>,
}

#[derive(Debug, Clone, Copy, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientScoreSidebar {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub corner_radius: f64,
    pub focus_app: bool,
}

impl ClientScoreSidebar {
    fn valid(self, viewport_width: f64, viewport_height: f64) -> bool {
        [self.x, self.y, self.width, self.height, self.corner_radius]
            .iter()
            .all(|value| value.is_finite())
            && self.width > 0.0
            && self.height > 0.0
            && self.x > -self.width
            && self.y > -self.height
            && self.x < viewport_width
            && self.y < viewport_height
            && self.width <= viewport_width + 1.0
            && self.height <= viewport_height + 1.0
            && (0.0..=self.width.max(self.height)).contains(&self.corner_radius)
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientScoreToastBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl ClientScoreToastBounds {
    fn valid(self, viewport_width: f64, viewport_height: f64) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|value| value.is_finite())
            && self.x >= 0.0
            && self.y >= 0.0
            && self.width > 0.0
            && self.height > 0.0
            && self.x + self.width <= viewport_width + 1.0
            && self.y + self.height <= viewport_height + 1.0
    }
}

#[derive(Default)]
pub struct ClientScoreView {
    requests: Mutex<Option<ViewRequest>>,
    view: Mutex<Option<ViewOwner>>,
    closing: AtomicBool,
    #[cfg(feature = "native-client-fixture")]
    pub(crate) fixture_storage: Mutex<Option<std::path::PathBuf>>,
}

struct CloseGuard<'a>(&'a AtomicBool);
impl Drop for CloseGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

struct ViewRequest {
    epoch: u32,
    url: String,
    request: f64,
}

struct ViewOwner {
    epoch: u32,
    url: String,
    visible: bool,
    presented: bool,
    sidebar_focus_requested: bool,
    closing: bool,
}

fn error(detail: impl std::fmt::Display) -> ClientError {
    format!("participation.errors.scoreView: {detail}").into()
}

fn matches_target<R: Runtime>(app: &AppHandle<R>, target: &ClientPageTarget) -> bool {
    app.state::<ClientCoordinator>()
        .view_target()
        .is_some_and(|current| current.epoch == target.epoch && current.page_url == target.page_url)
}

impl ClientScoreView {
    fn admit(&self, target: &ClientPageTarget, request: f64) -> bool {
        let mut current = self.requests.lock().unwrap();
        if current.as_ref().is_some_and(|current| {
            current.epoch == target.epoch
                && current.url == target.page_url
                && current.request >= request
        }) {
            return false;
        }
        *current = Some(ViewRequest {
            epoch: target.epoch,
            url: target.page_url.clone(),
            request,
        });
        true
    }

    fn current(&self, target: &ClientPageTarget, request: f64) -> bool {
        self.requests
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|current| {
                current.epoch == target.epoch
                    && current.url == target.page_url
                    && current.request == request
            })
    }
}

pub(crate) fn client_input_owner<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(state) = app.try_state::<ClientScoreView>() else {
        return false;
    };
    let Some(client) = app.try_state::<ClientCoordinator>() else {
        return false;
    };
    let Some(target) = client.view_target() else {
        return false;
    };
    let owns = state.view.lock().unwrap().as_ref().is_some_and(|owner| {
        owner.epoch == target.epoch && owner.url == target.page_url && !owner.closing
    });
    owns
}

pub(crate) fn client_input_visible<R: Runtime>(app: &AppHandle<R>) -> bool {
    client_input_owner(app)
        && app
            .state::<ClientScoreView>()
            .view
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|owner| owner.visible)
}

pub(crate) fn client_input_scale<R: Runtime>(_app: &AppHandle<R>) -> f64 {
    #[cfg(target_os = "macos")]
    {
        native::scale()
    }
    #[cfg(not(target_os = "macos"))]
    {
        1.0
    }
}

/// Both arrival and the main-thread action bind to the current native epoch.
/// Lower requests from delayed ResizeObserver or hide callbacks are ignored.
pub async fn sync<R: Runtime>(
    app: AppHandle<R>,
    expected_page_url: String,
    request: f64,
    bounds: Option<ClientScoreBounds>,
) -> Result<(), ClientError> {
    let Some(target) = app
        .state::<ClientCoordinator>()
        .view_target()
        .filter(|target| target.page_url == expected_page_url)
    else {
        return Ok(());
    };
    if !request.is_finite()
        || request.fract() != 0.0
        || !(0.0..=9_007_199_254_740_991.0).contains(&request)
    {
        return Err(error("Invalid Client score request"));
    }
    if let Some(bounds) = bounds {
        if ![
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
            bounds.viewport_width,
            bounds.viewport_height,
        ]
        .iter()
        .all(|value| value.is_finite())
            || bounds.x < 0.0
            || bounds.y < 0.0
            || bounds.width <= 0.0
            || bounds.height <= 0.0
            || bounds.viewport_width <= 0.0
            || bounds.viewport_height <= 0.0
            || bounds.x + bounds.width > bounds.viewport_width + 1.0
            || bounds.y + bounds.height > bounds.viewport_height + 1.0
            || bounds.sidebar.is_some_and(|sidebar| {
                !sidebar.valid(bounds.viewport_width, bounds.viewport_height)
            })
            || bounds
                .toast
                .is_some_and(|toast| !toast.valid(bounds.viewport_width, bounds.viewport_height))
        {
            return Err(error("Invalid Client score bounds"));
        }
    }
    if !app.state::<ClientScoreView>().admit(&target, request) {
        return Ok(());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let main = app.clone();
    let queued = target.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(sync_on_main(&main, &queued, request, bounds).map_err(error));
    })
    .map_err(error)?;
    match tokio::time::timeout(std::time::Duration::from_secs(8), rx).await {
        Ok(reply) => reply.map_err(error)?,
        Err(cause) => {
            if app.state::<ClientScoreView>().current(&target, request) {
                *app.state::<ClientScoreView>().requests.lock().unwrap() = None;
            }
            Err(error(cause))
        }
    }
}

fn sync_on_main<R: Runtime>(
    app: &AppHandle<R>,
    target: &ClientPageTarget,
    request: f64,
    bounds: Option<ClientScoreBounds>,
) -> Result<(), String> {
    if !matches_target(app, target) || !app.state::<ClientScoreView>().current(target, request) {
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = bounds;
        return Err("Client score storage requires the supported macOS host".into());
    }
    #[cfg(target_os = "macos")]
    {
        let state = app.state::<ClientScoreView>();
        let owner_matches = state.view.lock().unwrap().as_ref().is_some_and(|owner| {
            owner.epoch == target.epoch && owner.url == target.page_url && !owner.closing
        });
        if (!owner_matches && native::has_resource()) || native::pending_flush() {
            close_on_main(app)?;
            if !matches_target(app, target) || !state.current(target, request) {
                return Ok(());
            }
        }
        let Some(bounds) = bounds else {
            if owner_matches {
                native::hide(app)?;
                if let Some(owner) = state.view.lock().unwrap().as_mut() {
                    owner.visible = false;
                    owner.sidebar_focus_requested = false;
                }
            }
            return Ok(());
        };
        let created = !native::exists();
        if created {
            native::create(app, target, bounds)?;
            if !matches_target(app, target) || !state.current(target, request) {
                close_on_main(app)?;
                return Ok(());
            }
            *state.view.lock().unwrap() = Some(ViewOwner {
                epoch: target.epoch,
                url: target.page_url.clone(),
                visible: false,
                presented: false,
                sidebar_focus_requested: false,
                closing: false,
            });
            if let Err(cause) = crate::client_score_input::install(app) {
                let _ = close_on_main(app);
                return Err(cause);
            }
        }
        let visible = native::show(bounds)?;
        let focus_requested = bounds.sidebar.is_some_and(|sidebar| sidebar.focus_app);
        let (first_presentation, yield_to_sidebar) = {
            let mut owner = state.view.lock().unwrap();
            let owner = owner.as_mut().ok_or("Client score view disappeared")?;
            let first_presentation = visible && !owner.presented && bounds.sidebar.is_none();
            let yield_to_sidebar = focus_requested && !owner.sidebar_focus_requested;
            owner.visible = visible;
            owner.presented |= visible;
            owner.sidebar_focus_requested = focus_requested;
            (first_presentation, yield_to_sidebar)
        };
        if !visible {
            native::hide(app)?;
        } else if yield_to_sidebar {
            native::yield_focus(app)?;
        } else if first_presentation {
            native::focus()?;
        }
        Ok(())
    }
}

/// Used by the native coordinator before releasing any forwarding resource.
/// Main-thread callers keep WebKit's completion work moving under one deadline.
pub fn close<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let Some(state) = app.try_state::<ClientScoreView>() else {
        return Ok(());
    };
    *state.requests.lock().unwrap() = None;
    #[cfg(target_os = "macos")]
    if objc2_foundation::MainThreadMarker::new().is_some() {
        return close_on_main(app);
    }
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let main = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(close_on_main(&main));
    })
    .map_err(|cause| cause.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|cause| cause.to_string())?
}

fn close_on_main<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let state = app.state::<ClientScoreView>();
    #[cfg(target_os = "macos")]
    if native::has_resource() {
        state
            .closing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Client score cleanup is already pending")?;
        let _closing = CloseGuard(&state.closing);
        {
            let mut owner = state.view.lock().unwrap();
            if owner.as_ref().is_some_and(|owner| owner.closing) {
                return Err("Client score cleanup is already pending".into());
            }
            if let Some(owner) = owner.as_mut() {
                owner.closing = true;
                owner.visible = false;
            }
        }
        crate::client_score_input::teardown(app);
        if let Err(cause) = native::retire_and_flush(app) {
            if let Some(owner) = state.view.lock().unwrap().as_mut() {
                owner.closing = false;
            }
            return Err(cause);
        }
    }
    *state.view.lock().unwrap() = None;
    crate::client_score_input::teardown(app);
    Ok(())
}

#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
pub(crate) async fn fixture_evaluate(
    app: AppHandle,
    staged: bool,
    script: &str,
) -> Result<serde_json::Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let script = script.to_owned();
    app.run_on_main_thread(move || native::fixture_evaluate(staged, script, tx))
        .map_err(|error| error.to_string())?;
    let result = tokio::time::timeout(std::time::Duration::from_secs(3), rx)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())??;
    serde_json::from_str(&result).map_err(|error| error.to_string())
}
#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
pub(crate) async fn fixture_key(app: AppHandle) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(native::fixture_key(true, "x", 7));
    })
    .map_err(|error| error.to_string())?;
    rx.await.map_err(|error| error.to_string())?
}

#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
pub(crate) async fn fixture_focus(app: AppHandle) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(native::fixture_key(false, "x", 7));
    })
    .map_err(|error| error.to_string())?;
    rx.await.map_err(|error| error.to_string())?
}

#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
pub(crate) async fn fixture_click(app: AppHandle, horizontal: f64) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(native::fixture_click(horizontal));
    })
    .map_err(|error| error.to_string())?;
    rx.await.map_err(|error| error.to_string())?
}

#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
pub(crate) async fn fixture_open_file_panel(app: AppHandle) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(native::fixture_key(true, "o", 31));
    })
    .map_err(|error| error.to_string())?;
    rx.await.map_err(|error| error.to_string())?
}
#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
pub(crate) async fn fixture_file_panel(app: AppHandle, cancel: bool) -> Result<bool, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let main = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| {
            let window = main.get_webview_window("main").ok_or("main window missing")?;
            let native = window.ns_window().map_err(|error| error.to_string())?;
            let window = unsafe { &*native.cast::<objc2_app_kit::NSWindow>() };
            let Some(panel) = window.attachedSheet() else { return Ok(false); };
            if cancel { unsafe { let _: () = objc2::msg_send![&*panel, cancel: std::ptr::null::<objc2::runtime::AnyObject>()]; } }
            Ok(true)
        })();
        let _ = tx.send(result);
    }).map_err(|error| error.to_string())?;
    rx.await.map_err(|error| error.to_string())?
}

/// Prepare a real, hidden first-party document. Navigation completion is not a
/// readiness signal: the project must report its required resources usable.
pub(crate) async fn prepare<R: Runtime>(
    app: AppHandle<R>,
    target: ClientPageTarget,
) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, target);
        Err("Native preparation requires macOS".into())
    }
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let main = app.clone();
        let queued = target.clone();
        app.run_on_main_thread(move || {
            let result = if main.state::<ClientCoordinator>().entry_matches(&queued) {
                native::stage(&main, &queued)
            } else {
                Err("Candidate preparation was cancelled".into())
            };
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;
        tokio::time::timeout(std::time::Duration::from_secs(8), rx)
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())??;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        loop {
            if !app.state::<ClientCoordinator>().entry_matches(&target) {
                return Err("Candidate preparation was cancelled".into());
            }
            let (tx, rx) = tokio::sync::oneshot::channel();
            let main = app.clone();
            let queued = target.clone();
            app.run_on_main_thread(move || native::prepared(&main, &queued, tx))
                .map_err(|error| error.to_string())?;
            if tokio::time::timeout(std::time::Duration::from_secs(2), rx)
                .await
                .map_err(|error| error.to_string())?
                .map_err(|error| error.to_string())??
            {
                return Ok(());
            }
            if std::time::Instant::now() >= deadline {
                return Err("participation.errors.preparationFailed".into());
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    }
}
fn transition_on_main<R: Runtime>(
    app: AppHandle<R>,
    target: ClientPageTarget,
    commit: bool,
) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, target, commit);
        Err("Native preparation requires macOS".into())
    }
    #[cfg(target_os = "macos")]
    {
        if objc2_foundation::MainThreadMarker::new().is_some() {
            return transition_native(&app, &target, commit);
        }
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let main = app.clone();
        app.run_on_main_thread(move || {
            let outcome = transition_native(&main, &target, commit);
            let _ = tx.send(outcome);
        })
        .map_err(|error| error.to_string())?;
        rx.recv_timeout(std::time::Duration::from_secs(8))
            .map_err(|error| error.to_string())?
    }
}
#[cfg(target_os = "macos")]
fn transition_native<R: Runtime>(
    app: &AppHandle<R>,
    target: &ClientPageTarget,
    commit: bool,
) -> Result<(), String> {
    if !commit {
        return native::discard(app, target);
    }
    if !app.state::<ClientCoordinator>().entry_matches(target) {
        return Err("Candidate preparation was cancelled".into());
    }
    close_on_main(app)?;
    native::activate(target)?;
    *app.state::<ClientScoreView>().view.lock().unwrap() = Some(ViewOwner {
        epoch: target.epoch,
        url: target.page_url.clone(),
        visible: false,
        presented: false,
        sidebar_focus_requested: false,
        closing: false,
    });
    crate::client_score_input::install(app)?;
    Ok(())
}
pub(crate) fn commit<R: Runtime>(
    app: AppHandle<R>,
    target: ClientPageTarget,
) -> Result<(), String> {
    transition_on_main(app, target, true)
}
pub(crate) fn cancel<R: Runtime>(
    app: AppHandle<R>,
    target: ClientPageTarget,
) -> Result<(), String> {
    transition_on_main(app, target, false)
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use crate::project_media_view::compositor;
    use block2::{DynBlock, RcBlock};
    use objc2::{
        msg_send,
        rc::Retained,
        runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel},
        sel,
    };
    use objc2_foundation::{
        MainThreadMarker, NSArray, NSDate, NSDictionary, NSNumber, NSPoint, NSRect, NSRunLoop,
        NSSize, NSString, NSURLRequest, NSURL,
    };
    use objc2_web_kit::WKWebViewConfiguration;
    use sha2::{Digest, Sha256};
    use std::{
        fs,
        os::{
            fd::{AsRawFd, FromRawFd},
            unix::fs::{OpenOptionsExt, PermissionsExt},
        },
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        time::{Duration, Instant},
    };

    use objc2_app_kit::{NSClipView, NSModalResponseOK, NSOpenPanel, NSView, NSWindow};
    use std::cell::RefCell;
    use std::ffi::c_void;

    struct NativeView {
        target: ClientPageTarget,
        gate: NavigationGate,
        view: Retained<AnyObject>,
        delegate: Retained<AnyObject>,
        parent: Retained<NSView>,
        shell: Retained<NSView>,
        shell_z_position: Option<f64>,
        clip: Retained<NSClipView>,
        viewport_width: f64,
    }
    struct OpenPanelOwner {
        view: Retained<AnyObject>,
        panel: Retained<NSOpenPanel>,
    }
    type NavigationGate = Box<dyn Fn(&str) -> bool>;

    #[derive(Clone, Copy)]
    struct ScoreOcclusions {
        sidebar: Option<(NSRect, NSSize)>,
        toast: Option<NSRect>,
    }

    thread_local! {
        static VIEW: RefCell<Option<NativeView>> = const { RefCell::new(None) };
        static STAGED: RefCell<Option<NativeView>> = const { RefCell::new(None) };
        static STAGED_OWNER: RefCell<Option<ClientPageTarget>> = const { RefCell::new(None) };
        static STAGED_STORE: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
        static PENDING_STORE: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
        static OPEN_PANEL: RefCell<Option<OpenPanelOwner>> = const { RefCell::new(None) };
        static SCORE_OCCLUSIONS: RefCell<Option<(usize, ScoreOcclusions)>> = const { RefCell::new(None) };
    }

    unsafe extern "C" fn clip_hit_test(
        view: &AnyObject,
        _cmd: Sel,
        point: NSPoint,
    ) -> *mut AnyObject {
        let excluded = SCORE_OCCLUSIONS.with(|occlusions| {
            occlusions.borrow().is_some_and(|(owner, regions)| {
                owner == view as *const AnyObject as usize
                    && (regions.toast.is_some_and(|toast| contains(toast, point))
                        || regions.sidebar.is_some_and(|(sidebar, radius)| {
                            rounded_contains(sidebar, radius, point)
                        }))
            })
        });
        if excluded {
            return std::ptr::null_mut();
        }
        let Some(parent) = AnyClass::get(c"NSClipView") else {
            return std::ptr::null_mut();
        };
        // SAFETY: the class is a direct NSClipView subclass, and AppKit
        // supplies the point in its superview's coordinates.
        unsafe { msg_send![super(view, parent), hitTest: point] }
    }

    fn score_clip(frame: NSRect) -> Result<Retained<NSClipView>, String> {
        let class = if let Some(class) = AnyClass::get(c"PNDSClientScoreClipView") {
            class
        } else {
            let parent = AnyClass::get(c"NSClipView").ok_or("AppKit clip view unavailable")?;
            let mut builder = ClassBuilder::new(c"PNDSClientScoreClipView", parent)
                .ok_or("Could not create Client score clip view class")?;
            // SAFETY: the function ABI matches NSView's -hitTest:(NSPoint).
            unsafe {
                builder.add_method(
                    sel!(hitTest:),
                    clip_hit_test as unsafe extern "C" fn(_, _, _) -> _,
                );
            }
            builder.register()
        };
        let view: Retained<AnyObject> = unsafe {
            let allocated: objc2::rc::Allocated<AnyObject> = msg_send![class, alloc];
            msg_send![allocated, initWithFrame: frame]
        };
        view.downcast::<NSClipView>()
            .map_err(|_| "Client clip view unavailable".into())
    }

    pub(super) fn exists() -> bool {
        VIEW.with(|view| view.borrow().is_some())
    }
    pub(super) fn pending_flush() -> bool {
        PENDING_STORE.with(|store| store.borrow().is_some())
    }
    pub(super) fn scale() -> f64 {
        VIEW.with(|current| {
            current.borrow().as_ref().map_or(1.0, |current| {
                current.parent.frame().size.width / current.viewport_width
            })
        })
    }
    pub(super) fn has_resource() -> bool {
        exists() || PENDING_STORE.with(|store| store.borrow().is_some())
    }

    unsafe fn allowed(view: &AnyObject, url: &str) -> bool {
        let allows = |current: &RefCell<Option<NativeView>>| {
            current.borrow().as_ref().is_some_and(|current| {
                std::ptr::eq::<AnyObject>(&*current.view, view) && (current.gate)(url)
            })
        };
        VIEW.with(allows) || STAGED.with(allows)
    }
    fn active(view: &AnyObject) -> bool {
        VIEW.with(|current| {
            current
                .borrow()
                .as_ref()
                .is_some_and(|current| std::ptr::eq::<AnyObject>(&*current.view, view))
        })
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
        let permit = url
            .and_then(|url| url.absoluteString())
            .is_some_and(|url| unsafe { allowed(view, &url.to_string()) });
        handler.call((isize::from(permit),));
    }

    unsafe extern "C" fn popup(
        _this: &AnyObject,
        _cmd: Sel,
        _view: &AnyObject,
        _config: &AnyObject,
        _action: &AnyObject,
        _features: &AnyObject,
    ) -> *mut AnyObject {
        std::ptr::null_mut()
    }

    unsafe extern "C" fn media(
        _this: &AnyObject,
        _cmd: Sel,
        view: &AnyObject,
        origin: &AnyObject,
        _frame: &AnyObject,
        _kind: isize,
        handler: &DynBlock<dyn Fn(isize)>,
    ) {
        let scheme: Retained<NSString> = unsafe { msg_send![origin, protocol] };
        let host: Retained<NSString> = unsafe { msg_send![origin, host] };
        let port: isize = unsafe { msg_send![origin, port] };
        let permit =
            active(view) && unsafe { allowed(view, &format!("{scheme}://{host}:{port}/")) };
        // WKPermissionDecisionPrompt preserves a real user permission choice.
        handler.call((if permit { 0 } else { 2 },));
    }

    unsafe extern "C" fn open_panel(
        _this: &AnyObject,
        _cmd: Sel,
        view: &AnyObject,
        parameters: &AnyObject,
        _frame: &AnyObject,
        handler: &DynBlock<dyn Fn(*const NSArray<NSURL>)>,
    ) {
        let Some(mtm) = MainThreadMarker::new() else {
            handler.call((std::ptr::null(),));
            return;
        };
        let current_url: Option<Retained<NSURL>> = unsafe { msg_send![view, URL] };
        let permit = current_url
            .and_then(|url| url.absoluteString())
            .is_some_and(|url| unsafe { allowed(view, &url.to_string()) });
        let window: Option<Retained<NSWindow>> = unsafe { msg_send![view, window] };
        let Some(window) = window.filter(|_| {
            active(view) && permit && OPEN_PANEL.with(|panel| panel.borrow().is_none())
        }) else {
            handler.call((std::ptr::null(),));
            return;
        };
        let panel = NSOpenPanel::openPanel(mtm);
        let multiple: Bool = unsafe { msg_send![parameters, allowsMultipleSelection] };
        let directories: Bool = unsafe { msg_send![parameters, allowsDirectories] };
        panel.setAllowsMultipleSelection(multiple.as_bool());
        panel.setCanChooseDirectories(directories.as_bool());
        panel.setCanChooseFiles(true);
        let completion = handler.copy();
        let keep = panel.clone();
        let callback = RcBlock::new(move |response: isize| {
            let owned = OPEN_PANEL.with(|current| {
                let mut current = current.borrow_mut();
                let owned = current
                    .as_ref()
                    .is_some_and(|owner| std::ptr::eq::<NSOpenPanel>(&*owner.panel, &*keep));
                if owned {
                    current.take();
                }
                owned
            });
            if owned && response == NSModalResponseOK {
                completion.call((Retained::as_ptr(&keep.URLs()),));
            } else {
                completion.call((std::ptr::null(),));
            }
        });
        let owner = unsafe { Retained::retain((view as *const AnyObject).cast_mut()) }
            .expect("WebKit supplies a live file panel owner");
        OPEN_PANEL.with(|current| {
            *current.borrow_mut() = Some(OpenPanelOwner {
                view: owner,
                panel: panel.clone(),
            })
        });
        panel.beginSheetModalForWindow_completionHandler(&window, &callback);
    }

    fn delegate_class() -> Result<&'static AnyClass, String> {
        if let Some(class) = AnyClass::get(c"PNDSClientPageDelegate") {
            return Ok(class);
        }
        let parent = AnyClass::get(c"NSObject").ok_or("NSObject unavailable")?;
        let mut builder = ClassBuilder::new(c"PNDSClientPageDelegate", parent)
            .ok_or("Client page delegate unavailable")?;
        unsafe {
            builder.add_method(
                sel!(webView:decidePolicyForNavigationAction:decisionHandler:),
                policy as unsafe extern "C" fn(_, _, _, _, _),
            );
            builder.add_method(
                sel!(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:),
                popup as unsafe extern "C" fn(_, _, _, _, _, _) -> _,
            );
            builder.add_method(sel!(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:), media as unsafe extern "C" fn(_,_,_,_,_,_,_));
            builder.add_method(
                sel!(webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:),
                open_panel as unsafe extern "C" fn(_, _, _, _, _, _),
            );
        }
        crate::performer::add_client_dialog_callbacks(&mut builder);
        Ok(builder.register())
    }

    fn viewport_rect(
        host: NSRect,
        flipped: bool,
        scale: NSSize,
        region: ClientScoreToastBounds,
    ) -> NSRect {
        let y = region.y * scale.height;
        let height = region.height * scale.height;
        NSRect::new(
            NSPoint::new(
                host.origin.x + region.x * scale.width,
                host.origin.y
                    + if flipped {
                        y
                    } else {
                        host.size.height - y - height
                    },
            ),
            NSSize::new(region.width * scale.width, height),
        )
    }

    fn viewport(parent: &NSView, shell: &NSView, bounds: ClientScoreBounds) -> (NSRect, NSSize) {
        let host = compositor::shell_frame(
            parent,
            shell,
            Some((bounds.viewport_width, bounds.viewport_height)),
        );
        let scale = NSSize::new(
            host.size.width / bounds.viewport_width,
            host.size.height / bounds.viewport_height,
        );
        (host, scale)
    }

    fn score_rect(host: NSRect, flipped: bool, scale: NSSize, bounds: ClientScoreBounds) -> NSRect {
        viewport_rect(
            host,
            flipped,
            scale,
            ClientScoreToastBounds {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
            },
        )
    }

    fn contains(rect: NSRect, point: NSPoint) -> bool {
        point.x >= rect.origin.x
            && point.x < rect.origin.x + rect.size.width
            && point.y >= rect.origin.y
            && point.y < rect.origin.y + rect.size.height
    }

    fn rounded_contains(rect: NSRect, radius: NSSize, point: NSPoint) -> bool {
        if !contains(rect, point) {
            return false;
        }
        let rx = radius.width.min(rect.size.width / 2.0);
        let ry = radius.height.min(rect.size.height / 2.0);
        if rx <= 0.0 || ry <= 0.0 {
            return true;
        }
        let x = point.x - rect.origin.x;
        let y = point.y - rect.origin.y;
        let dx = (x - x.clamp(rx, rect.size.width - rx)) / rx;
        let dy = (y - y.clamp(ry, rect.size.height - ry)) / ry;
        dx * dx + dy * dy <= 1.0
    }

    #[test]
    fn client_score_corner_hit_testing_retains_the_viewport_and_respects_css_scale() {
        let host = NSRect::new(NSPoint::new(4.0, 8.0), NSSize::new(640.0, 960.0));
        let scale = NSSize::new(1.0, 2.0);
        let region = ClientScoreToastBounds {
            x: 12.0,
            y: 12.0,
            width: 244.0,
            height: 400.0,
        };
        let rect = viewport_rect(host, false, scale, region);
        let radius = NSSize::new(16.0, 32.0);
        assert_eq!(
            rect,
            NSRect::new(NSPoint::new(16.0, 144.0), NSSize::new(244.0, 800.0))
        );
        assert!(!rounded_contains(rect, radius, NSPoint::new(17.0, 146.0)));
        assert!(!rounded_contains(rect, radius, NSPoint::new(259.0, 942.0)));
        assert!(!rounded_contains(rect, radius, NSPoint::new(15.0, 544.0)));
        assert!(rounded_contains(rect, radius, NSPoint::new(28.0, 168.0)));
        assert!(rounded_contains(rect, radius, NSPoint::new(16.0, 544.0)));
        assert!(rounded_contains(
            rect,
            NSSize::ZERO,
            NSPoint::new(17.0, 146.0)
        ));
    }

    pub(super) fn dialog_labels<R: Runtime>(
        app: &AppHandle<R>,
    ) -> Result<(String, String), String> {
        let language = crate::commands::preferences::load_preferences_sync(app)?.language;
        let system = objc2_foundation::NSLocale::preferredLanguages()
            .firstObject()
            .map(|language| language.to_string())
            .unwrap_or_else(|| "en".into());
        let language = language
            .as_deref()
            .filter(|language| *language != "system")
            .unwrap_or(&system);
        let source = if language.starts_with("zh") {
            include_str!("../../locales/zh-CN.json")
        } else {
            include_str!("../../locales/en.json")
        };
        let catalog: serde_json::Value =
            serde_json::from_str(source).map_err(|cause| cause.to_string())?;
        let label = |key: &str| {
            catalog[key]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| format!("Missing native dialog copy {key}"))
        };
        Ok((
            label("creation.performers.dialogOK")?,
            label("creation.performers.dialogCancel")?,
        ))
    }

    pub(super) fn create<R: Runtime>(
        app: &AppHandle<R>,
        target: &ClientPageTarget,
        bounds: ClientScoreBounds,
    ) -> Result<(), String> {
        create_page(app, target, bounds, false)
    }
    pub(super) fn stage<R: Runtime>(
        app: &AppHandle<R>,
        target: &ClientPageTarget,
    ) -> Result<(), String> {
        if STAGED_OWNER.with(|view| view.borrow().is_some()) {
            return Err("A candidate document still owns resources".into());
        }
        let window = app
            .get_webview_window("main")
            .ok_or("main window missing")?;
        let size = window.inner_size().map_err(|error| error.to_string())?;
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let width = f64::from(size.width) / scale;
        let height = f64::from(size.height) / scale;
        create_page(
            app,
            target,
            ClientScoreBounds {
                x: 0.0,
                y: 0.0,
                width,
                height,
                viewport_width: width,
                viewport_height: height,
                sidebar: None,
                toast: None,
            },
            true,
        )
    }
    fn create_page<R: Runtime>(
        app: &AppHandle<R>,
        target: &ClientPageTarget,
        bounds: ClientScoreBounds,
        staged: bool,
    ) -> Result<(), String> {
        MainThreadMarker::new().ok_or("Client view requires the main thread")?;
        let main = app
            .get_webview_window("main")
            .ok_or("main window missing")?;
        let native = main.ns_window().map_err(|cause| cause.to_string())?;
        let window = unsafe { &*native.cast::<NSWindow>() };
        let parent = window.contentView().ok_or("main content view missing")?;
        let shell = compositor::shell_view(&parent).ok_or("Client App webview missing")?;
        let webview: &tauri::Webview<R> = main.as_ref();
        webview
            .set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)))
            .map_err(|error| error.to_string())?;
        let configuration = configuration(app, target)?;
        let class = AnyClass::get(c"WKWebView").ok_or("WKWebView unavailable")?;
        if class.instance_method(sel!(_close)).is_none()
            || class.instance_method(sel!(_isClosed)).is_none()
            || class.instance_method(sel!(setPageZoom:)).is_none()
            || class
                .instance_method(sel!(setAllMediaPlaybackSuspended:completionHandler:))
                .is_none()
        {
            return Err("Client document close is unavailable".into());
        }
        let origin = target
            .page_url
            .parse::<tauri::Url>()
            .map_err(|cause| cause.to_string())?
            .origin();
        let expected = target.clone();
        let current = app.clone();
        let gate = move |url: &str| {
            url.parse::<tauri::Url>().is_ok_and(|url| {
                url.origin() == origin
                    && (matches_target(&current, &expected)
                        || current
                            .state::<ClientCoordinator>()
                            .entry_matches(&expected))
            })
        };
        let labels = dialog_labels(app)?;
        let (host, scale) = viewport(&parent, &shell, bounds);
        let frame = score_rect(host, parent.isFlipped(), scale, bounds);
        let clip = score_clip(frame)?;
        clip.setDrawsBackground(false);
        clip.setHidden(true);
        unsafe {
            let allocated: objc2::rc::Allocated<AnyObject> = msg_send![class, alloc];
            let view: Retained<AnyObject> = msg_send![allocated, initWithFrame: NSRect::new(NSPoint::ZERO, frame.size), configuration: &*configuration];
            let _: () = msg_send![&*view, setPageZoom: scale.width];
            let delegate: Retained<AnyObject> = msg_send![delegate_class()?, new];
            crate::performer::set_client_dialog_labels(&delegate, &labels.0, &labels.1);
            let _: () = msg_send![&*view, setNavigationDelegate: &*delegate];
            let _: () = msg_send![&*view, setUIDelegate: &*delegate];
            if staged {
                let done = RcBlock::new(|| {});
                let _: () = msg_send![&*view, setAllMediaPlaybackSuspended: Bool::YES, completionHandler: &*done];
            }
            let document = view
                .downcast_ref::<NSView>()
                .ok_or("Client document is not an AppKit view")?;
            document.setHidden(true);
            clip.setDocumentView(Some(document));
            parent.setWantsLayer(true);
            shell.setWantsLayer(true);
            clip.setWantsLayer(true);
            parent.addSubview(&clip);
            let owned = NativeView {
                target: target.clone(),
                gate: Box::new(gate),
                view: view.clone(),
                delegate,
                parent,
                shell,
                shell_z_position: None,
                clip,
                viewport_width: bounds.viewport_width,
            };
            if staged {
                STAGED_OWNER.with(|owner| *owner.borrow_mut() = Some(target.clone()));
                STAGED.with(|current| *current.borrow_mut() = Some(owned));
            } else {
                VIEW.with(|current| *current.borrow_mut() = Some(owned));
            }
            let url = NSURL::URLWithString(&NSString::from_str(&target.page_url))
                .ok_or("Invalid Client page URL")?;
            let request = NSURLRequest::requestWithURL(&url);
            let _: *mut AnyObject = msg_send![&*view, loadRequest: &*request];
        }
        Ok(())
    }

    pub(super) fn show(bounds: ClientScoreBounds) -> Result<bool, String> {
        let (view, clip, parent, shell, needs_underlay) = VIEW.with(|current| {
            let mut current = current.borrow_mut();
            let current = current.as_mut().ok_or("Client score view disappeared")?;
            current.viewport_width = bounds.viewport_width;
            Ok::<_, String>((
                current.view.clone(),
                current.clip.clone(),
                current.parent.clone(),
                current.shell.clone(),
                current.shell_z_position.is_none(),
            ))
        })?;
        let (host, scale) = viewport(&parent, &shell, bounds);
        let flipped = parent.isFlipped();
        let frame = score_rect(host, flipped, scale, bounds);
        if frame.size.width <= 0.0 || frame.size.height <= 0.0 {
            return Ok(false);
        }
        let document = view
            .downcast_ref::<NSView>()
            .ok_or("Client document is not an AppKit view")?;
        let child = NSRect::new(NSPoint::ZERO, frame.size);
        if document.frame() != child {
            document.setFrame(child);
        }
        if clip.frame() != frame {
            clip.setFrame(frame);
        }
        if needs_underlay {
            let previous = compositor::place_below_shell(&clip, &shell)?;
            VIEW.with(|current| {
                if let Some(current) = current.borrow_mut().as_mut() {
                    current.shell_z_position = Some(previous);
                }
            });
        }
        let sidebar = bounds.sidebar.map(|sidebar| {
            let region = ClientScoreToastBounds {
                x: sidebar.x,
                y: sidebar.y,
                width: sidebar.width,
                height: sidebar.height,
            };
            (
                viewport_rect(host, flipped, scale, region),
                NSSize::new(
                    sidebar.corner_radius * scale.width,
                    sidebar.corner_radius * scale.height,
                ),
            )
        });
        let toast = bounds
            .toast
            .map(|toast| viewport_rect(host, flipped, scale, toast));
        // The HTML sidebar and toast paint above the score. Only their
        // own shapes yield AppKit input, so the document stays full-size.
        SCORE_OCCLUSIONS.with(|occlusions| {
            *occlusions.borrow_mut() = Some((
                Retained::as_ptr(&clip) as usize,
                ScoreOcclusions { sidebar, toast },
            ));
        });
        unsafe {
            let _: () = msg_send![&*view, setPageZoom: scale.width];
        }
        document.setHidden(false);
        clip.setHidden(false);
        Ok(true)
    }

    pub(super) fn focus() -> Result<(), String> {
        VIEW.with(|current| {
            let current = current.borrow();
            let current = current.as_ref().ok_or("Client score view disappeared")?;
            unsafe {
                let window: *mut AnyObject = msg_send![&*current.view, window];
                let _: Bool = msg_send![window, makeFirstResponder: &*current.view];
            }
            Ok(())
        })
    }

    pub(super) fn yield_focus<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
        let view = VIEW.with(|current| {
            current
                .borrow()
                .as_ref()
                .map(|current| current.view.clone())
        });
        if view.as_ref().is_some_and(|view| owns_first_responder(view)) {
            if let Some(main) = app.get_webview_window("main") {
                unsafe {
                    main.with_webview(|platform| {
                        let host = &*platform.inner().cast::<AnyObject>();
                        let window: *mut AnyObject = msg_send![host, window];
                        let _: Bool = msg_send![window, makeFirstResponder: host];
                    })
                    .map_err(|cause| cause.to_string())?;
                }
            }
        }
        Ok(())
    }

    fn owns_first_responder(view: &AnyObject) -> bool {
        unsafe {
            let window: *mut AnyObject = msg_send![view, window];
            let first: *mut AnyObject = msg_send![window, firstResponder];
            std::ptr::eq(first, view)
                || (!first.is_null() && require(&*first, sel!(isDescendantOf:)).is_ok() && {
                    let descendant: Bool = msg_send![first, isDescendantOf: view];
                    descendant.as_bool()
                })
        }
    }

    pub(super) fn hide<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
        let yielded = yield_focus(app);
        let presentation = VIEW.with(|current| {
            current.borrow_mut().as_mut().map(|current| {
                (
                    current.clip.clone(),
                    current.view.clone(),
                    current.shell.clone(),
                    current.shell_z_position.take(),
                )
            })
        });
        if let Some((clip, view, shell, previous)) = presentation {
            if let Some(document) = view.downcast_ref::<NSView>() {
                document.setHidden(true);
            }
            clip.setHidden(true);
            if let Some(previous) = previous {
                compositor::restore_shell(&shell, previous);
            }
            SCORE_OCCLUSIONS.with(|occlusions| {
                let mut occlusions = occlusions.borrow_mut();
                if occlusions.is_some_and(|(owner, _)| owner == Retained::as_ptr(&clip) as usize) {
                    occlusions.take();
                }
            });
        }
        yielded
    }

    type StorageSync = unsafe extern "C" fn(*const c_void, *mut c_void, extern "C" fn(*mut c_void));
    fn storage_sync() -> Result<StorageSync, String> {
        let pointer = unsafe {
            libc::dlsym(
                libc::RTLD_DEFAULT,
                c"WKWebsiteDataStoreSyncLocalStorage".as_ptr(),
            )
        };
        if pointer.is_null() {
            return Err("WebKit localStorage synchronization unavailable".into());
        }
        Ok(unsafe { std::mem::transmute::<*mut c_void, StorageSync>(pointer) })
    }

    struct FlushContext {
        store: Retained<AnyObject>,
        done: Arc<AtomicBool>,
    }
    extern "C" fn local_storage_synced(context: *mut c_void) {
        let context = unsafe { Box::from_raw(context.cast::<FlushContext>()) };
        let done = context.done.clone();
        let completion = RcBlock::new(move || done.store(true, Ordering::Release));
        unsafe {
            let _: () = msg_send![&*context.store, _closeDatabases: &*completion];
        }
    }

    pub(super) fn retire_and_flush<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
        let _mtm = MainThreadMarker::new().ok_or("Client close requires the main thread")?;
        hide(app)?;
        if let Some(current) = VIEW.with(|view| view.borrow_mut().take()) {
            unsafe {
                crate::performer::cancel_client_dialogs(&current.delegate);
                let panel = OPEN_PANEL.with(|panel| {
                    let mut panel = panel.borrow_mut();
                    if panel.as_ref().is_some_and(|owner| {
                        std::ptr::eq::<AnyObject>(&*owner.view, &*current.view)
                    }) {
                        panel.take().map(|owner| owner.panel)
                    } else {
                        None
                    }
                });
                if let Some(panel) = panel {
                    let _: () = msg_send![&*panel, cancel: std::ptr::null::<AnyObject>()];
                }
                let configuration: Retained<AnyObject> = msg_send![&*current.view, configuration];
                let store: Retained<AnyObject> = msg_send![&*configuration, websiteDataStore];
                PENDING_STORE.with(|pending| *pending.borrow_mut() = Some(store));
                let _: () = msg_send![&*current.view, stopLoading];
                let _: () = msg_send![&*current.view, _close];
                let closed: Bool = msg_send![&*current.view, _isClosed];
                if !closed.as_bool() {
                    VIEW.with(|view| *view.borrow_mut() = Some(current));
                    return Err("Client document closure was not confirmed".into());
                }
                let _: () = msg_send![&*current.view, removeFromSuperview];
                current.clip.removeFromSuperview();
            }
            // Let the queued WebPage.Close reach the process before its final
            // storage synchronization, matching the native recreation fixture.
            NSRunLoop::mainRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.01));
        }
        let store = PENDING_STORE.with(|store| store.borrow().clone());
        let Some(store) = store else {
            return Ok(());
        };
        flush_store(&store)?;
        PENDING_STORE.with(|pending| {
            pending.borrow_mut().take();
        });
        Ok(())
    }

    pub(super) fn flush_store(store: &AnyObject) -> Result<(), String> {
        unsafe {
            require(store, sel!(_closeDatabases:))?;
        }
        let store = unsafe { Retained::retain((store as *const AnyObject).cast_mut()) }
            .ok_or("Missing WebKit data store")?;
        let sync = storage_sync()?;
        let done = Arc::new(AtomicBool::new(false));
        let context = Box::into_raw(Box::new(FlushContext {
            store: store.clone(),
            done: done.clone(),
        }));
        // The C API accepts Cocoa's WKObject wrapper and unwraps its _apiObject;
        // this exact bridge is covered by the real native storage fixture.
        unsafe {
            sync(
                Retained::as_ptr(&store).cast(),
                context.cast(),
                local_storage_synced,
            );
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while !done.load(Ordering::Acquire) {
            if Instant::now() >= deadline {
                return Err("Client storage flush did not finish before its deadline".into());
            }
            NSRunLoop::mainRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.01));
        }
        Ok(())
    }

    pub(super) fn discard<R: Runtime>(
        app: &AppHandle<R>,
        target: &ClientPageTarget,
    ) -> Result<(), String> {
        let matches = STAGED_OWNER.with(|owner| {
            owner.borrow().as_ref().is_some_and(|owner| {
                owner.epoch == target.epoch && owner.page_url == target.page_url
            })
        });
        if !matches {
            return Ok(());
        }
        let staged = STAGED.with(|view| view.borrow_mut().take());
        let staged_store = STAGED_STORE.with(|store| store.borrow_mut().take());
        let active = VIEW.with(|view| std::mem::replace(&mut *view.borrow_mut(), staged));
        let active_store =
            PENDING_STORE.with(|store| std::mem::replace(&mut *store.borrow_mut(), staged_store));
        let result = retire_and_flush(app);
        let remaining = VIEW.with(|view| view.borrow_mut().take());
        let remaining_store = PENDING_STORE.with(|store| store.borrow_mut().take());
        STAGED.with(|view| *view.borrow_mut() = remaining);
        STAGED_STORE.with(|store| *store.borrow_mut() = remaining_store);
        VIEW.with(|view| *view.borrow_mut() = active);
        PENDING_STORE.with(|store| *store.borrow_mut() = active_store);
        if result.is_ok() {
            STAGED_OWNER.with(|owner| owner.borrow_mut().take());
        }
        result
    }
    pub(super) fn activate(target: &ClientPageTarget) -> Result<(), String> {
        let matches = STAGED.with(|view| {
            view.borrow().as_ref().is_some_and(|view| {
                view.target.epoch == target.epoch && view.target.page_url == target.page_url
            })
        });
        if !matches {
            return Err("Candidate document changed".into());
        }
        let staged = STAGED
            .with(|view| view.borrow_mut().take())
            .ok_or("Candidate document disappeared")?;
        STAGED_OWNER.with(|owner| owner.borrow_mut().take());
        unsafe {
            let done = RcBlock::new(|| {});
            let _: () = msg_send![&*staged.view, setAllMediaPlaybackSuspended: Bool::NO, completionHandler: &*done];
        }
        VIEW.with(|view| *view.borrow_mut() = Some(staged));
        Ok(())
    }
    pub(super) fn prepared<R: Runtime>(
        app: &AppHandle<R>,
        target: &ClientPageTarget,
        reply: tokio::sync::oneshot::Sender<Result<bool, String>>,
    ) {
        let host = app.state::<ClientCoordinator>().entry_host(target);
        let view = STAGED.with(|view| view.borrow().as_ref().map(|view| view.view.clone()));
        let Some((host, view)) = host
            .zip(view)
            .filter(|_| app.state::<ClientCoordinator>().entry_matches(target))
        else {
            let _ = reply.send(Err("Candidate preparation was cancelled".into()));
            return;
        };
        let expected = serde_json::to_string(&host).expect("candidate identities serialize");
        let script = format!("(()=>{{const h={expected},p=globalThis.PNDS_PARTICIPATION?.preparation;const f=globalThis.PNDS_PARTICIPATION?.preparationFailure;const matches=p=>p?.protocolVersion===1&&p.hostId===h.hostId&&p.projectId===h.performance.projectId&&p.performanceId===h.performance.performanceId&&p.resourceScope==='page';return matches(f)?-1:(document.readyState==='complete'&&matches(p)?1:0)}})()");
        let reply = Mutex::new(Some(reply));
        let callback = RcBlock::new(move |value: *mut AnyObject, cause: *mut AnyObject| {
            let result = if !cause.is_null() || value.is_null() {
                Ok(false)
            } else {
                unsafe {
                    let prepared: isize = msg_send![value, integerValue];
                    if prepared < 0 {
                        Err("participation.errors.preparationFailed".into())
                    } else {
                        Ok(prepared == 1)
                    }
                }
            };
            if let Some(reply) = reply.lock().unwrap().take() {
                let _ = reply.send(result);
            }
        });
        unsafe {
            let _: () = msg_send![&*view, evaluateJavaScript: &*NSString::from_str(&script), completionHandler: &*callback];
        }
    }

    #[cfg(feature = "native-client-fixture")]
    pub(super) fn fixture_evaluate(
        staged: bool,
        script: String,
        tx: tokio::sync::oneshot::Sender<Result<String, String>>,
    ) {
        let view = if staged {
            STAGED.with(|view| view.borrow().as_ref().map(|view| view.view.clone()))
        } else {
            VIEW.with(|view| view.borrow().as_ref().map(|view| view.view.clone()))
        };
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
            let alpha: f64 = msg_send![window, alphaValue];
            let frame: NSRect = msg_send![&*view, frame];
            let visible_rect: NSRect = msg_send![&*view, visibleRect];
            let application: Retained<AnyObject> =
                msg_send![AnyClass::get(c"NSApplication").unwrap(), sharedApplication];
            let active: Bool = msg_send![&*application, isActive];
            let document = view.downcast_ref::<NSView>().unwrap();
            let clip = document.superview().unwrap();
            let parent = clip.superview().unwrap();
            let size = parent.bounds().size;
            let hits_score = |x, y| {
                let point =
                    parent.convertPoint_toView(NSPoint::new(x, y), parent.superview().as_deref());
                parent
                    .hitTest(point)
                    .is_some_and(|target| target.isDescendantOf(document))
            };
            let sidebar = SCORE_OCCLUSIONS.with(|regions| {
                regions.borrow().and_then(|(owner, regions)| {
                    (owner == Retained::as_ptr(&clip) as usize)
                        .then_some(regions.sidebar)
                        .flatten()
                })
            });
            let sidebar_hits = sidebar.map(|(rect, radius)| {
                let x = rect.origin.x;
                let y = rect.origin.y;
                [
                    hits_score(x + radius.width, y + radius.height),
                    hits_score(x + radius.width / 16.0, y + radius.height / 16.0),
                    hits_score(x + rect.size.width / 2.0, y - radius.height / 4.0),
                ]
            });
            let shell_above_score = compositor::shell_view(&parent).is_some_and(|shell| {
                let shell_layer: Option<Retained<AnyObject>> = msg_send![&*shell, layer];
                let score_layer: Option<Retained<AnyObject>> = msg_send![&*clip, layer];
                shell_layer.zip(score_layer).is_some_and(|(shell, score)| {
                    let shell_z: f64 = msg_send![&*shell, zPosition];
                    let score_z: f64 = msg_send![&*score, zPosition];
                    shell_z > score_z
                })
            });
            serde_json::json!({
                "viewHidden":hidden.as_bool(),
                "windowVisible":visible.as_bool(),
                "keyWindow":key.as_bool(),
                "appActive":active.as_bool(),
                "windowOcclusion":occlusion,
                "alpha":alpha,
                "frame":[frame.origin.x,frame.origin.y,frame.size.width,frame.size.height],
                "visibleRect":[visible_rect.origin.x,visible_rect.origin.y,visible_rect.size.width,visible_rect.size.height],
                "leftHitsScore":hits_score(size.width * 0.25, size.height * 0.5),
                "rightHitsScore":hits_score(size.width * 0.75, size.height * 0.5),
                "footerHitsScore":hits_score(size.width * 0.5, if parent.isFlipped() { size.height - 10.0 } else { 10.0 }),
                "sidebarInteriorHitsScore":sidebar_hits.map(|hits| hits[0]),
                "sidebarCornerHitsScore":sidebar_hits.map(|hits| hits[1]),
                "sidebarGutterHitsScore":sidebar_hits.map(|hits| hits[2]),
                "shellAboveScore":shell_above_score,
                "scoreHasFocus":owns_first_responder(&view)
            })
        };
        let tx = Mutex::new(Some(tx));
        let callback = RcBlock::new(move |value: *mut AnyObject, cause: *mut AnyObject| {
            let result = if value.is_null() || !cause.is_null() {
                Err("JavaScript probe failed".into())
            } else {
                unsafe {
                    let value = &*value.cast::<NSString>();
                    serde_json::from_str::<serde_json::Value>(&value.to_string())
                        .map(|mut result| {
                            if let Some(object) = result.as_object_mut() {
                                object.insert("nativeVisibility".into(), visibility.clone());
                            }
                            result.to_string()
                        })
                        .map_err(|error| error.to_string())
                }
            };
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(result);
            }
        });
        unsafe {
            let _: () = msg_send![&*view, evaluateJavaScript: &*NSString::from_str(&script), completionHandler: &*callback];
        }
    }
    #[cfg(feature = "native-client-fixture")]
    pub(super) fn fixture_click(horizontal: f64) -> Result<(), String> {
        let parent = VIEW
            .with(|current| {
                current
                    .borrow()
                    .as_ref()
                    .map(|current| current.parent.clone())
            })
            .ok_or("document absent")?;
        let window = parent.window().ok_or("window absent")?;
        let size = parent.bounds().size;
        let point = parent.convertPoint_toView(
            NSPoint::new(size.width * horizontal, size.height * 0.5),
            None,
        );
        unsafe {
            let class = AnyClass::get(c"NSEvent").ok_or("NSEvent unavailable")?;
            let app_class = AnyClass::get(c"NSApplication").ok_or("NSApplication unavailable")?;
            let app: Retained<AnyObject> = msg_send![app_class, sharedApplication];
            for kind in [1usize, 2] {
                let event: Retained<AnyObject> = msg_send![class, mouseEventWithType: kind, location: point, modifierFlags: 0usize, timestamp: 0.0f64, windowNumber: window.windowNumber(), context: std::ptr::null::<AnyObject>(), eventNumber: 0isize, clickCount: 1isize, pressure: 1.0f32];
                let _: () = msg_send![&*app, sendEvent: &*event];
            }
        }
        Ok(())
    }

    #[cfg(feature = "native-client-fixture")]
    pub(super) fn fixture_key(send: bool, characters: &str, key_code: u16) -> Result<(), String> {
        VIEW.with(|view| {
            let view = view.borrow(); let view = view.as_ref().ok_or("document absent")?;
            unsafe {
                let window: *mut AnyObject = msg_send![&*view.view, window];
                let application: Retained<AnyObject> = msg_send![AnyClass::get(c"NSApplication").ok_or("NSApplication unavailable")?, sharedApplication];
                let _: () = msg_send![&*application, activateIgnoringOtherApps: Bool::YES];
                let _: () = msg_send![window, makeKeyAndOrderFront: std::ptr::null::<AnyObject>()];
                let _: () = msg_send![window, orderFrontRegardless];
                if !send { return Ok(()); }
                let number: isize = msg_send![window, windowNumber];
                let class = AnyClass::get(c"NSEvent").ok_or("NSEvent unavailable")?;
                let text = NSString::from_str(characters);
                let event: Retained<AnyObject> = msg_send![class, keyEventWithType: 10usize, location: NSPoint::new(10.0,10.0), modifierFlags: 0usize, timestamp: 0.0f64, windowNumber: number, context: std::ptr::null::<AnyObject>(), characters: &*text, charactersIgnoringModifiers: &*text, isARepeat: Bool::NO, keyCode: key_code];
                let application: Retained<AnyObject> = msg_send![AnyClass::get(c"NSApplication").ok_or("NSApplication unavailable")?, sharedApplication];
                let _: () = msg_send![&*application, sendEvent: &*event];
            }
            Ok(())
        })
    }

    unsafe fn require(object: &AnyObject, selector: Sel) -> Result<(), String> {
        let supported: Bool = unsafe { msg_send![object, respondsToSelector: selector] };
        if supported.as_bool() {
            Ok(())
        } else {
            Err(format!(
                "Required WebKit storage method {selector:?} is unavailable"
            ))
        }
    }

    fn directory(app_data: &Path, origin: &str) -> Result<PathBuf, String> {
        fs::create_dir_all(app_data).map_err(|cause| cause.to_string())?;
        let mut held = fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(app_data)
            .map_err(|cause| cause.to_string())?;
        let key = format!("{:x}", Sha256::digest(origin.as_bytes()));
        for name in ["client-web-data", &key] {
            let name = std::ffi::CString::new(name).map_err(|cause| cause.to_string())?;
            if unsafe { libc::mkdirat(held.as_raw_fd(), name.as_ptr(), 0o700) } != 0
                && std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists
            {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let fd = unsafe {
                libc::openat(
                    held.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if fd < 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            held = unsafe { fs::File::from_raw_fd(fd) };
            if held
                .metadata()
                .map_err(|cause| cause.to_string())?
                .permissions()
                .mode()
                & 0o077
                != 0
            {
                return Err("Invalid Client storage permissions".into());
            }
        }
        Ok(app_data.join("client-web-data").join(key))
    }

    fn storage_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
        #[cfg(feature = "native-client-fixture")]
        if let Some(path) = app
            .state::<ClientScoreView>()
            .fixture_storage
            .lock()
            .unwrap()
            .clone()
        {
            return Ok(path);
        }
        app.path().app_data_dir().map_err(|cause| cause.to_string())
    }

    pub(super) fn configuration<R: Runtime>(
        app: &AppHandle<R>,
        target: &ClientPageTarget,
    ) -> Result<Retained<WKWebViewConfiguration>, String> {
        configuration_at(app, target, None)
    }

    pub(super) fn configuration_at<R: Runtime>(
        app: &AppHandle<R>,
        target: &ClientPageTarget,
        root: Option<&Path>,
    ) -> Result<Retained<WKWebViewConfiguration>, String> {
        let mtm = MainThreadMarker::new().ok_or("Client configuration requires the main thread")?;
        storage_sync()?;
        let url = target
            .page_url
            .parse::<tauri::Url>()
            .map_err(|cause| cause.to_string())?;
        let host = url.host_str().ok_or("Missing Client storage hostname")?;
        if url.scheme() != "http"
            || !host.starts_with("pnds-")
            || !host.ends_with(".localhost")
            || !target.proxy_address.ip().is_loopback()
        {
            return Err("Invalid Client storage target".into());
        }
        let storage = root
            .map(Path::to_path_buf)
            .map(Ok)
            .unwrap_or_else(|| storage_root(app))?;
        let directory = directory(&storage, &url.origin().ascii_serialization())?;
        let class = AnyClass::get(c"_WKWebsiteDataStoreConfiguration")
            .ok_or("Persistent WebKit storage configuration unavailable")?;
        let store_class =
            AnyClass::get(c"WKWebsiteDataStore").ok_or("WebKit data store unavailable")?;
        // These SPI selectors are present in the official macOS13.5 WebKit tag;
        // dynamic checks make a missing implementation a visible failure.
        unsafe {
            let config: Retained<AnyObject> = msg_send![class, new];
            for selector in [
                sel!(_setWebStorageDirectory:),
                sel!(_setIndexedDBDatabaseDirectory:),
                sel!(setGeneralStorageDirectory:),
                sel!(_setCookieStorageFile:),
                sel!(setNetworkCacheDirectory:),
                sel!(_setResourceLoadStatisticsDirectory:),
                sel!(setProxyConfiguration:),
            ] {
                require(&config, selector)?;
            }
            let path = |name: &str| {
                NSURL::fileURLWithPath(&NSString::from_str(&directory.join(name).to_string_lossy()))
            };
            let _: () = msg_send![&*config, _setWebStorageDirectory: &*path("LocalStorage")];
            let _: () = msg_send![&*config, _setIndexedDBDatabaseDirectory: &*path("IndexedDB")];
            let _: () = msg_send![&*config, setGeneralStorageDirectory: &*path("Storage")];
            let _: () = msg_send![&*config, _setCookieStorageFile: &*path("Cookies.binarycookies")];
            let _: () = msg_send![&*config, setNetworkCacheDirectory: &*path("Cache")];
            let _: () =
                msg_send![&*config, _setResourceLoadStatisticsDirectory: &*path("Statistics")];
            let host_literal = serde_json::to_string(host).map_err(|cause| cause.to_string())?;
            let proxy = target.proxy_address;
            let pac = NSString::from_str(&format!("function FindProxyForURL(url,host){{if(host==={host_literal})return 'PROXY {proxy}';return 'DIRECT';}}"));
            let keys = [
                NSString::from_str("ProxyAutoConfigEnable"),
                NSString::from_str("ProxyAutoConfigJavaScript"),
                NSString::from_str("ExceptionsList"),
                NSString::from_str("ExcludeSimpleHostnames"),
            ];
            let yes = NSNumber::numberWithBool(true);
            let no = NSNumber::numberWithBool(false);
            let exceptions = NSArray::<NSString>::new();
            let dictionary = NSDictionary::<NSString, AnyObject>::from_slices(
                &keys.iter().map(|key| &**key).collect::<Vec<_>>(),
                &[&*yes, &*pac, &*exceptions, &*no],
            );
            let _: () = msg_send![&*config, setProxyConfiguration: &*dictionary];
            if store_class
                .instance_method(sel!(_initWithConfiguration:))
                .is_none()
            {
                return Err("Persistent WebKit storage initialization unavailable".into());
            }
            let allocated: objc2::rc::Allocated<AnyObject> = msg_send![store_class, alloc];
            let store: Retained<AnyObject> = msg_send![allocated, _initWithConfiguration: &*config];
            require(&store, sel!(_closeDatabases:))?;
            let configuration = WKWebViewConfiguration::new(mtm);
            let _: () = msg_send![&*configuration, setWebsiteDataStore: &*store];
            Ok(configuration)
        }
    }
}

/// Shared trusted-origin configuration; Client document ownership stays private.
#[cfg(target_os = "macos")]
pub(crate) fn project_configuration<R: Runtime>(
    app: &AppHandle<R>,
    page_url: String,
    proxy_address: std::net::SocketAddr,
    storage_root: Option<&std::path::Path>,
) -> Result<objc2::rc::Retained<objc2_web_kit::WKWebViewConfiguration>, String> {
    native::configuration_at(
        app,
        &ClientPageTarget {
            epoch: 0,
            page_url,
            proxy_address,
        },
        storage_root,
    )
}

#[cfg(target_os = "macos")]
pub(crate) fn project_dialog_labels<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(String, String), String> {
    native::dialog_labels(app)
}

#[cfg(target_os = "macos")]
pub(crate) fn flush_project_store(store: &objc2::runtime::AnyObject) -> Result<(), String> {
    native::flush_store(store)
}
