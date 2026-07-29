import { render, screen, waitFor, within, fireEvent } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openUrl } from '@tauri-apps/plugin-opener'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { Sidebar } from './Sidebar'
import type { Manifest } from '@/lib/tauri-bindings'

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

  it('opens the monitor page in the default browser via Share (running only)', async () => {
    const user = userEvent.setup()
    seedLoadedProject()

    const { rerender } = render(<Sidebar variant="static" />)
    // Not running: Share is disabled
    expect(
      screen.getByRole('button', { name: /open in browser/i })
    ).toBeDisabled()

    useSessionStore.setState({
      sessionStatus: 'ready',
      health: {
        status: 'ready',
        projectId: 'inarticulate-iii',
        audioMode: 'none',
        audio: { status: 'disabled', target: null, error: null },
        scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
      },
    })
    rerender(<Sidebar variant="overlay" />)

    await user.click(screen.getByRole('button', { name: /open in browser/i }))
    expect(openUrl).toHaveBeenCalledWith('http://192.168.1.10:6869/')
  })

  it('reloads the monitor via Refresh (running only)', async () => {
    const user = userEvent.setup()
    seedLoadedProject()

    const { rerender } = render(<Sidebar variant="static" />)
    expect(
      screen.getByRole('button', { name: /reload monitor/i })
    ).toBeDisabled()

    useSessionStore.setState({ sessionStatus: 'ready' })
    rerender(<Sidebar variant="overlay" />)

    const before = useSessionStore.getState().monitorReloadNonce
    await user.click(screen.getByRole('button', { name: /reload monitor/i }))
    expect(useSessionStore.getState().monitorReloadNonce).toBe(before + 1)
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

    await user.click(screen.getByRole('button', { name: /^load$/i }))
    await waitFor(() => {
      expect(commands.startProject).toHaveBeenCalledWith(
        PROJECT_PATH,
        'internal',
        '192.168.1.10',
        null
      )
    })
  })

  it('restarts the session when the mode changes while running (§8.3)', async () => {
    const user = userEvent.setup()
    seedLoadedProject()
    useSessionStore.setState({ sessionStatus: 'ready' })

    render(<Sidebar variant="overlay" />)
    await user.selectOptions(
      screen.getByRole('combobox', { name: /audio mode/i }),
      'none'
    )

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
    // The project stays in history and can be loaded again
    expect(useProjectStore.getState().trustedPaths).toHaveLength(1)
  })

  it('removes a non-open project from history via its ✕ button', async () => {
    const user = userEvent.setup()
    seedLoadedProject()
    useProjectStore.setState({
      trustedPaths: [PROJECT_PATH, OTHER_PATH],
    })

    render(<Sidebar variant="static" />)
    // The open project must not show a remove button
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
    // Removing a non-open project never touches the session
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('asks for confirmation before switching projects while running (§8.3)', async () => {
    const user = userEvent.setup()
    seedLoadedProject()
    useProjectStore.setState({
      trustedPaths: [PROJECT_PATH, OTHER_PATH],
    })
    useSessionStore.setState({ sessionStatus: 'ready' })
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })

    render(<Sidebar variant="overlay" />)
    await user.click(screen.getByText('PNDS Score 1'))

    expect(await screen.findByText(/load the “PNDS Score 1”\?/i))
    await user.click(screen.getByRole('button', { name: /^load$/i }))

    await waitFor(() => {
      expect(commands.stopProject).toHaveBeenCalled()
      expect(commands.preflightProject).toHaveBeenCalledWith(OTHER_PATH)
    })
  })

  it('enables the volume slider only for a running internal session (§6.4)', async () => {
    seedLoadedProject()

    const { rerender } = render(<Sidebar variant="static" />)
    // Not running: disabled
    expect(
      screen.getByRole('slider', { name: /master volume/i })
    ).toBeDisabled()

    // Running internal: enabled and wired to setMasterVolume
    useSessionStore.setState({ sessionStatus: 'ready', audioMode: 'internal' })
    rerender(<Sidebar variant="overlay" />)
    const slider = screen.getByRole('slider', { name: /master volume/i })
    expect(slider).toBeEnabled()
    fireEvent.change(slider, { target: { value: '65' } })
    expect(commands.setMasterVolume).toHaveBeenCalledWith(65)

    // External/none: disabled again (§6.4)
    useSessionStore.setState({ audioMode: 'none' })
    rerender(<Sidebar variant="overlay" />)
    expect(
      screen.getByRole('slider', { name: /master volume/i })
    ).toBeDisabled()
  })

  it('saves the output device choice and restarts a running internal session (§6.5, §8.3)', async () => {
    const user = userEvent.setup()
    seedLoadedProject()
    useSessionStore.setState({ sessionStatus: 'ready' })

    render(<Sidebar variant="overlay" />)
    // Wait for the async device list to populate first
    await screen.findByRole('option', { name: 'BlackHole 16ch' })
    await user.selectOptions(
      screen.getByRole('combobox', { name: /output device/i }),
      'BlackHole 16ch'
    )

    // Choice is persisted as an app-local preference
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ outputDevice: 'BlackHole 16ch' })
      )
    })
    // …and a running internal session restarts to apply it (§8.3)
    expect(commands.stopProject).toHaveBeenCalled()
    expect(commands.startProject).toHaveBeenCalled()
  })

  it('blocks Load for external mode with an invalid OSC target (§6.6)', async () => {
    const user = userEvent.setup()
    seedLoadedProject()
    useSessionStore.setState({
      audioMode: 'external',
      oscTargetInput: 'not-a-target',
    })

    render(<Sidebar variant="static" />)
    expect(screen.getByRole('button', { name: /^load$/i })).toBeDisabled()

    // Fix the target → Load becomes available and starts with the target
    const input = screen.getByRole('textbox', { name: /osc target/i })
    await user.clear(input)
    await user.type(input, '127.0.0.1:57120')
    expect(screen.getByRole('button', { name: /^load$/i })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /^load$/i }))
    await waitFor(() => {
      expect(commands.startProject).toHaveBeenCalledWith(
        PROJECT_PATH,
        'external',
        '192.168.1.10',
        '127.0.0.1:57120'
      )
    })
  })

  it('persists a valid external OSC target per project (§6.6)', async () => {
    const user = userEvent.setup()
    seedLoadedProject()
    useSessionStore.setState({
      audioMode: 'external',
      oscTargetInput: '127.0.0.1:57120',
    })

    render(<Sidebar variant="static" />)
    await user.click(screen.getByRole('textbox', { name: /osc target/i }))
    await user.tab() // blur commits

    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          oscTargets: { 'inarticulate-iii': '127.0.0.1:57120' },
        })
      )
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
})
