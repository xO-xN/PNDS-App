# Tauri Commands (tauri-specta)

Type-safe Tauri command bindings using [tauri-specta](https://github.com/specta-rs/tauri-specta).

## Overview

This app uses tauri-specta to generate TypeScript bindings from Rust commands, providing:

- **Compile-time type checking** - TypeScript catches errors before runtime
- **Auto-generated types** - No manual sync between Rust and TypeScript
- **IDE autocomplete** - Full IntelliSense for command names, parameters, and return types
- **Safe refactoring** - Rename commands safely across the stack

Mode handoff uses `getCreationRuntime`, `prepareCreationProject` and
`commitCreationProject`: preparation keeps the active file identity valid,
commit checks the runtime generation, and `closeCreationProjection` closes only
the fixed projection label. See [creation-workspace.md](./creation-workspace.md)
for confirmation, cancellation and registered cleanup.

`setMainPerformanceKeyOwner(epoch, owns)` is a narrow main-shell mode acknowledgment
for native selection keys. The real mode transaction revokes before creation
publication and restores after performance publication, remaining in settling
until the acknowledgment. Rust rejects non-main callers and older mode epochs;
the original WK route remains available whenever native ownership is revoked.
It does not mirror runtime/overlay business gates or alter selection/session state.

`setMainControlsVisible` targets only the main window’s AppKit controls. The
frontend serializes and coalesces visibility, horizontal offset, opacity and
vertical container-padding requests; it never recreates the window or changes a runtime
page. The finite container padding is clamped to 8–34px and retained with the horizontal offset for native resize
work; creation uses 18px with a -12px horizontal offset and performance uses
34px with its floating-sidebar offset. Actual button placement also
includes AppKit's internal button origin (9px in the recorded native check). Fullscreen preserves the system
controls. The ready session snapshot additionally exposes
`appliedSampleRate` from the actual Internal spawn, independent of later preferences.

## Usage

Creation commands (`openCreationProject`, `describeCreationProjects`,
`listCreationFiles`, `pollCreationChanges`, `readCreationFile`, `saveCreationFile`,
`renameCreationFile`, `getCreationGitStatus`, `readCreationGitDiff`,
`revealCreationPath`, `closeCreationProject`) use a
backend-issued identity after opening. Source
protection and error codes are described in
[creation-workspace.md](./creation-workspace.md); never substitute a raw frontend
root or an editable flag for the issued identity.
`saveCreationFile` is also the manifest form's single write path (#158): a save
of the project-root `manifest.json` is schema-validated first
(`CreationErrorCode::ManifestInvalid`, before the version check), while a
`manifest.json` in a subdirectory stays an ordinary text save.

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

### expectOk Helper

For cases where you want errors to propagate (throw) rather than handle them inline, use the `expectOk` helper. It throws a real `Error` carrying the backend's message — never a bare string (those lose the stack and defeat logger formatting):

```typescript
import { commands, expectOk } from '@/lib/tauri-bindings'

// Throws on error, returns data on success
const preferences = expectOk(await commands.loadPreferences())
```

**When to use each pattern:**

| Pattern          | Use When                                                       |
| ---------------- | -------------------------------------------------------------- |
| Manual `if/else` | The default — event handlers, on-mount fetches, flow modules   |
| `expectOk`       | Rare throwing boundaries where a catch suits the caller better |

Most call sites in this codebase deliberately keep the explicit
`result.status === 'error'` branch: each logs with its own context and
applies the right UX (toast, store fail-state, silent fallback). Reach
for `expectOk` only when a failure should propagate into an existing
catch boundary.

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

## Events (Rust → React)

The reverse channel is typed the same way as commands: every event is a
payload struct in `src-tauri/src/events.rs`, registered in
`events_builder` (`collect_events!`). tauri-specta derives the wire name
from the struct's name and regenerates the frontend's `events` object —
run `npm run rust:bindings` after touching the event set.

**Never call `listen`/`emit` with a hand-typed string.** Subscribe
through `src/lib/events.ts`, which adds the lifecycle convention
(`onX(cb)` returns a synchronous unsubscribe) and unwraps the generated
payload. The help-window protocol (`emitTo`-targeted: navigate / locale
/ theme) has no generated form — its names are held in `events.ts` too,
the single module that knows them.

```typescript
import { onSessionSnapshot } from '@/lib/events'

useEffect(() => onSessionSnapshot(snapshot => apply(snapshot)), [])
```

To add an event: define the payload struct in `events.rs`, add it to
`events_builder`'s `collect_events!`, emit via `Event::emit` on the Rust
side, regenerate bindings, then add an `onX` helper in `events.ts` if a
component needs it.

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

| Command                        | Parameters                                                     | Returns                                          | Description                                                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadPreferences`              | none                                                           | `Result<AppPreferences, string>`                 | Load preferences                                                                                                                                                                        |
| `savePreferences`              | `preferences: AppPreferences`                                  | `Result<null, string>`                           | Save preferences                                                                                                                                                                        |
| `sendNativeNotification`       | `title: string, body: string \| null`                          | `Result<null, string>`                           | System notification                                                                                                                                                                     |
| `dnsServiceStatus`             | none                                                           | `DnsServiceStatus` (bare, no `Result`)           | DNS daemon truth (#174): registration, control-plane liveness, listeners, bindError, upstreams, mapping                                                                                 |
| `dnsServiceEnable`             | `upstreams: string[] \| null, listenIp: string \| null`        | `Result<null, string>`                           | Register the LaunchDaemon (one-time approval), wait for the control plane, apply config (`null` upstreams → built-in defaults); a port-53 bind failure is a definite error (#174)       |
| `dnsServiceApplyConfig`        | `upstreams: string[] \| null, listenIp: string \| null`        | `Result<null, string>`                           | Push config to a RUNNING daemon (App launch re-pushes the defaults; `null` → built-in; #174)                                                                                            |
| `dnsServiceDisable`            | none                                                           | `Result<null, string>`                           | Unregister the LaunchDaemon — stop, free port 53, drop the authorization (#174)                                                                                                         |
| `dnsServiceOpenSystemSettings` | none                                                           | `Result<null, string>`                           | Open System Settings → Login Items (requiresApproval recovery path; #174)                                                                                                               |
| `preflightProject`             | `path: string`                                                 | `Result<Manifest, string>`                       | Project preflight (runtime-contract §8 step 2); never harms the live session                                                                                                            |
| `readProjectReadme`            | `path: string, locale: string \| null`                         | `Result<string \| null, string>`                 | v1.5.0 (#125): read the project README for the main-area panel — the `README.<locale>.md` variant when present, else the plain `README.md`; `null` = none, errors are readable failures |
| `readProjectCover`             | `path: string`                                                 | `Result<string \| null, string>`                 | v1.5.0 (README cover page): the project's optional cover image (`cover.png` → `cover.jpg` → `cover.jpeg` → `cover.webp`) as a base64 data URL; `null` = none                            |
| `cleanupOrphanedProcesses`     | none                                                           | `Result<number, string>`                         | Kill stale session children (runtime-contract §12); skips the live session's                                                                                                            |
| `startProject`                 | `path, mode, lanIp: string, oscTarget: string \| null`         | `Result<null, string>`                           | Start score server session (runtime-contract §8)                                                                                                                                        |
| `stopProject`                  | none                                                           | `Result<null, string>`                           | Graceful session stop (runtime-contract §12)                                                                                                                                            |
| `getSessionState`              | none                                                           | `Result<SessionSnapshot, string>`                | Current session snapshot                                                                                                                                                                |
| `listLanAddresses`             | none                                                           | `Result<string[], string>`                       | LAN IPv4 candidates (runtime-contract §4)                                                                                                                                               |
| `listOutputDevices`            | `sampleRate: number`                                           | `Result<AudioDeviceCapabilities, string>`        | CoreAudio devices + usable channel count at the given rate (runtime-contract §7.6)                                                                                                      |
| `listSupportedSampleRates`     | none                                                           | `number[]` (plain array, no `Result`)            | Sample rates offered in Settings Audio — standard rates supported across all output devices; falls back internally, never errors                                                        |
| `setMasterVolume`              | `percent: number`                                              | `Result<null, string>`                           | Master gain (runtime-contract §7.5)                                                                                                                                                     |
| `getWindowState`               | none                                                           | `Result<WindowStateSnapshot, string>`            | Fullscreen/fade mirror (app-behavior Window 与全屏)                                                                                                                                     |
| `toggleFullscreen`             | none                                                           | `Result<WindowStateSnapshot, string>`            | The one fullscreen action (app-behavior Window 与全屏)                                                                                                                                  |
| `setWindowCornersSquare`       | `square: boolean`                                              | `Result<null, string>`                           | Brutal's square window — drops the 16px native corner mask                                                                                                                              |
| `closeWindowWithFade`          | none                                                           | `Result<null, string>`                           | Fade out then hide (app-behavior Window 与全屏)                                                                                                                                         |
| `fadeInWindow`                 | `label: string \| null`                                        | `Result<null, string>`                           | Hidden-create reveal fade; null = main, 'help' = the help center (#56)                                                                                                                  |
| `focusedWindowLabel`           | none                                                           | `Result<string, string>`                         | Focused window's label — ⌘W dispatches on the front window (#56)                                                                                                                        |
| `markQuitting`                 | none                                                           | `Result<null, string>`                           | Cancel in-flight fades (⌘Q; app-behavior Window 与全屏)                                                                                                                                 |
| `quitApp`                      | none                                                           | `Result<null, string>`                           | Process exit behind ⌘Q                                                                                                                                                                  |
| `builtinUtilities`             | none                                                           | `Result<BuiltinUtility[], string>`               | Built-in utility tools behind the Utilities folder, run in place                                                                                                                        |
| `helpCorpus`                   | none                                                           | `Result<HelpCorpusDocument[], string>`           | Help center's corpus as raw markdown (#53; help-center.md)                                                                                                                              |
| `openAppDataDir`               | none                                                           | `Result<null, string>`                           | Reveal app data dir in Finder (settings About)                                                                                                                                          |
| `openAppLogDir`                | none                                                           | `Result<null, string>`                           | Reveal app log dir in Finder (settings About)                                                                                                                                           |
| `systemSafariVersion`          | none                                                           | `Result<string \| null, string>`                 | Installed Safari version for the WebKit baseline gate (#110); null = unreadable, frontend stays silent                                                                                  |
| `checkPortStatus`              | `port: number`                                                 | `Result<PortStatus, string>`                     | Occupancy of one TCP port (settings Ports)                                                                                                                                              |
| `releasePort`                  | `port: number, confirmed: PortOccupant`                        | `Result<PortReleaseResult, string>`              | Identity-confirmed external release; returns outcome and fresh status (#163)                                                                                                            |
| `getBundleOutputInfo`          | `path: string, outputPath: string \| null`                     | `Result<BundleOutputInfo, string>`               | Pack probe: output path + exists flag + packability errors                                                                                                                              |
| `packProjectBundle`            | `path: string, overwrite: boolean, outputPath: string \| null` | `Result<PackResult, string>`                     | Pack saved project to chosen `.pnds` (`null`: sibling) + sha256                                                                                                                         |
| `installBundle`                | `path: string`                                                 | `Result<string, string>`                         | Install `.pnds` into `bundles/<id>-<version>/`                                                                                                                                          |
| `reclaimProjectBundle`         | `path: string`                                                 | `Result<boolean, string>`                        | Delete managed bundle install on history removal                                                                                                                                        |
| `takePendingBundleOpens`       | none                                                           | `Result<string[], string>`                       | Atomically drain macOS-requested `.pnds` opens                                                                                                                                          |
| `pickProjectOrBundle`          | `title: string`                                                | `Result<string \| null, string>`                 | NSOpenPanel: project directory OR `.pnds` file (⌘O)                                                                                                                                     |
| `getCreationModules`           | `identity: string`                                             | `Result<CreationModuleCatalog, CreationError>`   | Frozen offline catalog with actual target/provenance state and handoff version (#210)                                                                                                   |
| `addCreationModule`            | `identity, moduleId, expectedRecord, expectedHandoff`          | `Result<CreationModuleAddResult, CreationError>` | Exclusively publish embedded files, then idempotently append a pending wiring task; partial writes are reported (#210)                                                                  |
| `compileCreationSynthdefs`     | `identity: string`                                             | `Result<SynthdefCompileReport, CreationError>`   | Compile trusted editable standard sources via local sclang; report every manifest reference                                                                                             |

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

## Creation testing (#156)

`getCreationManifest(identity)` exposes saved declarations through bounded
creation reading. `preflightCreationProject(identity)` uses the complete existing
candidate preflight, rechecking identity after I/O. `startCreationProject(identity,
mode, lanIp, oscTarget)` rechecks it again at dispatch and delegates to the same
session engine, returning `CreationRuntime` (generation + authoritative snapshot).
The frontend uses the common session-flow consent/submit/stop/start machinery;
none of these commands saves drafts or rewrites manifest defaults. Validation
and startup failures use `testValidation` / `testStartup`, while scope failures
retain their existing codes. See [creation-workspace.md](./creation-workspace.md).

## Performer windows (#157)

`closeCreationPerformerWindows(labels: string[] | null)` destroys only UUID
performer labels; null closes every performer shell. All supplied labels are
validated before any destruction, and unrelated windows are rejected. Native
`PerformerDestroyedEvent` retires the exact client after any close path. The
frontend lifecycle protocol carries only workspace/run/navigation, viewport and
theme/locale configuration plus page-load results; no music messages. The local
shell has its own restricted capability and independent browser data store.

Performer protocol names and typed on/emit helpers live in `src/lib/events.ts`.
These subscriptions expose registration promises because native creation and
shell-ready replay must wait until the listener exists. All runtime fact and
error returns additionally check their workspace/run/navigation ownership.

`preparePerformerWindow(label, ok, cancel)` is a UUID-scoped, awaited macOS
setup for the performer's standard WebKit dialogs and optional synthetic input
script. Shell-ready follows its completion. Per-instance delegate inheritance
retains wry's other handlers; no remote page receives a new IPC capability.

## Identity-confirmed Ports release (#163)

`getProjectPorts(path)` reads saved declarations without runtime preflight,
including a selected card whose preflight failed.
`checkPortStatus` reports actual managed ownership and the running project only
for its applied ports. `releasePort` requires the identity shown in the
confirmation; the backend protects actual child handles before both signals.
See [Ports inspection and release](./ports.md) for cancellation, lifecycle
locking and controlled-process tests.

## Static diagnostics (#203)

`diagnoseCreationProject(identity)` reads the saved trusted workspace and returns
the common `DiagnosticReport` used by the CLI.
`creationDiagnosticIsStale(identity, inputFingerprint)` compares the observed
inputs without saving or changing runtime state. Neither command takes a session
lease or invokes runtime preflight. Both recheck workspace ownership after I/O.
See [static-diagnostics.md](./static-diagnostics.md).

## Parameter binding and temporary preview (#231)

`getCreationParameterContract(identity)` reads the optional versioned project
declaration through bounded trusted text access. `bindCreationParameters` checks
identity, one existing path, source version, candidate text and parameter requests
without writes or execution. `authorizeCreationPreview` additionally requires the
same ready native runtime, revalidates saved source/declaration and returns actual
source digests separately from disk fingerprints. Monitor messages never acquire
Tauri access. See [parameter-preview.md](./parameter-preview.md).

## Handoff review, baselines and comparison (#171 / #226 / #227)

`previewCreationHandoff` issues the native task/version review;
`confirmCreationHandoff` records its immutable saved origin and guarded task.
Both confirmation and comparison take a native `beginHandoffOperation` token;
`handoffOperationProgress` and `cancelHandoffOperation` bypass the access lock
to report real byte progress and cooperatively stop resource reads.
`listHandoffBaselines`, `retryHandoffBaseline` and `deleteHandoffBaseline` manage
only the current actual project's App-data records. `compareHandoffBaseline`
returns actual text/resource differences; `handoffComparisonIsStale` checks
current disk versions without a model or Git call. All use the current native
creation identity and access lock. See [handoff-baselines.md](./handoff-baselines.md)
for schema, limits, exclusions, partial outcomes and retry rules.

## Local Git (#228–#230)

`previewCreationGitRecord` issues a one-use saved-scope token;
`confirmCreationGitRecord` consumes it with complete selected paths, local
identity and message. A successful commit always returns its real ID, including
partial index/config warnings. `getCreationGitHistory`,
`readCreationGitHistoryFile` and `loadCreationGitHistoryText` are read-only native
operations; the last returns historical text and the checked current disk base
for the draft store. All commands use issued identities on the blocking worker.
See [local Git](./local-git.md) for boundaries and bounded resources.
