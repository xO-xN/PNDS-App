import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = path.resolve('scripts/fetch-shared-libraries.mjs')
const temporary = []
afterEach(() => {
  for (const root of temporary.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

function fixture({
  esm = false,
  lifecycle = false,
  socketServer = false,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pnds-library-test-'))
  temporary.push(root)
  const source = path.join(root, 'source')
  const cache = path.join(root, 'cache')
  const out = path.join(root, 'out')
  fs.mkdirSync(source)
  fs.mkdirSync(cache)
  const tarball = (name, version, files) => {
    const directory = path.join(root, name)
    fs.mkdirSync(path.join(directory, 'package'), { recursive: true })
    const manifest = {
      name,
      version,
      main: 'index.js',
      ...(name === 'express' && esm
        ? { type: 'module', exports: { import: './index.js' } }
        : {}),
      ...(name === 'express' && lifecycle
        ? { scripts: { install: `node -e 'process.exit(42)'` } }
        : {}),
    }
    for (const [file, bytes] of Object.entries({
      'package.json': JSON.stringify(manifest),
      ...files,
    })) {
      const target = path.join(directory, 'package', file)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, bytes)
    }
    const target = path.join(cache, `${name}-${version}.tgz`)
    execFileSync('tar', ['-czf', target, '-C', directory, 'package'])
    return {
      target,
      integrity: `sha512-${createHash('sha512').update(fs.readFileSync(target)).digest('base64')}`,
    }
  }
  const browser = tarball('p5', '2.3.4', {
    'lib/p5.min.js': 'globalThis.fixtureCanvas = true;',
    'license.txt': 'fixture license',
  })
  const node = tarball('express', '5.3.0', {
    'index.js': esm
      ? 'export default () => "offline";'
      : 'module.exports = () => "offline";',
    LICENSE: 'fixture license',
  })
  const server = socketServer
    ? tarball('socket.io', '4.8.4', {
        'index.js': 'module.exports = {};',
        'client-dist/socket.io.js': 'globalThis.io = "fixture socket client";',
      })
    : null
  const manifest = {
    name: 'fixture-libraries',
    version: '1.0.0',
    dependencies: {
      express: '5.3.0',
      ...(socketServer ? { 'socket.io': '4.8.4' } : {}),
    },
  }
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify(manifest))
  fs.writeFileSync(
    path.join(source, 'package-lock.json'),
    JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      lockfileVersion: 3,
      packages: {
        '': manifest,
        'node_modules/express': {
          version: '5.3.0',
          resolved: `file:${node.target}`,
          integrity: node.integrity,
        },
        ...(socketServer
          ? {
              'node_modules/socket.io': {
                version: '4.8.4',
                resolved: `file:${server.target}`,
                integrity: server.integrity,
              },
            }
          : {}),
      },
    })
  )
  const sources = path.join(root, 'browser-sources.json')
  fs.writeFileSync(
    sources,
    JSON.stringify({
      schemaVersion: 1,
      libraries: [
        {
          id: 'p5',
          version: '2.3.4',
          entry: 'browser/p5/2.3.4/p5.min.js',
          source: {
            url: 'https://registry.npmjs.org/p5/-/p5-2.3.4.tgz',
            integrity: browser.integrity,
          },
          files: [
            {
              source: 'package/lib/p5.min.js',
              path: 'browser/p5/2.3.4/p5.min.js',
            },
            {
              source: 'package/license.txt',
              path: 'browser/p5/2.3.4/LICENSE.txt',
            },
          ],
        },
      ],
    })
  )
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [
        script,
        '--node-source',
        source,
        '--sources',
        sources,
        '--cache',
        cache,
        '--out',
        out,
        ...args,
      ],
      { encoding: 'utf8', env: { ...process.env, npm_config_offline: 'true' } }
    )
  return { run, out, source, cache, sources }
}

