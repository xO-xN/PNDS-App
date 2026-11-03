import type { AssistantToolCall } from './assistant-types'

const MAX_IDLE_TURNS = 12
const MAX_READ_ONLY_TURNS = 48
const MAX_REPEATED_GROUPS = 3

/** Small request-local facts. Stage rotation preserves them; an explicit creator
 * continuation after a progress pause may begin a new observation window. */
export interface AssistantProgress {
  idleTurns: number
  readOnlyTurns: number
  recent: string[]
  savedStates?: string[]
}

export interface AssistantProgressObservation {
  calls: readonly AssistantToolCall[]
  results: readonly string[]
  savedFingerprintBefore?: string
  savedFingerprintAfter?: string
  newEvidence: boolean
  /** Newly verified saved input, not merely another request for the same check. */
  checked?: boolean
}

export function validAssistantProgress(
  value: unknown
): value is AssistantProgress {
  if (value === null || typeof value !== 'object') return false
  const state = value as Record<string, unknown>
  return (
    Number.isSafeInteger(state.idleTurns) &&
    Number(state.idleTurns) >= 0 &&
    Number(state.idleTurns) <= MAX_IDLE_TURNS &&
    Number.isSafeInteger(state.readOnlyTurns) &&
    Number(state.readOnlyTurns) >= 0 &&
    Number(state.readOnlyTurns) <= MAX_READ_ONLY_TURNS &&
    Array.isArray(state.recent) &&
    state.recent.length <= MAX_IDLE_TURNS &&
    state.recent.every(
      signature =>
        typeof signature === 'string' && /^[a-f0-9]{16}$/.test(signature)
    ) &&
    (state.savedStates === undefined ||
      (Array.isArray(state.savedStates) &&
        state.savedStates.length <= MAX_IDLE_TURNS &&
        state.savedStates.every(
          signature =>
            typeof signature === 'string' && /^[a-f0-9]{16}$/.test(signature)
        )))
  )
}

const referenceKeys = new Set(['toolCallId', 'callId', 'reusedFrom'])

function canonical(value: unknown, result: boolean): unknown {
  if (Array.isArray(value)) return value.map(item => canonical(item, result))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !result || !referenceKeys.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry, result)])
  )
}

function json(text: string, result = false): unknown {
  try {
    return canonical(JSON.parse(text), result)
  } catch {
    return text
  }
}

/** Hash only for repetition detection. It is neither source identity nor a
 * security boundary; no prompt, arguments or source text enter the checkpoint. */
function signature(observation: AssistantProgressObservation): string {
  return hash(
    JSON.stringify([
      observation.calls.map(call => [call.name, json(call.arguments)]),
      observation.results.map(result => json(result, true)),
    ])
  )
}

function hash(text: string): string {
  let first = 2166136261
  let second = 3339675911
  for (let index = 0; index < text.length; index++) {
    first = Math.imul(first ^ text.charCodeAt(index), 16777619)
    second = Math.imul(second ^ text.charCodeAt(index), 2246822519)
  }
  return [first, second]
    .map(value => (value >>> 0).toString(16).padStart(8, '0'))
    .join('')
}

/** Observe only complete tool groups, after their durable checkpoint boundary.
 * Actual reads may advance over many pages; empty searches, refused writes and
 * repeated reuse receipts do not establish new evidence or saved progress. */
export function advanceAssistantProgress(
  previous: AssistantProgress | undefined,
  observation: AssistantProgressObservation
): {
  state: AssistantProgress
  reason: 'repeatedTools' | 'noEvidence' | 'readOnly' | 'savedCycle' | null
} {
  const changed =
    observation.savedFingerprintBefore !== undefined &&
    observation.savedFingerprintAfter !== undefined &&
    observation.savedFingerprintBefore !== observation.savedFingerprintAfter
  const savedStates = changed
    ? [
        ...(previous?.savedStates ?? []),
        hash(observation.savedFingerprintAfter ?? ''),
      ].slice(-MAX_IDLE_TURNS)
    : previous?.savedStates
  if (changed || observation.checked)
    return {
      state: {
        idleTurns: 0,
        readOnlyTurns: 0,
        recent: [],
        ...(savedStates ? { savedStates: [...savedStates] } : {}),
      },
      reason:
        changed &&
        (savedStates?.filter(entry => entry === savedStates.at(-1)).length ??
          0) >= MAX_REPEATED_GROUPS
          ? 'savedCycle'
          : null,
    }
  const current = signature(observation)
  const state: AssistantProgress = {
    ...(savedStates ? { savedStates: [...savedStates] } : {}),
    idleTurns: observation.newEvidence
      ? 0
      : Math.min(MAX_IDLE_TURNS, (previous?.idleTurns ?? 0) + 1),
    readOnlyTurns: Math.min(
      MAX_READ_ONLY_TURNS,
      (previous?.readOnlyTurns ?? 0) + 1
    ),
    recent: observation.newEvidence
      ? []
      : [...(previous?.recent ?? []), current].slice(-MAX_IDLE_TURNS),
  }
  const reason =
    state.recent.filter(entry => entry === current).length >=
    MAX_REPEATED_GROUPS
      ? 'repeatedTools'
      : state.idleTurns >= MAX_IDLE_TURNS
        ? 'noEvidence'
        : state.readOnlyTurns >= MAX_READ_ONLY_TURNS
          ? 'readOnly'
          : null
  return { state, reason }
}
