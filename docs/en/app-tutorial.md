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

The sidebar's independent **Utilities** button offers ready-to-run validation Projects covering three layers of the performance chain (in a fixed order):

- **Multichannel Gen** ([Multichannel-Signal-Generator](https://github.com/xO-xN/Multichannel-Signal-Generator)): a 16-channel signal generator. When — verifying your audio interface's channel mapping, wiring and reinforcement setup, especially before a multichannel work goes on. Once loaded, its monitor offers 16 vertical faders to confirm, channel by channel, that sound goes where it should.
- **Local Diagnostics** ([Local-Network-Diagnostics](https://github.com/xO-xN/Local-Network-Diagnostics)): local-network diagnostics. When — checking the Wi-Fi leg from performers' devices to the Host (latency / jitter / loss) before a show; performers scan and test from their phones.
- **Telematic Diagnostics** ([Telematic-Network-Diagnostics](https://github.com/xO-xN/Telematic-Network-Diagnostics)): cross-internet diagnostics. When — the go / no-go verdict on the hub star network before a multi-site performance (see [Cross-internet performance](#6-cross-internet-performance-multi-site) below); every site's monitor shows the same flower view — green means playable, red names the faulty site and leg.

Utilities load and run from the sidebar like any Project; details and verdict thresholds live in each tool's repository.

---

## 5. Loading a Project and the multi-device performance workflow

Before you begin, connect the Host Mac running PNDS App and every performer's device to the same local network; a wired connection is recommended for the Host, with performers' devices (phones / tablets) on the same Wi-Fi.

Once the settings check out, click the **Load** button to start the Project:

1. **Service startup**: the App starts the Project's own **local digital-score server** and, in Internal synthesis mode, the **DSP audio engine**, using the configured parameters.
2. **Enter the conductor view**: once the Project has loaded, the sidebar slides away to the left and the main view switches to the full-screen **conductor view**.
3. **Performers join from their devices**:
   - **Join by QR code**: some Projects support scanning the **QR code** shown in the conductor view with a mobile device to open the performer page.
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

Use **Generate .pnds** at the top-right of the creation titlebar to open saved-file packaging. Open the project-title dropdown to switch/create a project, view/record handoff tasks, rescan files or open Finder. The selector
explains why your folder can be edited externally and why installed `.pnds`
bundles and built-in utilities retain a read-only source. Cancelling either
selector preserves your current project. Reopening an installed directory or
accessing it through a symbolic link does not make it an editable source project.

Manifest and the localized README are pinned. Other actual paths are grouped into runtime/dependencies, pages, sound sources, compiled artifacts, modules, assets and project support. Select text to read and find within the current file. PNG, JPEG, WebP and
GIF preview only when selected; decoding failure leaves information and Finder
access available. Audio and other binaries show name, type and size for use in
an external application. The file column's single Finder button opens the
project folder; the file toolbar’s action menu reloads disk content, reveals the current file and renames it. Root manifest rename remains disabled.

Text is limited to 1 MiB, images to 4 MiB, and the file list to 4,096 entries and
32 levels. `.git` and `node_modules` are omitted. Missing files, permissions,
invalid UTF-8, size limits, invalid project identity and escaping paths have
distinct feedback. Refresh the file list when needed. Creation opening checks
basic declarations and entry structure, so an initial draft can be read before
dependencies or sound artifacts are built. Running and packing keep their own
checks.

The capsule uses a fixed slanted fill and 300ms name transition. It holds the
new mode's resting appearance until the pointer leaves and returns; all four themes keep this transition, while
system reduced motion completes directly. Startup or shutdown disables switching. A
running editable folder takes precedence over another selected card and enters
creation without restarting or reloading its monitor. A selected idle folder
opens without starting. Installed bundles, tools and noneditable targets end the
old runtime and enter the creation home. Entering creation closes the projection.
Returning to performance ends testing, clears selection and temporary state, and
returns to the idle home without auto-loading.

Editable sources retain manual saving, drafts and disk-conflict protection.
The SCD toolbar compiles the whole standard source set and sends results to the
console. The bottom bar starts/restarts/closes tests and refreshes saved pages;
the right pane keeps test audio, the same monitor and independent performer
windows. The console starts closed and is available only from creation's bottom
bar or Command + backtick. Expanding monitor changes layout only; Esc restores it.

Use **Add PNDS module** beside the Modules heading in writable projects.
Five frozen choices work offline: QR joining, client connection/identity
recovery, monitor theme, monitor language and monitor view synchronization.
Review real target files, source version and prerequisites before adding. Files
go to `modules/pnds-<id>/` with a `pnds-module.json` source record; wiring tasks
append to `docs/creator-handoff.md`. File addition does not mean wiring or
performance verification. The App never changes entries/manifest, installs
dependencies or Skills, or starts a project. Existing targets are preserved. A
failed handoff lists files already added; fix the error, reload status and retry
only the handoff. Upgrades, merges and removal belong to the external agent.

---

### Inspecting and releasing ports

Open Settings (`⌘ ,`) → Ports to inspect the selected project's manifest performer and monitor ports. Creation mode reads the workspace's saved manifest; drafts do not change the query target. With no target, the defaults are 6868/6869. The section queries once on entry; click Refresh to update it. There is no background polling.

An external listener shows its PID, process name and complete command line. Release asks you to confirm that identity. The App verifies the same process again before signalling, waits for graceful exit and uses bounded force exit when needed. If the listener disappears, changes identity or becomes managed by this App, release cancels and refreshes; confirm the new identity before trying again. The startup error page's Release and Retry also confirms first, and retries only after a successful release reports the port available.

Ports held by this App show their actual running project and ask you to close the project; they offer no direct Release. Selecting B while A runs queries B's ports. Ownership uses A's ports applied at startup and real child processes, so B's different ports are never labelled as running A.

---

## Appendix: shortcut quick reference

The shortcuts an App user reaches for (creators asking "which keys can my pages get?" — see [page interaction](../reference/page-interaction.md)):

| Shortcut                   | Action                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `⌘ O`                      | Import a Project                                                                       |
| `⌘ 1`–`⌘ 9`                | Select the Nth visible Project                                                         |
| `↓` / `↑` (inside sidebar) | Next / previous Project                                                                |
| `⌘ S`                      | Save the current creation file                                                         |
| Command + backtick         | Toggle the creation console                                                            |
| `⌘ ⌥ ↑` / `⌘ ⌥ ↓`          | Native previous/next selection; performance main window, including monitor/input focus |
| `⌘ ↑` / `⌘ ↓`              | Select previous / next visible Project                                                 |
| `⌘ R`                      | Rename the selected Project / folder                                                   |
| `Enter`                    | Load the Project / restart after a change                                              |
| `Esc`                      | Cancel mode confirmation / dismiss an overlay                                          |
| `⌘` (hold)                 | Summon the sidebar + number badges                                                     |
| `⌃ ⌘ F`                    | Enter / leave full screen                                                              |
| `⌘ M`                      | Master mute / restore                                                                  |
| `⌘ =` / `⌘ -` / `⌘ 0`      | Monitor zoom in / out / actual size                                                    |
| `⌘ ⇧ R`                    | Reload the monitor page                                                                |
| `⌘ ,`                      | Open / close the settings panel                                                        |
| `⌘ ?`                      | Open the help center                                                                   |
| `⌘ W`                      | Close window (confirm flow while running)                                              |
| `⌘ Q`                      | Quit the App (confirm flow while running)                                              |
