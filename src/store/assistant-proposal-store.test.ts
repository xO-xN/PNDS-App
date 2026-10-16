import { beforeEach, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from './creation-store'
import { useCreationFilesStore } from './creation-files-store'
import { useAssistantProposalStore } from './assistant-proposal-store'
import { seedCreationDraft } from '@/test/creation-files'
import { useSessionStore } from './session-store'

beforeEach(() => {
  vi.clearAllMocks()
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
