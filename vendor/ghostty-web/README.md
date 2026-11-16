# PNDS Ghostty WASM candidate

This directory records the source and build provenance of the explicitly modified local asset at `src/assets/project-terminal/ghostty-vt.wasm`. It is a qualification candidate, pending real host adoption. It is not the unmodified WASM shipped by npm, and the npm package's WASM is never overwritten.

`provenance.json` fixes the published wrapper, Ghostty core commit, official Zig SDK, patches and artifact hashes. The separately applied ESM compatibility patch also keeps one real textarea input owner and a read-only Canvas host; it anchors IME input to the actual VT cursor without changing the renderer. Both a clean install and an exact prior-patch upgrade must produce the recorded wrapper SHA. These are wrapper changes, not changes to the WASM source patch.

The wrapper is pinned to `ghostty-web@0.4.0-next.21.g640db46`; the core is the wrapper's git submodule `5714ed07a1012573261b7b7e3ed2add9c1504496`.

Apply the unchanged upstream `ghostty-wasm-api.patch` first, then the PNDS `PageList-capacity-zero.patch`. The PNDS patch changes one capacity-preservation expression and two platform-specific zero-initialization guards, plus the required `builtin` import. It preserves the VT API, terminal contents, scrollback pruning and renderer. It does not inject history-clearing escape sequences.

The page-reuse fix retains the actual backing allocation and grapheme capacity when pruning a grown page. The zero-initialization fixes account for the WASM allocator recycling nonzero blocks, whereas the native page allocator's mmap-backed storage starts zeroed. ReleaseSmall otherwise omitted the safety-mode memset and could hang during a resize/write/reuse sequence.

## Rebuild

Use an unpacked official Zig **0.15.2**, verified against the SDK SHA in `provenance.json`. No system Zig or SDK installation is needed. Obtain a clean core checkout/archive at the exact commit above and verify the immutable source and patch hashes. Use a separate disposable source directory and output directory. Apply, in order:

```sh
patch -p1 < /absolute/path/to/vendor/ghostty-web/ghostty-wasm-api.patch
patch -p1 < /absolute/path/to/vendor/ghostty-web/PageList-capacity-zero.patch
/path/to/zig-0.15.2/zig build lib-vt \
  -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall \
  --prefix /absolute/path/to/modified-output
shasum -a 256 /absolute/path/to/modified-output/bin/ghostty-vt.wasm
```

The expected artifact is **424,058 bytes**, SHA-256 `9658ac9534e8cf702c72bcbb371de3f36d50f060695216f4fc1f5b4c4823b543`. The build's declared Zig package hashes authenticate its `uucode`/`zlib` dependencies. Preserve their exact `build.zig.zon` declarations rather than upgrading them during a rebuild.

As a toolchain control, repeat from a clean source with only the upstream API patch. That output must match the published next WASM exactly: **423,939 bytes**, SHA-256 `794191ccd9f469ed0d49ebcb3e6b326d64279b91752b71ad80a3d89ff1f26416`. This byte-identical control was obtained with the same compiler and flags before accepting the PNDS artifact.

On the qualification machine, the official arm64 Zig build runner could not link against its arm64e-only SDK stubs. The verified official x86_64 Zig SDK ran under Rosetta. Because the installed Command Line Tools' `libxcrun` had no x86 slice, a temporary PATH-only `xcrun` shim delegated to `/usr/bin/arch -arm64 /usr/bin/xcrun`. No toolchain source or system SDK was changed. This is a host build workaround, not a WASM runtime requirement and not evidence of Intel App acceptance.

After a verified rebuild, deliberately replace the versioned local asset and update its provenance, install-time checksum check and qualifier only if the hash changed for an understood reason. Never copy it over `node_modules/ghostty-web/ghostty-vt.wasm`.

## Validation and distribution

`node scripts/verify-project-terminal-wasm.mjs` uses this same explicit modified asset with the pinned installed wrapper. It exercises finite byte budgets, five Unicode corpora across multiple widths, rendered state/graphemes, memory plateau and repeated resize/write/render/free. A Node/WASM pass does not qualify physical IME, target CLI, WebKit, process RSS, dual-architecture App runtime or audio/monitor coexistence.

The original notices for Coder, Ghostty contributors, uucode/Unicode, zlib and Zig, with modification provenance, are distributed in `src-tauri/licenses/GHOSTTY-WEB.txt`. The source patches remain in the repository for audit and reproducibility. Adoption status and host evidence belong in `docs/acceptance/v1.7.0-beta.5-terminal-adoption.md`.
