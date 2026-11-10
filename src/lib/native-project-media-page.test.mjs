import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const fixture = 'src-tauri/tests/fixtures/native-project-media/'
const source = readFileSync(`${fixture}page.mjs`, 'utf8')
const html = readFileSync(`${fixture}index.html`, 'utf8')
const copy = JSON.parse(readFileSync(`${fixture}locales.json`, 'utf8'))
let page
afterEach(() => {
  page?.window.dispatchEvent(new page.window.PageTransitionEvent('pagehide'))
  page?.window.close()
})

async function openPage(configure) {
  page = new JSDOM(html, {
    url: 'http://project.localhost/?lang=en',
    runScripts: 'outside-only',
  })
  const { window } = page
  window.fetch = vi.fn(async path => ({
    json: async () => (path === '/copy.json' ? copy : []),
  }))
  const timers = []
  window.setInterval = vi.fn(callback => {
    timers.push(callback)
    return timers.length
  })
  window.clearInterval = vi.fn(id => {
    timers[id - 1] = null
  })
  const getUserMedia = vi.fn()
  Object.defineProperty(window.navigator, 'mediaDevices', {
    value: { getUserMedia, enumerateDevices: vi.fn(async () => []) },
  })
  configure?.(window, getUserMedia)
  await window.eval(`(async () => { ${source}\n })()`)
  return { window, getUserMedia, timers }
}

it('does not acquire an input when the real page cannot persist its independent identity', async () => {
  const { window, getUserMedia } = await openPage(window => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error('Storage denied')
        },
      },
    })
  })
  expect(window.document.getElementById('status').textContent).toContain(
    'inputs remain off'
  )
  window.document.getElementById('start-camera').click()
  expect(getUserMedia).not.toHaveBeenCalled()
})

it('keeps the existing camera analysis working while a replacement request fails', async () => {
  let rejectReplacement
  const replacement = new Promise((_resolve, reject) => {
    rejectReplacement = reject
  })
  const stop = vi.fn()
  const workers = []
  const { window, timers } = await openPage((window, getUserMedia) => {
    getUserMedia
      .mockResolvedValueOnce({ getTracks: () => [{ stop }] })
      .mockReturnValueOnce(replacement)
    window.HTMLMediaElement.prototype.play = vi.fn(async () => undefined)
    window.HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}))
    window.Worker = class {
      constructor() {
        workers.push(this)
      }
      postMessage = vi.fn()
      terminate = vi.fn()
    }
  })
  window.document.getElementById('start-camera').click()
  await vi.waitFor(() => expect(workers).toHaveLength(1))
  window.document.getElementById('start-camera').click()
  workers[0].onmessage({ data: 0.5 })
  await timers[0]()
  const lastPublished = () =>
    JSON.parse(
      window.fetch.mock.calls
        .filter(
          ([path, options]) => path === '/results' && options?.method === 'POST'
        )
        .at(-1)[1].body
    )
  expect(lastPublished().cameraBrightness).toBe(0.5)
  rejectReplacement(
    Object.assign(new Error('busy'), { name: 'NotReadableError' })
  )
  await vi.waitFor(() =>
    expect(window.document.getElementById('status').textContent).toContain(
      'NotReadableError'
    )
  )
  workers[0].onmessage({ data: 0.75 })
  await timers[0]()
  expect(lastPublished().cameraBrightness).toBe(0.75)
  expect(stop).not.toHaveBeenCalled()
  expect(workers[0].terminate).not.toHaveBeenCalled()
})

it('keeps projection a result consumer without requesting an input', async () => {
  const { window, getUserMedia, timers } = await openPage(window => {
    Object.defineProperty(window, 'PNDS_MEDIA_SURFACE', {
      value: Object.freeze({ role: 'projection', captureAllowed: false }),
    })
  })
  expect(window.document.getElementById('inputs').hidden).toBe(true)
  window.document.getElementById('start-camera').click()
  window.document.getElementById('start-microphone').click()
  await timers[0]()
  expect(getUserMedia).not.toHaveBeenCalled()
  expect(
    window.fetch.mock.calls.some(
      ([_path, options]) => options?.method === 'POST'
    )
  ).toBe(false)
  expect(window.document.getElementById('results').textContent).toBe(
    'No recent project samples.'
  )
})

it('stops a late permission stream after this page was explicitly stopped', async () => {
  let grant
  const permission = new Promise(resolve => {
    grant = resolve
  })
  const stop = vi.fn()
  const { window, timers } = await openPage((_window, getUserMedia) => {
    getUserMedia.mockReturnValue(permission)
  })
  window.document.getElementById('start-camera').click()
  window.document.getElementById('stop').click()
  grant({ getTracks: () => [{ stop }] })
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce())
  await timers[0]()
  const published = window.fetch.mock.calls.find(
    ([path, options]) => path === '/results' && options?.method === 'POST'
  )
  expect(JSON.parse(published[1].body).cameraBrightness).toBeNull()
  expect(window.document.getElementById('status').textContent).toContain(
    'Inputs are off'
  )
})
