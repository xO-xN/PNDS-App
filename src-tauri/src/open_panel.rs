//! Native open panel for the ⌘O "Add Project" flow (v1.2.0, issue #16).
//!
//! Neither the dialog plugin's JS API nor its Rust builder can show one
//! NSOpenPanel that accepts both directories and files — they hardwire
//! canChooseFiles XOR canChooseDirectories. ⌘O must accept a project
//! directory *or* a `.pnds` bundle file, so this module drives NSOpenPanel
//! directly through objc2-app-kit (the same stack the fade/window code and
//! rfd use). The panel runs app-modally on the main thread; the command
//! thread blocks on a channel until it closes.

use tauri::AppHandle;

/// Shows an NSOpenPanel that accepts a directory or a `.pnds` file.
/// Returns `None` when the user cancels.
#[cfg(target_os = "macos")]
pub fn pick_project_or_bundle_path(app: &AppHandle, title: &str) -> Result<Option<String>, String> {
    use objc2::rc::autoreleasepool;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSOpenPanel, NSWindowLevel};
    use objc2_foundation::{NSArray, NSString};

    // rfd parity: the shielding window level keeps the panel visible above
    // a fullscreen session window.
    extern "C" {
        fn CGShieldingWindowLevel() -> i32;
    }

    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    let title = title.to_string();

    app.run_on_main_thread(move || {
        let picked = autoreleasepool(|_| {
            let mtm = MainThreadMarker::new()?;
            let panel = NSOpenPanel::openPanel(mtm);
            unsafe {
                panel.setCanChooseFiles(true);
                panel.setCanChooseDirectories(true);
                panel.setAllowsMultipleSelection(false);
                panel.setTitle(Some(&NSString::from_str(&title)));
                panel.setLevel(CGShieldingWindowLevel() as NSWindowLevel);
                // Restrict file choices to .pnds bundles (directories stay
                // selectable — macOS doesn't apply the type filter to them).
                // The deprecated API is the only one reachable without the
                // UniformTypeIdentifiers framework; rfd uses it too.
                let extensions = NSArray::from_retained_slice(&[NSString::from_str("pnds")]);
                #[allow(deprecated)]
                panel.setAllowedFileTypes(Some(&extensions));
                if panel.runModal() == NSModalResponseOK {
                    panel
                        .URL()
                        .and_then(|url| url.path())
                        .map(|path| path.to_string())
                } else {
                    None
                }
            }
        });
        let _ = tx.send(picked);
    })
    .map_err(|e| format!("Failed to run the open panel: {e}"))?;

    rx.recv()
        .map_err(|_| "The open panel closed unexpectedly".to_string())
}

/// Non-macOS placeholder — the App ships macOS-only.
#[cfg(not(target_os = "macos"))]
pub fn pick_project_or_bundle_path(
    _app: &AppHandle,
    _title: &str,
) -> Result<Option<String>, String> {
    Err("The open panel is only available on macOS.".to_string())
}
