import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { afterEach, expect, it, vi } from 'vitest'

const source = readFileSync(
  'src-tauri/resources/browser-participation/entry-gesture.js',
  'utf8'
)
const cleanups = []
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()))

function gesture({ reduced = false, accept = () => true } = {}) {
  const dom = new JSDOM(
    '<form><button type="submit" id="ball"><svg id="arrow"><use /></svg></button></form><svg><path id="band" /></svg>',
    { runScripts: 'outside-only', pretendToBeVisual: true }
  )
  const { window } = dom
  let clock = 0
  let frameId = 0
  const frames = new Map()
  const animations = []
  const captures = new WeakMap()
  const document = window.document
  const ball = document.getElementById('ball')
  const arrow = document.getElementById('arrow')
  const band = document.getElementById('band')
  window.matchMedia = () => ({ matches: reduced })
  window.performance.now = () => clock
  window.requestAnimationFrame = callback => {
    frames.set(++frameId, callback)
    return frameId
  }
  window.cancelAnimationFrame = id => frames.delete(id)
  window.Element.prototype.animate = function (keyframes, options) {
    const animation = { target: this, keyframes, options, cancel: vi.fn() }
    animation.finish = vi.fn(() => animation.onfinish?.())
    animations.push(animation)
    return animation
  }
  window.Element.prototype.setPointerCapture = function (id) {
    captures.set(this, id)
  }
  window.Element.prototype.hasPointerCapture = function (id) {
    return captures.get(this) === id
  }
  window.Element.prototype.releasePointerCapture = function () {
    captures.delete(this)
  }
  runInContext(source, dom.getInternalVMContext())
  const onConfirm = vi.fn(key => accept(key))
  const onIntent = vi.fn()
  const onLaunchEnd = vi.fn()
  const controller = window.createPndsEntryGesture({
    ball,
    arrow,
    band,
    onConfirm,
    onIntent,
    onLaunchEnd,
  })
  cleanups.push(() => {
    controller.dispose()
    window.close()
  })
  const ready = (key = 'host/project/performance') =>
    controller.update({ key, enabled: true, busy: false })
  const pointer = (type, x, y, target = window, extra = {}) => {
    const event = new window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
    })
    Object.defineProperties(event, {
      pointerId: { value: 7, configurable: true },
      pointerType: { value: 'mouse', configurable: true },
      isPrimary: { value: true, configurable: true },
      timeStamp: { value: clock, configurable: true },
    })
    for (const [key, value] of Object.entries(extra))
      Object.defineProperty(event, key, { value, configurable: true })
    target.dispatchEvent(event)
    return event
  }
  const mouse = (type, x, y, target = window) => {
    const event = new window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
    })
    Object.defineProperty(event, 'timeStamp', { value: clock })
    target.dispatchEvent(event)
    return event
  }
  const key = (value, repeat = false) => {
    const event = new window.KeyboardEvent('keydown', {
      key: value,
      repeat,
      bubbles: true,
      cancelable: true,
    })
    ball.dispatchEvent(event)
    return event
  }
  const tick = ms => {
    clock += ms
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach(callback => callback(clock))
  }
  const drag = (x, y, mode = 'pointer') => {
    if (mode === 'mouse') {
      mouse('mousedown', 100, 100, arrow.querySelector('use'))
      tick(40)
      mouse('mousemove', 100 + x, 100 + y)
      mouse('mouseup', 100 + x, 100 + y)
    } else {
      pointer('pointerdown', 100, 100, arrow.querySelector('use'))
      tick(40)
      pointer('pointermove', 100 + x, 100 + y)
      pointer('pointerup', 100 + x, 100 + y)
    }
  }
  return {
    window,
    document,
    ball,
    arrow,
    band,
    controller,
    onConfirm,
    onIntent,
    onLaunchEnd,
    animations,
    ready,
    pointer,
    mouse,
    key,
    tick,
    drag,
  }
}

