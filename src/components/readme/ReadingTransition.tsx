import { useEffect, useState, type ReactNode } from 'react'
import './reading-transition.css'

interface ReadingTransitionProps<T> {
  content: T | null
  initialContent: T
  sameContent: (previous: T, next: T) => boolean
  children: (content: T) => ReactNode
}

interface ReadingLayer<T> {
  id: number
  content: T
}

/** Keep the last complete page during a read and fade new pixels over it. */
export function ReadingTransition<T>({
  content,
  initialContent,
  sameContent,
  children,
}: ReadingTransitionProps<T>) {
  const [pane, setPane] = useState<{
    sequence: number
    current: ReadingLayer<T>
    outgoing: ReadingLayer<T> | null
  }>(() => ({
    sequence: 0,
    current: { id: 0, content: content ?? initialContent },
    outgoing: null,
  }))

  if (content !== null && !sameContent(pane.current.content, content)) {
    if (pane.outgoing && sameContent(pane.outgoing.content, content)) {
      setPane({ ...pane, current: pane.outgoing, outgoing: null })
    } else {
      const sequence = pane.sequence + 1
      setPane({
        sequence,
        current: { id: sequence, content },
        outgoing: pane.current,
      })
    }
  }

  const moving = pane.outgoing !== null
  const activeId = pane.current.id
  useEffect(() => {
    if (!moving) return
    // The event completes normal transitions. The timeout also retires the
    // inert page if a hidden window suppresses CSS animation events.
    const timeout = window.setTimeout(() => {
      setPane(current =>
        current.current.id === activeId
          ? { ...current, outgoing: null }
          : current
      )
    }, 240)
    return () => window.clearTimeout(timeout)
  }, [activeId, moving])

  const layers = pane.outgoing ? [pane.outgoing, pane.current] : [pane.current]
  return (
    <div className="reading-transition">
      {layers.map(layer => {
        const outgoing = layer.id !== activeId
        return (
          <div
            key={layer.id}
            className="reading-transition-layer"
            data-reading-entering={moving && !outgoing ? '' : undefined}
            aria-hidden={outgoing || undefined}
            inert={outgoing || undefined}
            onAnimationEnd={event => {
              if (event.target !== event.currentTarget || outgoing) return
              setPane(current =>
                current.current.id === layer.id && current.outgoing !== null
                  ? { ...current, outgoing: null }
                  : current
              )
            }}
          >
            {children(layer.content)}
          </div>
        )
      })}
    </div>
  )
}
