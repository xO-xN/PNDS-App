import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CreationCheckRunner } from './creation-check-runner'
import {
  commands,
  type CreationCheckTask,
  type ControlledCheckOptions,
} from './tauri-bindings'

const options: ControlledCheckOptions = {
  mode: 'internal',
  compile: true,
  timeoutMs: 30000,
  outputDevice: 'Stage interface',
  sampleRate: 96000,
}
function completed(taskId = 'check-1'): CreationCheckTask {
  return {
    identity: 'owner',
    taskId,
    progress: null,
    report: {
      schemaVersion: 1,
      checkerVersion: 'test',
      taskId,
      projectPath: '/score',
      mode: 'none',
      status: 'passed',
      error: null,
      diagnostics: null,
      evidence: null,
      freshness: null,
      environment: {
        nodeBinary: '/offline/node',
        nodeVersion: 'v24',
        outputDevice: null,
        sampleRate: null,
        channelPlan: null,
        oscTarget: null,
      },
      checks: [],
      health: null,
      outputTail: [],
      cleanup: {
        nodeConfirmed: true,
        audioConfirmed: true,
        temporaryFilesRemoved: true,
        errors: [],
      },
      unverified: ['sound'],
    },
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
const runners: CreationCheckRunner[] = []
function runner(current = () => true) {
  const run = new CreationCheckRunner('owner', current)
  runners.push(run)
  return run
}
const assistant = { kind: 'assistant' as const, taskId: 'assistant-task' }

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(commands.startCreationCheck)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: 'check-1' })
  vi.mocked(commands.startAssistantCheck)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: 'check-1' })
  vi.mocked(commands.getCreationCheck)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: completed() })
  vi.mocked(commands.cancelCreationCheck)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: null })
  vi.mocked(commands.creationCheckIsStale)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: false })
})
afterEach(async () => {
  await Promise.all(runners.splice(0).map(run => run.dispose()))
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('preserves explicit manual options and uses the separately authorized assistant command', async () => {
  const run = runner()
  expect(
    await run.run({ kind: 'manual', options: async () => options })
  ).toEqual(completed())
  expect(commands.startCreationCheck).toHaveBeenCalledExactlyOnceWith(
    'owner',
    options
  )
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
  expect(await run.run(assistant)).toEqual(completed())
  expect(commands.startAssistantCheck).toHaveBeenCalledExactlyOnceWith(
    'owner',
    'assistant-task'
  )
  await run.dispose()
  expect(commands.cancelCreationCheck).not.toHaveBeenCalled()
})

it('cancels during manual preparation without submitting, and permits an explicit later check', async () => {
  const prepared = deferred<ControlledCheckOptions>()
  const run = runner()
  const pending = run.run({ kind: 'manual', options: () => prepared.promise })
  await run.cancel()
  prepared.resolve(options)
  expect(await pending).toBeNull()
  expect(commands.startCreationCheck).not.toHaveBeenCalled()
  expect(await run.run(assistant)).toEqual(completed())
})

it('coalesces duplicate submission and collects cleanup after cancelling a late start', async () => {
  const start =
    deferred<Awaited<ReturnType<typeof commands.startAssistantCheck>>>()
  vi.mocked(commands.startAssistantCheck).mockReturnValueOnce(start.promise)
  const task = completed()
  if (!task.report) throw new Error('Missing report fixture')
  task.report.status = 'cancelled'
  vi.mocked(commands.getCreationCheck).mockResolvedValue({
    status: 'ok',
    data: task,
  })
  const run = runner()
  const pending = run.run(assistant)
  expect(await run.run(assistant)).toBeNull()
  await run.cancel()
  start.resolve({ status: 'ok', data: 'check-1' })
  expect(await pending).toEqual(task)
  expect(commands.startAssistantCheck).toHaveBeenCalledOnce()
  expect(commands.cancelCreationCheck).toHaveBeenCalledExactlyOnceWith(
    'check-1'
  )
  expect(commands.getCreationCheck).toHaveBeenCalledExactlyOnceWith(
    'owner',
    'check-1'
  )
})

it('disposal revokes publication and cancels a start reply arriving after unmount', async () => {
  const start =
    deferred<Awaited<ReturnType<typeof commands.startAssistantCheck>>>()
  vi.mocked(commands.startAssistantCheck).mockReturnValueOnce(start.promise)
  const publish = vi.fn()
  const run = runner()
  const pending = run.run(assistant, { onTask: publish })
  await run.dispose()
  start.resolve({ status: 'ok', data: 'check-1' })
  expect(await pending).toBeNull()
  expect(commands.cancelCreationCheck).toHaveBeenCalledExactlyOnceWith(
    'check-1'
  )
  expect(commands.getCreationCheck).not.toHaveBeenCalled()
  expect(publish).not.toHaveBeenCalled()
})

it('ignores reports from a former workspace and cancels its own native task', async () => {
  const reply =
    deferred<Awaited<ReturnType<typeof commands.getCreationCheck>>>()
  vi.mocked(commands.getCreationCheck).mockReturnValueOnce(reply.promise)
  let current = true
  const run = runner(() => current)
  const publish = vi.fn()
  const pending = run.run(assistant, { onTask: publish })
  await vi.advanceTimersByTimeAsync(0)
  current = false
  reply.resolve({ status: 'ok', data: completed() })
  expect(await pending).toBeNull()
  expect(publish.mock.calls.every(([task]) => task.report === null)).toBe(true)
  expect(commands.cancelCreationCheck).toHaveBeenCalledExactlyOnceWith(
    'check-1'
  )
})

it.each(['workspace', 'task', 'report', 'progress'])(
  'refuses a mismatched %s in the native reply',
  async mismatch => {
    const task = completed()
    if (mismatch === 'workspace') task.identity = 'other'
    if (mismatch === 'task') task.taskId = 'other'
    if (mismatch === 'report' && task.report) task.report.taskId = 'other'
    if (mismatch === 'progress')
      task.progress = {
        taskId: 'other',
        projectPath: '/score',
        phase: 'health',
        path: null,
        copiedBytes: 0,
      }
    vi.mocked(commands.getCreationCheck).mockResolvedValueOnce({
      status: 'ok',
      data: task,
    })
    await expect(runner().run(assistant)).rejects.toMatchObject({
      error: { code: 'invalidIdentity' },
    })
    expect(commands.cancelCreationCheck).toHaveBeenCalledExactlyOnceWith(
      'check-1'
    )
  }
)

it('retains transient manual polling errors while collecting the final report', async () => {
  vi.mocked(commands.getCreationCheck).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'io', detail: 'temporary IPC failure' },
  })
  const onPollError = vi.fn()
  const pending = runner().run(
    { kind: 'manual', options: async () => options },
    { onPollError }
  )
  await vi.advanceTimersByTimeAsync(300)
  expect(await pending).toEqual(completed())
  expect(onPollError).toHaveBeenCalledExactlyOnceWith({
    code: 'io',
    detail: 'temporary IPC failure',
  })
  expect(commands.cancelCreationCheck).not.toHaveBeenCalled()
})

