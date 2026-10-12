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
- open an editable folder Project in **Creation mode**, select an `.scd` file and use **Compile SynthDefs** in its toolbar. The button compiles the whole saved `supercollider/source/*.scd` set, regardless of the selected file. Bundle installs, built-in tools and read-only folders cannot compile;
- save or reload all SCD and root manifest drafts first; unresolved disk conflicts and in-flight saves also block compilation. A schema-valid manifest can be saved with missing artifact references, then compiled. A running compile cannot be submitted twice;
- the App looks for `/Applications/SuperCollider.app/Contents/MacOS/sclang` first, then `sclang` on the `PATH`;
- the console lists the compiler used, produced artifacts, compiler output and every `audio.synthdefs` reference, including in External and None modes. It compares the artifact file name with the name in its [documented SynthDef header](https://doc.sccode.org/Reference/Synth-Definition-File-Format.html); missing, invalid and unchecked references remain visible;
- compilation stages artifacts in a temporary directory and rechecks the project identity and saved inputs before writing. If inputs or artifacts changed during the run, reload or save and compile again. Successful writes update the file tree and leave restart pending. **Restart manually** to apply them; compilation does not refresh a page, start a session or replace the running version;
- common failure shapes:
  - **SuperCollider not installed** → the notice points to the download page (https://supercollider.github.io/downloads), or put `sclang` on your `PATH`;
  - **`supercollider/source/` missing or without `.scd`** → an explicit error: nothing to compile;
  - **a source fails to compile** → the console shows sclang's raw output (class-library banner trimmed) so you can tell a code problem from an environment problem;
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
