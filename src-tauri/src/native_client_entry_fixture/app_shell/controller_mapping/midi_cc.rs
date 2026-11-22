//! Absolute CC uses the actual Core MIDI callback, AppShell and monitor.
use super::*;
use crate::controller_mapping::VirtualMidiSource;
use midi::{close_settings, select_control, select_port, toggle_learning};

const SOURCE: &str = "PNDS Absolute CC Fixture";
const CC: u8 = 0xB;
const CHANNEL: u8 = 3;
const FADER: u8 = 21;
const BUTTON: u8 = 22;
const SWITCH: u8 = 23;
const RANGE_FORM: &str = r#"form[aria-label="Ranges for Score fader"]"#;
const SCORE_FADER: &str = "document.getElementById('fixture-controller-fader')";

async fn open_settings(app: &AppHandle) {
    shell(
        app,
        "globalThis.fixtureOpenControllerSettings();JSON.stringify(true)",
    )
    .await;
}

async fn await_label(app: &AppHandle, controller: u8) {
    let label = format!("{SOURCE} · Ch {CHANNEL} · CC {controller}");
    await_score(
        app,
        &format!("JSON.stringify(Array.from(document.querySelectorAll('[data-pnds-controller-address]')).some(badge=>badge.textContent==={label:?}))"),
    )
    .await;
}

async fn configure_range(app: &AppHandle, reversed: bool) {
    open_settings(app).await;
    await_shell(
        app,
        &format!("JSON.stringify(!!document.querySelector({RANGE_FORM:?}))"),
    )
    .await;
    assert_eq!(
        shell(app, &format!("JSON.stringify((() => {{ const form = document.querySelector({RANGE_FORM:?}); return [form.elements.inputMin.value,form.elements.inputMin.readOnly,form.elements.inputMax.value,form.elements.inputMax.readOnly] }})())")).await,
        json!(["0", true, "127", true])
    );
    shell(app, &format!("(() => {{ const form = document.querySelector({RANGE_FORM:?}); form.elements.targetMin.value = '20'; form.elements.targetMax.value = '80'; const toggle = form.querySelector('[role=switch]'); if (toggle.getAttribute('aria-checked') !== '{reversed}') toggle.click() }})(); JSON.stringify(true)")).await;
    await_shell(app, &format!("JSON.stringify(document.querySelector({RANGE_FORM:?}).querySelector('[role=switch]').getAttribute('aria-checked')==='{reversed}')")).await;
    shell(app, &format!("document.querySelector({RANGE_FORM:?}).querySelector('button[type=submit]').click(); JSON.stringify(true)")).await;
    await_shell(app, &format!("JSON.stringify(globalThis.fixtureControllerSnapshot()?.mappings.some(({{address,range}})=>address.kind==='midiCc' && address.controller==={FADER} && range.inputMin===0 && range.inputMax===127 && range.targetMin===20 && range.targetMax===80 && range.reversed==={reversed}))")).await;
    close_settings(app).await;
}

async fn fader_value(app: &AppHandle, value: u8) {
    await_score(app, &format!("JSON.stringify({SCORE_FADER}.valueAsNumber==={value} && globalThis.controllerFaderInput==={value} && globalThis.controllerFaderChange==={value})")).await;
}

async fn holds_value(app: &AppHandle, value: u8) {
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(
        score(app, &format!("JSON.stringify({SCORE_FADER}.valueAsNumber)")).await,
        value
    );
}

async fn exercise_fader(app: &AppHandle, source: &VirtualMidiSource) {
    toggle_learning(app, true).await;
    select_control(app, "#fixture-controller-fader", "Score fader").await;
    source.send(CC, CHANNEL, FADER, 0);
    await_label(app, FADER).await;
    toggle_learning(app, false).await;

    configure_range(app, false).await;
    score(
        app,
        &format!("{SCORE_FADER}.value='50';JSON.stringify(true)"),
    )
    .await;
    // Neither another channel nor another CC number can catch the mapped fader.
    for (channel, control) in [(CHANNEL + 1, FADER), (CHANNEL, FADER + 1)] {
        source.send(CC, channel, control, 63);
        source.send(CC, channel, control, 127);
    }
    source.send(CC, CHANNEL, FADER, 0);
    source.send(CC, CHANNEL, FADER, 32);
    holds_value(app, 50).await;
    source.send(CC, CHANNEL, FADER, 95);
    fader_value(app, 65).await;
    for (wire, value) in [(63, 50), (127, 80), (0, 20)] {
        source.send(CC, CHANNEL, FADER, wire);
        fader_value(app, value).await;
    }

    // A live project edit away from the configured interval rearms pickup.
    score(
        app,
        &format!("{SCORE_FADER}.value='95';JSON.stringify(true)"),
    )
    .await;
    source.send(CC, CHANNEL, FADER, 100);
    holds_value(app, 95).await;
    source.send(CC, CHANNEL, FADER, 127);
    fader_value(app, 80).await;

    configure_range(app, true).await;
    score(
        app,
        &format!("{SCORE_FADER}.value='5';JSON.stringify(true)"),
    )
    .await;
    source.send(CC, CHANNEL, FADER, 0);
    source.send(CC, CHANNEL, FADER, 63);
    holds_value(app, 5).await;
    for (wire, value) in [(127, 20), (63, 50), (0, 80)] {
        source.send(CC, CHANNEL, FADER, wire);
        fader_value(app, value).await;
    }
}

