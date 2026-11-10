import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  createDeviceMotion,
  normalizeMotion,
} = require('../../src-tauri/resources/modules/device-motion/device-motion.js')

function page(overrides = {}) {
  const target = new globalThis.EventTarget()
  const document = new globalThis.EventTarget()
  document.hidden = false
  Object.assign(target, {
    document,
    isSecureContext: true,
    DeviceMotionEvent: {},
    DeviceOrientationEvent: {},
    setTimeout,
    clearTimeout,
    performance: { now: () => 100 },
    ...overrides,
  })
  return target
}
function sample(target, type, values) {
  const event = new globalThis.Event(type)
  Object.assign(event, values)
  target.dispatchEvent(event)
}

describe('device motion in the actual optional module', () => {
  it('distinguishes real zero from missing fields and does not manufacture samples before enable', async () => {
    const target = page()
    const received = []
    const motion = createDeviceMotion({
      target,
      onSample: value => received.push(value),
    })
    sample(target, 'deviceorientation', { beta: 0, gamma: null })
    expect(received).toEqual([])
    await motion.enable()
    sample(target, 'deviceorientation', { beta: 0, gamma: null })
    expect(received).toEqual([
      { version: 1, kind: 'tilt', value: { beta: 0, gamma: null } },
    ])
    sample(target, 'devicemotion', {
      acceleration: { x: 0, y: null },
      interval: 16,
    })
    expect(received.at(-1)).toEqual({
      version: 1,
      kind: 'acceleration',
      value: { x: 0, y: null, z: null },
      intervalMs: 16,
    })
    expect(motion.state.status).toBe('active')
    motion.stop()
    sample(target, 'deviceorientation', { beta: 30, gamma: 10 })
    expect(received).toHaveLength(2)
  })
})

it('makes permission denial retryable and fences a permission reply after stop', async () => {
  let resolve
  const permission = vi
    .fn()
    .mockResolvedValueOnce('denied')
    .mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done
        })
    )
    .mockResolvedValue('granted')
  const target = page({
    DeviceOrientationEvent: { requestPermission: permission },
    DeviceMotionEvent: undefined,
  })
  const received = []
  const motion = createDeviceMotion({
    target,
    onSample: value => received.push(value),
  })
  expect(await motion.enable()).toBe(false)
  expect(motion.state.status).toBe('denied')
  const enabling = motion.enable()
  motion.stop()
  resolve('granted')
  expect(await enabling).toBe(false)
  sample(target, 'deviceorientation', { beta: 12, gamma: 0 })
  expect(received).toEqual([])
  expect(motion.state.status).toBe('stopped')
  expect(await motion.enable()).toBe(true)
  sample(target, 'deviceorientation', { beta: 12, gamma: 0 })
  expect(received).toHaveLength(1)
  motion.dispose()
})

it('reports unavailable and insecure entries, and no data without inventing zero', async () => {
  for (const [overrides, status] of [
    [{ isSecureContext: false }, 'restricted'],
    [
      { DeviceMotionEvent: undefined, DeviceOrientationEvent: undefined },
      'unavailable',
    ],
  ]) {
    const motion = createDeviceMotion({ target: page(overrides) })
    expect(await motion.enable()).toBe(false)
    expect(motion.state.status).toBe(status)
    motion.dispose()
  }
  vi.useFakeTimers()
  try {
    const target = page()
    const received = []
    const motion = createDeviceMotion({
      target,
      onSample: value => received.push(value),
    })
    await motion.enable()
    sample(target, 'deviceorientation', { beta: null, gamma: undefined })
    sample(target, 'devicemotion', {
      acceleration: null,
      accelerationIncludingGravity: null,
    })
    await vi.advanceTimersByTimeAsync(1500)
    expect(motion.state.status).toBe('no-data')
    expect(received).toEqual([])
    motion.dispose()
  } finally {
    vi.useRealTimers()
  }
})

