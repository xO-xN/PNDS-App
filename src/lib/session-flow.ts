import { create } from 'zustand'
import i18n from '@/i18n/config'
import {
  commands,
  type AudioMode,
  type Manifest,
  type SessionStatus,
} from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { selectionIsRunningCard, useSessionStore } from '@/store/session-store'
import {
  useProjectStore,
  type CurrentProject,
  type PreflightStatus,
} from '@/store/project-store'
import { useSettingsStore } from '@/store/settings-store'
import { useCreationStore } from '@/store/creation-store'
import {
  useCreationFilesStore,
  isCreationWorkspacePath,
} from '@/store/creation-files-store'
import { trackCreationRestart } from '@/lib/creation-runtime-updates'
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
 *
 * React Compiler caveat (user report 2026-09-08): a RENDER-path verdict
 * must derive from SUBSCRIBED values (`useStartGateInputs()` +
 * `canStartNowFrom`), never from the zero-arg `getState()` readers — the
 * compiler sees the latter as a dependency-free constant and memoizes it
 * after the first render, freezing the Load button at its boot verdict.
 * The zero-arg verbs stay for event handlers and effects, where they run
 * per invocation.
 */

/**
 * Every input the start gate can read, in one record. One home for the
 * list means adding a gate input is a one-file change: subscribe here,
 * derive in `canStartNowFrom`, and no consumer can forget a re-render
 * subscription again.
 */
export interface StartGateInputs {
  modeSwitchBlocked?: boolean
  commandPending?: boolean
  currentProject: CurrentProject | null
  preflightStatus: PreflightStatus
  sessionStatus: SessionStatus
  sessionProjectPath: string | null
  audioMode: AudioMode
  lanIp: string | null
  oscTargetInput: string
  nodeNameSetting: string
  hubUrlSetting: string
  hubTokenSetting: string
}

/** The gate inputs as live subscriptions — for render paths. */
export function useStartGateInputs(): StartGateInputs {
  const modeSwitchBlocked = useCreationStore(
    state => state.modePhase !== 'idle'
  )
  const commandPending = useSessionStore(state => state.commandPending)
  const currentProject = useProjectStore(state => state.currentProject)
  const preflightStatus = useProjectStore(state => state.preflightStatus)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const sessionProjectPath = useSessionStore(state => state.sessionProjectPath)
  const audioMode = useSessionStore(state => state.audioMode)
  const lanIp = useSessionStore(state => state.lanIp)
  const oscTargetInput = useSessionStore(state => state.oscTargetInput)
  const nodeNameSetting = useSettingsStore(state => state.nodeNameSetting)
  const hubUrlSetting = useSettingsStore(state => state.hubUrlSetting)
  const hubTokenSetting = useSettingsStore(state => state.hubTokenSetting)
  return {
    modeSwitchBlocked,
    commandPending,
    currentProject,
    preflightStatus,
    sessionStatus,
    sessionProjectPath,
    audioMode,
    lanIp,
    oscTargetInput,
    nodeNameSetting,
    hubUrlSetting,
    hubTokenSetting,
  }
}

/** The gate inputs straight from the live stores — for event handlers. */
function readStartGateInputs(): StartGateInputs {
  const { currentProject, preflightStatus } = useProjectStore.getState()
  const {
    sessionStatus,
    sessionProjectPath,
    audioMode,
    lanIp,
    oscTargetInput,
  } = useSessionStore.getState()
  const { nodeNameSetting, hubUrlSetting, hubTokenSetting } =
    useSettingsStore.getState()
  return {
    modeSwitchBlocked: useCreationStore.getState().modePhase !== 'idle',
    commandPending: useSessionStore.getState().commandPending,
    currentProject,
    preflightStatus,
    sessionStatus,
    sessionProjectPath,
    audioMode,
    lanIp,
    oscTargetInput,
    nodeNameSetting,
    hubUrlSetting,
    hubTokenSetting,
  }
}

/**
 * #58: the「设置节点」gate's verdict — the SELECTED project declares
 * telematic capability but the App-global node config (node name / hub
 * address / token) is incomplete. Undeclared projects are never gated,
 * and the gate checks completeness only, never connectivity. Derived
 * from gate inputs so render paths stay reactive; `nodeGateBlocksStart`
 * is the event-handler form.
 */
export function nodeGateBlocked(inputs: StartGateInputs): boolean {
  if (inputs.currentProject?.manifest.telematic !== true) return false
  return !isNodeConfigComplete(
    inputs.nodeNameSetting,
    inputs.hubUrlSetting,
    inputs.hubTokenSetting
  )
}

