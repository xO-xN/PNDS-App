import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import {
  commands,
  type AssistantTaskResume,
  type AssistantQuestion,
} from '@/lib/tauri-bindings'
import { HELP_BOOKS } from '@/lib/help-corpus'
import { useAssistantStore } from '@/store/assistant-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationHandoffStore } from '@/store/creation-handoff-store'
import { CreationAssistant } from './CreationAssistant'
import { CreationHandoff } from './CreationHandoff'
import { CreationHandoffBaselines } from './CreationHandoffBaselines'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useHandoffBaselinesStore } from '@/store/handoff-baselines-store'
import { flushAssistantResume } from '@/lib/assistant-resume'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import i18n from '@/i18n/config'
import { modelProfileKey } from '@/lib/model-context-settings'
import { useAssistantHandoffStore } from '@/store/assistant-handoff-store'

const config = { model: 'chosen', baseUrl: 'https://model.example/v1' }

async function editHandoffIntent() {
  const visible = screen.queryByRole('textbox', { name: 'Intent' })
  if (visible) return visible
  const edit = await screen.findByRole('button', { name: 'Edit task' })
  await waitFor(() => expect(edit).toBeEnabled())
  fireEvent.click(edit)
  return screen.findByRole('textbox', { name: 'Intent' })
}
const draft = {
  confirmedRequirements: [
    { text: 'Each performer chooses the ending.', sourceIds: ['current-user'] },
  ],
  acceptance: [
    { text: 'Verify independent endings.', sourceIds: ['current-user'] },
  ],
  files: ['score.js'],
  suggestions: [
    { text: 'Add an unaccepted flash.', sourceIds: ['current-reply'] },
  ],
  openQuestions: [],
}
beforeEach(async () => {
  vi.clearAllMocks()
  useAssistantHandoffStore.setState({ items: {} })
  vi.mocked(commands.listHandoffBaselines).mockResolvedValue({
    status: 'ok',
    data: { usedBytes: 0, limitBytes: 268435456, baselines: [] },
  })
  vi.mocked(commands.loadAssistantHistory).mockResolvedValue({
    status: 'ok',
    data: {
      epoch: 'history-initial',
      projectKey: 'a'.repeat(64),
      appVersion: '0.0.0-test',
      messages: [],
    },
  })
  vi.mocked(commands.loadCreationAssistantResume).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  vi.mocked(commands.getCreationAssistantQuestions).mockResolvedValue({
    status: 'ok',
    data: [],
  })
  vi.mocked(commands.beginCreationAssistantTask).mockImplementation(
    async (_, mode) => ({
      status: 'ok',
      data: { id: 'draft-task', mode, files: [] },
    })
  )
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'discussion-handoff',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [{ path: 'score.js', kind: 'text', category: 'pages', size: 10 }],
    },
  })
  useCreationFilesStore.getState().clear()
  useCreationHandoffStore.getState().clear()
  useAssistantStore.getState().syncWorkspace(null)
  useAssistantStore.getState().syncWorkspace('discussion-handoff')
  await useAssistantStore.getState().retryHistory()
  useAssistantStore.setState({
    configured: true,
    modelConfig: config,
    historyState: 'ready',
    historyBusy: false,
    input: 'My unsent input',
    activeConversationId: 'current-topic',
    messages: [
      {
        id: 'old-user',
        role: 'user',
        text: 'OLD TOPIC MUST STAY OUT',
        sources: [],
        status: 'completed',
        scope: 'project',
      },
      {
        id: 'current-topic',
        role: 'assistant',
        text: 'New topic',
        contextMarker: { type: 'topic' },
        sources: [],
        status: 'completed',
        scope: 'platform',
      },
      {
        id: 'current-user',
        role: 'user',
        text: 'Each performer chooses the ending.',
        sources: [],
        status: 'completed',
        scope: 'project',
      },
      {
        id: 'current-reply',
        role: 'assistant',
        text: 'Add an unaccepted flash. Which color?',
        sources: [],
        status: 'completed',
        scope: 'project',
      },
    ],
  })
  vi.mocked(commands.helpCorpus).mockResolvedValue({
    status: 'ok',
    data: HELP_BOOKS.flatMap(book =>
      book.documentIds.map(id => ({
        id,
        path: `${id}.md`,
        markdown: `# ${id}\n\nContract.`,
      }))
    ),
  })
  vi.mocked(commands.beginAssistantRequest).mockImplementation(
    async (_, requestId) => ({
      status: 'ok',
      data: { requestId, model: config.model, baseUrl: config.baseUrl, config },
    })
  )
  vi.mocked(commands.assistantModelTurn).mockResolvedValue({
    status: 'ok',
    data: { text: JSON.stringify(draft), toolCalls: [] },
  })
  vi.mocked(commands.readCreationHandoff).mockResolvedValue({
    status: 'ok',
    data: { text: 'Existing agent: in progress', version: 'h1' },
  })
})

it('does not open an unrelated manual task when preparing the first handoff for a topic', async () => {
  useCreationHandoffStore.setState({
    pending: [
      {
        task: {
          id: crypto.randomUUID(),
          intent: 'Unrelated manual task',
          files: ['README.md'],
          acceptance: 'Keep this independent task',
          status: 'pending',
        },
        readme: true,
      },
    ],
  })
  render(<CreationHandoff editable exists />)
  await act(() => useAssistantStore.getState().prepareHandoff())
  expect(await editHandoffIntent()).toHaveValue(
    'Each performer chooses the ending.'
  )
  expect(commands.assistantModelTurn).toHaveBeenCalledTimes(1)
  expect(useCreationHandoffStore.getState().pending).toHaveLength(2)
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
})

