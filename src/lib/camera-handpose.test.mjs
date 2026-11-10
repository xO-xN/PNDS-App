/* global EventTarget, document */
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
const require = createRequire(import.meta.url)
const camera = () =>
  require('../../src-tauri/resources/modules/camera-handpose/camera-handpose.js')
const points = () =>
  Array.from({ length: 21 }, (_, i) => ({
    x: i === 4 ? 10 : i === 8 ? 12 : i * 2,
    y: i === 8 ? 12 : i * 3,
    z: 0,
  }))
describe('camera HandPose features used by a score', () => {
  it('normalizes a genuine result and emits pinch edges once, including hand loss', () => {
    const { createHandFeatures } = camera()
    const derive = createHandFeatures()
    const hands = [{ keypoints: points(), handedness: 'Left' }]
    const first = derive(hands, 100, 200)
    expect(first.hands[0].keypoints[4]).toEqual({ x: 0.1, y: 0.06, z: 0 })
    expect(first.actions).toEqual([{ hand: 0, type: 'pinch-start' }])
    expect(derive(hands, 100, 200).actions).toEqual([])
    expect(derive([], 100, 200).actions).toEqual([
      { hand: 0, type: 'pinch-end' },
    ])
  })
  it('rejects malformed landmarks instead of manufacturing recognition', () => {
    const derive = camera().createHandFeatures()
    expect(() => derive([{ keypoints: [] }], 100, 100)).toThrow()
    expect(() => derive([], 0, 100)).toThrow()
  })
})

describe('accepted camera work state', () => {
  it('validates used landmarks and restores the same visible marker through replay', () => {
    const {
      createHandPoseWork,
    } = require('../../src-tauri/resources/modules/camera-handpose/work.js')
    const work = createHandPoseWork()
    const sample = {
      kind: 'camera-handpose',
      ...camera().createHandFeatures()([{ keypoints: points() }], 100, 200),
    }
    const accepted = work.prepareAction(sample)
    expect(accepted).not.toBeNull()
    expect(
      work.prepareAction({ ...sample, hands: [{ keypoints: [] }] })
    ).toBeNull()
    work.applyWork({ sourceId: 'p1', kind: 'action', payload: accepted })
    expect(work.snapshotWork().cameraSources[0].markers[0]).toEqual({
      x: 0,
      y: 0,
      color: 'pinch',
    })
    const saved = work.snapshotWork()
    work.releaseWork()
    work.restoreWork(saved, [{ id: 'p1' }])
    expect(work.snapshotWork().cameraSources[0].sourceId).toBe('replay:p1')
    expect(work.snapshotWork().cameraSources[0].markers).toEqual(
      saved.cameraSources[0].markers
    )
  })
})

describe('page-owned camera activation', () => {
  const platform = media => {
    const page = new EventTarget()
    page.hidden = false
    const owner = new EventTarget()
    return Object.assign(owner, {
      document: page,
      location: { href: 'https://score.test/', origin: 'https://score.test' },
      isSecureContext: true,
      navigator: { mediaDevices: media },
      HandPoseWorkerClient: { supported: () => true },
      cancelAnimationFrame() {
        /* Controlled platform callback. */
      },
    })
  }
  it('releases a late authorization after this page stops, without changing a newer state', async () => {
    let resolve
    let stopped = 0
    const media = {
      getUserMedia: () =>
        new Promise(done => {
          resolve = done
        }),
    }
    const states = []
    const owner = camera().createCameraHandPose({
      video: {},
      baseUrl: '/modules/pnds-camera-handpose/',
      onSample() {
        /* Controlled platform callback. */
      },
      onState: value => states.push(value.phase),
      platform: platform(media),
    })
    const pending = owner.start()
    owner.stop()
    resolve({
      getTracks: () => [
        {
          stop() {
            stopped++
          },
        },
      ],
    })
    expect(await pending).toBe(false)
    expect(stopped).toBe(1)
    expect(states).toEqual(['requesting-camera', 'stopped'])
    owner.dispose()
  })
  it('projection and ordinary HTTP never request camera access', async () => {
    let requests = 0
    const env = platform({
      getUserMedia: () => {
        requests++
        throw new Error('must not capture')
      },
    })
    env.PNDS_MEDIA_SURFACE = { captureAllowed: false }
    const owner = camera().createCameraHandPose({
      video: {},
      baseUrl: '/modules/pnds-camera-handpose/',
      onSample() {
        /* Controlled platform callback. */
      },
      platform: env,
    })
    expect(await owner.start()).toBe(false)
    env.PNDS_MEDIA_SURFACE = { captureAllowed: true }
    env.isSecureContext = false
    expect(await owner.start()).toBe(false)
    expect(requests).toBe(0)
    owner.dispose()
  })
})

