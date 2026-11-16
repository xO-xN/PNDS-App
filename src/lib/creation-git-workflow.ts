import { useCreationReadingStore } from '@/store/creation-reading-store'
import i18n from '@/i18n/config'
import {
  commands,
  type GitRecordPreview,
  type GitRecordReceipt,
  type GitSwitchPreview,
  type CreationError,
  type GithubUpdateReceipt,
} from './tauri-bindings'
import { loadPreferences } from './preferences'
import {
  creationTransportError,
  useCreationStore,
} from '@/store/creation-store'
import {
  isDraftDirty,
  isCreationWorkspacePath,
  useCreationFilesStore,
  type CreationDraft,
} from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import {
  useAssistantStore,
  waitForAssistantTaskRetirements,
} from '@/store/assistant-store'
import { useParameterPreviewStore } from '@/store/parameter-preview-store'
import { flushAssistantResume } from './assistant-resume'
import { stopAndReset } from './open-project'
import { useCreationPendingStore } from '@/store/creation-pending-store'

export type GitOperationPhase =
  | 'saving'
  | 'checking'
  | 'recording'
  | 'refreshing'
  | 'switching'
  | 'stopping'
  | 'synchronizing'
  | 'renaming'
  | 'restoring'
  | 'endingTask'

type GitOutcome = 'saved' | 'switched' | 'restored' | 'renamed' | 'updated'

let workspaceOwner = {}
let observingWorkspace = false
function captureGitOwner() {
  if (!observingWorkspace) {
    observingWorkspace = true
    useCreationStore.subscribe((state, previous) => {
      if (
        state.active !== previous.active ||
        state.workspace?.project !== previous.workspace?.project
      )
        workspaceOwner = {}
    })
  }
  return workspaceOwner
}

interface CheckoutCopies {
  paths: readonly string[]
  drafts: Readonly<Record<string, CreationDraft>>
  discard: boolean
}
interface GitRecoveryState {
  revision: number
  checkouts: CheckoutCopies[]
  needsSync: boolean
  needsRefresh: boolean
  signaled: boolean
  inFlight: Promise<boolean> | null
  error: CreationError | null
}
const recoveries = new WeakMap<object, GitRecoveryState>()

/** Receipts stay independent; unfinished follow-up belongs to the workspace. */
export class CompletedGitOperation {
  private valid = true
  private readonly recovery: GitRecoveryState

  constructor(
    private readonly identity: string,
    readonly outcome: GitOutcome | null,
    readonly description?: string,
    readonly receipt?: GitRecordReceipt,
    checkout?: CheckoutCopies,
    private readonly ownership = captureGitOwner()
  ) {
    const recovery = recoveries.get(ownership) ?? {
      revision: 0,
      checkouts: [],
      needsSync: false,
      needsRefresh: false,
      signaled: true,
      inFlight: null,
      error: null,
    }
    recoveries.set(ownership, recovery)
    this.recovery = recovery
    recovery.revision++
    recovery.needsRefresh = true
    if (outcome !== null) recovery.signaled = false
    if (checkout) {
      recovery.checkouts.push(checkout)
      recovery.needsSync = true
    }
  }

  get needsSync() {
    return this.recovery.needsSync
  }

  get pending() {
    const recovery = this.recovery
    return recovery.needsSync || recovery.needsRefresh || !recovery.signaled
  }

  get error() {
    return this.recovery.error
  }

