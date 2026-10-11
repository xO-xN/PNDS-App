import { beforeEach, expect, it, vi } from 'vitest'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
import { commands, type Manifest } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSessionStore } from '@/store/session-store'
import { CreationTestControls } from './CreationTestControls'
import { CreationConsole } from './CreationConsole'
import { useProjectStore } from '@/store/project-store'

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
    standaloneTarget: 'standalone:4000',
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
    workspace: null,
    opening: false,
    modePhase: 'idle',
  })
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'controls',
        root: '/draft',
        name: 'Draft',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationTestStore.setState({
    manifest,
    initialized: true,
    audioMode: 'internal',
    oscTarget: '127.0.0.1:50000',
  })
  const result = await commands.getSessionState()
  if (result.status === 'error') throw new Error(result.error)
  useSessionStore.getState().applySnapshot({
    ...result.data,
    status: 'ready',
    projectPath: '/draft',
    audioMode: 'internal',
  })
  useSessionStore.setState({ lanIp: '192.168.1.20', commandPending: false })
  vi.clearAllMocks()
})
it('stages audio changes independently of applied facts and restarts only after an explicit action', async () => {
  vi.mocked(commands.preflightCreationProject).mockResolvedValueOnce({
    status: 'ok',
    data: manifest,
  })
  render(<CreationTestControls />)
  fireEvent.change(screen.getByRole('combobox', { name: 'Test audio mode' }), {
    target: { value: 'external' },
  })
  expect(screen.getByText('Applied audio: Internal')).toBeInTheDocument()
  expect(
    screen.getByText('Configuration pending · restart to apply')
  ).toBeInTheDocument()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Restart test' }))
  await waitFor(() =>
    expect(commands.startCreationProject).toHaveBeenCalledWith(
      'controls',
      'external',
      '192.168.1.20',
      '127.0.0.1:50000'
    )
  )
  expect(screen.queryByText('Applied audio: External')).not.toBeInTheDocument()
})

it('inherits the actual external target on adoption and only offers saved supported modes', async () => {
  const snapshot = useSessionStore.getState().latestSnapshot
  if (!snapshot) throw new Error('Expected runtime snapshot')
  useSessionStore.getState().applySnapshot({
    ...snapshot,
    audioMode: 'external',
    oscTarget: 'actual-host:51000',
  })
  useCreationTestStore.setState({ initialized: false })
  vi.mocked(commands.getCreationManifest).mockResolvedValueOnce({
    status: 'ok',
    data: manifest,
  })
  await useCreationTestStore.getState().loadManifest()
  render(<CreationTestControls />)
  expect(
    screen.getByRole('textbox', { name: 'App test OSC target' })
  ).toHaveValue('actual-host:51000')
  vi.mocked(commands.getCreationManifest).mockResolvedValueOnce({
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
  await act(async () => {
    await useCreationTestStore.getState().loadManifest()
  })
  expect(
    within(
      screen.getByRole('combobox', { name: 'Test audio mode' })
    ).getAllByRole('option')
  ).toHaveLength(1)
  expect(screen.getByText('Applied audio: External')).toBeInTheDocument()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
})

it('keeps the workspace and project selection when closing a test', async () => {
  useProjectStore.setState({
    currentProject: { path: '/draft', manifest },
    preflightStatus: 'ready',
  })
  render(<CreationTestControls />)
  fireEvent.click(screen.getByRole('button', { name: 'Close test' }))
  await waitFor(() =>
    expect(useSessionStore.getState().sessionStatus).toBe('idle')
  )
  expect(useProjectStore.getState().currentProject?.path).toBe('/draft')
  expect(useCreationStore.getState().workspace?.project.identity).toBe(
    'controls'
  )
})

it('shows asynchronous health startup failure in the console and leaves Retry available', async () => {
  render(
    <>
      <CreationTestControls />
      <CreationConsole />
    </>
  )
  const snapshot = useSessionStore.getState().latestSnapshot
  if (!snapshot) throw new Error('Expected runtime snapshot')
  act(() =>
    useSessionStore.getState().applySnapshot({
      ...snapshot,
      status: 'error',
      error: 'Startup health timeout',
      outputTail: ['[node] health unavailable'],
    })
  )
  expect(
    await screen.findByText(/Runtime: Startup health timeout/)
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Retry test' })).toBeEnabled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
})
