import { CreationQuickOpen } from './CreationQuickOpen'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronRight,
  Folder,
  FileCode,
  FileText,
  Image,
  Volume2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  FolderOpen,
} from 'lucide-react'
import type { CreationError, CreationFile } from '@/lib/tauri-bindings'
import {
  creationFileTree,
  creationProjectFileRole,
} from '@/lib/creation-file-tree'
import { CreationFileLabel } from './CreationFileLabel'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationStore } from '@/store/creation-store'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { CreationNewFile } from './CreationNewFile'
import { CreationErrorNotice } from './CreationErrorNotice'

export function CreationFileTree({
  identity,
  files,
  directories,
  selected,
  dirtyPaths,
  conflictPaths,
  disabled,
  editable,
  onSelect,
  onDrag,
  onRefresh,
  onFinder,
  resources,
}: {
  identity: string
  files: CreationFile[]
  directories: string[]
  selected: string | null
  dirtyPaths: Set<string>
  conflictPaths: Set<string>
  disabled: boolean
  editable: boolean
  onSelect: (path: string) => void
  onDrag: (path: string) => Promise<void>
  onRefresh: () => Promise<void>
  onFinder: () => Promise<void>
  resources: ReactNode
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [quickOpenRequest, setQuickOpenRequest] = useState(0)
  const newTrigger = useRef<HTMLButtonElement>(null)
  const newAfterMenu = useRef<{
    kind: 'file' | 'directory'
    directory: string
  } | null>(null)
  const moreTrigger = useRef<HTMLButtonElement>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [focused, setFocused] = useState<string | null>(null)
  const [newEntry, setNewEntry] = useState<{
    kind: 'file' | 'directory'
    directory: string
  } | null>(null)
  const [rename, setRename] = useState<{ path: string; value: string } | null>(
    null
  )
  const [renaming, setRenaming] = useState(false)
  const [error, setError] = useState<CreationError | null>(null)
  const renameAfterMenu = useRef<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const tree = useRef<HTMLElement>(null)
  const renamePath = rename?.path
  useEffect(() => {
    const field = input.current
    if (renamePath && field) {
      field.focus()
      const dot = field.value.lastIndexOf('.')
      field.setSelectionRange(0, dot > 0 ? dot : field.value.length)
    }
  }, [renamePath])
  const [observedSelection, setObservedSelection] = useState(selected)
  if (observedSelection !== selected) {
    setObservedSelection(selected)
    setFocused(null)
    if (selected)
      setCollapsed(
        current =>
          new Set(
            [...current].filter(parent => !selected.startsWith(parent + '/'))
          )
      )
  }
  const rows = creationFileTree(files, directories, collapsed, search)
  const current = focused ?? selected
  const directory = current
    ? rows.find(row => row.path === current)?.file
      ? current.slice(0, Math.max(0, current.lastIndexOf('/')))
      : current
    : ''
  const startRename = (path: string) => {
    const draft = useCreationFilesStore.getState().drafts[path]
    if (
      disabled ||
      !editable ||
      path === 'manifest.json' ||
      draft?.saving ||
      draft?.renaming
    )
      return
    setError(null)
    setFocused(path)
    setRename({ path, value: path.split('/').at(-1) ?? path })
  }
  const finishRename = async () => {
    if (!rename || renaming || disabled) return
    const name = rename.value.trim()
    if (!name || /[/\\]/.test(name) || ['.', '..'].includes(name)) {
      setError({ code: 'pathEscape', detail: rename.value })
      return
    }
    const parent = rename.path.includes('/')
      ? rename.path.slice(0, rename.path.lastIndexOf('/') + 1)
      : ''
    const next = parent + name
    if (next === rename.path) {
      setRename(null)
      return
    }
    setRenaming(true)
    const failure = await useCreationFilesStore
      .getState()
      .rename(rename.path, next)
    if (useCreationStore.getState().workspace?.project.identity !== identity)
      return
    setRenaming(false)
    if (failure) setError(failure)
    else {
      setRename(null)
      setFocused(useCreationFilesStore.getState().activePath)
    }
  }
  return (
    <>
      <div className="creation-tree-heading">
        <strong>{t('creation.files')}</strong>
        {editable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="creation-icon-button pnds-focus-ring"
                disabled={disabled}
                ref={newTrigger}
                aria-label={t('creation.tree.new')}
                title={t('creation.tree.new')}
              >
                <Plus aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={event => {
                const entry = newAfterMenu.current
                if (entry) {
                  event.preventDefault()
                  newAfterMenu.current = null
                  setNewEntry(entry)
                }
              }}
            >
              <DropdownMenuItem
                onSelect={() => {
                  newAfterMenu.current = { kind: 'file', directory }
                }}
              >
                {t('creation.newFile.open')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  newAfterMenu.current = { kind: 'directory', directory }
                }}
              >
                {t('creation.tree.newDirectory')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {resources}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="creation-icon-button pnds-focus-ring"
              disabled={disabled}
              ref={moreTrigger}
              aria-label={t('creation.tree.more')}
            >
              <MoreHorizontal aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => setQuickOpenRequest(current => current + 1)}
            >
              {t('creation.editor.quickOpen')}
              <span className="ms-auto text-xs">⌘P</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void onRefresh()}>
              <RefreshCw aria-hidden="true" />
              {t('creation.tree.rescan')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void onFinder()}>
              <FolderOpen aria-hidden="true" />
              {t('creation.openFinder')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <CreationQuickOpen
        files={files}
        onOpen={onSelect}
        request={quickOpenRequest}
        hideTrigger
        disabled={disabled}
        returnFocus={() => moreTrigger.current?.focus()}
      />
      <Input
        className="creation-file-search"
        aria-label={t('creation.searchFiles')}
        placeholder={t('creation.searchFiles')}
        value={search}
        onChange={event => setSearch(event.target.value)}
      />
      {newEntry && (
        <CreationNewFile
          key={newEntry.kind + newEntry.directory}
          disabled={disabled}
          initiallyOpen
          kind={newEntry.kind}
          directory={newEntry.directory}
          onClose={() => {
            setNewEntry(null)
            newTrigger.current?.focus()
          }}
          onCreated={file => {
            setNewEntry(null)
            setSearch('')
            onSelect(file.path)
          }}
          onDirectoryCreated={path => {
            setNewEntry(null)
            setSearch('')
            setFocused(path)
            setCollapsed(
              current =>
                new Set(
                  [...current].filter(
                    parent => parent !== path && !path.startsWith(parent + '/')
                  )
                )
            )
          }}
        />
      )}
      <nav
        ref={tree}
        className="creation-tree"
        role="tree"
        aria-label={t('creation.files')}
        onKeyDown={event => {
          if (
            event.target instanceof HTMLInputElement ||
            event.nativeEvent.isComposing
          )
            return
          const elements = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role=treeitem]'
            ),
          ]
          const index = elements.indexOf(
            document.activeElement as HTMLButtonElement
          )
          const row = rows[index]
          if (event.key === 'F2' && row?.file) {
            event.preventDefault()
            startRename(row.path)
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const item =
              elements[
                Math.min(
                  elements.length - 1,
                  Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1))
                )
              ]
            item?.focus()
          } else if (
            (event.key === 'ArrowRight' || event.key === 'ArrowLeft') &&
            row &&
            !row.file
          ) {
            event.preventDefault()
            setCollapsed(current => {
              const next = new Set(current)
              if (event.key === 'ArrowLeft') next.add(row.path)
              else next.delete(row.path)
              return next
            })
          }
        }}
      >
        {rows.map(row => {
          const file = row.file
          const Icon = !file
            ? Folder
            : file.kind === 'image'
              ? Image
              : file.category === 'audio'
                ? Volume2
                : /\.(?:[cm]?js|[jt]sx?|scd|html|css)$/.test(row.path)
                  ? FileCode
                  : FileText
          return (
            <div key={row.path}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    hidden={rename?.path === row.path}
                    role="treeitem"
                    aria-level={row.depth + 1}
                    aria-label={row.path}
                    aria-expanded={
                      !file ? !collapsed.has(row.path) || !!search : undefined
                    }
                    aria-selected={current === row.path}
                    disabled={disabled}
                    title={row.path}
                    data-tree-path={row.path}
                    data-project-file={
                      file ? creationProjectFileRole(row.path) : undefined
                    }
                    className="creation-file-row creation-tree-row pnds-focus-ring"
                    style={{ paddingInlineStart: 10 + row.depth * 14 }}
                    draggable={!!file}
                    onDragStart={event => {
                      event.preventDefault()
                      if (file) void onDrag(row.path)
                    }}
                    onFocus={() => setFocused(row.path)}
                    onClick={() => {
                      if (file) onSelect(row.path)
                      else {
                        setFocused(row.path)
                        setCollapsed(current => {
                          const next = new Set(current)
                          if (next.has(row.path)) next.delete(row.path)
                          else next.add(row.path)
                          return next
                        })
                      }
                    }}
                    onContextMenu={() => setFocused(row.path)}
                  >
                    {!file && (
                      <ChevronRight
                        className={
                          !collapsed.has(row.path) || search ? 'rotate-90' : ''
                        }
                        aria-hidden="true"
                      />
                    )}
                    <Icon aria-hidden="true" />
                    <CreationFileLabel path={row.path} name={row.name} />
                    {conflictPaths.has(row.path) && (
                      <span
                        title={t('creation.diskChanged')}
                        aria-label={t('creation.diskChanged')}
                      >
                        !
                      </span>
                    )}
                    {dirtyPaths.has(row.path) && (
                      <span
                        className="creation-dirty-dot"
                        aria-label={t('creation.unsaved')}
                      />
                    )}
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent
                  onCloseAutoFocus={event => {
                    const path = renameAfterMenu.current
                    if (path) {
                      event.preventDefault()
                      renameAfterMenu.current = null
                      startRename(path)
                    }
                    const entry = newAfterMenu.current
                    if (entry) {
                      event.preventDefault()
                      newAfterMenu.current = null
                      setNewEntry(entry)
                    }
                  }}
                >
                  {file && (
                    <ContextMenuItem onSelect={() => onSelect(row.path)}>
                      {t('creation.tree.openFile')}
                    </ContextMenuItem>
                  )}
                  {editable && file && (
                    <ContextMenuItem
                      disabled={disabled || row.path === 'manifest.json'}
                      onSelect={() => {
                        renameAfterMenu.current = row.path
                      }}
                    >
                      {t('creation.rename')}
                      <span className="ms-auto text-xs">F2</span>
                    </ContextMenuItem>
                  )}
                  {!file && editable && (
                    <>
                      <ContextMenuItem
                        onSelect={() =>
                          (newAfterMenu.current = {
                            kind: 'file',
                            directory: row.path,
                          })
                        }
                      >
                        {t('creation.newFile.open')}
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() =>
                          setNewEntry({
                            kind: 'directory',
                            directory: row.path,
                          })
                        }
                      >
                        {t('creation.tree.newDirectory')}
                      </ContextMenuItem>
                    </>
                  )}
                </ContextMenuContent>
              </ContextMenu>
              {rename?.path === row.path && (
                <form
                  className="creation-tree-rename"
                  style={{ paddingInlineStart: 10 + row.depth * 14 }}
                  onSubmit={event => {
                    event.preventDefault()
                    void finishRename()
                  }}
                >
                  <div className="flex items-center gap-1">
                    <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                    <Input
                      ref={input}
                      aria-label={t('creation.tree.renameName')}
                      disabled={renaming}
                      value={rename.value}
                      onChange={event => {
                        setRename({ ...rename, value: event.target.value })
                        setError(null)
                      }}
                      onKeyDown={event => {
                        if (event.nativeEvent.isComposing) {
                          if (event.key === 'Enter') event.preventDefault()
                          return
                        }
                        if (event.key === 'Escape' && !renaming) {
                          event.preventDefault()
                          setRename(null)
                        }
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('creation.tree.renameHint')}
                  </p>
                  {error && <CreationErrorNotice error={error} />}
                </form>
              )}
            </div>
          )
        })}
        {!rows.length && (
          <p className="p-3 text-xs text-muted-foreground">
            {t('creation.noFiles')}
          </p>
        )}
      </nav>
      <div className="creation-sidebar-footer">
        <span>{t('desktop.fileCount', { count: files.length })}</span>
        <span className="ms-auto text-xs text-muted-foreground">
          {t('creation.tree.autoSync')}
        </span>
      </div>
    </>
  )
}