  recover(
    reload: () => Promise<boolean>,
    progress?: (phase: GitOperationPhase) => void,
    owns: () => boolean = () => true
  ): Promise<boolean> {
    const recovery = this.recovery
    if (recovery.inFlight) return recovery.inFlight
    const current = () => {
      const state = useCreationStore.getState()
      this.valid &&=
        owns() &&
        state.active &&
        captureGitOwner() === this.ownership &&
        state.workspace?.project.identity === this.identity
      return this.valid
    }
    const followUp = async () => {
      if (!current()) return false
      recovery.error = null
      try {
        if (!recovery.signaled) {
          const revision = recovery.revision
          useCreationReadingStore.getState().gitChanged()
          if (recovery.revision === revision) recovery.signaled = true
        }
        if (!current()) return false
        while (recovery.checkouts.length) {
          const checkout = recovery.checkouts[0]
          if (!checkout) break
          useCreationFilesStore
            .getState()
            .discardCheckoutCopies(
              checkout.paths,
              checkout.drafts,
              checkout.discard
            )
          recovery.checkouts.shift()
          if (!current()) return false
        }
        if (recovery.needsSync) {
          progress?.('synchronizing')
          if (!current()) return false
          const revision = recovery.revision
          const synchronized = await useCreationFilesStore
            .getState()
            .synchronizeSaved(this.identity)
          if (!current()) return false
          if (recovery.revision === revision) recovery.needsSync = !synchronized
          if (!synchronized)
            recovery.error = useCreationFilesStore.getState().error
        }
      } catch (cause) {
        if (!current()) return false
        recovery.error = creationTransportError(cause)
      }
      // Reading the new HEAD is useful even when file synchronization failed.
      if (!current()) return false
      if (recovery.needsRefresh) {
        try {
          progress?.('refreshing')
          if (!current()) return false
          const revision = recovery.revision
          const refreshed = await reload()
          if (!current()) return false
          if (recovery.revision === revision) recovery.needsRefresh = !refreshed
        } catch (cause) {
          if (!current()) return false
          recovery.error ??= creationTransportError(cause)
        }
      }
      return !this.pending
    }
    recovery.inFlight = Promise.resolve()
      .then(followUp)
      .finally(() => {
        recovery.inFlight = null
      })
    return recovery.inFlight
  }
}

function owner(identity: string) {
  if (
    !useCreationStore.getState().active ||
    useCreationStore.getState().workspace?.project.identity !== identity
  )
    throw new Error(i18n.t('creation.versions.ownerChanged'))
}
function problem(key: string): never {
  throw new Error(i18n.t(`creation.versions.${key}`))
}
export function unfinishedGitTask() {
  const state = useAssistantStore.getState()
  return (
    state.phase !== 'idle' ||
    state.paused ||
    state.canContinue ||
    state.resumeRestored
  )
}
export async function endGitTask(identity: string) {
  owner(identity)
  const unsentInput = useAssistantStore.getState().input
  useAssistantStore.getState().stop()
  useAssistantStore.setState({ input: unsentInput })
  // Drain all queued publication before revoking the native grant and clearing
  // its checkpoint. The native fence rejects late saves from this task.
  await waitForAssistantTaskRetirements()
  await flushAssistantResume()
  owner(identity)
  const result = await commands.endCreationGitAssistantTask(identity)
  if (result.status === 'error') throw result.error
  owner(identity)
  await useAssistantStore.getState().persistHistory()
}
export async function saveGitVersion(
  identity: string,
  name: string,
  branchName: string,
  onProgress?: (phase: GitOperationPhase) => void
): Promise<{
  receipt: GitRecordReceipt | null
  preview: GitRecordPreview
  completion: CompletedGitOperation
}> {
  owner(identity)
  const ownership = captureGitOwner()
  onProgress?.('saving')
  if (!(await useCreationPendingStore.getState().saveAll()))
    problem('draftBlocked')
  owner(identity)
  const store = useCreationFilesStore
  if (!(await store.getState().poll()))
    throw (
      store.getState().error ??
      new Error(i18n.t('creation.versions.syncFailed'))
    )
  owner(identity)
  const drafts = Object.entries(store.getState().drafts).filter(([, draft]) =>
    isDraftDirty(draft)
  )
  for (const [path, draft] of drafts) {
    if (draft.conflict || draft.diskChanged || draft.saving || draft.renaming)
      problem('draftBlocked')
    await store.getState().save(path)
    owner(identity)
    const current = store.getState().drafts[path]
    if (!current || isDraftDirty(current) || current.error || current.conflict)
      throw (
        current?.error ?? new Error(i18n.t('creation.versions.draftBlocked'))
      )
  }
  if (Object.values(store.getState().drafts).some(isDraftDirty))
    problem('draftBlocked')
  onProgress?.('checking')
  const result = await commands.previewCreationGitRecord(identity)
  if (result.status === 'error') throw result.error
  owner(identity)
  const preview = result.data
  if (preview.files.some(file => file.staged)) problem('stagedBlocked')
  const paths = preview.files
    .filter(file => file.defaultSelected)
    .map(file => file.path)
  if (!paths.length)
    return {
      receipt: null,
      preview,
      completion: new CompletedGitOperation(
        identity,
        null,
        undefined,
        undefined,
        undefined,
        ownership
      ),
    }
  // New projects already have a repository-local identity from creation.
  const prefs = preview.initial ? await loadPreferences() : null
  owner(identity)
  const message =
    name.trim() ||
    (preview.initial ? i18n.t('creation.versions.defaultName') : '')
  onProgress?.('recording')
  const saved = await commands.confirmCreationGitVersion(
    identity,
    preview.token,
    {
      paths,
      name: prefs?.gitName?.trim() || preview.name,
      email: prefs?.gitEmail?.trim() || preview.email,
      message,
    },
    branchName.trim() || null
  )
  if (saved.status === 'error') throw saved.error
  return {
    receipt: saved.data,
    preview,
    completion: new CompletedGitOperation(
      identity,
      'saved',
      saved.data.message,
      saved.data,
      undefined,
      ownership
    ),
  }
}