it.each([
  [48, 0],
  [-48, 0],
  [0, 48],
  [0, -48],
  [34, 34],
  [-34, 34],
  [34, -34],
  [-34, -34],
])(
  'confirms one 360-degree drag (%s, %s) and fires in the opposite direction',
  (x, y) => {
    const g = gesture()
    g.ready()
    g.drag(x, y)
    expect(g.onConfirm).toHaveBeenCalledExactlyOnceWith(
      'host/project/performance'
    )
    const flight = g.animations.find(animation => animation.target === g.ball)
    const coordinates = flight.keyframes
      .at(-1)
      .transform.match(/-?[\d.]+/g)
      .map(Number)
    expect(coordinates[0] * x + coordinates[1] * y).toBeLessThan(0)
    expect(coordinates[0] * y - coordinates[1] * x).toBeCloseTo(0)
    expect(flight.keyframes.at(-1).opacity).toBe(1)
    expect(flight.options.duration).toBe(420)
    expect(Math.hypot(...coordinates)).toBeGreaterThan(
      Math.hypot(g.window.innerWidth, g.window.innerHeight)
    )
  }
)

it('signals loading only after the flight finishes and ignores an obsolete flight completion', () => {
  const g = gesture()
  g.ready()
  g.drag(48, 0)
  const flight = g.animations.find(animation => animation.target === g.ball)
  expect(g.onLaunchEnd).not.toHaveBeenCalled()
  flight.onfinish()
  expect(g.onLaunchEnd).toHaveBeenCalledExactlyOnceWith(
    'host/project/performance'
  )
  g.ready('host/project/new-performance')
  flight.onfinish()
  expect(g.onLaunchEnd).toHaveBeenCalledOnce()
})

it('settles the owned flight when the browser moves to the background', () => {
  const g = gesture()
  g.ready()
  g.drag(48, 0)
  const flight = g.animations.find(animation => animation.target === g.ball)
  Object.defineProperty(g.document, 'hidden', { value: true })
  g.document.dispatchEvent(new g.window.Event('visibilitychange'))
  expect(flight.finish).toHaveBeenCalledOnce()
  expect(g.onLaunchEnd).toHaveBeenCalledExactlyOnceWith(
    'host/project/performance'
  )
})

it('handles Safari first mouse drag when pointerdown is missing, ignoring its unpaired pointerup', () => {
  const g = gesture()
  g.ready()
  const down = g.mouse('mousedown', 100, 100, g.arrow.querySelector('use'))
  expect(down.defaultPrevented).toBe(true)
  g.tick(40)
  g.mouse('mousemove', 148, 100)
  expect(g.ball.style.transform).toBe('translate(48px, 0px)')
  g.pointer('pointerup', 148, 100)
  expect(g.onConfirm).not.toHaveBeenCalled()
  g.mouse('mouseup', 148, 100)
  expect(g.onConfirm).toHaveBeenCalledOnce()
})

it('does not count compatibility mouse events or clicks as a second gesture/form submission', () => {
  const g = gesture()
  g.ready()
  const form = g.ball.closest('form')
  const submit = vi.fn(event => event.preventDefault())
  form.addEventListener('submit', submit)
  g.pointer('pointerdown', 100, 100, g.ball)
  g.mouse('mousedown', 100, 100, g.ball)
  g.tick(40)
  g.pointer('pointermove', 148, 100)
  g.mouse('mousemove', 148, 100)
  g.pointer('pointerup', 148, 100)
  g.mouse('mouseup', 148, 100)
  const click = new g.window.MouseEvent('click', {
    detail: 1,
    bubbles: true,
    cancelable: true,
  })
  g.ball.dispatchEvent(click)
  expect(click.defaultPrevented).toBe(true)
  expect(submit).not.toHaveBeenCalled()
  expect(g.onConfirm).toHaveBeenCalledOnce()
})

