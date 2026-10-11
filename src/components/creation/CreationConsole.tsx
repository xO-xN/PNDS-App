import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSessionStore } from '@/store/session-store'
import { useCreationStore } from '@/store/creation-store'
import { isCreationWorkspacePath } from '@/store/creation-changes-store'
import { Button } from '@/components/ui/button'

export function CreationConsole() {
  const { t } = useTranslation()
  const tab = useCreationTestStore(state => state.tab)
  const log = useCreationTestStore(state => state.log)
  const error = useCreationTestStore(state => state.error)
  const runtimeError = useCreationTestStore(state => state.runtimeError)
  const workspace = useCreationStore(state => state.workspace)
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
