# Expose controller mapping targets from a project

Native Host monitor pages and Client performer pages can expose custom controls, continuous parameters, and existing actions through `window.PNDSControllerMapping`. Each performer saves their own mappings on their Mac. Existing HTML buttons, checkboxes, and range inputs can participate through standard web events.

## Register a target

Call `window.PNDSControllerMapping?.register(definition)` in the current project document. Optional chaining lets the same project start in a regular browser. The current API `version` is 1.

| Field                           | Contract                                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                            | A stable, unique, nonempty string within the project page. Keep the ID to restore mappings when reopening the page.                                                        |
| `name`                          | A nonempty display name shown in Settings.                                                                                                                                 |
| `kind`                          | `'trigger'`, `'switch'`, or `'continuous'`.                                                                                                                                |
| `trigger()`                     | The synchronous action for a trigger target.                                                                                                                               |
| `getValue()`, `setValue(value)` | Synchronous reads and writes for switches and continuous targets. Switches use booleans and continuous targets use finite numbers. Reads return the current project state. |
| `min`, `max`, `step`            | A continuous target's finite limits and positive step. Steps start at the minimum. Omit the step or pass `null` for an unstepped range.                                    |
| `position()`                    | Optional. Returns `{ x, y, width, height }` in CSS pixels relative to the viewport. Return `null` while the target is hidden.                                              |

In mapping mode, the performer can select a positioned target by clicking its region. Address labels follow the positions reported by `position()`. Convert a canvas region to viewport coordinates or use an element's `getBoundingClientRect()`. If a click lands on a supported HTML control, the HTML control takes precedence.

All registered targets are available under Settings → Performance → MIDI / OSC Control → Project controls. Choose Learn to wait for a controller input. Edit the resulting mapping in the same settings section. Use Escape with App overlays closed, or use the performance bar button to leave mapping mode.

`register()` returns a function that unregisters that registration. Registering the same ID again replaces its callbacks and position. The previous cleanup function only affects the registration it created. Changing the kind for a saved ID marks its mapping for rebinding. A replacement document registers its own targets.

## Example

```js
const mapping = window.PNDSControllerMapping
const removePulse = mapping?.register({
  id: 'pulse',
  name: 'Pulse',
  kind: 'trigger',
  position: () => pulseRegion.getBoundingClientRect(),
  trigger: sendPulse,
})
const removeWetMix = mapping?.register({
  id: 'wet-mix',
  name: 'Wet mix',
  kind: 'continuous',
  min: 0,
  max: 1,
  step: 0.01,
  getValue: () => state.wetMix,
  setValue: setWetMix,
})
```

Reuse the handlers for the project's original clicks and drags so the same sound, synchronization, and recording rules apply.
