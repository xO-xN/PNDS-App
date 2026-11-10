import type { OrganizationSource } from '@/lib/assistant-organization'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  useAssistantStore,
  stopAndPersistAssistantHistory,
  waitForAssistantTaskRetirements,
} from './assistant-store'
import { useCreationStore } from './creation-store'
import { useAssistantProposalStore } from './assistant-proposal-store'
import {
  commands,
  type AssistantProjectSnapshot,
  type AssistantTaskResume,
  type ModelServiceConfig,
} from '@/lib/tauri-bindings'
import type { AssistantMessage } from '@/lib/assistant-types'
import type { AssistantContinuation } from '@/lib/assistant-flow'
import {
  encodeSavedAssistantRequest,
  flushAssistantResume,
} from '@/lib/assistant-resume'
import { flushAssistantHistory } from '@/lib/assistant-history'
import { modelConfigurationKey } from '@/lib/model-context-settings'
import { HELP_BOOKS } from '@/lib/help-corpus'
import { conversationMessages } from '@/lib/assistant-conversations'

const config: ModelServiceConfig = {
  model: 'restart-model',
  baseUrl: 'https://restart.fixture/v1',
}
const issuedOwner = 'owner-issued-after-restart'
const originalGoal = '增加描边字号，并为每个演奏者保留独立大小参数。'
const snapshot: AssistantProjectSnapshot = {
  fingerprint: 'current-saved-files',
  files: [
    { path: 'public/monitor.js', bytes: 23, version: 'v2', reason: null },
  ],
}
const store = useAssistantStore.getState

const marker: AssistantMessage = {
  id: 'original-topic',
  role: 'assistant',
  text: 'Original edit conversation',
  scope: 'platform',
  status: 'completed',
  sources: [],
  contextMarker: { type: 'topic' },
}
const question: AssistantMessage = {
  id: 'original-user',
  role: 'user',
  text: originalGoal,
  scope: 'project',
  status: 'completed',
  sources: [],
}
const reply: AssistantMessage = {
  id: 'original-reply',
  role: 'assistant',
  text: '',
  activity: ['Saved the requested source change.'],
  scope: 'project',
  status: 'pending',
  sources: [],
}

function fixture(
  organizationSources?: OrganizationSource[],
  goal = originalGoal
): AssistantTaskResume {
  const continuation: AssistantContinuation = {
    organizationSources,
    key: 'old-process-request-key-containing-old-owner',
    taskId: 'original-native-task',
    projectFingerprint: snapshot.fingerprint,
    projectSnapshot: snapshot,
    messages: [
      {
        role: 'system',
        content: 'Original edit task policy.',
        contextKind: 'editPolicy',
      },
      { role: 'user', content: goal, contextKind: 'input' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'saved-read',
            name: 'read_project_text',
            arguments: '{"path":"public/monitor.js"}',
          },
        ],
        contextKind: 'projectFragment',
      },
      {
        role: 'tool',
        toolCallId: 'saved-read',
        content:
          '{"segments":[{"path":"public/monitor.js","version":"v2","text":"let outlineSize = 0.5;"}]}',
        contextKind: 'projectFragment',
      },
    ],
    sources: [],
    text: '',
    activity: ['Saved the requested source change.'],
    project: null,
    toolCalls: 1,
    toolCharacters: 100,
    callIds: ['saved-read'],
    calls: [null],
    returnedCharacters: 23,
    reusedCharacters: 0,
    proposals: [],
    handoff: null,
    needsCheck: false,
    lastCheck: '{"status":"passed","unverified":["pageRendering"]}',
    lastCheckId: 'last-check',
  }
  return {
    taskId: 'original-native-task',
    mode: 'edit',
    userMessageId: question.id,
    replyMessageId: reply.id,
    conversationId: marker.id,
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
}

beforeEach(async () => {
  store().stop()
  useCreationStore.setState({ active: false, workspace: null })
  await flushAssistantHistory()
  await flushAssistantResume().catch(() => undefined)
  vi.clearAllMocks()
  vi.mocked(commands.loadCreationAssistantResume).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  vi.mocked(commands.loadPreferences).mockResolvedValue({
    status: 'ok',
    data: { theme: 'system', language: 'en', modelService: config },
  })
  vi.mocked(commands.assistantProjectInventory).mockResolvedValue({
    status: 'ok',
    data: snapshot,
  })
  vi.mocked(commands.assistantProjectOverview).mockResolvedValue({
    status: 'ok',
    data: {
      snapshot,
      manifestStatus: 'unreadable',
      contentPaths: [],
      evidence: [],
    },
  })
  vi.mocked(commands.beginAssistantRequest).mockImplementation(
    async (_identity, requestId) => ({
      status: 'ok',
      data: { requestId, ...config, config },
    })
  )
  vi.mocked(commands.beginCreationAssistantTask).mockImplementation(
    async (_identity, mode, resume) => {
      expect(resume).toBe('original-native-task')
      return {
        status: 'ok',
        data: {
          id: 'original-native-task',
          mode,
          files: [{ path: 'public/monitor.js', created: false, undone: false }],
        },
      }
    }
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
  vi.mocked(commands.assistantModelTurn).mockImplementation(
    async (_, messages) => ({
      status: 'ok',
      data: messages[0]?.content?.includes('Mode: discussion.')
        ? {
            text: null,
            toolCalls: [
              {
                id: 'answer',
                name: 'complete_discussion',
                arguments: JSON.stringify({
                  answer:
                    'The original edit is saved and checked. Visual rendering remains unverified.',
                }),
              },
            ],
          }
        : {
            text: 'The original edit is saved and checked. Visual rendering remains unverified.',
            toolCalls: [],
          },
    })
  )
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'error',
    error: {
      code: 'missing',
      detail: 'No optional preview contract in this fixture',
    },
  })
})

afterEach(async () => {
  store().stop()
  useCreationStore.setState({ active: false, workspace: null })
  await flushAssistantHistory()
  await flushAssistantResume().catch(() => undefined)
})

async function boot(
  messages: AssistantMessage[] = [marker, question, reply],
  organization?: { sources: OrganizationSource[]; goal: string }
) {
  const record = fixture(organization?.sources, organization?.goal)
  vi.mocked(commands.loadCreationAssistantResume).mockImplementation(
    async owner => ({
      status: 'ok',
      data:
        owner === issuedOwner
          ? { record, files: [{ path: 'public/monitor.js', version: 'v2' }] }
          : null,
    })
  )
  vi.mocked(commands.loadAssistantHistory).mockResolvedValue({
    status: 'ok',
    data: {
      epoch: 'loaded-history',
      projectKey: 'b'.repeat(64),
      appVersion: '1.7.0-dev',
      messages,
    },
  })
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: issuedOwner,
        root: '/canonical-score',
        name: 'Runes replay',
        source: 'folder',
      },
      files: [],
    },
  })
  // syncWorkspace also starts loading; the explicit awaited retry exercises the
  // same public recovery path and invalidates any earlier in-flight load.
  await store().retryHistory()
  await store().refreshConfiguration()
  return record
}

