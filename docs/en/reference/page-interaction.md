# Page Interaction: Keyboard, Pointer and Touch

This page is for **Project creators**: it states precisely which interaction events a Project's pages can rely on inside the App — which keys the monitor page receives, who owns the pointer and the right click, and what touch capabilities the performer page gets. At a performance, a key conflict is an accident waiting to happen; read these two tables before choosing keys for a page. The App **user's** shortcut quick reference is not this page — see the appendix of the [tutorial](../app-tutorial.md).

## Ground rules: the embed model and the two keyboard layers

- The **monitor page** is embedded as an iframe in the App's main window, filling the whole main area except the sidebar and the top title strip. The App does not read, inject into or call the cross-origin page DOM ([runtime-contract.md](./runtime-contract.md) §10); the input a page receives is standard web input events — there is no extra API.
- The **performer page** does not open inside the App — performers' browsers reach the Project's own server directly; it is an ordinary mobile web page.
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
| `⌘ 0`         | Monitor zoom: actual size                        |
| `⌘ =` / `⌘ -` | Monitor zoom in / out                            |
| `⌘ ⇧ R`       | Reload the monitor page                          |
| `⌃ ⌘ F`       | Enter / leave full screen                        |

These are macOS menu-bar accelerators: the chord is consumed by the App before it reaches the page, and they **keep working during page interaction**. A work's key plan must route around them.

### Table B: conditionally available — belong to the page while the user interacts with it

| Chord         | App action when the page is not being interacted with |
| ------------- | ----------------------------------------------------- |
| `⌘ 1`–`⌘ 9`   | Select the Nth visible Project                        |
| `⌘ ↓` / `⌘ ↑` | Next / previous Project                               |
| `⌘ ←` / `⌘ →` | Switch folder view (wrapping at the ends)             |
| `Enter`       | Load the Project / restart after a change             |
| `Esc`         | Close the Project (confirm flow)                      |

**"During page interaction"** means: any element of the page holds keyboard focus (other than body / html), or the pointer sits inside the monitor area (a safety net for homemade controls that never fire focus events, e.g. a div menu with no tabindex). While that holds, the App's web ⌘ layer stands down and never steals the keyboard back — the chords above are the page's to handle. When the interaction ends (focus falls back to the page body, the pointer leaves the area) the keyboard returns to the App at once.

Special note (`⌘ ←` / `⌘ →`): WKWebView natively treats Cmd + left/right as its own back / forward equivalents and swallows them — the keydown never reaches any page. The App reroutes exactly this chord at the native layer back onto the ordinary keyDown path so pages can listen for it; inside editable elements it keeps the system's line-start / line-end editing behaviour.

## Pointer and right click

- Pointer events (move / down / up / wheel / drag) pass through to the monitor page **in full** — the App neither intercepts nor interprets them.
- **The right click belongs to the page author**: the App suppresses WKWebView's native web menu (Reload / Open Frame in New Window / Back, …; editable fields keep the system copy/paste menu), and the suppression only calls `preventDefault` — it never stops the event's propagation. A `contextmenu` listener on the monitor page and the custom menu it opens coexist with it naturally; no wiring is needed.
- The App's own UI (the sidebar, …) keeps its own designed menus for right clicks; the performer page does not open in the App at all — its right clicks are entirely the Project's business.

## The top title-strip keep-out zone

The App floats a title strip along the **top centre** of the window (showing the current Project's name) which doubles as the window drag region: it covers the matching top-centre band of the page and swallows pointer events there. Keep critical interactions (buttons, menus, status readouts) out of that top-centre band — leave it to the title and the drag.

## The performer page

The performer page opens directly in performers' own browsers (not in the App); its input capabilities are those of an ordinary mobile web page: **touch, multi-touch and orientation adaptivity** all work, entirely in the Project's hands — use a standard viewport and responsive layout for orientation and size changes, and store sustained interaction state as relative / normalised coordinates so it does not fossilise in old pixels after a resize (the same discipline as the monitor page's resize requirement, [runtime-contract.md](./runtime-contract.md) §10).

## Key-choice safety zone

When choosing interaction keys for the monitor page:

- **Safe zone**: plain character / number keys, `⇧` chords, `⌥` chords, `F1`–`F12`.
- **Unreliable**: macOS system-level chords — `⌘ Tab`, `⌘ Space`, screenshots (`⌘ ⇧ 3` / `4` / `5`), … — no web page can intercept these, in WKWebView or anywhere else.
- **Avoid the `⌘` family altogether**: beyond Table A's menu accelerators and the system-level chords, future App versions may add more `⌘` accelerators. Plain keys with `⇧` / `⌥` cover nearly every performance interaction; the cost of a key conflict far outweighs the elegance of a chord.
- Table B's chords are usable but carry the yield semantics: they belong to the page while it holds focus (or the pointer is inside the monitor area) and to the App otherwise — if a performance-critical action rides on a conditional chord, make "focus is inside the page" a stable state of the work (for example, have the page focus an element on load).
