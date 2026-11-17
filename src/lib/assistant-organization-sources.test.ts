import { beforeEach, expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  type AssistantContinuation,
  type AssistantDependencies,
} from './assistant-flow'
import { beginAssistantTask } from './assistant-task-tools'
import {
  deserializeAssistantContinuation,
  serializeAssistantContinuation,
} from './assistant-resume'
import { commands, type AssistantTask } from './tauri-bindings'
import type { OrganizationSource } from './assistant-organization'
import { HELP_BOOKS } from './help-corpus'
import { useCreationStore } from '@/store/creation-store'

beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'rules-owner',
        root: '/rules',
        name: 'Rules',
        source: 'folder',
      },
      files: [],
    },
  })
})

it.each(['project', 'material'] as const)(
  'refuses changed %s rules when a durable conflict task continues, before another paid turn or write',
  async kind => {
    const material = {
      id: 'a'.repeat(32),
      name: 'rules.txt',
      version: 'b'.repeat(64),
      size: 10,
      totalCharacters: 10,
    }
    const reference: OrganizationSource =
      kind === 'project'
        ? { kind, path: 'docs/rules.md', version: 'v1' }
        : {
            kind,
            id: material.id,
            version: material.version,
            name: material.name,
          }
    const task: AssistantTask = { id: 'rules-task', mode: 'edit', files: [] }
    const question = {
      id: 'rules-conflict',
      taskId: task.id,
      scope: { chatId: 'rules-chat', messageId: 'rules-reply' },
      prompt:
        'Rules conflict with preserving the work. Keep the original sound and only fix references?',
      options: [
        {
          id: 'preserve',
          label: 'Preserve the work',
          description: 'No sound or algorithm change.',
        },
      ],
      recommendedOptionId: 'preserve',
      status: 'pending' as const,
      answer: null,
    }
    let stale = false
    let calls = 0
    const snapshot = () => ({
      fingerprint: stale && kind === 'project' ? 'changed' : 'initial',
      files: [
        {
          path: 'docs/rules.md',
          version: stale && kind === 'project' ? 'v2' : 'v1',
          bytes: 10,
          reason: null,
        },
        { path: 'docs/unselected.md', version: 'v1', bytes: 10, reason: null },
      ],
    })
    vi.mocked(commands.beginCreationAssistantTask).mockImplementation(
      async () => ({ status: 'ok', data: structuredClone(task) })
    )
    vi.mocked(commands.askCreationAssistantQuestion).mockImplementation(
      async () => {
        task.questions = [question]
        return { status: 'ok', data: structuredClone(task) }
      }
    )
    const deps: AssistantDependencies = {
      begin: async (_, requestId) => ({
        requestId,
        model: 'scripted',
        baseUrl: 'http://local',
      }),
      cancel: async () => undefined,
      corpus: async () =>
        HELP_BOOKS.flatMap(book =>
          book.documentIds.map(id => ({
            id,
            path: `${id}.md`,
            markdown: `# ${id}\n\nLocal contract.`,
          }))
        ),
      task: beginAssistantTask,
      projectInventory: async () => snapshot(),
      listMaterials: async () => (stale ? [] : [material]),
      readMaterial: async () => ({
        material,
        text: 'Keep seed.',
        offset: 0,
        endOffset: 10,
        totalCharacters: 10,
        nextOffset: null,
        startLine: 1,
        endLine: 1,
      }),
      readProject: async (_, read) => ({
        path: read.path,
        version: 'v1',
        text: 'Keep seed.',
        offset: 0,
        endOffset: 10,
        totalCharacters: 10,
        nextOffset: null,
        startLine: 1,
        endLine: 1,
      }),
      turn: async () => {
        calls++
        return {
          text: '',
          toolCalls: [
            {
              id: 'conflict',
              name: 'ask_question',
              arguments: JSON.stringify({
                prompt: question.prompt,
                options: question.options,
                recommendedOptionId: 'preserve',
              }),
            },
          ],
        }
      },
    }
    let checkpoint: string | undefined
    const request = {
      identity: 'rules-owner',
      mode: 'edit' as const,
      input:
        'Organize under PNDS defaults and the selected rules; preserve the artwork.',
      organizationSources: [reference],
      projectReading: true,
      project: snapshot(),
      history: [],
      locale: 'en' as const,
      signal: new AbortController().signal,
      isCurrent: () => true,
      questionScope: question.scope,
      onContinuation: (value: AssistantContinuation | null) => {
        if (value) checkpoint = serializeAssistantContinuation(value)
      },
    }
    const waiting = await runAssistantRequest(request, deps)
    expect(waiting.question?.id).toBe(question.id)
    expect(calls).toBe(1)
    if (!checkpoint) throw new Error('Missing rules checkpoint')
    const restored = deserializeAssistantContinuation(checkpoint)
    if (!restored) throw new Error('Invalid rules checkpoint')
    expect(restored.organizationSources).toEqual([reference])
    if (kind === 'project') {
      await expect(
        runAssistantRequest(
          {
            ...request,
            organizationSources: [
              { kind: 'project', path: 'docs/unselected.md', version: 'v1' },
            ],
            continuation: restored,
          },
          deps
        )
      ).rejects.toMatchObject({ code: 'projectScopeChanged' })
      expect(calls).toBe(1)
    }
    stale = true
    task.questions = [
      {
        ...question,
        status: 'answered',
        answer: { optionId: 'preserve', text: null },
      },
    ]
    await expect(
      runAssistantRequest(
        { ...request, project: snapshot(), continuation: restored },
        deps
      )
    ).rejects.toMatchObject({ code: 'projectScopeChanged' })
    expect(calls).toBe(1)
    expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
    expect(commands.createCreationAssistantDirectory).not.toHaveBeenCalled()
  }
)

