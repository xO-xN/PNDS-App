import { useHostEntryStore } from '@/store/host-entry-store'
import { beforeEach as beforeHostTest } from 'vitest'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
import { commands, type Manifest } from '@/lib/tauri-bindings'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useCreationCompileStore } from '@/store/creation-compile-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useClientParticipationStore } from '@/store/client-participation-store'
import i18n from '@/i18n/config'
import { useSettingsStore } from '@/store/settings-store'
import { useCommandKeyboard } from '@/hooks/use-command-keyboard'
import { useCreationConsoleWindowStore } from '@/lib/creation-console-window'
import { DesktopBar } from './DesktopBar'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
// Existing workflows run after an explicit Host choice and node naming.
beforeHostTest(() => {
  usePerformanceRoleStore.getState().selectRole('host')
  useSettingsStore.setState({ nodeNameSetting: 'Test Host' })
})

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
  useCreationTestStore.setState({ expanded: false })
  useCreationConsoleWindowStore.setState({ open: false })
  useCreationCompileStore.setState({ busy: false, report: null, error: null })
  useCreationFilesStore.setState({
    pending: { compile: 0, refresh: 0, restart: 0 },
  })
  useSettingsStore.setState({
    settingsOpen: false,
    focusSection: null,
    sampleRateSetting: 44100,
    hideBottomBarText: false,
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

it('keeps the quick audio popover to device and rate selectors without extra copy or settings footer', async () => {
  render(<DesktopBar />)
  await userEvent.click(screen.getByRole('button', { name: 'Audio' }))
  const popover = screen.getByRole('dialog')
  expect(popover).toHaveClass('desktop-audio-popover')
  expect(within(popover).getAllByRole('combobox')).toHaveLength(2)
  expect(within(popover).getByLabelText('Output device')).toBeVisible()
  expect(within(popover).getByLabelText('Sample rate')).toBeVisible()
  expect(within(popover).queryByRole('heading')).not.toBeInTheDocument()
  expect(within(popover).queryByRole('button')).not.toBeInTheDocument()
  expect(
    popover.querySelector(
      '.settings-runtime, .settings-notice, .settings-field-difference'
    )
  ).toBeNull()
  expect(useSettingsStore.getState().settingsOpen).toBe(false)
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it.each(['host', 'client'] as const)(
  'applies the text preference live to the %s bottom bar without replacing its controls',
  async role => {
    usePerformanceRoleStore.setState({ role })
    useHostEntryStore.setState({
      snapshot: {
        status: 'waiting',
        url: 'http://192.168.8.20:44222/',
        error: null,
        portChanged: false,
      },
    })
    render(<DesktopBar />)
    const footer = screen.getByRole('contentinfo')
    const network = screen.getByRole('button', { name: 'Local network' })
    expect(within(network).getByText('192.168.8.20')).toHaveClass(
      'desktop-optional-label'
    )
    expect(footer).not.toHaveAttribute('data-hide-detail-text')

    act(() => useSettingsStore.getState().setHideBottomBarText(true))
    expect(footer).toHaveAttribute('data-hide-detail-text')
    expect(screen.getByRole('button', { name: 'Local network' })).toBe(network)
    if (role === 'host') {
      const audio = screen.getByRole('button', { name: 'Audio' })
      expect(within(audio).getByText('44.1 kHz')).toHaveClass(
        'desktop-optional-label'
      )
      expect(audio.querySelector('.desktop-device-name')).toHaveClass(
        'desktop-optional-label'
      )
      expect(screen.getByRole('slider', { hidden: true })).toBeInTheDocument()
    }
    await userEvent.click(network)
    const popover = screen.getByRole('dialog')
    expect(within(popover).getByText('192.168.8.20:44222')).toBeVisible()

    act(() => useSettingsStore.getState().setHideBottomBarText(false))
    expect(footer).not.toHaveAttribute('data-hide-detail-text')
    expect(popover).toBeVisible()
  }
)

it.each([
  ['creation', 'Output device', /^BlackHole 16ch/],
  ['creation', 'Sample rate', /^48 kHz$/],
  ['creation', 'Local network', /^192\.168\.1\.20$/],
  ['performance', 'Output device', /^BlackHole 16ch/],
  ['performance', 'Sample rate', /^48 kHz$/],
  ['performance', 'Local network', /^192\.168\.1\.20$/],
] as const)(
  'highlights the %s restart action after changing %s in the bottom bar',
  async (mode, field, option) => {
    const base = await commands.getSessionState()
    if (base.status !== 'ok') throw new Error('Expected snapshot')
    const audioManifest: Manifest = {
      ...manifest,
      audio: {
        ...manifest.audio,
        defaultMode: 'internal',
        supportedModes: ['internal'],
      },
    }
    useSettingsStore.setState({ nodeNameSetting: 'Test Host' })
    useProjectStore.setState({
      currentProject: { path: '/b', manifest: audioManifest },
    })
    const runtimePath =
      mode === 'creation' && field === 'Local network' ? '/test-copy' : '/b'
    if (mode === 'creation') {
      creationConsoleWorkspace()
      useCreationStore.setState({
        runtimeProject: { path: runtimePath, root: '/b' },
      })
      useCreationTestStore.setState({
        manifest: audioManifest,
        audioMode: 'internal',
      })
    }
    const appliedLanIp = '192.168.1.10'
    const addresses = [appliedLanIp, '192.168.1.20']
    vi.mocked(commands.listLanAddresses).mockResolvedValueOnce({
      status: 'ok',
      data: addresses,
    })
    useSessionStore.getState().setLanAddresses(addresses)
    useSessionStore.getState().setLanIp(appliedLanIp)
    const applied = {
      ...base.data,
      status: 'ready' as const,
      projectPath: runtimePath,
      audioMode: 'internal' as const,
      outputDevice: 'Mac mini Speakers',
      appliedSampleRate: 44100,
      lanIp: appliedLanIp,
    }
    useSessionStore.getState().applySnapshot(applied)
    render(<DesktopBar />)
    const initial = mode === 'creation' ? 'Restart test' : 'Close'
    expect(screen.getByRole('button', { name: initial })).toHaveAttribute(
      'data-desktop-tone',
      mode === 'creation' ? 'neutral' : 'danger'
    )

    await userEvent.click(
      screen.getByRole('button', {
        name: field === 'Local network' ? field : 'Audio',
      })
    )
    await userEvent.click(screen.getByRole('combobox', { name: field }))
    await userEvent.click(await screen.findByRole('option', { name: option }))
    await userEvent.keyboard('{Escape}')

    const restart = screen.getByRole('button', {
      name: mode === 'creation' ? 'Restart test' : 'Reload',
    })
    expect(restart).toBeEnabled()
    expect(restart).toHaveAttribute('data-desktop-tone', 'primary')
    expect(useSessionStore.getState().latestSnapshot).toBe(applied)
    expect(commands.startCreationProject).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
    act(() =>
      useSessionStore.getState().applySnapshot({ ...applied, volume: 75 })
    )
    expect(restart).toHaveAttribute('data-desktop-tone', 'primary')
    if (field === 'Output device') {
      expect(useSessionStore.getState().outputDevice).toBe('BlackHole 16ch')
    }
  }
)

it('opens the labeled console window without a redundant hover hint', async () => {
  useCreationStore.setState({
    active: true,
    workspace: {
      project: { identity: 'console', root: '/b', source: 'folder', name: 'B' },
      files: [],
    },
  })
  render(<DesktopBar />)
  const button = screen.getByRole('button', { name: 'Console' })
  expect(button).not.toHaveAttribute('title')
  await userEvent.hover(button)
  await new Promise(resolve => setTimeout(resolve, 600))
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  await userEvent.click(button)
  await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'))
  expect(commands.toggleCreationConsole).toHaveBeenCalledOnce()
})

function creationConsoleWorkspace() {
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'console-status',
        root: '/b',
        source: 'folder',
        name: 'B',
      },
      files: [],
    },
  })
}

