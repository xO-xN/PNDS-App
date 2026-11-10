# Monitor View State

## v1.6.1 standard module

New Blank projects include and wire this module by default. Their editable `public/monitor-view.json` starts empty; only declared view fields enable the dedicated connection. The catalog reports it already included, without a pending handoff. Existing manually adopted and customized projects keep their source and wiring.

Offline release 0.2.0 is added to `modules/pnds-monitor-state/`, with sources, compatibility and bilingual README of the same version. The standard release uses independent `monitor-client.js` and `PNDSMonitorState.connectMonitorState` rather than copying a mixed performer client. Attach `attachMonitorState` to a dedicated monitor namespace with declared keys, defaults, event names and optional validators. Snapshots live only for the server session; unknown/invalid updates preserve state. Use the added README for complete inputs/outputs, wiring and cleanup. Sources belong to the project; file addition does not establish wiring or runtime acceptance.

## Template example implementation

One monitor URL lives as several copies: the App's main-window iframe, the App's projection-window iframe, the fresh copy a ⌘⇧R reload produces, a browser tab opened in rehearsal. With view state (view toggles, debug picks) held page-locally, every copy starts from its own defaults — what the conductor tuned in the App's monitor has to be re-tuned with a mouse on the projection copy, and an explicit reload throws the tuning back to the defaults.

The monitor view state moves that state to **the work's own server** as the single source of truth: any copy connecting receives the current snapshot, any copy's adjustment is broadcast to all of them at once; pages render from the server state and report adjustments instead of mutating. Every copy stays consistent, and a reload loses nothing.

## The architectural premise of "zero App changes"

The two monitor copies (main window and projection) already each connect directly to the work's server — the App is not on this data path. That is why the pattern works, and why it is unconstrained by App versions: any work that wants its monitor debug state mirrored to browser / projection copies can adopt this pattern as-is, with no App cooperation.

## The three events

New Blank's event table is defined by `lib/monitor-view.js` and its monitor connector. The frozen generic module accepts an event table so existing works retain their own names. The three state events are:

| Direction                       | Event           | Payload               | Meaning                                                                                          |
| ------------------------------- | --------------- | --------------------- | ------------------------------------------------------------------------------------------------ |
| server → freshly connected copy | `view:snapshot` | the full state object | pushed on connect; a reconnect receives it again (a missed broadcast heals at the next snapshot) |
| copy → server                   | `view:set`      | `{ key, value }`      | reports one adjustment; undeclared keys are ignored                                              |
| server → every copy             | `view:state`    | the full state object | the broadcast after a set lands; latest value wins, application is idempotent                    |

Broadcasts always carry the **full state**, never a delta — copies need no ordering, and one lost broadcast still converges at the next snapshot.

## Server side: declaring is opting in

New Blank includes the frozen module and `lib/monitor-view.js` wiring. Save `public/monitor-view.json`, then restart the project:

```json
{
  "displayMode": { "default": "score", "values": ["score", "details"] }
}
```

- **The namespace IS the broadcast scope.** New Blank view state lives on the `/monitor-view` Socket.IO namespace on the monitor server; performer pages never connect there — the scope is structural, no allowlist to maintain, performer pages are oblivious.
- **Declaring is the opt-in.** `public/monitor-view.json` declares the keys and defaults this work syncs (for example `displayMode`). Only declared keys are stored and broadcast; purely local state a page wants to keep (hover highlights and other transient UI) simply stays undeclared.
- **Session-scoped lifetime.** The state is memory only: restarting the work returns to the declared `public/monitor-view.json` defaults — every performance starts clean, inheriting nothing from the previous run's debugging. This is separate from persistent performer identity: its registry survives a restart, while view state never persists. The default declaration fixes each field's JSON type; optional `values`, `min` and `max` validate work choices and numeric limits. Invalid declarations fail startup; rejected updates leave state unchanged.

## Page side: wait for the snapshot, report sets

New Blank `public/monitor.js` reads the running declarations from `/__pnds/monitor-view.json`. An empty declaration creates no namespace on the server and no extra socket in the page. With declared keys, the prewired public surface is:

```js
const client = window.PNDSMonitorView
client.viewState // null until a complete server snapshot arrives
client.onViewState(state => {
  /* render the complete snapshot */
})
client.setViewState('displayMode', 'details') // report, never flip locally
```

Page rendering follows two disciplines; a real display-mode control in `public/monitor.js` uses both:

- **Wait for the snapshot**: while `viewState` is `null`, render no view-dependent UI (hidden, not default-drawn) — a fresh copy's first frame never flashes "defaults first, corrected after".
- **Adjustments only report**: control handlers call `setViewState` and let the broadcast change both state and UI — the sending copy converges on the same path as every other copy.

## Boundaries (when not to use it)

- **Low-frequency view state only**: operator adjustments like toggles and debug picks. High-frequency visual streams (canvas pointer trails and the like) do not belong on this channel — a work that needs one designs it on the same server transport itself.
- **A dedicated projection surface** (parameterized pixels like `?surface=venue`) is a different path: this pattern serves "projection = mirror of the monitor" and is orthogonal to dedicated surfaces.
- The state is never shared across works and never persists across performances — session scope is a feature, not a gap.

Existing manual module wiring continues to use its supplied README. New Blank uses the declaration and validation wrapper above; do not copy the historical `showQr` example into App QR or projection-start controls. App QR is owned by the Host. Snapshot reads and subscribers receive independent copies; callers cannot mutate another copy or server state. Page release closes its own view connection. Score time, sound, claims and high-frequency performance input do not belong here.
