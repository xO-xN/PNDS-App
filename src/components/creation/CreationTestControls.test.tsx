import { beforeEach, expect, it, vi } from 'vitest'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  chooseSelectOption,
} from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { commands, type Manifest } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { CreationTestControls } from './CreationTestControls'
import { CreationConsole } from './CreationConsole'

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
    runtimeProject: null,
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

it('keeps an unchanged running test dim and available for a manual restart', () => {
  render(<CreationTestControls placement="bar" />)
  const button = screen.getByRole('button', { name: 'Restart test' })
  expect(button).toHaveAttribute('data-desktop-tone', 'neutral')
  expect(button).toBeEnabled()
  act(() =>
    useCreationFilesStore
      .getState()
      .changed(['README.en.md', 'AGENTS.md', 'docs/notes.md'])
  )
  expect(button).toHaveAttribute('data-desktop-tone', 'neutral')
})

it.each(['server.js', 'public/page.js', 'supercollider/source/synth.scd'])(
  'lights up for saved %s changes and dims only after the restarted test is ready',
  async path => {
    const snapshot = useSessionStore.getState().latestSnapshot
    if (!snapshot) throw new Error('Expected runtime snapshot')
    vi.mocked(commands.preflightCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: manifest,
    })
    vi.mocked(commands.getCreationRuntime).mockResolvedValueOnce({
      status: 'ok',
      data: {
        generation: 'test-generation',
        projectRoot: '/draft',
        snapshot,
      },
    })
    render(<CreationTestControls placement="bar" />)
    const button = screen.getByRole('button', { name: 'Restart test' })
    act(() => useCreationFilesStore.getState().changed([path]))
    expect(button).toHaveAttribute('data-desktop-tone', 'primary')
    fireEvent.click(button)
    await waitFor(() =>
      expect(useSessionStore.getState().sessionStatus).toBe('starting')
    )
    expect(button).toHaveAttribute('data-desktop-tone', 'primary')
    act(() => useSessionStore.getState().applySnapshot(snapshot))
    await waitFor(() =>
      expect(button).toHaveAttribute('data-desktop-tone', 'neutral')
    )
  }
)

it('keeps the ring lit for edits newer than a completed restart', async () => {
  render(<CreationTestControls placement="bar" />)
  const button = screen.getByRole('button', { name: 'Restart test' })
  act(() => useCreationFilesStore.getState().changed(['server.js']))
  const token = await useCreationFilesStore.getState().capture('/draft')
  act(() => {
    useCreationFilesStore.getState().changed(['public/page.js'])
    useCreationFilesStore.getState().complete(token, 'restart')
  })
  expect(button).toHaveAttribute('data-desktop-tone', 'primary')
})

it('highlights pending test configuration and dims when it matches the running test again', () => {
  render(<CreationTestControls placement="bar" />)
  const button = screen.getByRole('button', { name: 'Restart test' })
  act(() => useCreationTestStore.getState().setMode('external'))
  expect(button).toHaveAttribute('data-desktop-tone', 'primary')
  act(() => useCreationTestStore.getState().setMode('internal'))
  expect(button).toHaveAttribute('data-desktop-tone', 'neutral')
})

it('keeps initial loading and error retry highlighted', () => {
  useSessionStore.getState().resetSession()
  render(<CreationTestControls placement="bar" />)
  expect(screen.getByRole('button', { name: 'Start test' })).toHaveAttribute(
    'data-desktop-tone',
    'primary'
  )
  act(() => useSessionStore.setState({ sessionStatus: 'error' }))
  expect(screen.getByRole('button', { name: 'Retry test' })).toHaveAttribute(
    'data-desktop-tone',
    'primary'
  )
})

it('stages audio changes independently of applied facts and restarts only after an explicit action', async () => {
  vi.mocked(commands.preflightCreationProject).mockResolvedValueOnce({
    status: 'ok',
    data: manifest,
  })
  render(<CreationTestControls />)
  await chooseSelectOption('Test audio mode', 'External')
  expect(screen.getByText('Running · Internal')).toBeInTheDocument()
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
  expect(screen.queryByText('Running · External')).not.toBeInTheDocument()
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
  await userEvent.click(
    screen.getByRole('combobox', { name: 'Test audio mode' })
  )
  expect(
    within(screen.getByRole('listbox')).getAllByRole('option')
  ).toHaveLength(1)
  await userEvent.keyboard('{Escape}')
  expect(screen.getByText('Running · External')).toBeInTheDocument()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
})

it('keeps restart at the leading edge without a separate stop action', () => {
  render(<CreationTestControls />)
  expect(
    screen.queryByRole('button', { name: 'Close test' })
  ).not.toBeInTheDocument()
  expect(screen.getAllByRole('button')[0]).toHaveAccessibleName('Restart test')
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(useCreationStore.getState().workspace?.project.identity).toBe(
    'controls'
  )
})

it('retains error details and Retry without automatically expanding the console', async () => {
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
  expect(useCreationTestStore.getState().tab).toBe('file')
  act(() => useCreationTestStore.getState().setTab('console'))
  expect(
    await screen.findByText(/Runtime: Startup health timeout/)
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Retry test' })).toBeEnabled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
})
