mod window_hook;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
#[derive(Default)]
struct Counts {
    menu: AtomicUsize,
    preflight: AtomicUsize,
}
use serde_json::{json, Value};

// Observe calls to the original WK implementation after the verbatim production
// hook is installed. This wrapper forwards the same receiver/event/signature;
// selection and modifier matching remain exclusively in the production hook.
static ORIGINAL_WK_IMP: AtomicUsize = AtomicUsize::new(0);
static ORIGINAL_WK_ROUTES: AtomicUsize = AtomicUsize::new(0);
unsafe extern "C-unwind" fn observe_original_wk_route(
    this: &objc2::runtime::AnyObject,
    command: objc2::runtime::Sel,
    event: *mut objc2::runtime::AnyObject,
) -> objc2::runtime::Bool {
    ORIGINAL_WK_ROUTES.fetch_add(1, Ordering::Relaxed);
    let address = ORIGINAL_WK_IMP.load(Ordering::Relaxed);
    // SAFETY: the saved IMP implements this exact performKeyEquivalent signature.
    let original: unsafe extern "C-unwind" fn(
        &objc2::runtime::AnyObject,
        objc2::runtime::Sel,
        *mut objc2::runtime::AnyObject,
    ) -> objc2::runtime::Bool = unsafe { std::mem::transmute(address) };
    // SAFETY: AppKit supplies the live receiver/event; the original owns routing.
    unsafe { original(this, command, event) }
}

