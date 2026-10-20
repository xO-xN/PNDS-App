import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { commands, type GitRecordPreview } from './tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import {
  useCreationFilesStore,
  type CreationDraft,
} from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { useAssistantStore } from '@/store/assistant-store'
import { useParameterPreviewStore } from '@/store/parameter-preview-store'
import {
  saveGitVersion,
  switchGitVersion,
  endGitTask,
} from './creation-git-workflow'
import { stopAndReset } from './open-project'
import type * as Preferences from './preferences'
import type * as OpenProject from './open-project'
vi.mock('./preferences', async importOriginal => ({
  ...(await importOriginal<typeof Preferences>()),
  loadPreferences: vi
    .fn()
    .mockResolvedValue({ gitName: 'Author', gitEmail: '' }),
}))
vi.mock('./open-project', async importOriginal => ({
  ...(await importOriginal<typeof OpenProject>()),
  stopAndReset: vi.fn(),
}))
const draft = (text = 'edited'): CreationDraft => ({
  text,
  diskText: 'base',
  diskVersion: 'base-v',
  conflict: null,
  saving: false,
  renaming: false,
  diskChanged: false,
  error: null,
})
const preview: GitRecordPreview = {
  token: 'save',
  initial: false,
  branch: 'main',
  head: 'a',
  name: 'Creator',
  email: 'creator@pnds.local',
  files: [
    {
      path: 'server.js',
      status: 'modified',
      size: 6,
      defaultSelected: true,
      staged: false,
      exclusion: null,
    },
  ],
}
beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'git',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationFilesStore.getState().clear()
  useSessionStore.setState({ sessionStatus: 'idle', commandPending: false })
  useAssistantStore.setState({
    phase: 'idle',
    paused: false,
    canContinue: false,
    resumeRestored: false,
  })
  vi.spyOn(useCreationFilesStore.getState(), 'poll').mockResolvedValue(true)
  vi.spyOn(
    useCreationFilesStore.getState(),
    'synchronizeSaved'
  ).mockResolvedValue(true)
  vi.spyOn(useParameterPreviewStore.getState(), 'end').mockResolvedValue(true)
  vi.mocked(commands.previewCreationGitRecord).mockResolvedValue({
    status: 'ok',
    data: preview,
  })
  vi.mocked(commands.confirmCreationGitVersion).mockResolvedValue({
    status: 'ok',
    data: {
      commit: 'b',
      message: 'saved',
      paths: ['server.js'],
      warning: null,
    },
  })
  vi.mocked(commands.previewCreationGitSwitch).mockResolvedValue({
    status: 'ok',
    data: {
      token: 'switch',
      commit: 'a',
      paths: ['server.js'],
      discardedPaths: [],
    },
  })
  vi.mocked(commands.confirmCreationGitSwitch).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  vi.mocked(stopAndReset).mockImplementation(async () => {
    useSessionStore.setState({ sessionStatus: 'idle' })
  })
})
afterEach(() => vi.restoreAllMocks())
it('saves all drafts before recording while leaving runtime and assistant state alone', async () => {
  useCreationFilesStore.setState({
    drafts: { 'server.js': draft(), 'style.css': draft('size') },
  })
  const writes: string[] = []
  vi.spyOn(useCreationFilesStore.getState(), 'save').mockImplementation(
    async path => {
      writes.push(path)
      const current = useCreationFilesStore.getState().drafts[path]
      if (!current) throw new Error('Missing draft')
      useCreationFilesStore.setState(state => ({
        drafts: {
          ...state.drafts,
          [path]: { ...current, diskText: current.text },
        },
      }))
    }
  )
  vi.mocked(commands.previewCreationGitRecord).mockImplementation(async () => {
    expect(writes).toEqual(['server.js', 'style.css'])
    return { status: 'ok', data: preview }
  })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/score',
  })
  const result = await saveGitVersion('git', '', 'A new route')
  expect(result.receipt?.commit).toBe('b')
  expect(commands.confirmCreationGitVersion).toHaveBeenCalledWith(
    'git',
    'save',
    expect.objectContaining({
      paths: ['server.js'],
      name: 'Author',
      message: expect.stringContaining('Project version'),
    }),
    'A new route'
  )
  expect(useSessionStore.getState().sessionStatus).toBe('ready')
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(stopAndReset).not.toHaveBeenCalled()
})
it('preserves conflicts and stops before any draft or Git write', async () => {
  useCreationFilesStore.setState({
    drafts: {
      'server.js': {
        ...draft(),
        conflict: { text: 'outside', version: 'outside' },
      },
    },
  })
  const save = vi.spyOn(useCreationFilesStore.getState(), 'save')
  await expect(saveGitVersion('git', 'Name', '')).rejects.toThrow()
  expect(save).not.toHaveBeenCalled()
  expect(commands.previewCreationGitRecord).not.toHaveBeenCalled()
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'edited'
  )
})
it('reports a partial draft save without recording or pretending earlier saves rolled back', async () => {
  useCreationFilesStore.setState({
    drafts: { 'server.js': draft(), 'bad.js': draft() },
  })
  vi.spyOn(useCreationFilesStore.getState(), 'save').mockImplementation(
    async path => {
      if (path === 'server.js')
        useCreationFilesStore.setState(state => ({
          drafts: {
            ...state.drafts,
            [path]: { ...(state.drafts[path] ?? draft()), diskText: 'edited' },
          },
        }))
    }
  )
  await expect(saveGitVersion('git', 'Name', '')).rejects.toThrow()
  expect(useCreationFilesStore.getState().drafts['server.js']?.diskText).toBe(
    'edited'
  )
  expect(commands.previewCreationGitRecord).not.toHaveBeenCalled()
})
it('preserves external staging and avoids duplicate commits for unchanged files', async () => {
  vi.mocked(commands.previewCreationGitRecord).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...preview,
      files: [
        {
          ...(preview.files[0] ?? {
            path: 'server.js',
            size: 6,
            status: 'modified' as const,
            exclusion: null,
          }),
          staged: true,
          defaultSelected: false,
        },
      ],
    },
  })
  await expect(saveGitVersion('git', 'Name', '')).rejects.toThrow()
  expect(commands.confirmCreationGitVersion).not.toHaveBeenCalled()
  vi.mocked(commands.previewCreationGitRecord).mockResolvedValueOnce({
    status: 'ok',
    data: { ...preview, files: [] },
  })
  expect((await saveGitVersion('git', '', '')).receipt).toBeNull()
  expect(commands.confirmCreationGitVersion).not.toHaveBeenCalled()
})
it('ends the assistant explicitly and preserves its chat history', async () => {
  useAssistantStore.setState({
    phase: 'idle',
    canContinue: true,
    messages: [
      {
        id: 'chat',
        role: 'user',
        text: 'Goal',
        status: 'completed',
        scope: 'project',
        sources: [],
      },
    ],
  })
  vi.spyOn(useAssistantStore.getState(), 'persistHistory').mockResolvedValue(
    undefined
  )
  await endGitTask('git')
  expect(commands.endCreationGitAssistantTask).toHaveBeenCalledWith('git')
  expect(useAssistantStore.getState().canContinue).toBe(false)
  expect(useAssistantStore.getState().messages[0]?.text).toBe('Goal')
})
it('refuses unfinished tasks before stopping runtime or switching code', async () => {
  useAssistantStore.setState({ canContinue: true })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/score',
  })
  await expect(switchGitVersion('git', 'a', false)).rejects.toThrow()
  expect(stopAndReset).not.toHaveBeenCalled()
  expect(commands.previewCreationGitSwitch).not.toHaveBeenCalled()
})
it('requires successful stop before native switching and leaves the project stopped', async () => {
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/score',
  })
  vi.mocked(stopAndReset).mockRejectedValueOnce(new Error('Stop failed'))
  await expect(switchGitVersion('git', 'a', false)).rejects.toThrow(
    'Stop failed'
  )
  expect(commands.previewCreationGitSwitch).not.toHaveBeenCalled()
  expect((await switchGitVersion('git', 'a', false)).synchronized).toBe(true)
  expect(useSessionStore.getState().sessionStatus).toBe('idle')
  expect(commands.startProject).not.toHaveBeenCalled()
})
it('keeps drafts until a switch succeeds and never discards a newer edit', async () => {
  const original = draft()
  useCreationFilesStore.setState({ drafts: { 'server.js': original } })
  vi.mocked(commands.confirmCreationGitSwitch).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'versionConflict', detail: 'Changed' },
  })
  await expect(switchGitVersion('git', 'a', true)).rejects.toMatchObject({
    code: 'versionConflict',
  })
  expect(useCreationFilesStore.getState().drafts['server.js']).toBe(original)
  const newer = draft('newer')
  vi.mocked(commands.confirmCreationGitSwitch).mockImplementationOnce(
    async () => {
      useCreationFilesStore.setState({ drafts: { 'server.js': newer } })
      return { status: 'ok', data: null }
    }
  )
  await switchGitVersion('git', 'a', true)
  expect(useCreationFilesStore.getState().drafts['server.js']).toBe(newer)
})

