//! Created Classic runs through the same public Host and private Client boundary.
use super::*;

fn create_classic(parent: &Path) -> PathBuf {
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let workspace = access
        .create_classic(
            &NewProjectOptions {
                parent: parent.to_string_lossy().into_owned(),
                folder_name: "classic".into(),
                name: "Browser Classic".into(),
                author: String::new(),
                description: String::new(),
                locale: "en".into(),
                git_name: None,
                git_email: None,
            },
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/shared-libraries"),
            &protection,
        )
        .unwrap();
    access
        .commit(&workspace.project.identity, &protection)
        .unwrap();
    PathBuf::from(workspace.project.root)
}

#[tokio::test]
async fn newly_created_classic_uses_actual_ports_browser_confirmation_and_private_client_source() {
    use crate::participation_client::{ClientCoordinator, ClientPhase};
    let projects = tempfile::tempdir().unwrap();
    let root = create_classic(projects.path());
    let data = tempfile::tempdir().unwrap();
    let app = host_app();
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    // Force the default performer preference to move without touching another process.
    let busy = std::net::TcpListener::bind(("0.0.0.0", 0)).unwrap();
    let busy_port = busy.local_addr().unwrap().port();
    let manifest_path = root.join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
    manifest["scoreServer"]["performerPort"] = busy_port.into();
    std::fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    manager
        .start(
            app.clone(),
            data.path().to_owned(),
            StartRequest::new(
                root.to_string_lossy().into_owned(),
                AudioMode::None,
                lan(),
                None,
            ),
        )
        .unwrap();
    let snapshot = wait_finished(&manager);
    assert_eq!(snapshot.status, SessionStatus::Ready, "{snapshot:?}");
    assert_ne!(
        snapshot.applied_ports.as_ref().unwrap().performer_port,
        busy_port
    );
    let entry = snapshot.client_entry_url.unwrap();
    let page = agent()
        .get(&entry)
        .call()
        .unwrap()
        .into_body()
        .read_to_string()
        .unwrap();
    assert!(page.contains("data-state=\"ready\""), "{page}");
    let action = page
        .split("action=\"")
        .nth(1)
        .unwrap()
        .split('"')
        .next()
        .unwrap();
    let confirmed = agent()
        .post(format!("{}{action}", entry.trim_end_matches('/')))
        .send_empty()
        .unwrap();
    assert_eq!(confirmed.status(), hyper::StatusCode::SEE_OTHER);
    let prefix = confirmed
        .headers()
        .get("location")
        .unwrap()
        .to_str()
        .unwrap();
    let browser_url = format!("{}{prefix}", entry.trim_end_matches('/'));
    for resource in [
        "",
        "__config.js?proof=classic",
        "style.css",
        "performer.js",
        "client.js",
        "__pnds/shared/p5.js",
        "__pnds/shared/socket.io.js",
        "__pnds/context.js",
    ] {
        let response = agent()
            .get(format!("{browser_url}{resource}"))
            .call()
            .unwrap()
            .into_body()
            .read_to_string()
            .unwrap();
        assert!(!response.is_empty(), "{resource}");
        if resource.starts_with("__config.js") {
            assert!(response.contains(
                &snapshot
                    .applied_ports
                    .as_ref()
                    .unwrap()
                    .performer_port
                    .to_string()
            ));
        }
    }
    let client_app = tauri::test::mock_app().handle().clone();
    client_app.manage(SessionManager::default());
    client_app.manage(ClientCoordinator::default());
    let client = client_app.state::<ClientCoordinator>();
    client
        .inspect_guarded(entry.clone(), None, || {
            client_app.state::<SessionManager>().has_active_session()
        })
        .await
        .unwrap();
    let client_data = tempfile::tempdir().unwrap();
    assert_eq!(
        client.join(client_data.path()).await.unwrap().phase,
        ClientPhase::Open
    );
    let target = client.view_target().unwrap();
    let browser = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(format!("http://{}", target.proxy_address)).unwrap())
        .build()
        .unwrap();
    let private = reqwest::Url::parse(&target.page_url).unwrap();
    assert_ne!(
        private.origin(),
        reqwest::Url::parse(&entry).unwrap().origin()
    );
    for resource in [
        "__config.js",
        "performer.js",
        "__pnds/shared/p5.js",
        "__pnds/context.js",
    ] {
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
        assert!(!response.is_empty(), "{resource}");
        if resource == "__pnds/context.js" {
            assert!(response.contains("\"basePath\":\"/\""));
        }
    }
    assert!(!client_app.state::<SessionManager>().has_active_session());
    client.leave();
    // The fixture-owned conflict listener remains ours and alive.
    assert!(busy.local_addr().is_ok());
}

