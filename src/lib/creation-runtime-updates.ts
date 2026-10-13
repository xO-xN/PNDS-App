import {
  useCreationFilesStore,
  isCreationWorkspacePath,
  type CreationUpdateToken,
} from '@/store/creation-files-store'
import { commands } from '@/lib/tauri-bindings'
import { refreshCreationPages } from '@/lib/creation-lifecycle'
import { logger } from '@/lib/logger'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'

/** Manual navigation adopts saved pages only. Its successful load acknowledges
 * the captured disk revision; later disk edits retain their action prompt. */
let refreshRequest: { runId: number; identity: string | undefined } | null =
  null
export async function refreshMonitorFromDisk(): Promise<void> {
  const session = useSessionStore.getState()
  const creation = useCreationStore.getState()
  if (
    session.sessionStatus !== 'ready' ||
    session.commandPending ||
    creation.opening ||
    creation.modePhase !== 'idle'
  )
    return
  const identity = creation.workspace?.project.identity
  const root = session.sessionProjectPath
  const run = session.runId
  if (refreshRequest?.runId === run && refreshRequest.identity === identity)
    return
  const request = { runId: run, identity }
  refreshRequest = request
  let gateHeld = true
  useSessionStore.setState({ commandPending: true })
  try {
    const token =
      creation.active && isCreationWorkspacePath(root) && root
        ? await useCreationFilesStore.getState().capture(root)
        : null
    const current = useSessionStore.getState()
    if (
      current.sessionStatus !== 'ready' ||
      current.runId !== run ||
      current.sessionProjectPath !== root ||
      useCreationStore.getState().workspace?.project.identity !== identity
    )
      return
    current.bumpMonitorReload()
    const nonce = useSessionStore.getState().monitorReloadNonce
    gateHeld = false
    useSessionStore.setState({ commandPending: false })
    const refreshPages = () =>
      creation.active && identity
        ? refreshCreationPages({ identity, runId: run, nonce })
        : Promise.resolve()
    if (!token) {
      await refreshPages()
      return
    }
    let pagesReady = false
    let finished = false
    const release = () => {
      finished = true
      unsubscribe()
      unsubscribeWorkspace()
    }
    const evaluate = () => {
      if (finished) return
      const state = useSessionStore.getState()
      if (
        state.runId !== run ||
        state.monitorReloadNonce !== nonce ||
        state.sessionStatus !== 'ready' ||
        state.monitorLoadTimedOut
      ) {
        release()
        return
      }
      if (pagesReady && state.monitorLoaded) {
        useCreationFilesStore.getState().complete(token, 'refresh')
        release()
      }
    }
    const unsubscribe = useSessionStore.subscribe(evaluate)
    const unsubscribeWorkspace = useCreationStore.subscribe(state => {
      if (state.workspace?.project.identity !== identity) release()
    })
    try {
      await refreshPages()
      pagesReady = true
      evaluate()
    } catch (error) {
      release()
      const state = useSessionStore.getState()
      if (
        useCreationStore.getState().workspace?.project.identity === identity &&
        state.runId === run &&
        state.sessionStatus === 'ready' &&
        state.monitorReloadNonce === nonce
      )
        throw error
    }
  } finally {
    if (gateHeld) useSessionStore.setState({ commandPending: false })
    if (refreshRequest === request) refreshRequest = null
  }
}

/** A successful start command only spawns the supervisor. Acknowledge after
 * its new run becomes ready and the backend confirms the canonical root. */
export function trackCreationRestart(
  token: CreationUpdateToken | null,
  path: string
): (submitted: boolean, generation?: string) => void {
  if (!token) return () => undefined
  const previousRun = useSessionStore.getState().runId
  let run: number | null = null
  let expectedGeneration: string | undefined
  let submitted = false
  let checking = false
  let finished = false
  const release = () => {
    finished = true
    unsubscribe()
    unsubscribeWorkspace()
  }
  const evaluate = () => {
    if (finished) return
    const state = useSessionStore.getState()
    if (state.runId !== previousRun) {
      if (
        state.sessionProjectPath !== path ||
        (run !== null && run !== state.runId)
      ) {
        release()
        return
      }
      run = state.runId
    }
    if (run === null && !expectedGeneration) return
    if (
      state.sessionStatus === 'error' ||
      state.sessionStatus === 'idle' ||
      state.sessionStatus === 'stopping'
    ) {
      release()
      return
    }
    if (!submitted || state.sessionStatus !== 'ready' || checking) return
    checking = true
    const probeRun = state.runId
    const revision = state.snapshotRevision
    let keepWatching = false
    void commands
      .getCreationRuntime()
      .then(result => {
        const current = useSessionStore.getState()
        const workspace = useCreationStore.getState().workspace
        if (
          finished ||
          result.status !== 'ok' ||
          current.runId !== probeRun ||
          (expectedGeneration &&
            result.data.generation !== expectedGeneration) ||
          result.data.projectRoot !== workspace?.project.root ||
          result.data.snapshot.projectPath !== path
        )
          return
        if (result.data.snapshot.status !== 'ready') {
          keepWatching = result.data.snapshot.status === 'starting'
          if (expectedGeneration && current.snapshotRevision === revision)
            useSessionStore.getState().applySnapshot(result.data.snapshot)
          return
        }
        if (run === null) {
          run = current.runId + 1
          useSessionStore.setState({ runId: run })
        }
        if (
          expectedGeneration &&
          useSessionStore.getState().snapshotRevision === revision
        )
          useSessionStore.getState().applySnapshot(result.data.snapshot)
        if (useSessionStore.getState().sessionStatus === 'ready')
          useCreationFilesStore.getState().complete(token, 'restart')
      })
      .catch(error =>
        logger.warn('Could not confirm creation runtime readiness', { error })
      )
      .finally(() => {
        checking = false
        if (!keepWatching) release()
      })
  }
  const unsubscribe = useSessionStore.subscribe(evaluate)
  const unsubscribeWorkspace = useCreationStore.subscribe(state => {
    if (state.workspace?.project.identity !== token.identity) release()
  })
  return (success, generation) => {
    if (!success) {
      release()
      return
    }
    expectedGeneration = generation
    submitted = true
    evaluate()
  }
}
