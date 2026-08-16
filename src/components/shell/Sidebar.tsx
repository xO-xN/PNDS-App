import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  X,
  Share,
  RefreshCw,
  GripVertical,
  Folder,
  FolderPlus,
  Command,
} from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useProjectStore, ungroupedProjectPaths } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import {
  openProject,
  promptOpenProject,
  stopAndReset,
} from '@/lib/open-project'
import { selectProject } from '@/lib/project-select'
import { saveProjectIndex } from '@/lib/audio-prefs'
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
  /** Overlay mode: a settings popup menu is open — keep the sidebar visible. */
  onPopupOpenChange?: (open: boolean) => void
  /** Overlay mode: a sidebar dialog (switch / folder delete) is open —
   * releasing Cmd must not retract the peeked sidebar. */
  onDialogOpenChange?: (open: boolean) => void
}

/**
 * PNDS sidebar (§10.1, §10.2; Figma "PNDS UI Design"). A floating rounded
 * panel, always open on Welcome/Loading and popping in over the monitor
 * during a performance. Selecting a project only preflights it; starting
 * is explicit via the Load button (§8). Entries can be reordered with the
 * left grip handle; the ✕ (remove from history) only appears on projects
 * that are not currently open. Switching while a session runs asks for
 * confirmation first (§8.3, Figma "Loading another project").
 *
 * v1.1.2: the list is two-segment (spec issue #4) — ungrouped projects on
 * top, folders (set lists) below; holding Cmd numbers the first nine
 * visible projects.
 */
