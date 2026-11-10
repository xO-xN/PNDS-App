import { DesktopBar } from './DesktopBar'
import { useHostEntryStore } from '@/store/host-entry-store'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { Sidebar } from './Sidebar'
import { SettingsPanel } from '@/components/settings/SettingsPanel'

beforeEach(() => {
  vi.clearAllMocks()
  usePerformanceRoleStore.getState().selectRole('host')
  useSettingsStore.setState({
    nodeNameSetting: 'Stage Mac',
    settingsOpen: false,
    focusSection: null,
  })
  useSessionStore.getState().resetSession()
  useProjectStore.setState({
    currentProject: null,
    pendingPreflightPath: null,
    preflightStatus: 'idle',
    preflightError: null,
    renameTarget: null,
    recentProjectPaths: Array.from(
      { length: 36 },
      (_, index) => `/score-${index}`
    ),
    utilityPaths: ['/tool'],
    activeFolderId: null,
    lastUserFolderId: null,
    projectFolders: [
      { id: 'set', name: 'Set list', projectPaths: ['/score-0'] },
      { id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: ['/tool'] },
    ],
  })
})

afterEach(async () => {
  cleanup()
  await new Promise(resolve => setTimeout(resolve, 0))
})

it.each(['static', 'overlay'] as const)(
  'keeps the %s identity and browser outside the scrolling projects without a count footer',
  variant => {
    render(<Sidebar variant={variant} />)
    const scroller = screen.getByTestId('project-list-scroll')
    const browser = screen.getByTestId('sidebar-browser-controls')
    const folderSwitch = screen.getByTestId('folder-switch')
    const identity = screen.getByTestId('sidebar-identity')
    expect(scroller).not.toContainElement(browser)
    expect(scroller).not.toContainElement(identity)
    expect(browser).toContainElement(folderSwitch)
    expect(scroller.closest('nav')).toBe(folderSwitch.closest('nav'))
    expect(scroller.compareDocumentPosition(browser)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(identity.compareDocumentPosition(scroller)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(screen.getByRole('heading', { name: 'Home' })).toBeVisible()
    expect(screen.getByRole('tabpanel', { name: 'Home' })).toBe(
      screen.getByTestId('project-list-content')
    )
    expect(screen.queryByTestId('settings-footer')).not.toBeInTheDocument()
    expect(screen.queryByText(/^\d+ projects$/)).not.toBeInTheDocument()

    scroller.scrollTop = 600
    fireEvent.scroll(scroller)
    expect(screen.getByTestId('sidebar-browser-controls')).toBe(browser)
    expect(
      screen.getByRole('tablist', { name: 'Performance folder' })
    ).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Utilities' })).toBeVisible()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Utilities' })
    ).not.toBeInTheDocument()
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  }
)

