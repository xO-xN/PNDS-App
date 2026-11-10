# Blank accepted input and work state (#319)

New Blank includes `public/pnds-input.js`, `performance/state.js` and actual
performer/server wiring. These are shipped source, not optional module adoption
or a pending handoff. Frozen default source detection includes both assets;
authors own subsequent changes. Existing custom projects are not rewritten.

The player policy first verifies current claim ownership. `prepareInput(id,
payload)` is side-effect-free and rejects unknown fields, bad finite geometry,
invalid normalization, phase/source/gesture mismatch, duplicate starts, missing
held contacts and a second virtual mouse contact. The technical bound is 64
contacts/source. `applyEvent(id,event)` is the one actual contact application;
invalid events return false without changing state. `release(id)` removes only
that source and publishes its changed state. Public `snapshot()` recursively
copies the performers/contact arrays and flat contact values. Recording can
capture a successfully prepared event before application and replay through the
same application without recapturing. Extending artwork state requires extending
its actual snapshot, application and release behavior too.

Both existing role connections receive `pnds:performance` full snapshots. There
is no additional input socket/namespace and no high-frequency monitor-view use.
The monitor allocates no player identity. UUID identity, socket owner, opaque
contact gesture ID, later recording source and score selection are independent.
Takeover releases the old owner's held state before accepting the new owner;
stale old controls, cancels and disconnect cannot clear its successor.

The browser adapter attaches to main and is enabled only while the actual player
is connected/admitted. Modern pointer input exclusively handles mouse and real
touch, preventing the native simulator from adding a duplicate synthetic touch.
Fallback touch samples preserve every changed contact even after this handler
prevents default; fallback mouse suppresses only compatibility input following
an actual touch. Native controls are excluded before default prevention.
Coordinates use current surface geometry per event. Terminal events retain last
valid geometry for zero-size/hidden layouts, delete the exact gesture before
releasing capture, and reject old event timestamps. Current capture ownership
protects a successor from a delayed old lostpointercapture. Blur, hidden,
pagehide, explicit close and connector loss clear owned local contacts; the
server current-owner release provides the independent disconnect boundary.

Identity/connection enablement and recording start admission are separate.
`setEnabled(false)` still cancels owned input on genuine identity/transport loss.
`setStartsAllowed(false)` only suppresses new starts during known pure playback;
it never clears an already owned gesture. The server remains authoritative for
recording admission. Playback restore and release publish only the live gesture
IDs actually cleared, and `cancel(ids)` targets those contacts. FIFO-delayed old
playback/end facts therefore cannot inject a cancel into a successor recording,
while normal playback clears its old held input and ordinary Record stop keeps
its genuine live held state for the next seed.

The agreed public test seam is create/open/save -> actual generated Node and
Socket.IO -> actual HTML-listed browser scripts. `blank_input.rs` edits real
monitor source through CreationAccess and observes actual feedback.
`blank_input_browser.mjs` executes the actual native mouse shim and generated
performer scripts in JSDOM with real Socket.IO; it covers pointer/touch dedupe,
multitouch TouchEvent data, changing bounds, native controls, old/cancelled/capture
and disconnected gestures, independent pages and zero-size explicit release.
This does not claim physical phone multi-finger, system capture, fullscreen feel
or heard audio acceptance. Keep actual device evidence separate.