it('restores organization source selections from disk and rereads exact rules only after explicit Continue', async () => {
  const material = {
    id: 'a'.repeat(32),
    name: 'rules.txt',
    version: 'c'.repeat(64),
    size: 20,
    totalCharacters: 20,
  }
  const sources: OrganizationSource[] = [
    { kind: 'project', path: 'public/monitor.js', version: 'v2' },
    {
      kind: 'material',
      id: material.id,
      version: material.version,
      name: material.name,
    },
  ]
  const goal =
    'Organize this project, preserving algorithms and sound. Supplemental references only; no extra tasks.'
  vi.mocked(commands.listCreationMaterials).mockResolvedValue({
    status: 'ok',
    data: [material],
  })
  vi.mocked(commands.assistantProjectRead).mockResolvedValue({
    status: 'ok',
    data: {
      path: 'public/monitor.js',
      version: 'v2',
      text: 'Keep outlineSize = 0.5;',
      offset: 0,
      endOffset: 23,
      totalCharacters: 23,
      nextOffset: null,
      startLine: 1,
      endLine: 1,
    },
  })
  vi.mocked(commands.readCreationMaterial).mockResolvedValue({
    status: 'ok',
    data: {
      material,
      text: 'Preserve sound.scd!!',
      offset: 0,
      endOffset: 20,
      totalCharacters: 20,
      nextOffset: null,
      startLine: 1,
      endLine: 1,
    },
  })
  await boot([marker, { ...question, text: goal }, reply], { sources, goal })
  expect(commands.assistantModelTurn).not.toHaveBeenCalled()
  expect(commands.assistantProjectRead).not.toHaveBeenCalled()
  const ids = store().messages.map(message => message.id)
  await store().send(false, true)
  expect(store().error).toBeNull()
  const packet = vi.mocked(commands.assistantModelTurn).mock.calls[0]?.[1] ?? []
  expect(
    packet.some(
      message => message.contextKind === 'input' && message.content === goal
    )
  ).toBe(true)
  expect(
    packet.some(message => message.content?.includes('Keep outlineSize = 0.5;'))
  ).toBe(true)
  expect(
    packet.some(message => message.content?.includes('Preserve sound.scd!!'))
  ).toBe(true)
  expect(store().messages.map(message => message.id)).toEqual(ids)
  expect(commands.assistantProjectRead).toHaveBeenCalledWith(
    issuedOwner,
    expect.objectContaining({ path: 'public/monitor.js', version: 'v2' })
  )
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
})

it('restores the original edit and message pair for a newly issued owner, then waits for explicit Continue', async () => {
  await boot()
  expect(commands.loadCreationAssistantResume).toHaveBeenCalledWith(issuedOwner)
  expect(store()).toMatchObject({
    owner: issuedOwner,
    mode: 'edit',
    input: originalGoal,
    paused: true,
    canContinue: true,
    resumeRestored: true,
    resumeError: false,
    phase: 'idle',
  })
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  expect(commands.assistantModelTurn).not.toHaveBeenCalled()
  expect(store().historicalMessageIds).toContain(reply.id)
  const ids = store().messages.map(message => message.id)
  store().setInput('继续')
  await store().send()
  expect(store().messages.map(message => message.id)).toEqual(ids)
  expect(store().historicalMessageIds).not.toContain(question.id)
  expect(store().historicalMessageIds).not.toContain(reply.id)
  expect(
    store()
      .messages.filter(message => message.role === 'user')
      .map(message => message.text)
  ).toEqual([originalGoal])
  expect(
    store().messages.find(message => message.id === reply.id)
  ).toMatchObject({
    status: 'completed',
    text: expect.stringContaining('original edit'),
  })
  const packet = vi.mocked(commands.assistantModelTurn).mock.calls[0]?.[1] ?? []
  expect(
    packet
      .filter(message => message.contextKind === 'input')
      .map(message => message.content)
  ).toEqual([originalGoal])
  expect(packet.some(message => message.toolCallId === 'saved-read')).toBe(true)
  expect(commands.beginCreationAssistantTask).toHaveBeenCalledWith(
    issuedOwner,
    'edit',
    'original-native-task',
    { chatId: marker.id, messageId: reply.id }
  )
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
  expect(commands.clearCreationAssistantResume).toHaveBeenCalledWith(
    issuedOwner,
    'original-native-task'
  )
})

it('publishes fresh parameter controls after explicit Continue revalidates a restored task', async () => {
  await boot()
  const spec = {
    id: 'outlineSize',
    path: 'public/monitor.js',
    prefix: 'let outlineSize = ',
    suffix: ';',
    kind: 'number' as const,
    preview: 'unsupported' as const,
    limits: { min: 0.1, max: 1, step: 0.01, maxLength: null, options: [] },
  }
  vi.mocked(commands.readCreationFile).mockImplementation(
    async (_identity, path) => ({
      status: 'ok',
      data:
        path === 'pnds.preview.json'
          ? {
              kind: 'text',
              version: 'contract-v1',
              text: JSON.stringify({ schemaVersion: 1, parameters: [spec] }),
            }
          : { kind: 'text', version: 'v2', text: 'let outlineSize = 0.5;' },
    })
  )
  vi.mocked(commands.bindCreationParameters).mockImplementation(
    async (_identity, _path, _version, _text, parameters) => ({
      status: 'ok',
      data: {
        partial: false,
        contractVersion: 'contract-v1',
        parameters: parameters.map(request => ({ request, value: 0.5 })),
      },
    })
  )
  expect(useAssistantProposalStore.getState().items).toEqual({})
  expect(
    store().messages.find(message => message.id === reply.id)?.proposals
  ).toEqual([])
  store().setInput('Continue')
  await store().send()
  const published =
    store().messages.find(message => message.id === reply.id)?.proposals ?? []
  expect(published).toHaveLength(1)
  const control = published[0]
  if (!control)
    throw new Error('Restored task did not publish its fresh control')
  expect(control).toMatchObject({
    path: 'public/monitor.js',
    sourceVersion: 'v2',
    preview: 'none',
  })
  expect(useAssistantProposalStore.getState().items[control.id]).toMatchObject({
    taskId: 'original-native-task',
    source: { path: 'public/monitor.js', version: 'v2' },
  })
  expect(commands.bindCreationParameters).toHaveBeenCalledOnce()
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
})

