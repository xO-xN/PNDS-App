export type ParameterValue = number | boolean | string
type Values = Record<string, ParameterValue>
interface PreviewTarget {
  postMessage: (message: unknown, targetOrigin: string) => void
}
export type PreviewProblem =
  | 'unavailable'
  | 'incompatible'
  | 'loadedVersion'
  | 'feedback'
  | 'timeout'
  | 'cancelled'
  | 'restoreFailed'
export class PreviewError extends Error {
  constructor(readonly code: PreviewProblem) {
    super(code)
  }
}
function values(input: unknown): input is Values {
  return (
    !!input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    Object.keys(input).length <= 32 &&
    Object.values(input).every(
      value =>
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && value.length <= 4096)
    )
  )
}
function same(a: Values, b: Values) {
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([key, value]) => b[key] === value)
  )
}

/** Only declared values cross this boundary. A send never counts as feedback. */
export class ParameterPreviewConnection {
  readonly session = crypto.randomUUID()
  private sequence = 0
  private baseline: Values | null = null
  private supported = new Set<string>()
  private touched = new Set<string>()
  private pending: {
    sequence: number
    type: string
    expected?: Values
    resolve: (value: Values) => void
    reject: (error: PreviewError) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null
  private closed = false
  constructor(
    private target: PreviewTarget,
    private origin: string,
    private source: {
      path: string
      sourceDigest: string
      contractDigest: string
      ids?: string[]
    }
  ) {}
  private request(type: string, expected?: Values): Promise<Values> {
    if (this.closed) return Promise.reject(new PreviewError('cancelled'))
    this.fail('cancelled')
    const sequence = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(type === 'restore' ? 'restoreFailed' : 'timeout'),
        3000
      )
      this.pending = { sequence, type, expected, resolve, reject, timer }
      this.target.postMessage(
        {
          channel: 'pnds.preview',
          version: 1,
          session: this.session,
          sequence,
          type,
          ...(type === 'hello' && this.source.ids
            ? { ids: this.source.ids }
            : {}),
          ...(expected ? { values: expected } : {}),
        },
        this.origin
      )
    })
  }
  negotiate() {
    return this.request('hello')
  }
  set(update: Values) {
    if (
      !this.baseline ||
      !values(update) ||
      !Object.keys(update).length ||
      Object.keys(update).some(key => !this.supported.has(key))
    )
      return Promise.reject(new PreviewError('unavailable'))
    Object.keys(update).forEach(id => this.touched.add(id))
    return this.request('set', update)
  }
  restore() {
    if (!this.touched.size) return this.request('restore', {})
    if (!this.baseline) return Promise.reject(new PreviewError('restoreFailed'))
    const baseline = this.baseline
    const update: Values = {}
    for (const id of this.touched) {
      const value = baseline[id]
      if (value === undefined)
        return Promise.reject(new PreviewError('restoreFailed'))
      update[id] = value
    }
    return this.request('restore', update)
  }
  receive(event: { source: unknown; origin: string; data: unknown }) {
    if (
      this.closed ||
      event.source !== this.target ||
      event.origin !== this.origin
    )
      return
    const data = event.data as Record<string, unknown> | null
    const pending = this.pending
    if (
      !pending ||
      !data ||
      data.channel !== 'pnds.preview' ||
      data.version !== 1 ||
      data.session !== this.session ||
      data.sequence !== pending.sequence
    )
      return
    if (data.type === 'error') {
      this.fail(pending.type === 'restore' ? 'restoreFailed' : 'feedback')
      return
    }
    if (
      data.type !==
      { hello: 'ready', set: 'applied', restore: 'restored' }[pending.type]
    )
      return
    if (!values(data.values)) {
      this.fail('feedback')
      return
    }
    const observed = data.values
    if (pending.type === 'hello') {
      const loaded = data.loaded as Record<string, unknown> | null
      if (
        data.contractDigest !== this.source.contractDigest ||
        loaded?.[this.source.path] !== this.source.sourceDigest
      ) {
        this.fail('loadedVersion')
        return
      }
      if (
        !Array.isArray(data.supported) ||
        !data.supported.length ||
        data.supported.length > 32 ||
        data.supported.some(
          key => typeof key !== 'string' || !(key in observed)
        )
      ) {
        this.fail('incompatible')
        return
      }
      this.baseline = { ...data.values }
      this.supported = new Set(data.supported as string[])
    } else if (pending.expected && !same(pending.expected, data.values)) {
      this.fail(pending.type === 'restore' ? 'restoreFailed' : 'feedback')
      return
    }
    clearTimeout(pending.timer)
    this.pending = null
    pending.resolve(data.values)
  }
  supports(id: string) {
    return this.supported.has(id)
  }
  private fail(code: PreviewProblem) {
    if (!this.pending) return
    const pending = this.pending
    clearTimeout(pending.timer)
    this.pending = null
    pending.reject(new PreviewError(code))
  }
  dispose() {
    this.closed = true
    this.fail('cancelled')
  }
}

let monitor: {
  target: PreviewTarget
  origin: string
  navigation: object
} | null = null
const invalidations = new Set<() => void>()
export function bindPreviewMonitor(
  target: PreviewTarget | null,
  origin: string
) {
  invalidations.forEach(callback => callback())
  monitor = target ? { target, origin, navigation: {} } : null
}
export function previewMonitor() {
  return monitor
}
export function onPreviewMonitorInvalidated(callback: () => void) {
  invalidations.add(callback)
  return () => {
    invalidations.delete(callback)
  }
}
