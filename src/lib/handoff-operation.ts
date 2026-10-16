import i18n from '@/i18n/config'
import {
  commands,
  type CreationError,
  type HandoffOperationProgress,
  type Result,
} from './tauri-bindings'

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
