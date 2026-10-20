import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAssistantOverviewStore } from '@/store/assistant-overview-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

export function AssistantProjectOverview({
  identity,
  open,
  onOpenChange,
  onClose,
}: {
  identity: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onClose?: () => void
}) {
  const { t } = useTranslation()
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[80vh] space-y-2 overflow-auto text-sm"
        onCloseAutoFocus={event => {
          if (onClose) {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <DialogTitle>{t('assistant.overview.title')}</DialogTitle>
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {t(`assistant.overview.${freshness}`)}
        </p>
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
      </DialogContent>
    </Dialog>
  )
}
