import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Plus, X, Share, RefreshCw, FolderPlus, Command } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import i18n from '@/i18n/config'
import {
  FOLDER_LIMIT,
  PROJECT_LIMIT_PER_DIRECTORY,
  folderLimitReached,
  isProtectedFolder,
  useProjectStore,
  visibleProjectPaths,
} from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { notifications } from '@/lib/notifications'
import {
  openProject,
  promptOpenProject,
  stopAndReset,
} from '@/lib/open-project'
import { selectProject, setActiveFolderView } from '@/lib/project-select'
import { reclaimIfManagedBundle } from '@/lib/bundle-project'
import { projectDisplayName } from '@/lib/display-names'
import {
  AUTO_SCROLL_STEP,
  autoScrollDirection,
  cardShift,
  folderDropAt,
  insertionIndexFor,
  projectDropAt,
  reorderedList,
  sameDropTarget,
  scrollShiftedHitSpace,
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

/**
 * v1.2.1 (folder switch): the same slot layout for a uniform horizontal
 * row — the folder segments — carried axis-swapped so the row hit-test
 * (hoveredCardInRow) reuses the column math: top = the first segment's
 * left, cardHeight = segment width, left/right = the row's vertical
 * extent, stride = the horizontal pitch.
 */
function rowHitSpaceOf(
  segments: NodeListOf<Element> | undefined
): DragHitSpace | null {
  const first = segments?.[0]
  if (!(first instanceof HTMLElement)) return null
  const firstRect = first.getBoundingClientRect()
  const second = segments?.[1]
  // The switch row packs its segments flush (no gap), so a sole segment
  // pitches by its own width.
  const stride =
    second instanceof HTMLElement
      ? second.getBoundingClientRect().left - firstRect.left
      : firstRect.width
  return {
    top: firstRect.left,
    left: firstRect.top,
    right: firstRect.bottom,
    cardHeight: firstRect.width,
    stride,
    count: segments?.length ?? 0,
  }
}

/** Rect snapshot for point hit-testing (the unfiled segment). */
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

/** The list's scrollable range below its viewport (0 when it fits). */
function maxScrollOf(container: HTMLElement): number {
  return Math.max(0, container.scrollHeight - container.clientHeight)
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
 * v1.2.1 (folder switch): folders are a segmented control above the
 * project column — the unfiled segment (the default view) first, then one
 * segment per folder, Utilities pinned last. Selecting a segment switches
 * the list; a hover-revealed "+" beside the row creates folders (capped,
 * issue #26) and an always-visible "+" imports a project into the
 * selected view. Holding Cmd numbers the first nine projects of the
 * current view.
 *
 * Folder drag interactions (v1.1.2 T5, spec issue #9, carried over):
 * dropping a card on a folder segment files it into that folder's end,
 * dropping a member on the unfiled segment returns it to ungrouped, and
 * the segments reorder within the row by the same drag gesture. Every
 * structural change persists via the project index.
 *
 * v1.1.2 T6 (spec issue #10): ⌘R renames in place — the selected project
 * card's title becomes an input (Enter/blur commit, Esc cancel, empty
 * falls back to the path basename) and with nothing selected inside a
 * folder view the active segment's name does. Overrides persist in
 * preferences (`projectDisplayNames`) and every name display follows them.
 *
 * v1.2.1 (issue #25): the project column scrolls independently — the
 * folder switch and the settings footer stay fixed; keyboard selection
 * scrolls its card into view, and a drag hovering the list's top/bottom
 * edge auto-scrolls it (the drag hit spaces re-anchor on every scroll).
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
  const unfiledSegmentRef = useRef<HTMLDivElement | null>(null)
  const cloneRef = useRef<HTMLDivElement | null>(null)
  /** v1.2.1 (issue #25): the independently scrolling project column. */
  const projectScrollRef = useRef<HTMLDivElement | null>(null)
  /** scrollTop and viewport rect captured when a drag snapshotted its hit
   * spaces — scrolling re-anchors the static list geometry against them. */
  const scrollBaselineRef = useRef(0)
  const scrollViewportRef = useRef<Rect | null>(null)
  /** Edge auto-scroll state while a project drag hovers a list edge. */
  const autoScrollDirectionRef = useRef<-1 | 0 | 1>(0)
  const autoScrollRafRef = useRef(0)
  /** Last pointer position — re-resolving the drop target after a scroll
   * tick needs it, because the pointer itself did not move. */
  const lastPointerRef = useRef({ x: 0, y: 0 })

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
  // v1.2.1 (issue #26): the FOLDERS "+" disabled state derives from the
  // store's cap helper — the sidebar never re-counts folders on its own.
  // At the cap the label swaps to the reason, so the tooltip explains the
  // disabled button instead of naming a gesture it refuses.
  const foldersAtCap = folderLimitReached(projectFolders)
  const newFolderLabel = foldersAtCap
    ? t('sidebar.folderLimitReached', { limit: FOLDER_LIMIT })
    : t('sidebar.newFolder')

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
    // The store persists the index as part of the removal commit.
    useProjectStore.getState().removeRecentProject(path)
    void reclaimIfManagedBundle(path)
  }

  const handleNewFolder = () => {
    const store = useProjectStore.getState()
    const id = store.createFolder(t('sidebar.folderDefaultName'))
    // v1.2.1 (issue #26): the "+" is disabled at the cap, so a null here
    // is defense in depth for any other entry point — surface the store's
    // refusal instead of failing silently.
    if (id === null) {
      notifications.warning(
        t('sidebar.folderLimitReached', { limit: FOLDER_LIMIT })
      )
      return
    }
    setEditingFolderId(id)
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
  }

  const cancelProjectName = () => {
    useProjectStore.getState().setRenameTarget(null)
  }

  const confirmDeleteFolder = () => {
    const id = pendingDeleteFolderId
    setPendingDeleteFolderId(null)
    if (!id) return
    useProjectStore.getState().deleteFolder(id)
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
      // Pitch between cards measured from the next sibling in the same
      // run drives the yield transforms — vertical for project cards
      // (height + list gap), horizontal for the flush-packed segments.
      const next = p.card.nextElementSibling
      const inRun = next instanceof HTMLElement && next.matches(p.cardSelector)
      const stride =
        p.source.kind === 'folder'
          ? inRun
            ? next.getBoundingClientRect().left - rect.left
            : rect.width
          : inRun
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
        folders: rowHitSpaceOf(
          p.nav?.querySelectorAll('[data-folder-segment]')
        ),
        breadcrumb: rectOf(unfiledSegmentRef.current),
      }
      // The list snapshot is taken at the current scroll; every later
      // scroll tick re-anchors it (issue #25).
      scrollBaselineRef.current = projectScrollRef.current?.scrollTop ?? 0
      scrollViewportRef.current = rectOf(projectScrollRef.current)
      lastPointerRef.current = { x: event.clientX, y: event.clientY }
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

    /** Where a pointer position resolves against the drag's static zone
     * snapshots — the single resolution path for pointer moves and for
     * scroll ticks that move cards under a stationary pointer. */
    const resolveDropTarget = (x: number, y: number) => {
      // Folder cards only ever reorder among themselves; a project drag
      // resolves against breadcrumb → folder cards → the list slots. All
      // zones are the static snapshots taken at drag start: the yielding
      // cards slide under the pointer, so live rects would make the
      // target flicker as the gap opens and closes.
      const source = dragRef.current
      const spaces = dragSpacesRef.current
      const next =
        source?.kind === 'folder'
          ? folderDropAt(x, y, spaces.folders)
          : projectDropAt(x, y, spaces)
      if (sameDropTarget(dropTargetRef.current, next)) return
      dropTargetRef.current = next
      setDropTarget(next)
    }

    /** Re-anchors the list snapshot to the container's current scroll and
     * re-resolves the drop target under the stationary pointer — the
     * cards physically move while the list scrolls (issue #25). Idempotent
     * through the baseline: a repeat call with no further scroll is a
     * no-op, so the browser's scroll event and the auto-scroll tick can
     * both land here. */
    const syncListScroll = () => {
      const container = projectScrollRef.current
      const spaces = dragSpacesRef.current
      if (!container || !spaces.list) return
      const delta = container.scrollTop - scrollBaselineRef.current
      if (delta === 0) return
      scrollBaselineRef.current = container.scrollTop
      spaces.list = scrollShiftedHitSpace(spaces.list, delta)
      resolveDropTarget(lastPointerRef.current.x, lastPointerRef.current.y)
    }

    const stopAutoScroll = () => {
      autoScrollDirectionRef.current = 0
      if (autoScrollRafRef.current) {
        cancelAnimationFrame(autoScrollRafRef.current)
        autoScrollRafRef.current = 0
      }
    }

    const stepAutoScroll = () => {
      autoScrollRafRef.current = 0
      const container = projectScrollRef.current
      const direction = autoScrollDirectionRef.current
      if (!container || direction === 0) return
      const maxScroll = maxScrollOf(container)
      const target = Math.max(
        0,
        Math.min(container.scrollTop + direction * AUTO_SCROLL_STEP, maxScroll)
      )
      if (target !== container.scrollTop) {
        container.scrollTop = target
        // jsdom dispatches no scroll event for a programmatic scrollTop;
        // sync directly so the snapshot follows every frame (in browsers
        // the listener coalesces to a no-op — the delta is applied).
        syncListScroll()
      }
      // At a scroll bound the loop rests; the next pointer move re-arms it
      // if the pointer still sits in the edge band.
      if (container.scrollTop > 0 && container.scrollTop < maxScroll) {
        autoScrollRafRef.current = requestAnimationFrame(stepAutoScroll)
      } else {
        autoScrollDirectionRef.current = 0
      }
    }

    const updateAutoScroll = (x: number, y: number) => {
      // Only the project list scrolls (issue #25): folder drags reorder a
      // static section, so they never arm the loop.
      const container = projectScrollRef.current
      const viewport = scrollViewportRef.current
      if (!container || !viewport || dragRef.current?.kind !== 'project') {
        stopAutoScroll()
        return
      }
      autoScrollDirectionRef.current = autoScrollDirection(
        x,
        y,
        viewport,
        container.scrollTop,
        maxScrollOf(container)
      )
      if (autoScrollDirectionRef.current === 0) stopAutoScroll()
      else if (!autoScrollRafRef.current) {
        autoScrollRafRef.current = requestAnimationFrame(stepAutoScroll)
      }
    }

    const clearDrag = () => {
      stopAutoScroll()
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
      lastPointerRef.current = { x: event.clientX, y: event.clientY }
      resolveDropTarget(event.clientX, event.clientY)
      updateAutoScroll(event.clientX, event.clientY)
    }

    const finishDrag = () => {
      stopAutoScroll()
      // The ensuing click on the card is the drop's own pointerup — the
      // card's onClick must not treat it as a selection.
      suppressClickRef.current = true
      const source = dragRef.current
      const target = dropTargetRef.current
      const store = useProjectStore.getState()
      if (source?.kind === 'project' && target) {
        if (target.kind === 'folder') {
          // Dropping on a folder card files the project at that folder's
          // end (spec issue #9: 释放后工程入夹末尾). v1.2.1 (issue #26):
          // a full folder refuses the join — say why instead of silently
          // bouncing the card (i18n.t: a window listener is a non-React
          // context, kept out of the effect's deps).
          const folder = store.projectFolders[target.index]
          if (folder) {
            const joined = store.moveProjectToFolder(folder.id, source.path)
            if (!joined) {
              notifications.warning(
                i18n.t('sidebar.projectLimitReached', {
                  limit: PROJECT_LIMIT_PER_DIRECTORY,
                })
              )
            }
          }
        } else if (target.kind === 'breadcrumb') {
          // Dropping on the unfiled segment returns the project to
          // ungrouped (the old breadcrumb bar).
          if (store.activeFolderId) {
            store.removeProjectFromFolder(store.activeFolderId, source.path)
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
            setSuppressTransition(true)
          }
        }
      }
      clearDrag()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', clearDrag)
    // Manual scrolls (wheel/trackpad) during a drag move the cards under
    // the pointer too — keep the snapshot anchored (issue #25).
    const scrollContainer = projectScrollRef.current
    scrollContainer?.addEventListener('scroll', syncListScroll)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', clearDrag)
      scrollContainer?.removeEventListener('scroll', syncListScroll)
      stopAutoScroll()
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

  // v1.2.1 (issue #25): keyboard selection (⌘↑/⌘↓, ⌘1..9 — and the
  // auto-drill view switch) can land on a card the independent list scroll
  // has clipped, so the selected card is scrolled into view. A live
  // session never changes its selection — the ⌘-key switch request
  // (pendingSwitchPath) is the keyboard target, and the running current
  // project is revealed at mount. `nearest` is a no-op for fully visible
  // cards, keeping click selection on the same path.
  const selectedPath =
    pendingPreflightPath ?? pendingSwitchPath ?? currentProject?.path ?? null
  useEffect(() => {
    if (!selectedPath) return
    const container = projectScrollRef.current
    if (!container) return
    for (const card of container.querySelectorAll('[data-project-path]')) {
      if (
        card instanceof HTMLElement &&
        card.dataset.projectPath === selectedPath
      ) {
        card.scrollIntoView({ block: 'nearest' })
        return
      }
    }
  }, [selectedPath, activeFolderId])

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
      ? // The gap never opens right of the pinned Utilities segment — a
        // drop aimed there settles just before it (the store commit pins
        // it back last anyway).
        Math.min(
          insertionIndexFor(listDrop.index, listDrop.half),
          projectFolders.length - 1
        )
      : null
  /** Hovered folder segment while a project drag hovers it (join). */
  const folderDropIndex =
    drag?.kind === 'project' && dropTarget?.kind === 'folder'
      ? dropTarget.index
      : null
  // The unfiled drop hint only means something inside a folder view —
  // at the top level a drop there is a no-op and must not light up.
  const unfiledDropping =
    drag?.kind === 'project' &&
    dropTarget?.kind === 'breadcrumb' &&
    activeFolderId !== null
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

      <nav className="mt-2 flex min-h-0 flex-1 flex-col">
        {/* v1.2.1 (folder switch): folders are a segmented control above
            the project column — the unfiled segment first (the default
            view), then one segment per folder. Selecting a segment
            switches the list; dropping a dragged project on a folder
            segment files it in, on the unfiled segment returns it to
            ungrouped (the old breadcrumb bar). The import "+" lands in
            the selected segment's view (spec issue #7 新导入落点); the
            new-folder "+" is hover-revealed and caps at FOLDER_LIMIT with
            the reason as its tooltip (issue #26). */}
        <div className="group/switch mx-5 mb-2 flex items-center gap-1">
          <div className="flex min-w-0 flex-1 items-stretch rounded-lg bg-(--pnds-text)/[0.05] p-0.5">
            <div
              ref={unfiledSegmentRef}
              data-testid="unfiled-segment"
              data-drop-active={unfiledDropping ? 'true' : undefined}
              onPointerDown={() => {
                // Every fresh press re-arms the click suppression a
                // finished drag left behind — the unfiled segment is not
                // a drag source, so its press has no other handler.
                suppressClickRef.current = false
              }}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false
                  return
                }
                setActiveFolderView(null)
              }}
              className={cn(
                'flex min-w-0 flex-1 cursor-pointer items-center justify-center truncate rounded-md px-2 py-1.5 text-[13px] transition-colors duration-200',
                !activeFolder
                  ? 'bg-(--pnds-card) font-medium text-(--pnds-text) shadow-sm'
                  : 'text-(--pnds-text)/55 hover:text-(--pnds-text)/85',
                unfiledDropping &&
                  'bg-(--pnds-accent)/15 ring-1 ring-(--pnds-accent)/50'
              )}
            >
              {t('sidebar.unfiled')}
            </div>
            {projectFolders.map((folder, folderIndex) => {
              // Editing covers both the creation gesture (editingFolderId)
              // and ⌘R on the selected folder (renameTarget) — the old
              // breadcrumb edit now lives inside the segment.
              const isEditing =
                editingFolderId === folder.id ||
                (renameTarget?.kind === 'folder' &&
                  renameTarget.id === folder.id)
              // v1.1.2 T7: the Utilities folder is permanent — no delete
              // affordance, no rename, never draggable, pinned last.
              const isProtected = isProtectedFolder(folder.id)
              const isActive = activeFolderId === folder.id
              const inUse =
                sessionLive &&
                currentProject !== null &&
                folder.projectPaths.includes(currentProject.path)
              // A folder drag yields its siblings exactly like a project
              // drag, horizontally (spec issue #9: 文件夹卡在文件夹区内
              // 可拖拽排序).
              const isDraggedSegment =
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
                  data-testid="folder-segment"
                  data-folder-segment={folder.id}
                  data-drop-active={isDropHover ? 'true' : undefined}
                  onPointerDown={e => {
                    // Every fresh press re-arms the click suppression a
                    // finished drag left behind — also when the segment
                    // cannot become a drag source (editing, protected).
                    suppressClickRef.current = false
                    // Inline naming owns the segment; no drag while
                    // editing. The pinned Utilities segment is not
                    // draggable.
                    if (isEditing || isProtected) return
                    beginCardDrag(
                      { kind: 'folder', id: folder.id },
                      e,
                      '[data-folder-segment]'
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
                      ? { transform: `translateX(${cardOffset}px)` }
                      : undefined
                  }
                  className={cn(
                    'group/segment relative flex min-w-0 flex-1 cursor-pointer select-none items-center justify-center gap-1 truncate rounded-md px-2 py-1.5 text-[13px]',
                    suppressTransition
                      ? 'transition-none'
                      : 'transition-[background-color,transform] duration-200',
                    isActive
                      ? 'bg-(--pnds-card) font-medium text-(--pnds-text) shadow-sm'
                      : 'text-(--pnds-text)/55 hover:text-(--pnds-text)/85',
                    // Hidden, not removed: its slot is what the yielding
                    // segments slide over while the clone represents it.
                    isDraggedSegment && 'invisible',
                    // Project-over-segment drop hint (join gesture).
                    isDropHover &&
                      'bg-(--pnds-accent)/15 ring-1 ring-(--pnds-accent)/50'
                  )}
                >
                  {isEditing ? (
                    /* v1.1.2 T6: the new-folder gesture and ⌘R rename in
                     * place — Enter/blur commit, Esc cancel (spec issue
                     * #10). */
                    <InlineNameInput
                      testId="folder-name-input"
                      value={folder.name}
                      className="min-w-0 flex-1 truncate rounded-md border border-(--pnds-text)/15 bg-(--pnds-text)/5 px-1.5 py-0.5 text-center text-[13px] text-(--pnds-text) outline-none"
                      onCommit={commitFolderName}
                      onCancel={cancelFolderName}
                    />
                  ) : (
                    <>
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
                        className="truncate text-(--pnds-text)/85"
                      >
                        {folder.name}
                      </span>
                      {isProtected ? null : (
                        <button
                          type="button"
                          aria-label={t('sidebar.deleteFolder')}
                          onClick={e => {
                            e.stopPropagation()
                            setPendingDeleteFolderId(folder.id)
                          }}
                          className="w-3.5 shrink-0 text-(--pnds-text)/50 opacity-0 transition-opacity group-hover/segment:opacity-100 hover:text-(--pnds-text)"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
          <button
            type="button"
            data-testid="add-project-button"
            aria-label={t('sidebar.addProject')}
            title={t('sidebar.addProject')}
            onClick={() => void promptOpenProject()}
            disabled={busy}
            className="shrink-0 rounded-md p-1 text-(--pnds-text)/70 hover:bg-(--pnds-text)/5 hover:text-(--pnds-text) disabled:opacity-50"
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            data-testid="new-folder-button"
            aria-label={newFolderLabel}
            title={newFolderLabel}
            onClick={handleNewFolder}
            disabled={foldersAtCap}
            className={cn(
              'shrink-0 rounded-md p-1 transition-opacity',
              // v1.2.1 (issue #26): at the cap the button stays visible
              // (not hover-revealed) and dimmed — the disabled state must
              // be discoverable, with the tooltip explaining it.
              foldersAtCap
                ? 'cursor-not-allowed text-(--pnds-text)/40 opacity-60'
                : 'text-(--pnds-text)/70 opacity-0 group-hover/switch:opacity-100 hover:bg-(--pnds-text)/5 hover:text-(--pnds-text)'
            )}
          >
            <FolderPlus size={14} />
          </button>
        </div>

        {/* v1.2.1 (issue #25): the project column is its own vertical
            scroll region — overflow cards stay reachable while the folder
            switch above and the footer below stay fixed. */}
        <div
          ref={projectScrollRef}
          data-testid="project-list-scroll"
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pb-1"
        >
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
                data-testid={
                  isCurrent ? 'current-project-card' : 'project-entry'
                }
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
                  selectProject(path)
                }}
                style={
                  cardOffset !== 0
                    ? { transform: `translateY(${cardOffset}px)` }
                    : undefined
                }
                className={cn(
                  // shrink-0: without it the scroll container's flex column
                  // squeezes the cards instead of overflowing into scroll.
                  'group relative mx-5 flex h-14.25 shrink-0 select-none items-center rounded-xl px-3',
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
        </div>
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
          (spec issues #8, #9) — a project card or a folder segment.
          Portaled to the body — the overlay sidebar's backdrop-blur forms
          a containing block that would otherwise pin a fixed-position
          child inside the panel. Pointer moves update its transform
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
              <span className="min-w-0 flex-1 truncate px-1 text-center text-[13px] font-medium text-(--pnds-text)/85">
                {projectFolders.find(folder => folder.id === drag.id)?.name}
              </span>
            ) : (
              <>
                <span className="w-5 shrink-0" aria-hidden="true" />
                <span className="flex-1 truncate text-center text-[15px] text-(--pnds-text)/85">
                  {cardName(drag.path)}
                </span>
                <span className="w-5 shrink-0" />
              </>
            )}
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

      {/* v1.2.0: the close-project confirmation — opened by ⌘W while a
          session runs (the v1.1.2 lone-Esc entry was retired; Esc has no
          app function anymore). The Close button closes directly. */}
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
