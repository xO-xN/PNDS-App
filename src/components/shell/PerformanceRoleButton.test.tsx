import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@/test/test-utils'
import {
  commands,
  type ClientSnapshot,
  type Manifest,
  type SessionSnapshot,
} from '@/lib/tauri-bindings'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { useClientParticipationStore } from '@/store/client-participation-store'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { useSettingsStore } from '@/store/settings-store'
import { useCreationStore } from '@/store/creation-store'
import { notifications } from '@/lib/notifications'
import i18n from '@/i18n/config'
import { SessionActionButton } from './SessionActionButton'
import { PerformanceRoleButton } from './PerformanceRoleButton'

const idle: ClientSnapshot = {
  revision: 1,
  phase: 'idle',
  address: null,
  host: null,
  expectedHostId: null,
  pageUrl: null,
  error: null,
}
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
const manifest: Manifest = {
  schemaVersion: 1,
  id: 'role-keyboard-score',
  name: 'Role keyboard score',
  version: '1.0.0',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 6868,
    monitorPort: 6869,
  },
  audio: {
    defaultMode: 'none',
    supportedModes: ['none'],
    synthdefs: null,
    scsynth: null,
    standaloneTarget: null,
  },
}

function selectLoadableHost() {
  usePerformanceRoleStore.getState().selectRole('host')
  useCreationStore.setState({ active: false, modePhase: 'idle' })
  useSettingsStore.setState({
    nodeNameSetting: 'Stage Mac',
    settingsOpen: false,
    httpsEnabledSetting: false,
  })
  useProjectStore.setState({
    currentProject: { path: '/keyboard-score', manifest },
    pendingPreflightPath: null,
    preflightStatus: 'ready',
    preflightError: null,
  })
  useSessionStore.setState({
    audioMode: 'none',
    lanIp: '192.168.8.20',
    lanAddresses: ['192.168.8.20'],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.getState().resetSession()
  useSessionStore.setState({ commandPending: false })
  usePerformanceRoleStore.setState(usePerformanceRoleStore.getInitialState())
  useClientParticipationStore.setState({ snapshot: idle, error: null })
  useSettingsStore.setState({ nodeNameSetting: 'Stage Mac' })
  vi.mocked(commands.leaveClientPerformance).mockResolvedValue({
    status: 'ok',
    data: { ...idle, revision: 100 },
  })
})

afterEach(async () => {
  cleanup()
  // Radix restores the trigger on the next timer turn after a portal closes.
  await new Promise(resolve => setTimeout(resolve, 0))
  vi.restoreAllMocks()
})

const roleTrigger = () =>
  screen.getByRole('button', { name: /^Switch performance role:/ })

it('shows checked roles in a dropdown and closes the current choice without changing role', async () => {
  const user = userEvent.setup()
  usePerformanceRoleStore.getState().selectRole('host')
  render(<PerformanceRoleButton />)
  const trigger = roleTrigger()
  expect(trigger).toHaveAccessibleName('Switch performance role: PNDS Host')
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
  await user.click(trigger)
  expect(await screen.findByRole('menu')).toBeVisible()
  expect(
    screen.getByRole('menuitemradio', { name: 'PNDS Host' })
  ).toHaveAttribute('aria-checked', 'true')
  expect(
    screen.getByRole('menuitemradio', { name: 'PNDS Client' })
  ).toHaveAttribute('aria-checked', 'false')
  await user.click(screen.getByRole('menuitemradio', { name: 'PNDS Host' }))
  await waitFor(() =>
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  )
  expect(usePerformanceRoleStore.getState().role).toBe('host')
  expect(trigger).toHaveFocus()
  expect(commands.leaveClientPerformance).not.toHaveBeenCalled()
  expect(commands.savePreferences).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('displays the current Host name as plain text and follows settings changes', async () => {
  const user = userEvent.setup()
  usePerformanceRoleStore.getState().selectRole('host')
  render(<PerformanceRoleButton />)
  const name = screen.getByText('Stage Mac', { exact: true })
  expect(name.closest('button, input, [contenteditable="true"]')).toBeNull()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByText('Host node name')).not.toBeInTheDocument()
  await user.dblClick(name)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(useSettingsStore.getState().settingsOpen).toBe(false)
  expect(commands.savePreferences).not.toHaveBeenCalled()
  act(() => useSettingsStore.setState({ nodeNameSetting: 'Updated Host' }))
  expect(screen.getByText('Updated Host', { exact: true })).toBeVisible()
  expect(
    screen.queryByText('Stage Mac', { exact: true })
  ).not.toBeInTheDocument()
  act(() => usePerformanceRoleStore.getState().selectRole('client'))
  expect(
    screen.queryByText('Updated Host', { exact: true })
  ).not.toBeInTheDocument()
})

it('switches after choosing another role and restores focus after its sidebar remounts', async () => {
  const user = userEvent.setup()
  usePerformanceRoleStore.getState().selectRole('host')
  function RoleSidebar() {
    const role = usePerformanceRoleStore(state => state.role)
    return <PerformanceRoleButton key={role} />
  }
  render(<RoleSidebar />)
  const previous = roleTrigger()
  previous.focus()
  await user.keyboard('{Enter}')
  await user.keyboard('{End}{Enter}')
  await waitFor(() =>
    expect(usePerformanceRoleStore.getState().role).toBe('client')
  )
  const current = roleTrigger()
  expect(current).not.toBe(previous)
  expect(current).toHaveAccessibleName('Switch performance role: PNDS Client')
  await waitFor(() => expect(current).toHaveFocus())
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(commands.stopProject).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(commands.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ lastPerformanceRole: 'client' })
    )
  )
  expect(usePerformanceRoleStore.getState().lastRole).toBe('client')
})

