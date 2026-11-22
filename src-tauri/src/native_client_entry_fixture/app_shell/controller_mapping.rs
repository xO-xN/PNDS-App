//! Drive real App settings, the legacy monitor button, and UDP loopback.
use super::*;

pub(super) mod background;
pub(super) mod declared;
mod midi;
mod midi_cc;
use std::net::{Ipv4Addr, UdpSocket};

pub(super) mod osc_values;

pub(super) async fn shell(app: &AppHandle, source: &str) -> Value {
    project_media_view::fixture_shell_evaluate(app.clone(), "main", source)
        .await
        .unwrap_or_else(|error| panic!("AppShell probe failed: {source}: {error}"))
}

async fn score(app: &AppHandle, source: &str) -> Value {
    project_media_view::fixture_evaluate(app.clone(), "main".into(), source)
        .await
        .unwrap()
}

pub(super) async fn await_shell(app: &AppHandle, source: &str) {
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        let value = shell(app, source).await;
        if value == true {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "AppShell mapping check never became true: {source}: {value}"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn await_score(app: &AppHandle, source: &str) {
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        let value = score(app, source).await;
        if value == true {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "Monitor mapping check never became true: {source}: {value}"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn click_target(app: &AppHandle, selector: &str) {
    let point = score(
        app,
        &format!(
            r#"JSON.stringify((() => {{
                const control = document.querySelector({selector:?});
                const rect = control.getBoundingClientRect();
                const x = rect.left + rect.width / 2;
                const y = rect.top + rect.height / 2;
                const hit = document.elementFromPoint(x, y);
                return {{
                    x: x / innerWidth, y: y / innerHeight,
                    exposed: control.contains(hit),
                    hit: hit?.id || hit?.tagName,
                }};
            }})())"#
        ),
    )
    .await;
    assert_eq!(
        point["exposed"], true,
        "Fixture control {selector} is covered at its click point: {point}"
    );
    let viewport = shell(app, "JSON.stringify(document.querySelector('[data-native-project-page]').getBoundingClientRect().toJSON())").await;
    let x = viewport["x"].as_f64().unwrap()
        + point["x"].as_f64().unwrap() * viewport["width"].as_f64().unwrap();
    let y = viewport["y"].as_f64().unwrap()
        + point["y"].as_f64().unwrap() * viewport["height"].as_f64().unwrap();
    // A just-closed settings dialog can release its DOM before its native
    // occlusion reaches AppKit. Only count the click the score really owns.
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let hit = project_media_view::fixture_click(app.clone(), "main".into(), x, y)
            .await
            .unwrap();
        if hit["hitNativePage"] == true {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "No native page hit for {selector}: {hit}"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

pub(super) fn send(address: &str, port: u16) {
    let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let packet = rosc::encoder::encode(&rosc::OscPacket::Message(rosc::OscMessage {
        addr: address.into(),
        args: Vec::new(),
    }))
    .unwrap();
    socket
        .send_to(&packet, (Ipv4Addr::LOCALHOST, port))
        .unwrap();
}

pub(super) async fn enable_osc(app: &AppHandle) -> u16 {
    let probe_socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = probe_socket.local_addr().unwrap().port();
    drop(probe_socket);
    await_shell(
        app,
        "JSON.stringify(!!document.querySelector('.desktop-controller-mapping'))",
    )
    .await;
    shell(
        app,
        "globalThis.fixtureOpenControllerSettings();JSON.stringify(true)",
    )
    .await;
    await_shell(
        app,
        "JSON.stringify(!!document.querySelector('#controller-osc-port'))",
    )
    .await;
    shell(app, &format!("(() => {{const input = document.querySelector('#controller-osc-port');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,{port:?});input.dispatchEvent(new Event('input', {{bubbles:true}}));document.querySelector('#controller-osc-enabled').click()}})();JSON.stringify(true)")).await;
    await_shell(app, &format!("JSON.stringify(document.querySelector('#controller-osc-port').value==='{port}' && document.querySelector('#controller-osc-enabled').getAttribute('aria-checked')==='true')")).await;
    shell(app, "document.querySelector('#controller-osc-settings button[type=submit]').click();JSON.stringify(true)").await;
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.preferences.osc.enabled === true)",
    )
    .await;
    send("/wire-test", port);
    await_shell(
        app,
        "JSON.stringify(document.querySelector('#controller-osc-latest').value==='/wire-test')",
    )
    .await;
    shell(
        app,
        "globalThis.fixtureCloseControllerSettings();JSON.stringify(true)",
    )
    .await;
    await_shell(
        app,
        "JSON.stringify(!document.querySelector('[role=dialog]'))",
    )
    .await;

    port
}

async fn interrupted_learning_preserves_saved_mapping(app: &AppHandle, port: u16) -> Value {
    const TEMPORARY: &str = "#fixture-controller-ambiguous > button";
    let await_temporary =
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.pending?.temporary===true)";
    click_target(app, TEMPORARY).await;
    await_shell(app, await_temporary).await;
    score(app, "const selected = document.querySelector('#fixture-controller-ambiguous > button'); selected.replaceWith(selected.cloneNode(true)); JSON.stringify(true)").await;
    send("/action", port);
    let preserved = "globalThis.fixtureControllerSnapshot()?.mappings.length===1 && globalThis.fixtureControllerSnapshot()?.mappings[0].target.name==='Original action'";
    await_shell(
        app,
        &format!("JSON.stringify(!globalThis.fixtureControllerSnapshot()?.pending && {preserved})"),
    )
    .await;

    click_target(app, TEMPORARY).await;
    await_shell(app, await_temporary).await;
    let captured = crate::controller_mapping::hold_next_local_osc(app, "/action");
    send("/action", port);
    let old_input = tokio::time::timeout(Duration::from_secs(3), captured)
        .await
        .unwrap()
        .unwrap();
    click_target(app, "#fixture-controller-stable").await;
    let current_selection =
        "globalThis.fixtureControllerSnapshot()?.pending?.name==='Original action'";
    await_shell(app, &format!("JSON.stringify({current_selection})")).await;
    old_input.resume(app).await;
    // A subsequent shell probe observes the same-page ingress replay after
    // its main-thread handoff. It must leave the newer selection armed.
    assert_eq!(
        shell(
            app,
            &format!("JSON.stringify({current_selection} && {preserved})")
        )
        .await,
        true
    );
    json!({"removedSelectionPreservedMapping":true,"queuedInputPreservedNewSelection":true})
}

