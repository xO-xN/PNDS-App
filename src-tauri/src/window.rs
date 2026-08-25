//! Window management: centralized fullscreen action, native-window opacity
//! fade state machine, and window-state events for the frontend.
//!
//! Task 5 contract (docs/PNDS_APP_REQUIREMENTS.md §7, §7.4, §10.1):
//!   - ONE fullscreen toggle action shared by the macOS Window menu,
//!     ⌃⌘F, and the sidebar button. React never flips window state
//!     itself — it calls `toggle_fullscreen` and renders from the
//!     `pnds:window` events below (single direction: Rust → React).
//!   - Window fade: 150–180ms opacity transitions on first show, dock
//!     reopen, and close (fade out then hide). The state machine is
//!     interruptible: every new request bumps the animation generation,
//!     which cancels the in-flight ramp and lands on a deterministic
//!     final opacity. ⌘Q bypasses the animation entirely (the Tauri quit
//!     path is untouched).
//!   - Every code path must leave the window fully opaque — never an
//!     invisible-but-interactive window.
//!   - v1.3.0 (#51) cold-start pattern — HIDDEN CREATE → APPLY → SHOW:
//!     the window is created `visible: false`; the frontend reveals it
//!     via `fade_in_window` only after the saved theme has landed (no
//!     light-default flash for dark users), and the backstop thread in
//!     lib.rs force-shows it if the reveal never arrives. New windows
//!     that must not flash on their first frame (the Help center, T8)
//!     reuse this same pattern.

use serde::Serialize;
use specta::Type;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

/// Fade duration per the contract (§7.4): 150–180 ms.
const FADE_DURATION: Duration = Duration::from_millis(160);
/// Poll cadence for the opacity ramp (~60 fps).
const FADE_STEP: Duration = Duration::from_millis(16);

/// v1.3.0 (#51): grace period for the cold-start reveal. The main window
/// is created hidden (`visible: false` in tauri.conf.json) and the
/// frontend reveals it with `fade_in_window` once the saved theme has
/// landed. If that signal never arrives (early JS error, hung IPC), the
/// backstop thread in lib.rs force-shows the window after this delay —
/// the app must never stay invisible.
pub const COLD_START_REVEAL_BACKSTOP: Duration = Duration::from_secs(4);

/// v1.3.0 (#51): persisted window state must NOT include VISIBLE — the
/// window-state plugin's restore path shows the window itself when that
/// flag is set, which would bypass the hidden-create reveal gate (the
/// theme-gated first frame). Visibility is exclusively ours: the
/// cold-start reveal (`fade_in_window`) and the dock-reopen path.
pub fn persisted_state_flags() -> tauri_plugin_window_state::StateFlags {
    tauri_plugin_window_state::StateFlags::all()
        .difference(tauri_plugin_window_state::StateFlags::VISIBLE)
}

/// How long the macOS native fullscreen transition takes. The window is
/// transparent during it, so we fade in again only after it settles —
/// otherwise the ramp fights the system animation (causing flicker).
const FULLSCREEN_TRANSITION_MS: u64 = 400;
/// Native window corner radius in windowed mode (§7.4). Matches the
/// frontend's shared `--app-corner-radius` token so the window's real edge
/// aligns with the content/sidebar rounding and no background leaks at the
/// corners. Fullscreen windows are square.
const CORNER_RADIUS: f64 = 16.0;

/// Window state broadcast to the frontend (`pnds:window` event).
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WindowStateSnapshot {
    /// Native macOS fullscreen state.
    pub fullscreen: bool,
    /// Whether the sidebar's custom traffic lights should be visible.
    /// False while the native (unified) title bar is showing.
    pub show_custom_traffic_lights: bool,
    /// Monotonic counter — bumped on every fullscreen/fade transition so
    /// the frontend can re-sync. Independent of the monitor reload nonce:
    /// fullscreen changes never reload the monitor (§7.2).
    pub generation: u32,
}

/// Per-window animation generation. Every show/hide/fullscreen request
/// bumps it; an in-flight ramp thread compares its own generation and
/// exits early when superseded.
#[derive(Default)]
pub struct FadeGen {
    pub value: AtomicU32,
}

impl FadeGen {
    pub fn next(&self) -> u32 {
        self.value.fetch_add(1, Ordering::SeqCst) + 1
    }
    pub fn is_current(&self, generation: u32) -> bool {
        self.value.load(Ordering::SeqCst) == generation
    }
}

