/* global document, Event, MouseEvent */
import script from './performer-touch-script.js?raw'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it } from 'vitest'

const frames = []
afterEach(() => {
  for (const frame of frames) frame.remove()
  frames.length = 0
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
  const pointer = (type, buttons = 1) => {
    const event = new GuestMouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: 42,
      clientY: 63,
      buttons,
    })
    Object.defineProperties(event, {
      pointerType: { value: 'mouse' },
      pointerId: { value: 7 },
    })
    canvas.dispatchEvent(event)
  }
  return { guest, canvas, enable, pointer, doc }
}

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
