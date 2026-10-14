// Locale following (App ≥ v1.3.0): the App pushes
// {type:'pnds:locale', version:1, locale} into the monitor page, which
// resolves the code against its supported languages and applies it.
// These tests assert the external contract only — message in, resolved
// locale and <html lang> out — never the module's internals.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const {
  DEFAULT_LOCALES,
  localeFromMessage,
  initialLocale,
  resolveLocale,
} = require('../lib/locale-follow')

const LIB_DIR = path.join(__dirname, '..', 'lib')

// The App's example delivery, verbatim (resolved language codes today:
// 'en' / 'zh-CN').
const SPEC_MESSAGE = { type: 'pnds:locale', version: 1, locale: 'zh-CN' }

// ---------------------------------------------------------------------------
// Message → locale
// ---------------------------------------------------------------------------

test('locale message: the resolved language code is the payload', () => {
  assert.deepEqual(localeFromMessage(SPEC_MESSAGE), { locale: 'zh-CN' })
  assert.deepEqual(
    localeFromMessage({ type: 'pnds:locale', version: 1, locale: 'en' }),
    { locale: 'en' },
  )
})

test('unknown or malformed messages are ignored, not applied', () => {
  const malformed = [
    null,
    undefined,
    42,
    'pnds:locale',
    [],
    {},
    { type: 'other', version: 1, locale: 'en' },
    { type: 'pnds:locale' },
    { type: 'pnds:locale', version: 2, locale: 'en' },
    { type: 'pnds:locale', version: 1 },
    { type: 'pnds:locale', version: 1, locale: '' },
    { type: 'pnds:locale', version: 1, locale: 7 },
    { type: 'pnds:locale', version: 1, locale: ['en'] },
  ]

  for (const data of malformed) {
    assert.equal(localeFromMessage(data), null, `should ignore ${JSON.stringify(data)}`)
  }
})

// ---------------------------------------------------------------------------
// Resolution (the page's supported languages decide)
// ---------------------------------------------------------------------------

test('resolveLocale: exact, case-insensitive, base-language, then fallback', () => {
  assert.equal(resolveLocale('en'), 'en')
  assert.equal(resolveLocale('zh-CN'), 'zh-CN')
  assert.equal(resolveLocale('ZH-cn'), 'zh-CN', 'tags match case-insensitively')
  assert.equal(resolveLocale('zh'), 'zh-CN', 'base language picks the regional variant')
  assert.equal(resolveLocale('fr'), 'en', 'unsupported codes fall back')

  assert.equal(resolveLocale('pt', { locales: ['en', 'pt-BR'] }), 'pt-BR')
  assert.equal(resolveLocale('pt-BR', { locales: ['en', 'pt-BR'] }), 'pt-BR')
  assert.equal(
    resolveLocale('fr', { locales: ['en', 'pt-BR'], fallback: 'pt-BR' }),
    'pt-BR',
    'fallback is configurable',
  )

  // The resolved value is always one of the page's own codes, verbatim —
  // string-table lookups cannot miss.
  for (const code of ['en', 'zh-CN', 'ZH-CN', 'zh', 'fr']) {
    assert.ok(DEFAULT_LOCALES.includes(resolveLocale(code)), `${code} resolves into the page set`)
  }

  // Absent input means "no delivery" — the page keeps its own default.
  assert.equal(resolveLocale(null), null)
  assert.equal(resolveLocale(''), null)
  assert.equal(resolveLocale(42), null)
})

// ---------------------------------------------------------------------------
// Idempotency (the App re-pushes on language switches and focus regain;
// latest value wins, repeated delivery has no side effects)
// ---------------------------------------------------------------------------

test('re-delivery and locale round-trips are idempotent', () => {
  const page = loadMonitorPage('')
  const deliver = (data) => page.listeners.message[0]({ data })

  deliver(SPEC_MESSAGE)
  assert.equal(page.documentElement.lang, 'zh-CN')

  // Re-push of the same locale (focus regain path).
  deliver(SPEC_MESSAGE)
  assert.equal(page.documentElement.lang, 'zh-CN')

  // A switch away and back lands exactly where it was.
  deliver({ type: 'pnds:locale', version: 1, locale: 'en' })
  assert.equal(page.documentElement.lang, 'en')
  deliver(SPEC_MESSAGE)
  assert.equal(page.documentElement.lang, 'zh-CN')
})