it('cancels tiny, slow pulls but permits an intentional 8px flick and the 18px distance boundary', () => {
  for (const [distance, elapsed, expected] of [
    [2, 40, 0],
    [17, 200, 0],
    [18, 200, 1],
    [8, 20, 1],
    [7.9, 20, 0],
    [8, 80, 0],
    [8, 7, 0],
  ]) {
    const g = gesture()
    g.ready()
    g.pointer('pointerdown', 100, 100, g.ball)
    g.tick(elapsed)
    g.pointer('pointermove', 100 + distance, 100)
    g.pointer('pointerup', 100 + distance, 100)
    expect(g.onConfirm).toHaveBeenCalledTimes(expected)
    if (!expected) {
      expect(g.onIntent).toHaveBeenLastCalledWith({
        armed: false,
        dragging: false,
        light: true,
      })
      g.tick(600)
      expect(g.ball.style.transform).toBe('translate(0px, 0px)')
    }
  }
})

it.each([
  'key',
  'busy',
  'disabled',
  'blur',
  'cancel',
  'hidden',
  'escape',
  'dispose',
])('cannot confirm a gesture after %s invalidates it', condition => {
  const g = gesture()
  g.ready()
  g.pointer('pointerdown', 100, 100, g.ball)
  g.tick(40)
  g.pointer('pointermove', 148, 100)
  if (condition === 'key') g.ready('host/project/new-performance')
  if (condition === 'busy')
    g.controller.update({
      key: 'host/project/performance',
      enabled: true,
      busy: true,
    })
  if (condition === 'disabled')
    g.controller.update({
      key: 'host/project/performance',
      enabled: false,
      busy: false,
    })
  if (condition === 'blur') g.window.dispatchEvent(new g.window.Event('blur'))
  if (condition === 'cancel') g.pointer('pointercancel', 148, 100)
  if (condition === 'hidden') {
    Object.defineProperty(g.document, 'hidden', { value: true })
    g.document.dispatchEvent(new g.window.Event('visibilitychange'))
  }
  if (condition === 'escape') g.key('Escape')
  if (condition === 'dispose') g.controller.dispose()
  g.pointer('pointerup', 148, 100)
  g.mouse('mouseup', 148, 100)
  expect(g.onConfirm).not.toHaveBeenCalled()
})

it('plays the initial arrow hint only once per displayed identity and stops it when dragging', () => {
  const g = gesture()
  g.ready()
  const hint = g.animations[0]
  expect(hint.options.duration).toBe(680)
  expect(hint.keyframes.map(value => value.transform)).toEqual([
    'rotate(0deg)',
    'rotate(-24deg)',
    'rotate(24deg)',
    'rotate(-12deg)',
    'rotate(8deg)',
    'rotate(0deg)',
  ])
  g.ready()
  g.ready()
  expect(g.animations).toHaveLength(1)
  g.pointer('pointerdown', 100, 100, g.ball)
  expect(hint.cancel).toHaveBeenCalled()
  g.pointer('pointercancel', 100, 100)
  g.ready()
  expect(g.animations).toHaveLength(1)
  g.ready('host/project/new-performance')
  expect(g.animations).toHaveLength(2)
})

it('preserves the release vector when confirmation synchronously marks the entry busy', () => {
  let g
  g = gesture({
    accept: key => {
      g.controller.update({ key, enabled: false, busy: true })
      return true
    },
  })
  g.ready()
  g.drag(48, 0)
  const flight = g.animations.find(animation => animation.target === g.ball)
  expect(flight.keyframes[0].transform).toBe('translate(48px,0px)')
  const cancelled = flight.cancel.mock.calls.length
  g.controller.update({
    key: 'host/project/performance',
    enabled: false,
    busy: true,
  })
  expect(flight.cancel).toHaveBeenCalledTimes(cancelled)
  expect(g.ball.disabled).toBe(true)
  g.ready()
  expect(flight.cancel).toHaveBeenCalledTimes(cancelled + 1)
  expect(g.ball.disabled).toBe(false)
  expect(g.arrow.style.transform).toBe('rotate(0deg)')
})

it('returns home when the owner rejects confirmation and fences identity changes during its callback', () => {
  const rejected = gesture({ accept: () => false })
  rejected.ready()
  rejected.drag(48, 0)
  expect(
    rejected.animations.filter(animation => animation.target === rejected.ball)
  ).toHaveLength(0)
  rejected.tick(600)
  expect(rejected.ball.disabled).toBe(false)
  expect(rejected.ball.style.transform).toBe('translate(0px, 0px)')
  let changed
  changed = gesture({
    accept: () => {
      changed.ready('host/project/new-performance')
      return true
    },
  })
  changed.ready()
  changed.drag(48, 0)
  expect(
    changed.animations.filter(animation => animation.target === changed.ball)
  ).toHaveLength(0)
})

