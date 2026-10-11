import { useState } from 'react'
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
import { useSettingsStore } from '@/store/settings-store'
import { Button } from '@/components/ui/button'
import { TrafficLights } from '@/components/shell'
import { CreationModeButton } from './CreationModeButton'
import { CreationFileReader } from './CreationFileReader'
import { CreationProjectPicker } from './CreationProjectPicker'
import { CreationErrorNotice } from './CreationErrorNotice'

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
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<CreationError | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const opening = useCreationStore(state => state.opening)
  const project = workspace.project
  const visible = workspace.files.filter(file =>
    file.path.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  )
  const file = workspace.files.find(file => file.path === selected)
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
    setError(null)
    try {
      const result = await commands.listCreationFiles(project.identity)
      if (!owns()) return
      if (result.status === 'error') setError(result.error)
      else {
        useCreationStore.setState({
          workspace: { project, files: result.data },
        })
        setSelected(null)
      }
    } catch (error) {
      if (owns()) setError(creationTransportError(error))
    } finally {
      if (owns()) setRefreshing(false)
    }
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
                          onClick={() => setSelected(file.path)}
                        >
                          <Icon aria-hidden="true" />
                          <span className="creation-file-name">
                            {file.path}
                          </span>
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
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-(--pnds-text)/15 p-4">
          <h1 className="text-sm font-medium">{t('creation.workspace')}</h1>
        </div>
        {error && <CreationErrorNotice error={error} />}
        {file ? (
          <CreationFileReader
            key={`${project.identity}:${file.path}`}
            identity={project.identity}
            file={file}
          />
        ) : (
          <p className="m-auto p-6 text-sm">{t('creation.selectFile')}</p>
        )}
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
  const [pickerOpen, setPickerOpen] = useState(false)
  return (
    <div
      data-creation-view=""
      inert={settling}
      className="flex h-full min-w-0 w-full flex-col text-(--pnds-text)"
    >
      <div className="flex min-h-0 flex-1">
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
        <div className="shrink-0 bg-(--pnds-card) p-3">
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
