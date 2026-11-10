# Runtime Contract

This section defines the protocol between PNDS App and a score Project over one running session: launch parameters, environment variables, HTTP/health, the audio bus, process ownership and shutdown semantics. It does not prescribe the work's own Socket.IO or OSC business protocol.

## 1. Participants and ownership

**monitor** is the project's monitoring/conductor page embedded by the main App window; projection and other copies retain that role. **performer** is the participation page opened on phones, tablets or independent test windows, exchanging performance data through the project server. The project defines interaction and musical meaning; the App supplies runtime and display infrastructure. A test window is neither an audio engine nor proof of real phone capabilities.

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
- runtime and App upgrades do not modify the Project directory or manifest; explicit creation-mode App shared package adoption saves atomically under draft, identity and disk-version guards;
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

App shared packages (explicit schema-2 references):

```text
PNDS_SHARED_LIBRARIES={"p5":{"version":"2.3.4","kind":"browser","path":"<verified absolute local entry>"}}
```

- JSON contains only this project's declared, exact-version and integrity-checked references. With no references, the inherited variable is removed;
- `kind` is `browser` or `node`; optional `browserPath` supplies an additional browser entry from the same version;
- paths are for the local Node server. Browser libraries are served by the project's own HTTP server at fixed relative routes; monitor, performer and phones load same-origin URLs, including through the trusted HTTPS entry;
- authors explicitly load Node entries by absolute path (ESM uses `pathToFileURL`), without system Node, maintainer `node_modules` or runtime npm;
- missing, damaged or mismatched resources fail before start. The App never wires sources automatically, changes references at upgrade, or adds models to shared resources.

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

- **Ordinary projects default to HTTP.** The App injects it only while the local trusted HTTPS entry is in effect: the project explicitly declares both `scoreServer.needsHttps: true` and `scoreServer.supportsPerformerUrl: true`, the global HTTPS switch is on, the domain/port are configured, and certificate material revalidates at that moment (field semantics: [manifest.md](./manifest.md)). `supportsPerformerUrl` is compatibility only; phones, QR codes and ordinary touch do not activate HTTPS. Without the need, or with the switch off, there is no injection and HTTP remains. With need and adaptation declared, an enabled switch and incomplete/invalid settings fail startup clearly, without silent fallback; need without adaptation retains the explicit HTTP compatibility confirmation;
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

Legacy Projects without runtime-port capability must listen on both manifest TCP ports:

```text
performerPort  → performer server
monitorPort    → monitor server
```

For legacy Projects, the App confirms both ports are available before starting. On conflict it fails — it picks no substitute port and touches no manifest. A port counts as available when it is held only by the active session's own child processes (released when the session stops; the check matches occupying PIDs against the active session's child PIDs); a port held by any third-party process still fails as a conflict.

### Runtime ports v1

Projects explicitly declaring `scoreServer.runtimePorts: 1` adopt App-owned listeners. The App inspects preferred numbers across addresses, then performs real binds; known occupancy or a bind conflict requests an OS-assigned alternative. It checks ownership while holding each actual listener, closing only its own listener for bounded reallocation if a foreign explicit bind won the gap. Both listeners remain continuously held, avoiding the probe/release/bind race. Resource exhaustion or a bind failure drops the partial allocation and fails visibly. Ports never migrate during a published run.

The child receives UTF-8 JSON in `PNDS_RUNTIME_PORTS`:

```json
{
  "version": 1,
  "runId": "fresh-opaque-run-identity",
  "reportPath": "/opaque-private-startup-path/bound.json",
  "services": [
    { "role": "performer", "port": 51001, "fd": 12 },
    { "role": "monitor", "port": 51002, "fd": 13 }
  ]
}
```

Paths, descriptors and ports are per-start values, never constants. CLOEXEC is cleared only in this child. Each role adopts its existing listener with `server.listen({fd})`: no rebinding, scanning, or inferring roles from an external browser port. Spawn, child ownership and parent-listener release share the lifecycle lock. Stop/failure owns the child and any untransferred listeners.

