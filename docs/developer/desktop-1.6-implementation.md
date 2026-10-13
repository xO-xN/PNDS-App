# r6-final desktop implementation

Baseline: `docs/prototypes/desktop-1.6/README.md`, confirmed on 2026-10-13.
The prototype supplies presentation and interaction decisions; the current
App workflows and published project contracts supply actual capabilities.
No prototype data, in-memory services or prototype menu belong in the App.

## Scope and delivery order

1. Move shared controls to one bottom bar, keep the mode button mounted at
   its bottom-right position, and retain the Monitor document across layout,
   mode and fullscreen changes. Use native macOS window controls.
2. Preserve the floating performance sidebar, its keyboard/portal/drag
   ownership, project/folder management and selected-versus-running identity.
3. Build the compact creation navigation: pin manifest and the localized
   README, group actual paths, retain drafts and disk conflicts, and place
   packaging/handoff in the project menu. Keep manual test and Performer
   lifecycle controls connected to their existing stores and commands.
4. Categorize Settings, retain Audio, Node, HTTPS, DNS, Ports and About.
   Developer Tools is temporarily hidden per the latest user adjustment; its
   component/commands and creation compile/package entries remain. Continue existing i18n, theme and preference machinery.
5. Verify meaningful behavior through App workflow tests, run
   `npm run check:all`, then record real macOS acceptance separately.

## Existing capability to new entry

| Capability                                                      | r6-final entry                                                     | Existing owner                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| Select/preflight, import, folders, tools, drag, rename/remove   | Performance sidebar and card context menu                          | `Sidebar`, `FolderSwitch`, project workflows/store             |
| Load/replace, close, apply pending configuration, retry         | Bottom action and error recovery                                   | `SessionActionButton`, `session-flow`, `ErrorScreen`           |
| Live master gain/mute for running A while browsing B            | Bottom gain controls                                               | `volume-control`, runtime snapshot/session store               |
| Output device and sample rate, pending/applied distinction      | Bottom audio popover and Audio settings                            | `AudioSection`, preferences, runtime snapshot                  |
| LAN, node, OSC, telematic room, trusted entry                   | Bottom network popover and categorized settings                    | LAN helpers, `SettingsCard`, `NodeSection`, HTTPS/DNS services |
| Projection and fullscreen                                       | Bottom projection; native window/menu fullscreen                   | Projection/window stores and workflows                         |
| Two-click mode handoff/cancellation                             | Persistent bottom-right mode button                                | Creation store/lifecycle participants                          |
| Files, pinned manifest/README, Finder, manual rescan            | Creation sidebar and file toolbar                                  | Creation files/changes/drafts stores and trusted commands      |
| Save, rename, find, manifest form, README protection, conflicts | Existing editor under compact file header                          | `CreationFileEditor`, existing draft/file service              |
| Saved-file testing and test audio modes                         | Bottom transport and right test pane                               | Creation test store and shared session engine                  |
| Monitor preview/expand, copy address, independent devices       | Right test pane                                                    | Same Monitor instance, Performer/window workflows              |
| Compile all standard SCD sources                                | SCD toolbar; result in console                                     | Creation compile store and bounded sclang service              |
| Package saved files to chosen location                          | Creation titlebar right button                                     | `CreationBundle`, existing bundle commands                     |
| View/add handoff and README synchronization tasks               | Creation project dropdown / task feedback                          | `CreationHandoff`, handoff store/file boundary                 |
| Logs, compile reports, copy diagnostic details                  | Creation-only console toggle/shortcut; performance error diagnosis | Existing console/log/error services                            |
| Ports inspection and confirmed identity release                 | Settings → Ports                                                   | Existing scoped process commands                               |

## Relationship to #164 and release