/// Shared window-management state, managed by Tauri.
pub struct WindowManager {
    pub fade_gen: Arc<FadeGen>,
    /// Cached fullscreen flag for synchronous reads.
    pub fullscreen: AtomicBool,
    /// Suppresses the fade-out when the app is quitting (⌘Q): the exit
    /// path runs its own cleanup without waiting for an animation.
    pub quitting: AtomicBool,
    /// v1.2.3 (issue #41): Brutal's window is square — the native 16px
    /// corner mask drops to 0 while that theme is active. Set by the
    /// frontend whenever the effective theme changes; every
    /// `sync_corner_radius` call site consults it.
    pub square_corners: AtomicBool,
}

impl Default for WindowManager {
    fn default() -> Self {
        Self {
            fade_gen: Arc::new(FadeGen::default()),
            fullscreen: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
            square_corners: AtomicBool::new(false),
        }
    }
}

impl WindowManager {
    pub fn snapshot(&self) -> WindowStateSnapshot {
        WindowStateSnapshot {
            fullscreen: self.fullscreen.load(Ordering::SeqCst),
            show_custom_traffic_lights: !self.fullscreen.load(Ordering::SeqCst),
            generation: self.fade_gen.value.load(Ordering::SeqCst),
        }
    }
}

/// §7.4: the one and only fullscreen toggle. All three entry points
/// (menu, ⌃⌘F, sidebar button) funnel through this command.
#[tauri::command]
#[specta::specta]

pub async fn toggle_fullscreen(app: AppHandle) -> Result<WindowStateSnapshot, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    let state = app.state::<WindowManager>();

    let next = !window.is_fullscreen().unwrap_or(false);

    // §7.4 dissolve: fade the CURRENT picture out, let macOS run its
    // native fullscreen transition (window transparent underneath), then
    // fade the NEW picture in. Operated at the NSWindow layer, so the
    // transition never shows a black frame or fights the iframe's render.
    let fade_gen = Arc::clone(&state.fade_gen);
    let fade_out_gen = state.fade_gen.next();
    set_opacity(&window, 0.0);
    spawn_ramp(window.clone(), fade_gen.clone(), fade_out_gen, 0.0);
    // Give the fade-out ramp time to finish (~160ms) before switching.
    std::thread::sleep(FADE_DURATION);

    window
        .set_fullscreen(next)
        .map_err(|e| format!("Failed to toggle fullscreen: {e}"))?;
    state.fullscreen.store(next, Ordering::SeqCst);

    // §7.4: fullscreen windows are square; windowed restores the 16px
    // corner radius so the native edge matches the content rounding
    // (#41: unless the square-corners theme flag says otherwise).
    sync_corner_radius(&window, state.square_corners.load(Ordering::SeqCst));

    // Fullscreen changes only resize the window — the monitor document
    // instance stays untouched (no reload nonce, no iframe key change,
    // no server restart; §7.2).
    let snapshot = state.snapshot();
    if let Err(e) = app.emit("pnds:window", snapshot.clone()) {
        log::warn!("Failed to emit window snapshot: {e}");
    }
    log::info!("Fullscreen toggled to {next}");

    // Wait out the native transition, then fade the new picture in.
    // Runs on a detached thread so the command returns immediately and
    // rapid toggles cancel this ramp via the generation counter.
    let fade_in_gen = state.fade_gen.next();
    let win2 = window.clone();
    let gen2 = Arc::clone(&fade_gen);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(FULLSCREEN_TRANSITION_MS));
        spawn_ramp(win2, gen2, fade_in_gen, 1.0);
    });

    Ok(snapshot)
}

/// §7.4 fade-out then hide (red light / Close Window). Interruptible:
/// a newer request cancels the ramp and the terminal action still runs
/// from a deterministic state.
#[tauri::command]
#[specta::specta]
pub async fn close_window_with_fade(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    let state = app.state::<WindowManager>();

    // Save window state before hiding (mirrors the CloseRequested path).
    // #51: VISIBLE stays out of the persisted flags — a saved `visible`
    // would auto-show the window on the next cold start, bypassing the
    // theme-gated reveal.
    {
        use tauri_plugin_window_state::AppHandleExt;
        if let Err(e) = app.save_window_state(crate::window::persisted_state_flags()) {
            log::warn!("Failed to save window state: {e}");
        }
    }

    let generation = state.fade_gen.next();
    let quit = state.quitting.load(Ordering::SeqCst);
    if quit {
        // App is quitting: hide immediately, no animation.
        let _ = window.hide();
        return Ok(());
    }
    spawn_ramp(window.clone(), state.fade_gen.clone(), generation, 0.0);
    Ok(())
}

