import { render, screen, act, fireEvent, waitFor } from '@/test/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { ErrorScreen } from './ErrorScreen'
import { SessionActionButton } from './SessionActionButton'
import type { Manifest } from '@/lib/tauri-bindings'

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'inarticulate-iii',
  name: 'Inarticulate III',
  version: '0.1.0',
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
    synthdefs: ['supercollider/synthdefs/inarticulate-iii.scsyndef'],
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}

const PROJECT_PATH = '/Users/test/Inarticulate III'

/** §9.3: the state the user is actually looking at when they hit Retry. */
function seedErrorState() {
  useProjectStore.setState({
    currentProject: { path: PROJECT_PATH, manifest },
    recentProjectPaths: [PROJECT_PATH],
    preflightStatus: 'ready',
    preflightError: null,
  })
  useSessionStore.setState({
    sessionStatus: 'error',
    sessionError: 'Timed out waiting for the project to report ready (30s).',
    audioMode: 'internal',
    lanIp: '192.168.1.10',
    lanAddresses: ['192.168.1.10'],
    oscTargetInput: '127.0.0.1:3333',
    outputDevice: 'System default',
    deviceError: null,
    pendingChanges: false,
    health: null,
    outputTail: [],
  })
}

describe('Error Page Retry (§9.3, §10.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionStore.getState().resetSession()
    vi.mocked(commands.startProject).mockResolvedValue({
      status: 'ok',
      data: null,
    })
    vi.mocked(commands.stopProject).mockResolvedValue({
      status: 'ok',
      data: null,
    })
    seedErrorState()
  })

  it('shows the current error and an enabled Retry', () => {
    render(<ErrorScreen />)
    expect(
      screen.getByText(
        'Timed out waiting for the project to report ready (30s).'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
  })

  it('Retry starts the same project without stopping first', async () => {
    render(<ErrorScreen />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })

    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.startProject).toHaveBeenCalledTimes(1)
    expect(commands.startProject).toHaveBeenCalledWith(
      PROJECT_PATH,
      'internal',
      '192.168.1.10',
      null
    )
  })

  it('a double-click on Retry starts exactly one session', async () => {
    let release: (() => void) | undefined
    vi.mocked(commands.startProject).mockImplementation(
      () =>
        new Promise(resolve => {
          release = () => resolve({ status: 'ok', data: null })
        })
    )
    render(<ErrorScreen />)
    const retry = screen.getByRole('button', { name: 'Retry' })

    await act(async () => {
      fireEvent.click(retry)
      fireEvent.click(retry)
    })
    await act(async () => {
      release?.()
    })

    expect(commands.startProject).toHaveBeenCalledTimes(1)
  })

  it('Retry and the sidebar Load issue the identical start (§8.1 ≡ §9.3)', async () => {
    const { unmount } = render(<ErrorScreen />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })
    const viaRetry = vi.mocked(commands.startProject).mock.calls[0]
    unmount()

    vi.mocked(commands.startProject).mockClear()
    seedErrorState()
    render(<SessionActionButton />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    })
    const viaLoad = vi.mocked(commands.startProject).mock.calls[0]

    expect(viaLoad).toEqual(viaRetry)
  })

  it('the sidebar button stays Load (never Close) while in error', () => {
    render(<SessionActionButton />)
    const button = screen.getByRole('button')
    expect(button).toHaveTextContent('Load')
    expect(button).toBeEnabled()
  })

  it('Back returns to Welcome and does not auto-start', async () => {
    render(<ErrorScreen />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    })

    await waitFor(() => {
      expect(useSessionStore.getState().sessionStatus).toBe('idle')
    })
    expect(useProjectStore.getState().currentProject).toBeNull()
    expect(commands.stopProject).toHaveBeenCalledTimes(1)
    expect(commands.startProject).not.toHaveBeenCalled()
  })
})

/** v1.2.0 (issue #14): a port-conflict failure shows the occupant and a
 * one-interaction [Release and Retry] that clears the port, then restarts. */
