import type { PointerEvent as ReactPointerEvent } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * v1.3.3 (#80): the bottom-right resize grip. On macOS the window is an
 * undecorated transparent rounded rectangle (`windowBackground` effect,
 * 16px radius) — the pixels outside the corner arc are fully transparent
 * and macOS hands clicks there to the app below, while the system still
 * shows its diagonal resize cursor at the frame corner, inviting exactly
 * that click. The grip is an invisible hit area just inside the arc that
 * reroutes a primary press into the native resize drag
 * (`startResizeDragging('SouthEast')`, allowed by the window capability).
 */
export function ResizeGrip() {
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    void getCurrentWindow().startResizeDragging('SouthEast')
  }

  return (
    // Physical right/bottom on purpose: the resize corner belongs to the
    // window frame regardless of UI direction — RTL keeps a bottom-right
    // resize corner too.
    <div
      aria-hidden="true"
      data-resize-grip=""
      onPointerDown={onPointerDown}
      className="absolute right-0 bottom-0 z-40 h-5 w-5 cursor-nwse-resize select-none"
    />
  )
}
