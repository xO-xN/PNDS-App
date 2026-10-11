import { beforeEach, expect, it, vi } from 'vitest'
import { commands, type Manifest } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { startCreationTest } from './session-flow'

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'draft',
  name: 'Draft',
  version: '1.0.0',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 6868,
    monitorPort: 6869,
  },
  audio: {
    defaultMode: 'internal',
    supportedModes: ['internal', 'external', 'none'],
    synthdefs: [],
    standaloneTarget: 'other-machine:5000',
    scsynth: { blockSize: 64, audioBusChannels: 128 },
  },
}
beforeEach(async () => {
  vi.clearAllMocks()
  const base = await commands.getSessionState()
  if (base.status === 'error') throw new Error(base.error)
  vi.mocked(commands.startCreationProject).mockImplementation(
    async (_identity, mode, lanIp, oscTarget) => ({
      status: 'ok',
      data: {
        generation: 'test-generation',
        projectRoot: '/draft',
        snapshot: {
          ...base.data,
          status: 'starting',
          projectPath: '/draft',
          audioMode: mode,
          lanIp,
          oscTarget,
        },
      },
    })
  )

  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'test',
        root: '/draft',
        name: 'Draft',
        source: 'folder',
      },
      files: [],
    },
    modePhase: 'idle',
    opening: false,
  })
  useSessionStore.getState().resetSession()
  useSessionStore.setState({ lanIp: '192.168.1.20' })
  useProjectStore.setState({
    currentProject: { path: '/other', manifest },
    activePreflight: null,
  })
})

it('preflights the saved workspace and starts through the shared workflow with the App test OSC target', async () => {
  vi.mocked(commands.preflightCreationProject).mockResolvedValueOnce({
    status: 'ok',
    data: manifest,
  })
  await startCreationTest('test', {
    audioMode: 'external',
    oscTarget: '127.0.0.1:50000',
  })
  expect(commands.preflightCreationProject).toHaveBeenCalledWith('test')
  expect(commands.startCreationProject).toHaveBeenCalledWith(
    'test',
    'external',
    '192.168.1.20',
    '127.0.0.1:50000'
  )
  expect(useProjectStore.getState().currentProject?.path).toBe('/draft')
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})

it('keeps an existing test and its workspace when saved-version preflight fails', async () => {
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/draft',
  })
  vi.mocked(commands.preflightCreationProject).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'invalidProject', detail: 'Missing compiled SynthDef' },
  })
  await expect(
    startCreationTest('test', {
      audioMode: 'none',
      oscTarget: '127.0.0.1:50000',
    })
  ).rejects.toMatchObject({ code: 'invalidProject' })
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(useSessionStore.getState().sessionStatus).toBe('ready')
  expect(useCreationStore.getState().workspace?.project.identity).toBe('test')
})

it('gates duplicate submissions and rejects a late preflight after workspace replacement', async () => {
  let resolve!: (
    result: Awaited<ReturnType<typeof commands.preflightCreationProject>>
  ) => void
  vi.mocked(commands.preflightCreationProject).mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done
      })
  )
  const first = startCreationTest('test', { audioMode: 'none', oscTarget: '' })
  expect(
    await startCreationTest('test', { audioMode: 'none', oscTarget: '' })
  ).toBeNull()
  const workspace = useCreationStore.getState().workspace
  if (!workspace) throw new Error('Expected test workspace')
  useCreationStore.setState({
    workspace: {
      ...workspace,
      project: { ...workspace.project, identity: 'next', root: '/next' },
    },
  })
  resolve({ status: 'ok', data: manifest })
  expect(await first).toBeNull()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(useProjectStore.getState().currentProject?.path).toBe('/other')
})

it('refuses unsupported saved modes and invalid External targets before any process action', async () => {
  vi.mocked(commands.preflightCreationProject).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...manifest,
      audio: {
        ...manifest.audio,
        supportedModes: ['none'],
        defaultMode: 'none',
      },
    },
  })
  await expect(
    startCreationTest('test', {
      audioMode: 'external',
      oscTarget: '127.0.0.1:50000',
    })
  ).rejects.toThrow('no longer allowed')
  vi.mocked(commands.preflightCreationProject).mockResolvedValueOnce({
    status: 'ok',
    data: manifest,
  })
  await expect(
    startCreationTest('test', { audioMode: 'external', oscTarget: 'bad' })
  ).rejects.toThrow('valid App test OSC target')
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('adopts a generation-confirmed ready reply and cold-fetches pages when startup events were missed', async () => {
  const base = await commands.getSessionState()
  if (base.status === 'error') throw new Error(base.error)
  const runtime = {
    generation: 'missed-events',
    projectRoot: '/draft',
    snapshot: {
      ...base.data,
      status: 'ready' as const,
      projectPath: '/draft',
      audioMode: 'none' as const,
    },
  }
  vi.mocked(commands.preflightCreationProject).mockResolvedValueOnce({
    status: 'ok',
    data: manifest,
  })
  vi.mocked(commands.startCreationProject).mockResolvedValueOnce({
    status: 'ok',
    data: runtime,
  })
  vi.mocked(commands.getCreationRuntime).mockResolvedValueOnce({
    status: 'ok',
    data: runtime,
  })
  const before = useSessionStore.getState().runId
  const nonce = useSessionStore.getState().monitorReloadNonce
  await startCreationTest('test', { audioMode: 'none', oscTarget: '' })
  await vi.waitFor(() =>
    expect(useSessionStore.getState().runId).toBeGreaterThan(before)
  )
  expect(useSessionStore.getState().monitorReloadNonce).toBe(nonce + 1)
  expect(useSessionStore.getState().sessionStatus).toBe('ready')
})
