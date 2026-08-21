import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  mockBoundingClientRect,
} from '@/test/test-utils'
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
    recentProjectPaths: [PROJECT_PATH],
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
    recentProjectPaths: [PROJECT_PATH],
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
      recentProjectPaths: [],
      projectFolders: [],
      pendingPreflightPath: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  it('shows the folder switch row, the header buttons and the settings card', () => {
    render(<Sidebar variant="static" />)
    expect(screen.getByTestId('settings-card')).toBeInTheDocument()

    // The folder switch always renders: the unfiled segment carries the
    // default view; folder management lives in the context menu (issue
    // #28), so no new-folder button exists anymore (the bottom "Open"
    // pill is long gone too).
    expect(screen.getByTestId('unfiled-segment')).toBeInTheDocument()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByTestId('add-project-button')).toBeInTheDocument()
    expect(screen.queryByTestId('new-folder-button')).not.toBeInTheDocument()
    expect(screen.queryByText('Open')).not.toBeInTheDocument()
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
    useProjectStore.getState().addRecentProject(PROJECT_PATH)
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
    useProjectStore.getState().addRecentProject(PROJECT_PATH)
    let resolvePreflight!: () => void
    const pendingPreflight = new Promise<void>(resolve => {
      resolvePreflight = resolve
    }).then(() => ({ status: 'ok' as const, data: manifest }))
    vi.mocked(commands.preflightProject).mockReturnValue(pendingPreflight)

    render(<Sidebar variant="static" />)
    const projectCard = screen.getByTestId('project-entry')
    fireEvent.click(projectCard)

    // v1.2.2 (card-selection pill): the pending card takes the selection
    // branch (hover affordance dropped) and the pill rides under it —
    // jsdom has no layout, so the branch is the honest observable; the
    // slide itself is human-verified.
    expect(projectCard.className).not.toContain('hover:bg-')
    expect(screen.getByTestId('card-selection-pill')).toBeInTheDocument()
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
    expect(useProjectStore.getState().recentProjectPaths).toEqual([
      PROJECT_PATH,
    ])
    expect(screen.queryByTestId('current-project-card')).not.toBeInTheDocument()
    expect(screen.getByTestId('project-entry')).toBeInTheDocument()
  })

  it('defers mode changes: Change button appears, clicks restarts (§8.3)', async () => {
    const user = userEvent.setup()
    seedLoadedProject()
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: PROJECT_PATH,
    })
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

  it('marks a 16ch project’s 2ch device as greyed-but-selectable with the red loss text (§6.3)', async () => {
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
    // and clickable; the red loss text is the marker (no ✕ glyph).
    expect(option.className).toContain('opacity-40')
    expect(
      within(option).queryByTestId('device-insufficient-marker')
    ).not.toBeInTheDocument()
    // Enough-channels device shows neither grey nor the loss text.
    const enough = screen.getByRole('option', { name: /BlackHole 16ch/ })
    expect(enough.className).not.toContain('opacity-40')
    expect(within(enough).queryByText('16ch → 2ch')).not.toBeInTheDocument()
    // Channel counts are shown per entry — sufficient entries keep the
    // bare count, insufficient ones spell out the loss (16ch → 2ch).
    expect(screen.getByText('16ch')).toBeInTheDocument()
    expect(within(option).getByText('16ch → 2ch')).toBeInTheDocument()

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

    const hint = screen.getByTestId('device-insufficient-hint')
    // v1.2.0: the closed trigger shows only a small red dot — the full
    // "16ch → 2ch" loss rides along as sr-only text (kept assertable and
    // screen-reader visible) plus the dot's hover tooltip; the opened list
    // spells out every entry's channel count.
    expect(hint).toHaveTextContent('16ch → 2ch')
    expect(hint.querySelector('span[aria-hidden="true"]')).toBeInTheDocument()
    const trigger = screen.getByRole('combobox', { name: /output device/i })
    expect(trigger).toContainElement(hint)
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
      recentProjectPaths: [PROJECT_PATH],
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
      sessionProjectPath: PROJECT_PATH,
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
      sessionProjectPath: PROJECT_PATH,
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
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: PROJECT_PATH,
    })

    render(<Sidebar variant="overlay" />)
    await user.click(screen.getByRole('button', { name: /^close$/i }))

    await waitFor(() => {
      expect(commands.stopProject).toHaveBeenCalled()
      expect(useProjectStore.getState().currentProject).toBeNull()
    })
    expect(useProjectStore.getState().recentProjectPaths).toHaveLength(1)
  })

  it('keeps the selected project when changing the output device during a restart', async () => {
    const user = userEvent.setup()
    seedLoadedProject()
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: PROJECT_PATH,
    })
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
      sessionProjectPath: PROJECT_PATH,
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
      recentProjectPaths: [PROJECT_PATH, OTHER_PATH],
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
    expect(useProjectStore.getState().recentProjectPaths).toEqual([
      PROJECT_PATH,
    ])
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('reorders history by dragging the grip and persists the new order', async () => {
    seedLoadedProject()
    useProjectStore.setState({
      recentProjectPaths: [PROJECT_PATH, OTHER_PATH, THIRD_PATH],
    })

    render(<Sidebar variant="static" />)

    const sourceEntry = screen.getAllByTestId('project-entry')[0]
    if (!sourceEntry) throw new Error('Expected a draggable project entry')
    const targetCard = screen.getByTestId('current-project-card')

    // jsdom lays out nothing: pin the rects the drag derives geometry from
    // (cards pitch 61px apart — the top card at 0, the source at 61). The
    // drop hit-test is pure math over this static layout.
    mockBoundingClientRect(targetCard, { top: 0 })
    mockBoundingClientRect(sourceEntry, { top: 61 })
    const strideEntry = screen.getAllByTestId('project-entry')[1]
    if (!strideEntry) throw new Error('Expected a second draggable entry')
    mockBoundingClientRect(strideEntry, { top: 122 })

    // The press activates into a drag only past the click slack.
    fireEvent.pointerDown(sourceEntry, {
      pointerId: 1,
      clientX: 40,
      clientY: 80,
    })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 44, clientY: 76 })
    const clone = await waitFor(() => screen.getByTestId('drag-clone'))
    // The 1px indicator is gone; the source card hides behind its clone.
    expect(
      screen.queryByTestId('project-drop-indicator')
    ).not.toBeInTheDocument()
    await waitFor(() => expect(sourceEntry).toHaveClass('invisible'))

    // The clone follows the pointer while the hovered top card yields a
    // full-card gap (the pointer sits in its top half → drop before).
    const initialTransform = clone.style.transform
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 45, clientY: 10 })
    expect(clone.style.transform).not.toBe(initialTransform)
    expect(targetCard.style.transform).toMatch(
      /^translateY\(-?\d+(\.\d+)?px\)$/
    )

    fireEvent.pointerUp(window, { pointerId: 1 })

    expect(useProjectStore.getState().recentProjectPaths).toEqual([
      OTHER_PATH,
      PROJECT_PATH,
      THIRD_PATH,
    ])
    // The DOM reorder and the clearing of the yield transforms share one
    // commit: for that frame the card that yielded must not animate from
    // its stale offset (the wrong-way slide) — transitions are paused...
    expect(screen.getByTestId('current-project-card')).toHaveClass(
      'transition-none'
    )
    // ...and return once the snap frame has painted.
    await waitFor(() =>
      expect(screen.getByTestId('current-project-card')).not.toHaveClass(
        'transition-none'
      )
    )
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          recentProjects: [OTHER_PATH, PROJECT_PATH, THIRD_PATH],
        })
      )
    })
  })

  it('the click that follows a drag drop is not a selection', async () => {
    seedLoadedProject()
    useProjectStore.setState({
      recentProjectPaths: [PROJECT_PATH, OTHER_PATH, THIRD_PATH],
    })

    render(<Sidebar variant="static" />)

    const sourceEntry = screen.getAllByTestId('project-entry')[0]
    const targetCard = screen.getByTestId('current-project-card')
    if (!sourceEntry) throw new Error('Expected a draggable project entry')
    mockBoundingClientRect(targetCard, { top: 0 })
    mockBoundingClientRect(sourceEntry, { top: 61 })
    const strideEntry = screen.getAllByTestId('project-entry')[1]
    if (!strideEntry) throw new Error('Expected a second draggable entry')
    mockBoundingClientRect(strideEntry, { top: 122 })

    fireEvent.pointerDown(sourceEntry, {
      pointerId: 1,
      clientX: 40,
      clientY: 80,
    })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 44, clientY: 76 })
    await waitFor(() =>
      expect(screen.getByTestId('drag-clone')).toBeInTheDocument()
    )
    fireEvent.pointerUp(window, { pointerId: 1 })

    // A real browser fires a click on the card right after the drop's
    // pointerup — it must not select or clear anything underneath.
    const draggedCard = screen
      .getAllByTestId(/project-entry|current-project-card/)
      .find(card => card.getAttribute('data-project-path') === OTHER_PATH)
    if (!draggedCard) throw new Error('Expected the dragged card')
    fireEvent.click(draggedCard)
    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(useProjectStore.getState().currentProject).not.toBeNull()
  })

  it('a press released inside the click slack never becomes a drag', async () => {
    seedLoadedProject()
    useProjectStore.setState({ recentProjectPaths: [PROJECT_PATH, OTHER_PATH] })
    render(<Sidebar variant="static" />)

    const sourceEntry = screen.getAllByTestId('project-entry')[0]
    if (!sourceEntry) throw new Error('Expected a draggable project entry')
    fireEvent.pointerDown(sourceEntry, {
      pointerId: 1,
      clientX: 40,
      clientY: 80,
    })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 42, clientY: 80 })
    fireEvent.pointerUp(window, { pointerId: 1 })

    expect(screen.queryByTestId('drag-clone')).not.toBeInTheDocument()
    expect(useProjectStore.getState().recentProjectPaths).toEqual([
      PROJECT_PATH,
      OTHER_PATH,
    ])
  })

  it('selects another project freely while running — no dialog, no stop (#39)', async () => {
    seedLoadedProject()
    const user = userEvent.setup()
    useProjectStore.setState({ recentProjectPaths: [PROJECT_PATH, OTHER_PATH] })
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: PROJECT_PATH,
    })
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })

    render(<Sidebar variant="overlay" />)
    await user.click(screen.getByText('PNDS Score 1'))

    // v1.2.3 (#39): the click selects + preflights; no confirmation, the
    // session is never stopped.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(commands.preflightProject).toHaveBeenCalledWith(OTHER_PATH)
    })
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(useSessionStore.getState().sessionStatus).toBe('ready')
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

