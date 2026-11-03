import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAssistantStore } from './assistant-store'
import { useCreationStore } from './creation-store'
import { useCreationFilesStore } from './creation-files-store'
import { useSessionStore } from './session-store'
import {
  commands,
  type AssistantQuestion,
  type AssistantTask,
  type AssistantTaskResume,
  type AssistantToolCall,
  type ControlledCheckReport,
  type ModelServiceConfig,
} from '@/lib/tauri-bindings'
import type { AssistantMessage } from '@/lib/assistant-types'
import type { AssistantContinuation } from '@/lib/assistant-flow'
import { materialPageSource } from '@/lib/assistant-materials'
import {
  encodeSavedAssistantRequest,
  flushAssistantResume,
} from '@/lib/assistant-resume'
import { flushAssistantHistory } from '@/lib/assistant-history'
import { modelConfigurationKey } from '@/lib/model-context-settings'
import { HELP_BOOKS } from '@/lib/help-corpus'

const store = useAssistantStore.getState
const owner = 'fresh-owner-after-restart'
const taskId = 'original-adoption-task'
const goal =
  'Integrate the supplied Grid source into this score and preserve its existing drawing.'
const scope = { chatId: 'original-chat', messageId: 'original-reply' }
const target = 'public/Grid.js'
const coexist = 'public/Grid.material.js'
const supplied = "draw('supplied-grid');"
const existing = "draw('existing-grid');"
const entry = '<script src="./monitor.js"></script>'
const config: ModelServiceConfig = {
  model: 'material-restart',
  baseUrl: 'https://fixture.invalid/v1',
}

function call(
  name: string,
  args: Record<string, unknown>,
  id: string
): AssistantToolCall {
  return { name, arguments: JSON.stringify(args), id }
}

beforeEach(async () => {
  store().stop(true)
  useCreationStore.setState({ active: false, workspace: null })
  useCreationFilesStore.getState().clear()
  useSessionStore.setState({ sessionStatus: 'idle', runId: 1 })
  await flushAssistantHistory()
  await flushAssistantResume().catch(() => undefined)
  vi.clearAllMocks()
})

afterEach(async () => {
  store().stop(true)
  useCreationStore.setState({ active: false, workspace: null })
  useCreationFilesStore.getState().clear()
  await flushAssistantHistory()
  await flushAssistantResume().catch(() => undefined)
})

