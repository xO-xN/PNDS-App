import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { useHostEntryStore } from '@/store/host-entry-store'
import { act, render, screen, waitFor } from '@/test/test-utils'
import type { SessionSnapshot } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { fireEvent } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { useSettingsStore } from '@/store/settings-store'
import { useSessionStore } from '@/store/session-store'
import { useCreationStore } from '@/store/creation-store'
import { useHostEntry } from '@/hooks/use-host-entry'
import { PublicEntryDetails } from './PublicEntryDetails'

const live: SessionSnapshot = {
  status: 'ready',
  projectName: 'Running score',
  projectPath: '/running-score',
  audioMode: 'none',
  lanIp: '192.168.8.20',
  hostAddress: null,
  oscTarget: null,
  health: {
    status: 'ready',
    scoreServer: { performerPort: 52341, monitorPort: 52342 },
  },
  error: null,
  outputTail: [],
  volume: 80,
  startupStage: 0,
  channelPlan: null,
  outputDevice: null,
  projectionStarted: false,
  httpsEntry: { status: 'off', url: null, error: null },
  dnsMapping: { status: 'off', domain: null, ip: null, error: null },
  clientEntryUrl: 'http://192.168.8.20:7341/',
}

function OnlineEntry() {
  useHostEntry()
  return <PublicEntryDetails />
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(commands.getHostEntryQr)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: 'data:image/png;base64,ZW50cnk=' })
  useSessionStore.getState().resetSession()
  useHostEntryStore.setState({
    snapshot: { status: 'unbound', url: null, error: null, portChanged: false },
  })
  usePerformanceRoleStore.setState({
    preferencesRestored: true,
    role: 'client',
  })
  useSettingsStore.setState({ nodeNameSetting: 'Stage' })
  useSessionStore.setState({ lanIp: '192.168.8.20', lanAddressesLoaded: true })
  useCreationStore.setState({ active: true })
})

it('prepares an idle entry across roles and explains the actual conflict address', async () => {
  vi.mocked(commands.syncHostEntry).mockResolvedValue({
    status: 'ok',
    data: {
      status: 'waiting',
      url: 'http://192.168.8.20:44222/',
      error: null,
      portChanged: true,
    },
  })
  render(<OnlineEntry />)
  expect(await screen.findByText('http://192.168.8.20:44222/')).toBeVisible()
  expect(screen.getByText('No public performance')).toBeVisible()
  expect(screen.getByText(/Update your saved entry/i)).toBeVisible()
  expect(commands.syncHostEntry).toHaveBeenCalledWith('192.168.8.20')
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
})

