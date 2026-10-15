#!/usr/bin/env bash
# Build the static CLI without externalBin recursion, then stage its exact slice
# for bundle.macOS.files. Runtime never invokes this script or fetches resources.
set -euo pipefail
cd "$(dirname "$0")/../src-tauri"
# Match the App's published deployment floor in both Mach-O slices. Direct
# cargo builds otherwise use Rust's architecture-specific lower defaults.
export MACOSX_DEPLOYMENT_TARGET=13.5

profile=release
build_args=(--release)
targets=("${PNDS_TARGET:-$(rustc -vV | sed -n 's/^host: //p')}")
while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) targets=(aarch64-apple-darwin x86_64-apple-darwin) ;;
    --debug) profile=debug; build_args=() ;;
    --target)
      [[ $# -gt 1 ]] || { echo '--target requires a target triple' >&2; exit 2; }
      targets=("$2")
      shift
      ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

mkdir -p binaries
for target in "${targets[@]}"; do
  case "$target" in
    aarch64-apple-darwin|x86_64-apple-darwin) ;;
    *) echo "unsupported CLI target: $target" >&2; exit 2 ;;
  esac
  cargo build --locked --bin pnds "${build_args[@]}" --target "$target"
  out="binaries/pnds-${target}"
  cp "${CARGO_TARGET_DIR:-target}/${target}/${profile}/pnds" "$out"
  chmod +x "$out"
  echo "staged $out"
done
