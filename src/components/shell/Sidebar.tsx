import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  X,
  Share,
  RefreshCw,
  FolderPlus,
  Pencil,
  Trash2,
  Command,
  Music,
  FolderOpen,
  AlertCircle,
} from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import i18n from '@/i18n/config'
import {
  FOLDER_LIMIT,
  PROJECT_LIMIT_PER_DIRECTORY,
  folderLimitReached,
  isProtectedFolder,
  selectSelectedPath,
  useProjectStore,
  visibleProjectPaths,
} from '@/store/project-store'
import { isSessionBusy, useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { notifications } from '@/lib/notifications'
import { promptOpenProject, stopAndReset } from '@/lib/open-project'
import { Spinner } from '@/components/ui/spinner'
import {
  selectProject,
  setActiveFolderView,
  nextFolderView,
} from '@/lib/project-select'
import { startFolderRename } from '@/lib/project-rename'
import { reclaimIfManagedBundle } from '@/lib/bundle-project'
import { revealScrollTarget } from '@/lib/list-reveal'
import { projectDisplayName } from '@/lib/display-names'
import { builtinUtilityId } from '@/lib/builtin-utilities'
import { utilityCardIcon } from './utility-icons'
import { cardShift, insertionIndexFor, reorderedList } from '@/lib/drag-reorder'
import { useCardDrag, type ActiveDropTarget } from '@/hooks/use-card-drag'
import {
  applyIndicatorGeometry,
  clearIndicatorGeometry,
  useIndicatorPill,
} from '@/hooks/use-indicator-pill'
import { sidebarDragAdapter, type DragSource } from './sidebar-drag-adapter'
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { SettingsCard } from './SettingsCard'
import { SessionActionButton } from './SessionActionButton'
import { TrafficLights } from './TrafficLights'
import { cn } from '@/lib/utils'
import octoSidebar2x from '@/assets/octo-sidebar-2x.png'

/** #71 (Brutal): how far the octopus's clamped hands and face reach
 *  below its shelf line, in CSS px — calibrated on octo-sidebar-2x.png
 *  (24px at the 2× asset = 12px at its card-width display). Dropping
 *  the image this far below the settings card's top edge lands the
 *  shelf line exactly on that edge; the 24px beside it mirrors the
 *  footer's pt-6 — change one, change the other. */
const OCTO_SHELF_OVERHANG_PX = 12

/** #71 v2 (user report): the illustration's zone ABOVE the footer —
 *  display height ~170px (the 560×342 asset at the ~278px card width)
 *  minus the footer's pt-6, plus a small gap. The card column reserves
 *  exactly this below itself so cards page ABOVE the art instead of
 *  pressing over it (their transparent rest stays in every theme);
 *  re-measure if the asset or the footer padding changes. */
const OCTO_COLUMN_RESERVE_PX = 142

interface SidebarProps {
  /** welcome/loading: statically visible; running: floats over the monitor */
  variant: 'static' | 'overlay'
  /** Overlay mode: a settings popup menu is open — keep the sidebar visible. */
  onPopupOpenChange?: (open: boolean) => void
  /** Overlay mode: a sidebar dialog (folder delete) is open — releasing
   * Cmd must not retract the peeked sidebar. */
  onDialogOpenChange?: (open: boolean) => void
}

/**
 * v1.2.2 (issue #28): positions the sliding pill over the active segment —
 * its offsetLeft/offsetWidth inside the track, applied as transform+width
 * so the pill animates between views instead of a background crossfade.
 * Module-level: both the apply and re-measure paths of the indicator-pill
 * engine (useIndicatorPill, v1.3.2 issue #78) call it with live values (a
 * component-scope function would churn their dependency arrays). Since
 * #78 only the policy lives here — the geometry write and the resize/font
 * listener mode are the shared engine's.
 */
function applyFolderPill(
  pill: HTMLDivElement | null,
  activeFolderId: string | null,
  segments: ReadonlyMap<string, HTMLDivElement>,
  unfiled: HTMLDivElement | null
): void {
  if (!pill) return
  const segment =
    activeFolderId === null ? unfiled : (segments.get(activeFolderId) ?? null)
  if (segment === null) {
    clearIndicatorGeometry(pill, 'x')
    return
  }
  applyIndicatorGeometry(pill, segment, 'x')
}

/**
 * The folder pill's language applied to the project column (v1.2.2 user
 * request): the selected card's white highlight is a pill that slides
 * between cards instead of a per-card background crossfade. Geometry is
 * imperative like applyFolderPill — translateY/height from the selected
 * card's offsets inside the (positioned) list content (the shared
 * applyIndicatorGeometry write since v1.3.2 issue #78), opacity owned here
 * (hidden covers project drags, the post-drop snap frames, and the
 * selection not being in the current view).
 *
 * The slide is only meaningful between cards the current view shows: the
 * pill remembers its last anchored card, and when that card is not in the
 * view anymore (a folder switch replaced the list, or the pill appears
 * for the first time) it reappears in place instead of sliding from the
 * previous view's meaningless geometry.
 */
function applyCardSelectionPill(
  pill: HTMLDivElement | null,
  container: HTMLElement | null,
  selectedPath: string | null,
  hidden: boolean
): void {
  if (!pill) return
  const anchor = pill.dataset.anchor ?? null
  let card: HTMLElement | null = null
  let anchorVisible = false
  if (container !== null) {
    for (const el of container.querySelectorAll('[data-project-path]')) {
      if (!(el instanceof HTMLElement)) continue
      if (selectedPath !== null && el.dataset.projectPath === selectedPath) {
        card = el
      }
      if (anchor !== null && el.dataset.projectPath === anchor) {
        anchorVisible = true
      }
    }
  }
  if (card === null) {
    // No target (nothing selected, or the selection lives in another
    // folder view): keep the last geometry — invisible anyway — so the
    // pill never animates a slide toward a collapsed position.
    pill.style.opacity = '0'
    return
  }
  const slide = anchorVisible && anchor !== card.dataset.projectPath
  if (slide) {
    // Also cancels a still-pending snap restore — this move animates.
    pill.style.transition = ''
  } else {
    pill.style.transition = 'none'
  }
  if (anchor !== card.dataset.projectPath) {
    // #41 (Brutal): a NEW card became the selection — restart the theme's
    // one-shot rise animation so the card lifts off its black plane. The
    // reset-reflow-restore idiom re-triggers a CSS keyframe; in themes
    // without the animation this is a harmless pair of style writes.
    pill.style.animation = 'none'
    void pill.offsetWidth
    pill.style.animation = ''
  }
  applyIndicatorGeometry(pill, card, 'y')
  pill.style.opacity = hidden ? '0' : '1'
  pill.dataset.anchor = card.dataset.projectPath
  if (!slide) {
    // Let the snapped geometry paint one frame before the class-owned
    // transition comes back.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        pill.style.transition = ''
      })
    })
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
 * v1.2.2 (issue #29): the project column's empty state — a centered
 * linear icon over the copy, dimmed to the icon tier.
 */
function ListEmptyState({
  testId,
  label,
  children,
}: {
  testId: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div
      data-testid={testId}
      className="flex shrink-0 flex-col items-center gap-2 px-9 py-4 text-(--pnds-text)/35"
    >
      {children}
      <p className="text-xs">{label}</p>
    </div>
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
 * open or running. v1.2.3 (#39): selecting while a session runs is free
 * (select + preflight, never a confirmation); starting B on top of A is
 * confirmed at the Load action, not here.
 *
 * v1.2.1 (folder switch): folders are a segmented control above the
 * project column — the unfiled segment (the default view) first, then one
 * segment per folder, Utilities pinned last. Selecting a segment switches
 * the list; an always-visible "+" imports a project into the selected
 * view. Holding Cmd numbers the first nine projects of the current view.
 * v1.2.2 (issue #28) completes the control: the track spans the row, the
 * segments share it by content width, and a white pill slides under the
 * active one. Folder management (create / rename / delete) lives in a
 * right-click context menu — the inline "+" and the hover ✕ are gone; the
 * menu disables at the folder cap (#26) and for the protected Utilities
 * folder, with the reasons spelled out. Segments are tabs: roving
 * tabindex, ←/→ view switching, accent focus ring. The project cards
 * hold no tab stops of their own (the title and ✕ buttons are
 * pointer-only; ⌘1..9 and ⌘↑/↓ are their keyboard path), so Tab walks
 * the top controls → the switch → the settings footer only.
 *
 * v1.2.2 (issue #29): the project column polishes up — the import entry
 * moves to the column's end (icon + label, ghost), the running project
 * wears a left-edge accent bar (from the session's start — the in-use
 * dot's semantics; idle selection stays white-card-only), the column
 * fades its edges statically (20px overlay strips that spare the native
 * scrollbar, end paddings keep resting content clear), and selection —
 * keyboard or click, one selectedPath chain — scrolls clear of the bands
 * via revealScrollTarget (src/lib/list-reveal.ts). Per user feedback the
 * first segment is "Home" and lists only ungrouped projects — the flat
 * all-projects variant shipped in the first #29 cut was rolled back.
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
  onPopupOpenChange,
  onDialogOpenChange,
}: SidebarProps) {
  const { t } = useTranslation()
  // #71: the shelf octopus is Brutal-only decoration riding the footer.
  const brutal = useSettingsStore(state => state.colorThemeSetting) === 'brutal'
  const recentProjectPaths = useProjectStore(state => state.recentProjectPaths)
  // v1.3.2 (user report after #75): this launch's bundled utility tools —
  // their cards never drag, never rename, never leave the list.
  const utilityPaths = useProjectStore(state => state.utilityPaths)
  const projectFolders = useProjectStore(state => state.projectFolders)
  const currentProject = useProjectStore(state => state.currentProject)
  const pendingPreflightPath = useProjectStore(
    state => state.pendingPreflightPath
  )
  const preflightErrors = useProjectStore(state => state.preflightErrors)
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
  // v1.2.3 (#39): the running indicators follow the SESSION's project, not
  // the selection — selecting B while A runs moves the pill but never the
  // accent bar or the folder in-use dot.
  const sessionProjectPath = useSessionStore(state => state.sessionProjectPath)
  const commandKeyPressed = useKeyboardStore(state => state.commandKeyPressed)
  // v1.2.3 (#39/T4): Share targets the SESSION's IP (snapshot mirror) —
  // another card's preflight seeding must never retarget the live link.
  const lanIp = useSessionStore(state => state.sessionLanIp ?? state.lanIp)
  const monitorPort = useSessionStore(
    state => state.health?.scoreServer?.monitorPort
  )
  const busy = isSessionBusy(sessionStatus)
  const running = sessionStatus === 'ready'
  // v1.1.2 T3: the folder card shows its "in use" dot from the moment the
  // session starts, not only once ready (spec issue #4: 使用中指示点).
  const sessionLive = sessionStatus === 'starting' || sessionStatus === 'ready'
  /** Folder being inline-named (creation gesture: Enter commits, Esc cancels). */
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [pendingDeleteFolderId, setPendingDeleteFolderId] = useState<
    string | null
  >(null)
  /** v1.2.2 (issue #28): the folder segment the context menu was opened on
   * (null = the track or the unfiled segment — no folder-specific items). */
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null)
  const unfiledSegmentRef = useRef<HTMLDivElement | null>(null)
  /** v1.2.2 (issue #28): the sliding pill — geometry applied imperatively
   * (like the drag clone), never through React state. */
  const pillRef = useRef<HTMLDivElement | null>(null)
  /** v1.2.2 (issue #28): folder segments by id — pill measurement and the
   * arrow-key focus hand-off address them directly. */
  const segmentRefs = useRef(new Map<string, HTMLDivElement>())
  /** v1.2.2 (user request after #32): the card-selection pill — geometry
   imperative like the folder pill. */
  const cardPillRef = useRef<HTMLDivElement | null>(null)
  /** The positioned list content the card pill measures against. */
  const projectContentRef = useRef<HTMLDivElement | null>(null)
  /** v1.2.1 (issue #25): the independently scrolling project column. */
  const projectScrollRef = useRef<HTMLDivElement | null>(null)

  /**
   * The drag controller's commit policy (v1.3.2, issue #75): what a
   * finished drop means in store terms — the same four structural actions
   * the inline machine called (spec issues #7/#9). Returns true only for
   * the reorder commits, so the controller suppresses exactly those snap
   * frames (a folder join or an unfile return lands without one).
   */
  const commitDragDrop = (
    source: DragSource,
    target: ActiveDropTarget
  ): boolean => {
    const store = useProjectStore.getState()
    if (source.kind === 'project') {
      // v1.3.2 (user report after #75): a bundled utility tool is app
      // content — its press never arms a drag, and the commit refuses it
      // too (defense in depth; the segment highlight already hid it).
      if (store.utilityPaths.includes(source.path)) return false
      if (target.kind === 'folder') {
        // Dropping on a folder card files the project at that folder's
        // end (spec issue #9: 释放后工程入夹末尾). v1.2.1 (issue #26):
        // a full folder refuses the join — say why instead of silently
        // bouncing the card (i18n.t: kept out of React contexts).
        // v1.3.2: Utilities takes no outside projects — refuse before the
        // store call so the cap toast never fires for it.
        const folder = store.projectFolders[target.index]
        if (folder && isProtectedFolder(folder.id)) return false
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
        return false
      }
      if (target.kind === 'breadcrumb') {
        // Dropping on the unfiled segment returns the project to
        // ungrouped (the old breadcrumb bar).
        if (store.activeFolderId) {
          store.removeProjectFromFolder(store.activeFolderId, source.path)
        }
        return false
      }
      // Reordering follows the active view: inside a folder it is the
      // set order, at the top level the master list (spec issue #7).
      const visible = visibleProjectPaths(
        store.recentProjectPaths,
        store.projectFolders,
        store.activeFolderId
      )
      const fromIndex = visible.indexOf(source.path)
      if (fromIndex < 0) return false
      const next = reorderedList(
        visible,
        fromIndex,
        insertionIndexFor(target.index, target.half)
      )
      // reorderedList keeps its input reference for no-move drops.
      if (next === visible) return false
      store.applyVisibleReorder(next)
      return true
    }
    // Folder drags only ever reorder within the switch row.
    if (target.kind !== 'list') return false
    const folderIds = store.projectFolders.map(folder => folder.id)
    const fromIndex = folderIds.indexOf(source.id)
    if (fromIndex < 0) return false
    const next = reorderedList(
      folderIds,
      fromIndex,
      insertionIndexFor(target.index, target.half)
    )
    if (next === folderIds) return false
    store.applyFolderReorder(next)
    return true
  }

  /**
   * v1.3.2 (issue #75): the whole pointer drag machine — press slack
   * activation, the floating clone transform, static hit-space snapshots,
   * drop resolution, edge auto-scroll, scroll re-anchoring and the
   * post-commit transition suppression — lives in useCardDrag; the
   * sidebar only measures (sidebar-drag-adapter) and commits (above).
   */
  const {
    drag,
    dropTarget,
    ghost: dragGhost,
    suppressTransition,
    cloneRef,
    press: beginCardDrag,
    consumeClick,
    clearClickSuppression,
  } = useCardDrag<DragSource>({
    adapter: sidebarDragAdapter,
    onCommit: commitDragDrop,
  })

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
  /** v1.2.2 (user feedback on #29): the fixed Utilities view imports
   * nothing — its members are the bundled tools, seeded by the app. */
  const activeFolderIsProtected =
    activeFolder !== null && isProtectedFolder(activeFolder.id)
  const pendingDeleteFolder = projectFolders.find(
    folder => folder.id === pendingDeleteFolderId
  )
  // v1.2.1 (issue #26): the cap derivation stays store-driven — the sidebar
  // never re-counts folders on its own. Since v1.2.2 (issue #28) the only
  // creation entry is the context menu, whose "New folder" item disables
  // with the reason spelled out beneath it.
  const foldersAtCap = folderLimitReached(projectFolders)
  // v1.2.2 (issue #28): the folder the context menu targets — its items
  // (rename / delete) and their disabled reasons derive from it.
  const menuFolder =
    menuFolderId === null
      ? null
      : (projectFolders.find(folder => folder.id === menuFolderId) ?? null)
  const menuFolderProtected =
    menuFolder !== null && isProtectedFolder(menuFolder.id)

  // v1.2.0 (issue #16): the one listing name for `path` (display-names.ts)
  // — a v1.1.2 T6 display-name override (spec issue #10) wins, then the
  // manifest-declared name learned at preflight, then the title-cased path
  // basename. Cards and the drag clone read this.
  const cardName = (path: string) =>
    projectDisplayName(
      path,
      projectDisplayNames,
      manifestProjectNames,
      currentProject
    )

  /** v1.2.2 (user feedback on #29): the protected folder's name localizes
   * at display time — the persisted index keeps the canonical
   * "Utilities", the zh UI reads 工具. */
  const folderDisplayName = (folder: { id: string; name: string }): string =>
    isProtectedFolder(folder.id) ? t('sidebar.utilitiesFolder') : folder.name

  /** Share: open the monitor page in the default external browser. */
  const handleShare = async () => {
    if (!running || !lanIp || !monitorPort) return
    await openUrl(`http://${lanIp}:${monitorPort}/`)
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
    // v1.2.2 (user feedback): a rename onto another folder's name is
    // refused by the store — say why, keep the old name.
    if (name && !store.renameFolder(id, name)) {
      notifications.warning(i18n.t('sidebar.folderNameTaken', { name }))
    }
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
   * v1.2.2 (issue #28): ←/→ on a focused segment — the roving-tabindex tab
   * pattern. The view moves to the neighboring folder view (wrapping at
   * the ends) and focus follows onto the newly active tab.
   */
  const handleSegmentKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const store = useProjectStore.getState()
    const next = nextFolderView(
      store.projectFolders,
      store.activeFolderId,
      event.key === 'ArrowLeft' ? -1 : 1
    )
    setActiveFolderView(next)
    const element =
      next === null
        ? unfiledSegmentRef.current
        : (segmentRefs.current.get(next) ?? null)
    element?.focus()
  }

  /** Resolves which folder segment a right-click landed on (null = track
   * or the unfiled segment) — runs before Radix opens the menu, so the
   * content renders for the right target. */
  const handleTrackContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const segment = (event.target as HTMLElement).closest(
      '[data-folder-segment]'
    )
    setMenuFolderId(
      segment instanceof HTMLElement
        ? (segment.dataset.folderSegment ?? null)
        : null
    )
  }

  /** The menu is a portal outside the sidebar element — report it like the
   * settings popups so the hover sidebar must not auto-retract under it. */
  const handleMenuOpenChange = (open: boolean) => {
    onPopupOpenChange?.(open)
    if (!open) setMenuFolderId(null)
  }

  /**
   * An action queued by a menu selection, run once the menu has fully
   * closed. The menu's trapped FocusScope reclaims any focus that leaves
   * it while the content is still mounted — through its exit animation in
   * a real browser — so running the selection from onSelect itself would
   * see the auto-focused name input blurred back (committing the
   * untouched draft and cancelling the edit). The close handler below is
   * the first moment the scope is guaranteed gone.
   */
  const pendingMenuActionRef = useRef<(() => void) | null>(null)

  /**
   * Runs as the menu content unmounts: the queued action opens now (an
   * inline edit or the delete confirm) and the trigger's focus return is
   * cancelled — whatever the action opens owns the focus. Every other
   * close returns focus to the trigger.
   */
  const handleMenuCloseAutoFocus = (event: Event) => {
    const pendingAction = pendingMenuActionRef.current
    if (pendingAction === null) return
    pendingMenuActionRef.current = null
    event.preventDefault()
    pendingAction()
  }

  // v1.2.2 (issue #28): the pill tracks the active segment. Like the drag
  // clone, its geometry is applied imperatively — a state update per
  // commit would re-render the row for a purely visual shift. The
  // indicator-pill engine (v1.3.2 issue #78) runs the positioning after
  // every commit (view switch, rename, reorder, the inline edit swapping a
  // name for an input — nothing paints stale) and re-measures on
  // resize/font load; the re-measure reads the active folder from the
  // store so it never goes stale itself.
  const activeFolderIdForPill = activeFolder?.id ?? null
  useIndicatorPill({
    apply: () =>
      applyFolderPill(
        pillRef.current,
        activeFolderIdForPill,
        segmentRefs.current,
        unfiledSegmentRef.current
      ),
    remeasure: () =>
      applyFolderPill(
        pillRef.current,
        useProjectStore.getState().activeFolderId,
        segmentRefs.current,
        unfiledSegmentRef.current
      ),
  })

  // v1.2.2 (issue #29, superseding the issue #25 `nearest` reveal): the
  // selected card must sit fully clear of the column's static fade bands —
  // keyboard selection (⌘↑/⌘↓, ⌘1..9, auto-drill), the ⌘-key switch
  // request, the mount-time running project and mouse clicks all flow
  // through this one selectedPath chain, so every entry point avoids
  // alike. The math is revealScrollTarget (list-reveal.ts): minimal
  // movement, clamped to the scroll bounds; a card already clear produces
  // no scroll call at all. v1.2.3 (#39): the chain ends at the last FAILED
  // preflight — a failed selection keeps its pill; selection is free even
  // onto a bad project.
  const selectedPath = useProjectStore(selectSelectedPath)

  // The card-selection pill follows that same chain through the shared
  // engine: every commit re-applies — selection, view switches, reorders
  // and drag frames all move cards. The re-measure deliberately drops the
  // drag/snap hide (a resize landing mid-drag would briefly ignore it;
  // the next commit corrects it), matching the pre-#78 listener.
  useIndicatorPill({
    apply: () =>
      applyCardSelectionPill(
        cardPillRef.current,
        projectContentRef.current,
        selectedPath,
        drag?.kind === 'project' || suppressTransition
      ),
    remeasure: () =>
      applyCardSelectionPill(
        cardPillRef.current,
        projectContentRef.current,
        selectSelectedPath(useProjectStore.getState()),
        false
      ),
  })

  useEffect(() => {
    if (!selectedPath) return
    const container = projectScrollRef.current
    if (!container) return
    for (const card of container.querySelectorAll('[data-project-path]')) {
      if (
        card instanceof HTMLElement &&
        card.dataset.projectPath === selectedPath
      ) {
        const containerRect = container.getBoundingClientRect()
        const cardRect = card.getBoundingClientRect()
        const target = revealScrollTarget({
          cardTop: cardRect.top - containerRect.top + container.scrollTop,
          cardHeight: cardRect.height,
          scrollTop: container.scrollTop,
          viewportHeight: containerRect.height,
          scrollHeight: container.scrollHeight,
        })
        if (target !== null) {
          container.scrollTo({ top: target, behavior: 'smooth' })
        }
        return
      }
    }
  }, [selectedPath, activeFolderId])

  // Report dialog visibility so the hover sidebar keeps peeking while a
  // confirm flow is open (spec issue #4: 确认框期间松开 Cmd 不收回).
  const dialogOpen = pendingDeleteFolderId !== null || confirmCloseProjectOpen
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
  // v1.2.2 (issue #28): the pill steps aside while the row is mid-flight —
  // a folder drag translates the segments (the active one may itself be
  // the invisible dragged clone) and the post-drop snap frame repositions
  // everything; the pill fades out for both and back in at its measured
  // spot once the row is at rest.
  const pillHidden = drag?.kind === 'folder' || suppressTransition

  /** v1.2.2 (issue #29): "add to the list" — same promptOpenProject as
   *  the ⌘O menu path, hidden in the fixed Utilities view. It rides the
   *  scroller's tail in every theme; the style splits by theme (#71 v2
   *  follow-up: solid card-colored under Brutal, translucent chip
   *  elsewhere). */
  const renderImportButton = (className: string) => (
    <button
      type="button"
      data-testid="add-project-button"
      aria-label={t('sidebar.addProject')}
      title={t('sidebar.addProject')}
      onClick={() => void promptOpenProject()}
      disabled={busy}
      className={className}
    >
      <Plus size={14} />
      {t('sidebar.addProject')}
    </button>
  )

  return (
    <aside
      data-testid="sidebar"
      data-sidebar-surface=""
      className={cn(
        'relative flex w-[320px] flex-col overflow-hidden rounded-[var(--app-corner-radius)] text-sm',
        variant === 'static' &&
          'm-3 border border-(--pnds-text)/5 bg-(--pnds-sidebar-bg) shadow-sm',
        variant === 'overlay' &&
          'h-full border border-(--pnds-card)/30 bg-(--pnds-sidebar-bg)/90 shadow-2xl backdrop-blur-xl'
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
            className="pnds-focus-ring rounded-md p-1.5 text-(--pnds-text)/70 transition hover:bg-(--pnds-text)/5 hover:text-(--pnds-text) active:scale-90 disabled:opacity-40"
          >
            <Share size={15} />
          </button>
          <button
            type="button"
            aria-label={t('sidebar.refresh')}
            title={t('sidebar.refreshHint')}
            disabled={!running}
            onClick={() => useSessionStore.getState().bumpMonitorReload()}
            className="pnds-focus-ring rounded-md p-1.5 text-(--pnds-text)/70 transition hover:bg-(--pnds-text)/5 hover:text-(--pnds-text) active:scale-90 disabled:opacity-40"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      <nav className="mt-2 flex min-h-0 flex-1 flex-col">
        {/* v1.2.2 (issue #28): folders are a segmented control above the
            project column — the unfiled segment first (the default view),
            then one segment per folder. The track spans the row and the
            segments share it by content width; a white pill slides under
            the active one (measured offsetLeft/width, transform+width
            transitions) instead of a per-segment background swap. Selecting
            a segment switches the list; dropping a dragged project on a
            folder segment files it in, on the unfiled segment returns it to
            ungrouped (the old breadcrumb bar). Folder management lives in
            a right-click context menu (new / rename / delete); the import
            "+" lands in the selected segment's view (spec issue #7
            新导入落点). Segments are real tabs: role/aria-selected, a
            roving tabindex, ←/→ view switching and an accent focus ring. */}
        <div className="mx-5 mb-2 flex items-center gap-1">
          <ContextMenu onOpenChange={handleMenuOpenChange}>
            <ContextMenuTrigger asChild>
              <div
                role="tablist"
                aria-label={t('sidebar.folderViewsLabel')}
                title={t('sidebar.folderSwitchManageHint')}
                onContextMenu={handleTrackContextMenu}
                className="relative flex min-w-0 flex-1 items-stretch rounded-lg bg-(--pnds-text)/[0.05] p-0.5"
              >
                {/* The sliding active indicator: absolutely positioned
                    inside the track, above nothing (z-0) and below the
                    segments (z-10), pointer-transparent. During a folder
                    drag and the post-drop snap frame it fades out, then
                    fades back in over its re-measured spot. */}
                <div
                  ref={pillRef}
                  data-testid="folder-pill"
                  /* data-folder-pill: the theme layer's hook (Stage's
                     liquid-glass selection, theme-variables.css) — same
                     role as data-selection-pill on the card pill below.
                     The span is that treatment's inner ring (the yzrt
                     reference's .circle-overlay) — inert outside Stage. */
                  data-folder-pill=""
                  aria-hidden="true"
                  className={cn(
                    'pointer-events-none absolute inset-y-0.5 left-0 z-0 rounded-md bg-(--pnds-card) shadow-sm',
                    suppressTransition
                      ? 'transition-none'
                      : 'transition-[transform,width,opacity] duration-[280ms] ease-[cubic-bezier(0.4,0.1,0.2,1)]',
                    pillHidden ? 'opacity-0' : 'opacity-100'
                  )}
                >
                  <span />
                </div>
                <div
                  ref={unfiledSegmentRef}
                  data-testid="unfiled-segment"
                  data-unfiled-segment=""
                  data-drop-active={unfiledDropping ? 'true' : undefined}
                  role="tab"
                  aria-selected={!activeFolder}
                  tabIndex={!activeFolder ? 0 : -1}
                  onKeyDown={handleSegmentKeyDown}
                  onPointerDown={() => {
                    // Every fresh press re-arms the click suppression a
                    // finished drag left behind — the unfiled segment is not
                    // a drag source, so its press has no other handler.
                    clearClickSuppression()
                  }}
                  onClick={() => {
                    if (consumeClick()) return
                    setActiveFolderView(null)
                  }}
                  className={cn(
                    // #32: shared focus ring + press-darkening (the segment
                    // carries an inline transform for the drag yield, so no
                    // press-scale); arrows app-wide, no hand cursor.
                    'pnds-focus-ring relative z-10 flex min-w-0 flex-[1_1_auto] items-center justify-center truncate rounded-md px-2 py-1.5 text-[13px] transition-colors duration-200 active:bg-(--pnds-text)/10',
                    !activeFolder
                      ? 'font-medium text-(--pnds-text)'
                      : 'text-(--pnds-text)/55 hover:text-(--pnds-text)/85',
                    unfiledDropping &&
                      'bg-(--pnds-accent)/15 ring-1 ring-(--pnds-accent)/50'
                  )}
                >
                  {t('sidebar.unfiled')}
                </div>
                {projectFolders.map((folder, folderIndex) => {
                  // Editing covers both the creation gesture (editingFolderId)
                  // and ⌘R / the context-menu rename (renameTarget) — the
                  // edit lives inside the segment.
                  const isEditing =
                    editingFolderId === folder.id ||
                    (renameTarget?.kind === 'folder' &&
                      renameTarget.id === folder.id)
                  // v1.1.2 T7: the Utilities folder is permanent — its menu
                  // rename/delete disable with the reason, it is never
                  // draggable, and it pins last.
                  const isProtected = isProtectedFolder(folder.id)
                  const isActive = activeFolderId === folder.id
                  // v1.2.3 (#39): the "in use" dot follows the SESSION's
                  // project — selecting another card while one runs never
                  // moves it.
                  const inUse =
                    sessionLive &&
                    sessionProjectPath !== null &&
                    folder.projectPaths.includes(sessionProjectPath)
                  // A folder drag yields its siblings exactly like a project
                  // drag, horizontally (spec issue #9: 文件夹卡在文件夹区内
                  // 可拖拽排序).
                  const isDraggedSegment =
                    drag?.kind === 'folder' && drag.id === folder.id
                  // A project drag highlights the hovered segment as its
                  // drop zone — never the protected Utilities segment
                  // (v1.3.2: it takes no outside projects).
                  const isDropHover =
                    folderDropIndex === folderIndex && !isProtected
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
                      ref={node => {
                        if (node) segmentRefs.current.set(folder.id, node)
                        else segmentRefs.current.delete(folder.id)
                      }}
                      data-testid="folder-segment"
                      data-folder-segment={folder.id}
                      data-drop-active={isDropHover ? 'true' : undefined}
                      role="tab"
                      aria-selected={isActive}
                      tabIndex={isActive ? 0 : -1}
                      title={folderDisplayName(folder)}
                      onKeyDown={handleSegmentKeyDown}
                      onPointerDown={e => {
                        // Every fresh press re-arms the click suppression a
                        // finished drag left behind — also when the segment
                        // cannot become a drag source (editing, protected,
                        // secondary button).
                        clearClickSuppression()
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
                        if (consumeClick()) return
                        setActiveFolderView(folder.id)
                      }}
                      style={
                        cardOffset !== 0
                          ? { transform: `translateX(${cardOffset}px)` }
                          : undefined
                      }
                      className={cn(
                        // #32: shared focus ring + press-darkening (the
                        // inline drag transform rules out press-scale).
                        'pnds-focus-ring group/segment relative z-10 flex min-w-0 flex-[1_1_auto] select-none items-center justify-center gap-1 truncate rounded-md px-2 py-1.5 text-[13px] active:bg-(--pnds-text)/10',
                        suppressTransition
                          ? 'transition-none'
                          : 'transition-[color,background-color,transform] duration-200',
                        isActive
                          ? 'font-medium text-(--pnds-text)'
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
                            {folderDisplayName(folder)}
                          </span>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </ContextMenuTrigger>
            {/* v1.2.2 (issue #28): folder management menu. The track and
                the unfiled segment offer creation only; a folder segment
                adds rename (the same InlineNameInput ⌘R enters) and delete
                (the existing confirm dialog). The cap (#26) and the
                Utilities protection disable their items with the reason
                spelled out beneath — a disabled item must say why. */}
            <ContextMenuContent
              data-testid="folder-context-menu"
              onCloseAutoFocus={handleMenuCloseAutoFocus}
            >
              <ContextMenuItem
                data-testid="menu-new-folder"
                disabled={foldersAtCap}
                onSelect={() => {
                  pendingMenuActionRef.current = handleNewFolder
                }}
              >
                <div className="flex w-full flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <FolderPlus />
                    {t('sidebar.newFolder')}
                  </span>
                  {foldersAtCap && (
                    <span className="pl-6 text-xs leading-snug font-normal text-(--pnds-text)/45">
                      {t('sidebar.folderLimitReached', {
                        limit: FOLDER_LIMIT,
                      })}
                    </span>
                  )}
                </div>
              </ContextMenuItem>
              {menuFolder && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    data-testid="menu-rename-folder"
                    disabled={menuFolderProtected}
                    onSelect={() => {
                      pendingMenuActionRef.current = () =>
                        startFolderRename(menuFolder.id)
                    }}
                  >
                    <div className="flex w-full flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <Pencil />
                        {t('sidebar.renameFolder')}
                        <ContextMenuShortcut>⌘R</ContextMenuShortcut>
                      </span>
                      {menuFolderProtected && (
                        <span className="pl-6 text-xs leading-snug font-normal text-(--pnds-text)/45">
                          {t('sidebar.utilitiesProtected')}
                        </span>
                      )}
                    </div>
                  </ContextMenuItem>
                  <ContextMenuItem
                    data-testid="menu-delete-folder"
                    variant="destructive"
                    disabled={menuFolderProtected}
                    onSelect={() => {
                      pendingMenuActionRef.current = () =>
                        setPendingDeleteFolderId(menuFolder.id)
                    }}
                  >
                    <div className="flex w-full flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <Trash2 />
                        {t('sidebar.deleteFolder')}
                      </span>
                      {menuFolderProtected && (
                        <span className="pl-6 text-xs leading-snug font-normal text-(--pnds-text)/45">
                          {t('sidebar.utilitiesProtected')}
                        </span>
                      )}
                    </div>
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        </div>

        {/* v1.2.1 (issue #25): the project column is its own vertical
            scroll region — overflow cards stay reachable while the folder
            switch above and the footer below stay fixed.
            v1.2.2 (issue #29): the column fades its top and bottom 20px
            statically and pads its ends (26px top / 32px bottom) so resting
            content — the first card, the tail import "+" — naturally sits
            clear of the bands; the reveal effect scrolls selection out of a
            band (list-reveal.ts). The fade is a two-layer mask on the
            scroller (user feedback on #29): a mask needs no color matching,
            so the translucent overlay sidebar composites correctly, and the
            second layer keeps the right scrollbar lane unmasked — the
            native indicator must not fade.
            v1.3.1 (#71 v2): the mask makes this scroller a stacking
            context, so its cards could never clear a positioned footer
            sibling — the z-10 here (flex items honor z-index) keeps the
            column above the footer's Brutal octopus layer. The Brutal
            reserve below keeps the cards out of the art entirely (they
            page above the tentacles, never over them); the z-10 stays
            as the guard. The mask is also why the card-selection pill
            must stay backdrop-filter-free (Stage's liquid glass,
            theme-variables.css #88): a masked ancestor is its
            descendants' backdrop root, so a blur on the pill would
            sample only the empty scroller content below it. */}
        <div
          ref={projectScrollRef}
          data-testid="project-list-scroll"
          data-project-scroll=""
          style={brutal ? { marginBottom: OCTO_COLUMN_RESERVE_PX } : undefined}
          className="z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain [mask-composite:add] [-webkit-mask-composite:source-over] [mask-image:linear-gradient(to_bottom,transparent_0px,#000_20px,#000_calc(100%_-_20px),transparent_100%),linear-gradient(to_right,transparent_calc(100%_-_15px),#000_calc(100%_-_15px))]"
        >
          <div
            ref={projectContentRef}
            data-testid="project-list-content"
            className="relative flex flex-col gap-1 pt-[26px] pb-[32px]"
          >
            {/* The card-selection pill: the folder switch's sliding
                language on the project column. The white highlight slides
                between cards instead of crossfading per card; geometry is
                imperative (applyCardSelectionPill), so it never re-renders
                the list for a visual shift. */}
            <div
              ref={cardPillRef}
              data-testid="card-selection-pill"
              data-selection-pill=""
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-x-5 top-0 z-0 rounded-xl bg-(--pnds-card) shadow-sm',
                suppressTransition
                  ? 'transition-none'
                  : 'transition-[transform,opacity] duration-[280ms] ease-[cubic-bezier(0.4,0.1,0.2,1)]'
              )}
            >
              {/* Stage's liquid-glass inner ring (the yzrt reference's
                  .circle-overlay) — inert outside Stage. */}
              <span />
            </div>
            {visiblePaths.map((path, index) => {
              const isCurrent = path === currentProject?.path
              const isDragged = drag?.kind === 'project' && drag.path === path
              const renamingProject =
                renameTarget?.kind === 'project' && renameTarget.path === path
              // v1.3.2 (user report after #75): a bundled utility tool is
              // app content — position, membership and presence are fixed.
              const isUtility = utilityPaths.includes(path)
              // v1.2.3 (#39): the running bar follows the SESSION's project
              // (from the moment the session starts, not only once ready) —
              // an idle selection stays white-card-only, and selecting
              // another card while one runs never moves the bar.
              const isSessionCard = sessionLive && path === sessionProjectPath
              const showRunningBar = isSessionCard
              // v1.3.3 (#85): the bundled tool's illustrative icon takes
              // the left slot — same 20px, so the centered title's optical
              // axis is unchanged.
              const UtilityIcon = isUtility ? utilityCardIcon(path) : null
              // v1.2.3 (#39): the selected project's preflight verdict shows
              // on its card — a small spinner while checking, a danger icon
              // (tooltip = the raw error) when it failed.
              const isChecking = pendingPreflightPath === path
              const preflightError = preflightErrors[path]
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
                  data-selected-card={path === selectedPath ? '' : undefined}
                  onPointerDown={e => {
                    // Every fresh press re-arms the click suppression a
                    // finished drag left behind — also when the card cannot
                    // become a drag source (renaming, bundled tool).
                    clearClickSuppression()
                    // Renaming owns the card; the drag must not steal
                    // focus. Bundled utility tools never drag (v1.3.2).
                    if (renamingProject || isUtility) return
                    beginCardDrag(
                      { kind: 'project', path },
                      e,
                      '[data-project-path]'
                    )
                  }}
                  onClick={() => {
                    if (consumeClick()) return
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
                    // z-10: the selection pill (z-0) slides under the cards —
                    // the selected card itself stays transparent; the pill is
                    // its white highlight (the folder switch's language).
                    'group relative z-10 mx-5 flex h-14.25 shrink-0 select-none items-center rounded-xl px-3',
                    suppressTransition
                      ? 'transition-none'
                      : 'transition-[background-color,transform] duration-200',
                    // selectedPath covers pending preflight, the current
                    // project and the last failed selection — the pill
                    // slides to whichever card the chain names. The
                    // transparent rest is back in every theme (#71 v2:
                    // the column reserves the octopus's zone, so cards
                    // never meet the art in Brutal either).
                    path === selectedPath
                      ? 'active:bg-(--pnds-bg)'
                      : 'hover:bg-(--pnds-text)/5 active:bg-(--pnds-text)/10',
                    // Hidden, not removed: its slot is what the yielding cards
                    // slide over while the floating clone represents it.
                    isDragged && 'invisible'
                  )}
                >
                  {/* v1.2.2 (issue #29): the running project's left-edge accent
                    bar — rounded, inset from the card's corners (the
                    placement prototype's 3px/14px spec). v1.2.3 (#39): it
                    marks the session's project, independent of selection. */}
                  {showRunningBar && (
                    <span
                      data-testid="running-bar"
                      aria-hidden="true"
                      className="absolute top-3.5 bottom-3.5 left-1.5 w-[3px] rounded-[2px] bg-(--pnds-accent)"
                    />
                  )}
                  {/* Left slot keeps the centered title's optical axis; the
                    whole card is the drag trigger (v1.1.2 T5). v1.3.3
                    (#85): a bundled tool's slot carries its icon — the
                    badge's subdued tone, never a focus target. The glyph
                    rides 1px above the row's geometric center: the 15px
                    title's optical axis (its lowercase mass) sits that
                    far up, a dead-center icon reads low against it. */}
                  {UtilityIcon ? (
                    <span
                      data-testid="utility-card-icon"
                      data-utility-icon={builtinUtilityId(path)}
                      aria-hidden="true"
                      className="flex w-5 shrink-0 items-center justify-center text-(--pnds-text)/45"
                    >
                      <UtilityIcon
                        size={14}
                        strokeWidth={2}
                        className="-translate-y-px"
                      />
                    </span>
                  ) : (
                    <span className="w-5 shrink-0" aria-hidden="true" />
                  )}

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
                      disabled={busy}
                      title={path}
                      tabIndex={-1}
                      className="flex-1 truncate text-center text-[15px] text-(--pnds-text)/85 disabled:opacity-60"
                    >
                      {cardName(path)}
                    </button>
                  )}

                  {/* Right slot: ⌘N hint while Cmd is held (v1.1.2), the
                  project's preflight verdict (v1.2.3 #39), else ✕ remove
                  from history — never for the open or running project. */}
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
                  ) : isChecking ? (
                    <span
                      data-testid="card-preflight-checking"
                      className="flex w-5 shrink-0 items-center justify-center"
                    >
                      <Spinner
                        className="size-3.5 text-(--pnds-text)/45"
                        aria-label={t('sidebar.checkingProject')}
                      />
                    </span>
                  ) : preflightError ? (
                    <span
                      data-testid="card-preflight-error"
                      title={preflightError}
                      className="flex w-5 shrink-0 items-center justify-center"
                    >
                      <AlertCircle
                        size={14}
                        aria-label={t('sidebar.preflightFailedCard')}
                        className="text-(--pnds-danger)"
                      />
                    </span>
                  ) : isCurrent || isSessionCard || isUtility ? (
                    /* Bundled tools are permanent (v1.3.2) — the spacer
                       keeps the title's optical axis, no ✕. */
                    <span className="w-5 shrink-0" />
                  ) : (
                    <button
                      type="button"
                      aria-label={t('sidebar.removeFromHistory')}
                      tabIndex={-1}
                      onClick={e => {
                        e.stopPropagation()
                        handleRemove(path)
                      }}
                      className="pnds-focus-ring w-5 shrink-0 text-(--pnds-text)/50 opacity-0 transition hover:text-(--pnds-text) active:scale-90 focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              )
            })}

            {/* v1.2.2 (issue #29): empty states carry a centered linear icon
              alongside the existing copy. */}
            {!activeFolder && recentProjectPaths.length === 0 && (
              <ListEmptyState
                testId="no-projects-empty"
                label={t('sidebar.noProjects')}
              >
                <Music size={26} strokeWidth={1.8} aria-hidden="true" />
              </ListEmptyState>
            )}
            {activeFolder && visiblePaths.length === 0 && (
              <ListEmptyState
                testId="folder-empty"
                label={t('sidebar.folderEmpty')}
              >
                <FolderOpen size={26} strokeWidth={1.8} aria-hidden="true" />
              </ListEmptyState>
            )}

            {/* v1.2.2 (issue #29): the import entry lives at the column's
              end — "add to the list" belongs to the list. The end padding
              keeps it clear of the fade band at full scroll; with no
              projects it follows the empty state. The fixed Utilities view
              is the one exception (user feedback): its members are bundled
              tools, not imports. #71 v2 follow-up: under Brutal the button
              keeps its solid look (card color, black border, hard shadow,
              pressed 1px into the shadow) here at the tail — the column's
              reserve keeps it clear of the octopus below. */}
            {!activeFolderIsProtected &&
              renderImportButton(
                cn(
                  'pnds-focus-ring mx-auto mt-1.5 mb-1 flex shrink-0 items-center gap-1.5 rounded-[9px] px-[18px] py-1.5 text-xs transition disabled:opacity-50',
                  brutal
                    ? 'border border-(--pnds-text) bg-(--pnds-card) text-(--pnds-text) shadow-(--pnds-card-shadow) hover:bg-(--pnds-accent) active:translate-x-[1px] active:translate-y-[1px]'
                    : 'bg-(--pnds-text)/5 text-(--pnds-text)/60 hover:bg-(--pnds-text)/10 hover:text-(--pnds-text) active:scale-[0.98]'
                )
              )}
          </div>
        </div>
      </nav>

      {/* Deferred settings + their submit are one object (§10.2): the card
          clips the button into a full-bleed footer. The wrapper doubles as
          the Brutal octopus's anchor (#71): a relative wrapper + absolute
          layer keeps the follow pure CSS — rows changing the card's height
          (audio mode / device / volume) carry the octopus along, while it
          stays outside the project scroller. The art keeps the column's
          reserved zone clear (#71 v2); this wrapper is its containing
          block. */}
      <div data-testid="settings-footer" className="relative px-5 pb-5 pt-6">
        {brutal && (
          /* A stretching div, not the img: a replaced element ignores the
             inset stretch (it would render at intrinsic size), while this
             div pins to exactly the card's width. */
          <div
            data-testid="octo-sidebar"
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-5 z-0"
            style={{
              bottom: `calc(100% - 24px - ${OCTO_SHELF_OVERHANG_PX}px)`,
            }}
          >
            <img src={octoSidebar2x} alt="" className="w-full" />
          </div>
        )}
        <div className="overflow-hidden rounded-xl bg-(--pnds-card) shadow-(--pnds-card-shadow)">
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
                {(() => {
                  const dragged =
                    projectFolders.find(folder => folder.id === drag.id) ?? null
                  return dragged ? folderDisplayName(dragged) : ''
                })()}
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
                name: pendingDeleteFolder
                  ? folderDisplayName(pendingDeleteFolder)
                  : '',
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
