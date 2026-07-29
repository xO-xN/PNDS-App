import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { toast } from 'sonner'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { logger } from '@/lib/logger'
import { stopAndReset } from '@/lib/open-project'
import { start } from '@/lib/session-flow'
import { Button } from '@/components/ui/button'

/**
 * Error Page (§10.3): concise summary + Retry + Back, with expandable,
 * copyable technical details. Retry starts a fresh loading session;
 * Back returns to Welcome without auto-restarting.
 */
export function ErrorScreen() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(state => state.currentProject)
  const sessionError = useSessionStore(state => state.sessionError)
  const outputTail = useSessionStore(state => state.outputTail)
  const health = useSessionStore(state => state.health)
  const audioMode = useSessionStore(state => state.audioMode)
  const lanIp = useSessionStore(state => state.lanIp)
  const oscTarget = useSessionStore(state => state.oscTarget)
  const [isRetrying, setIsRetrying] = useState(false)

  const handleRetry = async () => {
    if (!currentProject || !lanIp || isRetrying) return
    setIsRetrying(true)
    logger.info('Retrying session start', {
      path: currentProject.path,
      mode: audioMode,
    })
    try {
      await start()
    } finally {
      setIsRetrying(false)
    }
  }

  const handleBack = async () => {
    await stopAndReset()
  }

  const details = {
    projectPath: currentProject?.path ?? null,
    audioMode,
    lanIp,
    oscTarget,
    error: sessionError,
    health,
    outputTail,
  }

  const handleCopy = async () => {
    try {
      await writeText(JSON.stringify(details, null, 2))
      toast.success(t('error.copied'))
    } catch (error) {
      logger.warn('Failed to copy error details', { error })
      toast.error(t('toast.error.generic'))
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-5 bg-[#d9d9d9] p-8">
      <h1 className="text-2xl font-semibold text-black">{t('error.title')}</h1>

      <p
        role="alert"
        className="font-manrope max-w-xl whitespace-pre-wrap text-center text-sm text-destructive"
      >
        {sessionError ?? t('toast.error.generic')}
      </p>

      <div className="flex gap-3">
        <Button
          onClick={() => void handleRetry()}
          disabled={!currentProject || !lanIp || isRetrying}
        >
          {isRetrying ? t('error.retrying') : t('error.retry')}
        </Button>
        <Button variant="outline" onClick={() => void handleBack()}>
          {t('error.back')}
        </Button>
      </div>

      <details className="font-manrope w-full max-w-xl rounded-md border bg-white/60 p-4 text-xs backdrop-blur-md">
        <summary className="cursor-pointer text-sm font-medium">
          {t('error.details')}
        </summary>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">{t('error.projectPath')}</dt>
          <dd className="break-all">{currentProject?.path ?? '—'}</dd>
          <dt className="text-muted-foreground">{t('error.audioMode')}</dt>
          <dd>{audioMode}</dd>
          <dt className="text-muted-foreground">{t('error.lanIp')}</dt>
          <dd>{lanIp ?? '—'}</dd>
          <dt className="text-muted-foreground">{t('error.oscTarget')}</dt>
          <dd>{oscTarget ?? '—'}</dd>
        </dl>
        {health && (
          <>
            <h3 className="mt-3 text-muted-foreground">{t('error.health')}</h3>
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2">
              {JSON.stringify(health, null, 2)}
            </pre>
          </>
        )}
        {outputTail.length > 0 && (
          <>
            <h3 className="mt-3 text-muted-foreground">{t('error.output')}</h3>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2">
              {outputTail.join('\n')}
            </pre>
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => void handleCopy()}
        >
          {t('error.copy')}
        </Button>
      </details>
    </div>
  )
}