it('repairs an older recorded draft-ready reply from complete native evidence without starting any work', async () => {
  const readyText = i18n.t('assistant.handoff.draftReady')
  const recordedTask = {
    id: 'recorded-reply',
    intent: 'Implement the sound layer',
    files: ['score.js'],
    acceptance: 'Verify fixed pitches',
    status: 'pending',
  }
  vi.mocked(commands.loadAssistantHistory).mockResolvedValue({
    status: 'ok',
    data: {
      epoch: 'recorded-history',
      projectKey: 'a'.repeat(64),
      appVersion: '0.0.0-test',
      messages: ['recorded-reply', 'unrecorded-reply'].map(id => ({
        id,
        role: 'assistant' as const,
        status: 'completed' as const,
        text: readyText,
        scope: 'project' as const,
        sources: [],
      })),
    },
  })
  vi.mocked(commands.listHandoffBaselines).mockResolvedValue({
    status: 'ok',
    data: {
      usedBytes: 100,
      limitBytes: 268435456,
      baselines: [
        {
          id: 'recorded-baseline',
          task: recordedTask,
          taskId: recordedTask.id,
          intent: recordedTask.intent,
          revision: 'recorded-revision',
          capturedAt: 1,
          complete: true,
          bytes: 100,
          files: 1,
          excluded: [],
          error: null,
        },
      ],
    },
  })
  await act(() => useAssistantStore.getState().retryHistory())
  const messages = useAssistantStore.getState().messages
  expect(messages.find(message => message.id === recordedTask.id)?.text).toBe(
    i18n.t('assistant.handoff.recordedReady')
  )
  expect(
    messages.find(message => message.id === 'unrecorded-reply')?.text
  ).toBe(readyText)
  render(<CreationAssistant identity="discussion-handoff" />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }))
  expect(writeText).toHaveBeenCalledWith(
    expect.stringContaining('Complete every current task')
  )
  expect(commands.assistantModelTurn).not.toHaveBeenCalled()
  expect(commands.beginCreationAssistantTask).not.toHaveBeenCalled()
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
})

