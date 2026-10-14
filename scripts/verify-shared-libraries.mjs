#!/usr/bin/env node
// Candidate acceptance against staged, standalone resources. No App dev server or remote target.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { createSocket } from 'node:dgram'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const options = {
  out: path.join(root, 'src-tauri/resources/shared-libraries'),
  playwright: null,
}
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--out' && process.argv[i + 1])
    options.out = path.resolve(process.argv[++i])
  else if (process.argv[i] === '--playwright-module' && process.argv[i + 1])
    options.playwright = process.argv[++i]
  else if (process.argv[i] === '--browser-executable' && process.argv[i + 1])
    options.browserExecutable = process.argv[++i]
  else throw new Error(`unknown or incomplete argument: ${process.argv[i]}`)
}
execFileSync(process.execPath, [
  path.join(root, 'scripts/fetch-shared-libraries.mjs'),
  '--out',
  options.out,
  '--check',
])
const catalog = JSON.parse(
  fs.readFileSync(path.join(options.out, 'catalog.json'), 'utf8')
)
const libraries = Object.fromEntries(
  catalog.libraries.map(item => [
    item.id,
    { ...item, path: path.join(options.out, item.entry) },
  ])
)
const require = createRequire(path.join(options.out, 'node/package.json'))
const express = require(libraries.express.path)
const qrcode = require(libraries.qrcode.path)
const { Server } = require(libraries['socket.io'].path)
const { io } = require(libraries['socket.io-client'].path)
const osc = await import(pathToFileURL(libraries['osc-min'].path).href)
assert.throws(() => require('osc-min'), {
  code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
})
for (const id of ['express', 'qrcode', 'socket.io', 'socket.io-client'])
  assert.ok(await import(pathToFileURL(libraries[id].path).href))

function event(emitter, name, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const done = (...args) => {
      clearTimeout(timer)
      resolve(args)
    }
    const timer = setTimeout(() => {
      emitter.off(name, done)
      reject(new Error(`timed out: ${name}`))
    }, timeout)
    emitter.once(name, done)
  })
}
function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server.address().port)
    })
  })
}

