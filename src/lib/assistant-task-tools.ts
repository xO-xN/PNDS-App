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
  AssistantToolExecutionError,
} from './assistant-tool-contracts'
import {
  AssistantTaskChecks,
  type AssistantTaskCheckPolicy,
} from './assistant-task-checks'
import {
  assistantCompileSummary,
  assistantTaskBuild,
} from './assistant-task-build'
import { useCreationStore } from '@/store/creation-store'
import {
  isDraftDirty,
  useCreationFilesStore,
} from '@/store/creation-files-store'

export interface AssistantTaskRunner {
  task: AssistantTask
  checks: AssistantTaskCheckPolicy
  controls?: ProposedText[]
  prepareResources?: (
    previousUserInputs: readonly string[]
  ) => Promise<string | undefined>
  prepareControls?: () => Promise<void>
  execute: (name: string, args: Record<string, unknown>) => Promise<string>
  close: () => Promise<void>
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
          await commands.cancelAssistantOperation(identity, task.id)
        } finally {
          try {
            await checks.dispose()
          } finally {
            await commands.endCreationAssistantTask(identity, task.id)
          }
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
  const assertCurrent = () => {
    if (
      closed ||
      signal.aborted ||
      useCreationStore.getState().workspace?.project.identity !== identity
    )
      throw new Error('cancelled')
  }
  const build = assistantTaskBuild({
    identity,
    taskId: task.id,
    assertCurrent,
    published: async updated => {
      runner.task = updated
      taskChecks.saved()
      await useCreationFilesStore.getState().synchronizeSaved(identity)
      assertCurrent()
      onTask?.(updated)
    },
  })
  const taskChecks = new AssistantTaskChecks({
    identity,
    mode,
    task: () => runner.task,
    isCurrent: () =>
      !closed &&
      !signal.aborted &&
      useCreationStore.getState().workspace?.project.identity === identity,
    runner: checks,
    invokeProjectCheckTool: () => runner.execute('run_project_check', {}),
    prepareSavedInputs: build.prepare,
    validateBuild: build.validate,
    hasProjectTests: async () => {
      if (
        !runner.task.files.some(
          file =>
            !file.undone && !file.directory && !/\.(md|txt)$/i.test(file.path)
        )
      )
        return false
      const inventory = unwrap(
        await commands.assistantProjectInventory(identity)
      )
      assertCurrent()
      return inventory.files.some(
        file =>
          !file.path.split('/').includes('node_modules') &&
          /\.test\.(?:js|mjs|cjs)$/.test(file.path)
      )
    },
  })
  const runner: AssistantTaskRunner = {
    task,
    controls: [],
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
    checks: taskChecks,
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
        if (name === 'compile_synthdefs') {
          if (mode !== 'edit' || Object.keys(args).length)
            throw new AssistantToolExecutionError('invalidToolArguments')
          return JSON.stringify(assistantCompileSummary(await build.compile()))
        }
        if (
          name === 'run_project_check' ||
          name === 'run_project_static_check' ||
          name === 'run_project_tests'
        ) {
          if (mode !== 'edit' || Object.keys(args).length)
            throw new AssistantToolExecutionError('invalidToolArguments')
          return await taskChecks.requested(
            name === 'run_project_check'
              ? 'project'
              : name === 'run_project_tests'
                ? 'tests'
                : 'static'
          )
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
        taskChecks.saved()
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
                taskChecks.recoveredPublication()
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
