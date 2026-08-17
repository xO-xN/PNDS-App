import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { openProject } from './open-project'
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

  beforeEach(() => {
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
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
    folderId = useProjectStore.getState().createFolder('Set list')
    useProjectStore.getState().moveProjectToFolder(folderId, '/b')
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

  it('persists history and folders in a single save', async () => {
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
    expect(commands.savePreferences).not.toHaveBeenCalled()
    expect(commands.preflightProject).toHaveBeenCalledWith('/a')
  })
})
