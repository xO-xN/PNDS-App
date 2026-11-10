import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const html = readFileSync('docs/prototypes/performer-entry-pond.html', 'utf8')
const windows = []

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  windows.splice(0).forEach(window => window.close())
  vi.clearAllTimers()
  vi.useRealTimers()
})

function openPrototype(search = '') {
  const dom = new JSDOM(html, {
    url: `http://localhost/docs/prototypes/performer-entry-pond.html${search}`,
    runScripts: 'outside-only',
  })
  const { window } = dom
  windows.push(window)
  window.matchMedia = () => ({ matches: false })
  window.setTimeout = setTimeout
  window.clearTimeout = clearTimeout
  window.requestAnimationFrame = callback =>
    setTimeout(() => callback(globalThis.performance.now()), 16)
  window.cancelAnimationFrame = clearTimeout
  window.Element.prototype.animate = vi.fn(() => ({ cancel: vi.fn() }))
  window.Element.prototype.getAnimations = () => []
  // jsdom does not reflect inert yet; the real browser uses its attribute
  // when excluding faded controls from the modal focus cycle.
  Object.defineProperty(window.HTMLElement.prototype, 'inert', {
    get() {
      return this.hasAttribute('inert')
    },
    set(value) {
      this.toggleAttribute('inert', value)
    },
  })
  const captures = new WeakMap()
  window.Element.prototype.setPointerCapture = function (id) {
    captures.set(this, id)
  }
  window.Element.prototype.hasPointerCapture = function (id) {
    return captures.get(this) === id
  }
  window.Element.prototype.releasePointerCapture = function () {
    captures.delete(this)
  }
  runInContext(
    window.document.querySelector('script:not([type])').textContent,
    dom.getInternalVMContext()
  )
  const get = id => window.document.getElementById(id)
  const mouse = (target, type, x, y, buttons = 1) =>
    target.dispatchEvent(
      new window.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons,
        clientX: x,
        clientY: y,
      })
    )
  const pointer = (target, type, x, y, buttons = 1) => {
    const event = new window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons,
      clientX: x,
      clientY: y,
    })
    Object.defineProperties(event, {
      pointerId: { value: 7 },
      pointerType: { value: 'mouse' },
      isPrimary: { value: true },
    })
    target.dispatchEvent(event)
  }
  return { window, get, mouse, pointer }
}

it('starts the first Safari drag after changing a focused scene select when pointerdown is absent', () => {
  const { window, get, mouse, pointer } = openPrototype()
  const scene = get('scene-select')
  scene.focus()
  scene.value = 'switch'
  scene.dispatchEvent(new window.Event('change', { bubbles: true }))
  expect(window.document.activeElement).toBe(scene)

  // Native Safari trace: mousedown(use), focusout(select), then mouse events;
  // no pointerdown is delivered for this first drag. Execute the real HTML.
  mouse(get('sling-arrow').querySelector('use'), 'mousedown', 100, 100)
  scene.blur()
  vi.advanceTimersByTime(16)
  mouse(window, 'mousemove', 148, 100)
  // Safari still emits pointerup without its corresponding pointerdown.
  pointer(get('sling-arrow'), 'pointerup', 148, 100, 0)
  mouse(window, 'mouseup', 148, 100, 0)

  expect(['launching', 'loading']).toContain(window.eval('state.phase'))
})

it('keeps a normal pointer drag as one gesture when compatibility mouse events follow', () => {
  const { window, get, mouse, pointer } = openPrototype()
  const scene = get('scene-select')
  scene.value = 'switch'
  scene.dispatchEvent(new window.Event('change', { bubbles: true }))
  const ball = get('sling-ball')
  const icon = get('sling-arrow').querySelector('use')
  pointer(icon, 'pointerdown', 100, 100)
  const grip = window.eval('state.pointer')
  mouse(icon, 'mousedown', 100, 100)
  expect(window.eval('state.pointer')).toBe(grip)

  vi.advanceTimersByTime(16)
  pointer(ball, 'pointermove', 148, 100)
  mouse(window, 'mousemove', 148, 100)
  expect(window.eval('state.pointer')).toBe(grip)
  pointer(ball, 'pointerup', 148, 100, 0)
  mouse(window, 'mouseup', 148, 100, 0)

  expect(['launching', 'loading']).toContain(window.eval('state.phase'))
  expect(
    window.Element.prototype.animate.mock.contexts.filter(
      target => target === ball
    )
  ).toHaveLength(1)
})

it('cannot confirm a cancelled pointer or fallback mouse gesture with a late mouseup', () => {
  for (const mode of ['pointer', 'mouse']) {
    const { window, get, mouse, pointer } = openPrototype()
    const scene = get('scene-select')
    scene.value = 'switch'
    scene.dispatchEvent(new window.Event('change', { bubbles: true }))
    const icon = get('sling-arrow').querySelector('use')
    const ball = get('sling-ball')
    if (mode === 'pointer') pointer(icon, 'pointerdown', 100, 100)
    else mouse(icon, 'mousedown', 100, 100)
    expect(window.eval('state.pointer')).not.toBeNull()
    vi.advanceTimersByTime(16)
    if (mode === 'pointer') {
      pointer(ball, 'pointermove', 148, 100)
      pointer(ball, 'pointercancel', 148, 100, 0)
    } else {
      mouse(window, 'mousemove', 148, 100)
      window.dispatchEvent(new window.Event('blur'))
    }
    mouse(window, 'mouseup', 148, 100, 0)
    vi.advanceTimersByTime(2000)
    expect(window.eval('state.phase')).toBe('ready')
    expect(window.eval('state.pointer')).toBeNull()
    expect(get('score-project').textContent).toBe('runes')
  }
})

