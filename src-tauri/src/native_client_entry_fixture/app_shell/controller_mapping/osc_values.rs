//! Verify numeric OSC through the device socket and the original score handlers.
use super::*;
use rosc::{OscMessage, OscPacket, OscType};

pub(in super::super) fn install_controls(html: &str) -> String {
    html.replace(
        "</body>",
        r#"<script>
          const fader = document.createElement('input');
          fader.type = 'range';
          fader.id = 'fixture-controller-fader';
          fader.setAttribute('aria-label', 'Score fader');
          fader.min = '0';
          fader.max = '100';
          fader.step = '5';
          fader.value = '50';
          fader.style.cssText = 'position:absolute;left:64%;top:17%;width:130px';
          fader.addEventListener('input', () => {
            globalThis.controllerFaderInput = fader.valueAsNumber;
          });
          fader.addEventListener('change', () => {
            globalThis.controllerFaderChange = fader.valueAsNumber;
          });
          const toggle = document.createElement('input');
          toggle.type = 'checkbox';
          toggle.id = 'fixture-osc-switch';
          toggle.setAttribute('aria-label', 'Score switch');
          toggle.style.cssText = 'position:absolute;left:64%;top:26%';
          toggle.addEventListener('change', () => {
            globalThis.controllerSwitchChanges = (globalThis.controllerSwitchChanges || 0) + 1;
          });
          document.getElementById('fixture-solid-score').append(fader, toggle);
          </script></body>"#,
    )
}

pub(in super::super) fn send_number(
    socket: &UdpSocket,
    destination: (Ipv4Addr, u16),
    address: &str,
    value: f32,
) {
    let packet = rosc::encoder::encode(&OscPacket::Message(OscMessage {
        addr: address.into(),
        args: vec![OscType::Float(value)],
    }))
    .unwrap();
    socket.send_to(&packet, destination).unwrap();
}

pub(super) async fn exercise(app: &AppHandle, port: u16) -> Value {
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
    toggle_learning(app, true).await;
    click_target(app, "#fixture-controller-fader").await;
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.pending?.name==='Score fader')",
    )
    .await;
    let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let destination = (Ipv4Addr::LOCALHOST, port);
    send_number(&socket, destination, "/fader", 1.0);
    await_score(
        app,
        r#"JSON.stringify(!!document.querySelector('[data-pnds-controller-address="/fader"]'))"#,
    )
    .await;
    assert_eq!(
        score(
            app,
            "JSON.stringify(document.getElementById('fixture-controller-fader').valueAsNumber)",
        )
        .await,
        50
    );
    toggle_learning(app, false).await;
    send_number(&socket, destination, "/fader", 0.63);
    await_score(app, "JSON.stringify(document.getElementById('fixture-controller-fader').valueAsNumber===65 && globalThis.controllerFaderInput===65 && globalThis.controllerFaderChange===65)").await;
    exercise_ranges(app, &socket, destination).await;
    exercise_lan(app, &socket, port).await;
    json!({
        "result":"passed",
        "sources":["UDP loopback","controlled LAN interface"],
        "faderValues":[65,80,50,30,20],
        "switchChanges":2
    })
}

async fn exercise_ranges(app: &AppHandle, socket: &UdpSocket, destination: (Ipv4Addr, u16)) {
    shell(
        app,
        "globalThis.fixtureOpenControllerSettings();JSON.stringify(true)",
    )
    .await;
    await_shell(
        app,
        "JSON.stringify(!!document.querySelector('.controller-mapping-range'))",
    )
    .await;
    shell(app, "(() => {const form = document.querySelector('.controller-mapping-range'); for (const [name,value] of Object.entries({inputMax:100,targetMin:20,targetMax:80})) form.elements[name].value=String(value); form.querySelector('[role=switch]').click()})();JSON.stringify(true)").await;
    await_shell(app, "JSON.stringify(document.querySelector('.controller-mapping-range [role=switch]').getAttribute('aria-checked')==='true')").await;
    shell(app, "document.querySelector('.controller-mapping-range button[type=submit]').click();JSON.stringify(true)").await;
    await_shell(app, "JSON.stringify(globalThis.fixtureControllerSnapshot()?.mappings.some(({range})=>range?.inputMax===100&&range?.targetMin===20&&range?.targetMax===80&&range?.reversed))").await;
    shell(
        app,
        "globalThis.fixtureCloseControllerSettings();JSON.stringify(true)",
    )
    .await;
    for (wire, value) in [(-10.0, 80), (50.0, 50), (84.0, 30), (120.0, 20)] {
        send_number(socket, destination, "/fader", wire);
        await_score(app, &format!("JSON.stringify(document.getElementById('fixture-controller-fader').valueAsNumber==={value} && globalThis.controllerFaderInput==={value} && globalThis.controllerFaderChange==={value})")).await;
    }
}

