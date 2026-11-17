import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import {
  commands,
  type GitRecordPreview,
  type GithubUpdateReceipt,
  type SessionSnapshot,
} from './tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import {
  useCreationFilesStore,
  type CreationDraft,
} from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { useAssistantStore } from '@/store/assistant-store'
import { useParameterPreviewStore } from '@/store/parameter-preview-store'
import i18n from '@/i18n/config'
import {
  saveGitVersion,
  switchGitVersion,
  prepareGitVersionSwitch,
  confirmPreparedGitSwitch,
  endGitTask,
  renameGitVersion,
  updateGitVersion,
} from './creation-git-workflow'
import { stopAndReset } from './open-project'
import type * as Preferences from './preferences'
import type * as OpenProject from './open-project'
import { clearAssistantResume } from './assistant-resume'
vi.mock('./preferences', async importOriginal => ({
  ...(await importOriginal<typeof Preferences>()),
  loadPreferences: vi.fn().mockResolvedValue({
    gitName: 'App Author',
    gitEmail: 'personal@example.com',
  }),
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
    epoch: 0,
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
  useSessionStore.setState({
    sessionStatus: 'idle',
    commandPending: false,
    latestSnapshot: null,
    runId: 0,
  })
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
    return true
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
    latestSnapshot: { runtimeGeneration: '11' } as SessionSnapshot,
  })
  const result = await saveGitVersion('git', '', 'A new route')
  expect(result.receipt?.commit).toBe('b')
  expect(commands.confirmCreationGitVersion).toHaveBeenCalledWith(
    'git',
    'save',
    expect.objectContaining({
      paths: ['server.js'],
      name: 'Creator',
      email: 'creator@pnds.local',
      message: '',
    }),
    'A new route'
  )
  expect(useSessionStore.getState().sessionStatus).toBe('ready')
  expect(commands.getCreationGitVersions).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(stopAndReset).not.toHaveBeenCalled()
})

it('uses the localized default and creator preferences for the first version', async () => {
  vi.mocked(commands.previewCreationGitRecord).mockResolvedValueOnce({
    status: 'ok',
    data: { ...preview, initial: true, head: null },
  })

  await saveGitVersion('git', '  ', '')

  expect(commands.confirmCreationGitVersion).toHaveBeenCalledWith(
    'git',
    'save',
    expect.objectContaining({
      name: 'App Author',
      email: 'personal@example.com',
      message: i18n.t('creation.versions.defaultName'),
    }),
    null
  )
  expect(commands.getCreationGitVersions).not.toHaveBeenCalled()
})

it('uses the project’s chosen GitHub noreply address for subsequent versions', async () => {
  vi.mocked(commands.previewCreationGitRecord).mockResolvedValueOnce({
    status: 'ok',
    data: { ...preview, email: '123+composer@users.noreply.github.com' },
  })
  await saveGitVersion('git', '  Next version  ', '')
  expect(commands.confirmCreationGitVersion).toHaveBeenCalledWith(
    'git',
    'save',
    expect.objectContaining({
      email: '123+composer@users.noreply.github.com',
      message: 'Next version',
    }),
    null
  )
})

it('reports save stages only when the preceding real operation has completed', async () => {
  let finishPreview!: (
    value: Awaited<ReturnType<typeof commands.previewCreationGitRecord>>
  ) => void
  vi.mocked(commands.previewCreationGitRecord).mockReturnValue(
    new Promise(resolve => {
      finishPreview = resolve
    })
  )
  const progress = vi.fn()
  const saving = saveGitVersion('git', 'Named version', '', progress)
  await vi.waitFor(() =>
    expect(commands.previewCreationGitRecord).toHaveBeenCalled()
  )
  expect(progress.mock.calls.map(call => call[0])).toEqual([
    'saving',
    'checking',
  ])
  expect(commands.confirmCreationGitVersion).not.toHaveBeenCalled()
  finishPreview({ status: 'ok', data: preview })
  await saving
  expect(progress.mock.calls.map(call => call[0])).toEqual([
    'saving',
    'checking',
    'recording',
  ])
})

