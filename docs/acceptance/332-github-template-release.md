# PNDS GitHub Blank template release (#332)

## Official repository preflight · 2026-11-13

GitHub REST reported [xO-xN/PNDS-Template](https://github.com/xO-xN/PNDS-Template) as a public template with repository ID `1326767366` and default branch `main`. The recorded `main` was `f6bb2c3179bbd675b57dd97397ab68909682e604`, tree `b7da613553f10eac7003062f76ab5b92f2f91cf4`. GitHub returned 404 for `legacy` and an empty result for the `pnds-blank-v` tag prefix. The existing tags were `v0.1.0`, `v0.1.1`, `v0.2.0`, `v0.3.0`, `v0.3.1`, `v0.4.0`, `v0.5.0` and `v0.5.1`. GitHub listed Releases for all of these except `v0.3.0`. The [PNDS GitHub App](https://github.com/apps/pnds-app) advertised repository metadata read access and contents write access.

## Local candidate rehearsal

The earlier local candidate `pnds-blank-v1.7.0` pointed to commit `f2784f3` and tree `860e68770a7c9df06e6c049856abea939617b4a9`. Its archived tree was initialized in a fresh directory. npm installed 87 packages from its existing cache. With `npm start -- --audio-mode none`, both performer and monitor health endpoints reported `ready`, `audioMode=none` and `audio.status=disabled` with the initialized project ID. The preview was stopped after the probes.

The App help compatibility and retrieval suites passed 108 tests. The focused Rust `blank_github_tests` passed both reproducible-export and initialize/preview/open cases with the new template README entry links.

## Prepared release snapshot · local

The integrated exporter emitted `pnds-blank-v1.7.0` with Git tree `f88a78eaf7dbeb79030089dc58b3a2bb67373445`. A second import into a disposable clone of the official repository produced the same tree. The locally prepared `main` and version tag point to `b67375c8a4bd39af6fed954f731be420d0d8b8dc`, a child of the observed original `main`. The local `legacy` ref points to that original commit. These are prepared local refs.

A fresh archive of the final tree initialized successfully with Node 24.19.0. `npm install --offline` installed 87 dependencies. The performer and monitor `/__pnds/health` endpoints reported `ready`, `audioMode=none` and `audio.status=disabled` for the new ID `pnds-release-rehearsal-cb1d85df001edac968e53ceadf1da8c7`. The preview was stopped after the probes. The integrated focused checks passed 181 UI/help tests and both Rust export and initialization tests.

## Live directory baseline

The GitHub REST search corresponding to the [public PNDS directory](https://github.com/search?q=topic%3Apnds-project+is%3Apublic&type=repositories) returned zero indexed repositories during preflight. This was a search observation before tagging any test project.
