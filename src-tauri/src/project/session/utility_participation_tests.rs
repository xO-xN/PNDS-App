//! Explicit installed-candidate acceptance; never substitutes a local package for a release pin.
use super::*;
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
struct Candidate {
    id: String,
    version: String,
    bundle: PathBuf,
    source: PathBuf,
    sha256: String,
    published: bool,
}

fn candidates() -> Vec<Candidate> {
    let registry = std::env::var_os("PNDS_UTILITIES_CANDIDATES")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp/pnds-308-311/candidates.json"));
    let candidates: Vec<Candidate> = serde_json::from_slice(
        &std::fs::read(&registry).expect("select the explicit candidate registry"),
    )
    .unwrap();
    let mut actual: Vec<_> = candidates.iter().map(|item| item.id.as_str()).collect();
    actual.sort_unstable();
    assert_eq!(
        actual,
        [
            "local-network-diagnostics",
            "mobile-sensor-meter",
            "multichannel-signal-generator",
            "telematic-network-diagnostics"
        ]
    );
    candidates
}

fn installed(candidate: &Candidate, bundles: &Path) -> (PathBuf, String, usize) {
    let libraries = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/shared-libraries");
    let root = crate::project::bundle::install_bundle_with_libraries(
        bundles,
        &candidate.bundle,
        Some(&libraries),
    )
    .unwrap();
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest["id"], candidate.id);
    assert_eq!(manifest["version"], candidate.version);
    assert_eq!(manifest["scoreServer"]["runtimePorts"], 1);
    assert_eq!(manifest["scoreServer"]["browserParticipation"], 1);
    let bytes = std::fs::read(&candidate.bundle).unwrap();
    let digest = format!("{:x}", Sha256::digest(&bytes));
    assert_eq!(digest, candidate.sha256, "candidate checksum");
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut verified = 0;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).unwrap();
        if !entry.is_file() || entry.name() == "pnds-bundle.json" {
            continue;
        }
        let (_, relative) = entry.name().split_once('/').unwrap();
        let relative = relative.to_owned();
        let mut packed = Vec::new();
        entry.read_to_end(&mut packed).unwrap();
        assert_eq!(
            packed,
            std::fs::read(root.join(&relative)).unwrap(),
            "installed {relative}"
        );
        // Runtime sources are unchanged by release packaging. The release's
        // intentionally separate README variants are verified against the package above.
        if !relative.starts_with("README") {
            assert_eq!(
                packed,
                std::fs::read(candidate.source.join(&relative)).unwrap(),
                "source/package mismatch: {} / {relative}",
                candidate.id
            );
            verified += 1;
        }
    }
    assert!(verified > 5);
    (root, digest, verified)
}

fn conflicting_preferences(root: &Path) -> [std::net::TcpListener; 2] {
    let listeners = std::array::from_fn(|_| std::net::TcpListener::bind(("0.0.0.0", 0)).unwrap());
    let path = root.join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    for (key, listener) in ["performerPort", "monitorPort"].into_iter().zip(&listeners) {
        manifest["scoreServer"][key] = listener.local_addr().unwrap().port().into();
    }
    std::fs::write(path, serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
    listeners
}

fn start_utility(
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
                if root
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("multichannel-signal-generator-")
                {
                    AudioMode::Internal
                } else {
                    AudioMode::None
                },
                lan(),
                None,
            ),
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(30);
    let snapshot = loop {
        let snapshot = manager.snapshot();
        if matches!(snapshot.status, SessionStatus::Ready | SessionStatus::Error) {
            break snapshot;
        }
        assert!(Instant::now() < deadline, "{snapshot:?}");
        std::thread::sleep(Duration::from_millis(25));
    };
    assert_eq!(snapshot.status, SessionStatus::Ready, "{snapshot:?}");
    if snapshot.audio_mode == Some(AudioMode::Internal) {
        // Downstream silence for mechanism tests. Project controls still drive
        // the real engine; this is not acoustic/16-output acceptance.
        let osc = crate::project::audio::OscClient::connect(snapshot.osc_target.as_ref().unwrap())
            .unwrap();
        crate::project::audio::set_master_gain(&osc, 0.0).unwrap();
    }
    snapshot
}

