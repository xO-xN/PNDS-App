#!/usr/bin/env bash
# Build-time only: compare the shipped silent SynthDef against its real SCD source.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCLANG="${SCLANG:-/Applications/SuperCollider.app/Contents/MacOS/sclang}"
ASSETS="$ROOT/src-tauri/resources/blank-project"
TMP="$(mktemp -d)"
cleanup() { rm -f "$TMP/pndsBlank.scsyndef"; rmdir "$TMP"; }
trap cleanup EXIT
"$SCLANG" "$ROOT/scripts/compile-blank-synthdef.scd" "$TMP" "$ASSETS/supercollider/source/pndsBlank.scd"
if [ "${1:---check}" = "--write" ]; then
  mkdir -p "$ASSETS/supercollider/synthdefs"
  cp "$TMP/pndsBlank.scsyndef" "$ASSETS/supercollider/synthdefs/pndsBlank.scsyndef"
  (cd "$ASSETS" && shasum -a 256 supercollider/source/pndsBlank.scd supercollider/synthdefs/pndsBlank.scsyndef) > "$ASSETS/synthdef.sha256"
else
  cmp "$TMP/pndsBlank.scsyndef" "$ASSETS/supercollider/synthdefs/pndsBlank.scsyndef"
  (cd "$ASSETS" && shasum -a 256 -c synthdef.sha256)
fi
