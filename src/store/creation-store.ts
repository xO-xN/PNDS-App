import { usePerformanceRoleStore } from './performance-role-store'
import { useClientParticipationStore } from './client-participation-store'
import { create } from 'zustand'
import { confirm, open } from '@tauri-apps/plugin-dialog'
import i18n from '@/i18n/config'
import {
  commands,
  expectOk,
  type CreationError,
  type CreationWorkspace,
  type CreationRuntime,
  type Result,
  type NewProjectOptions,
  type SessionSnapshot,
} from '@/lib/tauri-bindings'
import type { SnapshotCheckpoint } from '@/lib/session-snapshot-acceptance'
import { DEFAULT_OSC_TARGET, updatePreferences } from '@/lib/preferences'
import { logger } from '@/lib/logger'
import { closeProjectionWindow } from '@/lib/projection-window'
import {
  approveCreationDiscard,
  captureCreationDrafts,
  cleanupCreationParticipants,
  creationNeedsDraftChoice,
  prepareCreationDraftChoice,
} from '@/lib/creation-lifecycle'
import {
  isSessionBusy,
  mainSessionFacts,
  useSessionStore,
} from './session-store'
import { useProjectStore } from './project-store'

interface CreationRequest {
  readonly path: string
}
export interface CreationModePlan {
  targetCreation: boolean
  runtime: CreationRuntime
  workspace: CreationWorkspace | null
  preservesRun: boolean
}
interface CreationState {
  active: boolean
  epoch: number
  workspace: CreationWorkspace | null
  /** Canonical runtime identity supplied by the backend, including raw aliases. */
  runtimeProject: {
    path: string
    root: string
    merge?: { candidateId: string; revision: number }
  } | null
  recentPaths: string[]
  lastCreationParent: string | null
  opening: boolean
  request: CreationRequest | null
  error: CreationError | null
  modePhase: 'idle' | 'preparing' | 'armed' | 'settling'
  modePlan: CreationModePlan | null
  modeError: CreationError | null
  hoverPaused: boolean
  modePointerInside: boolean
  restoreModeFocus: boolean
  prepareModeSwitch: (targetPath?: string) => Promise<void>
  cancelModeSwitch: () => void
  commitModeSwitch: (
    duration?: number,
    restoreFocus?: boolean,
    options?: { confirmRuntimeStop?: boolean }
  ) => Promise<boolean>
  enter: () => Promise<void>
  leave: () => Promise<void>
  restoreRecent: (paths: string[]) => void
  restoreCreationParent: (parent: string | null) => void
  rememberCreationParent: (parent: string) => void
  removeRecent: (path: string) => void
  open: (path: string, newProject?: NewProjectOptions) => Promise<boolean>
  create: (options: NewProjectOptions) => Promise<boolean>
  pick: () => Promise<boolean>
}
let openQueue: Promise<unknown> = Promise.resolve()