fn confirmation(entry: &str) -> (String, String) {
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
    let response = agent()
        .post(format!("{}{action}", entry.trim_end_matches('/')))
        .send_empty()
        .unwrap();
    assert_eq!(response.status(), hyper::StatusCode::SEE_OTHER);
    let prefix = response.headers()["location"].to_str().unwrap();
    (action, format!("{}{prefix}", entry.trim_end_matches('/')))
}

fn evidence_directory() -> PathBuf {
    let root = std::env::var_os("PNDS_UTILITY_EVIDENCE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            tempfile::Builder::new()
                .prefix("pnds-installed-utilities-")
                .tempdir()
                .unwrap()
                .keep()
        });
    std::fs::create_dir_all(&root).unwrap();
    println!("Utility candidate evidence: {}", root.display());
    root
}

#[tokio::test]
#[ignore = "explicit four unpublished/released candidate packages; real installer, Node and independent native Client"]
async fn installed_utility_candidates_use_actual_ports_confirmed_assets_and_native_sources() {
    use crate::participation_client::{ClientCoordinator, ClientPhase};
    let evidence = evidence_directory();
    for candidate in candidates() {
        let temporary = tempfile::tempdir().unwrap();
        let (root, digest, verified) = installed(&candidate, &temporary.path().join("bundles"));
        // Only after exact installed bytes were checked, fixture-owned port
        // preferences force reallocation without binding a foreign process's port.
        let conflicts = conflicting_preferences(&root);
        let data = tempfile::tempdir().unwrap();
        let app = host_app();
        let manager = SessionManager::default();
        let _cleanup = SessionCleanup(&manager, app.clone());
        let snapshot = start_utility(&manager, &app, data.path(), &root);
        let ports = snapshot.applied_ports.clone().unwrap();
        assert_ne!(
            ports.performer_port,
            conflicts[0].local_addr().unwrap().port()
        );
        assert_ne!(
            ports.monitor_port,
            conflicts[1].local_addr().unwrap().port()
        );
        let entry = snapshot.client_entry_url.unwrap();
        let (action, confirmed) = confirmation(&entry);
        let resources = match candidate.id.as_str() {
            "multichannel-signal-generator" => vec!["copy.js", "control-client.js", "api/state"],
            "local-network-diagnostics" => {
                vec!["performer.js", "shared.js", "__pnds/shared/socket.io.js"]
            }
            "telematic-network-diagnostics" => vec![
                "monitor.js",
                "land.js",
                "geography.js",
                "__pnds/shared/socket.io.js",
                "__pnds/theme-follow.js",
                "__pnds/locale-follow.js",
            ],
            "mobile-sensor-meter" => vec![
                "performer.js",
                "handpose-worker.js",
                "handpose-worker-client.js",
                "vendor/handpose/detector/model.json",
                "vendor/handpose/landmark/model.json",
                "__pnds/shared/ml5.js",
            ],
            _ => unreachable!(),
        };
        for resource in resources
            .into_iter()
            .chain(["", "__pnds/context.js", "__pnds/health"])
        {
            let bytes = agent()
                .get(format!("{confirmed}{resource}?proof=installed-utility"))
                .call()
                .unwrap()
                .into_body()
                .read_to_vec()
                .unwrap();
            assert!(!bytes.is_empty(), "{}: {resource}", candidate.id);
        }
        let client_app = tauri::test::mock_app().handle().clone();
        client_app.manage(SessionManager::default());
        client_app.manage(ClientCoordinator::default());
        let client = client_app.state::<ClientCoordinator>();
        let client_data = tempfile::tempdir().unwrap();
        client
            .inspect_guarded(entry.clone(), None, || {
                client_app.state::<SessionManager>().has_active_session()
            })
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
        for resource in ["", "__pnds/context.js"] {
            let response = browser
                .get(private.join(resource).unwrap())
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .text()
                .await
                .unwrap();
            assert!(!response.is_empty());
            if resource.ends_with("context.js") {
                assert!(response.contains("\"basePath\":\"/\""));
            }
        }
        assert!(!client_app.state::<SessionManager>().has_active_session());
        client.leave();
        manager.stop(&app).unwrap();
        let second = start_utility(&manager, &app, data.path(), &root);
        assert_eq!(second.client_entry_url.as_deref(), Some(entry.as_str()));
        assert!(matches!(
            agent()
                .post(format!("{}{action}", entry.trim_end_matches('/')))
                .send_empty(),
            Err(ureq::Error::StatusCode(409))
        ));
        assert!(matches!(
            agent().get(format!("{confirmed}__pnds/health")).call(),
            Err(ureq::Error::StatusCode(409))
        ));
        let result = serde_json::json!({"id":candidate.id,"version":candidate.version,"bundleSha256":digest,"runtimeSourcePackageInstallFiles":verified,"actualPerformerPort":ports.performer_port,"actualMonitorPort":ports.monitor_port,"privateNativeSource":true,"clientStartedLocalHost":false,"staleConfirmationRejected":true,"staleGrantRejected":true,"published":candidate.published});
        std::fs::write(
            evidence.join(format!("{}-installed.json", candidate.id)),
            serde_json::to_vec_pretty(&result).unwrap(),
        )
        .unwrap();
        println!("{result}");
    }
}

