import { beforeEach, describe, expect, it, vi } from 'vitest'
import { confirm } from '@tauri-apps/plugin-dialog'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from './creation-store'
import {
  creationDraftsParticipant,
  isDraftDirty,
  selectUnsavedCount,
  useCreationDraftsStore,
} from './creation-drafts-store'
import {
  registerCreationParticipant,
  creationUnsavedCount,
} from '@/lib/creation-lifecycle'

function draftOf(path: string) {
  const draft = useCreationDraftsStore.getState().drafts[path]
  if (!draft) throw new Error(`missing draft: ${path}`)
  return draft
}

const first = {
  project: {
    identity: 'first',
    root: '/draft',
    name: 'Draft',
    source: 'folder' as const,
  },
  files: [
    {
      path: 'server.js',
      kind: 'text' as const,
      category: 'system' as const,
      size: 5,
    },
  ],
}

describe('creation drafts (#154)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCreationStore.setState({
      active: true,
      workspace: first,
      opening: false,
      request: null,
      error: null,
      modePhase: 'idle',
    })
    useCreationDraftsStore.setState({
      drafts: {},
      activePath: null,
      renameNote: null,
      dismissedConflict: null,
    })
  })

  it('edits mark a draft dirty and saving writes only the current file with the read version', async () => {
    const store = useCreationDraftsStore.getState()
    store.loaded('server.js', 'original', 'v1')
    store.edit('server.js', 'edited')
    const draft = draftOf('server.js')
    expect(isDraftDirty(draft)).toBe(true)
    expect(selectUnsavedCount(useCreationDraftsStore.getState())).toBe(1)
    vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
      status: 'ok',
      data: 'v2',
    })
    await useCreationDraftsStore.getState().save('server.js')
    expect(commands.saveCreationFile).toHaveBeenCalledWith(
      'first',
      'server.js',
      'edited',
      'v1'
    )
    const saved = draftOf('server.js')
    expect(saved).toMatchObject({
      text: 'edited',
      diskText: 'edited',
      diskVersion: 'v2',
      conflict: null,
    })
    expect(isDraftDirty(saved)).toBe(false)
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('keeps the draft and fetches the disk version when an external change refuses the save', async () => {
    useCreationDraftsStore.getState().loaded('server.js', 'mine', 'v1')
    useCreationDraftsStore.getState().edit('server.js', 'mine edited')
    vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
      status: 'error',
      error: { code: 'versionConflict', detail: 'server.js' },
    })
    vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
      status: 'ok',
      data: { kind: 'text', text: 'external agent text', version: 'v2' },
    })
    await useCreationDraftsStore.getState().save('server.js')
    const conflicted = useCreationDraftsStore.getState().drafts['server.js']
    expect(conflicted).toMatchObject({
      text: 'mine edited',
      conflict: { text: 'external agent text', version: 'v2' },
    })

    // Reverting adopts the displayed disk version and clears the conflict.
    useCreationDraftsStore.getState().revert('server.js')
    expect(useCreationDraftsStore.getState().drafts['server.js']).toMatchObject(
      {
        text: 'external agent text',
        diskVersion: 'v2',
        conflict: null,
      }
    )

    // An explicit overwrite binds to the displayed conflict version…
    useCreationDraftsStore.getState().edit('server.js', 'mine again')
    vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
      status: 'error',
      error: { code: 'versionConflict', detail: 'server.js' },
    })
    vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
      status: 'ok',
      data: { kind: 'text', text: 'newer external', version: 'v3' },
    })
    await useCreationDraftsStore.getState().save('server.js')
    const rebound = useCreationDraftsStore.getState().drafts['server.js']
    expect(rebound?.conflict).toEqual({
      text: 'newer external',
      version: 'v3',
    })
    // …and a disk that changed again refuses that overwrite too.
    expect(commands.saveCreationFile).toHaveBeenLastCalledWith(
      'first',
      'server.js',
      'mine again',
      'v2'
    )
    vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
      status: 'ok',
      data: 'v4',
    })
    await useCreationDraftsStore.getState().save('server.js', 'v3')
    expect(
      useCreationDraftsStore.getState().drafts['server.js']?.conflict
    ).toBeNull()
  })

  it('a conflicted save without an explicit overwrite opens the choice instead of writing', async () => {
    useCreationDraftsStore.getState().loaded('server.js', 'mine', 'v1')
    useCreationDraftsStore.getState().edit('server.js', 'mine edited')
    vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
      status: 'error',
      error: { code: 'versionConflict', detail: 'server.js' },
    })
    vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
      status: 'ok',
      data: { kind: 'text', text: 'external', version: 'v2' },
    })
    await useCreationDraftsStore.getState().save('server.js')
    expect(vi.mocked(commands.saveCreationFile)).toHaveBeenCalledTimes(1)
    // Dismissing the choice hides it; the draft and conflict survive.
    useCreationDraftsStore.getState().dismissConflict('server.js')
    expect(useCreationDraftsStore.getState().dismissedConflict).toEqual({
      path: 'server.js',
      version: 'v2',
    })
    // The ⌘S path re-arms the choice rather than writing through it.
    await useCreationDraftsStore.getState().save('server.js')
    expect(vi.mocked(commands.saveCreationFile)).toHaveBeenCalledTimes(1)
    expect(useCreationDraftsStore.getState().dismissedConflict).toBeNull()
  })

  it('reloads a clean draft from disk to adopt external changes without a conflict', async () => {
    useCreationDraftsStore.getState().loaded('server.js', 'old contents', 'v1')
    vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
      status: 'ok',
      data: { kind: 'text', text: 'new disk contents', version: 'v2' },
    })
    await useCreationDraftsStore.getState().reload('server.js')
    expect(useCreationDraftsStore.getState().drafts['server.js']).toMatchObject(
      {
        text: 'new disk contents',
        diskText: 'new disk contents',
        diskVersion: 'v2',
        conflict: null,
      }
    )
    // A dirty draft is never silently replaced by a reload.
    vi.mocked(commands.readCreationFile).mockClear()
    useCreationDraftsStore.getState().edit('server.js', 'my edit')
    await useCreationDraftsStore.getState().reload('server.js')
    expect(commands.readCreationFile).not.toHaveBeenCalled()
    expect(useCreationDraftsStore.getState().drafts['server.js']?.text).toBe(
      'my edit'
    )
  })

  it('a late save returning after a project switch cannot touch the new workspace', async () => {
    useCreationDraftsStore.getState().loaded('server.js', 'draft', 'v1')
    useCreationDraftsStore.getState().edit('server.js', 'draft edited')
    let resolveSave!: (result: { status: 'ok'; data: string }) => void
    vi.mocked(commands.saveCreationFile).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveSave = resolve
        })
    )
    const saving = useCreationDraftsStore.getState().save('server.js')
    // The switch succeeds while the save is in flight: drafts of the old
    // identity are cleared and the new workspace owns the store.
    useCreationStore.setState({
      workspace: {
        project: { ...first.project, identity: 'second' },
        files: [],
      },
    })
    expect(useCreationDraftsStore.getState().drafts).toEqual({})
    resolveSave({ status: 'ok', data: 'late' })
    await saving
    expect(useCreationDraftsStore.getState().drafts).toEqual({})
  })

  it('renames move the draft and refresh the tree through the trusted identity', async () => {
    useCreationDraftsStore.getState().loaded('server.js', 'draft', 'v1')
    useCreationDraftsStore.getState().edit('server.js', 'draft edited')
    useCreationDraftsStore.getState().setActivePath('server.js')
    vi.mocked(commands.renameCreationFile).mockResolvedValueOnce({
      status: 'ok',
      data: 'renamed/server.js',
    })
    vi.mocked(commands.listCreationFiles).mockResolvedValueOnce({
      status: 'ok',
      data: [
        {
          path: 'renamed/server.js',
          kind: 'text',
          category: 'system',
          size: 12,
        },
      ],
    })
    const failure = await useCreationDraftsStore
      .getState()
      .rename('server.js', 'renamed/server.js')
    expect(failure).toBeNull()
    const state = useCreationDraftsStore.getState()
    expect(state.drafts['server.js']).toBeUndefined()
    expect(state.drafts['renamed/server.js']).toMatchObject({
      text: 'draft edited',
    })
    expect(state.activePath).toBe('renamed/server.js')
    expect(state.renameNote).toBe('renamed/server.js')
    expect(useCreationStore.getState().workspace?.files).toEqual([
      {
        path: 'renamed/server.js',
        kind: 'text',
        category: 'system',
        size: 12,
      },
    ])
    // Existing targets read as readable failures instead of overwrites.
    vi.mocked(commands.renameCreationFile).mockResolvedValueOnce({
      status: 'error',
      error: { code: 'targetExists', detail: 'taken.js' },
    })
    const rejected = await useCreationDraftsStore
      .getState()
      .rename('renamed/server.js', 'taken.js')
    expect(rejected).toMatchObject({ code: 'targetExists' })
    expect(
      useCreationDraftsStore.getState().drafts['renamed/server.js']
    ).toBeDefined()
  })

  it('feeds the lifecycle count and switching asks once, keeping drafts on cancel', async () => {
    const unregister = registerCreationParticipant({
      hasUnsavedChanges: () => true,
    })
    expect(creationUnsavedCount()).toBe(1)
    unregister()
    expect(creationUnsavedCount()).toBe(0)

    // The real drafts participant drives the project-switch gate through
    // the store's open() flow: cancelling keeps the drafts.
    useCreationDraftsStore.getState().loaded('server.js', 'draft', 'v1')
    useCreationDraftsStore.getState().edit('server.js', 'draft edited')
    const unregisterDrafts = registerCreationParticipant(
      creationDraftsParticipant
    )
    vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: {
        project: { ...first.project, identity: 'next' },
        files: [],
      },
    })
    vi.mocked(confirm).mockResolvedValueOnce(false)
    const cancelled = await useCreationStore.getState().open('/next')
    expect(cancelled).toBe(false)
    expect(commands.commitCreationProject).not.toHaveBeenCalled()
    expect(useCreationDraftsStore.getState().drafts['server.js']?.text).toBe(
      'draft edited'
    )
    expect(useCreationStore.getState().workspace).toEqual(first)

    vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: {
        project: { ...first.project, identity: 'next' },
        files: [],
      },
    })
    vi.mocked(confirm).mockResolvedValueOnce(true)
    const switched = await useCreationStore.getState().open('/next')
    expect(switched).toBe(true)
    expect(confirm).toHaveBeenCalledTimes(2)
    // A successful switch wipes the old drafts and errors.
    expect(useCreationDraftsStore.getState().drafts).toEqual({})
    unregisterDrafts()
  })
})
