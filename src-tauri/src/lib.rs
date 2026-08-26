//! Tauri application library entry point.
//!
//! Command implementations are organized in the `commands` module,
//! project/session logic in `project`, and shared types in `types`.

mod bindings;
mod commands;
mod open_panel;
mod process_activity;
mod project;
mod types;
mod window;

use std::collections::HashSet;
use tauri::{Manager, RunEvent, WindowEvent};

/// Application entry point. Sets up all plugins and initializes the app.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = bindings::generate_bindings();

    // Export TypeScript bindings in debug builds
    #[cfg(debug_assertions)]
    bindings::export_ts_bindings();

    // Build with common plugins
    let mut app_builder = tauri::Builder::default();

    // Single instance plugin must be registered FIRST
    // When user tries to open a second instance, focus the existing window instead
    #[cfg(desktop)]
    {
        app_builder = app_builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }));
    }

    // Window state plugin - saves/restores window position and size
    #[cfg(desktop)]
    {
        app_builder = app_builder.plugin(
            tauri_plugin_window_state::Builder::new()
                // #51: VISIBLE excluded — the plugin's restore path would
                // show the window itself, bypassing the hidden-create
                // reveal gate (the theme-gated first frame).
                .with_state_flags(crate::window::persisted_state_flags())
                .build(),
        );
    }

    // Updater plugin for in-app updates
    #[cfg(desktop)]
    {
        app_builder = app_builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    app_builder = app_builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .manage(crate::project::session::SessionManager::default())
        .manage(crate::window::WindowManager::default())
        .manage(crate::commands::preferences::PreferencesCache::default())
        .manage(crate::commands::bundle::PendingBundleOpens::default())
        .plugin({
            #[allow(unused_mut)]
            let mut targets = vec![
                // Always log to stdout for development
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                // Log to system logs on macOS (appears in Console.app)
                #[cfg(target_os = "macos")]
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                    file_name: None,
                }),
            ];
            // Log to webview console — excluded on Linux where the WebKitGTK webview
            // doesn't exist during setup(), causing app.emit() to deadlock on the IPC socket.
            #[cfg(not(target_os = "linux"))]
            targets.push(tauri_plugin_log::Target::new(
                tauri_plugin_log::TargetKind::Webview,
            ));
            tauri_plugin_log::Builder::new()
                // Use Debug level in development, Info in production
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                // v1.2.0 (issue #13): the default 40KB cap rotated away most
                // of a gig's logs. ~2MB keeps a whole performance day on disk
                // while staying bounded.
                .max_file_size(2 * 1024 * 1024)
                .targets(targets)
                .build()
        });

    app_builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            log::info!("Application starting up");
            log::debug!(
                "App handle initialized for package: {}",
                app.package_info().name
            );

            // terminate child processes left behind by an abnormal
            // previous exit (crash, force-quit). Best-effort at startup.
            // No session can be live yet, so nothing is exempt.
            if let Ok(dir) = commands::project::app_data_dir(app.handle()) {
                let registry = crate::project::children::ChildRegistry::new(dir);
                match registry.cleanup_orphans(&HashSet::new()) {
                    Ok(n) if n > 0 => log::info!("Startup cleanup terminated {n} orphan(s)"),
                    Ok(_) => {}
                    Err(e) => log::warn!("Startup orphan cleanup failed: {e}"),
                }
            }

            // prewarm the audio subsystem in the background so the
            // first real session load boots scsynth on a warm CoreAudio
            // (coreaudiod's one-time init runs here, off the critical
            // path, instead of during the first load).
            #[cfg(target_os = "macos")]
            crate::project::audio::prewarm_scsynth();

            // NOTE: Application menu is built from JavaScript for i18n support
            // See src/lib/menu.ts for the menu implementation

            // the native window corner radius must match the shared
            // frontend token (16px) so the window's real edge aligns with
            // the content rounding. Fullscreen windows are square. The
            // square-corners flag is still false here — the frontend sets
            // it right after applying the saved Brutal theme.
            if let Some(window) = app.get_webview_window("main") {
                let square = app
                    .state::<crate::window::WindowManager>()
                    .square_corners
                    .load(std::sync::atomic::Ordering::SeqCst);
                crate::window::sync_corner_radius(&window, square);
                // v1.2.3 (user request): no default web right-click menu
                // anywhere — right-click belongs to the designed context
                // menus only (all frames, incl. the monitor iframes).
                #[cfg(target_os = "macos")]
                crate::window::suppress_default_context_menu(&window);
            }

            // v1.3.0 (#51): cold-start reveal backstop. The main window is
            // created hidden and the frontend reveals it (fade_in_window)
            // once the saved theme has landed; if that signal never
            // arrives — early JS error, hung IPC — force the window
            // visible after the grace period. The app must never stay
            // invisible-but-running.
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(crate::window::COLD_START_REVEAL_BACKSTOP);
                    crate::window::force_show_if_hidden(&handle);
                });
            }

            Ok(())
        })
        .invoke_handler(builder.invoke_handler())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match &event {
            // keep the cached fullscreen flag in sync regardless of
            // how the user left fullscreen (menu/⌃⌘F/sidebar command, the
            // native green button, or Escape). Without this, exiting via
            // the native controls would leave the sidebar's custom traffic
            // lights hidden forever.
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Resized(_),
                ..
            } if label == "main" => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let state = app_handle.state::<crate::window::WindowManager>();
                    let is_fs = window.is_fullscreen().unwrap_or(false);
                    let cached = state.fullscreen.load(std::sync::atomic::Ordering::SeqCst);
                    if is_fs != cached {
                        state
                            .fullscreen
                            .store(is_fs, std::sync::atomic::Ordering::SeqCst);
                        state.fade_gen.next();
                        use tauri::Emitter;
                        let _ = app_handle.emit("pnds:window", state.snapshot());
                        log::info!("Fullscreen state synced via resize: {is_fs}");
                        // square the native corners in fullscreen and
                        // restore the 16px radius on the way back (#41:
                        // unless the square-corners theme flag is set).
                        crate::window::sync_corner_radius(
                            &window,
                            state
                                .square_corners
                                .load(std::sync::atomic::Ordering::SeqCst),
                        );
                    }
                }
            }

            // Coming back from another desktop/space (the window becomes
            // key again): the webview's JS was suspended while occluded,
            // so its queued `pnds:session` events lag the backend, and
            // macOS may have handed the keyboard first responder to the
            // monitor's out-of-process iframe — killing every
            // window-level key until the next click. WKWebView does not
            // reliably surface DOM focus/visibility events for space
            // switches, so the shell learns about the regain here and
            // catches up on both fronts.
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Focused(true),
                ..
            } if label == "main" => {
                use tauri::Emitter;
                let session = app_handle.state::<crate::project::session::SessionManager>();
                session.publish(app_handle);
                let _ = app_handle.emit("pnds:window-focus", ());
                // The first emit can land while the webview is still
                // resuming from occlusion suspension — an emit into a
                // suspended webview is dropped outright, taking the
                // catch-up with it (user retest: both fixes inert).
                // Re-fire at +300ms / +1s / +2.5s so at least one
                // certainly arrives after the webview is back.
                let handle = app_handle.clone();
                std::thread::spawn(move || {
                    for delay_ms in [300u64, 700, 1500] {
                        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                        let _ = handle.emit("pnds:window-focus", ());
                    }
                });
            }

            // macOS: Hide the main window instead of quitting so the dock icon can
            // reopen it. On other platforms, the close proceeds normally.
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                #[cfg(target_os = "macos")]
                {
                    api.prevent_close();

                    // Save window state before hiding
                    use tauri_plugin_window_state::AppHandleExt;
                    // #51: VISIBLE excluded — see persisted_state_flags.
                    if let Err(e) =
                        app_handle.save_window_state(crate::window::persisted_state_flags())
                    {
                        log::warn!("Failed to save window state: {e}");
                    }

                    // fade out, then hide — unless the app is
                    // quitting (⌘Q), which hides immediately.
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let quitting = {
                            let state = app_handle.state::<crate::window::WindowManager>();
                            state.quitting.load(std::sync::atomic::Ordering::SeqCst)
                        };
                        if quitting {
                            let _ = window.hide();
                        } else {
                            let gen = {
                                let state = app_handle.state::<crate::window::WindowManager>();
                                state.fade_gen.next()
                            };
                            let fade_gen = {
                                let state = app_handle.state::<crate::window::WindowManager>();
                                std::sync::Arc::clone(&state.fade_gen)
                            };
                            crate::window::set_opacity_public(&window, 0.0);
                            crate::window::spawn_ramp(window, fade_gen, gen, 0.0);
                        }
                        log::info!("Main window hidden");
                    }
                }
            }

            // macOS: Dock icon clicked — reopen the main window if it was hidden
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(true) {
                        // fade in on reopen. Start fully transparent
                        // so the ramp is visible, then restore state.
                        crate::window::set_opacity_public(&window, 0.0);
                        let _ = window.show();

                        // The window-state plugin only auto-restores on app startup,
                        // not after a hide/show cycle.
                        use tauri_plugin_window_state::{StateFlags, WindowExt};
                        let _ = window.restore_state(StateFlags::all());

                        let _ = window.set_focus();

                        // Fade in over the normal duration.
                        let (gen, fade_gen) = {
                            let state = app_handle.state::<crate::window::WindowManager>();
                            (
                                state.fade_gen.next(),
                                std::sync::Arc::clone(&state.fade_gen),
                            )
                        };
                        crate::window::spawn_ramp(window, fade_gen, gen, 1.0);
                        log::info!("Main window reopened from dock");
                    }
                }
            }

            // macOS: a document the App was asked to open — i.e. a
            // double-clicked .pnds bundle (v1.2.0, issue #16). Queue it and
            // wake the frontend; the frontend drains the queue both on this
            // event and once at mount, so a cold start (listener not yet
            // registered) races safely.
            #[cfg(target_os = "macos")]
            RunEvent::Opened { urls } => {
                for url in urls {
                    let Ok(path) = url.to_file_path() else {
                        continue;
                    };
                    let is_bundle = path
                        .extension()
                        .and_then(|ext| ext.to_str())
                        .is_some_and(|ext| ext.eq_ignore_ascii_case("pnds"));
                    if is_bundle {
                        log::info!("Bundle open requested: {}", path.display());
                        commands::bundle::record_pending_bundle_open(app_handle, &path);
                    }
                }
            }

            // Cleanup on actual exit (Cmd+Q, menu Quit, or window close on non-macOS).
            // macOS ⌘Q terminates via NSApp: tao destroys the windows, which
            // emits ExitRequested and sets ControlFlow::Exit — RunEvent::Exit
            // is NOT guaranteed on that path (observed: orphans left behind
            // after ⌘Q). Clean up in ExitRequested (sync, before the loop
            // ends) AND keep Exit as a belt-and-braces fallback.
            RunEvent::ExitRequested { .. } => {
                log::info!("Application exit requested — performing cleanup");
                {
                    let session = app_handle.state::<crate::project::session::SessionManager>();
                    if session.has_active_session() {
                        if let Ok(dir) = commands::project::app_data_dir(app_handle) {
                            if let Err(e) = session.stop(app_handle, &dir) {
                                log::warn!("Failed to stop score server on exit: {e}");
                            }
                        }
                    }
                }
                log::info!("Cleanup complete");
            }
            RunEvent::Exit => {
                log::info!("Application exiting — performing cleanup");

                // never leave an orphaned score server behind.
                {
                    let session = app_handle.state::<crate::project::session::SessionManager>();
                    if session.has_active_session() {
                        if let Ok(dir) = commands::project::app_data_dir(app_handle) {
                            if let Err(e) = session.stop(app_handle, &dir) {
                                log::warn!("Failed to stop score server on exit: {e}");
                            }
                        }
                    }
                }

                log::info!("Cleanup complete");
            }

            _ => {}
        });
}