describe('Error Page port-conflict linkage (v1.2.0 issue #14)', () => {
  const CONFLICT_ERROR =
    'Port 6868 is already in use.\nClose the application using it (find it with: lsof -i :6868) and try again.'
  const occupant = {
    pid: 4242,
    name: 'node',
    commandLine: '/usr/local/bin/node /Users/test/rogue/server.js',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useSessionStore.getState().resetSession()
    vi.mocked(commands.startProject).mockResolvedValue({
      status: 'ok',
      data: null,
    })
    vi.mocked(commands.stopProject).mockResolvedValue({
      status: 'ok',
      data: null,
    })
    seedErrorState()
    useSessionStore.setState({ sessionError: CONFLICT_ERROR })
  })

  it('shows the occupant identity for the conflicting port', async () => {
    vi.mocked(commands.checkPortStatus).mockResolvedValue({
      status: 'ok',
      data: { port: 6868, occupant },
    })

    render(<ErrorScreen />)

    // The identity loads asynchronously — wait for it before asserting.
    const block = await screen.findByText(
      '/usr/local/bin/node /Users/test/rogue/server.js'
    )
    expect(
      block.closest('[data-testid="port-conflict-block"]')
    ).toHaveTextContent('Port 6868 is held by:')
    expect(
      block.closest('[data-testid="port-conflict-block"]')
    ).toHaveTextContent('4242')
  })

  it('no conflict block for non-port errors', () => {
    useSessionStore.setState({
      sessionError: 'Timed out waiting for the project to report ready (30s).',
    })

    render(<ErrorScreen />)

    expect(screen.queryByTestId('port-conflict-block')).not.toBeInTheDocument()
    expect(commands.checkPortStatus).not.toHaveBeenCalled()
  })

  it('Release and Retry clears the port and restarts in one interaction', async () => {
    vi.mocked(commands.checkPortStatus).mockResolvedValue({
      status: 'ok',
      data: { port: 6868, occupant },
    })
    vi.mocked(commands.releasePort).mockResolvedValue({
      status: 'ok',
      data: { port: 6868, occupant: null },
    })

    render(<ErrorScreen />)
    // The button enables only once the occupant identity has loaded.
    await screen.findByText('/usr/local/bin/node /Users/test/rogue/server.js')
    const releaseAndRetry = screen.getByRole('button', {
      name: 'Release and Retry',
    })
    expect(releaseAndRetry).toBeEnabled()

    await act(async () => {
      fireEvent.click(releaseAndRetry)
    })

    expect(commands.releasePort).toHaveBeenCalledWith(6868)
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.startProject).toHaveBeenCalledTimes(1)
    expect(commands.startProject).toHaveBeenCalledWith(
      PROJECT_PATH,
      'internal',
      '192.168.1.10',
      null
    )
  })

  it('a failed release surfaces the error and does not start', async () => {
    vi.mocked(commands.checkPortStatus).mockResolvedValue({
      status: 'ok',
      data: { port: 6868, occupant },
    })
    vi.mocked(commands.releasePort).mockResolvedValue({
      status: 'error',
      error: 'signal permission denied',
    })

    render(<ErrorScreen />)
    await screen.findByText('/usr/local/bin/node /Users/test/rogue/server.js')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Release and Retry' }))
    })

    expect(commands.releasePort).toHaveBeenCalledWith(6868)
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('a freed port keeps plain Retry as the path (no occupant to release)', async () => {
    // The port freed itself while the error page was open: no identity to
    // show — the occupant line reads "Checking…" until resolution lands,
    // and the ordinary Retry button stays the enabled way forward.
    vi.mocked(commands.checkPortStatus).mockResolvedValue({
      status: 'ok',
      data: { port: 6868, occupant: null },
    })

    render(<ErrorScreen />)

    await waitFor(() => {
      expect(commands.checkPortStatus).toHaveBeenCalledWith(6868)
    })
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
  })
})
