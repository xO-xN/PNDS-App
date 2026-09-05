import {
  render,
  screen,
  fireEvent,
  waitFor,
  createFolderOrFail,
} from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useKeyboardStore } from '@/store/keyboard-store'
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

/** The health block MonitorView needs to render a ready session. */
const readyHealth = {
  status: 'ready' as const,
  projectId: 'inarticulate-iii',
  audioMode: 'internal' as const,
  audio: { status: 'running' as const, target: null, error: null },
  scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
}

const TEN_PATHS = Array.from(
  { length: 10 },
  (_, i) => `/Users/test/Score ${i + 1}`
)

/**
 * Seeds a stable running session: stores say "ready" AND the shell's
 * initial `getSessionState` restore agrees (the global mock returns idle,
 * which would otherwise clobber the seeded state right after mount).
 */
function seedRunningSession(currentPath: string) {
  useProjectStore.setState({
    recentProjectPaths: [FIRST_PATH, SECOND_PATH],
    currentProject: { path: currentPath, manifest },
    preflightStatus: 'ready',
  })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: currentPath,
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

function pressCmd() {
  fireEvent.keyDown(window, { key: 'Meta' })
}

function releaseCmd() {
  fireEvent.keyUp(window, { key: 'Meta' })
}

function pressCmdDigit(digit: string) {
  fireEvent.keyDown(window, { key: digit, metaKey: true })
}

/**
 * v1.1.2 T2 (issue #6): the Cmd keyboard layer — number badges, Cmd+1..9
 * selection through the unified entry, and the running-state sidebar peek.
 * The listener is registered by AppShell, so every test mounts the shell.
 */
describe('Cmd keyboard layer (v1.1.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useKeyboardStore.getState().setCommandKeyPressed(false)
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

  describe('number badges', () => {
    it('badges the first nine visible projects while Cmd is held', () => {
      useProjectStore.setState({ recentProjectPaths: TEN_PATHS })
      render(<AppShell />)

      pressCmd()
      const badges = screen.getAllByTestId('project-number-badge')
      expect(badges).toHaveLength(9)
      expect(badges.map(b => b.textContent)).toEqual([
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
      ])

      releaseCmd()
      expect(
        screen.queryByTestId('project-number-badge')
      ).not.toBeInTheDocument()
    })

    it('never badges a project that sits inside a folder (flat list)', () => {
      useProjectStore.setState({ recentProjectPaths: TEN_PATHS })
      const store = useProjectStore.getState()
      const id = createFolderOrFail('Set list')
      const groupedPath = TEN_PATHS[9]
      if (!groupedPath) throw new Error('Expected a grouped path')
      store.moveProjectToFolder(id, groupedPath)

      render(<AppShell />)
      pressCmd()

      // Ten trusted projects, one grouped: nine ungrouped cards, all badged.
      expect(screen.getAllByTestId('project-number-badge')).toHaveLength(9)
    })
  })

  describe('Cmd+digit selection', () => {
    it('Cmd+1 selects and preflights the first visible project (idle)', () => {
      vi.mocked(commands.preflightProject).mockResolvedValue({
        status: 'ok',
        data: manifest,
      })
      useProjectStore.setState({
        recentProjectPaths: [FIRST_PATH, SECOND_PATH],
      })
      render(<AppShell />)

      pressCmdDigit('1')

      expect(commands.preflightProject).toHaveBeenCalledWith(FIRST_PATH)
      expect(commands.startProject).not.toHaveBeenCalled()
    })

    it('Cmd+0 selects nothing — it stays the zoom accelerator', () => {
      useProjectStore.setState({ recentProjectPaths: [FIRST_PATH] })
      render(<AppShell />)

      pressCmdDigit('0')

      expect(commands.preflightProject).not.toHaveBeenCalled()
    })

    it('a digit on the current project deselects it (v1.2.0)', () => {
      useProjectStore.setState({
        recentProjectPaths: [FIRST_PATH, SECOND_PATH],
        currentProject: { path: FIRST_PATH, manifest },
        preflightStatus: 'ready',
      })
      render(<AppShell />)

      pressCmdDigit('1')

      expect(useProjectStore.getState().currentProject).toBeNull()
      expect(useProjectStore.getState().preflightStatus).toBe('idle')
      expect(commands.preflightProject).not.toHaveBeenCalled()
    })

    it('freely selects and preflights while a session runs — no stop (#39)', async () => {
      vi.mocked(commands.preflightProject).mockResolvedValue({
        status: 'ok',
        data: manifest,
      })
      seedRunningSession(FIRST_PATH)
      render(<AppShell />)

      // Sidebar hidden, session running: the shortcut still fires.
      pressCmdDigit('2')

      // v1.2.3 (#39): ⌘2 selects + preflights the target under the running
      // session — no confirmation dialog, nothing stopped.
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      await waitFor(() => {
        expect(commands.preflightProject).toHaveBeenCalledWith(SECOND_PATH)
      })
      expect(commands.stopProject).not.toHaveBeenCalled()
    })
  })

  describe('Cmd peek at the hover sidebar', () => {
    it('holding Cmd reveals the sidebar while running; releasing retracts it', () => {
      seedRunningSession(FIRST_PATH)
      render(<AppShell />)
      const popover = screen.getByTestId('sidebar-popover')
      expect(popover.className).toContain('opacity-0')

      pressCmd()
      expect(popover.className).toContain('opacity-100')

      releaseCmd()
      expect(popover.className).toContain('opacity-0')
    })

    it('a hover-revealed sidebar ignores Cmd press and release', () => {
      seedRunningSession(FIRST_PATH)
      render(<AppShell />)
      const popover = screen.getByTestId('sidebar-popover')

      fireEvent.mouseEnter(screen.getByTestId('sidebar-hover-zone'))
      expect(popover.className).toContain('opacity-100')

      pressCmd()
      releaseCmd()
      expect(popover.className).toContain('opacity-100')

      fireEvent.mouseLeave(popover)
      expect(popover.className).toContain('opacity-0')
    })
  })

  describe('Cmd stuck-state self-heal (v1.3.5 #106)', () => {
    it('a pointer move reporting Meta up heals the stuck hold — badges clear', () => {
      useProjectStore.setState({ recentProjectPaths: TEN_PATHS })
      render(<AppShell />)

      // The leak: the Meta keyup is swallowed while focus sits inside
      // the out-of-process monitor iframe — no keyUp ever reaches the
      // window, and no blur fires either.
      pressCmd()
      expect(useKeyboardStore.getState().commandKeyPressed).toBe(true)

      fireEvent.mouseMove(window, { metaKey: false })

      expect(useKeyboardStore.getState().commandKeyPressed).toBe(false)
      expect(
        screen.queryByTestId('project-number-badge')
      ).not.toBeInTheDocument()
    })

    it('a pointer press reporting Meta up heals the stuck hold', () => {
      render(<AppShell />)
      pressCmd()

      fireEvent.pointerDown(window, { metaKey: false })

      expect(useKeyboardStore.getState().commandKeyPressed).toBe(false)
    })

    it('a real hold — pointer events reporting Meta down — is never healed away', () => {
      render(<AppShell />)
      pressCmd()

      fireEvent.mouseMove(window, { metaKey: true })
      fireEvent.pointerDown(window, { metaKey: true })

      expect(useKeyboardStore.getState().commandKeyPressed).toBe(true)
    })

    it('a non-Meta keydown without the modifier heals the stuck hold (fallback)', () => {
      render(<AppShell />)
      pressCmd()

      fireEvent.keyDown(window, { key: 'x', metaKey: false })

      expect(useKeyboardStore.getState().commandKeyPressed).toBe(false)
    })

    it('a chord keydown (metaKey held) keeps the hold intact', () => {
      render(<AppShell />)
      pressCmd()

      // ⌘x — not a handled shortcut, but the modifier IS down.
      fireEvent.keyDown(window, { key: 'x', metaKey: true })

      expect(useKeyboardStore.getState().commandKeyPressed).toBe(true)
      releaseCmd()
      expect(useKeyboardStore.getState().commandKeyPressed).toBe(false)
    })
  })

  describe('Enter as the session-action shortcut', () => {
    /** Idle + selected + preflighted + LAN picked → the Load button is live. */
    function seedLoadableIdle() {
      useProjectStore.setState({
        recentProjectPaths: [FIRST_PATH, SECOND_PATH],
        currentProject: { path: FIRST_PATH, manifest },
        preflightStatus: 'ready',
      })
      useSessionStore.setState({
        sessionStatus: 'idle',
        audioMode: 'internal',
        lanIp: '192.168.1.10',
        oscTargetInput: '127.0.0.1:3333',
        deviceError: null,
      })
    }

    it('Enter loads the selected idle project', () => {
      seedLoadableIdle()
      render(<AppShell />)

      fireEvent.keyDown(window, { key: 'Enter' })

      expect(commands.startProject).toHaveBeenCalledWith(
        FIRST_PATH,
        'internal',
        '192.168.1.10',
        null
      )
    })

    it('⌘Enter runs the same submit as Enter (v1.2.0)', () => {
      seedLoadableIdle()
      render(<AppShell />)

      fireEvent.keyDown(window, { key: 'Enter', metaKey: true })

      expect(commands.startProject).toHaveBeenCalledWith(
        FIRST_PATH,
        'internal',
        '192.168.1.10',
        null
      )
    })

    it('Enter does nothing without a loadable selection', () => {
      useProjectStore.setState({ recentProjectPaths: [FIRST_PATH] })
      render(<AppShell />)

      fireEvent.keyDown(window, { key: 'Enter' })

      expect(commands.startProject).not.toHaveBeenCalled()
    })

    it('Enter never stops a running session — Close stays mouse-only', () => {
      seedRunningSession(FIRST_PATH)
      render(<AppShell />)

      fireEvent.keyDown(window, { key: 'Enter' })

      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.startProject).not.toHaveBeenCalled()
    })

    it('Enter applies a pending config change (restart flow)', async () => {
      seedRunningSession(FIRST_PATH)
      useSessionStore.setState({ pendingChanges: true })
      render(<AppShell />)

      fireEvent.keyDown(window, { key: 'Enter' })

      await waitFor(() => {
        expect(commands.stopProject).toHaveBeenCalled()
        expect(commands.startProject).toHaveBeenCalledWith(
          FIRST_PATH,
          'internal',
          '192.168.1.10',
          null
        )
      })
      expect(useSessionStore.getState().pendingChanges).toBe(false)
    })

    it('Enter fires Change even while the device select holds focus (#29 feedback)', async () => {
      seedRunningSession(FIRST_PATH)
      useSessionStore.setState({ pendingChanges: true })
      render(<AppShell />)

      // The settings rows render synth / device / LAN selects in order;
      // focus sits on the device one, exactly as after a mouse change.
      const deviceSelect = screen.getAllByRole('combobox')[1]
      if (!deviceSelect) throw new Error('Expected the device select')
      fireEvent.keyDown(deviceSelect, { key: 'Enter' })

      // The alias runs in the capture phase: Change happens, and the
      // select's own Enter (opening its popup) never fires.
      await waitFor(() => {
        expect(commands.stopProject).toHaveBeenCalled()
      })
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(useSessionStore.getState().pendingChanges).toBe(false)
    })

    it('Enter is inert while typing in the OSC target input', () => {
      seedLoadableIdle()
      useSessionStore.setState({ audioMode: 'external' })
      render(<AppShell />)

      const oscInput = screen.getByRole('textbox', { name: /osc target/i })
      fireEvent.keyDown(oscInput, { key: 'Enter' })

      expect(commands.startProject).not.toHaveBeenCalled()
    })
  })

  describe('Cmd+Left/Right folder-view switching', () => {
    const pressCmdArrow = (key: 'ArrowLeft' | 'ArrowRight') => {
      fireEvent.keyDown(window, { key, metaKey: true })
    }

    /**
     * Seeds the row Home → Gig → Archives and returns the ids in that
     * display order. The view resets first (the outer beforeEach leaves
     * whatever activeFolderId the previous test ended on), and folders
     * are created back-to-front: new folders open at the top of the
     * folder area, so Archives must be created before Gig.
     */
    function seedFolderRow(): [string, string] {
      useProjectStore.setState({
        recentProjectPaths: [FIRST_PATH, SECOND_PATH],
        activeFolderId: null,
      })
      const archives = createFolderOrFail('Archives')
      const gig = createFolderOrFail('Gig')
      return [gig, archives]
    }

    it('moves through the row in display order and back', () => {
      const [gig, archives] = seedFolderRow()
      render(<AppShell />)

      pressCmdArrow('ArrowRight')
      expect(useProjectStore.getState().activeFolderId).toBe(gig)

      pressCmdArrow('ArrowRight')
      expect(useProjectStore.getState().activeFolderId).toBe(archives)

      pressCmdArrow('ArrowLeft')
      pressCmdArrow('ArrowLeft')
      expect(useProjectStore.getState().activeFolderId).toBeNull()
    })

    it('wraps at both ends — Home is left of the first folder, the last folder is right of Home (v1.3.1)', () => {
      const [, archives] = seedFolderRow()
      render(<AppShell />)

      pressCmdArrow('ArrowLeft')
      expect(useProjectStore.getState().activeFolderId).toBe(archives)

      useProjectStore.setState({ activeFolderId: archives })
      pressCmdArrow('ArrowRight')
      expect(useProjectStore.getState().activeFolderId).toBeNull()
    })

    it('keeps the keys while a text input holds focus (line navigation)', () => {
      seedFolderRow()
      render(<AppShell />)

      const probe = document.createElement('input')
      document.body.appendChild(probe)
      fireEvent.keyDown(probe, { key: 'ArrowLeft', metaKey: true })
      expect(useProjectStore.getState().activeFolderId).toBeNull()
      probe.remove()
    })
  })
})
