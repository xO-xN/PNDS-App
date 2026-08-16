import { render, screen, fireEvent, waitFor, within } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { AppShell } from './AppShell'
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
const THIRD_PATH = '/Users/test/PNDS Score 2'

const readyHealth = {
  status: 'ready' as const,
  projectId: 'inarticulate-iii',
  audioMode: 'internal' as const,
  audio: { status: 'running' as const, target: null, error: null },
  scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
}

/** Seeds a stable running session (stores + the shell's initial restore). */
function seedRunningSession(currentPath: string) {
  useProjectStore.setState({
    trustedPaths: [FIRST_PATH, SECOND_PATH, THIRD_PATH],
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

function pressCmdArrow(key: 'ArrowDown' | 'ArrowUp') {
  fireEvent.keyDown(window, { key, metaKey: true })
}

function pressEscape() {
  fireEvent.keyDown(window, { key: 'Escape' })
}

/**
 * v1.1.2 T7 (spec issue #4/#11): ⌘↓/⌘↑ move the selection along the
 * visible order — clamped, folder-aware, click-equal semantics — and Esc
 * closes the open project like the sidebar's Close button. The listeners
 * are registered by AppShell / SessionActionButton, so every test mounts
 * the shell.
 */
describe('Cmd+↑/↓ project navigation and Esc close (v1.1.2 T7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })
    useProjectStore.setState({
      currentProject: null,
      trustedPaths: [FIRST_PATH, SECOND_PATH, THIRD_PATH],
      projectFolders: [],
      pendingTrustPath: null,
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      confirmCloseProjectOpen: false,
      activeFolderId: null,
      renameTarget: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  describe('⌘↓/⌘↑ along the visible order', () => {
    it('⌘↓ selects the first project when nothing is selected', () => {
      render(<AppShell />)

      pressCmdArrow('ArrowDown')

      expect(commands.preflightProject).toHaveBeenCalledWith(FIRST_PATH)
    })

    it('walks down with ⌘↓ and back up with ⌘↑', () => {
      useProjectStore.setState({
        currentProject: { path: FIRST_PATH, manifest },
        preflightStatus: 'ready',
      })
      render(<AppShell />)

      pressCmdArrow('ArrowDown')
      expect(commands.preflightProject).toHaveBeenCalledWith(SECOND_PATH)

      useProjectStore.setState({
        currentProject: { path: SECOND_PATH, manifest },
      })
      pressCmdArrow('ArrowUp')
      expect(commands.preflightProject).toHaveBeenCalledWith(FIRST_PATH)
    })

    it('clamps at both ends — repeated ⌘↓ never wraps to the first', () => {
      useProjectStore.setState({
        currentProject: { path: FIRST_PATH, manifest },
        preflightStatus: 'ready',
      })
      render(<AppShell />)

      pressCmdArrow('ArrowUp')
      expect(commands.preflightProject).not.toHaveBeenCalled()

      useProjectStore.setState({
        currentProject: { path: THIRD_PATH, manifest },
      })
      pressCmdArrow('ArrowDown')
      pressCmdArrow('ArrowDown')
      expect(commands.preflightProject).not.toHaveBeenCalled()
      expect(useProjectStore.getState().currentProject?.path).toBe(THIRD_PATH)
    })

    it('is inert while a dialog is open or a text field is focused', () => {
      useProjectStore.setState({
        currentProject: { path: FIRST_PATH, manifest },
        preflightStatus: 'ready',
      })
      useSessionStore.setState({
        sessionStatus: 'idle',
        audioMode: 'external',
        lanIp: '192.168.1.10',
        oscTargetInput: '127.0.0.1:3333',
        deviceError: null,
      })
      render(<AppShell />)

      // Text input (the OSC target field) swallows the shortcut.
      const oscInput = screen.getByRole('textbox', { name: /osc target/i })
      fireEvent.keyDown(oscInput, { key: 'ArrowDown', metaKey: true })
      expect(commands.preflightProject).not.toHaveBeenCalledWith(FIRST_PATH)

      // The switch-confirm dialog owns the keyboard while open.
      seedRunningSession(FIRST_PATH)
      useProjectStore.getState().requestSwitch(SECOND_PATH)
      const entry = screen.getAllByTestId('project-entry')[0]
      if (!entry) throw new Error('Expected a visible project entry')
      fireEvent.keyDown(entry, {
        key: 'ArrowDown',
        metaKey: true,
      })
      expect(commands.preflightProject).not.toHaveBeenCalledWith(THIRD_PATH)
    })
  })

  describe('folder-aware movement', () => {
    it("auto-drills into the current project's folder, then moves inside it", () => {
      useProjectStore.setState({
        projectFolders: [
          {
            id: 'f1',
            name: 'Set list',
            projectPaths: [SECOND_PATH, THIRD_PATH],
          },
        ],
        currentProject: { path: SECOND_PATH, manifest },
        preflightStatus: 'ready',
      })
      render(<AppShell />)

      pressCmdArrow('ArrowDown')

      // The view followed the current project into its folder…
      expect(screen.getByTestId('breadcrumb-bar')).toBeInTheDocument()
      expect(useProjectStore.getState().activeFolderId).toBe('f1')
      // …and the move landed on the folder's next member.
      expect(commands.preflightProject).toHaveBeenCalledWith(THIRD_PATH)
      expect(commands.preflightProject).not.toHaveBeenCalledWith(FIRST_PATH)
    })

    it('moves within the folder order while drilled in', () => {
      useProjectStore.setState({
        projectFolders: [
          {
            id: 'f1',
            name: 'Set list',
            projectPaths: [SECOND_PATH, THIRD_PATH],
          },
        ],
        currentProject: { path: THIRD_PATH, manifest },
        activeFolderId: 'f1',
        preflightStatus: 'ready',
      })
      render(<AppShell />)

      pressCmdArrow('ArrowUp')

      expect(commands.preflightProject).toHaveBeenCalledWith(SECOND_PATH)
      expect(commands.preflightProject).not.toHaveBeenCalledWith(FIRST_PATH)
    })

    it('runs the §8.3 switch confirmation when a session is live', async () => {
      const user = userEvent.setup()
      seedRunningSession(FIRST_PATH)
      render(<AppShell />)

      // Sidebar hidden, session running: the shortcut still fires.
      pressCmdArrow('ArrowDown')

      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent(/PNDS Score 1/)
      await user.click(within(dialog).getByRole('button', { name: /^load$/i }))

      await waitFor(() => {
        expect(commands.stopProject).toHaveBeenCalled()
        expect(commands.preflightProject).toHaveBeenCalledWith(SECOND_PATH)
      })
    })

    it('drills a live session into its folder and confirms the in-folder next', async () => {
      const user = userEvent.setup()
      seedRunningSession(SECOND_PATH)
      useProjectStore.setState({
        projectFolders: [
          {
            id: 'f1',
            name: 'Set list',
            projectPaths: [SECOND_PATH, THIRD_PATH],
          },
        ],
      })
      render(<AppShell />)

      pressCmdArrow('ArrowDown')

      expect(useProjectStore.getState().activeFolderId).toBe('f1')
      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent(/PNDS Score 2/)
      // Cancel keeps the running project untouched.
      await user.click(within(dialog).getByRole('button', { name: /^back$/i }))
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(useProjectStore.getState().currentProject?.path).toBe(SECOND_PATH)
    })
  })

  describe('Esc / ⌘Esc close the open project', () => {
    it('a lone Esc opens the close-project confirmation, not a direct stop', async () => {
      seedRunningSession(FIRST_PATH)
      render(<AppShell />)

      pressEscape()

      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent('Close the Project?')
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(useProjectStore.getState().currentProject?.path).toBe(FIRST_PATH)
    })

    it('confirming the dialog stops the session like the Close button', async () => {
      const user = userEvent.setup()
      seedRunningSession(FIRST_PATH)
      render(<AppShell />)

      pressEscape()
      const dialog = await screen.findByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: /^close$/i }))

      await waitFor(() => {
        expect(commands.stopProject).toHaveBeenCalledTimes(1)
        expect(useProjectStore.getState().currentProject).toBeNull()
        expect(useSessionStore.getState().sessionStatus).toBe('idle')
      })
      expect(useProjectStore.getState().confirmCloseProjectOpen).toBe(false)
    })

    it('canceling the dialog leaves the session running', async () => {
      const user = userEvent.setup()
      seedRunningSession(FIRST_PATH)
      render(<AppShell />)

      pressEscape()
      const dialog = await screen.findByRole('alertdialog')
      await user.click(
        within(dialog).getByRole('button', { name: /^cancel$/i })
      )

      await waitFor(() => {
        expect(useProjectStore.getState().confirmCloseProjectOpen).toBe(false)
      })
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(useProjectStore.getState().currentProject?.path).toBe(FIRST_PATH)
    })

    it('⌘Esc stops a running session directly, exactly like the Close button', async () => {
      seedRunningSession(FIRST_PATH)
      render(<AppShell />)

      fireEvent.keyDown(window, { key: 'Escape', metaKey: true })

      await waitFor(() => {
        expect(commands.stopProject).toHaveBeenCalledTimes(1)
      })
      expect(useProjectStore.getState().confirmCloseProjectOpen).toBe(false)
      await waitFor(() => {
        expect(useProjectStore.getState().currentProject).toBeNull()
        expect(useSessionStore.getState().sessionStatus).toBe('idle')
      })
    })

    it('does nothing while idle — Esc is not Load (with or without ⌘)', () => {
      useProjectStore.setState({
        currentProject: { path: FIRST_PATH, manifest },
        preflightStatus: 'ready',
      })
      render(<AppShell />)

      pressEscape()
      fireEvent.keyDown(window, { key: 'Escape', metaKey: true })

      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.startProject).not.toHaveBeenCalled()
      expect(useProjectStore.getState().currentProject).not.toBeNull()
      expect(useProjectStore.getState().confirmCloseProjectOpen).toBe(false)
    })

    it('cancels the switch dialog instead of stopping the session', async () => {
      seedRunningSession(FIRST_PATH)
      render(<AppShell />)

      pressCmdArrow('ArrowDown')
      const dialog = await screen.findByRole('alertdialog')

      // Esc is delivered on the dialog — Radix owns it there; the global
      // Close alias must not stop the show underneath the open dialog.
      fireEvent.keyDown(dialog, { key: 'Escape' })

      await waitFor(() => {
        expect(useProjectStore.getState().pendingSwitchPath).toBeNull()
      })
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(useProjectStore.getState().currentProject?.path).toBe(FIRST_PATH)
    })

    it('cancels an inline rename without stopping anything', () => {
      useProjectStore.setState({
        currentProject: { path: FIRST_PATH, manifest },
        preflightStatus: 'ready',
      })
      render(<AppShell />)

      fireEvent.keyDown(window, { key: 'r', code: 'KeyR', metaKey: true })
      const input = screen.getByTestId('project-name-input')

      fireEvent.keyDown(input, { key: 'Escape' })

      expect(useProjectStore.getState().renameTarget).toBeNull()
      expect(commands.stopProject).not.toHaveBeenCalled()
    })

    it('does not restart a pending config change (Change stays its own action)', () => {
      seedRunningSession(FIRST_PATH)
      useSessionStore.setState({ pendingChanges: true })
      render(<AppShell />)

      pressEscape()
      fireEvent.keyDown(window, { key: 'Escape', metaKey: true })

      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.startProject).not.toHaveBeenCalled()
      expect(useProjectStore.getState().confirmCloseProjectOpen).toBe(false)
    })
  })
})
