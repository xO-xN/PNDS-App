# Parameter binding and temporary preview (#231)

`bindCreationParameters` works without a model. It reads one existing text through
`CreationAccess`, verifies identity and disk version, then binds at most 16 JSON
primitive literals with unique exact whole-line prefix/suffix anchors. Duplicate
or overlapping targets and mismatched source values, types or project limits are
rejected. Candidate expressions or changed anchors disable their controls. No
evaluator guesses values. Suggested ranges are advisory; project limits are hard.

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
adapter. Copying/wiring it requires an explicit project edit or handoff; the App
never installs it. `installPreviewAdapter` accepts fixed `hostOrigin`, immutable
`sources` (`path: sha256:<hex>`) and `contractDigest` captured when the runtime
loads those bytes, and project-owned `get`/`set` callbacks with kinds/limits.
Node can hash exact loaded bytes with `createHash('sha256')`. Do not rehash current
disk on handshake and claim those bytes are loaded. Deliver digests alongside
the actual page/code. The adapter must declare only effects it truly supports.

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
Applying also ends preview before the independent single-file save. Disk adoption
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
