import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  X,
  Share,
  RefreshCw,
  Command,
  Music,
  FolderOpen,
  AlertCircle,
} from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
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
  isSessionRunning,
  sessionConnectionAddress,
  useSessionStore,
} from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { notifications } from '@/lib/notifications'
import { promptOpenProject, stopAndReset } from '@/lib/open-project'
import { Spinner } from '@/components/ui/spinner'
import { selectProject } from '@/lib/project-select'
import { reclaimIfManagedBundle } from '@/lib/bundle-project'
import { revealScrollTarget } from '@/lib/list-reveal'
import { folderDisplayName, projectDisplayName } from '@/lib/display-names'
import { builtinUtilityId } from '@/lib/builtin-utilities'
import { utilityCardIcon } from './utility-icons'
import { cardShift, insertionIndexFor, reorderedList } from '@/lib/drag-reorder'
import { useCardDrag, type ActiveDropTarget } from '@/hooks/use-card-drag'
import { useIndicatorPill } from '@/hooks/use-indicator-pill'
import { applyCardSelectionPill, CARD_SELECTOR } from '@/lib/selection-pills'
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
import { FolderSwitch } from './FolderSwitch'
import { InlineNameInput } from './InlineNameInput'
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
 * (remove from history) appears on every card except the live session's
 * project and the bundled tools (user report after #63: a merely selected
 * or broken project must always be removable). v1.2.3 (#39): selecting
 * while a session runs is free
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
 * tabindex, accent focus ring (bare ←/→ switching removed in v1.3.5
 * #104 — ⌘←/⌘→ is the keyboard path). The project cards
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
  // v1.2.3 (#39/T4): Share targets the SESSION's address (snapshot
  // mirror) — another card's preflight seeding must never retarget the
  // live link. v1.4.0 (#62): the session's `hostAddress` comes first — a
  // manifest-declared performer address replaces the IP, keeping the
  // shared URL identical to the monitor's actual origin.
  const hostAddress = useSessionStore(sessionConnectionAddress)
  const monitorPort = useSessionStore(
    state => state.health?.scoreServer?.monitorPort
  )
  const busy = isSessionBusy(sessionStatus)
  const running = isSessionRunning(sessionStatus)
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
    activeFolder !== null && isProtectedFolder(activeFolder.id)

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

  /** Share: open the monitor page in the default external browser. */
  const handleShare = async () => {
    if (!running || !hostAddress || !monitorPort) return
    await openUrl(`http://${hostAddress}:${monitorPort}/`)
  }

  /** v1.1.2 T7: the lone-Esc close confirmation's submit — same teardown
   * as the Close button / ⌘Esc, just behind an explicit OK. */
  const confirmCloseProject = async () => {
    useProjectStore.getState().setConfirmCloseProjectOpen(false)
    await stopAndReset()
  }

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
          container.scrollTo({ top: target, behavior: 'smooth' })
        }
        return
      }
    }
  }, [selectedPath, activeFolderId])

  // Report dialog visibility so the hover sidebar keeps peeking while a
  // confirm flow is open (spec issue #4: 确认框期间松开 Cmd 不收回). The
  // folder-delete confirm (FolderSwitch) reports its own visibility up;
  // this is the one place the two dialogs merge.
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const dialogOpen = folderDialogOpen || confirmCloseProjectOpen
  useEffect(() => {
    onDialogOpenChange?.(dialogOpen)
  }, [dialogOpen, onDialogOpenChange])

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
            disabled={!running || !hostAddress || !monitorPort}
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
        {/* v1.2.1 (folder switch): the segmented control above the project
            column — segments, sliding pill, context-menu CRUD and the
            delete confirm — lives in FolderSwitch; the sidebar hands it
            the one drag machine both drop sections share. */}
        <FolderSwitch
          dragController={dragController}
          onPopupOpenChange={onPopupOpenChange}
          onDialogOpenChange={setFolderDialogOpen}
        />

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
                    beginCardDrag({ kind: 'project', path }, e, CARD_SELECTOR)
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
                      whole card is the drag trigger (v1.1.2 T5). v1.2.3
                      (#39) the failed preflight verdict lives HERE (user
                      report after #63): the persistent error icon used to
                      occupy the right slot and thereby hide the ✕ — a
                      broken project (e.g. dependencies missing) could not
                      be removed at all. v1.3.3 (#85): a bundled tool's
                      slot carries its icon — the badge's subdued tone,
                      never a focus target. The glyph rides 1px above the
                      row's geometric center: the 15px title's optical
                      axis (its lowercase mass) sits that far up, a
                      dead-center icon reads low against it. */}
                  {preflightError ? (
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
                  ) : UtilityIcon ? (
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
                  in-flight preflight spinner (v1.2.3 #39), else ✕ remove
                  from history. User report after #63: the ✕ is offered on
                  EVERY card except the session's live one (正在演出的那张
                  — removing the performing project is what Close is for)
                  and the bundled tools (app content, v1.3.2) — a merely
                  selected or broken project must always be removable. */}
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
    </aside>
  )
}
