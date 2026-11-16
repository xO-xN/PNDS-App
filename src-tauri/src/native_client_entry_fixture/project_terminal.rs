//! Static production Ghostty assets in the existing WKWebView, with real PTY IPC.
use super::*;
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

pub(super) fn run(frontend: PathBuf) {
    let directory = std::fs::canonicalize(
        tempfile::Builder::new()
            .prefix("pnds-real-terminal-")
            .tempdir()
            .unwrap()
            .keep(),
    )
    .unwrap();
    eprintln!(
        "Native terminal evidence directory: {}",
        directory.display()
    );
    let generated = project(&directory, "terminal", false);
    let root = directory.join("终端 Chinese space");
    std::fs::rename(generated, &root).unwrap();
    let interactive = std::env::var_os("PNDS_TERMINAL_INTERACTIVE").is_some();
    let config = json!({"project":root,"interactive":interactive});
    let mut assets = BTreeMap::new();
    files(&frontend, &frontend, &mut assets);
    let mut context = crate::app_context();
    let window_config = context.config().app.windows.first().unwrap().clone();
    let production_csp = context.config().app.security.csp.clone();
    context.config_mut().app.windows.clear();
    context.config_mut().build.dev_url = None;
    context.config_mut().identifier =
        format!("com.pnds.native-terminal-fixture.{}", std::process::id());
    context.set_assets(Box::new(Frontend(assets)));
    let builder = crate::bindings::generate_bindings();
    let report_directory = directory.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(PreferencesCache::for_test(Default::default()))
        .manage(SessionManager::default())
        .manage(crate::commands::controlled_checks::ControlledCheckState::default())
        .manage(crate::model::ModelService::new(crate::model::KeychainCredentials))
        .manage(crate::commands::creation::CreationState::default())
        .manage(crate::project_media_view::ProjectMediaViews::default())
        .manage(crate::project::terminal::ProjectTerminalManager::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            crate::events::events_builder().mount_events(app);
            app.set_activation_policy(tauri::ActivationPolicy::Regular);
            let window = tauri::WebviewWindowBuilder::from_config(app, &window_config)?
                .title("PNDS real project terminal fixture")
                .visible(true)
                .initialization_script(format!("globalThis.__PNDS_TERMINAL_CONFIG__={config};"))
                .build()?;
            window.set_focus()?;
            if !interactive {
                let app = app.handle().clone();
                let evidence = report_directory.clone();
                let csp = production_csp.clone();
                tauri::async_runtime::spawn(async move {
                    let deadline = Instant::now() + Duration::from_secs(90);
                    let report = loop {
                        let value = crate::project_media_view::fixture_shell_evaluate(
                            app.clone(), "main", "JSON.stringify(globalThis.fixtureResult || null)",
                        ).await;
                        if let Ok(value) = value {
                            if !value.is_null() { break value; }
                        }
                        if Instant::now() >= deadline {
                            break json!({"result":"failed","error":"Native terminal fixture timed out"});
                        }
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    };
                    let passed = report["result"] == "passed";
                    let report = json!({"result":if passed {"passed"} else {"failed"},"frontend":report,"architecture":std::env::consts::ARCH,"productionCsp":csp,"project":root});
                    std::fs::write(evidence.join("result.json"),serde_json::to_vec_pretty(&report).unwrap()).unwrap();
                    EXIT_CODE.store(if passed {0} else {1}, std::sync::atomic::Ordering::Release);
                    app.exit(if passed {0} else {1});
                });
            }
            Ok(())
        })
        .build(context)
        .expect("real project terminal fixture App");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            // The fixture has no user work and never leaves a PTY after it exits.
            let _ = app
                .state::<crate::project::terminal::ProjectTerminalManager>()
                .shutdown();
        }
    });
    std::process::exit(EXIT_CODE.load(std::sync::atomic::Ordering::Acquire));
}
