use super::*;
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

struct HealthServer {
    port: u16,
    payload: Arc<Mutex<serde_json::Value>>,
    requests: Arc<AtomicUsize>,
    blocked: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl HealthServer {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let payload = Arc::new(Mutex::new(json!({
            "status": "ready", "projectId": "live-score", "audioMode": "external",
            "audio": {"status": "ready", "target": "127.0.0.1:57120", "error": null},
            "scoreServer": {"performerPort": port, "monitorPort": 6869, "error": null}
        })));
        let requests = Arc::new(AtomicUsize::new(0));
        let blocked = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(AtomicBool::new(false));
        let thread = {
            let payload = Arc::clone(&payload);
            let requests = Arc::clone(&requests);
            let blocked = Arc::clone(&blocked);
            let finished = Arc::clone(&finished);
            std::thread::spawn(move || {
                while !finished.load(Ordering::Acquire) {
                    if let Ok((mut stream, _)) = listener.accept() {
                        stream
                            .set_read_timeout(Some(Duration::from_secs(1)))
                            .unwrap();
                        let mut request = [0; 1024];
                        let _ = stream.read(&mut request);
                        requests.fetch_add(1, Ordering::Release);
                        while blocked.load(Ordering::Acquire) && !finished.load(Ordering::Acquire) {
                            std::thread::sleep(Duration::from_millis(5));
                        }
                        let body = payload.lock().unwrap().to_string();
                        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len());
                        let _ = stream.write_all(response.as_bytes());
                    } else {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                }
            })
        };
        Self {
            port,
            payload,
            requests,
            blocked,
            finished,
            thread: Some(thread),
        }
    }

    fn ready(&self, manager: &SessionManager, dir: &Path) -> (u32, u64) {
        let registry = ChildRegistry::new(dir.to_path_buf());
        let mut command = Command::new("sleep");
        command.arg("30");
        let child =
            SupervisedChild::spawn(&registry, "runtime-health-sleep", &mut command).unwrap();
        let pid = child.id();
        let mut inner = manager.lock();
        inner.child = Some(child);
        inner.generation += 1;
        inner.score_run_generation = Some(inner.generation);
        inner.status = SessionStatus::Ready;
        inner.audio_mode = Some(AudioMode::External);
        inner.osc_target = Some("127.0.0.1:57120".into());
        inner.applied_score_ports = Some([self.port, 6869]);
        inner.health = Some(serde_json::from_value(self.payload.lock().unwrap().clone()).unwrap());
        (pid, inner.generation)
    }
}

impl Drop for HealthServer {
    fn drop(&mut self) {
        self.finished.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            thread.join().unwrap();
        }
    }
}

#[test]
fn runtime_health_http_reads_are_bounded_and_never_follow_another_endpoint() {
    let agent = health_agent();
    assert!(
        agent.config().proxy().is_none(),
        "loopback checks must ignore environment proxies"
    );
    let destination = HealthServer::start();
    assert!(fetch_health_with_agent(&agent, destination.port).is_ok());
    destination.payload.lock().unwrap()["unusedExtension"] = json!("x".repeat(256 * 1024));
    assert!(
        fetch_health_with_agent(&agent, destination.port).is_err(),
        "a large extension cannot allocate an unbounded health body"
    );
    destination
        .payload
        .lock()
        .unwrap()
        .as_object_mut()
        .unwrap()
        .remove("unusedExtension");

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let redirect_port = listener.local_addr().unwrap().port();
    let target = destination.port;
    let redirect = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        let mut request = [0; 1024];
        let _ = stream.read(&mut request);
        write!(stream, "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{target}/__pnds/health\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
    });
    let before = destination.requests.load(Ordering::Acquire);
    assert!(fetch_health_with_agent(&agent, redirect_port).is_err());
    redirect.join().unwrap();
    assert_eq!(
        destination.requests.load(Ordering::Acquire),
        before,
        "health must stay on the assigned endpoint"
    );
}