Issue [#164](https://github.com/xO-xN/PNDS-App/issues/164) remains the complete
v1.6 native workflow and release-artifact acceptance ticket. A fresh GitHub read
on 2026-10-13 confirms #152, #153, #157, #158, #160, #161, #162, #163 and #195
as closed native dependencies. The separately tracked #210 still belongs to
v1.6.0; its five actual offline file additions are now implemented. Current
cross-ticket and real-environment evidence is recorded in
[#164 acceptance](../acceptance/164-v1.6.0-workflows.md).

UI implementation precedes #164 acceptance of the final interface. Passing
component tests or `check:all` does not complete #164: real audio, files,
processes, Finder/save dialogs, sclang, independent WKWebViews, projection,
bundle install round trips, the five actual offline modules and Apple Silicon
and Intel clean-environment artifacts require their own recorded evidence.
Neither UI closeout nor #164 acceptance implies a commit or publication.

## Acceptance record

The latest card refinement adds permanent 01/02/… ordinals in visible-list order,
including drag-clone feedback. Sorting, runtime markers, tool/error icons and
Cmd shortcuts remain unchanged. Settings temporarily removes the Developer
Tools category and routes legacy requests to General, retaining its underlying
component/commands and creation compile/package workflow. 120 focused card,
keyboard, status/tool and settings/developer tests passed. The production build
and all static checks passed; the sandbox full run passed 1,421 frontend tests,
with four HTTP-listener tests blocked by EPERM. Final ordinary-terminal evidence
and native appearance of this refinement are pending.

The user selected the right-side temporary folder-target strategy before its
implementation. Folder targets now extend beside the sidebar without changing
project-list geometry, and the pointer latch releases after an outside drop.
Audio uses Speaker. Creation transport/console controls keep their place,
disabled on empty home or expanded preview. Creation recents have a persisted
remove-history action, leaving files, drafts, runtime and performance history
untouched. 89 focused controls, history, hover, drag and capacity tests passed.
The production build and all static checks passed. The sandbox full run passed
1,420 frontend tests; four HTTP-listener tests remain blocked by EPERM. Native
acceptance and the final ordinary-terminal result are pending.

The latest entry adjustment adds a dedicated creation titlebar-right
`Generate .pnds` button for writable sources, opening the existing bundle dialog
and removing packaging from the project menu. The bottom fullscreen button is
removed; native controls, Window menu/shortcut and lifecycle handling remain.
The network trigger uses Globe. Its popover right-aligns OSC and includes shared
Node name/Hub address edits through compact `NodeSection`; blur-save, separate
token storage and next-start semantics stay intact. 152 focused bundle,
creation, settings/node, sidebar/bar, AppShell and fullscreen-store tests passed.
The production build and all static checks passed; the sandbox full run passed
1,416 frontend tests, with four HTTP-listener tests blocked by EPERM. The final
ordinary-terminal full result is pending. The user confirmed this round's
titlebar packaging entry, absence of the bottom fullscreen button, and Globe
network panel with readable, right-aligned OSC/Node name/Hub address fields.

The user confirmed the 32px creation bar height. Its native controls then moved
12px left (creation x=16px, performance baseline x=28px), with the horizontal
offset retained through native resize work. The shared bottom bar is now a deep
native drag region: blank space/spacer drags the window, while transport, gain,
mode controls and local buttons/inputs opt out. 45 focused bar, mode, AppShell
and native-control queue tests passed. Native horizontal-position/resize and
bottom-bar drag confirmation are pending. The production build and all static
checks passed; 1,416 frontend tests passed in the sandbox, with four utility
HTTP-listener tests blocked by EPERM. The final ordinary-terminal result is
pending.

The user confirmed the 768 × 560px Settings geometry is correct. The next
refinement reduces the creation bar to 32px, leaves the right status slot empty,
and gives its project trigger neutral, theme-readable rest/hover/open states
without the retired sidebar-title fade. Native geometry recorded button y=9px
and height=14px; creation container padding changes to 18px to center the native
buttons. Performance padding stays at 34px. Stage project-card selection is
brighter (#40584d) through a dedicated token; other Stage controls are unchanged.
49 focused creation/AppShell/native-control tests and the production build
passed. The sandbox full run passed all static checks and 1,416 frontend tests;
four HTTP-listener tests remain blocked by EPERM. Ordinary-terminal full-check
and native confirmation of this refinement are pending.

The preceding visual correction reduced Settings to 768 × 560px and centered it
above the bottom bar with 24px gutters. Its 40px creation topbar hosted the
existing project menu beside the native controls, with source/status hints on
the right (superseded by the refinement above). Native container padding used
creation (13px) and performance (34px) through
mode/fullscreen/layout changes. Performance's top-center overlay is removed;
Monitor document identity remains stable. Sand surfaces are deeper and Stage's
obsolete glass selection layers are deleted in favor of the shared flat style.
Validation of this correction is recorded separately from the earlier full
check below. All 118 focused creation, packaging, new-project, AppShell, Monitor,
rename and native-control queue tests passed. The bindings export and production
build passed. The sandbox full check passed all static checks and 1,416 frontend
tests; four HTTP-listener tests were blocked by EPERM. The ordinary-terminal
full result and visual confirmation of this correction are pending.

The preceding UI adjustment kept Settings at 768px wide and used
a 640px height (superseded by the correction above), added a creation topbar,
and removes the performance sidebar heading and three-dot trigger. Existing
project information, rename and remove actions move to the card context menu.
All 115 focused Settings, AppShell,
Sidebar and rename tests passed, including persistent Monitor/topbar identity,
right-click selection with an independent running project, and focus after the
context menu closes. The production build passed. The sandbox full run passed
all static checks and 1,414 frontend tests; the four utility HTTP-listener tests
remain blocked by local-listen EPERM. The ordinary-terminal full run completed
at 12:40 with all 1,418 frontend tests, 353 main Rust tests and 39 DNS tests
passing. The user reused `/private/tmp/pnds-r6-user-check-all.log`; the requested
follow-up filename was not created. Visual confirmation of this follow-up is
pending.

Implementation is connected to the real App. The ordinary-terminal
`npm run check:all` completed at 12:40 on 2026-10-13 and passed all 128 frontend
files / 1,418 frontend tests, 353 main Rust tests and 39 DNS tests. Typecheck,
ESLint, ast-grep, Prettier, Rust formatting and clippy also passed. The result
was saved to `/private/tmp/pnds-r6-user-check-all.log`; the requested
`pnds-r6-user-check-all-final.log` was not created. Two existing native-only
Rust checks remain ignored; no automated result claims their native acceptance.
The agent sandbox separately cannot bind the test HTTP listener (EPERM).

The earlier Sidebar menu focus refinement passed 52 focused Sidebar/rename
workflow tests after the 11:44 full run. The 12:40 full run includes that
refinement and the subsequent three requested UI adjustments. `npm run build`
passed with the final source, and the delivery documentation passed
`npm run format:check`.

On 2026-10-13 the user confirmed the English mode control is correct and the
three native traffic lights are visible. The first native check had count=0 and
style=8; removing decorations from window-state restoration and establishing
native Overlay produced three buttons, visible parents and style=32783. The user
requested a lower position; it was moved down about 12px, and the user confirmed its position now survives load/close. The user then requested native motion to follow sidebar reveal and Cmd-arrow project navigation; both were implemented and the user confirmed both behave correctly, with the running project unaffected. The tagged diagnostic logging was removed after the fix.

Other real macOS checks (four-theme appearance, drag/fullscreen/keyboard,
mode handoff with real audio and files, performer/projection lifecycle) remain
explicit acceptance items. GUI binding returned `Invalid app` for the existing
`pnds-app`, so these are not presented as automated native passes.
The user reports an existing `tauri:dev`; no new development server is started
by the agent. Broader #164 and release readiness are not yet established.

| Deliverable                | Actual status                                                                                                                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| r6-final UI implementation | Implemented in the real App with existing workflows, state owners, typed commands, themes and i18n. The native traffic-light position/reveal motion, English mode control and Cmd-arrow selection were confirmed by the user; the remaining native matrix above is pending. |
| #164                       | Not completed or closed. Final native workflow acceptance, actual offline-module coverage and release-artifact evidence remain required.                                                                                                                                    |
| 1.6.0 release readiness    | Not established. No architecture-specific release artifacts or clean-environment acceptance were produced in this UI task. No commit or publication was performed.                                                                                                          |

The starting worktree already contains uncommitted plans, prototypes,
documentation, locale/scripts and package changes. They are preserved; this
implementation is not their authorship or a reason to reset the worktree.
