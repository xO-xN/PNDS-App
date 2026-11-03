# QR Code

## v1.6.1 standard module

QR is now a built-in App feature. The standard module catalog no longer adds QR source to projects. This page keeps its published path and headings for existing links.

## Template example implementation

In performance mode, use **Performer QR code** in the bottom bar. It appears on the projection when that window exists, otherwise over the main monitor. In creation mode, use the button beside **Performers**; with the monitor expanded, find it in the devices popover. Click again to hide.

## The endpoint: GET /qr (monitor side only)

Migrated projects no longer serve `/qr`. The App encodes the current ready run’s complete performer URL, exactly as selected for that run, including scheme, domain, port, path and query. HTTPS entry failure hides QR without switching to HTTP. A phone always opens the performer entry; tools may use that page for controls or connection tests. Multichannel Signal Generator shares its responsive control console between performer and monitor.

## Embedding it in a page

The App shows a floating panel above the score, keeping the surrounding score visible and interactive. Drag the top of the panel to move it, or drag any of its four corners to resize it while keeping the opposite corner fixed. The panel has no additional controls; use the App’s QR button again to hide it. The panel keeps a light-backed QR image, project name and full URL while the underlying page and audio keep running. Projection introduction/start state is preserved. Opening or closing the projection moves the overlay automatically; a minimized projection still counts and is not raised by QR. Refreshing the monitor, zooming and fullscreen preserve visibility.

## What creators should know

A ready run with an available entry is required. Stop, restart, project replacement, mode change or entry failure hides QR; recovery requires another click. Migrated projects no longer supply their own QR in standalone browsers or older Apps. External projects can retain custom QR source and exact shared `qrcode` references. The App itself reuses that same shipped encoder, so a migrated project does not need to declare it. See [runtime contract §15](../reference/runtime-contract.md) for URL selection; ordinary projects retain HTTP unless secure-context APIs require HTTPS.
