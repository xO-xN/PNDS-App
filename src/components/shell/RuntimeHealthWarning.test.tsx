import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { render, screen, fireEvent, act, waitFor } from '@/test/test-utils'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { useCreationStore } from '@/store/creation-store'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { restart } from '@/lib/session-flow'
import { commands } from '@/lib/tauri-bindings'
import type {
  Manifest,
  RuntimeHealthSnapshot,
  SessionSnapshot,
} from '@/lib/tauri-bindings'
import { RuntimeHealthWarning } from './RuntimeHealthWarning'
import { MonitorView } from './MonitorView'

vi.mock('@/lib/session-flow', () => ({
  restart: vi.fn().mockResolvedValue(undefined),
}))

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'runes',
  name: 'Runes',
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
    supportedModes: ['internal'],
    synthdefs: [],
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}

const check = {
  status: 'healthy' as const,
  checkedAt: 18000,
  lastSuccessAt: 9000,
  firstFailureAt: null,
  consecutiveFailures: 0,
  error: null,
}
const unhealthy: RuntimeHealthSnapshot = {
  project: {
    ...check,
    status: 'unresponsive',
    firstFailureAt: 12000,
    consecutiveFailures: 3,
    error: 'health request timed out',
  },
  audio: { ...check },
}
function snapshot(
  runtimeHealth: RuntimeHealthSnapshot | null
): SessionSnapshot {
  return {
    status: 'ready',
    projectName: 'Runes',
    projectPath: '/runes',
    audioMode: 'internal',
    lanIp: '192.168.1.10',
    hostAddress: '192.168.1.10',
    oscTarget: '127.0.0.1:51000',
    health: null,
    error: null,
    outputTail: ['[node] diagnostic'],
    volume: 80,
    startupStage: 4,
    channelPlan: null,
    outputDevice: 'Applied speakers',
    appliedSampleRate: 48000,
    projectionStarted: false,
    httpsEntry: { status: 'off', url: null, error: null },
    dnsMapping: { status: 'off', domain: null, ip: null, error: null },
    runtimeHealth,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'focus').mockImplementation(vi.fn())
  useCreationStore.setState({ active: false, modePhase: 'idle' })
  usePerformanceRoleStore.getState().selectRole('host')
  useProjectStore.setState({
    currentProject: { path: '/runes', manifest },
  })
  useSessionStore.getState().resetSession()
  useSessionStore.getState().applySnapshot(snapshot(unhealthy))
  vi.mocked(commands.getSessionState).mockResolvedValue({
    status: 'ok',
    data: snapshot(unhealthy),
  })
})

afterEach(() => vi.restoreAllMocks())

