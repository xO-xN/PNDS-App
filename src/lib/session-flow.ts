import { commands, type AudioMode } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { selectionIsRunningCard, useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { useSettingsStore } from '@/store/settings-store'
import { isNodeConfigComplete, isValidOscTarget } from '@/lib/preferences'

/**
 * Session-flow module: the single implementation of all start-gating and
 * start/restart logic. Previously these rules were duplicated across four
 * components (§2 in the architecture review), and the OSC-target ternary
 * appeared verbatim three times.
 *
 * The gate reads the live stores directly — zero arguments. Callers can
 * no longer assemble a stale or partial view of the world (the old
 * 8-input `canStart` was an interface as wide as the rules themselves;
 * every optional input was a gate a caller could forget to pass), and
 * the #58 node gate has exactly one derivation for every consumer: the
 * session button, the Enter alias, and every start path.
 */

/**
 * #58: the「设置节点」gate's verdict — the SELECTED project declares
 * telematic capability but the App-global node config (node name / hub
 * address / token) is incomplete. Reads the live stores so every consumer
 * (the session button, the Enter alias, every start path) shares one
 * derivation; undeclared projects are never gated, and the gate checks
 * completeness only, never connectivity.
 */
export function nodeGateBlocksStart(): boolean {
  const { currentProject } = useProjectStore.getState()
  if (currentProject?.manifest.telematic !== true) return false
  const { nodeNameSetting, hubUrlSetting, hubTokenSetting } =
    useSettingsStore.getState()
  return !isNodeConfigComplete(nodeNameSetting, hubUrlSetting, hubTokenSetting)
}

/** What a start submits to the backend — §8.1's inputs, narrowed. */
interface StartPlan {
  path: string
  audioMode: AudioMode
  lanIp: string
  /** §6.6: the external OSC target; null in every other mode. */
  oscTarget: string | null
}

/**
 * §8.1 gate + submit inputs in a single read of the live stores: the
 * selected project's start plan, or null when any gate refuses. Private —
 * the module's interface is the gate booleans plus the start verbs; the
 * plan is what the verbs consume once the gate passes (under the old
 * `canStart`, callers re-read these fields and `!`-narrowed them again).
 *
 * The session gate depends on the verb: `plain` (start/Retry, §9.3)
 * requires idle|error; `replace` (confirm-and-replace, v1.2.3 #39/T4)
 * skips it — that flow stops the live session itself.
 */
function resolveStartPlan(gate: 'plain' | 'replace'): StartPlan | null {
  const { currentProject, preflightStatus } = useProjectStore.getState()
  const { sessionStatus, lanIp, audioMode, oscTargetInput } =
    useSessionStore.getState()

  if (nodeGateBlocksStart()) return null
  if (!currentProject || preflightStatus !== 'ready' || !lanIp) return null
  // §9.3: Retry starts from the error state without an explicit stop —
  // the failed generation was already cleaned up before the error
  // snapshot was emitted.
  if (
    gate === 'plain' &&
    sessionStatus !== 'idle' &&
    sessionStatus !== 'error'
  ) {
    return null
  }
  // §6.6: external mode cannot start with an invalid target.
  if (audioMode === 'external' && !isValidOscTarget(oscTargetInput)) {
    return null
  }
  return {
    path: currentProject.path,
    audioMode,
    lanIp,
    oscTarget: audioMode === 'external' ? oscTargetInput : null,
  }
}

/**
 * Whether the session for the currently selected card can be started
 * right now (§8.1 gating) — the Load button's verdict. The running card
 * follows the plain idle/error gate; another card selected over a live
 * session follows the replace gate (v1.2.3 #39/T4: its Load IS the
 * confirm-and-replace switch, which stops the old session itself).
 */
export function canStartNow(): boolean {
  const { currentProject } = useProjectStore.getState()
  if (!currentProject) return false
  const { sessionStatus, sessionProjectPath } = useSessionStore.getState()
  const runningCardSelected = selectionIsRunningCard(
    { sessionStatus, sessionProjectPath },
    currentProject.path
  )
  return resolveStartPlan(runningCardSelected ? 'plain' : 'replace') !== null
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
  const plan = resolveStartPlan('plain')
  if (!plan) return

  logger.info('Starting project', {
    path: plan.path,
    mode: plan.audioMode,
    lanIp: plan.lanIp,
  })
  startInFlight = true
  try {
    const result = await commands.startProject(
      plan.path,
      plan.audioMode,
      plan.lanIp,
      plan.oscTarget
    )
    if (result.status === 'error') {
      useSessionStore.getState().failLocal(result.error)
    }
  } finally {
    startInFlight = false
  }
}

/**
 * The stop→start core shared by §8.3 restarts and the confirm-and-replace
 * switch: the submit latch, the capture-BEFORE-await config (stopProject
 * emits snapshots whose audio_mode is the PREVIOUS session's, and
 * applySnapshot overwrites the pending selection — ?? only guards null)
 * and the failure funnel.
 */
async function stopThenStart(
  path: string,
  audioMode: AudioMode,
  lanIp: string,
  oscTarget: string | null
): Promise<void> {
  startInFlight = true
  try {
    await commands.stopProject()
    const result = await commands.startProject(
      path,
      audioMode,
      lanIp,
      oscTarget
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
  const { audioMode, lanIp } = useSessionStore.getState()
  if (!currentProject || !lanIp) return
  // #58: the「设置节点」gate applies to restarts too — a declared project
  // never restarts into an unconfigured node (no hub variables injected).
  if (nodeGateBlocksStart()) return

  logger.info('Restarting session', {
    path: currentProject.path,
    mode: audioMode,
  })
  useSessionStore.getState().setPendingChanges(false)
  await stopThenStart(currentProject.path, audioMode, lanIp, resolveOscTarget())
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
  const plan = resolveStartPlan('replace')
  if (!plan) return

  logger.info('Switching session', {
    path: plan.path,
    mode: plan.audioMode,
  })
  useSessionStore.getState().setPendingChanges(false)
  await stopThenStart(plan.path, plan.audioMode, plan.lanIp, plan.oscTarget)
}