it('keeps a chosen role applied and reports a failed memory save', async () => {
  const user = userEvent.setup()
  const error = vi.spyOn(notifications, 'error').mockResolvedValue(undefined)
  vi.mocked(commands.savePreferences).mockResolvedValueOnce({
    status: 'error',
    error: 'disk full',
  })
  usePerformanceRoleStore.getState().selectRole('host')
  render(<PerformanceRoleButton />)
  await user.click(roleTrigger())
  await user.click(screen.getByRole('menuitemradio', { name: 'PNDS Client' }))
  await waitFor(() =>
    expect(error).toHaveBeenCalledWith(
      i18n.t('participation.roleMemorySaveFailed')
    )
  )
  expect(usePerformanceRoleStore.getState()).toMatchObject({
    role: 'client',
    lastRole: 'client',
  })
  expect(roleTrigger()).toHaveAccessibleName(
    'Switch performance role: PNDS Client'
  )
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(commands.startProject).not.toHaveBeenCalled()
})

it.each(['escape', 'outside', 'blur'] as const)(
  'closes the role menu on %s without changing role',
  async cancellation => {
    const user = userEvent.setup()
    usePerformanceRoleStore.getState().selectRole('client')
    render(<PerformanceRoleButton />)
    await user.click(roleTrigger())
    const menu = await screen.findByRole('menu')
    if (cancellation === 'escape') await user.keyboard('{Escape}')
    else if (cancellation === 'outside') fireEvent.pointerDown(document.body)
    else fireEvent.blur(window)
    await waitFor(() => expect(menu).not.toBeInTheDocument())
    expect(usePerformanceRoleStore.getState().role).toBe('client')
    expect(commands.leaveClientPerformance).not.toHaveBeenCalled()
  }
)

