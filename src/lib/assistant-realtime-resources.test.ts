import { beforeEach, expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  type AssistantContinuation,
  type AssistantDependencies,
} from './assistant-flow'
import { beginAssistantTask } from './assistant-task-tools'
import {
  commands,
  type AssistantResourcePlan,
  type AssistantProjectSnapshot,
} from './tauri-bindings'
import { HELP_BOOKS } from './help-corpus'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'

const snapshot: AssistantProjectSnapshot = {
  fingerprint: 'saved-score',
  files: [
    { path: 'server.js', version: 'server-v1', bytes: 100, reason: null },
    {
      path: 'public/monitor.js',
      version: 'monitor-v1',
      bytes: 100,
      reason: null,
    },
    {
      path: 'public/performer.js',
      version: 'performer-v1',
      bytes: 100,
      reason: null,
    },
  ],
}
const goal =
  '为演奏者界面新增功能：让每位演奏者的触摸点同步显示到指挥乐谱对应编号附近。'
let plans: AssistantResourcePlan[]

beforeEach(() => {
  vi.clearAllMocks()
  plans = []
  useCreationFilesStore.getState().clear()
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'owner',
        root: '/score-fixture',
        name: 'Runes scenario',
        source: 'folder',
      },
      files: [],
    },
  })
  vi.mocked(commands.beginCreationAssistantTask).mockImplementation(
    async (_owner, mode) => ({
      status: 'ok',
      data: {
        id: 'network-task',
        mode,
        files: [],
        resourcePlans: structuredClone(plans),
      },
    })
  )
  vi.mocked(commands.getCreationModules).mockResolvedValue({
    status: 'ok',
    data: {
      handoffVersion: null,
      modules: [
        {
          id: 'players',
          version: '0.2.0',
          shippedVersion: '0.2.0',
          source: { repository: 'local', revision: 'fixed', version: '0.2.0' },
          compatibility: null,
          state: 'available',
          files: ['modules/pnds-players/protocol.js'],
          recordVersion: null,
          error: null,
        },
      ],
    },
  })
  vi.mocked(commands.getCreationLibraries).mockResolvedValue({
    status: 'ok',
    data: {
      manifestVersion: 'manifest-v1',
      projectVersion: '1.0',
      libraries: [
        {
          id: 'socket.io',
          version: '4.8.4',
          kind: 'node',
          source: { url: 'local', integrity: 'fixed' },
          referencedVersion: null,
        },
      ],
    },
  })
  vi.mocked(commands.proposeCreationAssistantResources).mockImplementation(
    async (_owner, _task, request) => {
      if (!plans.length)
        plans = [
          {
            id: 'network-plan',
            reason: request.reason,
            alternative: request.alternative,
            decision: 'pending',
            resources: [
              ...request.modules.map(id => ({
                kind: 'module' as const,
                id,
                version: '0.2.0',
                source: 'fixed',
              })),
              ...request.libraries.map(id => ({
                kind: 'library' as const,
                id,
                version: '4.8.4',
                source: 'fixed',
              })),
            ],
          },
        ]
      return {
        status: 'ok',
        data: {
          id: 'network-task',
          mode: 'edit',
          files: [],
          resourcePlans: structuredClone(plans),
        },
      }
    }
  )
  vi.mocked(commands.assistantProjectInventory).mockResolvedValue({
    status: 'ok',
    data: snapshot,
  })
})

