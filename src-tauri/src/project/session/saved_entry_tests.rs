//! Save a macOS Internet Location to the Host root, then reopen it in a fresh
//! ordinary WebKit context. Platform Dock/Home Screen UI remains device QA.
use super::*;

#[test]
#[ignore = "opens two owned ordinary WKWebViews for a saved-root round trip"]
fn plain_browser_saved_root_reopens_without_reusing_performance_confirmation() {
    let data = tempfile::tempdir().unwrap();
    let evidence = tempfile::tempdir().unwrap();
    let app = host_app();
    let manager = SessionManager::default();
    let _cleanup = SessionCleanup(&manager, app.clone());
    let entry = manager.prepare_host_entry(data.path(), "Saved LAN Host", lan().parse().unwrap());
    let url = entry.url.unwrap();
    let driver = r#"async function verifyBrowserEntry() {
      const check=(v,m)=>{if(!v)throw new Error(m)};
      const manifest=await (await fetch(document.querySelector('link[rel=manifest]').href)).json();
      check(manifest.start_url==='/' && manifest.id==='/' && manifest.scope==='/', 'Save target is not Host root');
      check(manifest.name==='PNDS池谱 · Saved LAN Host','Wrong saved Host name');
      const icon=new Image(); icon.src=manifest.icons[0].src; await icon.decode();
      check(icon.naturalWidth===512, 'Local icon not decoded');
      check(document.querySelector('[data-pnds-entry]').dataset.state==='waiting', 'Idle entry unavailable');
      const save=document.querySelector('[data-pnds-save]'); save.querySelector('summary').click();
      check(save.open, 'Save guidance cannot be opened');
      check(new URL(save.querySelector('a').href).pathname==='/', 'Guidance saves a temporary path');
      check([...performance.getEntriesByType('resource')].every(r=>new URL(r.name).origin===location.origin), 'External resource required');
      check(!document.querySelector('iframe'), 'Idle visit loaded a performance');
      return {passed:true,manifest,localIcon:true,localResources:true};
    }"#;
    let mut browser = start_browser(evidence.path(), &url, driver);
    finish_browser(&mut browser, evidence.path());
    assert!(!manager.has_active_session());
    assert!(manager.active_child_pids().is_empty());
    // A real Internet Location plist contains only the canonical root URL.
    let shortcut = evidence.path().join("PNDS Host.webloc");
    std::fs::write(&shortcut, format!(r#"<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>URL</key><string>{url}</string></dict></plist>"#)).unwrap();
    let saved = Command::new("plutil")
        .args(["-extract", "URL", "raw", "-o", "-"])
        .arg(&shortcut)
        .output()
        .unwrap();
    assert!(saved.status.success());
    let reopened = String::from_utf8(saved.stdout).unwrap();
    let reopened = reopened.trim();
    let projects = tempfile::tempdir().unwrap();
    let root = create_blank(projects.path());
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
    assert_eq!(wait_finished(&manager).status, SessionStatus::Ready);
    let second = tempfile::tempdir().unwrap();
    let driver = r#"async function verifyBrowserEntry() {
      const deadline=Date.now()+5000;
      while(!document.querySelector('form')) {
        if(Date.now()>deadline)throw new Error('Saved root did not discover new performance');
        await new Promise(r=>setTimeout(r,20));
      }
      if(document.querySelector('iframe'))throw new Error('Reopen reused an old confirmation');
      if(location.pathname!=='/' || location.search || location.hash)throw new Error('Saved temporary context');
      return {passed:true,explicitEntryRequired:true,root:location.href};
    }"#;
    let mut browser = start_browser(second.path(), reopened, driver);
    finish_browser(&mut browser, second.path());
    println!("PASS saved macOS .webloc root: idle local resources/icon, fresh WebKit reopen and explicit new-performance entry");
}
