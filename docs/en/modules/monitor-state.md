# Monitor View State

One monitor URL lives as several copies: the App's main-window iframe, the App's projection-window iframe, the fresh copy a ⌘⇧R reload produces, a browser tab opened in rehearsal. With view state (view toggles, debug picks) held page-locally, every copy starts from its own defaults — what the conductor tuned in the App's monitor has to be re-tuned with a mouse on the projection copy, and an explicit reload throws the tuning back to the defaults.

The monitor view state moves that state to **the work's own server** as the single source of truth: any copy connecting receives the current snapshot, any copy's adjustment is broadcast to all of them at once; pages render from the server state and report adjustments instead of mutating. Every copy stays consistent, and a reload loses nothing.

## The architectural premise of "zero App changes"

The two monitor copies (main window and projection) already each connect directly to the work's server — the App is not on this data path. That is why the pattern works, and why it is unconstrained by App versions: any work that wants its monitor debug state mirrored to browser / projection copies can adopt this pattern as-is, with no App cooperation.

## The three events

The protocol is three events, named in `public/shared.js`'s `events` (the work's wire vocabulary):

| Direction                       | Event                    | Payload               | Meaning                                                                                          |
| ------------------------------- | ------------------------ | --------------------- | ------------------------------------------------------------------------------------------------ |
| server → freshly connected copy | `monitor:state:snapshot` | the full state object | pushed on connect; a reconnect receives it again (a missed broadcast heals at the next snapshot) |
| copy → server                   | `monitor:state:set`      | `{ key, value }`      | reports one adjustment; undeclared keys are ignored                                              |
| server → every copy             | `monitor:state`          | the full state object | the broadcast after a set lands; latest value wins, application is idempotent                    |

Broadcasts always carry the **full state**, never a delta — copies need no ordering, and one lost broadcast still converges at the next snapshot.

## Server side: declaring is opting in

`lib/monitor-state.js` is reusable skeleton; `server.js` wires it in one call:

```js
attachMonitorState(io.of(shared.monitorNamespace), {
  events: shared.events,
  defaults: shared.monitorViewState,
})
```

- **The namespace IS the broadcast scope.** The view state lives on the `/monitor` Socket.IO namespace (`shared.monitorNamespace`); performer pages never connect there — the scope is structural, no allowlist to maintain, performer pages are oblivious.
- **Declaring is the opt-in.** `shared.monitorViewState` declares the keys and defaults this work syncs (the template example carries only `showQr`). Only declared keys are stored and broadcast; purely local state a page wants to keep (hover highlights and other transient UI) simply stays undeclared.
- **Session-scoped lifetime.** The state is memory only: restarting the work returns to `monitorViewState`'s defaults — every performance starts clean, inheriting nothing from the previous run's debugging. This is the deliberate split from the seat registry: seats persist across restarts on disk (`.pnds-seats.json`); view state never touches disk.

## Page side: wait for the snapshot, report sets

`connectMonitor` in `public/client.js` enables the channel when passed `monitorNamespace` (from `shared.js`) — the monitor page opens one more socket on that namespace (multiplexed over the same socket.io connection), with a three-part surface:

```js
const client = PNDSClient.connectMonitor({
  io,
  port: P.performerPort,
  events: P.events,
  hostname: location.hostname,
  monitorNamespace: P.monitorNamespace,
});

client.viewState; // null until the first snapshot lands, the latest state after
client.onViewState((state) => {...}); // snapshot and broadcasts share one delivery path
client.setViewState("showQr", false); // report the adjustment; never flip locally
```

Page rendering follows two disciplines — the template's `public/monitor.js` (the QR show/hide button) is the worked example:

- **Wait for the snapshot**: while `viewState` is `null`, render no view-dependent UI (hidden, not default-drawn) — a fresh copy's first frame never flashes "defaults first, corrected after".
- **Adjustments only report**: control handlers call `setViewState` and let the broadcast change both state and UI — the sending copy converges on the same path as every other copy.

## Boundaries (when not to use it)

- **Low-frequency view state only**: operator adjustments like toggles and debug picks. High-frequency visual streams (canvas pointer trails and the like) do not belong on this channel — a work that needs one designs it on the same server transport itself.
- **A dedicated projection surface** (parameterized pixels like `?surface=venue`) is a different path: this pattern serves "projection = mirror of the monitor" and is orthogonal to dedicated surfaces.
- The state is never shared across works and never persists across performances — session scope is a feature, not a gap.
