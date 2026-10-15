import { beforeEach, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { seedCreationDraft } from '@/test/creation-files'
import { useCreationStore } from './creation-store'
import { useCreationFilesStore } from './creation-files-store'

const change = {
  id: 'change-1',
  path: 'server.js',
  beforeText: 'original',
  afterText: 'edited',
  beforeVersion: 'v1',
  afterVersion: 'v2',
}
beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'first',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationFilesStore.getState().clear()
  seedCreationDraft('server.js', 'original', 'v1')
})
it('saves a reviewed draft with its read version and undoes exactly that successful change', async () => {
  useCreationFilesStore.getState().edit('server.js', 'edited')
  vi.mocked(commands.saveCreationFileChange).mockResolvedValueOnce({
    status: 'ok',
    data: change,
  })
  await useCreationFilesStore
    .getState()
    .saveReviewed('server.js', 'original', 'edited', 'v1', 'first')
  expect(commands.saveCreationFileChange).toHaveBeenCalledWith(
    'first',
    'server.js',
    'edited',
    'v1'
  )
  expect(useCreationFilesStore.getState().lastChange).toEqual(change)
  vi.mocked(commands.undoCreationFileChange).mockResolvedValueOnce({
    status: 'ok',
    data: { kind: 'text', text: 'original', version: 'v1' },
  })
  await useCreationFilesStore.getState().undoChange('first', 'change-1')
  expect(commands.undoCreationFileChange).toHaveBeenCalledWith(
    'first',
    'change-1'
  )
  expect(useCreationFilesStore.getState().drafts['server.js']).toMatchObject({
    text: 'original',
    diskText: 'original',
    diskVersion: 'v1',
  })
  expect(useCreationFilesStore.getState().lastChange).toBeNull()
})

it('refuses a reviewed submission if typing changes the captured candidate', async () => {
  const store = useCreationFilesStore.getState()
  store.edit('server.js', 'edited')
  store.edit('server.js', 'newer draft')
  expect(
    await store.saveReviewed('server.js', 'original', 'edited', 'v1', 'first')
  ).toBe(false)
  expect(commands.saveCreationFileChange).not.toHaveBeenCalled()
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'newer draft'
  )
})
it('refuses a reviewed candidate belonging to a different project even when draft bytes match', async () => {
  useCreationFilesStore.getState().edit('server.js', 'edited')
  expect(
    await useCreationFilesStore
      .getState()
      .saveReviewed('server.js', 'original', 'edited', 'v1', 'old-project')
  ).toBe(false)
  expect(commands.saveCreationFileChange).not.toHaveBeenCalled()
})

