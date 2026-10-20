# Blank 1.7.0 layout and parameter plumbing

Date: 2026-10-18. Scope: newly generated Blank projects only. Project identity
and initial version 0.1.0 remain independent of template source version 1.7.0.
Opening an existing project does not migrate its files or provenance. Classic's
frozen source and installed contract resource paths are unchanged.

The generated layout separates monitor/performer HTML and JS, initial shared CSS,
the local shipped preview adapter and an empty parameter contract. It adds a
localized implementation guide and its AGENTS pointer. The initial work is still
silent and has no production dependency or artificial adjustable parameter.

## Automated evidence

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
