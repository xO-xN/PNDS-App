import { render, screen, fireEvent, waitFor, within } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { AppShell } from './AppShell'
import { MonitorView } from './MonitorView'
import type { Manifest } from '@/lib/tauri-bindings'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn() },
  Toaster: () => null,
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

const FIRST_PATH = '/Users/test/Inarticulate III'
const SECOND_PATH = '/Users/test/PNDS Score 1'

/** Same schema as `manifest` but named after its own path segment, so the
 * empty-commit fallback (basename) is observable on the current card. */
const secondManifest: Manifest = {
  ...manifest,
  id: 'pnds-score-1',
  name: 'PNDS Score 1',
}

const readyHealth = {
  status: 'ready' as const,
  projectId: 'inarticulate-iii',
  audioMode: 'internal' as const,
  audio: { status: 'running' as const, target: null, error: null },
  scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
}

/** Seeds a running session the shell's restore agrees with (see T2 tests). */
function seedRunningSession(currentPath: string) {
  useProjectStore.setState({
    recentProjectPaths: [FIRST_PATH, SECOND_PATH],
    currentProject: { path: currentPath, manifest },
    preflightStatus: 'ready',
  })
  useSessionStore.setState({
    sessionStatus: 'ready',
    projectName: 'Inarticulate III',
    lanIp: '192.168.1.10',
    audioMode: 'internal',
    oscTargetInput: '127.0.0.1:3333',
    deviceError: null,
    pendingChanges: false,
    health: readyHealth,
  })
  vi.mocked(commands.getSessionState).mockResolvedValue({
    status: 'ok',
    data: {
      status: 'ready',
      projectName: 'Inarticulate III',
      projectPath: currentPath,
      audioMode: 'internal',
      lanIp: '192.168.1.10',
      oscTarget: null,
      health: readyHealth,
      error: null,
      outputTail: [],
      volume: 80,
      startupStage: 0,
      channelPlan: null,
      outputDevice: null,
    },
  })
}

function pressCmdR() {
  fireEvent.keyDown(window, { key: 'r', code: 'KeyR', metaKey: true })
}

/**
 * v1.1.2 T6 (issue #10): ⌘R rename — target resolution (project over
 * folder, silent no-op with nothing selected, forbidden while running),
 * the inline edit contract (focus+select-all, Enter/blur commit, Esc
 * cancel, empty falls back to the path basename) and persistence.
 */
