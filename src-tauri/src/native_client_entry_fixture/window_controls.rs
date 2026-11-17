//! Explicit owned-window verification of the production AppKit chrome path.
use super::*;
use objc2::{msg_send, rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSButton, NSView, NSWindow, NSWindowButton};
use objc2_foundation::{NSPoint, NSRect};
use std::ffi::c_void;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightPostEventAccess() -> bool;
    fn CGEventCreateMouseEvent(
        source: *const c_void,
        kind: u32,
        point: NSPoint,
        button: u32,
    ) -> *const c_void;
    fn CGEventPost(tap: u32, event: *const c_void);
    fn CGWarpMouseCursorPosition(point: NSPoint) -> i32;
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(object: *const c_void);
}

async fn ui<T: Send + 'static>(
    app: &AppHandle,
    task: impl FnOnce(&tauri::WebviewWindow) -> T + Send + 'static,
) -> T {
    let window = app.get_webview_window("main").unwrap();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(task(&window));
    })
    .unwrap();
    rx.await.unwrap()
}
unsafe fn native(window: &tauri::WebviewWindow) -> &NSWindow {
    &*window.ns_window().unwrap().cast::<NSWindow>()
}
unsafe fn button(window: &tauri::WebviewWindow, kind: NSWindowButton) -> Retained<NSButton> {
    crate::window::fixture_main_control(native(window), kind).unwrap()
}
unsafe fn center(button: &NSButton) -> NSPoint {
    msg_send![button, convertPoint: NSPoint::new(button.bounds().size.width / 2.0, button.bounds().size.height / 2.0), toView: std::ptr::null::<NSView>()]
}
unsafe fn screen(window: &NSWindow, point: NSPoint) -> NSPoint {
    use objc2::runtime::AnyClass;
    let screens: Retained<AnyObject> = msg_send![AnyClass::get(c"NSScreen").unwrap(), screens];
    let primary: Retained<AnyObject> = msg_send![&*screens, firstObject];
    let bounds: NSRect = msg_send![&*primary, frame];
    let point: NSPoint = msg_send![window, convertPointToScreen: point];
    NSPoint::new(point.x, bounds.size.height - point.y)
}
unsafe fn mouse(kind: u32, point: NSPoint) {
    CGWarpMouseCursorPosition(point);
    let event = CGEventCreateMouseEvent(std::ptr::null(), kind, point, 0);
    assert!(!event.is_null());
    CGEventPost(0, event);
    CFRelease(event);
}
unsafe fn cursor() -> NSPoint {
    use objc2::runtime::AnyClass;
    let point: NSPoint = msg_send![AnyClass::get(c"NSEvent").unwrap(), mouseLocation];
    let screens: Retained<AnyObject> = msg_send![AnyClass::get(c"NSScreen").unwrap(), screens];
    let primary: Retained<AnyObject> = msg_send![&*screens, firstObject];
    let bounds: NSRect = msg_send![&*primary, frame];
    NSPoint::new(point.x, bounds.size.height - point.y)
}
unsafe fn pixels(button: &NSButton, path: &Path) -> Vec<u8> {
    let bitmap: Retained<AnyObject> =
        msg_send![button, bitmapImageRepForCachingDisplayInRect: button.bounds()];
    let _: () = msg_send![button, cacheDisplayInRect: button.bounds(), toBitmapImageRep: &*bitmap];
    let pointer: *const u8 = msg_send![&*bitmap, bitmapData];
    let rows: usize = msg_send![&*bitmap, pixelsHigh];
    let stride: usize = msg_send![&*bitmap, bytesPerRow];
    let properties = objc2_foundation::NSDictionary::<objc2_foundation::NSString, AnyObject>::new();
    let png: Retained<objc2_foundation::NSData> =
        msg_send![&*bitmap, representationUsingType: 4_usize, properties: &*properties];
    let png_bytes: *const u8 = msg_send![&*png, bytes];
    std::fs::write(path, std::slice::from_raw_parts(png_bytes, png.length())).unwrap();
    std::slice::from_raw_parts(pointer, rows * stride).to_vec()
}
async fn snapshot(app: &AppHandle) -> Value {
    ui(app, |window| unsafe {
        let native = native(window);
        let values: Vec<_> = [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton].into_iter().map(|kind| {
            let current = button(window, kind);
            let original = native.standardWindowButton(kind);
            let target: *const AnyObject = msg_send![&*current, target];
            let action: Option<objc2::runtime::Sel> = msg_send![&*current, action];
            let mut parents=Vec::new();let mut parent=current.superview();
            while let Some(view)=parent {parents.push(view.class().name().to_string_lossy().into_owned());parent=view.superview();}
            let point=center(&current);
            json!({"native":original.as_ref().is_some_and(|original|Retained::as_ptr(original)==Retained::as_ptr(&current)),"targetIsWindow":target==native as *const NSWindow as *const AnyObject,"action":action.map(|value|value.name().to_string_lossy().into_owned()),"parents":parents,"hidden":current.isHiddenOrHasHiddenAncestor(),"alpha":current.alphaValue(),"point":[point.x,point.y]})
        }).collect();
        json!({"fullscreen":window.is_fullscreen().unwrap(),"titled":native.styleMask().contains(objc2_app_kit::NSWindowStyleMask::Titled),"controls":values})
    }).await
}
fn original(state: &Value) {
    for control in state["controls"].as_array().unwrap() {
        assert_eq!(control["native"], true, "{state}");
        assert_eq!(control["targetIsWindow"], true, "{state}");
        assert_eq!(control["hidden"], false, "{state}");
        assert!(
            control["parents"]
                .as_array()
                .unwrap()
                .iter()
                .any(|name| name == "NSTitlebarView"),
            "{state}"
        );
    }
}
async fn blank_hit(app: &AppHandle) -> Value {
    let window = app.get_webview_window("main").unwrap();
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |webview| unsafe {
            let shell = &*webview.inner().cast::<NSView>();
            let native: Retained<NSWindow> = msg_send![shell, window];
            let content = native.contentView().unwrap();
            let root = content.superview().unwrap();
            let point = NSPoint::new(140.0, content.bounds().size.height - 16.0);
            let hit: Option<Retained<NSView>> = msg_send![&*root, hitTest: point];
            let descendant = hit.as_ref().is_some_and(|view| view.isDescendantOf(shell));
            let class = hit
                .map(|view| view.class().name().to_string_lossy().into_owned())
                .unwrap_or_else(|| "nil".into());
            let _ = tx.send(json!({"shellDescendant":descendant,"class":class}));
        })
        .unwrap();
    rx.await.unwrap()
}
async fn exercise(app: AppHandle, directory: PathBuf) -> Value {
    tokio::time::sleep(Duration::from_millis(500)).await;
    let allowed = ui(&app, |_| unsafe { CGPreflightPostEventAccess() }).await;
    assert!(allowed,"Explicit native input fixture requires existing event-posting permission; it never requests system permission");
    let mut themes = Vec::new();
    for name in ["pond", "sand", "stage"] {
        crate::window::set_window_corners_square(app.clone(), false)
            .await
            .unwrap();
        crate::window::set_main_controls_visible(app.clone(), true, 0.0, 1.0, 34.0)
            .await
            .unwrap();
        let state = snapshot(&app).await;
        original(&state);
        themes.push(json!({"theme":name,"state":state}));
    }
    let away = ui(&app, |window| unsafe {
        screen(native(window), NSPoint::new(400.0, 200.0))
    })
    .await;
    ui(&app, move |_| unsafe { mouse(5, away) }).await;
    tokio::time::sleep(Duration::from_millis(250)).await;
    let normal_path = directory.join("close-normal.png");
    let normal = ui(&app, move |window| unsafe {
        pixels(&button(window, NSWindowButton::CloseButton), &normal_path)
    })
    .await;
    let over = ui(&app, |window| unsafe {
        screen(
            native(window),
            center(&button(window, NSWindowButton::CloseButton)),
        )
    })
    .await;
    ui(&app, move |_| unsafe { mouse(5, over) }).await;
    tokio::time::sleep(Duration::from_millis(250)).await;
    let hover_path = directory.join("close-hover.png");
    let hover = ui(&app, move |window| unsafe {
        pixels(&button(window, NSWindowButton::CloseButton), &hover_path)
    })
    .await;
    let changed = normal.iter().zip(&hover).filter(|(a, b)| a != b).count();
    assert!(
        changed > 20,
        "Actual native close hover did not reveal its glyph: {changed} changed bytes"
    );
    let mini = ui(&app, |window| unsafe {
        screen(
            native(window),
            center(&button(window, NSWindowButton::MiniaturizeButton)),
        )
    })
    .await;
    unsafe {
        mouse(5, mini);
        mouse(1, mini);
    }
    tokio::time::sleep(Duration::from_millis(80)).await;
    unsafe {
        mouse(2, mini);
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        ui(&app, |window| window.is_minimized().unwrap()).await,
        "Native miniaturize click did not reach its system action"
    );
    ui(&app, |window| {
        window.unminimize().unwrap();
        window.set_focus().unwrap();
    })
    .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    crate::window::set_main_controls_visible(app.clone(), true, -10.0, 0.5, 16.0)
        .await
        .unwrap();
    let moved = snapshot(&app).await;
    original(&moved);
    assert!(
        moved["controls"]
            .as_array()
            .unwrap()
            .iter()
            .all(|control| control["alpha"].as_f64() == Some(0.5)),
        "{moved}"
    );
    crate::window::set_main_controls_visible(app.clone(), false, -20.0, 0.0, 34.0)
        .await
        .unwrap();
    let hidden = snapshot(&app).await;
    assert!(
        hidden["controls"]
            .as_array()
            .unwrap()
            .iter()
            .all(|control| control["hidden"] == true),
        "{hidden}"
    );
    crate::window::set_main_controls_visible(app.clone(), true, 0.0, 1.0, 34.0)
        .await
        .unwrap();
    ui(&app, |window| {
        window
            .set_size(tauri::LogicalSize::new(950.0, 650.0))
            .unwrap();
        crate::window::sync_main_control_position(window);
    })
    .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let resized = snapshot(&app).await;
    original(&resized);
    let blank_hit = blank_hit(&app).await;
    assert_eq!(
        blank_hit["shellDescendant"], true,
        "Empty chrome blocked actual WK content: {blank_hit}"
    );
    crate::window::set_window_corners_square(app.clone(), true)
        .await
        .unwrap();
    let brutal = snapshot(&app).await;
    assert_eq!(
        brutal["titled"], false,
        "Brutal must retain its real rectangular frame: {brutal}"
    );
    crate::window::set_window_corners_square(app.clone(), false)
        .await
        .unwrap();
    let restored = snapshot(&app).await;
    original(&restored);
    ui(&app, |window| window.set_fullscreen(true).unwrap()).await;
    tokio::time::sleep(Duration::from_millis(900)).await;
    let fullscreen = snapshot(&app).await;
    assert_eq!(fullscreen["fullscreen"], true, "{fullscreen}");
    assert!(
        fullscreen["controls"]
            .as_array()
            .unwrap()
            .iter()
            .all(|control| control["native"] == true),
        "Fullscreen must use actual system controls: {fullscreen}"
    );
    ui(&app, |window| window.set_fullscreen(false).unwrap()).await;
    tokio::time::sleep(Duration::from_millis(900)).await;
    crate::window::set_window_corners_square(app.clone(), false)
        .await
        .unwrap();
    crate::window::set_main_controls_visible(app.clone(), true, 0.0, 1.0, 34.0)
        .await
        .unwrap();
    let returned = snapshot(&app).await;
    original(&returned);
    ui(&app, move |_| unsafe { mouse(5, away) }).await;
    json!({"result":"passed","themes":themes,"hoverChangedBytes":changed,"nativeMinimizeClick":true,"moved":moved,"hidden":hidden,"resized":resized,"blankHit":blank_hit,"brutal":brutal,"restored":restored,"fullscreen":fullscreen,"returned":returned,"limits":["single executing macOS","green target/action preserved; visual menu must be observed separately"]})
}

