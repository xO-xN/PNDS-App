import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { isValidOscTarget } from '@/lib/audio-prefs'

/**
 * Session-flow module: the single implementation of all start-gating and
 * start/restart logic. Previously these rules were duplicated across four
 * components (§2 in the architecture review), and the OSC-target ternary
 * appeared verbatim three times.
 *
 * Components call `canStart()` for the Load button verdict and
 * `start()` / `restart()` for the actual IPC.
 */

/** Whether a session can be started right now (§8.1 gating). */
export function canStart(input: {
  currentProject: unknown
  preflightStatus: string
  sessionStatus: string
  lanIp: string | null
  audioMode: string
  oscTargetInput: string
}): boolean {
  const {
    currentProject,
    preflightStatus,
    sessionStatus,
    lanIp,
    audioMode,
    oscTargetInput,
  } = input

  if (
    !currentProject ||
    preflightStatus !== 'ready' ||
    sessionStatus !== 'idle' ||
    !lanIp
  ) {
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

/** §8.1: explicitly start the selected project. */
export async function start(): Promise<void> {
  const { currentProject, preflightStatus } = useProjectStore.getState()
  const { audioMode, lanIp, sessionStatus, oscTargetInput } =
    useSessionStore.getState()
  if (
    !canStart({
      currentProject,
      preflightStatus,
      sessionStatus,
      lanIp,
      audioMode,
      oscTargetInput,
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
  const result = await commands.startProject(
    currentProject.path,
    audioMode,
    lanIp,
    resolveOscTarget()
  )
  if (result.status === 'error') {
    useSessionStore.getState().failLocal(result.error)
  }
}

/** §8.3: restart the session with the current settings. */
export async function restart(): Promise<void> {
  const { currentProject } = useProjectStore.getState()
  const { audioMode, lanIp } = useSessionStore.getState()
  if (!currentProject || !lanIp) return

  logger.info('Restarting session', {
    path: currentProject.path,
    mode: audioMode,
  })
  await commands.stopProject()
  // Re-read the store after stop — ensure the latest oscTargetInput is used.
  const target = resolveOscTarget()
  logger.info('Restart OSC target', { mode: audioMode, target })
  const result = await commands.startProject(
    currentProject.path,
    audioMode,
    lanIp,
    target
  )
  if (result.status === 'error') {
    useSessionStore.getState().failLocal(result.error)
  }
}
