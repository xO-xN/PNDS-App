# PNDS Classic fixed source

The source is the verified **PNDS Template 0.7.0 local candidate**, not a
published release. Original source repository and source-directory bytes are
never used during runtime creation. `provenance.json` records the clean 95-file
inclusion set, original Git base and each file's SHA-256. `source.sha256` hashes
those source files; `assets.rs` embeds the same files. Cargo verifies all source
hashes and pins the inventory hash before a build succeeds.

- Source inventory SHA-256: `e5db14f6b2be7556ae0fdc261cb8c694b1641841e0a22c96b86e158797811dd5`
- Accepted runtime candidate bundle SHA-256: `a062b2c9f2adde3ca7f37b40509ea58d1e06caaf4e0a60bce2b7071c033af1fe`
- Source baseline commit: `e3f4769537d6aeb2016b76610e80dea7b639384f`; source included verified uncommitted v0.7.0 changes.

All runtime files were byte-compared with that accepted candidate bundle, except
its distribution README; the full source README, AGENTS, implementation, start
and handoff docs are included instead. The frozen source's `npm run check` and
`npm test` passed (161 tests) in a temporary copy with existing dependencies.
No source file is reformatted or rewritten in this snapshot. Exclusions are Git
history, node_modules, seats/device caches, logs, OS files and GitHub publishing
configuration. The generator initializes creator-specific metadata, docs and
client identity; it omits the upstream cover. Musical and interaction behavior
remain the actual source reference. Generated-project runtime and real bundle
installation are covered at the existing public creation/bundle seams.
