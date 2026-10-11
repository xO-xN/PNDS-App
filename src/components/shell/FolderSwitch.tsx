import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  FolderPlus,
  Package,
  Pencil,
  Trash2,
  Wrench,
} from 'lucide-react'
import i18n from '@/i18n/config'
import {
  isProtectedFolder,
  previousUserFolderId,
  useProjectStore,
} from '@/store/project-store'
import { isSessionLive, useSessionStore } from '@/store/session-store'
import { notifications } from '@/lib/notifications'
import { setActiveFolderView, toggleUtilitiesView } from '@/lib/project-select'
import { startFolderRename } from '@/lib/project-rename'
import { exportSetlistFolder } from '@/lib/setlist-export'
import { folderDisplayName } from '@/lib/display-names'
import type { CardDragController } from '@/hooks/use-card-drag'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { InlineNameInput } from './InlineNameInput'
import type { DragSource } from './sidebar-drag-adapter'
import { cn } from '@/lib/utils'

export interface FolderSwitchProps {
  dragController: CardDragController<DragSource>
  onPopupOpenChange?: (open: boolean) => void
  onDialogOpenChange?: (open: boolean) => void
}

const HOME = '__home__'
const NEW_FOLDER = '__new__'

/** User folder browsing and the independent, session-only Utilities detour. */
export function FolderSwitch({
  dragController,
  onPopupOpenChange,
  onDialogOpenChange,
}: FolderSwitchProps) {
  const { t } = useTranslation()
  const projectFolders = useProjectStore(state => state.projectFolders)
  const activeFolderId = useProjectStore(state => state.activeFolderId)
  const lastUserFolderId = useProjectStore(state => state.lastUserFolderId)
  const renameTarget = useProjectStore(state => state.renameTarget)
  const sessionProjectPath = useSessionStore(state => state.sessionProjectPath)
  const sessionLive = isSessionLive(
    useSessionStore(state => state.sessionStatus)
  )
  const userFolders = projectFolders.filter(
    folder => !isProtectedFolder(folder.id)
  )
  const activeFolder = projectFolders.find(
    folder => folder.id === activeFolderId
  )
  const toolsActive =
    activeFolderId !== null && isProtectedFolder(activeFolderId)
  const returnId = previousUserFolderId(projectFolders, lastUserFolderId)
  const returnFolder = userFolders.find(folder => folder.id === returnId)
  const returnName = returnFolder
    ? folderDisplayName(returnFolder)
    : t('sidebar.unfiled')
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [pendingDeleteFolderId, setPendingDeleteFolderId] = useState<
    string | null
  >(null)
  const pendingDeleteFolder = projectFolders.find(
    folder => folder.id === pendingDeleteFolderId
  )
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null)
  const menuFolder = projectFolders.find(folder => folder.id === menuFolderId)
  const menuFolderProtected =
    menuFolder !== undefined && isProtectedFolder(menuFolder.id)
  const menuFolderIndex = userFolders.findIndex(
    folder => folder.id === menuFolderId
  )
  const editId =
    editingFolderId ??
    (renameTarget?.kind === 'folder' ? renameTarget.id : null)
  const editFolder = projectFolders.find(folder => folder.id === editId)
  const pendingMenuActionRef = useRef<(() => void) | null>(null)
  const pendingSelectAction = useRef<(() => void) | null>(null)
  const [selectOpen, setSelectOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    onPopupOpenChange?.(selectOpen || menuOpen)
  }, [selectOpen, menuOpen, onPopupOpenChange])
  useEffect(() => {
    onDialogOpenChange?.(pendingDeleteFolderId !== null)
  }, [pendingDeleteFolderId, onDialogOpenChange])

  const handleNewFolder = () => {
    const id = useProjectStore
      .getState()
      .createFolder(t('sidebar.folderDefaultName'))
    setEditingFolderId(id)
    useProjectStore.getState().setRenameTarget({ kind: 'folder', id })
  }
  const commitFolderName = (rawName: string) => {
    if (!editId) return
    const name = rawName.trim()
    const store = useProjectStore.getState()
    if (name && !store.renameFolder(editId, name))
      notifications.warning(i18n.t('sidebar.folderNameTaken', { name }))
    if (editingFolderId !== null) setActiveFolderView(editId)
    setEditingFolderId(null)
    store.setRenameTarget(null)
  }
  const cancelFolderName = () => {
    const store = useProjectStore.getState()
    store.setRenameTarget(null)
    if (editingFolderId !== null && editFolder?.projectPaths.length === 0)
      store.deleteFolder(editingFolderId)
    setEditingFolderId(null)
  }
  const confirmDeleteFolder = () => {
    if (pendingDeleteFolderId !== null)
      useProjectStore.getState().deleteFolder(pendingDeleteFolderId)
    setPendingDeleteFolderId(null)
  }
  const moveFolder = (direction: -1 | 1) => {
    if (!menuFolder || menuFolderProtected) return
    const store = useProjectStore.getState()
    const ids = store.projectFolders.map(folder => folder.id)
    const from = ids.indexOf(menuFolder.id)
    const target = ids[from + direction]
    if (!target || isProtectedFolder(target)) return
    ids[from] = target
    ids[from + direction] = menuFolder.id
    store.applyFolderReorder(ids)
  }
  const handleMenuOpenChange = (open: boolean) => {
    setMenuOpen(open)
    if (!open) setMenuFolderId(null)
  }
  const handleMenuCloseAutoFocus = (event: Event) => {
    const action = pendingMenuActionRef.current
    pendingMenuActionRef.current = null
    if (!action) return
    event.preventDefault()
    action()
  }
  const selectedInUse =
    sessionLive &&
    sessionProjectPath !== null &&
    activeFolder?.projectPaths.includes(sessionProjectPath)

  return (
    <div
      data-testid="folder-switch"
      className="relative mx-5 mb-2 flex shrink-0 items-center gap-2"
    >
      <ContextMenu
        dir={i18n.dir() === 'rtl' ? 'rtl' : 'ltr'}
        onOpenChange={handleMenuOpenChange}
      >
        <ContextMenuTrigger asChild>
          <div
            className="min-w-0 flex-1"
            onContextMenu={() => setMenuFolderId(activeFolderId)}
          >
            {editFolder ? (
              <InlineNameInput
                key={editFolder.id}
                testId="folder-name-input"
                value={editFolder.name}
                className="pnds-focus-ring h-8 w-full rounded-lg border border-(--pnds-text)/15 bg-(--pnds-text)/5 px-2.5 text-start text-[13px] outline-none"
                onCommit={commitFolderName}
                onCancel={cancelFolderName}
              />
            ) : toolsActive ? (
              <button
                type="button"
                data-testid="folder-return"
                onClick={() => setActiveFolderView(returnId)}
                aria-label={t('sidebar.returnToFolder', { name: returnName })}
                className="pnds-focus-ring flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-start text-[13px] hover:bg-(--pnds-text)/5"
              >
                <ArrowLeft
                  size={14}
                  className="shrink-0 rtl:rotate-180"
                  aria-hidden="true"
                />
                <span className="truncate">
                  {t('sidebar.returnToFolder', { name: returnName })}
                </span>
              </button>
            ) : (
              <Select
                dir={i18n.dir() === 'rtl' ? 'rtl' : 'ltr'}
                value={activeFolderId ?? HOME}
                onOpenChange={setSelectOpen}
                onValueChange={value => {
                  if (value === NEW_FOLDER)
                    pendingSelectAction.current = handleNewFolder
                  else setActiveFolderView(value === HOME ? null : value)
                }}
              >
                <SelectTrigger
                  size="sm"
                  data-testid="folder-picker"
                  aria-label={t('sidebar.performanceFolder')}
                  title={t('sidebar.folderSwitchManageHint')}
                  className="pnds-focus-ring h-8 w-full active:bg-(--pnds-text)/10 border-0 bg-(--pnds-text)/5 ps-2.5 pe-2 text-[13px] shadow-none [&_.lucide-chevron-up]:rotate-180"
                >
                  {selectedInUse && (
                    <span
                      data-testid="folder-in-use-dot"
                      aria-label={t('sidebar.folderInUse')}
                      className="size-1.5 shrink-0 rounded-full bg-(--pnds-accent)"
                    />
                  )}
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  side="bottom"
                  className="max-h-[min(16rem,var(--radix-select-content-available-height))]"
                  onCloseAutoFocus={event => {
                    const action = pendingSelectAction.current
                    pendingSelectAction.current = null
                    if (action) {
                      event.preventDefault()
                      action()
                    }
                  }}
                >
                  <SelectItem value={HOME}>{t('sidebar.unfiled')}</SelectItem>
                  {userFolders.map(folder => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folderDisplayName(folder)}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_FOLDER}>
                    <FolderPlus size={14} />
                    {t('sidebar.newFolder')}
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          data-testid="folder-context-menu"
          onCloseAutoFocus={handleMenuCloseAutoFocus}
        >
          <ContextMenuItem
            data-testid="menu-new-folder"
            onSelect={() => {
              pendingMenuActionRef.current = handleNewFolder
            }}
          >
            <div className="flex w-full flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <FolderPlus />
                {t('sidebar.newFolder')}
              </span>
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
                    <span className="ps-6 text-xs leading-snug font-normal text-(--pnds-text)/45">
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
              {!menuFolderProtected &&
                ([-1, 1] as const).map(direction => (
                  <ContextMenuItem
                    key={direction}
                    disabled={
                      direction < 0
                        ? menuFolderIndex === 0
                        : menuFolderIndex === userFolders.length - 1
                    }
                    onSelect={() => {
                      pendingMenuActionRef.current = () => moveFolder(direction)
                    }}
                  >
                    {direction < 0 ? <ArrowUp /> : <ArrowDown />}
                    {t(
                      direction < 0
                        ? 'sidebar.moveFolderUp'
                        : 'sidebar.moveFolderDown'
                    )}
                  </ContextMenuItem>
                ))}
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
                    <span className="ps-6 text-xs leading-snug font-normal text-(--pnds-text)/45">
                      {t('sidebar.utilitiesProtected')}
                    </span>
                  )}
                </div>
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <button
        type="button"
        aria-label={t('sidebar.utilitiesFolder')}
        aria-pressed={toolsActive}
        onClick={toggleUtilitiesView}
        className={cn(
          'pnds-focus-ring flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] transition-colors active:bg-(--pnds-text)/10',
          toolsActive
            ? 'bg-(--pnds-card) text-(--pnds-text) shadow-sm'
            : 'text-(--pnds-text)/75 hover:bg-(--pnds-text)/5'
        )}
      >
        <Wrench size={14} aria-hidden="true" />
        {t('sidebar.utilitiesFolder')}
      </button>
      {dragController.drag?.kind === 'project' && (
        <div
          data-testid="folder-drop-choices"
          data-folder-drop-choices=""
          aria-label={t('sidebar.moveToFolder')}
          className="absolute start-0 top-full z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-(--pnds-text)/10 bg-(--pnds-sidebar-bg) p-1 shadow-lg"
        >
          <div
            data-unfiled-drop=""
            data-drop-active={
              dragController.dropTarget?.kind === 'breadcrumb' &&
              activeFolderId !== null
                ? 'true'
                : undefined
            }
            className="rounded-md px-2.5 py-2 text-[13px] data-[drop-active=true]:bg-(--pnds-accent)/15"
          >
            {t('sidebar.unfiled')}
          </div>
          {userFolders.map(folder => (
            <div
              key={folder.id}
              data-folder-drop-id={folder.id}
              data-drop-active={
                dragController.dropTarget?.kind === 'folder' &&
                dragController.dropTarget.index ===
                  projectFolders.indexOf(folder)
                  ? 'true'
                  : undefined
              }
              className="truncate rounded-md px-2.5 py-2 text-[13px] data-[drop-active=true]:bg-(--pnds-accent)/15"
            >
              {folderDisplayName(folder)}
            </div>
          ))}
        </div>
      )}
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
