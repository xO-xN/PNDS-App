import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commands, type CreationContent } from '@/lib/tauri-bindings'
import { useCreationStore } from './creation-store'
import { useCreationFilesStore, isDraftDirty } from './creation-files-store'

type ReadResult = Awaited<ReturnType<typeof commands.readCreationFile>>
type PollResult = Awaited<ReturnType<typeof commands.pollCreationChanges>>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const file = {
  path: 'server.js',
  kind: 'text' as const,
  category: 'system' as const,
  size: 5,
}
const workspace = {
  project: {
    identity: 'file-project',
    root: '/files',
    name: 'Files',
    source: 'folder' as const,
  },
  files: [file],
}
const text = (value: string, version: string): ReadResult => ({
  status: 'ok',
  data: { kind: 'text', text: value, version },
})

describe('project file reads and commits through one interface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCreationStore.setState({ workspace: null })
    useCreationStore.setState({ workspace })
    vi.mocked(commands.readCreationFile)
      .mockReset()
      .mockResolvedValue(text('saved', 'v1'))
    vi.mocked(commands.saveCreationFile)
      .mockReset()
      .mockResolvedValue({ status: 'ok', data: 'v2' })
    vi.mocked(commands.renameCreationFile)
      .mockReset()
      .mockResolvedValue({ status: 'ok', data: 'new.js' })
    vi.mocked(commands.pollCreationChanges)
      .mockReset()
      .mockResolvedValue({
        status: 'ok',
        data: { files: workspace.files, changed: [], revision: 0 },
      })
    vi.mocked(commands.listCreationFiles)
      .mockReset()
      .mockResolvedValue({ status: 'ok', data: [file] })
  })

  it('reads a versioned draft, reopens unsaved text, and retains typing made while saving', async () => {
    const files = useCreationFilesStore.getState()
    await files.read('file-project', file.path)
    files.edit(file.path, 'submitted')
    expect(await files.read('file-project', file.path)).toEqual(
      text('submitted', 'v1')
    )
    expect(commands.readCreationFile).toHaveBeenCalledTimes(1)
    const saved =
      deferred<Awaited<ReturnType<typeof commands.saveCreationFile>>>()
    vi.mocked(commands.saveCreationFile).mockReturnValueOnce(saved.promise)
    const saving = files.save(file.path)
    files.edit(file.path, 'typed during save')
    saved.resolve({ status: 'ok', data: 'v2' })
    await saving
    const draft = useCreationFilesStore.getState().drafts[file.path]
    expect(draft).toMatchObject({
      text: 'typed during save',
      diskText: 'submitted',
      diskVersion: 'v2',
      saving: false,
    })
    if (!draft) throw new Error('Expected the opened draft')
    expect(isDraftDirty(draft)).toBe(true)
    expect(commands.saveCreationFile).toHaveBeenCalledWith(
      'file-project',
      file.path,
      'submitted',
      'v1'
    )
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('ignores a superseded first read after a newer read has been edited and saved', async () => {
    const older = deferred<ReadResult>()
    vi.mocked(commands.readCreationFile).mockReturnValueOnce(older.promise)
    const files = useCreationFilesStore.getState()
    const reading = files.read('file-project', file.path)
    await files.read('file-project', file.path)
    files.edit(file.path, 'new edit')
    await files.save(file.path)
    older.resolve(text('old reply', 'old-version'))
    expect(await reading).toBeNull()
    expect(useCreationFilesStore.getState().drafts[file.path]).toMatchObject({
      text: 'new edit',
      diskText: 'new edit',
      diskVersion: 'v2',
      saving: false,
    })
  })

  it('rereads a first reply when the watcher changed that file before a draft existed', async () => {
    const older = deferred<ReadResult>()
    vi.mocked(commands.readCreationFile)
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(text('external edit', 'v3'))
    const files = useCreationFilesStore.getState()
    const reading = files.read('file-project', file.path)
    vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
      status: 'ok',
      data: { files: [file], changed: [file.path], revision: 1 },
    })
    expect(await files.poll()).toBe(true)
    older.resolve(text('before external edit', 'v1'))
    expect(await reading).toEqual(text('external edit', 'v3'))
    expect(useCreationFilesStore.getState().drafts[file.path]).toMatchObject({
      text: 'external edit',
      diskText: 'external edit',
      diskVersion: 'v3',
    })
    expect(commands.readCreationFile).toHaveBeenCalledTimes(2)
  })

  it.each(['reply', 'rejection'] as const)(
    'drops an old-project read %s and does not seed the new workspace',
    async kind => {
      const older = deferred<ReadResult>()
      vi.mocked(commands.readCreationFile).mockReturnValueOnce(older.promise)
      const reading = useCreationFilesStore
        .getState()
        .read('file-project', file.path)
      useCreationStore.setState({
        workspace: {
          ...workspace,
          project: { ...workspace.project, identity: 'next-project' },
        },
      })
      if (kind === 'reply') older.resolve(text('old contents', 'old-version'))
      else older.reject(new Error('old transport failure'))
      expect(await reading).toBeNull()
      expect(useCreationFilesStore.getState().drafts).toEqual({})
      expect(
        await useCreationFilesStore.getState().read('file-project', file.path)
      ).toBeNull()
      expect(commands.readCreationFile).toHaveBeenCalledTimes(1)
    }
  )

  it('revokes pending operations even when a cleared workspace keeps the same identity', async () => {
    const older = deferred<ReadResult>()
    vi.mocked(commands.readCreationFile).mockReturnValueOnce(older.promise)
    const reading = useCreationFilesStore
      .getState()
      .read('file-project', file.path)
    useCreationFilesStore.getState().clear()
    await useCreationFilesStore.getState().read('file-project', file.path)
    older.resolve(text('stale contents', 'old-version'))
    expect(await reading).toBeNull()
    expect(useCreationFilesStore.getState().drafts[file.path]?.text).toBe(
      'saved'
    )
  })

  it.each(['bundle', 'utility', 'readOnlyFolder'] as const)(
    'keeps a %s text read as a preview without creating a draft',
    async source => {
      useCreationStore.setState({
        workspace: { ...workspace, project: { ...workspace.project, source } },
      })
      expect(
        await useCreationFilesStore.getState().read('file-project', file.path)
      ).toEqual(text('saved', 'v1'))
      expect(useCreationFilesStore.getState().drafts).toEqual({})
      await useCreationFilesStore.getState().save(file.path)
      expect(commands.saveCreationFile).not.toHaveBeenCalled()
    }
  )

  it.each([
    { kind: 'image', url: 'data:image/png;base64,AA==' },
    { kind: 'binary' },
  ] satisfies CreationContent[])(
    'returns a $kind preview without seeding an editable text draft',
    async content => {
      vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
        status: 'ok',
        data: content,
      })
      expect(
        await useCreationFilesStore.getState().read('file-project', file.path)
      ).toEqual({ status: 'ok', data: content })
      expect(useCreationFilesStore.getState().drafts).toEqual({})
    }
  )

  it('reports a failed read and allows a later successful retry', async () => {
    vi.mocked(commands.readCreationFile).mockRejectedValueOnce(
      new Error('read failed')
    )
    expect(
      await useCreationFilesStore.getState().read('file-project', file.path)
    ).toEqual({ status: 'error', error: { code: 'io', detail: 'read failed' } })
    expect(useCreationFilesStore.getState().drafts).toEqual({})
    expect(
      await useCreationFilesStore.getState().read('file-project', file.path)
    ).toEqual(text('saved', 'v1'))
  })

  it('replays a watcher batch blocked by a save and keeps newer typing as a conflict', async () => {
    const files = useCreationFilesStore.getState()
    await files.read('file-project', file.path)
    files.edit(file.path, 'submitted')
    const saved =
      deferred<Awaited<ReturnType<typeof commands.saveCreationFile>>>()
    vi.mocked(commands.saveCreationFile).mockReturnValueOnce(saved.promise)
    const saving = files.save(file.path)
    files.edit(file.path, 'new typing')
    vi.mocked(commands.pollCreationChanges).mockResolvedValue({
      status: 'ok',
      data: { files: [file], changed: [file.path], revision: 3 },
    })
    expect(await files.poll()).toBe(false)
    expect(useCreationFilesStore.getState().diskRevision).toBe(0)
    saved.resolve({ status: 'ok', data: 'v2' })
    await saving
    vi.mocked(commands.readCreationFile).mockResolvedValueOnce(
      text('external contents', 'v3')
    )
    expect(await files.poll()).toBe(true)
    expect(useCreationFilesStore.getState().diskRevision).toBe(3)
    expect(useCreationFilesStore.getState().drafts[file.path]).toMatchObject({
      text: 'new typing',
      diskText: 'submitted',
      conflict: { text: 'external contents', version: 'v3' },
    })
  })

  it('deduplicates polls and keeps the new request owned after a same-identity reset', async () => {
    const older = deferred<PollResult>()
    const newer = deferred<PollResult>()
    vi.mocked(commands.pollCreationChanges)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
    const files = useCreationFilesStore.getState()
    const first = files.poll()
    expect(files.poll()).toBe(first)
    files.clear()
    const next = files.poll()
    older.resolve({
      status: 'ok',
      data: { files: [file], changed: [file.path], revision: 2 },
    })
    expect(await first).toBe(false)
    expect(files.poll()).toBe(next)
    expect(commands.pollCreationChanges).toHaveBeenCalledTimes(2)
    newer.resolve({
      status: 'ok',
      data: { files: [file], changed: [], revision: 0 },
    })
    expect(await next).toBe(true)
    expect(useCreationFilesStore.getState().revision).toBe(0)
  })

  it('rejects a watcher directory reply overtaken by a completed rename and replays its revision', async () => {
    const files = useCreationFilesStore.getState()
    await files.read('file-project', file.path)
    const poll = deferred<PollResult>()
    vi.mocked(commands.pollCreationChanges).mockReturnValueOnce(poll.promise)
    const polling = files.poll()
    const renamed = { ...file, path: 'new.js' }
    vi.mocked(commands.listCreationFiles).mockResolvedValueOnce({
      status: 'ok',
      data: [renamed],
    })
    await files.rename(file.path, renamed.path)
    poll.resolve({
      status: 'ok',
      data: { files: [file], changed: [file.path], revision: 1 },
    })
    expect(await polling).toBe(false)
    expect(useCreationStore.getState().workspace?.files).toEqual([renamed])
    expect(useCreationFilesStore.getState().diskRevision).toBe(0)
    vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
      status: 'ok',
      data: {
        files: [renamed],
        changed: [file.path, renamed.path],
        revision: 1,
      },
    })
    expect(await files.poll()).toBe(true)
    expect(useCreationFilesStore.getState().diskRevision).toBe(1)
    expect(useCreationFilesStore.getState().drafts[file.path]).toBeUndefined()
    expect(useCreationFilesStore.getState().drafts[renamed.path]?.text).toBe(
      'saved'
    )
  })

  it('rejects a rename directory reply overtaken by a newer watcher commit', async () => {
    const files = useCreationFilesStore.getState()
    await files.read('file-project', file.path)
    const listed =
      deferred<Awaited<ReturnType<typeof commands.listCreationFiles>>>()
    vi.mocked(commands.listCreationFiles).mockReturnValueOnce(listed.promise)
    const renaming = files.rename(file.path, 'new.js')
    // The list starts only after the backend has returned the canonical destination.
    await vi.waitFor(() =>
      expect(commands.listCreationFiles).toHaveBeenCalled()
    )
    const renamed = { ...file, path: 'new.js' }
    const added = { ...file, path: 'added.js' }
    vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
      status: 'ok',
      data: {
        files: [renamed, added],
        changed: [renamed.path, added.path],
        revision: 1,
      },
    })
    expect(await files.poll()).toBe(true)
    listed.resolve({ status: 'ok', data: [renamed] })
    await renaming
    expect(useCreationStore.getState().workspace?.files).toEqual([
      renamed,
      added,
    ])
  })
})
