# Releases

Release process, version management, and auto-update system.

## Overview

The release system provides:

- Automated GitHub Actions workflow for building releases
- Version management script for updating all version files
- Auto-updater for seamless user updates
- macOS (Apple Silicon) builds

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
      "dialog": true,
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
2. Build the app for macOS (Apple Silicon)
3. Create a draft release
4. Generate `latest.json` for auto-updates
5. Upload all installers and signatures

Finally, run the manual verification checklist below, then publish the
draft release on GitHub.

### Manual verification before publishing

The v1.4.0 pre-publish matrix (issue #64) — every gate below passes on
real machines before the draft release is published:

1. **Local Network Diagnostics v0.6.0 is published** (no longer a draft)
   in `xO-xN/Local-Network-Diagnostics`. `utilities:fetch` runs inside
   `beforeBuildCommand` and draft-release assets are not publicly
   downloadable — while that release sits in draft, every `tauri build`
   (local and CI alike) fails with a 404 on the pinned artifact.
2. **Two sites + a VPS hub run TND end to end** — the telematic path the
   v1.4.0 Node section feeds: one machine at each of the two performance
   sites (different networks) against the hub on the VPS, node names
   visible on the hub, measurements flowing both ways. This also
   completes TND's deferred「双节点实测校准质量阈值」step.
3. **Auto-update downloads and installs behind a system proxy** — the
   updater-proxy checklist (v1.4.0, #60), on a real machine:
   1. System Settings → Network → Proxies pointing at a local proxy (e.g. Charles/mitmproxy): launch the App, run Check for Updates, confirm the request appears in the proxy's log.
   2. `launchctl setenv https_proxy http://127.0.0.1:7890` (see [Proxies](#proxies-v140-issue-60)), relaunch the App, repeat the check.
   3. Point the proxy at a dead address: the boot auto-check and the manual check must both open the failure dialog — copy the error, open the Releases page.
4. **`.local` custom address on an Android phone** — a work declaring a
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

## Auto-Update System

### Behavior

- Checks for updates 5 seconds after app launch (boot path)
- "Update available" toast carries an **Install** action button (no native `confirm()`/`alert()` anywhere on the update paths)
- Downloads and installs in background, then offers a **Restart** toast action
- Boot path stays silent on "up to date"; v1.4.0 (#60): a check **or** install failure on either path (boot and manual) opens the App-styled failure dialog — full copyable error text plus an **Open Releases Page** action for a manual download. The manual path toasts the up-to-date outcome as before

### Update Flow

```
check → typed outcome → renderer (toast) → [Install action] → download + install → [Restart action] → relaunch
```

### Implementation (v1.3.2, issue #74)

The whole lifecycle lives in `src/lib/updater.ts` — one module, both entries:

- `checkForUpdates()` — the manual entry (app menu item, Settings About button)
- `startBootUpdateCheck()` — the boot entry; `App.tsx` only schedules it and cancels on unmount

The check resolves to a typed outcome (`available` / `up-to-date` / `check-failed`), and install to `installed` / `install-failed`. Outcomes are handed to a `UpdaterRenderer` — a pure rendering seam. The toast renderers (`manualToastRenderer`, `bootToastRenderer`) draw the available/installed toasts; the failure-dialog renderer pair (v1.4.0, #60 — `manualFailureDialogRenderer` / `bootFailureDialogRenderer` in `src/store/updater-store.ts`) escalates check/install failures to the App-styled dialog (`UpdaterFailureDialog`) by spreading the toast renderers and overriding only the two failure outcomes — the lifecycle itself is untouched. The three entries hand the renderers in: the app menu item and the Settings About button (manual), `App.tsx`'s boot auto-check (boot). All copy lives in `/locales` under `updater.*` (en + zh-CN). Collocated tests: `src/lib/updater.test.ts` (lifecycle + toast renderers), `src/store/updater-store.test.ts` + `src/components/shell/UpdaterFailureDialog.test.tsx` (dialog renderer + dialog).

### Proxies (v1.4.0, issue #60)

The updater's HTTP client honors the network the Mac actually sits on — no proxy settings in `tauri.conf.json`:

- **macOS System Settings proxy**: `src-tauri` declares a zero-code direct dependency on `reqwest` (`default-features = false` + the `system-proxy` feature). The updater plugin builds its own client with `default-features = false`, so the feature is off on its edge; Cargo unifies features per crate across the graph, so our edge switches it on for the whole build (verify: `system-configuration` appears in `Cargo.lock`'s hyper-util deps). Proxies configured in System Settings → Network → Proxies are then read by the updater's client.
- **Environment variables** (`http_proxy` / `https_proxy` / `no_proxy`) are read too, but macOS GUI apps do not inherit shell variables — set them for the GUI session with `launchctl` and restart the app:

```bash
launchctl setenv https_proxy http://127.0.0.1:7890
launchctl setenv http_proxy http://127.0.0.1:7890
# remove again with: launchctl unsetenv https_proxy
```

Proxy behavior is a Cargo-feature effect — there is nothing to unit-test; it is verified on a real machine as a pre-publish checklist item (see [Manual verification before publishing](#manual-verification-before-publishing)). When a check or install fails behind a broken proxy, the failure dialog is the operator's way out: copy the error, open the Releases page, download manually.

## Release Artifacts

Each release creates:

- **macOS (Apple Silicon)**: `.dmg` installer and `.app` bundle (built with `--bundles app,dmg` on `macos-latest`)
- **Auto-updater**: `latest.json` manifest and `.sig` signature files

## Security

All updates are cryptographically signed:

1. Private key signs releases during build
2. Public key in config verifies downloads
3. Invalid signatures are automatically rejected

## Troubleshooting

| Issue                    | Solution                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------- |
| Workflow doesn't trigger | Ensure tag starts with `v` and is pushed                                            |
| Build fails              | Check GitHub secrets, run `npm run check:all` locally                               |
| Updates not detected     | Verify endpoint URL and public key match                                            |
| Download fails           | Check signatures, file permissions, disk space                                      |
| Check fails behind proxy | See [Proxies](#proxies-v140-issue-60) — System Settings proxy or `launchctl setenv` |
