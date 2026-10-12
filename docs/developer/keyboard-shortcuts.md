# Keyboard Shortcuts

Keyboard input reaches the app through two layers: native menu accelerators
(built in `src/lib/menu.ts`) and a web-level Cmd keyboard layer
(`src/hooks/use-command-keyboard.ts`, mounted once by `AppShell`).

## Current Shortcuts

| Shortcut      | Action                                                                                                                                                                                                                                                                                     | Layer                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Cmd+W         | Close-confirm flow (v1.1.1); #56: dispatches on the FOCUSED window (closes the help center when it is front)                                                                                                                                                                               | Menu (`menu.ts`)                                           |
| Cmd+Shift+/   | Open the help center on search (= ⌘?, same physical chord; v1.3.0 #56)                                                                                                                                                                                                                     | Menu (`menu.ts`)                                           |
| Cmd+Q         | Quit-confirm flow with a live session (v1.1.2 T7)                                                                                                                                                                                                                                          | Menu (`menu.ts`)                                           |
| Cmd+O         | Import a project                                                                                                                                                                                                                                                                           | Menu (`menu.ts`)                                           |
| Cmd+,         | Toggle the in-app settings panel (v1.2.0 #13; the web copy covers the pre-menu moment)                                                                                                                                                                                                     | Menu (`menu.ts`) + Web                                     |
| Cmd+= / Cmd+- | Monitor zoom in/out — the FOCUSED window's own value (v1.5.0 #131; the projection's zoom covers its 简介 too and is remembered via preferences). #135 exception: a projection copy whose page declared §14 `zoom:"page"` makes these a no-op for that window — the keys belong to the page | Menu (`menu.ts`)                                           |
| Cmd+0         | Monitor zoom: actual size — focused window; the reset is remembered on the projection side (v1.5.0 #131; same #135 no-op exception as Cmd+=/-)                                                                                                                                             | Menu (`menu.ts`)                                           |
| Cmd+Shift+R   | Reload BOTH windows' monitors — main + projection (v1.5.0 #131 dual reload)                                                                                                                                                                                                                | Menu (`menu.ts`)                                           |
| Cmd+M         | Master mute toggle (v1.2.2 #30)                                                                                                                                                                                                                                                            | Menu (`menu.ts`)                                           |
| Cmd+R         | Rename selected project / folder (v1.1.2)                                                                                                                                                                                                                                                  | Menu + Web (shared `startRename`)                          |
| Cmd+S         | Save the active creation draft (#154; creation mode only — a version conflict opens the reload-or-overwrite choice instead of writing)                                                                                                                                                     | Web (`use-command-keyboard.ts`)                            |
| Ctrl+Cmd+F    | Toggle fullscreen of the FOCUSED window (v1.5.0 #131; sidebar button stays main-only)                                                                                                                                                                                                      | Menu (`menu.ts`)                                           |
| Cmd+Return    | Projection start gate 开演/撤回 (v1.5.0 #130; enabled with a venue screen + ready session)                                                                                                                                                                                                 | Menu (`menu.ts`)                                           |
| Cmd (hold)    | Number badges + sidebar peek while running                                                                                                                                                                                                                                                 | Web (`use-command-keyboard.ts`)                            |
| Cmd+1..9      | Select the Nth visible project (v1.1.2)                                                                                                                                                                                                                                                    | Web (`use-command-keyboard.ts`)                            |
| ↑ / ↓         | Select previous/next project while operating the performance sidebar; editable controls and popups retain their keys                                                                                                                                                                       | Sidebar capture                                            |
| Enter         | Load (idle) / Change-restart (pending); focused mode button confirms its switch (#151)                                                                                                                                                                                                     | Web (`SessionActionButton.tsx` / `CreationModeButton.tsx`) |
| Esc           | Cancel pending mode confirmation in the main shell (#151); monitor pages keep their own Esc behavior                                                                                                                                                                                       | Web (`CreationModeButton.tsx`) / page                      |

## Web Cmd Layer (v1.1.2)

`useCommandKeyboard` is registered once in `AppShell`, so it is active in
every window state — the shortcuts must not depend on sidebar visibility.
Its behaviors (spec issue #4, later additions noted):

- **Cmd held** → `commandKeyPressed` in `useKeyboardStore` drives the number
  badges on project cards and the running-state hover-sidebar peek. Window
  blur resets it so a Cmd+Tab away can't leave the app stuck in peek mode.
  v1.3.5 (#106) adds self-heal: when the Meta keyup is swallowed by the
  out-of-process monitor iframe (focus inside it at release), the first
  main-frame mousemove/pointerdown reporting Meta up — or any non-Meta
  keydown without the modifier — resets the stuck state; a real hold's
  pointer events report Meta down and are never touched.
- **Cmd+1..9** → selects the Nth visible project through `selectProject`
  (`src/lib/project-select.ts`) — the same unified entry the card click
  uses, so semantics can never drift between mouse and keyboard.
- **Plain ↑/↓ in the performance sidebar** → `moveProjectSelection` uses the
  same preflight-only selection as a card click. It clamps within the current
  folder, never starts/stops audio and prevents browser text selection/scroll.
  Entering the overlay sidebar transfers document focus to its surface when
  focus was outside it. Text inputs, sliders, comboboxes, open overlays and
  creation-mode confirmations retain their keys. Holding an arrow does not
  repeat project moves. Bare arrows in monitor/projection remain page input.
- **Left/right folder navigation is retired**, including Cmd+←/Cmd+→. Use the
  folder dropdown / Utilities entry; an open selector keeps its standard keys.
- **Cmd+R** → starts the inline rename through `startRename`
  (`src/lib/project-rename.ts`): the selected project's card (or the
  selected folder segment's name when nothing is selected). The Edit
  menu's "Rename Project" item fires the same function behind the same
  accelerator — the native accelerator consumes the key before the webview,
  so both paths apply the same text-input/open-overlay guards. Forbidden
  while a session runs; silent no-op with nothing selected (and never
  offered for the protected Utilities folder).
- **Cmd+0** is deliberately NOT consumed here; it stays the native
  "Actual Size" menu accelerator.

## Enter Session Action (v1.1.2; Esc retired v1.2.0)

Enter is a keyboard alias for the sidebar's session-action footer, handled
where its state lives (`SessionActionButton.tsx`) so key and click share
one set of conditions:

- **idle/error + loadable** → `start()` (same gate as the Load button)
- **running + pending config change** → `restart()` (the amber Change)
- **running, no pending change** → Enter deliberately NOT mapped — the
  close-project confirmation (⌘W while a session runs) or the Close
  button are the only ways a keypress/click stops a live show.

The plain-Esc close alias and its ⌘Esc variant remain retired (macOS owns
⌘Esc, and closing behind a keypress proved too easy to hit mid-show).
#151 adds one main-shell use: Esc cancels a pending mode confirmation without
stopping the project or closing windows. In performance monitor pages, main and projection
alike, Esc continues to reach the page; the contract lives in
`page-interaction.md` (window-scoped since v1.5.0 #131).

The focused mode button owns native Enter/Space activation for its two-step
confirmation. The capture-phase session alias yields to `data-mode-switch`,
including the first activation before mode preparation has set its shared gate.
Both successful and failed keyboard submissions restore focus to the mode control.

## Folder Dropdown (v1.6, issue #153)

The user folder control is a bounded Radix Select. Tab reaches its trigger;
standard select keys open it, move through options, select or cancel. The app's
Enter submit yields while the listbox is open. The independent Utilities button
is keyboard reachable and toggles back to the preceding user view. Its return
entry does the same; a deleted remembered folder falls back to Home.

Folder switching uses the dropdown and Utilities control. Arrow keys inside
its popup select options; no global left/right folder shortcut remains.

Guards: text inputs own their keys (`isEditableTarget`), and while a
Radix dialog or select popup is open (`hasOpenOverlay`) Enter/Esc belong
to the overlay — the global layer never fires underneath a confirm flow.
The alias listens in the **capture phase** and stops propagation when it
fires (v1.2.2 #29 feedback): focus on a settings control — the device
select, say — must not swallow Enter into opening its popup before the
alias runs; a bubble-phase window listener only ever saw the key after
Radix had acted on it.

In every confirmation dialog the primary (filled/dark) action carries
`autoFocus`, so Enter activates it and Esc cancels. Radix's FocusScope
would otherwise focus the first tabbable element, which is the Cancel
button in our footer order.

## Monitor Keyboard Focus (v1.1.2 fix)

WKWebView hands a freshly loaded out-of-process iframe the keyboard
first responder when no element in the main frame holds focus — most
visibly on the first project opened after launch, the only session
entered without any host element ever being focused. The shell's
window-level shortcuts (⌘ layer, Esc) then go dead until the next click.
`MonitorView` prevents this by focusing its host root (`tabIndex={-1}`)
on mount and on every iframe `onLoad` (project switches and monitor
reloads included). v1.3.5 (#105): the reclaim yields to the page — an
all-frames reporter script (built in `window.rs` from the
`GUEST_FOCUS_MESSAGE_TYPE` const) publishes the page's focus state,
and while a page element other than body/html holds focus, every
reclaim path stands down and the web ⌘ layer lets the page keep the
keyboard (page-focus priority — app-behavior「网络与 Monitor」; native
menu accelerators are unaffected). #107 adds the second gate: the
pointer sitting inside the monitor frame area holds the same
stand-down (homemade no-focusin controls included), until it leaves —
with a ≤500ms debounce and an elementFromPoint re-check so a missed
leave can't strand the gate.

The whole gate machine — both gates, the debounce, the heartbeat, the
message guard — lives in `src/hooks/use-guest-focus-gate.ts` (a deep
module; MonitorView only supplies what a reclaim/regain means). The
wire contract is pinned from both sides: `GUEST_FOCUS_MESSAGE_TYPE` in
the hook mirrors the Rust const, and a test on each side asserts the
literal — changing one without the other fails a test, not a
performance.

## Mute Shortcut (v1.2.2, issue #30 feedback)

Every volume entry routes through `src/lib/volume-control.ts` — the one
module that owns the fixed-gain derivation (runtime-contract §7.5), the `volumeAdjustable`
gate, and the `setMasterVolume` forwarding — so the slider, the speaker
button and the menu item can never drift. All entries are no-ops unless
a live internal ≤2-channel session is running.

- **⌘M** is a View-menu accelerator on purpose: the accelerator claims the
  key from macOS's native hide/minimize before the system ever sees it
  (the same replacement strategy as ⌘Q/⌘W). Unlike ⌘R it carries no
  text-input/overlay guards — mute opens no UI, and emergency silence
  should work under any dialog.
- **Cmd-arrow volume nudges remain retired.** Folder navigation no longer
  consumes these chords either. Native passthrough still lets editable fields
  and project pages receive normal command-arrow input.

## Cmd+Q Quit Flow (v1.1.2 T7)

The predefined macOS Quit item cannot be intercepted, so `menu.ts`
replaces it with a custom `quit-app` MenuItem that calls `requestQuit()`
(`src/store/window-store.ts`): with a live session (starting/ready — the
same `shouldConfirmClose` gate as ⌘W) the app-styled `QuitConfirmDialog`
opens; its confirm stops the session and then exits. Without a live
session the app exits immediately — `markQuitting()` first so the exit
never waits for a fade (app-behavior「Window 与全屏」), then the `quitApp` Rust command, whose
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
  const { recentProjectPaths, projectFolders, activeFolderId } =
    useProjectStore.getState()
  const path = visibleProjectPaths(
    recentProjectPaths,
    projectFolders,
    activeFolderId
  )[Number(event.key) - 1]
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
// macOS-only Cmd layer (this is a macOS app)
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

## Creation monitor expansion (#156)

Plain Escape restores the temporarily expanded creation workspace. A native
`Escape` menu accelerator handles iframe focus; it is enabled only for the
focused main window with creation expanded and no submission/settings/close/quit
dialog. Main focus and dialog changes rebuild its enablement. Its async dispatch
checks the workspace identity and expansion revision. The web fallback owns only
plain Escape outside App overlays. Projection, other windows and unexpanded
performance monitors keep their existing page-key ownership. Expansion changes
layout and hides the mounted editor; it never toggles native fullscreen, navigates
the iframe, starts/stops a process or cleans up test windows.

## Performer test windows (#157)

Cmd+W and the native red close button hide the focused performer test window.
The main list retains the device; its show/hide button and numbered focus action
reopen the same page/client. Only the list X deletes a device and unloads its page. Ctrl+Cmd+F changes that
window's native fullscreen. Monitor zoom shortcuts are no-ops while a performer
is focused; its viewport is selected explicitly through its own shell toolbar. The
plain-Escape restore accelerator remains main-only. Performer shells have no
App web shortcut layer: nonreserved keyboard/pointer input belongs to the real
page. Cmd+Shift+R in creation refreshes existing test pages through the shared
manual refresh workflow. App-global menu accelerators remain reserved.

JavaScript sheets in performer tests use native Return/Escape button handling.
Focused-window dispatch resolves the sheet parent, so Cmd+W/fullscreen do not
fall back to the main window merely because the sheet is the key NSWindow.