#[test]
fn runtime_health_detects_audio_error_without_a_child_exit() {
    let app = tauri::test::mock_app().handle().clone();
    crate::events::events_builder().mount_events(&app);
    let manager = SessionManager::default();
    let dir = tempfile::tempdir().unwrap();
    let server = HealthServer::start();
    let (pid, generation) = server.ready(&manager, dir.path());
    {
        let mut health = server.payload.lock().unwrap();
        health["status"] = json!("error");
        health["audio"]["status"] = json!("error");
        health["audio"]["error"] = json!("The score audio group stopped");
    }
    let watcher = {
        let app = app.clone();
        let inner = Arc::clone(&manager.inner);
        std::thread::spawn(move || SessionManager::watch_running(&app, &inner, pid, generation))
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    while manager.snapshot().status == SessionStatus::Ready && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    let snapshot = manager.snapshot();
    let retired = manager
        .lock()
        .retired_recording_runs
        .iter()
        .any(|run| run.generation == generation.to_string());
    let children = manager.active_child_pids();
    manager.stop(&app).unwrap();
    watcher.join().unwrap();
    assert_eq!(snapshot.status, SessionStatus::Error);
    assert!(snapshot
        .error
        .unwrap()
        .contains("The score audio group stopped"));
    assert_eq!(snapshot.health.unwrap().audio.unwrap().status, "error");
    let runtime = snapshot.runtime_health.unwrap();
    assert_eq!(
        runtime.project.status,
        runtime_health::RuntimeHealthStatus::Failed
    );
    assert!(runtime.project.last_success_at.is_some());
    assert!(runtime.project.first_failure_at.is_some());
    assert!(snapshot
        .output_tail
        .iter()
        .any(|line| line.contains("[runtime health]") && line.contains("scorePid")));
    assert!(
        children.is_empty(),
        "confirmed failure reaps the live score child"
    );
    assert!(
        retired,
        "confirmed cleanup retains the recording retirement proof"
    );
}

#[test]
fn runtime_health_only_publishes_warning_and_recovery_transitions() {
    let app = tauri::test::mock_app().handle().clone();
    crate::events::events_builder().mount_events(&app);
    let manager = SessionManager::default();
    manager.lock().status = SessionStatus::Ready;
    manager.lock().generation = 7;
    let events = Arc::new(AtomicUsize::new(0));
    let received = Arc::clone(&events);
    crate::events::SessionSnapshotEvent::listen_any(&app, move |_| {
        received.fetch_add(1, Ordering::Release);
    });
    let mut monitor = RuntimeHealthMonitor::new(false, Instant::now(), 1);
    for count in 1..=4 {
        assert!(SessionManager::apply_runtime_probe(
            &app,
            &manager.inner,
            7,
            &mut monitor,
            ProbeKind::Project,
            ProbeResult::Unconfirmed("health request timed out".into()),
            None,
        ));
        assert_eq!(manager.snapshot().status, SessionStatus::Ready);
        assert_eq!(events.load(Ordering::Acquire), usize::from(count >= 3));
        assert_eq!(
            manager
                .snapshot()
                .runtime_health
                .unwrap()
                .project
                .consecutive_failures,
            count
        );
    }
    assert_eq!(
        manager.snapshot().output_tail.len(),
        2,
        "first failure and threshold warning are recorded once"
    );
    for _ in 0..10 {
        assert!(SessionManager::apply_runtime_probe(
            &app,
            &manager.inner,
            7,
            &mut monitor,
            ProbeKind::Project,
            ProbeResult::Healthy,
            None,
        ));
    }
    assert_eq!(
        events.load(Ordering::Acquire),
        2,
        "healthy polls after recovery never publish"
    );
    let snapshot = manager.snapshot();
    assert_eq!(
        snapshot.output_tail.len(),
        3,
        "recovery is logged once, ordinary polls are silent"
    );
    assert_eq!(
        snapshot.runtime_health.unwrap().project.first_failure_at,
        None
    );
    manager.stop(&app).unwrap();
}

#[test]
fn current_internal_stats_are_cached_without_publishing_a_session_event() {
    let app = tauri::test::mock_app().handle().clone();
    crate::events::events_builder().mount_events(&app);
    let manager = SessionManager::default();
    {
        let mut inner = manager.lock();
        inner.status = SessionStatus::Ready;
        inner.generation = 7;
        inner.audio_mode = Some(AudioMode::Internal);
        inner.scsynth_port = Some(32_768);
        inner.master_synth_ready = true;
    }
    assert!(manager.creation_audio_stats("7").unwrap().is_none());
    let received = Arc::new(AtomicUsize::new(0));
    let events = Arc::clone(&received);
    crate::events::SessionSnapshotEvent::listen_any(&app, move |_| {
        events.fetch_add(1, Ordering::Relaxed);
    });
    let status = ScsynthStatus {
        average_cpu: 2.5,
        peak_cpu: 5.0,
        synths: 12,
    };
    let mut monitor = RuntimeHealthMonitor::new(true, Instant::now(), 1);
    assert!(SessionManager::apply_runtime_probe(
        &app,
        &manager.inner,
        7,
        &mut monitor,
        ProbeKind::Audio,
        ProbeResult::Healthy,
        Some(RuntimeProbeObservation::Audio(status)),
    ));
    let stats = manager.creation_audio_stats("7").unwrap().unwrap();
    assert_eq!(stats.average_cpu, 2.5);
    assert_eq!(stats.peak_cpu, 5.0);
    assert_eq!(stats.synths, 12);
    assert!(stats.observed_at > 0);
    assert_eq!(received.load(Ordering::Relaxed), 0);

    {
        let mut inner = manager.lock();
        inner.reset_run_state();
        inner.generation = 8;
    }
    assert!(!SessionManager::apply_runtime_probe(
        &app,
        &manager.inner,
        7,
        &mut monitor,
        ProbeKind::Audio,
        ProbeResult::Healthy,
        Some(RuntimeProbeObservation::Audio(status)),
    ));
    assert!(manager.creation_audio_stats("7").is_err());
    assert!(manager.lock().creation_audio_stats.is_none());
}

#[test]
fn runtime_health_foreign_errors_warn_without_retargeting_or_stopping_the_score() {
    let app = tauri::test::mock_app().handle().clone();
    crate::events::events_builder().mount_events(&app);
    let manager = SessionManager::default();
    let dir = tempfile::tempdir().unwrap();
    let server = HealthServer::start();
    let (pid, generation) = server.ready(&manager, dir.path());
    let confirmed_health = manager.snapshot().health;
    let mut probes = RuntimeHealthProbes::new(&manager.lock()).unwrap();
    let ready = server.payload.lock().unwrap().clone();
    {
        let mut foreign = server.payload.lock().unwrap();
        foreign["projectId"] = json!("another-score");
        foreign["status"] = json!("error");
        foreign["audio"]["error"] = json!("unrelated failure");
        foreign["scoreServer"]["monitorPort"] = json!(50000);
    }
    for _ in 0..3 {
        let (result, health) = probes.poll(ProbeKind::Project);
        assert!(matches!(result, ProbeResult::Unconfirmed(_)));
        assert!(SessionManager::apply_runtime_probe(
            &app,
            &manager.inner,
            generation,
            &mut probes.monitor,
            ProbeKind::Project,
            result,
            health,
        ));
    }
    let snapshot = manager.snapshot();
    assert_eq!(snapshot.status, SessionStatus::Ready);
    assert_eq!(
        snapshot.health, confirmed_health,
        "an unrelated response cannot replace the monitor origin"
    );
    assert_eq!(
        snapshot.runtime_health.unwrap().project.status,
        runtime_health::RuntimeHealthStatus::Unresponsive
    );
    assert!(manager.active_child_pids().contains(&pid));
    *server.payload.lock().unwrap() = ready;
    let (result, health) = probes.poll(ProbeKind::Project);
    assert!(SessionManager::apply_runtime_probe(
        &app,
        &manager.inner,
        generation,
        &mut probes.monitor,
        ProbeKind::Project,
        result,
        health,
    ));
    assert_eq!(
        manager.snapshot().runtime_health.unwrap().project.status,
        runtime_health::RuntimeHealthStatus::Healthy
    );
    manager.stop(&app).unwrap();
}

#[test]
fn runtime_health_delayed_fatal_probe_cannot_stop_a_replacement_run() {
    let app = tauri::test::mock_app().handle().clone();
    crate::events::events_builder().mount_events(&app);
    let manager = SessionManager::default();
    let dir = tempfile::tempdir().unwrap();
    let server = HealthServer::start();
    let (old_pid, old_generation) = server.ready(&manager, dir.path());
    server.blocked.store(true, Ordering::Release);
    {
        let mut health = server.payload.lock().unwrap();
        health["status"] = json!("error");
        health["audio"]["error"] = json!("old run audio failure");
    }
    let watcher = {
        let app = app.clone();
        let inner = Arc::clone(&manager.inner);
        let mut probes = RuntimeHealthProbes::new(&manager.lock()).unwrap();
        std::thread::spawn(move || {
            let (result, health) = probes.poll(ProbeKind::Project);
            let fatal = matches!(result, ProbeResult::Fatal(_));
            let applied = SessionManager::apply_runtime_probe(
                &app,
                &inner,
                old_generation,
                &mut probes.monitor,
                ProbeKind::Project,
                result,
                health,
            );
            (fatal, applied)
        })
    };
    let deadline = Instant::now() + Duration::from_secs(4);
    while server.requests.load(Ordering::Acquire) == 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
    }
    let requested = server.requests.load(Ordering::Acquire) > 0;
    manager.stop(&app).unwrap();
    let (new_pid, new_generation) = server.ready(&manager, dir.path());
    {
        let mut inner = manager.lock();
        let health = inner.health.as_mut().unwrap();
        health.status = "ready".into();
        health.audio.as_mut().unwrap().error = None;
    }
    server.blocked.store(false, Ordering::Release);
    let (fatal, applied) = watcher.join().unwrap();
    let snapshot = manager.snapshot();
    let active = manager.active_child_pids();
    let retired_new = manager
        .lock()
        .retired_recording_runs
        .iter()
        .any(|run| run.generation == new_generation.to_string());
    manager.stop(&app).unwrap();
    assert!(
        requested,
        "the old probe must actually enter HTTP before replacement"
    );
    assert!(
        fatal,
        "the delayed old response must be an actual fatal report, not a synthetic timeout"
    );
    assert!(!applied, "the replacement invalidates the in-flight result");
    assert!(!active.contains(&old_pid));
    assert_ne!(new_generation, old_generation);
    assert_eq!(snapshot.status, SessionStatus::Ready);
    assert_eq!(snapshot.error, None);
    assert_eq!(
        snapshot.runtime_health, None,
        "a stale result cannot replace the new run's facts"
    );
    assert!(
        active.contains(&new_pid),
        "the replacement child must remain alive"
    );
    assert!(
        !retired_new,
        "stale failure cannot retire the replacement recording run"
    );
}
