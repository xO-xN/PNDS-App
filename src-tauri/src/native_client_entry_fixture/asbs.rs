//! Actual maintained ASBS through production native preparation and handoff.
use super::*;
#[path = "../asbs_fixture.rs"]
mod source;

async fn evaluate(app: &AppHandle, script: &str) -> Value {
    client_score_view::fixture_evaluate(app.clone(), false, script)
        .await
        .unwrap()
}
async fn wait(app: &AppHandle, expression: &str) {
    wait_for(app, expression, 20).await;
}
async fn wait_for(app: &AppHandle, expression: &str, seconds: u64) {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    loop {
        if evaluate(app, &format!("JSON.stringify({expression})")).await == json!(true) {
            return;
        }
        assert!(Instant::now() < deadline, "ASBS did not reach {expression}");
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}
pub(super) async fn exercise(app: AppHandle, directory: PathBuf) -> Value {
    let host = tauri::test::mock_app().handle().clone();
    crate::events::events_builder().mount_events(&host);
    host.manage(PreferencesCache::for_test(AppPreferences {
        node_name: Some("ASBS Host".into()),
        ..Default::default()
    }));
    host.manage(SessionManager::default());
    struct Cleanup(AppHandle<tauri::test::MockRuntime>);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = self.0.state::<SessionManager>().stop(&self.0);
        }
    }
    let _cleanup = Cleanup(host.clone());
    let lan = crate::project::session::list_lan_addresses()
        .unwrap()
        .into_iter()
        .next()
        .unwrap();
    let a = project(&directory, "A", false);
    let asbs = source::project(&directory);
    let host_data = directory.join("host");
    let client_data = directory.join("client");
    let entry = start(&host, &host_data, &a, &lan).await;
    let client = app.state::<ClientCoordinator>();
    let cleanup_app = app.clone();
    client.set_view_cleanup(Arc::new(move || client_score_view::close(&cleanup_app)));
    let prepare_app = app.clone();
    client.set_view_prepare(Arc::new(move |target| {
        Box::pin(client_score_view::prepare(prepare_app.clone(), target))
    }));
    let commit_app = app.clone();
    client.set_view_commit(Arc::new(move |target| {
        client_score_view::commit(commit_app.clone(), target)
    }));
    let cancel_app = app.clone();
    client.set_view_cancel(Arc::new(move |target| {
        client_score_view::cancel(cancel_app.clone(), target)
    }));
    client
        .inspect_guarded(entry.clone(), None, || false)
        .await
        .unwrap();
    let first = client
        .enter(&client_data, client.snapshot().host.unwrap())
        .await
        .unwrap();
    assert_eq!(first.phase, ClientPhase::Open);
    let first_url = first.page_url.unwrap();
    show(&app, first_url.clone(), 1.0).await;
    let original = probe(&app, false).await;
    assert_eq!(start(&host, &host_data, &asbs, &lan).await, entry);
    source::hide_middle(&asbs);
    let candidate = client.poll().await.host.unwrap();
    let failed = client.enter(&client_data, candidate.clone()).await.unwrap();
    assert_eq!(failed.page_url.as_deref(), Some(first_url.as_str()));
    assert_eq!(
        failed.error.unwrap().code,
        "participation.errors.preparationFailed"
    );
    let retained = probe(&app, false).await;
    preserved(&original, &retained);
    source::restore_middle(&asbs);
    let c = project(&directory, "C", false);
    let race_app = app.clone();
    let race_data = client_data.clone();
    let race = tokio::spawn(async move {
        race_app
            .state::<ClientCoordinator>()
            .enter(&race_data, candidate)
            .await
    });
    wait_staged(&app).await;
    assert_eq!(start(&host, &host_data, &c, &lan).await, entry);
    client.poll().await;
    let raced = race.await.unwrap().unwrap();
    assert_eq!(raced.page_url.as_deref(), Some(first_url.as_str()));
    let after_race = probe(&app, false).await;
    preserved(&retained, &after_race);
    assert_eq!(start(&host, &host_data, &asbs, &lan).await, entry);
    let candidate = client.poll().await.host.unwrap();
    let joined = client.enter(&client_data, candidate).await.unwrap();
    assert_eq!(joined.phase, ClientPhase::Open, "{joined:?}");
    show(&app, joined.page_url.unwrap(), 2.0).await;
    let prepared = probe(&app, false).await;
    assert_eq!(prepared["prepared"], true);
    assert_ne!(prepared["token"], retained["token"]);
    assert_eq!(
        evaluate(
            &app,
            "JSON.stringify(document.querySelectorAll('.group-tile').length)"
        )
        .await,
        4
    );
    evaluate(
        &app,
        "document.querySelector('.group-tile').click();JSON.stringify(true)",
    )
    .await;
    wait(&app, "!!document.querySelector('.number-tile')").await;
    evaluate(
        &app,
        "document.querySelector('.number-tile').click();JSON.stringify(true)",
    )
    .await;
    wait(
        &app,
        "document.querySelector('.preparation-cue')?.dataset.state==='ready'",
    )
    .await;
    evaluate(&app, "window.__asbsAdvance(0);JSON.stringify(true)").await;
    wait(
        &app,
        "(window.__asbsAdvance(0),window.__asbsEvidence.drawn.some(p=>p.endsWith('A1P1.png')))",
    )
    .await;
    let before = evaluate(&app, "JSON.stringify(window.__asbsEvidence)").await;
    assert!(!before["decoded"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value.as_str().unwrap_or("").contains("A1P15.png")));
    evaluate(&app, "window.fixtureWork=(async()=>{const s=window.io(location.origin,{...window.PNDS_PARTICIPATION.socketOptions});window.asbsControl=s;let state; s.on('state',v=>state=v);await new Promise((resolve,reject)=>{s.on('connect',()=>{s.emit('monitor');s.emit('claim')});let n=0;const t=setInterval(()=>{if(state?.conductor?.claimed&&state.conductor.id===s.id){clearInterval(t);s.emit('start');resolve(true)}else if(++n>200){clearInterval(t);reject(Error('conductor'))}},20)});await new Promise(r=>setTimeout(r,100));window.fixtureStarted=true;return true})();JSON.stringify(true)").await;
    wait(&app, "window.fixtureStarted===true").await;
    evaluate(&app, "window.fixturePacketCount=window.__asbsEvidence.positions;window.__asbsSockets[0].disconnect();window.__asbsAdvance(2000);JSON.stringify(true)").await;
    wait(&app, "!!document.querySelector('.signal-cue')").await;
    evaluate(
        &app,
        "window.__asbsSockets[0].connect();JSON.stringify(true)",
    )
    .await;
    wait(&app, "window.__asbsSockets[0].connected&&window.__asbsEvidence.positions>window.fixturePacketCount").await;
    evaluate(&app, "window.__asbsAdvance(0);JSON.stringify(true)").await;
    wait(&app, "!document.querySelector('.signal-cue')").await;
    assert_eq!(probe(&app, false).await["token"], prepared["token"]);
    // Publishing C must retain the actual loaded ASBS, not only the Blank
    // document used earlier to test candidate preparation rollback.
    let before_candidate = probe(&app, false).await;
    let loaded_url = client.snapshot().page_url;
    assert_eq!(start(&host, &host_data, &c, &lan).await, entry);
    let discovered = client.poll().await;
    assert_eq!(discovered.page_url, loaded_url);
    let after_candidate = probe(&app, false).await;
    preserved(&before_candidate, &after_candidate);
    evaluate(&app, "window.fixtureFenceStatus=0;fetch(new URL('part-index.json',location.href)).then(response=>window.fixtureFenceStatus=response.status);JSON.stringify(true)").await;
    wait(&app, "window.fixtureFenceStatus===410").await;
    host.state::<SessionManager>().stop(&host).unwrap();
    client.poll().await;
    evaluate(&app, "window.asbsControl.close();window.fixtureWork=(async()=>{for(let tick=0;tick<6000&&!document.querySelector('.finished-cue');tick++)await window.__asbsAdvance(500);for(let tick=0;tick<30;tick++)await window.__asbsAdvance(0);window.fixtureFinished=true;return true})();JSON.stringify(true)").await;
    wait_for(&app, "window.fixtureFinished===true", 60).await;
    let after = evaluate(&app, "JSON.stringify(window.__asbsEvidence)").await;
    assert_eq!(after["document"], before["document"]);
    assert_eq!(
        after["resourceRequests"].as_array().unwrap().len(),
        before["resourceRequests"].as_array().unwrap().len()
    );
    for page in ["A1P15.png", "A1end.png"] {
        assert!(
            after["drawn"]
                .as_array()
                .unwrap()
                .iter()
                .any(|value| value.as_str().unwrap_or("").contains(page)),
            "{after}"
        );
    }
    assert_eq!(
        evaluate(
            &app,
            "JSON.stringify(!!document.querySelector('.finished-cue'))"
        )
        .await,
        true
    );
    assert_eq!(probe(&app, false).await["token"], prepared["token"]);
    assert!(!app.state::<SessionManager>().has_active_session());
    assert_eq!(client.leave().phase, ClientPhase::Idle);
    json!({"result":"passed","project":"maintained ASBS 2.1.1","path":"real independent SessionManager Host → production native ClientCoordinator prepare/commit → actual ASBS page","failedCandidateRetainedOldDocument":retained,"candidateRaceRetainedOldDocument":after_race,"sameContextTransportRecovery":true,"loadedAsbsRetainedForNewCandidate":after_candidate,"oldAsbsSourceRejectedAfterNewCandidate":true,"prepared":prepared,"beforeHostLoss":before,"afterHostLoss":after,"hostStoppedAndNativeSourceRevoked":true,"clockBoundaryAccelerated":true,"limits":["single executing macOS","not signed installation, physical phone or two-machine LAN"]})
}
