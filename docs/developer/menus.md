# Native Menu System

Native macOS menu bar built with JavaScript for i18n support, integrating with keyboard shortcuts and React state.

## Overview

This app builds menus from **JavaScript** using Tauri's JS Menu API (`@tauri-apps/api/menu`). This enables:

- Runtime translation via react-i18next
- Dynamic menu rebuilding when language changes
- Direct integration with React state (Zustand)

## Current Menu Structure

```
PNDS
├── About PNDS                (opens the settings panel's About section)
├── Settings…                 (Cmd+, — toggles the settings panel)
├── ────────────────────
├── Check for Updates...
├── ────────────────────
├── Hide PNDS                (Cmd+H)
├── Hide Others              (Cmd+Alt+H)
├── Show All
├── ────────────────────
└── Quit PNDS                (Cmd+Q — custom; confirms with a live session first)

File
├── Add Project…             (Cmd+O — opens the project folder picker)
└── Close Window             (Cmd+W — custom; confirms before closing a running project)

Edit
├── Undo / Redo
├── ────────────────────
├── Cut / Copy / Paste / Select All   (standard text-editing)
├── ────────────────────
└── Rename Project           (Cmd+R — custom; inline rename)

View
├── Zoom In                  (Cmd+=)
├── Zoom Out                 (Cmd+-)
├── Actual Size              (Cmd+0)
├── ────────────────────
├── Mute / Unmute            (Cmd+M)
└── Reload Monitor           (Cmd+Shift+R)

Window
├── Performer — http://<lanIp>:<performerPort>/   (copies the URL; disabled with no project/LAN)
├── Conductor — http://<lanIp>:<monitorPort>/     (same)
├── ────────────────────
└── Enter Full Screen        (Ctrl+Cmd+F)

Help                        (v1.3.0, #56 — macOS's last submenu)
├── Search Help             (Cmd+Shift+Slash — the physical chord behind ⌘?)
├── ────────────────────
├── User Tutorial           (opens the help center on the tutorial)
├── Creator Guide           (…on the creator guide)
└── Reference Manual        (…on the reference manual's index page)
```

The ⌘M item's accelerator exists to claim the key from macOS's native hide action, like ⌘Q. Mute is a pure audio mutation — no UI opens — so it carries no text-input/overlay guards and works under any dialog. Its action is `toggleMasterMute()` from `@/lib/volume-control`, a no-op unless the volume can act.

The Window menu's address segment (v1.3.0, issue #52) is permanent: the two items join the **selected project's manifest ports** (`performerPort` / `monitorPort`) with the **session store's current LAN choice** (`lanIp` — the settings-card dropdown's authoritative value, the same one a start passes to Rust). The URL itself comes from `buildMonitorUrl` (`src/lib/monitor-url.ts`) with no first-frame params, so the copied text is by construction the same origin the monitor iframe navigates to. Clicking copies via the clipboard plugin and toasts the copied URL; with no project (or no LAN yet) the items show bare, disabled role labels — never a made-up address. Rebuild triggers: language changes plus the two watched store slices (see below).

## Architecture

### Menu Builder (`src/lib/menu.ts`)

Menus are built using translated labels and direct action handlers that call store actions via Zustand's `getState()`:

```typescript
import {
  Menu,
  MenuItem,
  Submenu,
  PredefinedMenuItem,
} from '@tauri-apps/api/menu'
import i18n from '@/i18n/config'
import { useSettingsStore } from '@/store/settings-store'

export async function buildAppMenu(): Promise<Menu> {
  const t = i18n.t.bind(i18n)

  const appSubmenu = await Submenu.new({
    text: APP_NAME,
    items: [
      await MenuItem.new({
        id: 'about',
        text: t('menu.about', { appName: APP_NAME }),
        action: () => useSettingsStore.getState().openSettings('about'),
      }),
      await MenuItem.new({
        id: 'settings',
        text: t('menu.settings'),
        accelerator: 'Cmd+Comma',
        // Same overlay guard as the ⌘, keyboard entry: never stack the
        // panel on another modal (close/quit confirms).
        action: () => {
          if (hasOpenOverlayBesidesSettings()) return
          useSettingsStore.getState().toggleSettings()
        },
      }),
      // ... more items
    ],
  })

  const menu = await Menu.new({
    items: [appSubmenu, fileSubmenu, editSubmenu, viewSubmenu, windowSubmenu],
  })

  await menu.setAsAppMenu()
  return menu
}
```

