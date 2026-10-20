# Static Analysis

All static analysis tools configured in this app and how to use them.

## Quick Reference

| Tool           | Purpose                  | Command                  | In check:all |
| -------------- | ------------------------ | ------------------------ | ------------ |
| TypeScript     | Type checking            | `npm run typecheck`      | Yes          |
| ESLint         | Syntax, style, TS rules  | `npm run lint`           | Yes          |
| Prettier       | Code formatting          | `npm run format:check`   | Yes          |
| ast-grep       | Architecture patterns    | `npm run ast:lint`       | Yes          |
| React Compiler | Automatic memoization    | Build-time               | Yes          |
| cargo fmt      | Rust formatting          | `npm run rust:fmt:check` | Yes          |
| clippy         | Rust linting             | `npm run rust:clippy`    | Yes          |
| Vitest         | Frontend tests           | `npm run test:run`       | Yes          |
| cargo test     | Rust tests               | `npm run rust:test`      | Yes          |
| knip           | Unused code detection    | `npm run knip`           | No           |
| jscpd          | Duplicate code detection | `npm run jscpd`          | No           |

## Running All Checks

```bash
npm run check:all    # Must pass before commits
npm run fix:all      # Auto-fix what can be fixed
```

## Tool Details

### ESLint

Handles syntax, style, and TypeScript-specific rules.

```bash
npm run lint        # Check for issues
npm run lint:fix    # Auto-fix issues
```

Configuration in `eslint.config.js`.

### Prettier

Consistent code formatting.

```bash
npm run format:check   # Check formatting
npm run format         # Fix formatting
```

Configuration in `prettier.config.js`.

### ast-grep

Enforces architectural patterns ESLint can't detect. Catches violations like Zustand destructuring and hooks in wrong directories.

```bash
npm run ast:lint    # Scan for violations
npm run ast:fix     # Auto-fix where possible
```

**Key rules:**

- No Zustand destructuring (causes render cascades)
- Hooks must be in `hooks/` directory
- No store subscriptions in `lib/`

See [writing-ast-grep-rules.md](./writing-ast-grep-rules.md) for creating new rules.

### React Compiler

Handles memoization automatically at build time; the rules (what you never
write by hand) and the `getState()` caveat live in
[state-management.md](./state-management.md).

### Rust Tooling

```bash
npm run rust:fmt:check   # Check formatting
npm run rust:fmt         # Fix formatting
npm run rust:clippy      # Lint with clippy
npm run rust:clippy:fix  # Auto-fix clippy warnings
npm run rust:test        # Run Rust tests
```

### External Rust Build Cache

For storage-constrained development, Cargo 1.97 supports separating intermediate
build files from final artifacts. Put a machine-local `.cargo/config.toml` in the
checkout root; this file is gitignored because its absolute volume path belongs
to one machine:

```toml
[build]
build-dir = "/Volumes/<SSD>/PNDS-Development/CargoBuild/{workspace-path-hash}"
```

Keep `target-dir` unchanged. Compiler dependencies, fingerprints and incremental
files go to the external build directory; final executables and App bundles stay
under `src-tauri/target`, preserving the CLI/dnsd staging scripts. The workspace
path hash keeps isolated fixture workspaces separate from the App cache. Cargo
configuration is discovered from the command's working directory, so run the
normal npm commands from this checkout. A fixture invoked elsewhere needs its
own external build-directory configuration.

Mount the SSD before building and stop builds before ejecting it. Sandboxed
commands need write access to the configured external cache root. Verify
`build_directory` and `target_directory` with `cargo metadata`, then run
`npm run check:all` and both architecture builds before removing old internal
`deps`, `build`, `incremental` and `.fingerprint` directories. Preserve source,
Git, runtime inputs and final bundles; back up existing bundles before rebuilding.
Do not move an active build directory or commit a personal volume path.

For Codex agents, persist the cache directory in a machine-local, gitignored
`.codex/config.toml` at the trusted checkout root:

```toml
[sandbox_workspace_write]
writable_roots = ["/Volumes/<SSD>/PNDS-Development/CargoBuild/<checkout>"]
```

This adds the cache to the existing `workspace-write` policy without changing
network access or approval settings. New sessions load the project configuration;
an existing session may need its permissions reloaded before using the new root.
Keep the grant limited to the cache directory and keep the SSD mounted.

### knip (Periodic Cleanup)

Detects unused exports, dependencies, and files. Not in `check:all` - use periodically.

```bash
npm run knip
```

### jscpd (Periodic Cleanup)

Detects duplicated code blocks. Not in `check:all` - use periodically.

```bash
npm run jscpd
```

## CI Integration

`check:all` runs in CI. Ensure it passes locally before pushing:

```bash
npm run check:all
```

## Adding New Rules

**ESLint:** Add rules to `eslint.config.js`

**ast-grep:** Create YAML files in `.ast-grep/rules/`. See [writing-ast-grep-rules.md](./writing-ast-grep-rules.md).

**Prettier:** Modify `prettier.config.js`
