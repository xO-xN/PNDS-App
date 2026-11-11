# Projection Surface

Main and projection windows are separate monitor copies. The projection carries `?surface=venue` so the work can select venue visuals. Protocol boundaries follow the [runtime contract](../reference/runtime-contract.md) §14.

## Unadapted = a mirrored monitor

Without reading the parameter, projection renders the same monitor. Treat missing or unknown values as the main view; do not infer the surface from size or fullscreen state.

## A branching example

Select the actual rendering at the monitor entry:

```js
const isVenue = new URLSearchParams(location.search).get('surface') === 'venue'
if (isVenue) renderVenueView()
else renderConductorView()
```

The parameter is fixed for each navigation. Each page handles resize; theme and language bridges still apply. The main monitor owns media capture; projection subscribes to its derived results without opening another camera/microphone. See the [native media contract](../reference/native-media.md).

## Declaring zoom ownership (when the page owns its zoom)

When the page handles projection zoom, declare it after the venue copy loads:

```js
if (isVenue && window.parent !== window) {
  window.parent.postMessage({ type: 'pnds-projection', zoom: 'page' }, '*')
}
```

The App yields projection-frame zoom for this navigation and resets it to 100%. Declare again after reload. Without a declaration the App owns zoom; main monitor does not join this handshake. Page keys still follow [page interaction](../reference/page-interaction.md) boundaries.
