# Performance roles and Client participation (#258)

The product decisions are in [the approved specification](../plans/v1.7.0-beta.2-performance-roles-spec.md) and [ADR-0014](../adr/0014-performance-roles.md). Creation continuation still follows [ADR-0007](../adr/0007-mode-switch-ends-performance.md).

## Confirmed v1.7.0-beta.3 design (2026-11-09)

[The v1.7.0-beta.3 specification](../plans/v1.7.0-beta.3-browser-participation-spec.md), published as [#294](https://github.com/xO-xN/PNDS-App/issues/294) with `ready-for-agent`, and [ADR-0017](../adr/0017-stable-browser-performance-entry.md) revise the intended lifecycle of loaded scores. Both browser performers and the native Client share one public URL, discover the same Host's new project and require one explicit entry action; the native view retains its private per-Host/project source. Loss of contact, an ended run or changed metadata must not destroy an already loaded score; network admission and the running document have separate ownership. A new entry confirmation never authorizes an old document to contact the replacement performance. Failed explicit project switches retain the original document instance until the replacement succeeds. The [discussion record](../plans/2026-11-09-browser-participation.md) retains source baselines and prior investigation.

Normal performance shows only project content, with no persistent Leave button or connection bar; native management remains in the App sidebar. ASBS part-resource prefetch is a companion adaptation to preserve complete local scrolling after Host loss. The public entry remains accessible while the App is in Creation or Client mode, but advertises no public performance and does not expose Creation tests. The native document and discovery revision is implemented by #300; its ownership and verification rules are described in [native-client-continuity.md](./native-client-continuity.md). Browser entry and switching are tracked separately.

The public root document declares `viewport-fit=cover`; a project's own viewport
meta cannot expand an outer Safari document that is still inset. Current,
candidate and retiring score frames keep fixed zero-inset bounds with no safe-area
padding. Only entry management content and its floating switch panel avoid the
safe area, retaining keyboard focus, browser zoom and text selection. Project
documents own their internal touch and long-press rules; entry chrome does not
apply a global gesture or selection block. See WebKit's
[edge-to-edge viewport guidance](https://webkit.org/blog/7929/designing-websites-for-iphone-x/).
The public HTTP regression verifies the delivered meta, and the owned WebKit
browser fixture measures the actual frame and child viewport. A desktop fixture
does not certify an iPhone's landscape safe area; that remains a device check.

The follow-up design also removes the Host sidebar's local-performance information card. Its public URL, copy action, QR, entry failure and applied-port diagnostics move to the bottom network control. Removing that presentation must not change listener ownership, activity admission or loaded-document lifetime, and entry faults must remain discoverable. The current `HostClientAddress` layout described below is retained as implementation history until this migration is implemented.

## Role ownership

The startup decision was revised later on 2026-11-03: the first App launch defaults to Host; later launches restore the last successfully saved Host/Client role, falling back to Host when no valid choice is saved. This restores role chrome only. It must not start a project, join a performance or enable media, and a saved role cannot authorize native activity or override retained native runtime facts.

On 2026-11-04 the user approved integrating this startup memory together with sidebar layout B. `lastPerformanceRole` is the native preference for the last explicitly chosen Host/Client role, defaulting to `host` when absent. Its writes go through the serialized queue in `src/lib/preferences.ts`; production does not read the HTML prototype's localStorage key. A successful explicit role choice calls `commitRole`: it synchronously updates the visible role and this visit's `lastRole`, then queues the preference write. Opening a menu, closing the current item, an activity refusal or a cancelled switch does not save anything. Save failure does not roll back the current UI or `lastRole`; the notification must explain that the next App launch may restore the previously saved role. Current activity, the in-memory last choice and the successfully saved preference remain separate facts.

`restoreRolePreference` consumes only the first preference hydration. It may fill the initially empty role after reading preferences, or fall back to Host when that read fails; a delayed result cannot overwrite native/current facts or an explicit choice. The initial `role: null` is a bootstrap-pending state: `AppShell` does not show the obsolete role picker while waiting. Restore neither starts nor joins a performance and never enables media.

The existing native Creation cleanup transaction remains unchanged. Only after successfully entering Creation does `resetRole` clear the current role and menu interaction; it retains this visit's `lastRole` and does not erase or rewrite `lastPerformanceRole`. After a successful return to Performance, `enterPerformance` selects that in-memory `lastRole`, including a current-session choice whose preference write failed, only when `preferencesRestored` is true. If initial preference hydration is still pending, it keeps `role: null` and waits for that first read; an early Creation round trip must not activate the placeholder Host before the saved role is known. It does not start a project, join a performance or restore media. Cancellation and failed native cleanup keep their previous ownership and mode behavior.

Host-only chrome, project shortcuts, native menu actions and start gates consult the current role; retained native Client facts take precedence when the main webview reloads. A saved role or startup default may not select Client over an already running local Host. The startup revision does not redefine the existing Creation continuation rules.

All App modes share an explicit node name. After preferences hydrate, the first-run dialog blocks the workspace until a valid name is saved through the serialized preferences queue. A saved name is restored on every launch and reused across Host, Client and Creation. Invalid drafts and failed renames in Settings keep the last saved name. The operating-system hostname is a placeholder hint only. Local projects require no hub credentials; telematic projects retain their existing additional requirements. `session-flow` waits for the node-name preference save before submitting a Host start, using the existing submit latch. Save failure cannot stop an old run or claim a successful start.

Client activity includes inspection, joining, every retained score document (including ended, changed or metadata-error states), leaving and uncertain cleanup. A prepared confirmation also holds native admission ownership until explicitly cleared. Idle role changes use a compact text dropdown and explicit role selection. The menu remains available for inspection during activity, but disables the other role and explains that the current performance must first be stopped or left. It never stops a performance to switch roles.

## Approved role presentation

Host and Client share a compact sidebar identity row with the role menu followed by the local node name. The [previous review record](../prototypes/performance-roles-1.7.1-review.md) covers the surrounding Host sidebar layout. The shared node-naming dialog handles first use for every role.

The [2026-11-12 Client review](../prototypes/pnds-client-entry.html) records the
earlier sidebar design. The current Client sidebar places the compact manual
address form below the session's node cards in the same scrollable region. The
[native Client presentation rules](./native-client-continuity.md#native-document-and-controls)
describe the bottom Host button and the new-performance reveal.

The idle Host welcome reuses `WelcomeScreen` inside `desktop-performance-main`, preserving its floating icon, three ripple rings, original first-use hints and `PreflightDock` update notice. An unnamed Host still shows this welcome while the sidebar retains the explicit naming gate; a named Host's project and folder selection continues through `ReadmePanel`. The Client welcome uses `participation-main--reading`, which reserves the sidebar through its own logical padding. The full-width Client score uses `participation-main--live`, reaching both inline edges and leaving only the 50px bottom bar.

The shared Radix dropdown owns keyboard navigation, focus restoration and its Portal menu. The current role and its chevron open the menu. Each menu item shows the role, its responsibility and a check for the current choice. Selecting the current role closes the menu. The nonpersistent `roleMenuOpen` and `roleSwitchPending` facts keep the hover sidebar present while its Portal menu or Client cleanup owns the interaction; physical keyboard focus on the role trigger also keeps the hover sidebar visible after Escape restores the trigger; repeated native facts selecting the same role preserve those facts. Switching from Client still awaits native cleanup and rechecks activity before committing. Close, blur, unmount and role reset invalidate a pending switch, so a late cleanup reply cannot restore an obsolete role choice. The existing session Enter shortcut yields to the trigger and open menu, preventing keyboard selection from starting a project. Client pages support the same Cmd sidebar peek as a running local Host.

The current role and chevron sit at the logical start of the 40px row, with the local node name immediately beside them. The role and node name use 18px type. The dropdown aligns with the start of the role trigger. The node name is read-only text with directional isolation, ellipsis and a complete title for clipped names. First-time naming and Settings provide the editing entry points.

The role trigger resets the browser's native outline so pointer-driven focus restoration leaves no black frame. The shared `pnds-focus-ring:focus-visible` rule still provides the keyboard focus outline; actual focus restoration continues to keep keyboard navigation and the hover sidebar working.

The role trigger and dropdown choices place a decorative 20px SVG before the role label. Host uses the App icon's disc and outer ring in the same blue. The ring shares the Welcome page's 4.2-second expanding fade, with a static ring when reduced motion is requested. Client uses the App icon's four dots in a diamond, following the theme text color for visibility on dark surfaces. These icons are hidden from assistive technology because the visible role labels already name each choice.

The fixed Host folder header sits between the identity row and the project scroller. It displays a decorative Folder icon and the current `folderDisplayName` in 13px/550 type at the logical start. A long name truncates within its space and retains the complete title. Home and Utilities use localized names. The project scroller contains the 57px numbered project rows and the import action for folders that allow it. Local performance entry details are available in the bottom network control.

The manual tab group sits at the logical end of the same header. It contains Home, the actual user folders and Utilities. Its width is capped so the current title and tabs share the row. Folder creation, renaming, export, deletion, ordering and persisted membership use the existing context menus and drag behavior. During a project drag, the temporary folder choices extend from the header toward the main area. Home and Utilities retain their protected behavior.

The Host project list follows horizontal two-finger movement, including in empty folders. The adjacent folder appears from the opposite edge as the current list moves. Both lists share the same horizontal offset, including while settling after release. A displacement of at least one quarter of the list width (minimum 48 px) completes the switch. A shorter swipe restores the current list and moves the preview offscreen. The header stays in place and browsing preserves membership. Folder order wraps as it does with Cmd+Left/Right, with traversal mirrored in RTL.

The main macOS window uses AppKit scroll phases to settle at finger lift and ignore momentum. Each new gesture can begin over the same area without a click. The standalone web shell settles after wheel input goes idle. Reduced motion preserves the release threshold and skips the movement. Vertical scrolling and pinch zoom keep their usual handling.

The intrinsic frame width for N tabs is `N * 16 + 28` pixels. Four tabs give 92×28px, with 4px inline padding. The viewport is transparent. Excess tabs scroll horizontally, and focused tabs scroll fully into view. The viewport reserves 4px for focus, offset by a negative block margin. Inactive and active targets are 16px and 36px wide, both 28px high. Their 6px-high markers are 6px and 26px wide with 10px stable gaps, 9px visible end space and 20px adjacent-marker displacement. The markers blend theme text colors into the sidebar surface, with the focus accent reserved for the focused marker. Width transitions use 280ms. The old and new markers get a 320ms animation with neutral endpoints and one 30% scale of `(1.025,.98)` on exit and `(1.04,.97)` on entry. Brutal and reduced-motion disable this motion.

Plain left/right and Home/End no longer move selector focus or choose a folder. The selected item remains its single Tab entry; Enter/Space and keyboard context menus remain available. Ctrl/Alt/Meta events pass to the outer owner. When the active view changes, focus follows only if the group already owns focus. Cmd+Left/Right switches the real folder view in Home → actual user folders → Utilities → Home order, wrapping in either direction. It uses the guarded web layer without a native accelerator; editable input and iframe keys keep their existing ownership. Use the existing `setActiveFolderView` selection seam: outside ready/stopping it clears the previous project selection, while ready/stopping preserves the running project's ownership. Browsing never starts or stops a performance or applies pending audio settings. This production behavior is not replaced by the prototype's memory-only filtering or earlier manual arrow navigation. Role memory, activity gates and preference serialization remain unchanged by E. The keyboard routing contract is in [keyboard-shortcuts.md](./keyboard-shortcuts.md).

The initial node-naming dialog keeps its draft on save failure. Recent Host removal uses the same queue and never leaves the current performance. Connection, project and admission labels use native facts; no sample seats or camera indicators from the HTML are presented as measured state. Unit tests certify the workflow; real-component browser comparisons with production CSS must separately check the approved hierarchy, four themes, both languages, RTL and live iframe bounds. jsdom provides no layout evidence.

## Native participation boundary

`ClientCoordinator` owns the inspected Host identity, confirmed project/performance context, operation epoch, network target and loopback proxy. Typed participation and native-presentation commands in `commands/participation.rs` are the App entry points. `ClientSnapshotEvent` is registered in `events.rs`; frontend replies and events share the native monotonic revision. Subscriptions
use `onClientSnapshot` in `events.ts`, including delayed-listener cleanup.
Native workflow failures carry a catalog code and separate optional technical
detail (`ClientError`); the UI localizes the code and puts detail behind a disclosure.
Host identity, node-name and entry startup failures also use catalog codes with
separate diagnostic text. Session command replies and native snapshots retain
those raw facts; ErrorScreen translates them through its subscribed `t` at render
time and keeps diagnostics in the existing disclosure/copy surface. This avoids
freezing an earlier language in the session store. Native node names reject empty,
over-160-byte UTF-8 and control-character values before installing an identity.

The native role admission mutex covers the Host start admission and Client inspection's initial publication. It is released before network I/O. The Client uses only the complete HTTP LAN IP address and port advertised by the App-owned Host entry. It does not guess a port from a bare IP, follow metadata redirects, resolve arbitrary network targets or start a project/audio process.

Inspection loads only bounded public metadata. Joining rechecks the same Host/project/performance before creating a page source. Every page, asset, polling request and WebSocket upgrade carries all three confirmed identity headers. The musical payload remains opaque. A changed performance is never adopted by an old confirmation.

Metadata inspection distinguishes temporary failure from a rejected response. Network errors, HTTP 408/429 and 5xx use `participation.errors.unavailable`; an already open score retains the same page and proxy while disconnected and can recover only when the same context is verified. Other non-200 statuses, malformed JSON, a missing/invalid version or invalid v1 fields use `participation.errors.invalidMetadata`. Only an explicit unsupported numeric `protocolVersion` uses `participation.errors.incompatible`; inspect that version before decoding v1 fields so a future schema is not misreported as corrupt v1 data. Metadata remains bounded to 64 KiB. Technical details retain the HTTP status/path, JSON error category/location or invalid field name without copying response bodies or field values. The two languages keep those diagnostics in the existing closed disclosure and Retry performs inspection, never automatic joining.

Polling retains the loaded document and its source across unavailability, rejected metadata, verified Stop and candidate changes. Network admission is suspended and active HTTP/WebSocket connections are closed independently from the bound source and native document. Only an exact match for the separately stored confirmed Host/project/performance can resume after a transient or metadata failure; a verified Stop/change permanently retires that authorization. Discovery continues and publishes the latest candidate without loading or joining it. The original Host identity remains pinned when an address advertises another Host. Explicit Leave and deliberate two-click Refresh retain their cleanup ownership; automatic discovery never invokes either. See [native-client-continuity.md](./native-client-continuity.md). Optional acceptance feedback is not inferred from page load: the current Host protocol omits a correlatable participant roster, so the sidebar reports “score opened / connection status not provided.”

Refresh is one operation epoch across old-source release, metadata recheck and source recreation. Cancellation during any asynchronous part prevents recreation. Shutdown waits for the private proxy runtime to acknowledge destruction. A timeout retains the proxy and a `cleanupFailed` fact; role changes stay locked and Leave retries cleanup. Polling cannot turn an uncertain cleanup back into Open. The frontend also fences
page-bearing event/poll facts while an explicit Leave or Refresh intent is pending:
an older native Open may have a newer revision than the last rendered fact, so
revision comparison alone cannot authorize remounting the retired page. Only the
owned final command reply can publish a refreshed page. A new main WebView still
restores native facts normally.

## Host entry and confirmed contexts

`SessionManager` owns a separate plain HTTP LAN participation entry. It reuses
its durable preferred port when available, otherwise binds an actual alternative
without stopping the other listener (see [port ownership](./ports.md)).
`SessionSnapshot.clientEntryUrl` publishes the actual bound
address. Phone performer URLs, HTTPS gateways and monitor routes retain their
existing responsibilities. The listener survives a stopped run so
`GET /__pnds/participation` can report an online Host with `performance: null`.
No project path, log or administrative snapshot is exposed.

The entry health probe first reads the public `/__pnds/participation` route,
using the same bounded parser as a remote Client. It verifies the advertised
Host, project and performance before checking the context-gated health route.
Both requests bypass system proxies and refuse redirects. The public listener
reserves bounded capacity for connections from the Host's own address.
During a run, one transient probe failure keeps forwarding active. Three
consecutive transient failures, a listener failure or an invalid or mismatched
response suspend the entry and publish the failure details while the local
performance continues. Explicit Stop and restart recover a suspended entry.
See [run verification ownership](./stable-performance-entry.md#run-verification-ownership).

The Host ID is a saved random identity, independent of node name or IP. Project
identity hashes the Host ID, canonical directory and physical filesystem
identity; equal manifest IDs and replacement copies do not share admission.
Each ready run gets a new random performance ID. A saved node-name change
updates metadata on the same listener when the LAN interface is unchanged.

The Host checks `X-PNDS-Host-Id`, `X-PNDS-Project-Id` and
`X-PNDS-Performance-Id` before any project page/resource/polling/upgrade request.
Stop and replacement revoke the context and destroy the old forwarding runtime,
including upgraded tunnels, before the score-server port can be reused. The
shared forwarding implementation denies the reserved recording-management
namespace; a remote Client cannot gain Host access merely because the proxy's
upstream connection is loopback.

Application startup and role selection do not prewarm scsynth. Only explicit
local Internal runs boot it, with the existing CoreAudio settling delay and
transient-crash retries. None, External and Client participation launch no
App-managed audio engine. Device inspection remains read-only.

## Stable isolated page sources

The proxy listens only on `127.0.0.1`. Its browser URL uses `pnds-<first 32 hex characters of SHA-256(hostId + newline + projectId)>.localhost` and a durable per-pair port. This derivation and `client-origins.json` are recovery interfaces. The hostname isolates ordinary host-only cookies; the full origin isolates localStorage/IndexedDB. Distinct Host/project pairs never intentionally share an origin. Project/Host identity fields reject control characters before deriving this key.

Host identity installation stages and syncs the complete random ID, installs it
without replacing a concurrent writer, then syncs the directory. First use records
the bound Client port atomically in App data and syncs its parent directory before
publishing a usable page. Rejoining the same pair after App restart or Host address/entry-port changes reuses its browser origin. If the remembered port is occupied, the loopback transport binds another actual port, while the native child's creation-time proxy configuration preserves the saved virtual browser origin. The map stores no musical state or old permission to enter a new performance. A pass query parameter changes on every join or explicit refresh without changing the storage origin.

The native first-party page receives project scripts, same-origin storage, forms and requested media permissions. It receives no Tauri management capability. Response policy confines connections, scripts, models, Workers and forms to the managed origin (plus required blob/data execution); cross-origin redirects are refused. Actual incompatible projects need adaptation; capability declarations alone are not media or model evidence.

## Native Client score view (#259)

The Client score is a child WKWebView in the existing main window. Its document
is first-party: a cross-origin iframe beneath the custom `tauri://` shell was
observed to lose third-party localStorage across native process recreation.
The child instead navigates the stable per-Host/project URL and routes HTTP,
polling, Workers and WebSocket upgrades through its actual loopback proxy.
Creation-time `_WKWebsiteDataStoreConfiguration` uses an isolated persistent
storage directory and PAC configuration. The [Safari 16.6-era WebKit source](https://github.com/WebKit/WebKit/blob/WebKit-7615.3.12.11.2/Source/WebKit/UIProcess/API/Cocoa/_WKWebsiteDataStoreConfiguration.h)
declares the used path setters, `proxyConfiguration` (10.15.4) and
`generalStorageDirectory` (13.0); the same release declares
[`_initWithConfiguration:` and `_closeDatabases:`](https://github.com/WebKit/WebKit/blob/WebKit-7615.3.12.11.2/Source/WebKit/UIProcess/API/Cocoa/WKWebsiteDataStorePrivate.h)
for 10.13 and 13.0. This avoids the public macOS 14 data-store/proxy APIs. Availability guards and
baseline native acceptance remain required.

The native presentation is a raw `WKWebView` sibling in the main content view,
outside Tauri's webview registry. Tauri 2.11 classifies a registered multi-webview
window as no longer a `WebviewWindow`, which would invalidate existing main
lookups and injected commands. The raw child leaves that manager unchanged and
receives no Tauri bootstrap or IPC capability. Its separate NSObject delegate
checks the exact native view, current join and origin for navigation, denies
popups, provides file selection and localized standard JavaScript dialogs, and
uses WebKit's real media prompt before OS authorization. Shared performer dialog
callbacks are reused without the performer touch script or Wry delegate layout.
Hiding transfers a guest-owned first responder back to the main WK host. Only
initial creation focuses the score; later resize/show keeps host focus intact.

`ClientScoreView` measures the full-width host placeholder and sends the expected
page URL, monotonic presentation request and bounds through the typed command.
Safe-integer absolute performance microseconds keep requests ordered across a
main-page reload. The supplied CSS viewport dimensions map bounds to AppKit
points and the child's public `pageZoom` under host zoom; the pointer-edge
tolerance uses the same ratio to retain its 14 CSS-pixel target. The native owner
rechecks its current join epoch before
acting. Old bounds or
hide requests cannot alter a newer page. A sidebar, Settings, menu or modal hides
the native view while retaining its page; connection facts and deliberate Leave/Refresh actions remain in the App sidebar; the normal score has no persistent connection note or Leave bar. Native Command-modifier and edge
input feed the existing sidebar controls, without giving score JavaScript an
App command bridge. Native cleanup retains the data store and closes the score
document before waiting for the official WebKit C API
`WKWebsiteDataStoreSyncLocalStorage` completion. Proxy listeners and upgraded
connections are released even when storage cleanup fails; cleanup-failed
ownership remains until both results are confirmed. A failed sync keeps the
retained pending store for a later retry even after the view is gone.
`_closeDatabases:` closes WebKit statistics databases and
is insufficient as localStorage durability evidence: the same-process fixture
failed until the actual DOM-storage sync was added. The continuous-writer fixture
checks that its final acknowledged write survives and that document timers stop
before the final persistence barrier.

`npm run native:client:verify` compiles a disposable Cocoa/WebKit fixture with
deployment target 13.5, starts only fixture-owned loopback listeners, then uses
separate native processes to write and recover localStorage, IndexedDB and a
persistent cookie. The virtual browser port stays occupied by an unrelated
fixture listener while the actual proxy changes ports. HTML, queried polling,
Worker loading and real WebSocket echo must reach the proper proxy; another
Host/project origin must have no old data. Each page must expose
`navigator.mediaDevices` and `getUserMedia` in its first-party secure context;
the fixture checks API availability without requesting devices or permissions.
Bounded process output, source SHA-256,
request observations and success/failure are saved in its temporary evidence
directory. A same-process cycle also destroys and recreates the native view and
data store at the same persistent directory while changing its proxy port. This is native WebKit mechanism evidence on the executing OS,
not a complete signed-App, macOS 13.5, device-media or dual-machine result.

## Lifecycle and native permissions

Leaving clears the page and proxy while preserving the Client role and the current launch's node directory. Entering Creation awaits Client cleanup and opens the local Creation home, ignoring a previously selected Host card. Hiding/minimizing the main window does not leave. Both the explicit Quit command and native ExitRequested fallback await the same
recording/Client cleanup barrier. Leaving or CleanupFailed defers exit, resets the
quitting marker, retains native cleanup ownership and shows participation-specific
localized feedback. A later Leave/Quit can retry. Actual App exit uses the same
native cleanup path. Host and Creation performer test windows retain their existing ownership.

macOS permission descriptions come from `native.*Usage` keys in the two locale JSON catalogs. `build.rs` verifies bundled `en.lproj` and `zh-Hans.lproj/InfoPlist.strings` against those catalogs. Both architectures map them to the standard bundle Resources directories. System prompts follow the macOS preferred language; the App's own language selector does not change the OS permission dialog. Usage descriptions, WebView permission handling, system authorization, actual capture and model readiness are separate facts.

## Evidence

The subsequent marker-focus, Command-arrow folder switching and heading-icon refinement passed the final `npm run check:all` and `npm run build`, both with exit 0: frontend results were 296 passed/1 skipped files and 3,467 passed/2 skipped tests; App Rust reported 868 passed/10 ignored, with the remaining workspace checks passing. The folder-marker exception replaces the obsolete all-tabs-must-have-a-ring assertion; ordinary-button ring checks remain. At 1280×720, the static real-component browser kept Home focused/selected after plain Right, switched actual views and synchronized focus through Cmd+Right's complete cycle and Cmd+Left's Home-to-Utilities wrap, without an extra Enter. Four themes, Chinese/English and RTL were checked, including Brutal with no outline/shadow; the frame stayed 92px wide, heading height 20px and decorative aria-hidden icon 14px. This does not certify native/WKWebView key delivery. The E integration evidence below predates this refinement.

The user-approved final E integration passed `npm run check:all` and `npm run build`, both with exit 0. Frontend results were 295 passed/1 skipped files and 3,442 passed/2 skipped tests; App Rust reported 868 passed/10 ignored, with the remaining workspace checks passing. A static 1280×720 real-component harness with production CSS verified 18px/600 role text, 26px line height, a 40px trigger and read-only 18px/300 node text; the identity header is 47px high. Four tabs occupy 92×28px with a 22px visual background, 16/36px targets and 6/26px markers; the fixed bottom region is 56px high. Initial markers have no animation. A single intermediate sample confirmed width interpolation and the 320ms micro-stretch, without measuring the full motion or its peak.

The browser comparison covered four themes, Chinese/English, RTL and long names. With 24 tabs, the root/viewport stayed 286px wide while scroll content was 420px; End moved focus to Utilities without selecting it, scrolled horizontally and kept the focus ring fully visible. Actual context menus and focus restoration were also checked. A 36-card list and expanded running connection details preserved the fixed header/bottom; Client and unnamed Host reused the 18px identity without changing their workflows. Brutal's disabled marker animation was measured in the browser; reduced-motion coverage was checked in CSS, without simulating a real system preference. This is synthetic-state/command-stub browser evidence, not native window, restart, network or media acceptance. Earlier E prototype and C/B checks below remain historical; detailed current measurements are in [the review record](../prototypes/performance-roles-1.7.1-review.md).

The 2026-11-04 layout C integration passed `npm run check:all` and `npm run build`, both with exit 0. Frontend results were 295 passed/1 skipped files and 3,433 passed/2 skipped tests; App Rust reported 868 passed/10 ignored, with the remaining workspace checks passing.

The real Sidebar, ParticipationSidebar and HostNodeSetup were rendered with production CSS in a static 1280×720 browser harness across four themes, Chinese/English, RTL, long names and a 36-card list. Computed role/name text was 16px/600 and 16px/300, with the name read-only. The fixed identity row, scrolling connection/project content, 8px heading-to-card gap, 57px cards, 42px bottom controls and 71px browsing region were checked; long-list scrolling and expanded running connection details preserved the fixed header/bottom. ArrowDown opened the actual role menu, Escape restored focus, and the folder menu opened on top. This harness uses synthetic state and command stubs, not native windows, real network/media or App-restart acceptance. Detailed measurements are in [the review record](../prototypes/performance-roles-1.7.1-review.md); earlier B and HTML results below remain historical.

The 2026-11-04 layout B and `lastPerformanceRole` integration passed the final `npm run check:all` and `npm run build`, both with exit 0. Frontend results were 295 passed/1 skipped test files and 3,430 passed/2 skipped tests; App Rust reported 868 passed/10 ignored, and the other workspace CLI/DNS checks passed. The first full run hit an existing `blank_runtime` Socket.IO temporary-port `EADDRINUSE`; the test was unchanged and the complete rerun passed.

A temporary static browser harness rendered the real Sidebar with production CSS at 1280×720 across four themes, Chinese/English, RTL and long names. Computed role text was 16px/600 and node text 16px/300; baseline measurements aligned role text and card start at x=38, and node/card end at x=332. The bottom controls remained outside the independent scrolling region, `FolderSwitch` reported `data-side="top"`, and Escape restored trigger focus. This is component/browser evidence, not native window, network or media acceptance. See [the review record](../prototypes/performance-roles-1.7.1-review.md).

The public coordinator tests connect its actual loopback origin through the actual Host entry to a real TCP project fixture, including HTTP and upgraded transport, context rejection, Stop/restart, delayed inspection/refresh cancellation and manual rejoin. UI coverage for the revised presentation must exercise dropdown role choice, focus and cancellation, activity and native menu guards, read-only node names, Portal sidebar retention and Client-to-Creation cleanup through the ordinary command bridge.

The 2026-11-03 dropdown revision passed `npm run check:all`. Targeted component and sidebar regressions also cover the original folder dropdown: only role-trigger focus adds a new retention hold, so selecting a folder still retracts the sidebar. A trigger → Portal menu → outside pointer path verifies that React Portal event bubbling cannot latch the old hover state. The actual React role component and production CSS were checked in a temporary static browser harness across four themes, Chinese/English, RTL and long names; computed text is the same system family and 13px, with weights 600/300. That harness uses synthetic state and a command stub, and does not certify native App or media behavior.

The earlier 13px checks predate layout B and role-memory integration. They remain historical evidence; the earlier B full checks and browser harness above still do not certify native App restart, window or media behavior.

The opt-in native Client fixture checks first-party secure-context classification,
media API availability and storage on its executing OS. Camera/microphone capture, a first model
inference, the supported macOS baseline and signed dual-machine behavior still
require the native checks in [the acceptance checklist](../acceptance/258-performance-participation.md).
