import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { commands, type ClientSnapshot } from '@/lib/tauri-bindings'
import { useSettingsStore } from '@/store/settings-store'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { useSessionStore } from '@/store/session-store'
import { useClientParticipationStore } from '@/store/client-participation-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { useCreationStore } from '@/store/creation-store'
import { useProjectStore } from '@/store/project-store'
import { useWindowStore } from '@/store/window-store'
import { HostNodeSetupSidebar } from './HostNodeSetup'
import { HoverSidebar } from './HoverSidebar'
import { SessionActionButton } from './SessionActionButton'

beforeEach(() => {
  vi.clearAllMocks()
  usePerformanceRoleStore.getState().resetRole()
  usePerformanceRoleStore.getState().selectRole('host')
  useSettingsStore.setState({ nodeNameSetting: '', settingsOpen: false })
  useSessionStore.getState().resetSession()
  useKeyboardStore.setState({
    commandKeyPressed: false,
    projectSelectionRevealed: false,
  })
  useCreationStore.setState({ active: false, modePhase: 'idle' })
  useProjectStore.setState({ renameTarget: null })
  useWindowStore.setState({ confirmCloseOpen: false, quitConfirmOpen: false })
})

it('names an unnamed Host in the sidebar only after saving, without Hub credentials', async () => {
  const user = userEvent.setup()
  render(<HostNodeSetupSidebar />)
  const save = screen.getByRole('button', { name: 'Save name' })
  expect(save).toBeDisabled()
  await user.type(screen.getByLabelText('Node name'), '  Stage Mac  ')
  expect(useSettingsStore.getState().nodeNameSetting).toBe('')
  await user.click(save)
  await waitFor(() =>
    expect(useSettingsStore.getState().nodeNameSetting).toBe('Stage Mac')
  )
  expect(commands.savePreferences).toHaveBeenCalledWith(
    expect.objectContaining({ nodeName: 'Stage Mac' })
  )
  expect(useSettingsStore.getState().settingsOpen).toBe(false)
  expect(screen.queryByLabelText(/token/i)).not.toBeInTheDocument()
})

it('keeps the naming gate and draft when saving fails so the same form can retry', async () => {
  const user = userEvent.setup()
  vi.mocked(commands.savePreferences).mockResolvedValueOnce({
    status: 'error',
    error: 'disk full',
  })
  render(<HostNodeSetupSidebar />)
  await user.type(screen.getByLabelText('Node name'), 'Stage Mac')
  await user.click(screen.getByRole('button', { name: 'Save name' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not save the name'
  )
  expect(useSettingsStore.getState().nodeNameSetting).toBe('')
  expect(screen.getByLabelText('Node name')).toHaveValue('Stage Mac')
  await user.click(screen.getByRole('button', { name: 'Save name' }))
  await waitFor(() =>
    expect(useSettingsStore.getState().nodeNameSetting).toBe('Stage Mac')
  )
})

it('focuses the inline name field from the idle Host setup action', async () => {
  render(
    <>
      <HoverSidebar />
      <SessionActionButton />
    </>
  )
  await userEvent.click(screen.getByRole('button', { name: 'Name this Host' }))
  expect(screen.getByRole('textbox', { name: 'Node name' })).toHaveFocus()
  expect(useSettingsStore.getState().settingsOpen).toBe(false)
  expect(commands.startProject).not.toHaveBeenCalled()
})

it.each([
  ['host', 'PNDS Host'],
  ['client', 'PNDS Client'],
] as const)(
  'puts the read-only node name immediately after the %s role menu trigger',
  (role, label) => {
    const nodeName = 'A long rehearsal room name with both 中文 and English'
    usePerformanceRoleStore.getState().selectRole(role)
    useSettingsStore.setState({ nodeNameSetting: nodeName })
    render(<HoverSidebar />)

    const trigger = screen.getByRole('button', {
      name: `Switch performance role: ${label}`,
    })
    const name = screen.getByText(nodeName, { exact: true })
    expect(name.tagName).toBe('BDI')
    expect(trigger.nextElementSibling).toBe(name.parentElement)
    expect(name.parentElement).toHaveAttribute('title', nodeName)
    expect(name.tabIndex).toBe(-1)
    expect(name.closest('button, [contenteditable="true"]')).toBeNull()
    expect(trigger.lastElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAccessibleDescription(nodeName)
    expect(screen.queryByRole('textbox', { name: 'Node name' })).toBeNull()
  }
)

it('keeps the Client role menu reachable with Cmd and releases its sidebar hold after closing', async () => {
  const user = userEvent.setup()
  usePerformanceRoleStore.getState().selectRole('client')
  const snapshot: ClientSnapshot = {
    revision: 10,
    phase: 'open',
    pageUrl: 'http://127.0.0.1:51000/',
    address: 'http://192.168.1.2:5000/',
    host: null,
    activeHost: null,
    expectedHostId: null,
    error: null,
  }
  useClientParticipationStore.setState({ snapshot, error: null })
  render(
    <>
      <HoverSidebar />
      <button type="button">Score surface</button>
    </>
  )
  const outside = screen.getByRole('button', { name: 'Score surface' })
  const panel = screen.getByTestId('sidebar-popover')
  expect(panel).toHaveClass('opacity-0')
  act(() => useKeyboardStore.setState({ commandKeyPressed: true }))
  expect(panel).toHaveClass('opacity-100')
  act(() => useKeyboardStore.setState({ commandKeyPressed: false }))
  expect(panel).toHaveClass('opacity-0')
  act(() => useKeyboardStore.setState({ commandKeyPressed: true }))
  await user.click(
    screen.getByRole('button', { name: 'Switch performance role: PNDS Client' })
  )
  const menu = await screen.findByRole('menu')
  expect(panel.contains(menu)).toBe(false)
  expect(
    screen.getByRole('menuitemradio', { name: 'PNDS Host' })
  ).toHaveAttribute('aria-disabled', 'true')
  act(() => useKeyboardStore.setState({ commandKeyPressed: false }))
  fireEvent.mouseLeave(panel)
  expect(panel).toHaveClass('opacity-100')
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  )
  await waitFor(() =>
    expect(
      screen.getByRole('button', {
        name: 'Switch performance role: PNDS Client',
      })
    ).toHaveFocus()
  )
  expect(panel).toHaveClass('opacity-100')
  await user.click(outside)
  await waitFor(() => expect(panel).toHaveClass('opacity-0'))
  expect(commands.leaveClientPerformance).not.toHaveBeenCalled()
})