pub(super) fn run(directory: PathBuf) {
    std::fs::create_dir_all(&directory).unwrap();
    let mut context = crate::app_context();
    let mut config = context.config().app.windows[0].clone();
    config.url = tauri::WebviewUrl::External("about:blank".parse().unwrap());
    context.config_mut().app.windows.clear();
    context.config_mut().build.dev_url = None;
    context.config_mut().identifier =
        format!("com.pnds.window-controls-fixture.{}", std::process::id());
    let app = tauri::Builder::default()
        .manage(crate::window::WindowManager::default())
        .setup(move |app| {
            app.set_activation_policy(tauri::ActivationPolicy::Regular);
            let window = tauri::WebviewWindowBuilder::from_config(app, &config)?
                .title("PNDS native controls fixture")
                .visible(true)
                .build()?;
            crate::window::configure_main_chrome(&window);
            crate::window::sync_corner_radius(&window, false);
            window.set_focus()?;
            unsafe {
                use objc2::runtime::{AnyClass, Bool};
                let application: Retained<AnyObject> =
                    msg_send![AnyClass::get(c"NSApplication").unwrap(), sharedApplication];
                let _: () = msg_send![&*application,activateIgnoringOtherApps:Bool::YES];
                let _: () =
                    msg_send![native(&window),makeKeyAndOrderFront:std::ptr::null::<AnyObject>()];
            }
            let original_cursor = unsafe { cursor() };
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let test_app = handle.clone();
                let output = directory.clone();
                let result = tokio::spawn(async move { exercise(test_app, output).await }).await;
                ui(&handle, move |_| unsafe { mouse(5, original_cursor) }).await;
                match result {
                    Ok(report) => {
                        std::fs::write(
                            directory.join("result.json"),
                            serde_json::to_vec_pretty(&report).unwrap(),
                        )
                        .unwrap();
                        println!("{report}");
                        EXIT_CODE.store(0, std::sync::atomic::Ordering::Release);
                        handle.exit(0);
                    }
                    Err(error) => {
                        eprintln!("Native controls fixture failed: {error}");
                        EXIT_CODE.store(1, std::sync::atomic::Ordering::Release);
                        handle.exit(1);
                    }
                }
            });
            Ok(())
        })
        .build(context)
        .expect("Owned window-controls fixture");
    app.run(|handle, event| {
        if let tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Resized(_),
            ..
        } = event
        {
            if label == "main" {
                if let Some(window) = handle.get_webview_window("main") {
                    crate::window::sync_main_control_position(&window);
                }
            }
        }
    });
    std::process::exit(EXIT_CODE.load(std::sync::atomic::Ordering::Acquire));
}
