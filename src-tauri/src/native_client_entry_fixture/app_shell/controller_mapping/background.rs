//! Record the original handler's action before the foreground is restored.
use super::*;
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSBackingStoreType, NSWindowButton,
    NSWindowStyleMask,
};
use objc2_foundation::{MainThreadMarker, NSProcessInfo};
use std::future::Future;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

pub(in super::super) const FOCUS_PEER_ENV: &str = "PNDS_APP_SHELL_FOCUS_PEER";

#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(in super::super) enum Presentation {
    Inactive,
    Hidden,
    Minimized,
    Foreground,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeState {
    app_active: bool,
    app_hidden: bool,
    key_window: bool,
    window_visible: bool,
    window_minimized: bool,
    frontmost_pid: Option<i32>,
    at_ms: u64,
}

impl Presentation {
    fn reached(self, state: &NativeState, peer_pid: Option<i32>) -> bool {
        match self {
            Self::Inactive => {
                !state.app_active
                    && !state.app_hidden
                    && state.window_visible
                    && !state.window_minimized
                    && state.frontmost_pid == peer_pid
            }
            Self::Hidden => state.app_hidden,
            Self::Minimized => !state.app_hidden && state.window_minimized,
            Self::Foreground => {
                state.app_active
                    && !state.app_hidden
                    && state.key_window
                    && state.window_visible
                    && !state.window_minimized
            }
        }
    }
}

async fn native_state(
    app: &AppHandle,
    transition: Option<Presentation>,
    peer_pid: Option<i32>,
) -> NativeState {
    let window = app.get_webview_window("main").unwrap();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || unsafe {
        let application: Retained<AnyObject> =
            msg_send![AnyClass::get(c"NSApplication").unwrap(), sharedApplication];
        let window = window.ns_window().unwrap().cast::<AnyObject>();
        let none = std::ptr::null::<AnyObject>();
        match transition {
            Some(Presentation::Inactive) => {
                let running = AnyClass::get(c"NSRunningApplication").unwrap();
                let peer: Option<Retained<AnyObject>> =
                    msg_send![running, runningApplicationWithProcessIdentifier: peer_pid.unwrap()];
                if let Some(peer) = peer {
                    let ready: Bool = msg_send![&*peer, isFinishedLaunching];
                    if ready.as_bool() {
                        let cooperative: Bool =
                            msg_send![&*application, respondsToSelector: objc2::sel!(yieldActivationToApplication:)];
                        if cooperative.as_bool() {
                            let _: () = msg_send![&*application, yieldActivationToApplication: &*peer];
                            let current: Retained<AnyObject> = msg_send![running, currentApplication];
                            let _: Bool = msg_send![&*peer, activateFromApplication: &*current, options: 0_usize];
                        } else {
                            let _: Bool = msg_send![&*peer, activateWithOptions: 2_usize];
                        }
                    }
                }
            }
            Some(Presentation::Hidden) => {
                let _: () = msg_send![&*application, hide: none];
            }
            Some(Presentation::Minimized) => {
                click_minimize_button(&application, &*window.cast::<NSWindow>());
            }
            Some(Presentation::Foreground) => {
                let hidden: Bool = msg_send![&*application, isHidden];
                if hidden.as_bool() {
                    let _: () = msg_send![&*application, unhide: none];
                }
                let minimized: Bool = msg_send![window, isMiniaturized];
                if minimized.as_bool() {
                    let _: () = msg_send![window, deminiaturize: window];
                }
                let _: () = msg_send![&*application, activateIgnoringOtherApps: Bool::YES];
                let _: () = msg_send![window, makeKeyAndOrderFront: none];
                let _: () = msg_send![window, orderFrontRegardless];
            }
            None => {}
        }
        let workspace: Retained<AnyObject> =
            msg_send![AnyClass::get(c"NSWorkspace").unwrap(), sharedWorkspace];
        let frontmost: Option<Retained<AnyObject>> = msg_send![&*workspace, frontmostApplication];
        let frontmost_pid = frontmost.map(|frontmost| msg_send![&*frontmost, processIdentifier]);
        let app_active: Bool = msg_send![&*application, isActive];
        let app_hidden: Bool = msg_send![&*application, isHidden];
        let key_window: Bool = msg_send![window, isKeyWindow];
        let window_visible: Bool = msg_send![window, isVisible];
        let window_minimized: Bool = msg_send![window, isMiniaturized];
        let _ = sender.send(NativeState {
            app_active: app_active.as_bool(),
            app_hidden: app_hidden.as_bool(),
            key_window: key_window.as_bool(),
            window_visible: window_visible.as_bool(),
            window_minimized: window_minimized.as_bool(),
            frontmost_pid,
            at_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis()
                .try_into()
                .unwrap(),
        });
    })
    .unwrap();
    receiver.await.unwrap()
}