export async function renameGitVersion(
  identity: string,
  target: { commit: string; expected: string; name: string }
) {
  owner(identity)
  const ownership = captureGitOwner()
  const result = await commands.renameCreationGitVersion(
    identity,
    target.commit,
    target.expected,
    target.name
  )
  if (result.status === 'error') throw result.error
  return new CompletedGitOperation(
    identity,
    'renamed',
    result.data,
    undefined,
    undefined,
    ownership
  )
}

export async function updateGitVersion(
  identity: string,
  target: Parameters<typeof commands.githubUpdate>[1]
): Promise<{
  receipt: GithubUpdateReceipt
  completion: CompletedGitOperation
}> {
  owner(identity)
  const ownership = captureGitOwner()
  const drafts = useCreationFilesStore.getState().drafts
  const result = await commands.githubUpdate(identity, target)
  if (result.status === 'error') throw result.error
  return {
    receipt: result.data,
    completion: new CompletedGitOperation(
      identity,
      'updated',
      undefined,
      undefined,
      { paths: result.data.paths, drafts, discard: false },
      ownership
    ),
  }
}
export function currentGitRuntime() {
  const session = useSessionStore.getState()
  return {
    status: session.sessionStatus,
    path: session.sessionProjectPath,
    generation: session.latestSnapshot?.runtimeGeneration ?? null,
    runId: session.runId,
    pending: session.commandPending,
  }
}

function requireReviewedGitRuntime(
  reviewed: ReturnType<typeof currentGitRuntime>
) {
  const current = currentGitRuntime()
  if (current.pending || ['starting', 'stopping'].includes(current.status))
    problem('runtimeBusy')
  if (
    current.runId !== reviewed.runId ||
    (current.status === 'ready' &&
      (reviewed.status !== 'ready' ||
        current.path !== reviewed.path ||
        current.generation !== reviewed.generation))
  )
    problem('runtimeChanged')
  return current
}

export interface PreparedGitSwitch {
  readonly preview: GitSwitchPreview
}
interface PreparedGitSwitchState {
  identity: string
  commit: string
  branch: string | undefined
  discard: boolean
  drafts: Readonly<Record<string, CreationDraft>>
  runtime: ReturnType<typeof currentGitRuntime>
  restoring: boolean
}
const preparedSwitches = new WeakMap<
  PreparedGitSwitch,
  PreparedGitSwitchState
>()

function requireReviewedGitDrafts(
  captured: Readonly<Record<string, CreationDraft>>
) {
  if (
    Object.entries(useCreationFilesStore.getState().drafts).some(
      ([path, draft]) =>
        draft.saving ||
        draft.renaming ||
        (isDraftDirty(draft) && draft !== captured[path])
    )
  )
    problem('draftBlocked')
}

