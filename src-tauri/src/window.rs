//! Window management: centralized fullscreen action, native-window opacity
//! fade state machine, and window-state events for the frontend.
//!
//! Window contract (docs/developer/app-behavior.md, Window 与全屏):
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

use serde::{Deserialize, Serialize};
use specta::Type;
#[cfg(target_os = "macos")]
use std::sync::atomic::AtomicU64;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalSize, Rect, Runtime, Size, Webview, WebviewWindow,
};
use tauri_specta::Event as _;

/// Fade duration per the contract: 150–180 ms.
const FADE_DURATION: Duration = Duration::from_millis(160);
/// Poll cadence for the opacity ramp (~60 fps).
const FADE_STEP: Duration = Duration::from_millis(16);
/// Preserve the active chrome inset through native resize/layout updates.
#[cfg(target_os = "macos")]
static MAIN_CONTROLS_TOP: AtomicU32 = AtomicU32::new(34);
#[cfg(target_os = "macos")]
static MAIN_CONTROLS_OFFSET: AtomicU64 = AtomicU64::new(0);
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
/// theme-gated first frame). DECORATIONS is also product-owned: old
/// borderless records must not override the native overlay shell.
/// Visibility is exclusively ours: the cold-start reveal (`fade_in_window`) and the dock-reopen path.
pub fn persisted_state_flags() -> tauri_plugin_window_state::StateFlags {
    tauri_plugin_window_state::StateFlags::all().difference(
        tauri_plugin_window_state::StateFlags::VISIBLE
            | tauri_plugin_window_state::StateFlags::DECORATIONS,
    )
}
/// How long the macOS native fullscreen transition takes. The window is
/// transparent during it, so we fade in again only after it settles —
/// otherwise the ramp fights the system animation (causing flicker).
const FULLSCREEN_TRANSITION_MS: u64 = 400;
/// Native window corner radius in windowed mode. Matches the
/// frontend's shared `--app-corner-radius` token so the window's real edge
/// aligns with the content/sidebar rounding and no background leaks at the
/// corners. Fullscreen windows are square.
const CORNER_RADIUS: f64 = 16.0;

/// Window state broadcast to the frontend (WindowStateEvent).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WindowStateSnapshot {
    /// Native macOS fullscreen state.
    pub fullscreen: bool,
    /// Whether the sidebar's custom traffic lights should be visible.
    /// False while the native (unified) title bar is showing.
    pub show_custom_traffic_lights: bool,
    /// Monotonic counter — bumped on every fullscreen/fade transition so
    /// the frontend can re-sync. Independent of the monitor reload nonce:
    /// fullscreen changes never reload the monitor.
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
    /// v1.5.0 polish (Intel / macOS 13 venue-screen report): the
    /// PROJECTION window's cached fullscreen flag — edge-detected from
    /// its Resized events in lib.rs so a fullscreen transition can
    /// schedule the webview-layout jog below (Tauri #14264 workaround).
    /// Kept separate from `fullscreen` (main's own): the projection
    /// window keeps its native titlebar and has no chrome sync.
    pub projection_fullscreen: AtomicBool,
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
            projection_fullscreen: AtomicBool::new(false),
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

/// The one and only fullscreen toggle. All three entry points
/// (menu, ⌃⌘F, sidebar button) funnel through this command.
#[tauri::command]
#[specta::specta]

pub async fn toggle_fullscreen(app: AppHandle) -> Result<WindowStateSnapshot, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    let state = app.state::<WindowManager>();

    let next = !window.is_fullscreen().unwrap_or(false);

    // Re-entering fullscreen: fade the CURRENT picture out, let macOS run its
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

    // fullscreen windows are square; windowed restores the 16px
    // corner radius so the native edge matches the content rounding
    // (#41: unless the square-corners theme flag says otherwise).
    sync_corner_radius(&window, state.square_corners.load(Ordering::SeqCst));

    // Fullscreen changes only resize the window — the monitor document
    // instance stays untouched (no reload nonce, no iframe key change,
    // no server restart).
    let snapshot = state.snapshot();
    if let Err(e) = (crate::events::WindowStateEvent {
        snapshot: snapshot.clone(),
    })
    .emit(&app)
    {
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

/// v1.5.0 polish (Intel / macOS 13 venue-screen report: the projection
/// window showed an unpainted white strip at the bottom after entering
/// fullscreen; the retest showed it still intermittent): Tauri issue
/// #14264 — WKWebView's layout intermittently lags the native
/// fullscreen transition, so the webview stops painting short of the
/// window's bottom edge (the issue's own remedy: "resizing the window
/// again triggers a redraw"). This jog performs exactly that redraw
/// without touching the WINDOW: the webview's bounds grow 2px and snap
/// back — real setFrame passes on the WKWebView that force the
/// relayout the transition lost. The retest shaped it: one early 1px
/// nudge wasn't enough, so it now runs TWO passes with a 150ms hold
/// each (a too-quick restore can land before the lost relayout even
/// sees the growth), and the caller waits a full second after the edge
/// (the strip appears as the transition SETTLES). The extra pixels are
/// clipped by the window, so nothing visible moves.
pub fn jog_webview_layout<R: Runtime>(webview: &Webview<R>) {
    for pass in 0..2 {
        let Ok(bounds) = webview.bounds() else {
            return;
        };
        let grown = match bounds {
            Rect {
                position,
                size: Size::Physical(size),
            } => Rect {
                position,
                size: Size::Physical(PhysicalSize::new(size.width, size.height + 2)),
            },
            Rect {
                position,
                size: Size::Logical(size),
            } => Rect {
                position,
                size: Size::Logical(LogicalSize::new(size.width, size.height + 2.0)),
            },
        };
        if webview.set_bounds(grown).is_err() {
            return;
        }
        std::thread::sleep(Duration::from_millis(150));
        let _ = webview.set_bounds(bounds);
        // Pace the two passes apart; after the last one there is
        // nothing more to wait for.
        if pass == 0 {
            std::thread::sleep(Duration::from_millis(120));
        }
    }
}

/// Fade-out then hide (red light / Close Window). Interruptible:
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

/// v1.3.0 (#56): the generation counter a reveal ramps on — main shares
/// the WindowManager's counter (its fade interrupts must stay coherent),
/// every other label gets a DEDICATED counter: bumping main's shared
/// counter from a secondary window would cancel an in-flight main ramp
/// mid-opacity and strand it half-transparent (the contract: never an
/// invisible-but-interactive window). A fresh counter suffices for a
/// secondary window — the one-shot reveal is the only fade it has, so
/// there is nothing else to supersede.
fn reveal_generation(state: &WindowManager, label: &str) -> Arc<FadeGen> {
    if label == "main" {
        Arc::clone(&state.fade_gen)
    } else {
        Arc::new(FadeGen::default())
    }
}

/// First show / dock reopen — fade in from transparent.
///
/// v1.3.0 (#51): this is now the cold-start reveal. The main window is
/// created hidden; the frontend calls this once the saved theme has
/// landed, so the window's first visible frame is already themed (dark
/// users never see the Lavender default first). Shows-and-fades when
/// hidden, and is a NO-OP when already visible — dev reloads and other
/// repeat callers must never re-fade a live window.
///
/// v1.3.0 (#56): `label` extends the same reveal to secondary windows
/// (the help center), created hidden on the frontend side and revealed
/// by their own page once ready; omitted, it stays the main window's
/// reveal.
///
/// #135 follow-up (venue-screen report): for the projection window the
/// reveal also ACTIVATES the webview — see the webview-level focus
/// below.
#[tauri::command]
#[specta::specta]
pub async fn fade_in_window(app: AppHandle, label: Option<String>) -> Result<(), String> {
    let label = label.unwrap_or_else(|| "main".to_string());
    let window = app
        .get_webview_window(&label)
        .ok_or(format!("{label} window not found"))?;
    if crate::performer::is_performer_label(&label) {
        let handle = app.clone();
        let (tx, rx) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            let result = reveal_performer_if_allowed(&handle, &window, &label).map(|_| ());
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;
        return rx.await.map_err(|error| error.to_string())?;
    }
    reveal_window(&app, &window, &label)
}

/// Runs on the UI thread, so explicit visibility requests cannot interleave
/// with the initial-show decision. Returns whether automatic reveal was allowed.
pub(crate) fn reveal_performer_if_allowed<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    label: &str,
) -> Result<bool, String> {
    if app.get_webview_window(label).is_none()
        || !crate::performer::initial_reveal_allowed(app, label)
    {
        return Ok(false);
    }
    reveal_window(app, window, label)?;
    Ok(true)
}

