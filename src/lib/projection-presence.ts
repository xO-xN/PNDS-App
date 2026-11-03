import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { onProjectionWindow, onWindowFocus } from '@/lib/events'
import { useProjectionStore } from '@/store/projection-store'

/** Existence, including minimized windows; recover after suspended WebViews. */
export function attachProjectionPresence(): () => void {
  let disposed = false
  let revision = 0
  let request = 0
  const restore = () => {
    const checkpoint = revision
    const current = ++request
    void WebviewWindow.getByLabel('projection')
      .then(existing => {
        if (disposed || current !== request || checkpoint !== revision) return
        useProjectionStore.getState().setWindowExists(existing !== null)
      })
      .catch(() => {
        // Retain observed presence until the next native event or restore.
      })
  }
  const offWindow = onProjectionWindow(exists => {
    revision++
    useProjectionStore.getState().setWindowExists(exists)
  })
  const offFocus = onWindowFocus(restore)
  const visibility = () => {
    if (!document.hidden) restore()
  }
  document.addEventListener('visibilitychange', visibility)
  restore()
  return () => {
    disposed = true
    offWindow()
    offFocus()
    document.removeEventListener('visibilitychange', visibility)
  }
}
