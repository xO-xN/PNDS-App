import { confirm } from '@tauri-apps/plugin-dialog'
import i18n from '@/i18n/config'
import type { AssistantMessage } from './assistant-types'
import type { AssistantQuestion } from './tauri-bindings'
import type { AssistantHandoffSuggestion } from './assistant-flow'
import { useCreationStore } from '@/store/creation-store'
import { useCreationHandoffStore } from '@/store/creation-handoff-store'
import { toast } from 'sonner'
import { isHandoffRequest } from './assistant-workflow'
import { handoffLanguage } from './assistant-handoff-prompt'

/** Confirmation prepares an editable handoff. Its existing Record action is
 * still the only writer; declining leaves both project and draft untouched. */
export async function prepareAssistantHandoff(
  identity: string,
  intent: string,
  files: string[],
  acceptance: string
): Promise<boolean> {
  let approved: boolean
  try {
    approved = await confirm(i18n.t('assistant.check.handoffConfirm'), {
      title: i18n.t('assistant.check.handoff'),
      kind: 'warning',
    })
  } catch {
    toast.error(i18n.t('toast.error.generic'))
    return false
  }
  if (
    !approved ||
    useCreationStore.getState().workspace?.project.identity !== identity ||
    useCreationHandoffStore.getState().busy
  )
    return false
  await useCreationHandoffStore
    .getState()
    .prepareTask({ intent, files, acceptance })
  return useCreationStore.getState().workspace?.project.identity === identity
}

export interface HandoffDraftSource {
  id: string
  kind: 'creator' | 'suggestion' | 'answer' | 'question'
  text: string
  /** Accepted when restoring older checkpoints; new sources use their full text. */
  decision?: string
  selectedPlan?: { text: string; files?: string[]; acceptance?: string }
}

/** The caller must bind an explicit choice to a live displayed plan. Only its
 * final public text is selected; activity and provider reasoning are not plans.
 * Selection accepts the task, not factual verification of its reference data. */
export function selectedDiscussionPlan(
  message: AssistantMessage,
  suggestion?: AssistantHandoffSuggestion
): HandoffDraftSource {
  const t = i18n.getFixedT(
    handoffLanguage([{ role: 'user', text: message.text }])
  )
  const [goal = '', ...legacyLines] =
    suggestion?.intent.trim().split(/\r?\n/) ?? []
  // Remove only a complete public-plan copy on line boundaries. Keep other
  // legacy text whole so shared fences/headings cannot strip unique context.
  const publicText = message.text.replace(/\r\n/g, '\n').trim()
  const legacyText = `\n${legacyLines.join('\n').trim()}\n`
  const remaining = publicText
    ? legacyText.replaceAll(`\n${publicText}\n`, '\n').trim()
    : legacyText.trim()
  const legacyDetails = publicText.includes(remaining) ? '' : remaining
  const details = [message.text, ...(legacyDetails ? [legacyDetails] : [])]
  if (
    suggestion?.knownProblems &&
    !details.join('\n\n').includes(suggestion.knownProblems)
  )
    details.push(
      `${t('assistant.handoff.knownProblems')}: ${suggestion.knownProblems}`
    )
  return {
    id: `${message.id}:selected-plan`,
    kind: 'creator',
    text:
      goal && !message.text.trimStart().startsWith(goal)
        ? t('assistant.workflow.selectedPlan', {
            intent: goal,
            details: details.join('\n\n'),
          })
        : details.join('\n\n'),
    selectedPlan: {
      text: message.text,
      ...(suggestion
        ? { files: suggestion.files, acceptance: suggestion.acceptance }
        : {}),
    },
  }
}

function submittedAnswerText(question: AssistantQuestion) {
  if (question.status !== 'answered') return undefined
  const text = question.answer?.text?.trim()
  if (text) return text
  const choice = question.options.find(
    option => option.id === question.answer?.optionId
  )
  return choice
    ? [choice.label, choice.description].filter(Boolean).join('\n')
    : undefined
}

export class HandoffDraftValidationError extends Error {
  constructor(
    readonly reason:
      | 'json'
      | 'fields'
      | 'section'
      | 'attribution'
      | 'incomplete'
      | 'unresolved'
  ) {
    super(`Invalid handoff draft: ${reason}`)
  }
}

/** The caller supplies one conversation, never the complete project transcript.
 * Source IDs make creator decisions distinct from unaccepted model suggestions. */
export function handoffDraftInput(messages: readonly AssistantMessage[]) {
  const sources: HandoffDraftSource[] = []
  for (const message of messages) {
    if (
      message.contextMarker ||
      message.sources.some(source => source.material)
    )
      continue
    if (
      message.status === 'completed' &&
      message.text.trim() &&
      !(message.role === 'user' && isHandoffRequest(message.text))
    )
      sources.push({
        id: message.id,
        kind: message.role === 'user' ? 'creator' : 'suggestion',
        text: message.text,
      })
    for (const question of message.questions ?? []) {
      if (message.status !== 'completed' && question.status !== 'answered')
        continue
      const text = submittedAnswerText(question)
      sources.push({
        id: `${message.id}:${question.id}`,
        kind: question.status === 'answered' && text ? 'answer' : 'question',
        text: `${question.prompt}${question.status === 'answered' && text ? `\nCreator answer: ${text}` : ''}`,
      })
    }
  }
  return {
    input: JSON.stringify({
      sources: sources.map(({ id, kind, text }) => ({ id, kind, text })),
    }),
    sources,
  }
}

