/* global window */
// Native WKUserScript, in project frames only. Synthetic DOM input, never OSC.
;(() => {
  if (window.parent === window) return
  let enabled = false
  let active = null
  let generation = 0
  const defer = action => {
    if (!enabled) return
    const owner = generation
    window.setTimeout(() => {
      if (enabled && generation === owner) action()
    }, 0)
  }
  const isControl = target =>
    target.closest(
      'input, textarea, select, button, a, [contenteditable], [role="button"], [role="combobox"]'
    )
  const emit = (type, pointer, end) => {
    if (!active) return
    const target = active.target
    const touch = {
      identifier: active.id,
      target,
      clientX: pointer.clientX,
      clientY: pointer.clientY,
      pageX: pointer.pageX,
      pageY: pointer.pageY,
      screenX: pointer.screenX,
      screenY: pointer.screenY,
      radiusX: 1,
      radiusY: 1,
      rotationAngle: 0,
      force: end ? 0 : 1,
    }
    const list = values =>
      Object.assign(values, { item: index => values[index] ?? null })
    const event = new window.Event(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
    })
    Object.defineProperties(event, {
      touches: { value: list(end ? [] : [touch]) },
      targetTouches: { value: list(end ? [] : [touch]) },
      changedTouches: { value: list([touch]) },
    })
    if (end) {
      active = null
      try {
        target.releasePointerCapture(touch.identifier)
      } catch {
        /* Capture may already be released. */
      }
    } else active.last = pointer
    target.dispatchEvent(event)
  }
  const cancel = () => {
    generation++
    if (active) emit('touchcancel', active.last, true)
  }
  window.addEventListener('message', event => {
    if (
      event.source !== window.parent ||
      event.data?.type !== 'pnds:test-touch' ||
      event.data.version !== 1 ||
      typeof event.data.enabled !== 'boolean'
    )
      return
    if (!event.data.enabled) cancel()
    enabled = event.data.enabled
  })
  // Wait for the full dispatch, including later window handlers, to finish.
  window.addEventListener('pointerdown', event => {
    if (!enabled || event.pointerType !== 'mouse' || event.button !== 0) return
    const target =
      event.target instanceof window.Element
        ? event.target
        : event.target?.parentElement
    if (!target || isControl(target)) return
    defer(() => {
      if (active || event.defaultPrevented || !target.isConnected) return
      active = { id: event.pointerId, target, last: event }
      try {
        target.setPointerCapture(event.pointerId)
      } catch {
        /* Window listeners still cover in-frame input. */
      }
      emit('touchstart', event, false)
    })
  })
  window.addEventListener('pointermove', event => {
    defer(() => {
      if (!active || active.id !== event.pointerId) return
      emit(
        event.buttons & 1 ? 'touchmove' : 'touchcancel',
        event,
        !(event.buttons & 1)
      )
    })
  })
  window.addEventListener('pointerup', event => {
    defer(() => {
      if (!active || active.id !== event.pointerId) return
      emit('touchend', event, true)
    })
  })
  const cancelPointer = event => {
    defer(() => {
      if (active?.id === event.pointerId) emit('touchcancel', active.last, true)
    })
  }
  window.addEventListener('pointercancel', cancelPointer, true)
  window.addEventListener(
    'lostpointercapture',
    event => {
      const contact = active
      if (contact?.id !== event.pointerId) return
      defer(() => {
        if (active === contact) emit('touchcancel', contact.last, true)
      })
    },
    true
  )
  window.addEventListener('blur', cancel)
})()