describe('runtime health warning', () => {
  it('preserves the running monitor, its URL and focus while a warning appears and recovers', () => {
    const healthy = snapshot({ project: check, audio: check })
    healthy.health = {
      status: 'ready',
      projectId: 'runes',
      audioMode: 'internal',
      audio: { status: 'ready', target: '127.0.0.1:51000', error: null },
      scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
    }
    useSessionStore.getState().applySnapshot(healthy)
    render(
      <>
        <MonitorView />
        <RuntimeHealthWarning />
      </>
    )
    const iframe = screen.getByTitle('Project monitor')
    const originalUrl = iframe.getAttribute('src')
    const focus = document.activeElement
    const reload = useSessionStore.getState().monitorReloadNonce
    act(() =>
      useSessionStore
        .getState()
        .applySnapshot({ ...healthy, runtimeHealth: unhealthy })
    )
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByTitle('Project monitor')).toBe(iframe)
    expect(iframe.getAttribute('src')).toBe(originalUrl)
    expect(document.activeElement).toBe(focus)
    act(() => useSessionStore.getState().applySnapshot(healthy))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByTitle('Project monitor')).toBe(iframe)
    expect(iframe.getAttribute('src')).toBe(originalUrl)
    expect(useSessionStore.getState().monitorReloadNonce).toBe(reload)
  })

  it('keeps an unconfirmed performance running and never restarts automatically', () => {
    render(<RuntimeHealthWarning />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Runtime status could not be confirmed'
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'The performance continues'
    )
    expect(useSessionStore.getState().sessionStatus).toBe('ready')
    expect(restart).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('clears on recovery and ignores stopped, failed and Client-only sessions', () => {
    render(<RuntimeHealthWarning />)
    act(() =>
      useSessionStore
        .getState()
        .applySnapshot(snapshot({ project: check, audio: check }))
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => useSessionStore.getState().applySnapshot(snapshot(unhealthy)))
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => useSessionStore.setState({ sessionStatus: 'error' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => useSessionStore.setState({ sessionStatus: 'idle' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => {
      useSessionStore.getState().applySnapshot(snapshot(unhealthy))
      usePerformanceRoleStore.getState().selectRole('client')
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => useCreationStore.setState({ active: true }))
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows audio-only warnings and copies actual runtime facts with failure timing', async () => {
    useSessionStore
      .getState()
      .applySnapshot(snapshot({ project: check, audio: unhealthy.project }))
    useSessionStore.setState({ outputDevice: 'Next-start device' })
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: snapshot({
        project: check,
        audio: {
          ...unhealthy.project,
          checkedAt: 30000,
          consecutiveFailures: 6,
          error: 'latest response timed out',
        },
      }),
    })
    render(<RuntimeHealthWarning />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'could not confirm the status of the audio engine'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const details = JSON.parse(vi.mocked(writeText).mock.calls[0]?.[0] ?? '{}')
    expect(details.outputDevice).toBe('Applied speakers')
    expect(details.sampleRate).toBe(48000)
    expect(details.runtimeHealth.audio.firstFailureAt).toBe(12000)
    expect(details.runtimeHealth.audio.lastSuccessAt).toBe(9000)
    expect(details.runtimeHealth.audio.checkedAt).toBe(30000)
    expect(details.runtimeHealth.audio.consecutiveFailures).toBe(6)
    expect(details.runtimeHealth.audio.error).toBe('latest response timed out')
    expect(details.outputTail).toEqual(['[node] diagnostic'])
  })

  it('does not copy a backend reply after the displayed runtime was replaced', async () => {
    let respond:
      | ((value: Awaited<ReturnType<typeof commands.getSessionState>>) => void)
      | undefined
    vi.mocked(commands.getSessionState).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          respond = resolve
        })
    )
    render(<RuntimeHealthWarning />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))
    await act(async () => {
      useSessionStore.setState({ runId: useSessionStore.getState().runId + 1 })
      respond?.({ status: 'ok', data: snapshot(unhealthy) })
    })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('refuses mismatched backend runtime facts instead of copying stale store data', async () => {
    vi.mocked(commands.getSessionState).mockResolvedValueOnce({
      status: 'ok',
      data: { ...snapshot(unhealthy), projectPath: '/other' },
    })
    render(<RuntimeHealthWarning />)
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))
    )
    expect(writeText).not.toHaveBeenCalled()
  })

  it('restarts only by choice and fences the action to the displayed runtime', async () => {
    render(<RuntimeHealthWarning />)
    fireEvent.click(screen.getByRole('button', { name: 'Restart performance' }))
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1))
    expect(restart).toHaveBeenCalledWith({
      projectPath: '/runes',
      runId: useSessionStore.getState().runId,
    })
  })

  it('does not restart another selected project or submit a stale button from an earlier run', () => {
    const { unmount } = render(<RuntimeHealthWarning />)
    const oldButton = screen.getByRole('button', {
      name: 'Restart performance',
    })
    act(() => {
      useSessionStore.setState({ runId: useSessionStore.getState().runId + 1 })
      fireEvent.click(oldButton)
    })
    expect(restart).not.toHaveBeenCalled()
    unmount()
    useProjectStore.setState({
      currentProject: { path: '/other', manifest },
    })
    render(<RuntimeHealthWarning />)
    expect(
      screen.getByRole('button', { name: 'Restart performance' })
    ).toBeDisabled()
    expect(
      screen.getByText('Select the running project to restart it.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy details' })).toBeEnabled()
  })

  it('prevents duplicate restart submissions while an explicit restart is pending', async () => {
    let finish: (() => void) | undefined
    vi.mocked(restart).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    render(<RuntimeHealthWarning />)
    const button = screen.getByRole('button', { name: 'Restart performance' })
    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    expect(restart).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Restarting…' })).toBeDisabled()
    await act(async () => finish?.())
  })
})
