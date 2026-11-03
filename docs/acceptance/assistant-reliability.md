# Assistant reliability acceptance (#256)

Date: 2026-10-29. Implementation follows the
[reliability plan](../plans/assistant-reliability-improvement-plan.md).

## Deterministic evidence

The discussion baseline exposed three failing paths before implementation:
tool-turn plan text could be replaced by a later summary; a plain final answer
could omit the plan action receipt; ordinary-answer completion had no explicit
terminal contract. The new discussion completion and workflow UI replays cover
these cases, two sequential question answers, rejected arguments, one bounded
repair, identical plan selection for both actions, explicit text selection and
read-only history selection. They use fixed public fixtures, not private Runes
transcripts or provider reasoning.

Work replays exercise automatic compilation without a model compile call,
compiler failure followed by repair and recompilation in the same task, new
binary publication, recovered binary ownership and final receipt expiry.
Native build and Node-test results are separate from static contracts, existing
runtime health and sound behavior. A stale receipt cannot establish current
input. The chat displays the trusted evidence independently of model wording.

Creator-record tests cover an answer that both accepts a 12-semitone shift and
corrects the output route, changed source versions, compaction, restart and
material/attachment boundaries. Overview tests verify the parsed manifest
metadata's version and actual excerpt/read-target navigation.

Actual compiler, Node and 24 offline rendered audio scenarios, with the pluck
negative control, are recorded in
[native build and NRT acceptance](./assistant-native-build-and-nrt.md).
Those fixtures do not establish arbitrary score-controller correctness or live
sound fidelity.

## Quality gate

The final `npm run check:all` completed with exit code 0: TypeScript, ESLint,
ast-grep, Prettier, Rust formatting, Clippy, frontend tests and workspace Rust
tests passed. After the history-save regression repair, frontend: 282 files and
3,279 tests passed, with two opt-in tests skipped. Rust main library: 826 passed
and 10 ignored; CLI suites (9 and 6), DNS
library (40) and restart integration (2) passed. The two installed-SuperCollider
tests were also explicitly rerun against the final native code: both passed,
including all 24 NRT scenarios. The provider opt-in test remains unaccepted for
the reason below. The full check log is at
`/tmp/pnds-history-save-fix-check-all.log` (the earlier implementation gate is at
`/tmp/pnds-assistant-reliability-check-all.log`).

### Completed Work history regression

A real Work completion exposed an incorrect assumption in the new history
validator: assistant-task IDs use the native timestamp/process ID contract,
while `checkOutcome.taskId` required a handoff UUID. Intermediate `pending`
snapshots could save, but adding completed delivery evidence returned
`invalidFormat`. Retrying the unchanged snapshot repeated the refusal. The
original tests used synthetic UUIDs and missed this cross-layer contract.

The regression now creates and writes through a real native task, saves its
delivery evidence, and loads the result through a new history store. History
and journal loading share the existing bounded task-ID validator; handoff UUID
rules remain unchanged. A component/store/lifecycle replay proves a refused
terminal save retains the full in-memory reply and durable checkpoint, repeated
retry submits the same snapshot, and removing the refusal allows exact saving
without another model call. Save-time feedback no longer reuses a read-error
message suggesting reload or clear.

Stage display/history diagnostics now obey the native 4096-byte UTF-8 bound,
with complete-codepoint truncation and Unicode normalization for a diagnostic
previously cut through an emoji. Empty optional fields are omitted. Complete
reports, task journals and conversation text are preserved. Tests include long
Chinese text, emoji, boundary ASCII and an isolated surrogate; native oversized
field rejection remains strict. Actual creator history is backed up separately
for recovery rather than rewritten by the regression tests.

## Configured-provider evaluation

The opt-in runner uses the actual `runAssistantRequest` flow and native model
service with the currently configured model. Project reads and question tools
are a fixed in-memory fixture; no creator project is written or sent. It records
model/configuration identity, public responses, terminal protocol results and
semantic criteria, without credentials, provider endpoints, private reasoning or
full request packets. Three cases each request three repeats: creator correction,
element-ending scope, and the old controller/test pair that both pass while
releasing a held note too early.

```sh
PNDS_ASSISTANT_PROVIDER_EVAL=1 npm exec -- vitest run src/lib/assistant-reliability-eval.test.ts -t 'unchanged configured native provider'
```

The actual local attempt selected `deepseek-flash`. The native begin operation
did not return within 120 seconds at the credential/request-initialization
boundary. **Zero provider turns ran.** The first semantic case therefore failed
to start and the remaining eight repeats were not executed. A sandbox attempt
returned `credentialStore`; an initial stdio framing failure was corrected
separately and is not evidence about the provider. Owned child processes were
cleaned up. Details remain at `/tmp/pnds-assistant-reliability-eval.json`.

An infrastructure failure stops evaluation and fails the opt-in run. Neither
nine failure records nor the scripted provider's output count as successful real
model evaluation. There is no pre/post provider-quality claim. After a provider
run is available, the public answers must be checked against each case's semantic
criteria; terminal protocol success alone cannot establish artistic reasoning.

## Native UI and creator acceptance

The dev server is started by the creator. Native visual, keyboard and live
performance acceptance remains separate from component tests:

- Answer two design questions and inspect the complete plan and both actions.
- Use either action and confirm the selected plan's scope and values match.
- Modify a SynthDef through Work without clicking a compile button; inspect the
  actual compiler/validation outcome, including an actionable failure and retry.
- Keep a performance active and confirm tests/loading are accurately deferred.
- Reopen the chat and select a historical plan as a new choice; no old task runs.
- Restart at a suitable time, provide actual interaction/voice feedback and use
  the verification continuation for the original goal. Pending sound acceptance
  remains explicit until there is corresponding evidence.

These steps have not been marked passed by the deterministic or NRT fixtures.

## Creator-confirmed native smoke checks (2026-11-03)

The creator reported that all five suggested pre-commit native checks passed
on the current development build: configured-model discussion through Work,
conversation/project reopening, unsaved-file quit choices, Mac/phone control of
Multichannel 1.3.2, and QR/projection operation during performance. The assistant
checks covered plan scope and truthful check/build-stage display, persisted
replies and evidence after restart, and absence of automatic historical-task
execution. Quit cancellation, save and discard behaved as expected.

This records the creator's native workflow smoke acceptance. The separate
three-scenario, three-repeat configured-provider evaluation above remains pending;
the earlier runner attempt still produced zero provider turns. Full physical
device/architecture release acceptance is tracked separately.