it.each(['performance', 'creation'] as const)(
  'shows one %s network warning and keeps its icon outside the optional text',
  async mode => {
    const base = await commands.getSessionState()
    if (base.status !== 'ok') throw new Error('Expected snapshot')
    if (mode === 'creation') {
      creationConsoleWorkspace()
      useSessionStore.getState().applySnapshot({
        ...base.data,
        status: 'error',
        projectPath: '/b',
      })
    } else {
      useHostEntryStore.setState({
        snapshot: {
          status: 'error',
          url: null,
          error: 'Entry unavailable',
          portChanged: false,
        },
      })
    }
    useSettingsStore.getState().setHideBottomBarText(true)
    render(<DesktopBar />)
    const network = screen.getByRole('button', { name: 'Local network' })
    const message = i18n.t(
      mode === 'creation'
        ? 'creation.testStatus.error'
        : 'participation.publicEntry.error'
    )
    expect(within(network).getAllByText(message)).toHaveLength(1)
    const warning = within(network).getByText(message)
    expect(warning).toHaveClass('desktop-optional-label')
    expect(warning.parentElement?.querySelector('svg')).toHaveClass(
      'lucide-triangle-alert'
    )
    expect(network).toHaveAccessibleDescription(message)
  }
)

it('keeps compile-pending discoverable at the existing console entry and clears it when acknowledged', async () => {
  creationConsoleWorkspace()
  useCreationFilesStore.setState({
    pending: { compile: 1, refresh: 0, restart: 0 },
  })
  render(<DesktopBar />)
  const button = screen.getByRole('button', { name: 'Console' })
  expect(button).toHaveAttribute('data-console-state', 'pending')
  expect(button).toHaveTextContent(
    i18n.t('creation.consoleStatus.pendingCompile')
  )
  expect(button).toHaveAccessibleDescription(i18n.t('creation.pendingCompile'))
  expect(button).toHaveAttribute('title', i18n.t('creation.pendingCompile'))
  expect(button.querySelector('.desktop-console-status')).not.toHaveClass(
    'desktop-optional-label'
  )
  await userEvent.click(button)
  expect(commands.toggleCreationConsole).toHaveBeenCalledOnce()
  expect(commands.compileCreationSynthdefs).not.toHaveBeenCalled()

  act(() =>
    useCreationFilesStore.setState({
      pending: { compile: 0, refresh: 0, restart: 0 },
    })
  )
  expect(button).not.toHaveAttribute('data-console-state')
  expect(button).not.toHaveAttribute('title')
  expect(button.querySelector('.desktop-console-status')).toBeNull()
})

