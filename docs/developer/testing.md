# Testing

Testing patterns for Rust and TypeScript, with focus on Tauri-specific mocking.

## Running Tests

```bash
npm run check:all      # All tests and checks
npm run test           # TypeScript tests (watch mode)
npm run test:run       # TypeScript tests (single run)
npm run rust:test      # Rust tests
```

## TypeScript Testing

Uses **Vitest** + **@testing-library/react**. Configuration in `vitest.config.ts` (jsdom environment, tests colocated under `src/`).

### Test File Location

Place tests next to the code they test:

```
src/components/ui/Button.tsx
src/components/ui/Button.test.tsx
```

### What src/test/setup.ts Provides

`vitest.config.ts` loads `src/test/setup.ts` for every test file. It contains two kinds of setup.

**jsdom polyfills and globals** — jsdom lacks the layout and pointer APIs the UI stack assumes:

- Pointer-capture stubs (`hasPointerCapture` / `setPointerCapture` / `releasePointerCapture`) that Radix Select relies on
- `scrollIntoView` and `scrollTo` no-ops (no scroll layout in jsdom)
- A `window.matchMedia` mock
- A test `__APP_VERSION__` global
- An `afterEach` that resets `document.body.style.pointerEvents`, which Radix modal layers set while open and an abrupt cleanup can leave behind

**Global Tauri mocks** — so no test performs real IPC:

- `@tauri-apps/api/event` (`listen` resolves a no-op unlisten) and `@tauri-apps/api/webviewWindow` (`onDragDropEvent`)
- `@tauri-apps/plugin-updater`, `plugin-dialog` (cancelled by default), `plugin-clipboard-manager`, and `plugin-log`
- One global `vi.mock('@/lib/tauri-bindings')` stubbing every typed command with a default resolved value, plus `unwrapResult`:

```typescript
// src/test/setup.ts (excerpt)
vi.mock('@/lib/tauri-bindings', () => ({
  commands: {
    loadPreferences: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: { theme: 'system' } }),
    savePreferences: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    sendNativeNotification: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: null }),
    preflightProject: vi.fn().mockResolvedValue({
      status: 'error',
      error: 'preflightProject not mocked',
    }),
    getSessionState: vi.fn().mockResolvedValue({
      status: 'ok',
      data: {
        /* idle session snapshot */
      },
    }),
    stopProject: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    // ...one default per command
  },
  unwrapResult: vi.fn((result: { status: string; data?: unknown }) => {
    if (result.status === 'ok') return result.data
    throw result
  }),
}))
```

Note `preflightProject`: commands whose default would silently satisfy an assertion are mocked to an explicit error, so a test that forgot to set up its data fails loudly.

### Overriding Command Mocks Per Test

Test files do not re-mock the module — they override the global stub where needed. Import `commands`, type it with `vi.mocked`, and set the value the test means (see `src/components/shell/AppShell.test.tsx` and `src/lib/preferences.test.ts`):

```typescript
import { vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'

beforeEach(() => {
  vi.clearAllMocks() // clears call history; keeps the setup.ts implementations
})

test('restores projects from saved preferences', async () => {
  vi.mocked(commands.loadPreferences).mockResolvedValueOnce({
    status: 'ok',
    data: {
      theme: 'system',
      language: null,
      outputDevice: null,
      oscTargets: {},
      recentProjects: ['/Users/test/Inarticulate III'],
    },
  })

  render(<AppShell />)
  await screen.findByTestId('project-entry')
})
```

For load-modify-write flows, `src/lib/preferences.test.ts` swaps both preferences commands for a tiny in-memory disk via `mockImplementation`, so the save queue's cycles are observable through what survives on "disk".

### Test Wrapper for Providers

`render` from `@/test/test-utils` wraps components in the i18n provider and a mock theme provider, and exposes geometry helpers like `mockBoundingClientRect` and `mockOffsets`. There is no query-client wrapper — the app has no query-cache layer; tests mock `@/lib/tauri-bindings` as described above.

Usage:

```typescript
import { render } from '@/test/test-utils'

test('component renders', () => {
  render(<MyComponent />)
})
```

### Testing Zustand Stores

The stores in `src/store/` (project, session, settings, window, keyboard, updater) are plain Zustand stores — tests seed state with `setState`, call actions through `getState()`, and assert on `getState()` (see `src/store/settings-store.test.ts`):

