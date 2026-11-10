# #325 device microphone implementation evidence

Scope: issue #325 and parent #315, using the existing #320 public event/recording
foundation. This implements the optional module and its confirmed chat workflow;
it does not close #315 or replace #313/#314 joint acceptance.

## Automated evidence (2026-11-10)

- `npm exec vitest run src/lib/device-microphone.test.mjs`: 8 passed. The shipped
  module is exercised at Web Audio/media/DOM boundaries: explicit activation and
  input selection, one analysis chain and all four outputs, denial/retry,
  switching/ended input, background, late authorization, independent page
  ownership, disconnected sample dropping, public validation and both projection
  markers refusing capture. Red tests exposed and corrected late-context cleanup
  and capture ownership; the explicit controls were also tested red before green.
- `cargo test --manifest-path src-tauri/Cargo.toml microphone_chat_adoption_runs_four_features_through_real_score_and_recording -- --nocapture`:
  1 passed. Public Blank creation, open, assistant task proposal, local approval,
  idempotent adoption and same-task source writes create an actual score. Its
  actual performer page loads the shipped module and presents enable/input
  controls. Controlled Web Audio buffers travel over real Socket.IO through the
  existing accepted action/capture/application path. Brightness, radius, waveform
  trace and spectrum change; malformed input changes neither state nor capture.
  The shipped recording endpoint captures/replays the same feature effects under
  recorded source identities without another permission request. Whole-task undo
  restores original files and preserves unrelated author notes. No project
  `node_modules`, p5 or ml5 is installed.
- `npm run typecheck`, targeted ESLint, Rust format check and
  `npm exec vitest run src/lib/device-microphone.test.mjs src/lib/help-trees.test.ts`
  passed (12 tests in the latter run). Existing help paths are retained.

The integration initially could not run against an incomplete isolated #320
copy. Its required default-module helpers, locale keys, entry interfaces and
fixed shared resources were merged from the completed prerequisite; production
resource validation remained enabled. No substitute project or resolver bypass
was used. `SOURCE.json` in the isolated tree was temporarily recalculated only
for the new assets; final combined provenance is owned by the integrator.

Repository `npm run check:all` and final combined source pins are run by the
integrator; this record does not claim them complete before that result exists.

## Physical-device boundary

Controlled buffers establish arithmetic, input UI, ownership and recording flow.
They are not evidence of built-in/external microphone capture or actual acoustic
changes. Real permission allow/deny/retry, unplugging, hardware sharing across
windows, mobile browsers, signed App roles/installation and privacy indicator
release remain explicit #313/#314 physical acceptance items. Digital levels are
not calibrated sound-pressure measurements; snapshots do not constitute complete
raw-audio recording. The module never connects input to speakers or enables
capture from replay.

See [developer rules](../developer/device-microphone.md) and the stable bilingual
module manual's [microphone section](../en/modules/README.md#device-microphone-input).
