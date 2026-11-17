import { useEffect, useId, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AssistantMessage } from '@/lib/assistant-types'

// Clockwise perimeter indices in row order; the centre sits out the S3 orbit.
const latticeCells = [0, 1, 2, 7, null, 3, 6, 5, 4].map((ringIndex, cell) => ({
  x: (cell % 3) * 6,
  y: Math.floor(cell / 3) * 6,
  delay: ringIndex === null ? 0 : -(((8 - ringIndex) % 8) / 8) * 1700,
  still: ringIndex === null,
}))

/** ThoughtLine presentation for public activity; no provider reasoning enters here. */
export function AssistantThoughtLine({
  status,
  label,
  entries,
  renderEntry,
}: {
  status: AssistantMessage['status']
  label?: string
  entries: string[]
  renderEntry: (text: string) => ReactNode
}) {
  const { t, i18n } = useTranslation()
  const captionId = useId()
  const working = status === 'pending'
  const [run, setRun] = useState<{
    working: boolean
    elapsed: number | null
    expanded: boolean
  }>({
    working,
    elapsed: working ? 0 : null,
    expanded: false,
  })

  // A retry starts a fresh clock; phase/text updates keep the same run.
  if (run.working !== working) {
    setRun({
      working,
      elapsed: working ? 0 : run.elapsed,
      expanded: false,
    })
  }

  useEffect(() => {
    if (!working) return
    const startedAt = performance.now()
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((performance.now() - startedAt) / 100) / 10
      setRun(current => ({ ...current, elapsed }))
    }, 100)
    return () => window.clearInterval(timer)
  }, [working])

  if (!working && entries.length === 0 && run.elapsed === null) return null

  const seconds = run.elapsed === null ? null : run.elapsed % 60
  const duration =
    seconds === null
      ? null
      : t(
          run.elapsed !== null && run.elapsed >= 60
            ? 'assistant.thought.minutesSeconds'
            : 'assistant.thought.seconds',
          {
            minutes: Math.floor((run.elapsed ?? 0) / 60),
            seconds: new Intl.NumberFormat(i18n.resolvedLanguage, {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            }).format(seconds),
          }
        )
  const text = working
    ? (label ?? t('assistant.thought.working'))
    : t(
        status === 'failed'
          ? 'assistant.thought.failed'
          : status === 'cancelled'
            ? 'assistant.thought.paused'
            : duration
              ? 'assistant.thought.elapsed'
              : 'assistant.thought.done'
      )
  const head = (
    <>
      <span className="assistant-thought-line__glyph" aria-hidden="true">
        <span className="assistant-thought-line__lattice">
          {latticeCells.map(cell => (
            <span
              key={`${cell.x},${cell.y}`}
              className="assistant-thought-line__cell"
              data-still={cell.still ? '' : undefined}
              style={{
                insetInlineStart: cell.x,
                insetBlockStart: cell.y,
                animationDelay: `${cell.delay}ms`,
              }}
            />
          ))}
        </span>
      </span>
      <span id={captionId} className="assistant-thought-line__caption">
        <span
          key={working ? 'working' : 'settled'}
          className="assistant-thought-line__label"
        >
          <span className="assistant-thought-line__ink">{text}</span>
        </span>
        {duration && (
          <span
            className="assistant-thought-line__timer"
            aria-hidden={working || undefined}
          >
            {duration}
          </span>
        )}
      </span>
    </>
  )

  return (
    <div className="assistant-thought-line mb-3" data-working={working}>
      {entries.length > 0 ? (
        <details
          className="creation-assistant-activity"
          open={run.expanded}
          onToggle={event => {
            const expanded = event.currentTarget.open
            setRun(current =>
              current.expanded === expanded ? current : { ...current, expanded }
            )
          }}
        >
          <summary
            className="pnds-focus-ring assistant-thought-line__head"
            aria-label={t(
              run.expanded
                ? 'assistant.activity.collapse'
                : 'assistant.activity.title'
            )}
            aria-describedby={captionId}
          >
            {head}
            <ChevronDown
              className="assistant-thought-line__chevron"
              aria-hidden="true"
            />
          </summary>

          {run.expanded && (
            <ol className="assistant-thought-line__steps" role="list">
              {entries.map((entry, index) => {
                const done =
                  status === 'completed' || index < entries.length - 1
                return (
                  <li
                    key={index}
                    className="assistant-thought-line__step"
                    data-done={done}
                  >
                    <span
                      className="assistant-thought-line__mark"
                      aria-hidden="true"
                    >
                      {done ? (
                        <Check />
                      ) : (
                        <span className="assistant-thought-line__pulse" />
                      )}
                    </span>
                    <div className="min-w-0">{renderEntry(entry)}</div>
                  </li>
                )
              })}
            </ol>
          )}
        </details>
      ) : (
        <div className="assistant-thought-line__head">{head}</div>
      )}
    </div>
  )
}