it.each([true, false])(
  'resolves a restored reply reference to its actual existing task without generating again (record available: %s)',
  async available => {
    const taskId = '701a5180-a2dd-47dc-9319-9312f3790f64'
    const revision = 'a'.repeat(64)
    const task = {
      id: taskId,
      intent: 'Corrected sound plan',
      files: ['score.js'],
      acceptance: 'Verify the agreed mapping',
      status: 'pending',
    }
    vi.mocked(commands.loadAssistantHistory).mockResolvedValue({
      status: 'ok',
      data: {
        epoch: 'recorded-ref',
        projectKey: 'a'.repeat(64),
        appVersion: '0.0.0-test',
        messages: [
          {
            id: 'different-generated-reply',
            role: 'assistant',
            status: 'completed',
            scope: 'project',
            sources: [],
            text: i18n.t('assistant.handoff.recordedReady'),
            handoff: { taskId, revision, prompt: 'Copy-only saved prompt' },
          },
        ],
      },
    })
    vi.mocked(commands.listHandoffBaselines).mockResolvedValue({
      status: 'ok',
      data: {
        usedBytes: 100,
        limitBytes: 268435456,
        baselines: available
          ? [
              {
                id: 'existing-record',
                task,
                taskId,
                intent: task.intent,
                revision,
                capturedAt: 1,
                complete: true,
                bytes: 100,
                files: 1,
                excluded: [],
                error: null,
              },
            ]
          : [],
      },
    })
    vi.mocked(commands.readCreationHandoff).mockResolvedValue({
      status: 'ok',
      data: {
        text: `<!-- pnds-task:${taskId} -->\n## Active sound plan\n<!-- pnds-task-end:${taskId} -->\n`,
        version: 'h1',
      },
    })
    await act(() => useAssistantStore.getState().retryHistory())
    expect(useAssistantStore.getState().messages[0]?.handoff).toMatchObject({
      taskId,
      revision,
      prompt: expect.stringContaining('Complete every current task'),
    })
    expect(useAssistantStore.getState().messages[0]?.handoff?.prompt).toContain(
      '"/score"'
    )
    useCreationHandoffStore.setState({
      pending: [
        {
          task: {
            id: crypto.randomUUID(),
            intent: 'Unrelated manual task',
            files: [],
            acceptance: '',
            status: 'pending',
          },
          readme: false,
        },
      ],
    })
    render(<CreationHandoff editable exists />)
    await act(() => useAssistantStore.getState().prepareHandoff())
    if (available) {
      expect(useCreationHandoffStore.getState().activeId).toBe(taskId)
      expect(await editHandoffIntent()).toHaveValue(task.intent)
    } else {
      expect(useAssistantStore.getState().handoffDraftError).toBe(true)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
    expect(commands.assistantModelTurn).not.toHaveBeenCalled()
    expect(commands.beginCreationAssistantTask).not.toHaveBeenCalled()
    expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
  }
)
it('prepares only current-topic requirements, keeps suggestions separate, and resumes the cancelled editable draft without writing', async () => {
  render(
    <>
      <CreationAssistant identity="discussion-handoff" />
      <CreationHandoff editable exists />
    </>
  )
  act(() => {
    void useAssistantStore.getState().prepareHandoff()
  })
  const intent = await editHandoffIntent()
  expect(intent).toHaveValue('Each performer chooses the ending.')
  expect(
    (screen.getByLabelText('Acceptance criteria') as HTMLTextAreaElement).value
  ).toContain('Unaccepted suggestions')
  expect(
    (screen.getByLabelText('Acceptance criteria') as HTMLTextAreaElement).value
  ).not.toContain('Open questions')
  const sent = JSON.stringify(
    vi.mocked(commands.assistantModelTurn).mock.calls[0]?.[1]
  )
  expect(sent).toContain('current-user')
  expect(sent).not.toContain('OLD TOPIC MUST STAY OUT')
  expect(commands.beginCreationAssistantTask).toHaveBeenCalledWith(
    'discussion-handoff',
    'discussion',
    null,
    expect.anything()
  )
  expect(commands.previewCreationHandoff).not.toHaveBeenCalled()
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  fireEvent.change(intent, { target: { value: 'My reviewed requirements' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  act(() => {
    void useAssistantStore.getState().prepareHandoff()
  })
  expect(await editHandoffIntent()).toHaveValue('My reviewed requirements')
  expect(commands.assistantModelTurn).toHaveBeenCalledTimes(1)
  expect(useAssistantStore.getState().input).toBe('My unsent input')
  await act(() => useCreationHandoffStore.getState().cancel())
  await waitFor(() =>
    expect(screen.queryByLabelText('Intent')).not.toBeInTheDocument()
  )
})

it.each(['contextual choice', 'natural command'])(
  'carries the selected full visible plan into handoff without accepting earlier suggestions (%s)',
  async route => {
    const concreteDetail =
      'Keep each color’s fixed fundamental; acceleration may detune it by at most 17 cents.'
    const fullPlan = [
      'Implement independent performer endings in score.js.',
      concreteDetail,
      'Acceptance: ending one performer must leave the other performer sounding.',
      'The optional flash remains an unaccepted suggestion. Autonomous background sound is excluded.',
    ].join('\n\n')
    const plan = {
      reason: 'The consequential design choices are resolved.',
      intent: 'Implement independent performer endings.',
      files: ['score.js'],
      knownProblems:
        'No unresolved design choices. Background sound is excluded.',
      acceptance:
        'Verify independent endings without changing the pitch mapping.',
    }
    const key = modelProfileKey(config)
    useAssistantStore.setState(state => ({
      mode: 'discussion',
      messages: [
        ...state.messages.filter(message => message.id !== 'current-reply'),
        {
          id: 'earlier-idea',
          role: 'assistant' as const,
          text: 'An optional flash could accompany an ending.',
          contextServiceKey: key,
          sources: [],
          status: 'completed' as const,
          scope: 'project' as const,
        },
        {
          id: 'current-reply',
          role: 'assistant' as const,
          text: fullPlan,
          contextServiceKey: key,
          sources: [],
          status: 'completed' as const,
          scope: 'project' as const,
        },
      ].map(message =>
        message.id === 'current-user'
          ? { ...message, contextServiceKey: key }
          : message
      ),
    }))
    useAssistantHandoffStore
      .getState()
      .offer('discussion-handoff', 'current-reply', plan, 'discussion')
    render(
      <>
        <CreationAssistant identity="discussion-handoff" />
        <CreationHandoff editable exists />
      </>
    )
    expect(screen.getByText(concreteDetail)).toBeVisible()
    if (route === 'contextual choice') {
      fireEvent.click(
        screen.getByRole('button', { name: 'Write handoff file' })
      )
    } else {
      await act(async () => {
        useAssistantStore.setState({ input: 'Write a handoff file' })
        await useAssistantStore.getState().send()
      })
    }
    const intent = (await editHandoffIntent()) as HTMLTextAreaElement
    expect(intent.value).toContain(fullPlan)
    expect(intent.value).toContain(plan.intent)
    expect(screen.getByLabelText('Acceptance criteria')).toHaveValue(
      plan.acceptance
    )
    expect(commands.assistantModelTurn).not.toHaveBeenCalled()
    expect(commands.askCreationAssistantQuestion).not.toHaveBeenCalled()
    expect(commands.previewCreationHandoff).not.toHaveBeenCalled()
    expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
    expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
    expect(useAssistantStore.getState().mode).toBe('discussion')
  }
)

it.each([false, true])(
  'restores a missing handoff decision and prepares a draft after the submitted answer (malformed first output: %s)',
  async malformedFirst => {
    let saved: AssistantTaskResume | undefined
    vi.mocked(commands.saveCreationAssistantResume).mockImplementation(
      async (_, record) => {
        saved = structuredClone(record)
        return { status: 'ok', data: null }
      }
    )
    let question: AssistantQuestion | undefined
    vi.mocked(commands.beginCreationAssistantTask).mockImplementation(
      async (_identity, mode) => ({
        status: 'ok',
        data: {
          id: 'draft-task',
          mode,
          files: [],
          questions: question ? [question] : [],
        },
      })
    )
    vi.mocked(commands.askCreationAssistantQuestion).mockImplementation(
      async (_identity, taskId, scope, request) => {
        question = {
          ...request,
          scope,
          taskId,
          id: 'color-choice',
          status: 'pending',
          answer: null,
        }
        return {
          status: 'ok',
          data: {
            id: taskId,
            mode: 'discussion',
            files: [],
            questions: [question],
          },
        }
      }
    )
    vi.mocked(commands.answerCreationAssistantQuestion).mockImplementation(
      async (_identity, _task, _id, _scope, answer) => {
        if (!question) throw new Error('No pending question')
        question = { ...question, status: 'answered', answer }
        return { status: 'ok', data: question }
      }
    )
    let malformedReturned = false
    vi.mocked(commands.assistantModelTurn).mockImplementation(async () => {
      if (
        question?.status === 'answered' &&
        malformedFirst &&
        !malformedReturned
      ) {
        malformedReturned = true
        return {
          status: 'ok',
          data: {
            text: 'The answer is saved. Here is a draft without the required JSON.',
            toolCalls: [],
          },
        }
      }
      return question?.status === 'answered'
        ? {
            status: 'ok',
            data: {
              text: JSON.stringify({
                ...draft,
                confirmedRequirements: [
                  draft.confirmedRequirements[0],
                  {
                    text: 'Use blue for the ending.',
                    sourceIds: [`${question.scope.messageId}:${question.id}`],
                  },
                ],
                openQuestions: [],
              }),
              toolCalls: [],
            },
          }
        : {
            status: 'ok',
            data: {
              text: '',
              toolCalls: [
                {
                  id: 'ask-color',
                  name: 'ask_question',
                  arguments: JSON.stringify({
                    prompt: 'Which color marks the ending?',
                    options: [
                      {
                        id: 'blue',
                        label: 'Blue',
                        description: 'A calm marker.',
                      },
                    ],
                    recommendedOptionId: 'blue',
                  }),
                },
              ],
            },
          }
    })
    render(
      <>
        <CreationAssistant identity="discussion-handoff" />
        <CreationHandoff editable exists />
      </>
    )
    act(() => {
      void useAssistantStore.getState().prepareHandoff()
    })
    let option = await screen.findByRole('button', { name: /Blue/ })
    expect(option).toBeEnabled()
    expect(commands.assistantModelTurn).toHaveBeenCalledTimes(1)
    expect(commands.previewCreationHandoff).not.toHaveBeenCalled()
    await act(() => useAssistantStore.getState().stop(true))
    await flushAssistantResume()
    if (!saved || !question) throw new Error('Missing durable handoff question')
    const recoveryPayload = JSON.parse(saved.payload)
    recoveryPayload.continuation.outputRecoveries = 1
    recoveryPayload.continuation.interruption = 'timeout'
    const record = { ...saved, payload: JSON.stringify(recoveryPayload) }
    vi.mocked(commands.loadCreationAssistantResume).mockResolvedValue({
      status: 'ok',
      data: { record, files: [] },
    })
    vi.mocked(commands.getCreationAssistantQuestions).mockResolvedValue({
      status: 'ok',
      data: [question],
    })
    await act(() => useAssistantStore.getState().restoreTask())
    expect(
      screen.queryByRole('button', { name: 'Submit answer' })
    ).not.toBeInTheDocument()
    await act(() => useAssistantStore.getState().send(false, true))
    expect(commands.assistantModelTurn).toHaveBeenCalledTimes(1)
    option = await screen.findByRole('button', { name: /Blue/ })
    fireEvent.click(option)
    expect(await editHandoffIntent()).toHaveValue(
      'Each performer chooses the ending.\nUse blue for the ending.'
    )
    expect(commands.assistantModelTurn).toHaveBeenCalledTimes(
      malformedFirst ? 3 : 2
    )
    const continuedPolicy = vi
      .mocked(commands.assistantModelTurn)
      .mock.calls.at(-1)?.[1][0]?.content
    expect(continuedPolicy).toContain('Return only JSON')
    expect(continuedPolicy).not.toContain(
      'discuss confirmed choices in chat prose only'
    )
    expect(continuedPolicy).not.toContain(
      'Return exactly ONE small tool call now'
    )
    expect(continuedPolicy).not.toContain('for code prefer')
    expect(continuedPolicy).not.toContain('run the check')
    expect(commands.beginCreationAssistantTask).toHaveBeenCalledTimes(3)
    expect(
      vi.mocked(commands.beginCreationAssistantTask).mock.calls[1]?.[2]
    ).toBe('draft-task')
    expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
    expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  }
)

it('requires a separate reviewed confirmation to record the generated task and never records twice on duplicate clicks', async () => {
  vi.mocked(commands.previewCreationHandoff).mockImplementation(
    async (identity, task) => ({
      status: 'ok',
      data: {
        identity,
        task,
        token: 'reviewed-draft',
        revision: 'r1',
        fingerprint: 'saved-v1',
        document: { text: 'Existing agent: in progress', version: 'h1' },
      },
    })
  )
  vi.mocked(commands.confirmCreationHandoff).mockImplementation(async () => {
    const task = useCreationHandoffStore.getState().pending[0]?.task
    if (!task) throw new Error('No reviewed draft')
    return {
      status: 'ok',
      data: {
        task,
        revision: 'r1',
        document: {
          text: 'Existing agent: in progress\nRecorded task',
          version: 'h2',
        },
        instructions: 'Reviewed task instructions',
        taskRecorded: true,
        baselineId: 'baseline-1',
        baselineError: null,
      },
    }
  })
  const view = render(
    <>
      <CreationAssistant identity="discussion-handoff" />
      <CreationHandoff editable exists />
    </>
  )
  act(() => {
    void useAssistantStore.getState().prepareHandoff()
  })
  await editHandoffIntent()
  fireEvent.click(screen.getByRole('button', { name: 'Preview handoff' }))
  const confirm = await screen.findByRole('button', {
    name: 'Confirm write',
  })
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
  fireEvent.click(confirm)
  fireEvent.click(confirm)
  await screen.findByText('Handoff recorded · Baseline ready')
  const copyPrompt = await screen.findByRole('button', { name: 'Copy prompt' })
  fireEvent.click(copyPrompt)
  expect(writeText).toHaveBeenCalledWith(
    expect.stringContaining('docs/handoff-history/')
  )
  const savedReply = useAssistantStore
    .getState()
    .messages.find(
      message =>
        message.id === useCreationHandoffStore.getState().receipt?.task.id
    )
  expect(savedReply?.handoff?.prompt).toContain('docs/creator-handoff.md')
  expect(savedReply?.handoff).toMatchObject({
    taskId: savedReply?.id,
    revision: 'r1',
  })
  expect(savedReply?.text).not.toContain('Review it before recording')
  expect(commands.confirmCreationHandoff).toHaveBeenCalledTimes(1)
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  expect(useCreationHandoffStore.getState().receipt?.task.intent).toBe(
    'Each performer chooses the ending.'
  )
  const receipt = useCreationHandoffStore.getState().receipt
  const workspace = useCreationStore.getState().workspace
  if (!receipt || !workspace) throw new Error('Missing recorded task fixture')
  view.unmount()
  await act(() => {
    useCreationStore.setState({ workspace: null })
    useCreationStore.setState({ workspace })
    useCreationReadingStore.getState().syncWorkspace('discussion-handoff')
    useCreationReadingStore
      .getState()
      .showExtension(
        { id: 'handoff-baselines', title: 'Changes', content: null },
        'recorded-reply'
      )
  })
  vi.mocked(commands.listHandoffBaselines).mockResolvedValue({
    status: 'ok',
    data: {
      usedBytes: 500,
      limitBytes: 268435456,
      baselines: [
        {
          id: 'baseline-1',
          taskId: receipt.task.id,
          task: receipt.task,
          intent: receipt.task.intent,
          revision: 'r1',
          capturedAt: 1700000000000,
          complete: true,
          bytes: 500,
          files: 1,
          excluded: [],
          error: null,
        },
      ],
    },
  })
  vi.mocked(commands.compareHandoffBaseline).mockResolvedValue({
    status: 'ok',
    data: {
      baselineId: 'baseline-1',
      task: receipt.task,
      revision: 'r1',
      capturedAt: 1700000000000,
      currentFingerprint: 'external-v2',
      comparedFiles: 1,
      baselineExcluded: [],
      currentExcluded: [],
      changes: [
        {
          path: 'score.js',
          kind: 'modified',
          mentioned: true,
          before: {
            path: 'score.js',
            text: 'saved artwork',
            size: 13,
            sha256: 'before',
          },
          after: {
            path: 'score.js',
            text: 'external implementation',
            size: 23,
            sha256: 'after',
          },
        },
      ],
    },
  })
  render(<CreationHandoffBaselines identity="discussion-handoff" />)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Compare saved files' })
  )
  await screen.findByText(/external implementation/)
  fireEvent.click(
    screen.getByRole('button', { name: 'Open current file score.js' })
  )
  await waitFor(() =>
    expect(useCreationFilesStore.getState().activePath).toBe('score.js')
  )
  expect(useHandoffBaselinesStore.getState().comparison?.baselineId).toBe(
    'baseline-1'
  )
  expect(commands.confirmCreationHandoff).toHaveBeenCalledTimes(1)
  expect(commands.assistantModelTurn).toHaveBeenCalledTimes(1)
})

it('rejects a model suggestion promoted to a requirement and shows no handoff entry in edit mode', async () => {
  vi.mocked(commands.assistantModelTurn).mockResolvedValue({
    status: 'ok',
    data: {
      text: JSON.stringify({
        ...draft,
        confirmedRequirements: [
          { text: 'Add an unaccepted flash.', sourceIds: ['current-reply'] },
        ],
      }),
      toolCalls: [],
    },
  })
  render(
    <>
      <CreationAssistant identity="discussion-handoff" />
      <CreationHandoff editable exists />
    </>
  )
  act(() => {
    void useAssistantStore.getState().prepareHandoff()
  })
  await screen.findByText(/The handoff draft is incomplete/)
  expect(commands.assistantModelTurn).toHaveBeenCalledTimes(2)
  expect(commands.beginCreationAssistantTask).toHaveBeenCalledTimes(1)
  expect(useAssistantStore.getState()).toMatchObject({
    error: 'protocol',
    canContinue: true,
    phase: 'idle',
  })
  expect(screen.queryByLabelText('Intent')).not.toBeInTheDocument()
  expect(commands.previewCreationHandoff).not.toHaveBeenCalled()
  vi.mocked(commands.assistantModelTurn).mockResolvedValueOnce({
    status: 'ok',
    data: { text: JSON.stringify(draft), toolCalls: [] },
  })
  await act(() => useAssistantStore.getState().send(false, true))
  expect(await editHandoffIntent()).toHaveValue(
    'Each performer chooses the ending.'
  )
  expect(
    vi.mocked(commands.beginCreationAssistantTask).mock.calls.at(-1)?.[2]
  ).toBe('draft-task')
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
  await act(() => useAssistantStore.getState().setMode('edit'))
  expect(
    screen.queryByRole('button', { name: 'Generate handoff draft' })
  ).not.toBeInTheDocument()
})

it('cancels draft generation and rejects its late result after switching projects', async () => {
  let finish: (
    value: Awaited<ReturnType<typeof commands.assistantModelTurn>>
  ) => void = () => undefined
  vi.mocked(commands.assistantModelTurn).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  render(
    <>
      <CreationAssistant identity="discussion-handoff" />
      <CreationHandoff editable exists />
    </>
  )
  act(() => {
    void useAssistantStore.getState().prepareHandoff()
  })
  await waitFor(() =>
    expect(commands.assistantModelTurn).toHaveBeenCalledTimes(1)
  )
  await act(() => useAssistantStore.getState().syncWorkspace('other-project'))
  await act(() =>
    finish({
      status: 'ok',
      data: { text: JSON.stringify(draft), toolCalls: [] },
    })
  )
  expect(screen.queryByLabelText('Intent')).not.toBeInTheDocument()
  expect(commands.readCreationHandoff).not.toHaveBeenCalled()
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
})

it('reopens the original recorded task across topics and restart without replacing its reviewed origin', async () => {
  let diskText = 'Existing agent state\n'
  const recorded = new Map<
    string,
    Awaited<ReturnType<typeof commands.confirmCreationHandoff>>
  >()
  vi.mocked(commands.readCreationHandoff).mockImplementation(async () => ({
    status: 'ok',
    data: { text: diskText, version: 'h1' },
  }))
  vi.mocked(commands.listHandoffBaselines).mockImplementation(async () => ({
    status: 'ok',
    data: {
      usedBytes: 500,
      limitBytes: 268435456,
      baselines: [...recorded.values()].flatMap(result =>
        result.status === 'ok'
          ? [
              {
                id: result.data.baselineId ?? '',
                taskId: result.data.task.id,
                task: result.data.task,
                intent: result.data.task.intent,
                revision: result.data.revision,
                capturedAt: 1700000000000,
                complete: true,
                bytes: 500,
                files: 1,
                excluded: [],
                error: null,
              },
            ]
          : []
      ),
    },
  }))
  vi.mocked(commands.previewCreationHandoff).mockImplementation(
    async (identity, task) => ({
      status: 'ok',
      data: {
        identity,
        task,
        token: task.id,
        revision: `revision-${task.id}`,
        fingerprint: 'saved-v1',
        document: { text: diskText, version: 'h1' },
      },
    })
  )
  vi.mocked(commands.confirmCreationHandoff).mockImplementation(
    async (_identity, token) => {
      const previous = recorded.get(token)
      if (previous) return previous
      const task = useCreationHandoffStore
        .getState()
        .pending.find(item => item.task.id === token)?.task
      if (!task) throw new Error('Missing reviewed task')
      diskText += `<!-- pnds-task:${task.id} -->\n## ${task.intent}\n<!-- pnds-task-end:${task.id} -->\n`
      const receipt = {
        status: 'ok' as const,
        data: {
          task,
          revision: `revision-${task.id}`,
          document: { text: diskText, version: 'h2' },
          instructions: 'Reviewed instructions',
          taskRecorded: true,
          baselineId: `original-${task.id}`,
          baselineError: null,
        },
      }
      recorded.set(token, receipt)
      return receipt
    }
  )
  const view = render(
    <>
      <CreationAssistant identity="discussion-handoff" />
      <CreationHandoff editable exists />
    </>
  )
  const generateAndRecord = async (intent?: string) => {
    act(() => {
      void useAssistantStore.getState().prepareHandoff()
    })
    const input = await editHandoffIntent()
    if (intent) fireEvent.change(input, { target: { value: intent } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview handoff' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm write' })
    )
    await waitFor(() =>
      expect(screen.queryByLabelText('Intent')).not.toBeInTheDocument()
    )
    const receipt = useCreationHandoffStore.getState().receipt
    if (!receipt?.taskRecorded) throw new Error('Expected recorded handoff')
    return receipt
  }
  const first = await generateAndRecord('Creator-reviewed requirements for A')
  act(() => {
    useAssistantStore.getState().newTopic()
    useAssistantStore.setState(state => ({
      messages: [
        ...state.messages,
        {
          id: 'second-user',
          role: 'user',
          text: 'Keep the pulse steady.',
          status: 'completed',
          scope: 'project',
          sources: [],
        },
        {
          id: 'second-reply',
          role: 'assistant',
          text: 'Discuss a steady pulse.',
          status: 'completed',
          scope: 'project',
          sources: [],
        },
      ],
    }))
  })
  vi.mocked(commands.assistantModelTurn).mockResolvedValue({
    status: 'ok',
    data: {
      text: JSON.stringify({
        ...draft,
        confirmedRequirements: [
          { text: 'Keep the pulse steady.', sourceIds: ['second-user'] },
        ],
        acceptance: [
          { text: 'Verify a steady pulse.', sourceIds: ['second-user'] },
        ],
        suggestions: [],
        openQuestions: [],
      }),
      toolCalls: [],
    },
  })
  const secondTopicId = useAssistantStore.getState().activeConversationId
  const second = await generateAndRecord()
  expect(second.task.id).not.toBe(first.task.id)
  await act(() =>
    useAssistantStore.getState().switchConversation('current-topic')
  )
  vi.mocked(commands.assistantModelTurn).mockResolvedValue({
    status: 'ok',
    data: { text: JSON.stringify(draft), toolCalls: [] },
  })
  const returned = await generateAndRecord()
  expect(commands.assistantModelTurn).toHaveBeenCalledTimes(2)
  expect(returned.task.id).toBe(first.task.id)
  expect(returned.task.intent).toBe('Creator-reviewed requirements for A')
  expect(returned.baselineId).toBe(first.baselineId)
  expect(recorded.size).toBe(2)
  const transcript = structuredClone(useAssistantStore.getState().messages)
  const workspace = useCreationStore.getState().workspace
  if (!workspace) throw new Error('Missing reopened project')
  view.unmount()
  vi.mocked(commands.loadAssistantHistory).mockResolvedValue({
    status: 'ok',
    data: {
      epoch: 'history-reopened',
      projectKey: 'a'.repeat(64),
      appVersion: '0.0.0-test',
      messages: transcript,
    },
  })
  await act(async () => {
    useCreationStore.setState({ workspace: null })
    useCreationStore.setState({ workspace })
    useAssistantStore.getState().syncWorkspace('discussion-handoff')
    await useAssistantStore.getState().retryHistory()
    useAssistantStore.setState({ configured: true, modelConfig: config })
    useAssistantStore.getState().switchConversation('current-topic')
  })
  expect(useCreationHandoffStore.getState().receipt).toBeNull()
  render(
    <>
      <CreationAssistant identity="discussion-handoff" />
      <CreationHandoff editable exists />
    </>
  )
  const catalog = await commands.listHandoffBaselines('discussion-handoff')
  let finishCatalog: (
    result: Awaited<ReturnType<typeof commands.listHandoffBaselines>>
  ) => void = () => undefined
  vi.mocked(commands.listHandoffBaselines).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishCatalog = resolve
      })
  )
  const beforeLookup = vi.mocked(commands.listHandoffBaselines).mock.calls
    .length
  act(() => {
    void useAssistantStore.getState().prepareHandoff()
  })
  await waitFor(() =>
    expect(commands.listHandoffBaselines).toHaveBeenCalledTimes(
      beforeLookup + 1
    )
  )
  await act(() =>
    useAssistantStore.getState().switchConversation(secondTopicId)
  )
  await act(() => finishCatalog(catalog))
  expect(screen.queryByLabelText('Intent')).not.toBeInTheDocument()
  await act(() =>
    useAssistantStore.getState().switchConversation('current-topic')
  )
  const reopened = await generateAndRecord()
  expect(reopened.task.id).toBe(first.task.id)
  expect(reopened.task.intent).toBe('Creator-reviewed requirements for A')
  expect(reopened.baselineId).toBe(first.baselineId)
  expect(commands.assistantModelTurn).toHaveBeenCalledTimes(2)
  expect(recorded.size).toBe(2)
})

