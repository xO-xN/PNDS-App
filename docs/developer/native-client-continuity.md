# Native Client document continuity (#300)

A loaded score, its confirmed performance, network admission and the latest Host
candidate are separate facts. `ClientState.confirmed` pins the Host, project and
performance that authorized the existing source. `ClientSnapshot.host` reports
the latest valid discovery result, while `pageUrl` continues to identify the
loaded document. Do not compare a candidate with the previous candidate to decide
whether the loaded document may reconnect.

## Discovery and admission

The native Client inspects the same complete public HTTP entry URL distributed to ordinary browsers. Public v1 metadata validates the candidate; the confirmed native source retains its private per-Host/project origin and headers.
The coordinator polls retained-document states after network failures, rejected
metadata, Stop and project changes. An explicitly inspected address remains owned even if metadata is rejected
before any page opens, so polling can discover a later valid candidate; Leave
releases that intent. A valid candidate updates automatically but
never installs a page or joins a new performance. A different Host at the same
address remains a candidate; `expectedHostId` stays pinned to the explicitly joined
Host. Late poll replies still require the originating operation epoch.

Unavailability or invalid/incompatible metadata suspends forwarding. The actual
private-source listener and its stable per-Host/project origin remain owned.
HTTP admission rejects new requests with 410, and cancellation reaches active
HTTP connections and upgraded tunnels. An exact confirmed-context recovery
resumes forwarding on the same listener; it does not navigate or call Refresh.
A verified Stop, another performance or another Host permanently retires the old
authorization, even if later metadata repeats it. Only a new explicit entry may
authorize another performance. Host-side identity fences remain in force.

## Native document and controls

The page URL and view epoch survive automatic discovery outcomes. Native view
ownership and role admission follow the retained document rather than only the
`open`/`disconnected` phase names. Ended, changed and metadata-error documents
therefore continue to own Client activity. Hiding the sidebar or window keeps the
same existing native ownership and storage rules.

Connection facts, the latest candidate, Leave and two-click Refresh live in the
App sidebar. The normal score has no persistent Leave or connection strip.
Refresh deliberately retires the current document, then rechecks its confirmed
context; it cannot silently enter a newly discovered candidate. Escape, blur or
an outside pointer cancels the first click. Leave still closes and flushes the native
view and shuts down the proxy through the existing cleanup barrier; cleanup
failure retains ownership for retry. Participation creates no local Host audio.

## Verification boundary

Public coordinator tests exercise real loopback HTTP and upgraded transport,
malformed/incompatible metadata, Stop followed by later candidates, same-context
recovery, old-source rejection and explicit cleanup. Component tests exercise
sidebar candidate facts, unchanged score mounting, role admission and deliberate
refresh; those tests alone are not native document evidence.

Run the opt-in real native continuity seam explicitly:

```sh
cargo test --manifest-path src-tauri/Cargo.toml native_document_survives_public_client_discovery -- --ignored --nocapture
```

It compiles the existing Cocoa/WebKit fixture and opens a disposable visible
WKWebView through the real `ClientCoordinator` and `ClientProxy`. The source is
first-party, with the same durable-origin/PAC arrangement. Every probe checks the
same unsaved random memory token and `performance.timeOrigin`, advancing local
ticks and localStorage through a silent-socket metadata timeout, HTTP 503,
malformed JSON, incompatible metadata, same-context recovery, Stop, a new project
and another Host at the same address. After revocation its HTTP probes return 410.
Explicit Leave waits for the actual fixture document to close. All listeners,
processes and temporary storage belong to the fixture. The initial hidden-window
attempt observed WebKit timer throttling; the check uses a visible window because
background/lock-screen execution is outside this contract.

`npm run native:client:verify` separately checks localStorage, IndexedDB and cookie
recovery across native process recreation, same-process view/store recreation,
changed transport ports and another isolated Host/project. Both native checks
verify media API exposure without requesting device capture. They prove the
mechanisms on the executing macOS; signed App media capture, supported baseline
macOS and dual-machine LAN behavior remain the existing native acceptance scope.

## Explicit native candidate handoff (#301)

Discovery never calls Inspect or Refresh on a retained document. The sidebar
renders the latest Host/project/performance candidate and passes that exact
identity to `joinClientPerformance(expectedHost)`. The button is keyed by all
three identities: replacing B with C must replace the DOM button, so a pointer
press or keyboard activation begun on B cannot activate C after a render.
A fresh click is required for each new performance, including restarting the
same project. A different Host is visibly identified and needs its own explicit
entry. Candidate metadata is checked before creating its source and again after
preparation; neither a stale click nor a late result may confirm another candidate.

