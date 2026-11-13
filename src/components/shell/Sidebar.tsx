import { participationErrorText } from '@/lib/participation-errors'
import { PerformanceRoleButton } from './PerformanceRoleButton'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  X,
  Play,
  SquarePen,
  Command,
  Music,
  Folder,
  FolderOpen,
  AlertCircle,
  Pencil,
  Trash2,
} from 'lucide-react'
import i18n from '@/i18n/config'
import {
  PROJECT_LIMIT_PER_DIRECTORY,
  isProtectedFolder,
  selectSelectedPath,
  useProjectStore,
  visibleProjectPaths,
} from '@/store/project-store'
import {
  isSessionBusy,
  isSessionLive,
  useSessionStore,
} from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { notifications } from '@/lib/notifications'
import { promptOpenProject } from '@/lib/open-project'
import { Spinner } from '@/components/ui/spinner'
import { moveProjectSelection, selectProject } from '@/lib/project-select'
import {
  canLoadSelectedProjectFrom,
  useStartGateInputs,
} from '@/lib/session-flow'
import {
  canSelectFocusedPerformanceProject,
  loadPerformanceProject,
} from '@/lib/performance-selection'
import { reclaimIfManagedBundle } from '@/lib/bundle-project'
import { revealScrollTarget } from '@/lib/list-reveal'
import { folderDisplayName, projectDisplayName } from '@/lib/display-names'
import { builtinUtilityId } from '@/lib/builtin-utilities'
import { utilityCardIcon } from './utility-icons'
import { cardShift, insertionIndexFor, reorderedList } from '@/lib/drag-reorder'
import { useCardDrag, type ActiveDropTarget } from '@/hooks/use-card-drag'
import { useIndicatorPill } from '@/hooks/use-indicator-pill'
import { useSidebarEntrance } from '@/hooks/use-sidebar-entrance'
import { applyCardSelectionPill, CARD_SELECTOR } from '@/lib/selection-pills'
import { CardSelectionPill } from './CardSelectionPill'
import { sidebarDragAdapter, type DragSource } from './sidebar-drag-adapter'
import { FolderSwitch } from './FolderSwitch'
import { InlineNameInput } from './InlineNameInput'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import { TrafficLights } from './TrafficLights'
import { cn } from '@/lib/utils'
import { hasOpenOverlay, isEditableTarget } from '@/hooks/use-command-keyboard'
import { useCreationStore } from '@/store/creation-store'

