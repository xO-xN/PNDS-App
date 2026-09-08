#!/usr/bin/env bash
# Fetch the Node.js runtime bundled with PNDS App (Tauri sidecar).
#
# The App ships a Node.js sidecar to run score-project servers, one per
# build target (per-target versions & rationale: docs/developer/releases.md
# “Provisioning is per build target”); the runtime contract's Node baseline
# tracks the arm64 lane.
# One sidecar per build target, named `node-<target-triple>` as Tauri's
# `externalBin` convention requires:
#   aarch64-apple-darwin → Node 24 LTS (official binaries need macOS 13.5+)
#   x86_64-apple-darwin  → Node 22 LTS (the Intel build's floor is macOS 12,
#                          and Node 24's darwin-x64 binary refuses to run there)
# The binary is ~100 MB and is NOT committed to git; run this script once
# after cloning, and again whenever a version below changes. The release
# workflow does the same for each target it builds.
#
# Usage: npm run node:fetch                                  # host target
#        PNDS_TARGET=x86_64-apple-darwin npm run node:fetch   # Intel target
# Override version for the selected target: NODE_VERSION=22.23.2 npm run node:fetch

set -euo pipefail

host_triple() {
  case "$(uname -m)" in
    arm64 | aarch64) echo "aarch64-apple-darwin" ;;
    x86_64) echo "x86_64-apple-darwin" ;;
    *)
      echo "error: unsupported host architecture $(uname -m); set PNDS_TARGET explicitly" >&2
      exit 1
      ;;
  esac
}

TARGET="${PNDS_TARGET:-$(host_triple)}"
case "$TARGET" in
  aarch64-apple-darwin)
    DEFAULT_VERSION="24.18.1"
    NODE_ARCH="arm64"
    ;;
  x86_64-apple-darwin)
    DEFAULT_VERSION="22.23.2"
    NODE_ARCH="x64"
    ;;
  *)
    echo "error: unsupported PNDS_TARGET '$TARGET' (expected aarch64-apple-darwin or x86_64-apple-darwin)" >&2
    exit 1
    ;;
esac
NODE_VERSION="${NODE_VERSION:-$DEFAULT_VERSION}"
DIST="node-v${NODE_VERSION}-darwin-${NODE_ARCH}"
TARBALL="${DIST}.tar.gz"

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
SIDECAR="$BIN_DIR/node-${TARGET}"
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
echo "[pnds] downloaded Node v$NODE_VERSION (darwin-$NODE_ARCH, for $TARGET) from $DOWNLOADED"

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
tar -xzf "$TMP/$TARBALL" -C "$TMP" "$DIST/bin/node" "$DIST/LICENSE"
mv "$TMP/$DIST/bin/node" "$SIDECAR"
mv "$TMP/$DIST/LICENSE" "$LICENSE_DEST"
chmod +x "$SIDECAR"

echo "[pnds] sidecar ready: $SIDECAR"
lipo -info "$SIDECAR"
# Runs natively on its own architecture; on Apple Silicon the Intel sidecar
# runs through Rosetta 2, and a machine without Rosetta just skips the check.
"$SIDECAR" --version 2>/dev/null || echo "[pnds] (not runnable on this host; skipping version check)"
