// Controlled-process acceptance at the actual generated server/client boundary.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const [clientEntry, ...roots] = process.argv.slice(2)
const { io } = require(clientEntry)
const stored = new Map()
const storage = {
  getItem: key => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(25)
  }
  throw new Error('Generated Classic did not complete the requested operation')
}
async function freePort() {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function stop(child) {
  if (child.exitCode !== null) return child.exitCode
  const exited = once(child, 'exit')
  const timeout = setTimeout(() => child.kill('SIGKILL'), 2000)
  child.kill('SIGTERM')
  const [code] = await exited
  clearTimeout(timeout)
  return code
}
async function main() {
  const performerPort = await freePort()
  let monitorPort = await freePort()
  while (performerPort === monitorPort) monitorPort = await freePort()
  const origin = `http://127.0.0.1:${performerPort}`
  const ids = []
  const keys = []
  const tokens = []
  for (const root of roots) {
    assert.equal(fs.existsSync(path.join(root, 'node_modules')), false)
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'manifest.json'))
    )
    manifest.scoreServer.performerPort = performerPort
    manifest.scoreServer.monitorPort = monitorPort
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest))
    const { events, tokenKey } = require(path.join(root, 'public/shared.js'))
    const { connectPerformer } = require(path.join(root, 'public/client.js'))
    ids.push(manifest.id)
    keys.push(tokenKey)
    for (const mode of ['none', 'external', 'internal']) {
      const child = spawn(
        process.execPath,
        ['server.js', '--audio-mode', mode],
        {
          cwd: root,
          env: {
            ...process.env,
            PNDS_HOST_IP: '127.0.0.1',
            PNDS_AUDIO_OUTPUT_BUS: '12',
            PNDS_AUDIO_OUTPUT_CHANNELS: '16',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      )
      let output = ''
      child.stdout.on('data', data => {
        output += data
      })
      child.stderr.on('data', data => {
        output += data
      })
      let client
      try {
        await until(async () => {
          if (child.exitCode !== null) throw new Error(output)
          try {
            const health = await (await fetch(`${origin}/__pnds/health`)).json()
            assert.equal(health.projectId, manifest.id)
            assert.equal(health.audioMode, mode)
            return health.status === 'ready'
          } catch (error) {
            if (error instanceof assert.AssertionError) throw error
            return false
          }
        })
        assert.equal((await fetch(`${origin}/__pnds/shared/p5.js`)).status, 200)
        assert.equal(
          (await fetch(`http://127.0.0.1:${monitorPort}/qr`)).status,
          200
        )
        const previous = storage.getItem(tokenKey)
        client = connectPerformer({
          io,
          origin,
          events,
          tokenKey,
          storage,
          reconnectionDelay: 20,
        })
        await until(() => client.joined)
        assert.equal(client.myId, 1)
        const token = storage.getItem(tokenKey)
        assert.equal(typeof token, 'string')
        if (previous) assert.equal(token, previous)
        client.close()
        client = connectPerformer({
          io,
          origin,
          events,
          tokenKey,
          storage,
          reconnectionDelay: 20,
        })
        await until(() => client.joined)
        assert.equal(client.myId, 1)
        assert.equal(storage.getItem(tokenKey), token)
      } finally {
        client?.close()
        assert.equal(await stop(child), 0, output)
      }
      // The same origin must be immediately reusable for the next project/mode.
      const probe = net.createServer()
      probe.listen(performerPort, '127.0.0.1')
      await once(probe, 'listening')
      await new Promise(resolve => probe.close(resolve))
    }
    tokens.push(storage.getItem(tokenKey))
  }
  assert.notEqual(ids[0], ids[1])
  assert.notEqual(keys[0], keys[1])
  assert.notEqual(tokens[0], tokens[1])
  // The installed copy preserves the first project's identity and existing client key.
  assert.equal(ids[2], ids[0])
  assert.equal(keys[2], keys[0])
  assert.equal(tokens[2], tokens[0])
}
main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