it.each([true, false])(
  'drops captured clean editor copies replaced by version restoration (discard: %s)',
  async discard => {
    const savedNewFile = { ...draft('new code'), diskText: 'new code' }
    const ignoredFile = {
      ...draft('private fixture'),
      diskText: 'private fixture',
    }
    useCreationFilesStore.setState({
      drafts: { 'new.js': savedNewFile, 'ignored.txt': ignoredFile },
    })
    vi.mocked(commands.previewCreationGitSwitch).mockResolvedValueOnce({
      status: 'ok',
      data: {
        token: 'restore-current',
        commit: 'a',
        paths: ['new.js'],
        discardedPaths: discard ? ['new.js'] : [],
      },
    })
    await switchGitVersion('git', 'a', discard)
    expect(useCreationFilesStore.getState().drafts['new.js']).toBeUndefined()
    expect(useCreationFilesStore.getState().drafts['ignored.txt']).toBe(
      ignoredFile
    )
  }
)
it('does not write a new workspace after ownership changes during preview', async () => {
  vi.mocked(commands.previewCreationGitRecord).mockImplementationOnce(
    async () => {
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
      return { status: 'ok', data: preview }
    }
  )
  await expect(saveGitVersion('git', 'Name', '')).rejects.toThrow()
  expect(commands.confirmCreationGitVersion).not.toHaveBeenCalled()
})

it('switches to a named branch through the same runtime and draft protections', async () => {
  vi.mocked(commands.previewCreationGitBranchSwitch).mockResolvedValueOnce({
    status: 'ok',
    data: {
      token: 'branch-switch',
      commit: 'a',
      paths: [],
      discardedPaths: [],
    },
  })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/score',
  })
  await switchGitVersion('git', 'a', false, 'experiment')
  expect(stopAndReset).toHaveBeenCalledOnce()
  expect(commands.previewCreationGitBranchSwitch).toHaveBeenCalledWith(
    'git',
    'experiment',
    'a',
    false
  )
  expect(commands.previewCreationGitSwitch).not.toHaveBeenCalled()
  expect(commands.confirmCreationGitSwitch).toHaveBeenCalledWith(
    'git',
    'branch-switch'
  )
  expect(commands.startProject).not.toHaveBeenCalled()
})
