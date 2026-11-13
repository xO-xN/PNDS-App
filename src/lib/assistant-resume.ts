import { validOrganizationSources } from './assistant-organization'
import { validAssistantProgress } from './assistant-progress'
import { validAssistantPreviousCalls } from './assistant-usage'
import type { AssistantContinuation } from './assistant-flow'
import { validAssistantSkillCapture } from './assistant-skills'
import { validReadmeVariantDecision } from './assistant-readme-skill'
import type {
  AssistantHistoryAttachment,
  AssistantTaskResume,
  AssistantTaskResumeRecovery,
} from './tauri-bindings'
import type { AssistantMessage } from './assistant-types'
import type { AssistantSource, AssistantWireMessage } from './assistant-types'
import type { HelpTree } from './help-corpus'
import { commands } from './tauri-bindings'

const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** The version-1 disk format is an allowlist, independent of runtime readers,
 * grants and future fields added to the in-memory continuation. */
type CheckpointFacts = Pick<
  AssistantContinuation,
  | 'stage'
  | 'progress'
  | 'previousCalls'
  | 'organizationSources'
  | 'fileReferences'
  | 'skill'
  | 'readmeDecision'
  | 'purpose'
  | 'handoffDraftSources'
  | 'handoffDraftKey'
  | 'handoffDraftClarificationAfter'
  | 'taskId'
  | 'waitingQuestionId'
  | 'questionScope'
  | 'projectFingerprint'
  | 'messages'
  | 'sources'
  | 'text'
  | 'activity'
  | 'interruption'
  | 'toolCalls'
  | 'toolCharacters'
  | 'callIds'
  | 'calls'
  | 'returnedCharacters'
  | 'reusedCharacters'
  | 'handoff'
  | 'discussionRepairAttempted'
  | 'discussionFallbackText'
  | 'workingTargetBytes'
  | 'contextRecoveries'
  | 'outputRecoveries'
  | 'lastCheck'
  | 'lastCheckId'
  | 'needsCheck'
  | 'projectSnapshot'
  | 'materialEvidence'
>

function checkpointFacts(value: CheckpointFacts): CheckpointFacts {
  return {
    stage: value.stage,
    progress: value.progress,
    previousCalls: value.previousCalls,
    organizationSources: value.organizationSources,
    fileReferences: value.fileReferences,
    skill: value.skill,
    readmeDecision: value.readmeDecision,
    purpose: value.purpose,
    handoffDraftSources: value.handoffDraftSources,
    handoffDraftKey: value.handoffDraftKey,
    handoffDraftClarificationAfter: value.handoffDraftClarificationAfter,
    taskId: value.taskId,
    waitingQuestionId: value.waitingQuestionId,
    questionScope: value.questionScope,
    projectFingerprint: value.projectFingerprint,
    messages: value.messages,
    sources: value.sources,
    text: value.text,
    activity: value.activity,
    interruption: value.interruption,
    toolCalls: value.toolCalls,
    toolCharacters: value.toolCharacters,
    callIds: value.callIds,
    calls: value.calls,
    returnedCharacters: value.returnedCharacters,
    reusedCharacters: value.reusedCharacters,
    handoff: value.handoff,
    discussionRepairAttempted: value.discussionRepairAttempted,
    discussionFallbackText: value.discussionFallbackText,
    workingTargetBytes: value.workingTargetBytes,
    contextRecoveries: value.contextRecoveries,
    outputRecoveries: value.outputRecoveries,
    lastCheck: value.lastCheck,
    lastCheckId: value.lastCheckId,
    needsCheck: value.needsCheck,
    projectSnapshot: value.projectSnapshot,
    materialEvidence: value.materialEvidence,
  }
}

const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0
const nullableCount = (value: unknown) => value == null || count(value)
const nullableText = (value: unknown) =>
  value == null || typeof value === 'string'
