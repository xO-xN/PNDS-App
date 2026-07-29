import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { promptOpenProject, runPreflight } from '@/lib/open-project'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SidebarProps {
  /** welcome: statically visible; running: floats over the monitor */
  variant: 'static' | 'overlay'
  onRequestClose?: () => void
}

/**
 * PNDS sidebar (§10.1, §10.2). Static and always open on Welcome; hidden
 * during a performance until hovered in from the left edge. Session-restart
 * behavior for mode/device/target changes arrives in task-5 — those
 * controls are shown read-only/disabled for now.
 */
export function Sidebar({ variant, onRequestClose }: SidebarProps) {
  const { t } = useTranslation()
  const trustedPaths = useProjectStore(state => state.trustedPaths)
  const currentProject = useProjectStore(state => state.currentProject)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const audioMode = useSessionStore(state => state.audioMode)
  const running = variant === 'overlay'

  const handleStop = async () => {
    const result = await commands.stopProject()
    if (result.status === 'error') {
      useSessionStore.getState().failLocal(result.error)
    }
    onRequestClose?.()
  }

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'flex h-full w-64 flex-col gap-5 overflow-y-auto p-4 text-sm',
        variant === 'static' && 'border-e border-black/5 bg-white/50',
        variant === 'overlay' &&
          'rounded-e-2xl border-e border-white/40 bg-white/70 shadow-2xl backdrop-blur-xl'
      )}
    >
      <div className="pt-1 text-base font-semibold tracking-wide">
        {t('app.name')}
      </div>

      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('sidebar.projects')}
        </h2>
        {!running && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => void promptOpenProject()}
          >
            {t('welcome.openProject')}
          </Button>
        )}
        <ul className="mt-2 space-y-1">
          {trustedPaths.map(path => (
            <li key={path}>
              <button
                type="button"
                disabled={running}
                onClick={() => void runPreflight(path)}
                className="w-full truncate rounded-md px-2 py-1 text-start text-xs text-muted-foreground hover:bg-black/5 disabled:opacity-60"
                title={path}
              >
                {path.split('/').filter(Boolean).pop() ?? path}
              </button>
            </li>
          ))}
          {trustedPaths.length === 0 && (
            <li className="px-2 py-1 text-xs text-muted-foreground">
              {t('sidebar.noProjects')}
            </li>
          )}
        </ul>
      </section>

      {currentProject && (
        <section className="border-t border-black/5 pt-4">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('sidebar.current')}
          </h2>
          <p className="font-medium">{currentProject.manifest.name}</p>

          <div className="mt-3 flex flex-col gap-3">
            <label className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {t('session.audioMode')}
              </span>
              <select
                className="rounded-md border bg-background px-2 py-1 disabled:opacity-60"
                value={audioMode}
                disabled={running}
                onChange={e => {
                  useSessionStore.getState().setAudioMode(e.target.value)
                  logger.debug('Audio mode changed in sidebar', {
                    mode: e.target.value,
                  })
                }}
              >
                {currentProject.manifest.audio.supportedModes.map(mode => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {t('sidebar.oscTarget')}
              </span>
              <input
                className="w-32 rounded-md border bg-background px-2 py-1 disabled:opacity-60"
                defaultValue="127.0.0.1:3333"
                disabled={running || audioMode !== 'external'}
                title={t('sidebar.availableLater')}
              />
            </label>

            <label className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {t('sidebar.outputDevice')}
              </span>
              <select
                className="rounded-md border bg-background px-2 py-1 disabled:opacity-60"
                disabled
                title={t('sidebar.availableLater')}
              >
                <option>{t('sidebar.systemDefault')}</option>
              </select>
            </label>

            <label className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {t('sidebar.volume')}
              </span>
              <input
                type="range"
                className="w-28 disabled:opacity-60"
                min={0}
                max={100}
                defaultValue={80}
                disabled
                title={t('sidebar.availableLater')}
              />
            </label>
          </div>
        </section>
      )}

      {running && sessionStatus === 'ready' && (
        <div className="mt-auto border-t border-black/5 pt-4">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => void handleStop()}
          >
            {t('sidebar.stopProject')}
          </Button>
        </div>
      )}
    </aside>
  )
}
