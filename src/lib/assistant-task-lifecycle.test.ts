import { beforeEach, expect, it, vi } from 'vitest'
import {
  AssistantTaskLifecycle,
  type AssistantTaskAttempt,
} from './assistant-task-lifecycle'
import type { AssistantContinuation } from './assistant-flow'
import { commands } from './tauri-bindings'
import {
  encodeSavedAssistantRequest,
  flushAssistantResume,
} from './assistant-resume'

const goal = '增加字号，并保留每位演奏者的独立参数。'
function attempt(): AssistantTaskAttempt {
  return {
    owner: 'owner',
    mode: 'edit',
    input: goal,
    userId: 'user',
    replyId: 'reply',
    conversationId: 'chat',
    modelKey: 'captured-model',
    locale: 'zh-CN',
    history: [],
    wholePlan: null,
    continuation: null,
    paused: false,
  }
}
function boundary(taskId = 'native-task'): AssistantContinuation {
  return {
    taskId,
    key: 'runtime-only',
    projectFingerprint: 'saved',
    projectSnapshot: { fingerprint: 'saved', files: [] },
    messages: [{ role: 'user', content: goal, contextKind: 'input' }],
    sources: [],
    text: '',
    project: null,
    toolCalls: 0,
    toolCharacters: 0,
    callIds: [],
    calls: [],
    returnedCharacters: 0,
    reusedCharacters: 0,
    proposals: [],
    handoff: null,
    needsCheck: false,
    lastCheckId: 'completed-check',
    lastCheck: '{"status":"passed"}',
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(async () => {
  await flushAssistantResume().catch(() => undefined)
  vi.clearAllMocks()
  vi.mocked(commands.saveCreationAssistantResume)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: null })
  vi.mocked(commands.clearCreationAssistantResume)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: null })
  vi.mocked(commands.loadCreationAssistantResume)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: null })
})

it('continues only the original goal, mode, workspace and chat while allowing a different unsent draft', () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  lifecycle.start(attempt())
  expect(lifecycle.canContinue('my different draft')).toBe(false)
  expect(lifecycle.attempt?.input).toBe(goal)
  expect(
    lifecycle.continuationFor('继续', 'owner', 'edit', 'chat')?.input
  ).toBe(goal)
  expect(
    lifecycle.continuationFor('continue', 'other', 'edit', 'chat')
  ).toBeNull()
  expect(
    lifecycle.continuationFor('continue', 'owner', 'discussion', 'chat')
  ).toBeNull()
  expect(
    lifecycle.continuationFor('continue', 'owner', 'edit', 'other-chat')
  ).toBeNull()
})

it('pauses preparation immediately and preserves the old checkpoint until a continuation publishes a newer boundary', async () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const first = lifecycle.start(attempt())
  await first.checkpoint(boundary())
  expect(lifecycle.pause()).toEqual({ phase: 'idle', input: goal })
  expect(first.signal.aborted).toBe(true)
  expect(first.isCurrent()).toBe(false)
  const retained = lifecycle.attempt
  if (!retained) throw new Error('Missing paused task')
  lifecycle.start({ ...retained, paused: false })
  await flushAssistantResume()
  expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
  expect(lifecycle.attempt?.continuation?.lastCheckId).toBe('completed-check')
})

it('pauses executing tools at their complete boundary and saves the original identities', async () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const run = lifecycle.start(attempt())
  run.activate('chat', [], [])
  expect(lifecycle.pause()?.phase).toBe('pausing')
  expect(run.pauseSignal.aborted).toBe(true)
  expect(run.signal.aborted).toBe(false)
  await run.checkpoint(boundary())
  expect(await run.fail('cancelled')).toEqual({
    paused: true,
    canContinue: true,
  })
  expect(commands.saveCreationAssistantResume).toHaveBeenLastCalledWith(
    'owner',
    expect.objectContaining({
      taskId: 'native-task',
      mode: 'edit',
      input: goal,
      userMessageId: 'user',
      replyMessageId: 'reply',
      conversationId: 'chat',
      state: 'paused',
    })
  )
  run.release()
  expect(lifecycle.canContinue('继续')).toBe(true)
})

it('retains completed evidence on workspace teardown and rejects late callbacks', async () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const run = lifecycle.start(attempt())
  await run.checkpoint(boundary())
  lifecycle.stop(true)
  await run.checkpoint(boundary('late-task'))
  await flushAssistantResume()
  expect(run.signal.aborted).toBe(true)
  expect(lifecycle.attempt).toBeNull()
  expect(commands.saveCreationAssistantResume).toHaveBeenLastCalledWith(
    'owner',
    expect.objectContaining({ taskId: 'native-task', state: 'paused' })
  )
  expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
  expect(commands.endCreationAssistantTask).not.toHaveBeenCalled()
})

