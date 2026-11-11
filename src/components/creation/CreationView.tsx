import { CreationGitFiles } from './CreationGitFiles'
import { CreationFileTree } from './CreationFileTree'
import { CreationFileLabel } from './CreationFileLabel'
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
import { FolderOpen, Monitor, X } from 'lucide-react'
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
import { notifications } from '@/lib/notifications'
import { useWindowStore } from '@/store/window-store'
import { TrafficLights } from '@/components/shell/TrafficLights'
import { Button } from '@/components/ui/button'
import { CreationFileEditor } from './CreationFileEditor'
import { CreationAssistant } from './CreationAssistant'
import { CreationMaterials } from './CreationMaterials'
import { CreationPendingEditor } from './CreationPendingEditor'
import {
  pendingDraftDirty,
  pendingDraftsParticipant,
  useCreationPendingStore,
} from '@/store/creation-pending-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useAssistantLifecycle } from '@/hooks/use-assistant-lifecycle'
import type { AssistantMessage } from '@/lib/assistant-types'
import { CreationProjectPicker } from './CreationProjectPicker'
import { CreationNewProject } from './CreationNewProject'
import { CreationErrorToast } from './CreationErrorToast'
import { CreationConsole } from './CreationConsole'
import { CreationCompileNotice } from './CreationCompileNotice'
import { useCreationTestStore } from '@/store/creation-test-store'
import { CreationHandoff } from './CreationHandoff'
import { CreationBundle } from './CreationBundle'
import { CreationGitPage } from './CreationGitPage'
import { CreationGitHubAvatar } from './CreationGitHubAvatar'
import { CreationGitHubClone } from './CreationGitHubClone'
import { refreshGithubAuth, useGithubAuthStore } from './creation-github-data'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  creationHandoffParticipant,
  HANDOFF_PATH,
} from '@/store/creation-handoff-store'

