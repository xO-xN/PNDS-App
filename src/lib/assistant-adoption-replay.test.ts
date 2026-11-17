/// <reference types="node" />
import { createContext, runInContext } from 'node:vm'
import { beforeEach, expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  type AssistantDependencies,
} from './assistant-flow'
import { beginAssistantTask } from './assistant-task-tools'
import {
  commands,
  type AssistantTask,
  type AssistantToolCall,
  type AssistantQuestion,
  type ControlledCheckReport,
} from './tauri-bindings'
import type { AssistantContinuation } from './assistant-flow'
import { HELP_BOOKS } from './help-corpus'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'

beforeEach(() => {
  vi.clearAllMocks()
  useCreationFilesStore.getState().clear()
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'adoption-replay',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
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

it.each(['new', 'replace', 'coexist', 'freeText'] as const)(
  'integrates cooperating private sources through %s into the saved entry, repairs its check and preserves undo',
  async decision => {
    const originals = [
      {
        id: 'a'.repeat(32),
        name: 'Grid.js',
        text: 'class Grid { constructor(size) { this.size = size; } }',
      },
      {
        id: 'b'.repeat(32),
        name: 'Pattern.js',
        text: "class Pattern { constructor(grid) { this.grid = grid; } render() { return `grid${this.grid.size}:${loadText('./palette.txt')}`; } }",
      },
    ]
    const materials = originals.map((source, index) => ({
      id: source.id,
      name: source.name,
      version: String(index + 1).repeat(64),
      size: source.text.length,
      totalCharacters: source.text.length,
    }))
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
        { text: '<script src="./monitor.js"></script>', version: 'entry-v1' },
      ],
      [
        'public/monitor.js',
        { text: "draw('original-artwork');", version: 'monitor-v1' },
      ],
      ['public/assets/palette.txt', { text: 'indigo', version: 'palette-v1' }],
    ])
    const collisionPath = 'public/scores/Grid.js'
    let gridPath = collisionPath
    const questionScope = {
      chatId: 'adoption-chat',
      messageId: 'adoption-reply',
    }
    if (decision !== 'new')
      files.set(collisionPath, {
        text: 'class Grid { constructor(size) { this.size = 3; } }',
        version: 'creator-grid-v1',
      })
    const before = structuredClone(files)
    const changes = new Map<
      string,
      { before?: { text: string; version: string }; after: string }
    >()
    const directories = [
      'public',
      'public/assets',
      ...(decision === 'new' ? [] : ['public/scores']),
    ]
    let revision = 1
    const task: AssistantTask = { id: 'adoption-task', mode: 'edit', files: [] }
    const inventory = () => ({
      fingerprint: `revision-${revision}`,
      files: [...files].map(([path, file]) => ({
        path,
        version: file.version,
        bytes: file.text.length,
        reason: null,
      })),
    })
    const save = (path: string, text: string) => {
      const previous = files.get(path)
      changes.set(path, {
        before: changes.has(path) ? changes.get(path)?.before : previous,
        after: text,
      })
      files.set(path, { text, version: `saved-${++revision}` })
      task.files = [
        ...task.files.filter(file => file.path !== path),
        { path, created: !changes.get(path)?.before, undone: false },
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
        files: [...files].map(([path, file]) => ({
          path,
          kind: 'text',
          size: file.text.length,
          category: 'pages',
        })),
        directories,
      },
    }))
    vi.mocked(commands.createCreationAssistantDirectory).mockImplementation(
      async (_, taskId, path) => {
        expect(taskId).toBe(task.id)
        expect(path).toBe('public/scores')
        if (!directories.includes(path)) {
          directories.push(path)
          task.files.push({
            path,
            created: true,
            undone: false,
            directory: true,
          })
        }
        return { status: 'ok', data: structuredClone(task) }
      }
    )
    vi.mocked(commands.adoptCreationAssistantMaterial).mockImplementation(
      async (_, taskId, adoption) => {
        expect(taskId).toBe(task.id)
        expect(directories).toContain('public/scores')
        const index = materials.findIndex(
          material =>
            material.id === adoption.id && material.version === adoption.version
        )
        const source = originals[index]
        if (!source) throw new Error('No current private material')
        const existing = files.get(adoption.path)
        if (
          existing &&
          existing.text !== source.text &&
          adoption.path === collisionPath
        ) {
          let question = task.questions?.[0]
          if (!question) {
            question = {
              id: 'native-material-conflict',
              taskId: task.id,
              scope: questionScope,
              prompt: collisionPath,
              options: [
                { id: 'replace', label: collisionPath, description: '' },
                {
                  id: 'coexist',
                  label: 'public/scores/Grid-imported.js',
                  description: '',
                },
              ],
              recommendedOptionId: 'coexist',
              status: 'pending',
              answer: null,
              materialConflict: {
                materialId: adoption.id,
                materialVersion: adoption.version,
                path: collisionPath,
                targetVersion: existing.version,
                candidateSha256: 'c'.repeat(64),
                coexistPath: 'public/scores/Grid-imported.js',
                savedExcerpt: existing.text,
                candidateExcerpt: source.text,
                firstChangedLine: 1,
                truncated: false,
              },
            }
            task.questions = [question]
          }
          if (question.status === 'pending' || question.answer?.text)
            return { status: 'ok', data: structuredClone(task) }
          if (question.answer?.optionId === 'coexist')
            gridPath = question.materialConflict?.coexistPath ?? ''
          task.materialAdoptions = [
            {
              questionId: question.id,
              materialId: adoption.id,
              materialVersion: adoption.version,
              targetPath: collisionPath,
              path: gridPath,
              version: `saved-${revision + 1}`,
              candidateSha256: 'c'.repeat(64),
            },
          ]
          return save(gridPath, adoption.text ?? source.text)
        }
        expect(existing).toBeUndefined()
        return save(adoption.path, adoption.text ?? source.text)
      }
    )
    vi.mocked(commands.writeCreationAssistantFile).mockImplementation(
      async (_, taskId, write) => {
        expect(taskId).toBe(task.id)
        const file = files.get(write.path)
        expect(write.version).toBe(file?.version ?? null)
        let text = write.text ?? file?.text ?? ''
        for (const edit of write.edits ?? []) {
          expect(text.split(edit.oldText)).toHaveLength(2)
          text = text.replace(edit.oldText, edit.newText)
        }
        return save(write.path, text)
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
            error: {
              code: 'versionConflict',
              detail: 'Creator changed saved content',
            },
          }
        for (const [path, change] of changes) {
          if (change.before) files.set(path, change.before)
          else files.delete(path)
        }
        if (decision === 'new')
          directories.splice(directories.indexOf('public/scores'), 1)
        task.files = task.files.map(file => ({ ...file, undone: true }))
        return { status: 'ok', data: task }
      }
    )
    const executions: {
      scripts: string[]
      drawing: string[]
      resources: string[]
      error?: string
    }[] = []
    let checkReport: ControlledCheckReport
    vi.mocked(commands.diagnoseCreationProject).mockImplementation(
      async () => ({
        status: 'ok',
        data: {
          schemaVersion: 1,
          checkerVersion: 'replay',
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
    vi.mocked(commands.startAssistantCheck).mockImplementation(
      async (_, taskId) => {
        expect(taskId).toBe(task.id)
        const execution: (typeof executions)[number] = {
          scripts: [],
          drawing: [],
          resources: [],
        }
        const context = createContext({
          draw: (value: string) => execution.drawing.push(value),
          loadText: (route: string) => {
            const path = `public${new URL(route, 'http://score/monitor.html').pathname}`
            execution.resources.push(path)
            const text = files.get(path)?.text
            if (text === undefined)
              throw new Error(`Missing saved resource ${path}`)
            return text
          },
        })
        try {
          const entry = files.get('public/monitor.html')?.text ?? ''
          for (const match of entry.matchAll(
            /<script src="([^"]+)"><\/script>/g
          )) {
            const path = `public${new URL(match[1] ?? '', 'http://score/monitor.html').pathname}`
            execution.scripts.push(path)
            const saved = files.get(path)
            if (!saved) throw new Error(`Missing saved script ${path}`)
            runInContext(saved.text, context, { timeout: 100 })
          }
        } catch (error) {
          execution.error = String(error)
        }
        executions.push(execution)
        const checkId = `check-${executions.length}`
        checkReport = {
          schemaVersion: 1,
          checkerVersion: 'replay',
          taskId: checkId,
          projectPath: '/score',
          mode: 'none',
          status: execution.error ? 'failed' : 'passed',
          error: execution.error ?? null,
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
            nodeBinary: '/offline/node',
            nodeVersion: null,
            outputDevice: null,
            sampleRate: null,
            channelPlan: null,
            oscTarget: null,
          },
          checks: [
            {
              code: 'savedEntry',
              status: execution.error ? 'failed' : 'passed',
              reason:
                execution.error ??
                'New saved entry loaded Grid, Pattern and palette',
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
          unverified: ['sound', 'artisticEffects'],
        }
        return { status: 'ok', data: checkId }
      }
    )
    vi.mocked(commands.getCreationCheck).mockImplementation(
      async (_, taskId) => ({
        status: 'ok',
        data: {
          identity: 'adoption-replay',
          taskId,
          progress: null,
          report: checkReport,
        },
      })
    )
    vi.mocked(commands.creationCheckIsStale).mockResolvedValue({
      status: 'ok',
      data: false,
    })
    const read = (path: string) =>
      call('read_project_text', { path }, `read-${path}`)
    const adopt = (index: number) => {
      const material = materials[index]
      if (!material) throw new Error('Missing source fixture')
      return call(
        'adopt_creation_material',
        {
          id: material.id,
          version: material.version,
          path:
            index === 0 &&
            decision === 'freeText' &&
            task.questions?.[0]?.status === 'answered'
              ? gridPath
              : `public/scores/${material.name}`,
        },
        `adopt-${index}`
      )
    }
    const integrationCalls = (suffix: string) => [
      { ...adopt(0), id: `adopt-0-${suffix}` },
      { ...adopt(1), id: `adopt-1-${suffix}` },
      call(
        'write_project_file',
        {
          path: 'public/monitor.html',
          version: 'entry-v1',
          edits: [
            {
              oldText: '<script src="./monitor.js"></script>',
              newText: `<script src="./scores/${gridPath.split('/').pop()}"></script><script src="./scores/Pattern.js"></script><script src="./monitor.js"></script>`,
            },
          ],
        },
        `wire-entry-${suffix}`
      ),
      call(
        'write_project_file',
        {
          path: 'public/monitor.js',
          version: 'monitor-v1',
          edits: [
            {
              oldText: "draw('original-artwork');",
              newText:
                "draw('original-artwork'); draw(new Pattern(new Grid(8)).render());",
            },
          ],
        },
        `wire-drawing-${suffix}`
      ),
    ]
    const turns = [
      [
        call('list_creation_materials', {}, 'materials'),
        read('manifest.json'),
        read('server.js'),
        read('public/monitor.html'),
        read('public/monitor.js'),
      ],
      materials.map((material, index) =>
        call(
          'read_creation_material',
          { id: material.id, version: material.version },
          `material-${index}`
        )
      ),
      [
        call(
          'create_project_directory',
          { path: 'public/scores' },
          'directory'
        ),
      ],
      integrationCalls('initial'),
      [],
    ]
    let sawFailure = false
    const deps: AssistantDependencies = {
      begin: async (_, requestId) => ({
        requestId,
        model: 'replay',
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
      projectInventory: async () => inventory(),
      listMaterials: async () => materials,
      readMaterial: async (_, read) => {
        const index = materials.findIndex(
          material =>
            material.id === read.id && material.version === read.version
        )
        const material = materials[index]
        const source = originals[index]
        if (!material || !source) throw new Error('Missing current source')
        return {
          material,
          text: source.text,
          offset: 0,
          endOffset: source.text.length,
          totalCharacters: source.text.length,
          nextOffset: null,
          startLine: 1,
          endLine: 1,
        }
      },
      readProject: async (_, read) => {
        const file = files.get(read.path)
        if (!file) throw new Error('Missing saved source')
        return {
          path: read.path,
          version: file.version,
          text: file.text,
          offset: 0,
          endOffset: file.text.length,
          totalCharacters: file.text.length,
          nextOffset: null,
          startLine: 1,
          endLine: 1,
        }
      },
      turn: async (_, messages) => {
        const calls = turns.shift()
        if (calls)
          return {
            text: calls.length ? '' : 'Saved the integrated sources.',
            toolCalls: calls,
          }
        if (!sawFailure) {
          expect(messages.at(-1)?.content).toContain(
            'Missing saved resource public/palette.txt'
          )
          sawFailure = true
          const version = files.get('public/scores/Pattern.js')?.version
          return {
            text: '',
            toolCalls: [
              call(
                'write_project_file',
                {
                  path: 'public/scores/Pattern.js',
                  version,
                  edits: [
                    {
                      oldText: "loadText('./palette.txt')",
                      newText: "loadText('./assets/palette.txt')",
                    },
                  ],
                },
                'repair-palette'
              ),
            ],
          }
        }
        if (executions.length === 1)
          return { text: 'Repaired the palette route.', toolCalls: [] }
        expect(messages.at(-1)?.content).toContain('"status":"passed"')
        return {
          text: 'Adopted Grid.js and Pattern.js in public/scores, wired Grid → Pattern → monitor and adapted the palette route. The newly saved entry and resource check passed. Sound and artistic effects remain unverified.',
          toolCalls: [],
        }
      },
    }
    let continuation: AssistantContinuation | undefined
    const input =
      'Integrate my supplied Grid and Pattern into the existing score, preserving its drawing and palette.'
    const request = {
      identity: 'adoption-replay',
      mode: 'edit' as const,
      input,
      history: [],
      locale: 'en' as const,
      questionScope,
      signal: new AbortController().signal,
      isCurrent: () => true,
      projectReading: true,
      project: inventory(),
      onContinuation: (value: AssistantContinuation | null) => {
        if (value) continuation = value
      },
    }
    let result = await runAssistantRequest(request, deps)
    if (decision !== 'new') {
      expect(result.question?.id).toBe('native-material-conflict')
      expect(executions).toHaveLength(0)
      expect(files).toEqual(before)
      expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
      const pending = task.questions?.[0]
      if (!pending || !continuation)
        throw new Error('Missing native conflict continuation')
      const answer =
        decision === 'freeText'
          ? {
              optionId: null,
              text: 'Keep my artwork and use a new source file.',
            }
          : { optionId: decision, text: null }
      vi.mocked(
        commands.answerCreationAssistantQuestion
      ).mockImplementationOnce(
        async (_, taskId, questionId, submittedScope, submittedAnswer) => {
          expect(taskId).toBe(task.id)
          expect(questionId).toBe(pending.id)
          expect(submittedScope).toEqual(questionScope)
          const answered: AssistantQuestion = {
            ...pending,
            status: 'answered',
            answer: submittedAnswer,
          }
          task.questions = [answered]
          return { status: 'ok', data: answered }
        }
      )
      await commands.answerCreationAssistantQuestion(
        'adoption-replay',
        task.id,
        pending.id,
        questionScope,
        answer
      )
      if (decision === 'coexist' || decision === 'freeText')
        gridPath = 'public/scores/Grid-imported.js'
      vi.mocked(commands.beginCreationAssistantTask).mockResolvedValue({
        status: 'ok',
        data: structuredClone(task),
      })
      turns.unshift(integrationCalls('resume'))
      result = await runAssistantRequest(
        { ...request, project: inventory(), continuation },
        deps
      )
      expect(commands.beginCreationAssistantTask).toHaveBeenLastCalledWith(
        'adoption-replay',
        'edit',
        task.id,
        questionScope
      )
      expect(task.questions?.[0]?.answer).toEqual(answer)
      if (decision !== 'replace')
        expect(files.get(collisionPath)).toEqual(before.get(collisionPath))
    }
    expect(result.text).toContain('public/scores')
    expect(executions).toHaveLength(2)
    expect(executions[1]).toEqual({
      scripts: [gridPath, 'public/scores/Pattern.js', 'public/monitor.js'],
      drawing: ['original-artwork', 'grid8:indigo'],
      resources: ['public/assets/palette.txt'],
    })
    expect(originals[1]?.text).toContain("loadText('./palette.txt')")
    expect(files.get('public/assets/palette.txt')).toEqual(
      before.get('public/assets/palette.txt')
    )
    const adopted = files.get(gridPath)
    files.set(gridPath, {
      text: 'creator later edit',
      version: 'creator-v2',
    })
    expect(
      await commands.undoCreationAssistantTask('adoption-replay', task.id, null)
    ).toMatchObject({ status: 'error', error: { code: 'versionConflict' } })
    expect(files.get('public/monitor.js')?.text).toContain('new Pattern')
    if (!adopted) throw new Error('Missing adopted source')
    files.set(gridPath, adopted)
    expect(
      await commands.undoCreationAssistantTask('adoption-replay', task.id, null)
    ).toMatchObject({ status: 'ok' })
    expect(files).toEqual(before)
    expect(directories).toEqual([
      'public',
      'public/assets',
      ...(decision === 'new' ? [] : ['public/scores']),
    ])
  }
)
