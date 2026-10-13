import { beforeEach, expect, it, vi } from 'vitest'
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

it('controls running A through its applied Internal audio while selected B has a None start configuration', async () => {
  const base = await commands.getSessionState()
  if (base.status !== 'ok') throw new Error('Expected snapshot')
  const applied = {
    ...base.data,
    status: 'ready' as const,
    projectPath: '/a',
    audioMode: 'internal' as const,
    outputDevice: 'Applied A device',
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
  const close = screen.getByRole('button', { name: 'Close test' })
  const refresh = screen.getByRole('button', {
    name: 'Refresh saved test pages',
  })
  const consoleControl = screen.getByRole('button', { name: 'Console' })
  for (const control of [start, close, refresh, consoleControl])
    expect(control).toBeDisabled()
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
  for (const control of [start, close, refresh, consoleControl]) {
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
  useSettingsStore.setState({ hubTokenSetting: 'private-token' })
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
  fireEvent.change(screen.getByLabelText('Hub address'), {
    target: { value: 'wss://next.example.org' },
  })
  fireEvent.blur(screen.getByLabelText('Hub address'))
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
  fireEvent.click(screen.getByRole('button', { name: 'Node' }))
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
