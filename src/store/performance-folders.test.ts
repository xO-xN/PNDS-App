import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commands, type AppPreferences } from '@/lib/tauri-bindings'
import { loadPreferences, updatePreferences } from '@/lib/preferences'
import { useProjectStore, UTILITIES_FOLDER_ID } from './project-store'

beforeEach(() => {
  vi.clearAllMocks()
  useProjectStore.setState({
    currentProject: null,
    recentProjectPaths: [],
    projectFolders: [],
    utilityPaths: ['/tool-a', '/tool-b'],
    activeFolderId: null,
    lastUserFolderId: null,
    renameTarget: null,
  })
})

describe('performance folder persistence (#153)', () => {
  it('restores all legacy folders, then queues structural and unrelated preferences without clobbering', async () => {
    let disk = {
      theme: 'system',
      colorTheme: 'pond',
      language: 'en',
      hubToken: 'private-test-token',
      sampleRate: 48000,
      recentProjects: ['/one', '/two', '/tool-a', '/tool-b'],
      projectFolders: [
        { id: 'a', name: 'Opening', projectPaths: ['/one'] },
        {
          id: 'b',
          name: 'Middle',
          projectPaths: ['/two'],
          intro: 'Keep this intro',
        },
        { id: 'c', name: 'Third', projectPaths: [] },
        { id: 'd', name: 'Fourth', projectPaths: [] },
        { id: 'e', name: 'Fifth', projectPaths: [] },
        {
          id: UTILITIES_FOLDER_ID,
          name: 'Utilities',
          projectPaths: ['/tool-a', '/tool-b'],
        },
      ],
    } as unknown as AppPreferences
    vi.mocked(commands.loadPreferences).mockImplementation(async () => ({
      status: 'ok',
      data: structuredClone(disk),
    }))
    vi.mocked(commands.savePreferences).mockImplementation(async prefs => {
      await Promise.resolve()
      disk = structuredClone(prefs)
      return { status: 'ok', data: null }
    })
    const legacy = await loadPreferences()
    if (!legacy?.recentProjects || !legacy.projectFolders)
      throw new Error('Expected persisted project index')
    useProjectStore
      .getState()
      .restoreProjectIndex(legacy.recentProjects, legacy.projectFolders)
    const store = useProjectStore.getState()
    expect(store.projectFolders).toHaveLength(6)
    const id = store.createFolder('Encore')
    if (id === null) throw new Error('Expected unlimited folder creation')
    store.renameFolder('a', 'Opening renamed')
    store.setFolderIntro('a', 'Tour notes')
    store.moveProjectToFolder('c', '/one')
    store.applyFolderReorder(['e', 'a', 'c', 'b', 'd', id, UTILITIES_FOLDER_ID])
    // These overlap the fire-and-forget structural saves and fence their queue.
    await Promise.all([
      updatePreferences({ colorTheme: 'stage' }),
      updatePreferences({ language: 'zh-CN', sampleRate: 96000 }),
    ])
    const restored = await loadPreferences()
    if (!restored || !restored.projectFolders)
      throw new Error('Expected saved folders')
    expect(restored).toMatchObject({
      language: 'zh-CN',
      colorTheme: 'stage',
      sampleRate: 96000,
      hubToken: 'private-test-token',
    })
    expect(restored.projectFolders.map(folder => folder.id)).toEqual([
      'e',
      'a',
      'c',
      'b',
      'd',
      id,
      UTILITIES_FOLDER_ID,
    ])
    expect(
      restored.projectFolders.find(folder => folder.id === 'a')
    ).toMatchObject({
      name: 'Opening renamed',
      intro: 'Tour notes',
      projectPaths: [],
    })
    expect(
      restored.projectFolders.find(folder => folder.id === 'b')
    ).toMatchObject({ intro: 'Keep this intro', projectPaths: ['/two'] })
    expect(
      restored.projectFolders.find(folder => folder.id === 'c')?.projectPaths
    ).toEqual(['/one'])
    expect(restored.projectFolders.at(-1)?.projectPaths).toEqual([
      '/tool-a',
      '/tool-b',
    ])
    expect(commands.savePreferences).toHaveBeenCalledTimes(7)
  })

  it('user actions cannot move, reorder, rename or remove registered tools', () => {
    useProjectStore.getState().restoreProjectIndex(
      ['/one', '/tool-a', '/tool-b'],
      [
        { id: 'a', name: 'Opening', projectPaths: ['/one'] },
        {
          id: UTILITIES_FOLDER_ID,
          name: 'Utilities',
          projectPaths: ['/tool-a', '/tool-b'],
        },
      ]
    )
    const before = useProjectStore.getState().projectFolders
    const store = useProjectStore.getState()
    expect(store.moveProjectToFolder('a', '/tool-a')).toBe(false)
    expect(store.moveProjectToFolder(UTILITIES_FOLDER_ID, '/one')).toBe(false)
    store.removeProjectFromFolder(UTILITIES_FOLDER_ID, '/tool-a')
    store.removeRecentProject('/tool-a')
    expect(store.renameFolder(UTILITIES_FOLDER_ID, 'Renamed')).toBe(false)
    store.setFolderIntro(UTILITIES_FOLDER_ID, 'User intro')
    store.deleteFolder(UTILITIES_FOLDER_ID)
    store.setActiveFolderId(UTILITIES_FOLDER_ID)
    store.applyVisibleReorder(['/tool-b', '/tool-a'])
    expect(useProjectStore.getState().projectFolders).toEqual(before)
    expect(useProjectStore.getState().recentProjectPaths).toEqual([
      '/one',
      '/tool-a',
      '/tool-b',
    ])
  })
})