it('reports synchronization only after the native switch is confirmed', async () => {
  let finishSwitch!: (
    value: Awaited<ReturnType<typeof commands.confirmCreationGitSwitch>>
  ) => void
  vi.mocked(commands.confirmCreationGitSwitch).mockReturnValue(
    new Promise(resolve => {
      finishSwitch = resolve
    })
  )
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/score',
    latestSnapshot: { runtimeGeneration: '11' } as SessionSnapshot,
  })
  const progress = vi.fn()
  const switching = switchGitVersion('git', 'a', false, undefined, progress)
  await vi.waitFor(() =>
    expect(commands.confirmCreationGitSwitch).toHaveBeenCalled()
  )
  expect(progress.mock.calls.map(call => call[0])).toEqual([
    'stopping',
    'switching',
  ])
  expect(
    useCreationFilesStore.getState().synchronizeSaved
  ).not.toHaveBeenCalled()
  finishSwitch({ status: 'ok', data: null })
  const completed = await switching
  expect(completed.outcome).toBe('switched')
  expect(completed.needsSync).toBe(true)
  expect(progress.mock.calls.map(call => call[0])).toEqual([
    'stopping',
    'switching',
  ])
  await expect(completed.recover(async () => true, progress)).resolves.toBe(
    true
  )
  expect(progress.mock.calls.map(call => call[0])).toEqual([
    'stopping',
    'switching',
    'synchronizing',
    'refreshing',
  ])
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

it('keeps native recovery when queued task retirement failed instead of forcing Git task end', async () => {
  await expect(
    clearAssistantResume('git', 'old-task', async () => {
      throw new Error('final history publication failed')
    })
  ).rejects.toThrow('final history publication failed')
  await expect(endGitTask('git')).rejects.toThrow(
    'final history publication failed'
  )
  expect(commands.endCreationGitAssistantTask).not.toHaveBeenCalled()
})
it('refuses unfinished tasks before stopping runtime or switching code', async () => {
  useAssistantStore.setState({ canContinue: true })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/score',
    latestSnapshot: { runtimeGeneration: '11' } as SessionSnapshot,
  })
  await expect(switchGitVersion('git', 'a', false)).rejects.toThrow()
  expect(stopAndReset).not.toHaveBeenCalled()
  expect(commands.previewCreationGitSwitch).not.toHaveBeenCalled()
})
it('requires successful stop before native confirmation and leaves the project stopped', async () => {
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/score',
    latestSnapshot: { runtimeGeneration: '11' } as SessionSnapshot,
  })
  vi.mocked(stopAndReset).mockRejectedValueOnce(new Error('Stop failed'))
  await expect(switchGitVersion('git', 'a', false)).rejects.toThrow(
    'Stop failed'
  )
  expect(commands.previewCreationGitSwitch).toHaveBeenCalledOnce()
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  const completed = await switchGitVersion('git', 'a', false)
  await expect(completed.recover(async () => true)).resolves.toBe(true)
  expect(useSessionStore.getState().sessionStatus).toBe('idle')
  expect(stopAndReset).toHaveBeenLastCalledWith('11')
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
  const completed = await switchGitVersion('git', 'a', true)
  await completed.recover(async () => true)
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
    const completed = await switchGitVersion('git', 'a', discard)
    await completed.recover(async () => true)
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
    latestSnapshot: { runtimeGeneration: '11' } as SessionSnapshot,
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

it('does not stop a session that becomes ready after switching was confirmed', async () => {
  vi.spyOn(useParameterPreviewStore.getState(), 'end').mockImplementationOnce(
    async () => {
      useSessionStore.setState({
        sessionStatus: 'ready',
        sessionProjectPath: '/score',
        runId: 9,
      })
      return true
    }
  )
  await expect(switchGitVersion('git', 'a', false)).rejects.toThrow(/review/i)
  expect(stopAndReset).not.toHaveBeenCalled()
  expect(commands.previewCreationGitSwitch).toHaveBeenCalledOnce()
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  expect(useSessionStore.getState().sessionStatus).toBe('ready')
})

