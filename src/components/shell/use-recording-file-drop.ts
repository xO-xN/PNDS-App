import { useEffect, useEffectEvent, useState, type RefObject } from 'react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { logger } from '@/lib/logger'

interface RecordingFileDropOptions {
  enabled: boolean
  projectPath: string | undefined
  projectIdentity?: string | null
  target: RefObject<HTMLElement | null>
  onDrop: (paths: string[]) => void
}

/** Finder drops retain native paths; record parsing remains with the import command. */
export function useRecordingFileDrop({
  enabled,
  projectPath,
  projectIdentity,
  target,
  onDrop,
}: RecordingFileDropOptions): boolean {
  const [dragging, setDragging] = useState(false)
  const [previous, setPrevious] = useState({
    enabled,
    projectPath,
    projectIdentity,
  })
  if (
    previous.enabled !== enabled ||
    previous.projectPath !== projectPath ||
    previous.projectIdentity !== projectIdentity
  ) {
    setPrevious({ enabled, projectPath, projectIdentity })
    setDragging(false)
  }
  const receive = useEffectEvent(
    (owner: string, identity: string | null | undefined, paths: string[]) => {
      if (enabled && projectPath === owner && projectIdentity === identity)
        onDrop(paths)
    }
  )

  useEffect(() => {
    if (!enabled || !projectPath) return
    let disposed = false
    let supported = false
    const off = getCurrentWebviewWindow().onDragDropEvent(({ payload }) => {
      if (disposed) return
      if (payload.type === 'leave') {
        supported = false
        setDragging(false)
        return
      }
      if (payload.type !== 'over') {
        supported =
          payload.paths.length > 0 &&
          payload.paths.every(path => /\.(pndsrecord|json)$/i.test(path))
      }
      const element = target.current
      const rect = element?.getBoundingClientRect()
      const hit = document.elementFromPoint?.(
        payload.position.x,
        payload.position.y
      )
      const visibleTarget =
        typeof document.elementFromPoint !== 'function' ||
        Boolean(hit && element?.contains(hit))
      // WKWebView reports window points on macOS, including Retina displays.
      const inside = Boolean(
        rect &&
        visibleTarget &&
        rect.width > 0 &&
        rect.height > 0 &&
        payload.position.x >= rect.left &&
        payload.position.x < rect.right &&
        payload.position.y >= rect.top &&
        payload.position.y < rect.bottom
      )
      if (payload.type === 'drop') {
        setDragging(false)
        if (supported && inside)
          receive(projectPath, projectIdentity, payload.paths)
        supported = false
      } else setDragging(supported && inside)
    })
    void off.catch(cause => {
      if (!disposed)
        logger.warn('Could not listen for recording file drops', {
          error: String(cause),
        })
    })
    return () => {
      disposed = true
      void off.then(unlisten => unlisten()).catch(() => undefined)
    }
  }, [enabled, projectPath, projectIdentity, target])

  return enabled && dragging
}
