# PNDS App Tutorial

In Performance, a **Host** runs a local project and a **Client** joins another Host. Creation provides editing, discussion and testing.

- [Load and join a performance](#5-loading-a-project-and-the-multi-device-performance-workflow)
- [Create a Blank project](./template-guide.md#create-a-blank-project) and [enter Creation](#8-creation-workspace)
- [Live testing](#real-time-testing-and-performer-windows) and [project versions](#project-versions-and-history)
- [Back up and restore projects with GitHub](#github-sync)
- [Performance recordings](#carrying-and-recovering-performance-recordings) and [packaging](./template-guide.md#4-packaging-and-publishing)

## 1. First launch and permissions

The App starts as Host on first launch and remembers the last selected role for later launches. Use the role button in Performance to switch between Host and Client. The bottom-right mode button opens Creation.

If macOS blocks the App from opening, choose Open Anyway in System Settings → Privacy & Security. Allow access when macOS requests permission to read the project folder.

## 2. Managing and organising Projects (left sidebar)

- Use Import Project or `⌘O` to open a project. It joins the current group, or Home if no group is selected.
- Use the sidebar dropdown to create or switch performance folders. The context menu offers rename, move, export and delete. Deleting a group keeps the project files.
- Drag project cards to reorder or move them between groups. Each list accepts up to 30 projects.
- Choose Utilities to open the built-in tools list. Back returns to the previous group.

## 3. Audio and communication settings

The bottom bar provides audio, network and Settings controls. Settings → Node contains the External OSC target and the Room for cross-internet performances.

- Performance uses the project's default audio mode. In Creation, testing can use Internal, External or None as allowed by the saved project. See [audio modes](./reference/audio-modes.md).
- Select the output device, sample rate or LAN address in the bottom bar. Start or Reload to apply changes.
- The volume control and `⌘M` adjust the running project's mono or stereo Internal output. Multichannel Internal stays at 0 dB. External and None disable gain.

## 4. Built-in utilities

Open Utilities in the sidebar and load a tool.

| Utility               | Use                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Multichannel Gen      | Send signals one channel at a time to check 16-channel wiring.                                                                       |
| Local Diagnostics     | Measure LAN latency, jitter and loss from a phone to the Host.                                                                       |
| Telematic Diagnostics | Measure each site's connection to the public hub.                                                                                    |
| Sensor Meter          | Read phone motion sensors. Grant permission on the phone. See [trusted HTTPS](./reference/https.md) for secure context requirements. |

## 5. Loading a Project and the multi-device performance workflow

1. Connect the Host and participating devices to the same LAN. Select a project on the Host and click Load.
2. When ready, copy the full performance entry address or show the QR code from the bottom-bar network menu. On a phone, open it in the browser, check the Host and project, then confirm entry.
3. On another Mac, select Client, enter the same address or choose a recent Host, then check and join. Leave before switching roles.

The browser can save the Host entry to the Home Screen, Dock or bookmarks. The entry shows a waiting page when idle. Update saved URLs if the address changes. After a stop or project change, explicitly join the next performance. Projects without entry support show the available compatibility address.

## 6. Cross-internet performance (multi-site)

1. Obtain a hub address and shared token. Deployment steps are in [pnds-hub](https://github.com/xO-xN/pnds-hub).
2. On each site, enter the node name, full `wss://` address and token in Settings → Node. Load Telematic Diagnostics to check the connection.
3. Run the same project with cross-internet support and select the same Room on each site. Performers join their own site. Configure real-time audio between sites separately. See [performance networking](./reference/network.md).

## 7. Live controls and summoning the sidebar

- Move to the left edge or hold `⌘` to reveal the sidebar. To replace a running project, select another project and confirm with a second click on Load. Retry a failed start from the error page.
- Click Reload to apply network, audio device, sample rate or External OSC target changes. Refresh reloads the score page only.
- The bottom-bar projection button opens the venue window. Use the same button to switch between the intro and performance.
- Toggle full screen through the Window menu, the green window button or `⌃⌘F`. See [shortcuts](#shortcut-quick-reference).

## 8. Creation workspace

Click the bottom-right mode button, review the target and click again to confirm. Esc cancels. [Create a Blank project](./template-guide.md#create-a-blank-project) or use Open folder project or Recent creations to open a source folder. Installed bundles and utilities are read-only.

A running folder project keeps its monitor and runtime on entering Creation. Projection closes. Returning to Performance ends testing. If Start creation on another card requires stopping the current run, confirm the stop when prompted.

Open files from the file column. The middle workspace switches between Discussion, Git versions and file tabs. See [Live testing](#real-time-testing-and-performer-windows) and [Packaging](./template-guide.md#4-packaging-and-publishing).

## Carrying and recovering performance recordings

Performance recordings store performance data. A compatible project generates sound during replay. Open Performance recordings from the bottom bar while the project is running.

- Choose New recording, perform, then Stop and save this pass. Open a completed recording to play from the beginning.
- In Creation, choose Add a pass or Rerecord pass in the pass list. A pass can include multiple performers. Overdubbing or rerecording requires confirmation when the project content has changed.
- Export saves a `.pndsrecord`. Open recording imports that format or an older `.json`, keeping the external original.

Editable projects store recordings in `.pnds-creation/recordings/`. Stop the project before copying the complete folder, including hidden files. Git and default `.pnds` bundles exclude recordings. Installed projects and utilities store recordings in the local App data directory.

The first read at the original path imports older local recordings. If the project has moved, find the old `.json` in `recordings` under Settings → About → Open data directory, then use Open recording in the moved project. Incomplete recordings cannot be played or resumed.

## Project versions and history

Open Git versions beside the project name. Blank has an initial version. For an existing folder, choose Enable local version recording, review the file scope and author identity, then confirm.

- Save current version saves drafts before recording eligible files. Resolve draft conflicts first. Dependencies, build output, private data and known secrets are excluded. Large media are unselected by default.
- Select an earlier version to view differences. For a currently editable text file, use Review load into draft, then inspect and save. Use the rename button beside a version to edit its display name.
- Project versions restore files. A handoff baseline is for [comparing changes since handoff](#compare-changes-since-handoff).

## Switch and restore project versions

End unfinished assistant tasks and stop the project run. In Git versions, select the target and confirm Switch to this version or Restore this version’s contents. If there are changes, save a version first, cancel, or confirm discarding eligible changes. Start and test manually after switching.

## GitHub sync

Use the GitHub section of **Git versions** to back up an editable folder project's saved versions. Enable [local version recording](#project-versions-and-history) first if needed. **Save current version** records a local version even when you are offline or signed out.

### Connect GitHub and link a repository

1. Open **Settings → GitHub account** and choose **Sign in to GitHub**. Copy the displayed code, click **Continue on GitHub**, then enter the code and authorize PNDS in your browser.
2. Open **Git versions → Link repository**. Create an empty repository on GitHub or use one that shares the project's Git history. Choose **Manage GitHub access** to install the [PNDS GitHub App](https://github.com/apps/pnds-app/installations/new) for the repository you want to use. Your account needs write access to the repository to back up versions.
3. Return to PNDS, click **Refresh repositories**, select the repository and confirm **Link repository**. PNDS may suggest an existing GitHub `origin`. Review the suggestion before confirming.

### Verify an official template repository for the first backup

1. In an unlinked Blank project with a saved version, open **Git versions → First template backup…** and choose **Create from the official template on GitHub**. Choose the owner, name and visibility on GitHub and use only the default branch.
2. Grant the PNDS GitHub App access to the new repository. Return to PNDS, choose **Refresh repositories**, select the new repository and verify it.
3. Review the result for the selected repository and default branch. If PNDS asks you to switch branches, check out the local branch with that exact name and verify again. This check leaves your local versions and the GitHub repository intact.
4. Choose **Review first backup**. Check the repository, branch and saved version, then confirm. For a public repository, confirmation includes the committed files and history through the displayed version.
5. If the first backup is interrupted, reopen the project and choose **Continue first backup…**. PNDS uses the same saved version, even if you have saved newer versions locally. If GitHub already received it, the App finishes linking the repository when it checks the status.

### Back up and update a branch

- Save a version and choose **Back up to GitHub**. PNDS uploads the current branch's committed files and history to the branch of the same name. Confirm the repository and branch before the first backup to a public repository or before recreating a deleted remote branch. If you checked out a historical version directly, switch to a branch or save a new branch before backing up.
- Backups are manual by default. Use **Backup settings… → Back up automatically after saving a version** to enable them. A pending backup survives restarting PNDS and retries when the network is back, automatic backup is enabled and the same project and branch are open. Use **Check GitHub status** to refresh the last known status. Changing or unlinking a repository cancels backups pending for the previous repository and keeps local versions.
- Choose **Update from GitHub** when the same branch on GitHub is ahead and can be applied without a merge. Stop the project, finish any active assistant task, and resolve local changes before updating. If both branches have new commits, reconcile them with an external Git tool, then check the status in PNDS again. Test the project after updating.

### Open a GitHub project on another Mac

In Creation, open the project picker and choose **Clone from GitHub…**. Select an authorized repository, or choose **Public repository**, enter its `owner/repository` name and click **Find branches**. Select a branch, a parent folder and a new folder name, then click **Clone and open**.

PNDS opens a valid project folder and links it to the source repository with automatic backup off. For private repositories, sign in and grant PNDS access first. Runtime dependencies and SynthDefs are checked when you test the project. To carry performance recordings separately, see [carrying and recovering performance recordings](#carrying-and-recovering-performance-recordings).

## Configuring a model service

In Settings → Model service, enter the API base URL, model name and key for an OpenAI-compatible service supporting text and tool calls. Remote services use HTTPS. A local loopback service can use HTTP.

Settings save automatically and macOS Keychain stores the key. Test connection checks a text reply and a tool call. Correct the reported problem before retrying.

## Discussion and Work

- Use **Discussion** to ask questions, settle choices and draft a plan. Select an answer or type your own. Choose Cancel this discussion to end the round.
- Use **Work** to carry out a specific task. Review the discussion plan and choose Start work, or switch to Work and send the task. The assistant saves and checks changes and compiles SynthDefs as required.
- For an external agent, choose Write handoff file. Source buttons open the help sections consulted. See [saved text access](#discuss-saved-project-text) for what the assistant reads.

## Record a handoff and continue externally

Choose Write handoff file, review the task and saved-file scope, then click Record handoff. Choose whether to save drafts first or hand off the existing saved files. When done, click Copy prompt in the original reply and pass it to the external agent.

The task is written to `docs/creator-handoff.md`. Its baseline is used to compare saved changes. Retry failed baseline capture from the baseline list.

## Restoring and clearing project conversations

Reopen the project to restore saved chats. To move them, copy the complete project folder including `.pnds-creation/` and configure the model service on the receiving Mac. To import older local conversations, open the project once at its original path before moving it.

Use the Discussion toolbar to retry saving, reload, or confirm clearing this project's chats. Clearing keeps project files and pending documents.

## Inspecting and releasing ports

Open Settings → Ports to see the ports declared by the selected project's saved manifest. The defaults with no selection are 6868 and 6869. Click Refresh to update.

Verify the displayed process identity before confirming release of an external process. To release App-managed ports, close the owning project. A failed start also offers Release and retry.

## Shortcut quick reference

| Shortcut           | Action                                                             |
| ------------------ | ------------------------------------------------------------------ |
| `⌘O`               | Open a project                                                     |
| `⌘1`–`⌘9`          | Select a visible project                                           |
| `⌘⌥↑` / `⌘⌥↓`      | Select the previous or next project in the Performance main window |
| `⌘⌥Enter`          | Load the prepared project in the Performance main window           |
| `⌘S`               | Save the current creation file                                     |
| `⌘P`               | Quickly open a creation file                                       |
| Command + backtick | Toggle the creation console                                        |
| `⌘` (hold)         | Reveal the sidebar                                                 |
| `⌘M`               | Mute or restore the master output                                  |
| `⌘⇧R`              | Refresh the score page                                             |
| `⌘=` / `⌘-` / `⌘0` | Zoom the monitor in, out or to actual size                         |
| `⌃⌘F`              | Toggle full screen                                                 |
| `⌘,` / `⌘?`        | Open Settings or Help                                              |
| `⌘W` / `⌘Q`        | Close the window or quit the App                                   |

See [page interaction](./reference/page-interaction.md#the-monitor-pages-keyboard) for shortcuts while a page has focus.

## Static project diagnostics

Work tasks and the CLI can check saved declarations, dependencies and artifacts. Static diagnostics can run during a performance.

```sh
/Applications/PNDS.app/Contents/MacOS/pnds check /path/to/project --json
```

## Controlled saved-copy checks

Work tasks and the CLI can check health and page HTTP in a temporary copy. The default is None if the project allows it, and Internal is available by explicit selection. Wait for resources in use by the current run to be released. Check actual sound and visuals through Live testing.

```sh
/Applications/PNDS.app/Contents/MacOS/pnds check /path/to/project --run --json
```

Add `--mode internal` to select Internal. Press Ctrl-C to cancel and wait for cleanup. See `pnds check --help` for all options.

## Single-file differences and undo

After editing, choose Review changes, inspect the diff and click Save reviewed changes. Use Undo saved change to restore the most recent recorded file change in the current project. Resolve later edits or outstanding drafts before undoing.

## Editing project text

Open a text file from the file tree or Quick Open (`⌘P`). Use `⌘F` to find or replace in the current file and `⌘G` to go to a line.

Use `⌘S` to save the current file and `⌘Z` or `⇧⌘Z` to undo or redo in the draft. See [drafts and saved files](#drafts-saved-files-and-running-content) for disk conflicts.

## Discuss saved project text

The assistant sends relevant saved text to the configured model service. To include draft text, select it and click Attach selection and discuss. Review or remove the snapshot before sending.

Read the entire project in the conversation context panel prepares and sends eligible saved text. If the request exceeds the budget, reduce its scope.

## Compare changes since handoff

Open Changes since handoff and choose a task and baseline. The comparison shows text differences against saved files, plus fingerprints and sizes for assets. Refresh a stale result or use Open current file to continue editing. Use [project versions](#project-versions-and-history) to restore files.

## Change proposals and temporary preview

Use Parameters or Code to edit a proposal. A compatible running project can preview parameter changes. Ending preview attempts to restore the original values. Check the live test if restoration fails.

Choose Apply to project to write the proposal. Resolve disk changes or existing drafts first. See [drafts and saved files](#drafts-saved-files-and-running-content) for loading the saved change.

## File and directory actions

Use New in the file column or the target folder's context menu to add a file or directory. Existing names block creation. Use F2 to rename and update references to the path. Dragging to Finder copies the saved file.

## Drafts, saved files and running content

A draft is unsaved editor text. A saved file is on disk. Running content is the version used by the current process or loaded page.

After saving a page file, refresh with `⌘⇧R`. Restart testing for server changes. After editing an SCD file, compile the SynthDef before restarting. If an external save conflicts with a draft, compare both versions before choosing which to keep.

## Pending documents

To add creation materials, choose New pending document, name it, then paste and save in the editor. You can also import a copy of existing text. Limits are 1 MiB each, 64 documents and 8 MiB total. Documents can be renamed, shown in Finder or deleted with confirmation.

Specify documents to integrate in a Work task. Confirm replacement, coexistence or cancellation when project content conflicts. Successful integration removes the source from the pending list. Failure keeps it. The group shows the latest integration and offers undo.

## Open a saved SCD in SuperCollider

With SuperCollider installed, open the project's SCD file and choose Open saved file in SuperCollider from File actions. To adopt a sound change, return to the App to compile and restart testing.

## Multiple chats and earlier questions

Switch chats with the chat selector, or use More → New chat to start a separate topic. Delete individual chats from the list. Editing and resending an earlier question creates a branch and keeps the original chat.

## Long conversations and context

Open conversation context details to see estimated usage. To reduce the context, choose Organise older chat, review the turn range and generate a summary. Adopt the summary to use it in later requests.

## Pause, continue and local resource decisions

Use Stop to pause and keep saved changes. Click Continue to resume the same task. Follow the error message if files or settings have changed.

When Work needs modules or shared packages, review the resources and effects in the confirmation card. Choose Add and continue, an alternative, or End task.

## Transfer a whole performance

Export the setlist from the performance folder's context menu. Give the recipient the complete directory containing `set.json` and the project bundles. In Performance mode, the recipient opens the directory with `⌘O`.

Successful import replaces the user project lists and folders while keeping the original project files. Configure audio devices, sample rate, node and keys on the receiving Mac.

## Real-time testing and performer windows

In Real-time testing, select an audio mode allowed by the saved project and start the test. See the console for startup errors, then correct them and retry. Closing the test keeps drafts.

- For a phone, use the performer test address or QR code in the bottom-bar network menu.
- Add performer opens a separate test window with phone and tablet sizes. Mouse single-touch simulation starts enabled and can be toggled in the window.
- For media, select a device on the project page and respond to the system prompt. If denied, check permissions and retry. Check multitouch and capture on the real device. See [native media](./reference/native-media.md).

### Test a project with an iPhone or iPad over USB

1. Connect the device to your Mac with a data cable. Unlock the device and tap Trust. Turn off Wi‑Fi and cellular data, if available, on the device.
2. On the Mac, go to System Settings → Network and find the USB interface’s IPv4 address. If there’s no address, go to General → Sharing → Internet Sharing, select the device’s USB interface as an output, and check again.
3. In PNDS Creation mode, select that address in the bottom-bar network menu and start the test. On the device, use Safari to open the full performer address shown in the bottom bar. Touch the page and check that the Mac responds.

## Add modules and shared packages

Choose Add resources in the file column. A local module adds project source. A shared package references an exact App version in the manifest. Blank already wires performer identity recovery. Check dependencies and conflicts before adding. Module wiring tasks are recorded in the handoff. Confirm wiring in a live test. See the [module manual](./modules/README.md).
