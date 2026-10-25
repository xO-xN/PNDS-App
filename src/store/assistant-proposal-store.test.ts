import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from './creation-store'
import { useCreationFilesStore } from './creation-files-store'
import { useAssistantProposalStore } from './assistant-proposal-store'
import { seedCreationDraft } from '@/test/creation-files'
import { useSessionStore } from './session-store'
import { useParameterPreviewStore } from './parameter-preview-store'
import { useAssistantStore } from './assistant-store'

afterEach(() => vi.restoreAllMocks())

beforeEach(() => {
  vi.clearAllMocks()
  useAssistantStore.setState({ phase: 'idle' })
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'p',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [{ path: 'score.js', kind: 'text', category: 'pages', size: 10 }],
    },
  })
  useCreationFilesStore.getState().clear()
  useAssistantProposalStore.getState().clear()
  useParameterPreviewStore.setState({ owner: null, status: 'idle' })
})

function installParameterSave() {
  seedCreationDraft('score.js', 'let size = 2;', 'v1')
  const store = useAssistantProposalStore.getState()
  store.install(
    'p',
    'reply',
    'key',
    [
      {
        id: 'parameter',
        taskId: 'finished-task',
        path: 'score.js',
        version: 'v1',
        sourceText: 'let size = 2;',
        text: 'let size = 2;',
        parameters: [],
        binding: null,
      },
    ],
    vi.fn()
  )
  store.editCode('parameter', 'let size = 3;')
  return store
}

it('keeps a short parameter transaction journal when a submitted write has an uncertain outcome', async () => {
  const store = installParameterSave()
  vi.mocked(commands.beginCreationAssistantTask).mockResolvedValueOnce({
    status: 'ok',
    data: { id: 'uncertain-parameter', mode: 'edit', files: [] },
  })
  vi.mocked(commands.writeCreationAssistantFile).mockRejectedValueOnce(
    new Error('invoke disconnected')
  )
  await store.apply('parameter')
  expect(commands.endCreationAssistantTask).toHaveBeenCalledWith(
    'p',
    'uncertain-parameter'
  )
  expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
  expect(
    useAssistantProposalStore.getState().items.parameter?.error?.code
  ).toBe('io')
})

it('does not write or steal the model grant when a model task starts during parameter authorization', async () => {
  const store = installParameterSave()
  let finish!: () => void
  vi.mocked(commands.beginCreationAssistantTask).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = () =>
          resolve({
            status: 'ok',
            data: { id: 'empty-parameter', mode: 'edit', files: [] },
          })
      })
  )
  const saving = store.apply('parameter')
  await vi.waitFor(() =>
    expect(commands.beginCreationAssistantTask).toHaveBeenCalled()
  )
  useAssistantStore.setState({ phase: 'reading' })
  finish()
  await saving
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  expect(commands.endCreationAssistantTask).toHaveBeenCalledExactlyOnceWith(
    'p',
    'empty-parameter'
  )
  expect(commands.clearCreationAssistantResume).toHaveBeenCalledExactlyOnceWith(
    'p',
    'empty-parameter'
  )
})

function installRemovalCandidate(messageId: string, id: string) {
  const publish = vi.fn()
  useAssistantProposalStore.getState().install(
    'p',
    messageId,
    'key',
    [
      {
        id,
        path: `${id}.js`,
        version: 'v1',
        sourceText: 'saved',
        text: 'candidate',
        parameters: [],
        binding: null,
      },
    ],
    publish
  )
  return publish
}

it('removes only one message’s proposals and ends only their own temporary preview', () => {
  installRemovalCandidate('removed-chat-reply', 'removed')
  installRemovalCandidate('other-chat-reply', 'retained')
  const store = useAssistantProposalStore.getState()
  const retained = store.items.retained
  seedCreationDraft('score.js', 'saved file', 'v1')
  useCreationFilesStore.getState().edit('score.js', 'unsaved creator text')
  const draft = useCreationFilesStore.getState().drafts['score.js']
  useParameterPreviewStore.setState({
    owner: {
      identity: 'p',
      proposalId: 'retained',
      revision: 1,
      path: 'retained.js',
      version: 'v1',
    },
    status: 'temporary',
  })
  const end = vi
    .spyOn(useParameterPreviewStore.getState(), 'end')
    .mockResolvedValue(true)

  store.removeMessages(['removed-chat-reply'])
  store.removeMessages(['removed-chat-reply'])
  expect(useAssistantProposalStore.getState().items).toEqual({ retained })
  expect(end).not.toHaveBeenCalled()
  expect(useCreationFilesStore.getState().drafts['score.js']).toBe(draft)
  expect(commands.undoCreationAssistantTask).not.toHaveBeenCalled()
  expect(commands.undoCreationFileChange).not.toHaveBeenCalled()

  store.removeMessages(['other-chat-reply'])
  expect(useAssistantProposalStore.getState().items).toEqual({})
  expect(end).toHaveBeenCalledOnce()
})

