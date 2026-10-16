import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAssistantOverviewStore } from '@/store/assistant-overview-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { Button } from '@/components/ui/button'

export function AssistantProjectOverview({ identity }: { identity: string }) {
  const { t } = useTranslation()
  const id = useId()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const expanded = hovered || focused
  const overview = useAssistantOverviewStore(state => state.overview)
  const stale = useAssistantOverviewStore(state => state.stale)
  const busy = useAssistantOverviewStore(state => state.busy)
  const error = useAssistantOverviewStore(state => state.error)
  const staticEvidence = useAssistantOverviewStore(
    state => state.staticEvidence
  )
  const test = useAssistantOverviewStore(state => state.testEvidence)
  const revision = useCreationFilesStore(state => state.revision)
  useEffect(() => {
    useAssistantOverviewStore.getState().syncWorkspace(identity)
    const refresh = () => {
      void useAssistantOverviewStore.getState().refresh(identity)
    }
    const timer = setTimeout(refresh, 150)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [identity, revision])
  const freshness = error
    ? 'failed'
    : busy
      ? 'refreshing'
      : stale
        ? 'stale'
        : 'fresh'
  return (
    <div
      className="relative shrink-0 border-b border-(--pnds-border) px-3 py-1"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false)
      }}
    >
      <button
        type="button"
        className="pnds-focus-ring w-full truncate rounded text-start text-xs text-muted-foreground"
        aria-expanded={expanded}
        aria-controls={id}
      >
        {t('assistant.overview.title')} ·{' '}
        <span aria-live="polite">{t(`assistant.overview.${freshness}`)}</span>
      </button>
      {expanded && (
        <section
          id={id}
          aria-label={t('assistant.overview.title')}
          className="absolute inset-x-0 top-full z-20 max-h-80 space-y-2 overflow-auto rounded-md border border-(--pnds-border) bg-background p-3 text-xs shadow-(--pnds-popover-shadow)"
        >
          {overview && (
            <>
              <p>
                {t(
                  overview.contentPaths.length
                    ? 'assistant.overview.content'
                    : 'assistant.overview.scaffold'
                )}
              </p>
              <p>
                {t('assistant.overview.inventory', {
                  count: overview.snapshot.files.filter(file => !file.reason)
                    .length,
                  excluded: overview.snapshot.files.filter(file => file.reason)
                    .length,
                })}
              </p>
              <p>
                {t('assistant.overview.manifest', {
                  status: t(
                    `assistant.overview.manifestStatus.${overview.manifestStatus}`
                  ),
                })}
              </p>
              <p>
                {t('assistant.overview.static', {
                  status: staticEvidence
                    ? t(
                        staticEvidence.stale ||
                          staticEvidence.revision !== revision
                          ? 'assistant.overview.stale'
                          : staticEvidence.passed
                            ? 'assistant.overview.passed'
                            : 'assistant.overview.failed'
                      )
                    : t('assistant.overview.unknown'),
                })}
              </p>
              <p>
                {t('assistant.overview.test', {
                  status: test
                    ? `${t(`assistant.overview.testKind.${test.kind}`)} · ${t(`assistant.overview.testStatus.${test.status}`, { defaultValue: t('assistant.overview.unknown') })} · ${test.at} · ${t(test.stale || test.revision !== revision ? 'assistant.overview.stale' : 'assistant.overview.currentEvidence')}`
                    : t('assistant.overview.unknown'),
                })}
              </p>
              {overview.evidence.map(page => (
                <details key={page.path}>
                  <summary className="pnds-focus-ring break-all">
                    {page.path} · {page.version}
                  </summary>
                  <pre
                    dir="ltr"
                    className="max-h-32 overflow-auto whitespace-pre-wrap"
                  >
                    {page.text}
                  </pre>
                </details>
              ))}
              <p className="text-muted-foreground">
                {t('assistant.overview.partial')}
              </p>
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void useAssistantOverviewStore.getState().refresh(identity)
            }
          >
            {t('assistant.overview.refresh')}
          </Button>
        </section>
      )}
    </div>
  )
}
