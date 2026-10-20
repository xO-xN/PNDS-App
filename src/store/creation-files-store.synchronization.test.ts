import { beforeEach, expect, it, vi } from 'vitest'
import { commands, type CreationWorkspace } from '@/lib/tauri-bindings'
import { seedCreationDraft } from '@/test/creation-files'
import { useCreationFilesStore } from './creation-files-store'
import { useCreationStore } from './creation-store'
import { useSessionStore } from './session-store'

const workspace: CreationWorkspace = {
  project: {
    identity: 'sync',
    root: '/score',
    name: 'Score',
    source: 'folder',
  },
  files: [
    { path: 'manifest.json', kind: 'text', category: 'system', size: 2 },
    { path: 'server.js', kind: 'text', category: 'system', size: 10 },
    { path: 'public/page.js', kind: 'text', category: 'pages', size: 10 },
  ],
}
type Changes = Extract<
  Awaited<ReturnType<typeof commands.pollCreationChanges>>,
  { status: 'ok' }
>['data']
function changes(
  changeRevisions: Record<string, number>,
  revision = 1
): Changes {
  return {
    files: workspace.files,
    changed: Object.keys(changeRevisions),
    changeRevisions,
    revision,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
function setSaving(saving: boolean) {
  const draft = useCreationFilesStore.getState().drafts['server.js']
  if (!draft) throw new Error('Missing server draft')
  useCreationFilesStore.setState(state => ({
    drafts: { ...state.drafts, 'server.js': { ...draft, saving } },
  }))
}
beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({ workspace })
  useCreationFilesStore.getState().clear()
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/score',
  })
  vi.mocked(commands.pollCreationChanges)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: changes({}, 0) })
  vi.mocked(commands.readCreationFile)
    .mockReset()
    .mockResolvedValue({
      status: 'ok',
      data: { kind: 'text', text: 'saved text', version: 'saved-v2' },
    })
})

it('marks only actual saved paths and leaves revisions and runtime prompts unchanged for a no-op', async () => {
  const files = useCreationFilesStore.getState()
  vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
    status: 'ok',
    data: changes({ 'manifest.json': 1 }),
  })
  expect(await files.synchronizeSaved('sync')).toBe(true)
  const manifest =
    useCreationFilesStore.getState().fileRevisions['manifest.json']
  expect(manifest).toBeGreaterThan(0)
  files.complete(
    { identity: 'sync', revision: useCreationFilesStore.getState().revision },
    'restart'
  )
  vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
    status: 'ok',
    data: changes({ 'public/page.js': 2 }, 2),
  })
  expect(await files.synchronizeSaved('sync')).toBe(true)
  expect(useCreationFilesStore.getState().fileRevisions['manifest.json']).toBe(
    manifest
  )
  expect(useCreationFilesStore.getState().pending.restart).toBe(0)
  expect(useCreationFilesStore.getState().pending.refresh).toBeGreaterThan(0)
  const revision = useCreationFilesStore.getState().revision
  vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
    status: 'ok',
    data: changes({}, 2),
  })
  expect(await files.synchronizeSaved('sync')).toBe(true)
  expect(useCreationFilesStore.getState().revision).toBe(revision)
  expect(commands.startProject).not.toHaveBeenCalled()
})

it('retries incomplete batches without republishing old paths when a new path joins the batch', async () => {
  seedCreationDraft('server.js', 'original', 'v1')
  setSaving(true)
  vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
    status: 'ok',
    data: changes({ 'manifest.json': 1, 'server.js': 1 }),
  })
  const files = useCreationFilesStore.getState()
  expect(await files.synchronizeSaved('sync')).toBe(false)
  expect(useCreationFilesStore.getState().diskRevision).toBe(0)
  const first = useCreationFilesStore.getState().fileRevisions
  setSaving(false)
  vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
    status: 'ok',
    data: changes(
      { 'manifest.json': 1, 'server.js': 1, 'public/page.js': 2 },
      2
    ),
  })
  expect(await files.synchronizeSaved('sync')).toBe(true)
  expect(useCreationFilesStore.getState().fileRevisions).toMatchObject(first)
  expect(
    useCreationFilesStore.getState().fileRevisions['public/page.js']
  ).toBeGreaterThan(first['server.js'] ?? 0)
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'saved text'
  )
  expect(useCreationFilesStore.getState().diskRevision).toBe(2)
})

