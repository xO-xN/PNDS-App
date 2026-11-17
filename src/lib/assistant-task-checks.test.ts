import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AssistantEvidenceStage } from './assistant-delivery'
import {
  AssistantTaskChecks,
  type AssistantTaskChecksOptions,
} from './assistant-task-checks'
import { CreationCheckRunner } from './creation-check-runner'
import {
  commands,
  type AssistantTask,
  type ControlledCheckReport,
  type DiagnosticReport,
} from './tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'

function diagnostic(): DiagnosticReport {
  return {
    schemaVersion: 1,
    checkerVersion: 'test',
    projectPath: '/score',
    project: null,
    inputFingerprint: 'static-v1',
    inputs: [],
    checks: [],
    issues: [],
    unverified: ['runtime'],
    staticPassed: true,
  }
}

function report(): ControlledCheckReport {
  return {
    schemaVersion: 1,
    checkerVersion: 'test',
    taskId: 'check-1',
    projectPath: '/score',
    mode: 'none',
    status: 'failed',
    error: 'ReferenceError: missingStart',
    diagnostics: null,
    evidence: {
      sourceRoot: '/score',
      sourceIdentity: 'inode',
      sharedSourceRoot: null,
      projectSha256: 'saved-v1',
      sharedSha256: null,
      projectFiles: [],
      sharedFiles: [],
      productionDependencies: [],
      installedPackages: [],
      sharedLibraries: [],
      git: { head: null, dirty: null, state: 'none', detail: null },
      changedDuringPreparation: false,
      scope: 'saved',
      notes: [],
    },
    freshness: { stale: false, complete: true, reasons: [] },
    environment: {
      nodeBinary: '/offline/node',
      nodeVersion: null,
      outputDevice: null,
      sampleRate: null,
      channelPlan: null,
      oscTarget: null,
    },
    checks: [
      {
        code: 'runtime',
        status: 'failed',
        reason: 'missingStart is undefined',
      },
    ],
    health: null,
    outputTail: ['server.js:42 missingStart()'],
    cleanup: {
      nodeConfirmed: true,
      audioConfirmed: true,
      temporaryFilesRemoved: true,
      errors: [],
    },
    unverified: ['sound', 'pageRendering'],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

const savedTask: AssistantTask = {
  id: 'assistant-task',
  mode: 'edit',
  files: [{ path: 'score.js', created: false, undone: false }],
}
const runners: CreationCheckRunner[] = []

function policy(
  task = savedTask,
  prepareSavedInputs?: () => Promise<{
    build?: AssistantEvidenceStage
    blocked?: string
  }>,
  hasProjectTests?: AssistantTaskChecksOptions['hasProjectTests'],
  validateBuild?: AssistantTaskChecksOptions['validateBuild']
) {
  let current = true
  const invoke = vi.fn<() => Promise<string>>().mockResolvedValue('tool result')
  const runner = new CreationCheckRunner('owner', () => current)
  runners.push(runner)
  const checks = new AssistantTaskChecks({
    identity: 'owner',
    mode: task.mode,
    task: () => task,
    isCurrent: () => current,
    runner,
    invokeProjectCheckTool: invoke,
    prepareSavedInputs,
    hasProjectTests,
    validateBuild,
  })
  return {
    checks,
    invoke,
    cancel: () => {
      current = false
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(commands.diagnoseCreationProject)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: diagnostic() })
  vi.mocked(commands.startAssistantCheck)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: 'check-1' })
  vi.mocked(commands.getCreationCheck)
    .mockReset()
    .mockResolvedValue({
      status: 'ok',
      data: {
        identity: 'owner',
        taskId: 'check-1',
        progress: null,
        report: report(),
      },
    })
  vi.mocked(commands.creationCheckIsStale)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: false })
  vi.mocked(commands.creationDiagnosticIsStale)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: false })
  vi.mocked(commands.cancelCreationCheck)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: null })
  vi.mocked(commands.inspectCreationRuntime)
    .mockReset()
    .mockResolvedValue({
      status: 'ok',
      data: {
        generation: '7',
        passed: true,
        checks: [],
        performers: null,
        savedChangesVerified: false,
      },
    })
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'owner',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationFilesStore.getState().clear()
  useSessionStore.setState({ sessionStatus: 'idle', runId: 7 })
})