it('prioritizes compilation in progress, then its failure, while retaining pending details', () => {
  creationConsoleWorkspace()
  useCreationFilesStore.setState({
    pending: { compile: 2, refresh: 1, restart: 1 },
  })
  useCreationCompileStore.setState({
    busy: true,
    error: 'Compiler unavailable',
  })
  render(<DesktopBar />)
  const button = screen.getByRole('button', { name: 'Console' })
  expect(button).toHaveAttribute('data-console-state', 'compiling')
  expect(button).toHaveAttribute('aria-busy', 'true')
  expect(button).toHaveTextContent(i18n.t('creation.consoleStatus.compiling'))
  expect(button.querySelector('svg')).toHaveClass(
    'lucide-loader-circle',
    'animate-spin',
    'motion-reduce:animate-none'
  )
  expect(button.getAttribute('aria-description')).toContain(
    i18n.t('creation.pendingRefresh')
  )
  expect(button.getAttribute('title')).toContain(
    i18n.t('creation.pendingRestart')
  )

  act(() => useCreationCompileStore.setState({ busy: false }))
  expect(button).toHaveAttribute('data-console-state', 'error')
  expect(button).not.toHaveAttribute('aria-busy')
  expect(button).toHaveTextContent(
    i18n.t('creation.consoleStatus.compileFailed')
  )
  expect(button.querySelector('svg')).toHaveClass('lucide-triangle-alert')
  expect(button.getAttribute('title')).toContain('Compiler unavailable')
  expect(button.getAttribute('aria-description')).toContain(
    i18n.t('creation.pendingCompile')
  )
})

it('also exposes a compiler report failure without a transport error', () => {
  creationConsoleWorkspace()
  useCreationCompileStore.setState({
    report: {
      sclangPath: '/sclang',
      produced: [],
      references: [],
      output: '',
      error: 'Missing SynthDef reference',
    },
  })
  render(<DesktopBar />)
  const button = screen.getByRole('button', { name: 'Console' })
  expect(button).toHaveAttribute('data-console-state', 'error')
  expect(button).toHaveAccessibleDescription('Missing SynthDef reference')
})

it('retains refresh and restart indicators without requiring a pending compilation', () => {
  creationConsoleWorkspace()
  useCreationFilesStore.setState({
    pending: { compile: 0, refresh: 1, restart: 2 },
  })
  render(<DesktopBar />)
  const button = screen.getByRole('button', { name: 'Console' })
  expect(button).toHaveAttribute('data-console-state', 'pending')
  expect(button).toHaveTextContent(
    i18n.t('creation.consoleStatus.pendingRefresh')
  )
  expect(button).toHaveTextContent(
    i18n.t('creation.consoleStatus.pendingRestart')
  )
  expect(button.getAttribute('title')).toContain(
    i18n.t('creation.pendingRefresh')
  )
  expect(button.getAttribute('title')).toContain(
    i18n.t('creation.pendingRestart')
  )
  expect(button.querySelector('.animate-spin')).toBeNull()
})

