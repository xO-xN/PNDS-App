//! Use AppShell's Join button and production Client views with a real Host.
use super::controller_mapping::{
    await_shell, background, declared, enable_osc, osc_values, send, shell,
};
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
fixtureButton.style = 'position:fixed;left:51vw;top:37vh;width:17vw;height:30vh;z-index:2147483647';
globalThis.fixtureControllerActions = 0;
fixtureButton.addEventListener('click', () => {
  globalThis.fixtureControllerActions++;
  fixtureButton.dataset.actions = String(globalThis.fixtureControllerActions);
  fixtureButton.dataset.actionAt = String(Date.now());
  fixtureButton.dataset.actionVisibility = document.visibilityState;
});
document.body.append(fixtureButton);

const fixtureFader = document.createElement('input');
fixtureFader.id = 'fixture-client-fader';
fixtureFader.setAttribute('aria-label', 'Client fader');
fixtureFader.type = 'range';
fixtureFader.min = '0';
fixtureFader.max = '100';
fixtureFader.step = '5';
fixtureFader.value = '35';
fixtureFader.style = 'position:fixed;left:70vw;top:45vh;width:10vw;height:10vh;z-index:2147483647';
fixtureFader.addEventListener('input', () => fixtureFader.dataset.input = fixtureFader.value);
fixtureFader.addEventListener('change', () => fixtureFader.dataset.change = fixtureFader.value);
document.body.append(fixtureFader);
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
    wait_for_foreground_client(app).await;
    assert_eq!(
        client_score(
            app,
            "JSON.stringify(!!document.getElementById('fixture-client-action'))"
        )
        .await,
        true,
        "Committed performer did not load the controller fixture action"
    );
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

async fn learn_action(app: &AppHandle, port: u16) {
    shell(
        app,
        "document.querySelector('.desktop-controller-mapping').click();JSON.stringify(true)",
    )
    .await;
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.learning === true)",
    )
    .await;
    wait_score(
        app,
        "JSON.stringify(!!document.querySelector('[data-pnds-controller-layer]'))",
    )
    .await;
    client_score_view::fixture_click(app.clone(), 0.66)
        .await
        .unwrap();
    await_shell(app, "JSON.stringify(globalThis.fixtureControllerSnapshot()?.pending?.name === 'Client local action')").await;
    assert_eq!(
        client_score(app, "JSON.stringify(fixtureControllerActions)").await,
        0
    );
    send("/client-action", port);
    wait_score(app, r#"JSON.stringify(!!document.querySelector('[data-pnds-controller-address="/client-action"]'))"#).await;
    shell(
        app,
        "document.querySelector('.desktop-controller-mapping').click();JSON.stringify(true)",
    )
    .await;
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.learning === false)",
    )
    .await;
}

async fn set_client_fader(app: &AppHandle, port: u16, fraction: f32, expected: u32) -> Value {
    let socket = std::net::UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    osc_values::send_number(
        &socket,
        (Ipv4Addr::LOCALHOST, port),
        "/client-fader",
        fraction,
    );
    wait_score(app, &format!("JSON.stringify((() => {{ const fader = document.getElementById('fixture-client-fader'); return fader.valueAsNumber === {expected} && fader.dataset.input === '{expected}' && fader.dataset.change === '{expected}'; }})())")).await;
    client_score(
        app,
        "JSON.stringify(document.getElementById('fixture-client-fader').valueAsNumber)",
    )
    .await
}

