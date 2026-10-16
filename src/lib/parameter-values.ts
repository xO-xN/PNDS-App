import type { ParameterSpec } from './tauri-bindings'
import type { ParameterValue } from './parameter-preview'

/** UI validation is immediate; the native binding remains authoritative. */
export function parameterValueValid(
  spec: ParameterSpec,
  value: unknown
): value is ParameterValue {
  const limits = spec.limits
  if (spec.kind === 'number') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (limits.min != null && value < limits.min) ||
      (limits.max != null && value > limits.max)
    )
      return false
    const steps = (value - (limits.min ?? 0)) / (limits.step ?? 1)
    return limits.step == null || Math.abs(steps - Math.round(steps)) < 1e-7
  }
  if (spec.kind === 'boolean') return typeof value === 'boolean'
  return (
    typeof value === 'string' &&
    value.length <= 4096 &&
    (limits.maxLength == null || [...value].length <= limits.maxLength) &&
    (spec.kind !== 'option' || (limits.options ?? []).includes(value)) &&
    (spec.kind !== 'color' || /^#[\da-f]{6}$/i.test(value))
  )
}
