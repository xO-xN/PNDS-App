# Projection Surface

The App's projection window and main window load two independent page copies of the same monitor address. Since v1.5.0 the projection window's monitor navigation **always** carries the first-frame parameter `?surface=venue` — the one channel a Project has to tell the conductor's main-window copy from the audience-facing projection copy. What the venue screen shows is the Project's sovereignty to begin with: if you want the venue screen to show every performer's score instead of the conductor console, branch here.

The protocol's normative home (when it is sent, snapshot semantics, tolerance rules) is [runtime contract §14](../reference/runtime-contract.md) — this chapter is about using it from the Project side.

## Unadapted = a mirrored monitor

A Project that does not read the parameter needs no changes at all: the contract already requires ignoring unknown query parameters, so the projection window shows exactly what the main window shows — identical to before the parameter existed. `?surface=venue` has no postMessage push and no dedicated script — it is just a query parameter on the URL; reading it or not is the Project's free choice.

## A branching example

Branch in the monitor page's entry point (e.g. `public/monitor.js`). The essential rule: **tolerate absence and unknown values** — treat "no parameter" and "a value you do not recognize" both as the main-window copy, and never error over it:

```js
// The projection-surface branch (venue = the audience copy on the venue screen)
const surface = new URLSearchParams(location.search).get('surface')
const isVenue = surface === 'venue' // unknown value = no branch = mirror

if (isVenue) {
  renderVenueView() // audience view: every seat's score, larger type, no console
} else {
  renderConductorView() // conductor view: console, QR codes, seat management
}
```

Notes for the branched view:

- **The parameter is snapshotted at navigation**: a session never re-navigates over window state, so `isVenue` is constant for one load; only an explicit ⌘⇧R reload cold-fetches and re-reads the URL.
- **The bridges apply unchanged**: the venue copy still receives the theme/locale pushes ([§11](../reference/runtime-contract.md) — `?theme=`/`?lang=` and postMessage) — a venue view needs no special cooperation.
- **The main-window copy never carries the parameter**: do not guess which surface you are on from signals other than the parameter (window size, fullscreen state) — those are unreliable; the parameter is the contract.

## Declaring zoom ownership (when the page owns its zoom)

When the Project's page provides its own zoom (cursor anchoring, density following, …), it fights the App projection window's ⌘= frame zoom over one key — declare the ownership ([runtime contract §14](../reference/runtime-contract.md) handshake, since #135):

```js
// When embedded (the projection window's venue copy), declare early after load:
if (window.parent !== window) {
  window.parent.postMessage({ type: 'pnds-projection', zoom: 'page' }, '*')
}
```

Once declared, the App stops applying its own ⌘=/⌘-/⌘0 for **that navigation** (the menu stays lit but is a no-op for the window), and its scale frame falls back to 100% — the page's own zoom starts from 1× and the two never compound.

Notes:

- **The ownership lasts one navigation**: a ⌘⇧R reload or an address change resets it, so declare on every load — putting the declaration in the entry point does that naturally.
- **No declaration = App zoom as ever**: unadapted Projects, and the intro/utility/cover phases, are unaffected.
- `'*'` as targetOrigin (the page cannot know its host's origin); the payload is a capability string, nothing sensitive.
