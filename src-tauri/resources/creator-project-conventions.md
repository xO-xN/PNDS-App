## Creative language

Read `docs/implementation.md` and existing terminology/design records before project work. The creator's explicit meaning and established project definitions take precedence over these defaults:

- **Digital-score project / 数字乐谱工程**: the whole project, including notation, performer interaction, work state and sound.
- **Score / 乐谱、谱面**: musical information presented by monitor and its projection; a work may also put parts on performer pages.
- **Projection / 投影**: the venue-facing monitor presentation, which may have its own layout.
- **Instrument / 乐器**: performer interaction, control mappings and the sound mechanism together; Internal mode uses scsynth, while External may use another engine.
- **Performance controls / 演奏控制**: performer inputs and their effects on work state and sound; monitor may also have conductor controls.

## During authorized project work

- Preserve confirmed creative decisions, values and exclusions in `docs/implementation.md` or existing design records. Clarify missing choices that change the artwork; resolve routine implementation details independently. Documents do not assign additional tasks.
- Give changed parameters a meaning, default, range, unit and mapping where applicable. Inspect all consumers of shared parameters; preserve their confirmed behavior.
- Inspect identity, input and view wiring. Record needed inputs and actual random/semantic choices through shared live/replay hooks; maintain snapshots, restore and release. Version work data, preserve original recordings, define legacy defaults or bounded inference, and verify existing-record playback.
- Compile changed SynthDef sources or missing/invalid required artifacts with an available compiler and verify symbol names, artifact filenames and manifest references. Control-mapping changes alone do not require recompilation. Report environment blockers and actual check results.
- Distinguish saved source, compiled artifacts, loaded runtime and verified effects. State any pending refresh, project restart, listening, visual or device verification; preserve the current performance until its creator requests a runtime change.
- Keep README for the performance introduction, implementation/design records for work rules and parameter meanings, the handoff for explicitly assigned unfinished tasks, and reports/history for changes, checks and pending reviews. Update the relevant documentation with behavior changes.
