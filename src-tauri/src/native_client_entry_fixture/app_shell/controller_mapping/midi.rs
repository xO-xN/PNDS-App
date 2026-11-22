//! External input is a virtual Core MIDI source through the normal OS path.
use super::*;
use crate::controller_mapping::VirtualMidiSource;

const NOTE_ON: u8 = 0x9;
const NOTE_OFF: u8 = 0x8;
const NOTE: u8 = 60;
const A: &str = "PNDS Mapping Fixture A";
const B: &str = "PNDS Mapping Fixture B";

pub(super) async fn select_port(app: &AppHandle, source: &VirtualMidiSource, enabled: bool) {
    let id = source.id();
    let selector = format!("#controller-midi-port-{id}");
    await_shell(
        app,
        &format!("JSON.stringify(!!document.querySelector({selector:?}) && !document.querySelector({selector:?}).disabled)"),
    )
    .await;
    shell(
        app,
        &format!("document.querySelector({selector:?}).click();JSON.stringify(true)"),
    )
    .await;
    await_shell(
        app,
        &format!(
            "JSON.stringify(document.querySelector({selector:?})?.getAttribute('aria-checked')==='{enabled}')"
        ),
    )
    .await;
}

pub(super) async fn close_settings(app: &AppHandle) {
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
}

