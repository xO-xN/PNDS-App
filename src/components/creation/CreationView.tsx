import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  FolderOpen,
  Folder,
  ChevronDown,
  BookOpen,
  Search,
  ChevronRight,
  FileText,
  Settings2,
  FileCode,
  Image,
  Volume2,
  Package,
  X,
} from 'lucide-react'
import {
  commands,
  type CreationError,
  type CreationWorkspace,
} from '@/lib/tauri-bindings'
import {
  creationTransportError,
  useCreationStore,
} from '@/store/creation-store'
import {
  creationDraftsParticipant,
  selectDirtyPathKey,
  selectDiskConflictPathKey,
  useCreationFilesStore,
} from '@/store/creation-files-store'
import { registerCreationParticipant } from '@/lib/creation-lifecycle'

import { useSessionStore } from '@/store/session-store'
import { refreshMonitorFromDisk } from '@/lib/creation-runtime-updates'
import { syncNativeWindowControls } from '@/lib/native-window-controls'
import { useWindowStore } from '@/store/window-store'
import { TrafficLights } from '@/components/shell/TrafficLights'
import { Button } from '@/components/ui/button'
import { CreationFileEditor } from './CreationFileEditor'
import { CreationProjectPicker } from './CreationProjectPicker'
import { CreationNewProject } from './CreationNewProject'
import { CreationErrorNotice } from './CreationErrorNotice'
import { CreationConsole } from './CreationConsole'
import { useCreationTestStore } from '@/store/creation-test-store'
import { resolveCreationReadme } from '@/lib/creation-readme'
import { CreationHandoff } from './CreationHandoff'
import { CreationBundle } from './CreationBundle'
import { CreationModules } from './CreationModules'
import { CreationLibraries } from './CreationLibraries'
import { CreationGit } from './CreationGit'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  CREATION_FILE_GROUPS,
  creationFileGroup,
} from '@/lib/creation-file-navigation'
import {
  creationHandoffParticipant,
  useCreationHandoffStore,
  HANDOFF_PATH,
} from '@/store/creation-handoff-store'

