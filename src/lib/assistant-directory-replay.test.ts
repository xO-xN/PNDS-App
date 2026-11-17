import { beforeEach, expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  type AssistantDependencies,
  type AssistantContinuation,
  type AssistantRequest,
} from './assistant-flow'
import { beginAssistantTask } from './assistant-task-tools'
import {
  commands,
  type AssistantTask,
  type AssistantToolCall,
} from './tauri-bindings'
import { HELP_BOOKS } from './help-corpus'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import {
  serializeAssistantContinuation,
  deserializeAssistantContinuation,
} from './assistant-resume'
import { seedCreationDraft } from '@/test/creation-files'

beforeEach(() => {
  vi.clearAllMocks()
  useCreationFilesStore.getState().clear()
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'directory-replay',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
      directories: [],
    },
  })
  useSessionStore.setState({ sessionStatus: 'ready', runId: 3 })
})

function call(
  name: string,
  args: Record<string, unknown>,
  id: string
): AssistantToolCall {
  return { name, arguments: JSON.stringify(args), id }
}

it.each(['discussion', 'edit'] as const)(
  'preserves a creator draft and refuses ungranted directory creation in %s mode',
  async mode => {
    const inventory = { fingerprint: 'untouched', files: [] }
    seedCreationDraft('public', 'saved source', 'v1')
    useCreationFilesStore.getState().edit('public', 'creator draft')
    vi.mocked(commands.beginCreationAssistantTask).mockResolvedValue({
      status: 'ok',
      data: { id: 'guarded-directory', mode, files: [] },
    })
    let turn = 0
    const deps: AssistantDependencies = {
      begin: async (_, requestId) => ({
        requestId,
        model: 'test',
        baseUrl: 'http://local',
      }),
      corpus: async () =>
        HELP_BOOKS.flatMap(book =>
          book.documentIds.map(id => ({
            id,
            path: `${id}.md`,
            markdown: `# ${id}\n\nLocal contract.`,
          }))
        ),
      cancel: vi.fn().mockResolvedValue(undefined),
      task: beginAssistantTask,
      projectInventory: async () => inventory,
      turn: async (_, messages) => {
        if (turn++ === 0)
          return {
            text: '',
            toolCalls: [
              call(
                'create_project_directory',
                { path: 'public/grid' },
                'guarded'
              ),
            ],
          }
        const receipt = JSON.parse(
          messages.find(message => message.toolCallId === 'guarded')?.content ??
            '{}'
        )
        expect(receipt).toMatchObject({ status: 'refused' })
        if (mode === 'edit') expect(receipt.reason).toBe('creatorDraft')
        return { text: 'No directory was created.', toolCalls: [] }
      },
    }
    await runAssistantRequest(
      {
        identity: 'directory-replay',
        mode,
        input: 'Prepare public/grid.',
        history: [],
        locale: 'en',
        signal: new AbortController().signal,
        isCurrent: () => true,
        projectReading: true,
        project: inventory,
      },
      deps
    )
    expect(commands.createCreationAssistantDirectory).not.toHaveBeenCalled()
    expect(useCreationFilesStore.getState().drafts.public?.text).toBe(
      'creator draft'
    )
    expect(useCreationStore.getState().workspace?.directories).toEqual([])
  }
)

