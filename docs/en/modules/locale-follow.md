# Language Following

When the App's interface language switches, the monitor page follows into the matching language; performer pages keep the Project's own language.

## Load it on the monitor page only

```html
<script src="/__pnds/locale-follow.js"></script>
```

Shaped like [Theme Following](./theme-follow.md): the score server exposes `/__pnds/locale-follow.js` on the monitor port only; performer pages never load it.

The mechanism: the App (≥ v1.3.0) pushes its resolved interface language to the monitor iframe over postMessage:

```js
{ type: "pnds:locale", version: 1, locale: "<code>" }
```

The code is the **resolved** language tag (today `en` and `zh-CN`). Delivery is best-effort, latest-value-wins, and applying must be idempotent; unknown or malformed messages are ignored silently; a page that never listens behaves exactly as before.

## The zero-config path: <html lang>

Configure nothing and the script writes the resolved code into `<html lang>` — what screen-reader pronunciation, font fallback and hyphenation key off. Nothing else on the page moves.

## The locale resolution rules

`PNDS_LOCALE.resolveLocale(code, options)`, three steps:

1. **Exact match** (case-insensitive — `zh-cn` and `zh-CN` are the same tag);
2. **base language match**: `zh` → `zh-CN`;
3. **the fallback** (`en` by default).

What returns is always **one of the page's own `locales` entries, verbatim** — a string-table lookup cannot miss. An absent or empty input returns null (treated as "no delivery": the page keeps its own default language).

## The advanced path: the page's string table

Pages with their own copy set `window.PNDS_LOCALE_OPTIONS` **before** the script tag:

```js
const STRINGS = {
  en: { title: 'Now playing', hint: 'Slide to play' },
  'zh-CN': { title: '正在演出', hint: '推动推杆演奏' },
}

window.PNDS_LOCALE_OPTIONS = {
  locales: ['en', 'zh-CN'], // the codes the page can render
  fallback: 'en', // when none matches
  onLocale: (resolved, raw) => renderTexts(STRINGS[resolved]),
  applyLang: false, // optional: skip the <html lang> write
}
```

`onLocale(resolved, raw)`'s second argument is the raw delivered value (handy in debug logs to tell `zh` from `zh-CN`-style inputs). The first frame can come from the `?lang=<code>` URL parameter (the App does not send it today; standalone previews use it).
