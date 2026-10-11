import {
  useCreationChangesStore,
  isCreationWorkspacePath,
  type CreationUpdateToken,
} from '@/store/creation-changes-store'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'

/** Manual navigation adopts saved pages only. Its successful load acknowledges
 * the captured disk revision; later disk edits retain their action prompt. */
export async function refreshMonitorFromDisk(): Promise<void> {
  const session = useSessionStore.getState()
  if (session.sessionStatus !== 'ready') return
  const workspace = useCreationStore.getState().workspace
  const identity = workspace?.project.identity
  const root = session.sessionProjectPath
  const run = session.runId
  const token =
    useCreationStore.getState().active && isCreationWorkspacePath(root) && root
      ? await useCreationChangesStore.getState().capture(root)
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
  if (!token) return
  const nonce = useSessionStore.getState().monitorReloadNonce
  const release = () => {
    unsubscribe()
    unsubscribeWorkspace()
  }
  const unsubscribe = useSessionStore.subscribe(state => {
    if (
      state.runId !== run ||
      state.monitorReloadNonce !== nonce ||
      state.sessionStatus !== 'ready'
    )
      release()
    else if (state.monitorLoaded) {
      useCreationChangesStore.getState().complete(token, 'refresh')
      release()
    }
  })
  const unsubscribeWorkspace = useCreationStore.subscribe(state => {
    if (state.workspace?.project.identity !== identity) release()
  })
}

/** A successful start command only spawns the supervisor. Acknowledge after
 * its new run becomes ready and the backend confirms the canonical root. */
export function trackCreationRestart(
  token: CreationUpdateToken | null,
  path: string
): (submitted: boolean) => void {
  if (!token) return () => undefined
  const previousRun = useSessionStore.getState().runId
  let run: number | null = null
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
    if (run === null) return
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
    void commands
      .getCreationRuntime()
      .then(result => {
        const current = useSessionStore.getState()
        const workspace = useCreationStore.getState().workspace
        if (
          !finished &&
          result.status === 'ok' &&
          result.data.snapshot.status === 'ready' &&
          result.data.projectRoot === workspace?.project.root &&
          result.data.snapshot.projectPath === path &&
          current.sessionStatus === 'ready' &&
          current.runId === run
        ) {
          useCreationChangesStore.getState().complete(token, 'restart')
        }
      })
      .catch(error => {
        logger.warn('Could not confirm creation runtime readiness', { error })
      })
      .finally(release)
  }
  const unsubscribe = useSessionStore.subscribe(evaluate)
  const unsubscribeWorkspace = useCreationStore.subscribe(state => {
    if (state.workspace?.project.identity !== token.identity) release()
  })
  return success => {
    if (!success) {
      release()
      return
    }
    submitted = true
    evaluate()
  }
}
