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

/// Session state publication — every snapshot the state machine emits
/// (formerly `pnds:session`); statuses per runtime-contract §8/§9.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct SessionSnapshotEvent {
    pub snapshot: SessionSnapshot,
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

/// The App's event set as a fresh builder for any runtime. The real app
/// composes it with commands (bindings.rs); tests mount it on
/// mock-runtime apps so `Event::emit` resolves its registry entry.
pub fn events_builder<R: tauri::Runtime>() -> tauri_specta::Builder<R> {
    tauri_specta::Builder::<R>::new().events(tauri_specta::collect_events![
        SessionSnapshotEvent,
        WindowStateEvent,
        WindowFocusEvent,
        OpenBundleEvent,
        SetlistExportProgressEvent,
        HelpReadyEvent,
    ])
}
