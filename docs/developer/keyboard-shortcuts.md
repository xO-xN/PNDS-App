# Keyboard Shortcuts

Keyboard input reaches the app through two layers: native menu accelerators
(built in `src/lib/menu.ts`) and a web-level Cmd keyboard layer
(`src/hooks/use-command-keyboard.ts`, mounted once by `AppShell`).

## Current Shortcuts

| Shortcut      | Action                                     | Layer                             |
| ------------- | ------------------------------------------ | --------------------------------- |
| Cmd+W         | Close-confirm flow (v1.1.1)                | Menu (`menu.ts`)                  |
| Cmd+= / Cmd+- | Monitor zoom in/out (v1.1.1)               | Menu (`menu.ts`)                  |
| Cmd+0         | Monitor zoom: actual size (v1.1.1)         | Menu (`menu.ts`)                  |
| Cmd+Shift+R   | Reload monitor (v1.1.1)                    | Menu (`menu.ts`)                  |
| Cmd+R         | Rename selected project / folder (v1.1.2)  | Menu + Web (shared `startRename`) |
| Ctrl+Cmd+F    | Toggle fullscreen (§7.4)                   | Menu (`menu.ts`)                  |
| Cmd (hold)    | Number badges + sidebar peek while running | Web (`use-command-keyboard.ts`)   |
| Cmd+1..9      | Select the Nth visible project (v1.1.2)    | Web (`use-command-keyboard.ts`)   |
| Enter         | Load (idle) / Change-restart (pending)     | Web (`SessionActionButton.tsx`)   |

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
- **Cmd+R** → starts the inline rename through `startRename`
  (`src/lib/project-rename.ts`): the selected project's card (or the
  drilled-in folder's breadcrumb name when nothing is selected). The Edit
  menu's "Rename Project" item fires the same function behind the same
  accelerator — the native accelerator consumes the key before the webview,
  so both paths apply the same text-input/open-overlay guards. Forbidden
  while a session runs; silent no-op with nothing selected.
- **Cmd+0** is deliberately NOT consumed here; it stays the native
  "Actual Size" menu accelerator.

## Enter Session Action (v1.1.2)

Enter is a keyboard alias for the sidebar's session-action footer, handled
where its state lives (`SessionActionButton.tsx`) so key and click share
one set of conditions:

- **idle/error + loadable** → `start()` (same gate as the Load button)
- **running + pending config change** → `restart()` (the amber Change)
- **running, no pending change** → deliberately NOT mapped — the red Close
  stays mouse-only so a stray Enter can never stop a live show

Guards: text inputs own their Enter (`isEditableTarget`), and while a
Radix dialog or select popup is open (`hasOpenOverlay`) Enter belongs to
the overlay — the global layer never fires underneath a confirm flow.

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
