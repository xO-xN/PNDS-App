import { createRequire } from 'node:module'
import { describe, it, expect } from 'vitest'
const require = createRequire(import.meta.url)
const {
  createDeviceMicrophone,
  connectMicrophone,
  microphoneSample,
  mountMicrophoneControls,
} = require('../../src-tauri/resources/modules/device-microphone/microphone.js')
function platform() {
  const listeners = new Map(),
    timers = new Set(),
    tracks = []
  let captures = 0,
    contexts = 0,
    closed = 0,
    resumes = 0,
    speakers = 0
  const document = {
    visibilityState: 'visible',
    addEventListener: (n, f) => listeners.set(n, f),
    removeEventListener: n => listeners.delete(n),
  }
  const env = {
    isSecureContext: true,
    document,
    addEventListener: (n, f) => listeners.set(n, f),
    removeEventListener: n => listeners.delete(n),
    setTimeout: f => {
      timers.add(f)
      return f
    },
    clearTimeout: f => timers.delete(f),
    navigator: {
      mediaDevices: {
        enumerateDevices: async () => [
          { kind: 'audioinput', deviceId: 'external', label: 'USB input' },
        ],
        getUserMedia: async () => {
          captures++
          const track = {
            stopped: false,
            stop() {
              this.stopped = true
            },
            addEventListener: (n, f) => {
              track[n] = f
            },
            removeEventListener: n => Reflect.deleteProperty(track, n),
          }
          tracks.push(track)
          return { getTracks: () => [track] }
        },
      },
    },
    AudioContext: class {
      constructor() {
        contexts++
        this.sampleRate = 48000
      }
      async resume() {
        resumes++
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
          minDecibels: -100,
          maxDecibels: -30,
          getFloatTimeDomainData: a => a.fill(0.5),
          getFloatFrequencyData: a => a.fill(-40),
          disconnect() {
            /* Controlled platform boundary; no external work. */
          },
        }
      }
      get destination() {
        speakers++
        return {}
      }
      async close() {
        closed++
      }
    },
  }
  return {
    env,
    tracks,
    timers,
    listeners,
    stats: () => ({ captures, contexts, closed, resumes, speakers }),
    tick: () => {
      const work = [...timers]
      timers.clear()
      for (const f of work) f()
    },
  }
}
describe('current-device microphone', () => {
  it('waits for explicit activation and produces all four features through one local analysis chain', async () => {
    const p = platform(),
      samples = [],
      states = []
    const mic = createDeviceMicrophone({
      environment: p.env,
      onSample: s => samples.push(s),
      onState: s => states.push(s),
    })
    expect(p.stats().captures).toBe(0)
    expect(await mic.devices()).toEqual([
      { id: 'external', label: 'USB input' },
    ])
    await mic.enable({ deviceId: 'external' })
    expect(samples[0]).toMatchObject({
      version: 1,
      peak: 0.5,
      envelope: 0.1,
      sampleRate: 48000,
      fftSize: 1024,
    })
    expect(samples[0].waveform).toHaveLength(1024)
    expect(samples[0].waveform[0]).toBe(0.5)
    expect(samples[0].fft).toHaveLength(512)
    expect(samples[0].fft[0]).toBe(-40)
    p.tick()
    expect(samples[1].envelope).toBeCloseTo(0.18)
    expect(p.stats()).toMatchObject({ captures: 1, contexts: 1, speakers: 0 })
    expect(states.at(-1).status).toBe('active')
    mic.dispose()
    expect(p.tracks[0].stopped).toBe(true)
  })
})

