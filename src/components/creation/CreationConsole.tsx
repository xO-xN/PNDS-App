import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSessionStore } from '@/store/session-store'
import { useCreationStore } from '@/store/creation-store'
import {
  isCreationWorkspacePath,
  useCreationFilesStore,
} from '@/store/creation-files-store'
import { Button } from '@/components/ui/button'
import { useCreationCompileStore } from '@/store/creation-compile-store'
import { useCreationCompileAvailability } from '@/hooks/use-creation-compile-availability'

export function CreationConsole() {
  const { t } = useTranslation()
  const tab = useCreationTestStore(state => state.tab)
  const log = useCreationTestStore(state => state.log)
  const error = useCreationTestStore(state => state.error)
  const runtimeError = useCreationTestStore(state => state.runtimeError)
  const workspace = useCreationStore(state => state.workspace)
  const compiling = useCreationCompileStore(state => state.busy)
  const compileReport = useCreationCompileStore(state => state.report)
  const compileError = useCreationCompileStore(state => state.error)
  const pending = useCreationFilesStore(state => state.pending)
  const compileReason = useCreationCompileAvailability()
  const compileReasonId = useId()
  const editable = workspace?.project.source === 'folder'
  const [copyError, setCopyError] = useState<string | null>(null)
  useEffect(() => {
    if (tab !== 'console') return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      await useCreationTestStore.getState().readLog()
      if (live)
        timer = setTimeout(() => {
          void poll()
        }, 1000)
    }
    void poll()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [tab, workspace?.project.identity])
  const copy = async () => {
    try {
      const facts = useSessionStore.getState()
      const ownsRuntime = isCreationWorkspacePath(facts.sessionProjectPath)
      await writeText(
        JSON.stringify(
          {
            project: workspace?.project.root,
            commandError: error,
            runtimeError,
            compilation: compileReport,
            compilationError: compileError,
            runtime:
              ownsRuntime || facts.sessionStatus === 'idle'
                ? {
                    status: facts.sessionStatus,
                    projectPath: ownsRuntime ? facts.sessionProjectPath : null,
                    audioMode: ownsRuntime
                      ? facts.latestSnapshot?.audioMode
                      : null,
                    lanIp: ownsRuntime ? facts.sessionLanIp : null,
                    hostAddress: ownsRuntime ? facts.sessionHostAddress : null,
                    oscTarget: ownsRuntime ? facts.oscTarget : null,
                    health:
                      ownsRuntime &&
                      facts.latestSnapshot?.status === facts.sessionStatus
                        ? facts.health
                        : null,
                  }
                : null,
            outputTail: log,
          },
          null,
          2
        )
      )
      setCopyError(null)
    } catch {
      setCopyError(t('creation.copyDetailsFailed'))
    }
  }
  return (
    <section
      hidden={tab !== 'console'}
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
                onClick={() => void useCreationCompileStore.getState().run()}
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
