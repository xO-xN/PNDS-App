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

- **Import a Project**: click the **`+ Import Project`** button at the top of the sidebar, or press `⌘ O`, to import a `.pnds` file into the **Home** folder.
- **Folder organisation**: create custom folders to group Projects by performance programme, movement or repertoire.
- **Free ordering**: press and hold a Project card to drag it freely — drop it into a folder or reorder it.

---

## 3. Audio and communication settings

**Click** a Project card in the sidebar to select it; the panel at the bottom left expands with the Project's runtime settings:

- **Audio Mode**: view or switch the Project's default DSP / synthesis engine mode; the differences between the three modes are covered in [audio-modes.md](../reference/audio-modes.md).
- **Output & Volume**: choose the monitoring / reinforcement audio hardware and calibrate the initial master output gain. The volume control only attenuates (maximum 0 dB); when a Project has multichannel output the App disables the control — adjust gain on your external audio interface instead. The speaker button mutes / restores in one click (`⌘ M`); mute lasts for the current performance only — reloading returns to the default 80%.
- **OSC Port**: the UDP port used to send control signals to external hosts (Max, SuperCollider, Ableton Live, lighting consoles, …).

---

## 4. Built-in utilities

The sidebar's **Utilities** folder carries three ready-to-run validation Projects covering three layers of the performance chain (in a fixed order):

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
4. **The performance**: load the actual work (its manifest declares cross-internet capability and it implements the hub protocol — Telematic Diagnostics is the reference implementation). The App derives the room from the work automatically — sites running the same work in the same Room group (the sidebar Room dropdown, 1–3) land in one room, and a wrongly opened work cannot see in; performers join **their own site** by QR code as usual, and real-time audio between sites rides an external transport such as JackTrip.

---

## 7. Live controls and summoning the sidebar

During a performance or rehearsal, when you need to switch the audio output device, change volume or check connections:

- **Edge hover**: move the pointer to the far left edge of the window and the settings sidebar glides in.
- **Keyboard summon**: hold `⌘` and the sidebar appears instantly; release the key or move the pointer away and it slides back out, keeping the main view free of distraction.
- **Full-screen performance**: `⌃⌘ F`, the menu item or the sidebar button enters full screen; the monitor page adapts to the new size.

---

## Appendix: shortcut quick reference

The shortcuts an App user reaches for (creators asking "which keys can my pages get?" — see [page interaction](../reference/page-interaction.md)):

| Shortcut              | Action                                    |
| --------------------- | ----------------------------------------- |
| `⌘ O`                 | Import a Project                          |
| `⌘ 1`–`⌘ 9`           | Select the Nth visible Project            |
| `⌘ ↓` / `⌘ ↑`         | Next / previous Project                   |
| `⌘ ←` / `⌘ →`         | Switch folder view (wrapping at the ends) |
| `⌘ R`                 | Rename the selected Project / folder      |
| `Enter`               | Load the Project / restart after a change |
| `Esc`                 | Close the Project (confirm flow)          |
| `⌘` (hold)            | Summon the sidebar + number badges        |
| `⌃ ⌘ F`               | Enter / leave full screen                 |
| `⌘ M`                 | Master mute / restore                     |
| `⌘ =` / `⌘ -` / `⌘ 0` | Monitor zoom in / out / actual size       |
| `⌘ ⇧ R`               | Reload the monitor page                   |
| `⌘ ,`                 | Open / close the settings panel           |
| `⌘ ?`                 | Open the help center                      |
| `⌘ W`                 | Close window (confirm flow while running) |
| `⌘ Q`                 | Quit the App (confirm flow while running) |
