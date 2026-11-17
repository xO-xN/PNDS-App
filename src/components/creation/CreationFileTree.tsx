import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronRight,
  Folder,
  FileCode,
  FileText,
  Image,
  Volume2,
  Plus,
  FolderOpen,
  FilePlus2,
  FolderPlus,
  PackagePlus,
  ListTree,
  PanelsTopLeft,
  Settings2,
} from 'lucide-react'
import type { CreationError, CreationFile } from '@/lib/tauri-bindings'
import {
  creationFileTree,
  creationFilePurpose,
  creationFileSections,
  isCreationTechnicalFile,
  matchesCreationFile,
  type CreationTreeRow,
} from '@/lib/creation-file-tree'
import { CreationResources } from './CreationResources'
import { CreationFileLabel } from './CreationFileLabel'
import { CreationDependencies } from './CreationDependencies'
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
import { SearchField } from '@/components/ui/search-field'
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
  onFinder,
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
  onFinder: (path: string) => Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const [resourcesOpen, setResourcesOpen] = useState(false)
  const resourcesAfterMenu = useRef(false)
  const [search, setSearch] = useState('')
  const [rawFiles, setRawFiles] = useState(false)
  const [technicalOpen, setTechnicalOpen] = useState(
    () => !!selected && isCreationTechnicalFile(selected)
  )
  const newTrigger = useRef<HTMLButtonElement>(null)
  const newAfterMenu = useRef<{
    kind: 'file' | 'directory'
    directory: string
  } | null>(null)
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
    if (selected && isCreationTechnicalFile(selected)) setTechnicalOpen(true)
    if (selected)
      setCollapsed(
        current =>
          new Set(
            [...current].filter(parent => !selected.startsWith(parent + '/'))
          )
      )
  }
  const purposeName = (path: string) => {
    const purpose = creationFilePurpose(path)
    return purpose ? t(`creation.tree.role.${purpose}`) : ''
  }
  const matchesLabel = (key: string) =>
    matchesCreationFile(
      '',
      search,
      ['en', 'zh-CN'].map(lng => t(key, { lng })).join('\n')
    )
  const sections = creationFileSections(files, directories)
  const rows = creationFileTree(
    rawFiles ? files : sections.common,
    rawFiles ? directories : sections.commonDirectories,
    collapsed,
    search,
    { pin: !rawFiles }
  )
  const technicalRows = rawFiles
    ? []
    : creationFileTree(
        sections.technical,
        sections.technicalDirectories,
        collapsed,
        matchesLabel('creation.tree.technical') ? '' : search
      ).map(row => ({ ...row, depth: row.depth + 1 }))
  const showTechnical = technicalOpen || !!search.trim()
  const visibleRows = [...rows, ...(showTechnical ? technicalRows : [])]
  const technicalDirty = sections.technical.some(file =>
    dirtyPaths.has(file.path)
  )
  const technicalConflict = sections.technical.some(file =>
    conflictPaths.has(file.path)
  )
  const current = focused ?? selected
  const directory = current
    ? files.some(file => file.path === current)
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
  const renderRow = (row: CreationTreeRow) => {
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
              aria-description={
                !rawFiles ? purposeName(row.path) || undefined : undefined
              }
              aria-expanded={
                !file ? !collapsed.has(row.path) || !!search : undefined
              }
              aria-selected={current === row.path}
              disabled={disabled}
              data-tree-path={row.path}
              data-project-file={
                file && !rawFiles ? creationFilePurpose(row.path) : undefined
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
              <CreationFileLabel
                path={row.path}
                name={row.name}
                plain={rawFiles || !file}
              />
              {conflictPaths.has(row.path) && (
                <span aria-label={t('creation.diskChanged')}>!</span>
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
            <ContextMenuItem
              disabled={disabled}
              onSelect={() => void onFinder(row.path)}
            >
              <FolderOpen aria-hidden="true" />
              {t('creation.tree.openFinder')}
            </ContextMenuItem>
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
  }
  return (
    <>
      <div className="creation-tree-heading">
        <strong>{t('creation.files')}</strong>
        {editable && (
          <DropdownMenu dir={i18n.dir()} modal={false}>
            <DropdownMenuTrigger asChild disabled={disabled}>
              <button
                type="button"
                className="creation-icon-button creation-add-trigger pnds-focus-ring"
                disabled={disabled}
                ref={newTrigger}
                aria-label={t('creation.tree.new')}
              >
                <Plus aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="end"
              className="creation-add-menu"
              onCloseAutoFocus={event => {
                if (resourcesAfterMenu.current) {
                  resourcesAfterMenu.current = false
                  if (!disabled) {
                    event.preventDefault()
                    setResourcesOpen(true)
                  }
                }
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
                <FilePlus2 aria-hidden="true" />
                {t('creation.newFile.open')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  newAfterMenu.current = { kind: 'directory', directory }
                }}
              >
                <FolderPlus aria-hidden="true" />
                {t('creation.tree.newDirectory')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  resourcesAfterMenu.current = true
                }}
              >
                <PackagePlus aria-hidden="true" />
                {t('creation.resources.open')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {editable && (
        <CreationResources
          identity={identity}
          disabled={disabled}
          open={resourcesOpen}
          onClose={() => setResourcesOpen(false)}
          onReturnFocus={() => newTrigger.current?.focus()}
        />
      )}
      <div className="creation-tree-searchbar">
        <SearchField
          className="creation-file-search"
          variant="secondary"
          size="sm"
          aria-label={t('creation.searchFiles')}
          placeholder={t('creation.searchFiles')}
          value={search}
          onValueChange={setSearch}
        />

        <button
          type="button"
          className="creation-tree-view-switch pnds-focus-ring"
          disabled={disabled || renaming || !!rename}
          onClick={() => {
            setRawFiles(current => !current)
            setFocused(null)
            if (selected && isCreationTechnicalFile(selected))
              setTechnicalOpen(true)
            if (selected)
              setCollapsed(
                current =>
                  new Set(
                    [...current].filter(
                      parent => !selected.startsWith(parent + '/')
                    )
                  )
              )
          }}
        >
          {rawFiles ? (
            <PanelsTopLeft aria-hidden="true" />
          ) : (
            <ListTree aria-hidden="true" />
          )}
          {t(
            rawFiles ? 'creation.tree.showPurpose' : 'creation.tree.showFiles'
          )}
        </button>
      </div>
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
            if (isCreationTechnicalFile(path)) setTechnicalOpen(true)
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
          const element = elements[index]
          const row = visibleRows.find(
            row => row.path === element?.dataset.treePath
          )
          if (
            element?.dataset.treeGroup === 'technical' &&
            ['ArrowLeft', 'ArrowRight'].includes(event.key)
          ) {
            event.preventDefault()
            setTechnicalOpen(event.key === 'ArrowRight')
            return
          }
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
        {rows.map(renderRow)}
        {!rawFiles && matchesLabel('creation.dependencies.title') && (
          <CreationDependencies
            identity={identity}
            files={files}
            disabled={disabled}
            editable={editable}
            onFocus={() => setFocused(null)}
          />
        )}
        {!rawFiles && technicalRows.length > 0 && (
          <>
            <button
              type="button"
              role="treeitem"
              aria-level={1}
              aria-label={t('creation.tree.technical')}
              aria-expanded={showTechnical}
              data-tree-group="technical"
              className="creation-file-row creation-tree-row pnds-focus-ring"
              disabled={disabled}
              onFocus={() => setFocused(null)}
              onClick={() => setTechnicalOpen(current => !current)}
            >
              <ChevronRight
                aria-hidden="true"
                className={showTechnical ? 'rotate-90' : ''}
              />
              <Settings2 aria-hidden="true" />
              <span className="creation-file-name">
                {t('creation.tree.technical')}
              </span>
              {technicalConflict && (
                <span aria-label={t('creation.diskChanged')}>!</span>
              )}
              {technicalDirty && (
                <span
                  className="creation-dirty-dot"
                  aria-label={t('creation.unsaved')}
                />
              )}
            </button>

            {showTechnical && technicalRows.map(renderRow)}
          </>
        )}
        {!rows.length &&
          !technicalRows.length &&
          (rawFiles || !matchesLabel('creation.dependencies.title')) && (
            <p className="p-3 text-xs text-muted-foreground">
              {t('creation.noFiles')}
            </p>
          )}
      </nav>
    </>
  )
}