#[test]
#[ignore = "opens owned plain WKWebView; actual Classic canvas, resources and transport"]
fn plain_browser_created_classic_prepares_actual_canvas_and_restores_namespaced_claim() {
    let projects = tempfile::tempdir().unwrap();
    let root = create_classic(projects.path());
    verify_classic_browser(&root);
}

#[test]
#[ignore = "uses explicitly selected maintained Template and owned WKWebView"]
fn plain_browser_maintained_template_prepares_actual_canvas() {
    let source =
        std::env::var_os("PNDS_TEMPLATE_SOURCE").expect("set the exact maintained Template path");
    // Execute exact maintained bytes in an owned directory: claim files never
    // write into a creator's source, and no local dependencies are inherited.
    let owned = tempfile::tempdir().unwrap();
    let inventory = include_str!("../../../resources/classic-project/source.sha256");
    for line in inventory.lines() {
        let (_, relative) = line.split_once("  ").unwrap();
        let target = owned.path().join(relative);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::copy(Path::new(&source).join(relative), target).unwrap();
    }
    verify_classic_browser(owned.path());
}

fn verify_classic_browser(root: &Path) {
    let data = tempfile::tempdir().unwrap();
    let evidence = tempfile::tempdir().unwrap();
    let app = host_app();
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    manager
        .start(
            app.clone(),
            data.path().to_owned(),
            StartRequest::new(
                root.to_string_lossy().into_owned(),
                AudioMode::None,
                lan(),
                None,
            ),
        )
        .unwrap();
    let snapshot = wait_finished(&manager);
    assert_eq!(snapshot.status, SessionStatus::Ready, "{snapshot:?}");
    let driver = r#"async function verifyBrowserEntry() {
        const diagnose=()=>({status:document.querySelector('[data-pnds-status]')?.textContent,frames:[...document.querySelectorAll('iframe')].map(f=>({url:f.src,prepared:f.contentWindow.PNDS_PARTICIPATION?.preparation,failed:f.contentWindow.PNDS_PARTICIPATION?.preparationFailure,canvas:Boolean(f.contentDocument?.querySelector('canvas')),joined:f.contentWindow.eval('typeof client!=="undefined" && client.joined'),connected:f.contentWindow.eval('typeof client!=="undefined" && client.connected'),frames:f.contentWindow.p5?.instance?.frameCount,classes:f.className}))});
        const wait=async test=>{const until=Date.now()+8000;while(!test()){if(Date.now()>until)throw new Error('Classic page did not become usable: '+JSON.stringify(diagnose()));await new Promise(r=>setTimeout(r,25));}};
        const form=document.querySelector('form');if(!form)throw new Error('Classic not compatible');form.requestSubmit();
        await wait(()=>document.querySelector('iframe[data-pnds-current]'));
        let frame=document.querySelector('iframe[data-pnds-current]'), win=frame.contentWindow;
        await wait(()=>win.eval('client.joined') && win.document.querySelector('canvas'));
        // The owned offscreen WK window throttles RAF. Invoke p5's public redraw
        // to inspect real piece rendering without claiming foreground cadence.
        await win.p5.instance.redraw(2);
        const context=win.PNDS_PARTICIPATION, key=context.storageKey(win.PNDS.tokenKey), claim=win.localStorage.getItem(key), id=win.eval('client.myId');
        if(!claim || context.preparation?.performanceId!==context.performanceId)throw new Error('Missing real preparation or namespaced claim');
        if(win.localStorage.getItem(win.PNDS.tokenKey)!==null)throw new Error('Unscoped claim written');
        const pixel=Array.from(win.document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data);
        if(JSON.stringify(pixel)!=='[20,22,28,255]')throw new Error('Classic actual canvas failed to draw: '+JSON.stringify(pixel));
        const previousDocument=frame.contentDocument;
        frame.contentWindow.location.reload();
        await wait(()=>frame.contentDocument!==previousDocument && frame.contentWindow.PNDS_PARTICIPATION?.preparation && frame.contentWindow.eval('typeof client!==\"undefined\" && client.joined'));
        win=frame.contentWindow;
        if(win.localStorage.getItem(key)!==claim || win.eval('client.myId')!==id)throw new Error('Classic reload lost its durable project identity');
        const result={passed:true,project:win.PNDS.projectId,pagePreparation:context.preparation,claimRestored:true,pixel,actualPerformerPort:win.PNDS.performerPort};
        return result;
    }"#;
    let mut browser = start_browser(evidence.path(), &snapshot.client_entry_url.unwrap(), driver);
    finish_browser(&mut browser, evidence.path());
}
