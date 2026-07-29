import { useTranslation } from 'react-i18next'
import { Plus, X, Menu } from 'lucide-react'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { commands } from '@/lib/tauri-bindings'
import { openProject, promptOpenProject } from '@/lib/open-project'
import { SettingsCard } from './SettingsCard'
import { cn } from '@/lib/utils'

interface SidebarProps {
  /** welcome/loading: statically visible; running: floats over the monitor */
  variant: 'static' | 'overlay'
  onRequestClose?: () => void
}

/**
 * PNDS sidebar (§10.1, §10.2; Figma "PNDS UI Design"). Always open on
 * Welcome/Loading; floats in from the left edge during a performance.
 * Clicking a project entry starts it (trust gate + preflight first, §4/§5);
 * switching projects while running asks for confirmation (§8.3, task-5).
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
    const result = await commands.stopProject()
    if (result.status === 'error') {
      useSessionStore.getState().failLocal(result.error)
    }
    onRequestClose?.()
  }

  const otherPaths = trustedPaths.filter(p => p !== currentProject?.path)

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'relative flex h-full w-64 flex-col overflow-y-auto px-4 pb-4 pt-12 text-sm',
        variant === 'static' && 'bg-[#bfbfbf]',
        variant === 'overlay' &&
          'rounded-e-2xl border-e border-white/30 bg-[#bfbfbf]/85 shadow-2xl backdrop-blur-xl'
      )}
    >
      {/* Window drag area (§10.1: the sidebar must offer window dragging) */}
      <div
        data-tauri-drag-region
        className="absolute left-0 right-0 top-0 h-10"
      />

      {/* PNDS Projects */}
      <h2 className="px-2 text-[15px] font-normal text-black">
        {t('sidebar.projects')}
      </h2>

      <nav className="mt-4 flex flex-col">
        {currentProject && (
          <div
            data-testid="current-project-card"
            className="flex items-center justify-between rounded-xl bg-[#f5f5f5] px-4 py-3 shadow-sm"
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
            className="truncate rounded-xl px-4 py-3 text-center text-[15px] text-black/85 hover:bg-black/5 disabled:opacity-50"
          >
            {path.split('/').filter(Boolean).pop() ?? path}
          </button>
        ))}

        {trustedPaths.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-black/50">
            {t('sidebar.noProjects')}
          </p>
        )}
      </nav>

      <button
        type="button"
        onClick={() => void promptOpenProject()}
        disabled={busy}
        aria-label={t('welcome.openProject')}
        className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-black/60 px-3.5 py-1 text-[13px] text-black hover:bg-black/5 disabled:opacity-50"
      >
        <Plus size={14} />
        {t('sidebar.open')}
      </button>

      {/* Settings card pinned to the bottom (§10.2) */}
      <div className="mt-auto pt-6">
        <SettingsCard />
      </div>
    </aside>
  )
}
