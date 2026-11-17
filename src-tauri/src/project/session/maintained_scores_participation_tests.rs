//! Explicit acceptance against the selected maintenance trees, never installed bundles.
use super::*;

const SOURCES: [(&str, &str); 3] = [
    ("PNDS_III_SOURCE", "inarticulate-iii"),
    ("PNDS_IV_SOURCE", "inarticulate-iv"),
    (
        "PNDS_RUNES_SOURCE",
        "runes-pnds-fa1606b9c5ef55985a7b3d97fc56ed84",
    ),
];

fn copy_runtime(source: &Path, target: &Path) {
    if source.is_dir() {
        std::fs::create_dir_all(target).unwrap();
        for entry in std::fs::read_dir(source).unwrap() {
            let entry = entry.unwrap();
            copy_runtime(&entry.path(), &target.join(entry.file_name()));
        }
    } else {
        std::fs::copy(source, target).unwrap();
    }
}

fn project(parent: &Path, variable: &str, id: &str) -> PathBuf {
    let source = PathBuf::from(
        std::env::var_os(variable)
            .unwrap_or_else(|| panic!("{variable} must name the exact current maintenance tree")),
    );
    let root = parent.join(id);
    std::fs::create_dir_all(&root).unwrap();
    // Only runtime inputs: no creator data, dependencies, tests or historical source.
    for entry in std::fs::read_dir(&source).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        let name = name.to_str().unwrap();
        if matches!(
            name,
            "lib" | "public" | "audio" | "modules" | "supercollider"
        ) || name.ends_with(".js")
            || name.ends_with(".cjs")
            || matches!(
                name,
                "manifest.json" | "package.json" | "pnds.recording.json"
            )
        {
            copy_runtime(&entry.path(), &root.join(name));
        }
    }
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest["id"], id);
    assert_eq!(manifest["scoreServer"]["runtimePorts"], 1);
    assert_eq!(manifest["scoreServer"]["browserParticipation"], 1);
    root
}

