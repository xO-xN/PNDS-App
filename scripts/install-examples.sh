#!/usr/bin/env bash
# Stage the bundled example score projects for release builds (v1.1.2 T7,
# spec issue #11): copy examples/ into src-tauri/examples with production
# dependencies installed, where tauri.conf.json picks it up as the
# `examples` resource — release bundles then ship the Utilities folder's
# two projects (Local Network Diagnostics, Multichannel Signal Generator)
# under Resources/examples (resolved by `bundled_example_projects`).
#
# The staging tree is gitignored and rebuilt from scratch on every run;
# the script is chained into beforeBuildCommand, so both CI and a local
# `npm run tauri:build` stage it automatically. Only runtime files are
# copied — dev tooling (tests, docs, VCS metadata) stays out of the bundle.
#
# Usage: npm run examples:install

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGING="$ROOT/src-tauri/examples"

rm -rf "$STAGING"

for project_dir in "$ROOT"/examples/*/; do
  [ -f "$project_dir/package.json" ] || continue
  name="$(basename "$project_dir")"
  echo "→ staging examples/$name"
  rsync -a \
    --exclude '.DS_Store' \
    --exclude '.git*' \
    --exclude 'AGENTS.md' \
    --exclude 'docs' \
    --exclude 'test' \
    "$project_dir" "$STAGING/$name/"
  (
    cd "$STAGING/$name"
    npm ci --omit=dev --no-audit --no-fund
  )
done
