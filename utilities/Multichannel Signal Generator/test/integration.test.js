// Multichannel Signal Generator integration tests: manifest contract, HTTP routes,
// health payload, fader API validation, QR endpoint, and graceful shutdown.
// These start the real server against a fake scsynth (no audio device) so
// the suite runs anywhere without audio hardware.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const PROJECT_ROOT = path.join(__dirname, '..')

// ---------------------------------------------------------------------------
// Manifest contract (docs/PNDS_SCORE_PROJECT_SPECIFICATION.md)
// ---------------------------------------------------------------------------

test('manifest satisfies the score-project contract', () => {
  const manifest = require('../manifest.json')
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.id, 'multichannel-signal-generator')
  assert.ok(manifest.scoreServer.entry.endsWith('server.js'))
  assert.equal(manifest.audio.defaultMode, 'internal')
  assert.deepEqual(manifest.audio.supportedModes, ['internal'])
  assert.equal(manifest.audio.outputChannels, 16)
  assert.ok(manifest.audio.scsynth.audioBusChannels >= 32)
  assert.notEqual(
    manifest.scoreServer.performerPort,
    manifest.scoreServer.monitorPort
  )
  // Compiled runtime artifact ships with the project.
  for (const synthdef of manifest.audio.synthdefs) {
    const artifact = path.join(PROJECT_ROOT, synthdef)
    assert.ok(fs.existsSync(artifact), `missing artifact: ${synthdef}`)
    assert.ok(artifact.endsWith('.scsyndef'))
  }
})

test('manifest passes the App preflight with its production dependency installed', () => {
  const packageJson = require('../package.json')
  const dependencies = packageJson.dependencies || {}
  const optionalDependencies = packageJson.optionalDependencies || {}
  // The only production dependency is qrcode (QR endpoint on the monitor).
  assert.deepEqual(Object.keys(dependencies), ['qrcode'])
  assert.equal(Object.keys(optionalDependencies).length, 0)
  // Preflight rule (spec §2): production deps present -> node_modules must
  // ship with the project so the App never runs an install step.
  for (const dependency of Object.keys(dependencies)) {
    assert.ok(
      fs.existsSync(path.join(PROJECT_ROOT, 'node_modules', dependency)),
      `missing installed dependency: ${dependency}`
    )
  }
  // The project pins the runtime it was validated on (spec §2).
  assert.equal(packageJson.engines.node, '>=24 <25')
})

// ---------------------------------------------------------------------------
// Server harness
// ---------------------------------------------------------------------------

const net = require('node:net')
const dgram = require('node:dgram')

/** Allocates a free local TCP port (released immediately; races are
 *  possible but practically impossible for consecutive tests). */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