fn force_owned_conflicts(root: &Path) -> [std::net::TcpListener; 2] {
    let conflicts = std::array::from_fn(|_| std::net::TcpListener::bind(("0.0.0.0", 0)).unwrap());
    let path = root.join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    for (key, listener) in ["performerPort", "monitorPort"].into_iter().zip(&conflicts) {
        manifest["scoreServer"][key] = listener.local_addr().unwrap().port().into();
    }
    std::fs::write(path, serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
    conflicts
}

fn start(
    manager: &SessionManager,
    app: &AppHandle<tauri::test::MockRuntime>,
    data: &Path,
    root: &Path,
) -> SessionSnapshot {
    manager
        .start(
            app.clone(),
            data.into(),
            StartRequest::new(
                root.to_string_lossy().into_owned(),
                AudioMode::None,
                lan(),
                None,
            ),
        )
        .unwrap();
    let snapshot = wait_finished(manager);
    assert_eq!(snapshot.status, SessionStatus::Ready, "{snapshot:?}");
    snapshot
}

fn confirm(entry: &str) -> (String, String) {
    let landing = agent()
        .get(entry)
        .call()
        .unwrap()
        .into_body()
        .read_to_string()
        .unwrap();
    let action = landing
        .split("action=\"")
        .nth(1)
        .unwrap()
        .split('"')
        .next()
        .unwrap()
        .to_owned();
    let confirmed = agent()
        .post(format!("{}{action}", entry.trim_end_matches('/')))
        .send_empty()
        .unwrap();
    assert_eq!(confirmed.status(), hyper::StatusCode::SEE_OTHER);
    let prefix = confirmed.headers()["location"].to_str().unwrap();
    (action, format!("{}{prefix}", entry.trim_end_matches('/')))
}

#[tokio::test]
#[ignore = "requires explicit III, IV and Runes maintenance trees; real managed Node and independent Client"]
async fn maintained_scores_use_actual_ports_confirmed_assets_and_private_native_sources() {
    use crate::participation_client::{ClientCoordinator, ClientPhase};
    for (variable, id) in SOURCES {
        let projects = tempfile::tempdir().unwrap();
        let root = project(projects.path(), variable, id);
        let conflicts = force_owned_conflicts(&root);
        let data = tempfile::tempdir().unwrap();
        let app = host_app();
        let manager = SessionManager::default();
        let _cleanup = SessionCleanup(&manager, app.clone());
        let snapshot = start(&manager, &app, data.path(), &root);
        let ports = snapshot.applied_ports.as_ref().unwrap();
        assert_ne!(
            ports.performer_port,
            conflicts[0].local_addr().unwrap().port()
        );
        assert_ne!(
            ports.monitor_port,
            conflicts[1].local_addr().unwrap().port()
        );
        let entry = snapshot.client_entry_url.unwrap();
        let (action, url) = confirm(&entry);
        let resources = if id.starts_with("runes-") {
            vec![
                "performer.js",
                "score-sync.js",
                "Pattern.js",
                "shared/p5.js",
                "socket.io/socket.io.js",
            ]
        } else {
            vec![
                "sketch.js",
                "shared.js",
                "__config.js",
                "__pnds/shared/p5.js",
                "socket.io/socket.io.js",
            ]
        };
        for resource in resources
            .into_iter()
            .chain(["", "__pnds/context.js", "__pnds/health"])
        {
            let response = agent()
                .get(format!("{url}{resource}?proof=maintained"))
                .call()
                .unwrap()
                .into_body()
                .read_to_vec()
                .unwrap();
            assert!(!response.is_empty(), "{id}: {resource}");
        }
        let client = ClientCoordinator::default();
        let client_data = tempfile::tempdir().unwrap();
        client
            .inspect_guarded(entry.clone(), None, || false)
            .await
            .unwrap();
        assert_eq!(
            client.join(client_data.path()).await.unwrap().phase,
            ClientPhase::Open
        );
        let target = client.view_target().unwrap();
        let private = reqwest::Url::parse(&target.page_url).unwrap();
        assert_ne!(
            private.origin(),
            reqwest::Url::parse(&entry).unwrap().origin()
        );
        let browser = reqwest::Client::builder()
            .no_proxy()
            .proxy(reqwest::Proxy::all(format!("http://{}", target.proxy_address)).unwrap())
            .build()
            .unwrap();
        let context = browser
            .get(private.join("__pnds/context.js").unwrap())
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .text()
            .await
            .unwrap();
        assert!(context.contains("\"basePath\":\"/\""));
        assert!(!browser
            .get(&target.page_url)
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .bytes()
            .await
            .unwrap()
            .is_empty());
        client.leave();
        manager.stop(&app).unwrap();
        let second = start(&manager, &app, data.path(), &root);
        assert_eq!(second.client_entry_url.as_deref(), Some(entry.as_str()));
        assert!(matches!(
            agent()
                .post(format!("{}{action}", entry.trim_end_matches('/')))
                .send_empty(),
            Err(ureq::Error::StatusCode(409))
        ));
        assert!(matches!(
            agent().get(format!("{url}__pnds/health")).call(),
            Err(ureq::Error::StatusCode(409))
        ));
        println!("PASS {id}: dynamic ports, queried resources, native private origin and retired browser authorization");
    }
}

#[test]
#[ignore = "opens owned plain WKWebViews against explicit III, IV and Runes maintenance trees"]
fn plain_browser_maintained_scores_keep_music_identity_and_retired_context_boundaries() {
    for (variable, id) in SOURCES {
        let projects = tempfile::tempdir().unwrap();
        let root = project(projects.path(), variable, id);
        let _conflicts = force_owned_conflicts(&root);
        let data = tempfile::tempdir().unwrap();
        let evidence = tempfile::Builder::new()
            .prefix("pnds-maintained-browser-")
            .tempdir()
            .unwrap()
            .keep();
        println!("{id} browser evidence: {}", evidence.display());
        let app = host_app();
        let manager = SessionManager::default();
        let _cleanup = SessionCleanup(&manager, app.clone());
        let first = start(&manager, &app, data.path(), &root);
        let stylesheet = if id.starts_with("runes-") {
            "performer.css"
        } else {
            "style.css"
        };
        let config = serde_json::json!({ "id": id, "stylesheet": stylesheet, "monitorUrl": format!("http://{}:{}", lan(), first.applied_ports.as_ref().unwrap().monitor_port) });
        let driver = format!(
            "const FIXTURE_SCORE={config};\n{}",
            include_str!("maintained-score-browser-driver.js")
        );
        let mut browser = start_browser_with_visibility(
            &evidence,
            &first.client_entry_url.unwrap(),
            &driver,
            true,
        );
        wait_browser_phase(&mut browser, &evidence, "first");
        manager.stop(&app).unwrap();
        let css = root.join("public").join(stylesheet);
        let held = css.with_extension("held");
        std::fs::rename(&css, &held).unwrap();
        start(&manager, &app, data.path(), &root);
        wait_browser_phase(&mut browser, &evidence, "stylesheet-failed");
        std::fs::rename(&held, &css).unwrap();
        finish_browser(&mut browser, &evidence);
    }
}
