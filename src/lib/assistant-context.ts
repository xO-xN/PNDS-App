import { questionEvidence } from './assistant-questions'
import type { AssistantMessage } from './assistant-types'
import type {
  AssistantSummarySections,
  ModelServiceConfig,
  AssistantProjectSnapshot,
  CreationMaterial,
} from './tauri-bindings'
import { modelProfileKey } from './model-context-settings'

export const SUMMARY_FIELDS = [
  'userDecisions',
  'assistantSuggestions',
  'verifiedFacts',
  'unverifiedFacts',
  'openQuestions',
] as const

function scopeEligible(
  message: AssistantMessage,
  serviceKey?: string,
  project?: AssistantProjectSnapshot,
  materials?: readonly CreationMaterial[]
): boolean {
  return (
    !message.contextMarker &&
    message.sources.every(
      source =>
        !source.material ||
        (message.scope === 'project' &&
          project !== undefined &&
          materials?.some(
            material =>
              material.id === source.material?.material.id &&
              material.version === source.material.material.version
          ))
    ) &&
    (!serviceKey || message.contextServiceKey === serviceKey)
  )
}

function eligible(
  message: AssistantMessage,
  serviceKey?: string,
  project?: AssistantProjectSnapshot,
  materials?: readonly CreationMaterial[]
): boolean {
  return (
    scopeEligible(message, serviceKey, project, materials) &&
    message.status === 'completed' &&
    (message.scope === 'platform' ||
      (project !== undefined &&
        message.sources.every(
          source =>
            !source.project ||
            project.files.some(
              file =>
                !file.reason &&
                file.path === source.project?.path &&
                file.version === source.project.version
            )
        ))) &&
    !message.attachments?.length &&
    !message.proposals?.length
  )
}

/** Creator statements keep their original message/question provenance. Saved
 * source revisions invalidate code evidence, not the creator's own answer.
 * Material, topic, service and project-reading boundaries still apply. */
export function creatorContextRecords(
  history: readonly AssistantMessage[],
  serviceKey?: string,
  project?: AssistantProjectSnapshot,
  materials?: readonly CreationMaterial[]
) {
  if (!project) return []
  const boundary = history
    .map(message => message.contextMarker?.type === 'topic')
    .lastIndexOf(true)
  return history.slice(boundary + 1).flatMap(message => {
    if (
      !scopeEligible(message, serviceKey, project, materials) ||
      (message.scope === 'project' && !project)
    )
      return []
    const input =
      message.role === 'user' &&
      message.status === 'completed' &&
      !message.attachments?.length &&
      !message.proposals?.length &&
      message.text.trim()
        ? [
            {
              sourceId: message.id,
              kind: 'creatorInput' as const,
              text: message.text,
            },
          ]
        : []
    const answers = (message.questions ?? [])
      .filter(question => question.status === 'answered' && question.answer)
      .map(question => ({
        sourceId: message.id,
        kind: 'submittedAnswer' as const,
        question: questionEvidence([question], {
          includeMaterialConflict: false,
        })[0],
      }))
    return [...input, ...answers]
  })
}

export function completeContextRounds(
  history: readonly AssistantMessage[],
  serviceKey?: string,
  project?: AssistantProjectSnapshot,
  materials?: readonly CreationMaterial[]
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
      (!user.skill || !!user.text.trim()) &&
      eligible(user, serviceKey, project, materials) &&
      eligible(reply, serviceKey, project, materials)
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
  config?: ModelServiceConfig,
  project?: AssistantProjectSnapshot,
  materials?: readonly CreationMaterial[]
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
            (message.scope === 'platform' || project !== undefined) &&
            marker.sourceIds.every(id => {
              const source = history.find(source => source.id === id)
              return (
                source &&
                history.indexOf(source) > boundary &&
                eligible(source, key, project, materials)
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
  const recent = completeContextRounds(history, key, project, materials)
    .filter(round => history.indexOf(round[0]) > lastCovered)
    .slice(-6)
    .flat()
  return {
    recent,
    summary,
    creatorRecords: creatorContextRecords(history, key, project, materials),
    excluded: history.filter(
      message => !message.contextMarker && !recent.includes(message)
    ).length,
  }
}

export function summaryInput(
  history: readonly AssistantMessage[],
  config: ModelServiceConfig,
  roundLimit = 8,
  project?: AssistantProjectSnapshot,
  materials?: readonly CreationMaterial[]
) {
  const older = completeContextRounds(
    history,
    modelProfileKey(config),
    project,
    materials
  ).slice(0, -2)
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
        questions: questionEvidence(message.questions),
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
