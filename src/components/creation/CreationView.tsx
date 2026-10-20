import { CreationGitFiles } from './CreationGitFiles'
import { CreationFileTree } from './CreationFileTree'
import { CreationResources } from './CreationResources'
import { CreationGitLocation } from './CreationGitLocation'
import { CreationHandoffDocument } from './CreationHandoffDocument'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  FolderOpen,
  Package,
  PanelRightClose,
  PanelRightOpen,
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
import { syncNativeWindowControls } from '@/lib/native-window-controls'
import { useWindowStore } from '@/store/window-store'
import { TrafficLights } from '@/components/shell/TrafficLights'
import { Button } from '@/components/ui/button'
import { CreationFileEditor } from './CreationFileEditor'
import { CreationAssistant } from './CreationAssistant'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useAssistantLifecycle } from '@/hooks/use-assistant-lifecycle'
import type { AssistantMessage } from '@/lib/assistant-types'
import { CreationProjectPicker } from './CreationProjectPicker'
import { CreationNewProject } from './CreationNewProject'
import { CreationErrorToast } from './CreationErrorToast'
import { CreationConsole } from './CreationConsole'
import { useCreationTestStore } from '@/store/creation-test-store'
import { CreationHandoff } from './CreationHandoff'
import { CreationBundle } from './CreationBundle'
import { CreationGitPage } from './CreationGitPage'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  creationHandoffParticipant,
  HANDOFF_PATH,
} from '@/store/creation-handoff-store'

