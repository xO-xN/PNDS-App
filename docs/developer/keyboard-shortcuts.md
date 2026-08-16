# Keyboard Shortcuts

Keyboard input reaches the app through two layers: native menu accelerators
(built in `src/lib/menu.ts`) and a web-level Cmd keyboard layer
(`src/hooks/use-command-keyboard.ts`, mounted once by `AppShell`).

## Current Shortcuts

| Shortcut      | Action                                                 | Layer                             |
| ------------- | ------------------------------------------------------ | --------------------------------- |
| Cmd+W         | Close-confirm flow (v1.1.1)                            | Menu (`menu.ts`)                  |
| Cmd+Q         | Quit-confirm flow with a live session (v1.1.2 T7)      | Menu (`menu.ts`)                  |
| Cmd+= / Cmd+- | Monitor zoom in/out (v1.1.1)                           | Menu (`menu.ts`)                  |
| Cmd+0         | Monitor zoom: actual size (v1.1.1)                     | Menu (`menu.ts`)                  |
| Cmd+Shift+R   | Reload monitor (v1.1.1)                                | Menu (`menu.ts`)                  |
| Cmd+R         | Rename selected project / folder (v1.1.2)              | Menu + Web (shared `startRename`) |
| Ctrl+Cmd+F    | Toggle fullscreen (§7.4)                               | Menu (`menu.ts`)                  |
| Cmd (hold)    | Number badges + sidebar peek while running             | Web (`use-command-keyboard.ts`)   |
| Cmd+1..9      | Select the Nth visible project (v1.1.2)                | Web (`use-command-keyboard.ts`)   |
| Cmd+↓ / Cmd+↑ | Next/previous project in the visible order (v1.1.2 T7) | Web (`use-command-keyboard.ts`)   |
| Enter         | Load (idle) / Change-restart (pending)                 | Web (`SessionActionButton.tsx`)   |
| Esc           | Close-project confirmation (v1.1.2 T7)                 | Web (`SessionActionButton.tsx`)   |
| Cmd+Esc       | Close the running project directly (v1.1.2 T7)         | Web (`SessionActionButton.tsx`)   |

## Web Cmd Layer (v1.1.2)

`useCommandKeyboard` is registered once in `AppShell`, so it is active in
every window state — the shortcuts must not depend on sidebar visibility.
It owns three behaviors (spec issue #4):

- **Cmd held** → `commandKeyPressed` in `useKeyboardStore` drives the number
  badges on project cards and the running-state hover-sidebar peek. Window
  blur resets it so a Cmd+Tab away can't leave the app stuck in peek mode.
- **Cmd+1..9** → selects the Nth visible project through `selectProject`
  (`src/lib/project-select.ts`) — the same unified entry the card click
  uses, so semantics can never drift between mouse and keyboard.
- **Cmd+↓/Cmd+↑** → moves the selection one project along the visible
  order through `moveProjectSelection` (`src/lib/project-select.ts`), with
  the same click-equal semantics as Cmd+1..9 (idle selects, a running
  session goes through the §8.3 switch confirmation). The ends clamp —
  never wrap — and when the current project sits inside a folder while the
  user is at the top level, the move drills into that folder first and
  continues inside it ("下一首曲子" mental model, v1.1.2 T7).
- **Cmd+R** → starts the inline rename through `startRename`
  (`src/lib/project-rename.ts`): the selected project's card (or the
  drilled-in folder's breadcrumb name when nothing is selected). The Edit
  menu's "Rename Project" item fires the same function behind the same
  accelerator — the native accelerator consumes the key before the webview,
  so both paths apply the same text-input/open-overlay guards. Forbidden
  while a session runs; silent no-op with nothing selected (and never
  offered for the protected Utilities folder).
- **Cmd+0** is deliberately NOT consumed here; it stays the native
  "Actual Size" menu accelerator.

## Enter Session Action / Esc Close (v1.1.2)

Enter is a keyboard alias for the sidebar's session-action footer, handled
where its state lives (`SessionActionButton.tsx`) so key and click share
one set of conditions:

- **idle/error + loadable** → `start()` (same gate as the Load button)
- **running + pending config change** → `restart()` (the amber Change)
- **running, no pending change** → Enter deliberately NOT mapped; **⌘Esc**
  is the red Close's direct alias (v1.1.2 T7, spec issue #11) — the exact
  `stopAndReset()` the button runs. A **lone Esc** only opens the
  close-project confirmation (`confirmCloseProjectOpen` in the project
  store, rendered in the Sidebar like the switch confirm), so a stray
  press can never stop a live show.

Guards: text inputs own their keys (`isEditableTarget`), and while a
Radix dialog or select popup is open (`hasOpenOverlay`) Enter/Esc belong
to the overlay — the global layer never fires underneath a confirm flow.

## Cmd+Q Quit Flow (v1.1.2 T7)

The predefined macOS Quit item cannot be intercepted, so `menu.ts`
replaces it with a custom `quit-app` MenuItem that calls `requestQuit()`
(`src/store/window-store.ts`): with a live session (starting/ready — the
same `shouldConfirmClose` gate as ⌘W) the app-styled `QuitConfirmDialog`
opens; its confirm stops the session and then exits. Without a live
session the app exits immediately — `markQuitting()` first so the exit
never waits for a fade (§7.4), then the `quitApp` Rust command, whose
`ExitRequested` handler performs the session teardown.

```typescript
// src/hooks/use-command-keyboard.ts (shape)
const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Meta') {
    useKeyboardStore.getState().setCommandKeyPressed(true)
    return
  }
  if (!event.metaKey || event.repeat) return
  if (!/^[1-9]$/.test(event.key)) return
  if (isEditableTarget(event.target)) return // don't fight text inputs
  event.preventDefault()
  const { trustedPaths, projectFolders } = useProjectStore.getState()
  const path = ungroupedProjectPaths(trustedPaths, projectFolders)[
    Number(event.key) - 1
  ]
  if (path) selectProject(path, 'keyboard')
}
```

**Critical**: Use `getState()` to access store data in event handlers to
avoid render cascades. See [State Management](./state-management.md#the-getstate-pattern).

## Adding New Shortcuts

### 1. Web-level (state-dependent, not a menu item)

Add the key handling to `useCommandKeyboard` (or a sibling hook registered
in `AppShell`) and route the action through stores/lib functions — never
component state, so the shortcut works regardless of what is mounted.

### 2. Native menu (appears in the menu bar)

```typescript
// src/lib/menu.ts
await MenuItem.new({
  id: 'my-action',
  text: t('menu.myAction'),
  accelerator: 'Cmd+Shift+M',
  action: () => myStore.getState().myAction(),
})
```

See [Menus](./menus.md) for full menu integration details.

## Modifier Keys

```typescript
// macOS-only Cmd layer (this is a macOS Apple Silicon app)
if (event.metaKey) {
}

// With Shift
if (event.metaKey && event.shiftKey) {
}
```

**Always call `event.preventDefault()`** on consumed keys to prevent
browser defaults.

## Why Native DOM Events

Native DOM event listeners are used instead of libraries like
`react-hotkeys-hook` because they provide more reliable execution in the
Tauri environment.

## Troubleshooting

| Issue                             | Check                                          |
| --------------------------------- | ---------------------------------------------- |
| Shortcuts not firing              | Hook registered in `AppShell` / menu action    |
| Browser intercepts shortcut       | Add `event.preventDefault()`                   |
| Shortcut fires while typing       | Guard with an editable-target check            |
| Sidebar hidden but shortcut works | By design — the layer is shell-level (spec #4) |