describe('the offline shared-library build command', () => {
  it('stages pinned browser bytes and a standalone production Node tree that loads outside the App', () => {
    const { run, out } = fixture()
    const result = run()
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    const catalog = JSON.parse(
      fs.readFileSync(path.join(out, 'catalog.json'), 'utf8')
    )
    expect(catalog.schemaVersion).toBe(1)
    expect(
      catalog.libraries.map(({ id, version }) => ({ id, version }))
    ).toEqual([
      { id: 'p5', version: '2.3.4' },
      { id: 'express', version: '5.3.0' },
    ])
    const nodeEntry = catalog.libraries.find(({ id }) => id === 'express').entry
    expect(createRequire(script)(path.join(out, nodeEntry))()).toBe('offline')
    expect(
      fs.readFileSync(path.join(out, catalog.libraries[0].entry), 'utf8')
    ).toBe('globalThis.fixtureCanvas = true;')
    expect(run('--check').status).toBe(0)
  })
  it('refuses a corrupted archive before publishing a resource directory', () => {
    const { run, out, cache } = fixture()
    fs.writeFileSync(path.join(cache, 'p5-2.3.4.tgz'), 'poisoned cache')
    const result = run()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('npm integrity mismatch: p5@2.3.4')
    expect(fs.existsSync(out)).toBe(false)
  })

  it('checks cached bytes on every build and refuses missing production files without replacing output', () => {
    const { run, out } = fixture()
    expect(run().status).toBe(0)
    const catalogBytes = fs.readFileSync(path.join(out, 'catalog.json'))
    fs.rmSync(path.join(out, 'node/node_modules/express/index.js'))
    const result = run()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'missing resource for express@5.3.0: node/node_modules/express/index.js'
    )
    expect(fs.readFileSync(path.join(out, 'catalog.json'))).toEqual(
      catalogBytes
    )
  })

  it('refuses damaged browser bytes and reports the exact resource identity', () => {
    const { run, out } = fixture()
    expect(run().status).toBe(0)
    fs.writeFileSync(path.join(out, 'browser/p5/2.3.4/p5.min.js'), 'corrupt')
    const result = run('--check')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'damaged resource for p5@2.3.4: browser/p5/2.3.4/p5.min.js'
    )
  })

  it('does not accept a stale tree after an explicit source or lock change', () => {
    const { run, out, source } = fixture()
    expect(run().status).toBe(0)
    const catalogBytes = fs.readFileSync(path.join(out, 'catalog.json'))
    const file = path.join(source, 'package-lock.json')
    fs.appendFileSync(file, '\n')
    expect(run('--check').stderr).toContain('does not match the pinned sources')
    expect(fs.readFileSync(path.join(out, 'catalog.json'))).toEqual(
      catalogBytes
    )
  })
  it('does not allow the catalog to substitute an executable entry with another inventoried file', () => {
    const { run, out } = fixture()
    expect(run().status).toBe(0)
    const file = path.join(out, 'catalog.json')
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'))
    catalog.libraries[0].entry = 'browser/p5/2.3.4/LICENSE.txt'
    fs.writeFileSync(file, JSON.stringify(catalog))
    const result = run('--check')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('catalog entry mismatch: p5@2.3.4')
  })
  it('stages an import-only ESM package without running installation lifecycle scripts', () => {
    const { run, out } = fixture({ esm: true, lifecycle: true })
    const result = run()
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    const catalog = JSON.parse(
      fs.readFileSync(path.join(out, 'catalog.json'), 'utf8')
    )
    const entry = path.join(
      out,
      catalog.libraries.find(item => item.id === 'express').entry
    )
    const loaded = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const library = await import(${JSON.stringify(pathToFileURL(entry).href)}); console.log(library.default())`,
      ],
      { cwd: os.tmpdir(), encoding: 'utf8' }
    )
    expect(loaded.status).toBe(0)
    expect(loaded.stdout.trim()).toBe('offline')
  })
  it('exposes the Socket.IO server bundled browser client with full integrity coverage', () => {
    const { run, out } = fixture({ socketServer: true })
    expect(run().status).toBe(0)
    const catalog = JSON.parse(
      fs.readFileSync(path.join(out, 'catalog.json'), 'utf8')
    )
    const server = catalog.libraries.find(item => item.id === 'socket.io')
    expect(server.version).toBe('4.8.4')
    expect(server.browserEntry).toBe(
      'node/node_modules/socket.io/client-dist/socket.io.js'
    )
    const client = server.files.find(file => file.path === server.browserEntry)
    expect(client).toMatchObject({
      sha256:
        '6536b2dc556df6a8018699091bd078281877aeffac21f0a2f7cdfd53ee89c472',
      bytes: 40,
    })
    fs.writeFileSync(
      path.join(out, server.browserEntry),
      'corrupted browser client'
    )
    expect(run('--check').stderr).toContain('damaged resource for')
  })
})