it('explicit cancellation retires recovery without invoking undo or mutating source files', async () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const run = lifecycle.start(attempt())
  await run.checkpoint(boundary())
  lifecycle.stop(false)
  await flushAssistantResume()
  expect(run.signal.aborted).toBe(true)
  expect(commands.clearCreationAssistantResume).toHaveBeenCalledExactlyOnceWith(
    'owner',
    'native-task'
  )
  expect(commands.undoCreationAssistantTask).not.toHaveBeenCalled()
  expect(lifecycle.canContinue('继续')).toBe(false)
})

it('captures a cancelled native begin before its first checkpoint and waits for that execution to close', async () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const run = lifecycle.start(attempt())
  run.activate('chat', [], [])
  lifecycle.stop(false)
  const settled = vi.fn()
  const waiting = lifecycle.waitForRetirements().then(settled)
  await Promise.resolve()
  expect(settled).not.toHaveBeenCalled()
  run.bindTask('late-native-task')
  await flushAssistantResume()
  expect(commands.clearCreationAssistantResume).toHaveBeenCalledExactlyOnceWith(
    'owner',
    'late-native-task'
  )
  expect(settled).not.toHaveBeenCalled()
  run.release()
  await waiting
  expect(settled).toHaveBeenCalledOnce()
})

it('retries a failed terminal cleanup on the next explicit action', async () => {
  const error = vi.fn()
  const lifecycle = new AssistantTaskLifecycle(error)
  const run = lifecycle.start(attempt())
  await run.checkpoint(boundary())
  vi.mocked(commands.clearCreationAssistantResume).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'io', detail: 'temporary disk failure' },
  })
  lifecycle.stop(false)
  await expect(flushAssistantResume()).rejects.toThrow('io')
  await lifecycle.waitForRetirements('owner')
  expect(commands.clearCreationAssistantResume).toHaveBeenCalledTimes(2)
  expect(error).toHaveBeenCalledWith('owner')
})

it('keeps an old workspace cleanup failure from blocking another project', async () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const run = lifecycle.start(attempt())
  await run.checkpoint(boundary())
  vi.mocked(commands.clearCreationAssistantResume).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'invalidIdentity', detail: 'workspace closed' },
  })
  lifecycle.stop(false)
  await expect(flushAssistantResume()).rejects.toThrow('invalidIdentity')
  await lifecycle.waitForRetirements('different-owner')
  expect(commands.clearCreationAssistantResume).toHaveBeenCalledOnce()
  expect(commands.undoCreationAssistantTask).not.toHaveBeenCalled()
})

it('captures the stored old task before a later checkpoint is published', async () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const lookup =
    deferred<Awaited<ReturnType<typeof commands.loadCreationAssistantResume>>>()
  vi.mocked(commands.loadCreationAssistantResume).mockReturnValueOnce(
    lookup.promise
  )
  const retiring = lifecycle.retireStored('owner')
  const next = lifecycle.start({
    ...attempt(),
    input: 'New task',
    userId: 'new-user',
    replyId: 'new-reply',
  })
  const saved = next.checkpoint(boundary('new-native-task'))
  lookup.resolve({
    status: 'ok',
    data: {
      record: {
        taskId: 'old-native-task',
        mode: 'edit',
        input: goal,
        userMessageId: 'user',
        replyMessageId: 'reply',
        conversationId: 'chat',
        locale: 'zh-CN',
        modelKey: 'captured-model',
        state: 'paused',
        payload: '',
      },
      files: [],
    },
  })
  await Promise.all([retiring, saved])
  expect(commands.clearCreationAssistantResume).toHaveBeenCalledExactlyOnceWith(
    'owner',
    'old-native-task'
  )
  expect(lifecycle.attempt?.continuation?.taskId).toBe('new-native-task')
})

it('clears a completed checkpoint only after final chat publication succeeds', async () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const run = lifecycle.start(attempt())
  await run.checkpoint(boundary())
  const chat = deferred<boolean>()
  const finished = run.complete(() => chat.promise)
  expect(lifecycle.attempt).toBeNull()
  expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
  chat.resolve(true)
  await finished
  expect(commands.clearCreationAssistantResume).toHaveBeenCalledExactlyOnceWith(
    'owner',
    'native-task'
  )
})

it('retains the durable boundary when final chat publication fails', async () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const run = lifecycle.start(attempt())
  await run.checkpoint(boundary())
  await run.complete(async () => false)
  expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
})

