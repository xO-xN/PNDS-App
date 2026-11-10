import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n/config'
import {
  commands,
  type HandoffComparison,
  type HandoffOperationProgress,
  type HandoffReceipt,
  type HandoffTask,
} from '@/lib/tauri-bindings'
import { notifications } from '@/lib/notifications'
import { useCreationStore } from './creation-store'
import { useCreationFilesStore } from './creation-files-store'
import { useCreationHandoffStore } from './creation-handoff-store'
import { useHandoffBaselinesStore } from './handoff-baselines-store'

const task: HandoffTask = {
  id: '701a5180-a2dd-47dc-9319-9312f3790f64',
  intent: 'Wire the sound',
  files: ['sound.wav'],
  acceptance: 'Check playback',
  status: 'pending',
}
const receipt: HandoffReceipt = {
  task,
  revision: 'r1',
  document: { text: 'Confirmed handoff', version: 'h2' },
  instructions: 'Implement the confirmed task',
  taskRecorded: true,
  baselineId: 'b1',
  baselineError: null,
}
const comparison: HandoffComparison = {
  baselineId: 'b1',
  task,
  revision: 'r1',
  capturedAt: 1,
  currentFingerprint: 'current',
  changes: [],
  baselineExcluded: [],
  currentExcluded: [],
  comparedFiles: 2,
}
const progress: HandoffOperationProgress = {
  phase: 'hashing',
  cancellable: true,
  path: 'sound.wav',
  bytesRead: 65536,
  bytesTotal: 1048576,
  files: 2,
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
async function dispatch() {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.useFakeTimers()
  useCreationStore.setState({ workspace: null })
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'feedback',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationFilesStore.getState().clear()
  useCreationHandoffStore.getState().clear()
  useCreationHandoffStore.setState({
    pending: [{ task, readme: false }],
    activeId: task.id,
    document: { text: '', version: 'h1' },
    review: {
      token: 'review',
      identity: 'feedback',
      task,
      revision: 'r1',
      document: { text: '', version: 'h1' },
      fingerprint: 'files',
    },
  })
  vi.mocked(commands.beginHandoffOperation).mockResolvedValue({
    status: 'ok',
    data: 'operation',
  })
  vi.mocked(commands.handoffOperationProgress).mockResolvedValue({
    status: 'ok',
    data: progress,
  })
  vi.mocked(commands.confirmCreationHandoff).mockResolvedValue({
    status: 'ok',
    data: receipt,
  })
  vi.mocked(commands.compareHandoffBaseline).mockResolvedValue({
    status: 'ok',
    data: comparison,
  })
  vi.mocked(commands.retryHandoffBaseline).mockResolvedValue({
    status: 'ok',
    data: receipt,
  })
  vi.mocked(commands.listHandoffBaselines).mockResolvedValue({
    status: 'ok',
    data: { baselines: [], usedBytes: 0, limitBytes: 268435456 },
  })
  vi.spyOn(useCreationFilesStore.getState(), 'poll').mockResolvedValue(true)
  for (const method of [
    'step',
    'succeed',
    'fail',
    'warn',
    'message',
    'dismiss',
  ] as const)
    vi.spyOn(notifications.flow, method).mockImplementation(() => undefined)
  vi.clearAllMocks()
})
afterEach(() => {
  useCreationHandoffStore.getState().clear()
  useHandoffBaselinesStore.getState().cancelComparison()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('keeps one pending notification through native registration, real file progress and the confirmed result', async () => {
  const registration =
    deferred<Awaited<ReturnType<typeof commands.beginHandoffOperation>>>()
  const confirmation =
    deferred<Awaited<ReturnType<typeof commands.confirmCreationHandoff>>>()
  vi.mocked(commands.beginHandoffOperation).mockReturnValue(
    registration.promise
  )
  vi.mocked(commands.confirmCreationHandoff).mockReturnValue(
    confirmation.promise
  )
  const recording = useCreationHandoffStore.getState().record()
  const id = vi.mocked(notifications.flow.step).mock.calls[0]?.[0]
  expect(id).toBeTruthy()
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  registration.resolve({ status: 'ok', data: 'operation' })
  await dispatch()
  expect(notifications.flow.step).toHaveBeenLastCalledWith(
    id,
    i18n.t('handoff.feedback.recording'),
    expect.stringContaining(
      i18n.t('handoff.feedback.currentFile', {
        path: 'sound.wav',
        read: 64,
        total: 1024,
      })
    )
  )
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  confirmation.resolve({ status: 'ok', data: receipt })
  await recording
  expect(notifications.flow.succeed).toHaveBeenCalledWith(
    id,
    i18n.t('creation.handoff.recorded'),
    undefined
  )
  expect(notifications.flow.dismiss).not.toHaveBeenCalledWith(id)
})

it('waits for the actual cancellation result instead of reporting success or cancelled on request', async () => {
  const confirmation =
    deferred<Awaited<ReturnType<typeof commands.confirmCreationHandoff>>>()
  vi.mocked(commands.confirmCreationHandoff).mockReturnValue(
    confirmation.promise
  )
  const recording = useCreationHandoffStore.getState().record()
  await dispatch()
  useCreationHandoffStore.getState().cancel()
  expect(commands.cancelHandoffOperation).toHaveBeenCalledWith('operation')
  expect(useCreationHandoffStore.getState().busy).toBe(true)
  expect(notifications.flow.message).not.toHaveBeenCalled()
  confirmation.resolve({
    status: 'error',
    error: { code: 'cancelled', detail: 'Cancelled' },
  })
  await recording
  expect(notifications.flow.message).toHaveBeenCalledWith(
    expect.any(String),
    i18n.t('handoff.operation.cancelled'),
    undefined
  )
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
})

it('does not cancel native work when the notification is dismissed', async () => {
  const confirmation =
    deferred<Awaited<ReturnType<typeof commands.confirmCreationHandoff>>>()
  vi.mocked(commands.confirmCreationHandoff).mockReturnValue(
    confirmation.promise
  )
  const recording = useCreationHandoffStore.getState().record()
  await dispatch()
  const id = vi.mocked(notifications.flow.step).mock.calls[0]?.[0]
  if (!id) throw new Error('Expected the active notification')
  notifications.flow.dismiss(id)
  expect(commands.cancelHandoffOperation).not.toHaveBeenCalled()
  expect(useCreationHandoffStore.getState().busy).toBe(true)
  confirmation.resolve({ status: 'ok', data: receipt })
  await recording
  expect(useCreationHandoffStore.getState().recorded).toBe(true)
})

it('finishes a preview with a neutral review-ready outcome without claiming a write', async () => {
  const preview =
    deferred<Awaited<ReturnType<typeof commands.previewCreationHandoff>>>()
  useCreationHandoffStore.setState({ review: null })
  vi.mocked(commands.previewCreationHandoff).mockReturnValue(preview.promise)
  const recording = useCreationHandoffStore.getState().record()
  expect(notifications.flow.message).not.toHaveBeenCalled()
  preview.resolve({
    status: 'ok',
    data: {
      token: 'review',
      identity: 'feedback',
      task,
      revision: 'r1',
      document: { text: '', version: 'h1' },
      fingerprint: 'files',
    },
  })
  await recording
  expect(notifications.flow.message).toHaveBeenCalledWith(
    expect.any(String),
    i18n.t('handoff.feedback.reviewReady'),
    undefined
  )
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
  expect(useCreationHandoffStore.getState().recorded).toBe(false)
})

it('retains the publishing phase and accepts the real successful result even when a cancellation request arrives too late', async () => {
  const confirmation =
    deferred<Awaited<ReturnType<typeof commands.confirmCreationHandoff>>>()
  vi.mocked(commands.confirmCreationHandoff).mockReturnValue(
    confirmation.promise
  )
  vi.mocked(commands.handoffOperationProgress).mockResolvedValue({
    status: 'ok',
    data: { ...progress, path: null, phase: 'publishing', cancellable: false },
  })
  const recording = useCreationHandoffStore.getState().record()
  await dispatch()
  expect(notifications.flow.step).toHaveBeenLastCalledWith(
    expect.any(String),
    i18n.t('handoff.feedback.recording'),
    i18n.t('handoff.operation.publishing')
  )
  expect(
    useCreationHandoffStore.getState().operationProgress?.cancellable
  ).toBe(false)
  useCreationHandoffStore.getState().cancel()
  expect(notifications.flow.message).not.toHaveBeenCalled()
  confirmation.resolve({ status: 'ok', data: receipt })
  await recording
  expect(notifications.flow.succeed).toHaveBeenCalled()
})

it('dismisses loading on owner replacement and ignores a late native success', async () => {
  const confirmation =
    deferred<Awaited<ReturnType<typeof commands.confirmCreationHandoff>>>()
  vi.mocked(commands.confirmCreationHandoff).mockReturnValue(
    confirmation.promise
  )
  const recording = useCreationHandoffStore.getState().record()
  await dispatch()
  const id = vi.mocked(notifications.flow.step).mock.calls[0]?.[0]
  useCreationStore.setState({ workspace: null })
  expect(notifications.flow.dismiss).toHaveBeenCalledWith(id)
  confirmation.resolve({ status: 'ok', data: receipt })
  await recording
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  expect(useCreationHandoffStore.getState().receipt).toBeNull()
})

it('reports a native failure in the same flow while retaining the local error', async () => {
  const error = { code: 'io' as const, detail: 'Storage unavailable' }
  vi.mocked(commands.confirmCreationHandoff).mockResolvedValue({
    status: 'error',
    error,
  })
  await useCreationHandoffStore.getState().record()
  expect(notifications.flow.fail).toHaveBeenCalledWith(
    expect.any(String),
    i18n.t('handoff.feedback.failed'),
    error.detail
  )
  expect(useCreationHandoffStore.getState().error).toEqual(error)
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
})

it.each(['baseline', 'refresh'] as const)(
  'warns after a recorded task when %s is incomplete',
  async problem => {
    if (problem === 'baseline')
      vi.mocked(commands.confirmCreationHandoff).mockResolvedValue({
        status: 'ok',
        data: {
          ...receipt,
          baselineId: null,
          baselineError: { code: 'io', detail: 'Baseline journal unavailable' },
        },
      })
    else
      vi.mocked(useCreationFilesStore.getState().poll).mockResolvedValue(false)
    await useCreationHandoffStore.getState().record()
    expect(useCreationHandoffStore.getState().recorded).toBe(true)
    expect(notifications.flow.warn).toHaveBeenCalled()
    expect(notifications.flow.fail).not.toHaveBeenCalled()
    expect(notifications.flow.succeed).not.toHaveBeenCalled()
  }
)

it('dismisses a cancelled comparison without publishing its late result', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof commands.compareHandoffBaseline>>>()
  vi.mocked(commands.compareHandoffBaseline).mockReturnValue(pending.promise)
  const comparing = useHandoffBaselinesStore.getState().compare('b1')
  await dispatch()
  const id = vi.mocked(notifications.flow.step).mock.calls[0]?.[0]
  useHandoffBaselinesStore.getState().cancelComparison()
  expect(notifications.flow.dismiss).toHaveBeenCalledWith(id)
  pending.resolve({ status: 'ok', data: comparison })
  await comparing
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  expect(useHandoffBaselinesStore.getState().comparison).toBeNull()
})

it('dismisses a pending baseline retry when the project is replaced', async () => {
  const retry =
    deferred<Awaited<ReturnType<typeof commands.retryHandoffBaseline>>>()
  vi.mocked(commands.retryHandoffBaseline).mockReturnValue(retry.promise)
  const retrying = useHandoffBaselinesStore.getState().retry('b1')
  const id = vi.mocked(notifications.flow.step).mock.calls[0]?.[0]
  useCreationStore.setState({ workspace: null })
  expect(notifications.flow.dismiss).toHaveBeenCalledWith(id)
  retry.resolve({ status: 'ok', data: receipt })
  await retrying
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  expect(useHandoffBaselinesStore.getState().receipt).toBeNull()
})

it('keeps a baseline retry pending until its catalog refresh actually completes', async () => {
  const catalog =
    deferred<Awaited<ReturnType<typeof commands.listHandoffBaselines>>>()
  vi.mocked(commands.listHandoffBaselines).mockReturnValueOnce(catalog.promise)
  const retrying = useHandoffBaselinesStore.getState().retry('b1')
  const id = vi.mocked(notifications.flow.step).mock.calls[0]?.[0]
  await dispatch()
  expect(useHandoffBaselinesStore.getState().receipt).toEqual(receipt)
  expect(useHandoffBaselinesStore.getState().busy).toBe(true)
  expect(notifications.flow.step).toHaveBeenLastCalledWith(
    id,
    i18n.t('handoff.feedback.retrying'),
    i18n.t('handoff.feedback.refreshing')
  )
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  await useHandoffBaselinesStore.getState().retry('b1')
  expect(commands.retryHandoffBaseline).toHaveBeenCalledTimes(1)
  catalog.resolve({
    status: 'ok',
    data: { baselines: [], usedBytes: 0, limitBytes: 268435456 },
  })
  await retrying
  expect(notifications.flow.succeed).toHaveBeenCalledWith(
    id,
    i18n.t('creation.handoff.recorded'),
    undefined
  )
  expect(useHandoffBaselinesStore.getState().busy).toBe(false)
})

it.each(['result', 'transport'] as const)(
  'preserves a successful retry receipt and warns when the catalog refresh fails via %s',
  async failure => {
    const catalog =
      deferred<Awaited<ReturnType<typeof commands.listHandoffBaselines>>>()
    vi.mocked(commands.listHandoffBaselines).mockReturnValueOnce(
      catalog.promise
    )
    const retrying = useHandoffBaselinesStore.getState().retry('b1')
    const id = vi.mocked(notifications.flow.step).mock.calls[0]?.[0]
    await dispatch()
    if (failure === 'result')
      catalog.resolve({
        status: 'error',
        error: { code: 'io', detail: 'Catalog unavailable' },
      })
    else catalog.reject(new Error('Catalog unavailable'))
    await retrying
    expect(notifications.flow.warn).toHaveBeenCalledWith(
      id,
      i18n.t('handoff.feedback.refreshFailed'),
      undefined
    )
    expect(notifications.flow.succeed).not.toHaveBeenCalled()
    expect(notifications.flow.fail).not.toHaveBeenCalled()
    expect(useHandoffBaselinesStore.getState().receipt).toEqual(receipt)
    expect(useHandoffBaselinesStore.getState().error?.detail).toBe(
      'Catalog unavailable'
    )
    expect(useHandoffBaselinesStore.getState().busy).toBe(false)

    // The pending catalog card may still offer Retry. Its native publication
    // already has a complete receipt, so recover only the failed read.
    await useHandoffBaselinesStore.getState().retry('b1')
    expect(commands.retryHandoffBaseline).toHaveBeenCalledTimes(1)
    expect(commands.listHandoffBaselines).toHaveBeenCalledTimes(2)
    expect(notifications.flow.succeed).toHaveBeenCalledWith(
      expect.any(String),
      i18n.t('creation.handoff.recorded'),
      undefined
    )
    expect(useHandoffBaselinesStore.getState().receipt).toEqual(receipt)
  }
)

it('dismisses a retry during catalog refresh and ignores that refresh after owner replacement', async () => {
  const catalog =
    deferred<Awaited<ReturnType<typeof commands.listHandoffBaselines>>>()
  vi.mocked(commands.listHandoffBaselines).mockReturnValueOnce(catalog.promise)
  const retrying = useHandoffBaselinesStore.getState().retry('b1')
  const id = vi.mocked(notifications.flow.step).mock.calls[0]?.[0]
  await dispatch()
  useCreationStore.setState({ workspace: null })
  expect(notifications.flow.dismiss).toHaveBeenCalledWith(id)
  catalog.resolve({
    status: 'ok',
    data: { baselines: [], usedBytes: 0, limitBytes: 268435456 },
  })
  await retrying
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  expect(notifications.flow.warn).not.toHaveBeenCalled()
  expect(useHandoffBaselinesStore.getState().receipt).toBeNull()
  expect(useHandoffBaselinesStore.getState().catalog).toBeNull()
})

it('does not describe an unrecorded retry receipt as recorded during catalog refresh', async () => {
  const failure = { code: 'io' as const, detail: 'Task publication failed' }
  vi.mocked(commands.retryHandoffBaseline).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...receipt,
      taskRecorded: false,
      baselineId: null,
      baselineError: failure,
    },
  })
  await useHandoffBaselinesStore.getState().retry('b1')
  expect(notifications.flow.step).not.toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    i18n.t('handoff.feedback.refreshing')
  )
  expect(notifications.flow.fail).toHaveBeenCalledWith(
    expect.any(String),
    i18n.t('handoff.feedback.failed'),
    failure.detail
  )
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
})