it('rechecks the runtime after the native switch preview and keeps the original route', async () => {
  vi.mocked(commands.previewCreationGitSwitch).mockImplementationOnce(
    async () => {
      useSessionStore.setState({
        sessionStatus: 'ready',
        sessionProjectPath: '/score',
        runId: 10,
      })
      return {
        status: 'ok',
        data: { token: 'switch', commit: 'a', paths: [], discardedPaths: [] },
      }
    }
  )
  await expect(switchGitVersion('git', 'a', false)).rejects.toThrow(/review/i)
  expect(stopAndReset).not.toHaveBeenCalled()
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
})

it('previews replacements with a running session and active task without any side effects, then confirms its exact token', async () => {
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/score',
    latestSnapshot: { runtimeGeneration: '11' } as SessionSnapshot,
  })
  useAssistantStore.setState({ phase: 'continuing' })
  vi.mocked(commands.previewCreationGitSwitch).mockResolvedValueOnce({
    status: 'ok',
    data: {
      token: 'explicit-reviewed',
      commit: 'a',
      paths: ['archive.log'],
      discardedPaths: [],
      overwrittenPaths: ['archive.log'],
    },
  })
  const prepared = await prepareGitVersionSwitch('git', 'a', true)
  expect(prepared.preview.overwrittenPaths).toEqual(['archive.log'])
  expect(stopAndReset).not.toHaveBeenCalled()
  expect(useParameterPreviewStore.getState().end).not.toHaveBeenCalled()
  expect(commands.endCreationGitAssistantTask).not.toHaveBeenCalled()
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  useAssistantStore.setState({ phase: 'idle' })
  await confirmPreparedGitSwitch(prepared)
  expect(commands.confirmCreationGitSwitch).toHaveBeenCalledExactlyOnceWith(
    'git',
    'explicit-reviewed'
  )
  expect(commands.previewCreationGitSwitch).toHaveBeenCalledOnce()
  expect(stopAndReset).toHaveBeenCalledExactlyOnceWith('11')
  await expect(confirmPreparedGitSwitch(prepared)).rejects.toThrow(
    i18n.t('creation.versions.switchExpired')
  )
  expect(commands.confirmCreationGitSwitch).toHaveBeenCalledOnce()
})

it('rejects a forged prepared handle and preserves newer drafts after a real preview', async () => {
  await expect(
    confirmPreparedGitSwitch({
      preview: { token: 'forged', commit: 'a', paths: [], discardedPaths: [] },
    })
  ).rejects.toThrow()
  const prepared = await prepareGitVersionSwitch('git', 'a', true)
  const newer = draft('created after review')
  useCreationFilesStore.setState({ drafts: { 'new.js': newer } })
  await expect(confirmPreparedGitSwitch(prepared)).rejects.toThrow(
    i18n.t('creation.versions.draftBlocked')
  )
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  expect(useCreationFilesStore.getState().drafts['new.js']).toBe(newer)
})

it('does not stop a replacement runtime or write another workspace from a pending reviewed token', async () => {
  const prepared = await prepareGitVersionSwitch('git', 'a', true)
  useSessionStore.setState({
    sessionStatus: 'ready',
    runId: 2,
    sessionProjectPath: '/score',
    latestSnapshot: { runtimeGeneration: 'new-run' } as SessionSnapshot,
  })
  await expect(confirmPreparedGitSwitch(prepared)).rejects.toThrow(
    i18n.t('creation.versions.runtimeChanged')
  )
  expect(stopAndReset).not.toHaveBeenCalled()
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
})

