import { CreationInspectionFrame } from './CreationInspectionFrame'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DialogFooter } from '@/components/ui/dialog'
import type { CreationCheckTask, CreationError } from '@/lib/tauri-bindings'
import { DEFAULT_SAMPLE_RATE, loadPreferences } from '@/lib/preferences'
import { logger } from '@/lib/logger'
import {
  creationTransportError,
  useCreationStore,
} from '@/store/creation-store'
import {
  selectUnsavedCount,
  useCreationFilesStore,
} from '@/store/creation-files-store'
import { CreationErrorNotice } from './CreationErrorNotice'
import { useAssistantOverviewStore } from '@/store/assistant-overview-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { prepareAssistantHandoff } from '@/lib/assistant-handoff'
import {
  CreationCheckFailure,
  CreationCheckRunner,
} from '@/lib/creation-check-runner'

/** An explicit saved-copy task owns its polling and cancellation lifecycle. */
export function CreationControlledCheck({
  open,
  identity,
  onClose,
  embedded = false,
}: {
  open: boolean
  identity: string
  onClose: () => void
  embedded?: boolean
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'none' | 'internal'>('none')
  const [compile, setCompile] = useState(false)
  const [busy, setBusy] = useState(false)
  const [task, setTask] = useState<CreationCheckTask | null>(null)
  const [error, setError] = useState<CreationError | null>(null)
  const [externalStale, setExternalStale] = useState(false)
  const [snapshotRevision, setSnapshotRevision] = useState(0)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const request = useRef<CreationCheckRunner | null>(null)
  const revision = useCreationFilesStore(state => state.revision)
  const drafts = useCreationFilesStore(selectUnsavedCount)
  const lastChange = useCreationFilesStore(state => state.lastChange)
  const changeBusy = useCreationFilesStore(state => state.changeBusy)
  const changeError = useCreationFilesStore(state => state.changeError)
  const taskId = task?.taskId ?? null
  const report = task?.report ?? null
  const checks = [
    ...(report?.diagnostics?.checks ?? []),
    ...(report?.checks ?? []),
  ]
  const stale =
    report !== null &&
    (externalStale ||
      report.freshness?.stale === true ||
      revision !== snapshotRevision)

  useEffect(() => {
    const runner = new CreationCheckRunner(
      identity,
      () => useCreationStore.getState().workspace?.project.identity === identity
    )
    request.current = runner
    return () => {
      request.current = null
      void runner.dispose().catch(cause =>
        logger.warn('Controlled-check cancellation failed', {
          error: String(cause),
        })
      )
    }
  }, [identity])

  const start = async () => {
    const runner = request.current
    if (!runner || runner.active) return
    const current = () => request.current === runner
    const capturedRevision = useCreationFilesStore.getState().revision
    setBusy(true)
    setTask(null)
    setError(null)
    setExternalStale(false)
    setEvidenceOpen(false)
    setSnapshotRevision(capturedRevision)
    try {
      await runner.run(
        {
          kind: 'manual',
          options: async () => {
            const preferences = await loadPreferences()
            return {
              mode,
              compile,
              timeoutMs: 30_000,
              outputDevice: preferences?.outputDevice ?? null,
              sampleRate: preferences?.sampleRate ?? DEFAULT_SAMPLE_RATE,
            }
          },
        },
        {
          onPollError: setError,
          onTask: snapshot => {
            setTask(snapshot)
            setError(null)
            const report = snapshot.report
            if (!report) return
            useAssistantOverviewStore.getState().recordTest(identity, {
              kind: 'controlled',
              status: report.status,
              revision: capturedRevision,
              at: new Date().toISOString(),
              stale:
                report.freshness?.stale === true ||
                report.freshness?.complete === false,
            })
            if (report.diagnostics)
              useAssistantOverviewStore
                .getState()
                .recordStatic(identity, report.diagnostics, capturedRevision)
          },
        }
      )
    } catch (cause) {
      if (current())
        setError(
          cause instanceof CreationCheckFailure
            ? cause.error
            : creationTransportError(cause)
        )
    } finally {
      if (current()) setBusy(false)
    }
  }

  useEffect(() => {
    if (!open || !report || !taskId || stale) return
    return request.current?.watchFreshness(taskId, result => {
      if (result.status === 'stale') setExternalStale(true)
      if (result.error) setError(result.error)
    })
  }, [open, identity, report, revision, stale, taskId])

  const cancel = async () => {
    const runner = request.current
    if (!runner) return
    try {
      await runner.cancel()
    } catch (cause) {
      if (request.current === runner)
        setError(
          cause instanceof CreationCheckFailure
            ? cause.error
            : creationTransportError(cause)
        )
    }
  }

  const close = () => {
    if (request.current?.active) void cancel()
    onClose()
  }

  const copyReport = async () => {
    try {
      await writeText(
        JSON.stringify(
          { workspaceIdentity: identity, taskId, report, error },
          null,
          2
        )
      )
      toast.success(t('error.copied'))
    } catch (cause) {
      logger.warn('Failed to copy controlled-check report', { error: cause })
      toast.error(t('toast.error.generic'))
    }
  }

  return (
    <CreationInspectionFrame
      embedded={embedded}
      open={open}
      identity={identity}
      title={t('creation.check.action')}
      description={t('creation.check.scope')}
      focusSelector="[data-creation-controlled-check]"
      onClose={close}
    >
      <div
        className="min-h-0 flex-1 space-y-4 overflow-auto text-sm"
        aria-busy={busy}
      >
        <p className="text-xs">
          {t('creation.check.diskHint', { count: drafts })}
        </p>
        {error && <CreationErrorNotice error={error} />}
        <div role="status" aria-atomic="true">
          {busy && (
            <p>
              {t(
                task?.progress
                  ? `creation.check.phase.${task.progress.phase}`
                  : 'creation.check.starting'
              )}
            </p>
          )}
          {task?.progress && busy && (
            <p className="break-all font-mono text-xs">
              {task.progress.path} ·{' '}
              {t('creation.check.bytes', {
                count: task.progress.copiedBytes,
              })}
            </p>
          )}
          {stale && <p>{t('creation.check.stale')}</p>}
          {report && (
            <p className="font-semibold">
              {t(`creation.check.status.${report.status}`)}
            </p>
          )}
        </div>
        {report && (
          <>
            {report.error && (
              <p
                role="alert"
                className="select-text whitespace-pre-wrap break-all"
              >
                {report.error}
              </p>
            )}
            {report.status === 'failed' && (
              <section
                className="space-y-2 rounded border border-(--pnds-border) p-3"
                aria-label={t('assistant.check.next')}
              >
                <p>{t('assistant.check.failure')}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      useCreationReadingStore.getState().showDiscussion()
                      close()
                    }}
                  >
                    {t('assistant.check.edit')}
                  </Button>
                  {lastChange && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={changeBusy}
                      onClick={() =>
                        void useCreationFilesStore
                          .getState()
                          .undoChange(identity, lastChange.id)
                      }
                    >
                      {t('creation.change.undo')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void prepareAssistantHandoff(
                        identity,
                        t('assistant.check.handoffIntent', {
                          task: report.taskId,
                          mode: report.mode,
                        }),
                        lastChange ? [lastChange.path] : [],
                        t('assistant.check.handoffAcceptance', {
                          task: report.taskId,
                        })
                      ).then(prepared => {
                        if (prepared) onClose()
                      })
                    }
                  >
                    {t('assistant.check.handoff')}
                  </Button>
                </div>
                {changeError && <CreationErrorNotice error={changeError} />}
              </section>
            )}
            {(checks.some(check => check.status !== 'passed') ||
              !!report.diagnostics?.issues.length) && (
              <section aria-label={t('creation.check.checks')}>
                <h3 className="mb-2 font-semibold">
                  {t('creation.check.checks')}
                </h3>
                <ul className="space-y-2 text-xs">
                  {checks
                    .filter(check => check.status !== 'passed')
                    .map((check, index) => (
                      <li key={`${check.code}-${index}`}>
                        <p className="font-semibold">{check.reason}</p>
                        <p className="text-muted-foreground">
                          {t(`creation.doctor.status.${check.status}`)} ·{' '}
                          <code>{check.code}</code>
                        </p>
                      </li>
                    ))}
                </ul>
                {report.diagnostics?.issues.map((issue, index) => (
                  <div key={`${issue.code}-${index}`} className="mt-2 text-xs">
                    {issue.reason}
                    {issue.path && (
                      <details className="creation-details">
                        <summary className="pnds-focus-ring">
                          {t('creation.doctor.issueDetails')}
                        </summary>
                        <code>{issue.path}</code>
                      </details>
                    )}
                  </div>
                ))}
              </section>
            )}
            {(!report.cleanup.nodeConfirmed ||
              !report.cleanup.audioConfirmed ||
              !report.cleanup.temporaryFilesRemoved ||
              report.cleanup.errors.length > 0) && (
              <div role="alert" className="space-y-1 text-xs">
                <p>{t('creation.check.cleanupWarning')}</p>
                {report.cleanup.errors.map((message, index) => (
                  <p key={index}>{message}</p>
                ))}
              </div>
            )}
            <details className="creation-details">
              <summary className="pnds-focus-ring">
                {t('creation.check.fullReport')}
              </summary>
              <div className="grid gap-4">
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                  <dt>{t('creation.check.task')}</dt>
                  <dd className="break-all font-mono">{report.taskId}</dd>
                  <dt>{t('creation.check.project')}</dt>
                  <dd className="break-all font-mono">{report.projectPath}</dd>
                  <dt>{t('creation.check.mode')}</dt>
                  <dd>{t(`creation.check.${report.mode}`)}</dd>
                  <dt>{t('creation.check.checker')}</dt>
                  <dd>{report.checkerVersion}</dd>
                </dl>
                <section
                  aria-label={t('creation.check.passedChecks', {
                    count: checks.filter(check => check.status === 'passed')
                      .length,
                  })}
                >
                  <h3 className="mb-2 font-semibold">
                    {t('creation.check.passedChecks', {
                      count: checks.filter(check => check.status === 'passed')
                        .length,
                    })}
                  </h3>
                  <ul className="space-y-2 text-xs">
                    {checks
                      .filter(check => check.status === 'passed')
                      .map((check, index) => (
                        <li key={`${check.code}-${index}`}>
                          <code>{check.code}</code>
                          <p>{check.reason}</p>
                        </li>
                      ))}
                  </ul>
                </section>
                <section aria-label={t('creation.check.cleanup')}>
                  <h3 className="mb-2 font-semibold">
                    {t('creation.check.cleanup')}
                  </h3>
                  <ul className="space-y-1 text-xs">
                    <li>
                      {t('creation.check.nodeCleanup')}:{' '}
                      {t(
                        report.cleanup.nodeConfirmed
                          ? 'creation.check.confirmed'
                          : 'creation.check.unconfirmed'
                      )}
                    </li>
                    <li>
                      {t('creation.check.audioCleanup')}:{' '}
                      {t(
                        report.cleanup.audioConfirmed
                          ? 'creation.check.confirmed'
                          : 'creation.check.unconfirmed'
                      )}
                    </li>
                    <li>
                      {t('creation.check.filesCleanup')}:{' '}
                      {t(
                        report.cleanup.temporaryFilesRemoved
                          ? 'creation.check.confirmed'
                          : 'creation.check.unconfirmed'
                      )}
                    </li>
                    {report.cleanup.errors.map((message, index) => (
                      <li key={index}>{message}</li>
                    ))}
                  </ul>
                </section>
                <details className="text-xs">
                  <summary className="pnds-focus-ring">
                    {t('creation.check.environment')}
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap break-all">
                    {JSON.stringify(report.environment, null, 2)}
                  </pre>
                </details>
                <details
                  className="text-xs"
                  onToggle={event => setEvidenceOpen(event.currentTarget.open)}
                >
                  <summary className="pnds-focus-ring">
                    {t('creation.check.evidence')}
                  </summary>
                  {evidenceOpen && (
                    <pre className="mt-2 whitespace-pre-wrap break-all">
                      {JSON.stringify(
                        {
                          evidence: report.evidence,
                          freshness: report.freshness,
                        },
                        null,
                        2
                      )}
                    </pre>
                  )}
                </details>
                <section aria-label={t('creation.check.unverified')}>
                  <h3 className="mb-2 font-semibold">
                    {t('creation.check.unverified')}
                  </h3>
                  <ul className="space-y-1 text-xs">
                    {report.unverified.map(item => (
                      <li key={item}>
                        {t(`creation.check.unverified.${item}`, {
                          defaultValue: item,
                        })}
                      </li>
                    ))}
                  </ul>
                </section>
                {report.outputTail.length > 0 && (
                  <details className="text-xs">
                    <summary className="pnds-focus-ring">
                      {t('creation.check.output')}
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap break-all">
                      {report.outputTail.join('\n')}
                    </pre>
                  </details>
                )}
              </div>
            </details>
          </>
        )}
        <details className="creation-details" open={!report}>
          <summary className="pnds-focus-ring">
            {t('creation.check.setupDetails')}
          </summary>
          <fieldset
            disabled={busy}
            className="flex flex-wrap items-center gap-4 rounded border border-(--pnds-border) p-3 text-xs"
          >
            <legend className="px-1 font-semibold">
              {t('creation.check.options')}
            </legend>
            <div className="flex items-center gap-2">
              <label htmlFor="creation-controlled-audio-mode">
                {t('creation.check.mode')}
              </label>
              <Select
                value={mode}
                disabled={busy}
                onValueChange={value =>
                  setMode(value === 'internal' ? 'internal' : 'none')
                }
              >
                <SelectTrigger id="creation-controlled-audio-mode" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {t('creation.check.none')}
                  </SelectItem>
                  <SelectItem value="internal">
                    {t('creation.check.internal')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2">
              <input
                className="pnds-focus-ring"
                type="checkbox"
                checked={compile}
                onChange={event => setCompile(event.target.checked)}
              />
              {t('creation.check.compile')}
            </label>
            <p>
              {t(
                mode === 'internal'
                  ? 'creation.check.internalHint'
                  : 'creation.check.noneHint'
              )}
            </p>
            <p>{t('creation.check.externalHint')}</p>
          </fieldset>
        </details>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close}>
          {t('creation.git.close')}
        </Button>
        {(report || error) && (
          <Button variant="outline" onClick={() => void copyReport()}>
            {t('creation.check.copy')}
          </Button>
        )}
        {busy ? (
          <Button variant="outline" onClick={() => void cancel()}>
            {t('creation.check.cancel')}
          </Button>
        ) : (
          <Button onClick={() => void start()}>
            {t(report ? 'creation.check.again' : 'creation.check.start')}
          </Button>
        )}
      </DialogFooter>
    </CreationInspectionFrame>
  )
}