fn click_minimize_button(application: &AnyObject, window: &NSWindow) {
    unsafe {
        let button = crate::window::fixture_main_control(window, NSWindowButton::MiniaturizeButton)
            .expect("native minimize button");
        assert!(button.isEnabled() && !button.isHiddenOrHasHiddenAncestor());
        let bounds = button.bounds();
        let point = button.convertPoint_toView(
            NSPoint::new(bounds.size.width / 2.0, bounds.size.height / 2.0),
            None,
        );
        let class = AnyClass::get(c"NSEvent").unwrap();
        for kind in [2_usize, 1_usize] {
            let event: Retained<AnyObject> = msg_send![
                class, mouseEventWithType: kind, location: point,
                modifierFlags: 0_usize, timestamp: NSProcessInfo::processInfo().systemUptime(),
                windowNumber: window.windowNumber(), context: std::ptr::null::<AnyObject>(),
                eventNumber: 1_isize, clickCount: 1_isize, pressure: 1.0_f32
            ];
            // A native button's mouseDown tracks until release. Supply the
            // window's mouseUp before dispatching the corresponding press.
            if kind == 2 {
                let _: () = msg_send![application, postEvent: &*event, atStart: Bool::NO];
            } else {
                let _: () = msg_send![application, sendEvent: &*event];
            }
        }
    }
}

