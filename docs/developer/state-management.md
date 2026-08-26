# State Management

Two-layer "onion" architecture for state management.

## The Two Layers

```
┌─────────────────────────────────────┐
│           useState                  │  ← Component UI State
│  ┌─────────────────────────────────┐│
│  │          Zustand                ││  ← Global UI State
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

There is no query/cache layer: every fetch is an on-mount effect (or a flow function) calling a typed command directly. If a future feature genuinely needs query caching and automatic refetching, introduce a query layer then, sized to that feature.

### Layer 1: Zustand (Global UI State)

Use for transient global state:

- Panel and dialog visibility (settings panel, close/quit confirms)
- Project selection, folders, and rename state
- Mirrors of Rust-owned state (session status, window fullscreen)
- UI modes and navigation

Persisted state (preferences, project index) does not need a query layer:
`src/lib/preferences.ts` owns the preference file (load + serialized
update queue), and `project-store`'s structural actions persist as part of
their commit (see [Persisting Store State](#persisting-store-state)).

The real stores (`src/store/`) use plain `create`, no middleware:

```typescript
import { create } from 'zustand'

interface KeyboardState {
  commandKeyPressed: boolean
  setCommandKeyPressed: (pressed: boolean) => void
}

export const useKeyboardStore = create<KeyboardState>()(set => ({
  commandKeyPressed: false,
  setCommandKeyPressed: pressed => set({ commandKeyPressed: pressed }),
}))
```

### Layer 2: useState (Component State)

Use for state that:

- Only affects UI presentation
- Is derived from props or global state
- Is tightly coupled to component lifecycle

```typescript
const [isDropdownOpen, setIsDropdownOpen] = useState(false)
const [windowWidth, setWindowWidth] = useState(window.innerWidth)
```

## Performance Patterns (Critical)

### The `getState()` Pattern

**Problem**: Subscribing to store data in callbacks causes render cascades.

**Solution**: Use `getState()` for callbacks and module-level flow functions that need current state. Real example from `src/store/window-store.ts` — the one close flow shared by the ⌘W menu item and the red traffic light reads the session status without subscribing to it:

```typescript
export async function requestClose(): Promise<void> {
  const { sessionStatus } = useSessionStore.getState()
  if (shouldConfirmClose(sessionStatus)) {
    useWindowStore.getState().setConfirmCloseOpen(true)
    return
  }
  await closeWindowWithFade()
}
```

The same pattern drives menu actions in `src/lib/menu.ts` (e.g. `useSettingsStore.getState().toggleSettings()`), event listeners in `AppShell.tsx`, and dialog handlers.

**When to use `getState()`:**

- In `useCallback` dependencies when you need current state but don't want re-renders
- In event handlers for accessing latest state without subscriptions
- In `useEffect` with empty deps when you need current state on mount only
- In async operations when state might change during execution

### Navigation-Time Snapshots: The Accessor Pattern

**Problem**: Sometimes a value derived during render must be _frozen_ per
some navigation event (the monitor iframe URL's `?theme=` first-frame
parameter, #49) — a later change to the source value must not rewrite it
(retargeting the live iframe's `src` would reload the monitor page). That
means a `useMemo` whose dep list deliberately omits the reactive binding
and reads the store inside instead. But referencing
`useSettingsStore.getState()` during render trips the react-compiler
rule: any `use*`-named binding used as a value looks like a hook passed
around as a regular value.

**Solution**: export a plain accessor from the module owning the state
(the theme lives in `src/store/settings-store.ts`, the resolved language
in `src/i18n/config.ts`, #54):

```typescript
export function currentColorThemeSetting(): ColorTheme {
  return useSettingsStore.getState().colorThemeSetting
}
```

Then the memo's callback contains no reactive bindings, so exhaustive-deps
stays honest while the dep list expresses exactly when the snapshot
refreshes (`src/components/shell/MonitorView.tsx`):

```tsx
const iframeSrc = useMemo(() => {
  void reloadNonce // cache key only: each bump remounts the iframe
  return buildMonitorUrl(lanIp, monitorPort, {
    theme: currentColorThemeSetting(),
    lang: currentResolvedLanguage(),
  })
}, [lanIp, monitorPort, reloadNonce])
```

This is also the one sanctioned exception to "no manual `useMemo`" above:
the compiler memoizes for performance, but a _semantic_ freeze — a value
pinned until an explicit event re-snapshots it — needs the explicit dep
list. Don't reach for this shape for plain derived values; subscribe with
a selector instead.

### Store Subscription Optimization

```typescript
// ❌ BAD: Object destructuring subscribes to entire store
const { sessionStatus } = useSessionStore()

