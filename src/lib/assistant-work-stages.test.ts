import { expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  AssistantFlowError,
  type AssistantContinuation,
  type AssistantDependencies,
  type AssistantRequest,
} from './assistant-flow'
import type { AssistantTaskRunner } from './assistant-task-tools'
import { createAssistantTaskChecksFixture } from '@/test/assistant-task-checks-fixture'
import { HELP_BOOKS } from './help-corpus'
import type { AssistantProjectSnapshot, AssistantTask } from './tauri-bindings'
import {
  deserializeAssistantContinuation,
  serializeAssistantContinuation,
} from './assistant-resume'

function work() {
  let revision = 0
  const snapshot = (): AssistantProjectSnapshot => ({
    fingerprint: `saved-${revision}`,
    files: [
      { path: 'server.js', bytes: 16, version: `v${revision}`, reason: null },
    ],
  })
  const task: AssistantTask = { id: 'same-work-task', mode: 'edit', files: [] }
  const runner: AssistantTaskRunner = {
    task,
    checks: createAssistantTaskChecksFixture({
      identity: 'owner',
      task: () => runner.task,
      invokeProjectCheckTool: () => runner.execute('run_project_check', {}),
    }),
    execute: vi.fn(async name => {
      if (name === 'run_project_check') {
        return runner.checks.requested('project')
      }
      revision++
      runner.checks.saved()
      task.files = [{ path: 'server.js', created: false, undone: false }]
      return JSON.stringify({ status: 'saved', task, inventory: snapshot() })
    }),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const deps: AssistantDependencies = {
    begin: vi.fn(async (_, requestId) => ({
      requestId,
      model: 'test',
      baseUrl: 'http://local',
    })),
    cancel: vi.fn().mockResolvedValue(undefined),
    corpus: async () =>
      HELP_BOOKS.flatMap(book =>
        book.documentIds.map(id => ({
          id,
          path: `${id}.md`,
          markdown: `# ${id}\n\nInstalled contract.`,
        }))
      ),
    projectInventory: async () => snapshot(),
    task: vi.fn().mockResolvedValue(runner),
    turn: vi.fn(),
  }
  const checkpoints: AssistantContinuation[] = []
  const request: AssistantRequest = {
    identity: 'owner',
    mode: 'edit',
    input: 'Implement the selected score',
    history: [],
    locale: 'en',
    projectReading: true,
    project: snapshot(),
    signal: new AbortController().signal,
    isCurrent: () => true,
    onContinuation: value => {
      if (value) checkpoints.push(value)
    },
  }
  const write = (id: number) => ({
    text: null,
    toolCalls: [
      {
        id: `save-${id}`,
        name: 'write_project_file',
        arguments: JSON.stringify({
          path: 'server.js',
          version: `v${revision}`,
          edits: [
            {
              oldText: `const n = ${revision}`,
              newText: `const n = ${revision + 1}`,
            },
          ],
        }),
      },
    ],
    usage: {
      inputTokens: 10,
      outputTokens: 2,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    },
  })
  return { deps, request, checkpoints, runner, write, snapshot }
}

it('continues productive Work beyond 128 model calls in the same task without replaying writes', async () => {
  const h = work()
  let turns = 0
  const usage = vi.fn()
  h.deps.turn = vi.fn(async () =>
    ++turns <= 130
      ? h.write(turns)
      : { text: 'Saved the complete score.', toolCalls: [] }
  )
  await expect(
    runAssistantRequest({ ...h.request, onUsage: usage }, h.deps)
  ).resolves.toMatchObject({ text: 'Saved the complete score.' })
  expect(h.deps.begin).toHaveBeenCalledTimes(2)
  expect(h.deps.task).toHaveBeenCalledTimes(1)
  expect(h.runner.execute).toHaveBeenCalledTimes(131)
  expect(h.runner.execute).toHaveBeenLastCalledWith('run_project_check', {})
  expect(h.runner.close).toHaveBeenCalledOnce()
  expect(h.checkpoints.at(-1)?.taskId).toBe('same-work-task')
  const checkpoint = h.checkpoints.at(-1)
  if (!checkpoint) throw new Error('Missing complete checkpoint')
  const restored = deserializeAssistantContinuation(
    serializeAssistantContinuation(checkpoint)
  )
  expect(restored?.taskId).toBe('same-work-task')
  expect(
    usage.mock.lastCall?.[0].previousCalls?.count +
      usage.mock.lastCall?.[0].calls.length
  ).toBe(132)
})

it('pauses at a stage transition and restores the same task and pending check without replaying writes', async () => {
  const h = work()
  const pause = new AbortController()
  let turns = 0
  h.deps.turn = vi.fn(async () => h.write(++turns))
  await expect(
    runAssistantRequest(
      {
        ...h.request,
        pauseSignal: pause.signal,
        onPhase: phase => {
          if (phase === 'continuing') pause.abort()
        },
      },
      h.deps
    )
  ).rejects.toMatchObject({ code: 'cancelled' })
  const saved = h.checkpoints.at(-1)
  if (!saved) throw new Error('Missing stage checkpoint')
  expect(saved.stage?.modelCalls).toBe(128)
  expect(saved.needsCheck).toBe(true)
  const restored = deserializeAssistantContinuation(
    serializeAssistantContinuation(saved)
  )
  if (!restored) throw new Error('Cannot restore stage checkpoint')
  h.deps.turn = vi.fn().mockResolvedValue({
    text: 'The saved score passed checks.',
    toolCalls: [],
  })
  await expect(
    runAssistantRequest(
      { ...h.request, project: h.snapshot(), continuation: restored },
      h.deps
    )
  ).resolves.toMatchObject({ text: 'The saved score passed checks.' })
  expect(h.deps.task).toHaveBeenLastCalledWith(
    'owner',
    'edit',
    'same-work-task',
    expect.any(AbortSignal),
    undefined,
    h.request.input
  )
  expect(h.runner.execute).toHaveBeenCalledTimes(129)
  expect(h.runner.execute).toHaveBeenLastCalledWith('run_project_check', {})
})

it('keeps the last complete stage when the next model session fails to begin', async () => {
  const h = work()
  let starts = 0
  h.deps.begin = vi.fn(async (_, requestId) => {
    if (++starts === 2) throw new AssistantFlowError('network')
    return { requestId, model: 'test', baseUrl: 'http://local' }
  })
  let turns = 0
  h.deps.turn = vi.fn(async () => h.write(++turns))
  await expect(runAssistantRequest(h.request, h.deps)).rejects.toMatchObject({
    code: 'network',
  })
  const saved = h.checkpoints.at(-1)
  if (!saved) throw new Error('Missing stage checkpoint')
  expect(saved.stage?.modelCalls).toBe(128)
  expect(saved.projectFingerprint).toBe('saved-128')
  expect(saved.needsCheck).toBe(true)
  expect(h.runner.execute).toHaveBeenCalledTimes(128)
})

it('bounds chat source receipts while retaining exact evidence across several productive stages', async () => {
  const h = work()
  h.deps.readProject = async () => {
    const version = h.snapshot().files[0]?.version ?? ''
    const text = `const n = ${version.slice(1)}`
    return {
      path: 'server.js',
      version,
      text,
      offset: 0,
      endOffset: text.length,
      totalCharacters: text.length,
      nextOffset: null,
      startLine: 1,
      endLine: 1,
    }
  }
  let turns = 0
  h.deps.turn = vi.fn(async () => {
    if (++turns > 260)
      return {
        text: 'All source revisions are saved and checked.',
        toolCalls: [],
      }
    const write = h.write(turns)
    return {
      ...write,
      toolCalls: [
        {
          id: `read-${turns}`,
          name: 'read_project_text',
          arguments: JSON.stringify({ path: 'server.js' }),
        },
        ...write.toolCalls,
      ],
    }
  })
  const sources = vi.fn()
  const result = await runAssistantRequest(
    { ...h.request, onSources: sources },
    h.deps
  )
  expect(h.deps.begin).toHaveBeenCalledTimes(3)
  expect(result.sources).toHaveLength(256)
  expect(sources.mock.calls.every(([receipts]) => receipts.length <= 256)).toBe(
    true
  )
  expect(h.checkpoints.at(-1)?.sources).toHaveLength(260)
  expect(h.runner.execute).toHaveBeenCalledTimes(261)
})

it.each([true, false])(
  'recovers only journal-verified compiled artifacts outside text inventory (owned: %s)',
  async owned => {
    const h = work()
    h.deps.turn = vi
      .fn()
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          {
            id: 'inventory',
            name: 'list_project_files',
            arguments: '{}',
          },
        ],
      })
      .mockRejectedValue(new AssistantFlowError('protocol'))
    await expect(runAssistantRequest(h.request, h.deps)).rejects.toMatchObject({
      code: 'protocol',
    })
    const saved = h.checkpoints.at(-1)
    if (!saved) throw new Error('Missing recovery checkpoint')
    const artifact = 'supercollider/synthdefs/pad.scsyndef'
    const snapshot = {
      fingerprint: 'compiled',
      files: [
        ...h.snapshot().files,
        {
          path: artifact,
          version: null,
          bytes: 128,
          reason: 'binary',
        },
      ],
    }
    saved.restored = true
    saved.recoveryFiles = owned
      ? [{ path: artifact, version: 'verified-binary-hash' }]
      : []
    h.runner.task.files = [{ path: artifact, created: true, undone: false }]
    h.deps.projectInventory = async () => snapshot
    h.deps.turn = vi.fn().mockResolvedValue({
      text: 'Compiled bytes recovered; live behavior still needs verification.',
      toolCalls: [],
    })
    const result = runAssistantRequest(
      { ...h.request, project: snapshot, continuation: saved },
      h.deps
    )
    if (owned) {
      await expect(result).resolves.toMatchObject({
        text: 'Compiled bytes recovered; live behavior still needs verification.',
      })
      expect(h.runner.execute).toHaveBeenCalledExactlyOnceWith(
        'run_project_check',
        {}
      )
    } else
      await expect(result).rejects.toMatchObject({
        code: 'projectScopeChanged',
      })
  }
)