it('retries a completed task cleanup without repeating final chat publication', async () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const run = lifecycle.start(attempt())
  await run.checkpoint(boundary())
  vi.mocked(commands.clearCreationAssistantResume).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'io', detail: 'temporary cleanup error' },
  })
  const publish = vi.fn().mockResolvedValue(true)
  await run.complete(publish)
  run.release()
  await lifecycle.waitForRetirements('owner')
  expect(publish).toHaveBeenCalledOnce()
  expect(commands.clearCreationAssistantResume).toHaveBeenCalledTimes(2)
})

it('late completion targets only its own checkpoint after a newer task starts', async () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const first = lifecycle.start(attempt())
  await first.checkpoint(boundary('first-task'))
  const chat = deferred<boolean>()
  const completion = first.complete(() => chat.promise)
  const second = lifecycle.start({
    ...attempt(),
    input: 'New goal',
    userId: 'new-user',
    replyId: 'new-reply',
  })
  await second.checkpoint(boundary('second-task'))
  chat.resolve(true)
  await completion
  expect(commands.clearCreationAssistantResume).toHaveBeenCalledExactlyOnceWith(
    'owner',
    'first-task'
  )
  expect(lifecycle.attempt?.continuation?.taskId).toBe('second-task')
  expect(lifecycle.attempt?.input).toBe('New goal')
})

it('keeps recovery available and reports checkpoint publication failure', async () => {
  const failed = vi.fn()
  const lifecycle = new AssistantTaskLifecycle(failed)
  const run = lifecycle.start(attempt())
  vi.mocked(commands.saveCreationAssistantResume).mockResolvedValue({
    status: 'error',
    error: { code: 'io', detail: 'disk full' },
  })
  await expect(run.checkpoint(boundary())).rejects.toThrow('io')
  expect(await run.fail('requestFailed')).toEqual({
    paused: false,
    canContinue: true,
  })
  expect(failed).toHaveBeenCalledWith('owner')
  expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
  expect(lifecycle.attempt?.input).toBe(goal)
})

it('retains recoverable transport failures and retires terminal errors', async () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const run = lifecycle.start(attempt())
  await run.checkpoint(boundary())
  expect(await run.fail('protocol')).toEqual({
    paused: false,
    canContinue: true,
  })
  expect(lifecycle.attempt?.continuation?.interruption).toBe('protocol')
  expect(await run.fail('authentication')).toEqual({
    paused: false,
    canContinue: false,
  })
  await flushAssistantResume()
  expect(commands.clearCreationAssistantResume).toHaveBeenCalledExactlyOnceWith(
    'owner',
    'native-task'
  )
})

it('retains a stalled work task at its completed boundary for explicit continuation', async () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const current = {
    ...attempt(),
    history: [
      {
        id: 'earlier',
        role: 'user' as const,
        text: 'Keep the original audio.',
        status: 'completed' as const,
        scope: 'project' as const,
        sources: [],
      },
    ],
  }
  const run = lifecycle.start(current)
  const saved = boundary()
  saved.calls = [null]
  saved.toolCalls = 2
  await run.checkpoint(saved)

  expect(await run.fail('noProgress')).toEqual({
    paused: false,
    canContinue: true,
  })
  expect(
    lifecycle.continuationFor('继续', 'owner', 'edit', 'chat')
  ).toMatchObject({
    input: goal,
    history: current.history,
    continuation: {
      taskId: 'native-task',
      interruption: 'noProgress',
      toolCalls: 2,
      calls: [null],
      lastCheckId: 'completed-check',
    },
  })
  expect(commands.saveCreationAssistantResume).toHaveBeenLastCalledWith(
    'owner',
    expect.objectContaining({
      taskId: 'native-task',
      state: 'failed',
      input: goal,
    })
  )
  expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
})

it.each([
  { mode: 'discussion' as const, purpose: undefined },
  { mode: 'edit' as const, purpose: 'handoffDraft' as const },
])(
  'does not retain a no-progress interruption outside a work task',
  async ({ mode, purpose }) => {
    const lifecycle = new AssistantTaskLifecycle(vi.fn())
    const run = lifecycle.start({ ...attempt(), mode })
    await run.checkpoint({ ...boundary(), purpose })
    expect(await run.fail('noProgress')).toEqual({
      paused: false,
      canContinue: false,
    })
    await flushAssistantResume()
    expect(
      commands.clearCreationAssistantResume
    ).toHaveBeenCalledExactlyOnceWith('owner', 'native-task')
  }
)

