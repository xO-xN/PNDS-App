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

PNDS App starts the score server with its bundled ARM64 Node.js `24.18.1`. The App never calls a system Node and never runs npm installs.

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

Projects should treat Node 24 as the current official runtime baseline. `package.json#engines` is a hint for development tooling only; the App does not parse it yet.

## 3. Environment variables the App injects

All modes:

```text
PNDS_HOST_IP=<selected LAN IPv4>
```

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

Rules:

- Internal's target is always allocated dynamically by the App;
- the App must never use `audio.standaloneTarget`;
- the External target is a preference local to the App machine, saved per Project, never written back to the manifest;
- `PNDS_HOST_IP` must match the LAN address the App uses for the monitor;
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

The only place to change the sample-rate preference is the Audio section of the settings panel: an inline dropdown offering the union of standard sample rates supported by all enumerated output devices (the full set `44100 / 48000 / 88200 / 96000`, deduplicated ascending), falling back to the full fixed list when enumeration fails or comes back empty. While a session runs the control is disabled with a notice; changes persist immediately but take effect at the next Project start. Output device selection stays in the sidebar's settings card; the Audio section owns the sample rate only.

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
1. send SIGTERM to Node and wait for graceful shutdown
2. force-kill Node on timeout
3. release the App master group
4. quit/kill the App scsynth
5. clean the child registry and session state
```

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
- full startup of official Projects under the fixed Node `24.18.1`.
