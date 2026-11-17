# #308–#311: utility participation and published resources

Date: 2026-11-09. Scope is these four children of #294, not the parent release.
App branch: `codex/issues-308-309-310-311`. Source implementations, public
prereleases and formal App fixed resources are delivered. The user explicitly
keeps physical acceptance pending, so the four issues remain open for that gate.

## Sources and published packages

Use the maintenance worktrees in `../PNDS-1.6.2-projects/`; older same-named
siblings were not used. Inputs were MSG `8b594646`, Local `31b477ae`, Telematic
`e3a1b135` (the public v0.8.0 feature tree) and Mobile `fe43c5f5`. Telematic's
newer internet-only diagnostics/geography were preserved rather than reverting
to the specification's v0.7.1 input. Mobile retains its Worker fixes, pinned
model hashes, trusted HTTPS and `needsHttps: true`.

After reviewing local candidates, the user explicitly authorized the four source
commits, pushes, tags and public prereleases. All four source worktrees are clean;
App staging remains unchanged, with no App commit requested. Managed worktree
creation produced no usable attachment, so existing independent maintenance
worktrees were reused; no temporary managed worktree remains attached.

| Tool                          | Public prerelease                                                                    | Source commit                              | Actual public SHA256                                               |
| ----------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------ |
| multichannel-signal-generator | [v1.4.0](https://github.com/xO-xN/Multichannel-Signal-Generator/releases/tag/v1.4.0) | `4c8df36fed4a8c235b9e280c64714e792e360b83` | `bc17e84ee8a9d44ab9429010bb00772d0bca395c5c34f306b7f3f50bd61cbaf9` |
| local-network-diagnostics     | [v0.7.2](https://github.com/xO-xN/Local-Network-Diagnostics/releases/tag/v0.7.2)     | `721e5c7d1c963c2f37c53f5fa8056326e9d75455` | `2ee449902e9a0955ca19d2ca4677bd312064021a664f5eb42704bd31e458fd67` |
| telematic-network-diagnostics | [v0.8.1](https://github.com/xO-xN/Telematic-Network-Diagnostics/releases/tag/v0.8.1) | `d7ac79dd3011617928e4bdcceff55ecc547294ee` | `f4415aed59c0545befeb3e2bb8ac2ef6d65f2424606b46184bd5201407993047` |
| mobile-sensor-meter           | [v0.4.5](https://github.com/xO-xN/Mobile-Sensor-Meter/releases/tag/v0.4.5)           | `1228f20b2b90d5973fa7167df0d5ca04ffcc11a0` | `44243f3e57455be5092c09d869c1bc1d37a3ce7052085e2cecdefa3c22692f90` |

Every artifact came from its existing tag CI, was compared against committed
runtime bytes, then anonymously downloaded after public prerelease publication
with `latest: false`. Existing stable Latest releases are unchanged.

Formal `utilities.json` now fixes these actual public hashes. A standard
`npm run utilities:fetch` used a fresh, unseeded cache and staged all four releases
in `src-tauri/resources/utilities/`; 89 runtime/README files match `git show` of
the published commits. The current fixture registry is
`.cache/browser-utility-published/candidates.json` with `published: true`.
Historical unpublished candidates and proposed pins remain under
`.cache/browser-utility-candidates/`; their ZIP hashes are not formal pins.
Development resource updates do not replace an already installed signed App.

## Implemented behavior

- All four adopt inherited listeners, report actual ports/runtime identity and
  keep confirmed page/API/transport paths within the immutable performance.
- Multichannel uses one Internal audio engine and server-authoritative controls.
  The issue-required per-channel trim was absent from 1.3.2 and is added in 1.4.0;
  unity defaults preserve prior sound. Mutation order, revisions and input
  coalescing prevent late responses from restoring stale control state.
- Local Diagnostics retains real performer probe/ack measurements. Telematic
  retains its existing public HUB and geographic behavior and reports missing
  internet conditions honestly; local entry does not turn it into offline HUB
  measurement or change remote-performance scope.
- Mobile's actual Worker, shared ml5 runtime and local models use the confirmed
  prefix. Explicitly insecure pages cannot claim capture permission because API
  constructors are exposed. HTTPS/native recovery, user gestures, capture
  epochs and resource cleanup remain in place.
- Browser durable keys are scoped by Host/project. Native private origins keep
  their legacy recovery keys. Preparation comes from actual usable controls,
  admission or diagnostic state, without claiming physical capture or sound.

## Verification and repair evidence

All four maintenance sources pass `npm run check` and `npm test`: MSG 74,
Local 98, Telematic 135 and Mobile 192 tests (499 total). Mobile's four pinned model assets
also pass `npm run fetch:handpose`. App `npm run build` passes.

Both local candidates and the exact public CI packages are exercised.
The explicit installed-package regression uses the production installer and
`SessionManager`, owns conflict listeners to force real port reassignment, POSTs
the displayed identity, checks actual queried assets and joins from an independent
native Client's private source. Stop/restart preserves the entry and rejects the
old confirmation and grant. All four pass, with no local Host started by Client.

The ordinary WKWebView regression installs the same exact packages and runs the
production entry shell and actual project pages without private browser headers:

- MSG phone tone/channel/master controls and internal monitor alternation share
  the same engine/run. The actual downstream master group is muted in the test;
  this is not hardware sound acceptance.
- Local Diagnostics collects real probe/ack samples rather than checking health.
- Telematic renders its actual map and unconfigured diagnostic stream without
  claiming a working public HUB.
- Mobile loads its actual Worker, ml5 runtime and local models without camera
  capture. The page explains insecure HTTP. This proves Worker/model execution,
  not phone permissions, samples or physical media acquisition.
- All four keep the original Document until explicit reentry, scope their page
  resources, reject the retired grant and restore applicable browser claims.

Keep the failures as part of the record: installed native Client exposed TND's
missing full-URL capability declaration; actual installed WebKit exposed bridge
scripts rejected by Express under hidden temporary ancestors. Both were fixed
and rerun. The Local observer test initially waited for a state broadcast before
starting diagnostics; correcting its ordering required no product change.

An App full-check attempt passed static gates but timed out one existing README
workflow test under concurrent browser/build load. Its isolated 18-test file
passed. A later full run found a pre-existing pass-management test's source
capture event exceeding its approximately 100ms recording window under load.
An actual HTTP pre-capture delay of 180ms reproduced the exact missing identity
three times; the same delay after capture passed, and all identities were distinct.
The shipped adapter correctly excludes events beyond the first-pass duration.
Only that management test's source clock is now controlled through a temporary
wrapper requiring the exact production adapter. It retains a 100ms musical
recording while removing wall-time scheduling from identity assertions. The same
180ms pre-capture repro then passed 3/3 and ordinary repetition passed 10/10.
No recording product code, duration rule or shipped adapter changed. A later
parallel run reported `EADDRINUSE` while another same-workspace task was also
executing the fixture suite; the final run waits for that foreign test process
to finish. The final
full check `npm run check:all` passed with exit code 0 using default parallelism,
including all static gates, 3,666 frontend tests and the complete Rust workspace.
The pre-publication successful log is `/tmp/pnds-308-311/app-check-isolated.log`.
After formal pins and actual default resources were regenerated, a fresh complete
`npm run check:all` also passed with exit code 0; final log:
`/tmp/pnds-308-311/app-check-published.log`. Exact published-package installer and
ordinary WebKit reruns passed in 20.92s and 27.60s respectively.

Reproduce the two explicit native boundaries with:

```sh
PNDS_UTILITIES_CANDIDATES="$PWD/.cache/browser-utility-published/candidates.json" \
PNDS_UTILITY_EVIDENCE_DIR=/tmp/pnds-utility-evidence \
cargo test --manifest-path src-tauri/Cargo.toml utility_participation_tests \
  -- --ignored --nocapture --test-threads=1
```

## Standards

Two findings, both fixed: MSG's current bilingual how-to retained fixed ports and
an old QR action; Mobile's current bilingual instructions confused public HTTP
entry with trusted HTTPS capture. These violated
`docs/developer/writing-docs.md`'s rule to update current instructions in place.
The existing steps and matching source README text were corrected, then packages
rebuilt. No other documented-standard violation or actionable baseline smell was
found.

## Spec

One source finding, fixed: MSG's `max-width: 540px` rule restored eight channel
slider columns on a phone, contradicting #308's phone-control requirement. The
repeated override was removed; four columns remain and the native ranges have
44px minimum touch height. Actual 375px WebKit dimensions are included with the
final evidence. No other confirmed source specification deviation or scope creep
was found. Publication and fixed-resource requirements are now met; physical
acceptance below remains open, separate from these source defects.

## Remaining completion gates

The user explicitly authorized publication and separately chose to keep physical
results pending. Source commits, tags, CI releases, anonymous downloads, exact
hashes and normal App fixed-resource regeneration are complete. The four issues
remain open only for applicable physical acceptance; the parent #294 is untouched.

Real phone control/sound, real sensor/media permission and capture on supported
HTTPS devices, actual WAN-disconnected venue operation and signed installed App
behavior remain unverified. API exposure, one sample, model readiness and the
executing macOS's WebKit cannot stand in for these. Broader platform and
arm64/Intel acceptance remains owned by #313/#314.

Machine-readable source/package/installed/browser observations and exact public release
hashes: [evidence](./evidence/308-309-310-311-utilities-2026-11-09.json).

Implementation rules: [utility participation](../developer/utility-browser-participation.md).

Mobile's release preparation added a copied-real-CLI regression: cached model
verification must preserve matching `PINNED.json` provenance. It failed before
and passed after the fix; all 192 Mobile tests pass. Missing/damaged asset fetch,
SHA256 rejection and shard checks remain. An independent follow-up review found
no actionable issue. All 32 CI package files now match the committed source.
