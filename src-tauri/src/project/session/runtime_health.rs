//! Pure observations of an already-ready session. Probe I/O and generation
//! ownership stay with the session supervisor.

use super::HealthPayload;
use crate::types::AudioMode;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::time::{Duration, Instant};

const PROJECT_INTERVAL: Duration = Duration::from_secs(3);
const AUDIO_INTERVAL: Duration = Duration::from_secs(5);
const WARNING_THRESHOLD: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeHealthStatus {
    Healthy,
    Unresponsive,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealthCheck {
    pub status: RuntimeHealthStatus,
    /// Unix milliseconds, supplied by the supervisor independently of scheduling.
    #[specta(type = Option<f64>)]
    pub checked_at: Option<u64>,
    #[specta(type = Option<f64>)]
    pub last_success_at: Option<u64>,
    #[specta(type = Option<f64>)]
    pub first_failure_at: Option<u64>,
    pub consecutive_failures: u32,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealthSnapshot {
    pub project: RuntimeHealthCheck,
    pub audio: Option<RuntimeHealthCheck>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ProbeKind {
    Project,
    Audio,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ProbeResult {
    Healthy,
    Unconfirmed(String),
    Fatal(String),
}

pub(super) struct HealthExpectation {
    pub project_id: String,
    pub audio_mode: AudioMode,
    pub osc_target: Option<String>,
    pub performer_port: u16,
    pub monitor_port: u16,
    pub run_id: Option<String>,
}

pub(super) fn classify_health(health: &HealthPayload, expected: &HealthExpectation) -> ProbeResult {
    let Some(server) = &health.score_server else {
        return ProbeResult::Unconfirmed("Project health is missing scoreServer".into());
    };
    let Some(audio) = &health.audio else {
        return ProbeResult::Unconfirmed("Project health is missing audio".into());
    };
    if health.project_id.as_deref() != Some(expected.project_id.as_str())
        || health.audio_mode.as_deref() != Some(expected.audio_mode.as_str())
        || server.performer_port != Some(expected.performer_port)
        || server.monitor_port != Some(expected.monitor_port)
        || expected
            .run_id
            .as_ref()
            .is_some_and(|run_id| server.runtime_run_id.as_ref() != Some(run_id))
        || audio.target != expected.osc_target
    {
        return ProbeResult::Unconfirmed(
            "Project health does not match this run's identity, audio mode, target or ports".into(),
        );
    }

    // A correctly identified project can report its real failure even if the
    // outer status has not caught up. Never replace these details with an
    // assignment-mismatch error, and never trust errors from a different run.
    if health.status == "error"
        || audio.status == "error"
        || audio.error.is_some()
        || server.error.is_some()
    {
        let mut errors = Vec::new();
        if let Some(error) = &audio.error {
            errors.push(format!("Audio: {error}"));
        }
        if let Some(error) = &server.error {
            errors.push(format!("Score server: {error}"));
        }
        return ProbeResult::Fatal(if errors.is_empty() {
            "Project reported an error during runtime".into()
        } else {
            errors.join("\n")
        });
    }

    let audio_status = if expected.audio_mode == AudioMode::None {
        "disabled"
    } else {
        "ready"
    };
    if health.status != "ready" || audio.status != audio_status {
        return ProbeResult::Unconfirmed(format!(
            "Project health is not ready (status={}, audio={})",
            health.status, audio.status
        ));
    }
    ProbeResult::Healthy
}

pub(super) struct RuntimeHealthMonitor {
    snapshot: RuntimeHealthSnapshot,
    next_project: Instant,
    next_audio: Option<Instant>,
}

impl RuntimeHealthMonitor {
    /// Startup has already confirmed the initial healthy state. Deadlines use
    /// monotonic time; snapshot timestamps use the caller's wall-clock time.
    pub(super) fn new(internal: bool, now: Instant, at: u64) -> Self {
        let ready = RuntimeHealthCheck {
            status: RuntimeHealthStatus::Healthy,
            checked_at: Some(at),
            last_success_at: Some(at),
            first_failure_at: None,
            consecutive_failures: 0,
            error: None,
        };
        Self {
            snapshot: RuntimeHealthSnapshot {
                project: ready.clone(),
                audio: internal.then_some(ready),
            },
            next_project: now + PROJECT_INTERVAL,
            next_audio: internal.then_some(now + AUDIO_INTERVAL),
        }
    }

    pub(super) fn snapshot(&self) -> RuntimeHealthSnapshot {
        self.snapshot.clone()
    }

    pub(super) fn take_due(&mut self, now: Instant) -> Option<ProbeKind> {
        let project_due = now >= self.next_project;
        if self
            .next_audio
            .is_some_and(|next| now >= next && (!project_due || next < self.next_project))
        {
            self.next_audio = Some(now + AUDIO_INTERVAL);
            return Some(ProbeKind::Audio);
        }
        if project_due {
            self.next_project = now + PROJECT_INTERVAL;
            return Some(ProbeKind::Project);
        }
        None
    }

    /// Only status transitions request a log/event. Counters and timestamps
    /// still advance on ordinary probes without repeatedly interrupting a show.
    pub(super) fn observe(&mut self, kind: ProbeKind, result: &ProbeResult, at: u64) -> bool {
        let check = match kind {
            ProbeKind::Project => &mut self.snapshot.project,
            ProbeKind::Audio => match self.snapshot.audio.as_mut() {
                Some(check) => check,
                None => return false,
            },
        };
        let previous = check.status;
        check.checked_at = Some(at);
        match result {
            ProbeResult::Healthy => {
                check.status = RuntimeHealthStatus::Healthy;
                check.last_success_at = Some(at);
                check.first_failure_at = None;
                check.consecutive_failures = 0;
                check.error = None;
            }
            ProbeResult::Unconfirmed(error) | ProbeResult::Fatal(error) => {
                check.first_failure_at.get_or_insert(at);
                check.consecutive_failures = check.consecutive_failures.saturating_add(1);
                check.error = Some(error.clone());
                if matches!(result, ProbeResult::Fatal(_)) {
                    check.status = RuntimeHealthStatus::Failed;
                } else if check.consecutive_failures >= WARNING_THRESHOLD
                    && check.status != RuntimeHealthStatus::Failed
                {
                    check.status = RuntimeHealthStatus::Unresponsive;
                }
            }
        }
        check.status != previous
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture(mode: AudioMode) -> (HealthPayload, HealthExpectation) {
        let target = (mode != AudioMode::None).then(|| "127.0.0.1:57120".to_string());
        let audio_status = if mode == AudioMode::None {
            "disabled"
        } else {
            "ready"
        };
        let health = serde_json::from_value(json!({
            "status": "ready", "projectId": "runes", "audioMode": mode.as_str(),
            "audio": {"status": audio_status, "target": target, "error": null},
            "scoreServer": {"performerPort": 51001, "monitorPort": 51002,
                "runtimeRunId": "this-run", "error": null},
        }))
        .unwrap();
        let expected = HealthExpectation {
            project_id: "runes".into(),
            audio_mode: mode,
            osc_target: target,
            performer_port: 51001,
            monitor_port: 51002,
            run_id: Some("this-run".into()),
        };
        (health, expected)
    }

    #[test]
    fn matching_ready_health_supports_all_audio_modes_and_legacy_runs() {
        for mode in [AudioMode::Internal, AudioMode::External, AudioMode::None] {
            let (health, mut expected) = fixture(mode);
            assert_eq!(classify_health(&health, &expected), ProbeResult::Healthy);
            expected.run_id = None;
            assert_eq!(classify_health(&health, &expected), ProbeResult::Healthy);
        }
    }

    #[test]
    fn foreign_or_incomplete_error_payloads_cannot_fail_this_session() {
        let (health, expected) = fixture(AudioMode::Internal);
        let changes: Vec<fn(&mut HealthPayload)> = vec![
            |h| h.project_id = Some("another-work".into()),
            |h| h.project_id = None,
            |h| h.audio_mode = Some("none".into()),
            |h| h.score_server.as_mut().unwrap().performer_port = Some(6868),
            |h| h.score_server.as_mut().unwrap().monitor_port = Some(6869),
            |h| h.score_server.as_mut().unwrap().runtime_run_id = Some("old-run".into()),
            |h| h.score_server.as_mut().unwrap().runtime_run_id = None,
            |h| h.audio.as_mut().unwrap().target = Some("127.0.0.1:1".into()),
            |h| h.audio.as_mut().unwrap().target = None,
            |h| h.audio = None,
            |h| h.score_server = None,
        ];
        for change in changes {
            let mut foreign = health.clone();
            foreign.status = "error".into();
            foreign.audio.as_mut().unwrap().error = Some("must not stop this run".into());
            change(&mut foreign);
            assert!(matches!(
                classify_health(&foreign, &expected),
                ProbeResult::Unconfirmed(_)
            ));
        }
    }

    #[test]
    fn explicit_errors_preserve_original_audio_and_server_details() {
        let (mut health, expected) = fixture(AudioMode::Internal);
        health.audio.as_mut().unwrap().error = Some("Node allocation failed".into());
        health.score_server.as_mut().unwrap().error = Some("project controller failed".into());
        assert_eq!(
            classify_health(&health, &expected),
            ProbeResult::Fatal(
                "Audio: Node allocation failed\nScore server: project controller failed".into()
            )
        );
        health.audio.as_mut().unwrap().error = None;
        health.score_server.as_mut().unwrap().error = None;
        for status in ["error", "ready"] {
            health.status = status.into();
            health.audio.as_mut().unwrap().status = "error".into();
            assert!(matches!(
                classify_health(&health, &expected),
                ProbeResult::Fatal(message) if !message.contains("startup")
            ));
        }
    }

    #[test]
    fn nonready_and_inconsistent_health_are_unconfirmed_without_explicit_error() {
        let (mut health, expected) = fixture(AudioMode::Internal);
        for status in ["starting", "stopping", "unknown"] {
            health.status = status.into();
            assert!(matches!(
                classify_health(&health, &expected),
                ProbeResult::Unconfirmed(_)
            ));
        }
        health.status = "ready".into();
        health.audio.as_mut().unwrap().status = "disabled".into();
        assert!(matches!(
            classify_health(&health, &expected),
            ProbeResult::Unconfirmed(_)
        ));
        let (mut none, expected) = fixture(AudioMode::None);
        none.audio.as_mut().unwrap().status = "ready".into();
        assert!(matches!(
            classify_health(&none, &expected),
            ProbeResult::Unconfirmed(_)
        ));
    }

    #[test]
    fn schedules_three_and_five_second_probes_without_catchup_queues() {
        let now = Instant::now();
        let mut monitor = RuntimeHealthMonitor::new(true, now, 100);
        assert_eq!(monitor.take_due(now + Duration::from_millis(2999)), None);
        assert_eq!(
            monitor.take_due(now + Duration::from_secs(3)),
            Some(ProbeKind::Project)
        );
        assert_eq!(monitor.take_due(now + Duration::from_secs(4)), None);
        assert_eq!(
            monitor.take_due(now + Duration::from_secs(5)),
            Some(ProbeKind::Audio)
        );
        assert_eq!(
            monitor.take_due(now + Duration::from_secs(6)),
            Some(ProbeKind::Project)
        );
        let resumed = now + Duration::from_secs(100);
        assert_eq!(monitor.take_due(resumed), Some(ProbeKind::Project));
        assert_eq!(monitor.take_due(resumed), Some(ProbeKind::Audio));
        assert_eq!(monitor.take_due(resumed), None);
        assert_eq!(
            monitor.take_due(resumed + PROJECT_INTERVAL),
            Some(ProbeKind::Project)
        );
        assert_eq!(
            monitor.take_due(resumed + AUDIO_INTERVAL),
            Some(ProbeKind::Audio)
        );
    }

    #[test]
    fn noninternal_sessions_never_schedule_or_record_audio_probes() {
        let now = Instant::now();
        let mut monitor = RuntimeHealthMonitor::new(false, now, 10);
        assert!(monitor.snapshot().audio.is_none());
        assert_eq!(
            monitor.take_due(now + Duration::from_secs(100)),
            Some(ProbeKind::Project)
        );
        assert_eq!(monitor.take_due(now + Duration::from_secs(100)), None);
        assert!(!monitor.observe(
            ProbeKind::Audio,
            &ProbeResult::Fatal("foreign engine".into()),
            20
        ));
        assert!(monitor.snapshot().audio.is_none());
    }

    #[test]
    fn only_warning_and_recovery_transitions_request_publication() {
        let mut monitor = RuntimeHealthMonitor::new(true, Instant::now(), 10);
        let missing = ProbeResult::Unconfirmed("health timed out".into());
        for at in [20, 30] {
            assert!(!monitor.observe(ProbeKind::Project, &missing, at));
        }
        assert!(monitor.observe(ProbeKind::Project, &missing, 40));
        let warning = monitor.snapshot().project;
        assert_eq!(warning.status, RuntimeHealthStatus::Unresponsive);
        assert_eq!(warning.checked_at, Some(40));
        assert_eq!(warning.last_success_at, Some(10));
        assert_eq!(warning.first_failure_at, Some(20));
        assert_eq!(warning.consecutive_failures, 3);
        assert_eq!(warning.error.as_deref(), Some("health timed out"));
        assert!(!monitor.observe(
            ProbeKind::Project,
            &ProbeResult::Unconfirmed("still unavailable".into()),
            50
        ));
        assert!(monitor.observe(ProbeKind::Project, &ProbeResult::Healthy, 60));
        let recovered = monitor.snapshot().project;
        assert_eq!(recovered.status, RuntimeHealthStatus::Healthy);
        assert_eq!(recovered.last_success_at, Some(60));
        assert_eq!(recovered.first_failure_at, None);
        assert_eq!(recovered.consecutive_failures, 0);
        assert_eq!(recovered.error, None);
        assert!(!monitor.observe(ProbeKind::Project, &ProbeResult::Healthy, 70));
    }

    #[test]
    fn probe_failures_are_independent_and_explicit_failure_is_immediate() {
        let mut monitor = RuntimeHealthMonitor::new(true, Instant::now(), 10);
        for at in [20, 30, 40] {
            monitor.observe(
                ProbeKind::Project,
                &ProbeResult::Unconfirmed("HTTP".into()),
                at,
            );
        }
        assert!(!monitor.observe(ProbeKind::Audio, &ProbeResult::Healthy, 50));
        assert_eq!(
            monitor.snapshot().project.status,
            RuntimeHealthStatus::Unresponsive
        );
        assert!(monitor.observe(
            ProbeKind::Audio,
            &ProbeResult::Fatal("engine exited".into()),
            60
        ));
        let audio = monitor.snapshot().audio.unwrap();
        assert_eq!(audio.status, RuntimeHealthStatus::Failed);
        assert_eq!(audio.first_failure_at, Some(60));
        assert_eq!(audio.last_success_at, Some(50));
        assert_eq!(audio.consecutive_failures, 1);
        assert!(!monitor.observe(
            ProbeKind::Audio,
            &ProbeResult::Fatal("engine exited".into()),
            70
        ));
        assert!(monitor.observe(ProbeKind::Project, &ProbeResult::Healthy, 80));
        assert_eq!(
            monitor.snapshot().audio.unwrap().status,
            RuntimeHealthStatus::Failed
        );
        monitor.snapshot.project.consecutive_failures = u32::MAX;
        monitor.observe(
            ProbeKind::Project,
            &ProbeResult::Unconfirmed("HTTP".into()),
            90,
        );
        assert_eq!(monitor.snapshot().project.consecutive_failures, u32::MAX);
    }

    #[test]
    fn snapshot_wire_names_are_camel_case_and_status_is_explicit() {
        let snapshot = RuntimeHealthMonitor::new(false, Instant::now(), 123).snapshot();
        let value = serde_json::to_value(snapshot).unwrap();
        assert_eq!(value["project"]["status"], "healthy");
        assert_eq!(value["project"]["checkedAt"], 123);
        assert_eq!(value["project"]["lastSuccessAt"], 123);
        assert!(value["project"]["firstFailureAt"].is_null());
        assert_eq!(value["project"]["consecutiveFailures"], 0);
        assert!(value["audio"].is_null());
    }
}
