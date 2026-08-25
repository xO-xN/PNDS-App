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

The stores in `src/store/` (project, session, settings, window, keyboard) are plain Zustand stores — tests seed state with `setState`, call actions through `getState()`, and assert on `getState()` (see `src/store/settings-store.test.ts`):

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

jsdom has no layout and no hit-testing, so pointer dragging cannot be simulated end-to-end. Split the work at that seam (see the sidebar's `src/lib/drag-reorder.ts`):

- All drop/yield decisions — midpoint halves, insertion index, per-card yield offsets, static hit-testing — are pure functions, unit-tested with plain numbers.
- The component only measures rects and mutates the floating clone imperatively on `pointermove`; its tests pin the rects it derives geometry from via `mockBoundingClientRect` (`src/test/test-utils.tsx`) and fire pointer events with explicit coordinates. The drag "feel" remains a manual acceptance step.

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
