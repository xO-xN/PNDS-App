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

## Official cutover and GitHub acceptance · 2026-11-13

The integrated App revision `50fc3972` passed `npm run check:all` with 3,910 frontend tests and 1,059 tests in the App's Rust library. The rest of the Rust workspace also passed. The checks used two Rust test threads for the local runtime fixtures.

A non-force atomic push updated [official main](https://github.com/xO-xN/PNDS-Template/tree/main), saved the original main as [legacy](https://github.com/xO-xN/PNDS-Template/tree/legacy), and published [pnds-blank-v1.7.0](https://github.com/xO-xN/PNDS-Template/tree/pnds-blank-v1.7.0). Fresh GitHub reads confirmed the same repository ID, public template setting, and default branch, the commit and tree IDs listed above, and the complete historical tag and Release inventory.

- **Public repository.** GitHub generated the [synthetic acceptance project](https://github.com/xO-xN/pnds-beta4-public-acceptance-20261113) from the official repository. Its initial main commit `0f1dd01a81c9650dde6fd8114e3bc7ad28c6d1d2` had no parents and its tree matched the published tag. The documented initializer produced ID `pnds-beta-4-acceptance-score-ebc5113c57df32785571ce3d8da3efe6`. The normal push reached GitHub as `4788353039316979f701d3b676e19657c4ecc263`. Both health endpoints reported that ID with status `ready`, audio mode `none`, and audio status `disabled`.
- **Private first backup.** After completing GitHub authorization, the tester verified the private acceptance repository in PNDS App and finished the first backup. The local project and GitHub `main` both reached `ce8f9c2e7aa2fa72435cd627018fc6b6b21e8e5c`. The merge has the original local commit as its first parent and the generated template root as its second parent. Its tree matches the original local tree. The App stored a private binding with no pending backup and recorded the same remote head.
- **Browser creation.** In Safari, the same official generation URL used by PNDS App opened GitHub's form with `xO-xN/PNDS-Template` preselected. A separate private test repository was created with **Include all branches** off. Its GitHub page showed **Generated from xO-xN/PNDS-Template**. REST independently confirmed source repository ID `1326767366`, only the default branch `main`, and root commit `af63f44aabc0be162cdf4a0643368525e91979bf` with the published tag's tree.
- **Directory.** The public test repository initially had no topics and returned no results in the directory search. On 2026-11-13 at 16:52 CST, the GitHub repository page displayed `pnds-project` after it was saved through **About → Edit repository metadata**. Separately, the directory link in the project README opened a GitHub repository search that listed the exact test repository. The REST topics and repository search endpoints confirmed both observations.
- **Public project in PNDS App.** The integrated macOS App recorded the live public project checkout in its recent creation projects. The checkout's remote, head commit and project ID matched the initialized public project above.
- **Rate limit regression.** The first private repository verification exposed an exhausted anonymous GitHub REST quota. Verification now reads the official template identity from the authorized target repository response and still checks the official Git tag and tree. A regression test covers verification when the anonymous endpoint returns 403. With this fix, `npm run check:all` passed with 3,910 frontend tests and 1,060 tests in the App's Rust library, as well as the remaining workspace checks.
