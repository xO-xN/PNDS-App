import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  X,
  Share,
  RefreshCw,
  Folder,
  FolderPlus,
  Command,
  ChevronLeft,
} from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  isProtectedFolder,
  useProjectStore,
  visibleProjectPaths,
} from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import {
  openProject,
  promptOpenProject,
  stopAndReset,
} from '@/lib/open-project'
import { selectProject, setActiveFolderView } from '@/lib/project-select'
import { reclaimIfManagedBundle } from '@/lib/bundle-project'
import { saveProjectDisplayName, saveProjectIndex } from '@/lib/audio-prefs'
import { projectDisplayName } from '@/lib/display-names'
import {
  cardShift,
  folderDropAt,
  insertionIndexFor,
  projectDropAt,
  reorderedList,
  sameDropTarget,
  type DragHitSpace,
  type DragSpaces,
  type FolderDropTarget,
  type ProjectDropTarget,
  type Rect,
} from '@/lib/drag-reorder'
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
 * Geometry captured when a card press activates into a drag
 * (v1.1.2 T4, spec issue #8).
 * It anchors the floating clone to the pointer and carries the card stride
 * the yielding cards translate by.
 */
interface DragGhost {
  /** Card top-left in viewport coordinates; the clone starts exactly there. */
  x: number
  y: number
  width: number
  height: number
  /** Grab offset inside the card so the clone tracks the pointer 1:1. */
  offsetX: number
  offsetY: number
  /** Card pitch (height + list gap) the yielding cards translate by. */
  stride: number
}

/**
 * v1.1.2 T5 (spec issue #9): one drag source — a visible project card or a
 * top-level folder card.
 */
type DragSource =
  | { kind: 'project'; path: string }
  | { kind: 'folder'; id: string }

/** Any drop target the sidebar resolves while a drag is live. */
type ActiveDropTarget = ProjectDropTarget | FolderDropTarget

/** The pointer must travel this far (px, manhattan) before a card press
 * becomes a drag — below it the gesture stays a click. */
const DRAG_ACTIVATION_SLACK = 4

/**
 * Static slot layout of a uniform card column: the first card's rect plus
 * the pitch measured to the second. Null when the column has no cards.
 */
function hitSpaceOf(
  cards: NodeListOf<Element> | undefined
): DragHitSpace | null {
  const first = cards?.[0]
  if (!(first instanceof HTMLElement)) return null
  const firstRect = first.getBoundingClientRect()
  const second = cards?.[1]
  const stride =
    second instanceof HTMLElement
      ? second.getBoundingClientRect().top - firstRect.top
      : firstRect.height + 4
  return {
    top: firstRect.top,
    left: firstRect.left,
    right: firstRect.right,
    cardHeight: firstRect.height,
    stride,
    count: cards?.length ?? 0,
  }
}

/** Rect snapshot for point hit-testing (the breadcrumb bar). */
function rectOf(element: HTMLElement | null): Rect | null {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
  }
}

interface InlineNameInputProps {
  testId: string
  value: string
  className: string
  onCommit: (name: string) => void
  onCancel: () => void
}

/**
 * v1.1.2 T6: the inline name editor behind ⌘R and the new-folder gesture
 * (spec issue #10) — autofocus with the current name selected, Enter or
 * blur commits, Esc cancels. The draft is seeded on mount, so Enter
 * without typing is a no-op.
 */
function InlineNameInput({
  testId,
  value,
  className,
  onCommit,
  onCancel,
}: InlineNameInputProps) {
  const draftRef = useRef(value)
  return (
    <input
      data-testid={testId}
      autoFocus
      defaultValue={value}
      ref={node => {
        if (node) draftRef.current = node.value
      }}
      onClick={e => e.stopPropagation()}
      onFocus={e => e.target.select()}
      onChange={e => {
        draftRef.current = e.target.value
      }}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') onCommit(draftRef.current)
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={() => onCommit(draftRef.current)}
      className={className}
    />
  )
}