/** #58 gate for imperative contexts (menu, keyboard, start paths). */
export function nodeGateBlocksStart(): boolean {
  return nodeGateBlocked(readStartGateInputs())
}

/**
 * #140: the explicit legacy-HTTP choice. When the entry switch is on
 * but the selected project has not declared `supportsPerformerUrl`, a
 * start must never silently downgrade to HTTP — the operator confirms
 * the HTTP flow per start click through the App-styled dialog
 * (`HttpsCompatDialog`), which resolves the pending choice here. Pure
 * module plumbing: session-flow is the non-React authority, the dialog
 * is just its UI.
 */
const useHttpsCompatDialogInternal = create<{
  open: boolean
  setHttpsCompatOpen: (open: boolean) => void
}>(set => ({
  open: false,
  setHttpsCompatOpen: open => set({ open }),
}))

/** The dialog's open state, for the component (and tests). */
export const useHttpsCompatDialog = useHttpsCompatDialogInternal

let httpsCompatResolver: ((proceed: boolean) => void) | null = null

/** The one landing point for the dialog's buttons and dismissals. */
export function resolveHttpsCompatChoice(proceed: boolean): void {
  useHttpsCompatDialogInternal.getState().setHttpsCompatOpen(false)
  httpsCompatResolver?.(proceed)
  httpsCompatResolver = null
}

/** The #140 compat rule as a pure derivation — switch on × project
 * undeclared × the work declares it needs the entry. One home for the
 * rule so the start gate (imperative) and the settings card's notice
 * (reactive) can never drift. `needsHttps` is opt-in (user adjustment
 * after #174): only an explicit `true` declares the work performs
 * through the HTTPS entry — absent, `false` and non-boolean (every
 * legacy project) never see the notice nor the fallback question. */
export function httpsCompatBlocked(
  supportsPerformerUrl: boolean | null | undefined,
  httpsEnabled: boolean,
  needsHttps?: boolean | null
): boolean {
  return httpsEnabled && supportsPerformerUrl !== true && needsHttps === true
}

/** True when starting the current selection needs the explicit HTTP
 * choice (switch on × project undeclared × work needs it — #140's
 * compat rule). */
export function httpsCompatChoiceNeeded(): boolean {
  const { currentProject } = useProjectStore.getState()
  return httpsCompatBlocked(
    currentProject?.manifest.scoreServer.supportsPerformerUrl,
    useSettingsStore.getState().httpsEnabledSetting,
    currentProject?.manifest.scoreServer.needsHttps
  )
}

/** Opens the choice dialog and resolves with the operator's answer.
 * Call only when `httpsCompatChoiceNeeded()` — the common start path
 * keeps its synchronous-submit shape and never awaits this. */
function openHttpsCompatChoice(): Promise<boolean> {
  return new Promise(resolve => {
    httpsCompatResolver = resolve
    useHttpsCompatDialogInternal.getState().setHttpsCompatOpen(true)
  })
}

/** What a start submits to the backend — §8.1's inputs, narrowed. */
interface StartPlan {
  manifest: Manifest | null
  path: string
  audioMode: AudioMode
  lanIp: string
  /** §6.6: the external OSC target; null in every other mode. */
  oscTarget: string | null
}

/**
 * §8.1 gate + submit inputs from gate inputs: the selected project's
 * start plan, or null when any gate refuses. Private — the module's
 * interface is the gate booleans plus the start verbs; the plan is what
 * the verbs consume once the gate passes (under the old `canStart`,
 * callers re-read these fields and `!`-narrowed them again).
 *
 * The session gate depends on the verb: `plain` (start/Retry, §9.3)
 * requires idle|error; `replace` (confirm-and-replace, v1.2.3 #39/T4)
 * skips it — that flow stops the live session itself.
 */
function resolveStartPlanFrom(
  gate: 'plain' | 'replace',
  inputs: StartGateInputs
): StartPlan | null {
  if (inputs.modeSwitchBlocked || inputs.commandPending) return null
  if (nodeGateBlocked(inputs)) return null
  if (
    !inputs.currentProject ||
    inputs.preflightStatus !== 'ready' ||
    !inputs.lanIp
  )
    return null
  // §9.3: Retry starts from the error state without an explicit stop —
  // the failed generation was already cleaned up before the error
  // snapshot was emitted.
  if (
    gate === 'plain' &&
    inputs.sessionStatus !== 'idle' &&
    inputs.sessionStatus !== 'error'
  ) {
    return null
  }
  // §6.6: external mode cannot start with an invalid target.
  if (
    inputs.audioMode === 'external' &&
    !isValidOscTarget(inputs.oscTargetInput)
  ) {
    return null
  }
  return {
    manifest: inputs.currentProject.manifest,
    path: inputs.currentProject.path,
    audioMode: inputs.audioMode,
    lanIp: inputs.lanIp,
    oscTarget: inputs.audioMode === 'external' ? inputs.oscTargetInput : null,
  }
}

