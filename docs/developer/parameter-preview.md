# Parameter binding and temporary preview (#231)

`bindCreationParameters` works without a model. It reads one existing text through
`CreationAccess`, verifies identity and disk version, then binds at most 16 JSON
primitive literals with unique exact whole-line prefix/suffix anchors. Duplicate
or overlapping targets and mismatched source values, types or project limits are
rejected. Candidate expressions or changed anchors disable their controls. No
evaluator guesses values. Suggested ranges are advisory; project limits are hard.

Assistant parameter cards lead with the parameter ID, editable value and fader.
Raw project limits and advisory ranges expand under Range and limits; source
versions/revisions have a separate disclosure. Preview capability, unavailable
bindings and recovery states remain visible. Numeric input/fader constraints and
store validation still use the same original project limits; folding details
never changes the binding or parameter value.

A control edit updates the local candidate immediately and validates that
candidate once before sending it to temporary preview. It reuses this verified
binding; the public Preview action still rebinds independently. Rebinding solely
to preview an already verified control edit used to set `bindingBusy`, disabling
the native range input mid-gesture and ending mouse dragging. Inputs stay enabled
through control validation, with epoch/candidate/ticket checks fencing stale
results; dirty source, invalid code, active model work and saves retain their
separate guards. Preview itself still verifies native source/runtime ownership.

The edit publication tool requires its top-level path/version to refer to the
saved source named by every parameter spec, not the JSON declaration for script
variables. A mismatch returns `parameterSourcePathMismatch` with the source
paths and a corrective instruction before binding. Separate publications for
one path/version merge by parameter ID and native-validate the complete set,
preserving all earlier controls within the existing 16-per-file bound. Final
automatic publication fills missing declared controls without another model turn.

Optional root `pnds.preview.json` contains `schemaVersion: 1` and at most 32
`parameters`. Each has `id`, `path`, `prefix`, `suffix`, `kind` (number, boolean,
text, color, option), `limits` (optional min/max/step/options/maxLength) and
`preview` (live, refresh, restart, unsupported). IDs and path/anchor pairs are
unique. Unknown versions/fields and inaccessible paths fail closed. An undeclared
literal may bind for editing with empty limits and unsupported preview only.
Model descriptions cannot invent hard limits or capabilities.

```json
{
  "schemaVersion": 1,
  "parameters": [
    {
      "id": "speed",
      "path": "public/score.js",
      "prefix": "const speed = ",
      "suffix": ";",
      "kind": "number",
      "limits": { "min": 0, "max": 10 },
      "preview": "live"
    }
  ]
}
```

`PNDS.app/Contents/Resources/preview/adapter.mjs` is an optional project-authored
adapter. In edit mode, `install_preview_adapter` copies the exact shipped bytes to
`public/pnds-preview.mjs` through the task's recoverable no-clobber writer; a custom
existing adapter is preserved. The assistant completes declaration, callbacks and
local server routes as part of the requested parameter edit. Handoff cannot
install or wire it. `installPreviewAdapter` accepts fixed `hostOrigin`, immutable
`sources` (`path: sha256:<hex>`) and `contractDigest` captured when the runtime
loads those bytes, and project-owned `get`/`set` callbacks with kinds/limits.
Node can hash exact loaded bytes with `createHash('sha256')`. Do not rehash current
disk on handshake and claim those bytes are loaded. Deliver digests alongside
the actual page/code. The adapter must declare only effects it truly supports.
The main monitor URL supplies the exact Host origin through `pndsHostOrigin`.
This optional first-frame parameter is not authorization: the Host still checks
native runtime/source ownership and both ends still check origin/Window/session.
Independent browser pages tolerate its absence and need not activate preview.
For mutable public files, pin the loaded source bytes at an immutable local URL
when generating the page and embed that snapshot's digests in its bootstrap.
Computing a digest before serving an independently mutable script URL can race.

Blank template 1.7.0 supplies this local adapter, an empty declaration, and the
monitor callback/bootstrap plumbing at creation. It initially installs no
callbacks and offers no artificial parameters. Its source snapshots cover
`public/monitor.js`, including for direct `/monitor.html` navigation; independently
opened pages without `pndsHostOrigin` remain ordinary pages. Its generated
implementation guide gives a real DOM title-size callback example. Adding
parameter sources in other files also requires their actual load digests;
the default bootstrap cannot attest to arbitrary imported modules.

Messages carry channel `pnds.preview`, version 1, fresh session and increasing
sequence. Host verbs: hello, set (declared primitive values), restore. Replies:
ready (loaded digests, supported IDs, runtime baseline), applied/restored (values
read back after callbacks), error. Both sides fence origin, exact Window, session
and sequence. The adapter serializes setters and skips obsolete queued updates.
There is no code, shell, file or process verb. Sound callbacks must use already
running, explicitly enabled project audio and never enable audio themselves.

Native `authorizeCreationPreview` checks saved source/contract and a ready runtime
for the same canonical project root. The Host separately checks adapter load
digests, with a three-second feedback timeout. A successful send is not an
observable effect. Unsupported parameters and other code changes remain
unpreviewed. Updating parameters preserves the monitor instance. Code input ends
old preview; code preview requires an explicit action and new binding check.
Applying also requires confirmed restoration before saving. Legacy candidates
use the independent single-file writer; edit parameter cards use their original
native task journal. Disk adoption
still needs manual refresh/restart.

End restores runtime parameter baselines, not elapsed time or prior effects.
Failed/missing restoration is unrestored, never success or automatic restart.
Workspace, runtime, navigation, source and operation ownership fence late events.
Tests cover real temporary project reads, distinct source layouts/types and an
actual controlled iframe's observable output. Native WebKit, physical sound and
real model control selection remain separate G4/G5/#172 acceptance.

Repeated end requests share one restoration result, so repeated typing/cancellation
cannot strand the status in restoring or hide an unconfirmed result. Reused
connections must still match source digest, declaration digest/version and native
runtime generation. A different session cannot take over an active adapter by
sending hello; ending the old preview or manual runtime recovery comes first.
UI and shipped-adapter constraint parity is exercised through public messages.

A replacement candidate does not become the displayed preview owner until the
previous restoration settles. Cancelling that replacement still surfaces the
original restoration result. Even a handshake with no usable changes ends with
a restore/release message; it cannot leave an adapter session blocking rebinding.
Only a new workspace or native run gets a separate restoration scope.
After successful restoration, each new preview attempt replaces prior feedback,
unsupported IDs and partial status, including when no monitor is available.
Failed restoration retains its original owner and warning instead.
