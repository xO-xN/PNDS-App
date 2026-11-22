//! The main App shell and the currently retained performance document share
//! one mapping owner. Hardware receivers capture that owner before dispatch.
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};
use tauri_specta::Event;

#[cfg(any(target_os = "macos", test))]
mod midi;
mod osc;
#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
pub(crate) use midi::native::fixture::VirtualMidiSource;
#[cfg(target_os = "macos")]
pub(crate) mod page;
#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ControllerRole {
    Host,
    Client,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControllerScope {
    pub key: String,
    pub name: String,
    pub role: ControllerRole,
}

impl ControllerScope {
    pub(crate) fn host(project_path: String, name: String) -> Self {
        Self {
            key: format!("host:{project_path}"),
            name,
            role: ControllerRole::Host,
        }
    }

    pub(crate) fn client(host: &crate::participation_client::ClientHostInfo) -> Option<Self> {
        // A native Client can also join a Creation test, which is outside
        // performance controller ownership. Legacy Host metadata omits role.
        if host
            .role
            .is_some_and(|role| role != crate::lan_discovery::LanNodeRole::Host)
        {
            return None;
        }
        let performance = host.performance.as_ref()?;
        let identity = serde_json::json!([host.host_id, performance.project_id]);
        Some(Self {
            key: format!("client:{identity}"),
            name: format!("{} · {}", performance.project_name, host.node_name),
            role: ControllerRole::Client,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ControllerAddress {
    MidiNote {
        port: i32,
        channel: u8,
        note: u8,
    },
    Osc {
        sender: Option<String>,
        address: String,
    },
}

impl ControllerAddress {
    fn label(&self) -> String {
        match self {
            Self::MidiNote {
                port,
                channel,
                note,
            } => {
                #[cfg(target_os = "macos")]
                let name = midi::native::endpoint_display_name(*port);
                #[cfg(not(target_os = "macos"))]
                let name: Option<String> = None;
                let name = name.unwrap_or_else(|| port.to_string());
                format!("{name} · Ch {channel} · Note {note}")
            }
            Self::Osc { sender, address } => sender
                .as_ref()
                .map_or_else(|| address.clone(), |sender| format!("{sender} · {address}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControllerInput {
    pub address: ControllerAddress,
    pub value: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ControllerTargetKind {
    Trigger,
    Switch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControllerTarget {
    pub id: String,
    pub name: String,
    pub kind: ControllerTargetKind,
    pub temporary: bool,
}

impl ControllerTarget {
    fn accepts(&self, input: &ControllerInput) -> bool {
        input.value.is_none()
    }

    fn valid(&self) -> bool {
        !self.id.is_empty() && self.id.len() <= 1024 && self.name.len() <= 1024
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControllerMapping {
    pub target: ControllerTarget,
    pub address: ControllerAddress,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControllerMappingGroup {
    pub scope: ControllerScope,
    pub mappings: Vec<ControllerMapping>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControllerOscSettings {
    pub enabled: bool,
    pub port: u16,
}

impl Default for ControllerOscSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 9000,
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(default, rename_all = "camelCase")]
pub struct ControllerMappingPreferences {
    pub midi_ports: Vec<i32>,
    pub osc: ControllerOscSettings,
    pub groups: Vec<ControllerMappingGroup>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControllerMidiPort {
    pub id: i32,
    pub name: String,
    pub enabled: bool,
    pub connected: bool,
    pub recent: Option<ControllerAddress>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControllerMappingSnapshot {
    pub revision: u32,
    pub save_revision: u32,
    pub page: Option<u32>,
    pub scope: Option<ControllerScope>,
    pub learning: bool,
    pub pending: Option<ControllerTarget>,
    pub mappings: Vec<ControllerMapping>,
    pub unavailable: Vec<String>,
    pub preferences: ControllerMappingPreferences,
    pub osc_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
enum PageReport {
    Selected(ControllerTarget),
    Exit,
    Availability {
        revision: u32,
        unavailable: Vec<String>,
    },
}

struct ActivePage {
    id: u32,
    scope: ControllerScope,
    learning: bool,
    pending: Option<ControllerTarget>,
    mappings: Vec<ControllerMapping>,
    unavailable: Vec<String>,
    config_revision: u32,
}

#[derive(Default)]
struct MappingState {
    preferences: ControllerMappingPreferences,
    initialized: bool,
    page: Option<ActivePage>,
    next_page: u32,
    revision: u32,
    save_revision: u32,
    osc_generation: u32,
    osc_listener: Option<osc::Listener>,
    osc_error: Option<String>,
    osc_recent: Option<String>,
    #[cfg(target_os = "macos")]
    midi: midi::Routes,
}

impl MappingState {
    fn page(&self, id: u32) -> Option<&ActivePage> {
        self.page.as_ref().filter(|page| page.id == id)
    }

    fn page_mut(&mut self, id: u32) -> Option<&mut ActivePage> {
        self.page.as_mut().filter(|page| page.id == id)
    }

    fn attach(&mut self, scope: ControllerScope) -> u32 {
        self.next_page += 1;
        let mappings = self
            .preferences
            .groups
            .iter()
            .find(|group| group.scope.key == scope.key)
            .map(|group| group.mappings.clone())
            .unwrap_or_default();
        self.page = Some(ActivePage {
            id: self.next_page,
            scope,
            learning: false,
            pending: None,
            mappings,
            unavailable: Vec::new(),
            config_revision: 0,
        });
        self.revision += 1;
        self.next_page
    }

    fn retire(&mut self, id: u32) -> bool {
        if self.page(id).is_none() {
            return false;
        }
        self.page = None;
        self.revision += 1;
        true
    }

    fn set_learning(&mut self, id: u32, learning: bool) -> bool {
        let Some(page) = self.page_mut(id) else {
            return false;
        };
        if page.learning == learning {
            return false;
        }
        page.learning = learning;
        page.pending = None;
        self.revision += 1;
        true
    }

    fn handle_page(&mut self, id: u32, report: PageReport) -> bool {
        let Some(page) = self.page_mut(id) else {
            return false;
        };
        match report {
            PageReport::Exit => return self.set_learning(id, false),
            PageReport::Selected(target) if page.learning && target.valid() => {
                page.pending = Some(target);
            }
            PageReport::Availability {
                revision,
                mut unavailable,
            } if revision == page.config_revision => {
                unavailable.retain(|id| page.mappings.iter().any(|map| map.target.id == *id));
                if unavailable == page.unavailable {
                    return false;
                }
                page.mappings
                    .retain(|map| !map.target.temporary || !unavailable.contains(&map.target.id));
                unavailable.retain(|id| page.mappings.iter().any(|map| map.target.id == *id));
                page.unavailable = unavailable;
            }
            _ => return false,
        }
        self.revision += 1;
        true
    }

    fn receive(&mut self, id: u32, input: &ControllerInput) -> Option<ControllerMapping> {
        let page = self.page_mut(id)?;
        if !page.learning {
            return page
                .mappings
                .iter()
                .find(|mapping| {
                    mapping.address == input.address
                        && mapping.target.accepts(input)
                        && !page.unavailable.contains(&mapping.target.id)
                })
                .cloned();
        }
        let pending = page
            .pending
            .as_ref()
            .filter(|target| target.accepts(input))?;
        let target = pending.clone();
        page.pending = None;
        page.mappings
            .retain(|mapping| mapping.address != input.address && mapping.target.id != target.id);
        page.unavailable.retain(|id| id != &target.id);
        page.mappings.push(ControllerMapping {
            target,
            address: input.address.clone(),
        });
        self.save_active_group();
        self.revision += 1;
        None
    }

    fn save_active_group(&mut self) {
        let Some(page) = self.page.as_ref() else {
            return;
        };
        let group = ControllerMappingGroup {
            scope: page.scope.clone(),
            mappings: page
                .mappings
                .iter()
                .filter(|mapping| !mapping.target.temporary)
                .cloned()
                .collect(),
        };
        let previous = self
            .preferences
            .groups
            .iter()
            .position(|current| current.scope.key == group.scope.key);
        match previous {
            Some(index) if self.preferences.groups[index] == group => return,
            Some(index) if group.mappings.is_empty() => {
                self.preferences.groups.remove(index);
            }
            Some(index) => self.preferences.groups[index] = group,
            None if group.mappings.is_empty() => return,
            None => self.preferences.groups.push(group),
        }
        self.save_revision += 1;
    }

    fn remove(&mut self, scope: &str, target: &str) {
        if let Some(page) = self.page.as_mut().filter(|page| page.scope.key == scope) {
            page.mappings.retain(|map| map.target.id != target);
            page.unavailable.retain(|id| id != target);
            self.save_active_group();
        } else if let Some(group) = self
            .preferences
            .groups
            .iter_mut()
            .find(|group| group.scope.key == scope)
        {
            let before = group.mappings.len();
            group.mappings.retain(|map| map.target.id != target);
            if group.mappings.len() != before {
                self.save_revision += 1;
            }
            self.preferences
                .groups
                .retain(|group| !group.mappings.is_empty());
        }
        self.revision += 1;
    }

    fn snapshot(&self) -> ControllerMappingSnapshot {
        let page = self.page.as_ref();
        ControllerMappingSnapshot {
            revision: self.revision,
            save_revision: self.save_revision,
            page: page.map(|page| page.id),
            scope: page.map(|page| page.scope.clone()),
            learning: page.is_some_and(|page| page.learning),
            pending: page.and_then(|page| page.pending.clone()),
            mappings: page.map(|page| page.mappings.clone()).unwrap_or_default(),
            unavailable: page
                .map(|page| page.unavailable.clone())
                .unwrap_or_default(),
            preferences: self.preferences.clone(),
            osc_error: self.osc_error.clone(),
        }
    }
}

#[derive(Default)]
pub struct ControllerMappings {
    inner: Mutex<MappingState>,
    #[cfg(target_os = "macos")]
    midi_input: Mutex<Option<midi::native::Input>>,
}

impl ControllerMappings {
    fn lock(&self) -> std::sync::MutexGuard<'_, MappingState> {
        self.inner.lock().unwrap_or_else(|error| error.into_inner())
    }
}

#[derive(Debug, Clone, Serialize, Type, Event)]
pub struct ControllerMappingEvent {
    pub snapshot: ControllerMappingSnapshot,
}

fn publish<R: Runtime>(app: &AppHandle<R>, snapshot: ControllerMappingSnapshot) {
    let _ = ControllerMappingEvent { snapshot }.emit_to(app, "main");
}

fn synchronize_page<R: Runtime>(app: &AppHandle<R>, snapshot: &ControllerMappingSnapshot) {
    #[cfg(target_os = "macos")]
    if let Some(id) = snapshot.page {
        let state = app.state::<ControllerMappings>();
        if let Some(active) = state.lock().page_mut(id) {
            active.config_revision = snapshot.revision;
        }
        let mappings: Vec<_> = snapshot
            .mappings
            .iter()
            .map(|mapping| {
                serde_json::json!({
                    "target": mapping.target,
                    "label": mapping.address.label(),
                })
            })
            .collect();
        let _ = page::send(
            id,
            &serde_json::json!({
                "type": "configure",
                "revision": snapshot.revision,
                "learning": snapshot.learning,
                "pending": snapshot.pending,
                "mappings": mappings,
            }),
        );
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, snapshot);
}

fn show_changed<R: Runtime>(app: &AppHandle<R>, snapshot: ControllerMappingSnapshot) {
    synchronize_page(app, &snapshot);
    publish(app, snapshot);
}

pub(crate) fn receive_osc<R: Runtime>(app: &AppHandle<R>, listener: u32, input: ControllerInput) {
    let state = app.state::<ControllerMappings>();
    let id = {
        let mut state = state.lock();
        if state.osc_generation != listener || !state.preferences.osc.enabled {
            return;
        }
        state.osc_recent = Some(input.address.label());
        let Some(page) = state.page.as_ref() else {
            return;
        };
        page.id
    };
    deliver(app, id, input, move |state| {
        state.osc_generation == listener && state.preferences.osc.enabled
    });
}

#[cfg(target_os = "macos")]
fn receive_midi<R: Runtime>(app: &AppHandle<R>, token: usize, message: midi::Message) {
    let state = app.state::<ControllerMappings>();
    let (id, input) = {
        let mut state = state.lock();
        let Some(input) = state.midi.receive(token, message) else {
            return;
        };
        let Some(page) = state.page.as_ref() else {
            return;
        };
        (page.id, input)
    };
    let ControllerAddress::MidiNote { port, .. } = input.address else {
        return;
    };
    deliver(app, id, input, move |state| state.midi.owns(port, token));
}

fn deliver<R: Runtime>(
    app: &AppHandle<R>,
    id: u32,
    input: ControllerInput,
    active: impl FnOnce(&MappingState) -> bool + Send + 'static,
) {
    let main = app.clone();
    let _ = app.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        if !page::owns(id) {
            return;
        }
        let state = main.state::<ControllerMappings>();
        let (apply, snapshot) = {
            let mut state = state.lock();
            if !active(&state) {
                return;
            }
            let before = state.revision;
            let apply = state.receive(id, &input);
            (apply, (before != state.revision).then(|| state.snapshot()))
        };
        if let Some(snapshot) = snapshot {
            show_changed(&main, snapshot);
        }
        #[cfg(target_os = "macos")]
        if let Some(mapping) = apply {
            let _ = page::send(
                id,
                &serde_json::json!({
                    "type": "input",
                    "target": mapping.target,
                    "input": input,
                }),
            );
        }
        #[cfg(not(target_os = "macos"))]
        let _ = apply;
    });
}

fn set_osc<R: Runtime>(
    app: &AppHandle<R>,
    state: &mut MappingState,
    settings: ControllerOscSettings,
) -> Result<(), String> {
    if settings.port == 0 {
        return Err("Invalid OSC receive port".into());
    }
    if state.osc_listener.is_some() && state.preferences.osc == settings {
        return Ok(());
    }
    let generation = state.osc_generation.wrapping_add(1);
    let listener = settings
        .enabled
        .then(|| osc::Listener::start(app.clone(), generation, settings.port))
        .transpose()?;
    state.osc_listener = listener;
    state.osc_generation = generation;
    state.osc_recent = None;
    state.osc_error = None;
    state.preferences.osc = settings;
    Ok(())
}

pub(crate) fn initialize<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let Some(state) = app.try_state::<ControllerMappings>() else {
        return Ok(());
    };
    let mut state = state.lock();
    if state.initialized {
        return Ok(());
    }
    let preferences = crate::commands::preferences::load_preferences_sync(app)?;
    state.preferences = preferences.controller_mapping.unwrap_or_default();
    let osc = state.preferences.osc;
    if let Err(error) = set_osc(app, &mut state, osc) {
        state.osc_error = Some(error);
    }
    state.initialized = true;
    #[cfg(target_os = "macos")]
    {
        let restore_midi = !state.preferences.midi_ports.is_empty();
        drop(state);
        if restore_midi {
            midi::native::schedule_refresh(app);
        }
    }
    Ok(())
}

pub(crate) fn snapshot(app: &AppHandle) -> Result<ControllerMappingSnapshot, String> {
    initialize(app)?;
    Ok(app.state::<ControllerMappings>().lock().snapshot())
}

pub(crate) async fn configure_osc(
    app: AppHandle,
    settings: ControllerOscSettings,
) -> Result<ControllerMappingSnapshot, String> {
    on_main(app, move |main| {
        let state = main.state::<ControllerMappings>();
        let snapshot = {
            let mut state = state.lock();
            let previous = state.preferences.osc;
            set_osc(main, &mut state, settings)?;
            if settings != previous {
                state.save_revision += 1;
            }
            state.revision += 1;
            state.snapshot()
        };
        publish(main, snapshot.clone());
        Ok(snapshot)
    })
    .await
}

pub(crate) fn midi_ports(app: &AppHandle) -> Result<Vec<ControllerMidiPort>, String> {
    initialize(app)?;
    #[cfg(target_os = "macos")]
    {
        let endpoints = midi::native::endpoints();
        let state = app.state::<ControllerMappings>();
        let state = state.lock();
        let mut ports: Vec<_> = endpoints
            .into_values()
            .map(|source| ControllerMidiPort {
                id: source.id,
                name: source.name,
                enabled: state.preferences.midi_ports.contains(&source.id),
                connected: state.midi.connected(source.id),
                recent: state.midi.recent(source.id),
            })
            .collect();
        for &id in &state.preferences.midi_ports {
            if !ports.iter().any(|port| port.id == id) {
                ports.push(ControllerMidiPort {
                    id,
                    name: id.to_string(),
                    enabled: true,
                    connected: false,
                    recent: None,
                });
            }
        }
        ports.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
        Ok(ports)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}

pub(crate) async fn configure_midi_port(
    app: AppHandle,
    port: i32,
    enabled: bool,
) -> Result<ControllerMappingSnapshot, String> {
    #[cfg(target_os = "macos")]
    return on_main(app, move |main| {
        let state = main.state::<ControllerMappings>();
        let mut ports = state.lock().preferences.midi_ports.clone();
        match (ports.contains(&port), enabled) {
            (false, true) => ports.push(port),
            (true, false) => ports.retain(|id| *id != port),
            _ => {}
        }
        midi::native::synchronize(main, &ports, Some(port))?;
        let snapshot = {
            let mut state = state.lock();
            if state.preferences.midi_ports != ports {
                state.preferences.midi_ports = ports;
                state.save_revision += 1;
                state.revision += 1;
            }
            state.snapshot()
        };
        publish(main, snapshot.clone());
        Ok(snapshot)
    })
    .await;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, port, enabled);
        Err("Core MIDI is available on macOS".into())
    }
}

pub(crate) async fn set_learning(
    app: AppHandle,
    page: u32,
    learning: bool,
) -> Result<ControllerMappingSnapshot, String> {
    on_main(app, move |main| {
        #[cfg(target_os = "macos")]
        if learning && !self::page::owns(page) {
            return Err("The performance page has retired".into());
        }
        let state = main.state::<ControllerMappings>();
        let (changed, snapshot) = {
            let mut state = state.lock();
            (state.set_learning(page, learning), state.snapshot())
        };
        if changed {
            show_changed(main, snapshot.clone());
        }
        Ok(snapshot)
    })
    .await
}

pub(crate) async fn remove_mapping(
    app: AppHandle,
    scope: String,
    target: String,
) -> Result<ControllerMappingSnapshot, String> {
    on_main(app, move |main| {
        let state = main.state::<ControllerMappings>();
        let snapshot = {
            let mut state = state.lock();
            state.remove(&scope, &target);
            state.snapshot()
        };
        show_changed(main, snapshot.clone());
        Ok(snapshot)
    })
    .await
}

pub(crate) fn osc_activity(app: &AppHandle) -> Option<String> {
    app.state::<ControllerMappings>().lock().osc_recent.clone()
}

async fn on_main<T: Send + 'static>(
    app: AppHandle,
    action: impl FnOnce(&AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    initialize(&app)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let main = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(action(&main));
    })
    .map_err(|error| error.to_string())?;
    rx.await.map_err(|error| error.to_string())?
}
