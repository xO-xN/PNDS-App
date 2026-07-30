import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { Sidebar } from './Sidebar'
import type { Manifest, SessionSnapshot } from '@/lib/tauri-bindings'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
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
  })
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: null,
      trustedPaths: [],
      pendingTrustPath: null,
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
      screen.getByRole('button', { name: /zoom window/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /open in browser/i })
    ).toBeInTheDocument()
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
    vi.mocked(commands.listOutputDevices).mockResolvedValue({
      status: 'ok',
      data: {
        devices: ['Mac mini Speakers', 'BlackHole 16ch'],
        default: 'Mac mini Speakers',
      },
    })

    render(<Sidebar variant="overlay" />)

    // Wait for the async device list to populate first
    await screen.findByRole('option', { name: 'BlackHole 16ch' })
    const deviceSelect = screen.getByRole('combobox', {
      name: /output device/i,
    }) as HTMLSelectElement
    await user.selectOptions(deviceSelect, 'BlackHole 16ch')
    // Regression: the selected device must stay displayed (an earlier
    // filter dropped the current option, snapping back to default)
    expect(deviceSelect.value).toBe('BlackHole 16ch')
    expect(
      screen.getByRole('button', { name: /^change$/i })
    ).toBeInTheDocument()

    // Switching mode does NOT restart immediately — it shows the Change button
    await user.selectOptions(
      screen.getByRole('combobox', { name: /audio mode/i }),
      'none'
    )
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
    vi.mocked(commands.listOutputDevices).mockResolvedValue({
      status: 'ok',
      data: {
        devices: ['Mac mini Speakers', 'BlackHole 16ch'],
        default: 'Mac mini Speakers',
      },
    })
    vi.mocked(commands.stopProject).mockImplementation(async () => {
      useSessionStore.getState().applySnapshot(idleSnapshot)
      return { status: 'ok', data: null }
    })

    render(<Sidebar variant="overlay" />)
    await user.selectOptions(
      await screen.findByRole('combobox', { name: /output device/i }),
      'BlackHole 16ch'
    )
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
      (
        screen.getByRole('combobox', {
          name: /audio mode/i,
        }) as HTMLSelectElement
      ).value
    ).toBe('internal')
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
    const user = userEvent.setup()
    seedLoadedProject()
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

    await user.selectOptions(
      screen.getByRole('combobox', { name: /network address/i }),
      '10.0.0.5'
    )
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
