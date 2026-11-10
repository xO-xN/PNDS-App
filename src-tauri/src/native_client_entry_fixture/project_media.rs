//! Production project-page mechanism proof. This fixture never requests capture.
use super::*;
use crate::project_media_view::{self, ProjectMediaBounds, ProjectMediaRole, ProjectMediaTarget};

#[path = "project_compositor.rs"]
mod compositor;

const FIRST: &str = "performer-00000000-0000-4000-8000-000000000322";
const SECOND: &str = "performer-00000000-0000-4000-8000-000000000323";
const PROBE: &str = "JSON.stringify({ready:document.readyState==='complete'&&!!document.getElementById('title')?.textContent,origin:location.origin,secure:isSecureContext,media:typeof navigator.mediaDevices?.getUserMedia==='function',devices:typeof navigator.mediaDevices?.enumerateDevices==='function',parentAdapted:parent!==window,ipc:typeof window.__TAURI_INTERNALS__,identity:localStorage.getItem('native-media-identity'),claim:localStorage.getItem('fixture-claim'),token:globalThis.fixtureToken,ticks:globalThis.fixtureTicks,workerTicks:globalThis.fixtureWorkerTicks,role:globalThis.PNDS_MEDIA_SURFACE?.role,captureAllowed:globalThis.PNDS_MEDIA_SURFACE?.captureAllowed,results:document.getElementById('results')?.textContent,hidden:document.hidden,focused:document.hasFocus(),timeOrigin:performance.timeOrigin,resourceVersion:globalThis.fixtureResourceVersion,viewport:[innerWidth,innerHeight]})";
const INSTRUMENT: &str = "globalThis.fixtureToken=crypto.randomUUID();globalThis.fixtureTicks=0;globalThis.fixtureWorkerTicks=0;setInterval(()=>fixtureTicks++,20);globalThis.fixtureWorker=new Worker(URL.createObjectURL(new Blob(['let ticks=0;setInterval(()=>postMessage(++ticks),20)'],{type:'text/javascript'})));fixtureWorker.onmessage=e=>fixtureWorkerTicks=e.data;JSON.stringify(true)";

