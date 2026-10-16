import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { confirm } from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useCreationHandoffStore } from '@/store/creation-handoff-store'
import { useHandoffBaselinesStore } from '@/store/handoff-baselines-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import {
  isDraftDirty,
  useCreationFilesStore,
} from '@/store/creation-files-store'
import { openCreationFileAtLine } from '@/lib/creation-editor-navigation'
import { TextDifference } from './CreationFileChangeControls'
import { CreationErrorNotice } from './CreationErrorNotice'

export function CreationHandoffBaselines({ identity }: { identity: string }) {
  const { t } = useTranslation()
  const catalog = useHandoffBaselinesStore(state => state.catalog)
  const busy = useHandoffBaselinesStore(state => state.busy)
  const error = useHandoffBaselinesStore(state => state.error)
  const receipt = useHandoffBaselinesStore(state => state.receipt)
  const comparison = useHandoffBaselinesStore(state => state.comparison)
  const comparisonBusy = useHandoffBaselinesStore(state => state.comparisonBusy)
  const selectedId = useHandoffBaselinesStore(state => state.selectedId)
  const stale = useHandoffBaselinesStore(state => state.stale)
  const drafts = useCreationFilesStore(state => state.drafts)
  const diskRevision = useCreationFilesStore(state => state.diskRevision)
  const readingView = useCreationReadingStore(state => state.view)
  const projectName = useCreationStore(state => state.workspace?.project.name)
  useEffect(() => {
    if (readingView !== 'extension' || !comparison) return
    const check = () => {
      void useHandoffBaselinesStore.getState().checkStale()
    }
    check()
    const timer = window.setInterval(check, 3000)
    window.addEventListener('focus', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [readingView, comparison, diskRevision])
  useEffect(() => {
    void useHandoffBaselinesStore.getState().load()
  }, [identity])
  return (
    <section
      className="space-y-4 p-4 text-start text-sm"
      aria-label={t('handoff.baselines.title')}
    >
      <h2 className="font-semibold">{t('handoff.baselines.title')}</h2>
      <p>{projectName}</p>
      <p>{t('handoff.baselines.hint')}</p>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void useHandoffBaselinesStore.getState().load()}
      >
        {t('handoff.baselines.reload')}
      </Button>
      {(busy || comparisonBusy) && <p role="status">{t('creation.loading')}</p>}
      {error && <CreationErrorNotice error={error} />}
      {receipt && (
        <p role="status">
          {t(
            receipt.taskRecorded && !receipt.baselineError
              ? 'creation.handoff.baselineReady'
              : 'creation.handoff.baselineFailed'
          )}
        </p>
      )}
      {!!Object.values(drafts).filter(isDraftDirty).length && (
        <div role="status">
          <p>{t('handoff.compare.drafts')}</p>
          <ul>
            {Object.entries(drafts)
              .filter(([, draft]) => isDraftDirty(draft))
              .map(([path]) => (
                <li key={path}>{path}</li>
              ))}
          </ul>
        </div>
      )}
      {comparisonBusy && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => useHandoffBaselinesStore.getState().cancelComparison()}
        >
          {t('handoff.compare.cancel')}
        </Button>
      )}
      {comparison && (
        <section aria-label={t('handoff.compare.result')} className="space-y-3">
          <h3 className="font-semibold">{comparison.task.intent}</h3>
          <p className="break-all">
            {t('creation.handoff.revision', {
              id: comparison.task.id,
              revision: comparison.revision,
            })}
          </p>
          <p>
            {new Date(comparison.capturedAt).toLocaleString()} ·{' '}
            {t('handoff.compare.scope', { count: comparison.comparedFiles })}
          </p>
          <p>{t('handoff.compare.localOnly')}</p>
          {stale && <p role="alert">{t('handoff.compare.stale')}</p>}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void useHandoffBaselinesStore
                .getState()
                .compare(comparison.baselineId)
            }
          >
            {t('handoff.compare.refresh')}
          </Button>
          {!comparison.changes.length && !stale && (
            <p role="status">{t('handoff.compare.unchanged')}</p>
          )}
          {(['baselineExcluded', 'currentExcluded'] as const).map(
            field =>
              comparison[field].length > 0 && (
                <details key={field}>
                  <summary className="pnds-focus-ring">
                    {t(`handoff.compare.${field}`, {
                      count: comparison[field].length,
                    })}
                  </summary>
                  <ul>
                    {comparison[field].map(file => (
                      <li key={file.path} className="break-all">
                        {file.path} ·{' '}
                        {t(`handoff.exclusion.${file.reason}`, {
                          defaultValue: file.reason,
                        })}
                      </li>
                    ))}
                  </ul>
                </details>
              )
          )}
          {comparison.changes.map(change => (
            <article
              key={change.path}
              className="space-y-2 rounded border border-(--pnds-border) p-3"
            >
              <h4 className="break-all font-semibold">
                {change.path} · {t(`handoff.compare.${change.kind}`)}
                {change.mentioned && ` · ${t('handoff.compare.mentioned')}`}
              </h4>
              <p className="break-all text-xs">
                {t('handoff.compare.before')}:{' '}
                {change.before
                  ? `${change.before.size} B · SHA-256 ${change.before.sha256}`
                  : t('handoff.compare.absent')}
              </p>
              <p className="break-all text-xs">
                {t('handoff.compare.after')}:{' '}
                {change.after
                  ? `${change.after.size} B · SHA-256 ${change.after.sha256}`
                  : t('handoff.compare.absent')}
              </p>
              {(change.before?.text != null || change.after?.text != null) && (
                <TextDifference
                  before={change.before?.text ?? ''}
                  after={change.after?.text ?? ''}
                />
              )}
              {change.after?.text != null && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={t('handoff.compare.openNamed', {
                    path: change.path,
                  })}
                  onClick={() => {
                    const baselineId = comparison.baselineId
                    void useCreationFilesStore
                      .getState()
                      .poll()
                      .then(() => {
                        if (
                          useCreationStore.getState().workspace?.project
                            .identity === identity &&
                          useHandoffBaselinesStore.getState().comparison
                            ?.baselineId === baselineId
                        )
                          openCreationFileAtLine(identity, change.path, 1)
                      })
                  }}
                >
                  {t('handoff.compare.open')}
                </Button>
              )}
            </article>
          ))}
        </section>
      )}
      {catalog && (
        <>
          <p>
            {t('handoff.baselines.usage', {
              used: Math.ceil(catalog.usedBytes / 1024),
              limit: Math.ceil(catalog.limitBytes / 1024),
            })}
          </p>
          {!catalog.baselines.length && (
            <p role="status">{t('handoff.baselines.empty')}</p>
          )}
          {catalog.baselines.map(baseline => (
            <article
              key={baseline.id}
              className="space-y-2 rounded border border-(--pnds-border) p-3"
            >
              <h3 className="font-semibold">
                {baseline.intent || baseline.id}
              </h3>
              <p className="break-all">
                {t('creation.handoff.revision', {
                  id: baseline.taskId,
                  revision: baseline.revision,
                })}
              </p>
              <p>
                {baseline.capturedAt
                  ? new Date(baseline.capturedAt).toLocaleString()
                  : '—'}{' '}
                · {t('handoff.baselines.files', { count: baseline.files })} ·{' '}
                {Math.ceil(baseline.bytes / 1024)} KiB
              </p>
              {baseline.error && <CreationErrorNotice error={baseline.error} />}
              {!baseline.complete && (
                <p role="status">{t('handoff.baselines.incomplete')}</p>
              )}
              {!!baseline.excluded.length && (
                <details>
                  <summary className="pnds-focus-ring">
                    {t('handoff.baselines.excluded', {
                      count: baseline.excluded.length,
                    })}
                  </summary>
                  <ul className="break-all">
                    {baseline.excluded.map(file => (
                      <li key={file.path}>
                        {file.path} ·{' '}
                        {t(`handoff.exclusion.${file.reason}`, {
                          defaultValue: file.reason,
                        })}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="flex flex-wrap gap-2">
                {baseline.complete && !baseline.error && (
                  <Button
                    size="sm"
                    variant={selectedId === baseline.id ? 'default' : 'outline'}
                    disabled={busy}
                    onClick={() =>
                      void useHandoffBaselinesStore
                        .getState()
                        .compare(baseline.id)
                    }
                  >
                    {t('handoff.compare.action')}
                  </Button>
                )}
                {baseline.task && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (baseline.task)
                        void useCreationHandoffStore
                          .getState()
                          .prepareTask(baseline.task)
                    }}
                  >
                    {t('handoff.baselines.revise')}
                  </Button>
                )}
                {!baseline.complete && !baseline.error && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void useHandoffBaselinesStore
                        .getState()
                        .retry(baseline.id)
                    }
                  >
                    {t('handoff.baselines.retry')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    const workspace = useCreationStore.getState().workspace
                    void confirm(t('handoff.baselines.deleteConfirm'), {
                      title: t('handoff.baselines.delete'),
                      kind: 'warning',
                    })
                      .then(approved => {
                        if (
                          approved &&
                          useCreationStore.getState().workspace === workspace
                        )
                          void useHandoffBaselinesStore
                            .getState()
                            .remove(baseline.id)
                      })
                      .catch(() => toast.error(t('toast.error.generic')))
                  }}
                >
                  {t('handoff.baselines.delete')}
                </Button>
              </div>
            </article>
          ))}
        </>
      )}
    </section>
  )
}
