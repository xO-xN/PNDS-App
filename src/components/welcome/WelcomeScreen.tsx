import { useTranslation } from 'react-i18next'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { confirmTrustAndOpen, promptOpenProject } from '@/lib/open-project'
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
 * Welcome main area (§10.4): hero plus, after a project passes preflight,
 * the project card with audio mode (§6.1) / LAN address (§7) selection and
 * the start action. Renders the trust confirmation dialog (§4) driven by
 * `pendingTrustPath`. Loading/Running/Error states are handled by AppShell
 * (which also owns the session event subscription, so it survives view
 * transitions).
 */
export function WelcomeScreen() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(state => state.currentProject)
  const preflightStatus = useProjectStore(state => state.preflightStatus)
  const preflightError = useProjectStore(state => state.preflightError)
  const pendingTrustPath = useProjectStore(state => state.pendingTrustPath)
  const trustedPaths = useProjectStore(state => state.trustedPaths)
  const audioMode = useSessionStore(state => state.audioMode)
  const lanIp = useSessionStore(state => state.lanIp)
  const lanAddresses = useSessionStore(state => state.lanAddresses)

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

  const canStart =
    preflightStatus === 'ready' && currentProject !== null && lanIp !== null

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-8">
      <header className="text-center">
        <h1 className="text-4xl font-semibold tracking-wide">
          {t('welcome.title')}
        </h1>
        <p className="mt-2 text-muted-foreground">{t('welcome.subtitle')}</p>
      </header>

      <Button
        size="lg"
        onClick={() => void promptOpenProject()}
        disabled={preflightStatus === 'checking'}
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
        <section className="w-full max-w-xl rounded-xl border border-white/50 bg-white/60 p-5 text-start text-sm shadow-sm backdrop-blur-md">
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

          <div className="mt-4 flex flex-col gap-3 border-t border-black/5 pt-4">
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
        </section>
      )}

      <AlertDialog
        open={pendingTrustPath !== null}
        onOpenChange={openState => {
          if (!openState) useProjectStore.getState().requestTrust(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('trust.title')}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap break-all">
              {t('trust.description', { path: pendingTrustPath })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('trust.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmTrustAndOpen}>
              {t('trust.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Screen-reader hint for keyboard users that trusted paths are listed in the sidebar */}
      <span className="sr-only">
        {trustedPaths.length > 0 ? t('sidebar.projects') : null}
      </span>
    </div>
  )
}
