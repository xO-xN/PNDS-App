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

Finally, manually publish the draft release on GitHub.

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
- Boot path stays silent on "up to date" and check failures (typically transient network issues); the manual path toasts every outcome

### Update Flow

```
check → typed outcome → renderer (toast) → [Install action] → download + install → [Restart action] → relaunch
```

### Implementation (v1.3.2, issue #74)

The whole lifecycle lives in `src/lib/updater.ts` — one module, both entries:

- `checkForUpdates()` — the manual entry (app menu item, Settings About button)
- `startBootUpdateCheck()` — the boot entry; `App.tsx` only schedules it and cancels on unmount

The check resolves to a typed outcome (`available` / `up-to-date` / `check-failed`), and install to `installed` / `install-failed`. Outcomes are handed to a `UpdaterRenderer` — a pure rendering seam. The two renderers today are toasts (`manualToastRenderer`, `bootToastRenderer`); v1.4.0's App-styled failure dialog (spec #57 item 4) plugs in as a second renderer without touching the lifecycle. All copy lives in `/locales` under `updater.*` (en + zh-CN). Collocated tests: `src/lib/updater.test.ts`.

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

| Issue                    | Solution                                              |
| ------------------------ | ----------------------------------------------------- |
| Workflow doesn't trigger | Ensure tag starts with `v` and is pushed              |
| Build fails              | Check GitHub secrets, run `npm run check:all` locally |
| Updates not detected     | Verify endpoint URL and public key match              |
| Download fails           | Check signatures, file permissions, disk space        |
