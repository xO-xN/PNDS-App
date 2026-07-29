#!/usr/bin/env bash
# Extract the scsynth audio server and its runtime dependencies, bundled
# with PNDS App (Tauri sidecar + Frameworks + plugins).
#
# Source: the local SuperCollider.app installation (universal binaries).
# Everything is thinned to the arm64 slice (V1 is Apple Silicon only, §2):
#   - scsynth                     → src-tauri/binaries/ (externalBin)
#   - libsndfile + its dylib deps → src-tauri/Frameworks/ (bundle Frameworks)
#   - UGen plugins (*.scx)        → src-tauri/plugins/   (bundle Resources,
#                                   passed to scsynth via -U, §6.2)
#
# SuperCollider is GPL-3.0. Distributing scsynth as a separate process that
# the App talks to over OSC is "mere aggregation"; the App itself stays MIT.
#
# Usage: npm run scsynth:fetch
# Override source: SC_APP=/Applications/SuperCollider.app npm run scsynth:fetch

set -euo pipefail

SC_APP="${SC_APP:-/Applications/SuperCollider.app}"
SC_RES="$SC_APP/Contents/Resources"
SC_FMW="$SC_APP/Contents/Frameworks"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"
FMW_DIR="$ROOT/src-tauri/Frameworks"
PLUGINS_DIR="$ROOT/src-tauri/plugins"
SIDECAR="$BIN_DIR/scsynth-aarch64-apple-darwin"

DYLIBS=(
  libsndfile.1.dylib
  libFLAC.12.dylib
  libvorbis.0.dylib
  libvorbisenc.2.dylib
  libopus.0.dylib
  libogg.0.dylib
  libmpg123.0.dylib
  libmp3lame.0.dylib
)

if [ ! -x "$SC_RES/scsynth" ]; then
  echo "error: scsynth not found at: $SC_RES/scsynth" >&2
  echo "Install SuperCollider or set SC_APP=/path/to/SuperCollider.app" >&2
  exit 1
fi

mkdir -p "$BIN_DIR" "$FMW_DIR" "$PLUGINS_DIR"

echo "[pnds] extracting arm64 scsynth from $SC_APP …"
lipo -thin arm64 "$SC_RES/scsynth" -output "$SIDECAR"
chmod +x "$SIDECAR"

echo "[pnds] extracting arm64 Frameworks dylibs …"
for lib in "${DYLIBS[@]}"; do
  lipo -thin arm64 "$SC_FMW/$lib" -output "$FMW_DIR/$lib"
  chmod +w "$FMW_DIR/$lib"
done

echo "[pnds] copying UGen plugins (scsynth .scx, skipping supernova) …"
rm -f "$PLUGINS_DIR"/*.scx 2>/dev/null || true
for f in "$SC_RES/plugins/"*.scx; do
  case "$(basename "$f")" in
    *_supernova.scx) ;;
    *) cp "$f" "$PLUGINS_DIR/" ;;
  esac
done
echo "[pnds] $(ls "$PLUGINS_DIR" | wc -l | tr -d ' ') plugin files copied"

# Plugins resolve libsndfile via @loader_path/../../Frameworks. In the
# bundle that maps to Contents/Frameworks (correct); in dev it maps to
# <repo>/Frameworks — bridge it with a symlink so DiskIO_UGens loads too.
ln -sfn "src-tauri/Frameworks" "$ROOT/Frameworks"

VERSION="$(defaults read "$SC_APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo unknown)"
echo "[pnds] source SuperCollider version: $VERSION"

# GPL-3.0 license text + source pointer (required when distributing the binary).
curl -fsSL --connect-timeout 15 \
  "https://www.gnu.org/licenses/gpl-3.0.txt" -o "$BIN_DIR/SC-GPL-3.0.txt" \
  || echo "warning: could not download GPL-3.0 text; add it manually" >&2
cat > "$BIN_DIR/SC-SOURCE.txt" <<'EOF'
scsynth and the bundled Frameworks/UGen plugins are part of SuperCollider
(https://supercollider.github.io), licensed under GPL-3.0
(see SC-GPL-3.0.txt).

Source code: https://github.com/supercollider/supercollider
These binaries were extracted from the official macOS SuperCollider.app
(arm64 slices), without modification.
EOF

echo "[pnds] sidecar ready: $SIDECAR"
lipo -info "$SIDECAR"
echo "[pnds] verifying it runs…"
"$SIDECAR" -v 2>&1 | head -1 || true
