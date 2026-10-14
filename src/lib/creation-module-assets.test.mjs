import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath, URLSearchParams } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src-tauri/resources/modules'
)
const require = createRequire(import.meta.url)

describe('the actual offline module sources', () => {
  it('pins every delivered source, compatibility document and README to one content revision', () => {
    const source = JSON.parse(
      readFileSync(path.join(root, 'SOURCE.json'), 'utf8')
    )
    const hash = bytes => createHash('sha256').update(bytes).digest('hex')
    expect(source.moduleVersion).toBe('0.2.0')
    expect(source.revision).toBe(`sha256:${hash(JSON.stringify(source.files))}`)
    const files = readdirSync(root, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory()
        ? readdirSync(path.join(root, entry.name)).map(
            name => `${entry.name}/${name}`
          )
        : entry.name === 'SOURCE.json'
          ? []
          : [entry.name]
    )
    expect(files.sort()).toEqual(Object.keys(source.files).sort())
    for (const [name, digest] of Object.entries(source.files)) {
      expect(hash(readFileSync(path.join(root, name)))).toBe(digest)
    }
    for (const id of [
      'qr',
      'players',
      'theme-follow',
      'locale-follow',
      'monitor-state',
      'hub',
    ]) {
      const compatibility = JSON.parse(
        readFileSync(path.join(root, id, 'compatibility.json'), 'utf8')
      )
      expect(compatibility.version).toBe('0.2.0')
      expect(compatibility.hostProtocol).toBe(1)
      expect(compatibility.runtime.length).toBeGreaterThan(0)
      expect(compatibility.adaptation.length).toBeGreaterThan(0)
    }
  })

  it('are self-contained CommonJS/UMD files that parse under the project Node baseline', () => {
    for (const id of [
      'qr',
      'players',
      'theme-follow',
      'locale-follow',
      'monitor-state',
      'hub',
    ]) {
      expect(
        JSON.parse(readFileSync(path.join(root, id, 'package.json'), 'utf8'))
          .type
      ).toBe('commonjs')
      for (const name of readdirSync(path.join(root, id)).filter(name =>
        name.endsWith('.js')
      )) {
        execFileSync(process.execPath, ['--check', path.join(root, id, name)])
      }
    }
  })

  it('recovers a client identity on a replacement socket without releasing it through an obsolete socket', () => {
    const { PlayerRegistry } = require(path.join(root, 'players/players.js'))
    const registry = new PlayerRegistry({ maxClients: 2 })
    const first = registry.allocate({ socketId: 'one' })
    const second = registry.allocate({ socketId: 'two' })
    expect(second.id).not.toBe(first.id)
    expect(
      registry.allocate({ socketId: 'three', claimToken: first.token })
    ).toEqual({ status: 'recovered', id: first.id, token: first.token })
    expect(registry.releaseBySocket('one')).toBeNull()
    expect(registry.list()).toContainEqual({ id: first.id, socketId: 'three' })
  })

  it('follows the first-frame theme and language and ignores unsupported Host messages', () => {
    const properties = {}
    const handlers = []
    const page = {
      location: { search: '?theme=brutal&lang=zh-CN' },
      document: {
        documentElement: {
          lang: '',
          style: {
            setProperty: (key, value) => {
              properties[key] = value
            },
          },
        },
      },
      addEventListener: (_event, listener) => handlers.push(listener),
      URLSearchParams,
    }
    page.self = page
    vm.runInNewContext(
      readFileSync(path.join(root, 'theme-follow/theme-follow.js'), 'utf8'),
      page
    )
    vm.runInNewContext(
      readFileSync(path.join(root, 'locale-follow/locale-follow.js'), 'utf8'),
      page
    )
    expect(properties['--bg']).toBeDefined()
    expect(page.document.documentElement.lang).toBe('zh-CN')
    for (const handler of handlers)
      handler({ data: { type: 'pnds:locale', version: 1, locale: 'en' } })
    expect(page.document.documentElement.lang).toBe('en')
    for (const handler of handlers)
      handler({ data: { type: 'pnds:locale', version: 999, locale: 'zh-CN' } })
    expect(page.document.documentElement.lang).toBe('en')
  })

  it('synchronizes only declared monitor view keys and gives a new connection the current snapshot', () => {
    const { attachMonitorState } = require(
      path.join(root, 'monitor-state/monitor-state.js')
    )
    const namespace = { on: vi.fn(), emit: vi.fn() }
    const events = {
      monitorSnapshot: 'snapshot',
      monitorSet: 'set',
      monitorState: 'state',
    }
    attachMonitorState(namespace, { events, defaults: { showQr: true } })
    const connect = namespace.on.mock.calls[0][1]
    const first = { on: vi.fn(), emit: vi.fn() }
    connect(first)
    const set = first.on.mock.calls[0][1]
    set({ key: 'artisticProgress', value: 9 })
    expect(namespace.emit).not.toHaveBeenCalled()
    set({ key: 'showQr', value: false })
    expect(namespace.emit).toHaveBeenCalledWith('state', { showQr: false })
    const second = { on: vi.fn(), emit: vi.fn() }
    connect(second)
    expect(second.emit).toHaveBeenCalledWith('snapshot', { showQr: false })
  })

  it('passes the complete performer URL to the QR encoder and responds with PNG bytes', async () => {
    const encoder = { toBuffer: vi.fn().mockResolvedValue(Buffer.from('PNG')) }
    const module = { exports: {} }
    vm.runInNewContext(readFileSync(path.join(root, 'qr/qr.js'), 'utf8'), {
      module,
      require: name => {
        if (name !== 'qrcode') throw new Error(name)
        return encoder
      },
      console,
      URL,
    })
    const response = { type: vi.fn().mockReturnThis(), send: vi.fn() }
    await module.exports.qrHandler('https://stage.example/join?room=one')(
      {},
      response
    )
    await vi.waitFor(() =>
      expect(response.send).toHaveBeenCalledWith(Buffer.from('PNG'))
    )
    expect(encoder.toBuffer).toHaveBeenCalledWith(
      'https://stage.example/join?room=one',
      expect.objectContaining({ type: 'png' })
    )
  })
})