it.each(['question', 'reply', 'topic', 'topic-and-pair'] as const)(
  'repairs missing %s display entries from a valid native checkpoint without sending a new request',
  async missing => {
    await boot(
      missing === 'topic-and-pair'
        ? []
        : [
            ...(missing === 'topic' ? [] : [marker]),
            ...(missing === 'question' ? [] : [question]),
            ...(missing === 'reply' ? [] : [reply]),
          ]
    )
    await store().restoreTask(true)
    for (const id of [marker.id, question.id, reply.id])
      expect(
        store().messages.filter(message => message.id === id)
      ).toHaveLength(1)
    expect(
      store()
        .messages.filter(message =>
          [question.id, reply.id].includes(message.id)
        )
        .map(message => message.id)
    ).toEqual([question.id, reply.id])
    expect(
      conversationMessages(store().messages, marker.id).map(
        message => message.id
      )
    ).toEqual([question.id, reply.id])
    expect(
      store().messages.find(message => message.id === question.id)?.text
    ).toBe(originalGoal)
    expect(
      store().messages.find(message => message.id === reply.id)?.activity
    ).toEqual(['Saved the requested source change.'])
    expect(store().activeConversationId).toBe(marker.id)
    expect(store().resumeRestored).toBe(true)
    expect(commands.assistantModelTurn).not.toHaveBeenCalled()
  }
)

it('clears a leftover native receipt when the matching reply was already completed', async () => {
  await boot([
    marker,
    question,
    { ...reply, text: 'Already completed.', status: 'completed' },
  ])
  await flushAssistantResume()
  expect(store()).toMatchObject({
    paused: false,
    canContinue: false,
    resumeRestored: false,
  })
  expect(store().messages.at(-1)?.text).toBe('Already completed.')
  expect(commands.clearCreationAssistantResume).toHaveBeenCalledWith(
    issuedOwner,
    'original-native-task'
  )
  expect(commands.assistantModelTurn).not.toHaveBeenCalled()
})

it('does not clear a completed reply checkpoint when its history failed to save and the creator switches chats', async () => {
  await boot()
  const other: AssistantMessage = { ...marker, id: 'other-chat' }
  useAssistantStore.setState(state => ({
    historySaveError: 'tooLarge',
    messages: [
      ...state.messages.map(message =>
        message.id === reply.id
          ? {
              ...message,
              text: 'Completed but not yet saved',
              status: 'completed' as const,
            }
          : message
      ),
      other,
    ],
  }))
  vi.mocked(commands.clearCreationAssistantResume).mockClear()
  store().switchConversation(other.id)
  await vi.waitFor(() => expect(store().historyBusy).toBe(false))
  store().switchConversation(marker.id)
  await vi.waitFor(() => expect(store().historyBusy).toBe(false))
  expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
  expect(
    store().messages.find(message => message.id === reply.id)
  ).toMatchObject({
    text: 'Completed but not yet saved',
    status: 'completed',
  })
  expect(store().resumeRestored).toBe(false)
  expect(commands.assistantModelTurn).not.toHaveBeenCalled()
})

it('refuses Continue under a different model configuration without discarding the recoverable task', async () => {
  await boot()
  useAssistantStore.setState({
    modelConfig: { ...config, model: 'different-profile' },
  })
  store().setInput('Continue')
  await store().send()
  expect(store()).toMatchObject({
    error: 'projectScopeChanged',
    resumeError: true,
    canContinue: true,
  })
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  expect(commands.assistantModelTurn).not.toHaveBeenCalled()
  expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
})

it.each(['cancel', 'new-topic'] as const)(
  'clears the native task only on explicit %s',
  async action => {
    await boot()
    if (action === 'cancel') store().stop()
    else store().newTopic()
    await flushAssistantResume()
    expect(commands.clearCreationAssistantResume).toHaveBeenCalledWith(
      issuedOwner,
      'original-native-task'
    )
    expect(store()).toMatchObject({
      paused: false,
      canContinue: false,
      resumeRestored: false,
    })
    expect(commands.assistantModelTurn).not.toHaveBeenCalled()
  }
)

it.each(['quit', 'workspace-switch'] as const)(
  'preserves the native original task during %s',
  async action => {
    await boot()
    if (action === 'quit') await stopAndPersistAssistantHistory()
    else
      useCreationStore.setState({
        workspace: {
          project: {
            identity: 'different-project',
            root: '/different-project',
            name: 'Other score',
            source: 'folder',
          },
          files: [],
        },
      })
    await flushAssistantResume()
    expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
    expect(commands.saveCreationAssistantResume).toHaveBeenCalledWith(
      issuedOwner,
      expect.objectContaining({
        taskId: 'original-native-task',
        mode: 'edit',
        input: originalGoal,
        userMessageId: question.id,
        replyMessageId: reply.id,
        state: 'paused',
      })
    )
    expect(commands.assistantModelTurn).not.toHaveBeenCalled()
  }
)

it('gates new topics and sends until the deferred native recovery read finishes', async () => {
  const record = await boot()
  type Loaded = Awaited<ReturnType<typeof commands.loadCreationAssistantResume>>
  let release: (result: Loaded) => void = () => {
    throw new Error('Missing deferred native read')
  }
  const deferred = new Promise<Loaded>(resolve => {
    release = resolve
  })
  vi.mocked(commands.loadCreationAssistantResume).mockReturnValue(deferred)
  vi.mocked(commands.loadCreationAssistantResume).mockClear()
  const loading = store().retryHistory()
  await vi.waitFor(() =>
    expect(commands.loadCreationAssistantResume).toHaveBeenCalled()
  )
  expect(store()).toMatchObject({ historyState: 'ready', historyBusy: true })
  const ids = store().messages.map(message => message.id)
  store().newTopic()
  await store().send()
  expect(store().messages.map(message => message.id)).toEqual(ids)
  expect(commands.assistantModelTurn).not.toHaveBeenCalled()
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  release({
    status: 'ok',
    data: { record, files: [{ path: 'public/monitor.js', version: 'v2' }] },
  })
  await loading
  expect(store()).toMatchObject({
    historyBusy: false,
    paused: true,
    resumeRestored: true,
  })
})