pub(super) async fn toggle_learning(app: &AppHandle, learning: bool) {
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

pub(super) async fn select_control(app: &AppHandle, selector: &str, name: &str) {
    click_target(app, selector).await;
    await_shell(
        app,
        &format!(
            "JSON.stringify(globalThis.fixtureControllerSnapshot()?.pending?.name==={name:?})"
        ),
    )
    .await;
}

async fn await_label(app: &AppHandle, source: &str, channel: u8) {
    let label = format!("{source} · Ch {channel} · Note {NOTE}");
    await_score(
        app,
        &format!("JSON.stringify(Array.from(document.querySelectorAll('[data-pnds-controller-address]')).some(badge=>badge.textContent==={label:?}))"),
    )
    .await;
}

pub(super) async fn exercise(app: &AppHandle) -> Value {
    let before_note = score(app, "JSON.stringify(globalThis.controllerActions ?? 0)")
        .await
        .as_u64()
        .unwrap();
    let after_note = before_note + 1;
    let first = VirtualMidiSource::new(A).unwrap();
    let second = VirtualMidiSource::new(B).unwrap();
    shell(
        app,
        "globalThis.fixtureOpenControllerSettings();JSON.stringify(true)",
    )
    .await;
    select_port(app, &first, true).await;

    // A Settings toggle uses the port's real stable endpoint ID.
    first.send(NOTE_OFF, 7, 40, 64);
    let id = first.id();
    await_shell(
        app,
        &format!("JSON.stringify(!!document.getElementById('controller-midi-recent-{id}')?.textContent?.includes('Ch 7 · Note 40'))"),
    )
    .await;
    close_settings(app).await;
    toggle_learning(app, true).await;
    select_control(app, "#fixture-controller-stable", "Original action").await;
    second.send(NOTE_ON, 1, NOTE, 100);
    first.send(NOTE_OFF, 1, NOTE, 64);
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(
        shell(
            app,
            "JSON.stringify(globalThis.fixtureControllerSnapshot()?.pending?.name)"
        )
        .await,
        "Original action"
    );
    first.send(NOTE_ON, 1, NOTE, 100);
    await_label(app, A, 1).await;
    select_control(app, "#fixture-controller-switch", "Original switch").await;
    first.send(NOTE_ON, 2, NOTE, 100);
    await_label(app, A, 2).await;
    toggle_learning(app, false).await;

    first.send(NOTE_ON, 1, NOTE, 100);
    first.send(NOTE_ON, 2, NOTE, 100);
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(
        score(
            app,
            "JSON.stringify([globalThis.controllerActions, document.querySelector('#fixture-controller-switch').checked])"
        )
        .await,
        json!([before_note, false])
    );
    first.send(NOTE_ON, 1, NOTE, 0);
    first.send(NOTE_ON, 1, NOTE, 100);
    first.send(NOTE_ON, 1, NOTE, 100);
    first.send(NOTE_ON, 1, NOTE, 100);
    await_score(
        app,
        &format!("JSON.stringify(globalThis.controllerActions==={after_note})"),
    )
    .await;
    first.send(NOTE_OFF, 2, NOTE, 64);
    first.send(NOTE_ON, 2, NOTE, 100);
    first.send(NOTE_ON, 2, NOTE, 100);
    await_score(
        app,
        "JSON.stringify(document.querySelector('#fixture-controller-switch').checked===true && document.querySelector('#fixture-controller-switch-status').textContent==='on')",
    )
    .await;

    shell(
        app,
        "globalThis.fixtureOpenControllerSettings();JSON.stringify(true)",
    )
    .await;
    select_port(app, &second, true).await;
    close_settings(app).await;
    toggle_learning(app, true).await;
    select_control(app, "#fixture-controller-second", "Second MIDI action").await;
    second.send(NOTE_ON, 1, NOTE, 100);
    await_label(app, B, 1).await;
    toggle_learning(app, false).await;
    second.send(NOTE_OFF, 1, NOTE, 64);
    second.send(NOTE_ON, 1, NOTE, 100);
    await_score(
        app,
        &format!("JSON.stringify(globalThis.controllerSecondActions===1 && globalThis.controllerActions==={after_note})"),
    )
    .await;

    let preferences = crate::commands::preferences::load_preferences_sync(app).unwrap();
    let saved = preferences.controller_mapping.unwrap();
    assert_eq!(saved.groups[0].mappings.len(), 3);
    assert!(saved.midi_ports.contains(&first.id()) && saved.midi_ports.contains(&second.id()));

    let before_reopen = shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.page)",
    )
    .await;
    shell(
        app,
        "document.querySelector('[data-performance-action=close]').click();JSON.stringify(true)",
    )
    .await;
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.page===null && globalThis.fixtureProbe().session==='idle' && !document.querySelector('[data-selected-card]'))",
    )
    .await;
    shell(app, "globalThis.fixtureSidebar(true);JSON.stringify(true)").await;
    await_shell(
        app,
        "JSON.stringify(!!document.querySelector('[data-project-path]'))",
    )
    .await;
    shell(app, "Array.from(document.querySelectorAll('[data-project-path]')).find(card => card.dataset.projectPath===globalThis.__PNDS_SHELL_CONFIG__.project).click();JSON.stringify(true)").await;
    await_shell(
        app,
        "JSON.stringify(!!document.querySelector('[data-performance-action=load]:not(:disabled)'))",
    )
    .await;
    shell(
        app,
        "globalThis.fixtureStart();globalThis.fixtureSidebar(false);JSON.stringify(true)",
    )
    .await;
    await_shell(app, &format!("JSON.stringify(!!globalThis.fixtureControllerSnapshot()?.page && globalThis.fixtureControllerSnapshot()?.page!=={before_reopen} && globalThis.fixtureControllerSnapshot()?.mappings.length===3)")).await;
    first.send(NOTE_OFF, 1, NOTE, 64);
    first.send(NOTE_ON, 1, NOTE, 100);
    first.send(NOTE_OFF, 2, NOTE, 64);
    first.send(NOTE_ON, 2, NOTE, 100);
    second.send(NOTE_OFF, 1, NOTE, 64);
    second.send(NOTE_ON, 1, NOTE, 100);
    await_score(app, "JSON.stringify(globalThis.controllerActions===1 && globalThis.controllerSecondActions===1 && document.querySelector('#fixture-controller-switch-status').textContent==='on')").await;

    shell(
        app,
        "globalThis.fixtureOpenControllerSettings();JSON.stringify(true)",
    )
    .await;
    select_port(app, &first, false).await;
    first.send(NOTE_OFF, 1, NOTE, 64);
    first.send(NOTE_ON, 1, NOTE, 100);
    select_port(app, &second, false).await;
    for name in ["Original action", "Original switch", "Second MIDI action"] {
        let selector = format!("[aria-label='Remove mapping for {name}']");
        shell(
            app,
            &format!("document.querySelector({selector:?}).click();JSON.stringify(true)"),
        )
        .await;
    }
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.mappings.length===0)",
    )
    .await;
    close_settings(app).await;
    assert_eq!(
        score(app, "JSON.stringify(globalThis.controllerActions)").await,
        1
    );
    json!({"result":"passed","source":"virtual Core MIDI","ports":2,"channels":2,"reopened":true})
}
