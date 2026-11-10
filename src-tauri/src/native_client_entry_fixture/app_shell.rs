//! Opt-in real AppShell frontend, real command start and native monitor paint.
use super::*;
use crate::project_media_view;
use std::borrow::Cow;
use std::collections::BTreeMap;
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};

struct Frontend(BTreeMap<String, Vec<u8>>);
impl tauri::Assets<tauri::Wry> for Frontend {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        self.0
            .get(key.as_ref().trim_start_matches('/'))
            .map(|bytes| Cow::Borrowed(bytes.as_slice()))
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(
            self.0
                .iter()
                .map(|(key, bytes)| (Cow::Borrowed(key.as_str()), Cow::Borrowed(bytes.as_slice()))),
        )
    }
    fn csp_hashes(&self, _: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}
fn files(root: &Path, path: &Path, output: &mut BTreeMap<String, Vec<u8>>) {
    for entry in std::fs::read_dir(path).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            files(root, &path, output);
        } else {
            output.insert(
                path.strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                std::fs::read(path).unwrap(),
            );
        }
    }
}
async fn probe(app: &AppHandle) -> Value {
    let mut probe=project_media_view::fixture_shell_evaluate(app.clone(),"main","JSON.stringify(globalThis.fixtureProbe?.() || {phase:globalThis.fixtureState,errors:globalThis.fixtureErrors,url:location.href,html:document.documentElement.outerHTML.slice(0,300)})").await.unwrap();
    probe["nativeForeground"] = window_state(app, false).await;
    probe
}

async fn controls(app: &AppHandle) -> Value {
    let window = app.get_webview_window("main").unwrap();
    let (tx, rx) = tokio::sync::oneshot::channel();
    window.with_webview(move |webview| unsafe {
        use objc2::{msg_send, runtime::AnyObject};
        use objc2_app_kit::{NSView, NSWindow};
        use objc2_foundation::NSRect;
        let shell = &*webview.inner().cast::<NSView>();
        let native: objc2::rc::Retained<NSWindow> = msg_send![shell, window];
        let content = native.contentView().unwrap();
        let titlebar = content.subviews().iter().find(|view| {
            let view: &AnyObject = view;
            view.class().name() == c"PNDSSquareControlsView"
        }).expect("Real content-owned controls are missing");
        let buttons: Vec<_> = titlebar.subviews().iter().map(|button| {
            let rect: NSRect = msg_send![&*button, convertRect: button.bounds(), toView: shell];
            let x = rect.origin.x + rect.size.width / 2.0;
            let y = rect.origin.y + rect.size.height / 2.0;
            let y = if shell.isFlipped() { y } else { shell.bounds().size.height - y };
            let object: &AnyObject = &button;
            json!({"point":[x,y],"hidden":button.isHiddenOrHasHiddenAncestor(),"alpha":button.alphaValue(),"class":object.class().name().to_string_lossy()})
        }).collect();
        let _ = tx.send(json!(buttons));
    }).unwrap();
    rx.await.unwrap()
}

fn green(paint: &Value) {
    for sample in paint["samples"].as_array().unwrap() {
        let rgb = &sample["rgb"];
        assert!(
            rgb[1].as_f64().unwrap() - rgb[0].as_f64().unwrap() > 0.25,
            "Real AppShell revealed a white/blank stage instead of its loaded green score: {paint}"
        );
    }
}

async fn shell_z(app: &AppHandle) -> f64 {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.get_webview_window("main")
        .unwrap()
        .with_webview(move |webview| unsafe {
            use objc2::{msg_send, rc::Retained, runtime::AnyObject};
            let view = &*webview.inner().cast::<AnyObject>();
            let layer: Retained<AnyObject> = msg_send![view, layer];
            let z: f64 = msg_send![&*layer, zPosition];
            let _ = tx.send(z);
        })
        .unwrap();
    rx.await.unwrap()
}