fn reveal_window<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    label: &str,
) -> Result<(), String> {
    let state = app.state::<WindowManager>();
    if state.quitting.load(Ordering::SeqCst) {
        return Ok(());
    }
    // A failed visibility query errs on SHOWING: skipping the reveal
    // could leave the window hidden past the backstop window.
    if window.is_visible().unwrap_or(false) {
        return Ok(());
    }
    let gen = reveal_generation(&state, label);
    let generation = gen.next();
    set_opacity(window, 0.0);
    window
        .show()
        .map_err(|e| format!("Failed to show the hidden window: {e}"))?;
    let _ = window.set_focus();
    // #135 follow-up (venue-screen report): window focus
    // (makeKeyAndOrderFront) does NOT make the WKWebView the window's
    // first responder — until something does, the webview receives no
    // DOM key events (the §14-leased venue copy's own ⌘= zoom never
    // fires; the App side is a no-op by design) and sits in WebKit's
    // never-activated low-activity state (rAF withheld — ASBS's
    // rAF-only renderer crawls), so the projection was un-zoomable and
    // choppy until the operator clicked it once. The webview-level
    // focus lands the first responder (wry: makeFirstResponder) — the
    // same activation that click performs, durable across later
    // key/resign of the window. Also activate performer test webviews;
    // their page owns input and animation just like projection. The
    // main/help reveals have no reported gap, and main's initial
    // first-responder setup is entangled with its guest-focus gate.
    // (`AsRef<Webview>` — the `Manager::get_webview` lookup needs the
    // unstable feature; this wrapper owns its webview directly.)
    if label == "projection" || crate::performer::is_performer_label(label) {
        let webview: &Webview<_> = window.as_ref();
        let _ = webview.set_focus();
    }
    spawn_ramp(window.clone(), gen, generation, 1.0);
    log::info!("Cold-start reveal: {label} window shown and fading in");
    Ok(())
}

/// v1.3.0 (#56): the focused window's label ("main" when nothing else
/// is focused) — the File > Close Window ⌘W action must act on the
/// FRONT window: with the help center open, ⌘W closes it instead of
/// running the main window's close flow behind it.
#[tauri::command]
#[specta::specta]
pub async fn focused_window_label(app: AppHandle) -> Result<String, String> {
    // A document-modal JavaScript sheet is a separate key NSWindow. Resolve
    // its owning App window before the ordinary focus query, so Cmd+W cannot
    // fall back to closing the main project while a performer prompt is up.
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let handle = app.clone();
        app.run_on_main_thread(move || {
            use objc2_app_kit::NSApplication;
            use objc2_foundation::MainThreadMarker;
            let label = MainThreadMarker::new().and_then(|mtm| {
                let key = NSApplication::sharedApplication(mtm).keyWindow()?;
                let mut parent = key.sheetParent()?;
                while let Some(ancestor) = parent.sheetParent() {
                    parent = ancestor;
                }
                handle
                    .webview_windows()
                    .into_iter()
                    .find_map(|(label, window)| {
                        window
                            .ns_window()
                            .ok()
                            .filter(|pointer| {
                                *pointer == objc2::rc::Retained::as_ptr(&parent).cast_mut().cast()
                            })
                            .map(|_| label)
                    })
            });
            let _ = tx.send(label);
        })
        .map_err(|error| error.to_string())?;
        if let Some(label) = rx.await.map_err(|error| error.to_string())? {
            return Ok(label);
        }
    }
    Ok(app
        .webview_windows()
        .into_iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(label, _)| label)
        .unwrap_or_else(|| "main".to_string()))
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
/// marks quitting — no fade — and exits. Session teardown runs
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
    // there (the app is macOS-only in practice).
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
    let (done, completion) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = done.send(apply_corner_shape(&window, square));
    })
    .map_err(|e| format!("Failed to schedule the corner task: {e}"))?;
    completion
        .await
        .map_err(|e| format!("Window corner task did not finish: {e}"))?
}

/// Establish the native overlay before the first visible frame. Previous
/// window-state records must not restore a borderless shell.
#[cfg(target_os = "macos")]
pub fn configure_main_chrome<R: Runtime>(window: &WebviewWindow<R>) {
    if let Err(error) = window.set_decorations(true) {
        log::warn!("Unable to enable native window decorations: {error}");
    }
    if let Err(error) = window.set_title_bar_style(tauri::TitleBarStyle::Overlay) {
        log::warn!("Unable to apply the overlay titlebar: {error}");
    }
    if let Ok(pointer) = window.ns_window() {
        use objc2_app_kit::{NSWindow, NSWindowStyleMask, NSWindowTitleVisibility};
        // SAFETY: called from AppKit's setup/UI thread, with Tauri-owned views.
        unsafe {
            let native = &*pointer.cast::<NSWindow>();
            native.setStyleMask(
                native.styleMask()
                    | NSWindowStyleMask::Titled
                    | NSWindowStyleMask::Closable
                    | NSWindowStyleMask::Miniaturizable
                    | NSWindowStyleMask::FullSizeContentView,
            );
            native.setTitlebarAppearsTransparent(true);
            native.setTitleVisibility(NSWindowTitleVisibility::Hidden);
        }
    }
}

/// AppKit owns the buttons. Repositioning their titlebar container neither
/// reparents the project page nor changes its navigation/lifecycle.
#[cfg(target_os = "macos")]
unsafe fn position_main_controls(native: &objc2_app_kit::NSWindow, offset: f64) {
    use objc2_app_kit::NSWindowButton;
    let overlay = native.styleMask() | objc2_app_kit::NSWindowStyleMask::FullSizeContentView;
    if native.styleMask() != overlay {
        native.setStyleMask(overlay);
    }
    let Some(close) = square_chrome::button(native, NSWindowButton::CloseButton) else {
        return;
    };
    let Some(mini) = square_chrome::button(native, NSWindowButton::MiniaturizeButton) else {
        return;
    };
    let Some(parent) = square_chrome::container(&close) else {
        return;
    };
    let close_frame = close.frame();
    let spacing = mini.frame().origin.x - close_frame.origin.x;
    let mut frame = parent.frame();
    frame.size.height =
        close_frame.size.height + f64::from(MAIN_CONTROLS_TOP.load(Ordering::Relaxed));
    frame.origin.y = native.frame().size.height - frame.size.height;
    parent.setFrame(frame);
    for (index, kind) in [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ]
    .into_iter()
    .enumerate()
    {
        if let Some(button) = square_chrome::button(native, kind) {
            let mut origin = button.frame().origin;
            origin.x = 28.0 + offset + index as f64 * spacing;
            button.setFrameOrigin(origin);
        }
    }
}