it('does not repeat a discrete action when two identified hands swap detector order', () => {
  const derive = camera().createHandFeatures()
  const left = { keypoints: points(), handedness: 'Left' }
  const right = { keypoints: points(), handedness: 'Right' }
  expect(derive([left, right], 100, 200).actions).toHaveLength(2)
  expect(derive([right, left], 100, 200).actions).toEqual([])
})

it('settles start when stopped while waiting for the first camera frame', async () => {
  const doc = new EventTarget()
  doc.hidden = false
  const ownerEvents = new EventTarget()
  let releases = 0
  const env = Object.assign(ownerEvents, {
    document: doc,
    location: { href: 'https://score.test/', origin: 'https://score.test' },
    isSecureContext: true,
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [
            {
              stop() {
                releases++
              },
              addEventListener() {
                /* Controlled platform callback. */
              },
            },
          ],
        }),
      },
    },
    HandPoseWorkerClient: { supported: () => true },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {
      /* Controlled platform callback. */
    },
  })
  const owner = camera().createCameraHandPose({
    video: {
      play: async () => {
        /* Controlled platform callback. */
      },
      readyState: 0,
    },
    baseUrl: '/modules/pnds-camera-handpose/',
    onSample() {
      /* Controlled platform callback. */
    },
    platform: env,
  })
  const pending = owner.start()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  owner.stop()
  expect(await pending).toBe(false)
  expect(releases).toBe(1)
  owner.dispose()
})

it('releases only its own model and stream when ownership changes during model loading', async () => {
  let resolveModel,
    releases = 0,
    disposals = 0,
    owns = true
  const doc = new EventTarget()
  doc.hidden = false
  const env = Object.assign(new EventTarget(), {
    document: doc,
    location: { href: 'https://score.test/', origin: 'https://score.test' },
    isSecureContext: true,
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [
            {
              stop() {
                releases++
              },
              addEventListener() {
                /* Controlled platform callback. */
              },
            },
          ],
        }),
      },
    },
    HandPoseWorkerClient: {
      supported: () => true,
      createModel: () => ({
        ready: new Promise(resolve => {
          resolveModel = resolve
        }),
        dispose() {
          disposals++
        },
      }),
    },
    performance: { now: () => 0 },
    cancelAnimationFrame() {
      /* Controlled platform callback. */
    },
  })
  const owner = camera().createCameraHandPose({
    video: {
      play: async () => {
        /* Controlled platform callback. */
      },
      readyState: 2,
      videoWidth: 64,
      videoHeight: 64,
    },
    baseUrl: '/modules/pnds-camera-handpose/',
    onSample() {
      /* Controlled platform callback. */
    },
    isOwner: () => owns,
    platform: env,
  })
  const pending = owner.start()
  for (let i = 0; i < 6; i++) await Promise.resolve()
  owns = false
  resolveModel()
  expect(await pending).toBe(false)
  expect(releases).toBe(1)
  expect(disposals).toBe(1)
  owner.dispose()
})

it('keeps project camera controls inert until enable and sends only admitted current-page samples', async () => {
  const doc = document.implementation.createHTMLDocument('camera-work')
  Object.defineProperty(doc, 'hidden', { value: false })
  let captures = 0,
    stops = 0
  const sent = []
  const phases = []
  const env = Object.assign(new EventTarget(), {
    document: doc,
    location: { href: 'https://score.test/', origin: 'https://score.test' },
    isSecureContext: true,
    navigator: {
      mediaDevices: {
        getUserMedia: async () => {
          captures++
          return {
            getTracks: () => [
              {
                stop() {
                  stops++
                },
                addEventListener() {
                  /* Browser track event seam. */
                },
              },
            ],
          }
        },
        enumerateDevices: async () => [
          { kind: 'videoinput', deviceId: 'usb-camera', label: 'USB camera' },
        ],
      },
    },
    HandPoseWorkerClient: {
      supported: () => true,
      createModel: () => ({
        ready: Promise.resolve(),
        detect: async () => ({ hands: [], width: 64, height: 64 }),
        dispose() {
          /* Worker boundary. */
        },
      }),
    },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {
      /* Controlled scheduler. */
    },
  })
  const controls = camera().mountCameraControls({
    element: doc.body,
    baseUrl: '/modules/pnds-camera-handpose/',
    canSend: () => true,
    onState: value => phases.push(value),
    send: value => sent.push(value),
    messages: {
      enable: 'Enable camera',
      stop: 'Stop camera',
      input: 'Input',
      front: 'Front',
      back: 'Back',
      unnamed: 'Camera',
    },
    platform: env,
  })
  const video = doc.querySelector('video')
  Object.defineProperties(video, {
    readyState: { value: 2 },
    videoWidth: { value: 64 },
    videoHeight: { value: 64 },
    play: {
      value: async () => {
        /* Real video API boundary. */
      },
    },
  })
  expect(captures).toBe(0)
  doc.querySelector('button').click()
  await vi.waitFor(() =>
    expect(sent, JSON.stringify(phases)).toEqual([
      { kind: 'camera-handpose', hands: [], actions: [] },
    ])
  )
  expect(captures).toBe(1)
  expect(doc.querySelector('select').textContent).toContain('USB camera')
  doc.querySelectorAll('button')[1].click()
  expect(stops).toBe(1)
  controls.dispose()
})

