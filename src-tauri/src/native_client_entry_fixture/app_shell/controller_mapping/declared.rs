//! Use the same controlled score declaration in both native performance pages.
use super::*;
use crate::client_score_view;

pub(in super::super) const PROJECT_SCRIPT: &str = include_str!("declared-project.js");

#[derive(Clone, Copy)]
pub(in super::super) enum Role {
    Host,
    Client,
}

impl Role {
    pub(super) async fn evaluate(self, app: &AppHandle, source: &str) -> Value {
        match self {
            Self::Host => score(app, source).await,
            Self::Client => client_score_view::fixture_evaluate(app.clone(), false, source)
                .await
                .unwrap(),
        }
    }

    async fn wait(self, app: &AppHandle, source: &str) {
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            let value = self.evaluate(app, source).await;
            if value == true {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "Declared target check: {source}: {value}"
            );
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}

pub(in super::super) async fn exercise(app: &AppHandle, port: u16, role: Role) -> Value {
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.declaredTargets?.length===3)",
    )
    .await;
    osc_values::toggle_learning(app, true).await;
    role.wait(
        app,
        "JSON.stringify(!!document.querySelector('[data-pnds-controller-layer]'))",
    )
    .await;
    match role {
        Role::Host => click_target(app, "#fixture-declared-region").await,
        Role::Client => client_score_view::fixture_click(app.clone(), 0.275)
            .await
            .unwrap(),
    }
    await_shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.pending?.name==='Canvas pulse')",
    )
    .await;
    send("/canvas-pulse", port);
    role.wait(app, r#"JSON.stringify(!!document.querySelector('[data-pnds-controller-address="/canvas-pulse"]') && fixtureDeclaredTargets.result().presses===0)"#).await;
    osc_values::toggle_learning(app, false).await;
    send("/canvas-pulse", port);
    role.wait(
        app,
        "JSON.stringify(fixtureDeclaredTargets.result().presses===1)",
    )
    .await;

    shell(
        app,
        "globalThis.fixtureOpenControllerSettings();JSON.stringify(true)",
    )
    .await;
    learn_from_settings(app, "Wet mix").await;
    numeric("/wet-mix", port, 0.5);
    await_shell(app, "JSON.stringify(globalThis.fixtureControllerSnapshot()?.mappings.some(({target})=>target.name==='Wet mix'))").await;
    shell(app, r#"(() => {
      const form = document.querySelector('[aria-label="Remove mapping for Wet mix"]').closest('li').querySelector('form');
      form.elements.targetMin.value='20'; form.elements.targetMax.value='80'; form.querySelector('button[type=submit]').click()
    })();JSON.stringify(true)"#).await;
    await_shell(app, "JSON.stringify(globalThis.fixtureControllerSnapshot()?.mappings.some(({target,range})=>target.name==='Wet mix'&&range.targetMin===20&&range.targetMax===80))").await;
    learn_from_settings(app, "Latch").await;
    numeric("/latch", port, 1.0);
    await_shell(app, "JSON.stringify(globalThis.fixtureControllerSnapshot()?.mappings.some(({target})=>target.name==='Latch'))").await;
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
    osc_values::toggle_learning(app, false).await;
    numeric("/wet-mix", port, 0.8);
    numeric("/latch", port, 1.0);
    role.wait(app, "JSON.stringify(fixtureDeclaredTargets.result().wetMix===70 && fixtureDeclaredTargets.result().latched)").await;

    role.evaluate(
        app,
        "fixtureDeclaredTargets.removePulse();JSON.stringify(true)",
    )
    .await;
    await_shell(app, "JSON.stringify(globalThis.fixtureControllerSnapshot()?.unavailable.some(id=>id.includes('canvas-pulse')))").await;
    send("/canvas-pulse", port);
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(
        role.evaluate(
            app,
            "JSON.stringify(fixtureDeclaredTargets.result().presses)"
        )
        .await,
        1
    );
    role.evaluate(
        app,
        "fixtureDeclaredTargets.restorePulse();JSON.stringify(true)",
    )
    .await;
    await_shell(app, "JSON.stringify(!globalThis.fixtureControllerSnapshot()?.unavailable.some(id=>id.includes('canvas-pulse')))").await;
    send("/canvas-pulse", port);
    role.wait(
        app,
        "JSON.stringify(fixtureDeclaredTargets.result().presses===2)",
    )
    .await;
    osc_values::toggle_learning(app, true).await;
    role.wait(
        app,
        r#"JSON.stringify((() => {
          const badge = document.querySelector('[data-pnds-controller-address="/canvas-pulse"]');
          const board = document.querySelector('#fixture-declared-region');
          return badge && Math.abs(badge.getBoundingClientRect().left-board.getBoundingClientRect().left)<2
              && !document.querySelector('[data-pnds-controller-address="/wet-mix"]')
        })())"#,
    )
    .await;
    osc_values::toggle_learning(app, false).await;
    let before = role
        .evaluate(app, "JSON.stringify(fixtureDeclaredTargets.result())")
        .await;
    let retired = shell(
        app,
        "JSON.stringify(globalThis.fixtureControllerSnapshot()?.page)",
    )
    .await;
    match role {
        Role::Host => {
            role.evaluate(
                app,
                "setTimeout(()=>location.reload(),40);JSON.stringify(true)",
            )
            .await;
        }
        Role::Client => {
            shell(
                app,
                "void globalThis.fixtureClientRefresh();JSON.stringify(true)",
            )
            .await;
        }
    }
    await_shell(app, &format!("JSON.stringify(!!globalThis.fixtureControllerSnapshot()?.page && globalThis.fixtureControllerSnapshot().page !== {retired} && globalThis.fixtureControllerSnapshot()?.declaredTargets?.length === 3)")).await;
    send("/canvas-pulse", port);
    numeric("/wet-mix", port, 0.8);
    role.wait(app, "JSON.stringify(fixtureDeclaredTargets.result().presses===1 && fixtureDeclaredTargets.result().wetMix===70)").await;
    json!({
        "result": "passed",
        "beforeReload": before,
        "afterReload": role.evaluate(app, "JSON.stringify(fixtureDeclaredTargets.result())").await,
    })
}

async fn learn_from_settings(app: &AppHandle, name: &str) {
    let button = format!(r#"[aria-label="Learn mapping for {name}"]"#);
    await_shell(
        app,
        &format!("JSON.stringify(!!document.querySelector({button:?}))"),
    )
    .await;
    shell(
        app,
        &format!("document.querySelector({button:?}).click();JSON.stringify(true)"),
    )
    .await;
    await_shell(app, &format!("JSON.stringify(globalThis.fixtureControllerSnapshot()?.learning && globalThis.fixtureControllerSnapshot()?.pending?.name==={name:?})")).await;
}

fn numeric(address: &str, port: u16, value: f32) {
    let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    osc_values::send_number(&socket, (Ipv4Addr::LOCALHOST, port), address, value);
}