it('does not attribute a background compiler state to the empty creation home', () => {
  useCreationStore.setState({ active: true, workspace: null })
  useCreationCompileStore.setState({ busy: true })
  useCreationFilesStore.setState({
    pending: { compile: 1, refresh: 0, restart: 0 },
  })
  render(<DesktopBar />)
  const button = screen.getByRole('button', { name: 'Console' })
  expect(button).toBeDisabled()
  expect(button).not.toHaveAttribute('data-console-state')
  expect(button).not.toHaveAttribute('title')
  expect(button.querySelector('.desktop-console-status')).toBeNull()
})

function renderAdjustableGain() {
  useSessionStore.setState({
    latestSnapshot: null,
    sessionStatus: 'ready',
    audioMode: 'internal',
    volume: 64,
  })
  render(<DesktopBar />)
  return screen.getByRole('button', { name: 'Mute' })
}

it('reveals master gain on hover, keeps it open for the slider, and toggles mute on click', async () => {
  const user = userEvent.setup()
  const speaker = renderAdjustableGain()
  const flyout = document.getElementById(
    speaker.getAttribute('aria-controls') ?? ''
  )
  expect(flyout).toHaveAttribute('hidden')
  expect(flyout).toHaveAttribute('data-native-overlay')
  expect(speaker).toHaveAttribute('aria-expanded', 'false')
  expect(speaker).toHaveAttribute('aria-pressed', 'false')
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()

  await user.hover(speaker)
  expect(speaker).toHaveAttribute('aria-expanded', 'true')
  const slider = screen.getByRole('slider', { name: 'Master Volume' })
  expect(flyout).toContainElement(slider)
  expect(slider).toHaveAttribute('data-tauri-drag-region', 'false')
  await user.hover(slider)
  expect(speaker).toHaveAttribute('aria-expanded', 'true')
  fireEvent.change(slider, { target: { value: '41' } })
  expect(commands.setMasterVolume).toHaveBeenLastCalledWith(41)

  await user.click(speaker)
  expect(commands.setMasterVolume).toHaveBeenLastCalledWith(0)
  expect(speaker).toHaveAccessibleName('Unmute')
  expect(speaker).toHaveAttribute('aria-pressed', 'true')
  await user.click(speaker)
  expect(commands.setMasterVolume).toHaveBeenLastCalledWith(41)
  expect(speaker).toHaveAccessibleName('Mute')

  await user.unhover(speaker)
  expect(speaker).toHaveAttribute('aria-expanded', 'false')
  expect(flyout).toHaveAttribute('hidden')

  await user.hover(speaker)
  await user.pointer([
    { keys: '[MouseLeft>]', target: slider },
    { target: document.body },
  ])
  expect(speaker).toHaveAttribute('aria-expanded', 'true')
  await user.pointer({ keys: '[/MouseLeft]', target: document.body })
  expect(speaker).toHaveAttribute('aria-expanded', 'false')
})

