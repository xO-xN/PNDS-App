import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { commands, type Manifest } from '@/lib/tauri-bindings'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { useSettingsStore } from '@/store/settings-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { SettingsCard } from './SettingsCard'

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'next',
  name: 'Next project',
  version: '1',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 9000,
    monitorPort: 9001,
  },
  audio: {
    defaultMode: 'none',
    supportedModes: ['none'],
    synthdefs: null,
    scsynth: null,
    standaloneTarget: null,
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.getState().resetSession()
  useCreationStore.setState({ active: false, workspace: null })
  useCreationTestStore.setState({
    manifest: null,
    audioMode: 'none',
    oscTarget: '127.0.0.1:3333',
    loading: false,
  })
  useSettingsStore.setState({ hubRooms: {}, httpsEnabledSetting: false })
  useProjectStore.setState({ currentProject: { path: '/next', manifest } })
  vi.mocked(commands.listLanAddresses).mockResolvedValue({
    status: 'ok',
    data: ['192.168.1.10', '10.0.0.5'],
  })
  useSessionStore.setState({
    lanIp: '192.168.1.10',
    lanAddresses: ['192.168.1.10', '10.0.0.5'],
    audioMode: 'none',
    oscTargetInput: '127.0.0.1:3333',
  })
})

async function runSnapshot() {
  const base = await commands.getSessionState()
  if (base.status !== 'ok') throw new Error('Expected snapshot')
  const live = {
    ...base.data,
    status: 'ready' as const,
    projectPath: '/running',
    lanIp: '192.168.1.10',
    hostAddress: 'show.example.org',
    health: { status: 'ready', scoreServer: { performerPort: 6868 } },
  }
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/running',
    latestSnapshot: live,
  })
  return live
}

function panel() {
  return render(
    <SettingsCard quickNetwork showAudioMode={false} showGain={false} />
  )
}

it('limits the quick invitation network fields to the interface selector', async () => {
  await runSnapshot()
  useProjectStore.setState({
    currentProject: {
      path: '/next',
      manifest: { ...manifest, telematic: true },
    },
  })
  useSessionStore.setState({ audioMode: 'external' })
  render(
    <SettingsCard
      quickNetwork
      networkFields="lan"
      showAudioMode={false}
      showGain={false}
    />
  )
  expect(screen.getByRole('combobox', { name: 'Local network' })).toBeVisible()
  expect(
    screen.queryByRole('combobox', { name: 'Room' })
  ).not.toBeInTheDocument()
  expect(screen.queryByLabelText('OSC Target')).not.toBeInTheDocument()
  expect(screen.queryByText('Running')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Copy current performer entry' })
  ).not.toBeInTheDocument()
})

it('keeps project OSC and Room available in Settings without another LAN selector', () => {
  useProjectStore.setState({
    currentProject: {
      path: '/next',
      manifest: { ...manifest, telematic: true },
    },
  })
  useSessionStore.setState({ audioMode: 'external' })
  render(
    <SettingsCard
      quickNetwork
      networkFields="project"
      showAudioMode={false}
      showGain={false}
    />
  )
  expect(
    screen.queryByRole('combobox', { name: 'Local network' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Room' })).toBeVisible()
  expect(screen.getByLabelText('OSC Target')).toBeVisible()
})

it('shows Wi-Fi and Ethernet beside each IP in the quick network menu', async () => {
  vi.mocked(commands.getLanInterfaceKinds).mockResolvedValue({
    status: 'ok',
    data: { '192.168.1.10': 'wifi', '10.0.0.5': 'ethernet' },
  })
  panel()
  const select = screen.getByRole('combobox', { name: 'Local network' })
  await waitFor(() =>
    expect(select.querySelector('[data-interface-kind]')).toHaveAttribute(
      'data-interface-kind',
      'wifi'
    )
  )
  await userEvent.click(select)
  expect(
    screen
      .getByRole('option', { name: '192.168.1.10' })
      .querySelector('[data-interface-kind]')
  ).toHaveAttribute('data-interface-kind', 'wifi')
  expect(
    screen
      .getByRole('option', { name: '10.0.0.5' })
      .querySelector('[data-interface-kind]')
  ).toHaveAttribute('data-interface-kind', 'ethernet')
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('copies the running host and health port while a different card and LAN are selected', async () => {
  const snapshot = await runSnapshot()
  panel()
  expect(screen.queryByText(/Currently using/)).not.toBeInTheDocument()
  act(() => useSessionStore.getState().setLanIp('10.0.0.5'))
  expect(screen.getByText('Currently using 192.168.1.10')).toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Copy current performer entry' })
  )
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith('http://show.example.org:6868/')
  )
  expect(useSessionStore.getState().latestSnapshot).toBe(snapshot)
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('keeps the HTTPS URL and recovery notice when the running entry has failed', async () => {
  const snapshot = await runSnapshot()
  const httpsEntry = {
    status: 'error' as const,
    url: 'https://secure.example.org:8443/',
    error: 'Gateway failed',
  }
  useSessionStore.setState({
    latestSnapshot: { ...snapshot, httpsEntry },
    httpsEntry,
  })
  panel()
  fireEvent.click(
    screen.getByRole('button', { name: 'Copy current performer entry' })
  )
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(httpsEntry.url))
  expect(screen.getByTestId('session-entry-error')).toHaveTextContent(
    'Gateway failed'
  )
  expect(screen.getByTestId('session-entry-recovery')).toBeVisible()
  act(() =>
    useSessionStore.setState({
      latestSnapshot: { ...snapshot, httpsEntry: { ...httpsEntry, url: null } },
    })
  )
  expect(
    screen.getByRole('button', { name: 'Copy current performer entry' })
  ).toBeDisabled()
})

it('never fabricates a copy URL while idle or when a runtime port is unknown', async () => {
  const snapshot = await runSnapshot()
  useSessionStore.setState({ latestSnapshot: { ...snapshot, health: null } })
  panel()
  expect(
    screen.getByRole('button', { name: 'Copy current performer entry' })
  ).toBeDisabled()
  act(() =>
    useSessionStore.setState({
      sessionStatus: 'idle',
      latestSnapshot: snapshot,
    })
  )
  expect(
    screen.getByRole('button', { name: 'Copy current performer entry' })
  ).toBeDisabled()
  expect(screen.queryByText(/Currently using/)).not.toBeInTheDocument()
})

it('edits creation OSC in its own store, preserves performance config, and keeps Room independent', async () => {
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'draft',
        root: '/draft',
        name: 'Draft',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationTestStore.setState({
    manifest: { ...manifest, telematic: true },
    audioMode: 'external',
    oscTarget: '127.0.0.1:4444',
  })
  panel()
  const target = screen.getByLabelText('OSC Target')
  expect(target).toHaveValue('127.0.0.1:4444')
  fireEvent.change(target, { target: { value: '127.0.0.1:5555' } })
  fireEvent.blur(target)
  expect(useCreationTestStore.getState().oscTarget).toBe('127.0.0.1:5555')
  expect(useSessionStore.getState().oscTargetInput).toBe('127.0.0.1:3333')
  expect(useSessionStore.getState().pendingChanges).toBe(false)
  expect(commands.savePreferences).not.toHaveBeenCalled()
  expect(screen.getByRole('combobox', { name: 'Room' })).toBeVisible()
  act(() => useCreationTestStore.setState({ loading: true }))
  expect(target).toBeDisabled()
  act(() =>
    useCreationTestStore.setState({ loading: false, audioMode: 'internal' })
  )
  expect(screen.queryByLabelText('OSC Target')).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Room' })).toBeVisible()
})
