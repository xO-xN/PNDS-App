import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderPlus, Package, Pencil, Trash2 } from 'lucide-react'
import i18n from '@/i18n/config'
import {
  FOLDER_LIMIT,
  folderLimitReached,
  isProtectedFolder,
  useProjectStore,
} from '@/store/project-store'
import { isSessionLive, useSessionStore } from '@/store/session-store'
import { notifications } from '@/lib/notifications'
import { setActiveFolderView } from '@/lib/project-select'
import { startFolderRename } from '@/lib/project-rename'
import { exportSetlistFolder } from '@/lib/setlist-export'
import { folderDisplayName } from '@/lib/display-names'
import { cardShift, insertionIndexFor } from '@/lib/drag-reorder'
import { useIndicatorPill } from '@/hooks/use-indicator-pill'
import type { CardDragController } from '@/hooks/use-card-drag'
import { applyFolderPill } from '@/lib/selection-pills'
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
import { InlineNameInput } from './InlineNameInput'
import type { DragSource } from './sidebar-drag-adapter'
import { cn } from '@/lib/utils'

export interface FolderSwitchProps {
  /** The sidebar's drag machine (useCardDrag): the row is both a drag
   * source (folder segments reorder within the row) and a drop zone
   * (project joins, unfiled returns) of the same gesture the project
   * column serves, so the machine stays owned by the sidebar and is
   * handed down wholesale. */
  dragController: CardDragController<DragSource>
  /** Overlay mode: the folder context menu is a portal outside the
   * sidebar element — report it like the settings popups so the hover
   * sidebar must not auto-retract under it. */
  onPopupOpenChange?: (open: boolean) => void
  /** Reports the folder-delete confirmation dialog's visibility — the
   * sidebar ORs it with its own dialogs before reporting upward (the
   * hover sidebar must stay peeked while any confirm flow is open). */
  onDialogOpenChange?: (open: boolean) => void
}

/**
 * v1.2.1 (folder switch), extracted from the sidebar: folders are a
 * segmented control above the project column — the unfiled segment (the
 * default view) first, then one segment per folder, Utilities pinned
 * last. Selecting a segment switches the list. v1.2.2 (issue #28)
 * completes the control: the track spans the row, the segments share it
 * by content width, and a white pill slides under the active one
 * (applyFolderPill). Folder management (create / rename / delete) lives
 * in a right-click context menu — the menu disables at the folder cap
 * (#26) and for the protected Utilities folder, with the reasons spelled
 * out. Segments are tabs: roving tabindex, accent focus ring (bare ←/→
 * switching removed in v1.3.5 #104 — ⌘←/⌘→ is the keyboard path).
 *
 * Folder drag interactions (v1.1.2 T5, spec issue #9, carried over):
 * dropping a card on a folder segment files it into that folder's end,
 * dropping a member on the unfiled segment returns it to ungrouped, and
 * the segments reorder within the row by the same drag gesture.
 */
