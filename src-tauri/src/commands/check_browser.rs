//! Isolated WebKit observations of the controlled copy, before its server exits.
use crate::project::controlled_checks::ControlledCheckReport;
use crate::project::diagnostics::{DiagnosticCheck, DiagnosticStatus};
use crate::project::manifest::Manifest;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

#[derive(Debug, Deserialize)]
struct Receipt {
    errors: Vec<String>,
}

fn script(marker: &str, ports: &[u16]) -> String {
    let marker = serde_json::to_string(marker).expect("marker");
    let connections = ports
        .iter()
        .map(|port| format!("http://127.0.0.1:{port} ws://127.0.0.1:{port}"))
        .collect::<Vec<_>>()
        .join(" ");
    let policy = serde_json::to_string(&format!("default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' {connections}; frame-src 'none'; object-src 'none'; base-uri 'self'")).expect("policy");
    let options = format!("{{\"marker\":{marker},\"policy\":{policy}}}");
    let source = include_str!("check-browser.js");
    format!("globalThis.__PNDS_CHECK_OPTIONS__={options};\n{source}")
}

fn page(app: &AppHandle, port: u16, ports: &[u16], cancelled: &AtomicBool) -> Result<(), String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|cause| cause.to_string())?
        .as_nanos();
    let label = format!("check-page-{nanos}");
    let marker = format!("pnds-check-{nanos}:");
    let source = script(&marker, ports);
    let url: tauri::Url = format!("http://127.0.0.1:{port}/")
        .parse::<tauri::Url>()
        .map_err(|cause| cause.to_string())?;
    let (tx, rx) = mpsc::sync_channel(1);
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let builder_app = app.clone();
    let builder_label = label.clone();
    app.run_on_main_thread(move || {
        let result = tauri::WebviewWindowBuilder::new(
            &builder_app,
            &builder_label,
            tauri::WebviewUrl::External(url),
        )
        .visible(false)
        .focused(false)
        .incognito(true)
        .initialization_script(source)
        .on_navigation(move |url| {
            url.scheme() == "http"
                && url.host_str() == Some("127.0.0.1")
                && url.port() == Some(port)
        })
        .on_document_title_changed(move |_, title| {
            if let Some(json) = title.strip_prefix(&marker) {
                if json.len() <= 16 * 1024 {
                    let _ = tx.try_send(json.to_owned());
                }
            }
        })
        .build()
        .map(|_| ())
        .map_err(|cause| cause.to_string());
        let _ = ready_tx.try_send(result);
    })
    .map_err(|cause| cause.to_string())?;
    let result = (|| {
        ready_rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|cause| format!("Cannot open check WebKit page: {cause}"))??;
        let deadline = Instant::now() + Duration::from_secs(12);
        loop {
            if cancelled.load(Ordering::Acquire) {
                return Err("Browser check cancelled".into());
            }
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(json) => {
                    let receipt: Receipt = serde_json::from_str(&json)
                        .map_err(|cause| format!("Invalid browser receipt: {cause}"))?;
                    return if receipt.errors.is_empty() {
                        Ok(())
                    } else {
                        Err(receipt.errors.join("\n"))
                    };
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("Browser check receipt channel closed".into())
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if Instant::now() >= deadline {
                return Err(
                    "Browser page did not finish loading and report within 12 seconds".into(),
                );
            }
        }
    })();
    let closing_app = app.clone();
    let (closed_tx, closed_rx) = mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let closed = closing_app
            .get_webview_window(&label)
            .map_or(Ok(()), |window| {
                window.destroy().map_err(|cause| cause.to_string())
            });
        let _ = closed_tx.try_send(closed);
    })
    .map_err(|cause| cause.to_string())?;
    closed_rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|cause| format!("Check page destruction was not confirmed: {cause}"))??;
    result.map_err(|cause| format!("Page http://127.0.0.1:{port}/: {cause}"))
}

pub(super) fn inspect(
    app: &AppHandle,
    manifest: &Manifest,
    cancelled: &AtomicBool,
    report: &mut ControlledCheckReport,
) -> Result<(), String> {
    let ports = [
        manifest.score_server.performer_port,
        manifest.score_server.monitor_port,
    ];
    let mut failures = vec![];
    for port in ports {
        if cancelled.load(Ordering::Acquire) {
            return Err("Browser check cancelled".into());
        }
        if let Err(cause) = page(app, port, &ports, cancelled) {
            failures.push(cause);
        }
    }
    let passed = failures.is_empty();
    let reason = if passed {
        "Both isolated WebKit pages loaded without observed script, resource or promise errors during the 1.5 second observation. Visual quality, interaction and sound remain unverified.".into()
    } else {
        failures.join("\n")
    };
    report.checks.push(DiagnosticCheck {
        code: "browserScripts".into(),
        status: if passed {
            DiagnosticStatus::Passed
        } else {
            DiagnosticStatus::Failed
        },
        reason: reason.clone(),
    });
    if passed {
        Ok(())
    } else {
        Err(reason)
    }
}
