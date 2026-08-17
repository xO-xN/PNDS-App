import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { saveProjectIndex } from '@/lib/audio-prefs'
import { projectDisplayName } from '@/lib/display-names'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SettingsSection } from '@/store/settings-store'

/**
 * v1.2.0 (spec issue #15): the settings Projects section is history
 * management — the full list of this machine's projects, per-item removal
 * with the exact sidebar-✕ semantics (index-only: no disk content is
 * touched, a removed current project loses its selection), and a
 * "Clear all" batch button that clears only the project list (folders
 * survive as empty shells). While a session is live, Clear all is
 * disabled — the sidebar's ✕ never faces a running project either, and
 * wiping the history under a live session would orphan it.
 */
export function ProjectsSection({ section }: { section: SettingsSection }) {
  const { t } = useTranslation()
  const recentProjectPaths = useProjectStore(state => state.recentProjectPaths)
  const currentProject = useProjectStore(state => state.currentProject)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const sessionLive = sessionStatus === 'starting' || sessionStatus === 'ready'

  /** History and folder membership change together — save atomically. */
  const persistIndex = () => {
    const store = useProjectStore.getState()
    void saveProjectIndex(store.recentProjectPaths, store.projectFolders)
  }

  const handleRemove = (path: string) => {
    useProjectStore.getState().removeRecentProject(path)
    persistIndex()
  }

  const handleClearAll = () => {
    useProjectStore.getState().clearRecentProjects()
    persistIndex()
  }

  return (
    <section
      id={`settings-section-${section}`}
      aria-labelledby={`settings-${section}-title`}
      className="flex flex-col gap-3 py-4"
    >
      <div className="flex items-center justify-between gap-4">
        <h3 id={`settings-${section}-title`} className="text-sm font-semibold">
          {t('settings.projects')}
        </h3>
        <Button
          variant="outline"
          size="sm"
          disabled={recentProjectPaths.length === 0 || sessionLive}
          title={sessionLive ? t('settings.clearAllBlocked') : undefined}
          onClick={handleClearAll}
        >
          {t('settings.clearAllProjects')}
        </Button>
      </div>

      {recentProjectPaths.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t('settings.projectsEmpty')}
        </p>
      ) : (
        <ul className="flex flex-col">
          {recentProjectPaths.map(path => {
            const isCurrent = path === currentProject?.path
            return (
              <li
                key={path}
                data-testid="settings-project-row"
                className="group flex items-center gap-2 border-(--pnds-text)/5 not-last:border-b py-1.5"
              >
                <div className="min-w-0 flex-1" title={path}>
                  <p className="flex items-center gap-1.5 truncate text-sm">
                    <span className="truncate">
                      {projectDisplayName(
                        path,
                        useProjectStore.getState().projectDisplayNames,
                        currentProject
                      )}
                    </span>
                    {isCurrent && (
                      <span
                        data-testid="settings-project-current"
                        className="text-muted-foreground shrink-0 text-xs"
                      >
                        {t('settings.projectCurrent')}
                      </span>
                    )}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {path}
                  </p>
                </div>
                {/* The selected project is managed by the sidebar (its ✕ is
                    hidden there too) — removal re-selects nothing. */}
                {isCurrent ? (
                  <span className="w-7 shrink-0" aria-hidden="true" />
                ) : (
                  <button
                    type="button"
                    data-testid="settings-remove-project"
                    aria-label={t('sidebar.removeFromHistory')}
                    onClick={() => handleRemove(path)}
                    className={cn(
                      'text-muted-foreground hover:text-foreground flex w-7 shrink-0 items-center justify-center rounded-md p-1',
                      'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100'
                    )}
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
