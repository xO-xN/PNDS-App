#!/usr/bin/env bash
# Fetch scsynth and its runtime dependencies, bundled with PNDS App.
#
# Source: the official SuperCollider 3.14.1 macOS dmg (signed & notarized).
# We bundle 3.14.x specifically because SC 3.13 has a bug where -H opens
# every device for input even with -i 0, breaking output-only devices
# (built-in speakers, TVs, etc.). 3.14 guards the input setup with
# mNumInputs > 0, so any CoreAudio device works (§6.5).
#
# Everything is thinned to the arm64 slice (V1 is Apple Silicon only, §2):
#   - scsynth            → src-tauri/binaries/ (staging source; bundled as Resources/scsynth)
#   - libsndfile.dylib   → src-tauri/Frameworks/ (bundle Frameworks)
#   - UGen plugins       → src-tauri/plugins/   (bundle Resources, -U flag)
#
# While the dmg is mounted we also use its sclang to compile
# src-tauri/resources/synthdefs/pndsMaster.scsyndef (see
# scripts/build-synthdefs.sh for the standalone equivalent, useful when you
# already have SuperCollider.app installed and are only iterating on the
# .scd source). This is what lets CI (task-7 release workflow) produce a
# working build without a separate SuperCollider install step.
#
# SuperCollider is GPL-3.0. Distributing scsynth as a separate process that
# the App talks to over OSC is "mere aggregation"; the App itself stays MIT.
#
# Usage: npm run scsynth:fetch
# Override package URL: SC_DMG_URL=https://... npm run scsynth:fetch
# Skip the synthdef compile step: SKIP_SYNTHDEF_BUILD=1 npm run scsynth:fetch

set -euo pipefail

SC_DMG_URL="${SC_DMG_URL:-https://github.com/supercollider/supercollider/releases/download/Version-3.14.1/SuperCollider-3.14.1-macOS-universal.dmg}"
SC_VERSION="3.14.1"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"
FMW_DIR="$ROOT/src-tauri/Frameworks"
PLUGINS_DIR="$ROOT/src-tauri/plugins"
SIDECAR="$BIN_DIR/scsynth-aarch64-apple-darwin"
SYNTHDEF_SRC="$ROOT/src-tauri/resources/synthdefs/source/pnds-master.scd"
SYNTHDEF_OUT_DIR="$ROOT/src-tauri/resources/synthdefs"

TMP="$(mktemp -d)"
MOUNT_POINT=""
cleanup() {
  [ -n "$MOUNT_POINT" ] && hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "[pnds] downloading SuperCollider $SC_VERSION (macOS universal)…"
curl -fL --connect-timeout 20 "$SC_DMG_URL" -o "$TMP/sc.dmg"

echo "[pnds] mounting dmg…"
MOUNT_POINT="$(hdiutil attach -nobrowse -readonly "$TMP/sc.dmg" | grep -o '/Volumes/.*' | head -1)"
SC_RES="$MOUNT_POINT/SuperCollider.app/Contents/Resources"
SC_FMW="$MOUNT_POINT/SuperCollider.app/Contents/Frameworks"

if [ ! -x "$SC_RES/scsynth" ]; then
  echo "error: scsynth not found inside the dmg at $SC_RES" >&2
  exit 1
fi

mkdir -p "$BIN_DIR" "$FMW_DIR" "$PLUGINS_DIR"

echo "[pnds] extracting arm64 scsynth…"
lipo -thin arm64 "$SC_RES/scsynth" -output "$SIDECAR"
chmod +x "$SIDECAR"

echo "[pnds] extracting arm64 libsndfile…"
rm -f "$FMW_DIR"/*.dylib 2>/dev/null || true
lipo -thin arm64 "$SC_FMW/libsndfile.dylib" -output "$FMW_DIR/libsndfile.dylib"
chmod +w "$FMW_DIR/libsndfile.dylib"

echo "[pnds] copying UGen plugins (scsynth .scx, skipping supernova)…"
rm -f "$PLUGINS_DIR"/*.scx 2>/dev/null || true
for f in "$SC_RES/plugins/"*.scx; do
  case "$(basename "$f")" in
    *_supernova.scx) ;;
    *) cp "$f" "$PLUGINS_DIR/" ;;
  esac
done
echo "[pnds] $(ls "$PLUGINS_DIR" | wc -l | tr -d ' ') plugin files copied"

if [ "${SKIP_SYNTHDEF_BUILD:-0}" != "1" ]; then
  SCLANG="$MOUNT_POINT/SuperCollider.app/Contents/MacOS/sclang"
  if [ -x "$SCLANG" ]; then
    echo "[pnds] compiling pndsMaster.scsyndef via mounted sclang…"
    mkdir -p "$SYNTHDEF_OUT_DIR"
    "$SCLANG" "$SYNTHDEF_SRC" "$SYNTHDEF_OUT_DIR"
    if [ ! -s "$SYNTHDEF_OUT_DIR/pndsMaster.scsyndef" ]; then
      echo "error: expected artifact missing: $SYNTHDEF_OUT_DIR/pndsMaster.scsyndef" >&2
      exit 1
    fi
    echo "[pnds] synthdef ready: $SYNTHDEF_OUT_DIR/pndsMaster.scsyndef"
  else
    echo "warning: sclang not found at $SCLANG; skipping synthdef compile" >&2
    echo "         run \`npm run synthdefs:build\` separately if needed" >&2
  fi
fi

# Plugins resolve libsndfile via @loader_path/../../Frameworks. In the
# bundle that maps to Contents/Frameworks (correct); in dev it maps to
# <repo>/Frameworks — bridge it with a symlink so DiskIO_UGens loads too.
# scsynth itself is added to the macOS bundle as a resource at
# Contents/Resources/scsynth (see tauri.conf.json), not as an externalBin.
ln -sfn "src-tauri/Frameworks" "$ROOT/Frameworks"

# GPL-3.0 license text + source pointer (required when distributing binaries).
curl -fsSL --connect-timeout 15 \
  "https://www.gnu.org/licenses/gpl-3.0.txt" -o "$BIN_DIR/SC-GPL-3.0.txt" \
  || echo "warning: could not download GPL-3.0 text; add it manually" >&2
cat > "$BIN_DIR/SC-SOURCE.txt" <<EOF
scsynth, libsndfile, and the bundled UGen plugins are part of SuperCollider
(https://supercollider.github.io), licensed under GPL-3.0
(see SC-GPL-3.0.txt).

Source code: https://github.com/supercollider/supercollider
These binaries were extracted, unmodified, from the official
SuperCollider-$SC_VERSION macOS dmg (arm64 slices).
EOF

echo "[pnds] scsynth binary ready: $SIDECAR"
lipo -info "$SIDECAR"
echo "[pnds] verifying it runs…"
"$SIDECAR" -v 2>&1 | head -1