it('gives dropdown Enter and role selection to the menu while the real Host Load action is enabled', async () => {
  selectLoadableHost()
  const user = userEvent.setup()
  render(
    <>
      <PerformanceRoleButton />
      <SessionActionButton />
    </>
  )
  expect(screen.getByRole('button', { name: 'Load' })).toBeEnabled()
  roleTrigger().focus()
  await user.keyboard('{Enter}')
  expect(await screen.findByRole('menu')).toBeVisible()
  expect(commands.startProject).not.toHaveBeenCalled()
  await user.keyboard('{End}{Enter}')
  await waitFor(() =>
    expect(usePerformanceRoleStore.getState().role).toBe('client')
  )
  await waitFor(() => expect(roleTrigger()).toHaveFocus())
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('keeps Host activity running when the role menu receives Enter beside the real Change action', async () => {
  selectLoadableHost()
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/keyboard-score',
    pendingChanges: true,
    latestSnapshot: { ...live, projectPath: '/keyboard-score' },
  })
  const user = userEvent.setup()
  render(
    <>
      <PerformanceRoleButton />
      <SessionActionButton />
    </>
  )
  expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled()
  roleTrigger().focus()
  await user.keyboard('{Enter}{End}{Enter}')
  expect(usePerformanceRoleStore.getState().role).toBe('host')
  expect(useSessionStore.getState().sessionStatus).toBe('ready')
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it.each(['starting', 'ready', 'stopping', 'command'] as const)(
  'keeps the menu inspectable and disables switching during Host %s activity',
  async status => {
    const user = userEvent.setup()
    usePerformanceRoleStore.getState().selectRole('host')
    useSessionStore.setState(
      status === 'command'
        ? { commandPending: true }
        : { sessionStatus: status }
    )
    render(<PerformanceRoleButton />)
    await user.click(roleTrigger())
    expect(await screen.findByRole('menu')).toBeVisible()
    const target = screen.getByRole('menuitemradio', {
      name: 'PNDS Client',
    })
    expect(target).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByText('Stop this performance before switching roles.')
    ).toBeVisible()
    fireEvent.click(target)
    expect(usePerformanceRoleStore.getState().role).toBe('host')
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.leaveClientPerformance).not.toHaveBeenCalled()
  }
)

it.each([
  'inspecting',
  'connecting',
  'open',
  'disconnected',
  'leaving',
  'cleanupFailed',
] as const)(
  'keeps Client selected and its menu inspectable during %s',
  async phase => {
    const user = userEvent.setup()
    usePerformanceRoleStore.getState().selectRole('client')
    useClientParticipationStore.setState({ snapshot: { ...idle, phase } })
    render(<PerformanceRoleButton />)
    await user.click(roleTrigger())
    const target = await screen.findByRole('menuitemradio', {
      name: 'PNDS Host',
    })
    expect(target).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByText('Leave this performance before switching roles.')
    ).toBeVisible()
    fireEvent.click(target)
    expect(usePerformanceRoleStore.getState().role).toBe('client')
    expect(commands.leaveClientPerformance).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  }
)

it('locks an already open menu when activity begins and keeps the current choice through repeated native facts', async () => {
  const user = userEvent.setup()
  usePerformanceRoleStore.getState().selectRole('client')
  render(<PerformanceRoleButton />)
  await user.click(roleTrigger())
  act(() =>
    useClientParticipationStore.getState().accept({ ...idle, phase: 'open' })
  )
  expect(screen.getByRole('menu')).toBeVisible()
  expect(
    screen.getByRole('menuitemradio', { name: 'PNDS Client' })
  ).toHaveAttribute('aria-checked', 'true')
  expect(
    screen.getByRole('menuitemradio', { name: 'PNDS Host' })
  ).toHaveAttribute('aria-disabled', 'true')
  act(() =>
    useClientParticipationStore.getState().accept({ ...idle, phase: 'open' })
  )
  expect(screen.getByRole('menu')).toBeVisible()
  await user.keyboard('{Escape}')
  expect(usePerformanceRoleStore.getState().role).toBe('client')
})

