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
├── App.css              # Main window styles + Tailwind imports
├── quick-pane.css       # Quick pane window styles
└── theme-variables.css  # Shared theme variables (colors, radii)
```

**Multi-window theming**: `theme-variables.css` is imported by both `App.css` and `quick-pane.css` so all windows share the same theme tokens. When adding new color variables, add them to `theme-variables.css`.

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

### Key Concepts

| Directive              | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `@theme inline`        | Maps CSS variables to Tailwind's design token system |
| `@custom-variant dark` | Enables `dark:` prefix based on `.dark` class        |
| `@layer base`          | Base styles that apply globally                      |

### Adding Custom Colors

To add a new semantic color:

```css
@theme inline {
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
}

:root {
  --success: oklch(0.7 0.15 145);
  --success-foreground: oklch(1 0 0);
}

.dark {
  --success: oklch(0.6 0.15 145);
  --success-foreground: oklch(1 0 0);
}
```

Then use with Tailwind: `bg-success text-success-foreground`

## Color Themes (v1.2.3, issues #38/#40/#41)

The app's color themes are NOT the `.dark` axis: the shadcn `.dark` class
is never applied (see Dark Mode below — that section describes why), and a
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
  applies the saved theme (unknown values fall back to Lavender), and the
  settings panel's Appearance section applies changes immediately and
  persists `colorTheme` (enum-validated in Rust:
  lavender/sand/stage/midnight/glass).
- **Glass (issue #41)** is macOS 26+ only: the Rust gate
  (`supports_liquid_glass`) drives the Appearance option's disabled state
  and the render-time fallback (persisted `glass` on an older system
  renders Lavender — the preference is not rewritten, so it revives on a
  supported machine). Selecting it also toggles the native dressing via
  `set_liquid_glass`: an `NSGlassEffectView` behind the webview plus a
  transparent window (src-tauri/src/glass.rs); the CSS block paints
  high-opacity white layers over it (`--pnds-glass-filter` frosts
  translucent surfaces — `.pnds-glass-blur` on app chrome, the shadcn
  data-slot hooks for portal surfaces). The monitor iframe area stays
  opaque. No frosted fallback on older systems — the option is simply
  gated off (spec #36). Glass is exempt from the 4.5:1 guarantee: its
  backdrop is the live desktop, so contrast is approximated.
- Components consume tokens via Tailwind arbitrary values — `bg-(--pnds-bg)`,
  `text-(--pnds-text)/60`, `shadow-(--pnds-card-shadow)` — never literal
  colors. Status fills carry their own label token
  (`text-(--pnds-accent-foreground)`, `text-(--pnds-warning-foreground)`),
  because the label that passes 4.5:1 differs per theme (white on
  Lavender's accent, dark on Sand's amber, dark on the lightened status
  colors of the dark themes — those lighten one step in the dark and take
  dark labels, per spec #36). The accent used **as small text** goes
  through `--pnds-accent-text`, the darker twin tuned for ≥4.5:1 on card
  surfaces (Sand's fill amber reads ~3.1:1 as text).
- Every text/background pair in each solid theme is checked ≥4.5:1 against
  its own label/surface (spec #36 story 9); recheck when touching theme
  values.
- Intentionally NOT themed: the traffic-light glyphs, the PndsLogo's
  brand-color dots (the halo rings behind them ARE tokens), the shadcn
  vendored scrims (`bg-black/50`), and the Appearance section's accent
  swatch — it previews each theme's accent by definition, so it cannot be
  one token.

## Dark Mode

### How It Works

1. **ThemeProvider** (`src/components/ThemeProvider.tsx`) manages theme state
2. Adds `.dark` class to `<html>` element when dark mode is active
3. CSS variables in `.dark` override `:root` values
4. Tailwind's `dark:` variant applies styles conditionally

### Theme Options

- `light` - Force light mode
- `dark` - Force dark mode
- `system` - Follow OS preference (default)

### Using in Components

```tsx
// Access theme in components
import { useTheme } from '@/hooks/use-theme'

function MyComponent() {
  const { theme, setTheme } = useTheme()

  return <button onClick={() => setTheme('dark')}>Current: {theme}</button>
}
```

### Why `.dark` Class (Not `light-dark()`)

This app uses the `.dark` class approach rather than CSS `light-dark()` because:

- Standard pattern for shadcn/ui ecosystem
- JavaScript control over theme switching
- Supports "system" preference detection
- Compatible with all shadcn components

## OKLCH Colors

All colors use the OKLCH color space for perceptual uniformity.

### Format

```css
oklch(lightness chroma hue)
oklch(0.7 0.15 250)  /* L: 0-1, C: 0-0.4, H: 0-360 */
```

### Why OKLCH

- **Perceptually uniform** - Equal steps in values = equal perceived change
- **Wide gamut** - Access to P3 display colors
- **Intuitive** - Lightness is predictable (unlike HSL)

### Color Palette Structure

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

**Why:** Native apps use arrow cursor, not text cursor on labels. v1.2.2
(issue #32) retired the old `.cursor-pointer` utility: every control —
segments, cards, icon buttons, `<summary>` disclosure — keeps the arrow;
affordance comes from hover/press styling, never the hand cursor.

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
variants (v1.2.2, issue #32).

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
├── layout/           # App structure
│   ├── MainWindow.tsx
│   ├── LeftSideBar.tsx
│   ├── RightSideBar.tsx
│   └── MainWindowContent.tsx
├── titlebar/         # Window chrome
│   ├── TitleBar.tsx
│   ├── MacOSWindowControls.tsx
│   └── WindowsWindowControls.tsx
├── ui/               # shadcn primitives
│   ├── button.tsx
│   ├── dialog.tsx
│   └── ...
├── command-palette/  # Command palette feature
├── preferences/      # Preferences dialog
├── ThemeProvider.tsx
└── ErrorBoundary.tsx
```

### Conventions

- **layout/** - Structural components that define app regions
- **titlebar/** - Platform-specific window controls
- **ui/** - shadcn/ui primitives (don't modify directly)
- **Feature folders** - Group related components together

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
interface SideBarProps {
  children?: React.ReactNode
  className?: string
}

export function LeftSideBar({ children, className }: SideBarProps) {
  return (
    <div className={cn('flex flex-col h-full overflow-hidden', className)}>
      {children}
    </div>
  )
}
```

### Visibility with CSS

For panels that toggle visibility, prefer CSS over conditional rendering:

```tsx
// Good: Preserves component state
;<ResizablePanel className={cn(!visible && 'hidden')}>
  <SideBar />
</ResizablePanel>

// Avoid: Loses component state on hide/show
{
  visible && <SideBar />
}
```

This preserves scroll position, form state, and resize dimensions.

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
- Add `cursor-pointer` — the hand cursor is retired app-wide (v1.2.2 #32);
  affordance comes from hover/press styling
- Hand-roll `focus-visible:outline-*` variants — use the shared
  `pnds-focus-ring` class
- Use viewport-based responsive design (this is a fixed-size desktop app)
