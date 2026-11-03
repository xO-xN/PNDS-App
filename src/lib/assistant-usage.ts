import type { AssistantRoundUsage, ModelUsage } from './tauri-bindings'

type PreviousCalls = NonNullable<AssistantRoundUsage['previousCalls']>
const fields = [
  'inputTokens',
  'outputTokens',
  'cachedInputTokens',
  'reasoningTokens',
] as const

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0

/** Check persisted totals before reusing them as cumulative request evidence. */
export function validAssistantPreviousCalls(
  value: unknown
): value is PreviousCalls {
  if (
    !record(value) ||
    Object.keys(value).some(
      key => !['count', 'unknown', 'usage'].includes(key)
    ) ||
    !count(value.count) ||
    value.count === 0 ||
    !count(value.unknown) ||
    value.unknown > value.count ||
    !record(value.usage)
  )
    return false
  const usage = value.usage
  if (
    Object.keys(usage).some(key => !fields.some(field => field === key)) ||
    !fields.every(field => usage[field] === null || count(usage[field]))
  )
    return false
  return (
    (value.unknown === 0) ===
    (usage.inputTokens !== null && usage.outputTokens !== null)
  )
}

/** Keep recent per-call evidence bounded without losing cumulative consumption.
 * A missing field stays unknown when older calls are folded into the total. */
export function appendAssistantUsage(
  calls: AssistantRoundUsage['calls'],
  previousCalls: PreviousCalls | null | undefined,
  call: ModelUsage | null
): PreviousCalls | undefined {
  calls.push(call)
  if (calls.length <= 128) return previousCalls ?? undefined
  const previous: PreviousCalls = previousCalls
    ? structuredClone(previousCalls)
    : {
        count: 0,
        unknown: 0,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        },
      }
  while (calls.length > 128) {
    const removed = calls.shift()
    previous.count++
    if (removed?.inputTokens == null || removed.outputTokens == null)
      previous.unknown++
    for (const field of fields) {
      const total = previous.usage[field]
      const value = removed?.[field]
      previous.usage[field] =
        total == null || value == null ? null : total + value
    }
  }
  return previous
}

export function assistantUsageComplete(
  calls: AssistantRoundUsage['calls'],
  previousCalls?: PreviousCalls | null
): boolean {
  return (
    (!previousCalls ||
      (previousCalls.unknown === 0 &&
        previousCalls.usage.inputTokens != null &&
        previousCalls.usage.outputTokens != null)) &&
    calls.every(call => call?.inputTokens != null && call.outputTokens != null)
  )
}