#[cfg(target_os = "macos")]
pub fn sync_main_control_position<R: Runtime>(window: &WebviewWindow<R>) {
    if window.is_fullscreen().unwrap_or(false) {
        return;
    }
    if let Ok(pointer) = window.ns_window() {
        // SAFETY: invoked only on the AppKit event/setup thread.
        unsafe {
            position_main_controls(
                &*pointer.cast::<objc2_app_kit::NSWindow>(),
                f64::from_bits(MAIN_CONTROLS_OFFSET.load(Ordering::Relaxed)),
            );
        }
    }
}

/// The native controls follow the floating sidebar, without changing decorations
/// or rebuilding the WKWebView. Fullscreen keeps the system titlebar controls.
#[tauri::command]
#[specta::specta]
pub async fn set_main_controls_visible(
    app: AppHandle,
    visible: bool,
    offset: f64,
    opacity: f64,
    top: f64,
) -> Result<(), String> {
    if !offset.is_finite() || !opacity.is_finite() || !top.is_finite() {
        return Err("Invalid native control motion".into());
    }
    let offset = offset.clamp(-20.0, 20.0);
    let opacity = opacity.clamp(0.0, 1.0);
    let top = top.clamp(8.0, 34.0).round() as u32;
    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    app.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        if let Ok(pointer) = window.ns_window() {
            use objc2::msg_send;
            use objc2_app_kit::{NSWindow, NSWindowButton};
            // SAFETY: Tauri owns this NSWindow; AppKit access stays on its UI thread.
            unsafe {
                let native = &*pointer.cast::<NSWindow>();
                MAIN_CONTROLS_TOP.store(top, Ordering::Relaxed);
                MAIN_CONTROLS_OFFSET.store(offset.to_bits(), Ordering::Relaxed);
                let fullscreen = window.is_fullscreen().unwrap_or(false);
                let hidden = !visible && !fullscreen;
                for kind in [
                    NSWindowButton::CloseButton,
                    NSWindowButton::MiniaturizeButton,
                    NSWindowButton::ZoomButton,
                ] {
                    if let Some(button) = square_chrome::button(native, kind) {
                        let _: () = msg_send![&*button, setHidden: hidden];
                        let _: () = msg_send![&*button, setAlphaValue: if fullscreen { 1.0 } else { opacity }];
                    }
                }
                // Hiding/showing AppKit buttons may lay out their titlebar;
                // apply the product inset after that native work.
                native
                    .contentView()
                    .inspect(|view| view.layoutSubtreeIfNeeded());
                if !fullscreen {
                    position_main_controls(native, offset);
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (window, visible, offset, opacity, top);
    })
    .map_err(|error| format!("Failed to update native window controls: {error}"))
}

/// Re-applies the native window corner radius for the current window
/// state : 16px in windowed mode, 0 in fullscreen — and 0 in any
/// state while the square-corners theme flag is set (#41). Call on
/// startup, on every fullscreen transition (native green button or
/// ⌃⌘F), and on every theme change so the radius survives them all.
pub fn sync_corner_radius<R: Runtime>(window: &WebviewWindow<R>, square_corners: bool) {
    let target = window.clone();
    if let Err(error) = window.run_on_main_thread(move || {
        if let Err(error) = apply_corner_shape(&target, square_corners) {
            log::warn!("Unable to apply window corner shape: {error}");
        }
    }) {
        log::warn!("Unable to schedule window corner shape: {error}");
    }
}

fn apply_corner_shape<R: Runtime>(
    window: &WebviewWindow<R>,
    square_corners: bool,
) -> Result<(), String> {
    let is_fullscreen = window.is_fullscreen().unwrap_or(false);
    let radius = window_corner_radius(is_fullscreen, square_corners);
    set_corner_radius(window, radius, square_corners && !is_fullscreen)?;
    #[cfg(target_os = "macos")]
    sync_main_control_position(window);
    Ok(())
}

/// The context-menu suppression script (see `suppress_default_context_menu`
/// — the string is shared with the frontend fallback registration).
const CONTEXT_MENU_SCRIPT: &str = "document.addEventListener('contextmenu', function (e) {\
    var t = e.target;\
    var editable = t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName));\
    if (!editable) e.preventDefault();\
}, false);";

/// v1.3.5 (#105): the guest-focus wire message type — the single Rust
/// source of the contract. The TypeScript twin is
/// `GUEST_FOCUS_MESSAGE_TYPE` in src/hooks/use-guest-focus-gate.ts (the
/// gate that listens for the reporter's messages); Rust cannot import
/// TypeScript, so keep the two literals identical — the
/// `guest_focus_script_is_built_from_the_message_type_const` test pins
/// the pairing on this side.
const GUEST_FOCUS_MESSAGE_TYPE: &str = "pnds:guest-focus";

/// v1.3.5 (#105): the guest focus reporter script (see
/// `inject_guest_focus_reporter`), built from
/// [GUEST_FOCUS_MESSAGE_TYPE]. Runs in EVERY frame and reports the
/// page's focus state to the host: `focusin` on anything but body/html
/// posts `interacting: true` (the user is working in the page); focus
/// falling back to the page body, leaving the page, or the page losing
/// the native focus posts `false`. The `false` is settled one macrotask
/// after the `focusout`: engines report `relatedTarget: null` even for
/// same-document element moves (and shadow DOM caps it), so the script
/// re-checks `document.activeElement` / `document.hasFocus()` and lets a
/// following `focusin` win — the gate must never drop mid-interaction.
/// The guest-focus gate (src/hooks/use-guest-focus-gate.ts, driven by
/// MonitorView) gates the keyboard-reclaim machinery on the signal, so
/// page interaction (tnd/template inputs, dropdowns) is never
/// interrupted. Frames only (the main frame's parent is itself, so the
/// app UI stays silent); the payload carries nothing sensitive and the
/// host validates the message source before trusting it.
fn guest_focus_script() -> String {
    format!(
        "(function () {{\
            if (window.parent === window) return;\
            var last = null;\
            function post(interacting) {{\
                if (interacting === last) return;\
                last = interacting;\
                window.parent.postMessage({{ type: '{GUEST_FOCUS_MESSAGE_TYPE}', interacting: interacting }}, '*');\
            }}\
            function container(el) {{\
                return !el || el === document.body || el === document.documentElement || el === document;\
            }}\
            document.addEventListener('focusin', function (e) {{ post(!container(e.target)); }}, true);\
            document.addEventListener('focusout', function (e) {{\
                var next = e.relatedTarget;\
                if (next && !container(next)) return;\
                setTimeout(function () {{\
                    if (!document.hasFocus() || container(document.activeElement)) post(false);\
                }}, 0);\
            }}, true);\
        }})();"
    )
}

/// The injection contract for [guest_focus_script] — document start,
/// every frame — kept as data so the unit test can pin what the objc
/// registration passes.
fn guest_focus_injection() -> (String, isize, bool) {
    (guest_focus_script(), 0, false)
}

/// Adds `source` as a `WKUserScript` on the window's WKWebView (the
/// objc dance shared by the context-menu suppressor and the guest focus
/// reporter). Main thread only; call once per script at startup — the
/// user content controller retains every added script for all later
/// loads.
#[cfg(target_os = "macos")]
fn add_webview_user_script<R: Runtime>(
    window: &WebviewWindow<R>,
    source: &str,
    injection_time: isize,
    main_frame_only: bool,
    what: &str,
) {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_app_kit::{NSView, NSWindow};
    use objc2_foundation::NSString;

    let ns_window = match window.ns_window() {
        Ok(w) => w,
        Err(e) => {
            log::warn!("ns_window failed: {e} — {what} not injected");
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
            log::warn!("WKWebView class not found — {what} not injected");
            return;
        };
        let Some(wk) = find_first_of_class(content.cast(), wk_class, 0) else {
            log::warn!("No WKWebView in the window — {what} not injected");
            return;
        };
        let ucc: *mut AnyObject = msg_send![wk, userContentController];
        let script_class = match AnyClass::get(c"WKUserScript") {
            Some(cls) => cls,
            None => {
                log::warn!("WKUserScript class not found — {what} not injected");
                return;
            }
        };
        let source = NSString::from_str(source);
        let alloc: *mut AnyObject = msg_send![script_class, alloc];
        // WKUserScriptInjectionTimeAtDocumentStart = 0, typed isize: the
        // enum is NSInteger-backed (the ABI rule that bit glass.rs before).
        let script: *mut AnyObject = msg_send![
            alloc,
            initWithSource: &*source,
            injectionTime: injection_time,
            forMainFrameOnly: main_frame_only
        ];
        if script.is_null() {
            log::warn!("WKUserScript init failed — {what} not injected");
            return;
        }
        let _: () = msg_send![ucc, addUserScript: script];
    }
}

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
    add_webview_user_script(
        window,
        CONTEXT_MENU_SCRIPT,
        0,
        false,
        "context menu suppression",
    );
    // The user script starts at the NEXT document creation; the app page
    // is already loading when setup() runs, so evaluate once for it. The
    // monitor iframes navigate later and get the user script.
    if let Err(e) = window.eval(CONTEXT_MENU_SCRIPT) {
        log::warn!("context-menu eval failed: {e}");
    }
    log::info!("Default webview context menu suppressed (all frames)");
}

