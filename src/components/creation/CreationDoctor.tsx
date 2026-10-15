import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  commands,
  type CreationError,
  type DiagnosticReport,
} from '@/lib/tauri-bindings'
import {
  creationTransportError,
  useCreationStore,
} from '@/store/creation-store'
import {
  selectUnsavedCount,
  useCreationFilesStore,
} from '@/store/creation-files-store'
import { CreationErrorNotice } from './CreationErrorNotice'

/** Saved-disk inspection, independent of drafts and the runtime lifecycle. */
export function CreationDoctor({
  identity,
  onClose,
  onOpenFile,
}: {
  identity: string
  onClose: () => void
  onOpenFile: (path: string) => void
}) {
  const { t } = useTranslation()
  const [refresh, setRefresh] = useState(0)
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [reading, setReading] = useState(true)
  const [externalStale, setExternalStale] = useState(false)
  const [snapshotRevision, setSnapshotRevision] = useState(0)
  const [error, setError] = useState<CreationError | null>(null)
  const request = useRef({ sequence: 0 })
  const drafts = useCreationFilesStore(selectUnsavedCount)
  const revision = useCreationFilesStore(state => state.revision)
  const stale =
    report !== null && (externalStale || revision !== snapshotRevision)
  const files = useCreationStore(state => state.workspace?.files)
  useEffect(() => {
    const captured = ++request.current.sequence
    const owner = request.current
    const diskRevision = useCreationFilesStore.getState().revision
    const current = () =>
      owner.sequence === captured &&
      useCreationStore.getState().workspace?.project.identity === identity
    void commands
      .diagnoseCreationProject(identity)
      .then(result => {
        if (!current()) return
        if (result.status === 'ok') {
          setReport(result.data)
          setSnapshotRevision(diskRevision)
        } else setError(result.error)
        setReading(false)
      })
      .catch(cause => {
        if (current()) {
          setError(creationTransportError(cause))
          setReading(false)
        }
      })
    return () => {
      owner.sequence++
    }
  }, [identity, refresh])
  useEffect(() => {
    if (!report || stale) return
    let live = true
    let checking = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const current = () =>
      live &&
      useCreationStore.getState().workspace?.project.identity === identity
    const check = async () => {
      if (checking || !current()) return
      checking = true
      clearTimeout(timer)
      try {
        const result = await commands.creationDiagnosticIsStale(
          identity,
          report.inputFingerprint
        )
        if (!current()) return
        if (result.status === 'ok') {
          if (result.data) setExternalStale(true)
          setError(null)
        } else setError(result.error)
      } catch (cause) {
        if (current()) setError(creationTransportError(cause))
      } finally {
        checking = false
        if (current()) timer = setTimeout(() => void check(), 5000)
      }
    }
    const focused = () => {
      void check()
    }
    void check()
    window.addEventListener('focus', focused)
    return () => {
      live = false
      clearTimeout(timer)
      window.removeEventListener('focus', focused)
    }
  }, [identity, report, revision, stale])
  const reload = () => {
    request.current.sequence++
    setReport(null)
    setError(null)
    setExternalStale(false)
    setReading(true)
    setRefresh(value => value + 1)
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose()
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
              .querySelector<HTMLButtonElement>('[data-creation-doctor]')
              ?.focus()
        }}
      >
        <DialogTitle>{t('creation.doctor.action')}</DialogTitle>
        <DialogDescription>{t('creation.doctor.scope')}</DialogDescription>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>{t('creation.git.drafts', { count: drafts })}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={reading}
            onClick={reload}
          >
            {t('creation.doctor.refresh')}
          </Button>
        </div>
        <p className="text-xs">{t('creation.doctor.diskHint')}</p>
        <div
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto text-sm"
          aria-busy={reading}
        >
          {error && <CreationErrorNotice error={error} />}
          <div role="status" aria-atomic="true">
            {reading && <p>{t('creation.doctor.loading')}</p>}
            {stale && <p>{t('creation.doctor.stale')}</p>}
            {report && (
              <p>
                {t(
                  report.staticPassed
                    ? 'creation.doctor.passed'
                    : 'creation.doctor.failed'
                )}
              </p>
            )}
          </div>
          {report && (
            <>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                <dt>{t('creation.doctor.project')}</dt>
                <dd className="break-all">
                  {report.project?.name ?? t('creation.doctor.unknownProject')}
                </dd>
                <dt>{t('creation.doctor.identity')}</dt>
                <dd className="break-all">{report.project?.id ?? '—'}</dd>
                <dt>{t('creation.doctor.version')}</dt>
                <dd>{report.project?.version ?? '—'}</dd>
                <dt>{t('creation.doctor.path')}</dt>
                <dd className="break-all font-mono">{report.projectPath}</dd>
                <dt>{t('creation.doctor.checker')}</dt>
                <dd>{report.checkerVersion}</dd>
              </dl>
              <section aria-label={t('creation.doctor.issues')}>
                <h3 className="mb-2 font-semibold">
                  {t('creation.doctor.issues')}
                </h3>
                {report.issues.length === 0 && (
                  <p>{t('creation.doctor.noIssues')}</p>
                )}
                <ul className="space-y-2">
                  {report.issues.map((issue, index) => (
                    <li
                      key={`${issue.code}-${index}`}
                      className="rounded border border-(--pnds-border) p-3 text-xs"
                    >
                      <p className="font-semibold">
                        {t(`creation.doctor.severity.${issue.severity}`)} ·{' '}
                        <code>{issue.code}</code>
                      </p>
                      <p>{issue.reason}</p>
                      {issue.field && (
                        <p className="break-all font-mono">{issue.field}</p>
                      )}
                      {issue.path && (
                        <p className="break-all font-mono">{issue.path}</p>
                      )}
                      {issue.path &&
                        files?.some(file => file.path === issue.path) && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            aria-label={t('creation.doctor.openFile', {
                              path: issue.path,
                            })}
                            onClick={() => {
                              if (
                                useCreationStore.getState().workspace?.project
                                  .identity === identity
                              ) {
                                if (issue.path) onOpenFile(issue.path)
                                onClose()
                              }
                            }}
                          >
                            {t('creation.doctor.openFile', {
                              path: issue.path,
                            })}
                          </Button>
                        )}
                    </li>
                  ))}
                </ul>
              </section>
              <section aria-label={t('creation.doctor.checks')}>
                <h3 className="mb-2 font-semibold">
                  {t('creation.doctor.checks')}
                </h3>
                <ul className="space-y-2 text-xs">
                  {report.checks.map((check, index) => (
                    <li key={`${check.code}-${index}`}>
                      <p className="font-semibold">
                        {t(`creation.doctor.status.${check.status}`)} ·{' '}
                        {t(`creation.doctor.check.${check.code}`, {
                          defaultValue: check.code,
                        })}{' '}
                        <code>({check.code})</code>
                      </p>
                      <p>{check.reason}</p>
                    </li>
                  ))}
                </ul>
              </section>
              <section aria-label={t('creation.doctor.unverified')}>
                <h3 className="mb-2 font-semibold">
                  {t('creation.doctor.unverified')}
                </h3>
                <p className="mb-2 text-xs">
                  {t('creation.doctor.runtimeHint')}
                </p>
                <ul className="space-y-1 text-xs">
                  {report.unverified.map((item, index) => (
                    <li key={index}>
                      {t(`creation.doctor.unverified.${item}`, {
                        defaultValue: item,
                      })}
                    </li>
                  ))}
                </ul>
              </section>
              <details className="text-xs">
                <summary className="pnds-focus-ring">
                  {t('creation.doctor.inputs', { count: report.inputs.length })}
                </summary>
                <p className="my-2 break-all font-mono">
                  {report.inputFingerprint}
                </p>
                <ul className="space-y-2">
                  {report.inputs.map((input, index) => (
                    <li key={index} className="break-all font-mono">
                      {input.path} ·{' '}
                      {t(`creation.doctor.inputKind.${input.kind}`, {
                        defaultValue: input.kind,
                      })}
                      <br />
                      {input.fingerprint}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('creation.git.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
