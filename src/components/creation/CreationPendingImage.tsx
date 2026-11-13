import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  commands,
  type CreationPendingMedia,
  type MaterialError,
} from '@/lib/tauri-bindings'

const MIN_ZOOM = 0.05
const MAX_ZOOM = 4

export function CreationPendingImage({
  identity,
  image,
}: {
  identity: string
  image: CreationPendingMedia
}) {
  const { t } = useTranslation()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<MaterialError | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  const [natural, setNatural] = useState<{
    width: number
    height: number
  } | null>(null)
  const [dragging, setDragging] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const pan = useRef<{
    id: number
    x: number
    y: number
    left: number
    top: number
  } | null>(null)
  const { id, name, version } = image
  useEffect(() => {
    let active = true
    void commands
      .readCreationPendingImage(identity, id, version)
      .then(result => {
        if (!active) return
        if (result.status === 'ok') setUrl(result.data)
        else setError(result.error)
      })
      .catch(() => {
        if (active) setError('storage')
      })
    return () => {
      active = false
    }
  }, [identity, id, version])

  const adjustZoom = (factor: number) => {
    const frame = viewport.current
    if (!natural || !frame) return
    const current =
      zoom ??
      Math.min(
        1,
        frame.clientWidth / natural.width,
        frame.clientHeight / natural.height
      )
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor)))
  }

  if (error)
    return (
      <p role="alert" className="p-4 text-sm text-(--pnds-danger)">
        {t(`creation.materials.error.${error}`)}
      </p>
    )
  if (!url)
    return (
      <p role="status" className="p-4 text-sm">
        {t('creation.loading')}
      </p>
    )
  return (
    <section
      className="creation-pending-image"
      aria-label={t('creation.pending.imagePreview')}
    >
      <div
        role="group"
        aria-label={t('creation.pending.imageZoom')}
        className="creation-pending-image-tools"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('creation.pending.zoomOut')}
          disabled={!natural || zoom === MIN_ZOOM}
          onClick={() => adjustZoom(0.8)}
        >
          <Minus aria-hidden="true" />
        </Button>
        <output aria-label={t('creation.pending.imageZoom')}>
          {zoom === null
            ? t('creation.pending.zoomFitStatus')
            : t('creation.pending.zoomPercent', {
                percent: Math.round(zoom * 100),
              })}
        </output>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('creation.pending.zoomIn')}
          disabled={!natural || zoom === MAX_ZOOM}
          onClick={() => adjustZoom(1.25)}
        >
          <Plus aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!natural}
          onClick={() => setZoom(1)}
        >
          {t('creation.pending.zoomPercent', { percent: 100 })}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setZoom(null)}>
          {t('creation.pending.zoomFit')}
        </Button>
      </div>
      <div
        ref={viewport}
        role="region"
        aria-label={t('creation.pending.imageCanvas')}
        tabIndex={0}
        className="creation-pending-image-viewport pnds-focus-ring"
        data-zoomed={zoom !== null || undefined}
        data-panning={dragging || undefined}
        onPointerDown={event => {
          const frame = event.currentTarget
          if (
            zoom === null ||
            event.button !== 0 ||
            (frame.scrollWidth <= frame.clientWidth &&
              frame.scrollHeight <= frame.clientHeight)
          )
            return
          pan.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: frame.scrollLeft,
            top: frame.scrollTop,
          }
          frame.setPointerCapture(event.pointerId)
          setDragging(true)
        }}
        onPointerMove={event => {
          const start = pan.current
          if (!start || start.id !== event.pointerId) return
          event.currentTarget.scrollLeft = start.left + start.x - event.clientX
          event.currentTarget.scrollTop = start.top + start.y - event.clientY
        }}
        onLostPointerCapture={() => {
          pan.current = null
          setDragging(false)
        }}
      >
        <img
          src={url}
          alt={name}
          draggable={false}
          style={
            zoom === null || !natural
              ? undefined
              : { width: natural.width * zoom }
          }
          onLoad={event =>
            setNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          onError={() => setError('invalidImage')}
        />
      </div>
    </section>
  )
}
