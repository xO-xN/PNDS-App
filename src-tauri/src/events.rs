//! App-internal Tauri events — the typed Rust→React channel.
//!
//! Each event is a payload struct registered in `collect_events!`
//! (bindings.rs); tauri-specta derives the wire name from the struct's
//! name and generates the frontend's typed `events` object from the same
//! definition, so neither side can drift. The reverse channel (React →
//! Rust) is the generated `commands`; this module is the other half.
//!
//! Naming history: these were stringly `"pnds:*"` events with hand-typed
//! payloads at every listener. The names are App-internal (both sides
//! regenerate atomically) and moved to the derive's struct names in one
//! pass — no external contract referenced the old strings.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri_specta::Event;

use crate::project::session::SessionSnapshot;
use crate::window::WindowStateSnapshot;

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct ProjectTerminalVisibilityEvent {
    pub snapshot: crate::project::terminal::visibility::TerminalVisibilitySnapshot,
}

/// An unapproved native App quit must reach the same creation confirmation.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct TerminalQuitRequestedEvent {
    pub identity: String,
    pub session_id: String,
    pub token: u32,
}

/// Session state publication — every snapshot the state machine emits
/// (formerly `pnds:session`); statuses per runtime-contract §8/§9.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct SessionSnapshotEvent {
    pub snapshot: SessionSnapshot,
}

/// Complete, normalized FFT bins for the main creation shell.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct CreationAudioAnalyzerEvent {
    pub generation: String,
    pub sample_rate: u32,
    pub fft_size: u32,
    pub magnitudes: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct CreationAudioPreviewDisconnected {
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct RecordingSnapshotEvent {
    pub snapshot: crate::recording::RecordingSnapshot,
}

/// Authoritative Client participation, including retained cleanup ownership.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct ClientSnapshotEvent {
    pub snapshot: crate::participation_client::ClientSnapshot,
}

/// AppKit input needed by host chrome while a native Client page owns focus.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct ClientViewInputEvent {
    pub command: Option<bool>,
    pub edge: Option<ClientPointerEdge>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ClientPointerEdge {
    Left,
    Right,
}

/// Physical trackpad movement in the main shell's top-left coordinates.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct SidebarTrackpadEvent {
    pub phase: SidebarTrackpadPhase,
    pub x: f64,
    pub y: f64,
    pub delta_x: f64,
    pub delta_y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SidebarTrackpadPhase {
    Began,
    Changed,
    Ended,
    Cancelled,
}

/// Only this App shell's native document may publish this narrow bridge.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMediaViewEvent {
    pub label: String,
    pub navigation: String,
    pub kind: String,
    pub data: serde_json::Value,
}

/// The currently retained performance page and its controller mapping state.
#[derive(Debug, Clone, Serialize, Type, Event)]
pub struct ControllerMappingEvent {
    pub snapshot: crate::controller_mapping::ControllerMappingSnapshot,
}

/// Window chrome state publication (formerly `pnds:window`).
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct WindowStateEvent {
    pub snapshot: WindowStateSnapshot,
}

/// The window regained macOS focus (formerly `pnds:window-focus`).
/// Payload-less by design: every consumer re-derives from the stores
/// (AppShell restores the session snapshot, MonitorView reclaims the
/// keyboard focus). lib.rs re-fires it on a delay schedule because an
/// emit into a still-suspended webview is dropped outright.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct WindowFocusEvent {}

/// Saved model configuration or credential changed; consumers revoke pending
/// tool work and refresh public state without receiving any credential data.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct ModelConfigurationChangedEvent {}

/// Cumulative answer text for exactly one model turn. No credential, provider
/// reasoning or tool arguments cross this progress channel.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTextEvent {
    pub request_id: String,
    pub turn_id: String,
    pub text: String,
}

/// A queued `.pnds` bundle finished installing (formerly
/// `pnds:open-bundle`) — the frontend opens the installed project.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OpenBundleEvent {}

/// Setlist folder export progress (formerly
/// `pnds:setlist-export-progress`), emitted once per packed project.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct SetlistExportProgressEvent {
    // u32 (not usize) so the generated TS type is number, not BigInt —
    // specta's default export config forbids BigInt.
    pub done: u32,
    pub total: u32,
    pub file_name: String,
}

/// The help window finished booting and is listening for navigation
/// (formerly `pnds:help-ready`). Emitted by the help webview itself;
/// registered here so both windows share one generated name.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct HelpReadyEvent {}

/// v1.5.0 (#130): the projection window came or went — observed at the
/// run-event level (every close path: the ⌘W dispatch, the red traffic
/// light, app quit), so the main window can render the ▶ gate button
/// only while a venue screen actually exists.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct ProjectionWindowEvent {
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct PerformerDestroyedEvent {
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct PerformerVisibilityEvent {
    pub label: String,
    pub visible: bool,
}

/// The App's event set as a fresh builder for any runtime. The real app
/// composes it with commands (bindings.rs); tests mount it on
/// mock-runtime apps so `Event::emit` resolves its registry entry.
pub fn events_builder<R: tauri::Runtime>() -> tauri_specta::Builder<R> {
    tauri_specta::Builder::<R>::new().events(tauri_specta::collect_events![
        ProjectTerminalVisibilityEvent,
        TerminalQuitRequestedEvent,
        SessionSnapshotEvent,
        CreationAudioAnalyzerEvent,
        CreationAudioPreviewDisconnected,
        RecordingSnapshotEvent,
        ClientSnapshotEvent,
        ClientViewInputEvent,
        SidebarTrackpadEvent,
        ProjectMediaViewEvent,
        ControllerMappingEvent,
        WindowStateEvent,
        WindowFocusEvent,
        ModelConfigurationChangedEvent,
        AssistantTextEvent,
        OpenBundleEvent,
        SetlistExportProgressEvent,
        HelpReadyEvent,
        ProjectionWindowEvent,
        PerformerDestroyedEvent,
        PerformerVisibilityEvent,
    ])
}