/** The live-stores form for the start verbs below. */
function resolveStartPlan(gate: 'plain' | 'replace'): StartPlan | null {
  return resolveStartPlanFrom(gate, readStartGateInputs())
}

/**
 * Whether the session for the given gate inputs can be started right now
 * (§8.1 gating) — the Load button's RENDER verdict. Deriving from the
 * subscribed `useStartGateInputs()` record keeps the dependency visible
 * to the React Compiler; the running card follows the plain idle/error
 * gate, another card selected over a live session follows the replace
 * gate (v1.2.3 #39/T4: its Load IS the confirm-and-replace switch, which
 * stops the old session itself).
 */
export function canStartNowFrom(inputs: StartGateInputs): boolean {
  if (!inputs.currentProject) return false
  const runningCardSelected = selectionIsRunningCard(
    {
      sessionStatus: inputs.sessionStatus,
      sessionProjectPath: inputs.sessionProjectPath,
    },
    inputs.currentProject.path
  )
  return (
    resolveStartPlanFrom(runningCardSelected ? 'plain' : 'replace', inputs) !==
    null
  )
}

/**
 * #147 (user report from the dual-machine acceptance): whether a missing
 * LAN address is what keeps an otherwise-ready selection from starting —
 * the one gate failure the footer can SAY something about (no project →
 * no footer at all; not-ready → preflight's own surface; the node gate →
 * the「设置节点」button). Lives beside the gate so a future gate input
 * cannot strand the hint: both derive from the same inputs record.
 */
export function lanAddressMissingFrom(inputs: StartGateInputs): boolean {
  return (
    !nodeGateBlocked(inputs) &&
    inputs.currentProject !== null &&
    inputs.preflightStatus === 'ready' &&
    inputs.lanIp === null
  )
}

/**
 * Whether the session for the currently selected card can be started
 * right now — the event-handler form (Enter alias, tests). In render
 * paths use `canStartNowFrom(useStartGateInputs())` instead; see the
 * module doc for the React Compiler caveat.
 */
