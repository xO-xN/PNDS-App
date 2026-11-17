import { beforeEach, expect, it, vi } from 'vitest'
import {
  commands,
  type CreationRuntime,
  type SessionSnapshot,
} from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import {
  refreshMonitorFromDisk,
  trackCreationRestart,
} from './creation-runtime-updates'
import { registerCreationParticipant } from './creation-lifecycle'

beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({ workspace: null })
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'pages',
        root: '/pages',
        name: 'Pages',
        source: 'folder',
      },
      files: [],
    },
  })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/pages',
    monitorReloadNonce: 0,
    monitorLoaded: true,
  })
})

it('refreshes saved pages through the existing reveal gate without saving drafts or restarting processes', async () => {
  useCreationFilesStore.getState().changed(['public/index.html', 'server.js'])
  await refreshMonitorFromDisk()
  expect(useSessionStore.getState().monitorLoaded).toBe(false)
  expect(useSessionStore.getState().monitorReloadNonce).toBe(1)
  expect(useCreationFilesStore.getState().pending.refresh).toBeGreaterThan(0)
  useSessionStore.getState().markMonitorLoaded()
  expect(useCreationFilesStore.getState().pending.refresh).toBe(0)
  expect(useCreationFilesStore.getState().pending.restart).toBeGreaterThan(0)
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
})

it('retains page changes arriving during navigation and rejects an old navigation after a project switch', async () => {
  useCreationFilesStore.getState().changed(['public/index.html'])
  await refreshMonitorFromDisk()
  useCreationFilesStore.getState().changed(['public/page.js'])
  useSessionStore.getState().markMonitorLoaded()
  expect(useCreationFilesStore.getState().pending.refresh).toBeGreaterThan(0)
  await refreshMonitorFromDisk()
  const previous = useCreationStore.getState().workspace
  if (!previous) throw new Error('Expected creation workspace')
  useCreationStore.setState({
    workspace: {
      ...previous,
      project: { ...previous.project, identity: 'next' },
    },
  })
  useCreationFilesStore.getState().changed(['public/new.html'])
  useSessionStore.getState().markMonitorLoaded()
  expect(useCreationFilesStore.getState().pending.refresh).toBeGreaterThan(0)
})

it('attempts all registered test pages and retains refresh prompts when any page fails', async () => {
  useCreationFilesStore.getState().changed(['public/index.html'])
  const failed = vi.fn().mockRejectedValue(new Error('client 1 failed'))
  const second = vi.fn().mockResolvedValue(undefined)
  const offFirst = registerCreationParticipant({ refreshPages: failed })
  const offSecond = registerCreationParticipant({ refreshPages: second })
  try {
    await expect(refreshMonitorFromDisk()).rejects.toThrow('client 1 failed')
    expect(second).toHaveBeenCalledWith({
      identity: 'pages',
      runId: useSessionStore.getState().runId,
      nonce: 1,
    })
    useSessionStore.getState().markMonitorLoaded()
    expect(useCreationFilesStore.getState().pending.refresh).toBeGreaterThan(0)
  } finally {
    offFirst()
    offSecond()
  }
})

