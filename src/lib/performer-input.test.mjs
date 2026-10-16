/* global document, Event, MouseEvent */
import script from './performer-touch-script.js?raw'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const frames = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  for (const frame of frames) frame.remove()
  frames.length = 0
  vi.useRealTimers()
})
function page() {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  frames.push(frame)
  const guest = frame.contentWindow
  const doc = frame.contentDocument
  if (!guest || !doc) throw new Error('Missing test frame')
  doc.body.innerHTML = '<canvas></canvas><input />'
  runInNewContext(script, { window: guest })
  const GuestMessageEvent = Reflect.get(guest, 'MessageEvent')
  const GuestMouseEvent = Reflect.get(guest, 'MouseEvent')
  const enable = enabled =>
    guest.dispatchEvent(
      new GuestMessageEvent('message', {
        source: guest.parent,
        data: { type: 'pnds:test-touch', version: 1, enabled },
      })
    )
  const canvas = doc.querySelector('canvas')
  if (!canvas) throw new Error('Missing test canvas')
  const pointer = (type, buttons = 1, position = {}, flush = true) => {
    const event = new GuestMouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: 42,
      clientY: 63,
      buttons,
      ...position,
    })
    Object.defineProperties(event, {
      pointerType: { value: 'mouse' },
      pointerId: { value: 7 },
    })
    canvas.dispatchEvent(event)
    if (flush) vi.runOnlyPendingTimers()
  }
  return { guest, canvas, enable, pointer, doc }
}

it('keeps both native pointer faders working while mouse touch simulation is enabled', () => {
  const { canvas, enable, pointer } = page()
  const values = { left: 0, right: 0 }
  let grabbed = null
  let synthetic = 0
  canvas.addEventListener('touchstart', () => {
    synthetic++
  })
  canvas.addEventListener('pointerdown', event => {
    event.preventDefault()
    grabbed = event.clientX < 100 ? 'left' : 'right'
    values[grabbed] = event.clientY
  })
  canvas.addEventListener('pointermove', event => {
    if (!grabbed) return
    event.preventDefault()
    values[grabbed] = event.clientY
  })
  canvas.addEventListener('pointerup', () => {
    grabbed = null
  })
  enable(true)
  pointer('pointerdown')
  pointer('pointermove', 1, { clientY: 126 })
  pointer('pointerup', 0)
  pointer('pointerdown', 1, { clientX: 142 })
  pointer('pointermove', 1, { clientX: 142, clientY: 189 })
  pointer('pointerup', 0)
  expect(values).toEqual({ left: 126, right: 189 })
  expect(grabbed).toBe(null)
  expect(synthetic).toBe(0)
})

it('lets later window pointer handlers claim a gesture before adding simulated touch', () => {
  const { guest, canvas, enable, pointer } = page()
  const sequence = []
  canvas.addEventListener('touchstart', () => sequence.push('touch'))
  guest.addEventListener('pointerdown', event => {
    sequence.push(event.defaultPrevented ? 'blocked' : 'pointer')
    event.preventDefault()
  })
  enable(true)
  pointer('pointerdown')
  pointer('pointerup', 0)
  expect(sequence).toEqual(['pointer'])
})

it('discards deferred input on disable or blur before it can start a touch', () => {
  const { guest, canvas, enable, pointer } = page()
  const touches = []
  canvas.addEventListener('touchstart', () => touches.push('start'))
  enable(true)
  pointer('pointerdown', 1, {}, false)
  enable(false)
  enable(true)
  vi.runOnlyPendingTimers()
  pointer('pointerdown', 1, {}, false)
  guest.dispatchEvent(new Event('blur'))
  vi.runOnlyPendingTimers()
  expect(touches).toEqual([])
  pointer('pointerdown')
  expect(touches).toEqual(['start'])
})

it('preserves quick touch gestures and cannot cancel a new contact with an old capture release', () => {
  const { canvas, enable, pointer } = page()
  const sequence = []
  for (const type of ['touchstart', 'touchend', 'touchcancel'])
    canvas.addEventListener(type, () => sequence.push(type))
  canvas.releasePointerCapture = () =>
    pointer('lostpointercapture', 0, {}, false)
  enable(true)
  pointer('pointerdown', 1, {}, false)
  pointer('pointerup', 0, {}, false)
  pointer('pointerdown', 1, {}, false)
  vi.runAllTimers()
  expect(sequence).toEqual(['touchstart', 'touchend', 'touchstart'])
  pointer('pointercancel', 0)
  expect(sequence.at(-1)).toBe('touchcancel')
})

it('releases a gesture cancelled before deferred input is delivered', () => {
  const { canvas, enable, pointer } = page()
  const sequence = []
  for (const type of ['touchstart', 'touchcancel'])
    canvas.addEventListener(type, () => sequence.push(type))
  enable(true)
  pointer('pointerdown', 1, {}, false)
  pointer('pointercancel', 0, {}, false)
  vi.runAllTimers()
  expect(sequence).toEqual(['touchstart', 'touchcancel'])
})

it('delivers a single untrusted touch lifecycle to the page and releases it on mouse up', () => {
  const { canvas, enable, pointer } = page()
  const touches = []
  for (const name of ['touchstart', 'touchmove', 'touchend'])
    canvas.addEventListener(name, event => {
      const touch = event
      touches.push({
        type: touch.type,
        count: touch.touches.length,
        x: touch.changedTouches[0]?.clientX ?? -1,
        trusted: touch.isTrusted,
      })
    })
  pointer('pointerdown')
  expect(touches).toHaveLength(0)
  enable(true)
  pointer('pointerdown')
  pointer('pointermove')
  pointer('pointerup', 0)
  expect(touches).toEqual([
    { type: 'touchstart', count: 1, x: 42, trusted: false },
    { type: 'touchmove', count: 1, x: 42, trusted: false },
    { type: 'touchend', count: 0, x: 42, trusted: false },
  ])
})

it('cancels active simulated input on blur/disable and preserves native form input', () => {
  const { guest, canvas, enable, pointer } = page()
  let cancelled = 0
  canvas.addEventListener('touchcancel', () => {
    cancelled++
  })
  enable(true)
  pointer('pointerdown')
  guest.dispatchEvent(new Event('blur'))
  pointer('pointerdown')
  enable(false)
  expect(cancelled).toBe(2)
  enable(true)
  const input = guest.document.querySelector('input')
  if (!input) throw new Error('Missing native input')
  let synthetic = 0
  input.addEventListener('touchstart', () => {
    synthetic++
  })
  const down = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    buttons: 1,
  })
  Object.defineProperties(down, {
    pointerType: { value: 'mouse' },
    pointerId: { value: 7 },
  })
  input.dispatchEvent(down)
  expect(synthetic).toBe(0)
  expect(down.defaultPrevented).toBe(false)
})