it('refuses deleting a paused other chat when native checkpoint lookup fails', async () => {
  await boot()
  const other: AssistantMessage = { ...marker, id: 'another-chat' }
  useAssistantStore.setState({ messages: [...store().messages, other] })
  store().switchConversation(other.id)
  await vi.waitFor(() => expect(store().historyBusy).toBe(false))
  await flushAssistantResume()
  vi.mocked(commands.loadCreationAssistantResume).mockResolvedValue({
    status: 'error',
    error: { code: 'io', detail: 'Transient checkpoint read failure' },
  })
  vi.mocked(commands.saveAssistantHistory).mockClear()
  vi.mocked(commands.clearCreationAssistantResume).mockClear()
  const visible = structuredClone(store().messages)
  expect(await store().deleteConversation(marker.id)).toBe(false)
  expect(store().messages).toEqual(visible)
  expect(store().historyError).toBe('io')
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
  expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
})

it('clears unknown durable checkpoints when clearing history without an in-memory retry', async () => {
  await boot()
  store().stop(true)
  await flushAssistantResume()
  vi.mocked(commands.clearCreationAssistantResume).mockClear()
  await store().clearHistory()
  expect(commands.clearCreationAssistantResume).toHaveBeenCalledWith(
    issuedOwner,
    null
  )
  expect(store().messages).toEqual([])
  expect(store().historyState).toBe('ready')
  expect(commands.assistantModelTurn).not.toHaveBeenCalled()
})

const resourcePlan = {
  id: 'original-native-task-resources-1',
  decision: 'pending' as const,
  reason:
    'Add client link and identity recovery while preserving the original score.',
  alternative: 'Keep the current HTTP transport',
  resources: [
    {
      kind: 'module' as const,
      id: 'players',
      version: '0.2.0',
      source: 'fixed',
    },
    {
      kind: 'library' as const,
      id: 'socket.io',
      version: '4.8.4',
      source: 'fixed',
    },
  ],
}

const hubResourcePlan = {
  ...resourcePlan,
  reason: 'Connect an existing hub and preserve local performer control.',
  alternative: 'Keep local performance without a remote relay',
  resources: [
    { kind: 'module' as const, id: 'hub', version: '0.2.0', source: 'fixed' },
    {
      kind: 'library' as const,
      id: 'socket.io-client',
      version: '4.8.4',
      source: 'fixed',
    },
  ],
}

it.each([resourcePlan, hubResourcePlan])(
  'restores the pending $resources.0.id card, confirms the same task and preserves the composer draft',
  async resourcePlan => {
    vi.mocked(commands.getCreationAssistantResourcePlans).mockResolvedValueOnce(
      {
        status: 'ok',
        data: [resourcePlan],
      }
    )
    await boot()
    expect(store().resourceApproval).toMatchObject({
      taskId: 'original-native-task',
      replyId: reply.id,
      plan: resourcePlan,
    })
    expect(store().canContinue).toBe(false)
    expect(store().phase).toBe('idle')
    expect(commands.assistantModelTurn).not.toHaveBeenCalled()
    await store().organizeContext()
    expect(store().resourceApproval).not.toBeNull()
    expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
    store().setInput('A different unsent question')
    await store().send()
    expect(commands.assistantModelTurn).not.toHaveBeenCalled()
    vi.mocked(commands.decideCreationAssistantResources).mockResolvedValueOnce({
      status: 'ok',
      data: { ...resourcePlan, decision: 'approved' },
    })
    vi.mocked(commands.beginCreationAssistantTask).mockResolvedValueOnce({
      status: 'ok',
      data: {
        id: 'original-native-task',
        mode: 'edit',
        files: [{ path: 'public/monitor.js', created: false, undone: false }],
        resourcePlans: [{ ...resourcePlan, decision: 'approved' }],
      },
    })
    await store().decideResourceApproval('approved')
    expect(commands.decideCreationAssistantResources).toHaveBeenCalledWith(
      issuedOwner,
      'original-native-task',
      resourcePlan.id,
      'approved'
    )
    expect(commands.assistantModelTurn).toHaveBeenCalledOnce()
    const messages =
      vi.mocked(commands.assistantModelTurn).mock.calls[0]?.[1] ?? []
    expect(messages[0]?.content).toContain('"decision":"approved"')
    expect(
      messages.filter(message => message.role === 'user').at(-1)?.content
    ).toContain(originalGoal)
    expect(
      store().messages.filter(message => message.role === 'user')
    ).toHaveLength(1)
    expect(
      store().messages.find(message => message.id === reply.id)?.status
    ).toBe('completed')
    expect(store().resourceApproval).toBeNull()
    expect(store().input).toBe('A different unsent question')
  }
)

it.each([resourcePlan, hubResourcePlan])(
  'only offers the selected $resources.0.id alternative on resumption without creating a new goal',
  async resourcePlan => {
    vi.mocked(commands.getCreationAssistantResourcePlans).mockResolvedValueOnce(
      {
        status: 'ok',
        data: [resourcePlan],
      }
    )
    await boot()
    vi.mocked(commands.decideCreationAssistantResources).mockResolvedValueOnce({
      status: 'ok',
      data: { ...resourcePlan, decision: 'alternative' },
    })
    vi.mocked(commands.beginCreationAssistantTask).mockResolvedValueOnce({
      status: 'ok',
      data: {
        id: 'original-native-task',
        mode: 'edit',
        files: [{ path: 'public/monitor.js', created: false, undone: false }],
        resourcePlans: [{ ...resourcePlan, decision: 'alternative' }],
      },
    })
    await store().decideResourceApproval('alternative')
    const messages =
      vi.mocked(commands.assistantModelTurn).mock.calls[0]?.[1] ?? []
    expect(messages[0]?.content).toContain(resourcePlan.alternative)
    expect(messages[0]?.content).toContain('"decision":"alternative"')
    expect(
      store().messages.find(message => message.id === question.id)?.text
    ).toBe(originalGoal)
    expect(commands.adoptCreationAssistantLibrary).not.toHaveBeenCalled()
    expect(commands.adoptCreationAssistantModule).not.toHaveBeenCalled()
  }
)

