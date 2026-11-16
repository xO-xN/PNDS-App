import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, GitBranch, Save } from 'lucide-react'
import { notifications } from '@/lib/notifications'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  commands,
  type CreationError,
  type CreationGitStatus,
  type GitVersionGraph,
  type GitRecordReceipt,
  type GitRecordPreview,
  type GitComparisonDiff,
  type GitMergeProbe,
} from '@/lib/tauri-bindings'
import {
  creationTransportError,
  useCreationStore,
} from '@/store/creation-store'
import {
  useCreationFilesStore,
  selectDirtyPathKey,
  isDraftDirty,
  type CreationDraft,
} from '@/store/creation-files-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useSessionStore } from '@/store/session-store'
import { useAssistantStore } from '@/store/assistant-store'
import {
  pendingDraftDirty,
  useCreationPendingStore,
} from '@/store/creation-pending-store'
import { useParameterPreviewStore } from '@/store/parameter-preview-store'
import {
  currentGitRuntime,
  endGitTask,
  saveGitVersion,
  prepareGitVersionSwitch,
  validatePreparedGitSwitch,
  switchGitVersion,
  renameGitVersion,
  type updateGitVersion,
  type CompletedGitOperation,
  unfinishedGitTask,
  type GitOperationPhase,
  type PreparedGitSwitch,
} from '@/lib/creation-git-workflow'
import { CreationGitGraph } from './CreationGitGraph'
import { CreationGitVersionDetails } from './CreationGitVersionDetails'
import './creation-version-page.css'
import { CreationErrorNotice } from './CreationErrorNotice'
import { CreationGitDifference } from './CreationGitDifference'
import { CreationGitHubSync } from './CreationGitHubSync'
import { CreationMergeWorkspace } from './CreationMergeWorkspace'
import { useCreationMergeStore } from '@/store/creation-merge-store'
import { captureCreationDrafts } from '@/lib/creation-lifecycle'
import {
  blockCreationTerminalOpen,
  confirmCreationTerminalLeave,
  endCreationTerminalForLeave,
} from '@/lib/creation-terminal-leave'

interface GitFeedback {
  id: string
  pending: boolean
  completion?: CompletedGitOperation
  taskEnded?: boolean
}

interface SwitchReview {
  commit: string
  branch: string | null
  head: string | null
  changes: string[]
  overwrittenPaths: string[]
  prepared: PreparedGitSwitch
  context: string
  statusKey: string
  drafts: Readonly<Record<string, CreationDraft>>
  runtime: ReturnType<typeof currentGitRuntime>
  task: boolean
  discard: boolean
}

const gitTaskIdentity = () => {
  const state = useAssistantStore.getState()
  return JSON.stringify([
    state.phase,
    state.paused,
    state.canContinue,
    state.resumeRestored,
    state.activeConversationId,
    state.activeQuestion?.taskId,
    state.resourceApproval?.taskId,
  ])
}

const blocksRemoteUpdate = (
  status: ReturnType<typeof useParameterPreviewStore.getState>['status']
) => ['checking', 'temporary', 'restoring', 'unrestored'].includes(status)

