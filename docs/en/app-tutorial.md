# PNDS App Tutorial

This guide covers the PNDS App's core interface, how Projects are organised, audio and communication settings, and the multi-device workflow of a live networked performance.

---

## 1. First launch and permissions

- **Open the app**: launch PNDS App to reach the welcome screen.
- **First launch (macOS security confirmation)**: the current release is ad-hoc signed and not notarised with Apple, so the first launch is blocked with a warning that the developer cannot be verified. In the Applications folder, right-click PNDS and choose **Open**, then confirm **Open** in the dialog; or go to **System Settings → Privacy & Security** and click **Open Anyway**. You will not be asked again.
- **File access permission**: on first run the system asks for access to the local file system — choose **Allow** so the App can read, load and manage your local score Projects.

---

## 2. Managing and organising Projects (left sidebar)

The App's **left sidebar** is the main working area; it manages the full lifecycle and hierarchy of your performance Projects:

- **Import a Project**: click the **`+ Import Project`** button at the end of the Project list, or press `⌘ O`, to import a `.pnds` file into the current user folder, or **Home** when no grouping is selected.
- **Folder organisation**: choose custom performance folders from the scrollable dropdown, with no folder-count limit. Create from the dropdown or context menu; rename, move up/down, export and delete from the current folder’s context menu. Deleting only removes the grouping, preserving project files.
- **Free ordering**: drag Project cards to reorder members. A temporary folder list appears while dragging: drop onto a user folder to append there, or Home to ungroup it. Newly opened projects join the current user folder; each list retains its 30-project addition cap.
- **Independent Utilities**: the Utilities button opens the registered tools and replaces the user dropdown with a return entry. Click Utilities again or Return to restore the previous view; a deleted folder falls back to Home. Browsing never stops a performance or applies pending audio changes. Opening a user project from Utilities returns to the preceding user folder first.

---

## 3. Audio and communication settings

Clicking a sidebar card selects and preflights it without starting. The bottom bar contains transport, refresh, live gain, audio, network, projection and Settings. Settings uses category navigation for Audio, Node, HTTPS, DNS, Ports and About. Developer Tools is temporarily hidden; compilation and packaging remain available in creation mode.

- **Performance audio**: Load uses the manifest default. The performance interface offers no audio-mode selector; creation tests retain the saved manifest's allowed Internal / External / None choices. See [audio-modes.md](../reference/audio-modes.md).
- **Local network**: the bottom network panel shares the global LAN choice with Settings → Node. Changing the running selection flags Change for an explicit restart; another selection only prepares its next start. Applied and next-start addresses are separate, and the monitor never retargets immediately.
- **Device and sample rate**: the bottom audio panel and Settings → Audio share the existing preferences. Applied device and actual rate come from the run; editing preferences never restarts automatically.
- **Live gain**: the bottom speaker and slider control running A even while browsing B. Internal mono/stereo allows attenuation; multichannel fixes gain at 100% / 0 dB. External / None disables gain. `⌘ M` mutes/restores, with the existing fresh-run defaults.
- **OSC and Room**: a default-External project's target and a telematic project's Room remain in the network panel with their original next-start semantics. Node tokens stay masked.

---

## 4. Built-in utilities

The sidebar's independent **Utilities** button offers ready-to-run validation Projects covering audio, network and phone-sensor checks (in a fixed order):

