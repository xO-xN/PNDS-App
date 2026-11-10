# Camera HandPose ownership and adoption (#326)

`camera-handpose` is an opt-in module, not a Blank default. Its public creator
workflow requires existing byte-verified compatible p5 before any mutation.
Self-contained p5 2.3.2 is the maintained Template snapshot
(`87adc350e8ec0e9bced22d4f03c181bdd208dc997d3956ab3ec2e90537643c9a`);
2.3.4 is the shipped npm snapshot. Filename/header matches are not trust.
Shared p5 references pass the real offline library resolver at assistant proposal,
adoption and the manual command adapter. Unknown versions preserve author source
and fail explicitly instead of silently adding/upgrading p5.

Native proposals group the module with exact shipped ml5 1.4.0 using existing
creator decisions. Module/manifest writes remain in one durable task, with
existing/customized resources reused. Camera prerequisite is rechecked before
adoption to fence changes during confirmation. The module publication remains
exclusive/atomic and every model piece uses the existing guarded text journal.
Encoded pieces are <1MiB. Module adoption validates the exact final serialized journal shape before publication and keeps the durable record pending until the directory is published. Both the pending and committed forms must fit the existing 16MiB limit; no limit is raised. A full existing author task fails through the same narrow companion rollback as publication failure, preserving prior approval, existing ml5 references and author edits. Only a manifest journal entry introduced by the failed adoption is removed.
Do not replace this with unjournaled binary copies or generic network fetching.

Models are original MediaPipe HandPose lite v1 files from the exact TF Hub URLs
in `PINNED.json`, with original JSON/shard hashes and Apache-2.0 text. Text weight
pieces decode only after local ml5/model integrity validation. Only fixed model,
shard and script routes are served; unknown paths receive no bytes. Browser
assets and Worker imports stay within the confirmed same-origin module prefix.
There is no CDN/download or alternate inference route.

`PNDS_MEDIA_SURFACE.captureAllowed === false`, `surface=venue`, the author’s
`isOwner()` and the page generation all gate capture/inference. A stopped,
background, replaced or disposed owner cannot publish late frames or retain late
getUserMedia results. A submitted frame’s own dimensions accompany its Worker
result. Projection consumes accepted main-monitor state, while independent
performer/Client pages may explicitly activate their own instances.

`createHandPoseWork` provides an editable concrete work state (marker position and
pinch/open color), bounded validation, common action application and recovery.
Compose its hooks with author hooks; do not replace customized works. Actual
admission/claim ownership stays with players, capture with the common recording
adapter, and replay with applyWork. Use connected/admitted volatile input delivery
without reconnection queues. Model readiness alone is not inference readiness.

The public creation/chat integration test wires an actual generated Blank,
observes accepted Socket.IO actions and visible state, records/replays the same
marker, then packs/installs the real `.pnds` and repeats against installed bytes.
The optional Chromium probe uses the actual local ml5/model Worker on controlled
black pixels; it proves offline inference/cleanup, not physical capture or a
recognized real hand. Native Client/Host/performer physical permission/capture,
input switching/sharing and phone hand inference remain separate #313/#314
acceptance. Stable installed help stays in `help/<tree>/modules/README.md`.

Callback ownership is captured before any external `onState`/`onSample` feedback.
Such callbacks may stop, dispose or replace the activation. Each continuation,
permission request, Worker creation and frame/sample schedule rechecks its exact
generation, author ownership and foreground state. A Worker returned across a
synchronous progress callback belongs only to that creation attempt and must be
disposed locally if that attempt was retired; it must not replace/close a newer
activation's Worker. The same rule applies to motion and microphone feedback.

Self-contained p5 detection uses the existing visible `CreationAccess::list` and
held-root `project.file` boundaries, known byte lengths and exact trusted hashes.
It imposes no `public/` or filename-extension convention; for example an author's
`vendor/p5.bundle` remains valid. Private and escaping paths do not gain access.

Work-state fields alone do not prove a rendered effect. The public chat fixtures
save author-owned monitor renderers in the same task, execute the actual served
monitor HTML and scripts through real Socket.IO, and check concrete SVG geometry,
color, opacity, waveform and spectrum changes plus replay. These renderers are
fixture compositions, never Blank defaults or imposed musical mappings.