it('returns typed assistant polling failure and cancels the abandoned native check', async () => {
  vi.mocked(commands.getCreationCheck).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'permission', detail: 'access revoked' },
  })
  await expect(runner().run(assistant)).rejects.toMatchObject({
    error: { code: 'permission', detail: 'access revoked' },
  })
  expect(commands.cancelCreationCheck).toHaveBeenCalledExactlyOnceWith(
    'check-1'
  )
})

it('preserves native runtime refusal without starting or cancelling a different check', async () => {
  vi.mocked(commands.startAssistantCheck).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'runtimeBusy', detail: 'runtime lease belongs to CLI' },
  })
  await expect(runner().run(assistant)).rejects.toMatchObject({
    error: { code: 'runtimeBusy', detail: 'runtime lease belongs to CLI' },
  })
  expect(commands.startCreationCheck).not.toHaveBeenCalled()
  expect(commands.getCreationCheck).not.toHaveBeenCalled()
  expect(commands.cancelCreationCheck).not.toHaveBeenCalled()
})

it('never treats failed freshness verification as fresh and never submits a replacement check', async () => {
  const run = runner()
  expect(await run.freshness('saved-receipt')).toEqual({ status: 'fresh' })
  vi.mocked(commands.creationCheckIsStale).mockResolvedValueOnce({
    status: 'ok',
    data: true,
  })
  expect(await run.freshness('saved-receipt')).toEqual({ status: 'stale' })
  vi.mocked(commands.creationCheckIsStale).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'missing', detail: 'receipt disappeared' },
  })
  expect(await run.freshness('saved-receipt')).toEqual({
    status: 'unknown',
    error: { code: 'missing', detail: 'receipt disappeared' },
  })
  expect(commands.startCreationCheck).not.toHaveBeenCalled()
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
})