it('retains a confirmed checkout through synchronization and read failures, then coalesces recovery without replaying writes', async () => {
  const captured = draft()
  useCreationFilesStore.setState({ drafts: { 'server.js': captured } })
  const discard = vi.spyOn(
    useCreationFilesStore.getState(),
    'discardCheckoutCopies'
  )
  let finishSync!: (synchronized: boolean) => void
  const sync = vi
    .mocked(useCreationFilesStore.getState().synchronizeSaved)
    .mockRejectedValueOnce(new Error('File scan is unavailable'))
    .mockImplementationOnce(
      () =>
        new Promise<boolean>(resolve => {
          finishSync = resolve
        })
    )
  const reload = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
  const completed = await switchGitVersion('git', 'a', true)

  expect(completed.outcome).toBe('switched')
  expect(discard).not.toHaveBeenCalled()
  await expect(completed.recover(reload)).resolves.toBe(false)
  expect(completed.outcome).toBe('switched')
  expect(completed.needsSync).toBe(true)
  expect(completed.pending).toBe(true)
  expect(completed.error?.detail).toBe('File scan is unavailable')
  expect(reload).toHaveBeenCalledOnce()

  const retry = completed.recover(reload)
  const simultaneousRetry = completed.recover(reload)
  expect(simultaneousRetry).toBe(retry)
  await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(2))
  finishSync(true)
  await expect(retry).resolves.toBe(true)
  await expect(simultaneousRetry).resolves.toBe(true)
  expect(completed.needsSync).toBe(false)
  expect(completed.pending).toBe(false)
  expect(completed.error).toBeNull()
  await expect(completed.recover(reload)).resolves.toBe(true)
  expect(commands.confirmCreationGitSwitch).toHaveBeenCalledOnce()
  expect(commands.previewCreationGitSwitch).toHaveBeenCalledOnce()
  expect(discard).toHaveBeenCalledExactlyOnceWith(
    ['server.js'],
    { 'server.js': captured },
    true
  )
  expect(sync).toHaveBeenCalledTimes(2)
  expect(reload).toHaveBeenCalledTimes(2)
})

it('retries only reading when checkout synchronization already succeeded', async () => {
  const sync = vi.mocked(useCreationFilesStore.getState().synchronizeSaved)
  const discard = vi.spyOn(
    useCreationFilesStore.getState(),
    'discardCheckoutCopies'
  )
  const reload = vi
    .fn()
    .mockRejectedValueOnce(new Error('History is unavailable'))
    .mockResolvedValue(true)
  const completed = await switchGitVersion('git', 'a', false)
  await expect(completed.recover(reload)).resolves.toBe(false)
  expect(completed.needsSync).toBe(false)
  expect(completed.pending).toBe(true)
  expect(completed.error?.detail).toBe('History is unavailable')
  await expect(completed.recover(reload)).resolves.toBe(true)
  expect(completed.pending).toBe(false)
  expect(completed.error).toBeNull()
  expect(sync).toHaveBeenCalledOnce()
  expect(discard).toHaveBeenCalledOnce()
  expect(reload).toHaveBeenCalledTimes(2)
  expect(commands.confirmCreationGitSwitch).toHaveBeenCalledOnce()
})

it('preserves native completion when progress presentation throws and can recover the unfinished step', async () => {
  const completed = await switchGitVersion('git', 'a', false)
  const progress = vi.fn().mockImplementationOnce(() => {
    throw new Error('Presentation is unavailable')
  })
  const reload = vi.fn().mockResolvedValue(true)
  const sync = vi.mocked(useCreationFilesStore.getState().synchronizeSaved)
  await expect(completed.recover(reload, progress)).resolves.toBe(false)
  expect(completed.outcome).toBe('switched')
  expect(completed.error?.detail).toBe('Presentation is unavailable')
  expect(completed.needsSync).toBe(true)
  expect(sync).not.toHaveBeenCalled()
  await expect(completed.recover(reload, progress)).resolves.toBe(true)
  expect(sync).toHaveBeenCalledOnce()
  expect(reload).toHaveBeenCalledOnce()
  expect(commands.confirmCreationGitSwitch).toHaveBeenCalledOnce()
})

