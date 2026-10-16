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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { commands, type CreationError } from '@/lib/tauri-bindings'
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

type CheckTask = Extract<
  Awaited<ReturnType<typeof commands.getCreationCheck>>,
  { status: 'ok' }
>['data']

function cancelDetachedTask(taskId: string) {
  void commands
    .cancelCreationCheck(taskId)
    .then(result => {
      if (result.status === 'error')
        logger.warn('Controlled-check cancellation failed', {
          taskId,
          error: result.error,
        })
    })
    .catch(cause =>
      logger.warn('Controlled-check cancellation failed', {
        taskId,
        error: String(cause),
      })
    )
}

/** An explicit saved-copy task owns its polling and cancellation lifecycle. */
export function CreationControlledCheck({
  open,
  identity,
  onClose,
}: {
  open: boolean
  identity: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'none' | 'internal'>('none')
  const [compile, setCompile] = useState(false)
  const [busy, setBusy] = useState(false)
  const [task, setTask] = useState<CheckTask | null>(null)
  const [error, setError] = useState<CreationError | null>(null)
  const [externalStale, setExternalStale] = useState(false)
  const [snapshotRevision, setSnapshotRevision] = useState(0)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const request = useRef({
    sequence: 0,
    taskId: null as string | null,
    active: false,
    cancelRequested: false,
  })
  const revision = useCreationFilesStore(state => state.revision)
  const drafts = useCreationFilesStore(selectUnsavedCount)
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
    const owner = request.current
    return () => {
      owner.sequence++
      if (owner.active && owner.taskId) {
        cancelDetachedTask(owner.taskId)
      }
    }
  }, [identity])

  const start = async () => {
    if (request.current.active) return
    const owner = request.current
    const sequence = ++owner.sequence
    owner.active = true
    owner.taskId = null
    owner.cancelRequested = false
    const current = () =>
      owner.sequence === sequence &&
      useCreationStore.getState().workspace?.project.identity === identity
    setBusy(true)
    setTask(null)
    setError(null)
    setExternalStale(false)
    setEvidenceOpen(false)
    setSnapshotRevision(useCreationFilesStore.getState().revision)
    try {
      const preferences = await loadPreferences()
      if (!current()) return
      if (owner.cancelRequested) {
        owner.active = false
        setBusy(false)
        return
      }
      const result = await commands.startCreationCheck(identity, {
        mode,
        compile,
        timeoutMs: 30_000,
        outputDevice: preferences?.outputDevice ?? null,
        sampleRate: preferences?.sampleRate ?? DEFAULT_SAMPLE_RATE,
      })
      if (result.status === 'error') {
        if (current()) {
          owner.active = false
          setError(result.error)
          setBusy(false)
        }
        return
      }
      if (!current()) {
        cancelDetachedTask(result.data)
        return
      }
      owner.taskId = result.data
      if (owner.cancelRequested) cancelDetachedTask(result.data)
      setTask({ taskId: result.data, identity, progress: null, report: null })
    } catch (cause) {
      if (current()) {
        owner.active = false
        setError(creationTransportError(cause))
        setBusy(false)
      }
    }
  }

  useEffect(() => {
    if (!taskId || report) return
    const sequence = request.current.sequence
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const current = () =>
      live &&
      request.current.sequence === sequence &&
      useCreationStore.getState().workspace?.project.identity === identity
    const poll = async () => {
      try {
        const result = await commands.getCreationCheck(identity, taskId)
        if (!current()) return
        if (result.status === 'error') setError(result.error)
        else if (
          result.data.identity === identity &&
          result.data.taskId === taskId
        ) {
          setTask(result.data)
          setError(null)
          if (result.data.report) {
            request.current.active = false
            setBusy(false)
            return
          }
        }
      } catch (cause) {
        if (current()) setError(creationTransportError(cause))
      }
      if (current()) timer = setTimeout(() => void poll(), 300)
    }
    void poll()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [identity, taskId, report])

  useEffect(() => {
    if (!open || !report || !taskId || stale) return
    let live = true
    let checking = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const current = () =>
      live &&
      request.current.taskId === taskId &&
      useCreationStore.getState().workspace?.project.identity === identity
    const check = async () => {
      if (checking || !current()) return
      checking = true
      clearTimeout(timer)
      try {
        const result = await commands.creationCheckIsStale(identity, taskId)
        if (!current()) return
        if (result.status === 'ok') {
          if (result.data) setExternalStale(true)
        } else setError(result.error)
      } catch (cause) {
        if (current()) setError(creationTransportError(cause))
      } finally {
        checking = false
        if (current()) timer = setTimeout(() => void check(), 10_000)
      }
    }
    const focused = () => void check()
    void check()
    window.addEventListener('focus', focused)
    return () => {
      live = false
      clearTimeout(timer)
      window.removeEventListener('focus', focused)
    }
  }, [open, identity, report, revision, stale, taskId])

  const cancel = async () => {
    request.current.cancelRequested = true
    const taskId = request.current.taskId
    if (!taskId) return
    try {
      const result = await commands.cancelCreationCheck(taskId)
      if (
        useCreationStore.getState().workspace?.project.identity === identity &&
        result.status === 'error'
      )
        setError(result.error)
    } catch (cause) {
      if (useCreationStore.getState().workspace?.project.identity === identity)
        setError(creationTransportError(cause))
    }
  }

  const close = () => {
    if (request.current.active) void cancel()
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
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) close()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-160 max-h-[85vh] flex-col overflow-hidden text-start sm:max-w-3xl"
        onCloseAutoFocus={event => {
          event.preventDefault()
          if (
            useCreationStore.getState().workspace?.project.identity === identity
          )
            document
              .querySelector<HTMLButtonElement>(
                '[data-creation-controlled-check]'
              )
              ?.focus()
        }}
      >
        <DialogTitle>{t('creation.check.action')}</DialogTitle>
        <DialogDescription>{t('creation.check.scope')}</DialogDescription>
        <div
          className="min-h-0 flex-1 space-y-4 overflow-auto text-sm"
          aria-busy={busy}
        >
          <p className="text-xs">
            {t('creation.check.diskHint', { count: drafts })}
          </p>
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
              <section aria-label={t('creation.check.checks')}>
                <h3 className="mb-2 font-semibold">
                  {t('creation.check.checks')}
                </h3>
                <ul className="space-y-2 text-xs">
                  {checks.map((check, index) => (
                    <li key={`${check.code}-${index}`}>
                      <p className="font-semibold">
                        {t(`creation.doctor.status.${check.status}`)} ·{' '}
                        <code>{check.code}</code>
                      </p>
                      <p>{check.reason}</p>
                    </li>
                  ))}
                </ul>
                {report.diagnostics?.issues.map((issue, index) => (
                  <p key={`${issue.code}-${index}`} className="mt-2 text-xs">
                    {issue.path && <code>{issue.path}: </code>}
                    {issue.reason}
                  </p>
                ))}
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
            </>
          )}
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
      </DialogContent>
    </Dialog>
  )
}
