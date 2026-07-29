import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import { useTranslation } from 'react-i18next'
import { commands, type SessionSnapshot } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/**
 * Welcome screen (§10.4): no project runs automatically; the user picks a
 * project directory, confirms trust (§4), preflight validates it (§5, §7),
 * then chooses an audio mode (§6.1) and LAN address (§7) and starts the
 * score server (§8). The full window model and Figma styling arrive in task-3.
 */
export function WelcomeScreen() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(state => state.currentProject)
  const preflightStatus = useProjectStore(state => state.preflightStatus)
  const preflightError = useProjectStore(state => state.preflightError)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const sessionError = useSessionStore(state => state.sessionError)
  const health = useSessionStore(state => state.health)
  const outputTail = useSessionStore(state => state.outputTail)
  const audioMode = useSessionStore(state => state.audioMode)
  const lanIp = useSessionStore(state => state.lanIp)
  const lanAddresses = useSessionStore(state => state.lanAddresses)
  const [pendingPath, setPendingPath] = useState<string | null>(null)

  // Mirror the Rust session state: live events + initial restore on mount.
  useEffect(() => {
    const unlisten = listen<SessionSnapshot>('pnds:session', event => {
      useSessionStore.getState().applySnapshot(event.payload)
    })
    void commands.getSessionState().then(result => {
      if (result.status === 'ok') {
        useSessionStore.getState().applySnapshot(result.data)
      }
    })
    return () => {
      void unlisten.then(off => off())
    }
  }, [])

  const runPreflight = async (path: string) => {
    useProjectStore.getState().startPreflight()
    useSessionStore.getState().resetSession()
    logger.info('Running project preflight', { path })
    const result = await commands.preflightProject(path)
    if (result.status === 'error') {
      useProjectStore.getState().preflightFailed(result.error)
      logger.warn('Preflight failed', { path, error: result.error })
      return
    }
    useProjectStore.getState().preflightSucceeded(path, result.data)
    logger.info('Preflight passed', { project: result.data.name })

    // Session defaults from the manifest (§6.1) and the network (§7).
    useSessionStore.getState().setAudioMode(result.data.audio.defaultMode)
    const addrs = await commands.listLanAddresses()
    if (addrs.status === 'ok') {
      useSessionStore.getState().setLanAddresses(addrs.data)
      const [first] = addrs.data
      if (addrs.data.length === 1 && first) {
        useSessionStore.getState().setLanIp(first)
      }
    }
  }

  const handleOpenProject = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('welcome.openProject'),
    })
    if (!selected) return

    if (useProjectStore.getState().isTrusted(selected)) {
      void runPreflight(selected)
    } else {
      setPendingPath(selected)
    }
  }

  const handleTrustConfirm = () => {
    if (!pendingPath) return
    useProjectStore.getState().trustProject(pendingPath)
    const path = pendingPath
    setPendingPath(null)
    void runPreflight(path)
  }

  const handleStart = async () => {
    if (!currentProject || !lanIp) return
    logger.info('Starting project', {
      path: currentProject.path,
      mode: audioMode,
      lanIp,
    })
    const result = await commands.startProject(
      currentProject.path,
      audioMode,
      lanIp
    )
    if (result.status === 'error') {
      useSessionStore.getState().failLocal(result.error)
    }
  }

  const handleStop = async () => {
    const result = await commands.stopProject()
    if (result.status === 'error') {
      useSessionStore.getState().failLocal(result.error)
    }
  }

  const sessionRunning = sessionStatus !== 'idle'
  const canStart =
    preflightStatus === 'ready' &&
    currentProject !== null &&
    lanIp !== null &&
    !sessionRunning

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 overflow-auto p-8">
      <header className="text-center">
        <h1 className="text-4xl font-semibold tracking-wide">
          {t('welcome.title')}
        </h1>
        <p className="mt-2 text-muted-foreground">{t('welcome.subtitle')}</p>
      </header>

      <Button
        size="lg"
        onClick={() => void handleOpenProject()}
        disabled={preflightStatus === 'checking' || sessionRunning}
      >
        {preflightStatus === 'checking'
          ? t('welcome.checking')
          : t('welcome.openProject')}
      </Button>

      {preflightStatus === 'error' && preflightError && (
        <div
          role="alert"
          className="max-w-xl whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 p-4 text-start text-sm text-destructive"
        >
          {preflightError}
        </div>
      )}

      {preflightStatus === 'ready' && currentProject && (
        <section className="w-full max-w-xl rounded-md border p-4 text-start text-sm">
          <h2 className="text-base font-medium">
            {currentProject.manifest.name}
          </h2>
          <p className="mt-1 break-all text-muted-foreground">
            {currentProject.path}
          </p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">{t('project.version')}</dt>
            <dd>{currentProject.manifest.version}</dd>
            <dt className="text-muted-foreground">{t('project.ports')}</dt>
            <dd>
              {currentProject.manifest.scoreServer.performerPort}
              {' / '}
              {currentProject.manifest.scoreServer.monitorPort}
            </dd>
          </dl>

          {!sessionRunning && (
            <div className="mt-4 flex flex-col gap-3 border-t pt-4">
              <label className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">
                  {t('session.audioMode')}
                </span>
                <select
                  className="rounded-md border bg-background px-3 py-1.5"
                  value={audioMode}
                  onChange={e =>
                    useSessionStore.getState().setAudioMode(e.target.value)
                  }
                >
                  {currentProject.manifest.audio.supportedModes.map(mode => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>

              {lanAddresses.length > 1 && (
                <label className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">
                    {t('session.lanAddress')}
                  </span>
                  <select
                    className="rounded-md border bg-background px-3 py-1.5"
                    value={lanIp ?? ''}
                    onChange={e =>
                      useSessionStore.getState().setLanIp(e.target.value)
                    }
                  >
                    <option value="" disabled>
                      {t('session.lanAddressHint')}
                    </option>
                    {lanAddresses.map(ip => (
                      <option key={ip} value={ip}>
                        {ip}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {lanAddresses.length === 0 && (
                <p role="alert" className="text-destructive">
                  {t('session.noLan')}
                </p>
              )}

              <Button onClick={() => void handleStart()} disabled={!canStart}>
                {t('session.start')}
              </Button>
            </div>
          )}
        </section>
      )}

      {sessionRunning && (
        <section className="w-full max-w-xl rounded-md border p-4 text-start text-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-medium">
              {sessionStatus === 'starting' && t('session.starting')}
              {sessionStatus === 'ready' && t('session.ready')}
              {sessionStatus === 'stopping' && t('session.stopping')}
              {sessionStatus === 'error' && t('session.error')}
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleStop()}
            >
              {t('session.stop')}
            </Button>
          </div>

          {sessionStatus === 'starting' && (
            <p className="mt-2 text-muted-foreground">
              {t('session.waitingHealth')}
            </p>
          )}

          {health && (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">
                {t('session.audioStatus')}
              </dt>
              <dd>
                {health.audio?.status ?? '—'}
                {health.audio?.target ? ` (${health.audio.target})` : ''}
              </dd>
              {lanIp && health.scoreServer?.performerPort && (
                <>
                  <dt className="text-muted-foreground">
                    {t('session.performerUrl')}
                  </dt>
                  <dd className="break-all">
                    http://{lanIp}:{health.scoreServer.performerPort}/
                  </dd>
                </>
              )}
            </dl>
          )}

          {sessionStatus === 'error' && sessionError && (
            <p
              role="alert"
              className="mt-3 whitespace-pre-wrap text-destructive"
            >
              {sessionError}
            </p>
          )}

          {sessionStatus === 'error' && outputTail.length > 0 && (
            <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
              {outputTail.join('\n')}
            </pre>
          )}
        </section>
      )}

      <AlertDialog
        open={pendingPath !== null}
        onOpenChange={openState => {
          if (!openState) setPendingPath(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('trust.title')}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap break-all">
              {t('trust.description', { path: pendingPath })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('trust.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleTrustConfirm}>
              {t('trust.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
