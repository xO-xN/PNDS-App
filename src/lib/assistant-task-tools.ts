import {
  commands,
  type AssistantMode,
  type AssistantProjectSnapshot,
  type CreationContent,
  type CreationErrorCode,
  type AssistantTask,
  type AssistantResourceRequest,
  type AssistantQuestionRequest,
  type AssistantQuestionScope,
  type AssistantWrite,
  type ControlledCheckReport,
  type DiagnosticReport,
  type ParameterRequest,
  type ParameterSpec,
} from './tauri-bindings'
import { pendingQuestion } from './assistant-questions'
import {
  explicitlyRequestedResources,
  pendingResourcePlan,
  realtimeResourcePriority,
} from './assistant-resources'
import i18n from '@/i18n/config'
import type { ProposedText } from './assistant-proposals'
import {
  CreationCheckFailure,
  CreationCheckRunner,
} from './creation-check-runner'
import {
  createAssistantToolRefusal,
  type AssistantToolFailureReason,
} from './assistant-tool-contracts'
import { isSessionLive, useSessionStore } from '@/store/session-store'
import { useCreationStore } from '@/store/creation-store'
import {
  isDraftDirty,
  useCreationFilesStore,
} from '@/store/creation-files-store'

export interface AssistantTaskRunner {
  task: AssistantTask
  needsCheck: boolean
  lastCheck?: string
  lastCheckId?: string
  controls?: ProposedText[]
  prepareResources?: (
    previousUserInputs: readonly string[]
  ) => Promise<string | undefined>
  prepareControls?: () => Promise<void>
  verifyLastCheck?: () => Promise<boolean>
  execute: (name: string, args: Record<string, unknown>) => Promise<string>
  close: () => Promise<void>
}
class AssistantToolExecutionError extends Error {
  constructor(
    readonly reason: AssistantToolFailureReason,
    readonly detail?: string,
    readonly origin: 'native' | 'app' = 'app'
  ) {
    super(detail ?? reason)
  }
}
function unwrap<T>(
  result:
    | { status: 'ok'; data: T }
    | { status: 'error'; error: { code: CreationErrorCode; detail?: string } }
): T {
  if (result.status === 'error')
    throw new AssistantToolExecutionError(
      result.error.code,
      result.error.detail,
      'native'
    )
  return result.data
}
function dirty(path: string) {
  const draft = useCreationFilesStore.getState().drafts[path]
  return draft && isDraftDirty(draft)
}

/** The full native report stays available to the App. The model needs actionable
 * diagnostics, not thousands of dependency paths and content fingerprints. */
function checkSummary(report: ControlledCheckReport, stale: boolean) {
  const checks = [...report.checks, ...(report.diagnostics?.checks ?? [])]
  const ordered = [
    ...checks.filter(check => check.status !== 'passed'),
    ...checks.filter(check => check.status === 'passed'),
  ]
  return {
    taskId: report.taskId,
    status: stale && report.status === 'passed' ? 'stale' : report.status,
    stale,
    error: report.error?.slice(0, 2048),
    checks: ordered.slice(0, 12).map(check => ({
      ...check,
      code: check.code.slice(0, 128),
      reason: check.reason.slice(0, 512),
    })),
    issues: report.diagnostics?.issues.slice(0, 8).map(issue => ({
      ...issue,
      path: issue.path?.slice(0, 256),
      field: issue.field?.slice(0, 128),
      reason: issue.reason.slice(0, 512),
    })),
    omittedChecks: Math.max(0, checks.length - 12),
    omittedIssues: Math.max(0, (report.diagnostics?.issues.length ?? 0) - 8),
    savedInput: report.evidence
      ? {
          projectSha256: report.evidence.projectSha256,
          sharedSha256: report.evidence.sharedSha256,
        }
      : null,
    outputTail: report.outputTail.slice(-8).map(line => line.slice(0, 512)),
    cleanup: {
      ...report.cleanup,
      errors: report.cleanup.errors
        .slice(0, 4)
        .map(error => error.slice(0, 512)),
    },
    unverified: report.unverified.slice(0, 16).map(item => item.slice(0, 128)),
    note:
      (stale
        ? 'Saved input changed or could not be verified. Do not claim the current files passed.'
        : 'This is a diagnostic summary; the full report remains in the App. Repair actionable failures, or conclude concisely when the original user task is implemented and verified. Do not repeat checks or planning for unchanged input.') +
      ' A passing smoke check does not establish fidelity to the original artwork. Missing original source remains a blocker; a runnable replacement demo does not complete a repair request.',
  }
}
function staticSummary(report: DiagnosticReport) {
  return {
    staticPassed: report.staticPassed,
    inputFingerprint: report.inputFingerprint,
    checks: report.checks
      .slice(0, 12)
      .map(check => ({ ...check, reason: check.reason.slice(0, 512) })),
    issues: report.issues
      .slice(0, 8)
      .map(issue => ({ ...issue, reason: issue.reason.slice(0, 512) })),
    omittedIssues: Math.max(0, report.issues.length - 8),
    unverified: report.unverified,
  }
}
/** The native task owns write permission and recovery. This adapter only routes
 * model data and checks the editor's unsaved buffers before issuing commands. */