it('does not publish a guessed URL before the native listener reports its address', async () => {
  vi.mocked(commands.syncHostEntry).mockResolvedValue({
    status: 'ok',
    data: { status: 'unbound', url: null, error: null, portChanged: false },
  })
  render(<OnlineEntry />)
  await waitFor(() => expect(commands.syncHostEntry).toHaveBeenCalled())
  expect(screen.queryByText(/http:\/\//)).not.toBeInTheDocument()
  expect(screen.getByText('Entry not bound')).toBeVisible()
})

it('reports a runtime fault through read-only polls without rebinding the entry', async () => {
  vi.useFakeTimers()
  vi.mocked(commands.syncHostEntry).mockResolvedValue({
    status: 'ok',
    data: {
      status: 'waiting',
      url: 'http://192.168.8.20:44222/',
      error: null,
      portChanged: false,
    },
  })
  vi.mocked(commands.getHostEntry).mockResolvedValue({
    status: 'ok',
    data: {
      status: 'error',
      url: 'http://192.168.8.20:44222/',
      error: 'participation.errors.hostEntryRuntime: stopped',
      portChanged: false,
    },
  })
  try {
    render(<OnlineEntry />)
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(screen.getByText('http://192.168.8.20:44222/')).toBeVisible()
    expect(screen.getByText('Public entry unavailable')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy address' })).toBeDisabled()
    expect(commands.syncHostEntry).toHaveBeenCalledTimes(1)
    expect(commands.getHostEntry).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})

it('copies and generates QR from the same held idle entry without starting a performance', async () => {
  const url = 'http://192.168.8.20:44222/'
  useHostEntryStore.setState({
    snapshot: { status: 'waiting', url, error: null, portChanged: false },
  })
  render(<PublicEntryDetails />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Copy address' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(url))
  await user.click(screen.getByRole('button', { name: 'Show entry QR' }))
  await waitFor(() => expect(commands.getHostEntryQr).toHaveBeenCalledWith(url))
  expect(
    await screen.findByRole('img', { name: 'Public performance entry QR' })
  ).toHaveAttribute('src', 'data:image/png;base64,ZW50cnk=')
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(commands.syncHostEntry).not.toHaveBeenCalled()
})

it('keeps the quick invitation to its copyable address and QR, leaving diagnostics in Settings', async () => {
  const url = 'http://192.168.8.20:44222/'
  useHostEntryStore.setState({
    snapshot: {
      status: 'ready',
      url,
      error: null,
      portChanged: true,
      projectName: 'Running score',
      browserParticipation: 1,
    },
  })
  render(<PublicEntryDetails compact />)
  expect(screen.queryByText('Address')).not.toBeInTheDocument()
  expect(screen.getByText('192.168.8.20:44222')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Copy address' })).toBeEnabled()
  expect(
    await screen.findByRole('img', { name: 'Public performance entry QR' })
  ).toBeVisible()
  expect(screen.getByText('Performer entry')).toBeVisible()
  expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  expect(
    screen.queryByText('Public performance available')
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Running score')).not.toBeInTheDocument()
  expect(screen.queryByText(/Update your saved entry/i)).not.toBeInTheDocument()
  expect(
    screen.queryByText('Connection and port details')
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Copy address' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(url))
  expect(commands.getHostEntryQr).toHaveBeenCalledWith(url)
  expect(commands.startProject).not.toHaveBeenCalled()
})

it('reports QR failure and retries without publishing a stale result after the entry fails', async () => {
  const url = 'http://192.168.8.20:44222/'
  useHostEntryStore.setState({
    snapshot: { status: 'waiting', url, error: null, portChanged: false },
  })
  vi.mocked(commands.getHostEntryQr).mockReset()
  vi.mocked(commands.getHostEntryQr).mockResolvedValueOnce({
    status: 'error',
    error: 'encoder failed',
  })
  let finish!: (value: { status: 'ok'; data: string }) => void
  vi.mocked(commands.getHostEntryQr).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const user = userEvent.setup()
  render(<PublicEntryDetails />)
  await user.click(screen.getByRole('button', { name: 'Show entry QR' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not generate entry QR'
  )
  await user.click(screen.getByRole('button', { name: 'Retry entry QR' }))
  await waitFor(() => expect(commands.getHostEntryQr).toHaveBeenCalledTimes(2))
  act(() =>
    useHostEntryStore.setState({
      snapshot: {
        status: 'error',
        url,
        error: 'entry failed',
        portChanged: false,
      },
    })
  )
  await act(async () =>
    finish({ status: 'ok', data: 'data:image/png;base64,bGF0ZQ==' })
  )
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Show entry QR' })
  ).not.toBeInTheDocument()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('discloses the running project ports and a labeled legacy fallback independently of another selected card', async () => {
  useSessionStore.setState({ sessionStatus: 'ready', latestSnapshot: live })
  useProjectStore.setState({ pendingPreflightPath: '/another-project' })
  useHostEntryStore.setState({
    snapshot: {
      status: 'ready',
      url: 'http://192.168.8.20:7341/',
      error: null,
      portChanged: false,
      projectName: 'Running score',
      browserParticipation: null,
    },
  })
  render(<PublicEntryDetails />)
  expect(screen.getByText('Running score')).toBeVisible()
  expect(screen.getByText(/needs adaptation/i)).toBeVisible()
  expect(screen.queryByText('52341')).not.toBeVisible()
  fireEvent.click(screen.getByText('Connection and port details'))
  expect(screen.getByText('7341')).toBeVisible()
  expect(screen.getByText('52341')).toBeVisible()
  expect(screen.getByText('52342')).toBeVisible()
  expect(screen.getByText('http://192.168.8.20:52341/')).toBeVisible()
  fireEvent.click(
    screen.getByRole('button', { name: 'Copy legacy performer address' })
  )
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith('http://192.168.8.20:52341/')
  )
  expect(screen.getByText(/not guaranteed.*switch/i)).toBeVisible()
  expect(commands.startProject).not.toHaveBeenCalled()
})

it('retains actual local service diagnostics during a public fault and omits stale services after Stop', async () => {
  useSessionStore.setState({
    sessionStatus: 'ready',
    latestSnapshot: {
      ...live,
      appliedPorts: { performerPort: 53111, monitorPort: 53112 },
    },
  })
  useHostEntryStore.setState({
    snapshot: {
      status: 'error',
      url: 'http://192.168.8.20:7341/',
      error: 'participation.errors.hostEntryRuntime: fault',
      portChanged: false,
    },
  })
  render(<PublicEntryDetails />)
  expect(screen.getByRole('button', { name: 'Copy address' })).toBeDisabled()
  expect(
    screen.queryByRole('button', { name: 'Show entry QR' })
  ).not.toBeInTheDocument()
  expect(screen.getByText(/local performance continues/)).toBeVisible()
  expect(
    screen.getByText('participation.errors.hostEntryRuntime: fault')
  ).not.toBeVisible()
  fireEvent.click(screen.getByText('Connection and port details'))
  expect(
    screen.getByText('participation.errors.hostEntryRuntime: fault')
  ).toBeVisible()
  expect(screen.getByText('53111')).toBeVisible()
  expect(screen.getByText('53112')).toBeVisible()
  expect(screen.queryByText('52341')).not.toBeInTheDocument()
  act(() => useSessionStore.setState({ sessionStatus: 'idle' }))
  expect(
    screen.queryByText('Project performer service')
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Project monitor service')).not.toBeInTheDocument()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('shows the complete held address and real status in Settings and copies it with the icon', async () => {
  const url = 'http://192.168.8.20:44222/join?room=one&piece=two'
  useCreationStore.setState({ active: false })
  useHostEntryStore.setState({
    snapshot: {
      status: 'ready',
      url,
      error: null,
      portChanged: false,
      projectName: 'Running score',
      browserParticipation: 1,
    },
  })
  render(<PublicEntryDetails variant="settings" />)
  const address = screen.getByText(url)
  expect(address).toHaveAttribute('dir', 'ltr')
  expect(address).toHaveAttribute('tabindex', '0')
  expect(screen.getByText('Public performance available')).toBeVisible()
  const copy = screen.getByRole('button', { name: 'Copy address' })
  expect(copy).toHaveTextContent('')
  await userEvent.click(copy)
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(url))
  expect(commands.getHostEntryQr).not.toHaveBeenCalled()
  expect(
    screen.queryByText('Connection and port details')
  ).not.toBeInTheDocument()
  expect(commands.syncHostEntry).not.toHaveBeenCalled()
})

it('keeps a failed Settings entry address for diagnosis and disables inviting', () => {
  const url = 'http://192.168.8.20:44222/'
  useCreationStore.setState({ active: false })
  useHostEntryStore.setState({
    snapshot: {
      status: 'error',
      url,
      error: 'participation.errors.hostEntryRuntime: fault',
      portChanged: false,
    },
  })
  render(<PublicEntryDetails variant="settings" />)
  expect(screen.getByText(url)).toBeVisible()
  expect(screen.getByText('Public entry unavailable')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Copy address' })).toBeDisabled()
  expect(writeText).not.toHaveBeenCalled()
})

function prepareCreationSettingsEntry() {
  useCreationStore.setState({
    active: true,
    runtimeProject: null,
    opening: false,
    modePhase: 'idle',
    workspace: {
      project: {
        identity: 'settings-entry-test',
        root: '/test',
        name: 'Test',
        source: 'folder',
      },
      files: [],
    },
  })
  useSessionStore.getState().applySnapshot({
    ...live,
    projectPath: '/test',
    runtimeGeneration: '41',
    hostAddress: 'test.local',
    appliedPorts: { performerPort: 52341, monitorPort: 52342 },
  })
  useSessionStore.setState({ commandPending: false })
}

it('uses the current creation test entry in Settings rather than the unrelated public Host entry', async () => {
  prepareCreationSettingsEntry()
  useHostEntryStore.setState({
    snapshot: {
      status: 'waiting',
      url: 'http://unrelated-host:6868/',
      error: null,
      portChanged: false,
    },
  })
  render(<PublicEntryDetails variant="settings" />)
  expect(screen.getByText('http://test.local:52341/')).toBeVisible()
  expect(screen.queryByText(/unrelated-host/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Copy address' }))
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith('http://test.local:52341/')
  )
  expect(commands.getCreationPerformerQr).not.toHaveBeenCalled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
})

it.each(['stopped', 'workspace changed', 'generation changed'] as const)(
  'refuses a late Settings copy after the creation test is %s',
  change => {
    prepareCreationSettingsEntry()
    render(<PublicEntryDetails variant="settings" />)
    const copy = screen.getByRole('button', { name: 'Copy address' })
    copy.addEventListener(
      'click',
      () => {
        if (change === 'stopped')
          useSessionStore.setState({ sessionStatus: 'idle' })
        else if (change === 'workspace changed')
          useCreationStore.setState({
            workspace: {
              project: {
                identity: 'replacement-workspace',
                root: '/replacement',
                name: 'Replacement',
                source: 'folder',
              },
              files: [],
            },
          })
        else
          useSessionStore.setState({
            latestSnapshot: {
              ...live,
              projectPath: '/test',
              runtimeGeneration: '42',
            },
          })
      },
      { capture: true, once: true }
    )
    fireEvent.click(copy)
    expect(writeText).not.toHaveBeenCalled()
  }
)