describe('⌘R project rename (v1.1.2 T6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [],
      projectFolders: [],
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      preflightStatus: 'idle',
      preflightError: null,
      projectDisplayNames: {},
      renameTarget: null,
    })
    useSessionStore.getState().resetSession()
  })

  it('enters inline edit on the selected project, focused with the name selected', () => {
    useProjectStore.setState({
      recentProjectPaths: [FIRST_PATH],
      currentProject: { path: FIRST_PATH, manifest },
      preflightStatus: 'ready',
    })
    render(<AppShell />)

    pressCmdR()

    const input = screen.getByTestId('project-name-input') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(input).toHaveValue('Inarticulate III')
    // All of the current name is selected, ready to type over.
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('Inarticulate III'.length)
  })

  it('Enter commits the typed name to the card and preferences', async () => {
    useProjectStore.setState({
      recentProjectPaths: [FIRST_PATH],
      currentProject: { path: FIRST_PATH, manifest },
      preflightStatus: 'ready',
    })
    render(<AppShell />)

    pressCmdR()
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'My Gig Name' },
    })
    fireEvent.keyDown(screen.getByTestId('project-name-input'), {
      key: 'Enter',
    })

    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          projectDisplayNames: { [FIRST_PATH]: 'My Gig Name' },
        })
      )
    })
    expect(screen.queryByTestId('project-name-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('current-project-card')).toHaveTextContent(
      'My Gig Name'
    )
    expect(useProjectStore.getState().projectDisplayNames[FIRST_PATH]).toBe(
      'My Gig Name'
    )
  })

  it('blur commits just like Enter', async () => {
    useProjectStore.setState({
      recentProjectPaths: [FIRST_PATH],
      currentProject: { path: FIRST_PATH, manifest },
      preflightStatus: 'ready',
    })
    render(<AppShell />)

    pressCmdR()
    const input = screen.getByTestId('project-name-input')
    fireEvent.change(input, { target: { value: 'Blurred Name' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          projectDisplayNames: { [FIRST_PATH]: 'Blurred Name' },
        })
      )
    })
  })

  it('Esc cancels: nothing saves and the name is untouched', async () => {
    useProjectStore.setState({
      recentProjectPaths: [FIRST_PATH],
      currentProject: { path: FIRST_PATH, manifest },
      preflightStatus: 'ready',
    })
    render(<AppShell />)

    pressCmdR()
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Discarded' },
    })
    fireEvent.keyDown(screen.getByTestId('project-name-input'), {
      key: 'Escape',
    })

    expect(commands.savePreferences).not.toHaveBeenCalled()
    expect(screen.queryByTestId('project-name-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('current-project-card')).toHaveTextContent(
      'Inarticulate III'
    )
  })

  it('an empty commit removes the override and falls back to the path basename', async () => {
    useProjectStore.setState({
      recentProjectPaths: [SECOND_PATH],
      currentProject: { path: SECOND_PATH, manifest: secondManifest },
      preflightStatus: 'ready',
      projectDisplayNames: { [SECOND_PATH]: 'Old Custom Name' },
    })
    render(<AppShell />)
    expect(screen.getByTestId('current-project-card')).toHaveTextContent(
      'Old Custom Name'
    )

    pressCmdR()
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: '' },
    })
    fireEvent.keyDown(screen.getByTestId('project-name-input'), {
      key: 'Enter',
    })

    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ projectDisplayNames: {} })
      )
    })
    expect(screen.getByTestId('current-project-card')).toHaveTextContent(
      'PNDS Score 1'
    )
  })

  it('is a silent no-op with no selected project at the top level', () => {
    useProjectStore.setState({ recentProjectPaths: [FIRST_PATH] })
    render(<AppShell />)

    pressCmdR()

    expect(screen.queryByTestId('project-name-input')).not.toBeInTheDocument()
    expect(commands.savePreferences).not.toHaveBeenCalled()
    expect(useProjectStore.getState().renameTarget).toBeNull()
  })

  it('is forbidden while a session runs', () => {
    seedRunningSession(FIRST_PATH)
    render(<AppShell />)

    pressCmdR()

    expect(screen.queryByTestId('project-name-input')).not.toBeInTheDocument()
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('renames the drilled-in folder when nothing is selected inside it', async () => {
    useProjectStore.setState({ recentProjectPaths: [SECOND_PATH] })
    const store = useProjectStore.getState()
    const id = store.createFolder('Gig')
    store.moveProjectToFolder(id, SECOND_PATH)
    useProjectStore.setState({ activeFolderId: id })
    render(<AppShell />)

    pressCmdR()

    const input = screen.getByTestId('folder-name-input')
    expect(document.activeElement).toBe(input)
    expect(input).toHaveValue('Gig')
    fireEvent.change(input, { target: { value: 'Tour 2026' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          projectFolders: [expect.objectContaining({ id, name: 'Tour 2026' })],
        })
      )
    })
    expect(screen.getByTestId('breadcrumb-folder-name')).toHaveTextContent(
      'Tour 2026'
    )
  })

  it('a selected project wins over the folder while drilled in', () => {
    useProjectStore.setState({
      recentProjectPaths: [FIRST_PATH, SECOND_PATH],
      currentProject: { path: SECOND_PATH, manifest: secondManifest },
      preflightStatus: 'ready',
    })
    const store = useProjectStore.getState()
    const id = store.createFolder('Gig')
    store.moveProjectToFolder(id, SECOND_PATH)
    useProjectStore.setState({ activeFolderId: id })
    render(<AppShell />)

    pressCmdR()

    expect(screen.getByTestId('project-name-input')).toBeInTheDocument()
    expect(screen.queryByTestId('folder-name-input')).not.toBeInTheDocument()
  })

  it('entering or leaving a folder view resets the selection', () => {
    // Folder views are exclusive (the collapsed sidebar shows only one
    // side), so navigation must not leave an invisible card as the ⌘R
    // target. Covers the reported bug: an ungrouped project staying
    // selected inside a folder view.
    useProjectStore.setState({
      recentProjectPaths: [FIRST_PATH, SECOND_PATH],
      currentProject: { path: FIRST_PATH, manifest },
      preflightStatus: 'ready',
    })
    const store = useProjectStore.getState()
    const id = store.createFolder('Gig')
    store.moveProjectToFolder(id, SECOND_PATH)
    render(<AppShell />)

    // Enter: selection resets, ⌘R falls through to the folder name.
    fireEvent.click(screen.getByTestId('folder-card'))
    expect(screen.getByTestId('breadcrumb-bar')).toBeInTheDocument()
    expect(useProjectStore.getState().currentProject).toBeNull()

    pressCmdR()
    expect(screen.getByTestId('folder-name-input')).toBeInTheDocument()
    expect(screen.queryByTestId('project-name-input')).not.toBeInTheDocument()

    // Leave: a selection made inside the folder resets at the top too.
    useProjectStore.setState({
      currentProject: { path: SECOND_PATH, manifest: secondManifest },
      preflightStatus: 'ready',
    })
    fireEvent.click(screen.getByTestId('breadcrumb-back'))
    expect(useProjectStore.getState().currentProject).toBeNull()
  })

  it('a running session keeps its project through folder navigation', () => {
    // During a live session currentProject is not a selection — the
    // in-use dot and the top-level current marker read it — so folder
    // navigation must not clear it (rename is blocked while running).
    seedRunningSession(FIRST_PATH)
    const store = useProjectStore.getState()
    store.createFolder('Gig')
    render(<AppShell />)

    fireEvent.click(screen.getByTestId('folder-card'))
    expect(useProjectStore.getState().currentProject?.path).toBe(FIRST_PATH)

    fireEvent.click(screen.getByTestId('breadcrumb-back'))
    expect(useProjectStore.getState().currentProject?.path).toBe(FIRST_PATH)
  })

  it('the switch confirmation follows the display-name override', async () => {
    seedRunningSession(FIRST_PATH)
    useProjectStore.setState({
      projectDisplayNames: { [SECOND_PATH]: 'Encore Set' },
    })
    render(<AppShell />)

    fireEvent.keyDown(window, { key: '2', metaKey: true })
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getAllByText(/Encore Set/).length).toBeGreaterThan(0)
    expect(within(dialog).queryByText(/PNDS Score 1/)).not.toBeInTheDocument()
  })

  it('the monitor title strip follows the display-name override', () => {
    useProjectStore.setState({
      currentProject: { path: FIRST_PATH, manifest },
      projectDisplayNames: { [FIRST_PATH]: 'Encore Set' },
    })
    useSessionStore.setState({
      sessionStatus: 'ready',
      lanIp: '192.168.1.10',
      health: readyHealth,
    })
    render(<MonitorView />)

    expect(screen.getByText(/PNDS - Encore Set/)).toBeInTheDocument()
    expect(
      screen.queryByText(/PNDS - Inarticulate III/)
    ).not.toBeInTheDocument()
  })

  it('reveals a hidden hover sidebar into the edit, and the edit outlives Cmd', async () => {
    // Loading screen: sidebar retracted, rename still allowed (the
    // session is not running yet — only ready blocks it).
    useProjectStore.setState({
      recentProjectPaths: [FIRST_PATH],
      currentProject: { path: FIRST_PATH, manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({ sessionStatus: 'starting' })
    render(<AppShell />)

    const popover = screen.getByTestId('sidebar-popover')
    expect(popover.className).toContain('opacity-0')

    fireEvent.keyDown(window, { key: 'Meta' })
    pressCmdR()
    fireEvent.keyUp(window, { key: 'Meta' })

    expect(screen.getByTestId('project-name-input')).toBeInTheDocument()
    expect(popover.className).toContain('opacity-100')
  })
})
