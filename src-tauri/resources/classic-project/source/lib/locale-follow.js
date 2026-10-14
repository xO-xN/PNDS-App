// Locale following — the project side of the App's locale bridge
// (PNDS App ≥ v1.3.0, "Language Following").
//
// The App pushes its resolved interface language into the monitor
// iframe over cross-origin postMessage:
//
//   { type: 'pnds:locale', version: 1, locale: '<code>' }
//
// Codes are resolved language tags ('en' / 'zh-CN' today). Delivery is
// best-effort, latest-value-wins: the App re-pushes on iframe load,
// language switches and window focus regain, so applying a message
// must be idempotent. Unknown or malformed messages are ignored
// silently; the page never errors. A page that never listens behaves
// exactly as before.
//
// This is the reference implementation of that contract, meant to be
// copied between PNDS projects (no shared package: performances run
// offline and the App never installs dependencies). UMD-shaped like
// lib/theme-follow.js: a browser global (window.PNDS_LOCALE) that
// self-wires on load, and a Node module for tests. It lives in lib/
// (reusable core) and is served to the browser by the score server at
// GET /__pnds/locale-follow.js — the App-contract namespace it shares
// with /__pnds/health and /__pnds/theme-follow.js. Load it in the
// monitor page only; performer-facing pages never load it.
//
//   <script src='/__pnds/locale-follow.js'></script>
//
// Zero-config: the default application writes the resolved code into
// the document language (<html lang>) — what screen readers, fonts
// and hyphenation key off. Pages with their own string tables set
// window.PNDS_LOCALE_OPTIONS *before* the script tag:
//
//   {
//     locales: ['en', 'zh-CN'],          // codes the page can render
//     fallback: 'en',                    // when a delivery matches none
//     onLocale: (resolved, raw) => { … },// swap string tables etc.
//     applyLang: false,                  // skip the <html lang> write
//   }

(function (root, factory) {
  const api = factory()

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
    return
  }

  root.PNDS_LOCALE = api

  // Self-wiring (monitor page): resolve the ?lang=<code> first frame
  // when present, then follow every locale message. One listener,
  // values applied idempotently — re-delivery lands on the same state.
  const options = root.PNDS_LOCALE_OPTIONS || {}
  const applyLang = options.applyLang !== false

  const deliver = (code) => {
    const resolved = api.resolveLocale(code, options)
    if (resolved === null) {
      return
    }
    if (applyLang) {
      root.document.documentElement.lang = resolved
    }
    if (typeof options.onLocale === 'function') {
      options.onLocale(resolved, code)
    }
  }

  const initialCode = api.initialLocale(root.location.search)
  if (initialCode) {
    deliver(initialCode)
  }

  root.addEventListener('message', (event) => {
    const received = api.localeFromMessage(event.data)
    if (received) {
      deliver(received.locale)
    }
  })
})(typeof self !== 'undefined' ? self : this, () => {
  // The message protocol. Field naming follows the theme bridge
  // (type/version/theme → type/version/locale): the code IS the payload.
  const MESSAGE_TYPE = 'pnds:locale'
  const MESSAGE_VERSION = 1

  // The languages a page can render by default: the App's two resolved
  // codes. A page with its own set passes options.locales.
  const DEFAULT_LOCALES = ['en', 'zh-CN']
  const DEFAULT_FALLBACK = 'en'

  // The locale carried by a message, or null for anything the page must
  // ignore (unknown type, unknown version, malformed shape).
  function localeFromMessage(data) {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return null
    }
    if (data.type !== MESSAGE_TYPE || data.version !== MESSAGE_VERSION) {
      return null
    }
    if (typeof data.locale !== 'string' || data.locale === '') {
      return null
    }

    return { locale: data.locale }
  }

  // ?lang=<code> first-frame initial value. Language tags are ASCII
  // (letters, digits, hyphens), so the match needs no decoding and can
  // never throw on malformed input; casing is passed through and
  // normalized by resolveLocale.
  function initialLocale(search) {
    const match = /[?&]lang=([a-z0-9-]+)/i.exec(search || '')
    return match ? match[1] : null
  }

  // The code the page should render: one of its own locales, verbatim
  // — string-table lookups cannot miss. Matching is exact first,
  // case-insensitively ('zh-cn' and 'zh-CN' are the same tag), then by
  // base language ('zh' → 'zh-CN'), then the fallback. Null only for
  // absent/empty input, which callers treat as "no delivery": the page
  // keeps its own default language.
  function resolveLocale(code, options) {
    if (typeof code !== 'string' || code === '') {
      return null
    }

    const locales =
      options && Array.isArray(options.locales) ? options.locales : DEFAULT_LOCALES
    const fallback =
      options && typeof options.fallback === 'string' && options.fallback !== ''
        ? options.fallback
        : DEFAULT_FALLBACK
    const wanted = code.toLowerCase()

    let resolved = null
    for (const locale of locales) {
      if (typeof locale === 'string' && locale.toLowerCase() === wanted) {
        resolved = locale
        break
      }
    }

    if (resolved === null) {
      const base = wanted.split('-')[0]
      for (const locale of locales) {
        if (
          typeof locale === 'string' &&
          locale.toLowerCase().split('-')[0] === base
        ) {
          resolved = locale
          break
        }
      }
    }

    return resolved !== null ? resolved : fallback
  }

  return {
    DEFAULT_LOCALES,
    DEFAULT_FALLBACK,
    localeFromMessage,
    initialLocale,
    resolveLocale,
  }
})