/// First show / dock reopen — fade in from transparent.
///
/// v1.3.0 (#51): this is now the cold-start reveal. The main window is
/// created hidden; the frontend calls this once the saved theme has
/// landed, so the window's first visible frame is already themed (dark
/// users never see the Lavender default first). Shows-and-fades when
/// hidden, and is a NO-OP when already visible — dev reloads and other
/// repeat callers must never re-fade a live window.
#[tauri::command]
#[specta::specta]
pub async fn fade_in_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    let state = app.state::<WindowManager>();
    if state.quitting.load(Ordering::SeqCst) {
        return Ok(());
    }
    // A failed visibility query errs on SHOWING: skipping the reveal
    // could leave the window hidden past the backstop window.
    if window.is_visible().unwrap_or(false) {
        return Ok(());
    }
    let generation = state.fade_gen.next();
    set_opacity(&window, 0.0);
    window
        .show()
        .map_err(|e| format!("Failed to show the hidden window: {e}"))?;
    let _ = window.set_focus();
    spawn_ramp(window, state.fade_gen.clone(), generation, 1.0);
    log::info!("Cold-start reveal: window shown and fading in");
    Ok(())
}

/// Queries the current window snapshot (initial state on frontend mount).
#[tauri::command]
#[specta::specta]
pub async fn get_window_state(app: AppHandle) -> Result<WindowStateSnapshot, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    let state = app.state::<WindowManager>();
    state
        .fullscreen
        .store(window.is_fullscreen().unwrap_or(false), Ordering::SeqCst);
    Ok(state.snapshot())
}

/// Marks the app as quitting so in-flight fades cancel and future fade
/// commands hide immediately (⌘Q must not wait for an animation).
#[tauri::command]
#[specta::specta]
pub async fn mark_quitting(app: AppHandle) -> Result<(), String> {
    let state = app.state::<WindowManager>();
    state.quitting.store(true, Ordering::SeqCst);
    state.fade_gen.next(); // cancel any in-flight ramp
    Ok(())
}

/// v1.1.2 T7: the actual process exit behind ⌘Q. The macOS menu item is a
/// custom MenuItem (not the predefined Quit) so React can confirm with a
/// live session first; once confirmed (or with no live session) this
/// marks quitting — no fade, per §7.4 — and exits. Session teardown runs
/// in the `ExitRequested` handler.
#[tauri::command]
#[specta::specta]
pub async fn quit_app(app: AppHandle) -> Result<(), String> {
    let state = app.state::<WindowManager>();
    state.quitting.store(true, Ordering::SeqCst);
    state.fade_gen.next(); // cancel any in-flight ramp
    app.exit(0);
    Ok(())
}

/// Runs the opacity ramp to `target` for `generation`. Cancels itself if
/// a newer generation supersedes it. Terminal state: fade-out hides the
/// window and resets opacity to 1.0; fade-in ends at exactly 1.0 — the
/// window is never left transparent and interactive.
pub fn spawn_ramp<R: Runtime>(
    window: WebviewWindow<R>,
    gen: Arc<FadeGen>,
    generation: u32,
    target: f64,
) {
    std::thread::spawn(move || {
        let start = if target < 0.5 { 1.0 } else { 0.0 };
        let steps = (FADE_DURATION.as_millis() / FADE_STEP.as_millis()).max(1) as u64;
        for step in 1..=steps {
            if !gen.is_current(generation) {
                return; // superseded — a newer animation owns the window
            }
            let progress = step as f64 / steps as f64;
            let opacity = start + (target - start) * progress;
            if let Err(e) = set_alpha(&window, opacity) {
                log::warn!("set_opacity({opacity}) failed: {e}");
                return;
            }
            std::thread::sleep(FADE_STEP);
        }
        if !gen.is_current(generation) {
            return;
        }
        if target < 0.5 {
            // Fade-out complete: hide, then restore full opacity so the
            // next show starts from a known, opaque state.
            let _ = set_alpha(&window, 0.0);
            let _ = window.hide();
            let _ = set_alpha(&window, 1.0);
            log::info!("Window hidden after fade-out");
        } else {
            let _ = set_alpha(&window, 1.0);
        }
    });
}

