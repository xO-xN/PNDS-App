import i18n from '@/i18n/config'
import { notifications } from './notifications'
import {
  commands,
  type CreationError,
  type HandoffOperationProgress,
  type Result,
} from './tauri-bindings'

let feedbackSequence = 0

/** A notification owns presentation only; cancelling stays with the native operation. */
export function createHandoffFeedback(isCurrent: () => boolean, title: string) {
  const id = `handoff:${++feedbackSequence}`
  let settled = false
  let description: string | undefined
  const dismiss = () => {
    if (settled) return
    settled = true
    notifications.flow.dismiss(id)
  }
  const current = () => {
    if (!isCurrent()) dismiss()
    return !settled
  }
  const step = (next?: string) => {
    if (!current() || description === next) return
    description = next
    notifications.flow.step(id, i18n.t(title), next)
  }
  const finish = (
    kind: 'succeed' | 'message' | 'warn' | 'fail',
    key: string,
    detail?: string
  ) => {
    if (!current()) return
    settled = true
    notifications.flow[kind](id, i18n.t(key), detail)
  }
  notifications.flow.step(id, i18n.t(title))
  return {
    dismiss,
    step,
    progress: (progress: HandoffOperationProgress | null) => {
      if (!progress) return
      const phase = i18n.t(`handoff.operation.${progress.phase}`)
      step(
        progress.path
          ? `${phase}\n${i18n.t('handoff.feedback.currentFile', {
              path: progress.path,
              read: Math.ceil(progress.bytesRead / 1024),
              total: Math.ceil(progress.bytesTotal / 1024),
            })}\n${i18n.t('handoff.operation.files', { count: progress.files })}`
          : phase
      )
    },
    succeed: (key: string, detail?: string) => finish('succeed', key, detail),
    message: (key: string, detail?: string) => finish('message', key, detail),
    warn: (key: string, detail?: string) => finish('warn', key, detail),
    fail: (error: CreationError) =>
      error.code === 'cancelled'
        ? finish('message', 'handoff.operation.cancelled')
        : finish('fail', 'handoff.feedback.failed', error.detail),
  }
}

/** Registration precedes dispatch so cancellation can reach the native worker,
 * even while that worker is waiting for the creation access lock. */
export async function runHandoffOperation<T>(
  identity: string,
  signal: AbortSignal,
  onProgress: (progress: HandoffOperationProgress | null) => void,
  execute: (id: string) => Promise<Result<T, CreationError>>
): Promise<Result<T, CreationError>> {
  const registered = await commands.beginHandoffOperation(identity)
  if (registered.status === 'error') return registered
  const id = registered.data
  const cancel = () => {
    void commands.cancelHandoffOperation(id).catch(() => undefined)
  }
  signal.addEventListener('abort', cancel, { once: true })
  let active = true
  let polling = false
  const poll = async () => {
    if (!active || polling) return
    polling = true
    try {
      const result = await commands.handoffOperationProgress(id)
      if (active) onProgress(result.status === 'ok' ? result.data : null)
    } catch {
      if (active) onProgress(null)
    } finally {
      polling = false
    }
  }
  const timer = window.setInterval(() => {
    void poll()
  }, 200)
  try {
    await poll()
    if (signal.aborted) {
      await commands.cancelHandoffOperation(id)
      return {
        status: 'error',
        error: {
          code: 'cancelled',
          detail: i18n.t('handoff.operation.cancelled'),
        },
      }
    }
    return await execute(id)
  } finally {
    active = false
    window.clearInterval(timer)
    signal.removeEventListener('abort', cancel)
    cancel()
  }
}
