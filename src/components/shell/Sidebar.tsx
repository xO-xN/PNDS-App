import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X, Share, RefreshCw, GripVertical } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import {
  openProject,
  promptOpenProject,
  stopAndReset,
} from '@/lib/open-project'
import { saveRecentProjects } from '@/lib/audio-prefs'
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
import { SettingsCard } from './SettingsCard'
import { SessionActionButton } from './SessionActionButton'
import { TrafficLights } from './TrafficLights'
import { cn } from '@/lib/utils'

interface SidebarProps {
  /** welcome/loading: statically visible; running: floats over the monitor */
  variant: 'static' | 'overlay'
  onRequestClose?: () => void
}

/**
 * PNDS sidebar (§10.1, §10.2; Figma "PNDS UI Design"). A floating rounded
 * panel, always open on Welcome/Loading and popping in over the monitor
 * during a performance. Selecting a project only preflights it; starting
 * is explicit via the Load button (§8). Entries can be reordered with the
 * left grip handle; the ✕ (remove from history) only appears on projects
 * that are not currently open. Switching while a session runs asks for
 * confirmation first (§8.3, Figma "Loading another project").
 */
export function Sidebar({ variant, onRequestClose }: SidebarProps) {
  const { t } = useTranslation()
  const trustedPaths = useProjectStore(state => state.trustedPaths)
  const currentProject = useProjectStore(state => state.currentProject)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const lanIp = useSessionStore(state => state.lanIp)
  const monitorPort = useSessionStore(
    state => state.health?.scoreServer?.monitorPort
  )
  const busy = sessionStatus === 'starting' || sessionStatus === 'stopping'
  const running = sessionStatus === 'ready'
  const [pendingSwitchPath, setPendingSwitchPath] = useState<string | null>(
    null
  )
  const [dragPath, setDragPath] = useState<string | null>(null)

  const basename = (path: string) =>
    path.split('/').filter(Boolean).pop() ?? path

  /** Share: open the monitor page in the default external browser. */
  const handleShare = async () => {
    if (!running || !lanIp || !monitorPort) return
    await openUrl(`http://${lanIp}:${monitorPort}/`)
  }

  const handleEntryClick = (path: string) => {
    if (busy || path === currentProject?.path) return
    if (useSessionStore.getState().sessionStatus !== 'idle') {
      // §8.3: switching projects closes the current server — confirm first.
      setPendingSwitchPath(path)
      return
    }
    void openProject(path)
  }

  const confirmSwitch = async () => {
    const path = pendingSwitchPath
    setPendingSwitchPath(null)
    if (!path) return
    await stopAndReset()
    await openProject(path)
    onRequestClose?.()
  }

  /** ✕ (remove from history) is only offered for projects that are not
   * currently open; the Close action handles the open one. */
  const handleRemove = (path: string) => {
    useProjectStore.getState().removeTrusted(path)
    void saveRecentProjects(useProjectStore.getState().trustedPaths)
  }

  const handleDrop = (targetPath: string) => {
    if (dragPath && dragPath !== targetPath) {
      useProjectStore.getState().moveTrusted(dragPath, targetPath)
    }
    setDragPath(null)
  }

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
            title={t('sidebar.shareHint')}
            disabled={!running || !lanIp || !monitorPort}
            onClick={() => void handleShare()}
            className="rounded-md p-1.5 text-black/70 hover:bg-black/5 hover:text-black disabled:opacity-40"
          >
            <Share size={15} />
          </button>
          <button
            type="button"
            aria-label={t('sidebar.refresh')}
            title={t('sidebar.refreshHint')}
            disabled={!running}
            onClick={() => useSessionStore.getState().bumpMonitorReload()}
            className="rounded-md p-1.5 text-black/70 hover:bg-black/5 hover:text-black disabled:opacity-40"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* PNDS Projects */}
      <h2 className="mt-2 px-9 text-[14px] font-normal text-black">
        {t('sidebar.projects')}
      </h2>

      <nav className="mt-4 flex flex-col gap-1">
        {trustedPaths.map(path => {
          const isCurrent = path === currentProject?.path
          return (
            <div
              key={path}
              data-testid={isCurrent ? 'current-project-card' : 'project-entry'}
              onDragOver={e => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
              }}
              onDrop={e => {
                e.preventDefault()
                handleDrop(path)
              }}
              className={cn(
                'group mx-5 flex h-[57px] items-center rounded-xl px-3 transition-colors duration-150',
                isCurrent ? 'bg-[#f5f5f5] shadow-sm' : 'hover:bg-black/5',
                dragPath === path && 'opacity-50'
              )}
            >
              {/* Left grip: drag to reorder (visible on hover) */}
              <span
                draggable
                onDragStart={e => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', path)
                  setDragPath(path)
                }}
                onDragEnd={() => setDragPath(null)}
                aria-label={t('sidebar.dragToReorder')}
                className="w-5 shrink-0 cursor-grab text-black/40 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
              >
                <GripVertical size={14} />
              </span>

              <button
                type="button"
                disabled={busy || isCurrent}
                onClick={() => handleEntryClick(path)}
                title={path}
                className="flex-1 truncate text-center text-[15px] text-black/85 disabled:opacity-60"
              >
                {isCurrent ? currentProject.manifest.name : basename(path)}
              </button>

              {/* Right ✕: remove from history — never for the open project */}
              {isCurrent ? (
                <span className="w-5 shrink-0" />
              ) : (
                <button
                  type="button"
                  aria-label={t('sidebar.removeFromHistory')}
                  onClick={() => handleRemove(path)}
                  className="w-5 shrink-0 text-black/50 opacity-0 transition-opacity hover:text-black group-hover:opacity-100"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )
        })}

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

      {/* Settings card + primary action pinned to the bottom (§10.2) */}
      <div className="mt-auto px-5 pb-5 pt-6">
        <SettingsCard />
        <SessionActionButton />
      </div>

      {/* §8.3 switch confirmation (Figma "Loading another project") */}
      <AlertDialog
        open={pendingSwitchPath !== null}
        onOpenChange={openState => {
          if (!openState) setPendingSwitchPath(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('switchProject.title', {
                name: pendingSwitchPath ? basename(pendingSwitchPath) : '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('switchProject.description', {
                name: pendingSwitchPath ? basename(pendingSwitchPath) : '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('switchProject.back')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmSwitch()}>
              {t('switchProject.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