function deferred<T>() {
  let resolve!: (result: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

async function readyRuntime(): Promise<CreationRuntime> {
  const base = await commands.getSessionState()
  if (base.status === 'error') throw new Error(base.error)
  const snapshot: SessionSnapshot = {
    ...base.data,
    status: 'ready',
    projectPath: '/pages',
    audioMode: 'none',
    outputTail: ['Current ready run'],
  }
  useSessionStore.getState().applySnapshot(snapshot)
  return { generation: 'submitted-run', projectRoot: '/pages', snapshot }
}

async function watchRestart(runtime: CreationRuntime) {
  useCreationFilesStore.getState().changed(['server.js'])
  const token = await useCreationFilesStore.getState().capture('/pages')
  expect(token).not.toBeNull()
  const probe =
    deferred<Awaited<ReturnType<typeof commands.getCreationRuntime>>>()
  vi.mocked(commands.getCreationRuntime).mockReturnValueOnce(probe.promise)
  const acknowledge = trackCreationRestart(token, '/pages')
  acknowledge(true, runtime.generation)
  expect(commands.getCreationRuntime).toHaveBeenCalledOnce()
  return probe
}

it('does not let a ready confirmation overwrite a newer runtime failure or acknowledge saved changes', async () => {
  const runtime = await readyRuntime()
  const probe = await watchRestart(runtime)
  useSessionStore.getState().applySnapshot({
    ...runtime.snapshot,
    status: 'error',
    error: 'New runtime failure',
    outputTail: ['Failure after the probe started'],
  })
  const revision = useSessionStore.getState().snapshotRevision
  const runId = useSessionStore.getState().runId
  probe.resolve({ status: 'ok', data: runtime })
  await probe.promise

  expect(useSessionStore.getState()).toMatchObject({
    sessionStatus: 'error',
    sessionError: 'New runtime failure',
    outputTail: ['Failure after the probe started'],
    snapshotRevision: revision,
    runId,
  })
  expect(useCreationFilesStore.getState().pending.restart).toBeGreaterThan(0)
})

it('confirms the submitted generation while retaining newer ready facts without republishing them', async () => {
  const runtime = await readyRuntime()
  const probe = await watchRestart(runtime)
  useSessionStore.getState().applySnapshot({
    ...runtime.snapshot,
    volume: 42,
    projectionStarted: true,
    outputTail: ['New ready output'],
  })
  const revision = useSessionStore.getState().snapshotRevision
  const runId = useSessionStore.getState().runId
  probe.resolve({ status: 'ok', data: runtime })
  await probe.promise

  expect(useSessionStore.getState()).toMatchObject({
    sessionStatus: 'ready',
    volume: 42,
    projectionStarted: true,
    outputTail: ['New ready output'],
    snapshotRevision: revision,
    runId: runId + 1,
  })
  expect(useCreationFilesStore.getState().pending.restart).toBe(0)
})

it.each(['generation', 'canonical-root', 'project-path'] as const)(
  'does not acknowledge saved changes using a ready reply with a different %s',
  async mismatch => {
    const runtime = await readyRuntime()
    const probe = await watchRestart(runtime)
    const different: CreationRuntime = {
      ...runtime,
      ...(mismatch === 'generation' ? { generation: 'another-run' } : {}),
      ...(mismatch === 'canonical-root' ? { projectRoot: '/another' } : {}),
      snapshot: {
        ...runtime.snapshot,
        ...(mismatch === 'project-path' ? { projectPath: '/another' } : {}),
      },
    }
    const revision = useSessionStore.getState().snapshotRevision
    const runId = useSessionStore.getState().runId
    probe.resolve({ status: 'ok', data: different })
    await probe.promise

    expect(useSessionStore.getState()).toMatchObject({
      sessionProjectPath: '/pages',
      snapshotRevision: revision,
      runId,
    })
    expect(useCreationFilesStore.getState().pending.restart).toBeGreaterThan(0)
  }
)

it('does not confirm a newer run from a probe dispatched for the previous run', async () => {
  const runtime = await readyRuntime()
  const probe = await watchRestart(runtime)
  useSessionStore.getState().applySnapshot({
    ...runtime.snapshot,
    status: 'starting',
    outputTail: ['A different start'],
  })
  useSessionStore.getState().applySnapshot({
    ...runtime.snapshot,
    outputTail: ['The newer run is ready'],
  })
  const revision = useSessionStore.getState().snapshotRevision
  const runId = useSessionStore.getState().runId
  probe.resolve({ status: 'ok', data: runtime })
  await probe.promise

  expect(useSessionStore.getState()).toMatchObject({
    outputTail: ['The newer run is ready'],
    snapshotRevision: revision,
    runId,
  })
  expect(useCreationFilesStore.getState().pending.restart).toBeGreaterThan(0)
})
