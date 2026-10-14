# UI Patterns

## Overview

This app uses a modern CSS stack optimized for Tauri desktop applications:

- **Tailwind CSS v4** with CSS-based configuration
- **shadcn/ui v4** component library
- **CSS custom-property color tokens** — PNDS palettes use hex values;
  shadcn semantic roles resolve from the same palette. Color and contrast
  live in one source, `src/theme-variables.css`.
- **Desktop-specific defaults** for native app feel

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

Telematic Diagnostics v0.6.1 gives the hub/star topology the main visual role,
with network verdict and fault attribution above it, connection settings beside
it, and site readings below. Hub latency values remain neutral; link quality
keeps its server-defined colors. Local performer cards retain their headers
and removal controls across snapshots and locale changes. Hub history and the
join QR use native disclosures; the phone's Rejoin cover is a native button.
The existing theme bridge's `onTheme` hook handles Brutal geometry. Canonical
source and UI notes are in the sibling `Telematic-Network-Diagnostics` repository
(`public/`, `test/pages.test.js`, and `docs/ui-design.md`).

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

`HoverSidebar` keeps pointer presence separate from pointer gestures, popup, dialog, mode and
command holds. Pointer-up/cancel outside the sidebar or window blur releases
the gesture hold, so a gain/card drag never disappears under the pointer. Always clear the pointer latch on leave, including while a
portal is open; ending the last hold then hides a panel the pointer already
left. `Sidebar` combines its folder/project and session replacement dialogs
before reporting visibility. App settings and window confirmation stores hold
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
controls stay mounted on home, workspace and expanded-preview layouts; missing
workspace or expansion disables them rather than changing the bar contents.
The audio entry uses Speaker. The bottom bar is a native deep drag region;
its blank surface and spacer move the window in either mode. Transport/gain/mode
groups and every local button/input explicitly opt out, so drag does not steal
interactive presses. Live gain reads applied runtime audio even when
another project is selected or its pending mode differs. Applied device/rate and
LAN remain separate from next-start preferences. OSC, Room and HTTPS feedback
remain conditional. Sidebar visibility never enters the monitor URL, iframe key
or viewport derivation. Use deferred-command workflow and real portal tests.

The creation titlebar is 32px high, following the Zed layout: native controls
on the left, the existing project menu immediately beside them, and a dedicated saved-file `.pnds` packaging entry on the right. Read-only
projects and the empty workspace do not offer packaging. `CreationView` keeps the titlebar outside the
hidden editing surface; `ReadingWorkspace` portals its existing menu into the
stable titlebar slot, retaining menu actions, draft owners and dialogs. The menu
is disabled while the Monitor is expanded or a mode/session operation is
pending. The native container padding is 18px in creation and 34px in performance; the
backend retains padding and horizontal offset across resize/layout updates. Actual AppKit geometry showed
a 9px button origin and 14px button height: 18px container padding puts the
buttons at a 9px visible inset, centered in the 32px creation bar. Creation uses a -12px horizontal offset
(x=16px); performance keeps the original x=28px baseline. Fullscreen
leaves the actual native titlebar controls to macOS. The titlebar trigger has
its own styles, with primary text, transparent rest, an 8% neutral hover tint
and a 12% open/pressed tint. Retired sidebar-title hover/fade rules are removed.
The packaging button opens the existing `CreationBundle` dialog, with draft/test
warnings, native destination and overwrite confirmation unchanged. Packaging
has moved out of the project dropdown; project-switch/new/Finder/rescan/handoff
entries remain in that dropdown.

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

Native macOS traffic lights occupy the empty sidebar chrome slot; no DOM
imitation is rendered, including under Brutal. Window restoration excludes
`DECORATIONS` as well as `VISIBLE`, so old borderless state cannot override the
fixed overlay shell. AppKit positioning runs on the UI thread and follows main
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
AppKit's public standard-button factory supplies the native controls in an
input-transparent NSView overlay, positioned by the existing sidebar/titlebar
motion machinery. Once installed, that overlay persists across windowed theme
changes; native titled rounding returns in other themes and the system controls
take over in fullscreen. The green overlay button goes through Tao's fullscreen
setter, which prepares/restores borderless window styles. All AppKit corner work
runs on the UI thread; the theme command awaits its completion before CSS changes.
The WKWebView and score iframe stay mounted. Native corner/controls/fullscreen
acceptance still requires a real App run; pure policy tests and clippy do not
establish that physical behavior.

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

One shared class for every interactive control in the app's own UI (the
shadcn settings primitives keep their design-system ring). `:focus-visible`
only — mouse clicks never show a ring, Tab navigation always does. New
controls take the class instead of hand-rolled `focus-visible:outline-*`
variants.

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

### Async dialog geometry

The first visible dialog frame must already have its intended layout. The
module browser reads its catalog before opening and shows loading on its trigger.
The creation project picker reserves a bounded list area for loading, errors,
empty results and project choices; only that area scrolls as content arrives.
Settings and project introduction use fixed shells with scrolling content.
Do not initially render a short centered loading dialog and expand it when an
async read returns: changing the height moves its top edge abruptly.

Check real browser frames with a delayed command response. jsdom does not
measure layout. The October 2026 audit reproduced a 123px frame jump in the
project picker and fixed it by keeping loading and results in the same region.
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
  `pnds-focus-ring` class
- Use viewport-based responsive design (this is a fixed-size desktop app)

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
real-machine evidence. Main-panel and projection cq frames stay distinct.

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
