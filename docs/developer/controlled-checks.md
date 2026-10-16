# Controlled saved-copy checks (#194)

The App and `pnds check --run` adapt the same `run_controlled_check` service.
The service owns a saved temporary project, copied shared resources, input
inventory, child registry, output tail, cancellation and structured report.
It never starts a second GUI manager, changes preferences, updates the main
session generation or publishes session snapshots. Relative cache and compile
writes stay in the copy; no artifacts are adopted automatically. This is a
saved-file execution workflow, not an operating-system sandbox for hostile code.

## Ownership and lifecycle

`RuntimeLease` uses a nonblocking exclusive OS file lock at the user's
`Library/Application Support/com.xo-xn.pnds-app/runtime.lock`. Both App runtime
startup and controlled-check submission acquire it before resource preparation.
The Host retains its lease across starting, ready, stopping, teardown and
unconfirmed cleanup. Controlled-check adapters call `begin_check(task_id)` before
starting the service and `finish_check(confirmed, unresolved_groups)` before
releasing the lease. These append a durable journal to the same locked inode;
confirmed process cleanup clears it. Unconfirmed cleanup records group IDs,
captured leader birth identities and task markers, so ending either front end
does not unlock new App or CLI runs. A dead leader does not prove its descendants
released their resources. Acquisition probes only whole-group absence (`ESRCH`),
never sends a termination signal, and clears complete ownership records only
when all recorded groups are absent. A recorded boot-session change also proves
previous processes are gone. The CLI can exit boundedly while this blocker persists. Journal finalization
errors are appended to the completed report's cleanup errors; a passed task
becomes failed, while an existing cancellation or failure keeps its original
outcome and evidence. A journal-start I/O failure returns a not-executed
operational JSON report (exit 1), rather than an argument error with empty stdout.
Do not unlink this lock file: replacement would create two independent owners.
Static Doctor and static CLI checks acquire no runtime lease.

An interrupted run with incomplete ownership evidence remains blocked. Restart
the Mac before retrying; a boot-session change clears valid old records. A
malformed/truncated journal cannot supply a trustworthy boot identity and is
never silently discarded. If it still blocks after a reboot, quit every PNDS App
and CLI first, then truncate the existing `runtime.lock` file to zero bytes
(without deleting or replacing its inode). This maintenance recovery is safe
only after the reboot has removed every former process and no new runtime owner
is active. Never use this step to bypass an active or unconfirmed live task.

The App accepts only the backend-issued creation identity. It registers the task
while holding the creation access lock, returns a task ID and exposes progress,
report and cancellation by that task ID. Workspace replacement or close cancels
the former owner's task. UI requests and stale checks fence task and workspace
ownership; a late result cannot replace a newer report. Actual App exit requests
cancellation and waits for bounded cleanup before exiting.

The dialog stays mounted for the current creation identity while hidden. Closing
an active check still requests cancellation and collects its final cleanup
report; reopening shows the same result or submission error until an explicit
new check. Workspace replacement unmounts that state and fences late replies.
Copy report writes the full report/error envelope, task ID and creation identity
to the clipboard; clipboard failure never overwrites the original diagnostic.

CLI supervision starts a separate worker with a private stdin control pipe.
The worker holds the lease and runs the same service. SIGINT/SIGTERM request
cancellation; unexpected front-end exit closes the pipe and cancels the worker.
The worker cleans its own process groups before writing its final result. This
covers the CLI front end disappearing; forced termination of every process or
machine power loss cannot produce a successful cleanup report.

None is the default and requires the saved manifest to support None. Internal
requires explicit selection and resolves the actual output device/sample rate,
channel plan, scsynth readiness and master stage with existing audio primitives.
External remains a manual App workflow. Explicit compilation uses the existing
compiler/validated artifact publication on the copy, with cancellation. A missing
compiler or required resource remains a failure; no installation is attempted.

Node and audio have independent owned process groups and registries. Readiness
checks the live child, project ID, audio mode/target/state, both declared ports,
health errors and HTTP 200 at both roots. Cleanup stops Node before audio, using
bounded escalation. Cleanup facts remain separate from task outcome. Unconfirmed
process cleanup retains ownership information and is never a pass.

While both overall and audio state are `starting`, a null audio target is an
unfinished startup fact and polling continues. Identity, mode, ports and explicit
errors are still validated on every payload; a non-null wrong target fails.
Ready payloads must have the exact task target and mode-appropriate audio state
before HTTP/master-stage verification. A project that never becomes ready still
times out. Starting-to-ready transition tests must include the initial null
target so fast fixture startup cannot conceal this boundary.

## Input evidence and report

Report schema 1 records task/project identity, checker version, explicit mode,
static and runtime outcomes, health, actual environment, output tail, cleanup,
input evidence and source freshness. JSON stdout contains only the report.
Each copied file has its content SHA-256, path, size and permissions; directory
entries and dependency/lockfile contents also affect the tree fingerprint.
Production declarations, installed package versions and exact shared references
are separate facts. Git HEAD and dirty status are auxiliary observations; Git
absence does not prevent checking uncommitted input.

Copies exclude the root `.git`, include saved sources, assets and `node_modules`,
materialize contained file links, reject escaping links and do not claim an
instantaneous whole-project snapshot. Reads are descriptor-relative, nonblocking
and limited to regular files. Limits are 100000 entries, 2 GiB per file and 8 GiB
per tree. Cancellation is checked while reading/copying. Preparation changes,
incomplete reads, root replacement and later source/shared changes remain
explicit. App stale rechecks rehash actual content; watcher revision only adds a
conservative stale hint. A new report requires an explicit new check.

HTTP readiness does not validate rendered pages, phone connections, model
inference, actual sound, artistic quality, external audio, trusted HTTPS or the
telematic hub. Physical audio and dual-architecture installed App acceptance are
tracked in [the v1.6.5 acceptance record](../acceptance/194-v1.6.5-controlled-checks.md).

## CLI

```sh
/Applications/PNDS.app/Contents/MacOS/pnds check /path/to/project --run --json
/Applications/PNDS.app/Contents/MacOS/pnds check /path/to/project --run --mode internal
/Applications/PNDS.app/Contents/MacOS/pnds check /path/to/project --run --compile
```

`--timeout-ms` selects the readiness budget (100–120000, default 30000).
`--sample-rate` and `--output-device` are per-task Internal options. Accepted
rates are the same shared Host policy: 44100, 48000, 88200 and 96000 Hz; invalid
rates fail argument parsing with exit 2. Resources
come from the installed executable layout, or an explicit `--app-root PNDS.app`;
there is no maintainer-checkout or global Node fallback. `--resources-root` still
means the shared-library directory containing `catalog.json`. Options precede
`--` when the project name starts with a dash. Without `--run`, the existing
static-only behavior and resource discovery are unchanged.

Runtime exit codes: 0 passed including confirmed cleanup; 1 failed or not
executed; 130 cancelled; 2 invalid arguments or output failure. Read the complete
cleanup and unverified fields even when a report is returned. Single-file review
and recovery are independent and described in [single-file-changes.md](./single-file-changes.md).

The assistant discussion's independent check button (#209) opens this same mounted
dialog; opening, chatting and saving never submit a task. Failed reports retain
input and offer continue editing, the existing latest guarded undo, or confirmation
to prepare a separate editable repair handoff. The handoff still needs its own
Record action. Decline leaves all state intact. No failure automatically starts a
model request, repairs input, adopts copy artifacts or changes Git.
