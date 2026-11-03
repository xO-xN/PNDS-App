/// <reference types="node" />
import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  type AssistantDependencies,
} from './assistant-flow'
import { beginAssistantTask } from './assistant-task-tools'
import {
  commands,
  type AssistantTask,
  type AssistantProjectSnapshot,
} from './tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { HELP_BOOKS } from './help-corpus'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('repairs a failed automatic compile in the same Work task without any user compile action', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const path = 'supercollider/source/pad.scd'
  let source = 'old pad'
  let version = 'v1'
  let task: AssistantTask = { id: 'pad-work', mode: 'edit', files: [] }
  const inventory = (): AssistantProjectSnapshot => ({
    fingerprint: version,
    files: [{ path, version, bytes: source.length, reason: null }],
  })
  useCreationFilesStore.getState().clear()
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'owner',
        root: '/fixture',
        name: 'Pad fixture',
        source: 'folder',
      },
      files: [],
    },
  })
  useSessionStore.setState({ sessionStatus: 'ready', runId: 1 })
  vi.spyOn(
    useCreationFilesStore.getState(),
    'synchronizeSaved'
  ).mockResolvedValue(true)
  vi.mocked(commands.beginCreationAssistantTask).mockResolvedValue({
    status: 'ok',
    data: task,
  })
  vi.mocked(commands.assistantProjectInventory).mockImplementation(
    async () => ({ status: 'ok', data: inventory() })
  )
  vi.mocked(commands.writeCreationAssistantFile).mockImplementation(
    async (_identity, taskId, write) => {
      expect(taskId).toBe('pad-work')
      expect(write.version).toBe(version)
      if (write.text == null) throw new Error('Missing saved fixture text')
      source = write.text
      version = version === 'v1' ? 'v2' : 'v3'
      task = { ...task, files: [{ path, created: false, undone: false }] }
      return { status: 'ok', data: task }
    }
  )
  let builds = 0
  vi.mocked(commands.getAssistantBuildState).mockImplementation(async () => ({
    status: 'ok',
    data: {
      needed: builds < 2,
      reason: builds < 2 ? 'sourceChanged' : null,
      receipt:
        builds < 2
          ? null
          : {
              inputs: [{ path, version }],
              artifacts: [
                {
                  path: 'supercollider/synthdefs/pad.scsyndef',
                  version: 'binary-v3',
                },
              ],
              report: {
                sclangPath: '/fixture/sclang',
                produced: ['pad.scsyndef'],
                references: [],
                output: '',
                error: null,
              },
            },
    },
  }))
  vi.mocked(commands.compileAssistantSynthdefs).mockImplementation(
    async (_identity, taskId) => {
      expect(taskId).toBe('pad-work')
      builds++
      return {
        status: 'ok',
        data: {
          task,
          status: builds === 1 ? 'failed' : 'succeeded',
          reused: false,
          inputs: [{ path, version }],
          artifacts:
            builds === 1
              ? []
              : [
                  {
                    path: 'supercollider/synthdefs/pad.scsyndef',
                    version: 'binary-v3',
                  },
                ],
          report: {
            sclangPath: '/fixture/sclang',
            produced: builds === 1 ? [] : ['pad.scsyndef'],
            references: [],
            output: '',
            error: builds === 1 ? 'pad.scd:1 syntax error' : null,
          },
        },
      }
    }
  )
  vi.mocked(commands.diagnoseCreationProject).mockResolvedValue({
    status: 'ok',
    data: {
      schemaVersion: 1,
      checkerVersion: 'fixture',
      projectPath: '/fixture',
      project: null,
      inputFingerprint: 'v3',
      inputs: [],
      checks: [],
      issues: [],
      unverified: ['sound'],
      staticPassed: true,
    },
  })
  vi.mocked(commands.inspectCreationRuntime).mockResolvedValue({
    status: 'ok',
    data: {
      generation: '1',
      passed: true,
      checks: [],
      performers: null,
      savedChangesVerified: false,
    },
  })
  let turn = 0
  const seenTools: string[] = []
  const call = (name: string, args: Record<string, unknown>) => {
    seenTools.push(name)
    return {
      text: null,
      toolCalls: [
        { id: `call-${turn}`, name, arguments: JSON.stringify(args) },
      ],
    }
  }
  const deps: AssistantDependencies = {
    begin: async (_, requestId) => ({
      requestId,
      model: 'scripted',
      baseUrl: 'https://fixture.invalid',
    }),
    corpus: async () =>
      HELP_BOOKS.flatMap(book =>
        book.documentIds.map(id => ({
          id,
          path: `${id}.md`,
          markdown: `# ${id}\n\nFixture contract.`,
        }))
      ),
    cancel: vi.fn().mockResolvedValue(undefined),
    task: beginAssistantTask,
    projectInventory: async () => inventory(),
    readProject: async () => ({
      path,
      version,
      text: source,
      offset: 0,
      endOffset: source.length,
      totalCharacters: source.length,
      nextOffset: null,
      startLine: 1,
      endLine: 1,
    }),
    turn: async (_, messages) => {
      switch (turn++) {
        case 0:
          return call('read_project_text', { path })
        case 1:
          return call('write_project_file', {
            path,
            version,
            text: 'broken continuous pad',
          })
        case 2:
          return { text: 'Source saved.', toolCalls: [] }
        case 3:
          expect(messages.at(-1)?.content).toContain('syntax error')
          return call('read_project_text', { path })
        case 4:
          return call('write_project_file', {
            path,
            version,
            text: 'valid continuous pad',
          })
        case 5:
          return { text: 'Repaired source saved.', toolCalls: [] }
        default:
          expect(messages.at(-1)?.content).toContain('partial')
          return {
            text: 'Saved and compiled; loading and sound behavior remain unverified.',
            toolCalls: [],
          }
      }
    },
  }
  const result = await runAssistantRequest(
    {
      identity: 'owner',
      mode: 'edit',
      input: 'Make the sound a continuous pad.',
      locale: 'en',
      history: [],
      projectReading: true,
      project: inventory(),
      signal: new AbortController().signal,
      isCurrent: () => true,
    },
    deps
  )
  expect(builds).toBe(2)
  expect(seenTools).not.toContain('compile_synthdefs')
  expect(commands.beginCreationAssistantTask).toHaveBeenCalledTimes(1)
  expect(result.checkOutcome).toMatchObject({
    taskId: 'pad-work',
    build: { status: 'passed' },
    runtime: { status: 'observed' },
    behavior: { status: 'notRun' },
  })
})