function source(value: unknown): value is AssistantSource {
  if (
    !object(value) ||
    typeof value.docId !== 'string' ||
    typeof value.sectionId !== 'string' ||
    typeof value.title !== 'string' ||
    !['en', 'zh-CN'].includes(String(value.locale)) ||
    !nullableText(value.version) ||
    !['offset', 'endOffset', 'totalCharacters'].every(key =>
      nullableCount(value[key])
    ) ||
    (value.format != null &&
      !['plainText', 'markdown'].includes(String(value.format)))
  )
    return false
  const page = value.project
  const material = value.material
  if (
    material != null &&
    (page != null ||
      !object(material) ||
      !object(material.material) ||
      typeof material.material.id !== 'string' ||
      !/^[a-f0-9]{32}$/.test(material.material.id) ||
      typeof material.material.version !== 'string' ||
      !/^[a-f0-9]{64}$/.test(material.material.version) ||
      typeof material.material.name !== 'string' ||
      !material.material.name ||
      /[/\\\p{Cc}]/u.test(material.material.name) ||
      !count(material.material.size) ||
      material.material.size > 1024 * 1024 ||
      !count(material.material.totalCharacters) ||
      material.material.totalCharacters > material.material.size ||
      typeof material.text !== 'string' ||
      !['offset', 'endOffset', 'totalCharacters', 'startLine', 'endLine'].every(
        key => count(material[key])
      ) ||
      Number(material.endOffset) - Number(material.offset) !==
        material.text.length ||
      Number(material.endOffset) > Number(material.totalCharacters) ||
      material.totalCharacters !== material.material.totalCharacters ||
      value.docId !== material.material.id ||
      value.version !== material.material.version ||
      value.offset !== material.offset ||
      value.endOffset !== material.endOffset ||
      value.totalCharacters !== material.totalCharacters ||
      Number(material.startLine) < 1 ||
      Number(material.endLine) < Number(material.startLine) ||
      material.nextOffset !==
        (Number(material.endOffset) < Number(material.totalCharacters)
          ? material.endOffset
          : null))
  )
    return false
  return (
    page == null ||
    (object(page) &&
      typeof page.path === 'string' &&
      typeof page.version === 'string' &&
      typeof page.text === 'string' &&
      ['offset', 'endOffset', 'totalCharacters', 'startLine', 'endLine'].every(
        key => count(page[key])
      ) &&
      Number(page.offset) <= Number(page.endOffset) &&
      Number(page.endOffset) <= Number(page.totalCharacters) &&
      nullableCount(page.nextOffset) &&
      (page.source == null ||
        ['saved', 'draft', 'proposal'].includes(String(page.source))))
  )
}

function wireMessage(value: unknown): value is AssistantWireMessage {
  return (
    object(value) &&
    ['system', 'user', 'assistant', 'tool'].includes(String(value.role)) &&
    (value.content === null || typeof value.content === 'string') &&
    nullableText(value.reasoningContent) &&
    (value.reasoningContent == null ||
      (value.role === 'assistant' &&
        new TextEncoder().encode(String(value.reasoningContent)).length <=
          1024 * 1024)) &&
    nullableText(value.toolCallId) &&
    (value.role !== 'tool' || typeof value.toolCallId === 'string') &&
    (value.contextKind == null ||
      [
        'projectPolicy',
        'handoffPolicy',
        'handoffDraftPolicy',
        'editPolicy',
        'history',
        'input',
        'documents',
        'summary',
        'projectOverview',
        'projectFragment',
        'attachment',
      ].includes(String(value.contextKind))) &&
    (value.toolCalls == null ||
      (Array.isArray(value.toolCalls) &&
        value.toolCalls.every(
          call =>
            object(call) &&
            typeof call.id === 'string' &&
            !!call.id &&
            typeof call.name === 'string' &&
            typeof call.arguments === 'string'
        )))
  )
}

function handoff(value: unknown) {
  return (
    value === null ||
    (object(value) &&
      ['reason', 'intent', 'knownProblems', 'acceptance'].every(
        key => typeof value[key] === 'string'
      ) &&
      Array.isArray(value.files) &&
      value.files.every(path => typeof path === 'string') &&
      (value.plan === undefined ||
        (typeof value.plan === 'string' &&
          !!value.plan.trim() &&
          value.plan.length <= 32768)))
  )
}

function handoffSource(value: unknown) {
  if (
    !object(value) ||
    typeof value.id !== 'string' ||
    typeof value.text !== 'string' ||
    !['creator', 'suggestion', 'answer', 'question'].includes(
      String(value.kind)
    ) ||
    (value.decision !== undefined &&
      (value.kind !== 'answer' ||
        typeof value.decision !== 'string' ||
        !value.decision.trim() ||
        value.decision.length > 4000))
  )
    return false
  const plan = value.selectedPlan
  return (
    plan === undefined ||
    (value.kind === 'creator' &&
      object(plan) &&
      typeof plan.text === 'string' &&
      !!plan.text.trim() &&
      plan.text.length <= value.text.length &&
      ((plan.files === undefined && plan.acceptance === undefined) ||
        (Array.isArray(plan.files) &&
          plan.files.length > 0 &&
          plan.files.length <= 128 &&
          plan.files.every(
            path =>
              typeof path === 'string' &&
              path.length <= 1024 &&
              !/[\\\r\n]/.test(path) &&
              path
                .split('/')
                .every(part => part && part !== '.' && part !== '..')
          ) &&
          typeof plan.acceptance === 'string' &&
          !!plan.acceptance.trim() &&
          plan.acceptance.length <= 8192)))
  )
}

