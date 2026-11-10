// Real generated project, public editable configuration and actual monitor entry.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, writeFile, mkdir, symlink, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
const [root, clientEntry, performerPort, monitorPort] = process.argv.slice(2)
const { io } = createRequire(import.meta.url)(clientEntry)
const declarations = await readFile(
  path.join(root, 'public/monitor-view.json'),
  'utf8'
)
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json')))
// The Rust fixture retains pool-external numerical leases through every restart.
manifest.scoreServer.performerPort = Number(performerPort)
manifest.scoreServer.monitorPort = Number(monitorPort)
assert.ok(
  [manifest.scoreServer.performerPort, manifest.scoreServer.monitorPort].every(
    port => Number.isInteger(port) && port >= 1024 && port <= 65535
  )
)
assert.notEqual(
  manifest.scoreServer.performerPort,
  manifest.scoreServer.monitorPort
)
await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest))
const performerOrigin = `http://127.0.0.1:${manifest.scoreServer.performerPort}`
const monitorOrigin = `http://127.0.0.1:${manifest.scoreServer.monitorPort}`
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, message) {
  const deadline = Date.now() + 5000
  while (!check()) {
    assert.ok(Date.now() < deadline, message)
    await sleep(10)
  }
}
let activeChild = null
const timer = setTimeout(() => {
  activeChild?.kill('SIGKILL')
  throw new Error('Monitor view verification timed out')
}, 30000)
try {
  for (const run of ['empty', 'declared', 'restarted']) {
    await writeFile(
      path.join(root, 'public/monitor-view.json'),
      run === 'empty' ? '{}' : declarations
    )
    const child = spawn(
      process.execPath,
      ['server.js', '--audio-mode', 'none'],
      { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    activeChild = child
    let output = ''
    child.stdout.on('data', bytes => {
      output += bytes
    })
    child.stderr.on('data', bytes => {
      output += bytes
    })
    const exited = once(child, 'exit')
    const clients = [],
      pages = []
    try {
      const deadline = Date.now() + 5000
      for (;;) {
        assert.equal(child.exitCode, null, output)
        try {
          if (
            (await (await fetch(`${performerOrigin}/__pnds/health`)).json())
              .status === 'ready'
          )
            break
        } catch {
          /* Starting. */
        }
        assert.ok(Date.now() < deadline, output)
        await sleep(20)
      }
      async function page() {
        const requests = [],
          events = new Map(),
          body = { dataset: {} }
        const context = {
          console,
          setTimeout,
          clearTimeout,
          location: { origin: monitorOrigin },
          document: { body },
          fetch: url => fetch(new URL(url, monitorOrigin)),
          addEventListener: (name, fn) => events.set(name, fn),
        }
        context.window = context
        context.io = (origin = monitorOrigin, options) => {
          requests.push(origin)
          const socket = io(origin, { ...options, forceNew: true })
          clients.push(socket)
          return socket
        }
        vm.createContext(context)
        const html = await (await fetch(monitorOrigin)).text()
        const scripts = [
          ...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g),
        ].map(match => match[1])
        assert.ok(
          scripts.includes('./monitor-state-client.js'),
          'generated monitor must load its local connector'
        )
        for (const script of scripts) {
          if (script.includes('/socket.io/')) continue // Node uses the same real Socket.IO client at this boundary.
          vm.runInContext(
            await (await fetch(new URL(script, monitorOrigin))).text(),
            context
          )
        }
        const result = { context, requests, events, body }
        pages.push(result)
        return result
      }
      if (run === 'empty') {
        const one = await page()
        await until(
          () => one.context.PNDSMonitorView.ready,
          'empty configuration must become ready'
        )
        assert.equal(
          one.requests.length,
          1,
          'empty monitor configuration opens no namespace socket'
        )
        const rejected = io(`${monitorOrigin}/monitor-view`, {
          reconnection: false,
        })
        clients.push(rejected)
        assert.match(
          (await once(rejected, 'connect_error'))[0].message,
          /Invalid namespace/
        )
        continue
      }
      const one = await page(),
        two = await page()
      await until(
        () =>
          one.body.dataset.displayMode === 'score' &&
          two.body.dataset.displayMode === 'score',
        'initial declaration must render both copies'
      )
      assert.equal(
        one.context.PNDSMonitorView.setViewState('displayMode', 'details'),
        true
      )
      await until(
        () =>
          one.body.dataset.displayMode === 'details' &&
          two.body.dataset.displayMode === 'details',
        'whole snapshots must converge'
      )
      const late = await page()
      await until(
        () => late.body.dataset.displayMode === 'details',
        'late copy must get current snapshot'
      )
      const value = one.context.PNDSMonitorView.viewState
      value.displayMode = 'mutated'
      let secondSubscriber
      one.context.PNDSMonitorView.onViewState(state => {
        if (state) state.displayMode = 'caller mutation'
      })
      one.context.PNDSMonitorView.onViewState(state => {
        secondSubscriber = state
      })
      assert.equal(secondSubscriber.displayMode, 'details')
      assert.equal(one.context.PNDSMonitorView.viewState.displayMode, 'details')
      const wire = io(`${monitorOrigin}/monitor-view`, { forceNew: true })
      clients.push(wire)
      await once(wire, 'view:snapshot')
      for (const payload of [
        { key: 'unknown', value: true },
        null,
        [],
        { key: 'displayMode', value: 2 },
        { key: 'displayMode', value: 'unknown' },
        { key: 'detailLevel', value: 6 },
        { key: 'detailLevel', value: '1' },
      ]) {
        const rejected = once(wire, 'view:error')
        wire.emit('view:set', payload)
        await rejected
        assert.equal(
          one.context.PNDSMonitorView.viewState.displayMode,
          'details'
        )
        assert.equal(one.context.PNDSMonitorView.viewState.detailLevel, 1)
      }
      two.context.PNDSMonitorView.reconnect()
      assert.equal(two.body.dataset.displayMode, 'waiting')
      await until(
        () => two.body.dataset.displayMode === 'details',
        'reconnect must heal using full snapshot'
      )
      const performer = io(`${performerOrigin}/monitor-view`, {
        reconnection: false,
      })
      clients.push(performer)
      assert.match(
        (await once(performer, 'connect_error'))[0].message,
        /Invalid namespace/
      )
      // A saved declaration only applies on restart, matching this run's server schema.
      await writeFile(path.join(root, 'public/monitor-view.json'), '{}')
      assert.deepEqual(
        await (await fetch(`${monitorOrigin}/__pnds/monitor-view.json`)).json(),
        JSON.parse(declarations)
      )
      late.events.get('pagehide')()
      assert.equal(
        late.context.PNDSMonitorView.setViewState('displayMode', 'score'),
        false
      )
    } finally {
      pages.forEach(page => page.events.get('pagehide')?.())
      clients.forEach(client => client.close())
      if (child.exitCode === null) {
        child.kill('SIGTERM')
        assert.deepEqual(await exited, [0, null], output)
      }
    }
  }
  const configuration = path.join(root, 'public/monitor-view.json')
  const privateDirectory = path.join(root, '.pnds-creation')
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 })
  for (const [kind, target, marker] of [
    [
      'private',
      path.join(privateDirectory, 'view-secrets.json'),
      'PRIVATE BOOT VIEW',
    ],
    [
      'external',
      path.join(path.dirname(root), 'external-view.json'),
      'EXTERNAL BOOT VIEW',
    ],
    ['safe', path.join(root, 'public/author-view.json'), 'SAFE AUTHOR VIEW'],
  ]) {
    const expected = { displayMode: { default: marker, values: [marker] } }
    await writeFile(target, JSON.stringify(expected))
    await unlink(configuration)
    await symlink(target, configuration)
    const child = spawn(
      process.execPath,
      ['server.js', '--audio-mode', 'none'],
      { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    activeChild = child
    let output = ''
    child.stdout.on('data', bytes => {
      output += bytes
    })
    child.stderr.on('data', bytes => {
      output += bytes
    })
    const exited = once(child, 'exit')
    let ready = false,
      wire
    try {
      const deadline = Date.now() + 5000
      while (child.exitCode === null && !ready) {
        try {
          ready =
            (await (await fetch(`${performerOrigin}/__pnds/health`)).json())
              .status === 'ready'
        } catch {
          /* Await actual boot or explicit failure. */
        }
        assert.ok(
          Date.now() < deadline,
          'preboot declaration alias must settle'
        )
        if (!ready) await sleep(10)
      }
      if (ready) {
        const cached = await (
          await fetch(`${monitorOrigin}/__pnds/monitor-view.json`)
        ).json()
        assert.deepEqual(
          cached,
          expected,
          'cached endpoint reflects the exact startup declaration bytes'
        )
        wire = io(`${monitorOrigin}/monitor-view`, {
          autoConnect: false,
          forceNew: true,
          reconnection: false,
        })
        const loaded = once(wire, 'view:snapshot')
        wire.connect()
        assert.equal(
          (await loaded)[0].displayMode,
          marker,
          'the real namespace publishes the cached default'
        )
        assert.equal(
          kind,
          'safe',
          'private or external preboot schema alias must fail before cache/namespace publication'
        )
        // A valid startup cache remains a fixed snapshot even if the public
        // declaration path is later changed to a private alias.
        await unlink(configuration)
        await symlink(
          path.join(privateDirectory, 'view-secrets.json'),
          configuration
        )
        assert.deepEqual(
          await (
            await fetch(`${monitorOrigin}/__pnds/monitor-view.json`)
          ).json(),
          expected
        )
      } else {
        assert.notEqual(
          kind,
          'safe',
          'safe ordinary internal declaration alias remains usable'
        )
        assert.deepEqual(await exited, [1, null])
        assert.match(output, /Monitor view declarations.*safe public/)
        assert.ok(
          !output.includes(' ready '),
          'unsafe cached source never reaches ready'
        )
      }
    } finally {
      wire?.close()
      if (child.exitCode === null) {
        child.kill('SIGTERM')
        await exited
      }
      await unlink(configuration)
      await writeFile(configuration, declarations)
    }
  }
  for (const invalid of [
    '[]',
    '{"displayMode":{"default":"score","values":["details"]}}',
    '{"detailLevel":{"default":1e400}}',
  ]) {
    await writeFile(path.join(root, 'public/monitor-view.json'), invalid)
    const child = spawn(
      process.execPath,
      ['server.js', '--audio-mode', 'none'],
      { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    activeChild = child
    let output = ''
    child.stdout.on('data', bytes => {
      output += bytes
    })
    child.stderr.on('data', bytes => {
      output += bytes
    })
    assert.deepEqual(await once(child, 'exit'), [1, null])
    assert.match(output, /Monitor view declarations|Invalid monitor view/)
    assert.ok(
      !output.includes(' ready '),
      'invalid declarations must never publish ready'
    )
  }
} finally {
  clearTimeout(timer)
}
