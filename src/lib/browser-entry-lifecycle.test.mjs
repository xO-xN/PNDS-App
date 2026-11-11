import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const resources = 'src-tauri/resources/browser-participation/'
const origin = 'http://pnds.test'
const hostId = '1'.repeat(64)
const windows = []
const run = (project, performance = project) => ({
  projectId: project.repeat(64),
  performanceId: performance.repeat(64),
  projectName: `Project ${project}`,
  performerUrl: '/score',
  supportsPerformerUrl: true,
  browserParticipation: 1,
})
const metadata = performance => ({
  protocolVersion: 1,
  hostId,
  nodeName: 'Test Host',
  performance,
})
const escape = value =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
const template = (source, replacements) =>
  source.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!(key in replacements)) throw new Error(`Unknown entry token: ${key}`)
    return replacements[key]
  })

function expectVisibleAncestors(window, element) {
  for (let current = element; current; current = current.parentElement) {
    const description = current.outerHTML.slice(0, 160)
    expect(current.hidden, description).not.toBe(true)
    const style = window.getComputedStyle(current)
    expect(style.display, description).not.toBe('none')
    expect(style.visibility, description).not.toBe('hidden')
    expect(style.pointerEvents, description).not.toBe('none')
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  windows.splice(0).forEach(window => window.close())
  vi.clearAllTimers()
  vi.useRealTimers()
})