describe('microphone page ownership and recovery', () => {
  it('releases denied, late and switched inputs without affecting another page', async () => {
    const a = platform(),
      b = platform()
    const other = createDeviceMicrophone({ environment: b.env })
    await other.enable()
    let resolve
    a.env.navigator.mediaDevices.getUserMedia = () =>
      new Promise(done => {
        resolve = done
      })
    const mic = createDeviceMicrophone({ environment: a.env })
    const pending = mic.enable()
    mic.stop()
    const late = {
      stopped: false,
      stop() {
        this.stopped = true
      },
    }
    resolve({ getTracks: () => [late] })
    expect(await pending).toBe(false)
    expect(late.stopped).toBe(true)
    expect(a.stats().closed).toBe(1)
    expect(b.tracks[0].stopped).toBe(false)
    other.dispose()
  })
  it('rejects insecure entry and allows permission retry and explicit input switching', async () => {
    const p = platform(),
      states = []
    const mic = createDeviceMicrophone({
      environment: p.env,
      onState: s => states.push(s),
    })
    p.env.isSecureContext = false
    expect(await mic.enable()).toBe(false)
    expect(states.at(-1).status).toBe('restricted')
    expect(p.stats().captures).toBe(0)
    p.env.isSecureContext = true
    const acquire = p.env.navigator.mediaDevices.getUserMedia
    p.env.navigator.mediaDevices.getUserMedia = async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    }
    expect(await mic.enable()).toBe(false)
    expect(states.at(-1).status).toBe('denied')
    const constraints = []
    p.env.navigator.mediaDevices.getUserMedia = options => {
      constraints.push(options)
      return acquire(options)
    }
    expect(await mic.enable()).toBe(true)
    expect(await mic.enable({ deviceId: 'external' })).toBe(true)
    expect(p.tracks[0].stopped).toBe(true)
    expect(constraints[1]).toEqual({
      audio: { deviceId: { exact: 'external' } },
      video: false,
    })
    p.tracks[1].ended()
    expect(states.at(-1).status).toBe('unavailable')
    expect(p.tracks[1].stopped).toBe(true)
    mic.dispose()
  })
  it('pauses in the background and never opens input automatically on return or replay', async () => {
    const p = platform(),
      samples = [],
      states = []
    const mic = createDeviceMicrophone({
      environment: p.env,
      onSample: s => samples.push(s),
      onState: s => states.push(s),
    })
    await mic.enable()
    const late = [...p.timers][0]
    p.env.document.visibilityState = 'hidden'
    p.listeners.get('visibilitychange')()
    expect(p.tracks[0].stopped).toBe(true)
    p.env.document.visibilityState = 'visible'
    p.listeners.get('visibilitychange')()
    late()
    expect(samples).toHaveLength(1)
    expect(p.stats().captures).toBe(1)
    expect(states.at(-1).status).toBe('paused')
    mic.dispose()
    expect(p.listeners.size).toBe(0)
  })
  it('drops disconnected input and validates all four features before public event capture', async () => {
    const p = platform(),
      sent = []
    const socket = {
      connected: false,
      joined: true,
      sendAction: value => sent.push(['pnds:action', value.sample]),
    }
    const mic = connectMicrophone(socket, { environment: p.env })
    await mic.enable()
    p.tick()
    expect(sent).toHaveLength(0)
    socket.connected = true
    p.tick()
    expect(sent).toHaveLength(1)
    const accepted = microphoneSample(sent[0][1])
    expect(accepted.peak).toBe(0.5)
    expect(microphoneSample({ ...accepted, waveform: [] })).toBeNull()
    expect(
      microphoneSample({
        ...accepted,
        fft: [...accepted.fft.slice(1), Infinity],
      })
    ).toBeNull()
    expect(microphoneSample({ ...accepted, envelope: NaN })).toBeNull()
    accepted.waveform[0] = 0
    expect(sent[0][1].waveform[0]).toBe(0.5)
    mic.dispose()
  })
  it('stops an active input immediately if current-page ownership expires during activation', async () => {
    const p = platform(),
      states = []
    let owns = true
    const capture = p.env.navigator.mediaDevices.getUserMedia
    p.env.navigator.mediaDevices.getUserMedia = async options => {
      const stream = await capture(options)
      owns = false
      return stream
    }
    const mic = createDeviceMicrophone({
      environment: p.env,
      isOwner: () => owns,
      onState: s => states.push(s),
    })
    expect(await mic.enable()).toBe(false)
    expect(p.tracks[0].stopped).toBe(true)
    expect(p.stats().closed).toBe(1)
    expect(states.at(-1).status).toBe('paused')
    mic.dispose()
  })
})

it('provides explicit current-page input choices and stops only its own controls', async () => {
  const p = platform(),
    sent = []
  const document = globalThis.document
  p.env.document = document
  const container = document.createElement('section')
  document.body.append(container)
  const controls = mountMicrophoneControls({
    player: {
      connected: true,
      joined: true,
      sendAction: value => sent.push(value),
    },
    environment: p.env,
    container,
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(container.querySelector('select').options[1].textContent).toBe(
    'USB input'
  )
  expect(p.stats().captures).toBe(0)
  container.querySelector('button').click()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(sent[0].kind).toBe('microphone')
  expect(container.querySelector('[role=status]').textContent).toContain(
    'active'
  )
  controls.dispose()
  expect(p.tracks[0].stopped).toBe(true)
  expect(container.children).toHaveLength(0)
  container.remove()
})

it('refuses both native and browser projection capture even when the author predicate allows it', async () => {
  for (const projection of [
    { PNDS_MEDIA_SURFACE: { captureAllowed: false } },
    { location: { search: '?surface=venue' } },
  ]) {
    const p = platform(),
      states = []
    Object.assign(p.env, projection)
    const mic = createDeviceMicrophone({
      environment: p.env,
      isOwner: () => true,
      onState: s => states.push(s),
    })
    expect(await mic.enable()).toBe(false)
    expect(p.stats().captures).toBe(0)
    expect(states.at(-1).status).toBe('paused')
    mic.dispose()
  }
})

it('does not capture, publish or reschedule after feedback reentrantly stops activation', async () => {
  for (const phase of ['requesting', 'active']) {
    const p = platform(),
      samples = []
    const mic = createDeviceMicrophone({
      environment: p.env,
      onSample: value => samples.push(value),
      onState: value => {
        if (value.status === phase) mic.stop()
      },
    })
    expect(await mic.enable()).toBe(false)
    expect(samples).toEqual([])
    expect(p.timers.size).toBe(0)
    expect(p.stats().captures).toBe(phase === 'requesting' ? 0 : 1)
    for (const track of p.tracks) expect(track.stopped).toBe(true)
    mic.dispose()
  }
})

it('does not schedule another sample after its sample callback stops this page', async () => {
  const p = platform(),
    samples = []
  const mic = createDeviceMicrophone({
    environment: p.env,
    onSample: value => {
      samples.push(value)
      mic.stop()
    },
  })
  expect(await mic.enable()).toBe(false)
  expect(samples).toHaveLength(1)
  expect(p.timers.size).toBe(0)
  expect(p.tracks[0].stopped).toBe(true)
  mic.dispose()
})