export async function beginAssistantTask(
  identity: string,
  mode: AssistantMode,
  resume: string | undefined,
  signal: AbortSignal,
  onTask?: (task: AssistantTask) => void,
  originalInput = '',
  questionScope?: AssistantQuestionScope
): Promise<AssistantTaskRunner> {
  const task = unwrap(
    await commands.beginCreationAssistantTask(
      identity,
      mode,
      resume ?? null,
      questionScope ?? null
    )
  )
  let closed = false
  let closing: Promise<void> | null = null
  const checks = new CreationCheckRunner(
    identity,
    () =>
      !closed &&
      !signal.aborted &&
      useCreationStore.getState().workspace?.project.identity === identity
  )
  const cancel = () => {
    void close().catch(() => undefined)
  }
  function close(): Promise<void> {
    if (!closing) {
      closed = true
      signal.removeEventListener('abort', cancel)
      closing = (async () => {
        try {
          await checks.dispose()
        } finally {
          await commands.endCreationAssistantTask(identity, task.id)
        }
      })()
    }
    return closing
  }
  onTask?.(task)
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) {
    await close()
    throw new Error('cancelled')
  }
  async function proposeResources(request: AssistantResourceRequest) {
    const updated = unwrap(
      await commands.proposeCreationAssistantResources(
        identity,
        task.id,
        request
      )
    )
    const pending = pendingResourcePlan(updated)
    if (pending && explicitlyRequestedResources(originalInput, pending)) {
      const approved = unwrap(
        await commands.decideCreationAssistantResources(
          identity,
          task.id,
          pending.id,
          'approved'
        )
      )
      updated.resourcePlans = updated.resourcePlans?.map(plan =>
        plan.id === approved.id ? approved : plan
      )
    }
    runner.task = updated
    onTask?.(updated)
    return JSON.stringify({
      status: pendingResourcePlan(updated)
        ? 'awaitingCreatorConfirmation'
        : 'resourcesReady',
      task: updated,
      note: 'No resources were added by proposing. After approval use use_local_module/use_local_library, then complete wiring and checks for the original task. If an alternative was selected, follow that exact option; do not invent a substitute design.',
    })
  }
  async function exposeParameters(
    args: Record<string, unknown>,
    prepared?: {
      inventory: AssistantProjectSnapshot
      source: Extract<CreationContent, { kind: 'text' }>
    }
  ) {
    if (closed || signal.aborted) throw new Error('cancelled')
    if (
      mode !== 'edit' ||
      typeof args.path !== 'string' ||
      typeof args.version !== 'string' ||
      !Array.isArray(args.parameters) ||
      !args.parameters.length ||
      args.parameters.length > 16 ||
      Object.keys(args).some(
        key => !['path', 'version', 'parameters'].includes(key)
      )
    )
      throw new AssistantToolExecutionError('invalidToolArguments')
    const requested = args.parameters as ParameterRequest[]
    const sourcePaths = [
      ...new Set(
        requested
          .map(parameter => parameter?.spec?.path)
          .filter(path => typeof path === 'string')
      ),
    ]
    if (sourcePaths.length !== 1 || sourcePaths[0] !== args.path)
      return JSON.stringify({
        ...createAssistantToolRefusal(
          'expose_project_parameters',
          'parameterSourcePathMismatch',
          {
            origin: 'app',
            note: 'path and version must name the SAVED CODE file and its version. Every parameters[].spec.path must equal that path. pnds.preview.json holds declarations, not these source literals. Read the listed code source, then retry once with its actual version; do not search help for this argument mismatch.',
          }
        ),
        sourcePaths,
      })
    const inventory =
      prepared?.inventory ??
      unwrap(await commands.assistantProjectInventory(identity))
    if (
      !inventory.files.some(
        file =>
          !file.reason &&
          file.path === args.path &&
          file.version === args.version
      )
    )
      throw new AssistantToolExecutionError('versionConflict')
    if (dirty(args.path))
      throw new AssistantToolExecutionError(
        'creatorDraft',
        'Creator draft must be preserved'
      )
    const source =
      prepared?.source ??
      unwrap(await commands.readCreationFile(identity, args.path))
    if (source.kind !== 'text' || source.version !== args.version)
      throw new AssistantToolExecutionError('versionConflict')
    const prior = runner.controls?.find(
      control =>
        control.path === args.path && control.version === source.version
    )
    const merged = new Map(
      (prior?.parameters ?? []).map(request => [request.spec.id, request])
    )
    for (const request of requested) merged.set(request.spec.id, request)
    const parameters = [...merged.values()]
    if (parameters.length > 16)
      throw new AssistantToolExecutionError(
        'invalidToolArguments',
        'A saved file supports at most 16 controls; publish one coordinated set within that limit.'
      )
    const binding = unwrap(
      await commands.bindCreationParameters(
        identity,
        args.path,
        source.version,
        source.text,
        parameters
      )
    )
    if (closed || signal.aborted) throw new Error('cancelled')
    if (
      !binding.parameters.length ||
      binding.parameters.some(parameter => parameter.value === null)
    )
      throw new AssistantToolExecutionError('parameterBindingUnavailable')
    const offer: ProposedText = {
      id: crypto.randomUUID(),
      path: args.path,
      version: source.version,
      sourceText: source.text,
      text: source.text,
      parameters,
      binding,
      taskId: task.id,
      taskScope: questionScope,
    }
    runner.controls = [
      ...(runner.controls ?? []).filter(item => item.path !== args.path),
      offer,
    ]
    return JSON.stringify({
      status: 'controlsReady',
      parameters: binding.parameters.map(p => ({
        id: p.request.spec.id,
        value: p.value,
        preview: p.request.spec.preview,
      })),
      note: 'The creator will receive actual controls in this reply. Already saved; do not propose or write this file again just to display controls.',
    })
  }
  const runner: AssistantTaskRunner = {
    task,
    controls: [],
    verifyLastCheck: async () => {
      const owned = () =>
        !closed &&
        !signal.aborted &&
        !Object.keys(useCreationFilesStore.getState().drafts).some(dirty) &&
        useCreationStore.getState().workspace?.project.identity === identity
      if (!owned()) return false
      if (mode !== 'edit') return true
      const receipt = runner.lastCheck
      const receiptId = runner.lastCheckId
      if (!receipt) return false
      try {
        const previous = JSON.parse(receipt)
        if (
          !previous ||
          typeof previous !== 'object' ||
          Array.isArray(previous) ||
          previous.stale ||
          !['passed', 'failed', 'cancelled', 'notExecuted', 'blocked'].includes(
            previous.status
          )
        )
          return false
        const stillCurrent = () =>
          owned() &&
          runner.lastCheck === receipt &&
          runner.lastCheckId === receiptId
        if (previous.runtime?.status === 'blocked') {
          // A lease occupied before App restart may no longer exist. Static
          // freshness and an idle runtime key cannot prove current occupancy.
          if (previous.runtime.reason === 'runtimeBusy') return false
          if (useSessionStore.getState().sessionStatus === 'ready') return false
          const runtimeKey = () => {
            const session = useSessionStore.getState()
            return `${session.runId}:${session.sessionStatus}`
          }
          if (
            previous.status !== 'blocked' ||
            previous.runtime.key !== runtimeKey() ||
            typeof previous.static?.inputFingerprint !== 'string' ||
            !previous.static.inputFingerprint
          )
            return false
          // This deliberately reruns native static diagnostics across a
          // restart. A bounded text inventory cannot prove all inputs fresh.
          const freshness = await commands.creationDiagnosticIsStale(
            identity,
            previous.static.inputFingerprint
          )
          return (
            freshness.status === 'ok' &&
            !freshness.data &&
            stillCurrent() &&
            previous.runtime.key === runtimeKey()
          )
        }
        if (!receiptId) return false
        const freshness = await checks.freshness(receiptId)
        return freshness.status === 'fresh' && stillCurrent()
      } catch {
        return false
      }
    },
    prepareControls: async () => {
      if (mode !== 'edit') return
      const contract = await commands.readCreationFile(
        identity,
        'pnds.preview.json'
      )
      if (contract.status !== 'ok' || contract.data.kind !== 'text') return
      const contractVersion = contract.data.version
      let declaration: { schemaVersion?: number; parameters?: ParameterSpec[] }
      try {
        declaration = JSON.parse(contract.data.text)
      } catch {
        return
      }
      if (
        declaration?.schemaVersion !== 1 ||
        !Array.isArray(declaration.parameters) ||
        declaration.parameters.length > 32
      )
        return
      if (
        declaration.parameters.some(
          p => !p || typeof p !== 'object' || typeof p.path !== 'string'
        )
      )
        return
      const paths = [
        ...new Set(declaration.parameters.map(p => p.path)),
      ].filter(path =>
        runner.task.files.some(
          file => file.path === path && !file.undone && !file.removed
        )
      )
      if (!paths.length) return
      // One fresh allowed-scope snapshot covers this read-only publication
      // group. Native binding still verifies each source/contract version.
      const inventory = unwrap(
        await commands.assistantProjectInventory(identity)
      )
      for (const path of paths) {
        if (closed || signal.aborted) throw new Error('cancelled')
        const file = inventory.files.find(
          file => file.path === path && !file.reason
        )
        if (!file) continue
        if (
          runner.controls?.some(
            control =>
              control.path === path &&
              control.version === file.version &&
              control.binding?.contractVersion === contractVersion &&
              declaration.parameters
                ?.filter(spec => spec.path === path)
                .slice(0, 16)
                .every(spec =>
                  control.parameters.some(
                    request => request.spec.id === spec.id
                  )
                )
          )
        )
          continue
        const source = await commands.readCreationFile(identity, path)
        if (source.status !== 'ok' || source.data.kind !== 'text') continue
        const { text, version } = source.data
        const lines = text.split(/\r?\n/)
        const parameters: ParameterRequest[] = []
        for (const spec of declaration.parameters
          .filter(p => p.path === path)
          .slice(0, 16)) {
          if (
            typeof spec.prefix !== 'string' ||
            typeof spec.suffix !== 'string' ||
            !spec.prefix ||
            !spec.suffix
          )
            continue
          const matches = lines.filter(
            line => line.startsWith(spec.prefix) && line.endsWith(spec.suffix)
          )
          const line = matches[0]
          if (matches.length !== 1 || line === undefined) continue
          try {
            const value: unknown = JSON.parse(
              line.slice(spec.prefix.length, -spec.suffix.length)
            )
            if (
              typeof value !== 'number' &&
              typeof value !== 'boolean' &&
              typeof value !== 'string'
            )
              continue
            parameters.push({
              spec,
              current: value,
              suggestedMin: spec.limits?.min ?? null,
              suggestedMax: spec.limits?.max ?? null,
            })
          } catch {
            /* Expressions are deliberately not evaluated. */
          }
        }
        if (parameters.length) {
          try {
            await exposeParameters(
              { path, version, parameters },
              {
                inventory,
                source: source.data,
              }
            )
          } catch {
            if (closed || signal.aborted) throw new Error('cancelled')
            // A concurrently changed or unbindable source is not published.
          }
        }
      }
    },
    needsCheck: false,
    prepareResources: async previousUserInputs => {
      const priority = realtimeResourcePriority(
        originalInput,
        previousUserInputs
      )
      if (
        !priority ||
        pendingResourcePlan(runner.task) ||
        pendingQuestion(runner.task)
      )
        return undefined
      const [moduleResult, libraryResult] = await Promise.all([
        commands.getCreationModules(identity),
        commands.getCreationLibraries(identity),
      ])
      if (closed || signal.aborted) throw new Error('cancelled')
      const modules = unwrap(moduleResult)
      const libraries = unwrap(libraryResult)
      const players = modules.modules.find(item => item.id === 'players')
      const socket = libraries.libraries.find(item => item.id === 'socket.io')
      const previousChoice = runner.task.resourcePlans?.find(
        plan =>
          plan.decision === 'alternative' &&
          plan.resources.some(
            item => item.id === 'players' || item.id === 'socket.io'
          )
      )
      const review = {
        priority: 'multiperformerRealtime',
        preferred: ['socket.io', 'players'],
        players: players
          ? { state: players.state, version: players.version }
          : null,
        socketIo: socket
          ? {
              version: socket.version,
              referencedVersion: socket.referencedVersion,
            }
          : null,
        keepExisting: priority.keepExisting || !!previousChoice,
        docs: [
          'modules-players',
          'reference-runtime-contract',
          'reference-network',
        ],
        note: 'For multi-performer identity, continuous touch and bidirectional score synchronization, prefer local Socket.IO plus the players connection/identity module. A working single-client HTTP poll is not enough evidence to dismiss multiplayer concurrency, reconnection and future interaction needs. Preserve original p5 score generation, drawing and sound mappings. Track state per client/identity; define shared versus exclusive numbers explicitly. Do not replay stale touch coordinates after reconnect; resynchronize current state. Only add resources through the creator decision. Never create another polling protocol merely to avoid this recommendation. A selected keep-existing option or explicit creator restriction must be respected. Handoff only discusses/documents; edit installs, wires and checks after approval.',
      }
      if (mode === 'discussion' || priority.keepExisting || previousChoice)
        return JSON.stringify(review)
      if (!players || !socket)
        throw new AssistantToolExecutionError(
          'testValidation',
          'Required multiplayer resources are absent from the shipped local catalog; do not invent an online or custom transport fallback.'
        )
      const moduleIds = players.state === 'available' ? ['players'] : []
      const libraryIds =
        socket.referencedVersion === socket.version ? [] : ['socket.io']
      if (moduleIds.length || libraryIds.length) {
        await proposeResources({
          modules: moduleIds,
          libraries: libraryIds,
          reason: i18n.t('assistant.resources.realtimeReason'),
          alternative: i18n.t('assistant.resources.realtimeAlternative'),
        })
      }
      return JSON.stringify(review)
    },
    close,
    execute: async (name, args) => {
      if (closed || signal.aborted) throw new Error('cancelled')
      try {
        if (pendingQuestion(runner.task))
          return JSON.stringify({
            status: 'awaitingCreatorAnswer',
            note: 'Wait for the current question. No further operations are authorized by an unsubmitted recommendation.',
          })
        if (name === 'ask_question') {
          if (!questionScope)
            throw new AssistantToolExecutionError('invalidToolArguments')
          runner.task = unwrap(
            await commands.askCreationAssistantQuestion(
              identity,
              task.id,
              questionScope,
              args as unknown as AssistantQuestionRequest
            )
          )
          onTask?.(runner.task)
          return JSON.stringify({
            status: 'awaitingCreatorAnswer',
            question: pendingQuestion(runner.task),
          })
        }
        if (name === 'get_local_resources') {
          const modules = unwrap(await commands.getCreationModules(identity))
          const libraries = unwrap(
            await commands.getCreationLibraries(identity)
          )
          return JSON.stringify({
            modules: modules.modules,
            libraries: libraries.libraries,
            guidance:
              'Modules are frozen local source, not completed features. Read installed docs and module README. players provides client link + token/identity restoration over Socket.IO; work-specific numeric choice, shared/exclusive identities and recovery policy must be preserved/implemented explicitly. socket.io supplies its browser client; do not add socket.io-client separately unless needed. Group suitable NEW modules plus dependencies with propose_local_resources before implementing; do not rewrite the work design merely to use a module. Handoff records recommendations only.',
            docs: {
              players: 'modules-players',
              qr: 'modules-qr',
              'monitor-state': 'modules-monitor-state',
              hub: 'modules-hub',
              'theme-follow': 'modules-theme-follow',
              'locale-follow': 'modules-locale-follow',
            },
          })
        }
        if (pendingResourcePlan(runner.task))
          return JSON.stringify({
            status: 'awaitingCreatorConfirmation',
            note: 'Wait for the resource card decision. No more mutations or checks in this tool group.',
          })
        if (name === 'propose_local_resources')
          return await proposeResources({
            modules: args.modules as string[],
            libraries: args.libraries as string[],
            reason: args.reason as string,
            alternative:
              typeof args.alternative === 'string' ? args.alternative : null,
          })
        if (name === 'use_local_library' || name === 'use_local_module') {
          if (
            mode !== 'edit' ||
            typeof args.id !== 'string' ||
            Object.keys(args).join(',') !== 'id'
          )
            throw new AssistantToolExecutionError('invalidToolArguments')
          const result = await proposeResources({
            modules: name === 'use_local_module' ? [args.id] : [],
            libraries: name === 'use_local_library' ? [args.id] : [],
            reason: i18n.t('assistant.resources.fallbackReason'),
            alternative: null,
          })
          if (pendingResourcePlan(runner.task)) return result
        }
        if (name === 'expose_project_parameters')
          return await exposeParameters(args)
        if (
          name === 'run_project_check' ||
          name === 'run_project_static_check'
        ) {
          if (mode !== 'edit' || Object.keys(args).length)
            throw new AssistantToolExecutionError('invalidToolArguments')
          // Checks use saved files. Unsaved drafts must not be mistaken for tested input.
          if (Object.keys(useCreationFilesStore.getState().drafts).some(dirty))
            throw new AssistantToolExecutionError(
              'creatorDraft',
              'Unsaved editor changes exist. Ask the creator to save or discard them before checking.'
            )
          const previous = runner.lastCheck
            ? JSON.parse(runner.lastCheck)
            : null
          if (
            name === 'run_project_check' &&
            !isSessionLive(useSessionStore.getState().sessionStatus) &&
            runner.lastCheck &&
            runner.lastCheckId &&
            !JSON.parse(runner.lastCheck).stale
          ) {
            const receipt = runner.lastCheck
            const receiptId = runner.lastCheckId
            const freshness = await checks.freshness(receiptId)
            if (
              freshness.status === 'fresh' &&
              runner.lastCheck === receipt &&
              runner.lastCheckId === receiptId &&
              !isSessionLive(useSessionStore.getState().sessionStatus)
            ) {
              if (closed || signal.aborted) throw new Error('cancelled')
              runner.needsCheck = false
              return JSON.stringify({
                ...JSON.parse(receipt),
                reused: true,
                note: 'Reused the actual check for identical saved input. No new check was started. A passing smoke check does not establish fidelity to the original artwork. Missing original source remains a blocker; a runnable replacement demo does not complete a repair request. Do not request it again; implement only remaining steps of the original user task, or return the final result/blocker.',
              })
            }
            runner.lastCheck = undefined
            runner.lastCheckId = undefined
          }
          const diagnostic = staticSummary(
            unwrap(await commands.diagnoseCreationProject(identity))
          )
          if (closed || signal.aborted) throw new Error('cancelled')
          if (name === 'run_project_static_check')
            return JSON.stringify({
              status: diagnostic.staticPassed ? 'passed' : 'failed',
              static: diagnostic,
              note: 'Static contracts only; no runtime or visual success is implied.',
            })
          const session = useSessionStore.getState()
          const runtimeKey = `${session.runId}:${session.sessionStatus}`
          const blocked = (reason: string) => {
            runner.needsCheck = false
            runner.lastCheck = JSON.stringify({
              status: 'blocked',
              static: diagnostic,
              runtime: { status: 'blocked', reason, key: runtimeKey },
              note: 'Saved changes are retained. Static diagnostics ran; runtime validation did not run. Do not retry while the runtime state is unchanged. Report the blocker once and finish.',
            })
            runner.lastCheckId = undefined
            return runner.lastCheck
          }
          if (session.sessionStatus === 'ready') {
            const observation = unwrap(
              await commands.inspectCreationRuntime(identity, true)
            )
            if (
              closed ||
              signal.aborted ||
              useCreationStore.getState().workspace?.project.identity !==
                identity
            )
              throw new Error('cancelled')
            if (
              useSessionStore.getState().runId !== session.runId ||
              useSessionStore.getState().sessionStatus !== 'ready'
            )
              return blocked('runtimeChanged')
            runner.needsCheck = false
            runner.lastCheckId = undefined
            runner.lastCheck = JSON.stringify({
              status:
                diagnostic.staticPassed && observation.passed
                  ? 'passed'
                  : 'failed',
              static: diagnostic,
              runtime: {
                kind: 'liveObservation',
                status: 'observed',
                key: runtimeKey,
                savedChangesVerified: false,
                checks: observation.checks,
              },
              note: 'Saved-file static diagnostics and read-only observations of the EXISTING runtime only. No new process, browser or player was started. This does NOT verify that saved server/code changes are loaded, browser execution, sound or artistic fidelity. Report this scope concisely; if server wiring changed, say a user restart is needed to load it. Do not stop/restart the live project, request another runtime check, or treat it as a repair failure solely because a saved-copy run was not performed. Finish the original task when implementation and static diagnostics are complete.',
            })
            return runner.lastCheck
          }
          if (isSessionLive(session.sessionStatus))
            return blocked('activeSession')
          if (
            previous?.runtime?.status === 'blocked' &&
            previous.runtime.key === runtimeKey
          )
            return blocked(previous.runtime.reason)
          if (!diagnostic.staticPassed) {
            runner.needsCheck = false
            return JSON.stringify({
              status: 'failed',
              static: diagnostic,
              runtime: { status: 'notExecuted' },
            })
          }
          let snapshot
          try {
            snapshot = await checks.run({ kind: 'assistant', taskId: task.id })
          } catch (cause) {
            if (
              cause instanceof CreationCheckFailure &&
              cause.error.code === 'runtimeBusy'
            )
              return blocked('runtimeBusy')
            throw cause
          }
          if (!snapshot?.report || closed || signal.aborted)
            throw new Error('cancelled')
          const freshness = snapshot.report.evidence
            ? await checks.freshness(snapshot.taskId)
            : { status: 'unknown' as const }
          if ('error' in freshness && freshness.error)
            throw new CreationCheckFailure(freshness.error)
          if (closed || signal.aborted) throw new Error('cancelled')
          runner.lastCheck = JSON.stringify(
            checkSummary(snapshot.report, freshness.status !== 'fresh')
          )
          runner.lastCheckId = snapshot.taskId
          runner.needsCheck = false
          return runner.lastCheck
        }
        let updated: AssistantTask
        if (name === 'install_preview_adapter') {
          if (mode !== 'edit' || Object.keys(args).length)
            throw new AssistantToolExecutionError('invalidToolArguments')
          if (dirty('public/pnds-preview.mjs'))
            throw new AssistantToolExecutionError(
              'creatorDraft',
              'Creator draft must be preserved'
            )
          updated = unwrap(
            await commands.installCreationAssistantPreview(identity, task.id)
          )
        } else if (name === 'create_project_directory') {
          if (
            mode !== 'edit' ||
            typeof args.path !== 'string' ||
            Object.keys(args).join(',') !== 'path'
          )
            throw new AssistantToolExecutionError('invalidToolArguments')
          const parts = args.path.split('/')
          if (
            parts.some((_, index) => dirty(parts.slice(0, index + 1).join('/')))
          )
            throw new AssistantToolExecutionError('creatorDraft')
          updated = unwrap(
            await commands.createCreationAssistantDirectory(
              identity,
              task.id,
              args.path
            )
          )
        } else if (name === 'adopt_creation_material') {
          if (
            mode !== 'edit' ||
            typeof args.id !== 'string' ||
            typeof args.version !== 'string' ||
            typeof args.path !== 'string' ||
            !(args.text == null || typeof args.text === 'string') ||
            Object.keys(args).some(
              key => !['id', 'version', 'path', 'text'].includes(key)
            )
          )
            throw new AssistantToolExecutionError('invalidToolArguments')
          const conflict = [...(runner.task.questions ?? [])]
            .reverse()
            .find(
              question => question.materialConflict?.path === args.path
            )?.materialConflict
          const paths = [args.path, ...(conflict ? [conflict.coexistPath] : [])]
          if (
            paths.some(path =>
              path
                .split('/')
                .some((_, index, segments) =>
                  dirty(segments.slice(0, index + 1).join('/'))
                )
            )
          )
            throw new AssistantToolExecutionError('creatorDraft')
          updated = unwrap(
            await commands.adoptCreationAssistantMaterial(identity, task.id, {
              id: args.id,
              version: args.version,
              path: args.path,
              text: typeof args.text === 'string' ? args.text : null,
            })
          )
          if (
            closed ||
            signal.aborted ||
            useCreationStore.getState().workspace?.project.identity !== identity
          )
            throw new Error('cancelled')
          if (pendingQuestion(updated)) {
            runner.task = updated
            onTask?.(updated)
            return JSON.stringify({
              status: 'awaitingCreatorAnswer',
              question: pendingQuestion(updated),
              task: updated,
              note: 'No material was saved. Wait for the linked conflict answer, then retry this same adoption with the exact source, target and candidate. Only the native consumer can apply explicit replace/coexist; free text grants no overwrite.',
            })
          }
          const guidance = [...(updated.questions ?? [])]
            .reverse()
            .find(question => question.materialConflict?.path === args.path)
          if (
            guidance?.status === 'answered' &&
            guidance.answer?.text &&
            !updated.materialAdoptions?.some(
              receipt => receipt.questionId === guidance.id
            )
          ) {
            runner.task = updated
            onTask?.(updated)
            return JSON.stringify({
              status: 'creatorGuidance',
              question: guidance,
              note: 'The creator supplied guidance for the SAME original goal. Nothing was adopted and the original target remains reserved. Clarify the artistic intent, then call this same exact adoption again to request a fresh linked replace/coexist question, or use a clearly new safe path. A new question itself grants nothing; free text and generic questions never authorize replacement.',
            })
          }
        } else if (name === 'remove_project_file') {
          if (
            mode !== 'edit' ||
            typeof args.path !== 'string' ||
            typeof args.version !== 'string' ||
            Object.keys(args).some(key => !['path', 'version'].includes(key))
          )
            throw new AssistantToolExecutionError('invalidToolArguments')
          if (dirty(args.path))
            throw new AssistantToolExecutionError(
              'creatorDraft',
              'Creator draft must be preserved'
            )
          updated = unwrap(
            await commands.removeCreationAssistantFile(
              identity,
              task.id,
              args.path,
              args.version
            )
          )
        } else if (name === 'use_local_module') {
          if (
            mode !== 'edit' ||
            typeof args.id !== 'string' ||
            Object.keys(args).join(',') !== 'id'
          )
            throw new AssistantToolExecutionError('invalidToolArguments')
          const catalog = unwrap(await commands.getCreationModules(identity))
          const selected = catalog.modules.find(item => item.id === args.id)
          if (selected?.files.some(path => dirty(path)))
            throw new AssistantToolExecutionError('creatorDraft')
          updated = unwrap(
            await commands.adoptCreationAssistantModule(
              identity,
              task.id,
              args.id
            )
          )
        } else if (name === 'use_local_library') {
          if (
            mode !== 'edit' ||
            typeof args.id !== 'string' ||
            Object.keys(args).join(',') !== 'id'
          )
            throw new AssistantToolExecutionError('invalidToolArguments')
          if (dirty('manifest.json'))
            throw new AssistantToolExecutionError(
              'creatorDraft',
              'manifest.json has unsaved creator edits; preserve them and ask the creator to save first.'
            )
          updated = unwrap(
            await commands.adoptCreationAssistantLibrary(
              identity,
              task.id,
              args.id
            )
          )
        } else {
          if (
            ![
              'write_project_file',
              'create_project_file',
              'write_handoff',
            ].includes(name) ||
            mode !== 'edit' ||
            !['write_project_file', 'create_project_file'].includes(name) ||
            typeof args.path !== 'string' ||
            (name === 'create_project_file'
              ? typeof args.text !== 'string' ||
                Object.keys(args).some(key => !['path', 'text'].includes(key))
              : !(args.version === null || typeof args.version === 'string')) ||
            Object.keys(args).some(
              key => !['path', 'version', 'text', 'edits'].includes(key)
            )
          )
            throw new AssistantToolExecutionError('invalidToolArguments')
          if (dirty(args.path))
            throw new AssistantToolExecutionError(
              'creatorDraft',
              `${args.path} has unsaved creator edits; preserve them and ask the creator to save first.`
            )
          updated = unwrap(
            await commands.writeCreationAssistantFile(identity, task.id, {
              path: args.path,
              version: name === 'create_project_file' ? null : args.version,
              text: args.text ?? null,
              edits: args.edits ?? null,
            } as AssistantWrite)
          )
        }
        if (
          closed ||
          signal.aborted ||
          useCreationStore.getState().workspace?.project.identity !== identity
        )
          throw new Error('cancelled')
        runner.task = updated
        runner.needsCheck = mode === 'edit'
        // Saved input invalidates a completed check, but not occupied-runtime
        // evidence. Keep the blocker in the continuation; diagnostics rerun.
        if (
          !runner.lastCheck ||
          JSON.parse(runner.lastCheck).runtime?.status !== 'blocked'
        )
          runner.lastCheck = undefined
        runner.lastCheckId = undefined
        const synchronized = await useCreationFilesStore
          .getState()
          .synchronizeSaved(identity)
        if (
          closed ||
          signal.aborted ||
          useCreationStore.getState().workspace?.project.identity !== identity
        )
          throw new Error('cancelled')
        onTask?.(updated)
        const inventory = unwrap(
          await commands.assistantProjectInventory(identity)
        )
        const libraries =
          name === 'use_local_library'
            ? unwrap(await commands.getCreationLibraries(identity))
            : undefined
        return JSON.stringify({
          status: 'saved',
          workspaceSync: synchronized ? 'synchronized' : 'pending',
          ...(!synchronized
            ? {
                synchronizationNote:
                  'The native save succeeded and remains in the task journal. Workspace synchronization is pending; do not repeat a completed write to repair file-list synchronization.',
              }
            : {}),
          task: updated,
          ...(name === 'adopt_creation_material'
            ? {
                adopted: [...(updated.materialAdoptions ?? [])]
                  .reverse()
                  .find(
                    receipt =>
                      receipt.materialId === args.id &&
                      receipt.targetPath === args.path
                  ),
              }
            : {}),
          inventory,
          libraries,
          note:
            name === 'install_preview_adapter'
              ? 'Installed public/pnds-preview.mjs. Import { installPreviewAdapter } from its local route. Call with {hostOrigin, sources:{[savedPath]:sourceDigest}, contractDigest, parameters:{[id]:{kind,limits,get:()=>actualValue,set:value=>{actualValue=value; redrawIfPaused();}}}}. Host origin is the pndsHostOrigin monitor query parameter. Capture digests alongside the exact source/contract bytes served by the Node request; do not hash later disk bytes and claim they were loaded. Wire pnds.preview.json with exact path/prefix/suffix/kind/limits/preview:live. Serve the adapter, contract and a per-page bootstrap with correct MIME/no-store, using only local routes. Never use eval, Function or remote scripts. Keep unrelated parameter declarations and custom files.'
              : libraries
                ? 'Only fixed local packages are available. Parse PNDS_SHARED_LIBRARIES in the score server at runtime: browser-kind p5 uses shared.p5.path for its verified local file, not browserPath (that optional field is an additional browser distribution). Serve those bytes through a local route and wire the script/import yourself. Node packages are NOT installed into project node_modules. Parse PNDS_SHARED_LIBRARIES before loading them. For an ESM server use import { createRequire } from "node:module"; const require = createRequire(import.meta.url); const { Server } = require(shared["socket.io"].path). CommonJS uses require(shared[id].path); import-only packages use import(pathToFileURL(shared[id].path).href). A bare require/import of socket.io does not resolve an App shared package. Consult installed documentation for other package contracts. No CDN or online installation.'
                : undefined,
        })
      } catch (error) {
        if (closed || signal.aborted) throw error
        const failure =
          error instanceof CreationCheckFailure
            ? new AssistantToolExecutionError(
                error.error.code,
                error.error.detail,
                'native'
              )
            : error
        const typed = failure instanceof AssistantToolExecutionError
        if (
          name === 'create_project_directory' &&
          typed &&
          failure.origin === 'native'
        ) {
          // A nested preparation can fail after publishing a parent. Report
          // native journal facts rather than interpreting failure as no change.
          try {
            const current = unwrap(
              await commands.listCreationAssistantTasks(identity)
            ).find(entry => entry.id === task.id)
            if (
              closed ||
              signal.aborted ||
              useCreationStore.getState().workspace?.project.identity !==
                identity
            )
              throw new Error('cancelled')
            const synchronized = await useCreationFilesStore
              .getState()
              .synchronizeSaved(identity)
            if (
              closed ||
              signal.aborted ||
              useCreationStore.getState().workspace?.project.identity !==
                identity
            )
              throw new Error('cancelled')
            if (current) {
              const changed = current.files.some(
                file =>
                  !runner.task.files.some(
                    previous => previous.path === file.path
                  )
              )
              runner.task = current
              if (changed) {
                runner.needsCheck = true
                runner.lastCheck = undefined
                runner.lastCheckId = undefined
              }
              onTask?.(current)
            }
            return JSON.stringify({
              ...createAssistantToolRefusal(name, failure.reason, {
                origin: 'native',
                detail: failure.detail,
              }),
              task: current ?? runner.task,
              workspaceSync: synchronized ? 'synchronized' : 'pending',
              recoveryNote:
                'The requested directory operation failed. Only the directories listed in this native task receipt were actually created and remain recoverable. Do not claim an unlisted directory succeeded or repeat completed parents. Continue only the original task.',
            })
          } catch {
            if (
              closed ||
              signal.aborted ||
              useCreationStore.getState().workspace?.project.identity !==
                identity
            )
              throw new Error('cancelled')
            // Preserve the original refusal if its recovery receipt cannot be
            // verified. The normal native continuation will recheck ownership.
          }
        }
        return JSON.stringify(
          createAssistantToolRefusal(
            name,
            typed ? failure.reason : 'toolExecutionFailed',
            {
              origin: typed ? failure.origin : 'app',
              detail: typed
                ? failure.detail
                : failure instanceof Error
                  ? failure.message
                  : String(failure),
              error: typed
                ? failure.reason
                : failure instanceof Error
                  ? failure.message
                  : String(failure),
              ...(typed &&
              failure.reason === 'targetExists' &&
              name === 'adopt_creation_material'
                ? {
                    note: 'This material collides with different saved content. The target is protected in this task. Preserve both originals and continue only through the linked material conflict question or a safe new path; do not bypass it with generic writes, removal, fabricated versions or unapproved replacement.',
                  }
                : {}),
            }
          )
        )
      }
    },
  }
  return runner
}