it('retains completion but permanently refuses follow-up work after workspace replacement during native confirmation', async () => {
  const originalWorkspace = useCreationStore.getState().workspace
  const captured = draft()
  useCreationFilesStore.setState({ drafts: { 'server.js': captured } })
  vi.mocked(commands.confirmCreationGitSwitch).mockImplementationOnce(
    async () => {
      useCreationStore.setState({
        workspace: {
          project: {
            identity: 'replacement',
            root: '/replacement',
            name: 'Replacement',
            source: 'folder',
          },
          files: [],
        },
      })
      return { status: 'ok', data: null }
    }
  )
  const discard = vi.spyOn(
    useCreationFilesStore.getState(),
    'discardCheckoutCopies'
  )
  const reload = vi.fn().mockResolvedValue(true)
  const completed = await switchGitVersion('git', 'a', true)
  expect(completed.outcome).toBe('switched')
  await expect(completed.recover(reload)).resolves.toBe(false)
  useCreationStore.setState({ workspace: originalWorkspace })
  const returnedDraft = draft('new workspace lifetime')
  useCreationFilesStore.setState({ drafts: { 'server.js': returnedDraft } })
  await expect(completed.recover(reload)).resolves.toBe(false)
  expect(discard).not.toHaveBeenCalled()
  expect(
    useCreationFilesStore.getState().synchronizeSaved
  ).not.toHaveBeenCalled()
  expect(reload).not.toHaveBeenCalled()
  expect(useCreationFilesStore.getState().drafts['server.js']).toBe(
    returnedDraft
  )
  expect(commands.confirmCreationGitSwitch).toHaveBeenCalledOnce()
})

it('stops recovery before reading or publishing when its owner changes during synchronization', async () => {
  const sync = vi
    .mocked(useCreationFilesStore.getState().synchronizeSaved)
    .mockImplementationOnce(async () => {
      useCreationStore.setState({ active: false })
      return true
    })
  const reload = vi.fn().mockResolvedValue(true)
  const completed = await switchGitVersion('git', 'a', false)
  await expect(completed.recover(reload)).resolves.toBe(false)
  expect(completed.outcome).toBe('switched')
  expect(reload).not.toHaveBeenCalled()
  useCreationStore.setState({ active: true })
  await expect(completed.recover(reload)).resolves.toBe(false)
  expect(sync).toHaveBeenCalledOnce()
  expect(commands.confirmCreationGitSwitch).toHaveBeenCalledOnce()
})

it('continues recovery after mode confirmation changes the epoch without replacing the workspace', async () => {
  const completed = await switchGitVersion('git', 'a', false)
  const reload = vi.fn().mockResolvedValue(true)
  useCreationStore.setState({ epoch: 1 })
  useCreationStore.setState({ epoch: 2 })
  await expect(completed.recover(reload)).resolves.toBe(true)
  expect(completed.outcome).toBe('switched')
  expect(reload).toHaveBeenCalledOnce()
  expect(
    useCreationFilesStore.getState().synchronizeSaved
  ).toHaveBeenCalledOnce()
  expect(commands.confirmCreationGitSwitch).toHaveBeenCalledOnce()
})

it('rejects a completion from an earlier workspace lifetime even when the same identity returns before native confirmation finishes', async () => {
  const originalWorkspace = useCreationStore.getState().workspace
  const captured = draft()
  const returnedDraft = draft('new workspace lifetime')
  useCreationFilesStore.setState({ drafts: { 'server.js': captured } })
  vi.mocked(commands.confirmCreationGitSwitch).mockImplementationOnce(
    async () => {
      useCreationStore.setState({
        workspace: {
          project: {
            identity: 'replacement',
            root: '/replacement',
            name: 'Replacement',
            source: 'folder',
          },
          files: [],
        },
      })
      useCreationStore.setState({ workspace: originalWorkspace })
      useCreationFilesStore.setState({
        drafts: { 'server.js': returnedDraft },
      })
      return { status: 'ok', data: null }
    }
  )
  const discard = vi.spyOn(
    useCreationFilesStore.getState(),
    'discardCheckoutCopies'
  )
  const reload = vi.fn().mockResolvedValue(true)
  const completed = await switchGitVersion('git', 'a', true)
  expect(completed.outcome).toBe('switched')
  expect(useCreationStore.getState().workspace?.project.identity).toBe('git')
  await expect(completed.recover(reload)).resolves.toBe(false)
  expect(discard).not.toHaveBeenCalled()
  expect(
    useCreationFilesStore.getState().synchronizeSaved
  ).not.toHaveBeenCalled()
  expect(reload).not.toHaveBeenCalled()
  expect(useCreationFilesStore.getState().drafts['server.js']).toBe(
    returnedDraft
  )
  expect(commands.confirmCreationGitSwitch).toHaveBeenCalledOnce()
})