function harness(mode: 'edit' | 'handoff' = 'edit', input = goal) {
  const turn = vi
    .fn<AssistantDependencies['turn']>()
    .mockResolvedValue({ text: 'The task is complete.', toolCalls: [] })
  const dependencies: AssistantDependencies = {
    begin: async (_, requestId) => ({
      requestId,
      model: 'scripted-provider',
      baseUrl: 'http://local-fixture',
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
    task: beginAssistantTask,
    projectInventory: async () => snapshot,
    turn,
  }
  const request = {
    identity: 'owner',
    mode,
    input,
    history: [],
    locale: 'en' as const,
    signal: new AbortController().signal,
    isCurrent: () => true,
    projectReading: true,
    project: snapshot,
  }
  return { dependencies, request, turn }
}

it('creates the multiplayer resource recommendation before a provider can skip discovery and write a custom HTTP relay', async () => {
  const h = harness()
  h.turn.mockResolvedValueOnce({
    text: 'I will extend the HTTP relay directly.',
    toolCalls: [
      {
        id: 'bypass-discovery',
        name: 'create_project_file',
        arguments: JSON.stringify({
          path: 'public/new-relay.js',
          text: '// custom HTTP relay',
        }),
      },
    ],
  })
  let checkpoint: AssistantContinuation | null = null
  const result = await runAssistantRequest(
    {
      ...h.request,
      onContinuation: value => {
        checkpoint = value
      },
    },
    h.dependencies
  )
  expect(
    result.resourcePlan?.resources.map(item => `${item.kind}:${item.id}`)
  ).toEqual(['module:players', 'library:socket.io'])
  expect(h.turn).not.toHaveBeenCalled()
  expect(commands.getCreationModules).toHaveBeenCalledOnce()
  expect(commands.proposeCreationAssistantResources).toHaveBeenCalledOnce()
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  expect(commands.decideCreationAssistantResources).not.toHaveBeenCalled()
  expect(checkpoint).toMatchObject({
    taskId: 'network-task',
    toolCalls: 0,
    calls: [],
  })
  expect(commands.endCreationAssistantTask).toHaveBeenCalledWith(
    'owner',
    'network-task'
  )
})

it('reuses a confirmed group on continuation without changing the original goal or creating another recommendation', async () => {
  const h = harness()
  let checkpoint: AssistantContinuation | null = null
  await runAssistantRequest(
    {
      ...h.request,
      onContinuation: value => {
        checkpoint = value
      },
    },
    h.dependencies
  )
  if (!plans[0]) throw new Error('Missing multiplayer recommendation')
  plans[0].decision = 'approved'
  const result = await runAssistantRequest(
    { ...h.request, continuation: checkpoint ?? undefined },
    h.dependencies
  )
  expect(result.resourcePlan).toBeUndefined()
  expect(h.turn).toHaveBeenCalledOnce()
  const packet = h.turn.mock.calls[0]?.[1] ?? []
  expect(packet[0]?.content).toContain('"decision":"approved"')
  expect(packet.find(message => message.role === 'user')?.content).toContain(
    goal
  )
  expect(plans).toHaveLength(1)
  expect(plans[0]?.decision).toBe('approved')
})

it('does not add a resource preflight to an ordinary visual edit in a multiplayer conversation', async () => {
  const h = harness('edit', '把演奏者页面的字体调大一点，并将背景改成白色。')
  const result = await runAssistantRequest(
    {
      ...h.request,
      history: [
        {
          id: 'earlier-goal',
          role: 'user',
          text: goal,
          status: 'completed',
          scope: 'project',
          sources: [],
        },
      ],
    },
    h.dependencies
  )
  expect(result.resourcePlan).toBeUndefined()
  expect(h.turn).toHaveBeenCalledOnce()
  expect(commands.getCreationModules).not.toHaveBeenCalled()
  expect(commands.proposeCreationAssistantResources).not.toHaveBeenCalled()
})

it('reuses installed Socket.IO and the players source without another approval', async () => {
  const modules = await commands.getCreationModules('owner')
  const libraries = await commands.getCreationLibraries('owner')
  if (modules.status !== 'ok' || libraries.status !== 'ok')
    throw new Error('Missing catalog fixture')
  const players = modules.data.modules[0]
  const socket = libraries.data.libraries[0]
  if (!players || !socket) throw new Error('Missing resource fixture')
  players.state = 'needsHandoff'
  players.recordVersion = 'module-record'
  socket.referencedVersion = '4.8.4'
  vi.mocked(commands.getCreationModules).mockResolvedValueOnce(modules)
  vi.mocked(commands.getCreationLibraries).mockResolvedValueOnce(libraries)
  const h = harness()
  await runAssistantRequest(h.request, h.dependencies)
  expect(commands.proposeCreationAssistantResources).not.toHaveBeenCalled()
  expect(h.turn).toHaveBeenCalledOnce()
  expect(h.turn.mock.calls[0]?.[1][0]?.content).toContain(
    'multiperformerRealtime'
  )
})

it('keeps a selected existing-transport option on continuation instead of re-proposing the preferred resources', async () => {
  const h = harness()
  let checkpoint: AssistantContinuation | null = null
  const first = await runAssistantRequest(
    {
      ...h.request,
      onContinuation: value => {
        checkpoint = value
      },
    },
    h.dependencies
  )
  expect(first.resourcePlan?.alternative).toBeTruthy()
  const plan = plans[0]
  if (!plan) throw new Error('Missing recommendation')
  plan.decision = 'alternative'
  await runAssistantRequest(
    { ...h.request, continuation: checkpoint ?? undefined },
    h.dependencies
  )
  expect(h.turn).toHaveBeenCalledOnce()
  expect(h.turn.mock.calls[0]?.[1][0]?.content).toContain('"keepExisting":true')
  expect(h.turn.mock.calls[0]?.[1][0]?.content).toContain(
    '"decision":"alternative"'
  )
  expect(commands.proposeCreationAssistantResources).toHaveBeenCalledOnce()
})

it('restores an unanswered recommendation without model work or another catalog lookup', async () => {
  const h = harness()
  let checkpoint: AssistantContinuation | null = null
  const first = await runAssistantRequest(
    {
      ...h.request,
      onContinuation: value => {
        checkpoint = value
      },
    },
    h.dependencies
  )
  const restored = await runAssistantRequest(
    { ...h.request, continuation: checkpoint ?? undefined },
    h.dependencies
  )
  expect(restored.resourcePlan?.id).toBe(first.resourcePlan?.id)
  expect(h.turn).not.toHaveBeenCalled()
  expect(commands.getCreationModules).toHaveBeenCalledOnce()
  expect(commands.getCreationLibraries).toHaveBeenCalledOnce()
  expect(commands.proposeCreationAssistantResources).toHaveBeenCalledOnce()
})

it('supplies the same multiplayer priority in handoff without creating an implementation approval', async () => {
  const h = harness('handoff')
  const result = await runAssistantRequest(h.request, h.dependencies)
  expect(result.resourcePlan).toBeUndefined()
  expect(commands.getCreationModules).toHaveBeenCalledOnce()
  expect(commands.proposeCreationAssistantResources).not.toHaveBeenCalled()
  expect(h.turn.mock.calls[0]?.[1][0]?.content).toContain(
    'multiperformerRealtime'
  )
  expect(h.turn.mock.calls[0]?.[1][0]?.content).toContain('Mode: handoff')
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
})

it('honors a direct no-new-dependencies instruction while retaining multiplayer guidance', async () => {
  const h = harness('edit', goal + '本次保留 HTTP，不要新增依赖。')
  const result = await runAssistantRequest(h.request, h.dependencies)
  expect(result.resourcePlan).toBeUndefined()
  expect(commands.proposeCreationAssistantResources).not.toHaveBeenCalled()
  expect(h.turn.mock.calls[0]?.[1][0]?.content).toContain('"keepExisting":true')
})

it('stops safely when the required local catalog cannot be verified', async () => {
  const h = harness()
  vi.mocked(commands.getCreationLibraries).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'io', detail: 'Local catalog unavailable' },
  })
  await expect(
    runAssistantRequest(h.request, h.dependencies)
  ).rejects.toMatchObject({ code: 'requestFailed' })
  expect(h.turn).not.toHaveBeenCalled()
  expect(commands.proposeCreationAssistantResources).not.toHaveBeenCalled()
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  expect(commands.endCreationAssistantTask).toHaveBeenCalledWith(
    'owner',
    'network-task'
  )
})