/**
 * v1.2.3 (#39/T4): the settings footer follows the SELECTION — selecting
 * another card over a running session turns the footer into that card's
 * Load (its pending config above), while the running card keeps
 * Close/Change and the live volume. Loading over the live session asks
 * once, then stops the old one and starts the selection.
 */
describe('settings footer follows the selection (#39/T4)', () => {
  /** A runs; B is selected with its own preflighted config. */
  function seedRunningWithOtherSelected() {
    seedLoadedProject()
    useProjectStore.setState({
      recentProjectPaths: [PROJECT_PATH, OTHER_PATH],
      currentProject: { path: OTHER_PATH, manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: PROJECT_PATH,
      projectName: 'Inarticulate III',
      lanIp: '192.168.1.10',
      lanAddresses: ['192.168.1.10'],
      audioMode: 'internal',
      deviceError: null,
    })
  }

  it("shows the selection's Load over the running session", () => {
    seedRunningWithOtherSelected()
    render(<Sidebar variant="overlay" />)

    const load = screen.getByRole('button', { name: /^load$/i })
    expect(load).toBeEnabled()
    // The running session keeps Close semantics only for its own card.
    expect(
      screen.queryByRole('button', { name: /^close$/i })
    ).not.toBeInTheDocument()
    // Volume is the running session\'s live control — it waits while
    // another card is selected.
    expect(
      screen.getByRole('slider', { name: /^master volume$/i })
    ).toBeDisabled()
  })

  it('keeps Close on the running card, with volume live', () => {
    seedLoadedProject()
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: PROJECT_PATH,
      lanIp: '192.168.1.10',
    })
    render(<Sidebar variant="overlay" />)

    expect(screen.getByRole('button', { name: /^close$/i })).toBeInTheDocument()
    expect(
      screen.getByRole('slider', { name: /^master volume$/i })
    ).toBeEnabled()
  })

  it('Load confirms, then stops the old session and starts the selection', async () => {
    const user = userEvent.setup()
    seedRunningWithOtherSelected()
    render(<Sidebar variant="overlay" />)

    await user.click(screen.getByRole('button', { name: /^load$/i }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/Inarticulate III/)
    await user.click(within(dialog).getByRole('button', { name: /^start$/i }))

    await waitFor(() => {
      expect(commands.stopProject).toHaveBeenCalledTimes(1)
      expect(commands.startProject).toHaveBeenCalledWith(
        OTHER_PATH,
        'internal',
        '192.168.1.10',
        null
      )
    })
    // The selection survives the switch.
    expect(useProjectStore.getState().currentProject?.path).toBe(OTHER_PATH)
  })

  it('Enter opens the same confirm — Enter again confirms it', async () => {
    seedRunningWithOtherSelected()
    render(<Sidebar variant="overlay" />)

    fireEvent.keyDown(window, { key: 'Enter' })
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/start/i)

    fireEvent.keyDown(dialog, { key: 'Enter' })
    await waitFor(() => {
      expect(commands.stopProject).toHaveBeenCalledTimes(1)
      expect(commands.startProject).toHaveBeenCalledWith(
        OTHER_PATH,
        'internal',
        '192.168.1.10',
        null
      )
    })
  })

  it('a dead error session loads the selection without asking', async () => {
    seedRunningWithOtherSelected()
    useSessionStore.setState({ sessionStatus: 'error' })
    render(<Sidebar variant="overlay" />)

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(commands.startProject).toHaveBeenCalledWith(
        OTHER_PATH,
        'internal',
        '192.168.1.10',
        null
      )
    })
  })
})