it('reports verified partial directory progress after a native failure without claiming the requested child exists', async () => {
  const task: AssistantTask = {
    id: 'partial-directory-task',
    mode: 'edit',
    files: [],
  }
  const partial: AssistantTask = {
    ...task,
    files: [{ path: 'public', created: true, undone: false, directory: true }],
  }
  const inventory = { fingerprint: 'partial', files: [] }
  vi.mocked(commands.beginCreationAssistantTask).mockResolvedValue({
    status: 'ok',
    data: task,
  })
  vi.mocked(commands.createCreationAssistantDirectory).mockResolvedValue({
    status: 'error',
    error: { code: 'tooLarge', detail: 'public/grid' },
  })
  vi.mocked(commands.listCreationAssistantTasks).mockResolvedValue({
    status: 'ok',
    data: [partial],
  })
  vi.mocked(commands.assistantProjectInventory).mockResolvedValue({
    status: 'ok',
    data: inventory,
  })
  vi.mocked(commands.pollCreationChanges).mockResolvedValue({
    status: 'ok',
    data: { revision: 1, changed: [], files: [], directories: ['public'] },
  })
  vi.mocked(commands.diagnoseCreationProject).mockResolvedValue({
    status: 'ok',
    data: {
      schemaVersion: 1,
      checkerVersion: 'test',
      projectPath: '/score',
      project: null,
      inputFingerprint: 'partial',
      inputs: [],
      checks: [],
      issues: [],
      unverified: ['runtime'],
      staticPassed: false,
    },
  })
  let turn = 0
  const deps: AssistantDependencies = {
    begin: async (_, requestId) => ({
      requestId,
      model: 'test',
      baseUrl: 'http://local',
    }),
    corpus: async () =>
      HELP_BOOKS.flatMap(book =>
        book.documentIds.map(id => ({
          id,
          path: `${id}.md`,
          markdown: `# ${id}\n\nLocal contract.`,
        }))
      ),
    cancel: vi.fn().mockResolvedValue(undefined),
    task: beginAssistantTask,
    projectInventory: async () => inventory,
    turn: async (_, messages) => {
      if (turn++ === 0)
        return {
          text: '',
          toolCalls: [
            call(
              'create_project_directory',
              { path: 'public/grid' },
              'partial'
            ),
          ],
        }
      if (turn === 2) {
        const receipt = JSON.parse(
          messages.find(message => message.toolCallId === 'partial')?.content ??
            '{}'
        )
        expect(receipt).toMatchObject({
          status: 'refused',
          reason: 'tooLarge',
          task: partial,
          workspaceSync: 'synchronized',
        })
        expect(useCreationStore.getState().workspace?.directories).toEqual([
          'public',
        ])
        return {
          text: '',
          toolCalls: [call('run_project_check', {}, 'check-partial')],
        }
      }
      return {
        text: 'Created public. public/grid could not be created; the task remains recoverable.',
        toolCalls: [],
      }
    },
  }
  const result = await runAssistantRequest(
    {
      identity: 'directory-replay',
      mode: 'edit',
      input: 'Prepare public/grid.',
      history: [],
      locale: 'en',
      signal: new AbortController().signal,
      isCurrent: () => true,
      projectReading: true,
      project: inventory,
    },
    deps
  )
  expect(result.text).toContain('public/grid could not be created')
})

