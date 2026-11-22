/* global window, CustomEvent */
// Injected in the project world. Project callbacks and DOM references stay here.
;(() => {
  const channel = 'pnds:controller-targets:'
  const targets = new Map()
  let revision = 0
  const changed = () =>
    window.dispatchEvent(new CustomEvent(channel + 'change'))

  function register(definition) {
    const { id, name, kind, position, trigger, getValue, setValue } = definition
    if (
      typeof id !== 'string' ||
      !id.trim() ||
      typeof name !== 'string' ||
      !name.trim() ||
      (position != null && typeof position !== 'function')
    )
      throw new TypeError('Invalid controller target identity or position')

    let range = null
    if (kind === 'trigger') {
      if (typeof trigger !== 'function')
        throw new TypeError('Trigger targets require a trigger callback')
    } else if (kind === 'switch' || kind === 'continuous') {
      if (typeof getValue !== 'function' || typeof setValue !== 'function')
        throw new TypeError(
          'Value targets require getValue and setValue callbacks'
        )
      if (kind === 'continuous') {
        const { min, max, step = null } = definition
        if (
          !Number.isFinite(min) ||
          !Number.isFinite(max) ||
          min > max ||
          !Number.isFinite(max - min) ||
          (step !== null && (!Number.isFinite(step) || step <= 0))
        )
          throw new TypeError('Invalid continuous target range')
        range = { min, max, step, stepBase: min }
      }
    } else {
      throw new TypeError('Invalid controller target kind')
    }

    const descriptor = { id, name, kind, range, generation: ++revision }
    const target = { descriptor, position, trigger, getValue, setValue }
    targets.set(id, target)
    changed()
    return () => {
      if (targets.get(id) === target) {
        targets.delete(id)
        changed()
      }
    }
  }

  function call(request) {
    if (request.action === 'list')
      return Array.from(targets.values(), target => target.descriptor)

    const target = targets.get(request.id)
    if (target?.descriptor.generation !== request.generation) return null
    const { kind, range } = target.descriptor
    switch (request.action) {
      case 'position': {
        const rect = target.position?.()
        return rect
          ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          : null
      }
      case 'read': {
        const value = target.getValue?.()
        if (
          (kind === 'switch' && typeof value === 'boolean') ||
          (kind === 'continuous' && Number.isFinite(value))
        )
          return value
        return null
      }
      case 'trigger':
        if (kind !== 'trigger') return null
        target.trigger()
        return true
      case 'write': {
        const value = request.value
        if (
          (kind === 'switch' && typeof value === 'boolean') ||
          (kind === 'continuous' &&
            Number.isFinite(value) &&
            value >= range.min &&
            value <= range.max)
        ) {
          target.setValue(value)
          return true
        }
        return null
      }
    }
    return null
  }

  window.addEventListener(channel + 'request', event => {
    if (typeof event.detail !== 'string') return
    let message
    let value = null
    try {
      message = JSON.parse(event.detail)
      if (!message || !Number.isSafeInteger(message.sequence)) return
      value = call(message)
    } catch {
      // A project callback failure is local to this target.
    }
    if (message)
      window.dispatchEvent(
        new CustomEvent(channel + 'response', {
          detail: JSON.stringify({ sequence: message.sequence, value }),
        })
      )
  })

  Object.defineProperty(window, 'PNDSControllerMapping', {
    value: Object.freeze({ version: 1, register }),
  })
})()
