//! Opt-in macOS executable: real SessionManager Host and a separate Wry Client.
//! Uses the production native candidate, preparation, input and cleanup paths.
mod app_shell;
mod asbs;
mod project_media;
mod window_controls;

use crate::client_score_view::{self, ClientScoreBounds, ClientScoreView};
use crate::commands::preferences::PreferencesCache;
use crate::participation_client::{ClientCoordinator, ClientPhase};
use crate::project::creation::{CreationAccess, NewProjectOptions, Protection};
use crate::project::session::{SessionManager, StartRequest};
use crate::types::{AppPreferences, AudioMode, SessionStatus};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

static EXIT_CODE: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(2);

const PROBE: &str = "JSON.stringify({token:globalThis.fixtureToken,timeOrigin:performance.timeOrigin,ticks:globalThis.fixtureTicks,keys:globalThis.fixtureKeys,hidden:document.hidden,visibility:document.visibilityState,now:performance.now(),claim:localStorage.getItem('fixture-claim'),prepared:!!globalThis.PNDS_PARTICIPATION?.preparation})";
fn project(parent: &Path, name: &str, broken: bool) -> PathBuf {
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let workspace = access
        .create_blank(
            &NewProjectOptions {
                parent: parent.to_string_lossy().into_owned(),
                folder_name: name.to_ascii_lowercase(),
                name: name.into(),
                author: String::new(),
                description: String::new(),
                locale: "en".into(),
                git_name: None,
                git_email: None,
            },
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/shared-libraries"),
            &protection,
        )
        .unwrap();
    access
        .commit(&workspace.project.identity, &protection)
        .unwrap();
    let root = PathBuf::from(workspace.project.root);
    write_page(&root, broken);
    root
}
fn write_page(root: &Path, broken: bool) {
    let source = include_str!("../resources/blank-project/public/performer.js");
    let preparation = if broken {
        "() => fetch(participation.resource('required-resource-does-not-exist')).then(response => { if (!response.ok) participation.reportPreparationFailed() })"
    } else {
        "() => setTimeout(() => participation?.reportPrepared(), 600)"
    };
    let source = source.replace("() => participation?.reportPrepared()", preparation);
    let instrumentation = "globalThis.fixtureToken=crypto.randomUUID();globalThis.fixtureTicks=0;globalThis.fixtureKeys=0;setInterval(()=>globalThis.fixtureTicks++,10);addEventListener('keydown',event=>{if(event.key==='x')globalThis.fixtureKeys++});";
    std::fs::write(
        root.join("public/performer.js"),
        format!("{instrumentation}\n{source}"),
    )
    .unwrap();
}
async fn start(
    host: &AppHandle<tauri::test::MockRuntime>,
    data: &Path,
    root: &Path,
    lan: &str,
) -> String {
    let manager = host.state::<SessionManager>();
    manager
        .start(
            host.clone(),
            data.into(),
            StartRequest::new(
                root.to_string_lossy().into_owned(),
                AudioMode::None,
                lan.into(),
                None,
            ),
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let state = manager.snapshot();
        assert_ne!(state.status, SessionStatus::Error, "{state:?}");
        if state.status == SessionStatus::Ready {
            return state.client_entry_url.unwrap();
        }
        assert!(
            Instant::now() < deadline,
            "Host startup timed out: {state:?}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
async fn probe(app: &AppHandle, staged: bool) -> Value {
    tokio::time::sleep(Duration::from_millis(100)).await;
    client_score_view::fixture_evaluate(app.clone(), staged, PROBE)
        .await
        .unwrap()
}
async fn wait_staged(app: &AppHandle) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if client_score_view::fixture_evaluate(
            app.clone(),
            true,
            "JSON.stringify(!!globalThis.fixtureToken)",
        )
        .await
            == Ok(json!(true))
        {
            return;
        }
        assert!(Instant::now() < deadline, "candidate document did not load");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
async fn show(app: &AppHandle, page_url: String, request: f64) {
    let window = app.get_webview_window("main").unwrap();
    window.show().unwrap();
    window.set_focus().unwrap();
    client_score_view::sync(
        app.clone(),
        page_url,
        request,
        Some(ClientScoreBounds {
            x: 0.0,
            y: 0.0,
            width: 640.0,
            height: 480.0,
            viewport_width: 640.0,
            viewport_height: 480.0,
        }),
    )
    .await
    .unwrap();
    client_score_view::fixture_focus(app.clone()).await.unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        client_score_view::fixture_focus(app.clone()).await.unwrap();
        let visibility = probe(app, false).await;
        if visibility["hidden"] == false
            && visibility["nativeVisibility"]["appActive"] == true
            && visibility["nativeVisibility"]["keyWindow"] == true
            && visibility["nativeVisibility"]["windowVisible"] == true
            && visibility["nativeVisibility"]["windowOcclusion"]
                .as_u64()
                .is_some_and(|state| state & 2 != 0)
        {
            break;
        }
        if Instant::now() >= deadline {
            panic!("foreground score visibility did not settle: {visibility}");
        }
    }
}
fn preserved(first: &Value, later: &Value) {
    assert_eq!(
        first["token"], later["token"],
        "unsaved document memory was lost"
    );
    assert_eq!(
        first["timeOrigin"], later["timeOrigin"],
        "document was replaced"
    );
    assert!(
        later["ticks"].as_u64().unwrap() > first["ticks"].as_u64().unwrap(),
        "local clock stopped: {first} -> {later}"
    );
}
async fn exercise(app: AppHandle, directory: PathBuf) -> Value {
    let host = tauri::test::mock_app().handle().clone();
    crate::events::events_builder().mount_events(&host);
    host.manage(PreferencesCache::for_test(AppPreferences {
        node_name: Some("Fixture Host".into()),
        ..Default::default()
    }));
    host.manage(SessionManager::default());
    struct HostCleanup(AppHandle<tauri::test::MockRuntime>);
    impl Drop for HostCleanup {
        fn drop(&mut self) {
            let _ = self.0.state::<SessionManager>().stop(&self.0);
        }
    }
    let _cleanup = HostCleanup(host.clone());
    let lan = crate::project::session::list_lan_addresses()
        .unwrap()
        .into_iter()
        .next()
        .unwrap();
    let a = project(&directory, "A", false);
    let b = project(&directory, "B", true);
    let host_data = directory.join("host");
    let client_data = directory.join("client");
    let entry = start(&host, &host_data, &a, &lan).await;
    let client = app.state::<ClientCoordinator>();
    let cleanup_app = app.clone();
    client.set_view_cleanup(Arc::new(move || client_score_view::close(&cleanup_app)));
    let prepare_app = app.clone();
    client.set_view_prepare(Arc::new(move |target| {
        Box::pin(client_score_view::prepare(prepare_app.clone(), target))
    }));
    let commit_app = app.clone();
    client.set_view_commit(Arc::new(move |target| {
        client_score_view::commit(commit_app.clone(), target)
    }));
    let cancel_app = app.clone();
    client.set_view_cancel(Arc::new(move |target| {
        client_score_view::cancel(cancel_app.clone(), target)
    }));
    client
        .inspect_guarded(entry.clone(), None, || {
            app.state::<SessionManager>().has_active_session()
        })
        .await
        .unwrap();
    let a_host = client.snapshot().host.unwrap();
    let first = client.enter(&client_data, a_host.clone()).await.unwrap();
    assert_eq!(first.phase, ClientPhase::Open, "{first:?}");
    let first_url = first.page_url.unwrap();
    let old_source = client.view_target().unwrap().proxy_address;
    show(&app, first_url.clone(), 1.0).await;
    let initial = probe(&app, false).await;
    eprintln!("initial native probe: {initial}");
    assert_eq!(
        initial["hidden"], false,
        "score must be visible for foreground continuity acceptance"
    );
    assert_eq!(initial["prepared"], true);
    client_score_view::fixture_evaluate(
        app.clone(),
        false,
        "localStorage.setItem('fixture-claim','A-retained');JSON.stringify(true)",
    )
    .await
    .unwrap();
    client_score_view::fixture_key(app.clone()).await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(probe(&app, false).await["keys"], 1);
    assert_eq!(start(&host, &host_data, &b, &lan).await, entry);
    let candidate = client.poll().await.host.unwrap();
    // A local file selection belongs to the still-active A document. B's
    // automatic preparation rollback must not dismiss that native sheet.
    client_score_view::fixture_evaluate(app.clone(), false, "const input=document.createElement('input');input.type='file';document.body.append(input);addEventListener('keydown',event=>{if(event.key==='o')input.click()},{once:true});JSON.stringify(true)").await.unwrap();
    client_score_view::fixture_open_file_panel(app.clone())
        .await
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    while !client_score_view::fixture_file_panel(app.clone(), false)
        .await
        .unwrap()
    {
        assert!(
            Instant::now() < deadline,
            "active score file selection did not open"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let failed = client.enter(&client_data, candidate.clone()).await.unwrap();
    assert!(
        client_score_view::fixture_file_panel(app.clone(), false)
            .await
            .unwrap(),
        "candidate rollback dismissed the active score's file selection"
    );
    client_score_view::fixture_file_panel(app.clone(), true)
        .await
        .unwrap();

    assert_eq!(
        failed.page_url.as_deref(),
        Some(first_url.as_str()),
        "{failed:?}"
    );
    assert_eq!(
        failed.error.unwrap().code,
        "participation.errors.preparationFailed"
    );
    let after_failure = probe(&app, false).await;
    eprintln!("after failed candidate probe: {after_failure}");
    preserved(&initial, &after_failure);
    write_page(&b, false);
    let cancellation_app = app.clone();
    let cancellation_data = client_data.clone();
    let cancellation_host = candidate.clone();
    let attempt = tokio::spawn(async move {
        cancellation_app
            .state::<ClientCoordinator>()
            .enter(&cancellation_data, cancellation_host)
            .await
    });
    wait_staged(&app).await;
    let before_cancel = probe(&app, false).await;
    eprintln!("while preparing candidate probe: {before_cancel}");
    preserved(&after_failure, &before_cancel);
    client_score_view::fixture_key(app.clone()).await.unwrap();
    assert_eq!(
        client.cancel_entry().page_url.as_deref(),
        Some(first_url.as_str())
    );
    assert_eq!(
        attempt.await.unwrap().unwrap().page_url.as_deref(),
        Some(first_url.as_str())
    );
    let after_cancel = probe(&app, false).await;
    preserved(&before_cancel, &after_cancel);
    assert_eq!(after_cancel["keys"], 2);
    let next = client.enter(&client_data, candidate).await.unwrap();
    assert_eq!(next.phase, ClientPhase::Open, "{next:?}");
    show(&app, next.page_url.unwrap(), 2.0).await;
    let retired_source = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(format!("http://{old_source}")).unwrap())
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap();
    assert!(
        retired_source.get(&first_url).send().await.is_err(),
        "retired native source still accepted network traffic"
    );
    let second = probe(&app, false).await;
    assert_ne!(second["token"], initial["token"]);
    assert_eq!(second["claim"], Value::Null);
    client_score_view::fixture_key(app.clone()).await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(probe(&app, false).await["keys"], 1);
    assert_eq!(start(&host, &host_data, &a, &lan).await, entry);
    let returning = client.poll().await.host.unwrap();
    assert_ne!(returning.performance, a_host.performance);
    let restored = client.enter(&client_data, returning).await.unwrap();
    assert_eq!(restored.phase, ClientPhase::Open, "{restored:?}");
    show(&app, restored.page_url.unwrap(), 3.0).await;
    let returned = probe(&app, false).await;
    assert_eq!(returned["claim"], "A-retained");
    assert_ne!(returned["token"], initial["token"]);
    client_score_view::fixture_evaluate(
        app.clone(),
        false,
        "localStorage.setItem('fixture-claim','A-latest');JSON.stringify(true)",
    )
    .await
    .unwrap();
    // While a real B document is preparing, publish another A performance.
    // The B click must never authorize that later candidate. The following
    // explicit A entry also stages the same durable origin while old A lives.
    let slow = std::fs::read_to_string(b.join("public/performer.js"))
        .unwrap()
        .replace(", 600)", ", 2500)");
    std::fs::write(b.join("public/performer.js"), slow).unwrap();
    assert_eq!(start(&host, &host_data, &b, &lan).await, entry);
    let race_candidate = client.poll().await.host.unwrap();
    let racing_app = app.clone();
    let racing_data = client_data.clone();
    let race = tokio::spawn(async move {
        racing_app
            .state::<ClientCoordinator>()
            .enter(&racing_data, race_candidate)
            .await
    });
    wait_staged(&app).await;
    let during_race = probe(&app, false).await;
    preserved(&returned, &during_race);
    assert_eq!(start(&host, &host_data, &a, &lan).await, entry);
    let rejected_race = race.await.unwrap().unwrap();
    assert_eq!(rejected_race.page_url, client.snapshot().page_url);
    assert_eq!(
        rejected_race.error.unwrap().code,
        "participation.errors.changed"
    );
    let after_race = probe(&app, false).await;
    preserved(&during_race, &after_race);
    let restarted_a = client.poll().await.host.unwrap();
    let restarted = client.enter(&client_data, restarted_a).await.unwrap();
    assert_eq!(restarted.phase, ClientPhase::Open, "{restarted:?}");
    show(&app, restarted.page_url.unwrap(), 4.0).await;
    let same_project_restart = probe(&app, false).await;
    assert_ne!(same_project_restart["token"], returned["token"]);
    assert_eq!(same_project_restart["claim"], "A-latest");
    assert!(!app.state::<SessionManager>().has_active_session());
    assert_eq!(client.leave().phase, ClientPhase::Idle);
    assert!(
        client_score_view::fixture_evaluate(app.clone(), false, PROBE)
            .await
            .is_err()
    );
    json!({"result":"passed","host":"production SessionManager in independent MockRuntime App","client":"production ClientCoordinator + native stage/prepare/commit in Wry App","initial":initial,"afterResourceFailure":after_failure,"afterCancellation":after_cancel,"second":second,"returned":returned,"afterCandidateRace":after_race,"sameProjectRestart":same_project_restart,"input":"real AppKit key events, old receives during preparation, candidate receives after handoff","fileSelection":"active A native file selection survives failed B preparation; explicit owner cancellation closes it","cleanup":"production _close/_isClosed and storage flush barriers completed; no active document after Leave","limits":["single executing macOS","no physical media capture","not signed installation or two-machine LAN"]})
}
pub fn run() {
    if let Some(directory) = std::env::var_os("PNDS_WINDOW_CONTROLS_FIXTURE") {
        return window_controls::run(directory.into());
    }
    if let Some(frontend) = std::env::var_os("PNDS_APP_SHELL_FIXTURE") {
        return app_shell::run(frontend.into());
    }
    let directory = tempfile::Builder::new()
        .prefix("pnds-native-entry-")
        .tempdir()
        .unwrap()
        .keep();
    eprintln!("Native entry evidence directory: {}", directory.display());
    let mut context = crate::app_context();
    let mut window_config = context.config().app.windows.first().unwrap().clone();
    window_config.url = tauri::WebviewUrl::External("about:blank".parse().unwrap());
    context.config_mut().app.windows.clear();
    let root = directory.clone();
    let storage = root.clone();
    let app = tauri::Builder::default()
        .manage(PreferencesCache::for_test(Default::default()))
        .manage(SessionManager::default())
        .manage(ClientCoordinator::default())
        .manage(ClientScoreView::default())
        .manage(crate::project_media_view::ProjectMediaViews::default())
        .setup(move |app| {
            app.set_activation_policy(tauri::ActivationPolicy::Regular);
            crate::events::events_builder().mount_events(app);
            *app.state::<ClientScoreView>()
                .fixture_storage
                .lock()
                .unwrap() = Some(storage);
            let window = tauri::WebviewWindowBuilder::from_config(app, &window_config)?
                .title("PNDS native entry fixture")
                .build()?;
            crate::window::configure_main_chrome(&window);
            crate::window::sync_corner_radius(&window, false);
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let exercise_handle = handle.clone();
                let exercise_root = root.clone();
                let execution = tokio::spawn(async move {
                    if std::env::var_os("PNDS_PROJECT_MEDIA_FIXTURE").is_some() {
                        project_media::exercise(exercise_handle, exercise_root).await
                    } else if std::env::var_os("PNDS_ASBS_SOURCE").is_some() {
                        asbs::exercise(exercise_handle, exercise_root).await
                    } else {
                        exercise(exercise_handle, exercise_root).await
                    }
                })
                .await;
                match execution {
                    Ok(report) => {
                        std::fs::write(
                            root.join("result.json"),
                            serde_json::to_vec_pretty(&report).unwrap(),
                        )
                        .unwrap();
                        println!("{}", serde_json::to_string_pretty(&report).unwrap());
                        EXIT_CODE.store(0, std::sync::atomic::Ordering::Release);
                        handle.exit(0);
                    }
                    Err(error) => {
                        eprintln!("native entry fixture failed: {error}");
                        if std::env::var_os("PNDS_PROJECT_MEDIA_FIXTURE").is_some() {
                            if let Err(cleanup) = handle.state::<SessionManager>().stop(&handle) {
                                eprintln!("native project fixture cleanup failed: {cleanup}");
                            }
                        }
                        EXIT_CODE.store(1, std::sync::atomic::Ordering::Release);
                        handle.exit(1);
                    }
                }
            });
            Ok(())
        })
        .build(context)
        .expect("native fixture App");
    app.run(|_, _| {});
    std::process::exit(EXIT_CODE.load(std::sync::atomic::Ordering::Acquire));
}
