export interface QrViewport {
  width: number
  height: number
}

export interface QrPanelBox {
  x: number
  y: number
  size: number
}

function qrPanelLimits(viewport: QrViewport) {
  const edge = Math.min(viewport.width, viewport.height)
  const gutter = Math.min(12, edge / 8)
  const maximum = Math.max(1, Math.min(800, edge - gutter * 2))
  return { gutter, minimum: Math.min(220, maximum), maximum }
}

/** Keep the entire panel reachable as its display surface changes. */
export function fitQrPanel(
  viewport: QrViewport,
  box?: QrPanelBox | null
): QrPanelBox {
  const { gutter, minimum, maximum } = qrPanelLimits(viewport)
  const size = Math.min(maximum, Math.max(minimum, box?.size ?? 360))
  return {
    size,
    x: Math.min(
      viewport.width - size - gutter,
      Math.max(gutter, box?.x ?? (viewport.width - size) / 2)
    ),
    y: Math.min(
      viewport.height - size - gutter,
      Math.max(gutter, box?.y ?? (viewport.height - size) / 2)
    ),
  }
}

export type QrCorner = 'nw' | 'ne' | 'sw' | 'se'

/** Resize around the opposite corner without moving that anchor. */
export function resizeQrPanel(
  viewport: QrViewport,
  box: QrPanelBox,
  corner: QrCorner,
  dx: number,
  dy: number
): QrPanelBox {
  const current = fitQrPanel(viewport, box)
  const { gutter, minimum, maximum } = qrPanelLimits(viewport)
  const west = corner.endsWith('w')
  const north = corner.startsWith('n')
  const anchorX = current.x + (west ? current.size : 0)
  const anchorY = current.y + (north ? current.size : 0)
  const available = Math.min(
    maximum,
    west ? anchorX - gutter : viewport.width - gutter - anchorX,
    north ? anchorY - gutter : viewport.height - gutter - anchorY
  )
  const delta = ((west ? -dx : dx) + (north ? -dy : dy)) / 2
  const size = Math.min(available, Math.max(minimum, current.size + delta))
  return {
    size,
    x: west ? anchorX - size : anchorX,
    y: north ? anchorY - size : anchorY,
  }
}