function ReadingWorkspace({
  workspace,
  menuTarget,
  menuBlocked,
  actionsTarget,
  inspectionBlocked,
  previewVisible,
  onPreviewToggle,
  renderAssistantCards,
}: {
  workspace: CreationWorkspace
  menuTarget: HTMLDivElement | null
  menuBlocked: boolean
  actionsTarget: HTMLDivElement | null
  inspectionBlocked: boolean
  previewVisible: boolean
  onPreviewToggle?: () => void
  renderAssistantCards?: (message: AssistantMessage) => ReactNode
}) {
  const { t } = useTranslation()
  const readingTrigger = useRef<HTMLButtonElement>(null)
  const [bundleOpen, setBundleOpen] = useState(false)
  const [gitBusy, setGitBusy] = useState(false)
  const gitVisited = useCreationReadingStore(state => state.gitVisited)
  const [error, setError] = useState<CreationError | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const opening = useCreationStore(state => state.opening)
  const activePath = useCreationFilesStore(state => state.activePath)
  const requestedReadingView = useCreationReadingStore(state => state.view)
  const selected =
    requestedReadingView === 'handoff' ? HANDOFF_PATH : activePath
  // Existing explicit document links enter the ordinary file surface too.
  useEffect(() => {
    if (requestedReadingView === 'handoff')
      useCreationFilesStore.getState().setActivePath(HANDOFF_PATH)
  }, [requestedReadingView])
  const readingExtension = useCreationReadingStore(state => state.extension)
  // Identity-stable dirty set: the tree re-renders when dirty membership
  // changes, not on every editor keystroke.
  const dirtyPaths = new Set(
    useCreationFilesStore(selectDirtyPathKey).split('\n').filter(Boolean)
  )
  const project = workspace.project
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
  const testError = useCreationTestStore(
    state => state.error ?? state.runtimeError
  )
  const watchError = useCreationFilesStore(state => state.error)
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
  const file =
    files.find(file => file.path === selected) ??
    (selected === HANDOFF_PATH
      ? {
          path: HANDOFF_PATH,
          kind: 'text' as const,
          category: 'system' as const,
          size: 0,
        }
      : undefined)
  const chooseFile = (path: string) => {
    if (gitBusy) return
    useCreationFilesStore.getState().setActivePath(path)
    useCreationTestStore.getState().setTab('file')
  }
  const editable = project.source === 'folder'
  const readingView =
    editable && requestedReadingView !== 'handoff'
      ? requestedReadingView
      : 'file'
  const owns = () =>
    useCreationStore.getState().workspace?.project.identity === project.identity
  const dragFile = async (path: string) => {
    try {
      const result = await commands.dragCreationFile(project.identity, path)
      if (owns() && result.status === 'error') setError(result.error)
    } catch (error) {
      if (owns()) setError(creationTransportError(error))
    }
  }
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
          <CreationGitLocation
            identity={project.identity}
            disabled={opening || menuBlocked || gitBusy}
          />,
          menuTarget
        )}
      {actionsTarget &&
        onPreviewToggle &&
        createPortal(
          <button
            type="button"
            data-tauri-drag-region="false"
            className="creation-titlebar-trigger pnds-focus-ring"
            aria-label={t(
              previewVisible ? 'creation.hidePreview' : 'creation.showPreview'
            )}
            title={t(
              previewVisible ? 'creation.hidePreview' : 'creation.showPreview'
            )}
            aria-pressed={previewVisible}
            disabled={opening || inspectionBlocked}
            onClick={onPreviewToggle}
          >
            {previewVisible ? (
              <PanelRightClose
                aria-hidden="true"
                className="rtl:-scale-x-100"
              />
            ) : (
              <PanelRightOpen aria-hidden="true" className="rtl:-scale-x-100" />
            )}
          </button>,
          actionsTarget
        )}
      {actionsTarget &&
        editable &&
        createPortal(
          <button
            type="button"
            data-tauri-drag-region="false"
            className="creation-titlebar-trigger pnds-focus-ring"
            disabled={opening || menuBlocked || gitBusy}
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
        {readingView === 'git' && (
          <CreationGitFiles disabled={opening || menuBlocked || gitBusy} />
        )}
        <div
          hidden={readingView === 'git'}
          className="creation-file-tree-surface"
        >
          <CreationFileTree
            identity={project.identity}
            files={files}
            directories={workspace.directories ?? []}
            selected={selected}
            dirtyPaths={dirtyPaths}
            conflictPaths={conflictPaths}
            disabled={
              opening ||
              menuBlocked ||
              gitBusy ||
              refreshing ||
              readingView === 'git'
            }
            editable={editable}
            onSelect={chooseFile}
            onDrag={dragFile}
            onRefresh={refresh}
            onFinder={finder}
            resources={
              editable ? (
                <CreationResources
                  identity={project.identity}
                  disabled={opening || menuBlocked || gitBusy}
                />
              ) : null
            }
          />
        </div>
      </aside>
      <main
        aria-label={t('creation.workspace')}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <CreationErrorToast
          error={error ?? watchError}
          id={`creation-workspace:${project.identity}`}
        />
        <CreationErrorToast
          error={testError}
          id={`creation-test:${project.identity}`}
          identity={project.identity}
          details
        />
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
          onCloseAutoFocus={event => {
            event.preventDefault()
            if (owns()) readingTrigger.current?.focus()
          }}
        />
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
          </div>
        )}
        {editable && (
          <nav
            className="creation-workspace-tabs"
            aria-label={t('assistant.readingViews')}
          >
            <button
              ref={readingTrigger}
              type="button"
              disabled={gitBusy}
              className="pnds-focus-ring"
              aria-pressed={readingView === 'discussion'}
              onClick={() =>
                useCreationReadingStore.getState().showDiscussion()
              }
            >
              {t('assistant.discussion')}
            </button>
            <button
              type="button"
              disabled={gitBusy}
              className="pnds-focus-ring"
              aria-pressed={readingView === 'git'}
              onClick={() => useCreationReadingStore.getState().showGit()}
            >
              {t('creation.versions.tab')}
            </button>
            {file && (
              <div className="creation-current-file-tab">
                <button
                  type="button"
                  className="pnds-focus-ring"
                  aria-pressed={readingView === 'file'}
                  disabled={gitBusy}
                  title={file.path}
                  onClick={() => useCreationReadingStore.getState().showFile()}
                >
                  {file.path.split('/').at(-1)}
                  {dirtyPaths.has(file.path) && (
                    <span
                      className="creation-dirty-dot"
                      aria-label={t('creation.unsaved')}
                    />
                  )}
                </button>
                <button
                  type="button"
                  className="creation-icon-button pnds-focus-ring"
                  disabled={gitBusy}
                  aria-label={t('creation.tree.closeFile')}
                  onClick={() => {
                    useCreationFilesStore.getState().setActivePath(null)
                    if (readingView === 'file')
                      useCreationReadingStore.getState().showDiscussion()
                  }}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            )}
            {readingView === 'extension' && (
              <span className="min-w-0 truncate text-xs">
                {readingExtension?.title}
              </span>
            )}
          </nav>
        )}
        {editable && (
          <div
            hidden={readingView !== 'discussion'}
            className="creation-file-tab flex min-h-0 flex-1 flex-col"
          >
            <CreationAssistant
              identity={project.identity}
              renderMessageCards={renderAssistantCards}
            />
          </div>
        )}
        {editable && (
          <div
            hidden={readingView !== 'extension'}
            className="creation-file-tab flex min-h-0 flex-1 flex-col overflow-auto"
          >
            {readingExtension?.content}
          </div>
        )}
        {editable && (gitVisited || readingView === 'git') && (
          <div
            hidden={readingView !== 'git'}
            className="creation-file-tab flex min-h-0 flex-1 flex-col"
          >
            <CreationGitPage
              key={project.identity}
              identity={project.identity}
              active={readingView === 'git'}
              onBusyChange={setGitBusy}
            />
          </div>
        )}
        <div
          role="region"
          id={`creation-${project.identity}-file`}
          aria-label={file?.path ?? t('creation.files')}
          hidden={readingView !== 'file'}
          className="creation-file-tab flex min-h-0 flex-1 flex-col"
        >
          {file?.path === HANDOFF_PATH ? (
            <CreationHandoffDocument
              identity={project.identity}
              editable={editable}
            />
          ) : file ? (
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
          hidden={tab !== 'console' || readingView === 'git'}
          className="creation-file-tab creation-console-dock flex min-h-0 flex-col"
        >
          <CreationConsole />
        </div>
      </main>
    </>
  )
}

export function CreationView({
  renderAssistantCards,
  previewVisible = false,
  onPreviewToggle,
}: {
  renderAssistantCards?: (message: AssistantMessage) => ReactNode
  previewVisible?: boolean
  onPreviewToggle?: () => void
} = {}) {
  useAssistantLifecycle()
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
          className="creation-titlebar-status flex items-center gap-1"
          aria-hidden={!workspace}
        />
      </header>
      {menuTarget &&
        createPortal(
          <CreationProjectPicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            disabled={expanded || opening || modePending || commandPending}
            onNewProject={() => setNewProjectOpen(true)}
          />,
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
              renderAssistantCards={renderAssistantCards}
              key={workspace.project.identity}
              workspace={workspace}
              menuTarget={menuTarget}
              menuBlocked={expanded || modePending || commandPending}
              actionsTarget={actionsTarget}
              inspectionBlocked={expanded || modePending}
              previewVisible={previewVisible}
              onPreviewToggle={onPreviewToggle}
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
        <CreationErrorToast
          error={!pickerOpen && !newProjectOpen ? error : null}
          id="creation-project"
        />
        {!pickerOpen && !newProjectOpen && opening && (
          <p role="status" className="p-3 text-xs">
            {t('creation.loading')}
          </p>
        )}
        {newProjectOpen && (
          <CreationNewProject onClose={() => setNewProjectOpen(false)} />
        )}
      </div>
    </>
  )
}