### Language Change Handling

Menus are automatically rebuilt when the language changes. The listener returns an unsubscribe function for cleanup:

```typescript
export function setupMenuLanguageListener(): () => void {
  const handler = async () => {
    await buildAppMenu()
  }
  i18n.on('languageChanged', handler)
  return () => i18n.off('languageChanged', handler)
}
```

### Store-Driven Rebuilds (address segment)

Menu content that mirrors store state (the Window menu's Performer/Conductor addresses) rebuilds through `setupMenuStateListener()` — the same whole-menu rebuild, subscribed to the watched slices (`project-store`'s `currentProject`, `session-store`'s `lanIp`). These stores are plain Zustand creates (no `subscribeWithSelector`), so the subscription filters by hand inside the module: the rebuild fires only when a watched value actually changed, never on the session store's unrelated churn (volume drags, health snapshots).

`buildAppMenu()` and both listeners are called during app startup in `src/App.tsx`. Menu item actions read live values via `getState()`; the address items instead capture their URL at build time, so the label shown and the URL copied can never disagree.

## Menu Item Types

### Custom Menu Items

```typescript
await MenuItem.new({
  id: 'mute-toggle',
  text: t('menu.mute'),
  accelerator: 'Cmd+M',
  action: () => toggleMasterMute(),
})
```

### Predefined Items

Tauri provides common system menu items:

```typescript
await PredefinedMenuItem.new({ item: 'Separator' })
await PredefinedMenuItem.new({ item: 'Hide', text: t('menu.hide') })
await PredefinedMenuItem.new({ item: 'Quit', text: t('menu.quit') })
await PredefinedMenuItem.new({ item: 'Copy' })
await PredefinedMenuItem.new({ item: 'Paste' })
```

Note: the app's own ⌘Q item is NOT the predefined Quit — a predefined item cannot be intercepted, and the flow needs to confirm with a live session first. It is a custom `MenuItem` whose action calls `requestQuit()` (`src/store/window-store.ts`). The same reasoning applies to ⌘W (custom close flow) and ⌘M (claims the key from macOS's native hide).

### Submenus

```typescript
const viewSubmenu = await Submenu.new({
  text: t('menu.view'),
  items: [
    await MenuItem.new({
      id: 'zoom-in',
      text: t('menu.zoomIn'),
      accelerator: 'Cmd+=',
      action: () => useSessionStore.getState().zoomIn(),
    }),
  ],
})
```

## Adding New Menu Items

### Step 1: Add Translation Key

```json
// locales/en.json
{
  "menu.myNewAction": "My New Action"
}
```

### Step 2: Add to Menu Builder

```typescript
// src/lib/menu.ts
await MenuItem.new({
  id: 'my-new-action',
  text: t('menu.myNewAction'),
  accelerator: 'Cmd+N',
  action: handleMyNewAction,
})

function handleMyNewAction(): void {
  // Use getState() for current store values — menu handlers run outside React
  const settings = useSettingsStore.getState()
  settings.toggleSettings()
}
```

### Step 3: Add to Other Languages

Add the same key to every language file in `/locales/` (currently `en.json` and `zh-CN.json`).

## Action Handlers

Menu actions use Zustand's `getState()` pattern for accessing current state:

```typescript
function handleZoomIn(): void {
  useSessionStore.getState().zoomIn()
}
```

This ensures handlers always have access to current state values. Actions can also call plain module functions directly when no store state is needed (e.g. `toggleMasterMute()`, `promptOpenProject()`).

## Platform

This is a macOS-only app: the menu lives in the system menu bar, and accelerators use `Cmd+…` modifiers (e.g. `Cmd+Q`, `Ctrl+Cmd+F`). There is no Windows/Linux menu path.

## Troubleshooting

| Issue                     | Solution                                                    |
| ------------------------- | ----------------------------------------------------------- |
| Menu not appearing        | Ensure `buildAppMenu()` is called during app initialization |
| Translations not updating | Verify `setupMenuLanguageListener()` is called              |
| Action not working        | Check handler uses `getState()` for current values          |
| Accelerator conflicts     | Verify shortcut isn't used elsewhere in the app             |
