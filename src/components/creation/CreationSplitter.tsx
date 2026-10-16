import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { creationSplit, DEFAULT_MONITOR_RATIO } from '@/lib/creation-split'
import { loadPreferences, updatePreferences } from '@/lib/preferences'

export function CreationSplitter({
  frame,
  hidden,
}: {
  frame: RefObject<HTMLDivElement | null>
  hidden: boolean
}) {
  const { t } = useTranslation()
  const [ratio, setRatio] = useState(DEFAULT_MONITOR_RATIO)
  const ratioRef = useRef(DEFAULT_MONITOR_RATIO)
  const chosen = useRef(false)
  const drag = useRef<{ pointer: number; initial: number } | null>(null)
  const [size, setSize] = useState({ width: window.innerWidth, sidebar: 226 })
  const [saveError, setSaveError] = useState(false)
  const split = creationSplit(size.width, size.sidebar, ratio)
  useEffect(() => {
    let stale = false
    void loadPreferences().then(prefs => {
      const saved = prefs?.assistantMonitorRatio
      if (
        !stale &&
        !chosen.current &&
        saved != null &&
        Number.isFinite(saved) &&
        saved >= 0.25 &&
        saved <= 0.6
      ) {
        ratioRef.current = saved
        setRatio(saved)
      }
    })
    return () => {
      stale = true
    }
  }, [])
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const measure = () =>
      setSize({
        width: element.getBoundingClientRect().width || window.innerWidth,
        sidebar:
          parseFloat(
            getComputedStyle(element).getPropertyValue(
              '--desktop-creation-sidebar-width'
            )
          ) || 226,
      })
    measure()
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [frame])
  useEffect(() => {
    frame.current?.style.setProperty(
      '--creation-monitor-width',
      `${split.monitor}px`
    )
  }, [frame, split.monitor])

  function choose(next: number) {
    chosen.current = true
    ratioRef.current = Math.min(0.6, Math.max(0.25, next))
    setRatio(ratioRef.current)
    setSaveError(false)
  }
  async function persist() {
    const saved = await updatePreferences({
      assistantMonitorRatio: ratioRef.current,
    })
    setSaveError(!saved)
  }
  function reset() {
    choose(DEFAULT_MONITOR_RATIO)
    void persist()
  }
  const percent = split.available
    ? Math.round((split.monitor / split.available) * 100)
    : 40
  return (
    <>
      <div
        className="creation-splitter pnds-focus-ring"
        hidden={hidden}
        role="separator"
        tabIndex={hidden ? -1 : 0}
        aria-label={t('assistant.layout.label')}
        aria-orientation="vertical"
        aria-valuemin={
          split.available
            ? Math.round((split.minimum / split.available) * 100)
            : 0
        }
        aria-valuemax={
          split.available
            ? Math.round((split.maximum / split.available) * 100)
            : 100
        }
        aria-valuenow={percent}
        aria-valuetext={t('assistant.layout.value', { percent })}
        aria-describedby="creation-splitter-hint"
        onDoubleClick={reset}
        onKeyDown={event => {
          if (event.key === 'Home') {
            event.preventDefault()
            reset()
            return
          }
          if (
            !['ArrowLeft', 'ArrowRight'].includes(event.key) ||
            !split.available
          )
            return
          event.preventDefault()
          const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
          const direction =
            (event.key === 'ArrowLeft' ? 1 : -1) * (rtl ? -1 : 1)
          choose(
            (split.monitor + direction * (event.shiftKey ? 48 : 16)) /
              split.available
          )
          void persist()
        }}
        onPointerDown={event => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.focus()
          drag.current = { pointer: event.pointerId, initial: ratioRef.current }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={event => {
          if (
            drag.current?.pointer !== event.pointerId ||
            !split.available ||
            !frame.current
          )
            return
          const rect = frame.current.getBoundingClientRect()
          const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
          choose(
            (rtl ? event.clientX - rect.left : rect.right - event.clientX) /
              split.available
          )
        }}
        onPointerUp={event => {
          if (drag.current?.pointer !== event.pointerId) return
          drag.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
          void persist()
        }}
        onPointerCancel={() => {
          if (drag.current) choose(drag.current.initial)
          drag.current = null
        }}
        onLostPointerCapture={() => {
          if (drag.current) choose(drag.current.initial)
          drag.current = null
        }}
      >
        <span id="creation-splitter-hint" className="sr-only">
          {t('assistant.layout.hint')}
        </span>
      </div>
      {saveError && (
        <p
          role="alert"
          className="absolute inset-x-4 bottom-16 z-50 rounded-md bg-(--pnds-card) p-2 text-xs text-destructive"
        >
          {t('assistant.layout.saveFailed')}
        </p>
      )}
    </>
  )
}
