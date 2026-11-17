# Language Following

## Adoption

`locale-follow` is optionally adopted at `modules/pnds-locale-follow/`, not enabled by default. It resolves the App's language and notifies monitor pages. The work owns translations and strings; project names, authors and user text are not automatically translated. Read the README in that project directory for complete interfaces.

## Load it on the monitor page only

Serve a fixed script route from the adopted directory and load it on monitor:

```html
<script src="./__pnds/locale-follow.js"></script>
```

The work owns performer text. The first frame can use `?lang=`; later Host messages update the language. The protocol is defined in the [runtime contract](../reference/runtime-contract.md) §11.

## The zero-config path: <html lang>

By default, the resolved code updates `<html lang>` without changing other text. With neither a first-frame value nor a message, the page keeps its initial language.

## The locale resolution rules

`PNDS_LOCALE.resolveLocale(code, options)` tries case-insensitive exact matching, base-language matching, then fallback. It always returns a supported code verbatim; empty input returns null. Defaults support `en`/`zh-CN`, with fallback `en`.

## The advanced path: the page's string table

Set `window.PNDS_LOCALE_OPTIONS` before loading the script. `locales` declares work languages, `fallback` selects the fallback, and `onLocale(resolved, raw)` renders the work's string table. `applyLang: false` disables `<html lang>` writes.

Equivalent resolved languages do not repeat callbacks. `PNDS_LOCALE.dispose()` releases listeners idempotently; reloading cleans up the previous instance, retaining current text and document language. Use the same-version README for manual wiring and resolution boundaries.
