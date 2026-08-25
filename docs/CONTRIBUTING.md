# Contributing Guidelines

Thanks for contributing to PNDS App.

## Prerequisites

- macOS (Apple Silicon)
- Node.js 24
- Rust (latest stable via rustup)
- npm only — this repository does not use pnpm / yarn

## Getting Started

```sh
git clone https://github.com/xO-xN/PNDS-App.git
cd PNDS-App
npm install
```

## Common Commands

| Command                 | Purpose                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `npm run tauri:dev`     | Run the app in development mode                                      |
| `npm run check:all`     | Full check (typecheck / lint / ast-grep / prettier / clippy / tests) |
| `npm run fix:all`       | Auto-fix lint / formatting / clippy                                  |
| `npm run rust:bindings` | Regenerate the tauri-specta command bindings                         |

## Before Submitting

`npm run check:all` must pass; new business logic ships with tests.

## Collaboration

- Task assignment and progress reporting happen in GitHub issues.
- Code and documentation conventions live in [AGENTS.md](../AGENTS.md); platform contracts (project format / runtime protocol / `.pnds`) in the [reference manual](./reference/README.md).
- Follow the existing commit-message style (`feat:` / `fix:` / `docs:` / `chore:` prefixes).

## License

By contributing, you agree that your contributions will be licensed under MIT (see [LICENSE.md](../LICENSE.md)).