```typescript
import { useSettingsStore } from '@/store/settings-store'

beforeEach(() => {
  useSettingsStore.setState({ settingsOpen: false, focusSection: null })
})

test('openSettings records the section to reveal', () => {
  useSettingsStore.getState().openSettings('about')

  expect(useSettingsStore.getState().settingsOpen).toBe(true)
  expect(useSettingsStore.getState().focusSection).toBe('about')
})
```

### Testing Pointer-Drag Geometry (e.g. Sidebar Reorder)

jsdom has no layout and no hit-testing, so pointer dragging cannot be simulated end-to-end. Since v1.3.2 (issue #75) the work splits across three modules — test each at its own seam:

- All drop/yield decisions — midpoint halves, insertion index, per-card yield offsets, static hit-testing — are pure functions in `src/lib/drag-reorder.ts`, unit-tested with plain numbers.
- The gesture machine (press slack activation, clone transform, edge auto-scroll, scroll re-anchoring, post-commit transition suppression) is `src/hooks/use-card-drag.ts`. It consumes only injected geometry: its tests (`src/hooks/use-card-drag.test.tsx`) pass a numeric `CardDragAdapter` and a scroll container whose `scrollTop`/`scrollHeight` are pinned via `Object.defineProperty` — no `getBoundingClientRect` pinning, no rect math in the machine.
- The host (Sidebar) measures the DOM through `src/components/shell/sidebar-drag-adapter.ts` and commits through store actions. Its end-to-end drag tests still pin the rects the adapter derives geometry from via `mockBoundingClientRect` (`src/test/test-utils.tsx`) and fire pointer events with explicit coordinates. The drag "feel" remains a manual acceptance step.

### Testing Imperative Indicator Pills

The pill engine (`src/hooks/use-indicator-pill.ts`, v1.3.2 issue #78) is scheduling-only: its tests inject spy configs, fire `resize` on `window`, and drive a stubbed `document.fonts.ready`. The shared geometry writes read `offsetLeft`/`offsetTop`/`offsetWidth`/`offsetHeight`, which the test DOM leaves at 0 — pin them with `mockOffsets` (`src/test/test-utils.tsx`), which covers both axis pairs. End-to-end pill behavior (slide, snap, hide) stays covered by the Sidebar tests asserting the `card-selection-pill` testid (the folder dropdown has replaced segmented folder pills).

### Testing Development Watch Isolation

`src/lib/dev-watch.test.mjs` loads the repository's Vite watch configuration and
replays the captured `docs/prototypes/pnds-ui-prototype.html` edit in a temporary
fixture. It uses Vite's actual watcher and HTML HMR path in middleware mode,
with HTTP/WebSocket listeners disabled and dependency discovery disabled. It
asserts that documentation is not watched and produces no extra full-reload
notification. Edits to all three real app entries provide positive controls;
disabling all hot updates cannot satisfy the test. The fixture contains no real
project, Node score server or audio process.

## Rust Testing

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_preferences_default() {
        let prefs = AppPreferences::default();
        assert_eq!(prefs.theme, "system");
    }
}
```

### Async Tests

```rust
#[tokio::test]
async fn test_async_operation() {
    let result = some_async_fn().await;
    assert!(result.is_ok());
}
```

### File Operation Tests

Use `tempfile` for tests that need file system access:

```rust
use tempfile::TempDir;

#[test]
fn test_file_operations() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.json");

    // Test write
    std::fs::write(&file_path, "{}").unwrap();

    // Test read
    let content = std::fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "{}");
}
```

## Adding New Command Mocks

When adding new Tauri commands, add a default to the global stub in `src/test/setup.ts`:

```typescript
// src/test/setup.ts — inside the existing vi.mock('@/lib/tauri-bindings')
commands: {
  // ... existing mocks
  myNewCommand: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
}
```

## Best Practices

| Do                                             | Don't                         |
| ---------------------------------------------- | ----------------------------- |
| Add command defaults to `src/test/setup.ts`    | Call real Tauri APIs in tests |
| Use `vi.mocked()` for type-safe mock overrides | Use untyped mock assertions   |
| Test user-visible behavior                     | Test implementation details   |
| Use `tempfile` for Rust file tests             | Write to real file system     |

## v1.6 cross-ticket acceptance

The approved seams remain user-driven creation/performance workflows, typed
commands, real temporary project files and controlled processes.
`CreationModules.test.tsx` exercises the actual workspace entry, cancellation,
version parameters, unsaved handoff protection, partial retry, read-only sources
and late replies. Rust `project::creation::modules_tests` validates the five
embedded file groups, source records, no-clobber and protected paths, external
versions, permission-induced partial failure, retry and a real bundle round trip.
`creation-module-assets.test.mjs` exercises frozen module exports and parses every
shipped JS file under Node; it does not certify physical phones or sound.

Real macOS and Apple Silicon/Intel release evidence belongs in
[#164 acceptance](../acceptance/164-v1.6.0-workflows.md). A sandbox listener EPERM
or compiler startup failure stays a failed check until an ordinary-terminal run
passes; tests are not skipped or weakened to turn it green.

## Native performance selection (#202)

`PerformanceSelection.test.tsx` builds the real menu and invokes its callback
through the Tauri menu boundary mock, then observes the actual AppShell/card and
preflight workflow. It covers active-folder order and both boundaries, monitor
identity/address and running-project preservation, editable focus, reveal
release, independent windows, slow/late preflights, confirmation ownership,
delayed native focus replies, creation scope and focus failures. Load and Close
use their real UI submit paths with controlled typed-command replies to verify
`commandPending` blocks selection before any backend lifecycle snapshot changes.
Menu-state tests verify mode/project-close and starting/stopping disablement.

On macOS, `npm run native:selection:verify` builds an isolated opt-in Tauri
fixture from cached Cargo dependencies (`--offline`). A warm cache can be cloned
into a distinct writable target and supplied with
`npm run native:selection:verify -- --target-dir /private/tmp/pnds-native-target`.
The target must belong exclusively to this fixture run; never point it at an
App checkout's active target. The fixture briefly activates its own windows,
uses disposable WebView data and an ephemeral loopback guest page, then exits.
It starts no App dev server, audio/session process or score server and writes no
user projects. The default fresh target can take longer to compile.

The runner extracts the production WK hook verbatim, asserts its exact bytes,
and saves the full source, hook and generated-module SHA-256 values alongside
`native-results.json`, `native-route.log` and `cargo-build.log` in a temporary
`pnds-native-selection-*` directory. Its frontend imports the actual menu,
selection and preflight modules; only project/native command result data are
fixtures. Own AppKit `NSEvent` instances reach `NSApplication.sendEvent`, with
active/key/event-window assertions, plus a direct `NSMenu.performKeyEquivalent`
positive control. This is native Tauri/Wry/Muda routing evidence, without
synthesizing OS input. A fixture-only observer forwards the original WK method
unchanged and counts fallback calls without duplicating production dispatch.

`CreationModeButton.test.tsx` drives the real confirmation control and holds the
ownership command reply. It verifies revocation before creation publication,
restoration after performance publication, the settling lock during the reply,
rejected overlap, cancellation, and failure reporting in both directions.

The 44-case matrix covers both arrows with host body, editable and cross-origin
guest focus, ordinary and Function/NumericPad modifier flags, exactly one native
menu action per matching chord, both boundaries, independent business gates
under stale enabled items, and secondary-window ownership. Creation exclusion
uses real `enter()`/`leave()` transitions, with the verbatim production ownership
command registered in the fixture. Both arrows across all three focus surfaces
must reach original WK exactly once with no menu action in creation. Late stale
epoch grants cannot steal creation keys; late revocations cannot disable a real
return to performance. Missing/disabled items and disabled submenu parents,
Shift/Control/plain-Command variants and Option horizontal arrows must reach the
original WK route. Failed active/key ownership is reported separately;
a delivery mismatch is never retried. Both completion assertions and clean native
process exit are required. This check remains opt-in because it requires a
foreground macOS AppKit session; it is not a Cargo worker or jsdom test.

The jsdom workflows described above exercise user workflows and typed commands;
they do not prove macOS accelerator delivery. Physical keystrokes in the complete
App, fullscreen, actual score-monitor identity/layout and runtime preservation
remain user-run native acceptance; use the checklist in
[keyboard-shortcuts.md](./keyboard-shortcuts.md#native-performance-selection-202).
