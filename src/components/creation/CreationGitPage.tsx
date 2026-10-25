import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, RefreshCw, Save, Pencil } from 'lucide-react'
import { toast } from 'sonner'
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
  endGitTask,
  saveGitVersion,
  switchGitVersion,
} from '@/lib/creation-git-workflow'
import { CreationGitGraph } from './CreationGitGraph'
import { CreationGitSplit } from './CreationGitSplit'
import { CreationErrorNotice } from './CreationErrorNotice'
import { CreationGitDifference } from './CreationGitDifference'

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
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<CreationError | null>(null)
  const [receipt, setReceipt] = useState<GitRecordReceipt | null>(null)
  const [recordPreview, setRecordPreview] = useState<GitRecordPreview | null>(
    null
  )
  const [notice, setNotice] = useState<string | null>(null)
  const [syncPending, setSyncPending] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null)
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
  const operation = useRef(false)
  const request = useRef(0)
  const graphScroll = useRef<HTMLDivElement>(null)
  const intent = useCreationReadingStore(state => state.gitIntent)
  const intentRevision = useCreationReadingStore(
    state => state.gitIntentRevision
  )
  const dirty = useCreationFilesStore(selectDirtyPathKey)
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
  const inspected = graph?.versions.find(version => version.id === selected)
  const inspectingCurrent = Boolean(inspected && inspected.id === graph?.head)
  const target = graph?.versions.find(version => version.id === switching)
  const atBranchTip = Boolean(status?.branch)
  const owns = () =>
    alive.current &&
    useCreationStore.getState().workspace?.project.identity === identity
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const reload = async (offset = 0) => {
    const sequence = ++request.current
    setLoading(true)
    try {
      const statusResult = await commands.getCreationGitStatus(identity)
      if (!owns() || sequence !== request.current) return
      if (statusResult.status === 'error') throw statusResult.error
      setStatus(statusResult.data)
      if (!statusResult.data.head) {
        setGraph({
          head: null,
          branches: [],
          versions: [],
          nextOffset: null,
          limited: false,
        })
        return
      }
      const result = await commands.getCreationGitVersions(identity, offset)
      if (!owns() || sequence !== request.current) return
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
    } catch (cause) {
      if (owns() && sequence === request.current)
        setError(creationTransportError(cause))
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
          setError(result.error)
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
          setError(creationTransportError(cause))
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
        if (result.status === 'error') setError(result.error)
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
          setError(creationTransportError(cause))
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
  const run = async (work: () => Promise<void>) => {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    onBusyChange(true)
    try {
      await work()
    } catch (cause) {
      if (owns()) setError(creationTransportError(cause))
    } finally {
      operation.current = false
      onBusyChange(false)
      if (owns()) setBusy(false)
    }
  }
  const save = async () => {
    const result = await saveGitVersion(
      identity,
      name ?? graph?.nextName ?? t('creation.versions.defaultName'),
      branchName
    )
    if (!owns()) return
    setRecordPreview(result.preview)
    if (result.receipt) {
      setReceipt(result.receipt)
      toast.success(t('creation.version.success'), {
        description: result.receipt.message,
        duration: 3000,
      })
      setGraphCollapsed(false)
      setMode('parent')
      setParent(null)
      setSelected(result.receipt.commit)
      locateAfterSave.current = result.receipt.commit
      setName(null)
      setBranchName('')
    } else setNotice(t('creation.versions.noChanges'))
    await reload()
  }
  const handledIntent = useRef(0)
  const performIntent = useEffectEvent(() => {
    if (branchTarget)
      void run(async () => {
        const result = await commands.getCreationGitTaskPending(identity)
        if (!owns()) return
        if (result.status === 'error') throw result.error
        setRecoveredTask(result.data)
        setParent(null)
        setSelected(branchTarget.commit)
        setSwitching(branchTarget.commit)
        setSwitchingBranch(branchTarget.branch)
        setRestoring(false)
        setDiscard(false)
      })
    else if (intent === 'record') void run(save)
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
      const result = await commands.getCreationGitTaskPending(identity)
      if (!owns()) return
      if (result.status === 'error') throw result.error
      setRecoveredTask(result.data)
      setSwitching(inspected.id)
      setSwitchingBranch(null)
      setRestoring(inspectingCurrent)
      setDiscard(false)
    })
  const confirmSwitch = () =>
    void run(async () => {
      if (!switching) return
      if (hasTask) {
        await endGitTask(identity)
        if (owns()) setRecoveredTask(false)
        await reload()
        return
      }
      if (hasChanges && !discard) await save()
      if (!owns()) return
      let result: Awaited<ReturnType<typeof switchGitVersion>>
      try {
        result = await switchGitVersion(
          identity,
          switching,
          discard,
          switchingBranch ?? undefined
        )
      } catch (cause) {
        if (owns()) {
          await useCreationFilesStore.getState().synchronizeSaved(identity)
          await reload()
        }
        throw cause
      }
      if (!owns()) return
      setSwitching(null)
      setDiscard(false)
      setSelected(switching)
      setSyncPending(!result.synchronized)
      setNotice(
        t(
          result.synchronized
            ? restoring
              ? 'creation.versions.restored'
              : 'creation.versions.switched'
            : 'creation.files.syncPending'
        )
      )
      setReceipt(null)
      await reload()
    })
  const choose = (id: string) => {
    setSelected(id)
    setParent(null)
    setFullContext(false)
    setError(null)
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
  return (
    <section
      className="creation-git-page"
      aria-label={t('creation.versions.title')}
      aria-busy={busy || loading}
    >
      <header className="creation-git-page-toolbar">
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
              onClick={() => void run(save)}
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
          aria-label={t('creation.git.refresh')}
          onClick={() => {
            setError(null)
            setRefreshRevision(value => value + 1)
            void reload()
          }}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </header>
      {error && (
        <CreationErrorNotice
          error={error}
          validationMessage={t('creation.git.validationError')}
        />
      )}
      {notice && (
        <p role="status" className="px-3 py-2 text-xs">
          {notice}
        </p>
      )}
      {syncPending && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const synchronized = await useCreationFilesStore
                .getState()
                .synchronizeSaved(identity)
              if (!owns()) return
              setSyncPending(!synchronized)
              setNotice(
                t(
                  synchronized
                    ? 'creation.versions.switched'
                    : 'creation.files.syncPending'
                )
              )
              await reload()
            })
          }
        >
          {t('creation.files.retrySync')}
        </Button>
      )}
      {receipt?.warning && (
        <p role="alert" className="mx-3 text-xs">
          {receipt.warning}
        </p>
      )}
      {recordPreview?.files.some(file => !file.defaultSelected) && (
        <details className="creation-details mx-3 text-xs">
          <summary>{t('creation.versions.excluded')}</summary>
          <ul>
            {recordPreview.files
              .filter(file => !file.defaultSelected)
              .map(file => (
                <li key={file.path}>
                  {file.path}
                  {file.exclusion &&
                    ` · ${t(`creation.version.exclusion.${file.exclusion}`)}`}
                </li>
              ))}
          </ul>
        </details>
      )}
      {status && !['available', 'notRepository'].includes(status.state) && (
        <p className="p-3 text-xs">
          {t(`creation.git.state.${status.state}`)} {status.detail}
        </p>
      )}
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
                toast.success(t('creation.versions.renamed'), {
                  description: result.data,
                })
                await reload()
              })
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
                    : hasChanges
                      ? restoring
                        ? 'creation.versions.saveRestoreHint'
                        : 'creation.versions.saveSwitchHint'
                      : 'creation.versions.cleanSwitchHint'
                )}
              </p>
              {session === 'ready' && (
                <p className="text-sm">{t('creation.versions.stopHint')}</p>
              )}
            </>
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
            {!hasTask && !discard && hasChanges && (
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
                    : hasChanges
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
