// Runs actual task-published pages against the unmodified generated runtime policy/recording path.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { once } from 'node:events'
const require = createRequire(import.meta.url)
const { io } = require(process.env.SOCKET_CLIENT)
const { JSDOM } = require(process.env.DOM_ENTRY)
const [performerPort, monitorPort] = JSON.parse(process.env.PNDS_FIXTURE_PORTS)
const origin = `http://127.0.0.1:${performerPort}`
const monitorOrigin = `http://127.0.0.1:${monitorPort}`
const sockets = []
const pages = []
let permissionRequests = 0
let state = null,
  revision = 0
const deadline = setTimeout(() => {
  throw new Error('Motion project timed out')
}, 12000)
async function until(predicate) {
  const end = Date.now() + 4000
  while (!predicate()) {
    assert.ok(
      Date.now() < end,
      'Expected motion business state: ' + JSON.stringify(state)
    )
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
function connect(url, options = {}) {
  const socket = io(url, { ...options, forceNew: true, reconnection: false })
  sockets.push(socket)
  return socket
}
async function page(url, performer) {
  const dom = new JSDOM(await (await fetch(url)).text(), {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  pages.push(dom)
  const window = dom.window
  window.fetch = relative => fetch(new URL(relative, url))
  window.io = (address, options) => {
    const socket = connect(address ?? url, options)
    window.transport = socket
    return socket
  }
  if (performer) {
    Object.defineProperty(window, 'isSecureContext', { value: true })
    window.DeviceOrientationEvent = {
      requestPermission: () => {
        permissionRequests++
        return Promise.resolve('granted')
      },
    }
    window.DeviceMotionEvent = {
      requestPermission: () => {
        permissionRequests++
        return Promise.resolve('granted')
      },
    }
  }
  for (const script of window.document.querySelectorAll('script[src]')) {
    if (script.src.includes('/socket.io/')) continue
    const response = await fetch(script.src)
    assert.equal(response.status, 200)
    window.eval(await response.text())
  }
  return window
}
async function management(body) {
  const response = await fetch(`${origin}/__pnds/recording`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  assert.equal(response.status, 200, await response.clone().text())
  return response.json()
}
try {
  const observer = connect(monitorOrigin)
  observer.on('pnds:performance', value => {
    state = value
    revision++
  })
  await once(observer, 'connect')
  const monitor = await page(monitorOrigin, false)
  const performer = await page(origin, true)
  await until(() => performer.PNDS_PLAYER?.joined)
  const source = performer.PNDS_PLAYER.identity.id
  assert.equal(
    performer.document.querySelector('#enable-motion').textContent,
    'Enable device motion'
  )
  const event = () => {
    const input = new performer.Event('deviceorientation')
    Object.assign(input, { beta: 30, gamma: 0 })
    performer.dispatchEvent(input)
  }
  const before = revision
  event()
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(revision, before, 'No samples before the performer enables')
  performer.document.querySelector('#enable-motion').click()
  await new Promise(resolve => setTimeout(resolve, 0))
  const seed = new performer.Event('deviceorientation')
  Object.assign(seed, { beta: 10, gamma: 5 })
  performer.dispatchEvent(seed)
  await until(() => state?.motion?.[0]?.rotation.x === 10)
  const begun = await management({
    operationId: 'motion-record',
    action: 'begin',
    mode: 'record',
  })
  await new Promise(resolve => setTimeout(resolve, 40))
  event()
  await until(() => state?.motion?.[0]?.rotation.x === 30)
  assert.equal(state.motion[0].id, source)
  await until(
    () =>
      monitor.document.querySelector('#motion-effect')?.style.transform ===
      'rotateX(30deg) rotateY(0deg)'
  )
  const acceleration = new performer.Event('devicemotion')
  Object.assign(acceleration, {
    acceleration: { x: 2, y: null, z: 0 },
    interval: 16,
  })
  performer.dispatchEvent(acceleration)
  await until(() => state.motion[0].rotation.y === 20)
  const captured = await management({
    operationId: 'motion-record',
    action: 'poll',
    afterSequence: 0,
  })
  assert.deepEqual(
    captured.events.map(item => item.kind),
    ['action', 'action']
  )
  assert.equal(captured.events[0].payload.value.gamma, 0)
  assert.equal(captured.events[1].payload.value.y, null)
  const beginState = begun.initialState
  assert.equal(beginState.motion[0].rotation.x, 10)
  await management({
    operationId: 'motion-record',
    action: 'end',
    release: true,
  })
  await until(() => state.motion.length === 0)
  const unauthorized = connect(origin)
  await once(unauthorized, 'connect')
  unauthorized.emit('pnds:action', {
    version: 1,
    kind: 'tilt',
    value: { beta: 99, gamma: 0 },
  })
  performer.PNDS_PLAYER.sendAction({
    version: 1,
    kind: 'tilt',
    value: { beta: 999, gamma: 0 },
  })
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(
    state.motion.length,
    0,
    'Unadmitted and invalid input never reaches business state'
  )
  await management({
    operationId: 'motion-replay',
    action: 'begin',
    mode: 'playback',
    initialState: beginState,
    replayPerformers: captured.performers,
  })
  await until(
    () =>
      state.motion[0]?.rotation.x === 10 && state.motion[0]?.rotation.y === 5
  )
  performer.PNDS_PLAYER.sendAction({
    version: 1,
    kind: 'tilt',
    value: { beta: 80, gamma: 0 },
  })
  await management({
    operationId: 'motion-replay',
    action: 'drive',
    elapsedMs: Math.max(...captured.events.map(item => item.atMs)),
    events: captured.events,
  })
  await until(
    () =>
      state.motion[0]?.rotation.x === 30 && state.motion[0]?.rotation.y === 20
  )
  assert.equal(state.motion[0].id, `replay:${source}`)
  await until(
    () =>
      monitor.document.querySelector('#motion-effect')?.style.transform ===
      'rotateX(30deg) rotateY(20deg)'
  )
  await management({
    operationId: 'motion-replay',
    action: 'end',
    release: true,
  })
  await until(() => state.motion.length === 0)
  assert.equal(
    permissionRequests,
    2,
    'Replay does not request motion permission'
  )
  // An offline valid sample is discarded and never flushed when this same page reconnects.
  performer.transport.disconnect()
  await until(() => !performer.PNDS_PLAYER.connected)
  await new Promise(resolve => setTimeout(resolve, 40))
  event()
  assert.equal(
    performer.PNDS_PLAYER.sendAction({
      version: 1,
      kind: 'tilt',
      value: { beta: 88, gamma: 0 },
    }),
    false
  )
  performer.transport.connect()
  await until(() => performer.PNDS_PLAYER.joined)
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(
    state.motion.length,
    0,
    'No disconnected input backlog is replayed'
  )
  // Closing the page releases listeners; no replay path called enable/requestPermission.
  performer.dispatchEvent(new performer.Event('pagehide'))
  event()
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(state.motion.length, 0)
} finally {
  clearTimeout(deadline)
  for (const socket of sockets) socket.close()
  for (const dom of pages) dom.window.close()
}
