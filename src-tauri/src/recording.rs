//! Durable performance information and the single native common-time driver.
//! Score payloads remain opaque; only the adapted score can interpret them.
use ring::digest::{Context, SHA256};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use specta::Type;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub(crate) mod storage;
use storage::RecordingStore;

const MAX_BYTES: u64 = 64 * 1024 * 1024;
const MAX_DURATION: u32 = 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordingCapability {
    pub protocol_version: u32,
    pub adapter_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordingSource {
    pub project_id: String,
    pub project_name: String,
    pub content_digest: String,
    pub adapter: RecordingCapability,
}

#[derive(Clone)]
pub struct LaunchSource {
    pub source: RecordingSource,
    pub project_key: String,
    pub directory: Arc<File>,
}

/// Captured before spawning Node, never reconstructed from later draft bytes.
pub fn launch_source(root: &Path) -> Result<Option<LaunchSource>, String> {
    let path = root.join("pnds.recording.json");
    if !path.exists() {
        return Ok(None);
    }
    let capability: RecordingCapability = read_json(&path)?;
    if capability.protocol_version != 1 || capability.adapter_id.trim().is_empty() {
        // A future adapter must not prevent ordinary score operation.
        return Ok(None);
    }
    let manifest = crate::project::manifest::load_manifest(root)?;
    let canonical = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let directory = Arc::new(
        File::options()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(&canonical)
            .map_err(|error| error.to_string())?,
    );
    // Large score resources must not inherit unoptimized Rust SHA compression
    // in development builds. Keep the same SHA-256 bytes and tree framing.
    let mut digest = Context::new(&SHA256);
    hash_tree(root, root, &mut digest, 0)?;
    let content_digest: String = digest
        .finish()
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok(Some(LaunchSource {
        directory,
        project_key: format!(
            "{:x}",
            Sha256::digest(canonical.to_string_lossy().as_bytes())
        ),
        source: RecordingSource {
            project_id: manifest.id,
            project_name: manifest.name,
            content_digest: format!("sha256:{content_digest}"),
            adapter: capability,
        },
    }))
}

/// Health-ready brackets source loading. A changed/unknown input cannot be
/// advertised as the previously observed recording source.
pub fn verify_launch_source(root: &Path, expected: &LaunchSource) -> Result<(), String> {
    let current = launch_source(root)?.ok_or("Recording declaration changed during startup")?;
    if current.project_key != expected.project_key
        || !same_root(&current.directory, &expected.directory)?
        || current.source.content_digest != expected.source.content_digest
        || current.source.adapter != expected.source.adapter
    {
        return Err("Project content changed during startup; restart before recording".into());
    }
    Ok(())
}

pub(crate) fn same_root(left: &File, right: &File) -> Result<bool, String> {
    let left = left.metadata().map_err(|error| error.to_string())?;
    let right = right.metadata().map_err(|error| error.to_string())?;
    Ok((left.dev(), left.ino()) == (right.dev(), right.ino()))
}

fn hash_tree(root: &Path, dir: &Path, digest: &mut Context, depth: usize) -> Result<(), String> {
    if depth > 64 {
        return Err(
            "Recording source contains a directory cycle or exceeds the supported depth".into(),
        );
    }
    let mut paths = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    paths.sort();
    for path in paths {
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                matches!(name, ".git" | "node_modules" | ".DS_Store" | "target")
                    || crate::creation_data::contains(Path::new(name))
            })
        {
            continue;
        }
        let mut meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() {
            let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
            let target = fs::canonicalize(&path).map_err(|e| e.to_string())?;
            if target
                .strip_prefix(canonical_root)
                .is_ok_and(crate::creation_data::contains)
            {
                continue;
            }
            meta = fs::metadata(&path).map_err(|e| e.to_string())?;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy();
        digest.update(&(relative.len() as u64).to_le_bytes());
        digest.update(relative.as_bytes());
        digest.update(&[u8::from(meta.is_dir())]);
        if meta.is_dir() {
            hash_tree(root, &path, digest, depth + 1)?;
        } else if meta.is_file() {
            digest.update(&meta.len().to_le_bytes());
            let mut input = File::open(&path).map_err(|e| e.to_string())?;
            let mut bytes = [0; 32768];
            loop {
                let size = input.read(&mut bytes).map_err(|e| e.to_string())?;
                if size == 0 {
                    break;
                }
                digest.update(&bytes[..size]);
            }
        }
        digest.update(&[0]);
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordedPerformer {
    pub id: String,
    pub label: String,
    pub selection: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordedEvent {
    pub at_ms: u32,
    pub sequence: u32,
    pub performer_id: Option<String>,
    pub kind: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordedPass {
    pub id: String,
    pub performer_ids: Vec<String>,
    pub legacy: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PerformanceRecord {
    pub schema_version: u32,
    pub id: String,
    pub created_at: String,
    pub complete: bool,
    pub duration_ms: u32,
    pub original_source: RecordingSource,
    pub interpreted_by: RecordingSource,
    pub initial_state: Value,
    pub performers: Vec<RecordedPerformer>,
    pub events: Vec<RecordedEvent>,
    pub passes: Vec<RecordedPass>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSnapshot {
    pub revision: u32,
    pub operation_id: Option<String>,
    pub record_id: Option<String>,
    pub project_path: Option<String>,
    /// idle | recording | playback | overdub | rerecord | error
    pub status: String,
    pub elapsed_ms: u32,
    pub duration_ms: Option<u32>,
    pub error: Option<String>,
    pub supported: bool,
}

#[derive(Clone)]
pub struct RecordingTarget {
    pub launch: LaunchSource,
    pub project_path: String,
    pub port: u16,
    pub generation: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Capture {
    #[serde(default)]
    pass_id: Option<String>,
    #[serde(default)]
    events: Vec<RecordedEvent>,
    #[serde(default)]
    performers: Vec<RecordedPerformer>,
    #[serde(default)]
    initial_state: Value,
    #[serde(default)]
    elapsed_ms: u32,
}

struct ActivePass {
    operation_id: String,
    pass_id: Option<String>,
    target: RecordingTarget,
    store: RecordingStore,
    mode: String,
    record: PerformanceRecord,
    replay: Vec<RecordedEvent>,
    replay_index: usize,
    last_sequence: u32,
    sequence_offset: u32,
    started_at: u32,
    clock: Arc<dyn Fn() -> u32 + Send + Sync>,
    elapsed_offset: u32,
    checkpoint_at: Instant,
    publish_allowed: bool,
}

#[derive(Default)]
struct Inner {
    active: Option<ActivePass>,
    snapshot: RecordingSnapshot,
}

#[derive(Clone)]
pub struct RecordingManager {
    inner: Arc<Mutex<Inner>>,
    clock: Arc<dyn Fn() -> u32 + Send + Sync>,
}

impl Default for RecordingManager {
    fn default() -> Self {
        let epoch = Instant::now();
        Self::with_clock(Arc::new(move || epoch.elapsed().as_millis() as u32))
    }
}

impl RecordingManager {
    /// Only the time source varies in deterministic workflow tests.
    pub fn with_clock(clock: Arc<dyn Fn() -> u32 + Send + Sync>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
            clock,
        }
    }
    pub fn snapshot(&self, supported: bool) -> RecordingSnapshot {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if inner.snapshot.supported != supported || inner.snapshot.status.is_empty() {
            inner.snapshot.supported = supported;
            if inner.snapshot.status.is_empty() {
                inner.snapshot.status = "idle".into();
            }
            inner.snapshot.revision = inner.snapshot.revision.wrapping_add(1);
        }
        inner.snapshot.clone()
    }

    /// Process retirement releases authority, never publishes a successful pass.
    pub(crate) fn retire_runtime(&self, run: &crate::project::session::RetiredRecordingRun) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let Some(pass) = inner.active.as_mut() else {
            return;
        };
        if pass.target.generation != run.generation() {
            return;
        }
        if pass.publish_allowed {
            pass.record.complete = false;
            if let Err(error) = pass.checkpoint() {
                log::warn!("Retired recording checkpoint failed: {error}");
            }
        }
        inner.active = None;
        inner.snapshot.operation_id = None;
        inner.snapshot.status = "error".into();
        if inner.snapshot.error.is_none() {
            inner.snapshot.error = Some("recording.interrupted".into());
        }
        inner.snapshot.revision = inner.snapshot.revision.wrapping_add(1);
    }

    pub fn list(&self, store: &RecordingStore) -> Result<Vec<PerformanceRecord>, String> {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let mut records = Vec::new();
        for name in store.entries()? {
            let path = Path::new(&name);
            if inner.active.as_ref().is_some_and(|pass| {
                pass.store.same_directory(store)
                    && path.file_stem().and_then(|stem| stem.to_str())
                        == Some(format!("pending-{}", pass.operation_id).as_str())
            }) {
                continue;
            }
            if path
                .extension()
                .is_some_and(|extension| extension == "json")
            {
                let mut record = store.read(&name)?;
                if let Some(id) = path
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .and_then(|stem| stem.strip_prefix("pending-"))
                {
                    valid_id(id)?;
                    record.id = id.to_string();
                }
                records.push(record);
            }
        }
        records.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(records)
    }

    // Keep this public operation seam explicit for desktop commands and fixtures.
    #[allow(clippy::too_many_arguments)]
    pub fn begin(
        &self,
        store: &RecordingStore,
        target: RecordingTarget,
        mode: &str,
        record_id: Option<&str>,
        pass_id: Option<&str>,
        allow_changed: bool,
        creation: bool,
    ) -> Result<RecordingSnapshot, String> {
        if !matches!(mode, "recording" | "playback" | "overdub" | "rerecord") {
            return Err("recording.invalidOperation".into());
        }
        if matches!(mode, "overdub" | "rerecord") && !creation {
            return Err("recording.creationOnly".into());
        }
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if inner.active.is_some() {
            return Err("recording.busy".into());
        }
        if mode != "playback" {
            store.ensure_writable()?;
        }
        let operation_id = random_id()?;
        let mut record = if mode == "recording" {
            PerformanceRecord {
                schema_version: 2,
                id: random_id()?,
                created_at: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis()
                    .to_string(),
                complete: false,
                duration_ms: 0,
                original_source: target.launch.source.clone(),
                interpreted_by: target.launch.source.clone(),
                initial_state: Value::Null,
                performers: Vec::new(),
                events: Vec::new(),
                passes: Vec::new(),
            }
        } else {
            let id = record_id.ok_or("recording.chooseRecord")?;
            valid_id(id)?;
            let record = store.read(&format!("{id}.json"))?;
            if !record.complete {
                return Err("recording.incomplete".into());
            }
            if record.original_source.adapter != target.launch.source.adapter {
                return Err("recording.incompatible".into());
            }
            if record.interpreted_by.content_digest != target.launch.source.content_digest
                && !allow_changed
            {
                return Err("recording.contentChanged".into());
            }
            record
        };
        let active_pass_id = if mode == "playback" {
            None
        } else if mode == "rerecord" {
            let id = pass_id.ok_or("recording.choosePass")?;
            let previous = record
                .passes
                .iter()
                .find(|pass| pass.id == id)
                .ok_or("recording.choosePass")?;
            let removed = previous.performer_ids.clone();
            remove_performers(&mut record, &removed);
            let pass = record.passes.iter_mut().find(|pass| pass.id == id).unwrap();
            pass.performer_ids.clear();
            pass.legacy = false;
            Some(id.to_string())
        } else {
            let id = random_id()?;
            record.passes.push(RecordedPass {
                id: id.clone(),
                performer_ids: Vec::new(),
                legacy: false,
            });
            Some(id)
        };
        let replay_performers = record.performers.clone();
        let replay = record.events.clone();
        if mode != "recording" && mode != "playback" {
            store.backup_legacy(&format!("{}.json", record.id))?;
        }
        let handshake: RecordingCapability = get(target.port)?;
        if handshake != target.launch.source.adapter {
            return Err("recording.incompatible".into());
        }
        // The adapter may accept begin even when its response is lost. Own the
        // operation before sending, and retain it until end is acknowledged.
        let mut request = json!({
            "action":"begin", "operationId":operation_id,
            "mode": if mode == "recording" { "record" } else if mode == "playback" { "playback" } else { "overdub" },
            "initialState":record.initial_state, "replayPerformers":replay_performers
        });
        if let Some(id) = &active_pass_id {
            request["livePassId"] = json!(id);
        }
        record.complete = false;
        record.interpreted_by = target.launch.source.clone();
        let mut pass = ActivePass {
            operation_id: operation_id.clone(),
            pass_id: active_pass_id,
            target,
            store: store.clone(),
            mode: mode.into(),
            record,
            replay,
            replay_index: 0,
            last_sequence: 0,
            sequence_offset: 0,
            started_at: (self.clock)(),
            clock: self.clock.clone(),
            elapsed_offset: 0,
            checkpoint_at: Instant::now(),
            publish_allowed: false,
        };
        pass.sequence_offset = pass
            .record
            .events
            .iter()
            .map(|event| event.sequence)
            .max()
            .unwrap_or(0);
        inner.snapshot.record_id = Some(pass.record.id.clone());
        inner.snapshot.project_path = Some(pass.target.project_path.clone());
        inner.active = Some(pass);
        let capture = post::<Capture>(inner.active.as_ref().unwrap().target.port, &request);
        let capture = match capture {
            Ok(capture) => capture,
            Err(error) => {
                fail(&mut inner, error.clone())?;
                return Err(error);
            }
        };
        let pass = inner.active.as_mut().unwrap();
        if mode == "recording" {
            pass.record.initial_state = capture.initial_state.clone();
        }
        pass.started_at = (self.clock)();
        pass.elapsed_offset = capture.elapsed_ms;
        if let Err(error) = pass.capture(capture).and_then(|()| pass.checkpoint()) {
            return fail(&mut inner, error).map(|()| inner.snapshot.clone());
        }
        pass.publish_allowed = true;
        let duration_ms = if mode == "recording" {
            None
        } else {
            Some(pass.record.duration_ms)
        };
        let record_id = pass.record.id.clone();
        let project_path = pass.target.project_path.clone();
        inner.snapshot = RecordingSnapshot {
            revision: inner.snapshot.revision.wrapping_add(1),
            operation_id: Some(operation_id),
            record_id: Some(record_id),
            project_path: Some(project_path),
            status: mode.into(),
            elapsed_ms: 0,
            duration_ms,
            error: None,
            supported: true,
        };
        Ok(inner.snapshot.clone())
    }

    /// One bounded common-time step. Called only by the native driver, so hiding
    /// WebViews and suspending their timers cannot interrupt a pass.
    pub fn advance(&self, generation: Option<&str>) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let Some(pass) = inner.active.as_mut() else {
            return Ok(());
        };
        if !pass.publish_allowed {
            return Ok(());
        }
        if generation != Some(&pass.target.generation) {
            return fail(&mut inner, "recording.interrupted".into());
        }
        let elapsed = pass.elapsed();
        let end = pass.record.duration_ms;
        let automatic_end = pass.mode != "recording" && elapsed >= end;
        let result = pass.step(elapsed.min(if pass.mode == "recording" {
            MAX_DURATION
        } else {
            end
        }));
        if let Err(error) = result {
            return fail(&mut inner, error);
        }
        let visible_second = inner.snapshot.elapsed_ms / 1000;
        inner.snapshot.elapsed_ms = elapsed.min(if automatic_end { end } else { MAX_DURATION });
        if inner.snapshot.elapsed_ms / 1000 != visible_second {
            inner.snapshot.revision = inner.snapshot.revision.wrapping_add(1);
        }
        if automatic_end || elapsed >= MAX_DURATION {
            finish(&mut inner, false)?;
        }
        Ok(())
    }

    pub fn stop(&self, discard: bool) -> Result<RecordingSnapshot, String> {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        finish(&mut inner, discard)?;
        inner.snapshot.revision = inner.snapshot.revision.wrapping_add(1);
        Ok(inner.snapshot.clone())
    }

    pub fn delete_record(&self, store: &RecordingStore, id: &str) -> Result<(), String> {
        valid_id(id)?;
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        ensure_not_active(&inner, store, id)?;
        store.ensure_writable()?;
        let completed = format!("{id}.json");
        let name = if store.entries()?.contains(&completed) {
            completed
        } else {
            format!("pending-{id}.json")
        };
        store.read(&name)?;
        if !name.starts_with("pending-") {
            store.backup_legacy(&name)?;
        }
        store.remove(&name)
    }

    pub fn delete_pass(
        &self,
        store: &RecordingStore,
        record_id: &str,
        pass_id: &str,
    ) -> Result<PerformanceRecord, String> {
        valid_id(record_id)?;
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        ensure_not_active(&inner, store, record_id)?;
        store.ensure_writable()?;
        let name = format!("{record_id}.json");
        let mut record = store.read(&name)?;
        if !record.complete {
            return Err("recording.incomplete".into());
        }
        let index = record
            .passes
            .iter()
            .position(|pass| pass.id == pass_id)
            .ok_or("recording.choosePass")?;
        let removed = record.passes.remove(index);
        remove_performers(&mut record, &removed.performer_ids);
        validate_record(&record)?;
        store.backup_legacy(&name)?;
        store.write(&name, &record)?;
        Ok(record)
    }

    pub fn import(&self, store: &RecordingStore, path: &Path) -> Result<PerformanceRecord, String> {
        let _inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        store.ensure_writable()?;
        let mut record = read_record(path)?;
        // Import never overwrites a local record, even if an untrusted file reuses its ID.
        record.id = random_id()?;
        store.write(&format!("{}.json", record.id), &record)?;
        Ok(record)
    }

    pub fn export(&self, store: &RecordingStore, id: &str, path: &Path) -> Result<(), String> {
        valid_id(id)?;
        let _inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let record = store.read(&format!("{id}.json"))?;
        atomic_json(path, &record)
    }
}

impl ActivePass {
    fn elapsed(&self) -> u32 {
        self.elapsed_offset
            .saturating_add((self.clock)().wrapping_sub(self.started_at))
    }
    fn step(&mut self, elapsed: u32) -> Result<(), String> {
        if self.mode != "recording" {
            let start = self.replay_index;
            while self.replay_index < self.replay.len()
                && self.replay[self.replay_index].at_ms <= elapsed
            {
                self.replay_index += 1;
            }
            let _: Value = post(
                self.target.port,
                &json!({"action":"drive", "operationId":self.operation_id,
                "elapsedMs":elapsed,"events":&self.replay[start..self.replay_index]}),
            )?;
        }
        let capture: Capture = post(
            self.target.port,
            &json!({"action":"poll", "operationId":self.operation_id,"afterSequence":self.last_sequence}),
        )?;
        self.capture(capture)?;
        if self.checkpoint_at.elapsed() >= Duration::from_secs(1) {
            self.checkpoint()?;
            self.checkpoint_at = Instant::now();
        }
        Ok(())
    }
    fn capture(&mut self, capture: Capture) -> Result<(), String> {
        if self.mode == "playback" {
            return Ok(());
        }
        if capture.pass_id.as_ref() != self.pass_id.as_ref() {
            return Err("recording.passUnsupported".into());
        }
        let pass_id = self.pass_id.as_ref().ok_or("recording.invalidAdapter")?;
        for performer in capture.performers {
            if self
                .record
                .passes
                .iter()
                .any(|pass| &pass.id != pass_id && pass.performer_ids.contains(&performer.id))
            {
                return Err("recording.invalidAdapter".into());
            }
            let pass = self
                .record
                .passes
                .iter_mut()
                .find(|pass| &pass.id == pass_id)
                .ok_or("recording.invalidAdapter")?;
            if !pass.performer_ids.contains(&performer.id) {
                pass.performer_ids.push(performer.id.clone());
            }
            if performer.id.is_empty() || performer.id.len() > 256 || performer.label.len() > 512 {
                return Err("recording.invalidAdapter".into());
            }
            if let Some(existing) = self
                .record
                .performers
                .iter_mut()
                .find(|p| p.id == performer.id)
            {
                *existing = performer;
            } else {
                self.record.performers.push(performer);
            }
        }
        for mut event in capture.events {
            if event.sequence <= self.last_sequence {
                continue;
            }
            if event.sequence != self.last_sequence + 1
                || event.at_ms > MAX_DURATION
                || event.kind.len() > 256
            {
                return Err("recording.invalidAdapter".into());
            }
            self.last_sequence = event.sequence;
            if event.performer_id.as_ref().is_some_and(|id| {
                !self
                    .record
                    .passes
                    .iter()
                    .any(|pass| &pass.id == pass_id && pass.performer_ids.contains(id))
            }) {
                return Err("recording.invalidAdapter".into());
            }
            // The common conductor belongs to the first pass alone.
            if self.mode != "recording"
                && (event.performer_id.is_none() || event.at_ms > self.record.duration_ms)
            {
                continue;
            }
            event.sequence = event
                .sequence
                .checked_add(self.sequence_offset)
                .ok_or("recording.tooLarge")?;
            self.record.events.push(event);
        }
        if self.mode == "recording" {
            self.record.duration_ms = capture.elapsed_ms;
        }
        self.record
            .events
            .sort_by_key(|event| (event.at_ms, event.sequence));
        Ok(())
    }
    fn pending_name(&self) -> String {
        format!("pending-{}.json", self.operation_id)
    }
    fn checkpoint(&self) -> Result<(), String> {
        if self.mode == "playback" {
            return Ok(());
        }
        validate_record(&self.record)?;
        self.store.write(&self.pending_name(), &self.record)
    }
}

fn finish(inner: &mut Inner, discard: bool) -> Result<(), String> {
    let Some(pass) = inner.active.as_mut() else {
        return Ok(());
    };
    let capture: Result<Capture, _> = post(
        pass.target.port,
        &json!({"action":"end", "operationId":pass.operation_id,
        "elapsedMs":if pass.mode == "recording" { pass.elapsed() } else { pass.elapsed().min(pass.record.duration_ms) },
        "afterSequence":pass.last_sequence, "release":pass.mode != "recording"}),
    );
    let result = (|| {
        let capture = capture?;
        if pass.publish_allowed {
            pass.capture(capture)?;
        }
        if pass.publish_allowed && !discard && pass.mode != "playback" {
            pass.record
                .events
                .sort_by_key(|event| (event.at_ms, event.sequence));
            // Bound rerecord/overdub tails, preserving the first pass duration.
            pass.record
                .events
                .retain(|event| event.at_ms <= pass.record.duration_ms);
            pass.record.complete = true;
            validate_record(&pass.record)?;
            pass.store
                .write(&format!("{}.json", pass.record.id), &pass.record)?;
        }
        if pass.publish_allowed && pass.mode != "playback" {
            if let Err(error) = pass.store.remove(&pass.pending_name()) {
                // Publication already succeeded. A leftover recovery file must
                // not turn a saved replacement into a reported save failure.
                log::warn!("Saved recording checkpoint cleanup failed: {error}");
            }
        }
        Ok(())
    })();
    match result {
        Ok(()) => {
            inner.snapshot.elapsed_ms = pass.record.duration_ms.min(pass.elapsed());
            inner.snapshot.operation_id = None;
            inner.snapshot.status = "idle".into();
            inner.snapshot.revision = inner.snapshot.revision.wrapping_add(1);
            inner.snapshot.error = None;
            inner.active = None;
            Ok(())
        }
        Err(error) => fail(inner, error),
    }
}

fn fail(inner: &mut Inner, error: String) -> Result<(), String> {
    if let Some(pass) = inner.active.as_mut() {
        if pass.publish_allowed {
            pass.record.complete = false;
            let _ = pass.checkpoint();
        }
        pass.publish_allowed = false;
        let cleanup: Result<Value, _> = post(
            pass.target.port,
            &json!({"action":"end", "operationId":pass.operation_id,"release":pass.mode != "recording"}),
        );
        if cleanup.is_ok() {
            inner.active = None;
        }
    }
    inner.snapshot.revision = inner.snapshot.revision.wrapping_add(1);
    inner.snapshot.status = "error".into();
    inner.snapshot.operation_id = inner.active.as_ref().map(|pass| pass.operation_id.clone());
    inner.snapshot.error = Some(error.clone());
    Err(error)
}

fn request(port: u16, body: Option<&Value>) -> Result<Vec<u8>, String> {
    let url = format!("http://127.0.0.1:{port}/__pnds/recording");
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(2)))
        .build()
        .new_agent();
    let response = if let Some(body) = body {
        agent
            .post(&url)
            .header("Content-Type", "application/json")
            .send(serde_json::to_vec(body).map_err(|e| e.to_string())?)
    } else {
        agent.get(&url).call()
    }
    .map_err(|e| format!("recording.adapterUnavailable: {e}"))?;
    response
        .into_body()
        .with_config()
        .limit(MAX_BYTES)
        .read_to_vec()
        .map_err(|e| e.to_string())
}
fn get<T: serde::de::DeserializeOwned>(port: u16) -> Result<T, String> {
    serde_json::from_slice(&request(port, None)?)
        .map_err(|e| format!("recording.invalidAdapter: {e}"))
}
fn post<T: serde::de::DeserializeOwned>(port: u16, body: &Value) -> Result<T, String> {
    serde_json::from_slice(&request(port, Some(body))?)
        .map_err(|e| format!("recording.invalidAdapter: {e}"))
}
fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_BYTES {
        return Err("recording.tooLarge".into());
    }
    serde_json::from_reader(file.take(MAX_BYTES + 1))
        .map_err(|e| format!("recording.invalidFile: {e}"))
}
fn ensure_not_active(inner: &Inner, store: &RecordingStore, id: &str) -> Result<(), String> {
    if inner.active.as_ref().is_some_and(|pass| {
        pass.store.same_directory(store) && (pass.record.id == id || pass.operation_id == id)
    }) {
        return Err("recording.busy".into());
    }
    Ok(())
}

fn read_record(path: &Path) -> Result<PerformanceRecord, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    read_record_from_bytes(&bytes)
}