it('leaves only the socket loader while busy and restores the entry on Escape', () => {
  const { window, get, mouse } = openPrototype()
  const scene = get('scene-select')
  scene.value = 'switch'
  scene.dispatchEvent(new window.Event('change', { bubbles: true }))
  const score = get('score-view')
  const overlay = get('switch-overlay')
  const ball = get('sling-ball')
  mouse(get('sling-arrow').querySelector('use'), 'mousedown', 100, 100)
  mouse(window, 'mousemove', 148, 100)
  mouse(window, 'mouseup', 148, 100, 0)

  expect(overlay.classList.contains('is-busy')).toBe(true)
  expect(window.document.activeElement).toBe(overlay)
  expect(get('spinner').parentElement).toBe(get('socket-loader'))
  expect(ball.contains(get('spinner'))).toBe(false)
  expect(get('spinner').hidden).toBe(false)
  expect(get('socket-loader').getAttribute('role')).toBe('status')
  expect(get('socket-loader').getAttribute('aria-hidden')).toBe('false')
  expect(window.getComputedStyle(get('socket-loader')).opacity).toBe('1')
  expect(ball.disabled).toBe(true)
  expect(window.getComputedStyle(ball).opacity).toBe('0')
  expect(
    window.Element.prototype.animate.mock.calls[
      window.Element.prototype.animate.mock.contexts.lastIndexOf(ball)
    ][0].at(-1).opacity
  ).toBe(0)
  for (const element of window.document.querySelectorAll(
    '.incoming, #gesture-copy, #gesture-hint, .key-hint, #tools, #show-tools'
  )) {
    expect(element.inert).toBe(true)
    expect(element.getAttribute('aria-hidden')).toBe('true')
    expect(window.getComputedStyle(element).opacity).toBe('0')
  }
  expect(score.inert).toBe(true)
  expect(window.getComputedStyle(score).opacity).toBe('0')
  expect(get('cancel-load').hidden).toBe(true)
  const tab = new window.KeyboardEvent('keydown', {
    key: 'Tab',
    bubbles: true,
    cancelable: true,
  })
  overlay.dispatchEvent(tab)
  expect(tab.defaultPrevented).toBe(true)
  expect(window.document.activeElement).toBe(overlay)

  vi.advanceTimersByTime(420)
  expect(window.eval('state.phase')).toBe('loading')
  overlay.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  )
  vi.advanceTimersByTime(2000)
  expect(window.eval('state.phase')).toBe('ready')
  expect(get('score-view')).toBe(score)
  expect(get('score-project').textContent).toBe('runes')
  expect(overlay.classList.contains('is-busy')).toBe(false)
  expect(score.classList.contains('is-loading')).toBe(false)
  expect(get('tools').inert).toBe(false)
  expect(get('gesture-copy').inert).toBe(false)
  expect(get('spinner').hidden).toBe(true)
  expect(ball.disabled).toBe(false)
  expect(window.document.activeElement).toBe(ball)
})

it('restores the same old score and retry controls after a loading failure', () => {
  const { window, get, mouse } = openPrototype()
  const scene = get('scene-select')
  scene.value = 'switch'
  scene.dispatchEvent(new window.Event('change', { bubbles: true }))
  const score = get('score-view')
  const symbol = score.querySelector('.rune')
  get('fail-next').checked = true
  get('fail-next').dispatchEvent(new window.Event('change', { bubbles: true }))
  mouse(get('sling-arrow').querySelector('use'), 'mousedown', 100, 100)
  mouse(window, 'mousemove', 100, 52)
  mouse(window, 'mouseup', 100, 52, 0)
  vi.advanceTimersByTime(1500)

  expect(window.eval('state.phase')).toBe('error')
  expect(get('score-view')).toBe(score)
  expect(score.querySelector('.rune')).toBe(symbol)
  expect(get('score-project').textContent).toBe('runes')
  expect(score.classList.contains('is-loading')).toBe(false)
  expect(get('switch-overlay').classList.contains('is-busy')).toBe(false)
  expect(get('gesture-copy').textContent).toBe('未能加载新工程')
  expect(get('gesture-copy').getAttribute('aria-hidden')).toBe('false')
  expect(get('gesture-copy').inert).toBe(false)
  expect(get('tools').inert).toBe(false)
  expect(get('spinner').hidden).toBe(true)
  expect(get('sling-ball').disabled).toBe(false)
  expect(window.document.activeElement).toBe(get('sling-ball'))
})

it('holds the standalone loading scene with only its socket spinner until Escape', () => {
  const { window, get } = openPrototype('?scene=loading')
  expect(window.eval('state.phase')).toBe('loading')
  expect(get('spinner').hidden).toBe(false)
  expect(get('spinner').parentElement).toBe(get('socket-loader'))
  expect(window.getComputedStyle(get('socket-loader')).opacity).toBe('1')
  for (const element of window.document.querySelectorAll(
    '#sling-ball, #score-view, .incoming, #gesture-copy, #gesture-hint, .key-hint, #tools, #show-tools'
  ))
    expect(window.getComputedStyle(element).opacity).toBe('0')
  expect(window.Element.prototype.animate).not.toHaveBeenCalled()
  vi.advanceTimersByTime(20_000)
  expect(window.eval('state.phase')).toBe('loading')

  get('switch-overlay').dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  )
  expect(window.eval('state.phase')).toBe('ready')
  expect(get('scene-select').value).toBe('switch')
  expect(get('spinner').hidden).toBe(true)
  expect(get('tools').inert).toBe(false)
  expect(get('sling-ball').disabled).toBe(false)
  expect(window.document.activeElement).toBe(get('sling-ball'))
})