it('bounds multi-page rule checkpoints while retaining exact coverage and the original goal', async () => {
  const text = 'Keep the original artwork.\n'.repeat(14000)
  const snapshot = {
    fingerprint: 'large-rules',
    files: [
      {
        path: 'docs/rules.md',
        version: 'rules-v1',
        bytes: text.length,
        reason: null,
      },
    ],
  }
  const task: AssistantTask = { id: 'paged-rules', mode: 'edit', files: [] }
  const goal =
    'Organize saved files using PNDS defaults and the selected reference, preserving the original work.'
  const sizes: number[] = []
  const reads: number[] = []
  let boundary: AssistantContinuation | undefined
  vi.mocked(commands.beginCreationAssistantTask).mockResolvedValue({
    status: 'ok',
    data: task,
  })
  const result = await runAssistantRequest(
    {
      identity: 'rules-owner',
      mode: 'edit',
      input: goal,
      organizationSources: [
        { kind: 'project', path: 'docs/rules.md', version: 'rules-v1' },
      ],
      projectReading: true,
      project: snapshot,
      history: [],
      locale: 'en',
      signal: new AbortController().signal,
      isCurrent: () => true,
      onContinuation: value => {
        if (value) {
          sizes.push(
            new TextEncoder().encode(JSON.stringify(value.messages)).length
          )
          boundary = value
        }
      },
    },
    {
      begin: async (_, requestId) => ({
        requestId,
        model: 'scripted',
        baseUrl: 'http://local',
      }),
      cancel: async () => undefined,
      corpus: async () =>
        HELP_BOOKS.flatMap(book =>
          book.documentIds.map(id => ({
            id,
            path: `${id}.md`,
            markdown: `# ${id}\n\nLocal contract.`,
          }))
        ),
      task: beginAssistantTask,
      projectInventory: async () => snapshot,
      listMaterials: async () => [],
      readProject: async (_, read) => {
        reads.push(read.offset)
        const end = Math.min(text.length, read.offset + read.pageLength)
        return {
          path: read.path,
          version: 'rules-v1',
          text: text.slice(read.offset, end),
          offset: read.offset,
          endOffset: end,
          totalCharacters: text.length,
          nextOffset: end < text.length ? end : null,
          startLine: 1,
          endLine: 14000,
        }
      },
      turn: async (_, messages) => {
        expect(
          messages.some(
            message =>
              message.contextKind === 'input' && message.content === goal
          )
        ).toBe(true)
        expect(
          messages.some(message =>
            message.content?.includes('Omitted source text is not visible here')
          )
        ).toBe(true)
        return {
          text: 'Read the selected rules. No safe changes needed; artwork effects remain unverified.',
          toolCalls: [],
        }
      },
    }
  )
  expect(reads.length).toBeGreaterThan(8)
  expect(reads[0]).toBe(0)
  expect(Math.max(...sizes)).toBeLessThanOrEqual(256 * 1024)
  expect(result.sources.at(-1)?.project?.endOffset).toBe(text.length)
  if (!boundary) throw new Error('Missing paged boundary')
  const restored = deserializeAssistantContinuation(
    serializeAssistantContinuation(boundary)
  )
  expect(restored?.organizationSources).toEqual([
    { kind: 'project', path: 'docs/rules.md', version: 'rules-v1' },
  ])
})

