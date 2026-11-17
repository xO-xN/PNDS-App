import { createRequire } from 'node:module'

const { attachMonitorState } = createRequire(import.meta.url)(
  '../modules/pnds-monitor-state/monitor-state.js'
)
const viewEvents = {
  monitorSnapshot: 'view:snapshot',
  monitorSet: 'view:set',
  monitorState: 'view:state',
  monitorError: 'view:error',
}
const copy = value =>
  JSON.parse(
    JSON.stringify(value, (_key, entry) => {
      if (typeof entry === 'number' && !Number.isFinite(entry))
        throw new Error('Monitor view declarations require finite JSON values')
      return entry
    })
  )
const kind = value =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value

// Only author-declared, low-frequency view choices belong here. Identity,
// performance input, score time and the App's QR/projection state stay separate.
export function prepareMonitorView(declarations) {
  if (!declarations || kind(declarations) !== 'object')
    throw new Error('Monitor view declarations must be an object')
  const defaults = Object.create(null)
  const validators = Object.create(null)
  for (const [key, field] of Object.entries(declarations)) {
    if (
      !field ||
      kind(field) !== 'object' ||
      !Object.hasOwn(field, 'default') ||
      Object.keys(field).some(
        name => !['default', 'values', 'min', 'max'].includes(name)
      )
    )
      throw new Error(`Invalid monitor view declaration: ${key}`)
    const expectedKind = kind(field.default)
    const valid = value => {
      if (kind(value) !== expectedKind) return false
      if (
        field.values &&
        !field.values.some(
          option => JSON.stringify(option) === JSON.stringify(value)
        )
      )
        return false
      if (Object.hasOwn(field, 'min') && value < field.min) return false
      if (Object.hasOwn(field, 'max') && value > field.max) return false
      return true
    }
    if (
      (Object.hasOwn(field, 'values') &&
        (!Array.isArray(field.values) || !field.values.length)) ||
      ['min', 'max'].some(
        bound =>
          Object.hasOwn(field, bound) &&
          (expectedKind !== 'number' || !Number.isFinite(field[bound]))
      ) ||
      (Object.hasOwn(field, 'min') &&
        Object.hasOwn(field, 'max') &&
        field.min > field.max) ||
      !valid(field.default)
    )
      throw new Error(`Invalid monitor view default or limits: ${key}`)
    defaults[key] = copy(field.default)
    validators[key] = valid
  }
  const configuration = copy(declarations)
  return {
    declarations: configuration,
    attach(io) {
      if (!Object.keys(defaults).length) return null
      return attachMonitorState(io.of('/monitor-view'), {
        events: viewEvents,
        defaults,
        validators,
      })
    },
  }
}
