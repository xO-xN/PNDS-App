// Dependency-free contact input. Pointer-capable pages never also consume touch.
;(function (root) {
  function attachInput({ surface, send }) {
    if (
      !surface ||
      typeof surface.addEventListener !== 'function' ||
      typeof send !== 'function'
    )
      throw new Error(
        'Input needs a real surface and the admitted player sender'
      )
    const contacts = new Map(),
      listeners = []
    const prefix = `input-${root.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
    const previousTouchAction = surface.style.touchAction
    surface.style.touchAction = 'none'
    let sequence = 0,
      enabled = false,
      startsAllowed = true,
      closed = false,
      lastTouch = -Infinity
    const listen = (target, name, handler, options) => {
      target.addEventListener(name, handler, options)
      listeners.push(() => target.removeEventListener(name, handler, options))
    }
    const isControl = target =>
      target?.closest?.(
        'input, textarea, select, button, a, label, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="combobox"]'
      )
    function payload(contact, phase, point) {
      const bounds = surface.getBoundingClientRect()
      if (!(bounds.width > 0) || !(bounds.height > 0)) return null
      const x = point.clientX - bounds.left,
        y = point.clientY - bounds.top
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      return {
        kind: 'contact',
        id: contact.id,
        phase,
        pointerType: contact.pointerType,
        x,
        y,
        width: bounds.width,
        height: bounds.height,
        nx: Math.max(0, Math.min(1, x / bounds.width)),
        ny: Math.max(0, Math.min(1, y / bounds.height)),
      }
    }
    function start(
      key,
      pointerType,
      point,
      event,
      pointerId,
      previouslyPrevented = event.defaultPrevented
    ) {
      if (
        !enabled ||
        !startsAllowed ||
        closed ||
        previouslyPrevented ||
        isControl(event.target) ||
        isControl(point.target) ||
        contacts.has(key) ||
        contacts.size >= 64 ||
        (pointerType === 'mouse' &&
          [...contacts.values()].some(
            contact => contact.pointerType === 'mouse'
          ))
      )
        return
      const contact = {
        key,
        id: `${prefix}:${++sequence}`,
        pointerType,
        pointerId,
        last: point,
        startedAt: event.timeStamp,
      }
      const value = payload(contact, 'start', point)
      if (!value) return
      contact.lastPayload = value
      if (event.cancelable) event.preventDefault()
      contacts.set(key, contact)
      if (pointerId !== undefined) {
        try {
          surface.setPointerCapture(pointerId)
        } catch {
          /* Window handlers retain the contact. */
        }
      }
      if (!send(value)) contacts.delete(key)
    }
    function finish(contact, phase, point = contact?.last, event) {
      if (
        !contact ||
        contacts.get(contact.key) !== contact ||
        (event && event.timeStamp < contact.startedAt)
      )
        return
      const value = payload(contact, phase, point) ?? {
        ...contact.lastPayload,
        phase,
      }
      // Remove the exact gesture before capture loss can synchronously re-enter.
      contacts.delete(contact.key)
      if (contact.pointerId !== undefined) {
        try {
          surface.releasePointerCapture(contact.pointerId)
        } catch {
          /* Already released. */
        }
      }
      if (value) send(value)
    }
    function move(contact, point, event) {
      if (
        !contact ||
        contacts.get(contact.key) !== contact ||
        event.timeStamp < contact.startedAt
      )
        return
      if (event.cancelable) event.preventDefault()
      contact.last = point
      const value = payload(contact, 'move', point)
      if (value) {
        contact.lastPayload = value
        send(value)
      }
    }
    const cancelAll = () => {
      for (const contact of [...contacts.values()]) finish(contact, 'cancel')
    }
    if (typeof root.PointerEvent === 'function') {
      listen(surface, 'pointerdown', event => {
        if (
          !['mouse', 'touch', 'pen'].includes(event.pointerType) ||
          (event.pointerType === 'mouse' && event.button !== 0)
        )
          return
        start(
          `pointer:${event.pointerId}`,
          event.pointerType,
          event,
          event,
          event.pointerId
        )
      })
      listen(root, 'pointermove', event => {
        const contact = contacts.get(`pointer:${event.pointerId}`)
        if (contact?.pointerType === 'mouse' && !(event.buttons & 1))
          finish(contact, 'cancel', event, event)
        else move(contact, event, event)
      })
      for (const [name, phase] of [
        ['pointerup', 'end'],
        ['pointercancel', 'cancel'],
      ]) {
        listen(root, name, event => {
          const contact = contacts.get(`pointer:${event.pointerId}`)
          if (contact && event.timeStamp >= contact.startedAt)
            finish(contact, phase, event)
        })
      }
      listen(surface, 'lostpointercapture', event => {
        const contact = contacts.get(`pointer:${event.pointerId}`)
        if (
          !contact ||
          event.timeStamp < contact.startedAt ||
          surface.hasPointerCapture?.(event.pointerId)
        )
          return
        finish(contact, 'cancel')
      })
    } else {
      listen(
        surface,
        'touchstart',
        event => {
          lastTouch = Date.now()
          const previouslyPrevented = event.defaultPrevented
          for (const point of event.changedTouches ?? [])
            start(
              `touch:${point.identifier}`,
              'touch',
              point,
              event,
              undefined,
              previouslyPrevented
            )
        },
        { passive: false }
      )
      listen(
        root,
        'touchmove',
        event => {
          lastTouch = Date.now()
          for (const point of event.changedTouches ?? [])
            move(contacts.get(`touch:${point.identifier}`), point, event)
        },
        { passive: false }
      )
      for (const [name, phase] of [
        ['touchend', 'end'],
        ['touchcancel', 'cancel'],
      ]) {
        listen(
          root,
          name,
          event => {
            lastTouch = Date.now()
            for (const point of event.changedTouches ?? [])
              finish(
                contacts.get(`touch:${point.identifier}`),
                phase,
                point,
                event
              )
          },
          { passive: false }
        )
      }
      listen(surface, 'mousedown', event => {
        if (event.button === 0 && Date.now() - lastTouch >= 800)
          start('mouse', 'mouse', event, event)
      })
      listen(root, 'mousemove', event => {
        const contact = contacts.get('mouse')
        if (!(event.buttons & 1)) finish(contact, 'cancel', event, event)
        else move(contact, event, event)
      })
      listen(root, 'mouseup', event =>
        finish(contacts.get('mouse'), 'end', event, event)
      )
    }
    listen(root, 'blur', cancelAll)
    listen(root.document, 'visibilitychange', () => {
      if (root.document.hidden) cancelAll()
    })
    function close() {
      if (closed) return
      closed = true
      enabled = false
      cancelAll()
      for (const remove of listeners) remove()
      surface.style.touchAction = previousTouchAction
    }
    listen(root, 'pagehide', close)
    return {
      get enabled() {
        return enabled && !closed
      },
      get contacts() {
        return [...contacts.values()]
          .map(
            contact =>
              payload(contact, 'move', contact.last) ?? {
                ...contact.lastPayload,
              }
          )
          .filter(Boolean)
      },
      cancel(ids) {
        if (!Array.isArray(ids)) return 0
        const selected = new Set(ids)
        let canceled = 0
        for (const contact of [...contacts.values()])
          if (selected.has(contact.id)) {
            finish(contact, 'cancel')
            canceled++
          }
        return canceled
      },
      setStartsAllowed(value) {
        if (closed) return false
        startsAllowed = Boolean(value)
        return true
      },
      setEnabled(value) {
        if (closed) return false
        if (!value) cancelAll()
        enabled = Boolean(value)
        return true
      },
      close,
    }
  }
  root.PNDSInput = { attachInput }
})(globalThis)
