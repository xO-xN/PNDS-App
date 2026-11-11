#!/usr/bin/env bash
# Compile the PNDS App synths (.scd -> .scsyndef) with the local
# SuperCollider installation. Build-time only; the App never bundles sclang.
#
# Usage: npm run synthdefs:build
# Override the sclang location with: SCLANG=/path/to/sclang npm run synthdefs:build

set -euo pipefail

SCLANG="${SCLANG:-/Applications/SuperCollider.app/Contents/MacOS/sclang}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/src-tauri/resources/synthdefs"

if [ ! -x "$SCLANG" ]; then
  echo "error: sclang not found at: $SCLANG" >&2
  echo "Install SuperCollider or set SCLANG=/path/to/sclang" >&2
  exit 1
fi

build() {
  local source="$OUT_DIR/source/$1.scd"
  local artifact="$OUT_DIR/$2.scsyndef"
  "$SCLANG" "$source" "$OUT_DIR"
  if [ ! -s "$artifact" ]; then
    echo "error: expected artifact missing: $artifact" >&2
    exit 1
  fi
  echo "[pnds] artifact ready: $artifact"
}

build pnds-master pndsMaster
build pnds-spectrum pndsSpectrum