it('does not offer continuation for a work stall before any safe boundary', async () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const run = lifecycle.start(attempt())
  expect(await run.fail('noProgress')).toEqual({
    paused: false,
    canContinue: false,
  })
})

it('retains a work stage when an unexpected budget error occurs', async () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const run = lifecycle.start(attempt())
  await run.checkpoint({
    ...boundary(),
    stage: { index: 2, modelCalls: 128, toolCalls: 30, toolCharacters: 400 },
  })
  expect(await run.fail('budgetExceeded')).toEqual({
    paused: false,
    canContinue: true,
  })
  expect(
    lifecycle.continuationFor('继续', 'owner', 'edit', 'chat')
  ).toMatchObject({
    continuation: {
      taskId: 'native-task',
      interruption: 'budgetExceeded',
      stage: { index: 2, modelCalls: 128, toolCalls: 30, toolCharacters: 400 },
    },
  })
  const record = vi.mocked(commands.saveCreationAssistantResume).mock
    .lastCall?.[1]
  expect(JSON.parse(record?.payload ?? '{}').continuation.stage).toEqual({
    index: 2,
    modelCalls: 128,
    toolCalls: 30,
    toolCharacters: 400,
  })
  expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
})

it.each([
  { mode: 'discussion' as const, purpose: undefined, stage: true },
  { mode: 'edit' as const, purpose: 'handoffDraft' as const, stage: true },
  { mode: 'edit' as const, purpose: undefined, stage: false },
])(
  'does not retain an unrecognized budget interruption',
  async ({ mode, purpose, stage }) => {
    const lifecycle = new AssistantTaskLifecycle(vi.fn())
    const run = lifecycle.start({ ...attempt(), mode })
    await run.checkpoint({
      ...boundary(),
      purpose,
      ...(stage
        ? {
            stage: { index: 1, modelCalls: 1, toolCalls: 1, toolCharacters: 1 },
          }
        : {}),
    })
    expect(await run.fail('budgetExceeded')).toEqual({
      paused: false,
      canContinue: false,
    })
    await flushAssistantResume()
    expect(
      commands.clearCreationAssistantResume
    ).toHaveBeenCalledExactlyOnceWith('owner', 'native-task')
  }
)

it('restores a continuation opportunity without restoring native authorization or starting a request', () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const continuation = boundary()
  const restored = lifecycle.restore('new-owner', {
    record: {
      taskId: 'native-task',
      mode: 'edit',
      input: goal,
      userMessageId: 'user',
      replyMessageId: 'reply',
      conversationId: 'chat',
      locale: 'zh-CN',
      modelKey: 'captured-model',
      state: 'running',
      payload: encodeSavedAssistantRequest({
        history: [],
        attachments: [],
        locale: 'zh-CN',
        continuation,
      }),
    },
    files: [{ path: 'a.js', version: 'saved-version' }],
  })
  expect(restored).toMatchObject({
    owner: 'new-owner',
    input: goal,
    mode: 'edit',
    paused: true,
    continuation: {
      restored: true,
      project: null,
      recoveryFiles: [{ path: 'a.js', version: 'saved-version' }],
    },
  })
  expect(commands.beginCreationAssistantTask).not.toHaveBeenCalled()
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
})

it('requires successful recovery inspection before chat deletion and retains promoted chat identities', async () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const current = attempt()
  lifecycle.start(current)
  vi.mocked(commands.loadCreationAssistantResume).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'io', detail: 'unreadable recovery record' },
  })
  await expect(
    lifecycle.beforeChatRemoval('owner', new Set(['reply']))
  ).rejects.toThrow('io')
  expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
  expect(
    lifecycle.removeChatReferences(new Set(['other-user']), false, 'chat')
  ).toBe(false)
  expect(lifecycle.attempt?.conversationId).toBeNull()
  expect(lifecycle.attempt?.input).toBe(goal)
})

it('persists a resource wait without completing the task and preserves that state across shutdown', async () => {
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const run = lifecycle.start(attempt())
  await run.checkpoint(boundary())
  await run.waitForResources()
  expect(lifecycle.attempt?.input).toBe(goal)
  expect(lifecycle.attempt?.awaitingResources).toBe(true)
  expect(commands.saveCreationAssistantResume).toHaveBeenLastCalledWith(
    'owner',
    expect.objectContaining({
      state: 'awaitingResources',
      input: goal,
      taskId: 'native-task',
    })
  )
  run.release()
  lifecycle.stop(true)
  await flushAssistantResume()
  expect(commands.saveCreationAssistantResume).toHaveBeenLastCalledWith(
    'owner',
    expect.objectContaining({ state: 'awaitingResources' })
  )
  expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
})
