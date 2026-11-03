import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fitQrPanel,
  resizeQrPanel,
  type QrCorner,
  type QrPanelBox,
  type QrViewport,
} from './qr-panel-layout'

export function PerformerQrPanel({
  image,
  name,
  url,
}: {
  image: string
  name: string | null
  url: string
}) {
  const { t } = useTranslation()
  const layer = useRef<HTMLDivElement>(null)
  const gesture = useRef<{
    pointer: number
    action: 'move' | QrCorner
    x: number
    y: number
    box: QrPanelBox
  } | null>(null)
  const [viewport, setViewport] = useState<QrViewport | null>(null)
  const [layout, setLayout] = useState<QrPanelBox | null>(null)
  const box = viewport ? fitQrPanel(viewport, layout) : null

  useEffect(() => {
    const element = layer.current
    if (!element) return
    const measure = () => {
      const { width, height } = element.getBoundingClientRect()
      if (width <= 0 || height <= 0) return
      setViewport(previous =>
        previous?.width === width && previous.height === height
          ? previous
          : { width, height }
      )
    }
    measure()
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  function begin(event: PointerEvent<HTMLElement>, action: 'move' | QrCorner) {
    if (event.button !== 0 || !box || gesture.current) return
    event.preventDefault()
    gesture.current = {
      pointer: event.pointerId,
      action,
      x: event.clientX,
      y: event.clientY,
      box,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function drag(event: PointerEvent<HTMLElement>) {
    const start = gesture.current
    if (!start || start.pointer !== event.pointerId || !viewport) return
    const x = event.clientX - start.x,
      y = event.clientY - start.y
    setLayout(
      start.action === 'move'
        ? fitQrPanel(viewport, {
            ...start.box,
            x: start.box.x + x,
            y: start.box.y + y,
          })
        : resizeQrPanel(viewport, start.box, start.action, x, y)
    )
  }
  function finish(event: PointerEvent<HTMLElement>, cancelled = false) {
    const start = gesture.current
    if (!start || start.pointer !== event.pointerId) return
    gesture.current = null
    if (cancelled) setLayout(start.box)
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const pointerHandlers = {
    onPointerMove: drag,
    onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true),
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) =>
      finish(event, true),
  }

  return (
    <div ref={layer} className="performer-qr-layer" dir="ltr">
      <section
        className="performer-qr-overlay"
        data-testid="performer-qr-overlay"
        aria-label={t('qr.label')}
        data-tauri-drag-region="false"
        style={
          box
            ? {
                insetInlineStart: box.x,
                insetBlockStart: box.y,
                width: box.size,
                height: box.size,
                transform: 'none',
              }
            : undefined
        }
      >
        <header
          className="performer-qr-header"
          data-testid="qr-panel-drag"
          {...pointerHandlers}
          onPointerDown={event => begin(event, 'move')}
        >
          {t('qr.label')}
        </header>
        <div className="performer-qr-image">
          <img src={image} alt={t('qr.imageAlt')} draggable={false} />
        </div>
        <h2>{name}</h2>
        <p dir="ltr">{url}</p>
        {(['nw', 'ne', 'sw', 'se'] as const).map(corner => (
          <div
            key={corner}
            aria-hidden="true"
            className={`performer-qr-resize performer-qr-resize-${corner}`}
            data-testid={`qr-resize-${corner}`}
            {...pointerHandlers}
            onPointerDown={event => begin(event, corner)}
          />
        ))}
      </section>
    </div>
  )
}
