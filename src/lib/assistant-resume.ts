import type { AssistantContinuation } from './assistant-flow'
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
  | 'taskId'
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
  | 'workingTargetBytes'
  | 'contextRecoveries'
  | 'outputRecoveries'
  | 'lastCheck'
  | 'lastCheckId'
  | 'needsCheck'
  | 'projectSnapshot'
>

function checkpointFacts(value: CheckpointFacts): CheckpointFacts {
  return {
    taskId: value.taskId,
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
    workingTargetBytes: value.workingTargetBytes,
    contextRecoveries: value.contextRecoveries,
    outputRecoveries: value.outputRecoveries,
    lastCheck: value.lastCheck,
    lastCheckId: value.lastCheckId,
    needsCheck: value.needsCheck,
    projectSnapshot: value.projectSnapshot,
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
      value.files.every(path => typeof path === 'string'))
  )
}

function isCheckpoint(value: unknown): value is CheckpointFacts {
  if (
    !object(value) ||
    typeof value.taskId !== 'string' ||
    !value.taskId ||
    typeof value.projectFingerprint !== 'string' ||
    !Array.isArray(value.messages) ||
    !value.messages.length ||
    value.messages.length > 128 ||
    !value.messages.every(wireMessage) ||
    !Array.isArray(value.sources) ||
    !value.sources.every(source) ||
    !Array.isArray(value.callIds) ||
    !value.callIds.every(id => typeof id === 'string') ||
    !Array.isArray(value.calls) ||
    value.calls.length > 128 ||
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
    !['lastCheck', 'lastCheckId', 'interruption'].every(
      key => value[key] === undefined || typeof value[key] === 'string'
    ) ||
    (value.needsCheck !== undefined && typeof value.needsCheck !== 'boolean') ||
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
export function clearAssistantResume(identity: string, taskId: string | null) {
  return enqueue(async () => {
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