afterEach(async () => {
  await Promise.all(runners.splice(0).map(runner => runner.dispose()))
})

it('reuses a real failed check and restores its checkpoint without starting another check', async () => {
  const { checks } = policy()
  checks.saved()
  expect(checks.requiredBeforeReply).toBe(true)
  const first = await checks.requested('project')
  expect(JSON.parse(first)).toMatchObject({
    status: 'failed',
    stale: false,
    savedInput: { projectSha256: 'saved-v1' },
  })
  expect(checks.requiredBeforeReply).toBe(false)
  expect(JSON.parse(await checks.requested('project'))).toMatchObject({
    status: 'failed',
    reused: true,
  })
  const checkpoint = checks.checkpoint()
  expect(checkpoint).toEqual({
    needsCheck: false,
    lastCheck: first,
    lastCheckId: 'check-1',
  })
  const restored = policy().checks
  await restored.restore({
    checkpoint,
    restarted: true,
    savedInputsChanged: false,
  })
  expect(restored.requiredBeforeReply).toBe(false)
  expect(restored.contextEvidence).toBe(first)
  expect(commands.creationCheckIsStale).toHaveBeenCalledWith('owner', 'check-1')
  expect(commands.startAssistantCheck).toHaveBeenCalledExactlyOnceWith(
    'owner',
    'assistant-task'
  )
  expect(commands.diagnoseCreationProject).toHaveBeenCalledOnce()
  checks.saved()
  expect(checks.contextEvidence).toBeUndefined()
  expect(checkpoint.lastCheck).toBe(first)
})

it('keeps the full-check obligation after an explicit static check', async () => {
  const { checks } = policy()
  checks.saved()
  expect(JSON.parse(await checks.requested('static'))).toMatchObject({
    status: 'passed',
    static: { staticPassed: true },
  })
  expect(checks.requiredBeforeReply).toBe(true)
  expect(checks.contextEvidence).toBeUndefined()
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
})

it('retains a runtime blocker across ordinary saves and clears it after recovered publication', async () => {
  vi.mocked(commands.startAssistantCheck).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'runtimeBusy', detail: 'another check owns cleanup' },
  })
  const { checks } = policy()
  checks.saved()
  const blocked = await checks.requested('project')
  expect(JSON.parse(blocked)).toMatchObject({
    status: 'blocked',
    runtime: { reason: 'runtimeBusy' },
  })
  checks.saved()
  expect(checks.requiredBeforeReply).toBe(true)
  expect(checks.contextEvidence).toBe(blocked)
  await checks.requested('project')
  expect(commands.startAssistantCheck).toHaveBeenCalledOnce()
  checks.recoveredPublication()
  expect(checks.requiredBeforeReply).toBe(true)
  expect(checks.contextEvidence).toBeUndefined()
  await checks.requested('project')
  expect(commands.startAssistantCheck).toHaveBeenCalledTimes(2)
})

it('does not restore an earlier process runtimeBusy blocker as current evidence', async () => {
  vi.mocked(commands.startAssistantCheck).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'runtimeBusy', detail: 'external runtime lease' },
  })
  const original = policy().checks
  original.saved()
  await original.requested('project')
  const restored = policy().checks
  await restored.restore({
    checkpoint: original.checkpoint(),
    restarted: true,
    savedInputsChanged: false,
  })
  expect(restored.requiredBeforeReply).toBe(true)
  expect(restored.contextEvidence).toBeUndefined()
  expect(commands.creationDiagnosticIsStale).not.toHaveBeenCalled()
  expect(commands.startAssistantCheck).toHaveBeenCalledOnce()
})

