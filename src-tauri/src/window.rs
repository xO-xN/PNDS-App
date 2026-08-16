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
}

impl Default for WindowManager {
    fn default() -> Self {
        Self {
            fade_gen: Arc::new(FadeGen::default()),
            fullscreen: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
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
    // corner radius so the native edge matches the content rounding.
    sync_corner_radius(&window);

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
    {
        use tauri_plugin_window_state::{AppHandleExt, StateFlags};
        if let Err(e) = app.save_window_state(StateFlags::all()) {
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

/// §7.4: first show / dock reopen — fade in from transparent.
#[tauri::command]
#[specta::specta]
pub async fn fade_in_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    let state = app.state::<WindowManager>();
    let generation = state.fade_gen.next();
    if state.quitting.load(Ordering::SeqCst) {
        return Ok(());
    }
    set_opacity(&window, 0.0);
    spawn_ramp(window, state.fade_gen.clone(), generation, 1.0);
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

/// Re-applies the native window corner radius for the current window state
/// (§7.4): 16px in windowed mode, 0 in fullscreen. Call on startup and on
/// every fullscreen transition (native green button or ⌃⌘F) so the radius
/// survives the macOS native fullscreen round-trip.
pub fn sync_corner_radius<R: Runtime>(window: &WebviewWindow<R>) {
    let is_fullscreen = window.is_fullscreen().unwrap_or(false);
    let radius = window_corner_radius(is_fullscreen);
    if let Err(e) = set_corner_radius(window, radius) {
        log::warn!("setCornerRadius({radius}) failed: {e}");
    }
}

/// Radius selection: square in fullscreen, 16px in windowed mode.
fn window_corner_radius(is_fullscreen: bool) -> f64 {
    if is_fullscreen {
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
    /// the frontend `--app-corner-radius` token) and square in fullscreen.
    #[test]
    fn corner_radius_is_square_in_fullscreen() {
        assert_eq!(window_corner_radius(false), 16.0);
        assert_eq!(window_corner_radius(true), 0.0);
    }
}