async fn exercise_buttons(app: &AppHandle, source: &VirtualMidiSource) {
    let old_clicks = score(app, "JSON.stringify(globalThis.controllerActions ?? 0)").await;
    let old_checked = score(
        app,
        "JSON.stringify(document.getElementById('fixture-controller-switch').checked)",
    )
    .await;
    toggle_learning(app, true).await;
    select_control(app, "#fixture-controller-stable", "Original action").await;
    source.send(CC, CHANNEL, BUTTON, 0);
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(
        shell(
            app,
            "JSON.stringify(globalThis.fixtureControllerSnapshot()?.pending?.name)"
        )
        .await,
        "Original action"
    );
    source.send(CC, CHANNEL, BUTTON, 127);
    await_label(app, BUTTON).await;
    select_control(app, "#fixture-controller-switch", "Original switch").await;
    source.send(CC, CHANNEL, SWITCH, 127);
    await_label(app, SWITCH).await;
    toggle_learning(app, false).await;

    for controller in [BUTTON, SWITCH] {
        source.send(CC, CHANNEL, controller, 127);
    }
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(
        score(app, "JSON.stringify(globalThis.controllerActions ?? 0)").await,
        old_clicks
    );
    assert_eq!(
        score(
            app,
            "JSON.stringify(document.getElementById('fixture-controller-switch').checked)"
        )
        .await,
        old_checked
    );

    for controller in [BUTTON, SWITCH] {
        source.send(CC, CHANNEL, controller, 63);
        source.send(CC, CHANNEL, controller, 64);
        source.send(CC, CHANNEL, controller, 127);
    }
    let checked = !old_checked.as_bool().unwrap();
    let expected_status = if checked { "on" } else { "off" };
    let clicks = old_clicks.as_u64().unwrap() + 1;
    await_score(app, &format!("JSON.stringify(globalThis.controllerActions==={clicks} && document.getElementById('fixture-controller-switch').checked==={checked} && document.getElementById('fixture-controller-switch-status').textContent==={expected_status:?})")).await;

    source.send(CC, CHANNEL, BUTTON, 0);
    source.send(CC, CHANNEL, BUTTON, 127);
    let clicks = clicks + 1;
    await_score(
        app,
        &format!("JSON.stringify(globalThis.controllerActions==={clicks})"),
    )
    .await;
}

pub(super) async fn exercise(app: &AppHandle) -> Value {
    let source = VirtualMidiSource::new(SOURCE).unwrap();
    open_settings(app).await;
    select_port(app, &source, true).await;
    source.send(CC, CHANNEL, FADER, 50);
    let id = source.id();
    await_shell(
        app,
        &format!("JSON.stringify(document.getElementById('controller-midi-recent-{id}')?.textContent.includes('Ch {CHANNEL} · CC {FADER}'))"),
    )
    .await;
    close_settings(app).await;

    exercise_fader(app, &source).await;
    // The wrong-number probe above used this controller but must release its
    // physical press before learning it as a button.
    source.send(CC, CHANNEL, BUTTON, 0);
    exercise_buttons(app, &source).await;

    open_settings(app).await;
    select_port(app, &source, false).await;
    for target in ["Score fader", "Original action", "Original switch"] {
        let selector = format!("[aria-label='Remove mapping for {target}']");
        shell(
            app,
            &format!("document.querySelector({selector:?}).click();JSON.stringify(true)"),
        )
        .await;
    }
    await_shell(
        app,
        "JSON.stringify(!globalThis.fixtureControllerSnapshot()?.mappings.some(({address})=>address.kind==='midiCc'))",
    )
    .await;
    close_settings(app).await;
    json!({
        "result":"passed",
        "source":"virtual Core MIDI",
        "inputRange":[0,127],
        "targetRange":[20,80],
        "step":5,
        "pickup":["crossed live value", "upper endpoint", "reversed lower endpoint"],
        "discrete":["button", "switch"]
    })
}