export function Sidebar({
  variant,
  onRequestClose,
  onPopupOpenChange,
  onDialogOpenChange,
}: SidebarProps) {
  const { t } = useTranslation()
  const trustedPaths = useProjectStore(state => state.trustedPaths)
  const projectFolders = useProjectStore(state => state.projectFolders)
  const currentProject = useProjectStore(state => state.currentProject)
  const pendingPreflightPath = useProjectStore(
    state => state.pendingPreflightPath
  )
  const pendingSwitchPath = useProjectStore(state => state.pendingSwitchPath)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const commandKeyPressed = useKeyboardStore(state => state.commandKeyPressed)
  const lanIp = useSessionStore(state => state.lanIp)
  const monitorPort = useSessionStore(
    state => state.health?.scoreServer?.monitorPort
  )
  const busy = sessionStatus === 'starting' || sessionStatus === 'stopping'
  const running = sessionStatus === 'ready'
  const [dragPath, setDragPath] = useState<string | null>(null)
  const [dropPath, setDropPath] = useState<string | null>(null)
  /** Folder being inline-named (creation gesture: Enter commits, Esc cancels). */
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const editingFolderNameRef = useRef('')
  const [pendingDeleteFolderId, setPendingDeleteFolderId] = useState<
    string | null
  >(null)
  const dragPathRef = useRef<string | null>(null)
  const dropPathRef = useRef<string | null>(null)

  const ungroupedPaths = ungroupedProjectPaths(trustedPaths, projectFolders)
  const pendingDeleteFolder = projectFolders.find(
    folder => folder.id === pendingDeleteFolderId
  )

  // Title-case the folder name (multichannel-tone-test → Multichannel Tone
  // Test) so an unselected project reads the same as its manifest name.
  const displayName = (path: string) => {
    const base = path.split('/').filter(Boolean).pop() ?? path
    return base
      .split('-')
      .map(part => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
      .join(' ')
  }

  /** Persists the app-side project index — trust list and folder
   * membership change together, so they always save atomically. */
  const persistIndex = () => {
    const store = useProjectStore.getState()
    void saveProjectIndex(store.trustedPaths, store.projectFolders)
  }

  /** Share: open the monitor page in the default external browser. */
  const handleShare = async () => {
    if (!running || !lanIp || !monitorPort) return
    await openUrl(`http://${lanIp}:${monitorPort}/`)
  }

  const confirmSwitch = async () => {
    const path = useProjectStore.getState().pendingSwitchPath
    useProjectStore.getState().clearSwitchRequest()
    if (!path) return
    await stopAndReset()
    await openProject(path)
    onRequestClose?.()
  }

  /** ✕ (remove from history) is only offered for projects that are not
   * currently open; the Close action handles the open one. Removing the
   * app-side index never touches the on-disk project (spec issue #4). */
  const handleRemove = (path: string) => {
    useProjectStore.getState().removeTrusted(path)
    persistIndex()
  }

  const handleNewFolder = () => {
    const store = useProjectStore.getState()
    const id = store.createFolder(t('sidebar.folderDefaultName'))
    editingFolderNameRef.current = t('sidebar.folderDefaultName')
    setEditingFolderId(id)
    persistIndex()
  }

  const commitFolderName = () => {
    const id = editingFolderId
    if (!id) return
    const name = editingFolderNameRef.current.trim()
    const store = useProjectStore.getState()
    if (name) store.renameFolder(id, name)
    setEditingFolderId(null)
    persistIndex()
  }

  const cancelFolderName = () => {
    const id = editingFolderId
    if (!id) return
    setEditingFolderId(null)
    // Esc during creation discards the empty folder.
    const store = useProjectStore.getState()
    const folder = store.projectFolders.find(f => f.id === id)
    if (folder && folder.projectPaths.length === 0) {
      store.deleteFolder(id)
      persistIndex()
    }
  }

  const confirmDeleteFolder = () => {
    const id = pendingDeleteFolderId
    setPendingDeleteFolderId(null)
    if (!id) return
    useProjectStore.getState().deleteFolder(id)
    persistIndex()
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
        useProjectStore.getState().moveTrusted(sourcePath, targetPath)
        const { trustedPaths, projectFolders } = useProjectStore.getState()
        void saveProjectIndex(trustedPaths, projectFolders)
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

  // Report dialog visibility so the hover sidebar keeps peeking while a
  // confirm flow is open (spec issue #4: 确认框期间松开 Cmd 不收回).
  const dialogOpen =
    pendingSwitchPath !== null || pendingDeleteFolderId !== null
  useEffect(() => {
    onDialogOpenChange?.(dialogOpen)
  }, [dialogOpen, onDialogOpenChange])

  const dragIndex = dragPath ? ungroupedPaths.indexOf(dragPath) : -1
  const dropIndex = dropPath ? ungroupedPaths.indexOf(dropPath) : -1
  const showDropBefore = dragIndex > dropIndex && dropIndex >= 0
  const showDropAfter = dragIndex >= 0 && dragIndex < dropIndex

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'relative flex w-[320px] flex-col overflow-hidden rounded-[var(--app-corner-radius)] text-sm',
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

      {/* PNDS Projects + new-folder (v1.1.2) */}
      <div className="mt-2 flex items-center justify-between pr-8 pl-9">
        <h2 className="text-[14px] font-normal text-(--pnds-text)">
          {t('sidebar.projects')}
        </h2>
        <button
          type="button"
          data-testid="new-folder-button"
          aria-label={t('sidebar.newFolder')}
          title={t('sidebar.newFolder')}
          onClick={handleNewFolder}
          className="rounded-md p-1 text-(--pnds-text)/70 hover:bg-(--pnds-text)/5 hover:text-(--pnds-text)"
        >
          <FolderPlus size={14} />
        </button>
      </div>

      <nav className="mt-4 flex flex-col gap-1">
        {ungroupedPaths.map((path, index) => {
          const isCurrent = path === currentProject?.path
          const showIndicatorBefore = showDropBefore && dropPath === path
          const showIndicatorAfter = showDropAfter && dropPath === path
          const showBadge = commandKeyPressed && index < 9
          return (
            <div
              key={path}
              data-testid={isCurrent ? 'current-project-card' : 'project-entry'}
              data-project-path={path}
              onClick={() => selectProject(path, 'click')}
              className={cn(
                'group relative mx-5 flex h-14.25 items-center rounded-xl px-3 transition-colors duration-150',
                isCurrent || pendingPreflightPath === path
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
                {isCurrent ? currentProject.manifest.name : displayName(path)}
              </button>

              {/* Right slot: ⌘N hint while Cmd is held (v1.1.2), else ✕
                  remove from history — never for the open project */}
              {showBadge ? (
                <span
                  data-testid="project-number-badge"
                  className="flex w-5 shrink-0 items-center justify-center gap-0.5 text-(--pnds-text)/45"
                >
                  <Command size={10} strokeWidth={2.5} aria-hidden="true" />
                  <span className="translate-y-[0.5px] text-[10px] leading-none font-semibold">
                    {index + 1}
                  </span>
                </span>
              ) : isCurrent ? (
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

        {/* Folders (set lists) — second segment, below ungrouped projects */}
        {projectFolders.length > 0 && (
          <p className="mt-3 px-9 text-[11px] font-medium tracking-wider text-(--pnds-text)/40 uppercase">
            {t('sidebar.folders')}
          </p>
        )}
        {projectFolders.map(folder => {
          const isEditing = editingFolderId === folder.id
          return (
            <div
              key={folder.id}
              data-testid="folder-card"
              className="group relative mx-5 flex h-14.25 items-center rounded-xl px-3 hover:bg-(--pnds-text)/5"
            >
              {isEditing ? (
                <input
                  data-testid="folder-name-input"
                  autoFocus
                  defaultValue={folder.name}
                  onFocus={e => e.target.select()}
                  onChange={e => {
                    editingFolderNameRef.current = e.target.value
                  }}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === 'Enter') commitFolderName()
                    if (e.key === 'Escape') cancelFolderName()
                  }}
                  onBlur={commitFolderName}
                  className="flex-1 truncate rounded-lg border border-(--pnds-text)/15 bg-(--pnds-text)/5 px-2 py-1 text-center text-[15px] text-(--pnds-text) outline-none"
                />
              ) : (
                <>
                  <span className="flex w-5 shrink-0 items-center justify-center text-(--pnds-text)/40">
                    <Folder size={15} aria-hidden="true" />
                  </span>
                  <span
                    data-testid="folder-name"
                    className="flex-1 truncate text-center text-[15px] text-(--pnds-text)/85"
                  >
                    {folder.name}
                  </span>
                  <button
                    type="button"
                    aria-label={t('sidebar.deleteFolder')}
                    onClick={() => setPendingDeleteFolderId(folder.id)}
                    className="w-5 shrink-0 text-(--pnds-text)/50 opacity-0 transition-opacity hover:text-(--pnds-text) group-hover:opacity-100"
                  >
                    <X size={14} />
                  </button>
                </>
              )}
            </div>
          )
        })}
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
          <SettingsCard onPopupOpenChange={onPopupOpenChange} />
          <SessionActionButton />
        </div>
      </div>

      {/* §8.3 switch confirmation (Figma "Loading another project") */}
      <AlertDialog
        open={pendingSwitchPath !== null}
        onOpenChange={openState => {
          if (!openState) {
            useProjectStore.getState().clearSwitchRequest()
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('switchProject.title', {
                name: pendingSwitchPath ? displayName(pendingSwitchPath) : '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('switchProject.description', {
                name: pendingSwitchPath ? displayName(pendingSwitchPath) : '',
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

      {/* v1.1.2: folder deletion — children return to ungrouped, nothing
          on disk is touched (spec issue #4). */}
      <AlertDialog
        open={pendingDeleteFolderId !== null}
        onOpenChange={openState => {
          if (!openState) setPendingDeleteFolderId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('sidebar.deleteFolderTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('sidebar.deleteFolderMessage', {
                name: pendingDeleteFolder?.name ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('sidebar.deleteFolderCancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteFolder}>
              {t('sidebar.deleteFolderConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
