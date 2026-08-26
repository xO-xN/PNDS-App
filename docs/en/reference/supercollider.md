# Using SuperCollider as the Sound Engine

## The SynthDef compilation contract

**Contract: the SynthDef's symbol name = the artifact's file name = the manifest reference.** All three places must carry the same name:

```text
supercollider/source/voice.scd          SynthDef('my-voice', { ... }).add;
                     ↓ compiled
supercollider/synthdefs/my-voice.scsyndef
                     ↓ referenced
manifest.json         "synthdefs": ["supercollider/synthdefs/my-voice.scsyndef"]
```

- `.scd` sources live in `supercollider/source/` and are the **single source of truth** — never hand-edit a `.scsyndef`, and never keep old build scripts in the Project;
- hyphenated names must use the quoted symbol form `SynthDef('my-voice', …)` (bare identifiers disallow hyphens);
- the compilation entry point is **App → Settings (⌘,) → Developer Tools → Compile SynthDef**; it defaults to the selected Project, or pick any folder with **Browse…**;
- the App looks for `/Applications/SuperCollider.app/Contents/MacOS/sclang` first, then `sclang` on the `PATH`;
- after compiling, the App verifies every manifest-referenced artifact by name: whatever is missing, and whatever this run actually produced, is listed precisely;
- common failure shapes:
  - **SuperCollider not installed** → the notice points to the download page (https://supercollider.github.io/downloads), or put `sclang` on your `PATH`;
  - **`supercollider/source/` missing or without `.scd`** → an explicit error: nothing to compile;
  - **a source fails to compile** → the error notice shows sclang's raw output (class-library banner trimmed) so you can tell a code problem from an environment problem;
  - **sclang timed out and was killed** → SuperCollider may be waiting on a dialog; dismiss it and retry;
  - **names don't line up** → a contract error naming the missing and the produced artifacts; align any one of the three places and it resolves.

The division of labour between `.scd` and `.scsyndef`: `.scd` belongs to authoring and debugging only; the App-hosted runtime loads only compiled `.scsyndef`.

## External Debug Bridge

A Project may provide an authoring-time `.scd` debug bridge, run manually by its creator with `sclang`, receiving the work's custom OSC in external mode.

Such a bridge:

- is never started, managed or packaged by PNDS App;
- is not part of any platform OSC standard;
- cannot replace the `.scsyndef` of the real Internal runtime;
- may carry work-specific helpers, OSCdefs and sound-design tooling.