fn observe_original_wk_routes() {
    use objc2::ffi::{class_getInstanceMethod, method_setImplementation};
    use objc2::runtime::{AnyClass, Imp};
    // SAFETY: fixture setup runs once on the main thread after hook installation.
    unsafe {
        let class = AnyClass::get(c"WKWebView").unwrap();
        let method = class_getInstanceMethod(class, objc2::sel!(pndsPerformKeyEquivalent:));
        assert!(
            !method.is_null(),
            "Fixture requires WK's original implementation"
        );
        let observer: unsafe extern "C-unwind" fn(
            &objc2::runtime::AnyObject,
            objc2::runtime::Sel,
            *mut objc2::runtime::AnyObject,
        ) -> objc2::runtime::Bool = observe_original_wk_route;
        let imp: Imp = std::mem::transmute(observer);
        let original = method_setImplementation(method, imp).expect("Original WK method missing");
        ORIGINAL_WK_IMP.store(original as usize, Ordering::Relaxed);
    }
}
#[tauri::command]
fn focused_window_label(app: AppHandle) -> String {
    app.webview_windows()
        .into_iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .map(|(l, _)| l)
        .unwrap_or_else(|| "main".into())
}
#[tauri::command]
fn preflight_project(app: AppHandle, path: String) -> Value {
    app.state::<Counts>()
        .preflight
        .fetch_add(1, Ordering::Relaxed);
    println!("[PNDS-native-selection-fixture] preflight {path}");
    json!({"schemaVersion":1,"id":"native-fixture","name":"Native fixture","version":"1.0.0","description":null,"scoreServer":{"entry":"server.js","workingDirectory":".","performerPort":6868,"monitorPort":6869},"audio":{"defaultMode":"none","supportedModes":["none"],"synthdefs":[],"scsynth":{"sampleRate":48000,"blockSize":64,"audioBusChannels":128},"standaloneTarget":null}})
}
// Controlled runtime replies allow the actual frontend mode workflow to run;
// no runtime or score process is created by this fixture.
fn idle_creation_runtime() -> Value {
    json!({"generation":"0","projectRoot":null,"snapshot":{"status":"idle","projectPath":null,"projectName":null,"audioMode":null,"lanIp":null,"hostAddress":null,"oscTarget":null,"health":null,"error":null,"outputTail":[],"volume":80,"startupStage":0,"channelPlan":null,"outputDevice":null,"projectionStarted":false,"httpsEntry":{"status":"off","url":null,"error":null},"dnsMapping":{"status":"off","domain":null,"ip":null,"error":null}}})
}
#[tauri::command]
fn get_creation_runtime() -> Value {
    idle_creation_runtime()
}
#[tauri::command]
fn prepare_creation_project(path: String) -> Value {
    json!({"project":{"identity":"fixture-workspace","root":path,"name":"Native fixture","source":"folder"},"files":[]})
}
#[tauri::command]
fn commit_creation_project() -> Value {
    idle_creation_runtime()
}
#[tauri::command]
fn close_creation_project() {}
#[tauri::command]
fn close_creation_projection() {}
#[tauri::command]
fn load_preferences() -> Value {
    json!({})
}
#[tauri::command]
fn save_preferences() {}
#[tauri::command]
fn list_lan_addresses() -> Value {
    json!(["127.0.0.1"])
}
#[tauri::command]
async fn probe_native_route(
    app: AppHandle,
    direct: bool,
    label: String,
    key_code: u16,
    flags: usize,
) -> Result<(), String> {
    let handle = app.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        use objc2::{msg_send, runtime::AnyObject};
        use objc2_app_kit::NSApplication;
        use objc2_foundation::{MainThreadMarker, NSString};
        let mtm = MainThreadMarker::new().unwrap();
        let nsapp = NSApplication::sharedApplication(mtm);
        let window = handle.get_webview_window(&label).unwrap().ns_window().unwrap().cast::<AnyObject>();
        let code = NSString::from_str(match key_code {
            126 => "\u{f700}",
            125 => "\u{f701}",
            123 => "\u{f702}",
            124 => "\u{f703}",
            _ => "x",
        });
        // SAFETY: all objects are owned by this isolated fixture and this closure
        // runs on AppKit's main thread. No events are posted to the OS input stream.
        unsafe {
            let number: isize = msg_send![window, windowNumber];
            let event: *mut AnyObject = msg_send![
                objc2::class!(NSEvent),
                keyEventWithType: 10usize,
                location: objc2_foundation::NSPoint::new(0.0, 0.0),
                modifierFlags: flags,
                timestamp: objc2_foundation::NSProcessInfo::processInfo().systemUptime(),
                windowNumber: number,
                context: std::ptr::null::<AnyObject>(),
                characters: &*code,
                charactersIgnoringModifiers: &*code,
                isARepeat: false,
                keyCode: key_code
            ];
            let key: *mut AnyObject = msg_send![&*nsapp, keyWindow];
            let is_key: bool = msg_send![window, isKeyWindow];
            let active: bool = msg_send![&*nsapp, isActive];
            let event_window: *mut AnyObject = msg_send![event, window];
            println!(
                "[PNDS-native-selection-fixture] environment active={active} is-key={is_key} key-matches={} event-window-matches={}",
                key == window, event_window == window
            );
            if !active || !is_key || key != window || event_window != window {
                let _ = tx.send(Err("Invalid active/key/event window".to_string()));
                return;
            }
            let responder: *mut AnyObject = msg_send![window, firstResponder];
            let class: *mut AnyObject = msg_send![responder, class];
            let name: *mut AnyObject = msg_send![class, description];
            let text: &NSString = &*name.cast();
            println!(
                "[PNDS-native-selection-fixture] route direct={direct} responder={} flags={flags} key={key_code}",
                text.to_string()
            );
            if direct {
                let menu = nsapp.mainMenu().unwrap();
                let hit: bool = msg_send![&*menu, performKeyEquivalent: event];
                println!("[PNDS-native-selection-fixture] direct-menu matched={hit}");
            } else {
                let _: () = msg_send![&*nsapp, sendEvent: event];
            }
        }
        let _ = tx.send(Ok(()));
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}
#[tauri::command]
fn finish_probe(app: AppHandle, success: bool, evidence: Value) {
    println!("[PNDS-native-selection-fixture] evidence={evidence}");
    app.exit(if success { 0 } else { 1 });
}

