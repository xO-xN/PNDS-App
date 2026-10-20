//! Read-only observations of the existing runtime. No new pages, music clients,
//! processes, leases or source writes. These are never saved-copy receipts.
use super::diagnostics::{DiagnosticCheck, DiagnosticStatus};
use super::session::{CreationRuntime, HealthPayload};
use crate::types::SessionStatus;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashSet;
use std::io::Read;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedPerformer {
    pub id: String,
    pub label: String,
    pub test_client: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PerformerRoster {
    pub schema_version: u32,
    pub clients: Vec<ConnectedPerformer>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LiveRuntimeReport {
    pub generation: String,
    pub passed: bool,
    pub checks: Vec<DiagnosticCheck>,
    /// None means unsupported/invalid/unavailable, not zero connected devices.
    pub performers: Option<PerformerRoster>,
    pub saved_changes_verified: bool,
}

fn roster(value: Option<&serde_json::Value>) -> Option<PerformerRoster> {
    let roster: PerformerRoster = serde_json::from_value(value?.clone()).ok()?;
    let mut ids = HashSet::new();
    let text = |value: &str, max| {
        !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
    };
    (roster.schema_version == 1
        && roster.clients.len() <= 128
        && roster.clients.iter().all(|client| {
            text(&client.id, 128)
                && text(&client.label, 160)
                && ids.insert(&client.id)
                && client
                    .test_client
                    .as_deref()
                    .is_none_or(crate::performer::is_performer_label)
        }))
    .then_some(roster)
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .max_redirects(0)
        .timeout_global(Some(Duration::from_millis(800)))
        .build()
        .into()
}

fn health(port: u16) -> Result<serde_json::Value, String> {
    let response = agent()
        .get(format!("http://127.0.0.1:{port}/__pnds/health"))
        .call()
        .map_err(|_| "Current runtime health request failed".to_owned())?;
    if response.status() != 200 {
        return Err("Current runtime health did not return HTTP 200".into());
    }
    let mut body = Vec::new();
    response
        .into_body()
        .into_reader()
        .take(64 * 1024 + 1)
        .read_to_end(&mut body)
        .map_err(|_| "Cannot read current runtime health".to_owned())?;
    if body.len() > 64 * 1024 {
        return Err("Current runtime health exceeds the observation limit".into());
    }
    serde_json::from_slice(&body).map_err(|_| "Invalid current runtime health JSON".into())
}

pub fn same_runtime(before: &CreationRuntime, after: &CreationRuntime) -> bool {
    before.generation == after.generation
        && before.project_root == after.project_root
        && before.snapshot.status == SessionStatus::Ready
        && after.snapshot.status == SessionStatus::Ready
}

pub fn observe(runtime: &CreationRuntime, pages: bool) -> LiveRuntimeReport {
    let mut report = LiveRuntimeReport {
        generation: runtime.generation.clone(),
        passed: false,
        checks: vec![],
        performers: None,
        saved_changes_verified: false,
    };
    let result = (|| {
        if runtime.snapshot.status != SessionStatus::Ready {
            return Err("The current runtime is not ready".into());
        }
        let expected = runtime
            .snapshot
            .health
            .as_ref()
            .ok_or("No runtime health")?;
        let ports = expected.score_server.as_ref().ok_or("No runtime ports")?;
        let performer_port = ports
            .performer_port
            .filter(|port| *port > 0)
            .ok_or("No performer port")?;
        let monitor_port = ports
            .monitor_port
            .filter(|port| *port > 0)
            .ok_or("No monitor port")?;
        let value = health(performer_port)?;
        let live: HealthPayload = serde_json::from_value(value.clone())
            .map_err(|_| "Invalid current runtime health".to_owned())?;
        if live.status != "ready"
            || expected.project_id.is_none()
            || live.project_id != expected.project_id
            || live.audio_mode != runtime.snapshot.audio_mode.map(|mode| mode.to_string())
            || live.score_server.as_ref().is_none_or(|current| {
                current.performer_port != ports.performer_port
                    || current.monitor_port != ports.monitor_port
                    || current.error.is_some()
            })
            || live.audio.as_ref().is_none_or(|audio| {
                audio.error.is_some()
                    || !matches!(audio.status.as_str(), "ready" | "disabled")
                    || audio.target
                        != expected
                            .audio
                            .as_ref()
                            .and_then(|audio| audio.target.clone())
            })
        {
            return Err("Current runtime health does not match the ready session".into());
        }
        report.performers = roster(value.get("performers"));
        Ok((performer_port, monitor_port))
    })();
    match result {
        Err(reason) => report.checks.push(DiagnosticCheck {
            code: "liveHealth".into(),
            status: DiagnosticStatus::Failed,
            reason,
        }),
        Ok((performer_port, monitor_port)) => {
            report.checks.push(DiagnosticCheck {
                code: "liveHealth".into(),
                status: DiagnosticStatus::Passed,
                reason: "Existing runtime health matches this project, audio mode and ports".into(),
            });
            if pages {
                for (name, port) in [("performer", performer_port), ("monitor", monitor_port)] {
                    let passed = agent()
                        .head(format!("http://127.0.0.1:{port}/"))
                        .call()
                        .is_ok_and(|response| response.status() == 200);
                    report.checks.push(DiagnosticCheck {
                        code: format!("liveHttp:{name}"),
                        status: if passed {
                            DiagnosticStatus::Passed
                        } else {
                            DiagnosticStatus::Failed
                        },
                        reason: if passed {
                            "Existing page responds to HEAD with HTTP 200"
                        } else {
                            "Existing page HEAD request failed or did not return HTTP 200"
                        }
                        .into(),
                    });
                }
            }
        }
    }
    report.passed = report
        .checks
        .iter()
        .all(|check| check.status == DiagnosticStatus::Passed);
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;

    fn runtime(port: u16) -> CreationRuntime {
        let mut snapshot = super::super::session::SessionManager::default().snapshot();
        snapshot.status = SessionStatus::Ready;
        snapshot.audio_mode = Some(crate::types::AudioMode::None);
        snapshot.health = Some(
            serde_json::from_value(json!({
                "status":"ready", "projectId":"score", "audioMode":"none",
                "audio":{"status":"disabled","target":null},
                "scoreServer":{"performerPort":port,"monitorPort":port}
            }))
            .unwrap(),
        );
        CreationRuntime {
            generation: "7".into(),
            project_root: Some("/score".into()),
            snapshot,
        }
    }

    #[test]
    fn existing_runtime_observation_uses_only_health_get_and_head_without_executing_pages() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let value = json!({
            "status":"ready", "projectId":"score", "audioMode":"none",
            "audio":{"status":"disabled","target":null},
            "scoreServer":{"performerPort":port,"monitorPort":port},
            "performers":{"schemaVersion":1,"clients":[{"id":"phone","label":"Phone"}]}
        })
        .to_string();
        let worker = std::thread::spawn(move || {
            let mut requests = vec![];
            for _ in 0..3 {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = String::new();
                let mut reader = BufReader::new(socket.try_clone().unwrap());
                reader.read_line(&mut request).unwrap();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                }
                let body = if request.starts_with("HEAD") {
                    ""
                } else {
                    &value
                };
                write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
                requests.push(request);
            }
            requests
        });
        let report = observe(&runtime(port), true);
        assert!(report.passed, "{:?}", report.checks);
        assert!(!report.saved_changes_verified);
        assert_eq!(report.performers.unwrap().clients[0].id, "phone");
        let requests = worker.join().unwrap();
        assert!(requests[0].starts_with("GET /__pnds/health "));
        assert!(requests[1..]
            .iter()
            .all(|request| request.starts_with("HEAD / ")));
    }

    #[test]
    fn a_changed_generation_project_or_nonready_runtime_invalidates_observation() {
        let before = runtime(1);
        let mut after = before.clone();
        assert!(same_runtime(&before, &after));
        after.generation = "8".into();
        assert!(!same_runtime(&before, &after));
        after = before.clone();
        after.project_root = Some("/other".into());
        assert!(!same_runtime(&before, &after));
        after = before.clone();
        after.snapshot.status = SessionStatus::Stopping;
        assert!(!same_runtime(&before, &after));
        assert!(!observe(&after, true).passed);
    }

    #[test]
    fn missing_invalid_and_duplicate_rosters_are_unknown_not_empty() {
        assert!(roster(None).is_none());
        for value in [
            json!({"schemaVersion": 2, "clients": []}),
            json!({"schemaVersion":1,"clients":[{"id":"a","label":"phone","testClient":"main"}]}),
            json!({"schemaVersion":1,"clients":[{"id":"a","label":"phone"},{"id":"a","label":"phone"}]}),
        ] {
            assert!(roster(Some(&value)).is_none());
        }
        assert_eq!(
            roster(Some(&json!({"schemaVersion":1,"clients":[]})))
                .unwrap()
                .clients
                .len(),
            0
        );
        let rows = roster(Some(&json!({"schemaVersion":1,"clients":[{"id":"a","label":"Phone"},{"id":"b","label":"Test","testClient":"performer-00000000-0000-4000-8000-000000000001"}]}))).unwrap();
        assert_eq!(rows.clients.len(), 2);
        assert!(rows.clients[0].test_client.is_none());
    }
}
