import { beforeEach, expect, it, vi } from 'vitest'
import type {
  GitMergeAssistantTask,
  GitMergeCandidate,
} from '@/lib/tauri-bindings'

const mocks = vi.hoisted(() => ({
  merge: {
    identity: 'physical',
    candidate: null as GitMergeCandidate | null,
    busy: false,
    saveAll: vi.fn(),
    refresh: vi.fn(),
  },
  tasks: vi.fn(),
  end: vi.fn(),
  undo: vi.fn(),
  answer: vi.fn(),
  cancel: vi.fn(),
  run: vi.fn(),
  register: vi.fn(),
}))
vi.mock('./creation-merge-store', () => ({
  useCreationMergeStore: { getState: () => mocks.merge },
  registerMergeAssistantStop: mocks.register,
}))
vi.mock('@/lib/assistant-flow', () => ({
  assistantModelTransport: { cancel: mocks.cancel },
}))
vi.mock('@/lib/merge-assistant-flow', () => ({
  runMergeAssistantRequest: mocks.run,
}))
vi.mock('@/lib/tauri-bindings', () => ({
  commands: {
    getGitMergeAssistantTasks: mocks.tasks,
    endGitMergeAssistant: mocks.end,
    undoGitMergeAssistant: mocks.undo,
    answerGitMergeQuestion: mocks.answer,
  },
}))
import { useMergeAssistantStore } from './merge-assistant-store'

const ok = <T>(data: T) => ({ status: 'ok' as const, data })
function candidate(): GitMergeCandidate {
  return {
    id: 'merge-1',
    revision: 1,
    relation: 'diverged',
    phase: 'active',
    source: 'source',
    target: 'target',
    base: 'base',
    branch: 'main',
    name: 'Merge',
    files: [],
    unresolved: 0,
    result: null,
    detail: null,
    assistantOwner: null,
    canUndo: false,
  }
}
function task(): GitMergeAssistantTask {
  return {
    id: 'round-1',
    candidateId: 'merge-1',
    revision: 1,
    writable: true,
    createdAt: 1,
    scope: { chatId: 'merge:merge-1', messageId: 'reply' },
    input: 'Keep both',
    response: '',
    state: 'waiting',
    checkpoint: '{}',
    requestId: 'old-provider-request',
    questions: [
      {
        id: 'q1',
        taskId: 'round-1',
        scope: { chatId: 'merge:merge-1', messageId: 'reply' },
        prompt: 'Which rhythm?',
        options: [],
        recommendedOptionId: null,
        status: 'pending',
        answer: null,
      },
    ],
  }
}
beforeEach(async () => {
  mocks.merge.candidate = null
  await useMergeAssistantStore.getState().stop()
  vi.resetAllMocks()
  mocks.merge.candidate = candidate()
  mocks.merge.busy = false
  mocks.merge.saveAll.mockResolvedValue(undefined)
  mocks.merge.refresh.mockResolvedValue(undefined)
  mocks.tasks.mockResolvedValue(ok([]))
  mocks.cancel.mockResolvedValue(undefined)
  mocks.end.mockImplementation(async () => {
    mocks.merge.candidate = {
      ...candidate(),
      ...mocks.merge.candidate,
      assistantOwner: null,
    }
    return ok(mocks.merge.candidate)
  })
  useMergeAssistantStore.setState({
    scope: null,
    tasks: [],
    input: '',
    activeTaskId: null,
    phase: 'idle',
    response: '',
    loading: false,
    error: null,
  })
})

it('opens a restored owned round without starting or stopping any model request', async () => {
  mocks.merge.candidate = { ...candidate(), assistantOwner: 'round-1' }
  mocks.tasks.mockResolvedValue(ok([task()]))
  await useMergeAssistantStore.getState().activate('physical', 'merge-1')
  expect(useMergeAssistantStore.getState()).toMatchObject({
    phase: 'waiting',
    activeTaskId: 'round-1',
  })
  expect(mocks.run).not.toHaveBeenCalled()
  expect(mocks.end).not.toHaveBeenCalled()
  expect(mocks.cancel).not.toHaveBeenCalled()
})

it('saves manual candidate drafts before admission and does not start after a failed save', async () => {
  await useMergeAssistantStore.getState().activate('physical', 'merge-1')
  useMergeAssistantStore.getState().setInput('Keep both')
  mocks.merge.saveAll.mockRejectedValue(new Error('save failed'))
  await useMergeAssistantStore.getState().send()
  expect(mocks.merge.saveAll).toHaveBeenCalledOnce()
  expect(mocks.run).not.toHaveBeenCalled()
  expect(useMergeAssistantStore.getState()).toMatchObject({
    phase: 'idle',
    input: 'Keep both',
    error: 'save failed',
  })
})

