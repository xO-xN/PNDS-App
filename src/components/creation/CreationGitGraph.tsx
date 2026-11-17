import { useEffect, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { TooltipHint } from '@/components/ui/tooltip'
import type { GitVersionGraph } from '@/lib/tauri-bindings'
import { gitVersionEdgePath, layoutGitVersions } from '@/lib/creation-git-graph'
import './creation-version-tree.css'

export function CreationGitGraph({
  graph,
  selected,
  working,
  loading,
  busy,
  onChoose,
  onMore,
  scrollRef,
  mergePreview = null,
}: {
  graph: GitVersionGraph | null
  selected: string | null
  working: boolean
  loading: boolean
  busy: boolean
  onChoose: (id: string) => void
  onMore: () => void
  scrollRef: RefObject<HTMLDivElement | null>
  mergePreview?: { source: string; target: string } | null
}) {
  const { t, i18n } = useTranslation()
  const layout = graph ? layoutGitVersions(graph) : null
  const positions = new Map(
    layout?.order.map((id, row) => [
      id,
      {
        x: 64 + (layout.order.length - 1 - row) * 112,
        y: 20 + (layout.positions.get(id)?.lane ?? 0) * 44,
        lane: layout.positions.get(id)?.lane ?? 0,
      },
    ])
  )
  const head = graph?.head ? positions.get(graph.head) : null
  if (working && head && graph) {
    // Working changes branch from the checkout without relaying out saved history.
    const hasSavedChildren = graph.versions.some(version =>
      version.parents.includes(graph.head ?? '')
    )
    const laneOccupied = [...positions.values()].some(
      position => position.lane === head.lane && position.x > head.x
    )
    const lane =
      hasSavedChildren || laneOccupied
        ? Math.max(...[...positions.values()].map(position => position.lane)) +
          1
        : head.lane
    positions.set('working', {
      x: head.x + 112,
      y: 20 + lane * 44,
      lane,
    })
  }
  const order = [...positions.keys()]
  const savedWidth = Math.max(
    128,
    ...[...positions.values()].map(p => p.x + 64)
  )
  const mergeTarget = mergePreview ? positions.get(mergePreview.target) : null
  const mergeSource = mergePreview ? positions.get(mergePreview.source) : null
  const preview =
    mergeTarget && mergeSource ? { x: savedWidth + 48, y: mergeTarget.y } : null
  const width = preview ? preview.x + 64 : savedWidth
  const previewVisible = preview !== null
  const height = Math.max(66, ...[...positions.values()].map(p => p.y + 46))
  useEffect(() => {
    const node = scrollRef.current?.querySelector<HTMLButtonElement>(
      '[data-git-version][aria-pressed="true"]'
    )
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selected, graph?.head, graph?.versions.length, working, scrollRef])
  useEffect(() => {
    const scroll = scrollRef.current
    if (!previewVisible || !scroll) return
    const previous = scroll.scrollLeft
    scroll.scrollTo({
      left: Math.max(0, scroll.scrollWidth - scroll.clientWidth),
    })
    return () => {
      scroll.scrollTo({ left: previous })
    }
  }, [previewVisible, mergePreview?.source, mergePreview?.target, scrollRef])

  return (
    <section
      className="creation-version-tree"
      aria-label={t('creation.versions.graph')}
    >
      <div
        className="creation-version-tree-scroll"
        ref={scrollRef}
        aria-busy={loading}
      >
        {graph && order.length ? (
          <div
            className="creation-version-tree-log"
            style={{ inlineSize: width, blockSize: height }}
          >
            <svg
              className="creation-version-tree-lines"
              width={width}
              height={height}
              aria-hidden="true"
            >
              {order.flatMap(id => {
                const child = positions.get(id)
                const parents =
                  id === 'working'
                    ? [graph.head]
                    : (graph.versions.find(version => version.id === id)
                        ?.parents ?? [])
                return parents.map(parent => {
                  const from = parent ? positions.get(parent) : null
                  if (!child || !from) return null
                  return (
                    <path
                      key={`${id}:${parent}`}
                      data-git-child={id}
                      data-git-parent={parent}
                      className={
                        id === 'working'
                          ? 'pending'
                          : child.lane
                            ? 'alternate'
                            : ''
                      }
                      d={gitVersionEdgePath(from, child)}
                    />
                  )
                })
              })}
              {order.map(id => {
                const position = positions.get(id)
                return (
                  position && (
                    <g key={id}>
                      {selected === id && (
                        <circle
                          cx={position.x}
                          cy={position.y}
                          r={7}
                          className="selected"
                        />
                      )}
                      <circle
                        cx={position.x}
                        cy={position.y}
                        r={4}
                        className={
                          id === graph.head
                            ? 'current'
                            : id === 'working'
                              ? 'pending'
                              : position.lane
                                ? 'alternate'
                                : ''
                        }
                      />
                    </g>
                  )
                )
              })}
              {preview && mergeTarget && mergeSource && (
                <g className="creation-merge-tree-preview" opacity="0.42">
                  <path d={gitVersionEdgePath(mergeTarget, preview)} />
                  <path d={gitVersionEdgePath(mergeSource, preview)} />
                  <circle cx={preview.x} cy={preview.y} r="5" />
                </g>
              )}
            </svg>
            {preview && (
              <span
                className="creation-merge-tree-label"
                aria-hidden="true"
                style={{
                  insetInlineStart: preview.x - 52,
                  insetBlockStart: preview.y + 12,
                }}
              >
                {t('creation.merge.preview')}
              </span>
            )}
            {order.map(id => {
              const position = positions.get(id)
              if (!position) return null
              const version = graph.versions.find(version => version.id === id)
              const date = version ? new Date(version.timestamp * 1000) : null
              const validDate =
                date && Number.isFinite(date.getTime()) ? date : null
              const branches = graph.branches.filter(
                branch => branch.tip === id
              )
              const olderParents = version?.parents.some(
                parent => !positions.has(parent)
              )
              return (
                <TooltipHint
                  key={id}
                  content={
                    version ? (
                      <div className="creation-version-tree-hint">
                        <p>{version.message}</p>
                        {branches.length > 0 && (
                          <p>
                            {branches.map(branch => branch.name).join(', ')}
                          </p>
                        )}
                        <code>{id}</code>
                        {olderParents && (
                          <p>{t('creation.versions.olderParents')}</p>
                        )}
                      </div>
                    ) : (
                      t('creation.versions.working')
                    )
                  }
                >
                  <button
                    type="button"
                    data-git-version={id}
                    className="creation-version-tree-node pnds-focus-ring"
                    style={{
                      insetInlineStart: position.x - 52,
                      insetBlockStart: position.y - 10,
                    }}
                    aria-current={id === graph.head ? 'true' : undefined}
                    aria-pressed={selected === id}
                    onClick={() => onChoose(id)}
                  >
                    {id === graph.head && (
                      <span className="creation-version-tree-current">
                        {t('creation.versions.currentShort')}
                      </span>
                    )}
                    <span className="creation-version-tree-name">
                      <strong className="truncate">
                        {version
                          ? version.message.split('\n')[0]
                          : t('creation.versions.working')}
                      </strong>
                      {olderParents && (
                        <span aria-label={t('creation.versions.olderParents')}>
                          …
                        </span>
                      )}
                    </span>
                    {validDate && (
                      <time dateTime={validDate.toISOString()}>
                        {validDate.toLocaleString(i18n.resolvedLanguage, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    )}
                  </button>
                </TooltipHint>
              )
            })}
          </div>
        ) : (
          <p className="creation-version-tree-empty" role="status">
            {t(loading ? 'creation.git.loading' : 'creation.versions.empty')}
          </p>
        )}
      </div>
      {(graph?.nextOffset != null || graph?.limited) && (
        <footer className="creation-version-tree-pagination">
          {graph.nextOffset != null && (
            <Button
              size="sm"
              variant="ghost"
              disabled={loading || busy}
              onClick={onMore}
            >
              {t('creation.versions.more')}
            </Button>
          )}
          {graph.limited && (
            <TooltipHint content={t('creation.versions.limited')}>
              <span tabIndex={0} aria-label={t('creation.versions.limited')}>
                …
              </span>
            </TooltipHint>
          )}
        </footer>
      )}
    </section>
  )
}