it('advances scope when automatic pre-reply checks publish compiled artifacts', async () => {
  const h = work()
  let compiled = false
  const artifact = 'supercollider/synthdefs/pad.scsyndef'
  h.deps.projectInventory = async () =>
    compiled
      ? {
          fingerprint: 'compiled-output',
          files: [
            ...h.snapshot().files,
            {
              path: artifact,
              version: null,
              bytes: 128,
              reason: 'binary',
            },
          ],
        }
      : h.snapshot()
  const execute = h.runner.execute
  h.runner.execute = vi.fn(async (name, args) => {
    if (name === 'run_project_check') {
      compiled = true
      h.runner.task.files.push({ path: artifact, created: true, undone: false })
    }
    return execute(name, args)
  })
  h.deps.turn = vi.fn().mockResolvedValueOnce(h.write(1)).mockResolvedValue({
    text: 'Saved and compiled. Live behavior remains unverified.',
    toolCalls: [],
  })
  // The synthetic write uses exact edits, so no complete replacement read is required.
  const result = await runAssistantRequest(h.request, h.deps)
  expect(result.text).toBe(
    'Saved and compiled. Live behavior remains unverified.'
  )
  expect(compiled).toBe(true)
  expect(h.deps.turn).toHaveBeenCalledTimes(3)
  expect(h.checkpoints.at(-1)?.projectSnapshot?.fingerprint).toBe(
    'compiled-output'
  )
})

it('takes final delivery evidence only after the trusted post-generation verification', async () => {
  const h = work()
  const evidence = {
    schemaVersion: 1,
    taskId: 'same-work-task',
    savedPaths: ['server.js'],
    staticCheck: { status: 'passed' as const },
    build: { status: 'notRequired' as const },
    runtime: { status: 'passed' as 'passed' | 'notRun', reason: '' },
    behavior: { status: 'notRun' as const },
  }
  Object.defineProperty(h.runner.checks, 'deliveryEvidence', {
    get: () => evidence,
  })
  h.runner.checks.verifyDelivery = vi.fn(async () => {
    evidence.runtime = { status: 'notRun', reason: 'savedInputChanged' }
  })
  h.deps.turn = vi
    .fn()
    .mockResolvedValue({ text: 'Report the checked stage.', toolCalls: [] })
  const result = await runAssistantRequest(h.request, h.deps)
  expect(h.runner.checks.verifyDelivery).toHaveBeenCalledOnce()
  expect(result.checkOutcome?.runtime).toEqual({
    status: 'notRun',
    reason: 'savedInputChanged',
  })
})