function isCheckpoint(value: unknown): value is CheckpointFacts {
  if (
    !object(value) ||
    (value.stage !== undefined &&
      (!object(value.stage) ||
        !['index', 'modelCalls', 'toolCalls', 'toolCharacters'].every(key =>
          count(value.stage && (value.stage as Record<string, unknown>)[key])
        ) ||
        Number(value.stage.modelCalls) > 128)) ||
    (value.progress !== undefined && !validAssistantProgress(value.progress)) ||
    (value.previousCalls != null &&
      !validAssistantPreviousCalls(value.previousCalls)) ||
    (value.organizationSources !== undefined &&
      !validOrganizationSources(value.organizationSources)) ||
    (value.fileReferences !== undefined &&
      !validOrganizationSources(value.fileReferences)) ||
    (value.skill !== undefined && !validAssistantSkillCapture(value.skill)) ||
    (value.readmeDecision !== undefined &&
      (!validReadmeVariantDecision(value.readmeDecision) ||
        !object(value.skill) ||
        value.skill.id !== 'write-readme')) ||
    (value.purpose !== undefined && value.purpose !== 'handoffDraft') ||
    (value.handoffDraftKey !== undefined &&
      typeof value.handoffDraftKey !== 'string') ||
    (value.handoffDraftClarificationAfter !== undefined &&
      (value.purpose !== 'handoffDraft' ||
        !count(value.handoffDraftClarificationAfter) ||
        value.handoffDraftClarificationAfter > 64)) ||
    (value.handoffDraftSources !== undefined &&
      (!Array.isArray(value.handoffDraftSources) ||
        !value.handoffDraftSources.every(handoffSource))) ||
    typeof value.taskId !== 'string' ||
    !value.taskId ||
    typeof value.projectFingerprint !== 'string' ||
    !Array.isArray(value.messages) ||
    !value.messages.length ||
    value.messages.length > 128 ||
    !value.messages.every(wireMessage) ||
    !Array.isArray(value.sources) ||
    !value.sources.every(source) ||
    (value.materialEvidence !== undefined &&
      (!Array.isArray(value.materialEvidence) ||
        value.materialEvidence.length > 64 ||
        !value.materialEvidence.every(
          item =>
            object(item) &&
            typeof item.id === 'string' &&
            /^[a-f0-9]{32}$/.test(item.id) &&
            typeof item.version === 'string' &&
            /^[a-f0-9]{64}$/.test(item.version)
        ))) ||
    !Array.isArray(value.callIds) ||
    !value.callIds.every(id => typeof id === 'string') ||
    !Array.isArray(value.calls) ||
    value.calls.length > 128 ||
    (object(value.previousCalls) &&
      !Number.isSafeInteger(
        Number(value.previousCalls.count) + value.calls.length
      )) ||
    !value.calls.every(
      call =>
        call === null ||
        (object(call) &&
          [
            'inputTokens',
            'outputTokens',
            'cachedInputTokens',
            'reasoningTokens',
          ].every(key => nullableCount(call[key])))
    ) ||
    ![
      'toolCalls',
      'toolCharacters',
      'returnedCharacters',
      'reusedCharacters',
    ].every(key => count(value[key])) ||
    !['workingTargetBytes', 'contextRecoveries', 'outputRecoveries'].every(
      key => value[key] === undefined || count(value[key])
    ) ||
    !['lastCheck', 'lastCheckId', 'interruption', 'waitingQuestionId'].every(
      key => value[key] === undefined || typeof value[key] === 'string'
    ) ||
    (value.questionScope !== undefined &&
      (!object(value.questionScope) ||
        typeof value.questionScope.chatId !== 'string' ||
        !value.questionScope.chatId ||
        value.questionScope.chatId.length > 128 ||
        typeof value.questionScope.messageId !== 'string' ||
        !value.questionScope.messageId ||
        value.questionScope.messageId.length > 128)) ||
    (value.needsCheck !== undefined && typeof value.needsCheck !== 'boolean') ||
    (value.discussionRepairAttempted !== undefined &&
      typeof value.discussionRepairAttempted !== 'boolean') ||
    (value.discussionFallbackText !== undefined &&
      (typeof value.discussionFallbackText !== 'string' ||
        value.discussionFallbackText.length > 32768)) ||
    typeof value.text !== 'string' ||
    (value.activity !== undefined &&
      (!Array.isArray(value.activity) ||
        !value.activity.every(entry => typeof entry === 'string'))) ||
    !object(value.projectSnapshot) ||
    typeof value.projectSnapshot.fingerprint !== 'string' ||
    !Array.isArray(value.projectSnapshot.files) ||
    !value.projectSnapshot.files.every(
      file =>
        object(file) &&
        typeof file.path === 'string' &&
        (count(file.bytes) ||
          (file.bytes === null && typeof file.reason === 'string')) &&
        nullableText(file.version) &&
        nullableText(file.reason)
    ) ||
    !handoff(value.handoff)
  )
    return false
  // Only complete tool groups survive. IDs cannot be reused by later groups.
  const pending = new Set<string>()
  const completed = new Set<string>()
  for (const message of value.messages) {
    if (message.role === 'assistant') {
      if (pending.size) return false
      for (const call of message.toolCalls ?? []) {
        if (pending.has(call.id) || completed.has(call.id)) return false
        pending.add(call.id)
      }
    } else if (message.role === 'tool') {
      if (!message.toolCallId || !pending.delete(message.toolCallId))
        return false
      completed.add(message.toolCallId)
    } else if (pending.size) return false
  }
  return pending.size === 0
}

