import { TooltipHint } from '@/components/ui/tooltip'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

export function CreationGitSplit({
  graph,
  collapsed,
  children,
}: {
  graph: ReactNode
  collapsed: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    pointer: number
    y: number
    height: number
    ratio: number
  } | null>(null)
  const [size, setSize] = useState(500)
  const [ratio, setRatio] = useState(0.4)
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const measure = () => {
      const height = element.getBoundingClientRect().height
      if (height > 0) setSize(height)
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
  const available = Math.max(0, size - 8)
  const minimum = Math.min(100, available * 0.35)
  const maximum = Math.max(minimum, available - Math.min(220, available * 0.55))
  const height = Math.min(maximum, Math.max(minimum, available * ratio))
  const choose = (next: number) => {
    if (available > 0)
      setRatio(Math.min(maximum, Math.max(minimum, next)) / available)
  }
  const cancel = () => {
    if (drag.current) setRatio(drag.current.ratio)
    drag.current = null
  }
  return (
    <div
      ref={frame}
      className="creation-git-page-body"
      style={{
        gridTemplateRows: collapsed
          ? 'auto 0 minmax(0, 1fr)'
          : `${height}px 8px minmax(0, 1fr)`,
      }}
    >
      {graph}
      <ContextMenu>
        <TooltipHint content={t('creation.versions.resizeGraphHint')}>
          <ContextMenuTrigger asChild>
            <div
              role="separator"
              className="creation-git-splitter pnds-focus-ring"
              hidden={collapsed}
              tabIndex={collapsed ? -1 : 0}
              aria-orientation="horizontal"
              aria-label={t('creation.versions.resizeGraph')}
              aria-description={t('creation.versions.resizeGraphKeyboardHint')}
              aria-valuemin={Math.round(minimum)}
              aria-valuemax={Math.round(maximum)}
              aria-valuenow={Math.round(height)}
              onDoubleClick={() => setRatio(0.4)}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  if (drag.current) {
                    event.preventDefault()
                    event.stopPropagation()
                  }
                  cancel()
                  return
                }
                if (event.key === 'Home') {
                  event.preventDefault()
                  setRatio(0.4)
                }
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  event.preventDefault()
                  choose(
                    height +
                      (event.key === 'ArrowUp' ? -1 : 1) *
                        (event.shiftKey ? 48 : 16)
                  )
                }
              }}
              onPointerDown={event => {
                if (event.button !== 0) return
                event.preventDefault()
                event.currentTarget.focus()
                drag.current = {
                  pointer: event.pointerId,
                  y: event.clientY,
                  height,
                  ratio,
                }
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={event => {
                if (drag.current?.pointer === event.pointerId)
                  choose(drag.current.height + event.clientY - drag.current.y)
              }}
              onPointerUp={event => {
                if (drag.current?.pointer !== event.pointerId) return
                drag.current = null
                event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              onPointerCancel={cancel}
              onLostPointerCapture={cancel}
            />
          </ContextMenuTrigger>
        </TooltipHint>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => choose(height + 48)}>
            {t('creation.versions.tallerGraph')}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => choose(height - 48)}>
            {t('creation.versions.shorterGraph')}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => setRatio(0.4)}>
            {t('creation.versions.resetGraph')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {children}
    </div>
  )
}