#[tauri::command]
fn fixture_counts(app: AppHandle) -> Value {
    let counts = app.state::<Counts>();
    json!({"menu":counts.menu.load(Ordering::Relaxed),"preflight":counts.preflight.load(Ordering::Relaxed),"original":ORIGINAL_WK_ROUTES.load(Ordering::Relaxed)})
}
#[tauri::command]
fn prepare_fixture_window(app: AppHandle, label: String) -> Result<(), String> {
    let window = match app.get_webview_window(&label) {
        Some(window) => window,
        None => WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
            .title(format!("PNDS native selection fixture: {label}"))
            .inner_size(640.0, 400.0)
            .data_directory(std::env::temp_dir().join(format!(
                "pnds-native-selection-{}-{label}",
                std::process::id()
            )))
            .build()
            .map_err(|e| e.to_string())?,
    };
    window.set_focus().map_err(|e| e.to_string())?;
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let mtm = objc2_foundation::MainThreadMarker::new().unwrap();
        let window = handle.get_webview_window(&label).unwrap();
        unsafe {
            let native = window.ns_window().unwrap().cast::<objc2::runtime::AnyObject>();
            let _: () = objc2::msg_send![native, makeKeyAndOrderFront: std::ptr::null::<objc2::runtime::AnyObject>()];
        }
        objc2_app_kit::NSApplication::sharedApplication(mtm).activate();
        let _ = window.eval("document.body.focus()");
    })
    .map_err(|e| e.to_string())
}
#[tauri::command]
fn set_fixture_menu_enabled(
    app: AppHandle,
    enabled: bool,
    matching: bool,
    parent_disabled: bool,
) -> Result<(), String> {
    let menu = app.menu().ok_or("Menu missing")?;
    let mut items = menu.items().map_err(|error| error.to_string())?;
    let mut found = 0;
    while let Some(item) = items.pop() {
        if let Some(submenu) = item.as_submenu() {
            let children = submenu.items().map_err(|error| error.to_string())?;
            if children
                .iter()
                .any(|child| child.id().as_ref() == "select-previous-project")
            {
                submenu
                    .set_enabled(!parent_disabled)
                    .map_err(|error| error.to_string())?;
            }
            items.extend(children);
        }
        let id = item.id().as_ref();
        if matches!(id, "select-previous-project" | "select-next-project") {
            let accelerator = if !matching {
                "Cmd+Alt+J"
            } else if id == "select-previous-project" {
                "Cmd+Alt+ArrowUp"
            } else {
                "Cmd+Alt+ArrowDown"
            };
            let selection = item.as_menuitem().ok_or("Wrong menu item kind")?;
            selection
                .set_enabled(enabled)
                .map_err(|error| error.to_string())?;
            selection
                .set_accelerator(Some(accelerator))
                .map_err(|error| error.to_string())?;
            found += 1;
        }
    }
    if found == 2 {
        Ok(())
    } else {
        Err("Selection items missing".into())
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Counts::default())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            focused_window_label,
            preflight_project,
            get_creation_runtime,
            prepare_creation_project,
            commit_creation_project,
            close_creation_project,
            close_creation_projection,
            load_preferences,
            save_preferences,
            list_lan_addresses,
            probe_native_route,
            finish_probe,
            fixture_counts,
            window_hook::set_main_performance_key_owner,
            prepare_fixture_window,
            set_fixture_menu_enabled
        ])
        .on_menu_event(|app, event| {
            if matches!(
                event.id().as_ref(),
                "select-previous-project" | "select-next-project"
            ) {
                app.state::<Counts>().menu.fetch_add(1, Ordering::Relaxed);
            }
        })
        .setup(|app| {
            window_hook::install_cmd_arrow_webview_passthrough(app.handle());
            observe_original_wk_routes();
            let window = app.get_webview_window("main").unwrap();
            window.set_focus()?;
            let mtm = objc2_foundation::MainThreadMarker::new().unwrap();
            objc2_app_kit::NSApplication::sharedApplication(mtm).activate();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("native route fixture");
}