it('keeps live observation separate from saved-copy evidence across a restart', async () => {
  useSessionStore.setState({ sessionStatus: 'ready', runId: 7 })
  const { checks } = policy()
  checks.saved()
  expect(JSON.parse(await checks.requested('project'))).toMatchObject({
    status: 'partial',
    runtime: { kind: 'liveObservation', savedChangesVerified: false },
  })
  expect(commands.inspectCreationRuntime).toHaveBeenCalledExactlyOnceWith(
    'owner',
    true
  )
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
  expect(checks.deliveryEvidence).toMatchObject({
    staticCheck: { status: 'passed' },
    runtime: { status: 'observed', reason: 'existingRuntimeOnly' },
    behavior: { status: 'notRun' },
  })
  const restored = policy().checks
  await restored.restore({
    checkpoint: checks.checkpoint(),
    restarted: true,
    savedInputsChanged: false,
  })
  expect(restored.requiredBeforeReply).toBe(true)
  expect(restored.contextEvidence).toBeUndefined()
})

it('requires automatic compilation before checking even when the model never requests compilation', async () => {
  const order: string[] = []
  const prepare = vi.fn(async () => {
    order.push('compile')
    return { build: { status: 'passed' as const, inputVersion: 'source-v2' } }
  })
  vi.mocked(commands.diagnoseCreationProject).mockImplementation(async () => {
    order.push('static')
    return { status: 'ok', data: diagnostic() }
  })
  const { checks } = policy(
    {
      ...savedTask,
      files: [
        { path: 'supercollider/source/pad.scd', created: false, undone: false },
      ],
    },
    prepare
  )
  checks.saved()
  await checks.requested('project')
  expect(order).toEqual(['compile', 'static'])
  expect(checks.deliveryEvidence?.build).toEqual({
    status: 'passed',
    inputVersion: 'source-v2',
  })
})

it('returns failed compilation to the same task without testing old artifacts', async () => {
  const prepare = vi.fn(async () => ({
    build: {
      status: 'failed' as const,
      reason: 'sclang syntax error at pad.scd:12',
    },
    blocked: 'compileFailed',
  }))
  const { checks } = policy(savedTask, prepare)
  checks.saved()
  expect(JSON.parse(await checks.requested('project'))).toMatchObject({
    status: 'blocked',
    reason: 'compileFailed',
    build: { status: 'failed' },
  })
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
  expect(commands.diagnoseCreationProject).not.toHaveBeenCalled()
  checks.saved()
  expect(checks.requiredBeforeReply).toBe(true)
  await checks.requested('project')
  expect(prepare).toHaveBeenCalledTimes(2)
})

it('does not start a project runtime for a document-only edit', async () => {
  const { checks } = policy({
    ...savedTask,
    files: [{ path: 'README.md', created: false, undone: false }],
  })
  checks.saved()
  await checks.requested('project')
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
  expect(checks.deliveryEvidence).toMatchObject({
    build: { status: 'notRequired' },
    runtime: { status: 'notRequired' },
    behavior: { status: 'notRequired' },
  })
})

it('automatically runs supported project tests before a saved-copy check and keeps their scope separate', async () => {
  vi.mocked(commands.startAssistantTests).mockResolvedValue({
    status: 'ok',
    data: 'node-tests',
  })
  vi.mocked(commands.getCreationCheck).mockImplementation(
    async (identity, taskId) => ({
      status: 'ok',
      data: {
        identity,
        taskId,
        progress: null,
        report: {
          ...report(),
          taskId,
          status: 'passed',
          error: null,
          ...(taskId === 'node-tests'
            ? { nodeTests: { entries: ['tests/pad.test.mjs'], exitCode: 0 } }
            : {}),
        },
      },
    })
  )
  const { checks } = policy(savedTask, undefined, async () => true)
  checks.saved()
  const result = JSON.parse(await checks.requested('project'))
  expect(commands.startAssistantTests).toHaveBeenCalledExactlyOnceWith(
    'owner',
    'assistant-task'
  )
  expect(commands.startAssistantCheck).toHaveBeenCalledOnce()
  expect(result.projectTests).toMatchObject({
    status: 'passed',
    inputVersion: 'saved-v1',
  })
  expect(checks.deliveryEvidence).toMatchObject({
    projectTests: { status: 'passed' },
    behavior: { status: 'notRun' },
  })
  await checks.requested('tests')
  expect(commands.startAssistantTests).toHaveBeenCalledOnce()
})

