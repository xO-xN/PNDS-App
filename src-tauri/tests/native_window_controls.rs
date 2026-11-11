#![cfg(all(target_os = "macos", feature = "native-client-fixture"))]

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[test]
#[ignore = "opens an owned native window and posts mouse events; explicit AppKit acceptance"]
fn main_window_preserves_system_controls_hover_and_content_hit_testing() {
    let evidence = tempfile::Builder::new()
        .prefix("pnds-native-controls-")
        .tempdir()
        .unwrap()
        .keep();
    println!("Native controls evidence: {}", evidence.display());
    let stdout = std::fs::File::create(evidence.join("stdout.log")).unwrap();
    let stderr = std::fs::File::create(evidence.join("stderr.log")).unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_native-client-entry-fixture"))
        .env("PNDS_WINDOW_CONTROLS_FIXTURE", &evidence)
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(20);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("Owned controls fixture timed out: {}", evidence.display());
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    assert!(
        status.success(),
        "{}",
        std::fs::read_to_string(evidence.join("stderr.log")).unwrap()
    );
    let result: serde_json::Value =
        serde_json::from_slice(&std::fs::read(evidence.join("result.json")).unwrap()).unwrap();
    assert_eq!(result["result"], "passed", "{result}");
    assert!(result["hoverChangedBytes"].as_u64().unwrap() > 20);
    assert_eq!(result["blankHit"]["shellDescendant"], true);
}