it('shares recovery with synchronous reentry from its progress callback', async () => {
  const completed = await switchGitVersion('git', 'a', false)
  const reload = vi.fn().mockResolvedValue(true)
  const discard = vi.spyOn(
    useCreationFilesStore.getState(),
    'discardCheckoutCopies'
  )
  let reentrant: Promise<boolean> | undefined
  const progress = vi.fn((phase: string) => {
    if (phase === 'synchronizing') reentrant = completed.recover(reload)
  })
  const recovering = completed.recover(reload, progress)
  await expect(recovering).resolves.toBe(true)
  expect(reentrant).toBe(recovering)
  expect(discard).toHaveBeenCalledOnce()
  expect(
    useCreationFilesStore.getState().synchronizeSaved
  ).toHaveBeenCalledOnce()
  expect(reload).toHaveBeenCalledOnce()
  expect(commands.confirmCreationGitSwitch).toHaveBeenCalledOnce()
})

it('rechecks ownership after notifying Git readers before touching editor copies', async () => {
  const completed = await switchGitVersion('git', 'a', false)
  const replacementDraft = draft('replacement project content')
  const discard = vi.spyOn(
    useCreationFilesStore.getState(),
    'discardCheckoutCopies'
  )
  const reload = vi.fn().mockResolvedValue(true)
  const unsubscribe = useCreationReadingStore.subscribe((state, previous) => {
    if (state.gitRevision === previous.gitRevision) return
    useCreationStore.setState({
      workspace: {
        project: {
          identity: 'replacement',
          root: '/replacement',
          name: 'Replacement',
          source: 'folder',
        },
        files: [],
      },
    })
    useCreationFilesStore.setState({
      drafts: { 'server.js': replacementDraft },
    })
  })
  try {
    await expect(completed.recover(reload)).resolves.toBe(false)
    expect(completed.outcome).toBe('switched')
    expect(discard).not.toHaveBeenCalled()
    expect(
      useCreationFilesStore.getState().synchronizeSaved
    ).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(useCreationFilesStore.getState().drafts['server.js']).toBe(
      replacementDraft
    )
  } finally {
    unsubscribe()
  }
})

it('does not create a completed checkout or discard drafts after native confirmation is refused', async () => {
  const captured = draft()
  useCreationFilesStore.setState({ drafts: { 'server.js': captured } })
  const discard = vi.spyOn(
    useCreationFilesStore.getState(),
    'discardCheckoutCopies'
  )
  vi.mocked(commands.confirmCreationGitSwitch).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'versionConflict', detail: 'Reviewed files changed' },
  })
  await expect(switchGitVersion('git', 'a', true)).rejects.toEqual({
    code: 'versionConflict',
    detail: 'Reviewed files changed',
  })
  expect(discard).not.toHaveBeenCalled()
  expect(
    useCreationFilesStore.getState().synchronizeSaved
  ).not.toHaveBeenCalled()
  expect(useCreationFilesStore.getState().drafts['server.js']).toBe(captured)
})