`ClientState.epoch` owns discovery/entry operations; `page_epoch` owns the real
loaded document. Starting or cancelling preparation must not change the latter.
A pending candidate owns a separate private proxy and hidden first-party WK
page. Scripts run only after explicit entry. Navigation completion alone is not
readiness: the actual document must finish loading and its project must report
`PNDS_PARTICIPATION.reportPrepared()` with the exact Host/project/performance
and page scope. A matching `preparationFailure` report or the bounded preparation
deadline fails that attempt. Required-resource guarantees are the reporting
project's responsibility; no report is treated as unknown, never as prepared.
Neither readiness nor page opening claims that the project admitted a performer.

During preparation the old WK document, memory, clock, storage, input and source
stay owned. A failed or cancelled attempt closes only its matching staged page,
flushes its store and releases its proxy. Its operation error stays in the
sidebar, and retry prepares a new candidate without rebuilding the old page.
A staged page cannot own native keyboard/pointer routing, file pickers or capture
permission; media playback is suspended until handoff. Existing dialogs,
sidebar hiding, local-origin storage and deliberate two-click Refresh retain
their existing ownership rules. Refresh is disabled while preparation or cleanup
is pending.

Commit and cancellation are single owned transitions. Every queued native action
matches the staged page's epoch and URL. On successful preparation and a final
metadata check, the old document is closed with `_close`/`_isClosed`, its storage
is flushed, then the staged document is promoted. Only the active owner receives
native input. The old source is suspended and shut down; the immutable Host
identity fence still prevents revoked traffic from entering a replacement.
A cleanup failure retains the page/store/source owner for retry. An uncertain
handoff blocks late view synchronization from recreating an already retired old
document. Leave drains staged, current and retained network cleanup before
releasing ownership.

Run the production-view transaction fixture separately:

```sh
npm run native:client:entry:verify
```

This opt-in macOS executable starts a real `SessionManager` Host in an independent
MockRuntime App and a Wry Client App. It opens no development server and starts
no local Client audio engine. Blank projects use actual local scripts and live
project admission; preparation failure requests an actually missing required
resource. The Client executes production WK creation, candidate preparation,
rollback, promotion, `_close` verification and storage flush. Assertions compare
unsaved memory tokens, `performance.timeOrigin` and advancing clocks across
failure/cancellation, send AppKit key events to verify active input ownership,
and verify A → B → A storage restoration plus explicit Leave. Its JSON output and retained `pnds-native-entry-*` temporary evidence directory
record what ran. The fixture verifies native window occlusion and real document
visibility before clock assertions; AppKit synthetic event delivery alone does
not prove a foreground document. The `native-client-fixture` feature adds only opt-in fixture
entry/probes; it is not enabled in release builds. This is single-machine native
mechanism evidence on the executing macOS. Physical capture cleanup, a signed
installed App, minimum macOS and dual-machine LAN remain separate acceptance.

The foreground fixture explicitly activates only its own App/window, waits for
native active/key/visible/occlusion facts and `document.hidden === false`, then
begins clock and input assertions. CLI window visibility or synthetic AppKit
input alone is insufficient evidence of a foreground page. A failed business
assertion is not retried. This barrier is fixture setup; production WebKit
scheduling policy is unchanged, including the macOS 13.5 path. The successful
2026-11-09 production-view run retained one old token/time origin while its ticks
advanced across required-resource failure, preparation and cancellation; entered
B only after preparation, closed A's private source, restored A's stored claim
on a later explicit entry and removed the active WK page on Leave. Captured
native visibility accompanies each memory/clock probe. The retained JSON report
is copied into the group acceptance evidence by the integrator.

## Leave admission and native picker ownership

Leave acquires the coordinator's transition gate and captures pending, current
and retired source owners under one state lock. It publishes `leaving` before
native cleanup, keeps entry/commit admission closed throughout cleanup, and
returns to `idle` only after every captured owner is released. A duplicate Leave
cannot advance that transaction's epoch. A Refresh already retiring its own
source remains responsible for that resource after cancellation. Completed
native commit/cancel replies require their own epoch before changing state, so a
late result cannot clear another operation's gate or replace its outcome.
Failed independent owners remain available for the next explicit cleanup retry.

A native file picker belongs to its exact WK document and panel instance. Closing
a failed staged candidate must not cancel a picker opened by the still-active
page. Retirement cancels only its own view's picker; a late completion clears the
registered owner only when it still refers to that same panel. The production
native fixture opens an actual file-input sheet from A through an AppKit key
event, fails B's required-resource preparation, and verifies A's sheet remains
attached until explicit cancellation. This is native resource ownership evidence,
without selecting a user file or mocking the panel registry.
