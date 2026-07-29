import { useTranslation } from 'react-i18next'
import { Plus, X, Menu, Share, RefreshCw } from 'lucide-react'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { logger } from '@/lib/logger'
import {
  openProject,
  promptOpenProject,
  stopAndReset,
} from '@/lib/open-project'
import { SettingsCard } from './SettingsCard'
import { TrafficLights } from './TrafficLights'
import { cn } from '@/lib/utils'

interface SidebarProps {
  /** welcome/loading: statically visible; running: floats over the monitor */
  variant: 'static' | 'overlay'
  onRequestClose?: () => void
}

/**
 * PNDS sidebar (§10.1, §10.2; Figma "PNDS UI Design"). A floating rounded
 * panel (Zen-browser style) that is always open on Welcome/Loading and
 * pops in over the monitor during a performance. Clicking a project entry
 * starts it (trust gate + preflight first, §4/§5); switching projects
 * while running asks for confirmation (§8.3, task-5).
 */
export function Sidebar({ variant, onRequestClose }: SidebarProps) {
  const { t } = useTranslation()
  const trustedPaths = useProjectStore(state => state.trustedPaths)
  const currentProject = useProjectStore(state => state.currentProject)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const running = variant === 'overlay'
  const busy = sessionStatus === 'starting' || sessionStatus === 'stopping'

  const handleEntryClick = (path: string) => {
    if (busy) return
    if (running && currentProject && path === currentProject.path) return
    void openProject(path)
  }

  const handleStop = async () => {
    await stopAndReset()
    onRequestClose?.()
  }

  const otherPaths = trustedPaths.filter(p => p !== currentProject?.path)

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'relative flex w-[320px] flex-col overflow-hidden rounded-2xl text-sm',
        variant === 'static' &&
          'm-3 border border-black/5 bg-[#bfbfbf] shadow-sm',
        variant === 'overlay' &&
          'h-full border border-white/30 bg-[#bfbfbf]/90 shadow-2xl backdrop-blur-xl'
      )}
    >
      {/* Top row: custom traffic lights (left), share/refresh (right).
          The whole strip is a window drag region (§10.1); the button
          clusters opt out so they stay clickable. */}
      <div
        data-tauri-drag-region
        className="flex h-14 items-start justify-between px-4 pt-4"
      >
        <div data-tauri-drag-region="false">
          <TrafficLights />
        </div>
        <div data-tauri-drag-region="false" className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('sidebar.share')}
            title={t('sidebar.comingSoon')}
            onClick={() =>
              logger.debug('sidebar share clicked (not wired yet)')
            }
            className="rounded-md p-1.5 text-black/70 hover:bg-black/5 hover:text-black"
          >
            <Share size={15} />
          </button>
          <button
            type="button"
            aria-label={t('sidebar.refresh')}
            title={t('sidebar.comingSoon')}
            onClick={() =>
              logger.debug('sidebar refresh clicked (not wired yet)')
            }
            className="rounded-md p-1.5 text-black/70 hover:bg-black/5 hover:text-black"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* PNDS Projects */}
      <h2 className="mt-2 px-9 text-[14px] font-normal text-black">
        {t('sidebar.projects')}
      </h2>

      <nav className="mt-6 flex flex-col">
        {currentProject && (
          <div
            data-testid="current-project-card"
            className="mx-5 flex h-[57px] items-center justify-between rounded-xl bg-[#f5f5f5] px-4 shadow-sm"
          >
            {running ? (
              <button
                aria-label={t('sidebar.hideSidebar')}
                onClick={onRequestClose}
                className="text-black/70 hover:text-black"
              >
                <Menu size={16} />
              </button>
            ) : (
              <span className="w-4" />
            )}
            <span className="mx-2 flex-1 truncate text-center text-[15px] text-black">
              {currentProject.manifest.name}
            </span>
            {running ? (
              <button
                aria-label={t('sidebar.stopProject')}
                onClick={() => void handleStop()}
                className="text-black/70 hover:text-black"
              >
                <X size={16} />
              </button>
            ) : (
              <span className="w-4" />
            )}
          </div>
        )}

        {otherPaths.map(path => (
          <button
            key={path}
            type="button"
            disabled={busy}
            onClick={() => handleEntryClick(path)}
            title={path}
            className="flex h-[68px] items-center justify-center truncate px-9 text-[15px] text-black/85 hover:bg-black/5 disabled:opacity-50"
          >
            {path.split('/').filter(Boolean).pop() ?? path}
          </button>
        ))}

        {trustedPaths.length === 0 && (
          <p className="px-9 py-3 text-center text-xs text-black/50">
            {t('sidebar.noProjects')}
          </p>
        )}
      </nav>

      <button
        type="button"
        onClick={() => void promptOpenProject()}
        disabled={busy}
        aria-label={t('welcome.openProject')}
        className="mx-auto mt-3 inline-flex h-6 items-center gap-1 rounded-full border border-black/60 px-3 text-[12px] text-black hover:bg-black/5 disabled:opacity-50"
      >
        <Plus size={12} />
        {t('sidebar.open')}
      </button>

      {/* Settings card pinned to the bottom (§10.2) */}
      <div className="mt-auto px-5 pb-5 pt-6">
        <SettingsCard />
      </div>
    </aside>
  )
}