it('retains a saved receipt and its warning when history recovery fails without recording again', async () => {
  const receipt = {
    commit: 'saved-commit',
    message: 'Saved version',
    paths: ['server.js'],
    warning: 'Version name metadata could not be saved',
  }
  vi.mocked(commands.confirmCreationGitVersion).mockResolvedValueOnce({
    status: 'ok',
    data: receipt,
  })
  const result = await saveGitVersion('git', 'Saved version', '')
  const reload = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
  await expect(result.completion.recover(reload)).resolves.toBe(false)
  expect(result.completion.outcome).toBe('saved')
  expect(result.completion.receipt).toBe(receipt)
  expect(result.completion.description).toBe('Saved version')
  expect(result.completion.needsSync).toBe(false)
  await expect(result.completion.recover(reload)).resolves.toBe(true)
  expect(commands.confirmCreationGitVersion).toHaveBeenCalledOnce()
  expect(
    useCreationFilesStore.getState().synchronizeSaved
  ).not.toHaveBeenCalled()
  expect(reload).toHaveBeenCalledTimes(2)
})

it('recovers the native version name by reading without repeating the rename', async () => {
  const target = {
    commit: 'a',
    expected: 'Original version',
    name: 'Requested name',
  }
  vi.mocked(commands.renameCreationGitVersion).mockResolvedValueOnce({
    status: 'ok',
    data: 'Native saved name',
  })
  const completed = await renameGitVersion('git', target)
  const reload = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
  await expect(completed.recover(reload)).resolves.toBe(false)
  expect(completed.outcome).toBe('renamed')
  expect(completed.description).toBe('Native saved name')
  await expect(completed.recover(reload)).resolves.toBe(true)
  expect(commands.renameCreationGitVersion).toHaveBeenCalledExactlyOnceWith(
    'git',
    'a',
    'Original version',
    'Requested name'
  )
  expect(
    useCreationFilesStore.getState().synchronizeSaved
  ).not.toHaveBeenCalled()
})

it('identifies restoring the current version from its reviewed HEAD', async () => {
  const prepared = await prepareGitVersionSwitch(
    'git',
    'a',
    true,
    undefined,
    undefined,
    'a'
  )
  const completed = await confirmPreparedGitSwitch(prepared)
  expect(completed.outcome).toBe('restored')
  await expect(completed.recover(async () => true)).resolves.toBe(true)
  expect(commands.confirmCreationGitSwitch).toHaveBeenCalledExactlyOnceWith(
    'git',
    'switch'
  )
})

it('recovers an applied GitHub update without discarding later drafts or updating again', async () => {
  const original = { ...draft('saved text'), diskText: 'saved text' }
  const later = draft('user edit during update')
  const unaffected = draft('unaffected')
  useCreationFilesStore.setState({
    drafts: { 'server.js': original, 'unaffected.js': unaffected },
  })
  const target = {
    repositoryId: 'repo',
    branch: 'main',
    head: 'a',
    remoteHead: 'b',
  }
  const receipt: GithubUpdateReceipt = {
    paths: ['server.js'],
    status: {
      supported: true,
      templateBackupEligible: false,
      templateBackupPending: null,
      templateBackupPublished: false,
      templateBackupRecovered: false,
      branch: 'main',
      head: 'b',
      origin: null,
      repository: null,
      accountId: null,
      autoBackup: false,
      autoBackupPaused: false,
      firstBackupConfirmed: true,
      pending: false,
      relation: 'equal',
      remoteHead: 'b',
      stale: false,
      issue: null,
    },
  }
  vi.mocked(commands.githubUpdate).mockImplementationOnce(async () => {
    useCreationFilesStore.setState({
      drafts: { 'server.js': later, 'unaffected.js': unaffected },
    })
    return { status: 'ok', data: receipt }
  })
  const discard = vi.spyOn(
    useCreationFilesStore.getState(),
    'discardCheckoutCopies'
  )
  const sync = vi
    .mocked(useCreationFilesStore.getState().synchronizeSaved)
    .mockResolvedValueOnce(false)
    .mockResolvedValue(true)
  const { completion, receipt: updated } = await updateGitVersion('git', target)
  const reload = vi.fn().mockResolvedValue(true)
  await expect(completion.recover(reload)).resolves.toBe(false)
  expect(completion.outcome).toBe('updated')
  expect(updated).toBe(receipt)
  expect(useCreationFilesStore.getState().drafts['server.js']).toBe(later)
  await expect(completion.recover(reload)).resolves.toBe(true)
  expect(useCreationFilesStore.getState().drafts['server.js']).toBe(later)
  expect(useCreationFilesStore.getState().drafts['unaffected.js']).toBe(
    unaffected
  )
  expect(commands.githubUpdate).toHaveBeenCalledExactlyOnceWith('git', target)
  expect(discard).toHaveBeenCalledOnce()
  expect(sync).toHaveBeenCalledTimes(2)
  expect(reload).toHaveBeenCalledOnce()
})

