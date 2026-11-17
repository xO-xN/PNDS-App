# Theme Following

## Adoption

`theme-follow` is optionally adopted at `modules/pnds-theme-follow/`, not enabled by default. It applies the App's current theme to monitor pages. Supply initial page colors so the work remains usable without a theme delivery. Read the README in that project directory for complete interfaces.

## Load it on the monitor page only

Serve a fixed script route from the adopted directory and load it on monitor:

```html
<script src="./__pnds/theme-follow.js"></script>
```

Performer does not adopt it automatically. The first frame can use `?theme=`; later Host messages update the theme. The protocol is defined in the [runtime contract](../reference/runtime-contract.md) §11.

## The zero-config path: CSS variables

The script maps palette values onto the page root; styles use these variables:

| Palette key      | CSS variable    |
| ---------------- | --------------- |
| `bg`             | `--bg`          |
| `sidebar-bg`     | `--track`       |
| `card`           | `--card`        |
| `pill`           | `--accent-soft` |
| `text`           | `--text`        |
| `text-secondary` | `--muted`       |
| `accent`         | `--accent`      |
| `danger`         | `--danger`      |

## The advanced path: PNDS_THEME_OPTIONS

Set `window.PNDS_THEME_OPTIONS` before loading the script. `variables` overrides mappings, `derive(palette)` adds variables, and `onTheme(name, palette)` updates custom drawing. `applyVariables: false` runs the callback without writing CSS; redraw when the page needs it.

Callbacks run only for changed values; malformed input is ignored. `PNDS_THEME.dispose()` removes listeners idempotently; reloading cleans up the previous instance. Use the same-version README for pure helpers and manual `attach` arguments.