it('reselects a historical copied plan without restoring execution and rejects a document-only export task', async () => {
  const planText =
    'Implement touch instruments in audio/instruments.js.\nPreserve the fixed registers and +/-20 cent tuning.\nEvery voice starts and releases; stopping releases all voices.'
  const decisions: [string, string][] = [
    ['Touch gated', 'Unplayed elements stay silent.'],
    ['Spectral registers', 'Four fixed registers; seed selects the pitch.'],
    ['Own radius with size weight', 'Maximum size weight is +3dB.'],
    ['Anchor panning', 'Left, center, right use -0.7, 0, +0.7.'],
    ['Shared reverb and limiter', 'Master sends two output channels.'],
  ]
  useAssistantStore.setState(state => ({
    historicalMessageIds: ['current-reply'],
    messages: state.messages.flatMap(message =>
      message.id === 'current-reply'
        ? [
            {
              ...message,
              id: 'old-generation-action',
              role: 'user' as const,
              text: '生成交接草稿',
            },
            {
              ...message,
              text: planText,
              contextServiceKey: modelProfileKey(config),
              questions: decisions.map(([label, description], index) => ({
                id: `sound-${index}`,
                taskId: 'old-task',
                scope: { chatId: 'old-topic', messageId: 'old-reply' },
                prompt: `Sound decision ${index + 1}?`,
                options: [
                  { id: 'selected', label, description },
                  {
                    id: 'other',
                    label: 'UNSELECTED',
                    description: 'UNSELECTED alternative',
                  },
                ],
                recommendedOptionId: 'other',
                status: 'answered' as const,
                answer: { optionId: 'selected', text: null },
              })),
            },
          ]
        : [message]
    ),
  }))
  const wrong = {
    confirmedRequirements: [
      {
        text: 'Only write a handoff document; do not implement sound.',
        sourceIds: ['old-generation-action'],
      },
    ],
    acceptance: [
      {
        text: 'The handoff document is saved.',
        sourceIds: ['old-generation-action'],
      },
    ],
    files: ['docs/creator-handoff.md'],
    suggestions: [],
    openQuestions: [],
  }
  const correct = {
    confirmedRequirements: [
      {
        text: 'Implement the instruments.',
        sourceIds: ['current-reply:selected-plan'],
      },
    ],
    acceptance: [
      {
        text: 'Every voice starts and releases; stopping releases all voices.',
        sourceIds: ['current-reply:selected-plan'],
      },
    ],
    files: ['audio/instruments.js'],
    suggestions: [],
    openQuestions: [],
  }
  vi.mocked(commands.assistantModelTurn)
    .mockResolvedValueOnce({
      status: 'ok',
      data: { text: JSON.stringify(wrong), toolCalls: [] },
    })
    .mockResolvedValueOnce({
      status: 'ok',
      data: { text: JSON.stringify(correct), toolCalls: [] },
    })
  render(<CreationHandoff editable exists />)
  await act(() => useAssistantStore.getState().prepareHandoff())
  const intent = (await editHandoffIntent()) as HTMLTextAreaElement
  expect(intent.value).toContain(planText)
  for (const [label, description] of decisions) {
    expect(intent.value).toContain(label)
    expect(intent.value).toContain(description)
  }
  expect(intent.value).not.toContain('UNSELECTED')
  expect(intent.value).not.toContain('Only write a handoff document')
  const sourcePacket =
    vi
      .mocked(commands.assistantModelTurn)
      .mock.calls[0]?.[1].find(message =>
        message.content?.includes('CURRENT topic source data (reference only):')
      )?.content ?? ''
  expect(sourcePacket).toContain('current-reply:selected-plan')
  expect(sourcePacket).not.toContain('old-generation-action')
  expect(sourcePacket).toContain('sound-4')
  expect(sourcePacket).not.toContain('"selectedPlan":')
  expect(sourcePacket).not.toContain('"decision":')
  expect(commands.assistantModelTurn).toHaveBeenCalledTimes(2)
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
  expect(useAssistantStore.getState().mode).toBe('discussion')
})

