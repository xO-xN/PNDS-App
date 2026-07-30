import { useEffect, useRef, useState } from 'react'
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
  const [dropPath, setDropPath] = useState<string | null>(null)
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const dragPathRef = useRef<string | null>(null)
  const dropPathRef = useRef<string | null>(null)
  const pendingPathRef = useRef<string | null>(null)

  const basename = (path: string) =>
    path.split('/').filter(Boolean).pop() ?? path

  /** Share: open the monitor page in the default external browser. */
  const handleShare = async () => {
    if (!running || !lanIp || !monitorPort) return
    await openUrl(`http://${lanIp}:${monitorPort}/`)
  }

  const handleEntryClick = (path: string) => {
    if (busy) return
    if (path === currentProject?.path) {
      if (pendingPathRef.current === path) return
      if (useSessionStore.getState().sessionStatus === 'idle') {
        pendingPathRef.current = null
        setPendingPath(null)
        useProjectStore.getState().clearProject()
      }
      return
    }
    if (useSessionStore.getState().sessionStatus !== 'idle') {
      // §8.3: switching projects closes the current server — confirm first.
      setPendingSwitchPath(path)
      return
    }
    if (pendingPathRef.current === path) return

    pendingPathRef.current = path
    setPendingPath(path)
    void openProject(path).finally(() => {
      if (pendingPathRef.current === path) {
        pendingPathRef.current = null
        setPendingPath(null)
      }
    })
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

  useEffect(() => {
    if (!dragPath) return

    const clearDrag = () => {
      dragPathRef.current = null
      dropPathRef.current = null
      setDragPath(null)
      setDropPath(null)
    }

    const handlePointerMove = (event: PointerEvent) => {
      const fallbackTarget =
        event.target instanceof Element ? event.target : null
      const target =
        document.elementFromPoint?.(event.clientX, event.clientY) ??
        fallbackTarget
      const row = target?.closest('[data-project-path]')
      const nextPath = row?.getAttribute('data-project-path') ?? null
      if (dropPathRef.current === nextPath) return
      dropPathRef.current = nextPath
      setDropPath(nextPath)
    }

    const finishDrag = () => {
      const sourcePath = dragPathRef.current
      const targetPath = dropPathRef.current
      if (sourcePath && targetPath && sourcePath !== targetPath) {
        const store = useProjectStore.getState()
        store.moveTrusted(sourcePath, targetPath)
        void saveRecentProjects(useProjectStore.getState().trustedPaths)
      }
      clearDrag()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', clearDrag)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', clearDrag)
    }
  }, [dragPath])

  const dragIndex = dragPath ? trustedPaths.indexOf(dragPath) : -1
  const dropIndex = dropPath ? trustedPaths.indexOf(dropPath) : -1
  const showDropBefore = dragIndex > dropIndex && dropIndex >= 0
  const showDropAfter = dragIndex >= 0 && dragIndex < dropIndex

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'relative flex w-[320px] flex-col overflow-hidden rounded-2xl text-sm',
        variant === 'static' &&
          'm-3 border border-(--pnds-text)/5 bg-(--pnds-sidebar-bg) shadow-sm',
        variant === 'overlay' &&
          'h-full border border-white/30 bg-(--pnds-sidebar-bg)/90 shadow-2xl backdrop-blur-xl'
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
            className="rounded-md p-1.5 text-(--pnds-text)/70 hover:bg-(--pnds-text)/5 hover:text-(--pnds-text) disabled:opacity-40"
          >
            <Share size={15} />
          </button>
          <button
            type="button"
            aria-label={t('sidebar.refresh')}
            title={t('sidebar.refreshHint')}
            disabled={!running}
            onClick={() => useSessionStore.getState().bumpMonitorReload()}
            className="rounded-md p-1.5 text-(--pnds-text)/70 hover:bg-(--pnds-text)/5 hover:text-(--pnds-text) disabled:opacity-40"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* PNDS Projects */}
      <h2 className="mt-2 px-9 text-[14px] font-normal text-(--pnds-text)">
        {t('sidebar.projects')}
      </h2>

      <nav className="mt-4 flex flex-col gap-1">
        {trustedPaths.map(path => {
          const isCurrent = path === currentProject?.path
          const showIndicatorBefore = showDropBefore && dropPath === path
          const showIndicatorAfter = showDropAfter && dropPath === path
          return (
            <div
              key={path}
              data-testid={isCurrent ? 'current-project-card' : 'project-entry'}
              data-project-path={path}
              onClick={() => handleEntryClick(path)}
              className={cn(
                'group relative mx-5 flex h-14.25 items-center rounded-xl px-3 transition-colors duration-150',
                isCurrent || pendingPath === path
                  ? 'bg-(--pnds-card) shadow-sm'
                  : 'hover:bg-(--pnds-text)/5',
                dragPath === path && 'opacity-50'
              )}
            >
              <div
                data-testid={
                  showIndicatorBefore ? 'project-drop-indicator' : undefined
                }
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute -top-0.5 left-5 right-5 h-px bg-(--pnds-text)/35 opacity-0 transition-opacity duration-200 ease-in-out',
                  showIndicatorBefore && 'opacity-100'
                )}
              />
              <div
                data-testid={
                  showIndicatorAfter ? 'project-drop-indicator' : undefined
                }
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute -bottom-0.5 left-5 right-5 h-px bg-(--pnds-text)/35 opacity-0 transition-opacity duration-200 ease-in-out',
                  showIndicatorAfter && 'opacity-100'
                )}
              />

              {/* Left grip: drag to reorder (visible on hover) */}
              <button
                type="button"
                aria-label={t('sidebar.dragToReorder')}
                onPointerDown={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  dragPathRef.current = path
                  dropPathRef.current = null
                  setDragPath(path)
                  setDropPath(null)
                }}
                onClick={e => e.stopPropagation()}
                className="flex w-5 shrink-0 touch-none cursor-grab items-center justify-center border-0 bg-transparent p-0 text-(--pnds-text)/40 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
              >
                <GripVertical size={14} aria-hidden="true" />
              </button>

              <button
                type="button"
                disabled={busy || (isCurrent && running)}
                title={path}
                className="flex-1 truncate text-center text-[15px] text-(--pnds-text)/85 disabled:opacity-60"
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
                  onClick={e => {
                    e.stopPropagation()
                    handleRemove(path)
                  }}
                  className="w-5 shrink-0 text-(--pnds-text)/50 opacity-0 transition-opacity hover:text-(--pnds-text) group-hover:opacity-100"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )
        })}

        {trustedPaths.length === 0 && (
          <p className="px-9 py-3 text-center text-xs text-(--pnds-text)/50">
            {t('sidebar.noProjects')}
          </p>
        )}
      </nav>

      <button
        type="button"
        onClick={() => void promptOpenProject()}
        disabled={busy}
        aria-label={t('welcome.openProject')}
        className="mx-auto mt-3 inline-flex h-6 items-center gap-1 rounded-full border border-(--pnds-text)/60 px-3 text-[12px] text-(--pnds-text) hover:bg-(--pnds-text)/5 disabled:opacity-50"
      >
        <Plus size={12} />
        {t('sidebar.open')}
      </button>

      {/* Deferred settings + their submit are one object (§10.2): the card
          clips the button into a full-bleed footer. */}
      <div className="mt-auto px-5 pb-5 pt-6">
        <div className="overflow-hidden rounded-xl bg-(--pnds-card) shadow-[0_1px_3px_rgba(23,26,43,0.1)]">
          <SettingsCard />
          <SessionActionButton />
        </div>
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