// ✅ GOOD: Selector only re-renders when this specific value changes
const sessionStatus = useSessionStore(state => state.sessionStatus)

// ✅ GOOD: Derived selector for minimal re-renders
const running = useSessionStore(state => state.sessionStatus === 'ready')
```

### CSS Visibility vs Conditional Rendering

For stateful UI that toggles visibility, keep the component mounted and hide it with CSS. Real example — `HoverSidebar` (`src/components/shell/HoverSidebar.tsx`) keeps the sidebar mounted so the slide/fade animates both ways:

```tsx
<div
  className={cn(
    'absolute bottom-3 left-3 top-3 z-50 transition-all duration-200 ease-out',
    sidebarVisible
      ? 'translate-x-0 opacity-100'
      : 'pointer-events-none -translate-x-5 opacity-0'
  )}
>
  <Sidebar variant="overlay" />
</div>
```

The component-side pattern (keep mounted, animate with CSS) is documented in [ui-patterns.md](./ui-patterns.md#visibility-with-css).

### React Compiler (Automatic Memoization)

This app uses React Compiler which automatically handles memoization. You do **not** need to manually add:

- `useMemo` for computed values
- `useCallback` for function references
- `React.memo` for components

**Note:** The `getState()` pattern is still critical - it avoids store subscriptions, not memoization.

## Store Boundaries

The real stores in `src/store/` and what belongs in each:

- **`project-store`** — project history, folders, selection, preflight state, rename target; structural actions persist the project index themselves
- **`session-store`** — mirror of the Rust SessionManager (status, volume, zoom) plus derived helpers (`shouldConfirmClose`, `isSessionBusy`)
- **`settings-store`** — in-app settings panel (open/section) and the General/Appearance/Audio selections
- **`window-store`** — mirror of Rust window state (fullscreen, traffic-light visibility) and the close/quit confirm dialogs
- **`keyboard-store`** — raw keyboard modifier state (⌘ held)

Shared domain state goes in the matching store; anything component-local stays in `useState`.

## Persisting Store State

`src/lib/preferences.ts` is the only preferences writer: every field save
goes through `updatePreferences(patch)` (or `updateOscTarget` for the
per-project map), each a load-modify-write cycle inside one serialized
queue so overlapping updates never clobber each other.

In `project-store.ts`, persistence is part of the commit — **structural
actions save the project index themselves** (`addRecentProject`,
`removeRecentProject`, folder lifecycle, membership moves, drag reorder
commits, `setProjectFolders`, `setProjectDisplayName`,
`preflightSucceeded`/`upsertManifestProjectNames` for the name maps,
`replaceProjectIndex` for wholesale rebuilds). Callers never pair a
mutation with a save; a missed save is no longer possible. No-op guards
(protected folders, ignored drag sets) and repeat commits write nothing.

Launch restore must never write back: it goes through the non-persisting
bulk setters (`restoreProjectIndex`, `setProjectDisplayNames`,
`setManifestProjectNames`) instead of the structural actions.

Wholesale rebuilds (the v1.4.0 setlist import seam, v1.3.2 issue #76) go
through `replaceProjectIndex`: one call rebuilds history, folders and
display-name overrides and persists a single snapshot. The batch
deliberately bypasses the per-directory caps — a replace is a load
(over-limit directories land as-is, exactly like legacy data), so an
import is all-or-nothing; further additions are capped again afterwards.
App content (this launch's utility tools, the Utilities folder) rides
through the replace. The set.json keying decision — manifest
`id` + `version`, never absolute paths — is recorded in the action's doc
comment and binds the v1.4.0 exchange format.

## Adding a New Store

1. Create store file in `src/store/`, following the plain `create` pattern
   of the existing stores (`project-store.ts`, `session-store.ts`,
   `settings-store.ts`, `window-store.ts`, `keyboard-store.ts`)
2. Add a pattern entry for the new store to
   `.ast-grep/rules/zustand/no-destructure.yml` — see
   [writing-ast-grep-rules.md](./writing-ast-grep-rules.md) for the rule's
   current patterns and structure