/**
 * PNDS sidebar (§10.1, §10.2; Figma "PNDS UI Design"). A floating rounded
 * panel, always open on Welcome/Loading and popping in over the monitor
 * during a performance. Selecting a project only preflights it; starting
 * is explicit via the Load button (§8). Entries can be reordered by
 * dragging anywhere on the card — the dragged card becomes a
 * semi-transparent floating clone while the remaining cards yield a
 * full-card-sized gap at the midpoint-judged drop slot (v1.1.2 T4); the ✕
 * (remove from history) only appears on projects that are not currently
 * open. Switching while a session runs asks for confirmation first
 * (§8.3, Figma "Loading another project").
 *
 * v1.1.2: the list is two-segment (spec issue #4) — projects at the top,
 * folders (set lists) pinned directly above the footer controls; an
 * always-visible "+" beside the Projects label imports a project, the
 * FOLDERS row reveals the new-folder button on hover. Clicking a folder
 * card drills into it (breadcrumb returns to the top), and holding Cmd
 * numbers the first nine projects of the current view.
 *
 * v1.1.2 T5 (spec issue #9): folder drag interactions — dropping a card
 * on a folder card files it into that folder's end, dropping a member on
 * the breadcrumb bar returns it to ungrouped, and folder cards reorder
 * within their section by the same drag gesture. Every structural change
 * persists via the project index.
 *
 * v1.1.2 T6 (spec issue #10): ⌘R renames in place — the selected project
 * card's title becomes an input (Enter/blur commit, Esc cancel, empty
 * falls back to the path basename) and with nothing selected inside a
 * folder view the breadcrumb's folder name does. Overrides persist in
 * preferences (`projectDisplayNames`) and every name display follows them.
 */
