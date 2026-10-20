import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = resolve('src-tauri/resources/blank-project')
const script = readFileSync(join(root, 'public/monitor.js'), 'utf8')
let frame
let temporary
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  frame?.remove()
  if (temporary) rmSync(temporary, { recursive: true, force: true })
})

function loadMonitor(code, context) {
  frame = globalThis.document.createElement('iframe')
  globalThis.document.body.append(frame)
  const page = frame.contentWindow
  page.document.body.innerHTML = '<h1>Blank test</h1>'
  page.PNDS_PREVIEW_CONTEXT = context
  const listener = vi.spyOn(page, 'addEventListener')
  const replies = []
  vi.spyOn(page.parent, 'postMessage').mockImplementation((message, origin) => {
    expect(origin).toBe('http://host')
    replies.push(message)
  })
  vi.stubGlobal('window', page)
  vi.stubGlobal('document', page.document)
  temporary = mkdtempSync(join(tmpdir(), 'pnds-blank-page-'))
  const entry = join(temporary, 'monitor.mjs')
  // Node loads the shipped module from disk in place of its browser HTTP route.
  const adapter = pathToFileURL(
    resolve('src-tauri/resources/parameter-preview/adapter.mjs')
  ).href
  writeFileSync(
    entry,
    code.replace(
      "import('/pnds-preview.mjs')",
      `import(${JSON.stringify(adapter)})`
    )
  )
  require(entry)
  let sequence = 0
  async function send(type, extra = {}) {
    const current = ++sequence
    page.dispatchEvent(
      new page.MessageEvent('message', {
        source: page.parent,
        origin: 'http://host',
        data: {
          channel: 'pnds.preview',
          version: 1,
          session: 'blank-test',
          sequence: current,
          type,
          ...extra,
        },
      })
    )
    await vi.waitFor(() =>
      expect(replies.find(reply => reply.sequence === current)).toBeDefined()
    )
    return replies.find(reply => reply.sequence === current)
  }
  return { page, listener, send }
}

it('keeps Blank empty and inactive with no parameters even when the Host origin is present', async () => {
  const first = loadMonitor(script, {
    hostOrigin: 'http://host',
    sources: {},
    contractDigest: 'empty',
  })
  await Promise.resolve()
  expect(first.listener).not.toHaveBeenCalledWith(
    'message',
    expect.any(Function)
  )
  expect(first.page.document.querySelector('h1').style.fontSize).toBe('')
})

it('leaves independent browser pages inactive when the Host origin is absent', async () => {
  const { listener } = loadMonitor(
    script.replace(
      'const previewParameters = {}',
      'const previewParameters = { example: {} }'
    ),
    undefined
  )
  await Promise.resolve()
  expect(listener).not.toHaveBeenCalledWith('message', expect.any(Function))
})

it('runs the documented recipe through actual monitor wiring and the local adapter, with visible set and restore effects', async () => {
  const guide = readFileSync(join(root, 'docs/implementation.en.md'), 'utf8')
  const example = guide
    .split('```js\n')[1]
    .split('```')[0]
    .split('\n')
    .map(line => (line.startsWith('   ') ? line.slice(3) : line))
    .join('\n')
    .trimEnd()
  const context = {
    hostOrigin: 'http://host',
    sources: { 'public/monitor.js': 'sha256:loaded' },
    contractDigest: 'sha256:contract',
  }
  const { page, listener, send } = loadMonitor(
    script.replace('const previewParameters = {}', example),
    context
  )
  await vi.waitFor(() =>
    expect(listener).toHaveBeenCalledWith('message', expect.any(Function))
  )
  expect(page.document.querySelector('h1').style.fontSize).toBe('48px')
  expect(await send('hello', { ids: ['titleSize'] })).toMatchObject({
    type: 'ready',
    loaded: context.sources,
    contractDigest: context.contractDigest,
    values: { titleSize: 48 },
  })
  expect(await send('set', { values: { titleSize: 72 } })).toMatchObject({
    type: 'applied',
    values: { titleSize: 72 },
  })
  expect(page.document.querySelector('h1').style.fontSize).toBe('72px')
  expect(await send('restore')).toMatchObject({
    type: 'restored',
    values: { titleSize: 48 },
  })
  expect(page.document.querySelector('h1').style.fontSize).toBe('48px')
})
