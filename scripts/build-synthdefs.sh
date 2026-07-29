#!/usr/bin/env bash
# Compile the PNDS App master synth (.scd -> .scsyndef) with the local
# SuperCollider installation. Build-time only; the App never bundles sclang.
#
# Usage: npm run synthdefs:build
# Override the sclang location with: SCLANG=/path/to/sclang npm run synthdefs:build

set -euo pipefail

SCLANG="${SCLANG:-/Applications/SuperCollider.app/Contents/MacOS/sclang}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/src-tauri/resources/synthdefs/source/pnds-master.scd"
OUT_DIR="$ROOT/src-tauri/resources/synthdefs"
ARTIFACT="$OUT_DIR/pndsMaster.scsyndef"

if [ ! -x "$SCLANG" ]; then
  echo "error: sclang not found at: $SCLANG" >&2
  echo "Install SuperCollider or set SCLANG=/path/to/sclang" >&2
  exit 1
fi

"$SCLANG" "$SRC" "$OUT_DIR"

if [ ! -s "$ARTIFACT" ]; then
  echo "error: expected artifact missing: $ARTIFACT" >&2
  exit 1
fi

echo "[pnds] artifact ready: $ARTIFACT"