it('does not re-ask when the human explicitly requested both prioritized resources', async () => {
  const h = harness(
    'edit',
    '添加 players 模块和 socket.io 共享包，让演奏者连接并同步触摸。'
  )
  vi.mocked(commands.decideCreationAssistantResources).mockImplementationOnce(
    async (_owner, _task, id) => {
      const plan = plans.find(plan => plan.id === id)
      if (!plan) throw new Error('Unknown plan')
      plan.decision = 'approved'
      return { status: 'ok', data: structuredClone(plan) }
    }
  )
  const result = await runAssistantRequest(h.request, h.dependencies)
  expect(result.resourcePlan).toBeUndefined()
  expect(commands.decideCreationAssistantResources).toHaveBeenCalledWith(
    'owner',
    'network-task',
    'network-plan',
    'approved'
  )
  expect(h.turn).toHaveBeenCalledOnce()
})

it('releases the native request slot before publishing a resource wait that can be confirmed immediately', async () => {
  const h = harness()
  let finishCancel!: () => void
  const cancellation = new Promise<void>(resolve => {
    finishCancel = resolve
  })
  h.dependencies.cancel = vi.fn(() => cancellation)
  let returned = false
  const waiting = runAssistantRequest(h.request, h.dependencies).then(
    result => {
      returned = true
      return result
    }
  )
  await vi.waitFor(() => expect(h.dependencies.cancel).toHaveBeenCalledOnce())
  expect(returned).toBe(false)
  expect(commands.endCreationAssistantTask).toHaveBeenCalledWith(
    'owner',
    'network-task'
  )
  finishCancel()
  expect((await waiting).resourcePlan?.id).toBe('network-plan')
})

it('checkpoints a complete resource boundary when paused during native proposal creation, then resumes to the same card', async () => {
  const h = harness()
  const pause = new AbortController()
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>(resolve => {
    entered = resolve
  })
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  const propose = vi
    .mocked(commands.proposeCreationAssistantResources)
    .getMockImplementation()
  if (!propose) throw new Error('Missing proposal implementation')
  vi.mocked(commands.proposeCreationAssistantResources).mockImplementationOnce(
    async (...args) => {
      const result = await propose(...args)
      entered()
      await held
      return result
    }
  )
  let checkpoint: AssistantContinuation | null = null
  const pending = runAssistantRequest(
    {
      ...h.request,
      pauseSignal: pause.signal,
      onContinuation: value => {
        checkpoint = value
      },
    },
    h.dependencies
  )
  const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' })
  await started
  pause.abort()
  release()
  await rejected
  expect(checkpoint).toMatchObject({
    taskId: 'network-task',
    toolCalls: 0,
    calls: [],
  })
  expect(h.turn).not.toHaveBeenCalled()
  const resumed = await runAssistantRequest(
    { ...h.request, continuation: checkpoint ?? undefined },
    h.dependencies
  )
  expect(resumed.resourcePlan?.id).toBe('network-plan')
  expect(commands.proposeCreationAssistantResources).toHaveBeenCalledOnce()
})
