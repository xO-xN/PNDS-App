// Real generated pages, Socket.IO connections and shutdown; no project npm install.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, writeFile, symlink, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import vm from 'node:vm'
import { URLSearchParams } from 'node:url'

const [root, clientEntry] = process.argv.slice(2)
const { io } = createRequire(import.meta.url)(clientEntry)
const timeout = setTimeout(() => {
  throw new Error('Blank realtime verification timed out')
}, 15000)
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json')))
async function freePort() {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
manifest.scoreServer.performerPort = await freePort()
do {
  manifest.scoreServer.monitorPort = await freePort()
} while (
  manifest.scoreServer.monitorPort === manifest.scoreServer.performerPort
)
await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest))

await writeFile(path.join(root, 'public/.private.js'), 'private bytes')
await writeFile(path.join(root, 'outside.js'), 'outside bytes')
await symlink('../outside.js', path.join(root, 'public/escape.js'))
await writeFile(path.join(root, 'public/unapproved.data'), 'unapproved bytes')

async function verifyModuleRoute(origin, route, relative) {
  const source = path.join(root, relative)
  const original = await readFile(source)
  assert.match(original.toString(), /Saved author client edit remains public/)
  const safe = path.join(root, 'public/safe-module-client.js')
  const external = path.join(path.dirname(root), 'external-client.js')
  await writeFile(safe, original)
  await writeFile(external, 'EXTERNAL PRIVATE MODULE BYTES')
  await writeFile(
    path.join(root, '.git/route-secret.js'),
    'HIDDEN PRIVATE MODULE BYTES'
  )
  const alias = path.join(root, 'innocent-storage')
  try {
    await symlink('.pnds-creation', alias)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  async function check(status, expected) {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(`${origin}${route}`, { method })
      assert.equal(response.status, status, `${route} ${method}`)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      const bytes = Buffer.from(await response.arrayBuffer())
      if (status === 200) {
        assert.match(response.headers.get('content-type'), /javascript/)
        assert.deepEqual(bytes, method === 'HEAD' ? Buffer.alloc(0) : expected)
      } else
        assert.equal(
          bytes.length,
          0,
          'Denied module routes return no private bytes'
        )
    }
  }
  await check(200, original)
  try {
    await unlink(source)
    for (const target of [
      path.join(root, '.pnds-creation/players.json'),
      path.join(alias, 'players.json'),
      path.join(root, '.git/route-secret.js'),
      external,
      path.join(root, 'public'),
      path.join(root, 'missing-module.js'),
    ]) {
      await symlink(target, source)
      await check(404)
      await unlink(source)
    }
    await symlink(safe, source)
    await check(200, original)
  } finally {
    await unlink(source).catch(error => {
      if (error.code !== 'ENOENT') throw error
    })
    await writeFile(source, original)
  }
}

