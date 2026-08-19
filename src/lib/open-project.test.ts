import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { notifications } from '@/lib/notifications'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { openProject, promptOpenProject } from './open-project'

vi.mock('@/lib/notifications', () => ({
  notifications: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))
import type { Manifest } from '@/lib/tauri-bindings'

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

const NEW_PATH = '/Users/test/Score 4'

/**
 * v1.2.0 (spec issue #15): the trust gate is gone — opening a path adds it
 * to the history and runs preflight directly. Both import entries (folder
 * picker / ⌘O) funnel through `openProject`, so the v1.1.2 T3 landing rule
 * (spec issue #7 新导入落点) is asserted once here: folder view lands the
 * project at that folder's end, top level leaves it ungrouped.
 */
describe('openProject (no trust gate)', () => {
  let folderId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: ['/a', '/b'],
      projectFolders: [],
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      manifestProjectNames: {},
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
    folderId = useProjectStore.getState().createFolder('Set list')
    useProjectStore.getState().moveProjectToFolder(folderId, '/b')
    // The setup actions persist through the store's save queue — let those
    // saves land and clear them, so the not-called assertions below observe
    // only the flow under test.
    await new Promise(resolve => setTimeout(resolve, 0))
    vi.mocked(commands.savePreferences).mockClear()
  })

  it('preflights a new path immediately, without any confirmation step', async () => {
    await openProject(NEW_PATH)

    expect(commands.preflightProject).toHaveBeenCalledWith(NEW_PATH)
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('lands the new project at the end of the drilled-in folder', async () => {
    useProjectStore.getState().setActiveFolderId(folderId)

    await openProject(NEW_PATH)

    const state = useProjectStore.getState()
    expect(state.recentProjectPaths).toContain(NEW_PATH)
    expect(state.projectFolders[0]?.projectPaths).toEqual(['/b', NEW_PATH])
  })

  it('keeps a top-level import ungrouped', async () => {
    await openProject(NEW_PATH)

    const state = useProjectStore.getState()
    expect(state.projectFolders[0]?.projectPaths).toEqual(['/b'])
    const grouped = new Set(
      state.projectFolders.flatMap(folder => folder.projectPaths)
    )
    expect(grouped.has(NEW_PATH)).toBe(false)
  })

  it('persists the landing index — history and folder membership together', async () => {
    useProjectStore.getState().setActiveFolderId(folderId)

    await openProject(NEW_PATH)

    const state = useProjectStore.getState()
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          recentProjects: state.recentProjectPaths,
          projectFolders: state.projectFolders,
        })
      )
    })
  })

  it('does not re-add or re-save a path already in the history', async () => {
    await openProject('/a')

    const state = useProjectStore.getState()
    expect(state.recentProjectPaths).toEqual(['/a', '/b'])
    // No project-index re-save (the manifest-name learn below is a separate
    // preference field, asserted in its own test).
    expect(commands.savePreferences).not.toHaveBeenCalledWith(
      expect.objectContaining({ recentProjects: expect.anything() })
    )
    expect(commands.preflightProject).toHaveBeenCalledWith('/a')
  })

  it('persists the manifest-declared name on a successful preflight', async () => {
    await openProject(NEW_PATH)

    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          projectManifestNames: { [NEW_PATH]: 'Inarticulate III' },
        })
      )
    })
    expect(useProjectStore.getState().manifestProjectNames[NEW_PATH]).toBe(
      'Inarticulate III'
    )
  })

  it('saves nothing when the manifest name is already known', async () => {
    // '/a' is already in the history, so no index save either — a known
    // name must make the whole open a no-op on the preferences file.
    useProjectStore
      .getState()
      .setManifestProjectNames({ '/a': 'Inarticulate III' })

    await openProject('/a')

    expect(commands.savePreferences).not.toHaveBeenCalled()
  })
})

describe('promptOpenProject picker (v1.2.0 issue #16)', () => {
  const PICKED_DIR = '/Users/test/Score 5'
  const PICKED_BUNDLE = '/Users/test/Score 5-1.0.0.pnds'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })
    vi.mocked(commands.installBundle).mockResolvedValue({
      status: 'ok',
      data: '/bundles/score-5-1.0.0',
    })
  })

  it('opens a picked directory as a normal project', async () => {
    vi.mocked(commands.pickProjectOrBundle).mockResolvedValue({
      status: 'ok',
      data: PICKED_DIR,
    })

    await promptOpenProject()

    expect(commands.pickProjectOrBundle).toHaveBeenCalled()
    expect(commands.installBundle).not.toHaveBeenCalled()
    expect(commands.preflightProject).toHaveBeenCalledWith(PICKED_DIR)
  })

  it('installs a picked .pnds bundle and opens the extracted directory', async () => {
    vi.mocked(commands.pickProjectOrBundle).mockResolvedValue({
      status: 'ok',
      data: PICKED_BUNDLE,
    })

    await promptOpenProject()

    expect(commands.installBundle).toHaveBeenCalledWith(PICKED_BUNDLE)
    // The extracted dir is what enters the normal open flow — never the
    // .pnds file itself.
    expect(commands.preflightProject).toHaveBeenCalledWith(
      '/bundles/score-5-1.0.0'
    )
  })

  it('does nothing when the picker is cancelled', async () => {
    vi.mocked(commands.pickProjectOrBundle).mockResolvedValue({
      status: 'ok',
      data: null,
    })

    await promptOpenProject()

    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(commands.installBundle).not.toHaveBeenCalled()
  })

  it('reports a picker failure without opening anything', async () => {
    vi.mocked(commands.pickProjectOrBundle).mockResolvedValue({
      status: 'error',
      error: 'panel unavailable',
    })

    await promptOpenProject()

    expect(notifications.error).toHaveBeenCalledWith(
      'Could not open the file dialog'
    )
    expect(commands.preflightProject).not.toHaveBeenCalled()
  })
})
