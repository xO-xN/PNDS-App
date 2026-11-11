# Monitor View State

## Default wiring

New Blank projects already wire `modules/pnds-monitor-state/`. `public/monitor-view.json` starts empty; only actual declared fields enable the dedicated connection. No pending handoff is created. Read the README in that project directory for generic module interfaces.

## Shared state

The project server owns low-frequency view selections. Main monitor, projection and other copies render full snapshots. After any copy submits a choice, all copies wait for the server broadcast rather than updating local state first.

## The architectural premise of "zero App changes"

Monitor copies connect directly to the project server; view synchronization does not pass through the App. Page disposal closes only its own view connection.

## The three events

Blank wires these through `lib/monitor-view.js`; the generic module accepts a project event table:

| Direction           | Event           | Payload           |
| ------------------- | --------------- | ----------------- |
| server → new copy   | `view:snapshot` | Full state object |
| copy → server       | `view:set`      | `{ key, value }`  |
| server → all copies | `view:state`    | Full state object |

## Server side: declaring is opting in

Edit `public/monitor-view.json`, then restart the project, for example:

```json
{ "displayMode": { "default": "score", "values": ["score", "details"] } }
```

Each `default` determines its JSON type; `values`, `min` and `max` constrain it. Invalid declarations fail startup; invalid updates retain state. Empty declarations create no `/monitor-view` namespace. Declared fields enable it only on the monitor service. State lives in this run's memory and resets to declared defaults on restart.

## Page side: wait for the snapshot, report sets

Blank reads the actual run declaration from `/__pnds/monitor-view.json`; an empty declaration adds no socket. Use the wired interface:

```js
PNDSMonitorView.onViewState(state => {
  /* Render the full snapshot; state is null while waiting. */
})
PNDSMonitorView.setViewState('displayMode', 'details')
```

`viewState` and subscriber snapshots are independent copies. Hide state-dependent UI until a snapshot arrives; controls only submit updates. Render after the snapshot changes and read failures through `error`.

## Boundaries (when not to use it)

Only low-frequency view choices belong here: not score time, sound, claims, high-frequency performer input, or App QR/projection-start state. Projection may branch through the [projection surface](./projection-surface.md) while sharing view choices. Preserve existing author source and wiring.
