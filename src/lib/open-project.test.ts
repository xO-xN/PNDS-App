import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { confirmTrustAndOpen } from './open-project'
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
 * v1.1.2 T3 (spec issue #7 新导入落点): both import entries funnel through
 * the trust confirmation, so the landing rule is asserted once here —
 * folder view lands the project at that folder's end, top level leaves it
 * ungrouped.
 */
describe('confirmTrustAndOpen import landing', () => {
  let folderId: string

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })
    useProjectStore.setState({
      currentProject: null,
      trustedPaths: ['/a', '/b'],
      projectFolders: [],
      pendingTrustPath: null,
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
    folderId = useProjectStore.getState().createFolder('Set list')
    useProjectStore.getState().moveProjectToFolder(folderId, '/b')
    useProjectStore.setState({ pendingTrustPath: NEW_PATH })
  })

  it('lands the new project at the end of the drilled-in folder', async () => {
    useProjectStore.getState().setActiveFolderId(folderId)

    await confirmTrustAndOpen()

    const state = useProjectStore.getState()
    expect(state.pendingTrustPath).toBeNull()
    expect(state.projectFolders[0]?.projectPaths).toEqual(['/b', NEW_PATH])
  })

  it('keeps a top-level import ungrouped', async () => {
    await confirmTrustAndOpen()

    const state = useProjectStore.getState()
    expect(state.projectFolders[0]?.projectPaths).toEqual(['/b'])
    const grouped = new Set(
      state.projectFolders.flatMap(folder => folder.projectPaths)
    )
    expect(grouped.has(NEW_PATH)).toBe(false)
  })

  it('persists trust list and folders in a single save', async () => {
    useProjectStore.getState().setActiveFolderId(folderId)

    await confirmTrustAndOpen()

    const state = useProjectStore.getState()
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          recentProjects: state.trustedPaths,
          projectFolders: state.projectFolders,
        })
      )
    })
  })
})