it('cleans up idle Client admission before switching and holds its menu until cleanup completes', async () => {
  const user = userEvent.setup()
  let finish!: (result: { status: 'ok'; data: ClientSnapshot }) => void
  vi.mocked(commands.leaveClientPerformance).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  usePerformanceRoleStore.getState().selectRole('client')
  render(<PerformanceRoleButton />)
  await user.click(roleTrigger())
  await user.click(screen.getByRole('menuitemradio', { name: 'PNDS Host' }))
  expect(commands.leaveClientPerformance).toHaveBeenCalledOnce()
  expect(usePerformanceRoleStore.getState().role).toBe('client')
  expect(screen.getByRole('menu')).toBeVisible()
  expect(
    screen.getByRole('menuitemradio', { name: 'PNDS Host' })
  ).toHaveAttribute('aria-disabled', 'true')
  await act(async () =>
    finish({ status: 'ok', data: { ...idle, revision: 100 } })
  )
  await waitFor(() =>
    expect(usePerformanceRoleStore.getState().role).toBe('host')
  )
  await waitFor(() => expect(roleTrigger()).toHaveFocus())
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

it('keeps Client selected if Host admission becomes active while its cleanup is pending', async () => {
  const user = userEvent.setup()
  let finish!: (result: { status: 'ok'; data: ClientSnapshot }) => void
  vi.mocked(commands.leaveClientPerformance).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  usePerformanceRoleStore.getState().selectRole('client')
  render(<PerformanceRoleButton />)
  await user.click(roleTrigger())
  await user.click(screen.getByRole('menuitemradio', { name: 'PNDS Host' }))
  act(() => useSessionStore.setState({ commandPending: true }))
  await act(async () =>
    finish({ status: 'ok', data: { ...idle, revision: 100 } })
  )
  expect(usePerformanceRoleStore.getState().role).toBe('client')
  expect(usePerformanceRoleStore.getState().roleSwitchPending).toBe(false)
  expect(screen.getByRole('menu')).toBeVisible()
  expect(
    screen.getByRole('menuitemradio', { name: 'PNDS Host' })
  ).toHaveAttribute('aria-disabled', 'true')
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it.each(['cleanupFailed', 'rejection'] as const)(
  'keeps Client selected when cleanup ends with %s',
  async failure => {
    const user = userEvent.setup()
    if (failure === 'cleanupFailed')
      vi.mocked(commands.leaveClientPerformance).mockResolvedValueOnce({
        status: 'ok',
        data: { ...idle, phase: 'cleanupFailed', revision: 100 },
      })
    else
      vi.mocked(commands.leaveClientPerformance).mockRejectedValueOnce(
        new Error('native cleanup failed')
      )
    usePerformanceRoleStore.getState().selectRole('client')
    render(<PerformanceRoleButton />)
    await user.click(roleTrigger())
    await user.click(screen.getByRole('menuitemradio', { name: 'PNDS Host' }))
    await waitFor(() =>
      expect(commands.leaveClientPerformance).toHaveBeenCalledOnce()
    )
    await waitFor(() =>
      expect(usePerformanceRoleStore.getState().roleSwitchPending).toBe(false)
    )
    expect(usePerformanceRoleStore.getState().role).toBe('client')
    expect(
      screen.getByRole('menuitemradio', { name: 'PNDS Host' })
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByText('Leave this performance before switching roles.')
    ).toBeVisible()
  }
)

it.each(['escape', 'outside', 'blur', 'current', 'unmount', 'reset'] as const)(
  'cannot commit a late Client cleanup after %s cancels the role selection',
  async cancellation => {
    const user = userEvent.setup()
    let finish!: (result: { status: 'ok'; data: ClientSnapshot }) => void
    vi.mocked(commands.leaveClientPerformance).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    usePerformanceRoleStore.getState().selectRole('client')
    const view = render(<PerformanceRoleButton />)
    await user.click(roleTrigger())
    await user.click(screen.getByRole('menuitemradio', { name: 'PNDS Host' }))
    expect(commands.leaveClientPerformance).toHaveBeenCalledOnce()
    if (cancellation === 'escape') await user.keyboard('{Escape}')
    else if (cancellation === 'outside') fireEvent.pointerDown(document.body)
    else if (cancellation === 'blur') fireEvent.blur(window)
    else if (cancellation === 'current')
      await user.click(
        screen.getByRole('menuitemradio', { name: 'PNDS Client' })
      )
    else if (cancellation === 'unmount') view.unmount()
    else act(() => usePerformanceRoleStore.getState().resetRole())
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    )
    await act(async () =>
      finish({ status: 'ok', data: { ...idle, revision: 100 } })
    )
    expect(usePerformanceRoleStore.getState().role).toBe(
      cancellation === 'reset' ? null : 'client'
    )
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  }
)
