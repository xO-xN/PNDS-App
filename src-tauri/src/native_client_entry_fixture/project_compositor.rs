//! Real own-window pixels and AppKit clicks through the production compositor.
use super::*;

pub(super) async fn verify(app: &AppHandle, directory: &Path, target: ProjectMediaTarget) -> Value {
    evaluate(app, "main", INSTRUMENT).await;
    evaluate(app,"main","globalThis.fixtureScoreClicks=0;const paint=document.createElement('div');paint.id='fixture-paint';paint.style.cssText='position:fixed;inset:0;background:#00ff80;z-index:2147483647';paint.addEventListener('pointerdown',()=>fixtureScoreClicks++);document.body.append(paint);JSON.stringify(true)").await;
    project_media_view::fixture_shell_evaluate(app.clone(),"main","document.documentElement.style.background='transparent';document.body.style.cssText='margin:0;background:transparent';document.body.innerHTML='<button id=fixture-chrome style=\"position:absolute;left:20px;top:20px;width:120px;height:100px;border:0;border-radius:20px;background:rgba(255,255,255,.7);box-shadow:0 0 6px #0004\">Chrome</button>';globalThis.fixtureChromeClicks=0;document.getElementById('fixture-chrome').onclick=()=>fixtureChromeClicks++;JSON.stringify(true)").await.unwrap();
    let mut measured = page_bounds(app, "main").await;
    measured
        .occlusions
        .push(crate::project_media_view::ProjectMediaOcclusion {
            x: 12.0,
            y: 12.0,
            width: 136.0,
            height: 116.0,
        });
    project_media_view::sync(
        app.clone(),
        "main".into(),
        "tauri://localhost".into(),
        target.clone(),
        1000.0,
        Some(measured.clone()),
    )
    .await
    .unwrap();
    let before = foreground(app, "main").await;
    tokio::time::sleep(Duration::from_millis(180)).await;
    let points = vec![
        (15.0, 105.0),
        (22.0, 118.0),
        (80.0, 60.0),
        (200.0, 180.0),
        (5.0, 50.0),
        (595.0, 5.0),
        (5.0, 415.0),
        (595.0, 415.0),
    ];
    let visible = project_media_view::fixture::capture(
        app.clone(),
        "main",
        directory.join("compositor-visible.png"),
        points.clone(),
    )
    .await
    .unwrap();
    let rgb = |proof: &Value, index: usize, channel: usize| {
        proof["samples"][index]["rgb"][channel].as_f64().unwrap()
    };
    assert!(
        (0..3).all(|c| (rgb(&visible, 0, c) - rgb(&visible, 3, c)).abs() < 0.15),
        "Sidebar wrapper paints an opaque rectangle around the rounded control: {visible}"
    );
    assert!(
        rgb(&visible, 2, 0) > rgb(&visible, 3, 0) + 0.2 && rgb(&visible, 2, 0) < 0.98,
        "Translucent App chrome did not composite over the live score: {visible}"
    );
    assert!(
        rgb(&visible, 3, 1) - rgb(&visible, 3, 0) > 0.3,
        "Score beside App chrome disappeared: {visible}"
    );
    for index in 4..8 {
        assert!(
            (0..3).all(
                |channel| (rgb(&visible, index, channel) - rgb(&visible, 3, channel)).abs() < 0.08
            ),
            "The native surface's unrounded stage corner lost its score: {visible}"
        );
    }
    project_media_view::fixture_shell_evaluate(
        app.clone(),
        "main",
        "document.getElementById('fixture-chrome').style.opacity='.4';JSON.stringify(true)",
    )
    .await
    .unwrap();
    evaluate(
        app,
        "main",
        "document.getElementById('fixture-paint').style.background='#0050ff';JSON.stringify(true)",
    )
    .await;
    tokio::time::sleep(Duration::from_millis(180)).await;
    let fading = project_media_view::fixture::capture(
        app.clone(),
        "main",
        directory.join("compositor-fading.png"),
        points,
    )
    .await
    .unwrap();
    assert!(
        (0..3).all(|c| (rgb(&fading, 0, c) - rgb(&fading, 3, c)).abs() < 0.15)
            && (0..3).any(|c| (rgb(&fading, 3, c) - rgb(&visible, 3, c)).abs() > 0.3),
        "Fading chrome lost the continuously changing score pixels: {fading}"
    );
    let chrome_hit = project_media_view::fixture_click(app.clone(), "main".into(), 60.0, 60.0)
        .await
        .unwrap();
    assert_eq!(chrome_hit["hitNativePage"], false, "{chrome_hit}");
    let score_hit = project_media_view::fixture_click(app.clone(), "main".into(), 200.0, 180.0)
        .await
        .unwrap();
    assert_eq!(score_hit["hitNativePage"], true, "{score_hit}");
    tokio::time::sleep(Duration::from_millis(80)).await;
    let chrome_clicks = project_media_view::fixture_shell_evaluate(
        app.clone(),
        "main",
        "JSON.stringify(fixtureChromeClicks)",
    )
    .await
    .unwrap();
    let score_clicks = evaluate(app, "main", "JSON.stringify(fixtureScoreClicks)").await;
    assert_eq!(
        chrome_clicks, 1,
        "App chrome did not receive the real native mouse click"
    );
    assert_eq!(
        score_clicks, 1,
        "Visible score outside chrome did not receive the real native mouse click"
    );
    measured.occlusions = vec![crate::project_media_view::ProjectMediaOcclusion {
        x: 0.0,
        y: 0.0,
        width: measured.width,
        height: measured.height,
    }];
    project_media_view::sync(
        app.clone(),
        "main".into(),
        "tauri://localhost".into(),
        target.clone(),
        1001.0,
        Some(measured.clone()),
    )
    .await
    .unwrap();
    let ownership = project_media_view::fixture::ownership(app.clone(), "main")
        .await
        .unwrap();
    assert_eq!(
        ownership["shell"], true,
        "Opening App overlays must return the native first responder: {ownership}"
    );
    project_media_view::fixture_shell_evaluate(app.clone(),"main","const dim=document.createElement('div');dim.id='fixture-dialog-dim';dim.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.4)';const input=document.createElement('input');input.id='fixture-dialog-input';input.style.cssText='position:absolute;left:220px;top:220px';dim.append(input);document.body.append(dim);input.focus();JSON.stringify(true)").await.unwrap();
    project_media_view::fixture::keys(app.clone(), "main", "z", 6, 0)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    let typed = project_media_view::fixture_shell_evaluate(
        app.clone(),
        "main",
        "JSON.stringify(document.getElementById('fixture-dialog-input').value)",
    )
    .await
    .unwrap();
    assert_eq!(
        typed, "z",
        "The App's focused overlay input did not receive a real native key event"
    );
    let modal_pixels = project_media_view::fixture::capture(
        app.clone(),
        "main",
        directory.join("compositor-dialog.png"),
        vec![(200.0, 180.0)],
    )
    .await
    .unwrap();
    assert!(
        modal_pixels["samples"][0]["rgb"][2].as_f64().unwrap() > 0.4,
        "App dialog dimming replaced the live score with a window background: {modal_pixels}"
    );
    let modal_hit = project_media_view::fixture_click(app.clone(), "main".into(), 200.0, 180.0)
        .await
        .unwrap();
    assert_eq!(
        modal_hit["hitNativePage"], false,
        "Open App overlays must own outside-dismiss input"
    );
    project_media_view::fixture_shell_evaluate(
        app.clone(),
        "main",
        "document.getElementById('fixture-dialog-dim').remove();JSON.stringify(true)",
    )
    .await
    .unwrap();
    measured.occlusions.clear();
    project_media_view::sync(
        app.clone(),
        "main".into(),
        "tauri://localhost".into(),
        target,
        1002.0,
        Some(measured),
    )
    .await
    .unwrap();
    let after = evaluate(app, "main", PROBE).await;
    assert_eq!(before["token"], after["token"]);
    assert_eq!(before["timeOrigin"], after["timeOrigin"]);
    assert!(after["ticks"].as_u64().unwrap() > before["ticks"].as_u64().unwrap());
    assert!(after["workerTicks"].as_u64().unwrap() > before["workerTicks"].as_u64().unwrap());
    json!({"nativeCornerRadius":0,"visible":visible,"fading":fading,"dialog":modal_pixels,"overlayNativeFocus":ownership,"typedOverlayText":typed,"chromeHit":chrome_hit,"scoreHit":score_hit,"modalInputHit":modal_hit,"before":before,"after":after})
}