function fixture() {
  const material = {
    id: 'a'.repeat(32),
    name: 'Grid.js',
    version: 'b'.repeat(64),
    size: supplied.length,
    totalCharacters: supplied.length,
  }
  let catalog = [material]
  const original = Object.freeze({ ...material, text: supplied })
  const files = new Map([
    [target, { text: existing, version: 'grid-v1' }],
    ['public/monitor.html', { text: entry, version: 'entry-v1' }],
    [
      'public/monitor.js',
      { text: "draw('original-artwork');", version: 'monitor-v1' },
    ],
  ])
  let revision = 1
  const snapshot = () => ({
    fingerprint: `saved-${revision}`,
    files: [...files].map(([path, file]) => ({
      path,
      version: file.version,
      bytes: file.text.length,
      reason: null,
    })),
  })
  const question: AssistantQuestion = {
    id: 'grid-conflict',
    taskId,
    scope,
    prompt: 'materialConflict',
    options: [
      { id: 'replace', label: 'replace', description: 'replace' },
      { id: 'coexist', label: 'coexist', description: 'coexist' },
    ],
    recommendedOptionId: 'coexist',
    status: 'pending',
    answer: null,
    materialConflict: {
      materialId: material.id,
      materialVersion: material.version,
      path: target,
      targetVersion: 'grid-v1',
      candidateSha256: 'c'.repeat(64),
      coexistPath: coexist,
      savedExcerpt: existing,
      candidateExcerpt: supplied,
      firstChangedLine: 1,
      truncated: false,
    },
  }
  const task: AssistantTask = {
    id: taskId,
    mode: 'edit',
    files: [],
    questions: [question],
  }
  const messages: AssistantMessage[] = [
    {
      id: scope.chatId,
      role: 'assistant',
      text: 'Original adoption',
      scope: 'platform',
      status: 'completed',
      sources: [],
      contextMarker: { type: 'topic' },
    },
    {
      id: 'original-user',
      role: 'user',
      text: goal,
      scope: 'project',
      status: 'completed',
      sources: [],
    },
    {
      id: scope.messageId,
      role: 'assistant',
      text: '',
      scope: 'project',
      status: 'cancelled',
      sources: [],
      questions: [question],
    },
    {
      id: 'other-chat',
      role: 'assistant',
      text: 'Other discussion',
      scope: 'platform',
      status: 'completed',
      sources: [],
      contextMarker: { type: 'topic' },
    },
  ]
  const page = {
    material,
    text: supplied,
    offset: 0,
    endOffset: supplied.length,
    totalCharacters: supplied.length,
    nextOffset: null,
    startLine: 1,
    endLine: 1,
  }
  const adoption = { id: material.id, version: material.version, path: target }
  const continuation: AssistantContinuation = {
    key: 'discarded-process-owner-and-grant',
    taskId,
    waitingQuestionId: question.id,
    questionScope: scope,
    projectFingerprint: snapshot().fingerprint,
    projectSnapshot: snapshot(),
    messages: [
      {
        role: 'system',
        content: 'Original edit policy.',
        contextKind: 'editPolicy',
      },
      { role: 'user', content: goal, contextKind: 'input' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          call(
            'read_creation_material',
            { id: material.id, version: material.version },
            'original-read'
          ),
        ],
        contextKind: 'projectFragment',
      },
      {
        role: 'tool',
        toolCallId: 'original-read',
        content: JSON.stringify({ segments: [page] }),
        contextKind: 'projectFragment',
      },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          call('adopt_creation_material', adoption, 'original-adopt'),
        ],
        contextKind: 'projectFragment',
      },
      {
        role: 'tool',
        toolCallId: 'original-adopt',
        content: JSON.stringify({
          status: 'awaitingCreatorAnswer',
          question,
          task,
        }),
        contextKind: 'projectFragment',
      },
    ],
    sources: [materialPageSource(page, 'en')],
    materialEvidence: [{ id: material.id, version: material.version }],
    text: '',
    activity: [],
    project: null,
    toolCalls: 2,
    toolCharacters: 200,
    callIds: ['original-read', 'original-adopt'],
    calls: [null, null],
    returnedCharacters: supplied.length,
    reusedCharacters: 0,
    proposals: [],
    handoff: null,
    needsCheck: false,
  }
  const record: AssistantTaskResume = {
    taskId,
    mode: 'edit',
    userMessageId: 'original-user',
    replyMessageId: scope.messageId,
    conversationId: scope.chatId,
    input: goal,
    locale: 'en',
    modelKey: modelConfigurationKey(config),
    state: 'paused',
    payload: encodeSavedAssistantRequest({
      history: [],
      attachments: [],
      locale: 'en',
      continuation,
    }),
  }
  const currentQuestion = () => task.questions?.at(-1) ?? question
  const save = (path: string, text: string) => {
    const created = !files.has(path)
    const version = `saved-file-${++revision}`
    files.set(path, { text, version })
    task.files = [
      ...task.files.filter(file => file.path !== path),
      { path, created, undone: false },
    ]
    return version
  }
  vi.mocked(commands.loadPreferences).mockResolvedValue({
    status: 'ok',
    data: { theme: 'system', language: 'en', modelService: config },
  })
  vi.mocked(commands.loadAssistantHistory).mockResolvedValue({
    status: 'ok',
    data: {
      epoch: 'restart',
      projectKey: 'd'.repeat(64),
      appVersion: '1.7.0-dev',
      messages,
    },
  })
  vi.mocked(commands.loadCreationAssistantResume).mockResolvedValue({
    status: 'ok',
    data: { record, files: [] },
  })
  vi.mocked(commands.getCreationAssistantQuestions).mockImplementation(
    async () => ({ status: 'ok', data: structuredClone(task.questions ?? []) })
  )
  vi.mocked(commands.getCreationAssistantResourcePlans).mockResolvedValue({
    status: 'ok',
    data: [],
  })
  vi.mocked(commands.assistantProjectInventory).mockImplementation(
    async () => ({ status: 'ok', data: snapshot() })
  )
  vi.mocked(commands.assistantProjectOverview).mockImplementation(async () => ({
    status: 'ok',
    data: {
      snapshot: snapshot(),
      manifestStatus: 'unreadable',
      contentPaths: [],
      evidence: [],
    },
  }))
  vi.mocked(commands.listCreationMaterials).mockImplementation(async () => ({
    status: 'ok',
    data: catalog,
  }))
  vi.mocked(commands.readCreationMaterial).mockResolvedValue({
    status: 'ok',
    data: page,
  })
  vi.mocked(commands.beginAssistantRequest).mockImplementation(
    async (_identity, requestId) => ({
      status: 'ok',
      data: { requestId, ...config, config },
    })
  )
  vi.mocked(commands.helpCorpus).mockResolvedValue({
    status: 'ok',
    data: HELP_BOOKS.flatMap(book =>
      book.documentIds.map(id => ({
        id,
        path: `${id}.md`,
        markdown: `# ${id}\n\nLocal contracts.`,
      }))
    ),
  })
  vi.mocked(commands.beginCreationAssistantTask).mockImplementation(
    async (identity, mode, resume, questionScope) => {
      expect([identity, mode, resume, questionScope]).toEqual([
        owner,
        'edit',
        taskId,
        scope,
      ])
      const previous = currentQuestion()
      const saved = files.get(target)
      if (
        saved &&
        previous.materialConflict &&
        previous.status === 'pending' &&
        saved.version !== previous.materialConflict?.targetVersion
      ) {
        const refreshed: AssistantQuestion = {
          ...previous,
          id: 'refreshed-grid-conflict',
          materialConflict: {
            ...previous.materialConflict,
            targetVersion: saved.version,
            savedExcerpt: saved.text,
            supersedesQuestionId: previous.id,
          },
        }
        task.questions = [
          ...(task.questions ?? []).map(item =>
            item.id === previous.id
              ? { ...item, status: 'cancelled' as const }
              : item
          ),
          refreshed,
        ]
      }
      return { status: 'ok', data: structuredClone(task) }
    }
  )
  vi.mocked(commands.answerCreationAssistantQuestion).mockImplementation(
    async (identity, nativeTask, id, questionScope, answer) => {
      expect([identity, nativeTask, id, questionScope]).toEqual([
        owner,
        taskId,
        currentQuestion().id,
        scope,
      ])
      const current = currentQuestion()
      if (
        current.status !== 'pending' ||
        files.get(target)?.version !==
          current.materialConflict?.targetVersion ||
        !catalog.some(
          item =>
            item.id === material.id &&
            item.version === current.materialConflict?.materialVersion
        )
      )
        return {
          status: 'error',
          error: {
            code: 'versionConflict',
            detail:
              'Material conflict changed; revalidate the original adoption.',
          },
        }
      const answered: AssistantQuestion = {
        ...current,
        status: 'answered',
        answer,
      }
      task.questions = task.questions?.map(item =>
        item.id === id ? answered : item
      )
      return { status: 'ok', data: structuredClone(answered) }
    }
  )
  vi.mocked(commands.cancelCreationAssistantQuestion).mockImplementation(
    async () => {
      const cancelled: AssistantQuestion = {
        ...currentQuestion(),
        status: 'cancelled',
        answer: null,
      }
      task.questions = task.questions?.map(item =>
        item.id === cancelled.id ? cancelled : item
      )
      return { status: 'ok', data: cancelled }
    }
  )
  vi.mocked(commands.adoptCreationAssistantMaterial).mockImplementation(
    async (identity, nativeTask, request) => {
      expect([identity, nativeTask, request]).toEqual([
        owner,
        taskId,
        { ...adoption, text: null },
      ])
      const current = currentQuestion()
      if (current.status === 'pending')
        return { status: 'ok', data: structuredClone(task) }
      if (
        current.status !== 'answered' ||
        !['replace', 'coexist'].includes(current.answer?.optionId ?? '')
      )
        return {
          status: 'error',
          error: {
            code: 'targetExists',
            detail: 'Free text grants no replacement authority.',
          },
        }
      if (
        files.get(target)?.version !== current.materialConflict?.targetVersion
      )
        return {
          status: 'error',
          error: { code: 'versionConflict', detail: 'Saved target changed.' },
        }
      const path = current.answer?.optionId === 'replace' ? target : coexist
      if (path === coexist && files.has(path))
        return {
          status: 'error',
          error: {
            code: 'targetExists',
            detail: 'Coexist destination changed.',
          },
        }
      const version = save(path, original.text)
      task.materialAdoptions = [
        {
          questionId: current.id,
          materialId: material.id,
          materialVersion: material.version,
          targetPath: target,
          path,
          version,
          candidateSha256: 'c'.repeat(64),
        },
      ]
      return { status: 'ok', data: structuredClone(task) }
    }
  )
  vi.mocked(commands.readCreationFile).mockImplementation(async (_, path) => {
    const file = files.get(path)
    return file
      ? { status: 'ok', data: { kind: 'text', ...file } }
      : { status: 'error', error: { code: 'missing', detail: path } }
  })
  vi.mocked(commands.assistantProjectRead).mockImplementation(
    async (_, request) => {
      const file = files.get(request.path)
      if (!file)
        return {
          status: 'error',
          error: { code: 'missing', detail: request.path },
        }
      return {
        status: 'ok',
        data: {
          path: request.path,
          version: file.version,
          text: file.text,
          offset: 0,
          endOffset: file.text.length,
          totalCharacters: file.text.length,
          nextOffset: null,
          startLine: 1,
          endLine: 1,
        },
      }
    }
  )
  vi.mocked(commands.writeCreationAssistantFile).mockImplementation(
    async (identity, nativeTask, write) => {
      expect([identity, nativeTask, write.path]).toEqual([
        owner,
        taskId,
        'public/monitor.html',
      ])
      expect(write.version).toBe(files.get(write.path)?.version)
      save(write.path, write.text ?? '')
      return { status: 'ok', data: structuredClone(task) }
    }
  )
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
      directories: ['public'],
    },
  }))
  const checked: string[][] = []
  vi.mocked(commands.diagnoseCreationProject).mockImplementation(async () => {
    checked.push([...files].map(([path, file]) => `${path}:${file.text}`))
    return {
      status: 'ok',
      data: {
        schemaVersion: 1,
        checkerVersion: 'fixture',
        projectPath: '/score',
        project: null,
        inputFingerprint: snapshot().fingerprint,
        inputs: [],
        checks: [],
        issues: [],
        unverified: ['artisticEffects'],
        staticPassed: true,
      },
    }
  })
  const report: ControlledCheckReport = {
    schemaVersion: 1,
    checkerVersion: 'fixture',
    taskId: 'checked-adoption',
    projectPath: '/score',
    mode: 'none',
    status: 'passed',
    error: null,
    diagnostics: null,
    evidence: {
      sourceRoot: '/score',
      sourceIdentity: 'fixture',
      sharedSourceRoot: null,
      projectSha256: 'e'.repeat(64),
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
    checks: [],
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
  vi.mocked(commands.startAssistantCheck).mockResolvedValue({
    status: 'ok',
    data: report.taskId,
  })
  vi.mocked(commands.getCreationCheck).mockResolvedValue({
    status: 'ok',
    data: { identity: owner, taskId: report.taskId, progress: null, report },
  })
  vi.mocked(commands.creationCheckIsStale).mockResolvedValue({
    status: 'ok',
    data: false,
  })
  vi.mocked(commands.assistantModelTurn).mockResolvedValue({
    status: 'ok',
    data: { text: 'Waiting for a current material decision.', toolCalls: [] },
  })
  const boot = async () => {
    useCreationStore.setState({
      active: true,
      workspace: {
        project: {
          identity: owner,
          root: '/score',
          name: 'Score',
          source: 'folder',
        },
        files: [],
      },
    })
    await store().retryHistory()
    await store().refreshConfiguration()
  }
  return {
    boot,
    question,
    task,
    original,
    files,
    snapshot,
    checked,
    adoption,
    changeTarget() {
      files.set(target, {
        text: "draw('creator-newer-grid');",
        version: 'creator-v2',
      })
      revision += 1
    },
    changeMaterial() {
      catalog = []
    },
  }
}

it.each(['target', 'material'] as const)(
  'revalidates changed %s facts without spending a model turn or applying the stale material answer',
  async changed => {
    const f = fixture()
    await f.boot()
    await store().send(false, true)
    if (changed === 'target') f.changeTarget()
    else f.changeMaterial()
    await store().answerQuestion(f.question.id, {
      optionId: 'replace',
      text: null,
    })
    expect(store().activeQuestion).toMatchObject({ ready: false })
    expect(store().resumeError).toBe(true)
    await store().send(false, true)
    if (changed === 'target') {
      expect(store().activeQuestion).toMatchObject({
        ready: true,
        question: {
          id: 'refreshed-grid-conflict',
          materialConflict: {
            targetVersion: 'creator-v2',
            supersedesQuestionId: f.question.id,
          },
        },
      })
      expect(store().resumeError).toBe(false)
      await store().answerQuestion(f.question.id, {
        optionId: 'replace',
        text: null,
      })
      expect(commands.answerCreationAssistantQuestion).toHaveBeenCalledOnce()
    } else {
      expect(store().activeQuestion?.ready).toBe(false)
      expect(store().error).toBe('projectScopeChanged')
    }
    expect(commands.assistantModelTurn).not.toHaveBeenCalled()
    expect(commands.adoptCreationAssistantMaterial).not.toHaveBeenCalled()
    expect(f.files.get(target)?.text).toBe(
      changed === 'target' ? "draw('creator-newer-grid');" : existing
    )
    expect(f.original.text).toBe(supplied)
  }
)

it.each(['replace', 'coexist'] as const)(
  'restores a material conflict without authority, then consumes explicit %s in its original task and wires the actual placement before checking',
  async option => {
    const f = fixture()
    await f.boot()
    expect(store()).toMatchObject({
      owner,
      mode: 'edit',
      input: goal,
      activeConversationId: scope.chatId,
      resumeRestored: true,
    })
    expect(store().activeQuestion).toMatchObject({
      question: f.question,
      ready: false,
      taskId,
      replyId: scope.messageId,
    })
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
    expect(commands.beginCreationAssistantTask).not.toHaveBeenCalled()
    await store().answerQuestion(f.question.id, {
      optionId: option,
      text: null,
    })
    expect(commands.answerCreationAssistantQuestion).not.toHaveBeenCalled()
    expect(commands.assistantModelTurn).not.toHaveBeenCalled()
    expect(f.files.get(target)?.text).toBe(existing)

    await store().send(false, true)
    expect(store().activeQuestion?.ready).toBe(true)
    expect(commands.assistantModelTurn).not.toHaveBeenCalled()
    expect(commands.adoptCreationAssistantMaterial).not.toHaveBeenCalled()
    expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
    expect(commands.diagnoseCreationProject).not.toHaveBeenCalled()
    let turn = 0
    let placement = ''
    vi.mocked(commands.assistantModelTurn).mockImplementation(
      async (_, messages) => {
        expect(messages.some(message => message.content === goal)).toBe(true)
        if (turn++ === 0)
          return {
            status: 'ok',
            data: {
              text: '',
              toolCalls: [
                call('adopt_creation_material', f.adoption, 'consume-adoption'),
              ],
            },
          }
        if (turn === 2) {
          const receipt = JSON.parse(messages.at(-1)?.content ?? '{}') as {
            adopted?: { path?: string }
          }
          placement = receipt.adopted?.path ?? ''
          expect(placement).toBe(option === 'replace' ? target : coexist)
          return {
            status: 'ok',
            data: {
              text: '',
              toolCalls: [
                call(
                  'read_project_text',
                  { path: 'public/monitor.html' },
                  'read-entry'
                ),
              ],
            },
          }
        }
        if (turn === 3)
          return {
            status: 'ok',
            data: {
              text: '',
              toolCalls: [
                call(
                  'write_project_file',
                  {
                    path: 'public/monitor.html',
                    version: 'entry-v1',
                    text: `<script src="./${placement.slice('public/'.length)}"></script>${entry}`,
                  },
                  'wire-entry'
                ),
              ],
            },
          }
        return {
          status: 'ok',
          data: {
            text: 'Integrated the source and checked the saved entry. Artistic effects remain unverified.',
            toolCalls: [],
          },
        }
      }
    )
    const submission = store().answerQuestion(f.question.id, {
      optionId: option,
      text: null,
    })
    await store().answerQuestion(f.question.id, {
      optionId: 'replace',
      text: null,
    })
    await submission
    expect(commands.answerCreationAssistantQuestion).toHaveBeenCalledOnce()
    expect(commands.answerCreationAssistantQuestion).toHaveBeenCalledWith(
      owner,
      taskId,
      f.question.id,
      scope,
      { optionId: option, text: null }
    )
    expect(commands.adoptCreationAssistantMaterial).toHaveBeenCalledOnce()
    expect(commands.askCreationAssistantQuestion).not.toHaveBeenCalled()
    expect(commands.decideCreationAssistantResources).not.toHaveBeenCalled()
    expect(f.files.get(option === 'replace' ? target : coexist)?.text).toBe(
      supplied
    )
    expect(f.files.get(target)?.text).toBe(
      option === 'replace' ? supplied : existing
    )
    expect(f.files.get('public/monitor.html')?.text).toBe(
      `<script src="./${option === 'replace' ? 'Grid.js' : 'Grid.material.js'}"></script>${entry}`
    )
    expect(f.original.text).toBe(supplied)
    expect(f.checked).toHaveLength(1)
    expect(f.checked[0]).toContain(`${placement}:${supplied}`)
    expect(commands.startAssistantCheck).toHaveBeenCalledWith(owner, taskId)
    expect(
      store()
        .messages.filter(message => message.role === 'user')
        .map(message => message.text)
    ).toEqual([goal])
    expect(
      store().messages.find(message => message.id === scope.messageId)
    ).toMatchObject({
      status: 'completed',
      questions: [
        { id: f.question.id, status: 'answered', answer: { optionId: option } },
      ],
    })
    expect(store().activeQuestion).toBeNull()
  }
)

it.each([target, coexist])(
  'preserves a creator draft at %s introduced during the wait before the material consumer can run',
  async path => {
    const f = fixture()
    await f.boot()
    await store().send(false, true)
    useCreationFilesStore.setState({
      drafts: {
        [path]: {
          text: 'creator unsaved source',
          diskText: '',
          diskVersion: 'draft-base',
          conflict: null,
          saving: false,
          renaming: false,
          diskChanged: false,
          error: null,
        },
      },
    })
    let turn = 0
    vi.mocked(commands.assistantModelTurn).mockImplementation(
      async (_, messages) => {
        if (turn++) {
          expect(messages.at(-1)?.content).toContain('creatorDraft')
          return {
            status: 'ok',
            data: {
              text: 'Save or resolve the current editor draft before continuing this adoption.',
              toolCalls: [],
            },
          }
        }
        return {
          status: 'ok',
          data: {
            text: '',
            toolCalls: [
              call(
                'adopt_creation_material',
                f.adoption,
                'draft-blocked-adoption'
              ),
            ],
          },
        }
      }
    )
    await store().answerQuestion(f.question.id, {
      optionId: 'coexist',
      text: null,
    })
    expect(commands.answerCreationAssistantQuestion).toHaveBeenCalledOnce()
    expect(commands.adoptCreationAssistantMaterial).not.toHaveBeenCalled()
    expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
    expect(commands.diagnoseCreationProject).not.toHaveBeenCalled()
    expect(useCreationFilesStore.getState().drafts[path]?.text).toBe(
      'creator unsaved source'
    )
    expect(f.files.get(target)?.text).toBe(existing)
    expect(f.files.has(coexist)).toBe(false)
    expect(f.original.text).toBe(supplied)
  }
)

it('continues free explanation as guidance while the material consumer preserves the conflicting saved target', async () => {
  const f = fixture()
  await f.boot()
  await store().send(false, true)
  let turn = 0
  vi.mocked(commands.assistantModelTurn).mockImplementation(
    async (_, messages) => {
      expect(messages[0]?.content).toContain(
        'Keep the earlier drawing; explain how the two grids differ.'
      )
      return {
        status: 'ok',
        data: {
          text: turn
            ? 'The original target is preserved; a current explicit placement decision is still needed.'
            : '',
          toolCalls: turn++
            ? []
            : [call('adopt_creation_material', f.adoption, 'free-text-retry')],
        },
      }
    }
  )
  await store().answerQuestion(f.question.id, {
    optionId: null,
    text: 'Keep the earlier drawing; explain how the two grids differ.',
  })
  expect(commands.adoptCreationAssistantMaterial).toHaveBeenCalledOnce()
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  expect(commands.diagnoseCreationProject).not.toHaveBeenCalled()
  expect(f.files.get(target)?.text).toBe(existing)
  expect(f.files.has(coexist)).toBe(false)
  expect(f.original.text).toBe(supplied)
  expect(
    store().messages.find(message => message.id === scope.messageId)
      ?.questions?.[0]?.answer
  ).toEqual({
    optionId: null,
    text: 'Keep the earlier drawing; explain how the two grids differ.',
  })
})

it.each(['cancel', 'chat', 'project'] as const)(
  'fences a late material answer after %s without a save, wiring or paid continuation',
  async change => {
    const f = fixture()
    await f.boot()
    await store().send(false, true)
    let finish!: (
      value: Awaited<
        ReturnType<typeof commands.answerCreationAssistantQuestion>
      >
    ) => void
    vi.mocked(commands.answerCreationAssistantQuestion).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const pending = store().answerQuestion(f.question.id, {
      optionId: 'replace',
      text: null,
    })
    if (change === 'cancel') store().stop()
    else if (change === 'chat') store().switchConversation('other-chat')
    else
      useCreationStore.setState({
        active: true,
        workspace: {
          project: {
            identity: 'different-project',
            root: '/other',
            name: 'Other score',
            source: 'folder',
          },
          files: [],
        },
      })
    finish({
      status: 'ok',
      data: {
        ...f.question,
        status: 'answered',
        answer: { optionId: 'replace', text: null },
      },
    })
    await pending
    if (change === 'cancel') {
      await vi.waitFor(() =>
        expect(
          store().messages.find(message => message.id === scope.messageId)
            ?.questions?.[0]?.status
        ).toBe('cancelled')
      )
      expect(commands.cancelCreationAssistantQuestion).toHaveBeenCalledWith(
        owner,
        taskId,
        f.question.id,
        scope
      )
    }
    if (change === 'chat')
      expect(store().activeConversationId).toBe('other-chat')
    if (change === 'project') expect(store().owner).toBe('different-project')
    expect(commands.assistantModelTurn).not.toHaveBeenCalled()
    expect(commands.adoptCreationAssistantMaterial).not.toHaveBeenCalled()
    expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
    expect(commands.startAssistantCheck).not.toHaveBeenCalled()
    expect(f.files.get(target)?.text).toBe(existing)
    expect(f.files.get('public/monitor.html')?.text).toBe(entry)
    expect(store().activeQuestion).toBeNull()
  }
)