it('retains real project-test failures and does not start a runtime with failed assertions', async () => {
  vi.mocked(commands.startAssistantTests).mockResolvedValue({
    status: 'ok',
    data: 'check-1',
  })
  const { checks } = policy(savedTask, undefined, async () => true)
  checks.saved()
  expect(JSON.parse(await checks.requested('project'))).toMatchObject({
    status: 'failed',
    projectTests: { status: 'failed' },
    tests: { error: 'ReferenceError: missingStart' },
  })
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
})

it('defers project tests while a performance owns the runtime', async () => {
  useSessionStore.setState({ sessionStatus: 'ready' })
  const { checks } = policy(savedTask, undefined, async () => true)
  checks.saved()
  expect(JSON.parse(await checks.requested('project'))).toMatchObject({
    status: 'blocked',
    projectTests: { status: 'blocked', reason: 'activeSession' },
  })
  expect(commands.startAssistantTests).not.toHaveBeenCalled()
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
})

it.each([false, true])(
  'skips delivery queries without saved changes or evidence (undone: %s)',
  async undone => {
    const validateBuild = vi.fn(async () => ({ needed: false }))
    const { checks, cancel } = policy(
      {
        id: 'read-only-task',
        mode: 'edit',
        files: undone
          ? [{ path: 'score.js', created: false, undone: true }]
          : [],
      },
      undefined,
      undefined,
      validateBuild
    )
    // The flow still fences its own request. With no receipt or saved change,
    // this policy has no delivery work that needs a native task/workspace.
    cancel()
    await checks.verifyDelivery()
    expect(validateBuild).not.toHaveBeenCalled()
    expect(commands.creationCheckIsStale).not.toHaveBeenCalled()
    expect(checks.deliveryEvidence).toBeUndefined()
  }
)

it('still fences existing evidence when the task has not saved any file', async () => {
  const { checks, cancel } = policy({
    id: 'checked-task',
    mode: 'edit',
    files: [],
  })
  await checks.restore({
    checkpoint: {
      needsCheck: false,
      lastCheck: JSON.stringify({
        status: 'passed',
        static: { staticPassed: true, inputFingerprint: 'saved-input' },
      }),
    },
    restarted: false,
    savedInputsChanged: false,
  })
  cancel()
  await expect(checks.verifyDelivery()).rejects.toThrow('cancelled')
})

it('invalidates build and test evidence changed while a model prepares its final reply', async () => {
  const validateBuild = vi.fn(async () => ({
    needed: false,
    build: { status: 'passed' as const, inputVersion: 'build-v1' },
  }))
  vi.mocked(commands.startAssistantTests).mockResolvedValue({
    status: 'ok',
    data: 'node-tests',
  })
  vi.mocked(commands.getCreationCheck).mockImplementation(
    async (identity, taskId) => ({
      status: 'ok',
      data: {
        identity,
        taskId,
        progress: null,
        report: { ...report(), taskId, status: 'passed', error: null },
      },
    })
  )
  const { checks } = policy(
    savedTask,
    undefined,
    async () => true,
    validateBuild
  )
  checks.saved()
  await checks.requested('project')
  expect(checks.deliveryEvidence).toMatchObject({
    build: { status: 'passed' },
    projectTests: { status: 'passed' },
  })
  validateBuild.mockResolvedValue({
    needed: true,
    build: { status: 'passed', inputVersion: 'build-v1' },
  })
  vi.mocked(commands.creationCheckIsStale).mockResolvedValue({
    status: 'ok',
    data: true,
  })
  await checks.verifyDelivery()
  expect(checks.deliveryEvidence).toMatchObject({
    build: { status: 'notRun' },
    projectTests: { status: 'notRun' },
    runtime: { status: 'notRun' },
    staticCheck: { status: 'notRun' },
  })
})