export function FolderSwitch({
  dragController,
  onPopupOpenChange,
  onDialogOpenChange,
}: FolderSwitchProps) {
  const { t } = useTranslation()
  const projectFolders = useProjectStore(state => state.projectFolders)
  const activeFolderId = useProjectStore(state => state.activeFolderId)
  const renameTarget = useProjectStore(state => state.renameTarget)
  // v1.2.3 (#39): the "in use" dot follows the SESSION's project —
  // selecting another card while one runs never moves it.
  const sessionProjectPath = useSessionStore(state => state.sessionProjectPath)
  // v1.1.2 T3: the folder card shows its "in use" dot from the moment the
  // session starts, not only once ready (spec issue #4: 使用中指示点).
  const sessionLive = isSessionLive(
    useSessionStore(state => state.sessionStatus)
  )
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

  const {
    drag,
    dropTarget,
    ghost: dragGhost,
    suppressTransition,
    press: beginCardDrag,
    consumeClick,
    clearClickSuppression,
  } = dragController

  const activeFolder =
    activeFolderId === null
      ? null
      : (projectFolders.find(folder => folder.id === activeFolderId) ?? null)
  const pendingDeleteFolder = projectFolders.find(
    folder => folder.id === pendingDeleteFolderId
  )
  // v1.2.1 (issue #26): the cap derivation stays store-driven — never a
  // local re-count. Since v1.2.2 (issue #28) the only creation entry is
  // the context menu, whose "New folder" item disables with the reason
  // spelled out beneath it.
  const foldersAtCap = folderLimitReached(projectFolders)
  // v1.2.2 (issue #28): the folder the context menu targets — its items
  // (rename / delete) and their disabled reasons derive from it.
  const menuFolder =
    menuFolderId === null
      ? null
      : (projectFolders.find(folder => folder.id === menuFolderId) ?? null)
  const menuFolderProtected =
    menuFolder !== null && isProtectedFolder(menuFolder.id)

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

  const confirmDeleteFolder = () => {
    const id = pendingDeleteFolderId
    setPendingDeleteFolderId(null)
    if (!id) return
    useProjectStore.getState().deleteFolder(id)
  }

  /**
   * v1.3.5 (#104 follow-up): a segment click must not park DOM focus on
   * the segment. The browser focuses it on mousedown, and while
   * `:focus-visible` hides the ring for the click itself, the first later
   * keypress reveals it — a frozen ring on a control whose arrow keys are
   * gone reads as a dead selection. Segments are divs, so a click always
   * comes from the pointer; dropping focus never touches a keyboard path
   * (Tab still stops on the active view, ⌘←/⌘→ live on the window layer).
   */
  const blurAfterSegmentClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.currentTarget.blur()
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

  // The delete-confirmation dialog's visibility, reported up so the hover
  // sidebar keeps peeking while the confirm flow is open (spec issue #4:
  // 确认框期间松开 Cmd 不收回) — the sidebar ORs it with its own dialogs.
  const folderDialogOpen = pendingDeleteFolderId !== null
  useEffect(() => {
    onDialogOpenChange?.(folderDialogOpen)
  }, [folderDialogOpen, onDialogOpenChange])

  // v1.1.2 T4/T5: drag geometry — a folder drag yields its siblings
  // exactly like a project drag, horizontally (spec issue #9: 文件夹卡在
  // 文件夹区内可拖拽排序), and a project drag highlights the hovered segment
  // as its drop zone.
  const dragFolderIndex =
    drag?.kind === 'folder'
      ? projectFolders.findIndex(folder => folder.id === drag.id)
      : -1
  const listDrop = dropTarget?.kind === 'list' ? dropTarget : null
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
  // Segment pitch fallback (never read without a live folder drag — ghost
  // measured it at activation); mirrors the card column's 61px fallback.
  const stride = dragGhost?.stride ?? 61
  // v1.2.2 (issue #28): the pill steps aside while the row is mid-flight —
  // a folder drag translates the segments (the active one may itself be
  // the invisible dragged clone) and the post-drop snap frame repositions
  // everything; the pill fades out for both and back in at its measured
  // spot once the row is at rest.
  const pillHidden = drag?.kind === 'folder' || suppressTransition

  return (
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
              onPointerDown={() => {
                // Every fresh press re-arms the click suppression a
                // finished drag left behind — the unfiled segment is not
                // a drag source, so its press has no other handler.
                clearClickSuppression()
              }}
              onClick={event => {
                if (consumeClick()) return
                setActiveFolderView(null)
                blurAfterSegmentClick(event)
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
                  onClick={event => {
                    if (isEditing) return
                    if (consumeClick()) return
                    setActiveFolderView(folder.id)
                    blurAfterSegmentClick(event)
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
              {/* v1.4.0 (#59): setlist export — the folder becomes a
                  copyable directory (.pnds 组 + set.json + README).
                  Empty folders and the protected Utilities folder
                  disable with the reason, like every gated item. */}
              <ContextMenuItem
                data-testid="menu-export-setlist"
                disabled={
                  menuFolderProtected || menuFolder.projectPaths.length === 0
                }
                onSelect={() => {
                  pendingMenuActionRef.current = () => {
                    void exportSetlistFolder(menuFolder.id)
                  }
                }}
              >
                <div className="flex w-full flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <Package />
                    {t('sidebar.exportSetlistFolder')}
                  </span>
                  {(menuFolderProtected ||
                    menuFolder.projectPaths.length === 0) && (
                    <span className="ps-6 text-xs leading-snug font-normal text-(--pnds-text)/45">
                      {menuFolderProtected
                        ? t('sidebar.setlistExportProtectedReason')
                        : t('sidebar.setlistExportEmptyReason')}
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
    </div>
  )
}
