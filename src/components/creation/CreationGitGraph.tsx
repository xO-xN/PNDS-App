import { TooltipHint } from '@/components/ui/tooltip'
import { useTranslation } from 'react-i18next'
import { useRef, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import type { GitVersionGraph } from '@/lib/tauri-bindings'
import { layoutGitVersions } from '@/lib/creation-git-graph'

export function CreationGitGraph({
  graph,
  selected,
  working,
  loading,
  busy,
  collapsed,
  onCollapsedChange,
  onChoose,
  onMore,
  scrollRef,
}: {
  graph: GitVersionGraph | null
  selected: string | null
  working: boolean
  loading: boolean
  busy: boolean
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onChoose: (id: string) => void
  onMore: () => void
  scrollRef: RefObject<HTMLDivElement | null>
}) {
  const { t, i18n } = useTranslation()
  const layout = graph ? layoutGitVersions(graph, working) : null
  const locateAfterExpand = useRef(false)
  const locate = () => {
    locateAfterExpand.current = true
    onCollapsedChange(false)
    requestAnimationFrame(() => {
      if (locateAfterExpand.current)
        scrollRef.current
          ?.querySelector('[aria-current="true"]')
          ?.scrollIntoView({ block: 'nearest' })
      locateAfterExpand.current = false
    })
  }
  return (
    <section
      className="creation-git-map"
      data-collapsed={collapsed}
      aria-label={t('creation.versions.graph')}
    >
      <header className="creation-git-map-tools">
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={!collapsed}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {t(
            collapsed
              ? 'creation.comparison.expandGraph'
              : 'creation.comparison.collapseGraph'
          )}
        </Button>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          disabled={!graph?.head}
          onClick={locate}
        >
          {t('creation.versions.locate')}
        </Button>
        {graph?.nextOffset != null && (
          <Button
            size="sm"
            variant="ghost"
            disabled={loading || busy}
            onClick={onMore}
          >
            {t('creation.versions.more')}
          </Button>
        )}
        {graph?.limited && (
          <TooltipHint content={t('creation.versions.limited')}>
            <span aria-label={t('creation.versions.limited')}>…</span>
          </TooltipHint>
        )}
      </header>
      <div className="creation-git-map-scroll" ref={scrollRef}>
        {graph && layout?.order.length ? (
          <div
            className="creation-git-log"
            style={{ minInlineSize: layout.width + 220 }}
          >
            <svg
              className="creation-git-log-lines"
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
            >
              {layout.order.flatMap(id => {
                const position = layout.positions.get(id)
                const parents =
                  id === 'working'
                    ? [graph.head]
                    : (graph.versions.find(version => version.id === id)
                        ?.parents ?? [])
                return parents.map(parent => {
                  const end = parent ? layout.positions.get(parent) : null
                  return position && end ? (
                    <path
                      key={`${id}:${parent}`}
                      className={
                        id === 'working'
                          ? 'pending'
                          : position.lane
                            ? 'alternate'
                            : ''
                      }
                      d={
                        position.x === end.x
                          ? `M ${position.x} ${position.y} V ${end.y}`
                          : `M ${position.x} ${position.y} C ${end.x} ${position.y} ${end.x} ${position.y} ${end.x} ${position.y + 16} V ${end.y}`
                      }
                    />
                  ) : null
                })
              })}
              {layout.order.map(id => {
                const position = layout.positions.get(id)
                return (
                  position && (
                    <circle
                      key={id}
                      cx={position.x}
                      cy={position.y}
                      r={4}
                      className={
                        id === graph.head
                          ? 'current'
                          : id === 'working'
                            ? 'pending'
                            : ''
                      }
                    />
                  )
                )
              })}
            </svg>
            {layout.order.map(id => {
              const version = graph.versions.find(version => version.id === id)
              const date = version ? new Date(version.timestamp * 1000) : null
              const validDate =
                date && Number.isFinite(date.getTime()) ? date : null
              const branches = graph.branches.filter(
                branch => branch.tip === id
              )
              return (
                <TooltipHint key={id} content={version?.message} overflowOnly>
                  <button
                    type="button"
                    data-git-version={id}
                    className="creation-git-node pnds-focus-ring"
                    style={{ paddingInlineStart: layout.width + 8 }}
                    aria-current={id === graph.head ? 'true' : undefined}
                    aria-pressed={selected === id}
                    onClick={() => onChoose(id)}
                  >
                    <strong className="truncate">
                      {version
                        ? version.message.split('\n')[0]
                        : t('creation.versions.working')}
                    </strong>
                    {id === graph.head && (
                      <span className="creation-git-current">
                        {t('creation.versions.current')}
                      </span>
                    )}
                    {branches.length > 0 && (
                      <TooltipHint
                        content={branches.map(branch => branch.name).join(', ')}
                        overflowOnly={branches.length === 1}
                      >
                        <span className="creation-git-branch">
                          {branches[0]?.name}
                          {branches.length > 1
                            ? ` +${branches.length - 1}`
                            : ''}
                        </span>
                      </TooltipHint>
                    )}
                    {version && (
                      <>
                        {validDate && (
                          <time dateTime={validDate.toISOString()}>
                            {validDate.toLocaleDateString(
                              i18n.resolvedLanguage,
                              {
                                month: 'short',
                                day: 'numeric',
                              }
                            )}
                          </time>
                        )}
                        <code>{id.slice(0, 7)}</code>
                      </>
                    )}
                    {version?.parents.some(
                      parent => !layout.positions.has(parent)
                    ) && (
                      <TooltipHint
                        content={t('creation.versions.olderParents')}
                      >
                        <span aria-label={t('creation.versions.olderParents')}>
                          …
                        </span>
                      </TooltipHint>
                    )}
                  </button>
                </TooltipHint>
              )
            })}
          </div>
        ) : (
          <div className="m-auto p-6 text-center text-sm">
            {t(loading ? 'creation.git.loading' : 'creation.versions.empty')}
          </div>
        )}
      </div>
    </section>
  )
}
