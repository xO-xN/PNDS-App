import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { commands, type Manifest } from '@/lib/tauri-bindings'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSettingsStore } from '@/store/settings-store'
import { useCommandKeyboard } from '@/hooks/use-command-keyboard'
import { DesktopBar } from './DesktopBar'
import { SettingsPanel } from '@/components/settings/SettingsPanel'

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'b',
  name: 'B',
  version: '1',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 7008,
    monitorPort: 7009,
  },
  audio: {
    supportedModes: ['none'],
    defaultMode: 'none',
    synthdefs: [],
    scsynth: null,
    standaloneTarget: null,
  },
}
beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.getState().resetSession()
  useCreationStore.setState({
    active: false,
    workspace: null,
    modePhase: 'idle',
    modePlan: null,
    opening: false,
  })
  useCreationTestStore.setState({ tab: 'file', expanded: false })
  useSettingsStore.setState({
    settingsOpen: false,
    focusSection: null,
    sampleRateSetting: 44100,
    nodeNameSetting: '',
    hubUrlSetting: '',
    hubTokenSetting: '',
  })
  useProjectStore.setState({
    currentProject: { path: '/b', manifest },
    preflightStatus: 'ready',
  })
})

it.each([
  'headphones',
  'speaker',
  'interface',
  'aggregate',
  'virtual',
  'unknown',
] as const)(
  'uses only the headphone or speaker glyph for %s output',
  async audio => {
    vi.mocked(commands.getDesktopDeviceStatus).mockResolvedValue({
      status: 'ok',
      data: { audio, network: 'unknown' },
    })
    render(<DesktopBar />)
    const button = screen.getByRole('button', { name: 'Audio' })
    await waitFor(() =>
      expect(button).toHaveAttribute('data-device-kind', audio)
    )
    expect(button.querySelector('svg')).toHaveClass(
      audio === 'headphones' ? 'lucide-headphones' : 'lucide-speaker'
    )
  }
)

it('opens the labeled console without a redundant hover hint', async () => {
  useCreationStore.setState({
    active: true,
    workspace: {
      project: { identity: 'console', root: '/b', source: 'folder', name: 'B' },
      files: [],
    },
  })
  render(<DesktopBar />)
  const button = screen.getByRole('button', { name: 'Console' })
  await userEvent.hover(button)
  await new Promise(resolve => setTimeout(resolve, 600))
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  await userEvent.click(button)
  expect(useCreationTestStore.getState().tab).toBe('console')
})

it('controls running A through its applied Internal audio while selected B has a None start configuration', async () => {
  const base = await commands.getSessionState()
  if (base.status !== 'ok') throw new Error('Expected snapshot')
  const applied = {
    ...base.data,
    status: 'ready' as const,
    projectPath: '/a',
    audioMode: 'internal' as const,
    outputDevice: 'Applied A device',
    lanIp: '192.0.2.10',
    appliedSampleRate: 48000,
    volume: 80,
    channelPlan: {
      projectChannels: 2,
      deviceChannels: 2,
      bridgedChannels: 2,
      privateBusStart: 2,
    },
  }
  useSessionStore.setState({
    latestSnapshot: applied,
    sessionStatus: 'ready',
    sessionProjectPath: '/a',
    audioMode: 'none',
    channelPlan: applied.channelPlan,
    outputDevice: 'Pending B device',
    lanIp: '192.0.2.20',
  })
  vi.mocked(commands.getDesktopDeviceStatus).mockResolvedValue({
    status: 'ok',
    data: { audio: 'headphones', network: 'ethernet' },
  })
  render(<DesktopBar />)
  const slider = screen.getByRole('slider', { name: 'Master Volume' })
  expect(slider).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Audio' })).toHaveTextContent(
    'Applied A device'
  )
  expect(screen.getByRole('button', { name: 'Audio' })).toHaveTextContent(
    '48 kHz'
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Audio' })).toHaveAttribute(
      'data-device-kind',
      'headphones'
    )
  )
  expect(screen.getByRole('button', { name: 'Local network' })).toHaveAttribute(
    'data-interface-kind',
    'ethernet'
  )
  expect(commands.getDesktopDeviceStatus).toHaveBeenCalledWith(
    'Applied A device',
    '192.0.2.10',
    true
  )
  fireEvent.change(slider, { target: { value: '35' } })
  await waitFor(() => expect(commands.setMasterVolume).toHaveBeenCalledWith(35))
  expect(useProjectStore.getState().currentProject?.path).toBe('/b')
  expect(useSessionStore.getState().latestSnapshot?.audioMode).toBe('internal')
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('never enables master gain from the selected Internal mode when the actual run is External', async () => {
  const base = await commands.getSessionState()
  if (base.status !== 'ok') throw new Error('Expected snapshot')
  useSessionStore.setState({
    sessionStatus: 'ready',
    audioMode: 'internal',
    latestSnapshot: { ...base.data, status: 'ready', audioMode: 'external' },
  })
  render(<DesktopBar />)
  expect(screen.getByRole('slider')).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
  expect(commands.setMasterVolume).not.toHaveBeenCalled()
})