it('rebuilds recorded prompts from each original chat language after restart and an App language change', async () => {
  const previousLanguage = i18n.language
  const recorded = (id: string) => ({
    id,
    role: 'assistant' as const,
    text: 'Recorded.',
    status: 'completed' as const,
    scope: 'project' as const,
    sources: [],
    handoff: {
      taskId: id,
      revision: 'a'.repeat(64),
      prompt: 'Obsolete prompt',
    },
  })
  vi.mocked(commands.loadAssistantHistory).mockResolvedValue({
    status: 'ok',
    data: {
      epoch: 'language-restart',
      projectKey: 'a'.repeat(64),
      appVersion: '0.0.0-test',
      messages: [
        {
          id: 'english-user',
          role: 'user',
          text: 'Implement the touch instruments and preserve their fixed registers.',
          status: 'completed',
          scope: 'project',
          sources: [],
        },
        recorded('english-record'),
        {
          id: 'chinese-topic',
          role: 'assistant',
          text: 'New chat',
          status: 'completed',
          scope: 'platform',
          sources: [],
          contextMarker: { type: 'topic' },
        },
        {
          id: 'chinese-user',
          role: 'user',
          text: '实现触摸乐器，并保留已经确定的固定音区。',
          status: 'completed',
          scope: 'project',
          sources: [],
        },
        recorded('chinese-record'),
      ],
    },
  })
  try {
    for (const language of ['en', 'zh-CN']) {
      await i18n.changeLanguage(language)
      await useAssistantStore.getState().retryHistory()
      const messages = useAssistantStore.getState().messages
      expect(
        messages.find(message => message.id === 'english-record')?.handoff
          ?.prompt
      ).toContain('Complete every current task')
      const chinese =
        messages.find(message => message.id === 'chinese-record')?.handoff
          ?.prompt ?? ''
      expect(chinese).toContain(
        '`docs/creator-handoff.md` 中已确认的全部当前任务'
      )
      expect(chinese).not.toContain('Complete every current task')
    }
    expect(commands.assistantModelTurn).not.toHaveBeenCalled()
    expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  } finally {
    await i18n.changeLanguage(previousLanguage)
  }
})

