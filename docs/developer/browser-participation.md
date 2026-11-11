# Browser participation protocol 1 (#295, #298, #299)

The public entry and the confirmed project URL have different ownership. `GET /`
shows the Host, project and performance and offers a form only for an adapted
project. An idle Host serves a waiting page. An unadapted project shows an
adaptation explanation without redirecting to its original performer port.
All entry UI and runtime dependencies are local; browser installation is optional.

`GET /__pnds/participation` retains native `protocolVersion: 1`. A compatible
performance additionally advertises `browserParticipation: 1`, taken only from
`scoreServer.browserParticipation: 1` in the validated manifest. Omission means
unadapted; a declared unknown, null or noninteger version fails preflight. Neither
`supportsPerformerUrl` nor `runtimePorts` implies browser compatibility. Existing
HTTPS selection and native metadata validation keep their own contracts.

## Confirmation and immutable routing

The displayed form posts to
`/__pnds/enter/<hostId>/<projectId>/<performanceId>`. Only an exact current
compatible context receives a 303 redirect to `/__pnds/run/<opaque-grant>/`.
GET cannot confirm; a stale POST returns 409. The grant is generated on explicit
confirmation and is retired on Stop or replacement. It is not a durable identity
or a browser cookie. Each performance owns a grant; confirmations within that
performance may share it.

Every browser asset and transport uses that immutable prefix. The Host strips
only the verified prefix and forwards the remaining path and query to the run's
actual performer listener. Relative scripts, fonts, images, Worker URLs, Worker
fetches and Socket.IO paths must stay beneath it. The proxy preserves real
polling and WebSocket upgrades. It never authorizes an old path from a newer
cookie, Referer or current metadata. Stop/replacement destroys the old server
runtime and active tunnels while the bound public listener remains owned. An old
Document and Worker can keep running locally, but cannot contact a replacement,
even if an internal service port is reused. Recording management remains blocked
after the prefix is stripped.

Native Clients still use private per-Host/project origins and the existing
confirmed identity headers; no browser extension or injected native header is
needed. Their confirmation endpoint and storage ownership are unchanged by this
browser protocol. Native continuity is described in
[native-client-continuity.md](./native-client-continuity.md).

## Persistent browser entry and document ownership

The root entry is a persistent, local shell. Its only discovery request is
`GET /__pnds/participation`; it never preloads a candidate's page or joins a new
performance. The initial Host identity remains pinned for the lifetime of this
shell. A different Host at the saved address is a discovery failure, not a new
target. Failed/slow/incompatible metadata, Stop, mode/role changes and new runs
do not navigate the currently owned iframe. Its actual Document, unsaved memory,
Worker and autonomous clock remain the project's responsibility. Recovery of the
same performance therefore uses the project's existing reconnect/alignment code.

The ordinary-browser UI follows the Pond entry approved on 2026-11-10. With no
score, the waiting page centers the supplied PNDS icon and `PNDS池谱` wordmark,
the Host name and the waiting state; optional saved-entry guidance is two short
sentences. A compatible candidate uses the centered slingshot confirmation.
Normal score presentation has no permanent Leave control or network strip.

With a current score, an available, different, browser-compatible candidate
opens a full-screen entry overlay. The retained current frame is blurred and
`inert`, and focus moves to the confirmation ball. It is not navigated, paused
or destroyed: its Document, timers, Worker and project-owned autonomous behavior
remain owned until a successful handoff. Stop, unavailable metadata and an
incompatible candidate remove this actionable overlay, restore the same frame's
interaction and return focus to it. Discovery does not turn those conditions
into a replacement page.

Each newly displayed candidate fades in over 640ms. Polling the same identity
keeps the existing controls, focus, arrow hint and fade animation; only a changed
candidate or a newly reopened actionable overlay starts another reveal.

Drag in any direction and release to confirm; a very small, slow movement and
an ordinary tap do not confirm. Enter, Space and assistive-technology activation
provide equivalent explicit confirmation. The gesture captures the displayed
Host/project/performance identity. A changed candidate cancels that gesture;
repeated discovery of the same candidate does not restart its one-time arrow
hint. Safari's missing `pointerdown` after a native menu closes is covered by a
mouse-event fallback, with the two event paths deduplicated.

