use super::*;
use std::io::{Read, Write};
use std::net::TcpStream;

fn request(entry: &HostEntry, method: &str, path: &str) -> String {
    let mut stream = TcpStream::connect(entry.local_addr()).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        entry.local_addr()
    )
    .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    response
}

#[test]
fn ordinary_browser_can_open_idle_entry_without_native_identity_headers() {
    let data = tempfile::tempdir().unwrap();
    let entry = HostEntry::bind(data.path(), "Stage & one", Ipv4Addr::LOCALHOST).unwrap();
    let response = request(&entry, "GET", "/");
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    assert!(response.contains("text/html"));
    assert!(response.contains("Stage &amp; one"));
    assert!(response.contains("data-state=\"waiting\""));
    assert!(entry.info().performance.is_none());
}

#[test]
fn ordinary_browser_root_uses_the_full_mobile_viewport_for_embedded_scores() {
    let data = tempfile::tempdir().unwrap();
    let entry = HostEntry::bind(data.path(), "Landscape stage", Ipv4Addr::LOCALHOST).unwrap();
    let response = request(&entry, "GET", "/");
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    let viewport = response
        .split("<meta")
        .find(|tail| {
            tail.split('>')
                .next()
                .is_some_and(|tag| tag.contains("name=\"viewport\""))
        })
        .and_then(|tail| tail.split('>').next())
        .expect("public entry viewport");
    assert!(viewport.contains("width=device-width"), "{viewport}");
    assert!(viewport.contains("viewport-fit=cover"), "{viewport}");
    assert!(
        !viewport.contains("user-scalable=no") && !viewport.contains("maximum-scale=1"),
        "Management controls must retain browser zoom: {viewport}"
    );
}

