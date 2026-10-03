#!/usr/bin/env bash
# #174: builds the background LAN-DNS daemon (pnds-dnsd) for the current
# target (or both darwin targets with --all) into src-tauri/binaries/ in
# the shape tauri's externalBin expects (binary-<target-triple>).
#
#   scripts/build-dnsd.sh            # current machine's arch
#   scripts/build-dnsd.sh --all      # aarch64 + x86_64
#   scripts/build-dnsd.sh --debug    # debug build (dev bundles)
set -euo pipefail
cd "$(dirname "$0")/../src-tauri"

mode_args=(--release)
[[ "${1:-}" == "--debug" ]] && mode_args=()
targets=(aarch64-apple-darwin)
[[ "${1:-}" == "--all" ]] && targets=(aarch64-apple-darwin x86_64-apple-darwin)

for target in "${targets[@]}"; do
  echo "==> building pnds-dnsd for ${target}"
  cargo build -p pnds-dnsd "${mode_args[@]}" --target "${target}"
  out="binaries/pnds-dnsd-${target}"
  cp "target/${target}/release/pnds-dnsd" "${out}" 2>/dev/null ||
    cp "target/${target}/debug/pnds-dnsd" "${out}"
  chmod +x "${out}"
  echo "    -> ${out}"
done

# The bundle's LaunchDaemon plist lives next to the daemon binary it
# references (Contents/MacOS/pnds-dnsd); it is copied verbatim by the
# bundle.macOS.files map in tauri.conf.json.
echo "done"
