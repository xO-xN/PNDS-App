# Theme Following

The App ships four themes (lavender / sand / stage / brutal). Theme following recolours the monitor page to match the App's current theme, while performer pages keep the Project's own colours.

## Load it on the monitor page only

```html
<script src="/__pnds/theme-follow.js"></script>
```

The score server exposes this endpoint on the monitor port only — `/__pnds/` is the App-contract namespace it shares with `/__pnds/health`; performer pages never load it.

The mechanism: the App (≥ v1.2.3) pushes its current theme to the monitor iframe over cross-origin postMessage:

```js
{ type: "pnds:theme", version: 1, theme: "<name>", palette: { … } }
```

The App re-pushes on iframe load, theme switches and window focus regain — **latest value wins, and applying must be idempotent** (applying the same palette any number of times lands on the same state). Unknown or malformed messages are ignored silently; the page never errors on them.

## The zero-config path: CSS variables

Configure nothing and the script writes the palette into the page root's CSS variables. The default mapping (palette key → page variable):

| Palette key      | Page variable   |
| ---------------- | --------------- |
| `bg`             | `--bg`          |
| `sidebar-bg`     | `--track`       |
| `card`           | `--card`        |
| `pill`           | `--accent-soft` |
| `text`           | `--text`        |
| `text-secondary` | `--muted`       |
| `accent`         | `--accent`      |
| `danger`         | `--danger`      |

Write the page's styles against these variables and the whole page follows a theme switch. The page should carry its own default variable values — before any message arrives (and when opened standalone, without the App) it still has to look right.

First frame: with `?theme=<name>` in the URL, the script paints the first frame from its built-in four palettes (the App does not send the parameter today; it is the hook for standalone previews). When the App's message arrives it overwrites the values verbatim.

## The advanced path: PNDS_THEME_OPTIONS

Set `window.PNDS_THEME_OPTIONS` **before** the script tag:

```js
window.PNDS_THEME_OPTIONS = {
  variables: { bg: "--surface" },      // merged over the default mapping
  derive: (palette) => ({ … }),        // extra CSS variables per palette
  onTheme: (name, palette) => { … },   // whole-design forks (p5 etc.)
  applyVariables: false,               // skip the CSS writes, onTheme only
};
```

- `variables`: rename or extend the mapping (merged over the defaults).
- `derive(palette)`: returns additional CSS variables. One ready-made example is `PNDS_THEME.statusVariables(palette)` — producing `--green` / `--yellow` / `--gray` (plus `--red` when the palette carries danger), in a light-card and a dark-card set, each guaranteed ≥ 4.5:1 contrast on its own theme's cards. The App's warning / danger tokens are fill colours paired with their own label colours; borrowing them directly as **text** fails contrast — paint status text with the derived set instead.
- `onTheme(name, palette)`: the whole-design fork. The typical p5 use — stash the palette in the canvas state and read it from `draw`:

```js
window.PNDS_THEME_OPTIONS = {
  onTheme: (name, palette) => {
    myPalette = palette // draw() reads myPalette.accent, myPalette.text, …
  },
}
```

- `applyVariables: false`: for canvas pages that want no CSS-variable writes — `onTheme` only.

The pure functions are also usable directly: `PNDS_THEME.variablesFromPalette(palette, options)`, `variablesFromMessage(data, options)`, `initialTheme(search)` and friends — for tests and custom wiring.