async function releaseIdentity(identity: string): Promise<void> {
  try {
    const result = await commands.closeCreationProject(identity)
    if (result.status === 'error')
      logger.warn('Failed to release creation identity', {
        error: result.error,
      })
  } catch (error) {
    logger.warn('Failed to release creation identity', { error })
  }
}
function unwrap<T, E>(result: Result<T, E>): T {
  if (result.status === 'ok') return result.data
  throw result.error
}
export function creationTransportError(error: unknown): CreationError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'detail' in error &&
    typeof error.detail === 'string'
  )
    return error as CreationError
  return {
    code: 'io',
    detail: error instanceof Error ? error.message : String(error),
  }
}
function assertAvailable(runtime: CreationRuntime): void {
  if (isSessionBusy(runtime.snapshot.status))
    throw new Error(i18n.t('creation.switchBusy'))
}
function assertGeneration(
  runtime: CreationRuntime,
  expected: CreationRuntime
): void {
  assertAvailable(runtime)
  if (
    runtime.generation !== expected.generation ||
    runtime.snapshot.status !== expected.snapshot.status ||
    runtime.projectRoot !== expected.projectRoot
  )
    throw new Error(i18n.t('creation.switchStale'))
}
async function endRuntime(
  runtime: CreationRuntime,
  owns: () => boolean
): Promise<CreationRuntime> {
  if (runtime.snapshot.status === 'idle') return runtime
  expectOk(await commands.stopProject())
  if (!owns()) throw new Error(i18n.t('creation.switchStale'))
  const checkpoint = mainSessionFacts.capture()
  const stopped = unwrap(await commands.getCreationRuntime())
  if (
    !owns() ||
    stopped.snapshot.status !== 'idle' ||
    mainSessionFacts.select(checkpoint, stopped.snapshot).snapshot.status !==
      'idle'
  )
    throw new Error(i18n.t('creation.switchStale'))
  mainSessionFacts.accept({
    kind: 'reply',
    checkpoint,
    snapshot: stopped.snapshot,
  })
  return stopped
}
function rememberWorkspace(
  workspace: CreationWorkspace,
  paths: string[]
): string[] {
  if (workspace.project.source !== 'folder') return paths
  const recent = [
    workspace.project.root,
    ...paths.filter(path => path !== workspace.project.root),
  ].slice(0, 20)
  void updatePreferences({ recentCreationProjects: recent })
  return recent
}
function assertModeOutcome(
  snapshot: SessionSnapshot,
  runtime: CreationRuntime,
  targetCreation: boolean
): void {
  if (
    isSessionBusy(snapshot.status) ||
    (snapshot.status === 'ready' &&
      (runtime.snapshot.status !== 'ready' ||
        snapshot.projectPath !== runtime.snapshot.projectPath)) ||
    (!targetCreation && snapshot.status !== 'idle')
  )
    throw new Error(i18n.t('creation.switchStale'))
}
function adoptRuntime(
  runtime: CreationRuntime,
  checkpoint: SnapshotCheckpoint
): void {
  const { snapshot } = mainSessionFacts.select(checkpoint, runtime.snapshot)
  useCreationStore.setState({
    runtimeProject:
      snapshot.projectPath &&
      runtime.projectRoot &&
      snapshot.projectPath === runtime.snapshot.projectPath
        ? {
            path: snapshot.projectPath,
            root: runtime.projectRoot,
            ...(runtime.merge
              ? {
                  merge: {
                    candidateId: runtime.merge.candidateId,
                    revision: runtime.merge.revision,
                  },
                }
              : {}),
          }
        : null,
  })
  mainSessionFacts.accept({
    kind: 'reply',
    checkpoint,
    snapshot: runtime.snapshot,
  })
  if (snapshot.status === 'ready')
    useSessionStore.setState({
      audioMode: snapshot.audioMode ?? 'none',
      lanIp: snapshot.lanIp,
      oscTargetInput:
        snapshot.audioMode === 'external'
          ? (snapshot.oscTarget ?? DEFAULT_OSC_TARGET)
          : DEFAULT_OSC_TARGET,
      ...(snapshot.outputDevice ? { outputDevice: snapshot.outputDevice } : {}),
      pendingChanges: false,
    })
}