export function CreationGitPage({
  identity,
  active,
  onBusyChange,
}: {
  identity: string
  active: boolean
  onBusyChange: (busy: boolean) => void
}) {
  const { t } = useTranslation()
  const [graph, setGraph] = useState<GitVersionGraph | null>(null)
  const [status, setStatus] = useState<CreationGitStatus | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const merge = useCreationMergeStore(state =>
    state.identity === identity ? state.candidate : null
  )
  const mergeCompleted = useCreationMergeStore(state =>
    state.identity === identity ? state.completed : null
  )
  const mergeError = useCreationMergeStore(state =>
    state.identity === identity ? state.error : null
  )
  const [mergeProbe, setMergeProbe] = useState<GitMergeProbe | null>(null)
  const [mergeHovered, setMergeHovered] = useState(false)
  const [mergeLocalError, setMergeLocalError] = useState<CreationError | null>(
    null
  )
  const [mergePreparation, setMergePreparation] = useState<{
    source: string
    changes: boolean
    task: boolean
  } | null>(null)
  const [mergePreparing, setMergePreparing] = useState(false)
  const completedMerge = useRef<string | null>(null)
  const mode = useCreationReadingStore(state => state.gitComparisonMode)
  const setMode = useCreationReadingStore(state => state.setGitComparisonMode)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const [fullContext, setFullContext] = useState(false)
  const [diff, setDiff] = useState<GitComparisonDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [branchName, setBranchName] = useState('')
  const [localBusy, setBusy] = useState(false)
  const [remoteBusy, setRemoteBusy] = useState(false)
  const busy = localBusy || remoteBusy || mergePreparing
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<CreationError | null>(null)
  const [receipt, setReceipt] = useState<GitRecordReceipt | null>(null)
  const [recordPreview, setRecordPreview] = useState<GitRecordPreview | null>(
    null
  )
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [renamingBusy, setRenamingBusy] = useState(false)
  const [switchReview, setSwitchReview] = useState<SwitchReview | null>(null)
  const switchButton = useRef<HTMLButtonElement>(null)
  const switchFiles = useRef<HTMLDivElement>(null)
  const renamePending = useRef<Promise<boolean> | null>(null)
  const [syncPending, setSyncPending] = useState(false)
  const branchTarget = useCreationReadingStore(state => state.gitTarget)
  const [recoveredTask, setRecoveredTask] = useState(false)
  const comparison = useCreationReadingStore(state => state.gitComparison)
  const comparisonPhase = useCreationReadingStore(
    state => state.gitComparisonPhase
  )
  const path = useCreationReadingStore(state => state.gitPath)
  const gitRevision = useCreationReadingStore(state => state.gitRevision)
  const workspaceFiles = useCreationStore(state => state.workspace?.files)
  const alive = useRef(true)
  const activeRef = useRef(active)
  const operation = useRef(false)
  const remoteUpdate = useRef(false)
  const feedback = useRef<GitFeedback | null>(null)
  const recovery = useRef<GitFeedback | null>(null)
  const readFailure = useRef<CreationError | null>(null)
  const readErrorSignature = useRef<string | null>(null)
  const request = useRef(0)
  const switchRequest = useRef(0)
  const selectionEpoch = useRef(0)
  const graphScroll = useRef<HTMLDivElement>(null)
  const intent = useCreationReadingStore(state => state.gitIntent)
  const intentRevision = useCreationReadingStore(
    state => state.gitIntentRevision
  )
  const dirty = useCreationFilesStore(selectDirtyPathKey)
  const drafts = useCreationFilesStore(state => state.drafts)
  const pendingDrafts = useCreationPendingStore(state =>
    Object.values(state.drafts).some(pendingDraftDirty)
  )
  const previewStatus = useParameterPreviewStore(state => state.status)
  const previewActive = blocksRemoteUpdate(previewStatus)
  const revision = useCreationFilesStore(state => state.revision)
  const phase = useAssistantStore(state => state.phase)
  const resumable = useAssistantStore(
    state => state.canContinue || state.paused || state.resumeRestored
  )
  const taskIdentity = useAssistantStore(state =>
    JSON.stringify([
      state.phase,
      state.paused,
      state.canContinue,
      state.resumeRestored,
      state.activeConversationId,
      state.activeQuestion?.taskId,
      state.resourceApproval?.taskId,
    ])
  )
  const session = useSessionStore(state => state.sessionStatus)
  const runningGeneration = useSessionStore(
    state => state.latestSnapshot?.runtimeGeneration ?? null
  )
  const runningId = useSessionStore(state => state.runId)
  const runningPath = useSessionStore(state => state.sessionProjectPath)
  const commandPending = useSessionStore(state => state.commandPending)
  const editable = useCreationStore(
    state => state.workspace?.project.source === 'folder'
  )
  const hasTask = phase !== 'idle' || resumable || recoveredTask
  const hasChanges = Boolean(
    dirty ||
    status?.changes.length ||
    (status?.state === 'notRepository' && workspaceFiles?.length)
  )
  const working = selected === 'working' || (!graph?.head && editable)
  const writing = busy && !renamingBusy
  const updateBlock =
    hasChanges || pendingDrafts
      ? 'drafts'
      : hasTask
        ? 'task'
        : session !== 'idle' || commandPending || previewActive
          ? 'runtime'
          : null
  const inspected = graph?.versions.find(version => version.id === selected)
  const inspectingCurrent = Boolean(inspected && inspected.id === graph?.head)
  const atBranchTip = Boolean(status?.branch)
  const requestedBranch =
    branchTarget?.commit === selected ? branchTarget.branch : null
  const changesBranch = Boolean(
    requestedBranch && requestedBranch !== status?.branch
  )
  const selectedTips = inspected
    ? (graph?.branches.filter(branch => branch.tip === inspected.id) ?? [])
    : []
  const branchForSelection =
    requestedBranch ??
    (inspectingCurrent
      ? null
      : selectedTips.length === 1
        ? (selectedTips[0]?.name ?? null)
        : null)

  const excludedFiles =
    recordPreview?.files.filter(file => !file.defaultSelected) ?? []
  const statusUnavailable = Boolean(
    status && !['available', 'notRepository'].includes(status.state)
  )
  const hasDetails = Boolean(
    error ||
    receipt?.warning ||
    excludedFiles.length ||
    statusUnavailable ||
    syncPending
  )
  const readToastId = `creation-git-reading:${identity}`
  const owns = () =>
    alive.current &&
    useCreationStore.getState().workspace?.project.identity === identity
  useEffect(() => {
    alive.current = true
    const dismiss = () => {
      switchRequest.current++
      if (feedback.current?.pending)
        notifications.flow.dismiss(feedback.current.id)
      feedback.current = null
      recovery.current = null
      readErrorSignature.current = null
      notifications.flow.dismiss(readToastId)
    }
    const unsubscribe = useCreationStore.subscribe(state => {
      if (state.workspace?.project.identity !== identity) dismiss()
    })
    return () => {
      alive.current = false
      unsubscribe()
      dismiss()
    }
  }, [identity, readToastId])
  useEffect(() => {
    activeRef.current = active
    if (!active) notifications.flow.dismiss(readToastId)
  }, [active, readToastId])
  const reportReadError = (cause: unknown) => {
    const problem = creationTransportError(cause)
    readFailure.current = problem
    setError(problem)
    const signature = JSON.stringify([problem.code, problem.detail])
    if (
      activeRef.current &&
      !operation.current &&
      readErrorSignature.current !== signature
    ) {
      readErrorSignature.current = signature
      notifications.flow.fail(
        readToastId,
        t('creation.versions.feedback.failed'),
        problem.detail
      )
    }
  }
  const reportReadErrorFromEffect = useEffectEvent((cause: unknown) => {
    reportReadError(cause)
  })
  const readStatus = async (current: () => boolean) => {
    const result = await commands.getCreationGitStatus(identity)
    if (!current()) return null
    if (result.status === 'error') throw result.error
    const status = result.data
    if (
      status.state !== 'available' ||
      !status.changes.some(change => change.untracked)
    )
      return status
    const files = await commands.getCreationGitRecordFiles(identity)
    if (!current()) return null
    if (files.status === 'error') throw files.error
    const eligible = new Set(
      files.data.filter(file => file.defaultSelected).map(file => file.path)
    )
    return {
      ...status,
      changes: status.changes.filter(
        change =>
          !change.untracked || change.staged || eligible.has(change.path)
      ),
    }
  }
  const reload = async (offset = 0) => {
    const sequence = ++request.current
    readFailure.current = null
    setLoading(true)
    try {
      const statusResult = await readStatus(
        () => owns() && sequence === request.current
      )
      if (!statusResult) return false
      setStatus(statusResult)
      if (!['available', 'notRepository'].includes(statusResult.state)) {
        reportReadError({
          code: 'io',
          detail:
            statusResult.detail ??
            t(`creation.git.state.${statusResult.state}`),
        })
        return false
      }
      if (!statusResult.head) {
        setGraph({
          head: null,
          branches: [],
          versions: [],
          nextOffset: null,
          limited: false,
        })
        setSelected(previous => previous ?? 'working')
        readErrorSignature.current = null
        return true
      }
      const result = await commands.getCreationGitVersions(identity, offset)
      if (!owns() || sequence !== request.current) return false
      if (result.status === 'error') throw result.error
      setGraph(previous => {
        const sameRefs =
          previous?.head === result.data.head &&
          JSON.stringify(previous.branches) ===
            JSON.stringify(result.data.branches)
        if (!previous || !sameRefs) return result.data
        return {
          ...result.data,
          versions: offset
            ? [
                ...previous.versions,
                ...result.data.versions.filter(
                  v => !previous.versions.some(old => old.id === v.id)
                ),
              ]
            : [
                ...result.data.versions,
                ...previous.versions.filter(
                  v => !result.data.versions.some(fresh => fresh.id === v.id)
                ),
              ],
          nextOffset: offset ? result.data.nextOffset : previous.nextOffset,
          limited: offset ? result.data.limited : previous.limited,
        }
      })
      setSelected(
        previous =>
          previous ??
          (statusResult.changes.length ||
          selectDirtyPathKey(useCreationFilesStore.getState())
            ? 'working'
            : result.data.head)
      )
      readErrorSignature.current = null
      return true
    } catch (cause) {
      if (owns() && sequence === request.current) reportReadError(cause)
      return false
    } finally {
      if (owns() && sequence === request.current) setLoading(false)
    }
  }
  const reloadFromEffect = useEffectEvent(() => {
    void reload()
  })
  // Keep this page mounted when hidden; merely navigating never saves or stops.
  useEffect(() => {
    if (active) reloadFromEffect()
  }, [active, identity, revision])
  useEffect(() => {
    if (!active) return
    const refresh = () => {
      setRefreshRevision(value => value + 1)
      reloadFromEffect()
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [active])
  const comparisonSnapshot = useRef<string | null>(null)
  // Native comparison tokens describe one current read scope. Serialize catalog
  // requests and skip superseded selections before dispatching a new scope.
  const comparisonQueue = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    if (!active || !selected) return
    const snapshot = JSON.stringify([
      identity,
      selected,
      mode,
      graph?.head,
      revision,
      gitRevision,
      refreshRevision,
    ])
    if (comparisonSnapshot.current === snapshot) return
    comparisonSnapshot.current = null
    fileSnapshot.current = null
    let live = true
    useCreationReadingStore.getState().setGitComparison(null)
    setDiff(null)
    comparisonQueue.current = comparisonQueue.current
      .then(async () => {
        if (
          !live ||
          !alive.current ||
          useCreationStore.getState().workspace?.project.identity !== identity
        )
          return
        return commands.getCreationGitComparison(identity, {
          commit: selected === 'working' ? null : selected,
          mode: selected === 'working' ? 'saved' : mode,
          parent: null,
        })
      })
      .then(result => {
        if (
          !result ||
          !live ||
          !alive.current ||
          useCreationStore.getState().workspace?.project.identity !== identity
        )
          return
        if (result.status === 'error') {
          useCreationReadingStore.getState().setGitComparison(null, 'error')
          reportReadErrorFromEffect(result.error)
        } else {
          comparisonSnapshot.current = snapshot
          useCreationReadingStore.getState().setGitComparison(result.data)
        }
      })
      .catch(cause => {
        if (
          live &&
          alive.current &&
          useCreationStore.getState().workspace?.project.identity === identity
        ) {
          useCreationReadingStore.getState().setGitComparison(null, 'error')
          reportReadErrorFromEffect(cause)
        }
      })
    return () => {
      live = false
    }
  }, [
    identity,
    selected,
    mode,
    graph?.head,
    revision,
    gitRevision,
    refreshRevision,
    active,
  ])
  const fileSnapshot = useRef<string | null>(null)
  useEffect(() => {
    if (!active || !comparison || !path) {
      setDiffLoading(false)
      return
    }
    const snapshot = JSON.stringify([
      identity,
      comparison.token,
      path,
      fullContext,
      revision,
      refreshRevision,
    ])
    if (fileSnapshot.current === snapshot) return
    fileSnapshot.current = null
    let live = true
    setDiff(null)
    setDiffLoading(true)
    void commands
      .readCreationGitComparisonFile(identity, {
        token: comparison.token,
        path,
        fullContext,
      })
      .then(result => {
        if (
          !live ||
          !alive.current ||
          useCreationStore.getState().workspace?.project.identity !== identity
        )
          return
        if (result.status === 'error') reportReadErrorFromEffect(result.error)
        else {
          fileSnapshot.current = snapshot
          setDiff(result.data)
        }
      })
      .catch(cause => {
        if (
          live &&
          alive.current &&
          useCreationStore.getState().workspace?.project.identity === identity
        )
          reportReadErrorFromEffect(cause)
      })
      .finally(() => {
        if (live) setDiffLoading(false)
      })
    return () => {
      live = false
    }
  }, [
    identity,
    comparison,
    path,
    fullContext,
    revision,
    refreshRevision,
    active,
  ])
  const step = (phase: GitOperationPhase) => {
    const current = feedback.current
    if (current?.pending && owns())
      notifications.flow.step(
        current.id,
        t(`creation.versions.progress.${phase}`)
      )
  }
  const finishFeedback = (
    current: GitFeedback,
    kind: 'succeed' | 'warn' | 'fail' | 'message',
    key: string,
    description?: string,
    refresh = false
  ) => {
    if (!owns() || feedback.current !== current) return
    current.pending = false
    notifications.flow[kind](
      current.id,
      t(key),
      description,
      refresh
        ? {
            action: {
              label: t('creation.git.refresh'),
              onClick: event => {
                event.preventDefault()
                if (
                  !owns() ||
                  operation.current ||
                  feedback.current !== current
                )
                  return
                void run(() => refreshFeedback(current), undefined, current)
              },
            },
          }
        : undefined
    )
  }
  const completeFeedback = (
    current: GitFeedback,
    refreshed: boolean,
    failure = current.completion?.error?.detail ?? readFailure.current?.detail
  ) => {
    const completion = current.completion
    const outcome =
      completion?.outcome ?? (current.taskEnded ? 'taskEnded' : null)
    if (!outcome) {
      finishFeedback(
        current,
        refreshed ? 'message' : 'fail',
        refreshed
          ? 'creation.versions.noChanges'
          : 'creation.versions.feedback.failed',
        refreshed ? undefined : failure
      )
      return
    }
    const failedRefreshKey =
      outcome === 'taskEnded'
        ? 'creation.versions.feedback.taskEnded'
        : outcome === 'updated'
          ? 'creation.github.updateRefreshFailed'
          : `creation.versions.feedback.${outcome}RefreshFailed`
    const resultKey =
      outcome === 'saved'
        ? 'creation.version.success'
        : outcome === 'taskEnded'
          ? 'creation.versions.feedback.taskEnded'
          : outcome === 'updated'
            ? 'creation.github.updated'
            : `creation.versions.${outcome}`
    if (!refreshed) {
      finishFeedback(
        current,
        'warn',
        failedRefreshKey,
        [
          ...new Set(
            [
              completion?.receipt?.warning,
              completion?.needsSync
                ? t('creation.files.syncPending')
                : undefined,
              failure,
              !completion?.needsSync && !failure
                ? completion?.description
                : undefined,
            ].filter(Boolean)
          ),
        ].join('\n') || undefined,
        true
      )
    } else
      finishFeedback(
        current,
        completion?.receipt?.warning ? 'warn' : 'succeed',
        resultKey,
        completion?.receipt?.warning ?? completion?.description
      )
  }
  const recoverFeedback = async (current: GitFeedback) => {
    const completion = current.completion
    const refreshed = completion
      ? await completion.recover(reload, step, owns)
      : await reload()
    if (!owns()) return false
    setSyncPending(completion?.needsSync ?? false)
    recovery.current = completion?.pending ? current : null
    if (completion?.error) setError(completion.error)
    return refreshed
  }
  const refreshFeedback = async (current: GitFeedback) => {
    const refreshed = await recoverFeedback(current)
    if (owns()) completeFeedback(current, refreshed)
  }
  const run = async (
    work: () => Promise<void>,
    initialPhase?: GitOperationPhase,
    continuing?: GitFeedback
  ) => {
    if (operation.current || remoteUpdate.current) return
    operation.current = true
    const current: GitFeedback | undefined = initialPhase
      ? { id: `creation-git:${crypto.randomUUID()}`, pending: true }
      : continuing
    if (current) {
      if (feedback.current?.pending)
        notifications.flow.dismiss(feedback.current.id)
      feedback.current = current
      current.pending = true
      step(initialPhase ?? 'refreshing')
    }
    setBusy(true)
    setRenamingBusy(initialPhase === 'renaming')
    setError(null)
    notifications.flow.dismiss(readToastId)
    onBusyChange(initialPhase !== 'renaming')
    try {
      await work()
    } catch (cause) {
      if (owns()) {
        const problem = creationTransportError(cause)
        setError(problem)
        if (current) {
          if (current.completion?.outcome === 'saved')
            finishFeedback(
              current,
              'warn',
              'creation.versions.feedback.savedActionFailed',
              [
                ...new Set(
                  [current.completion?.receipt?.warning, problem.detail].filter(
                    Boolean
                  )
                ),
              ].join('\n'),
              true
            )
          else if (current.completion?.outcome || current.taskEnded)
            completeFeedback(current, false, problem.detail)
          else
            finishFeedback(
              current,
              'fail',
              'creation.versions.feedback.failed',
              problem.detail
            )
        }
      }
    } finally {
      if (current?.pending) {
        notifications.flow.dismiss(current.id)
        current.pending = false
      }
      operation.current = false
      onBusyChange(false)
      if (owns()) {
        setBusy(false)
        setRenamingBusy(false)
      }
    }
  }
  const save = async () => {
    const result = await saveGitVersion(identity, name ?? '', branchName, step)
    if (!owns()) return
    if (feedback.current) {
      feedback.current.completion = result.completion
      recovery.current = feedback.current
    }
    setRecordPreview(result.preview)
    setSaveOpen(false)
    setSwitchReview(null)
    if (result.receipt) {
      setReceipt(result.receipt)
      setMode('parent')
      setSelected(result.receipt.commit)
      locateAfterSave.current = result.receipt.commit
      setName(null)
      setBranchName('')
    }
    if (feedback.current) await refreshFeedback(feedback.current)
  }
  const cancelSwitchReview = useEffectEvent(() => {
    switchRequest.current++
    setSwitchReview(null)
  })
  useEffect(() => {
    cancelSwitchReview()
  }, [
    identity,
    active,
    drafts,
    revision,
    mode,
    phase,
    resumable,
    taskIdentity,
    session,
    runningGeneration,
    runningId,
    runningPath,
    commandPending,
    previewStatus,
    gitRevision,
    status?.head,
    status?.branch,
  ])
  useEffect(() => {
    selectionEpoch.current++
  }, [
    identity,
    active,
    drafts,
    revision,
    mode,
    phase,
    resumable,
    taskIdentity,
    session,
    runningGeneration,
    runningId,
    runningPath,
    commandPending,
    previewStatus,
  ])
  const outsideReview = useEffectEvent((event: Event) => {
    if (
      switchReview &&
      (!(event.target instanceof Node) ||
        (!switchButton.current?.contains(event.target) &&
          !switchFiles.current?.contains(event.target)))
    )
      cancelSwitchReview()
  })
  useEffect(() => {
    const outside = (event: Event) => outsideReview(event)
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelSwitchReview()
    }
    const blur = () => cancelSwitchReview()
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('blur', blur)
    }
  }, [])
  useEffect(() => {
    if (switchReview && !busy) switchButton.current?.focus()
  }, [switchReview, busy])
  useEffect(() => {
    useCreationReadingStore.getState().setGitComparisonWorking(working)
  }, [working])
  useEffect(() => {
    if (selected === 'working' && !hasChanges && !loading && graph?.head) {
      setSelected(graph.head)
      setMode('parent')
    }
  }, [selected, hasChanges, loading, graph?.head, setMode])
  const switchContext = () =>
    JSON.stringify([
      currentGitRuntime(),
      gitTaskIdentity(),
      useCreationFilesStore.getState().revision,
      useCreationReadingStore.getState().gitComparisonMode,
      useCreationReadingStore.getState().gitRevision,
      useParameterPreviewStore.getState().status,
    ])
  const prepareSwitch = async (commit: string, branch: string | null) => {
    const sequence = ++switchRequest.current
    const capturedRuntime = currentGitRuntime()
    const capturedDrafts = useCreationFilesStore.getState().drafts
    const context = switchContext()
    const current = () =>
      owns() &&
      activeRef.current &&
      sequence === switchRequest.current &&
      capturedDrafts === useCreationFilesStore.getState().drafts &&
      context === switchContext()
    const fresh = await readStatus(current)
    if (!fresh) return null
    if (fresh.state !== 'available')
      throw {
        code: 'io',
        detail: fresh.detail ?? t(`creation.git.state.${fresh.state}`),
      }
    const pending = await commands.getCreationGitTaskPending(identity)
    if (!current()) return null
    if (pending.status === 'error') throw pending.error
    setStatus(fresh)
    setRecoveredTask(pending.data)
    const draftPaths = Object.entries(capturedDrafts)
      .filter(([, draft]) => isDraftDirty(draft))
      .map(([path]) => path)
    if (
      !branch &&
      fresh.head === commit &&
      !fresh.changes.length &&
      !draftPaths.length
    )
      return null
    // Preview may reveal excluded local files that the target will replace.
    // It grants no writes; keep this exact token for the explicit confirmation.
    const prepared = await prepareGitVersionSwitch(
      identity,
      commit,
      true,
      branch ?? undefined,
      capturedRuntime,
      fresh.head
    )
    if (!current()) return null
    const overwrittenPaths = prepared.preview.overwrittenPaths ?? []
    const changes = [
      ...new Set([
        ...fresh.changes.map(change => change.path),
        ...draftPaths,
        ...prepared.preview.discardedPaths,
      ]),
    ].sort()
    const review: SwitchReview = {
      commit,
      branch,
      head: fresh.head,
      changes,
      overwrittenPaths,
      prepared,
      context,
      statusKey: JSON.stringify([fresh.head, fresh.branch, fresh.changes]),
      drafts: capturedDrafts,
      runtime: capturedRuntime,
      task: pending.data || unfinishedGitTask(),
      discard: Boolean(changes.length || overwrittenPaths.length),
    }
    return review
  }
  const executeSwitch = async (review: SwitchReview) => {
    const releaseTerminal = blockCreationTerminalOpen()
    try {
      if (!(await confirmCreationTerminalLeave(identity))) return
      if (!owns()) return
      validatePreparedGitSwitch(review.prepared)
      await endCreationTerminalForLeave(identity)
      if (!owns()) return
      validatePreparedGitSwitch(review.prepared)
      const restoring = review.commit === review.head && !review.branch
      if (review.task) {
        step('endingTask')
        await endGitTask(identity)
        if (!owns()) return
        setRecoveredTask(false)
        if (feedback.current) feedback.current.taskEnded = true
      }
      if (
        Object.entries(useCreationFilesStore.getState().drafts).some(
          ([path, draft]) =>
            isDraftDirty(draft) && draft !== review.drafts[path]
        )
      )
        throw new Error(t('creation.versions.draftBlocked'))
      const completion = await switchGitVersion(
        identity,
        review.commit,
        review.discard,
        review.branch ?? undefined,
        progress =>
          step(progress === 'switching' && restoring ? 'restoring' : progress),
        review.runtime,
        review.prepared
      )
      if (!owns()) return
      if (feedback.current) {
        feedback.current.completion = completion
        recovery.current = feedback.current
      }
      setSelected(review.commit)
      if (feedback.current) await refreshFeedback(feedback.current)
    } finally {
      releaseTerminal()
    }
  }

  const requestSwitch = (
    commit = inspected?.id,
    branch: string | null = null
  ) => {
    if (!commit) return
    const acknowledged = switchReview
    const taskVisible = hasTask
    setSwitchReview(null)
    void run(async () => {
      if (
        acknowledged &&
        acknowledged.commit === commit &&
        acknowledged.branch === branch &&
        acknowledged.drafts === useCreationFilesStore.getState().drafts &&
        acknowledged.context === switchContext()
      ) {
        const sequence = ++switchRequest.current
        const current = () =>
          owns() &&
          activeRef.current &&
          sequence === switchRequest.current &&
          acknowledged.drafts === useCreationFilesStore.getState().drafts &&
          acknowledged.context === switchContext()
        const fresh = await readStatus(current)
        if (!fresh) return
        if (fresh.state !== 'available')
          throw {
            code: 'io',
            detail: fresh.detail ?? t(`creation.git.state.${fresh.state}`),
          }
        if (
          acknowledged.statusKey ===
          JSON.stringify([fresh.head, fresh.branch, fresh.changes])
        ) {
          await executeSwitch(acknowledged)
          return
        }
        const changed = await prepareSwitch(commit, branch)
        if (changed) setSwitchReview(changed)
        return
      }
      const review = await prepareSwitch(commit, branch)
      if (!review) return
      if (review.discard || (review.task && !taskVisible)) {
        setSwitchReview(review)
        return
      }
      await executeSwitch(review)
    }, 'checking')
  }
  const handledIntent = useRef(0)
  const performIntent = useEffectEvent(() => {
    if (branchTarget) {
      selectionEpoch.current++
      setSelected(branchTarget.commit)
      requestSwitch(branchTarget.commit, branchTarget.branch)
    } else if (intent === 'status') {
      setSelected('working')
      setFullContext(false)
    }
  })
  useEffect(() => {
    if (!active || handledIntent.current === intentRevision) return
    handledIntent.current = intentRevision
    performIntent()
  }, [active, intent, intentRevision])
  const renameVersion = (target: {
    commit: string
    expected: string
    name: string
  }) => {
    let saved = false
    const pending = run(async () => {
      const completion = await renameGitVersion(identity, target)
      if (!owns()) return
      if (feedback.current) {
        feedback.current.completion = completion
        recovery.current = feedback.current
      }
      saved = true
      setGraph(current =>
        current
          ? {
              ...current,
              versions: current.versions.map(version =>
                version.id === target.commit
                  ? {
                      ...version,
                      message: completion.description ?? target.name,
                    }
                  : version
              ),
            }
          : current
      )
      if (feedback.current) await refreshFeedback(feedback.current)
    }, 'renaming').then(() => saved)
    renamePending.current = pending
    void pending.finally(() => {
      if (renamePending.current === pending) renamePending.current = null
    })
    return pending
  }
  const afterRename = (action: () => void) => {
    const epoch = selectionEpoch.current
    if (renamePending.current)
      void renamePending.current.then(saved => {
        if (
          saved &&
          owns() &&
          activeRef.current &&
          epoch === selectionEpoch.current
        )
          action()
      })
    else action()
  }
  const choose = (id: string) => {
    selectionEpoch.current++
    switchRequest.current++
    setSwitchReview(null)
    useCreationReadingStore.setState({ gitTarget: null })
    setSelected(id)
    setFullContext(false)
    setError(null)
    notifications.flow.dismiss(readToastId)
  }
  const revealProject = async () => {
    if (!owns()) return
    try {
      const result = await commands.revealCreationPath(identity, null)
      if (owns() && result.status === 'error')
        notifications.error(t('creation.openFinder'), result.error.detail)
    } catch (cause) {
      if (owns())
        notifications.error(
          t('creation.openFinder'),
          creationTransportError(cause).detail
        )
    }
  }
  const refreshPage = () => {
    setRefreshRevision(value => value + 1)
    const current = recovery.current
    if (current) {
      void run(() => refreshFeedback(current), undefined, current)
    } else {
      setError(null)
      readErrorSignature.current = null
      notifications.flow.dismiss(readToastId)
      void reload()
    }
  }
  const locateAfterSave = useRef<string | null>(null)
  useEffect(() => {
    if (
      !graph ||
      !locateAfterSave.current ||
      !graph.versions.some(version => version.id === locateAfterSave.current)
    )
      return
    graphScroll.current
      ?.querySelector(`[data-git-version="${locateAfterSave.current}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'center' })
    locateAfterSave.current = null
  }, [graph])
  const openCurrent = () => {
    if (!path || !workspaceFiles?.some(file => file.path === path)) return
    useCreationFilesStore.getState().setActivePath(path)
    useCreationReadingStore.getState().showFile()
  }
  const beginRemoteUpdate = () => {
    const session = useSessionStore.getState()
    const drafts = useCreationFilesStore.getState()
    if (
      !owns() ||
      operation.current ||
      remoteUpdate.current ||
      updateBlock ||
      session.sessionStatus !== 'idle' ||
      session.commandPending ||
      blocksRemoteUpdate(useParameterPreviewStore.getState().status) ||
      unfinishedGitTask() ||
      selectDirtyPathKey(drafts) ||
      Object.values(drafts.drafts).some(
        draft => draft.saving || draft.renaming
      ) ||
      Object.values(useCreationPendingStore.getState().drafts).some(
        pendingDraftDirty
      )
    )
      return false
    remoteUpdate.current = true
    setRemoteBusy(true)
    onBusyChange(true)
    return true
  }
  const endRemoteUpdate = () => {
    remoteUpdate.current = false
    if (owns()) {
      setRemoteBusy(false)
      onBusyChange(false)
    }
  }
  const acceptRemoteUpdate = async (
    result: Awaited<ReturnType<typeof updateGitVersion>>,
    feedbackId: string
  ) => {
    if (!remoteUpdate.current || !owns()) return false
    const current: GitFeedback = {
      id: feedbackId,
      pending: true,
      completion: result.completion,
    }
    feedback.current = current
    recovery.current = current
    setSelected(result.receipt.status.head)
    setMode('parent')
    const complete = await recoverFeedback(current)
    current.pending = false
    return complete
  }

  useEffect(() => {
    setMergeHovered(false)
    if (
      !active ||
      merge ||
      !selected ||
      selected === 'working' ||
      selected === graph?.head
    ) {
      setMergeProbe(null)
      return
    }
    let current = true
    void Promise.resolve()
      .then(() => commands.probeCreationGitMerge(identity, selected))
      .then(result => {
        if (current) setMergeProbe(result.status === 'ok' ? result.data : null)
      })
      .catch(() => {
        if (current) setMergeProbe(null)
      })
    return () => {
      current = false
    }
  }, [active, identity, merge, selected, graph?.head])
  const acceptCompletedMerge = useEffectEvent(() => {
    if (!mergeCompleted?.result || completedMerge.current === mergeCompleted.id)
      return
    completedMerge.current = mergeCompleted.id
    setSelected(mergeCompleted.result)
    setReceipt({
      commit: mergeCompleted.result,
      message: mergeCompleted.name,
      paths: mergeCompleted.files.map(file => file.path),
      warning: mergeCompleted.detail,
    })
    setMode('parent')
    void reload()
  })
  useEffect(() => {
    acceptCompletedMerge()
  }, [mergeCompleted?.id, mergeCompleted?.result])
  const prepareMerge = async (
    source: string,
    save: boolean,
    discard: boolean
  ) => {
    if (mergePreparing || !owns()) return
    const captured = useCreationFilesStore.getState().drafts
    const reviewedRuntime = currentGitRuntime()
    const draftsUnchanged = captureCreationDrafts()
    const releaseTerminal = blockCreationTerminalOpen()
    const validate = () => {
      if (!owns() || !draftsUnchanged()) return false
      const runtime = currentGitRuntime()
      if (
        runtime.status !== reviewedRuntime.status ||
        runtime.path !== reviewedRuntime.path ||
        runtime.generation !== reviewedRuntime.generation ||
        runtime.runId !== reviewedRuntime.runId ||
        runtime.pending !== reviewedRuntime.pending
      )
        throw new Error(t('creation.merge.runtimeMismatch'))
      return true
    }
    setMergeLocalError(null)
    setMergePreparing(true)
    onBusyChange(true)
    try {
      if (!(await confirmCreationTerminalLeave(identity))) return
      if (!validate()) return
      await endCreationTerminalForLeave(identity)
      if (!validate()) return
      if (unfinishedGitTask() || hasTask) await endGitTask(identity)
      if (!owns()) return
      if (save) {
        const saved = await saveGitVersion(
          identity,
          t('creation.versions.defaultName'),
          ''
        )
        await saved.completion.recover(reload, undefined, owns)
      }
      if (!owns()) return
      if (discard) {
        const runtime = currentGitRuntime()
        if (runtime.status === 'ready') {
          if (
            !runtime.generation ||
            runtime.generation !== reviewedRuntime.generation ||
            runtime.runId !== reviewedRuntime.runId ||
            runtime.path !== useCreationStore.getState().workspace?.project.root
          )
            throw new Error(t('creation.merge.runtimeMismatch'))
          const stopped = await commands.stopProjectGeneration(
            runtime.generation
          )
          if (stopped.status === 'error') throw new Error(stopped.error)
          if (!stopped.data || currentGitRuntime().runId !== runtime.runId)
            throw new Error(t('creation.merge.runtimeMismatch'))
          useSessionStore.getState().resetSession()
        }
      }
      const store = useCreationMergeStore.getState()
      store.attach(identity)
      await store.prepare(source, discard)
      if (!owns()) return
      if (discard)
        useCreationFilesStore
          .getState()
          .discardCheckoutCopies(Object.keys(captured), captured, true)
      const prepared = useCreationMergeStore.getState().candidate
      if (prepared?.relation === 'diverged') {
        const sourceName =
          graph?.versions
            .find(item => item.id === source)
            ?.message.split('\n')[0] ?? source.slice(0, 8)
        await useCreationMergeStore
          .getState()
          .rename(t('creation.merge.defaultName', { version: sourceName }))
      }
      setMergePreparation(null)
      await useCreationFilesStore.getState().synchronizeSaved(identity)
      useCreationReadingStore.getState().gitChanged()
    } catch (cause) {
      if (owns()) setMergeLocalError(creationTransportError(cause))
    } finally {
      if (owns()) {
        setMergePreparing(false)
        onBusyChange(false)
      }
      releaseTerminal()
    }
  }
  const beginMerge = async () => {
    if (!selected || selected === 'working' || mergePreparing) return
    setMergeLocalError(null)
    try {
      const result = await commands.probeCreationGitMerge(identity, selected)
      if (result.status === 'error') throw result.error
      if (!owns()) return
      if (result.data.relation === 'included') {
        notifications.info(t('creation.merge.included'))
        return
      }
      if (hasChanges || hasTask || result.data.dirty)
        setMergePreparation({
          source: selected,
          changes: hasChanges || result.data.dirty,
          task: hasTask,
        })
      else await prepareMerge(selected, false, false)
    } catch (cause) {
      if (owns()) setMergeLocalError(creationTransportError(cause))
    }
  }
  const preparationError = mergeLocalError ?? mergeError
  if (merge)
    return (
      <section
        className="creation-git-page"
        aria-label={t('creation.versions.title')}
      >
        <CreationMergeWorkspace
          graph={graph}
          loading={loading}
          onMore={() => {
            if (graph?.nextOffset != null) void reload(graph.nextOffset)
          }}
        />
      </section>
    )
  return (
    <section
      className="creation-git-page"
      aria-label={t('creation.versions.title')}
      aria-busy={busy || loading}
    >
      <header className="creation-git-page-toolbar creation-version-toolbar">
        {mergePreparation ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={mergePreparing}
            onClick={() => setMergePreparation(null)}
          >
            <ArrowLeft aria-hidden="true" />
            {t('creation.merge.returnHistory')}
          </Button>
        ) : (
          <h2>
            <GitBranch aria-hidden="true" />
            {t('creation.versions.projectVersions')}
            <span>
              {status?.branch ??
                (status?.head ? t('creation.git.historicalPosition') : '')}
            </span>
          </h2>
        )}
        {editable && (
          <CreationGitHubSync
            identity={identity}
            active={active}
            head={status?.head ?? null}
            branch={status?.branch ?? null}
            localBusy={localBusy || loading || mergePreparing}
            updateBlock={updateBlock}
            beginUpdate={beginRemoteUpdate}
            endUpdate={endRemoteUpdate}
            onUpdated={acceptRemoteUpdate}
            onTemplateBackupFinished={() => {
              useCreationReadingStore.getState().gitChanged()
              void reload()
            }}
          />
        )}
      </header>
      {preparationError && <CreationErrorNotice error={preparationError} />}
      <div className="creation-version-content">
        <div className="creation-version-overview">
          <CreationGitGraph
            graph={graph}
            selected={selected}
            working={hasChanges}
            loading={loading}
            busy={writing}
            onChoose={choose}
            onMore={() => {
              if (graph?.nextOffset != null) void reload(graph.nextOffset)
            }}
            scrollRef={graphScroll}
            mergePreview={
              mergeHovered && mergeProbe?.relation === 'diverged'
                ? { source: mergeProbe.source, target: mergeProbe.target }
                : null
            }
          />
          {mergePreparation ? (
            <aside
              className="creation-merge-actions"
              aria-label={t('creation.merge.prepare')}
            >
              <strong>{t('creation.merge.prepare')}</strong>
              {mergePreparation.changes ? (
                <>
                  <Button
                    size="sm"
                    disabled={mergePreparing}
                    onClick={() =>
                      void prepareMerge(mergePreparation.source, true, false)
                    }
                  >
                    {t('creation.merge.saveThenMerge')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={mergePreparing}
                    onClick={() =>
                      void prepareMerge(mergePreparation.source, false, true)
                    }
                  >
                    {t('creation.merge.discardThenMerge')}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  disabled={mergePreparing}
                  onClick={() =>
                    void prepareMerge(mergePreparation.source, false, false)
                  }
                >
                  {t('creation.merge.endThenMerge')}
                </Button>
              )}
            </aside>
          ) : (
            <CreationGitVersionDetails
              key={selected ?? 'working'}
              version={inspected ?? null}
              graph={graph}
              branch={
                branchForSelection ??
                (inspectingCurrent ? (status?.branch ?? null) : null)
              }
              working={working}
              editable={editable}
              busy={writing || loading}
              error={error}
              onRename={renameVersion}
            >
              {working ? (
                <>
                  <Button
                    size="sm"
                    disabled={writing || !editable || loading || !hasChanges}
                    onClick={() => afterRename(() => setSaveOpen(true))}
                  >
                    <Save aria-hidden="true" />
                    {t('creation.version.saveCurrent')}
                  </Button>
                  {dirty && (
                    <p className="creation-version-consequence">
                      {t('creation.git.drafts', {
                        count: dirty.split('\n').length,
                      })}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <Button
                    ref={switchButton}
                    size="sm"
                    variant="outline"
                    data-confirm-discard={Boolean(switchReview?.discard)}
                    disabled={
                      writing ||
                      !editable ||
                      !inspected ||
                      (inspectingCurrent && !hasChanges && !changesBranch) ||
                      loading ||
                      commandPending ||
                      ['starting', 'stopping'].includes(session)
                    }
                    onKeyDown={event => {
                      if (event.repeat && ['Enter', ' '].includes(event.key))
                        event.preventDefault()
                    }}
                    onClick={() =>
                      afterRename(() =>
                        requestSwitch(inspected?.id, branchForSelection)
                      )
                    }
                  >
                    {t(
                      switchReview?.discard
                        ? 'creation.versions.discardAndSwitch'
                        : 'creation.versions.switchToVersion'
                    )}
                  </Button>
                  {editable && inspected && inspected.id !== graph?.head && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        writing ||
                        loading ||
                        mergePreparing ||
                        mergeProbe?.relation === 'included'
                      }
                      onMouseEnter={() => setMergeHovered(true)}
                      onMouseLeave={() => setMergeHovered(false)}
                      onFocus={() => setMergeHovered(true)}
                      onBlur={() => setMergeHovered(false)}
                      onClick={() => {
                        setMergeHovered(false)
                        void beginMerge()
                      }}
                    >
                      {t(
                        mergeProbe?.relation === 'included'
                          ? 'creation.merge.included'
                          : 'creation.merge.intoCurrent'
                      )}
                    </Button>
                  )}
                </>
              )}
            </CreationGitVersionDetails>
          )}
        </div>
        <div className="creation-version-difference">
          {(mergePreparation ||
            (!working && hasTask) ||
            switchReview?.discard ||
            hasDetails) && (
            <div className="creation-version-notice">
              <div>
                {mergePreparation && <p>{t('creation.merge.prepareHint')}</p>}
                {(mergePreparation?.task ||
                  (!mergePreparation && !working && hasTask)) && (
                  <p>
                    {t(
                      mergePreparation
                        ? 'creation.merge.taskHint'
                        : 'creation.versions.switchEndsTask'
                    )}
                  </p>
                )}
                {switchReview?.discard && (
                  <div
                    ref={switchFiles}
                    className="creation-version-switch-files pnds-focus-ring"
                    role="region"
                    aria-label={t('creation.versions.switchFiles')}
                    tabIndex={0}
                  >
                    {switchReview.changes.some(
                      path => !switchReview.overwrittenPaths.includes(path)
                    ) && (
                      <>
                        <strong>
                          {t('creation.versions.discardedFiles', {
                            count: switchReview.changes.filter(
                              path =>
                                !switchReview.overwrittenPaths.includes(path)
                            ).length,
                          })}
                        </strong>
                        <ul>
                          {switchReview.changes
                            .filter(
                              path =>
                                !switchReview.overwrittenPaths.includes(path)
                            )
                            .map(path => (
                              <li key={path}>{path}</li>
                            ))}
                        </ul>
                      </>
                    )}
                    {switchReview.overwrittenPaths.length > 0 && (
                      <>
                        <strong>
                          {t('creation.versions.overwrittenFiles', {
                            count: switchReview.overwrittenPaths.length,
                          })}
                        </strong>
                        <ul>
                          {switchReview.overwrittenPaths.map(path => (
                            <li key={path}>{path}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
              {hasDetails && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="creation-version-operation-details"
                  onClick={() => setDetailsOpen(true)}
                >
                  {t('creation.versions.operationDetails')}
                </Button>
              )}
            </div>
          )}
          {comparison &&
          !comparison.files.some(file => file.status !== 'unchanged') &&
          !diffLoading ? (
            <p className="creation-version-empty">
              {t('creation.comparison.noTextChanges')}
            </p>
          ) : (
            <CreationGitDifference
              diff={
                diff?.token === comparison?.token && diff?.path === path
                  ? diff
                  : null
              }
              path={comparison ? path : null}
              loading={comparisonPhase === 'loading' || diffLoading}
              fullContext={fullContext}
              onFullContext={() => setFullContext(value => !value)}
              onOpen={openCurrent}
              canOpen={
                !busy &&
                Boolean(
                  path && workspaceFiles?.some(file => file.path === path)
                )
              }
            />
          )}
        </div>
      </div>
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-h-[70vh] overflow-y-auto">
          <DialogTitle>{t('creation.versions.operationDetails')}</DialogTitle>
          <DialogDescription>{t('creation.versions.local')}</DialogDescription>
          {error && (
            <CreationErrorNotice
              error={error}
              validationMessage={t('creation.git.validationError')}
            />
          )}
          {receipt?.warning && (
            <div className="space-y-2 text-xs">
              <p className="text-muted-foreground">{receipt.message}</p>
              <p role="alert" className="break-words">
                {receipt.warning}
              </p>
            </div>
          )}
          {syncPending && (
            <p className="text-xs">{t('creation.files.syncPending')}</p>
          )}
          {excludedFiles.length > 0 && (
            <details className="creation-details text-xs" open>
              <summary>{t('creation.versions.excluded')}</summary>
              <ul>
                {excludedFiles.map(file => (
                  <li key={file.path} className="break-all">
                    {file.path}
                    {file.exclusion &&
                      ` · ${t(`creation.version.exclusion.${file.exclusion}`)}`}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {statusUnavailable && status && !error && (
            <p className="break-words text-xs">
              {t(`creation.git.state.${status.state}`)} {status.detail}
            </p>
          )}
          <DialogFooter>
            {error && (
              <Button
                variant="outline"
                disabled={busy || loading}
                onClick={() => void revealProject()}
              >
                {t('creation.openFinder')}
              </Button>
            )}
            <Button disabled={busy || loading} onClick={refreshPage}>
              {t(
                syncPending
                  ? 'creation.files.retrySync'
                  : 'creation.git.refresh'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={saveOpen}
        onOpenChange={open => {
          if (!busy) setSaveOpen(open)
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogTitle>{t('creation.version.saveCurrent')}</DialogTitle>
          <DialogDescription>{t('creation.versions.local')}</DialogDescription>
          <form
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault()
              void run(save, 'saving')
            }}
          >
            <Input
              autoFocus
              aria-label={t('creation.versions.name')}
              value={
                name ?? graph?.nextName ?? t('creation.versions.defaultName')
              }
              maxLength={120}
              disabled={busy}
              onChange={event => setName(event.target.value)}
            />
            {!atBranchTip && graph?.head && (
              <Input
                aria-label={t('creation.versions.branchName')}
                placeholder={t('creation.versions.branchName')}
                value={branchName}
                maxLength={40}
                disabled={busy}
                onChange={event => setBranchName(event.target.value)}
              />
            )}
            {error && <CreationErrorNotice error={error} />}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setSaveOpen(false)}
              >
                {t('creation.cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {t('creation.version.saveCurrent')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
