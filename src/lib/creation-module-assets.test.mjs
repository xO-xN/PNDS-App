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

  it('retains exact trusted previous source revisions and their original file hashes', () => {
    const previous = JSON.parse(
      readFileSync(path.join(root, 'PREVIOUS.json'), 'utf8')
    )
    expect(previous.map(release => release.revision)).toEqual([
      'sha256:5d136e820c0d9cf8d206694c44b79665e60e21849352a619be86b1a5ed566c72',
      'sha256:12bbf7009386726079ec3f13e99fc37a8a68df942cff5576e0a57a7e6012614e',
      'sha256:d0e71422448ff1f8505271b2f3950f4acc8b3f89c6ab9311c277f8e1e19a6301',
      'sha256:2c328acc29742ebf4edffe3e9c34d49d96bca67dc31feef70ae2ed6ea55f81d8',
    ])
    for (const release of previous) {
      const hash = createHash('sha256')
        .update(JSON.stringify(release.files))
        .digest('hex')
      expect(release.revision).toBe(`sha256:${hash}`)
      expect(release.repository).toBe('https://github.com/xO-xN/PNDS-Template')
      expect(['0.5.1', '0.7.0', '0.7.1']).toContain(release.version)
      expect(release.moduleVersion).toBe('0.2.0')
      for (const id of [
        'players',
        'theme-follow',
        'locale-follow',
        'monitor-state',
        'hub',
      ]) {
        expect(release.files[`${id}/compatibility.json`]).toMatch(
          /^[a-f0-9]{64}$/
        )
        expect(release.files[`${id}/README.md`]).toMatch(/^[a-f0-9]{64}$/)
      }
    }
  })

  it('are self-contained CommonJS/UMD files that parse under the project Node baseline', () => {
    for (const id of [
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

  it.each([
    ['module catalog', root],
    ['Classic source', path.resolve(root, '../classic-project/source/modules')],
  ])('keeps empty Host injection authoritative in %s', (_name, source) => {
    const { createHubConnection } = require(path.join(source, 'hub/hub.js'))
    const config = {
      nodeId: 'standalone',
      url: 'http://127.0.0.1:1',
      token: 'secret',
      room: 'wrong_1',
    }
    for (const key of [
      'PNDS_NODE_ID',
      'PNDS_HUB_URL',
      'PNDS_HUB_TOKEN',
      'PNDS_HUB_ROOM',
    ]) {
      for (const value of ['', ' \t ']) {
        const link = createHubConnection({
          environment: { [key]: value },
          config,
        })
        try {
          link.start()
          expect(link.snapshot().status).toBe('unconfigured')
          expect(link.snapshot().nodeId).toBe('')
        } finally {
          link.stop()
        }
      }
    }
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
})