function openEntry({ reduced = false } = {}) {
  const strings = Object.fromEntries(
    Object.entries(JSON.parse(readFileSync('locales/en.json', 'utf8')))
      .filter(([key]) => key.startsWith('browserEntry.'))
      .map(([key, value]) => [key.slice('browserEntry.'.length), value])
  )
  const stage = template(
    readFileSync(`${resources}entry-gesture.html`, 'utf8'),
    {
      GESTURE_LABEL: escape(strings.gestureLabel),
      LOADING: escape(strings.loading),
    }
  )
  const server = {
    info: metadata(null),
    unavailable: false,
    rejectEnter: false,
  }
  const initial = { hostId, info: server.info, strings }
  const html = template(readFileSync(`${resources}entry.html`, 'utf8'), {
    LANGUAGE: 'en',
    TITLE: escape(strings.title),
    HOST: 'Test Host',
    BRAND: escape(strings.brand),
    CONNECTED: escape(strings.connected),
    WAITING: escape(strings.waiting),
    WAITING_HINT: escape(strings.waitingHint),
    ACTION_LABEL: '',
    PROJECT: '',
    PERFORMANCE: '',
    STATE: 'waiting',
    READY_CLASS: '',
    STATUS: '',
    CONTROLS: '',
    INSTRUCTION: '',
    KEY_HINT: escape(strings.keyHint),
    SAVE_TITLE: escape(strings.saveTitle),
    SAVE_HINT: escape(strings.saveHint),
    SAVE_NOTE: escape(strings.saveNote),
    GESTURE_TEMPLATE: stage,
    CONTEXT: JSON.stringify(initial).replaceAll('<', '\\u003c'),
  })
  const dom = new JSDOM(html, {
    url: `${origin}/`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  const { window } = dom
  windows.push(window)
  const get = selector => window.document.querySelector(selector)
  const panel = get('[data-pnds-entry]')
  const style = window.document.createElement('style')
  style.textContent = readFileSync(`${resources}entry.css`, 'utf8')
  window.document.head.append(style)
  window.matchMedia = () => ({ matches: reduced })
  window.setTimeout = setTimeout
  window.clearTimeout = clearTimeout
  window.requestAnimationFrame = callback =>
    setTimeout(() => callback(Date.now()), 16)
  window.cancelAnimationFrame = clearTimeout
  Object.defineProperty(window.performance, 'now', { value: () => Date.now() })
  Object.defineProperty(window.HTMLElement.prototype, 'inert', {
    get() {
      return this.hasAttribute('inert')
    },
    set(value) {
      this.toggleAttribute('inert', value)
    },
  })
  const animations = []
  window.Element.prototype.animate = vi.fn(function (keyframes, options) {
    const animation = { target: this, keyframes, options, cancelled: false }
    animation.cancel = vi.fn(() => {
      animation.cancelled = true
    })
    animation.finish = vi.fn(() => animation.onfinish?.())
    animations.push(animation)
    return animation
  })
  window.Element.prototype.getAnimations = function () {
    return animations.filter(
      animation => animation.target === this && !animation.cancelled
    )
  }
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

  const ownedFrames = new Map()
  const projects = new Map()
  const createElement = window.document.createElement.bind(window.document)
  window.document.createElement = (name, options) => {
    const element = createElement(name, options)
    if (name.toLowerCase() !== 'iframe') return element
    const events = new Map()
    const record = { frame: element, cleanup: 'success' }
    const view = {
      document: {},
      blur: vi.fn(),
      location: {
        href: 'about:blank',
        replace: vi.fn(url => {
          if (record.cleanup === 'throw')
            throw new Error('Owned cleanup failed')
          if (record.cleanup === 'stalled') return
          view.location.href = url
          void Promise.resolve().then(() => record.emit('load'))
        }),
      },
    }
    record.view = view
    record.emit = type => {
      for (const item of [...(events.get(type) || [])]) {
        if (item.once)
          events.set(
            type,
            events.get(type).filter(value => value !== item)
          )
        item.listener.call(element, new window.Event(type))
      }
    }
    const add = element.addEventListener.bind(element)
    const remove = element.removeEventListener.bind(element)
    element.addEventListener = (type, listener, options) => {
      if (type !== 'load' && type !== 'error')
        return add(type, listener, options)
      events.set(type, [
        ...(events.get(type) || []),
        { listener, once: Boolean(options?.once) },
      ])
    }
    element.removeEventListener = (type, listener, options) => {
      if (type !== 'load' && type !== 'error')
        return remove(type, listener, options)
      events.set(
        type,
        (events.get(type) || []).filter(item => item.listener !== listener)
      )
    }
    Object.defineProperty(element, 'contentWindow', { value: view })
    Object.defineProperty(element, 'src', {
      get: () => view.location.href,
      set(value) {
        view.location.href = value
        record.identity = projects.get(new URL(value).pathname.split('/')[3])
        view.PNDS_PARTICIPATION = { protocolVersion: 1, ...record.identity }
      },
    })
    ownedFrames.set(element, record)
    return element
  }
  const fetch = vi.fn(async (url, options = {}) => {
    if (url === '/__pnds/participation') {
      if (server.unavailable) throw new Error('Metadata connection lost')
      return {
        ok: true,
        status: 200,
        json: async () => globalThis.structuredClone(server.info),
      }
    }
    if (url.startsWith('/__pnds/enter/')) {
      const [, , , enteredHost, projectId, performanceId] = url.split('/')
      if (server.rejectEnter)
        return { ok: false, status: 503, url: `${origin}${url}` }
      projects.set(performanceId, {
        hostId: enteredHost,
        projectId,
        performanceId,
      })
      return {
        ok: true,
        status: 200,
        url: `${origin}/__pnds/run/${performanceId}/`,
      }
    }
    throw new Error(
      `Unexpected entry request: ${options.method || 'GET'} ${url}`
    )
  })
  window.fetch = fetch
  for (const filename of ['entry-gesture.js', 'entry.js'])
    runInContext(
      readFileSync(`${resources}${filename}`, 'utf8'),
      dom.getInternalVMContext()
    )
  const flush = () => vi.advanceTimersByTimeAsync(0)
  const publish = async performance => {
    server.info = metadata(performance)
    await vi.advanceTimersByTimeAsync(1000)
  }
  const submit = () => {
    const form = get('[data-pnds-enter-form]')
    expect(form).not.toBeNull()
    form.requestSubmit()
  }
  const key = (target, name) =>
    target.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: name,
        bubbles: true,
        cancelable: true,
      })
    )
  const mouse = (target, type, x, y) =>
    target.dispatchEvent(
      new window.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: x,
        clientY: y,
      })
    )
  const post = (
    frame,
    data,
    { source = ownedFrames.get(frame)?.view, eventOrigin = origin } = {}
  ) => {
    const event = new window.Event('message')
    Object.defineProperties(event, {
      source: { value: source },
      origin: { value: eventOrigin },
      data: { value: data },
    })
    window.dispatchEvent(event)
  }
  const prepare = (frame, { message = true, load = true } = {}) => {
    const record = ownedFrames.get(frame)
    const report = {
      type: 'pnds:prepared',
      protocolVersion: 1,
      resourceScope: 'page',
      ...record.identity,
    }
    record.view.PNDS_PARTICIPATION.preparation = report
    if (message) post(frame, report)
    if (load) record.emit('load')
    return report
  }
  const adopt = async performance => {
    await publish(performance)
    submit()
    await flush()
    const frame = get('[data-pnds-candidate]')
    expect(frame).not.toBeNull()
    prepare(frame)
    await flush()
    expect(get('[data-pnds-current]')).toBe(frame)
    return frame
  }
  const posts = () =>
    fetch.mock.calls.filter(([, options]) => options?.method === 'POST')
  return {
    window,
    panel,
    get,
    server,
    fetch,
    flush,
    publish,
    submit,
    key,
    mouse,
    post,
    prepare,
    adopt,
    posts,
    ownedFrames,
    animations,
  }
}