/** Completed boundaries only: runtime readers, grants and an in-flight response
 * never cross this seam. Omitted old reads must be read again before replacing a
 * complete file; their absence cannot become fabricated read coverage. */
export function serializeAssistantContinuation(
  continuation: AssistantContinuation
): string {
  const facts = checkpointFacts(continuation)
  const { sources } = facts
  const recent = [] as typeof sources
  let sourceBytes = 0
  for (const source of [...sources].reverse()) {
    const size = bytes(source)
    if (sourceBytes + size > 1024 * 1024) continue
    recent.unshift(source)
    sourceBytes += size
  }
  const payload = JSON.stringify({ version: 1, ...facts, sources: recent })
  if (new TextEncoder().encode(payload).length > MAX_PAYLOAD_BYTES)
    throw new Error('Assistant continuation is too large')
  return payload
}

export function deserializeAssistantContinuation(
  payload: string
): AssistantContinuation | null {
  if (new TextEncoder().encode(payload).length > MAX_PAYLOAD_BYTES) return null
  try {
    const value: unknown = JSON.parse(payload)
    if (!object(value) || value.version !== 1) return null
    if (!isCheckpoint(value)) return null
    return {
      ...checkpointFacts(value),
      key: '',
      restored: true,
      project: null,
      documents: undefined,
      proposals: [],
    }
  } catch {
    return null
  }
}

export interface SavedAssistantRequest {
  history: AssistantMessage[]
  attachments: AssistantHistoryAttachment[]
  locale: HelpTree
  continuation: AssistantContinuation
}

export function encodeSavedAssistantRequest(request: SavedAssistantRequest) {
  const payload = JSON.stringify({
    version: 1,
    history: request.history,
    attachments: request.attachments,
    locale: request.locale,
    continuation: JSON.parse(
      serializeAssistantContinuation(request.continuation)
    ),
  })
  if (new TextEncoder().encode(payload).length > MAX_PAYLOAD_BYTES)
    throw new Error('Assistant request is too large')
  return payload
}

export function decodeSavedAssistantRequest(
  record: AssistantTaskResume
): SavedAssistantRequest | null {
  try {
    const value: unknown = JSON.parse(record.payload)
    if (
      !object(value) ||
      value.version !== 1 ||
      !Array.isArray(value.history) ||
      !value.history.every(
        message =>
          object(message) &&
          ['user', 'assistant'].includes(String(message.role)) &&
          typeof message.id === 'string' &&
          typeof message.text === 'string' &&
          Array.isArray(message.sources)
      ) ||
      !Array.isArray(value.attachments) ||
      (value.locale !== 'en' && value.locale !== 'zh-CN') ||
      value.locale !== record.locale
    )
      return null
    const continuation = deserializeAssistantContinuation(
      JSON.stringify(value.continuation)
    )
    if (!continuation || continuation.taskId !== record.taskId) return null
    return {
      history: value.history as AssistantMessage[],
      attachments: value.attachments as AssistantHistoryAttachment[],
      locale: value.locale,
      continuation,
    }
  } catch {
    return null
  }
}

// Save, clear, workspace teardown and a subsequent task share one queue. An old
// completion cannot delete or overwrite a newer task's durable checkpoint.
let queue: Promise<unknown> = Promise.resolve()
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.catch(() => undefined).then(operation)
  queue = next
  return next
}
export function saveAssistantResume(
  identity: string,
  record: AssistantTaskResume
) {
  return enqueue(async () => {
    const result = await commands.saveCreationAssistantResume(identity, record)
    if (result.status === 'error') throw new Error(result.error.code)
  })
}
export function clearAssistantResume(
  identity: string,
  taskId: string | null,
  beforeClear?: () => Promise<void>
) {
  return enqueue(async () => {
    await beforeClear?.()
    const result = await commands.clearCreationAssistantResume(identity, taskId)
    if (result.status === 'error') throw new Error(result.error.code)
  })
}
export function loadAssistantResume(
  identity: string
): Promise<AssistantTaskResumeRecovery | null> {
  return enqueue(async () => {
    const result = await commands.loadCreationAssistantResume(identity)
    if (result.status === 'error') throw new Error(result.error.code)
    return result.data
  })
}
export async function flushAssistantResume() {
  await queue
}
