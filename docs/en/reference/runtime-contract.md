# Runtime Contract

The App starts the project, checks health, and releases managed resources at shutdown. Projects define their performance data and sound.

## 1. Participants and ownership

**Monitor** is the project's monitoring and conducting page. The main window and projection load separate monitor instances. **Performer** is the page musicians open on a device or in a creation test window.

The App owns Node, Internal scsynth, the audio device and the master stage. The project owns its two HTTP services, performance protocol, OSC sockets and audio nodes. Each releases its own resources. Runtime operations and App updates preserve project source and manifest files.

## 2. The fixed runtime

The App runs `<bundled-node> <scoreServer.entry> --audio-mode <mode>` with bundled Node.js 24.18.1 from `<project-root>/<scoreServer.workingDirectory>`. `--audio-mode` takes precedence over `manifest.audio.defaultMode`. Projects supply their dependencies. The App skips npm installation and `package.json#engines` checks.

## 3. Environment variables the App injects

| Variable                                               | When provided and value                                                                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `PNDS_HOST_IP`                                         | All modes. The manifest's `performerAddress` or the selected LAN IPv4 by default. The monitor uses the same address.               |
| `PNDS_OSC_TARGET`                                      | A dynamic `127.0.0.1:<port>` for Internal, the user's `host:port` for External, absent in None.                                    |
| `PNDS_AUDIO_OUTPUT_BUS` / `PNDS_AUDIO_OUTPUT_CHANNELS` | Internal only. First private bus and the project's declared channel count.                                                         |
| `PNDS_SHARED_LIBRARIES`                                | Exact-version JSON for declared App shared packages.                                                                               |
| `PNDS_RUNTIME_PORTS`                                   | [Listener assignment](./runtime-ports.md) when declared by the project.                                                            |
| `PNDS_PERFORMER_URL`                                   | Full performer root URL when the [trusted HTTPS entry](./browser-participation.md#full-performer-url-and-trusted-https) is active. |

Each shared package entry is keyed by package name and supplies `version`, `kind` (`browser` or `node`), a verified absolute local `path` and optional `browserPath`. Node loads the absolute entry. ESM can use `pathToFileURL`. The project serves browser files on same-origin HTTP routes. Missing or corrupt exact versions fail startup. With no references, the App clears the inherited variable. See [shared packages](./structure.md#app-shared-packages).

For `telematic: true` with a configured App node name, hub URL and token, every audio mode receives `PNDS_NODE_ID`, `PNDS_HUB_URL`, `PNDS_HUB_TOKEN` and `PNDS_HUB_ROOM`. The four variables are supplied together. The room is `{manifest.id}_{group}` with groups 1–3, default 1, saved per project. Node and group changes apply at the next start. The token travels separately and stays out of logs. See [hub integration](../modules/hub.md).

## 4. HTTP and networking

The project provides separate performer and monitor HTTP services. Projects without `scoreServer.runtimePorts: 1` use the fixed `performerPort` and `monitorPort` in the manifest. A third-party port conflict fails startup.

### Runtime ports v1

See [listener handoff](./runtime-ports.md#runtime-ports-v1).

## 5. Health contract

The App checks the actual performer port at `GET http://127.0.0.1:<performerPort>/__pnds/health`. This example shows Internal with fixed ports.

```json
{
  "status": "ready",
  "projectId": "my-score",
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

- `status` is `starting | ready | error | stopping`. `audio.status` is `starting | ready | error | disabled`. None uses `disabled` and `target: null`. Both `error` fields accept a string or `null`.
- `projectId`, `audioMode`, OSC target and ports must match the current run. With [listener handoff](./runtime-ports.md), `scoreServer` also returns the current `runtimeRunId`.
- The App waits for `status: "ready"`. Startup timeout, invalid JSON, an explicit error or early process exit fails startup. Responses are limited to 256 KiB and redirects are rejected.
- A project may supply a [connected performer roster](./browser-participation.md#connected-performer-roster). Extension fields do not determine basic readiness.

### Runtime supervision

Once ready, the App checks project health every three seconds and Internal scsynth's OSC `/status` every five seconds. An error status, a non-null health error field from the current run or a managed process exit triggers cleanup and manual Retry. Three consecutive failed probes on either check raise a warning while the project continues. A valid reply clears that warning. External checks project health only. A successful probe does not establish audible output.

## 6. Audio modes

| Mode       | scsynth          | OSC target       | App master stage |
| ---------- | ---------------- | ---------------- | ---------------- |
| `internal` | App starts it    | Dynamic loopback | Enabled          |
| `external` | User supplies it | User specified   | Disabled         |
| `none`     | None             | Absent           | Disabled         |

Changes to mode, External target, output device and sample rate apply at the next start.

## 7. Internal multichannel audio

The project writes to private buses. The App sends the first K available channels to separate hardware buses.

### 7.1 Terminology

`N` is `audio.outputChannels` (1–64, default 2). `H` is the device's available output count at the effective sample rate. `K = min(N, H)` and the first private bus is `B = K`. Internal startup fails if output is unavailable or the App cannot determine device capacity.

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

The App sets the effective sample rate, defaulting to 48000 Hz. It ignores legacy `audio.scsynth.sampleRate`. `audio.scsynth.audioBusChannels` must be at least `2N`. `-z` sets the scsynth synthesis block size. The CoreAudio device or another app sharing it controls the device IO buffer. See [audio and communication settings](../app-tutorial.md#3-audio-and-communication-settings).

### 7.3 Bus model

Hardware buses are `0 .. K-1` and private buses are `B .. B+N-1`. The App maps private bus `B+i` to hardware bus `i` for `0 ≤ i < K`. Remaining channels are discarded. Outputs stay discrete.

### 7.4 App master stage

Create at least one project audio root group before reporting health ready. All project synths and subsequent groups descend from those groups. After health is ready, the App appends its master group to the scsynth root group so it reads after the project writes. Node IDs `2147480000..=2147483647` are reserved for the App.

### 7.5 Master gain

For `N ≤ 2`, Internal volume defaults to 80% (about −6 dB). 100% is 0 dB and 0% is mute. For `N > 2`, App gain is fixed at 100%. App volume is also disabled in External and None.

### 7.6 Devices with too few channels

Startup still works when `H < N`. The App displays `Nch → Hch` and sends only the first `H` channels to hardware. The project keeps writing all `N` channels.

### 7.7 Internal Project obligations

- Load compiled `.scsyndef` files. See [SynthDef compilation](./supercollider.md).
- Send standard OSC to `PNDS_OSC_TARGET`. Set the synth's `out` to `PNDS_AUDIO_OUTPUT_BUS` and write `PNDS_AUDIO_OUTPUT_CHANNELS` contiguous channels. Standalone runs without a bus variable can use `out = 0`.
- Follow §7.4 when creating nodes. Release project-owned groups, synths, buffers and OSC sockets at shutdown.

## 8. Internal startup sequence

The App validates the project and device, starts scsynth, and waits for `/status`. It starts Node and waits for performer health. Once health is ready it loads the monitor and builds the master stage. A successful master stage is required for the run to become ready. Startup failure cleans up managed child processes.

## 9. External and None

External needs a valid `host:port` from the App's per-project preferences. `audio.standaloneTarget` is for independent runs. None still runs the project and monitor, with `audio.status: "disabled"`.

## 10. Monitor runtime

The monitor source URL is `http://<PNDS_HOST_IP>:<monitorPort>/`. The macOS App hosts a [native page](./native-media.md). Iframe previews must allow embedding. Project pages use standard browser APIs.

Window resize and fullscreen preserve the current document and connections. Handle standard resize events to update layout, drawing buffers and coordinate mapping. Explicit Refresh replaces the document and adds `?_r=<n>`. Ignore unknown query parameters. Project HTTP responses still control resource caching.

For keyboard, context menu and touch behavior, see [page interaction](./page-interaction.md).

## 11. Theme and locale push (the theme/locale bridge)

Theme and locale following are optional. Initial URL parameters are set at navigation. Later updates use `postMessage`. Apply the latest value idempotently and tolerate missing parameters. The main monitor, projection and creation performer test pages receive these messages. Device browsers use project settings.

### Theme push

Read `?theme=<name>` for the initial value if needed. `palette` supplies the App's semantic colours.

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

See [theme following](../modules/theme-follow.md).

### Locale push

Read `?lang=<code>` for the initial value if needed. `locale` is the resolved language code, currently `en` or `zh-CN`.

```json
{
  "type": "pnds:locale",
  "version": 1,
  "locale": "zh-CN"
}
```

See [locale following](../modules/locale-follow.md).

## 12. Shutdown contract

On `SIGINT` or `SIGTERM`, the project stops accepting connections, closes HTTP, Socket.IO and OSC sockets, releases its synths, groups and buffers, and exits.

The App revokes performance forwarding and requests Node shutdown, forcing termination on timeout. It then releases its master group and stops managed scsynth. Startup and runtime failure also clean up the current run. If termination cannot be verified, the App retains ownership records and checks ownership before cleaning up remaining processes at the next start.

## 13. Runtime compliance verification

With bundled Node, check startup and health in the declared modes. For Internal, check private buses and output channels. Resize should preserve the page and connections. Shutdown should release project resources.

### Optional creation-preview Host origin

See [Preview Host origin](./parameter-preview.md#optional-creation-preview-host-origin).

## 14. The projection-surface protocol (?surface=venue and the zoom-ownership handshake)

This protocol applies to the projected monitor copy. The App owns zoom in the main window. See [projection surface](../modules/projection-surface.md).

### The surface parameter (?surface=venue)

The projection URL includes `?surface=venue` on load or refresh. Projects can use it to select a venue view. Missing or unknown values use the regular monitor view.

### The zoom-ownership handshake ({type:"pnds-projection", zoom:"page"})

```js
window.parent.postMessage({ type: 'pnds-projection', zoom: 'page' }, '*')
```

The App accepts matching declarations from the current projection page only. For that navigation the App returns zoom to 100% and the page handles zoom keys. The next navigation restores App zoom until the page declares ownership again.

## 15. The full performer URL and the external entry (#138 frozen contract)

See [Full performer URL](./browser-participation.md#full-performer-url-and-trusted-https).

### The variable and the capability declaration

See [Full performer URL](./browser-participation.md#full-performer-url-and-trusted-https).

### Project identity and the entry access context

See [Full performer URL](./browser-participation.md#full-performer-url-and-trusted-https).

### Claim tokens and origins

See [Full performer URL](./browser-participation.md#full-performer-url-and-trusted-https).

### Faults, retries and isolation (frozen by #141)

See [Full performer URL](./browser-participation.md#full-performer-url-and-trusted-https).

## 16. Performance DNS and the background daemon (#174)

See [Performance DNS](./dns.md).

### Mapping lifecycle

See [Performance DNS](./dns.md).

### Network boundary and scope of promises

See [Performance DNS](./dns.md).

## Optional temporary parameter preview (protocol 1)

See [Temporary parameter preview](./parameter-preview.md).

## Optional connected performer roster

See [Connected performer roster](./browser-participation.md#connected-performer-roster).

### App-owned performer QR

See [Connected performer roster](./browser-participation.md#connected-performer-roster).

## Optional performance recording adapter (protocol 1)

See [Performance recording and replay](./performance-recording.md).

## Browser participation protocol 1 (#295)

See [Browser participation protocol](./browser-participation.md#browser-participation-protocol-1).

## Native Host monitor and creation performer media

See [Native pages and media](./native-media.md).
