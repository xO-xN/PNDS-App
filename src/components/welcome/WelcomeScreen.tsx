import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { useProjectStore } from '@/store/project-store'
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
 * project directory, confirms trust (§4), and preflight validates it (§5, §7).
 * The full window model and Figma styling arrive in task-3.
 */
export function WelcomeScreen() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(state => state.currentProject)
  const preflightStatus = useProjectStore(state => state.preflightStatus)
  const preflightError = useProjectStore(state => state.preflightError)
  const [pendingPath, setPendingPath] = useState<string | null>(null)

  const runPreflight = async (path: string) => {
    useProjectStore.getState().startPreflight()
    logger.info('Running project preflight', { path })
    const result = await commands.preflightProject(path)
    if (result.status === 'ok') {
      useProjectStore.getState().preflightSucceeded(path, result.data)
      logger.info('Preflight passed', { project: result.data.name })
    } else {
      useProjectStore.getState().preflightFailed(result.error)
      logger.warn('Preflight failed', { path, error: result.error })
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

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 p-8">
      <header className="text-center">
        <h1 className="text-4xl font-semibold tracking-wide">
          {t('welcome.title')}
        </h1>
        <p className="mt-2 text-muted-foreground">{t('welcome.subtitle')}</p>
      </header>

      <Button
        size="lg"
        onClick={() => void handleOpenProject()}
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
        <section className="max-w-xl rounded-md border p-4 text-start text-sm">
          <h2 className="text-base font-medium">
            {currentProject.manifest.name}
          </h2>
          <p className="mt-1 break-all text-muted-foreground">
            {currentProject.path}
          </p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">{t('project.version')}</dt>
            <dd>{currentProject.manifest.version}</dd>
            <dt className="text-muted-foreground">{t('project.modes')}</dt>
            <dd>{currentProject.manifest.audio.supportedModes.join(', ')}</dd>
            <dt className="text-muted-foreground">{t('project.ports')}</dt>
            <dd>
              {currentProject.manifest.scoreServer.performerPort}
              {' / '}
              {currentProject.manifest.scoreServer.monitorPort}
            </dd>
          </dl>
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
