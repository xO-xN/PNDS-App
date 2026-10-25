# Blank 1.7.0 layout and parameter plumbing

Date: 2026-10-18; revised 2026-10-22. Scope: newly generated Blank projects only. Project identity
and initial version 0.1.0 remain independent of template source version 1.7.0.
Opening an existing project does not migrate its files or provenance. Classic's
frozen source and installed contract resource paths are unchanged.

The generated layout separates monitor/performer HTML and JS, initial shared CSS,
the local shipped preview adapter and an empty parameter contract. It adds a
localized implementation guide and its AGENTS pointer. The initial work is still
silent and has no artificial adjustable parameter. Socket.IO 4.8.4 is now its
only production dependency, supplied through a verified exact App shared
reference with local same-origin browser clients. Internal and all three audio
files remain the default. Root README.md supplies the creation-language fallback
with only creator content; there is no initial translation task or handoff file.
A generated .gitignore carries private/transient exclusions to external Git.

## Automated evidence

- The 2026-10-22 revision verifies the exact Socket.IO-only manifest/package
  references, missing/damaged-resource publication refusal, root README fallback
  in both UI languages, empty-introduction editing and external Git exclusions.
  The generated pages execute against real Socket.IO clients on both origins,
  reconnect with their server-assigned roles, upgrade to WebSocket, and close
  cleanly with the server; a second start reuses both ports. The three-audio-mode
  start/restart and failure-cleanup tests remain green. Preview script snapshots
  survive attribute/quote/whitespace edits and reject a missing script entry.
- The generator regression failed before implementation with missing
  `public/monitor.js`. It now verifies all entries, HTML references, local adapter
  identity, empty declaration, source version, local initial Git version and
  preservation of the existing project's layout.
- Both localized generated guides supply a title-size recipe that binds through
  the actual native source/version/anchor/contract checks. Untouched files are
  classified as template placeholders; edited CSS, JS and MJS are authored input.
- The generated artifact runs through the fixed Node runtime in Internal,
  External and None with isolated test ports and controlled OSC replies. HTTP
  assertions check MIME/no-store, fresh saved resources, exact source/contract
  digests, pinned bytes across a simultaneous save, new bytes on refresh, direct
  monitor navigation, absent performer activation and fail-closed snapshot IDs.
- The real monitor bootstrap and shipped adapter execute with the documented
  recipe in a controlled iframe. Hello/set/restore messages visibly change title
  font size 48 → 72 → 48 and acknowledge the same values and loaded digests.
  The module loader uses the shipped disk module in place of its HTTP URL.

## Dev App acceptance

The creator starts/restarts the dev App. Create a new Blank and verify source
label 1.7.0, page/script/style groups, the generated guide, and an empty initial
parameter contract. Run a small edit task that changes title size and exposes a
fader, refresh saved code once, drag for temporary feedback, save parameters and
use task undo. Public resource saves should load after refresh; server changes
require a project restart. Reopen an existing project and verify no migration.

Native WebKit rendering, real provider task selection/latency and physical sound
remain device acceptance; the automated iframe does not establish those facts.