it('ignores deleted proposals’ late reloads without invalidating another chat’s reload', async () => {
  const removedPublish = installRemovalCandidate(
    'removed-chat-reply',
    'removed'
  )
  const retainedPublish = installRemovalCandidate(
    'other-chat-reply',
    'retained'
  )
  let finish!: () => void
  const reading = new Promise<void>(resolve => {
    finish = resolve
  })
  vi.mocked(commands.readCreationFile).mockImplementation(
    async (_identity, path) => {
      await reading
      return {
        status: 'ok',
        data: { kind: 'text', version: 'v2', text: `reloaded ${path}` },
      }
    }
  )
  const store = useAssistantProposalStore.getState()
  const reloads = Promise.all([
    store.reload('removed'),
    store.reload('retained'),
  ])
  await vi.waitFor(() =>
    expect(commands.readCreationFile).toHaveBeenCalledTimes(2)
  )
  store.removeMessages(['removed-chat-reply'])
  finish()
  await reloads

  expect(useAssistantProposalStore.getState().items.removed).toBeUndefined()
  expect(
    useAssistantProposalStore.getState().items.retained?.candidate.text
  ).toBe('reloaded retained.js')
  expect(removedPublish).toHaveBeenCalledOnce()
  expect(retainedPublish).toHaveBeenCalledTimes(2)
})

it('revokes a deleted preview still waiting to become owner without ending the previous owner', async () => {
  installRemovalCandidate('removed-chat-reply', 'removed')
  useParameterPreviewStore.setState({
    owner: {
      identity: 'p',
      proposalId: 'other-chat-proposal',
      revision: 1,
      path: 'other.js',
      version: 'v1',
    },
    status: 'restoring',
  })
  const end = vi
    .spyOn(useParameterPreviewStore.getState(), 'end')
    .mockResolvedValue(true)
  let begin!: () => void
  const waiting = new Promise<void>(resolve => {
    begin = resolve
  })
  const preview = vi
    .spyOn(useParameterPreviewStore.getState(), 'preview')
    .mockImplementation(async owner => {
      await waiting
      useParameterPreviewStore.setState({ owner, status: 'checking' })
    })
  const store = useAssistantProposalStore.getState()
  const previewing = store.preview('removed')
  await vi.waitFor(() => expect(preview).toHaveBeenCalledOnce())
  store.removeMessages(['removed-chat-reply'])
  expect(end).not.toHaveBeenCalled()
  begin()
  await previewing

  expect(end).toHaveBeenCalledOnce()
  expect(useAssistantProposalStore.getState().items.removed).toBeUndefined()
})

it('saves completed edit parameter cards through a fresh short transaction and retires only that transaction', async () => {
  const store = useAssistantProposalStore.getState()
  seedCreationDraft('score.js', 'const size = 2;', 'v1')
  store.install(
    'p',
    'reply',
    'key',
    [
      {
        id: 'control',
        taskId: 'native-task',
        taskScope: { chatId: 'original', messageId: 'reply' },
        path: 'score.js',
        version: 'v1',
        sourceText: 'const size = 2;',
        text: 'const size = 2;',
        parameters: [],
        binding: null,
      },
    ],
    vi.fn()
  )
  store.editCode('control', 'const size = 3;')
  useAssistantStore.setState({ phase: 'idle', paused: true, canContinue: true })
  vi.mocked(commands.beginCreationAssistantTask).mockResolvedValueOnce({
    status: 'ok',
    data: { id: 'parameter-save', mode: 'edit', files: [] },
  })
  vi.mocked(commands.writeCreationAssistantFile).mockResolvedValueOnce({
    status: 'ok',
    data: {
      id: 'native-task',
      mode: 'edit',
      files: [{ path: 'score.js', created: false, undone: false }],
    },
  })
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: {
      kind: 'text',
      version: 'v2',
      text: 'const size = 3;',
    },
  })
  await store.apply('control')
  expect(commands.beginCreationAssistantTask).toHaveBeenCalledWith(
    'p',
    'edit',
    null,
    { chatId: 'original', messageId: 'reply' }
  )
  expect(commands.writeCreationAssistantFile).toHaveBeenCalledWith(
    'p',
    'parameter-save',
    { path: 'score.js', version: 'v1', text: 'const size = 3;', edits: null }
  )
  expect(commands.endCreationAssistantTask).toHaveBeenCalledWith(
    'p',
    'parameter-save'
  )
  expect(commands.clearCreationAssistantResume).toHaveBeenCalledExactlyOnceWith(
    'p',
    'parameter-save'
  )
  expect(commands.saveCreationFileChange).not.toHaveBeenCalled()
  expect(
    useAssistantProposalStore.getState().items.control?.source.version
  ).toBe('v2')
})

