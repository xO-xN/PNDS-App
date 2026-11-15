# Releases

Release process, version management, and check-only update notices.

## Overview

The release system provides:

- Automated GitHub Actions workflow for building releases
- Version management script for updating all version files
- Check-only update notifier (v1.4.3, #121): the app checks latest.json and points at Releases — it never downloads, installs, or relaunches
- macOS builds in two lanes: Apple Silicon (arm64, mainline) and Intel (x86_64, macOS ≥ 13.5)

The release workflow pins Rust/Cargo **1.97.0**, the locally verified toolchain,
for both lanes. The locked `tauri-build` 2.6.2 assumes the older Cargo `OUT_DIR`
layout; Cargo 1.100 changed that layout, causing sidecars to be staged into
`release/build` and the build helper to attempt to unlink the `pnds-dnsd` crate
directory. This reports `Operation not permitted` on macOS. Tauri fixes the
directory lookup in [`tauri-build` 2.7.0 (#15831)](https://github.com/tauri-apps/tauri/pull/15831).
Upgrade that helper to at least 2.7.0 and revalidate both build lanes before
advancing the release toolchain; the beta 4 workaround leaves Cargo dependencies
unchanged.

The job also sets `RUSTUP_TOOLCHAIN=1.97.0`: the repository's
`rust-toolchain.toml` selects `stable` and otherwise overrides rustup's default
toolchain. Before any Cargo build, the workflow checks the actual Rust/Cargo
versions, the installed Intel target, and the `rustfmt`/`clippy` commands. Both
components are installed explicitly with the fixed toolchain; the minimal
rustup profile does not provide them. Installing a fixed toolchain alone does
not select it for later commands inside this checkout.

## Initial Setup

### 1. Generate Signing Keys

```bash
npm install -g @tauri-apps/cli
tauri signer generate -w ~/.tauri/<updater-key>.key
# Outputs private key (saved) and public key (displayed)
```

### 2. Configure GitHub Repository

Add these secrets (Settings → Secrets and variables → Actions):

- `TAURI_PRIVATE_KEY`: Content of `~/.tauri/<updater-key>.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: Password you set (if any)

### 3. Update Configuration

**`src-tauri/tauri.conf.json`:**

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/xO-xN/PNDS-App/releases/latest/download/latest.json"
      ],
      "dialog": false,
      "pubkey": "YOUR_PUBLIC_KEY_FROM_STEP_1"
    }
  }
}
```

**Bundle info in `tauri.conf.json`:**

- Update `publisher`, `shortDescription`, `longDescription`
- Update `productName` and `identifier`

## Release Process

### Simple Method

```bash
npm run release:prepare -- v1.7.0-beta.1
```

Preparation accepts stable versions and numbered `beta.N` / `rc.N` prereleases.
Run from a clean working tree with the
[version-specific notes](#version-specific-draft-notes) already committed. The
script synchronizes the five version files, validates release metadata and runs
`npm run check:all` against the prepared source. It does not commit, tag, push,
create a release or publish one; those are separate authorized actions.

The canonical tag includes `v`. Validate the prepared files and notes without
changing them with:

```bash
node scripts/release-metadata.mjs v1.7.0-beta.1
```

A pushed tag, or manual workflow run selecting that exact tag, builds its tagged
source. CI validates the same metadata and runs `npm run check:all` before
creating release artifacts. GitHub Actions then:

1. Provision the Node.js runtime and scsynth (`npm run node:fetch` /
   `npm run scsynth:fetch`) — these generated binaries are gitignored and not
   committed, so CI fetches them fresh on every release build. Node is bundled
   as a Tauri external binary; scsynth is bundled as the resource
   `Contents/Resources/scsynth` so macOS does not register it as a second PNDS
   application. The scsynth step also compiles `pndsMaster.scsyndef` using the
   mounted SuperCollider dmg's `sclang`. The built-in utility tools are
   staged the same way by `npm run utilities:fetch`: the tool repos release
   `.pnds` bundles themselves (one project root + `pnds-bundle.json`, per the
   [Project Bundle Specification](../zh-CN/reference/pnds-bundle.md)), and the script downloads each pinned
   release (registry: `utilities.json`), fails the build on a sha256
   mismatch or a malformed bundle layout, and unpacks the verified project
   into the gitignored `src-tauri/resources/utilities/<id>/` (stable path,
   no version) — it is chained into `beforeBuildCommand`, so every
   `tauri build` (local or CI) ships them under
   `Contents/Resources/utilities`, where `builtinUtilities` resolves them
   for the Utilities folder. The app runs them in place; there is no
   first-run install.

   Provisioning is per build target only where the binaries differ
   (v1.4.3, #117): `node:fetch` takes `PNDS_TARGET` but resolves the SAME
   Node version for every target — one runtime baseline, kept from drifting
   by the guard test `src/lib/build-baseline.test.mjs` — and stages the
   sidecar plus a single target-neutral `NODE-LICENSE.txt` (same Node
   series, same license text). `scsynth:fetch` writes both scsynth slices
   from the universal dmg and keeps `libsndfile.dylib` universal. Base
   `tauri.conf.json` carries the license mapping and
   `minimumSystemVersion` 13.5 for both lanes; the x86_64 lane swaps only
   its scsynth slice via `npm run tauri:build:x64` (`--config
src-tauri/tauri.x86_64.conf.json`, which deletes the arm64 slice
   mapping and maps its own).

2. Build both lanes in one job, sequentially (issue #112):
   lane 1 builds the arm64 mainline natively (base `tauri.conf.json`),
   lane 2 cross-compiles the x86_64 lane on the same arm64 runner
   (`--target x86_64-apple-darwin --config src-tauri/tauri.x86_64.conf.json`).
   Lane 1 creates the draft release; lane 2 finds it by tag (tauri-action
   scans drafts by tag name) and adds its assets. Both use the validated
   version-specific notes and the same prerelease classification.
3. Merge `latest.json` for auto-updates: each lane's `uploadUpdaterJson`
   re-reads the release's existing `latest.json`, keeps its `platforms`
   entries, and layers its own in (`darwin-aarch64` + `darwin-aarch64-app`
   from lane 1, then `darwin-x86_64` + `darwin-x86_64-app` from lane 2 —
   the updater's platform keys, verified in #111). Running lane 2 after
   lane 1 in the same job avoids the concurrent-asset-upload races the
   tauri-action authors note around this file.
4. Upload all installers and signatures (both lanes share one minisign key:
   the `pubkey` in `tauri.conf.json` verifies both).

CI success leaves a draft; it does not establish native installation acceptance
or publish the release. For the first 1.7.0 beta, real installation, recovery and
test delivery belong to [#255](https://github.com/xO-xN/PNDS-App/issues/255), after
the release support in [#254](https://github.com/xO-xN/PNDS-App/issues/254).
[#172](https://github.com/xO-xN/PNDS-App/issues/172) remains open for full 1.7.0
acceptance. See [manual verification](#manual-verification-before-publishing)
for the existing release regression scope.

Keep feature-gated test entry points under `src-tauri/tests/fixtures` and declare
their paths in Cargo.toml. Tauri CLI 2.10.1 also scans `src/bin` for binaries to
package, which can add back an entry point disabled by `required-features`.

### Continuing after a workflow-only failure

Commit and push a verified workflow fix normally, then start a new manual run
from that workflow ref while selecting the existing release tag as its input:

```bash
workflow_ref=codex/beta4-integration
release_tag=v1.7.0-beta.4
gh workflow run release.yml --ref "$workflow_ref" -f "version=$release_tag"
```

The dispatch loads the corrected workflow from `workflow_ref`. Its checkout
still resolves `refs/tags/$RELEASE_TAG` and verifies that exact tagged commit;
the App source, version files, notes and artifact identity remain tied to the
original release tag. The existing draft must still match the tagged metadata,
and both lanes run the normal checks. Record the new run as the continuation.
Rerunning the failed run retains its old workflow, so it does not apply this
fix. Keep the existing tag unchanged; fixes to the App's tagged source require
a new release version instead of this workflow-only continuation.

### Bundled local Git (#228–#230)

Cargo builds vendored libgit2 and its HTTPS build dependencies for each architecture.
PNDS uses the bundled Git library and macOS TLS at runtime. `licenses/LOCAL-GIT.txt`
carries the linking exception, dependency notices and source pointers.
GitHub App registration variables for both release lanes are described in
[GitHub sync](./github-sync.md#github-app-registration).
The no-tools subprocess fixture exercises both templates, recording and history
with a cleared environment and an unusable PATH. Installed arm64 and Intel App
checks still need the user-started native acceptance described in
[the G7 record](../acceptance/228-230-local-git.md).

### Manual verification before publishing

The stable-release regression matrix (seeded v1.4.0, issue #64; extended each
release) runs on real machines before stable publication. Beta admission and
its explicitly untested matrix are recorded separately in
[#255](https://github.com/xO-xN/PNDS-App/issues/255); cross-compilation or a green
CI run cannot be recorded as native installation evidence.

1. **The dual-lane draft is complete** (v1.4.2, #112; floor unified to 13.5
   in v1.4.3, #116): both `…_aarch64.dmg` and `…_x64.dmg` assets present
   and installable on their machines; `latest.json` carries
   `darwin-aarch64` and `darwin-x86_64` entries with valid signatures; the
   two `Info.plist`s both read `LSMinimumSystemVersion` 13.5, arm64 and
   x64 alike:
   `plutil -extract LSMinimumSystemVersion raw <PNDS.app/Contents/Info.plist>`;
   an installed copy's Check for Updates still resolves each lane to its
   own entry (`darwin-aarch64` on Apple Silicon, `darwin-x86_64` on Intel).
2. **The Local Network Diagnostics release pinned in `utilities.json` is
   published** (no longer a draft)
   in `xO-xN/Local-Network-Diagnostics`. `utilities:fetch` runs inside
   `beforeBuildCommand` and draft-release assets are not publicly
   downloadable — while that release sits in draft, every `tauri build`
   (local and CI alike) fails with a 404 on the pinned artifact.

3. **Two sites + a VPS hub run TND end to end** — the telematic path the
   v1.4.0 Node section feeds: one machine at each of the two performance
   sites (different networks) against the hub on the VPS, node names
   visible on the hub, measurements flowing both ways. This also
   completes TND's deferred「双节点实测校准质量阈值」step.
4. **The check-only update notice works behind a system proxy** — the
   updater-proxy checklist (v1.4.0, #60; reworked for check-only #121),
   on a real machine:
   1. System Settings → Network → Proxies pointing at a local proxy (e.g. Charles/mitmproxy): launch the App, run Check for Updates, confirm the latest.json request appears in the proxy's log.
   2. `launchctl setenv https_proxy http://127.0.0.1:7890` (see [Proxies](#proxies-v140-issue-60)), relaunch the App, repeat the check.
   3. Point the proxy at a dead address: the manual check must open the failure dialog — copy the error, open the Releases page; the boot auto-check (5 s after launch) must stay completely silent, and an offline launch shows no dialog at all.
5. **`.local` custom address on an Android phone** — a work declaring a
   `*.local` performer address: scan its QR code with the Android device
   that will actually perform, confirm the page loads. Write the
   conclusion back into the「Android mDNS 兼容性待真机验证」note in
   `network.md` (both language trees) — pass, or document the fall-back
   to IP injection.

### Building an Intel bundle locally (v1.5.0 lesson)

The default `tauri build` maps the **arm64 scsynth slice** into the
bundle — cross-compiling with `--target x86_64-apple-darwin` alone
produces an x64 app that dies on Intel with `Failed to start scsynth:
Bad CPU type in executable (os error 86)` (the Rust binary and the node
sidecar are per-target; scsynth is a plain resource mapping). The local
command is the CI lane's, minus the updater signing (the private key
lives only in CI):

```bash
cp src-tauri/tauri.x86_64.conf.json /tmp/tauri.x86_64.local.json
# …and add "createUpdaterArtifacts": false to its bundle object —
# see the macOS 27 section below for why this override is required.
CI=true npm run tauri -- build --target x86_64-apple-darwin \
  --config /tmp/tauri.x86_64.local.json --bundles app,dmg --ci
```

`tauri.x86_64.conf.json` swaps only the scsynth resource slice; the
`binaries/scsynth-*-apple-darwin` and `node-*-apple-darwin` slices are
already staged in `src-tauri/binaries/` (refresh with
`npm run scsynth:fetch` / `PNDS_TARGET=… npm run node:fetch`;
`scripts/build-dnsd.sh --all` stages both dnsd slices — it is NOT part of
beforeBuildCommand (CI's release.yml builds both slices in its own step;
the first v1.5.1 CI attempt died on exactly this missing sidecar), so
before a first local lane build it must run once — the arm64 lane needs
the aarch64 slice just as much as the x86_64 lane needs its own, or the
bundler fails on `resource path binaries/pnds-dnsd-<triple> doesn't exist`).
Verify with
`file <PNDS.app>/Contents/Resources/scsynth` → `x86_64`.

### Local release builds on macOS 27 / Xcode 27 (next-patch lesson)

Two traps that kept every local `tauri build` from producing a bundle —
both fixed so the plain commands above work again:

1. **Stripped proc-macro dylibs are unloadable.** Xcode 27's new linker
   (`ld-27037.1`) emits stripped dylibs whose mis-aligned LINKEDIT string
   pool the dyld of macOS 27 refuses to load: the release build died in
   `serde_derive` & co. with `mis-aligned LINKEDIT string pool` while
   `check:all` stayed green off its older debug cache. Fix in
   `src-tauri/Cargo.toml`: `[profile.release.build-override] strip =
false` — host-only proc-macro artifacts stay unstripped (they are
   never shipped), the final app binary still strips. Validated with a
   from-scratch `cargo clean --release` build.
2. **`--bundles app,dmg` no longer skips updater artifacts.** With
   `bundle.createUpdaterArtifacts: true` in the base config, current
   tauri CLI versions still write `PNDS.app.tar.gz` and then fail on the
   missing `TAURI_SIGNING_PRIVATE_KEY` — after the dmg, but with a
   non-zero exit. For verification builds pass an override config with
   `createUpdaterArtifacts: false` (arm64 lane:
   `--config '{"bundle":{"createUpdaterArtifacts":false}}'`; Intel lane:
   merge the key into the copied x86_64 config as shown above). The
   updater artifacts and their signatures remain CI's job with the real
   key.

### Local DMG verification without an App draft (#199)

Use the direct npm CLI form, `npm run tauri -- build`, when passing bundler
arguments. The nested `tauri:build` script does not forward `--bundles app,dmg`
correctly. Stage both dnsd slices and the normal runtime resources first. The
build still runs `beforeBuildCommand`, including the fixed public utility fetch
and shared-library fetch; local source checkouts are not substitutes.

If Finder layout automation times out with AppleEvent `-1712`, `CI=true` and
`--ci` use the supported bundler mode that skips Finder prettification. The DMG
is still created, mounted, compressed and verified normally. For resource-only
changes after a successful compile, `npm run tauri -- bundle --bundles app,dmg`
with the same lane/config can rebuild the bundle; it does not rerun the build
preparation steps. Keep those inputs verified. A DMG-only bundle command can
remove its intermediate `.app`; obtain the installed App from a read-only mount.

Local acceptance builds set `bundle.createUpdaterArtifacts: false`, preserve the
Intel scsynth override, and use ad hoc signing. Verify each actual DMG with
`hdiutil verify`, mount it read-only, check the installed version and architecture
of App, Node, dnsd and scsynth, verify the deep signature, and check the complete
catalog and utility payload against the fixed inputs. Record byte sizes and the
comparison source/config. Cross compilation and controlled browser tests do not
prove native Intel execution. Both real Macs must pass before closing the dual
architecture gate. No App release or tag is needed for these local tests.

The shared browser harness uses Express `sendFile`, whose default policy blocks
hidden path segments such as an evidence folder named `.cache`. Keep unpacked
App test copies outside the repository so ESLint does not scan their embedded
projects or third-party JavaScript. Test an identical
App copy in a normal temporary installation path, verify the copied resource
hashes, and keep production routes unchanged.

### Manual Method

If preparing versions manually, update the five files below and add the matching
notes, then run the metadata validator and `npm run check:all`. Review the exact
diff before committing. Create and push only the intended release tag when
authorized; never use `git add .` or `git push --tags` as a release shortcut in a
workspace containing unrelated work. Publishing the resulting draft is a
separate action after the applicable native acceptance.

## Version Strategy

Semantic versioning (`v1.0.0`):

- **Major** (1.x.x): Breaking changes
- **Minor** (x.1.x): New features, backwards compatible
- **Patch** (x.x.1): Bug fixes

Supported release tags are `vMAJOR.MINOR.PATCH`,
`vMAJOR.MINOR.PATCH-beta.N` and `vMAJOR.MINOR.PATCH-rc.N`, with a positive
prerelease counter and no leading zeroes. Build metadata and other prerelease
names are rejected. The five version files must agree with the tag:

- `package.json` → `"version": "1.0.0"`
- `package-lock.json` → root `version` and `packages[""].version`
- `src-tauri/Cargo.toml` → `version = "1.0.0"`
- `src-tauri/Cargo.lock` → the `pnds-app` package version only
- `src-tauri/tauri.conf.json` → `"version": "1.0.0"`

Beta and RC tags create GitHub prereleases and must not become Latest. Stable
tags create ordinary draft releases; publishing a stable release is what makes
it eligible for the stable endpoint. The beta retains the same App identifier,
data locations and stable update endpoint. It has no separate update channel:
testers manually download each beta from its release page, while existing
stable users continue to check the unchanged `/releases/latest/download/latest.json`.
Do not overwrite a stable release's manifest with beta assets. A published
GitHub prerelease is public; its label does not create a private test group.

## Update Check System (check-only since v1.4.3, issue #121)

### Behavior

- Checks for updates 5 seconds after app launch (boot path)
- The app never downloads, installs, or relaunches — `downloadAndInstall` and `relaunch` are gone, the updater plugin's built-in `dialog` is off, and `tauri-plugin-process` is removed with them
- Found update (boot or manual): the version persists into the updater store and the starting page docks one line — 「有新版 vX.Y.Z」 — with a **Go to Releases** button; the manual path additionally toasts the same offer with the same action
- Boot path is completely silent on "up to date" **and** on failure/offline — a venue machine that cannot reach GitHub must never see a dialog
- Manual path (app menu, Settings About) keeps full three-state feedback: up-to-date toast; available toast (action → Releases); check failure opens the App-styled failure dialog — full copyable error text plus an **Open Releases Page** action. The failure dialog is reachable from the manual path only

### Update Flow

```
check → typed outcome → renderer
  boot:   silent (failure too) — available persists for the starting page notice
  manual: toast (up-to-date | available → Releases) | failure dialog
```

### Implementation (v1.3.2, issue #74; reworked #121)

The whole lifecycle lives in `src/lib/updater.ts` — one module, both entries:

- `checkForUpdates()` — the manual entry (app menu item, Settings About button)
- `startBootUpdateCheck()` — the boot entry; `App.tsx` only schedules it and cancels on unmount
- `openReleasesPage()` / `RELEASES_URL` — the single action every update surface offers (manual toast, starting page notice, failure dialog)

The check resolves to a typed outcome (`available` / `up-to-date` / `check-failed`) — there is no install continuation. Outcomes are handed to a `UpdaterRenderer` — a pure rendering seam. The lib's toast renderers (`manualToastRenderer`, `bootQuietRenderer`) are the vocabulary; the production pair (`manualCheckRenderer` / `bootCheckRenderer` in `src/store/updater-store.ts`) spreads them and adds the store effects: both persist an available version into `useUpdaterStore.available` (in-app persistent — the starting page's notice survives navigating away and back), the manual one escalates check failures to the App-styled dialog (`UpdaterFailureDialog`), the boot one renders nothing at all. The three entries hand the renderers in: the app menu item and the Settings About button (manual), `App.tsx`'s boot auto-check (boot). All copy lives in `/locales` under `updater.*` (en + zh-CN). Collocated tests: `src/lib/updater.test.ts` (lifecycle + toast renderers + Releases action), `src/store/updater-store.test.ts` + `src/components/shell/UpdaterFailureDialog.test.tsx` (entry renderers + dialog), `src/components/welcome/WelcomeScreen.test.tsx` (the starting page notice).

### Proxies (v1.4.0, issue #60)

The updater's HTTP client honors the network the Mac actually sits on — no proxy settings in `tauri.conf.json`:

- **macOS System Settings proxy**: `src-tauri` declares a zero-code direct dependency on `reqwest` (`default-features = false` + the `system-proxy` feature). The updater plugin builds its own client with `default-features = false`, so the feature is off on its edge; Cargo unifies features per crate across the graph, so our edge switches it on for the whole build (verify: `system-configuration` appears in `Cargo.lock`'s hyper-util deps). Proxies configured in System Settings → Network → Proxies are then read by the updater's client.
- **Environment variables** (`http_proxy` / `https_proxy` / `no_proxy`) are read too, but macOS GUI apps do not inherit shell variables — set them for the GUI session with `launchctl` and restart the app:

```bash
launchctl setenv https_proxy http://127.0.0.1:7890
launchctl setenv http_proxy http://127.0.0.1:7890
# remove again with: launchctl unsetenv https_proxy
```

Proxy behavior is a Cargo-feature effect — there is nothing to unit-test; it is verified on a real machine as a pre-publish checklist item (see [Manual verification before publishing](#manual-verification-before-publishing)). When the manual check fails behind a broken proxy, the failure dialog is the operator's way out: copy the error, open the Releases page, download manually. The boot path stays silent either way (#121).

## Release Artifacts

Each release creates:

- **macOS (Apple Silicon)**: `.dmg` installer and `.app` bundle (built natively on `macos-latest`, min macOS 13.5)
- **macOS (Intel)**: `.dmg` installer and `.app` bundle (cross-compiled on the same runner, min macOS 13.5 — the same floor as arm64 since v1.4.3, #116)
- **Auto-updater**: `latest.json` manifest — one `platforms` map with both
  `darwin-aarch64` and `darwin-x86_64` entries — and per-artifact `.sig`
  signature files

## Security

Updater artifacts use the existing minisign key; the `pubkey` stays in
`tauri.conf.json`, and `latest.json` plus `.sig` files ship with each release.
These signatures are separate from macOS code signing. The current App config
uses ad hoc signing (`signingIdentity: "-"`), without Developer ID signing or
Apple notarization. Release notes must state this accurately; updater signature
verification does not prove Gatekeeper acceptance on a clean Mac. Record the
actual installation result for each shipped architecture before publication.

The beta shares the stable App identity and data. Before testing, quit PNDS and
back up complete project folders, including hidden `.git` and `.pnds-creation`
directories, plus the [App data directory](./data-persistence.md#file-locations).
A performance `.pnds` export excludes private creation data and is not a full
backup. Returning to an older binary does not establish data downgrade
compatibility; preserve the pre-beta copies for recovery.

## Troubleshooting

| Issue                    | Solution                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| Workflow doesn't trigger | Ensure tag starts with `v` and is pushed                                                                |
| Build fails              | Check GitHub secrets, run `npm run check:all` locally                                                   |
| Updates not detected     | Verify endpoint URL and public key match                                                                |
| Download fails           | Downloads happen in the browser now (check-only) — check the release assets, signatures, and disk space |
| Check fails behind proxy | See [Proxies](#proxies-v140-issue-60) — System Settings proxy or `launchctl setenv`                     |

## Version-specific draft notes

Every release requires `docs/releases/<canonical-tag>.md`, for example
`docs/releases/v1.7.0-beta.1.md`. The metadata validator rejects a missing or
empty file and mismatched versions before either build lane can create a draft.
Both lanes use this file for the release body and updater notes; the workflow
does not carry a reusable body from an older release. Historical files in
`.github/release-notes/` remain records, not a fallback for new versions.

Write the actual candidate scope, known untested behavior, installation and
recovery instructions, and the feedback destination. Until native admission
passes, describe the notes as a candidate and leave its acceptance status
explicit. Before publishing, reconcile the body with the actual build and
evidence, preserving any unresolved limitations; a version bump, draft or green
build does not make a release accepted.