it('drains a scan captured before saving and then requires a newly dispatched scan', async () => {
  const old =
    deferred<Awaited<ReturnType<typeof commands.pollCreationChanges>>>()
  vi.mocked(commands.pollCreationChanges).mockReturnValueOnce(old.promise)
  const files = useCreationFilesStore.getState()
  const previous = files.poll()
  const saved = files.synchronizeSaved('sync')
  expect(commands.pollCreationChanges).toHaveBeenCalledOnce()
  vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
    status: 'ok',
    data: changes({ 'public/page.js': 1 }),
  })
  old.resolve({ status: 'ok', data: changes({}, 0) })
  await previous
  expect(await saved).toBe(true)
  expect(commands.pollCreationChanges).toHaveBeenCalledTimes(2)
  expect(useCreationFilesStore.getState().fileRevisions['public/page.js']).toBe(
    1
  )
})

it('preserves creator typing while adopting a saved baseline as a conflict', async () => {
  seedCreationDraft('public/page.js', 'original', 'v1')
  useCreationFilesStore.getState().edit('public/page.js', 'creator typing')
  vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
    status: 'ok',
    data: changes({ 'public/page.js': 1 }),
  })
  expect(await useCreationFilesStore.getState().synchronizeSaved('sync')).toBe(
    true
  )
  expect(
    useCreationFilesStore.getState().drafts['public/page.js']
  ).toMatchObject({
    text: 'creator typing',
    diskText: 'original',
    conflict: { text: 'saved text', version: 'saved-v2' },
  })
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})

it('keeps a failed source read unacknowledged and retries it without raising revision again', async () => {
  seedCreationDraft('server.js', 'original', 'v1')
  vi.mocked(commands.pollCreationChanges).mockResolvedValue({
    status: 'ok',
    data: changes({ 'server.js': 1 }),
  })
  vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'permission', detail: 'read unavailable' },
  })
  expect(await useCreationFilesStore.getState().synchronizeSaved('sync')).toBe(
    false
  )
  expect(useCreationFilesStore.getState().diskRevision).toBe(0)
  const revision = useCreationFilesStore.getState().revision
  expect(await useCreationFilesStore.getState().synchronizeSaved('sync')).toBe(
    true
  )
  expect(useCreationFilesStore.getState().diskRevision).toBe(1)
  expect(useCreationFilesStore.getState().revision).toBe(revision)
})

it('retains a recoverable draft after a saved deletion and removes the file from the tree', async () => {
  seedCreationDraft('server.js', 'original', 'v1')
  vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...changes({ 'server.js': 1 }),
      files: workspace.files.filter(file => file.path !== 'server.js'),
    },
  })
  vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'missing', detail: 'server.js' },
  })
  expect(await useCreationFilesStore.getState().synchronizeSaved('sync')).toBe(
    true
  )
  expect(
    useCreationStore
      .getState()
      .workspace?.files.some(file => file.path === 'server.js')
  ).toBe(false)
  expect(useCreationFilesStore.getState().drafts['server.js']).toMatchObject({
    text: 'original',
    diskChanged: true,
  })
})

it('never syncs or publishes into a replacement workspace after an old scan returns', async () => {
  const old =
    deferred<Awaited<ReturnType<typeof commands.pollCreationChanges>>>()
  vi.mocked(commands.pollCreationChanges).mockReturnValueOnce(old.promise)
  const pending = useCreationFilesStore.getState().synchronizeSaved('sync')
  useCreationStore.setState({
    workspace: {
      ...workspace,
      project: { ...workspace.project, identity: 'next' },
    },
  })
  old.resolve({ status: 'ok', data: changes({ 'manifest.json': 1 }) })
  expect(await pending).toBe(false)
  expect(useCreationFilesStore.getState().revision).toBe(0)
  expect(useCreationFilesStore.getState().error).toBeNull()
  expect(commands.pollCreationChanges).toHaveBeenCalledOnce()
})
