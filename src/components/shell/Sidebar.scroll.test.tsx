import {
  render,
  screen,
  fireEvent,
  createFolderOrFail,
  mockBoundingClientRect,
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

/** Every container scrollTo the reveal effect issued, in call order.
 * jsdom lays out nothing, so the reveal is asserted as a behavior call
 * against pinned geometry (see pinColumnGeometry). */
let revealCalls: { element: Element; top: number }[] = []
let restoreScrollTo: () => void = () => undefined

/** Pins a uniform column inside a 400px-tall scroller: the scroller's
 * document top is 100, card i's document top is 150 + i*61 (57px card +
 * 4px gap). Card i's content-relative top is then 50 + i*61 + scrollTop.
 * Content is 800px tall unless pinned otherwise (maxScroll 400). */
function pinColumnGeometry(
  scroller: HTMLElement,
  options?: { scrollTop?: number; scrollHeight?: number }
): void {
  const { scrollTop = 0, scrollHeight = 800 } = options ?? {}
  mockBoundingClientRect(scroller, { top: 100, height: 400 })
  scroller.scrollTop = scrollTop
  Object.defineProperty(scroller, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  })
  for (const [i, card] of [
    ...scroller.querySelectorAll('[data-project-path]'),
  ].entries()) {
    mockBoundingClientRect(card, { top: 150 + i * 61 })
  }
}

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
    // setup.ts installs a no-op scrollTo; replace it with a recorder so
    // the reveal can be asserted per call.
    const original = Element.prototype.scrollTo
    const recorder = function (this: Element, options?: ScrollToOptions) {
      revealCalls.push({ element: this, top: options?.top ?? 0 })
    }
    Element.prototype.scrollTo = recorder as typeof Element.prototype.scrollTo
    restoreScrollTo = () => {
      Element.prototype.scrollTo = original
    }
    revealCalls = []
    useKeyboardStore.getState().setCommandKeyPressed(false)
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [],
      projectFolders: [],
      pendingPreflightPath: null,
      activeFolderId: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  afterEach(() => {
    restoreScrollTo()
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

  describe('selection scrolls clear of the static fade bands (issue #29)', () => {
    it('Cmd+digit brings a below-the-fold card to the bottom clear line', () => {
      useProjectStore.setState({ recentProjectPaths: TWELVE_PATHS })
      render(<AppShell />)

      const scroller = screen.getByTestId('project-list-scroll')
      pinColumnGeometry(scroller, { scrollTop: 0 })

      fireEvent.keyDown(window, { key: '9', metaKey: true })

      // Card 8: content top 50 + 8*61 = 538, bottom 595 → target
      // 595 - 400 + 26 = 221 (bottom edge 26px above the viewport floor).
      expect(revealCalls).toEqual([{ element: scroller, top: 221 }])
    })

    it('Cmd+↓ to a clear card moves nothing; a banded card scrolls clear', () => {
      useProjectStore.setState({
        recentProjectPaths: TWELVE_PATHS,
        currentProject: { path: pathAt(0), manifest },
        preflightStatus: 'ready',
      })
      render(<AppShell />)

      // Pinned rects never move with the scroll, so a card's viewport
      // position is fixed by its pin: card i sits at 50 + 61i (bottom
      // 107 + 61i) — card 1 is clear, cards from 5 down poke into the
      // bottom band (bottom > 374).
      const scroller = screen.getByTestId('project-list-scroll')
      pinColumnGeometry(scroller, { scrollTop: 300 })
      revealCalls.length = 0

      fireEvent.keyDown(window, { key: 'ArrowDown', metaKey: true })
      expect(revealCalls).toEqual([])

      // ⌘6 = the sixth card (index 5): content top 655, bottom 712 →
      // 712 - 400 + 26 = 338.
      fireEvent.keyDown(window, { key: '6', metaKey: true })
      expect(revealCalls).toEqual([{ element: scroller, top: 338 }])
      revealCalls.length = 0

      // ⌘7 (index 6): bottom 773 → 399 — one short of the column end.
      fireEvent.keyDown(window, { key: '7', metaKey: true })
      expect(revealCalls).toEqual([{ element: scroller, top: 399 }])
      revealCalls.length = 0

      // ⌘8 (index 7) wants 460 — clamped to the column's end (800 - 400).
      fireEvent.keyDown(window, { key: '8', metaKey: true })
      expect(revealCalls).toEqual([{ element: scroller, top: 400 }])
    })

    it('a keyboard selection during a live session reveals the target card too (#39)', async () => {
      seedRunningSession(pathAt(0))
      render(<AppShell />)

      const scroller = screen.getByTestId('project-list-scroll')
      pinColumnGeometry(scroller, { scrollTop: 300 })

      fireEvent.keyDown(window, { key: '7', metaKey: true })

      // v1.2.3 (#39): the selection moves freely under the live session —
      // its card is revealed (no confirmation dialog anymore).
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      // ⌘7 = index 6: content bottom 773 → 773 - 400 + 26 = 399.
      expect(revealCalls).toEqual([{ element: scroller, top: 399 }])
    })

    it('a clamped move keeps the selection and scrolls nothing new', () => {
      useProjectStore.setState({
        recentProjectPaths: TWELVE_PATHS,
        currentProject: { path: pathAt(0), manifest },
        preflightStatus: 'ready',
      })
      render(<AppShell />)

      const scroller = screen.getByTestId('project-list-scroll')
      pinColumnGeometry(scroller, { scrollTop: 0 })
      revealCalls.length = 0

      fireEvent.keyDown(window, { key: 'ArrowUp', metaKey: true })

      expect(revealCalls).toEqual([])
      expect(useProjectStore.getState().currentProject?.path).toBe(pathAt(0))
    })

    it('a mouse click avoids into the clear zone like the keyboard does', () => {
      useProjectStore.setState({ recentProjectPaths: TWELVE_PATHS })
      render(<AppShell />)

      const scroller = screen.getByTestId('project-list-scroll')
      pinColumnGeometry(scroller, { scrollTop: 300 })
      // Re-pin card 0 into the top band: 10px into the viewport (< 26).
      const [first] = screen.getAllByTestId('project-entry')
      if (!first) throw new Error('Expected a project card')
      mockBoundingClientRect(first, { top: 110 })
      revealCalls.length = 0

      fireEvent.click(first)

      // Content top 110 - 100 + 300 = 310 → 310 - 26 = 284 pushes the
      // card's top down past the band.
      expect(revealCalls).toEqual([{ element: scroller, top: 284 }])
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

      const scroller = screen.getByTestId('project-list-scroll')
      pinColumnGeometry(scroller, { scrollTop: 300 })
      revealCalls.length = 0

      fireEvent.keyDown(window, { key: 'ArrowDown', metaKey: true })

      expect(useProjectStore.getState().activeFolderId).toBe(folderId)
      // The folder view mounts fresh card nodes (the members were absent
      // from the unfiled view, so no rects were pinned for them) — the
      // reveal's arithmetic is covered above and in the pure tests; here
      // it must simply have fired on the drill, for the column.
      expect(revealCalls).toHaveLength(1)
      expect(revealCalls[0]?.element).toBe(scroller)
    })
  })
})