async fn expose_minimize_button(app: &AppHandle) {
    shell(app, "globalThis.fixtureSidebar(true);JSON.stringify(true)").await;
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        let buttons = super::super::controls(app).await;
        if buttons[1]["hidden"] == false && buttons[1]["alpha"].as_f64().unwrap() > 0.9 {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "native minimize button hidden: {buttons}"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn reach(app: &AppHandle, state: Presentation, peer_pid: Option<i32>) -> NativeState {
    let mut sample = native_state(app, Some(state), peer_pid).await;
    let deadline = Instant::now() + Duration::from_secs(4);
    while !state.reached(&sample, peer_pid) {
        assert!(
            Instant::now() < deadline,
            "native window did not reach {state:?}: {sample:?}"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
        let request =
            matches!(state, Presentation::Inactive | Presentation::Foreground).then_some(state);
        sample = native_state(app, request, peer_pid).await;
    }
    sample
}

struct FocusPeer(Child);

impl FocusPeer {
    fn spawn() -> Self {
        Self(
            Command::new(std::env::current_exe().unwrap())
                .env(FOCUS_PEER_ENV, "1")
                .stdin(Stdio::piped())
                .spawn()
                .expect("start the controller fixture's focus peer"),
        )
    }

    fn pid(&self) -> i32 {
        self.0.id().try_into().unwrap()
    }
}

impl Drop for FocusPeer {
    fn drop(&mut self) {
        // Close our pipe even if the probe panicked. The helper exits on EOF.
        self.0.stdin.take();
        let _ = self.0.wait();
    }
}

pub(in super::super) fn run_focus_peer() {
    // The parent owns this pipe's only writer. Do not linger if it exits early.
    std::thread::spawn(|| {
        let _ = std::io::stdin().read(&mut [0]);
        std::process::exit(0);
    });
    let main = MainThreadMarker::new().unwrap();
    let application = NSApplication::sharedApplication(main);
    assert!(application.setActivationPolicy(NSApplicationActivationPolicy::Regular));
    let window = unsafe {
        NSWindow::initWithContentRect_styleMask_backing_defer(
            main.alloc(),
            NSRect::new(NSPoint::new(40.0, 40.0), NSSize::new(320.0, 100.0)),
            NSWindowStyleMask::Titled,
            NSBackingStoreType::Buffered,
            false,
        )
    };
    window.setTitle(&NSString::from_str("PNDS Controller Focus Fixture"));
    window.orderFrontRegardless();
    application.run();
}

/// Execute a device operation between two checks of the same AppKit state.
async fn while_background<T>(
    app: &AppHandle,
    state: Presentation,
    action: impl Future<Output = T>,
) -> (Value, T) {
    let minimizing = matches!(state, Presentation::Minimized);
    if minimizing {
        expose_minimize_button(app).await;
    }
    let peer = matches!(state, Presentation::Inactive).then(FocusPeer::spawn);
    let peer_pid = peer.as_ref().map(FocusPeer::pid);
    let before = reach(app, state, peer_pid).await;
    let result = action.await;
    let after = native_state(app, None, peer_pid).await;
    drop(peer);
    let restored = reach(app, Presentation::Foreground, None).await;
    if minimizing {
        shell(app, "globalThis.fixtureSidebar(false);JSON.stringify(true)").await;
    }
    assert!(
        state.reached(&after, peer_pid),
        "native window left {state:?} during controller input: {before:?} -> {after:?}"
    );
    (
        json!({"state":state,"focusPeerPid":peer_pid,"before":before,"after":after,"restored":restored}),
        result,
    )
}

pub(in super::super) async fn capture_osc(
    app: &AppHandle,
    state: Presentation,
    address: &str,
    port: u16,
) -> (Value, crate::controller_mapping::DeferredOsc) {
    let packet = crate::controller_mapping::hold_next_local_osc(app, address);
    let (interval, captured) = while_background(app, state, async {
        send(address, port);
        tokio::time::timeout(Duration::from_secs(4), packet).await
    })
    .await;
    (
        interval,
        captured
            .expect("Native OSC did not receive the background UDP packet")
            .unwrap(),
    )
}

pub(in super::super) async fn exercise(
    app: &AppHandle,
    role: declared::Role,
    selector: &str,
    address: &str,
    port: u16,
) -> Value {
    let source = format!(
        "JSON.stringify((() => {{
            const target = document.querySelector({selector:?});
            return {{
                timeOrigin: performance.timeOrigin,
                visibility: document.visibilityState,
                actions: Number(target.dataset.actions),
                actionAt: Number(target.dataset.actionAt),
                actionVisibility: target.dataset.actionVisibility,
            }};
        }})())"
    );
    let initial = role.evaluate(app, &source).await;
    let mut expected = initial["actions"].as_u64().unwrap();
    let mut report = Vec::new();
    for state in [
        Presentation::Inactive,
        Presentation::Hidden,
        Presentation::Minimized,
    ] {
        let (mut interval, ()) = while_background(app, state, async {
            send(address, port);
            // No WKWebView probe here. An evaluation can wake the controller's
            // page and lead to a false positive for background delivery.
            tokio::time::sleep(Duration::from_secs(1)).await;
        })
        .await;
        let restored = role.evaluate(app, &source).await;
        expected += 1;
        assert_eq!(restored["timeOrigin"], initial["timeOrigin"], "{interval}");
        assert_eq!(restored["actions"], expected, "{interval} {restored}");
        let action_time = restored["actionAt"].as_u64().unwrap();
        let start = interval["before"]["atMs"].as_u64().unwrap();
        let end = interval["after"]["atMs"].as_u64().unwrap();
        assert!(
            (start..=end).contains(&action_time),
            "project action must run before foreground restoration: {interval} {restored}"
        );
        interval["project"] = restored;
        eprintln!("Controller background action {state:?}: {interval}");
        report.push(interval);
    }
    json!(report)
}
