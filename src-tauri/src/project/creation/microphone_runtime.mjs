// The production generated page, collector, server and recording adapter run unchanged.
// Controlled Web Audio buffers prove calculation/event flow, not physical capture.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { once } from 'node:events'
const [performerPort, monitorPort, clientEntry, domEntry] =
  process.argv.slice(2)
const require = createRequire(import.meta.url)
const { io } = require(clientEntry)
const { JSDOM } = require(domEntry)
const origin = `http://127.0.0.1:${performerPort}`
const monitor = io(`http://127.0.0.1:${monitorPort}`, {
  forceNew: true,
  transports: ['websocket'],
})
let state = null,
  captures = 0,
  stopped = 0,
  amplitude = 0.5,
  decibels = -40
monitor.on('pnds:performance', value => {
  state = value
})
const deadline = setTimeout(() => {
  throw new Error('Microphone score timed out')
}, 12000)
async function until(check) {
  const end = Date.now() + 4000
  while (!check()) {
    assert.ok(
      Date.now() < end,
      `Expected microphone SVG/state change: ${JSON.stringify({ visual: visual?.(), radius: state?.microphone?.[0]?.radius })}`
    )
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
async function management(body) {
  const response = await fetch(origin + '/__pnds/recording', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  return result
}
const dom = new JSDOM(await (await fetch(origin)).text(), {
  url: origin,
  runScripts: 'outside-only',
  pretendToBeVisual: true,
})
const { window } = dom
let playerSocket = null
window.fetch = relative => fetch(new URL(relative, origin + '/'))
window.io = (address, options) =>
  (playerSocket = io(address ?? origin, {
    ...options,
    forceNew: true,
    transports: ['websocket'],
  }))
const monitorOrigin = `http://127.0.0.1:${monitorPort}`
const monitorDom = new JSDOM(await (await fetch(monitorOrigin)).text(), {
  url: monitorOrigin,
  runScripts: 'outside-only',
  pretendToBeVisual: true,
})
const rendererSockets = []
monitorDom.window.fetch = relative =>
  fetch(new URL(relative, monitorOrigin + '/'))
monitorDom.window.io = (address, options) => {
  const socket = io(address ?? monitorOrigin, {
    ...options,
    forceNew: true,
    transports: ['websocket'],
  })
  rendererSockets.push(socket)
  return socket
}
for (const script of monitorDom.window.document.querySelectorAll(
  'script[src]'
)) {
  if (script.src.includes('/socket.io/')) continue
  const response = await fetch(script.src)
  assert.equal(response.status, 200, script.src)
  monitorDom.window.eval(await response.text())
}
const visual = () => {
  const doc = monitorDom.window.document,
    circle = doc.querySelector('[data-microphone-visual] circle')
  return circle
    ? {
        radius: circle.getAttribute('r'),
        opacity: circle.getAttribute('opacity'),
        wave: doc.querySelector('[data-waveform]').getAttribute('d'),
        fft: doc.querySelector('[data-fft]').getAttribute('d'),
      }
    : null
}
Object.defineProperty(window, 'isSecureContext', { value: true })
Object.defineProperty(window.navigator, 'mediaDevices', {
  value: {
    enumerateDevices: async () => [
      {
        kind: 'audioinput',
        deviceId: 'usb-input',
        label: 'Controlled USB boundary',
      },
    ],
    getUserMedia: async () => {
      captures++
      const track = {
        stop() {
          stopped++
        },
        addEventListener() {
          /* Controlled platform boundary; no external work. */
        },
        removeEventListener() {
          /* Controlled platform boundary; no external work. */
        },
      }
      return { getTracks: () => [track] }
    },
    addEventListener() {
      /* Controlled platform boundary; no external work. */
    },
    removeEventListener() {
      /* Controlled platform boundary; no external work. */
    },
  },
})
window.AudioContext = class {
  constructor() {
    this.sampleRate = 48000
  }
  async resume() {
    /* Controlled platform boundary; no external work. */
  }
  async close() {
    /* Controlled platform boundary; no external work. */
  }
  createMediaStreamSource() {
    return {
      connect() {
        /* Controlled platform boundary; no external work. */
      },
      disconnect() {
        /* Controlled platform boundary; no external work. */
      },
    }
  }
  createAnalyser() {
    return {
      frequencyBinCount: 512,
      getFloatTimeDomainData: data => data.fill(amplitude),
      getFloatFrequencyData: data => data.fill(decibels),
      disconnect() {
        /* Controlled platform boundary; no external work. */
      },
    }
  }
  get destination() {
    throw new Error('Speaker monitoring must remain disabled')
  }
}
try {
  await until(() => state !== null)
  for (const script of window.document.querySelectorAll('script[src]')) {
    if (script.src.includes('/socket.io/')) continue
    const response = await fetch(script.src)
    assert.equal(response.status, 200, script.src)
    window.eval(await response.text())
  }
  await until(() => window.PNDS_PLAYER?.joined && window.MICROPHONE_CONTROLS)
  assert.equal(captures, 0)
  const initial = await management({
    action: 'begin',
    operationId: 'microphone-record',
    mode: 'record',
  })
  window.document.querySelector('fieldset select').value = 'usb-input'
  window.document.querySelector('fieldset button').click()
  await until(() => state.microphone?.[0]?.radius === 50)
  await until(() => visual()?.radius === '50')
  const firstVisual = visual()
  assert.ok(Number(firstVisual.opacity) > 0)
  assert.match(firstVisual.wave, /^M0 30L/)
  assert.match(firstVisual.fft, /^M0 40L/)
  assert.equal(state.microphone[0].trace[0], 0.5)
  assert.equal(state.microphone[0].spectrum[0], -40)
  assert.ok(state.microphone[0].brightness > 0)
  amplitude = 0.75
  decibels = -20
  await until(() => state.microphone?.[0]?.radius === 75)
  await until(
    () =>
      visual()?.radius === '75' &&
      visual().wave.startsWith('M0 20L') &&
      visual().fft.startsWith('M0 20L')
  )
  assert.ok(Number(visual().opacity) > Number(firstVisual.opacity))
  window.MICROPHONE_CONTROLS.input.stop()
  let live = JSON.parse(JSON.stringify(state.microphone[0]))
  assert.equal(live.trace[0], 0.75)
  assert.equal(live.spectrum[0], -20)
  // A malformed joined action is processed but never captured or applied.
  const barrier = once(playerSocket, 'pnds:state')
  playerSocket.emit('pnds:action', {
    kind: 'microphone',
    sample: { version: 1, waveform: [], fft: [] },
  })
  await barrier
  live = JSON.parse(JSON.stringify(state.microphone[0]))
  await until(() => visual()?.opacity === String(live.brightness))
  const liveVisual = visual()
  assert.deepEqual(state.microphone[0], live)
  const recorded = await management({
    action: 'end',
    operationId: 'microphone-record',
    release: true,
  })
  const events = recorded.events.filter(event => event.kind === 'action')
  assert.ok(events.length >= 2)
  assert.ok(
    events.every(
      event =>
        event.payload.sample.waveform.length === 1024 &&
        event.payload.sample.fft.length === 512
    )
  )
  assert.equal(captures, 1)
  assert.equal(stopped, 1)
  await management({
    action: 'begin',
    operationId: 'microphone-replay',
    mode: 'playback',
    initialState: initial.initialState,
    replayPerformers: recorded.performers,
  })
  await management({
    action: 'drive',
    operationId: 'microphone-replay',
    elapsedMs: Math.max(...events.map(event => event.atMs)),
    events,
  })
  await until(() => state.microphone?.[0]?.radius === 75)
  const replay = state.microphone[0]
  assert.equal(replay.sourceId, `replay:${live.sourceId}`)
  assert.deepEqual({ ...replay, sourceId: live.sourceId }, live)
  await until(
    () => visual()?.opacity === liveVisual.opacity && visual()?.radius === '75'
  )
  assert.deepEqual(
    visual(),
    liveVisual,
    'Replay must restore the actual SVG work'
  )
  assert.equal(captures, 1, 'Replay must not request microphone permission')
  await management({
    action: 'end',
    operationId: 'microphone-replay',
    release: true,
  })
  console.log(
    JSON.stringify({
      boundary:
        'actual monitor HTML and author-saved SVG renderer over real Socket.IO',
      first: {
        ...firstVisual,
        wave: firstVisual.wave.slice(0, 24),
        fft: firstVisual.fft.slice(0, 24),
      },
      live: {
        ...liveVisual,
        wave: liveVisual.wave.slice(0, 24),
        fft: liveVisual.fft.slice(0, 24),
      },
      replayMatchesLive: true,
    })
  )
  console.log(
    'Approved microphone score: four real work effects, accepted actions, recording/replay, one controlled chain and no replay capture passed; physical capture remains untested.'
  )
} finally {
  rendererSockets.forEach(socket => socket.close())
  monitorDom.window.close()
  window.MICROPHONE_CONTROLS?.dispose()
  playerSocket?.close()
  monitor.close()
  window.close()
  clearTimeout(deadline)
}
