# UI Patterns

## Overview

This app uses a modern CSS stack optimized for Tauri desktop applications:

- **Tailwind CSS v4** with CSS-based configuration
- **shadcn/ui v4** component library
- **CSS custom-property color tokens** — the stock shadcn `:root`/`.dark`
  values are OKLCH; the PNDS/theme tokens are hex (they come from the
  Figma palette and the reviewed spec tables, and every value is
  contrast-audited, so the space matters less than the single source)
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

The `:root` and `.dark` blocks above are the stock shadcn values kept in `theme-variables.css`; the app never applies the `.dark` class (see [The Light/Dark Axis](#the-lightdark-axis) and [Color Token Formats](#color-token-formats)).

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

The app's color themes are NOT the `.dark` axis: the shadcn `.dark` class
is never applied (see [The Light/Dark Axis](#the-lightdark-axis)), and a
color theme is one complete palette — light or dark — swapped via the root
node's `data-color-theme` attribute:

- Each theme is **one complete token set** in `theme-variables.css` — a
  `[data-color-theme='…']` block overriding both the `--pnds-*` design
  tokens and the shadcn semantic mapping (`--background`, `--primary`, …).
  Blocks after `:root` win at equal specificity by order, so a block never
  needs `!important` and themes cannot leak values into each other.
- The `:root` token sets **double as Lavender**, the default theme — it is
  defined as "the current look" and doubles as the pre-JavaScript fallback
  (until startup applies the saved attribute, the app renders Lavender).
- `src/lib/color-theme.ts` owns the attribute: the startup preferences read
  applies the saved theme (unknown or not-yet-shipped values fall back to
  Lavender), and the settings panel's General-section theme row (v1.4.0
  fold; the Appearance section is gone) applies changes
  immediately and persists `colorTheme` (enum-validated in Rust:
  lavender/sand/stage/brutal, plus the legacy `midnight`/`glass` values
  which the frontend maps at render).
- **Brutal is the Neo-brutalism theme** (renamed from `midnight`; the
  persisted legacy value maps to `brutal` in color-theme.ts and stays
  valid in the Rust enum): a cream base
  (`#fff1c9`), pure black text, white cards with black hard-offset
  shadows (`4px 4px 0 #000`, no blur), an orange accent (`#ff5722`, black
  labels), full black borders, and a solid amber sidebar panel
  (`#ffc107` — same warm family as the cream bg, distinct from every
  white surface; 1px black outline, no panel-level shadow; via a scoped
  `[data-sidebar-surface]` rule — Sidebar's aside carries the
  attribute; a pixel-font PNDS wordmark, a hard panel shadow, and a
  white panel were tried here and removed on feedback).
  Two structural rules scope to it in theme-variables.css: every corner
  flattens to 0 and every transition snaps to 0s — hover tints, the
  selection pill, and reveals are instant in this theme (a deliberate
  trade against the sliding-pill motion). One motion survives: the
  sidebar's enter/exit slide (`data-sidebar-motion`, restored at 200ms);
  everything else snaps. The
  selected project card RISES off the black plane — a one-shot keyframe
  lifts pill and row 2px in sync while the hard shadow grows beneath
  (`data-selection-pill` + `data-selected-card`; the keyframe restarts
  from applyCardSelectionPill on every selection change). The
  window itself squares too: `set_window_corners_square` (window.rs)
  drops the native 16px mask while the theme is active — synced before
  the root attribute lands so neither edge lags the other — and the
  traffic-light dots (`data-os-circle`, set in TrafficLights.tsx) stay
  circular. Other themes keep the rounded window and the
  `data-app-frame` rounding untouched. Type is per-theme: `--pnds-font-ui`
  / `--pnds-font-text` tokens (defined per theme block, read by `body`
  and `.font-manrope`) — Brutal swaps both to Archivo (bundled woff2 in
  public/fonts, OFL), everything else keeps Comfortaa/Manrope. The
  PndsLogo canvas wordmark stays brand (not themed), like the logo
  dots. Brutal also carries the sidebar's one illustration (#71): the
  shelf octopus riding the settings footer — rendered only when
  `colorThemeSetting === 'brutal'` (same component-level gate as the
  traffic-light ✕ in TrafficLights.tsx), `absolute` inside the footer
  wrapper (which is `relative`) so it follows the settings card's
  height changes in pure CSS while staying outside the project
  scroller, `pointer-events-none` and `z-0` — over the card, under the
  project column (the masked scroller is itself a stacking context, so
  it carries `z-10` to keep its cards above the octopus). The bundled
  `src/assets/octo-sidebar-2x.png` (2× the footer content width;
  design master in `assets/mascot/octo-sidebar.png`) is pinned onto
  the card's top edge by `OCTO_SHELF_OVERHANG_PX` in Sidebar.tsx,
  calibrated per asset. Card legibility works by reservation, not
  background (#71 v2): the scroll column surrenders the art's zone
  (`OCTO_COLUMN_RESERVE_PX`) so cards page above the tentacles with
  their transparent rest intact in every theme; the import button
  keeps its column-tail seat clear of the art — solid card-colored
  with the theme border and hard shadow under Brutal, the translucent
  chip elsewhere.
- **Sand is the medium-depth theme**: warm-white text on dim warm-taupe
  surfaces — deliberately between the light and dark themes. Its
  accent-text twin inverts direction: the accent-as-text is the LIGHTER
  amber (`#fbbf24`), because a darker amber can't reach 4.5:1 on the
  mid-dark card. Danger follows the same physics — light enough to pass
  as text on the card, labeled near-black (the theme set spans light /
  medium / dark / brutalist, so the "lighten vs darken the status color"
  rule is per-theme, not per-lightness-class).
- Components consume tokens via Tailwind arbitrary values — `bg-(--pnds-bg)`,
  `text-(--pnds-text)/60`, `shadow-(--pnds-card-shadow)` — never literal
  colors. Status fills carry their own label token
  (`text-(--pnds-accent-foreground)`, `text-(--pnds-warning-foreground)`),
  because the label that passes 4.5:1 differs per theme (white on
  Lavender's accent, dark on Sand's amber, dark on the lightened status
  colors of the dark themes — those lighten one step in the dark and take
  dark labels). The accent used **as small text** goes
  through `--pnds-accent-text`, the darker twin tuned for ≥4.5:1 on card
  surfaces (Sand's fill amber reads ~3.1:1 as text).
- Every text/background pair in each solid theme is checked ≥4.5:1 against
  its own label/surface; recheck when touching theme values.
- Intentionally NOT themed: the traffic-light glyphs, the PndsLogo's
  brand-color dots (the halo rings behind them ARE tokens), the shadcn
  vendored scrims (`bg-black/50`), the theme row's accent
  swatch — it previews each theme's accent by definition, so it cannot be
  one token — and the monitor title strip's ▶ projection-gate light
  (v1.5.0 #130): a STATUS light on the dark monitor-bar scrim, like the
  traffic lights — ungated blinks Apple system orange `#ff9f0a` (its
  reduce-motion clamp rests there as the static highlight), 开演'd holds
  Apple system green `#34c759` (the logo palette's green). Green/orange
  mean the same thing in every theme; a per-theme accent would not.

## The Light/Dark Axis

The app is **fixed light**. `ThemeProvider` (`src/components/ThemeProvider.tsx`)
pins the `light` class on `<html>` and never applies `.dark`, regardless of
OS appearance: the app's own `--pnds-*` palette has no dark variant, and the
stock shadcn `.dark` block in `theme-variables.css` would repaint the
remaining shadcn surfaces (popover menus) black while the rest stayed light.

The provider's context (`src/lib/theme-context.ts`) keeps a `setTheme`
no-op so the shadcn ecosystem's `useTheme` shape is satisfied; there is no
theme-switching hook. Dark palettes are color themes — a dark color theme
(stage) remaps the same light-variant tokens via `data-color-theme`, not
via the `.dark` class. See [Color Themes](#color-themes).

## Color Token Formats

Two token families live in `theme-variables.css`:

- **Stock shadcn semantic tokens** (`:root` and the unused `.dark` block)
  use OKLCH — `oklch(0.145 0 0)` — as shipped by the shadcn theme builder.
- **PNDS tokens** (`--pnds-*`, the shadcn mapping overrides inside each
  `[data-color-theme]` block) use hex values from the Figma palette. Every
  value is contrast-audited, so the color space matters less than the
  single source.

### Semantic Palette Structure

| Token                                    | Purpose                   |
| ---------------------------------------- | ------------------------- |
| `--background` / `--foreground`          | Page background and text  |
| `--card` / `--card-foreground`           | Card surfaces             |
| `--primary` / `--primary-foreground`     | Primary actions           |
| `--secondary` / `--secondary-foreground` | Secondary actions         |
| `--muted` / `--muted-foreground`         | Subdued elements          |
| `--accent` / `--accent-foreground`       | Highlights                |
| `--destructive`                          | Destructive actions (red) |
| `--border` / `--input` / `--ring`        | Borders and focus rings   |

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
