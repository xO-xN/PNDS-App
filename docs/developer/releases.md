# Releases

Release process, version management, and auto-update system.

## Overview

The release system provides:

- Automated GitHub Actions workflow for building releases
- Version management script for updating all version files
- Check-only update notifier (v1.4.3, #121): the app checks latest.json and points at Releases — it never downloads, installs, or relaunches
- macOS builds in two lanes: Apple Silicon (arm64, mainline) and Intel (x86_64, macOS ≥ 12)

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
npm run release:prepare v1.0.0
```

This will:

1. Check git status is clean
2. Run all quality checks (`npm run check:all`)
3. Update versions in `package.json`, `Cargo.toml`, `tauri.conf.json`
4. Ask if you want to commit and push

Then GitHub Actions will:

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

   Provisioning is per build target: `node:fetch` takes `PNDS_TARGET`
   (aarch64 → Node 24, x86_64 → Node 22 whose official binary still runs on
   macOS 12; Node 24's darwin binaries require macOS 13.5) and stages the
   sidecar plus its version-specific `NODE-LICENSE-<target>.txt` (the
   license text differs per Node series, so each lane bundles its own),
   while `scsynth:fetch` writes both scsynth slices from the universal dmg
   and keeps `libsndfile.dylib` universal. Base `tauri.conf.json` carries
   the arm64 lane's scsynth + license mappings and minimumSystemVersion
   13.5; the x86_64 lane overrides both via `npm run tauri:build:x64`
   (`--config src-tauri/tauri.x86_64.conf.json`, which deletes the arm64
   mappings and maps its own slice + license at macOS 12.0).

2. Build both lanes in one job, sequentially (issue #112):
   lane 1 builds the arm64 mainline natively (base `tauri.conf.json`),
   lane 2 cross-compiles the x86_64 lane on the same arm64 runner
   (`--target x86_64-apple-darwin --config src-tauri/tauri.x86_64.conf.json`).
   Lane 1 creates the draft release; lane 2 finds it by tag (tauri-action
   scans drafts by tag name) and adds its assets.
3. Merge `latest.json` for auto-updates: each lane's `uploadUpdaterJson`
   re-reads the release's existing `latest.json`, keeps its `platforms`
   entries, and layers its own in (`darwin-aarch64` + `darwin-aarch64-app`
   from lane 1, then `darwin-x86_64` + `darwin-x86_64-app` from lane 2 —
   the updater's platform keys, verified in #111). Running lane 2 after
   lane 1 in the same job avoids the concurrent-asset-upload races the
   tauri-action authors note around this file.
4. Upload all installers and signatures (both lanes share one minisign key:
   the `pubkey` in `tauri.conf.json` verifies both).

Finally, run the manual verification checklist below, then publish the
draft release on GitHub.

### Manual verification before publishing

The pre-publish matrix (seeded v1.4.0, issue #64; extended each release) —
every gate below passes on real machines before the draft release is
published:

1. **The dual-lane draft is complete** (v1.4.2, #112): both `…_aarch64.dmg`
   and `…_x64.dmg` assets present and installable on their machines;
   `latest.json` carries `darwin-aarch64` and `darwin-x86_64` entries with
   valid signatures; the two `Info.plist`s read `LSMinimumSystemVersion`
   13.5 (arm64) and 12.0 (x64) (`plutil -extract
LSMinimumSystemVersion raw <PNDS.app/Contents/Info.plist>`); an
   installed arm64 copy's Check for Updates still resolves to the
   `darwin-aarch64` entry.
2. **Local Network Diagnostics v0.6.0 is published** (no longer a draft)
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

### Manual Method

```bash
# Update versions in package.json, Cargo.toml, tauri.conf.json
npm run check:all
git add .
git commit -m "chore: release v1.0.0"
git tag v1.0.0
git push origin main --tags
```

## Version Strategy

Semantic versioning (`v1.0.0`):

- **Major** (1.x.x): Breaking changes
- **Minor** (x.1.x): New features, backwards compatible
- **Patch** (x.x.1): Bug fixes

All three files must have matching versions:

- `package.json` → `"version": "1.0.0"`
- `src-tauri/Cargo.toml` → `version = "1.0.0"`
- `src-tauri/tauri.conf.json` → `"version": "1.0.0"`

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
- **macOS (Intel)**: `.dmg` installer and `.app` bundle (cross-compiled on the same runner, min macOS 12.0)
- **Auto-updater**: `latest.json` manifest — one `platforms` map with both
  `darwin-aarch64` and `darwin-x86_64` entries — and per-artifact `.sig`
  signature files

## Security

The signing pipeline is retained unchanged (check-only #121): the private key signs every release artifact during the build, the `pubkey` stays in `tauri.conf.json`, and `latest.json` plus `.sig` files ship as before. The app itself no longer consumes the download — the infrastructure stays in place and verified.

## Troubleshooting

| Issue                    | Solution                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| Workflow doesn't trigger | Ensure tag starts with `v` and is pushed                                                                |
| Build fails              | Check GitHub secrets, run `npm run check:all` locally                                                   |
| Updates not detected     | Verify endpoint URL and public key match                                                                |
| Download fails           | Downloads happen in the browser now (check-only) — check the release assets, signatures, and disk space |
| Check fails behind proxy | See [Proxies](#proxies-v140-issue-60) — System Settings proxy or `launchctl setenv`                     |