After both listen callbacks, the Project writes a temporary file in the report directory and atomically renames it to `reportPath`:

```json
{
  "version": 1,
  "runId": "fresh-opaque-run-identity",
  "status": "bound",
  "services": [
    { "role": "performer", "port": 51001 },
    { "role": "monitor", "port": 51002 }
  ]
}
```

Failure reports keep `version` and `runId`, use `status: "error"`, `services: []`, and a readable `error`. This temporary channel is not a project file and must not enter Git or `.pnds`. Reports are limited to 4096 bytes. Unsupported versions, wrong ownership/roles/ports, missing services, explicit failure, invalid files or early exit fail with cleanup; a missing report has a bounded startup deadline. Before the first health request, the App verifies the report and the actual child's ownership of both listeners. A successful report alone never proves readiness.

Health `scoreServer` must include actual `performerPort` / `monitorPort` and `runtimeRunId: runId`; project identity, audio mode, target and readiness still match this start. Health, monitor, gateway upstreams, HTTP performer URLs, QR, snapshots and port diagnostics share the actual allocation. Manifest values remain next-start preferences. Configured trusted HTTPS stays fixed and never silently changes port or downgrades.

Minimal Node wiring reads the assignment, selects servers by `role`, uses `service.port` in configuration/health, adopts each listener via `listen({fd: service.fd})`, then atomically reports after both callbacks. An absent environment variable keeps the standalone/legacy fixed-port path. `supportsPerformerUrl`, participant-roster and media capabilities remain independent declarations.

The separate LAN Client entry first reuses its durable last actual port, allocating an alternative only on conflict and publishing the complete bound address. It verifies confirmed-context health forwarding before joining is offered and is independently supervised afterward. Optional snapshot `clientEntryError` reports an entry fault: forwarding and active HTTP/WS connections close, the address remains diagnostic, and the ready local project/audio continue. There is no port migration or hot recovery; explicit stop/restart restores the entry. Stop revokes project forwarding first, while an online independent control entry may continue reporting `performance: null`.

LAN address rules:

- the App enumerates usable non-loopback IPv4 addresses, excluding recognized VPN tunnel interfaces (such as macOS `utun`); private IP ranges and the default route do not identify the venue network;
- a still-available choice survives opening, switching and stopping Projects; running-session snapshots do not overwrite the next-start choice. A sole address is selected automatically; several addresses without a valid choice require the user to pick explicitly;
- the choice lasts for the current App run and never changes macOS network settings, router DHCP or Project manifests;
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
- fixed-path payload ports match the manifest; runtime-port v1 ports match the actual App allocation and echo this start’s `runtimeRunId`;
- the App must not depend on Project extension fields like `score`, `performers` or `sessionId`;
- the App's HTTP health reads have a 256 KiB response-body limit, disable redirects and environment proxies, and connect directly to loopback; exceeding the limit or returning a redirect counts as a failed read;
- during startup, health timeout, invalid JSON, early process exit, or an explicit error all fail the session.

### Runtime supervision

After a local session reaches `ready`, the App continues reading health from its actual performer port every 3 seconds. Internal sessions also request OSC `/status` from this run's App-managed scsynth every 5 seconds. Probes reuse the existing runtime supervisor, HTTP Agent and UDP socket, run serially, and have bounded individual deadlines. Normal checks produce no UI events or logs. Each failure episode records its first failure and recovery once; entering the warning on the third consecutive failure and recovering from it produce state-change notifications, without repeating events or logs on every failure. Replies arriving after stop/restart cannot affect a new session.

The App first verifies `projectId`, `audioMode`, actual performer / monitor ports, the applicable `runtimeRunId`, and OSC target. For a response matching this identity and configuration, `status: "error"`, `audio.status: "error"`, or a non-null `audio.error` / `scoreServer.error` immediately fails the current session. The original failure payload and observation time remain diagnostic evidence; the existing shutdown path completes before the error page offers manual Retry. The App does not automatically restart audio or the Project.

