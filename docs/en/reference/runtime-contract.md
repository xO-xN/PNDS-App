# Runtime Contract

This section defines the protocol between PNDS App and a score Project over one running session: launch parameters, environment variables, HTTP/health, the audio bus, process ownership and shutdown semantics. It does not prescribe the work's own Socket.IO or OSC business protocol.

## 1. Participants and ownership

```text
PNDS App
├── owns Node sidecar process
├── owns scsynth process (internal only)
├── owns App master group/synths
├── owns selected CoreAudio device and session preferences
└── embeds the project monitor page

Score project Node server
├── owns performer and monitor HTTP servers
├── owns project Socket.IO/data protocol
├── owns project OSC client
└── owns project synth/group/buffer resources
```

Rules:

- the App does not interpret the work's high-rate messages;
- the Project never stops the App's scsynth;
- the Project never modifies App preferences;
- the App never modifies the Project directory or manifest;
- whoever owns a process or socket closes it.

## 2. The fixed runtime

PNDS App starts the score server with its bundled Node.js (`24.18.1`, the same version on both architectures). The App never calls a system Node and never runs npm installs.

The launch is equivalent to:

```text
<bundled-node> <scoreServer.entry> --audio-mode <mode>
```

with the working directory:

```text
<project-root>/<scoreServer.workingDirectory>
```

Mode precedence:

```text
--audio-mode > manifest.audio.defaultMode
```

Projects should treat the bundled Node series (Node 24, one baseline for every architecture) as the current official runtime baseline. `package.json#engines` is a hint for development tooling only; the App does not parse it yet.

## 3. Environment variables the App injects

All modes:

```text
PNDS_HOST_IP=<selected LAN IPv4 | manifest performerAddress>
```