/// v1.3.5 (#105): inject the guest focus reporter ([guest_focus_script])
/// into every frame. The monitor pages — cross-origin iframes the app
/// cannot script — report their focus state over postMessage, and the
/// guest-focus gate (src/hooks/use-guest-focus-gate.ts, driven by
/// MonitorView) reclaims the keyboard on the signal so page interaction
/// is never interrupted. No eval for the already-loading
/// main document: the script's first line keeps the app frame silent,
/// and the monitor iframes navigate later and get the user script.
/// Main thread only; call once at startup.
#[cfg(target_os = "macos")]
pub fn inject_guest_focus_reporter<R: Runtime>(window: &WebviewWindow<R>) {
    let (source, injection_time, main_frame_only) = guest_focus_injection();
    add_webview_user_script(
        window,
        &source,
        injection_time,
        main_frame_only,
        "guest focus reporter",
    );
    log::info!("Guest focus reporter injected (all frames)");
}

/// Guard installed once per process — a second exchange would swap the
/// implementations back.
#[cfg(target_os = "macos")]
static NATIVE_MENU_GUARD_INSTALLED: AtomicBool = AtomicBool::new(false);
/// Shadow mode: the guard was ADDED under `willOpenMenu:withEvent:`
/// because WKWebView did not implement the hook itself — there is no
/// original to forward to at the end of the guard.
#[cfg(target_os = "macos")]
static NATIVE_MENU_GUARD_SHADOWS: AtomicBool = AtomicBool::new(false);

/// The ⌘←/⌘→ reroute guard (#89) — same once-per-process rule.
#[cfg(target_os = "macos")]
static CMD_ARROW_GUARD_INSTALLED: AtomicBool = AtomicBool::new(false);
/// Shadow mode for the ⌘-arrow guard (see NATIVE_MENU_GUARD_SHADOWS).
#[cfg(target_os = "macos")]
static CMD_ARROW_GUARD_SHADOWS: AtomicBool = AtomicBool::new(false);
/// Stable native identity of the single main shell; compare only, never dereference.
#[cfg(target_os = "macos")]
static MAIN_NATIVE_SELECTION_WINDOW: AtomicUsize = AtomicUsize::new(0);
/// Latest main-shell mode epoch and its native performance key ownership.
static MAIN_NATIVE_SELECTION_OWNER: Mutex<(u32, bool)> = Mutex::new((0, true));

/// v1.3.3 (#79): the NATIVE belt of the context-menu suppression. The
/// three JS layers (main.tsx, help-main.tsx, and the all-frames
/// WKUserScript above) all hinge on `preventDefault()`, which WebKit
/// only honors inconsistently inside WKWebView (WebKit bug 244149) —
/// users still saw the native menu on macOS 26. This guard hooks the
/// last native choke point instead: WKWebView hands the NSMenu it is
/// about to open to `willOpenMenu:withEvent:`, where a menu carrying a
/// text-affordance selector passes through untouched (the contract
/// keeps the native copy/paste menu on editable fields) and every other
/// web menu — Reload, Open Frame in New Window, Back — is emptied
/// before AppKit can present it. Class-level, so it covers every
/// window (main + help) and every frame, cross-origin iframes included.
/// Main thread only, like the rest of this block; call once at startup.
#[cfg(target_os = "macos")]
pub fn install_native_context_menu_guard() {
    use objc2::ffi::{
        class_addMethod, class_getInstanceMethod, method_exchangeImplementations,
        method_getTypeEncoding,
    };
    use objc2::runtime::{AnyClass, Imp};

    if NATIVE_MENU_GUARD_INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }
    // SAFETY: the class-structure mutation runs once per process, at
    // startup before any WKWebView exists — no code can hold a stale
    // method cache across the change.
    unsafe {
        let Some(wk) = AnyClass::get(c"WKWebView") else {
            log::warn!("WKWebView class not found — native menu guard not installed");
            return;
        };
        // The hook's type encoding, taken from NSView (which declares
        // it); WKWebView shares the signature.
        let Some(view) = AnyClass::get(c"NSView") else {
            log::warn!("NSView class not found — native menu guard not installed");
            return;
        };
        let template = class_getInstanceMethod(
            view as *const AnyClass,
            objc2::sel!(willOpenMenu:withEvent:),
        );
        if template.is_null() {
            log::warn!("willOpenMenu:withEvent: not found — native menu guard not installed");
            return;
        }
        let types = method_getTypeEncoding(template);
        if types.is_null() {
            log::warn!(
                "willOpenMenu:withEvent: has no type encoding — native menu guard not installed"
            );
            return;
        }
        let typed: unsafe extern "C-unwind" fn(
            &objc2::runtime::AnyObject,
            objc2::runtime::Sel,
            *mut objc2::runtime::AnyObject,
            *mut objc2::runtime::AnyObject,
        ) = pnds_will_open_menu;
        let imp: Imp = std::mem::transmute::<_, Imp>(typed);
        // Shadow path: WKWebView does not implement the hook itself —
        // adding it shadows NSView's no-op for WKWebView instances ONLY.
        // (Exchanging here instead would have rewritten NSView's method
        // for every view in the process.)
        if class_addMethod(
            wk as *const AnyClass as *mut AnyClass,
            objc2::sel!(willOpenMenu:withEvent:),
            imp,
            types,
        )
        .as_bool()
        {
            NATIVE_MENU_GUARD_SHADOWS.store(true, Ordering::Relaxed);
            log::info!("Native context menu guard installed (shadows NSView's hook)");
            return;
        }
        // Exchange path: WKWebView implements the hook — file the guard
        // under a private selector and swap the two, so the guard runs on
        // the real selector and forwards to the original.
        if !class_addMethod(
            wk as *const AnyClass as *mut AnyClass,
            objc2::sel!(pndsWillOpenMenu:withEvent:),
            imp,
            types,
        )
        .as_bool()
        {
            log::warn!("guard method could not be added — native menu guard not installed");
            return;
        }
        let original =
            class_getInstanceMethod(wk as *const AnyClass, objc2::sel!(willOpenMenu:withEvent:));
        if original.is_null() {
            log::warn!("willOpenMenu:withEvent: vanished — native menu guard not installed");
            return;
        }
        let guard = class_getInstanceMethod(
            wk as *const AnyClass,
            objc2::sel!(pndsWillOpenMenu:withEvent:),
        );
        if guard.is_null() {
            log::warn!("guard method vanished — native menu guard not installed");
            return;
        }
        method_exchangeImplementations(original as *mut _, guard as *mut _);
        log::info!("Native context menu guard installed (exchanged with WKWebView's hook)");
    }
}