- **Multichannel Gen** ([Multichannel-Signal-Generator](https://github.com/xO-xN/Multichannel-Signal-Generator)): a 16-channel signal generator. When — verifying your audio interface's channel mapping, wiring and reinforcement setup, especially before a multichannel work goes on. Once loaded, its monitor offers 16 vertical faders to confirm, channel by channel, that sound goes where it should.
- **Local Diagnostics** ([Local-Network-Diagnostics](https://github.com/xO-xN/Local-Network-Diagnostics)): local-network diagnostics. When — checking the Wi-Fi leg from performers' devices to the Host (latency / jitter / loss) before a show; performers scan and test from their phones.
- **Telematic Diagnostics** ([Telematic-Network-Diagnostics](https://github.com/xO-xN/Telematic-Network-Diagnostics)): cross-internet diagnostics. When — the go / no-go verdict on the hub star network before a multi-site performance (see [Cross-internet performance](#6-cross-internet-performance-multi-site) below); every site's monitor shows the same flower view — green means playable, red names the faulty site and leg.

- **Sensor Meter** displays phone motion-sensor data to check device permissions and sampling behavior. Follow its page to connect a phone. Prepare [trusted HTTPS](./reference/https.md) for APIs requiring a secure context and grant permission on the phone. Desktop simulation does not reproduce real phone sensors.

Utilities load and run from the sidebar like any Project; details and verdict thresholds live in each tool's repository.

---

## 5. Loading a Project and the multi-device performance workflow

Before you begin, connect the Host Mac running PNDS App and every performer's device to the same local network; a wired connection is recommended for the Host, with performers' devices (phones / tablets) on the same Wi-Fi.

Once the settings check out, click the **Load** button to start the Project:

1. **Service startup**: the App starts the Project's own **local digital-score server** and, in Internal synthesis mode, the **DSP audio engine**, using the configured parameters.
2. **Enter the conductor view**: once the Project has loaded, the sidebar slides away to the left and the main view switches to the full-screen **conductor view**.
3. **Performers join from their devices**:
   - **Join by QR code**: click **Performer QR code** in the bottom bar, then scan it with a phone. The App displays it on the projection when that window exists, otherwise over the main monitor. Click again to hide.
   - **Open in a browser**: on any device's modern browser, enter the Host Mac's LAN address and the performer port to join the system.

---

## 6. Cross-internet performance (multi-site)

PNDS evokes "many ponds, connected": several sites, each a Mac plus its local performance system in its own city, join through a public relay (the hub) to perform one work across the internet. The standard shape is the **star hub relay**; the workflow (networking principles and the room / token semantics in [performance networking](../reference/network.md)):

1. **Deploy the hub**: install [pnds-hub](https://github.com/xO-xN/pnds-hub), the cross-internet relay server, on a public VPS, following its repository's deployment guide (a systemd service behind a TLS reverse proxy; the shared token is generated at install time). The hub only relays control messages between sites — every site connects **outbound**, so no inbound port ever needs opening at a venue.
2. **Configure the node on each site**: open the settings panel (`⌘ ,`) on each site's Mac and fill in the three **Node** rows — the **node name** (this Mac's name in the star diagram, e.g. `site-a`), the **hub address** (the full `wss://` URL) and the **token** (shown masked). The three are machine-global: enter them once and every Project shares them; changes take effect the next time a Project starts.
3. **Verify the network (go / no-go)**: load the built-in **Telematic Diagnostics** (see [Built-in utilities](#4-built-in-utilities)) on every site — the App-injected node configuration is its connection configuration, connecting automatically with nothing to retype in the form; with any of the three rows empty the Load button becomes **Set up node**, prompting the configuration first. Every site's monitor then shows the same star-shaped **flower view**; a green / red banner gives the verdict and names the faulty site and leg.
4. **The performance**: load the actual work (its manifest declares cross-internet capability and it implements the hub protocol — Telematic Diagnostics is the reference implementation). The App derives the room from the work automatically — sites running the same work in the same Room group (the bottom network panel’s Room dropdown, 1–3) land in one room, and a wrongly opened work cannot see in; performers join **their own site** by QR code as usual, and real-time audio between sites rides an external transport such as JackTrip.

---

## 7. Live controls and summoning the sidebar

During a performance or rehearsal, when you need to switch the audio output device, change volume or check connections:

- **Edge hover**: move the pointer to the far left edge of the window and the settings sidebar glides in.
- **Keyboard summon**: hold `⌘` to reveal the sidebar. It hides once the key is released and the pointer leaves. Dropdowns, dialogs, mode confirmation and startup/shutdown operations keep it visible until they finish. The sidebar overlays the full-window monitor; revealing or hiding it never resizes or reloads the page.
- **One performance action**: the footer offers Load, Change or Close as one full-width button. Selecting another Project leaves the performance running; Load asks before replacing it. Apply network, device/rate or External-target edits with an explicit Change; the error page keeps Retry.
- **Native selection**: `⌘ ⌥ ↑` / `⌘ ⌥ ↓` selects the previous/next visible Project and reveals the sidebar even while the monitor or a text control has focus. Only the performance main window acts; the active list never wraps and selection never loads a Project. Confirmations, App popups, startup/shutdown and their pending submissions block it. Creation, performer, projection and help windows retain their own keys. Left/right has no new navigation.
- **Projection and intro**: one bottom-bar projection button opens the venue window, then the same button switches its intro/performance content. Start Projection reveals its monitor; Withdraw Projection restores the intro. Refresh reloads the monitor page; the menu and `⌘⏎` keep projection control. Help remains available from its menu and `⌘ ?`.
- **Full-screen performance**: `⌃⌘ F`, the Window menu or the native green window control enters full screen; the monitor page adapts to the new size.

---

## 8. Creation reading workspace

The same mode button stays at the bottom right. Hover/focus reveals the target; click once to arm, then again to switch. Only unsaved-content loss adds a consequence note above the button. With the button focused, Enter or Space performs the same two-step
confirmation. Esc, clicking elsewhere or losing window focus cancels confirmation.
Choose **Open folder project** or continue from **Recent creations**. In creation
mode, `⌘ O` also selects a folder. Opening never starts the project.

Use **Generate .pnds** at the creation titlebar right to pack saved files; the project selector switches or creates projects. The middle workspace has fixed Discussion / Git versions controls and one closable file tab. Open the handoff from the file list as normal Markdown; closing the file returns to Discussion. Installed `.pnds` bundles and utilities remain read-only, including through symlinks. Cancelling a selector preserves the current project.

Purpose view pins Project settings, Piece introduction and Handoff. Known files show their purpose beside the real filename, such as Conductor interface | monitor.html and Performer interface | performer.html. Technical files folds configuration and compiled artifacts, retaining unsaved/conflict indicators; search reveals matching files. Dependencies summarizes saved declarations without listing package internals. Use File list to see the real directory hierarchy and filenames, then Purpose view to return. Switching preserves selection, editor drafts and runtime. Tree search and Quick Open accept English/Chinese purpose names and real paths. Select text to read and find within the current file. PNG, JPEG, WebP and
GIF preview only when selected; decoding failure leaves information and Finder
access available. Audio and other binaries show name, type and size for use in
an external application. The file column's More menu opens the project folder or rescans files; the file toolbar’s action menu reloads disk content, reveals the current file and renames it. Root manifest rename remains disabled.

Text is limited to 1 MiB, images to 4 MiB, and the file list to 4,096 entries and
32 levels. `.git` and `node_modules` are omitted. Missing files, permissions,
invalid UTF-8, size limits, invalid project identity and escaping paths have
distinct feedback. Refresh the file list when needed. Creation opening checks
basic declarations and entry structure, so an initial draft can be read before
dependencies or sound artifacts are built. Running and packing keep their own
checks.

Use Git versions to inspect and save project versions; Git status and differences retains advanced staged, unstaged and untracked inspection. See [Project versions and history](#project-versions-and-history) for operations and limits.

Partial clone repositories report that inspection is unavailable because required objects may be missing. Complete the repository in your external Git tool first; the App never downloads missing objects or modifies the Git object store.

Unsaved drafts, saved disk files, Git HEAD and running content are separate facts. Viewing Git does not save drafts, refresh pages, restart testing or prove which content is running. Disk changes, returning from another tool and snapshots open for 30 seconds mark the result potentially stale; use **Refresh Git** to read again. Changing projects or closing the panel discards the inspection, and late responses cannot appear in another project.

A running editable folder takes precedence over another selected card and enters creation with the same runtime and monitor; an idle folder does not start automatically. Noneditable targets end the old runtime and enter creation home. Entering creation closes projection; returning to performance ends testing and returns to idle home. Start creation in a performance card’s context menu opens that specific editable project directly, asking before ending another run.

Use the SCD toolbar to compile the standard source set and inspect console results. Real-time testing selects an allowed saved audio mode and starts, restarts or closes the run explicitly. Window → Refresh Score Pages (`⌘⇧R`) refreshes pages. Open the console from the bottom bar or Command + backtick; expanding monitor changes layout only and Esc restores it. Add resources in the file column offers local modules and shared packages with versions, target files and dependencies. See the [module manual](./modules/README.md#v161-offline-standard-modules) for provenance and wiring boundaries: copying alone does not complete integration.

---

## Project versions and history

The Git entry beside the project name opens **Git versions** for saving, inspecting relationships and differences, and explicitly switching to an earlier version to continue. Selecting a version only inspects it. The Unified / Split segmented buttons change the difference layout. The advanced Git status and per-file history remain available. The App supplies local Git on Apple
Silicon and Intel; these actions need neither system Git nor a remote login.
No Git action runs project hooks, external diff, filters or network helpers.

Blank and Classic receive an independent initial version before creation
succeeds. Review the version author in the creation form: it follows the creator
until you edit it, or defaults to `PNDS Creator`. Email is optional; a blank email
uses the disclosed local placeholder `creator@pnds.local`. This signature is
separate from the project creator and changes only the current repository.

Opening an existing folder never enables Git automatically. Choose **Enable
local version recording**, review the file scope, identity and initial message,
then confirm. If initialization succeeded but recording failed, keep the folder
and preview again to complete the missing step. Existing history is preserved.
Parent/nested repositories, linked worktrees and other unsupported write
structures need external tools; their supported read-only inspection remains.

In Git versions, **Save current version** saves all editor drafts before recording eligible files; a draft conflict blocks recording. Names continue from the current version’s series, such as “Breath → Breath 1 → Breath 2”, skipping names already used when continuing from an earlier version. Inspecting a historical version never changes the naming origin.

After saving, use Rename version beside the name to edit any local version’s display name. Only that version changes. Rename the current version to “Flow” and the next default becomes “Flow 1”. Commit IDs, project contents and relationships stay unchanged. Names are kept in local repository configuration; ordinary push/clone and `.pnds` bundles do not transfer them.

The advanced recording dialog still selects complete saved files, accepts a commit message and requires review. In that dialog, drafts, unapplied proposals and temporary previews remain separate and are not saved or included automatically. External staged content on a selected file
must be handled in another Git tool; unselected staged entries are retained.
Files, HEAD or index changing after preview require another preview. No empty
commit, reset or automatic repair is made. Success shows the real commit ID;
index/config warnings after that success do not mean the commit should be repeated.

Existing ignore rules are followed. Dependencies, caches, build output, App data,
`.env` files and known secrets are excluded. Audio/video/model files of 10 MiB
or more are unselected by default and can be explicitly included; already tracked
resources stay visible. Each file is limited to 64 MiB, collection to 256 MiB,
and inventory to 4,096 entries/32 levels. Included resources can increase history
storage; Git recording is not a complete resource backup. Filter/LFS-dependent
writes, required signing, locks/conflicts, partial clones and missing objects
require an external Git tool. PNDS never fetches missing objects.

History shows at most 30 relevant commits, following up to 300 first-parent commits from HEAD, and
states when more history may remain. Select a commit and a path to compare its
text with current saved content and the separate draft. **Review load into
draft** supports only one currently existing editable text file. Keep or cancel
an existing draft, or explicitly replace it. Loading changes only the draft;
then open it, inspect, save and test explicitly. The current disk version remains
the save-conflict base. Deleted files are not recreated; binaries, directories,
unsupported text, escaping links and unreachable history are refused. Text is
limited to 1 MiB. Saving still validates content and rejects unseen disk changes.
Recording and loading never refresh/restart the running project or certify sound.
Git history, local App data and project-local `.pnds-creation/` chats and materials
do not enter a performance `.pnds` bundle. To move a creation workspace, copy the
complete project folder, including hidden files; each copy's later records stay
independent.

## Switch and restore project versions

Selecting a historical version in Git versions only inspects it. Confirm Switch to this version to change disk content. With existing changes, save a version first, cancel, or explicitly confirm discarding eligible changes in a second step. Restore this version’s contents uses the same protection even at the current version. Ignored and excluded files are not eligible discard targets.

For example, after A → B → C, switch back to A and save new work as D: a new local branch retains access to B and C. The branch selector inspects and switches existing local branches. Version display names and branch names remain separate; use external Git tools for merging and remote synchronization.

Explicitly end unfinished assistant tasks and stop the project run before switching. Switching never replays goals, chats or saved changes. Failed stopping or a foreign active runtime blocks switching. Cancellation preserves files and drafts; after a successful switch, start and test manually instead of relying on old results.

## Configuring a model service

Open Settings (`⌘ ,`) → Model service and enter the API base URL, model name and
key for an OpenAI-compatible service supporting text conversations and tool calls.
Use the service's base URL, including `/v1` when required, and its exact model name.
Remote services require HTTPS; a local loopback service can use HTTP.

The URL and model are saved in local preferences; the key is stored in the macOS
Keychain. Reopening Settings shows whether a key is saved without refilling it.
Enter a new key to replace it, or explicitly remove it. Save and Keychain failures
are visible and never fall back to a plain-text file.

Test connection uses the current form values, including unsaved edits. An empty
key input uses the saved key. The test verifies a text reply and a controlled tool
round trip without reading or sending the current project. Authentication,
network, timeout, protocol and unsupported-tool failures have distinct feedback;
retry manually after correcting the problem. A successful connection test does
not verify or run your project. Local editing, saving and manual testing remain
available when the model service is unconfigured or unavailable.

## Asking about installed PNDS documentation

Consulted documents counts files; section links combine pages, with original returned ranges available on expansion.

An editable project opens on the discussion surface. After configuring the model
service, enter a question and click Send or press Enter; Shift+Enter adds a line
break. The assistant consults the local help shipped with this App version and
sends the project overview and saved text it reads as needed to your configured
model service. Unsaved content is sent only in selections you attach. Verified source buttons open the
actual section in its original language. Replies that did not consult local
sources are marked accordingly; model-written citations are not verified sources.

Start with an idea in **PNDS creation assistant → Discussion**, and agree on how to implement it. The assistant looks up available project facts, asks one consequential question at a time with a recommendation, and clarifies ambiguous terms through concrete performance scenarios. Each answer prompts a check of the original requirements and remaining choices; question counts do not determine completion. Ordinary questions receive direct answers. Discussion never edits files, runs checks or writes a handoff.

Questions are labeled Q1, Q2, … within each chat. Click an option to send it immediately; its Recommended badge sits at the trailing edge. The own-answer box is always visible: Enter or its send arrow sends, Shift+Enter adds a line, and IME composition does not send. Choose Cancel this discussion round in the conversation More menu to end the round. File-replacement conflicts retain a separate explicit confirmation.

Once consequential choices are settled or explicitly excluded/deferred by you, the main reply presents the full plan: goal, scope, agreed choices, acceptance, unaccepted suggestions and deferred items. Review that plan and choose:

1. **Write handoff file** turns the same plan into an editable task draft. Preview it, then choose **Record handoff** to update `docs/creator-handoff.md` and capture a comparison baseline. The selected plan and submitted answers remain the implementation task; writing the handoff is an action, not a replacement task. Resolve consequential questions before selecting a route; a newly discovered conflict returns to clarification before a draft can be recorded.
2. **Start work** adopts the same plan, immediately creates a new implementation task and selects **Work** below the composer, then saves changes and checks them. No handoff file is required first. The plan and submitted answers carry forward; unaccepted suggestions and deferred items do not automatically become implementation requirements.

## Record a handoff and continue externally

The dialog starts with a readable task and **Edit task** when changes are needed; you do not supply an initial status. **Preview handoff** shows the complete active document to be written. A new revision of the same task replaces its old block; independent unfinished tasks and unknown content stay by default. Use the optional **Manage existing content** editor to correct old errors or obsolete work, then preview again. Corrections preserve the previous saved document at `docs/handoff-history/<contenthash>.md`. The App does not infer completion or silently delete old errors from chat.

After the actual write, the originating chat reply provides **Copy prompt**. It includes the actual project location and all four App-bundled instructions in the chat language (Chinese or English), independently of the interface language; no skill installation or GitHub download is needed. Paste it into your external coding agent to complete all current tasks in the handoff; the App does not dispatch it. The agent reads existing project terminology and design documents, implements the tasks and runs checks, then archives the full previous handoff, changes, check results and unverified items under `docs/handoff-history/` before removing completed items or replacing superseded rules. Pending creator sound, visual or device review is recorded in history and does not by itself keep implemented and checked tasks active. Archiving needs no further approval. Unimplemented or blocked work stays active, and existing history is preserved. The App's per-record comparison baselines stay the initial origins, separately from final execution reports.

Discussion plans stay in the project's chat history; the App does not create `creation-plan.md` by default. During authorized recording or implementation, durable terms and design decisions can be kept in suitable existing project documents as needed. Separate ADRs are reserved for important decisions that are costly to reverse.

You can also select Work and send a specific task; switching mode alone starts nothing. Send “Please organize the project” to enter Work directly and organize structure, names, references and evidenced duplication using PNDS defaults, preserving existing sound, visuals, algorithms and performance interactions. Add rules in the message or name a project document or creation material, for example “Please organize the project following docs/rules.md”. If the assistant suggests organization, it waits for your choice. You can request a handoff directly with “Write a handoff file”.

Failed checks feed diagnosis and repair within the same work task; blockers are reported explicitly. A busy runtime receives only the permitted static checks, without stopping the existing performance. Actual sound, visuals, devices and performer interaction still need verification after implementation.

The arrow beside the composer sends a message. A rotating loading ring appears during replies and work; its center button pauses the current task. New unsent text and already saved changes are kept. Chat shows no server consumption or body loading dots. Pale Expand thought process text appears only when public activity is available, without private model reasoning. Synchronization and context details remain available on demand; limits and failures remain explicit.

Stop while the assistant reads or prepares a reply to keep your input, produced
text and sources. Correct an error and retry manually. Changing projects, returning
to performance mode or changing model configuration cancels the request; late
responses cannot enter a new context. Tool, document and context resource limits
are reported explicitly when exceeded.

Open a file for full editing and return to the discussion without losing input,
replies or individual file drafts. Existing handoff documents remain available
through their reading entry. The right monitor keeps the same page; opening code
does not refresh or restart it. Drag the separator to change the reading/monitor
width, or focus it with Tab and use the arrow keys. Home or double-click restores
the default. Width is remembered locally and constrained by readable minimums in
narrow windows. The console remains the existing dock beneath the current
workspace, opened from the bottom bar or its usual shortcut.

## Restoring and clearing project conversations

Conversations and creation materials are saved in the project's hidden
`.pnds-creation/` directory. Keep that directory when copying, moving or renaming
the complete project folder to carry its records. Reopening the project or
restarting the App restores messages and verified sources. Each copy's later
messages, clears and material changes are independent. Symlink aliases of one
actual folder share records; matching manifest IDs do not merge separate folders.
Performance `.pnds` bundles and Git versions exclude this private creation data.
To move a creation workspace, copy the complete source folder, including hidden
files.

Opening an older project at its original path automatically migrates existing
local records and keeps the originals as backups. Existing project records are
never overwritten or merged with them. Open the original path once before moving
the folder; if it was moved already, restore that path once to migrate. Task
execution checkpoints and undo journals stay on the original machine; moving
chat history does not resume old tasks. Configure model settings and keys
separately on the destination machine.

Restored pending replies are marked cancelled. Historical attachments and
suggestions display their saved text, origin and versions; they do not reread the
current file, replace drafts, send project content, apply changes or restart a
preview. Past test results describe the past, not the current running project.

The discussion toolbar reports saving and failures. Retry a failed save explicitly.
If loading fails or the format is unsupported, reload or use Clear conversation
after confirming. A stale history version requires confirmed reload or clearing;
reloading replaces in-memory messages and stops the old request while keeping
your input and file drafts. Clearing affects only this project's conversation,
preserves input and files, and cancels the active request. Cancel the confirmation
to keep the conversation. A failed clear retains the records; late replies cannot
restore successfully cleared messages. Tab and Enter operate these controls, and
Escape cancels the confirmation.

## Inspecting and releasing ports

Open Settings (`⌘ ,`) → Ports to inspect the selected project's manifest performer and monitor ports. Creation mode reads the workspace's saved manifest; drafts do not change the query target. With no target, the defaults are 6868/6869. The section queries once on entry; click Refresh to update it. There is no background polling.

An external listener shows its PID, process name and complete command line. Release asks you to confirm that identity. The App verifies the same process again before signalling, waits for graceful exit and uses bounded force exit when needed. If the listener disappears, changes identity or becomes managed by this App, release cancels and refreshes; confirm the new identity before trying again. The startup error page's Release and Retry also confirms first, and retries only after a successful release reports the port available.

Ports held by this App show their actual running project and ask you to close the project; they offer no direct Release. Selecting B while A runs queries B's ports. Ownership uses A's ports applied at startup and real child processes, so B's different ports are never labelled as running A.

---

## Appendix: shortcut quick reference

The shortcuts an App user reaches for (creators asking "which keys can my pages get?" — see [page interaction](../reference/page-interaction.md)):

| Shortcut                   | Action                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `⌘ O`                      | Import a Project                                                                                                    |
| `⌘ 1`–`⌘ 9`                | Select the Nth visible Project                                                                                      |
| `↓` / `↑` (inside sidebar) | Next / previous Project                                                                                             |
| `⌘ S`                      | Save the current creation file                                                                                      |
| Command + backtick         | Toggle the creation console                                                                                         |
| `⌘ ⌥ ↑` / `⌘ ⌥ ↓`          | Native previous/next selection; performance main window, including monitor/input focus                              |
| `⌘ ⌥ Enter`                | Load the prepared selection; confirm a live replacement; restart pending changes; unchanged running card is a no-op |
| `⌘ ↑` / `⌘ ↓`              | Select previous / next visible Project                                                                              |
| `⌘ R`                      | Rename the selected Project / folder                                                                                |
| `Enter`                    | Load the Project / restart after a change                                                                           |
| `Esc`                      | Cancel mode confirmation / dismiss an overlay                                                                       |
| `⌘` (hold)                 | Summon the sidebar + number badges                                                                                  |
| `⌃ ⌘ F`                    | Enter / leave full screen                                                                                           |
| `⌘ M`                      | Master mute / restore                                                                                               |
| `⌘ =` / `⌘ -` / `⌘ 0`      | Monitor zoom in / out / actual size                                                                                 |
| `⌘ ⇧ R`                    | Reload the monitor page                                                                                             |
| `⌘ ,`                      | Open / close the settings panel                                                                                     |
| `⌘ ?`                      | Open the help center                                                                                                |
| `⌘ W`                      | Close window (confirm flow while running)                                                                           |
| `⌘ Q`                      | Quit the App (confirm flow while running)                                                                           |

In the performance main window, `⌘ ⌥ Enter` can load a prepared project while a page or input has focus. An unfinished preflight is not queued: press again after preparation. See [Page interaction](./reference/page-interaction.md#the-monitor-pages-keyboard) for complete key ownership and gating.

## Static project diagnostics

Assistant tools and the bundled CLI share a saved-file static checker. The current workbench has no manual Static Doctor button or report panel. Work invokes checks within its task; use real-time testing for a manual run.

```sh
/Applications/PNDS.app/Contents/MacOS/pnds check /path/to/project --json
```

Static checking excludes drafts and neither executes project source, reserves ports nor installs dependencies. It remains available during performance. Reports distinguish blockers, warnings, skipped and unverified behavior; disk changes make prior evidence stale. Static success does not certify pages, runtime or sound. Run `pnds --help` for parameters.

## Controlled saved-copy checks

Assistant work tasks and the CLI can check a saved temporary copy. The current workbench has no manual Controlled check menu or dialog. None is the default and requires declared support; Internal needs explicit selection; External uses manual testing. Editor changes and manual saves do not start a check automatically.

```sh
/Applications/PNDS.app/Contents/MacOS/pnds check /path/to/project --run --json
/Applications/PNDS.app/Contents/MacOS/pnds check /path/to/project --run --mode internal
```

Reports retain actual input/dependency/version fingerprints, health/HTTP, results and cleanup; copy outputs are not adopted. App startup, performance, shutdown or another owned check blocks new runtime checks without stopping the current run. Work repairs actionable failures within its task; actual visuals, phones, devices and sound need manual verification.

Ctrl-C/SIGTERM cancels the CLI and waits for cleanup. Exit 0 means check and cleanup passed, 1 failed/not executed, 130 cancelled and 2 invalid parameters/output. `--app-root /path/to/PNDS.app` supplies complete local resources, never global Node. Unconfirmed cleanup blocks new runs; retry after release, or restart the Mac when ownership evidence is incomplete. Sequential copying is neither an instantaneous atomic snapshot nor an OS sandbox for arbitrary code.

## Single-file differences and undo

After editing one existing text file, choose “Review change” to inspect the
actual before/candidate difference. Cancel keeps the draft. A successful “Save
reviewed change” shows the actual saved record; “Undo saved change” restores
the original text without Git.

Undo applies only to the current workspace's latest recorded single-file
change. Later manual/external saves, renames, deleted targets or unresolved
drafts reject the old action without overwriting newer work. Switching or
closing a workspace revokes its old identity; records do not survive App exit.
A failed check never automatically undoes the file or adopts copy artifacts.

## Editing project text

Open a text file from the tree or use **Quick open file** (`⌘P` while working in
the creation workspace). Search uses the current project's file list; arrows
choose a result and Enter opens it. Large, unreadable and binary files retain
an explanation rather than becoming editable.

The editor shows line numbers and syntax colors for JavaScript, TypeScript,
JSON, HTML, CSS, Markdown and SCD; other readable text uses plain text. Colors
do not mean code has passed validation or compilation. Use **Find and replace**
(`⌘F`) for the current file, or **Go to line** (`⌘G`). Replacements change the
draft and can be undone. Tab/Shift+Tab indent a selection; Escape then Tab leaves
the editor. Undo/redo (`⌘Z` / `⇧⌘Z` or the toolbar) stay with each file when
switching files or layouts during this project session.

**Save** / `⌘S` writes explicitly with the existing manifest/README validation
and disk-version conflict protection. Saving does not refresh or restart the
running project. Cancelling a disk conflict keeps your draft; explicitly adopting
a disk version resets draft undo/redo and announces that boundary. Histories are
not restored after restarting the App. **Undo saved change** is a separate
version-checked operation on a recorded disk write.

## Discuss saved project text

Sending in an editable project supplies short local facts and permits on-demand reads of saved text by default. There is no read-enable switch or first-send content confirmation. Drafts, sensitive configuration, dependencies, build outputs, lockfiles and media are not implicitly read. Sources identify actual versions and ranges; partial reading is not whole-project analysis. Actual read content reaches the configured model service: check that configuration before sending.

Select code in a file's text editor or a pending suggestion and choose **Discuss
selection** to add a fixed snapshot to the input. Expand it to inspect the path,
lines, version and saved/draft/pending state, or remove it before sending. Later
edits do not replace the snapshot. Only that explicit selection is attached;
sending does not save, apply, preview or run it. Attachments contain only explicitly selected snapshots; later saves do not replace them.

Read whole project in conversation context details prepares admitted saved text and sends it without a second content-confirmation dialog. Unsaved drafts still require explicit selection attachments. Excessive input is rejected rather than silently truncated and called complete. Requests assemble local project facts as needed; no standalone hover overview is exposed. Chat history never becomes current test evidence.

After discussion, choose built-in Work or Write handoff file for an external coding agent. Review intent, relative files, known problems
and acceptance, then explicitly confirm the task. With drafts, choose **Save
drafts first** or **Use saved files only**; pending suggestions and temporary
preview are never applied by this choice. A handoff-document draft is preserved
and may conflict with the newly recorded task. Task writing and comparison
baseline completion report separate outcomes; retry an incomplete handoff from
the baseline list without replacing its captured origin. After a real write, use
Copy prompt in the originating chat reply and give it to your external agent;
the App does not dispatch the task. The agent archives its final execution report
in source `docs/handoff-history/`, separately from the App-private initial baseline.

## Compare changes since handoff

Open **Changes since handoff**, select a task/revision baseline and compare the
current saved files. This works without Git and after external commits. Text
shows actual differences; resources show SHA-256 and size without recoverable
copies. Drafts and exclusions are separate. Refresh a stale result explicitly.
**Open current file** enters your normal editor; deleted files have differences
only. Return to this comparison or discussion and test effects manually with
the same monitor. Comparing does not send contents to AI, save, restore, start
or refresh runtime, commit or mark tasks complete. Baselines stay in App data
across restarts and chat cleanup; inspect usage and explicitly delete selected
baselines when wanted. They cannot restore a project or its resources.

Local comparison includes lockfiles without granting the assistant permission to read them. Large resource fingerprints report per-file byte progress and can be cancelled during reading; once confirmed task publication starts, wait for its actual outcome.

## Change proposals and temporary preview

In existing proposal cards, Parameters and Code tabs share a candidate buffer,
separate from file drafts.
Expressions or changed anchors disable affected controls; code remains editable.
Restore one suggested parameter without replacing unrelated edits, or confirm
discarding the whole candidate before restoring the full suggestion/reloading disk.

A temporary preview requires an explicitly adapted, matching running Project.
Only declared values cross the restricted interface; code is never injected.
Typing code ends the old preview; use Preview temporarily to verify a new mapping.
Partial effects and actual readback are distinct from complete-code validation.
End preview restores runtime parameter baselines, not time or prior effects. If
restoration is unconfirmed, verify the Project and use manual runtime controls.
Adaptation details are in the [runtime contract](./reference/runtime-contract.md).

Apply this candidate authorizes one specific write of the visible candidate.
Existing drafts or external/version conflicts stop it and preserve your work.
Preview failure or an idle runtime does not block a valid explicit application.
Actual differences retain immutable before/after versions and offer guarded undo
while still current. Adopting saved code still requires manual refresh/restart.
Proposal-card actions are separate from direct writes in Work mode.
Restored chat history contains inert snapshots, never old apply or preview permission.

## File and directory actions

Use the file column's New plus to create a code/text file or directory; a directory's context menu selects its location. Create parent directories before entering a relative path, and check the actual destination before confirming. Existing targets are never overwritten; cancelling preserves files and drafts.

Press F2 on a selected file or use its file-actions menu to rename it; the root manifest cannot be renamed. Renaming does not rewrite imports, page references or resource paths: check them and test manually. Dragging a file to Finder or another application copies its saved disk version without moving it or saving drafts. The file column's More menu offers Quick Open, Rescan files and Open in Finder.

## Drafts, saved files and running content

A draft is unsaved editor text; saved files are on disk; running content is the version actually adopted by startup and page loading. Saving does not refresh, restart or compile. Use Window → Refresh Score Pages (`⌘⇧R`) for page edits; restart testing for server or audio-artifact changes. After changing SCD, compile and then restart to adopt the result. Rescanning only updates the file list.

External edits update clean editors; dirty drafts remain and show a disk conflict. Compare both versions before explicitly saving or adopting disk content. Runtime readiness describes that run and does not prove that later saved changes have been applied.

## Creation materials

Open Creation materials in the file column and choose Add material to receive code or text. The App stores a private copy and explains supported text types and refusals. Limits are 1 MiB per item, 64 items and 8 MiB total. Images, audio, archives and other binary data are not accepted as text materials.

Select an item to read it and continue through pages when needed. Adding neither changes the project nor sends all materials to the model. Discussion and Work read relevant ranges on demand; sources identify the actual material version. Materials survive chat switches and App restarts. Removing an item deletes only its private copy, preserving the original and any adopted project files.

To integrate source, identify the material and intended behavior in Work. The assistant checks entry points, references and load order. Different content at an existing name shows actual differences and a replace/coexist choice; no overwrite occurs before an explicit answer, and the disk version is checked again afterward. Copying alone does not verify wiring, sound or visuals: test the result manually. For migration, see [Restoring and clearing project conversations](#restoring-and-clearing-project-conversations).

## Open a saved SCD in SuperCollider

Open a project SCD file and choose Open saved file in SuperCollider from File actions. Install SuperCollider locally; if discovery or opening fails, follow the error and retry.

Only the saved disk file opens; the App draft remains unsaved. This action does not evaluate, compile, connect or alter the App's audio runtime. An external save updates a clean editor or raises a conflict with a dirty draft. Compile in the App and restart testing explicitly to adopt sound changes.

## Multiple chats and earlier questions

Use the chat selector to switch conversations in the current project, or More → New chat for a separate topic. Each chat retains its own input. Switching never starts an old task. A chat's delete button deletes only that conversation; clearing all project conversations is a separate confirmed action. Neither deletes project files or creation materials.

Editing an earlier user question and sending it creates a new chat branch while preserving the original continuation. Historical proposals, sources and tests retain their original meaning without restoring old write or preview permission.

## Long conversations and context

The context ring and details describe estimated occupancy for the current request; a percentage requires a known capacity. Estimates are not provider usage or billing. Unknown capacity never produces a fictitious percentage.

In conversation context details, choose Organize older chat, review the round range and explicitly request a summary from the current model. Inspect its sources, then adopt, regenerate or discard it. Only an adopted summary enters later requests; original messages remain. A new-topic boundary changes future context selection without deleting history.

Model-service advanced settings default to automatic management. Optional capacity supports the display; only an explicit manual budget limits input by the entered amount. URL, model and key are sufficient to start. Unknown capacity stays unknown rather than being inferred from a model name. When over budget, narrow the request or organize context and retain the actual error for retry.

## Pause, continue and local resource decisions

Stop during a reply or work to pause the current task, keeping input and saved changes. Use Continue when offered to resume the same goal. A restored local task also waits for explicit continuation rather than calling the model automatically. Changed project content, model settings or task conditions can prevent continuation: inspect the reported reason first. Migrating a project's chats to another machine does not carry local execution authority.

When Work needs a standard module or App shared package, a decision card lists the actual resource, version, impact and available alternative. Choose Add and continue, the explicit alternative, or End task. Waiting does not authorize adoption. Resource decisions, ordinary creative questions and file-replacement conflicts remain separate; pending decisions still require a choice after recovery.

## Transfer a whole performance

A setlist is a complete performance-folder export and import. Export a performance folder through its context menu and transfer the complete resulting directory, including `set.json`, all `.pnds` files and README. On the receiving Mac, open the directory with `⌘O` in performance mode or drag it into the window.

Successful import rebuilds the user project list and grouping, restoring exported order, display names, introduction and valid External OSC targets. It does not simply append to the existing list; existing project files remain on disk. Export the current list separately first if needed. Missing bundles and install failures report an error, and the index is not replaced before installation completes. Configure audio devices, sample rate, nodes, keys and other machine preferences on the receiver.

## Real-time testing and performer windows

In the creation workspace's **Live test** area, choose an audio mode allowed by the saved declarations, then start or restart explicitly. External uses the App's test OSC target; choose the device and sample rate in global Settings. Changed choices stay pending until the runtime reaches ready. Closing a test retains the Project and drafts; hiding the main window does not end testing. A failed preflight leaves an existing test running, and a failed startup can be reviewed and retried.

The monitor title shows its real address. Expand it, then restore with its button or Escape in the main window; the page and runtime keep their instance. The Console tab shows recent Node/scsynth output and errors from the existing log service, with copyable test details. Returning to the file tab retains drafts. Refreshing saved test pages reloads pages without restarting processes. Use **Add performer** to open independent native test windows, choosing phone/tablet and portrait/landscape for each. The list offers focus and individual close. These presets simulate viewport dimensions only; actual touch, sensors and mobile-browser capabilities still need real devices. Page navigation status is separate from the explicitly unknown connection status. Each window has isolated temporary browser storage and communicates directly with the Project server. Refresh covers all open test pages; same-Project restart keeps their shells and reconnects them to the current address. Closing the test, changing Projects or leaving creation closes old test windows; cancelling those operations or hiding the main window preserves them.

Performer test windows retain page dialogs such as player-number selection. Mouse simulates one touch starts enabled: drag with the left button, or disable it for normal mouse behavior without reloading. Verify real multitouch and sensors on a phone; see [performer page event boundaries](./reference/page-interaction.md#the-performer-page).

## Add modules and shared packages

Add resources in the file column distinguishes local modules from shared packages. Modules supply identity recovery, theme/locale/view following or hub wiring source, maintained by the project after addition. A shared package records a manifest reference to an exact App dependency version; its resources remain in the App. Neither is a project template.

Before manual adoption, review target files, versions, dependencies and the project version. Conflicts preserve existing content: resolve them and review again. Module wiring tasks enter the creator handoff; shared packages still need correct imports or same-origin browser routes. Added does not mean wired or tested. For assistant resource decisions, see [Pause, continue and local resource decisions](#pause-continue-and-local-resource-decisions).