/** Selected public plans and submitted choices remain the task, not a second
 * model's interpretation of the action used to export them. */
export function selectedHandoffIntent(sources: readonly HandoffDraftSource[]) {
  const selected = sources.find(source => source.selectedPlan)
  const plan = selected?.selectedPlan
  const decisions = [
    ...new Map(
      sources
        .filter(source => source.kind === 'answer')
        .map(source => [source.id, source.text])
    ).values(),
  ]
  const heading = decisions.length
    ? i18n.getFixedT(
        handoffLanguage([{ role: 'user', text: plan?.text ?? '' }])
      )('assistant.handoff.confirmedDecisions')
    : ''
  return [selected?.text ?? '', heading, ...decisions]
    .filter(Boolean)
    .join('\n\n')
}

export function selectedHandoffTask(sources: readonly HandoffDraftSource[]) {
  const plan = sources.find(source => source.selectedPlan)?.selectedPlan
  return plan?.files?.length && plan.acceptance
    ? {
        intent: selectedHandoffIntent(sources),
        files: plan.files,
        acceptance: plan.acceptance,
      }
    : undefined
}

export function parseHandoffDraft(
  text: string,
  sources: readonly HandoffDraftSource[]
) {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new HandoffDraftValidationError('json')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HandoffDraftValidationError('fields')
  const draft = value as Record<string, unknown>
  if (
    Object.keys(draft).sort().join(',') !==
    'acceptance,confirmedRequirements,files,openQuestions,suggestions'
  )
    throw new HandoffDraftValidationError('fields')
  const allowed = new Map(sources.map(source => [source.id, source.kind]))
  const items = (field: string, decisionsOnly = false) => {
    const entries = draft[field]
    if (!Array.isArray(entries) || entries.length > 32)
      throw new HandoffDraftValidationError('section')
    return entries.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        throw new HandoffDraftValidationError('attribution')
      const item = entry as Record<string, unknown>
      if (
        Object.keys(item).sort().join(',') !== 'sourceIds,text' ||
        typeof item.text !== 'string' ||
        !item.text.trim() ||
        item.text.length > 8192 ||
        !Array.isArray(item.sourceIds) ||
        !item.sourceIds.length ||
        item.sourceIds.length > 8 ||
        !item.sourceIds.every(
          id => typeof id === 'string' && allowed.has(id)
        ) ||
        (decisionsOnly &&
          !item.sourceIds.some(id =>
            ['creator', 'answer'].includes(allowed.get(id) ?? '')
          ))
      )
        throw new HandoffDraftValidationError('attribution')
      return item.text.trim()
    })
  }
  const requirements = items('confirmedRequirements', true)
  const acceptance = items('acceptance', true)
  const suggestions = items('suggestions')
  const questions = items('openQuestions')
  if (questions.length) throw new HandoffDraftValidationError('unresolved')
  if (
    !requirements.length ||
    !acceptance.length ||
    !Array.isArray(draft.files) ||
    !draft.files.length ||
    draft.files.length > 128 ||
    !draft.files.every(
      path =>
        typeof path === 'string' &&
        path.length <= 1024 &&
        !/[\\\r\n]/.test(path) &&
        path.split('/').every(part => part && part !== '.' && part !== '..')
    )
  )
    throw new HandoffDraftValidationError('incomplete')
  const selected = sources.find(source => source.selectedPlan)?.selectedPlan
  if (
    selected &&
    !selected.files &&
    (!(draft.files as string[]).every(path => selected.text.includes(path)) ||
      !acceptance.every(item => selected.text.includes(item)))
  )
    throw new HandoffDraftValidationError('attribution')
  const sections = [selected?.acceptance ?? acceptance.join('\n')]
  if (suggestions.length && !selected)
    sections.push(
      `${i18n.t('assistant.handoff.unacceptedSuggestions')}\n${suggestions.join('\n')}`
    )
  return {
    intent: selected ? selectedHandoffIntent(sources) : requirements.join('\n'),
    files: selected?.files ?? (draft.files as string[]),
    acceptance: sections.join('\n\n'),
  }
}

export function handoffAnswerSources(
  questions: readonly AssistantQuestion[]
): HandoffDraftSource[] {
  return questions.flatMap(question => {
    const text = submittedAnswerText(question)
    return question.status === 'answered' && text
      ? [
          {
            id: `${question.scope.messageId}:${question.id}`,
            kind: 'answer' as const,
            text: `${question.prompt}\nCreator answer: ${text}`,
          },
        ]
      : []
  })
}
