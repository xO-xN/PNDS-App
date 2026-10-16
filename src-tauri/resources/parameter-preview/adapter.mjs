/** PNDS preview protocol 1. Project-authored callbacks only; never eval input.
 * Capture sources/contractDigest when this runtime loads its actual code.
 * Copying this optional adapter and wiring effects is an explicit project edit.
 */
export function installPreviewAdapter(config, page = globalThis.window) {
  const parameters = config.parameters
  const ids = Object.keys(parameters)
  let active = null
  let queue = Promise.resolve()
  let disposed = false
  const valid = (id, value) => {
    const parameter = parameters[id]
    if (!parameter) return false
    const limits = parameter.limits ?? {}
    switch (parameter.kind) {
      case 'number': {
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          (limits.min != null && value < limits.min) ||
          (limits.max != null && value > limits.max)
        )
          return false
        const count = (value - (limits.min ?? 0)) / (limits.step ?? 1)
        return limits.step == null || Math.abs(count - Math.round(count)) < 1e-7
      }
      case 'boolean':
        return typeof value === 'boolean'
      case 'text':
      case 'color':
      case 'option':
        return (
          typeof value === 'string' &&
          value.length <= 4096 &&
          (limits.maxLength == null || [...value].length <= limits.maxLength) &&
          (parameter.kind !== 'color' || /^#[\da-f]{6}$/i.test(value)) &&
          (parameter.kind !== 'option' || limits.options?.includes(value))
        )
      default:
        return false
    }
  }
  const snapshot = keys =>
    Object.fromEntries(keys.map(id => [id, parameters[id].get()]))
  const apply = async update => {
    for (const [id, value] of Object.entries(update))
      await parameters[id].set(value)
    const observed = snapshot(Object.keys(update))
    if (Object.entries(update).some(([id, value]) => observed[id] !== value))
      throw new Error('effect not observed')
    return observed
  }
  const listener = event => {
    const message = event.data
    if (
      disposed ||
      event.source !== page.parent ||
      event.origin !== config.hostOrigin ||
      !message ||
      message.channel !== 'pnds.preview' ||
      message.version !== 1 ||
      typeof message.session !== 'string' ||
      message.session.length > 80 ||
      !Number.isSafeInteger(message.sequence) ||
      message.sequence < 1 ||
      !['hello', 'set', 'restore'].includes(message.type)
    )
      return
    if (
      message.type !== 'hello' &&
      active &&
      (active.session !== message.session || message.sequence <= active.latest)
    )
      return
    if (
      active?.session === message.session &&
      message.sequence <= active.latest
    )
      return
    if (active?.session === message.session) active.latest = message.sequence
    queue = queue.then(async () => {
      if (disposed) return
      const reply = (type, extra = {}) =>
        page.parent.postMessage(
          {
            channel: 'pnds.preview',
            version: 1,
            session: message.session,
            sequence: message.sequence,
            type,
            ...extra,
          },
          config.hostOrigin
        )
      try {
        if (message.type === 'hello') {
          if (active && active.session !== message.session)
            throw new Error('end the active preview before negotiating another')
          const requested = Array.isArray(message.ids)
            ? message.ids.filter(id => ids.includes(id))
            : ids
          const baseline =
            active?.session === message.session
              ? active.baseline
              : snapshot(requested)
          if (
            requested.length < 1 ||
            requested.length > 32 ||
            requested.some(id => !valid(id, baseline[id]))
          )
            throw new Error('invalid adapter baseline')
          active = {
            session: message.session,
            latest: message.sequence,
            baseline,
            touched: new Set(),
          }
          reply('ready', {
            loaded: config.sources,
            contractDigest: config.contractDigest,
            supported: requested,
            values: baseline,
          })
        } else {
          if (
            active?.session !== message.session ||
            (message.type === 'set' && message.sequence < active.latest)
          )
            return
          const update =
            message.type === 'restore'
              ? Object.fromEntries(
                  [...active.touched].map(id => [id, active.baseline[id]])
                )
              : message.values
          if (
            !update ||
            typeof update !== 'object' ||
            Array.isArray(update) ||
            Object.keys(update).length > 32 ||
            !Object.entries(update).every(
              ([id, value]) =>
                Object.hasOwn(active.baseline, id) && valid(id, value)
            )
          )
            throw new Error('invalid values')
          if (message.type === 'set')
            Object.keys(update).forEach(id => active.touched.add(id))
          const values = await apply(update)
          reply(message.type === 'restore' ? 'restored' : 'applied', { values })
          if (message.type === 'restore') active = null
        }
      } catch {
        reply('error')
      }
    })
  }
  page.addEventListener('message', listener)
  return () => {
    disposed = true
    page.removeEventListener('message', listener)
  }
}
