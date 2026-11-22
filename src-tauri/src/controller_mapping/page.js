/* global crypto, document, location, MutationObserver, HTMLElement, HTMLInputElement, Event, requestAnimationFrame, window, CSS */
;(() => {
  const nonce = Array.from(crypto.getRandomValues(new Uint32Array(4)), n =>
    n.toString(16).padStart(8, '0')
  ).join('')
  const post = report =>
    window.webkit.messageHandlers.pndsController.postMessage(
      JSON.stringify({ nonce, page, report })
    )

  const rangeSelector = 'input[type="range"]'
  const switchSelector = 'input[type="checkbox"], [role="switch"]'
  const triggerSelector =
    'button, input:is([type="button"], [type="submit"], [type="reset"]), [role="button"]'
  const selector = `${rangeSelector}, ${switchSelector}, ${triggerSelector}`
  const setInputValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  ).set
  const temporary = new Map()
  const temporaryIds = new WeakMap()
  let nextTemporaryId = 0
  let page = 0
  let revision = 0
  let learning = false
  let pending = null
  let mappings = []
  let lastAvailability = ''
  const labels = new Map()
  const selection = document.createElement('span')
  Object.assign(selection.style, {
    position: 'absolute',
    outline: '2px solid #357fe5',
    outlineOffset: '3px',
    pointerEvents: 'none',
  })
  let paintFrame = 0

  const canTarget = element =>
    element instanceof HTMLElement && element.matches(selector)

  function kindFor(element) {
    if (element.matches(rangeSelector)) return 'continuous'
    return element.matches(switchSelector) ? 'switch' : 'trigger'
  }

  function numericAttribute(element, name) {
    const text = element.getAttribute(name)?.trim()
    const value = text ? Number(text) : NaN
    return Number.isFinite(value) ? value : null
  }

  function rangeFor(element) {
    const explicitMin = numericAttribute(element, 'min')
    const min = explicitMin ?? 0
    const max = Math.max(min, numericAttribute(element, 'max') ?? 100)
    const step = numericAttribute(element, 'step')
    return {
      min,
      max,
      step: element.step.toLowerCase() === 'any' ? null : step > 0 ? step : 1,
      stepBase: explicitMin ?? numericAttribute(element, 'value') ?? 0,
    }
  }

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

  function continuousValue(value, configured, legal) {
    const { inputMin, inputMax, targetMin, targetMax, reversed } = configured
    const min = Math.max(targetMin, legal.min)
    const max = Math.min(targetMax, legal.max)
    if (min > max) return null

    const position = clamp((value - inputMin) / (inputMax - inputMin), 0, 1)
    const scaled =
      targetMin + (reversed ? 1 - position : position) * (targetMax - targetMin)
    if (legal.step == null) return clamp(scaled, min, max)

    const index = point => (point - legal.stepBase) / legal.step
    const lower = index(min)
    const upper = index(max)
    // Range limits such as 0.3 / 0.1 can land one ULP off the tick.
    const tolerance = point => Math.max(1, Math.abs(point)) * Number.EPSILON * 2
    const first = Math.ceil(lower - tolerance(lower))
    const last = Math.floor(upper + tolerance(upper))
    if (!Number.isFinite(first) || !Number.isFinite(last) || first > last)
      return null
    const tick = clamp(Math.round(index(scaled)), first, last)
    return clamp(legal.stepBase + tick * legal.step, min, max)
  }

  function applyInput(element, target, input, configured) {
    if (target.kind === 'continuous') {
      if (!configured || input.value == null || element.disabled) return
      const value = continuousValue(input.value, configured, rangeFor(element))
      if (value == null) return
      const previous = element.value
      setInputValue.call(element, String(value))
      if (element.value !== previous) {
        element.dispatchEvent(
          new Event('input', { bubbles: true, composed: true })
        )
        element.dispatchEvent(new Event('change', { bubbles: true }))
      }
      return
    }
    if (target.kind === 'switch' && input.value != null) {
      const checked =
        element instanceof HTMLInputElement && element.type === 'checkbox'
          ? element.checked
          : element.getAttribute('aria-checked') === 'true'
      if (checked === input.value > 0) return
    }
    element.click()
  }

  function stableLookup(key, value) {
    const matching = document.querySelectorAll(`[${key}=${CSS.escape(value)}]`)
    if (matching.length === 1 && canTarget(matching[0])) return matching[0]
    return null
  }

  function describe(element) {
    const kind = kindFor(element)
    const name =
      element.getAttribute('aria-label')?.trim() ||
      element.labels?.[0]?.textContent?.trim() ||
      element.textContent?.trim() ||
      (kind === 'trigger' ? element.value : '') ||
      element.id ||
      element.getAttribute('name') ||
      ''
    const range = kind === 'continuous' ? rangeFor(element) : null
    const descriptor = { name: name.slice(0, 180), kind, range }
    for (const attr of ['id', 'name']) {
      const value = element.getAttribute(attr)
      if (value && stableLookup(attr, value) === element) {
        return {
          id: `dom:${JSON.stringify([location.pathname, attr, value])}`,
          ...descriptor,
          temporary: false,
        }
      }
    }
    const id = temporaryIds.get(element) ?? `live:${++nextTemporaryId}`
    temporaryIds.set(element, id)
    temporary.set(id, element)
    return { id, ...descriptor, temporary: true }
  }

  function resolve(target) {
    const matchingKind = element =>
      canTarget(element) && kindFor(element) === target.kind
    if (target.temporary) {
      const element = temporary.get(target.id)
      return element?.isConnected && matchingKind(element) ? element : null
    }
    if (!target.id.startsWith('dom:')) return null
    try {
      const [path, attr, value] = JSON.parse(target.id.slice(4))
      if (
        path === location.pathname &&
        ['id', 'name'].includes(attr) &&
        typeof value === 'string' &&
        value
      ) {
        const element = stableLookup(attr, value)
        if (matchingKind(element)) return element
      }
    } catch {
      return null
    }
    return null
  }

  function reportAvailability() {
    const unavailable = mappings
      .filter(({ target }) => !resolve(target))
      .map(({ target }) => target.id)
    const signature = JSON.stringify([revision, unavailable])
    if (signature !== lastAvailability) {
      lastAvailability = signature
      post({ type: 'availability', data: { revision, unavailable } })
    }
    for (const [id, element] of temporary)
      if (!element.isConnected) temporary.delete(id)
  }

  const layer = document.createElement('div')
  layer.dataset.pndsControllerLayer = ''
  layer.setAttribute('aria-hidden', 'true')
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
  })

  function paint() {
    paintFrame = 0
    if (!learning) {
      layer.remove()
      labels.clear()
      layer.replaceChildren()
      return
    }
    if (!layer.isConnected && document.documentElement)
      document.documentElement.append(layer)
    const selected = pending && resolve(pending)
    if (selected) {
      const bounds = selected.getBoundingClientRect()
      Object.assign(selection.style, {
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
      })
      if (!selection.isConnected) layer.append(selection)
    } else {
      selection.remove()
    }
    const marked = new Set()
    for (const item of mappings) {
      const element = resolve(item.target)
      if (!element) continue
      marked.add(item.target.id)
      const bounds = element.getBoundingClientRect()
      let badge = labels.get(item.target.id)
      if (!badge) {
        badge = document.createElement('span')
        Object.assign(badge.style, {
          position: 'absolute',
          background: '#151722',
          color: '#fff',
          font: '12px system-ui',
          padding: '3px 5px',
          borderRadius: '4px',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          outline: '1px solid #fff',
        })
        labels.set(item.target.id, badge)
        layer.append(badge)
      }
      if (badge.textContent !== item.label) badge.textContent = item.label
      badge.dataset.pndsControllerAddress = item.label
      badge.hidden = bounds.width === 0 || bounds.height === 0
      badge.style.left = `${Math.max(0, bounds.left)}px`
      badge.style.top = `${Math.max(0, bounds.top - 20)}px`
    }
    for (const [id, badge] of labels) {
      if (!marked.has(id)) {
        labels.delete(id)
        badge.remove()
      }
    }
    if (mappings.length || pending) paintFrame = requestAnimationFrame(paint)
  }

  const schedulePaint = () => {
    if (!paintFrame) paintFrame = requestAnimationFrame(paint)
  }

  function receive(expected, owner, message) {
    if (expected !== nonce || owner < page) return
    if (message.type !== 'configure' && owner !== page) return
    if (message.type === 'deactivate') {
      learning = false
      pending = null
      mappings = []
      temporary.clear()
      schedulePaint()
    } else if (message.type === 'configure') {
      if (message.revision < revision) return
      page = owner
      revision = message.revision
      learning = message.learning
      pending = message.pending
      mappings = message.mappings
      reportAvailability()
      schedulePaint()
    } else if (message.type === 'input' && !learning) {
      const element = resolve(message.target)
      if (element)
        applyInput(element, message.target, message.input, message.range)
    }
  }

  // Capture a selection before the legacy project's pointer handlers run.
  function capture(event) {
    if (!learning || !event.isTrusted) return
    event.stopImmediatePropagation()
    event.preventDefault()
    if (event.type !== 'click') return
    const target = event.target?.closest?.(selector)
    if (canTarget(target)) {
      pending = describe(target)
      post({ type: 'selected', data: pending })
    }
  }

  for (const type of [
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'click',
  ])
    window.addEventListener(type, capture, true)
  window.addEventListener(
    'keydown',
    event => {
      if (
        !learning ||
        !event.isTrusted ||
        event.key !== 'Escape' ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey
      )
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      learning = false
      schedulePaint()
      post({ type: 'exit' })
    },
    true
  )

  const observer = new MutationObserver(records => {
    if (
      mappings.length &&
      records.some(record => !layer.contains(record.target))
    )
      reportAvailability()
  })
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['id', 'name', 'role', 'type'],
  })

  Object.defineProperty(globalThis, '__pndsController', {
    value: Object.freeze({ nonce, receive }),
  })
})()