export function Sidebar({
  variant,
  onRequestClose,
  onPopupOpenChange,
  onDialogOpenChange,
}: SidebarProps) {
  const { t } = useTranslation()
  const recentProjectPaths = useProjectStore(state => state.recentProjectPaths)
  const projectFolders = useProjectStore(state => state.projectFolders)
  const currentProject = useProjectStore(state => state.currentProject)
  const pendingPreflightPath = useProjectStore(
    state => state.pendingPreflightPath
  )
  const pendingSwitchPath = useProjectStore(state => state.pendingSwitchPath)
  const confirmCloseProjectOpen = useProjectStore(
    state => state.confirmCloseProjectOpen
  )
  const activeFolderId = useProjectStore(state => state.activeFolderId)
  const projectDisplayNames = useProjectStore(
    state => state.projectDisplayNames
  )
  const manifestProjectNames = useProjectStore(
    state => state.manifestProjectNames
  )
  const renameTarget = useProjectStore(state => state.renameTarget)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const commandKeyPressed = useKeyboardStore(state => state.commandKeyPressed)
  const lanIp = useSessionStore(state => state.lanIp)
  const monitorPort = useSessionStore(
    state => state.health?.scoreServer?.monitorPort
  )
  const busy = sessionStatus === 'starting' || sessionStatus === 'stopping'
  const running = sessionStatus === 'ready'
  // v1.1.2 T3: the folder card shows its "in use" dot from the moment the
  // session starts, not only once ready (spec issue #4: 使用中指示点).
  const sessionLive = sessionStatus === 'starting' || sessionStatus === 'ready'
  const [drag, setDrag] = useState<DragSource | null>(null)
  const [dropTarget, setDropTarget] = useState<ActiveDropTarget | null>(null)
  /** Clone origin/stride snapshot; mirrors dragGhostRef for render. */
  const [dragGhost, setDragGhost] = useState<DragGhost | null>(null)
  /** Card press armed by pointerdown, not yet a drag (slack not passed). */
  const [press, setPress] = useState<DragSource | null>(null)
  /**
   * True for one frame after a committed drop. The DOM reorder and the
   * clearing of the yield transforms land in the same commit, so without
   * this the yielding cards — already visually at their final spots —
   * would animate from their stale offsets back to zero and slide the
   * wrong way for a card-stride. Suppressing transitions for that single
   * frame makes them snap invisibly into place.
   */
  const [suppressTransition, setSuppressTransition] = useState(false)
  /** Folder being inline-named (creation gesture: Enter commits, Esc cancels). */
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [pendingDeleteFolderId, setPendingDeleteFolderId] = useState<
    string | null
  >(null)
  const dragRef = useRef<DragSource | null>(null)
  const dropTargetRef = useRef<ActiveDropTarget | null>(null)
  const dragGhostRef = useRef<DragGhost | null>(null)
  /** Armed press source, geometry anchor and origin point. */
  const pressRef = useRef<{
    source: DragSource
    cardSelector: string
    card: HTMLElement | null
    nav: HTMLElement | null
    x: number
    y: number
  } | null>(null)
  /** True for the one click right after a real drag — the drop's pointerup
   * must not turn into a selection. Reset on every fresh press. */
  const suppressClickRef = useRef(false)
  const dragSpacesRef = useRef<DragSpaces>({
    list: null,
    folders: null,
    breadcrumb: null,
  })
  const breadcrumbBarRef = useRef<HTMLDivElement | null>(null)
  const cloneRef = useRef<HTMLDivElement | null>(null)

  // v1.1.2 T3: one folder-aware derivation drives the list, the number
  // badges and the drag indices (spec issue #7: 可见列表与序号派生).
  const visiblePaths = visibleProjectPaths(
    recentProjectPaths,
    projectFolders,
    activeFolderId
  )
  const activeFolder =
    activeFolderId === null
      ? null
      : (projectFolders.find(folder => folder.id === activeFolderId) ?? null)
  const pendingDeleteFolder = projectFolders.find(
    folder => folder.id === pendingDeleteFolderId
  )

  // v1.2.0 (issue #16): the one listing name for `path` (display-names.ts)
  // — a v1.1.2 T6 display-name override (spec issue #10) wins, then the
  // manifest-declared name learned at preflight, then the title-cased path
  // basename. Cards, the drag clone and the switch dialog all read this.
  const cardName = (path: string) =>
    projectDisplayName(
      path,
      projectDisplayNames,
      manifestProjectNames,
      currentProject
    )

  /** Persists the app-side project index — history list and folder
   * membership change together, so they always save atomically. */
  const persistIndex = () => {
    const store = useProjectStore.getState()
    void saveProjectIndex(store.recentProjectPaths, store.projectFolders)
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

  /** v1.1.2 T7: the lone-Esc close confirmation's submit — same teardown
   * as the Close button / ⌘Esc, just behind an explicit OK. */
  const confirmCloseProject = async () => {
    useProjectStore.getState().setConfirmCloseProjectOpen(false)
    await stopAndReset()
  }

  /** ✕ (remove from history) is only offered for projects that are not
   * currently open; the Close action handles the open one. Removing the
   * app-side index never touches the on-disk project (spec issue #4);
   * v1.2.0 (issue #16) additionally reclaims bundle installs under the
   * app-managed bundles/ directory. */
  const handleRemove = (path: string) => {
    useProjectStore.getState().removeRecentProject(path)
    persistIndex()
    void reclaimIfManagedBundle(path)
  }

  const handleNewFolder = () => {
    const store = useProjectStore.getState()
    const id = store.createFolder(t('sidebar.folderDefaultName'))
    setEditingFolderId(id)
    persistIndex()
  }

  const commitFolderName = (rawName: string) => {
    const target = useProjectStore.getState().renameTarget
    const id = editingFolderId ?? (target?.kind === 'folder' ? target.id : null)
    if (!id) return
    const name = rawName.trim()
    const store = useProjectStore.getState()
    if (name) store.renameFolder(id, name)
    setEditingFolderId(null)
    store.setRenameTarget(null)
    persistIndex()
  }

  const cancelFolderName = () => {
    const target = useProjectStore.getState().renameTarget
    const id = editingFolderId ?? (target?.kind === 'folder' ? target.id : null)
    if (!id) return
    setEditingFolderId(null)
    // Esc during creation discards the empty folder; a ⌘R rename of an
    // existing folder just cancels (spec issue #10).
    const store = useProjectStore.getState()
    store.setRenameTarget(null)
    const folder = store.projectFolders.find(f => f.id === id)
    if (editingFolderId === id && folder && folder.projectPaths.length === 0) {
      store.deleteFolder(id)
      persistIndex()
    }
  }

  /**
   * v1.1.2 T6: commits the inline project rename — Enter and blur land
   * here, and the store guard makes the Enter→blur double fire a no-op.
   * An empty trimmed name removes the override, so the card falls back to
   * the path-basename name (spec issue #10: 空串回退).
   */
  const commitProjectName = (rawName: string) => {
    const target = useProjectStore.getState().renameTarget
    if (target?.kind !== 'project') return
    const name = rawName.trim()
    const store = useProjectStore.getState()
    store.setRenameTarget(null)
    store.setProjectDisplayName(target.path, name)
    void saveProjectDisplayName(target.path, name)
  }

  const cancelProjectName = () => {
    useProjectStore.getState().setRenameTarget(null)
  }

  const confirmDeleteFolder = () => {
    const id = pendingDeleteFolderId
    setPendingDeleteFolderId(null)
    if (!id) return
    useProjectStore.getState().deleteFolder(id)
    persistIndex()
  }

  /**
   * v1.1.2 T4/T5 drag initiation (spec issues #8, #9): a pointer press
   * anywhere on a card (project or folder) arms the drag; it activates —
   * snapshotting the clone anchor and the static drop zones (the visible
   * project column, the folder cards, the breadcrumb bar) — only once the
   * pointer travels past the click slack, so a plain click still selects.
   */
  const beginCardDrag = (
    source: DragSource,
    event: React.PointerEvent<HTMLElement>,
    cardSelector: string
  ) => {
    suppressClickRef.current = false
    const card = event.currentTarget.closest(cardSelector)
    pressRef.current = {
      source,
      cardSelector,
      card: card instanceof HTMLElement ? card : null,
      nav: card?.closest('nav') ?? null,
      x: event.clientX,
      y: event.clientY,
    }
    setPress(source)
  }

  // The armed press: past the slack it becomes a real drag (the [drag]
  // effect's listeners take over); released before that, it was a click
  // and the card's own onClick runs unsuppressed.
  useEffect(() => {
    if (!press) return

    const activate = (event: PointerEvent) => {
      const p = pressRef.current
      if (!p?.card) return
      if (
        Math.abs(event.clientX - p.x) + Math.abs(event.clientY - p.y) <=
        DRAG_ACTIVATION_SLACK
      )
        return
      const rect = p.card.getBoundingClientRect()
      // Pitch between cards (height + list gap) measured from the next
      // sibling in the same column drives the yield transforms.
      const next = p.card.nextElementSibling
      const stride =
        next instanceof HTMLElement && next.matches(p.cardSelector)
          ? next.getBoundingClientRect().top - rect.top
          : rect.height + 4
      const ghost: DragGhost = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        stride,
      }
      dragGhostRef.current = ghost
      setDragGhost(ghost)
      dragSpacesRef.current = {
        list: hitSpaceOf(p.nav?.querySelectorAll('[data-project-path]')),
        folders: hitSpaceOf(p.nav?.querySelectorAll('[data-folder-id]')),
        breadcrumb: rectOf(breadcrumbBarRef.current),
      }
      dragRef.current = p.source
      dropTargetRef.current = null
      setDrag(p.source)
      setDropTarget(null)
      setPress(null)
    }

    const release = () => {
      pressRef.current = null
      setPress(null)
    }

    window.addEventListener('pointermove', activate)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      window.removeEventListener('pointermove', activate)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [press])

  useEffect(() => {
    if (!drag) return

    const clearDrag = () => {
      dragRef.current = null
      dropTargetRef.current = null
      dragGhostRef.current = null
      dragSpacesRef.current = { list: null, folders: null, breadcrumb: null }
      setDrag(null)
      setDropTarget(null)
      setDragGhost(null)
    }

    const handlePointerMove = (event: PointerEvent) => {
      // The clone tracks the pointer imperatively — a state update per
      // move would re-render the whole list (performance pattern).
      const ghost = dragGhostRef.current
      if (cloneRef.current && ghost) {
        cloneRef.current.style.transform = `translate(${event.clientX - ghost.offsetX}px, ${event.clientY - ghost.offsetY}px)`
      }
      // Folder cards only ever reorder among themselves; a project drag
      // resolves against breadcrumb → folder cards → the list slots. All
      // zones are the static snapshots taken at drag start: the yielding
      // cards slide under the pointer, so live rects would make the
      // target flicker as the gap opens and closes.
      const source = dragRef.current
      const spaces = dragSpacesRef.current
      const next =
        source?.kind === 'folder'
          ? folderDropAt(event.clientX, event.clientY, spaces.folders)
          : projectDropAt(event.clientX, event.clientY, spaces)
      if (sameDropTarget(dropTargetRef.current, next)) return
      dropTargetRef.current = next
      setDropTarget(next)
    }

    const finishDrag = () => {
      // The ensuing click on the card is the drop's own pointerup — the
      // card's onClick must not treat it as a selection.
      suppressClickRef.current = true
      const source = dragRef.current
      const target = dropTargetRef.current
      const store = useProjectStore.getState()
      if (source?.kind === 'project' && target) {
        if (target.kind === 'folder') {
          // Dropping on a folder card files the project at that folder's
          // end (spec issue #9: 释放后工程入夹末尾).
          const folder = store.projectFolders[target.index]
          if (folder) {
            store.moveProjectToFolder(folder.id, source.path)
            persistIndex()
          }
        } else if (target.kind === 'breadcrumb') {
          // Dropping on the breadcrumb returns the project to ungrouped.
          if (store.activeFolderId) {
            store.removeProjectFromFolder(store.activeFolderId, source.path)
            persistIndex()
          }
        } else {
          // Reordering follows the active view: inside a folder it is the
          // set order, at the top level the master list (spec issue #7).
          const visible = visibleProjectPaths(
            store.recentProjectPaths,
            store.projectFolders,
            store.activeFolderId
          )
          const fromIndex = visible.indexOf(source.path)
          if (fromIndex >= 0) {
            const next = reorderedList(
              visible,
              fromIndex,
              insertionIndexFor(target.index, target.half)
            )
            // reorderedList keeps its input reference for no-move drops.
            if (next !== visible) {
              store.applyVisibleReorder(next)
              persistIndex()
              setSuppressTransition(true)
            }
          }
        }
      } else if (source?.kind === 'folder' && target?.kind === 'list') {
        const folderIds = store.projectFolders.map(folder => folder.id)
        const fromIndex = folderIds.indexOf(source.id)
        if (fromIndex >= 0) {
          const next = reorderedList(
            folderIds,
            fromIndex,
            insertionIndexFor(target.index, target.half)
          )
          if (next !== folderIds) {
            store.applyFolderReorder(next)
            persistIndex()
            setSuppressTransition(true)
          }
        }
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
  }, [drag])

  // Re-enable card transitions only once the snap frame has painted;
  // cancelled drags (pointercancel, no-commit drops) never pass through
  // here and keep their smooth return animation.
  useEffect(() => {
    if (!suppressTransition) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSuppressTransition(false))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [suppressTransition])

  // Report dialog visibility so the hover sidebar keeps peeking while a
  // confirm flow is open (spec issue #4: 确认框期间松开 Cmd 不收回).
  const dialogOpen =
    pendingSwitchPath !== null ||
    pendingDeleteFolderId !== null ||
    confirmCloseProjectOpen
  useEffect(() => {
    onDialogOpenChange?.(dialogOpen)
  }, [dialogOpen, onDialogOpenChange])

  // v1.1.2 T4/T5: drag geometry — the dragged card hides behind its floating
  // clone while the remaining cards yield one card-stride to open the gap
  // at the midpoint-derived insertion slot (spec issues #8, #9). Folder
  // drops highlight instead of yielding: the project joins the hovered
  // folder's end, the breadcrumb returns it to ungrouped.
  const dragProjectIndex =
    drag?.kind === 'project' ? visiblePaths.indexOf(drag.path) : -1
  const dragFolderIndex =
    drag?.kind === 'folder'
      ? projectFolders.findIndex(folder => folder.id === drag.id)
      : -1
  const listDrop = dropTarget?.kind === 'list' ? dropTarget : null
  const projectInsertionIndex =
    drag?.kind === 'project' && listDrop
      ? insertionIndexFor(listDrop.index, listDrop.half)
      : null
  const folderInsertionIndex =
    drag?.kind === 'folder' && listDrop
      ? insertionIndexFor(listDrop.index, listDrop.half)
      : null
  /** Hovered folder card while a project drag hovers it (join gesture). */
  const folderDropIndex =
    drag?.kind === 'project' && dropTarget?.kind === 'folder'
      ? dropTarget.index
      : null
  const breadcrumbDropping =
    drag?.kind === 'project' && dropTarget?.kind === 'breadcrumb'
  // Card pitch fallback: h-14.25 (57px) + gap-1 (4px). Real drags measure it.
  const stride = dragGhost?.stride ?? 61

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

      {/* v1.1.2 T3: folder view replaces the header with the breadcrumb
          (‹ 全部工程 / 文件夹名). Both views keep an add-project "+" on the
          header row — in a folder view the import lands inside that folder
          (spec issue #7 新导入落点). Dropping a dragged member on the bar
          returns it to the ungrouped section (spec issue #9). */}
      {activeFolder ? (
        <div
          ref={breadcrumbBarRef}
          data-testid="breadcrumb-bar"
          data-drop-active={breadcrumbDropping ? 'true' : undefined}
          className={cn(
            'mt-2 flex min-w-0 items-center gap-1 rounded-md pr-8 pl-9 text-[14px] transition-colors duration-200',
            breadcrumbDropping &&
              'bg-(--pnds-accent)/15 ring-1 ring-(--pnds-accent)/50'
          )}
        >
          <button
            type="button"
            data-testid="breadcrumb-back"
            aria-label={t('sidebar.backToAllProjects')}
            title={t('sidebar.backToAllProjects')}
            onClick={() => setActiveFolderView(null)}
            className="flex shrink-0 items-center gap-0.5 rounded-md px-1 py-0.5 text-(--pnds-text)/55 hover:bg-(--pnds-text)/5 hover:text-(--pnds-text)"
          >
            <ChevronLeft size={14} aria-hidden="true" />
            {t('sidebar.allProjects')}
          </button>
          <span aria-hidden="true" className="shrink-0 text-(--pnds-text)/30">
            /
          </span>
          {renameTarget?.kind === 'folder' &&
          renameTarget.id === activeFolder.id ? (
            /* v1.1.2 T6: ⌘R renames the drilled-in folder in place —
             * Enter/blur commit, Esc cancel (spec issue #10). */
            <InlineNameInput
              testId="folder-name-input"
              value={activeFolder.name}
              className="min-w-0 flex-1 truncate rounded-lg border border-(--pnds-text)/15 bg-(--pnds-text)/5 px-2 py-0.5 text-[14px] text-(--pnds-text) outline-none"
              onCommit={commitFolderName}
              onCancel={cancelFolderName}
            />
          ) : (
            <span
              data-testid="breadcrumb-folder-name"
              className="truncate text-(--pnds-text)"
            >
              {activeFolder.name}
            </span>
          )}
          <button
            type="button"
            data-testid="add-project-button"
            aria-label={t('sidebar.addProject')}
            title={t('sidebar.addProject')}
            onClick={() => void promptOpenProject()}
            disabled={busy}
            className="ml-auto shrink-0 rounded-md p-1 text-(--pnds-text)/70 hover:bg-(--pnds-text)/5 hover:text-(--pnds-text) disabled:opacity-50"
          >
            <Plus size={14} />
          </button>
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between pr-8 pl-9">
          <h2 className="text-[11px] font-medium tracking-wider text-(--pnds-text)/40 uppercase">
            {t('sidebar.projects')}
          </h2>
          <button
            type="button"
            data-testid="add-project-button"
            aria-label={t('sidebar.addProject')}
            title={t('sidebar.addProject')}
            onClick={() => void promptOpenProject()}
            disabled={busy}
            className="rounded-md p-1 text-(--pnds-text)/70 hover:bg-(--pnds-text)/5 hover:text-(--pnds-text) disabled:opacity-50"
          >
            <Plus size={14} />
          </button>
        </div>
      )}

      <nav className="mt-4 flex min-h-0 flex-1 flex-col gap-1">
        {visiblePaths.map((path, index) => {
          const isCurrent = path === currentProject?.path
          const isDragged = drag?.kind === 'project' && drag.path === path
          const renamingProject =
            renameTarget?.kind === 'project' && renameTarget.path === path
          const cardOffset =
            projectInsertionIndex === null || dragProjectIndex < 0
              ? 0
              : cardShift(
                  dragProjectIndex,
                  projectInsertionIndex,
                  index,
                  stride
                )
          const showBadge = commandKeyPressed && index < 9
          return (
            <div
              key={path}
              data-testid={isCurrent ? 'current-project-card' : 'project-entry'}
              data-project-path={path}
              onPointerDown={e => {
                // Renaming owns the card; the drag must not steal focus.
                if (renamingProject) return
                beginCardDrag(
                  { kind: 'project', path },
                  e,
                  '[data-project-path]'
                )
              }}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false
                  return
                }
                selectProject(path, 'click')
              }}
              style={
                cardOffset !== 0
                  ? { transform: `translateY(${cardOffset}px)` }
                  : undefined
              }
              className={cn(
                'group relative mx-5 flex h-14.25 select-none items-center rounded-xl px-3',
                suppressTransition
                  ? 'transition-none'
                  : 'transition-[background-color,transform] duration-200',
                isCurrent || pendingPreflightPath === path
                  ? 'bg-(--pnds-card) shadow-sm'
                  : 'hover:bg-(--pnds-text)/5',
                // Hidden, not removed: its slot is what the yielding cards
                // slide over while the floating clone represents it.
                isDragged && 'invisible'
              )}
            >
              {/* Left slot keeps the centered title's optical axis; the
                  whole card is the drag trigger (v1.1.2 T5). */}
              <span className="w-5 shrink-0" aria-hidden="true" />

              {renamingProject ? (
                /* v1.1.2 T6: ⌘R inline rename — autofocus, select-all,
                 * Enter/blur commit, Esc cancel (spec issue #10). */
                <InlineNameInput
                  testId="project-name-input"
                  value={cardName(path)}
                  className="flex-1 truncate rounded-lg border border-(--pnds-text)/15 bg-(--pnds-text)/5 px-2 py-1 text-center text-[15px] text-(--pnds-text) outline-none"
                  onCommit={commitProjectName}
                  onCancel={cancelProjectName}
                />
              ) : (
                <button
                  type="button"
                  disabled={busy || (isCurrent && running)}
                  title={path}
                  className="flex-1 truncate text-center text-[15px] text-(--pnds-text)/85 disabled:opacity-60"
                >
                  {cardName(path)}
                </button>
              )}

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

        {!activeFolder && recentProjectPaths.length === 0 && (
          <p className="px-9 py-3 text-center text-xs text-(--pnds-text)/50">
            {t('sidebar.noProjects')}
          </p>
        )}
        {activeFolder && visiblePaths.length === 0 && (
          <p className="px-9 py-3 text-center text-xs text-(--pnds-text)/50">
            {t('sidebar.folderEmpty')}
          </p>
        )}

        {/* Folders (set lists) — pinned directly above the footer controls.
            The FOLDERS row always renders at the top level: its
            hover-revealed button is the only entry for creating the first
            folder. Hidden while drilled in. */}
        {!activeFolder && (
          <div className="mt-auto flex flex-col gap-1">
            <div className="group mt-3 flex items-center justify-between pr-8 pl-9">
              <p className="text-[11px] font-medium tracking-wider text-(--pnds-text)/40 uppercase">
                {t('sidebar.folders')}
              </p>
              <button
                type="button"
                data-testid="new-folder-button"
                aria-label={t('sidebar.newFolder')}
                title={t('sidebar.newFolder')}
                onClick={handleNewFolder}
                className="rounded-md p-1 text-(--pnds-text)/70 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-(--pnds-text)/5 hover:text-(--pnds-text)"
              >
                <FolderPlus size={14} />
              </button>
            </div>
            {projectFolders.map((folder, folderIndex) => {
              const isEditing = editingFolderId === folder.id
              // v1.1.2 T7: the Utilities folder is permanent — no delete
              // affordance (rename/⌘R are already blocked upstream).
              const isProtected = isProtectedFolder(folder.id)
              const inUse =
                sessionLive &&
                currentProject !== null &&
                folder.projectPaths.includes(currentProject.path)
              // A folder drag yields its siblings exactly like a project
              // drag (spec issue #9: 文件夹卡在文件夹区内可拖拽排序).
              const isDraggedCard =
                drag?.kind === 'folder' && drag.id === folder.id
              const isDropHover = folderDropIndex === folderIndex
              const cardOffset =
                folderInsertionIndex === null || dragFolderIndex < 0
                  ? 0
                  : cardShift(
                      dragFolderIndex,
                      folderInsertionIndex,
                      folderIndex,
                      stride
                    )
              return (
                <div
                  key={folder.id}
                  data-testid="folder-card"
                  data-folder-id={folder.id}
                  data-drop-active={isDropHover ? 'true' : undefined}
                  onPointerDown={e => {
                    // Inline naming owns the card; no drag while editing.
                    if (isEditing) return
                    beginCardDrag(
                      { kind: 'folder', id: folder.id },
                      e,
                      '[data-folder-id]'
                    )
                  }}
                  onClick={() => {
                    if (isEditing) return
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false
                      return
                    }
                    setActiveFolderView(folder.id)
                  }}
                  style={
                    cardOffset !== 0
                      ? { transform: `translateY(${cardOffset}px)` }
                      : undefined
                  }
                  className={cn(
                    'group relative mx-5 flex h-14.25 cursor-pointer select-none items-center rounded-xl px-3 hover:bg-(--pnds-text)/5',
                    suppressTransition
                      ? 'transition-none'
                      : 'transition-[background-color,transform] duration-200',
                    // Hidden, not removed: its slot is what the yielding
                    // folder cards slide over while the clone represents it.
                    isDraggedCard && 'invisible',
                    // Project-over-folder drop hint (spec issue #9: 高亮提示).
                    isDropHover &&
                      'bg-(--pnds-accent)/15 ring-1 ring-(--pnds-accent)/50'
                  )}
                >
                  {isEditing ? (
                    <InlineNameInput
                      testId="folder-name-input"
                      value={folder.name}
                      className="flex-1 truncate rounded-lg border border-(--pnds-text)/15 bg-(--pnds-text)/5 px-2 py-1 text-center text-[15px] text-(--pnds-text) outline-none"
                      onCommit={commitFolderName}
                      onCancel={cancelFolderName}
                    />
                  ) : (
                    <>
                      {/* The plain folder icon keeps the card's geometry;
                          the whole card is the drag trigger (v1.1.2 T5). */}
                      <span className="flex w-5 shrink-0 items-center justify-center text-(--pnds-text)/40">
                        <Folder size={15} aria-hidden="true" />
                      </span>
                      {/* "使用中" indicator: the running project lives in
                          this folder (spec issue #4). */}
                      {inUse && (
                        <span
                          data-testid="folder-in-use-dot"
                          aria-label={t('sidebar.folderInUse')}
                          title={t('sidebar.folderInUse')}
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--pnds-accent)"
                        />
                      )}
                      <span
                        data-testid="folder-name"
                        className="flex-1 truncate text-center text-[15px] text-(--pnds-text)/85"
                      >
                        {folder.name}
                      </span>
                      {isProtected ? (
                        <span className="w-5 shrink-0" aria-hidden="true" />
                      ) : (
                        <button
                          type="button"
                          aria-label={t('sidebar.deleteFolder')}
                          onClick={e => {
                            e.stopPropagation()
                            setPendingDeleteFolderId(folder.id)
                          }}
                          className="w-5 shrink-0 text-(--pnds-text)/50 opacity-0 transition-opacity hover:text-(--pnds-text) group-hover:opacity-100"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </nav>

      {/* Deferred settings + their submit are one object (§10.2): the card
          clips the button into a full-bleed footer. */}
      <div className="px-5 pb-5 pt-6">
        <div className="overflow-hidden rounded-xl bg-(--pnds-card) shadow-[0_1px_3px_rgba(23,26,43,0.1)]">
          <SettingsCard onPopupOpenChange={onPopupOpenChange} />
          <SessionActionButton />
        </div>
      </div>

      {/* v1.1.2 T4/T5: the dragged card's semi-transparent floating clone
          (spec issues #8, #9) — a project card or a folder card. Portaled
          to the body — the overlay sidebar's backdrop-blur forms a
          containing block that would otherwise pin a fixed-position child
          inside the panel. Pointer moves update its transform
          imperatively; pointer-events keeps it out of the
          elementFromPoint hit test. */}
      {drag &&
        dragGhost &&
        createPortal(
          <div
            ref={cloneRef}
            data-testid="drag-clone"
            aria-hidden="true"
            className="pointer-events-none fixed top-0 left-0 z-50 flex items-center rounded-xl border border-(--pnds-text)/10 bg-(--pnds-sidebar-bg) px-3 opacity-75 shadow-lg"
            style={{
              width: dragGhost.width,
              height: dragGhost.height,
              transform: `translate(${dragGhost.x}px, ${dragGhost.y}px)`,
            }}
          >
            {drag.kind === 'folder' ? (
              <>
                <span className="flex w-5 shrink-0 items-center justify-center text-(--pnds-text)/40">
                  <Folder size={15} aria-hidden="true" />
                </span>
                <span className="flex-1 truncate text-center text-[15px] text-(--pnds-text)/85">
                  {projectFolders.find(folder => folder.id === drag.id)?.name}
                </span>
              </>
            ) : (
              <>
                <span className="w-5 shrink-0" aria-hidden="true" />
                <span className="flex-1 truncate text-center text-[15px] text-(--pnds-text)/85">
                  {cardName(drag.path)}
                </span>
              </>
            )}
            <span className="w-5 shrink-0" />
          </div>,
          document.body
        )}

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
                name: pendingSwitchPath ? cardName(pendingSwitchPath) : '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('switchProject.description', {
                name: pendingSwitchPath ? cardName(pendingSwitchPath) : '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('switchProject.back')}</AlertDialogCancel>
            {/* autoFocus makes the primary (filled) action the Enter
                default — Radix would otherwise focus the first tabbable,
                which is Cancel. */}
            <AlertDialogAction autoFocus onClick={() => void confirmSwitch()}>
              {t('switchProject.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* v1.1.2 T7: lone-Esc close confirmation (spec issue #11). ⌘Esc and
          the Close button close directly; a plain Esc asks first so a
          stray press never stops a live show. */}
      <AlertDialog
        open={confirmCloseProjectOpen}
        onOpenChange={openState => {
          if (!openState) {
            useProjectStore.getState().setConfirmCloseProjectOpen(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('closeProject.confirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('closeProject.confirmMessage')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('closeProject.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              autoFocus
              onClick={() => void confirmCloseProject()}
            >
              {t('closeProject.confirm')}
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
            <AlertDialogAction autoFocus onClick={confirmDeleteFolder}>
              {t('sidebar.deleteFolderConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