it('uses the complete tool adapter once and settles a normally returned refusal', async () => {
  const { checks, invoke } = policy()
  const refusal = JSON.stringify({
    status: 'refused',
    reason: 'questionPending',
  })
  invoke.mockResolvedValueOnce(refusal)
  checks.saved()
  expect(await checks.beforeReply()).toBe(refusal)
  expect(checks.requiredBeforeReply).toBe(false)
  expect(await checks.beforeReply()).toBeUndefined()
  expect(invoke).toHaveBeenCalledOnce()
  expect(commands.diagnoseCreationProject).not.toHaveBeenCalled()
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
})

it('keeps an automatic-check obligation when the tool adapter throws', async () => {
  const { checks, invoke } = policy()
  const error = new Error('cancelled')
  invoke.mockRejectedValueOnce(error)
  checks.saved()
  await expect(checks.beforeReply()).rejects.toBe(error)
  expect(checks.requiredBeforeReply).toBe(true)
  expect(invoke).toHaveBeenCalledOnce()
})

it('does not settle an automatic check from a tool result delivered after cancellation', async () => {
  const { checks, invoke, cancel } = policy()
  const returned = deferred<string>()
  invoke.mockReturnValueOnce(returned.promise)
  checks.saved()
  const pending = checks.beforeReply()
  const rejected = expect(pending).rejects.toThrow('cancelled')
  cancel()
  returned.resolve('late tool result')
  await rejected
  expect(checks.requiredBeforeReply).toBe(true)
  expect(checks.contextEvidence).toBeUndefined()
})

it('does not publish a completed native check delivered after task cancellation', async () => {
  const { checks, cancel } = policy()
  const completed =
    deferred<Awaited<ReturnType<typeof commands.getCreationCheck>>>()
  vi.mocked(commands.getCreationCheck).mockReturnValueOnce(completed.promise)
  checks.saved()
  const pending = checks.requested('project')
  const rejected = expect(pending).rejects.toThrow('cancelled')
  await vi.waitFor(() =>
    expect(commands.getCreationCheck).toHaveBeenCalledOnce()
  )
  cancel()
  completed.resolve({
    status: 'ok',
    data: {
      identity: 'owner',
      taskId: 'check-1',
      progress: null,
      report: report(),
    },
  })
  await rejected
  expect(checks.contextEvidence).toBeUndefined()
  expect(checks.requiredBeforeReply).toBe(true)
  expect(commands.cancelCreationCheck).toHaveBeenCalledExactlyOnceWith(
    'check-1'
  )
})

it.each([
  { files: savedTask.files, required: true },
  { files: [], required: false },
  {
    files: [{ path: 'score.js', created: false, undone: true }],
    required: false,
  },
])(
  'derives a missing V1 obligation from the current task: $required',
  async ({ files, required }) => {
    const { checks } = policy({ ...savedTask, files })
    await checks.restore({
      checkpoint: {},
      restarted: true,
      savedInputsChanged: false,
    })
    expect(checks.requiredBeforeReply).toBe(required)
    expect(commands.startAssistantCheck).not.toHaveBeenCalled()
  }
)

it('exports a checkpoint that cannot change the running policy when a caller edits it', () => {
  const { checks } = policy()
  checks.saved()
  const exported = checks.checkpoint()
  Reflect.set(exported, 'needsCheck', false)
  Reflect.set(exported, 'lastCheck', 'untrusted caller evidence')
  expect(checks.requiredBeforeReply).toBe(true)
  expect(checks.contextEvidence).toBeUndefined()
  expect(checks.checkpoint()).toEqual({
    needsCheck: true,
    lastCheck: undefined,
    lastCheckId: undefined,
  })
})
