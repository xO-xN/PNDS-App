//! Liquid Glass window theme (v1.2.3 T5, issue #41 / spec #36).
//!
//! `NSGlassEffectView` ships with macOS 26 (Tahoe) — it landed as public
//! AppKit API, though the spec planned for a private one; the runtime
//! class-lookup guard below keeps the enable path safe either way. The
//! effect view is inserted as a sibling *below* the WKWebView (the same
//! placement `window-vibrancy` uses for NSVisualEffectView), the window is
//! made non-opaque with a clear background, and the webview stops drawing
//! its own background — the CSS layer then paints translucent surfaces
//! (see `[data-color-theme='glass']` in theme-variables.css) over the real
//! refraction. The monitor iframe stays fully opaque: its area paints
//! solid colors, and the glass view sits behind it, not around it.
//!
//! Toggling is idempotent and reversible: switching away removes the glass
//! view and restores the default opaque window (`backgroundColor: nil` +
//! `opaque: YES`), which is the pre-glass windowBackground state — this
//! app never installs an NSVisualEffectView, so there is nothing else to
//! restore. Theme switches while a session runs only touch window
//! dressing; no session, audio, or webview lifecycle is involved.
//!
//! Threading: every AppKit call below runs on the main thread — the
//! `set_liquid_glass` command hops there via `run_on_main_thread`. Do not
//! call `apply_liquid_glass` from anywhere else.

use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// The macOS major that first ships NSGlassEffectView.
pub const GLASS_MACOS_MAJOR: isize = 26;

/// Corner radius of the glass view itself in windowed mode — matches the
/// shared `--app-corner-radius` token / `CORNER_RADIUS` in window.rs. The
/// content view's layer already clips every subview to the window shape
/// (incl. fullscreen's square corners), so this only refines the glass
/// material's own curvature.
const GLASS_CORNER_RADIUS: f64 = 16.0;

/// NSViewAutoresizingMask: width- and height-sizable (the glass view
/// tracks window resizes and fullscreen transitions). NSUInteger-typed, so
/// the mask is a usize.
const AUTORESIZING_W_H: usize = 2 | 16;

/// v1.2.3 (issue #41): can this system render the Glass theme? macOS 26
/// (Darwin 25) is the floor. Cached — the OS version cannot change under
/// a running app.
pub fn liquid_glass_supported() -> bool {
    use std::sync::OnceLock;
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    *SUPPORTED.get_or_init(|| {
        #[cfg(target_os = "macos")]
        {
            let version = macos_version();
            log::debug!(
                "macOS version detected: {}.{}.{}",
                version.0,
                version.1,
                version.2
            );
            is_macos_26(version.0)
        }
        #[cfg(not(target_os = "macos"))]
        {
            false
        }
    })
}

/// The pure gate, so the version rule is unit-testable.
fn is_macos_26(major: isize) -> bool {
    major >= GLASS_MACOS_MAJOR
}

