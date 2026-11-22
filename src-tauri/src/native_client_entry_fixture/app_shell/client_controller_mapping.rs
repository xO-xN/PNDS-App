//! Use AppShell's Join button and production Client views with a real Host.
use super::controller_mapping::{await_shell, declared, enable_osc, send, shell};
use super::*;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};

struct EntryRelay {
    address: String,
    online: Arc<AtomicBool>,
    task: tokio::task::JoinHandle<()>,
}

impl EntryRelay {
    async fn forward(entry: &str) -> Self {
        let upstream = entry
            .parse::<tauri::Url>()
            .unwrap()
            .socket_addrs(|| None)
            .unwrap()[0];
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let address = format!("http://{}/", listener.local_addr().unwrap());
        let online = Arc::new(AtomicBool::new(true));
        let active = online.clone();
        let task = tokio::spawn(async move {
            while let Ok((socket, _)) = listener.accept().await {
                if active.load(Ordering::Acquire) {
                    tokio::spawn(forward(socket, upstream));
                }
            }
        });
        Self {
            address,
            online,
            task,
        }
    }
}

impl Drop for EntryRelay {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn forward(mut socket: tokio::net::TcpStream, upstream: SocketAddr) {
    if let Ok(mut server) = tokio::net::TcpStream::connect(upstream).await {
        let _ = tokio::io::copy_bidirectional(&mut socket, &mut server).await;
    }
}

async fn client_score(app: &AppHandle, source: &str) -> Value {
    client_score_view::fixture_evaluate(app.clone(), false, source)
        .await
        .unwrap()
}

async fn wait_score(app: &AppHandle, source: &str) {
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        let value = client_score(app, source).await;
        if value == true {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "Client control check: {source}: {value}"
        );
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
}

fn add_control(project: &Path) {
    let file = project.join("public/performer.js");
    let mut source = std::fs::read_to_string(&file).unwrap();
    source.push_str(
        r#"
const fixtureButton = document.createElement('button');
fixtureButton.id = 'fixture-client-action';
fixtureButton.textContent = 'Client local action';
fixtureButton.style = 'position:fixed;left:51vw;top:37vh;width:30vw;height:30vh;z-index:2147483647';
globalThis.fixtureControllerActions = 0;
fixtureButton.addEventListener('click', () => {
  globalThis.fixtureControllerActions++;
  fixtureButton.dataset.actions = String(globalThis.fixtureControllerActions);
});
document.body.append(fixtureButton);
"#,
    );
    source.push_str(declared::PROJECT_SCRIPT);
    std::fs::write(file, source).unwrap();
    let monitor = project.join("public/monitor.js");
    let mut source = std::fs::read_to_string(&monitor).unwrap();
    source.push_str(declared::PROJECT_SCRIPT);
    std::fs::write(monitor, source).unwrap();
}

async fn wait_join(app: &AppHandle) {
    shell(app, "if (globalThis.fixtureClientSnapshot()?.pageUrl) globalThis.fixtureClientSidebar(true);JSON.stringify(true)").await;
    await_shell(
        app,
        "JSON.stringify(!!document.querySelector('[data-performance-action=load]:not(:disabled)'))",
    )
    .await;
    shell(
        app,
        "document.querySelector('[data-performance-action=load]').click();JSON.stringify(true)",
    )
    .await;
    phase(app, "open").await;
    await_shell(app, "JSON.stringify(!!globalThis.fixtureControllerSnapshot()?.page && !!document.querySelector('.desktop-controller-mapping'))").await;
    shell(
        app,
        "globalThis.fixtureClientSidebar(false);JSON.stringify(true)",
    )
    .await;
    wait_score(
        app,
        "JSON.stringify(!!document.getElementById('fixture-client-action') && !document.hidden)",
    )
    .await;
    client_score_view::fixture_focus(app.clone()).await.unwrap();
}

async fn phase(app: &AppHandle, phase: &str) {
    await_shell(
        app,
        &format!("JSON.stringify(globalThis.fixtureClientSnapshot()?.phase === {phase:?})"),
    )
    .await;
}

async fn inspect(app: &AppHandle, entry: &str) {
    shell(
        app,
        &format!("void globalThis.fixtureClientInspect({entry:?});JSON.stringify(true)"),
    )
    .await;
}

async fn leave(app: &AppHandle) {
    await_shell(app, "JSON.stringify(!!document.querySelector('[data-performance-action=close]:not(:disabled)'))").await;
    shell(
        app,
        "document.querySelector('[data-performance-action=close]').click();JSON.stringify(true)",
    )
    .await;
    phase(app, "idle").await;
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.page === null)",
    )
    .await;
    assert!(
        client_score_view::fixture_evaluate(app.clone(), false, "JSON.stringify(true)")
            .await
            .is_err()
    );
}

async fn current(app: &AppHandle) -> Value {
    shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot())",
    )
    .await
}

async fn result(app: &AppHandle) -> Value {
    client_score(app, "JSON.stringify({actions:fixtureControllerActions, token:fixtureToken, timeOrigin:performance.timeOrigin})").await
}

