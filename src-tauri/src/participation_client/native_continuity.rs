//! Opt-in real WKWebView proof through the public Client coordinator and proxy.
use super::{tests::HostFixture, ClientCoordinator, ClientPhase};
use serde_json::{json, Value};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

struct NativeProcess(Child);
impl Drop for NativeProcess {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
        }
        let _ = self.0.wait();
    }
}
async fn probe(directory: &Path, child: &mut NativeProcess, step: u32) -> Value {
    std::fs::write(
        directory.join("continuity-command.json"),
        json!({"id":step}).to_string(),
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        assert!(
            child.0.try_wait().unwrap().is_none(),
            "native document exited before step {step}"
        );
        if let Ok(bytes) = std::fs::read(directory.join("continuity-result.json")) {
            if let Ok(reply) = serde_json::from_slice::<Value>(&bytes) {
                if reply["id"] == step {
                    return reply["result"].clone();
                }
            }
        }
        assert!(
            Instant::now() < deadline,
            "native document probe timed out at step {step}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
fn same_document(first: &Value, current: &Value, status: u16) {
    assert_eq!(
        current["token"], first["token"],
        "unsaved memory was replaced"
    );
    assert_eq!(
        current["timeOrigin"], first["timeOrigin"],
        "document navigated"
    );
    assert!(
        current["ticks"].as_u64().unwrap() > first["ticks"].as_u64().unwrap(),
        "local score clock stopped: first={first}, current={current}"
    );
    assert!(current["ticks"].as_u64().unwrap() > current["previousTicks"].as_u64().unwrap());
    assert_eq!(current["stored"], "same-project-data");
    assert_eq!(current["status"], status);
    assert_eq!(current["top"], true);
    assert_eq!(current["media"], true);
}

#[tokio::test]
#[ignore = "opens a fixture-owned native WKWebView; run explicitly on macOS"]
async fn native_document_survives_public_client_discovery_and_network_revocation() {
    let directory = tempfile::tempdir().unwrap();
    let executable = directory.path().join("native-client-view");
    let source =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/native-client-view-fixture.m");
    let output = Command::new("/usr/bin/clang")
        .args([
            "-fobjc-arc",
            "-mmacosx-version-min=13.5",
            "-framework",
            "Cocoa",
            "-framework",
            "WebKit",
        ])
        .arg(source)
        .arg("-o")
        .arg(&executable)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let host = HostFixture::new();
    *host.score_response.lock().unwrap() = "<script>window.scoreToken=crypto.randomUUID();window.scoreTicks=0;setInterval(()=>window.scoreTicks++,5);localStorage.setItem('continuity','same-project-data')</script>".into();
    let client = ClientCoordinator::default();
    client
        .inspect_guarded(host.address.clone(), None, || false)
        .await
        .unwrap();
    let opened = client.join(directory.path()).await.unwrap();
    let target = client.view_target().unwrap();
    let url = reqwest::Url::parse(opened.page_url.as_ref().unwrap()).unwrap();
    let mut child = NativeProcess(
        Command::new(executable)
            .arg(target.proxy_address.port().to_string())
            .arg(url.port().unwrap().to_string())
            .arg(directory.path())
            .arg("continuity")
            .arg(url.host_str().unwrap())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap(),
    );
    let first = probe(directory.path(), &mut child, 0).await;
    assert_eq!(first["status"], 200);
    let mut step = 0;
    // Keep the owned Host socket silent past the real metadata timeout.
    let (release, _arrived) = host.pause_next_response();
    assert_eq!(client.poll().await.phase, ClientPhase::Disconnected);
    step += 1;
    same_document(
        &first,
        &probe(directory.path(), &mut child, step).await,
        410,
    );
    release.send(()).unwrap();
    assert_eq!(client.poll().await.phase, ClientPhase::Open);
    step += 1;
    same_document(
        &first,
        &probe(directory.path(), &mut child, step).await,
        200,
    );
    for (status, body, expected) in [
        (503, "unavailable", ClientPhase::Disconnected),
        (200, "invalid json", ClientPhase::Error),
        (200, r#"{"protocolVersion":2}"#, ClientPhase::Error),
    ] {
        *host.metadata_response.lock().unwrap() = Some((status, body.into()));
        let failed = client.poll().await;
        assert_eq!(failed.phase, expected);
        assert_eq!(failed.page_url, opened.page_url);
        step += 1;
        let preserved = probe(directory.path(), &mut child, step).await;
        same_document(&first, &preserved, 410);
        *host.metadata_response.lock().unwrap() = None;
        assert_eq!(client.poll().await.phase, ClientPhase::Open);
        step += 1;
        same_document(
            &preserved,
            &probe(directory.path(), &mut child, step).await,
            200,
        );
    }
    let mut next = host.metadata.lock().unwrap().clone();
    host.metadata.lock().unwrap().performance = None;
    assert_eq!(client.poll().await.phase, ClientPhase::Ended);
    step += 1;
    same_document(
        &first,
        &probe(directory.path(), &mut child, step).await,
        410,
    );
    let performance = next.performance.as_mut().unwrap();
    performance.project_id = "copy-b".into();
    performance.performance_id = "run-b".into();
    performance.project_name = "Next score".into();
    *host.metadata.lock().unwrap() = next.clone();
    let changed = client.poll().await;
    assert_eq!(changed.phase, ClientPhase::Changed);
    assert_eq!(
        changed.host.unwrap().performance.unwrap().project_name,
        "Next score"
    );
    step += 1;
    same_document(
        &first,
        &probe(directory.path(), &mut child, step).await,
        410,
    );
    next.host_id = "another-host".into();
    *host.metadata.lock().unwrap() = next;
    let another = client.poll().await;
    assert_eq!(another.phase, ClientPhase::Changed);
    assert_eq!(another.expected_host_id.as_deref(), Some("host-a"));
    step += 1;
    same_document(
        &first,
        &probe(directory.path(), &mut child, step).await,
        410,
    );
    assert!(client.busy());
    assert_eq!(
        client.view_target().unwrap().page_url,
        opened.page_url.unwrap()
    );
    let close_directory = directory.path().to_path_buf();
    client.set_view_cleanup(std::sync::Arc::new(move || {
        std::fs::write(
            close_directory.join("continuity-command.json"),
            json!({"id":100,"finish":true}).to_string(),
        )
        .map_err(|error| error.to_string())?;
        let deadline = Instant::now() + Duration::from_secs(3);
        while !close_directory.join("continuity-closed").exists() {
            if Instant::now() >= deadline {
                return Err("fixture native document did not close".into());
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        Ok(())
    }));
    assert_eq!(client.leave().phase, ClientPhase::Idle);
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            assert!(status.success());
            break;
        }
        assert!(
            Instant::now() < deadline,
            "native document did not close on explicit Leave"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    println!("PASS real Client source retained native document, unsaved memory, clock and storage through silent-socket timeout, 503/invalid/incompatible metadata, Stop, new project and another Host; same-context recovery resumed the original source");
}