v1.4.0 (#62): when the manifest declares `performerAddress` (e.g. `mywork.local`), the `PNDS_HOST_IP` value is replaced by that declaration — zero project changes; the Project keeps reading this variable to build QR and connection addresses. Undeclared works inject the selected LAN IPv4 (today's behavior). Declaration format and tolerance: [manifest.md](./manifest.md).

Internal:

```text
PNDS_OSC_TARGET=127.0.0.1:<dynamic scsynth UDP port>
PNDS_AUDIO_OUTPUT_BUS=<private project bus start>
PNDS_AUDIO_OUTPUT_CHANNELS=<manifest audio.outputChannels>
```

External:

```text
PNDS_OSC_TARGET=<validated user host:port>
```

None:

```text
PNDS_OSC_TARGET absent
```

Cross-internet performance (works declaring `telematic: true`, v1.4.0) — orthogonal to the audio mode: in all three modes either all four are injected or none are. The variable names and semantics follow the frozen TND contract:

```text
PNDS_NODE_ID=<App-global node name>
PNDS_HUB_URL=<App-global hub address, full URL>
PNDS_HUB_TOKEN=<App-global token>
PNDS_HUB_ROOM={manifest.id}_{group number}
```

Rules:

- injection requires a manifest declaring `telematic: true` **and** all three "Set Node" fields (node name / hub address / token) filled in the App's settings; if any is empty, none are injected (the front-end "Set Node" gate enforces completeness — the injection authority is the backend);
- rooms are never hand-typed by users: the `group number` comes from the sidebar Room dropdown (1–3, persisted per work, default 1, never reset); same work + same group = same room, different works never see each other (ADR-0004);
- the token travels only in `PNDS_HUB_TOKEN` itself — never concatenated into `PNDS_HUB_URL`, never logged;
- node configuration and group-number changes take effect on the next start; a running session's env never changes.

The full performer URL (#138 frozen contract; since #140 the App's local trusted-HTTPS entry gateway actually injects it):

```text
PNDS_PERFORMER_URL=<full performer root URL, e.g. https://show.example.org:8443/>
```

- the App injects it only while the local trusted HTTPS entry is in effect for the current performance; the entry applies only to works declaring `scoreServer.supportsPerformerUrl: true` (field semantics: [manifest.md](./manifest.md)) AND requires the settings「可信 HTTPS」enable switch to be on, the domain/port configured, and the certificate material to revalidate at that moment. When it is not injected (switch off, work undeclared, config incomplete) a Project that cannot read it simply keeps running the original HTTP flow — for a work that DID declare adaptation, incomplete config fails the start with an actionable error instead of silently falling back to HTTP;
- it is the **full root URL** the Host determined for this performance: protocol, domain and the actual port. Every address the Project exposes outward (QR code, copied address, browser connection config) uses it, taking priority over any address assembled from `PNDS_HOST_IP`;
- it is not a new value for `PNDS_HOST_IP` and not a hub URL: `PNDS_HOST_IP` (and the node variables above) keep their semantics and are injected as usual;
- the full contract (project identity, entry access context, the claim-token origin semantics) is §15.

Rules (existing):

- Internal's target is always allocated dynamically by the App;
- the App must never use `audio.standaloneTarget`;
- the External target is a preference local to the App machine, saved per Project, never written back to the manifest;
- `PNDS_HOST_IP` must match the address the App uses for the monitor (since v1.4.0 that value may be a manifest-declared address string, not only a LAN IP);
- the Project may use `PNDS_HOST_IP` to build performer QR URLs; it must not infer the address from the host the monitor request came from.

## 4. HTTP and networking

The Project must listen on the two TCP ports the manifest declares:

```text
performerPort  → performer server
monitorPort    → monitor server
```

The App confirms both ports are available before starting. On conflict it fails — it picks no substitute port and touches no manifest. A port counts as available when it is held only by the active session's own child processes (released when the session stops; the check matches occupying PIDs against the active session's child PIDs); a port held by any third-party process still fails as a conflict.

LAN address rules:

- the App enumerates usable non-loopback IPv4 addresses;
- with several, the user picks one explicitly;
- `127.0.0.1` is used only for the App's own health checks and scsynth OSC;
- phones/tablets and the monitor use the selected Host LAN IP.

## 5. Health contract

The Project must serve, on the **performer port**:

```text
GET http://127.0.0.1:<performerPort>/__pnds/health
```

The monitor port may serve the same endpoint, but the platform does not require it. The App polls the performer port only.

Minimal payload:

```json
{
  "status": "ready",
  "projectId": "inarticulate-iii",
  "audioMode": "internal",
  "audio": {
    "status": "ready",
    "target": "127.0.0.1:49328",
    "error": null
  },
  "scoreServer": {
    "performerPort": 6868,
    "monitorPort": 6869,
    "error": null
  }
}
```

`status`:

```text
starting | ready | error | stopping
```

`audio.status`:

```text
starting | ready | error | disabled
```

Rules:

- `disabled` is used only with `none`, where `audio.target` is `null`;
- `audio.error` and `scoreServer.error` may be a string or `null`;
- HTTP 200 only proves the endpoint is reachable; the App must wait for the payload's `status === "ready"`;
- `projectId` must match the manifest;
- both ports in the payload must match the manifest;
- the App must not depend on Project extension fields like `score`, `performers` or `sessionId`;
- health timeout, invalid JSON, early process exit, or an explicit error all fail the session.

## 6. Audio modes

| Mode       | scsynth        | OSC target       | App master stage |
| ---------- | -------------- | ---------------- | ---------------- |
| `internal` | started by App | dynamic loopback | enabled          |
| `external` | not started    | user-specified   | not enabled      |
| `none`     | not started    | not injected     | not enabled      |

Changes to the mode, device or External target take effect through a full session restart — no runtime hot-switching.

## 7. Internal multichannel audio

### 7.1 Terminology

```text
N = manifest.audio.outputChannels (1..=64, default 2)
H = output channels the selected CoreAudio device offers at the App's effective sample rate
K = min(N, H)
B = private project bus start = K
```

When the App cannot reliably read the device's capabilities, or the device has no usable output, Internal startup fails with a diagnosable error.

### 7.2 scsynth arguments

```text
-i 0                              no audio input
-o K                              hardware output channels actually opened
-S <App effective sample rate>
-z <audio.scsynth.blockSize>
-a <audio.scsynth.audioBusChannels>
-u <dynamic UDP port>
-B 127.0.0.1
-U <App bundled UGen plugins>
-H <resolved device name>         always; the session-resolved device name
```

`-H` is always passed (issue #100): every spawn — session start and the launch prewarm — carries the output device name resolved for that run (session: the saved preference or the system default it fell back to; prewarm: the launch-resolved system default — on resolution failure no `-H` is passed and the prewarm gives up silently). scsynth's own default-device resolution path hits an ObjC runtime race on macOS 26 (#99 field data: 47% per-spawn crash without `-H`, 0% with an explicit name), so that path is never taken. A device vanishing between resolution and spawn makes scsynth print its error and exit cleanly (exit code, no signal) — no retry, straight to the error page with the output in the session log, no silent fallback.

`-S` takes the App's **effective sample rate**: the App's global sample-rate preference, `48000` when unset. The manifest no longer declares sampleRate (removed from the schema's active surface); a leftover `audio.scsynth.sampleRate` in an old manifest is read and ignored — it takes no part in startup, is never rewritten, and never fails validation. H in §7.1 and the device-capability check in §7.6 likewise use the effective sample rate.

The only place to change the sample-rate preference is the Audio section of the settings panel: an inline dropdown offering the union of standard sample rates supported by all enumerated output devices (the full set `44100 / 48000 / 88200 / 96000`, deduplicated ascending), falling back to the full fixed list when enumeration fails or comes back empty. Changes persist immediately but take effect at the next Project start — the controls stay editable while a session runs, and the running session keeps the audio configuration it was spawned with. Output device selection lives in the same Audio section (v1.4.0, #58): editable any time, applied at the next Project start; the device list enumerates at the effective sample rate and channel-poor entries carry the §7.6 loss marker.

Operator's rule: the whole audio chain — the App's effective sample rate, virtual audio devices, any DAW in the chain, the audio interface — must run at one sample rate. Virtual audio devices (BlackHole and other loopback devices) only move raw samples end to end, **never resampling**; a mismatch anywhere (say a 44.1 kHz Ableton Live set against a 48 kHz chain) raises no error but produces periodic clicks — a failure that has actually happened on stage. Before the performance, confirm the DAW project and the interface both match the App preference.

The constraint must hold:

```text
audioBusChannels >= 2N
```

Since `K <= N`, this guarantees buses `B .. B+N-1` are always available.

`-z` sets only scsynth's synthesis block size. The selected device's IO buffer is a CoreAudio device property, decided by the device itself or by other apps sharing it (e.g. a DAW receiving audio through a loopback device); the App never writes that value. The device buffer should be at least `audio.scsynth.blockSize` and an integer multiple of it; a smaller device buffer forces one synthesis block across several hardware callbacks — a configuration to avoid. In practice: 512 is the safe default; 256 when you want a lower handoff latency. Open the DAW first, settle its buffer, then Load the Project in the App; never change buffers mid-performance (changing while running briefly breaks the chain).

### 7.3 Bus model

```text
hardware buses:        0 .. K-1
private project buses: B .. B+N-1, where B = K
```

The Project always produces N discrete signals and writes them to the private buses. The App bridges only the first K to hardware outputs; when `H < N`, the remaining `N-K` stay unread in the private buses and are safely dropped.

The App never remixes, folds, or copies to other hardware channels, and never interprets speaker layouts.

### 7.4 App master stage

The App uses one mono SynthDef:

```text
pndsMaster: In.ar(in, 1) → Lag/gain → Out.ar(out, 1)
```

The App creates a dedicated master group and, inside it, K instances:

```text
instance i:
  in  = B + i
  out = i
  i ∈ 0 .. K-1
```

The master group must sit at the tail of the root group, executing after the Project's audio root group. The App updates all instances' gain with one group `/n_set` and frees the whole master group before shutting scsynth down.

To guarantee execution order:

- an Internal Project must create at least one Project-owned audio root group before health reports `ready`;
- every sounding synth the Project creates, and every group it creates later, must descend from those pre-created groups;
- after health is ready the Project must never append audio nodes directly to the scsynth root group;
- the App appends the master group to the root group's tail only after health is ready, so synths the Project later creates inside its existing groups still execute ahead of the master stage.

scsynth node IDs are a shared namespace. The range `2147480000..=2147483647` is reserved for the PNDS App's master group/instances; a score Project must not use it. The App must allocate fixed, conflict-free IDs for the group and up to 64 instances within the reserved range.

### 7.5 Master gain

When `N <= 2`:

- a new session defaults to `80%`;
- `100% = 0 dB`;
- `80% ≈ -6 dB`;
- `0%` is silence;
- gain is smoothed over a short time;
- it affects only the current Internal session.

When `N > 2`:

- master gain is fixed at `100% / 0 dB`;
- the App's volume fader is dimmed;
- the App keeps the existing percent-to-dB curve unchanged;
- monitor level can be controlled with macOS/device volume or a downstream DAW.

The App's volume control is always disabled for External and None. The App never changes the macOS system volume and never sends speculative generic External volume OSC.

### 7.6 Devices with too few channels

An insufficient device is not a startup error:

- the device stays selectable;
- the App shows `Nch → Hch`;
- insufficient entries in the device menu are visually demoted, annotated with a red `Nch → Hch` loss label;
- no modal, no toast;
- Load/Change starts directly with `K = min(N,H)`;
- the App never guesses device channel counts by parsing scsynth logs.

Device capabilities must be read as the configurations available at the App's effective sample rate — not from the device name or the system default channel count.

### 7.7 Internal Project obligations

In Internal mode, the App-hosted scsynth process is the Project's only audio output target. The Project must:

- load only compiled `.scsyndef`;
- read `PNDS_OSC_TARGET` and send standard OSC to the App-started scsynth;
- read `PNDS_AUDIO_OUTPUT_BUS` as its first output bus and `PNDS_AUDIO_OUTPUT_CHANNELS` as its discrete output count;
- point the `out` control of every sounding synth it creates at `PNDS_AUDIO_OUTPUT_BUS`;
- write its declared N outputs continuously and never write hardware bus `0` directly;
- may fall back to `out = 0` when `PNDS_AUDIO_OUTPUT_BUS` is missing in standalone mode;
- honour the group discipline and the reserved node-ID range of §7.4;
- own and release every group, synth, buffer and OSC resource it creates.

PNDS guarantees discrete signal output only; it takes no responsibility for channel-to-speaker spatial layout. For a live multichannel PA, route PNDS's output into a multichannel-capable DAW, a matrix mixer or other dedicated software.

## 8. Internal startup sequence

```text
1. App cleans up leftover child processes it can prove it owns
2. preflight: manifest, paths, dependencies, ports, modes, bus capacity
3. enumerate the selected device's capabilities; compute N/H/K/B
4. start scsynth; wait for /status
5. start the Node score server with the environment injected
6. poll performer health
7. on health ready, load/show the monitor
8. load the mono pndsMaster SynthDef
9. create the master group and K master instances
10. the session enters ready
```

A master-stage creation failure must fail the whole session and clean up the started children. An Internal session may enter `ready` only after health is ready, the monitor can be shown, the SynthDef is loaded, and all K instances of the master group are confirmed created.

A start with the trusted HTTPS entry in effect (#140) slots into the same order: after step 2's port preflight passes and before step 3, the App revalidates the certificate material and BOUNDS the entry listener on the configured port of the selected LAN interface (a conflict or material failure fails the start through the existing cleanup path); the full performer URL is fixed there and rides step 5's environment; once the session is ready the App probes the entry locally over TLS/HTTP (connecting to the bound address, validating the certificate for the domain, requiring health 200 through the tunnel) and publishes entry `ready` only after that succeeds — an independent fact from session `ready`. A failed entry probe reports an entry fault only; it never ends the local audio or servers.

## 9. External and None

External:

- the App validates the target as a `host:port`;
- without a valid target it must not start;
- the Project owns the External OSC socket and the work's protocol;
- a target change is a full restart.

None:

- the App starts no scsynth;
- `PNDS_OSC_TARGET` is not injected;
- health returns `audio.status: "disabled"`;
- the score server and monitor run as usual.

## 10. Monitor runtime

The App uses:

```text
http://<PNDS_HOST_IP>:<monitorPort>/
```

The monitor iframe keeps one document instance for the session's lifetime. Window resizes and entering/leaving full screen must not restart Node, and should not reload the iframe.

The Project's monitor page must:

- load at the address above and allow iframe embedding — no `X-Frame-Options` or CSP `frame-ancestors` that blocks it;
- not depend on Tauri APIs or the App's DOM;
- update layout and drawing surfaces from standard viewport resizes (without asking the App to rebuild the iframe) — canvas/WebGL/p5 pages keep their internal drawing buffers and coordinate mappings in sync as their size changes;
- store persistent interaction state in relative or normalised coordinates, so it does not fossilise old pixel coordinates after a window resize;
- keep the area at the top centre of the window free of critical interactions — the App's window title / drag overlay lives there.

Entering or leaving macOS full screen only changes the window's size and decoration state: the App does not restart Node and does not reload the monitor iframe; the Project must adapt using standard resize events.

**Right-click belongs to the page author**: the App suppresses WKWebView's native web menu (Reload, Open Frame in New Window, Back, …; editable fields keep the system copy/paste menu). The suppression only calls `preventDefault()` and never stops propagation — a Project's own context menu, built by listening for `contextmenu` in its monitor page, coexists with it naturally, and the App needs (and offers) no wiring for it. Right-click in the App's own UI (the sidebar, …) belongs to the App's designed menus; the performer page is never opened inside the App, so its right-click is entirely the Project's own business.

The App never reads, injects or calls into cross-origin iframe DOM.

A manual Refresh may rebuild the iframe on the user's explicit action; it is a recovery tool, not part of the normal resize flow.

## 11. Theme and locale push (the theme/locale bridge)

The App pushes the current theme and language to the monitor page one-way over the same mechanism. Supporting either is **optional**: Projects that don't listen behave exactly as before. For the zero-config paths and advanced options, see the Module Manual's [theme following](../modules/theme-follow.md) and [locale following](../modules/locale-follow.md) — this section is the protocol's source of truth.

### Theme push

From v1.2.3, when the monitor iframe finishes loading, on theme switches, and when the window regains focus, the App pushes the current theme to the monitor page via cross-origin `postMessage`. From v1.3.0, whenever the App loads or reloads the monitor it also **always** carries a `?theme=<name>` first-frame parameter on the iframe URL (semantics below), so theme-following pages paint correctly on the first frame.

Message (App → monitor page, one-way):

```json
{
  "type": "pnds:theme",
  "version": 1,
  "theme": "pond",
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

### Locale push

From v1.3.0, with the same mechanism as the theme bridge, the App pushes the current **resolved** language code to the monitor page; the push triggers are fully shared (monitor iframe load, language switch, window focus regain, heartbeat). From the same version, the App **always** carries a `?lang=<code>` first-frame parameter on the iframe URL when loading or reloading the monitor (same semantics as `?theme=`).

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

## 12. Shutdown contract

The Project must respond to `SIGINT` and `SIGTERM`:

1. stop accepting new connections;
2. close the performer/monitor HTTP servers and Socket.IO;
3. release the Project's OSC socket;
4. release the Project's synths, groups and buffers;
5. exit.

The App's stop order:

```text
0. close the trusted HTTPS entry (when this performance ran one): stop the listener, disconnect active connections, release managed resources (#140)
1. send SIGTERM to Node and wait for graceful shutdown
2. force-kill Node on timeout
3. release the App master group
4. quit/kill the App scsynth
5. clean the child registry and session state
```

The entry closes FIRST on every stop path (Stop, Restart, project replacement, confirmed quit, and failed-start cleanup): phones see a clean disconnect instead of being routed into whatever comes next. The entry's lifecycle IS the session's — after a project replacement an old QR's gateway no longer exists, so it cannot route to the new work.

After the App exits, none of its Node or scsynth processes may remain. After a crash or force quit, the next App start must confirm ownership from recorded PIDs and command lines before best-effort orphan cleanup.

Orphan cleanup always skips children of the currently active session (decided by the process-handle PIDs held by the SessionManager): preflighting another Project mid-performance must never harm the running session, and its ownership records stay; with no active session (App start, Retry after error) cleanup behaves as before.

Any startup or runtime failure must first run the current generation's failure cleanup before surfacing `error`: stop Node, release the master group, stop scsynth, clear the process handles. When a force-kill cannot be confirmed, the child registry must keep the ownership record; on a direct Retry from `error`, the start flow runs a targeted orphan cleanup for that generation before the port preflight. Retry never calls the public stop flow used by normal sessions.

## 13. Runtime compliance verification

Verify at minimum:

- Internal, External and None health states;
- early Node/scsynth exit and health timeout;
- SIGTERM graceful shutdown and escalation to force-kill;
- no leftover processes;
- mono, stereo, 16ch and 64ch manifest boundaries;
- `audioBusChannels < 2N` rejected by preflight;
- ready with `N > H`, creating only K master instances;
- master group gain updates and release;
- monitor resize without iframe reload or Socket.IO reconnect;
- full startup of official Projects under the fixed bundled Node (`24.18.1`).

## 14. The projection-surface protocol (?surface=venue and the zoom-ownership handshake)

Since v1.5.0, two protocol legs connect the App's **projection window** and the monitor copy it loads: the URL first-frame parameter `?surface=venue` (host → page, copy identity) and the zoom-ownership handshake (page → host, capability declaration, since #135). The main window (the conductor's operating surface) **never participates** in either — it carries no parameter and the App always owns its zoom. For usage-level branching and declaration examples see the Module Manual's [Projection Surface](../modules/projection-surface.md) — this section is the protocol's normative home.

### The surface parameter (?surface=venue)

Whenever the projection window loads or reloads the monitor it carries the first-frame parameter `?surface=venue` on the iframe address **unconditionally** — the same mechanism and snapshot semantics as `?theme=`/`?lang=` (§11).

Conventions:

- The value `venue` says this copy is being loaded onto the venue screen by the projection window. It is the only value in this version, and the value set keeps room to grow — the App does not interpret the parameter's semantics, and future values stay non-breaking provided Projects honour the next item.
- Responding is **optional**: a Project that does not read the parameter (the contract already requires ignoring unknown query parameters) shows exactly what the main window shows on the projection window — "unadapted = a mirrored monitor", identical to before the parameter existed.
- A Project that does read it **must tolerate unknown values** (full ignorance included — treat an unrecognized value as if the parameter were absent); it must never error or fail to render over a value outside its known set.
- The value is snapshotted at iframe navigation: carried again on load, an address change, or an explicit ⌘⇧R reload, never re-navigated mid-session over window state; the `?_r=` reload nonce stacks as usual. The parameter may also be absent altogether (opened directly in a browser, an older App) — pages must tolerate that.
- Zoom, the theme/locale bridges (§11), the reveal gate and the reload semantics all apply to the venue copy unchanged — the origin is the same, the page needs no special cooperation.
- The intro and the projection-standby phases load no monitor page, so the parameter never appears there — `surface=venue` only ever applies to the monitor phase.

### The zoom-ownership handshake ({type:"pnds-projection", zoom:"page"})

The first page → host message (since #135): an adapted Project's monitor page may declare at load that **it owns the zoom**:

```js
window.parent.postMessage({ type: 'pnds-projection', zoom: 'page' }, '*')
```

Background: the projection window's own ⌘= zoom (the MonitorScaleFrame layout zoom) and the page's own zoom share one key — focus/menu routing decided who got it, and both firing compounded. The declaration makes the ownership deterministic. `'*'` as targetOrigin is part of the contract: the payload is a capability string, nothing sensitive, and the page cannot know its host's origin.

Conventions:

- `type` is fixed at `pnds-projection`; `zoom` takes only `'page'` in this version (declaring the zoom belongs to the page). The value set keeps room to grow; the host matches the exact `type` and `zoom` values (extra fields in the payload are ignored).
- On receipt, the App stops applying its own ⌘=/⌘-/⌘0 zoom actions to **that navigation's** monitor stage: the menu's Zoom In/Out/Reset behave as **no-ops** for the window (the menu stays enabled and still dispatches; the window simply does not apply) — the keys belong to the page, whose own zoom (cursor anchoring, density following, …) is preserved wholesale. The stage also steps the App's standing zoom aside (the scale frame falls back to 100%): the page's own zoom starts from 1× and the two systems never compound.
- **The ownership's lifetime is one navigation**: a load, an address change, or an explicit ⌘⇧R reload resets it to the default (the App owns); a re-declaration yields again — nothing carries across navigations, no configuration, no migration.
- **The default is App-owned**: an undeclared copy (an unadapted Project) behaves byte-for-byte as before the handshake existed. The intro, built-in utilities and cover phases load no monitor page and have no declaration channel — App zoom applies as ever.
- **Message validation**: the host honours only messages from **this iframe's own window** whose `type` and `zoom` match exactly; mismatched types, unknown `zoom` values, wrong sources and malformed payloads are all ignored — page content is untrusted input, and no message may make the host throw.
- The App's zoom value and its persistence (the window memory) are untouched by the yield: the remembered value waits as-is and applies again on undeclared navigations (or a reload's default period).

## 15. The full performer URL and the external entry (#138 frozen contract)

This section freezes the public contract between the local trusted HTTPS entry and the Project. The certificate material's configuration, import, validation and protected storage shipped with #139, and the entry itself (TLS gateway, entry state and lifecycle) shipped with #140 (operator preparation: [https.md](./https.md) — the domain and port are ordinary preference fields, while the certificate chain and private key live only in a backend file with restricted permissions, never in the preferences round-trip, the project, the manifest, the `.pnds` bundle or the logs). What is frozen here is the naming, tolerance, priority and the obligations on both sides. The PNDS Template is already adapted to this contract (see its docs/implementation.md, section「完整 performer URL」); unadapted works are unaffected.

### The variable and the capability declaration

- the startup variable `PNDS_PERFORMER_URL` (§3): the full performer root URL injected while the entry is in effect — protocol, domain and actual port included;
- the capability declaration `scoreServer.supportsPerformerUrl: true` ([manifest.md](./manifest.md)): the work promises to read that full URL, to build its QR and connection config from it, and to load page scripts and real-time connections under that origin; absent = an unadapted legacy work, and the entry must not silently apply to it (#140's shipped behavior: a prominent notice in the settings card plus a confirm dialog before start — the operator explicitly chooses「Start with HTTP」to proceed, and canceling touches nothing);
- priority: when `PNDS_PERFORMER_URL` is provided, every outward-facing address of the Project uses that full URL; when it is absent, `http://<PNDS_HOST_IP>:<performerPort>/` continues to apply (today's behavior) — no forced migration of old manifests.

### Project identity and the entry access context

- the external entry is bound to the **current performance's project identity**: the `manifest.id` plus that session. The URL the entry publishes and its access context (the page the entry serves, the `projectId` / `performerUrl` / page role injected via `__config.js`) all derive from the current project — the App's gateway uses this to **reject old entries that do not match the current project** — the outcome requirement is frozen: after a replacement, an old QR must never route to the new work. #140 implements it structurally: the entry's lifecycle IS the session's — a replacement closes the old listener before opening the new one, so an old QR's gateway no longer exists;
- project identity is **not** seat identity: claim tokens, seats and restoration semantics remain entirely the Project's (module manual: [Performer identity and seats](../modules/players.md)); this contract redefines none of them and interprets no artistic events;
- the page role is injected by the server (`__config.js`'s `role` field) and **must not be inferred from the shared external port**: the entry's port is unrelated to the manifest ports, so a browser-side port comparison is unreliable under the entry;
- the monitor page keeps its **internal connection**: it reaches the performer service cross-port via the original internal address, never through the external entry, and no public management entry is added.

### Claim tokens and origins

- the claim token lives in the browser's localStorage, **scoped per origin**: a reconnect on the same HTTPS origin reuses the token and restores the seat as always — zero changes to the Project's existing logic;
- a change of protocol, domain or port means a different origin: neither the App nor the Project **promises cross-origin migration** of old tokens. The device joins anew under the new origin (fresh token, fresh seat); the server's old seat records remain and the operator can clear them via the monitor's reset control. A plain HTTP → HTTPS switch changes the origin the same way — the entry's preparation notes must tell operators this explicitly.
