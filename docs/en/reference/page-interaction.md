# Page Interaction: Keyboard, Pointer and Touch

This page is for **Project creators**: it states precisely which interaction events a Project's pages can rely on inside the App — which keys the monitor page receives, who owns the pointer and the right click, and what touch capabilities the performer page gets. At a performance, a key conflict is an accident waiting to happen; read these two tables before choosing keys for a page. The App **user's** shortcut quick reference is not this page — see the appendix of the [tutorial](../app-tutorial.md).

## Ground rules: the embed model and the two keyboard layers

- The **monitor page** is embedded as an iframe in the App's main window, filling the whole main area except the sidebar and the top title strip. The App does not read, inject into or call the cross-origin page DOM ([runtime-contract.md](./runtime-contract.md) §10); the page receives standard web input events. The labelled performer input simulation below is a narrow native input exception, with no page-DOM inspection or music relay.
- The **performer page** normally opens in performers' browsers against the Project server. Creation mode can also embed real performer pages in multiple independent native test windows; messages still travel directly through that server.
- Keyboard input passes through **two layers** before the page: the **native menu-accelerator layer** (the macOS menu bar, app-wide, never yields) and the **App web layer** (the ⌘-shortcut layer of the App's own UI, which yields during page interaction). Which layer a chord belongs to decides whether the page can never see it, or may use it while the user interacts — see the two tables below.

## The monitor page's keyboard

### Table A: permanently retained by the native layer — the page never sees them

| Chord         | App action                                       |
| ------------- | ------------------------------------------------ |
| `⌘ W`         | Close window (confirm flow while a session runs) |
| `⌘ Q`         | Quit the App (confirm flow while a session runs) |
| `⌘ M`         | Master mute / restore                            |
| `⌘ O`         | Import a Project                                 |
| `⌘ R`         | Rename the selected Project / folder             |
| `⌘ ,`         | Open / close the settings panel                  |
| `⌘ ?` (⇧⌘/)   | Open the help center                             |
| `⌘ 0`         | Monitor zoom: actual size (per focused window)   |
| `⌘ =` / `⌘ -` | Monitor zoom in / out (per focused window)       |
| `⌘ ⇧ R`       | Reload BOTH windows' monitor pages               |
| `⌃ ⌘ F`       | Focused window: enter / leave full screen        |

These are macOS menu-bar accelerators: the chord is consumed by the App before it reaches the page, and they **keep working during page interaction**. A work's key plan must route around them.

Since v1.5.0 (#131) a monitor page can appear in **two windows** — the main window and the projection window (the venue-screen display). The accelerators stay app-wide, but their effect dispatches on the **focused window**: `⌘ 0`/`⌘ =`/`⌘ -` adjust only the focused window's own monitor zoom (each window holds an independent value; the projection window's zoom also scales its intro screen and is remembered in preferences); `⌃ ⌘ F` toggles only the focused window's fullscreen; `⌘ ⇧ R` is the exception — one chord reloads **both** windows' monitor pages. For the page, Table A's meaning is unchanged: none of these chords reach a page in either window. **The #135 exception**: once a projection copy's page declares `zoom:"page"` through the §14 handshake, `⌘ 0`/`⌘ =`/`⌘ -` are no-ops for that window — the App no longer applies its own zoom (see [runtime contract §14](./runtime-contract.md) for the declaration).

### Table B: conditionally available — belong to the page while the user interacts with it

| Chord         | App action when the page is not being interacted with |
| ------------- | ----------------------------------------------------- |
| `⌘ 1`–`⌘ 9`   | Select the Nth visible Project                        |
| `⌘ ↓` / `⌘ ↑` | Next / previous Project                               |
| `⌘ ←` / `⌘ →` | Switch folder view (wrapping at the ends)             |
| `Enter`       | Load the Project / restart after a change             |

**"During page interaction"** means: any element of the page holds keyboard focus (other than body / html), or the pointer sits inside the monitor area (a safety net for homemade controls that never fire focus events, e.g. a div menu with no tabindex). While that holds, the App's web ⌘ layer stands down and never steals the keyboard back — the chords above are the page's to handle. When the interaction ends (focus falls back to the page body, the pointer leaves the area) the keyboard returns to the App at once.

Two v1.5.0 (#131) revisions:

- **Table B exists only in the main window** — the projection window has no App web layer (no sidebar, no ⌘ badge layer); every non-accelerator chord belongs to the page there.
- **`Esc` belongs to performance and projection monitor pages** (the plain-Esc close-Project alias is retired; closing a Project uses `⌘ W`'s confirmation). The narrow v1.6 creation exception: when the main monitor is temporarily expanded, the main window has focus and no App overlay/submission is active, the App uses plain `Esc` to restore the editing workspace. It does not stop the runtime, navigate the page or close test windows. Unexpanded and other windows retain their existing ownership.

Special note (`⌘ ←` / `⌘ →`): WKWebView natively treats Cmd + left/right as its own back / forward equivalents and swallows them — the keydown never reaches any page. The App reroutes exactly this chord at the native layer back onto the ordinary keyDown path so pages can listen for it; inside editable elements it keeps the system's line-start / line-end editing behaviour.

## Pointer and right click

- Pointer events (move / down / up / wheel / drag) pass through to the monitor page **in full** — the App neither intercepts nor interprets them.
- **The right click belongs to the page author**: the App suppresses WKWebView's native web menu (Reload / Open Frame in New Window / Back, …; editable fields keep the system copy/paste menu), and the suppression only calls `preventDefault` — it never stops the event's propagation. A `contextmenu` listener on the monitor page and the custom menu it opens coexist with it naturally; no wiring is needed.
- The App's own UI (the sidebar, …) keeps its own designed menus for right clicks; performer right clicks in device browsers belong to the Project. App test windows suppress the native menu while preserving the page's contextmenu events.

## The top title-strip keep-out zone

The App floats a title strip along the **top centre** of the window (showing the current Project's name) which doubles as the window drag region: it covers the matching top-centre band of the page and swallows pointer events there. Keep critical interactions (buttons, menus, status readouts) out of that top-centre band — leave it to the title and the drag.

## The performer page

The performer page normally opens directly in performers' own browsers; its input capabilities are those of an ordinary mobile web page: **touch, multi-touch and orientation adaptivity** all work, entirely in the Project's hands — use a standard viewport and responsive layout for orientation and size changes, and store sustained interaction state as relative / normalised coordinates so it does not fossilise in old pixels after a resize (the same discipline as the monitor page's resize requirement, [runtime-contract.md](./runtime-contract.md) §10).

Creation's performer test windows have isolated temporary browser storage and independent client identities. Phone is a 390 × 844 CSS viewport; tablet is 820 × 1180, with width/height swapped for landscape. The shell scales the frame to fit the desktop window without changing that viewport. Size changes retain the same page, which must respond to resize. This simulates dimensions only: touch, multi-touch, sensors and mobile-browser APIs still require real-device verification.

Test shells have no App web shortcut layer; native menu accelerators and macOS chords remain reserved. Other keys, Escape, pointer and page contextmenu events belong to the performer page. Main-window Escape restoration does not extend to test windows. Cmd+W closes only the focused test client; Ctrl+Cmd+F changes only its native fullscreen; monitor zoom chords do not alter its viewport. The App observes navigation lifecycle only: a load event may also be a browser error document and never proves a server connection. The public runtime protocol has no performer connection-status reporting, so the list explicitly shows “Connection unknown.” Existing Projects need no new message protocol to be tested.

## Key-choice safety zone

When choosing interaction keys for the monitor page:

- **Safe zone**: plain character / number keys, `⇧` chords, `⌥` chords, `F1`–`F12`.
- **Unreliable**: macOS system-level chords — `⌘ Tab`, `⌘ Space`, screenshots (`⌘ ⇧ 3` / `4` / `5`), … — no web page can intercept these, in WKWebView or anywhere else.
- **Avoid the `⌘` family altogether**: beyond Table A's menu accelerators and the system-level chords, future App versions may add more `⌘` accelerators. Plain keys with `⇧` / `⌥` cover nearly every performance interaction; the cost of a key conflict far outweighs the elegance of a chord.
- Table B's chords are usable but carry the yield semantics: they belong to the page while it holds focus (or the pointer is inside the monitor area) and to the App otherwise — if a performance-critical action rides on a conditional chord, make "focus is inside the page" a stable state of the work (for example, have the page focus an element on load).

Performer test windows support the Project's normal JavaScript dialogs, including player-number prompts. **Mouse simulates one touch** is visibly enabled for new test clients; drag with the left button to simulate one contact, or turn it off for the page's original mouse behavior. Switching this option does not reload the page. These are untrusted synthetic touch events; native text/form controls remain usable, and real multitouch, pressure, sensors and mobile-browser behavior still require a device.
