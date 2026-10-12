import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FolderOpen,
  Folder,
  RefreshCw,
  Settings,
  Search,
  ChevronRight,
  FileText,
  FileCode,
  Image,
  Volume2,
} from 'lucide-react'
import {
  commands,
  type CreationCategory,
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
  useCreationDraftsStore,
} from '@/store/creation-drafts-store'
import { registerCreationParticipant } from '@/lib/creation-lifecycle'
import { useSettingsStore } from '@/store/settings-store'
import { useCreationChangesStore } from '@/store/creation-changes-store'
import { useSessionStore } from '@/store/session-store'
import { refreshMonitorFromDisk } from '@/lib/creation-runtime-updates'
import { Button } from '@/components/ui/button'
import { TrafficLights } from '@/components/shell'
import { CreationModeButton } from './CreationModeButton'
import { CreationFileEditor } from './CreationFileEditor'
import { CreationProjectPicker } from './CreationProjectPicker'
import { CreationErrorNotice } from './CreationErrorNotice'
import { CreationConsole } from './CreationConsole'
import { useCreationTestStore } from '@/store/creation-test-store'
import { resolveCreationReadme } from '@/lib/creation-readme'
import { CreationHandoff } from './CreationHandoff'
import {
  creationHandoffParticipant,
  HANDOFF_PATH,
} from '@/store/creation-handoff-store'

const categories: CreationCategory[] = [
  'system',
  'pages',
  'audio',
  'modules',
  'assets',
]