/// A native menu counts as a text affordance — and passes the guard —
/// when any item carries the Cut/Copy/Paste selectors: the
/// editable-field and selection menus do, the web-navigation menus
/// (Reload, Open Frame in New Window, Back) do not.
fn actions_include_text_affordance(
    actions: impl IntoIterator<Item = Option<objc2::runtime::Sel>>,
) -> bool {
    actions.into_iter().any(|action| {
        matches!(action, Some(action) if action == objc2::sel!(copy:)
            || action == objc2::sel!(cut:)
            || action == objc2::sel!(paste:))
    })
}

/// The guard's `willOpenMenu:withEvent:` implementation: text-affordance
/// menus pass through untouched, every other web menu is emptied before
/// AppKit can present it. In exchange mode the call forwards to
/// WKWebView's original implementation (which lives under the private
/// selector after the swap); in shadow mode there is nothing beneath us
/// but NSView's no-op, so forwarding would recurse.
#[cfg(target_os = "macos")]
unsafe extern "C-unwind" fn pnds_will_open_menu(
    this: &objc2::runtime::AnyObject,
    _cmd: objc2::runtime::Sel,
    menu: *mut objc2::runtime::AnyObject,
    event: *mut objc2::runtime::AnyObject,
) {
    use objc2::msg_send;
    use objc2_app_kit::NSMenu;

    if !menu.is_null() {
        // SAFETY: the runtime hands this hook a live NSMenu pointer.
        let menu: &NSMenu = unsafe { &*menu.cast() };
        let items = menu.itemArray();
        let text_affordance = (0..items.count()).any(|index| {
            let item = items.objectAtIndex(index);
            actions_include_text_affordance([item.action()])
        });
        if !text_affordance {
            menu.removeAllItems();
        }
    }
    if !NATIVE_MENU_GUARD_SHADOWS.load(Ordering::Relaxed) {
        // SAFETY: same receiver, same menu/event pointers, same signature —
        // the selector resolves to the original implementation post-swap.
        unsafe {
            let _: () = msg_send![this, willOpenMenu: menu, withEvent: event];
        }
    }
}

/// Acknowledge only the main shell's mode-owned performance key boundary.
/// The mode transaction revokes before creation publication and restores after
/// performance publication; old epoch replies cannot reverse newer ownership.
#[tauri::command]
#[specta::specta]
pub fn set_main_performance_key_owner(
    window: tauri::WebviewWindow,
    epoch: u32,
    owns: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main shell owns performance selection keys".into());
    }
    let mut current = MAIN_NATIVE_SELECTION_OWNER
        .lock()
        .map_err(|_| "Main keyboard ownership lock failed")?;
    if epoch < current.0 {
        return Err("Stale main keyboard ownership epoch".into());
    }
    *current = (epoch, owns);
    Ok(())
}

// NSEvent modifier constants (device-independent bits) and the arrow
// keyCodes the reroute matches. Command = 0x100000; Shift/Option/Control
// = 0x020000/0x080000/0x040000. The numeric-pad bit (0x200000, set for
// arrow keys) and the other noise bits (caps lock, function, help, the
// device-dependent low word) are deliberately ignored — they ride along
// with plain arrow presses and carry no intent of their own.
#[cfg(target_os = "macos")]
const NSEVENT_MODIFIER_COMMAND: usize = 0x0010_0000;
#[cfg(target_os = "macos")]
const NSEVENT_MODIFIERS_SHIFT_OPTION_CONTROL: usize = 0x000E_0000;
#[cfg(target_os = "macos")]
const KVK_LEFT_ARROW: u16 = 0x7B;
#[cfg(target_os = "macos")]
const KVK_RIGHT_ARROW: u16 = 0x7C;
#[cfg(target_os = "macos")]
const KVK_DOWN_ARROW: u16 = 0x7D;
#[cfg(target_os = "macos")]
const KVK_UP_ARROW: u16 = 0x7E;
#[cfg(target_os = "macos")]
const KVK_RETURN: u16 = 0x24;
#[cfg(target_os = "macos")]
const NSEVENT_MODIFIER_OPTION: usize = 0x0008_0000;
#[cfg(target_os = "macos")]
const NSEVENT_MODIFIERS_SHIFT_CONTROL: usize = 0x0006_0000;

/// True for exactly-Command horizontal arrows: command held, none of
/// shift/option/control, keyCode left/right. That is the pair WKWebView
/// claims as its back/forward equivalents — and the pair the app's ⌘
/// layer has historically owned. Other chords use native menu or original
/// WKWebView routing below; this predicate does not add horizontal navigation.
#[cfg(target_os = "macos")]
fn is_exactly_command_horizontal_arrow(modifier_flags: usize, key_code: u16) -> bool {
    modifier_flags & NSEVENT_MODIFIER_COMMAND != 0
        && modifier_flags & NSEVENT_MODIFIERS_SHIFT_OPTION_CONTROL == 0
        && (key_code == KVK_LEFT_ARROW || key_code == KVK_RIGHT_ARROW)
}

/// v1.3.3 (#89, user report — ⌘←/⌘→ stopped switching folder views):
/// WKWebView claims exactly-Command horizontal arrows as its own
/// back/forward equivalents and consumes them before the page can see
/// them (reproduced on the dev build: ⌘↓ and plain arrows reach the
/// DOM, ⌘←/⌘→ never do — silent, because the app has no in-webview
/// history to navigate). This guard reroutes that pair into the NORMAL
/// keyDown path, where the page's web-layer ⌘ handling — the same one
/// since v1.3.1, guards for text fields and overlays included — owns
/// them again. #202 additionally routes main-window Cmd+Opt+vertical
/// arrows to the enabled native menu before WK can consume them. Every
/// unmatched or disabled equivalent keeps WKWebView's original routing.
/// Class-level like the menu guard; main thread only; call once at startup.
#[cfg(target_os = "macos")]
pub fn install_cmd_arrow_webview_passthrough(app: &AppHandle) {
    use objc2::ffi::{
        class_addMethod, class_getInstanceMethod, method_exchangeImplementations,
        method_getTypeEncoding,
    };
    use objc2::runtime::{AnyClass, Imp};

    if CMD_ARROW_GUARD_INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(main) = app
        .get_webview_window("main")
        .and_then(|window| window.ns_window().ok())
    {
        MAIN_NATIVE_SELECTION_WINDOW.store(main as usize, Ordering::Relaxed);
    } else {
        log::warn!("Main window not found — native performance selection routing unavailable");
    }
    // SAFETY: mirrors the context-menu guard's class-structure mutation —
    // once per process on the main thread, before user key dispatch.
    unsafe {
        let Some(wk) = AnyClass::get(c"WKWebView") else {
            log::warn!("WKWebView class not found — ⌘-arrow reroute not installed");
            return;
        };
        let Some(view) = AnyClass::get(c"NSView") else {
            log::warn!("NSView class not found — ⌘-arrow reroute not installed");
            return;
        };
        let template =
            class_getInstanceMethod(view as *const AnyClass, objc2::sel!(performKeyEquivalent:));
        if template.is_null() {
            log::warn!("performKeyEquivalent: not found — ⌘-arrow reroute not installed");
            return;
        }
        let types = method_getTypeEncoding(template);
        if types.is_null() {
            log::warn!(
                "performKeyEquivalent: has no type encoding — ⌘-arrow reroute not installed"
            );
            return;
        }
        let typed: unsafe extern "C-unwind" fn(
            &objc2::runtime::AnyObject,
            objc2::runtime::Sel,
            *mut objc2::runtime::AnyObject,
        ) -> objc2::runtime::Bool = pnds_perform_key_equivalent;
        let imp: Imp = std::mem::transmute::<_, Imp>(typed);
        // Shadow path: WKWebView inherits NSView's hook without
        // implementing it itself — adding ours shadows it for WKWebView
        // instances only (exchanging would rewrite NSView process-wide).
        if class_addMethod(
            wk as *const AnyClass as *mut AnyClass,
            objc2::sel!(performKeyEquivalent:),
            imp,
            types,
        )
        .as_bool()
        {
            CMD_ARROW_GUARD_SHADOWS.store(true, Ordering::Relaxed);
            log::info!("⌘-arrow reroute installed (shadows NSView's hook)");
            return;
        }
        // Exchange path: WKWebView implements the hook — stash the
        // original under a private selector and swap the two.
        if !class_addMethod(
            wk as *const AnyClass as *mut AnyClass,
            objc2::sel!(pndsPerformKeyEquivalent:),
            imp,
            types,
        )
        .as_bool()
        {
            log::warn!("reroute method could not be added — ⌘-arrow reroute not installed");
            return;
        }
        let original =
            class_getInstanceMethod(wk as *const AnyClass, objc2::sel!(performKeyEquivalent:));
        if original.is_null() {
            log::warn!("performKeyEquivalent: vanished — ⌘-arrow reroute not installed");
            return;
        }
        let guard = class_getInstanceMethod(
            wk as *const AnyClass,
            objc2::sel!(pndsPerformKeyEquivalent:),
        );
        if guard.is_null() {
            log::warn!("reroute method vanished — ⌘-arrow reroute not installed");
            return;
        }
        method_exchangeImplementations(original as *mut _, guard as *mut _);
        log::info!("⌘-arrow reroute installed (exchanged with WKWebView's hook)");
    }
}