it.each(['Enter', ' '])(
  'supports %s without a duplicate keyboard click confirmation',
  value => {
    const g = gesture()
    g.ready()
    const event = g.key(value)
    expect(event.defaultPrevented).toBe(true)
    g.key(value, true)
    const click = new g.window.MouseEvent('click', {
      detail: 0,
      bubbles: true,
      cancelable: true,
    })
    g.ball.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(g.onConfirm).toHaveBeenCalledOnce()
  }
)

it('accepts assistive activation while ignoring an ordinary click without a drag', () => {
  const g = gesture()
  g.ready()
  const ordinary = new g.window.MouseEvent('click', {
    detail: 1,
    bubbles: true,
    cancelable: true,
  })
  g.ball.dispatchEvent(ordinary)
  expect(ordinary.defaultPrevented).toBe(true)
  expect(g.onConfirm).not.toHaveBeenCalled()
  g.ball.dispatchEvent(
    new g.window.MouseEvent('click', {
      detail: 0,
      bubbles: true,
      cancelable: true,
    })
  )
  expect(g.onConfirm).toHaveBeenCalledOnce()
})

it('keeps the requested launch in reduced motion while omitting the decorative arrow hint', () => {
  const g = gesture({ reduced: true })
  g.ready()
  expect(g.animations).toHaveLength(0)
  expect(g.arrow.style.transform).toBe('rotate(0deg)')
  g.drag(48, 0)
  expect(g.onConfirm).toHaveBeenCalledOnce()
  expect(g.animations).toHaveLength(1)
  expect(g.onLaunchEnd).not.toHaveBeenCalled()
  const flight = g.animations[0]
  expect(flight.target).toBe(g.ball)
  expect(flight.options.duration).toBe(420)
  flight.onfinish()
  expect(g.onLaunchEnd).toHaveBeenCalledExactlyOnceWith(
    'host/project/performance'
  )
})

it('disposes without calling the former owner and ignores all later input', () => {
  const g = gesture()
  g.ready()
  g.pointer('pointerdown', 100, 100, g.ball)
  g.tick(40)
  g.pointer('pointermove', 148, 100)
  g.onIntent.mockClear()
  g.controller.dispose()
  expect(g.onIntent).not.toHaveBeenCalled()
  g.pointer('pointerup', 148, 100)
  g.mouse('mousedown', 100, 100, g.ball)
  g.mouse('mousemove', 148, 100)
  g.mouse('mouseup', 148, 100)
  g.key('Enter')
  expect(g.onConfirm).not.toHaveBeenCalled()
  expect(g.ball.disabled).toBe(true)
})

it('cancels Safari fallback on blur and ignores its late mouseup', () => {
  const g = gesture()
  g.ready()
  g.mouse('mousedown', 100, 100, g.ball)
  g.tick(40)
  g.mouse('mousemove', 148, 100)
  g.window.dispatchEvent(new g.window.Event('blur'))
  g.mouse('mouseup', 148, 100)
  g.tick(600)
  expect(g.onConfirm).not.toHaveBeenCalled()
  expect(g.ball.style.transform).toBe('translate(0px, 0px)')
})

it('does not let an old pointerup confirm a newer grip that reuses the pointer id', () => {
  const g = gesture()
  g.ready()
  g.pointer('pointerdown', 100, 100, g.ball)
  g.tick(40)
  g.pointer('pointercancel', 100, 100)
  g.tick(20)
  g.pointer('pointerdown', 100, 100, g.ball)
  g.tick(40)
  g.pointer('pointermove', 148, 100)
  g.pointer('pointerup', 148, 100, g.window, { timeStamp: 40 })
  expect(g.onConfirm).not.toHaveBeenCalled()
  g.pointer('pointerup', 148, 100)
  expect(g.onConfirm).toHaveBeenCalledOnce()
})