it('does not create a model when frame-ready feedback stops this activation reentrantly', async () => {
  const doc = new EventTarget()
  doc.hidden = false
  let capturesStopped = 0,
    models = 0,
    disposed = 0
  const env = Object.assign(new EventTarget(), {
    document: doc,
    location: { href: 'https://score.test/', origin: 'https://score.test' },
    isSecureContext: true,
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [
            {
              stop() {
                capturesStopped++
              },
              addEventListener() {
                /* Browser track. */
              },
            },
          ],
        }),
      },
    },
    HandPoseWorkerClient: {
      supported: () => true,
      createModel: () => {
        models++
        return {
          ready: Promise.resolve(),
          dispose() {
            disposed++
          },
        }
      },
    },
    performance: { now: () => 0 },
    cancelAnimationFrame() {
      /* Controlled scheduler. */
    },
  })
  const owner = camera().createCameraHandPose({
    video: {
      play: async () => {
        /* Video boundary. */
      },
      readyState: 2,
      videoWidth: 64,
      videoHeight: 64,
    },
    baseUrl: '/modules/pnds-camera-handpose/',
    onSample() {
      /* No sample after stop. */
    },
    onState: value => {
      if (value.phase === 'frame-ready') owner.stop()
    },
    platform: env,
  })
  expect(await owner.start()).toBe(false)
  expect(models).toBe(0)
  expect(disposed).toBe(0)
  expect(capturesStopped).toBe(1)
  owner.dispose()
})

it('retires a worker created across synchronous progress feedback and suppresses stopped inference output', async () => {
  for (const phase of [
    'requesting-camera',
    'loading-runtime',
    'inference-ready',
  ]) {
    const doc = new EventTarget()
    doc.hidden = false
    let captures = 0,
      stops = 0,
      models = 0,
      disposed = 0,
      samples = 0,
      scheduled = 0
    const env = Object.assign(new EventTarget(), {
      document: doc,
      location: { href: 'https://score.test/', origin: 'https://score.test' },
      isSecureContext: true,
      navigator: {
        mediaDevices: {
          getUserMedia: async () => {
            captures++
            return {
              getTracks: () => [
                {
                  stop() {
                    stops++
                  },
                  addEventListener() {
                    /* Browser track. */
                  },
                },
              ],
            }
          },
        },
      },
      HandPoseWorkerClient: {
        supported: () => true,
        createModel(_config, options) {
          models++
          const result = {
            ready: Promise.resolve(),
            detect: async () => ({ hands: [], width: 64, height: 64 }),
            dispose() {
              disposed++
            },
          }
          options.onProgress('loading-runtime')
          return result
        },
      },
      performance: { now: () => 0 },
      requestAnimationFrame() {
        scheduled++
        return 1
      },
      cancelAnimationFrame() {
        /* Controlled scheduler. */
      },
    })
    const owner = camera().createCameraHandPose({
      video: {
        play: async () => {
          /* Video boundary. */
        },
        readyState: 2,
        videoWidth: 64,
        videoHeight: 64,
      },
      baseUrl: '/modules/pnds-camera-handpose/',
      onSample() {
        samples++
      },
      onState: value => {
        if (value.phase === phase) owner.stop()
      },
      platform: env,
    })
    await owner.start()
    for (let index = 0; index < 4; index++) await Promise.resolve()
    expect(samples).toBe(0)
    expect(scheduled).toBe(0)
    expect(captures).toBe(phase === 'requesting-camera' ? 0 : 1)
    expect(models).toBe(phase === 'requesting-camera' ? 0 : 1)
    expect(disposed).toBe(models)
    expect(stops).toBe(captures)
    owner.dispose()
  }
})
