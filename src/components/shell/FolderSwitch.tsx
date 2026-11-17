import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  FolderPlus,
  Package,
  Trash2,
} from 'lucide-react'
import i18n from '@/i18n/config'
import {
  isProtectedFolder,
  UTILITIES_FOLDER_ID,
  useProjectStore,
} from '@/store/project-store'
import { isSessionLive, useSessionStore } from '@/store/session-store'
import { notifications } from '@/lib/notifications'
import { setActiveFolderView } from '@/lib/project-select'
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
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { InlineNameInput } from './InlineNameInput'
import type { DragSource } from './sidebar-drag-adapter'
import './folder-stepper.css'

export interface FolderSwitchProps {
  dragController: CardDragController<DragSource>
  onPopupOpenChange?: (open: boolean) => void
  onDialogOpenChange?: (open: boolean) => void
  panelId?: string
}

const HOME = '__home__'
/** Manual folder tabs share the existing browse, management and drag boundaries. */
export function FolderSwitch({
  dragController,
  onPopupOpenChange,
  onDialogOpenChange,
  panelId,
}: FolderSwitchProps) {
  const { t } = useTranslation()
  const rtl = i18n.dir(i18n.language) === 'rtl'
  const folderActionsId = useId()
  const folderOrderId = useId()
  const folderRemovalId = useId()
  const projectFolders = useProjectStore(state => state.projectFolders)
  const activeFolderId = useProjectStore(state => state.activeFolderId)
  const sessionProjectPath = useSessionStore(state => state.sessionProjectPath)
  const sessionLive = isSessionLive(
    useSessionStore(state => state.sessionStatus)
  )
  const userFolders = projectFolders.filter(
    folder => !isProtectedFolder(folder.id)
  )
  const tabs = [
    { id: HOME, label: t('sidebar.unfiled'), inUse: false },
    ...userFolders.map(folder => ({
      id: folder.id,
      label: folderDisplayName(folder),
      inUse:
        sessionLive &&
        sessionProjectPath !== null &&
        folder.projectPaths.includes(sessionProjectPath),
    })),
    {
      id: UTILITIES_FOLDER_ID,
      label: t('sidebar.utilitiesFolder'),
      inUse:
        sessionLive &&
        sessionProjectPath !== null &&
        !!projectFolders
          .find(folder => folder.id === UTILITIES_FOLDER_ID)
          ?.projectPaths.includes(sessionProjectPath),
    },
  ]
  const selectedId = tabs.some(tab => tab.id === activeFolderId)
    ? (activeFolderId as string)
    : HOME
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const previousSelected = useRef(selectedId)
  const lastFocusedTab = useRef<HTMLButtonElement | null>(null)
  const menuTrigger = useRef<HTMLButtonElement | null>(null)
  const menuInteractedOutside = useRef(false)
  const inUseId = useId()
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
  const editFolder = projectFolders.find(
    folder => folder.id === editingFolderId
  )
  const pendingMenuActionRef = useRef<(() => void) | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuBottomPadding, setMenuBottomPadding] = useState(8)
  useEffect(() => {
    onPopupOpenChange?.(menuOpen)
  }, [menuOpen, onPopupOpenChange])
  useEffect(() => {
    onDialogOpenChange?.(pendingDeleteFolderId !== null)
  }, [pendingDeleteFolderId, onDialogOpenChange])
  useLayoutEffect(() => {
    const previous = previousSelected.current
    previousSelected.current = selectedId
    if (previous !== selectedId)
      for (const [id, tab] of tabRefs.current) {
        if (id === selectedId) tab.dataset.liquid = 'enter'
        else if (id === previous) tab.dataset.liquid = 'exit'
        else delete tab.dataset.liquid
      }
    const selected = tabRefs.current.get(selectedId)
    selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const hasTabFocus = [...tabRefs.current.values()].some(
      tab => tab === document.activeElement
    )
    if (
      (previous !== selectedId && hasTabFocus) ||
      (lastFocusedTab.current && !lastFocusedTab.current.isConnected)
    )
      selected?.focus({ preventScroll: true })
  }, [selectedId, editingFolderId, projectFolders])

  const handleNewFolder = () => {
    const id = useProjectStore
      .getState()
      .createFolder(t('sidebar.folderDefaultName'))
    setEditingFolderId(id)
    useProjectStore.getState().setRenameTarget({ kind: 'folder', id })
  }
  const commitFolderName = (rawName: string) => {
    if (!editingFolderId) return
    const name = rawName.trim()
    const store = useProjectStore.getState()
    if (name && !store.renameFolder(editingFolderId, name))
      notifications.warning(i18n.t('sidebar.folderNameTaken', { name }))
    setActiveFolderView(editingFolderId)
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
    if (open) menuInteractedOutside.current = false
    if (!open) setMenuFolderId(null)
  }
  const handleMenuCloseAutoFocus = (event: Event) => {
    const action = pendingMenuActionRef.current
    pendingMenuActionRef.current = null
    if (action) {
      event.preventDefault()
      action()
    } else if (!menuInteractedOutside.current) {
      event.preventDefault()
      const target = menuTrigger.current?.isConnected
        ? menuTrigger.current
        : tabRefs.current.get(selectedId)
      target?.focus({ preventScroll: true })
    }
  }
  const selectFolder = (id: string) => {
    const target = id === HOME ? null : id
    if (useProjectStore.getState().activeFolderId === target) return
    setActiveFolderView(target)
  }
  const rememberMenuTarget = (
    target: EventTarget,
    viewport: HTMLDivElement
  ) => {
    const tab =
      target instanceof Element
        ? target.closest<HTMLButtonElement>('[data-folder-id]')
        : null
    menuTrigger.current = tab ?? tabRefs.current.get(selectedId) ?? null
    const id = menuTrigger.current?.dataset.folderId ?? selectedId
    setMenuFolderId(id === HOME ? null : id)
    // Keep the whole menu above the bottom selector, including the desktop bar.
    setMenuBottomPadding(
      Math.max(8, window.innerHeight - viewport.getBoundingClientRect().top + 8)
    )
  }

  return (
    <div
      data-testid="folder-switch"
      className="folder-switch flex shrink-0 justify-center"
    >
      <ContextMenu
        dir={i18n.dir(i18n.language)}
        onOpenChange={handleMenuOpenChange}
      >
        <ContextMenuTrigger asChild>
          <div
            className="folder-stepper-viewport"
            onContextMenuCapture={event =>
              rememberMenuTarget(event.target, event.currentTarget)
            }
            onPointerDownCapture={event => {
              if (event.pointerType !== 'mouse' || event.button === 2)
                rememberMenuTarget(event.target, event.currentTarget)
            }}
          >
            {editFolder ? (
              <InlineNameInput
                key={editFolder.id}
                testId="folder-name-input"
                value={editFolder.name}
                className="performance-folder-name pnds-focus-ring h-8 w-full rounded-lg border border-(--pnds-input) bg-(--pnds-pill) px-2.5 text-start text-[13px] outline-none"
                onCommit={commitFolderName}
                onCancel={cancelFolderName}
              />
            ) : (
              <div
                role="tablist"
                aria-label={t('sidebar.performanceFolder')}
                aria-orientation="horizontal"
                className="folder-stepper"
                dir={i18n.dir(i18n.language)}
                style={{ '--folder-count': tabs.length } as CSSProperties}
                onKeyDown={event => {
                  if (event.metaKey || event.ctrlKey || event.altKey) return
                  const current = event.target as HTMLButtonElement
                  const index = tabs.findIndex(
                    tab => tab.id === current.dataset.folderId
                  )
                  if (index < 0) return
                  if (
                    event.key === 'ContextMenu' ||
                    (event.key === 'F10' && event.shiftKey)
                  ) {
                    event.preventDefault()
                    event.stopPropagation()
                    const rect = current.getBoundingClientRect()
                    current.dispatchEvent(
                      new MouseEvent('contextmenu', {
                        bubbles: true,
                        cancelable: true,
                        clientX: rect.left + rect.width / 2,
                        clientY: rect.top,
                      })
                    )
                  } else if (
                    ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                      event.key
                    )
                  ) {
                    event.preventDefault()
                    event.stopPropagation()
                  } else if (
                    ['Enter', ' ', 'ArrowUp', 'ArrowDown'].includes(event.key)
                  ) {
                    event.stopPropagation()
                    if (event.key === 'ArrowUp' || event.key === 'ArrowDown')
                      event.preventDefault()
                  }
                }}
              >
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    ref={node => {
                      if (node) tabRefs.current.set(tab.id, node)
                      else tabRefs.current.delete(tab.id)
                    }}
                    type="button"
                    role="tab"
                    className="folder-step"
                    data-folder-id={tab.id}
                    aria-label={tab.label}
                    title={[
                      tab.label,
                      ...(tab.inUse ? [t('sidebar.folderInUse')] : []),
                      t('sidebar.folderSwitchManageHint'),
                    ].join('\n')}
                    aria-selected={tab.id === selectedId}
                    aria-controls={panelId}
                    aria-describedby={
                      tab.inUse ? `${inUseId}-${tab.id}` : undefined
                    }
                    tabIndex={tab.id === selectedId ? 0 : -1}
                    onClick={() => selectFolder(tab.id)}
                    onFocus={event => {
                      lastFocusedTab.current = event.currentTarget
                      event.currentTarget.scrollIntoView({
                        block: 'nearest',
                        inline: 'nearest',
                      })
                    }}
                    onTransitionEnd={event => {
                      if (
                        event.propertyName === 'width' &&
                        tab.id === selectedId
                      )
                        event.currentTarget.scrollIntoView({
                          block: 'nearest',
                          inline: 'nearest',
                        })
                    }}
                  >
                    {tab.inUse && (
                      <span
                        id={`${inUseId}-${tab.id}`}
                        data-testid="folder-in-use-dot"
                        className="sr-only"
                      >
                        {t('sidebar.folderInUse')}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          className="pnds-action-menu performance-surface-popover"
          data-testid="folder-context-menu"
          sticky="always"
          collisionPadding={{
            top: 8,
            right: 8,
            bottom: menuBottomPadding,
            left: 8,
          }}
          onCloseAutoFocus={handleMenuCloseAutoFocus}
          onInteractOutside={() => {
            menuInteractedOutside.current = true
          }}
        >
          <ContextMenuGroup aria-labelledby={folderActionsId}>
            <ContextMenuLabel id={folderActionsId}>
              {t('sidebar.menu.folderActions')}
            </ContextMenuLabel>
            <ContextMenuItem
              data-testid="menu-new-folder"
              icon={<FolderPlus />}
              description={t('sidebar.menu.newFolderDescription')}
              onSelect={() => {
                pendingMenuActionRef.current = handleNewFolder
              }}
            >
              {t('sidebar.newFolder')}
            </ContextMenuItem>
            {menuFolder && (
              <>
                {/* v1.4.0 (#59): setlist export — the folder becomes a
                  copyable directory (.pnds 组 + set.json + README).
                  Empty folders and the protected Utilities folder
                  disable with the reason, like every gated item. */}
                <ContextMenuItem
                  data-testid="menu-export-setlist"
                  disabled={
                    menuFolderProtected || menuFolder.projectPaths.length === 0
                  }
                  icon={<Package />}
                  description={t(
                    menuFolderProtected
                      ? 'sidebar.setlistExportProtectedReason'
                      : menuFolder.projectPaths.length === 0
                        ? 'sidebar.setlistExportEmptyReason'
                        : 'sidebar.menu.exportFolderDescription'
                  )}
                  onSelect={() => {
                    pendingMenuActionRef.current = () => {
                      void exportSetlistFolder(menuFolder.id)
                    }
                  }}
                >
                  {t('sidebar.exportSetlistFolder')}
                </ContextMenuItem>
              </>
            )}
          </ContextMenuGroup>
          {menuFolder && (
            <>
              {!menuFolderProtected && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuGroup aria-labelledby={folderOrderId}>
                    <ContextMenuLabel id={folderOrderId}>
                      {t('sidebar.menu.folderOrder')}
                    </ContextMenuLabel>
                    {([-1, 1] as const).map(direction => {
                      const step = rtl ? (direction === -1 ? 1 : -1) : direction
                      return (
                        <ContextMenuItem
                          key={direction}
                          icon={direction < 0 ? <ArrowLeft /> : <ArrowRight />}
                          disabled={
                            step < 0
                              ? menuFolderIndex === 0
                              : menuFolderIndex === userFolders.length - 1
                          }
                          onSelect={() => {
                            pendingMenuActionRef.current = () =>
                              moveFolder(step)
                          }}
                        >
                          {t(
                            direction < 0
                              ? 'sidebar.moveFolderLeft'
                              : 'sidebar.moveFolderRight'
                          )}
                        </ContextMenuItem>
                      )
                    })}
                  </ContextMenuGroup>
                </>
              )}
              <ContextMenuSeparator />
              <ContextMenuGroup aria-labelledby={folderRemovalId}>
                <ContextMenuLabel id={folderRemovalId}>
                  {t('sidebar.menu.folderRemoval')}
                </ContextMenuLabel>
                <ContextMenuItem
                  data-testid="menu-delete-folder"
                  variant="destructive"
                  disabled={menuFolderProtected}
                  icon={<Trash2 />}
                  description={t(
                    menuFolderProtected
                      ? 'sidebar.utilitiesProtected'
                      : 'sidebar.menu.deleteFolderDescription'
                  )}
                  onSelect={() => {
                    pendingMenuActionRef.current = () =>
                      setPendingDeleteFolderId(menuFolder.id)
                  }}
                >
                  {t('sidebar.deleteFolder')}
                </ContextMenuItem>
              </ContextMenuGroup>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      {dragController.drag?.kind === 'project' && (
        <div
          data-testid="folder-drop-choices"
          data-folder-drop-choices=""
          data-native-overlay=""
          aria-label={t('sidebar.moveToFolder')}
          className="desktop-folder-drop-panel overflow-y-auto rounded-lg border border-(--pnds-border) bg-(--pnds-sidebar-bg) p-1 shadow-lg"
        >
          <div
            data-unfiled-drop=""
            data-drop-active={
              dragController.dropTarget?.kind === 'breadcrumb' &&
              activeFolderId !== null
                ? 'true'
                : undefined
            }
            className="rounded-md px-2.5 py-2 text-[13px] data-[drop-active=true]:bg-(--pnds-selection)"
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
              className="truncate rounded-md px-2.5 py-2 text-[13px] data-[drop-active=true]:bg-(--pnds-selection)"
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
        <AlertDialogContent
          onCloseAutoFocus={event => {
            event.preventDefault()
            const selected = useProjectStore.getState().activeFolderId ?? HOME
            const target = menuTrigger.current?.isConnected
              ? menuTrigger.current
              : (tabRefs.current.get(selected) ?? tabRefs.current.get(HOME))
            target?.focus({ preventScroll: true })
          }}
        >
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