it('keeps creation transport and console visible but unavailable on the empty home and expanded preview', () => {
  useCreationStore.setState({ active: true, workspace: null })
  useSessionStore.setState({ lanIp: '192.168.1.10' })
  render(<KeyboardBar />)
  const start = screen.getByRole('button', { name: 'Start test' })
  expect(
    screen.queryByRole('button', { name: 'Close test' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Refresh saved test pages' })
  ).not.toBeInTheDocument()
  const consoleControl = screen.getByRole('button', { name: 'Console' })
  for (const control of [start, consoleControl]) expect(control).toBeDisabled()
  fireEvent.click(start)
  fireEvent.keyDown(window, { key: '`', code: 'Backquote', metaKey: true })
  expect(useCreationTestStore.getState().tab).toBe('file')
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  act(() => {
    useCreationStore.setState({
      workspace: {
        project: { identity: 'home', root: '/b', source: 'folder', name: 'B' },
        files: [],
      },
    })
    useCreationTestStore.setState({
      manifest,
      loading: false,
      audioMode: 'none',
      error: null,
    })
  })
  expect(screen.getByRole('button', { name: 'Start test' })).toBe(start)
  expect(start).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Console' })).toBe(consoleControl)
  expect(consoleControl).toBeEnabled()
  act(() => useCreationTestStore.setState({ expanded: true }))
  for (const control of [start, consoleControl]) {
    expect(control).toBeVisible()
    expect(control).toBeDisabled()
  }
})

it('shares deferred node identity edits with Settings while keeping the applied run and token separate', async () => {
  const base = await commands.getSessionState()
  if (base.status !== 'ok') throw new Error('Expected snapshot')
  const applied = {
    ...base.data,
    status: 'ready' as const,
    projectPath: '/a',
    audioMode: 'internal' as const,
  }
  useSessionStore.setState({
    latestSnapshot: applied,
    sessionStatus: 'ready',
    sessionProjectPath: '/a',
    pendingChanges: false,
  })
  useSettingsStore.setState({
    hubTokenSetting: 'private-token',
    hubUrlSetting: 'wss://next.example.org',
  })
  render(
    <>
      <DesktopBar />
      <SettingsPanel />
    </>
  )
  expect(
    screen.queryByRole('button', { name: /toggle full screen/i })
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Local network' }))
  fireEvent.change(screen.getByLabelText('Node name'), {
    target: { value: 'Next node' },
  })
  fireEvent.blur(screen.getByLabelText('Node name'))
  expect(screen.queryByLabelText('Hub address')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Token')).not.toBeInTheDocument()
  await waitFor(() =>
    expect(commands.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeName: 'Next node',
        hubUrl: 'wss://next.example.org',
        hubToken: 'private-token',
      })
    )
  )
  expect(useSessionStore.getState().latestSnapshot).toBe(applied)
  expect(useSessionStore.getState().pendingChanges).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'All network settings' }))
  expect(await screen.findByLabelText('Node name')).toHaveValue('Next node')
  expect(screen.getByLabelText('Hub address')).toHaveValue(
    'wss://next.example.org'
  )
  expect(screen.getByLabelText('Token')).toHaveAttribute('type', 'password')
  expect(screen.getByLabelText('Token')).toHaveValue('private-token')
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

function KeyboardBar() {
  useCommandKeyboard()
  return <DesktopBar />
}
it('limits the console shortcut to creation and preserves the mode control across workspace changes', () => {
  render(<KeyboardBar />)
  const mode = screen.getByRole('button', { name: 'Switch to creation mode' })
  fireEvent.keyDown(window, { key: '`', code: 'Backquote', metaKey: true })
  expect(useCreationTestStore.getState().tab).toBe('file')
  act(() =>
    useCreationStore.setState({
      active: true,
      workspace: {
        project: {
          identity: 'draft',
          name: 'Draft',
          root: '/draft',
          source: 'folder',
        },
        files: [],
      },
    })
  )
  expect(
    screen.getByRole('button', { name: 'Return to performance mode' })
  ).toBe(mode)
  fireEvent.keyDown(window, { key: '`', code: 'Backquote', metaKey: true })
  expect(useCreationTestStore.getState().tab).toBe('console')
  fireEvent.keyDown(window, { key: '`', code: 'Backquote', metaKey: true })
  expect(useCreationTestStore.getState().tab).toBe('file')
})