async fn window_state(app: &AppHandle, activate: bool) -> Value {
    let window = app.get_webview_window("main").unwrap();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || unsafe {
        use objc2::{
            msg_send,
            rc::Retained,
            runtime::{AnyClass, AnyObject, Bool},
        };
        let application: Retained<AnyObject> =
            msg_send![AnyClass::get(c"NSApplication").unwrap(), sharedApplication];
        let native = window.ns_window().unwrap().cast::<AnyObject>();
        if activate {
            let _: () = msg_send![&*application, activateIgnoringOtherApps: Bool::YES];
            let _: () = msg_send![native, makeKeyAndOrderFront: std::ptr::null::<AnyObject>()];
            let _: () = msg_send![native, orderFrontRegardless];
        }
        let active: Bool = msg_send![&*application, isActive];
        let key: Bool = msg_send![native, isKeyWindow];
        let _ = tx.send(json!({"appActive":active.as_bool(),"keyWindow":key.as_bool()}));
    })
    .unwrap();
    rx.await.unwrap()
}
async fn exercise(app: AppHandle, directory: PathBuf) -> Value {
    let deadline = Instant::now() + Duration::from_secs(25);
    loop {
        let state = probe(&app).await;
        assert_ne!(state["phase"], "failed", "{state}");
        if state["phase"] == "load-ready" {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "AppShell did not become loadable: {state}"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    // Activation requested in setup can precede NSApp.run. Require the actual
    // foreground state from the running native loop before pressing Load.
    let deadline = Instant::now() + Duration::from_secs(3);
    let foreground = loop {
        let state = window_state(&app, true).await;
        if state["appActive"] == true && state["keyWindow"] == true {
            break state;
        }
        assert!(
            Instant::now() < deadline,
            "Real AppShell fixture could not acquire foreground: {state}"
        );
        tokio::time::sleep(Duration::from_millis(30)).await;
    };
    let original_shell_z = shell_z(&app).await;
    project_media_view::fixture_shell_evaluate(
        app.clone(),
        "main",
        "globalThis.fixtureStart();JSON.stringify(true)",
    )
    .await
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut focus_recoveries = 0;
    let frontend = loop {
        // Other desktop applications can regain focus after activation. This
        // foreground-only reveal check maintains its native precondition; it
        // never runs during the later intentional minimize/restore exercises.
        let state = window_state(&app, false).await;
        if state["appActive"] != true || state["keyWindow"] != true {
            focus_recoveries += 1;
            window_state(&app, true).await;
        }
        let state = probe(&app).await;
        assert_ne!(state["phase"], "failed", "{state}");
        if state["phase"] == "monitor-revealed" {
            break state;
        }
        assert!(
            Instant::now() < deadline,
            "AppShell monitor did not reveal: {state}"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    };
    assert_eq!(frontend["loaded"], true, "{frontend}");
    assert_eq!(frontend["timeout"], false, "{frontend}");
    assert_eq!(frontend["errors"], json!([]), "{frontend}");
    assert!(frontend["rootFrames"].as_u64().unwrap() > 0, "{frontend}");
    let native=project_media_view::fixture_evaluate(app.clone(),"main".into(),"JSON.stringify({url:location.href,ready:document.readyState,color:getComputedStyle(document.getElementById('fixture-solid-score')).backgroundColor})").await.unwrap();
    let painted = project_media_view::fixture::capture(
        app.clone(),
        "main",
        directory.join("actual-app-shell-monitor.png"),
        vec![(400.0, 300.0), (700.0, 400.0)],
    )
    .await
    .unwrap();
    let mut report = json!({"result":"observed","foreground":foreground,"focusRecoveries":focus_recoveries,"frontend":frontend,"native":native,"paint":painted,"snapshot":app.state::<SessionManager>().snapshot()});
    std::fs::write(
        directory.join("actual-app-shell-proof.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    green(&report["paint"]);
    let window = app.get_webview_window("main").unwrap();
    window.set_focus().unwrap();
    let mut themes = Vec::new();
    for theme in ["pond", "sand", "brutal"] {
        project_media_view::fixture_shell_evaluate(
            app.clone(),
            "main",
            &format!("void globalThis.fixtureTheme('{theme}');JSON.stringify(true)"),
        )
        .await
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while project_media_view::fixture_shell_evaluate(
            app.clone(),
            "main",
            "JSON.stringify(document.documentElement.dataset.colorTheme)",
        )
        .await
        .unwrap()
            != theme
        {
            assert!(
                Instant::now() < deadline,
                "Native/CSS theme handoff did not complete"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        project_media_view::fixture_shell_evaluate(
            app.clone(),
            "main",
            "globalThis.fixtureSidebar(true);JSON.stringify(true)",
        )
        .await
        .unwrap();
        tokio::time::sleep(Duration::from_millis(350)).await;
        let buttons = controls(&app).await;
        assert_eq!(buttons.as_array().unwrap().len(), 3, "{buttons}");
        let points: Vec<_> = buttons
            .as_array()
            .unwrap()
            .iter()
            .take(2)
            .map(|button| {
                assert_eq!(button["hidden"], false, "{buttons}");
                (
                    button["point"][0].as_f64().unwrap(),
                    button["point"][1].as_f64().unwrap(),
                )
            })
            .collect();
        let paint = project_media_view::fixture::capture(
            app.clone(),
            "main",
            directory.join(format!("actual-app-shell-{theme}-sidebar.png")),
            vec![points[0], points[1], (700.0, 300.0)],
        )
        .await
        .unwrap();
        let close = &paint["samples"][0]["rgb"];
        let mini = &paint["samples"][1]["rgb"];
        assert!(
            close[0].as_f64().unwrap() - close[1].as_f64().unwrap() > 0.15,
            "Native close button was covered by the App sidebar: {paint}"
        );
        assert!(
            mini[0].as_f64().unwrap() - mini[2].as_f64().unwrap() > 0.15,
            "Native minimize button was covered by the App sidebar: {paint}"
        );
        green(&json!({"samples":[paint["samples"][2].clone()]}));
        let hit =
            project_media_view::fixture_click(app.clone(), "main".into(), points[1].0, points[1].1)
                .await
                .unwrap();
        assert_eq!(hit["hitNativePage"], false, "{hit}");
        assert_eq!(hit["hitClass"], buttons[1]["class"], "{hit} {buttons}");
        tokio::time::sleep(Duration::from_millis(250)).await;
        let minimized = window.is_minimized().unwrap();
        if theme != "brutal" {
            assert!(minimized, "Real native minimize did not fire: {hit}");
        }
        if minimized {
            window.unminimize().unwrap();
            window.set_focus().unwrap();
            tokio::time::sleep(Duration::from_millis(250)).await;
            assert!(!window.is_minimized().unwrap());
        }
        themes.push(json!({"theme":theme,"buttons":buttons,"paint":paint,"minimizeHit":hit,"minimizeObserved":minimized}));
    }
    project_media_view::fixture_shell_evaluate(
        app.clone(),
        "main",
        "globalThis.fixtureSidebar(false);JSON.stringify(true)",
    )
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    let point=project_media_view::fixture_shell_evaluate(app.clone(),"main","JSON.stringify((()=>{const r=document.querySelector('[data-interface-kind]').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})())").await.unwrap();
    let popover_hit = project_media_view::fixture_click(
        app.clone(),
        "main".into(),
        point[0].as_f64().unwrap(),
        point[1].as_f64().unwrap(),
    )
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    let popup=project_media_view::fixture_shell_evaluate(app.clone(),"main","JSON.stringify({open:!!document.querySelector('.desktop-network-popover[data-state=open]'),errors:globalThis.fixtureErrors})").await.unwrap();
    assert_eq!(
        popup["open"], true,
        "Real footer native click did not open its popover: {popup} {popover_hit}"
    );
    assert_eq!(popup["errors"], json!([]));
    let popover_paint = project_media_view::fixture::capture(
        app.clone(),
        "main",
        directory.join("actual-app-shell-popover.png"),
        vec![(700.0, 200.0), (800.0, 350.0)],
    )
    .await
    .unwrap();
    green(&popover_paint);
    report["themes"] = json!(themes);
    report["popover"] = json!({"hit":popover_hit,"state":popup,"paint":popover_paint});
    report["result"] = json!("passed");
    app.state::<SessionManager>().stop(&app).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while project_media_view::fixture_evaluate(app.clone(), "main".into(), "JSON.stringify(true)")
        .await
        .is_ok()
    {
        assert!(
            Instant::now() < deadline,
            "Monitor did not close after Stop"
        );
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    let restored_shell_z = shell_z(&app).await;
    assert_eq!(
        restored_shell_z, original_shell_z,
        "Monitor leaked its shell paint order into the next Client/idle document"
    );
    report["shellOrder"] = json!({"beforeLoad":original_shell_z,"afterStop":restored_shell_z});
    report
}

pub(super) fn run(frontend: PathBuf) {
    let directory = std::fs::canonicalize(
        tempfile::Builder::new()
            .prefix("pnds-real-app-shell-")
            .tempdir()
            .unwrap()
            .keep(),
    )
    .unwrap();
    eprintln!("Native entry evidence directory: {}", directory.display());
    let root = directory.join("score");
    std::fs::create_dir_all(&root).unwrap();
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/native-project-media");
    for name in [
        "manifest.json",
        "package.json",
        "server.mjs",
        "index.html",
        "page.mjs",
        "analysis-worker.mjs",
        "locales.json",
    ] {
        std::fs::copy(source.join(name), root.join(name)).unwrap();
    }
    let html=std::fs::read_to_string(root.join("index.html")).unwrap().replace("</body>","<div id=fixture-solid-score style=\"position:fixed;inset:0;background:#00ff80;z-index:2147483647\"></div></body>");
    std::fs::write(root.join("index.html"), html).unwrap();
    let lan = crate::project::session::list_lan_addresses()
        .unwrap()
        .into_iter()
        .next()
        .unwrap();
    let configuration = json!({"project":root,"lan":lan});
    let mut assets = BTreeMap::new();
    files(&frontend, &frontend, &mut assets);
    let mut context = crate::app_context();
    let window_config = context.config().app.windows.first().unwrap().clone();
    context.config_mut().app.windows.clear();
    context.config_mut().build.dev_url = None;
    context.config_mut().identifier =
        format!("com.pnds.native-shell-fixture.{}", std::process::id());
    context.set_assets(Box::new(Frontend(assets)));
    let root = directory.clone();
    let builder = crate::bindings::generate_bindings();
    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PreferencesCache::for_test(AppPreferences {
            node_name: Some("AppShell fixture".into()),
            language: Some("en".into()),
            ..Default::default()
        }))
        .manage(SessionManager::default())
        .manage(crate::recording::RecordingManager::default())
        .manage(crate::window::WindowManager::default())
        .manage(crate::performer::VisibilityIntent::default())
        .manage(ClientCoordinator::default())
        .manage(ClientScoreView::default())
        .manage(crate::project_media_view::ProjectMediaViews::default())
        .manage(crate::commands::creation::CreationState::default())
        .manage(crate::commands::bundle::PendingBundleOpens::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            crate::events::events_builder().mount_events(app);
            *app.state::<crate::project_media_view::ProjectMediaViews>()
                .fixture_storage
                .lock()
                .unwrap() = Some(root.join("project-storage"));
            app.set_activation_policy(tauri::ActivationPolicy::Regular);
            let window = tauri::WebviewWindowBuilder::from_config(app, &window_config)?
                .title("PNDS real AppShell fixture")
                .visible(true)
                .initialization_script(format!("globalThis.__PNDS_SHELL_CONFIG__={configuration};"))
                .build()?;
            crate::window::configure_main_chrome(&window);
            crate::window::sync_corner_radius(&window, false);
            window.set_focus()?;
            // Match an actual foreground launch before LoadingScreen starts.
            unsafe {
                use objc2::{
                    msg_send,
                    rc::Retained,
                    runtime::{AnyClass, AnyObject, Bool},
                };
                let application: Retained<AnyObject> =
                    msg_send![AnyClass::get(c"NSApplication").unwrap(), sharedApplication];
                let _: () = msg_send![&*application, activateIgnoringOtherApps: Bool::YES];
                let native = window.ns_window()?.cast::<AnyObject>();
                let _: () = msg_send![native, makeKeyAndOrderFront: std::ptr::null::<AnyObject>()];
                let _: () = msg_send![native, orderFrontRegardless];
            }
            let app = app.handle().clone();
            let evidence = root.clone();
            tauri::async_runtime::spawn(async move {
                let worker_app = app.clone();
                let worker_dir = evidence.clone();
                let result =
                    tokio::spawn(async move { exercise(worker_app, worker_dir).await }).await;
                if let Err(error) = app.state::<SessionManager>().stop(&app) {
                    eprintln!("Real AppShell fixture cleanup failed: {error}");
                }
                match result {
                    Ok(report) => {
                        std::fs::write(
                            evidence.join("result.json"),
                            serde_json::to_vec_pretty(&report).unwrap(),
                        )
                        .unwrap();
                        EXIT_CODE.store(0, std::sync::atomic::Ordering::Release);
                        app.exit(0);
                    }
                    Err(error) => {
                        eprintln!("Real AppShell fixture failed: {error}");
                        EXIT_CODE.store(1, std::sync::atomic::Ordering::Release);
                        app.exit(1);
                    }
                }
            });
            Ok(())
        })
        .build(context)
        .expect("real AppShell fixture App");
    app.run(|_, _| {});
    std::process::exit(EXIT_CODE.load(std::sync::atomic::Ordering::Acquire));
}