async fn act(app: &AppHandle, port: u16, actions: u32) -> Value {
    send("/client-action", port);
    wait_score(
        app,
        &format!("JSON.stringify(fixtureControllerActions === {actions})"),
    )
    .await;
    result(app).await
}

pub(super) async fn exercise(app: AppHandle, directory: PathBuf) -> Value {
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
    let a = project(&directory, "Controller-A", false);
    let b = project(&directory, "Controller-B", false);
    add_control(&a);
    add_control(&b);
    let data = directory.join("host");
    let entry = start(&host, &data, &a, &lan).await;
    let relay = EntryRelay::forward(&entry).await;
    await_shell(
        &app,
        "JSON.stringify(globalThis.fixtureState === 'client-ready')",
    )
    .await;
    inspect(&app, &relay.address).await;
    wait_join(&app).await;

    let port = enable_osc(&app).await;
    shell(
        &app,
        "document.querySelector('.desktop-controller-mapping').click();JSON.stringify(true)",
    )
    .await;
    await_shell(
        &app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.learning === true)",
    )
    .await;
    wait_score(
        &app,
        "JSON.stringify(!!document.querySelector('[data-pnds-controller-layer]'))",
    )
    .await;
    client_score_view::fixture_click(app.clone(), 0.66)
        .await
        .unwrap();
    await_shell(&app, "JSON.stringify(globalThis.fixtureControllerSnapshot()?.pending?.name === 'Client local action')").await;
    assert_eq!(
        client_score(&app, "JSON.stringify(fixtureControllerActions)").await,
        0
    );
    send("/client-action", port);
    wait_score(&app, r#"JSON.stringify(!!document.querySelector('[data-pnds-controller-address="/client-action"]'))"#).await;
    shell(
        &app,
        "document.querySelector('.desktop-controller-mapping').click();JSON.stringify(true)",
    )
    .await;
    await_shell(
        &app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.learning === false)",
    )
    .await;
    let learned = act(&app, port, 1).await;
    let a_scope = current(&app).await;
    assert_eq!(a_scope["scope"]["role"], "client");

    relay.online.store(false, Ordering::Release);
    app.state::<ClientCoordinator>().poll().await;
    phase(&app, "disconnected").await;
    let disconnected = act(&app, port, 2).await;
    assert_eq!(disconnected["token"], learned["token"]);
    assert_eq!(current(&app).await["page"], a_scope["page"]);

    relay.online.store(true, Ordering::Release);
    app.state::<ClientCoordinator>().poll().await;
    phase(&app, "open").await;
    let recovered = act(&app, port, 3).await;
    assert_eq!(recovered["timeOrigin"], learned["timeOrigin"]);

    shell(
        &app,
        "void globalThis.fixtureClientRefresh();JSON.stringify(true)",
    )
    .await;
    await_shell(&app, &format!("JSON.stringify(globalThis.fixtureClientSnapshot()?.phase === 'open' && !!globalThis.fixtureControllerSnapshot()?.page && globalThis.fixtureControllerSnapshot().page !== {})", a_scope["page"])).await;
    let after_refresh = act(&app, port, 1).await;
    assert_ne!(after_refresh["token"], learned["token"]);
    assert_eq!(current(&app).await["scope"], a_scope["scope"]);

    host.state::<SessionManager>().stop(&host).unwrap();
    app.state::<ClientCoordinator>().poll().await;
    phase(&app, "ended").await;
    let ended = act(&app, port, 2).await;
    assert_eq!(ended["token"], after_refresh["token"]);

    assert_eq!(start(&host, &data, &b, &lan).await, entry);
    app.state::<ClientCoordinator>().poll().await;
    phase(&app, "changed").await;
    let while_candidate = act(&app, port, 3).await;
    assert_eq!(while_candidate["token"], after_refresh["token"]);
    assert_eq!(current(&app).await["scope"], a_scope["scope"]);
    wait_join(&app).await;
    let new_scope = current(&app).await;
    assert_ne!(new_scope["scope"]["key"], a_scope["scope"]["key"]);
    assert_eq!(new_scope["mappings"], json!([]));
    let switched = result(&app).await;
    assert_ne!(switched["token"], after_refresh["token"]);
    leave(&app).await;

    assert_eq!(start(&host, &data, &a, &lan).await, entry);
    inspect(&app, &relay.address).await;
    wait_join(&app).await;
    assert_eq!(current(&app).await["scope"], a_scope["scope"]);
    let restored = act(&app, port, 1).await;
    let declared = declared::exercise(&app, port, declared::Role::Client).await;
    assert_ne!(restored["token"], learned["token"]);
    leave(&app).await;
    json!({
        "result": "passed",
        "role": "client",
        "source": "UDP loopback",
        "learned": learned,
        "disconnected": disconnected,
        "recovered": recovered,
        "afterRefresh": after_refresh,
        "ended": ended,
        "whileCandidate": while_candidate,
        "switched": switched,
        "restored": restored,
        "declaredTargets": declared
    })
}
