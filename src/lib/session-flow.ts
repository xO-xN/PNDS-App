import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { isValidOscTarget } from '@/lib/preferences'

/**
 * Session-flow module: the single implementation of all start-gating and
 * start/restart logic. Previously these rules were duplicated across four
 * components (§2 in the architecture review), and the OSC-target ternary
 * appeared verbatim three times.
 *
 * Components call `canStart()` for the Load button verdict and
 * `start()` / `restart()` for the actual IPC.
 */

/**
 * Whether a session can be started right now (§8.1 gating).
 *
 * `selectionIsRunningCard` (v1.2.3 #39/T4): false when the selected card
 * is NOT the session's own project — then Load means "start this over
 * whatever runs" and the idle/error sessionStatus gate does not apply
 * (the confirm-and-replace flow stops the old session itself).
 */
export function canStart(input: {
  currentProject: unknown
  preflightStatus: string
  sessionStatus: string
  lanIp: string | null
  audioMode: string
  oscTargetInput: string
  deviceError: string | null
  selectionIsRunningCard?: boolean
}): boolean {
  const {
    currentProject,
    preflightStatus,
    sessionStatus,
    lanIp,
    audioMode,
    oscTargetInput,
    deviceError,
    selectionIsRunningCard = true,
  } = input

  if (
    !currentProject ||
    preflightStatus !== 'ready' ||
    // §9.3: Retry starts from the error state without an explicit stop —
    // the failed generation was already cleaned up before the error
    // snapshot was emitted.
    (selectionIsRunningCard &&
      sessionStatus !== 'idle' &&
      sessionStatus !== 'error') ||
    !lanIp
  ) {
    return false
  }
  // §6.3: internal cannot start while device capability is unknown/broken.
  if (audioMode === 'internal' && deviceError) {
    return false
  }
  // §6.6: external mode cannot start with an invalid target.
  if (audioMode === 'external' && !isValidOscTarget(oscTargetInput)) {
    return false
  }
  return true
}

/** The OSC target parameter for startProject (null unless external). */
function resolveOscTarget(): string | null {
  const { audioMode, oscTargetInput } = useSessionStore.getState()
  return audioMode === 'external' ? oscTargetInput : null
}

/**
 * §9.3: one click = one start.
 *
 * The backend does real work — targeted orphan cleanup, port preflight and
 * output-device capability queries — before it publishes the `starting`
 * snapshot. During that window `sessionStatus` is still `error`, so the
 * Load / Retry button stays enabled and a second click would spawn a
 * second session. This module-level latch is the submit guard: it is set
 * synchronously, before the first `await`, and cleared in `finally`.
 */
let startInFlight = false

/** §8.1: explicitly start the selected project. Also the §9.3 Retry path:
 *  `error` is a legal starting point and no stop is issued first. */
export async function start(): Promise<void> {
  if (startInFlight) return
  const { currentProject, preflightStatus } = useProjectStore.getState()
  const { audioMode, lanIp, sessionStatus, oscTargetInput, deviceError } =
    useSessionStore.getState()
  if (
    !canStart({
      currentProject,
      preflightStatus,
      sessionStatus,
      lanIp,
      audioMode,
      oscTargetInput,
      deviceError,
    })
  ) {
    return
  }

  // `canStart()` already verified these — narrow for TS.
  if (!currentProject || !lanIp) return

  logger.info('Starting project', {
    path: currentProject.path,
    mode: audioMode,
    lanIp,
  })
  startInFlight = true
  try {
    const result = await commands.startProject(
      currentProject.path,
      audioMode,
      lanIp,
      resolveOscTarget()
    )
    if (result.status === 'error') {
      useSessionStore.getState().failLocal(result.error)
    }
  } finally {
    startInFlight = false
  }
}

/** §8.3: restart the session with the current settings. */
export async function restart(): Promise<void> {
  if (startInFlight) return
  const { currentProject } = useProjectStore.getState()
  const { audioMode, lanIp, oscTargetInput } = useSessionStore.getState()
  if (!currentProject || !lanIp) return

  logger.info('Restarting session', {
    path: currentProject.path,
    mode: audioMode,
  })
  useSessionStore.getState().setPendingChanges(false)
  startInFlight = true
  try {
    await commands.stopProject()
    // Capture BEFORE the await — stopProject emits snapshots whose
    // audio_mode is the PREVIOUS session's mode, and applySnapshot
    // overwrites the user's pending selection (?? only guards null).
    const target = audioMode === 'external' ? oscTargetInput : null
    const result = await commands.startProject(
      currentProject.path,
      audioMode,
      lanIp,
      target
    )
    if (result.status === 'error') {
      useSessionStore.getState().failLocal(result.error)
    }
  } finally {
    startInFlight = false
  }
}

/**
 * v1.2.3 (#39/T4): start the SELECTED project over a live session — the
 * confirm-and-replace switch. Stops the running session (a raw
 * `stopProject`, never `stopAndReset`: the selection stays) and then
 * starts the selected project with its pending config. The caller owns
 * the "will close the running project" confirmation; an `error` session
 * is already dead and may be replaced the same way (the stop is
 * idempotent).
 */
export async function startReplacing(): Promise<void> {
  if (startInFlight) return
  const { currentProject, preflightStatus } = useProjectStore.getState()
  const { audioMode, lanIp, sessionStatus, oscTargetInput, deviceError } =
    useSessionStore.getState()
  if (
    !canStart({
      currentProject,
      preflightStatus,
      sessionStatus,
      lanIp,
      audioMode,
      oscTargetInput,
      deviceError,
      selectionIsRunningCard: false,
    })
  ) {
    return
  }
  if (!currentProject || !lanIp) return

  logger.info('Switching session', {
    path: currentProject.path,
    mode: audioMode,
  })
  useSessionStore.getState().setPendingChanges(false)
  startInFlight = true
  try {
    // Capture BEFORE the awaits — the old session's snapshots must not
    // yank the new selection's pending config (see restart()).
    const target = audioMode === 'external' ? oscTargetInput : null
    await commands.stopProject()
    const result = await commands.startProject(
      currentProject.path,
      audioMode,
      lanIp,
      target
    )
    if (result.status === 'error') {
      useSessionStore.getState().failLocal(result.error)
    }
  } finally {
    startInFlight = false
  }
}