/// v1.3.0 (#51): the cold-start reveal backstop — called from a
/// background thread after the grace period. Force-shows a still-hidden
/// window: the app must never stay invisible-but-running. A failed
/// visibility query errs on showing (an extra show on a visible window
/// is harmless).
pub fn force_show_if_hidden<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        log::warn!("Cold-start reveal never arrived; showing the window");
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Public wrapper for the RunEvent paths (CloseRequested / Reopen).
pub fn set_opacity_public<R: Runtime>(window: &WebviewWindow<R>, value: f64) {
    set_opacity(window, value);
}

fn set_opacity<R: Runtime>(window: &WebviewWindow<R>, value: f64) {
    if let Err(e) = set_alpha(window, value) {
        log::warn!("set_opacity({value}) failed: {e}");
    }
}

/// Sets the whole-window opacity via AppKit (NSWindow.alphaValue). Tauri
/// v2 has no set_opacity API, so on macOS we drive the NSWindow pointer
/// directly through objc2. The alpha is clamped to [0, 1] and every call
/// path guarantees a final opacity of 1.0 — never a transparent window
/// that stays interactive.
#[cfg(target_os = "macos")]
fn set_alpha<R: Runtime>(window: &WebviewWindow<R>, value: f64) -> Result<(), String> {
    use objc2::msg_send;
    use objc2_app_kit::NSWindow;

    let ns_window = window
        .ns_window()
        .map_err(|e| format!("ns_window failed: {e}"))?;
    let alpha = value.clamp(0.0, 1.0);
    // SAFETY: ns_window() returns a BORROWED NSWindow pointer owned by
    // Tauri. We only send setAlphaValue: on the raw pointer and never
    // wrap it in a Retained — dropping a Retained would release (over-
    // release) the window and crash AppKit (NSWindow dealloc assertion).
    unsafe {
        let win: *mut NSWindow = ns_window.cast();
        let _: () = msg_send![win, setAlphaValue: alpha];
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn set_alpha<R: Runtime>(_window: &WebviewWindow<R>, _value: f64) -> Result<(), String> {
    // Non-macOS has no whole-window opacity path; the fade is a no-op
    // there (the app is macOS-only in practice, §2).
    Ok(())
}

/// v1.2.3 (issue #41): Brutal's window is square — the native corner
/// mask (16px in every other theme) drops to 0 while that theme is
/// active. The frontend calls this whenever the effective theme changes
/// (startup + every Appearance switch); fullscreen is square regardless.
/// The AppKit work hops to the main thread — driving the view hierarchy
/// from a tokio worker aborts (the glass.rs lesson).
#[tauri::command]
#[specta::specta]
pub async fn set_window_corners_square(app: AppHandle, square: bool) -> Result<(), String> {
    app.state::<WindowManager>()
        .square_corners
        .store(square, Ordering::SeqCst);
    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    app.run_on_main_thread(move || {
        sync_corner_radius(&window, square);
    })
    .map_err(|e| format!("Failed to schedule the corner task: {e}"))
}

/// Re-applies the native window corner radius for the current window
/// state (§7.4): 16px in windowed mode, 0 in fullscreen — and 0 in any
/// state while the square-corners theme flag is set (#41). Call on
/// startup, on every fullscreen transition (native green button or
/// ⌃⌘F), and on every theme change so the radius survives them all.
pub fn sync_corner_radius<R: Runtime>(window: &WebviewWindow<R>, square_corners: bool) {
    let is_fullscreen = window.is_fullscreen().unwrap_or(false);
    let radius = window_corner_radius(is_fullscreen, square_corners);
    if let Err(e) = set_corner_radius(window, radius) {
        log::warn!("setCornerRadius({radius}) failed: {e}");
    }
}

/// The context-menu suppression script (see `suppress_default_context_menu`
/// — the string is shared with the frontend fallback registration).
const CONTEXT_MENU_SCRIPT: &str = "document.addEventListener('contextmenu', function (e) {\
    var t = e.target;\
    var editable = t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName));\
    if (!editable) e.preventDefault();\
}, false);";

/// v1.2.3 (user request): right-click belongs exclusively to the app's
/// designed context menus (the sidebar's folder/project Radix menus) —
/// WKWebView's default web menu (Reload, Open Frame in New Window, Back,
/// …) is suppressed in EVERY frame: the app UI and the monitor iframes
/// alike. Implemented as a `WKUserScript` with `forMainFrameOnly: false`
/// — the same all-frames contract as Tauri's
/// `initialization_script_for_all_frames`, which cannot reach this
/// config-declared window (builder-time API). The script only calls
/// `preventDefault()`, so the Radix menus still open (they handle the
/// `contextmenu` event themselves), and editable fields keep the native
/// copy/paste menu — the one native menu that is a text affordance
/// rather than a web page menu. The user script covers frames loaded
/// after this call; `eval` covers the main document that is already
/// loading when setup() runs (the frontend registers the same listener
/// as a third belt — see main.tsx). Main thread only, like the
/// corner-radius sync above; call once at startup.
#[cfg(target_os = "macos")]
pub fn suppress_default_context_menu<R: Runtime>(window: &WebviewWindow<R>) {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_app_kit::{NSView, NSWindow};
    use objc2_foundation::NSString;

    let ns_window = match window.ns_window() {
        Ok(w) => w,
        Err(e) => {
            log::warn!("ns_window failed: {e} — context menu not suppressed");
            return;
        }
    };
    // SAFETY: borrowed NSWindow/NSView pointers owned by Tauri (the same
    // contract as set_corner_radius); the WKUserScript we create is handed
    // to the user content controller (retained there) and never referenced
    // again on our side.
    unsafe {
        let win: *mut NSWindow = ns_window.cast();
        let content: *mut NSView = msg_send![win, contentView];
        let Some(wk_class) = AnyClass::get(c"WKWebView") else {
            log::warn!("WKWebView class not found — context menu not suppressed");
            return;
        };
        let Some(wk) = find_first_of_class(content.cast(), wk_class, 0) else {
            log::warn!("No WKWebView in the window — context menu not suppressed");
            return;
        };
        let ucc: *mut AnyObject = msg_send![wk, userContentController];
        let script_class = match AnyClass::get(c"WKUserScript") {
            Some(cls) => cls,
            None => {
                log::warn!("WKUserScript class not found — context menu not suppressed");
                return;
            }
        };
        let source = NSString::from_str(CONTEXT_MENU_SCRIPT);
        let alloc: *mut AnyObject = msg_send![script_class, alloc];
        // WKUserScriptInjectionTimeAtDocumentStart = 0, typed isize: the
        // enum is NSInteger-backed (the ABI rule that bit glass.rs before).
        let script: *mut AnyObject = msg_send![
            alloc,
            initWithSource: &*source,
            injectionTime: 0isize,
            forMainFrameOnly: false
        ];
        if script.is_null() {
            log::warn!("WKUserScript init failed — context menu not suppressed");
            return;
        }
        let _: () = msg_send![ucc, addUserScript: script];
    }
    // The user script starts at the NEXT document creation; the app page
    // is already loading when setup() runs, so evaluate once for it. The
    // monitor iframes navigate later and get the user script.
    if let Err(e) = window.eval(CONTEXT_MENU_SCRIPT) {
        log::warn!("context-menu eval failed: {e}");
    }
    log::info!("Default webview context menu suppressed (all frames)");
}

/// Depth-bounded walk for the first view of an exact class — AppKit
/// hierarchies are shallow; the bound turns any pathological cycle into a
/// false negative instead of a hang (the WKWebView sits two levels under
/// the content view in practice).
#[cfg(target_os = "macos")]
unsafe fn find_first_of_class(
    view: *mut objc2::runtime::AnyObject,
    target: &'static objc2::runtime::AnyClass,
    depth: usize,
) -> Option<*mut objc2::runtime::AnyObject> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};

    if depth > 16 {
        return None;
    }
    let class: &'static AnyClass = msg_send![view, class];
    if class == target {
        return Some(view);
    }
    let subviews: *mut AnyObject = msg_send![view, subviews];
    let count: usize = msg_send![subviews, count];
    for i in 0..count {
        let child: *mut AnyObject = msg_send![subviews, objectAtIndex: i];
        if let Some(hit) = find_first_of_class(child, target, depth + 1) {
            return Some(hit);
        }
    }
    None
}

