import { expect, it, vi } from 'vitest'
import { runMergeAssistantRequest } from './merge-assistant-flow'
import type { MergeAssistantDependencies } from './merge-assistant-dependencies'
import type {
  GitMergeAssistantTask,
  GitMergeCandidate,
  GitMergeContent,
  AssistantModelTurn,
} from './tauri-bindings'

function fixture(fast = false) {
  let candidate: GitMergeCandidate = {
    id: 'merge-1',
    revision: 1,
    relation: fast ? 'fastForward' : 'diverged',
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
  let task: GitMergeAssistantTask = {
    id: 'round-1',
    candidateId: candidate.id,
    revision: 1,
    writable: !fast,
    createdAt: 1,
    scope: { chatId: 'merge:merge-1', messageId: 'reply' },
    input: 'Keep both musical choices',
    response: '',
    state: 'running',
    questions: [],
    checkpoint: null,
    requestId: null,
  }
  const read = vi.fn(
    async (): Promise<GitMergeContent> => ({
      path: 'score.js',
      side: 'result',
      exists: true,
      version: 'version-1',
      text: 'current',
      url: null,
      size: 7,
      mime: null,
      durationMs: null,
      sampleRate: null,
      channels: null,
      waveform: null,
    })
  )
  const write = vi.fn(async () => {
    candidate = { ...candidate, revision: candidate.revision + 1 }
    return candidate
  })
  const turn =
    vi.fn<
      (
        ...args: Parameters<MergeAssistantDependencies['model']['turn']>
      ) => Promise<AssistantModelTurn>
    >()
  const dependencies: MergeAssistantDependencies = {
    model: {
      begin: vi.fn(async (_identity, requestId) => ({
        requestId,
        model: 'fixture',
        baseUrl: 'https://model.invalid',
      })),
      turn,
      cancel: vi.fn(async () => undefined),
      measure: undefined,
      corpus: vi.fn(async () => []),
    },
    candidate: vi.fn(async () => candidate),
    refresh: vi.fn(async () => undefined),
    begin: vi.fn(async () => {
      candidate = { ...candidate, assistantOwner: fast ? null : task.id }
      return task
    }),
    update: vi.fn(async (_id, update) => {
      task = { ...task, ...update }
      return task
    }),
    end: vi.fn(async () => {
      candidate = { ...candidate, assistantOwner: null }
      return candidate
    }),
    tools: () => ({
      list: vi.fn(async () => ['score.js']),
      read,
      write,
      reports: vi.fn(),
      check: vi.fn(),
      question: vi.fn(async request => {
        const question = {
          id: 'q1',
          taskId: task.id,
          scope: task.scope,
          ...request,
          status: 'pending' as const,
          answer: null,
        }
        task = { ...task, state: 'waiting', questions: [question] }
        return question
      }),
    }),
  }
  const controller = new AbortController()
  const request = {
    identity: 'physical-identity',
    candidateId: candidate.id,
    input: task.input,
    questionScope: task.scope,
    locale: 'en' as const,
    signal: controller.signal,
    isCurrent: () => true,
    onTask: vi.fn(),
    onText: vi.fn(),
  }
  return {
    dependencies,
    request,
    controller,
    read,
    write,
    turn,
    task: () => task,
  }
}
const call = (id: string, name: string, args: unknown) => ({
  id,
  name,
  arguments: JSON.stringify(args),
})
const returned = (
  toolCalls: AssistantModelTurn['toolCalls'],
  text: string | null = null
): AssistantModelTurn => ({ toolCalls, text })

it('uses physical identity, candidate-only policy and explicit read-before-write tools', async () => {
  const f = fixture()
  f.turn
    .mockResolvedValueOnce(
      returned([
        call('read', 'read_merge_file', { side: 'result', path: 'score.js' }),
      ])
    )
    .mockResolvedValueOnce({
      ...returned([
        call('write', 'write_merge_file', {
          path: 'score.js',
          version: 'version-1',
          text: 'both',
        }),
      ]),
      reasoningContent: 'provider-private-replay',
    })
    .mockResolvedValueOnce(
      returned([], 'Saved the combined text; no merge has been published.')
    )
  await runMergeAssistantRequest(f.request, f.dependencies)
  expect(f.dependencies.model.begin).toHaveBeenCalledWith(
    'physical-identity',
    expect.any(String)
  )
  expect(f.write).toHaveBeenCalledExactlyOnceWith(
    'score.js',
    'version-1',
    'both'
  )
  expect(f.turn.mock.calls[2]?.[1][0]?.contextKind).toBe('mergePolicy')
  expect(
    f.turn.mock.calls[2]?.[1].some(
      message => message.reasoningContent === 'provider-private-replay'
    )
  ).toBe(true)
  expect(f.task()).toMatchObject({
    state: 'completed',
    checkpoint: null,
    requestId: expect.any(String),
  })
  expect(f.dependencies.end).toHaveBeenCalledExactlyOnceWith('round-1')
})

it('retains round ownership while awaiting a candidate-bound question and skips following writes', async () => {
  const f = fixture()
  f.turn.mockResolvedValueOnce(
    returned([
      call('question', 'ask_merge_question', {
        prompt: 'Which rhythm should remain?',
        options: [],
        recommendedOptionId: null,
      }),
      call('bad-late-write', 'write_merge_file', {
        path: 'score.js',
        version: 'version-1',
        text: 'guessed',
      }),
    ])
  )
  const result = await runMergeAssistantRequest(f.request, f.dependencies)
  expect(result.question).toMatchObject({
    taskId: 'round-1',
    scope: f.request.questionScope,
  })
  expect(f.write).not.toHaveBeenCalled()
  expect(f.dependencies.end).not.toHaveBeenCalled()
  expect(f.task().state).toBe('waiting')
  expect(f.task().checkpoint).toContain('awaitingCreatorAnswer')
  expect(f.dependencies.model.cancel).toHaveBeenCalled()
})

it('does not release candidate ownership before an in-flight native write settles on Stop', async () => {
  const f = fixture()
  let release: (value: GitMergeCandidate) => void = () => undefined
  let entered: () => void = () => undefined
  const enteredWrite = new Promise<void>(resolve => {
    entered = resolve
  })
  f.write.mockImplementationOnce(
    () =>
      new Promise<GitMergeCandidate>(resolve => {
        release = resolve
        entered()
      })
  )
  f.turn
    .mockResolvedValueOnce(
      returned([
        call('read', 'read_merge_file', { side: 'result', path: 'score.js' }),
      ])
    )
    .mockResolvedValueOnce(
      returned([
        call('write', 'write_merge_file', {
          path: 'score.js',
          version: 'version-1',
          text: 'completed native change',
        }),
      ])
    )
  const running = runMergeAssistantRequest(f.request, f.dependencies)
  await enteredWrite
  f.controller.abort()
  await Promise.resolve()
  expect(f.dependencies.end).not.toHaveBeenCalled()
  release({ id: 'merge-1', revision: 2 } as GitMergeCandidate)
  await expect(running).rejects.toMatchObject({ code: 'cancelled' })
  expect(f.task().state).toBe('stopped')
  expect(f.dependencies.end).toHaveBeenCalledExactlyOnceWith('round-1')
})

it('keeps fast-forward model packets read-only and rejects mutation tools', async () => {
  const f = fixture(true)
  f.turn
    .mockResolvedValueOnce(
      returned([
        call('write', 'write_merge_file', {
          path: 'score.js',
          version: 'version-1',
          text: 'bad',
        }),
      ])
    )
    .mockResolvedValueOnce(
      returned(
        [],
        'This exact incoming version can be reviewed, without editing it.'
      )
    )
  await runMergeAssistantRequest(f.request, f.dependencies)
  expect(f.write).not.toHaveBeenCalled()
  expect(f.turn.mock.calls[0]?.[1][0]?.contextKind).toBe('mergeReadPolicy')
  expect(f.dependencies.end).toHaveBeenCalledExactlyOnceWith('round-1')
})