it('keeps candidate edits separate from drafts; only explicit apply writes and freezes the actual difference', async () => {
  seedCreationDraft('score.js', 'const title = "Blue";', 'v1')
  vi.mocked(commands.saveCreationFileChange).mockResolvedValue({
    status: 'ok',
    data: {
      id: 'change',
      path: 'score.js',
      beforeText: 'const title = "Blue";',
      afterText: 'const title = "Amber";',
      beforeVersion: 'v1',
      afterVersion: 'v2',
    },
  })
  const proposals = useAssistantProposalStore.getState()
  proposals.install(
    'p',
    'reply',
    'project-key',
    [
      {
        id: 'candidate',
        path: 'score.js',
        version: 'v1',
        sourceText: 'const title = "Blue";',
        text: 'const title = "Red";',
        parameters: [],
        binding: null,
      },
    ],
    vi.fn()
  )
  proposals.editCode('candidate', 'const title = "Amber";')
  expect(useCreationFilesStore.getState().drafts['score.js']?.text).toBe(
    'const title = "Blue";'
  )
  expect(commands.saveCreationFileChange).not.toHaveBeenCalled()
  await proposals.apply('candidate')
  await proposals.apply('candidate')
  expect(commands.saveCreationFileChange).toHaveBeenCalledExactlyOnceWith(
    'p',
    'score.js',
    'const title = "Amber";',
    'v1'
  )
  proposals.editCode('candidate', 'const title = "Green";')
  expect(
    useAssistantProposalStore.getState().items.candidate?.records[0]?.afterText
  ).toBe('const title = "Amber";')
  expect(useCreationFilesStore.getState().drafts['score.js']?.text).toBe(
    'const title = "Amber";'
  )
  useSessionStore.setState({ sessionStatus: 'ready' })
  useCreationFilesStore
    .getState()
    .complete(
      { identity: 'p', revision: useCreationFilesStore.getState().revision },
      'restart'
    )
  expect(
    useAssistantProposalStore.getState().items.candidate?.pendingRefresh
  ).toBe(false)
})

it('closes the task grant and preserves creator typing that arrives while parameter saving is authorizing', async () => {
  const store = useAssistantProposalStore.getState()
  seedCreationDraft('score.js', 'let size = 2;', 'v1')
  store.install(
    'p',
    'reply',
    'key',
    [
      {
        id: 'control',
        taskId: 'native-task',
        path: 'score.js',
        version: 'v1',
        sourceText: 'let size = 2;',
        text: 'let size = 2;',
        parameters: [],
        binding: null,
      },
    ],
    vi.fn()
  )
  store.editCode('control', 'let size = 3;')
  let authorize!: () => void
  const begun = new Promise<void>(resolve => {
    authorize = resolve
  })
  vi.mocked(commands.beginCreationAssistantTask).mockImplementationOnce(
    async () => {
      await begun
      return {
        status: 'ok',
        data: { id: 'native-task', mode: 'edit', files: [] },
      }
    }
  )
  const saving = store.apply('control')
  await vi.waitFor(() =>
    expect(commands.beginCreationAssistantTask).toHaveBeenCalled()
  )
  useCreationFilesStore.getState().edit('score.js', 'creator text')
  authorize()
  await saving
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  expect(commands.endCreationAssistantTask).toHaveBeenCalledWith(
    'p',
    'native-task'
  )
  expect(useCreationFilesStore.getState().drafts['score.js']?.text).toBe(
    'creator text'
  )
  expect(useAssistantProposalStore.getState().items.control?.error?.code).toBe(
    'versionConflict'
  )
})

it('retains candidate text and exposes a reload transport failure', async () => {
  useAssistantProposalStore.getState().install(
    'p',
    'reply',
    'key',
    [
      {
        id: 'reload',
        path: 'score.js',
        version: 'v1',
        sourceText: 'saved',
        text: 'my candidate',
        parameters: [],
        binding: null,
      },
    ],
    vi.fn()
  )
  vi.mocked(commands.readCreationFile).mockRejectedValueOnce(
    new Error('transport failed')
  )
  await useAssistantProposalStore.getState().reload('reload')
  expect(
    useAssistantProposalStore.getState().items.reload?.candidate.text
  ).toBe('my candidate')
  expect(useAssistantProposalStore.getState().items.reload?.error?.code).toBe(
    'io'
  )
})