it('publishes a waiting checkpoint instead of completing the reply when the model proposes resources', async () => {
  vi.mocked(commands.getCreationAssistantResourcePlans).mockResolvedValue({
    status: 'ok',
    data: [],
  })
  await boot()
  vi.mocked(commands.proposeCreationAssistantResources).mockResolvedValueOnce({
    status: 'ok',
    data: {
      id: 'original-native-task',
      mode: 'edit',
      files: [{ path: 'public/monitor.js', created: false, undone: false }],
      resourcePlans: [resourcePlan],
    },
  })
  vi.mocked(commands.assistantModelTurn).mockResolvedValueOnce({
    status: 'ok',
    data: {
      text: 'Recommend local identity recovery.',
      toolCalls: [
        {
          id: 'new-resource-proposal',
          name: 'propose_local_resources',
          arguments: JSON.stringify({
            modules: ['players'],
            libraries: ['socket.io'],
            reason: resourcePlan.reason,
            alternative: resourcePlan.alternative,
          }),
        },
      ],
    },
  })
  await store().send()
  expect(store()).toMatchObject({
    phase: 'idle',
    error: null,
    canContinue: false,
    paused: false,
    resourceApproval: { replyId: reply.id, plan: resourcePlan },
  })
  expect(
    store().messages.find(message => message.id === reply.id)?.status
  ).toBe('pending')
  expect(commands.assistantModelTurn).toHaveBeenCalledOnce()
  expect(commands.saveCreationAssistantResume).toHaveBeenLastCalledWith(
    issuedOwner,
    expect.objectContaining({
      state: 'awaitingResources',
      input: originalGoal,
      replyMessageId: reply.id,
    })
  )
  expect(commands.endCreationAssistantTask).toHaveBeenCalledWith(
    issuedOwner,
    'original-native-task'
  )
  expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
})

it('does not resume after a late resource decision for a task that has already been ended', async () => {
  vi.mocked(commands.getCreationAssistantResourcePlans).mockResolvedValueOnce({
    status: 'ok',
    data: [resourcePlan],
  })
  await boot()
  let finish!: (
    value: Awaited<ReturnType<typeof commands.decideCreationAssistantResources>>
  ) => void
  vi.mocked(commands.decideCreationAssistantResources).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const decision = store().decideResourceApproval('approved')
  expect(store().resourceApprovalBusy).toBe(true)
  store().stop()
  finish({ status: 'ok', data: { ...resourcePlan, decision: 'approved' } })
  await decision
  expect(store().resourceApproval).toBeNull()
  expect(commands.assistantModelTurn).not.toHaveBeenCalled()
})

it('discards a hub card decision after switching projects', async () => {
  vi.mocked(commands.getCreationAssistantResourcePlans).mockResolvedValueOnce({
    status: 'ok',
    data: [hubResourcePlan],
  })
  await boot()
  let finish!: (
    value: Awaited<ReturnType<typeof commands.decideCreationAssistantResources>>
  ) => void
  vi.mocked(commands.decideCreationAssistantResources).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const pending = store().decideResourceApproval('approved')
  store().syncWorkspace('another-project')
  finish({ status: 'ok', data: { ...hubResourcePlan, decision: 'approved' } })
  await pending
  expect(store().resourceApproval).toBeNull()
  expect(commands.assistantModelTurn).not.toHaveBeenCalled()
  expect(commands.adoptCreationAssistantModule).not.toHaveBeenCalled()
})

const creativeQuestion = {
  id: 'creative-question',
  taskId: 'original-native-task',
  scope: { chatId: marker.id, messageId: reply.id },
  prompt: 'Should each performer control their own size?',
  options: [
    {
      id: 'individual',
      label: 'Independent sizes',
      description: 'Keeps individual agency.',
    },
  ],
  recommendedOptionId: 'individual',
  status: 'pending' as const,
  answer: null,
}
it('restores a question without model calls or answer authority, explicitly revalidates, then submits once to the original task', async () => {
  vi.mocked(commands.getCreationAssistantQuestions).mockResolvedValueOnce({
    status: 'ok',
    data: [creativeQuestion],
  })
  await boot()
  expect(store().activeQuestion).toMatchObject({
    question: creativeQuestion,
    ready: false,
  })
  await store().answerQuestion(creativeQuestion.id, {
    optionId: 'individual',
    text: null,
  })
  expect(commands.answerCreationAssistantQuestion).not.toHaveBeenCalled()
  expect(commands.assistantModelTurn).not.toHaveBeenCalled()
  vi.mocked(commands.beginCreationAssistantTask).mockResolvedValueOnce({
    status: 'ok',
    data: {
      id: 'original-native-task',
      mode: 'edit',
      files: [],
      questions: [creativeQuestion],
    },
  })
  await store().send(false, true)
  expect(store().activeQuestion?.ready).toBe(true)
  expect(commands.assistantModelTurn).not.toHaveBeenCalled()
  const answered = {
    ...creativeQuestion,
    status: 'answered' as const,
    answer: { optionId: null, text: 'Each performer, with a shared ending.' },
  }
  vi.mocked(commands.answerCreationAssistantQuestion).mockResolvedValueOnce({
    status: 'ok',
    data: answered,
  })
  vi.mocked(commands.beginCreationAssistantTask).mockResolvedValueOnce({
    status: 'ok',
    data: {
      id: 'original-native-task',
      mode: 'edit',
      files: [],
      questions: [answered],
    },
  })
  const submit = store().answerQuestion(creativeQuestion.id, answered.answer)
  await store().answerQuestion(creativeQuestion.id, {
    optionId: 'individual',
    text: null,
  })
  await submit
  expect(commands.answerCreationAssistantQuestion).toHaveBeenCalledTimes(1)
  expect(commands.answerCreationAssistantQuestion).toHaveBeenCalledWith(
    issuedOwner,
    'original-native-task',
    creativeQuestion.id,
    creativeQuestion.scope,
    answered.answer
  )
  expect(commands.assistantModelTurn).toHaveBeenCalledOnce()
  expect(
    store().messages.find(message => message.id === reply.id)?.questions
  ).toEqual([answered])
  expect(
    JSON.stringify(vi.mocked(commands.assistantModelTurn).mock.calls)
  ).toContain('Each performer, with a shared ending.')
})

