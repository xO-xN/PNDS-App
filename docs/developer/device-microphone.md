# Device microphone adoption and work events (#325)

`device-microphone` is an optional frozen standard module. The existing confirmed
local-resource task owns adoption, restart recovery and whole-task undo; manual
addition still means files only. No p5/ml5/audio package is required. Preserve
custom module sources, prior exact resource decisions, and the existing work's
recording adapter. Complete project wiring in the same chat task, without adding
another recorder or treating API visibility as a finished feature.

## Page ownership and input

The module creates no stream on construction. `enable` is called from a user
button, starts/resumes an AudioContext inside that action, and requests a chosen
browser-visible input using exact device id (or an explicit system-default
choice). There is one stream/source/analyser per enabled instance and no
connection to an audio destination. `devices` lists current audio inputs; the
provided controls refresh on devicechange and after permission, with errors
visible in the status region. Labels may be unavailable before permission.

The module itself rejects `PNDS_MEDIA_SURFACE.captureAllowed === false` and
`surface=venue`, in addition to the author's ownership predicate. Main/projection
monitor copies therefore retain their single-owner media rule. Independent
performers/Clients may explicitly enable their own input. A busy or unavailable
device must never cause another page's tracks to be stopped.

Each request carries a generation. Stop, switching, hidden document, pagehide and
disposal invalidate it, clear the timer, detach track listeners, stop owned tracks
and close only the owned AudioContext. A late permission result stops its stream
without changing the new owner's status. Foreground and replay do not reopen
hardware. Track end reports unavailable and requires an explicit retry.

## Data, acceptance and recording

Every 50 ms at most, one analyser provides normalized 1024-point waveform and
512-bin FFT magnitudes. Envelope is RMS with 0.8/0.2 smoothing; peak is unsmoothed.
Waveform is −1–1, envelope/peak 0–1, FFT −100–0 dBFS (silence −100), frequencies
k × actual sampleRate / 1024 Hz. Analyser smoothing is 0.8. These are digital
levels and sparse windows, not calibrated SPL or continuous/raw audio recordings.

`connectMicrophone` uses the existing joined player `sendAction`; its connected
check plus the connector's synchronous socket check drop offline samples rather
than adding a reconnection backlog. `microphoneAction`/`microphoneSample` validate
and copy all fields before the work's `prepareAction` can accept an event. The
existing player policy checks connection ownership; `recording.action` checks
admission before capture and application.

The work owns the mapping, snapshot and replay hooks. Read actual saved source,
add the chosen feature effects to `applyWork`, and include their actual state in
`snapshot`/`restoreWork`/`releaseWork`. Live and replay use the same validated
application path. Replay maps recorded identities through the existing recorder
and must never call microphone enable. Record only the derived features the work
uses; reducing the payload requires corresponding project validation and replay.

## Evidence

`device-microphone.test.mjs` drives the shipped module with controlled Web Audio,
media permissions and DOM boundaries. `microphone_chat_tests.rs` creates the real
Blank project, confirms and adopts the module through the public assistant task,
saves an author work in that task, then runs its actual page and Socket.IO/server/
recording adapter. Its four feature effects and replay are observed publicly;
undo restores original source and preserves author notes. Controlled buffers
prove calculation and lifecycle, not physical capture. Real built-in/external
inputs, device removal, system permission choices, phones and signed multiwindow
App behavior remain separate evidence in #313/#314.
