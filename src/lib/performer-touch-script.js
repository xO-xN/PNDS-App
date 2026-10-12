/* global window */
// Native WKUserScript, in project frames only. Synthetic DOM input, never OSC.
;(() => {
  if (window.parent === window) return
  let enabled = false
  let active = null
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
  window.addEventListener(
    'pointerdown',
    event => {
      if (
        !enabled ||
        active ||
        event.pointerType !== 'mouse' ||
        event.button !== 0
      )
        return
      const target =
        event.target instanceof window.Element
          ? event.target
          : event.target?.parentElement
      if (!target || isControl(target)) return
      active = { id: event.pointerId, target, last: event }
      try {
        target.setPointerCapture(event.pointerId)
      } catch {
        /* Window listeners still cover in-frame input. */
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      emit('touchstart', event, false)
    },
    true
  )
  window.addEventListener(
    'pointermove',
    event => {
      if (!active || active.id !== event.pointerId) return
      event.preventDefault()
      event.stopImmediatePropagation()
      emit(
        event.buttons & 1 ? 'touchmove' : 'touchcancel',
        event,
        !(event.buttons & 1)
      )
    },
    true
  )
  window.addEventListener(
    'pointerup',
    event => {
      if (!active || active.id !== event.pointerId) return
      event.preventDefault()
      event.stopImmediatePropagation()
      emit('touchend', event, true)
    },
    true
  )
  const cancelPointer = event => {
    if (active?.id === event.pointerId) cancel()
  }
  window.addEventListener('pointercancel', cancelPointer, true)
  window.addEventListener('lostpointercapture', cancelPointer, true)
  window.addEventListener('blur', cancel)
})()