it('lets keyboard focus enter and leave the master volume flyout', async () => {
  const user = userEvent.setup()
  const speaker = renderAdjustableGain()
  const audio = screen.getByRole('button', { name: 'Audio' })
  const matches = speaker.matches.bind(speaker)
  vi.spyOn(speaker, 'matches').mockImplementation(selector =>
    selector === ':focus-visible' ? true : matches(selector)
  )
  audio.focus()
  await user.tab({ shift: true })
  expect(speaker).toHaveFocus()
  expect(speaker).toHaveAttribute('aria-expanded', 'true')

  await user.tab()
  expect(screen.getByRole('slider', { name: 'Master Volume' })).toHaveFocus()
  expect(speaker).toHaveAttribute('aria-expanded', 'true')

  await user.tab()
  expect(audio).toHaveFocus()
  expect(speaker).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()

  await user.tab({ shift: true })
  await user.tab()
  await user.keyboard('{Escape}')
  expect(speaker).toHaveFocus()
  expect(speaker).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  expect(commands.setMasterVolume).not.toHaveBeenCalled()
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
  await userEvent.hover(screen.getByRole('button', { name: 'Mute' }))
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
  expect(screen.getByRole('slider', { hidden: true })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
  expect(commands.setMasterVolume).not.toHaveBeenCalled()
})

it('keeps creation transport available and disables the console in expanded preview', () => {
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
  expect(commands.toggleCreationConsole).not.toHaveBeenCalled()
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
  for (const control of [start, consoleControl]) expect(control).toBeVisible()
  expect(start).toBeEnabled()
  expect(consoleControl).toBeDisabled()
  fireEvent.keyDown(window, { key: '`', code: 'Backquote', metaKey: true })
  expect(commands.toggleCreationConsole).not.toHaveBeenCalled()
})

it('invites phones to the current creation test instead of the waiting public entry', async () => {
  const base = await commands.getSessionState()
  if (base.status !== 'ok') throw new Error('Expected snapshot')
  useCreationStore.setState({
    active: true,
    runtimeProject: null,
    workspace: {
      project: {
        identity: 'test-entry',
        root: '/b',
        source: 'folder',
        name: 'B',
      },
      files: [],
    },
  })
  useSessionStore.getState().applySnapshot({
    ...base.data,
    runtimeGeneration: '41',
    status: 'ready',
    projectPath: '/b',
    lanIp: '192.168.8.20',
    hostAddress: null,
    health: {
      status: 'ready',
      scoreServer: { performerPort: 52341, monitorPort: 52342 },
    },
  })
  useHostEntryStore.setState({
    snapshot: {
      status: 'waiting',
      url: 'http://192.168.8.20:7341/',
      error: null,
      portChanged: false,
    },
  })
  render(<DesktopBar />)
  const network = screen.getByRole('button', { name: 'Local network' })
  expect(network).toHaveTextContent('http://192.168.8.20:52341/')
  await userEvent.click(network)
  const popover = screen.getByRole('dialog')
  expect(within(popover).getByText('192.168.8.20:52341')).toBeVisible()
  expect(
    within(popover).queryByText('192.168.8.20:7341')
  ).not.toBeInTheDocument()
  expect(await within(popover).findByRole('img')).toBeVisible()
  expect(commands.getCreationPerformerQr).toHaveBeenCalledWith(
    'http://192.168.8.20:52341/',
    '41'
  )
  expect(commands.getHostEntryQr).not.toHaveBeenCalled()
})

it('retires a pending test QR when the actual network popover closes and generates a new one on reopen', async () => {
  const base = await commands.getSessionState()
  if (base.status !== 'ok') throw new Error('Expected snapshot')
  useCreationStore.setState({
    active: true,
    runtimeProject: null,
    workspace: {
      project: {
        identity: 'test-entry',
        root: '/b',
        source: 'folder',
        name: 'B',
      },
      files: [],
    },
  })
  useSessionStore.getState().applySnapshot({
    ...base.data,
    runtimeGeneration: '41',
    status: 'ready',
    projectPath: '/b',
    lanIp: '192.168.8.20',
    hostAddress: null,
    health: {
      status: 'ready',
      scoreServer: { performerPort: 52341, monitorPort: 52342 },
    },
  })
  let finish!: (result: { status: 'ok'; data: string }) => void
  vi.mocked(commands.getCreationPerformerQr)
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    .mockResolvedValueOnce({ status: 'ok', data: 'data:image/png;base64,bmV3' })
  render(<DesktopBar />)
  const user = userEvent.setup()
  const network = screen.getByRole('button', { name: 'Local network' })
  await user.click(network)
  await waitFor(() =>
    expect(commands.getCreationPerformerQr).toHaveBeenCalledTimes(1)
  )
  await user.click(network)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await act(async () =>
    finish({ status: 'ok', data: 'data:image/png;base64,b2xk' })
  )
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  await user.click(network)
  expect(await screen.findByRole('img')).toHaveAttribute(
    'src',
    'data:image/png;base64,bmV3'
  )
  expect(commands.getCreationPerformerQr).toHaveBeenCalledTimes(2)
})

it('keeps the quick network panel minimal and moves identity edits into Settings without changing the run', async () => {
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
  expect(screen.queryByLabelText('Node name')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('heading', { name: 'Network' })
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Running')).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Local network' })).toBeVisible()
  expect(
    screen.queryByText('Connection and port details')
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'All network settings' }))
  expect(await screen.findByLabelText('Node name')).toHaveValue('')
  fireEvent.change(screen.getByLabelText('Node name'), {
    target: { value: 'Next node' },
  })
  vi.mocked(commands.loadPreferences).mockResolvedValueOnce({
    status: 'ok',
    data: {
      theme: 'system',
      language: 'en',
      hubUrl: 'wss://next.example.org',
      hubToken: 'private-token',
    },
  })
  fireEvent.blur(screen.getByLabelText('Node name'))
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
it('toggles the native console only in creation and preserves the mode control across workspace changes', async () => {
  render(<KeyboardBar />)
  const mode = screen.getByRole('button', { name: 'Switch to creation mode' })
  fireEvent.keyDown(window, { key: '`', code: 'Backquote', metaKey: true })
  expect(commands.toggleCreationConsole).not.toHaveBeenCalled()
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
  const consoleControl = screen.getByRole('button', { name: 'Console' })
  fireEvent.keyDown(window, { key: '`', code: 'Backquote', metaKey: true })
  await waitFor(() =>
    expect(consoleControl).toHaveAttribute('aria-pressed', 'true')
  )
  expect(commands.toggleCreationConsole).toHaveBeenCalledTimes(1)
  vi.mocked(commands.toggleCreationConsole).mockResolvedValueOnce({
    status: 'ok',
    data: false,
  })
  fireEvent.keyDown(window, { key: '`', code: 'Backquote', metaKey: true })
  await waitFor(() =>
    expect(consoleControl).toHaveAttribute('aria-pressed', 'false')
  )
  expect(commands.toggleCreationConsole).toHaveBeenCalledTimes(2)
})