describe('production browser entry ownership and UI', () => {
  it('shows the saved Host waiting page and discovers a run without preloading it', async () => {
    const app = openEntry()
    await app.flush()
    expect(app.get('[data-pnds-brand]').textContent).toContain('PNDS池谱')
    expect(app.get('[data-pnds-save]')).not.toBeNull()
    expect(app.panel.dataset.state).toBe('waiting')
    expect(app.get('iframe')).toBeNull()
    await app.publish(run('2', '3'))
    expect(app.panel.classList.contains('is-ready')).toBe(true)
    expect(app.get('[data-pnds-project]').textContent).toBe('Project 2')
    expect(app.posts()).toHaveLength(0)
    expect(app.get('iframe')).toBeNull()
  })

  it('keeps the focused button and hint stable across same-run discovery', async () => {
    const app = openEntry()
    await app.publish(run('2', '3'))
    const button = app.get('[data-pnds-ball]')
    const hints = app.animations.filter(
      animation => animation.target === app.get('[data-pnds-arrow]')
    ).length
    button.focus()
    await app.publish(run('2', '3'))
    expect(app.get('[data-pnds-ball]')).toBe(button)
    expect(app.window.document.activeElement).toBe(button)
    expect(
      app.animations.filter(
        animation => animation.target === app.get('[data-pnds-arrow]')
      )
    ).toHaveLength(hints)
  })

  it.each([false, true])(
    'fades in a new candidate once (reduced motion: %s)',
    async reduced => {
      const app = openEntry({ reduced })
      await app.adopt(run('2', '3'))
      await app.publish(run('4', '5'))
      const reveals = () =>
        app.animations.filter(
          animation =>
            animation.target === app.panel &&
            animation.keyframes[0].opacity === 0
        )
      const reveal = reveals().at(-1)
      expect(reveal.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }])
      expect(reveal.options.duration).toBe(640)
      const count = reveals().length
      await app.publish(run('4', '5'))
      expect(reveals()).toHaveLength(count)
      await app.publish(run('6', '7'))
      expect(reveals()).toHaveLength(count + 1)
    }
  )

  it('crossfades the prepared score and loader before granting input or retiring the original', async () => {
    const app = openEntry()
    const old = await app.adopt(run('2', '3'))
    await app.publish(run('4', '5'))
    app.submit()
    await app.flush()
    const frame = app.get('[data-pnds-candidate]')
    let finishFade
    const finished = new Promise(resolve => {
      finishFade = resolve
    })
    const fade = { finished, cancel: vi.fn() }
    frame.animate = vi.fn(() => fade)
    app.prepare(frame)
    await app.flush()
    expect(frame.animate).toHaveBeenCalledWith(
      [{ opacity: 0 }, { opacity: 1 }],
      expect.objectContaining({ duration: 640 })
    )
    expect(frame.classList.contains('is-revealing')).toBe(true)
    expect(frame.inert).toBe(true)
    expect(app.get('[data-pnds-current]')).toBe(old)
    expect(old.isConnected).toBe(true)
    expect(app.panel.hidden).toBe(false)
    expect(
      app.animations.some(
        animation =>
          animation.target === app.panel &&
          animation.keyframes[0].opacity === 1 &&
          animation.keyframes.at(-1).opacity === 0
      )
    ).toBe(true)
    finishFade()
    await app.flush()
    expect(app.get('[data-pnds-current]')).toBe(frame)
    expect(frame.inert).toBe(false)
    expect(old.isConnected).toBe(false)
    expect(app.panel.hidden).toBe(true)
  })

  it.each(['discovery', 'final check'])(
    'cancels a handoff when %s reports a newer candidate',
    async source => {
      const app = openEntry()
      const old = await app.adopt(run('2', '3'))
      await app.publish(run('4', '5'))
      app.submit()
      await app.flush()
      const frame = app.get('[data-pnds-candidate]')
      let finishFade, rejectFade
      const finished = new Promise((resolve, reject) => {
        finishFade = resolve
        rejectFade = reject
      })
      const fade = {
        finished,
        cancel: vi.fn(() => rejectFade(new Error('Animation cancelled'))),
      }
      frame.animate = () => fade
      app.prepare(frame)
      await app.flush()
      expect(app.panel.classList.contains('is-handoff')).toBe(true)
      if (source === 'discovery') await app.publish(run('6', '7'))
      else app.server.info = metadata(run('6', '7'))
      finishFade()
      await app.flush()
      expect(fade.cancel).toHaveBeenCalled()
      expect(app.get('[data-pnds-current]')).toBe(old)
      expect(old.isConnected).toBe(true)
      expect(app.get('[data-pnds-candidate]')).toBeNull()
      expect(app.get('[data-pnds-project]').textContent).toBe('Project 6')
      expect(app.panel.classList.contains('is-handoff')).toBe(false)
      expect(app.get('[data-pnds-ball]').disabled).toBe(false)
    }
  )

  it('does not wait for unrendered handoff animations in a background document', async () => {
    const app = openEntry()
    await app.adopt(run('2', '3'))
    await app.publish(run('4', '5'))
    Object.defineProperty(app.window.document, 'hidden', { value: true })
    app.submit()
    await app.flush()
    const frame = app.get('[data-pnds-candidate]')
    app.prepare(frame)
    await app.flush()
    expect(app.get('[data-pnds-current]')).toBe(frame)
    expect(app.panel.hidden).toBe(true)
    expect(app.animations.some(animation => animation.target === frame)).toBe(
      false
    )
  })

  it('blocks one-finger background moves only while a confirmation overlay owns input', async () => {
    const app = openEntry()
    const move = (fingers = 1) => {
      const event = new app.window.Event('touchmove', {
        bubbles: true,
        cancelable: true,
      })
      Object.defineProperty(event, 'touches', {
        value: Array.from({ length: fingers }, () => ({
          clientX: 10,
          clientY: 40,
        })),
      })
      app.panel.dispatchEvent(event)
      return event.defaultPrevented
    }
    await app.flush()
    expect(move()).toBe(false)
    await app.publish(run('2', '3'))
    expect(move()).toBe(true)
    expect(move(2)).toBe(false)
    app.submit()
    await app.flush()
    expect(move()).toBe(true)
    const frame = app.get('[data-pnds-candidate]')
    app.prepare(frame)
    await app.flush()
    expect(app.panel.hidden).toBe(true)
    expect(move()).toBe(false)
  })

  it('finishes the owned handoff if a visible document becomes hidden', async () => {
    const app = openEntry()
    const old = await app.adopt(run('2', '3'))
    await app.publish(run('4', '5'))
    app.submit()
    await app.flush()
    const frame = app.get('[data-pnds-candidate]')
    let finishFade
    const finished = new Promise(resolve => {
      finishFade = resolve
    })
    const fade = {
      finished,
      finish: vi.fn(() => finishFade()),
      cancel: vi.fn(),
    }
    frame.animate = () => fade
    app.prepare(frame)
    await app.flush()
    expect(app.panel.classList.contains('is-handoff')).toBe(true)
    Object.defineProperty(app.window.document, 'hidden', { value: true })
    app.window.document.dispatchEvent(new app.window.Event('visibilitychange'))
    await app.flush()
    expect(fade.finish).toHaveBeenCalledOnce()
    expect(app.get('[data-pnds-current]')).toBe(frame)
    expect(old.isConnected).toBe(false)
  })

  it('waits for the complete flight and loader fade before adopting even a quickly prepared score', async () => {
    const app = openEntry()
    const old = await app.adopt(run('2', '3'))
    await app.publish(run('4', '5'))
    const ball = app.get('[data-pnds-ball]')
    app.key(ball, 'Enter')
    await app.flush()
    const flight = app.animations.find(animation => animation.target === ball)
    const prepared = app.get('[data-pnds-candidate]')
    app.prepare(prepared)
    await app.flush()
    expect(app.panel.classList.contains('is-launching')).toBe(true)
    expect(app.get('[data-pnds-current]')).toBe(old)
    expect(old.isConnected).toBe(true)
    let finishFade
    const finished = new Promise(resolve => {
      finishFade = resolve
    })
    app.get('[data-pnds-loader]').getAnimations = () => [{ finished }]
    flight.onfinish()
    await app.flush()
    expect(app.panel.classList.contains('is-loading')).toBe(true)
    expect(app.get('[data-pnds-current]')).toBe(old)
    finishFade()
    await app.flush()
    expect(app.get('[data-pnds-current]')).toBe(prepared)
    expect(old.isConnected).toBe(false)
  })

  it('keeps armed feedback and release wording while holding through metadata polling', async () => {
    const app = openEntry()
    await app.publish(run('2', '3'))
    const instruction = app.get('[data-pnds-instruction]')
    const pull = instruction.textContent
    app.mouse(app.get('[data-pnds-ball]'), 'mousedown', 100, 100)
    app.mouse(app.window, 'mousemove', 148, 100)
    const release = instruction.textContent
    expect(release).not.toBe(pull)
    expect
      .soft(app.get('.pnds-slingshot').classList.contains('is-armed'))
      .toBe(true)

    await app.publish(run('2', '3'))
    expect
      .soft(app.get('.pnds-slingshot').classList.contains('is-armed'))
      .toBe(true)
    expect(instruction.textContent).toBe(release)
    expect(app.posts()).toHaveLength(0)
  })

  it('requires both the candidate load and its own preparation before handing off', async () => {
    const app = openEntry()
    await app.publish(run('2', '3'))
    app.submit()
    await app.flush()
    const frame = app.get('[data-pnds-candidate]')
    expect(frame.inert).toBe(true)
    const report = app.prepare(frame, { load: false })
    await app.flush()
    expect(app.get('[data-pnds-current]')).toBeNull()
    app.post(frame, report, { source: app.window })
    app.ownedFrames.get(frame).emit('load')
    await app.flush()
    expect(app.get('[data-pnds-current]')).toBe(frame)
    expect(frame.inert).toBe(false)
    expect(app.panel.hidden).toBe(true)
    expect(app.panel.dataset.admission).toBe('unknown')
    expect(app.window.document.activeElement).toBe(frame)
  })

  it('rejects forged preparation sources and identities after the page load', async () => {
    const app = openEntry()
    await app.publish(run('2', '3'))
    app.submit()
    await app.flush()
    const frame = app.get('[data-pnds-candidate]')
    const report = app.prepare(frame, { message: false })
    app.post(frame, report, { source: app.window })
    app.post(frame, { ...report, performanceId: 'f'.repeat(64) })
    app.post(frame, report, { eventOrigin: 'http://another-host.test' })
    await app.flush()
    expect(app.get('[data-pnds-current]')).toBeNull()
    app.post(frame, report)
    await app.flush()
    expect(app.get('[data-pnds-current]')).toBe(frame)
  })

  it('obscures the same old score only while another compatible run is available', async () => {
    const app = openEntry()
    const old = await app.adopt(run('2', '3'))
    const document = app.ownedFrames.get(old).view.document
    await app.publish(run('4', '5'))
    expect(app.get('[data-pnds-current]')).toBe(old)
    expect(app.ownedFrames.get(old).view.document).toBe(document)
    expect(old.inert).toBe(true)
    expect(old.classList.contains('is-obscured')).toBe(true)
    expect(app.window.document.activeElement).toBe(app.get('[data-pnds-ball]'))
    await app.publish(null)
    expect(app.get('[data-pnds-current]')).toBe(old)
    expect(old.inert).toBe(false)
    expect(app.panel.hidden).toBe(true)
    expect(app.window.document.activeElement).toBe(old)
    await app.publish({ ...run('4', '5'), browserParticipation: undefined })
    expect(app.get('[data-pnds-current]')).toBe(old)
    expect(old.inert).toBe(false)
    expect(app.panel.hidden).toBe(true)
  })

  it('restores old input after metadata loss without rebuilding its Document', async () => {
    const app = openEntry()
    const old = await app.adopt(run('2', '3'))
    await app.publish(run('4', '5'))
    expect(old.inert).toBe(true)
    expect(app.window.document.activeElement).toBe(app.get('[data-pnds-ball]'))
    app.server.unavailable = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(app.get('[data-pnds-current]')).toBe(old)
    expect(old.inert).toBe(false)
    expect(app.panel.hidden).toBe(true)
    expect(app.window.document.activeElement).toBe(old)
    app.server.unavailable = false
    await app.publish(run('4', '5'))
    expect(old.inert).toBe(true)
  })

  it('keeps a detached stale form from confirming a newer project', async () => {
    const app = openEntry()
    await app.publish(run('2', '3'))
    const stale = app.get('[data-pnds-enter-form]')
    app.mouse(app.get('[data-pnds-ball]'), 'mousedown', 100, 100)
    await app.publish(run('4', '5'))
    expect(app.get('[data-pnds-enter-form]')).not.toBe(stale)
    stale.dispatchEvent(
      new app.window.Event('submit', { bubbles: true, cancelable: true })
    )
    app.mouse(app.window, 'mousemove', 148, 100)
    app.mouse(app.window, 'mouseup', 148, 100)
    await app.flush()
    expect(app.posts()).toHaveLength(0)
    expect(app.get('[data-pnds-candidate]')).toBeNull()
  })

  it('blocks a light physical click from posting the form but accepts Enter and assistive activation once', async () => {
    const app = openEntry()
    await app.publish(run('2', '3'))
    const ball = app.get('[data-pnds-ball]')
    app.mouse(ball, 'mousedown', 100, 100)
    app.mouse(app.window, 'mousemove', 102, 102)
    app.mouse(app.window, 'mouseup', 102, 102)
    const click = new app.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      detail: 1,
    })
    ball.dispatchEvent(click)
    await app.flush()
    expect(click.defaultPrevented).toBe(true)
    expect(app.posts()).toHaveLength(0)
    expect(app.get('[data-pnds-candidate]')).toBeNull()

    app.key(ball, 'Enter')
    await app.flush()
    expect(app.posts()).toHaveLength(1)

    const assistive = openEntry()
    await assistive.publish(run('4', '5'))
    assistive.get('[data-pnds-ball]').click()
    await assistive.flush()
    expect(assistive.posts()).toHaveLength(1)
  })

  it('accepts the first Safari drag and fades to the socket loader while the ball is flying', async () => {
    const app = openEntry()
    const old = await app.adopt(run('2', '3'))
    await app.publish(run('4', '5'))
    const ball = app.get('[data-pnds-ball]')
    app.mouse(app.get('[data-pnds-arrow]'), 'mousedown', 100, 100)
    app.mouse(app.window, 'mousemove', 148, 100)
    app.mouse(app.window, 'mouseup', 148, 100)
    await app.flush()
    expect(app.posts()).toHaveLength(2)
    expect(app.panel.classList.contains('is-busy')).toBe(true)
    expect(app.get('.pnds-slingshot').classList.contains('is-armed')).toBe(
      false
    )
    expect(old.inert).toBe(true)
    expect(app.panel.classList.contains('is-launching')).toBe(true)
    expect(app.panel.classList.contains('is-loading')).toBe(true)
    expect(old.classList.contains('is-loading')).toBe(true)
    expect(app.get('[data-pnds-spinner]').hidden).toBe(false)
    const flight = app.animations.find(animation => animation.target === ball)
    flight.onfinish()
    await app.flush()
    expect(app.panel.classList.contains('is-launching')).toBe(false)
    expect(app.panel.classList.contains('is-loading')).toBe(true)
    expect(old.classList.contains('is-loading')).toBe(true)
    expect(ball.contains(app.get('[data-pnds-spinner]'))).toBe(false)
    expect(app.get('[data-pnds-spinner]').hidden).toBe(false)
    expect(app.window.document.activeElement).not.toBe(old)
    app.key(app.panel, 'Escape')
    await app.flush()
    expect(app.get('[data-pnds-current]')).toBe(old)
    expect(app.panel.classList.contains('is-busy')).toBe(false)
    expect(app.get('[data-pnds-candidate]')).toBeNull()
    expect(app.get('[data-pnds-ball]').disabled).toBe(false)
  })

  it('retains the old frame on resource failure and allows a new explicit retry', async () => {
    const app = openEntry()
    const old = await app.adopt(run('2', '3'))
    await app.publish(run('4', '5'))
    app.submit()
    await app.flush()
    const failed = app.get('[data-pnds-candidate]')
    app.post(failed, {
      type: 'pnds:preparation-failed',
      protocolVersion: 1,
      ...app.ownedFrames.get(failed).identity,
    })
    await app.flush()
    expect(app.get('[data-pnds-current]')).toBe(old)
    expect(app.panel.classList.contains('is-busy')).toBe(false)
    expect(app.get('[data-pnds-ball]').disabled).toBe(false)
    expect(app.get('[data-pnds-status]').textContent).toBeTruthy()
    app.submit()
    await app.flush()
    const retry = app.get('[data-pnds-candidate]')
    expect(retry).not.toBe(failed)
    app.prepare(retry)
    await app.flush()
    expect(app.get('[data-pnds-current]')).toBe(retry)
    expect(old.isConnected).toBe(false)
  })

  it('times out a candidate without granting it the old frame’s ownership', async () => {
    const app = openEntry()
    const old = await app.adopt(run('2', '3'))
    await app.publish(run('4', '5'))
    app.submit()
    await app.flush()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(app.get('[data-pnds-current]')).toBe(old)
    expect(app.get('[data-pnds-candidate]')).toBeNull()
    expect(app.panel.classList.contains('is-busy')).toBe(false)
    expect(app.get('[data-pnds-ball]').disabled).toBe(false)
  })

  it('cancels a superseded candidate and ignores its late preparation', async () => {
    const app = openEntry()
    const old = await app.adopt(run('2', '3'))
    await app.publish(run('4', '5'))
    app.submit()
    await app.flush()
    const superseded = app.get('[data-pnds-candidate]')
    const late = app.prepare(superseded, { message: false, load: false })
    await app.publish(run('6', '7'))
    app.ownedFrames.get(superseded).emit('load')
    app.post(superseded, late)
    await app.flush()
    expect(app.get('[data-pnds-current]')).toBe(old)
    expect(app.get('[data-pnds-project]').textContent).toBe('Project 6')
    expect(app.get('[data-pnds-candidate]')).toBeNull()
    app.submit()
    await app.flush()
    const latest = app.get('[data-pnds-candidate]')
    app.prepare(latest)
    await app.flush()
    expect(app.get('[data-pnds-current]')).toBe(latest)
  })

  it('ignores a cancelled flight completion after discovery has replaced its candidate', async () => {
    const app = openEntry()
    const old = await app.adopt(run('2', '3'))
    await app.publish(run('4', '5'))
    const ball = app.get('[data-pnds-ball]')
    app.key(ball, 'Enter')
    await app.flush()
    const flight = app.animations.find(animation => animation.target === ball)
    await app.publish(run('6', '7'))
    flight.onfinish()
    await app.flush()
    expect(app.panel.classList.contains('is-loading')).toBe(false)
    expect(app.get('[data-pnds-current]')).toBe(old)
    expect(app.get('[data-pnds-project]').textContent).toBe('Project 6')
    expect(app.get('[data-pnds-ball]').disabled).toBe(false)
  })

  it('does not adopt a prepared page if the final metadata check names another run', async () => {
    const app = openEntry()
    const old = await app.adopt(run('2', '3'))
    await app.publish(run('4', '5'))
    app.submit()
    await app.flush()
    const ready = app.get('[data-pnds-candidate]')
    app.server.info = metadata(run('6', '7'))
    app.prepare(ready)
    await app.flush()
    expect(app.get('[data-pnds-current]')).toBe(old)
    expect(app.get('[data-pnds-project]').textContent).toBe('Project 6')
    expect(app.get('[data-pnds-candidate]')).toBeNull()
  })

  it('keeps cleanup failure visible without changing a successful handoff', async () => {
    const app = openEntry()
    const old = await app.adopt(run('2', '3'))
    app.ownedFrames.get(old).cleanup = 'throw'
    const replacement = await app.adopt(run('4', '5'))
    expect(app.get('[data-pnds-current]')).toBe(replacement)
    expect(old.inert).toBe(true)
    expect(old.classList.contains('pnds-retiring')).toBe(true)
    expect(app.panel.hidden).toBe(false)
    expect(app.get('[data-pnds-status]').textContent).toBeTruthy()
    app.ownedFrames.get(old).cleanup = 'success'
    const retry = app.get('[data-pnds-cleanup-retry]')
    expect(retry).toBeTruthy()
    expectVisibleAncestors(app.window, retry)
    retry.click()
    await app.flush()
    expect(old.isConnected).toBe(false)
    expect(app.get('[data-pnds-current]')).toBe(replacement)
    expect(app.panel.hidden).toBe(true)
  })
})