it('releases listeners in the background and requires a new explicit enable, with no buffered samples', async () => {
  const target = page()
  const received = []
  const motion = createDeviceMotion({
    target,
    onSample: value => received.push(value),
  })
  await motion.enable()
  sample(target, 'deviceorientation', { beta: 10, gamma: 1 })
  target.document.hidden = true
  target.document.dispatchEvent(new globalThis.Event('visibilitychange'))
  sample(target, 'deviceorientation', { beta: 20, gamma: 2 })
  target.document.hidden = false
  target.document.dispatchEvent(new globalThis.Event('visibilitychange'))
  sample(target, 'deviceorientation', { beta: 30, gamma: 3 })
  expect(received).toHaveLength(1)
  expect(motion.state.status).toBe('suspended')
  await motion.enable()
  sample(target, 'deviceorientation', { beta: 40, gamma: 4 })
  expect(received.map(item => item.value.beta)).toEqual([10, 40])
  target.dispatchEvent(new globalThis.Event('pagehide'))
  sample(target, 'deviceorientation', { beta: 50, gamma: 5 })
  expect(received).toHaveLength(2)
  motion.dispose()
  expect(await motion.enable()).toBe(false)
})

it('bounds updates to 30 Hz per signal and validates accepted feature payloads', async () => {
  let now = 0
  const target = page({ performance: { now: () => now } })
  const received = []
  const motion = createDeviceMotion({
    target,
    onSample: value => received.push(value),
  })
  await motion.enable()
  sample(target, 'deviceorientation', { beta: 0, gamma: 0 })
  now = 10
  sample(target, 'deviceorientation', { beta: 1, gamma: 1 })
  now = 40
  sample(target, 'deviceorientation', { beta: 2, gamma: 2 })
  expect(received.map(item => item.value.beta)).toEqual([0, 2])
  for (const input of [
    null,
    {},
    { version: 1, kind: 'tilt', value: { beta: '0' } },
    { version: 1, kind: 'tilt', value: { gamma: 91 } },
    { version: 1, kind: 'acceleration', value: { x: Infinity } },
    { version: 1, kind: 'tilt', value: { beta: 0 }, intervalMs: -1 },
  ])
    expect(normalizeMotion(input)).toBeNull()
  expect(
    normalizeMotion({ version: 1, kind: 'gravity', value: { z: 9.81, x: 0 } })
  ).toEqual({ version: 1, kind: 'gravity', value: { x: 0, y: null, z: 9.81 } })
  motion.dispose()
})

it('keeps projection and retired owners from requesting permission or publishing late samples', async () => {
  const requestPermission = vi.fn().mockResolvedValue('granted')
  for (const overrides of [
    { PNDS_MEDIA_SURFACE: { captureAllowed: false } },
    { location: { search: '?surface=venue' } },
  ]) {
    const motion = createDeviceMotion({
      target: page({ ...overrides, DeviceMotionEvent: { requestPermission } }),
    })
    expect(await motion.enable()).toBe(false)
    expect(motion.state.status).toBe('restricted')
    motion.dispose()
  }
  expect(requestPermission).not.toHaveBeenCalled()
  let owner = true
  const target = page()
  const received = []
  const motion = createDeviceMotion({
    target,
    isOwner: () => owner,
    onSample: value => received.push(value),
  })
  await motion.enable()
  owner = false
  sample(target, 'deviceorientation', { beta: 0, gamma: 0 })
  expect(received).toEqual([])
  expect(motion.state.status).toBe('suspended')
  motion.dispose()
})

it('does not request permission or publish samples after a reentrant feedback stop', async () => {
  const permission = vi.fn().mockResolvedValue('granted')
  for (const phase of ['requesting', 'waiting', 'active']) {
    const target = page({
      DeviceOrientationEvent: { requestPermission: permission },
      DeviceMotionEvent: undefined,
    })
    const received = []
    const motion = createDeviceMotion({
      target,
      onSample: value => received.push(value),
      onState: value => {
        if (value.status === phase) motion.stop()
      },
    })
    const enabled = await motion.enable()
    if (phase !== 'active') expect(enabled).toBe(false)
    sample(target, 'deviceorientation', { beta: 0, gamma: 0 })
    expect(received).toEqual([])
    expect(motion.state.status).toBe('stopped')
    motion.dispose()
  }
  expect(permission).toHaveBeenCalledTimes(2)
})