// ---------------------------------------------------------------------------
// ?lang=<code> first-frame initial value
// ---------------------------------------------------------------------------

test('?lang= carries a first frame; absence keeps the page default', () => {
  assert.equal(initialLocale('?lang=en'), 'en')
  assert.equal(initialLocale('?lang=zh-CN'), 'zh-CN')
  assert.equal(initialLocale('?lang=ZH-CN'), 'ZH-CN', 'casing tolerated, resolved downstream')
  assert.equal(initialLocale('?a=1&lang=zh-CN'), 'zh-CN')
  assert.equal(initialLocale('?theme=stage&lang=en'), 'en', 'theme and lang coexist')

  assert.equal(initialLocale(''), null)
  assert.equal(initialLocale('?'), null)
  assert.equal(initialLocale('?foo=1'), null)
  assert.equal(initialLocale('?theme=stage'), null)
  assert.equal(initialLocale('?lang='), null)
  assert.equal(initialLocale('?lang'), null)
})

// ---------------------------------------------------------------------------
// Browser wiring (the real file, run against a minimal page)
// ---------------------------------------------------------------------------

// Loads lib/locale-follow.js the way the monitor page does (browser
// global, no module system) and returns what the page observed: its
// <html lang> attribute and its message listeners.
function loadMonitorPage(search, options) {
  const documentElement = { style: {}, lang: '' }
  const listeners = {}
  const page = {
    document: { documentElement },
    location: { search },
    addEventListener: (type, handler) => {
      (listeners[type] = listeners[type] || []).push(handler)
    },
  }
  page.self = page
  if (options !== undefined) {
    page.PNDS_LOCALE_OPTIONS = options
  }

  vm.runInContext(
    fs.readFileSync(path.join(LIB_DIR, 'locale-follow.js'), 'utf8'),
    vm.createContext(page),
  )

  return { documentElement, listeners }
}

test('monitor page wiring: message → the <html lang> attribute', () => {
  const page = loadMonitorPage('')

  assert.equal(page.listeners.message.length, 1, 'exactly one message listener')

  page.listeners.message[0]({ data: SPEC_MESSAGE })
  assert.equal(page.documentElement.lang, 'zh-CN')

  // The listener painted before the first paint when ?lang= was present.
  const prePainted = loadMonitorPage('?lang=en')
  assert.equal(prePainted.documentElement.lang, 'en')
})

test('monitor page wiring: malformed events never throw or write', () => {
  const page = loadMonitorPage('?lang=en')
  const before = page.documentElement.lang

  for (const data of [null, {}, { type: 'other' }, 'pnds:locale']) {
    assert.doesNotThrow(() => page.listeners.message[0]({ data }))
  }

  assert.equal(page.documentElement.lang, before)
})

test('monitor page wiring: options route locales to non-DOM consumers', () => {
  const delivered = []
  const page = loadMonitorPage('', {
    applyLang: false,
    onLocale: (resolved, raw) => delivered.push({ resolved, raw }),
  })

  page.listeners.message[0]({ data: SPEC_MESSAGE })
  page.listeners.message[0]({
    data: { type: 'pnds:locale', version: 1, locale: 'ZH-cn' },
  })

  assert.deepEqual(delivered[0], { resolved: 'zh-CN', raw: 'zh-CN' })
  assert.deepEqual(
    delivered[1],
    { resolved: 'zh-CN', raw: 'ZH-cn' },
    'casing tolerated, the page spelling wins',
  )
  // …while the <html lang> write stays skipped.
  assert.equal(page.documentElement.lang, '')
})

// ---------------------------------------------------------------------------
// Template wiring: the p5 page consumes locales via the onLocale callback
// ---------------------------------------------------------------------------

test('template wiring: the ?lang= first frame reaches a late subscriber', () => {
  // index.html loads locale-follow.js BEFORE monitor.js, so the initial
  // delivery can fire before the page script exists. The options hook
  // stashes the delivery; monitor.js replays it at startup — this test
  // runs that exact hand-off against the real module.
  const stash = []
  const page = loadMonitorPage('?lang=zh-CN', {
    onLocale: (resolved, raw) => stash.push({ resolved, raw }),
  })

  assert.equal(stash.length, 1, 'the initial ?lang= delivery fired early')
  assert.equal(stash[0].resolved, 'zh-CN')
  assert.equal(page.documentElement.lang, 'zh-CN', 'the default document-lang write fired')
})

