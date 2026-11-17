import { afterEach, expect, it, vi } from 'vitest'
import source from '../../src-tauri/src/commands/check-browser.js?raw'
afterEach(() => vi.useRealTimers())
function page(observeMedia = false) {
  vi.useFakeTimers()
  const iframe = document.createElement('iframe')
  document.body.append(iframe)
  const target = iframe.contentWindow
  if (!target) throw new Error('Missing observation window')
  const observedConsole = { error: vi.fn() }
  Object.assign(target, {
    console: observedConsole,
    __PNDS_CHECK_OPTIONS__: {
      marker: 'receipt:',
      policy: "default-src 'self'",
      observeMedia,
    },
    setTimeout,
  })
  new Function('globalThis', source)(target)
  return {
    target,
    console: observedConsole,
    document: target.document,
    finish: () => {
      target.dispatchEvent(new Event('load'))
      vi.advanceTimersByTime(1500)
      return JSON.parse(target.document.title.slice('receipt:'.length)) as {
        errors: string[]
        media: string[]
      }
    },
  }
}
it('observes successful page loading without inventing rendering evidence', () => {
  const p = page()
  expect(
    p.document
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute('content')
  ).toBe("default-src 'self'")
  expect(p.finish()).toEqual({ errors: [], media: [] })
})
it('captures actual script, resource, Promise and console failures in a bounded receipt', () => {
  const p = page()
  p.target.dispatchEvent(
    new ErrorEvent('error', {
      message: 'ReferenceError: setup missing',
      filename: '/monitor.js',
      lineno: 42,
    })
  )
  const script = p.document.createElement('script')
  script.src = '/missing.js'
  p.document.head.append(script)
  script.dispatchEvent(new Event('error'))
  const rejection = new Event('unhandledrejection')
  Object.defineProperty(rejection, 'reason', {
    value: new Error('promise failed'),
  })
  p.target.dispatchEvent(rejection)
  p.console.error('p5 initialization failed')
  for (let index = 0; index < 30; index++) p.console.error('x'.repeat(2000))
  const receipt = p.finish()
  expect(receipt.errors[0]).toContain('setup missing at /monitor.js:42')
  expect(receipt.errors[1]).toContain('Resource failed:')
  expect(receipt.errors[2]).toContain('promise failed')
  expect(receipt.errors[3]).toBe('p5 initialization failed')
  expect(receipt.errors).toHaveLength(12)
  expect(receipt.errors.every(error => error.length <= 800)).toBe(true)
})

it('records only actual same-origin image and audio requests and reports a failed audio element', () => {
  const p = page(true)
  const origin =
    p.document.location?.origin === 'null'
      ? window.location.origin
      : p.document.location?.origin
  Object.defineProperty(p.target, 'origin', { value: origin })
  const local = `${origin}/assets/recording.wav`
  const image = `${origin}/assets/backdrop.png`
  Object.defineProperty(p.target.performance, 'getEntriesByType', {
    value: vi.fn().mockReturnValue([
      { name: local, initiatorType: 'audio' },
      { name: local, initiatorType: 'fetch' },
      { name: image, initiatorType: 'img' },
      { name: 'https://other.example/recording.wav', initiatorType: 'audio' },
      {
        name: `${origin}/entry.js`,
        initiatorType: 'script',
      },
    ]),
  })
  const failed = p.document.createElement('audio')
  failed.src = '/assets/missing.wav'
  p.document.body.append(failed)
  failed.dispatchEvent(new Event('error'))
  const receipt = p.finish()
  expect(receipt.media).toEqual([local, image])
  expect(receipt.errors).toEqual([
    expect.stringContaining('/assets/missing.wav'),
  ])
})