export function canStartNow(): boolean {
  return canStartNowFrom(readStartGateInputs())
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
async function dispatchStart(
  plan: StartPlan,
  replace: boolean,
  identity?: string
): Promise<boolean> {
  const owns = () =>
    useCreationStore.getState().modePhase === 'idle' &&
    (!identity ||
      useCreationStore.getState().workspace?.project.identity === identity)
  const needsChoice = plan.manifest
    ? httpsCompatBlocked(
        plan.manifest.scoreServer.supportsPerformerUrl,
        useSettingsStore.getState().httpsEnabledSetting,
        plan.manifest.scoreServer.needsHttps
      )
    : httpsCompatChoiceNeeded()
  const proceed = needsChoice ? await openHttpsCompatChoice() : true
  if (!proceed || !owns()) return false
  const update = useCreationStore.getState().active
    ? await useCreationFilesStore.getState().capture(plan.path)
    : null
  if (!owns()) return false
  if (replace) {
    useSessionStore.getState().setPendingChanges(false)
    const stopped = await commands.stopProject()
    if (stopped.status === 'error') throw new Error(stopped.error)
    if (!owns()) return false
  }
  logger.info('Starting project', {
    path: plan.path,
    mode: plan.audioMode,
    lanIp: plan.lanIp,
  })
  const snapshotRevision = useSessionStore.getState().snapshotRevision
  const acknowledge = trackCreationRestart(update, plan.path)
  const submission = identity
    ? commands.startCreationProject(
        identity,
        plan.audioMode,
        plan.lanIp,
        plan.oscTarget
      )
    : commands.startProject(
        plan.path,
        plan.audioMode,
        plan.lanIp,
        plan.oscTarget
      )
  const result = await submission.catch(error => {
    acknowledge(false)
    throw error
  })
  if (!owns()) {
    acknowledge(false)
    return false
  }
  if (result.status === 'ok' && result.data && 'snapshot' in result.data) {
    if (useSessionStore.getState().snapshotRevision === snapshotRevision)
      useSessionStore.getState().applySnapshot(result.data.snapshot)
    useSessionStore.getState().bumpMonitorReload()
    acknowledge(true, result.data.generation)
  } else acknowledge(result.status === 'ok')
  if (result.status === 'error') {
    const error = result.error
    useSessionStore
      .getState()
      .failLocal(
        typeof error === 'string'
          ? error
          : `${i18n.t(`creation.error.${error.code}`)} ${error.detail}`
      )
  }
  return result.status === 'ok'
}

export async function start(): Promise<void> {
  if (startInFlight || useCreationStore.getState().modePhase !== 'idle') return
  const plan = resolveStartPlan('plain')
  if (!plan) return
  startInFlight = true
  useSessionStore.setState({ commandPending: true })
  try {
    await dispatchStart(plan, false)
  } finally {
    startInFlight = false
    useSessionStore.setState({ commandPending: false })
  }
}

async function stopThenStart(
  path: string,
  audioMode: AudioMode,
  lanIp: string,
  oscTarget: string | null
): Promise<void> {
  if (
    useCreationStore.getState().modePhase !== 'idle' ||
    useSessionStore.getState().commandPending
  )
    return
  startInFlight = true
  useSessionStore.setState({ commandPending: true })
  try {
    await dispatchStart(
      {
        path,
        audioMode,
        lanIp,
        oscTarget,
        manifest: useProjectStore.getState().currentProject?.manifest ?? null,
      },
      true
    )
  } finally {
    startInFlight = false
    useSessionStore.setState({ commandPending: false })
  }
}

/** Creation validates its issued workspace's saved files, then shares the
 * performance submit latch, consent, stop/start and readiness workflow. */
export async function startCreationTest(
  identity: string,
  config: { audioMode: AudioMode; oscTarget: string }
): Promise<Manifest | null> {
  const creation = useCreationStore.getState()
  const session = useSessionStore.getState()
  if (
    !creation.active ||
    creation.workspace?.project.identity !== identity ||
    creation.opening ||
    creation.modePhase !== 'idle' ||
    startInFlight ||
    session.commandPending ||
    ['starting', 'stopping'].includes(session.sessionStatus)
  )
    return null
  const root = creation.workspace.project.root
  if (
    session.sessionStatus === 'ready' &&
    !isCreationWorkspacePath(session.sessionProjectPath)
  )
    throw new Error(i18n.t('creation.switchStale'))
  const lanIp = session.lanIp
  if (!lanIp) throw new Error(i18n.t('creation.testLanMissing'))
  startInFlight = true
  useSessionStore.setState({ commandPending: true })
  const owns = () =>
    useCreationStore.getState().active &&
    useCreationStore.getState().workspace?.project.identity === identity &&
    useCreationStore.getState().modePhase === 'idle'
  try {
    const checked = await commands.preflightCreationProject(identity)
    if (!owns()) return null
    if (checked.status === 'error') throw checked.error
    const manifest = checked.data
    if (!manifest.audio.supportedModes.includes(config.audioMode))
      throw new Error(i18n.t('creation.testUnsupportedMode'))
    if (config.audioMode === 'external' && !isValidOscTarget(config.oscTarget))
      throw new Error(i18n.t('creation.testOscInvalid'))
    if (
      nodeGateBlocked({
        ...readStartGateInputs(),
        currentProject: { path: root, manifest },
      })
    )
      throw new Error(i18n.t('creation.testNodeMissing'))
    useProjectStore.setState({
      currentProject: { path: root, manifest },
      preflightStatus: 'ready',
      preflightError: null,
      activePreflight: null,
      pendingPreflightPath: null,
    })
    const started = await dispatchStart(
      {
        path: root,
        manifest,
        audioMode: config.audioMode,
        lanIp,
        oscTarget: config.audioMode === 'external' ? config.oscTarget : null,
      },
      session.sessionStatus === 'ready',
      identity
    )
    if (!owns()) return null
    if (!started && useSessionStore.getState().sessionStatus === 'error')
      throw new Error(
        useSessionStore.getState().sessionError ?? i18n.t('creation.testFailed')
      )
    return started ? manifest : null
  } finally {
    startInFlight = false
    useSessionStore.setState({ commandPending: false })
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

  logger.info('Session restart requested', {
    path: currentProject.path,
    mode: audioMode,
  })
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

  logger.info('Session switch requested', {
    path: plan.path,
    mode: plan.audioMode,
  })
  await stopThenStart(plan.path, plan.audioMode, plan.lanIp, plan.oscTarget)
}