it('protects unsaved work from undo and ignores late save results after a project switch', async () => {
  const store = useCreationFilesStore.getState()
  store.edit('server.js', 'edited')
  vi.mocked(commands.saveCreationFileChange).mockResolvedValueOnce({
    status: 'ok',
    data: change,
  })
  await store.saveReviewed('server.js', 'original', 'edited', 'v1', 'first')
  store.edit('server.js', 'new unsaved work')
  await store.undoChange('first', 'change-1')
  expect(commands.undoCreationFileChange).not.toHaveBeenCalled()
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'new unsaved work'
  )
  expect(useCreationFilesStore.getState().changeError?.code).toBe(
    'versionConflict'
  )

  useCreationFilesStore.getState().clear()
  seedCreationDraft('server.js', 'original', 'v1')
  store.edit('server.js', 'edited')
  let resolve!: (
    value: Awaited<ReturnType<typeof commands.saveCreationFileChange>>
  ) => void
  vi.mocked(commands.saveCreationFileChange).mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done
      })
  )
  const pending = store.saveReviewed(
    'server.js',
    'original',
    'edited',
    'v1',
    'first'
  )
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'second',
        root: '/second',
        name: 'Second',
        source: 'folder',
      },
      files: [],
    },
  })
  seedCreationDraft('server.js', 'new workspace', 'second-version')
  resolve({ status: 'ok', data: change })
  expect(await pending).toBe(false)
  expect(useCreationFilesStore.getState().lastChange).toBeNull()
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'new workspace'
  )
})
it('preserves typing made while undo was already dispatched', async () => {
  useCreationFilesStore.getState().edit('server.js', 'edited')
  vi.mocked(commands.saveCreationFileChange).mockResolvedValueOnce({
    status: 'ok',
    data: change,
  })
  await useCreationFilesStore
    .getState()
    .saveReviewed('server.js', 'original', 'edited', 'v1', 'first')
  let resolve!: (
    value: Awaited<ReturnType<typeof commands.undoCreationFileChange>>
  ) => void
  vi.mocked(commands.undoCreationFileChange).mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done
      })
  )
  const undoing = useCreationFilesStore
    .getState()
    .undoChange('first', 'change-1')
  useCreationFilesStore.getState().edit('server.js', 'typing during undo')
  resolve({
    status: 'ok',
    data: { kind: 'text', text: 'original', version: 'v1' },
  })
  await undoing
  expect(useCreationFilesStore.getState().drafts['server.js']).toMatchObject({
    text: 'typing during undo',
    diskText: 'original',
    saving: false,
  })
  expect(useCreationFilesStore.getState().changeBusy).toBe(false)
})
it('reports refused writes and refuses read-only sources without submitting changes', async () => {
  useCreationFilesStore.getState().edit('server.js', 'edited')
  vi.mocked(commands.saveCreationFileChange).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'versionConflict', detail: 'external edit' },
  })
  expect(
    await useCreationFilesStore
      .getState()
      .saveReviewed('server.js', 'original', 'edited', 'v1', 'first')
  ).toBe(false)
  expect(useCreationFilesStore.getState().lastChange).toBeNull()
  expect(useCreationFilesStore.getState().drafts['server.js']).toMatchObject({
    text: 'edited',
    diskText: 'original',
    saving: false,
  })
  vi.mocked(commands.saveCreationFileChange).mockClear()
  const workspace = useCreationStore.getState().workspace
  if (!workspace) throw new Error('Missing test workspace')
  useCreationStore.setState({
    workspace: {
      ...workspace,
      project: { ...workspace.project, source: 'bundle' },
    },
  })
  expect(
    await useCreationFilesStore
      .getState()
      .saveReviewed('server.js', 'original', 'edited', 'v1', 'first')
  ).toBe(false)
  expect(commands.saveCreationFileChange).not.toHaveBeenCalled()
})

it('keeps a refused undo reviewable and ignores an undo reply after explicit workspace cleanup', async () => {
  useCreationFilesStore.getState().edit('server.js', 'edited')
  vi.mocked(commands.saveCreationFileChange).mockResolvedValueOnce({
    status: 'ok',
    data: change,
  })
  await useCreationFilesStore
    .getState()
    .saveReviewed('server.js', 'original', 'edited', 'v1', 'first')
  vi.mocked(commands.undoCreationFileChange).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'versionConflict', detail: 'external work' },
  })
  await useCreationFilesStore.getState().undoChange('first', 'change-1')
  expect(useCreationFilesStore.getState().lastChange).toEqual(change)
  expect(useCreationFilesStore.getState().changeError?.detail).toBe(
    'external work'
  )
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'edited'
  )
  let resolve!: (
    value: Awaited<ReturnType<typeof commands.undoCreationFileChange>>
  ) => void
  vi.mocked(commands.undoCreationFileChange).mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done
      })
  )
  const pending = useCreationFilesStore
    .getState()
    .undoChange('first', 'change-1')
  useCreationFilesStore.getState().clear()
  seedCreationDraft('server.js', 'replacement draft', 'v3')
  resolve({
    status: 'ok',
    data: { kind: 'text', text: 'original', version: 'v1' },
  })
  await pending
  expect(useCreationFilesStore.getState().lastChange).toBeNull()
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'replacement draft'
  )
  expect(useCreationFilesStore.getState().changeBusy).toBe(false)
})
