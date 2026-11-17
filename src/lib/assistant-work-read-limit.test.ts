import { expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  type AssistantContinuation,
  type AssistantDependencies,
} from './assistant-flow'
import type { AssistantTaskRunner } from './assistant-task-tools'
import { createAssistantTaskChecksFixture } from '@/test/assistant-task-checks-fixture'
import type {
  AssistantProjectPage,
  AssistantProjectSnapshot,
  AssistantToolCall,
} from './tauri-bindings'
import type { AssistantWireMessage } from './assistant-types'
import { HELP_BOOKS } from './help-corpus'

const call = (
  id: string,
  name: string,
  args: Record<string, unknown>
): AssistantToolCall => ({
  id,
  name,
  arguments: JSON.stringify(args),
})

it('checkpoints a saved write and an over-limit project search before continuing the same task', async () => {
  const pages: AssistantProjectPage[] = Array.from(
    { length: 33 },
    (_, index) => ({
      path: `file-${index}.js`,
      version: 'v1',
      text: 'x',
      offset: 0,
      endOffset: 1,
      totalCharacters: 1,
      nextOffset: null,
      startLine: 1,
      endLine: 1,
    })
  )
  let snapshot: AssistantProjectSnapshot = {
    fingerprint: 'before',
    files: pages.map(page => ({
      path: page.path,
      version: page.version,
      bytes: 1,
      reason: null,
    })),
  }
  const task = {
    id: 'same-task',
    mode: 'edit' as const,
    files: [] as { path: string; created: boolean; undone: boolean }[],
  }
  const runner: AssistantTaskRunner = {
    task,
    checks: createAssistantTaskChecksFixture({
      identity: 'owner',
      task: () => runner.task,
      invokeProjectCheckTool: () => runner.execute('run_project_check', {}),
    }),
    close: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn(async name => {
      if (name === 'create_project_file') {
        task.files.push({ path: 'new.js', created: true, undone: false })
        snapshot = {
          fingerprint: 'after',
          files: [
            ...snapshot.files,
            { path: 'new.js', version: 'v2', bytes: 5, reason: null },
          ],
        }
        runner.checks.saved()
        return JSON.stringify({ status: 'saved', task, inventory: snapshot })
      }
      expect(name).toBe('run_project_check')
      return runner.checks.requested('project')
    }),
  }
  const packets: AssistantWireMessage[][] = []
  let turns = 0
  const taskBegin = vi.fn().mockResolvedValue(runner)
  const dependencies: AssistantDependencies = {
    begin: async (_, requestId) => ({
      requestId,
      model: 'test',
      baseUrl: 'http://local',
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
    corpus: async () =>
      HELP_BOOKS.flatMap(book =>
        book.documentIds.map(id => ({
          id,
          path: `${id}.md`,
          markdown: `# ${id}\n\nLocal contract.`,
        }))
      ),
    projectInventory: async () => snapshot,
    searchProject: async (_identity, _paths, query) => ({
      pages: query === 'x' ? pages : pages.slice(0, 1),
      skipped: [],
      searchedFiles: query === 'x' ? 33 : 1,
      remainingFiles: 0,
    }),
    task: taskBegin,
    turn: async (_, messages) => {
      packets.push(structuredClone(messages))
      if (turns++ === 0)
        return {
          text: '',
          toolCalls: [
            call('write', 'create_project_file', {
              path: 'new.js',
              text: 'hello',
            }),
            call('search', 'search_project_text', { query: 'x' }),
          ],
        }
      if (turns === 2)
        return {
          text: '',
          toolCalls: [
            call('search-after', 'search_project_text', { query: 'y' }),
          ],
        }
      return { text: 'Saved and checked.', toolCalls: [] }
    },
  }
  const checkpoints: AssistantContinuation[] = []
  const initial = structuredClone(snapshot)
  const request = {
    identity: 'owner',
    mode: 'edit' as const,
    input: 'Create the file and inspect the project.',
    history: [],
    locale: 'en' as const,
    signal: new AbortController().signal,
    isCurrent: () => true,
    projectReading: true,
    project: initial,
    onContinuation: (value: AssistantContinuation | null) => {
      if (value) checkpoints.push(value)
    },
  }
  await expect(
    runAssistantRequest(request, dependencies)
  ).rejects.toMatchObject({ code: 'budgetExceeded' })
  const continuation = checkpoints.at(-1)
  expect(continuation).toBeDefined()
  if (!continuation) throw new Error('Missing completed checkpoint')
  const exchange = continuation.messages.slice(-3)
  expect(exchange[0]?.toolCalls?.map(item => item.id)).toEqual([
    'write',
    'search',
  ])
  expect(exchange.slice(1).map(item => item.toolCallId)).toEqual([
    'write',
    'search',
  ])
  expect(JSON.parse(exchange[1]?.content ?? '{}')).toMatchObject({
    status: 'saved',
  })
  expect(JSON.parse(exchange[2]?.content ?? '{}')).toMatchObject({
    status: 'refused',
    reason: 'projectReadLimit',
  })
  expect(continuation.projectFingerprint).toBe('after')
  continuation.interruption = 'budgetExceeded'
  const result = await runAssistantRequest(
    { ...request, continuation },
    dependencies
  )
  expect(result.text).toBe('Saved and checked.')
  expect(
    vi
      .mocked(runner.execute)
      .mock.calls.filter(([name]) => name === 'create_project_file')
  ).toHaveLength(1)
  expect(taskBegin.mock.calls[1]?.[2]).toBe('same-task')
  expect(packets[1]?.some(message => message.toolCallId === 'write')).toBe(true)
  expect(
    packets[2]?.some(message => message.toolCallId === 'search-after')
  ).toBe(true)
  expect(
    JSON.parse(
      packets[2]?.find(message => message.toolCallId === 'search-after')
        ?.content ?? '{}'
    ).segments
  ).toHaveLength(1)
})
