import {
  render,
  screen,
  fireEvent,
  createFolderOrFail,
} from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { Sidebar } from './Sidebar'
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

const TWELVE_PATHS = Array.from(
  { length: 12 },
  (_, i) => `/Users/test/Score ${i + 1}`
)

function pathAt(index: number): string {
  const path = TWELVE_PATHS[index]
  if (!path) throw new Error(`Expected a seeded path at ${index}`)
  return path
}

/** The health block the shell's session restore needs for "ready". */
const readyHealth = {
  status: 'ready' as const,
  projectId: 'inarticulate-iii',
  audioMode: 'internal' as const,
  audio: { status: 'running' as const, target: null, error: null },
  scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
}

/** Seeds a stable running session (stores + the shell's restore mock). */
function seedRunningSession(currentPath: string) {
  useProjectStore.setState({
    recentProjectPaths: TWELVE_PATHS,
    currentProject: { path: currentPath, manifest },
    preflightStatus: 'ready',
  })
  useSessionStore.setState({
    sessionStatus: 'ready',
    projectName: 'Score 1',
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
      projectName: 'Score 1',
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

/** data-project-path of every card asked to scrollIntoView, in call order.
 * jsdom lays out nothing, so the reveal is asserted as a behavior call. */
let scrolledPaths: string[] = []
let restoreScrollIntoView: () => void = () => undefined

/**
 * v1.2.1 (issue #25): the sidebar's project column becomes its own
 * vertical scroll region — every project stays reachable, the FOLDERS
 * section and the settings footer never scroll away, and keyboard
 * selection (⌘↑/⌘↓, ⌘1..9, auto-drill) scrolls the target card into
 * view. Real scrolling and edge auto-scroll are manual verification
 * (jsdom limits, parent issue #24); these tests pin the structure and
 * the reveal calls.
 */
describe('Sidebar project-list scrolling (issue #25)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // setup.ts installs a no-op scrollIntoView; replace it with a recorder
    // so the reveal can be asserted per card.
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: HTMLElement) {
      if (this.dataset.projectPath) scrolledPaths.push(this.dataset.projectPath)
    }
    restoreScrollIntoView = () => {
      Element.prototype.scrollIntoView = original
    }
    scrolledPaths = []
    useKeyboardStore.getState().setCommandKeyPressed(false)
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [],
      projectFolders: [],
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  afterEach(() => {
    restoreScrollIntoView()
  })

  describe('the project column is its own scroll region', () => {
    it('holds every project card; the folder switch and settings stay outside (static)', () => {
      useProjectStore.setState({ recentProjectPaths: TWELVE_PATHS })
      createFolderOrFail('Set list')
      render(<Sidebar variant="static" />)

      const scroller = screen.getByTestId('project-list-scroll')
      const entries = screen.getAllByTestId('project-entry')
      expect(entries).toHaveLength(TWELVE_PATHS.length)
      for (const entry of entries) {
        expect(scroller).toContainElement(entry)
      }
      expect(scroller).not.toContainElement(
        screen.getByTestId('folder-segment')
      )
      expect(scroller).not.toContainElement(
        screen.getByTestId('unfiled-segment')
      )
      expect(scroller).not.toContainElement(screen.getByTestId('settings-card'))
    })

    it('the overlay variant shares the same scrolling layout', () => {
      useProjectStore.setState({ recentProjectPaths: TWELVE_PATHS })
      render(<Sidebar variant="overlay" />)

      const scroller = screen.getByTestId('project-list-scroll')
      const entries = screen.getAllByTestId('project-entry')
      expect(entries).toHaveLength(TWELVE_PATHS.length)
      const firstEntry = entries[0]
      if (!firstEntry) throw new Error('Expected a project card')
      expect(scroller).toContainElement(firstEntry)
      expect(scroller).not.toContainElement(screen.getByTestId('settings-card'))
    })

    it('the folder switch still renders under many projects', () => {
      useProjectStore.setState({ recentProjectPaths: TWELVE_PATHS })
      render(<Sidebar variant="static" />)

      expect(screen.getByTestId('unfiled-segment')).toBeInTheDocument()
      expect(screen.getByTestId('folder-pill')).toBeInTheDocument()
    })

    it('the folder view scrolls its members; the switch and footer stay outside', () => {
      const folderId = createFolderOrFail('Set list')
      useProjectStore.getState().moveProjectToFolder(folderId, pathAt(0))
      render(<Sidebar variant="static" />)

      fireEvent.click(screen.getByTestId('folder-segment'))

      const scroller = screen.getByTestId('project-list-scroll')
      expect(scroller).toContainElement(screen.getByTestId('project-entry'))
      expect(scroller).not.toContainElement(
        screen.getByTestId('unfiled-segment')
      )
      expect(scroller).not.toContainElement(screen.getByTestId('settings-card'))
    })
  })

  describe('empty states', () => {
    it('the empty unfiled view shows the hint inside the scroller; the switch stays reachable', () => {
      render(<Sidebar variant="static" />)

      const scroller = screen.getByTestId('project-list-scroll')
      expect(scroller).toHaveTextContent('No projects opened yet')
      expect(screen.getByTestId('unfiled-segment')).toBeInTheDocument()
      expect(screen.getByTestId('folder-pill')).toBeInTheDocument()
    })

    it('an empty folder shows its hint inside the scroller', () => {
      createFolderOrFail('Set list')
      render(<Sidebar variant="static" />)

      fireEvent.click(screen.getByTestId('folder-segment'))

      const scroller = screen.getByTestId('project-list-scroll')
      expect(scroller).toHaveTextContent('This folder is empty')
      expect(screen.getByTestId('unfiled-segment')).toBeInTheDocument()
    })
  })

  describe('keyboard selection scrolls the target card into view', () => {
    it('Cmd+digit reveals the numbered card', () => {
      useProjectStore.setState({ recentProjectPaths: TWELVE_PATHS })
      render(<AppShell />)

      fireEvent.keyDown(window, { key: '9', metaKey: true })

      expect(scrolledPaths).toEqual([pathAt(8)])
    })

    it('Cmd+↓ reveals each newly selected card along the visible order', () => {
      useProjectStore.setState({
        recentProjectPaths: TWELVE_PATHS,
        currentProject: { path: pathAt(0), manifest },
        preflightStatus: 'ready',
      })
      render(<AppShell />)
      // Mount already reveals the restored selection.
      expect(scrolledPaths).toEqual([pathAt(0)])

      fireEvent.keyDown(window, { key: 'ArrowDown', metaKey: true })

      expect(scrolledPaths).toEqual([pathAt(0), pathAt(1)])
    })

    it('a keyboard switch request during a live session reveals the target card too', async () => {
      seedRunningSession(pathAt(0))
      render(<AppShell />)
      // Mount revealed the running current project.
      expect(scrolledPaths).toEqual([pathAt(0)])

      fireEvent.keyDown(window, { key: '2', metaKey: true })

      // The switch confirmation opens for the target — its card was
      // revealed even though the selection itself did not move.
      await screen.findByRole('alertdialog')
      expect(scrolledPaths).toEqual([pathAt(0), pathAt(1)])
    })

    it('a clamped move keeps the selection and scrolls nothing new', () => {
      useProjectStore.setState({
        recentProjectPaths: TWELVE_PATHS,
        currentProject: { path: pathAt(0), manifest },
        preflightStatus: 'ready',
      })
      render(<AppShell />)
      expect(scrolledPaths).toEqual([pathAt(0)])
      scrolledPaths.length = 0

      fireEvent.keyDown(window, { key: 'ArrowUp', metaKey: true })

      expect(scrolledPaths).toEqual([])
      expect(useProjectStore.getState().currentProject?.path).toBe(pathAt(0))
    })

    it("auto-drilling into the current project's folder reveals the next member inside it", () => {
      const folderId = createFolderOrFail('Set list')
      const store = useProjectStore.getState()
      store.moveProjectToFolder(folderId, pathAt(3))
      store.moveProjectToFolder(folderId, pathAt(4))
      store.moveProjectToFolder(folderId, pathAt(5))
      useProjectStore.setState({
        recentProjectPaths: TWELVE_PATHS,
        currentProject: { path: pathAt(4), manifest },
        preflightStatus: 'ready',
      })
      render(<AppShell />)
      // The grouped current project has no card in the top-level view.
      expect(scrolledPaths).toEqual([])

      fireEvent.keyDown(window, { key: 'ArrowDown', metaKey: true })

      expect(useProjectStore.getState().activeFolderId).toBe(folderId)
      expect(scrolledPaths).toEqual([pathAt(5)])
    })
  })
})
