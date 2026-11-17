/* global process, setTimeout, clearTimeout, fetch, URL, console */
// Observe the actual generated score, adopted module, HTTP assets and recording bridge.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import path from 'node:path'
const [root, resources] = process.argv.slice(2)
const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
const { createHandFeatures } = require(
  path.join(root, 'modules/pnds-camera-handpose/camera-handpose.js')
)
const { createHandPoseAssets } = require(
  path.join(root, 'modules/pnds-camera-handpose/assets.js')
)
const catalog = require(path.join(resources, 'catalog.json'))
const shared = Object.fromEntries(
  catalog.libraries.map(item => [
    item.id,
    {
      path: path.join(resources, item.entry),
      version: item.version,
      kind: item.kind,
    },
  ])
)
const { io } = require(shared['socket.io-client'].path)
async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
const ports = [await freePort(), await freePort()]
assert.notEqual(ports[0], ports[1])
const child = spawn(process.execPath, ['server.js', '--audio-mode', 'none'], {
  cwd: root,
  env: {
    ...process.env,
    PNDS_SHARED_LIBRARIES: JSON.stringify(shared),
    PNDS_RUNTIME_PORTS: JSON.stringify({
      version: 1,
      runId: 'camera-test',
      reportPath: path.join(root, '../camera-runtime-report.json'),
      services: ['performer', 'monitor'].map((role, index) => ({
        role,
        port: ports[index],
      })),
    }),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let errors = ''
child.stderr.on('data', bytes => (errors += bytes))
const sockets = []
let monitorPage = null
const wait = async check => {
  const deadline = Date.now() + 10000
  while (!(await check())) {
    assert.equal(child.exitCode, null, errors)
    assert.ok(Date.now() < deadline, `Camera score timeout: ${errors}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
const performerOrigin = `http://127.0.0.1:${ports[0]}`
const monitorOrigin = `http://127.0.0.1:${ports[1]}`
try {
  await wait(async () => {
    try {
      return (await fetch(performerOrigin + '/__pnds/health')).ok
    } catch {
      return false
    }
  })
  const connect = async origin => {
    const socket = io(origin, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    })
    sockets.push(socket)
    const ready = once(socket, 'connect')
    socket.connect()
    await ready
    return socket
  }
  monitorPage = new JSDOM(await (await fetch(monitorOrigin)).text(), {
    url: monitorOrigin,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  monitorPage.window.fetch = relative =>
    fetch(new URL(relative, monitorOrigin + '/'))
  monitorPage.window.io = (address, options) => {
    const socket = io(address ?? monitorOrigin, {
      ...options,
      forceNew: true,
      transports: ['websocket'],
    })
    sockets.push(socket)
    return socket
  }
  for (const script of monitorPage.window.document.querySelectorAll(
    'script[src]'
  )) {
    if (script.src.includes('/socket.io/')) continue
    const response = await fetch(script.src)
    assert.equal(response.status, 200, script.src)
    monitorPage.window.eval(await response.text())
  }
  const marker = () =>
    monitorPage.window.document.querySelector('[data-camera-visual] circle')
  const attributes = () =>
    marker()
      ? Object.fromEntries(
          ['cx', 'cy', 'fill'].map(name => [name, marker().getAttribute(name)])
        )
      : null
  const monitor = await connect(monitorOrigin)
  let snapshot = null
  monitor.on('pnds:performance', value => (snapshot = value))
  const player = await connect(performerOrigin)
  const joined = once(player, 'pnds:joined')
  player.emit('pnds:join', {})
  const [identity] = await joined
  const sourceId = identity.identity.id
  const points = Array.from({ length: 21 }, (_, i) => ({
    x: i === 4 ? 10 : i === 8 ? 12 : i * 2,
    y: i === 8 ? 12 : i * 3,
    z: 0,
  }))
  const sample = {
    kind: 'camera-handpose',
    ...createHandFeatures()([{ keypoints: points }], 100, 200),
  }
  const command = async body => {
    const response = await fetch(performerOrigin + '/__pnds/recording', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const value = await response.json()
    assert.equal(response.status, 200, JSON.stringify(value))
    return value
  }
  const begin = await command({
    action: 'begin',
    operationId: 'camera-record',
    mode: 'record',
  })
  player.emit('pnds:action', sample)
  await wait(
    () => snapshot?.cameraSources?.[0]?.markers?.[0]?.color === 'pinch'
  )
  assert.equal(snapshot.cameraSources[0].sourceId, sourceId)
  await wait(() => marker()?.getAttribute('fill') === '#ef4444')
  assert.deepEqual(attributes(), { cx: '0', cy: '0', fill: '#ef4444' })
  const firstVisual = attributes()
  const moved = points.map(point => ({ ...point }))
  moved[0] = { x: 25, y: 100, z: 0 }
  moved[4] = { x: 0, y: 0, z: 0 }
  moved[8] = { x: 90, y: 100, z: 0 }
  player.emit('pnds:action', {
    kind: 'camera-handpose',
    ...createHandFeatures()([{ keypoints: moved }], 100, 200),
  })
  await wait(
    () =>
      marker()?.getAttribute('cx') === '25' &&
      marker()?.getAttribute('fill') === '#94a3b8' &&
      snapshot.cameraSources?.[0]?.markers?.[0]?.x === 0.25
  )
  assert.deepEqual(attributes(), { cx: '25', cy: '50', fill: '#94a3b8' })
  const liveVisual = attributes()
  const visible = snapshot.cameraSources[0].markers
  player.emit('pnds:action', { ...sample, hands: [{ keypoints: [] }] })
  const recorded = await command({
    action: 'end',
    operationId: 'camera-record',
    release: true,
  })
  assert.equal(
    recorded.events.filter(event => event.kind === 'action').length,
    2
  )
  await command({
    action: 'begin',
    operationId: 'camera-play',
    mode: 'playback',
    initialState: begin.initialState,
    replayPerformers: recorded.performers,
  })
  await command({
    action: 'drive',
    operationId: 'camera-play',
    elapsedMs: recorded.elapsedMs,
    events: recorded.events,
  })
  await wait(
    () =>
      snapshot?.cameraSources?.[0]?.sourceId === `replay:${sourceId}` &&
      snapshot.cameraSources?.[0]?.markers?.[0]?.x === 0.25 &&
      marker()?.getAttribute('data-source') === `replay:${sourceId}` &&
      marker()?.getAttribute('cx') === '25' &&
      marker()?.getAttribute('fill') === '#94a3b8'
  )
  assert.deepEqual(snapshot.cameraSources[0].markers, visible)
  await wait(
    () => marker()?.getAttribute('data-source') === `replay:${sourceId}`
  )
  assert.deepEqual(
    attributes(),
    liveVisual,
    'Replay must restore the real camera SVG marker'
  )
  console.log(
    JSON.stringify({
      boundary:
        'actual monitor HTML and author-saved camera SVG over real Socket.IO',
      first: firstVisual,
      live: liveVisual,
      replay: attributes(),
    })
  )
  await command({ action: 'end', operationId: 'camera-play', release: true })
  const serve = createHandPoseAssets({ ml5Path: shared.ml5.path })
  assert.equal(typeof serve, 'function')
  for (const kind of ['detector', 'landmark']) {
    const response = await fetch(
      performerOrigin +
        `/modules/pnds-camera-handpose/handpose/${kind}/group1-shard1of1.bin`
    )
    assert.equal(response.status, 200)
    assert.ok((await response.arrayBuffer()).byteLength > 1000000)
  }
  assert.equal(
    (
      await fetch(
        performerOrigin + '/modules/pnds-camera-handpose/not-public.txt'
      )
    ).status,
    404
  )
  if (process.env.PNDS_HANDPOSE_BROWSER === '1') {
    const probe = spawn(
      process.execPath,
      [
        new URL('./camera_inference.mjs', import.meta.url).pathname,
        performerOrigin,
      ],
      { stdio: 'inherit' }
    )
    const [code] = await once(probe, 'exit')
    assert.equal(code, 0, 'Real offline inference must complete')
  }
  console.log(
    'Camera: real generated project admission, accepted action, visible state, recording replay and complete offline model bytes passed'
  )
} finally {
  sockets.forEach(socket => socket.close())
  monitorPage?.window.close()
  if (child.exitCode === null && child.signalCode === null) {
    const ended = once(child, 'exit')
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    await ended
    clearTimeout(timer)
  }
}