async fn exercise_lan(app: &AppHandle, loopback: &UdpSocket, port: u16) {
    let lan_ip: Ipv4Addr = crate::project::session::list_lan_addresses().unwrap()[0]
        .parse()
        .unwrap();
    let destination = (lan_ip, port);
    // While OSC is local-only another UDP socket can still own this LAN port.
    let blocker = UdpSocket::bind(destination).unwrap();
    let sender = UdpSocket::bind((lan_ip, 0)).unwrap();
    let wrong_sender = "192.0.2.99";

    edit_lan_source(app, wrong_sender).await;
    apply_osc_settings(app).await;
    await_shell(
        app,
        "JSON.stringify(!!document.querySelector('#controller-osc-settings [role=alert]') && !globalThis.fixtureControllerSnapshot()?.preferences.osc.lanEnabled)",
    )
    .await;
    // A failed LAN bind leaves the existing local listener and range in place.
    send_number(loopback, (Ipv4Addr::LOCALHOST, port), "/fader", 50.0);
    await_score(app, "JSON.stringify(globalThis.controllerFaderInput===50)").await;
    drop(blocker);
    apply_osc_settings(app).await;
    await_lan_source(app, wrong_sender).await;

    arm_switch(app).await;
    send_number(&sender, destination, "/fader", 1.0);
    tokio::time::sleep(Duration::from_millis(250)).await;
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.pending?.name==='Score switch' && globalThis.fixtureControllerSnapshot()?.mappings.length===1)",
    )
    .await;
    toggle_learning(app, false).await;
    edit_lan_source(app, &lan_ip.to_string()).await;
    apply_osc_settings(app).await;
    await_lan_source(app, &lan_ip.to_string()).await;

    arm_switch(app).await;
    send_number(&sender, destination, "/fader", 1.0);
    await_score(
        app,
        &format!(r#"JSON.stringify(!!document.querySelector('[data-pnds-controller-address="{lan_ip} · /fader"]'))"#),
    )
    .await;
    assert_eq!(
        score(
            app,
            "JSON.stringify(document.getElementById('fixture-osc-switch').checked)"
        )
        .await,
        false
    );
    toggle_learning(app, false).await;

    send_number(&sender, destination, "/fader", 1.0);
    await_score(app, "JSON.stringify(document.getElementById('fixture-osc-switch').checked && globalThis.controllerSwitchChanges===1 && globalThis.controllerFaderInput===50)").await;
    send_number(&sender, destination, "/fader", 1.0);
    send_number(loopback, (Ipv4Addr::LOCALHOST, port), "/fader", 0.0);
    await_score(app, "JSON.stringify(document.getElementById('fixture-osc-switch').checked && globalThis.controllerSwitchChanges===1 && globalThis.controllerFaderInput===80)").await;
    send_number(&sender, destination, "/fader", 0.0);
    await_score(app, "JSON.stringify(!document.getElementById('fixture-osc-switch').checked && globalThis.controllerSwitchChanges===2 && globalThis.controllerFaderInput===80)").await;
}

async fn edit_lan_source(app: &AppHandle, sender: &str) {
    shell(
        app,
        "globalThis.fixtureOpenControllerSettings();JSON.stringify(true)",
    )
    .await;
    await_shell(
        app,
        "JSON.stringify(!!document.querySelector('#controller-osc-lan'))",
    )
    .await;
    shell(app, "(() => {const lan=document.querySelector('#controller-osc-lan'); if(lan.getAttribute('aria-checked')==='false')lan.click()})();JSON.stringify(true)").await;
    await_shell(
        app,
        "JSON.stringify(!!document.querySelector('#controller-osc-senders'))",
    )
    .await;
    shell(app, &format!("(() => {{const input=document.querySelector('#controller-osc-senders');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,{sender:?});input.dispatchEvent(new Event('input',{{bubbles:true}}))}})();JSON.stringify(true)")).await;
}

async fn apply_osc_settings(app: &AppHandle) {
    await_shell(
        app,
        "JSON.stringify(!!document.querySelector('#controller-osc-settings button[type=submit]:not(:disabled)'))",
    )
    .await;
    shell(app, "document.querySelector('#controller-osc-settings button[type=submit]').click();JSON.stringify(true)").await;
}

async fn await_lan_source(app: &AppHandle, sender: &str) {
    await_shell(app, &format!("JSON.stringify(globalThis.fixtureControllerSnapshot()?.preferences.osc.lanEnabled===true && globalThis.fixtureControllerSnapshot()?.preferences.osc.lanSenders.includes({sender:?}))")).await;
}

async fn arm_switch(app: &AppHandle) {
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
    toggle_learning(app, true).await;
    click_target(app, "#fixture-osc-switch").await;
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.pending?.name==='Score switch')",
    )
    .await;
}

pub(in super::super) async fn toggle_learning(app: &AppHandle, learning: bool) {
    shell(
        app,
        "document.querySelector('.desktop-controller-mapping').click();JSON.stringify(true)",
    )
    .await;
    await_shell(
        app,
        &format!("JSON.stringify(globalThis.fixtureControllerSnapshot()?.learning==={learning})"),
    )
    .await;
}