Closing the browser ends its document. The shell does not synthesize pause,
finish or identity-reset messages. Stop/restart produces a new performance and
always requires another explicit entry, even when the project and durable
storage key are unchanged. This UI decision applies to ordinary browsers; the
native PNDS Client retains its separate single-click entry UI.

The shell viewport (`html` and `body`) has fixed height, hidden overflow and
`overscroll-behavior: none`. An actionable confirmation/preparation overlay
permits pinch zoom but cancels cancelable single-finger `touchmove` with an
explicit nonpassive listener on that panel. This prevents an accidental
background drag from becoming pull-to-refresh; waiting-page save guidance can
still scroll. Hidden overlays do not intercept touches, and score-frame
documents retain their own touch/scroll policy. The
[overscroll specification](https://www.w3.org/TR/css-overscroll-1/#examples)
describes the root viewport boundary, while
[WebKit's Safari report](https://bugs.webkit.org/show_bug.cgi?id=275947)
records why the CSS declaration alone is insufficient evidence on iOS.

Each Enter control captures the displayed Host/project/performance together.
The owner rechecks that exact identity before confirming and again after page
preparation. A new candidate cancels the pending attempt without replacing the
retained score; older metadata and
late preparation results cannot adopt a newer candidate or replace the score.
The candidate's frame is hidden and inert while loading. Confirmation starts
real preparation and blocks input immediately. The 420ms ball flight and 480ms
fade from the title, instructions and old score to the gray socket and spinner
start together. The ball remains opaque above the fading loader until it is
beyond the viewport.
Even a quickly prepared page waits for the flight and loader opacity transition
before final identity verification and handoff. Cancellation and changed
identities invalidate old animation completions. The user-requested reveal,
flight and opacity transitions remain enabled with reduced-motion preferences;
only decorative arrow hints, spring-back and small color/arrow transitions are
reduced, and the spinner uses a slower continuous rotation. There is no
simulated resource-loading timer. Escape cancels pending preparation. Only the candidate's
own Window, same origin, all three identities, protocol 1 and
`resourceScope: 'page'` can report preparation. Navigation finish alone is
insufficient. A failed page, script or project-declared required resource,
preparation timeout or cancellation retains the original instance. If the same
actionable candidate remains, the error/retry entry returns and the old frame
stays blurred and input-blocked; cancelling is not an instruction to enter a
different performance or discard the candidate.

After preparation and identity verification, the candidate becomes visible but
remains inert while it fades in over 640ms and the loading overlay fades out
over 480ms. The old frame remains owned throughout this handoff. Both real
animations must finish and identities must pass another check before input/focus
moves to the new frame. Escape, lost metadata or a changed candidate cancels
these animations and retains the original Document. The retained old frame then
navigates to `about:blank` only after successful handoff; its owner
removes it only after observing that navigation. Cancelled candidates use
the same retirement path. Cleanup that cannot be verified keeps a hidden, inert
owned frame and a retryable cleanup prompt rather than discarding its ownership.
Page preparation continues to mean resources usable; the shell records project
admission as unknown because this protocol has no participant-acceptance channel.

WebKit pauses rendered animation timelines in a hidden document. A handoff that
starts hidden therefore omits its unrendered crossfade. If a visible page moves
to the background during a flight, loader fade or handoff, the owner finishes
only those finite animations; it never waits for or finishes the infinite
spinner. Resource preparation, cancellation and final identity checks still
control adoption. Hidden-page acceptance keeps the original hidden WK fixtures
and does not make them visible merely to advance animation timelines.

## Production entry resources (2026-11-10)

`participation_host/browser.rs` renders the bundled `entry.html` and shared
`entry-gesture.html` stage with escaped metadata and locale strings. Compatible
server-rendered entries retain a real POST confirmation form for no-script
browsers; waiting and incompatible entries offer no such form. Template tokens
inside a Host name are never reinterpreted as markup or bootstrap data.

The listener serves `entry.css`, `entry-gesture.js`, `entry.js`, the supplied
`brand.png` and local Manrope/Comfortaa fonts under `/__pnds/`. The immutable run
route, saved-entry `id`/`start_url`/`scope` and existing 512px `icon.png` interface
retain their ownership. Ordinary-page taps do not confirm a JS-managed entry;
form submission still has the exact confirmation endpoint and identity guards.
The production entry has no prototype scene selector or simulated `loadMs` delay.

`browser-entry-gesture.test.mjs` exercises the production gesture controller;
`browser-entry-lifecycle.test.mjs` executes the real bundled entry templates and
scripts through discovery, confirmation, preparation, cancellation and handoff.
Rust `participation_host::browser_tests` verifies the actual local HTTP resources,
localized waiting UI, POST fallback and immutable-route boundaries. Final
`npm run check:all` and this round's explicit WK results are recorded at task
completion; these test seams do not replace physical-device acceptance.

The explicit `plain_browser_entry_launches_while_fading_to_rotating_loader`
WK test renders the production shell with real A→B→C Host runs. It checks one
fade per candidate, a complete offscreen flight, the ordered loader transition,
continuous rendered rotation and a fast prepared page remaining inert until
presentation finishes.

This repair passed `npm run check:all` with four frontend workers and one Rust
test thread: 3,847 frontend tests and the full Rust workspace passed (the main
library ran 1,015 tests). The final check ran on its own after the earlier
overlapping checks encountered port conflicts and process-startup timeouts.
The motion WK acceptance runs the full path both normally and with JavaScript
`matchMedia` reporting reduced motion and the actual production CSS media rules
activated through CSSOM before candidate discovery. Both modes must reveal,
complete the flight, rotate continuously, wait for the real 480ms loader
transition and crossfade into the score before granting input or retiring the
old Document. The reduced-motion case previously reproduced the missing reveal
as a real failing WK test. The explicit real-WK failure/cancel/retry case also passed. Test-owned
local listeners require permission outside the restricted networking sandbox.

For the final parallel flight/fade timing, both motion modes and continuity
passed together, and the metadata-fault case passed on its diagnostic rerun.
That case keeps its strict time-origin assertion and now prints actual/expected
values and Document/token identity if it fails; the earlier mismatch is not
silently treated as a navigation. iPhone feedback confirmed the reduced-motion
animation, the 640/480ms timing and blocked background pull-to-refresh. The final
simultaneous fade/flight adjustment is additionally covered by real WK.

### ASBS mobile preparation (2026-11-10)

The maintained ASBS first-entry path has no saved part identity, so it prepares
all 684 compressed PNG pages before handing off to its part picker. Sequential
requests exceeded the shell's existing 20-second deadline with just 35ms of
controlled latency per request. The maintained source now reads the part index
once and uses at most six request/validation workers, retaining full PNG checks
and publishing readiness only after every required resource passes. A failure
cancels and drains the remaining requests before retry. The same real-PNG
regression completes in about 6.3 seconds after the fix; the actual ASBS WK
handoff/failure/retry/offline-continuation acceptance also passes. These are
controlled-LAN and macOS WebKit results, not physical iPhone acceptance.

ASBS is maintained separately at
`../PNDS-1.6.2-projects/All-Sentient-Being-Sounds`; its `dist` was rebuilt for
this repair. Rebuilding the App alone does not update an older installed ASBS
bundle. Run the rebuilt maintained project or distribute its updated bundle to
apply the preparation fix.

## Project adapter

Load `./__pnds/context.js` before project code. The Host supplies
`globalThis.PNDS_PARTICIPATION` only in a confirmed context. Its immutable fields
are `protocolVersion`, `hostId`, `projectId`, `performanceId`, `basePath`, and
`storagePrefix`. In a confirmed native source the same script uses `/` as its
base. Direct project addresses have no Host confirmation; Blank serves an empty
context script and retains its ordinary standalone behavior.

```js
const participation = globalThis.PNDS_PARTICIPATION
const socket = io(location.origin, { ...participation.socketOptions })
const model = await fetch(participation.resource('model.json?part=7'))
const worker = new Worker(participation.resource('worker.js'))
const claimKey = participation.storageKey('claim')
```

`resource(relative)` resolves against the confirmed base and rejects an escape
from that origin/prefix. Socket.IO mutates its options, so pass a spread copy of
`socketOptions`. A Worker uses URLs relative to its own confirmed script URL for
its imports and requests. Root-absolute paths, hardcoded service ports and
Socket.IO's default `/socket.io/` path need migration before declaring support.
Do not globally rewrite `fetch`, WebSocket, storage or browser prototypes.

The storage prefix is `pnds:<hostId>:<projectId>:`. It excludes performance/grant
identity, so a new explicit entry into the same project can reuse its saved
claim. Projects retain admission, credential rejection and reset authority.
Namespacing avoids accidental reuse; it is not browser security isolation.
Different browser origins, addresses, profiles or saved-app instances do not
promise shared data or migration. Native private-source recovery remains separate.

After required page resources and its initialization are usable, project code may
call `reportPrepared()`. This stores `preparation`, dispatches `pnds:prepared` and
posts the same result to a same-origin parent: `{type:'pnds:prepared',
protocolVersion:1,hostId,projectId,performanceId,resourceScope:'page'}`. Match all
identities and the actual candidate Window before using the report. Blank reports after its actual
`pnds:connected` event. This is a page-preparation fact, not an offline guarantee,
audio permission, project participant acceptance or complete-part preparation.
The owning project must validate any stronger preparation requirement itself.

`reportPreparationFailed()` stores `preparationFailure` and sends
`pnds:preparation-failed` with the same protocol, identities and page scope.
Required resource failures caught by project code must call this method; optional
image failures must not be promoted to mandatory preparation failures. Missing
scripts, fatal initialization errors and unhandled initialization rejections are
reported automatically while the page has not yet prepared. Once preparation has
failed, that candidate cannot later report success; Retry creates a new candidate.

## Verification and limits

Normal Rust tests cover the actual bound HTTP entry, exact confirmation,
queried resource forwarding, version rejection and a project created through
`CreationAccess::create_blank` then started by `SessionManager::start`. The Blank regression also installs Host and Client managers in separate Tauri
mock App contexts: the Client inspects the same public URL with its own activity
guard, joins, loads its actual private page/context and matches all three
identities without starting a local Host. These tests do not start a development
server or substitute a proxy for the Host.

The explicit native browser tests compile an owned plain WKWebView with a
nonpersistent browser data store, no PAC, no private identity headers and no App
IPC. Through the public start seam they run real queried resources, a live
Worker (including its own fetch), real Socket.IO polling and WebSocket, and
A→Stop→B→Stop→A while retaining the original Document, its unsaved token,
`performance.timeOrigin`, timer and Worker. The replacement project's actual
request log must contain no old HTTP/Worker/polling/WebSocket probe. Another
cookie does not change authorization. A preferred internal port is occupied only
by a test-owned listener to force reassignment; it is released before A returns.
The same browser reads isolated B credentials and restores A's namespaced claim
under a new performance authorization. A separate test runs the created Blank's
actual page and observes its preparation report.

```sh
cargo test --manifest-path src-tauri/Cargo.toml plain_browser_ -- --ignored --nocapture --test-threads=1
```

These GUI tests are explicit, alongside the existing native acceptance fixtures;
`check:all` retains non-GUI public-boundary regressions. Evidence on the executing
macOS does not certify signed App, minimum-OS, media capture or two-machine
behavior. Unified native single-click switching is tracked by #301.

The additional actual-shell WK regressions submit the production entry controls,
retain the same real Document through Stop/new candidate/same-project restart,
verify no candidate page traffic before entry, and exercise fatal script failure,
retry, cancellation, B→C preparation races, stale actions, forged preparation
sources/identities and successful focus handoff. Stable discovery preserves the
same focused Enter button. A test-owned HTTP fault boundary forwards actual Host
bytes and injects only timeout, HTTP, invalid/version and different-Host metadata;
all recover without replacing the active Document.

The updated browser fixture uses its own AppKit `NSEvent` through WK: a trusted
key before the candidate appears can establish the current page's WebAudio graph;
while the entry overlay or preparation owns input, neither the retained current
page nor the hidden candidate may receive score keys. After handoff, only the
replacement receives them. Escape replaces the former visible Cancel button.
The fixture also checks retained-frame `inert`/blur against overlay visibility,
and real timer, Worker, Socket.IO and WebAudio retirement. These updated GUI
checks require this round's explicit execution; older evidence that the current
page received keys during preparation is not acceptance of the new UI.

The render graph uses no speaker output or hardware capture. Such WK mechanism
checks do not certify hardware microphone/camera release, a signed App, a physical
phone or another browser's media lifecycle. Candidate frames gain no additional
autoplay, camera or microphone permissions from the shell.

## Optional saved Host entry (#302)

The ordinary root document links to `/__pnds/entry.webmanifest` and a bundled
512px PNDS PNG at `/__pnds/icon.png`. The manifest's `id`, `start_url` and `scope`
are `/`; its name contains the Host node name, never a project, performance or
browser grant. The actual top-level document remains the root while confirmed
scores run in owned child frames. Saving is available before any project starts,
and opening the saved target still requires explicit entry into a new run.
The manifest, icon, stylesheet, scripts, brand image, bundled fonts and translated
save guidance all come from the held LAN listener. The full-resolution brand is
served separately from the existing 512px saved-entry icon. No Service Worker,
remote installer, remote font or CDN is needed.

The native `<details>` guidance remains keyboard accessible and disappears with
other entry chrome during normal score presentation. Its two sentences describe
bookmarks/Home Screen saving and the need to keep the Host online and update a
changed address; they do not claim uniform PWA/WebAPK installation. IP/port changes require updating the saved URL and may
require selecting an identity again; old-address data is retained. Browser or
icon instances may have separate storage. Saving grants no secure-context API,
offline cold-start or background/locked-screen continuation guarantee.

Platform menu wording was checked against [Apple's iPhone guide](https://support.apple.com/en-eg/guide/iphone/iphea86e5236/ios),
[Mac Safari web apps](https://support.apple.com/en-gb/104996) and
[Chrome shortcuts](https://support.google.com/chrome/answer/15085120?hl=en).
These references describe platform options; they are not device acceptance.
The explicit `plain_browser_saved_root` regression saves a real temporary macOS
`.webloc`, reads it with the system plist parser and opens its root in a fresh
ordinary WKWebView after a new public Blank starts. It also decodes the local
icon and checks all browser resources stay on LAN. Home Screen/Dock installation
UI, signed App and other physical platforms remain separate acceptance.

## Maintained score adapters (#305–#307)

Adapt the exact maintenance tree and retain its uncommitted input; an installed
bundle or recording fixture is not its source. Runtime listener handoff and
browser participation are separate declarations. A source without a bundler
still needs its actual served assets, queried URLs and transports checked through
the managed Host, including a conflict owned by the fixture.

Preparation must include every project-required stylesheet as well as scripts,
images, initialization and connection/score readiness. Load the context before
the required link, report its error, and gate preparation on its successful load.
The generic context intentionally does not classify arbitrary images or links as
mandatory. Test a missing stylesheet through the real candidate owner: the
original Document must survive, and resource recovery must allow explicit retry.

Keep work-specific identity policy separate from storage ownership. III keeps
client-owned claims and reset/rejection; IV remains anonymous; Runes can recover
a claim within the same server and issue a new one after its claim map resets.
Use the Host/project browser prefix while preserving legacy keys when the native
private source has `basePath: '/'`. Verify same-performance reload independently
from new-performance admission. The source checks, actual public WK results and
remaining device boundaries are in
[the three-project acceptance record](../acceptance/305-306-307-project-adapters.md).