it('isolates a dispatched write from a project switch and preserves candidate typing during the write', async () => {
  seedCreationDraft('score.js', 'saved', 'v1')
  const proposals = useAssistantProposalStore.getState()
  proposals.install(
    'p',
    'reply',
    'key',
    [
      {
        id: 'late',
        path: 'score.js',
        version: 'v1',
        sourceText: 'saved',
        text: 'first candidate',
        parameters: [],
        binding: null,
      },
    ],
    vi.fn()
  )
  let finish!: (
    value: Awaited<ReturnType<typeof commands.saveCreationFileChange>>
  ) => void
  vi.mocked(commands.saveCreationFileChange).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const writing = proposals.apply('late')
  await vi.waitFor(() =>
    expect(commands.saveCreationFileChange).toHaveBeenCalled()
  )
  proposals.editCode('late', 'typed during write')
  finish({
    status: 'ok',
    data: {
      id: 'first',
      path: 'score.js',
      beforeText: 'saved',
      afterText: 'first candidate',
      beforeVersion: 'v1',
      afterVersion: 'v2',
    },
  })
  await writing
  expect(useAssistantProposalStore.getState().items.late?.candidate.text).toBe(
    'typed during write'
  )
  expect(
    useAssistantProposalStore.getState().items.late?.records[0]?.afterText
  ).toBe('first candidate')
  vi.mocked(commands.saveCreationFileChange).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const oldWrite = proposals.apply('late')
  await vi.waitFor(() =>
    expect(commands.saveCreationFileChange).toHaveBeenCalledTimes(2)
  )
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
  finish({
    status: 'ok',
    data: {
      id: 'late-result',
      path: 'score.js',
      beforeText: 'first candidate',
      afterText: 'typed during write',
      beforeVersion: 'v2',
      afterVersion: 'v3',
    },
  })
  await oldWrite
  expect(useAssistantProposalStore.getState().items).toEqual({})
})

it('preserves both candidate and a conflicting file draft and refuses a repeated apply', async () => {
  seedCreationDraft('score.js', 'saved', 'v1')
  useAssistantProposalStore.getState().install(
    'p',
    'reply',
    'key',
    [
      {
        id: 'candidate',
        path: 'score.js',
        version: 'v1',
        sourceText: 'saved',
        text: 'candidate',
        parameters: [],
        binding: null,
      },
    ],
    vi.fn()
  )
  useCreationFilesStore.getState().edit('score.js', 'my unsaved work')
  await useAssistantProposalStore.getState().apply('candidate')
  expect(commands.saveCreationFileChange).not.toHaveBeenCalled()
  expect(
    useAssistantProposalStore.getState().items.candidate?.candidate.text
  ).toBe('candidate')
  expect(useCreationFilesStore.getState().drafts['score.js']?.text).toBe(
    'my unsaved work'
  )
})

it('applies two coordinated file candidates independently without invalidating the other candidate', async () => {
  seedCreationDraft('score.js', 'old score', 'score-v1')
  seedCreationDraft('manifest.json', 'old manifest', 'manifest-v1')
  const proposals = useAssistantProposalStore.getState()
  proposals.install(
    'p',
    'reply',
    'key',
    [
      {
        id: 'score-change',
        path: 'score.js',
        version: 'score-v1',
        sourceText: 'old score',
        text: 'new score',
        parameters: [],
        binding: null,
      },
      {
        id: 'manifest-change',
        path: 'manifest.json',
        version: 'manifest-v1',
        sourceText: 'old manifest',
        text: 'new manifest',
        parameters: [],
        binding: null,
      },
    ],
    vi.fn()
  )
  vi.mocked(commands.saveCreationFileChange).mockImplementation(
    async (_identity, path, text, version) => ({
      status: 'ok',
      data: {
        id: `${path}-change`,
        path,
        beforeText: path === 'score.js' ? 'old score' : 'old manifest',
        afterText: text,
        beforeVersion: version,
        afterVersion: `${version}-next`,
      },
    })
  )
  await proposals.apply('score-change')
  expect(
    useAssistantProposalStore.getState().items['manifest-change']?.error
  ).toBeNull()
  expect(useCreationFilesStore.getState().drafts['manifest.json']?.text).toBe(
    'old manifest'
  )
  await proposals.apply('manifest-change')
  expect(commands.saveCreationFileChange).toHaveBeenCalledTimes(2)
  expect(useCreationFilesStore.getState().drafts['score.js']?.text).toBe(
    'new score'
  )
  expect(useCreationFilesStore.getState().drafts['manifest.json']?.text).toBe(
    'new manifest'
  )
  expect(
    useAssistantProposalStore.getState().items['score-change']?.records
  ).toHaveLength(1)
  expect(
    useAssistantProposalStore.getState().items['manifest-change']?.records
  ).toHaveLength(1)
})