it('keeps a late answer out of the next question or switched project and records explicit cancellation', async () => {
  vi.mocked(commands.getCreationAssistantQuestions).mockResolvedValueOnce({
    status: 'ok',
    data: [creativeQuestion],
  })
  await boot()
  vi.mocked(commands.beginCreationAssistantTask).mockResolvedValueOnce({
    status: 'ok',
    data: {
      id: 'original-native-task',
      mode: 'edit',
      files: [],
      questions: [creativeQuestion],
    },
  })
  await store().send(false, true)
  let finish!: (
    value: Awaited<ReturnType<typeof commands.answerCreationAssistantQuestion>>
  ) => void
  vi.mocked(commands.answerCreationAssistantQuestion).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const pending = store().answerQuestion(creativeQuestion.id, {
    optionId: 'individual',
    text: null,
  })
  vi.mocked(commands.cancelCreationAssistantQuestion).mockResolvedValueOnce({
    status: 'ok',
    data: { ...creativeQuestion, status: 'cancelled' },
  })
  store().stop()
  await vi.waitFor(() =>
    expect(
      store().messages.find(message => message.id === reply.id)?.questions?.[0]
        ?.status
    ).toBe('cancelled')
  )
  store().syncWorkspace('different-project')
  finish({
    status: 'ok',
    data: {
      ...creativeQuestion,
      status: 'answered',
      answer: { optionId: 'individual', text: null },
    },
  })
  await pending
  expect(commands.assistantModelTurn).not.toHaveBeenCalled()
  expect(store().activeQuestion).toBeNull()
  expect(commands.cancelCreationAssistantQuestion).toHaveBeenCalledWith(
    issuedOwner,
    'original-native-task',
    creativeQuestion.id,
    creativeQuestion.scope
  )
})

it('bases the next question on the submitted answer and rejects a stale first-card callback', async () => {
  vi.mocked(commands.getCreationAssistantQuestions).mockResolvedValueOnce({
    status: 'ok',
    data: [creativeQuestion],
  })
  await boot()
  vi.mocked(commands.beginCreationAssistantTask).mockResolvedValueOnce({
    status: 'ok',
    data: {
      id: 'original-native-task',
      mode: 'edit',
      files: [],
      questions: [creativeQuestion],
    },
  })
  await store().send(false, true)
  const answered = {
    ...creativeQuestion,
    status: 'answered' as const,
    answer: { optionId: 'individual', text: null },
  }
  const next = {
    ...creativeQuestion,
    id: 'timing-question',
    prompt: 'When may a performer change their size?',
    recommendedOptionId: null,
    options: [],
  }
  vi.mocked(commands.answerCreationAssistantQuestion).mockResolvedValueOnce({
    status: 'ok',
    data: answered,
  })
  vi.mocked(commands.beginCreationAssistantTask).mockResolvedValueOnce({
    status: 'ok',
    data: {
      id: 'original-native-task',
      mode: 'edit',
      files: [],
      questions: [answered],
    },
  })
  vi.mocked(commands.assistantModelTurn).mockImplementationOnce(
    async (_, messages) => {
      expect(messages[0]?.content).toContain('"optionId":"individual"')
      return {
        status: 'ok',
        data: {
          text: '',
          toolCalls: [
            {
              id: 'follow-up-question',
              name: 'ask_question',
              arguments: JSON.stringify({
                prompt: next.prompt,
                options: [],
                recommendedOptionId: null,
              }),
            },
          ],
        },
      }
    }
  )
  vi.mocked(commands.askCreationAssistantQuestion).mockResolvedValueOnce({
    status: 'ok',
    data: {
      id: 'original-native-task',
      mode: 'edit',
      files: [],
      questions: [answered, next],
    },
  })
  await store().answerQuestion(creativeQuestion.id, answered.answer)
  expect(store().activeQuestion?.question.id).toBe(next.id)
  expect(
    store().messages.find(message => message.id === reply.id)?.questions
  ).toEqual([answered, next])
  await store().answerQuestion(creativeQuestion.id, {
    optionId: 'individual',
    text: null,
  })
  expect(commands.answerCreationAssistantQuestion).toHaveBeenCalledOnce()
  expect(commands.assistantModelTurn).toHaveBeenCalledOnce()
})

async function bootCreativeQuestion(
  items: AssistantMessage[] = [marker, question, reply]
) {
  vi.mocked(commands.getCreationAssistantQuestions).mockResolvedValueOnce({
    status: 'ok',
    data: [creativeQuestion],
  })
  await boot(items)
  vi.mocked(commands.beginCreationAssistantTask).mockResolvedValueOnce({
    status: 'ok',
    data: {
      id: 'original-native-task',
      mode: 'edit',
      files: [],
      questions: [creativeQuestion],
    },
  })
  await store().send(false, true)
}

it.each(['delete-chat', 'clear-project'] as const)(
  '%s can recover full history while still retiring the native question task',
  async action => {
    const retained: AssistantMessage = {
      ...question,
      id: 'retained-chat',
      text: 'Keep the other chat',
      scope: 'platform',
    }
    await bootCreativeQuestion([retained, marker, question, reply])
    useAssistantStore.setState({ historySaveError: 'tooLarge' })
    vi.mocked(commands.saveAssistantHistory).mockImplementation(
      async (_owner, _epoch, messages) =>
        messages.some(message => message.id === reply.id)
          ? { status: 'error', error: { type: 'tooLarge' } }
          : { status: 'ok', data: null }
    )
    vi.mocked(commands.cancelCreationAssistantQuestion).mockResolvedValue({
      status: 'ok',
      data: { ...creativeQuestion, status: 'cancelled' },
    })
    if (action === 'delete-chat')
      expect(await store().deleteConversation(marker.id)).toBe(true)
    else await store().clearHistory()
    expect(store().messages).toMatchObject(
      action === 'delete-chat' ? [retained] : []
    )
    expect(store().messages).toHaveLength(action === 'delete-chat' ? 1 : 0)
    expect(store().historySaveError).toBeNull()
    expect(commands.endCreationAssistantTask).toHaveBeenCalledWith(
      issuedOwner,
      'original-native-task'
    )
    expect(commands.cancelCreationAssistantQuestion).toHaveBeenCalledWith(
      issuedOwner,
      'original-native-task',
      creativeQuestion.id,
      creativeQuestion.scope
    )
    expect(commands.undoCreationAssistantTask).not.toHaveBeenCalled()
    expect(commands.assistantModelTurn).not.toHaveBeenCalled()
    vi.mocked(commands.saveAssistantHistory).mockResolvedValue({
      status: 'ok',
      data: null,
    })
  }
)

