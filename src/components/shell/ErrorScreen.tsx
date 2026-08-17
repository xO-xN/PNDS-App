import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { toast } from 'sonner'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { logger } from '@/lib/logger'
import { stopAndReset } from '@/lib/open-project'
import { start } from '@/lib/session-flow'
import { commands, type PortOccupant } from '@/lib/tauri-bindings'
import { Button } from '@/components/ui/button'
import { PortOccupantDetails } from '@/components/settings/PortOccupantDetails'

/**
 * Rust preflight/start port-conflict message (see preflight.rs — the shape
 * is pinned there by `port_conflict_message_is_parseable`).
 */
const PORT_CONFLICT_PATTERN = /^Port (\d+) is already in use\./m

/**
 * Error Page (§10.3): concise summary + Retry + Back, with expandable,
 * copyable technical details. Retry starts a fresh loading session;
 * Back returns to Welcome without auto-restarting.
 *
 * v1.2.0 (issue #14): when the failure is a port conflict, the page also
 * shows who holds the port and offers [Release and Retry] — one interaction
 * that clears the occupant (same SIGTERM→grace→SIGKILL semantics as the
 * settings panel) and restarts the session. If the occupant can't be
 * resolved (query failed, or the port was already freed elsewhere) the
 * block hides and plain Retry carries the case.
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
  const [isReleasing, setIsReleasing] = useState(false)

  const conflictMatch = sessionError?.match(PORT_CONFLICT_PATTERN)
  const conflictPort = conflictMatch ? Number(conflictMatch[1]) : null

  // null = not resolved yet, false = resolution failed or port already
  // free, occupant = a live holder of the port.
  const [conflictOccupant, setConflictOccupant] = useState<
    PortOccupant | false | null
  >(null)
  useEffect(() => {
    setConflictOccupant(null)
    if (conflictPort === null) return
    let stale = false
    void commands.checkPortStatus(conflictPort).then(result => {
      if (stale) return
      setConflictOccupant(result.status === 'ok' ? result.data.occupant : false)
    })
    return () => {
      stale = true
    }
  }, [conflictPort])

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

  const handleReleaseAndRetry = async () => {
    if (conflictPort === null || isReleasing || isRetrying) return
    setIsReleasing(true)
    logger.info('Releasing conflicting port before retry', {
      port: conflictPort,
    })
    const result = await commands.releasePort(conflictPort)
    if (result.status === 'error') {
      logger.error('Failed to release conflicting port', {
        port: conflictPort,
        error: result.error,
      })
      toast.error(t('error.releaseFailed'))
      setIsReleasing(false)
      return
    }
    setIsReleasing(false)
    await handleRetry()
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
    <div className="flex min-h-full flex-col items-center justify-center gap-5 bg-(--pnds-bg) p-8">
      <h1 className="text-2xl font-semibold text-(--pnds-text)">
        {t('error.title')}
      </h1>

      <p
        role="alert"
        className="font-manrope max-w-xl whitespace-pre-wrap text-center text-sm text-destructive"
      >
        {sessionError ?? t('toast.error.generic')}
      </p>

      {conflictPort !== null && conflictOccupant !== false && (
        <div
          data-testid="port-conflict-block"
          className="w-full max-w-xl rounded-xl border border-(--pnds-text)/10 bg-(--pnds-card) p-4 text-sm"
        >
          <p className="font-medium text-(--pnds-text)">
            {t('error.portConflictOccupant', { port: conflictPort })}
          </p>
          {conflictOccupant ? (
            <PortOccupantDetails occupant={conflictOccupant} className="mt-2" />
          ) : (
            <p className="text-muted-foreground mt-2 text-xs">
              {t('settings.portChecking')}
            </p>
          )}
          <Button
            size="sm"
            className="mt-3"
            onClick={() => void handleReleaseAndRetry()}
            disabled={isReleasing || isRetrying || !currentProject || !lanIp}
          >
            {isReleasing ? t('error.releasing') : t('error.releaseAndRetry')}
          </Button>
        </div>
      )}

      <div className="flex gap-3">
        <Button
          onClick={() => void handleRetry()}
          disabled={!currentProject || !lanIp || isRetrying}
        >
          {isRetrying ? t('error.retrying') : t('error.retry')}
        </Button>
        <Button
          variant="outline"
          className="border-(--pnds-text)/25 text-(--pnds-text)/80 hover:bg-(--pnds-text)/5"
          onClick={() => void handleBack()}
        >
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
          className="mt-3 border-(--pnds-text)/25 text-(--pnds-text)/80 hover:bg-(--pnds-text)/5"
          onClick={() => void handleCopy()}
        >
          {t('error.copy')}
        </Button>
      </details>
    </div>
  )
}
