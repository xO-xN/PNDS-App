import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, Info, RefreshCw, Save, Pencil } from 'lucide-react'
import { notifications } from '@/lib/notifications'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  type GitComparisonSide,
} from '@/lib/tauri-bindings'
import {
  creationTransportError,
  useCreationStore,
} from '@/store/creation-store'
import {
  useCreationFilesStore,
  selectDirtyPathKey,
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
  endGitTask,
  saveGitVersion,
  switchGitVersion,
  unfinishedGitTask,
  type GitOperationPhase,
} from '@/lib/creation-git-workflow'
import { CreationGitGraph } from './CreationGitGraph'
import { CreationGitSplit } from './CreationGitSplit'
import { CreationErrorNotice } from './CreationErrorNotice'
import { CreationGitDifference } from './CreationGitDifference'
import { CreationGitHubSync } from './CreationGitHubSync'

interface GitFeedback {
  id: string
  pending: boolean
  outcome?: 'saved' | 'switched' | 'restored' | 'renamed' | 'taskEnded'
  receipt?: GitRecordReceipt
  description?: string
  needsSync?: boolean
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
  const [mode, setMode] = useState<'parent' | 'saved'>('parent')
  const [parent, setParent] = useState<string | null>(null)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const [fullContext, setFullContext] = useState(false)
  const [diff, setDiff] = useState<GitComparisonDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{
    commit: string
    expected: string
    name: string
  } | null>(null)
  const [branchName, setBranchName] = useState('')
  const [graphCollapsed, setGraphCollapsed] = useState(false)
  const [localBusy, setBusy] = useState(false)
  const [remoteBusy, setRemoteBusy] = useState(false)
  const busy = localBusy || remoteBusy
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<CreationError | null>(null)
  const [receipt, setReceipt] = useState<GitRecordReceipt | null>(null)
  const [recordPreview, setRecordPreview] = useState<GitRecordPreview | null>(
    null
  )
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [syncPending, setSyncPending] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null)
  const [switchChanges, setSwitchChanges] = useState<string[]>([])
  const branchTarget = useCreationReadingStore(state => state.gitTarget)
  const [restoring, setRestoring] = useState(false)
  const [discard, setDiscard] = useState(false)
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
  const syncRecovery = useRef<GitFeedback | null>(null)
  const readFailure = useRef<CreationError | null>(null)
  const readErrorSignature = useRef<string | null>(null)
  const request = useRef(0)
  const switchRequest = useRef(0)
  const graphScroll = useRef<HTMLDivElement>(null)
  const intent = useCreationReadingStore(state => state.gitIntent)
  const intentRevision = useCreationReadingStore(
    state => state.gitIntentRevision
  )
  const dirty = useCreationFilesStore(selectDirtyPathKey)
  const pendingDrafts = useCreationPendingStore(state =>
    Object.values(state.drafts).some(pendingDraftDirty)
  )
  const previewActive = useParameterPreviewStore(state =>
    blocksRemoteUpdate(state.status)
  )
  const revision = useCreationFilesStore(state => state.revision)
  const phase = useAssistantStore(state => state.phase)
  const resumable = useAssistantStore(
    state => state.canContinue || state.paused || state.resumeRestored
  )
  const session = useSessionStore(state => state.sessionStatus)
  const commandPending = useSessionStore(state => state.commandPending)
  const editable = useCreationStore(
    state => state.workspace?.project.source === 'folder'
  )
  const hasTask = phase !== 'idle' || resumable || recoveredTask
  const hasChanges = Boolean(dirty || status?.changes.length)
  const updateBlock =
    hasChanges || pendingDrafts
      ? 'drafts'
      : hasTask
        ? 'task'
        : session !== 'idle' || commandPending || previewActive
          ? 'runtime'
          : null
  const hasSwitchChanges = Boolean(dirty || switchChanges.length)
  const switchPaths = [
    ...new Set([...switchChanges, ...dirty.split('\n')]),
  ].filter(Boolean)
  const inspected = graph?.versions.find(version => version.id === selected)
  const inspectingCurrent = Boolean(inspected && inspected.id === graph?.head)
  const target = graph?.versions.find(version => version.id === switching)
  const atBranchTip = Boolean(status?.branch)
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
      syncRecovery.current = null
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
  const reload = async (offset = 0) => {
    const sequence = ++request.current
    readFailure.current = null
    setLoading(true)
    try {
      const statusResult = await commands.getCreationGitStatus(identity)
      if (!owns() || sequence !== request.current) return false
      if (statusResult.status === 'error') throw statusResult.error
      setStatus(statusResult.data)
      if (!['available', 'notRepository'].includes(statusResult.data.state)) {
        reportReadError({
          code: 'io',
          detail:
            statusResult.data.detail ??
            t(`creation.git.state.${statusResult.data.state}`),
        })
        return false
      }
      if (!statusResult.data.head) {
        setGraph({
          head: null,
          branches: [],
          versions: [],
          nextOffset: null,
          limited: false,
        })
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
      setSelected(previous => previous ?? result.data.head)
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
      parent,
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
          parent: mode === 'parent' ? parent : null,
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
    parent,
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
    failure = readFailure.current?.detail
  ) => {
    if (!current.outcome) {
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
      current.outcome === 'taskEnded'
        ? 'creation.versions.feedback.taskEnded'
        : `creation.versions.feedback.${current.outcome}RefreshFailed`
    const resultKey =
      current.outcome === 'saved'
        ? 'creation.version.success'
        : current.outcome === 'taskEnded'
          ? 'creation.versions.feedback.taskEnded'
          : `creation.versions.${current.outcome}`
    if (!refreshed || current.needsSync) {
      finishFeedback(
        current,
        'warn',
        failedRefreshKey,
        [
          ...new Set(
            [
              current.receipt?.warning,
              current.needsSync ? t('creation.files.syncPending') : undefined,
              failure,
              !current.needsSync && !failure ? current.description : undefined,
            ].filter(Boolean)
          ),
        ].join('\n') || undefined,
        true
      )
    } else
      finishFeedback(
        current,
        current.receipt?.warning ? 'warn' : 'succeed',
        resultKey,
        current.receipt?.warning ?? current.description
      )
  }
  const refreshFeedback = async (current: GitFeedback) => {
    if (current.needsSync) {
      step('synchronizing')
      const synchronized = await useCreationFilesStore
        .getState()
        .synchronizeSaved(identity)
      if (!owns()) return
      current.needsSync = !synchronized
      setSyncPending(!synchronized)
      syncRecovery.current = synchronized ? null : current
    }
    step('refreshing')
    const refreshed = await reload()
    completeFeedback(current, refreshed)
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
    setError(null)
    notifications.flow.dismiss(readToastId)
    onBusyChange(true)
    try {
      await work()
    } catch (cause) {
      if (owns()) {
        const problem = creationTransportError(cause)
        setError(problem)
        if (current) {
          if (current.outcome === 'saved')
            finishFeedback(
              current,
              'warn',
              'creation.versions.feedback.savedActionFailed',
              [
                ...new Set(
                  [current.receipt?.warning, problem.detail].filter(Boolean)
                ),
              ].join('\n'),
              true
            )
          else if (current.outcome)
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
      if (owns()) setBusy(false)
    }
  }
  const save = async (continueSwitch = false) => {
    const result = await saveGitVersion(
      identity,
      name ?? graph?.nextName ?? t('creation.versions.defaultName'),
      branchName,
      step
    )
    if (!owns()) return
    setRecordPreview(result.preview)
    if (result.receipt) {
      setReceipt(result.receipt)
      if (feedback.current) {
        feedback.current.outcome = 'saved'
        feedback.current.receipt = result.receipt
        feedback.current.description = result.receipt.message
      }
      setGraphCollapsed(false)
      setMode('parent')
      setParent(null)
      setSelected(result.receipt.commit)
      locateAfterSave.current = result.receipt.commit
      setName(null)
      setBranchName('')
    }
    if (!continueSwitch && feedback.current)
      await refreshFeedback(feedback.current)
  }
  const handledIntent = useRef(0)
  const prepareSwitch = async (commit: string, branch: string | null) => {
    const sequence = ++switchRequest.current
    const current = () => owns() && sequence === switchRequest.current
    const fresh = await commands.getCreationGitStatus(identity)
    if (!current()) return
    if (fresh.status === 'error') throw fresh.error
    if (fresh.data.state !== 'available')
      throw {
        code: 'io',
        detail:
          fresh.data.detail ?? t(`creation.git.state.${fresh.data.state}`),
      }
    let changes = fresh.data.changes
    if (changes.some(change => change.untracked)) {
      // Native recording policy owns exclusions; this token is preparation only.
      // Confirmation still takes a fresh save preview and native switch guards.
      const preview = await commands.previewCreationGitRecord(identity)
      if (!current()) return
      if (preview.status === 'error') throw preview.error
      const eligible = new Set(
        preview.data.files
          .filter(file => file.defaultSelected)
          .map(file => file.path)
      )
      changes = changes.filter(
        change =>
          !change.untracked || change.staged || eligible.has(change.path)
      )
    }
    setStatus({ ...fresh.data, changes })
    if (
      !branch &&
      fresh.data.head === commit &&
      changes.length === 0 &&
      !selectDirtyPathKey(useCreationFilesStore.getState())
    ) {
      setSwitchChanges([])
      setSwitching(null)
      setRestoring(false)
      return
    }
    const pending = await commands.getCreationGitTaskPending(identity)
    if (!current()) return
    if (pending.status === 'error') throw pending.error
    setSwitchChanges(changes.map(change => change.path))
    setRecoveredTask(pending.data)
    setParent(null)
    setSelected(commit)
    setSwitching(commit)
    setSwitchingBranch(branch)
    setRestoring(!branch && fresh.data.head === commit)
    setDiscard(false)
  }
  const performIntent = useEffectEvent(() => {
    if (branchTarget)
      void run(
        () => prepareSwitch(branchTarget.commit, branchTarget.branch),
        'checking'
      )
    else if (intent === 'record') void run(save, 'saving')
    else if (intent === 'status') {
      setSelected('working')
      setFullContext(false)
    }
  })
  useEffect(() => {
    if (!active || handledIntent.current === intentRevision) return
    handledIntent.current = intentRevision
    performIntent()
  }, [active, intent, intentRevision])
  const requestSwitch = () =>
    void run(async () => {
      if (!inspected || (inspectingCurrent && !hasChanges)) return
      await prepareSwitch(inspected.id, null)
    }, 'checking')
  const confirmSwitch = () =>
    void run(
      async () => {
        if (!switching) return
        if (hasTask) {
          step('endingTask')
          await endGitTask(identity)
          if (!owns()) return
          setRecoveredTask(false)
          if (feedback.current) {
            feedback.current.outcome = 'taskEnded'
            await refreshFeedback(feedback.current)
          }
          return
        }
        if (hasSwitchChanges && !discard) await save(true)
        if (!owns()) return
        let result: Awaited<ReturnType<typeof switchGitVersion>>
        try {
          result = await switchGitVersion(
            identity,
            switching,
            discard,
            switchingBranch ?? undefined,
            phase => {
              step(phase === 'switching' && restoring ? 'restoring' : phase)
              if (phase === 'synchronizing' && feedback.current) {
                feedback.current.outcome = restoring ? 'restored' : 'switched'
                feedback.current.needsSync = true
                syncRecovery.current = feedback.current
              }
            }
          )
        } catch (cause) {
          if (owns()) {
            const synchronized = await useCreationFilesStore
              .getState()
              .synchronizeSaved(identity)
              .catch(() => false)
            if (
              feedback.current?.outcome === 'switched' ||
              feedback.current?.outcome === 'restored'
            ) {
              feedback.current.needsSync = !synchronized
              setSyncPending(!synchronized)
              syncRecovery.current = synchronized ? null : feedback.current
            }
            await reload()
          }
          throw cause
        }
        if (!owns()) return
        setSwitching(null)
        setDiscard(false)
        setSelected(switching)
        setSyncPending(!result.synchronized)
        if (feedback.current) {
          feedback.current.outcome = restoring ? 'restored' : 'switched'
          feedback.current.description = undefined
          feedback.current.needsSync = !result.synchronized
          syncRecovery.current = result.synchronized ? null : feedback.current
          step('refreshing')
          completeFeedback(feedback.current, await reload())
        }
      },
      hasTask ? 'endingTask' : restoring ? 'restoring' : 'switching'
    )
  const choose = (id: string) => {
    setSelected(id)
    setParent(null)
    setFullContext(false)
    setError(null)
    notifications.flow.dismiss(readToastId)
  }
  const refreshPage = () => {
    setRefreshRevision(value => value + 1)
    if (syncPending) {
      const current = syncRecovery.current ?? {
        id: `creation-git:${crypto.randomUUID()}`,
        pending: false,
        outcome: 'switched' as const,
        needsSync: true,
      }
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
  const sideLabel = (side: GitComparisonSide) =>
    side.saved
      ? t('creation.comparison.saved')
      : side.commit
        ? `${side.message ?? side.commit.slice(0, 7)} · ${side.commit.slice(0, 7)}`
        : t('creation.comparison.empty')
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
  const acceptRemoteUpdate = async (commit: string | null) => {
    if (!owns()) return false
    useCreationReadingStore.getState().gitChanged()
    setSelected(commit)
    setMode('parent')
    setParent(null)
    const synchronized = await useCreationFilesStore
      .getState()
      .synchronizeSaved(identity)
      .catch(() => false)
    if (!owns()) return false
    setSyncPending(!synchronized)
    return (await reload()) && synchronized
  }
  return (
    <section
      className="creation-git-page"
      aria-label={t('creation.versions.title')}
      aria-busy={busy || loading}
    >
      <header className="creation-git-page-toolbar">
        <div className="creation-git-page-toolbar-row">
          <h2>
            <GitBranch aria-hidden="true" />
            {t('creation.versions.title')}
          </h2>
          <span className="text-xs text-muted-foreground">
            {t('creation.versions.local')}
          </span>
          <span className="flex-1" />
          {dirty && (
            <span className="text-xs text-muted-foreground">
              {t('creation.git.drafts', { count: dirty.split('\n').length })}
            </span>
          )}
          {editable && (
            <>
              <Input
                aria-label={t('creation.versions.name')}
                placeholder={t('creation.versions.name')}
                value={
                  name ?? graph?.nextName ?? t('creation.versions.defaultName')
                }
                maxLength={120}
                disabled={busy}
                onChange={e => setName(e.target.value)}
              />
              {!atBranchTip && graph?.head && (
                <Input
                  aria-label={t('creation.versions.branchName')}
                  placeholder={t('creation.versions.branchName')}
                  value={branchName}
                  maxLength={40}
                  disabled={busy}
                  onChange={e => setBranchName(e.target.value)}
                />
              )}
              <Button
                size="sm"
                disabled={busy || loading}
                onClick={() => void run(save, 'saving')}
              >
                <Save aria-hidden="true" />
                {t('creation.version.saveCurrent')}
              </Button>
            </>
          )}

          <Button
            size="icon"
            variant="ghost"
            disabled={busy || loading}
            aria-label={t(
              syncPending ? 'creation.files.retrySync' : 'creation.git.refresh'
            )}
            title={t(
              syncPending ? 'creation.files.retrySync' : 'creation.git.refresh'
            )}
            onClick={refreshPage}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={!hasDetails}
            aria-label={t('creation.versions.operationDetails')}
            title={t('creation.versions.operationDetails')}
            onClick={() => setDetailsOpen(true)}
          >
            <Info aria-hidden="true" />
          </Button>
        </div>
        {editable && (
          <CreationGitHubSync
            identity={identity}
            active={active}
            head={status?.head ?? null}
            branch={status?.branch ?? null}
            localBusy={localBusy || loading}
            updateBlock={updateBlock}
            beginUpdate={beginRemoteUpdate}
            endUpdate={endRemoteUpdate}
            onUpdated={acceptRemoteUpdate}
          />
        )}
      </header>
      <CreationGitSplit
        collapsed={graphCollapsed}
        graph={
          <CreationGitGraph
            graph={graph}
            selected={selected}
            working={hasChanges}
            loading={loading}
            busy={busy}
            collapsed={graphCollapsed}
            onCollapsedChange={setGraphCollapsed}
            onChoose={choose}
            onMore={() => {
              if (graph?.nextOffset != null) void reload(graph.nextOffset)
            }}
            scrollRef={graphScroll}
          />
        }
      >
        <aside
          className="creation-git-inspector"
          aria-label={t('creation.versions.inspector')}
        >
          <header className="creation-git-comparison-summary">
            <h3 className="sr-only">
              {selected === 'working'
                ? t('creation.versions.working')
                : (inspected?.message.split('\n')[0] ??
                  t('creation.versions.noVersions'))}
            </h3>
            {editable && inspected && (
              <Button
                size="icon"
                variant="ghost"
                disabled={busy || loading}
                aria-label={t('creation.versions.rename')}
                onClick={() =>
                  setRenaming({
                    commit: inspected.id,
                    expected: inspected.message,
                    name: inspected.message.split('\n')[0] ?? '',
                  })
                }
              >
                <Pencil aria-hidden="true" />
              </Button>
            )}
            <div className="creation-git-comparison-control">
              <Select
                value={selected === 'working' ? 'saved' : mode}
                disabled={selected === 'working' || busy}
                onValueChange={value => {
                  setMode(value as 'parent' | 'saved')
                  setFullContext(false)
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={t('creation.comparison.compare')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="parent">
                    {t('creation.comparison.parentToSelected')}
                  </SelectItem>
                  <SelectItem value="saved">
                    {t(
                      selected === 'working'
                        ? 'creation.comparison.headToSaved'
                        : 'creation.comparison.selectedToSaved'
                    )}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mode === 'parent' && inspected && inspected.parents.length > 1 && (
              <Select
                value={parent ?? inspected.parents[0]}
                onValueChange={setParent}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={t('creation.versions.parent')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {inspected.parents.map(id => (
                    <SelectItem key={id} value={id}>
                      {id.slice(0, 7)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {comparison && (
              <p
                className="creation-git-direction"
                aria-label={t('creation.comparison.direction')}
              >
                <span>{sideLabel(comparison.before)}</span>
                <b aria-hidden="true">→</b>
                <span>{sideLabel(comparison.after)}</span>
              </p>
            )}
            {(selected === 'working' || mode === 'saved') && (
              <p className="text-xs text-muted-foreground">
                {t('creation.comparison.diskHint')}
              </p>
            )}
          </header>
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
              Boolean(path && workspaceFiles?.some(file => file.path === path))
            }
          />
          <footer>
            <Button
              disabled={
                busy ||
                !editable ||
                !inspected ||
                (inspectingCurrent && !hasChanges) ||
                loading
              }
              onClick={requestSwitch}
            >
              {t(
                inspectingCurrent
                  ? hasChanges
                    ? 'creation.versions.restore'
                    : 'creation.versions.alreadyCurrent'
                  : 'creation.versions.switch'
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t(
                inspectingCurrent && hasChanges
                  ? 'creation.versions.restoreHint'
                  : 'creation.versions.switchHint'
              )}
            </p>
          </footer>
        </aside>
      </CreationGitSplit>
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
        </DialogContent>
      </Dialog>
      <Dialog
        open={renaming !== null}
        onOpenChange={open => {
          if (!open && !busy) setRenaming(null)
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogTitle>{t('creation.versions.rename')}</DialogTitle>
          <DialogDescription>
            {t('creation.versions.renameHint')}
          </DialogDescription>
          <form
            onSubmit={event => {
              event.preventDefault()
              if (!renaming || !renaming.name.trim()) return
              const target = renaming
              void run(async () => {
                const result = await commands.renameCreationGitVersion(
                  identity,
                  target.commit,
                  target.expected,
                  target.name.trim()
                )
                if (!owns()) return
                if (result.status === 'error') throw result.error
                setRenaming(null)
                useCreationReadingStore.getState().gitChanged()
                if (feedback.current) {
                  feedback.current.outcome = 'renamed'
                  feedback.current.description = result.data
                  await refreshFeedback(feedback.current)
                }
              }, 'renaming')
            }}
            className="space-y-4"
          >
            <Input
              autoFocus
              required
              maxLength={120}
              aria-label={t('creation.versions.name')}
              value={renaming?.name ?? ''}
              disabled={busy}
              onChange={event =>
                setRenaming(current =>
                  current ? { ...current, name: event.target.value } : null
                )
              }
            />
            {error && <CreationErrorNotice error={error} />}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setRenaming(null)}
              >
                {t('creation.cancel')}
              </Button>
              <Button type="submit" disabled={busy || !renaming?.name.trim()}>
                {t('creation.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={switching !== null}
        onOpenChange={open => {
          if (!open && !busy) setSwitching(null)
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogTitle>
            {t(
              hasTask
                ? 'creation.versions.endTaskTitle'
                : discard
                  ? 'creation.versions.discardTitle'
                  : restoring
                    ? 'creation.versions.restoreTitle'
                    : 'creation.versions.switchTitle'
            )}
          </DialogTitle>
          <DialogDescription>
            {switchingBranch ?? target?.message.split('\n')[0]} ·{' '}
            {switching?.slice(0, 8)}
          </DialogDescription>
          {hasTask ? (
            <p className="text-sm">{t('creation.versions.endTaskHint')}</p>
          ) : (
            <>
              <p className="text-sm">
                {t(
                  discard
                    ? 'creation.versions.discardHint'
                    : hasSwitchChanges
                      ? dirty
                        ? restoring
                          ? 'creation.versions.saveRestoreHint'
                          : 'creation.versions.saveSwitchHint'
                        : restoring
                          ? 'creation.versions.savedRestoreHint'
                          : 'creation.versions.savedSwitchHint'
                      : 'creation.versions.cleanSwitchHint'
                )}
              </p>
              {session === 'ready' && (
                <p className="text-sm">{t('creation.versions.stopHint')}</p>
              )}
            </>
          )}
          {switchPaths.length > 0 && (
            <details className="creation-details text-xs">
              <summary>
                {t('creation.versions.switchChanges', {
                  count: switchPaths.length,
                })}
              </summary>
              <ul>
                {switchPaths.map(path => (
                  <li key={path} className="break-all">
                    {path}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {error && <CreationErrorNotice error={error} />}
          <DialogFooter className="sm:flex-wrap">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setSwitching(null)}
            >
              {t('creation.cancel')}
            </Button>
            {!hasTask && !discard && hasSwitchChanges && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setDiscard(true)}
              >
                {t(
                  restoring
                    ? 'creation.versions.discardRestoreOption'
                    : 'creation.versions.discardOption'
                )}
              </Button>
            )}
            <Button
              variant={discard && !hasTask ? 'destructive' : 'default'}
              disabled={
                busy ||
                commandPending ||
                ['starting', 'stopping'].includes(session)
              }
              onClick={confirmSwitch}
            >
              {t(
                hasTask
                  ? 'creation.versions.endTaskContinue'
                  : discard
                    ? restoring
                      ? 'creation.versions.discardRestore'
                      : 'creation.versions.discardSwitch'
                    : hasSwitchChanges
                      ? restoring
                        ? 'creation.versions.saveRestore'
                        : 'creation.versions.saveSwitch'
                      : session === 'ready'
                        ? 'creation.versions.stopSwitch'
                        : 'creation.versions.switch'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