it('cancels a persisted provider request and waits for native cleanup before handing off', async () => {
  mocks.merge.candidate = { ...candidate(), assistantOwner: 'round-1' }
  mocks.tasks.mockResolvedValue(ok([task()]))
  await useMergeAssistantStore.getState().activate('physical', 'merge-1')
  let release: () => void = () => undefined
  mocks.end.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        release = () => {
          mocks.merge.candidate = candidate()
          resolve(ok(mocks.merge.candidate))
        }
      })
  )
  const stopping = useMergeAssistantStore.getState().stop()
  await vi.waitFor(() => expect(mocks.end).toHaveBeenCalledOnce())
  expect(useMergeAssistantStore.getState().phase).toBe('stopping')
  expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith('old-provider-request')
  expect(mocks.cancel.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.end.mock.invocationCallOrder[0] ?? Infinity
  )
  release()
  await stopping
  expect(useMergeAssistantStore.getState().phase).toBe('idle')
})

it('waits for a question answer already in flight and does not resume it after Stop', async () => {
  mocks.merge.candidate = { ...candidate(), assistantOwner: 'round-1' }
  mocks.tasks.mockResolvedValue(ok([task()]))
  await useMergeAssistantStore.getState().activate('physical', 'merge-1')
  let release: () => void = () => undefined
  mocks.answer.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        release = () =>
          resolve(ok({ ...task(), state: 'running', questions: [] }))
      })
  )
  const answer = useMergeAssistantStore
    .getState()
    .answer('q1', { optionId: null, text: 'Both' })
  const stopped = useMergeAssistantStore.getState().stop()
  let handedOff = false
  void stopped.then(() => {
    handedOff = true
  })
  await Promise.resolve()
  expect(handedOff).toBe(false)
  expect(useMergeAssistantStore.getState().phase).toBe('stopping')
  release()
  await Promise.all([answer, stopped])
  expect(mocks.run).not.toHaveBeenCalled()
  expect(mocks.end).toHaveBeenCalledOnce()
})

it('starts native drain while a local check is pending, then waits for its callback', async () => {
  await useMergeAssistantStore.getState().activate('physical', 'merge-1')
  useMergeAssistantStore.getState().setInput('Check this candidate')
  let release: () => void = () => undefined
  const check = new Promise<void>(resolve => {
    release = resolve
  })
  mocks.run.mockImplementationOnce(async request => {
    mocks.merge.candidate = { ...candidate(), assistantOwner: 'round-1' }
    const running = { ...task(), state: 'running', questions: [] }
    mocks.tasks.mockResolvedValue(ok([running]))
    request.onTask(running)
    await check
    throw new Error('cancelled')
  })
  mocks.end.mockImplementationOnce(async () => {
    release()
    mocks.merge.candidate = candidate()
    mocks.tasks.mockResolvedValue(
      ok([{ ...task(), state: 'stopped', checkpoint: null }])
    )
    return ok(mocks.merge.candidate)
  })
  const sent = useMergeAssistantStore.getState().send()
  await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
  await useMergeAssistantStore.getState().stop()
  await sent
  expect(mocks.end).toHaveBeenCalledOnce()
  expect(useMergeAssistantStore.getState().phase).toBe('idle')
})

it('cancels orphan provider requests even if stale detection already cleared the core owner', async () => {
  mocks.merge.candidate = { ...candidate(), phase: 'stale' }
  mocks.tasks.mockResolvedValue(ok([task()]))
  await useMergeAssistantStore.getState().stop()
  expect(mocks.cancel).toHaveBeenCalledWith('old-provider-request')
  expect(mocks.end).toHaveBeenCalledWith('physical', 'merge-1', 'round-1')
})

it('flushes later manual drafts before whole-round undo and keeps a native refusal', async () => {
  mocks.merge.candidate = { ...candidate(), canUndo: true }
  await useMergeAssistantStore.getState().activate('physical', 'merge-1')
  mocks.merge.saveAll.mockImplementationOnce(async () => {
    mocks.merge.candidate = { ...candidate(), revision: 3, canUndo: true }
  })
  mocks.undo.mockResolvedValue({
    status: 'error',
    error: {
      code: 'versionConflict',
      detail: 'Later manual overlap; no files changed',
    },
  })
  await useMergeAssistantStore.getState().undo()
  expect(mocks.undo).toHaveBeenCalledExactlyOnceWith('physical', 'merge-1', 3)
  expect(useMergeAssistantStore.getState().error).toContain('no files changed')
})

it('does not send stale candidate commands during ordinary assistant cleanup', async () => {
  await useMergeAssistantStore.getState().activate('physical', 'merge-1')
  mocks.merge.candidate = null
  vi.clearAllMocks()
  await useMergeAssistantStore.getState().stop()
  expect(mocks.tasks).not.toHaveBeenCalled()
  expect(mocks.end).not.toHaveBeenCalled()
  expect(mocks.cancel).not.toHaveBeenCalled()
})