interface SidebarProps {
  /** welcome/loading: statically visible; running: floats over the monitor */
  variant: 'static' | 'overlay'
  /** Hidden overlays defer their first card entrance until actually shown. */
  visible?: boolean
  /** Overlay mode: a settings popup menu is open — keep the sidebar visible. */
  onPopupOpenChange?: (open: boolean) => void
  onSettingCommitted?: () => void
  /** Overlay mode: a sidebar dialog (folder delete) is open — releasing
   * Cmd must not retract the peeked sidebar. */
  onDialogOpenChange?: (open: boolean) => void
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
      className="flex shrink-0 flex-col items-center gap-2 px-9 py-4 text-(--pnds-text-secondary)"
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
 * (remove from history) appears on every card except the live session's
 * project and the bundled tools (user report after #63: a merely selected
 * or broken project must always be removable). v1.2.3 (#39): selecting
 * while a session runs is free
 * (select + preflight, never a confirmation); starting B on top of A is
 * confirmed at the Load action, not here.
 *
 * FolderSwitch sits beside the current folder heading: the Home
 * view lists ungrouped projects, compact tabs select a user folder or
 * Utilities, and the current folder names the list. Management remains in
 * its context menu. Holding Cmd numbers the first nine projects of the
 * current view. Project titles and remove buttons are pointer-only;
 * ⌘1..9 and sidebar-owned plain ↑/↓ select projects.
 *
 * v1.2.2 (issue #29): the project column polishes up — the import entry
 * moves to the column's end (icon + label, ghost), the running project
 * wears a left-edge accent bar (from the session's start — the in-use
 * dot's semantics; idle selection stays white-card-only), the column
 * fades its bottom edge statically (20px masking that spares the native
 * scrollbar, tail padding keeps resting content clear), and selection —
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
 * identity header and folder switch stay fixed; keyboard selection
 * scrolls its card into view, and a drag hovering the list's top/bottom
 * edge auto-scrolls it (the drag hit spaces re-anchor on every scroll).
 */
export function Sidebar({
  variant,
  visible = true,
  onPopupOpenChange,
  onDialogOpenChange,
}: SidebarProps) {
  const { t } = useTranslation()
  const folderHeadingId = useId()
  const folderPanelId = useId()
  const projectActionsId = useId()
  const projectRemovalId = useId()
  const menuAction = useRef<(() => void) | null>(null)
  const [menuPath, setMenuPath] = useState<string | null>(null)
  const startGate = useStartGateInputs()
  const pendingChanges = useSessionStore(state => state.pendingChanges)
  const creationOpening = useCreationStore(state => state.opening)
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
  const busy = isSessionBusy(sessionStatus)
  // v1.1.2 T3: the running bar shows from the moment the session starts,
  // not only once ready (spec issue #4: 使用中指示点; the folder switch's
  // in-use dot reads the same predicate in FolderSwitch) — one
  // session-store derivation, never a local re-spelling.
  const sessionLive = isSessionLive(sessionStatus)
  /** v1.2.2 (user request after #32): the card-selection pill — geometry
   * imperative like the folder pill (selection-pills.ts). */
  const cardPillRef = useRef<HTMLDivElement | null>(null)
  /** The positioned list content the card pill measures against. */
  const projectContentRef = useRef<HTMLDivElement | null>(null)
  /** v1.2.1 (issue #25): the independently scrolling project column. */
  const projectScrollRef = useRef<HTMLDivElement | null>(null)
  const revealedFolderRef = useRef<{ id: string | null } | null>(null)

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

  /**
   * v1.3.2 (issue #75): the whole pointer drag machine — press slack
   * activation, the floating clone transform, static hit-space snapshots,
   * drop resolution, edge auto-scroll, scroll re-anchoring and the
   * post-commit transition suppression — lives in useCardDrag; the
   * sidebar only measures (sidebar-drag-adapter) and commits (above).
   * One machine serves both drop sections — the project column here and
   * the folder switch row (FolderSwitch) — so the controller is kept
   * whole and handed down to the row.
   */
  const dragController = useCardDrag<DragSource>({
    adapter: sidebarDragAdapter,
    onCommit: commitDragDrop,
  })
  const {
    drag,
    dropTarget,
    ghost: dragGhost,
    suppressTransition,
    cloneRef,
    press: beginCardDrag,
    consumeClick,
    clearClickSuppression,
  } = dragController

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
    activeFolderId !== null && isProtectedFolder(activeFolderId)
  const activeFolderName = activeFolderIsProtected
    ? t('sidebar.utilitiesFolder')
    : activeFolder
      ? folderDisplayName(activeFolder)
      : t('sidebar.unfiled')

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

  /** ✕ (remove from history) — offered on every card except the live
   * session's project and the bundled tools (user report after #63);
   * removing a selected-but-idle or broken card is exactly the escape
   * hatch the ✕ is for. Removing the app-side index never touches the
   * on-disk project (spec issue #4); v1.2.0 (issue #16) additionally
   * reclaims bundle installs under the app-managed bundles/ directory. */
  const handleRemove = (path: string) => {
    // The store persists the index as part of the removal commit (and
    // takes the card's transient selection/error state with it).
    useProjectStore.getState().removeRecentProject(path)
    void reclaimIfManagedBundle(path)
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
  const menuTargetSelected = menuPath !== null && menuPath === selectedPath
  const canOpenMenuProject =
    menuTargetSelected &&
    currentProject?.path === menuPath &&
    !creationOpening &&
    canLoadSelectedProjectFrom(startGate, pendingPreflightPath, pendingChanges)
  const canCreateMenuProject =
    menuTargetSelected &&
    !utilityPaths.includes(menuPath) &&
    !busy &&
    !startGate.commandPending &&
    !startGate.modeSwitchBlocked &&
    !creationOpening
  const projectMenuReason = !menuTargetSelected
    ? t('desktop.menu.selectProjectReason')
    : utilityPaths.includes(menuPath)
      ? t('desktop.menu.utilityProtectedReason')
      : menuPath === sessionProjectPath && sessionLive
        ? t('desktop.menu.runningProjectReason')
        : undefined

  const beginCreation = async (path: string) => {
    const epoch = useCreationStore.getState().epoch
    if (
      selectSelectedPath(useProjectStore.getState()) !== path ||
      !(await canSelectFocusedPerformanceProject()) ||
      useCreationStore.getState().epoch !== epoch ||
      selectSelectedPath(useProjectStore.getState()) !== path
    )
      return
    await useCreationStore.getState().prepareModeSwitch(path)
    const creation = useCreationStore.getState()
    if (creation.epoch === epoch + 1 && creation.modePhase === 'armed')
      await creation.commitModeSwitch(0, true, { confirmRuntimeStop: true })
  }

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

  useLayoutEffect(() => {
    const enteringFolder =
      revealedFolderRef.current === null ||
      revealedFolderRef.current.id !== activeFolderId
    revealedFolderRef.current = { id: activeFolderId }
    if (!selectedPath) return
    const container = projectScrollRef.current
    if (!container) return
    for (const card of container.querySelectorAll(CARD_SELECTOR)) {
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
          container.scrollTo({
            top: target,
            behavior: enteringFolder ? 'instant' : 'smooth',
          })
        }
        return
      }
    }
  }, [selectedPath, activeFolderId])

  useSidebarEntrance({
    contentRef: projectContentRef,
    viewportRef: projectScrollRef,
    pillRef: cardPillRef,
    viewKey: activeFolderId,
    visible,
    selectedPath,
    pathsKey: JSON.stringify(visiblePaths),
    disabled: brutal,
  })

  // Keep the hover sidebar visible while FolderSwitch confirms deletion.
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  useEffect(() => {
    onDialogOpenChange?.(folderDialogOpen)
  }, [folderDialogOpen, onDialogOpenChange])

  // v1.1.2 T4/T5: drag geometry — the dragged card hides behind its floating
  // clone while the remaining cards yield one card-stride to open the gap
  // at the midpoint-derived insertion slot (spec issues #8, #9). Folder
  // drops highlight instead of yielding: the project joins the hovered
  // folder's end, the breadcrumb returns it to ungrouped (the folder
  // row's own derivations live in FolderSwitch).
  const dragProjectIndex =
    drag?.kind === 'project' ? visiblePaths.indexOf(drag.path) : -1
  const listDrop = dropTarget?.kind === 'list' ? dropTarget : null
  const projectInsertionIndex =
    drag?.kind === 'project' && listDrop
      ? insertionIndexFor(listDrop.index, listDrop.half)
      : null
  const previewPaths = reorderedList(
    visiblePaths,
    dragProjectIndex,
    projectInsertionIndex
  )
  let dragOrdinal = drag ? previewPaths.indexOf(drag.path) + 1 : 0
  if (drag && dropTarget?.kind === 'folder') {
    const destination = projectFolders[dropTarget.index]
    if (
      destination &&
      !isProtectedFolder(destination.id) &&
      (destination.projectPaths.includes(drag.path) ||
        destination.projectPaths.length < PROJECT_LIMIT_PER_DIRECTORY)
    ) {
      // Filing appends after removing any existing membership.
      dragOrdinal =
        destination.projectPaths.filter(path => path !== drag.path).length + 1
    }
  } else if (drag && dropTarget?.kind === 'breadcrumb' && activeFolder) {
    const homePreview = visibleProjectPaths(
      recentProjectPaths,
      projectFolders.map(folder => ({
        ...folder,
        projectPaths: folder.projectPaths.filter(path => path !== drag.path),
      })),
      null
    )
    dragOrdinal = homePreview.indexOf(drag.path) + 1
  }
  // Card pitch fallback: h-14.25 (57px) + gap-1 (4px). Real drags measure it.
  const stride = dragGhost?.stride ?? 61

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
      data-project-dragging={drag ? '' : undefined}
      tabIndex={-1}
      onMouseEnter={event => {
        if (
          variant === 'overlay' &&
          !event.currentTarget.contains(document.activeElement) &&
          !hasOpenOverlay()
        )
          event.currentTarget.focus({ preventScroll: true })
      }}
      onKeyDownCapture={event => {
        if (
          !['ArrowUp', 'ArrowDown'].includes(event.key) ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey ||
          isEditableTarget(event.target) ||
          hasOpenOverlay() ||
          (event.target as HTMLElement).closest(
            '[role="combobox"], [role="slider"], [role="tablist"], select, .performance-role-switch'
          ) ||
          useCreationStore.getState().active ||
          useCreationStore.getState().modePhase !== 'idle'
        )
          return
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat && !useSessionStore.getState().commandPending)
          moveProjectSelection(event.key === 'ArrowDown' ? 1 : -1)
      }}
      className={cn(
        'relative flex w-[320px] flex-col rounded-[var(--app-corner-radius)] text-sm outline-none',
        drag?.kind === 'project' ? 'overflow-visible' : 'overflow-hidden',
        variant === 'static' &&
          'm-3 border border-(--pnds-border) bg-(--pnds-sidebar-bg) shadow-sm',
        variant === 'overlay' &&
          'h-full border border-(--pnds-border) bg-(--pnds-sidebar-bg) shadow-(--pnds-popover-shadow)'
      )}
    >
      <div data-tauri-drag-region className="desktop-sidebar-chrome">
        <TrafficLights />
      </div>

      <div
        data-testid="sidebar-identity"
        className="performance-sidebar-identity shrink-0"
      >
        <PerformanceRoleButton />
      </div>
      <nav className="flex min-h-0 flex-1 flex-col">
        {/* Keep the header and its drop targets in the project list's nav. */}
        <div
          data-testid="sidebar-browser-controls"
          className="performance-sidebar-folder-header"
        >
          <h2
            id={folderHeadingId}
            className="performance-sidebar-project-heading"
            title={activeFolderName}
          >
            <Folder
              size={14}
              className="performance-sidebar-folder-icon"
              aria-hidden="true"
            />
            <bdi className="performance-sidebar-folder-name">
              {activeFolderName}
            </bdi>
          </h2>
          <FolderSwitch
            panelId={folderPanelId}
            dragController={dragController}
            onPopupOpenChange={onPopupOpenChange}
            onDialogOpenChange={setFolderDialogOpen}
          />
        </div>
        {/* v1.2.1 (issue #25): the project column is its own vertical
            scroll region — overflow cards stay reachable while the folder
            header stays fixed. The 20px bottom fade and 32px tail
            padding keep the import action clear of clipped cards; the
            second mask layer keeps the native scrollbar lane visible.
            The reveal effect still measures each
            selected card against the actual viewport (list-reveal.ts),
            independently of the live network details in the bottom bar.
            The mask is also why the card-selection pill
            must stay backdrop-filter-free (Stage's liquid glass,
            theme-variables.css #88): a masked ancestor is its
            descendants' backdrop root, so a blur on the pill would
            sample only the empty scroller content below it. */}
        <ContextMenu onOpenChange={onPopupOpenChange}>
          <ContextMenuTrigger asChild disabled={busy || renameTarget !== null}>
            <div
              ref={projectScrollRef}
              data-testid="project-list-scroll"
              data-project-scroll=""
              onContextMenuCapture={event => {
                const card = (event.target as Element).closest<HTMLElement>(
                  '[data-project-path]'
                )
                setMenuPath(card?.dataset.projectPath ?? null)
              }}
              className="performance-sidebar-project-scroll z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain [mask-composite:add] [-webkit-mask-composite:source-over] [mask-image:linear-gradient(to_bottom,#000_0px,#000_calc(100%_-_20px),transparent_100%),linear-gradient(to_right,transparent_calc(100%_-_15px),#000_calc(100%_-_15px))]"
            >
              <div
                ref={projectContentRef}
                id={folderPanelId}
                role="tabpanel"
                aria-labelledby={folderHeadingId}
                data-testid="project-list-content"
                className="relative flex flex-col gap-1 pb-[32px]"
              >
                {/* One sliding surface serves keyboard and pointer selection.
                    Selected rows stay transparent, including on hover/press. */}
                <CardSelectionPill
                  pillRef={cardPillRef}
                  instant={suppressTransition}
                />
                {visiblePaths.map((path, index) => {
                  const ordinal =
                    (previewPaths === visiblePaths
                      ? index
                      : previewPaths.indexOf(path)) + 1
                  const isCurrent = path === currentProject?.path
                  const isDragged =
                    drag?.kind === 'project' && drag.path === path
                  const renamingProject =
                    renameTarget?.kind === 'project' &&
                    renameTarget.path === path
                  // v1.3.2 (user report after #75): a bundled utility tool is
                  // app content — position, membership and presence are fixed.
                  const isUtility = utilityPaths.includes(path)
                  // v1.2.3 (#39): the running bar follows the SESSION's project
                  // (from the moment the session starts, not only once ready) —
                  // an idle selection stays white-card-only, and selecting
                  // another card while one runs never moves the bar.
                  const isSessionCard =
                    sessionLive && path === sessionProjectPath
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
                      data-selected-card={
                        path === selectedPath ? '' : undefined
                      }
                      data-running-card={showRunningBar ? '' : undefined}
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
                          CARD_SELECTOR
                        )
                      }}
                      onClick={() => {
                        if (consumeClick()) return
                        selectProject(path)
                      }}
                      onContextMenu={() => {
                        if (!renamingProject && !busy && path !== selectedPath)
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
                        // z-10 keeps text and the fixed live-session rail
                        // above the shared sliding selection surface.
                        'pnds-project-card group relative z-10 mx-5 flex h-14.25 shrink-0 select-none items-center rounded-xl px-3',
                        suppressTransition
                          ? 'transition-none'
                          : 'transition-[background-color,border-color,box-shadow,transform] duration-200',
                        // CSS limits hover/press tint to unselected rows.
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
                          data-running-project-marker=""
                          className="pnds-project-marker absolute top-3.5 bottom-3.5 w-[3px] rounded-[2px]"
                        />
                      )}
                      <span
                        data-testid="project-order-number"
                        className="desktop-project-index"
                        dir="ltr"
                        aria-hidden="true"
                      >
                        {String(ordinal).padStart(2, '0')}
                      </span>
                      {/* Status/tool markers stay separate from the ordinal;
                          error feedback must never hide the remove action. */}
                      {preflightError ? (
                        <span
                          data-testid="card-preflight-error"
                          title={participationErrorText(preflightError)}
                          className="flex w-5 shrink-0 items-center justify-center"
                        >
                          <AlertCircle
                            size={14}
                            aria-label={t('sidebar.preflightFailedCard')}
                            className="text-(--pnds-danger)"
                          />
                        </span>
                      ) : UtilityIcon ? (
                        <span
                          data-testid="utility-card-icon"
                          data-utility-icon={builtinUtilityId(path)}
                          aria-hidden="true"
                          className="flex w-5 shrink-0 items-center justify-center text-(--pnds-text-secondary)"
                        >
                          <UtilityIcon
                            size={14}
                            strokeWidth={2}
                            className="-translate-y-px"
                          />
                        </span>
                      ) : null}

                      {renamingProject ? (
                        /* v1.1.2 T6: ⌘R inline rename — autofocus, select-all,
                         * Enter/blur commit, Esc cancel (spec issue #10). */
                        <InlineNameInput
                          testId="project-name-input"
                          value={cardName(path)}
                          className="flex-1 truncate rounded-lg border border-(--pnds-input) bg-(--pnds-pill) px-2 py-1 text-start text-[15px] text-(--pnds-text) outline-none"
                          onCommit={commitProjectName}
                          onCancel={cancelProjectName}
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          title={path}
                          tabIndex={-1}
                          className="desktop-project-title flex-1 truncate text-(--pnds-text) disabled:opacity-60"
                        >
                          {cardName(path)}
                        </button>
                      )}

                      {/* Right slot: ⌘N hint while Cmd is held (v1.1.2), the
                  in-flight preflight spinner (v1.2.3 #39), else ✕ remove
                  from history. User report after #63: the ✕ is offered on
                  EVERY card except the session's live one (正在演出的那张
                  — removing the performing project is what Close is for)
                  and the bundled tools (app content, v1.3.2) — a merely
                  selected or broken project must always be removable. */}
                      {showBadge ? (
                        <span
                          data-testid="project-number-badge"
                          className="flex w-5 shrink-0 items-center justify-center gap-0.5 text-(--pnds-text-secondary)"
                        >
                          <Command
                            size={10}
                            strokeWidth={2.5}
                            aria-hidden="true"
                          />
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
                            className="size-3.5 text-(--pnds-text-secondary)"
                            aria-label={t('sidebar.checkingProject')}
                          />
                        </span>
                      ) : isSessionCard || isUtility ? (
                        /* Bundled tools are permanent (v1.3.2); the live
                       session's project is closed through Close — both
                       keep the spacer, no ✕. */
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
                          className="pnds-project-remove pnds-focus-ring w-5 shrink-0 text-(--pnds-text-secondary) opacity-0 transition hover:text-(--pnds-text) active:scale-90 focus-visible:opacity-100 group-hover:opacity-100"
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
                    <FolderOpen
                      size={26}
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />
                  </ListEmptyState>
                )}

                {/* v1.2.2 (issue #29): the import entry lives at the column's
              end — "add to the list" belongs to the list. The end padding
              keeps it clear of the fade band at full scroll; with no
              projects it follows the empty state. The fixed Utilities view
              is the one exception (user feedback): its members are bundled
              tools, not imports. Under Brutal the button keeps its solid
              look (card color, black border, hard shadow, pressed 1px into
              the shadow) here at the tail. */}
                {!activeFolderIsProtected &&
                  renderImportButton(
                    cn(
                      'pnds-focus-ring mx-auto mt-1.5 mb-1 flex shrink-0 items-center gap-1.5 rounded-[9px] px-[18px] py-1.5 text-xs transition disabled:opacity-50',
                      brutal
                        ? 'border border-(--pnds-text) bg-(--pnds-card) text-(--pnds-text) shadow-(--pnds-card-shadow) hover:bg-(--pnds-accent) hover:text-(--pnds-accent-foreground) active:translate-x-[1px] active:translate-y-[1px]'
                        : 'bg-(--pnds-text)/5 text-(--pnds-text-secondary) hover:bg-(--pnds-text)/10 hover:text-(--pnds-text) active:scale-[0.98]'
                    )
                  )}
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent
            className="pnds-action-menu performance-surface-popover"
            onCloseAutoFocus={event => {
              const action = menuAction.current
              menuAction.current = null
              if (action) {
                event.preventDefault()
                action()
              }
            }}
          >
            <ContextMenuGroup aria-labelledby={projectActionsId}>
              <ContextMenuLabel id={projectActionsId}>
                {t('desktop.menu.projectActions')}
              </ContextMenuLabel>
              <ContextMenuItem
                disabled={!canOpenMenuProject}
                icon={<Play />}
                description={t(
                  menuTargetSelected
                    ? 'desktop.menu.openProjectDescription'
                    : 'desktop.menu.selectProjectReason'
                )}
                shortcut="⌘⌥↵"
                aria-keyshortcuts="Meta+Alt+Enter"
                onSelect={() => {
                  menuAction.current = () => {
                    if (menuPath) void loadPerformanceProject(menuPath)
                  }
                }}
              >
                {t('desktop.openProject')}
              </ContextMenuItem>
              <ContextMenuItem
                disabled={!canCreateMenuProject}
                icon={<SquarePen />}
                description={t(
                  menuPath && utilityPaths.includes(menuPath)
                    ? 'desktop.menu.utilityProtectedReason'
                    : 'desktop.menu.startCreationDescription'
                )}
                onSelect={() => {
                  menuAction.current = () => {
                    if (menuPath) void beginCreation(menuPath)
                  }
                }}
              >
                {t('desktop.startCreation')}
              </ContextMenuItem>
              <ContextMenuItem
                disabled={
                  !menuTargetSelected ||
                  utilityPaths.includes(menuPath) ||
                  (menuPath === sessionProjectPath && sessionLive)
                }
                icon={<Pencil />}
                description={
                  projectMenuReason ??
                  t('desktop.menu.renameProjectDescription')
                }
                onSelect={() => {
                  menuAction.current = () => {
                    if (menuPath)
                      useProjectStore.getState().setRenameTarget({
                        kind: 'project',
                        path: menuPath,
                      })
                  }
                }}
              >
                {t('creation.rename')}
              </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup aria-labelledby={projectRemovalId}>
              <ContextMenuLabel id={projectRemovalId}>
                {t('desktop.menu.projectRemoval')}
              </ContextMenuLabel>
              <ContextMenuItem
                variant="destructive"
                disabled={
                  !menuTargetSelected ||
                  utilityPaths.includes(menuPath) ||
                  (menuPath === sessionProjectPath && sessionLive)
                }
                icon={<Trash2 />}
                description={
                  projectMenuReason ??
                  t('desktop.menu.removeProjectDescription')
                }
                onSelect={() => {
                  if (menuPath) handleRemove(menuPath)
                }}
              >
                {t('desktop.removeProject')}
              </ContextMenuItem>
            </ContextMenuGroup>
          </ContextMenuContent>
        </ContextMenu>
      </nav>

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
            className="performance-project-ghost pointer-events-none fixed top-0 left-0 z-50 flex items-center rounded-[10px] border border-(--pnds-project-selection-border) bg-(--pnds-project-selection) ps-4 pe-2.5 opacity-75 shadow-(--pnds-project-selection-shadow)"
            style={{
              width: dragGhost.width,
              height: dragGhost.height,
              transform: `translate(${dragGhost.x}px, ${dragGhost.y}px)`,
            }}
          >
            <span
              data-testid="drag-project-order-number"
              className="desktop-project-index"
              dir="ltr"
              aria-hidden="true"
            >
              {dragOrdinal > 0 ? String(dragOrdinal).padStart(2, '0') : ''}
            </span>
            <span className="desktop-project-title flex-1 truncate text-(--pnds-project-selection-foreground)">
              {cardName(drag.path)}
            </span>
            <span className="w-5 shrink-0" />
          </div>,
          document.body
        )}
    </aside>
  )
}
