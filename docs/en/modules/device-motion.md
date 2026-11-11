# Device Motion Input

`device-motion` is an optional capability adopted after Work chat confirmation. It is not a Blank default and needs neither p5 nor ml5. It reads the current participating device's tilt and acceleration, independently of the Host hardware. It does not provide a complete gyroscope.

## Activation and permission

The work provides localized enable, stop, retry and status controls. Call `createDeviceMotion().enable()` directly from a user action so the platform can request permission. Ordinary LAN HTTP can be restricted. Distinguish denial, missing API, waiting for valid fields and no data; permission does not prove actual capture. Backgrounding and page exit remove listeners and invalidate late permission replies. Foreground return requires explicit enable. Only the main monitor captures for its projection copy; each Client and performer page can enable its own input.

## Data

`tilt` beta/gamma are degrees around device X/Y, bounded to ±180°/±90°, without remapping for screen rotation. `acceleration` x/y/z excludes gravity; the separately named `gravity` includes it. Components are m/s², bounded to ±200; X points right, Y toward the device top, Z out of its screen. Zero is a measured zero; `null` is a missing field. An entirely missing vector never becomes valid input; after 1.5 seconds without valid fields, state reports no-data. Each kind updates at most 30 Hz without smoothing or integration. `intervalMs` is the browser-reported sampling interval, not the module delivery period.

## Work wiring and verification

Within the same approved task, the assistant reads actual source and wires page controls, a fixed safe script route, server `normalizeMotion` validation after current player admission, the author's effect, and the same common action/state/recording path. Check ownership/admission before capture and application. Replay restores the same effect without requesting motion permission or recording again. Send only fresh input while joined and connected; discard disconnected samples rather than flushing a backlog on reconnection. Whole-task undo preserves subsequent author customizations. The adopted directory's bilingual README specifies the full interface and limits.

Deterministic vectors and injected native events establish calculation, lifecycle and project wiring only. Real phone direction/tilt/acceleration, platform permissions and browser/native entry behavior require separate hardware evidence.