async fn evaluate(app: &AppHandle, label: &str, script: &str) -> Value {
    project_media_view::fixture_evaluate(app.clone(), label.into(), script)
        .await
        .unwrap()
}
async fn loaded(app: &AppHandle, label: &str) -> Value {
    let deadline = Instant::now() + Duration::from_secs(6);
    loop {
        if let Ok(probe) =
            project_media_view::fixture_evaluate(app.clone(), label.into(), PROBE).await
        {
            if probe["ready"] == true {
                return probe;
            }
        }
        assert!(
            Instant::now() < deadline,
            "project document did not load: {label}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
async fn foreground(app: &AppHandle, label: &str) -> Value {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        project_media_view::fixture_focus(app.clone(), label.into())
            .await
            .unwrap();
        let probe = evaluate(app, label, PROBE).await;
        if probe["hidden"] == false
            && probe["focused"] == true
            && probe["nativeVisibility"]["appActive"] == true
            && probe["nativeVisibility"]["keyWindow"] == true
            && probe["nativeVisibility"]["windowVisible"] == true
            && probe["nativeVisibility"]["windowOcclusion"]
                .as_u64()
                .is_some_and(|state| state & 2 != 0)
        {
            return probe;
        }
        assert!(
            Instant::now() < deadline,
            "native visibility did not settle: {probe}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
fn bounds() -> ProjectMediaBounds {
    ProjectMediaBounds {
        x: 0.0,
        y: 0.0,
        width: 600.0,
        height: 420.0,
        viewport_width: 640.0,
        viewport_height: 480.0,
        page_width: 600.0,
        page_height: 420.0,
        opacity: 1.0,
        corner_radius: 0.0,
        occlusions: Vec::new(),
    }
}
async fn page_bounds(app: &AppHandle, label: &str) -> ProjectMediaBounds {
    let dimensions = project_media_view::fixture_shell_evaluate(
        app.clone(),
        label,
        "JSON.stringify({width:innerWidth,height:innerHeight})",
    )
    .await
    .unwrap();
    let mut bounds = bounds();
    bounds.viewport_width = dimensions["width"].as_f64().unwrap();
    bounds.viewport_height = dimensions["height"].as_f64().unwrap();
    bounds
}
async fn sync(
    app: &AppHandle,
    label: &str,
    target: ProjectMediaTarget,
    request: f64,
    visible: bool,
) {
    project_media_view::sync(
        app.clone(),
        label.into(),
        crate::commands::project_media::shell_message_origin(
            &"tauri://localhost/index.html".parse().unwrap(),
        )
        .unwrap(),
        target,
        request,
        if visible {
            Some(page_bounds(app, label).await)
        } else {
            None
        },
    )
    .await
    .unwrap();
}

pub(super) async fn exercise(app: AppHandle, directory: PathBuf) -> Value {
    *app.state::<crate::project_media_view::ProjectMediaViews>()
        .fixture_storage
        .lock()
        .unwrap() = Some(directory.join("project-origins"));
    let root = project(&directory, "Native-media", false);
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/native-project-media");
    for file in [
        "manifest.json",
        "package.json",
        "server.mjs",
        "index.html",
        "page.mjs",
        "analysis-worker.mjs",
        "locales.json",
    ] {
        std::fs::copy(source.join(file), root.join(file)).unwrap();
    }
    // Instrument one real static asset with an explicit long freshness. The
    // same project server/page stays in use; no alternate miniature server.
    let server=std::fs::read_to_string(root.join("server.mjs")).unwrap()
        .replace("const assets = {", "const assets = { '/cache-probe.js': ['cache-probe.js', 'text/javascript'],")
        .replace("let bytes = await readFile", "if (url.pathname === '/cache-probe.js') response.setHeader('cache-control', 'public, max-age=86400'); let bytes = await readFile");
    std::fs::write(root.join("server.mjs"), server).unwrap();
    let html = std::fs::read_to_string(root.join("index.html"))
        .unwrap()
        .replace(
            "<title>PNDS</title>",
            "<title>PNDS</title><script src=\"/cache-probe.js\"></script>",
        );
    std::fs::write(root.join("index.html"), html).unwrap();
    std::fs::write(
        root.join("cache-probe.js"),
        "globalThis.fixtureResourceVersion='first';",
    )
    .unwrap();
    let lan = crate::project::session::list_lan_addresses()
        .unwrap()
        .into_iter()
        .next()
        .unwrap();
    let manager = app.state::<SessionManager>();
    manager
        .start(
            app.clone(),
            directory.join("host"),
            StartRequest::new(
                root.to_string_lossy().into_owned(),
                AudioMode::None,
                lan,
                None,
            )
            .private(),
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    let snapshot = loop {
        let snapshot = manager.snapshot();
        assert_ne!(snapshot.status, SessionStatus::Error, "{snapshot:?}");
        if snapshot.status == SessionStatus::Ready {
            break snapshot;
        }
        assert!(
            Instant::now() < deadline,
            "project runtime not ready: {snapshot:?}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    let (tx, rx) = tokio::sync::oneshot::channel();
    let main = app.clone();
    app.run_on_main_thread(move || {
        for (index, label) in ["projection", FIRST, SECOND].into_iter().enumerate() {
            tauri::WebviewWindowBuilder::new(
                &main,
                label,
                tauri::WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .title(format!("PNDS native media {label}"))
            .inner_size(640.0, 480.0)
            .position(60.0 + (index as f64) * 70.0, 60.0 + (index as f64) * 70.0)
            .build()
            .unwrap();
        }
        tauri::WebviewWindowBuilder::new(
            &main,
            "origin-probe",
            tauri::WebviewUrl::External(
                "tauri://localhost/__pnds-native-origin-probe__"
                    .parse()
                    .unwrap(),
            ),
        )
        .title("PNDS release scheme origin probe")
        .visible(false)
        .build()
        .unwrap();
        let _ = tx.send(());
    })
    .unwrap();
    rx.await.unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    let release_origin = loop {
        let observed = project_media_view::fixture_shell_origin(app.clone(), "origin-probe")
            .await
            .unwrap();
        if observed["ready"] == "complete"
            && observed["url"]
                .as_str()
                .is_some_and(|url| url.starts_with("tauri://localhost/"))
        {
            break observed;
        }
        assert!(
            Instant::now() < deadline,
            "release shell did not load: {observed}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    assert_eq!(
        release_origin["origin"],
        crate::commands::project_media::shell_message_origin(
            &"tauri://localhost/index.html".parse().unwrap()
        )
        .unwrap()
    );
    app.get_webview_window("origin-probe")
        .unwrap()
        .destroy()
        .unwrap();
    let host = snapshot.host_address.as_deref().unwrap();
    let ports = snapshot
        .health
        .as_ref()
        .unwrap()
        .score_server
        .as_ref()
        .unwrap();
    manager.toggle_projection_start(&app).unwrap();
    let target = |role: ProjectMediaRole, nav: &str| ProjectMediaTarget {
        role,
        url: format!(
            "http://{host}:{}/?lang=en{}",
            if role == ProjectMediaRole::Performer {
                ports.performer_port.unwrap()
            } else {
                ports.monitor_port.unwrap()
            },
            if role == ProjectMediaRole::Projection {
                "&surface=venue"
            } else {
                ""
            }
        ),
        navigation: nav.into(),
        generation: snapshot.runtime_generation.clone(),
    };
    let monitor = target(ProjectMediaRole::Monitor, "fixture-monitor");
    let projection = target(ProjectMediaRole::Projection, "fixture-projection");
    let first = target(ProjectMediaRole::Performer, "fixture-first");
    let second = target(ProjectMediaRole::Performer, "fixture-second");
    // Hidden creation really loads; the shell's reveal gate can then show it.
    sync(&app, "main", monitor.clone(), 1.0, false).await;
    let hidden = loaded(&app, "main").await;
    assert_eq!(hidden["nativeVisibility"]["viewHidden"], true);
    sync(&app, "main", monitor, 2.0, true).await;
    sync(&app, "projection", projection, 1.0, true).await;
    sync(&app, FIRST, first.clone(), 1.0, true).await;
    sync(&app, SECOND, second.clone(), 1.0, true).await;
    let monitor = loaded(&app, "main").await;
    // A real shell button remains visible/clickable through a local mask hole;
    // its sibling project document keeps the same token and worker throughout.
    project_media_view::fixture_shell_evaluate(app.clone(),"main","document.body.innerHTML='<button id=notice style=\"position:absolute;left:20px;top:20px;width:120px;height:50px\">Notice</button>';globalThis.fixtureNoticeClicks=0;document.getElementById('notice').onclick=()=>fixtureNoticeClicks++;JSON.stringify(true)").await.unwrap();
    evaluate(&app, "main", INSTRUMENT).await;
    let before_notice = evaluate(&app, "main", PROBE).await;
    let mut masked = page_bounds(&app, "main").await;
    masked
        .occlusions
        .push(crate::project_media_view::ProjectMediaOcclusion {
            x: 20.0,
            y: 20.0,
            width: 120.0,
            height: 50.0,
        });
    let monitor_target = target(ProjectMediaRole::Monitor, "fixture-monitor");
    project_media_view::sync(
        app.clone(),
        "main".into(),
        "tauri://localhost".into(),
        monitor_target.clone(),
        3.0,
        Some(masked),
    )
    .await
    .unwrap();
    let _ = foreground(&app, "main").await;
    let hit = project_media_view::fixture_click(app.clone(), "main".into(), 60.0, 45.0)
        .await
        .unwrap();
    assert_eq!(hit["hitNativePage"], false, "{hit}");
    tokio::time::sleep(Duration::from_millis(100)).await;
    let clicks = project_media_view::fixture_shell_evaluate(
        app.clone(),
        "main",
        "JSON.stringify({clicks:fixtureNoticeClicks,rect:document.getElementById('notice').getBoundingClientRect().toJSON(),active:document.hasFocus(),size:[innerWidth,innerHeight]})",
    )
    .await
    .unwrap();
    assert_eq!(
        clicks["clicks"], 1,
        "App DOM notice did not receive the native click: {hit}, shell: {clicks}"
    );
    let after_notice = evaluate(&app, "main", PROBE).await;
    assert_eq!(before_notice["token"], after_notice["token"]);
    assert_eq!(before_notice["timeOrigin"], after_notice["timeOrigin"]);
    assert!(
        after_notice["workerTicks"].as_u64().unwrap()
            > before_notice["workerTicks"].as_u64().unwrap()
    );
    sync(&app, "main", monitor_target.clone(), 4.0, true).await;
    // The production main shell switches to an overlay titlebar. This must
    // preserve the same DOM-to-native coordinates without remounting a page.
    let (tx, rx) = tokio::sync::oneshot::channel();
    let chrome = app.clone();
    app.run_on_main_thread(move || {
        crate::window::configure_main_chrome(&chrome.get_webview_window("main").unwrap());
        let _ = tx.send(());
    })
    .unwrap();
    rx.await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    let mut overlay_bounds = page_bounds(&app, "main").await;
    overlay_bounds
        .occlusions
        .push(crate::project_media_view::ProjectMediaOcclusion {
            x: 20.0,
            y: 20.0,
            width: 120.0,
            height: 50.0,
        });
    project_media_view::sync(
        app.clone(),
        "main".into(),
        "tauri://localhost".into(),
        monitor_target.clone(),
        5.0,
        Some(overlay_bounds),
    )
    .await
    .unwrap();
    let overlay_hit = project_media_view::fixture_click(app.clone(), "main".into(), 60.0, 45.0)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    let overlay_clicks = project_media_view::fixture_shell_evaluate(
        app.clone(),
        "main",
        "JSON.stringify(fixtureNoticeClicks)",
    )
    .await
    .unwrap();
    assert_eq!(
        overlay_clicks, 2,
        "Overlay titlebar notice did not receive native click: {overlay_hit}"
    );
    sync(&app, "main", monitor_target, 6.0, true).await;
    let notice = json!({"nativeHitTest":hit,"shellClicks":clicks,"overlayNativeHitTest":overlay_hit,"overlayShellClicks":overlay_clicks,"before":before_notice,"after":after_notice});
    let _ = foreground(&app, "main").await;
    evaluate(&app,"main","globalThis.fixtureInput=document.createElement('input');fixtureInput.id='native-edit';fixtureInput.value='native input text';document.body.append(fixtureInput);fixtureInput.focus();globalThis.fixtureCopied=null;addEventListener('copy',event=>{fixtureCopied=fixtureInput.value.slice(fixtureInput.selectionStart,fixtureInput.selectionEnd);event.preventDefault()},{once:true});JSON.stringify(true)").await;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if project_media_view::fixture::ownership(app.clone(), "main")
            .await
            .unwrap()["interacting"]
            == true
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "native input focus report missing"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let cmd_a = project_media_view::fixture::keys(app.clone(), "main", "a", 0, 0x10_0000)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    let selected=evaluate(&app,"main","JSON.stringify({selection:[fixtureInput.selectionStart,fixtureInput.selectionEnd],value:fixtureInput.value,active:document.activeElement===fixtureInput})").await;
    assert_eq!(
        selected["selection"],
        json!([0, 17]),
        "AppKit Cmd+A did not select the real project input: {selected}"
    );
    let cmd_c = project_media_view::fixture::keys(app.clone(), "main", "c", 8, 0x10_0000)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    let copied = evaluate(&app, "main", "JSON.stringify(fixtureCopied)").await;
    assert_eq!(copied, "native input text");
    project_media_view::post(
        app.clone(),
        "main".into(),
        "fixture-monitor".into(),
        json!({"type":"pnds:host-focus","version":1}),
    )
    .await
    .unwrap();
    let while_editing = project_media_view::fixture::ownership(app.clone(), "main")
        .await
        .unwrap();
    assert_eq!(
        while_editing["guest"], true,
        "host-focus stole an active project input"
    );
    evaluate(&app, "main", "fixtureInput.blur();JSON.stringify(true)").await;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if project_media_view::fixture::ownership(app.clone(), "main")
            .await
            .unwrap()["interacting"]
            == false
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "native input blur report missing"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    project_media_view::post(
        app.clone(),
        "main".into(),
        "fixture-monitor".into(),
        json!({"type":"pnds:host-focus","version":1}),
    )
    .await
    .unwrap();
    let after_editing = project_media_view::fixture::ownership(app.clone(), "main")
        .await
        .unwrap();
    assert_eq!(after_editing["shell"], true);
    let input_proof = json!({"cmdA":cmd_a,"selected":selected,"cmdC":cmd_c,"copied":copied,"whileEditing":while_editing,"afterEditing":after_editing,"clipboard":"copy event prevented after observing selection; system clipboard unchanged"});
    let projection = loaded(&app, "projection").await;
    let a = loaded(&app, FIRST).await;
    let b = loaded(&app, SECOND).await;
    for probe in [&monitor, &projection, &a, &b] {
        assert_eq!(probe["secure"], true, "{probe}");
        assert_eq!(probe["media"], true);
        assert_eq!(probe["devices"], true);
        assert_eq!(probe["parentAdapted"], true);
        assert_eq!(probe["ipc"], "undefined");
    }
    assert_eq!(monitor["captureAllowed"], true);
    assert_eq!(projection["captureAllowed"], false);
    assert_ne!(a["origin"], b["origin"]);
    assert_ne!(a["identity"], b["identity"]);
    for probe in [&monitor, &projection, &a, &b] {
        assert_eq!(probe["viewport"], json!([600, 420]));
    }
    let mut portrait = page_bounds(&app, SECOND).await;
    portrait.width = 195.0;
    portrait.height = 422.0;
    portrait.page_width = 390.0;
    portrait.page_height = 844.0;
    project_media_view::sync(
        app.clone(),
        SECOND.into(),
        "tauri://localhost".into(),
        second.clone(),
        2.0,
        Some(portrait),
    )
    .await
    .unwrap();
    let portrait_probe = evaluate(&app, SECOND, PROBE).await;
    assert_eq!(portrait_probe["viewport"], json!([390, 844]));
    assert_eq!(portrait_probe["timeOrigin"], b["timeOrigin"]);
    let mut landscape = page_bounds(&app, SECOND).await;
    landscape.width = 422.0;
    landscape.height = 195.0;
    landscape.page_width = 844.0;
    landscape.page_height = 390.0;
    project_media_view::sync(
        app.clone(),
        SECOND.into(),
        "tauri://localhost".into(),
        second.clone(),
        3.0,
        Some(landscape),
    )
    .await
    .unwrap();
    let landscape_probe = evaluate(&app, SECOND, PROBE).await;
    assert_eq!(landscape_probe["viewport"], json!([844, 390]));
    assert_eq!(landscape_probe["timeOrigin"], b["timeOrigin"]);
    sync(&app, SECOND, second.clone(), 4.0, true).await;
    let _ = foreground(&app, SECOND).await;
    evaluate(&app,SECOND,"globalThis.fixtureTouches=0;const pad=document.createElement('div');pad.style.cssText='position:fixed;left:20px;top:20px;width:100px;height:80px;z-index:99999';pad.addEventListener('touchstart',()=>fixtureTouches++);document.body.append(pad);JSON.stringify(true)").await;
    project_media_view::post(
        app.clone(),
        SECOND.into(),
        second.navigation.clone(),
        json!({"type":"pnds:test-touch","version":1,"enabled":true}),
    )
    .await
    .unwrap();
    let touch_hit = project_media_view::fixture_click(app.clone(), SECOND.into(), 60.0, 45.0)
        .await
        .unwrap();
    assert_eq!(touch_hit["hitNativePage"], true);
    tokio::time::sleep(Duration::from_millis(50)).await;
    let touches = evaluate(&app, SECOND, "JSON.stringify(fixtureTouches)").await;
    assert_eq!(
        touches, 1,
        "single mouse input did not reach the native performer touch adapter"
    );
    let viewport_proof =
        json!({"portrait":portrait_probe,"landscape":landscape_probe,"mouseTouch":touches});

    evaluate(
        &app,
        FIRST,
        "localStorage.setItem('fixture-claim','first-window');JSON.stringify(true)",
    )
    .await;
    evaluate(&app, FIRST, INSTRUMENT).await;
    evaluate(&app, SECOND, INSTRUMENT).await;
    let _ = foreground(&app, SECOND).await;
    tokio::time::sleep(Duration::from_millis(150)).await;
    let before_b = evaluate(&app, SECOND, PROBE).await;
    assert_eq!(before_b["claim"], Value::Null);
    assert!(before_b["workerTicks"].as_u64().unwrap() > 0);
    // Explicitly controlled numerical output exercises the real project HTTP
    // result channel. It is never labelled as physical camera/audio evidence.
    evaluate(&app,"main","fetch('/results',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'controlled-native-result',cameraBrightness:0.25,microphoneRms:0.5})});JSON.stringify(true)").await;
    tokio::time::sleep(Duration::from_millis(600)).await;
    let result = evaluate(&app, "projection", PROBE).await;
    assert!(
        result["results"]
            .as_str()
            .unwrap()
            .contains("controlled-native-result"),
        "{result}"
    );
    let cleanup_results = Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let probe_results = cleanup_results.clone();
    let probe_app = app.clone();
    let probe_target = first.clone();
    project_media_view::fixture_set_cleanup_probe(
        &app,
        Some(Arc::new(move || {
            let app = probe_app.clone();
            let target = probe_target.clone();
            let outcome = std::thread::spawn(move || {
                tauri::async_runtime::block_on(async move {
                    let sync = project_media_view::sync(
                        app.clone(),
                        FIRST.into(),
                        "tauri://localhost".into(),
                        target.clone(),
                        9999.0,
                        Some(bounds()),
                    )
                    .await
                    .unwrap_err();
                    let close =
                        project_media_view::close(app, FIRST.into(), target.navigation, 10000.0)
                            .await
                            .unwrap_err();
                    assert_eq!(sync, "Native project page cleanup is in progress");
                    assert_eq!(close, sync);
                    json!({"sync":sync,"close":close})
                })
            })
            .join()
            .unwrap();
            probe_results.lock().unwrap().push(outcome);
        })),
    );
    project_media_view::close(app.clone(), FIRST.into(), first.navigation.clone(), 2.0)
        .await
        .unwrap();
    project_media_view::fixture_set_cleanup_probe(&app, None);
    let cleanup_proof = cleanup_results.lock().unwrap().clone();
    assert_eq!(cleanup_proof.len(), 1);
    assert!(
        project_media_view::fixture_evaluate(app.clone(), FIRST.into(), PROBE)
            .await
            .is_err()
    );
    let after_b = foreground(&app, SECOND).await;
    assert_eq!(before_b["token"], after_b["token"]);
    assert_eq!(before_b["timeOrigin"], after_b["timeOrigin"]);
    assert!(after_b["ticks"].as_u64().unwrap() > before_b["ticks"].as_u64().unwrap());
    assert!(after_b["workerTicks"].as_u64().unwrap() > before_b["workerTicks"].as_u64().unwrap());
    assert_eq!(a["resourceVersion"], "first");
    std::fs::write(
        root.join("cache-probe.js"),
        "globalThis.fixtureResourceVersion='second';",
    )
    .unwrap();
    sync(
        &app,
        FIRST,
        ProjectMediaTarget {
            navigation: "fixture-first-cached-document".into(),
            ..first.clone()
        },
        3.0,
        true,
    )
    .await;
    let cached_document = loaded(&app, FIRST).await;
    assert_eq!(
        cached_document["resourceVersion"], "first",
        "ordinary navigation did not exercise the fresh cache entry: {cached_document}"
    );
    let refreshed = ProjectMediaTarget {
        navigation: "fixture-first-refresh".into(),
        url: format!("{}&_r=1", first.url),
        ..first
    };
    sync(&app, FIRST, refreshed.clone(), 4.0, true).await;
    let refreshed_probe = loaded(&app, FIRST).await;
    assert_eq!(
        refreshed_probe["resourceVersion"], "second",
        "explicit refresh reused a stale project subresource: {refreshed_probe}"
    );
    assert_eq!(refreshed_probe["claim"], "first-window");
    assert_eq!(refreshed_probe["identity"], a["identity"]);
    project_media_view::close_window(&app, FIRST).unwrap();
    sync(
        &app,
        FIRST,
        ProjectMediaTarget {
            navigation: "fixture-first-new-window-store".into(),
            ..refreshed
        },
        5.0,
        true,
    )
    .await;
    let fresh = loaded(&app, FIRST).await;
    assert_eq!(fresh["claim"], Value::Null);
    assert_ne!(fresh["identity"], a["identity"]);
    // Stop only B's real first-party forwarding listener. WebKit's actual
    // failed provisional navigation must produce an owned error, then a fresh
    // retry attempt restores the same window's identity through a new document.
    use tauri::Listener;
    let errors = Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let error_sink = errors.clone();
    let listener = app.listen_any("project-media-view-event", move |event| {
        if let Ok(value) = serde_json::from_str::<Value>(event.payload()) {
            if value["label"] == SECOND && value["kind"] == "error" {
                error_sink.lock().unwrap().push(value);
            }
        }
    });
    project_media_view::fixture_stop_source(&app, SECOND).unwrap();
    let _ = project_media_view::fixture_evaluate(
        app.clone(),
        SECOND.into(),
        "setTimeout(()=>location.reload(),0);JSON.stringify(true)",
    )
    .await;
    let deadline = Instant::now() + Duration::from_secs(6);
    loop {
        if !errors.lock().unwrap().is_empty() {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "real failed native navigation did not report an error"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    project_media_view::close(app.clone(), SECOND.into(), second.navigation.clone(), 5.0)
        .await
        .unwrap();
    sync(
        &app,
        SECOND,
        ProjectMediaTarget {
            navigation: format!("{}:retry:1", second.navigation),
            ..second
        },
        6.0,
        true,
    )
    .await;
    let retried = loaded(&app, SECOND).await;
    assert_eq!(retried["identity"], b["identity"]);
    assert_ne!(retried["timeOrigin"], before_b["timeOrigin"]);
    app.unlisten(listener);
    let retry_proof = json!({"nativeErrors":errors.lock().unwrap().clone(),"restored":retried});
    let compositor = compositor::verify(
        &app,
        &directory,
        target(ProjectMediaRole::Monitor, "fixture-monitor"),
    )
    .await;
    manager.stop(&app).unwrap();
    for label in ["main", "projection", FIRST, SECOND] {
        assert!(
            project_media_view::fixture_evaluate(app.clone(), label.into(), PROBE)
                .await
                .is_err()
        );
    }
    json!({"result":"passed","host":"real SessionManager private creation runtime","pages":"production project_media_view sync/bridge/close, main + projection + two performer windows","releaseShellOrigin":release_origin,"nativeCompositorPaint":compositor,"nativeNoticeInteraction":notice,"nativeEditing":input_proof,"cleanupBarrier":cleanup_proof,"nativeRetry":retry_proof,"nativeViewport":viewport_proof,"hiddenCreation":hidden,"monitor":monitor,"projection":projection,"first":a,"second":b,"controlledProjectionResult":result,"secondAfterClosingFirst":after_b,"cachedDocument":cached_document,"firstRefresh":refreshed_probe,"newWindowStorage":fresh,"limits":["media APIs and secure first-party source verified; no physical camera or microphone requested","controlled numeric result verifies project transport only","permission choices, real input selection, sharing allowed/denied and physical capture cleanup require manual native acceptance","executing macOS only; no signed installation proof"]})
}