Runtime health timeouts/unreachability, malformed responses, identity or configuration mismatches, and non-ready states without an explicit error count as consecutive failures. Missing valid Internal `/status` replies are counted separately. Three consecutive failures keep a warning visible for that channel without stopping a session that may still be producing sound; a valid successful reply clears that channel's failure count and warning. An actual Node or managed scsynth exit still follows the existing process-failure path.

External checks only Project health and never probes the user's external audio server; None sends no OSC; a Client without a local Project process performs neither probe. HTTPS, Client-entry and DNS errors remain independent. Successful health and `/status` replies do not prove master-node survival, signal level or audible speaker output.

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

`-H` is always passed (issue #100): every session spawn carries the output device name resolved for that run, using the saved preference or its resolved system-default fallback. scsynth's own default-device resolution path hits an ObjC runtime race on macOS 26 (#99 field data: 47% per-spawn crash without `-H`, 0% with an explicit name), so that path is never taken. A device vanishing between resolution and spawn makes scsynth print its error and exit cleanly (exit code, no signal) — no retry, straight to the error page with the output in the session log, no silent fallback. Since #258, App startup, role selection and Client participation do not launch scsynth. Only an explicitly requested local Internal run starts it, retaining the cold-start settling delay and transient-crash retry policy.

`-S` takes the App's **effective sample rate**: the App's global sample-rate preference, `48000` when unset. The manifest no longer declares sampleRate (removed from the schema's active surface); a leftover `audio.scsynth.sampleRate` in an old manifest is read and ignored — it takes no part in startup, is never rewritten, and never fails validation. H in §7.1 and the device-capability check in §7.6 likewise use the effective sample rate.

Sample rate and output device are App-global preferences resolved and applied at the next start; a live session keeps its startup audio configuration. Sample-rate options are the union of enumerated standard rates (`44100 / 48000 / 88200 / 96000`), falling back to that fixed list on enumeration failure. Devices enumerate at the effective rate with channel loss marked under §7.6. UI entry points belong to [Audio and communication settings](../app-tutorial.md#3-audio-and-communication-settings).

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
2. preflight: manifest, paths, exact shared resources, dependencies, ports, modes, bus capacity
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

**Right-click belongs to the page author**: the App suppresses WKWebView's native web menu (Reload, Open Frame in New Window, Back, …; editable fields keep the system copy/paste menu). The suppression only calls `preventDefault()` and never stops propagation — a Project's own context menu, built by listening for `contextmenu` in its monitor page, coexists with it naturally, and the App needs (and offers) no wiring for it. Right-click in the App's own UI (the sidebar, …) belongs to the App's designed menus; performer pages on devices own their right clicks. Creation test windows retain native menu suppression while preserving the page's own contextmenu events.

The App shell does not read or call into cross-origin score-page DOM or business functions. Creation performer test windows are a narrow native-input exception: they support standard JavaScript dialogs, and an input-only WKUserScript supplies simulation only while their labelled mouse-single-touch option is enabled. It dispatches untrusted touch events and recognises native form controls; it does not inspect score state, replace page content or relay music messages. Performance/projection monitor pages do not receive this input simulation. Device browsers still provide their own real input capabilities.

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
- Performers' device browsers receive no App push and use the Project's colours. Creation performer test windows send the same optional first-frame `?theme=` and palette messages; pages may ignore them and remain unchanged.
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
- Performers' device browsers receive no App push and use the Project's language. Creation performer test windows send the same optional first-frame `?lang=` and locale messages; pages may ignore them and remain unchanged.

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

### Optional creation-preview Host origin

The main monitor may carry `pndsHostOrigin=<origin>`, the exact current Host
origin snapshotted at navigation, for a local preview adapter's postMessage
target. It may be present in performance and creation modes so switching modes
does not reload the page. It grants no preview authority: the App still checks
the same project's ready runtime, saved versions and actual loaded-byte digests.
Unwired projects ignore it and independent browser pages tolerate its absence.
The adapter negotiates on the `pnds.preview` version-1 channel through
project-owned parameter callbacks. Public pages,
scripts and styles should read saved files per request with correct MIME and
cache policy. A page `_r` cannot update bytes cached at Node startup or a cached
script response.

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
- the capability declaration `scoreServer.supportsPerformerUrl: true` ([manifest.md](./manifest.md)): the work promises to read that full URL, to build its QR and connection config from it, and to load page scripts and real-time connections under that origin. This capability alone never enables HTTPS;
- the need declaration `scoreServer.needsHttps: true`: declare it only when the work actually uses APIs requiring a secure context. It combines with adaptation, the global switch and valid material to select HTTPS; ordinary projects use HTTP. Need without adaptation and with the switch on shows the notice and requires an explicit “Start with HTTP” choice; cancel leaves the performance unchanged;
- priority: the Host selects one performer URL for the performance. When `PNDS_PERFORMER_URL` is provided, every outward-facing address uses it exactly; when absent, use `http://<PNDS_HOST_IP>:<performerPort>/`. QR, copied address and browser config share that resolution; page scripts and Socket.IO use the performer page's current origin. Projects neither prefer HTTPS themselves nor replace an injected URL with a LAN address.

### Project identity and the entry access context

- the external entry is bound to the **current performance's project identity**: the `manifest.id` plus that session. The URL the entry publishes and its access context (the page the entry serves, the `projectId` / `performerUrl` / page role injected via `__config.js`) all derive from the current project — the App's gateway uses this to **reject old entries that do not match the current project** — the outcome requirement is frozen: after a replacement, an old QR must never route to the new work. #140 implements it structurally: the entry's lifecycle IS the session's — a replacement closes the old listener before opening the new one, so an old QR's gateway no longer exists;
- project identity is **not** seat identity: claim tokens, seats and restoration semantics remain entirely the Project's (module manual: [Performer identity and seats](../modules/players.md)); this contract redefines none of them and interprets no artistic events;
- the page role is injected by the server (`__config.js`'s `role` field) and **must not be inferred from the shared external port**: the entry's port is unrelated to the manifest ports, so a browser-side port comparison is unreliable under the entry;
- the monitor page keeps its **internal connection**: it reaches the performer service cross-port via the original internal address, never through the external entry, and no public management entry is added.

### Claim tokens and origins

- the claim token lives in the browser's localStorage, **scoped per origin**: a reconnect on the same HTTPS origin reuses the token and restores the seat as always — zero changes to the Project's existing logic;
- a change of protocol, domain or port means a different origin: neither the App nor the Project **promises cross-origin migration** of old tokens. The device joins anew under the new origin (fresh token, fresh seat); the server's old seat records remain and the operator can clear them via the monitor's reset control. A plain HTTP → HTTPS switch changes the origin the same way — the entry's preparation notes must tell operators this explicitly.

### Faults, retries and isolation (frozen by #141)

- **a start failure is a failure**: when the entry cannot bind (port occupied — the error names the listen address), the material no longer validates, or the gateway cannot be created, the start fails — never a silent HTTP fallback. Cleanup belongs to the same generation as the start: the listener is owned by the session from the moment it binds, so any later failure runs the same teardown sequence (listener, active connections, managed resources, the performance DNS mapping) before the error snapshot is published — a Retry inherits no stale listener, connection or mapping, and no resource is created twice;
- **a runtime fault is the entry's own fact**: a dead listener or a probe that misses its deadline (10 s after the project reaches ready) turns the entry to `error` and keeps its URL; local audio, the project's servers and the hub injection are unaffected, and the entry's published address never falls back to HTTP. Recovery is the operator's explicit restart of the performance — the Host implements no hot recovery and never auto-retries the probe;
- **restart keeps the origin**: an ordinary restart reuses the domain and port fixed at start — the origin is unchanged and claim tokens keep their existing restoration semantics; domain / port / certificate changes made while running apply at the next start;
- **isolation**: every path that ends the performance (Stop / Restart / project replacement / confirmed exit / mode switches / start-failure cleanup / App exit) runs the same teardown sequence; a stale generation's late results (probe success or failure, fault and lease reports) are rejected by the generation check and cannot change the new performance's state — the entry an old QR rode closed with the old performance and does not route into the replaced work (§16's background ordinary forwarding is untouched by performance cleanup).

## 16. Performance DNS and the background daemon (#174)

The background LAN DNS service (daemon `dnsd`) ships inside the App bundle and is system-managed as a LaunchDaemon through SMAppService: the operator approves once in Settings, it relaunches on login/reboot, and ordinary domains keep forwarding to independent upstreams **without the App being alive**. The performance-domain mapping is held under lease by the current session. This section freezes the mapping's activation gate, lifecycle and both sides' obligations; the operator flow lives in [dns.md](./dns.md).

### Mapping lifecycle

- **Activation gate** (all three, or nothing is installed): the DNS service switch is on (App preference) × this start actually opened the trusted-HTTPS entry (§15 `resolve_entry_launch` = `Ok(Some)`, i.e. operator switch × project declaration × launch-ready material) × the entry domain resolves;
- **Install and verify**: after the entry gateway binds and BEFORE the entry is published, the App hands the mapping (domain × this start's selected LAN address × session generation) to the daemon, which **verifies it against its own real query pipeline** (an A query for the domain must resolve to that address) before it counts. Install or verify failure surfaces only as `dnsMapping: error` on the snapshot and **never fails the session** (the entry is an independent fact; the mapping is an independent fact above it);
- **Failure cleanup**: an install or verify failure immediately attempts to revoke this performance's mapping; a lost install reply is treated as a potentially accepted install. Unconfirmed revocation retains the cleanup obligation for normal shutdown to retry, with lease expiry as the final backstop. An old holder's cleanup must never revoke a newer performance's mapping. A revoked generation of the same run cannot install again; a new performance uses a new generation;
- **Lease**: the mapping is held on a 60-second lease renewed every 20 seconds by the session's lease supervisor. Stop / Restart / replace / mode switch / normal exit revoke the mapping **right after the entry closes** in the shutdown order (holding run id + generation); an App crash leaves the lease to expire — no path leaves the old address to the next performance;
- **Known domains never forward**: the daemon persists the set of domains ever installed as performance mappings. With no active mapping, queries for them are answered NXDOMAIN locally — never the stale LAN address, never forwarding to the public old entry (a phone between performances must not reach a public stale entry);
- **Ordinary forwarding**: non-performance domains forward to the upstreams in order (the App's built-in default public resolvers, no editor UI; the control-plane `config.set` seam still accepts IP upstream lists), with a 2 s per-upstream timeout and a 6 s whole-query failover budget; the cache is hard-bounded (positive ≤300 s, negative ≤10 s, 512 entries) and performance switches never clear ordinary cache;
- **Port and privilege**: the daemon binds UDP/TCP 53 as root on **the operator's chosen fixed physical LAN address** (falling back to all interfaces — stated in status — when unset or stale); a bind failure (an existing DNS service) does not kill the daemon — the control plane keeps answering and reports it in status `bindError`, which the App's enable flow turns into the definite "stop the occupant and retry" result. The App never preempts or kills existing services, and the main App never elevates;
- **Control plane**: App ↔ daemon traffic is line-JSON over a fixed-path Unix socket with exactly seven verbs — `mapping.set / mapping.refresh / mapping.clear / config.set / verify / status / stop`; mutating ops authenticate the peer uid (root or console user). The daemon never executes project scripts, shells, or holds any credential.

### Network boundary and scope of promises

- Everyday forwarding is available only while **this Mac is on, awake, online and the service healthy**; venue DNS during Mac shutdown/sleep/offline is out of scope, and the router-DNS restore steps belong to the operator doc (dns.md);
- DNS and HTTPS are two facts: a live mapping proves only "the domain resolves to this Mac", never that the entry is usable (§15's entry probe and the performers' device acceptance are their own checks);
- Address selection follows §4: the mapping uses the address the operator explicitly picked in「Node」; VPN tunnel interfaces never participate, the App never guesses from the default route or the first address, and macOS network settings, router DHCP and project manifests are never modified.

## Optional temporary parameter preview (protocol 1)

Preview adaptation is explicit and optional. Root `pnds.preview.json` declares
`schemaVersion: 1` and a `parameters` array. Each entry names an existing relative
text `path`, unique `id`, exact whole-line `prefix` and `suffix` around a JSON
primitive literal, `kind` (number, boolean, text, color, option), project `limits`
(min/max/step/options/maxLength as applicable), and `preview`
(live, refresh, restart, unsupported). Limits and capabilities are project facts;
a model's suggested trial range does not change them. Ambiguous anchors,
expressions, changed versions and incompatible declarations have no live binding.

An optional project-owned adapter is available at
`PNDS.app/Contents/Resources/preview/adapter.mjs`. The App does not install it.
`installPreviewAdapter({hostOrigin, sources, contractDigest, parameters})` takes
immutable SHA-256 digests of the source and declaration bytes actually loaded by
that run (`sha256:<hex>`), and declared project-owned get/set callbacks. Do not
rehash current disk during handshake and claim it was loaded. The exact Host
origin must be configured by the project author, never accepted from a message.

Both sides validate origin and exact window. Messages carry channel
`pnds.preview`, version 1, fresh session and increasing sequence. Host verbs are
hello (requested IDs), set (declared primitive values), restore. The page returns
ready (loaded digests, supported IDs and baseline values), applied/restored (actual
readback), or error. Setters are serialized; superseded queued updates are skipped.
Only touched parameters are restored. No message carries code, expressions, shell,
process controls or file writes. A live sound parameter must use already enabled
audio; adapting preview never enables sound.

Native authorization checks the trusted saved source, declaration and the same
ready runtime; the Host also checks actual loaded digests. Missing adaptation,
version mismatch, timeout, partial support and unconfirmed restoration remain
visible. Preview does not save, check, refresh, restart or reverse time and prior
effects. Source changes revoke old authority rather than applying an old baseline
over new state. A manual refresh/restart is still required to adopt saved code.

## Optional connected performer roster

Creation mode can read an optional `performers` field from the existing
`GET /__pnds/health` response. Existing health semantics are unchanged; projects
without it still run and display unknown connection status.

```json
{
  "performers": {
    "schemaVersion": 1,
    "clients": [
      {
        "id": "ephemeral-connection-id",
        "label": "Performer 3",
        "testClient": null
      },
      {
        "id": "test-connection-id",
        "label": "Performer 1",
        "testClient": "performer-00000000-0000-4000-8000-000000000001"
      }
    ]
  }
}
```

List only performers accepted by the work's join policy and still online. Exclude
monitor/observers. Remove released/disconnected connections promptly; replace old
connections on reconnect. Do not report only while touch input is active. `id` is
an ephemeral connection ID and `label` is a readable name. Never include claim
tokens, credentials, IPs, touch data or arbitrary project state. At most 128 rows
are accepted; IDs are unique, nonempty and at most 128 UTF-8 bytes, labels nonempty
and at most 160 bytes. Neither may contain control characters.

Virtual performer page URLs carry `pndsTestClient=<native window UUID label>`.
Supporting projects pass that marker in their own join payload and echo it as
`testClient`; ordinary phones/browsers use null or omit it. This is display
correlation, never identity or authorization, and changes no musical policy.
Unmatched test markers provide no native window controls. The Host does not infer
hardware type or use page loads/HTTP request counts as evidence of joining.

One read-only loop polls the ready runtime's loopback performer health endpoint
about every two seconds. Project identity, audio mode and ports are checked;
workspace and runtime generation are checked again after I/O. Responses are
bounded to 64 KiB; an invalid optional roster is ignored. A failed request clears
stale rows rather than claiming zero clients. Observation creates no players,
check pages, extra audio services or project processes.

### App-owned performer QR

The built-in QR overlay reads the current run’s selected performer URL directly from the Host. Migrated projects do not need QR routes or `qrcode` references. Existing external projects may retain custom QR implementations under the URL contract above. See [QR use and migration](../modules/qr.md).

## Optional performance recording adapter (protocol 1)

Root `pnds.recording.json` declares `{"protocolVersion":1,"adapterId":"my-score-v1"}`.
Ordinary health/performer URL support does not imply recording support. The local
performer server implements `GET/POST /__pnds/recording`; GET returns the exact
capability. Only loopback, non-browser management requests are accepted; external
entry proxies must not expose this reserved route.

POST carries a fresh `operationId` and `action`: `begin` (`record`, `playback`,
`overdub`, plus opaque initial state and independent replay performers), `poll`
(`afterSequence`), `drive` (`elapsedMs`, due events), or `end` (`afterSequence`,
`elapsedMs`, `release`). Events contain integer `atMs`, unique `sequence`, nullable
`performerId`, opaque `kind` and `payload`; null performer denotes common
conducting. Ordering is `(atMs, sequence)`. Effective repeated holds/releases and
all START/pause/seek changes are retained. Recording time never follows a score
seek backwards. Recording does not START/reset the work; stopping it leaves live
performance running. Replay restores actual composition/state, rejects live music
and manual conducting, and releases its sources at end. Overdub admits every
project-accepted live source in the pass, including sources joining after begin,
with independent recorded IDs and terminal releases. Each pass may contain one
or several performers; reusing a device or score number never merges passes.
Inherited replay is never recaptured. First-pass duration stays fixed.

The bundled `recording/adapter.cjs` helper requires project-owned musical
callbacks. Missing/incompatible adaptation leaves ordinary operation available.
`begin.mode` is one of the three modes above. Replay also carries `initialState`
and `replayPerformers` (each has `id`, `label` and `selection`). Recording and
overdub carry `livePassId`; the response must acknowledge the same `passId` to
confirm multi-source pass support. Missing acknowledgment never silently falls
back to single-source recording. The response also contains `initialState`, `performers`,
`events` and `elapsedMs`. `poll` returns the performers, elapsed time and every
event after its cursor. `drive` applies only due events, deduplicates unique
sequence IDs and never captures replay as new live input. Management commands
execute in order. Same-operation `end` is retryable; a stale operation cannot
control a later one. A lost begin response still requires acknowledged end
cleanup before App releases operation ownership.

App saves versioned records by project with initial state, provenance, passes and
their performer membership, events, fixed duration and completion status. Overdub
adds a pass; rerecord/delete replaces or removes the whole selected pass while
retaining other passes and common conducting. Initial-state restore admits only
`replayPerformers`, so removed passes cannot restore their initial held touches.
Changed content requires explicit
consent to use the current compatible project while retaining original provenance;
incompatible protocols refuse replay. Persistence syncs a temporary file, publishes
atomically and syncs the directory. Interruption preserves identifiable incomplete
data without replacing an existing complete record. Incomplete records cannot be
played or resumed. Independent recording files carry neither the project nor old
runtime permission; import still requires a compatible project.

## Browser participation protocol 1 (#295)

The public LAN URL belongs to the Host; internal performer ports remain actual
per-run assignments. `GET /` shows the Host/project/performance, or an idle waiting
page. Native metadata remains `GET /__pnds/participation` with `protocolVersion: 1`;
an adapted performance additionally advertises `browserParticipation: 1`.
Unadapted projects receive an explanation and no automatic old-address redirect.

The explicit form sends `POST /__pnds/enter/<hostId>/<projectId>/<performanceId>`.
Only an exact current compatible context returns a 303 to
`/__pnds/run/<opaque-grant>/`; stale confirmation returns 409. The grant is valid
only for that performance. Cookie changes never authorize older documents.
All page, queried assets, Worker loads/fetches, Socket.IO polling and WebSocket
requests stay under the confirmed prefix. The Host validates then strips it and
forwards to the actual performer port. Stop/replacement retires the grant and
active tunnels; retaining a local Document does not admit its network to the next
performance. Root-absolute resources or hardcoded ports require adaptation.

Load `./__pnds/context.js` before project code to obtain
`globalThis.PNDS_PARTICIPATION`: `protocolVersion`, stable `hostId` and `projectId`,
current `performanceId`, `basePath`, `storagePrefix`, `resource(relative)`,
`storageKey(key)` and `socketOptions`. Use
`io(location.origin, {...context.socketOptions})`; pass a copy because Socket.IO
mutates options. `resource()` rejects escaping the confirmed origin/prefix.
Workers resolve their imports and fetches relative to their confirmed script URL.
Confirmed native sources receive the same context with `/` as base; their private
origin, identity headers, persistent storage and media permission behavior remain.
A direct standalone Blank address has no Host context and retains ordinary use.

Long-lived browser keys use `pnds:<hostId>:<projectId>:` and exclude performance
identity. Respect project credential rejection and reset. This avoids accidental
credential mixing; it is not browser security isolation. Different origins,
addresses, browser profiles or saved-app instances do not promise data sharing or
migration. Native private-source recovery is separate.

After required page resources and initialization are usable, `reportPrepared()`
stores `preparation`, emits `pnds:prepared`, and posts the same result to a
same-origin parent: `{type:'pnds:prepared',protocolVersion:1,hostId,projectId,
performanceId,resourceScope:'page'}`. Verify all identities. Blank reports after
its real `pnds:connected` event. This reports page preparation, not complete-part
offline readiness, audio permission or participant acceptance. Resources and
scripts needed by this chain are served locally and require no WAN.

The public entry continuously discovers performances belonging to the same Host
and shows a lightweight candidate prompt. Faults, Stop and new candidates do not
reload an existing document. Entry binds to the three displayed identities;
candidate preparation failure or cancellation preserves the original instance.
The owner checks the candidate Window, report identities and latest metadata
before transferring input, replacing the document and retiring the old page.
Navigation completion does not establish preparation or project acceptance.

On a caught required-resource failure, call `reportPreparationFailed()`. It stores
`preparationFailure` and sends `pnds:preparation-failed` with the same protocol,
three identities and `resourceScope: 'page'` as the success report. Before a page
has prepared, missing scripts, fatal initialization errors and unhandled
initialization rejections report failure automatically; optional image failures
do not. A failed candidate cannot subsequently report success; Retry creates a
new candidate.

## Native Host monitor and creation performer media

The macOS App's main monitor, projection and creation performer test pages use
trusted first-party native documents for the current project. Resources, models,
Workers and connections follow managed sources. Existing monitor script and
Socket.IO paths through the project's declared performer listener retain exact
managed forwarding; arbitrary hosts or ports are not exposed. Pages receive no
Tauri or App management commands. These
native pages do not require an HTTP venue to migrate to HTTPS. Ordinary phone
and desktop browsers retain their actual secure-context and permission limits.

At document start, the App supplies a read-only hint:

```js
globalThis.PNDS_MEDIA_SURFACE
// { role: 'monitor' | 'projection' | 'performer', captureAllowed: boolean }
```

Of the two monitor copies, only the main monitor captures, analyses and
initializes models. Projection retains `surface=venue`, receives
`captureAllowed: false`, and native camera/microphone permission is denied.
The project must also skip capture and inference in that branch and subscribe
to the main monitor's results through its own communication interface. The App
does not own these results or introduce a musical message protocol. Denying
permission does not replace the project's analysis-ownership wiring. Performers,
Clients and independent test pages may manually enable their own inputs.

Each page offers manual enablement, current input choices, denial and retry.
Actual WebKit/macOS permission choices bind to the current valid page and its
source; the App never automatically grants them. Sharing one physical input
depends on the system and device. Report failure without closing or taking
another page's input. Logical claim takeover and hardware sharing are separate;
stopping media does not leave the project. Restoring a role or showing a hidden
window does not authorize new capture.

Explicit close, refresh, successful replacement and exit release that page's
media, analysis, Workers and connections. Check the page generation before
adopting asynchronous permission or analysis results; stop a late stream for an
ended page immediately. Hiding and temporary network suspension retain the
document. Reveal gates, cache refresh, parameter preview, optional theme/locale
bridges, zoom, projection staging and the [page interaction](./page-interaction.md)
contract remain. API visibility, simulated inputs and controlled images do not
establish actual capture, input selection, system sharing or first model inference.
Record these observations and outstanding real-device checks separately.
