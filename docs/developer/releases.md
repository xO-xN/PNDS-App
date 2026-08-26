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

- Checks for updates 5 seconds after app launch
- Shows confirmation dialog when update is available
- Downloads and installs in background
- Offers to restart when complete
- Fails silently on network issues

### Update Flow

```
App Launch → (5s delay) → Check GitHub → Show Dialog → Download → Install → Restart
```

### Implementation

The auto-updater lives in `src/App.tsx` (simplified):

```typescript
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

useEffect(() => {
  const checkForUpdates = async () => {
    try {
      const update = await check()
      if (update && confirm(`Update available: ${update.version}…`)) {
        await update.downloadAndInstall(/* progress is logged */)
        if (confirm('Restart to apply the update?')) await relaunch()
      }
    } catch {
      // Silent fail - don't bother user with network issues
    }
  }

  const timer = setTimeout(() => void checkForUpdates(), 5000)
  return () => clearTimeout(timer)
}, [])
```

### Manual Update Check

Users can manually check via:

- **Menu**: PNDS → Check for Updates...
- **Settings**: Settings → About → Check for Updates

Both call `checkForUpdates()` (`src/lib/updater.ts`), which reports the result via toast notifications; installing an update keeps the auto-updater flow in `App.tsx`.

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
