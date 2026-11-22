//! Opt-in real AppShell frontend, real command start and native monitor paint.
use super::*;
use crate::project_media_view;
use objc2::{
    msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, Bool},
};
use objc2_app_kit::{NSView, NSWindow};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use std::borrow::Cow;
use std::collections::BTreeMap;
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{Emitter, Listener};
// Reuse the exact own-window implementation without widening production
// score-page visibility. Both inclusions exist only in the opt-in fixture.
mod controller_mapping;
#[allow(clippy::duplicate_mod)]
#[path = "../project_media_view/native_snapshot.rs"]
mod shell_snapshot;

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
        use objc2_app_kit::{NSView, NSWindow, NSWindowButton};
        use objc2_foundation::NSRect;
        let shell = &*webview.inner().cast::<NSView>();
        let native: objc2::rc::Retained<NSWindow> = msg_send![shell, window];
        let buttons: Vec<_> = [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton].into_iter().map(|kind| {
            let button = crate::window::fixture_main_control(&native, kind).expect("Native window control is missing");
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

async fn creation_controls(app: &AppHandle) -> Value {
    project_media_view::fixture_shell_evaluate(
        app.clone(),
        "main",
        "void globalThis.fixtureTheme('sand').then(() => globalThis.fixtureCreation());JSON.stringify(true)",
    )
    .await
    .unwrap();
    let mut result = Vec::new();
    for expanded in [false, true, false] {
        let deadline = Instant::now() + Duration::from_secs(3);
        if !result.is_empty() {
            // Reproduce the displaced performance inset before each direction.
            crate::window::set_main_controls_visible(app.clone(), true, 0.0, 1.0, 34.0)
                .await
                .unwrap();
            let displaced = controls(app).await;
            assert!(displaced[0]["point"][1].as_f64().unwrap() > 26.0);
            project_media_view::fixture_shell_evaluate(
                app.clone(),
                "main",
                "document.querySelector('.creation-titlebar-monitor').click();JSON.stringify(true)",
            )
            .await
            .unwrap();
        }
        loop {
            let layout = project_media_view::fixture_shell_evaluate(
                app.clone(),
                "main",
                "JSON.stringify(document.querySelector('.creation-titlebar-monitor')?.getAttribute('aria-expanded') ?? null)",
            )
            .await
            .unwrap();
            if layout.as_str() == Some(if expanded { "true" } else { "false" }) {
                let buttons = controls(app).await;
                let center = &buttons[0]["point"];
                if (center[0].as_f64().unwrap() - 23.0).abs() < 2.0
                    && (center[1].as_f64().unwrap() - 16.0).abs() < 2.0
                    && buttons.as_array().unwrap().iter().all(|button| {
                        button["hidden"] == false
                            && (button["point"][1].as_f64().unwrap() - 16.0).abs() < 2.0
                    })
                {
                    result.push(json!({"expanded":expanded,"buttons":buttons}));
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "Creation native controls left the compact titlebar: {buttons}"
                );
            }
            assert!(Instant::now() < deadline, "Creation Monitor did not toggle");
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }
    json!(result)
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
    if std::env::var("PNDS_APP_SHELL_CASE").as_deref() == Ok("controller-mapping") {
        report["controllerMapping"] = controller_mapping::exercise(&app).await;
        report["result"] = json!("passed");
        return report;
    }
    if std::env::var_os("PNDS_CREATION_CONTROLS_FIXTURE").is_some() {
        report["creationControls"] = creation_controls(&app).await;
        report["result"] = json!("passed");
        return report;
    }
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

async fn capture_shell(app: AppHandle, path: PathBuf) -> Result<Value, String> {
    let window = app.get_webview_window("main").ok_or("Main shell missing")?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |webview| unsafe {
            let shell = &*webview.inner().cast::<NSView>();
            let native: Retained<NSWindow> = msg_send![shell, window];
            let _ = tx.send(shell_snapshot::capture(
                &native,
                shell,
                shell.bounds(),
                &path,
                &[],
            ));
        })
        .map_err(|error| error.to_string())?;
    rx.await.map_err(|error| error.to_string())?
}

fn creation_project(directory: &Path) -> PathBuf {
    let generated = project(directory, "workbench", false);
    let root = directory.join("终端 Workbench space");
    std::fs::rename(generated, &root).unwrap();
    // The generic native score helper instruments its performer. This idle
    // workbench must also remain suitable for later uninstrumented load checks.
    std::fs::write(
        root.join("public/performer.js"),
        include_str!("../../resources/blank-project/public/performer.js"),
    )
    .unwrap();
    for (name, content) in [
        ("terminal-clean.txt", "BASE CLEAN\n"),
        ("terminal-dirty.txt", "BASE DIRTY\n"),
    ] {
        std::fs::write(root.join(name), content).unwrap();
    }
    root
}

fn write_creation_report(
    directory: &Path,
    project: &Path,
    metadata: &Value,
    frontend: Value,
    cleanup: Option<Result<(), String>>,
) -> Value {
    use sha2::{Digest, Sha256};
    let mut report = metadata.clone();
    let frontend_passed = frontend["result"] == "passed";
    let pending = frontend["result"] == "pending";
    report["frontend"] = frontend;
    report["cleanup"] = json!(cleanup.map(|result| match result {
        Ok(()) => json!({"result":"passed"}),
        Err(error) => json!({"result":"failed","error":error}),
    }));
    let mut disk = serde_json::Map::new();
    let mut disk_matches = true;
    for (name, expected) in [
        ("terminal-clean.txt", "DISK CLEAN 354\n"),
        ("terminal-dirty.txt", "DISK DIRTY 354\n"),
    ] {
        match std::fs::read(project.join(name)) {
            Ok(bytes) => {
                disk_matches &= bytes == expected.as_bytes();
                disk.insert(name.into(),json!({"sha256":format!("{:x}",Sha256::digest(&bytes)),"bytes":bytes.len(),"text":String::from_utf8_lossy(&bytes[..bytes.len().min(1000)])}));
            }
            Err(error) => {
                disk_matches = false;
                disk.insert(name.into(), json!({"error":error.to_string()}));
            }
        }
    }
    report["disk"] = Value::Object(disk);
    report["diskMatchesWatcherEvidence"] = json!(disk_matches);
    let passed = frontend_passed && disk_matches && report["cleanup"]["result"] != "failed";
    report["result"] = json!(if pending {
        "pending"
    } else if passed {
        "passed"
    } else {
        "failed"
    });
    std::fs::write(
        directory.join("result.json.tmp"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    std::fs::rename(
        directory.join("result.json.tmp"),
        directory.join("result.json"),
    )
    .unwrap();
    report
}

pub(super) fn run(frontend: PathBuf) {
    let creation_terminal =
        std::env::var("PNDS_APP_SHELL_CASE").as_deref() == Ok("creation-terminal");
    let controller_fixture =
        std::env::var("PNDS_APP_SHELL_CASE").as_deref() == Ok("controller-mapping");
    let interactive = std::env::var_os("PNDS_APP_SHELL_INTERACTIVE").is_some();
    let directory = std::fs::canonicalize(
        tempfile::Builder::new()
            .prefix("pnds-real-app-shell-")
            .tempdir()
            .unwrap()
            .keep(),
    )
    .unwrap();
    eprintln!("Native entry evidence directory: {}", directory.display());
    let root = if creation_terminal {
        creation_project(&directory)
    } else {
        directory.join("score")
    };
    if !creation_terminal {
        std::fs::create_dir_all(&root).unwrap();
        let source =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/native-project-media");
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
        let html = if controller_fixture {
            html.replace("</body>", r#"<script>
              document.getElementById('fixture-solid-score').innerHTML =
                '<div style="position:absolute;left:25%;top:15%;display:grid;gap:24px">' +
                '<button type="button" id="fixture-controller-stable">Original action</button>' +
                '<div id="fixture-controller-ambiguous"><button type="button">Temporary action</button></div></div>';
              document.querySelector('#fixture-controller-stable').addEventListener('click', () =>
                globalThis.controllerActions = (globalThis.controllerActions || 0) + 1);
              </script></body>"#)
        } else {
            html
        };
        std::fs::write(root.join("index.html"), html).unwrap();
    }
    let lan = if creation_terminal {
        String::new()
    } else {
        crate::project::session::list_lan_addresses()
            .unwrap()
            .into_iter()
            .next()
            .unwrap()
    };
    let configuration = json!({"project":root,"lan":lan,"case":if creation_terminal {"creation-terminal"} else if controller_fixture {"controller-mapping"} else {"score"},"interactive":interactive});
    let project_root = root.clone();
    let mut assets = BTreeMap::new();
    files(&frontend, &frontend, &mut assets);
    let mut context = crate::app_context();
    let production_csp = context.config().app.security.csp.clone();
    if creation_terminal {
        let policy = serde_json::to_string(&production_csp).unwrap();
        assert!(
            policy.contains("'wasm-unsafe-eval'"),
            "The creation host requires the production WASM CSP"
        );
        assert!(
            !policy.contains("'unsafe-eval'"),
            "The creation host must not permit ordinary unsafe-eval"
        );
        context.config_mut().app.security.dev_csp = production_csp.clone();
    }
    let window_config = context.config().app.windows.first().unwrap().clone();
    context.config_mut().app.windows.clear();
    context.config_mut().build.dev_url = None;
    context.config_mut().identifier =
        format!("com.pnds.native-shell-fixture.{}", std::process::id());
    context.set_assets(Box::new(Frontend(assets)));
    let build_provenance = std::fs::read(frontend.parent().unwrap().join("build.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let metadata = json!({"case":"creation-terminal","architecture":std::env::consts::ARCH,"target":env!("PNDS_TARGET_TRIPLE"),"project":project_root,"productionCsp":production_csp,"build":build_provenance,"limits":["Static production AppShell/CreationView in a fixture host; no score runtime is started by this case.","Physical keys, native menu actions, actual hide/reopen and IME require separate CUA observations.","Not a CPU/RSS baseline, audio qualification, full App/DMG release or x86_64 runtime result."]});
    let root = directory.clone();
    let exit_directory = directory.clone();
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
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(crate::window::persisted_state_flags())
                .build(),
        )
        .manage(PreferencesCache::for_test(AppPreferences {
            node_name: Some("AppShell fixture".into()),
            language: Some("en".into()),
            ..Default::default()
        }))
        .manage(SessionManager::default())
        .manage(crate::project::merge_runtime::MergeRuntimeState::default())
        .manage(crate::recording::RecordingManager::default())
        .manage(crate::window::WindowManager::default())
        .manage(crate::performer::VisibilityIntent::default())
        .manage(ClientCoordinator::default())
        .manage(ClientScoreView::default())
        .manage(crate::project_media_view::ProjectMediaViews::default())
        .manage(crate::controller_mapping::ControllerMappings::default())
        .manage(crate::commands::creation::CreationState::default())
        .manage(crate::commands::controlled_checks::ControlledCheckState::default())
        .manage(crate::model::ModelService::new(crate::model::KeychainCredentials))
        .manage(crate::assistant_history::AssistantHistoryStore::default())
        .manage(crate::lan_discovery::LanDiscovery::default())
        .manage(crate::commands::bundle::PendingBundleOpens::default())
        .manage(crate::github_auth::GithubAuth::for_fixture())
        .manage(crate::commands::github_sync::GithubSync::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            app.manage(crate::project::terminal::ProjectTerminalManager::new(
                root.join("terminal-ownership"),
            ));
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
            crate::window::install_close_window_repeat_guard(&window);
            crate::window::suppress_default_context_menu(&window);
            crate::window::install_native_context_menu_guard();
            crate::window::install_cmd_arrow_webview_passthrough(app.handle());
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
            if creation_terminal {
                let handle = app.handle().clone();
                let event_app = handle.clone();
                let event_directory = root.clone();
                let event_project = project_root.clone();
                let completed = Arc::new(std::sync::atomic::AtomicBool::new(false));
                let event_completed = completed.clone();
                let report_writer = Arc::new(std::sync::Mutex::new(()));
                app.listen("pnds-fixture-shell-evidence", move |event| {
                    if event.payload().len() > 131072 {
                        return;
                    }
                    let Ok(request) = serde_json::from_str::<Value>(event.payload()) else {
                        return;
                    };
                    let app = event_app.clone();
                    let directory = event_directory.clone();
                    if request["action"] == "capture" {
                        let Some(name) = request["name"].as_str().filter(|name| {
                            !name.is_empty() && name.len() < 80
                                && name.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                        }) else { return; };
                        let name = name.to_owned();
                        tauri::async_runtime::spawn(async move {
                            let result = capture_shell(app.clone(), directory.join(format!("{name}.png"))).await;
                            let reply = match result {
                                Ok(paint) => {
                                    std::fs::write(directory.join(format!("{name}.json")),serde_json::to_vec_pretty(&paint).unwrap()).unwrap();
                                    json!({"name":name})
                                }
                                Err(error) => json!({"name":name,"error":error}),
                            };
                            let _ = app.emit("pnds-fixture-shell-captured", reply);
                        });
                    } else if request["action"] == "report" {
                        event_completed.store(true, std::sync::atomic::Ordering::Release);
                        let project = event_project.clone();
                        let metadata = metadata.clone();
                        let writer = report_writer.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            let _writer = writer.lock().unwrap();
                            let cleanup = (!interactive).then(|| app.state::<crate::project::terminal::ProjectTerminalManager>().shutdown());
                            let report = write_creation_report(&directory,&project,&metadata,request["report"].clone(),cleanup);
                            if !interactive {
                                let code = if report["result"] == "passed" { 0 } else { 1 };
                                EXIT_CODE.store(code,std::sync::atomic::Ordering::Release);
                                app.exit(code);
                            } else if report["result"] != "pending" {
                                EXIT_CODE.store(if report["result"] == "passed" {0} else {1},std::sync::atomic::Ordering::Release);
                            }
                        });
                    }
                });
                if !interactive {
                    let directory = root.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(Duration::from_secs(120)).await;
                        if !completed.load(std::sync::atomic::Ordering::Acquire) {
                            let cleanup = handle.state::<crate::project::terminal::ProjectTerminalManager>().shutdown();
                            std::fs::write(directory.join("result.json"),serde_json::to_vec_pretty(&json!({"result":"failed","error":"Creation workbench timed out","cleanup":cleanup})).unwrap()).unwrap();
                            EXIT_CODE.store(1,std::sync::atomic::Ordering::Release);
                            handle.exit(1);
                        }
                    });
                }
                return Ok(());
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
    app.run(move |app, event| {
        if !creation_terminal { return; }
        match event {
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. } if label == "main" => {
                api.prevent_close();
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = crate::window::close_window_with_fade(app).await {
                        eprintln!("Fixture window hide failed: {error}");
                    }
                });
            }
            tauri::RunEvent::Reopen { .. } => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = crate::window::fade_in_window(app, None).await {
                        eprintln!("Fixture window reveal failed: {error}");
                    }
                });
            }
            tauri::RunEvent::ExitRequested { api, .. } => {
                let cleanup = app.state::<crate::project::terminal::ProjectTerminalManager>().shutdown();
                std::fs::write(exit_directory.join("cleanup.json"),serde_json::to_vec_pretty(&json!({"result":if cleanup.is_ok(){"passed"}else{"failed"},"error":cleanup.as_ref().err()})).unwrap()).unwrap();
                if let Err(error) = cleanup {
                    eprintln!("Fixture PTY cleanup failed: {error}");
                    api.prevent_exit();
                    EXIT_CODE.store(1,std::sync::atomic::Ordering::Release);
                } else if EXIT_CODE.load(std::sync::atomic::Ordering::Acquire) == 2 {
                    EXIT_CODE.store(0, std::sync::atomic::Ordering::Release);
                }
            }
            tauri::RunEvent::Exit => crate::project::terminal::visibility::shutdown(),
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } if label == "main" => crate::project::terminal::visibility::shutdown(),
            _ => {}
        }
    });
    std::process::exit(EXIT_CODE.load(std::sync::atomic::Ordering::Acquire));
}