fn read_record_from_bytes(bytes: &[u8]) -> Result<PerformanceRecord, String> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err("recording.tooLarge".into());
    }
    let mut value: Value =
        serde_json::from_slice(bytes).map_err(|error| format!("recording.invalidFile: {error}"))?;
    if value["schemaVersion"] == json!(1) && value.get("passes").is_none() {
        value["passes"] = json!([]);
    }
    let mut record: PerformanceRecord =
        serde_json::from_value(value).map_err(|error| format!("recording.invalidFile: {error}"))?;
    validate_record(&record)?;
    if record.schema_version == 1 {
        record.passes = vec![RecordedPass {
            id: record.id.clone(),
            performer_ids: record
                .performers
                .iter()
                .map(|performer| performer.id.clone())
                .collect(),
            legacy: true,
        }];
        record.schema_version = 2;
    }
    Ok(record)
}

fn remove_performers(record: &mut PerformanceRecord, ids: &[String]) {
    record
        .performers
        .retain(|performer| !ids.contains(&performer.id));
    // Null identities are the common conductor, independent of any pass.
    record.events.retain(|event| {
        event
            .performer_id
            .as_ref()
            .is_none_or(|id| !ids.contains(id))
    });
}

fn atomic_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("recording.tooLarge".into());
    }
    let parent = path.parent().ok_or("recording.invalidFile")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary
        .write_all(&bytes)
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    temporary.persist(path).map_err(|e| e.to_string())?;
    File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|e| e.to_string())
}
fn random_id() -> Result<String, String> {
    let mut bytes = [0; 16];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| "recording.randomFailed")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn valid_id(id: &str) -> Result<(), String> {
    if id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("recording.invalidFile".into());
    }
    Ok(())
}
fn validate_record(record: &PerformanceRecord) -> Result<(), String> {
    valid_id(&record.id)?;
    if !matches!(record.schema_version, 1 | 2)
        || record.original_source.adapter.protocol_version != 1
        || record.interpreted_by.adapter != record.original_source.adapter
    {
        return Err("recording.incompatible".into());
    }
    if record.duration_ms > MAX_DURATION
        || record.performers.len() > 1024
        || record.events.len() > 1_000_000
    {
        return Err("recording.invalidFile".into());
    }
    let mut ids = std::collections::HashSet::new();
    for performer in &record.performers {
        if performer.id.is_empty() || performer.id.len() > 256 || !ids.insert(&performer.id) {
            return Err("recording.invalidFile".into());
        }
    }
    if record.schema_version == 2 {
        let mut pass_ids = std::collections::HashSet::new();
        let mut members = std::collections::HashSet::new();
        if record.passes.len() > 1024 {
            return Err("recording.invalidFile".into());
        }
        for pass in &record.passes {
            valid_id(&pass.id)?;
            if !pass_ids.insert(&pass.id) {
                return Err("recording.invalidFile".into());
            }
            for id in &pass.performer_ids {
                if !ids.contains(id) || !members.insert(id) {
                    return Err("recording.invalidFile".into());
                }
            }
        }
        if members != ids {
            return Err("recording.invalidFile".into());
        }
    } else if !record.passes.is_empty() {
        return Err("recording.invalidFile".into());
    }
    let mut previous = (0, 0);
    let mut sequences = std::collections::HashSet::new();
    for event in &record.events {
        let key = (event.at_ms, event.sequence);
        if key < previous
            || !sequences.insert(event.sequence)
            || event.at_ms > record.duration_ms
            || event
                .performer_id
                .as_ref()
                .is_some_and(|id| !ids.contains(id))
        {
            return Err("recording.invalidFile".into());
        }
        previous = key;
    }
    Ok(())
}

/// Native exit may arrive after the main WebView was destroyed. A localized
/// native error remains visible without requiring that page to render it.
pub fn notify_exit_failure<R: tauri::Runtime>(app: &tauri::AppHandle<R>, participation: bool) {
    use tauri_plugin_dialog::DialogExt as _;
    let language = crate::commands::preferences::load_preferences_sync(app)
        .ok()
        .and_then(|prefs| prefs.language)
        .or_else(tauri_plugin_os::locale)
        .unwrap_or_default();
    let bytes = if language.starts_with("zh") {
        include_str!("../../locales/zh-CN.json")
    } else {
        include_str!("../../locales/en.json")
    };
    if let Ok(locale) = serde_json::from_str::<Value>(bytes) {
        let (title_key, message_key) = if participation {
            ("participation.failed", "participation.exitFailed")
        } else {
            ("recording.failed", "recording.exitFailed")
        };
        if let (Some(title), Some(message)) =
            (locale[title_key].as_str(), locale[message_key].as_str())
        {
            app.dialog().message(message).title(title).show(|_| {});
        }
    }
    crate::window::force_show_if_hidden(app);
}

#[cfg(test)]
mod tests;
