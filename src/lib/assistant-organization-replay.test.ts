import type { OrganizationSource } from './assistant-organization'
/// <reference types="node" />
import { createContext, runInContext } from 'node:vm'
import { beforeEach, expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  type AssistantDependencies,
  type AssistantContinuation,
} from './assistant-flow'
import {
  serializeAssistantContinuation,
  deserializeAssistantContinuation,
} from './assistant-resume'
import { beginAssistantTask } from './assistant-task-tools'
import {
  commands,
  type AssistantTask,
  type AssistantToolCall,
  type ControlledCheckReport,
} from './tauri-bindings'
import { HELP_BOOKS } from './help-corpus'
import i18n from '@/i18n/config'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'

beforeEach(() => {
  vi.clearAllMocks()
  useCreationFilesStore.getState().clear()
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'organization-replay',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
      directories: ['public'],
    },
  })
  useSessionStore.setState({ sessionStatus: 'idle', runId: 1 })
})

function call(
  name: string,
  args: Record<string, unknown>,
  id: string
): AssistantToolCall {
  return { name, arguments: JSON.stringify(args), id }
}

it.each([
  { repair: true, sourceKind: 'default' },
  { repair: false, sourceKind: 'default' },
  { repair: true, sourceKind: 'text' },
  { repair: true, sourceKind: 'project' },
  { repair: true, sourceKind: 'material' },
] as const)(
  'organizes references with $sourceKind rules, preserves art, repairs checks when possible ($repair) and restores the task',
  async ({ repair, sourceKind }) => {
    // The model is scripted; saved module loading and resource resolution execute.
    const originalSource = `const palette = loadText(new URL('./palette.txt', import.meta.url));
const art = { seed: 17, pulse: 0.125, color: '#c75b91', midi: 48 };
function generate(seed) { return (seed * 13 + 7) % 31; }
render({ value: generate(art.seed), pulse: art.pulse, color: art.color, hz: 440 * 2 ** ((art.midi - 69) / 12), palette });`
    const files = new Map([
      [
        'manifest.json',
        {
          text: '{"scoreServer":{"entry":"server.js"}}',
          version: 'manifest-v1',
        },
      ],
      ['server.js', { text: 'serveStatic("public");', version: 'server-v1' }],
      [
        'public/monitor.html',
        {
          text: '<script type="module" src="./sketch-copy.js"></script>',
          version: 'entry-v1',
        },
      ],
      ['public/sketch-copy.js', { text: originalSource, version: 'art-v1' }],
      ['public/palette.txt', { text: 'indigo', version: 'palette-v1' }],
      [
        'public/unused.js',
        {
          text: '// Dynamically selected by the performer; retain without usage evidence.',
          version: 'unused-v1',
        },
      ],
      [
        'sound.scd',
        {
          text: 'SynthDef(\\tone, { Out.ar(0, SinOsc.ar(130.8127826502993) * 0.125) }).add;',
          version: 'sound-v1',
        },
      ],
    ])
    const rulesText =
      sourceKind === 'project'
        ? 'Keep the script directly under public. Keep sound.scd unchanged. TODO: redesign colors later.'
        : sourceKind === 'material'
          ? 'Change the generation seed and recolor the work while tidying. TODO: optimize its sound engine.'
          : 'Group the original script under public/score. Do not change public/monitor.html. Keep sound.scd unchanged.'
    if (sourceKind === 'project')
      files.set('docs/organization.md', {
        text: rulesText,
        version: 'rules-v1',
      })
    const material = {
      id: 'c'.repeat(32),
      name: 'organization.txt',
      version: 'd'.repeat(64),
      size: rulesText.length,
      totalCharacters: rulesText.length,
    }
    const organizationSources: OrganizationSource[] =
      sourceKind === 'project'
        ? [
            {
              kind: 'project',
              path: 'docs/organization.md',
              version: 'rules-v1',
            },
          ]
        : sourceKind === 'material'
          ? [
              {
                kind: 'material',
                id: material.id,
                version: material.version,
                name: material.name,
              },
            ]
          : []
    const before = structuredClone(files)
    const task: AssistantTask = {
      id: 'organization-task',
      mode: 'edit',
      files: [],
    }
    const changes = new Map<
      string,
      { before?: { text: string; version: string }; after?: string }
    >()
    const directories = ['public']
    let revision = 1
    const inventory = () => ({
      fingerprint: `revision-${revision}`,
      files: [...files].map(([path, file]) => ({
        path,
        version: file.version,
        bytes: file.text.length,
        reason: null,
      })),
    })
    const record = (path: string, text?: string) => {
      const original = changes.has(path)
        ? changes.get(path)?.before
        : files.get(path)
      changes.set(path, { before: original, after: text })
      revision++
      if (text === undefined) files.delete(path)
      else files.set(path, { text, version: `saved-${revision}` })
      task.files = [
        ...task.files.filter(file => file.path !== path),
        {
          path,
          created: !original,
          removed: text === undefined,
          undone: false,
        },
      ]
      return { status: 'ok' as const, data: structuredClone(task) }
    }
    vi.mocked(commands.beginCreationAssistantTask).mockResolvedValue({
      status: 'ok',
      data: task,
    })
    vi.mocked(commands.assistantProjectInventory).mockImplementation(
      async () => ({ status: 'ok', data: inventory() })
    )
    vi.mocked(commands.readCreationFile).mockImplementation(async (_, path) => {
      const file = files.get(path)
      return file
        ? { status: 'ok', data: { kind: 'text', ...file } }
        : { status: 'error', error: { code: 'missing', detail: path } }
    })
    vi.mocked(commands.pollCreationChanges).mockImplementation(async () => ({
      status: 'ok',
      data: {
        revision,
        changed: [],
        directories,
        files: [...files].map(([path, file]) => ({
          path,
          kind: 'text',
          category: 'pages',
          size: file.text.length,
        })),
      },
    }))
    vi.mocked(commands.createCreationAssistantDirectory).mockImplementation(
      async (_, taskId, path) => {
        expect(taskId).toBe(task.id)
        directories.push(path)
        task.files.push({ path, created: true, undone: false, directory: true })
        return { status: 'ok', data: structuredClone(task) }
      }
    )
    vi.mocked(commands.writeCreationAssistantFile).mockImplementation(
      async (_, taskId, write) => {
        expect(taskId).toBe(task.id)
        expect(write.version).toBe(files.get(write.path)?.version ?? null)
        expect(write.text).toBeDefined()
        return record(write.path, write.text ?? undefined)
      }
    )
    vi.mocked(commands.removeCreationAssistantFile).mockImplementation(
      async (_, taskId, path, version) => {
        expect(taskId).toBe(task.id)
        expect(version).toBe(files.get(path)?.version)
        return record(path)
      }
    )
    vi.mocked(commands.undoCreationAssistantTask).mockImplementation(
      async (_, taskId) => {
        expect(taskId).toBe(task.id)
        if (
          [...changes].some(
            ([path, change]) => files.get(path)?.text !== change.after
          )
        )
          return {
            status: 'error',
            error: { code: 'versionConflict', detail: 'Later creator changes' },
          }
        for (const [path, change] of changes) {
          if (change.before) files.set(path, change.before)
          else files.delete(path)
        }
        directories.splice(directories.indexOf('public/score'), 1)
        task.files = task.files.map(file => ({ ...file, undone: true }))
        return { status: 'ok', data: task }
      }
    )
    function executeSavedEntry() {
      const output: unknown[] = []
      const script = files
        .get('public/monitor.html')
        ?.text.match(/src="([^"]+)"/)?.[1]
      if (!script) throw new Error('Missing entry script')
      const url = new URL(script, 'http://score/public/monitor.html')
      const source = files.get(url.pathname.slice(1))?.text
      if (!source) throw new Error(`Missing module ${url.pathname}`)
      const context = createContext({
        URL,
        render: (value: unknown) => output.push(value),
        loadText: (resource: URL) => {
          const text = files.get(resource.pathname.slice(1))?.text
          if (text === undefined)
            throw new Error(`Missing resource ${resource.pathname}`)
          return text
        },
      })
      runInContext(
        source.replaceAll('import.meta.url', JSON.stringify(url.href)),
        context,
        { timeout: 100 }
      )
      return JSON.parse(JSON.stringify(output)) as unknown[]
    }
    const originalOutput = executeSavedEntry()
    expect(originalOutput).toEqual([
      {
        value: 11,
        pulse: 0.125,
        color: '#c75b91',
        hz: 130.8127826502993,
        palette: 'indigo',
      },
    ])
    const checks: { status: string; output?: unknown[]; error?: string }[] = []
    let report: ControlledCheckReport
    vi.mocked(commands.startAssistantCheck).mockImplementation(
      async (_, taskId) => {
        expect(taskId).toBe(task.id)
        let error: string | undefined
        let output: unknown[] | undefined
        try {
          output = executeSavedEntry()
        } catch (cause) {
          error = String(cause)
        }
        checks.push({ status: error ? 'failed' : 'passed', output, error })
        report = {
          schemaVersion: 1,
          checkerVersion: 'scripted-replay',
          taskId: `check-${checks.length}`,
          projectPath: '/score',
          mode: 'none',
          status: error ? 'failed' : 'passed',
          error: error ?? null,
          diagnostics: null,
          evidence: {
            sourceRoot: '/score',
            sourceIdentity: 'fixture',
            sharedSourceRoot: null,
            projectSha256: inventory().fingerprint,
            sharedSha256: null,
            projectFiles: [],
            sharedFiles: [],
            productionDependencies: [],
            installedPackages: [],
            sharedLibraries: [],
            git: { head: null, dirty: null, state: 'none', detail: null },
            changedDuringPreparation: false,
            scope: 'saved',
            notes: [],
          },
          freshness: { stale: false, complete: true, reasons: [] },
          environment: {
            nodeBinary: '/local/node',
            nodeVersion: null,
            outputDevice: null,
            sampleRate: null,
            channelPlan: null,
            oscTarget: null,
          },
          checks: [
            {
              code: 'savedModule',
              status: error ? 'failed' : 'passed',
              reason: error ?? 'Saved module and resource loaded',
            },
          ],
          health: null,
          outputTail: [],
          cleanup: {
            nodeConfirmed: true,
            audioConfirmed: true,
            temporaryFilesRemoved: true,
            errors: [],
          },
          unverified: [
            'visualEffects',
            'sound',
            'performerInteraction',
            'artisticEquivalence',
          ],
        }
        return { status: 'ok', data: report.taskId }
      }
    )
    vi.mocked(commands.getCreationCheck).mockImplementation(
      async (_, taskId) => ({
        status: 'ok',
        data: {
          identity: 'organization-replay',
          taskId,
          progress: null,
          report,
        },
      })
    )
    vi.mocked(commands.creationCheckIsStale).mockResolvedValue({
      status: 'ok',
      data: false,
    })
    vi.mocked(commands.diagnoseCreationProject).mockImplementation(
      async () => ({
        status: 'ok',
        data: {
          schemaVersion: 1,
          checkerVersion: 'scripted-replay',
          projectPath: '/score',
          project: null,
          inputFingerprint: inventory().fingerprint,
          inputs: [],
          checks: [],
          issues: [],
          unverified: ['artisticEffects'],
          staticPassed: true,
        },
      })
    )
    const read = (path: string, id = path) =>
      call('read_project_text', { path }, `read-${id}`)
    const steps: AssistantToolCall[][] = [
      [...files.keys()].map(path => read(path)),
      [call('create_project_directory', { path: 'public/score' }, 'directory')],
      [
        call(
          'create_project_file',
          { path: 'public/score/pattern.js', text: originalSource },
          'move'
        ),
      ],
      [
        call(
          'write_project_file',
          {
            path: 'public/monitor.html',
            version: 'entry-v1',
            text: '<script type="module" src="./score/pattern.js"></script>',
          },
          'wire'
        ),
      ],
      [
        call(
          'remove_project_file',
          { path: 'public/sketch-copy.js', version: 'art-v1' },
          'remove'
        ),
      ],
      [call('run_project_check', {}, 'failed-check')],
    ]
    const hasConflict = sourceKind !== 'default'
    const question = {
      id: 'organization-conflict',
      taskId: task.id,
      scope: { chatId: 'organization-chat', messageId: 'organization-reply' },
      prompt:
        sourceKind === 'project'
          ? 'The project rules retain a top-level script, while this task requests public/score. May I move it with reference updates?'
          : sourceKind === 'material'
            ? 'The material requests generation and color changes, conflicting with artwork preservation. Keep the original artwork and only tidy references?'
            : 'Moving the script requires an entry reference update, but the text forbids editing monitor.html. Allow only this reference update?',
      options: [
        {
          id: 'preserve',
          label: 'Preserve the work and maintain references',
          description:
            'Only the necessary organization and entry/resource wiring; no algorithm, color or sound change.',
        },
      ],
      recommendedOptionId: 'preserve',
      status: 'pending' as const,
      answer: null,
    }
    if (hasConflict)
      steps.splice(1, 0, [
        call(
          'ask_question',
          {
            prompt: question.prompt,
            options: question.options,
            recommendedOptionId: 'preserve',
          },
          'organization-conflict'
        ),
        call(
          'create_project_directory',
          { path: 'public/premature' },
          'premature-before-answer'
        ),
      ])
    vi.mocked(commands.askCreationAssistantQuestion).mockImplementation(
      async (_, taskId, scope) => {
        expect(taskId).toBe(task.id)
        expect(scope).toEqual(question.scope)
        task.questions = [question]
        return { status: 'ok', data: structuredClone(task) }
      }
    )
    if (repair)
      steps.push(
        [read('public/score/pattern.js', 'moved')],
        [
          call(
            'write_project_file',
            {
              path: 'public/score/pattern.js',
              version: 'saved-2',
              text: originalSource.replace(
                "'./palette.txt'",
                "'../palette.txt'"
              ),
            },
            'repair'
          ),
        ],
        [call('run_project_check', {}, 'passed-check')]
      )
    const goal = [
      i18n.t('assistant.organization.task', { lng: 'en' }),
      ...(sourceKind !== 'default'
        ? [
            i18n.t('assistant.organization.rules.policy', { lng: 'en' }),
            JSON.stringify({
              text:
                sourceKind === 'text'
                  ? rulesText
                  : sourceKind === 'project'
                    ? 'Group the original script under public/score.'
                    : '',
              sources: organizationSources,
            }),
          ]
        : []),
    ].join('\n\n')
    let paidTurns = 0
    const dependencies: AssistantDependencies = {
      begin: async (_, requestId) => ({
        requestId,
        model: 'scripted',
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
      listMaterials: async () => (sourceKind === 'material' ? [material] : []),
      readMaterial: async (_, read) => ({
        material,
        text: rulesText.slice(read.offset, read.offset + read.pageLength),
        offset: read.offset,
        endOffset: Math.min(rulesText.length, read.offset + read.pageLength),
        totalCharacters: rulesText.length,
        nextOffset: null,
        startLine: 1,
        endLine: 1,
      }),
      readProject: async (_, read) => {
        const file = files.get(read.path)
        if (!file) throw new Error('Missing saved text')
        return {
          path: read.path,
          ...file,
          offset: 0,
          endOffset: file.text.length,
          totalCharacters: file.text.length,
          nextOffset: null,
          startLine: 1,
          endLine: file.text.split('\n').length,
        }
      },
      turn: async (_, messages) => {
        paidTurns++
        if (task.questions?.some(question => question.status === 'answered')) {
          expect(messages[0]?.content).toContain(
            'Preserve the artwork; only the necessary reference updates are allowed.'
          )
        }
        if (sourceKind === 'project' || sourceKind === 'material')
          expect(
            messages.some(
              message =>
                message.contextKind === 'projectFragment' &&
                message.content?.includes(rulesText)
            )
          ).toBe(true)
        expect(
          messages.find(message => message.contextKind === 'input')?.content
        ).toBe(goal)
        expect(messages[0]?.content).toContain(
          'Preserve source algorithms, composition, generation logic, artistic parameters, sound mappings, visual output and performer interaction'
        )
        const failed = messages.find(
          message => message.toolCallId === 'failed-check'
        )
        if (failed)
          expect(JSON.parse(failed.content ?? '{}')).toMatchObject({
            status: 'failed',
          })
        return {
          text: steps.length
            ? ''
            : repair
              ? 'PNDS defaults: moved the source, maintained entry and palette references; retained algorithms, parameters, sound mapping and unused.js. Saved-module checks passed after repairing the palette path. Visual, sound, performer effects and artistic equivalence remain unverified. Task and file undo are available.'
              : 'PNDS defaults: moved the source and updated the entry; the palette reference still fails its saved-module check. Changes are partial; visual, sound and performer effects remain unverified. Task and file undo are available.',
          toolCalls: steps.shift() ?? [],
        }
      },
    }
    const request = {
      identity: 'organization-replay',
      mode: 'edit' as const,
      input: goal,
      organizationSources,
      questionScope: question.scope,
      history: [],
      locale: 'en' as const,
      signal: new AbortController().signal,
      isCurrent: () => true,
      projectReading: true,
      project: inventory(),
    }
    let savedCheckpoint: string | undefined
    const restoredCheckpoint = () => {
      if (!savedCheckpoint) throw new Error('Missing organization checkpoint')
      const restored = deserializeAssistantContinuation(savedCheckpoint)
      if (!restored) throw new Error('Invalid organization checkpoint')
      return restored
    }
    if (hasConflict) {
      const waiting = await runAssistantRequest(
        {
          ...request,
          onContinuation: current => {
            if (current)
              savedCheckpoint = serializeAssistantContinuation(current)
          },
        },
        dependencies
      )
      expect(waiting.question?.id).toBe(question.id)
      expect(files).toEqual(before)
      expect(directories).toEqual(['public'])
      const boundary = restoredCheckpoint()
      expect(boundary.organizationSources).toEqual(organizationSources)
      const count = paidTurns
      const stillWaiting = await runAssistantRequest(
        { ...request, continuation: boundary },
        dependencies
      )
      expect(stillWaiting.question?.id).toBe(question.id)
      expect(paidTurns).toBe(count)
      task.questions = [
        {
          ...question,
          status: 'answered',
          answer: {
            optionId: null,
            text: 'Preserve the artwork; only the necessary reference updates are allowed.',
          },
        },
      ]
    }
    if (repair) {
      const pause = new AbortController()
      await expect(
        runAssistantRequest(
          {
            ...request,
            continuation: hasConflict ? restoredCheckpoint() : undefined,
            pauseSignal: pause.signal,
            onTask: current => {
              if (
                current.files.some(
                  file => file.path === 'public/score/pattern.js'
                )
              )
                pause.abort()
            },
            onContinuation: current => {
              if (current)
                savedCheckpoint = serializeAssistantContinuation(current)
            },
          },
          dependencies
        )
      ).rejects.toMatchObject({ code: 'cancelled' })
      expect(savedCheckpoint).toBeDefined()
    }
    const continuation: AssistantContinuation | undefined = savedCheckpoint
      ? (deserializeAssistantContinuation(savedCheckpoint) ?? undefined)
      : undefined
    if (repair) expect(continuation?.taskId).toBe('organization-task')
    const result = await runAssistantRequest(
      { ...request, continuation },
      dependencies
    )
    expect(checks.map(check => check.status)).toEqual(
      repair ? ['failed', 'passed'] : ['failed']
    )
    expect(checks[0]?.error).toContain('/public/score/palette.txt')
    if (repair) expect(checks[1]?.output).toEqual(originalOutput)
    expect(files.get('public/score/pattern.js')?.text).toBe(
      repair
        ? originalSource.replace("'./palette.txt'", "'../palette.txt'")
        : originalSource
    )
    expect(files.get('public/unused.js')).toEqual(
      before.get('public/unused.js')
    )
    expect(files.get('sound.scd')).toEqual(before.get('sound.scd'))
    expect(
      result.sources.some(source => source.project?.text === originalSource)
    ).toBe(true)
    if (sourceKind === 'project')
      expect(
        result.sources.some(
          source =>
            source.project?.path === 'docs/organization.md' &&
            source.project.text === rulesText
        )
      ).toBe(true)
    if (sourceKind === 'material')
      expect(
        result.sources.some(
          source =>
            source.material?.material.id === material.id &&
            source.material.text === rulesText
        )
      ).toBe(true)
    expect(result.text).toContain('PNDS defaults')
    expect(result.text).toContain('unverified')
    expect(result.text).toContain('undo')
    const undo = await commands.undoCreationAssistantTask(
      'organization-replay',
      task.id,
      null
    )
    expect(undo.status).toBe('ok')
    expect(files).toEqual(before)
    expect(directories).toEqual(['public'])
  }
)
