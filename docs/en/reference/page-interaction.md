# Page Interaction: Keyboard, Pointer and Touch

Monitor and performer pages receive standard web input events.

## Ground rules: the embed model and the two keyboard layers

The macOS App hosts monitor and test performer pages as [native pages](./native-media.md). macOS menu accelerators apply within their window scope. Main-window web shortcuts yield during page interaction.

## The monitor page's keyboard

### Table A: retained by the native layer in their enabled window scope

| Chord             | App action                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `⌘ W`             | Close window or confirm stopping the current project                                                                |
| `⌘ Q`             | Quit the App (confirm flow while a session runs)                                                                    |
| `⌘ M`             | Master mute / restore                                                                                               |
| `⌘ O`             | Import a Project                                                                                                    |
| `⌘ R`             | Rename the selected Project / folder                                                                                |
| `⌘ ,`             | Open / close the settings panel                                                                                     |
| `⌘ ?` (⇧⌘/)       | Open the help center                                                                                                |
| `⌘ 0`             | Monitor zoom: actual size (per focused window)                                                                      |
| `⌘ =` / `⌘ -`     | Monitor zoom in / out (per focused window)                                                                          |
| `⌘ ⇧ R`           | Reload BOTH windows' monitor pages                                                                                  |
| `⌘ ⌥ ↑` / `⌘ ⌥ ↓` | Previous/next visible Project; performance main window only                                                         |
| `⌘ ⌥ Enter`       | Load the prepared selection; confirm a live replacement; restart pending changes; unchanged running card is a no-op |
| `⌃ ⌘ F`           | Focused window: enter / leave full screen                                                                           |

Zoom and full screen apply to the focused window. Refresh reloads both main monitor and projection. Projection can declare page-owned zoom through the [runtime contract](./runtime-contract.md).

### Table B: conditionally available — belong to the page while the user interacts with it

| Chord       | App action when the page is not being interacted with |
| ----------- | ----------------------------------------------------- |
| `⌘ 1`–`⌘ 9` | Select the Nth visible Project                        |
| `Enter`     | Load the Project / restart after a change             |

Table B chords belong to the page while a control has focus or the pointer is inside the monitor. Projection reserves only native menu accelerators. `Esc` belongs to performance and projection pages. In Creation, `Esc` restores the workspace from an expanded monitor.

Pages can listen for `⌘ ←` and `⌘ →`. Text controls keep the system’s line-start and line-end behavior.

## Pointer and right click

The monitor content area receives pointer, wheel and drag events. The App suppresses the native web menu, preserving page `contextmenu` events and the system clipboard menu for editable fields.

## The performer page

Phone browsers supply real touch and multitouch. Creation tests use a 390 × 844 CSS pixel phone viewport and an 820 × 1180 tablet viewport. Landscape swaps the dimensions. Size changes keep the page and trigger resize.

Test windows support JavaScript dialogs and mouse simulation of one touch. Drag with the left button to simulate a contact. Turn the option off to restore mouse input. Use a real device to verify multitouch, sensors and mobile browser behavior.

Closing a test window hides its page. Removing the device from the list unloads it. See the [performer roster](./browser-participation.md#connected-performer-roster) for connection status.