test('template wiring: locale-follow loads only in the monitor branch', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8')

  // The options and the module load inside the monitor branch, before
  // the monitor script itself (anchored on the document.write calls —
  // comments may mention any of the names).
  const monitorBranch = html.slice(html.indexOf('PNDS_IS_MONITOR'))
  assert.match(
    monitorBranch,
    /PNDS_LOCALE_OPTIONS[\s\S]*document\.write\(\s*'\\x3Cscript src="\/__pnds\/locale-follow\.js[\s\S]*document\.write\(\s*'\\x3Cscript src="monitor\.js/,
    'options → module → monitor.js, in that order',
  )

  // …and the performer script has no hand in languages.
  const performer = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'performer.js'),
    'utf8',
  )
  assert.doesNotMatch(performer, /pnds:locale|PNDS_LOCALE/)
})

// ---------------------------------------------------------------------------
// The real monitor page (p5 stubbed): locale delivery → UI strings
// ---------------------------------------------------------------------------

test('monitor.js: a delivered locale swaps the UI strings, unsupported codes keep the previous language', () => {
  // monitor.js needs a p5 surface; only the pieces setup() touches are
  // stubbed, and the control stubs record label changes — the external
  // behavior under test.
  const fakeControl = () => {
    const styles = new Map()
    return {
      styles,
      style: (name, value) => styles.set(name, value),
      mousePressed: () => {},
      changed: () => {},
      option: () => {},
      selected: () => {},
      remove: () => {},
      position: () => {},
      size: () => {},
      parent: () => {},
      hide: () => {},
      show: () => {},
    }
  }

  const button = fakeControl()
  button.html = (value) => {
    button.label = value
  }
  const img = fakeControl()
  img.elt = { alt: '' }

  const texts = []
  let confirmMessage = null

  const page = {
    location: { hostname: '127.0.0.1', search: '' },
    windowWidth: 800,
    windowHeight: 600,
    width: 800,
    height: 600,
    document: { documentElement: { style: {} } },
    PNDS: { performerPort: 6868, monitorPort: 6869, outputChannels: 16, performerUrl: "http://192.168.1.9:6868/" },
    PNDSClient: {
      connectMonitor: () => ({
        onClients: () => {},
        onViewState: () => {},
        resetIds: () => {},
        setSeat: () => {},
        setOut: () => {},
      }),
    },
    io: () => {},
    createCanvas: () => ({ parent: () => {} }),
    createImg: (url, alt) => {
      img.elt.alt = alt
      return img
    },
    createButton: (label) => {
      button.label = label
      return button
    },
    createSelect: () => fakeControl(),
    createDiv: () => fakeControl(),
    CENTER: 'center',
    textAlign: () => {},
    textSize: () => {},
    fill: () => {},
    text: (value) => texts.push(value),
    confirm: (message) => {
      confirmMessage = message
      return false
    },
  }
  page.self = page
  page.window = page

  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'monitor.js'), 'utf8'),
    vm.createContext(page),
  )

  assert.equal(typeof page.applyPndsLocale, 'function')

  page.setup()
  assert.equal(button.label, '重配 ID', 'the page default is its own Chinese')
  assert.equal(img.elt.alt, '演奏者页面二维码')

  page.drawEmpty()
  assert.ok(texts.includes('等待演奏者加入…'))

  page.requestResetIds()
  assert.equal(
    confirmMessage,
    '重配所有设备的演奏序号？每台设备将重新拿到新的序号，声道分配也会重置。',
  )

  page.applyPndsLocale('en')
  assert.equal(button.label, 'Reset IDs')
  assert.equal(img.elt.alt, 'QR code for the performer page')
  page.drawEmpty()
  assert.ok(texts.includes('Waiting for performers…'))

  // Re-delivery lands on the same values (idempotent).
  page.applyPndsLocale('en')
  assert.equal(button.label, 'Reset IDs')

  // A switch back, then a code STRINGS cannot render keeping the last
  // language (defense in depth: the module resolves before onLocale).
  page.applyPndsLocale('zh-CN')
  assert.equal(button.label, '重配 ID')
  page.applyPndsLocale('fr')
  assert.equal(button.label, '重配 ID')
})
