import type { ReactNode } from 'react'

/**
 * §v1.1.1: the shared monitor zoom frame. CSS `zoom` does not visually
 * scale a cross-origin iframe (rendered out-of-process) in WKWebView,
 * so the wrapper is scaled with a compositing transform and sized
 * inversely (100/scale %) — the standard extension-style zoom.
 * transform-origin top-left keeps the top-left pinned; the caller's
 * overflow-hidden ancestor clips the overflow.
 *
 * v1.5.0 (#131): shared by the main window's MonitorView and the
 * projection window's monitor half — each window holds its OWN zoom
 * value (the session store's vs the projection page's local state),
 * but the MECHANISM is one component so the two can never drift.
 */
export function MonitorScaleFrame({
  zoom,
  children,
  preview,
}: {
  /** Zoom percent (50–200; §v1.1.1 browser-style bounds). */
  zoom: number
  children: ReactNode
  /** Full desktop viewport, visually fitted into the creator thumbnail. */
  preview?: { width: number; height: number; scale: number }
}) {
  const scale = zoom / 100
  return (
    <div
      data-testid="monitor-scale-frame"
      className="h-full w-full"
      style={{
        position: preview ? 'absolute' : undefined,
        insetBlockStart: preview ? 0 : undefined,
        insetInlineStart: preview ? 0 : undefined,
        width: preview ? `${preview.width / scale}px` : `${100 / scale}%`,
        height: preview ? `${preview.height / scale}px` : `${100 / scale}%`,
        transform: `scale(${scale * (preview?.scale ?? 1)})`,
        transformOrigin: 'top left',
      }}
    >
      {children}
    </div>
  )
}