try {
  for (const id of ['express', 'socket.io', 'osc-min']) {
    const shared = JSON.parse(process.env.PNDS_SHARED_LIBRARIES)
    shared[id].version = '0.0.0'
    const child = spawn(
      process.execPath,
      ['server.js', '--audio-mode', 'none'],
      {
        cwd: root,
        env: { ...process.env, PNDS_SHARED_LIBRARIES: JSON.stringify(shared) },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    let error = ''
    child.stderr.on('data', bytes => {
      error += bytes
    })
    assert.deepEqual(await once(child, 'exit'), [1, null])
    assert.match(
      error,
      new RegExp(`Missing exact shared ${id.replace('.', '\\.')} `)
    )
  }
  for (let restart = 0; restart < 2; restart++) {
    const child = spawn(
      process.execPath,
      ['server.js', '--audio-mode', 'none'],
      {
        cwd: root,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    let output = ''
    child.stdout.on('data', bytes => {
      output += bytes
    })
    child.stderr.on('data', bytes => {
      output += bytes
    })
    const exited = once(child, 'exit')
    const clients = []
    try {
      const deadline = Date.now() + 5000
      const performerOrigin = `http://127.0.0.1:${manifest.scoreServer.performerPort}`
      while (true) {
        assert.equal(child.exitCode, null, output)
        try {
          const health = await (
            await fetch(`${performerOrigin}/__pnds/health`)
          ).json()
          if (health.status === 'ready') break
        } catch {
          /* Server is still starting. */
        }
        assert.ok(Date.now() < deadline, output)
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      const claimant = io(performerOrigin, {
        forceNew: true,
        reconnection: false,
        autoConnect: false,
      })
      clients.push(claimant)
      const transportConnected = once(claimant, 'connect')
      claimant.connect()
      await transportConnected
      const claimAccepted = once(claimant, 'pnds:joined')
      claimant.emit('pnds:join', { token: null })
      const [claim] = await claimAccepted
      const privateRegistry = await readFile(
        path.join(root, '.pnds-creation/players.json'),
        'utf8'
      )
      assert.ok(
        privateRegistry.includes(claim.token),
        'Route attack targets actual persisted claim bytes'
      )
      for (const role of ['performer', 'monitor']) {
        const port = manifest.scoreServer[`${role}Port`]
        const origin = `http://127.0.0.1:${port}`
        await verifyModuleRoute(
          origin,
          '/pnds-players.js',
          'modules/pnds-players/client.js'
        )
        if (role === 'monitor')
          await verifyModuleRoute(
            origin,
            '/monitor-state-client.js',
            'modules/pnds-monitor-state/monitor-client.js'
          )

        for (const resource of [
          '/.private.js',
          '/escape.js',
          '/unapproved.data',
          '/manifest.json',
        ]) {
          const denied = await fetch(`${origin}${resource}`)
          assert.equal(denied.status, 404, resource)
          assert.equal(denied.headers.get('cache-control'), 'no-store')
        }
        const head = await fetch(`${origin}/__pnds/health`, { method: 'HEAD' })
        assert.equal(head.status, 200)
        assert.match(head.headers.get('content-type'), /application\/json/)
        assert.equal(await head.text(), '')
        assert.equal(
          (await fetch(`${origin}/monitor.js`, { method: 'POST' })).status,
          405
        )
        const response = await fetch(origin)
        assert.equal(response.headers.get('cache-control'), 'no-store')
        const html = await response.text()
        assert.ok(
          html.includes('<script src="./socket.io/socket.io.js"></script>')
        )
        const bundle = await fetch(`${origin}/socket.io/socket.io.js`)
        assert.equal(bundle.status, 200)
        assert.match(bundle.headers.get('content-type'), /javascript/)
        assert.ok((await bundle.text()).length > 1000)
        const script = await (await fetch(`${origin}/${role}.js`)).text()
        let client
        // Execute the actual page entry with its same-origin client factory.
        const pageContext = {
          window: {},
          console,
          PNDSPlayers: createRequire(import.meta.url)(
            path.join(root, 'modules/pnds-players/client.js')
          ),
          document: {
            createElement: () => ({
              setAttribute() {
                /* Browser DOM boundary. */
              },
            }),
            addEventListener() {
              /* DOM event boundary; actual input behavior is covered in the browser fixture. */
            },
            removeEventListener() {
              /* DOM event boundary; actual input behavior is covered in the browser fixture. */
            },
            querySelector: () => ({
              style: {},
              addEventListener() {
                /* DOM event boundary; actual input behavior is covered in the browser fixture. */
              },
              removeEventListener() {
                /* DOM event boundary; actual input behavior is covered in the browser fixture. */
              },
              append() {
                /* Browser DOM boundary. */
              },
            }),
          },
          fetch: relative => fetch(new URL(relative, origin + '/')),
          URLSearchParams,
          location: { origin, search: '' },
          localStorage: {
            getItem: () => null,
            setItem() {
              /* Realtime fixture does not retain claims. */
            },
          },
          addEventListener() {
            /* Fixture owns the page lifetime. */
          },
          removeEventListener() {
            /* DOM event boundary; actual input behavior is covered in the browser fixture. */
          },
          io: () =>
            (client = io(origin, {
              autoConnect: false,
              forceNew: true,
              reconnection: false,
            })),
        }
        if (role === 'performer')
          vm.runInNewContext(
            await (await fetch(`${origin}/pnds-input.js`)).text(),
            pageContext
          )
        vm.runInNewContext(script, pageContext)
        const clientDeadline = Date.now() + 3000
        while (!client) {
          assert.ok(
            Date.now() < clientDeadline,
            'Actual page did not initialize its connection'
          )
          await new Promise(resolve => setTimeout(resolve, 5))
        }
        client.disconnect()
        clients.push(client)
        for (let connection = 0; connection < 2; connection++) {
          const identified = once(client, 'pnds:connected')
          client.connect()
          assert.deepEqual((await identified)[0], {
            projectId: manifest.id,
            role,
          })
          if (connection === 0) client.disconnect()
        }
        const upgraded = once(client.io.engine, 'upgrade')
        if (client.io.engine.transport.name !== 'websocket') await upgraded
      }
      const disconnected = clients.map(client => once(client, 'disconnect'))
      child.kill('SIGTERM')
      assert.deepEqual(await exited, [0, null], output)
      for (const [reason, details] of await Promise.all(disconnected)) {
        assert.equal(reason, 'transport close')
        assert.equal(details.context.wasClean, true)
      }
    } finally {
      clients.forEach(client => client.close())
      if (child.exitCode === null) {
        child.kill('SIGKILL')
        await exited
      }
    }
    for (const port of [
      manifest.scoreServer.performerPort,
      manifest.scoreServer.monitorPort,
    ]) {
      const probe = net.createServer()
      probe.listen(port, '127.0.0.1')
      await once(probe, 'listening')
      await new Promise(resolve => probe.close(resolve))
    }
  }
} finally {
  clearTimeout(timeout)
}
