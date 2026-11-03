import {
  commands,
  type AssistantHistory,
  type AssistantHistoryError,
  type AssistantQuestion,
} from '@/lib/tauri-bindings'
import type { AssistantMessage } from './assistant-types'

export type AssistantHistoryErrorCode = AssistantHistoryError['type']
export const ASSISTANT_HISTORY_MESSAGE_LIMIT = 400

export class AssistantHistoryFailure extends Error {
  constructor(readonly code: AssistantHistoryErrorCode) {
    super(code)
  }
}

function unwrap<T>(
  result:
    | { status: 'ok'; data: T }
    | { status: 'error'; error: AssistantHistoryError }
): T {
  if (result.status === 'error')
    throw new AssistantHistoryFailure(result.error.type)
  return result.data
}

let writeQueue: Promise<void> = Promise.resolve()

/** Capture both content and epoch now. Looking up a later epoch in a queued
 * write would let an old response resurrect history after explicit clearing. */
export function queueAssistantHistorySave(
  identity: string,
  epoch: string,
  messages: readonly AssistantMessage[]
): Promise<void> {
  const snapshot = structuredClone([...messages])
  const operation = async () => {
    unwrap(await commands.saveAssistantHistory(identity, epoch, snapshot))
  }
  const task = writeQueue.then(operation, operation)
  writeQueue = task.catch(() => undefined)
  return task
}

export async function flushAssistantHistory(): Promise<void> {
  for (;;) {
    const pending = writeQueue
    await pending
    if (pending === writeQueue) return
  }
}

export async function loadAssistantHistory(
  identity: string
): Promise<AssistantHistory> {
  await flushAssistantHistory()
  const history = unwrap(await commands.loadAssistantHistory(identity))
  const tasks = [
    ...new Set(
      history.messages.flatMap(message =>
        (message.questions ?? [])
          .filter(question => question.status === 'pending')
          .map(question => question.taskId)
      )
    ),
  ]
  if (!tasks.length) return history
  // A stop may close the workspace before its native receipt reaches the chat
  // queue. The journal is durable even when that task checkpoint was retired.
  const results = await Promise.allSettled(
    tasks.map(async taskId => ({
      taskId,
      result: await commands.getCreationAssistantQuestions(identity, taskId),
    }))
  )
  const canonical = new Map<string, AssistantQuestion[]>()
  for (const result of results)
    if (result.status === 'fulfilled' && result.value.result.status === 'ok')
      canonical.set(result.value.taskId, result.value.result.data)
  return {
    ...history,
    messages: history.messages.map(message => ({
      ...message,
      questions: message.questions?.map(question => {
        if (question.status !== 'pending') return question
        // Missing/failed older journals keep their original display facts.
        const saved = canonical
          .get(question.taskId)
          ?.find(
            saved =>
              saved.id === question.id &&
              saved.taskId === question.taskId &&
              saved.scope.chatId === question.scope.chatId &&
              saved.scope.messageId === question.scope.messageId &&
              saved.status !== 'pending'
          )
        return saved
          ? { ...question, status: saved.status, answer: saved.answer }
          : question
      }),
    })),
  }
}

export async function clearAssistantHistory(
  identity: string
): Promise<AssistantHistory> {
  return unwrap(await commands.clearAssistantHistory(identity))
}

/** Rehydration creates display records only. It carries no request token,
 * consent, editor buffer, preview session or executable card callback. */
export function restoreAssistantMessages(
  history: AssistantHistory
): AssistantMessage[] {
  return history.messages.map(message => ({
    ...message,
    sources: message.sources ?? [],
    status: message.status === 'pending' ? 'cancelled' : message.status,
    appVersion: message.appVersion ?? history.appVersion,
    proposals:
      message.proposals?.map(proposal => ({
        ...proposal,
        preview: 'historical' as const,
      })) ?? [],
  }))
}
