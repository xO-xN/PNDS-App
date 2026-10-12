import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

/** A creator thumbnail shows this desktop window, not a narrow mobile viewport. */
export function useMonitorPreview(active: boolean, expanded = false) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [bounds, setBounds] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    previewWidth: 0,
  }))
  useLayoutEffect(() => {
    if (!active) return
    const update = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      const previewWidth = viewportRef.current?.clientWidth ?? 0
      setBounds(previous =>
        previous.width === width &&
        previous.height === height &&
        previous.previewWidth === previewWidth
          ? previous
          : { width, height, previewWidth }
      )
    }
    update()
    window.addEventListener('resize', update)
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (viewportRef.current) observer?.observe(viewportRef.current)
    return () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [active, expanded])
  const surfaceStyle = active
    ? ({
        '--creation-monitor-page-ratio': `${bounds.width} / ${bounds.height}`,
      } as CSSProperties)
    : undefined
  const preview =
    active &&
    !expanded &&
    bounds.previewWidth > 0 &&
    bounds.width > 0 &&
    bounds.height > 0
      ? {
          width: bounds.width,
          height: bounds.height,
          scale: bounds.previewWidth / bounds.width,
        }
      : undefined
  return { viewportRef, surfaceStyle, preview }
}
