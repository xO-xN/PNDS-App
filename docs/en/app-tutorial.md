# PNDS App Tutorial

This guide covers the PNDS App's core interface, how Projects are organised, audio and communication settings, and the multi-device workflow of a live networked performance.

---

## 1. First launch and permissions

- **Open the app**: launch PNDS App to reach the welcome screen.
- **First launch (macOS security confirmation)**: the current release is ad-hoc signed and not notarised with Apple, so the first launch is blocked with a warning that the developer cannot be verified. In the Applications folder, right-click PNDS and choose **打开 (Open)**, then confirm **Open** in the dialog; or go to **System Settings → Privacy & Security** and click **仍要打开 (Open Anyway)**. You will not be asked again.
- **File access permission**: on first run the system asks for access to the local file system — choose **允许 (Allow)** so the App can read, load and manage your local score Projects.

---

## 2. Managing and organising Projects (left sidebar)

The App's **left sidebar** is the main working area; it manages the full lifecycle and hierarchy of your performance Projects:

- **Import a Project**: click the **`+ 导入工程` (Import Project)** button at the top of the sidebar, or press `⌘ O`, to import a `.pnds` file into the **主页 (Home)** folder.
- **Folder organisation**: create custom folders to group Projects by performance programme, movement or repertoire.
- **Free ordering**: press and hold a Project card to drag it freely — drop it into a folder or reorder it.

---

## 3. Audio and communication settings

**Click** a Project card in the sidebar to select it; the panel at the bottom left expands with the Project's runtime settings:

- **Audio Mode**: view or switch the Project's default DSP / synthesis engine mode; the differences between the three modes are covered in [audio-modes.md](../reference/audio-modes.md).
- **Output & Volume**: choose the monitoring / reinforcement audio hardware and calibrate the initial master output gain. The volume control only attenuates (maximum 0 dB); when a Project has multichannel output the App disables the control — adjust gain on your external audio interface instead. The speaker button mutes / restores in one click (`⌘ M`); mute lasts for the current performance only — reloading returns to the default 80%.
- **OSC Port**: the UDP port used to send control signals to external hosts (Max, SuperCollider, Ableton Live, lighting consoles, …).

---

## 4. Loading a Project and the multi-device performance workflow

Before you begin, connect the Host Mac running PNDS App and every performer's device to the same local network; a wired connection is recommended for the Host, with performers' devices (phones / tablets) on the same Wi-Fi.

Once the settings check out, click the **加载 (Load)** button to start the Project:

1. **Service startup**: the App starts the Project's own **local digital-score server** and, in Internal synthesis mode, the **DSP audio engine**, using the configured parameters.
2. **Enter the conductor view**: once the Project has loaded, the sidebar slides away to the left and the main view switches to the full-screen **conductor view (指挥界面)**.
3. **Performers join from their devices**:
   - **Join by QR code**: some Projects support scanning the **QR code** shown in the conductor view with a mobile device to open the performer page.
   - **Open in a browser**: on any device's modern browser, enter the Host Mac's LAN address and the performer port to join the system.

---

## 5. Live controls and summoning the sidebar

During a performance or rehearsal, when you need to switch the audio output device, change volume or check connections:

- **Edge hover**: move the pointer to the far left edge of the window and the settings sidebar glides in.
- **Keyboard summon**: hold `⌘` and the sidebar appears instantly; release the key or move the pointer away and it slides back out, keeping the main view free of distraction.
- **Full-screen performance**: `⌃⌘ F`, the menu item or the sidebar button enters full screen; the monitor page adapts to the new size.