/// The reroute's `performKeyEquivalent:` implementation: main-window
/// Cmd+Opt+vertical arrows first try the native menu; exactly-Command
/// horizontal arrows are delivered through the NORMAL keyDown path (the
/// page's web layer then owns them, exactly as before WKWebView started
/// claiming the pair) and reported handled; every other equivalent
/// keeps its original routing — forwarded to WKWebView's implementation
/// in exchange mode, and in shadow mode answered "not handled" like the
/// NSView no-op we shadow (WKWebView has no AppKit subviews that need
/// key equivalents — its content is remote).
#[cfg(target_os = "macos")]
unsafe extern "C-unwind" fn pnds_perform_key_equivalent(
    this: &objc2::runtime::AnyObject,
    _cmd: objc2::runtime::Sel,
    event: *mut objc2::runtime::AnyObject,
) -> objc2::runtime::Bool {
    use objc2::msg_send;

    let handled: bool = if event.is_null() {
        false
    } else {
        // SAFETY: the runtime hands this hook a live NSEvent pointer.
        let flags: usize = unsafe { msg_send![event, modifierFlags] };
        let key_code: u16 = unsafe { msg_send![event, keyCode] };
        // #202: WK's original implementation returns YES for these chords,
        // preventing AppKit from reaching the enabled native menu accelerator.
        // Resolve the main shell by native window identity, so secondary windows
        // keep their keys even while a focus-driven menu rebuild is still pending.
        let selection_arrow = flags & NSEVENT_MODIFIERS_SHIFT_CONTROL == 0
            && (key_code == KVK_UP_ARROW || key_code == KVK_DOWN_ARROW);
        // NSMenu can match Return while ignoring an extra Shift/Control.
        // That must not turn a different chord into the native Load action.
        let modified_load = key_code == KVK_RETURN && flags & NSEVENT_MODIFIERS_SHIFT_CONTROL != 0;
        if flags & NSEVENT_MODIFIER_COMMAND != 0
            && flags & NSEVENT_MODIFIER_OPTION != 0
            && (selection_arrow || modified_load)
        {
            let target = MAIN_NATIVE_SELECTION_WINDOW.load(Ordering::Relaxed);
            // SAFETY: AppKit invokes this method on a live view and event.
            let window: *mut objc2::runtime::AnyObject = unsafe { msg_send![this, window] };
            let owns = MAIN_NATIVE_SELECTION_OWNER
                .lock()
                .map(|current| current.1)
                .unwrap_or(false);
            if owns && target != 0 && window as usize == target {
                let app: *mut objc2::runtime::AnyObject =
                    unsafe { msg_send![objc2::class!(NSApplication), sharedApplication] };
                let menu: *mut objc2::runtime::AnyObject = unsafe { msg_send![app, mainMenu] };
                if !menu.is_null() {
                    // SAFETY: NSApplication owns this live main NSMenu.
                    let native_menu: &objc2_app_kit::NSMenu = unsafe { &*menu.cast() };
                    // A disabled NSMenuItem can consume an equivalent without
                    // firing its action. Keep it on the original WK route.
                    if let Some(item) = enabled_selection_equivalent(native_menu, key_code, 0) {
                        if modified_load {
                            // SAFETY: same live receiver/event. Preserve one ordinary
                            // document key instead of NSMenu's broader Return match.
                            // WK keyDown can itself try the same broad Return
                            // menu match. Disable only this retained item during
                            // synchronous delegation, then restore its enabled state.
                            let enabled = item.isEnabled();
                            item.setEnabled(false);
                            unsafe {
                                let _: () = msg_send![this, keyDown: event];
                            }
                            item.setEnabled(enabled);
                            return objc2::runtime::Bool::YES;
                        }
                        // The JS callback still owns live business gates/selection.
                        let matched: bool = unsafe { msg_send![menu, performKeyEquivalent: event] };
                        if matched {
                            return objc2::runtime::Bool::YES;
                        }
                    }
                }
            }
        }
        if is_exactly_command_horizontal_arrow(flags, key_code) {
            // SAFETY: same receiver, same event pointer — delivered as a
            // plain keyDown, the ordinary (non-equivalent) event path.
            unsafe {
                let _: () = msg_send![this, keyDown: event];
            }
            true
        } else {
            false
        }
    };
    if handled {
        return objc2::runtime::Bool::YES;
    }
    if !CMD_ARROW_GUARD_SHADOWS.load(Ordering::Relaxed) {
        // SAFETY: same receiver, same event pointer, same signature — the
        // selector resolves to the original implementation post-swap.
        let result: objc2::runtime::Bool =
            unsafe { msg_send![this, pndsPerformKeyEquivalent: event] };
        return result;
    }
    objc2::runtime::Bool::NO
}