const app = express()
const http = createServer(app)
const sockets = new Server(http)
let connections = 0
sockets.on('connection', socket => {
  connections++
  socket.emit('welcome', { source: 'offline-server' })
  socket.on('perform', (value, reply) => reply({ received: value }))
})
app.get('/lib/p5.js', (_request, response) =>
  response.sendFile(libraries.p5.path)
)
app.get('/lib/ml5.js', (_request, response) =>
  response.sendFile(libraries.ml5.path)
)
app.get('/lib/socket.io.js', (_request, response) =>
  response.sendFile(path.join(options.out, libraries['socket.io'].browserEntry))
)
app.get('/qr.png', async (_request, response, next) => {
  try {
    response
      .type('png')
      .send(await qrcode.toBuffer(`${origin}/performer?room=offline`))
  } catch (error) {
    next(error)
  }
})
app.get('/', (_request, response) =>
  response.type('html')
    .send(`<!doctype html><html><body><script src="/lib/p5.js"></script><script src="/lib/ml5.js"></script><script src="/lib/socket.io.js"></script><script>
new p5(p => { p.setup = () => { p.createCanvas(24, 24); p.background(20, 40, 60); p.noLoop(); window.canvasReady = true; }; });
const socket = io(); socket.on('welcome', value => { window.serverMessage = value; socket.emit('perform', 'browser-performer', result => { window.browserReply = result; }); });
</script></body></html>`)
)
let origin
let client
let browser
try {
  const port = await listen(http)
  origin = `http://127.0.0.1:${port}`
  const occupied = createServer()
  const occupiedError = event(occupied, 'error')
  occupied.listen(port, '127.0.0.1')
  assert.equal((await occupiedError)[0].code, 'EADDRINUSE')
  occupied.close()
  const page = await fetch(origin)
  assert.match(await page.text(), /lib\/p5.js/)
  const qr = await fetch(`${origin}/qr.png`)
  assert.equal(qr.headers.get('content-type'), 'image/png')
  assert.equal(
    Buffer.from(await qr.arrayBuffer())
      .subarray(0, 8)
      .toString('hex'),
    '89504e470d0a1a0a'
  )
  client = io(origin, {
    autoConnect: false,
    transports: ['websocket'],
    reconnectionDelay: 20,
    reconnectionAttempts: 2,
    timeout: 1000,
  })
  const welcome = event(client, 'welcome')
  client.connect()
  assert.deepEqual((await welcome)[0], { source: 'offline-server' })
  assert.deepEqual(
    await client.timeout(2000).emitWithAck('perform', 'node-performer'),
    { received: 'node-performer' }
  )
  const reconnect = event(client, 'welcome')
  for (const socket of sockets.sockets.sockets.values()) socket.conn.close()
  assert.deepEqual((await reconnect)[0], { source: 'offline-server' })
  assert.equal(connections, 2)

  const receiver = createSocket('udp4')
  const sender = createSocket('udp4')
  try {
    const bound = event(receiver, 'listening')
    receiver.bind(0, '127.0.0.1')
    await bound
    const packet = osc.toBuffer({
      address: '/pnds/verify',
      args: [
        { type: 'integer', value: 7 },
        { type: 'float', value: 0.5 },
        { type: 'string', value: 'offline' },
      ],
    })
    assert.equal(packet.constructor.name, 'DataView')
    const bytes = Buffer.from(
      packet.buffer,
      packet.byteOffset,
      packet.byteLength
    )
    // Independent OSC 1.0 representation: padded address, ,ifs tags, big-endian int/float, padded string.
    const expected =
      '2f706e64732f766572696679000000002c69667300000000000000073f0000006f66666c696e6500'
    assert.equal(bytes.toString('hex'), expected)
    const received = event(receiver, 'message')
    await new Promise((resolve, reject) =>
      sender.send(bytes, receiver.address().port, '127.0.0.1', error =>
        error ? reject(error) : resolve()
      )
    )
    const [message] = await received
    assert.equal(message.toString('hex'), expected)
    assert.equal(osc.fromBuffer(message).address, '/pnds/verify')
  } finally {
    sender.close()
    receiver.close()
  }

  const result = {
    versions: Object.fromEntries(
      catalog.libraries.map(({ id, version }) => [id, version])
    ),
    nodeCjsAndEsm: 'passed',
    httpQr: 'passed',
    socketIoBidirectionalReconnect: 'passed',
    oscUdpBytes: 'passed',
    browser: 'not requested',
    ml5Inference:
      'not verified: project model, device and sensor acceptance required',
  }
  if (options.playwright) {
    const { chromium } = require(options.playwright)
    browser = await chromium.launch({
      headless: true,
      ...(options.browserExecutable
        ? { executablePath: options.browserExecutable }
        : {}),
    })
    const context = await browser.newContext()
    const remote = []
    await context.route('**/*', route => {
      const url = route.request().url()
      if (url.startsWith(origin) || url.startsWith('data:'))
        return route.continue()
      remote.push(url)
      return route.abort()
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(origin)
    await page.waitForFunction(
      () => globalThis.canvasReady && globalThis.browserReply && globalThis.ml5
    )
    assert.deepEqual(
      await page.evaluate(() =>
        Array.from(
          globalThis.document
            .querySelector('canvas')
            .getContext('2d')
            .getImageData(0, 0, 1, 1).data
        )
      ),
      [20, 40, 60, 255]
    )
    assert.deepEqual(await page.evaluate(() => globalThis.browserReply), {
      received: 'browser-performer',
    })
    assert.deepEqual(await page.evaluate(() => globalThis.serverMessage), {
      source: 'offline-server',
    })
    assert.equal(
      await page.evaluate(() => typeof globalThis.ml5.handPose),
      'function'
    )
    assert.deepEqual(errors, [])
    assert.deepEqual(remote, [])
    await page.reload()
    await page.waitForFunction(
      () => globalThis.canvasReady && globalThis.browserReply
    )
    result.browser =
      'passed: Chromium cold HTTP page, p5 pixel, ml5 API load, browser Socket.IO reply and reload; all external requests blocked'
    result.browserVersion = browser.version()
    await context.close()
  }
  console.log(JSON.stringify(result, null, 2))
} finally {
  if (browser) await browser.close()
  client?.close()
  await new Promise(resolve => sockets.close(resolve))
  if (http.listening) await new Promise(resolve => http.close(resolve))
}
