# Tauri Commands (tauri-specta)

Type-safe Tauri command bindings using [tauri-specta](https://github.com/specta-rs/tauri-specta).

## Overview

This app uses tauri-specta to generate TypeScript bindings from Rust commands, providing:

- **Compile-time type checking** - TypeScript catches errors before runtime
- **Auto-generated types** - No manual sync between Rust and TypeScript
- **IDE autocomplete** - Full IntelliSense for command names, parameters, and return types
- **Safe refactoring** - Rename commands safely across the stack

## Usage

### Calling Commands

```typescript
import { commands, type AppPreferences } from '@/lib/tauri-bindings'

// Commands return Result types for error handling
const result = await commands.loadPreferences()

if (result.status === 'ok') {
  console.log(result.data.theme) // Type-safe access
} else {
  console.error(result.error) // Type-safe error
}
```

### Result Type Pattern

Commands that can fail return a `Result<T, E>` type:

```typescript
type Result<T, E> = { status: 'ok'; data: T } | { status: 'error'; error: E }
```

See [error-handling.md](./error-handling.md) for comprehensive error handling patterns including structured error types, retry logic, and user feedback.

Handle both cases:

```typescript
const result = await commands.savePreferences({ theme: 'dark' })

if (result.status === 'error') {
  toast.error('Failed to save', { description: result.error })
  return
}

// result.data is available here
toast.success('Saved!')
```

### unwrapResult Helper

For cases where you want errors to propagate (throw) rather than handle them inline, use the `unwrapResult` helper:

```typescript
import { commands, unwrapResult } from '@/lib/tauri-bindings'

// Throws on error, returns data on success
const preferences = unwrapResult(await commands.loadPreferences())
```

**When to use each pattern:**

| Pattern          | Use When                                                       |
| ---------------- | -------------------------------------------------------------- |
| Manual `if/else` | The default — event handlers, on-mount fetches, flow modules   |
| `unwrapResult`   | Rare throwing boundaries where a catch suits the caller better |

**On-mount fetch example** (the standard data-fetching pattern):

```typescript
import { commands } from '@/lib/tauri-bindings'

useEffect(() => {
  let stale = false
  commands.loadPreferences().then(result => {
    if (stale) return
    if (result.status === 'error') {
      setError(result.error)
      return
    }
    setPreferences(result.data)
  })
  return () => {
    stale = true
  }
}, [])
```

**Event handler example** (explicit error handling):

```typescript
const handleSave = async () => {
  const result = await commands.savePreferences(preferences)
  if (result.status === 'error') {
    toast.error('Failed to save', { description: result.error })
    return
  }
  toast.success('Preferences saved!')
}
```

## Adding New Commands

### 1. Define the Rust command

```rust
// src-tauri/src/commands/my_feature.rs

#[tauri::command]
#[specta::specta]  // Add this attribute
pub async fn my_new_command(arg: String) -> Result<MyType, String> {
    // implementation
}
```

(Domain logic goes in `src-tauri/src/project/` — the command module stays a thin handler. See [rust-architecture.md](./rust-architecture.md).)

### 2. Add Type derive to structs

```rust
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MyType {
    pub field: String,
}
```

### 3. Register in bindings.rs

```rust
// src-tauri/src/bindings.rs

pub fn generate_bindings() -> Builder<tauri::Wry> {
    use crate::commands::{my_feature, /* ... */};

    Builder::<tauri::Wry>::new().commands(collect_commands![
        // ... existing commands
        my_feature::my_new_command,  // Add here
    ])
}
```

Also export the module from `src-tauri/src/commands/mod.rs` (`pub mod my_feature;`).

### 4. Regenerate TypeScript bindings

```bash
npm run rust:bindings
```

This runs `cargo test export_bindings -- --ignored` which generates `src/lib/bindings.ts`.

### 5. Use in frontend

```typescript
import { commands, type MyType } from '@/lib/tauri-bindings'

const result = await commands.myNewCommand('arg')
```

### 6. Keep Rust and generated TypeScript together

The Rust change and the regenerated `src/lib/bindings.ts` land in the same
change (commands live in `src-tauri/src/commands/`, registration in
`src-tauri/src/bindings.rs`), so the two never drift apart.

## File Structure

```
src-tauri/src/
├── lib.rs              # App setup; registers the handler from bindings.rs
├── commands/           # #[tauri::command] handlers by domain (project, tools, bundle, ...)
├── bindings.rs         # Command registration + export test
└── Cargo.toml          # specta, tauri-specta dependencies

src/lib/
├── bindings.ts         # Generated (DO NOT EDIT)
└── tauri-bindings.ts   # Re-exports with project conventions
```

## Testing

Mock the commands in tests:

```typescript
// src/test/setup.ts
vi.mock('@/lib/tauri-bindings', () => ({
  commands: {
    loadPreferences: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: { theme: 'system' } }),
    savePreferences: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    // ... other commands
  },
}))
```

## Available Commands

| Command                    | Parameters                                             | Returns                                   | Description                                                                                                                      |
| -------------------------- | ------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `loadPreferences`          | none                                                   | `Result<AppPreferences, string>`          | Load preferences                                                                                                                 |
| `savePreferences`          | `preferences: AppPreferences`                          | `Result<null, string>`                    | Save preferences                                                                                                                 |
| `sendNativeNotification`   | `title: string, body: string \| null`                  | `Result<null, string>`                    | System notification                                                                                                              |
| `preflightProject`         | `path: string`                                         | `Result<Manifest, string>`                | Project preflight (runtime-contract §8 step 2); never harms the live session                                                     |
| `cleanupOrphanedProcesses` | none                                                   | `Result<number, string>`                  | Kill stale session children (runtime-contract §12); skips the live session's                                                     |
| `startProject`             | `path, mode, lanIp: string, oscTarget: string \| null` | `Result<null, string>`                    | Start score server session (runtime-contract §8)                                                                                 |
| `stopProject`              | none                                                   | `Result<null, string>`                    | Graceful session stop (runtime-contract §12)                                                                                     |
| `getSessionState`          | none                                                   | `Result<SessionSnapshot, string>`         | Current session snapshot                                                                                                         |
| `listLanAddresses`         | none                                                   | `Result<string[], string>`                | LAN IPv4 candidates (runtime-contract §4)                                                                                        |
| `listOutputDevices`        | `sampleRate: number`                                   | `Result<AudioDeviceCapabilities, string>` | CoreAudio devices + usable channel count at the given rate (runtime-contract §7.6)                                               |
| `listSupportedSampleRates` | none                                                   | `number[]` (plain array, no `Result`)     | Sample rates offered in Settings Audio — standard rates supported across all output devices; falls back internally, never errors |
| `setMasterVolume`          | `percent: number`                                      | `Result<null, string>`                    | Master gain (runtime-contract §7.5)                                                                                              |
| `getWindowState`           | none                                                   | `Result<WindowStateSnapshot, string>`     | Fullscreen/fade mirror (app-behavior Window 与全屏)                                                                              |
| `toggleFullscreen`         | none                                                   | `Result<WindowStateSnapshot, string>`     | The one fullscreen action (app-behavior Window 与全屏)                                                                           |
| `setWindowCornersSquare`   | `square: boolean`                                      | `Result<null, string>`                    | Brutal's square window — drops the 16px native corner mask                                                                       |
| `closeWindowWithFade`      | none                                                   | `Result<null, string>`                    | Fade out then hide (app-behavior Window 与全屏)                                                                                  |
| `fadeInWindow`             | `label: string \| null`                                | `Result<null, string>`                    | Hidden-create reveal fade; null = main, 'help' = the help center (#56)                                                           |
| `focusedWindowLabel`       | none                                                   | `Result<string, string>`                  | Focused window's label — ⌘W dispatches on the front window (#56)                                                                 |
| `markQuitting`             | none                                                   | `Result<null, string>`                    | Cancel in-flight fades (⌘Q; app-behavior Window 与全屏)                                                                          |
| `quitApp`                  | none                                                   | `Result<null, string>`                    | Process exit behind ⌘Q                                                                                                           |
| `builtinUtilities`         | none                                                   | `Result<BuiltinUtility[], string>`        | Built-in utility tools behind the Utilities folder, run in place                                                                 |
| `helpCorpus`               | none                                                   | `Result<HelpCorpusDocument[], string>`    | Help center's corpus as raw markdown (#53; help-center.md)                                                                       |
| `openAppDataDir`           | none                                                   | `Result<null, string>`                    | Reveal app data dir in Finder (settings About)                                                                                   |
| `openAppLogDir`            | none                                                   | `Result<null, string>`                    | Reveal app log dir in Finder (settings About)                                                                                    |
| `checkPortStatus`          | `port: number`                                         | `Result<PortStatus, string>`              | Occupancy of one TCP port (settings Ports)                                                                                       |
| `releasePort`              | `port: number`                                         | `Result<PortStatus, string>`              | SIGTERM→grace→SIGKILL release; returns post-release status                                                                       |
| `getBundleOutputInfo`      | `path: string`                                         | `Result<BundleOutputInfo, string>`        | Pack probe: output path + exists flag + packability errors                                                                       |
| `packProjectBundle`        | `path: string, overwrite: boolean`                     | `Result<PackResult, string>`              | Pack project into sibling `.pnds` + sha256                                                                                       |
| `installBundle`            | `path: string`                                         | `Result<string, string>`                  | Install `.pnds` into `bundles/<id>-<version>/`                                                                                   |
| `reclaimProjectBundle`     | `path: string`                                         | `Result<boolean, string>`                 | Delete managed bundle install on history removal                                                                                 |
| `takePendingBundleOpens`   | none                                                   | `Result<string[], string>`                | Atomically drain macOS-requested `.pnds` opens                                                                                   |
| `pickProjectOrBundle`      | `title: string`                                        | `Result<string \| null, string>`          | NSOpenPanel: project directory OR `.pnds` file (⌘O)                                                                              |
| `compileProjectSynthdefs`  | `path: string`                                         | `Result<SynthdefCompileResult, string>`   | Compile `supercollider/source/*.scd` via local sclang + verify manifest refs                                                     |

## Dependencies

```toml
# src-tauri/Cargo.toml
specta = { version = "=2.0.0-rc.22", features = ["derive", "serde_json"] }
tauri-specta = { version = "=2.0.0-rc.21", features = ["typescript"] }
specta-typescript = "=0.0.9"
```

Note: Using exact versions (`=`) during RC phase to prevent breaking changes.

## References

- [tauri-specta GitHub](https://github.com/specta-rs/tauri-specta)
- [Specta documentation](https://specta.dev/docs/tauri-specta/v2)