export const useCreationStore = create<CreationState>((set, get) => ({
  active: false,
  epoch: 0,
  workspace: null,
  runtimeProject: null,
  recentPaths: [],
  lastCreationParent: null,
  opening: false,
  request: null,
  error: null,
  modePhase: 'idle',
  modePlan: null,
  modeError: null,
  hoverPaused: false,
  modePointerInside: false,
  restoreModeFocus: false,
  prepareModeSwitch: async targetPath => {
    if (
      (targetPath !== undefined && get().active) ||
      get().modePhase !== 'idle' ||
      get().opening ||
      isSessionBusy(useSessionStore.getState().sessionStatus) ||
      useSessionStore.getState().commandPending
    )
      return
    const epoch = get().epoch + 1
    set({
      epoch,
      request: null,
      opening: false,
      modePhase: 'preparing',
      modeError: null,
      hoverPaused: false,
    })
    const owns = () => get().epoch === epoch && get().modePhase === 'preparing'
    let workspace: CreationWorkspace | null = null
    try {
      const runtime = unwrap(await commands.getCreationRuntime())
      assertAvailable(runtime)
      const targetCreation = !get().active
      const path =
        targetCreation && usePerformanceRoleStore.getState().role !== 'client'
          ? (targetPath ??
            (runtime.snapshot.status === 'ready'
              ? runtime.snapshot.projectPath
              : useProjectStore.getState().currentProject?.path))
          : null
      if (path && owns())
        workspace = unwrap(await commands.prepareCreationProject(path))
      if (!owns()) {
        if (workspace) await releaseIdentity(workspace.project.identity)
        return
      }
      if (targetPath !== undefined && workspace?.project.source !== 'folder') {
        const error: CreationError = {
          code: 'permission',
          detail: workspace
            ? i18n.t(`creation.source.${workspace.project.source}`)
            : i18n.t('creation.error.invalidProject'),
        }
        if (workspace) await releaseIdentity(workspace.project.identity)
        if (owns()) set({ modePhase: 'idle', modeError: error })
        return
      }
      const preservesRun =
        runtime.snapshot.status === 'ready' &&
        workspace?.project.source === 'folder' &&
        workspace.project.root === runtime.projectRoot
      set({
        modePhase: 'armed',
        modePlan: { targetCreation, runtime, workspace, preservesRun },
      })
    } catch (error) {
      if (workspace) await releaseIdentity(workspace.project.identity)
      if (owns())
        set({ modePhase: 'idle', modeError: creationTransportError(error) })
    }
  },
  cancelModeSwitch: () => {
    if (!['preparing', 'armed'].includes(get().modePhase)) return
    const identity = get().modePlan?.workspace?.project.identity
    set(state => ({
      epoch: state.epoch + 1,
      modePhase: 'idle',
      modePlan: null,
      modeError: null,
    }))
    if (identity) void releaseIdentity(identity)
  },
  commitModeSwitch: async (duration = 0, restoreFocus = false, options) => {
    const plan = get().modePlan
    if (
      !plan ||
      get().modePhase !== 'armed' ||
      get().opening ||
      isSessionBusy(useSessionStore.getState().sessionStatus) ||
      useSessionStore.getState().commandPending
    )
      return false
    const epoch = get().epoch
    set({ modePhase: 'settling', modeError: null })
    const owns = () =>
      get().epoch === epoch &&
      get().modePlan === plan &&
      get().modePhase === 'settling'
    let timer: ReturnType<typeof setTimeout> | undefined
    const settled =
      duration > 0
        ? new Promise<void>(resolve => {
            timer = setTimeout(resolve, duration)
          })
        : Promise.resolve()
    let committed = false
    let preparedReleased = false
    let revokedKeyEpoch: number | undefined
    let retiredIdentity: string | null = null
    let releaseTerminal: (() => void) | undefined
    try {
      const {
        blockCreationTerminalOpen,
        confirmCreationTerminalLeave,
        endCreationTerminalForLeave,
      } = await import('@/lib/creation-terminal-leave')
      if (!owns()) return false
      releaseTerminal = blockCreationTerminalOpen()
      const terminalIdentity = get().workspace?.project.identity ?? ''
      const draftsUnchanged = captureCreationDrafts()
      if (get().active && !(await approveCreationDiscard())) return false
      const needsDraftChoice = get().active && creationNeedsDraftChoice()
      const drafts = needsDraftChoice
        ? await prepareCreationDraftChoice()
        : null
      if (needsDraftChoice && !drafts) return false
      let runtime = unwrap(await commands.getCreationRuntime())
      assertGeneration(runtime, plan.runtime)
      if (
        options?.confirmRuntimeStop &&
        !plan.preservesRun &&
        runtime.snapshot.status !== 'idle'
      ) {
        // Settling owns the plan while the native dialog takes window focus.
        const approved = await confirm(
          i18n.t('creation.startCreatingStopMessage'),
          {
            title: i18n.t('creation.startCreatingStopTitle', {
              project: plan.workspace?.project.name,
            }),
            kind: 'warning',
          }
        )
        if (!approved || !owns()) return false
        runtime = unwrap(await commands.getCreationRuntime())
        assertGeneration(runtime, plan.runtime)
      }
      if (get().active) {
        if (!(await confirmCreationTerminalLeave(terminalIdentity)))
          return false
        if (!owns() || !draftsUnchanged()) return false
        runtime = unwrap(await commands.getCreationRuntime())
        assertGeneration(runtime, plan.runtime)
        if (!owns() || !draftsUnchanged()) return false
        await endCreationTerminalForLeave(terminalIdentity)
        if (!owns() || !draftsUnchanged()) return false
        if (drafts && !(await drafts.apply())) return false
      }
      const nativeEpoch = unwrap(
        await commands.beginMainPerformanceKeyHandoff()
      )
      if (!owns()) return false
      if (
        plan.targetCreation &&
        usePerformanceRoleStore.getState().role === 'client'
      ) {
        if (!(await useClientParticipationStore.getState().leave()))
          throw new Error('Client participation cleanup failed')
        if (!owns()) return false
      }
      await closeProjectionWindow({ requireCompletion: true })
      if (!plan.preservesRun) runtime = await endRuntime(runtime, owns)
      if (get().active) await cleanupCreationParticipants()
      const workspace =
        plan.targetCreation && plan.workspace?.project.source === 'folder'
          ? plan.workspace
          : null
      await settled
      const latest = unwrap(await commands.getCreationRuntime())
      assertGeneration(latest, runtime)
      const checkpoint = mainSessionFacts.capture()
      const adopted = unwrap(
        await commands.commitCreationProject(
          workspace?.project.identity ?? null,
          latest.generation
        )
      )
      unwrap(await commands.hidePerformerQr())
      const oldIdentity = get().workspace?.project.identity
      assertModeOutcome(
        mainSessionFacts.select(checkpoint, adopted.snapshot).snapshot,
        adopted,
        plan.targetCreation
      )
      if (!owns()) return false
      // Native ownership must be revoked before creation becomes observable.
      if (plan.targetCreation) {
        expectOk(await commands.setMainPerformanceKeyOwner(nativeEpoch, false))
        revokedKeyEpoch = nativeEpoch
      }
      if (!owns()) return false
      if (oldIdentity && oldIdentity !== workspace?.project.identity) {
        retiredIdentity = oldIdentity
        await releaseIdentity(oldIdentity)
      }
      if (!workspace && plan.workspace) {
        await releaseIdentity(plan.workspace.project.identity)
        preparedReleased = true
      }
      if (!owns()) return false
      // Native ownership and identity release can both await. Validate the
      // actual facts again in the same synchronous segment as publication.
      assertModeOutcome(
        mainSessionFacts.select(checkpoint, adopted.snapshot).snapshot,
        adopted,
        plan.targetCreation
      )
      committed = !!workspace
      useProjectStore.getState().clearProject()
      if (plan.targetCreation) adoptRuntime(adopted, checkpoint)
      else useSessionStore.getState().resetSession()
      set(state => ({
        active: plan.targetCreation,
        workspace,
        ...(plan.targetCreation ? {} : { runtimeProject: null }),
        request: null,
        opening: false,
        error: null,
        recentPaths: workspace
          ? rememberWorkspace(workspace, state.recentPaths)
          : state.recentPaths,
        hoverPaused: true,
        restoreModeFocus: restoreFocus,
        modePhase: 'settling',
      }))
      // Performance is published first; retain the transition lock until the
      // native acknowledgment so creation can never lose its original keys.
      if (!plan.targetCreation)
        expectOk(await commands.setMainPerformanceKeyOwner(nativeEpoch, true))
      if (!owns()) return false
      if (plan.targetCreation) usePerformanceRoleStore.getState().resetRole()
      else usePerformanceRoleStore.getState().enterPerformance()
      set({ modePhase: 'idle', modePlan: null })
      return true
    } catch (error) {
      if (owns())
        set(state => ({
          modeError: creationTransportError(error),
          // Native close may already have retired this capability before a
          // late fact rejects the switch. Do not retain an unusable workspace.
          ...(retiredIdentity &&
          state.workspace?.project.identity === retiredIdentity
            ? { workspace: null, runtimeProject: null }
            : {}),
        }))
      return false
    } finally {
      try {
        clearTimeout(timer)
        if (revokedKeyEpoch !== undefined && !get().active && owns()) {
          try {
            expectOk(
              await commands.setMainPerformanceKeyOwner(revokedKeyEpoch, true)
            )
          } catch (error) {
            logger.warn('Failed to restore performance keyboard ownership', {
              error,
            })
          }
        }
        if (!committed && !preparedReleased && plan.workspace)
          await releaseIdentity(plan.workspace.project.identity)
        if (get().modePlan === plan)
          set({
            modePhase: 'idle',
            modePlan: null,
            restoreModeFocus: restoreFocus,
          })
      } finally {
        releaseTerminal?.()
      }
    }
  },
  enter: async () => {
    if (!get().active) {
      await get().prepareModeSwitch()
      await get().commitModeSwitch()
    }
  },
  leave: async () => {
    if (get().active) {
      await get().prepareModeSwitch()
      await get().commitModeSwitch()
    }
  },
  restoreRecent: paths =>
    set(state => ({
      recentPaths: [...new Set([...state.recentPaths, ...paths])].slice(0, 20),
    })),
  restoreCreationParent: parent => {
    // A late startup load cannot overwrite a parent already chosen this run.
    if (get().lastCreationParent === null) set({ lastCreationParent: parent })
  },
  rememberCreationParent: parent => {
    set({ lastCreationParent: parent })
    void updatePreferences({ lastCreationParent: parent })
  },
  removeRecent: path => {
    const recent = get().recentPaths
    const next = recent.filter(item => item !== path)
    if (next.length === recent.length) return
    set({ recentPaths: next })
    void updatePreferences({ recentCreationProjects: next })
  },
  create: options =>
    get().open(`${options.parent}/${options.folderName}`, options),
  open: async (path, newProject) => {
    if (
      !get().active ||
      get().opening ||
      get().modePhase !== 'idle' ||
      isSessionBusy(useSessionStore.getState().sessionStatus) ||
      useSessionStore.getState().commandPending
    )
      return false
    const request: CreationRequest = { path }
    set({ request, opening: true, error: null })
    const owns = () => get().active && get().request === request
    const run = async () => {
      if (!owns()) return false
      const {
        blockCreationTerminalOpen,
        confirmCreationTerminalLeave,
        endCreationTerminalForLeave,
      } = await import('@/lib/creation-terminal-leave')
      if (!owns()) return false
      const releaseTerminal = blockCreationTerminalOpen()
      const terminalIdentity = get().workspace?.project.identity ?? ''
      let prepared: CreationWorkspace | null = null
      let committed = false
      try {
        const runtime = unwrap(await commands.getCreationRuntime())
        assertAvailable(runtime)
        if (!newProject)
          prepared = unwrap(await commands.prepareCreationProject(path))
        if (!owns()) return false
        if (!(await approveCreationDiscard())) return false
        const drafts = await prepareCreationDraftChoice()
        if (!drafts) return false
        if (!(await confirmCreationTerminalLeave(terminalIdentity)))
          return false
        if (!owns() || !drafts.current()) return false
        assertGeneration(unwrap(await commands.getCreationRuntime()), runtime)
        if (!owns() || !drafts.current()) return false
        await endCreationTerminalForLeave(terminalIdentity)
        if (!owns() || !drafts.current() || !(await drafts.apply()))
          return false
        if (!owns()) return false
        if (newProject) {
          assertGeneration(unwrap(await commands.getCreationRuntime()), runtime)
          prepared = unwrap(await commands.createBlankProject(newProject))
        }
        if (!prepared || !owns()) return false
        let current = unwrap(await commands.getCreationRuntime())
        assertGeneration(current, runtime)
        if (
          prepared.project.root !== runtime.projectRoot ||
          prepared.project.source !== 'folder'
        )
          current = await endRuntime(current, owns)
        if (!owns()) return false
        await cleanupCreationParticipants()
        const checkpoint = mainSessionFacts.capture()
        const adopted = unwrap(
          await commands.commitCreationProject(
            prepared.project.identity,
            current.generation
          )
        )
        committed = true
        if (!owns()) {
          await releaseIdentity(prepared.project.identity)
          return false
        }
        adoptRuntime(adopted, checkpoint)
        const workspace = prepared
        set(state => ({
          workspace,
          recentPaths: rememberWorkspace(workspace, state.recentPaths),
          error: null,
        }))
        if (newProject)
          useProjectStore
            .getState()
            .registerCreatedProject(
              workspace.project.root,
              workspace.project.name
            )
        return true
      } catch (error) {
        if (owns()) {
          const failure = creationTransportError(error)
          set({
            error:
              newProject && prepared
                ? {
                    ...failure,
                    detail: `${i18n.t('creation.newProject.createdAt', { path: prepared.project.root })}\n${failure.detail}`,
                  }
                : failure,
          })
        }
        return false
      } finally {
        try {
          if (prepared && !committed)
            await releaseIdentity(prepared.project.identity)
          if (owns()) set({ opening: false, request: null })
        } finally {
          releaseTerminal?.()
        }
      }
    }
    const task = openQueue.then(run, run)
    openQueue = task
    return task
  },
  pick: async () => {
    if (!get().active || get().opening || get().modePhase !== 'idle')
      return false
    const epoch = get().epoch
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: i18n.t('creation.openFolder'),
      })
      return typeof selected === 'string' &&
        get().active &&
        get().epoch === epoch
        ? get().open(selected)
        : false
    } catch (error) {
      if (get().active && get().epoch === epoch)
        set({ error: creationTransportError(error) })
      return false
    }
  },
}))