function ReadingWorkspace({
  workspace,
  menuTarget,
  menuBlocked,
  expanded,
  pickerOpen,
  onPickerOpenChange,
  onNewProject,
  onCloneProject,
  renderAssistantCards,
}: {
  workspace: CreationWorkspace
  menuTarget: HTMLDivElement | null
  menuBlocked: boolean
  expanded: boolean
  pickerOpen: boolean
  onPickerOpenChange: (open: boolean) => void
  onNewProject: () => void
  onCloneProject: (trigger: HTMLButtonElement | null) => void
  renderAssistantCards?: (message: AssistantMessage) => ReactNode
}) {
  const { t } = useTranslation()
  const githubAccount = useGithubAuthStore(state => state.status?.account)
  const readingTrigger = useRef<HTMLButtonElement>(null)
  const pickerTrigger = useRef<HTMLButtonElement>(null)
  const [bundleOpen, setBundleOpen] = useState(false)
  const [gitBusy, setGitBusy] = useState(false)
  const gitVisited = useCreationReadingStore(state => state.gitVisited)
  const [error, setError] = useState<CreationError | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const opening = useCreationStore(state => state.opening)
  const activePath = useCreationFilesStore(state => state.activePath)
  const pendingId = useCreationPendingStore(state => state.activeId)
  const pendingDraft = useCreationPendingStore(state =>
    pendingId ? state.drafts[pendingId] : undefined
  )
  const pendingDocument = useCreationPendingStore(state =>
    state.documents.find(document => document.id === pendingId)
  )
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
    useCreationPendingStore.setState({ activeId: null })
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
          <>
            {expanded ? (
              <span
                className="creation-titlebar-project-name creation-github-title"
                title={project.name}
              >
                {githubAccount && (
                  <CreationGitHubAvatar account={githubAccount} />
                )}
                <span className="creation-titlebar-name">{project.name}</span>
              </span>
            ) : (
              <CreationProjectPicker
                triggerRef={pickerTrigger}
                open={pickerOpen}
                onOpenChange={onPickerOpenChange}
                disabled={opening || menuBlocked || gitBusy}
                onNewProject={onNewProject}
                onCloneProject={onCloneProject}
                onGenerateBundle={
                  editable ? () => setBundleOpen(true) : undefined
                }
              />
            )}
            <CreationGitLocation
              identity={project.identity}
              disabled={opening || menuBlocked || gitBusy}
              plain={expanded}
            />
          </>,
          menuTarget
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
                <>
                  <CreationResources
                    identity={project.identity}
                    disabled={opening || menuBlocked || gitBusy}
                  />
                </>
              ) : null
            }
          />
          {editable && (
            <CreationMaterials
              key={project.identity}
              identity={project.identity}
              disabled={opening || menuBlocked || gitBusy}
            />
          )}
        </div>
      </aside>
      <main
        aria-label={t('creation.workspace')}
        className="creation-workspace flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
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
          <DialogContent
            onCloseAutoFocus={event => {
              event.preventDefault()
              pickerTrigger.current?.focus()
            }}
          >
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
        <CreationCompileNotice />
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
            {(file || pendingId) && (
              <div className="creation-current-file-tab">
                <button
                  type="button"
                  className="pnds-focus-ring"
                  aria-pressed={
                    readingView === 'file' || readingView === 'pending'
                  }
                  disabled={gitBusy}
                  onClick={() =>
                    pendingId
                      ? useCreationReadingStore.getState().showPending()
                      : useCreationReadingStore.getState().showFile()
                  }
                >
                  {pendingId ? (
                    <span>
                      {pendingDraft?.name ||
                        pendingDocument?.name ||
                        t('creation.pending.untitled')}
                    </span>
                  ) : (
                    file && (
                      <CreationFileLabel
                        path={file.path}
                        name={file.path.split('/').at(-1) ?? file.path}
                      />
                    )
                  )}
                  {(pendingDraft
                    ? pendingDraftDirty(pendingDraft)
                    : file && dirtyPaths.has(file.path)) && (
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
                    if (pendingId) {
                      useCreationPendingStore.getState().close()
                      return
                    }
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
          hidden={readingView !== 'pending'}
          className="creation-file-tab flex min-h-0 flex-1 flex-col"
        >
          {pendingId && (
            <CreationPendingEditor
              key={`${project.identity}:${pendingId}`}
              id={pendingId}
              identity={project.identity}
            />
          )}
        </div>
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
          hidden={tab !== 'console'}
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
}: {
  renderAssistantCards?: (message: AssistantMessage) => ReactNode
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
  const [pickerOpen, setPickerOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [cloneOpen, setCloneOpen] = useState(false)
  const cloneTrigger = useRef<HTMLButtonElement | null>(null)
  const openClone = (trigger: HTMLButtonElement | null) => {
    cloneTrigger.current = trigger
    setCloneOpen(true)
  }
  useEffect(() => {
    void refreshGithubAuth()
  }, [])
  useEffect(() => {
    if (pickerOpen || newProjectOpen || cloneOpen || !opening) return
    const id = 'creation-project-opening'
    notifications.flow.step(id, t('creation.loading'))
    return () => notifications.flow.dismiss(id)
  }, [opening, pickerOpen, newProjectOpen, cloneOpen, t])
  useEffect(() => registerCreationParticipant(creationDraftsParticipant), [])
  useEffect(() => registerCreationParticipant(pendingDraftsParticipant), [])
  useEffect(() => registerCreationParticipant(creationHandoffParticipant), [])
  useLayoutEffect(() => {
    // AppKit's button origin is 9px inside its container: 18 gives a
    // 9px visible top inset for the 14px buttons in the 32px titlebar.
    // Reapply after Monitor changes layout even when this titlebar stays mounted.
    void syncNativeWindowControls(true, -12, 1, 18)
    return () => {
      if (!useCreationStore.getState().active)
        void syncNativeWindowControls(true)
    }
  }, [expanded, fullscreen])
  return (
    <>
      <header
        data-creation-topbar=""
        data-tauri-drag-region="deep"
        className="desktop-creation-topbar"
      >
        <TrafficLights />
        <div ref={setMenuTarget} className="creation-titlebar-project" />
        {workspace && (
          <button
            type="button"
            data-tauri-drag-region="false"
            className="creation-titlebar-trigger creation-titlebar-monitor pnds-focus-ring"
            aria-label={t(
              expanded ? 'creation.restoreWorkspace' : 'creation.expandMonitor'
            )}
            aria-expanded={expanded}
            aria-controls="creation-monitor"
            disabled={opening || modePending || commandPending}
            onClick={() => {
              setPickerOpen(false)
              const monitor = useCreationTestStore.getState()
              monitor.setExpanded(!monitor.expanded)
            }}
          >
            <Monitor aria-hidden="true" />
          </button>
        )}
      </header>
      {!workspace &&
        menuTarget &&
        createPortal(
          <CreationProjectPicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            disabled={expanded || opening || modePending || commandPending}
            onNewProject={() => setNewProjectOpen(true)}
            onCloneProject={openClone}
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
              expanded={expanded}
              pickerOpen={pickerOpen}
              onPickerOpenChange={setPickerOpen}
              onNewProject={() => setNewProjectOpen(true)}
              onCloneProject={openClone}
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
          error={!pickerOpen && !newProjectOpen && !cloneOpen ? error : null}
          id="creation-project"
        />
        {newProjectOpen && (
          <CreationNewProject onClose={() => setNewProjectOpen(false)} />
        )}
        {cloneOpen && (
          <CreationGitHubClone
            onClose={() => setCloneOpen(false)}
            onCloseAutoFocus={event => {
              event.preventDefault()
              const trigger = cloneTrigger.current
              cloneTrigger.current = null
              if (trigger?.isConnected) trigger.focus()
              else
                menuTarget
                  ?.querySelector<HTMLButtonElement>(
                    '[data-creation-project-picker]'
                  )
                  ?.focus()
            }}
          />
        )}
      </div>
    </>
  )
}
