//! The main App shell and the currently retained performance document share
//! one mapping owner. Hardware receivers capture that owner before dispatch.
use crate::events::ControllerMappingEvent;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{BTreeMap, BTreeSet};
use std::net::{IpAddr, Ipv4Addr};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};
use tauri_specta::Event;

#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
mod fixture;
#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
pub(crate) use fixture::{hold_next_local_osc, DeferredOsc};
#[cfg(any(target_os = "macos", test))]
mod midi;
mod osc;
#[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
pub(crate) use midi::native::fixture::VirtualMidiSource;
#[cfg(target_os = "macos")]
pub(crate) mod page;
mod range;
pub use range::{ControllerMappingRange, ControllerRange};
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
    #[cfg(any(test, target_os = "macos"))]
    pub(crate) fn host(project_path: &std::path::Path, name: String) -> std::io::Result<Self> {
        use std::os::unix::fs::MetadataExt as _;
        let path = project_path.canonicalize()?;
        let directory = std::fs::metadata(&path)?;
        let identity =
            serde_json::json!([path.to_string_lossy(), directory.dev(), directory.ino()]);
        Ok(Self {
            key: format!("host:{identity}"),
            name,
            role: ControllerRole::Host,
        })
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
        let project_name = &performance.project_name;
        let node_name = &host.node_name;
        Some(Self {
            key: format!("client:{identity}"),
            name: format!("{project_name} · {node_name}"),
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
    MidiCc {
        port: i32,
        channel: u8,
        controller: u8,
    },
    Osc {
        sender: Option<String>,
        address: String,
    },
}

impl ControllerAddress {
    fn osc_label(&self) -> Option<String> {
        let Self::Osc { sender, address } = self else {
            return None;
        };
        Some(
            sender
                .as_ref()
                .map_or_else(|| address.clone(), |sender| format!("{sender} · {address}")),
        )
    }

    #[cfg(target_os = "macos")]
    fn display_label(&self, catalog: &serde_json::Value) -> String {
        let (port, channel, key, parameter, value) = match self {
            Self::MidiNote {
                port,
                channel,
                note,
            } => (
                port,
                channel,
                "controllerMapping.midiNote",
                "{{note}}",
                note,
            ),
            Self::MidiCc {
                port,
                channel,
                controller,
            } => (
                port,
                channel,
                "controllerMapping.midiCc",
                "{{controller}}",
                controller,
            ),
            Self::Osc { .. } => return self.osc_label().unwrap_or_default(),
        };
        let name = midi::native::endpoint_display_name(*port).unwrap_or_else(|| port.to_string());
        let control = catalog[key]
            .as_str()
            .unwrap_or(parameter)
            .replace("{{channel}}", &channel.to_string())
            .replace(parameter, &value.to_string());
        format!("{name} · {control}")
    }

    fn fixed_input_bounds(&self) -> Option<(f64, f64)> {
        matches!(self, Self::MidiCc { .. }).then_some((0.0, 127.0))
    }

    #[cfg(target_os = "macos")]
    fn midi_port(&self) -> Option<i32> {
        match self {
            Self::MidiNote { port, .. } | Self::MidiCc { port, .. } => Some(*port),
            Self::Osc { .. } => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControllerMidiCcInput {
    connection: usize,
    #[serde(skip)]
    press: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllerInput {
    pub address: ControllerAddress,
    pub value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    midi_cc: Option<ControllerMidiCcInput>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ControllerTargetKind {
    Trigger,
    Switch,
    Continuous,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControllerTarget {
    pub id: String,
    pub name: String,
    pub kind: ControllerTargetKind,
    pub temporary: bool,
    pub range: Option<ControllerRange>,
}

impl ControllerTarget {
    fn is_declared(&self) -> bool {
        !self.temporary && self.id.starts_with("declared:")
    }

    fn accepts(&self, input: &ControllerInput) -> bool {
        if let Some(cc) = input.midi_cc {
            return self.kind == ControllerTargetKind::Continuous || cc.press;
        }
        match self.kind {
            ControllerTargetKind::Trigger => input.value.is_none(),
            ControllerTargetKind::Switch => true,
            ControllerTargetKind::Continuous => input.value.is_some(),
        }
    }

    fn valid(&self) -> bool {
        !self.id.is_empty()
            && self.id.len() <= 1024
            && self.name.len() <= 1024
            && match self.kind {
                ControllerTargetKind::Continuous => self.range.is_some_and(ControllerRange::valid),
                _ => self.range.is_none(),
            }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControllerMapping {
    pub target: ControllerTarget,
    pub address: ControllerAddress,
    pub range: Option<ControllerMappingRange>,
}

impl ControllerMapping {
    fn configure_range(
        &mut self,
        range: ControllerMappingRange,
        current_target: Option<ControllerTarget>,
    ) -> Result<bool, String> {
        let target = current_target.unwrap_or_else(|| self.target.clone());
        if target.kind != self.target.kind {
            return Err("The project control changed kind; learn the mapping again".into());
        }
        if self
            .address
            .fixed_input_bounds()
            .is_some_and(|bounds| bounds != (range.input_min, range.input_max))
        {
            return Err("Absolute MIDI CC input uses 0–127".into());
        }
        if !target.range.is_some_and(|legal| range.valid_for(legal)) {
            return Err("The mapping range must contain a legal target value".into());
        }
        if self.range == Some(range) && self.target == target {
            return Ok(false);
        }
        self.range = Some(range);
        self.target = target;
        Ok(true)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControllerMappingGroup {
    pub scope: ControllerScope,
    pub mappings: Vec<ControllerMapping>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ControllerOscSettings {
    pub enabled: bool,
    pub port: u16,
    #[serde(default)]
    pub lan_enabled: bool,
    #[serde(default)]
    pub lan_senders: Vec<String>,
}

impl Default for ControllerOscSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 9000,
            lan_enabled: false,
            lan_senders: Vec::new(),
        }
    }
}

impl ControllerOscSettings {
    fn admits(&self, sender: IpAddr) -> bool {
        self.enabled
            && (sender.is_loopback()
                || (self.lan_enabled && self.lan_senders.contains(&sender.to_string())))
    }

    fn normalize(&mut self) -> Result<(), String> {
        if self.port == 0 {
            return Err("Invalid OSC receive port".into());
        }
        let mut normalized = BTreeSet::new();
        for source in &self.lan_senders {
            let source = source
                .parse::<Ipv4Addr>()
                .map_err(|_| "Invalid OSC sender IPv4 address")?;
            if source.is_loopback()
                || source.is_unspecified()
                || source.is_multicast()
                || source.is_broadcast()
            {
                return Err("Invalid OSC sender IPv4 address".into());
            }
            normalized.insert(source);
        }
        self.lan_senders = normalized
            .into_iter()
            .map(|address| address.to_string())
            .collect();
        Ok(())
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
    pub declared_targets: Vec<ControllerTarget>,
    pub mappings: Vec<ControllerMapping>,
    pub unavailable: Vec<String>,
    pub preferences: ControllerMappingPreferences,
    pub osc_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
enum PageReport {
    Selected {
        target: ControllerTarget,
        click: u32,
        mode: u32,
    },
    DeclaredTargets {
        targets: Vec<ControllerTarget>,
    },
    Exit {
        mode: u32,
    },
    Availability {
        revision: u32,
        unavailable: Vec<String>,
    },
}

/// Captured with the source packet, before any main-thread or WebKit dispatch.
#[derive(Clone, Copy)]
struct InputOwner {
    page: u32,
    version: u32,
}

enum InputDelivery {
    Apply(ControllerMapping),
    VerifySelection { click: u32 },
}

struct ActivePage {
    id: u32,
    scope: ControllerScope,
    learning: bool,
    pending: Option<ControllerTarget>,
    declared_targets: Vec<ControllerTarget>,
    mappings: Vec<ControllerMapping>,
    unavailable: Vec<String>,
    config_revision: u32,
    mode_version: u32,
    delivery_version: u32,
    latest_click: u32,
    verifying_selection: bool,
}

impl ActivePage {
    fn input_owner(&self) -> InputOwner {
        InputOwner {
            page: self.id,
            version: self.delivery_version,
        }
    }

    fn invalidate_input(&mut self) {
        self.delivery_version = self.delivery_version.wrapping_add(1);
        self.verifying_selection = false;
    }

    fn current_target<'a>(&'a self, target: &'a ControllerTarget) -> Option<&'a ControllerTarget> {
        if !target.is_declared() {
            return Some(target);
        }
        self.declared_targets
            .iter()
            .find(|candidate| candidate.id == target.id && candidate.kind == target.kind)
    }

    fn can_apply(&self, mapping: &ControllerMapping) -> bool {
        if self.unavailable.contains(&mapping.target.id) {
            return false;
        }
        self.current_target(&mapping.target).is_some_and(|target| {
            match (mapping.range, target.range) {
                (Some(configured), Some(legal)) => configured.valid_for(legal),
                (None, None) => true,
                _ => false,
            }
        })
    }
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
    osc_listeners: BTreeMap<Ipv4Addr, osc::Listener>,
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
            declared_targets: Vec::new(),
            mappings,
            unavailable: Vec::new(),
            config_revision: 0,
            mode_version: 0,
            delivery_version: 0,
            latest_click: 0,
            verifying_selection: false,
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
        page.mode_version = page.mode_version.wrapping_add(1);
        page.pending = None;
        page.invalidate_input();
        self.revision += 1;
        true
    }

    fn select_declared(&mut self, id: u32, target: &str) -> Result<bool, String> {
        let page = self
            .page_mut(id)
            .ok_or("The performance page has retired")?;
        let target = page
            .declared_targets
            .iter()
            .find(|candidate| candidate.id == target)
            .ok_or("The project no longer declares this control")?;
        if page.learning && page.pending.as_ref() == Some(target) {
            return Ok(false);
        }
        if !page.learning {
            page.mode_version = page.mode_version.wrapping_add(1);
            page.learning = true;
        }
        page.pending = Some(target.clone());
        page.invalidate_input();
        self.revision += 1;
        Ok(true)
    }

    fn handle_page(&mut self, id: u32, report: PageReport) -> bool {
        let Some(page) = self.page_mut(id) else {
            return false;
        };
        match report {
            PageReport::Exit { mode } if mode == page.mode_version => {
                return self.set_learning(id, false);
            }
            PageReport::Selected {
                target,
                click,
                mode,
            } if click > page.latest_click => {
                // Acknowledge every newer click so a rejected old-mode
                // selection cannot prevent a later Settings selection.
                page.latest_click = click;
                if page.learning && mode == page.mode_version && target.valid() {
                    if let Some(current) = page.current_target(&target) {
                        page.pending = Some(current.clone());
                        page.invalidate_input();
                    }
                }
            }
            PageReport::DeclaredTargets { mut targets } => {
                targets.retain(|target| target.is_declared() && target.valid());
                if targets == page.declared_targets {
                    return false;
                }
                page.declared_targets = targets;
                if let Some(pending) = page.pending.as_ref().filter(|target| target.is_declared()) {
                    let current = page
                        .declared_targets
                        .iter()
                        .find(|entry| entry.id == pending.id && entry.kind == pending.kind);
                    if current != Some(pending) {
                        page.pending = current.cloned();
                        page.invalidate_input();
                    }
                }
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

    fn prepare_input(
        &mut self,
        owner: InputOwner,
        input: &ControllerInput,
    ) -> Option<InputDelivery> {
        let page = self.page_mut(owner.page)?;
        if page.delivery_version != owner.version {
            return None;
        }
        if !page.learning {
            return page
                .mappings
                .iter()
                .find(|mapping| {
                    mapping.address == input.address
                        && mapping.target.accepts(input)
                        && page.can_apply(mapping)
                })
                .cloned()
                .map(InputDelivery::Apply);
        }
        if page.verifying_selection
            || !page
                .pending
                .as_ref()
                .is_some_and(|target| target.accepts(input))
        {
            return None;
        }
        page.verifying_selection = true;
        Some(InputDelivery::VerifySelection {
            click: page.latest_click,
        })
    }

    // Only the captured page and selection may complete a live target check.
    // Revoked sources leave the selection armed for the next eligible input.
    fn finish_learning(
        &mut self,
        owner: InputOwner,
        input: &ControllerInput,
        verified: Option<bool>,
    ) -> bool {
        let Some(page) = self.page_mut(owner.page).filter(|page| {
            page.learning && page.delivery_version == owner.version && page.verifying_selection
        }) else {
            return false;
        };
        page.verifying_selection = false;
        let Some(verified) = verified else {
            return false;
        };
        let Some(target) = page.pending.take() else {
            return false;
        };
        page.invalidate_input();
        if verified {
            page.mappings.retain(|mapping| {
                mapping.address != input.address && mapping.target.id != target.id
            });
            page.unavailable.retain(|id| id != &target.id);
            let (input_min, input_max) = input.address.fixed_input_bounds().unwrap_or((0.0, 1.0));
            page.mappings.push(ControllerMapping {
                range: target
                    .range
                    .map(|range| ControllerMappingRange::new(range, input_min, input_max)),
                target,
                address: input.address.clone(),
            });
            self.save_active_group();
        }
        self.revision += 1;
        true
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
            let before = page.mappings.len();
            page.mappings.retain(|map| map.target.id != target);
            page.unavailable.retain(|id| id != target);
            if page.mappings.len() != before {
                page.invalidate_input();
                self.save_active_group();
            }
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

    fn accepts_osc(&self, address: Ipv4Addr, generation: u32, sender: IpAddr) -> bool {
        self.osc_listeners
            .get(&address)
            .is_some_and(|listener| listener.generation == generation)
            && self.preferences.osc.admits(sender)
    }

    fn configure_range(
        &mut self,
        scope: &str,
        target: &str,
        range: ControllerMappingRange,
    ) -> Result<bool, String> {
        let active = self.page.as_mut().filter(|page| page.scope.key == scope);
        let is_active = active.is_some();
        let current_target = active
            .as_ref()
            .and_then(|page| {
                page.declared_targets
                    .iter()
                    .find(|entry| entry.id == target)
            })
            .cloned();
        let mapping = active
            .map(|page| &mut page.mappings)
            .or_else(|| {
                self.preferences
                    .groups
                    .iter_mut()
                    .find(|group| group.scope.key == scope)
                    .map(|group| &mut group.mappings)
            })
            .and_then(|mappings| {
                mappings
                    .iter_mut()
                    .find(|mapping| mapping.target.id == target)
            })
            .ok_or("The controller mapping no longer exists")?;
        if !mapping.configure_range(range, current_target)? {
            return Ok(false);
        }
        if is_active {
            self.page
                .as_mut()
                .expect("active mapping page")
                .invalidate_input();
            self.save_active_group();
        } else {
            self.save_revision += 1;
        }
        self.revision += 1;
        Ok(true)
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
            declared_targets: page
                .map(|page| page.declared_targets.clone())
                .unwrap_or_default(),
            mappings: page
                .map(|page| {
                    page.mappings
                        .iter()
                        .map(|mapping| {
                            let mut display = mapping.clone();
                            if let Some(current) = page.current_target(&mapping.target) {
                                display.target.clone_from(current);
                            }
                            display
                        })
                        .collect()
                })
                .unwrap_or_default(),
            unavailable: page
                .map(|page| {
                    page.mappings
                        .iter()
                        .filter(|mapping| !page.can_apply(mapping))
                        .map(|mapping| mapping.target.id.clone())
                        .collect()
                })
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
    #[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
    osc_capture: Mutex<Option<fixture::OscCapture>>,
}

impl ControllerMappings {
    fn lock(&self) -> std::sync::MutexGuard<'_, MappingState> {
        self.inner.lock().unwrap_or_else(|error| error.into_inner())
    }
}

fn publish<R: Runtime>(app: &AppHandle<R>, snapshot: ControllerMappingSnapshot) {
    let _ = ControllerMappingEvent { snapshot }.emit_to(app, "main");
}

fn synchronize_page<R: Runtime>(app: &AppHandle<R>, snapshot: &ControllerMappingSnapshot) {
    #[cfg(target_os = "macos")]
    if let Some(id) = snapshot.page {
        let state = app.state::<ControllerMappings>();
        let (delivery_version, mode_version) = {
            let mut state = state.lock();
            let Some(active) = state.page_mut(id) else {
                return;
            };
            active.config_revision = snapshot.revision;
            (active.delivery_version, active.mode_version)
        };
        let catalog = crate::native_locale::active_catalog(app).unwrap_or_else(|error| {
            log::warn!("Controller mapping labels could not read the active locale: {error}");
            crate::native_locale::catalog("en").expect("the App language catalog must parse")
        });
        let mappings: Vec<_> = snapshot
            .mappings
            .iter()
            .map(|mapping| {
                serde_json::json!({
                    "target": mapping.target,
                    "label": mapping.address.display_label(catalog),
                })
            })
            .collect();
        let _ = page::send(
            id,
            &serde_json::json!({
                "type": "configure",
                "revision": snapshot.revision,
                "deliveryVersion": delivery_version,
                "modeVersion": mode_version,
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

#[cfg(target_os = "macos")]
pub(crate) fn refresh_page_labels<R: Runtime>(app: &AppHandle<R>) {
    let main = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(state) = main.try_state::<ControllerMappings>() {
            let snapshot = state.lock().snapshot();
            synchronize_page(&main, &snapshot);
        }
    });
}

fn receive_osc<R: Runtime>(
    app: &AppHandle<R>,
    address: Ipv4Addr,
    listener: u32,
    sender: IpAddr,
    input: ControllerInput,
) {
    let state = app.state::<ControllerMappings>();
    let owner = {
        let mut state = state.lock();
        if !state.accepts_osc(address, listener, sender) {
            return;
        }
        state.osc_recent = input.address.osc_label();
        let Some(page) = state.page.as_ref() else {
            return;
        };
        page.input_owner()
    };
    let accepts = move |state: &MappingState| state.accepts_osc(address, listener, sender);
    #[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
    if let Some(capture) = fixture::take_capture(&state, &input.address) {
        let app = app.clone();
        capture.defer(owner.page, move || deliver(&app, owner, input, accepts));
        return;
    }
    deliver(app, owner, input, accepts);
}

#[cfg(target_os = "macos")]
fn receive_midi<R: Runtime>(app: &AppHandle<R>, token: usize, message: midi::Message) {
    let state = app.state::<ControllerMappings>();
    let (owner, input) = {
        let mut state = state.lock();
        let Some(input) = state.midi.receive(token, message) else {
            return;
        };
        let Some(page) = state.page.as_ref() else {
            return;
        };
        (page.input_owner(), input)
    };
    let Some(port) = input.address.midi_port() else {
        return;
    };
    deliver(app, owner, input, move |state| state.midi.owns(port, token));
}

fn deliver<R: Runtime>(
    app: &AppHandle<R>,
    owner: InputOwner,
    input: ControllerInput,
    active: impl Fn(&MappingState) -> bool + Send + 'static,
) {
    let main = app.clone();
    let _ = app.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        if !page::owns(owner.page) {
            return;
        }
        let state = main.state::<ControllerMappings>();
        let delivery = {
            let mut state = state.lock();
            if !active(&state) {
                return;
            }
            state.prepare_input(owner, &input)
        };
        #[cfg(target_os = "macos")]
        match delivery {
            Some(InputDelivery::Apply(mapping)) => {
                let _ = page::send(
                    owner.page,
                    &serde_json::json!({
                        "type": "input",
                        "deliveryVersion": owner.version,
                        "target": mapping.target,
                        "input": input,
                        "range": mapping.range,
                    }),
                );
            }
            Some(InputDelivery::VerifySelection { click }) => {
                let callback_app = main.clone();
                page::verify_learning(owner, click, move |verified| {
                    if !page::owns(owner.page) {
                        return;
                    }
                    let state = callback_app.state::<ControllerMappings>();
                    let snapshot = {
                        let mut state = state.lock();
                        let verified = verified.filter(|_| active(&state));
                        state
                            .finish_learning(owner, &input, verified)
                            .then(|| state.snapshot())
                    };
                    if let Some(snapshot) = snapshot {
                        show_changed(&callback_app, snapshot);
                    }
                });
            }
            None => {}
        }
        #[cfg(not(target_os = "macos"))]
        let _ = delivery;
    });
}

fn set_osc<R: Runtime>(
    app: &AppHandle<R>,
    state: &mut MappingState,
    mut settings: ControllerOscSettings,
) -> Result<(), String> {
    settings.normalize()?;
    let addresses = osc::listen_addresses(&settings)?;
    let same_port = state.preferences.osc.port == settings.port;
    // Keep listeners already covering the requested port and interface. Bind
    // replacements before changing the active policy or releasing old sockets.
    let mut replacements = BTreeMap::new();
    for &address in &addresses {
        if same_port && state.osc_listeners.contains_key(&address) {
            continue;
        }
        state.osc_generation = state.osc_generation.wrapping_add(1);
        let listener =
            osc::Listener::start(app.clone(), state.osc_generation, address, settings.port)?;
        replacements.insert(address, listener);
    }
    state
        .osc_listeners
        .retain(|address, _| same_port && addresses.contains(address));
    state.osc_listeners.append(&mut replacements);
    if state.preferences.osc != settings {
        state.osc_recent = None;
    }
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
    let osc = state.preferences.osc.clone();
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
            let previous = state.preferences.osc.clone();
            set_osc(main, &mut state, settings)?;
            if state.preferences.osc != previous {
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

pub(crate) async fn select_declared_target(
    app: AppHandle,
    page: u32,
    target: String,
) -> Result<ControllerMappingSnapshot, String> {
    on_main(app, move |main| {
        #[cfg(target_os = "macos")]
        if !self::page::owns(page) {
            return Err("The performance page has retired".into());
        }
        let state = main.state::<ControllerMappings>();
        let (changed, snapshot) = {
            let mut state = state.lock();
            (state.select_declared(page, &target)?, state.snapshot())
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

pub(crate) async fn configure_mapping_range(
    app: AppHandle,
    scope: String,
    target: String,
    range: ControllerMappingRange,
) -> Result<ControllerMappingSnapshot, String> {
    on_main(app, move |main| {
        let state = main.state::<ControllerMappings>();
        let (changed, snapshot) = {
            let mut state = state.lock();
            let changed = state.configure_range(&scope, &target, range)?;
            (changed, state.snapshot())
        };
        if changed {
            show_changed(main, snapshot.clone());
        }
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