/** Read consequences without stopping a runtime, ending a task or writing files. */
export async function prepareGitVersionSwitch(
  identity: string,
  commit: string,
  discard: boolean,
  branch?: string,
  reviewedRuntime = currentGitRuntime(),
  head?: string | null
): Promise<PreparedGitSwitch> {
  owner(identity)
  const captured = useCreationFilesStore.getState().drafts
  if (!discard && Object.values(captured).some(isDraftDirty))
    problem('draftBlocked')
  requireReviewedGitDrafts(captured)
  requireReviewedGitRuntime(reviewedRuntime)
  const result = branch
    ? await commands.previewCreationGitBranchSwitch(
        identity,
        branch,
        commit,
        discard
      )
    : await commands.previewCreationGitSwitch(identity, commit, discard)
  if (result.status === 'error') throw result.error
  owner(identity)
  requireReviewedGitDrafts(captured)
  requireReviewedGitRuntime(reviewedRuntime)
  const prepared = { preview: result.data }
  preparedSwitches.set(prepared, {
    identity,
    commit,
    branch,
    discard,
    drafts: captured,
    runtime: reviewedRuntime,
    restoring: !branch && head === commit,
  })
  return prepared
}

/** Consume the exact reviewed token; no replacement preview can authorize writes. */
export function validatePreparedGitSwitch(prepared: PreparedGitSwitch): void {
  const current = preparedSwitches.get(prepared)
  if (!current) problem('switchExpired')
  owner(current.identity)
  requireReviewedGitDrafts(current.drafts)
  requireReviewedGitRuntime(current.runtime)
}

export async function confirmPreparedGitSwitch(
  prepared: PreparedGitSwitch,
  onProgress?: (phase: GitOperationPhase) => void
) {
  const current = preparedSwitches.get(prepared)
  if (!current) problem('switchExpired')
  preparedSwitches.delete(prepared)
  const { identity, drafts, discard, runtime } = current
  owner(identity)
  const ownership = captureGitOwner()
  if (unfinishedGitTask()) problem('taskBlocked')
  requireReviewedGitDrafts(drafts)
  requireReviewedGitRuntime(runtime)
  if (!(await useParameterPreviewStore.getState().end()))
    problem('previewBlocked')
  owner(identity)
  const session = requireReviewedGitRuntime(runtime)
  if (session.status === 'ready') {
    if (!isCreationWorkspacePath(session.path)) problem('runtimeBusy')
    if (!session.generation) problem('runtimeChanged')
    onProgress?.('stopping')
    if (!(await stopAndReset(session.generation))) problem('runtimeChanged')
    owner(identity)
    const stopped = currentGitRuntime()
    if (stopped.status !== 'idle' || stopped.runId !== runtime.runId)
      problem('runtimeChanged')
  }
  requireReviewedGitDrafts(drafts)
  requireReviewedGitRuntime(runtime)
  onProgress?.('switching')
  const result = await commands.confirmCreationGitSwitch(
    identity,
    prepared.preview.token
  )
  if (result.status === 'error') throw result.error
  return new CompletedGitOperation(
    identity,
    current.restoring ? 'restored' : 'switched',
    undefined,
    undefined,
    { paths: prepared.preview.paths, drafts, discard },
    ownership
  )
}

export async function switchGitVersion(
  identity: string,
  commit: string,
  discard: boolean,
  branch?: string,
  onProgress?: (phase: GitOperationPhase) => void,
  reviewedRuntime = currentGitRuntime(),
  prepared?: PreparedGitSwitch
) {
  owner(identity)
  if (unfinishedGitTask()) problem('taskBlocked')
  if (prepared) {
    const current = preparedSwitches.get(prepared)
    if (
      !current ||
      current.identity !== identity ||
      current.commit !== commit ||
      current.branch !== branch
    )
      problem('switchExpired')
  }
  const reviewed =
    prepared ??
    (await prepareGitVersionSwitch(
      identity,
      commit,
      discard,
      branch,
      reviewedRuntime
    ))
  return confirmPreparedGitSwitch(reviewed, onProgress)
}
