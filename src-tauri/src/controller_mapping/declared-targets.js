/* global window, CustomEvent, location */
// Injected in the private mapping world. Only scalar data crosses the DOM.
;(() => {
  const channel = 'pnds:controller-targets:'
  let nextSequence = 0
  function query(action, target, value) {
    const sequence = ++nextSequence
    let result = null
    function read(event) {
      if (typeof event.detail !== 'string') return
      try {
        const reply = JSON.parse(event.detail)
        if (reply?.sequence === sequence) result = reply.value
      } catch {
        // Ignore malformed replies from the project document.
      }
    }
    window.addEventListener(channel + 'response', read)
    try {
      window.dispatchEvent(
        new CustomEvent(channel + 'request', {
          detail: JSON.stringify({
            action,
            sequence,
            id: target?.id,
            generation: target?.generation,
            value,
          }),
        })
      )
    } finally {
      window.removeEventListener(channel + 'response', read)
    }
    return result
  }

  function createRegistry(changed) {
    let targets = new Map()
    function refresh() {
      const registrations = query('list')
      const previous = targets
      targets = new Map()
      if (!Array.isArray(registrations)) return
      for (const entry of registrations) {
        if (
          typeof entry?.id !== 'string' ||
          typeof entry.name !== 'string' ||
          !['trigger', 'switch', 'continuous'].includes(entry.kind)
        )
          continue
        const id = `declared:${JSON.stringify([location.pathname, entry.id])}`
        const current = previous.get(id)
        targets.set(
          id,
          current?.generation === entry.generation
            ? current
            : {
                ...entry,
                descriptor: {
                  id,
                  name: entry.name,
                  kind: entry.kind,
                  range: entry.range,
                  temporary: false,
                },
              }
        )
      }
    }

    function resolve(descriptor) {
      const entry = targets.get(descriptor.id)
      return entry?.kind === descriptor.kind ? entry : null
    }

    function bounds(descriptor) {
      const entry = resolve(descriptor)
      if (!entry) return null
      const rect = query('position', entry)
      if (
        !rect ||
        ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
        rect.width <= 0 ||
        rect.height <= 0
      )
        return null
      return {
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }
    }

    window.addEventListener(channel + 'change', () => {
      refresh()
      changed()
    })

    return {
      refresh,
      resolve,
      bounds,
      descriptors: () =>
        Array.from(targets.values(), entry => entry.descriptor),
      read: target => query('read', target),
      write: (target, value) => query('write', target, value),
      trigger: target => query('trigger', target),
    }
  }

  Object.defineProperty(globalThis, '__pndsDeclaredTargets', {
    value: createRegistry,
  })
})()