function ReadingWorkspace({
  workspace,
  chooseProject,
  createProject,
  menuTarget,
  menuBlocked,
  actionsTarget,
}: {
  workspace: CreationWorkspace
  chooseProject: () => void
  createProject: () => void
  menuTarget: HTMLDivElement | null
  menuBlocked: boolean
  actionsTarget: HTMLDivElement | null
}) {
  const { t, i18n } = useTranslation()
  const [search, setSearch] = useState('')
  const menuAction = useRef<(() => void) | null>(null)
  const [bundleOpen, setBundleOpen] = useState(false)
  const [gitOpen, setGitOpen] = useState(false)
  const [closedGroups, setClosedGroups] = useState<string[]>([
    'artifacts',
    'modules',
    'assets',
    'support',
  ])
  const [error, setError] = useState<CreationError | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const opening = useCreationStore(state => state.opening)
  const selected = useCreationFilesStore(state => state.activePath)
  // Identity-stable dirty set: the tree re-renders when dirty membership
  // changes, not on every editor keystroke.
  const dirtyPaths = new Set(
    useCreationFilesStore(selectDirtyPathKey).split('\n').filter(Boolean)
  )
  const project = workspace.project
  const pendingHandoff = useCreationHandoffStore(state => state.pending)
  const manifestEntry = useCreationTestStore(
    state => state.manifest?.scoreServer.entry
  )
  const tab = useCreationTestStore(state => state.tab)
  const manifestRevision = useCreationFilesStore(
    state => state.fileRevisions['manifest.json'] ?? 0
  )
  useEffect(() => {
    void useCreationTestStore.getState().loadManifest()
  }, [project.identity, manifestRevision])
  const conflictPaths = new Set(
    useCreationFilesStore(selectDiskConflictPathKey).split('\n').filter(Boolean)
  )
  const pending = useCreationFilesStore(state => state.pending)
  const watchError = useCreationFilesStore(state => state.error)
  const runtimePath = useCreationStore(state =>
    state.runtimeProject?.root === project.root
      ? state.runtimeProject.path
      : null
  )
  const running = useSessionStore(
    state =>
      state.sessionStatus === 'ready' &&
      (state.sessionProjectPath === project.root ||
        (!!runtimePath && state.sessionProjectPath === runtimePath))
  )
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      await useCreationFilesStore.getState().poll()
      if (live)
        timer = setTimeout(() => {
          void poll()
        }, 1000)
    }
    void poll()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [project.identity])
  // A removed file's recoverable draft remains reachable in the tree.
  const files = [
    ...workspace.files,
    ...[...dirtyPaths]
      .filter(path => !workspace.files.some(file => file.path === path))
      .map(path => ({
        path,
        kind: 'text' as const,
        category: 'system' as const,
        size: 0,
      })),
  ]
  const visible = files.filter(file =>
    file.path.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  )
  const file = files.find(file => file.path === selected)
  const readmePath = resolveCreationReadme(
    files.map(file => file.path),
    i18n.resolvedLanguage ?? 'en'
  )
  const pinnedPaths = ['manifest.json', readmePath].filter(
    (path): path is string =>
      path !== null && files.some(file => file.path === path)
  )
  const chooseFile = (path: string) => {
    useCreationFilesStore.getState().setActivePath(path)
    useCreationTestStore.getState().setTab('file')
  }
  const editable = project.source === 'folder'
  const owns = () =>
    useCreationStore.getState().workspace?.project.identity === project.identity
  const finder = async () => {
    try {
      const result = await commands.revealCreationPath(project.identity, null)
      if (owns() && result.status === 'error') setError(result.error)
    } catch (error) {
      if (owns()) setError(creationTransportError(error))
    }
  }
  const refresh = async () => {
    setRefreshing(true)
    await useCreationFilesStore.getState().poll()
    if (owns()) setRefreshing(false)
  }
  return (
    <>
      {menuTarget &&
        createPortal(
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-tauri-drag-region="false"
                className="creation-titlebar-trigger pnds-focus-ring"
                aria-label={t('desktop.projectMenu')}
                title={project.root}
                disabled={opening || menuBlocked}
              >
                <Folder aria-hidden="true" />
                <span className="creation-titlebar-name">{project.name}</span>
                <ChevronDown aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              onCloseAutoFocus={event => {
                const action = menuAction.current
                menuAction.current = null
                if (action) {
                  event.preventDefault()
                  if (owns()) action()
                }
              }}
            >
              <DropdownMenuItem
                onSelect={() => {
                  menuAction.current = chooseProject
                }}
              >
                {t('creation.switchProject')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  menuAction.current = createProject
                }}
              >
                {t('creation.newProject.open')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void finder()}>
                {t('creation.openFinder')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={refreshing}
                onSelect={() => void refresh()}
              >
                {t('creation.refreshFiles')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  menuAction.current = () => setGitOpen(true)
                }}
              >
                {t('creation.git.action')}
              </DropdownMenuItem>
              {editable && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      menuAction.current = () => {
                        void useCreationHandoffStore.getState().open()
                      }
                    }}
                  >
                    {t('creation.handoff.add')}
                  </DropdownMenuItem>
                </>
              )}
              {pendingHandoff
                .filter(item => item.readme)
                .map(item => (
                  <DropdownMenuItem
                    key={item.task.id}
                    onSelect={() =>
                      void useCreationHandoffStore.getState().open(item.task.id)
                    }
                  >
                    {t('creation.handoff.sync')}
                  </DropdownMenuItem>
                ))}
              {files.some(file => file.path === HANDOFF_PATH) && (
                <DropdownMenuItem onSelect={() => chooseFile(HANDOFF_PATH)}>
                  {t('creation.handoff.view')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>,
          menuTarget
        )}
      {actionsTarget &&
        editable &&
        createPortal(
          <button
            type="button"
            data-tauri-drag-region="false"
            className="creation-titlebar-trigger pnds-focus-ring"
            disabled={opening || menuBlocked}
            onClick={() => setBundleOpen(true)}
          >
            <Package aria-hidden="true" />
            <span className="creation-titlebar-name">
              {t('creation.bundle.action')}
            </span>
          </button>,
          actionsTarget
        )}
      <aside data-sidebar-surface="" className="creation-sidebar">
        <div className="creation-sidebar-body">
          <div className="creation-pinned-files">
            {pinnedPaths.map(path => (
              <button
                type="button"
                key={path}
                className="creation-pinned-file pnds-focus-ring"
                aria-label={path}
                aria-pressed={selected === path && tab === 'file'}
                onClick={() => chooseFile(path)}
              >
                {path === 'manifest.json' ? (
                  <Settings2 aria-hidden="true" />
                ) : (
                  <BookOpen aria-hidden="true" />
                )}
                <span>
                  <strong>
                    {t(
                      path === 'manifest.json'
                        ? 'desktop.manifest'
                        : 'desktop.readme'
                    )}
                  </strong>
                  <small>{path}</small>
                </span>
                {dirtyPaths.has(path) && (
                  <i
                    aria-label={t('creation.unsaved')}
                    className="creation-dirty-dot"
                  />
                )}
                {conflictPaths.has(path) && (
                  <i aria-label={t('creation.diskChanged')}>!</i>
                )}
              </button>
            ))}
          </div>
          <div className="creation-file-search">
            <Search aria-hidden="true" />
            <input
              className="pnds-focus-ring"
              aria-label={t('creation.searchFiles')}
              placeholder={t('creation.searchFiles')}
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>
          <nav aria-label={t('creation.files')} className="creation-file-tree">
            {CREATION_FILE_GROUPS.map(category => {
              const files = visible.filter(
                file =>
                  !pinnedPaths.includes(file.path) &&
                  creationFileGroup(file, manifestEntry) === category
              )
              const collapsed =
                !search &&
                closedGroups.includes(category) &&
                !files.some(
                  file => file.path === selected || dirtyPaths.has(file.path)
                )
              return (
                (files.length > 0 || (category === 'modules' && editable)) && (
                  <section
                    key={category}
                    className="creation-file-group"
                    data-category={category}
                  >
                    <div className="flex items-center">
                      <button
                        type="button"
                        className="creation-group-label pnds-focus-ring"
                        aria-expanded={!collapsed}
                        onClick={() =>
                          setClosedGroups(current =>
                            current.includes(category)
                              ? current.filter(item => item !== category)
                              : [...current, category]
                          )
                        }
                      >
                        <ChevronRight
                          aria-hidden="true"
                          className={!collapsed ? 'rotate-90' : ''}
                        />
                        <span>{t(`desktop.category.${category}`)}</span>
                        <small>{files.length}</small>
                      </button>
                      {category === 'modules' && editable && (
                        <>
                          <CreationModules
                            key={project.identity}
                            identity={project.identity}
                            disabled={menuBlocked || opening}
                          />
                          <CreationLibraries
                            key={`libraries-${project.identity}`}
                            identity={project.identity}
                            disabled={menuBlocked || opening}
                          />
                        </>
                      )}
                    </div>
                    <div hidden={collapsed}>
                      {files.map(file => {
                        const Icon =
                          file.kind === 'image'
                            ? Image
                            : file.kind === 'binary' &&
                                file.category === 'audio'
                              ? Volume2
                              : /\.(?:[cm]?js|[jt]sx?|scd|html|css)$/.test(
                                    file.path
                                  )
                                ? FileCode
                                : FileText
                        return (
                          <button
                            type="button"
                            key={file.path}
                            aria-label={file.path}
                            title={file.path}
                            aria-pressed={file.path === selected}
                            className="creation-file-row pnds-focus-ring"
                            onClick={() => {
                              useCreationFilesStore
                                .getState()
                                .setActivePath(file.path)
                              useCreationTestStore.getState().setTab('file')
                            }}
                          >
                            <Icon aria-hidden="true" />
                            <span className="creation-file-name">
                              {file.path}
                            </span>
                            {conflictPaths.has(file.path) && (
                              <span
                                aria-label={t('creation.diskChanged')}
                                title={t('creation.diskChanged')}
                              >
                                !
                              </span>
                            )}
                            {dirtyPaths.has(file.path) && (
                              <span
                                aria-label={t('creation.unsaved')}
                                className="creation-dirty-dot"
                              />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </section>
                )
              )
            })}
            {visible.length === 0 && (
              <p className="p-2 text-xs">{t('creation.noFiles')}</p>
            )}
          </nav>
        </div>
        <div className="creation-sidebar-footer">
          <span>{t('desktop.fileCount', { count: files.length })}</span>
          <button
            type="button"
            className="creation-icon-button pnds-focus-ring"
            aria-label={t('creation.openFinder')}
            onClick={() => void finder()}
          >
            <FolderOpen aria-hidden="true" />
          </button>
        </div>
      </aside>
      <main
        aria-label={t('creation.workspace')}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        {gitOpen && (
          <CreationGit
            key={project.identity}
            identity={project.identity}
            onClose={() => setGitOpen(false)}
          />
        )}
        {error && <CreationErrorNotice error={error} />}
        <Dialog open={bundleOpen} onOpenChange={setBundleOpen}>
          <DialogContent>
            <DialogTitle>{t('creation.bundle.action')}</DialogTitle>
            <CreationBundle project={project} />
          </DialogContent>
        </Dialog>
        <CreationHandoff
          editable={editable}
          exists={files.some(file => file.path === HANDOFF_PATH)}
          menuOnly
        />
        {watchError && <CreationErrorNotice error={watchError} />}
        {(pending.refresh > 0 ||
          pending.restart > 0 ||
          pending.compile > 0) && (
          <div className="border-b border-(--pnds-border) p-4 text-start text-xs">
            <div role="status" aria-atomic="true">
              {pending.refresh > 0 && <p>{t('creation.pendingRefresh')}</p>}
              {pending.restart > 0 && <p>{t('creation.pendingRestart')}</p>}
              {pending.compile > 0 && <p>{t('creation.pendingCompile')}</p>}
              <p className="mt-2">{t('creation.runningDiskHint')}</p>
            </div>
            {running && pending.refresh > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => {
                  void refreshMonitorFromDisk()
                }}
              >
                {t('creation.refreshPages')}
              </Button>
            )}
          </div>
        )}
        <div
          role="region"
          id={`creation-${project.identity}-file`}
          aria-label={file?.path ?? t('creation.files')}
          className="creation-file-tab flex min-h-0 flex-1 flex-col"
        >
          {file ? (
            <CreationFileEditor
              key={`${project.identity}:${file.path}`}
              identity={project.identity}
              file={file}
              editable={editable}
            />
          ) : (
            <p className="m-auto p-6 text-sm">{t('creation.selectFile')}</p>
          )}
        </div>
        <div
          role="region"
          id={`creation-${project.identity}-console`}
          aria-label={t('creation.console')}
          hidden={tab !== 'console'}
          className="creation-file-tab creation-console-dock flex min-h-0 flex-col"
        >
          <CreationConsole />
        </div>
      </main>
    </>
  )
}

export function CreationView() {
  const { t } = useTranslation()
  const workspace = useCreationStore(state => state.workspace)
  const recent = useCreationStore(state => state.recentPaths)
  const opening = useCreationStore(state => state.opening)
  const error = useCreationStore(state => state.error)
  const settling = useCreationStore(state => state.modePhase === 'settling')
  const expanded = useCreationTestStore(state => state.expanded)
  const modePending = useCreationStore(state => state.modePhase !== 'idle')
  const commandPending = useSessionStore(state => state.commandPending)
  const fullscreen = useWindowStore(state => state.fullscreen)
  const [menuTarget, setMenuTarget] = useState<HTMLDivElement | null>(null)
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(
    null
  )
  const [pickerOpen, setPickerOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  useEffect(() => registerCreationParticipant(creationDraftsParticipant), [])
  useEffect(() => registerCreationParticipant(creationHandoffParticipant), [])
  useLayoutEffect(() => {
    // AppKit's button origin is 9px inside its container: 18 gives a
    // 9px visible top inset for the 14px buttons in the 32px titlebar.
    void syncNativeWindowControls(true, -12, 1, 18)
    return () => {
      void syncNativeWindowControls(true)
    }
  }, [fullscreen])
  return (
    <>
      <header
        data-creation-topbar=""
        data-tauri-drag-region="deep"
        className="desktop-creation-topbar"
      >
        <TrafficLights />
        <div ref={setMenuTarget} className="creation-titlebar-project" />
        <div
          ref={setActionsTarget}
          data-creation-titlebar-status=""
          className="creation-titlebar-status"
          aria-hidden={!workspace || workspace.project.source !== 'folder'}
        />
      </header>
      {menuTarget &&
        !workspace &&
        createPortal(
          <button
            type="button"
            data-tauri-drag-region="false"
            className="creation-titlebar-trigger pnds-focus-ring"
            aria-label={t('creation.switchProject')}
            disabled={opening || modePending || commandPending}
            onClick={() => setPickerOpen(true)}
          >
            <Folder aria-hidden="true" />
            <span className="creation-titlebar-name">
              {t('creation.switchProject')}
            </span>
            <ChevronDown aria-hidden="true" />
          </button>,
          menuTarget
        )}
      <div
        data-creation-view=""
        inert={settling || expanded}
        hidden={expanded}
        className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden text-(--pnds-text)"
      >
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {workspace ? (
            <ReadingWorkspace
              key={workspace.project.identity}
              workspace={workspace}
              chooseProject={() => setPickerOpen(true)}
              createProject={() => setNewProjectOpen(true)}
              menuTarget={menuTarget}
              menuBlocked={expanded || modePending || commandPending}
              actionsTarget={actionsTarget}
            />
          ) : (
            <>
              <aside data-sidebar-surface="" className="creation-sidebar">
                <div className="creation-side-home">
                  <h2>{t('creation.workspace')}</h2>
                  <p>{t('creation.homeHint')}</p>
                  <Button
                    disabled={opening}
                    onClick={() => void useCreationStore.getState().pick()}
                  >
                    <FolderOpen aria-hidden="true" />
                    {t('creation.openFolder')}
                  </Button>
                  <h3 className="mt-6 mb-3 text-xs">{t('creation.recent')}</h3>
                  <Button
                    variant="outline"
                    disabled={opening}
                    onClick={() => setNewProjectOpen(true)}
                  >
                    {t('creation.newProject.open')}
                  </Button>
                  {recent.map(path => (
                    <div
                      key={path}
                      className="creation-recent-row"
                      data-creation-recent-path={path}
                    >
                      <Button
                        disabled={opening}
                        variant="ghost"
                        title={path}
                        className="creation-recent-open h-auto justify-start whitespace-normal break-all text-start text-xs"
                        onClick={() =>
                          void useCreationStore.getState().open(path)
                        }
                      >
                        {path.split('/').pop()}
                      </Button>
                      <button
                        type="button"
                        className="creation-recent-remove pnds-focus-ring"
                        disabled={opening || modePending}
                        aria-label={t('creation.removeRecent', {
                          name: path.split('/').pop() ?? path,
                        })}
                        title={t('sidebar.removeFromHistory')}
                        onClick={() =>
                          useCreationStore.getState().removeRecent(path)
                        }
                      >
                        <X size={13} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  {recent.length === 0 && <p>{t('creation.noRecent')}</p>}
                </div>
              </aside>
              <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-6 overflow-auto p-8">
                <h1 className="text-3xl">{t('creation.title')}</h1>
                <p className="max-w-xl text-center">{t('creation.homeHint')}</p>
              </main>
            </>
          )}
        </div>
        {!pickerOpen && !newProjectOpen && (error || opening) && (
          <div className="max-h-1/4 shrink-0 overflow-auto bg-(--pnds-card) p-3">
            {error ? (
              <CreationErrorNotice error={error} />
            ) : (
              <p role="status">{t('creation.loading')}</p>
            )}
          </div>
        )}
        {pickerOpen && (
          <CreationProjectPicker
            onClose={() => setPickerOpen(false)}
            onNewProject={() => {
              setPickerOpen(false)
              setNewProjectOpen(true)
            }}
          />
        )}
        {newProjectOpen && (
          <CreationNewProject onClose={() => setNewProjectOpen(false)} />
        )}
      </div>
    </>
  )
}