it('retains a full chat after deletion publication fails and permits retry after the task was retired', async () => {
  const retained: AssistantMessage = {
    ...question,
    id: 'retained-chat',
    text: 'Keep the other chat',
    scope: 'platform',
  }
  await bootCreativeQuestion([retained, marker, question, reply])
  useAssistantStore.setState({ historySaveError: 'tooLarge' })
  let failPublication = true
  vi.mocked(commands.saveAssistantHistory).mockImplementation(
    async (_owner, _epoch, messages) => {
      if (messages.some(message => message.id === reply.id))
        return { status: 'error', error: { type: 'tooLarge' } }
      if (failPublication) return { status: 'error', error: { type: 'io' } }
      return { status: 'ok', data: null }
    }
  )
  vi.mocked(commands.cancelCreationAssistantQuestion).mockResolvedValue({
    status: 'ok',
    data: { ...creativeQuestion, status: 'cancelled' },
  })
  expect(await store().deleteConversation(marker.id)).toBe(false)
  expect(store().messages.map(message => message.id)).toEqual([
    retained.id,
    marker.id,
    question.id,
    reply.id,
  ])
  expect(
    store().messages.find(message => message.id === reply.id)?.questions
  ).toEqual([{ ...creativeQuestion, status: 'cancelled' }])
  failPublication = false
  expect(await store().deleteConversation(marker.id)).toBe(true)
  expect(store().messages).toMatchObject([retained])
  expect(store().messages).toHaveLength(1)
  expect(store().historySaveError).toBeNull()
  vi.mocked(commands.saveAssistantHistory).mockResolvedValue({
    status: 'ok',
    data: null,
  })
})

it.each(['returned error', 'rejected invoke'] as const)(
  'reports a %s while cancelling without fabricating cancelled history',
  async failure => {
    await bootCreativeQuestion()
    if (failure === 'returned error')
      vi.mocked(commands.cancelCreationAssistantQuestion).mockResolvedValueOnce(
        {
          status: 'error',
          error: { code: 'io', detail: 'Question journal could not be saved' },
        }
      )
    else
      vi.mocked(commands.cancelCreationAssistantQuestion).mockRejectedValueOnce(
        new Error('Invoke unavailable')
      )
    vi.mocked(commands.getCreationAssistantQuestions).mockResolvedValueOnce({
      status: 'ok',
      data: [creativeQuestion],
    })
    store().stop()
    expect(
      store().messages.find(message => message.id === reply.id)?.questions?.[0]
        ?.status
    ).toBe('pending')
    await vi.waitFor(() => expect(store().questionCancelError).toBe(true))
    expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
    expect(store().activeQuestion).toBeNull()
    expect(store().canContinue).toBe(false)
    expect(commands.assistantModelTurn).not.toHaveBeenCalled()
  }
)

it('retries only native cleanup after canonical cancellation and final chat publication already succeeded', async () => {
  await bootCreativeQuestion()
  vi.mocked(commands.cancelCreationAssistantQuestion).mockResolvedValueOnce({
    status: 'ok',
    data: { ...creativeQuestion, status: 'cancelled' },
  })
  vi.mocked(commands.clearCreationAssistantResume).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'io', detail: 'cleanup temporarily unavailable' },
  })
  store().stop()
  await expect(flushAssistantResume()).rejects.toThrow('io')
  const questionReads = vi.mocked(commands.getCreationAssistantQuestions).mock
    .calls.length
  const chatSaves = vi.mocked(commands.saveAssistantHistory).mock.calls.length
  await waitForAssistantTaskRetirements()
  expect(commands.cancelCreationAssistantQuestion).toHaveBeenCalledOnce()
  expect(commands.getCreationAssistantQuestions).toHaveBeenCalledTimes(
    questionReads
  )
  expect(commands.saveAssistantHistory).toHaveBeenCalledTimes(chatSaves)
  expect(commands.clearCreationAssistantResume).toHaveBeenCalledTimes(2)
})

it('waits for a question cancellation and its saved history before a new topic starts another native task', async () => {
  await bootCreativeQuestion()
  let finish!: () => void
  vi.mocked(commands.cancelCreationAssistantQuestion).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = () =>
          resolve({
            status: 'ok',
            data: { ...creativeQuestion, status: 'cancelled' },
          })
      })
  )
  const order: string[] = []
  vi.mocked(commands.clearCreationAssistantResume).mockImplementationOnce(
    async (_owner, taskId) => {
      const saved = vi
        .mocked(commands.saveAssistantHistory)
        .mock.calls.at(-1)?.[2]
      expect(
        saved?.find(message => message.id === reply.id)?.questions?.[0]?.status
      ).toBe('cancelled')
      order.push(`retired:${taskId}`)
      return { status: 'ok', data: null }
    }
  )
  vi.mocked(commands.beginCreationAssistantTask).mockImplementationOnce(
    async () => {
      order.push('new-task')
      return {
        status: 'ok',
        data: { id: 'new-topic-task', mode: 'discussion', files: [] },
      }
    }
  )
  store().newTopic()
  store().setInput('Discuss a separate idea.')
  const sending = store().send()
  await vi.waitFor(() =>
    expect(commands.cancelCreationAssistantQuestion).toHaveBeenCalled()
  )
  expect(order).toEqual([])
  expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
  finish()
  await sending
  expect(order).toEqual(['retired:original-native-task', 'new-task'])
  expect(
    vi
      .mocked(commands.clearCreationAssistantResume)
      .mock.calls.every(([, taskId]) => taskId !== null)
  ).toBe(true)
})

it('reconciles the canonical answer when answer persistence wins the race with Stop', async () => {
  await bootCreativeQuestion()
  const answered = {
    ...creativeQuestion,
    status: 'answered' as const,
    answer: { optionId: 'individual', text: null },
  }
  let finish!: (
    value: Awaited<ReturnType<typeof commands.answerCreationAssistantQuestion>>
  ) => void
  vi.mocked(commands.answerCreationAssistantQuestion).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const pending = store().answerQuestion(creativeQuestion.id, answered.answer)
  vi.mocked(commands.cancelCreationAssistantQuestion).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'io', detail: 'This question no longer awaits an answer' },
  })
  vi.mocked(commands.getCreationAssistantQuestions).mockResolvedValueOnce({
    status: 'ok',
    data: [answered],
  })
  store().stop()
  await vi.waitFor(() =>
    expect(
      store().messages.find(message => message.id === reply.id)?.questions
    ).toEqual([answered])
  )
  finish({ status: 'ok', data: answered })
  await pending
  expect(store().activeQuestion).toBeNull()
  expect(store().questionBusy).toBe(false)
  expect(store().questionCancelError).toBe(false)
  expect(commands.assistantModelTurn).not.toHaveBeenCalled()
})