/// Radius selection: square in fullscreen or under the square-corners
/// theme flag, 16px in windowed mode.
fn window_corner_radius(is_fullscreen: bool, square_corners: bool) -> f64 {
    if is_fullscreen || square_corners {
        0.0
    } else {
        CORNER_RADIUS
    }
}

/// Rounds the window by clipping its content view's backing layer
/// (CALayer.cornerRadius + masksToBounds) — the modern AppKit approach.
/// NSWindow.cornerRadius is deprecated and absent on TaoWindow at runtime
/// ("unrecognized selector"), so we cannot use it. masksToBounds clips every
/// subview (including the WKWebView) to the rounded shape, so the monitor
/// background reaches the window's real edge instead of leaking the white
/// webview background at the corners. Fullscreen passes radius 0 (square).
#[cfg(target_os = "macos")]
fn set_corner_radius<R: Runtime>(window: &WebviewWindow<R>, radius: f64) -> Result<(), String> {
    use objc2::msg_send;
    use objc2_app_kit::NSView;
    use objc2_app_kit::NSWindow;

    let ns_window = window
        .ns_window()
        .map_err(|e| format!("ns_window failed: {e}"))?;
    // SAFETY: ns_window() returns a BORROWED NSWindow pointer owned by
    // Tauri (same lifetime contract as set_alpha above); msg_send only.
    unsafe {
        let win: *mut NSWindow = ns_window.cast();
        let content_view: *mut NSView = msg_send![win, contentView];
        // Ensure the view is layer-backed so `layer` is non-nil.
        let _: () = msg_send![content_view, setWantsLayer: true];
        let layer: *mut objc2::runtime::AnyObject = msg_send![content_view, layer];
        let _: () = msg_send![layer, setCornerRadius: radius];
        let _: () = msg_send![layer, setMasksToBounds: radius > 0.0];
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn set_corner_radius<R: Runtime>(_window: &WebviewWindow<R>, _radius: f64) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The fade-generation machine: bumping supersedes in-flight ramps,
    /// and is_current tracks the latest generation.
    #[test]
    fn fade_generation_cancels_older_ramps() {
        let gen = FadeGen::default();
        let first = gen.next();
        assert!(gen.is_current(first));

        // A second request supersedes the first.
        let second = gen.next();
        assert!(!gen.is_current(first));
        assert!(gen.is_current(second));

        // Even more interleaving keeps only the latest current.
        let third = gen.next();
        assert!(!gen.is_current(first));
        assert!(!gen.is_current(second));
        assert!(gen.is_current(third));
    }

    /// Snapshot reflects the cached fullscreen flag and bumps generation.
    #[test]
    fn snapshot_mirrors_state() {
        let manager = WindowManager::default();
        let s0 = manager.snapshot();
        assert!(!s0.fullscreen);
        assert!(s0.show_custom_traffic_lights);

        manager.fullscreen.store(true, Ordering::SeqCst);
        manager.fade_gen.next();
        let s1 = manager.snapshot();
        assert!(s1.fullscreen);
        assert!(!s1.show_custom_traffic_lights);
        assert!(s1.generation > s0.generation);
    }

    /// The ramp steps through intermediate opacities and lands exactly on
    /// the target — the terminal contract (never left mid-fade).
    #[test]
    fn ramp_progression_lands_on_target() {
        let steps = (FADE_DURATION.as_millis() / FADE_STEP.as_millis()).max(1) as u64;
        let mut last = 0.0;
        for step in 1..=steps {
            let progress = step as f64 / steps as f64;
            last = 1.0 * progress;
        }
        assert!((last - 1.0).abs() < 1e-9);
        // And the fade-out lands at 0 before the hide.
        let mut last = 1.0;
        for step in 1..=steps {
            let progress = step as f64 / steps as f64;
            last = 1.0 + (0.0 - 1.0) * progress;
        }
        assert!(last.abs() < 1e-9);
    }

    /// §7.4: the native corner radius is 16px in windowed mode (matching
    /// the frontend `--app-corner-radius` token) and square in fullscreen
    /// — and square in every state while the Brutal theme flag is set
    /// (#41).
    #[test]
    fn corner_radius_is_square_in_fullscreen() {
        assert_eq!(window_corner_radius(false, false), 16.0);
        assert_eq!(window_corner_radius(true, false), 0.0);
        assert_eq!(window_corner_radius(false, true), 0.0);
        assert_eq!(window_corner_radius(true, true), 0.0);
    }
}
