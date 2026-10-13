import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'

// Serialize native changes and coalesce obsolete UI requests. Late IPC delivery
// cannot reveal controls for a sidebar that has already retracted.
let revision = 0
let queue = Promise.resolve()
export function syncNativeWindowControls(
  visible: boolean,
  offset = 0,
  opacity = 1,
  top = 34
) {
  const request = ++revision
  queue = queue.then(async () => {
    if (request !== revision) return
    try {
      const result = await commands.setMainControlsVisible(
        visible,
        offset,
        opacity,
        top
      )
      if (result.status === 'error')
        logger.warn('Native window controls failed', { error: result.error })
    } catch (error) {
      logger.warn('Native window controls failed', { error })
    }
  })
  return queue
}
