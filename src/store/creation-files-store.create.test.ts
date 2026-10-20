import { beforeEach, expect, it, vi } from 'vitest'
import { commands, type CreationFile } from '@/lib/tauri-bindings'
import { useCreationStore } from './creation-store'
import { useCreationFilesStore } from './creation-files-store'
import { seedCreationDraft } from '@/test/creation-files'

const file: CreationFile = {
  path: 'public/Grid.js',
  size: 0,
  kind: 'text',
  category: 'pages',
}
const workspace = {
  project: {
    identity: 'create-first',
    root: '/score',
    name: 'Score',
    source: 'folder' as const,
  },
  files: [],
}

beforeEach(() => {
  useCreationFilesStore.getState().clear()
  useCreationStore.setState({ workspace, active: true })
  vi.mocked(commands.createCreationFile)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: file })
})

it('creates and selects a text file without dropping another draft', async () => {
  seedCreationDraft('server.js', 'saved', 'v1')
  useCreationFilesStore.getState().edit('server.js', 'keep my edits')
  await expect(
    useCreationFilesStore.getState().create(file.path)
  ).resolves.toEqual({ status: 'ok', data: file })
  expect(commands.createCreationFile).toHaveBeenCalledWith(
    'create-first',
    file.path,
    ['server.js']
  )
  expect(useCreationStore.getState().workspace?.files).toEqual([file])
  expect(useCreationFilesStore.getState().activePath).toBe(file.path)
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'keep my edits'
  )
  expect(useCreationFilesStore.getState().creating).toBe(false)
})

it('refuses a recoverable draft and read-only source before native creation', async () => {
  seedCreationDraft(file.path, 'recover this', 'old')
  await expect(
    useCreationFilesStore.getState().create(file.path)
  ).resolves.toMatchObject({ status: 'error', error: { code: 'targetExists' } })
  expect(commands.createCreationFile).not.toHaveBeenCalled()
  useCreationStore.setState({
    workspace: {
      ...workspace,
      project: { ...workspace.project, source: 'bundle' },
    },
  })
  await expect(
    useCreationFilesStore.getState().create('another.js')
  ).resolves.toMatchObject({ status: 'error', error: { code: 'permission' } })
  expect(commands.createCreationFile).not.toHaveBeenCalled()
})

it('ignores a late creation result after switching away and back and prevents duplicate creation', async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof commands.createCreationFile>>
  ) => void
  vi.mocked(commands.createCreationFile).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const creating = useCreationFilesStore.getState().create(file.path)
  await expect(
    useCreationFilesStore.getState().create(file.path)
  ).resolves.toBeNull()
  useCreationStore.setState({ workspace: null })
  useCreationStore.setState({ workspace })
  finish({ status: 'ok', data: file })
  await expect(creating).resolves.toBeNull()
  expect(useCreationStore.getState().workspace?.files).toEqual([])
  expect(useCreationFilesStore.getState().activePath).toBeNull()
  expect(useCreationFilesStore.getState().creating).toBe(false)
  expect(commands.createCreationFile).toHaveBeenCalledOnce()
})

it('retains the directory and releases busy state on native or transport failure', async () => {
  vi.mocked(commands.createCreationFile).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'targetExists', detail: file.path },
  })
  await expect(
    useCreationFilesStore.getState().create(file.path)
  ).resolves.toMatchObject({ status: 'error', error: { code: 'targetExists' } })
  vi.mocked(commands.createCreationFile).mockRejectedValueOnce(
    new Error('offline')
  )
  await expect(
    useCreationFilesStore.getState().create(file.path)
  ).resolves.toMatchObject({ status: 'error', error: { code: 'io' } })
  expect(useCreationStore.getState().workspace?.files).toEqual([])
  expect(useCreationFilesStore.getState().creating).toBe(false)
})

it('finishes creation when a watcher exposes the file and another reader opens it before the native reply', async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof commands.createCreationFile>>
  ) => void
  vi.mocked(commands.createCreationFile).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const creating = useCreationFilesStore.getState().create(file.path)
  vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: { kind: 'text', text: 'fresh external content', version: 'v2' },
  })
  await useCreationFilesStore
    .getState()
    .read(workspace.project.identity, file.path)
  const observedFile = { ...file, size: 22 }
  useCreationStore.setState({
    workspace: { ...workspace, files: [observedFile] },
  })
  finish({ status: 'ok', data: file })
  await expect(creating).resolves.toMatchObject({ status: 'ok' })
  expect(useCreationFilesStore.getState().creating).toBe(false)
  expect(useCreationFilesStore.getState().drafts[file.path]?.text).toBe(
    'fresh external content'
  )
  expect(useCreationStore.getState().workspace?.files).toEqual([observedFile])
})

it('creates an empty directory through native validation, updates inventory and retains drafts', async () => {
  seedCreationDraft('server.js', 'base', 'v1')
  useCreationFilesStore.getState().edit('server.js', 'draft')
  vi.mocked(commands.createCreationDirectory).mockResolvedValueOnce({
    status: 'ok',
    data: 'public/new',
  })
  vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
    status: 'ok',
    data: {
      files: [],
      changed: [],
      revision: 0,
      directories: ['public', 'public/new'],
    },
  })
  await expect(
    useCreationFilesStore.getState().createDirectory('public/new')
  ).resolves.toEqual({ status: 'ok', data: 'public/new' })
  expect(commands.createCreationDirectory).toHaveBeenCalledWith(
    'create-first',
    'public/new',
    ['server.js']
  )
  expect(useCreationStore.getState().workspace?.directories).toEqual([
    'public',
    'public/new',
  ])
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'draft'
  )
  expect(useCreationFilesStore.getState().activePath).toBeNull()
})
it('ignores a late directory creation after leaving the workspace', async () => {
  let resolve!: (
    result: Awaited<ReturnType<typeof commands.createCreationDirectory>>
  ) => void
  vi.mocked(commands.createCreationDirectory).mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done
      })
  )
  const creating = useCreationFilesStore.getState().createDirectory('empty')
  await expect(
    useCreationFilesStore.getState().create('another.js')
  ).resolves.toBeNull()
  useCreationStore.setState({ workspace: null })
  useCreationStore.setState({ workspace })
  resolve({ status: 'ok', data: 'empty' })
  await expect(creating).resolves.toBeNull()
  expect(useCreationStore.getState().workspace?.directories).toBeUndefined()
  expect(useCreationFilesStore.getState().creating).toBe(false)
})
