import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { Button } from '@/components/ui/button'
import type { CreationConsoleSnapshot } from '@/lib/creation-console-model'

export function CreationConsole({
  snapshot,
  onCompile,
}: {
  snapshot: CreationConsoleSnapshot
  onCompile: () => void
}) {
  const { t } = useTranslation()
  const {
    log,
    error,
    runtimeError,
    compiling,
    compileReport,
    compileError,
    pending,
    compileReason,
    editable,
    copyDetails,
  } = snapshot
  const compileReasonId = useId()
  const [copyError, setCopyError] = useState<string | null>(null)
  const copy = async () => {
    try {
      await writeText(copyDetails)
      setCopyError(null)
    } catch {
      setCopyError(t('creation.copyDetailsFailed'))
    }
  }
  return (
    <section
      aria-label={t('creation.console')}
      className="min-h-0 flex-1 overflow-auto p-4 text-start text-xs"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2>{t('creation.console')}</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void copy()
          }}
        >
          {t('creation.copyTestDetails')}
        </Button>
      </div>
      <p>{t('creation.consoleSource')}</p>
      {(pending.refresh > 0 || pending.restart > 0 || pending.compile > 0) && (
        <details open className="creation-details my-3 text-xs">
          <summary>{t('creation.console.pendingChanges')}</summary>
          <div className="space-y-2">
            {pending.refresh > 0 && <p>{t('creation.pendingRefresh')}</p>}
            {pending.restart > 0 && <p>{t('creation.pendingRestart')}</p>}
            <p className="text-(--pnds-text-secondary)">
              {t('creation.runningDiskHint')}
            </p>
          </div>
        </details>
      )}
      {(pending.compile > 0 || compiling || compileReport || compileError) && (
        <section
          aria-label={t('creation.compile.console')}
          className="my-3 space-y-2 rounded border border-(--pnds-border) p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">{t('creation.compile.console')}</h3>
            {editable && (
              <Button
                size="sm"
                variant="outline"
                disabled={compiling || !!compileReason}
                aria-describedby={
                  compileReason && !compiling ? compileReasonId : undefined
                }
                onClick={onCompile}
              >
                {t(
                  compiling
                    ? 'creation.compile.busy'
                    : 'creation.compile.consoleAction'
                )}
              </Button>
            )}
          </div>
          {pending.compile > 0 && <p>{t('creation.pendingCompile')}</p>}
          {editable && compileReason && !compiling && (
            <p id={compileReasonId} role="status">
              {compileReason}
            </p>
          )}
          {compiling && <p role="status">{t('creation.compile.busy')}</p>}
          {compileError && <p role="alert">{compileError}</p>}
          {compileReport && (
            <>
              <p>
                {t('creation.compile.compiler')}:{' '}
                <span dir="ltr" className="break-all font-mono">
                  {compileReport.sclangPath ?? t('creation.compile.notFound')}
                </span>
              </p>
              <p>
                {t('creation.compile.produced')}:{' '}
                <span dir="ltr" className="break-all font-mono">
                  {compileReport.produced.join(', ') ||
                    t('creation.compile.noArtifacts')}
                </span>
              </p>
              <p>{t('creation.compile.references')}</p>
              <ul className="space-y-1">
                {compileReport.references.map((reference, index) => (
                  <li key={`${index}:${reference.path}`}>
                    <span dir="ltr" className="break-all font-mono">
                      {reference.path}
                    </span>{' '}
                    · {t(`creation.compile.reference.${reference.status}`)}
                    {reference.detail && (
                      <p className="break-all">{reference.detail}</p>
                    )}
                  </li>
                ))}
              </ul>
              {!compileReport.references.length && (
                <p>{t('creation.compile.noReferences')}</p>
              )}
              {compileReport.error ? (
                <p role="alert">{compileReport.error}</p>
              ) : (
                <p role="status">{t('creation.compile.verified')}</p>
              )}
              {!!compileReport.produced.length && (
                <p>{t('creation.compile.restart')}</p>
              )}
              {compileReport.output && (
                <pre
                  dir="ltr"
                  className="whitespace-pre-wrap break-all select-text"
                >
                  {compileReport.output}
                </pre>
              )}
            </>
          )}
        </section>
      )}
      {error && (
        <p role="alert">
          {t('creation.consoleAppError')} {error}
        </p>
      )}
      {runtimeError && (
        <p role="alert">
          {t('creation.consoleRuntimeError')} {runtimeError}
        </p>
      )}
      {copyError && <p role="alert">{copyError}</p>}
      <pre dir="ltr" className="mt-3 whitespace-pre-wrap break-all select-text">
        {log.length ? log.join('\n') : t('creation.consoleEmpty')}
      </pre>
    </section>
  )
}
