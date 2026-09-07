import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { notifications } from '@/lib/notifications'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { importSetlistDirectory } from './setlist-import'
import { serializeSetlist, type SetlistFile } from './setlist'

vi.mock('@/lib/notifications', () => ({
  notifications: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

const EXPORT_DIR = '/Volumes/Handover/Gig Export'

const setlist: SetlistFile = {
  formatVersion: 1,
  name: 'Gig Friday',
  exportedWith: '1.4.0',
  exportedAt: '2026-09-07T12:00:00.000Z',
  projects: [
    {
      file: 'Project B-2.0.0.pnds',
      id: 'proj-b',
      version: '2.0.0',
      displayName: 'Night Set',
      audioMode: 'external',
      oscTarget: '10.0.0.5:3333',
    },
    {
      file: 'Project A-1.0.0.pnds',
      id: 'proj-a',
      version: '1.0.0',
      displayName: 'Opening',
      audioMode: 'internal',
    },
  ],
}

function mockReadout(
  setlistJson: string,
  bundles: { fileName: string; id: string; version: string }[]
) {
  vi.mocked(commands.readSetlist).mockResolvedValue({
    status: 'ok',
    data: {
      setlistJson,
      bundles: bundles.map(bundle => ({
        path: `${EXPORT_DIR}/${bundle.fileName}`,
        ...bundle,
      })),
    },
  })
}

/** expect(matcher) against a value outside an assertion: does this saved
 * preferences object match the expected shape? */
function matchSaved(
  saved: Record<string, unknown>,
  expected: Record<string, unknown>
): boolean {
  try {
    expect(saved).toMatchObject(expected)
    return true
  } catch {
    return false
  }
}

/**
 * v1.4.0 (issue #63): the import flow — read → parse → match → install
 * (the existing bundle pipeline) → one replaceProjectIndex rebuild +
 * per-project OSC targets. Asserted from the outside: the command calls,
 * the persisted index, and what the operator sees.
 */
describe('importSetlistDirectory (issue #63)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The receiving machine's starting state: its own project, its own
    // folder, and the app's Utilities content.
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: ['/Users/me/Own Project'],
      projectFolders: [
        { id: 'own-folder', name: 'My Stuff', projectPaths: [] },
        {
          id: UTILITIES_FOLDER_ID,
          name: 'Utilities',
          projectPaths: ['/apps/tools/lnd'],
        },
      ],
      utilityPaths: ['/apps/tools/lnd'],
      projectDisplayNames: {},
      manifestProjectNames: {},
      pendingPreflightPath: null,
      activeFolderId: null,
      renameTarget: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
    mockReadout(serializeSetlist(setlist), [
      { fileName: 'Project A-1.0.0.pnds', id: 'proj-a', version: '1.0.0' },
      { fileName: 'Project B-2.0.0.pnds', id: 'proj-b', version: '2.0.0' },
    ])
    // Install results in call order (set order: B first, then A).
    vi.mocked(commands.installBundle).mockImplementation(
      async (path: string) =>
        path.endsWith('B-2.0.0.pnds')
          ? { status: 'ok', data: '/bundles/proj-b-2.0.0' }
          : { status: 'ok', data: '/bundles/proj-a-1.0.0' }
    )
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { theme: 'system', oscTargets: {} } as never,
    })
  })

  it('installs in set order and rebuilds the folder, order, names and targets', async () => {
    const handled = await importSetlistDirectory(EXPORT_DIR)
    expect(handled).toBe(true)

    // Install order = set order, through the existing install command.
    const installCalls = vi
      .mocked(commands.installBundle)
      .mock.calls.map(call => call[0])
    expect(installCalls).toEqual([
      `${EXPORT_DIR}/Project B-2.0.0.pnds`,
      `${EXPORT_DIR}/Project A-1.0.0.pnds`,
    ])

    const state = useProjectStore.getState()
    // One folder rebuilt in set order under the set's name; the receiving
    // machine's own folder is REPLACED (the seam's load semantics) while
    // Utilities survives with its tool, bottom-pinned.
    const [first, second] = state.projectFolders
    expect(first?.name).toBe('Gig Friday')
    expect(first?.projectPaths).toEqual([
      '/bundles/proj-b-2.0.0',
      '/bundles/proj-a-1.0.0',
    ])
    expect(second?.id).toBe(UTILITIES_FOLDER_ID)
    // History holds the imported set (in set order) plus the riding tool.
    expect(state.recentProjectPaths).toEqual([
      '/bundles/proj-b-2.0.0',
      '/bundles/proj-a-1.0.0',
      '/apps/tools/lnd',
    ])
    // Display names key by the LOCAL install paths.
    expect(state.projectDisplayNames).toEqual({
      '/bundles/proj-b-2.0.0': 'Night Set',
      '/bundles/proj-a-1.0.0': 'Opening',
    })
    // The sidebar lands inside the rebuilt folder.
    expect(state.activeFolderId).toBe(first?.id)

    // The rebuild persists as one snapshot; no device/sampleRate fields
    // ever appear in any saved preferences.
    await vi.waitFor(() => {
      const saves = vi.mocked(commands.savePreferences).mock.calls
      expect(
        saves.some(([saved]) =>
          matchSaved(saved, {
            recentProjects: [
              '/bundles/proj-b-2.0.0',
              '/bundles/proj-a-1.0.0',
              '/apps/tools/lnd',
            ],
            projectFolders: [
              expect.objectContaining({ name: 'Gig Friday' }),
              expect.objectContaining({ id: UTILITIES_FOLDER_ID }),
            ],
          })
        )
      ).toBe(true)
      for (const [saved] of saves) {
        expect(Object.keys(saved)).not.toContain('outputDevice')
        expect(Object.keys(saved)).not.toContain('sampleRate')
      }
    })

    // The OSC target that traveled is merged back key-by-key.
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          oscTargets: { 'proj-b': '10.0.0.5:3333' },
        })
      )
    })
    expect(notifications.success).toHaveBeenCalledWith(
      'Setlist imported',
      'Gig Friday'
    )
  })

  it('an invalid oscTarget is refused instead of persisted', async () => {
    const [night, opening] = setlist.projects
    if (!night || !opening) throw new Error('Expected two fixture projects')
    const edited = serializeSetlist({
      ...setlist,
      projects: [{ ...night, oscTarget: 'not a target' }, opening],
    })
    mockReadout(edited, [
      { fileName: 'Project A-1.0.0.pnds', id: 'proj-a', version: '1.0.0' },
      { fileName: 'Project B-2.0.0.pnds', id: 'proj-b', version: '2.0.0' },
    ])

    await importSetlistDirectory(EXPORT_DIR)

    // The index still rebuilds…
    expect(useProjectStore.getState().recentProjectPaths.length).toBe(3)
    // …but the garbage target never reaches the preference file.
    await vi.waitFor(() => {
      const saves = vi.mocked(commands.savePreferences).mock.calls
      for (const call of saves) {
        expect(call[0]).not.toMatchObject({
          oscTargets: { 'proj-b': 'not a target' },
        })
      }
    })
  })

  it('a directory without set.json reports false for the routing seam', async () => {
    vi.mocked(commands.readSetlist).mockResolvedValue({
      status: 'error',
      error: 'No set.json in /Users/me/Plain Project',
    })

    expect(await importSetlistDirectory('/Users/me/Plain Project')).toBe(false)
    expect(commands.installBundle).not.toHaveBeenCalled()
    expect(useProjectStore.getState().recentProjectPaths).toEqual([
      '/Users/me/Own Project',
    ])
  })

  it('a corrupt set.json is reported and nothing installs', async () => {
    mockReadout('{ not json', [])

    expect(await importSetlistDirectory(EXPORT_DIR)).toBe(true)
    expect(notifications.error).toHaveBeenCalledWith(
      'The set.json in this directory is invalid',
      expect.stringContaining('valid JSON')
    )
    expect(commands.installBundle).not.toHaveBeenCalled()
  })

  it('entries without a matching bundle are named and nothing installs', async () => {
    mockReadout(serializeSetlist(setlist), [
      { fileName: 'Project A-1.0.0.pnds', id: 'proj-a', version: '1.0.0' },
    ])

    expect(await importSetlistDirectory(EXPORT_DIR)).toBe(true)
    expect(notifications.error).toHaveBeenCalledWith(
      'The directory is missing bundles for setlist entries',
      'proj-b 2.0.0'
    )
    expect(commands.installBundle).not.toHaveBeenCalled()
  })

  it('a failed install aborts before the index rebuild', async () => {
    vi.mocked(commands.installBundle).mockResolvedValue({
      status: 'error',
      error: 'corrupt archive',
    })

    expect(await importSetlistDirectory(EXPORT_DIR)).toBe(true)
    expect(notifications.error).toHaveBeenCalledWith(
      'Setlist import failed',
      expect.stringContaining('corrupt archive')
    )
    // The receiving machine's index is untouched — no half-rebuilt set.
    expect(useProjectStore.getState().recentProjectPaths).toEqual([
      '/Users/me/Own Project',
    ])
    expect(useProjectStore.getState().projectFolders).toHaveLength(2)
  })
})