/// Install or remove the liquid-glass dressing on the main window.
/// Errors surface to the frontend's theme applier, which logs them — the
/// CSS side still renders its own translucent approximation either way
/// (spec #36 fallback: CSS-only glass, still macOS 26+ only).
pub fn apply_liquid_glass<R: Runtime>(
    window: &WebviewWindow<R>,
    enabled: bool,
) -> Result<(), String> {
    if enabled && !liquid_glass_supported() {
        return Err("Liquid glass requires macOS 26 or newer".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        glass_appkit(window, enabled)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Err("Liquid glass is macOS-only".to_string())
    }
}

/// The version query behind the gating — `NSProcessInfo` is authoritative
/// (unlike `SystemVersion.plist`, which reports compatibility values on
/// some releases).
#[cfg(target_os = "macos")]
fn macos_version() -> (isize, isize, isize) {
    let v = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
    (v.majorVersion, v.minorVersion, v.patchVersion)
}

// ── AppKit plumbing ─────────────────────────────────────────────────────
//
// SAFETY (whole section): like window.rs, we drive only the borrowed
// NSWindow/NSView pointers owned by Tauri with msg_send, never wrapping
// them in Retained. The glass view we create is handed to the view tree
// (retained by its superview) and is only ever referenced again by
// looking it up among the subviews — no stored pointers to dangling views.

#[cfg(target_os = "macos")]
fn glass_appkit<R: Runtime>(window: &WebviewWindow<R>, enabled: bool) -> Result<(), String> {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;
    use objc2_app_kit::{NSView, NSWindow};

    let ns_window = window
        .ns_window()
        .map_err(|e| format!("ns_window failed: {e}"))?;
    unsafe {
        let win: *mut NSWindow = ns_window.cast();
        let content: *mut NSView = msg_send![win, contentView];

        if enabled {
            install_glass_view(content)?;
            // Non-opaque window + clear background so the desktop feeds
            // the glass refraction through the transparent webview.
            let clear: *mut objc2::runtime::AnyObject =
                msg_send![AnyClass::get(c"NSColor").unwrap(), clearColor];
            let _: () = msg_send![win, setOpaque: false];
            let _: () = msg_send![win, setBackgroundColor: clear];
        } else {
            if let Some(glass) = find_glass_view(content) {
                let _: () = msg_send![glass, removeFromSuperview];
            }
            // nil background color restores the window's default (opaque)
            // background — the pre-glass state.
            let _: () = msg_send![win, setOpaque: true];
            let _: () = msg_send![win, setBackgroundColor: std::ptr::null_mut::<objc2::runtime::AnyObject>()];
        }

        set_webview_background(content, !enabled);
    }
    log::info!(
        "Liquid glass {}",
        if enabled { "applied" } else { "removed" }
    );
    Ok(())
}

/// The NSGlassEffectView among `content`'s direct subviews, if present —
/// the idempotency anchor: enable skips when it exists, disable only acts
/// when it does. Exact class match on purpose: we created the view, so no
/// subclass can be ours (unlike walk_views, which hunts WKWebView and
/// must accept subclasses).
#[cfg(target_os = "macos")]
unsafe fn find_glass_view(
    content: *mut objc2_app_kit::NSView,
) -> Option<*mut objc2::runtime::AnyObject> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};

    let glass_class = AnyClass::get(c"NSGlassEffectView")?;
    let subviews: *mut AnyObject = msg_send![content, subviews];
    let count: usize = msg_send![subviews, count];
    for i in 0..count {
        let view: *mut AnyObject = msg_send![subviews, objectAtIndex: i];
        let class: &'static AnyClass = msg_send![view, class];
        if class == glass_class {
            return Some(view);
        }
    }
    None
}

/// Create the glass view pinned to the bottom of the content view.
/// Absent NSGlassEffectView (pre-26) this errors — callers gate on the
/// version first, so in practice it cannot fire.
#[cfg(target_os = "macos")]
unsafe fn install_glass_view(content: *mut objc2_app_kit::NSView) -> Result<(), String> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};

    if find_glass_view(content).is_some() {
        return Ok(()); // already installed — idempotent re-apply
    }
    let glass_class = AnyClass::get(c"NSGlassEffectView")
        .ok_or("NSGlassEffectView is unavailable on this system")?;

    let frame: objc2_foundation::NSRect = msg_send![content, bounds];
    let alloc: *mut AnyObject = msg_send![glass_class, alloc];
    let glass: *mut AnyObject = msg_send![alloc, initWithFrame: frame];
    if glass.is_null() {
        return Err("NSGlassEffectView init failed".to_string());
    }
    let _: () = msg_send![glass, setAutoresizingMask: AUTORESIZING_W_H];
    let _: () = msg_send![glass, setCornerRadius: GLASS_CORNER_RADIUS];

    // NSWindowBelow = -1, typed as the selector demands: the ordering mode
    // is NSInteger, so an i32 -1 would zero-extend on arm64 into a huge
    // positive (above) value and stack the glass OVER the webview.
    let _: () = msg_send![
        content,
        addSubview: glass,
        positioned: -1isize,
        relativeTo: std::ptr::null_mut::<AnyObject>()
    ];
    Ok(())
}

