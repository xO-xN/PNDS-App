import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, render, screen } from '@/test/test-utils'
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

it('keeps a stale creation QR out of the monitor without remounting it when projection changes', () => {
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
  useSessionStore.getState().applySnapshot(
    snapshot({
      performerQr: {
        url: 'http://stage.local:6868/',
        dataUrl: 'data:image/png;base64,aW1hZ2U=',
      },
    })
  )
  render(<MonitorView />)
  const frame = screen.getByTitle('Project monitor')
  expect(screen.queryByTestId('performer-qr-overlay')).not.toBeInTheDocument()
  expect(frame).not.toHaveAttribute('inert')
  expect(frame).not.toHaveAttribute('aria-hidden')
  act(() => useProjectionStore.getState().setWindowExists(true))
  expect(screen.queryByTestId('performer-qr-overlay')).not.toBeInTheDocument()
  act(() => useProjectionStore.getState().setWindowExists(false))
  expect(screen.queryByTestId('performer-qr-overlay')).not.toBeInTheDocument()
  expect(screen.getByTitle('Project monitor')).toBe(frame)
  expect(commands.togglePerformerQr).not.toHaveBeenCalled()
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

it('keeps device controls available without duplicate QR controls in either preview layout', async () => {
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
  const frame = screen.getByTitle('Project monitor')
  const address = frame.getAttribute('src')
  expect(screen.queryByTestId('performer-qr-button')).not.toBeInTheDocument()
  act(() => useCreationTestStore.setState({ expanded: true }))
  expect(screen.queryByTestId('performer-qr-button')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Performers · 0' }))
  expect(screen.queryByTestId('performer-qr-button')).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Performers' })).toBeVisible()
  expect(screen.getByTitle('Project monitor')).toBe(frame)
  expect(frame).toHaveAttribute('src', address)
  expect(commands.togglePerformerQr).not.toHaveBeenCalled()
})

it('keeps stale performance QR out of the monitor and the shared bar', () => {
  useSessionStore.getState().applySnapshot(
    snapshot({
      performerQr: {
        url: 'http://stage.local:6868/',
        dataUrl: 'data:image/png;base64,aW1hZ2U=',
      },
    })
  )
  render(
    <>
      <MonitorView />
      <DesktopBar />
    </>
  )
  expect(screen.queryByTestId('performer-qr-overlay')).not.toBeInTheDocument()
  expect(screen.queryByTestId('performer-qr-button')).not.toBeInTheDocument()
  expect(screen.getByTitle('Project monitor')).toBeInTheDocument()
  expect(commands.togglePerformerQr).not.toHaveBeenCalled()
})