it('keeps an unfinished checkout synchronization recoverable through a later successful rename', async () => {
  const discard = vi.spyOn(
    useCreationFilesStore.getState(),
    'discardCheckoutCopies'
  )
  const sync = vi
    .mocked(useCreationFilesStore.getState().synchronizeSaved)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(false)
    .mockResolvedValue(true)
  const reload = vi.fn().mockResolvedValue(true)
  const checkout = await switchGitVersion('git', 'a', false)
  await expect(checkout.recover(reload)).resolves.toBe(false)
  expect(checkout.needsSync).toBe(true)

  vi.mocked(commands.renameCreationGitVersion).mockResolvedValueOnce({
    status: 'ok',
    data: 'Renamed after checkout',
  })
  const renamed = await renameGitVersion('git', {
    commit: 'a',
    expected: 'Original name',
    name: 'Renamed after checkout',
  })
  await expect(renamed.recover(reload)).resolves.toBe(false)
  expect(renamed.outcome).toBe('renamed')
  expect(renamed.description).toBe('Renamed after checkout')
  expect(checkout.outcome).toBe('switched')
  expect(checkout.needsSync).toBe(true)
  expect(renamed.needsSync).toBe(true)

  const retry = renamed.recover(reload)
  expect(checkout.recover(reload)).toBe(retry)
  await expect(retry).resolves.toBe(true)
  expect(checkout.needsSync).toBe(false)
  expect(renamed.needsSync).toBe(false)
  expect(checkout.pending).toBe(false)
  expect(renamed.pending).toBe(false)
  expect(commands.confirmCreationGitSwitch).toHaveBeenCalledOnce()
  expect(commands.renameCreationGitVersion).toHaveBeenCalledOnce()
  expect(discard).toHaveBeenCalledOnce()
  expect(sync).toHaveBeenCalledTimes(3)
  expect(reload).toHaveBeenCalledTimes(2)
})

it('does not let an older in-flight read clear the refresh required by another completed native operation', async () => {
  const saved = await saveGitVersion('git', 'Saved version', '')
  let finishRead!: (refreshed: boolean) => void
  const reload = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<boolean>(resolve => {
          finishRead = resolve
        })
    )
    .mockResolvedValue(true)
  const recovering = saved.completion.recover(reload)
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())

  vi.mocked(commands.renameCreationGitVersion).mockResolvedValueOnce({
    status: 'ok',
    data: 'Name changed during refresh',
  })
  const renamed = await renameGitVersion('git', {
    commit: 'b',
    expected: 'Saved version',
    name: 'Name changed during refresh',
  })
  expect(renamed.recover(reload)).toBe(recovering)
  finishRead(true)
  await expect(recovering).resolves.toBe(false)
  expect(saved.completion.pending).toBe(true)
  expect(renamed.pending).toBe(true)

  await expect(renamed.recover(reload)).resolves.toBe(true)
  expect(reload).toHaveBeenCalledTimes(2)
  expect(saved.completion.pending).toBe(false)
  expect(renamed.pending).toBe(false)
  expect(saved.completion.outcome).toBe('saved')
  expect(saved.completion.receipt?.commit).toBe('b')
  expect(renamed.outcome).toBe('renamed')
  expect(renamed.description).toBe('Name changed during refresh')
  expect(commands.confirmCreationGitVersion).toHaveBeenCalledOnce()
  expect(commands.renameCreationGitVersion).toHaveBeenCalledOnce()
  expect(
    useCreationFilesStore.getState().synchronizeSaved
  ).not.toHaveBeenCalled()
})