/// Stop (or resume) the WKWebView painting its own background, so the
/// glass behind it shows through. Uses the `_drawsBackground` private
/// setter guarded by a respondsToSelector check — the same mechanism wry
/// uses for `transparent: true` windows. Walks the whole tree defensively;
/// the webview is the only WKWebView in this app.
#[cfg(target_os = "macos")]
unsafe fn set_webview_background(root: *mut objc2_app_kit::NSView, draws: bool) {
    use objc2::runtime::AnyClass;

    let Some(webview_class) = AnyClass::get(c"WKWebView") else {
        return;
    };
    walk_views(root.cast(), webview_class, draws);
}

/// Recursive descendant walk applying `_setDrawsBackground:` to every
/// WKWebView found.
#[cfg(target_os = "macos")]
unsafe fn walk_views(
    view: *mut objc2::runtime::AnyObject,
    webview_class: &'static objc2::runtime::AnyClass,
    draws: bool,
) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let class: &'static objc2::runtime::AnyClass = msg_send![view, class];
    if class_is(class, webview_class) {
        let responds: bool = msg_send![
            view,
            respondsToSelector: sel_utils::set_draws_background_sel()
        ];
        if responds {
            let _: () = msg_send![view, _setDrawsBackground: draws];
            return; // the webview has no descendant webviews
        }
    }
    let subviews: *mut AnyObject = msg_send![view, subviews];
    let count: usize = msg_send![subviews, count];
    for i in 0..count {
        let child: *mut AnyObject = msg_send![subviews, objectAtIndex: i];
        walk_views(child, webview_class, draws);
    }
}

/// Class-or-superclass match. The walk is bounded: AppKit hierarchies are
/// shallow (a handful of levels), and a bound turns any pathological
/// cycle into a false negative instead of a hang. No real WKWebView
/// ancestor chain comes anywhere near 16.
#[cfg(target_os = "macos")]
unsafe fn class_is(
    class: &'static objc2::runtime::AnyClass,
    of: &'static objc2::runtime::AnyClass,
) -> bool {
    let mut current = class;
    for _ in 0..16 {
        if current == of {
            return true;
        }
        match current.superclass() {
            Some(superclass) => current = superclass,
            None => return false,
        }
    }
    false
}

/// Registering the private selector once (it is not in objc2's static
/// selector table).
#[cfg(target_os = "macos")]
mod sel_utils {
    use objc2::runtime::Sel;
    use std::sync::OnceLock;

    static SET_DRAWS_BACKGROUND: OnceLock<Sel> = OnceLock::new();

    pub fn set_draws_background_sel() -> Sel {
        *SET_DRAWS_BACKGROUND.get_or_init(|| Sel::register(c"_setDrawsBackground:"))
    }
}

// ── Commands ────────────────────────────────────────────────────────────

/// v1.2.3 (issue #41): whether this system can render the Glass theme.
/// Drives the Appearance option's disabled state and the persisted-value
/// fallback (glass on an old system renders Lavender instead).
#[tauri::command]
#[specta::specta]
pub async fn supports_liquid_glass() -> Result<bool, String> {
    Ok(liquid_glass_supported())
}

/// v1.2.3 (issue #41): apply/remove the native liquid-glass dressing.
/// Called by the frontend whenever the effective theme changes — including
/// away from glass, which restores the default opaque window.
///
/// The AppKit work MUST run on the main thread: this async command executes
/// on a tokio worker, and driving the view hierarchy from there throws an
/// ObjC exception ("modifying the autolayout engine from a background
/// thread") that Rust cannot catch — an instant abort (the crash reported
/// on first Glass selection). `run_on_main_thread` hops over and the
/// channel waits out the (sub-millisecond) result so errors still surface.
#[tauri::command]
#[specta::specta]
pub async fn set_liquid_glass(app: AppHandle, enabled: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = apply_liquid_glass(&window, enabled);
        let _ = tx.send(result);
    })
    .map_err(|e| format!("Failed to schedule the glass task on the main thread: {e}"))?;
    rx.recv()
        .map_err(|_| "The main-thread glass task did not report back".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The version gate: 26+ renders glass, 15.x (the newest pre-Tahoe
    /// line) and anything older does not.
    #[test]
    fn version_gate() {
        assert!(is_macos_26(26));
        assert!(is_macos_26(27));
        assert!(!is_macos_26(25));
        assert!(!is_macos_26(15));
        assert!(!is_macos_26(14));
        assert_eq!(GLASS_MACOS_MAJOR, 26);
    }
}