pub(super) async fn exercise(app: &AppHandle) -> Value {
    let port = enable_osc(app).await;
    shell(
        app,
        "document.querySelector('.desktop-controller-mapping').click();JSON.stringify(true)",
    )
    .await;
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.learning===true)",
    )
    .await;
    click_target(app, "#fixture-controller-stable").await;
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.pending?.name==='Original action')",
    )
    .await;
    assert_eq!(
        score(app, "JSON.stringify(globalThis.controllerActions ?? 0)").await,
        0
    );
    send("/action", port);
    await_score(
        app,
        r#"JSON.stringify(!!document.querySelector('[data-pnds-controller-address="/action"]'))"#,
    )
    .await;
    assert_eq!(
        score(app, "JSON.stringify(globalThis.controllerActions ?? 0)").await,
        0
    );

    let interrupted_learning = interrupted_learning_preserves_saved_mapping(app, port).await;
    click_target(app, "#fixture-controller-ambiguous > button").await;
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.pending?.temporary===true)",
    )
    .await;
    send("/temporary", port);
    await_score(app, r#"JSON.stringify(!!document.querySelector('[data-pnds-controller-address="/temporary"]'))"#).await;
    score(app, "document.querySelector('#fixture-controller-ambiguous > button').replaceWith(document.querySelector('#fixture-controller-ambiguous > button').cloneNode(true)); JSON.stringify(true)").await;
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.mappings.length===1)",
    )
    .await;
    click_target(app, "#fixture-controller-stable").await;
    await_shell(
        app,
        "JSON.stringify(!!globalThis.fixtureControllerSnapshot()?.pending)",
    )
    .await;
    project_media_view::fixture_focus(app.clone(), "main".into())
        .await
        .unwrap();
    project_media_view::fixture::keys(app.clone(), "main", "\u{1b}", 53, 0)
        .await
        .unwrap();
    await_shell(app, "JSON.stringify(globalThis.fixtureControllerSnapshot()?.learning===false && !globalThis.fixtureControllerSnapshot()?.pending)").await;
    send("/action", port);
    await_score(app, "JSON.stringify(globalThis.controllerActions===1)").await;

    score(app, "document.getElementById('fixture-controller-stable').after(document.getElementById('fixture-controller-stable').cloneNode(true));JSON.stringify(true)").await;
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.unavailable.length===1)",
    )
    .await;
    send("/action", port);
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(
        score(app, "JSON.stringify(globalThis.controllerActions)").await,
        1
    );
    let before_reload = shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.page)",
    )
    .await;
    let prefs = crate::commands::preferences::load_preferences_sync(app).unwrap();
    let saved = prefs.controller_mapping.unwrap();
    assert_eq!(saved.groups[0].mappings.len(), 1);
    assert_eq!(saved.groups[0].mappings[0].target.name, "Original action");
    score(
        app,
        "document.querySelectorAll('#fixture-controller-stable')[1].remove();JSON.stringify(true)",
    )
    .await;
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.unavailable.length===0)",
    )
    .await;

    let (reload_capture, retired_input) =
        background::capture_osc(app, background::Presentation::Minimized, "/action", port).await;
    assert_eq!(before_reload, retired_input.page);
    score(
        app,
        "setTimeout(()=>location.reload(),40);JSON.stringify(true)",
    )
    .await;
    await_shell(app, &format!("JSON.stringify(!!globalThis.fixtureControllerSnapshot()?.page&&globalThis.fixtureControllerSnapshot()?.page!=={before_reload}&&globalThis.fixtureControllerSnapshot()?.mappings.length===1)")).await;
    retired_input.resume(app).await;
    send("/action", port);
    await_score(app, "JSON.stringify(globalThis.controllerActions===1)").await;
    let background = background::exercise(
        app,
        declared::Role::Host,
        "#fixture-controller-stable",
        "/action",
        port,
    )
    .await;

    shell(
        app,
        "globalThis.fixtureOpenControllerSettings();JSON.stringify(true)",
    )
    .await;
    await_shell(app, r#"JSON.stringify(!!document.querySelector('#settings-section-controllerMapping [aria-label="Remove mapping for Original action"]'))"#).await;
    shell(app, r#"document.querySelector('#settings-section-controllerMapping [aria-label="Remove mapping for Original action"]').click();JSON.stringify(true)"#).await;
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.mappings.length===0)",
    )
    .await;
    let midi_notes = midi::exercise(app).await;
    let numeric_osc = osc_values::exercise(app, port).await;
    let midi_cc = midi_cc::exercise(app).await;
    let declared_targets = declared::exercise(app, port, declared::Role::Host).await;
    json!({"result":"passed","source":"UDP loopback","role":"host","oldPage":before_reload,"reloadCapture":reload_capture,"port":port,"midiNotes":midi_notes,"numericOsc":numeric_osc,"interruptedLearning":interrupted_learning,"background":background,"midiCc":midi_cc,"declaredTargets":declared_targets})
}
