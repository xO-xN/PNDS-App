# Rust Architecture

Module organization and patterns for the Tauri backend.

## Module Structure

```
src-tauri/src/
├── main.rs             # Entry point (just calls lib::run())
├── lib.rs              # App setup, plugin registration, run-event handlers
├── bindings.rs         # tauri-specta command registration + export test
├── open_panel.rs       # Native NSOpenPanel (project directory OR .pnds picker)
├── process_activity.rs # App-Nap prevention while a session is live
├── types.rs            # Shared types (AppPreferences, ProjectFolder) + preference validation
├── window.rs           # Fullscreen action + window fade state machine
├── commands/           # Command handlers by domain
│   ├── mod.rs          # Re-exports all command modules
│   ├── preferences.rs  # load/save preferences (in-memory cache)
│   ├── notifications.rs
│   ├── project.rs      # Preflight / session / ports / audio-device commands
│   ├── bundle.rs       # .pnds pack / install / reclaim / open-queue commands
│   ├── synthdef.rs     # SynthDef compile command
│   ├── tools.rs        # Built-in utility tools behind the Utilities folder
│   └── system.rs       # Reveal app data / log dirs in Finder
└── project/            # Project domain logic (fully path-based, testable)
    ├── mod.rs
    ├── manifest.rs     # manifest.json schema + path containment
    ├── preflight.rs    # Dependency + port availability checks
    ├── bundle.rs       # .pnds zip pack/install/reclaim service
    ├── session.rs      # SessionManager (Rust source of truth)
    ├── children.rs     # SupervisedChild lifecycle + registry + orphan cleanup
    ├── ports.rs        # Port occupancy / release (lsof + SIGTERM→SIGKILL)
    ├── audio.rs        # CoreAudio capabilities + scsynth bridge
    ├── sidecars.rs     # Bundled node/scsynth lookup by build target triple (build.rs forwards cargo TARGET)
    ├── logs.rs         # Per-session logs
    └── synthdef.rs     # sclang compile service
```

`commands/` holds the `#[tauri::command]` handlers (thin: they parse args and delegate to `project/` or `window.rs`); `project/` holds the domain logic with unit tests. `lib.rs` registers the handler from `bindings.rs` and owns the run-event loop (close/hide, dock reopen, `.pnds` open requests, exit cleanup).

## Adding New Commands

The workflow: define the command in a `commands/` module with `#[tauri::command]` + `#[specta::specta]`, export the module from `commands/mod.rs`, register it in `bindings.rs`, then regenerate with `npm run rust:bindings`. The step-by-step recipe with code lives in [tauri-commands.md](./tauri-commands.md).

## Type Patterns

### Shared Types (types.rs)

Types shared between commands go in `types.rs`:

```rust
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MyData {
    pub field: String,
}
```

**Note:** `#[derive(Type)]` from specta is required for TypeScript generation.

### Error Types

Use `Result<T, String>` for simple errors; use a typed enum with `#[serde(tag = "type")]` when the frontend needs to branch on the error kind (it becomes a TypeScript discriminated union). The canonical enum example and the TypeScript matching pattern live in [error-handling.md](./error-handling.md).

### Validation Functions

Keep validation in `types.rs` for reuse:

```rust
pub fn validate_input(input: &str) -> Result<(), String> {
    if input.is_empty() {
        return Err("Input cannot be empty".to_string());
    }
    Ok(())
}
```

### Parameter Records (v1.3.2, issue #77)

When a concept's inputs cross several layers (command → manager → generation
body → pure helper), thread one record instead of positional parameters that
widen at every hop — see `StartRequest` in `project/session.rs`. The command
boundary constructs it once (its Tauri parameters stay the IPC contract);
fields that only become known during the work (e.g. the resolved channel
plan and OSC target of a start) live on the same record as `Option` fields
the inner layers fill in, so the deepest helpers (like env construction)
read everything from the record alone. New inputs become record fields
without widening any signature.

## Supervised Child Processes (children.rs)

Any child process the App owns and must clean up is a
`SupervisedChild` — spawn (with the §12 ownership record) → supervise
(`try_wait` polling) → bounded shutdown (`SIGTERM → grace → SIGKILL →
confirm`), with the registry discipline attached: a **confirmed** kill
clears the ownership record; an **unconfirmed** one keeps it (creating
it for a never-registered child) so the next start's targeted orphan
cleanup retries. Never re-assemble the escalation by hand at a call
site:

- Ownership record at spawn is the default (`SupervisedChild::spawn`).
  Use `spawn_deferred` + `register()` only when the record must wait
  for the child to prove healthy (scsynth boot: a concurrent
  preflight's orphan cleanup must not see a boot in flight).
- Foreign processes the App holds no `Child` handle of (port release,
  orphan cleanup) use `terminate_pid_escalate` — the same escalation
  policy, no registry.
- A run-to-completion compile with output capture (sclang in
  `synthdef.rs`) is a different lifecycle shape and deliberately stays
  on plain `Command` — don't force it into `SupervisedChild`.

## Session State Machine (session.rs)

Every production `SessionStatus` write goes through one private
`SessionManager::transition` — never write `guard.status` directly.
It owns, under one critical section: generation validation →
transition legality → the caller's mutation + status write → snapshot
publication through `publish_snapshot` (which also carries the AppNap
discipline). Illegal or stale moves are logged and rejected with no
state or emission side effects.

Legality is not a plain (from, to) table — it splits by generation
discipline: **opening moves** (`any → Starting`, `any → Stopping`,
`any → Idle`) are legal only when they carry `generation == current + 1`
and install that generation; **steady moves** (`Starting → Ready`,
`Starting/Ready → Error`, `Stopping → Idle`) require the current
generation. That encoding is what lets "start-from-Ready" and
"Ready→Starting on the same generation" resolve differently.

Tests observe emissions without any sink abstraction: mount the real
event set on `tauri::test::mock_app()` and record with
`SessionSnapshotEvent::listen_any` (delivery is synchronous and
in-process) — see the `app_with_snapshot_recorder` test helper.

## Platform-Specific Code

This app targets macOS only. AppKit integration lives where it is used — `window.rs` (window fade, corner mask) and `open_panel.rs` (NSOpenPanel) drive AppKit directly through `objc2`/`objc2-app-kit` — and `lib.rs` guards it with `#[cfg(target_os = "macos")]`. Prefer that pattern (feature code in its module, cfg at the edges) over a catch-all platform-utils module.

## Plugin Registration (lib.rs)

Plugins are registered in `lib.rs` during app setup:

```rust
// Desktop-only plugins
#[cfg(desktop)]
{
    app_builder = app_builder.plugin(tauri_plugin_window_state::Builder::new().build());
}

// All platforms
app_builder = app_builder
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
```

**Order matters:** Single-instance plugin must be registered first.

## Conventions

| Pattern           | Example                                                       |
| ----------------- | ------------------------------------------------------------- |
| Command naming    | `snake_case` (`load_preferences`, not `loadPreferences`)      |
| Error returns     | `Result<T, String>` for simple errors, typed enum for complex |
| Logging           | Use `log::info!`, `log::debug!`, etc.                         |
| String formatting | `format!("{variable}")` not `format!("{}", variable)`         |
| App handle        | Pass `AppHandle` not `Window` when possible                   |

## Expanding This Architecture

When adding new features:

1. **New command domain?** Create new file in `commands/`
2. **New shared types?** Add to `types.rs`
3. **New AppKit/window behavior?** Add to `window.rs` (or `open_panel.rs` for panels)
4. **New plugin?** Register in `lib.rs` setup
