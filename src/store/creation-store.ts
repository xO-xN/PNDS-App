import { create } from 'zustand'
import { open } from '@tauri-apps/plugin-dialog'
import i18n from '@/i18n/config'
import {
  commands,
  expectOk,
  type CreationError,
  type CreationWorkspace,
  type CreationRuntime,
  type Result,
} from '@/lib/tauri-bindings'
import { DEFAULT_OSC_TARGET, updatePreferences } from '@/lib/preferences'
import { logger } from '@/lib/logger'
import { closeProjectionWindow } from '@/lib/projection-window'
import {
  approveCreationDiscard,
  cleanupCreationParticipants,
  confirmDiscardCreationDrafts,
} from '@/lib/creation-lifecycle'
import { isSessionBusy, useSessionStore } from './session-store'
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
  recentPaths: string[]
  opening: boolean
  request: CreationRequest | null
  error: CreationError | null
  modePhase: 'idle' | 'preparing' | 'armed' | 'settling'
  modePlan: CreationModePlan | null
  modeError: CreationError | null
  hoverPaused: boolean
  modePointerInside: boolean
  restoreModeFocus: boolean
  prepareModeSwitch: () => Promise<void>
  cancelModeSwitch: () => void
  commitModeSwitch: (
    duration?: number,
    restoreFocus?: boolean
  ) => Promise<boolean>
  enter: () => Promise<void>
  leave: () => Promise<void>
  restoreRecent: (paths: string[]) => void
  open: (path: string) => Promise<boolean>
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
async function endRuntime(runtime: CreationRuntime): Promise<CreationRuntime> {
  if (runtime.snapshot.status === 'idle') return runtime
  expectOk(await commands.stopProject())
  const stopped = unwrap(await commands.getCreationRuntime())
  if (stopped.snapshot.status !== 'idle')
    throw new Error(i18n.t('creation.switchStale'))
  useSessionStore.getState().applySnapshot(stopped.snapshot)
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
function newestSnapshot(runtime: CreationRuntime, revision: number) {
  const current = useSessionStore.getState()
  return current.snapshotRevision === revision
    ? runtime.snapshot
    : (current.latestSnapshot ?? runtime.snapshot)
}
function adoptRuntime(runtime: CreationRuntime, revision: number): void {
  const snapshot = newestSnapshot(runtime, revision)
  if (useSessionStore.getState().snapshotRevision === revision)
    useSessionStore.getState().applySnapshot(snapshot)
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
  recentPaths: [],
  opening: false,
  request: null,
  error: null,
  modePhase: 'idle',
  modePlan: null,
  modeError: null,
  hoverPaused: false,
  modePointerInside: false,
  restoreModeFocus: false,
  prepareModeSwitch: async () => {
    if (
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
      const path = targetCreation
        ? runtime.snapshot.status === 'ready'
          ? runtime.snapshot.projectPath
          : useProjectStore.getState().currentProject?.path
        : null
      if (path && owns())
        workspace = unwrap(await commands.prepareCreationProject(path))
      if (!owns()) {
        if (workspace) await releaseIdentity(workspace.project.identity)
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
  commitModeSwitch: async (duration = 0, restoreFocus = false) => {
    const plan = get().modePlan
    if (
      !plan ||
      get().modePhase !== 'armed' ||
      get().opening ||
      isSessionBusy(useSessionStore.getState().sessionStatus) ||
      useSessionStore.getState().commandPending
    )
      return false
    set({ modePhase: 'settling', modeError: null })
    let timer: ReturnType<typeof setTimeout> | undefined
    const settled =
      duration > 0
        ? new Promise<void>(resolve => {
            timer = setTimeout(resolve, duration)
          })
        : Promise.resolve()
    let committed = false
    let preparedReleased = false
    try {
      if (get().active && !(await approveCreationDiscard())) return false
      let runtime = unwrap(await commands.getCreationRuntime())
      assertGeneration(runtime, plan.runtime)
      await closeProjectionWindow({ requireCompletion: true })
      if (!plan.preservesRun) runtime = await endRuntime(runtime)
      if (get().active) await cleanupCreationParticipants()
      const workspace =
        plan.targetCreation && plan.workspace?.project.source === 'folder'
          ? plan.workspace
          : null
      await settled
      const latest = unwrap(await commands.getCreationRuntime())
      assertGeneration(latest, runtime)
      const revision = useSessionStore.getState().snapshotRevision
      const adopted = unwrap(
        await commands.commitCreationProject(
          workspace?.project.identity ?? null,
          latest.generation
        )
      )
      const oldIdentity = get().workspace?.project.identity
      const facts = newestSnapshot(adopted, revision)
      if (
        isSessionBusy(facts.status) ||
        (facts.status === 'ready' &&
          (adopted.snapshot.status !== 'ready' ||
            facts.projectPath !== adopted.snapshot.projectPath))
      )
        throw new Error(i18n.t('creation.switchStale'))
      if (
        !plan.targetCreation &&
        newestSnapshot(adopted, revision).status !== 'idle'
      )
        throw new Error(i18n.t('creation.switchStale'))
      committed = !!workspace
      if (oldIdentity && oldIdentity !== workspace?.project.identity)
        await releaseIdentity(oldIdentity)
      if (!workspace && plan.workspace) {
        await releaseIdentity(plan.workspace.project.identity)
        preparedReleased = true
      }
      useProjectStore.getState().clearProject()
      if (plan.targetCreation) adoptRuntime(adopted, revision)
      else useSessionStore.getState().resetSession()
      set(state => ({
        active: plan.targetCreation,
        workspace,
        request: null,
        opening: false,
        error: null,
        recentPaths: workspace
          ? rememberWorkspace(workspace, state.recentPaths)
          : state.recentPaths,
        hoverPaused: true,
        restoreModeFocus: restoreFocus,
        modePhase: 'idle',
        modePlan: null,
      }))
      return true
    } catch (error) {
      set({ modeError: creationTransportError(error) })
      return false
    } finally {
      clearTimeout(timer)
      if (!committed && !preparedReleased && plan.workspace)
        await releaseIdentity(plan.workspace.project.identity)
      if (get().modePlan === plan)
        set({
          modePhase: 'idle',
          modePlan: null,
          restoreModeFocus: restoreFocus,
        })
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
  open: async path => {
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
      let prepared: CreationWorkspace | null = null
      let committed = false
      try {
        const runtime = unwrap(await commands.getCreationRuntime())
        assertAvailable(runtime)
        prepared = unwrap(await commands.prepareCreationProject(path))
        if (!owns()) return false
        if (!(await approveCreationDiscard())) return false
        // #154: drafts ask for one explicit discard confirmation before the
        // switch proceeds; cancelling keeps drafts, run and windows.
        if (!(await confirmDiscardCreationDrafts())) return false
        if (!owns()) return false
        let current = unwrap(await commands.getCreationRuntime())
        assertGeneration(current, runtime)
        if (
          prepared.project.root !== runtime.projectRoot ||
          prepared.project.source !== 'folder'
        )
          current = await endRuntime(current)
        if (!owns()) return false
        await cleanupCreationParticipants()
        const revision = useSessionStore.getState().snapshotRevision
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
        adoptRuntime(adopted, revision)
        const workspace = prepared
        set(state => ({
          workspace,
          recentPaths: rememberWorkspace(workspace, state.recentPaths),
          error: null,
        }))
        return true
      } catch (error) {
        if (owns()) set({ error: creationTransportError(error) })
        return false
      } finally {
        if (prepared && !committed)
          await releaseIdentity(prepared.project.identity)
        if (owns()) set({ opening: false, request: null })
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