it.each([false, true])(
  'retains original rules after a task-owned document change, or refuses omitted originals (%s)',
  async omitted => {
    const original = 'Keep seed.'
    let saved = original
    let version = 'v1'
    let calls = 0
    const task: AssistantTask = {
      id: 'owned-rule-task',
      mode: 'edit',
      files: [],
    }
    const snapshot = () => ({
      fingerprint: version,
      files: [
        { path: 'docs/rules.md', version, bytes: saved.length, reason: null },
      ],
    })
    vi.mocked(commands.beginCreationAssistantTask).mockImplementation(
      async () => ({ status: 'ok', data: structuredClone(task) })
    )
    vi.mocked(commands.assistantProjectInventory).mockImplementation(
      async () => ({ status: 'ok', data: snapshot() })
    )
    vi.mocked(commands.writeCreationAssistantFile).mockImplementation(
      async (_, __, write) => {
        expect(write.path).toBe('docs/rules.md')
        expect(write.version).toBe('v1')
        saved = write.text ?? ''
        version = 'v2'
        task.files = [{ path: write.path, created: false, undone: false }]
        return { status: 'ok', data: structuredClone(task) }
      }
    )
    const deps: AssistantDependencies = {
      begin: async (_, requestId) => ({
        requestId,
        model: 'scripted',
        baseUrl: 'http://local',
      }),
      cancel: async () => undefined,
      corpus: async () =>
        HELP_BOOKS.flatMap(book =>
          book.documentIds.map(id => ({
            id,
            path: `${id}.md`,
            markdown: `# ${id}\n\nLocal contract.`,
          }))
        ),
      task: beginAssistantTask,
      projectInventory: async () => snapshot(),
      listMaterials: async () => [],
      readProject: async (_, read) => ({
        path: read.path,
        version,
        text: saved,
        offset: 0,
        endOffset: saved.length,
        totalCharacters: saved.length,
        nextOffset: null,
        startLine: 1,
        endLine: 1,
      }),
      turn: async (_, messages) => {
        calls++
        if (calls === 1)
          return {
            text: '',
            toolCalls: [
              {
                id: 'owned-rule-write',
                name: 'write_project_file',
                arguments: JSON.stringify({
                  path: 'docs/rules.md',
                  version: 'v1',
                  text: 'Future rules require another explicit task.',
                }),
              },
            ],
          }
        const restoredOriginal = messages.flatMap(message => {
          try {
            const value = JSON.parse(message.content ?? '{}')
            return value.organizationReference?.version === 'v1' &&
              value.segments
              ? value.segments
              : []
          } catch {
            return []
          }
        })
        expect(restoredOriginal).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ version: 'v1', text: original }),
          ])
        )
        expect(
          messages.find(message => message.contextKind === 'input')?.content
        ).toBe(
          'Organize the existing project and maintain the selected document. Keep this same original rule version.'
        )
        return {
          text: 'Preserved original rules. Check blockers and artwork effects remain unverified.',
          toolCalls: [],
        }
      },
    }
    let checkpoint: string | undefined
    const pause = new AbortController()
    const request = {
      identity: 'rules-owner',
      mode: 'edit' as const,
      input:
        'Organize the existing project and maintain the selected document. Keep this same original rule version.',
      organizationSources: [
        { kind: 'project' as const, path: 'docs/rules.md', version: 'v1' },
      ],
      projectReading: true,
      project: snapshot(),
      history: [],
      locale: 'en' as const,
      signal: new AbortController().signal,
      isCurrent: () => true,
    }
    await expect(
      runAssistantRequest(
        {
          ...request,
          pauseSignal: pause.signal,
          onTask: current => {
            if (current.files.length) pause.abort()
          },
          onContinuation: value => {
            if (value) checkpoint = serializeAssistantContinuation(value)
          },
        },
        deps
      )
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(version).toBe('v2')
    if (!checkpoint) throw new Error('Missing owned rules checkpoint')
    const restored = deserializeAssistantContinuation(checkpoint)
    if (!restored) throw new Error('Invalid owned rules checkpoint')
    // Compaction can omit old exchanges while the original exact sources remain.
    restored.messages = restored.messages.filter(
      message => message.role === 'system' || message.contextKind === 'input'
    )
    if (omitted) restored.sources = []
    const continuation = runAssistantRequest(
      { ...request, project: snapshot(), continuation: restored },
      deps
    )
    if (omitted) {
      await expect(continuation).rejects.toMatchObject({
        code: 'projectScopeChanged',
      })
      expect(calls).toBe(1)
    } else {
      await expect(continuation).resolves.toMatchObject({
        text: expect.stringContaining('Preserved original rules'),
      })
      expect(calls).toBeGreaterThan(1)
    }
    expect(commands.writeCreationAssistantFile).toHaveBeenCalledOnce()
  }
)
