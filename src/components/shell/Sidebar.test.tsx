import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { toast } from 'sonner'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useWindowStore } from '@/store/window-store'
import { Sidebar } from './Sidebar'
import type { Manifest, SessionSnapshot } from '@/lib/tauri-bindings'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn() },
}))

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'inarticulate-iii',
  name: 'Inarticulate III',
  version: '0.1.0',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 6868,
    monitorPort: 6869,
  },
  audio: {
    defaultMode: 'internal',
    supportedModes: ['internal', 'external', 'none'],
    synthdefs: ['supercollider/synthdefs/inarticulate-iii.scsyndef'],
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}

/** A 16-channel project (spec §3.3): needs 16 device channels to be lossless. */
const manifest16: Manifest = {
  ...manifest,
  audio: {
    ...manifest.audio,
    outputChannels: 16,
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
  },
}

/** Same project at a different sample rate — for the stale-response race. */
const manifest96: Manifest = {
  ...manifest,
  audio: {
    ...manifest.audio,
    scsynth: { sampleRate: 96000, blockSize: 64, audioBusChannels: 128 },
  },
}

/** §6.3 test fixture: a 2ch default device + a 16ch interface. */
const deviceList = {
  status: 'ok' as const,
  data: {
    devices: [
      { name: 'Mac mini Speakers', isDefault: true, maxOutputChannels: 2 },
      { name: 'BlackHole 16ch', isDefault: false, maxOutputChannels: 16 },
    ],
    sampleRate: 48000,
  },
}

const PROJECT_PATH = '/Users/test/Inarticulate III'
const OTHER_PATH = '/Users/test/PNDS Score 1'
const THIRD_PATH = '/Users/test/Another Score'

const idleSnapshot: SessionSnapshot = {
  status: 'idle',
  projectName: null,
  projectPath: null,
  audioMode: null,
  lanIp: null,
  oscTarget: null,
  health: null,
  error: null,
  outputTail: [],
  volume: 80,
  startupStage: 0,
  channelPlan: null,
  outputDevice: null,
}

function seedLoadedProject() {
  useProjectStore.setState({
    currentProject: { path: PROJECT_PATH, manifest },
    trustedPaths: [PROJECT_PATH],
    pendingTrustPath: null,
    preflightStatus: 'ready',
    preflightError: null,
  })
  useSessionStore.setState({
    audioMode: 'internal',
    lanIp: '192.168.1.10',
    lanAddresses: ['192.168.1.10'],
    sessionStatus: 'idle',
    oscTargetInput: '127.0.0.1:3333',
    outputDevice: 'System default',
    pendingChanges: false,
    deviceError: null,
  })
}

function seedLoadedProject16() {
  useProjectStore.setState({
    currentProject: { path: PROJECT_PATH, manifest: manifest16 },
    trustedPaths: [PROJECT_PATH],
    pendingTrustPath: null,
    preflightStatus: 'ready',
    preflightError: null,
  })
  useSessionStore.setState({
    audioMode: 'internal',
    lanIp: '192.168.1.10',
    lanAddresses: ['192.168.1.10'],
    sessionStatus: 'idle',
    oscTargetInput: '127.0.0.1:3333',
    outputDevice: 'System default',
    pendingChanges: false,
    deviceError: null,
  })
}