/// Native enabled-state check, including submenu parents. A disabled item's
/// key equivalent may otherwise be consumed without running its action.
#[cfg(target_os = "macos")]
fn enabled_selection_equivalent(
    menu: &objc2_app_kit::NSMenu,
    key_code: u16,
    depth: u8,
) -> Option<objc2::rc::Retained<objc2_app_kit::NSMenuItem>> {
    if depth >= 16 {
        return None;
    }
    let equivalent = objc2_foundation::NSString::from_str(match key_code {
        KVK_UP_ARROW => "\u{f700}",
        KVK_DOWN_ARROW => "\u{f701}",
        KVK_RETURN => "\r",
        _ => return None,
    });
    let items = menu.itemArray();
    for index in 0..items.count() {
        let item = items.objectAtIndex(index);
        if !item.isEnabled() {
            continue;
        }
        let modifiers = item.keyEquivalentModifierMask().bits();
        if modifiers & (NSEVENT_MODIFIER_COMMAND | NSEVENT_MODIFIERS_SHIFT_OPTION_CONTROL)
            == NSEVENT_MODIFIER_COMMAND | NSEVENT_MODIFIER_OPTION
            && item.keyEquivalent().isEqualToString(&equivalent)
        {
            return Some(item);
        }
        if let Some(found) = item
            .submenu()
            .and_then(|submenu| enabled_selection_equivalent(&submenu, key_code, depth + 1))
        {
            return Some(found);
        }
    }
    None
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

/// Match the native frame AND the content layer to the theme. A titled
/// NSWindow has system-rounded corners even when contentView.cornerRadius
/// is zero. Brutal therefore uses a borderless frame with the existing
/// AppKit controls retained; other themes restore the native overlay.
#[cfg(target_os = "macos")]
fn set_corner_radius<R: Runtime>(
    window: &WebviewWindow<R>,
    radius: f64,
    square_window: bool,
) -> Result<(), String> {
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
        square_chrome::apply(window, &*win, square_window)?;
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
fn set_corner_radius<R: Runtime>(
    _window: &WebviewWindow<R>,
    _radius: f64,
    _square_window: bool,
) -> Result<(), String> {
    Ok(())
}

/// Native-only ownership for Brutal's rectangular main frame. AppKit creates
/// the standard NSButtons; their overlay survives theme changes. Fullscreen
/// uses the system titlebar and its controls instead.
#[cfg(target_os = "macos")]
mod square_chrome {
    use std::cell::RefCell;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject};
    use objc2::{define_class, msg_send, sel, DeclaredClass, MainThreadOnly};
    use objc2_app_kit::{NSButton, NSView, NSWindow, NSWindowButton, NSWindowStyleMask};
    use objc2_foundation::NSPoint;
    use tauri::{Runtime, WebviewWindow};

    struct FullscreenAction(Box<dyn Fn()>);

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "PNDSSquareFullscreenTarget"]
        #[thread_kind = MainThreadOnly]
        #[ivars = FullscreenAction]
        struct FullscreenTarget;

        impl FullscreenTarget {
            #[unsafe(method(toggleFullscreen:))]
            fn toggle_fullscreen(&self, _sender: *mut AnyObject) {
                (self.ivars().0)();
            }
        }
    );

    define_class!(
        #[unsafe(super(NSView))]
        #[name = "PNDSSquareControlsView"]
        struct ControlsView;

        impl ControlsView {
            #[unsafe(method(hitTest:))]
            fn hit_test(&self, point: NSPoint) -> *mut NSView {
                // Empty titlebar space still reaches the webview's drag
                // regions and project menu; only actual buttons take input.
                let hit: *mut NSView = unsafe { msg_send![super(self), hitTest: point] };
                if std::ptr::eq(hit, self as *const Self as *const NSView) {
                    std::ptr::null_mut()
                } else {
                    hit
                }
            }
        }
    );

    struct SquareChrome {
        buttons: [Retained<NSButton>; 3],
        titlebar: Retained<NSView>,
        // AppKit control targets are not retained by the buttons.
        _fullscreen_target: Retained<FullscreenTarget>,
    }

    thread_local! {
        static CHROME: RefCell<Option<SquareChrome>> = const { RefCell::new(None) };
    }

    pub(super) fn frame_style(mask: NSWindowStyleMask, square: bool) -> NSWindowStyleMask {
        if square {
            mask & !NSWindowStyleMask::Titled
        } else {
            mask | NSWindowStyleMask::Titled
        }
    }

    pub(super) unsafe fn button(
        native: &NSWindow,
        kind: NSWindowButton,
    ) -> Option<Retained<NSButton>> {
        if native.styleMask().contains(NSWindowStyleMask::FullScreen) {
            return native.standardWindowButton(kind);
        }
        let index = match kind {
            NSWindowButton::CloseButton => Some(0),
            NSWindowButton::MiniaturizeButton => Some(1),
            NSWindowButton::ZoomButton => Some(2),
            _ => None,
        };
        CHROME
            .with(|chrome| {
                let chrome = chrome.borrow();
                Some(chrome.as_ref()?.buttons[index?].clone())
            })
            .or_else(|| native.standardWindowButton(kind))
    }

    pub(super) unsafe fn container(close: &NSButton) -> Option<Retained<NSView>> {
        CHROME
            .with(|chrome| {
                chrome
                    .borrow()
                    .as_ref()
                    .map(|chrome| chrome.titlebar.clone())
            })
            .or_else(|| close.superview().and_then(|view| view.superview()))
    }

    pub(super) unsafe fn apply<R: Runtime>(
        window: &WebviewWindow<R>,
        native: &NSWindow,
        square: bool,
    ) -> Result<(), String> {
        let fullscreen = window.is_fullscreen().unwrap_or(false);
        if square && CHROME.with(|chrome| chrome.borrow().is_none()) {
            let originals = [
                native.standardWindowButton(NSWindowButton::CloseButton),
                native.standardWindowButton(NSWindowButton::MiniaturizeButton),
                native.standardWindowButton(NSWindowButton::ZoomButton),
            ];
            let [Some(original_close), Some(original_mini), Some(original_zoom)] = originals else {
                return Err("Native window controls are missing".into());
            };
            let original_parent = original_close
                .superview()
                .and_then(|view| view.superview())
                .ok_or("Native titlebar container is missing")?;
            let mtm = objc2::MainThreadMarker::new().ok_or("AppKit requires the main thread")?;
            let titlebar: Retained<ControlsView> =
                msg_send![ControlsView::alloc(mtm), initWithFrame: original_parent.frame()];
            let titlebar: Retained<NSView> = titlebar.into_super();
            let buttons = [
                NSWindow::standardWindowButton_forStyleMask(
                    NSWindowButton::CloseButton,
                    native.styleMask(),
                    mtm,
                ),
                NSWindow::standardWindowButton_forStyleMask(
                    NSWindowButton::MiniaturizeButton,
                    native.styleMask(),
                    mtm,
                ),
                NSWindow::standardWindowButton_forStyleMask(
                    NSWindowButton::ZoomButton,
                    native.styleMask(),
                    mtm,
                ),
            ];
            let [Some(close), Some(mini), Some(zoom)] = buttons else {
                return Err("AppKit could not create the standard window controls".into());
            };
            for (button, original) in [&close, &mini, &zoom].into_iter().zip([
                &original_close,
                &original_mini,
                &original_zoom,
            ]) {
                button.setFrame(original.frame());
                button.setHidden(original.isHidden());
                button.setAlphaValue(original.alphaValue());
                titlebar.addSubview(button);
            }
            let _: () = msg_send![&*close, setTarget: native];
            let _: () = msg_send![&*close, setAction: sel!(performClose:)];
            let _: () = msg_send![&*mini, setTarget: native];
            let _: () = msg_send![&*mini, setAction: sel!(performMiniaturize:)];
            let fullscreen_window = window.clone();
            let target =
                FullscreenTarget::alloc(mtm).set_ivars(FullscreenAction(Box::new(move || {
                    // Tao's set_fullscreen prepares and restores a borderless
                    // style mask. Calling NSWindow.toggleFullScreen directly
                    // would bypass that preparation after removing Titled.
                    let next = !fullscreen_window.is_fullscreen().unwrap_or(false);
                    if let Err(error) = fullscreen_window.set_fullscreen(next) {
                        log::warn!("Unable to toggle square-window fullscreen: {error}");
                    }
                })));
            let target: Retained<FullscreenTarget> = msg_send![super(target), init];
            let _: () = msg_send![&*zoom, setTarget: &*target];
            let _: () = msg_send![&*zoom, setAction: sel!(toggleFullscreen:)];
            // Publish ownership before changing style: AppKit may deliver
            // resize/layout callbacks synchronously during setStyleMask.
            CHROME.with(|chrome| {
                *chrome.borrow_mut() = Some(SquareChrome {
                    buttons: [close, mini, zoom],
                    titlebar: titlebar.clone(),
                    _fullscreen_target: target,
                });
            });
        }
        let titlebar = CHROME.with(|chrome| {
            chrome
                .borrow()
                .as_ref()
                .map(|chrome| chrome.titlebar.clone())
        });
        if let Some(titlebar) = titlebar {
            let mask = frame_style(native.styleMask(), square);
            if native.styleMask() != mask {
                native.setStyleMask(mask);
            }
            native.setTitlebarAppearsTransparent(true);
            let content = native
                .contentView()
                .ok_or("Window content view is missing")?;
            content.addSubview(&titlebar);
            titlebar.setHidden(fullscreen);
            for kind in [
                NSWindowButton::CloseButton,
                NSWindowButton::MiniaturizeButton,
                NSWindowButton::ZoomButton,
            ] {
                if let Some(button) = native.standardWindowButton(kind) {
                    button.setHidden(!fullscreen);
                    if fullscreen {
                        button.setAlphaValue(1.0);
                    }
                }
            }
        }
        native.invalidateShadow();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_keeps_geometry_but_cannot_restore_old_borderless_decorations() {
        use tauri_plugin_window_state::StateFlags;
        let flags = persisted_state_flags();
        assert!(flags.contains(StateFlags::SIZE | StateFlags::POSITION));
        assert!(!flags.contains(StateFlags::DECORATIONS));
        assert!(!flags.contains(StateFlags::VISIBLE));
    }

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

    /// #56: a secondary window's reveal runs on an ISOLATED counter — it
    /// must neither advance nor be superseded by main's shared generation.
    #[test]
    fn secondary_reveals_do_not_touch_the_main_generation() {
        let manager = WindowManager::default();

        let main_gen = reveal_generation(&manager, "main");
        let first = main_gen.next();
        assert!(main_gen.is_current(first));

        let main_before = manager.snapshot().generation;
        let help_gen = reveal_generation(&manager, "help");
        let _ = help_gen.next();
        assert_eq!(
            manager.snapshot().generation,
            main_before,
            "a help reveal must not advance (and so cancel) main's ramps"
        );
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

    /// v1.3.3 (#79): the native menu guard's pass-through policy — menus
    /// carrying a text-affordance selector (editable fields and text
    /// selections) keep their native menu, web-navigation menus do not.
    #[test]
    fn text_affordance_menus_pass_the_native_guard() {
        use objc2::sel;

        assert!(actions_include_text_affordance([Some(sel!(copy:))]));
        assert!(actions_include_text_affordance([None, Some(sel!(paste:))]));
        // Selection menus mix copy with non-edit actions — still text.
        assert!(actions_include_text_affordance([
            Some(sel!(lookUp:)),
            Some(sel!(copy:)),
        ]));
        // Empty menus and pure navigation menus are emptied.
        assert!(!actions_include_text_affordance([]));
        assert!(!actions_include_text_affordance([None]));
        assert!(!actions_include_text_affordance([Some(sel!(reload:))]));
    }

    /// v1.3.3 (#89): the ⌘-arrow reroute matches EXACTLY Command +
    /// horizontal arrows — the pair WKWebView claims as back/forward and
    /// the pair the app's ⌘ layer owns. Modifiers, vertical arrows and
    /// arrow-noise bits must all stay on WKWebView's original routing.
    #[test]
    fn command_horizontal_arrows_match_the_reroute() {
        const COMMAND: usize = 0x0010_0000;
        const SHIFT: usize = 0x0002_0000;
        const OPTION: usize = 0x0008_0000;
        const CONTROL: usize = 0x0004_0000;
        // The numeric-pad bit rides along with arrow presses.
        const NUMERIC_PAD: usize = 0x0020_0000;

        assert!(is_exactly_command_horizontal_arrow(COMMAND, 0x7B));
        assert!(is_exactly_command_horizontal_arrow(COMMAND, 0x7C));
        // Arrow presses carry the numeric-pad bit — still a match.
        assert!(is_exactly_command_horizontal_arrow(
            COMMAND | NUMERIC_PAD,
            0x7B
        ));
        // Any other intent disqualifies the pair.
        assert!(!is_exactly_command_horizontal_arrow(COMMAND | SHIFT, 0x7B));
        assert!(!is_exactly_command_horizontal_arrow(COMMAND | OPTION, 0x7C));
        assert!(!is_exactly_command_horizontal_arrow(
            COMMAND | CONTROL,
            0x7B
        ));
        // ⌘↓/⌘↑ must keep their original routing.
        assert!(!is_exactly_command_horizontal_arrow(COMMAND, 0x7D));
        assert!(!is_exactly_command_horizontal_arrow(COMMAND, 0x7E));
        // Plain arrows and no-Command arrows are not equivalents anyway.
        assert!(!is_exactly_command_horizontal_arrow(0, 0x7B));
        assert!(!is_exactly_command_horizontal_arrow(SHIFT, 0x7B));
    }

    /// v1.3.5 (#105): the guest focus reporter's injection contract —
    /// document start, every frame (the monitor iframes navigate after
    /// setup, and the script must be live in each new document before
    /// the page can focus anything). The script itself carries the
    /// contract markers: the pnds:guest-focus message, focusin/focusout
    /// reporting, and the guard that keeps the app's main frame silent.
    #[test]
    fn guest_focus_reporter_registers_for_all_frames_at_document_start() {
        let (source, injection_time, main_frame_only) = guest_focus_injection();
        assert_eq!(
            injection_time, 0,
            "WKUserScriptInjectionTimeAtDocumentStart"
        );
        assert!(!main_frame_only, "must reach the monitor iframes");
        assert!(source.contains(GUEST_FOCUS_MESSAGE_TYPE));
        assert!(source.contains("focusin"));
        assert!(source.contains("focusout"));
        assert!(
            source.contains("window.parent === window"),
            "the app's main frame must stay silent"
        );
        assert!(
            source.contains("document.hasFocus()"),
            "the deferred false must settle via hasFocus/activeElement — \
             relatedTarget alone misreports same-document moves"
        );
    }

    /// The guest-focus wire contract is single-sourced: the reporter
    /// script is BUILT from [GUEST_FOCUS_MESSAGE_TYPE], whose literal
    /// must stay identical to the TypeScript gate's twin
    /// (src/hooks/use-guest-focus-gate.ts, `GUEST_FOCUS_MESSAGE_TYPE`).
    /// Rust cannot import TypeScript, so this pin is the drift guard
    /// between the two languages.
    #[test]
    fn guest_focus_script_is_built_from_the_message_type_const() {
        assert_eq!(GUEST_FOCUS_MESSAGE_TYPE, "pnds:guest-focus");
        assert!(
            guest_focus_script().contains(&format!("type: '{GUEST_FOCUS_MESSAGE_TYPE}'")),
            "the reporter must post the shared message type"
        );
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

    /// The native corner radius is 16px in windowed mode (matching
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

    #[cfg(target_os = "macos")]
    #[test]
    fn square_frame_removes_system_rounding_without_losing_window_operations() {
        use objc2_app_kit::NSWindowStyleMask;
        let operations = NSWindowStyleMask::Closable
            | NSWindowStyleMask::Miniaturizable
            | NSWindowStyleMask::Resizable
            | NSWindowStyleMask::FullSizeContentView;
        let rounded = operations | NSWindowStyleMask::Titled;
        let square = square_chrome::frame_style(rounded, true);
        assert_eq!(square, operations);
        assert!(!square.contains(NSWindowStyleMask::Titled));
        assert_eq!(square_chrome::frame_style(square, false), rounded);
    }
}