#[test]
#[ignore = "explicit four installed utility packages; opens ordinary WKWebViews and actual pages, no hardware capture"]
fn plain_browser_installed_utility_candidates_keep_real_controls_and_context_boundaries() {
    let evidence = evidence_directory();
    for candidate in candidates() {
        let temporary = tempfile::tempdir().unwrap();
        let (root, _, _) = installed(&candidate, &temporary.path().join("bundles"));
        let _conflicts = conflicting_preferences(&root);
        let data = tempfile::tempdir().unwrap();
        let app = host_app();
        let manager = SessionManager::default();
        let _cleanup = SessionCleanup(&manager, app.clone());
        let first = start_utility(&manager, &app, data.path(), &root);
        let output = evidence.join(&candidate.id);
        std::fs::create_dir_all(&output).unwrap();
        let config = serde_json::json!({"id":candidate.id,"version":candidate.version,"monitorUrl":format!("http://{}:{}", lan(), first.applied_ports.as_ref().unwrap().monitor_port)});
        let driver = format!(
            "globalThis.FIXTURE_UTILITY={config};\n{}",
            include_str!("utility-browser-driver.js")
        );
        let mut browser = start_browser(&output, &first.client_entry_url.unwrap(), &driver);
        if candidate.id == "multichannel-signal-generator" {
            wait_browser_phase(&mut browser, &output, "controls");
            let monitor = format!(
                "http://{}:{}",
                lan(),
                first.applied_ports.as_ref().unwrap().monitor_port
            );
            let state: serde_json::Value = serde_json::from_str(
                &agent()
                    .get(format!("{monitor}/api/state"))
                    .call()
                    .unwrap()
                    .into_body()
                    .read_to_string()
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(state["masterValue"], 0.3);
            assert_eq!(state["tones"][0]["on"], true);
            assert_eq!(state["tones"][0]["volume"], 0.4);
            for (route, body) in [
                ("master", serde_json::json!({"value":0.45})),
                ("channel", serde_json::json!({"channel":1,"value":0.7})),
                ("tone", serde_json::json!({"channel":1,"on":false})),
            ] {
                agent()
                    .post(format!("{monitor}/api/{route}"))
                    .header("Content-Type", "application/json")
                    .send(body.to_string().as_bytes())
                    .unwrap();
            }
        }
        wait_browser_phase(&mut browser, &output, "first");
        manager.stop(&app).unwrap();
        start_utility(&manager, &app, data.path(), &root);
        finish_browser(&mut browser, &output);
    }
}
