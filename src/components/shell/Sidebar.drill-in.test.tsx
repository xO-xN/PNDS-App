import { render, screen, fireEvent, within, act } from '@/test/test-utils'
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
 * v1.1.2 T3 (issue #7): the folder drill-in view — breadcrumb navigation,
 * the folder card's "in use" dot, folder-aware number badges and the
 * new-import landing.
 */
describe('Sidebar folder drill-in (v1.1.2 T3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useKeyboardStore.getState().setCommandKeyPressed(false)
    useProjectStore.setState({
      currentProject: null,
      trustedPaths: [FIRST_PATH, SECOND_PATH, THIRD_PATH],
      projectFolders: [],
      pendingTrustPath: null,
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
    const id = useProjectStore.getState().createFolder('Set list')
    useProjectStore.getState().moveProjectToFolder(id, SECOND_PATH)
    useProjectStore.getState().moveProjectToFolder(id, THIRD_PATH)
    return id
  }

  it('clicking a folder card drills in: only members listed, breadcrumb shown', async () => {
    const user = userEvent.setup()
    seedFolder()
    render(<Sidebar variant="static" />)

    await user.click(screen.getByTestId('folder-card'))

    const entries = screen.getAllByTestId('project-entry')
    expect(entries).toHaveLength(2)
    expect(
      within(entries[0] as HTMLElement).getByText('PNDS Score 1')
    ).toBeInTheDocument()

    // The header is replaced by the breadcrumb; the folder list is gone.
    expect(screen.getByTestId('breadcrumb-back')).toBeInTheDocument()
    expect(screen.getByTestId('breadcrumb-folder-name')).toHaveTextContent(
      'Set list'
    )
    // The add-project "+" stays reachable — inside a folder view it is
    // the import entry that lands projects in this folder.
    expect(screen.getByTestId('add-project-button')).toBeInTheDocument()
    expect(screen.queryByTestId('folder-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('new-folder-button')).not.toBeInTheDocument()
  })

  it('the breadcrumb returns to the top level and restores the flat list', async () => {
    const user = userEvent.setup()
    seedFolder()
    render(<Sidebar variant="static" />)

    await user.click(screen.getByTestId('folder-card'))
    await user.click(screen.getByTestId('breadcrumb-back'))

    // Back at the top: one ungrouped entry plus the folder card again.
    expect(screen.getAllByTestId('project-entry')).toHaveLength(1)
    expect(screen.getByTestId('folder-card')).toBeInTheDocument()
    expect(screen.queryByTestId('breadcrumb-back')).not.toBeInTheDocument()
    expect(screen.getByTestId('new-folder-button')).toBeInTheDocument()
  })

  it('an empty folder shows the empty hint instead of the no-projects one', () => {
    const id = useProjectStore.getState().createFolder('Empty set')
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

    const card = screen.getByTestId('folder-card')
    expect(within(card).getByTestId('folder-in-use-dot')).toBeInTheDocument()

    // A merely preflighted (idle) selection is not "in use".
    act(() => {
      useSessionStore.setState({ sessionStatus: 'idle' })
    })
    expect(
      within(screen.getByTestId('folder-card')).queryByTestId(
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

      await user.click(screen.getByTestId('folder-card'))
      pressCmd()

      const badges = screen.getAllByTestId('project-number-badge')
      expect(badges.map(b => (b.textContent ?? '').trim())).toEqual(['1', '2'])
      // The ungrouped project is not part of the folder view.
      expect(entryOrder()).toEqual([SECOND_PATH, THIRD_PATH])

      // Returning to the top restores the flat numbering.
      await user.click(screen.getByTestId('breadcrumb-back'))
      expect(
        screen
          .getAllByTestId('project-number-badge')
          .map(b => (b.textContent ?? '').trim())
      ).toEqual(['1'])
    })

    it('a folder deeper than nine members still caps badges at nine', () => {
      const paths = Array.from({ length: 10 }, (_, i) => `/Users/test/S${i}`)
      useProjectStore.setState({ trustedPaths: [FIRST_PATH, ...paths] })
      const id = useProjectStore.getState().createFolder('Big set')
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
      const id = seedFolder()
      render(<AppShell />)

      await user.click(screen.getByTestId('folder-card'))
      pressCmd()
      expect(badgeNumbersByPath()).toEqual([
        [SECOND_PATH, '1'],
        [THIRD_PATH, '2'],
      ])

      // A reorder inside the folder view (drag lands on moveWithinFolder).
      act(() => {
        useProjectStore.getState().moveWithinFolder(id, THIRD_PATH, SECOND_PATH)
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
