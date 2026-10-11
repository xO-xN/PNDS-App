import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, RefreshCw, Settings } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { TrafficLights } from '@/components/shell'
import { CreationModeButton } from './CreationModeButton'
import { CreationFileReader } from './CreationFileReader'
import { CreationProjectPicker } from './CreationProjectPicker'
import { CreationErrorNotice } from './CreationErrorNotice'

const categories: CreationCategory[] = [
  'audio',
  'pages',
  'modules',
  'assets',
  'system',
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
      <aside className="flex w-72 min-w-48 shrink-0 flex-col border-e border-(--pnds-text)/15 bg-(--pnds-sidebar-bg) p-4">
        <TrafficLights />
        <Button
          variant="ghost"
          aria-label={t('creation.switchProject')}
          disabled={opening}
          className="group mt-6 h-auto justify-start whitespace-normal text-start"
          onClick={chooseProject}
        >
          <span className="block min-w-0">
            <span className="block break-words text-lg">{project.name}</span>
            <span className="block text-xs opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
              {t('creation.switchProject')}
            </span>
          </span>
        </Button>
        <p className="my-3 text-xs">{t(`creation.source.${project.source}`)}</p>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{t('creation.files')}</h2>
          <Button
            size="icon"
            variant="ghost"
            disabled={refreshing}
            aria-label={t('creation.refreshFiles')}
            onClick={() => void refresh()}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        </div>
        <Input
          aria-label={t('creation.searchFiles')}
          placeholder={t('creation.searchFiles')}
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
        <nav
          aria-label={t('creation.files')}
          className="my-3 min-h-0 flex-1 space-y-4 overflow-auto"
        >
          {categories.map(category => {
            const files = visible.filter(file => file.category === category)
            return (
              files.length > 0 && (
                <section key={category}>
                  <h3 className="mb-1 text-xs font-medium">
                    {t(`creation.category.${category}`)}
                  </h3>
                  {files.map(file => (
                    <Button
                      key={file.path}
                      variant={file.path === selected ? 'secondary' : 'ghost'}
                      aria-pressed={file.path === selected}
                      className="h-auto w-full justify-start whitespace-normal break-all px-2 py-2 text-start font-mono text-xs"
                      onClick={() => setSelected(file.path)}
                    >
                      {file.path}
                    </Button>
                  ))}
                </section>
              )
            )
          })}
          {visible.length === 0 && (
            <p className="text-sm">{t('creation.noFiles')}</p>
          )}
        </nav>
        <Button
          variant="outline"
          className="h-auto whitespace-normal text-start"
          onClick={() => void finder()}
        >
          <FolderOpen aria-hidden="true" />
          {t('creation.openFinder')}
        </Button>
        <CreationModeButton />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-(--pnds-text)/15 p-4">
          <h1 className="text-sm font-medium">{t('creation.title')}</h1>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('creation.settings')}
            onClick={() => useSettingsStore.getState().openSettings()}
          >
            <Settings aria-hidden="true" />
          </Button>
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
  const [pickerOpen, setPickerOpen] = useState(false)
  return (
    <div className="flex h-full w-full flex-col text-(--pnds-text)">
      <div className="flex min-h-0 flex-1">
        {workspace ? (
          <ReadingWorkspace
            key={workspace.project.identity}
            workspace={workspace}
            chooseProject={() => setPickerOpen(true)}
          />
        ) : (
          <>
            <aside className="flex w-72 shrink-0 flex-col border-e border-(--pnds-text)/15 bg-(--pnds-sidebar-bg) p-4">
              <TrafficLights />
              <div className="mt-auto">
                <CreationModeButton />
              </div>
            </aside>
            <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-6 overflow-auto p-8">
              <h1 className="text-3xl">{t('creation.title')}</h1>
              <p className="max-w-xl text-center">{t('creation.homeHint')}</p>
              <Button
                disabled={opening}
                onClick={() => void useCreationStore.getState().pick()}
              >
                <FolderOpen aria-hidden="true" />
                {t('creation.openFolder')}
              </Button>
              <section className="w-full max-w-xl space-y-2">
                <h2 className="text-sm font-medium">{t('creation.recent')}</h2>
                {recent.map(path => (
                  <Button
                    key={path}
                    disabled={opening}
                    variant="outline"
                    className="h-auto w-full justify-start whitespace-normal break-all text-start"
                    onClick={() => void useCreationStore.getState().open(path)}
                  >
                    {path}
                  </Button>
                ))}
                {recent.length === 0 && (
                  <p className="text-sm">{t('creation.noRecent')}</p>
                )}
              </section>
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