it('discards freshness arriving after another check begins', async () => {
  const freshness =
    deferred<Awaited<ReturnType<typeof commands.creationCheckIsStale>>>()
  vi.mocked(commands.creationCheckIsStale).mockReturnValueOnce(
    freshness.promise
  )
  const run = runner()
  const pending = run.freshness('old-receipt')
  await run.run(assistant)
  freshness.resolve({ status: 'ok', data: false })
  expect(await pending).toEqual({ status: 'unknown' })
})

it('shares focus and periodic freshness scheduling, coalesces overlap, and detaches cleanly', async () => {
  const freshness =
    deferred<Awaited<ReturnType<typeof commands.creationCheckIsStale>>>()
  vi.mocked(commands.creationCheckIsStale).mockReturnValueOnce(
    freshness.promise
  )
  const publish = vi.fn()
  const stop = runner().watchFreshness('saved-receipt', publish)
  window.dispatchEvent(new Event('focus'))
  window.dispatchEvent(new Event('focus'))
  expect(commands.creationCheckIsStale).toHaveBeenCalledOnce()
  freshness.resolve({ status: 'ok', data: false })
  await vi.advanceTimersByTimeAsync(0)
  expect(publish).toHaveBeenLastCalledWith({ status: 'fresh' })
  vi.mocked(commands.creationCheckIsStale).mockResolvedValue({
    status: 'ok',
    data: true,
  })
  await vi.advanceTimersByTimeAsync(10000)
  expect(publish).toHaveBeenLastCalledWith({ status: 'stale' })
  stop()
  const calls = publish.mock.calls.length
  window.dispatchEvent(new Event('focus'))
  await vi.advanceTimersByTimeAsync(20000)
  expect(publish).toHaveBeenCalledTimes(calls)
  expect(commands.creationCheckIsStale).toHaveBeenCalledTimes(2)
})

it.each(['detach', 'dispose'])(
  '%s prevents publication of a late freshness result',
  async removal => {
    const freshness =
      deferred<Awaited<ReturnType<typeof commands.creationCheckIsStale>>>()
    vi.mocked(commands.creationCheckIsStale).mockReturnValueOnce(
      freshness.promise
    )
    const publish = vi.fn()
    const run = runner()
    const stop = run.watchFreshness('saved-receipt', publish)
    if (removal === 'dispose') await run.dispose()
    else stop()
    freshness.resolve({ status: 'ok', data: false })
    await vi.advanceTimersByTimeAsync(20000)
    expect(publish).not.toHaveBeenCalled()
    expect(commands.creationCheckIsStale).toHaveBeenCalledOnce()
  }
)

it('disposal wakes progress polling without publishing a fabricated cleanup report', async () => {
  const run = runner()
  const publish = vi.fn()
  vi.mocked(commands.getCreationCheck).mockResolvedValue({
    status: 'ok',
    data: { ...completed(), report: null },
  })
  const pending = run.run(assistant, { onTask: publish })
  await vi.advanceTimersByTimeAsync(0)
  expect(run.active).toBe(true)
  await run.dispose()
  expect(await pending).toBeNull()
  window.dispatchEvent(new Event('focus'))
  await vi.advanceTimersByTimeAsync(20000)
  expect(commands.getCreationCheck).toHaveBeenCalledOnce()
  expect(commands.cancelCreationCheck).toHaveBeenCalledExactlyOnceWith(
    'check-1'
  )
  expect(commands.creationCheckIsStale).not.toHaveBeenCalled()
  expect(publish.mock.calls.every(([task]) => task.report === null)).toBe(true)
})