it.each([false, true])(
  'prepares directories and resumes the same task to save files, including a lost directory reply: %s',
  async lostReply => {
    const task: AssistantTask = {
      id: 'directory-task',
      mode: 'edit',
      files: [],
    }
    let directories: string[] = []
    let saved = false
    vi.mocked(commands.beginCreationAssistantTask).mockResolvedValue({
      status: 'ok',
      data: task,
    })
    const create = vi
      .mocked(commands.createCreationAssistantDirectory)
      .mockImplementation(async () => {
        directories = ['public', 'public/grid']
        task.files = directories.map(path => ({
          path,
          created: true,
          undone: false,
          directory: true,
        }))
        return { status: 'ok', data: structuredClone(task) }
      })
    vi.mocked(commands.writeCreationAssistantFile).mockImplementation(
      async (_, __, write) => {
        expect(directories).toContain('public/grid')
        expect(write).toMatchObject({
          path: 'public/grid/Grid.js',
          version: null,
          text: 'export const grid = 8;',
        })
        saved = true
        task.files.push({ path: write.path, created: true, undone: false })
        return { status: 'ok', data: structuredClone(task) }
      }
    )
    const inventory = () => ({
      fingerprint: saved ? 'saved' : 'initial',
      files: saved
        ? [
            {
              path: 'public/grid/Grid.js',
              bytes: 22,
              version: 'grid-v1',
              reason: null,
            },
          ]
        : [],
    })
    vi.mocked(commands.assistantProjectInventory).mockImplementation(
      async () => ({ status: 'ok', data: inventory() })
    )
    vi.mocked(commands.pollCreationChanges).mockImplementation(async () => ({
      status: 'ok',
      data: {
        revision: saved ? 2 : 1,
        changed: [],
        files: saved
          ? [
              {
                path: 'public/grid/Grid.js',
                kind: 'text',
                size: 22,
                category: 'pages',
              },
            ]
          : [],
        directories,
      },
    }))
    vi.mocked(commands.diagnoseCreationProject).mockResolvedValue({
      status: 'ok',
      data: {
        schemaVersion: 1,
        checkerVersion: 'test',
        projectPath: '/score',
        project: null,
        inputFingerprint: 'saved',
        inputs: [],
        checks: [],
        issues: [],
        unverified: ['runtime'],
        staticPassed: true,
      },
    })
    vi.mocked(commands.inspectCreationRuntime).mockResolvedValue({
      status: 'ok',
      data: {
        generation: '3',
        passed: true,
        checks: [],
        performers: null,
        savedChangesVerified: false,
      },
    })
    const turns: AssistantToolCall[][] = [
      [call('create_project_directory', { path: 'public/grid' }, 'directory')],
      [
        call(
          'create_project_file',
          { path: 'public/grid/Grid.js', text: 'export const grid = 8;' },
          'save'
        ),
      ],
      [call('run_project_check', {}, 'check')],
    ]
    const deps: AssistantDependencies = {
      begin: async (_, requestId) => ({
        requestId,
        model: 'test',
        baseUrl: 'http://local',
      }),
      corpus: async () =>
        HELP_BOOKS.flatMap(book =>
          book.documentIds.map(id => ({
            id,
            path: `${id}.md`,
            markdown: `# ${id}\n\nLocal contract.`,
          }))
        ),
      cancel: vi.fn().mockResolvedValue(undefined),
      task: beginAssistantTask,
      projectInventory: async () => inventory(),
      turn: async (_, messages) => {
        if (turns.length === 2) {
          if (lostReply) {
            const recovery = messages.find(message =>
              message.content?.includes('recoveredDirectories')
            )
            expect(JSON.parse(recovery?.content ?? '{}')).toMatchObject({
              recoveredDirectories: [
                { path: 'public', directory: true },
                { path: 'public/grid', directory: true },
              ],
            })
          } else {
            const receipt = messages.find(
              message => message.toolCallId === 'directory'
            )
            expect(JSON.parse(receipt?.content ?? '{}')).toMatchObject({
              status: 'saved',
              task: {
                files: [
                  { path: 'public', directory: true },
                  { path: 'public/grid', directory: true },
                ],
              },
            })
          }
          expect(useCreationStore.getState().workspace?.directories).toContain(
            'public/grid'
          )
        }
        return {
          text: turns.length
            ? ''
            : 'Created public/grid and saved Grid.js. Static checks passed; the existing runtime was observed.',
          toolCalls: turns.shift() ?? [],
        }
      },
    }
    const request: AssistantRequest = {
      identity: 'directory-replay',
      mode: 'edit',
      input: 'Prepare public/grid and save the Grid source there.',
      history: [],
      locale: 'en',
      signal: new AbortController().signal,
      isCurrent: () => true,
      projectReading: true,
      project: inventory(),
    }
    const pause = new AbortController()
    let checkpoint: AssistantContinuation | null = null
    let beforeDirectory: string | undefined
    await expect(
      runAssistantRequest(
        {
          ...request,
          pauseSignal: pause.signal,
          onTask: current => {
            if (current.files.some(file => file.directory)) pause.abort()
          },
          onContinuation: current => {
            if (current) {
              beforeDirectory ??= serializeAssistantContinuation(current)
              checkpoint = current
            }
          },
        },
        deps
      )
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(checkpoint).toMatchObject({ taskId: 'directory-task' })
    if (!checkpoint) throw new Error('Missing completed checkpoint')
    const recovered = deserializeAssistantContinuation(
      lostReply
        ? (beforeDirectory ?? '')
        : serializeAssistantContinuation(checkpoint)
    )
    expect(recovered).toBeTruthy()
    const result = await runAssistantRequest(
      { ...request, continuation: recovered ?? undefined },
      deps
    )
    expect(result.text).toContain('Created public/grid')
    expect(create).toHaveBeenCalledOnce()
    expect(saved).toBe(true)
  }
)
