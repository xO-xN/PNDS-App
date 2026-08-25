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
    ├── children.rs     # Child process registry + orphan cleanup
    ├── ports.rs        # Port occupancy / release (lsof + SIGTERM→SIGKILL)
    ├── audio.rs        # CoreAudio capabilities + scsynth bridge
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
