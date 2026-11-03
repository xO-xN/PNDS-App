import { beforeEach, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { seedCreationDraft } from '@/test/creation-files'
import { useCreationStore } from './creation-store'
import {
  creationDraftsParticipant,
  useCreationFilesStore,
} from './creation-files-store'

const workspace = {
  project: {
    identity: 'quit-drafts',
    root: '/quit-drafts',
    name: 'Quit drafts',
    source: 'folder' as const,
  },
  files: ['first.js', 'second.js'].map(path => ({
    path,
    kind: 'text' as const,
    category: 'system' as const,
    size: 5,
  })),
}

beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({ workspace: null })
  useCreationStore.setState({ workspace })
  for (const { path } of workspace.files) {
    seedCreationDraft(path, 'saved', 'v1')
    useCreationFilesStore.getState().edit(path, `edited ${path}`)
  }
  vi.mocked(commands.saveCreationFile)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: 'v2' })
})

it('saves all unsaved file drafts before permitting quit', async () => {
  expect(await creationDraftsParticipant.save?.()).toBe(true)
  expect(
    vi.mocked(commands.saveCreationFile).mock.calls.map(call => call[1])
  ).toEqual(['first.js', 'second.js'])
  expect(creationDraftsParticipant.hasUnsavedChanges?.()).toBe(false)
})

it.each(['conflict', 'diskChanged', 'saving', 'renaming'] as const)(
  'keeps all drafts when a %s blocks saving for quit',
  async condition => {
    const state = useCreationFilesStore.getState()
    const draft = state.drafts['second.js']
    if (!draft) throw new Error('Expected the second file draft')
    useCreationFilesStore.setState({
      drafts: {
        ...state.drafts,
        'second.js': {
          ...draft,
          [condition]:
            condition === 'conflict'
              ? { text: 'external', version: 'v3' }
              : true,
        },
      },
    })
    expect(await creationDraftsParticipant.save?.()).toBe(false)
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
    expect(useCreationFilesStore.getState().drafts['first.js']?.text).toBe(
      'edited first.js'
    )
  }
)

it('keeps successful saves and stops later drafts after a partial failure', async () => {
  seedCreationDraft('third.js', 'saved', 'v1')
  useCreationFilesStore.getState().edit('third.js', 'edited third.js')
  vi.mocked(commands.saveCreationFile)
    .mockResolvedValueOnce({ status: 'ok', data: 'v2' })
    .mockResolvedValueOnce({
      status: 'error',
      error: { code: 'io', detail: 'disk unavailable' },
    })
  expect(await creationDraftsParticipant.save?.()).toBe(false)
  expect(commands.saveCreationFile).toHaveBeenCalledTimes(2)
  expect(useCreationFilesStore.getState().drafts['first.js']?.diskText).toBe(
    'edited first.js'
  )
  expect(useCreationFilesStore.getState().drafts['second.js']?.text).toBe(
    'edited second.js'
  )
  expect(useCreationFilesStore.getState().drafts['third.js']?.diskText).toBe(
    'saved'
  )
})

it.each(['workspace switch', 'clear', 'typing', 'new draft'] as const)(
  'refuses quit after %s while saving',
  async change => {
    let resolveSave!: (
      result: Awaited<ReturnType<typeof commands.saveCreationFile>>
    ) => void
    vi.mocked(commands.saveCreationFile).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveSave = resolve
        })
    )
    const saving = creationDraftsParticipant.save?.()
    expect(commands.saveCreationFile).toHaveBeenCalledTimes(1)
    if (change === 'workspace switch')
      useCreationStore.setState({
        workspace: {
          ...workspace,
          project: { ...workspace.project, identity: 'next-project' },
        },
      })
    else if (change === 'clear') useCreationFilesStore.getState().clear()
    else if (change === 'typing')
      useCreationFilesStore.getState().edit('first.js', 'typed during save')
    else {
      seedCreationDraft('third.js', 'saved', 'v1')
      useCreationFilesStore.getState().edit('third.js', 'new draft during save')
    }
    resolveSave({ status: 'ok', data: 'v2' })
    expect(await saving).toBe(false)
    expect(commands.saveCreationFile).toHaveBeenCalledTimes(
      change === 'new draft' ? 2 : 1
    )
    if (change === 'typing')
      expect(useCreationFilesStore.getState().drafts['first.js']?.text).toBe(
        'typed during save'
      )
    if (change === 'new draft')
      expect(useCreationFilesStore.getState().drafts['third.js']?.text).toBe(
        'new draft during save'
      )
  }
)
