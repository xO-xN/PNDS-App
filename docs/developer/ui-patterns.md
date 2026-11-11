# UI Patterns

## Overview

This app uses a modern CSS stack optimized for Tauri desktop applications:

- **Tailwind CSS v4** with CSS-based configuration
- **shadcn/ui v4** component library
- **CSS custom-property color tokens** — PNDS palettes use hex values;
  shadcn semantic roles resolve from the same palette. Color and contrast
  live in one source, `src/theme-variables.css`.
- **Desktop-specific defaults** for native app feel

## Assistant message Markdown

`AssistantMarkdown` scopes message typography with `assistant-markdown--body`
and `assistant-markdown--compact`. Main replies use 14px/1.65 body text and
relative h1/h2/h3 sizes of 1.5/1.286/1.143em; compact headings keep the inherited
body size and use weight and spacing. Public work steps retain their existing
smaller inherited size. Shared `.assistant-markdown` selection/list/table rules
also serve handoff documents, so message scales belong to the variants.

Variants style the full GFM structure with logical spacing and clear first/last
element margins. Code blocks retain LTR whitespace and horizontal scrolling;
tables preserve cell alignment and provide a keyboard-focusable scroll surface.
Code toolbars use theme colors and stay outside text selection. Body, compact,
user-bubble and code colors all derive from the existing palette tokens.

