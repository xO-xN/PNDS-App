import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, render, screen, waitFor } from '@/test/test-utils'
import { commands, type SessionSnapshot } from '@/lib/tauri-bindings'
import { useSessionStore } from '@/store/session-store'
import { useCreationStore } from '@/store/creation-store'
import { useProjectionStore } from '@/store/projection-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { performerQrUrl } from '@/lib/performer-qr'
import { MonitorView } from '@/components/shell/MonitorView'
import { DesktopBar } from '@/components/shell/DesktopBar'
import { PerformerQrButton } from './PerformerQr'

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    status: 'ready',
    projectName: 'Running project',
    projectPath: '/running',
    audioMode: 'none',
    lanIp: '192.0.2.2',
    hostAddress: 'stage.local',
    oscTarget: null,
    health: {
      status: 'ready',
      scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
    },
    error: null,
    outputTail: [],
    volume: 80,
    startupStage: 5,
    channelPlan: null,
    outputDevice: null,
    projectionStarted: false,
    httpsEntry: { status: 'off', url: null, error: null },
    dnsMapping: { status: 'off', domain: null, ip: null, error: null },
    performerQr: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(commands.togglePerformerQr).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  useCreationStore.setState({
    active: false,
    opening: false,
    modePhase: 'idle',
    workspace: null,
    runtimeProject: null,
  })
  useCreationTestStore.setState({ expanded: false })
  useProjectionStore.getState().setWindowExists(false)
  useSessionStore.setState({ commandPending: false })
  useSessionStore.getState().applySnapshot(snapshot())
})

it('toggles from the real button and moves the overlay without remounting the monitor', async () => {
  vi.mocked(commands.togglePerformerQr).mockImplementation(async () => {
    const current = useSessionStore.getState().latestSnapshot
    if (!current) throw new Error('The QR workflow requires a running snapshot')
    useSessionStore.getState().applySnapshot({
      ...current,
      performerQr: current.performerQr
        ? null
        : {
            url: 'http://stage.local:6868/',
            dataUrl: 'data:image/png;base64,aW1hZ2U=',
          },
    })
    return { status: 'ok', data: null }
  })
  render(
    <>
      <MonitorView />
      <PerformerQrButton className="test-qr" />
    </>
  )
  const frame = screen.getByTitle('Project monitor')
  await userEvent.click(
    screen.getByRole('button', { name: 'Show performer QR code' })
  )
  expect(screen.getByTestId('performer-qr-overlay')).toHaveTextContent(
    'Running project'
  )
  expect(screen.getByTestId('performer-qr-overlay')).toHaveTextContent(
    'http://stage.local:6868/'
  )
  expect(screen.getByTitle('Project monitor')).toBe(frame)
  expect(frame).not.toHaveAttribute('inert')
  expect(frame).not.toHaveAttribute('aria-hidden')
  act(() => useProjectionStore.getState().setWindowExists(true))
  expect(screen.queryByTestId('performer-qr-overlay')).not.toBeInTheDocument()
  act(() => useProjectionStore.getState().setWindowExists(false))
  expect(screen.getByTestId('performer-qr-overlay')).toBeInTheDocument()
  expect(screen.getByTitle('Project monitor')).toBe(frame)
  await userEvent.click(screen.getByTestId('performer-qr-button'))
  expect(screen.queryByTestId('performer-qr-overlay')).not.toBeInTheDocument()
  expect(frame).not.toHaveAttribute('inert')
})

it('keeps pending generation cancellable and disables unavailable entries without HTTP fallback', async () => {
  useSessionStore.getState().applySnapshot(
    snapshot({
      performerQr: { url: 'http://stage.local:6868/', dataUrl: null },
    })
  )
  render(<PerformerQrButton className="test-qr" />)
  const cancel = screen.getByRole('button', { name: 'Hide performer QR code' })
  expect(cancel).toHaveAttribute('aria-busy', 'true')
  await userEvent.click(cancel)
  expect(commands.togglePerformerQr).toHaveBeenCalledOnce()
  const failed = snapshot({
    httpsEntry: {
      status: 'error',
      url: 'https://stage.example/join?room=2',
      error: 'unavailable',
    },
  })
  act(() => useSessionStore.getState().applySnapshot(failed))
  expect(
    screen.getByRole('button', { name: 'Show performer QR code' })
  ).toBeDisabled()
  expect(performerQrUrl(failed)).toBeNull()
  expect(
    performerQrUrl({
      ...failed,
      httpsEntry: { ...failed.httpsEntry, status: 'ready' },
    })
  ).toBe('https://stage.example/join?room=2')
})

it('places the creation control in the performers header instead of the shared bar', async () => {
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'identity',
        root: '/running',
        name: 'Running project',
        source: 'folder',
      },
      files: [],
    },
  })
  render(
    <>
      <MonitorView />
      <DesktopBar />
    </>
  )
  const qr = screen.getByRole('button', { name: 'Show performer QR code' })
  expect(qr.closest('.creation-performers header')).not.toBeNull()
  expect(qr.closest('.desktop-bar')).toBeNull()
  await userEvent.click(qr)
  await waitFor(() => expect(commands.togglePerformerQr).toHaveBeenCalledOnce())
  act(() => useCreationTestStore.setState({ expanded: true }))
  expect(screen.queryByTestId('performer-qr-button')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Performers · 0' }))
  const expandedQr = screen.getByRole('button', {
    name: 'Show performer QR code',
  })
  expect(expandedQr.closest('.creation-performer-popover')).not.toBeNull()
  await userEvent.click(expandedQr)
  expect(commands.togglePerformerQr).toHaveBeenCalledTimes(2)
})
