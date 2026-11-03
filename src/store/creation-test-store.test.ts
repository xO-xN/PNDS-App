import { beforeEach, expect, it, vi } from 'vitest'
import { commands, type SessionSnapshot } from '@/lib/tauri-bindings'
import { useCreationStore } from './creation-store'
import { useCreationTestStore } from './creation-test-store'
import { useSessionStore } from './session-store'

type SnapshotResult = Awaited<ReturnType<typeof commands.getSessionState>>

function deferred<T>() {
  let resolve!: (result: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

let ready: SessionSnapshot
beforeEach(async () => {
  vi.clearAllMocks()
  const base = await commands.getSessionState()
  if (base.status === 'error') throw new Error(base.error)
  useCreationStore.setState({ workspace: null })
  useCreationStore.setState({
    active: true,
    runtimeProject: null,
    workspace: {
      project: {
        identity: 'logs',
        root: '/logs',
        name: 'Logs',
        source: 'folder',
      },
      files: [],
    },
  })
  ready = {
    ...base.data,
    status: 'ready',
    projectPath: '/logs',
    outputTail: ['Current log'],
    error: null,
  }
  useSessionStore.getState().applySnapshot(ready)
})

it('reads the current workspace log through the session snapshot', async () => {
  vi.mocked(commands.getSessionState).mockResolvedValueOnce({
    status: 'ok',
    data: { ...ready, outputTail: ['Latest disk log'] },
  })
  await useCreationTestStore.getState().readLog()

  expect(useCreationTestStore.getState()).toMatchObject({
    log: ['Latest disk log'],
    runtimeError: null,
  })
  expect(useSessionStore.getState().outputTail).toEqual(['Latest disk log'])
})

it('retains newer event output and error when an old log reply returns', async () => {
  const old = deferred<SnapshotResult>()
  vi.mocked(commands.getSessionState).mockReturnValueOnce(old.promise)
  const reading = useCreationTestStore.getState().readLog()
  useSessionStore.getState().applySnapshot({
    ...ready,
    status: 'error',
    error: 'A new failure',
    outputTail: ['New failure output'],
  })
  const revision = useSessionStore.getState().snapshotRevision
  old.resolve({ status: 'ok', data: ready })
  await reading

  expect(useCreationTestStore.getState()).toMatchObject({
    log: ['New failure output'],
    runtimeError: 'A new failure',
  })
  expect(useSessionStore.getState()).toMatchObject({
    sessionStatus: 'error',
    outputTail: ['New failure output'],
    snapshotRevision: revision,
  })
})

it('only allows the newest log request to publish while both reads belong to the same workspace', async () => {
  const old = deferred<SnapshotResult>()
  const current = deferred<SnapshotResult>()
  vi.mocked(commands.getSessionState)
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise)
  const first = useCreationTestStore.getState().readLog()
  const second = useCreationTestStore.getState().readLog()
  old.resolve({
    status: 'ok',
    data: { ...ready, outputTail: ['Superseded request'] },
  })
  await first
  expect(useCreationTestStore.getState().log).toEqual(['Current log'])

  current.resolve({
    status: 'ok',
    data: { ...ready, outputTail: ['Newest request'] },
  })
  await second
  expect(useCreationTestStore.getState().log).toEqual(['Newest request'])
})

it('does not publish a previous workspace log after the workspace changes', async () => {
  const old = deferred<SnapshotResult>()
  vi.mocked(commands.getSessionState).mockReturnValueOnce(old.promise)
  const reading = useCreationTestStore.getState().readLog()
  const workspace = useCreationStore.getState().workspace
  if (!workspace) throw new Error('Expected log workspace')
  useCreationStore.setState({
    workspace: {
      ...workspace,
      project: { ...workspace.project, identity: 'next', root: '/next' },
    },
  })
  old.resolve({ status: 'ok', data: ready })
  await reading
  expect(useCreationTestStore.getState()).toMatchObject({
    log: [],
    runtimeError: null,
  })
})

it('does not replace a new run with a previous run log at the same path', async () => {
  const old = deferred<SnapshotResult>()
  vi.mocked(commands.getSessionState).mockReturnValueOnce(old.promise)
  const reading = useCreationTestStore.getState().readLog()
  useSessionStore.getState().applySnapshot({
    ...ready,
    status: 'starting',
    outputTail: ['The new run starts'],
  })
  const runId = useSessionStore.getState().runId
  old.resolve({ status: 'ok', data: ready })
  await reading

  expect(useCreationTestStore.getState().log).toEqual(['The new run starts'])
  expect(useSessionStore.getState()).toMatchObject({
    sessionStatus: 'starting',
    runId,
  })
})