Keep the ordinary README/help renderer, fixed-canvas cover and handoff typography
in their own roles. Message source, streaming, copy and verified-source behavior
are owned by [creation assistant presentation](./creation-assistant.md#reply-and-work-log-presentation).

## Creation tooltips

Creation controls use `TooltipHint` from `@/components/ui/tooltip` only when it
adds information beyond a visible name or a familiar icon. File rows, visible
paths, Console, standard close/expand, undo/redo, refresh and More controls have
no hover hint. Retain concise consequences, non-obvious scope and clipped
chat/model/version text; keep accessible names and control state in either case.
Every pointer hover waits the full 500ms independently, including after another
tooltip has opened. Do not reuse Radix's shared warmup or shorten the delay on
adjacent controls. Leaving or pressing a trigger cancels its pending timer;
keyboard focus still opens immediately. Escape, pressing and blur dismiss hints.
Pointer travel into the tooltip remains possible. Standalone components retain
a fallback provider.

The HeroUI-inspired surface uses theme popover colors, 12px text, 8px padding,
a 12px radius, a light theme-owned shadow and a 6px trigger gap. Arrows are
optional and omitted by default. Reduced motion and Brutal keep their existing
theme rules. Keep authored hints to one short action or scope explanation;
errors, conflicts and confirmation consequences remain visible in their panels.

Wrap popup triggers as `<TooltipHint><PopoverTrigger asChild>…` (the same
composition applies to dropdown and context-menu triggers), so their event
handlers and refs still reach the original control. Never wrap an iframe's
accessible `title`; it names the document rather than a hover hint. File paths
and dirty/conflict states remain available through the tree's accessible labels.
Chat and model labels use `overflowOnly` to reveal full text only when clipped.
Keep all hint copy in both locale files and describe the actual action, including
pause versus stop and hidden versus closed performer windows.

## Built-in utility instrument panels

Multichannel Gen v1.2.1 establishes an instrument panel direction for the
utilities: prominent channel numbers, tabular data, restrained surface
separation, and explicit textual toggle states. The main control area owns
the visual hierarchy; the phone QR lives in a native disclosure in the footer.
The desktop channel matrix and master fader share one enclosure, adapting
to four columns and a horizontal master fader on narrow screens.

Local Diagnostics v0.6.1 extends the direction with a prominent network verdict,
counts of online devices by status, and numbered device cards with measured
RTT and jitter. Offline records remain available without affecting the online
summary. Native card buttons keep their DOM identity across snapshots; the
native details dialog keeps its close button stable and returns focus on close.
The footer disclosure holds the join QR. The phone connection page uses the same
surfaces and numbering while retaining its English, automatic join/probe flow.
Its canonical source is the sibling `Local-Network-Diagnostics` repository
(`public/monitor.js`, `public/performer.js`, `public/style.css`, and shared copy).

Telematic Diagnostics v0.8.0 keeps only the public
node-to-HUB measurement. Its geographic view fits known nodes and the configured
HUB location with a modest margin; the background contains land/coast geometry
without administrative borders. The topology view remains available when
positions are unknown or coincide. Coordinates never move to separate marks.
Stable node identity colors connect points, paths and table swatches, separately
from the green/yellow/red/gray quality vocabulary. Only the self-node tag stays
visible on the map. Hover/focus previews the corresponding row and detail;
leaving restores the pinned selection and disclosure state, while clicking pins
the node. DOM identity survives telemetry and locale changes.

The v0.8.0 source lives in the existing
`../PNDS-1.6.2-projects/Telematic-Network-Diagnostics` worktree; the older sibling
checkout is not the release baseline. The App registry pins the public v0.8.0
bundle and its verified checksum. Theme and locale following retain their
existing bridges. Real-location metadata, manual correction, old-HUB behavior
and the separate HUB deployment are described in
[telematic-diagnostics.md](./telematic-diagnostics.md).

Mobile Sensor Meter v0.3.1 uses a full-width panel per device with four sensor
sections, adapting to two/one columns. Permission and sample freshness remain
separate textual states, and missing fields remain words rather than zeros.
The footer disclosure holds the QR and resolved performer URL. Monitor theme
following uses the palette bridge; phones keep their device locale and default
colors. Keypoint disclosures preserve open state/focus through shape or locale
changes, while the existing frame loop continues smoothing only values. Capture
buttons expose intent and reference permission/recovery notes. Canonical source
and notes live in the sibling `Mobile-Sensor-Meter` repository (`public/` and
`docs/ui-design.md`). Its publication in `utilities.json` is still pending the
existing acceptance process; local staging and previews do not register a release.

Utility pages continue to consume the App theme and locale bridges. Surface
colors derive from the incoming palette; Brutal also applies square corners,
a hard shadow and immediate transitions. Native buttons, range inputs and
disclosures retain keyboard operation and visible focus. Channel indicators
describe toggle selections, not measured output levels.

The canonical implementation is in the sibling `Multichannel-Signal-Generator`
repository (`public/index.html` and `public/copy.js`), with its own tests and
handoff notes. `src-tauri/resources/utilities/` is ignored staging output;
local copies are for development only and `npm run utilities:fetch` replaces
them with the releases pinned in `utilities.json`. Shipping a revised utility
requires its new release bundle and an updated registry checksum.

## Score projects using the instrument direction

All Sentient Being Sounds v2.0.1 applies the utility instrument language to a
score project in the sibling `All-Sentient-Being-Sounds` repository. Its conductor
console uses one enclosure for the measure, transport and A–D × 1–6 presence
matrix. Full numbers, actual occupancy and finished x/N stay visible; native QR
and hub disclosures retain state during signal and locale updates. Phone group /
number selection retains sharing and explicitly moves keyboard focus between
steps. The score canvas, artwork, sync and spectator projection remain unchanged;
their readable stage overlays use independent light-on-dark tokens. App palette
following recolors console surfaces, with Brutal geometry from `data-pnds-theme`.
Source and interaction/bridge tests are in `src/`, `test/ui*.test.js` and
`docs/ui-design.md`. It is distributed as an ordinary project, not in the utility
registry or staging tree.

## Performance overlay sidebar

The overlay stays visible when `selectSelectedPath` differs from the session's
project path. Use that shared selector so pending and failed preflight cards
follow their visible selection. Derive the hold from subscribed paths; returning
to the running card or starting the selected card restores ordinary auto-hide.

`HoverSidebar` keeps pointer presence separate from pointer gestures, popup, dialog, mode and
command holds. Pointer-up/cancel outside the sidebar or window blur releases
the gesture hold, so a gain/card drag never disappears under the pointer. Always clear the pointer latch on leave, including while a
portal is open; ending the last hold then hides a panel the pointer already
left. `Sidebar` reports its folder/project dialogs before reporting visibility.
Session replacement uses the bottom action's inline second-click confirmation;
its cancellation follows mode switching (Escape, outside pointer and blur), and
target, start-gate or run changes retire the pending confirmation. Only the
running card has a vertical bar; another selected card keeps its pill alone.
App settings and window confirmation stores hold
it directly; `commandPending` covers the interval before the backend publishes
starting/stopping. The hidden panel is inert, so its controls leave keyboard
navigation. The overlay uses logical insets and a mirrored RTL exit offset.
During a project drag, folder targets expand to the sidebar's right, not over
its first card. The sidebar temporarily allows that child to overflow; the
project scroller keeps its own clipping and its captured list geometry. The
targets remain in the same nav subtree for live hit-testing and independent
scrolling. Pointer release outside the physical sidebar clears the hover latch,
so removal of the external target pane cannot strand the sidebar open.

Performance project cards have a permanent two-digit ordinal on the left,
derived from the current visible order (01, 02, …). It updates after drag
reordering and appears on the drag clone. Utility/error markers, the running
bar and Cmd-number hints remain independent of that presentation number.

`useSidebarEntrance` gives the first nonempty, visible project list and each
folder change one top-to-bottom pop wave. `HoverSidebar` passes its actual
visibility, so a hidden mount does not consume the entrance; ordinary hover or
Cmd reopen does not replay it. Only currently visible cards participate, with
50ms stagger capped at 250ms and a 620ms settling motion. The shared selection
surface uses its card's delay. Native Web Animations own temporary opacity and
individual row `translate`/`scale`. The pill's entrance transform appends after
its existing positioning transform, so scaling cannot shift its anchor; neither
animation changes the underlying drag/pill styles. Selection scrolling runs
before entrance measurement, instantly for the first list or a folder change
and smoothly for selection within the same folder. A deferred notification from
that completed instant scroll does not cancel the wave.
Selection or list structure changes, hiding, pointer press, keyboard input,
wheel/scroll and resize cancel the wave before further geometry work. Preflight,
rename and status updates do not restart it. Reduced motion skips it entirely
and preference changes cancel it; Brutal retains its immediate presentation and
existing selected-card rise. This is presentation state local to the sidebar,
never persisted or coupled to the session/monitor lifecycle.

Settings temporarily hides the Developer Tools category. Its component and
commands are retained, and creation's compile/package entries remain available.
A legacy `developer` category request falls back to General instead of an empty
panel.

The r6-final shared bottom bar owns transport, refresh, running-session gain,
audio/network popovers, projection, Settings and the persistent mode control.
Fullscreen uses native window controls and the Window menu/shortcut; the bottom
bar has no fullscreen button.
Performance uses the manifest default audio mode; creation retains saved-file
mode selection in its test pane. Popovers reuse the existing setting components
and the typed command boundary. Its transport column has a fixed 190px width. Creation transport and console
controls stay mounted on home, workspace and expanded-preview layouts; a missing
workspace disables them rather than changing the bar contents. Expanded preview
retains the test start/restart action and its pending-change color ring; the
console remains disabled while its editor surface is hidden.
The audio entry uses Speaker. The bottom bar is a native deep drag region;
its blank surface and spacer move the window in either mode. Transport/gain/mode
groups and every local button/input explicitly opt out, so drag does not steal
interactive presses. Live gain reads applied runtime audio even when
another project is selected or its pending mode differs. Applied device/rate and
LAN remain separate from next-start preferences. OSC, Room and HTTPS feedback
remain conditional. Sidebar visibility never enters the monitor URL, iframe key
or viewport derivation. Use deferred-command workflow and real portal tests.

The creation titlebar is 32px high, following the Zed layout: native controls
on the left, followed by the project and Git location. The Monitor control stays
at the trailing edge and uses the theme's accent text color when expanded.
`CreationView` keeps the titlebar outside the hidden editing surface.
`ReadingWorkspace` portals the project and Git controls into a stable titlebar
slot and displays them as text in the expanded Monitor. The native container
padding is 18px in creation and 34px in performance. Actual AppKit geometry shows
a 9px button origin and 14px button height. This puts the buttons at a 9px visible
inset, centered in the creation bar. Creation uses a -12px horizontal offset
(x=16px). Performance keeps its x=28px baseline. macOS owns the native titlebar
in system fullscreen.

The project menu lists recent projects, Open folder and New project. It also
offers **Generate .pnds** in editable workspaces, opening the existing
`CreationBundle` dialog with draft/test warnings, native destination and overwrite
confirmation. Finder and rescan remain at the file-sidebar footer, and handoff
actions stay in their dedicated workspace surface.

Creation's compact pass keeps the 32px titlebar, 50px bottom bar and 226px file
sidebar. The right pane now contains only preview controls: its manual Checks
menu, clickable diagnostic count and static/controlled report mounts are removed.
Report-only `debugView` state no longer exists; assistant checks and CLI services
remain internal capabilities. Preview hiding and expansion preserve the same
iframe, bottom transport and console. Handoff opens from the pinned document in the file list. Titlebar actions
no longer use a 240px clipping box. Pinned files are single-line rows; ordinary
file names and header actions use 12px text, file paths/code use 13px, and editor
status uses 11px. Empty file groups disappear while creation/addition actions stay
at the file-list heading. The normal assistant surface has one conversation row
and a compact composer; explicit errors and in-progress cancellation remain visible.
While a reply is pending, its body shows `AssistantThoughtLine` even before public activity arrives and retains one screen-reader phase status across model and tool turns. Provisional text stays in its closed-by-default trace. The body has no loading dots. The composer keeps the rotating loading ring around the pause control; reduced motion stops rotation. Per-message server-usage statistics and their ellipsis disclosure are absent from creator messages and summary review. Empty/ready/busy controls share a fixed 30px size and the model label has a 16px gap. New text remains editable during processing, and pausing preserves that new draft. Mode switching stays disabled while work is active. Its context ring stays
visible when usage or capacity is unknown; a dashed ring denotes that state.
Configured maximum capacity can show reference occupancy in automatic context
mode without creating an input admission limit.

Secondary data uses native `details` / `summary` with `creation-details` styling:
a quiet top separator, a keyboard-focusable summary and consistent open spacing.
The chat's `AssistantThoughtLine` adapts that disclosure to a compact,
theme-colored line: a decorative S3 lattice comet runs beside a 1.8-second
text shimmer, with a 350ms settle transition. Its HTML span stage scales from
28px to 20px; a fixed 3×3 grid uses 3px circular dots on a 6px pitch, offset
6.5px on both axes. The eight perimeter cells light clockwise over 1.7 seconds
with 212.5ms phase spacing; each fades linearly from full opacity and 1.2× scale
to resting opacity and 1× scale at 45%, then rests. The centre stays dim.
Rest/dim opacity is .14/.07, or .20/.10 in the App's Stage theme. The glyph keeps
hidden overflow and strict containment, and its physical grid does not mirror
in RTL. Circular dots and their comet animation are local exceptions to Brutal's
square corners and static ThoughtLine presentation. Stopped work shows the resting
grid; reduced motion uses a static grid with its centre lit.
Its keyboard-accessible toggle reveals
public activity as a step trace. Incoming assistant reply text is rendered
immediately in the message body as the real stream grows, including partial
text retained after cancellation or failure. It is never gated on opening
the trace or completing the request. The trace starts closed,
closes on completion, failure or pause, and remains manually expandable afterward.
Only the current mounted working cycle has an elapsed timer; phase changes do
not reset it, stopping freezes it and retry restarts it. History without a real
duration shows no invented elapsed time. Reduced motion disables the remaining
animations; Brutal keeps the text and settle effects static. Provider reasoning
is never rendered here.
Keep the useful change, purpose, issue reason or parameter control outside it.

Ordinary grilling cards show Q1, Q2, … per chat. Option buttons immediately answer
on click or Enter/Space; the recommendation is an outlined rounded badge aligned
to the trailing edge. The labeled own-answer textarea is always visible, with a
small send arrow, Enter to send, Shift+Enter to wrap and IME-safe handling. A busy
answer disables all controls; errors retain the typed answer. Cancellation moves
to the conversation More menu, while restored pending cards retain Continue.
Material-conflict choices preserve explicit overwrite confirmation.

The handoff dialog separates a readable task, optional Edit task / Manage existing
content, and the actual full-document write preview. It has no creator-supplied
initial status or mandatory raw-disk pane. The write preview, saved-version
conflicts and archive destination make corrections reviewable. Only a recorded
task gains the durable, copy-only external-agent prompt in its chat reply. Native
minimum-window, theme, keyboard and real-provider QA remains pending.
Keep fields mounted so collapse preserves edits; native validation must reveal
hidden invalid inputs before focusing them. A disclosure only changes visibility,
never authorizes a save, check, version record or module installation. README
uses hover/focus edit targets on its finished composition, with portaled field
editors over the same source-span draft and the shared fixed 1200 × 800 canvas.

The right pane stays open in the workbench across discussion, file and Git pages.
The titlebar Monitor button opens and closes the expanded layout at the same
position. Expansion hides the splitter and other workbench surfaces while keeping
the running Monitor mounted. The splitter owns the sole 1px pane divider inside
its 8px drag and keyboard target and supports RTL through its logical inset.
UI tests cover DOM identity, focus and menu behavior. Physical layout at 1000x700,
themes and native rendering require the user-run App.

Pond, Sand and Stage use the main window's own `standardWindowButton` objects
inside their original AppKit titlebar group. Position, layer order, visibility
and alpha follow the shell; the original parent hierarchy and target/action
remain intact so AppKit owns grouped hover, pressed feedback and window menus.
Position reconciliation uses the actual superview height after native layout
and resize. The AppKit command completes after its main-thread update, so the
shell's coalesced requests preserve their order. Expanding or restoring the
Monitor reasserts the compact creation inset. The performance sidebar releases
its motion updates when creation takes over. The `TrafficLights` component
only reserves DOM space.
Windowed Brutal retains its separate content-owned factory-button overlay to
preserve the user-selected true rectangular frame; its interaction boundary is
described with the theme below. Fullscreen uses the system titlebar controls.

The network trigger uses Globe. Its popover keeps LAN, OSC, Room and HTTPS
feedback in `SettingsCard`, and reuses compact `NodeSection` identity inputs for
Node name and Hub address. Values align at the end, including the LTR OSC target.
Compact Node fields share the full settings store and blur-save queue; the
next-start hint appears after editing, and the applied session stays untouched.
Token remains its separate masked field in Node settings.

Performance has no top-center title/drag overlay over the score. Its accessible
Monitor identity still resolves the running project's display name, with drag
regions retained in the sidebar. Performance sidebar headings and the generic
three-dot trigger are removed; project actions use the card context menu.
Right-click selects an unselected card but never toggles off the current
selection or changes the live session. Focus-changing actions run after the
menu closes.

Settings are 768 × 560px, centered in the viewport area above the 50px bottom
bar. Width and height clamp to that available area with 24px gutters; category
content scrolls inside the fixed body. Settings use the App's Radix Select menus
for language, output device, sample rate and LAN address; no OS-native select
menus are used there. The four color themes are always visible as a horizontal
radio group with individual accent swatches (two columns on narrow windows).
Selection applies and persists immediately; arrow keys follow radio-group
navigation. The LAN list refreshes on panel mount and each address-menu open.
Selected files, settings categories and help navigation share the softer
`--pnds-selection` fill. Performance project cards adapt the local website's
`.nav-card` / `.nav-pill` design in [`site/styles.css`](../../site/styles.css):
a raised paper-colored selection, a thin accent rail, 10px corners, semibold
13px titles and muted ordinals. Pond and Sand use their card surface; Stage
uses a raised dark surface, and Brutal uses white on amber, square corners and a hard
shadow. All themes use the shared sliding selection pill, including plain ↑/↓
navigation. The selected row stays transparent on hover/press, so it cannot
cover or compete with the moving highlight. The selection rail moves with the
pill, except when the selected project already has the fixed live-session rail.
Preflight-result commits onto the same target preserve an in-flight slide.
Reduced motion retains immediate selection. Drag geometry,
keyboard navigation, project ordinals and error/removal controls stay intact.
Neutral controls use `--pnds-pill`.

During a project drag, the sidebar's `data-project-dragging` suppresses row
hover/press paint and removal affordances. Row pointer events pause while
window-level drag tracking, folder drop choices and yield transforms stay
active; background fades stop immediately. The body-portaled clone shares the
row's left ordinal and left-aligned title. In-list preview ordinals use
`reorderedList`, the same calculation as the drop commit, and update only when
the landing target changes. Folder/Home targets preview the destination
ordinal as well. Cancelling restores the original ordinals without saving.

The empty sidebar chrome slot reserves space for AppKit controls; no DOM
imitation is rendered, including under Brutal. Pond, Sand and Stage retain the
window's actual standard controls and titlebar group; Brutal's borderless frame
uses the existing AppKit factory overlay. Window restoration excludes
`DECORATIONS` as well as `VISIBLE`, so stale persisted state cannot override the
current theme's frame policy. AppKit positioning runs on the UI thread and follows main
window resize; fullscreen leaves visibility to the system titlebar. The main
monitor's component is no longer keyed by fullscreen. During the bounded sidebar transition, its real rectangle/opacity drive native
button offset/alpha through coalesced typed commands. Reduced motion takes its
actual immediate CSS state; fullscreen retains system control opacity. Native painting and
physical window input remain real macOS acceptance items.

## User Folder Dropdown

`FolderSwitch` uses the existing Radix Select for the bounded, scrollable user
folder menu and a separate Utilities toggle. While tools are active the picker
becomes a return button; folder create/rename temporarily uses the same inline
name editor. Select and context-menu visibility are ORed before reporting to
HoverSidebar. Creation project/file menus and sidebar rename use the same convention: actions that change focus run from close-auto-focus after
the portal's trapped scope is gone. The hover latch checks DOM containment:
React portal mouse events also bubble through the component tree, even though
the pointer never entered the physical sidebar.

User folder ordering uses the current folder's context menu. Project-card drag
reordering still snapshots the yielding list geometry. During a project drag,
a temporary absolute list overlays that geometry with Home and user-folder
membership targets. These choices do not yield, so the adapter reads their
live boxes while scrolling them, clipped to the visible menu viewport; hidden
rows cannot intercept project-list drops. It resolves ids back to current store indices
rather than assuming Utilities is part of the visible dropdown. Tools are never
drag sources or user-membership targets. Workflow tests pin list and choice
rectangles; the physical drag feel is a manual acceptance step.

## Tailwind v4 Configuration

Tailwind v4 uses CSS-based configuration instead of `tailwind.config.js`.

### File Structure

```
src/
├── App.css              # Tailwind imports, @font-face, desktop base styles
└── theme-variables.css  # shadcn token mapping + PNDS tokens + color themes
```

`App.css` imports `theme-variables.css`, so there is a single style entry point for the one `main` window. When adding new color variables, add them to `theme-variables.css`.

### Structure

```css
@import 'tailwindcss'; /* Core Tailwind */
@import 'tw-animate-css'; /* Animation utilities */

@custom-variant dark (&:is(.dark *)); /* Dark mode variant */

@theme inline {
  /* Map CSS variables to Tailwind tokens */
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  /* ... */
}

:root {
  /* Light mode values */
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
}

.dark {
  /* Dark mode overrides */
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
}

@layer base {
  /* Global base styles */
}
```

The examples above illustrate shadcn conventions. The actual App maps these roles to the PNDS palette in `theme-variables.css`; it never applies `.dark` (see [The Light/Dark Axis](#the-lightdark-axis)).

### Key Concepts

| Directive              | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `@theme inline`        | Maps CSS variables to Tailwind's design token system |
| `@custom-variant dark` | Enables `dark:` prefix based on `.dark` class        |
| `@layer base`          | Base styles that apply globally                      |

### Adding Custom Colors

To add a new semantic color (hex values, matching the existing PNDS tokens):

```css
@theme inline {
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
}

:root {
  --success: #16a34a;
  --success-foreground: #ffffff;
}
```

Then use with Tailwind: `bg-success text-success-foreground`

## Color Themes

`src/theme-variables.css` is the color source for all App windows. `:root`
contains Pond (the startup fallback), common font tokens and the shared shadcn
mapping. Sand, Stage and Brutal override complete PNDS color palettes through
`data-color-theme`. `src/lib/color-theme.ts` owns the attribute and persistence;
unknown values fall back to Pond, `lavender` migrates to Pond and `midnight` to
Brutal. The settings preview accents mirror `--pnds-accent` and are checked by
`src/lib/theme-palette.test.mjs`.

### Palette direction

The October 2026 correction preserves the four themes' identities and the
system fonts and compact layout of r6-final. Pond follows the logo and the pond
image through cool grey and blue, not the retired lavender palette.

| Theme         | Background | Sidebar   | Card      | Action               | Selection        |
| ------------- | ---------- | --------- | --------- | -------------------- | ---------------- |
| Pond / 池塘   | `#f1f5f8`  | `#d2d8de` | `#fcfdff` | Lake blue `#1476cc`  | `#d4e3f0`        |
| Sand / 暖沙   | `#e6ddcd`  | `#d8cfbf` | `#f1eadf` | Warm brown `#93622e` | `#ddc6a5`        |
| Stage / 暗场  | `#171b1c`  | `#1c2222` | `#232a29` | Sage `#a5c8b6`       | `#354d41`        |
| Brutal / 粗野 | `#ebb847`  | `#ffc107` | `#ffffff` | Orange `#ff5722`     | Yellow `#ffedb3` |

Brutal takes the amber sidebar, orange-red actions, white cards and pure-black
ink from the `v1.5.2` palette. Its honey-gold background is deeper than that
version's cream base, clearly separating it from Sand's pale taupe. Status and
category text use deeper ink colors to remain readable on the stronger yellow.

### Component roles

Pond's sidebar uses a low-saturation cool grey. It remains deep enough to
separate pale folder controls, white project cards and native traffic-light
highlights, while blue is reserved for actions and selection markers.

- `--pnds-pill` is a neutral control or badge surface; `--pnds-pill-hover` is
  its hover surface. `--pnds-selection` is the soft navigation fill.
  `--pnds-project-selection` and `--pnds-project-selection-foreground` are
  the paper-colored performance-project selection and its normal text.
  `--pnds-project-selection-marker` is the contrasting 3px rail; it stays visible
  on both selected cards and the sidebar. Border/shadow tokens provide the
  website's subtle elevation, with per-theme tint and Brutal's hard edges.
  Secondary and status icons retain their own colors on selected cards.
- `--pnds-text` and `--pnds-text-secondary` define readable text levels. Use
  these directly instead of lowering normal text opacity. Disabled controls
  may reduce opacity; decorative artwork may still use alpha.
- Filled actions use `--pnds-accent` / `--pnds-accent-hover` with
  `--pnds-accent-foreground`. Small accent text and focus outlines use
  `--pnds-accent-text`; Brutal's orange fill needs a darker text twin.
- Errors use `--pnds-danger` and buttons pair it with its own foreground and
  hover tokens. Warnings similarly pair their fill and foreground; use
  `--pnds-warning-text` for text. `--pnds-success` identifies readiness.
- `--pnds-border` separates surfaces; `--pnds-input` defines stronger form
  control boundaries. `--pnds-popover-shadow` also themes dialogs and menus:
  tinted soft shadows in light themes, black shadows in Stage, hard ink
  shadows in Brutal. Sonner receives the palette through inline custom
  properties on the toaster, overriding its own light/dark defaults.
- File categories keep green (system), blue (pages), ochre (audio) and plum
  (modules), with dark colors on light themes and light colors on Stage.
- Editor syntax uses its own `--pnds-syntax-*` ink: keyword, string, number,
  type, function, property and comment. Light themes use stronger hues than
  file/status labels so code categories remain distinguishable at small sizes;
  Stage keeps its light ink. Functions include method calls; properties include
  JSON keys, HTML attributes and CSS properties. Plain identifiers stay in the
  normal text color, and comments also use italics. Define every role in each
  theme here rather than recoloring UI categories or adding a runtime palette.
  Check syntax ink on the editor card, selection/search fill and the current
  line's 35% selection tint (≥4.5:1). Contrast measures readability against the
  surface; compare the same code in all four themes to assess category separation.
- shadcn `primary` maps to the App action color and its matching label;
  `secondary` maps to neutral controls, `accent` to hover, `sidebar-accent`
  to selection, and `ring` to the accessible accent text color. Shared
  destructive buttons and badges use `text-destructive-foreground`, so
  Stage's light rose fill carries a dark label.

The contrast suite checks primary/secondary/status/category text on background,
sidebar, card, controls, hover and selection (≥4.5:1), action labels at rest and
hover (≥4.5:1), selected-card labels (≥4.5:1), and input boundaries/focus outlines
and selection rails (≥3:1). It also checks theme
preview synchronization and the existing Monitor palette subset. Theme bridges
continue to read computed root values; no second runtime palette is maintained.

Brutal retains square corners, hard shadows and immediate state changes.
The sidebar slide, Brutal selected-card rise and reveal-fade exemptions stay
in place. The mode switch also retains its 300ms slanted fill, label fade/slide
and settling entry animation, with the system reduced-motion override respected.
The main window's outer shape also becomes rectangular: `window.rs`
removes the native `Titled` style in windowed Brutal, rather than only setting
contentView's layer radius to zero. It preserves resize/close/minimize flags.
The user explicitly chose to keep this true rectangular shape and the existing
button interaction. AppKit's public standard-button factory supplies that
windowed Brutal overlay in an input-transparent NSView, positioned by the
existing sidebar/titlebar motion machinery. These factory buttons are not the
window's own titlebar group: matching system grouped-hover icons, press/hold
behavior or the green window-management menu is not promised for Brutal.
The retained overlay is hidden in Pond, Sand and Stage, which restore the
window's own standard buttons and original titlebar hierarchy, and in fullscreen,
where the system controls take over. The green Brutal overlay button continues
through Tao's fullscreen setter, which prepares/restores borderless styles.
All AppKit corner work runs on the UI thread; the theme command awaits its
completion before CSS changes. Closing still uses the existing close-request
path and fades/hides the main window without stopping the project. Theme,
fullscreen, mode and sidebar changes keep the WKWebView and score instance
mounted. Native hover/press/menu behavior, geometry, creation-menu hit testing
and theme/fullscreen round trips require real macOS acceptance; pure policy
tests and clippy do not establish that physical behavior.

The explicit `native_window_controls` fixture calls the production window setup,
theme/corner and visibility commands in its own Tauri process. Run it with
`npm run rust:test -- --features native-client-fixture --test native_window_controls -- --ignored --nocapture --test-threads=1`.
It verifies the original button objects, parent group and actions, actual hover
glyph pixels and a native minimize click, sidebar alpha/visibility, content hit
testing, resize and theme/fullscreen round trips. It does not start a development
server or a score project. This check passed on 2026-11-10; the user additionally
confirmed Sand's hover icons and press-and-hold green menu on the running App.
The full `npm run check:all` also passed with Rust tests serialized. These are
local execution results, not signed-installation or minimum-OS certification.

Welcome's soft logo stage stays hidden in Brutal. Its existing
`src/assets/octo-sidebar-2x.png` illustration now appears above the hero, instead
of occupying project-list space. It is decorative, non-draggable and sized to
fit the welcome area's height. Brutal's title and subtitle share one white
paper rectangle with an ink outline and hard shadow. The image frame reserves
560:318 of the 560×342 source: the body baseline meets the rectangle's top
edge, while hands and tentacle tips extend over it. The artwork remains intact
and scales uniformly; the other three themes retain the logo stage and plain copy.

Brand logo colors, creator-owned README artwork and Monitor/Performer content
keep their own color intent. Monitor scrims use an independent dark backing
because they can sit over arbitrary project artwork; optional theme following
still runs through the existing bridge.

## The Light/Dark Axis

`ThemeProvider` pins `light` on `<html>`; it never applies `.dark`. Stage is a
complete color palette selected by `data-color-theme`, rather than a second
light/dark axis. The unused stock shadcn palettes are removed so they cannot
become a second source of colors. Stage sets native `color-scheme: dark`;
the other themes set `color-scheme: light` so native option menus and scrollbars
match the selected App palette.

## Color Token Formats

PNDS color values are six-digit hex. Common shadcn roles reference them with
`var()`, and shadows/scrims use RGB alpha where transparency has a visual role.
Components use Tailwind token utilities such as `bg-(--pnds-pill)` and
`text-(--pnds-text-secondary)`; do not add literal UI colors in components.

## Desktop-Specific Styles

The `@layer base` section includes styles that make the app feel native on desktop.

### Text Selection

```css
body {
  user-select: none; /* Disable by default */
}

input,
textarea,
[contenteditable='true'] {
  user-select: text !important; /* Enable in editable areas */
}
```

**Why:** Desktop apps typically don't allow selecting UI text, only content.

### Cursor

```css
* {
  cursor: default; /* Arrow cursor everywhere */
}

input,
textarea {
  cursor: text !important;
}
```

**Why:** Native apps use arrow cursor, not text cursor on labels. The old
`.cursor-pointer` utility is retired app-wide: every control — segments,
cards, icon buttons, `<summary>` disclosure — keeps the arrow; affordance
comes from hover/press styling, never the hand cursor.

### Focus Ring

```css
.pnds-focus-ring:focus-visible {
  outline: 2px solid var(--pnds-accent);
  outline-offset: 1px;
}
```

One shared class by default for interactive controls in the app's own UI (the
shadcn settings primitives keep their design-system ring). `:focus-visible`
only — mouse clicks never show a ring, Tab navigation always does. New
controls take the class instead of hand-rolled `focus-visible:outline-*`
variants.

The E sidebar folder selector is an approved exception: its keyboard focus
feedback stays on the dot/bar marker, with no outer outline or box shadow.
It retains its selected-item Tab stop, activation and management-menu keys;
ordinary buttons continue to use `pnds-focus-ring`. See [the keyboard contract](./keyboard-shortcuts.md#folder-selector-e-sidebar-replaces-the-v16-dropdown-issue-153).

### Scroll Behavior

```css
body {
  overscroll-behavior: none; /* Prevent bounce/refresh */
  overflow: hidden; /* Prevent body scroll */
}
```

**Why:** Prevents pull-to-refresh and elastic scrolling that feels wrong in desktop apps.

### Drag Regions

```css
*[data-tauri-drag-region] {
  -webkit-app-region: drag;
  app-region: drag;
}
```

Apply `data-tauri-drag-region` to elements that should drag the window (like title bars).

## Component Organization

```
src/components/
├── shell/             # App shell and window states
│   ├── AppShell.tsx   # Routes welcome / loading / ready / error
│   ├── Sidebar.tsx, HoverSidebar.tsx, MonitorView.tsx, LoadingScreen.tsx
│   ├── TrafficLights.tsx (window controls), SettingsCard.tsx, PndsLogo.tsx
│   ├── CloseConfirmDialog.tsx, QuitConfirmDialog.tsx, ErrorScreen.tsx
│   └── index.ts       # Public exports
├── settings/          # In-app settings panel (SettingsPanel + sections)
├── ui/                # shadcn/ui primitives (button, dialog, ...)
├── welcome/           # WelcomeScreen (no project loaded)
├── ErrorBoundary.tsx
└── ThemeProvider.tsx
```

### Conventions

- **shell/** - Structural components that define the app's regions and window states
- **settings/** / **welcome/** - Feature folders grouping related components
- **ui/** - shadcn/ui primitives (yours to modify)
- **shell/**, **settings/**, and **welcome/** expose a public `index.ts`; import from the folder, not deep paths

## shadcn/ui Usage

### Adding Components

```bash
npx shadcn@latest add button
npx shadcn@latest add dialog
```

Components are copied to `src/components/ui/` and can be customized.

### Customizing Components

shadcn components are yours to modify. Common customizations:

```tsx
// src/components/ui/button.tsx
const buttonVariants = cva('...', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground',
      // Add custom variant
      success: 'bg-success text-success-foreground',
    },
  },
})
```

### Available Components

This app includes commonly needed components. Run `npx shadcn@latest add [component]` to add more from [ui.shadcn.com](https://ui.shadcn.com/docs/components).

### App dropdowns

App selectors use `Select`, `SelectTrigger`, `SelectValue`, `SelectContent` and
`SelectItem` from `src/components/ui/select.tsx`. Their popup follows the App
palette, focus styling and keyboard interaction. Do not use HTML `select` or
the retired `NativeSelect`; `no-native-select` enforces this in App JSX. Radix's
hidden native control remains available for form semantics.

Use `onValueChange` for string values and label the trigger with `htmlFor`,
`aria-label` or `aria-labelledby`. Pass `disabled` to the Select root when the
operation is locked. Preserve a selected label's natural width rather than
sizing the trigger to the longest option. An undeclared manifest mode uses the
UI value `undeclared`, mapped back to an empty string; it must remain possible
to clear the selection. SelectItem values cannot be empty strings.

Tests open the popup and choose its option through `chooseSelectOption`, or use
keyboard input; native change events do not exercise the App menu.

The shared Select, DropdownMenu and ContextMenu wrappers adapt React Bits
GlideSelect: a 10px surface grows from its Radix anchor in 180ms, closes in 120ms,
and a 6px highlight glides between actual row bounds in 220ms. Select chips use
32px / 28px heights, a rotating chevron and trailing selection checks. Popovers
share the surface entrance while retaining their form/content layout. The chat
picker opts its list into the same highlight while keeping separate delete
buttons and its original keyboard navigation.

`GlideHighlight` is decorative (`aria-hidden`, pointer-transparent). Its host
uses `pnds-glide-list` and marks eligible rows with `data-glide-item`; it reuses
`useIndicatorPill` for layout, resize and font scheduling. Pointer highlighting
remembers the last row, keyboard movement jumps, and an external selection
updates the resting highlight immediately. Geometry compensates for scrolling,
surface scaling and borders; list mutations and resize remeasure it. Each nested
list owns its own highlight. Disabled rows are excluded, but visual dimming alone
does not make a row disabled. Radix Select's persistent selection comes from
`data-state="checked"`; its `aria-selected` also depends on focus.

Keep Radix portals, collision positioning, scroll controls, typeahead, selection
and focus callbacks. Submenus portal independently so entrance transforms cannot
change their fixed-position coordinate space, following the
[Radix submenu pattern](https://www.radix-ui.com/primitives/docs/components/dropdown-menu#with-submenus).
The surface returns to `transform: none` after entering. Highlights use the
existing `--pnds-pill-hover` token; destructive actions keep their distinct ink
and tint. Reduced motion disables movement, and Brutal retains square, immediate
surfaces. A searching dialog such as Quick Open keeps its existing dialog model.

File actions, assistant history actions, sidebar folder actions and project-card
actions opt into `pnds-action-menu` for a shared 19rem,
viewport-bounded layout. Their Radix items accept `icon`, `description` and
`shortcut`; `MenuItemContent` places a 16px decorative icon beside the title and
an optional secondary explanation, with a trailing light `Kbd`. Keep simple
ordering actions single-line. Existing compact menus and Selects retain their
layout. Named Radix groups and separators organize actions; destructive actions
keep their warning color and original confirmation flow. Disabled titles/icons
dim while the explanation stays readable.

The former fifth category, the titlebar Checks/check-selection menu, is removed
with the manual inspection UI. Remaining action menus retain this row layout and
the shared GlideSelect surface/highlight behavior.

Detailed items use only the title for their accessible name and default
`textValue`, and associate explanations through `aria-describedby`. Existing
caller descriptions are retained. Shortcut hints are decorative; only advertise
verified bindings with the correct scope (the folder's existing `Meta+R`), and
expose the matching `aria-keyshortcuts`. Opening inputs or dialogs still waits
for close-auto-focus. File reload, protected names, live projects and utility
restrictions retain their existing gates. The removal description distinguishes
external project files, which remain on disk, from App-managed installed copies,
which are reclaimed; deleting a folder grouping returns its projects to Home.

The same Glide ResizeObserver watches its host and all rows owned by that list,
including disabled rows that can shift later items. Child-list mutations update
the observation set, and unmount disconnects it. This keeps the highlight aligned
when explanations wrap inside a height-bounded menu without resizing its host.

### Async dialog geometry

The first visible dialog frame must already have its intended layout. The
module and shared-package browsers read their catalogs before opening and show
loading on their triggers. They share the card/detail shell, fixed title and
footer, scrolling body, and title/card/trigger focus restoration.
The project selector is an anchored, height-bounded DropdownMenu. Loading,
errors and recent projects stay beneath its stable Open folder/New project
entries. Actions that open a form or native picker run after menu dismissal;
Escape restores trigger focus without changing the workspace. Dialog returns
use named trigger markers (for example `data-creation-git`), never the first
button with `aria-haspopup`, since both project and Git now have menus.
Git inspection likewise keeps loading, errors and results in a reserved scrolling
body inside one bounded fixed-height shell, including delayed diff previews.
Settings and project introduction use fixed shells with scrolling content.
Do not initially render a short centered loading dialog and expand it when an
async read returns: changing the height moves its top edge abruptly.

Check real browser frames with a delayed command response. jsdom does not
measure layout. The October 2026 audit reproduced a 123px frame jump in the
former project-picker dialog; that surface is now an anchored menu.
Handoff, new project, settings, port confirmation and initial bundle dialogs
had no async jump in the same audit; normal entrance scaling stays centered.

## The `cn()` Utility

All components use the `cn()` utility for conditional classes:

```tsx
import { cn } from '@/lib/utils'

function MyComponent({ className, disabled }) {
  return (
    <div
      className={cn(
        'base-styles here',
        disabled && 'opacity-50',
        className // Allow overrides
      )}
    >
      ...
    </div>
  )
}
```

**Pattern:** Always accept `className` prop and merge with `cn()` for flexibility.

## Component Patterns

### Layout Components

Layout components should:

- Accept `children` and `className` props
- Use flexbox with `overflow-hidden` to prevent content bleed
- Not set external margins (let parent control spacing)

```tsx
interface PanelProps {
  children?: React.ReactNode
  className?: string
}

export function Panel({ children, className }: PanelProps) {
  return (
    <div className={cn('flex flex-col h-full overflow-hidden', className)}>
      {children}
    </div>
  )
}
```

### Visibility with CSS

For panels that toggle visibility, prefer CSS over conditional rendering. Real example — `HoverSidebar` keeps the sidebar mounted so the slide/fade animates both ways:

```tsx
;<div
  className={cn(
    'absolute bottom-3 left-3 top-3 z-50 transition-all duration-200 ease-out',
    sidebarVisible
      ? 'translate-x-0 opacity-100'
      : 'pointer-events-none -translate-x-5 opacity-0'
  )}
>
  <Sidebar variant="overlay" />
</div>

// Avoid: Loses component state on hide/show
{
  visible && <SideBar />
}
```

This preserves scroll position, form state, and animation continuity.

### Imperative Indicator Pills

A pill that slides over targets (the folder segment track, the selected project card) is positioned by direct style writes, never React state — a state update per move would re-render whole rows for a purely visual shift. Since v1.3.2 (issue #78) one engine serves both pills, `src/hooks/use-indicator-pill.ts`:

- `useIndicatorPill({ apply, remeasure })` runs `apply` after every commit (a layout effect, so nothing paints stale) and `remeasure` on window resize and once `document.fonts.ready` settles — web fonts change widths after first paint. `remeasure` defaults to `apply`; override it when reflow-time inputs differ. Both Sidebar pills re-read the store directly there, and the card pill deliberately drops its drag/snap hide (a resize mid-drag briefly ignores the hide; the next commit corrects it).
- `applyIndicatorGeometry(pill, target, axis)` / `clearIndicatorGeometry(pill, axis)` are the shared geometry writes — translate along the axis, size across it. Target resolution and animation policy live in `src/lib/selection-pills.ts` (`applyFolderPill` resolves the active segment — consumed by `FolderSwitch`; `applyCardSelectionPill` owns the anchor/slide/rise logic — consumed by Sidebar), so the engine never grows per-pill flags. The same module declares `CARD_SELECTOR` (`[data-project-path]`) once — the DOM contract the card pill, the selection-reveal scroll effect, and the drag adapter all query; never re-spell that attribute selector.

To add a third pill: render an absolutely positioned element with a class-owned transition, resolve the target in a policy function in `selection-pills.ts`, and schedule it with the hook.

### Loading Animation and Webview Suspension

The loading logo (`PndsLogoCanvas`) advances by monotonic elapsed time,
not by delivered frame counts. Keep its clock alive across readiness,
callback and audio-mode changes; restarting an effect on every snapshot
loses the elapsed background interval. Its waiting phase observes rAF
delivery without repainting or advancing the animation.

If a frame gap exceeds the full entrance + closure duration, the unseen
choreography is retired: wait for backend readiness, paint the final
closure frame, then let `LoadingScreen` release through the existing
monitor-load/timeout gate. Late ready messages must retain this recovery
decision. Never release an unready backend or bypass the iframe gate.
The main webview disables background throttling on macOS 14+; elapsed-time
recovery also applies on macOS 13.5, where that option is unavailable.

For suspension tests, advance `performance.now()` independently of rAF
callback delivery (`LoadingScreen.test.tsx`). Advancing fake rAF timers
normally delivers every missing frame and cannot reproduce issue #34.

## Best Practices

### Do

- Use semantic color tokens (`bg-background`, `text-foreground`)
- Accept `className` prop on components
- Use `cn()` for conditional classes
- Keep desktop UX conventions (cursor, selection, scroll)
- Follow existing patterns in codebase

### Don't

- Use raw color values (`bg-white`, `text-gray-900`)
- Hardcode light/dark specific values
- Override shadcn components in place (copy and modify instead)
- Add `cursor-pointer` — the hand cursor is retired app-wide; affordance
  comes from hover/press styling
- Hand-roll `focus-visible:outline-*` variants — use the shared
  `pnds-focus-ring` class, except for the approved folder-marker treatment above
- Use viewport-based responsive design (this is a fixed-size desktop app)

## README cover composition

The audience-facing `ProjectCoverPage` implements the approved Brutalist HTML
composition: four small two-line metadata blocks across the top, a PNDS池谱
wordmark with palette swatches, left cover, right introduction and a single-line
large title in the lower left. It shares the App background without a paper card,
border or shadow. Foreground and atmospheric layers belong to one **1200 × 800**
logical canvas. `cover-frame.ts` observes only its definite viewport, fits both
axes with 24 screen-pixel gutters, and multiplies the uniform scale by projection
zoom. It never reflows content at viewport breakpoints. 4:3 and ultrawide windows
center the same artwork. Creation supplies the same viewport without a second
aspect-ratio frame. Keyed projection zoom and ordinary document/name-card zoom
retain their existing ownership and persistence.

`composer`, `duration`, `performers` and `contact` feed the top row. Labels and
empty-value dashes never become README values; the author's leading `@` is removed
only for display. Missing metadata stays editable on old covers. All four fields
use the existing source-span draft editor and explicit Save boundary. Missing
lines are inserted before the first `##`; unknown fields, CRLF, later sections and
existing URL metadata are preserved. No manifest or runtime contract is added.

The palette's strongest chromatic hue produces the reference's fluorescent island
and pastel companion. The two layers loop independently at 61/79 seconds with at
most 10 logical pixels of displacement and 0.99–1.03 scaling; grain remains still.
The canvas background follows the App; Stage reduces fog/grain strength. Reduced
motion disables fog, title motion and automatic prose scrolling.

`CoverMarkdown` retains GFM structure and inert link labels, strips standalone
navigation paragraphs, embedded images and active HTML. The fence-aware first
section parser owns the README/`---` boundary; ordinary documents retain their
existing renderer. `attachCoverIntroFit` fits only the prose within the fixed band
between 18px and 15px. Longer content retains native/slow automatic scrolling;
editing pauses it. Window resizing cannot change the logical prose measure.

## Cover title fitting

`ProjectCoverPage` attaches `attachCoverTitleFit(title)` from
`src/components/readme/title-fit.ts` in a layout effect keyed by `page.title`.
The returned disposer owns the entire lifetime: synchronous DOM probing and
plan application, bounded refinement/fallback, reveal gating, retry/verification
timers, fonts, document visibility and zone observation. The component owns the
title's markup, glyph animation and embedding tokens; the fitting module owns
only its inline spacing, size, transform and temporary visibility.

Keep the WebKit invariants inside that module: measure the zone's content width;
style a fresh hidden clone before inserting it in the same cq context; derive
em from its line height; converge only from probes; center by half the trailing
spacing (reverse for RTL). Computed title font size and settled scroll overflow
are diagnostics. Never replace these with live-title or Range geometry without
real-machine evidence. All embeddings use the same fixed stage. The component passes -0.055em design
tracking. Probe rectangles are normalized by the parent's actual transform scale
before measuring logical em/width, so resizing and projection zoom do not change
the fitted title. Negative tracking fits by a proportional font-size reduction;
existing nonnegative tracking and optical-centering behavior remain supported.

Motion allowed reveals synchronously unless fonts are loading (ready or 400ms
cap). Reduced motion with ResizeObserver uses a 150ms mount hold and 90ms quiet
window; font loading and hidden documents block quiet reveal. Verification at
600ms also reveals a stuck title; the independent cap is 800ms. Further checks
at 2s/5s handle silent cq/font drift. Failed geometry has one outstanding 300ms
retry, with at most 16 retries per lifetime; a successful fit cancels it.

Dispose before reusing the h1 for another title. An explicit disposed flag guards
font Promise continuations and queued observer callbacks, which removing listeners
cannot cancel. Cleanup restores visibility and removes all owned timers/listeners.
Tests exercise this single interface using frozen probe geometry and a controlled
clock/font/visibility/resize environment; pure branch math stays private. Real
WebKit painting, fonts, zoom and full-screen transitions remain manual acceptance
(see [app-behavior.md](./app-behavior.md), cover page section).

The assistant's context ring uses the theme's existing success, warning-text
and danger ink through `--pnds-context-low`, `--pnds-context-mid` and
`--pnds-context-high`. The estimated proportion stays green through 20%,
reaches amber at 60% and red at 100%, with continuous sRGB blends between
thresholds. The neutral background track remains continuous. The number is
labelled as estimated and the popup gives textual Smart zone / growing /
new-chat guidance, so color is not the only signal. Palette tests check all
three surfaces and intermediate blends for readable percentage text.

Creation assistant output retains a screen-reader live status and the composer’s
loading/stop control; no additional body dots or pulsing phase label compete with
the reply. The model ID sits beside the send/pause control with ellipsis and a
full-value title. Reduced motion removes rotation without hiding task state.

### Creation workspace navigation (2026-10-19)

The reviewed prototype's fixed middle navigation and directory tree are implemented
in `CreationView`, `CreationFileTree` and `CreationGitLocation`. Discussion/Work is a
visible radio segment in the composer, with arrow/Home/End keyboard selection; a
running task keeps its send-time mode and disables switching. New labels use locale
keys and new layout uses logical CSS properties. Real tree rows expose treeitem
semantics, full paths and inline F2 rename; root declarations precede directories.
Explicit `[hidden]` rules accompany flex rows/panels so browser layout cannot
accidentally reveal a retained view.

`AssistantModeSwitch` adapts React Bits RubberSegment to a compact 28px track
with equal slots, a sliding thumb, 5px trailing-edge squash and drag/flick release.
Motion values drive its clipping without putting pointer motion into React state.
Track, thumb and labels use existing theme tokens; duplicate labels under the
clip are `aria-hidden`. The original buttons retain visible focus and native
activation. Pointer cancellation, capture loss, blur, disabled state and external
selection restore the controlled value; resize, fonts, locale and root direction
changes remeasure physical slot bounds. Reduced motion and Brutal use immediate
positioning and Brutal also removes the clip radius.

`CreationDebugPanel` stays mounted outside the runtime iframe. Its menu opens static
or controlled-check views within the right pane; opening the menu runs no check.
Visited reports retain state across middle-page navigation. Their original native
runners and authorization stay unchanged. Covered runtime/idle content is inert,
and closing a report returns focus to the debug menu. The underlying runtime iframe
remains mounted; expanded preview retains its own restore-workspace control.
The bottom transport starts with Run/Restart and has no refresh or separate stop
button; saved-page refresh is in the native Window menu. Guarded version/project changes retain native shutdown.

The Git titlebar control keeps branch and version on one line. Both labels can
shrink with ellipsis, and the full position is available in its title and menu;
SVG affordances stay fixed. Shell errors use the existing themed Sonner fade
transitions, appear above the 50px transport, and never allocate a content row.
Long feedback is bounded and scrollable. Reduced-motion handling remains Sonner's
existing behavior. Root README language variants stay beside the default README
at the top of the real file tree.

2026-10-19 底栏细调：`.desktop-transport` 使用内容宽度，不再保留 190px 空槽；
音量组取消两侧边线与内边距，让运行按钮、音量及音频设备按现有 gap 相邻。
此调整不改变主音量的运行归属、静音/固定增益与重启保护。

### Compact Git graph and pinned project documents (2026-10-19)

The version surface uses a vertical branch log with fixed-height rows and a
resizable graph/difference boundary. The single 1px separator sits inside an 8px
row-resize target with a centered grip and keyboard focus. Pointer capture keeps
resizing stable; cancel restores the starting ratio. Context-menu height actions
provide a single-pointer alternative. The redundant current-version strip and
filled-circle legend are removed; the graph retains current/selected markers.

Discussion / Git versions are the only fixed reading controls. Handoff is an
ordinary closable Markdown file view. The file list pins manifest, root README
translations and the real handoff path once, with a medium-weight purpose, quiet
separator and smaller monospace basename. This does not move files or relabel
API paths. Names truncate on one line and expose full relative paths on hover.
Ordinary tree and comparison rows share the same label component; comparison
selection still does not open or edit a current file.

### 创作模式表面分层 A（2026-10-24）

用户已批准[表面分层原型](../prototypes/creation-surface-study.html)的 A 桌面分层，作为 Pond、Sand、Stage、Brutal 正式创作界面的配色依据。B／C 保留为原型比较，不引入其留边或窄窗口布局行为。

创作表面集中在 `src/components/creation/creation-surfaces.css`，主作用域为 `.creation-shell-frame`。`theme-variables.css` 按四主题提供与批准 HTML A 对应的专用角色：

| 表面     | 专用 token                  | 用途                                     |
| -------- | --------------------------- | ---------------------------------------- |
| 外壳     | `--pnds-creation-shell`     | 标题栏、底部运行控制和工作台框架         |
| 导航     | `--pnds-creation-nav`       | 文件树与辅助导航                         |
| 工具栏   | `--pnds-creation-toolbar`   | 页签、编辑工具和输入区外壳               |
| 工作区   | `--pnds-creation-workspace` | 助手正文、代码正文和版本详情             |
| 辅助区   | `--pnds-creation-aux`       | 预览宿主等次要区域                       |
| 嵌入区   | `--pnds-creation-inset`     | 输入、搜索、代码摘录和局部编辑控件       |
| 浮起表面 | `--pnds-creation-raised`    | 问题／任务操作卡、主输入和明确加入的浮层 |

`--pnds-creation-line` 区分区域边界，`--pnds-creation-hair` 用于局部分隔；`--pnds-creation-user` 单独表达用户消息底色。保留现有通用主题 token、操作色、文字、选中与危险语义及 theme bridge 接口；用户消息的文字、次要文字、危险文字和焦点配色继续成套处理。普通助手回复保持工作区背景，避免把每个有边框或透明容器统一涂成卡片。

聊天入口行沿用工作区表面与细分隔线；composer 外壳使用工具栏表面，主输入采用浮起表面。主输入边界以原输入色混入 10% 正文色，保证 Stage 上的 3:1 可辨性；卡内输入与搜索仍使用嵌入区。对比度测试核算七表面的正文／状态／文件类别、代码当前行混色、用户气泡文字，以及实际输入和焦点的可见性，不用界面截图代替颜色核算。

作用域只覆盖创作 Host；演出界面、设置与作品 iframe 保持各自主题。Portal 不继承 `.creation-shell-frame`，需要创作表面的内容通过专用 class 显式加入，保留原 Portal 容器与焦点行为。226px 文件侧栏、32px 顶栏、50px 底栏、三栏布局及现有保存、授权、运行和挂载关系保持不变。

本次正式 App 的四主题视觉／真实工作流 QA 与 `npm run check:all` 结果待更新；原型验证不替代正式 App 验收。

## Shared search fields (2026-10-24)

`SearchField` adapts the [HeroUI SearchField reference](https://heroui.com/en/docs/react/components/search-field)
with the existing React/Lucide stack: a leading search icon, rounded field,
trailing clear button, and a whole-field focus ring. It covers Help Center,
workspace file paths, Quick Open, Git comparison file filtering and editor Find.
The primary card/shadow variant serves dialogs and Help; the secondary control
surface serves dense tools, with a compact size for file sidebars. Every surface,
placeholder, icon and focus outline follows the four PNDS palettes; Brutal keeps
square geometry and a hard primary shadow.

The component only owns search chrome and clear-to-empty focus restoration.
Query state, filters, IME-aware Enter, result navigation, editor replacement and
Escape behavior remain with the caller. Quick Open retains its combobox role,
listbox relationship and active descendant. Other fields use native searchbox
semantics. A localized clear label and the caller's accessible input name remain
available independently of placeholders. Hiding WebKit's native cancel control
avoids two competing clear buttons. Clearing Help keeps an already opened article.

### 分类设置与底栏快捷面板（2026-10-24）

采用 [设置 A 原型](../prototypes/settings-audio-network-review.md)：866×594 上限的分类窗口、176px 导航、四主题预览和类别关键词搜索；内容独立滚动，关闭入口常驻。访问过的设置分类在窗口打开期间保留挂载，模型服务／DNS 的异步操作不因导航丢失；关闭后清空搜索。CSS 统一在 `components/settings/settings.css`，沿用语义主题 token 与 Glide 浮层。

音频快捷面板只显示输出设备和采样率两个下拉；运行状态、当前值差异、下次启动说明和设备能力提示留在完整设置。网络快捷面板只保留小号地址、复制、大二维码与 LAN 选择，节点／Hub／Token 和项目 OSC／Room 在完整设置。没有已应用快照时不编造旧值；设备菜单的真实设备名称与通道能力保持。

底栏图标与旁边文字使用同一份运行／待应用配置。`getDesktopDeviceStatus` 独立读取类型，不改变原有音频能力和 LAN 列表 API；运行中的 Internal 只查询已应用设备，External／None 不借系统默认输出冒充实际设备。空闲的系统默认选项才解析 macOS 当前默认设备。音频依 CoreAudio UID 与输出终端识别，兼容 CoreAudio FourCC 和 `IOAudioTypes.h` 的数字终端编码（耳机 `0x0302`／耳麦 `0x0402`）。明确耳机使用耳机图标，声卡、扬声器及其余输出统一使用喇叭图标；已枚举的物理输出返回终端 `0` 时按声卡／扬声器处理，不能让它与旧数字编码一起被误归为通用波形图标。网络以所显示 IPv4 对应的 BSD 接口查询 SystemConfiguration 类型；不猜设备名称或 `en0`，也不改用互联网默认路由。无法唯一匹配、设备移除或查询失败时，音频使用喇叭回退，网络使用通用网络图标。可见主窗口每 3 秒及恢复焦点／可见时刷新，隐藏时跳过；跨配置迟到结果作废。此查询不会切换设备、改偏好或重启运行。

本地网络下拉在底栏快捷面板、演出卡和完整节点设置中使用同一 `LanAddressLabel`：IP 逻辑起始侧放置 14px 单色图标，间隔 8px，数字使用等宽数位并由 `bdi dir="ltr"` 保持顺序，选中勾选仍归 Select 的逻辑末端。菜单打开时以 `getLanInterfaceKinds` 批量查询当前候选 IP 的类型；元数据独立于地址选择，失败或迟到不改变候选值、当前选择或持久化。选项与触发器用本地化 `aria-description` 提供类型，图标本身不重复朗读。

演出／池客底栏复制与二维码读取实际持有的 PublicEntrySnapshot.url；创作底栏读取当前工作区 ready 测试的实际 performer URL。不能从所选卡、manifest 或待生效 LAN 拼接邀请；复制保留完整 URL，入口故障禁用操作。完整设置中才展示实际运行端口及明确标注的旧工程地址，HTTPS 故障不回退 HTTP。创作 OSC 编辑仍归 creation-test-store，加载或启动／停止期间禁用；节点输入失焦经 preferences 队列保存，编辑不重启运行。

模型服务、Git 身份、HTTPS、DNS 与端口沿用同一套字段行、分隔线、反馈和操作区，避免每个值再包一张卡。模型上下文、证书主题／指纹、正常 DNS 监听／上游和端口进程详情采用原生 `details`；折叠保留表单 DOM 与草稿，校验错误、到期信息、授权恢复与监听故障始终可见。自动保存与已配置信息不再以多段静态说明重复呈现，实际保存／失败反馈保留。

HTTPS 证书有效性、DNS 系统注册、后台运行、域名映射分别反映各自事实，不互相替代，也不代表演奏者设备已可访问。HTTPS 的下次启动生效说明只显示一处。端口行保留占用状态与释放操作，App 管理的端口合并为一条关闭工程提示；展开进程详情不触发释放，原有完整进程身份确认保持不变。

## 演出模式表面分层 A（2026-10-24）

用户已批准[演出 A 配色原型](../prototypes/performance-surface-study-review.md)接入 Pond、Sand、Stage、Brutal。`performance-surfaces.css` 在 desktop 样式后加载，主作用域为 `AppShell` 在演出时挂载的 `.performance-shell-frame`。颜色来自 `theme-variables.css` 的 `--pnds-performance-*`；共享底栏另由下述 `desktop-controls.css` 统一，不修改通用 palette、创作表面 token、主题桥或作品 iframe。

`workspace` 同时用于演出 frame 底色、普通 README、文件夹说明、欢迎／错误页及加载／停止过渡，使悬浮侧栏背后的空白与右侧阅读区连续。结构化 README 封面不挂 `performance-reading-surface`；frame 通过 `:has(.desktop-performance-main .readme-cover-host)` 改回 `--pnds-bg`，只延续封面的基础底色，不给封面图案、布局或作品画面重新配色。`performance-transition-surface` 只改变加载／停止覆盖层底色，保留图案、挂载、透明度与 reveal 时序。

`nav` 同时用于 320px 侧栏及其 44px 原生按钮区，顶部不另设色条或渐变。`inset` 用于文件夹选择与快捷面板输入；`raised` 用于选中工程及显式加入的浮层。快捷面板底部设置入口使用 `toolbar`，悬浮改为 `inset`，提示使用 `aux`；`line`／`hair` 区分区域边界与局部分隔。保留侧栏 12px 外距、普通阅读区 344px 起点、全宽运行画面及既有工程卡尺寸、滚动、拖拽和原生窗口行为。选中工程的纸面与运行工程轨道仍由各自事实决定。

Portal 通过 `performance-surface-popover`、两种模式共用的 `desktop-surface-popover` 或拖拽影子的 `performance-project-ghost` 显式加入配色。演出工程菜单沿用前者，音频／网络快捷面板在两种模式都使用后者；面板内字段、提示与底部入口只在显式祖先下调整表面。正常字段使用不透明的 `control-line` 边框与键盘焦点轮廓，保证 Stage 浮起背景上的可辨性；`aria-invalid` 错误边界与禁用透明度保持原样。独立 Select portal、完整设置和原确认对话框保持共享 palette，不按 body 模式批量染色，不改变 portal 容器与焦点返回。

独立 HTML 保留最初的扁平配色及原按钮对照，未追随下述玻璃材质更新。最新效果以生产 CSS 为准。初次接入的构建、全量与四主题真实 Shell mock 检查属于前一轮证据；后续共享底栏调整的验证单独记录在[评审说明](../prototypes/performance-surface-study-review.md)。

## 两种模式共用底栏与按钮材质（2026-10-25）

`desktop-controls.css` 将已确认的 Liquid glass C 方案用于演出／创作底栏。两种模式共用 `--pnds-desktop-bar`；布局、顺序、50px 底栏、30px 两端按钮和原模式按钮宽度保持不变。主要动作最小宽度 100px；Pond／Sand／Stage 使用 999px 胶囊圆角，Brutal 使用不透明方角硬边框。

底栏网络与音频使用独立紧凑弹层：网络宽 296px，二维码填满扣除 12px 内边距后的区域，按「演奏者入口」、11px 数字地址及独立复制按钮、二维码的顺序上下居中排列；复制保留完整 URL，编码器原有 quiet zone 不变。本地网络选择保留，选择下方及设置链接上方不画分隔线。音频宽 272px，只保留输出设备与采样率两个有标签的下拉，不显示标题、运行状态、差异提示或设置链接；完整设置继续显示这些信息。两者都受可用窗口宽高限制，菜单保留原焦点与键盘规则。

`DesktopActionGlass` 只提供 `aria-hidden`、不接收指针的装饰层，原生按钮继续负责命名、焦点、尺寸和动作。唯一的动态色环内缩 1px、厚 1.1px，始终同向；原始 CSS 时间轴为 3 秒一圈，角速度按该周期在平均值的 80%～120% 之间变化。CSS 关键帧按积分相位采样，每 2.5% 一个节点，兼容原有 WebKit；下述演出加载／重新加载通过播放速率区分普通与悬停状态，不改变关键帧或增加逐帧 JavaScript。内容折射只处理光谱像素，最后用原遮罩裁成单环；成功装载滤镜后，环在装饰层内部位于原 lens 前，整个装饰仍在原生文字后。环的中心完全镂空，不填满按钮。原透明镜片的 `blur(0.5px) saturate(1.35)` 背景滤镜、镜面高光和主题 tint 保持不变。演出动作、创作测试与模式按钮共用悬停／键盘聚焦的 12% raised 表面、200ms 背景过渡及原内侧高光和阴影，模式 armed／settling 使用 28% raised 表面。

2026-10-27 按已确认原型增加向外柔光：`.desktop-action-glow` 在原镜片与清晰彩环后，
仅复用一份未折射的彩环装饰，外扩 2px、`blur(4.5px)`。主题 token
`--pnds-desktop-glow-opacity` 为 Pond／Sand .46、Stage .34；颜色与变速相位沿用
原彩环，亮暗和暂停仍由 `--glass-power`／`--glass-play` 决定。柔光不增加滤镜引擎
实例、不处理文字、不扩大点击区域；非 Brutal 按钮允许装饰外溢，镜片和细环继续
各自裁切，Brutal 保持按钮裁切以保留原斜块。既有减少动态／透明度、强对比与
强制颜色规则一并关闭柔光。

本轮浏览器夹具引用真实组件、生产 App CSS 与折射引擎，核对四主题、RTL 和亮／暗／
关闭／禁用／模式确认状态：按钮仍高 30px，文字滤镜为 none，Stage 柔光透明度 .34，
其他玻璃主题为 .46；Brutal 装饰隐藏且斜块过渡保留 .3s。该夹具不执行工程动作，
不替代原生 WebView 实机验收。完整检查以测试并发 4 运行并通过。

`src/lib/liquid-glass-rim.ts` 从已批准原型中的 Liquid Glass v1.0.0 MIT 核心提取固定内容滤镜，保留许可、曲面采样和 WebKit 坐标补偿。`createRimLens` 只管理 `.desktop-action-spectrum` 自身像素，使用本地 canvas 位移贴图和 SVG filter，不读取 Monitor、窗口或工程画面。参考参数 360×160、radius137、refraction60 按实际高度适配：30px 按钮对应 radius25.6875（限至半高15px）、refraction11.25；bezel1、curvature2.5、chroma.12、blur0、specular.25 不变。文字、按钮主体和业务组件不接入内容滤镜，也不作位置补偿。

光谱包装用 `inset:-1px` 对齐整个按钮，`--pnds-desktop-bar` 仅作为色散合成的底色，最终只能在细环内可见。原生主题切到 Brutal 或系统减少动态／透明度、提高对比度、强制颜色时销毁滤镜，恢复后重建；React 卸载清理 ResizeObserver、RAF、补绘计时器和 SVG。零尺寸延后生成，canvas／解码失败保留普通彩环，不阻断原按钮；位移贴图缓存上限48项，没有新增运行时依赖。

2026-11-09 演出动作规则覆盖 11 月 8 日的[动作色环原型](../prototypes/semantic-action-rings-review.md)。作用域仍仅匹配 `SessionActionButton` 的 `.desktop-performance-action`，覆盖加载、关闭、重新加载与设置节点；`CreationTestControls` 和模式按钮沿用各自规则。「重新加载／Reload」使用 `sidebar.reloadProject`，内部动作标识为 `reload`，仍表示重新启动工程并应用待生效配置，不是仅刷新 Monitor。加载／重新加载可用时默认显示低亮的原版七色彩虹、约 9 秒一圈，悬停提高亮度并恢复原 3 秒一圈；不叠加额外静态线。

加载／重新加载的 CSS 动画时长恒为 3 秒，`DesktopActionGlass` 用 Web Animations 的 `updatePlaybackRate(1 / 3)`／`updatePlaybackRate(1)` 按事件调速，保留当前相位，不使用逐帧 JavaScript；不得通过改时长或重建动画实现加减速。关闭默认与右侧普通模式按钮共用中性灰镜片边，仅悬停显示 `#b80f1c`／`#ed1c2e`／`#ff4b59` 红环；设置节点保留 `#ca6711`／`#f49b25`／`#ffca58` 金橙环，额外静态线只用于节点。动态色环出现或亮起使用与右侧模式按钮相同的 `650ms ease`，真正隐藏至 0 保留 `180ms ease`；关闭／节点退出时暂停原相位，加载／重新加载退出时继续低速运行，亮度回落至常驻值仍为 650ms。镜片沿用共享 hover／focus 表面，不再固定左侧底色。

同日追加「统一出现动画」：首次挂载或由隐藏变为显示时，动态环和节点静态线使用仅含 `from { filter: opacity(0) }` 的 `650ms ease` 入场包络，回到原来的 filter none、不设置 fill。包络只作用于装饰 rim，不处理文字；实际 opacity 继续由 hover／disabled 状态控制，二者相乘得到视觉有效透明度，避免在首次 650ms 内切换状态时改变入场终点。不能只依赖 transition，因为初挂载没有上一帧透明度。可用 Load／Reload 的常驻态及可用按钮的 hover 动态环使用 650ms 过渡；Close／Node 离开或禁用导致完全隐藏时仍用 180ms。节点静态线首次出现为 650ms，其 hover 淡出／恢复继续为 180ms。该修订只改 CSS 出现方式，旋转关键帧、WAAPI 调速、相位、镜片和业务不变；减少动态时显式取消这层入场动画。

演出动作的可用态保持原玻璃材质；忙碌与禁用状态将整钮透明度降为 0.4，明确表示不可点击。未选工程及预检未完成时加载禁用且没有彩环。忙碌时暂停并淡出彩环，只缓存最近稳定的装饰外观，避免重新加载经过 stopping 时闪成红色关闭；文字按真实 Starting／Stopping 更新，外部关闭不承诺重新启动。切换运行工程在同一按钮内显示「再次点击切换」，不用弹窗；只有再次确认且目标与运行仍匹配才启动。真实启动／停止、提交锁及状态真源不变。Brutal 使用中性不透明方角表面和统一 1px 静态硬描边，不显示玻璃、动态光谱或柔光。

创作测试保持原来的引导：首次启动与错误重试显示彩虹环，已就绪时仅在保存版页面／源码或测试配置有待应用修改时亮起，无修改时保持中性玻璃；禁用不显示彩虹引导。创作动作的 Brutal 不透明配色继续沿用原规则，不套用演出动作色环。

底栏和完整设置里的输出设备、采样率和本地网络改动共用会话的待应用状态。当前创作工作区的测试亮起「重启测试」，池主选中正在演奏的工程时亮起「重新加载」。同一运行的状态更新保留待应用选择，改动在手动重启时应用。

非 Brutal 模式按钮在悬停／键盘聚焦时显示与加载相同的彩虹环，首击后持续到确认或取消；原斜切填充和文案横移仅保留在 Brutal。确认文案按当前语言拆成装饰字形，按钮仍有完整可访问名称。非 Brutal 字形采用 2.6 秒、逐字 -.16 秒错相的轻微波浪，最大上移 0.8px、`scaleY(1.025)`；低饱和七色以 4.8 秒、逐字 -.8 秒错相循环。Brutal 确认文字静止并继承主题字色，原斜线矩形、标签滑动与 300ms 切换动画保留。

模式仍通过首次准备／再次确认提交，保持 preparing／armed／settling 状态门控、同一按钮 DOM、异步归属与运行继承。完成后暂停 hover 直到指针离开；Esc、外部点击与窗口失焦取消准备或确认；Enter／Space 属于模式按钮，不能触发全局加载。普通确认不新增 tooltip，只在确有未保存内容损失时显示原提醒及 `aria-describedby`，成功／失败后的键盘焦点保护不变。加载条件、运行／停止、参数生效、主题桥和作品 iframe 挂载关系不变。

键盘焦点使用实色 `--pnds-desktop-control-line`；普通半透明光学轮廓不承担焦点对比度。演出动作在减少动态时隐藏动态环与柔光，保留普通镜片边，节点额外静态线立即显示且不作过渡；减少透明度／提高对比度时使用不透明中性表面与静态边界，强制颜色使用系统按钮及焦点色。创作测试与模式按钮仍在减少动态时隐藏彩虹环、停止字形动画并继承主题字色，避免停帧留下红角，模式提交立即完成；减少透明度／提高对比度时移除装饰玻璃，恢复原不透明动作表面与主题文字。强制颜色使用 ButtonFace／ButtonText／Highlight，Brutal 仍尊重系统偏好。

「统一出现动画」最终独立 filter alpha 包络的四主题浏览器核对、生产构建与 `npm run check:all` 均通过。有效透明度采样覆盖首次挂载、重挂载、入场途中 hover 及节点静态线，连续变化而不改写入场终点；Load 从禁用恢复、左右 hover 的 650ms 与 Close 离开 180ms 已核对，无控制台错误／警告、IPC 为零。以下 9 秒低速与材质修订的结果发生在此次 CSS 入场调整之前：定向测试通过 3 个文件、279 项，新增调速／清理及偏好变化回归，palette 按共享 idle／hover 镜片检查文字与焦点对比度；真实组件静态构建的浏览器核对覆盖四主题、两轨调速与连续相位、未选／忙碌／焦点及英文标签，无控制台错误／警告、IPC 为零，当轮 `npm run check:all` 全绿且构建通过。夹具不启动 dev 或 App，原生实机视觉仍待用户常规启动核对；当前与历史证据分别见[动作色环评审](../prototypes/semantic-action-rings-review.md#正式接入范围与验证状态)。

首轮主体接入时，`theme-palette.test.mjs` 按 C 镜片中央文字区域采样实际 tint、hover／armed 表面及滤镜／无滤镜路径，并检验七色 sRGB 连续插值、不透明回退、Brutal 斜切和关闭／warning 状态。260 项定向检查通过；确认文字最低对比度为 Pond 5.075:1、Sand 4.753:1、Stage 7.040:1。确认文字使用 `bdi dir="auto"`，保持 RTL 布局下英文顺序。首轮全量检查和构建已通过；其本地文件浏览器验收未完成，不作为新版彩边视觉证据。

新版彩边正式接入后，新增9项组件／引擎测试覆盖原生名称、焦点、点击、Brutal 切换、系统偏好变化、StrictMode、零尺寸、解码失败、多实例、WebKit 比例与异步销毁。完整 `npm run check:all` 通过：前端251个文件、2926项通过，1项既有跳过；主Rust crate742项通过、7项既有忽略，其余检查与工作区测试通过。`npm run build` 通过，`public/licenses/LIQUID-GLASS.txt` 已验证原样进入 `dist/licenses/`，确保分发许可不依赖压缩器保留注释。

本轮在临时随机回环端口检查了真实组件DOM状态快照、生产CSS及实际引擎：四主题、中文／英文、RTL、加载／关闭／禁用、模式确认／提交及创作测试状态。按钮保持30px高，原生文字无内容滤镜，Brutal 的装饰隐藏、SVG数量为0、斜块过渡仍为0.3s；评审减少动态回退后彩环隐藏且SVG数量为0。控制台无错误或警告；截图 `/tmp/pnds-app-rainbow-rim.png`。该页面不执行真实业务动作，交互由组件／工作流测试验证；原生Tauri WebView实机视觉仍需确认。检查结束已关闭临时服务，未启动dev或占用1420，既有HTML原型预览服务未变。

## Performer QR invitation surfaces

Phone invitations live in the shared bottom network popover. Performance and
Client use the held public entry; Creation uses the current ready test's actual
performer URL. The complete copied address and encoded URL must agree, including
the applied HTTP/HTTPS choice. Creation's device header and expanded popover
offer device management without duplicate QR controls.

The expanded monitor title shows its mode, device launcher and restore action,
without a persistent HTTP address. No main-monitor or projection QR overlay
mounts, including when a snapshot retains old overlay state. Opening invitations
or device controls preserves the monitor page and navigation. See
[network invitations](./network-invitations.md) for run ownership and late-result
guards.