it.each(['removed', 'revised'] as const)(
  'rejects a live handoff if its reference material is %s during project preparation',
  async change => {
    const material = {
      id: 'source-material',
      name: 'Pattern.js',
      version: 'a'.repeat(64),
      size: 4,
      totalCharacters: 4,
    }
    vi.mocked(commands.listCreationMaterials).mockResolvedValue({
      status: 'ok',
      data: [material],
    })
    useAssistantStore.setState(state => ({
      messages: state.messages.map(message =>
        message.id === 'current-reply'
          ? {
              ...message,
              text: 'Implement the referenced pattern in score.js.',
              contextServiceKey: modelProfileKey(config),
              sources: [
                {
                  docId: material.id,
                  sectionId: 'L1',
                  title: 'Pattern.js:1',
                  locale: 'en',
                  version: material.version,
                  offset: 0,
                  endOffset: 4,
                  totalCharacters: 4,
                  format: 'plainText',
                  material: {
                    material,
                    text: 'page',
                    offset: 0,
                    endOffset: 4,
                    totalCharacters: 4,
                    nextOffset: null,
                    startLine: 1,
                    endLine: 1,
                  },
                },
              ],
            }
          : message
      ),
    }))
    useAssistantHandoffStore.getState().offer(
      'discussion-handoff',
      'current-reply',
      {
        reason: 'Ready',
        intent: 'Implement the referenced pattern.',
        files: ['score.js'],
        acceptance: 'Verify the pattern.',
        knownProblems: 'None.',
      },
      'discussion'
    )
    let entered = false
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const inventory = vi
      .mocked(commands.assistantProjectInventory)
      .getMockImplementation()
    if (!inventory) throw new Error('Missing project inventory fixture')
    vi.mocked(commands.assistantProjectInventory).mockImplementationOnce(
      async (...args) => {
        entered = true
        await gate
        return inventory(...args)
      }
    )
    try {
      const generating = useAssistantStore.getState().prepareHandoff()
      await vi.waitFor(() => expect(entered).toBe(true))
      vi.mocked(commands.listCreationMaterials).mockResolvedValue({
        status: 'ok',
        data:
          change === 'removed'
            ? []
            : [{ ...material, version: 'b'.repeat(64) }],
      })
      release()
      await generating
      expect(useCreationHandoffStore.getState().pending).toHaveLength(0)
      expect(useAssistantStore.getState().error).toBe('projectScopeChanged')
      expect(commands.assistantModelTurn).not.toHaveBeenCalled()
      expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
      expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
    } finally {
      release()
    }
  }
)
