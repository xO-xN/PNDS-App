# Networked Music Performance in PNDS App

A Project's two page roles are told apart by port; the Project declares both ports in `manifest.json`:

- the performer page: `performerPort`, reached by phones / tablets on the local network;
- the monitor / conductor page: `monitorPort`, displayed inside the PNDS App window.

The `PNDS Template`, for example, uses `6868` and `6869`.

The role follows from the port:

```text
http://<Host-LAN-IP>:<performerPort>/  → performer page
http://<Host-LAN-IP>:<monitorPort>/    → monitor/conductor page
```

A Project may ship no playable performer UI, but its performer server must still serve the health endpoint, and it may show an explanation page at `/`. The built-in tool Multichannel Signal Generator uses this pattern.

## The performer page

The performer page is opened on performers' own devices (phones, tablets, laptops) at the local network address the App has selected, and carries the score's interaction and notation displays. The Project owns mobile interaction, identity, reconnection and the work's data protocol.

PNDS prescribes no Socket.IO event names, client IDs, role counts or UI framework.

## The monitor page

The monitor page is opened by PNDS App as the score's conducting or monitoring view; it can be mirrored to a venue's large screen for the conductor, performers or audience.

The monitor page must:

- load at `http://<Host-LAN-IP>:<monitorPort>/`;
- allow iframe embedding — no `X-Frame-Options` or CSP `frame-ancestors` that blocks it;
- not depend on Tauri APIs or the App's DOM;
- respond to viewport resize without asking the App to rebuild the iframe;
- keep canvas/WebGL/p5 pages' internal drawing buffers and coordinate mappings in sync when their size changes;
- store persistent interaction state in relative or normalised coordinates, so it does not fossilise old pixel coordinates after a window resize;
- keep the area at the top centre of the window free of critical interactions — the App's window title / drag overlay lives there.

Entering or leaving macOS full screen only changes the window's size and decoration state: the App does not restart Node and does not reload the monitor iframe. The Project must adapt using standard resize events. Following the Template, you may design the monitor to follow the App's theme and language preferences automatically.

## Theme following (optional)

From v1.2.3, when the monitor iframe finishes loading, on theme switches, and when the window regains focus, the App pushes the current theme to the monitor page via cross-origin `postMessage`. Supporting this is **optional**: Projects that don't listen behave exactly as before.

From v1.3.0, whenever the App loads or reloads the monitor it **always** carries a `?theme=<name>` first-frame parameter on the iframe URL (semantics below), so theme-following pages paint correctly on the first frame.

Message (App → monitor page, one-way):

```json
{
  "type": "pnds:theme",
  "version": 1,
  "theme": "lavender",
  "palette": {
    "bg": "#eef0f8",
    "sidebar-bg": "#e2e5f3",
    "card": "#ffffff",
    "pill": "#e8ebf7",
    "accent": "#5a4ff3",
    "accent-hover": "#4a3fe0",
    "accent-foreground": "#ffffff",
    "text": "#171a2b",
    "text-secondary": "#5d6484",
    "danger": "#e11d48",
    "danger-hover": "#c2143c",
    "danger-foreground": "#ffffff",
    "warning": "#ffb020",
    "warning-hover": "#f0a20c",
    "warning-foreground": "#171a2b"
  }
}
```

Conventions:

- `palette` carries the final colour values (its keys share names with the App's semantic tokens) — most Projects consume only the palette and never need the theme concept; when the App adds a theme, Projects follow with zero changes. The `theme` name is for Projects that fork a whole design language (e.g. switching corner radii or font weights per theme).
- Delivery is best-effort, last-value-wins: the App does not guarantee exactly-once (a suspended WebView may drop messages; the App re-pushes on focus regain). The page must apply messages idempotently (writing the values into its own CSS variables is enough).
- To avoid a first-frame colour flash, a page may read the URL query parameter `?theme=<name>` as its initial value. From v1.3.0 the App **always** carries the parameter when loading or reloading the monitor (the value is snapshotted at iframe navigation — switching theme mid-session does not reload the page; updates still arrive via postMessage); the Project must still tolerate its absence (opening directly in a browser, older App versions, …).
- The performer page takes no part (it is not opened inside the App and always uses the Project's own colours).
- The App never injects or rewrites anything in the monitor page — whether and how to use the push is entirely the Project's call.

## Locale following (optional)

From v1.3.0, with the same mechanism as the theme bridge, the App pushes the current **resolved** language code to the monitor page; the push triggers are fully shared (monitor iframe load, language switch, window focus regain, heartbeat). Supporting this is **optional**: Projects that don't listen behave exactly as before.

From the same version, the App **always** carries a `?lang=<code>` first-frame parameter on the iframe URL when loading or reloading the monitor (same semantics as `?theme=`), so locale-following pages render in the right language on the first frame.

Message (App → monitor page, one-way):

```json
{
  "type": "pnds:locale",
  "version": 1,
  "locale": "zh-CN"
}
```

Conventions:

- `locale` is the **resolved** language code (current vocabulary: `en` / `zh-CN`), not the General settings item — a session set to "follow system" is pushed with the code the system resolved to. When the App adds languages, only the vocabulary grows; the message shape does not change.
- Delivery semantics match the theme bridge: best-effort, last-value-wins; the page must apply messages idempotently; the App does not guarantee exactly-once.
- To avoid a first-frame language flash, a page may read the URL query parameter `?lang=<code>` as its initial value. The value is snapshotted at iframe navigation — switching language mid-session does not reload the page; updates arrive via postMessage; the Project must still tolerate its absence (opening directly in a browser, older App versions, …).
- Pages that don't implement locale following are entirely unaffected: the App never injects or rewrites anything in the monitor page, and `?lang=` is a harmless query parameter to a page that ignores it.
- The performer page takes no part (it is not opened inside the App and always uses the Project's own language).
