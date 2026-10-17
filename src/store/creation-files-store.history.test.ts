import { beforeEach, expect, it, vi } from 'vitest'
import { commands, type GitHistoryFile } from '@/lib/tauri-bindings'
import { seedCreationDraft } from '@/test/creation-files'
import { useCreationStore } from './creation-store'
import { useCreationFilesStore } from './creation-files-store'

const source: GitHistoryFile = {
  commit: 'old',
  path: 'server.js',
  historicalText: 'historical\n',
  historicalSize: 11,
  savedText: 'saved\n',
  diskVersion: 'disk-now',
  loadable: true,
  reason: null,
}
beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'score',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [{ path: 'server.js', size: 6, kind: 'text', category: 'system' }],
    },
  })
  useCreationFilesStore.getState().clear()
  vi.mocked(commands.loadCreationGitHistoryText).mockResolvedValue({
    status: 'ok',
    data: source,
  })
})
it('loads only the confirmed draft and retains the current disk version for explicit save', async () => {
  seedCreationDraft('server.js', 'saved\n', 'disk-now')
  useCreationFilesStore.getState().edit('server.js', 'my draft')
  expect(
    await useCreationFilesStore
      .getState()
      .loadHistory('score', source, undefined)
  ).not.toBeNull()
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'my draft'
  )
  const captured = useCreationFilesStore.getState().drafts['server.js']
  expect(
    await useCreationFilesStore
      .getState()
      .loadHistory('score', source, captured)
  ).toBeNull()
  expect(useCreationFilesStore.getState().drafts['server.js']).toMatchObject({
    text: 'historical\n',
    diskText: 'saved\n',
    diskVersion: 'disk-now',
  })
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  vi.mocked(commands.saveCreationFile).mockResolvedValue({
    status: 'error',
    error: { code: 'versionConflict', detail: 'External disk change' },
  })
  await useCreationFilesStore.getState().save('server.js')
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'historical\n'
  )
  expect(commands.saveCreationFile).toHaveBeenCalledWith(
    'score',
    'server.js',
    'historical\n',
    'disk-now'
  )
})

it('ignores a late history load after editing or switching projects', async () => {
  for (const change of ['edit', 'switch']) {
    seedCreationDraft('server.js', 'saved\n', 'disk-now')
    const draft = useCreationFilesStore.getState().drafts['server.js']
    let complete!: (
      value: Awaited<ReturnType<typeof commands.loadCreationGitHistoryText>>
    ) => void
    vi.mocked(commands.loadCreationGitHistoryText).mockReturnValueOnce(
      new Promise(resolve => {
        complete = resolve
      })
    )
    const loading = useCreationFilesStore
      .getState()
      .loadHistory('score', source, draft)
    if (change === 'edit')
      useCreationFilesStore.getState().edit('server.js', 'newer draft')
    else
      useCreationStore.setState({
        workspace: {
          project: {
            identity: 'other',
            root: '/other',
            name: 'Other',
            source: 'folder',
          },
          files: [],
        },
      })
    complete({ status: 'ok', data: source })
    expect(await loading).not.toBeNull()
    expect(useCreationFilesStore.getState().drafts['server.js']?.text).not.toBe(
      'historical\n'
    )
  }
})
