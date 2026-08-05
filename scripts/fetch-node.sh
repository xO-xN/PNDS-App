#!/usr/bin/env bash
# Fetch the Node.js runtime bundled with PNDS App (Tauri sidecar).
#
# The App ships an ARM64 Node.js to run score-project servers
# (docs/PNDS_APP_REQUIREMENTS.md §2, docs/PNDS_RUNTIME_CONTRACT.md §2).
# The binary is ~100 MB and is NOT committed to git; run this script once
# after cloning, and again whenever NODE_VERSION below changes. The release
# workflow does the same on every build.
#
# Usage: npm run node:fetch
# Override version: NODE_VERSION=24.18.1 npm run node:fetch

set -euo pipefail

NODE_VERSION="${NODE_VERSION:-24.18.1}"
TARBALL="node-v${NODE_VERSION}-darwin-arm64.tar.gz"

# Download sources, tried in order. npmmirror is the mirror of record for
# networks where nodejs.org is unreachable. Override with NODE_DIST=...
if [ -n "${NODE_DIST:-}" ]; then
  MIRRORS=("$NODE_DIST")
else
  MIRRORS=(
    "https://nodejs.org/dist/v${NODE_VERSION}"
    "https://registry.npmmirror.com/-/binary/node/v${NODE_VERSION}"
  )
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"
SIDECAR="$BIN_DIR/node-aarch64-apple-darwin"
LICENSE_DEST="$BIN_DIR/NODE-LICENSE.txt"

mkdir -p "$BIN_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

DOWNLOADED=""
for base in "${MIRRORS[@]}"; do
  echo "[pnds] trying $base …"
  if curl -fsSL --connect-timeout 15 "$base/$TARBALL" -o "$TMP/$TARBALL" \
    && curl -fsSL --connect-timeout 15 "$base/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"; then
    DOWNLOADED="$base"
    break
  fi
done

if [ -z "$DOWNLOADED" ]; then
  echo "error: failed to download $TARBALL from all mirrors" >&2
  exit 1
fi
echo "[pnds] downloaded Node v$NODE_VERSION (darwin-arm64) from $DOWNLOADED"

echo "[pnds] verifying checksum…"
EXPECTED="$(grep " $TARBALL\$" "$TMP/SHASUMS256.txt" | awk '{print $1}')"
ACTUAL="$(shasum -a 256 "$TMP/$TARBALL" | awk '{print $1}')"
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "error: checksum mismatch for $TARBALL" >&2
  echo "  expected: $EXPECTED" >&2
  echo "  actual:   $ACTUAL" >&2
  exit 1
fi

echo "[pnds] extracting sidecar…"
tar -xzf "$TMP/$TARBALL" -C "$TMP" "node-v${NODE_VERSION}-darwin-arm64/bin/node" \
  "node-v${NODE_VERSION}-darwin-arm64/LICENSE"
mv "$TMP/node-v${NODE_VERSION}-darwin-arm64/bin/node" "$SIDECAR"
mv "$TMP/node-v${NODE_VERSION}-darwin-arm64/LICENSE" "$LICENSE_DEST"
chmod +x "$SIDECAR"

echo "[pnds] sidecar ready: $SIDECAR"
"$SIDECAR" --version
