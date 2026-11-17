import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { useSettingsStore } from '@/store/settings-store'
import { render, screen, fireEvent, waitFor } from '@/test/test-utils'
import { act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { requestPerformanceClose } from '@/lib/performance-selection'
import { AppShell } from './AppShell'
import type { Manifest } from '@/lib/tauri-bindings'

beforeEach(() => {
  usePerformanceRoleStore.getState().selectRole('host')
  useSettingsStore.setState({ nodeNameSetting: 'Test Host' })
})

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
    recentProjectPaths: [FIRST_PATH, SECOND_PATH, THIRD_PATH],
    currentProject: { path: currentPath, manifest },
    // v1.2.0 (issue #16): preflight-learned names must not leak between
    // tests — the card names would follow the stale entries.
    manifestProjectNames: {},
    preflightStatus: 'ready',
  })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: currentPath,
    projectName: 'Inarticulate III',
    lanIp: '192.168.1.10',
    audioMode: 'internal',
    oscTargetInput: '127.0.0.1:3333',
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
      hostAddress: '192.168.1.10',
      oscTarget: null,
      health: readyHealth,
      error: null,
      outputTail: [],
      volume: 80,
      startupStage: 0,
      channelPlan: null,
      outputDevice: null,
      projectionStarted: false,
      httpsEntry: { status: 'off', url: null, error: null },
      dnsMapping: { status: 'off', domain: null, ip: null, error: null },
    },
  })
}

function pressSidebarArrow(key: 'ArrowDown' | 'ArrowUp') {
  const sidebar = screen.getByTestId('sidebar')
  fireEvent.mouseEnter(sidebar)
  fireEvent.keyDown(sidebar, { key })
}

function pressEscape() {
  fireEvent.keyDown(window, { key: 'Escape' })
}

/**
 * v1.1.2 T7 (spec issue #4/#11): ↓/↑ move the selection along the
 * visible order — clamped, folder-aware, click-equal semantics. The
 * listeners are registered by AppShell and SessionActionButton, so every
 * test mounts the shell.
 */