function ReadingWorkspace({
  workspace,
  chooseProject,
}: {
  workspace: CreationWorkspace
  chooseProject: () => void
}) {
  const { t, i18n } = useTranslation()
  const [search, setSearch] = useState('')
  const [error, setError] = useState<CreationError | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const opening = useCreationStore(state => state.opening)
  const selected = useCreationDraftsStore(state => state.activePath)
  // Identity-stable dirty set: the tree re-renders when dirty membership
  // changes, not on every editor keystroke.
  const dirtyPaths = new Set(
    useCreationDraftsStore(selectDirtyPathKey).split('\n').filter(Boolean)
  )
  const project = workspace.project
  const tab = useCreationTestStore(state => state.tab)
  const manifestRevision = useCreationChangesStore(
    state => state.fileRevisions['manifest.json'] ?? 0
  )
  useEffect(() => {
    void useCreationTestStore.getState().loadManifest()
  }, [project.identity, manifestRevision])
  const conflictPaths = new Set(
    useCreationDraftsStore(selectDiskConflictPathKey)
      .split('\n')
      .filter(Boolean)
  )
  const pending = useCreationChangesStore(state => state.pending)
  const watchError = useCreationChangesStore(state => state.error)
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
      await useCreationChangesStore.getState().poll()
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
  const editable = project.source === 'folder'
  const switchTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next =
      event.key === 'Home'
        ? 'file'
        : event.key === 'End'
          ? 'console'
          : tab === 'file'
            ? 'console'
            : 'file'
    useCreationTestStore.getState().setTab(next)
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-creation-tab="${next}"]`)
      ?.focus()
  }
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
    await useCreationChangesStore.getState().poll()
    if (owns()) setRefreshing(false)
  }
  return (
    <>
      <aside data-sidebar-surface="" className="creation-sidebar">
        <div data-tauri-drag-region className="creation-window-controls">
          <div data-tauri-drag-region="false">
            <TrafficLights />
          </div>
          <button
            type="button"
            className="pnds-focus-ring rounded-md p-1.5"
            aria-label={t('creation.settings')}
            onClick={() => useSettingsStore.getState().openSettings()}
          >
            <Settings aria-hidden="true" size={15} />
          </button>
        </div>
        <div className="creation-sidebar-body">
          <button
            type="button"
            className="creation-project-heading pnds-focus-ring"
            aria-label={t('creation.switchProject')}
            disabled={opening}
            onClick={chooseProject}
          >
            <Folder aria-hidden="true" />
            <span className="creation-project-identity">
              <strong>{project.name}</strong>
              <small title={project.root}>{project.root}</small>
            </span>
            <span aria-hidden="true" className="creation-project-switch-label">
              {t('creation.switchProject')}
            </span>
            <ChevronRight
              aria-hidden="true"
              className="creation-project-switch-arrow"
            />
          </button>
          <p className="creation-source">
            {t(`creation.source.${project.source}`)}
          </p>
          <div className="creation-file-tools">
            <h2>{t('creation.files')}</h2>
            <div className="flex gap-1">
              <button
                type="button"
                className="pnds-focus-ring"
                aria-label={t('creation.readme.open')}
                disabled={
                  !resolveCreationReadme(
                    files.map(file => file.path),
                    i18n.resolvedLanguage ?? 'en'
                  )
                }
                onClick={() => {
                  useCreationDraftsStore.getState().setActivePath(
                    resolveCreationReadme(
                      files.map(file => file.path),
                      i18n.resolvedLanguage ?? 'en'
                    )
                  )
                  useCreationTestStore.getState().setTab('file')
                }}
              >
                <FileText aria-hidden="true" />
              </button>
              <button
                type="button"
                className="pnds-focus-ring"
                aria-label={t('creation.openFinder')}
                onClick={() => void finder()}
              >
                <FolderOpen aria-hidden="true" />
              </button>
              <button
                type="button"
                className="pnds-focus-ring"
                disabled={refreshing}
                aria-label={t('creation.refreshFiles')}
                onClick={() => void refresh()}
              >
                <RefreshCw aria-hidden="true" />
              </button>
            </div>
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
            {categories.map(category => {
              const files = visible.filter(file => file.category === category)
              return (
                files.length > 0 && (
                  <section
                    key={category}
                    className="creation-file-group"
                    data-category={category}
                  >
                    <h3>{t(`creation.category.${category}`)}</h3>
                    {files.map(file => {
                      const Icon =
                        file.kind === 'image'
                          ? Image
                          : file.kind === 'binary' && file.category === 'audio'
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
                            useCreationDraftsStore
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
                          <span className="creation-file-badge">
                            {['manifest.json', 'package.json'].includes(
                              file.path
                            )
                              ? 'PNDS'
                              : t('creation.projectContent')}
                          </span>
                        </button>
                      )
                    })}
                  </section>
                )
              )
            })}
            {visible.length === 0 && (
              <p className="p-2 text-xs">{t('creation.noFiles')}</p>
            )}
          </nav>
        </div>
        <CreationModeButton />
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-(--pnds-text)/15 p-4">
          <h1 className="text-sm font-medium">{t('creation.workspace')}</h1>
          <div
            role="tablist"
            aria-label={t('creation.workspace')}
            className="flex min-w-0 gap-2"
            onKeyDown={switchTab}
          >
            <button
              role="tab"
              id={`creation-${project.identity}-file-tab`}
              aria-controls={`creation-${project.identity}-file`}
              data-creation-tab="file"
              tabIndex={tab === 'file' ? 0 : -1}
              aria-selected={tab === 'file'}
              className="pnds-focus-ring min-w-0 truncate rounded px-2 py-1 aria-selected:bg-(--pnds-text)/10"
              onClick={() => useCreationTestStore.getState().setTab('file')}
            >
              {file?.path ?? t('creation.files')}
            </button>
            <button
              role="tab"
              id={`creation-${project.identity}-console-tab`}
              aria-controls={`creation-${project.identity}-console`}
              data-creation-tab="console"
              tabIndex={tab === 'console' ? 0 : -1}
              aria-selected={tab === 'console'}
              className="pnds-focus-ring shrink-0 rounded px-2 py-1 aria-selected:bg-(--pnds-text)/10"
              onClick={() => useCreationTestStore.getState().setTab('console')}
            >
              {t('creation.console')}
            </button>
          </div>
        </div>
        {error && <CreationErrorNotice error={error} />}
        <CreationHandoff
          editable={editable}
          exists={files.some(file => file.path === HANDOFF_PATH)}
        />
        {watchError && <CreationErrorNotice error={watchError} />}
        {(pending.refresh > 0 ||
          pending.restart > 0 ||
          pending.compile > 0) && (
          <div className="border-b border-(--pnds-text)/15 p-4 text-start text-xs">
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
          role="tabpanel"
          id={`creation-${project.identity}-file`}
          aria-labelledby={`creation-${project.identity}-file-tab`}
          hidden={tab !== 'file'}
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
          role="tabpanel"
          id={`creation-${project.identity}-console`}
          aria-labelledby={`creation-${project.identity}-console-tab`}
          hidden={tab !== 'console'}
          className="creation-file-tab flex min-h-0 flex-1 flex-col"
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
  const [pickerOpen, setPickerOpen] = useState(false)
  useEffect(() => registerCreationParticipant(creationDraftsParticipant), [])
  useEffect(() => registerCreationParticipant(creationHandoffParticipant), [])
  return (
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
          />
        ) : (
          <>
            <aside data-sidebar-surface="" className="creation-sidebar">
              <div data-tauri-drag-region className="creation-window-controls">
                <div data-tauri-drag-region="false">
                  <TrafficLights />
                </div>
                <button
                  type="button"
                  className="pnds-focus-ring rounded-md p-1.5"
                  aria-label={t('creation.settings')}
                  onClick={() => useSettingsStore.getState().openSettings()}
                >
                  <Settings aria-hidden="true" size={15} />
                </button>
              </div>
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
                {recent.map(path => (
                  <Button
                    key={path}
                    disabled={opening}
                    variant="ghost"
                    title={path}
                    className="h-auto justify-start whitespace-normal break-all text-start text-xs"
                    onClick={() => void useCreationStore.getState().open(path)}
                  >
                    {path.split('/').pop()}
                  </Button>
                ))}
                {recent.length === 0 && <p>{t('creation.noRecent')}</p>}
              </div>
              <CreationModeButton />
            </aside>
            <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-6 overflow-auto p-8">
              <h1 className="text-3xl">{t('creation.title')}</h1>
              <p className="max-w-xl text-center">{t('creation.homeHint')}</p>
            </main>
          </>
        )}
      </div>
      {!pickerOpen && (error || opening) && (
        <div className="max-h-1/4 shrink-0 overflow-auto bg-(--pnds-card) p-3">
          {error ? (
            <CreationErrorNotice error={error} />
          ) : (
            <p role="status">{t('creation.loading')}</p>
          )}
        </div>
      )}
      {pickerOpen && (
        <CreationProjectPicker onClose={() => setPickerOpen(false)} />
      )}
    </div>
  )
}