async fn learn_client_fader(app: &AppHandle, port: u16) -> Value {
    osc_values::toggle_learning(app, true).await;
    wait_score(
        app,
        "JSON.stringify(!!document.querySelector('[data-pnds-controller-layer]'))",
    )
    .await;
    let center = client_score(app, "JSON.stringify((() => { const box = document.getElementById('fixture-client-fader').getBoundingClientRect(); return (box.left+box.width/2)/innerWidth; })())").await;
    client_score_view::fixture_click(app.clone(), center.as_f64().unwrap())
        .await
        .unwrap();
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.pending?.name==='Client fader')",
    )
    .await;
    let socket = std::net::UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    osc_values::send_number(&socket, (Ipv4Addr::LOCALHOST, port), "/client-fader", 0.66);
    wait_score(app, r#"JSON.stringify(!!document.querySelector('[data-pnds-controller-address="/client-fader"]') && document.getElementById('fixture-client-fader').valueAsNumber===35 && !document.getElementById('fixture-client-fader').dataset.input)"#).await;
    osc_values::toggle_learning(app, false).await;
    set_client_fader(app, port, 0.62, 60).await
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
    learn_action(&app, port).await;
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

    relay.online.store(false, Ordering::Release);
    app.state::<ClientCoordinator>().poll().await;
    phase(&app, "disconnected").await;
    // The in-process Host fixture has stopped. Its live-session process
    // activity cannot mask App Nap while checking the Client's retained page.
    let retained_page = current(&app).await["page"].clone();
    let background = background::exercise(
        &app,
        declared::Role::Client,
        "#fixture-client-action",
        "/client-action",
        port,
    )
    .await;
    assert_eq!(current(&app).await["page"], retained_page);
    phase(&app, "disconnected").await;

    relay.online.store(true, Ordering::Release);
    assert_eq!(start(&host, &data, &b, &lan).await, entry);
    app.state::<ClientCoordinator>().poll().await;
    phase(&app, "changed").await;
    let while_candidate = act(&app, port, 6).await;
    assert_eq!(while_candidate["token"], after_refresh["token"]);
    let retained_scope = current(&app).await;
    assert_eq!(retained_scope["scope"], a_scope["scope"]);
    let (retirement_interval, delayed) = background::capture_osc(
        &app,
        background::Presentation::Hidden,
        "/client-action",
        port,
    )
    .await;
    assert_eq!(retained_scope["page"], delayed.page);
    assert_eq!(result(&app).await["actions"], while_candidate["actions"]);
    wait_join(&app).await;
    let new_scope = current(&app).await;
    assert_ne!(new_scope["scope"]["key"], a_scope["scope"]["key"]);
    assert_eq!(new_scope["mappings"], json!([]));
    let switched = result(&app).await;
    assert_ne!(switched["token"], after_refresh["token"]);
    learn_action(&app, port).await;
    let before_delayed = act(&app, port, 1).await;
    let retired_page = delayed.page;
    delayed.resume(&app).await;
    // A fresh packet still works. Since it follows the captured packet's
    // delivery, an accidental retarget to B would add an extra action here.
    let after_delayed = act(&app, port, 2).await;
    assert_eq!(before_delayed["token"], after_delayed["token"]);
    let retirement = json!({
        "capture": retirement_interval,
        "retiredPage": retired_page,
        "replacementPage": new_scope["page"],
        "beforeDelayed": before_delayed,
        "afterDelayedAndFresh": after_delayed,
    });
    leave(&app).await;

    assert_eq!(start(&host, &data, &a, &lan).await, entry);
    inspect(&app, &relay.address).await;
    wait_join(&app).await;
    assert_eq!(current(&app).await["scope"], a_scope["scope"]);
    let restored = act(&app, port, 1).await;
    let standard_fader = learn_client_fader(&app, port).await;
    let declared = declared::exercise(&app, port, declared::Role::Client).await;
    let restored_fader = set_client_fader(&app, port, 0.83, 85).await;
    assert_ne!(restored["token"], learned["token"]);
    leave(&app).await;
    json!({
        "result": "passed",
        "role": "client",
        "source": "UDP loopback",
        "learned": learned,
        "disconnected": disconnected,
        "backgroundWhileDisconnected": background,
        "recovered": recovered,
        "afterRefresh": after_refresh,
        "ended": ended,
        "whileCandidate": while_candidate,
        "switched": switched,
        "retirement": retirement,
        "restored": restored,
        "declaredTargets": declared,
        "standardFader":{"afterLearning":standard_fader,"afterReload":restored_fader}
    })
}