it.each(['host', 'client'] as const)(
  'shows just the IP in the %s network control and copies the complete public entry',
  async role => {
    const url = 'http://192.168.8.20:44222/'
    usePerformanceRoleStore.setState({ role })
    useHostEntryStore.setState({
      snapshot: { status: 'waiting', url, error: null, portChanged: false },
    })
    const user = userEvent.setup()
    render(<DesktopBar />)
    expect(screen.queryByText('PNDS Client')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^Host:/ })
    ).not.toBeInTheDocument()
    const network = screen.getByRole('button', { name: 'Local network' })
    expect(network).toHaveTextContent(/^192\.168\.8\.20$/)
    expect(network).toHaveAttribute('title', '192.168.8.20')
    expect(network).toHaveAccessibleDescription('No public performance')
    await user.click(network)
    const popover = screen.getByRole('dialog')
    expect(within(popover).getByText('192.168.8.20:44222')).toBeVisible()
    await user.click(
      within(popover).getByRole('button', { name: 'Copy address' })
    )
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(url))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(network).toHaveFocus())
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.syncHostEntry).not.toHaveBeenCalled()
    expect(commands.togglePerformerQr).not.toHaveBeenCalled()
  }
)

it('keeps an unbound performance network control accessible without a visible status label', () => {
  useHostEntryStore.setState({
    snapshot: { status: 'unbound', url: null, error: null, portChanged: false },
  })
  render(<DesktopBar />)
  const network = screen.getByRole('button', { name: 'Local network' })
  expect(network).toHaveTextContent(/^$/)
  expect(network).toHaveAccessibleDescription(
    i18n.t('participation.publicEntry.unbound')
  )
  expect(network.querySelector('svg')).toBeInTheDocument()
})

it.each([
  ['host', 'Host: Stage Mac'],
  ['creation', 'Creation mode: Stage Mac'],
] as const)(
  'places Exit performance before the active %s source and network',
  (role, label) => {
    const previous = useClientParticipationStore.getState().snapshot
    const source = {
      protocolVersion: 1,
      hostId: 'stage',
      nodeName: 'Stage Mac',
      role,
      performance: null,
    }
    usePerformanceRoleStore.setState({ role: 'client' })
    useClientParticipationStore.setState({
      snapshot: {
        ...previous,
        phase: 'open',
        host: source,
        activeHost: source,
        pageUrl: 'http://127.0.0.1:51000/',
      },
    })
    try {
      render(<DesktopBar />)
      const footer = screen.getByRole('contentinfo', {
        name: 'Performance and creation controls',
      })
      const [exit, sidebar, network] = within(footer).getAllByRole('button')
      expect(exit).toHaveAccessibleName('Exit performance')
      expect(sidebar).toHaveAccessibleName(label)
      expect(sidebar).toHaveClass('desktop-summary')
      expect(sidebar?.querySelector('svg')).toBeNull()
      expect(network).toHaveAccessibleName('Local network')
      expect(network).toHaveClass('desktop-summary')
    } finally {
      act(() => useClientParticipationStore.setState({ snapshot: previous }))
    }
  }
)
