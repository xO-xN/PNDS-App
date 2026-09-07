import { render, screen, within, waitFor } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { importSetlistDirectory } from '@/lib/setlist-import'
import { serializeSetlist } from '@/lib/setlist'
import { Sidebar } from './Sidebar'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/notifications', () => ({
  notifications: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

const EXPORT_DIR = '/Volumes/Handover/Gig Export'

/**
 * v1.4.0 (issue #63): the import's user-visible landing — after the flow
 * runs, the rebuilt folder and its set order are ON the sidebar. The
 * store is real (the flow's own seam), the IPC is mocked.
 */
describe('Sidebar setlist import landing (issue #63)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The receiving machine starts with its own project; the import
    // replaces the index (the seam's load semantics).
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: ['/Users/me/Own Project'],
      projectFolders: [
        { id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: [] },
      ],
      projectDisplayNames: {},
      manifestProjectNames: {},
      pendingPreflightPath: null,
      activeFolderId: null,
      renameTarget: null,
      utilityPaths: [],
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()

    vi.mocked(commands.readSetlist).mockResolvedValue({
      status: 'ok',
      data: {
        setlistJson: serializeSetlist({
          formatVersion: 1,
          name: 'Gig Friday',
          exportedWith: '1.4.0',
          exportedAt: '2026-09-07T12:00:00.000Z',
          projects: [
            {
              file: 'Night-2.0.0.pnds',
              id: 'proj-b',
              version: '2.0.0',
              displayName: 'Night Set',
              audioMode: 'external',
            },
            {
              file: 'Opening-1.0.0.pnds',
              id: 'proj-a',
              version: '1.0.0',
              displayName: 'Opening',
              audioMode: 'internal',
            },
          ],
        }),
        bundles: [
          {
            path: `${EXPORT_DIR}/Night-2.0.0.pnds`,
            fileName: 'Night-2.0.0.pnds',
            id: 'proj-b',
            version: '2.0.0',
          },
          {
            path: `${EXPORT_DIR}/Opening-1.0.0.pnds`,
            fileName: 'Opening-1.0.0.pnds',
            id: 'proj-a',
            version: '1.0.0',
          },
        ],
      },
    })
    vi.mocked(commands.installBundle).mockImplementation(async path =>
      path.endsWith('Night-2.0.0.pnds')
        ? { status: 'ok', data: '/bundles/proj-b-2.0.0' }
        : { status: 'ok', data: '/bundles/proj-a-1.0.0' }
    )
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { theme: 'system', oscTargets: {} } as never,
    })
  })

  it('the rebuilt folder, its order and display names are visible', async () => {
    render(<Sidebar variant="static" />)

    // Before: the receiver's own project, no setlist folder.
    expect(screen.getAllByTestId('project-entry')).toHaveLength(1)

    await importSetlistDirectory(EXPORT_DIR)

    // The flow drills into the rebuilt folder — its members show in SET
    // order with their display names, not install-dir basenames.
    await waitFor(() => {
      const cards = screen.getAllByTestId(/project-entry|current-project-card/)
      expect(cards).toHaveLength(2)
    })
    const entries = screen.getAllByTestId(/project-entry/)
    const [night, opening] = entries
    if (!night || !opening) throw new Error('Expected two imported cards')
    expect(within(night).getByText('Night Set')).toBeInTheDocument()
    expect(within(opening).getByText('Opening')).toBeInTheDocument()

    // The folder segment exists with the set's name (Home + Utilities
    // flank it in the switch row).
    const segments = screen.getAllByTestId('folder-segment')
    const gig = segments.find(segment =>
      within(segment).getByTestId('folder-name')
    )
    expect(gig).toBeDefined()
    if (!gig) throw new Error('Expected the setlist folder segment')
    expect(within(gig).getByTestId('folder-name')).toHaveTextContent(
      'Gig Friday'
    )
  })

  it('the receiving machine’s own projects leave the index with the set', async () => {
    render(<Sidebar variant="static" />)

    await importSetlistDirectory(EXPORT_DIR)

    // The replace semantics: the imported set IS the index — the old
    // ungrouped project is gone from the (drilled-in) view and from Home.
    const state = useProjectStore.getState()
    expect(state.recentProjectPaths).not.toContain('/Users/me/Own Project')
    expect(state.projectFolders).toHaveLength(2)
  })
})
