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
  Lavender), and the settings panel's Appearance section applies changes
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
  vendored scrims (`bg-black/50`), and the Appearance section's accent
  swatch — it previews each theme's accent by definition, so it cannot be
  one token.

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
