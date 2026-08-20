import {
  render,
  screen,
  fireEvent,
  within,
  act,
  waitFor,
  mockBoundingClientRect,
  createFolderOrFail,
} from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
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

const FIRST_PATH = '/Users/test/Inarticulate III'
const SECOND_PATH = '/Users/test/PNDS Score 1'
const THIRD_PATH = '/Users/test/Another Score'

/**
 * v1.1.2 T3 (issue #7), reworked for the v1.2.1 folder switch: the folder
 * view — segment navigation, the segment's "in use" dot, folder-aware
 * number badges and the new-import landing.
 */
describe('Sidebar folder drill-in (v1.1.2 T3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useKeyboardStore.getState().setCommandKeyPressed(false)
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [FIRST_PATH, SECOND_PATH, THIRD_PATH],
      projectFolders: [],
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  /** A folder named "Set list" holding the two non-first projects. */
  function seedFolder(): string {
    const id = createFolderOrFail('Set list')
    useProjectStore.getState().moveProjectToFolder(id, SECOND_PATH)
    useProjectStore.getState().moveProjectToFolder(id, THIRD_PATH)
    return id
  }

  it('selecting a folder segment switches the view: only members listed', async () => {
    const user = userEvent.setup()
    seedFolder()
    render(<Sidebar variant="static" />)

    await user.click(screen.getByTestId('folder-segment'))

    const entries = screen.getAllByTestId('project-entry')
    expect(entries).toHaveLength(2)
    expect(
      within(entries[0] as HTMLElement).getByText('PNDS Score 1')
    ).toBeInTheDocument()

    // The switch row stays: the unfiled segment returns to the default
    // view, the folder segment names it, and the add-project "+" stays
    // reachable — inside a folder view it is the import entry that lands
    // projects in this folder.
    expect(screen.getByTestId('unfiled-segment')).toBeInTheDocument()
    expect(screen.getByTestId('folder-name')).toHaveTextContent('Set list')
    expect(screen.getByTestId('add-project-button')).toBeInTheDocument()
  })

  it('the unfiled segment returns to the default view and the flat list', async () => {
    const user = userEvent.setup()
    seedFolder()
    render(<Sidebar variant="static" />)

    await user.click(screen.getByTestId('folder-segment'))
    await user.click(screen.getByTestId('unfiled-segment'))

    // Back at the unfiled view: one ungrouped entry, the switch intact.
    expect(screen.getAllByTestId('project-entry')).toHaveLength(1)
    expect(screen.getByTestId('folder-segment')).toBeInTheDocument()
    expect(useProjectStore.getState().activeFolderId).toBeNull()
  })

  it('an empty folder shows the empty hint instead of the no-projects one', () => {
    const id = createFolderOrFail('Empty set')
    useProjectStore.getState().setActiveFolderId(id)
    render(<Sidebar variant="static" />)

    expect(screen.getByText('This folder is empty')).toBeInTheDocument()
    expect(screen.queryByText('No projects opened yet')).not.toBeInTheDocument()
  })

  it('the folder holding the running project shows the in-use dot', () => {
    seedFolder()
    useProjectStore.setState({
      currentProject: { path: SECOND_PATH, manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({ sessionStatus: 'ready' })
    render(<Sidebar variant="static" />)

    const segment = screen.getByTestId('folder-segment')
    expect(within(segment).getByTestId('folder-in-use-dot')).toBeInTheDocument()

    // A merely preflighted (idle) selection is not "in use".
    act(() => {
      useSessionStore.setState({ sessionStatus: 'idle' })
    })
    expect(
      within(screen.getByTestId('folder-segment')).queryByTestId(
        'folder-in-use-dot'
      )
    ).not.toBeInTheDocument()
  })

  it('a folder without the running project never shows the dot', () => {
    seedFolder()
    useProjectStore.setState({
      currentProject: { path: FIRST_PATH, manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({ sessionStatus: 'ready' })
    render(<Sidebar variant="static" />)

    expect(screen.queryByTestId('folder-in-use-dot')).not.toBeInTheDocument()
  })

  it('drag-reorders inside the folder view and persists the set order (v1.1.2 T4)', async () => {
    const user = userEvent.setup()
    seedFolder()
    render(<AppShell />)

    await user.click(screen.getByTestId('folder-segment'))

    const entries = screen.getAllByTestId('project-entry')
    const first = entries[0]
    const second = entries[1]
    if (!first || !second) throw new Error('Expected two folder members')
    // jsdom lays out nothing: pin the rects the drag derives geometry from
    // (the two members pitch 61px apart). The drop hit-test is pure math
    // over this static layout.
    mockBoundingClientRect(first, { top: 0 })
    mockBoundingClientRect(second, { top: 61 })

    // Drag the first member over the second's bottom half → insert after.
    // The press activates into a drag only past the click slack.
    fireEvent.pointerDown(first, { pointerId: 1, clientX: 40, clientY: 20 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 30 })
    await waitFor(() =>
      expect(screen.getByTestId('drag-clone')).toBeInTheDocument()
    )
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 40, clientY: 100 })
    fireEvent.pointerUp(window, { pointerId: 1 })

    // The folder's set order swaps; the master list is untouched.
    expect(useProjectStore.getState().projectFolders[0]?.projectPaths).toEqual([
      THIRD_PATH,
      SECOND_PATH,
    ])
    expect(useProjectStore.getState().recentProjectPaths).toEqual([
      FIRST_PATH,
      SECOND_PATH,
      THIRD_PATH,
    ])
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          projectFolders: [
            expect.objectContaining({
              projectPaths: [THIRD_PATH, SECOND_PATH],
            }),
          ],
        })
      )
    })
  })

  describe('folder-aware number badges and Cmd+number', () => {
    function pressCmd() {
      fireEvent.keyDown(window, { key: 'Meta' })
    }

    function pressCmdDigit(digit: string) {
      fireEvent.keyDown(window, { key: digit, metaKey: true })
    }

    /** The visible entry order, as (path → text) pairs of the cards. */
    function entryOrder() {
      return screen
        .getAllByTestId(/project-entry|current-project-card/)
        .map(card => card.getAttribute('data-project-path'))
    }

    /** Path → badge number pairs for the visible project cards. */
    function badgeNumbersByPath(): [string, string][] {
      return screen
        .getAllByTestId(/project-entry|current-project-card/)
        .map(card => {
          const badge = within(card).getByTestId('project-number-badge')
          return [
            card.getAttribute('data-project-path') ?? '',
            (badge.textContent ?? '').trim(),
          ] as [string, string]
        })
    }

    it('badges number only the folder members, 1..9, while drilled in', async () => {
      const user = userEvent.setup()
      seedFolder()
      render(<AppShell />)

      await user.click(screen.getByTestId('folder-segment'))
      pressCmd()

      const badges = screen.getAllByTestId('project-number-badge')
      expect(badges.map(b => (b.textContent ?? '').trim())).toEqual(['1', '2'])
      // The ungrouped project is not part of the folder view.
      expect(entryOrder()).toEqual([SECOND_PATH, THIRD_PATH])

      // Returning to the unfiled view restores the flat numbering.
      await user.click(screen.getByTestId('unfiled-segment'))
      expect(
        screen
          .getAllByTestId('project-number-badge')
          .map(b => (b.textContent ?? '').trim())
      ).toEqual(['1'])
    })

    it('a folder deeper than nine members still caps badges at nine', () => {
      const paths = Array.from({ length: 10 }, (_, i) => `/Users/test/S${i}`)
      useProjectStore.setState({ recentProjectPaths: [FIRST_PATH, ...paths] })
      const id = createFolderOrFail('Big set')
      for (const p of paths) {
        useProjectStore.getState().moveProjectToFolder(id, p)
      }
      useProjectStore.getState().setActiveFolderId(id)
      render(<AppShell />)

      pressCmd()
      expect(screen.getAllByTestId('project-number-badge')).toHaveLength(9)
    })

    it('reordering inside the folder re-numbers the badges in real time', async () => {
      const user = userEvent.setup()
      seedFolder()
      render(<AppShell />)

      await user.click(screen.getByTestId('folder-segment'))
      pressCmd()
      expect(badgeNumbersByPath()).toEqual([
        [SECOND_PATH, '1'],
        [THIRD_PATH, '2'],
      ])

      // A reorder inside the folder view (what a drag commits).
      act(() => {
        useProjectStore
          .getState()
          .applyVisibleReorder([THIRD_PATH, SECOND_PATH])
      })
      expect(badgeNumbersByPath()).toEqual([
        [THIRD_PATH, '1'],
        [SECOND_PATH, '2'],
      ])
    })

    it('Cmd+1 selects the folder view’s first member, not the top level’s', () => {
      vi.mocked(commands.preflightProject).mockResolvedValue({
        status: 'ok',
        data: manifest,
      })
      seedFolder()
      useProjectStore
        .getState()
        .setActiveFolderId(
          useProjectStore.getState().projectFolders[0]?.id ?? null
        )
      render(<AppShell />)

      pressCmdDigit('1')

      expect(commands.preflightProject).toHaveBeenCalledWith(SECOND_PATH)
    })
  })
})