describe('Sidebar ↑/↓ project navigation and Escape ownership (v1.1.2 T7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [FIRST_PATH, SECOND_PATH, THIRD_PATH],
      projectFolders: [],
      pendingPreflightPath: null,
      activeFolderId: null,
      renameTarget: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  describe('↓/↑ along the visible order', () => {
    it('↓ selects the first project when nothing is selected', () => {
      render(<AppShell />)

      pressSidebarArrow('ArrowDown')

      expect(commands.preflightProject).toHaveBeenCalledWith(FIRST_PATH)
    })

    it('walks down with ↓ and back up with ↑', () => {
      useProjectStore.setState({
        currentProject: { path: FIRST_PATH, manifest },
        preflightStatus: 'ready',
      })
      render(<AppShell />)

      pressSidebarArrow('ArrowDown')
      expect(commands.preflightProject).toHaveBeenCalledWith(SECOND_PATH)

      useProjectStore.setState({
        currentProject: { path: SECOND_PATH, manifest },
      })
      pressSidebarArrow('ArrowUp')
      expect(commands.preflightProject).toHaveBeenCalledWith(FIRST_PATH)
    })

    it('clamps at both ends — repeated ↓ never wraps to the first', () => {
      useProjectStore.setState({
        currentProject: { path: FIRST_PATH, manifest },
        preflightStatus: 'ready',
      })
      render(<AppShell />)

      pressSidebarArrow('ArrowUp')
      expect(commands.preflightProject).not.toHaveBeenCalled()

      useProjectStore.setState({
        currentProject: { path: THIRD_PATH, manifest },
      })
      pressSidebarArrow('ArrowDown')
      pressSidebarArrow('ArrowDown')
      expect(commands.preflightProject).not.toHaveBeenCalled()
      expect(useProjectStore.getState().currentProject?.path).toBe(THIRD_PATH)
    })

    it('leaves plain and Command arrows in the focused sidebar rename field', () => {
      useProjectStore.setState({
        currentProject: { path: FIRST_PATH, manifest },
        preflightStatus: 'ready',
      })
      render(<AppShell />)

      fireEvent.keyDown(window, { key: 'r', code: 'KeyR', metaKey: true })
      const input = screen.getByTestId('project-name-input')
      expect(input).toHaveFocus()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      for (const metaKey of [false, true]) {
        for (const key of ['ArrowDown', 'ArrowUp']) {
          const event = new KeyboardEvent('keydown', {
            key,
            metaKey,
            bubbles: true,
            cancelable: true,
          })
          fireEvent(input, event)
          expect(event.defaultPrevented).toBe(false)
        }
      }
      expect(commands.preflightProject).not.toHaveBeenCalled()
      expect(useProjectStore.getState().currentProject?.path).toBe(FIRST_PATH)
      expect(commands.startProject).not.toHaveBeenCalled()
    })

    it('is inert while a dialog is open', () => {
      seedRunningSession(FIRST_PATH)
      render(
        <>
          <AppShell />
          <div role="dialog" aria-label="Open dialog" />
        </>
      )
      const entry = screen.getAllByTestId('project-entry')[0]
      if (!entry) throw new Error('Expected a visible project entry')
      fireEvent.keyDown(entry, {
        key: 'ArrowDown',
      })
      expect(commands.preflightProject).not.toHaveBeenCalled()
      expect(useProjectStore.getState().currentProject?.path).toBe(FIRST_PATH)
    })
  })

  describe('folder-aware movement', () => {
    it("stays in the current view — no auto-drill into the selection's folder (#39 feedback)", () => {
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

      pressSidebarArrow('ArrowDown')

      // The view stays at the top level — the move lands on the view's
      // own next member, never bounces into the selection's folder.
      expect(useProjectStore.getState().activeFolderId).toBeNull()
      expect(commands.preflightProject).toHaveBeenCalledWith(FIRST_PATH)
      expect(commands.preflightProject).not.toHaveBeenCalledWith(THIRD_PATH)
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

      pressSidebarArrow('ArrowUp')

      expect(commands.preflightProject).toHaveBeenCalledWith(SECOND_PATH)
      expect(commands.preflightProject).not.toHaveBeenCalledWith(FIRST_PATH)
    })

    it('moves the selection freely while a session is live (#39)', async () => {
      seedRunningSession(FIRST_PATH)
      render(<AppShell />)

      // Sidebar owns the keys while the session keeps running — and
      // v1.2.3 (#39) freely selects under the session, no confirmation.
      pressSidebarArrow('ArrowDown')

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      await waitFor(() => {
        expect(commands.preflightProject).toHaveBeenCalledWith(SECOND_PATH)
      })
      expect(commands.stopProject).not.toHaveBeenCalled()
    })

    it('a live session keeps the view — the move selects a top-level member, not the session folder (#39)', async () => {
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

      pressSidebarArrow('ArrowDown')

      expect(useProjectStore.getState().activeFolderId).toBeNull()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      await waitFor(() => {
        expect(commands.preflightProject).toHaveBeenCalledWith(FIRST_PATH)
      })
      expect(commands.stopProject).not.toHaveBeenCalled()
    })
  })

  describe('performance close and Escape', () => {
    it('a plain Esc keeps the running project open', () => {
      seedRunningSession(FIRST_PATH)
      render(<AppShell />)

      pressEscape()

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(useProjectStore.getState().currentProject?.path).toBe(FIRST_PATH)
    })

    it('stops the running project on confirmation while keeping another selected card', async () => {
      seedRunningSession(FIRST_PATH)
      render(<AppShell />)
      pressSidebarArrow('ArrowDown')
      await waitFor(() => {
        expect(useProjectStore.getState().currentProject?.path).toBe(
          SECOND_PATH
        )
        expect(useProjectStore.getState().pendingPreflightPath).toBeNull()
      })

      act(requestPerformanceClose)
      expect(
        screen.getByRole('button', { name: /press again to close/i })
      ).toBeInTheDocument()
      expect(commands.stopProject).not.toHaveBeenCalled()
      act(requestPerformanceClose)

      await waitFor(() => {
        expect(commands.stopProject).toHaveBeenCalledTimes(1)
        expect(useSessionStore.getState().sessionStatus).toBe('idle')
        expect(useProjectStore.getState().currentProject?.path).toBe(
          SECOND_PATH
        )
      })
    })

    it('Esc is not Load — nothing happens while idle', () => {
      useProjectStore.setState({
        currentProject: { path: FIRST_PATH, manifest },
        preflightStatus: 'ready',
      })
      render(<AppShell />)

      pressEscape()

      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.startProject).not.toHaveBeenCalled()
      expect(useProjectStore.getState().currentProject).not.toBeNull()
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

      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.startProject).not.toHaveBeenCalled()
    })
  })
})
