// Real generated pages, Socket.IO connections and shutdown; no project npm install.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import vm from 'node:vm'

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

try {
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
      for (const role of ['performer', 'monitor']) {
        const port = manifest.scoreServer[`${role}Port`]
        const origin = `http://127.0.0.1:${port}`
        const html = await (await fetch(origin)).text()
        assert.ok(
          html.includes('<script src="/socket.io/socket.io.js"></script>')
        )
        const bundle = await fetch(`${origin}/socket.io/socket.io.js`)
        assert.equal(bundle.status, 200)
        assert.match(bundle.headers.get('content-type'), /javascript/)
        assert.ok((await bundle.text()).length > 1000)
        const script = await (await fetch(`${origin}/${role}.js`)).text()
        let client
        // Execute the actual page entry with its same-origin client factory.
        vm.runInNewContext(script, {
          window: {},
          console,
          io: () =>
            (client = io(origin, { autoConnect: false, forceNew: true })),
        })
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
