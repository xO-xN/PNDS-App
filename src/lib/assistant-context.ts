import type { AssistantMessage } from './assistant-types'
import type {
  AssistantSummarySections,
  ModelServiceConfig,
} from './tauri-bindings'
import { modelProfileKey } from './model-context-settings'

export const SUMMARY_FIELDS = [
  'userDecisions',
  'assistantSuggestions',
  'verifiedFacts',
  'unverifiedFacts',
  'openQuestions',
] as const

function eligible(message: AssistantMessage, serviceKey?: string): boolean {
  return (
    !message.contextMarker &&
    message.status === 'completed' &&
    message.scope === 'platform' &&
    !message.attachments?.length &&
    !message.proposals?.length &&
    (!serviceKey || message.contextServiceKey === serviceKey)
  )
}

export function completeContextRounds(
  history: readonly AssistantMessage[],
  serviceKey?: string
): [AssistantMessage, AssistantMessage][] {
  const boundary = history
    .map(message => message.contextMarker?.type === 'topic')
    .lastIndexOf(true)
  const rounds: [AssistantMessage, AssistantMessage][] = []
  for (let index = boundary + 1; index < history.length - 1; index++) {
    const user = history[index]
    const reply = history[index + 1]
    if (!user || !reply) continue
    if (
      user.role === 'user' &&
      reply.role === 'assistant' &&
      eligible(user, serviceKey) &&
      eligible(reply, serviceKey)
    ) {
      rounds.push([user, reply])
      index++
    }
  }
  return rounds
}

/** Full records stay untouched. Only complete protocol-free user/reply rounds
 * enter future calls; document-tool transcripts are never partially replayed. */
export function selectAssistantContext(
  history: readonly AssistantMessage[],
  config?: ModelServiceConfig
) {
  const key = config ? modelProfileKey(config) : undefined
  const boundary = history
    .map(message => message.contextMarker?.type === 'topic')
    .lastIndexOf(true)
  const summary = key
    ? history
        .slice(boundary + 1)
        .filter(message => {
          const marker = message.contextMarker
          return (
            marker?.type === 'summary' &&
            marker.serviceKey === key &&
            message.scope === 'platform' &&
            marker.sourceIds.every(id => {
              const source = history.find(source => source.id === id)
              return (
                source &&
                history.indexOf(source) > boundary &&
                eligible(source, key)
              )
            })
          )
        })
        .at(-1)
    : undefined
  const covered = new Set(
    summary?.contextMarker?.type === 'summary'
      ? summary.contextMarker.sourceIds
      : []
  )
  const lastCovered = history
    .map(message => covered.has(message.id))
    .lastIndexOf(true)
  const recent = completeContextRounds(history, key)
    .filter(round => history.indexOf(round[0]) > lastCovered)
    .slice(-6)
    .flat()
  return {
    recent,
    summary,
    excluded: history.filter(
      message => !message.contextMarker && !recent.includes(message)
    ).length,
  }
}

export function summaryInput(
  history: readonly AssistantMessage[],
  config: ModelServiceConfig,
  roundLimit = 8
) {
  const older = completeContextRounds(history, modelProfileKey(config)).slice(
    0,
    -2
  )
  const source = older
    .slice(-Math.max(1, Math.min(200, Math.trunc(roundLimit))))
    .flat()
  return {
    source,
    totalOlderRounds: older.length,
    input: JSON.stringify(
      source.map(message => ({
        id: message.id,
        role: message.role,
        text: message.text,
        sources: message.sources,
      }))
    ),
  }
}

export function parseAssistantSummary(
  text: string,
  sourceIds: readonly string[]
): AssistantSummarySections {
  const parsed: unknown = JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```$/, '')
  )
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('invalidSummary')
  const value = parsed as Record<string, unknown>
  if (
    Object.keys(value).length !== SUMMARY_FIELDS.length ||
    SUMMARY_FIELDS.some(field => !Array.isArray(value[field]))
  )
    throw new Error('invalidSummary')
  let count = 0
  for (const field of SUMMARY_FIELDS) {
    const items = value[field] as unknown[]
    if (items.length > 32) throw new Error('invalidSummary')
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        throw new Error('invalidSummary')
      const entry = item as Record<string, unknown>
      if (
        Object.keys(entry).length !== 2 ||
        typeof entry.text !== 'string' ||
        !entry.text.trim() ||
        new TextEncoder().encode(entry.text).length > 4096 ||
        !Array.isArray(entry.sourceIds) ||
        !entry.sourceIds.length ||
        entry.sourceIds.length > 32 ||
        entry.sourceIds.some(
          id => typeof id !== 'string' || !sourceIds.includes(id)
        )
      )
        throw new Error('invalidSummary')
      count++
    }
  }
  if (!count) throw new Error('invalidSummary')
  return value as unknown as AssistantSummarySections
}