/** Waits for the child to exit, resolving its code (or 'timeout'). */
function waitExit(proc, timeoutMs = 5000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve('timeout'), timeoutMs)
    proc.once('exit', code => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

/**
 * A fake scsynth: listens on a UDP port and answers the two replies the
 * project waits for (/done after /d_load, /synced after /sync), so the
 * server reaches "ready" without any real audio device.
 */
function startFakeScsynth() {
  const socket = dgram.createSocket('udp4')
  socket.on('message', (message, remote) => {
    const end = message.indexOf(0)
    if (end <= 0) return
    const address = message.toString('utf8', 0, end)
    if (address === '/d_load') {
      socket.send(Buffer.from('/done\x00\x00\x00\x00'), remote.port, remote.address)
    } else if (address === '/sync') {
      socket.send(Buffer.from('/synced\x00\x00\x00\x00\x00\x00'), remote.port, remote.address)
    }
  })
  return new Promise(resolve => {
    socket.bind(0, '127.0.0.1', () => {
      resolve({
        port: socket.address().port,
        close: () =>
          new Promise(done => {
            try {
              socket.close(() => done())
            } catch {
              done()
            }
          }),
      })
    })
  })
}

/** Boots the server with a fake scsynth and no audio device.
 *  Returns { base, monitorBase, proc, stop }. */
async function startServer() {
  const fakeScsynth = await startFakeScsynth()
  const performerPort = await freePort()
  const monitorPort = await freePort()
  const proc = spawn(process.execPath, [path.join(PROJECT_ROOT, 'server.js')], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PNDS_AUDIO_OUTPUT_BUS: '8',
      PNDS_AUDIO_OUTPUT_CHANNELS: '16',
      PNDS_OSC_TARGET: `127.0.0.1:${fakeScsynth.port}`,
      PNDS_PERFORMER_PORT: String(performerPort),
      PNDS_MONITOR_PORT: String(monitorPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const base = `http://127.0.0.1:${performerPort}`
  const monitorBase = `http://127.0.0.1:${monitorPort}`
  return {
    base,
    monitorBase,
    proc,
    async stop() {
      proc.kill('SIGTERM')
      const code = await waitExit(proc)
      if (code === 'timeout') proc.kill('SIGKILL')
      await fakeScsynth.close()
      return code
    },
  }
}

function fetchJson(url, options) {
  return fetch(url, options).then(async response => {
    const body = await response.json().catch(() => null)
    return { status: response.status, body }
  })
}

async function waitForHealth(base, expectedStatus, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const { status, body } = await fetchJson(`${base}/__pnds/health`)
      if (status === 200 && body?.status === expectedStatus) return body
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`health never became ${expectedStatus}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('performer health reports ready with the runtime contract payload', async () => {
  const server = await startServer()
  try {
    const health = await waitForHealth(server.base, 'ready')
    assert.equal(health.projectId, 'multichannel-signal-generator')
    assert.equal(health.audioMode, 'internal')
    assert.equal(health.audio.status, 'ready')
    assert.match(health.audio.target, /^127\.0\.0\.1:\d+$/)
    assert.equal(health.scoreServer.performerPort, Number(new URL(server.base).port))
    assert.equal(health.scoreServer.monitorPort, Number(new URL(server.monitorBase).port))
  } finally {
    await server.stop()
  }
})

test('performer / is a no-UI stub, monitor serves the fader page', async () => {
  const server = await startServer()
  try {
    await waitForHealth(server.base, 'ready')

    const performerPage = await fetch(`${server.base}/`)
    assert.equal(performerPage.status, 200)
    const performerHtml = await performerPage.text()
    assert.match(performerHtml, /no performer UI/i)

    const monitorPage = await fetch(`${server.monitorBase}/`)
    assert.equal(monitorPage.status, 200)
    assert.match(monitorPage.headers.get('content-type'), /text\/html/)
    const monitorHtml = await monitorPage.text()
    assert.match(monitorHtml, /Multichannel Signal Generator/)
    assert.match(monitorHtml, /16-ch sine wave test/)
    assert.match(monitorHtml, /16 test-tone toggles/i)
    assert.match(monitorHtml, /\/qr/)
    // The QR row copy points at the monitor page (not the performer stub).
    assert.match(monitorHtml, /Scan to open the monitor page/)
  } finally {
    await server.stop()
  }
})

test('monitor /qr serves a PNG of the monitor page URL', async () => {
  const server = await startServer()
  try {
    await waitForHealth(server.base, 'ready')

    const qr = await fetch(`${server.monitorBase}/qr`)
    assert.equal(qr.status, 200)
    assert.match(qr.headers.get('content-type'), /image\/png/)
    const bytes = Buffer.from(await qr.arrayBuffer())
    // PNG magic: 89 50 4E 47
    assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])

    // The QR endpoint is monitor-only; the performer port does not expose it.
    const performerQr = await fetch(`${server.base}/qr`)
    assert.equal(performerQr.status, 404)
  } finally {
    await server.stop()
  }
})

test('tone API rejects out-of-range input and accepts valid input', async () => {
  const server = await startServer()
  try {
    await waitForHealth(server.base, 'ready')

    const bad = await fetchJson(`${server.monitorBase}/api/tone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: 17, on: true }),
    })
    assert.equal(bad.status, 400)
    assert.match(bad.body.error, /1\.\.16/)

    const badJson = await fetchJson(`${server.monitorBase}/api/tone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{oops',
    })
    assert.equal(badJson.status, 400)

    const okOn = await fetchJson(`${server.monitorBase}/api/tone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: 4, on: true }),
    })
    assert.equal(okOn.status, 200)
    assert.deepEqual(okOn.body, { ok: true })

    const okOff = await fetchJson(`${server.monitorBase}/api/tone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: 4, on: false }),
    })
    assert.equal(okOff.status, 200)
    assert.deepEqual(okOff.body, { ok: true })
  } finally {
    await server.stop()
  }
})

test('master API rejects out-of-range and accepts valid input', async () => {
  const server = await startServer()
  try {
    await waitForHealth(server.base, 'ready')

    const bad = await fetchJson(`${server.monitorBase}/api/master`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 1.5 }),
    })
    assert.equal(bad.status, 400)
    assert.match(bad.body.error, /0\.\.1/)

    const ok = await fetchJson(`${server.monitorBase}/api/master`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 0.5 }),
    })
    assert.equal(ok.status, 200)
    assert.deepEqual(ok.body, { ok: true })
  } finally {
    await server.stop()
  }
})

test('SIGTERM shuts down both HTTP servers and exits cleanly', async () => {
  const server = await startServer()
  try {
    await waitForHealth(server.base, 'ready')
    const code = await server.stop()
    assert.equal(code, 0, 'server should exit 0 after SIGTERM')

    // Ports released: a fresh listen must succeed.
    for (const port of [new URL(server.base).port, new URL(server.monitorBase).port]) {
      await new Promise((resolve, reject) => {
        const listener = net.createServer()
        listener.listen(Number(port), '127.0.0.1', () => {
          listener.close(() => resolve())
        })
        listener.on('error', reject)
      })
    }
  } finally {
    await server.stop()
  }
})