/** §6.3: pick an entry in the Radix device select (open trigger → option). */
async function pickOutputDevice(
  user: ReturnType<typeof userEvent.setup>,
  label: string | RegExp
) {
  await user.click(screen.getByRole('combobox', { name: /output device/i }))
  await user.click(await screen.findByRole('option', { name: label }))
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: null,
      trustedPaths: [],
      projectFolders: [],
      pendingTrustPath: null,
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  it('shows the projects label and the settings card', () => {
    render(<Sidebar variant="static" />)
    expect(screen.getByText('PNDS Projects')).toBeInTheDocument()
    expect(screen.getByTestId('settings-card')).toBeInTheDocument()
  })

  it('shows custom traffic lights and top-right action buttons', () => {
    render(<Sidebar variant="static" />)
    expect(
      screen.getByRole('button', { name: /close window/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /minimize window/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /toggle full screen/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /open in browser/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /reload monitor/i })
    ).toBeInTheDocument()
  })

  it('the green traffic light calls the single fullscreen action (§7.4)', async () => {
    const user = userEvent.setup()
    render(<Sidebar variant="static" />)
    await user.click(
      screen.getByRole('button', { name: /toggle full screen/i })
    )
    expect(commands.toggleFullscreen).toHaveBeenCalledTimes(1)
  })

  it('hides custom traffic lights while the native title bar shows (§7.4)', () => {
    useWindowStore.setState({
      fullscreen: true,
      showCustomTrafficLights: false,
      generation: 1,
    })
    render(<Sidebar variant="static" />)
    expect(
      screen.queryByRole('button', { name: /close window/i })
    ).not.toBeInTheDocument()
    // Share/refresh remain available in fullscreen.
    expect(
      screen.getByRole('button', { name: /reload monitor/i })
    ).toBeInTheDocument()
  })

  it('selects a project on click, then starts it via the Load button', async () => {
    const user = userEvent.setup()
    useProjectStore.getState().trustProject(PROJECT_PATH)
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })

    render(<Sidebar variant="static" />)
    await user.click(screen.getByText('Inarticulate III'))

    // Clicking only selects (preflights) — no auto-start
    await waitFor(() => {
      expect(commands.preflightProject).toHaveBeenCalledWith(PROJECT_PATH)
    })
    expect(commands.startProject).not.toHaveBeenCalled()

    const loadButton = screen.getByRole('button', { name: /^load$/i })
    await waitFor(() => {
      expect(loadButton).toBeEnabled()
    })

    await user.click(loadButton)
    await waitFor(() => {
      expect(commands.startProject).toHaveBeenCalledWith(
        PROJECT_PATH,
        'internal',
        '192.168.1.10',
        null
      )
    })
  })

  it('shows immediate feedback while project preflight is pending', async () => {
    useProjectStore.getState().trustProject(PROJECT_PATH)
    let resolvePreflight!: () => void
    const pendingPreflight = new Promise<void>(resolve => {
      resolvePreflight = resolve
    }).then(() => ({ status: 'ok' as const, data: manifest }))
    vi.mocked(commands.preflightProject).mockReturnValue(pendingPreflight)

    render(<Sidebar variant="static" />)
    const projectCard = screen.getByTestId('project-entry')
    fireEvent.click(projectCard)

    expect(projectCard.className).toContain('bg-(--pnds-card)')
    expect(commands.preflightProject).toHaveBeenCalledWith(PROJECT_PATH)

    resolvePreflight()
    await waitFor(() => {
      expect(screen.getByTestId('current-project-card')).toBeInTheDocument()
    })
  })

  it('clears an idle project selection when clicking the selected card again', async () => {
    const user = userEvent.setup()
    seedLoadedProject()

    render(<Sidebar variant="static" />)
    const currentCard = screen.getByTestId('current-project-card')

    await user.click(
      within(currentCard).getByRole('button', { name: 'Inarticulate III' })
    )

    expect(useProjectStore.getState().currentProject).toBeNull()
    expect(useProjectStore.getState().preflightStatus).toBe('idle')
    expect(useProjectStore.getState().trustedPaths).toEqual([PROJECT_PATH])
    expect(screen.queryByTestId('current-project-card')).not.toBeInTheDocument()
    expect(screen.getByTestId('project-entry')).toBeInTheDocument()
  })

  it('defers mode changes: Change button appears, clicks restarts (§8.3)', async () => {
    const user = userEvent.setup()
    seedLoadedProject()
    useSessionStore.setState({ sessionStatus: 'ready' })
    vi.mocked(commands.listOutputDevices).mockResolvedValue(deviceList)

    render(<Sidebar variant="overlay" />)

    // Wait for the async device list to populate, then pick a device
    // (pickOutputDevice opens the Radix menu itself).
    await screen.findByRole('combobox', { name: /output device/i })
    await pickOutputDevice(user, /BlackHole 16ch/)
    // Regression: the selected device must stay displayed (an earlier
    // filter dropped the current option, snapping back to default)
    expect(
      screen.getByRole('combobox', { name: /output device/i })
    ).toHaveTextContent('BlackHole 16ch')
    expect(
      screen.getByRole('button', { name: /^change$/i })
    ).toBeInTheDocument()

    // Switching mode does NOT restart immediately — it shows the Change button
    await user.click(screen.getByRole('combobox', { name: /audio mode/i }))
    await user.click(await screen.findByRole('option', { name: 'None' }))
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /^change$/i })
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^change$/i }))
    await waitFor(() => {
      expect(commands.stopProject).toHaveBeenCalled()
    })
    expect(commands.startProject).toHaveBeenCalledWith(
      PROJECT_PATH,
      'none',
      '192.168.1.10',
      null
    )
  })

  it('marks a 16ch project’s 2ch device as greyed-but-selectable with a red ✕ (§6.3)', async () => {
    const user = userEvent.setup()
    seedLoadedProject16()
    vi.mocked(commands.listOutputDevices).mockResolvedValue(deviceList)

    render(<Sidebar variant="static" />)
    const trigger = await screen.findByRole('combobox', {
      name: /output device/i,
    })
    await user.click(trigger)

    const option = await screen.findByRole('option', {
      name: /Mac mini Speakers/,
    })
    // Greyed but NOT a real disabled state: the option stays focusable
    // and clickable, with the red ✕ marker present.
    expect(option.className).toContain('opacity-40')
    expect(
      within(option).getByTestId('device-insufficient-marker')
    ).toBeInTheDocument()
    // Enough-channels device shows no ✕.
    const enough = screen.getByRole('option', { name: /BlackHole 16ch/ })
    expect(enough.className).not.toContain('opacity-40')
    expect(
      within(enough).queryByTestId('device-insufficient-marker')
    ).not.toBeInTheDocument()
    // Channel counts are shown per entry.
    expect(screen.getByText('16ch')).toBeInTheDocument()

    // Keyboard: arrow keys move through the insufficient option (no
    // HTML disabled state blocks it), Enter selects it.
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(
        screen.getByRole('combobox', { name: /output device/i })
      ).toHaveTextContent('Mac mini Speakers')
    })
  })

  it('shows a persistent Nch → Hch hint for a channel-poor selection with no toast (§6.3)', async () => {
    const user = userEvent.setup()
    seedLoadedProject16()
    vi.mocked(commands.listOutputDevices).mockResolvedValue(deviceList)

    render(<Sidebar variant="static" />)
    await pickOutputDevice(user, /Mac mini Speakers/)

    expect(screen.getByTestId('device-insufficient-hint')).toHaveTextContent(
      '16ch → 2ch'
    )
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('shows no loss hint when the device has enough channels', async () => {
    const user = userEvent.setup()
    seedLoadedProject16()
    vi.mocked(commands.listOutputDevices).mockResolvedValue(deviceList)

    render(<Sidebar variant="static" />)
    await pickOutputDevice(user, /BlackHole 16ch/)

    expect(
      screen.queryByTestId('device-insufficient-hint')
    ).not.toBeInTheDocument()
  })

  it('ignores a stale device-list response from a previous project (race guard)', async () => {
    const user = userEvent.setup()
    useProjectStore.setState({
      currentProject: { path: PROJECT_PATH, manifest: manifest96 },
      trustedPaths: [PROJECT_PATH],
      pendingTrustPath: null,
      preflightStatus: 'ready',
      preflightError: null,
    })
    useSessionStore.setState({
      audioMode: 'internal',
      lanIp: '192.168.1.10',
      lanAddresses: ['192.168.1.10'],
      sessionStatus: 'idle',
      outputDevice: 'System default',
      pendingChanges: false,
      deviceError: null,
    })
    let resolve96!: (v: { status: 'ok'; data: typeof deviceList.data }) => void
    vi.mocked(commands.listOutputDevices).mockReturnValueOnce(
      new Promise(resolve => {
        resolve96 = resolve
      })
    )
    vi.mocked(commands.listOutputDevices).mockResolvedValueOnce(deviceList)

    const { rerender } = render(<Sidebar variant="static" />)

    // Switch to the 48k project while the 96k query is still in flight.
    useProjectStore.setState({
      currentProject: { path: PROJECT_PATH, manifest },
    })
    rerender(<Sidebar variant="static" />)

    resolve96({
      status: 'ok',
      data: {
        devices: [
          { name: 'Old Device', isDefault: true, maxOutputChannels: 2 },
        ],
        sampleRate: 96000,
      },
    })
    // The stale 96k response must not overwrite the 48k list: the live
    // menu offers the 48k entries, never the stale "Old Device".
    const trigger = await screen.findByRole('combobox', {
      name: /output device/i,
    })
    await user.click(trigger)
    await user.click(
      await screen.findByRole('option', { name: /BlackHole 16ch/ })
    )
    expect(
      screen.queryByRole('option', { name: /Old Device/ })
    ).not.toBeInTheDocument()
    // No error surfaced for the stale response.
    expect(screen.queryByTestId('device-error')).not.toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: /output device/i })
    ).toHaveTextContent('BlackHole 16ch')
  })

  it('gates Load and shows an inline error when device capability fails (§6.3)', async () => {
    seedLoadedProject16()
    vi.mocked(commands.listOutputDevices).mockResolvedValue({
      status: 'error',
      error: 'Failed to enumerate audio output devices: boom',
    })

    render(<Sidebar variant="static" />)
    await screen.findByTestId('device-error')
    expect(screen.getByTestId('device-error')).toBeInTheDocument()
    const loadButton = screen.getByRole('button', { name: /^load$/i })
    expect(loadButton).toBeDisabled()
  })

  it('shows a fixed 100% and disables the slider for N>2 sessions (§7.5)', async () => {
    seedLoadedProject16()
    useSessionStore.setState({
      sessionStatus: 'ready',
      channelPlan: {
        projectChannels: 16,
        deviceChannels: 16,
        bridgedChannels: 16,
        privateBusStart: 16,
      },
      volume: 80,
    })
    vi.mocked(commands.listOutputDevices).mockResolvedValue(deviceList)

    render(<Sidebar variant="static" />)
    const slider = screen.getByRole('slider', {
      name: /fixed at 100%/i,
    }) as HTMLInputElement
    expect(slider).toBeDisabled()
    expect(slider.value).toBe('100')
    // Non-100 master updates are rejected by the backend; the UI shows
    // the fixed-100 slider, never a live master-volume slider.
    expect(
      screen.queryByRole('slider', { name: /^master volume$/i })
    ).toBeNull()
  })

  it('keeps the 80% default and live behaviour for N<=2 sessions', async () => {
    seedLoadedProject()
    useSessionStore.setState({
      sessionStatus: 'ready',
      channelPlan: {
        projectChannels: 2,
        deviceChannels: 2,
        bridgedChannels: 2,
        privateBusStart: 2,
      },
    })
    vi.mocked(commands.listOutputDevices).mockResolvedValue(deviceList)
    vi.mocked(commands.setMasterVolume).mockResolvedValue({
      status: 'ok',
      data: null,
    })

    render(<Sidebar variant="static" />)
    const slider = screen.getByRole('slider', {
      name: /master volume/i,
    }) as HTMLInputElement
    expect(slider).not.toBeDisabled()
    expect(slider.value).toBe('80')
    fireEvent.change(slider, { target: { value: '40' } })
    await waitFor(() => {
      expect(commands.setMasterVolume).toHaveBeenCalledWith(40)
    })
  })

  it('falls back to the system default with the existing notice when a saved device vanishes (§6.3)', async () => {
    seedLoadedProject()
    useSessionStore.setState({ outputDevice: 'Gone Interface' })
    vi.mocked(commands.listOutputDevices).mockResolvedValue(deviceList)

    render(<Sidebar variant="static" />)
    await waitFor(() => {
      expect(useSessionStore.getState().outputDevice).toBe('System default')
    })
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining('not available')
    )
    expect(
      screen.getByRole('combobox', { name: /output device/i })
    ).toHaveTextContent('System default')
  })

  it('closes the running project via the Close button', async () => {
    const user = userEvent.setup()
    seedLoadedProject()
    useSessionStore.setState({ sessionStatus: 'ready' })

    render(<Sidebar variant="overlay" />)
    await user.click(screen.getByRole('button', { name: /^close$/i }))

    await waitFor(() => {
      expect(commands.stopProject).toHaveBeenCalled()
      expect(useProjectStore.getState().currentProject).toBeNull()
    })
    expect(useProjectStore.getState().trustedPaths).toHaveLength(1)
  })

  it('keeps the selected project when changing the output device during a restart', async () => {
    const user = userEvent.setup()
    seedLoadedProject()
    useSessionStore.setState({ sessionStatus: 'ready' })
    vi.mocked(commands.listOutputDevices).mockResolvedValue(deviceList)
    vi.mocked(commands.stopProject).mockImplementation(async () => {
      useSessionStore.getState().applySnapshot(idleSnapshot)
      return { status: 'ok', data: null }
    })

    render(<Sidebar variant="overlay" />)
    await pickOutputDevice(user, /BlackHole 16ch/)
    await user.click(screen.getByRole('button', { name: /^change$/i }))

    await waitFor(() => {
      expect(commands.startProject).toHaveBeenCalledWith(
        PROJECT_PATH,
        'internal',
        '192.168.1.10',
        null
      )
      expect(useProjectStore.getState().currentProject?.path).toBe(PROJECT_PATH)
    })
    expect(
      screen.getByRole('combobox', { name: /audio mode/i })
    ).toHaveTextContent('Internal Synth')
  })

  it('keeps the selected project when changing an external OSC target during a restart', async () => {
    const user = userEvent.setup()
    seedLoadedProject()
    useSessionStore.setState({
      sessionStatus: 'ready',
      audioMode: 'external',
      oscTargetInput: '127.0.0.1:3333',
    })
    vi.mocked(commands.stopProject).mockImplementation(async () => {
      useSessionStore.getState().applySnapshot(idleSnapshot)
      return { status: 'ok', data: null }
    })

    render(<Sidebar variant="overlay" />)
    const oscInput = screen.getByRole('textbox', { name: /osc target/i })
    await user.clear(oscInput)
    await user.type(oscInput, '127.0.0.1:57120')
    await user.keyboard('{Enter}')
    await user.click(screen.getByRole('button', { name: /^change$/i }))

    await waitFor(() => {
      expect(commands.startProject).toHaveBeenCalledWith(
        PROJECT_PATH,
        'external',
        '192.168.1.10',
        '127.0.0.1:57120'
      )
      expect(useProjectStore.getState().currentProject?.path).toBe(PROJECT_PATH)
    })
    expect(screen.getByTestId('current-project-card')).toBeInTheDocument()
  })

  it('removes a non-open project from history via its ✕ button', async () => {
    const user = userEvent.setup()
    seedLoadedProject()
    useProjectStore.setState({
      trustedPaths: [PROJECT_PATH, OTHER_PATH],
    })

    render(<Sidebar variant="static" />)
    const currentCard = screen.getByTestId('current-project-card')
    expect(
      within(currentCard).queryByRole('button', {
        name: /remove from history/i,
      })
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /remove from history/i })
    )
    expect(useProjectStore.getState().trustedPaths).toEqual([PROJECT_PATH])
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('reorders history by dragging the grip and persists the new order', async () => {
    seedLoadedProject()
    useProjectStore.setState({
      trustedPaths: [PROJECT_PATH, OTHER_PATH, THIRD_PATH],
    })

    render(<Sidebar variant="static" />)

    const sourceEntry = screen.getAllByTestId('project-entry')[0]
    if (!sourceEntry) throw new Error('Expected a draggable project entry')
    const sourceGrip = within(sourceEntry).getByRole('button', {
      name: /drag to reorder/i,
    })
    const targetCard = screen.getByTestId('current-project-card')

    fireEvent.pointerDown(sourceGrip, { pointerId: 1 })
    await waitFor(() => expect(sourceEntry).toHaveClass('opacity-50'))
    fireEvent.pointerMove(targetCard, { pointerId: 1 })
    expect(screen.getByTestId('project-drop-indicator')).toBeInTheDocument()
    fireEvent.pointerUp(window, { pointerId: 1 })

    expect(useProjectStore.getState().trustedPaths).toEqual([
      OTHER_PATH,
      PROJECT_PATH,
      THIRD_PATH,
    ])
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          recentProjects: [OTHER_PATH, PROJECT_PATH, THIRD_PATH],
        })
      )
    })
  })

  it('asks for confirmation before switching projects while running (§8.3)', async () => {
    seedLoadedProject()
    const user = userEvent.setup()
    useProjectStore.setState({ trustedPaths: [PROJECT_PATH, OTHER_PATH] })
    useSessionStore.setState({ sessionStatus: 'ready' })
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })

    render(<Sidebar variant="overlay" />)
    await user.click(screen.getByText('PNDS Score 1'))

    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /^load$/i }))

    await waitFor(() => {
      expect(commands.stopProject).toHaveBeenCalled()
      expect(commands.preflightProject).toHaveBeenCalledWith(OTHER_PATH)
    })
  })

  it('does not start on LAN pick alone; Load becomes the trigger (§7)', async () => {
    const user = userEvent.setup()
    seedLoadedProject()
    useSessionStore.setState({
      lanIp: null,
      lanAddresses: ['192.168.1.10', '10.0.0.5'],
      sessionStatus: 'idle',
    })

    render(<Sidebar variant="static" />)
    const loadButton = screen.getByRole('button', { name: /^load$/i })
    expect(loadButton).toBeDisabled()

    await user.click(screen.getByRole('combobox', { name: /network address/i }))
    await user.click(await screen.findByRole('option', { name: '10.0.0.5' }))
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(loadButton).toBeEnabled()

    await user.click(loadButton)
    await waitFor(() => {
      expect(commands.startProject).toHaveBeenCalledWith(
        PROJECT_PATH,
        'internal',
        '10.0.0.5',
        null
      )
    })
  })

  it('shows OSC input only for external mode (§6.6)', () => {
    seedLoadedProject()
    useSessionStore.setState({ audioMode: 'internal' })

    const { rerender } = render(<Sidebar variant="static" />)
    expect(screen.queryByLabelText(/osc target/i)).not.toBeInTheDocument()

    useSessionStore.setState({ audioMode: 'external' })
    rerender(<Sidebar variant="static" />)
    expect(screen.getByLabelText(/osc target/i)).toBeInTheDocument()
  })
})