it('clears a deleted question and fences its outstanding answer before a new task starts', async () => {
  await bootCreativeQuestion()
  let finish!: (
    value: Awaited<ReturnType<typeof commands.answerCreationAssistantQuestion>>
  ) => void
  vi.mocked(commands.answerCreationAssistantQuestion).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const pending = store().answerQuestion(creativeQuestion.id, {
    optionId: 'individual',
    text: null,
  })
  vi.mocked(commands.cancelCreationAssistantQuestion).mockResolvedValueOnce({
    status: 'ok',
    data: { ...creativeQuestion, status: 'cancelled' },
  })
  expect(await store().deleteConversation(marker.id)).toBe(true)
  expect(store().activeQuestion).toBeNull()
  expect(store().questionBusy).toBe(false)
  store().setMode('discussion')
  expect(store().mode).toBe('discussion')
  vi.mocked(commands.beginCreationAssistantTask).mockResolvedValueOnce({
    status: 'ok',
    data: { id: 'replacement-task', mode: 'discussion', files: [] },
  })
  store().setInput('Explain a separate creative idea.')
  await store().send()
  expect(commands.assistantModelTurn).toHaveBeenCalledOnce()
  finish({
    status: 'ok',
    data: {
      ...creativeQuestion,
      status: 'answered',
      answer: { optionId: 'individual', text: null },
    },
  })
  await pending
  expect(store().messages.some(message => message.id === reply.id)).toBe(false)
  expect(store().activeQuestion).toBeNull()
  expect(commands.assistantModelTurn).toHaveBeenCalledOnce()
})

it('promotes a surviving question while its answer is outstanding without changing the native scope', async () => {
  const original: AssistantMessage = {
    id: 'first-chat-message',
    role: 'user',
    text: 'An older separate chat.',
    status: 'completed',
    scope: 'platform',
    sources: [],
  }
  await bootCreativeQuestion([original, marker, question, reply])
  const answered = {
    ...creativeQuestion,
    status: 'answered' as const,
    answer: { optionId: 'individual', text: null },
  }
  let finish!: (
    value: Awaited<ReturnType<typeof commands.answerCreationAssistantQuestion>>
  ) => void
  vi.mocked(commands.answerCreationAssistantQuestion).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const pending = store().answerQuestion(creativeQuestion.id, answered.answer)
  expect(await store().deleteConversation(null)).toBe(true)
  expect(store().activeConversationId).toBeNull()
  expect(store().activeQuestion?.conversationId).toBeNull()
  expect(store().activeQuestion?.question.scope).toEqual(creativeQuestion.scope)
  expect(store().questionBusy).toBe(true)
  finish({ status: 'ok', data: answered })
  await pending
  expect(store().questionBusy).toBe(false)
  expect(
    store().messages.find(message => message.id === reply.id)?.questions
  ).toEqual([answered])
  expect(commands.beginCreationAssistantTask).toHaveBeenLastCalledWith(
    issuedOwner,
    'edit',
    'original-native-task',
    creativeQuestion.scope
  )
  expect(commands.assistantModelTurn).toHaveBeenCalledOnce()
})

it('answers a pending question after its chat is promoted while retaining its original native ownership', async () => {
  const original: AssistantMessage = {
    id: 'older-chat',
    role: 'user',
    text: 'Older chat',
    status: 'completed',
    scope: 'platform',
    sources: [],
  }
  await bootCreativeQuestion([original, marker, question, reply])
  expect(await store().deleteConversation(null)).toBe(true)
  const answered = {
    ...creativeQuestion,
    status: 'answered' as const,
    answer: { optionId: 'individual', text: null },
  }
  vi.mocked(commands.answerCreationAssistantQuestion).mockResolvedValueOnce({
    status: 'ok',
    data: answered,
  })
  await store().answerQuestion(creativeQuestion.id, answered.answer)
  expect(commands.answerCreationAssistantQuestion).toHaveBeenCalledWith(
    issuedOwner,
    creativeQuestion.taskId,
    creativeQuestion.id,
    creativeQuestion.scope,
    answered.answer
  )
  expect(commands.assistantModelTurn).toHaveBeenCalledOnce()
  expect(store().questionBusy).toBe(false)
})

it.each(['cancelled', 'answered'] as const)(
  'reconciles a durable %s fact after Stop closes the project before its receipt',
  async outcome => {
    await bootCreativeQuestion()
    let disk = structuredClone(store().messages)
    let canonical = {
      ...creativeQuestion,
      status: 'pending' as 'pending' | 'cancelled' | 'answered',
      answer: null as { optionId: string | null; text: string | null } | null,
    }
    vi.mocked(commands.saveAssistantHistory).mockImplementation(
      async (owner, _epoch, messages) => {
        if (owner === issuedOwner) disk = structuredClone(messages)
        return { status: 'ok', data: null }
      }
    )
    vi.mocked(commands.loadAssistantHistory).mockImplementation(
      async owner => ({
        status: 'ok',
        data: {
          epoch: 'loaded-history',
          projectKey: 'b'.repeat(64),
          appVersion: '1.7.0-dev',
          messages: owner === issuedOwner ? structuredClone(disk) : [],
        },
      })
    )
    vi.mocked(commands.loadCreationAssistantResume).mockResolvedValue({
      status: 'ok',
      data: null,
    })
    vi.mocked(commands.getCreationAssistantQuestions).mockImplementation(
      async owner => ({
        status: 'ok',
        data: owner === issuedOwner ? [canonical] : [],
      })
    )
    let finish!: () => void
    vi.mocked(commands.cancelCreationAssistantQuestion).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = () => {
            canonical = {
              ...creativeQuestion,
              status: outcome,
              answer:
                outcome === 'answered'
                  ? { optionId: 'individual', text: null }
                  : null,
            }
            resolve(
              outcome === 'cancelled'
                ? { status: 'ok', data: canonical }
                : {
                    status: 'error',
                    error: {
                      code: 'io',
                      detail: 'The answer was already saved',
                    },
                  }
            )
          }
        })
    )
    vi.mocked(commands.beginCreationAssistantTask).mockClear()
    vi.mocked(commands.beginAssistantRequest).mockClear()
    store().stop()
    store().syncWorkspace('other-project')
    await vi.waitFor(() => expect(store().historyState).toBe('ready'))
    finish()
    await flushAssistantHistory()
    await flushAssistantResume()
    expect(store().owner).toBe('other-project')
    expect(store().messages).toEqual([])
    expect(
      disk.find(message => message.id === reply.id)?.questions?.[0]?.status
    ).toBe(outcome)
    store().syncWorkspace(issuedOwner)
    await store().retryHistory()
    expect(
      store().messages.find(message => message.id === reply.id)?.questions
    ).toEqual([canonical])
    expect(store().activeQuestion).toBeNull()
    expect(commands.beginCreationAssistantTask).not.toHaveBeenCalled()
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
    expect(commands.assistantModelTurn).not.toHaveBeenCalled()
    await store().persistHistory()
    expect(disk.find(message => message.id === reply.id)?.questions).toEqual([
      canonical,
    ])
  }
)