#[test]
fn saved_browser_entry_targets_the_host_root_before_and_during_a_performance() {
    let data = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let entry = HostEntry::bind(data.path(), "Stage & one", Ipv4Addr::LOCALHOST).unwrap();
    let saved = request(&entry, "GET", "/__pnds/entry.webmanifest");
    assert!(saved.starts_with("HTTP/1.1 200"), "{saved}");
    let manifest: serde_json::Value =
        serde_json::from_str(saved.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(manifest["id"], "/");
    assert_eq!(manifest["start_url"], "/");
    assert_eq!(manifest["scope"], "/");
    assert_eq!(manifest["name"], "PNDS池谱 · Stage & one");
    assert_eq!(manifest["short_name"], "PNDS池谱");
    let landing = request(&entry, "GET", "/");
    assert!(landing.contains("rel=\"manifest\" href=\"/__pnds/entry.webmanifest\""));
    assert!(landing.contains("rel=\"apple-touch-icon\" href=\"/__pnds/icon.png\""));
    assert!(landing.contains("data-pnds-save"));
    entry
        .begin(HostRun {
            project_root: root.path(),
            project_name: "Temporary project",
            performer_port: 1,
            supports_performer_url: true,
            browser_participation: Some(1),
        })
        .unwrap();
    let running = request(&entry, "GET", "/__pnds/entry.webmanifest");
    let running_manifest: serde_json::Value =
        serde_json::from_str(running.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(manifest, running_manifest);
    entry.stop().unwrap();
    let reopened = request(&entry, "GET", manifest["start_url"].as_str().unwrap());
    assert!(reopened.contains("data-state=\"waiting\""));
    assert!(!reopened.contains("/__pnds/run/"));
    assert!(entry.info().performance.is_none());
}

#[test]
fn browser_save_resources_are_available_locally_without_a_running_project() {
    let data = tempfile::tempdir().unwrap();
    let entry = HostEntry::bind(data.path(), "LAN stage", Ipv4Addr::LOCALHOST).unwrap();
    let client: ureq::Agent = ureq::Agent::config_builder().proxy(None).build().into();
    let base = format!("http://{}", entry.local_addr());
    let mut icon = client
        .get(format!("{base}/__pnds/icon.png"))
        .call()
        .unwrap();
    assert_eq!(icon.headers()["content-type"], "image/png");
    let bytes = icon.body_mut().read_to_vec().unwrap();
    assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    assert_eq!(u32::from_be_bytes(bytes[16..20].try_into().unwrap()), 512);
    for resource in [
        "entry.js",
        "entry-gesture.js",
        "entry.css",
        "entry.webmanifest",
    ] {
        let response = client
            .get(format!("{base}/__pnds/{resource}"))
            .call()
            .unwrap();
        assert_eq!(response.status(), 200);
    }
    for (language, expected) in [("zh-CN", "保存入口"), ("en", "Save entry")] {
        let page = client
            .get(format!("{base}/"))
            .header("accept-language", language)
            .call()
            .unwrap()
            .into_body()
            .read_to_string()
            .unwrap();
        assert!(page.contains(expected), "{page}");
        assert!(page.contains(&format!("lang=\"{language}\"")));
        assert!(!page.contains("https://"));
        assert!(!page.contains("http://"));
    }
    assert!(entry.info().performance.is_none());
}

#[test]
fn browser_must_confirm_the_displayed_run_before_loading_queried_project_resources() {
    let data = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let upstream = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let entry = HostEntry::bind(data.path(), "Stage", Ipv4Addr::LOCALHOST).unwrap();
    entry
        .begin(HostRun {
            project_root: root.path(),
            project_name: "First <project>",
            performer_port: upstream.local_addr().unwrap().port(),
            supports_performer_url: true,
            browser_participation: Some(1),
        })
        .unwrap();
    let info = entry.info();
    let run = info.performance.unwrap();
    let confirm = format!(
        "/__pnds/enter/{}/{}/{}",
        info.host_id, run.project_id, run.performance_id
    );
    let landing = request(&entry, "GET", "/");
    assert!(landing.contains("First &lt;project&gt;"), "{landing}");
    assert!(
        landing.contains(&format!("action=\"{confirm}\"")),
        "{landing}"
    );
    assert!(request(&entry, "GET", "/score.js?part=2").starts_with("HTTP/1.1 409"));
    assert!(request(&entry, "GET", &confirm).starts_with("HTTP/1.1 405"));
    let entered = request(&entry, "POST", &confirm);
    assert!(entered.starts_with("HTTP/1.1 303"), "{entered}");
    let location = entered
        .lines()
        .find_map(|line| line.strip_prefix("location: "))
        .unwrap()
        .trim()
        .to_owned();
    assert!(location.starts_with("/__pnds/run/"));
    let context = request(&entry, "GET", &format!("{location}__pnds/context.js"));
    assert!(context.contains("PNDS_PARTICIPATION"), "{context}");
    assert!(context.contains(&run.project_id));
    assert!(context.contains(&run.performance_id));
    assert!(context.contains(&format!("pnds:{}:{}:", info.host_id, run.project_id)));
    let responder = std::thread::spawn(move || {
        let (mut stream, _) = upstream.accept().unwrap();
        let mut bytes = [0; 4096];
        let size = stream.read(&mut bytes).unwrap();
        assert!(String::from_utf8_lossy(&bytes[..size]).starts_with("GET /score.js?part=2 "));
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nscore")
            .unwrap();
    });
    assert!(request(&entry, "GET", &format!("{location}score.js?part=2")).ends_with("score"));
    responder.join().unwrap();
    entry.stop().unwrap();
    assert!(request(&entry, "POST", &confirm).starts_with("HTTP/1.1 409"));
    entry
        .begin(HostRun {
            project_root: root.path(),
            project_name: "Replacement",
            performer_port: 1,
            supports_performer_url: true,
            browser_participation: Some(1),
        })
        .unwrap();
    assert!(
        request(&entry, "GET", &format!("{location}score.js?part=2")).starts_with("HTTP/1.1 409")
    );
    assert!(request(&entry, "POST", &confirm).starts_with("HTTP/1.1 409"));
}

#[test]
fn full_url_capability_alone_does_not_offer_browser_confirmation_or_legacy_redirect() {
    let data = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let entry = HostEntry::bind(data.path(), "Stage", Ipv4Addr::LOCALHOST).unwrap();
    entry
        .begin(HostRun {
            project_root: root.path(),
            project_name: "Legacy project",
            performer_port: 1,
            supports_performer_url: true,
            browser_participation: None,
        })
        .unwrap();
    let landing = request(&entry, "GET", "/");
    assert!(landing.contains("data-state=\"adaptationRequired\""));
    assert!(!landing.contains("<form"));
    assert!(!landing.contains("location:"));
    let info = entry.info();
    let run = info.performance.unwrap();
    let confirm = format!(
        "/__pnds/enter/{}/{}/{}",
        info.host_id, run.project_id, run.performance_id
    );
    assert!(request(&entry, "POST", &confirm).starts_with("HTTP/1.1 409"));
}

#[test]
fn pond_entry_keeps_brand_fonts_and_gesture_assets_on_the_idle_host() {
    let data = tempfile::tempdir().unwrap();
    let entry = HostEntry::bind(data.path(), "Pond stage", Ipv4Addr::LOCALHOST).unwrap();
    let client: ureq::Agent = ureq::Agent::config_builder().proxy(None).build().into();
    let base = format!("http://{}", entry.local_addr());
    let landing = request(&entry, "GET", "/");
    assert!(landing.contains("data-pnds-waiting"));
    assert!(landing.contains("data-pnds-gesture-template"));
    let loader = landing
        .split("data-pnds-loader")
        .nth(1)
        .unwrap()
        .split('>')
        .next()
        .unwrap();
    assert!(loader.contains("role=\"status\""));
    assert!(landing.contains("src=\"/__pnds/brand.png\""));
    assert!(landing.contains("PNDS池谱"));
    assert!(!landing.contains("<form"));
    assert!(
        landing.find("/__pnds/entry-gesture.js").unwrap()
            < landing.find("/__pnds/entry.js").unwrap()
    );
    let details = landing
        .split("<details")
        .nth(1)
        .unwrap()
        .split("</details>")
        .next()
        .unwrap();
    assert_eq!(details.matches("<p>").count(), 2);
    assert!(!details.contains("You can always use this browser"));

    let mut brand = client
        .get(format!("{base}/__pnds/brand.png"))
        .call()
        .unwrap();
    assert_eq!(brand.headers()["content-type"], "image/png");
    let bytes = brand.body_mut().read_to_vec().unwrap();
    assert_eq!(
        bytes.as_slice(),
        include_bytes!("../../../assets/pnds-icon.png")
    );
    assert_eq!(u32::from_be_bytes(bytes[16..20].try_into().unwrap()), 1024);
    for name in ["manrope-latin.woff2", "comfortaa-latin.woff2"] {
        let mut font = client
            .get(format!("{base}/__pnds/fonts/{name}"))
            .call()
            .unwrap();
        assert_eq!(font.headers()["content-type"], "font/woff2");
        assert_eq!(&font.body_mut().read_to_vec().unwrap()[..4], b"wOF2");
    }
}

#[test]
fn ready_pond_entry_keeps_a_real_confirmation_form_for_no_script_browsers() {
    let data = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let entry = HostEntry::bind(data.path(), "Pond stage", Ipv4Addr::LOCALHOST).unwrap();
    entry
        .begin(HostRun {
            project_root: root.path(),
            project_name: "Ready <score>",
            performer_port: 1,
            supports_performer_url: true,
            browser_participation: Some(1),
        })
        .unwrap();
    let landing = request(&entry, "GET", "/");
    assert!(landing.contains("class=\"is-ready\""));
    assert!(landing.contains("Ready &lt;score&gt;"));
    let form = landing
        .split("<form")
        .nth(1)
        .unwrap()
        .split("</form>")
        .next()
        .unwrap();
    assert!(form.contains("method=\"post\""));
    assert!(form.contains("action=\"/__pnds/enter/"));
    assert!(form.contains("data-pnds-ball"));
    assert!(form.contains("data-pnds-arrow"));
    assert!(form.contains("data-pnds-spinner"));
    assert!(landing.contains("data-pnds-instruction"));
}

#[test]
fn host_text_cannot_be_reinterpreted_as_an_entry_template_token() {
    let data = tempfile::tempdir().unwrap();
    let entry = HostEntry::bind(
        data.path(),
        "{{CONTEXT}} <script>host</script>",
        Ipv4Addr::LOCALHOST,
    )
    .unwrap();
    let landing = request(&entry, "GET", "/");
    assert!(landing.contains("{{CONTEXT}} &lt;script&gt;host&lt;/script&gt;"));
    assert!(!landing.contains("<script>host</script>"));
    assert!(
        landing.contains("data-pnds-host>{{CONTEXT}} &lt;script&gt;host&lt;/script&gt;</strong>")
    );
    assert!(landing.contains("pnds-entry-context"));
}