it('selects real folders and Utilities in place through the bottom browser', async () => {
  const user = userEvent.setup()
  render(<Sidebar variant="overlay" />)
  const browser = screen.getByTestId('sidebar-browser-controls')
  const folderTab = screen.getByRole('tab', { name: 'Set list' })
  const panel = screen.getByRole('tabpanel', { name: 'Home' })
  expect(folderTab).toHaveAttribute('aria-controls', panel.id)
  await user.click(folderTab)
  expect(useProjectStore.getState().activeFolderId).toBe('set')
  expect(screen.getByRole('heading', { name: 'Set list' })).toBeVisible()
  expect(screen.getByTestId('project-entry')).toHaveAttribute(
    'data-project-path',
    '/score-0'
  )

  await user.click(screen.getByRole('tab', { name: 'Utilities' }))
  expect(useProjectStore.getState().activeFolderId).toBe(UTILITIES_FOLDER_ID)
  expect(screen.getByRole('heading', { name: 'Utilities' })).toBeVisible()
  expect(browser).toContainElement(folderTab)
  expect(screen.getByRole('tabpanel', { name: 'Utilities' })).toBe(panel)
  await user.click(folderTab)
  await waitFor(() =>
    expect(useProjectStore.getState().activeFolderId).toBe('set')
  )
  expect(screen.getByTestId('sidebar-browser-controls')).toBe(browser)
  expect(screen.getByRole('heading', { name: 'Set list' })).toBeVisible()
  expect(screen.getByRole('tab', { name: 'Set list' })).toBe(folderTab)
  await user.click(screen.getByRole('tab', { name: 'Home' }))
  expect(screen.getByRole('heading', { name: 'Home' })).toBeVisible()
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('lets the identity dropdown open with ArrowDown instead of selecting a project', async () => {
  const user = userEvent.setup()
  render(<Sidebar variant="overlay" />)
  screen
    .getByRole('button', { name: 'Switch performance role: PNDS Host' })
    .focus()
  await user.keyboard('{ArrowDown}')
  expect(await screen.findByRole('menu')).toBeVisible()
  expect(useProjectStore.getState().pendingPreflightPath).toBeNull()
  expect(commands.preflightProject).not.toHaveBeenCalled()
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  )
})

it('names Utilities and suppresses imports while its bundled folder is still loading', async () => {
  const user = userEvent.setup()
  useProjectStore.setState({ projectFolders: [] })
  render(<Sidebar variant="static" />)
  await user.click(screen.getByRole('tab', { name: 'Utilities' }))
  expect(screen.getByRole('heading', { name: 'Utilities' })).toBeVisible()
  expect(screen.getByRole('tabpanel', { name: 'Utilities' })).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Import project' })
  ).not.toBeInTheDocument()
})

it('keeps the quick invitation minimal and running details in Settings while retaining sidebar identity and project marks', async () => {
  const user = userEvent.setup()
  useSessionStore.setState({
    sessionStatus: 'ready',
    latestSnapshot: {
      status: 'ready',
      projectName: 'Running score',
      projectPath: '/score-0',
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
    },
  })
  useHostEntryStore.setState({
    snapshot: {
      status: 'ready',
      url: 'http://192.168.8.20:7341/',
      error: null,
      portChanged: false,
      projectName: 'Running score',
      browserParticipation: 1,
    },
  })
  render(
    <>
      <Sidebar variant="overlay" />
      <DesktopBar />
      <SettingsPanel />
    </>
  )
  const scroller = screen.getByTestId('project-list-scroll')
  const list = screen.getByTestId('project-list-content')
  const heading = screen.getByRole('heading', { name: 'Home' })
  expect(screen.queryByText('Running score')).not.toBeInTheDocument()
  expect(
    screen.queryByText('Local performance running')
  ).not.toBeInTheDocument()
  expect(list).not.toContainElement(heading)
  expect(heading.compareDocumentPosition(list)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING
  )
  const firstCard = screen.getAllByTestId('project-entry')[0]
  if (!firstCard) throw new Error('Expected a project card')
  const browser = screen.getByTestId('sidebar-browser-controls')
  await user.click(screen.getByRole('button', { name: 'Local network' }))
  expect(screen.queryByText('Running score')).not.toBeInTheDocument()
  expect(screen.queryByText('Address')).not.toBeInTheDocument()
  expect(screen.getByText('192.168.8.20:7341')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Copy address' })).toBeEnabled()
  expect(
    screen.queryByText('Connection and port details')
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'All network settings' }))
  const runningInformation = screen.getByText('Running score')
  expect(scroller).not.toContainElement(runningInformation)
  await user.click(screen.getByText('Connection and port details'))
  expect(screen.getByText('52341')).toBeVisible()
  expect(screen.getAllByTestId('project-entry')[0]).toBe(firstCard)
  expect(screen.getByTestId('sidebar-browser-controls')).toBe(browser)
  expect(screen.getByTestId('sidebar-identity')).not.toContainElement(
    runningInformation
  )
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})
