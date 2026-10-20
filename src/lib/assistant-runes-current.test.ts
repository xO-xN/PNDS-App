/// <reference types="node" />
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
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
import {
  commands,
  type AssistantProjectSnapshot,
  type AssistantTask,
  type ParameterRequest,
  type ParameterSpec,
} from './tauri-bindings'
import { HELP_BOOKS } from './help-corpus'
import type { AssistantWireMessage } from './assistant-types'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'

// Explicit private acceptance input only. The original directory is read-only;
// every native saved-file operation below targets a disposable in-memory copy.
// Provider turns and native diagnostics are controlled, not a model-quality,
// runtime, rendering or latency benchmark. Private source is never checked in.
const projectDirectory = process.env.PNDS_HARNESS_REPLAY_PROJECT
const paths = [
  'server.js',
  'manifest.json',
  'package.json',
  'pnds.preview.json',
  'public/monitor.js',
  'public/monitor.html',
  'public/monitor.css',
  'public/performer.html',
  'public/Pattern.js',
  'public/pnds-preview.mjs',
]
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Required real-score fixture is missing')
  return value
}

it.skipIf(!projectDirectory)(
  'replays the current real runes parameter edit and private DeepSeek reasoning across restart without changing the original project',
  async () => {
    const directory = required(projectDirectory)
    const original = new Map(
      paths.map(path => [path, readFileSync(resolve(directory, path), 'utf8')])
    )
    const hashesBefore = new Map(
      [...original].map(([path, text]) => [path, digest(text)])
    )
    const saved = new Map(
      [...original].map(([path, text]) => [
        path,
        { text, version: digest(text) },
      ])
    )
    const contract = JSON.parse(
      required(original.get('pnds.preview.json'))
    ) as { schemaVersion: number; parameters: ParameterSpec[] }
    expect(contract.schemaVersion).toBe(1)
    const target = required(
      contract.parameters.find(
        spec => spec.id === 'pointNumberScale' && spec.kind === 'number'
      )
    )
    const readLiteral = (text: string, spec: ParameterSpec) => {
      const lines = text
        .split(/\r?\n/)
        .filter(
          line => line.startsWith(spec.prefix) && line.endsWith(spec.suffix)
        )
      expect(lines).toHaveLength(1)
      return JSON.parse(
        required(lines[0]).slice(spec.prefix.length, -spec.suffix.length)
      ) as string | number | boolean
    }
    const source = required(original.get(target.path))
    const current = readLiteral(source, target)
    expect(typeof current).toBe('number')
    const next = Number(
      (Number(current) + (target.limits.step ?? 0.01)).toFixed(4)
    )
    expect(next).toBeLessThanOrEqual(target.limits.max ?? Number.MAX_VALUE)
    const oldText = `${target.prefix}${JSON.stringify(current)}${target.suffix}`
    const newText = `${target.prefix}${JSON.stringify(next)}${target.suffix}`
    const candidate = source.replace(oldText, newText)
    const inventory = (): AssistantProjectSnapshot => ({
      fingerprint: digest(
        JSON.stringify([...saved].map(([path, file]) => [path, file.version]))
      ),
      files: [...saved].map(([path, file]) => ({
        path,
        version: file.version,
        bytes: Buffer.byteLength(file.text),
        reason: null,
      })),
    })
    let task: AssistantTask = {
      id: 'real-source-replay-task',
      mode: 'edit',
      files: [],
    }
    const pause = new AbortController()
    let checkpoint: AssistantContinuation | null = null
    vi.clearAllMocks()
    useCreationFilesStore.getState().clear()
    useCreationStore.setState({
      workspace: {
        project: {
          identity: 'read-only-real-replay',
          root: '/disposable-score-copy',
          name: 'Real source replay',
          source: 'folder',
        },
        files: [],
      },
    })
    useSessionStore.setState({ sessionStatus: 'ready', runId: 1 })
    vi.mocked(commands.beginCreationAssistantTask).mockImplementation(
      async () => ({ status: 'ok', data: structuredClone(task) })
    )
    vi.mocked(commands.assistantProjectInventory).mockImplementation(
      async () => ({ status: 'ok', data: inventory() })
    )
    vi.mocked(commands.readCreationFile).mockImplementation(
      async (_identity, path) => ({
        status: 'ok',
        data: { kind: 'text', ...required(saved.get(path)) },
      })
    )
    vi.mocked(commands.writeCreationAssistantFile).mockImplementation(
      async (_identity, taskId, write) => {
        expect(taskId).toBe(task.id)
        expect(write.path).toBe(target.path)
        expect(write.version).toBe(saved.get(target.path)?.version)
        expect(write.edits).toEqual([{ oldText, newText }])
        saved.set(target.path, { text: candidate, version: digest(candidate) })
        task = {
          ...task,
          files: [{ path: target.path, created: false, undone: false }],
        }
        pause.abort()
        return { status: 'ok', data: structuredClone(task) }
      }
    )
    vi.mocked(commands.bindCreationParameters).mockImplementation(
      async (_identity, path, version, text, parameters) => {
        expect(version).toBe(saved.get(path)?.version)
        expect(text).toBe(saved.get(path)?.text)
        return {
          status: 'ok',
          data: {
            partial: false,
            contractVersion: required(saved.get('pnds.preview.json')).version,
            parameters: parameters.map(request => ({
              request,
              value: readLiteral(text, request.spec),
            })),
          },
        }
      }
    )
    vi.mocked(commands.diagnoseCreationProject).mockResolvedValue({
      status: 'ok',
      data: {
        schemaVersion: 1,
        checkerVersion: 'controlled-native-boundary',
        projectPath: '/disposable-score-copy',
        project: null,
        inputFingerprint: 'changed-copy',
        inputs: [],
        checks: [],
        issues: [],
        staticPassed: true,
        unverified: ['runtime', 'pageRendering'],
      },
    })
    const deps: AssistantDependencies = {
      begin: async (_identity, requestId) => ({
        requestId,
        model: 'deepseek-flash',
        baseUrl: 'https://api.deepseek.com',
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
      corpus: async () =>
        HELP_BOOKS.flatMap(book =>
          book.documentIds.map(id => ({
            id,
            path: `${id}.md`,
            markdown: `# ${id}\n\nLocal contracts.`,
          }))
        ),
      task: beginAssistantTask,
      projectInventory: async () => inventory(),
      readProject: async (_identity, read) => {
        const file = required(saved.get(read.path))
        const endOffset = Math.min(
          file.text.length,
          read.offset + read.pageLength
        )
        return {
          path: read.path,
          version: file.version,
          source: 'saved',
          text: file.text.slice(read.offset, endOffset),
          offset: read.offset,
          endOffset,
          totalCharacters: file.text.length,
          nextOffset: endOffset < file.text.length ? endOffset : null,
          startLine: 1,
          endLine: file.text.split('\n').length,
        }
      },
      turn: vi.fn(),
    }
    const request = {
      identity: 'read-only-real-replay',
      mode: 'edit' as const,
      input: `将锚点数字字号从 ${current} 改为 ${next}，保留其他参数，并提供聊天推子。`,
      history: [],
      locale: 'en' as const,
      signal: new AbortController().signal,
      isCurrent: () => true,
      projectReading: true,
      project: inventory(),
    }
    let turn = 0
    deps.turn = vi.fn(async () =>
      turn++ === 0
        ? {
            text: '',
            reasoningContent: 'private read reasoning',
            toolCalls: [
              {
                id: 'read-actual-source',
                name: 'read_project_text',
                arguments: JSON.stringify({
                  path: target.path,
                  pageLength: 65536,
                }),
              },
            ],
          }
        : {
            text: '',
            reasoningContent: 'private save reasoning',
            toolCalls: [
              {
                id: 'save-copy-only',
                name: 'write_project_file',
                arguments: JSON.stringify({
                  path: target.path,
                  version: hashesBefore.get(target.path),
                  edits: [{ oldText, newText }],
                }),
              },
            ],
          }
    )
    try {
      await expect(
        runAssistantRequest(
          {
            ...request,
            pauseSignal: pause.signal,
            onContinuation: value => {
              if (value) checkpoint = value
            },
          },
          deps
        )
      ).rejects.toMatchObject({ code: 'cancelled' })
      const resumed = required(
        deserializeAssistantContinuation(
          serializeAssistantContinuation(
            required<AssistantContinuation>(checkpoint)
          )
        )
      )
      expect(
        resumed.messages
          .filter(message => message.role === 'assistant')
          .map(message => message.reasoningContent)
      ).toEqual(['private read reasoning', 'private save reasoning'])
      const parameters: ParameterRequest[] = contract.parameters
        .filter(spec => spec.path === target.path)
        .map(spec => ({
          spec,
          current: readLiteral(candidate, spec),
          suggestedMin: spec.limits.min ?? null,
          suggestedMax: spec.limits.max ?? null,
        }))
      let resumedTurns = 0
      deps.turn = vi.fn(
        async (_id: string, messages: AssistantWireMessage[]) => {
          expect(
            messages.filter(message =>
              message.toolCalls?.some(call => call.id === 'save-copy-only')
            )[0]?.reasoningContent
          ).toBe('private save reasoning')
          if (resumedTurns++ === 0)
            return {
              text: '',
              reasoningContent: 'private controls reasoning',
              toolCalls: [
                {
                  id: 'publish-current-contract',
                  name: 'expose_project_parameters',
                  arguments: JSON.stringify({
                    path: target.path,
                    version: digest(candidate),
                    parameters,
                  }),
                },
              ],
            }
          if (resumedTurns === 2)
            return {
              text: 'The requested size is saved.',
              reasoningContent: 'private check reasoning',
              toolCalls: [],
            }
          expect(messages.at(-1)?.content).toContain('blocked')
          return {
            text: 'Saved and exposed the size controls. Static checks passed; runtime verification is blocked by the active project.',
            reasoningContent: 'private final reasoning',
            toolCalls: [],
          }
        }
      )
      const result = await runAssistantRequest(
        { ...request, project: inventory(), continuation: resumed },
        deps
      )
      const control = required(
        result.proposals?.find(proposal => proposal.path === target.path)
      )
      expect(result.reasoningContent).toBe('private final reasoning')
      expect(result.text).not.toContain('private')
      expect(
        control.binding?.parameters.find(
          parameter => parameter.request.spec.id === target.id
        )?.value
      ).toBe(next)
      expect(control.parameters.map(parameter => parameter.spec.id)).toEqual(
        parameters.map(parameter => parameter.spec.id)
      )
      expect(control.text).toBe(candidate)
      expect(commands.writeCreationAssistantFile).toHaveBeenCalledOnce()
      expect(commands.diagnoseCreationProject).toHaveBeenCalledOnce()
      expect(commands.startAssistantCheck).not.toHaveBeenCalled()
      expect(saved.get('pnds.preview.json')?.text).toBe(
        original.get('pnds.preview.json')
      )
    } finally {
      for (const path of paths)
        expect(digest(readFileSync(resolve(directory, path), 'utf8'))).toBe(
          hashesBefore.get(path)
        )
    }
  }
)
