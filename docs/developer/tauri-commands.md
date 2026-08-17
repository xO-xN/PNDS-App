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

| Pattern          | Use When                                                        |
| ---------------- | --------------------------------------------------------------- |
| `unwrapResult`   | TanStack Query functions, errors should propagate to a boundary |
| Manual `if/else` | Event handlers, need explicit error handling (toasts, UI state) |

**TanStack Query example** (preferred pattern for data fetching):

```typescript
import { useQuery } from '@tanstack/react-query'
import { commands, unwrapResult } from '@/lib/tauri-bindings'

const { data, error } = useQuery({
  queryKey: ['preferences'],
  queryFn: async () => unwrapResult(await commands.loadPreferences()),
})
// TanStack Query handles the thrown error automatically
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
// src-tauri/src/lib.rs

#[tauri::command]
#[specta::specta]  // Add this attribute
pub async fn my_new_command(arg: String) -> Result<MyType, String> {
    // implementation
}
```

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
    Builder::<tauri::Wry>::new().commands(collect_commands![
        // ... existing commands
        crate::my_new_command,  // Add here
    ])
}
```

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

### 6. Commit both files

Always commit:

- Rust changes (`src-tauri/src/lib.rs`, `src-tauri/src/bindings.rs`)
- Generated TypeScript (`src/lib/bindings.ts`)

## File Structure

```
src-tauri/src/
├── lib.rs              # Commands with #[specta::specta]
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

| Command                    | Parameters                            | Returns                                 | Description                                                                        |
| -------------------------- | ------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| `loadPreferences`          | none                                  | `Result<AppPreferences, string>`        | Load preferences                                                                   |
| `savePreferences`          | `preferences: AppPreferences`         | `Result<null, string>`                  | Save preferences                                                                   |
| `sendNativeNotification`   | `title: string, body: string \| null` | `Result<null, string>`                  | System notification                                                                |
| `preflightProject`         | `path: string`                        | `Result<Manifest, string>`              | Project preflight (§5/§7/§8.2)                                                     |
| `cleanupOrphanedProcesses` | none                                  | `Result<number, string>`                | Kill stale session children (§8.2)                                                 |
| `startProject`             | `path, mode, lanIp: string`           | `Result<null, string>`                  | Start score server session (§8.1)                                                  |
| `stopProject`              | none                                  | `Result<null, string>`                  | Graceful session stop (§8.2)                                                       |
| `getSessionState`          | none                                  | `Result<SessionSnapshot, string>`       | Current session snapshot                                                           |
| `listLanAddresses`         | none                                  | `Result<string[], string>`              | LAN IPv4 candidates (§7)                                                           |
| `listOutputDevices`        | none                                  | `Result<OutputDevices, string>`         | CoreAudio devices + sample rate                                                    |
| `setMasterVolume`          | `percent: number`                     | `Result<null, string>`                  | Master gain (§6.4)                                                                 |
| `getWindowState`           | none                                  | `Result<WindowStateSnapshot, string>`   | Fullscreen/fade mirror (§7.4)                                                      |
| `toggleFullscreen`         | none                                  | `Result<WindowStateSnapshot, string>`   | The one fullscreen action (§7.4)                                                   |
| `closeWindowWithFade`      | none                                  | `Result<null, string>`                  | Fade out then hide (§7.4)                                                          |
| `fadeInWindow`             | none                                  | `Result<null, string>`                  | First show / dock reopen fade (§7.4)                                               |
| `markQuitting`             | none                                  | `Result<null, string>`                  | Cancel in-flight fades (⌘Q, §7.4)                                                  |
| `quitApp`                  | none                                  | `Result<null, string>`                  | Process exit behind ⌘Q (v1.1.2 T7)                                                 |
| `syncBuiltinTools`         | none                                  | `Result<BuiltinTool[], string>`         | Install/sync built-in utility tools for the Utilities folder (v1.2.0 #18)          |
| `openAppDataDir`           | none                                  | `Result<null, string>`                  | Reveal app data dir in Finder (settings About, v1.2.0)                             |
| `openAppLogDir`            | none                                  | `Result<null, string>`                  | Reveal app log dir in Finder (settings About, v1.2.0)                              |
| `checkPortStatus`          | `port: number`                        | `Result<PortStatus, string>`            | Occupancy of one TCP port (settings Ports, v1.2.0)                                 |
| `releasePort`              | `port: number`                        | `Result<PortStatus, string>`            | SIGTERM→grace→SIGKILL release; returns post-release status (v1.2.0)                |
| `getBundleOutputInfo`      | `path: string`                        | `Result<BundleOutputInfo, string>`      | Pack probe: output path + exists flag + packability errors (#16)                   |
| `packProjectBundle`        | `path: string, overwrite: boolean`    | `Result<PackResult, string>`            | Pack project into sibling `.pnds` + sha256 (#16)                                   |
| `installBundle`            | `path: string`                        | `Result<string, string>`                | Install `.pnds` into `bundles/<id>-<version>/` (#16)                               |
| `reclaimProjectBundle`     | `path: string`                        | `Result<boolean, string>`               | Delete managed bundle install on history removal (#16)                             |
| `takePendingBundleOpens`   | none                                  | `Result<string[], string>`              | Atomically drain macOS-requested `.pnds` opens (#16)                               |
| `pickProjectOrBundle`      | `title: string`                       | `Result<string \| null, string>`        | NSOpenPanel: project directory OR `.pnds` file (⌘O, #16)                           |
| `compileProjectSynthdefs`  | `path: string`                        | `Result<SynthdefCompileResult, string>` | Compile `supercollider/source/*.scd` via local sclang + verify manifest refs (#17) |

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
