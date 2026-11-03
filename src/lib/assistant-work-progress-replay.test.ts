import { expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  type AssistantContinuation,
  type AssistantDependencies,
  type AssistantRequest,
} from './assistant-flow'
import { HELP_BOOKS } from './help-corpus'
import {
  deserializeAssistantContinuation,
  serializeAssistantContinuation,
} from './assistant-resume'
import type { AssistantTaskRunner } from './assistant-task-tools'
import { createAssistantTaskChecksFixture } from '@/test/assistant-task-checks-fixture'
import type { AssistantWireMessage } from './assistant-types'
import type {
  AssistantProjectSnapshot,
  AssistantTask,
  AssistantToolCall,
} from './tauri-bindings'

function tool(name: string, id: string, args: Record<string, unknown> = {}) {
  return {
    text: null,
    toolCalls: [{ name, id, arguments: JSON.stringify(args) }],
  }
}

function work() {
  let saved = 0
  const snapshot = (): AssistantProjectSnapshot => ({
    fingerprint: `saved-${saved}`,
    files: [
      { path: 'score.js', version: `v${saved}`, bytes: 16, reason: null },
    ],
  })
  const task: AssistantTask = {
    id: 'same-score-task',
    mode: 'edit',
    files: [],
  }
  const runner: AssistantTaskRunner = {
    task,
    checks: createAssistantTaskChecksFixture({
      identity: 'progress-owner',
      task: () => runner.task,
      invokeProjectCheckTool: () => runner.execute('run_project_check', {}),
    }),
    close: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn(async name => {
      if (name === 'write_project_file') {
        saved++
        task.files = [{ path: 'score.js', created: false, undone: false }]
        runner.checks.saved()
        return JSON.stringify({ status: 'saved', task, inventory: snapshot() })
      }
      if (name === 'run_project_check') {
        return runner.checks.requested('project')
      }
      throw new Error(`Unexpected test operation: ${name}`)
    }),
  }
  const deps: AssistantDependencies = {
    begin: vi.fn(async (_, requestId) => ({
      requestId,
      model: 'test-model',
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
  let checkpoint: AssistantContinuation | undefined
  const request: AssistantRequest = {
    identity: 'progress-owner',
    mode: 'edit',
    input: 'Save the requested ten-voice score.',
    history: [],
    locale: 'en',
    projectReading: true,
    project: snapshot(),
    signal: new AbortController().signal,
    isCurrent: () => true,
    onContinuation: value => {
      if (value) checkpoint = value
    },
  }
  const lastCheckpoint = () => {
    if (!checkpoint) throw new Error('Missing complete task checkpoint')
    return checkpoint
  }
  return { deps, request, runner, snapshot, lastCheckpoint }
}

function expectCompleteGroups(checkpoint: AssistantContinuation) {
  const pending = new Set<string>()
  for (const message of checkpoint.messages) {
    for (const call of message.toolCalls ?? []) pending.add(call.id)
    if (message.role === 'tool')
      expect(pending.delete(message.toolCallId ?? '')).toBe(true)
  }
  expect(pending.size).toBe(0)
}

it('pauses repeated inventory calls with a complete same-task checkpoint', async () => {
  const h = work()
  let calls = 0
  h.deps.turn = vi.fn(async () =>
    tool('list_project_files', `inventory-${++calls}`)
  )
  await expect(runAssistantRequest(h.request, h.deps)).rejects.toMatchObject({
    code: 'noProgress',
  })
  expect(h.deps.turn).toHaveBeenCalledTimes(3)
  const checkpoint = h.lastCheckpoint()
  expect(checkpoint.taskId).toBe('same-score-task')
  expect(checkpoint.progress?.idleTurns).toBe(3)
  expect(checkpoint.calls).toHaveLength(3)
  expectCompleteGroups(checkpoint)
  expect(
    deserializeAssistantContinuation(serializeAssistantContinuation(checkpoint))
      ?.taskId
  ).toBe('same-score-task')
  expect(h.runner.execute).not.toHaveBeenCalled()
})

it('pauses twelve different empty searches before the model-call stage limit', async () => {
  const h = work()
  let calls = 0
  h.deps.turn = vi.fn(async () => {
    calls++
    return tool('search_help', `search-${calls}`, {
      query: `unfindable-query-${calls}`,
    })
  })
  await expect(runAssistantRequest(h.request, h.deps)).rejects.toMatchObject({
    code: 'noProgress',
  })
  expect(h.deps.turn).toHaveBeenCalledTimes(12)
  expect(h.deps.begin).toHaveBeenCalledOnce()
  const checkpoint = h.lastCheckpoint()
  expect(checkpoint.progress?.idleTurns).toBe(12)
  expect(checkpoint.calls).toHaveLength(12)
  expectCompleteGroups(checkpoint)
})

it('retains a complete tool group when the document reader itself rejects repeated searches', async () => {
  const h = work()
  let calls = 0
  h.deps.turn = vi.fn(async () => {
    calls++
    return {
      text: null,
      toolCalls: [
        ...tool('search_help', `repeat-${calls}`, {
          query: 'same-missing-query',
        }).toolCalls,
        ...tool('list_project_files', `inventory-${calls}`).toolCalls,
      ],
    }
  })
  await expect(runAssistantRequest(h.request, h.deps)).rejects.toMatchObject({
    code: 'noProgress',
  })
  const checkpoint = h.lastCheckpoint()
  expect(h.deps.turn).toHaveBeenCalledTimes(3)
  expect(
    checkpoint.messages.find(message => message.toolCallId === 'repeat-3')
  ).toMatchObject({ content: expect.stringContaining('"reason":"noProgress"') })
  expect(
    checkpoint.messages.some(message => message.toolCallId === 'inventory-3')
  ).toBe(true)
  expectCompleteGroups(checkpoint)
  expect(
    deserializeAssistantContinuation(serializeAssistantContinuation(checkpoint))
  ).not.toBeNull()
})

it('continues after a progress pause using the same saved task without replaying its write', async () => {
  const h = work()
  let calls = 0
  const write: AssistantToolCall = {
    id: 'save-once',
    name: 'write_project_file',
    arguments: JSON.stringify({
      path: 'score.js',
      version: 'v0',
      edits: [{ oldText: 'const voices = 1', newText: 'const voices = 10' }],
    }),
  }
  h.deps.turn = vi.fn(async () => {
    calls++
    return calls === 1
      ? { text: null, toolCalls: [write] }
      : tool('list_project_files', `inventory-${calls}`)
  })
  await expect(runAssistantRequest(h.request, h.deps)).rejects.toMatchObject({
    code: 'noProgress',
  })
  const paused = h.lastCheckpoint()
  paused.interruption = 'noProgress'
  expect(paused.taskId).toBe('same-score-task')
  expect(paused.needsCheck).toBe(true)
  expect(paused.projectSnapshot?.fingerprint).toBe('saved-1')
  expectCompleteGroups(paused)
  const restored = deserializeAssistantContinuation(
    serializeAssistantContinuation(paused)
  )
  if (!restored) throw new Error('Failed to restore paused Work task')
  h.deps.turn = vi.fn(async (_, messages: AssistantWireMessage[]) => {
    expect(messages.some(message => message.toolCallId === 'save-once')).toBe(
      true
    )
    expect(messages[0]?.content).toContain(
      'Continue this task after noProgress'
    )
    return { text: 'The ten-voice score is saved and checked.', toolCalls: [] }
  })
  await expect(
    runAssistantRequest(
      { ...h.request, project: h.snapshot(), continuation: restored },
      h.deps
    )
  ).resolves.toMatchObject({
    text: 'The ten-voice score is saved and checked.',
  })
  expect(h.deps.task).toHaveBeenLastCalledWith(
    'progress-owner',
    'edit',
    'same-score-task',
    expect.any(AbortSignal),
    undefined,
    h.request.input
  )
  expect(h.runner.execute).toHaveBeenCalledTimes(2)
  expect(h.runner.execute).toHaveBeenNthCalledWith(
    1,
    'write_project_file',
    expect.any(Object)
  )
  expect(h.runner.execute).toHaveBeenNthCalledWith(2, 'run_project_check', {})
  expect(h.snapshot().fingerprint).toBe('saved-1')
  expect(h.lastCheckpoint().stage?.index).toBe(1)
})
