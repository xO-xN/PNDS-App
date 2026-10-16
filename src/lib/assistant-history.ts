import {
  commands,
  type AssistantHistory,
  type AssistantHistoryError,
} from '@/lib/tauri-bindings'
import type { AssistantMessage } from './assistant-types'

export type AssistantHistoryErrorCode = AssistantHistoryError['type']

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
  await writeQueue
}

export async function loadAssistantHistory(
  identity: string
): Promise<AssistantHistory> {
  await flushAssistantHistory()
  return unwrap(await commands.loadAssistantHistory(identity))
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
